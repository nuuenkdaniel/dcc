package online.captnuu.dcc
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
class HermesStateTest {
    private class Memory:SessionStorage {var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){raw=null}}
    private val owner="a".repeat(64)
    private fun question(key:String)=JSONObject("""{"version":1,"rootKey":"$key","turnKey":"$key","expiresAt":9999999999999,"questions":1,"original":"Study 3 CSE354 chunks today in my tasks","question":{"id":"${"b".repeat(64)}","reason":"task_topics","question":"Should these study chunks use specific topics, or just general chunks? Give the task names, or say “just general chunks”."},"receipt":{"version":1,"key":"$key","outcome":"question","line":"Details needed","verified":0,"expected":null,"targets":[]}}""")
    @Test fun offlineNeverQueuesEffectsAndEncryptedDraftRestores(){
        val memory=Memory();var calls=0;val scope=CoroutineScope(Dispatchers.Unconfined)
        val controller=HermesConversationController(scope,{memory},{calls++;error("Offline")})
        controller.bind(owner);controller.edit("Study 3 CSE354 chunks today in my tasks");controller.send()
        assertEquals(0,calls);assertTrue(controller.state.value.notice.contains("online"))
        val restored=HermesConversationController(scope,{memory},{error("No automatic writes")});restored.bind(owner)
        assertEquals(controller.state.value.draft,restored.state.value.draft);assertNull(restored.state.value.rootKey)
        scope.cancel()
    }
    @Test fun lateCallbackCannotOverwriteEditedDraftOrDifferentAccount(){
        val stores=mutableMapOf<String,Memory>();val gate=CompletableDeferred<JSONObject>();var key="";val scope=CoroutineScope(Dispatchers.Unconfined)
        val controller=HermesConversationController(scope,{stores.getOrPut(it){Memory()}},{body->key=body.getString("key");withContext(NonCancellable){gate.await()}})
        controller.bind(owner);controller.availability(true);controller.edit("Study 3 CSE354 chunks today in my tasks");controller.send()
        assertTrue(controller.state.value.busy);controller.edit("My edited draft");controller.unbind();controller.bind("c".repeat(64))
        gate.complete(question(key));assertEquals("",controller.state.value.draft);assertNull(controller.state.value.view)
        controller.unbind();controller.bind(owner);assertEquals("My edited draft",controller.state.value.draft)
        scope.cancel()
    }
    @Test fun processRestoreReadsOnlyAndPendingQuestionRetainsOriginal(){
        val memory=Memory();val scope=CoroutineScope(Dispatchers.Unconfined);val operations=mutableListOf<String>();var savedKey=""
        val controller=HermesConversationController(scope,{memory},{body->operations+=body.getString("op");savedKey=body.getString("key");question(savedKey)})
        controller.bind(owner);controller.availability(true);controller.edit("Study 3 CSE354 chunks today in my tasks");controller.send()
        assertEquals(listOf("start"),operations);assertTrue(controller.state.value.view!!.contains("task_topics"))
        controller.edit("Unsent answer survives restore")
        val restored=HermesConversationController(scope,{memory},{body->operations+=body.getString("op");assertFalse(body.has("answer"));question(savedKey)})
        restored.bind(owner);restored.readReceipt();assertEquals(listOf("start","read"),operations)
        assertEquals("",restored.state.value.draft)
        assertEquals("Study 3 CSE354 chunks today in my tasks",JSONObject(restored.state.value.view!!).getString("original"))
        assertEquals("Unsent answer survives restore",restored.state.value.answer)
        assertNull(restored.state.value.attemptKey);scope.cancel()
    }
    @Test fun expiredTextIsDroppedButReceiptRemains(){
        val memory=Memory();var now=1000L;val scope=CoroutineScope(Dispatchers.Unconfined)
        val controller=HermesConversationController(scope,{memory},{body->question(body.getString("key")).put("expiresAt",2000L)}, {now})
        controller.bind(owner);controller.availability(true);controller.edit("Study 3 CSE354 chunks today in my tasks");controller.send()
        now=3000L
        val restored=HermesConversationController(scope,{memory},{error("No automatic resend")},{now});restored.bind(owner)
        assertEquals("",restored.state.value.draft);assertNull(restored.state.value.view);assertNotNull(restored.state.value.receipt);scope.cancel()
    }
    @Test fun accountReturnAndNewDraftInvalidateReadbackFenceEvenWhenReceiptKeyCouldMatch(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val stores=mutableMapOf<String,Memory>()
        val controller=HermesConversationController(scope,{stores.getOrPut(it){Memory()}},{error("No network")})
        controller.bind(owner);val first=controller.ownerFence()!!
        assertTrue(controller.isCurrent(first));controller.edit("New draft");assertFalse(controller.isCurrent(first))
        val edited=controller.ownerFence()!!;controller.unbind();controller.bind("c".repeat(64));controller.unbind();controller.bind(owner)
        assertFalse(controller.isCurrent(edited));scope.cancel()
    }
    @Test fun sharedServerJsonQuestionAnswerCompletionClearsTranscriptAndStartsFresh(){
        val fixture=hermesWireFixtures();val memory=Memory();val scope=CoroutineScope(Dispatchers.Unconfined)
        val requests=mutableListOf<JSONObject>()
        val controller=HermesConversationController(scope,{memory},{body->
            requests+=JSONObject(body.toString());assertEquals(owner,body.getString("workspaceOwner"))
            val reply=JSONObject(fixture.getJSONObject(if(body.getString("op")=="start")"question" else "complete").toString())
            reply.put("rootKey",if(body.has("rootKey"))body.getString("rootKey") else body.getString("key")).put("turnKey",body.getString("key"))
            reply.getJSONObject("receipt").put("key",body.getString("key"));reply
        },{1794016800000L})
        try{
            controller.bind(owner);controller.availability(true);controller.edit(fixture.getJSONObject("question").getString("original"));controller.send()
            val parent=controller.state.value.view!!.let{JSONObject(it)}
            controller.edit("Lectures, practice problems, and review");controller.send()
            assertEquals(listOf("start","answer"),requests.map{it.getString("op")})
            assertEquals(parent.getString("rootKey"),requests[1].getString("rootKey"));assertEquals(parent.getString("turnKey"),requests[1].getString("parentKey"));assertEquals(parent.getJSONObject("question").getString("id"),requests[1].getString("questionId"))
            assertEquals("",controller.state.value.draft);assertEquals("",controller.state.value.answer);assertNull(controller.state.value.view);assertNull(controller.state.value.rootKey)
            assertEquals(3,JSONObject(controller.state.value.receipt!!).getInt("verified"));assertFalse(memory.raw!!.contains(fixture.getJSONObject("question").getString("original")))
            controller.edit("Add 1 task today: Fresh request");assertNull(controller.state.value.rootKey);assertEquals(2,requests.size)
        }finally{scope.cancel()}
    }
    @Test fun receiptOnlyConfirmationDoesNotClearNewlyEditedDraft(){
        val memory=Memory();val scope=CoroutineScope(Dispatchers.Unconfined);var key="";val operations=mutableListOf<String>()
        val controller=HermesConversationController(scope,{memory},{body->
            operations+=body.getString("op");val v=JSONObject(hermesWireFixtures().getJSONObject("complete").toString())
            if(body.getString("op")=="start")key=body.getString("key")
            v.put("rootKey",key).put("turnKey",key);val r=v.getJSONObject("receipt").put("key",key)
            if(operations.size==1)r.put("outcome","uncertain").put("verified",0).put("targets",org.json.JSONArray()).put("line","Readback unavailable")
            v
        },{1794016800000L})
        try{
            controller.bind(owner);controller.availability(true);controller.edit("Add 3 tasks today: Lectures; practice problems; review");controller.send()
            controller.edit("My new draft");controller.readReceipt()
            assertEquals(listOf("start","read"),operations);assertEquals("My new draft",controller.state.value.draft);assertNull(controller.state.value.rootKey)
            assertEquals("complete",JSONObject(controller.state.value.receipt!!).getString("outcome"))
        }finally{scope.cancel()}
    }
    private fun restoredAnswerFencesOlderReceiptRead(failRead:Boolean){
        val fixture=hermesWireFixtures();val memory=Memory();val scope=CoroutineScope(Dispatchers.Unconfined)
        val oldRead=CompletableDeferred<JSONObject>();val operations=mutableListOf<String>();var root=""
        val original=HermesConversationController(scope,{memory},{body->
            root=body.getString("key")
            JSONObject(fixture.getJSONObject("question").toString()).put("rootKey",root).put("turnKey",root).also{it.getJSONObject("receipt").put("key",root)}
        },{1794016800000L})
        try{
            original.bind(owner);original.availability(true);original.edit(fixture.getJSONObject("question").getString("original"));original.send()
            original.edit("Lectures, practice problems, and review")
            val restored=HermesConversationController(scope,{memory},{body->
                operations+=body.getString("op")
                if(body.getString("op")=="read")withContext(NonCancellable){oldRead.await()}
                else{
                    assertEquals("answer",body.getString("op"));assertEquals(root,body.getString("rootKey"))
                    assertEquals("Lectures, practice problems, and review",body.getString("answer"))
                    JSONObject(fixture.getJSONObject("complete").toString()).put("rootKey",root).put("turnKey",body.getString("key")).also{it.getJSONObject("receipt").put("key",body.getString("key"))}
                }
            },{1794016800000L})
            restored.bind(owner);restored.availability(true);restored.readReceipt()
            restored.send() // Submit the restored answer WITHOUT edit().
            val completed=restored.state.value;val persisted=memory.raw
            assertEquals("complete",JSONObject(completed.receipt!!).getString("outcome"))
            assertEquals(3,JSONObject(completed.receipt).getInt("verified"))
            if(failRead)oldRead.completeExceptionally(IllegalStateException("Old read failed"))
            else oldRead.complete(JSONObject(fixture.getJSONObject("question").toString()).put("rootKey",root).put("turnKey",root).also{it.getJSONObject("receipt").put("key",root)})
            assertEquals(completed,restored.state.value);assertEquals(persisted,memory.raw)
            assertEquals("",restored.state.value.draft);assertEquals("",restored.state.value.answer)
            assertNull(restored.state.value.view);assertNull(restored.state.value.rootKey);assertFalse(restored.state.value.busy)
            assertEquals("",restored.state.value.notice);assertEquals(listOf("read","answer"),operations)
        }finally{oldRead.cancel();scope.cancel()}
    }
    @Test fun restoredAnswerIgnoresOldQuestionReadAfterCompletion(){restoredAnswerFencesOlderReceiptRead(false)}
    @Test fun restoredAnswerIgnoresOldReadErrorAfterCompletion(){restoredAnswerFencesOlderReceiptRead(true)}
}
