package online.captnuu.dcc

import androidx.lifecycle.ViewModel
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
import java.util.concurrent.TimeUnit

private const val ORIGIN = "https://dcc.home.captnuu.online"
data class WorkspaceState(val signedIn:Boolean=false,val busy:Boolean=false,val notice:String="Sign in to connect to your workspace.",val snapshots:Map<String,String> = emptyMap())

class WorkspaceModel:ViewModel() {
    private val mutable = MutableStateFlow(WorkspaceState())
    val state = mutable.asStateFlow()
    private var cookies = listOf<Cookie>()
    private val client = OkHttpClient.Builder().callTimeout(20,TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false)
        .cookieJar(object:CookieJar {
            override fun saveFromResponse(url:HttpUrl,values:List<Cookie>) { cookies=values }
            override fun loadForRequest(url:HttpUrl)=cookies.filter { it.expiresAt>System.currentTimeMillis() && it.matches(url) }
        }).build()
    private suspend fun request(path:String,body:JSONObject?=null):String = withContext(Dispatchers.IO) {
        val builder=Request.Builder().url(ORIGIN+path).header("Origin",ORIGIN)
        if(body!=null) builder.post(body.toString().toRequestBody("application/json".toMediaType()))
        client.newCall(builder.build()).execute().use { response ->
            if(response.code==401) {
                cookies=emptyList()
                mutable.value=mutable.value.copy(signedIn=false)
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
        mutable.value=mutable.value.copy(signedIn=true,notice="Signed in")
        refreshAll()
    }
    private suspend fun refreshAll() {
        for(name in listOf("planner","calendar","mail","prices")) {
            val snapshot=request("/api/v1/$name/snapshot")
            mutable.value=mutable.value.copy(snapshots=mutable.value.snapshots+(name to snapshot))
        }
        mutable.value=mutable.value.copy(notice="Workspace refreshed")
    }
    suspend fun saveProject(data:JSONObject,version:Int) {
        request("/api/v1/planner/entity",JSONObject().put("kind","project").put("version",version).put("data",data))
        val fresh=request("/api/v1/planner/snapshot")
        val saved=JSONObject(fresh).optJSONArray("projects").objects().any { it.getJSONObject("data").optString("id")==data.getString("id") && it.getJSONObject("data").optString("title")==data.getString("title") }
        check(saved) { "Save submitted, but could not confirm it. Refresh before retrying." }
        mutable.value=mutable.value.copy(snapshots=mutable.value.snapshots+("planner" to fresh))
    }
    suspend fun projectMaterial(name:String,content:String):JSONObject = JSONObject(request("/api/v1/planner/material",JSONObject().put("name",name).put("content",content)))
    suspend fun requestPlanning() {
        request("/api/v1/planner/refresh",JSONObject())
        val fresh=request("/api/v1/planner/snapshot")
        mutable.value=mutable.value.copy(snapshots=mutable.value.snapshots+("planner" to fresh))
    }
    fun refresh()=operation { refreshAll() }
    fun signOut()=operation {
        request("/api/v1/auth/logout",JSONObject())
        cookies=emptyList();mutable.value=WorkspaceState()
    }
    fun complete(entry:JSONObject,done:Boolean)=operation {
        val data=JSONObject(entry.getJSONObject("data").toString()).put("completed",done)
        request("/api/v1/planner/entity",JSONObject().put("kind","action").put("version",entry.getInt("version")).put("data",data))
        refreshAll()
    }
    fun feedback(id:String,important:Boolean)=operation {
        request("/api/v1/mail/feedback",JSONObject().put("id",id).put("important",important));refreshAll()
    }
}
