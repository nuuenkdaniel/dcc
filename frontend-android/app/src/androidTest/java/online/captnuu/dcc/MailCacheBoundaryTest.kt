package online.captnuu.dcc

import android.app.Application
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
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
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

// Synthetic model/cache boundary tests. Terminal HTTP fixtures only; no real auth/mail/provider.
// SessionStorage fixtures are plaintext files in an isolated temp dir for prune/read alignment;
// they do not claim production AES-at-rest behavior.
@RunWith(AndroidJUnit4::class)
class MailCacheBoundaryTest {
 private val instrumentation=InstrumentationRegistry.getInstrumentation()
 private class FileStorage(private val file:File):SessionStorage {
  @Synchronized override fun read():String? = if(file.exists()) file.readText(Charsets.UTF_8) else null
  @Synchronized override fun write(value:String){ file.parentFile?.mkdirs(); file.writeText(value,Charsets.UTF_8) }
  @Synchronized override fun clear(){ file.delete() }
 }
 private fun syntheticSessionCookie(owner:String):String = Cookie.Builder()
  .name("daymark_session").value("synthetic-$owner").hostOnlyDomain("dcc.home.captnuu.online")
  .path("/").secure().httpOnly().expiresAt(System.currentTimeMillis()+3600000).build().toString()
 private fun json(request:okhttp3.Request,value:JSONObject,code:Int=200)=Response.Builder().request(request)
  .protocol(Protocol.HTTP_1_1).code(code).message("Synthetic")
  .body(value.toString().toResponseBody("application/json".toMediaType())).build()
 private fun jsonText(request:okhttp3.Request,value:String,code:Int=200)=Response.Builder().request(request)
  .protocol(Protocol.HTTP_1_1).code(code).message("Synthetic")
  .body(value.toResponseBody("application/json".toMediaType())).build()
 private fun <T> onMain(block:()->T):T { var out:Result<T>?=null; instrumentation.runOnMainSync{ out=runCatching(block) }; return out!!.getOrThrow() }
 private data class Fixture(val dir:File,val store:ViewModelStore,val model:WorkspaceModel,val client:OkHttpClient,val requests:java.util.concurrent.CopyOnWriteArrayList<String>)
 private fun fixture(owner:String,intercept:(okhttp3.Request,java.util.concurrent.CopyOnWriteArrayList<String>)->Response?):Fixture {
  val activity=instrumentation.targetContext
  val dir=File(activity.cacheDir,"mail-cache-boundary-${UUID.randomUUID()}").apply{mkdirs()}
  val stores=java.util.concurrent.ConcurrentHashMap<String,SessionStorage>()
  fun storage(name:String)=stores.getOrPut(name){ FileStorage(File(dir,name)) }
  storage("session.enc").write(syntheticSessionCookie(owner))
  val requests=java.util.concurrent.CopyOnWriteArrayList<String>()
  val client=OkHttpClient.Builder().addInterceptor{chain->
   val request=chain.request(); val call="${request.method} ${request.url.encodedPath}"; requests+=call
   intercept(request,requests) ?: when {
    call=="GET /api/v1/auth/session" -> json(request,JSONObject().put("authenticated",true).put("workspaceOwner",owner))
    call=="GET /api/v1/hermes/action-capabilities" -> json(request,JSONObject().put("conversation",true).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1).put("workspaceOwner",owner))
    call=="GET /api/v1/planner/snapshot" -> json(request,JSONObject().put("projects",JSONArray()).put("preparations",JSONArray()).put("actions",JSONArray()))
    call=="GET /api/v1/calendar/snapshot" -> json(request,JSONObject().put("calendars",JSONArray()).put("events",JSONArray()))
    call=="GET /api/v1/mail/page" -> json(request,JSONObject().put("messages",JSONArray()).put("briefing",JSONArray()).put("accounts",JSONArray()).put("total",0).put("nextCursor",JSONObject.NULL).put("today","2000-01-01"))
    call=="POST /api/v1/auth/logout" -> json(request,JSONObject())
    else -> Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(599).message("Unexpected").body("{\"error\":\"unexpected:$call\"}".toResponseBody("application/json".toMediaType())).build()
   }
  }.build()
  val store=ViewModelStore()
  val app=object:Application(){init{attachBaseContext(activity.applicationContext as Application)};override fun getApplicationContext():Context=this}
  val deps=WorkspaceModelDependencies(storage={name,_,_->storage(name)},httpClient=client,registerConnectivity=false,clearCachedMailBodies={dir.listFiles()?.filter{it.name.startsWith("mail-")}?.forEach{it.delete()};Unit},mailCacheDir={dir})
  val model=onMain{ ViewModelProvider(store,object:ViewModelProvider.Factory{override fun <T:ViewModel> create(modelClass:Class<T>):T=modelClass.cast(WorkspaceModel(app,deps))!!})[WorkspaceModel::class.java] }
  return Fixture(dir,store,model,client,requests)
 }
 private fun cleanup(f:Fixture){ try{onMain{f.store.clear()}}catch(_:Throwable){}; f.client.dispatcher.executorService.shutdownNow(); f.client.connectionPool.evictAll(); f.dir.deleteRecursively() }
 private fun waitUntil(timeoutMs:Long=10000,cond:()->Boolean){ val end=System.currentTimeMillis()+timeoutMs; while(System.currentTimeMillis()<end){ if(cond()) return; Thread.sleep(25) }; assertTrue("waitUntil timeout",cond()) }

 @Test fun staleOwnerFenceCannotReadAnotherAccountCachedBody(){
  val ownerA="a".repeat(64); val ownerB="b".repeat(64); val id="1".repeat(64)
  val htmlA="""{"hasHtml":true,"html":"<p>A</p>"}"""
  val phaseB=java.util.concurrent.atomic.AtomicBoolean(false)
  val f=fixture(ownerA){request,_-> val path=request.url.encodedPath
   when {
    phaseB.get() && path=="/api/v1/auth/session" -> json(request,JSONObject().put("authenticated",true).put("workspaceOwner",ownerB))
    phaseB.get() && path=="/api/v1/hermes/action-capabilities" -> json(request,JSONObject().put("conversation",true).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1).put("workspaceOwner",ownerB))
    phaseB.get() && path=="/api/v1/mail/html/$id" -> jsonText(request,JSONObject().put("hasHtml",true).put("html","<p>B</p>").toString())
    phaseB.get() && path=="/api/v1/mail/message/$id" -> json(request,JSONObject().put("id",id).put("body","B-body"))
    path=="/api/v1/mail/html/$id" -> jsonText(request,htmlA)
    path=="/api/v1/mail/message/$id" -> json(request,JSONObject().put("id",id).put("body","A-body"))
    else -> null
   }
  }
  try{
   waitUntil{!f.model.state.value.restoring && f.model.state.value.signedIn && f.model.hermes.ownerFence()?.owner==ownerA}
   val fenceA=f.model.hermes.ownerFence()!!
   assertEquals(ownerA,fenceA.owner)
   runBlocking{ withTimeout(10000){ f.model.mailHtml(id,fenceA); f.model.mailBody(id,fenceA) } }
   assertTrue("A HTML cache expected",File(f.dir,"mail-html-$ownerA-$id.enc").exists())
   assertTrue("A body cache expected",File(f.dir,"mail-body-$ownerA-$id.enc").exists())
   fun mailGets()=f.requests.count{it=="GET /api/v1/mail/html/$id"} to f.requests.count{it=="GET /api/v1/mail/message/$id"}
   val getsBeforeB=mailGets()
   // Rebind to ownerB without explicit signOut cache clearing to exercise preserved A cache + stale fence refusal.
   phaseB.set(true)
   onMain{ f.model.hermes.bind(ownerB) }
   waitUntil{ f.model.hermes.ownerFence()?.owner==ownerB }
   val fenceB=f.model.hermes.ownerFence()!!
   assertNotEquals(fenceA.owner to fenceA.generation, fenceB.owner to fenceB.generation)
   val getsAfterBind=mailGets()
   var htmlErr:Throwable?=null; var htmlVal:WorkspaceModel.MailHtmlResult?=null
   runBlocking{ try{ htmlVal=withTimeout(10000){ f.model.mailHtml(id,fenceA) } }catch(t:Throwable){ htmlErr=t } }
   assertNull("Old A fence must not return A HTML under B context: $htmlVal", htmlVal?.html?.takeIf{it.contains("A") && !it.contains("B")})
   assertNotNull("Old A fence HTML should be refused", htmlErr)
   var bodyErr:Throwable?=null; var bodyVal:String?=null
   runBlocking{ try{ bodyVal=withTimeout(10000){ f.model.mailBody(id,fenceA) } }catch(t:Throwable){ bodyErr=t } }
   assertNotEquals("Old A fence must not return A body under B context","A-body",bodyVal)
   assertNotNull("Old A fence body should be refused", bodyErr)
   val getsAfterRefusals=mailGets()
   assertEquals("Stale fence refusals must not issue mail HTML GETs", getsAfterBind.first, getsAfterRefusals.first)
   assertEquals("Stale fence refusals must not issue mail body GETs", getsAfterBind.second, getsAfterRefusals.second)
   // B can fetch its own distinct body for same id.
   runBlocking{ val b=withTimeout(10000){ f.model.mailBody(id,fenceB) }; assertEquals("B-body",b) }
   assertTrue(f.model.state.value.signedIn || f.model.hermes.ownerFence()?.owner==ownerB)
  } finally { cleanup(f) }
 }

 @Test fun cachedHtmlSurvivesOfflineModelRecreationWithoutGuessingOwner(){
  val ownerA="a".repeat(64); val id="2".repeat(64)
  val dir=File(instrumentation.targetContext.cacheDir,"mail-cache-boundary-${UUID.randomUUID()}").apply{mkdirs()}
  val stores=java.util.concurrent.ConcurrentHashMap<String,SessionStorage>()
  fun storage(name:String)=stores.getOrPut(name){ FileStorage(File(dir,name)) }
  storage("session.enc").write(syntheticSessionCookie(ownerA))
  val requests=java.util.concurrent.CopyOnWriteArrayList<String>()
  val offline=java.util.concurrent.atomic.AtomicBoolean(false)
  fun makeClient()=OkHttpClient.Builder().addInterceptor{chain->
   val request=chain.request(); val call="${request.method} ${request.url.encodedPath}"; requests+=call
   if(offline.get() && call=="GET /api/v1/auth/session") throw java.io.IOException("offline synthetic")
   when {
    call=="GET /api/v1/auth/session" -> json(request,JSONObject().put("authenticated",true).put("workspaceOwner",ownerA))
    call=="GET /api/v1/hermes/action-capabilities" -> json(request,JSONObject().put("conversation",true).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1).put("workspaceOwner",ownerA))
    call=="GET /api/v1/planner/snapshot" -> json(request,JSONObject().put("projects",JSONArray()).put("preparations",JSONArray()).put("actions",JSONArray()))
    call=="GET /api/v1/calendar/snapshot" -> json(request,JSONObject().put("calendars",JSONArray()).put("events",JSONArray()))
    call=="GET /api/v1/mail/page" -> json(request,JSONObject().put("messages",JSONArray()).put("briefing",JSONArray()).put("accounts",JSONArray()).put("total",0).put("nextCursor",JSONObject.NULL).put("today","2000-01-01"))
    call=="GET /api/v1/mail/html/$id" -> jsonText(request,JSONObject().put("hasHtml",true).put("html","<p>cached-A</p>").toString())
    else -> Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(599).message("Unexpected").body("{\"error\":\"unexpected:$call\"}".toResponseBody("application/json".toMediaType())).build()
   }
  }.build()
  val activity=instrumentation.targetContext
  val app=object:Application(){init{attachBaseContext(activity.applicationContext as Application)};override fun getApplicationContext():Context=this}
  fun deps(client:OkHttpClient)=WorkspaceModelDependencies(storage={name,_,_->storage(name)},httpClient=client,registerConnectivity=false,clearCachedMailBodies={dir.listFiles()?.filter{it.name.startsWith("mail-")}?.forEach{it.delete()};Unit},mailCacheDir={dir})
  val store1=ViewModelStore(); val client1=makeClient()
  val model1=onMain{ ViewModelProvider(store1,object:ViewModelProvider.Factory{override fun <T:ViewModel> create(modelClass:Class<T>):T=modelClass.cast(WorkspaceModel(app,deps(client1)))!!})[WorkspaceModel::class.java] }
  try{
   waitUntil{!model1.state.value.restoring && model1.state.value.signedIn && model1.hermes.ownerFence()?.owner==ownerA}
   runBlocking{ withTimeout(10000){ val r=model1.mailHtml(id); assertTrue(r.hasHtml); assertEquals("<p>cached-A</p>",r.html) } }
   // Legacy/unowned record in same dir must not be guessed/migrated/displayed.
   val legacy=File(dir,"mail-html-$id.enc")
   val legacyBytes="LEGACY-NO-OWNER".toByteArray(Charsets.UTF_8)
   legacy.writeBytes(legacyBytes)
   val legacyOnlyId="4".repeat(64)
   val legacyOnly=File(dir,"mail-html-$legacyOnlyId.enc")
   val legacyOnlyBytes="LEGACY-ONLY-NO-OWNER".toByteArray(Charsets.UTF_8)
   legacyOnly.writeBytes(legacyOnlyBytes)
   // Simulate process/model recreation without signOut and without clearing synthetic files.
   onMain{ store1.clear() }; client1.dispatcher.executorService.shutdownNow(); client1.connectionPool.evictAll()
   offline.set(true); requests.clear()
   val store2=ViewModelStore(); val client2=makeClient()
   val model2=onMain{ ViewModelProvider(store2,object:ViewModelProvider.Factory{override fun <T:ViewModel> create(modelClass:Class<T>):T=modelClass.cast(WorkspaceModel(app,deps(client2)))!!})[WorkspaceModel::class.java] }
   try{
    waitUntil{!model2.state.value.restoring}
    // Do NOT manually bind A in recreated model; offline cached read must not fabricate live Hermes fence.
    assertNull("Offline cached read must not fabricate a live Hermes fence", model2.hermes.ownerFence())
    val htmlGetsBefore=requests.count{it=="GET /api/v1/mail/html/$id"}
    var htmlVal:WorkspaceModel.MailHtmlResult?=null; var err:Throwable?=null
    runBlocking{ try{ htmlVal=withTimeout(10000){ model2.mailHtml(id) } }catch(t:Throwable){ err=t } }
    assertNull("Cached read should not require network reauth error: $err", err)
    assertNotNull("Previously authorized cached HTML should be readable offline without successful network reauth", htmlVal)
    assertEquals("<p>cached-A</p>", htmlVal?.html)
    assertEquals("No new mail HTML GET should be required for cached read", htmlGetsBefore, requests.count{it=="GET /api/v1/mail/html/$id"})
    assertTrue("Legacy record bytes must be preserved untouched", legacy.exists() && legacy.readBytes().contentEquals(legacyBytes))
    var legacyErr:Throwable?=null; var legacyVal:WorkspaceModel.MailHtmlResult?=null
    runBlocking{ try{ legacyVal=withTimeout(10000){ model2.mailHtml(legacyOnlyId) } }catch(t:Throwable){ legacyErr=t } }
    assertNull("Legacy-only cache must not be guessed/migrated/displayed", legacyVal?.html)
    assertNotNull("Legacy-only cache should be refused", legacyErr)
    assertTrue("Legacy-only bytes must be preserved untouched", legacyOnly.exists() && legacyOnly.readBytes().contentEquals(legacyOnlyBytes))
    assertEquals("Legacy-only refusal must not issue mail HTML GET", 0, requests.count{it=="GET /api/v1/mail/html/$legacyOnlyId"})
   } finally { try{onMain{store2.clear()}}catch(_:Throwable){}; client2.dispatcher.executorService.shutdownNow(); client2.connectionPool.evictAll() }
  } finally { dir.deleteRecursively() }
 }

 @Test fun delayedPriorOwner401CannotClearNewOwnerSessionOrCache(){
  val ownerA="a".repeat(64); val ownerB="b".repeat(64); val id="3".repeat(64)
  val holdA=CountDownLatch(1); val releaseA=CountDownLatch(1); val startedA=CountDownLatch(1)
  val phase=AtomicReference("A")
  val f=fixture(ownerA){request,_-> val path=request.url.encodedPath
   when {
    phase.get()=="A" && path=="/api/v1/mail/html/$id" -> {
     startedA.countDown(); assertTrue("A hold timed out", holdA.await(10,TimeUnit.SECONDS))
     jsonText(request,JSONObject().put("hasHtml",false).put("html",JSONObject.NULL).toString(),401)
    }
    phase.get()=="B" && path=="/api/v1/mail/html/$id" -> jsonText(request,JSONObject().put("hasHtml",true).put("html","<p>B</p>").toString())
    phase.get()=="B" && path=="/api/v1/auth/session" -> json(request,JSONObject().put("authenticated",true).put("workspaceOwner",ownerB))
    else -> null
   }
  }
  try{
   waitUntil{!f.model.state.value.restoring && f.model.state.value.signedIn && f.model.hermes.ownerFence()?.owner==ownerA}
   val fenceA=f.model.hermes.ownerFence()!!
   val deferred=AtomicReference<Result<WorkspaceModel.MailHtmlResult>?>(null)
   var t:Thread?=null
   try{
    t=Thread{
     deferred.set(runCatching{ runBlocking{ withTimeout(15000){ f.model.mailHtml(id,fenceA) } } })
     releaseA.countDown()
    }
    t.start()
    assertTrue("A request did not start", startedA.await(10,TimeUnit.SECONDS))
    // Change actual owner generation to B and populate B cache for same id.
    phase.set("B"); onMain{ f.model.hermes.bind(ownerB) }
    waitUntil{ f.model.hermes.ownerFence()?.owner==ownerB }
    val fenceB=f.model.hermes.ownerFence()!!
    runBlocking{ withTimeout(10000){ val b=f.model.mailHtml(id,fenceB); assertEquals("<p>B</p>",b.html) } }
    val bCache=File(f.dir,"mail-html-$ownerB-$id.enc"); assertTrue(bCache.exists()); val bBytes=bCache.readBytes()
    FileStorage(File(f.dir,"workspace.enc")).write("""{"sentinel":"keep"}""")
    FileStorage(File(f.dir,"outbox.enc")).write("""{"sentinel":"keep"}""")
    holdA.countDown()
    assertTrue("A did not complete", releaseA.await(10,TimeUnit.SECONDS))
    assertTrue("Old A call should fail", deferred.get()?.isFailure == true)
    assertTrue("B remains signed in", f.model.state.value.signedIn)
    assertEquals(ownerB, f.model.hermes.ownerFence()?.owner)
    assertTrue("B cache unchanged", bCache.exists() && bCache.readBytes().contentEquals(bBytes))
    assertEquals("""{"sentinel":"keep"}""", FileStorage(File(f.dir,"workspace.enc")).read())
    assertEquals("""{"sentinel":"keep"}""", FileStorage(File(f.dir,"outbox.enc")).read())
    val bAgain=runBlocking{ withTimeout(10000){ f.model.mailHtml(id,fenceB) } }
    assertEquals("<p>B</p>", bAgain.html)
   } finally {
    holdA.countDown(); releaseA.countDown(); t?.join(2000)
   }
  } finally { cleanup(f) }
 }

 private class IsolatedDirContext(base:Context, private val dir:File):ContextWrapper(base){
  override fun getNoBackupFilesDir():File { dir.mkdirs(); return dir }
  override fun getFilesDir():File { dir.mkdirs(); return dir }
  override fun getCacheDir():File { dir.mkdirs(); return dir }
  override fun getApplicationContext():Context = this
 }
 private fun encryptedFixture(owner:String,intercept:(okhttp3.Request,java.util.concurrent.CopyOnWriteArrayList<String>)->Response?):Fixture {
  val activity=instrumentation.targetContext
  val dir=File(activity.cacheDir,"mail-protected-${UUID.randomUUID()}").apply{mkdirs()}
  val ctx=IsolatedDirContext(activity,dir)
  fun storage(name:String,strict:Boolean=false,existingKeyOnly:Boolean=false):SessionStorage = EncryptedSessionStorage(ctx,name,strict,existingKeyOnly)
  storage("session.enc").write(syntheticSessionCookie(owner))
  val requests=java.util.concurrent.CopyOnWriteArrayList<String>()
  val client=OkHttpClient.Builder().addInterceptor{chain->
   val request=chain.request(); val call="${request.method} ${request.url.encodedPath}"; requests+=call
   intercept(request,requests) ?: when {
    call=="GET /api/v1/auth/session" -> json(request,JSONObject().put("authenticated",true).put("workspaceOwner",owner))
    call=="GET /api/v1/hermes/action-capabilities" -> json(request,JSONObject().put("conversation",true).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1).put("workspaceOwner",owner))
    call=="GET /api/v1/planner/snapshot" -> json(request,JSONObject().put("projects",JSONArray()).put("preparations",JSONArray()).put("actions",JSONArray()))
    call=="GET /api/v1/calendar/snapshot" -> json(request,JSONObject().put("calendars",JSONArray()).put("events",JSONArray()))
    call=="GET /api/v1/mail/page" -> json(request,JSONObject().put("messages",JSONArray()).put("briefing",JSONArray()).put("accounts",JSONArray()).put("total",0).put("nextCursor",JSONObject.NULL).put("today","2000-01-01"))
    call=="POST /api/v1/auth/logout" -> json(request,JSONObject())
    else -> Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(599).message("Unexpected").body("{\"error\":\"unexpected:$call\"}".toResponseBody("application/json".toMediaType())).build()
   }
  }.build()
  val store=ViewModelStore()
  val app=object:Application(){init{attachBaseContext(ctx as Context)};override fun getApplicationContext():Context=this; override fun getNoBackupFilesDir():File = dir }
  val deps=WorkspaceModelDependencies(storage={name,strict,existingKeyOnly->storage(name,strict,existingKeyOnly)},httpClient=client,registerConnectivity=false,clearCachedMailBodies={dir.listFiles()?.filter{it.name.startsWith("mail-")}?.forEach{it.delete()};Unit},mailCacheDir={dir})
  val model=onMain{ ViewModelProvider(store,object:ViewModelProvider.Factory{override fun <T:ViewModel> create(modelClass:Class<T>):T=modelClass.cast(WorkspaceModel(app,deps))!!})[WorkspaceModel::class.java] }
  return Fixture(dir,store,model,client,requests)
 }

 @Test fun encryptedMailCacheRoundTripsThroughProductionStorage(){
  val ownerA="a".repeat(64); val id="5".repeat(64)
  val marker="DISTINCTIVE-PLAINTEXT-MARKER-${UUID.randomUUID()}"
  val htmlPayload=JSONObject().put("hasHtml",true).put("html","<p>$marker-html</p>").toString()
  val bodyPayload=JSONObject().put("id",id).put("body","$marker-body").toString()
  val f=encryptedFixture(ownerA){request,_-> val path=request.url.encodedPath
   when(path){
    "/api/v1/mail/html/$id" -> jsonText(request,htmlPayload)
    "/api/v1/mail/message/$id" -> json(request,JSONObject(bodyPayload))
    else -> null
   }
  }
  try{
   waitUntil{!f.model.state.value.restoring && f.model.state.value.signedIn && f.model.hermes.ownerFence()?.owner==ownerA}
   val fenceA=f.model.hermes.ownerFence()!!
   runBlocking{ withTimeout(15000){ val h=f.model.mailHtml(id,fenceA); assertTrue(h.hasHtml); assertTrue(h.html!!.contains(marker)); val b=f.model.mailBody(id,fenceA); assertTrue(b.contains(marker)) } }
   val htmlName="mail-html-$ownerA-$id.enc"; val bodyName="mail-body-$ownerA-$id.enc"
   val htmlFile=File(f.dir,htmlName); val bodyFile=File(f.dir,bodyName)
   assertTrue("Encrypted HTML cache file expected", htmlFile.exists())
   assertTrue("Encrypted body cache file expected", bodyFile.exists())
   val markerBytes=marker.toByteArray(Charsets.UTF_8)
   fun containsMarker(file:File):Boolean { val bytes=file.readBytes(); val s=String(bytes,Charsets.ISO_8859_1); return s.contains(marker) || String(bytes,Charsets.UTF_8).contains(marker) }
   assertFalse("Physical HTML cache must not contain plaintext marker/raw JSON", containsMarker(htmlFile))
   assertFalse("Physical body cache must not contain plaintext marker/raw JSON", containsMarker(bodyFile))
   val htmlRaw=htmlFile.readBytes(); assertFalse("HTML cache should not be plaintext JSON", String(htmlRaw,Charsets.UTF_8).trimStart().startsWith("{") && String(htmlRaw,Charsets.UTF_8).contains(marker))
   val ctx=IsolatedDirContext(instrumentation.targetContext,f.dir)
   val decHtml=EncryptedSessionStorage(ctx,htmlName,strict=true).read()
   val decBody=EncryptedSessionStorage(ctx,bodyName,strict=true).read()
   assertNotNull("HTML cache must decrypt via production storage", decHtml)
   assertNotNull("Body cache must decrypt via production storage", decBody)
   val dh=JSONObject(decHtml!!); assertEquals(ownerA, dh.optString("owner")); assertTrue(dh.optString("html").contains(marker)); assertEquals(true, dh.optBoolean("hasHtml"))
   val db=JSONObject(decBody!!); assertEquals(ownerA, db.optString("owner")); assertTrue(db.optString("body").contains(marker))
   val leftover=f.dir.listFiles()?.filter{it.name.contains(".tmp") || (it.name.startsWith("mail-") && it.name.contains(marker))}.orEmpty()
   assertTrue("No leftover plaintext temp/new marker paths expected: $leftover", leftover.isEmpty())
   // Cache hits: no additional mail GETs on second actual model.
   onMain{ f.store.clear() }; f.client.dispatcher.executorService.shutdownNow(); f.client.connectionPool.evictAll()
   val requests2=java.util.concurrent.CopyOnWriteArrayList<String>()
   val client2=OkHttpClient.Builder().addInterceptor{chain->
    val request=chain.request(); val call="${request.method} ${request.url.encodedPath}"; requests2+=call
    when {
     call=="GET /api/v1/auth/session" -> json(request,JSONObject().put("authenticated",true).put("workspaceOwner",ownerA))
     call=="GET /api/v1/hermes/action-capabilities" -> json(request,JSONObject().put("conversation",true).put("conversationChatVersion",1).put("conversationDisplaySyncVersion",1).put("workspaceOwner",ownerA))
     call=="GET /api/v1/planner/snapshot" -> json(request,JSONObject().put("projects",JSONArray()).put("preparations",JSONArray()).put("actions",JSONArray()))
     call=="GET /api/v1/calendar/snapshot" -> json(request,JSONObject().put("calendars",JSONArray()).put("events",JSONArray()))
     call=="GET /api/v1/mail/page" -> json(request,JSONObject().put("messages",JSONArray()).put("briefing",JSONArray()).put("accounts",JSONArray()).put("total",0).put("nextCursor",JSONObject.NULL).put("today","2000-01-01"))
     call.startsWith("GET /api/v1/mail/") -> Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(599).message("Unexpected").body("{\"error\":\"cache-hit-expected:$call\"}".toResponseBody("application/json".toMediaType())).build()
     else -> Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(599).message("Unexpected").body("{\"error\":\"unexpected:$call\"}".toResponseBody("application/json".toMediaType())).build()
    }
   }.build()
   val store2=ViewModelStore()
   val app2=object:Application(){init{attachBaseContext(ctx as Context)};override fun getApplicationContext():Context=this; override fun getNoBackupFilesDir():File = f.dir }
   val deps2=WorkspaceModelDependencies(storage={name,strict,existingKeyOnly->EncryptedSessionStorage(ctx,name,strict,existingKeyOnly)},httpClient=client2,registerConnectivity=false,clearCachedMailBodies={f.dir.listFiles()?.filter{it.name.startsWith("mail-")}?.forEach{it.delete()};Unit},mailCacheDir={f.dir})
   val model2=onMain{ ViewModelProvider(store2,object:ViewModelProvider.Factory{override fun <T:ViewModel> create(modelClass:Class<T>):T=modelClass.cast(WorkspaceModel(app2,deps2))!!})[WorkspaceModel::class.java] }
   try{
    waitUntil{!model2.state.value.restoring && model2.state.value.signedIn && model2.hermes.ownerFence()?.owner==ownerA}
    val fence2=model2.hermes.ownerFence()!!
    runBlocking{ withTimeout(15000){ val h=model2.mailHtml(id,fence2); assertEquals("<p>$marker-html</p>",h.html); val b=model2.mailBody(id,fence2); assertEquals("$marker-body",b) } }
    assertEquals("Second model must not issue mail GETs for cached reads", 0, requests2.count{it=="GET /api/v1/mail/html/$id" || it=="GET /api/v1/mail/message/$id"})
   } finally { try{onMain{store2.clear()}}catch(_:Throwable){}; client2.dispatcher.executorService.shutdownNow(); client2.connectionPool.evictAll() }
  } finally { cleanup(f) }
 }
}
