package online.captnuu.dcc
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

fun validatedTaskBackup(raw:String):List<JSONObject>{
 val items=JSONArray(raw).objects();require(items.size<=10000){"Too many tasks"}
 val normalized=items.map{normalizeTask(it)}
 require(normalized.all{it.getString("title").isNotBlank()&&it.getString("title").length<=240&&it.getString("notes").length<=4000&&Regex("^[a-zA-Z0-9_.-]{1,100}$").matches(it.getString("id"))&&runCatching{LocalDate.parse(it.getString("date"))}.isSuccess}){"Invalid task backup"}
 require(normalized.map{it.getString("id")}.toSet().size==normalized.size){"Duplicate task IDs"};return normalized
}
@Composable fun TaskBackup(){
 val context=LocalContext.current;val prefs=remember{context.getSharedPreferences("dcc-local-tasks",0)};val scope=rememberCoroutineScope();var notice by remember{mutableStateOf("")};var busy by remember{mutableStateOf(false)}
 val export=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")){uri->if(uri!=null){busy=true;scope.launch{try{withContext(Dispatchers.IO){val raw=prefs.getString("tasks","[]")!!;validatedTaskBackup(raw);context.contentResolver.openOutputStream(uri)?.use{it.write(raw.toByteArray())}?:error("Cannot write backup")};notice="Backup saved. It contains task text; keep it private."}catch(e:Exception){notice=e.message.orEmpty()}finally{busy=false}}}}
 val import=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null){busy=true;scope.launch{try{withContext(Dispatchers.IO){val raw=context.contentResolver.openInputStream(uri)?.use{String(readProjectMaterial(it,5*1024*1024),Charsets.UTF_8)}?:error("Cannot read backup");val incoming=validatedTaskBackup(raw);val existing=validatedTaskBackup(prefs.getString("tasks","[]")!!);val merged=mergeManualTasks(emptyList(),existing,incoming);require(merged.second.isEmpty()){"Backup contains conflicting IDs; existing tasks left unchanged."};check(prefs.edit().putString("tasks",JSONArray(merged.first).toString()).commit())};notice="Tasks imported. Reopen Tasks to view them."}catch(e:Exception){notice=e.message.orEmpty()}finally{busy=false}}}}
 TextButton(onClick={export.launch("dcc-tasks.json")},enabled=!busy){Text("Export local tasks")}
 TextButton(onClick={import.launch(arrayOf("application/json","text/plain"))},enabled=!busy){Text("Import task backup")}
 if(notice.isNotBlank())Text(notice,style=MaterialTheme.typography.bodySmall)
}
