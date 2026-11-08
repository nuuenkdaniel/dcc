package online.captnuu.dcc

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Synthetic controller/transport only: no HTTP endpoint, provider or real tasks. */
class HermesReceiptJourneyTest {
    private class Memory:SessionStorage{var raw:String?=null;var fail=false;override fun read()=raw;override fun write(value:String){if(fail)error("Synthetic write failure");raw=value};override fun clear(){error("No clear")}}
    private val owner="a".repeat(64)
    private val now=1794016800000L
    private fun view(key:String,outcome:String="uncertain",expiry:Long=now+HERMES_TTL_MS)=JSONObject()
        .put("version",1).put("rootKey",key).put("turnKey",key).put("expiresAt",expiry).put("questions",0)
        .put("receipt",JSONObject().put("version",1).put("key",key).put("outcome",outcome).put("line","Synthetic recorded result")
            .put("verified",0).put("expected",JSONObject.NULL).put("targets",JSONArray()))

    @Test fun checkedUnconfirmedThenDurableCloseRequiresSeparateSendWithSameClientAndNewRoot(){
        val memory=Memory();val scope=CoroutineScope(Dispatchers.Unconfined);val calls=mutableListOf<JSONObject>();var old=""
        val c=HermesConversationController(scope,{memory},{body->
            calls+=JSONObject(body.toString())
            if(body.getString("op")=="start"){if(old.isEmpty())old=body.getString("key");throw java.net.SocketTimeoutException("Synthetic timeout")}
            view(body.getString("rootKey"))
        },{now})
        try{
            c.bind(owner);c.availability(true);c.edit("Synthetic original request");c.send()
            val claim=c.state.value.submitted!!;val client=calls[0].getString("clientId")
            c.edit("Different synthetic request");c.edit("");assertEquals("",c.state.value.draft);c.edit("Different synthetic request")
            c.readReceipt();assertEquals(HermesReceiptCheck.UNCONFIRMED,c.state.value.receiptCheck)
            assertEquals(claim,c.state.value.submitted);assertEquals(old,c.state.value.attemptKey)
            c.newRequest() // The explicit close confirmation, never a read side effect.
            assertEquals(listOf("start","read","cancel"),calls.map{it.getString("op")})
            assertNull(c.state.value.rootKey);assertNull(c.state.value.attemptKey);assertTrue(c.state.value.submitted!!.closed)
            assertEquals("Different synthetic request",c.state.value.draft)
            assertEquals(old,c.state.value.submitted!!.turnKey)
            assertEquals(client,JSONObject(memory.raw!!).getString("clientId"))
            c.edit("Synthetic original request");assertTrue(repeatsUnconfirmedHermesRequest(c.state.value));c.send()
            assertEquals(3,calls.size) // An identical unknown request is not a safe retry.
            c.edit("Different synthetic request");c.send()
            assertEquals(listOf("start","read","cancel","start"),calls.map{it.getString("op")})
            val fresh=calls.last();assertEquals(client,fresh.getString("clientId"));assertNotEquals(old,fresh.getString("key"))
            assertEquals("Different synthetic request",fresh.getString("prompt"));assertFalse(fresh.has("answer"))
            val earlier=c.state.value.timeline.single{it.id=="receipt:$old"}
            assertEquals("uncertain",JSONObject(earlier.receipt!!).getString("outcome"));assertFalse(earlier.settled)
        }finally{scope.cancel()}
    }
    @Test fun rootFenceAcknowledgesParentWhenDurableAnswerNeverReachedServerBeforeSeparateFreshSend(){
        val memory=Memory();val scope=CoroutineScope(Dispatchers.Unconfined)
        val calls=mutableListOf<JSONObject>();val closeGate=CompletableDeferred<JSONObject>()
        var parent="";var answer="";var closeSaved=false
        lateinit var c:HermesConversationController
        val storage=object:SessionStorage{
            override fun read()=memory.read()
            override fun clear(){error("No clear")}
            override fun write(value:String){
                val saved=JSONObject(value)
                if(saved.optJSONObject("submitted")?.optBoolean("closed")==true){
                    assertEquals(parent,c.state.value.rootKey)
                    assertEquals(answer,c.state.value.attemptKey)
                    assertFalse(saved.has("rootKey"));assertFalse(saved.has("attemptKey"))
                    memory.write(value);closeSaved=true
                }else memory.write(value)
            }
        }
        c=HermesConversationController(scope,{storage},{body->
            calls+=JSONObject(body.toString())
            when(body.getString("op")){
                "start"->if(parent.isEmpty()){
                    parent=body.getString("key")
                    JSONObject(hermesWireFixtures().getJSONObject("question").toString())
                        .put("rootKey",parent).put("turnKey",parent).put("expiresAt",now+HERMES_TTL_MS)
                        .also{it.getJSONObject("receipt").put("key",parent)}
                }else view(body.getString("key"),"read-only")
                "answer"->{
                    answer=body.getString("key")
                    assertEquals(answer,JSONObject(memory.raw!!).getString("attemptKey"))
                    throw java.io.IOException("Synthetic answer never reached server")
                }
                "cancel"->{assertEquals(parent,body.getString("rootKey"));closeGate.await()}
                else->error("Unexpected synthetic operation")
            }
        },{now})
        try{
            c.bind(owner);c.availability(true);c.edit("Synthetic initial request");c.send()
            assertTrue(answering(c.state.value));assertNull(c.state.value.attemptKey)
            c.edit("Synthetic clarification answer");c.send()
            val submitted=c.state.value.submitted!!
            assertTrue(submitted.isAnswer);assertEquals(answer,submitted.turnKey)
            assertEquals(parent,submitted.rootKey);assertEquals(parent,submitted.parentKey)
            assertNotEquals(parent,answer);assertFalse(c.state.value.busy)
            c.edit("Different fresh synthetic request");c.newRequest()
            assertEquals(listOf("start","answer","cancel"),calls.map{it.getString("op")})
            assertEquals(parent,c.state.value.rootKey);assertEquals(answer,c.state.value.attemptKey)
            assertFalse(closeSaved);assertFalse(JSONObject(memory.raw!!).getJSONObject("submitted").optBoolean("closed"))
            val closedParent=view(parent,"uncertain")
            assertFalse(closedParent.has("question"))
            closeGate.complete(closedParent)
            assertNull("A root fence ACK may name the prior parent when the saved answer never reached the server",c.state.value.rootKey)
            assertNull(c.state.value.attemptKey);assertTrue(closeSaved)
            assertEquals("Different fresh synthetic request",c.state.value.draft)
            assertEquals(submitted.copy(closed=true),c.state.value.submitted)
            val unknown=c.state.value.timeline.single{it.turnKey==answer&&it.kind=="unknown"}
            assertFalse(unknown.settled);assertNull(unknown.receipt)
            assertEquals("Synthetic clarification answer",c.state.value.timeline.single{it.turnKey==answer&&it.role=="user"}.text)
            assertEquals(parent,JSONObject(c.state.value.receipt!!).getString("key"))
            val parentReceipt=c.state.value.timeline.single{it.id=="receipt:$parent"}
            assertEquals(parent,JSONObject(parentReceipt.receipt!!).getString("key"))
            assertFalse(c.state.value.timeline.any{it.turnKey==answer&&it.receipt!=null})
            assertEquals(listOf("start","answer","cancel"),calls.map{it.getString("op")})
            val durable=JSONObject(memory.raw!!)
            assertFalse(durable.has("rootKey"));assertFalse(durable.has("attemptKey"))
            assertEquals(answer,durable.getJSONObject("submitted").getString("turnKey"))
            c.send()
            assertEquals(listOf("start","answer","cancel","start"),calls.map{it.getString("op")})
            val fresh=calls.last();val client=calls.first().getString("clientId")
            assertTrue(calls.all{it.getString("clientId")==client})
            assertNotEquals(parent,fresh.getString("key"));assertNotEquals(answer,fresh.getString("key"))
            assertEquals("Different fresh synthetic request",fresh.getString("prompt"))
            assertFalse(fresh.has("answer"));assertFalse(fresh.has("rootKey"));assertFalse(fresh.has("parentKey"))
        }finally{closeGate.cancel();scope.cancel()}
    }
    @Test fun cancelRejectsWrongRootOrUnrelatedTurnEvenWithoutPendingAttempt(){
        for(pending in listOf(false,true))for(wrongRoot in listOf(false,true)){
            val memory=Memory();val scope=CoroutineScope(Dispatchers.Unconfined)
            val calls=mutableListOf<String>();var root=""
            val c=HermesConversationController(scope,{memory},{body->
                calls+=body.getString("op")
                if(body.getString("op")=="start"){
                    root=body.getString("key")
                    if(pending)throw java.io.IOException("Synthetic lost start response")
                    JSONObject(hermesWireFixtures().getJSONObject("question").toString())
                        .put("rootKey",root).put("turnKey",root).put("expiresAt",now+HERMES_TTL_MS)
                        .also{it.getJSONObject("receipt").put("key",root)}
                }else{
                    assertEquals("cancel",body.getString("op"))
                    if(wrongRoot)view(root).put("rootKey","synthetic_unrelated_root_01")
                    else view("synthetic_unrelated_turn_01").put("rootKey",root)
                }
            },{now})
            try{
                c.bind(owner);c.availability(true);c.edit("Synthetic initial request");c.send()
                val before=c.state.value;val saved=memory.raw
                c.newRequest()
                assertEquals(root,c.state.value.rootKey);assertEquals(before.attemptKey,c.state.value.attemptKey)
                assertEquals(before.submitted,c.state.value.submitted);assertEquals(before.receipt,c.state.value.receipt)
                assertEquals(before.timeline,c.state.value.timeline);assertFalse(c.state.value.busy)
                assertEquals(saved,memory.raw);assertEquals(listOf("start","cancel"),calls)
            }finally{scope.cancel()}
        }
    }
    @Test fun closeHttpOrDurabilityFailureCannotUnlockFreshSendOrLoseOldIdentity(){
        for(diskFailure in listOf(false,true)){
            val memory=Memory();val scope=CoroutineScope(Dispatchers.Unconfined);val calls=mutableListOf<String>();var key=""
            val c=HermesConversationController(scope,{memory},{body->calls+=body.getString("op");if(body.getString("op")=="start"){key=body.getString("key");error("Synthetic start failure")};if(!diskFailure)throw HermesHttpFailure();memory.fail=true;view(key)},{now})
            try{
                c.bind(owner);c.availability(true);c.edit("Earlier synthetic request");c.send();c.edit("Different fresh draft")
                val before=memory.raw;c.newRequest()
                assertEquals(key,c.state.value.rootKey);assertEquals(key,c.state.value.attemptKey);assertEquals(key,c.state.value.submitted!!.turnKey)
                assertEquals("Different fresh draft",c.state.value.draft);assertFalse(c.state.value.busy)
                if(diskFailure){assertFalse(c.state.value.storageReady);assertEquals(before,memory.raw)}
                c.send();assertEquals(listOf("start","cancel"),calls)
            }finally{scope.cancel()}
        }
    }
    @Test fun everyReadFailureHasFiniteFeedbackAndARecheckCanSucceedWithoutReplay(){
        val failures=listOf(
            HermesHttpFailure() to HermesReceiptCheck.HTTP,HermesHttpFailure(auth=true) to HermesReceiptCheck.AUTH,
            java.io.IOException("Synthetic private diagnostic") to HermesReceiptCheck.NETWORK,
            org.json.JSONException("Synthetic private diagnostic") to HermesReceiptCheck.DECODE,
            java.net.SocketTimeoutException("Synthetic private diagnostic") to HermesReceiptCheck.TIMEOUT)
        for((failure,expected) in failures){
            val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();var key="";var fail=true;val ops=mutableListOf<String>()
            val c=HermesConversationController(scope,{memory},{body->ops+=body.getString("op");if(body.getString("op")=="start"){key=body.getString("key");error("Synthetic start failure")};if(fail)throw failure else view(key)},{now})
            try{
                c.bind(owner);c.availability(true);c.edit("Synthetic request");c.send();c.edit("Fresh synthetic draft")
                c.readReceipt();assertEquals(expected,c.state.value.receiptCheck);assertFalse(c.state.value.receiptChecking)
                assertFalse(c.state.value.notice.contains("private diagnostic"));assertEquals(key,c.state.value.attemptKey)
                fail=false;c.readReceipt();assertEquals(HermesReceiptCheck.UNCONFIRMED,c.state.value.receiptCheck)
                assertEquals("Fresh synthetic draft",c.state.value.draft);assertEquals(listOf("start","read","read"),ops)
            }finally{scope.cancel()}
        }
    }
    @Test fun invalidAndWrongTurnViewsNeverReplaceTheClaimAndSuccessfulReadsAreAcknowledged(){
        for(mode in listOf("invalid","turn","success","expired")){
            val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();var key=""
            val c=HermesConversationController(scope,{memory},{body->
                if(body.getString("op")=="start"){key=body.getString("key");error("Synthetic start failure")}
                when(mode){"invalid"->JSONObject();"turn"->view("synthetic_wrong_turn_01").put("rootKey",key);"success"->view(key,"read-only");else->view(key,expiry=now-1)}
            },{now})
            try{
                c.bind(owner);c.availability(true);c.edit("Synthetic request");c.send();c.edit("Fresh draft");c.readReceipt()
                assertEquals(when(mode){"invalid"->HermesReceiptCheck.INVALID;"turn"->HermesReceiptCheck.CORRELATION;"success"->HermesReceiptCheck.CHECKED;else->HermesReceiptCheck.EXPIRED},c.state.value.receiptCheck)
                assertEquals("Fresh draft",c.state.value.draft)
                if(mode!="success")assertEquals(key,c.state.value.attemptKey)
            }finally{scope.cancel()}
        }
    }
    @Test fun noRequestBlockedStorageAndInactiveScopeTerminateWithoutReadTransport(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();var requests=0
        val c=HermesConversationController(scope,{memory},{requests++;error("Synthetic unavailable")},{now})
        try{
            c.readReceipt();assertEquals(HermesReceiptCheck.AUTH,c.state.value.receiptCheck)
            c.bind(owner);c.readReceipt();assertEquals(HermesReceiptCheck.NO_REQUEST,c.state.value.receiptCheck);assertEquals(0,requests)
            c.availability(true);c.edit("Synthetic request");c.send();scope.cancel();c.readReceipt()
            assertEquals(HermesReceiptCheck.INACTIVE,c.state.value.receiptCheck);assertEquals(1,requests)
            val blocked=Memory().also{it.raw="synthetic invalid JSON"}
            val other=HermesConversationController(scope,{blocked},{requests++;error("No transport")},{now});other.bind(owner);other.readReceipt()
            assertEquals(HermesReceiptCheck.STORAGE,other.state.value.receiptCheck);assertEquals("synthetic invalid JSON",blocked.raw);assertEquals(1,requests)
        }finally{scope.cancel()}
    }
    @Test fun stalledReadIsBoundedAndCanBeRechecked(){runBlocking{
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined);val memory=Memory();val gate=CompletableDeferred<JSONObject>();var key="";var stalled=true;var exited=false
        val c=HermesConversationController(scope,{memory},{body->
            if(body.getString("op")=="start"){key=body.getString("key");error("Synthetic start failure")}
            if(stalled)try{gate.await()}finally{exited=true} else view(key)
        },{now},receiptTimeoutMillis=30)
        try{
            c.bind(owner);c.availability(true);c.edit("Synthetic request");c.send();c.readReceipt()
            withTimeout(2000){c.state.first{it.receiptCheck==HermesReceiptCheck.TIMEOUT}}
            assertTrue(exited);assertFalse(c.state.value.receiptChecking);assertEquals(key,c.state.value.attemptKey)
            stalled=false;c.readReceipt();assertEquals(HermesReceiptCheck.UNCONFIRMED,c.state.value.receiptCheck)
        }finally{scope.cancel()}
    }}
    @Test fun reloadAndOwnerSwitchFenceLateReadFeedbackAndKeepTheStoredClaim(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val stores=mutableMapOf<String,Memory>();val gate=CompletableDeferred<JSONObject>();var key=""
        val initial=HermesConversationController(scope,{stores.getOrPut(it){Memory()}},{body->key=body.getString("key");error("Synthetic lost response")},{now})
        try{
            initial.bind(owner);initial.availability(true);initial.edit("Synthetic old request");initial.send();initial.edit("Fresh retained draft")
            val c=HermesConversationController(scope,{stores.getOrPut(it){Memory()}},{withContext(NonCancellable){gate.await()}},{now})
            c.bind(owner);assertEquals(key,c.state.value.attemptKey);assertEquals("Fresh retained draft",c.state.value.draft)
            c.readReceipt();assertTrue(c.state.value.receiptChecking)
            c.unbind();c.bind("b".repeat(64));val other=c.state.value
            gate.complete(view(key));assertEquals(other,c.state.value)
            assertEquals(key,JSONObject(stores[owner]!!.raw!!).getString("attemptKey"))
        }finally{gate.cancel();scope.cancel()}
    }
    @Test fun lateOldReadCannotAlterTheNewTurnAfterConfirmedClose(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();val oldRead=CompletableDeferred<JSONObject>();val next=CompletableDeferred<JSONObject>();var old="";var fresh=""
        val operations=mutableListOf<String>()
        val c=HermesConversationController(scope,{memory},{body->
            operations+=body.getString("op")
            when(body.getString("op")){
                "read"->withContext(NonCancellable){oldRead.await()}
                "cancel"->view(old)
                else->if(old.isEmpty()){old=body.getString("key");error("Synthetic lost response")}else{fresh=body.getString("key");next.await()}
            }
        },{now})
        try{
            c.bind(owner);c.availability(true);c.edit("Earlier synthetic request");c.send();c.edit("A different synthetic request");c.readReceipt()
            c.newRequest();c.send();val held=c.state.value
            oldRead.complete(view(old,"read-only"));assertEquals(held,c.state.value)
            next.complete(view(fresh,"read-only"));assertEquals(fresh,JSONObject(c.state.value.receipt!!).getString("key"))
            assertEquals(listOf("start","read","cancel","start"),operations)
        }finally{oldRead.cancel();next.cancel();scope.cancel()}
    }
}
