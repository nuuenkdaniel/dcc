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
import androidx.compose.ui.geometry.Rect
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
import kotlinx.coroutines.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.junit.Assert.*
import org.junit.Rule
import org.junit.rules.RuleChain
import org.junit.Test
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody.Companion.toResponseBody
import java.util.concurrent.CopyOnWriteArrayList

// Real shell/composer/LazyColumn geometry, synthetic wire data only. No real
// WorkspaceModel, auth cookie, mail/provider request, timer service or signing.
class HermesShellTest {
    private val compose=createAndroidComposeRule<ComponentActivity>()
    private val failureArtifacts=SyntheticUiFailureArtifacts(compose)
    @get:Rule val rules:RuleChain=RuleChain.outerRule(compose).around(failureArtifacts)
    private fun fixtures()=InstrumentationRegistry.getInstrumentation().context.assets.open("hermes-conversation.json").bufferedReader().use{JSONObject(it.readText())}
    private fun workspace():WorkspaceState {
        val messages=(0 until 30).map { i->val id=i.toString(16).padStart(64,'0')
            JSONObject().put("id",id).put("account","personal").put("override",JSONObject.NULL).put("analysis",JSONObject().put("important",true).put("summary","Synthetic summary"))
                .put("data",JSONObject().put("id",id).put("account","personal").put("subject","Synthetic message $i").put("sender","synthetic@example.invalid").put("receivedAt","2000-01-01T12:00:00Z").put("body","Synthetic plain text").put("attachments",JSONArray()))
        }
        return WorkspaceState(signedIn=true,notice="Signed in",snapshots=mapOf("planner" to "{\"projects\":[],\"actions\":[]}","calendar" to "{\"events\":[],\"calendars\":[]}","mail" to JSONObject().put("messages",JSONArray(messages)).put("briefing",JSONArray()).put("accounts",JSONArray()).put("total",30).put("nextCursor",JSONObject.NULL).toString(),"prices" to "{\"items\":[{\"title\":\"Archived item must not render\"}]}"))
    }
    @Composable private fun Shell(state:HermesState,onEdit:(String)->Unit={},onSend:()->Unit={},onDismiss:()->Unit={},onRead:()->Unit={}){
        val density=LocalDensity.current
        CompositionLocalProvider(LocalInspectionMode provides true,LocalDensity provides Density(density.density,1.4f)){
            DccTheme {Box(Modifier.width(360.dp).height(600.dp)){
                Workspace(workspace(),{_,_->},{},{},{_,_->},{_,_->},initialDestination=Destination.Inbox,hermesContent={modifier->
                    HermesComposer(state,onEdit,onSend,{},{onDismiss()},onRead=onRead,modifier=modifier,docked=true)
                })
            }}
        }
    }
    private fun assertReservedGeometry(){
        val dock=compose.onNodeWithTag("hermes-dock").fetchSemanticsNode().boundsInRoot
        val page=compose.onNodeWithTag("workspace-page").fetchSemanticsNode().boundsInRoot
        val editor=compose.onNodeWithTag("hermes-editor").fetchSemanticsNode().boundsInRoot
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
    private fun openChat(){compose.onNodeWithTag("hermes-editor").performClick();compose.onNodeWithTag("hermes-chat").assertIsDisplayed()}
    private fun closeChat(){compose.onNodeWithContentDescription("Close chat").performClick();compose.onNodeWithTag("hermes-chat").assertDoesNotExist();dismissKeyboard()}
    private fun show(text:String){compose.showHermesChatText(text)}
    private data class InboxGeometry(val page:Rect,val list:Rect,val dock:Rect,val navigation:Rect,val scroll:Float)
    private fun inboxGeometry(stage:String):InboxGeometry {
        // Read-only geometry: never direct pointer/keyboard input to the modal-
        // blocked workspace. The fixture goes through Workspace's real provider.
        val list=compose.onNodeWithTag("inbox-list").fetchSemanticsNode()
        return InboxGeometry(
            compose.onNodeWithTag("workspace-page").fetchSemanticsNode().boundsInRoot,
            list.boundsInRoot,
            compose.onNodeWithTag("hermes-dock").fetchSemanticsNode().boundsInRoot,
            compose.onNodeWithTag("main-navigation").fetchSemanticsNode().boundsInRoot,
            list.config[SemanticsProperties.VerticalScrollAxisRange].value()
        ).also{println("QA_UI_INBOX_GEOMETRY $stage $it")}
    }
    @SdkSuppress(minSdkVersion=30)
    private fun fullWindowGeometry(expectIme:Boolean):String {
        var width=0;var height=0;var imeBottom=0;var imeVisible=false;var fontScale=0f;var density=0f
        compose.runOnIdle{
            val decor=compose.activity.window.decorView
            width=decor.width;height=decor.height;fontScale=decor.resources.configuration.fontScale;density=decor.resources.displayMetrics.density
        }
        val chat=compose.onAllNodesWithTag("hermes-chat").fetchSemanticsNodes().singleOrNull()
        if(chat!=null){
            val root=chat.boundsInRoot
            imeBottom=chat.config[HermesChatImeBottom];imeVisible=imeBottom>0
            val composer=compose.onNodeWithTag("hermes-chat-composer").fetchSemanticsNode().boundsInRoot
            val editor=compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().boundsInRoot
            val history=compose.onNodeWithTag("hermes-chat-history").fetchSemanticsNode().boundsInRoot
            val content=compose.onNodeWithTag("hermes-chat-content").fetchSemanticsNode().boundsInRoot
            val bounds="window=${width}x$height fontScale=$fontScale density=$density chat=$root content=$content history=$history composer=$composer editor=$editor imeBottom=$imeBottom"
            assertTrue("Chat must fill the actual window, not the dock: $bounds",kotlin.math.abs(root.width-width)<=1f&&kotlin.math.abs(root.height-height)<=1f)
            assertTrue("Inset-adjusted content must stay above IME: $bounds",content.height>0&&content.width>0&&content.bottom<=root.bottom-imeBottom+1f)
            assertTrue("History must have a positive viewport above a pinned editor: $bounds",history.height>0&&history.width>0&&history.top>=content.top-1f&&history.bottom<=composer.top+1f&&editor.top>=composer.top&&editor.bottom<=composer.bottom+1f)
            for(tag in listOf("hermes-chat-editor","hermes-chat-send","hermes-chat-close","hermes-chat-actions")){
                val control=compose.onNodeWithTag(tag)
                val clipped=control.fetchSemanticsNode().boundsInRoot
                val full=control.getUnclippedBoundsInRoot()
                assertTrue("$tag must have a full 48dp touch height inside usable content: $clipped $bounds",clipped.height>=48f*density-1f&&clipped.width>0&&clipped.left>=content.left-1f&&clipped.right<=content.right+1f&&clipped.top>=content.top-1f&&clipped.bottom<=content.bottom+1f)
                assertTrue("$tag must not be clipped: $clipped full=$full $bounds",kotlin.math.abs(clipped.width-(full.right-full.left).value*density)<=1f&&kotlin.math.abs(clipped.height-(full.bottom-full.top).value*density)<=1f)
                control.assertIsDisplayed()
            }
            assertEquals("Real Dialog IME visibility: $bounds",expectIme,imeVisible)
            assertTrue("Composer stays above real IME: $bounds",composer.bottom<=height-imeBottom+1f)
            return bounds
        }
        compose.runOnIdle{
            val insets=checkNotNull(compose.activity.window.decorView.rootWindowInsets){"Full-window insets unavailable"}
            imeBottom=insets.getInsets(WindowInsets.Type.ime()).bottom
            imeVisible=insets.isVisible(WindowInsets.Type.ime())
        }
        val root=compose.onRoot().fetchSemanticsNode().boundsInRoot
        val dock=compose.onNodeWithTag("hermes-dock").fetchSemanticsNode().boundsInRoot
        val page=compose.onNodeWithTag("workspace-page").fetchSemanticsNode().boundsInRoot
        val editor=compose.onNodeWithTag("hermes-editor").fetchSemanticsNode().boundsInRoot
        val unclippedEditor=compose.onNodeWithTag("hermes-editor").getUnclippedBoundsInRoot()
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
    private fun stableFullWindowGeometry(name:String,expectIme:Boolean):String {
        var previous:String?=null;var lastFailure:Throwable?=null
        try{
            compose.waitUntil(5000){
                val current=try{fullWindowGeometry(expectIme)}catch(error:AssertionError){lastFailure=error;null}
                val stable=current!=null&&current==previous;previous=current;stable
            }
        }catch(error:Throwable){throw AssertionError("Full-window capture $name did not reach stable geometry: ${lastFailure?.message}",error)}
        return checkNotNull(previous)
    }
    @SdkSuppress(minSdkVersion=30)
    private fun captureFullWindow(name:String,expectIme:Boolean){
        val bounds=stableFullWindowGeometry(name,expectIme)
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val directory=checkNotNull(instrumentation.targetContext.getExternalFilesDir("qa-ui-captures"))
        check(directory.isDirectory||directory.mkdirs())
        val image=checkNotNull(instrumentation.uiAutomation.takeScreenshot()){"Screenshot unavailable for $name"}
        val png=File(directory,"$name.png")
        try{png.outputStream().use{check(image.compress(Bitmap.CompressFormat.PNG,100,it))}}finally{image.recycle()}
        val roots=compose.onAllNodes(isRoot(),useUnmergedTree=true)
        File(directory,"$name.txt").writeText(buildString{
            appendLine(bounds)
            roots.fetchSemanticsNodes().forEachIndexed{i,node->appendLine("ROOT $i ${node.boundsInRoot}");appendLine(roots[i].printToString())}
        })
        println("QA_UI_CAPTURE ${png.absolutePath}")
    }
    @Test @SdkSuppress(minSdkVersion=30)
    fun fullWindowVisualAcceptanceCompactChatImeMultiTurnReceiptAndClosedTasks(){
        val trace=SyntheticUiStageTrace("HermesShellTest.fullWindowVisualAcceptanceCompactChatImeMultiTurnReceiptAndClosedTasks")
        val fixture=fixtures();val q=fixture.getJSONObject("question");val done=fixture.getJSONObject("complete")
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        val memory=object:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){raw=null}}
        val requests=mutableListOf<JSONObject>()
        val controller=HermesConversationController(scope,{memory},{body->
            requests+=JSONObject(body.toString())
            val response=JSONObject((if(body.getString("op")=="start")q else done).toString())
            response.put("rootKey",body.optString("rootKey",body.getString("key"))).put("turnKey",body.getString("key"))
            response.getJSONObject("receipt").put("key",body.getString("key"));response
        },{1794016800000L})
        // Match MainActivity.onCreate: edge-to-edge, no extra soft-input flags.
        // Use the natural system density/font and full window: no capped Box.
        trace.stage("edge-to-edge"){compose.activityRule.scenario.onActivity{it.enableEdgeToEdge()}}
        try{
        trace.stage("bind synthetic owner"){compose.runOnIdle{controller.bind("a".repeat(64));controller.availability(true)}}
        trace.stage("setContent"){compose.setContent{
            val hermes by controller.state.collectAsStateWithLifecycle()
            CompositionLocalProvider(LocalInspectionMode provides true){DccTheme{
                Workspace(workspace(),{_,_->},{},{},{_,_->},{_,_->},initialDestination=Destination.Inbox,hermesContent={modifier->
                    HermesComposer(hermes,controller::edit,controller::send,controller::newRequest,controller::dismiss,controller::readReceipt,modifier=modifier,docked=true,onClearChat=controller::newConversation)
                })
            }}
        }}
        trace.stage("assert compact field"){compose.onNodeWithText("Hermes").assertIsDisplayed()}
        trace.stage("capture full-window-compact"){captureFullWindow("full-window-compact",expectIme=false)}
        trace.stage("open chat: compact field click"){compose.onNodeWithTag("hermes-editor").performClick()}
        trace.stage("open chat: assert modal displayed"){compose.onNodeWithTag("hermes-chat").assertIsDisplayed()}
        trace.stage("type initial request"){compose.onNodeWithTag("hermes-chat-editor").performTextInput(q.getString("original"))}
        trace.stage("IME send initial request"){compose.onNodeWithTag("hermes-chat-editor").performImeAction()}
        trace.stage("show typed clarification"){show(q.getJSONObject("question").getString("question"))}
        trace.stage("focus answer editor"){compose.onNodeWithTag("hermes-chat-editor").performClick()}
        trace.stage("type answer"){compose.onNodeWithTag("hermes-chat-editor").performTextInput("Lectures; practice problems; review")}
        trace.stage("capture full-window-chat-ime"){captureFullWindow("full-window-chat-ime",expectIme=true)}
        trace.stage("IME send answer"){compose.onNodeWithTag("hermes-chat-editor").performImeAction()}
        trace.stage("assert chat stays open and show receipt"){
        compose.onNodeWithTag("hermes-chat").assertIsDisplayed();show("Added 3/3 tasks · 2026-11-07")
        assertEquals("",compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        }
        trace.stage("capture full-window-multi-turn-receipt"){captureFullWindow("full-window-multi-turn-receipt",expectIme=true)}
        trace.stage("open receipt View"){
        compose.onNodeWithTag("hermes-chat-history").performScrollToNode(hasText("View"));compose.onNodeWithText("View").performClick()
        }
        done.getJSONObject("receipt").getJSONArray("targets").objects().forEachIndexed { index,target->
            trace.stage("show verified target ${index+1}"){
            show("${target.getString("kind")} · ${target.getString("id")} · ${target.getString("state")} · ${target.getString("verification")}")
            }
        }
        trace.stage("X close and hide keyboard"){closeChat()}
        trace.stage("assert closed workspace and select Tasks"){
        compose.onNodeWithText("View").assertDoesNotExist()
        compose.onNodeWithTag("main-navigation").assertIsDisplayed()
        compose.onNode(hasText("Today") and hasAnyAncestor(hasTestTag("main-navigation"))).performClick()
        compose.onNodeWithText("Tasks",useUnmergedTree=true).performClick()
        }
        trace.stage("capture full-window-closed-tasks"){captureFullWindow("full-window-closed-tasks",expectIme=false)}
        trace.stage("assert no extra API operations"){assertEquals(listOf("start","answer"),requests.map{it.getString("op")})}
        }finally{trace.stage("cancel synthetic scope"){scope.cancel()}}
    }
    @OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)
    @Test @SdkSuppress(minSdkVersion=30)
    fun unresolvedDraftChecksReceiptThenExplicitlyClosesBeforeSeparateFreshSend(){
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        val memory=object:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){error("No clear")}}
        val requests=CopyOnWriteArrayList<JSONObject>();val readGate=CompletableDeferred<Unit>()
        val time=1794016800000L
        fun response(key:String,outcome:String)=JSONObject().put("version",1).put("rootKey",key).put("turnKey",key).put("expiresAt",time+HERMES_TTL_MS).put("questions",0)
            .put("receipt",JSONObject().put("version",1).put("key",key).put("outcome",outcome).put("line",if(outcome=="uncertain")"Earlier synthetic effects remain unconfirmed." else "Synthetic read-only result.")
                .put("verified",0).put("expected",JSONObject.NULL).put("targets",JSONArray()))
        // Application interceptor terminates every request: no DNS/socket/server.
        // The real conversation client + async adapter + JSON codec are exercised.
        val client=OkHttpClient.Builder().addInterceptor{chain->
            val buffer=okio.Buffer();checkNotNull(chain.request().body).writeTo(buffer)
            val body=JSONObject(buffer.readUtf8());requests+=body
            var status=200
            val result=when(body.getString("op")){
                "start"->if(requests.count{it.getString("op")=="start"}==1){status=504;JSONObject()} else response(body.getString("key"),"read-only")
                "read"->{runBlocking{readGate.await()};response(body.getString("rootKey"),"uncertain")}
                "cancel"->response(body.getString("rootKey"),"uncertain")
                else->error("Unexpected synthetic operation")
            }
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("Synthetic")
                .body(result.toString().toResponseBody("application/json".toMediaType())).build()
        }.build()
        val controller=HermesConversationController(scope,{memory},{body->
            val http=awaitHermesHttp(hermesConversationClient(client,body.getString("op")),Request.Builder().url("https://synthetic.invalid/api/v1/hermes/conversation").post(body.toString().toRequestBody("application/json".toMediaType())).build())
            if(http.code !in 200..299)throw HermesHttpFailure(auth=http.code==401)
            JSONObject(http.body)
        },{time})
        try{
            compose.activityRule.scenario.onActivity{it.enableEdgeToEdge();controller.bind("a".repeat(64));controller.availability(true)}
            compose.setContent{
                val hermes by controller.state.collectAsStateWithLifecycle()
                CompositionLocalProvider(LocalInspectionMode provides true){DccTheme{
                    Workspace(workspace(),{_,_->},{},{},{_,_->},{_,_->},initialDestination=Destination.Inbox,hermesContent={modifier->
                        HermesComposer(hermes,controller::edit,controller::send,controller::newRequest,controller::dismiss,controller::readReceipt,modifier=modifier,docked=true,onClearChat=controller::newConversation,onRecover=controller::recoverSeparately)
                    })
                }}
            }
            val before=inboxGeometry("unresolved-before-open")
            openChat();compose.onNodeWithTag("hermes-chat-editor").performTextInput("Synthetic earlier request")
            compose.onNodeWithTag("hermes-chat-editor").performImeAction()
            compose.waitUntil(5000){!controller.state.value.busy&&controller.state.value.submitted!=null}
            val original=controller.state.value.submitted!!
            compose.onNodeWithTag("hermes-chat-editor").performTextInput("Different fresh synthetic draft")
            compose.onNodeWithTag("hermes-chat-editor").performTextInputSelection(androidx.compose.ui.text.TextRange(2,7))
            compose.onNodeWithTag("hermes-chat-send").assertIsEnabled().performClick()
            compose.onNodeWithText("Continue with a new request?").assertIsDisplayed()
            val held=controller.state.value
            compose.onNodeWithText("Keep draft").performClick()
            compose.runOnIdle{assertEquals(held,controller.state.value);assertEquals(listOf("start"),requests.map{it.getString("op")})}
            compose.onNodeWithTag("hermes-chat-editor").performTouchInput{click()}
            stableFullWindowGeometry("unresolved-draft-before-check",expectIme=true)
            compose.onNodeWithContentDescription("Conversation actions").performClick()
            compose.onNodeWithText("Check receipt").assertIsDisplayed().performClick()
            compose.onNodeWithTag("hermes-receipt-feedback").assertIsDisplayed().assertTextContains("Checking receipt",substring=true)
            compose.waitUntil(5000){requests.any{it.getString("op")=="read"}}
            assertEquals(listOf("start","read"),requests.map{it.getString("op")})
            assertEquals(setOf("op","workspaceOwner","clientId","rootKey"),requests.last().keys().asSequence().toSet())
            readGate.complete(Unit)
            compose.waitUntil(5000){controller.state.value.receiptCheck==HermesReceiptCheck.UNCONFIRMED}
            compose.onNodeWithTag("hermes-receipt-feedback").assertIsDisplayed().assertTextContains("still unconfirmed",substring=true)
            compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Different fresh synthetic draft")
            assertEquals(androidx.compose.ui.text.TextRange(2,7),compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange])
            captureFullWindow("unresolved-receipt-checked",expectIme=true)
            compose.runOnIdle{assertEquals(original,controller.state.value.submitted);assertEquals(original.turnKey,controller.state.value.attemptKey)}
            compose.onNodeWithTag("hermes-chat-send").assertIsEnabled().performClick()
            compose.onNodeWithText("Close earlier request").performClick()
            compose.waitUntil(5000){!controller.state.value.busy&&controller.state.value.rootKey==null}
            compose.runOnIdle{
                assertEquals(listOf("start","read","cancel"),requests.map{it.getString("op")})
                assertEquals("Different fresh synthetic draft",controller.state.value.draft);assertTrue(controller.state.value.submitted!!.closed)
            }
            show("Earlier synthetic effects remain unconfirmed.")
            compose.onNodeWithTag("hermes-chat-history").performScrollToNode(hasText("View"))
            compose.onNodeWithText("View").assertIsDisplayed().performClick()
            show("Outcome: uncertain. Verified: 0; expected: null.")
            compose.onNodeWithTag("hermes-chat-editor").performTouchInput{click()}
            stableFullWindowGeometry("unresolved-before-separate-send",expectIme=true)
            compose.onNodeWithTag("hermes-chat-send").assertIsEnabled().performClick()
            compose.waitUntil(5000){requests.count{it.getString("op")=="start"}==2&&!controller.state.value.busy}
            val fresh=requests.last()
            assertEquals(listOf("start","read","cancel","start"),requests.map{it.getString("op")})
            assertNotEquals(original.turnKey,fresh.getString("key"));assertEquals(requests[0].getString("clientId"),fresh.getString("clientId"))
            assertEquals("Different fresh synthetic draft",fresh.getString("prompt"));assertFalse(fresh.has("answer"))
            compose.runOnIdle{assertEquals("uncertain",JSONObject(controller.state.value.timeline.single{it.id=="receipt:${original.turnKey}"}.receipt!!).getString("outcome"))}
            captureFullWindow("unresolved-fresh-turn",expectIme=true)
            closeChat();assertEquals(before,inboxGeometry("unresolved-after-X"))
        }catch(error:Throwable){
            failureArtifacts.capture(error,org.junit.runner.Description.createTestDescription(HermesShellTest::class.java,"unresolved-journey-before-cleanup"));throw error
        }finally{readGate.complete(Unit);scope.cancel();client.dispatcher.executorService.shutdownNow();client.connectionPool.evictAll()}
    }
    @OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)
    @Test @SdkSuppress(minSdkVersion=30)
    fun conversationFirstShowsNaturalReplyWithoutCardsAndPreservesDraftAcrossBackAndX(){
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        val memory=object:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){error("No clearing")}}
        val calls=CopyOnWriteArrayList<JSONObject>();val time=1794016800000L
        val client=OkHttpClient.Builder().addInterceptor{chain->
            val buffer=okio.Buffer();checkNotNull(chain.request().body).writeTo(buffer)
            val body=JSONObject(buffer.readUtf8());calls+=body
            check(body.getString("op")=="start"&&body.getInt("chatVersion")==1&&!body.has("answer"))
            val key=body.getString("key")
            val response=JSONObject().put("version",1).put("chatVersion",1).put("rootKey",key).put("turnKey",key).put("expiresAt",time+HERMES_TTL_MS).put("questions",0)
                .put("receipt",JSONObject().put("version",1).put("key",key).put("outcome","read-only").put("line","No actions performed.").put("verified",0).put("expected",JSONObject.NULL).put("targets",JSONArray()))
                .put("assistantReply",JSONObject().put("version",1).put("text",if(calls.size==1)"What does a study chunk mean to you?" else "We can talk about music instead."))
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("Synthetic").body(response.toString().toResponseBody("application/json".toMediaType())).build()
        }.build()
        val controller=HermesConversationController(scope,{memory},{body->
            JSONObject(awaitHermesHttp(hermesConversationClient(client,"start"),Request.Builder().url("https://synthetic.invalid/api/v1/hermes/conversation").post(body.toString().toRequestBody("application/json".toMediaType())).build()).body)
        },{time})
        try{
            compose.activityRule.scenario.onActivity{it.enableEdgeToEdge();controller.bind("a".repeat(64));controller.availability(true,1,1,1)}
            compose.setContent{
                val state by controller.state.collectAsStateWithLifecycle()
                CompositionLocalProvider(LocalInspectionMode provides true){DccTheme{
                    Workspace(workspace(),{_,_->},{},{},{_,_->},{_,_->},initialDestination=Destination.Inbox,hermesContent={modifier->
                        HermesComposer(state,controller::edit,controller::send,controller::newRequest,controller::dismiss,controller::readReceipt,modifier=modifier,docked=true,onClearChat=controller::newConversation,onRecover=controller::recoverSeparately)
                    })
                }}
            }
            val before=inboxGeometry("conversation-first-before")
            openChat();compose.onNodeWithTag("hermes-chat-editor").performTextInput("Let us discuss studying")
            compose.onNodeWithTag("hermes-chat-send").assertIsEnabled().performClick()
            compose.waitUntil(5000){!controller.state.value.busy&&controller.state.value.timeline.any{it.kind=="reply"}}
            show("What does a study chunk mean to you?")
            compose.onNodeWithText("View").assertDoesNotExist();compose.onNodeWithText("No actions performed.").assertDoesNotExist()
            compose.onNodeWithTag("hermes-chat-editor").performTextInput("Actually, let us discuss music")
            compose.onNodeWithTag("hermes-chat-editor").performTextInputSelection(androidx.compose.ui.text.TextRange(2,7))
            InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
            compose.onNodeWithTag("hermes-chat").assertIsDisplayed()
            compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Actually, let us discuss music")
            assertEquals(androidx.compose.ui.text.TextRange(2,7),compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange])
            closeChat();assertEquals(before,inboxGeometry("conversation-first-after-X"))
            openChat();compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Actually, let us discuss music")
            compose.onNodeWithTag("hermes-chat-send").assertIsEnabled().performClick()
            compose.waitUntil(5000){calls.size==2&&!controller.state.value.busy}
            show("We can talk about music instead.")
            assertEquals(listOf("start","start"),calls.map{it.getString("op")})
            assertNotEquals(calls[0].getString("key"),calls[1].getString("key"))
            compose.onNodeWithText("Close unresolved request?").assertDoesNotExist()
        }finally{scope.cancel();client.dispatcher.executorService.shutdownNow();client.connectionPool.evictAll()}
    }
    @Test fun lowerDockSurvivesNavigationWithoutLosingDraftOrInboxQuery(){
        var hermes by mutableStateOf(HermesState(available=true))
        compose.setContent{Shell(hermes,{hermes=hermes.copy(draft=it)})}
        assertReservedGeometry();compose.onNodeWithText("Search email").performScrollTo().performTextInput("Synthetic")
        dismissKeyboard()
        compose.onNodeWithText("personal").performScrollTo().performClick()
        compose.onNodeWithText("Important only").performScrollTo().performClick()
        compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("Synthetic message 29"))
        openChat();compose.onNodeWithTag("hermes-chat-editor").performTextInput("Draft stays in the thumb band")
        closeChat()
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
        compose.onNodeWithTag("hermes-editor").assertIsDisplayed()
        compose.onNodeWithText("Check receipt").assertDoesNotExist()
        compose.onNodeWithText(q.getJSONObject("question").getString("question")).assertDoesNotExist()
        assertReservedGeometry()
        val listAfter=compose.onNodeWithTag("inbox-list").fetchSemanticsNode().boundsInRoot
        assertTrue("Compact dock must leave a positive Inbox viewport: $listAfter",listAfter.height>0f&&listAfter.width>0f)
        val scrollAfter=compose.onNodeWithTag("inbox-list").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertEquals("Quiet question arrival must retain the list's scroll anchor",scrollBefore,scrollAfter,0f)
        // Retain reachability coverage. This explicit scroll may reposition the
        // item, so chat restoration needs its own immediately-before-open anchor.
        compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("Synthetic message 29"))
        compose.onNodeWithText("Synthetic message 29").assertIsDisplayed()
        compose.onNodeWithTag("hermes-editor").assertIsDisplayed()
        val beforeOpen=inboxGeometry("before-open")
        val scrollBeforeOpen=beforeOpen.scroll
        openChat()
        compose.waitUntil(5000){compose.onNodeWithTag("hermes-chat").fetchSemanticsNode().config[HermesChatImeBottom]>0}
        show(q.getJSONObject("question").getString("question"))
        val whileOpen=inboxGeometry("modal-with-ime")
        assertEquals("Modal IME must not resize the background page",beforeOpen.page,whileOpen.page)
        assertEquals("Modal IME must not resize the background Inbox",beforeOpen.list,whileOpen.list)
        assertEquals("Modal IME must not move the compact dock",beforeOpen.dock,whileOpen.dock)
        assertEquals("Modal IME must retain background navigation geometry",beforeOpen.navigation,whileOpen.navigation)
        assertEquals("Modal IME must not clamp the Inbox scroll",scrollBeforeOpen,whileOpen.scroll,0f)
        closeChat()
        assertReservedGeometry()
        val afterClose=inboxGeometry("after-close")
        assertEquals("Closing chat restores the same background page",beforeOpen.page,afterClose.page)
        assertEquals("Closing chat restores the same Inbox viewport",beforeOpen.list,afterClose.list)
        assertEquals("Closing chat restores the same Inbox scroll",scrollBeforeOpen,afterClose.scroll,0f)
        compose.runOnIdle{hermes=HermesState(available=true)}
        compose.onNodeWithTag("inbox-list").performScrollToIndex(0)
        compose.onNodeWithText("Search email").assertIsDisplayed()
    }
    @OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)
    @Test @SdkSuppress(minSdkVersion=30)
    fun realBackAndExternalImeHideKeepChatSelectionAndExactInboxUntilX(){
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate);var sends=0
        val memory=object:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){error("No clear")}}
        val controller=HermesConversationController(scope,{memory},{sends++;error("No real transport")})
        fun back(){InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);compose.waitForIdle()}
        fun assertSelection(){assertEquals(androidx.compose.ui.text.TextRange(2,7),compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange])}
        try{
            compose.activityRule.scenario.onActivity{it.enableEdgeToEdge();controller.bind("a".repeat(64));controller.availability(true);controller.edit("Synthetic keyboard draft")}
            compose.setContent{val state by controller.state.collectAsStateWithLifecycle();Shell(state,controller::edit,controller::send,onRead=controller::readReceipt)}
            compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("Synthetic message 29"))
            val before=inboxGeometry("keyboard-before-open")
            openChat();stableFullWindowGeometry("keyboard-before-back",expectIme=true)
            compose.onNodeWithTag("hermes-chat-editor").performTextInputSelection(androidx.compose.ui.text.TextRange(2,7));assertSelection()
            back();compose.onNodeWithTag("hermes-chat").assertIsDisplayed()
            captureFullWindow("keyboard-back-keeps-chat",expectIme=false);assertSelection()
            back();compose.onNodeWithTag("hermes-chat").assertIsDisplayed();stableFullWindowGeometry("keyboard-second-back",expectIme=false);assertSelection()
            compose.onNodeWithTag("hermes-chat-editor").performTouchInput{click()}
            stableFullWindowGeometry("keyboard-tap-reopens",expectIme=true);assertSelection()
            // Actual IME hide on the Dialog's token, bypassing our Back handler:
            // the same inset/focus lifecycle as the keyboard's down-chevron.
            compose.runOnIdle{
                val decor=checkNotNull(android.view.inspector.WindowInspector.getGlobalWindowViews().firstOrNull{
                    it!==compose.activity.window.decorView&&it.rootWindowInsets?.isVisible(WindowInsets.Type.ime())==true
                })
                (compose.activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(decor.windowToken,0)
            }
            captureFullWindow("keyboard-external-hide-keeps-chat",expectIme=false);assertSelection()
            compose.onNodeWithTag("hermes-chat-editor").performTouchInput{click()}
            stableFullWindowGeometry("keyboard-external-hide-reopened",expectIme=true);assertSelection()
            back();stableFullWindowGeometry("keyboard-final-back",expectIme=false)
            closeChat();assertReservedGeometry()
            val after=inboxGeometry("keyboard-after-X")
            assertEquals(before,after)
            compose.onNodeWithTag("hermes-editor").assertTextContains("Synthetic keyboard draft")
            compose.runOnIdle{assertEquals(0,sends);assertNull(controller.state.value.submitted);assertEquals("Synthetic keyboard draft",controller.state.value.draft)}
        }catch(error:Throwable){
            failureArtifacts.capture(error,org.junit.runner.Description.createTestDescription(HermesShellTest::class.java,"keyboard-before-cleanup"));throw error
        }finally{scope.cancel()}
    }
    @Test fun fullWindowQuestionAndPinnedEditorSurviveActivityRecreationAndStayOpenOnReceipt(){
        val fixture=fixtures();val q=fixture.getJSONObject("question");val done=fixture.getJSONObject("complete")
        var hermes by mutableStateOf(HermesState(draft=q.getString("original"),view=q.toString(),rootKey=q.getString("rootKey"),available=true))
        val content:@Composable ()->Unit={Shell(hermes,{hermes=hermes.copy(answer=it)},{hermes=HermesState(receipt=done.getJSONObject("receipt").toString(),available=true)},{hermes=hermes.copy(receipt=null)})}
        compose.setContent(content);assertReservedGeometry()
        val dock=compose.onNodeWithTag("hermes-dock").fetchSemanticsNode().boundsInRoot
        val page=compose.onNodeWithTag("workspace-page").fetchSemanticsNode().boundsInRoot
        assertTrue("Compact field must leave a page viewport",page.height>0&&dock.height<page.height+dock.height)
        assertTrue(compose.onNodeWithTag("inbox-list").fetchSemanticsNode().boundsInRoot.height>0)
        openChat();compose.onNodeWithTag("hermes-chat-editor").performTextInput("Lectures; practice problems; review")
        compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Lectures; practice problems; review")
        compose.activityRule.scenario.recreate();compose.activityRule.scenario.onActivity{it.setContent(content=content)};compose.waitForIdle()
        compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Lectures; practice problems; review")
        compose.onNodeWithTag("hermes-chat-editor").performImeAction()
        compose.onNodeWithTag("hermes-chat").assertIsDisplayed()
        compose.onNodeWithTag("hermes-chat-history").performScrollToNode(hasText("View"));compose.onNodeWithText("View").performClick()
        show("task · synthetic-task-3 · applied · verified")
        closeChat();assertReservedGeometry();compose.onNodeWithText("View").assertDoesNotExist()
    }
    @OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)
    @Test fun landscapeRotationRetainsQuestionAnswerAndReservedDock(){
        val trace=SyntheticUiStageTrace("HermesShellTest.landscapeRotationRetainsQuestionAnswerAndReservedDock")
        val q=fixtures().getJSONObject("question")
        var reads=0
        var hermes by mutableStateOf(HermesState(draft=q.getString("original"),view=q.toString(),rootKey=q.getString("rootKey"),available=true))
        val content:@Composable ()->Unit={Shell(hermes,{hermes=hermes.copy(answer=it)},onRead={reads++})}
        trace.stage("edge-to-edge"){compose.activityRule.scenario.onActivity{it.enableEdgeToEdge()}}
        trace.stage("setContent portrait"){compose.setContent(content)}
        trace.stage("open portrait chat"){openChat()}
        trace.stage("type retained answer"){compose.onNodeWithTag("hermes-chat-editor").performTextInput("Retained synthetic answer")}
        try{
            trace.stage("request landscape"){compose.activityRule.scenario.onActivity{it.requestedOrientation=ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE}}
            trace.stage("await landscape orientation"){compose.waitUntil(5000){compose.activity.resources.configuration.orientation==Configuration.ORIENTATION_LANDSCAPE}}
            trace.stage("reattach landscape content"){compose.activityRule.scenario.onActivity{it.enableEdgeToEdge();it.setContent(content=content)}}
            trace.stage("assert retained answer"){
            compose.onNodeWithTag("hermes-chat").assertIsDisplayed()
            compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Retained synthetic answer")
            }
            // Validate the actual window, real IME and all control bounds BEFORE
            // any lazy search. A zero-height history must fail, never spin.
            trace.stage("landscape IME geometry before history search"){stableFullWindowGeometry("landscape-before-search",expectIme=true)}
            trace.stage("show retained question"){show(q.getJSONObject("question").getString("question"))}
            trace.stage("reach and check receipt from scrolling actions"){
                fun menuState(stage:String)=compose.onNodeWithTag("hermes-chat").fetchSemanticsNode().config[HermesChatMenuState].also{println("QA_UI_MENU $stage $it")}
                compose.onNodeWithTag("hermes-chat-editor").performTextInputSelection(androidx.compose.ui.text.TextRange(2,7))
                val selection=compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange]
                assertEquals(androidx.compose.ui.text.TextRange(2,7),selection)
                compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Retained synthetic answer")
                stableFullWindowGeometry("landscape-before-overflow",expectIme=true)
                compose.onNodeWithText("Check receipt").assertDoesNotExist()
                menuState("before-open")
                compose.onNodeWithContentDescription("Conversation actions").performClick()
                val opened=menuState("after-open")
                assertTrue("Dialog must retain menu-open ownership: $opened",opened.startsWith("open=true "))
                compose.onNodeWithText("Check receipt").assertIsDisplayed()
                // Focusable Android popup owns input; its natural IME-hidden
                // layout is valid. Real IME is required again after selection.
                captureFullWindow("landscape-overflow-keyboard-hidden",expectIme=false)
                val menu=compose.onNodeWithTag("hermes-chat-actions-menu").fetchSemanticsNode().boundsInRoot
                val viewport=compose.onNodeWithTag("hermes-chat-content").fetchSemanticsNode().boundsInRoot
                assertTrue("Overflow must fit the actual IME-safe viewport: menu=$menu viewport=$viewport",menu.height>0&&menu.height<=viewport.height+1f&&menu.width<=viewport.width+1f)
                compose.onNodeWithTag("hermes-chat-actions-list").performScrollToNode(hasText("Close unresolved request"))
                compose.onNodeWithText("Close unresolved request").assertIsDisplayed()
                compose.onNodeWithTag("hermes-chat-actions-list").performScrollToNode(hasText("Check receipt"))
                compose.onNodeWithText("Check receipt").assertIsDisplayed().performClick();compose.runOnIdle{assertEquals(1,reads)}
                val closed=menuState("after-receipt")
                assertTrue("Receipt selection must dismiss the menu: $closed",closed.startsWith("open=false "))
                stableFullWindowGeometry("landscape-after-receipt-restored-ime",expectIme=true)
                compose.onNodeWithTag("hermes-chat-editor").assertTextContains("Retained synthetic answer")
                assertEquals(selection,compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange])
                // Restoration must release its fence, not lock future deliberate
                // selection changes to the menu-entry snapshot.
                compose.onNodeWithTag("hermes-chat-editor").performTextInputSelection(androidx.compose.ui.text.TextRange(3,8))
                assertEquals(androidx.compose.ui.text.TextRange(3,8),compose.onNodeWithTag("hermes-chat-editor").fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange])
                compose.onNodeWithTag("hermes-chat-editor").performTextInputSelection(selection)
            }
            trace.stage("show question again"){show(q.getJSONObject("question").getString("question"))}
            trace.stage("capture landscape success with IME"){captureFullWindow("landscape-success",expectIme=true)}
            trace.stage("close restores Inbox and draft"){
                closeChat();assertReservedGeometry()
                compose.onNodeWithTag("inbox-list").assertIsDisplayed()
                compose.onNodeWithTag("hermes-editor").assertTextContains("Retained synthetic answer")
                compose.runOnIdle{assertEquals(1,reads);assertEquals(q.getString("rootKey"),hermes.rootKey)}
            }
        }catch(error:Throwable){
            failureArtifacts.capture(error,org.junit.runner.Description.createTestDescription(HermesShellTest::class.java,"landscape-before-orientation-cleanup"))
            throw error
        }finally{
            trace.stage("restore orientation"){compose.activityRule.scenario.onActivity{it.requestedOrientation=ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED}}
        }
    }
}
