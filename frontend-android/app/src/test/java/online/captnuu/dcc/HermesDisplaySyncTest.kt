package online.captnuu.dcc

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest

class HermesDisplaySyncTest {
    private val resource="https://synthetic.invalid/calendar/operation.ics"
    private fun digest(s:String)=MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun fact()=JSONObject().put("mutationId","synthetic-operation").put("calendarId","synthetic-calendar")
        .put("resourceKey",digest(resource)).put("uid","synthetic-uid").put("start","2026-11-09T12:00:00Z").put("end","2026-11-09T13:00:00Z")
        .put("allDay",false).put("deleted",false).put("recurrenceId",JSONObject.NULL)
    private fun event()=JSONObject().put("mutationId","synthetic-operation").put("calendarId","synthetic-calendar")
        .put("resource",resource).put("uid","synthetic-uid").put("start","2026-11-09T12:00:00Z").put("end","2026-11-09T13:00:00Z")
        .put("allDay",false).put("recurrenceId",JSONObject.NULL).put("title","Same title")
    private fun snapshot(e:JSONObject?=null)=JSONObject().put("calendars",JSONArray(listOf(JSONObject().put("id","synthetic-calendar")))).put("events",JSONArray(listOfNotNull(e)))
    private fun facts(c:JSONObject=fact())=JSONObject().put("version",1).put("tasks",JSONArray()).put("calendar",JSONArray(listOf(c)))
    private val fast=HermesDisplaySyncTiming(List(6){0L},100,1000)

    @Test fun exactCalendarIdentityNotTitleOrTimestampControlsConfirmation(){
        assertTrue(hermesCalendarPresent(listOf(fact()),snapshot(event())))
        for(key in listOf("resource","uid","calendarId","mutationId","start","end","recurrenceId","allDay")){
            val wrong=event().put(key,if(key=="allDay")true else if(key in setOf("start","end"))"2026-11-10T12:00:00Z" else "wrong")
            assertFalse(key,hermesCalendarPresent(listOf(fact()),snapshot(wrong).put("lastSuccess","2099-01-01T00:00:00Z")))
        }
        assertFalse(hermesCalendarPresent(listOf(fact().put("deleted",true)),snapshot()))
        assertFalse(hermesCalendarPresent(listOf(fact().put("resourceKey",JSONObject.NULL)),snapshot(event())))
    }
    @Test fun delayedSnapshotConfirmsButNoMatchStopsAtSixReads()=runBlocking{
        var reads=0;var published=0
        assertEquals(HermesCalendarSyncResult.CONFIRMED,readHermesCalendar(listOf(fact()),fast,{true},{reads++;snapshot(if(reads==3)event() else event().put("resource","wrong"))},{published++}))
        assertEquals(3,reads);assertEquals(3,published)
        reads=0
        assertEquals(HermesCalendarSyncResult.PENDING,readHermesCalendar(listOf(fact()),fast,{true},{reads++;snapshot()},{ }))
        assertEquals(6,reads)
        assertEquals(listOf(0L,5000L,15000L,30000L,50000L,75000L),HermesDisplaySyncTiming().offsets)
        assertEquals(90000L,HermesDisplaySyncTiming().budgetMillis);assertEquals(12000L,HermesDisplaySyncTiming().readMillis)
    }
    @Test fun failedReadDeadlineAndOwnerCancellationAreFinite()=runBlocking{
        var reads=0
        assertEquals(HermesCalendarSyncResult.ERROR,readHermesCalendar(listOf(fact()),fast,{true},{reads++;throw java.io.IOException("private detail")},{error("No publish")}))
        assertEquals(1,reads)
        assertEquals(HermesCalendarSyncResult.ERROR,readHermesCalendar(listOf(fact()),HermesDisplaySyncTiming(listOf(0),5,100),{true},{awaitCancellation()},{error("No publish")}))
        assertEquals(HermesCalendarSyncResult.PENDING,readHermesCalendar(listOf(fact()),HermesDisplaySyncTiming(listOf(0,50),100,5),{true},{snapshot()},{ }))
        var current=true
        try{readHermesCalendar(listOf(fact()),fast,{current},{current=false;snapshot(event())},{error("Late owner must not publish")});fail("Cancellation must propagate")}
        catch(_:CancellationException){}
    }
    @Test fun codecBoundsAndTwelveTaskReadbackDoNotUseReceiptCapOrProse(){
        assertTrue(validHermesDisplaySync(facts()))
        assertFalse(validHermesDisplaySync(facts().put("assistantReply","saved")))
        assertFalse(validHermesDisplaySync(facts(fact().put("resourceKey","not-a-hash"))))
        val tasks=(1..12).map{i->JSONObject().put("id","task-$i").put("title","Synthetic $i").put("date","2026-11-09").put("notes","").put("completed",false).put("deleted",false).put("important",false)}
        val projections=tasks.mapIndexed{i,t->JSONObject().put("id",t.getString("id")).put("version",i+1).put("after",JSONObject(t.toString()).also{it.remove("id");it.remove("notes")})}
        val v=JSONObject().put("version",1).put("tasks",JSONArray(projections)).put("calendar",JSONArray())
        assertTrue(validHermesDisplaySync(v));assertTrue(hermesTasksPresent(projections,ManualTaskReadback(12,tasks)))
        assertFalse(hermesTasksPresent(projections,ManualTaskReadback(12,tasks.take(4))))
        assertFalse(hermesTasksPresent(projections,ManualTaskReadback(11,tasks)))
        assertFalse(hermesTasksPresent(projections,ManualTaskReadback(12,tasks.map{JSONObject(it.toString()).put("deleted",true)})))
        assertFalse(validHermesDisplaySync(JSONObject().put("version",1).put("tasks",JSONArray()).put("calendar",JSONArray())))
    }
    @Test fun sixteenTaskDisplayFactsRespectNativeBoundaryAndRejectGenericReceiptFields(){
        val tasks=(1..16).map{i->JSONObject().put("id","task-$i").put("title","Synthetic $i").put("date","2026-11-09")
            .put("notes","Retained domain note").put("completed",false).put("deleted",false).put("important",false)
            .put("status","active").put("remainingMinutes",25)}
        val projections=tasks.mapIndexed{i,t->JSONObject().put("id",t.getString("id")).put("version",i+1)
            .put("after",JSONObject().put("title",t.getString("title")).put("date",t.getString("date"))
                .put("completed",false).put("deleted",false).put("important",false))}
        val v=JSONObject().put("version",1).put("tasks",JSONArray(projections)).put("calendar",JSONArray())
        assertTrue(validHermesDisplaySync(v))
        assertTrue(hermesTasksPresent(projections,ManualTaskReadback(16,tasks)))
        for((field,value) in listOf("status" to "active","remainingMinutes" to 25)){
            val invalid=JSONObject(v.toString())
            invalid.getJSONArray("tasks").getJSONObject(15).getJSONObject("after").put(field,value)
            assertFalse("Generic receipt fields must not widen the native task contract: $field",validHermesDisplaySync(invalid))
        }
        val tooMany=JSONObject(v.toString())
        tooMany.getJSONArray("tasks").put(JSONObject(projections.last().toString()).put("id","task-17").put("version",17))
        assertFalse(validHermesDisplaySync(tooMany))
        assertEquals("active",tasks.last().getString("status"));assertEquals(25,tasks.last().getInt("remainingMinutes"))
    }
    @Test fun negotiatedFactsAreAcceptedOnceAndStatusSurvivesRestoreWithoutPolling(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val time=1794225600000L
        val saved=object:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){error("No clearing")}}
        var callbacks=0;var wire:JSONObject?=null
        val c=HermesConversationController(scope,{saved},{body->
            JSONObject().put("version",1).put("chatVersion",1).put("rootKey",body.getString("key")).put("turnKey",body.getString("key")).put("questions",0).put("expiresAt",time+HERMES_TTL_MS)
                .put("receipt",JSONObject().put("version",1).put("key",body.getString("key")).put("outcome","read-only").put("line","Synthetic").put("expected",JSONObject.NULL).put("verified",0).put("targets",JSONArray()))
                .put("assistantReply",JSONObject().put("version",1).put("text","Historical natural reply")).put("displaySync",facts()).also{wire=it}
        },{time},onDisplaySync={_,_->callbacks++})
        try{
            c.bind("a".repeat(64));c.chatCapabilities(JSONObject().put("conversation",true).put("conversationReplyVersion",1).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1))
            c.edit("Synthetic calendar operation");c.send();assertEquals(1,callbacks)
            assertFalse(validHermesView(wire!!));assertTrue(validHermesView(wire!!,true))
            assertEquals("Saved — syncing…",c.state.value.timeline.last().text)
            val restored=HermesConversationController(scope,{saved},{error("No automatic polling on restore")},{time},onDisplaySync={_,_->error("No restart")})
            restored.bind("a".repeat(64))
            assertEquals("Saved — refresh interrupted; visibility not confirmed.",restored.state.value.timeline.last().text)
            assertEquals(1,callbacks)
        }finally{scope.cancel()}
    }
    @Test fun deliveryRecoveryPublishesNegotiatedFactsOnceWithoutAnotherMutation(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val time=1794225600000L
        val saved=object:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){error("No clearing")}}
        val calls=mutableListOf<String>();var key="";var callbacks=0
        val c=HermesConversationController(scope,{saved},{body->
            calls+=body.getString("op")
            if(body.getString("op")=="start"){key=body.getString("key");throw java.io.IOException("Synthetic lost acknowledgement")}
            assertEquals("read",body.getString("op"));assertEquals(key,body.getString("rootKey"))
            JSONObject().put("version",1).put("chatVersion",1).put("rootKey",key).put("turnKey",key).put("questions",0).put("expiresAt",time+HERMES_TTL_MS)
                .put("receipt",JSONObject().put("version",1).put("key",key).put("outcome","uncertain").put("line","Calendar pending").put("expected",JSONObject.NULL).put("verified",0).put("targets",JSONArray()))
                .put("assistantReply",JSONObject().put("version",1).put("text","Stored natural reply")).put("displaySync",facts())
        },{time},onDisplaySync={_,_->callbacks++})
        try{
            c.bind("a".repeat(64));c.chatCapabilities(JSONObject().put("conversation",true).put("conversationReplyVersion",1).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1))
            c.edit("Synthetic operation");c.send()
            assertEquals(listOf("start","read"),calls);assertEquals(1,callbacks)
            assertEquals(1,c.state.value.timeline.count{it.text=="Stored natural reply"})
            assertEquals(1,c.state.value.timeline.count{it.id=="sync:$key"})
            assertFalse(c.state.value.busy)
        }finally{scope.cancel()}
    }
    @Test fun calendarDomainProgressRestoresAsInterruptedWithoutRestartingPolling(){
        domainProgressRestore("Calendar saved — syncing…")
    }
    @Test fun mixedTaskAndCalendarProgressRestoresAsInterruptedWithoutRestartingPolling(){
        domainProgressRestore("Tasks synced — visible on this phone. Calendar saved — syncing…")
    }
    private fun domainProgressRestore(progress:String){
        val scope=CoroutineScope(Dispatchers.Unconfined);val time=1794225600000L
        val owner="a".repeat(64);val natural="Historical natural prose: still syncing…"
        val saved=object:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){error("No clearing")}}
        var requests=0;var callbacks=0
        val c=HermesConversationController(scope,{saved},{body->
            requests++
            JSONObject().put("version",1).put("chatVersion",1).put("rootKey",body.getString("key")).put("turnKey",body.getString("key")).put("questions",0).put("expiresAt",time+HERMES_TTL_MS)
                .put("receipt",JSONObject().put("version",1).put("key",body.getString("key")).put("outcome","uncertain").put("line","Calendar saved; snapshot pending.").put("expected",JSONObject.NULL).put("verified",0).put("targets",JSONArray()))
                .put("assistantReply",JSONObject().put("version",1).put("text",natural)).put("displaySync",facts())
        },{time},onDisplaySync={_,_->callbacks++})
        try{
            c.bind(owner);c.chatCapabilities(JSONObject().put("conversation",true).put("conversationReplyVersion",1).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1))
            c.edit("Synthetic calendar operation");c.send()
            val turn=c.state.value.submitted!!.turnKey
            // Use the same persistence method and progress strings as the model,
            // not a test-side saved-state implementation or assistant-text parser.
            c.displaySyncFeedback(c.ownerFence()!!,turn,progress)
            val before=c.state.value
            assertEquals(progress,before.timeline.single{it.id=="sync:$turn"}.text)
            assertEquals(progress,JSONObject(saved.raw!!).getJSONArray("timeline").objects().single{it.getString("id")=="sync:$turn"}.getString("text"))
            var restoredRequests=0;var restoredCallbacks=0
            val restored=HermesConversationController(scope,{saved},{restoredRequests++;error("Restore must not call an API")},{time},onDisplaySync={_,_->restoredCallbacks++})
            restored.bind(owner)
            assertTrue("Valid saved progress must restore before checking its terminal feedback",restored.state.value.storageReady)
            assertEquals(0,restoredRequests);assertEquals(0,restoredCallbacks);assertEquals(1,requests);assertEquals(1,callbacks)
            assertEquals(before.submitted,restored.state.value.submitted);assertEquals(before.receipt,restored.state.value.receipt)
            assertEquals(before.timeline.filterNot{it.id=="sync:$turn"},restored.state.value.timeline.filterNot{it.id=="sync:$turn"})
            val status=restored.state.value.timeline.single{it.id=="sync:$turn"}.text
            assertFalse("Restored domain progress must not claim active syncing when no polling job was restarted",status.contains("syncing…"))
            assertTrue("Restored domain progress must give finite interrupted/not-confirmed feedback",status.contains("interrupted")&&status.contains("confirm"))
            assertEquals(natural,restored.state.value.timeline.single{it.id=="reply:$turn"}.text)
            restored.unbind();restored.bind(owner)
            assertEquals(status,restored.state.value.timeline.single{it.id=="sync:$turn"}.text)
            assertEquals(0,restoredRequests);assertEquals(0,restoredCallbacks)
        }finally{scope.cancel()}
    }
}
