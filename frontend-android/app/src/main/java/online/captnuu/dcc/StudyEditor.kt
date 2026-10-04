package online.captnuu.dcc

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import android.provider.OpenableColumns
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.json.JSONArray
import java.time.*
import java.util.UUID

@Composable fun StudyEditor(state:WorkspaceState,event:JSONObject,model:WorkspaceModel,dismiss:()->Unit){
 val context=LocalContext.current;val scope=rememberCoroutineScope()
 val existing=state.snapshots["planner"]?.let{JSONObject(it).optJSONArray("preparations").objects()}.orEmpty().firstOrNull {entry->val e=entry.getJSONObject("data").optJSONObject("event");e?.optString("calendarId")==event.optString("calendarId")&&e?.optString("uid")==event.optString("uid")&&e?.optString("recurrenceId","")==event.optString("recurrenceId","")}
 val draftStore=remember{EncryptedSessionStorage(context,"study-"+UUID.nameUUIDFromBytes((event.optString("calendarId")+":"+event.optString("uid")+":"+event.optString("recurrenceId","")).toByteArray())+".enc",strict=true)}
 val restored=remember{runCatching{draftStore.read()?.let{JSONObject(it)}}}
 val base=remember{restored.getOrNull()?.optInt("version")?:existing?.optInt("version")?:0}
 var raw by remember{mutableStateOf((restored.getOrNull()?.optJSONObject("draft")?:existing?.getJSONObject("data")?:JSONObject().put("id",UUID.randomUUID().toString()).put("title",event.optString("title")).put("event",JSONObject().put("id",event.optString("id")).put("calendarId",event.optString("calendarId")).put("uid",event.optString("uid")).put("recurrenceId",event.opt("recurrenceId")?:JSONObject.NULL).put("start",event.optString("start")).put("allDay",event.optBoolean("allDay")).put("title",event.optString("title"))).put("startDate","").put("status","active").put("topics",JSONArray()).put("progress","")).toString())}
 var text by remember{mutableStateOf(restored.getOrNull()?.optString("text").orEmpty())};var session by remember{mutableStateOf("")};var reviewed by remember{mutableStateOf(false)};var busy by remember{mutableStateOf(false)};var message by remember{mutableStateOf(if(restored.isFailure)"Saved study draft could not be read. Editing is paused." else "")};var sources by remember{mutableStateOf(false)}
 val data=JSONObject(raw)
 LaunchedEffect(raw,text){if(restored.isSuccess)try{withContext(Dispatchers.IO){draftStore.write(JSONObject().put("version",base).put("draft",JSONObject(raw)).put("text",text).toString())}}catch(e:kotlinx.coroutines.CancellationException){throw e}catch(_:Exception){message="Could not persist study draft. Keep this screen open until saved."}}
 val deadline=if(event.optBoolean("allDay"))event.optString("start").take(10) else runCatching{Instant.parse(event.getString("start")).atZone(ZoneId.of("America/New_York")).toLocalDate().toString()}.getOrDefault("")
 fun field(key:String,value:Any){raw=JSONObject(raw).put(key,value).toString();reviewed=false}
 fun run(block:suspend()->Unit){busy=true;scope.launch{try{block()}catch(e:Exception){message=e.message?:"Request failed; draft retained"}finally{busy=false}}}
 fun append(source:String){require(text.length+source.length+1<=100000){"Combined context exceeds 100,000 characters."};text+="\n"+source;reviewed=false}
 val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)run{
  val material=withContext(Dispatchers.IO){val resolver=context.contentResolver;val name=resolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{if(it.moveToFirst())it.getString(0) else null}?:"material.txt";val bytes=resolver.openInputStream(uri)?.use{readProjectMaterial(it,5*1024*1024)}?:error("Cannot read material");model.projectMaterial(name,Base64.encodeToString(bytes,Base64.NO_WRAP))}
  append(material.getString("text"));message="Material loaded. Review source text before extraction."
 }}
 Dialog(onDismissRequest={if(!busy)dismiss()},properties=DialogProperties(usePlatformDefaultWidth=false)){Surface(Modifier.fillMaxSize()){Column(Modifier.safeDrawingPadding().padding(16.dp)){
  Text("Prepare for ${event.optString("title")}",style=MaterialTheme.typography.titleLarge)
  LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(8.dp)){
   item{Text("Exam: $deadline · study ends before exam day",style=MaterialTheme.typography.bodySmall)}
   item{OutlinedTextField(data.optString("startDate"),{field("startDate",it)},label={Text("Start studying · YYYY-MM-DD")},enabled=!busy&&restored.isSuccess,modifier=Modifier.fillMaxWidth())}
   item{Row{FilterChip(data.optString("status")=="active",{field("status","active")},label={Text("Active")},enabled=!busy&&restored.isSuccess);FilterChip(data.optString("status")=="paused",{field("status","paused")},label={Text("Paused")},enabled=!busy&&restored.isSuccess)}}
   item{TextButton(onClick={sources=!sources}){Text(if(sources)"Hide materials" else "Materials & source context")}}
   if(sources){
    item{TextButton(onClick={picker.launch(arrayOf("application/pdf","text/plain","text/markdown"))},enabled=!busy&&restored.isSuccess){Text("Upload material")}}
    item{OutlinedTextField(session,{session=it},label={Text("Hermes session ID (optional)")},enabled=!busy&&restored.isSuccess,modifier=Modifier.fillMaxWidth());TextButton(onClick={run{append(model.api("/api/v1/planner/session",JSONObject().put("sessionId",session)).getString("text"))}},enabled=!busy&&restored.isSuccess&&Regex("^[a-f0-9]{12,64}$").matches(session)){Text("Load selected session")}}
    item{OutlinedTextField(text,{text=it.take(100000);reviewed=false},label={Text("Review source text")},enabled=!busy&&restored.isSuccess,minLines=3,maxLines=7,modifier=Modifier.fillMaxWidth())}
    item{TextButton(onClick={run{val result=model.api("/api/v1/planner/extract",JSONObject().put("title",event.optString("title")).put("text",text));field("topics",result.getJSONArray("topics"));field("progress",result.optString("progress"));message="Review the proposed topics before saving."}},enabled=!busy&&restored.isSuccess&&text.isNotBlank()){Text("Extract outline")}}
   }
   items(data.optJSONArray("topics").objects(),key={it.getString("id")}){topic->
    fun update(key:String,value:Any){field("topics",JSONArray(data.getJSONArray("topics").objects().map{if(it.getString("id")==topic.getString("id"))JSONObject(it.toString()).put(key,value) else it}))}
    OutlinedTextField(topic.optString("title"),{update("title",it.take(240))},label={Text("Topic")},enabled=!busy&&restored.isSuccess,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(topic.optString("notes"),{update("notes",it.take(4000))},label={Text("References / definition of done")},enabled=!busy&&restored.isSuccess,maxLines=5,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(topic.optString("minutes"),{update("minutes",it.toIntOrNull()?:0)},label={Text("Total minutes (5–1800)")},enabled=!busy&&restored.isSuccess)
    TextButton(onClick={field("topics",JSONArray(data.getJSONArray("topics").objects().filter{it.getString("id")!=topic.getString("id")}))},enabled=!busy&&restored.isSuccess){Text("Remove topic")}
   }
   item{TextButton(onClick={field("topics",data.getJSONArray("topics").put(JSONObject().put("id",UUID.randomUUID().toString()).put("title","").put("notes","").put("minutes",45)))},enabled=!busy&&restored.isSuccess&&data.getJSONArray("topics").length()<60){Text("Add topic")}}
   item{OutlinedTextField(data.optString("progress"),{field("progress",it.take(4000))},label={Text("Progress / weak areas")},enabled=!busy&&restored.isSuccess,modifier=Modifier.fillMaxWidth())}
   item{Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Checkbox(reviewed,{reviewed=it},enabled=!busy&&restored.isSuccess);Text("I reviewed topics, estimates and progress.")}}
   if(message.isNotBlank())item{Text(message,style=MaterialTheme.typography.bodySmall)}
  }
  Row{TextButton(onClick=dismiss,enabled=!busy){Text("Cancel")};Button(onClick={run{
   val start=LocalDate.parse(data.getString("startDate"));require(start<LocalDate.parse(deadline)){"Start before exam day."};val topics=data.getJSONArray("topics").objects();require(topics.isNotEmpty()&&topics.all{it.optString("title").isNotBlank()&&it.optInt("minutes") in 5..1800}){"Review topic titles and estimates."}
   model.mutate("/api/v1/planner/entity",JSONObject().put("kind","preparation").put("version",base).put("data",data));withContext(Dispatchers.IO){draftStore.clear()};model.refresh();dismiss()
  }},enabled=!busy&&restored.isSuccess&&reviewed){Text("Save preparation")}}
 }}}
}
