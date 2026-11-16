package online.captnuu.dcc

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import okhttp3.HttpUrl.Companion.toHttpUrl
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import java.util.UUID
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.*
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.collect

private const val ORIGIN = "https://dcc.home.captnuu.online"
internal const val MAIL_MAX_DECODED_BYTES = 2 * 1024 * 1024
internal const val MAIL_MAX_WIRE_BYTES = MAIL_MAX_DECODED_BYTES * 6 + 4096 // bounded before parse; JSON string escaping worst case
internal const val MAIL_CACHE_AUTHORITY_FILE = "mail-read-owner.enc"
data class WorkspaceState(val restoring:Boolean=false,val restorePending:Boolean=false,val signedIn:Boolean=false,val busy:Boolean=false,val notice:String="Sign in to connect to your workspace.",val pending:List<String> = emptyList(),val snapshots:Map<String,String> = emptyMap(),val online:Boolean=false,val legacyDrafts:List<String> = emptyList(),val failedWrite:String?=null)
internal fun parseMailHtmlPayload(raw:String,wireCap:Int=MAIL_MAX_WIRE_BYTES):WorkspaceModel.MailHtmlResult {
    require(raw.toByteArray(Charsets.UTF_8).size<=wireCap){"Formatted message is too large to cache safely."}
    val result=JSONObject(raw)
    val hasHtml=result.opt("hasHtml")
    val html=result.opt("html")
    require(hasHtml is Boolean){"Invalid formatted message response."}
    val htmlValue=when{
        html==JSONObject.NULL || html==null -> null
        html is String -> html
        else -> throw IllegalArgumentException("Invalid formatted message response.")
    }
    if(htmlValue!=null){
        require((hasHtml as Boolean) && htmlValue.isNotBlank() && htmlValue.toByteArray(Charsets.UTF_8).size<=MAIL_MAX_DECODED_BYTES){"Formatted message exceeds the safe size limit."}
    } else {
        require(!(hasHtml as Boolean)){"Invalid formatted message response."}
    }
    return WorkspaceModel.MailHtmlResult(htmlValue,hasHtml as Boolean)
}

/** Terminal I/O injection for isolated native hosts; no alternate sync logic. */
internal class WorkspaceModelDependencies(
    val storage:(String,Boolean,Boolean)->SessionStorage,
    val httpClient:OkHttpClient?,
    val registerConnectivity:Boolean,
    val clearCachedMailBodies:()->Unit,
    val displaySyncTiming:HermesDisplaySyncTiming=HermesDisplaySyncTiming(),
    val mailCacheDir:(()->java.io.File)?=null,
    val recoveryTiming:HermesChatRecoveryTiming=HermesChatRecoveryTiming()
)
private fun workspaceModelDependencies(application:Application)=WorkspaceModelDependencies(
    storage={name,strict,existingKeyOnly->EncryptedSessionStorage(application,name,strict,existingKeyOnly)},
    httpClient=null,
    registerConnectivity=true,
    clearCachedMailBodies={application.noBackupFilesDir.listFiles()?.filter{Regex("mail-(body|html)-([a-f0-9]{64}-[a-f0-9]{64}|[a-f0-9]{64})\\.enc").matches(it.name)}?.forEach{it.delete()};Unit},
    mailCacheDir={application.noBackupFilesDir}
)

class WorkspaceModel internal constructor(application:Application,private val dependencies:WorkspaceModelDependencies):AndroidViewModel(application) {
    constructor(application:Application):this(application,workspaceModelDependencies(application))
    private fun stored(name:String,strict:Boolean=false,existingKeyOnly:Boolean=false)=dependencies.storage(name,strict,existingKeyOnly)
    private val mutable = MutableStateFlow(WorkspaceState(restoring=true,busy=true,notice="Restoring session…"))
    val state = mutable.asStateFlow()
    private val mailAuthority=stored(MAIL_CACHE_AUTHORITY_FILE)
    private fun persistMailReadAuthority(owner:String){ if(Regex("^[a-f0-9]{64}$").matches(owner)) runCatching{mailAuthority.write(JSONObject().put("owner",owner).toString())} }
    private fun readMailReadAuthority():String? = runCatching{ val raw=mailAuthority.read()?:return null; JSONObject(raw).optString("owner").takeIf{Regex("^[a-f0-9]{64}$").matches(it)} }.getOrNull()
    private fun clearMailReadAuthority(){ runCatching{mailAuthority.clear()} }
    private fun clearWorkspaceCache(){cache.clear();dependencies.clearCachedMailBodies();clearMailReadAuthority()}
    private val queue=MutationQueue(stored("outbox.enc",strict=true))
    private val refreshLock=Mutex()
    private val writes=linkedMapOf<String,JSONObject>()
    private var receiptOwner:String?=null
    private val activeWrites=mutableSetOf<String>()
    private var foreground=false
    private var lastRead=0L
    private var lastMailRead=0L
    private val readGenerations=mutableMapOf<String,Long>()
    private val workspaceWritesPath="/api/v1/workspace/writes"
    private fun connected():Boolean {
        val manager=connectivity?:return mutable.value.signedIn
        return manager.getNetworkCapabilities(manager.activeNetwork)?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)==true
    }
    fun setWorkspaceForeground(visible:Boolean){
        foreground=visible
        if(visible&&connected()&&!mutable.value.restoring)refresh()
    }
    internal val manualTaskLock=Mutex()
    private var displaySyncJob:Job?=null
    private var legacyTaskReceipt:String?=null
    private var displaySyncClaim:Triple<HermesOwnerFence,String,Long>?=null
    private val connectivity=if(dependencies.registerConnectivity)application.getSystemService(android.net.ConnectivityManager::class.java) else null
    private val networkCallback=object:android.net.ConnectivityManager.NetworkCallback(){
        override fun onAvailable(network:android.net.Network){viewModelScope.launch{updateConnectivity();if(!mutable.value.restoring&&(mutable.value.signedIn||mutable.value.restorePending))refresh()}}
        override fun onLost(network:android.net.Network){viewModelScope.launch{updateConnectivity()}}
    }
    private fun updateConnectivity(){
        val online=connected()&&mutable.value.signedIn
        mutable.value=mutable.value.copy(online=online,pending=if(online)writes.values.filterNot{it.optBoolean("unconfirmed")}.map(JSONObject::toString) else emptyList())
    }
    private val cache=stored("workspace.enc")
    private val sessions=PersistentSessionJar(stored("session.enc"),ORIGIN.toHttpUrl())
    private val client = (dependencies.httpClient?.newBuilder()?:OkHttpClient.Builder()).callTimeout(20,TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).cookieJar(sessions).build()
    val hermes:HermesConversationController=HermesConversationController(viewModelScope,{owner->stored("hermes-$owner.enc",strict=true)},{body->api("/api/v1/hermes/conversation",body)},recoveryStorageFor={owner->stored("hermes-chat-$owner-separate-v1.enc",strict=true,existingKeyOnly=true)},chatStorageFor={owner->stored("hermes-chat-$owner-v1.enc",strict=true)},legacyRecoveryStorageFor={owner->stored("hermes-$owner-separate-v1.enc",strict=true,existingKeyOnly=true)},onDisplaySync=::scheduleDisplaySync,recoveryTiming=dependencies.recoveryTiming)
    private suspend fun bindHermes(session:JSONObject){
        val owner=session.optString("workspaceOwner")
        if(Regex("^[a-f0-9]{64}$").matches(owner)){
            if(receiptOwner!=owner){
                if(readMailReadAuthority()?.let{it!=owner}==true){
                    clearWorkspaceCache()
                    mutable.value=mutable.value.copy(snapshots=emptyMap())
                }
                hermes.bind(owner)
                writes.clear()
                legacyTaskReceipt=null
                receiptOwner=owner
                val restored=runCatching {
                    stored("workspace-receipts-$owner.enc").read()?.let{JSONArray(it).objects()}
                }.getOrNull()
                for(entry in restored.orEmpty()){
                    writes[entry.getString("id")]=entry
                }
            }else hermes.bind(owner)
            persistMailReadAuthority(owner)
        }else{hermes.unbind();receiptOwner=null;writes.clear();clearMailReadAuthority()}
        updateConnectivity()
        try{hermes.chatCapabilities(api("/api/v1/hermes/action-capabilities"))}catch(_:Exception){hermes.availability(false)}
    }
    init {
      viewModelScope.launch{hermes.state.collect{
          displaySyncClaim?.let{claim->if(!displaySyncCurrent(claim)){
              displaySyncJob?.cancel();displaySyncJob=null;displaySyncClaim=null
              hermes.interruptDisplaySync(claim.first.owner,claim.second)
          }}
          if(it.displaySyncVersion==0&&it.receipt!=null){
              val fence=hermes.ownerFence()
              val receipt=runCatching { JSONObject(it.receipt) }.getOrNull()
              val id=receipt?.optString("key")
              val targets=receipt?.optJSONArray("targets").objects()
              if(fence!=null&&!id.isNullOrBlank()&&id!=legacyTaskReceipt&&targets.any{target->
                  target.optString("kind")=="task"&&target.optString("state")=="applied"
              }){
                  legacyTaskReceipt=id
                  viewModelScope.launch {
                      try{refreshDataset("task",fence)}
                      catch(error:CancellationException){throw error}
                      catch(_:Exception){ /* Foreground reads will catch up. */ }
                  }
              }
          }
      }}
      connectivity?.registerDefaultNetworkCallback(networkCallback)
      if(dependencies.registerConnectivity)viewModelScope.launch {
        while(true){
            delay(2000)
            if(mutable.value.signedIn&&connected()){
                checkWorkspaceWrites()
                if(foreground&&System.currentTimeMillis()-lastRead>=15000)refresh()
            }
        }
      }
      viewModelScope.launch {
        try { withContext(Dispatchers.IO){sessions.restore()
            if(sessions.hasSession()){mutable.value=mutable.value.copy(legacyDrafts=runCatching{queue.list().map{it.toString()}}.getOrDefault(emptyList()))};if(sessions.hasSession())cache.read()?.let {raw->
                val data=JSONObject(raw);mutable.value=mutable.value.copy(snapshots=data.keys().asSequence().associateWith{data.getString(it)})
            } else clearWorkspaceCache()
        };restoreSession() }
        catch(_:Exception){
            val retained=withContext(Dispatchers.IO){sessions.hasSession()}
            mutable.value=mutable.value.copy(restorePending=retained&&!mutable.value.signedIn,notice=if(retained)"Connection unavailable. Saved sign-in retained; retry to load data." else "Session unavailable. Please sign in again.")
        }
        finally {mutable.value=mutable.value.copy(restoring=false,busy=false)}
    } }
    override fun onCleared(){displaySyncJob?.cancel();hermes.unbind();connectivity?.unregisterNetworkCallback(networkCallback);super.onCleared()}
    private suspend fun restoreSession() {
        if(!withContext(Dispatchers.IO){sessions.hasSession()}) {hermes.unbind();mutable.value=WorkspaceState();return}
        val result=JSONObject(request("/api/v1/auth/session"))
        if(!result.getBoolean("authenticated")) {
            hermes.unbind()
            withContext(Dispatchers.IO){sessions.clear();clearWorkspaceCache()}
            mutable.value=WorkspaceState(notice="Session expired. Please sign in again.");return
        }
        mutable.value=mutable.value.copy(signedIn=true,restoring=false,restorePending=false,notice="Signed in")
        bindHermes(result)
        refreshAll()
    }
    internal suspend fun request(path:String,body:JSONObject?=null,ownerFence:HermesOwnerFence?=null,boundedRead:Boolean=false,maxBodyBytes:Int?=null):String {
      val workspaceWrite=path.startsWith(workspaceWritesPath)
      val scoped=path=="/api/v1/hermes/conversation"||ownerFence!=null
      val fence=ownerFence?:if(scoped)hermes.ownerFence()?.takeIf{it.owner==body?.optString("workspaceOwner")} else null
      return withContext(Dispatchers.IO) {
        val builder=Request.Builder().url(ORIGIN+path).header("Origin",ORIGIN)
        if(workspaceWrite&&fence!=null)builder.header("X-Dcc-Workspace-Owner",fence.owner)
        if(body!=null) builder.post(body.toString().toRequestBody("application/json".toMediaType()))
        val conversation=path=="/api/v1/hermes/conversation"
        if(conversation&&hermes.state.value.displaySyncVersion==1)builder.header("X-Dcc-Display-Sync","1")
        val callClient=if(workspaceWrite)client.newBuilder().retryOnConnectionFailure(false).build() else if(boundedRead)hermesConversationClient(client,"read") else if(conversation)hermesConversationClient(client,body?.optString("op")) else if(path.endsWith("/extract")||path.endsWith("/session")||path.endsWith("/material"))client.newBuilder().callTimeout(180,TimeUnit.SECONDS).build() else client
        val response=if(conversation||boundedRead||workspaceWrite)awaitHermesHttp(callClient,builder.build(),maxBytes=maxBodyBytes) else callClient.newCall(builder.build()).execute().use{HermesHttpResult(it.code,if(it.isSuccessful)it.body?.string()?:"{}" else "{}")}
            if(response.code==401) {
                withContext(Dispatchers.Main.immediate){
                    // A delayed response from a prior Hermes/account generation
                    // must not erase a subsequently restored or signed-in session.
                    if(!scoped||fence!=null&&hermes.isCurrent(fence)){
                        hermes.unbind();sessions.clear();clearWorkspaceCache()
                        mutable.value=WorkspaceState(busy=true,notice="Sign-in required [AUTH]. Saved requests were not resent.")
                    }
                }
                if(conversation)throw HermesHttpFailure(auth=true,status=response.code)
                throw IllegalStateException("Sign-in required. Check credentials or sign in again.")
            }
            if(conversation&&response.code !in 200..299)throw HermesHttpFailure(status=response.code)
            if(workspaceWrite&&response.code in listOf(400,404,409))return@withContext JSONObject().put("state",if(response.code==404)"missing" else "failed").put("code",response.code).toString()
            if(response.code==409) throw IllegalStateException("Changed on another device. Refresh before retrying.")
            check(response.code in 200..299) { "Request failed (HTTP ${response.code})." }
            response.body
      }
    }
    suspend fun hermesTaskReadback(fence:HermesOwnerFence):ManualTaskReadback {
        check(hermes.isCurrent(fence)){"Workspace changed"}
        return parseManualTaskReadback(JSONObject(request("/api/v1/planner/manual-tasks",ownerFence=fence,boundedRead=true)))
    }
    private fun displaySyncCurrent(claim:Triple<HermesOwnerFence,String,Long>) =
        mutable.value.signedIn&&hermes.isCurrent(claim.first)&&hermes.state.value.storageReady&&hermes.state.value.submitted?.turnKey==claim.second&&System.currentTimeMillis()<claim.third

    private fun scheduleDisplaySync(reply:JSONObject,fence:HermesOwnerFence){
        val facts=reply.optJSONObject("displaySync")?:return
        if(!validHermesDisplaySync(facts))return
        val claim=Triple(fence,reply.getString("turnKey"),reply.getLong("expiresAt"))
        if(!displaySyncCurrent(claim))return
        displaySyncJob?.cancel();displaySyncClaim=claim
        displaySyncJob=viewModelScope.launch{
            fun current()=displaySyncCurrent(claim)
            var tasks="";var calendar=""
            fun feedback(){if(current())hermes.displaySyncFeedback(fence,claim.second,listOf(tasks,calendar).filter{it.isNotEmpty()}.joinToString(" "))}
            try{withTimeout(dependencies.displaySyncTiming.budgetMillis){
                val taskFacts=facts.getJSONArray("tasks").objects()
                if(taskFacts.isNotEmpty()){
                    tasks=try{manualTaskLock.withLock{
                        val preferences=getApplication<Application>().getSharedPreferences("dcc-local-tasks",0)
                        val before=preferences.getString("tasks","[]")?:"[]";val base=preferences.getString("sync-base","[]")?:"[]"
                        val revision=preferences.getLong("sync-base-version",0)
                        val remote=withTimeout(dependencies.displaySyncTiming.readMillis){hermesTaskReadback(fence)}
                        if(!current())throw CancellationException()
                        cacheSnapshot("task",JSONObject().put("version",remote.version).put("data",JSONObject().put("tasks",JSONArray(remote.tasks))).toString())
                        if(before!=preferences.getString("tasks","[]")||base!=preferences.getString("sync-base","[]")||revision!=preferences.getLong("sync-base-version",0))"Tasks saved — newer phone edits retained; visibility not confirmed."
                        else{
                            val merged=mergeManualTaskReadback(base,before,remote,maxOf(revision,taskFacts.maxOf{it.getLong("version")}))
                            if(merged==null)"Tasks saved — readback is not current yet."
                            else if(merged.conflicts.isNotEmpty())"Tasks saved — local conflicts retained."
                            else{
                                check(preferences.edit().putString("tasks",merged.tasks).putString("sync-base",merged.base).putLong("sync-base-version",merged.version).commit())
                                val local=parseManualTaskReadback(JSONObject().put("version",merged.version).put("data",JSONObject().put("tasks",JSONArray(merged.tasks))))
                                if(hermesTasksPresent(taskFacts,remote)&&hermesTasksPresent(taskFacts,local))"Tasks synced — visible on this phone." else "Tasks refreshed — requested changes not all visible."
                            }
                        }
                    }}catch(error:CancellationException){
                        if(error !is TimeoutCancellationException)throw error
                        kotlinx.coroutines.currentCoroutineContext().ensureActive()
                        "Tasks saved — refresh timed out; local work retained."
                    }catch(_:Exception){"Tasks saved — refresh unavailable; local work retained."}
                }
                val calendarFacts=facts.getJSONArray("calendar").objects()
                if(calendarFacts.isNotEmpty()){
                    calendar="Calendar saved — syncing…";feedback()
                    calendar=when(readHermesCalendar(calendarFacts,dependencies.displaySyncTiming,::current,{
                        JSONObject(request("/api/v1/calendar/snapshot",ownerFence=fence,boundedRead=true))
                    }){snapshot->
                        if(!current())throw CancellationException()
                        val next=mutable.value.snapshots+("calendar" to snapshot.toString())
                        // Publish/cache as one non-suspending owner-fenced step;
                        // a logout/new owner cannot interleave a late cache write.
                        cache.write(JSONObject(next).toString())
                        if(current())mutable.value=mutable.value.copy(snapshots=mutable.value.snapshots+("calendar" to snapshot.toString()))
                    }){
                        HermesCalendarSyncResult.CONFIRMED->"Calendar synced — visible in the server snapshot."
                        HermesCalendarSyncResult.PENDING->"Calendar saved — not yet visible; automatic checks finished."
                        HermesCalendarSyncResult.ERROR->"Calendar saved — snapshot refresh unavailable; visibility not confirmed."
                    }
                }
                feedback()
            }}catch(_:TimeoutCancellationException){if(current())hermes.displaySyncFeedback(fence,claim.second,"Saved — refresh budget finished; visibility not fully confirmed.")}
            catch(error:CancellationException){throw error}
            catch(_:Exception){if(current())hermes.displaySyncFeedback(fence,claim.second,"Saved — refresh unavailable; local work retained; visibility not confirmed.")}
        }
    }
    suspend fun mailSettingsApi(path:String,body:JSONObject?,fence:HermesOwnerFence):JSONObject {
        require(path in setOf("/api/v1/mail/preferences","/api/v1/mail/refresh"))
        check(hermes.isCurrent(fence)){"Workspace changed"}
        val result=JSONObject(request(path,body,ownerFence=fence))
        check(hermes.isCurrent(fence)){"Workspace changed"}
        return result
    }
    private fun operation(block:suspend ()->Unit) {
        if(mutable.value.busy)return
        mutable.value=mutable.value.copy(busy=true)
        viewModelScope.launch {
            try { block() } catch(e:Exception) {
                mutable.value=mutable.value.copy(notice=e.message?:"Connection unavailable")
            } finally { mutable.value=mutable.value.copy(busy=false) }
        }
    }
    fun signIn(username:String,password:String)=operation {
        val session=JSONObject(request("/api/v1/auth/login",JSONObject().put("username",username).put("password",password)))
        mutable.value=mutable.value.copy(signedIn=true,restorePending=false,notice="Signed in")
        bindHermes(session)
        refreshAll()
    }
    private fun publishWrites(owner:String){
        if(receiptOwner!=owner)return
        val receipts=writes.values.map{entry->JSONObject(entry.toString()).apply{remove("body")}}
        runCatching{stored("workspace-receipts-$owner.enc").write(JSONArray(receipts).toString())}
        updateConnectivity()
    }
    fun discardLegacyDraft(key:String){
        viewModelScope.launch {
            withContext(Dispatchers.IO){queue.remove(key)}
            mutable.value=mutable.value.copy(legacyDrafts=withContext(Dispatchers.IO){queue.list().map(JSONObject::toString)})
        }
    }
    private fun submitWorkspaceWrite(path:String,body:JSONObject){
        check(mutable.value.signedIn&&connected()){ "Connect to make changes" }
        val fence=hermes.ownerFence()?:error("Sign in to make changes")
        check(receiptOwner==fence.owner)
        val kind=when(path){
            "/api/v1/planner/entity"->"planner"
            "/api/v1/calendar/changes"->"calendar"
            "/api/v1/planner/manual-tasks"->"task"
            else->error("Unsupported workspace change")
        }
        val entity=when(kind){
            "planner"->body.getJSONObject("data").getString("id")
            "calendar"->body.optString("eventId",body.getString("id"))
            else->body.getJSONObject("task").getString("id")
        }
        val key="$kind:$entity"
        check(writes.values.none{it.optString("key")==key}){"This change is already saving."}
        val id=if(kind=="calendar")body.getString("id") else UUID.randomUUID().toString()
        val entry=JSONObject().put("id",id).put("key",key).put("path",path).put("kind",kind)
            .put("started",System.currentTimeMillis()).put("body",JSONObject(body.toString()))
        writes[id]=entry
        mutable.value=mutable.value.copy(failedWrite=null,notice="Saving…")
        publishWrites(fence.owner)
        activeWrites.add(id)
        val operation=JSONObject().put("id",id).put("kind",kind).put("payload",body)
        viewModelScope.launch {
            try{
                val receipt=JSONObject(request(workspaceWritesPath,operation,ownerFence=fence))
                finishWorkspaceWrite(fence,entry,receipt)
            }catch(e:CancellationException){throw e}
            catch(_:Exception){if(hermes.isCurrent(fence))mutable.value=mutable.value.copy(notice="Save not confirmed yet. Checking automatically.")}
            finally{activeWrites.remove(id)}
        }
    }
    private fun checkWorkspaceWrites(){
        val fence=hermes.ownerFence()?:return
        if(receiptOwner!=fence.owner)return
        writes.toList().forEach { (id,entry) ->
            if(!activeWrites.add(id))return@forEach
            viewModelScope.launch {
                try{
                    val status=JSONObject(request("$workspaceWritesPath/$id",ownerFence=fence))
                    finishWorkspaceWrite(fence,entry,status)
                }catch(e:CancellationException){throw e}
                catch(_:Exception){ /* The next connected read checks the same receipt. */ }
                finally{activeWrites.remove(id)}
            }
        }
    }
    private suspend fun finishWorkspaceWrite(fence:HermesOwnerFence,entry:JSONObject,receipt:JSONObject){
        val id=entry.getString("id")
        if(!hermes.isCurrent(fence)||receiptOwner!=fence.owner||writes[id]!==entry)return
        val status=receipt.optString("state")
        if(status=="saving"||status=="unconfirmed"){
            if(status=="unconfirmed"){
                if(!entry.optBoolean("unconfirmed")){
                    entry.put("unconfirmed",true)
                    publishWrites(fence.owner)
                }
                mutable.value=mutable.value.copy(notice="Save not confirmed yet. Checking automatically.")
            }
            return
        }
        if(status=="missing"&&System.currentTimeMillis()-entry.getLong("started")<60000)return
        if(status=="saved"){
            val dataset=entry.getString("kind")
            applyWriteReceipt(dataset,receipt)
            mutable.value=mutable.value.copy(notice="Saved")
            if(!foreground&&dependencies.registerConnectivity)notifyWorkspaceSaved(getApplication(),id)
            viewModelScope.launch {runCatching{refreshDataset(dataset,fence)}}
        }else{
            val label=when(entry.getString("kind")){"task"->"task";"calendar"->"event";else->"change"}
            mutable.value=mutable.value.copy(notice=if(receipt.optInt("code")==409)"Changed elsewhere. Review and try again." else "Couldn’t sync this $label.",failedWrite=entry.toString())
        }
        writes.remove(id)
        publishWrites(fence.owner)
    }
    private fun applyWriteReceipt(dataset:String,receipt:JSONObject){
        val snapshot=mutable.value.snapshots[dataset]?.let(::JSONObject)?:JSONObject()
        when(dataset){
            "task"->{
                val version=receipt.optInt("version")
                val saved=receipt.optJSONObject("task")?:return
                if(version<=snapshot.optInt("version"))return
                val data=snapshot.optJSONObject("data")?:JSONObject()
                val tasks=data.optJSONArray("tasks").objects().filter{it.optString("id")!=saved.optString("id")}+saved
                snapshot.put("version",version).put("data",data.put("tasks",JSONArray(tasks)))
            }
            "planner"->{
                val saved=receipt.optJSONObject("entry")?:return
                val field=when(saved.optString("kind")){"project"->"projects";"action"->"actions";"preparation"->"preparations";else->return}
                val id=saved.getJSONObject("data").getString("id")
                val current=snapshot.optJSONArray(field).objects()
                if(current.any{it.getJSONObject("data").optString("id")==id&&it.optInt("version")>=saved.optInt("version")})return
                snapshot.put(field,JSONArray(current.filter{it.getJSONObject("data").optString("id")!=id}+saved))
            }
            "calendar"->{
                val event=receipt.optJSONObject("event")
                val id=receipt.optString("previousEventId")
                val events=snapshot.optJSONArray("events").objects().filter{it.optString("id")!=id&&it.optString("id")!=event?.optString("id")}
                snapshot.put("events",JSONArray(events+listOfNotNull(event)))
            }
        }
        readGenerations[dataset]=(readGenerations[dataset]?:0L)+1
        cacheSnapshot(dataset,snapshot.toString())
    }
    private fun cacheSnapshot(name:String,raw:String){
        if(name=="task"){
            val old=mutable.value.snapshots[name]?.let{JSONObject(it).optLong("version")}?:-1
            if(JSONObject(raw).optLong("version")<old)return
        }
        val next=mutable.value.snapshots+(name to raw)
        mutable.value=mutable.value.copy(snapshots=next)
        runCatching{cache.write(JSONObject(next).toString())}
    }
    private suspend fun refreshDataset(name:String,fence:HermesOwnerFence?=hermes.ownerFence()){
        val path=when(name){"task"->"/api/v1/planner/manual-tasks";"mail"->"/api/v1/mail/page";else->"/api/v1/$name/snapshot"}
        val generation=(readGenerations[name]?:0L)+1
        readGenerations[name]=generation
        val raw=request(path,ownerFence=fence)
        if(name=="task")parseManualTaskReadback(JSONObject(raw))
        if(readGenerations[name]==generation&&(fence==null||hermes.isCurrent(fence)))cacheSnapshot(name,raw)
    }
    suspend fun mutate(path:String,body:JSONObject){
        submitWorkspaceWrite(path,body)
    }
    fun saveManualTask(expected:JSONObject?,task:JSONObject){
        submitWorkspaceWrite("/api/v1/planner/manual-tasks",JSONObject().put("expected",expected?:JSONObject.NULL).put("task",task))
    }
    private suspend fun refreshAll()=refreshLock.withLock {
        lastRead=System.currentTimeMillis()
        updateConnectivity()
        val fence=hermes.ownerFence()
        val names=mutableListOf("task","planner","calendar")
        if(lastRead-lastMailRead>=60000){names.add("mail");lastMailRead=lastRead}
        for(name in names){
            try{refreshDataset(name,fence)}
            catch(e:CancellationException){throw e}
            catch(_:Exception){if(!mutable.value.signedIn)break}
        }
        checkWorkspaceWrites()
    }
    suspend fun api(path:String,body:JSONObject?=null):JSONObject {
        require(path.startsWith("/api/v1/"))
        return JSONObject(request(path,body))
    }
    fun loadMoreMail(query:String?=null,account:String="all",important:Boolean=false)=operation {
        val previous=mutable.value.snapshots["mail"]?.let{JSONObject(it)}?:JSONObject()
        val url=(ORIGIN+"/api/v1/mail/page").toHttpUrl().newBuilder()
        if(query!=null){url.addQueryParameter("q",query).addQueryParameter("account",account).addQueryParameter("important",important.toString())}
        else {val cursor=previous.optString("nextCursor","");if(cursor.isBlank())return@operation;url.addQueryParameter("cursor",cursor).addQueryParameter("q",previous.optString("query","")).addQueryParameter("account",previous.optString("accountFilter","all")).addQueryParameter("important",previous.optString("importantFilter","false"))}
        val path=url.build().let{it.encodedPath+"?"+it.encodedQuery}
        val page=api(path)
        if(query==null)page.put("messages",JSONArray((previous.optJSONArray("messages").objects()+page.optJSONArray("messages").objects()).distinctBy{it.getJSONObject("data").getString("id")}))
        page.put("query",query?:previous.optString("query","")).put("accountFilter",if(query!=null)account else previous.optString("accountFilter","all")).put("importantFilter",if(query!=null)important.toString() else previous.optString("importantFilter","false"))
        val next=mutable.value.snapshots+("mail" to page.toString());mutable.value=mutable.value.copy(snapshots=next,notice="");withContext(Dispatchers.IO){cache.write(JSONObject(next).toString())}
    }
    private val mailCacheLock=Mutex()
    private fun mailFenceCurrent(fence:HermesOwnerFence?)=fence!=null && mutable.value.signedIn && hermes.isCurrent(fence)
    private fun mailOwnerScopedName(kind:String,owner:String,id:String)="mail-$kind-$owner-$id.enc"
    private fun mailLegacyName(kind:String,id:String)="mail-$kind-$id.enc"
    private fun readOwnerScopedMail(kind:String,owner:String,id:String):String? = try{stored(mailOwnerScopedName(kind,owner,id)).read()}catch(_:Exception){null}
    private fun mailCacheDirectory()=dependencies.mailCacheDir?.invoke() ?: getApplication<Application>().noBackupFilesDir
    private fun hasLegacyMail(kind:String,id:String):Boolean = mailCacheDirectory().listFiles()?.any{it.name==mailLegacyName(kind,id)}==true
    internal fun mailCachedReadAuthorized(owner:String?):Boolean {
        if(owner==null || !Regex("^[a-f0-9]{64}$").matches(owner)) return false
        if(!sessions.hasSession()) return false
        val bound=hermes.ownerFence()?.owner
        if(bound!=null) return bound==owner
        // Offline recreation: previously authorized owner metadata, no fabricated live Hermes fence.
        return readMailReadAuthority()==owner
    }
    private fun staleMailFence(fence:HermesOwnerFence?):Boolean = fence!=null && !hermes.isCurrent(fence)
    private fun mailLiveFenceCurrent(fence:HermesOwnerFence?):Boolean = fence!=null && mutable.value.signedIn && hermes.isCurrent(fence)
    private data class MailCacheWrite(val fence:HermesOwnerFence,val id:String,val kind:String,val encoded:String,val utf8Bytes:Int,val maxCount:Int,val budgetBytes:Long)
    private val mailEncryptedOverheadBytes=64L
    private suspend fun commitMailCache(write:MailCacheWrite){
        if(!mailLiveFenceCurrent(write.fence)) return
        mailCacheLock.withLock{
            if(!mailLiveFenceCurrent(write.fence)) return
            val dir=mailCacheDirectory()
            val name=mailOwnerScopedName(write.kind,write.fence.owner,write.id)
            val pattern=Regex("mail-${Regex.escape(write.kind)}-${Regex.escape(write.fence.owner)}-[a-f0-9]{64}\\.enc")
            val files=dir.listFiles()?.filter{pattern.matches(it.name)}?.sortedBy{it.lastModified()}.orEmpty()
            var total=files.filter{it.name!=name}.sumOf{it.length()}
            val estimated=write.utf8Bytes.toLong()+mailEncryptedOverheadBytes
            if(estimated>write.budgetBytes){return} // oversize valid body can render without cache
            val keep=files.filter{it.name!=name}.toMutableList()
            while(keep.size>=write.maxCount-1 || total+estimated>write.budgetBytes){
                val oldest=keep.removeFirstOrNull()?:break
                if(!mailLiveFenceCurrent(write.fence)) return
                total-=oldest.length(); runCatching{oldest.delete()} // metadata prune only; no body read
            }
            if(!mailLiveFenceCurrent(write.fence)) return
            // Final record written through protected SessionStorage (encrypted + atomic per storage impl).
            // Never write plaintext JSON or rename ciphertext across filenames (AAD mismatch).
            stored(name).write(write.encoded)
            // No filename-only post-write delete: stale cleanup must not erase a newer same-owner write.
        }
    }
    private fun authorizedCacheOwner(explicitFence:HermesOwnerFence?):String? {
        if(explicitFence!=null) return if(hermes.isCurrent(explicitFence)) explicitFence.owner else null
        val bound=hermes.ownerFence()?.owner
        if(bound!=null) return bound
        if(!sessions.hasSession()) return null
        return readMailReadAuthority()
    }
    suspend fun mailBody(id:String):String=mailBody(id,hermes.ownerFence())
    internal suspend fun mailBody(id:String,ownerFence:HermesOwnerFence?):String=withContext(Dispatchers.IO){
        require(Regex("^[a-f0-9]{64}$").matches(id)){"Invalid message ID"}
        if(ownerFence!=null && !hermes.isCurrent(ownerFence)) throw IllegalStateException("Workspace changed")
        val cacheOwner=authorizedCacheOwner(ownerFence)
        if(cacheOwner!=null && mailCachedReadAuthorized(cacheOwner)){
            val cached=readOwnerScopedMail("body",cacheOwner,id)
            if(cached!=null){
                val parsed=runCatching{JSONObject(cached)}.getOrNull()
                val ok=parsed!=null && parsed.optString("owner")==cacheOwner && parsed.opt("body") is String
                if(ok && mailCachedReadAuthorized(cacheOwner) && (ownerFence==null || hermes.isCurrent(ownerFence))) {
                    return@withContext parsed!!.getString("body")
                }
            }
        }
        if(hasLegacyMail("body",id)){
            // Preserve untouched legacy bytes; do not attribute/guess owner.
            val probeOwner=cacheOwner ?: readMailReadAuthority() ?: hermes.ownerFence()?.owner
            if(probeOwner==null || !mailCachedReadAuthorized(probeOwner) || readOwnerScopedMail("body",probeOwner,id)==null)
                throw IllegalStateException("Message cache is unavailable for this account.")
        }
        val fence=ownerFence?.takeIf{mailLiveFenceCurrent(it)} ?: hermes.ownerFence()?.takeIf{mailLiveFenceCurrent(it)} ?: throw IllegalStateException("Sign in to load messages.")
        val raw=request("/api/v1/mail/message/$id",ownerFence=fence,boundedRead=true,maxBodyBytes=MAIL_MAX_WIRE_BYTES)
        if(!mailLiveFenceCurrent(fence)) throw IllegalStateException("Workspace changed")
        val body=JSONObject(raw).getString("body")
        val encoded=JSONObject().put("owner",fence.owner).put("body",body).toString()
        val utf8=encoded.toByteArray(Charsets.UTF_8).size
        if(body.toByteArray(Charsets.UTF_8).size<=MAIL_MAX_DECODED_BYTES && utf8<=MAIL_MAX_WIRE_BYTES){
            runCatching{commitMailCache(MailCacheWrite(fence,id,"body",encoded,utf8,20,1_500_000))}
        }
        body
    }
    internal data class MailHtmlResult(val html:String?,val hasHtml:Boolean)
    private fun parseMailHtmlResult(raw:String,wireCap:Int=MAIL_MAX_WIRE_BYTES):MailHtmlResult = parseMailHtmlPayload(raw,wireCap)
    internal suspend fun mailHtml(id:String,ownerFence:HermesOwnerFence?=hermes.ownerFence()):MailHtmlResult=withContext(Dispatchers.IO){
        require(Regex("^[a-f0-9]{64}$").matches(id)){"Invalid message ID"}
        if(ownerFence!=null && !hermes.isCurrent(ownerFence)) throw IllegalStateException("Workspace changed")
        val cacheOwner=authorizedCacheOwner(ownerFence)
        if(cacheOwner!=null && mailCachedReadAuthorized(cacheOwner)){
            val cached=readOwnerScopedMail("html",cacheOwner,id)
            if(cached!=null){
                val ownerOk=runCatching{JSONObject(cached).optString("owner")==cacheOwner}.getOrDefault(false)
                val parsed=if(ownerOk) runCatching{parseMailHtmlResult(cached)}.getOrNull() else null
                if(parsed!=null && mailCachedReadAuthorized(cacheOwner) && (ownerFence==null || hermes.isCurrent(ownerFence))) {
                    return@withContext parsed
                }
            }
        }
        if(hasLegacyMail("html",id)){
            val probeOwner=cacheOwner ?: readMailReadAuthority() ?: hermes.ownerFence()?.owner
            if(probeOwner==null || !mailCachedReadAuthorized(probeOwner) || readOwnerScopedMail("html",probeOwner,id)==null)
                throw IllegalStateException("Formatted message cache is unavailable for this account.")
        }
        val fence=ownerFence?.takeIf{mailLiveFenceCurrent(it)} ?: hermes.ownerFence()?.takeIf{mailLiveFenceCurrent(it)} ?: throw IllegalStateException("Sign in to load formatted messages.")
        val raw=request("/api/v1/mail/html/$id",ownerFence=fence,boundedRead=true,maxBodyBytes=MAIL_MAX_WIRE_BYTES)
        if(!mailLiveFenceCurrent(fence)) throw IllegalStateException("Workspace changed")
        val value=parseMailHtmlResult(raw)
        val encoded=JSONObject().put("owner",fence.owner).put("html",value.html?:JSONObject.NULL).put("hasHtml",value.hasHtml).toString()
        val utf8=encoded.toByteArray(Charsets.UTF_8).size
        if((value.html==null || value.html.toByteArray(Charsets.UTF_8).size<=MAIL_MAX_DECODED_BYTES) && utf8<=MAIL_MAX_WIRE_BYTES){
            runCatching{commitMailCache(MailCacheWrite(fence,id,"html",encoded,utf8,20,1_500_000))}
        }
        value
    }
    suspend fun attachment(id:String,part:String):ByteArray=withContext(Dispatchers.IO) {
        val url=ORIGIN.toHttpUrl().newBuilder().addPathSegments("api/v1/mail/attachment").addPathSegment(id).addPathSegment(part).build()
        client.newCall(Request.Builder().url(url).build()).execute().use {r->
            check(r.isSuccessful){"Attachment unavailable (HTTP ${r.code})."}
            r.body?.byteStream()?.use{readProjectMaterial(it,25*1024*1024)}?:error("Empty attachment")
        }
    }
    suspend fun saveProject(data:JSONObject,version:Int) {
        mutate("/api/v1/planner/entity",JSONObject().put("kind","project").put("version",version).put("data",data))

    }
    suspend fun projectMaterial(name:String,content:String):JSONObject = JSONObject(request("/api/v1/planner/material",JSONObject().put("name",name).put("content",content)))
    suspend fun requestPlanning() {
        request("/api/v1/planner/refresh",JSONObject())
        val fresh=request("/api/v1/planner/snapshot")
        mutable.value=mutable.value.copy(snapshots=mutable.value.snapshots+("planner" to fresh))
    }
    fun refresh()=operation { if(mutable.value.signedIn){bindHermes(api("/api/v1/auth/session"));refreshAll()} else restoreSession() }
    fun signOut()=operation {
        writes.clear()
        receiptOwner=null
        hermes.unbind()
        var revoked=false
        try { request("/api/v1/auth/logout",JSONObject());revoked=true }
        catch(_:java.io.IOException) { /* Local logout must still work offline. */ }
        finally {
            withContext(Dispatchers.IO){sessions.clear();clearWorkspaceCache()}
            mutable.value=WorkspaceState(notice=if(revoked)"Signed out" else "Signed out on this phone. Server revocation could not be confirmed.")
        }
    }
    fun complete(entry:JSONObject,done:Boolean)=operation {
        val data=JSONObject(entry.getJSONObject("data").toString()).put("completed",done)
        mutate("/api/v1/planner/entity",JSONObject().put("kind","action").put("version",entry.getInt("version")).put("data",data))
    }
    fun feedback(id:String,important:Boolean)=operation {
        request("/api/v1/mail/feedback",JSONObject().put("id",id).put("important",important));refreshDataset("mail")
    }
}
