package online.captnuu.dcc

import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class HermesReferenceTest {
    private class Memory:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){raw=null}}
    private val time=1794016800000L
    @Test fun boundedReferenceExcludesPendingExpiredAndFutureEntries(){
        fun entry(i:Int,text:String,settled:Boolean=true,expiry:Long=time+HERMES_TTL_MS)=HermesChatEntry("user:$i","synthetic_root_01","synthetic_turn_$i","user","user",text,expiry,settled)
        val history=(0..20).map{entry(it,"界".repeat(300))}+entry(21,"Pending secret",false)+entry(22,"Expired secret",expiry=time)+entry(23,"Future secret",expiry=time+HERMES_TTL_MS+1)
        val reference=JSONObject(hermesReference(HermesState(timeline=history),time,"Move current tasks"))
        assertTrue(validHermesReference(reference));assertTrue(reference.getJSONArray("entries").length()<=6)
        assertTrue(reference.toString().toByteArray(Charsets.UTF_8).size<=2304)
        for(forbidden in listOf("Pending secret","Expired secret","Future secret"))assertFalse(reference.toString().contains(forbidden))
        assertFalse(validHermesReference(JSONObject().put("version",1.5).put("entries",org.json.JSONArray())))
        assertEquals(0,JSONObject(frozenHermesReference(reference.toString(),time+HERMES_TTL_MS,"Next")).getJSONArray("entries").length())
    }
    @Test fun negotiatedContextIsFrozenWithClaimAndRestoreNeverResendsOrLeaksOwners(){
        val stores=mutableMapOf<String,Memory>();val scope=CoroutineScope(Dispatchers.Unconfined)
        val bodies=mutableListOf<JSONObject>();val gate=CompletableDeferred<JSONObject>();val owner="a".repeat(64)
        try{
            val controller=HermesConversationController(scope,{stores.getOrPut(it){Memory()}},{body->
                bodies+=JSONObject(body.toString())
                if(bodies.size>1)gate.await() else JSONObject(hermesWireFixtures().getJSONObject("complete").toString()).also{v->v.put("rootKey",body.getString("key")).put("turnKey",body.getString("key"));v.getJSONObject("receipt").put("key",body.getString("key"))}
            },{time})
            controller.bind(owner);controller.availability(true,1);controller.edit("Add 3 study chunks today");controller.send()
            assertEquals(0,bodies[0].getJSONObject("context").getJSONArray("entries").length())
            controller.edit("Move the study chunks to tomorrow");controller.send()
            val frozen=bodies[1].getJSONObject("context").toString()
            assertTrue(frozen.contains("Add 3 study chunks today"));assertFalse(frozen.contains("Move the study chunks to tomorrow"))
            assertEquals(frozen,controller.state.value.submitted!!.context)
            controller.edit("Fresh draft after submit");assertEquals(frozen,controller.state.value.submitted!!.context)
            val restored=HermesConversationController(scope,{stores.getOrPut(it){Memory()}},{error("No automatic resend")},{time})
            restored.bind(owner);assertEquals(frozen,restored.state.value.submitted!!.context);assertEquals(2,bodies.size)
            restored.unbind();restored.bind("b".repeat(64))
            assertTrue(restored.state.value.timeline.isEmpty());assertEquals(0,restored.state.value.contextVersion)
            assertEquals(0,JSONObject(hermesReference(restored.state.value,time,"Next")).getJSONArray("entries").length())
        }finally{scope.cancel()}
    }
    @Test fun oldServerGetsLegacyBodyAndNoContextIsRetriedOnFailure(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();var calls=0
        try{
            val controller=HermesConversationController(scope,{memory},{body->calls++;assertFalse(body.has("context"));error("Server unavailable")},{time})
            controller.bind("a".repeat(64));controller.availability(true);controller.edit("Existing legacy request");controller.send();controller.send()
            assertEquals(1,calls);assertNotNull(controller.state.value.attemptKey)
        }finally{scope.cancel()}
    }
    @Test fun completionArrivingAfterFreshDraftStartsCannotEnterThatDraftReference(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory();val gate=CompletableDeferred<JSONObject>()
        val bodies=mutableListOf<JSONObject>()
        fun done(body:JSONObject)=JSONObject(hermesWireFixtures().getJSONObject("complete").toString()).also{v->v.put("rootKey",body.getString("key")).put("turnKey",body.getString("key"));v.getJSONObject("receipt").put("key",body.getString("key"))}
        try{
            val controller=HermesConversationController(scope,{memory},{body->bodies+=JSONObject(body.toString());if(bodies.size==1)gate.await() else done(body)},{time})
            controller.bind("a".repeat(64));controller.availability(true,1);controller.edit("Earlier request still running");controller.send()
            controller.edit("New draft begun while earlier request runs")
            gate.complete(done(bodies[0]));controller.send()
            assertEquals(2,bodies.size)
            assertEquals(0,bodies[1].getJSONObject("context").getJSONArray("entries").length())
        }finally{scope.cancel()}
    }
    @Test fun knownTerminalUpdateBatchCanContinueWithoutClaimingChecklistCompletion(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val memory=Memory()
        try{
            val controller=HermesConversationController(scope,{memory},{body->
                JSONObject(hermesWireFixtures().getJSONObject("complete").toString()).also{v->
                    val key=body.getString("key");v.put("rootKey",key).put("turnKey",key).put("continuable",true)
                    v.getJSONObject("receipt").put("key",key).put("outcome","partial").put("expected",JSONObject.NULL).put("line","3 task updates verified; full requested scope is not certified.")
                    v.getJSONObject("receipt").getJSONArray("targets").objects().forEach{it.put("action","updated")}
                }
            },{time})
            controller.bind("a".repeat(64));controller.availability(true,1);controller.edit("Move existing tasks to tomorrow");controller.send()
            assertNull(controller.state.value.rootKey);assertNull(controller.state.value.attemptKey)
            assertEquals("partial",JSONObject(controller.state.value.receipt!!).getString("outcome"))
            assertTrue(controller.state.value.timeline.all{it.settled})
            val restored=HermesConversationController(scope,{memory},{error("No replay")},{time})
            restored.bind("a".repeat(64));assertNull(restored.state.value.rootKey)
            assertTrue(restored.state.value.timeline.all{it.settled})
        }finally{scope.cancel()}
    }
}
