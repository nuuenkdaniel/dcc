package online.captnuu.dcc

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Shapes emitted by the published 0.2.3/0.2.4 serializers; synthetic data only. */
class HermesRecoveryTest {
    private class Memory(var raw:String?=null):SessionStorage{
        var reads=0;var writes=0;var clears=0;var failRead=false;var failWrite=false
        override fun read():String?{reads++;if(failRead)error("Synthetic read failure");return raw}
        override fun write(value:String){if(failWrite)error("Synthetic write failure");writes++;raw=value}
        override fun clear(){clears++;raw=null}
    }
    private val owner="a".repeat(64)
    private val time=1794016800000L
    private val client="11111111-1111-4111-a111-111111111111"
    private val key="synthetic_restore_turn_01"
    private fun saved()=JSONObject().put("composerVersion",2).put("owner",owner).put("clientId",client).put("expiresAt",time+HERMES_TTL_MS)
        .put("draft","Synthetic unsent request").put("answer","").put("usedChars",0).put("usedBytes",0).put("editedAfterSubmit",false)
        .put("retained",JSONArray()).put("timelineVersion",1).put("timeline",JSONArray()).put("historyPruned",false)
    @Test fun blockedReadableOrReadFailureNeverWritesThroughEditClearSendExpiryOrRebind(){
        for(readFailure in listOf(false,true)){
            val source=Memory("not valid JSON").also{it.failRead=readFailure};val scope=CoroutineScope(Dispatchers.Unconfined);var calls=0
            try{
                var clock=time
                val controller=HermesConversationController(scope,{source},{calls++;error("No transport")},{clock})
                controller.bind(owner);controller.availability(true);assertFalse(controller.state.value.storageReady)
                controller.edit("Fresh memory-only draft");controller.send();controller.newConversation();controller.dismiss();controller.newRequest()
                clock+=HERMES_TTL_MS+1;controller.expireText();assertEquals("Fresh memory-only draft",controller.state.value.draft)
                controller.edit("Still memory-only");controller.bind(owner);controller.unbind();controller.bind(owner)
                assertEquals("not valid JSON",source.raw);assertEquals(0,source.writes);assertEquals(0,source.clears);assertEquals(0,calls)
            }finally{scope.cancel()}
        }
    }
    @Test fun versionAndValidationFailuresAreFiniteCategoriesNotEncryptionClaims(){
        val cases=listOf("{" to HermesStorageStatus.DECODE_BLOCKED,
            saved().put("composerVersion",99).toString() to HermesStorageStatus.VERSION_BLOCKED,
            saved().put("owner","b".repeat(64)).toString() to HermesStorageStatus.VALIDATION_BLOCKED,
            saved().put("receipt",JSONObject().put("version",1)).toString() to HermesStorageStatus.VALIDATION_BLOCKED,
            saved().put("draftContext",JSONObject().put("version",99)).toString() to HermesStorageStatus.VALIDATION_BLOCKED,
            saved().put("timeline",JSONArray().put(JSONObject())).toString() to HermesStorageStatus.VALIDATION_BLOCKED)
        for((raw,category) in cases){
            val memory=Memory(raw);val scope=CoroutineScope(Dispatchers.Unconfined)
            try{val c=HermesConversationController(scope,{memory},{error("No transport")},{time});c.bind(owner);assertEquals(category,c.state.value.storageStatus);c.edit("Memory draft");assertEquals(raw,memory.raw);assertEquals(0,memory.writes)}finally{scope.cancel()}
        }
    }
    @Test fun published023And024DraftsRoundTripAndRequireExplicitSendExactlyOnce(){
        for(release in listOf("023","024")){
            // Both published releases emitted composerVersion=2/timelineVersion=1.
            val old=saved()
            if(release=="024")old.put("draftContext",JSONObject().put("version",1).put("entries",JSONArray()))
            val memory=Memory(old.toString());val scope=CoroutineScope(Dispatchers.Unconfined);val bodies=mutableListOf<JSONObject>()
            try{
                val c=HermesConversationController(scope,{memory},{body->bodies+=body;error("Synthetic offline after admission")},{time})
                c.bind(owner);assertTrue(c.state.value.storageReady);assertEquals("Synthetic unsent request",c.state.value.draft)
                assertEquals(client,JSONObject(memory.raw!!).getString("clientId"));assertTrue(bodies.isEmpty())
                c.availability(true);c.edit("Another synthetic request");c.send();c.send()
                assertEquals(1,bodies.size);assertEquals(client,bodies[0].getString("clientId"));assertNotNull(c.state.value.attemptKey)
            }finally{scope.cancel()}
        }
    }
    @Test fun expiredSubmittedClaimAndReceiptRemainIndependentOfDiscardedText(){
        val receipt=JSONObject(hermesWireFixtures().getJSONObject("complete").getJSONObject("receipt").toString()).put("key",key).put("outcome","uncertain").put("expected",JSONObject.NULL)
        val raw=saved().put("expiresAt",time-1).put("rootKey",key).put("attemptKey",key).put("receipt",receipt)
            .put("submitted",JSONObject().put("rootKey",key).put("turnKey",key).put("text","Original synthetic claim").put("isAnswer",false).put("closed",false).put("expiresAt",time-1))
        val memory=Memory(raw.toString());val scope=CoroutineScope(Dispatchers.Unconfined)
        try{
            val c=HermesConversationController(scope,{memory},{error("No replay")},{time});c.bind(owner)
            assertTrue(c.state.value.storageReady);assertEquals(key,c.state.value.attemptKey);assertEquals(key,c.state.value.submitted!!.turnKey)
            assertEquals("",c.state.value.submitted!!.text);assertEquals("uncertain",JSONObject(c.state.value.receipt!!).getString("outcome"))
        }finally{scope.cancel()}
    }
    @Test fun explicitSeparateRecoveryPreservesOriginalAndTypedDraftAcrossReloadOwnerAndOneSend(){
        val primary=Memory("opaque synthetic source");val separate=Memory();val scope=CoroutineScope(Dispatchers.Unconfined);var calls=0
        try{
            fun controller()=HermesConversationController(scope,{primary},{calls++;error("Synthetic unavailable after explicit send")},{time},recoveryStorageFor={separate})
            val c=controller();c.bind(owner);c.availability(true);c.edit("Fresh memory draft");assertTrue(c.state.value.canRecoverSeparately)
            c.recoverSeparately();assertTrue(c.state.value.storageReady);assertEquals("Fresh memory draft",c.state.value.draft);assertEquals(0,calls)
            assertEquals("opaque synthetic source",primary.raw);assertEquals(0,primary.writes);assertEquals(0,primary.clears)
            assertEquals(owner,JSONObject(separate.raw!!).getString("preservedOwner"))
            val restored=controller();restored.bind(owner);assertEquals("Fresh memory draft",restored.state.value.draft)
            restored.availability(true);restored.send();restored.send();assertEquals(1,calls)
            val claimed=controller();claimed.bind(owner);assertNotNull(claimed.state.value.attemptKey);claimed.send();assertEquals(1,calls)
            claimed.unbind();claimed.bind("b".repeat(64));assertFalse(claimed.state.value.storageReady);assertTrue(claimed.state.value.timeline.isEmpty())
            assertEquals("opaque synthetic source",primary.raw)
        }finally{scope.cancel()}
    }
    @Test fun writeFailureIsNotAReadFailureAndBlocksAllFurtherWrites(){
        val memory=Memory(saved().toString()).also{it.failWrite=true};val scope=CoroutineScope(Dispatchers.Unconfined)
        try{
            val c=HermesConversationController(scope,{memory},{error("No transport")},{time});c.bind(owner)
            assertEquals(HermesStorageStatus.WRITE_BLOCKED,c.state.value.storageStatus);assertEquals("Synthetic unsent request",c.state.value.draft)
            c.edit("Memory-only edit");memory.failWrite=false;c.newConversation();c.send();c.unbind();c.bind(owner)
            assertEquals(0,memory.writes);assertEquals(0,memory.clears)
        }finally{scope.cancel()}
    }
    @Test fun valid023HistoryCanHitNewReservationCapacityWithoutBeingCorrupt(){
        val entries=(0 until 5).flatMap{i->val turn="synthetic_old_turn_0$i";listOf(
            HermesChatEntry("user:$turn",turn,turn,"user","user","Synthetic prior request",time+HERMES_TTL_MS),
            HermesChatEntry("status:$turn",turn,turn,"assistant","unknown","Synthetic unresolved receipt",time+HERMES_TTL_MS))}
        val memory=Memory(saved().put("timeline",chatJson(entries)).toString());val original=memory.raw;val scope=CoroutineScope(Dispatchers.Unconfined)
        try{
            val c=HermesConversationController(scope,{memory},{error("No transport")},{time});c.bind(owner)
            assertEquals(HermesStorageStatus.CAPACITY_BLOCKED,c.state.value.storageStatus)
            assertEquals(entries,c.state.value.timeline);c.edit("Memory draft");assertEquals(original,memory.raw);assertEquals(0,memory.writes)
        }finally{scope.cancel()}
    }
    @Test fun olderComposerMigrationPreservesClaimIdentityAndDoesNotReplay(){
        val old=saved().put("composerVersion",1).put("rootKey",key).put("attemptKey",key)
        val memory=Memory(old.toString());val scope=CoroutineScope(Dispatchers.Unconfined)
        try{
            val c=HermesConversationController(scope,{memory},{error("No replay")},{time});c.bind(owner)
            assertTrue(c.state.value.storageReady);assertEquals(key,c.state.value.submitted!!.rootKey);assertEquals(key,c.state.value.submitted!!.turnKey)
            assertEquals("Synthetic unsent request",c.state.value.submitted!!.text);assertEquals("",c.state.value.draft)
        }finally{scope.cancel()}
    }
    @Test fun partialAndUncertainCurrentClaimsSurviveRestoreEditAndSendWithoutNewKeys(){
        for(outcome in listOf("partial","uncertain")){
            val receipt=JSONObject(hermesWireFixtures().getJSONObject("complete").getJSONObject("receipt").toString()).put("key",key).put("outcome",outcome).put("expected",JSONObject.NULL)
            val submitted=JSONObject().put("rootKey",key).put("turnKey",key).put("text","Synthetic submitted request").put("isAnswer",false).put("closed",false).put("expiresAt",time+HERMES_TTL_MS)
            val raw=saved().put("rootKey",key).put("attemptKey",key).put("receipt",receipt).put("submitted",submitted).put("usedChars",27).put("usedBytes",27).put("editedAfterSubmit",true)
            val memory=Memory(raw.toString());val scope=CoroutineScope(Dispatchers.Unconfined);var requests=0
            try{
                val c=HermesConversationController(scope,{memory},{requests++;error("No resend")},{time});c.bind(owner);c.availability(true)
                assertTrue(c.state.value.storageReady);assertEquals(key,c.state.value.attemptKey);assertEquals(key,c.state.value.submitted!!.turnKey)
                c.edit("New unsent draft");c.send();assertEquals(0,requests);assertEquals(key,JSONObject(memory.raw!!).getString("attemptKey"));assertEquals(outcome,JSONObject(c.state.value.receipt!!).getString("outcome"))
            }finally{scope.cancel()}
        }
    }
    @Test fun failedOrUnreadableSeparateRecordCannotOverwriteEitherSource(){
        val original=Memory("synthetic original unreadable JSON");val separate=Memory().also{it.failWrite=true};val scope=CoroutineScope(Dispatchers.Unconfined)
        try{
            val c=HermesConversationController(scope,{original},{error("No transport")},{time},recoveryStorageFor={separate})
            c.bind(owner);c.edit("Retained memory draft");c.recoverSeparately()
            assertEquals(HermesStorageStatus.WRITE_BLOCKED,c.state.value.storageStatus);assertEquals("Retained memory draft",c.state.value.draft)
            assertEquals("synthetic original unreadable JSON",original.raw);assertEquals(0,original.writes);assertNull(separate.raw)
            separate.failWrite=false;separate.raw="unsupported separate JSON"
            val reloaded=HermesConversationController(scope,{original},{error("No transport")},{time},recoveryStorageFor={separate})
            reloaded.bind(owner);assertFalse(reloaded.state.value.canRecoverSeparately);reloaded.edit("Memory only");reloaded.recoverSeparately()
            assertEquals("unsupported separate JSON",separate.raw);assertEquals(0,separate.writes);assertEquals(0,original.clears)
        }finally{scope.cancel()}
    }
    @Test fun lateCompletionCannotReplaceSeparateRecoveryOrItsUnsentDraft(){
        val source=Memory();val separate=Memory();val gate=CompletableDeferred<JSONObject>();val scope=CoroutineScope(Dispatchers.Unconfined);var body:JSONObject?=null;var requests=0
        try{
            val c=HermesConversationController(scope,{source},{input->body=JSONObject(input.toString());requests++;withContext(NonCancellable){gate.await()}},{time},recoveryStorageFor={separate})
            c.bind(owner);c.availability(true);c.edit("Original synthetic request");c.send()
            val preserved=source.raw;source.failWrite=true;c.edit("Fresh retained draft");assertFalse(c.state.value.storageReady)
            c.recoverSeparately();assertTrue(c.state.value.storageReady);assertNull(c.state.value.attemptKey)
            val response=JSONObject(hermesWireFixtures().getJSONObject("complete").toString()).also{v->val old=body!!.getString("key");v.put("rootKey",old).put("turnKey",old);v.getJSONObject("receipt").put("key",old)}
            gate.complete(response)
            assertEquals("Fresh retained draft",c.state.value.draft);assertNull(c.state.value.receipt);assertNull(c.state.value.submitted)
            assertEquals(preserved,source.raw);assertEquals(1,requests)
        }finally{gate.cancel();scope.cancel()}
    }
}
