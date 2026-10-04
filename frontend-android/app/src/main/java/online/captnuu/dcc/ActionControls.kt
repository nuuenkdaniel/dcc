package online.captnuu.dcc
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject
@Composable fun ActionControls(entry:JSONObject,model:WorkspaceModel?){
 var open by remember{mutableStateOf(false)};var raw by remember{mutableStateOf(entry.getJSONObject("data").toString())};var busy by remember{mutableStateOf(false)};var error by remember{mutableStateOf("")};val scope=rememberCoroutineScope()
 var version by remember{mutableIntStateOf(entry.getInt("version"))}
 TextButton(onClick={raw=entry.getJSONObject("data").toString();version=entry.getInt("version");open=true},enabled=model!=null){Text("Edit task")}
 if(open){val d=JSONObject(raw);fun field(k:String,v:Any){raw=JSONObject(raw).put(k,v).toString()}
  AlertDialog(onDismissRequest={if(!busy)open=false},title={Text("Edit task")},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
   OutlinedTextField(d.optString("title"),{field("title",it.take(240))},label={Text("Title")},enabled=!busy)
   OutlinedTextField(d.optString("notes"),{field("notes",it.take(4000))},label={Text("Notes")},enabled=!busy,maxLines=5)
   Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Checkbox(d.optBoolean("important"),{field("important",it)},enabled=!busy);Text("Important")}
   Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Checkbox(d.optBoolean("dismissed"),{field("dismissed",it)},enabled=!busy);Text("Dismiss task")}
   if(d.optString("preparationId").isNotBlank()&&d.optBoolean("completed")){Text("How did it go?");Row{listOf("comfortable","review").forEach{value->FilterChip(d.optString("feedback")==value,{field("feedback",value)},label={Text(if(value=="review")"Needs review" else "Comfortable")},enabled=!busy)}}}
   if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error)
  }},confirmButton={TextButton(onClick={busy=true;scope.launch{try{model!!.mutate("/api/v1/planner/entity",JSONObject().put("kind","action").put("version",version).put("data",d));model.refresh();open=false}catch(e:Exception){error=e.message.orEmpty()}finally{busy=false}}},enabled=!busy&&d.optString("title").isNotBlank()){Text("Save")}},dismissButton={TextButton(onClick={open=false},enabled=!busy){Text("Cancel")}})
 }
}
