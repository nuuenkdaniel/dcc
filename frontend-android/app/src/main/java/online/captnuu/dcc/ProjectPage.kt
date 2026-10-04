package online.captnuu.dcc

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import android.provider.OpenableColumns
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray
import java.time.LocalDate
import java.util.UUID

fun projectFieldError(title:String,deadline:String,minutes:String):String? = when {
 title.isBlank() || title.length>240 -> "Enter a title (up to 240 characters)."
 deadline.isNotEmpty() && (!Regex("\\d{4}-\\d{2}-\\d{2}").matches(deadline) || runCatching { LocalDate.parse(deadline) }.isFailure) -> "Use a valid due date: YYYY-MM-DD."
 minutes.toIntOrNull() !in 0..100000 -> "Planning allowance must be 0–100000 minutes."
 else -> null
}
fun newProjectDraft()=JSONObject().put("id",UUID.randomUUID().toString()).put("title","").put("kind","project").put("category","school").put("description","").put("deadline","").put("importance",2).put("remainingMinutes",60).put("progress","").put("status","active").put("resources",JSONArray())

@Composable fun ProjectPage(state:WorkspaceState,model:WorkspaceModel?,refresh:()->Unit,complete:(JSONObject,Boolean)->Unit) {
 val planner=state.snapshots["planner"]?.let{JSONObject(it)}?:JSONObject()
 var filter by rememberSaveable {mutableStateOf("active")}
 var draft by rememberSaveable {mutableStateOf<String?>(null)}
 var version by rememberSaveable {mutableIntStateOf(0)}
 var working by remember {mutableStateOf(false)}
 var message by rememberSaveable {mutableStateOf("")}
 val scope=rememberCoroutineScope()
 val enabled=state.signedIn && !state.busy && !working && model!=null
 val projects=planner.optJSONArray("projects").objects().filter{filter=="all"||it.getJSONObject("data").optString("status")==filter}.sortedBy{it.getJSONObject("data").optString("deadline").ifBlank{"9999"}}
 Column(Modifier.fillMaxSize()) {
  Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
   Button(onClick={version=0;draft=newProjectDraft().toString()},enabled=enabled){Text("New project")}
  }
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(4.dp)) {listOf("active","complete","all").forEach{value->FilterChip(filter==value,{filter=value},label={Text(value.replaceFirstChar{it.uppercase()})})}}
  if(!state.signedIn)Text("Sign in to manage projects.",style=MaterialTheme.typography.bodySmall)
  if(message.isNotBlank())Text(message,style=MaterialTheme.typography.bodySmall)
  LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp)) {
   if(projects.isEmpty())item {Text(if(state.snapshots.containsKey("planner"))"No projects in this view." else "Projects haven’t loaded yet.")}
   items(projects,key={it.getJSONObject("data").getString("id")}) {entry->
    val d=entry.getJSONObject("data")
    var open by rememberSaveable(d.getString("id")){mutableStateOf(false)}
    val tasks=planner.optJSONArray("actions").objects().filter{it.getJSONObject("data").optString("projectId")==d.getString("id")}.sortedBy{it.getJSONObject("data").optString("date")}
    OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
     Text(d.optString("title"),style=MaterialTheme.typography.titleMedium)
     Text(listOf(d.optString("category"),d.optString("status"),d.optString("deadline").takeIf{it.isNotBlank()}?.let{"Due $it"}).filterNotNull().joinToString(" · "),style=MaterialTheme.typography.bodySmall)
     Text("${tasks.count{it.getJSONObject("data").optBoolean("completed")}} / ${tasks.size} tasks completed",style=MaterialTheme.typography.bodySmall)
     Row {TextButton(onClick={open=!open}){Text(if(open)"Hide details" else "Details & tasks")};TextButton(onClick={version=entry.getInt("version");draft=d.toString()},enabled=enabled){Text("Edit")}}
     if(open) {
      if(d.optString("description").isNotBlank())Text(d.optString("description"))
      if(d.optString("progress").isNotBlank())Text("Progress: ${d.optString("progress")}")
      Text("${d.optInt("remainingMinutes")} min allowance · Priority ${d.optInt("importance")}",style=MaterialTheme.typography.bodySmall)
      d.optJSONArray("resources").objects().forEach{r->var show by remember{mutableStateOf(false)};TextButton(onClick={show=!show}){Text(r.optString("name"))};if(show)Text(r.optString("text"),style=MaterialTheme.typography.bodySmall)}
      if(tasks.isEmpty())Text("No generated tasks yet.",style=MaterialTheme.typography.bodySmall)
      tasks.forEach {task->val a=task.getJSONObject("data");var notes by rememberSaveable(a.getString("id")){mutableStateOf(false)}
       Row(verticalAlignment=Alignment.CenterVertically) {
        Checkbox(a.optBoolean("completed"),{complete(task,it)},enabled=enabled&&!a.optBoolean("dismissed"))
        Column(Modifier.weight(1f)) {Text(a.optString("title"));Text("${a.optString("date").ifBlank{"Unscheduled"}} · ${a.optInt("minutes")} min${if(a.optBoolean("dismissed"))" · Dismissed" else ""}",style=MaterialTheme.typography.bodySmall)}
       }
       if(a.optString("notes").isNotBlank()){TextButton(onClick={notes=!notes}){Text(if(notes)"Hide notes" else "Task notes")};if(notes)Text(a.optString("notes"),style=MaterialTheme.typography.bodySmall)}
      }
      listOf("planError","planSummary").forEach{key->if(!d.isNull(key)&&d.optString(key).isNotBlank())Text(d.optString(key),style=MaterialTheme.typography.bodySmall)}
     }
    }}
   }
  }
  Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
   TextButton(onClick=refresh,enabled=enabled){Text("Sync")}
   val queued=planner.optJSONObject("status")?.optBoolean("requested")==true
   TextButton(onClick={working=true;scope.launch {try{model!!.requestPlanning();message="Planning requested."}catch(e:Exception){message=e.message?:"Could not request planning."}finally{working=false}}},enabled=enabled&&!queued){Text(if(queued)"Planning queued" else "Request planning")}
  }
 }
 draft?.let {raw->ProjectEditor(raw,version,enabled,model,{draft=null},{draft=it},{message="Saved. Planning updates automatically.";draft=null})}
}

@Composable private fun ProjectEditor(raw:String,version:Int,enabled:Boolean,model:WorkspaceModel?,dismiss:()->Unit,update:(String)->Unit,saved:()->Unit) {
 val d=JSONObject(raw)
 var more by rememberSaveable {mutableStateOf(false)}
 var busy by remember {mutableStateOf(false)}
 var error by rememberSaveable {mutableStateOf("")}
 var minutes by rememberSaveable(d.getString("id")){mutableStateOf(d.optInt("remainingMinutes").toString())}
 val scope=rememberCoroutineScope();val context=LocalContext.current
 fun field(k:String,v:Any){update(JSONObject(raw).put(k,v).toString())}
 val latestRaw by rememberUpdatedState(raw)
 val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null){busy=true;scope.launch {try{
  val material=withContext(Dispatchers.IO){
   val resolver=context.contentResolver
   val name=resolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{if(it.moveToFirst())it.getString(0) else null}?:"instructions.txt"
   require(name.length<=200 && name.substringAfterLast('.').lowercase() in listOf("pdf","txt","md")){"Choose PDF, TXT or Markdown (name up to 200 characters)."}
   val bytes=resolver.openInputStream(uri)?.use{readProjectMaterial(it,5*1024*1024)}?:error("Could not read file")
   require(bytes.size<=5*1024*1024){"Maximum file size is 5 MB."}
   model!!.projectMaterial(name,Base64.encodeToString(bytes,Base64.NO_WRAP))
  }
  val current=JSONObject(latestRaw);val resources=current.optJSONArray("resources")?.objects().orEmpty()+material
  require(resources.size<=20&&resources.sumOf{it.optString("text").length}<=100000){"Maximum 20 resources / 100,000 characters."}
  update(current.put("resources",JSONArray(resources)).toString());error=""
 }catch(e:Exception){error=e.message?:"Attachment failed"}finally{busy=false}}}}
 Dialog(onDismissRequest={if(!busy)dismiss()},properties=DialogProperties(usePlatformDefaultWidth=false)) {
  Surface(Modifier.fillMaxSize()) {Column(Modifier.safeDrawingPadding().padding(16.dp)) {
   Text(if(version==0)"New project" else "Edit project",style=MaterialTheme.typography.titleLarge)
   LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp)) {
    item{OutlinedTextField(d.optString("title"),{field("title",it.take(240))},label={Text("Title")},enabled=!busy,modifier=Modifier.fillMaxWidth())}
    item{OutlinedTextField(d.optString("deadline"),{field("deadline",it)},label={Text("Due date · YYYY-MM-DD (optional)")},enabled=!busy,singleLine=true,modifier=Modifier.fillMaxWidth())}
    item{OutlinedTextField(d.optString("description"),{field("description",it.take(12000))},label={Text("Instructions")},enabled=!busy,minLines=3,maxLines=8,modifier=Modifier.fillMaxWidth())}
    item{TextButton(onClick={picker.launch(arrayOf("application/pdf","text/plain","text/markdown","text/x-markdown"))},enabled=!busy&&enabled){Text("Attach instructions")};Text("PDF, TXT, Markdown · up to 5 MB",style=MaterialTheme.typography.bodySmall)}
    items(d.optJSONArray("resources").objects().withIndex().toList()){(i,r)->Row(verticalAlignment=Alignment.CenterVertically){Text(r.optString("name"),Modifier.weight(1f));TextButton(onClick={field("resources",JSONArray(d.optJSONArray("resources").objects().filterIndexed{index,_->index!=i}))},enabled=!busy){Text("Remove")}}}
    item{TextButton(onClick={more=!more}){Text(if(more)"Fewer options" else "More options")}}
    if(more){
     item{ProjectChoice("Category",d.optString("category"),listOf("school","work","personal","club"),!busy){field("category",it)}}
     item{ProjectChoice("Priority",d.optInt("importance").toString(),listOf("1","2","3"),!busy){field("importance",it.toInt())}}
     item{OutlinedTextField(minutes,{minutes=it},label={Text("Planning allowance (minutes)")},enabled=!busy,singleLine=true,modifier=Modifier.fillMaxWidth())}
     item{OutlinedTextField(d.optString("progress"),{field("progress",it.take(4000))},label={Text("Progress notes")},enabled=!busy,modifier=Modifier.fillMaxWidth())}
     item{ProjectChoice("Status",d.optString("status"),listOf("active","complete","archived"),!busy){field("status",it)}}
    }
    if(error.isNotBlank())item{Text(error,color=MaterialTheme.colorScheme.error)}
   }
   Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){TextButton(onClick=dismiss,enabled=!busy){Text("Cancel")};Button(onClick={val validation=projectFieldError(d.optString("title"),d.optString("deadline"),minutes);if(validation!=null)error=validation else {busy=true;scope.launch {try{model!!.saveProject(JSONObject(raw).put("remainingMinutes",minutes.toInt()),version);saved()}catch(e:Exception){error=e.message?:"Save failed. Your draft is retained."}finally{busy=false}}}},enabled=enabled&&!busy){Text(if(busy)"Working…" else "Save")}}
  }}
 }
}
@Composable private fun ProjectChoice(label:String,value:String,options:List<String>,enabled:Boolean,change:(String)->Unit){Column{Text(label,style=MaterialTheme.typography.labelMedium);Row(horizontalArrangement=Arrangement.spacedBy(4.dp)){options.forEach{v->FilterChip(value==v,{change(v)},enabled=enabled,label={Text(v)})}}}}
