package online.captnuu.dcc

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

fun releaseVersion(tag:String):List<Int>?=Regex("^v?(\\d+)\\.(\\d+)\\.(\\d+)$").matchEntire(tag)?.groupValues?.drop(1)?.map{it.toIntOrNull()?:return null}
fun newerRelease(tag:String,current:String):Boolean {val a=releaseVersion(tag)?:return false;val b=releaseVersion(current)?:return false;for(i in 0..2){if(a[i]!=b[i])return a[i]>b[i]};return false}
@Composable fun UpdateControl(compact:Boolean=false){
 val context=LocalContext.current;val uri=LocalUriHandler.current;val scope=rememberCoroutineScope()
 var message by remember{mutableStateOf("")};var link by remember{mutableStateOf("")};var busy by remember{mutableStateOf(false)}
 val prefs=remember{context.getSharedPreferences("dcc-updates",0)}
 suspend fun check(){busy=true;try{
  val current=context.packageManager.getPackageInfo(context.packageName,0).versionName?:"0.0.0"
  val release=withContext(Dispatchers.IO){val client=OkHttpClient.Builder().callTimeout(15,TimeUnit.SECONDS).build();client.newCall(Request.Builder().url("https://api.github.com/repos/nuuenkdaniel/dcc/releases/latest").header("Accept","application/vnd.github+json").build()).execute().use{r->if(r.code==404)null else {check(r.isSuccessful){"Update check unavailable"};JSONObject(r.body!!.string())}}}
  val url=release?.optString("html_url").orEmpty()
  if(release!=null&&!release.optBoolean("draft")&&!release.optBoolean("prerelease")&&newerRelease(release.optString("tag_name"),current)&&url.startsWith("https://github.com/nuuenkdaniel/dcc/releases/tag/")&&release.optJSONArray("assets").objects().any{it.optString("name").endsWith(".apk")}){message="Update available: ${release.optString("tag_name")}";link=url}
  else{message="No newer Android release available.";link=""}
  prefs.edit().putLong("checked",System.currentTimeMillis()).putString("message",message).putString("link",link).apply()
 }catch(_:Exception){message="Could not check updates. Try again when connected."}finally{busy=false}}
 LaunchedEffect(Unit){message=prefs.getString("message","").orEmpty();link=prefs.getString("link","").orEmpty();if(System.currentTimeMillis()-prefs.getLong("checked",0)>24*60*60*1000L)check()}
 if(!compact)TextButton(onClick={scope.launch{check()}},enabled=!busy){Text(if(busy)"Checking…" else "Check for updates")}
 if(message.isNotBlank()&&(!compact||link.isNotBlank()))Text(message,style=MaterialTheme.typography.bodySmall)
 if(link.startsWith("https://github.com/nuuenkdaniel/dcc/releases/tag/"))TextButton(onClick={uri.openUri(link)}){Text("Open release & download APK")}
}
