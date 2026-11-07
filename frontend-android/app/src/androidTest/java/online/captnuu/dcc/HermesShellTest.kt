package online.captnuu.dcc

import androidx.activity.ComponentActivity
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.view.inputmethod.InputMethodManager
import android.view.WindowInsets
import android.graphics.Bitmap
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.filters.SdkSuppress
import java.io.File
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Rule
import org.junit.rules.RuleChain
import org.junit.Test

// Real shell/composer/LazyColumn geometry, synthetic wire data only. No real
// WorkspaceModel, auth cookie, mail/provider request, timer service or signing.
class HermesShellTest {
    private val compose=createAndroidComposeRule<ComponentActivity>()
    @get:Rule val rules:RuleChain=RuleChain.outerRule(compose).around(SyntheticUiFailureArtifacts(compose))
    private fun fixtures()=InstrumentationRegistry.getInstrumentation().context.assets.open("hermes-conversation.json").bufferedReader().use{JSONObject(it.readText())}
    private fun workspace():WorkspaceState {
        val messages=(0 until 30).map { i->val id=i.toString(16).padStart(64,'0')
            JSONObject().put("id",id).put("account","personal").put("override",JSONObject.NULL).put("analysis",JSONObject().put("important",true).put("summary","Synthetic summary"))
                .put("data",JSONObject().put("id",id).put("account","personal").put("subject","Synthetic message $i").put("sender","synthetic@example.invalid").put("receivedAt","2000-01-01T12:00:00Z").put("body","Synthetic plain text").put("attachments",JSONArray()))
        }
        return WorkspaceState(signedIn=true,notice="Signed in",snapshots=mapOf("planner" to "{\"projects\":[],\"actions\":[]}","calendar" to "{\"events\":[],\"calendars\":[]}","mail" to JSONObject().put("messages",JSONArray(messages)).put("briefing",JSONArray()).put("accounts",JSONArray()).put("total",30).put("nextCursor",JSONObject.NULL).toString(),"prices" to "{\"items\":[{\"title\":\"Archived item must not render\"}]}"))
    }
    @Composable private fun Shell(state:HermesState,onEdit:(String)->Unit={},onSend:()->Unit={},onDismiss:()->Unit={}){
        val density=LocalDensity.current
        CompositionLocalProvider(LocalInspectionMode provides true,LocalDensity provides Density(density.density,1.4f)){
            DccTheme {Box(Modifier.width(360.dp).height(600.dp)){
                Workspace(workspace(),{_,_->},{},{},{_,_->},{_,_->},initialDestination=Destination.Inbox,hermesContent={modifier->
                    HermesComposer(state,onEdit,onSend,{},{onDismiss()},modifier=modifier,docked=true)
                })
            }}
        }
    }
    private fun assertReservedGeometry(){
        val dock=compose.onNodeWithTag("hermes-dock").fetchSemanticsNode().boundsInRoot
        val page=compose.onNodeWithTag("workspace-page").fetchSemanticsNode().boundsInRoot
        val editor=compose.onNode(hasSetTextAction() and hasText("Hermes",substring=true)).fetchSemanticsNode().boundsInRoot
        assertTrue("Page must retain a positive viewport: $page",page.height>0f&&page.width>0f)
        assertTrue("Pinned editor must have positive bounds: $editor",editor.height>0f&&editor.width>0f)
        assertTrue("Page must end before the dock, never under it",page.bottom<=dock.top+1f)
        assertTrue("Typeable editor stays inside the reserved dock",editor.top>=dock.top-1f&&editor.bottom<=dock.bottom+1f)
        val nav=compose.onAllNodesWithTag("main-navigation").fetchSemanticsNodes().firstOrNull()?.boundsInRoot
        if(nav!=null)assertTrue("Dock must sit immediately above bottom navigation",kotlin.math.abs(dock.bottom-nav.top)<=1f)
    }
    private fun dismissKeyboard(){
        compose.runOnIdle{val activity=compose.activity;(activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(activity.window.decorView.windowToken,0)}
        compose.waitUntil(5000){compose.onAllNodesWithTag("main-navigation").fetchSemanticsNodes().isNotEmpty()}
    }
    @SdkSuppress(minSdkVersion=30)
    private fun fullWindowGeometry(expectIme:Boolean):String {
        var width=0;var height=0;var imeBottom=0;var imeVisible=false;var fontScale=0f;var density=0f
        compose.runOnIdle{
            val decor=compose.activity.window.decorView
            width=decor.width;height=decor.height;fontScale=decor.resources.configuration.fontScale;density=decor.resources.displayMetrics.density
            val insets=checkNotNull(decor.rootWindowInsets){"Full-window insets unavailable"}
            imeBottom=insets.getInsets(WindowInsets.Type.ime()).bottom
            imeVisible=insets.isVisible(WindowInsets.Type.ime())
        }
        val root=compose.onRoot().fetchSemanticsNode().boundsInRoot
        val dock=compose.onNodeWithTag("hermes-dock").fetchSemanticsNode().boundsInRoot
        val page=compose.onNodeWithTag("workspace-page").fetchSemanticsNode().boundsInRoot
        val editor=compose.onNode(hasSetTextAction() and hasText("Hermes",substring=true)).fetchSemanticsNode().boundsInRoot
        val unclippedEditor=compose.onNode(hasSetTextAction() and hasText("Hermes",substring=true)).getUnclippedBoundsInRoot()
        val nav=compose.onAllNodesWithTag("main-navigation").fetchSemanticsNodes().firstOrNull()?.boundsInRoot
        val keyboardTop=height-imeBottom
        val bounds="window=${width}x$height fontScale=$fontScale density=$density root=$root page=$page dock=$dock editor=$editor unclippedEditorDp=$unclippedEditor nav=$nav imeVisible=$imeVisible imeBottom=$imeBottom keyboardTop=$keyboardTop"
        assertTrue("Root must fill the actual edge-to-edge window: $bounds",width>0&&height>0&&kotlin.math.abs(root.width-width)<=1f&&kotlin.math.abs(root.height-height)<=1f)
        assertTrue("Dock must span the window with positive page space: $bounds",kotlin.math.abs(dock.left-root.left)<=1f&&kotlin.math.abs(dock.right-root.right)<=1f&&page.height>0f&&page.width>0f&&page.bottom<=dock.top+1f)
        assertTrue("Editor must be fully inside the reserved dock: $bounds",editor.height>0f&&editor.width>0f&&editor.left>=dock.left-1f&&editor.right<=dock.right+1f&&editor.top>=dock.top-1f&&editor.bottom<=dock.bottom+1f)
        assertTrue("Editor must be fully visible, not clipped: $bounds",kotlin.math.abs(editor.width-(unclippedEditor.right-unclippedEditor.left).value*density)<=1f&&kotlin.math.abs(editor.height-(unclippedEditor.bottom-unclippedEditor.top).value*density)<=1f)
        if(expectIme){
            assertTrue("A real visible IME with positive inset is required: $bounds",imeVisible&&imeBottom>0)
            assertTrue("Dock/editor must sit above the actual keyboard, without a gap: $bounds",nav==null&&kotlin.math.abs(dock.bottom-keyboardTop)<=1f&&editor.bottom<=keyboardTop+1f)
        }else{
            assertTrue("Keyboard must be hidden and navigation restored: $bounds",!imeVisible&&imeBottom==0&&nav!=null)
            assertTrue("Dock must meet navigation at the real window bottom: $bounds",nav!=null&&kotlin.math.abs(dock.bottom-nav.top)<=1f&&kotlin.math.abs(nav.bottom-height)<=1f)
        }
        return bounds
    }
    @SdkSuppress(minSdkVersion=30)
    private fun captureFullWindow(name:String,expectIme:Boolean){
        var previous:String?=null;var lastFailure:Throwable?=null
        try{
            compose.waitUntil(5000){
                val current=try{fullWindowGeometry(expectIme)}catch(error:AssertionError){lastFailure=error;null}
                val stable=current!=null&&current==previous;previous=current;stable
            }
        }catch(error:Throwable){throw AssertionError("Full-window capture $name did not reach stable geometry: ${lastFailure?.message}",error)}
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val directory=checkNotNull(instrumentation.targetContext.getExternalFilesDir("qa-ui-captures"))
        check(directory.isDirectory||directory.mkdirs())
        val image=checkNotNull(instrumentation.uiAutomation.takeScreenshot()){"Screenshot unavailable for $name"}
        val png=File(directory,"$name.png")
        try{png.outputStream().use{check(image.compress(Bitmap.CompressFormat.PNG,100,it))}}finally{image.recycle()}
        File(directory,"$name.txt").writeText(checkNotNull(previous)+"\n"+compose.onRoot(useUnmergedTree=true).printToString())
        println("QA_UI_CAPTURE ${png.absolutePath}")
    }
    @Test @SdkSuppress(minSdkVersion=30)
    fun fullWindowVisualAcceptanceCompactQuestionImeAndCompleteReceipt(){
        val fixture=fixtures();val q=fixture.getJSONObject("question");val done=fixture.getJSONObject("complete")
        var hermes by mutableStateOf(HermesState(available=true))
        // Match MainActivity.onCreate: edge-to-edge, no extra soft-input flags.
        // Use the natural system density/font and full window: no capped Box.
        compose.activityRule.scenario.onActivity{it.enableEdgeToEdge()}
        compose.setContent{
            CompositionLocalProvider(LocalInspectionMode provides true){DccTheme{
                Workspace(workspace(),{_,_->},{},{},{_,_->},{_,_->},initialDestination=Destination.Inbox,hermesContent={modifier->
                    HermesComposer(hermes,{hermes=hermes.copy(answer=it)},{
                        assertEquals("Lectures; practice problems; review",hermes.answer)
                        hermes=HermesState(receipt=done.getJSONObject("receipt").toString(),available=true)
                    },{},{hermes=hermes.copy(receipt=null)},modifier=modifier,docked=true)
                })
            }}
        }
        compose.onNodeWithText("Hermes").assertIsDisplayed()
        captureFullWindow("full-window-compact",expectIme=false)
        compose.runOnIdle{hermes=HermesState(draft=q.getString("original"),view=q.toString(),rootKey=q.getString("rootKey"),available=true)}
        compose.onNodeWithText("Answer Hermes").performClick().performTextInput("Lectures; practice problems; review")
        captureFullWindow("full-window-question-ime",expectIme=true)
        compose.onNodeWithText("Lectures; practice problems; review").assertExists()
        compose.onNodeWithText("Answer Hermes").performImeAction()
        compose.onNodeWithText("Answer Hermes").assertDoesNotExist()
        compose.onNodeWithText(q.getJSONObject("question").getString("question")).assertDoesNotExist()
        dismissKeyboard()
        compose.onNodeWithText("Added 3/3 tasks · 2026-11-07").performScrollTo().assertIsDisplayed()
        assertEquals("",compose.onNodeWithText("Hermes").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        captureFullWindow("full-window-complete",expectIme=false)
        compose.onNodeWithText("View").performScrollTo().performClick()
        done.getJSONObject("receipt").getJSONArray("targets").objects().forEach { target->
            compose.onNodeWithText("${target.getString("kind")} · ${target.getString("id")} · ${target.getString("state")} · ${target.getString("verification")}").performScrollTo().assertIsDisplayed()
        }
        compose.onNodeWithText("Hide receipt").performScrollTo().assertIsDisplayed()
        captureFullWindow("full-window-receipt-view",expectIme=false)
        compose.onNodeWithText("Dismiss").performScrollTo().performClick()
        compose.onNodeWithText("View").assertDoesNotExist()
        compose.onNodeWithTag("main-navigation").assertIsDisplayed()
        compose.onNode(hasText("Projects") and hasAnyAncestor(hasTestTag("main-navigation"))).performClick()
        compose.onNodeWithText("Hermes").assertIsDisplayed()
        compose.onNode(hasText("Inbox") and hasAnyAncestor(hasTestTag("main-navigation"))).performClick()
        compose.onNodeWithText("Hermes").assertIsDisplayed()
    }
    @Test fun lowerDockSurvivesNavigationWithoutLosingDraftOrInboxQuery(){
        var hermes by mutableStateOf(HermesState(available=true))
        compose.setContent{Shell(hermes,{hermes=hermes.copy(draft=it)})}
        assertReservedGeometry();compose.onNodeWithText("Search email").performScrollTo().performTextInput("Synthetic")
        dismissKeyboard()
        compose.onNodeWithText("personal").performScrollTo().performClick()
        compose.onNodeWithText("Important only").performScrollTo().performClick()
        compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("Synthetic message 29"))
        compose.onNodeWithText("Hermes").performClick().performTextInput("Draft stays in the thumb band")
        dismissKeyboard()
        for(tab in listOf("Projects","Focus","Today","Inbox")){
            compose.onNodeWithText(tab,useUnmergedTree=true).performClick()
            compose.onNodeWithText("Draft stays in the thumb band").assertExists();assertReservedGeometry()
        }
        compose.onNodeWithText("Synthetic message 29").assertIsDisplayed()
        compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("Search email"))
        compose.onNodeWithText("Search email").assertTextContains("Synthetic")
        compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("personal"))
        compose.onNodeWithText("personal").assertIsSelected()
        compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("Important only"))
        compose.onNodeWithText("Important only").assertIsOn()
        compose.onNodeWithText("Prices",useUnmergedTree=true).assertDoesNotExist();compose.onNodeWithText("Archived item must not render").assertDoesNotExist()
    }
    @Test fun allInboxControlsScrollAwayWhileMessagesAndDockRemainReachable(){
        var hermes by mutableStateOf(HermesState(available=true))
        compose.setContent{Shell(hermes)}
        compose.onNodeWithText("Mail settings & sync").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("Synthetic message 29"))
        compose.onNodeWithText("Synthetic message 29").assertIsDisplayed()
        for(label in listOf("Search email","personal","Important only","Search all mail","Reset","Mail settings & sync"))compose.onNodeWithText(label).assertDoesNotExist()
        compose.onNodeWithText("Hermes").assertIsDisplayed();assertReservedGeometry()
        val scrollBefore=compose.onNodeWithTag("inbox-list").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        val q=fixtures().getJSONObject("question")
        compose.runOnIdle{hermes=HermesState(draft=q.getString("original"),view=q.toString(),rootKey=q.getString("rootKey"),available=true)}
        // Identify editor/geometry failures separately from list reachability.
        compose.onNodeWithText("Answer Hermes").assertIsDisplayed()
        assertReservedGeometry()
        val listAfter=compose.onNodeWithTag("inbox-list").fetchSemanticsNode().boundsInRoot
        assertTrue("Expanded dock must leave a positive Inbox viewport: $listAfter",listAfter.height>0f&&listAfter.width>0f)
        val scrollAfter=compose.onNodeWithTag("inbox-list").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertEquals("Dock expansion must retain the list's first-visible scroll anchor",scrollBefore,scrollAfter,0f)
        // Shrinking the viewport may legitimately move the former bottom item
        // below it. It must remain reachable, not necessarily already visible.
        compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("Synthetic message 29"))
        compose.onNodeWithText("Synthetic message 29").assertIsDisplayed()
        compose.onNodeWithText("Answer Hermes").assertIsDisplayed()
        assertReservedGeometry()
        compose.runOnIdle{hermes=HermesState(available=true)}
        compose.onNodeWithTag("inbox-list").performScrollToIndex(0)
        compose.onNodeWithText("Search email").assertIsDisplayed()
    }
    @Test fun boundedQuestionReceiptAndImeEditorSurviveActivityRecreationThenCollapse(){
        val fixture=fixtures();val q=fixture.getJSONObject("question");val done=fixture.getJSONObject("complete")
        var hermes by mutableStateOf(HermesState(draft=q.getString("original"),view=q.toString(),rootKey=q.getString("rootKey"),available=true))
        val content:@Composable ()->Unit={Shell(hermes,{hermes=hermes.copy(answer=it)},{hermes=HermesState(receipt=done.getJSONObject("receipt").toString(),available=true)},{hermes=hermes.copy(receipt=null)})}
        compose.setContent(content);assertReservedGeometry()
        val dock=compose.onNodeWithTag("hermes-dock").fetchSemanticsNode().boundsInRoot
        val page=compose.onNodeWithTag("workspace-page").fetchSemanticsNode().boundsInRoot
        assertTrue("Expanded disclosure must leave a page viewport",page.height>0&&dock.height<page.height+dock.height)
        assertTrue(compose.onNodeWithTag("inbox-list").fetchSemanticsNode().boundsInRoot.height>0)
        compose.onNodeWithText("Answer Hermes").performClick().performTextInput("Lectures; practice problems; review")
        compose.waitUntil(5000){compose.onAllNodesWithTag("main-navigation").fetchSemanticsNodes().isEmpty()}
        assertReservedGeometry()
        compose.onNodeWithText("Lectures; practice problems; review").assertExists()
        compose.activityRule.scenario.recreate();compose.activityRule.scenario.onActivity{it.setContent(content=content)};compose.waitForIdle()
        compose.onNodeWithText("Lectures; practice problems; review").assertExists();assertReservedGeometry()
        // Only the disclosure scrolls; the input is pinned inside the dock.
        compose.onNodeWithText("Answer",useUnmergedTree=true).performScrollTo().performClick()
        compose.onNodeWithText("Answer Hermes").assertDoesNotExist();compose.onNodeWithText("Hermes").assertIsDisplayed()
        compose.onNodeWithText("View").performScrollTo().performClick()
        compose.onNodeWithText("task · synthetic-task-3 · applied · verified").performScrollTo().assertIsDisplayed()
        assertReservedGeometry();compose.onNodeWithText("Dismiss").performScrollTo().performClick();compose.onNodeWithText("View").assertDoesNotExist()
    }
    @Test fun landscapeRotationRetainsQuestionAnswerAndReservedDock(){
        val q=fixtures().getJSONObject("question")
        var hermes by mutableStateOf(HermesState(draft=q.getString("original"),view=q.toString(),rootKey=q.getString("rootKey"),available=true))
        val content:@Composable ()->Unit={Shell(hermes,{hermes=hermes.copy(answer=it)})}
        compose.setContent(content)
        compose.onNodeWithText("Answer Hermes").performTextInput("Retained synthetic answer")
        dismissKeyboard()
        try{
            compose.activityRule.scenario.onActivity{it.requestedOrientation=ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE}
            compose.waitUntil(5000){compose.activity.resources.configuration.orientation==Configuration.ORIENTATION_LANDSCAPE}
            compose.activityRule.scenario.onActivity{it.setContent(content=content)}
            compose.onNodeWithText("Retained synthetic answer").assertExists();assertReservedGeometry()
            compose.onNodeWithText("Show question").assertDoesNotExist()
            compose.onNodeWithText("Close details").performScrollTo().assertIsDisplayed()
        }finally{
            compose.activityRule.scenario.onActivity{it.requestedOrientation=ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED}
        }
    }
}
