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

@Composable fun ManualTasks(date:String) {
 val context=LocalContext.current
 val preferences=remember { context.getSharedPreferences("dcc-local-tasks",0) }
 var raw by remember { mutableStateOf(preferences.getString("tasks","[]")?:"[]") }
 var title by rememberSaveable(date){mutableStateOf("")}
 var error by remember {mutableStateOf("")}
 val tasks=try { JSONArray(raw).objects() } catch (_:Exception){emptyList()}
 fun save(items:List<JSONObject>) {
  val next=JSONArray(items).toString()
  if(preferences.edit().putString("tasks",next).commit()){raw=next;error=""}else error="Could not save local tasks."
 }
 Column {
  OutlinedTextField(title,{title=it},label={Text("Add a task")},modifier=Modifier.fillMaxWidth(),singleLine=true)
  TextButton(onClick={if(title.isNotBlank()){save(tasks+JSONObject().put("id",UUID.randomUUID().toString()).put("date",date).put("title",title.trim()).put("completed",false));title=""}},enabled=title.isNotBlank()){Text("Add task")}
  tasks.filter{it.optString("date")==date}.forEach { task ->
   Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
    Checkbox(task.optBoolean("completed"),{done->save(tasks.map{if(it==task)JSONObject(it.toString()).put("completed",done) else it})})
    Text(task.optString("title"),modifier=Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium)
    TextButton(onClick={save(tasks.filter{it!=task})}){Text("Delete")}
   }
  }
  Text("Manual tasks stay on this phone; web task sync is not available yet.",style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(bottom=8.dp))
  if(error.isNotEmpty())Text(error,color=MaterialTheme.colorScheme.error)
 }
}
