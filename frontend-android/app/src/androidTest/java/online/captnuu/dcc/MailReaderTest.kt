package online.captnuu.dcc

import android.content.Context
import android.os.Build
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.view.inspector.WindowInspector
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.Cookie
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

// Synthetic reader tests. No real mailbox/provider/network/browser.
class MailReaderTest {
 private val compose=createAndroidComposeRule<ComponentActivity>()
 private val failureArtifacts=SyntheticUiFailureArtifacts(compose)
 @get:Rule val rules:RuleChain=RuleChain.outerRule(compose).around(failureArtifacts)

 @Test fun plaintextReaderShowsFixedCloseAndFallbackText(){
  val message=mailMessage(JSONObject().put("data",JSONObject().put("id","a".repeat(64)).put("account","personal").put("sender","Synthetic <s@example.invalid>").put("subject","Synthetic subject").put("body","Line one\nLine two").put("hasHtml",false)))
  compose.setContent{DccTheme{MailReader(message,model=null,busy=false,onClose={})}}
  compose.onNodeWithTag("mail-reader-close").assertIsDisplayed()
  compose.onNodeWithText("Synthetic subject").assertIsDisplayed()
  compose.onNodeWithText("Line one",substring=true).assertExists()
  compose.onNodeWithTag("mail-reader-html").assertDoesNotExist()
 }

 @Test fun closeControlInvokesCallback(){
  var closed=false
  val message=mailMessage(JSONObject().put("data",JSONObject().put("id","b".repeat(64)).put("account","work").put("sender","s").put("subject","Close me").put("body","body").put("hasHtml",false)))
  compose.setContent{DccTheme{MailReader(message,model=null,onClose={closed=true})}}
  compose.onNodeWithTag("mail-reader-close").performClick()
  compose.runOnIdle{assert(closed)}
 }

 private fun webViews(root:View,out:MutableList<WebView>){
  if(root is WebView) out+=root
  if(root is android.view.ViewGroup) for(i in 0 until root.childCount) webViews(root.getChildAt(i),out)
 }
 private fun findRenderedHtmlTitle():String?{
  var title:String?=null
  compose.runOnIdle{
   val views=mutableListOf<View>()
   if(Build.VERSION.SDK_INT>=29) views+=WindowInspector.getGlobalWindowViews()
   else views+=compose.activity.window.decorView
   val webViews=mutableListOf<WebView>()
   views.forEach{webViews(it,webViews)}
   title=webViews.firstNotNullOfOrNull{it.title?.takeIf{t->t.isNotBlank()}}
  }
  return title
 }
 private fun waitForRenderedHtmlTitle(expected:String){
  compose.waitUntil(15000){findRenderedHtmlTitle()==expected}
 }
 private fun assertAccessibilityHeading(text:String){
  // rootInActiveWindow must not be called from runOnMainSync on the app main thread.
  compose.waitUntil(10000){
   val root=InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow ?: return@waitUntil false
   fun walk(node:android.view.accessibility.AccessibilityNodeInfo?):Boolean{
    if(node==null) return false
    try{
     val label=listOf(node.text,node.contentDescription).joinToString(" ")
     if(label.contains(text)) return true
     for(i in 0 until node.childCount) if(walk(node.getChild(i))) return true
     return false
    }finally{node.recycle()}
   }
   walk(root)
  }
 }
 private fun hexId(seed:Int):String = "${"d".repeat(62)}${"%02x".format(seed)}"

 @Test fun inboxOpensRealFormattedHtmlThroughWorkspaceModelAndPreservesAnchor(){
  val owner="a".repeat(64)
  val targetId="c".repeat(64)
  val html="""<!doctype html><html><head><title>Synthetic formatted message</title><style>body{font-family:sans-serif}table,td{border:1px solid #444}h1{color:#0055aa}</style></head><body><h1>Synthetic formatted heading</h1><p>Synthetic paragraph</p><table><tr><td>Cell A</td><td>Cell B</td></tr></table><div style="height:1800px">Synthetic long scroll body</div><p>Synthetic tail</p></body></html>"""
  val requests=CopyOnWriteArrayList<String>()
  val plaintextRequests=AtomicInteger(0)
  val unexpectedRequests=AtomicInteger(0)
  class Memory(var raw:String?=null):SessionStorage { @Synchronized override fun read()=raw; @Synchronized override fun write(value:String){raw=value}; @Synchronized override fun clear(){raw=null} }
  val stores=java.util.concurrent.ConcurrentHashMap<String,Memory>()
  stores["session.enc"]=Memory(Cookie.Builder().name("daymark_session").value("synthetic-only").hostOnlyDomain("dcc.home.captnuu.online").path("/").secure().httpOnly().expiresAt(System.currentTimeMillis()+3600000).build().toString())
  val client=OkHttpClient.Builder().addInterceptor{chain->
   val request=chain.request(); val path=request.url.encodedPath; val call="${request.method} $path"; requests+=call
   fun json(value:JSONObject,code:Int=200)=Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("Synthetic").body(value.toString().toResponseBody("application/json".toMediaType())).build()
   fun jsonText(value:String,code:Int=200)=Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("Synthetic").body(value.toResponseBody("application/json".toMediaType())).build()
   when {
    call=="GET /api/v1/auth/session" -> json(JSONObject().put("authenticated",true).put("workspaceOwner",owner))
    call=="GET /api/v1/hermes/action-capabilities" -> json(JSONObject().put("conversation",true).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1).put("workspaceOwner",owner))
    call=="GET /api/v1/planner/snapshot" -> json(JSONObject().put("projects",JSONArray()).put("preparations",JSONArray()).put("actions",JSONArray()))
    call=="GET /api/v1/calendar/snapshot" -> json(JSONObject().put("calendars",JSONArray()).put("events",JSONArray()))
    call=="GET /api/v1/mail/page" -> {
     // Many messages share "Synthetic" query; target at nonzero anchor index 12, hasHtml absent.
     val msgs=(0 until 20).map{i->val id=if(i==12) targetId else hexId(i)
      val subject=if(i==12)"Synthetic target formatted subject" else "Synthetic message $i"
      JSONObject().put("id",id).put("account","personal").put("override",JSONObject.NULL).put("analysis",JSONObject().put("important",false).put("summary",""))
       .put("data",JSONObject().put("id",id).put("account","personal").put("subject",subject).put("sender","synthetic@example.invalid").put("receivedAt","2000-01-01T12:00:00Z").put("attachments",JSONArray()))
     }
     json(JSONObject().put("messages",JSONArray(msgs)).put("briefing",JSONArray()).put("accounts",JSONArray()).put("total",20).put("nextCursor",JSONObject.NULL).put("today","2000-01-01"))
    }
    call=="GET /api/v1/mail/html/$targetId" -> jsonText(JSONObject().put("hasHtml",true).put("html",html).toString())
    call=="GET /api/v1/mail/message/$targetId" -> {plaintextRequests.incrementAndGet(); json(JSONObject().put("id",targetId).put("body","Plain fallback"))}
    call.startsWith("GET /api/v1/mail/html/") -> jsonText(JSONObject().put("hasHtml",false).put("html",JSONObject.NULL).toString())
    call.startsWith("GET /api/v1/mail/message/") -> {plaintextRequests.incrementAndGet(); json(JSONObject().put("id",path.substringAfterLast('/')).put("body","Plain"))}
    else -> {unexpectedRequests.incrementAndGet(); Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(599).message("Unexpected").body("{\"error\":\"unexpected:$call\"}".toResponseBody("application/json".toMediaType())).build()}
   }
  }.build()
  val store=ViewModelStore()
  lateinit var model:WorkspaceModel
  lateinit var uiContext:Context
  try{
   compose.activityRule.scenario.onActivity{activity->
    val prefix="mail-html-qa-${java.util.UUID.randomUUID()}-"
    val app=object:android.app.Application(){init{attachBaseContext(activity.application)};override fun getApplicationContext():Context=this;override fun getSharedPreferences(name:String,mode:Int)=super.getSharedPreferences(prefix+name,mode)}
    uiContext=object:android.content.ContextWrapper(activity){override fun getSharedPreferences(name:String,mode:Int)=app.getSharedPreferences(name,mode);override fun getApplicationContext():Context=app}
    model=ViewModelProvider(store,object:ViewModelProvider.Factory{override fun <T:androidx.lifecycle.ViewModel> create(modelClass:Class<T>):T=modelClass.cast(WorkspaceModel(app,WorkspaceModelDependencies(storage={name,_,_->stores.getOrPut(name){Memory()}},httpClient=client,registerConnectivity=false,clearCachedMailBodies={})))!!})[WorkspaceModel::class.java]
   }
   compose.waitUntil(10000){!model.state.value.restoring&&!model.state.value.busy}
   assertTrue(model.state.value.signedIn)
   compose.waitUntil(5000){model.hermes.ownerFence()!=null}
   compose.setContent{val state by model.state.collectAsStateWithLifecycle(); CompositionLocalProvider(LocalInspectionMode provides true,LocalContext provides uiContext){DccTheme{Workspace(state,model::signIn,model::refresh,model::signOut,model::complete,model::feedback,initialDestination=Destination.Inbox,projectModel=model)}}}
   // Open filters, select account, collapse filters before scrolling/anchor capture.
   compose.onNodeWithText("Filters").performScrollTo().performClick()
   compose.onNodeWithText("personal").performScrollTo().performClick()
   compose.onNodeWithText("Filters · active").performScrollTo().performClick() // collapse
   // Materialize lazy children, enter shared query matching all messages.
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-search"))
   compose.onNodeWithTag("mail-search").performScrollTo().performTextInput("Synthetic")
   compose.waitForIdle()
   // Establish stable keyboard-hidden viewport before anchor capture (IME show/hide changes LazyList viewport).
   compose.activityRule.scenario.onActivity { activity ->
    activity.currentFocus?.clearFocus()
    val imm=activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    imm.hideSoftInputFromWindow(activity.window.decorView.windowToken, 0)
   }
   compose.waitForIdle(); compose.runOnIdle{}; compose.waitForIdle()
   // Scroll to target at nonzero anchor (index 12 among Synthetic matches) and record anchor after positioning.
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-row-$targetId"))
   compose.onNodeWithTag("mail-row-$targetId").assertIsDisplayed()
   compose.waitForIdle()
   val listBeforeOpen=compose.onNodeWithTag("inbox-list").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
   val htmlGetsBefore=requests.count{it=="GET /api/v1/mail/html/$targetId"}
   compose.onNodeWithTag("mail-row-$targetId").performClick()
   compose.onNodeWithTag("mail-reader").assertIsDisplayed()
   compose.onNodeWithTag("mail-reader-close").assertIsDisplayed()
   // Diagnostic: confirm HTML branch rendered and HTTP GET occurred before title wait.
   compose.waitUntil(10000){compose.onAllNodesWithTag("mail-reader-html").fetchSemanticsNodes().isNotEmpty()}
   assertTrue("Expected formatted HTML GET: $requests",requests.any{it=="GET /api/v1/mail/html/$targetId"})
   waitForRenderedHtmlTitle("Synthetic formatted message")
   assertAccessibilityHeading("Synthetic formatted heading")
   assertEquals("Available HTML must not wait for plaintext",0,plaintextRequests.get())
   captureFullWindowSynthetic("mail-reader-formatted")
   // Long formatted content: scroll WebView and confirm fixed Close remains reachable.
   compose.runOnIdle{
    val views=mutableListOf<View>(); if(Build.VERSION.SDK_INT>=29) views+=WindowInspector.getGlobalWindowViews() else views+=compose.activity.window.decorView
    val webViews=mutableListOf<WebView>(); views.forEach{webViews(it,webViews)}; webViews.firstOrNull()?.scrollTo(0,1200)
   }
   compose.waitForIdle()
   compose.onNodeWithTag("mail-reader-close").assertIsDisplayed()
   compose.onNodeWithTag("mail-reader-close").performClick()
   compose.onNodeWithTag("mail-reader").assertDoesNotExist()
   // Assert anchor/state retention first; controls may be offscreen and scrolling up would change anchor.
   val listAfterClose=compose.onNodeWithTag("inbox-list").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
   assertEquals("Inbox scroll anchor should be retained after Close",listBeforeOpen,listAfterClose,1f)
   compose.onNodeWithTag("mail-row-$targetId").assertIsDisplayed()
   // Verify retained query/filter by scrolling to controls (may change anchor; acceptable after anchor assertion).
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-search"))
   compose.onNodeWithTag("mail-search").assertTextContains("Synthetic")
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("Filters · active"))
   compose.onNodeWithText("Filters · active").performClick()
   compose.onNodeWithText("personal").assertIsSelected()
   compose.onNodeWithText("Filters · active").performClick() // collapse
   assertEquals("Close must not resend formatted HTML",htmlGetsBefore+1,requests.count{it=="GET /api/v1/mail/html/$targetId"})
   assertEquals("Unexpected requests: $requests",0,unexpectedRequests.get())
   // Reopen and close via Android Back, preserving state.
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-row-$targetId"))
   compose.onNodeWithTag("mail-row-$targetId").performClick()
   compose.onNodeWithTag("mail-reader").assertIsDisplayed()
   InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
   compose.onNodeWithTag("mail-reader").assertDoesNotExist()
   compose.onNodeWithTag("mail-row-$targetId").assertIsDisplayed()
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-search"))
   compose.onNodeWithTag("mail-search").assertTextContains("Synthetic")
  }catch(error:Throwable){
   failureArtifacts.capture(error,org.junit.runner.Description.createTestDescription(MailReaderTest::class.java,"inbox-formatted-before-cleanup")); throw error
  }finally{
   compose.activityRule.scenario.onActivity{store.clear()}
   client.dispatcher.executorService.shutdownNow(); client.connectionPool.evictAll()
  }
 }
 @Test fun formattedReaderFetchesSafeSyntheticImageThroughOwnedClient(){
  val owner="e".repeat(64)
  val messageId="f".repeat(64)
  val png=intArrayOf(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0x0d,0x49,0x48,0x44,0x52,0,0,0,1,0,0,0,1,0x08,0x06,0,0,0,0x1f,0x15,0xc4,0x89,0,0,0,0x0a,0x49,0x44,0x41,0x54,0x78,0x9c,0x63,0,1,0,0,0x05,0,1,0x0d,0x0a,0x2d,0xb4,0,0,0,0,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82).map{it.toByte()}.toByteArray()
  val imageCalls=java.util.concurrent.CopyOnWriteArrayList<okhttp3.Request>()
  val terminal:(okhttp3.Request)->okhttp3.Response?={req->
   imageCalls+=req
   okhttp3.Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("OK")
    .header("Content-Type","image/png").body(png.toResponseBody("image/png".toMediaType())).build()
  }
  // HTML includes a safe remote image and an unsafe/local image; unsafe must be blocked by URL policy before owned fetch.
  val html="""<!doctype html><html><head><title>Synthetic image message</title></head><body><h1>Synthetic image heading</h1><img src="https://img.example.test/safe.png" alt="safe"><img src="http://127.0.0.1/unsafe.png" alt="unsafe"><img src="https://$MAIL_APP_ORIGIN_HOST/app.png" alt="app"></body></html>"""
  val requests=CopyOnWriteArrayList<String>()
  class Memory(var raw:String?=null):SessionStorage { @Synchronized override fun read()=raw; @Synchronized override fun write(value:String){raw=value}; @Synchronized override fun clear(){raw=null} }
  val stores=java.util.concurrent.ConcurrentHashMap<String,Memory>()
  stores["session.enc"]=Memory(Cookie.Builder().name("daymark_session").value("synthetic-only").hostOnlyDomain("dcc.home.captnuu.online").path("/").secure().httpOnly().expiresAt(System.currentTimeMillis()+3600000).build().toString())
  val client=OkHttpClient.Builder().addInterceptor{chain->
   val request=chain.request(); val call="${request.method} ${request.url.encodedPath}"; requests+=call
   fun json(value:JSONObject)=Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("Synthetic").body(value.toString().toResponseBody("application/json".toMediaType())).build()
   fun jsonText(value:String)=Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("Synthetic").body(value.toResponseBody("application/json".toMediaType())).build()
   when {
    call=="GET /api/v1/auth/session" -> json(JSONObject().put("authenticated",true).put("workspaceOwner",owner))
    call=="GET /api/v1/hermes/action-capabilities" -> json(JSONObject().put("conversation",true).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1).put("workspaceOwner",owner))
    call=="GET /api/v1/planner/snapshot" -> json(JSONObject().put("projects",JSONArray()).put("preparations",JSONArray()).put("actions",JSONArray()))
    call=="GET /api/v1/calendar/snapshot" -> json(JSONObject().put("calendars",JSONArray()).put("events",JSONArray()))
    call=="GET /api/v1/mail/html/$messageId" -> jsonText(JSONObject().put("hasHtml",true).put("html",html).toString())
    call=="GET /api/v1/mail/message/$messageId" -> json(JSONObject().put("id",messageId).put("body","Plain"))
    else -> Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(599).message("Unexpected").body("{\"error\":\"unexpected\"}".toResponseBody("application/json".toMediaType())).build()
   }
  }.build()
  val store=ViewModelStore()
  lateinit var model:WorkspaceModel
  lateinit var uiContext:Context
  try{
   compose.activityRule.scenario.onActivity{activity->
    val prefix="mail-img-qa-${java.util.UUID.randomUUID()}-"
    val app=object:android.app.Application(){init{attachBaseContext(activity.application)};override fun getApplicationContext():Context=this;override fun getSharedPreferences(name:String,mode:Int)=super.getSharedPreferences(prefix+name,mode)}
    uiContext=object:android.content.ContextWrapper(activity){override fun getSharedPreferences(name:String,mode:Int)=app.getSharedPreferences(name,mode);override fun getApplicationContext():Context=app}
    model=ViewModelProvider(store,object:ViewModelProvider.Factory{override fun <T:androidx.lifecycle.ViewModel> create(modelClass:Class<T>):T=modelClass.cast(WorkspaceModel(app,WorkspaceModelDependencies(storage={name,_,_->stores.getOrPut(name){Memory()}},httpClient=client,registerConnectivity=false,clearCachedMailBodies={})))!!})[WorkspaceModel::class.java]
   }
   compose.waitUntil(10000){!model.state.value.restoring&&!model.state.value.busy && model.hermes.ownerFence()!=null}
   val message=mailMessage(JSONObject().put("data",JSONObject().put("id",messageId).put("account","personal").put("sender","s").put("subject","Synthetic image message")))
   compose.setContent{CompositionLocalProvider(LocalInspectionMode provides true,LocalContext provides uiContext){DccTheme{MailReader(message,model=model,resourceTerminalInterceptor=terminal,onClose={})}}}
   compose.onNodeWithTag("mail-reader-close").assertIsDisplayed()
   waitForRenderedHtmlTitle("Synthetic image message")
   assertAccessibilityHeading("Synthetic image heading")
   compose.waitUntil(10000){imageCalls.any{it.url.host=="img.example.test"}}
   val safe=imageCalls.first{it.url.host=="img.example.test"}
   assertNull("Resource client must not forward Authorization",safe.header("Authorization"))
   assertNull("Resource client must not forward Cookie",safe.header("Cookie"))
   assertNull("Resource client must not forward Referer",safe.header("Referer"))
   assertTrue("Unsafe/local/app-origin images must be blocked before owned fetch: ${imageCalls.map{it.url.host}}",imageCalls.none{it.url.host=="127.0.0.1"||it.url.host==MAIL_APP_ORIGIN_HOST})
  }catch(error:Throwable){ failureArtifacts.capture(error,org.junit.runner.Description.createTestDescription(MailReaderTest::class.java,"mail-image-before-cleanup")); throw error }
  finally{ compose.activityRule.scenario.onActivity{store.clear()}; client.dispatcher.executorService.shutdownNow(); client.connectionPool.evictAll() }
 }

 private fun captureFullWindowSynthetic(name:String){
  val instrumentation=InstrumentationRegistry.getInstrumentation()
  val directory=checkNotNull(instrumentation.targetContext.getExternalFilesDir("qa-ui-captures"))
  check(directory.isDirectory||directory.mkdirs())
  compose.waitForIdle()
  val image=checkNotNull(instrumentation.uiAutomation.takeScreenshot()){"Screenshot unavailable for $name"}
  val png=java.io.File(directory,"$name.png")
  try{png.outputStream().use{check(image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it))}}finally{image.recycle()}
  println("QA_UI_CAPTURE ${png.absolutePath}")
 }
}
