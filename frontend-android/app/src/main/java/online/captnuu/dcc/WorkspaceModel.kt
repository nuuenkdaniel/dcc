package online.captnuu.dcc

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import okhttp3.HttpUrl.Companion.toHttpUrl
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
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

private const val ORIGIN = "https://dcc.home.captnuu.online"
data class WorkspaceState(val restoring:Boolean=false,val restorePending:Boolean=false,val signedIn:Boolean=false,val busy:Boolean=false,val notice:String="Sign in to connect to your workspace.",val pending:List<String> = emptyList(),val snapshots:Map<String,String> = emptyMap())

class WorkspaceModel(application:Application):AndroidViewModel(application) {
    private val mutable = MutableStateFlow(WorkspaceState(restoring=true,busy=true,notice="Restoring session…"))
    val state = mutable.asStateFlow()
    private fun clearWorkspaceCache(){cache.clear();getApplication<Application>().noBackupFilesDir.listFiles()?.filter{Regex("mail-body-[a-f0-9]{64}\\.enc").matches(it.name)}?.forEach{it.delete()}}
    private val queue=MutationQueue(EncryptedSessionStorage(application,"outbox.enc",strict=true))
    private val queueLock=Mutex()
    private val connectivity=application.getSystemService(android.net.ConnectivityManager::class.java)
    private val networkCallback=object:android.net.ConnectivityManager.NetworkCallback(){override fun onAvailable(network:android.net.Network){viewModelScope.launch{if(!mutable.value.restoring&&(mutable.value.signedIn||mutable.value.restorePending))refresh()}}}
    private val cache=EncryptedSessionStorage(application,"workspace.enc")
    private val sessions=PersistentSessionJar(EncryptedSessionStorage(application),ORIGIN.toHttpUrl())
    private val client = OkHttpClient.Builder().callTimeout(20,TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).cookieJar(sessions).build()
    init { connectivity.registerDefaultNetworkCallback(networkCallback);viewModelScope.launch {
        try { withContext(Dispatchers.IO){sessions.restore()
            if(sessions.hasSession()){mutable.value=mutable.value.copy(pending=queue.list().map{it.toString()})};if(sessions.hasSession())cache.read()?.let {raw->
                val data=JSONObject(raw);mutable.value=mutable.value.copy(snapshots=data.keys().asSequence().associateWith{data.getString(it)})
            } else clearWorkspaceCache()
        };restoreSession() }
        catch(_:Exception){
            val retained=withContext(Dispatchers.IO){sessions.hasSession()}
            mutable.value=mutable.value.copy(restorePending=retained&&!mutable.value.signedIn,notice=if(retained)"Connection unavailable. Saved sign-in retained; retry to load data." else "Session unavailable. Please sign in again.")
        }
        finally {mutable.value=mutable.value.copy(restoring=false,busy=false)}
    } }
    override fun onCleared(){connectivity.unregisterNetworkCallback(networkCallback);super.onCleared()}
    private suspend fun restoreSession() {
        if(!withContext(Dispatchers.IO){sessions.hasSession()}) {mutable.value=WorkspaceState();return}
        val result=JSONObject(request("/api/v1/auth/session"))
        if(!result.getBoolean("authenticated")) {
            withContext(Dispatchers.IO){sessions.clear();clearWorkspaceCache()}
            mutable.value=WorkspaceState(notice="Session expired. Please sign in again.");return
        }
        mutable.value=mutable.value.copy(signedIn=true,restoring=false,restorePending=false,notice="Signed in")
        refreshAll()
    }
    private suspend fun request(path:String,body:JSONObject?=null):String = withContext(Dispatchers.IO) {
        val builder=Request.Builder().url(ORIGIN+path).header("Origin",ORIGIN)
        if(body!=null) builder.post(body.toString().toRequestBody("application/json".toMediaType()))
        val callClient=if(path.endsWith("/extract")||path.endsWith("/session")||path.endsWith("/material"))client.newBuilder().callTimeout(180,TimeUnit.SECONDS).build() else client
        callClient.newCall(builder.build()).execute().use { response ->
            if(response.code==401) {
                sessions.clear();clearWorkspaceCache()
                mutable.value=WorkspaceState(busy=true)
                throw IllegalStateException("Sign-in required. Check credentials or sign in again.")
            }
            if(response.code==409) throw IllegalStateException("Changed on another device. Refresh before retrying.")
            check(response.isSuccessful) { "Request failed (HTTP ${response.code})." }
            response.body?.string() ?: "{}"
        }
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
        request("/api/v1/auth/login",JSONObject().put("username",username).put("password",password))
        mutable.value=mutable.value.copy(signedIn=true,restorePending=false,notice="Signed in")
        refreshAll()
    }
    private suspend fun queueState(){val entries=withContext(Dispatchers.IO){queue.list().map{it.toString()}};mutable.value=mutable.value.copy(pending=entries)}
    suspend fun retryPending(key:String){queueLock.withLock{withContext(Dispatchers.IO){queue.retry(key)}};flushQueue();refreshAll()}
    suspend fun discardPending(key:String){withContext(Dispatchers.IO){queue.remove(key)};queueState()}
    suspend fun mutate(path:String,body:JSONObject){
        queueLock.withLock {
            withContext(Dispatchers.IO){queue.enqueue(path,body)}
            queueState()
        }
        flushQueue()
    }
    private suspend fun flushQueue()=queueLock.withLock {
        for(entry in withContext(Dispatchers.IO){queue.list()}){
            if(entry.has("error"))break
            try {
                val path=entry.getString("path");val body=entry.getJSONObject("body")
                request(path,body)
                if(path.endsWith("entity")){
                    val fresh=JSONObject(request("/api/v1/planner/snapshot"));val kind=body.getString("kind")
                    val found=fresh.optJSONArray(if(kind=="preparation")"preparations" else kind+"s").objects().any{containsSubmitted(it.getJSONObject("data"),body.getJSONObject("data"))}
                    check(found){"Save could not be confirmed"}
                }
                withContext(Dispatchers.IO){queue.remove(entry.getString("key"))}
            }catch(e:kotlinx.coroutines.CancellationException){throw e}
            catch(_:java.io.IOException){break}
            catch(e:Exception){withContext(Dispatchers.IO){queue.failure(entry.getString("key"),e.message?:"Review required")};break}
        }
        queueState()
        if(mutable.value.pending.isNotEmpty())mutable.value=mutable.value.copy(notice="Edits retained on this phone. Review Pending edits in Settings.")
    }
    private suspend fun refreshAll() {
        flushQueue()
        for(name in listOf("planner","calendar","mail","prices")) {
            val snapshot=request(if(name=="mail")"/api/v1/mail/page" else "/api/v1/$name/snapshot")
            mutable.value=mutable.value.copy(snapshots=mutable.value.snapshots+(name to snapshot))
            withContext(Dispatchers.IO){cache.write(JSONObject(mutable.value.snapshots).toString())}
        }
        mutable.value=mutable.value.copy(notice=if(mutable.value.pending.isEmpty())"Workspace refreshed" else "Unsent edits retained. Review Pending edits in Settings.")
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
    suspend fun mailBody(id:String):String=withContext(Dispatchers.IO){
        require(Regex("^[a-f0-9]{64}$").matches(id)){"Invalid message ID"}
        val storage=EncryptedSessionStorage(getApplication(),"mail-body-$id.enc")
        storage.read()?.let{return@withContext it}
        val body=api("/api/v1/mail/message/$id").getString("body");storage.write(body);body
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
        if(mutable.value.pending.isEmpty())refreshAll()
    }
    suspend fun projectMaterial(name:String,content:String):JSONObject = JSONObject(request("/api/v1/planner/material",JSONObject().put("name",name).put("content",content)))
    suspend fun requestPlanning() {
        request("/api/v1/planner/refresh",JSONObject())
        val fresh=request("/api/v1/planner/snapshot")
        mutable.value=mutable.value.copy(snapshots=mutable.value.snapshots+("planner" to fresh))
    }
    fun refresh()=operation { if(mutable.value.signedIn)refreshAll() else restoreSession() }
    fun signOut()=operation {
        queueState()
        check(mutable.value.pending.isEmpty()){"Sync or explicitly discard pending edits before signing out."}
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
        refreshAll()
    }
    fun feedback(id:String,important:Boolean)=operation {
        request("/api/v1/mail/feedback",JSONObject().put("id",id).put("important",important));refreshAll()
    }
}
