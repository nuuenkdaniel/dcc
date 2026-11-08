package online.captnuu.dcc
import android.view.KeyEvent
import androidx.compose.runtime.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.rules.RuleChain
import org.junit.Test
class HermesComposerTest {
    private val compose=createAndroidComposeRule<ComponentActivity>()
    @get:Rule val rules:RuleChain=RuleChain.outerRule(compose).around(SyntheticUiFailureArtifacts(compose))
    @Composable private fun ComposerViewport(content:@Composable ()->Unit){
        // Apply the cap within the real IME-adjusted viewport, not before it.
        Box(Modifier.fillMaxSize().imePadding().testTag("composer-ime-viewport")){
            Column(Modifier.width(320.dp).heightIn(max=280.dp).verticalScroll(rememberScrollState()).testTag("composer-test-scroll")){content()}
        }
    }
    private fun fixtures():JSONObject=InstrumentationRegistry.getInstrumentation().context.assets.open("hermes-conversation.json").bufferedReader().use{JSONObject(it.readText())}
    private fun openChat(){compose.onNodeWithTag("hermes-editor").performClick();compose.onNodeWithTag("hermes-chat").assertIsDisplayed()}
    private fun pressAndroidBack(){
        compose.waitForIdle()
        // Inject a real Back key through the focused window/IME, not a UI callback.
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        compose.waitForIdle()
    }
    private fun show(text:String){compose.showHermesChatText(text)}
    private fun completed(state:HermesState,done:JSONObject):HermesState {
        val q=JSONObject(state.view!!)
        val sent=HermesSubmitted(done.getString("rootKey"),done.getString("turnKey"),state.answer,true,done.getLong("expiresAt"),q.getString("turnKey"),q.getJSONObject("question").getString("id"))
        return projectChat(HermesState(receipt=done.getJSONObject("receipt").toString(),submitted=sent,timeline=visibleChat(state),historyReady=true),0L)
    }
    @Test fun chatQuestionKeepsOriginalUserBubbleAndEditableAnswerAcrossUiClose(){
        val wording="Should these study chunks use specific topics, or just general chunks? Give the task names, or say “just general chunks”."
        val question="""{"version":1,"rootKey":"conversation_root_01","turnKey":"conversation_root_01","expiresAt":9999999999999,"questions":1,"original":"Study 3 CSE354 chunks today","question":{"id":"${"b".repeat(64)}","reason":"task_topics","question":"$wording"},"receipt":{"version":1,"key":"conversation_root_01","outcome":"question","line":"Details needed","verified":0,"expected":null,"targets":[]}}"""
        compose.setContent { var state by remember{mutableStateOf(HermesState(draft="Study 3 CSE354 chunks today",view=question,rootKey="conversation_root_01",available=true))}
            DccTheme { ComposerViewport {HermesComposer(state,{state=state.copy(answer=it)},{},{},{})} }
        }
        openChat();show(wording);show("Study 3 CSE354 chunks today")
        compose.onNodeWithTag("hermes-chat-editor").performTextInput("Lectures; practice problems; review")
        compose.onNodeWithContentDescription("Close chat").performClick()
        compose.onNodeWithTag("hermes-chat").assertDoesNotExist()
        openChat();compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Lectures; practice problems; review")
        show(wording)
    }
    @Test fun compactHasNoLauncherOrChatPage(){compose.setContent{DccTheme{HermesComposer(HermesState(),{},{},{},{})}};compose.onNodeWithText("Hermes").assertIsDisplayed();compose.onNodeWithText("View").assertDoesNotExist();compose.onNodeWithText("Show question").assertDoesNotExist()}
    @Test fun compactPillHas48dpTargetAndRecoveryIsAvailableOnlyThroughAccessibleOverflow(){
        var reads=0;var fences=0
        compose.setContent{DccTheme{HermesComposer(HermesState(rootKey="synthetic_root_01"),{},{},{fences++},{},onRead={reads++})}}
        val pill=compose.onNodeWithTag("hermes-editor").getUnclippedBoundsInRoot()
        assertTrue((pill.bottom-pill.top).value>=48f)
        openChat()
        compose.onNodeWithText("Check receipt").assertDoesNotExist();compose.onNodeWithText("Close unresolved request").assertDoesNotExist()
        compose.onNodeWithContentDescription("Conversation actions").performClick()
        compose.onNodeWithText("Check receipt").assertIsDisplayed().performClick()
        assertEquals(1,reads)
        compose.onNodeWithContentDescription("Close chat").performClick()
        assertEquals(0,fences);compose.onNodeWithTag("hermes-chat").assertDoesNotExist()
    }
    @OptIn(ExperimentalTestApi::class)
    @Test fun firstCharacterOpensWithoutSendAndSelectionDraftSurviveCloseAndAndroidBack(){
        var state by mutableStateOf(HermesState())
        var sends=0;var cancels=0;var clears=0
        compose.setContent{DccTheme{HermesComposer(state,{state=state.copy(draft=it)},{sends++},{cancels++},{clears++})}}
        compose.onNodeWithTag("hermes-editor").performTextInput("S")
        compose.onNodeWithTag("hermes-chat").assertIsDisplayed()
        compose.onNodeWithTag("hermes-chat-editor").assertTextContains("S")
        compose.onNodeWithTag("hermes-chat-editor").performTextInput("ynthetic draft")
        compose.onNodeWithTag("hermes-chat-editor").performTextInputSelection(TextRange(2,7))
        assertEquals(TextRange(2,7),compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange])
        compose.onNodeWithContentDescription("Close chat").performClick();openChat()
        assertEquals(TextRange(2,7),compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange])
        pressAndroidBack()
        compose.onNodeWithTag("hermes-chat").assertDoesNotExist()
        compose.onNodeWithTag("hermes-editor").assertTextContains("Synthetic draft")
        compose.runOnIdle{assertEquals(0,sends);assertEquals(0,cancels);assertEquals(0,clears)}
    }
    @Test fun ownerChangeDismissesOldChatAndDoesNotExposePreviousOwnersDraft(){
        var state by mutableStateOf(HermesState(draft="Synthetic owner A draft",ownerKey="a".repeat(64)))
        compose.setContent{DccTheme{HermesComposer(state,{state=state.copy(draft=it)},{},{},{})}}
        openChat();compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Synthetic owner A draft")
        compose.runOnIdle{state=HermesState(ownerKey="b".repeat(64))}
        compose.onNodeWithTag("hermes-chat").assertDoesNotExist()
        compose.onNodeWithText("Synthetic owner A draft").assertDoesNotExist()
        openChat();assertEquals("",compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
    }
    @Test fun confirmedCompletionStaysOpenWithHistoryAndInspectableTargetsUntilExplicitClose(){
        val fixture=fixtures();val q=fixture.getJSONObject("question");val done=fixture.getJSONObject("complete")
        var state by mutableStateOf(HermesState(draft=q.getString("original"),view=q.toString(),rootKey=q.getString("rootKey"),available=true))
        compose.setContent{DccTheme{ComposerViewport{HermesComposer(state,{state=state.copy(answer=it)},{state=completed(state,done)},{},{})}}}
        openChat();compose.onNodeWithTag("hermes-chat-editor").performTextInput("Lectures; practice problems; review")
        compose.onNodeWithTag("hermes-chat-editor").performImeAction()
        compose.onNodeWithTag("hermes-chat").assertIsDisplayed()
        assertEquals("",compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        show("Added 3/3 tasks · 2026-11-07");show(q.getJSONObject("question").getString("question"))
        compose.onNodeWithTag("hermes-chat-history").performScrollToNode(hasText("View"));compose.onNodeWithText("View").performClick()
        done.getJSONObject("receipt").getJSONArray("targets").objects().forEach { target->
            show("${target.getString("action")}: ${target.getString("title")} · ${target.getString("date")}")
            show("${target.getString("kind")} · ${target.getString("id")} · ${target.getString("state")} · ${target.getString("verification")}")
        }
        compose.onNodeWithContentDescription("Close chat").performClick();compose.onNodeWithTag("hermes-chat").assertDoesNotExist()
        openChat();show("Added 3/3 tasks · 2026-11-07")
    }
    @Test fun partialAndTimeoutLeaveInputEditableAndNeverTurnIntoDone(){
        val r=JSONObject(fixtures().getJSONObject("complete").getJSONObject("receipt").toString())
        r.put("outcome","partial").put("verified",2).put("line","Incomplete: 2/3 tasks verified.");r.getJSONArray("targets").remove(2)
        assertTrue(validHermesReceipt(r))
        var state by mutableStateOf(HermesState(draft="Original request",receipt=r.toString(),rootKey="conversation_root_01",notice="Action not confirmed; effects may have saved."))
        compose.setContent{DccTheme{ComposerViewport{HermesComposer(state,{state=state.copy(draft=it)},{},{},{})}}}
        openChat();show("Incomplete: 2/3 tasks verified.")
        compose.onNodeWithTag("hermes-chat-editor").performTextReplacement("Editable new draft")
        compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Editable new draft");compose.onNodeWithText("Retry",substring=true).assertDoesNotExist()
        compose.onNodeWithText("Added 3/3 tasks",substring=true).assertDoesNotExist()
    }
    @Test fun activityRecreationRetainsLinkedIntentAnswerAndClosedDisclosureInShortImeLayout(){
        val fixture=fixtures();val owner="a".repeat(64);val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        val memory=object:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){raw=null}}
        var calls=0
        val controller=HermesConversationController(scope,{memory},{body->
            calls++;assertEquals("start",body.getString("op"))
            JSONObject(fixture.getJSONObject("question").toString()).put("rootKey",body.getString("key")).put("turnKey",body.getString("key")).also{it.getJSONObject("receipt").put("key",body.getString("key"))}
        },{1794016800000L})
        val content:@Composable ()->Unit={
            val state by controller.state.collectAsStateWithLifecycle()
            DccTheme{ComposerViewport{HermesComposer(state,controller::edit,controller::send,controller::newRequest,controller::dismiss,controller::readReceipt)}}
        }
        try{
            compose.setContent(content)
            compose.runOnIdle{controller.bind(owner);controller.availability(true);controller.edit(fixture.getJSONObject("question").getString("original"));controller.send()}
            openChat();compose.onNodeWithTag("hermes-chat-editor").performTextInput("Lectures; practice problems; review")
            compose.activityRule.scenario.recreate()
            // Empty ComponentActivity only: never starts the real WorkspaceModel
            // or a network session. Reattach the same saved-state composition.
            compose.activityRule.scenario.onActivity{it.setContent(content=content)}
            compose.waitForIdle()
            compose.onNodeWithTag("hermes-chat").assertIsDisplayed()
            compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Lectures; practice problems; review")
            show(fixture.getJSONObject("question").getString("original"))
            compose.onNodeWithContentDescription("Close chat").performClick();openChat()
            compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Lectures; practice problems; review")
            assertEquals(1,calls)
        }finally{scope.cancel()}
    }
    @Test fun imeSendCloseWhileBusyAndQuietCompletionReopenPreserveExactTurnAndFreshDraft(){
        val trace=SyntheticUiStageTrace("HermesComposerTest.imeSendCloseWhileBusyAndQuietCompletionReopenPreserveExactTurnAndFreshDraft")
        val fixture=fixtures();val owner="a".repeat(64);val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        val memory=object:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){raw=null}}
        val gate=CompletableDeferred<JSONObject>();val requests=mutableListOf<JSONObject>()
        val controller=HermesConversationController(scope,{memory},{body->requests+=JSONObject(body.toString());gate.await()},{1794016800000L})
        val message="Synthetic submitted request with exact wording retained for review"
        try{
            trace.stage("edge-to-edge"){compose.activityRule.scenario.onActivity{it.enableEdgeToEdge()}}
            trace.stage("bind synthetic owner"){compose.runOnIdle{controller.bind(owner);controller.availability(true)}}
            trace.stage("setContent"){compose.setContent{
                val state by controller.state.collectAsStateWithLifecycle()
                CompositionLocalProvider(LocalInspectionMode provides true){DccTheme{
                    Workspace(WorkspaceState(signedIn=true,notice="Signed in",snapshots=mapOf("planner" to "{\"projects\":[],\"actions\":[]}","calendar" to "{\"events\":[],\"calendars\":[]}","mail" to "{\"messages\":[]}")),{_,_->},{},{},{_,_->},{_,_->},hermesContent={modifier->
                        HermesComposer(state,controller::edit,controller::send,controller::newRequest,controller::dismiss,controller::readReceipt,modifier=modifier,docked=true)
                    })
                }}
            }}
            trace.stage("open chat: compact field click"){compose.onNodeWithTag("hermes-editor").performClick()}
            trace.stage("open chat: assert modal displayed"){compose.onNodeWithTag("hermes-chat").assertIsDisplayed()}
            trace.stage("type initial request"){compose.onNodeWithTag("hermes-chat-editor").performTextInput(message)}
            trace.stage("IME send initial request"){compose.onNodeWithTag("hermes-chat-editor").performImeAction()}
            trace.stage("assert empty editor and show pending turn"){
            assertEquals("",compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
            show(message);show("Sending — no saved effects confirmed.")
            }
            trace.stage("reject duplicate send"){
            compose.runOnIdle{controller.send();assertEquals(1,requests.size)}
            }
            trace.stage("type fresh draft while busy"){compose.onNodeWithTag("hermes-chat-editor").performTextInput("Fresh unsent draft")}
            trace.stage("X close while busy"){compose.onNodeWithContentDescription("Close chat").performClick()}
            trace.stage("assert busy survives close and reserved workspace geometry"){
            compose.onNodeWithTag("hermes-chat").assertDoesNotExist()
            compose.runOnIdle{assertTrue(controller.state.value.busy);assertFalse(gate.isCancelled);assertEquals(listOf("start"),requests.map{it.getString("op")})}
            val dock=compose.onNodeWithTag("hermes-dock").fetchSemanticsNode().boundsInRoot
            val page=compose.onNodeWithTag("workspace-page").fetchSemanticsNode().boundsInRoot
            val editor=compose.onNodeWithTag("hermes-editor").fetchSemanticsNode().boundsInRoot
            assertTrue(page.height>0f&&page.bottom<=dock.top+1f)
            assertTrue(editor.height>0f&&editor.top>=dock.top-1f&&editor.bottom<=dock.bottom+1f)
            }
            trace.stage("complete synthetic request while closed"){
            compose.runOnIdle{
                assertTrue(controller.state.value.busy)
                val body=requests.single();val complete=JSONObject(fixture.getJSONObject("complete").toString()).put("rootKey",body.getString("key")).put("turnKey",body.getString("key"))
                complete.getJSONObject("receipt").put("key",body.getString("key"));gate.complete(complete)
            }
            }
            trace.stage("assert quiet completion and retained draft"){
            compose.onNodeWithTag("hermes-chat").assertDoesNotExist()
            compose.onNodeWithTag("hermes-editor").assertTextContains("Fresh unsent draft")
            compose.onNodeWithText("View").assertDoesNotExist();compose.onNodeWithText("Check receipt").assertDoesNotExist()
            }
            trace.stage("reopen completed chat"){openChat()}
            trace.stage("show admitted request and completion"){show(message);show("Added 3/3 tasks · 2026-11-07")}
            trace.stage("open receipt View"){
            compose.onNodeWithTag("hermes-chat-history").performScrollToNode(hasText("View"));compose.onNodeWithText("View").performClick()
            }
            trace.stage("show third verified target"){
            show("task · synthetic-task-3 · applied · verified")
            }
            trace.stage("assert fresh draft and no duplicate turn"){
            compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Fresh unsent draft")
            compose.runOnIdle{assertEquals(1,requests.size);assertEquals(2,controller.state.value.timeline.size)}
            }
            trace.stage("actual Android Back"){pressAndroidBack()}
            trace.stage("assert Back closes and reopen retains draft"){
            compose.onNodeWithTag("hermes-chat").assertDoesNotExist()
            openChat();compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Fresh unsent draft")
            }
        }finally{trace.stage("cancel synthetic scope"){scope.cancel()}}
    }
    @Test fun submittedPartialItemKeepsFreshEditorAndReceiptRecoveryWithoutClaimingSaved(){
        val fixture=fixtures().getJSONObject("complete");val receipt=JSONObject(fixture.getJSONObject("receipt").toString())
        receipt.put("outcome","partial").put("verified",2).put("line","Incomplete: 2/3 tasks verified.");receipt.getJSONArray("targets").remove(2)
        val sent=HermesSubmitted(fixture.getString("rootKey"),fixture.getString("turnKey"),"Exact submitted synthetic request",false,fixture.getLong("expiresAt"))
        compose.setContent{DccTheme{ComposerViewport{
            HermesComposer(HermesState(draft="Fresh unsent draft",receipt=receipt.toString(),rootKey=sent.rootKey,attemptKey=sent.turnKey,submitted=sent),{},{},{},{})
        }}}
        compose.onNodeWithTag("hermes-editor").assertTextContains("Fresh unsent draft")
        openChat();show("Incomplete: 2/3 tasks verified.");show("Exact submitted synthetic request")
        compose.onNodeWithText("Added 3/3 tasks",substring=true).assertDoesNotExist()
        compose.onNodeWithText("Check receipt").assertDoesNotExist()
        compose.onNodeWithContentDescription("Conversation actions").performClick()
        compose.onNodeWithText("Check receipt").assertIsDisplayed().performClick()
        compose.onNodeWithTag("hermes-chat-history").performScrollToNode(hasText("View"));compose.onNodeWithText("View").performClick()
        show("task · synthetic-task-2 · applied · verified")
    }
}
