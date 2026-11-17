package online.captnuu.dcc

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Timeout

/** Isolated synthetic claims/storage; no endpoint or user data. */
class HermesReplyDeliveryTest {
    private val owner="a".repeat(64)
    private val now=1794016800000L
    private class Memory:SessionStorage {
        var raw:String?=null;var fail=false
        override fun read()=raw
        override fun write(value:String){if(fail)throw java.io.IOException("private storage detail");raw=value}
        override fun clear(){error("Never clear")}
    }
    private fun finalReply(start:JSONObject)=JSONObject().put("version",1).put("chatVersion",1)
        .put("rootKey",start.getString("key")).put("turnKey",start.getString("key"))
        .put("questions",0).put("expiresAt",now+HERMES_TTL_MS)
        .put("receipt",JSONObject().put("version",1).put("key",start.getString("key"))
            .put("outcome","read-only").put("line","No actions performed.").put("expected",JSONObject.NULL).put("verified",0).put("targets",JSONArray()))
        .put("assistantReply",JSONObject().put("version",1).put("text","Stored synthetic reply"))
    private fun begin(c:HermesConversationController){c.bind(owner);c.availability(true,1,1,1);c.edit("Synthetic question");c.send()}

    @Test fun deliveryCategoriesAreFiniteAndNeverIncludeExceptionMessages(){
        for((error,code) in listOf(
            HermesHttpFailure(status=502) to "HTTP 502",
            HermesHttpFailure(status=401) to "AUTH 401",
            HermesHttpFailure(status=403) to "AUTH 403",
            HermesHttpFailure(auth=true) to "AUTH",
            java.net.SocketTimeoutException("private detail") to "TIMEOUT",
            java.io.IOException("private detail") to "NETWORK",
            org.json.JSONException("private detail") to "DECODE",
            IllegalArgumentException("private detail") to "INVALID",
            CancellationException("private detail") to "CANCELLED"
        ))assertEquals(code,hermesDeliveryFailure(error).code)
        assertEquals("STORAGE",hermesDeliveryFailure(java.io.IOException("private detail"),false).code)
        assertEquals("HTTP",hermesDeliveryFailure(HermesHttpFailure(status=999)).code)
    }

    @Test fun eligibleOriginalFailuresRecoverQuietly(){
        for(error in listOf(
            HermesHttpFailure(status=503),
            java.net.SocketTimeoutException("private detail"),
            java.io.IOException("private detail"),
            org.json.JSONException("private detail"),
            IllegalArgumentException("private detail")
        )){
            val scope=CoroutineScope(Dispatchers.Unconfined);val calls=mutableListOf<String>();var start:JSONObject?=null
            val c=HermesConversationController(scope,{Memory()},{body->
                calls+=body.getString("op")
                if(calls.size==1){start=body;throw error}
                finalReply(start!!)
            },{now})
            try{
                begin(c)
                assertEquals(listOf("start","read"),calls)
                assertEquals("Stored synthetic reply",c.state.value.timeline.last().text)
                assertEquals("",c.state.value.notice)
            }finally{scope.cancel()}
        }
    }

    @Test fun authAndCancellationNeverStartRecovery(){
        for(error in listOf(HermesHttpFailure(status=401),HermesHttpFailure(status=403),CancellationException("private detail"))){
            val scope=CoroutineScope(Dispatchers.Unconfined);val calls=mutableListOf<String>()
            val c=HermesConversationController(scope,{Memory()},{body->calls+=body.getString("op");throw error},{now})
            try{
                begin(c);assertEquals(listOf("start"),calls);assertFalse(c.state.value.busy)
                val text=c.state.value.timeline.last().text
                assertTrue(text.startsWith(if(error is HermesHttpFailure)"Sign in again" else "I couldn’t confirm"))
                assertFalse(text.contains("private detail"));assertNotNull(c.state.value.attemptKey)
            }finally{scope.cancel()}
        }
    }

    @Test fun aPendingReplyIsRecoveredQuietlyFromSavedChatAfterRestart(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val calls=mutableListOf<JSONObject>()
        val first=HermesConversationController(scope,{saved},{body->calls+=body;awaitCancellation()},{now})
        val reopened=HermesConversationController(scope,{saved},{body->calls+=body;finalReply(calls.first())},{now})
        try{
            begin(first)
            first.edit("Keep my next draft")
            first.unbind()
            reopened.bind(owner)
            assertEquals(1,calls.size)
            reopened.availability(true,1,1,1)
            assertEquals(listOf("start","read"),calls.map{it.getString("op")})
            assertEquals(calls[0].getString("key"),calls[1].getString("rootKey"))
            assertEquals(calls[0].getString("clientId"),calls[1].getString("clientId"))
            assertEquals("Stored synthetic reply",reopened.state.value.timeline.last().text)
            assertEquals("Keep my next draft",reopened.state.value.draft)
            assertEquals("",reopened.state.value.notice)
        }finally{scope.cancel()}
    }

    @Test fun rejectedRecoveryNeverPublishesFinalTextOrLoops(){
        for(kind in listOf("running","root","turn","version","expired","decode","http")){
            val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val calls=mutableListOf<String>();var start:JSONObject?=null
            val c=HermesConversationController(scope,{saved},{body->
                calls+=body.getString("op")
                if(calls.size==1){start=body;throw java.io.IOException("private original")}
                val v=finalReply(start!!)
                when(kind){
                    "running"->{v.remove("assistantReply");v.getJSONObject("receipt").put("outcome","uncertain")}
                    "root"->v.put("rootKey","other-root-key-00001")
                    "turn"->v.put("turnKey","other-turn-key-00001")
                    "version"->v.put("chatVersion",2)
                    "expired"->v.put("expiresAt",now-1)
                    "decode"->throw org.json.JSONException("private response")
                    "http"->throw HermesHttpFailure(status=500)
                }
                v
            },{now},recoveryTiming=HermesChatRecoveryTiming(listOf(0,0,0,0),5000,200))
            try{
                begin(c)
                val expectedCalls=if(kind=="running"||kind=="http") listOf("start","read","read","read","read") else listOf("start","read")
                assertEquals(expectedCalls,calls);assertFalse(c.state.value.busy)
                assertTrue(c.state.value.timeline.none{it.kind=="reply"});assertNotNull(c.state.value.attemptKey)
                val text=c.state.value.timeline.last().text
                assertTrue(text.startsWith(if(kind=="expired")"This reply is no longer available" else "I couldn’t confirm"));assertFalse(text.contains("private"))
                val reopened=HermesConversationController(scope,{saved},{error("No replay")},{now});reopened.bind(owner)
                assertEquals(expectedCalls,calls)
                c.edit("A genuinely new topic");assertEquals("A genuinely new topic",c.state.value.draft)
            }finally{scope.cancel()}
        }
    }

    @Test fun failedAcceptanceKeepsDurableOriginalClaimAndDoesNotRead(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val calls=mutableListOf<String>()
        val c=HermesConversationController(scope,{saved},{body->calls+=body.getString("op");saved.fail=true;finalReply(body)},{now})
        try{
            begin(c);assertEquals(listOf("start"),calls);assertFalse(c.state.value.storageReady)
            assertNotNull(c.state.value.attemptKey);assertFalse(c.state.value.submitted!!.closed)
            assertTrue(c.state.value.notice.contains("Saved chat could not be written."))
            assertTrue(c.state.value.timeline.none{it.kind=="reply"})
            assertTrue(JSONObject(saved.raw!!).has("attemptKey"))
        }finally{scope.cancel()}
    }

    @Test fun recoveryWatchdogTerminatesOneSuspendedRead()=runBlocking {
        val scope=CoroutineScope(Dispatchers.Unconfined);val calls=mutableListOf<String>()
        val cancels=java.util.concurrent.atomic.AtomicInteger(0)
        val readEntered=java.util.concurrent.atomic.AtomicInteger(0)
        val factory=object:okhttp3.Call.Factory{
            override fun newCall(request:okhttp3.Request):okhttp3.Call=object:okhttp3.Call{
                @Volatile private var canceled=false
                override fun cancel(){canceled=true;cancels.incrementAndGet()}
                override fun clone():okhttp3.Call=this
                override fun enqueue(responseCallback:okhttp3.Callback){
                    readEntered.incrementAndGet()
                    Thread{
                        try{
                            while(!canceled) Thread.sleep(5)
                            responseCallback.onFailure(this, java.io.IOException("cancelled"))
                        }catch(_:InterruptedException){responseCallback.onFailure(this, java.io.IOException("interrupted"))}
                    }.start()
                }
                override fun execute():okhttp3.Response=error("unused")
                override fun isCanceled():Boolean=canceled
                override fun isExecuted():Boolean=false
                override fun request():okhttp3.Request=request
                override fun timeout():okio.Timeout=okio.Timeout.NONE
            }
        }
        val c=HermesConversationController(scope,{Memory()},{body->
            calls+=body.getString("op")
            if(calls.size==1)throw java.io.IOException("private detail")
            val result=awaitHermesHttp(factory,okhttp3.Request.Builder().url("https://synthetic.invalid/api/v1/hermes/conversation").post(body.toString().toRequestBody("application/json".toMediaType())).build())
            if(result.code !in 200..299)throw HermesHttpFailure(status=result.code)
            JSONObject(result.body)
        },{now},receiptTimeoutMillis=20,recoveryTiming=HermesChatRecoveryTiming(listOf(0,0,0,0),2000,15000))
        try{
            begin(c);withTimeout(8000){while(calls.size<5||cancels.get()<4||c.state.value.timeline.lastOrNull()?.kind!="unknown")delay(10)}
            assertEquals(listOf("start","read","read","read","read"),calls)
            assertEquals(4,readEntered.get())
            assertEquals(4,cancels.get())
            assertFalse(c.state.value.busy)
            assertTrue(c.state.value.timeline.last().text.startsWith("I couldn’t confirm"))
        }finally{scope.cancel()}
    }

    @Test fun newerSendAndOwnerSwitchFenceNonCooperativeLateReads(){
        for(switchOwner in listOf(false,true)){
            val scope=CoroutineScope(Dispatchers.Unconfined);val gate=CompletableDeferred<Unit>();val saved=Memory()
            val calls=mutableListOf<String>();var first:JSONObject?=null
            val c=HermesConversationController(scope,{saved},{body->
                calls+=body.getString("op")
                if(calls.size==1){first=body;throw java.io.IOException("private detail")}
                if(body.getString("op")=="read" && body.getString("rootKey")==first!!.getString("key")){
                    withContext(NonCancellable){gate.await()};finalReply(first!!)
                } else finalReply(body)
            },{now},recoveryTiming=HermesChatRecoveryTiming(listOf(0,0,0,0),5000,200))
            try{
                begin(c);assertEquals(listOf("start","read"),calls)
                if(switchOwner){c.unbind();c.bind("b".repeat(64));c.edit("Other owner draft")}
                else{c.edit("New explicit topic");c.send();c.edit("Newer editable draft")}
                val before=c.state.value
                gate.complete(Unit)
                // finite barrier: allow actual non-cooperative late completion to arrive and be fenced
                kotlinx.coroutines.runBlocking { kotlinx.coroutines.yield(); kotlinx.coroutines.delay(50); kotlinx.coroutines.yield() }
                assertEquals(before,c.state.value)
                assertEquals(if(switchOwner)listOf("start","read") else listOf("start","read","start"),calls)
                assertTrue(c.state.value.timeline.none{it.id=="reply:${first!!.getString("key")}"})
                if(!switchOwner)assertTrue(c.state.value.timeline.any{it.kind=="unknown"})
            }finally{gate.complete(Unit);scope.cancel()}
        }
    }

    @Test fun toolSummaryAloneIsFinalEvidence(){
        val scope=CoroutineScope(Dispatchers.Unconfined);var reads=0;var start:JSONObject?=null
        val c=HermesConversationController(scope,{Memory()},{body->
            if(body.getString("op")=="start"){start=body;throw java.io.IOException("private detail")}
            reads++;finalReply(start!!).also{it.remove("assistantReply");it.put("toolSummary",JSONObject().put("version",1).put("text","No changes recorded."))}
        },{now},recoveryTiming=HermesChatRecoveryTiming(listOf(0,0,0,0),5000,200))
        try{
            begin(c);assertEquals(1,reads);assertEquals("No changes recorded.",c.state.value.timeline.last().text)
        }finally{scope.cancel()}
    }

    @Test fun ownerLossAuthLossAndBlockedStorageDuringStartCannotInitiateLookup(){
        for(kind in listOf("owner","auth","storage")){
            val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val gate=CompletableDeferred<Unit>();val calls=mutableListOf<String>()
            val c=HermesConversationController(scope,{saved},{body->
                calls+=body.getString("op")
                withContext(NonCancellable){gate.await()}
                throw java.io.IOException("private detail")
            },{now},recoveryTiming=HermesChatRecoveryTiming(listOf(0,0,0,0),5000,200))
            try{
                begin(c)
                when(kind){
                    "owner"->c.unbind()
                    "auth"->c.availability(false)
                    "storage"->{saved.fail=true;c.edit("Keep this unsaved draft")}
                }
                gate.complete(Unit)
                assertEquals(listOf("start"),calls)
                assertTrue(c.state.value.timeline.none{it.kind=="reply"})
            }finally{gate.complete(Unit);scope.cancel()}
        }
    }

    @Test fun recoveredReplyMustBeSavedBeforeOriginalClaimIsReleased(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val calls=mutableListOf<String>();var start:JSONObject?=null
        val c=HermesConversationController(scope,{saved},{body->
            calls+=body.getString("op")
            if(calls.size==1){start=body;throw java.io.IOException("private detail")}
            saved.fail=true;finalReply(start!!)
        },{now},recoveryTiming=HermesChatRecoveryTiming(listOf(0,0,0,0),1000,200))
        try{
            begin(c);assertEquals(listOf("start","read"),calls)
            assertFalse(c.state.value.storageReady)
            assertNotNull(c.state.value.attemptKey)
            assertFalse(c.state.value.submitted!!.closed)
            assertTrue(c.state.value.timeline.none{it.kind=="reply"})
            assertTrue(c.state.value.timeline.last().text.startsWith("I couldn’t confirm"))
            assertTrue(c.state.value.notice.contains("Saved chat could not be written."))
            assertTrue(JSONObject(saved.raw!!).has("attemptKey"))
        }finally{scope.cancel()}
    }

    @Test fun genuineLostStartAndFirstReadRecoverLaterFinalReplyWithEffectsOnce(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val calls=mutableListOf<String>();var start:JSONObject?=null;var effects=0
        fun reply3(s:JSONObject)=JSONObject().put("version",1).put("chatVersion",1)
            .put("rootKey",s.getString("key")).put("turnKey",s.getString("key"))
            .put("questions",0).put("expiresAt",now+HERMES_TTL_MS)
            .put("receipt",JSONObject().put("version",1).put("key",s.getString("key"))
                .put("outcome","complete").put("line","Added 3/3 tasks").put("expected",3).put("verified",3)
                .put("targets",JSONArray((1..3).map{i->JSONObject().put("kind","task").put("id","task$i").put("action","added").put("title","Task $i").put("date","2026-11-07").put("state","applied").put("verification","verified")})))
            .put("assistantReply",JSONObject().put("version",1).put("text","Added 3 tasks."))
        val c=HermesConversationController(scope,{Memory()},{body->
            calls+=body.getString("op")
            when(calls.size){
                1->{start=body;effects=3;throw java.io.IOException("private start")}
                2->throw java.io.IOException("private read")
                else->reply3(start!!)
            }
        },{now},recoveryTiming=HermesChatRecoveryTiming(listOf(0,0,0,0),5000,200))
        try{
            begin(c)
            assertEquals(listOf("start","read","read"),calls)
            assertEquals(3,effects)
            assertEquals("Added 3 tasks.",c.state.value.timeline.last{it.kind=="reply"}.text)
            assertNotNull(c.state.value.receipt)
            val r=JSONObject(c.state.value.receipt!!)
            assertEquals("complete",r.getString("outcome"));assertEquals(3,r.getInt("verified"));assertEquals(3,r.getJSONArray("targets").length())
            assertEquals("",c.state.value.notice)
            assertFalse(c.state.value.timeline.any{it.text.contains("private")})
        }finally{scope.cancel()}
    }

    @Test fun validRunningNoFinalContinuesRecoveryUntilFinal(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val calls=mutableListOf<String>();var start:JSONObject?=null
        fun running(s:JSONObject)=finalReply(s).also{it.remove("assistantReply");it.getJSONObject("receipt").put("outcome","uncertain")}
        val c=HermesConversationController(scope,{Memory()},{body->
            calls+=body.getString("op")
            if(calls.size==1){start=body;throw java.io.IOException("private start")}
            if(calls.size<=3)running(start!!) else finalReply(start!!)
        },{now},recoveryTiming=HermesChatRecoveryTiming(listOf(0,0,0,0),5000,200))
        try{
            begin(c)
            assertEquals(listOf("start","read","read","read"),calls)
            assertEquals("Stored synthetic reply",c.state.value.timeline.last{it.kind=="reply"}.text)
            assertEquals(1,c.state.value.timeline.count{it.kind=="reply"})
        }finally{scope.cancel()}
    }

    @Test fun persistentNetworkDownStopsWithinBoundedBudgetAndLeavesComposerEditable(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val calls=mutableListOf<String>()
        val c=HermesConversationController(scope,{Memory()},{body->
            calls+=body.getString("op")
            throw java.io.IOException("private detail")
        },{now},recoveryTiming=HermesChatRecoveryTiming(listOf(0,0,0,0),1000,50))
        try{
            begin(c)
            assertEquals(listOf("start","read","read","read","read"),calls)
            assertFalse(c.state.value.busy)
            val text=c.state.value.timeline.last().text
            assertTrue(text.startsWith("I couldn’t confirm"))
            assertNotNull(c.state.value.attemptKey)
            c.edit("A genuinely different message");assertEquals("A genuinely different message",c.state.value.draft)
            assertFalse(c.state.value.notice.contains("private detail"))
        }finally{scope.cancel()}
    }

    @Test fun cancellationAndNewTurnFenceOldRecovery(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val gate=CompletableDeferred<Unit>();val calls=mutableListOf<String>();var first:JSONObject?=null
        val c=HermesConversationController(scope,{Memory()},{body->
            calls+=body.getString("op")
            if(calls.size==1){first=body;throw java.io.IOException("private detail")}
            if(body.getString("op")=="read" && body.getString("rootKey")==first!!.getString("key")){
                withContext(NonCancellable){gate.await()};finalReply(first!!)
            } else finalReply(body)
        },{now},recoveryTiming=HermesChatRecoveryTiming(listOf(0,0,0,0),5000,200))
        try{
            begin(c);assertEquals(listOf("start","read"),calls)
            c.edit("New explicit topic");c.send()
            val before=c.state.value;gate.complete(Unit)
            // allow non-cooperative late read response to arrive and be fenced
            kotlinx.coroutines.runBlocking { kotlinx.coroutines.yield(); kotlinx.coroutines.delay(50); kotlinx.coroutines.yield() }
            assertEquals(before,c.state.value)
            assertTrue(c.state.value.timeline.none{it.id=="reply:${first!!.getString("key")}"})
            assertEquals(listOf("start","read","start"),calls)
        }finally{gate.complete(Unit);scope.cancel()}
    }
    @Test fun aRunningReceiptStaysOpenAndAProvenNoWriteFailureCanBeSentManually(){
        val scope=CoroutineScope(Dispatchers.Unconfined)
        val calls=mutableListOf<JSONObject>()
        lateinit var start:JSONObject
        val failure="Hermes stopped before attempting any changes."
        val c=HermesConversationController(scope,{Memory()},{body->
            calls+=body
            when(calls.size){
                1->{
                    start=body
                    finalReply(start).apply{
                        getJSONObject("receipt").put("outcome","uncertain")
                        getJSONObject("assistantReply").put("text","The reply was interrupted.")
                    }
                }
                2->finalReply(start).apply{
                    remove("assistantReply")
                    getJSONObject("receipt").put("outcome","uncertain")
                }
                3->finalReply(start).apply{
                    getJSONObject("receipt").put("outcome","failed")
                    getJSONObject("assistantReply").put("text",failure)
                }
                else->finalReply(body)
            }
        },{now})
        try{
            begin(c)
            c.readReceipt()
            assertEquals(HermesReceiptCheck.UNCONFIRMED,c.state.value.receiptCheck)
            assertEquals("The reply was interrupted.",c.state.value.timeline.last().text)
            c.readReceipt()
            assertEquals(failure,c.state.value.timeline.last().text)
            assertEquals(listOf("start","read","read"),calls.map{it.getString("op")})
            c.edit("Synthetic question")
            c.send()
            assertEquals("start",calls.last().getString("op"))
            assertNotEquals(start.getString("key"),calls.last().getString("key"))
        }finally{scope.cancel()}
    }
}
