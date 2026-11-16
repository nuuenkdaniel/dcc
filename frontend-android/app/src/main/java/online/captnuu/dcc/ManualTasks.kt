package online.captnuu.dcc

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable fun ManualTasks(date:String,model:WorkspaceModel?=null) {
 val context=LocalContext.current
 val preferences=remember { context.getSharedPreferences("dcc-local-tasks",0) }
 val state=model?.state?.collectAsStateWithLifecycle()?.value?:WorkspaceState()
 val confirmed=state.snapshots["task"]?.let{JSONObject(it).optJSONObject("data")?.optJSONArray("tasks").objects()}.orEmpty()
 val pending=state.pending.mapNotNull{raw->JSONObject(raw).takeIf{it.optString("kind")=="task"}?.optJSONObject("body")?.optJSONObject("task")}
 val tasks=(confirmed+pending).associateBy{it.optString("id")}.values.toList()
 val pendingIds=pending.map{it.optString("id")}.toSet()
 val online=state.online&&state.snapshots.containsKey("task")&&model!=null
 var title by rememberSaveable(date){mutableStateOf("")}
 var error by rememberSaveable{mutableStateOf("")}
 var editing by rememberSaveable{mutableStateOf<String?>(null)}
 var search by rememberSaveable{mutableStateOf("")}
 var onlyOpen by rememberSaveable{mutableStateOf(false)}
 fun find(id:String)=confirmed.find{it.optString("id")==id}
 fun save(task:JSONObject):Boolean{
  return try{
   check(online){"Connect to make changes"}
   model!!.saveManualTask(find(task.getString("id")),normalizeTask(task))
   error=""
   true
  }catch(e:Exception){error=e.message?:"Couldn’t sync this task.";false}
 }
 fun addTask(){
  val clean=title.trim()
  if(clean.isBlank())return
  val task=JSONObject().put("id",UUID.randomUUID().toString()).put("title",clean.take(240)).put("notes","").put("date",date).put("completed",false)
  if(save(task))title=""
 }
 val previous=remember(preferences){
  val base=runCatching{JSONArray(preferences.getString("sync-base","[]")?:"[]").objects()}.getOrDefault(emptyList()).associateBy{it.optString("id")}
  runCatching{JSONArray(preferences.getString("tasks","[]")?:"[]").objects()}.getOrDefault(emptyList()).filter{task->
   !task.optBoolean("deleted")&&task.toString()!=base[task.optString("id")]?.toString()
  }
 }
 var review by rememberSaveable{mutableStateOf(false)}
 val legacy=previous.filter{task->val remote=find(task.optString("id"));remote==null||!containsSubmitted(remote,task)}
 val failed=state.failedWrite?.let{JSONObject(it)}?.takeIf{it.optString("kind")=="task"}?.optJSONObject("body")?.optJSONObject("task")
  var toolsOpen by rememberSaveable { mutableStateOf(false) }
  val toolsActive=search.isNotBlank()||onlyOpen
  Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
  OutlinedTextField(title,{title=it},label={Text("Add a task")},modifier=Modifier.fillMaxWidth().testTag("task-add"),singleLine=true,enabled=online,keyboardOptions=androidx.compose.foundation.text.KeyboardOptions(imeAction=androidx.compose.ui.text.input.ImeAction.Done),keyboardActions=androidx.compose.foundation.text.KeyboardActions(onDone={addTask()}),trailingIcon={if(title.isNotBlank())TextButton(onClick={addTask()},enabled=online){Text("Add")} })
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
   TextButton(onClick={toolsOpen=!toolsOpen},modifier=Modifier.testTag("task-tools").defaultMinSize(minWidth=48.dp,minHeight=48.dp)){Text(if(toolsOpen||toolsActive)"Task tools · hide" else "Task tools")}
  }
  if(toolsOpen||toolsActive){
   Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
    OutlinedTextField(search,{search=it},label={Text("Find tasks")},modifier=Modifier.weight(1f).testTag("task-find"),singleLine=true)
    FilterChip(onlyOpen,{onlyOpen=!onlyOpen},label={Text("Open")},modifier=Modifier.defaultMinSize(minHeight=48.dp))
   }
  }
  tasks.filter{manualTaskVisible(it,date,search,onlyOpen)}.sortedByDescending{it.optBoolean("important")}.forEach { task ->
   Row(Modifier.fillMaxWidth().defaultMinSize(minHeight=48.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
    Checkbox(task.optBoolean("completed"),{done->save(JSONObject(task.toString()).put("completed",done))},enabled=online&&task.optString("id") !in pendingIds)
    TextButton(onClick={editing=task.toString()},modifier=Modifier.weight(1f),enabled=online&&task.optString("id") !in pendingIds,contentPadding=PaddingValues(horizontal=4.dp,vertical=8.dp)){Text((if(task.optBoolean("important"))"★ " else "")+task.optString("title")+(if(task.optString("id") in pendingIds)" · Saving…" else ""),style=MaterialTheme.typography.bodyMedium,textAlign=androidx.compose.ui.text.style.TextAlign.Start,modifier=Modifier.fillMaxWidth())}
   }
  }
  if(!online)Text("Connect to make changes",style=MaterialTheme.typography.bodySmall)
  if(failed!=null)TextButton(onClick={editing=failed.toString()},enabled=online){Text("Edit failed task")}
  if(legacy.isNotEmpty()){
   TextButton(onClick={review=!review}){Text("Review previous device tasks")}
   if(review)legacy.forEach{task->
    Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
     Text(task.optString("title"),modifier=Modifier.weight(1f))
     TextButton(onClick={editing=task.toString()},enabled=online){Text("Review")}
    }
   }
  }
  if(error.isNotEmpty())Text(error,color=MaterialTheme.colorScheme.error)
  editing?.let{value->val draft=JSONObject(value)
   AlertDialog(onDismissRequest={editing=null},title={Text("Edit task")},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
    OutlinedTextField(draft.optString("title"),{editing=JSONObject(value).put("title",it.take(240)).toString()},label={Text("Title")})
    OutlinedTextField(draft.optString("notes"),{editing=JSONObject(value).put("notes",it.take(4000)).toString()},label={Text("Notes")},maxLines=5)
    OutlinedTextField(draft.optString("date"),{editing=JSONObject(value).put("date",it).toString()},label={Text("Date · YYYY-MM-DD")})
    Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Checkbox(draft.optBoolean("important"),{editing=JSONObject(value).put("important",it).toString()});Text("Important")}
   }},confirmButton={TextButton(onClick={if(save(draft))editing=null},enabled=online&&draft.optString("title").isNotBlank()&&runCatching{java.time.LocalDate.parse(draft.optString("date"))}.isSuccess){Text("Save")}},dismissButton={Row{TextButton(onClick={if(save(draft.put("deleted",true)))editing=null},enabled=online){Text("Delete")};TextButton(onClick={editing=null}){Text("Cancel")}}})
  }
 }
}
