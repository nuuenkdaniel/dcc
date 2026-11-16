package online.captnuu.dcc

import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class HermesAssistantReplyTest {
    private class Memory:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){raw=null}}
    private val time=1794016800000L
    private fun reply(text:String)=JSONObject().put("version",1).put("text",text)
    @Test fun strictBoundedUnicodeDisplayCodec(){
        for(text in listOf("café 🙂","a".repeat(2048),"界".repeat(1365)))assertTrue(validHermesAssistantReply(reply(text)))
        for(text in listOf(""," ","a".repeat(2049),"界".repeat(1366),"\ud800","x\u0000"))assertFalse(validHermesAssistantReply(reply(text)))
        assertFalse(validHermesAssistantReply(reply("Done").put("targets",org.json.JSONArray())))
        assertFalse(validHermesAssistantReply(reply("Done").put("version",2)))
    }
    @Test fun actualReplyIsOnceOnlyRestorableAndCannotCompleteUncertainReceipt(){
        val memory=Memory();val scope=CoroutineScope(Dispatchers.Unconfined);var sent:JSONObject?=null
        fun view(body:JSONObject)=JSONObject(hermesWireFixtures().getJSONObject("complete").toString()).also{v->
            val key=if(body.getString("op")=="read")sent!!.getString("key") else body.getString("key")
            v.put("rootKey",key).put("turnKey",key).put("expiresAt",time+HERMES_TTL_MS).put("chatVersion",1).put("assistantReply",reply("Some effects remain unconfirmed."))
            v.getJSONObject("receipt").put("key",key).put("outcome","uncertain").put("expected",JSONObject.NULL).put("line","Effects remain uncertain.")
        }
        try{
            val controller=HermesConversationController(scope,{memory},{body->if(body.getString("op")=="start"){sent=JSONObject(body.toString());assertEquals(1,body.getInt("replyVersion"))};view(body)},{time})
            controller.bind("a".repeat(64));controller.availability(true,1,1,1);controller.edit("Move tasks tomorrow");controller.send()
            assertNull(controller.state.value.attemptKey);assertNull(controller.state.value.rootKey)
            assertEquals("uncertain",JSONObject(controller.state.value.receipt!!).getString("outcome"))
            assertEquals(1,controller.state.value.timeline.count{it.kind=="reply"})
            controller.readReceipt();controller.readReceipt()
            assertEquals(1,controller.state.value.timeline.count{it.kind=="reply"})
            val restored=HermesConversationController(scope,{memory},{error("No automatic resend")},{time})
            restored.bind("a".repeat(64));assertEquals(1,restored.state.value.timeline.count{it.kind=="reply"})
            assertNull(restored.state.value.attemptKey)
            restored.unbind();restored.bind("b".repeat(64))
            assertTrue(restored.state.value.timeline.isEmpty());assertEquals(0,restored.state.value.replyVersion)
        }finally{scope.cancel()}
    }
    @Test fun lateReplyKeepsNewDraftAndFrozenReferenceAndExpiresWithoutLosingReceipt(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();val gate=CompletableDeferred<JSONObject>();var body:JSONObject?=null
        try{
            val controller=HermesConversationController(scope,{memory},{v->body=JSONObject(v.toString());gate.await()},{time})
            controller.bind("a".repeat(64));controller.availability(true,1,1,1);controller.edit("Earlier request");controller.send();controller.edit("New unsent draft")
            val frozen=controller.state.value.draftContext
            val response=JSONObject(hermesWireFixtures().getJSONObject("complete").toString()).also{v->val key=body!!.getString("key");v.put("rootKey",key).put("turnKey",key).put("expiresAt",time+1000).put("chatVersion",1).put("assistantReply",reply("Actual final text"));v.getJSONObject("receipt").put("key",key)}
            gate.complete(response)
            assertEquals("New unsent draft",controller.state.value.draft);assertEquals(frozen,controller.state.value.draftContext)
            val expired=projectChat(controller.state.value,time+1001)
            assertFalse(expired.timeline.any{it.kind=="reply"&&it.text.isNotEmpty()});assertNotNull(expired.receipt)
        }finally{scope.cancel()}
    }
    @Test fun unnegotiatedServerGetsLegacyBodyWithoutAutomaticStrippedRetry(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();var calls=0
        try{
            val controller=HermesConversationController(scope,{memory},{body->calls++;assertFalse(body.has("replyVersion"));error("Synthetic unavailable")},{time})
            controller.bind("a".repeat(64));controller.availability(true,1);controller.edit("Explain tasks");controller.send();controller.send()
            assertEquals(1,calls);assertNotNull(controller.state.value.attemptKey)
        }finally{scope.cancel()}
    }
    @Test fun ownerChangeFencesLateActualReplyAndTypedQuestionCannotCarryProse(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val stores=mutableMapOf<String,Memory>();val gate=CompletableDeferred<JSONObject>();var sent:JSONObject?=null
        try{
            val controller=HermesConversationController(scope,{stores.getOrPut(it){Memory()}},{body->sent=JSONObject(body.toString());withContext(NonCancellable){gate.await()}},{time})
            controller.bind("a".repeat(64));controller.availability(true,1,1,1);controller.edit("Explain tasks");controller.send()
            controller.unbind();controller.bind("b".repeat(64))
            val v=JSONObject(hermesWireFixtures().getJSONObject("complete").toString()).also{r->val key=sent!!.getString("key");r.put("rootKey",key).put("turnKey",key).put("assistantReply",reply("Prior owner text"));r.getJSONObject("receipt").put("key",key)}
            gate.complete(v);assertTrue(controller.state.value.timeline.isEmpty())
            val question=JSONObject(hermesWireFixtures().getJSONObject("question").toString()).put("assistantReply",reply("A replacement question is not authority"))
            assertFalse(validHermesView(question))
        }finally{gate.cancel();scope.cancel()}
    }
}
