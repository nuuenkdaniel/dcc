package online.captnuu.dcc

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Synthetic transport/storage only. No endpoint, Android key store or model. */
class HermesConversationFirstTest {
    private class Memory:SessionStorage{var raw:String?=null;var writes=0;override fun read()=raw;override fun write(value:String){raw=value;writes++};override fun clear(){error("No clearing")}}
    private val owner="a".repeat(64);private val now=1794016800000L
    private fun reply(body:JSONObject,text:String)=JSONObject().put("version",1).put("chatVersion",1).put("rootKey",body.getString("key")).put("turnKey",body.getString("key")).put("questions",0).put("expiresAt",now+HERMES_TTL_MS)
        .put("receipt",JSONObject().put("version",1).put("key",body.getString("key")).put("outcome","read-only").put("line","No actions performed.").put("expected",JSONObject.NULL).put("verified",0).put("targets",JSONArray()))
        .put("assistantReply",JSONObject().put("version",1).put("text",text))
    private val twelveTaskText="Created twelve synthetic tasks. You can continue with another topic."
    private fun twelveWriteReply(body:JSONObject):JSONObject {
        // projectConversationReceipt counts all verified writes in its line but
        // exposes only four targets/verified IDs in the legacy details envelope.
        // The separate stored reply and tool summary describe the full batch.
        return reply(body,twelveTaskText).put("continuable",false)
            .put("toolSummary",JSONObject().put("version",1).put("text","Created 12 tasks.")).also{v->
                v.getJSONObject("receipt").put("outcome","partial").put("verified",4)
                    .put("line","12 records verified; full requested scope is unresolved.")
                    .put("targets",JSONArray((1..4).map{i->
                        JSONObject().put("kind","task").put("id","00000000-0000-4000-a000-${i.toString().padStart(12,'0')}")
                            .put("action","added").put("title","Synthetic task $i").put("date","2026-11-07")
                            .put("state","applied").put("verification","verified")
                            .put("before",JSONObject()).put("after",JSONObject().put("title","Synthetic task $i").put("date","2026-11-07").put("completed",false).put("deleted",false))
                    }))
            }
    }

    @Test fun lostStartAcknowledgementRecoversStoredTwelveWriteReplyWithOneReadAndNoReplay(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val calls=mutableListOf<JSONObject>()
        val lostAck=CompletableDeferred<Unit>();val recovered=CompletableDeferred<JSONObject>();var original:JSONObject?=null
        val c=HermesConversationController(scope,{saved},{body->
            calls+=JSONObject(body.toString())
            when(body.getString("op")){
                "start"->if(original==null){original=JSONObject(body.toString());lostAck.await();throw java.io.IOException("Synthetic lost start acknowledgement")}
                    else reply(body,"We can discuss the different topic.")
                "read"->{
                    val sent=original!!
                    assertEquals(sent.getString("workspaceOwner"),body.getString("workspaceOwner"))
                    assertEquals(sent.getString("clientId"),body.getString("clientId"))
                    assertEquals(sent.getString("key"),body.getString("rootKey"))
                    assertEquals(setOf("op","workspaceOwner","clientId","rootKey"),body.keys().asSequence().toSet())
                    recovered.await()
                }
                else->error("Recovery must never answer or cancel")
            }
        },{now})
        try{
            c.bind(owner);c.availability(true,1,1,1);c.edit("Create twelve synthetic tasks");c.send()
            val sent=c.state.value.submitted!!;val key=original!!.getString("key")
            assertTrue(c.state.value.busy);assertEquals(listOf("start"),calls.map{it.getString("op")})
            c.edit("Different fresh draft")
            lostAck.complete(Unit)
            assertEquals("A lost start acknowledgement must trigger exactly one read-only lookup of the original root",listOf("start","read"),calls.map{it.getString("op")})
            assertEquals(sent,c.state.value.submitted);assertEquals("Different fresh draft",c.state.value.draft)
            val stored=twelveWriteReply(original!!)
            assertTrue(validHermesView(stored))
            recovered.complete(stored)
            val state=c.state.value
            assertFalse(state.busy);assertEquals("Different fresh draft",state.draft)
            assertNull(state.rootKey);assertNull(state.attemptKey)
            assertEquals(sent.copy(closed=true),state.submitted)
            assertEquals(1,state.timeline.count{it.id=="reply:$key"&&it.text==twelveTaskText})
            assertEquals(1,state.timeline.count{it.id=="tools:$key"&&it.text=="Created 12 tasks."})
            assertEquals(1,state.timeline.count{it.turnKey==key&&it.role=="user"})
            assertTrue(state.timeline.none{it.turnKey==key&&it.kind in setOf("pending","unknown","receipt")})
            assertEquals(state.timeline.size,state.timeline.map{it.id}.distinct().size)
            assertEquals("partial",JSONObject(state.receipt!!).getString("outcome"))
            assertEquals(4,JSONObject(state.receipt!!).getInt("verified"))
            assertEquals(listOf("start","read"),calls.map{it.getString("op")})
            val reopened=HermesConversationController(scope,{saved},{error("Reopen must not send or look up automatically")},{now})
            reopened.bind(owner)
            assertEquals(state.timeline,reopened.state.value.timeline);assertEquals(state.draft,reopened.state.value.draft)
            assertEquals(listOf("start","read"),calls.map{it.getString("op")})
            c.send() // Only a separate explicit Send may dispatch the fresh draft.
            assertEquals(listOf("start","read","start"),calls.map{it.getString("op")})
            val fresh=calls.last()
            assertNotEquals(key,fresh.getString("key"));assertEquals(original!!.getString("clientId"),fresh.getString("clientId"))
            assertEquals(owner,fresh.getString("workspaceOwner"));assertEquals("Different fresh draft",fresh.getString("prompt"))
            assertFalse(fresh.has("answer"));assertFalse(fresh.has("rootKey"))
            assertEquals(1,c.state.value.timeline.count{it.id=="reply:$key"})
        }finally{lostAck.cancel();recovered.cancel();scope.cancel()}
    }
    @Test fun directProducerShapedTwelveWriteReplyPassesValidationAndRendersWithoutReceiptCards(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val calls=mutableListOf<JSONObject>()
        val c=HermesConversationController(scope,{saved},{body->
            calls+=JSONObject(body.toString())
            assertEquals("start",body.getString("op"))
            twelveWriteReply(body).also{v->
                assertTrue(validHermesView(v));assertTrue(validHermesReceipt(v.getJSONObject("receipt")))
                assertEquals(4,v.getJSONObject("receipt").getJSONArray("targets").length())
                assertTrue(v.getJSONObject("receipt").isNull("expected"));assertFalse(v.getBoolean("continuable"))
            }
        },{now})
        try{
            c.bind(owner);c.availability(true,1,1,1);c.edit("Create twelve synthetic tasks");c.send()
            assertEquals(1,calls.size);assertFalse(c.state.value.busy)
            assertEquals(twelveTaskText,c.state.value.timeline.single{it.id.startsWith("reply:")}.text)
            assertEquals("Created 12 tasks.",c.state.value.timeline.single{it.id.startsWith("tools:")}.text)
            assertTrue(c.state.value.timeline.none{it.kind in setOf("pending","unknown","receipt")})
            assertEquals(4,JSONObject(c.state.value.receipt!!).getInt("verified"))
        }finally{scope.cancel()}
    }

    @Test fun ordinaryRepliesAndNaturalQuestionsUseIndependentStartsAndBoundedHistoryWithoutCards(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val calls=mutableListOf<JSONObject>()
        val c=HermesConversationController(scope,{saved},{body->calls+=JSONObject(body.toString());reply(body,if(calls.size==1)"What do you mean by a study chunk?" else "We can change the topic to music.")},{now})
        try{
            c.bind(owner);c.availability(true,1,1,1);c.edit("Let us discuss studying");c.send()
            assertNull(c.state.value.rootKey);assertNull(c.state.value.attemptKey);assertFalse(answering(c.state.value))
            assertTrue(c.state.value.timeline.none{it.kind in setOf("receipt","question","unknown")})
            assertEquals("What do you mean by a study chunk?",c.state.value.timeline.last().text)
            c.edit("Actually, let us discuss music");c.send()
            assertEquals(listOf("start","start"),calls.map{it.getString("op")})
            assertNotEquals(calls[0].getString("key"),calls[1].getString("key"))
            assertEquals(calls[0].getString("clientId"),calls[1].getString("clientId"))
            assertFalse(calls[1].has("answer"));assertFalse(calls[1].has("parentKey"))
            val history=calls[1].getJSONObject("context").getJSONArray("entries").objects()
            assertTrue(history.any{it.getString("text")=="What do you mean by a study chunk?"})
            val reopened=HermesConversationController(scope,{saved},{error("Reopen must not dispatch")},{now})
            reopened.bind(owner)
            assertEquals(c.state.value.timeline,reopened.state.value.timeline)
            assertTrue(reopened.state.value.submitted!!.chat)
        }finally{scope.cancel()}
    }
    @Test fun originalActionStorageIsUntouchedAndCannotOwnTheNewComposer(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val original=Memory();val chat=Memory()
        val legacy=HermesConversationController(scope,{original},{error("Synthetic legacy lost response")},{now})
        try{
            legacy.bind(owner);legacy.availability(true);legacy.edit("Synthetic earlier task request");legacy.send();legacy.edit("Unsent draft retained")
            val oldRaw=original.raw;val oldWrites=original.writes;val calls=mutableListOf<JSONObject>()
            val modern=HermesConversationController(scope,{original},{body->calls+=body;reply(body,"Hello! You can continue chatting.")},{now},chatStorageFor={chat})
            modern.bind(owner);modern.availability(true,1,1,1)
            assertEquals("Unsent draft retained",modern.state.value.draft)
            assertTrue(modern.state.value.legacyTimeline.any{it.kind=="unknown"})
            assertNull(modern.state.value.rootKey);assertNull(modern.state.value.attemptKey)
            modern.edit("hello?");modern.send()
            assertEquals(1,calls.size);assertEquals("start",calls.single().getString("op"))
            assertEquals(oldRaw,original.raw);assertEquals(oldWrites,original.writes)
            assertFalse(chat.raw.isNullOrEmpty());assertEquals("Hello! You can continue chatting.",modern.state.value.timeline.last().text)
        }finally{scope.cancel()}
    }
    @Test fun failedMessageNeverReplaysOnReopenAndDoesNotBlockDifferentDraftOrOwnerFence(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val calls=mutableListOf<JSONObject>();var fail=true
        val c=HermesConversationController(scope,{saved},{body->calls+=JSONObject(body.toString());if(fail)throw java.io.IOException("Synthetic transport failure") else reply(body,"A different conversation is welcome.")},{now})
        try{
            c.bind(owner);c.availability(true,1,1,1);c.edit("Synthetic operation request");c.send()
            assertFalse(c.state.value.busy);assertTrue(c.state.value.timeline.last().text.contains("interrupted"))
            assertEquals(listOf("start","read"),calls.map{it.getString("op")})
            c.edit("Synthetic operation request");c.send();assertEquals(2,calls.size)
            c.edit("Different topic");fail=false;c.send();assertEquals(3,calls.size)
            assertEquals("A different conversation is welcome.",c.state.value.timeline.last().text)
            c.edit("Draft remains after reopening")
            val restored=HermesConversationController(scope,{saved},{error("No automatic replay")},{now});restored.bind(owner)
            assertEquals("Draft remains after reopening",restored.state.value.draft)
            val fence=c.ownerFence()!!;c.unbind();assertFalse(c.isCurrent(fence));assertTrue(c.state.value.timeline.isEmpty())
        }finally{scope.cancel()}
    }
    @Test fun lateReplyCannotReplaceAnotherOwnerEditor(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val stores=mutableMapOf<String,Memory>();val gate=CompletableDeferred<JSONObject>();var body:JSONObject?=null
        val c=HermesConversationController(scope,{stores.getOrPut(it){Memory()}},{input->body=input;withContext(NonCancellable){gate.await()}},{now})
        try{
            c.bind(owner);c.availability(true,1,1,1);c.edit("hello");c.send();c.edit("A draft typed while waiting")
            c.unbind();c.bind("b".repeat(64));c.edit("Other owner draft");val held=c.state.value
            gate.complete(reply(body!!,"Late response"));assertEquals(held,c.state.value)
        }finally{gate.cancel();scope.cancel()}
    }
    @Test fun validNewChatIsIndependentOfUnreadableHistoricalRecordsWithoutChangingLegacyBytes(){
        for(readFailure in listOf(false,true)){
            val scope=CoroutineScope(Dispatchers.Unconfined);val legacy=Memory();val chat=Memory();val calls=mutableListOf<JSONObject>()
            val seed=HermesConversationController(scope,{legacy},{body->calls+=body;reply(body,"Hello")},{now},chatStorageFor={chat})
            try{
                seed.bind(owner);seed.availability(true,1,1,1);seed.edit("hello");seed.send();seed.edit("Valid saved draft");seed.unbind()
                val client=JSONObject(chat.raw!!).getString("clientId")
                legacy.raw="Unreadable historical bytes";val originalBytes=legacy.raw;val originalWrites=legacy.writes
                val historical=object:SessionStorage{
                    override fun read():String?{if(readFailure)throw java.io.IOException("Synthetic read failure");return legacy.read()}
                    override fun write(value:String){error("Legacy storage must remain read-only")}
                    override fun clear(){error("No clearing")}
                }
                val restored=HermesConversationController(scope,{historical},{body->calls+=body;reply(body,"We can keep chatting.")},{now},chatStorageFor={chat})
                restored.bind(owner);restored.availability(true,1,1,1)
                assertTrue(restored.state.value.storageReady);assertEquals("Valid saved draft",restored.state.value.draft)
                assertTrue(restored.state.value.legacyTimeline.isEmpty());assertEquals(1,calls.size)
                restored.send();assertEquals(2,calls.size);assertEquals(client,calls.last().getString("clientId"))
                assertEquals("We can keep chatting.",restored.state.value.timeline.last().text)
                assertEquals(originalBytes,legacy.raw);assertEquals(originalWrites,legacy.writes)
            }finally{scope.cancel()}
        }
    }
    @Test fun sameOwnerRebindDoesNotReplayPendingTurnOrAcceptItsLateResponse(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val gate=CompletableDeferred<JSONObject>();var body:JSONObject?=null;var calls=0
        val c=HermesConversationController(scope,{saved},{input->calls++;body=input;withContext(NonCancellable){gate.await()}},{now})
        try{
            c.bind(owner);c.availability(true,1,1,1);c.edit("Pending message");c.send();c.edit("Draft during pending reply")
            c.unbind();c.bind(owner)
            assertEquals(1,calls);assertEquals("Draft during pending reply",c.state.value.draft)
            assertTrue(c.state.value.timeline.any{it.kind=="unknown"})
            val held=c.state.value
            gate.complete(reply(body!!,"Late text must not publish"))
            assertEquals(held,c.state.value);assertEquals(1,calls)
        }finally{gate.cancel();scope.cancel()}
    }
    @Test fun replyCapabilityAloneCannotEnableNewChatAndUnsupportedServersGetNoFallbackRequest(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val legacy=Memory();var calls=0
        val c=HermesConversationController(scope,{legacy},{calls++;error("No legacy request")},{now},chatStorageFor={saved})
        try{
            c.bind(owner);c.edit("hello?")
            val old=JSONObject().put("conversation",true).put("conversationReplyVersion",1).put("conversationContextVersion",1)
            for(value in listOf<Any?>(null,2,true,"1")){
                val capabilities=JSONObject(old.toString());if(value!=null)capabilities.put("conversationChatVersion",value)
                c.chatCapabilities(capabilities);c.send()
                assertFalse(c.state.value.available);assertEquals("hello?",c.state.value.draft);assertEquals(0,calls)
            }
            c.chatCapabilities(old.put("conversationChatVersion",1))
            assertTrue(c.state.value.available);assertEquals(1,c.state.value.chatVersion)
        }finally{scope.cancel()}
    }
    @Test fun missingChatEchoIsNotAcceptedOrResentWithoutVersion(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();val calls=mutableListOf<JSONObject>()
        val c=HermesConversationController(scope,{saved},{body->
            calls+=JSONObject(body.toString())
            val claim=if(body.getString("op")=="read")JSONObject().put("key",body.getString("rootKey")) else body
            reply(claim,"Old reply").also{it.remove("chatVersion")}
        },{now})
        try{
            c.bind(owner);c.availability(true,1,1,1);c.edit("hello?");c.send()
            assertEquals(listOf("start","read"),calls.map{it.getString("op")});assertEquals(1,calls.first().getInt("chatVersion"))
            assertFalse(calls.last().has("chatVersion")) // read is not a stripped-field dispatch retry.
            assertFalse(c.state.value.busy);assertTrue(c.state.value.timeline.none{it.text=="Old reply"})
            c.edit("hello?");c.send();assertEquals(2,calls.size)
            c.unbind();c.bind(owner);assertEquals(2,calls.size)
        }finally{scope.cancel()}
    }
    @Test fun oldMessageExpiryDoesNotEraseFreshDraftAndPendingReplySpaceRemainsBounded(){
        val scope=CoroutineScope(Dispatchers.Unconfined);val saved=Memory();var clock=now;var calls=0
        val c=HermesConversationController(scope,{saved},{body->calls++;reply(body,"Natural explanation "+"x".repeat(1900)).put("expiresAt",clock+HERMES_TTL_MS)
            .put("toolSummary",JSONObject().put("version",1).put("text","Actual tool facts "+"y".repeat(1900)))},{clock})
        try{
            c.bind(owner);c.availability(true,1,1,1);c.edit("First message");c.send()
            clock+=HERMES_TTL_MS-1000;c.edit("Fresh draft must survive")
            clock+=2000;c.expireText();assertEquals("Fresh draft must survive",c.state.value.draft)
            for(i in 1..20){c.edit("Independent message $i");c.send();assertTrue(c.state.value.storageReady)}
            assertEquals(21,calls);assertTrue(c.state.value.timeline.size<=HERMES_CHAT_MAX_ENTRIES)
            assertTrue(chatJson(c.state.value.timeline).toString().toByteArray(Charsets.UTF_8).size<=HERMES_CHAT_MAX_BYTES)
            c.edit("Saved newest draft");c.unbind();c.bind(owner)
            assertEquals("Saved newest draft",c.state.value.draft);assertEquals(21,calls)
            assertTrue(c.state.value.timeline.any{it.text.startsWith("Natural explanation")})
            assertTrue(c.state.value.timeline.any{it.text.startsWith("Actual tool facts")})
        }finally{scope.cancel()}
    }
}
