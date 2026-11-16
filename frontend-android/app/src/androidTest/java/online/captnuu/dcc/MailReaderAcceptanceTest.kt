package online.captnuu.dcc

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.view.inspector.WindowInspector
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
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
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

// Synthetic mail reader acceptance. Terminal HTTP only; no real provider/mail/browser/network/DNS.
@RunWith(AndroidJUnit4::class)
class MailReaderAcceptanceTest {
 private val compose=createAndroidComposeRule<ComponentActivity>()
 private val failureArtifacts=SyntheticUiFailureArtifacts(compose)
 @get:Rule val rules:RuleChain=RuleChain.outerRule(failureArtifacts).around(compose)
 private val instrumentation=InstrumentationRegistry.getInstrumentation()

 private class Memory(var raw:String?=null):SessionStorage { @Synchronized override fun read()=raw; @Synchronized override fun write(value:String){raw=value}; @Synchronized override fun clear(){raw=null} }
 private fun syntheticSession(owner:String)=Cookie.Builder().name("daymark_session").value("synthetic-$owner").hostOnlyDomain("dcc.home.captnuu.online").path("/").secure().httpOnly().expiresAt(System.currentTimeMillis()+3600000).build().toString()
 private fun json(request:okhttp3.Request,value:JSONObject,code:Int=200)=Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("Synthetic").body(value.toString().toResponseBody("application/json".toMediaType())).build()
 private fun jsonText(request:okhttp3.Request,value:String,code:Int=200)=Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("Synthetic").body(value.toResponseBody("application/json".toMediaType())).build()
 private fun hexId(seed:Int):String = "${"d".repeat(62)}${"%02x".format(seed)}"
 private fun capture(name:String){ val dir=checkNotNull(instrumentation.targetContext.getExternalFilesDir("qa-ui-captures")); dir.mkdirs(); compose.waitForIdle(); val img=checkNotNull(instrumentation.uiAutomation.takeScreenshot()){"Screenshot unavailable for $name"}; try{java.io.File(dir,"$name.png").outputStream().use{check(img.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it))}}finally{img.recycle()} }
 private fun hideKeyboard(){ compose.activityRule.scenario.onActivity { a -> a.currentFocus?.clearFocus(); (a.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(a.window.decorView.windowToken,0) }; compose.waitForIdle(); compose.runOnIdle{}; compose.waitForIdle() }
 private fun isImeVisible():Boolean { var v=false; compose.activityRule.scenario.onActivity { a -> v=ViewCompat.getRootWindowInsets(a.window.decorView)?.isVisible(WindowInsetsCompat.Type.ime())==true }; return v }
 private fun webViews(root:View,out:MutableList<WebView>){ if(root is WebView) out+=root; if(root is android.view.ViewGroup) for(i in 0 until root.childCount) webViews(root.getChildAt(i),out) }
 private fun waitForRenderedHtmlTitle(expected:String){ compose.waitUntil(15000){ var t:String?=null; instrumentation.runOnMainSync{ val views=mutableListOf<View>(); if(Build.VERSION.SDK_INT>=29) views+=WindowInspector.getGlobalWindowViews() else views+=compose.activity.window.decorView; val w=mutableListOf<WebView>(); views.forEach{webViews(it,w)}; t=w.firstOrNull()?.title }; t==expected } }
 // Sealed accessibility: rootInActiveWindow from test thread, NOT UI thread (matches MailReaderTest).
 private fun assertAccessibilityHeading(text:String){
  compose.waitUntil(10000){
   val root=instrumentation.uiAutomation.rootInActiveWindow ?: return@waitUntil false
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
 private fun injectTap(x:Int,y:Int){ val down=SystemClock.uptimeMillis(); val d=MotionEvent.obtain(down,down,MotionEvent.ACTION_DOWN,x.toFloat(),y.toFloat(),0); val u=MotionEvent.obtain(down,down+80,MotionEvent.ACTION_UP,x.toFloat(),y.toFloat(),0); d.source=InputDevice.SOURCE_TOUCHSCREEN; u.source=InputDevice.SOURCE_TOUCHSCREEN; instrumentation.uiAutomation.injectInputEvent(d,true); instrumentation.uiAutomation.injectInputEvent(u,true); d.recycle(); u.recycle() }

 private data class MailFixture(val store:ViewModelStore,val model:WorkspaceModel,val client:OkHttpClient,val requests:CopyOnWriteArrayList<String>)
 private fun mailFixture(owner:String,mailPage:JSONObject,intercept:(okhttp3.Request,CopyOnWriteArrayList<String>,String)->Response?):MailFixture {
  val requests=CopyOnWriteArrayList<String>()
  val stores=java.util.concurrent.ConcurrentHashMap<String,Memory>()
  stores["session.enc"]=Memory(syntheticSession(owner))
  val client=OkHttpClient.Builder().addInterceptor{chain->
   val request=chain.request(); val path=request.url.encodedPath; val call="${request.method} $path"; requests+=call
   intercept(request,requests,call) ?: when {
    call=="GET /api/v1/auth/session" -> json(request,JSONObject().put("authenticated",true).put("workspaceOwner",owner))
    call=="GET /api/v1/hermes/action-capabilities" -> json(request,JSONObject().put("conversation",true).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1).put("workspaceOwner",owner))
    call=="GET /api/v1/planner/snapshot" -> json(request,JSONObject().put("projects",JSONArray()).put("preparations",JSONArray()).put("actions",JSONArray()))
    call=="GET /api/v1/calendar/snapshot" -> json(request,JSONObject().put("calendars",JSONArray()).put("events",JSONArray()))
    call=="GET /api/v1/mail/page" -> json(request,mailPage)
    else -> Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(599).message("Unexpected").body("{\"error\":\"unexpected:$call\"}".toResponseBody("application/json".toMediaType())).build()
   }
  }.build()
  val store=ViewModelStore(); lateinit var model:WorkspaceModel
  compose.activityRule.scenario.onActivity{activity->
   val app=object:android.app.Application(){init{attachBaseContext(activity.application)};override fun getApplicationContext():Context=this}
   model=ViewModelProvider(store,object:ViewModelProvider.Factory{override fun <T:androidx.lifecycle.ViewModel> create(modelClass:Class<T>):T=modelClass.cast(WorkspaceModel(app,WorkspaceModelDependencies(storage={name,_,_->stores.getOrPut(name){Memory()}},httpClient=client,registerConnectivity=false,clearCachedMailBodies={})))!!})[WorkspaceModel::class.java]
  }
  compose.waitUntil(10000){!model.state.value.restoring&&!model.state.value.busy}
  return MailFixture(store,model,client,requests)
 }
 private fun setInboxWorkspace(f:MailFixture){ compose.setContent{ val state by f.model.state.collectAsStateWithLifecycle(); CompositionLocalProvider(LocalInspectionMode provides true){ DccTheme{ Workspace(state,f.model::signIn,f.model::refresh,f.model::signOut,f.model::complete,f.model::feedback,initialDestination=Destination.Inbox,projectModel=f.model) } } } }

 @Test fun safeLinkGestureAndHostileHtmlStayWithinProductionPolicies(){
  val owner="a".repeat(64); val id=hexId(1)
  // Safe link placed visibly at document top; hostile/no-gesture cases remain.
  val hostileHtml="""<!doctype html><html><head><title>Hostile title</title><meta http-equiv="refresh" content="0;url=https://evil.example/"><base href="https://evil.example/"></head><body><p><a href="https://safe.example.test/page" id="safe">Safe link here</a></p><h1 id="h">Hostile heading</h1><script>document.title='MUTATED';document.getElementById('h').textContent='MUTATED'</script><iframe src="https://evil.example/frame"></iframe><form action="https://evil.example/form"><input name=x></form><img src="https://images.example.test/safe.png" alt="safe"><img src="data:image/svg+xml,<svg onload=alert(1)></svg>"><img src="intent://x#Intent;end"><img src="file:///etc/passwd"><img src="content://com.evil/x"><img src="http://127.0.0.1/private"><img src="https://dcc.home.captnuu.online/api/v1/auth/session"><table><tr><td>Cell</td></tr></table></body></html>"""
  val mailPage=JSONObject().put("messages",JSONArray().put(JSONObject().put("id",id).put("account","personal").put("override",JSONObject.NULL).put("analysis",JSONObject().put("important",false)).put("data",JSONObject().put("id",id).put("account","personal").put("subject","Hostile subject").put("sender","s@example.invalid").put("receivedAt","2000-01-01T12:00:00Z").put("attachments",JSONArray()).put("hasHtml",true)))).put("briefing",JSONArray()).put("accounts",JSONArray()).put("total",1).put("nextCursor",JSONObject.NULL).put("today","2000-01-01")
  val mainRequests=CopyOnWriteArrayList<String>()
  val resourceRequests=CopyOnWriteArrayList<String>()
  val launches=CopyOnWriteArrayList<String>()
  val stores=java.util.concurrent.ConcurrentHashMap<String,Memory>(); stores["session.enc"]=Memory(syntheticSession(owner))
  val resourcePng=intArrayOf(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0x0d,0x49,0x48,0x44,0x52,0,0,0,1,0,0,0,1,0x08,0x06,0,0,0,0x1f,0x15,0xc4,0x89,0,0,0,0x0a,0x49,0x44,0x41,0x54,0x78,0x9c,0x63,0,1,0,0,0x05,0,1,0x0d,0x0a,0x2d,0xb4,0,0,0,0,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82).map{it.toByte()}.toByteArray()
  val client=OkHttpClient.Builder().addInterceptor{chain->
   val request=chain.request(); val path=request.url.encodedPath; val call="${request.method} $path"; mainRequests+=call
   when {
    call=="GET /api/v1/auth/session" -> json(request,JSONObject().put("authenticated",true).put("workspaceOwner",owner))
    call=="GET /api/v1/hermes/action-capabilities" -> json(request,JSONObject().put("conversation",true).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1).put("workspaceOwner",owner))
    call=="GET /api/v1/planner/snapshot" -> json(request,JSONObject().put("projects",JSONArray()).put("preparations",JSONArray()).put("actions",JSONArray()))
    call=="GET /api/v1/calendar/snapshot" -> json(request,JSONObject().put("calendars",JSONArray()).put("events",JSONArray()))
    call=="GET /api/v1/mail/page" -> json(request,mailPage)
    call=="GET /api/v1/mail/html/$id" -> jsonText(request,JSONObject().put("hasHtml",true).put("html",hostileHtml).toString())
    call.startsWith("GET /api/v1/mail/message/") -> json(request,JSONObject().put("id",id).put("body","plain"))
    else -> Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(599).message("Unexpected").body("{\"error\":\"unexpected:$call\"}".toResponseBody("application/json".toMediaType())).build()
   }
  }.build()
  // Terminal resource hook: returns known PNG/599, records ALL requests, never proceeds to public network/DNS.
  val resourceTerminal: (okhttp3.Request)->Response? = { req ->
   resourceRequests+="${req.method} ${req.url}"
   when(req.url.host){
    "images.example.test" -> Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("OK").header("Content-Type","image/png").body(resourcePng.toResponseBody("image/png".toMediaType())).build()
    else -> Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(599).message("Terminal").body(ByteArray(0).toResponseBody("application/octet-stream".toMediaType())).build()
   }
  }
  val store=ViewModelStore(); lateinit var model:WorkspaceModel
  try{
   compose.activityRule.scenario.onActivity{activity->
    val app=object:android.app.Application(){init{attachBaseContext(activity.application)};override fun getApplicationContext():Context=this}
    model=ViewModelProvider(store,object:ViewModelProvider.Factory{override fun <T:androidx.lifecycle.ViewModel> create(modelClass:Class<T>):T=modelClass.cast(WorkspaceModel(app,WorkspaceModelDependencies(storage={name,_,_->stores.getOrPut(name){Memory()}},httpClient=client,registerConnectivity=false,clearCachedMailBodies={})))!!})[WorkspaceModel::class.java]
   }
   compose.waitUntil(10000){!model.state.value.restoring}
   val message=mailMessage(JSONObject().put("id",id).put("account","personal").put("subject","Hostile subject").put("sender","s@example.invalid").put("hasHtml",true).put("data",JSONObject().put("id",id).put("hasHtml",true)))
   compose.setContent{ CompositionLocalProvider(LocalInspectionMode provides true){ DccTheme{ MailReader(message,model,externalLinkLauncher=MailExternalLinkLauncher{url->launches+=url; true},resourceTerminalInterceptor=resourceTerminal){ } } } }
   compose.onNodeWithTag("mail-reader").assertIsDisplayed()
   compose.waitUntil(15000){ compose.onAllNodesWithTag("mail-reader-html").fetchSemanticsNodes().isNotEmpty() }
   waitForRenderedHtmlTitle("Hostile title")
   assertAccessibilityHeading("Hostile heading")
   compose.waitForIdle(); Thread.sleep(500)
   // No unexpected/app-origin/unsafe resource fetches (all terminal requests recorded).
   assertTrue("No app-origin/localhost/evil resource fetches: $resourceRequests", resourceRequests.none{ it.contains("dcc.home.captnuu.online") || it.contains("127.0.0.1") || it.contains("evil.example") || it.contains("localhost") })
   assertTrue("Safe image host should be fetched via terminal hook: $resourceRequests", resourceRequests.any{it.contains("images.example.test")})
   assertTrue("No external launches from hostile load/redirects", launches.isEmpty())
   // Genuine safe link: find actual anchor via sealed UiAutomation bounds and tap with SystemClock.uptimeMillis.
   val expectedSafeUrl="https://safe.example.test/page"
   run {
    val bounds=android.graphics.Rect()
    compose.onNodeWithTag("mail-reader-html").fetchSemanticsNode().boundsInRoot.let{ b ->
     compose.activityRule.scenario.onActivity { a -> val loc=IntArray(2); a.window.decorView.getLocationOnScreen(loc); bounds.set((loc[0]+b.left).toInt(), (loc[1]+b.top).toInt(), (loc[0]+b.right).toInt(), (loc[1]+b.bottom).toInt()) }
    }
    val root=instrumentation.uiAutomation.rootInActiveWindow
    if(root!=null){
     val candidates=mutableListOf<android.graphics.Rect>()
     fun walk(node:android.view.accessibility.AccessibilityNodeInfo?){
      if(node==null) return
      try{
       val txt=listOf(node.text,node.contentDescription).joinToString(" ")
       val cls=node.className?.toString()?:""
       if((txt.contains("Safe link", true) || (cls.contains("View") && node.isClickable && txt.contains("Safe", true))) && node.isVisibleToUser){
        val r=android.graphics.Rect(); node.getBoundsInScreen(r); if(r.width()>0 && r.height()>0 && bounds.contains(r.centerX(),r.centerY())) candidates+=r
       }
       for(i in 0 until node.childCount) walk(node.getChild(i))
      } finally { node.recycle() }
     }
     walk(root)
     val target=candidates.minByOrNull{ it.centerY() } // top-placed anchor
     if(target!=null){
      injectTap(target.centerX(), target.centerY())
      compose.waitForIdle(); Thread.sleep(400)
     }
    }
   }
   assertEquals("External launches must be exactly the validated safe URL (no unrecognized others): launches=$launches resource=$resourceRequests", listOf(expectedSafeUrl), launches.toList())
   assertTrue("Safe image host fetched via terminal hook: $resourceRequests", resourceRequests.any{it.contains("images.example.test")})
   capture("mail-reader-hostile-policies")
  } finally { compose.activityRule.scenario.onActivity{store.clear()}; client.dispatcher.executorService.shutdownNow(); client.connectionPool.evictAll() }
 }

 @Test fun keyboardOpenReaderCloseRetainsInboxTargetFilterAndQuery(){
  val owner="b".repeat(64); val targetId=hexId(12)
  // All 20 retained records nontrivial and match query "Msg" (including target).
  val msgs=(0 until 20).map{i->val id=if(i==12) targetId else hexId(i); val subject=if(i==12)"Msg keyboard target" else "Msg $i subject"
   JSONObject().put("id",id).put("account","personal").put("override",JSONObject.NULL).put("analysis",JSONObject().put("important",false))
    .put("data",JSONObject().put("id",id).put("account","personal").put("subject",subject).put("sender","s@example.invalid").put("receivedAt","2000-01-01T12:00:00Z").put("attachments",JSONArray()).put("hasHtml",true)) }
  val mailPage=JSONObject().put("messages",JSONArray(msgs)).put("briefing",JSONArray()).put("accounts",JSONArray()).put("total",20).put("nextCursor",JSONObject.NULL).put("today","2000-01-01")
  val html="""<!doctype html><html><head><title>Keyboard target</title></head><body><h1>Keyboard target heading</h1></body></html>"""
  val f=mailFixture(owner,mailPage){request,_,call-> when {
   call=="GET /api/v1/mail/html/$targetId" -> jsonText(request,JSONObject().put("hasHtml",true).put("html",html).toString())
   call.startsWith("GET /api/v1/mail/html/") -> jsonText(request,JSONObject().put("hasHtml",false).put("html",JSONObject.NULL).toString())
   call.startsWith("GET /api/v1/mail/message/") -> json(request,JSONObject().put("id",request.url.pathSegments.last()).put("body","plain"))
   else -> null
  }}
  try{
   setInboxWorkspace(f)
   // Scroll filters first, settle, focus search, wait actual IME visible.
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-search"))
   compose.onNodeWithTag("mail-search").performScrollTo().performClick()
   compose.onNodeWithTag("mail-search").performTextInput("Msg")
   compose.waitForIdle()
   compose.waitUntil(10000){ isImeVisible() } // actual IME visibility required
   compose.onNodeWithText("Filters").performScrollTo().performClick(); compose.waitForIdle()
   compose.onNodeWithText("personal").performScrollTo().performClick(); compose.waitForIdle()
   compose.onNodeWithText("Filters · active").performScrollTo().performClick(); compose.waitForIdle()
   // Scroll to target while IME remains; record bounds before tap.
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-row-$targetId"))
   assertTrue("IME must be visible before tap", isImeVisible())
   val targetBoundsBefore=compose.onNodeWithTag("mail-row-$targetId").fetchSemanticsNode().boundsInRoot
   println("QA_KEYBOARD targetBoundsBefore=$targetBoundsBefore ime=${isImeVisible()}")
   compose.onNodeWithTag("mail-row-$targetId").assertIsDisplayed()
   capture("mail-reader-keyboard-open-before")
   compose.onNodeWithTag("mail-row-$targetId").performClick()
   compose.onNodeWithTag("mail-reader").assertIsDisplayed()
   compose.waitUntil(15000){ compose.onAllNodesWithTag("mail-reader-html").fetchSemanticsNodes().isNotEmpty() }
   waitForRenderedHtmlTitle("Keyboard target")
   capture("mail-reader-keyboard-open-covered")
   compose.onNodeWithTag("mail-reader-close").performClick()
   compose.onNodeWithTag("mail-reader").assertDoesNotExist()
   hideKeyboard(); compose.waitForIdle(); compose.waitUntil(5000){ !isImeVisible() }
   // HARD retained visible anchor IMMEDIATELY after Close and IME hidden, BEFORE any performScrollToNode.
   compose.onNodeWithTag("mail-row-$targetId", useUnmergedTree=true).assertIsDisplayed()
   capture("mail-reader-keyboard-after-close-anchor")
   // Query and selected personal filter checked afterward (open filter and assert personal selected).
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-search"))
   compose.onNodeWithTag("mail-search").assertTextContains("Msg")
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("Filters · active", substring=true))
   compose.onNodeWithText("Filters · active", substring=true, useUnmergedTree=true).performScrollTo().performClick(); compose.waitForIdle()
   compose.onNodeWithText("personal").assertIsSelected()
   // Collapse filter panel so Back path starts from known collapsed state (applied account/query preserved).
   compose.onNodeWithText("Filters · active", substring=true, useUnmergedTree=true).performScrollTo().performClick(); compose.waitForIdle()
   compose.onNodeWithText("personal").assertDoesNotExist()
   // Back path
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-row-$targetId"))
   compose.onNodeWithTag("mail-row-$targetId").performClick(); compose.onNodeWithTag("mail-reader").assertIsDisplayed()
   compose.waitUntil(15000){ compose.onAllNodesWithTag("mail-reader-html").fetchSemanticsNodes().isNotEmpty() }; waitForRenderedHtmlTitle("Keyboard target")
   instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
   compose.onNodeWithTag("mail-reader").assertDoesNotExist()
   hideKeyboard(); compose.waitForIdle(); compose.waitUntil(5000){ !isImeVisible() }
   // HARD visible target assertion BEFORE scroll to search; new after-back-anchor capture.
   compose.onNodeWithTag("mail-row-$targetId", useUnmergedTree=true).assertIsDisplayed()
   capture("mail-reader-keyboard-after-back-anchor")
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-search"))
   compose.onNodeWithTag("mail-search").assertTextContains("Msg")
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasText("Filters · active", substring=true))
   compose.onNodeWithText("Filters · active", substring=true, useUnmergedTree=true).performScrollTo().performClick(); compose.waitForIdle()
   compose.onNodeWithText("personal").assertIsSelected()
  } finally { compose.activityRule.scenario.onActivity{f.store.clear()}; f.client.dispatcher.executorService.shutdownNow(); f.client.connectionPool.evictAll() }
 }

 @Test fun fallbackRetryAndMessageSwitchRemainTruthful(){
  val owner="c".repeat(64); val plainId=hexId(20); val retryId=hexId(21); val oldId=hexId(22); val newId=hexId(23)
  val msgs=listOf(
   Triple(plainId,"Plain only",false),
   Triple(retryId,"Retry message",true),
   Triple(oldId,"Old pending",true),
   Triple(newId,"New message",true),
  ).map{(id,subj,has)-> JSONObject().put("id",id).put("account","personal").put("override",JSONObject.NULL).put("analysis",JSONObject().put("important",false)).put("data",JSONObject().put("id",id).put("account","personal").put("subject",subj).put("sender","s@example.invalid").put("receivedAt","2000-01-01T12:00:00Z").put("attachments",JSONArray()).put("hasHtml",has)) }
  val mailPage=JSONObject().put("messages",JSONArray(msgs)).put("briefing",JSONArray()).put("accounts",JSONArray()).put("total",4).put("nextCursor",JSONObject.NULL).put("today","2000-01-01")
  val htmlGets=CopyOnWriteArrayList<String>()
  val failRetry=AtomicInteger(0)
  val holdOld=CountDownLatch(1); val startedOld=CountDownLatch(1); val releasedOld=CountDownLatch(1)
  val f=mailFixture(owner,mailPage){request,_,call-> when {
   call=="GET /api/v1/mail/html/$plainId" -> { htmlGets+=plainId; jsonText(request,JSONObject().put("hasHtml",false).put("html",JSONObject.NULL).toString()) } // should not be called (hasHtml=false metadata)
   call=="GET /api/v1/mail/message/$plainId" -> json(request,JSONObject().put("id",plainId).put("body","Plain body only"))
   call=="GET /api/v1/mail/html/$retryId" -> {
    htmlGets+=retryId; val n=failRetry.incrementAndGet()
    if(n==1) Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(503).message("Synthetic").body("{\"error\":\"unavailable\"}".toResponseBody("application/json".toMediaType())).build()
    else jsonText(request,JSONObject().put("hasHtml",true).put("html","<!doctype html><html><head><title>Retry OK</title></head><body><h1>Retry heading</h1></body></html>").toString())
   }
   call=="GET /api/v1/mail/message/$retryId" -> json(request,JSONObject().put("id",retryId).put("body","Retry plain fallback"))
   call=="GET /api/v1/mail/html/$oldId" -> { htmlGets+=oldId; startedOld.countDown(); assertTrue(holdOld.await(10,TimeUnit.SECONDS)); jsonText(request,JSONObject().put("hasHtml",true).put("html","<!doctype html><html><head><title>Old stale</title></head><body><h1>Old stale</h1></body></html>").toString()).also{releasedOld.countDown()} }
   call=="GET /api/v1/mail/message/$oldId" -> json(request,JSONObject().put("id",oldId).put("body","Old plain"))
   call=="GET /api/v1/mail/html/$newId" -> { htmlGets+=newId; jsonText(request,JSONObject().put("hasHtml",true).put("html","<!doctype html><html><head><title>New message</title></head><body><h1>New heading</h1></body></html>").toString()) }
   call=="GET /api/v1/mail/message/$newId" -> json(request,JSONObject().put("id",newId).put("body","New plain"))
   else -> null
  }}
  try{
   setInboxWorkspace(f)
   // hasHtml=false => ZERO HTML GET and plain body
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-row-$plainId"))
   compose.onNodeWithTag("mail-row-$plainId").performClick()
   compose.onNodeWithTag("mail-reader").assertIsDisplayed()
   compose.waitUntil(10000){ compose.onAllNodesWithText("Plain body only", substring=true).fetchSemanticsNodes().isNotEmpty() }
   assertEquals("hasHtml=false must cause zero HTML GET", 0, htmlGets.count{it==plainId})
   compose.onNodeWithTag("mail-reader-close").assertIsDisplayed().performClick(); compose.onNodeWithTag("mail-reader").assertDoesNotExist()

   // HTML 503 + successful plain fallback yields finite Retry formatted; explicit retry renders HTML directly.
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-row-$retryId"))
   compose.onNodeWithTag("mail-row-$retryId").performClick(); compose.onNodeWithTag("mail-reader").assertIsDisplayed()
   compose.waitUntil(10000){ compose.onAllNodesWithTag("mail-reader-retry-formatted", useUnmergedTree=true).fetchSemanticsNodes().isNotEmpty() || compose.onAllNodesWithText("Retry plain fallback", substring=true).fetchSemanticsNodes().isNotEmpty() }
   compose.waitUntil(10000){ compose.onAllNodesWithTag("mail-reader-retry-formatted", useUnmergedTree=true).fetchSemanticsNodes().isNotEmpty() }
   val getsBeforeRetry=htmlGets.count{it==retryId}
   assertTrue("first HTML GET attempted", getsBeforeRetry>=1)
   compose.onNodeWithTag("mail-reader-retry-formatted", useUnmergedTree=true).performClick()
   compose.waitUntil(15000){ compose.onAllNodesWithTag("mail-reader-html", useUnmergedTree=true).fetchSemanticsNodes().isNotEmpty() }
   waitForRenderedHtmlTitle("Retry OK")
   assertAccessibilityHeading("Retry heading")
   assertEquals("exactly 2 HTML GETs for retry path", 2, htmlGets.count{it==retryId})
   compose.onNodeWithTag("mail-reader-close").assertIsDisplayed().performClick(); compose.onNodeWithTag("mail-reader").assertDoesNotExist()

   // Switch different message while old response pending; old must not replace current reader or reopen.
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-row-$oldId"))
   compose.onNodeWithTag("mail-row-$oldId").performClick(); compose.onNodeWithTag("mail-reader").assertIsDisplayed()
   assertTrue("old request started", startedOld.await(10,TimeUnit.SECONDS))
   compose.onNodeWithTag("mail-reader-close").performClick(); compose.onNodeWithTag("mail-reader").assertDoesNotExist()
   compose.onNodeWithTag("inbox-list").performScrollToNode(hasTestTag("mail-row-$newId"))
   compose.onNodeWithTag("mail-row-$newId").performClick(); compose.onNodeWithTag("mail-reader").assertIsDisplayed()
   compose.waitUntil(15000){ compose.onAllNodesWithTag("mail-reader-html", useUnmergedTree=true).fetchSemanticsNodes().isNotEmpty() }
   waitForRenderedHtmlTitle("New message"); assertAccessibilityHeading("New heading")
   holdOld.countDown(); assertTrue("old released", releasedOld.await(10,TimeUnit.SECONDS))
   compose.waitForIdle()
   compose.onNodeWithTag("mail-reader").assertIsDisplayed()
   waitForRenderedHtmlTitle("New message") // still current, not replaced by stale old
   compose.onNodeWithTag("mail-reader-close").assertIsDisplayed()
   instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
   compose.onNodeWithTag("mail-reader").assertDoesNotExist() // not reopened
   capture("mail-reader-fallback-retry-switch")
  } finally { holdOld.countDown(); compose.activityRule.scenario.onActivity{f.store.clear()}; f.client.dispatcher.executorService.shutdownNow(); f.client.connectionPool.evictAll() }
 }
}
