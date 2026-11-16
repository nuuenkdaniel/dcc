package online.captnuu.dcc

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class HermesSubmissionTest {
    private val owner="a".repeat(64)
    private val text="i have a CSE 354 exam coming up. I broke my studying into chunks. Im doing 3 chunks today. Can you throw that on my tasks?"
    private val now=1794016800000L
    private class Memory:SessionStorage {
        var raw:String?=null;var fail=false
        override fun read()=raw
        override fun write(value:String){check(!fail){"Synthetic storage failure"};raw=value}
        override fun clear(){raw=null}
    }
    private fun reply(body:JSONObject,kind:String="complete"):JSONObject {
        val v=JSONObject(hermesWireFixtures().getJSONObject(kind).toString())
        val key=body.getString("key")
        v.put("rootKey",body.optString("rootKey",key)).put("turnKey",key)
        v.getJSONObject("receipt").put("key",key)
        return v
    }
    @Test fun durableDispatchClearsEditorShowsExactSubmittedSnapshotAndDoubleEnterCannotWriteAgain(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();val gate=CompletableDeferred<JSONObject>();val bodies=mutableListOf<JSONObject>()
        val controller=HermesConversationController(scope,{memory},{body->bodies+=JSONObject(body.toString());gate.await()},{now})
        try{
            controller.bind(owner);controller.availability(true);controller.edit(text);controller.send();controller.send()
            val s=controller.state.value
            assertEquals("",s.draft);assertEquals("",s.answer);assertTrue(s.busy);assertNull(s.receipt)
            assertEquals(text,s.submitted!!.text);assertEquals(s.attemptKey,s.submitted.turnKey);assertEquals(s.rootKey,s.submitted.rootKey)
            assertEquals(1,bodies.size);assertEquals(text,bodies.single().getString("prompt"))
            assertEquals("",JSONObject(memory.raw!!).getString("draft"));assertEquals(text,JSONObject(memory.raw!!).getJSONObject("submitted").getString("text"))
            gate.complete(reply(bodies.single()))
            assertEquals("complete",JSONObject(controller.state.value.receipt!!).getString("outcome"))
            assertEquals(text,controller.state.value.submitted!!.text);assertNull(controller.state.value.rootKey)
        }finally{scope.cancel()}
    }
    @Test fun preDispatchPersistenceOrValidationFailureRetainsEditorAndCreatesNoSentItem(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();var calls=0
        val controller=HermesConversationController(scope,{memory},{calls++;error("Must not dispatch")},{now})
        try{
            controller.bind(owner);controller.availability(true);controller.edit(text);memory.fail=true;controller.send()
            assertEquals(text,controller.state.value.draft);assertNull(controller.state.value.submitted);assertNull(controller.state.value.attemptKey)
            assertTrue(controller.state.value.notice.contains("Nothing sent"));assertEquals(0,calls)
            memory.fail=false;controller.edit("界".repeat(3000));assertEquals(text,controller.state.value.draft);assertEquals(0,calls)
        }finally{scope.cancel()}
    }
    @Test fun ackLossInvalidViewAndPartialKeepSubmittedIdentityWithoutPuttingTextBackOrRetrying(){
        for(mode in listOf("ack-loss","invalid-view","partial","failed")){
            val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();var calls=0
            val controller=HermesConversationController(scope,{memory},{body->
                calls++
                when(mode){
                    "ack-loss"->error("Synthetic acknowledgement lost")
                    "invalid-view"->JSONObject().put("done",true)
                    else->reply(body).also { v->
                        val r=v.getJSONObject("receipt");r.put("outcome",mode).put("verified",if(mode=="partial")2 else 0).put("line","Not fully confirmed")
                        if(mode=="partial")r.getJSONArray("targets").remove(2) else r.put("targets",JSONArray())
                    }
                }
            },{now})
            try{
                controller.bind(owner);controller.availability(true);controller.edit(text);controller.send()
                val s=controller.state.value
                assertEquals("",s.draft);assertFalse(s.busy);assertEquals(text,s.submitted!!.text)
                assertEquals(s.submitted.turnKey,s.attemptKey);assertEquals(s.submitted.rootKey,s.rootKey)
                controller.send();assertEquals(1,calls)
                if(mode=="ack-loss"||mode=="invalid-view"){assertNull(s.receipt);assertTrue(s.notice.contains("may have saved"))}
                else assertEquals(mode,JSONObject(s.receipt!!).getString("outcome"))
            }finally{scope.cancel()}
        }
    }
    @Test fun typingDuringDispatchDoesNotCancelOperationAndLateReceiptNeverClobbersFreshDraft(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();val gate=CompletableDeferred<JSONObject>();var body:JSONObject?=null;var calls=0
        val controller=HermesConversationController(scope,{memory},{input->calls++;body=JSONObject(input.toString());gate.await()},{now})
        try{
            controller.bind(owner);controller.availability(true);controller.edit(text);controller.send()
            val key=controller.state.value.attemptKey
            controller.edit("A new unsent draft");assertTrue(controller.state.value.busy)
            controller.send();assertEquals(1,calls)
            gate.complete(reply(body!!))
            assertEquals("A new unsent draft",controller.state.value.draft)
            assertEquals(key,JSONObject(controller.state.value.receipt!!).getString("key"))
            assertEquals(key,controller.state.value.submitted!!.turnKey);assertFalse(controller.state.value.busy)
        }finally{scope.cancel()}
    }
    @Test fun reloadIsUncertainAndReceiptOnlyReadPreservesFreshDraftAndNeverResends(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory()
        val controller=HermesConversationController(scope,{memory},{error("ACK lost")},{now})
        try{
            controller.bind(owner);controller.availability(true);controller.edit(text);controller.send();controller.edit("Fresh offline draft")
            val submitted=controller.state.value.submitted!!;val operations=mutableListOf<String>()
            val restored=HermesConversationController(scope,{memory},{body->
                operations+=body.getString("op");assertFalse(body.has("prompt"));assertFalse(body.has("answer"))
                reply(JSONObject().put("key",submitted.turnKey).put("rootKey",submitted.rootKey))
            },{now})
            restored.bind(owner);assertTrue(operations.isEmpty());assertFalse(restored.state.value.busy)
            assertEquals(submitted,restored.state.value.submitted);assertEquals("Fresh offline draft",restored.state.value.draft)
            restored.readReceipt()
            assertEquals(listOf("read"),operations);assertEquals("Fresh offline draft",restored.state.value.draft)
            assertEquals("complete",JSONObject(restored.state.value.receipt!!).getString("outcome"))
        }finally{scope.cancel()}
    }
    @Test fun receiptRecheckAfterStartTimeoutImmediatelyShowsCheckingThenIdenticalUnconfirmedResultWithoutReplay(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();val readGate=CompletableDeferred<JSONObject>()
        val operations=mutableListOf<String>();var originalBody:JSONObject?=null;var reads=0
        fun uncertainReply()=reply(originalBody!!).put("expiresAt",now+HERMES_TTL_MS).also{v->
            v.getJSONObject("receipt").put("outcome","uncertain").put("expected",JSONObject.NULL).put("verified",0)
                .put("targets",JSONArray()).put("line","Earlier effects remain unconfirmed.")
        }
        val controller=HermesConversationController(scope,{memory},{body->
            operations+=body.getString("op")
            when(body.getString("op")){
                "start"->{originalBody=JSONObject(body.toString());throw java.net.SocketTimeoutException("Synthetic start timeout")}
                "read"->{reads++;if(reads==1)uncertainReply() else readGate.await()}
                else->error("Unexpected synthetic operation")
            }
        },{now})
        try{
            controller.bind(owner);controller.availability(true);controller.edit("Synthetic earlier request");controller.send()
            val originalClaim=controller.state.value.submitted!!
            controller.edit("A different fresh synthetic draft")
            // Establish the earlier uncertain receipt; the next lookup returns
            // exactly the same valid view, so feedback cannot rely on a diff.
            controller.readReceipt()
            val identicalView=uncertainReply();val earlierReceipt=controller.state.value.receipt
            controller.readReceipt()
            assertTrue("Receipt lookup must immediately show Checking receipt while the read is suspended",
                controller.state.value.notice.contains("Checking receipt",ignoreCase=true))
            controller.readReceipt() // A repeated tap must not create another read.
            assertEquals(listOf("start","read","read"),operations)
            assertEquals("A different fresh synthetic draft",controller.state.value.draft)
            readGate.complete(identicalView)
            val checked=controller.state.value
            assertTrue("An unchanged uncertain receipt needs a visible checked-but-still-unconfirmed result",
                checked.notice.contains("checked",ignoreCase=true)&&
                    (checked.notice.contains("unconfirmed",ignoreCase=true)||checked.notice.contains("uncertain",ignoreCase=true)))
            assertFalse(checked.notice.contains("Checking receipt",ignoreCase=true))
            assertEquals(earlierReceipt,checked.receipt)
            assertEquals(originalClaim,checked.submitted);assertEquals(originalClaim.rootKey,checked.rootKey);assertEquals(originalClaim.turnKey,checked.attemptKey)
            assertEquals("A different fresh synthetic draft",checked.draft)
            assertEquals(listOf("start","read","read"),operations)
        }finally{readGate.cancel();scope.cancel()}
    }
    @Test fun answerSubmissionKeepsParentQuestionIdentityAndClearsOnlyItsEditor(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();val gate=CompletableDeferred<JSONObject>();val bodies=mutableListOf<JSONObject>()
        val controller=HermesConversationController(scope,{memory},{body->
            bodies+=JSONObject(body.toString());if(body.getString("op")=="start")reply(body,"question") else gate.await()
        },{now})
        try{
            controller.bind(owner);controller.availability(true);controller.edit(text);controller.send()
            val q=JSONObject(controller.state.value.view!!)
            controller.edit("Lectures; practice problems; review");controller.send();controller.send()
            val sent=controller.state.value.submitted!!
            assertTrue(sent.isAnswer);assertEquals("Lectures; practice problems; review",sent.text)
            assertEquals(q.getString("turnKey"),sent.parentKey);assertEquals(q.getJSONObject("question").getString("id"),sent.questionId)
            assertEquals("",controller.state.value.answer);assertEquals("",controller.state.value.draft);assertEquals(2,bodies.size)
            assertEquals(sent.parentKey,bodies[1].getString("parentKey"));assertEquals(sent.questionId,bodies[1].getString("questionId"))
            gate.complete(reply(bodies[1]));assertNull(controller.state.value.view)
            assertEquals(sent.turnKey,JSONObject(controller.state.value.receipt!!).getString("key"))
        }finally{scope.cancel()}
    }
    @Test fun legacyDraftsMigrateWithoutResendingAndExpiredSubmittedTextNeverReappears(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();val stores=mutableMapOf(owner to memory);var clock=now
        val key="legacy_request_key_01"
        memory.raw=JSONObject().put("owner",owner).put("clientId","11111111-1111-4111-a111-111111111111").put("expiresAt",now+HERMES_TTL_MS)
            .put("usedChars",text.length).put("usedBytes",text.toByteArray().size).put("draft",text).put("answer","").put("rootKey",key).put("attemptKey",key).toString()
        val controller=HermesConversationController(scope,{stores.getOrPut(it){Memory()}},{error("No automatic writes")},{clock})
        try{
            controller.bind(owner);assertEquals(text,controller.state.value.submitted!!.text);assertEquals("",controller.state.value.draft)
            controller.edit("A retained new draft");controller.unbind();controller.bind("c".repeat(64))
            assertNull(controller.state.value.submitted);assertEquals("",controller.state.value.draft)
            clock+=HERMES_TTL_MS+1;controller.unbind();controller.bind(owner)
            assertEquals("",controller.state.value.submitted!!.text);assertEquals(key,controller.state.value.submitted!!.turnKey)
            assertEquals("",controller.state.value.draft);assertNull(controller.state.value.view)
            assertFalse(memory.raw!!.contains(text))
        }finally{scope.cancel()}
    }
    @Test fun cancelPreservesFreshDraftAndOldReceiptReadCannotAttachToTheNextSubmission(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();val read=CompletableDeferred<JSONObject>();val next=CompletableDeferred<JSONObject>()
        var first:JSONObject?=null;var second:JSONObject?=null;val operations=mutableListOf<String>()
        val controller=HermesConversationController(scope,{memory},{body->
            operations+=body.getString("op")
            when(body.getString("op")){
                "cancel"->reply(first!!).also{it.getJSONObject("receipt").put("outcome","uncertain").put("verified",0).put("targets",JSONArray()).put("line","Earlier effects remain unconfirmed")}
                "read"->read.await()
                else->if(first==null){first=JSONObject(body.toString());error("ACK lost")}else{second=JSONObject(body.toString());next.await()}
            }
        },{now})
        try{
            controller.bind(owner);controller.availability(true);controller.edit(text);controller.send();controller.edit("Fresh second request")
            controller.newRequest();assertEquals("Fresh second request",controller.state.value.draft)
            assertNull(controller.state.value.rootKey);assertTrue(controller.state.value.submitted!!.closed)
            controller.readReceipt();controller.send()
            val secondState=controller.state.value
            assertEquals("Fresh second request",secondState.submitted!!.text);assertTrue(secondState.busy)
            read.complete(reply(first!!));assertEquals(secondState,controller.state.value)
            next.complete(reply(second!!));assertEquals(second!!.getString("key"),JSONObject(controller.state.value.receipt!!).getString("key"))
            assertEquals(listOf("start","cancel","read","start"),operations)
            controller.dismiss();assertNull(controller.state.value.receipt);assertNull(controller.state.value.submitted)
        }finally{scope.cancel()}
    }
    @Test fun oldApkEditedAnswerAfterAnUncertainSubmissionRestoresAsFreshTextNotAnInventedSentPayload(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();var calls=0
        val q=JSONObject(hermesWireFixtures().getJSONObject("question").toString())
        memory.raw=JSONObject().put("owner",owner).put("clientId","11111111-1111-4111-a111-111111111111").put("expiresAt",now+HERMES_TTL_MS)
            .put("usedChars",200).put("usedBytes",200).put("draft",q.getString("original")).put("answer","An edited unsent draft")
            .put("view",q).put("receipt",q.getJSONObject("receipt")).put("rootKey",q.getString("rootKey")).put("attemptKey","legacy_answer_key_01").put("editedAfterSubmit",true).toString()
        val controller=HermesConversationController(scope,{memory},{calls++;error("No automatic resend")},{now})
        try{
            controller.bind(owner)
            assertEquals("An edited unsent draft",controller.state.value.draft);assertEquals("",controller.state.value.answer)
            assertNull(controller.state.value.submitted);assertEquals("legacy_answer_key_01",controller.state.value.attemptKey)
            assertEquals(q.getString("rootKey"),controller.state.value.rootKey);assertEquals(0,calls)
        }finally{scope.cancel()}
    }
}
