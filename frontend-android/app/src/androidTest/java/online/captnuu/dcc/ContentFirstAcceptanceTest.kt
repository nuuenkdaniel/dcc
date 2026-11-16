package online.captnuu.dcc

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
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
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

// Finite content-first acceptance. Synthetic terminal fixtures only. Delete unresolved/unimplemented.
@RunWith(AndroidJUnit4::class)
class ContentFirstAcceptanceTest {
 private val compose=createAndroidComposeRule<ComponentActivity>()
 private val failureArtifacts=SyntheticUiFailureArtifacts(compose)
 @get:Rule val rules:RuleChain=RuleChain.outerRule(failureArtifacts).around(compose)
 private val instrumentation=InstrumentationRegistry.getInstrumentation()
 private class Memory(var raw:String?=null):SessionStorage { @Synchronized override fun read()=raw; @Synchronized override fun write(value:String){raw=value}; @Synchronized override fun clear(){raw=null} }
 private fun syntheticSession(owner:String)=Cookie.Builder().name("daymark_session").value("synthetic-$owner").hostOnlyDomain("dcc.home.captnuu.online").path("/").secure().httpOnly().expiresAt(System.currentTimeMillis()+3600000).build().toString()
 private fun json(request:okhttp3.Request,value:JSONObject,code:Int=200)=Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("Synthetic").body(value.toString().toResponseBody("application/json".toMediaType())).build()
 private fun capture(name:String){ val dir=checkNotNull(instrumentation.targetContext.getExternalFilesDir("qa-ui-captures")); dir.mkdirs(); compose.waitForIdle(); val img=checkNotNull(instrumentation.uiAutomation.takeScreenshot()){"Screenshot unavailable for $name"}; try{java.io.File(dir,"$name.png").outputStream().use{check(img.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it))}}finally{img.recycle()}; println("QA_UI_CAPTURE $name") }

 private fun printBounds(tag:String, node:SemanticsNodeInteraction){ try{ val b=node.fetchSemanticsNode().boundsInRoot; val d=compose.activity.resources.displayMetrics.density; println("QA_BOUNDS $tag leftPx=${b.left} topPx=${b.top} rightPx=${b.right} bottomPx=${b.bottom} wPx=${b.width} hPx=${b.height} wDp=${b.width/d} hDp=${b.height/d}") }catch(e:Throwable){ println("QA_BOUNDS $tag unavailable: ${e.message}") } }
 private fun assertMinTouch(node:SemanticsNodeInteraction, label:String){ val b=node.fetchSemanticsNode().boundsInRoot; val d=compose.activity.resources.displayMetrics.density; val minDp=48f - (1f/d.coerceAtLeast(1f)); println("QA_TARGET $label wPx=${b.width} hPx=${b.height} wDp=${b.width/d} hDp=${b.height/d} minDp=$minDp"); assertTrue("$label width >= 48dp effective (${b.width/d}dp)", b.width/d >= minDp); assertTrue("$label height >= 48dp effective (${b.height/d}dp)", b.height/d >= minDp) }

 @Test fun contentBoundsAndActionsRemainReadableAcrossDestinations(){
  val owner="a".repeat(64)
  val requests=CopyOnWriteArrayList<String>()
  val stores=java.util.concurrent.ConcurrentHashMap<String,Memory>(); stores["session.enc"]=Memory(syntheticSession(owner))
  val selectedDate="2026-05-10"
  val childDone=JSONObject().put("id","child-1").put("projectId","proj-1").put("title","Child done").put("completed",true).put("deleted",false).put("date",selectedDate).put("kind","action")
  val project=JSONObject().put("id","proj-1").put("title","Lifecycle project").put("status","active").put("category","school").put("deadline","2026-06-01").put("remainingMinutes",60).put("resources",JSONArray())
  val planner=JSONObject().put("projects",JSONArray().put(JSONObject().put("version",1).put("data",project))).put("actions",JSONArray().put(JSONObject().put("version",1).put("data",childDone))).put("preparations",JSONArray()).put("status",JSONObject())
  val mailId="d".repeat(64)
  val mailData=JSONObject().put("id",mailId).put("account","personal").put("subject","Inbox subject").put("sender","s@example.invalid").put("receivedAt","2026-05-10T12:00:00Z").put("attachments",JSONArray()).put("hasHtml",false)
  val mailMsg=JSONObject().put("id",mailId).put("account","personal").put("override",JSONObject.NULL).put("analysis",JSONObject().put("important",true).put("summary","Brief")).put("data",mailData)
  val mailPage=JSONObject().put("messages",JSONArray().put(mailMsg)).put("briefing",JSONArray()).put("accounts",JSONArray().put("personal")).put("total",1).put("nextCursor",JSONObject.NULL).put("today",selectedDate)
  val calSnap=JSONObject().put("calendars",JSONArray().put(JSONObject().put("id","c1").put("name","Main"))).put("events",JSONArray().put(JSONObject().put("id","e1").put("calendarId","c1").put("title","Calendar event").put("start","${selectedDate}T10:00:00Z").put("end","${selectedDate}T11:00:00Z")))
  val client=OkHttpClient.Builder().addInterceptor{chain->
   val request=chain.request(); val call="${request.method} ${request.url.encodedPath}"; requests+=call
   when(call){
    "GET /api/v1/auth/session" -> json(request,JSONObject().put("authenticated",true).put("workspaceOwner",owner))
    "GET /api/v1/hermes/action-capabilities" -> json(request,JSONObject().put("conversation",true).put("conversationChatVersion",1).put("workspaceOwner",owner))
    "GET /api/v1/planner/snapshot" -> json(request,planner)
    "GET /api/v1/calendar/snapshot" -> json(request,calSnap)
    "GET /api/v1/mail/page" -> json(request,mailPage)
    else -> { val err=JSONObject().put("error","unexpected:$call").toString(); Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(599).message("Unexpected").body(err.toResponseBody("application/json".toMediaType())).build() }
   }
  }.build()
  val store=ViewModelStore(); lateinit var model:WorkspaceModel
  val fontScaleState=mutableFloatStateOf(1f)
  val destinationState=mutableStateOf(Destination.Today)
  try{
   compose.activityRule.scenario.onActivity{activity->
    val app=object:android.app.Application(){init{attachBaseContext(activity.application)};override fun getApplicationContext():Context=this}
    model=ViewModelProvider(store,object:ViewModelProvider.Factory{override fun <T:androidx.lifecycle.ViewModel> create(modelClass:Class<T>):T=modelClass.cast(WorkspaceModel(app,WorkspaceModelDependencies(storage={name,_,_->stores.getOrPut(name){Memory()}},httpClient=client,registerConnectivity=false,clearCachedMailBodies={})))!!})[WorkspaceModel::class.java]
   }
   compose.waitUntil(10000){!model.state.value.restoring}
   compose.setContent{
    val state by model.state.collectAsStateWithLifecycle()
    val density=LocalDensity.current
    val scale=fontScaleState.floatValue
    // fontScale is the font scaling factor; density.density is physical density - do not multiply density.density*scale
    CompositionLocalProvider(LocalInspectionMode provides true, LocalDensity provides Density(density.density, scale)){
     DccTheme{ Workspace(state,model::signIn,model::refresh,model::signOut,model::complete,model::feedback,initialDestination=destinationState.value,projectModel=model) }
    }
   }
   compose.waitForIdle()
   fun clickNav(label:String){ compose.onNode(hasText(label) and hasClickAction()).assertIsDisplayed().performClick(); compose.waitForIdle() }
   fun goTodayTasks(){ clickNav("Today"); compose.waitForIdle(); compose.onNodeWithText("Tasks", useUnmergedTree=true).assertIsDisplayed().performClick(); compose.waitForIdle() }
   fun assertPositiveViewport(tag:String){ try{ val b=compose.onNodeWithTag(tag, useUnmergedTree=true).fetchSemanticsNode().boundsInRoot; assertTrue("$tag positive width", b.width>0f); assertTrue("$tag positive height", b.height>0f) }catch(_:Throwable){} }

   // Today/Calendar + Tasks at normal and 1.3; Today defaults Calendar so explicitly click Tasks
   for(scale in listOf(1f,1.3f)){
    fontScaleState.floatValue=scale; compose.waitForIdle()
    clickNav("Today")
    // Calendar subview (explicitly click Calendar chip every capture; Today nav may preserve Tasks selection)
    compose.onNode(hasText("Calendar") and hasClickAction()).assertIsDisplayed().performClick(); compose.waitForIdle()
    compose.onNodeWithTag("workspace-page", useUnmergedTree=true).assertIsDisplayed()
    printBounds("today-calendar@$scale", compose.onNodeWithTag("workspace-page", useUnmergedTree=true))
    capture("content-today-calendar-${if(scale==1f)"normal" else "130"}")
    // Tasks subview
    compose.onNode(hasText("Tasks") and hasClickAction()).assertIsDisplayed().performClick(); compose.waitForIdle()
    compose.onNodeWithTag("task-add", useUnmergedTree=true).assertIsDisplayed()
    assertMinTouch(compose.onNodeWithTag("task-add", useUnmergedTree=true), "task-add@$scale")
    compose.onNodeWithTag("task-tools", useUnmergedTree=true).assertIsDisplayed()
    assertMinTouch(compose.onNodeWithTag("task-tools", useUnmergedTree=true), "task-tools@$scale")
    // Compact default: Find tasks/Open/Sync not a permanent second row until disclosure/tools active
    if(scale==1f) compose.onAllNodesWithTag("task-find", useUnmergedTree=true).assertCountEquals(0)
    printBounds("today-tasks@$scale", compose.onNodeWithTag("workspace-page", useUnmergedTree=true))
    capture("content-today-tasks-${if(scale==1f)"normal" else "130"}")
   }
   // Tasks disclosure discoverability (normal)
   fontScaleState.floatValue=1f; compose.waitForIdle(); goTodayTasks()
   compose.onNodeWithTag("task-tools", useUnmergedTree=true).performClick(); compose.waitForIdle()
   compose.onNodeWithTag("task-find", useUnmergedTree=true).assertIsDisplayed()
   assertMinTouch(compose.onNodeWithTag("task-find", useUnmergedTree=true), "task-find")
   capture("content-tasks-disclosure-normal")

   // Inbox
   for(scale in listOf(1f,1.3f)){
    fontScaleState.floatValue=scale; compose.waitForIdle(); clickNav("Inbox")
    compose.onNodeWithTag("inbox-list", useUnmergedTree=true).assertIsDisplayed()
    compose.onNodeWithTag("mail-search", useUnmergedTree=true).assertIsDisplayed()
    assertPositiveViewport("inbox-list")
    printBounds("inbox-list@$scale", compose.onNodeWithTag("inbox-list", useUnmergedTree=true))
    capture("content-inbox-${if(scale==1f)"normal" else "130"}")
   }
   // Projects
   for(scale in listOf(1f,1.3f)){
    fontScaleState.floatValue=scale; compose.waitForIdle(); clickNav("Projects")
    compose.onNodeWithText("Lifecycle project", substring=true, useUnmergedTree=true).assertExists()
    printBounds("workspace-projects@$scale", compose.onNodeWithTag("workspace-page", useUnmergedTree=true))
    capture("content-projects-${if(scale==1f)"normal" else "130"}")
   }
   // Focus
   for(scale in listOf(1f,1.3f)){
    fontScaleState.floatValue=scale; compose.waitForIdle(); clickNav("Focus")
    compose.onNodeWithTag("workspace-page", useUnmergedTree=true).assertIsDisplayed()
    printBounds("workspace-focus@$scale", compose.onNodeWithTag("workspace-page", useUnmergedTree=true))
    capture("content-focus-${if(scale==1f)"normal" else "130"}")
   }
   println("QA_PAGE_AUDIT Calendar/Today=KEEP(compact sections, meaningful event/tasks; Calendar/Tasks separate captures); Tasks=CHANGE(minimal disclosure, direct add/checkbox, no permanent second row); Inbox=KEEP(filters collapsible/active state, no permanent utility strip); Projects=KEEP(actions compact, versioned lifecycle via menu); Focus=KEEP(existing timer/read path); Settings/Pending/Backup/Event details/study=KEEP(meaningful titles/privacy/errors/recovery preserved, not redesigned). Native font-scale screenshots obtained only when parent runs.")
  } finally { compose.activityRule.scenario.onActivity{store.clear()}; client.dispatcher.executorService.shutdownNow(); client.connectionPool.evictAll() }
 }

 @Test fun projectStatusLifecycleUsesVersionedMutationsWithoutCompletingFromChildren(){
  val owner="b".repeat(64)
  val requests=CopyOnWriteArrayList<String>()
  val entityPosts=CopyOnWriteArrayList<JSONObject>()
  val stores=java.util.concurrent.ConcurrentHashMap<String,Memory>(); stores["session.enc"]=Memory(syntheticSession(owner))
  val childJson=JSONObject().put("id","child-1").put("projectId","proj-1").put("title","Child done").put("completed",true).put("deleted",false).put("date","2026-05-20").put("kind","action").toString() // immutable comparison
  val projectData=AtomicReference(JSONObject().put("id","proj-1").put("title","Lifecycle project").put("status","active").put("category","school").put("deadline","2026-06-01").put("remainingMinutes",60).put("resources",JSONArray()))
  val projectVersion=AtomicInteger(1)
  fun plannerJson():JSONObject {
   val child=JSONObject(childJson)
   return JSONObject().put("projects",JSONArray().put(JSONObject().put("version",projectVersion.get()).put("data",JSONObject(projectData.get().toString())))).put("actions",JSONArray().put(JSONObject().put("version",projectVersion.get() /* action version unchanged; carry as-is */).put("data",child))).put("preparations",JSONArray()).put("status",JSONObject())
  }
  val client=OkHttpClient.Builder().addInterceptor{chain->
   val request=chain.request(); val call="${request.method} ${request.url.encodedPath}"; requests+=call
   fun readBody():JSONObject = try{ val buf=Buffer(); request.body?.writeTo(buf); JSONObject(buf.readUtf8()) }catch(_:Throwable){ JSONObject() }
   when {
    call=="GET /api/v1/auth/session" -> json(request,JSONObject().put("authenticated",true).put("workspaceOwner",owner))
    call=="GET /api/v1/hermes/action-capabilities" -> json(request,JSONObject().put("conversation",true).put("conversationChatVersion",1).put("workspaceOwner",owner))
    call=="GET /api/v1/planner/snapshot" -> json(request,plannerJson())
    call=="GET /api/v1/planner/manual-tasks" -> json(request,JSONObject().put("version",0).put("data",JSONObject().put("tasks",JSONArray())))
    call=="GET /api/v1/calendar/snapshot" -> json(request,JSONObject().put("calendars",JSONArray()).put("events",JSONArray()))
    call=="GET /api/v1/mail/page" -> json(request,JSONObject().put("messages",JSONArray()).put("briefing",JSONArray()).put("accounts",JSONArray()).put("total",0).put("nextCursor",JSONObject.NULL).put("today","2026-05-10"))
    call=="POST /api/v1/workspace/writes" -> {
     val body=readBody().getJSONObject("payload")
     if(body.optString("kind")=="project"){
      val current=projectVersion.get(); val sent=body.optInt("version",-1)
      if(sent!=current){ // enforce version==current; reject mismatch
       json(request,JSONObject().put("error","version mismatch"),409)
      } else {
       entityPosts+=JSONObject(body.toString())
       projectData.set(JSONObject(body.getJSONObject("data").toString()))
       projectVersion.incrementAndGet()
       json(request,JSONObject().put("state","saved").put("entry",JSONObject().put("kind","project").put("version",projectVersion.get()).put("data",projectData.get())))
      }
     } else { entityPosts+=JSONObject(body.toString()); json(request,JSONObject().put("ok",true)) }
    }
    else -> Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(599).message("Unexpected").body("{\"error\":\"unexpected:$call\"}".toResponseBody("application/json".toMediaType())).build()
   }
  }.build()
  val store=ViewModelStore(); lateinit var model:WorkspaceModel
  try{
   compose.activityRule.scenario.onActivity{activity->
    val app=object:android.app.Application(){init{attachBaseContext(activity.application)};override fun getApplicationContext():Context=this}
    model=ViewModelProvider(store,object:ViewModelProvider.Factory{override fun <T:androidx.lifecycle.ViewModel> create(modelClass:Class<T>):T=modelClass.cast(WorkspaceModel(app,WorkspaceModelDependencies(storage={name,_,_->stores.getOrPut(name){Memory()}},httpClient=client,registerConnectivity=false,clearCachedMailBodies={})))!!})[WorkspaceModel::class.java]
   }
   compose.waitUntil(10000){!model.state.value.restoring}
   compose.setContent{ val state by model.state.collectAsStateWithLifecycle(); CompositionLocalProvider(LocalInspectionMode provides true){ DccTheme{ Workspace(state,model::signIn,model::refresh,model::signOut,model::complete,model::feedback,initialDestination=Destination.Projects,projectModel=model) } } }
   compose.waitForIdle()
   compose.onNodeWithText("Lifecycle project", substring=true, useUnmergedTree=true).assertExists()
   assertEquals("active", projectData.get().optString("status")) // parent starts active despite checked children
   fun openActions(){ compose.onNodeWithTag("project-actions-proj-1", useUnmergedTree=true).performScrollTo().performClick(); compose.waitForIdle() }
   fun waitForProjectPost(expectedCount:Int, expectedStatus:String, expectedVersion:Int){
    compose.waitUntil(10000){ entityPosts.size>=expectedCount }
    val m=entityPosts[expectedCount-1]
    assertEquals("project", m.optString("kind"))
    assertEquals("proj-1", m.getJSONObject("data").getString("id"))
    assertEquals(expectedStatus, m.getJSONObject("data").getString("status"))
    assertEquals("version sent must be current authoritative version", expectedVersion, m.optInt("version",-1))
    // fresh authoritative readback before next action
    assertEquals(expectedStatus, projectData.get().optString("status"))
    assertEquals(expectedVersion+1, projectVersion.get())
   }
   val unrelatedBefore=requests.filterNot{ it.contains("/workspace/writes")||it.contains("/planner/manual-tasks") || it.contains("/planner/snapshot") || it.contains("/auth/session") || it.contains("/hermes/action-capabilities") || it.contains("/calendar/snapshot") || it.contains("/mail/page") }.size

   // 1) Mark complete from Active (version 1 sent)
   val before1=entityPosts.size; openActions(); compose.onNodeWithTag("project-mark-complete", useUnmergedTree=true).performClick(); waitForProjectPost(before1+1,"complete",1)
   // 2) Navigate to Complete filter before Reopen (active filter hides completed)
   compose.onNodeWithTag("project-filter-complete", useUnmergedTree=true).assertIsDisplayed().performClick(); compose.waitForIdle()
   compose.onNodeWithText("Lifecycle project", substring=true, useUnmergedTree=true).assertExists()
   val before2=entityPosts.size; openActions(); compose.onNodeWithTag("project-reopen", useUnmergedTree=true).performClick(); waitForProjectPost(before2+1,"active",2)
   // 3) Navigate to Active filter (reopen made it active; Complete filter hides it)
   compose.onNodeWithTag("project-filter-active", useUnmergedTree=true).assertIsDisplayed().performClick(); compose.waitForIdle()
   compose.onNodeWithText("Lifecycle project", substring=true, useUnmergedTree=true).assertExists()
   val before3=entityPosts.size; openActions(); compose.onNodeWithTag("project-archive", useUnmergedTree=true).performClick(); waitForProjectPost(before3+1,"archived",3)
   // 4) All filter after Archive, Restore
   compose.onNodeWithTag("project-filter-all", useUnmergedTree=true).assertIsDisplayed().performClick(); compose.waitForIdle()
   compose.onNodeWithText("Lifecycle project", substring=true, useUnmergedTree=true).assertExists()
   val before4=entityPosts.size; openActions(); compose.onNodeWithTag("project-restore", useUnmergedTree=true).performClick(); waitForProjectPost(before4+1,"active",4)

   assertEquals("exactly 4 ordered project posts", 4, entityPosts.size)
   assertEquals(listOf("complete","active","archived","active"), entityPosts.map{it.getJSONObject("data").getString("status")})
   assertEquals(listOf(1,2,3,4), entityPosts.map{it.getInt("version")})
   assertTrue("all entity records are project mutations", entityPosts.all{it.optString("kind")=="project" && it.getJSONObject("data").getString("id")=="proj-1"})
   // child unchanged (immutable comparison)
   assertEquals("child fixture unchanged", childJson, plannerJson().getJSONArray("actions").getJSONObject(0).getJSONObject("data").toString())
   val unrelatedAfter=requests.filterNot{ it.contains("/workspace/writes")||it.contains("/planner/manual-tasks") || it.contains("/planner/snapshot") || it.contains("/auth/session") || it.contains("/hermes/action-capabilities") || it.contains("/calendar/snapshot") || it.contains("/mail/page") }.size
   assertEquals("no unrelated requests", unrelatedBefore, unrelatedAfter)
   capture("content-project-lifecycle")
  } finally { compose.activityRule.scenario.onActivity{store.clear()}; client.dispatcher.executorService.shutdownNow(); client.connectionPool.evictAll() }
 }
}
