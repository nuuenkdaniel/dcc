package online.captnuu.dcc

import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class HermesChatHistoryTest {
    private class Memory:SessionStorage {var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){raw=null}}
    private val owner="a".repeat(64)
    private val time=1794016800000L
    private fun reply(body:JSONObject,kind:String="complete"):JSONObject {
        val v=JSONObject(hermesWireFixtures().getJSONObject(kind).toString());val key=body.optString("key",body.optString("rootKey"))
        v.put("rootKey",body.optString("rootKey",key)).put("turnKey",key);v.getJSONObject("receipt").put("key",key)
        return v
    }
    @Test fun questionAnswerReceiptHistoryRestoresWithoutResendOrDuplicateBubbles(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();val operations=mutableListOf<String>();var latest:JSONObject?=null
        val api:suspend (JSONObject)->JSONObject={body->operations+=body.getString("op");if(body.getString("op")=="read")JSONObject(latest!!.toString()) else reply(body,if(body.getString("op")=="start")"question" else "complete").also{latest=it}}
        try{
            val controller=HermesConversationController(scope,{memory},api,{time})
            controller.bind(owner);controller.availability(true);controller.edit("Synthetic study request");controller.send()
            controller.edit("Lectures; practice problems; review");controller.send()
            val entries=controller.state.value.timeline
            assertEquals(listOf("user","assistant","user","assistant"),entries.map{it.role})
            assertEquals("Synthetic study request",entries[0].text);assertEquals("question",entries[1].kind)
            assertEquals("Lectures; practice problems; review",entries[2].text);assertEquals("receipt",entries[3].kind)
            assertEquals(entries.size,entries.map{it.id}.toSet().size)
            val restored=HermesConversationController(scope,{memory},api,{time});restored.bind(owner)
            assertEquals(entries,restored.state.value.timeline);assertEquals(listOf("start","answer"),operations)
            restored.edit("Next independent request");restored.availability(true);restored.send()
            assertNotEquals(entries[0].turnKey,restored.state.value.submitted!!.turnKey)
            val again=HermesConversationController(scope,{memory},api,{time});again.bind(owner)
            assertEquals(restored.state.value.timeline,again.state.value.timeline)
        }finally{scope.cancel()}
    }
    @Test fun uncertainReadUpdatesItsTurnWithoutDuplicatingMessagesOrTouchingFreshDraft(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();var request:JSONObject?=null;val operations=mutableListOf<String>()
        try{
            val controller=HermesConversationController(scope,{memory},{body->
                operations+=body.getString("op")
                if(body.getString("op")=="start"){request=JSONObject(body.toString());error("ACK lost")}
                else reply(request!!)
            },{time})
            controller.bind(owner);controller.availability(true);controller.edit("Exact submitted text");controller.send()
            assertEquals(2,controller.state.value.timeline.size)
            controller.edit("Fresh unsent draft");controller.readReceipt();controller.readReceipt()
            val timeline=controller.state.value.timeline
            assertEquals(2,timeline.size);assertEquals("receipt",timeline.last().kind)
            assertEquals("Fresh unsent draft",controller.state.value.draft)
            assertEquals(1,operations.count{it=="start"})
        }finally{scope.cancel()}
    }
    @Test fun onlySettledRootsArePrunedAndTheStoredTimelineStaysBounded(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory()
        try{
            val controller=HermesConversationController(scope,{memory},{reply(it)},{time})
            controller.bind(owner);controller.availability(true)
            repeat(30){controller.edit("Synthetic request $it");controller.send()}
            val s=controller.state.value
            assertTrue(s.historyPruned);assertTrue(s.timeline.size<=HERMES_CHAT_MAX_ENTRIES)
            assertTrue(JSONObject(memory.raw!!).getJSONArray("timeline").toString().toByteArray(Charsets.UTF_8).size<=HERMES_CHAT_MAX_BYTES)
            assertFalse(s.timeline.any{it.text=="Synthetic request 0"})
            assertEquals("complete",JSONObject(s.receipt!!).getString("outcome"))
        }finally{scope.cancel()}
    }
    @Test fun protectedHistoryCannotBeErasedToMakeSpaceForAnotherWrite(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();var sends=0
        try{
            val controller=HermesConversationController(scope,{memory},{body->
                if(body.getString("op")=="start"){sends++;error("ACK lost")}
                else reply(JSONObject().put("key",body.getString("rootKey"))).also{it.getJSONObject("receipt").put("outcome","uncertain").put("verified",0).put("targets",org.json.JSONArray()).put("line","Unconfirmed")}
            },{time})
            controller.bind(owner);controller.availability(true)
            repeat(12){controller.edit("Uncertain request $it");controller.send();controller.newRequest()}
            val before=controller.state.value.timeline
            controller.newConversation()
            assertEquals(before,controller.state.value.timeline)
            assertTrue(before.any{!it.settled});assertTrue(sends<12)
            assertTrue(before.size<=HERMES_CHAT_MAX_ENTRIES)
        }finally{scope.cancel()}
    }
    @Test fun utf8ByteBoundPrunesSettledGroupsBeforeTheEntryBound(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory()
        try{
            val controller=HermesConversationController(scope,{memory},{reply(it)},{time})
            controller.bind(owner);controller.availability(true)
            repeat(15){controller.edit("$it "+"界".repeat(2000));controller.send()}
            val s=controller.state.value
            assertTrue(s.historyPruned);assertTrue(s.timeline.size<HERMES_CHAT_MAX_ENTRIES)
            assertTrue(chatJson(s.timeline).toString().toByteArray(Charsets.UTF_8).size<=HERMES_CHAT_MAX_BYTES)
            val restored=HermesConversationController(scope,{memory},{error("No replay")},{time});restored.bind(owner)
            assertEquals(s.timeline,restored.state.value.timeline)
        }finally{scope.cancel()}
    }
    @Test fun expiredQuestionTextIsScrubbedButIdentityAndReceiptRecoverySurvive(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();var clock=time;var writes=0
        try{
            val controller=HermesConversationController(scope,{memory},{writes++;reply(it,"question")},{clock})
            controller.bind(owner);controller.availability(true);controller.edit("Synthetic question-bound request");controller.send()
            val before=controller.state.value;val root=before.rootKey;val question=before.timeline.last().questionId
            clock=hermesWireFixtures().getJSONObject("question").getLong("expiresAt")+1
            controller.unbind();controller.bind(owner)
            val expired=controller.state.value
            assertEquals(root,expired.rootKey);assertEquals(question,expired.timeline.last().questionId)
            assertTrue(expired.timeline.all{it.text.isEmpty()});assertEquals(1,writes)
            assertFalse(memory.raw!!.contains("Synthetic question-bound request"))
        }finally{scope.cancel()}
    }
    @Test fun migrationUsesOnlyAvailableEventsAndOwnerAndTtlDoNotLeakText(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();val stores=mutableMapOf(owner to memory);var clock=time
        try{
            val old=HermesConversationController(scope,{memory},{error("ACK lost")},{clock})
            old.bind(owner);old.availability(true);old.edit("Available legacy sent text");old.send()
            val legacy=JSONObject(memory.raw!!).also{it.remove("timeline");it.remove("timelineVersion");it.remove("historyPruned")};memory.raw=legacy.toString()
            val restored=HermesConversationController(scope,{stores.getOrPut(it){Memory()}},{error("No resend")},{clock})
            restored.bind(owner);assertEquals(1,restored.state.value.timeline.count{it.role=="user"})
            restored.unbind();restored.bind("b".repeat(64));assertTrue(restored.state.value.timeline.isEmpty())
            clock+=HERMES_TTL_MS+1;restored.unbind();restored.bind(owner)
            assertFalse(memory.raw!!.contains("Available legacy sent text"));assertNotNull(restored.state.value.attemptKey)
        }finally{scope.cancel()}
    }
}
