package online.captnuu.dcc

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

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

    @Test fun eligibleOriginalFailuresRecoverOnceAndRetainTheirOwnCategory(){
        for((error,code) in listOf(
            HermesHttpFailure(status=503) to "HTTP 503",
            java.net.SocketTimeoutException("private detail") to "TIMEOUT",
            java.io.IOException("private detail") to "NETWORK",
            org.json.JSONException("private detail") to "DECODE",
            IllegalArgumentException("private detail") to "INVALID"
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
                assertTrue(c.state.value.notice.contains("[$code]"));assertFalse(c.state.value.notice.contains("private detail"))
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
                assertTrue(text.contains(if(error is HermesHttpFailure)"[AUTH" else "[CANCELLED]"))
                assertFalse(text.contains("private detail"));assertNotNull(c.state.value.attemptKey)
            }finally{scope.cancel()}
        }
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
            },{now})
            try{
                begin(c);assertEquals(listOf("start","read"),calls);assertFalse(c.state.value.busy)
                assertTrue(c.state.value.timeline.none{it.kind=="reply"});assertNotNull(c.state.value.attemptKey)
                val code=when(kind){"running"->"NO_FINAL";"expired"->"EXPIRED";"decode"->"DECODE";"http"->"HTTP 500";else->"INVALID"}
                val text=c.state.value.timeline.last().text
                assertTrue(text.contains("[NETWORK]"));assertTrue(text.contains("[$code]"));assertFalse(text.contains("private"))
                val reopened=HermesConversationController(scope,{saved},{error("No replay")},{now});reopened.bind(owner)
                assertEquals(listOf("start","read"),calls)
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
            assertTrue(c.state.value.timeline.last().text.contains("[STORAGE]"))
            assertTrue(c.state.value.timeline.none{it.kind=="reply"})
            assertTrue(JSONObject(saved.raw!!).has("attemptKey"))
        }finally{scope.cancel()}
    }

    @Test fun recoveryWatchdogTerminatesOneSuspendedRead()=runBlocking {
        val scope=CoroutineScope(Dispatchers.Unconfined);val calls=mutableListOf<String>();val done=CompletableDeferred<Unit>()
        val c=HermesConversationController(scope,{Memory()},{body->
            calls+=body.getString("op")
            if(calls.size==1)throw java.io.IOException("private detail")
            try{awaitCancellation()}finally{done.complete(Unit)}
        },{now},receiptTimeoutMillis=20)
        try{
            begin(c);withTimeout(2000){done.await();while(c.state.value.timeline.last().kind!="unknown")delay(1)}
            assertEquals(listOf("start","read"),calls);assertFalse(c.state.value.busy)
            assertTrue(c.state.value.timeline.last().text.contains("[TIMEOUT]"))
        }finally{scope.cancel()}
    }

    @Test fun newerSendAndOwnerSwitchFenceNonCooperativeLateReads(){
        for(switchOwner in listOf(false,true)){
            val scope=CoroutineScope(Dispatchers.Unconfined);val gate=CompletableDeferred<Unit>();val saved=Memory()
            val calls=mutableListOf<String>();var first:JSONObject?=null
            val c=HermesConversationController(scope,{saved},{body->
                calls+=body.getString("op")
                if(calls.size==1){first=body;throw java.io.IOException("private detail")}
                if(body.getString("op")=="read")withContext(NonCancellable){gate.await();finalReply(first!!)}
                else finalReply(body)
            },{now})
            try{
                begin(c);assertEquals(listOf("start","read"),calls)
                if(switchOwner){c.unbind();c.bind("b".repeat(64));c.edit("Other owner draft")}
                else{c.edit("New explicit topic");c.send();c.edit("Newer editable draft")}
                val before=c.state.value
                gate.complete(Unit)
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
        },{now})
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
            },{now})
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
        },{now})
        try{
            begin(c);assertEquals(listOf("start","read"),calls)
            assertFalse(c.state.value.storageReady);assertNotNull(c.state.value.attemptKey)
            assertFalse(c.state.value.submitted!!.closed)
            assertTrue(c.state.value.timeline.none{it.kind=="reply"})
            assertTrue(c.state.value.timeline.last().text.contains("[NETWORK]"))
            assertTrue(c.state.value.timeline.last().text.contains("[STORAGE]"))
            assertTrue(JSONObject(saved.raw!!).has("attemptKey"))
        }finally{scope.cancel()}
    }
}
