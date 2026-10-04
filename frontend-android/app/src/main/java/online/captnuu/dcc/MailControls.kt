package online.captnuu.dcc

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable fun MailControls(state:WorkspaceState,model:WorkspaceModel?) {
 var open by rememberSaveable{mutableStateOf(false)};var rules by rememberSaveable{mutableStateOf("")};var loaded by remember{mutableStateOf(false)};var busy by remember{mutableStateOf(false)};var message by remember{mutableStateOf("")};val scope=rememberCoroutineScope()
 TextButton(onClick={open=true;if(!loaded&&model!=null){busy=true;scope.launch{try{rules=model.api("/api/v1/mail/preferences").optString("rules");loaded=true}catch(e:Exception){message=e.message.orEmpty()}finally{busy=false}}}}){Text("Mail settings & sync")}
 if(open)AlertDialog(onDismissRequest={if(!busy)open=false},title={Text("Mail settings")},text={Column {
  state.snapshots["mail"]?.let{JSONObject(it).optJSONArray("accounts").objects().forEach{a->Text("${a.optString("account")} · ${if(!a.isNull("error"))a.optString("error") else a.optString("last_success","Not synced")}",style=MaterialTheme.typography.bodySmall)}}
  OutlinedTextField(rules,{rules=it.take(4000)},label={Text("Importance rules")},enabled=loaded&&!busy,minLines=3,maxLines=7)
  TextButton(onClick={busy=true;scope.launch{try{model!!.api("/api/v1/mail/refresh",JSONObject());message="Mail sync queued. Refresh to retrieve results."}catch(e:Exception){message=e.message.orEmpty()}finally{busy=false}}},enabled=state.signedIn&&!busy&&model!=null){Text("Sync mail")}
  if(message.isNotBlank())Text(message,style=MaterialTheme.typography.bodySmall)
 }},confirmButton={TextButton(onClick={busy=true;scope.launch{try{model!!.api("/api/v1/mail/preferences",JSONObject().put("rules",rules));check(model.api("/api/v1/mail/preferences").getString("rules")==rules){"Could not confirm rules"};message="Rules saved."}catch(e:Exception){message=e.message.orEmpty()}finally{busy=false}}},enabled=loaded&&!busy&&state.signedIn){Text("Save rules")}},dismissButton={TextButton(onClick={open=false},enabled=!busy){Text("Close")}})
}
@Composable fun MailAttachments(message:JSONObject,model:WorkspaceModel?) {
 val context=LocalContext.current;val scope=rememberCoroutineScope();var part by rememberSaveable{mutableStateOf("")};var busy by remember{mutableStateOf(false)};var notice by remember{mutableStateOf("")}
 val picker=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")){uri->if(uri!=null&&model!=null){busy=true;scope.launch{try{val bytes=model.attachment(message.getString("id"),part);withContext(Dispatchers.IO){context.contentResolver.openOutputStream(uri)?.use{it.write(bytes)}?:error("Cannot write selected file")};notice="Attachment saved."}catch(e:Exception){notice=e.message?:"Download failed"}finally{busy=false}}}}
 message.optJSONArray("attachments").objects().forEach{a->TextButton(onClick={part=a.getString("part");picker.launch(a.optString("name","attachment").substringAfterLast('/').substringAfterLast('\\'))},enabled=model!=null&&!busy){Text(a.optString("name","Download attachment"))}}
 if(busy)LinearProgressIndicator(Modifier.fillMaxWidth().padding(4.dp));if(notice.isNotBlank())Text(notice,style=MaterialTheme.typography.bodySmall)
}
