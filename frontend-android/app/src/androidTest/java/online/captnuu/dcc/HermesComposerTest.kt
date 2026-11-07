package online.captnuu.dcc
import androidx.compose.runtime.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.SemanticsProperties
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
    @Test fun inlineQuestionKeepsOriginalAndKeyboardEditable(){
        val wording="Should these study chunks use specific topics, or just general chunks? Give the task names, or say “just general chunks”."
        val question="""{"version":1,"rootKey":"conversation_root_01","turnKey":"conversation_root_01","expiresAt":9999999999999,"questions":1,"original":"Study 3 CSE354 chunks today","question":{"id":"${"b".repeat(64)}","reason":"task_topics","question":"$wording"},"receipt":{"version":1,"key":"conversation_root_01","outcome":"question","line":"Details needed","verified":0,"expected":null,"targets":[]}}"""
        compose.setContent { var state by remember{mutableStateOf(HermesState(draft="Study 3 CSE354 chunks today",view=question,rootKey="conversation_root_01",available=true))}
            DccTheme { ComposerViewport {HermesComposer(state,{state=state.copy(answer=it)},{},{},{})} }
        }
        compose.onNodeWithText(wording).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Original request: Study 3 CSE354 chunks today").assertExists()
        compose.onNodeWithText("Answer Hermes").performScrollTo().performTextInput("Lectures; practice problems; review")
        compose.onNodeWithText("Close details").performScrollTo().performClick()
        compose.onNodeWithText(wording).assertDoesNotExist()
        compose.onNodeWithText("Show question").performClick()
        compose.onNodeWithText("Lectures; practice problems; review").assertExists()
    }
    @Test fun compactHasNoLauncherOrChatPage(){compose.setContent{DccTheme{HermesComposer(HermesState(),{},{},{},{})}};compose.onNodeWithText("Hermes").assertIsDisplayed();compose.onNodeWithText("View").assertDoesNotExist();compose.onNodeWithText("Show question").assertDoesNotExist()}
    @Test fun confirmedCompletionCollapsesAndViewShowsServerIdsThenDismisses(){
        val fixture=fixtures();val q=fixture.getJSONObject("question");val done=fixture.getJSONObject("complete")
        var state by mutableStateOf(HermesState(draft=q.getString("original"),view=q.toString(),rootKey=q.getString("rootKey"),available=true))
        compose.setContent{DccTheme{ComposerViewport{HermesComposer(state,{state=state.copy(answer=it)},{state=HermesState(receipt=done.getJSONObject("receipt").toString(),available=true)},{},{state=state.copy(receipt=null)})}}}
        compose.onNodeWithText("Answer Hermes").performScrollTo().performClick().performTextInput("Lectures; practice problems; review")
        compose.onNodeWithText("Answer",useUnmergedTree=true).performScrollTo().performClick()
        compose.onNodeWithText(q.getJSONObject("question").getString("question")).assertDoesNotExist()
        compose.onNodeWithText("New request / cancel").assertDoesNotExist()
        compose.onNodeWithText("Hermes").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Added 3/3 tasks · 2026-11-07").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("View").performScrollTo().performClick()
        done.getJSONObject("receipt").getJSONArray("targets").objects().forEach { target->
            compose.onNodeWithText("${target.getString("action")}: ${target.getString("title")} · ${target.getString("date")}").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("${target.getString("kind")} · ${target.getString("id")} · ${target.getString("state")} · ${target.getString("verification")}").performScrollTo().assertIsDisplayed()
        }
        compose.onNodeWithText("Dismiss").performScrollTo().performClick();compose.onNodeWithText("View").assertDoesNotExist()
    }
    @Test fun partialAndTimeoutLeaveInputEditableAndNeverTurnIntoDone(){
        val r=JSONObject(fixtures().getJSONObject("complete").getJSONObject("receipt").toString())
        r.put("outcome","partial").put("verified",2).put("line","Incomplete: 2/3 tasks verified.");r.getJSONArray("targets").remove(2)
        assertTrue(validHermesReceipt(r))
        var state by mutableStateOf(HermesState(draft="Original request",receipt=r.toString(),rootKey="conversation_root_01",notice="Action not confirmed; effects may have saved."))
        compose.setContent{DccTheme{ComposerViewport{HermesComposer(state,{state=state.copy(draft=it)},{},{},{})}}}
        compose.onNodeWithText("Incomplete: 2/3 tasks verified.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Hermes").performScrollTo().performTextClearance()
        compose.onNodeWithText("Hermes").performTextInput("Editable new draft")
        compose.onNodeWithText("Editable new draft").assertExists();compose.onNodeWithText("Retry",substring=true).assertDoesNotExist()
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
            compose.onNodeWithText("Answer Hermes").performScrollTo().performClick().performTextInput("Lectures; practice problems; review")
            compose.onNodeWithText("Close details").performScrollTo().performClick()
            compose.activityRule.scenario.recreate()
            // Empty ComponentActivity only: never starts the real WorkspaceModel
            // or a network session. Reattach the same saved-state composition.
            compose.activityRule.scenario.onActivity{it.setContent(content=content)}
            compose.waitForIdle()
            compose.onNodeWithText("Show question").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("Answer Hermes").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("Lectures; practice problems; review").assertExists()
            compose.onNodeWithText("Show question").performClick()
            compose.onNodeWithText("Original request: "+fixture.getJSONObject("question").getString("original")).performScrollTo().assertIsDisplayed()
            assertEquals(1,calls)
        }finally{scope.cancel()}
    }
    @Test fun imeSendMovesExactTextToExpandableItemAndKeepsFreshDraftBesideReceipt(){
        val fixture=fixtures();val owner="a".repeat(64);val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        val memory=object:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){raw=null}}
        val gate=CompletableDeferred<JSONObject>();val requests=mutableListOf<JSONObject>()
        val controller=HermesConversationController(scope,{memory},{body->requests+=JSONObject(body.toString());gate.await()},{1794016800000L})
        val message="Synthetic submitted request with exact wording retained for review"
        try{
            compose.activityRule.scenario.onActivity{it.enableEdgeToEdge()}
            compose.runOnIdle{controller.bind(owner);controller.availability(true)}
            compose.setContent{
                val state by controller.state.collectAsStateWithLifecycle()
                CompositionLocalProvider(LocalInspectionMode provides true){DccTheme{
                    Workspace(WorkspaceState(signedIn=true,notice="Signed in",snapshots=mapOf("planner" to "{\"projects\":[],\"actions\":[]}","calendar" to "{\"events\":[],\"calendars\":[]}","mail" to "{\"messages\":[]}")),{_,_->},{},{},{_,_->},{_,_->},hermesContent={modifier->
                        HermesComposer(state,controller::edit,controller::send,controller::newRequest,controller::dismiss,controller::readReceipt,modifier=modifier,docked=true)
                    })
                }}
            }
            compose.onNodeWithTag("hermes-editor").performClick().performTextInput(message)
            compose.waitUntil(5000){compose.onAllNodesWithTag("main-navigation").fetchSemanticsNodes().isEmpty()}
            compose.onNodeWithTag("hermes-editor").performImeAction()
            assertEquals("",compose.onNodeWithTag("hermes-editor").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
            compose.onNodeWithTag("hermes-submitted").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText(message).assertExists()
            compose.onNodeWithText("Sent request · Sending — not confirmed saved").assertIsDisplayed()
            compose.onNodeWithTag("hermes-submitted").performClick()
            compose.onNodeWithText(message).assertIsDisplayed()
            compose.waitUntil(5000){compose.onAllNodesWithTag("main-navigation").fetchSemanticsNodes().isNotEmpty()}
            val dock=compose.onNodeWithTag("hermes-dock").fetchSemanticsNode().boundsInRoot
            val page=compose.onNodeWithTag("workspace-page").fetchSemanticsNode().boundsInRoot
            val editor=compose.onNodeWithTag("hermes-editor").fetchSemanticsNode().boundsInRoot
            assertTrue(page.height>0f&&page.bottom<=dock.top+1f)
            assertTrue(editor.height>0f&&editor.top>=dock.top-1f&&editor.bottom<=dock.bottom+1f)
            compose.runOnIdle{controller.send();assertEquals(1,requests.size)}
            compose.onNodeWithTag("hermes-editor").performTextInput("Fresh unsent draft")
            compose.runOnIdle{
                assertTrue(controller.state.value.busy)
                val body=requests.single();val complete=JSONObject(fixture.getJSONObject("complete").toString()).put("rootKey",body.getString("key")).put("turnKey",body.getString("key"))
                complete.getJSONObject("receipt").put("key",body.getString("key"));gate.complete(complete)
            }
            compose.onNodeWithTag("hermes-editor").assertTextContains("Fresh unsent draft")
            compose.onNodeWithText("Sent request · Saved · 3/3").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("View").performScrollTo().performClick()
            compose.onNodeWithText("task · synthetic-task-3 · applied · verified").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("Dismiss").performScrollTo().performClick()
            compose.onNodeWithTag("hermes-editor").assertTextContains("Fresh unsent draft")
            compose.runOnIdle{assertEquals(1,requests.size)}
        }finally{scope.cancel()}
    }
    @Test fun submittedPartialItemKeepsFreshEditorAndReceiptRecoveryWithoutClaimingSaved(){
        val fixture=fixtures().getJSONObject("complete");val receipt=JSONObject(fixture.getJSONObject("receipt").toString())
        receipt.put("outcome","partial").put("verified",2).put("line","Incomplete: 2/3 tasks verified.");receipt.getJSONArray("targets").remove(2)
        val sent=HermesSubmitted(fixture.getString("rootKey"),fixture.getString("turnKey"),"Exact submitted synthetic request",false,fixture.getLong("expiresAt"))
        compose.setContent{DccTheme{ComposerViewport{
            HermesComposer(HermesState(draft="Fresh unsent draft",receipt=receipt.toString(),rootKey=sent.rootKey,attemptKey=sent.turnKey,submitted=sent),{},{},{},{})
        }}}
        compose.onNodeWithTag("hermes-editor").assertTextContains("Fresh unsent draft")
        compose.onNodeWithText("Sent request · Partial · 2/3").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("hermes-submitted").performClick()
        compose.onNodeWithText("Exact submitted synthetic request").assertIsDisplayed()
        compose.onNodeWithText("Sent request · Saved · 3/3").assertDoesNotExist()
        compose.onNodeWithText("Check receipt").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("View").performScrollTo().performClick()
        compose.onNodeWithText("task · synthetic-task-2 · applied · verified").performScrollTo().assertIsDisplayed()
    }
}
