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
import kotlinx.coroutines.launch
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.withLock

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
  val next=try{check(items.size<=10000){"Task collection exceeds 10000 records."};JSONArray(items.map(::normalizeTask)).toString()}catch(e:Exception){error=e.message?:"Invalid tasks; saved tasks were retained.";return}
  if(preferences.edit().putString("tasks",next).commit()){raw=next;error=""}else error="Could not save local tasks."
 }
 fun addTask(){if(title.isBlank()||syncing)return;save(tasks+JSONObject().put("id",UUID.randomUUID().toString()).put("date",date).put("title",title.trim()).put("completed",false));title=""}
 fun sync(choice:String?=null){if(model==null||syncing)return;syncing=true
   scope.launch{try{model.manualTaskLock.withLock{
    val before=preferences.getString("tasks","[]")?:"[]"
    val baseRaw=preferences.getString("sync-base","[]")?:"[]"
    val baseVersion=preferences.getLong("sync-base-version",0)
    fun unchanged()=preferences.getString("tasks","[]")==before&&preferences.getString("sync-base","[]")==baseRaw&&preferences.getLong("sync-base-version",0)==baseVersion
    val remote=model.api("/api/v1/planner/manual-tasks")
    check(unchanged()){"Newer phone edits retained. Review before syncing again."}
    val base=JSONArray(baseRaw).objects()
    val merged=mergeManualTasks(base,JSONArray(before).objects(),remote.getJSONObject("data").getJSONArray("tasks").objects(),choice)
   if(merged.second.isNotEmpty()&&choice==null){conflict=true;error="Tasks changed on both devices. Choose which conflicting edits to keep."}
   else{
     val changed=manualTasksNeedWrite(merged.first,remote.getJSONObject("data").getJSONArray("tasks").objects())
     if(changed)model.api("/api/v1/planner/manual-tasks",JSONObject().put("version",remote.getInt("version")).put("tasks",JSONArray(merged.first)))
     val snapshot=if(changed)model.api("/api/v1/planner/manual-tasks") else remote
     val confirmed=parseManualTaskReadback(snapshot)
     val fresh=JSONArray(confirmed.tasks)
     check(unchanged()){"Newer phone edits retained; the server result was not copied over them."}
    check(preferences.edit().putString("tasks",fresh.toString()).putString("sync-base",fresh.toString()).putLong("sync-base-version",confirmed.version).commit()){"Could not save synced tasks on this phone."}
    raw=fresh.toString();conflict=false;error="Tasks synced."
   }
   }}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"Sync unavailable; local tasks retained."}finally{syncing=false}}
  }
   val hermesState=if(model!=null)model.hermes.state.collectAsStateWithLifecycle().value else null
    val receipt=hermesState?.takeUnless{it.conversationFirst&&it.displaySyncVersion==1}?.receipt
  val receiptKey=receipt?.let{JSONObject(it)}?.takeIf{it.getJSONArray("targets").objects().any{t->t.optString("kind")=="task"&&t.optString("state")=="applied"}}?.getString("key")
  LaunchedEffect(receiptKey,receipt,syncing){
   if(receiptKey==null||model==null||syncing)return@LaunchedEffect
   val fence=model.hermes.ownerFence()?:return@LaunchedEffect
   // Read-only reconciliation after a server effect. Never auto-submit the
   // phone's offline edits, and never overwrite a newer edit or auth generation.
   val before=preferences.getString("tasks","[]")?:"[]"
   val baseRaw=preferences.getString("sync-base","[]")?:"[]"
   val baseVersion=preferences.getLong("sync-base-version",0L)
   try{
    val remote=model.hermesTaskReadback(fence)
    val currentReceipt=model.hermes.state.value.receipt?.let{JSONObject(it).optString("key")}
    if(!model.hermes.isCurrent(fence)||syncing||currentReceipt!=receiptKey||preferences.getString("tasks","[]")!=before||preferences.getString("sync-base","[]")!=baseRaw||preferences.getLong("sync-base-version",0L)!=baseVersion)return@LaunchedEffect
    val merged=mergeManualTaskReadback(baseRaw,before,remote,baseVersion)?:return@LaunchedEffect
    if(merged.conflicts.isNotEmpty()){conflict=true;error="Hermes saved server tasks. Local conflicts are retained; use Sync tasks to review."}
    else{
     check(preferences.edit().putString("tasks",merged.tasks).putString("sync-base",merged.base).putLong("sync-base-version",merged.version).commit()){"Could not cache the server tasks; offline edits retained."}
     raw=merged.tasks
    }
   }catch(e:CancellationException){throw e}
   catch(_:Exception){if(model.hermes.isCurrent(fence))error="Hermes receipt retained. Could not refresh tasks; local edits are unchanged."}
  }
  var toolsOpen by rememberSaveable { mutableStateOf(false) }
  val toolsActive=search.isNotBlank()||onlyOpen||syncing||conflict
  Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
  OutlinedTextField(title,{title=it},label={Text("Add a task")},modifier=Modifier.fillMaxWidth().testTag("task-add"),singleLine=true,enabled=!syncing,keyboardOptions=androidx.compose.foundation.text.KeyboardOptions(imeAction=androidx.compose.ui.text.input.ImeAction.Done),keyboardActions=androidx.compose.foundation.text.KeyboardActions(onDone={addTask()}),trailingIcon={if(title.isNotBlank())TextButton(onClick={addTask()},enabled=!syncing){Text("Add")} })
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
   TextButton(onClick={toolsOpen=!toolsOpen},modifier=Modifier.testTag("task-tools").defaultMinSize(minWidth=48.dp,minHeight=48.dp)){Text(if(toolsOpen||toolsActive)"Task tools · hide" else "Task tools")}
  }
  if(toolsOpen||toolsActive){
   Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
    OutlinedTextField(search,{search=it},label={Text("Find tasks")},modifier=Modifier.weight(1f).testTag("task-find"),singleLine=true)
    FilterChip(onlyOpen,{onlyOpen=!onlyOpen},label={Text("Open")},modifier=Modifier.defaultMinSize(minHeight=48.dp))
    TextButton(onClick={sync()},enabled=model!=null&&!syncing,modifier=Modifier.defaultMinSize(minWidth=48.dp,minHeight=48.dp)){Text(if(syncing)"Syncing…" else "Sync tasks")}
   }
  }
  if(conflict)Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){TextButton(onClick={sync("local")},enabled=!syncing){Text("Keep local")};TextButton(onClick={sync("remote")},enabled=!syncing){Text("Keep remote")}}
  tasks.filter{manualTaskVisible(it,date,search,onlyOpen)}.sortedByDescending{it.optBoolean("important")}.forEach { task ->
   Row(Modifier.fillMaxWidth().defaultMinSize(minHeight=48.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
    Checkbox(task.optBoolean("completed"),{done->save(tasks.map{if(it==task)JSONObject(it.toString()).put("completed",done) else it})},enabled=!syncing)
    TextButton(onClick={editing=task.toString()},modifier=Modifier.weight(1f),enabled=!syncing,contentPadding=PaddingValues(horizontal=4.dp,vertical=8.dp)){Text((if(task.optBoolean("important"))"★ " else "")+task.optString("title"),style=MaterialTheme.typography.bodyMedium,textAlign=androidx.compose.ui.text.style.TextAlign.Start,modifier=Modifier.fillMaxWidth())}
   }
  }
  Text("Tasks save on this phone immediately. Sync shares them when connected.",style=MaterialTheme.typography.bodySmall)
  if(error.isNotEmpty())Text(error,color=MaterialTheme.colorScheme.error)
  editing?.let{value->val draft=JSONObject(value);val draftId=draft.optString("id")
   AlertDialog(onDismissRequest={editing=null},title={Text("Edit task")},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
    OutlinedTextField(draft.optString("title"),{editing=JSONObject(value).put("title",it.take(240)).toString()},label={Text("Title")})
    OutlinedTextField(draft.optString("notes"),{editing=JSONObject(value).put("notes",it.take(4000)).toString()},label={Text("Notes")},maxLines=5)
    OutlinedTextField(draft.optString("date"),{editing=JSONObject(value).put("date",it).toString()},label={Text("Date · YYYY-MM-DD")})
    Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Checkbox(draft.optBoolean("important"),{editing=JSONObject(value).put("important",it).toString()});Text("Important")}
   }},confirmButton={TextButton(onClick={save(tasks.map{if(it.optString("id")==draftId)draft else it});editing=null},enabled=draft.optString("title").isNotBlank()&&runCatching{java.time.LocalDate.parse(draft.optString("date"))}.isSuccess){Text("Save")}},dismissButton={Row{TextButton(onClick={save(tasks.map{if(it.optString("id")==draftId)JSONObject(it.toString()).put("deleted",true) else it});editing=null},enabled=!syncing){Text("Delete")};TextButton(onClick={editing=null}){Text("Cancel")}}})
  }
 }
}
