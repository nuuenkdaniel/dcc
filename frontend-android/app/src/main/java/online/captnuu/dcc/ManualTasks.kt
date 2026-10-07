package online.captnuu.dcc

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlinx.coroutines.launch

@Composable fun ManualTasks(date:String,model:WorkspaceModel?=null) {
 val context=LocalContext.current
 val preferences=remember { context.getSharedPreferences("dcc-local-tasks",0) }
 var raw by remember { mutableStateOf(preferences.getString("tasks","[]")?:"[]") }
 var title by rememberSaveable(date){mutableStateOf("")}
 DisposableEffect(preferences){val listener=android.content.SharedPreferences.OnSharedPreferenceChangeListener{_,key->if(key=="tasks")raw=preferences.getString("tasks","[]")?:"[]"};preferences.registerOnSharedPreferenceChangeListener(listener);onDispose{preferences.unregisterOnSharedPreferenceChangeListener(listener)}}
 var error by remember {mutableStateOf("")}
 var editing by rememberSaveable{mutableStateOf<String?>(null)}
 var search by rememberSaveable{mutableStateOf("")}
 var onlyOpen by rememberSaveable{mutableStateOf(false)}
 val scope=rememberCoroutineScope()
 var syncing by remember{mutableStateOf(false)}
 var conflict by remember{mutableStateOf(false)}
 val tasks=try { JSONArray(raw).objects() } catch (_:Exception){emptyList()}
 fun save(items:List<JSONObject>) {
  val next=JSONArray(items).toString()
  if(preferences.edit().putString("tasks",next).commit()){raw=next;error=""}else error="Could not save local tasks."
 }
 fun sync(choice:String?=null){if(model==null||syncing)return;syncing=true
  scope.launch{try{
   val remote=model.api("/api/v1/planner/manual-tasks")
   val base=JSONArray(preferences.getString("sync-base","[]")).objects()
   val merged=mergeManualTasks(base,tasks,remote.getJSONObject("data").getJSONArray("tasks").objects(),choice)
   if(merged.second.isNotEmpty()&&choice==null){conflict=true;error="Tasks changed on both devices. Choose which conflicting edits to keep."}
   else{
     val changed=manualTasksNeedWrite(merged.first,remote.getJSONObject("data").getJSONArray("tasks").objects())
     if(changed)model.api("/api/v1/planner/manual-tasks",JSONObject().put("version",remote.getInt("version")).put("tasks",JSONArray(merged.first)))
     val fresh=if(changed)model.api("/api/v1/planner/manual-tasks").getJSONObject("data").getJSONArray("tasks") else JSONArray(merged.first)
    check(preferences.edit().putString("tasks",fresh.toString()).putString("sync-base",fresh.toString()).commit()){"Could not save synced tasks on this phone."}
    raw=fresh.toString();conflict=false;error="Tasks synced."
   }
  }catch(e:Exception){error=e.message?:"Sync unavailable; local tasks retained."}finally{syncing=false}}
 }
 Column {
  TextButton(onClick={sync()},enabled=model!=null&&!syncing){Text(if(syncing)"Syncing tasks…" else "Sync tasks")}
  if(conflict){TextButton(onClick={sync("local")},enabled=!syncing){Text("Keep local conflicting edits")};TextButton(onClick={sync("remote")},enabled=!syncing){Text("Keep remote conflicting edits")}}
  OutlinedTextField(title,{title=it},label={Text("Add a task")},modifier=Modifier.fillMaxWidth(),singleLine=true,enabled=!syncing)
  TextButton(onClick={if(title.isNotBlank()){save(tasks+JSONObject().put("id",UUID.randomUUID().toString()).put("date",date).put("title",title.trim()).put("completed",false));title=""}},enabled=title.isNotBlank()&&!syncing){Text("Add task")}
  OutlinedTextField(search,{search=it},label={Text("Find manual tasks")},modifier=Modifier.fillMaxWidth(),singleLine=true)
  FilterChip(onlyOpen,{onlyOpen=!onlyOpen},label={Text("Open only")})
  tasks.filter{manualTaskVisible(it,date,search,onlyOpen)}.sortedByDescending{it.optBoolean("important")}.forEach { task ->
   Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
    Checkbox(task.optBoolean("completed"),{done->save(tasks.map{if(it==task)JSONObject(it.toString()).put("completed",done) else it})},enabled=!syncing)
    TextButton(onClick={editing=task.toString()},modifier=Modifier.weight(1f),enabled=!syncing){Text((if(task.optBoolean("important"))"★ " else "")+task.optString("title"),style=MaterialTheme.typography.bodyMedium)}
    TextButton(onClick={save(tasks.filter{it!=task})},enabled=!syncing){Text("Delete")}
   }
  }
  Text("Tasks save on this phone immediately. Sync shares them with the web and other devices.",style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(bottom=8.dp))
  if(error.isNotEmpty())Text(error,color=MaterialTheme.colorScheme.error)
  editing?.let{value->val draft=JSONObject(value)
   AlertDialog(onDismissRequest={editing=null},title={Text("Edit task")},text={Column{
    OutlinedTextField(draft.optString("title"),{editing=JSONObject(value).put("title",it.take(240)).toString()},label={Text("Title")})
    OutlinedTextField(draft.optString("notes"),{editing=JSONObject(value).put("notes",it.take(4000)).toString()},label={Text("Notes")},maxLines=5)
    OutlinedTextField(draft.optString("date"),{editing=JSONObject(value).put("date",it).toString()},label={Text("Date · YYYY-MM-DD")})
    Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Checkbox(draft.optBoolean("important"),{editing=JSONObject(value).put("important",it).toString()});Text("Important")}
   }},confirmButton={TextButton(onClick={save(tasks.map{if(it.optString("id")==draft.optString("id"))draft else it});editing=null},enabled=draft.optString("title").isNotBlank()&&runCatching{java.time.LocalDate.parse(draft.optString("date"))}.isSuccess){Text("Save")}},dismissButton={TextButton(onClick={editing=null}){Text("Cancel")}})
  }
 }
}
