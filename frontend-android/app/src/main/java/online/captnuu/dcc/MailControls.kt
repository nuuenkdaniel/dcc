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
import kotlinx.coroutines.CancellationException
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONObject

@Composable fun MailControls(state:WorkspaceState,model:WorkspaceModel?) {
  // Observe binding changes even when signedIn remains true during account restore.
  val fence=if(state.signedIn)model?.hermes?.state?.collectAsStateWithLifecycle()?.value?.let{model?.hermes?.ownerFence()} else null
  val api:(suspend (String,JSONObject?)->JSONObject)?=if(model!=null&&fence!=null){path,body->model.mailSettingsApi(path,body,fence)} else null
  MailSettingsControls(state,fence?.owner,{fence!=null&&model?.hermes?.isCurrent(fence)==true},api)
}
// Small UI-local draft, not a mail store/outbox. Injectable API is also used by
// synthetic lazy-header regressions; production still uses authenticated readback.
@Composable internal fun MailSettingsControls(state:WorkspaceState,owner:String?,isCurrent:()->Boolean,api:(suspend (String,JSONObject?)->JSONObject)?) {
  key(owner) {
  var draftOwner by rememberSaveable{mutableStateOf(owner)}
  var open by rememberSaveable{mutableStateOf(false)};var rules by rememberSaveable{mutableStateOf("")}
  var loaded by rememberSaveable{mutableStateOf(false)};var dirty by rememberSaveable{mutableStateOf(false)}
  var revision by rememberSaveable{mutableStateOf(0L)}
  var busy by remember{mutableStateOf(false)};var message by rememberSaveable{mutableStateOf("")};val scope=rememberCoroutineScope()
  // Lazy saveable restoration may outlive a session; never adopt another owner's draft.
  if(draftOwner!=owner){draftOwner=owner;open=false;rules="";loaded=false;dirty=false;revision++;message=""}
  val attached=remember{booleanArrayOf(true)}
  DisposableEffect(Unit){onDispose{attached[0]=false}}
  fun current()=attached[0]&&draftOwner==owner&&isCurrent()
  TextButton(onClick={open=true;if(!loaded&&!dirty&&api!=null&&!busy&&current()){
    val started=revision;busy=true
    scope.launch{try{
      val fetched=api("/api/v1/mail/preferences",null).getString("rules")
      if(current()&&revision==started&&!dirty){rules=fetched;loaded=true}
    }catch(e:CancellationException){throw e}
    catch(e:Exception){if(current())message=e.message.orEmpty()}
    finally{if(attached[0]&&draftOwner==owner)busy=false}}
  }}){Text("Mail settings & sync")}
 if(open)AlertDialog(onDismissRequest={if(!busy)open=false},title={Text("Mail settings")},text={Column {
  state.snapshots["mail"]?.let{JSONObject(it).optJSONArray("accounts").objects().forEach{a->Text("${a.optString("account")} · ${if(!a.isNull("error"))a.optString("error") else a.optString("last_success","Not synced")}",style=MaterialTheme.typography.bodySmall)}}
   OutlinedTextField(rules,{rules=it.take(4000);dirty=true;revision++},label={Text("Importance rules")},enabled=loaded&&!busy,minLines=3,maxLines=7)
   TextButton(onClick={if(api!=null&&current()){busy=true;scope.launch{try{api("/api/v1/mail/refresh",JSONObject());if(current())message="Mail sync queued. Refresh to retrieve results."}catch(e:CancellationException){throw e}catch(e:Exception){if(current())message=e.message.orEmpty()}finally{if(attached[0]&&draftOwner==owner)busy=false}}}},enabled=state.signedIn&&!busy&&api!=null){Text("Sync mail")}
  if(message.isNotBlank())Text(message,style=MaterialTheme.typography.bodySmall)
  }},confirmButton={TextButton(onClick={if(api!=null&&current()){
    val submitted=rules;val started=revision;busy=true
    scope.launch{try{
      api("/api/v1/mail/preferences",JSONObject().put("rules",submitted))
      if(!current())return@launch
      check(api("/api/v1/mail/preferences",null).getString("rules")==submitted){"Could not confirm rules"}
      if(current()&&revision==started&&rules==submitted){dirty=false;message="Rules saved."}
    }catch(e:CancellationException){throw e}
    catch(e:Exception){if(current())message=e.message.orEmpty()}
    finally{if(attached[0]&&draftOwner==owner)busy=false}}
  }},enabled=loaded&&!busy&&state.signedIn&&api!=null){Text("Save rules")}},dismissButton={TextButton(onClick={open=false},enabled=!busy){Text("Close")}})
  }
}
@Composable fun MailAttachments(message:JSONObject,model:WorkspaceModel?) {
 val context=LocalContext.current;val scope=rememberCoroutineScope();var part by rememberSaveable{mutableStateOf("")};var busy by remember{mutableStateOf(false)};var notice by remember{mutableStateOf("")}
 val picker=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")){uri->if(uri!=null&&model!=null){busy=true;scope.launch{try{val bytes=model.attachment(message.getString("id"),part);withContext(Dispatchers.IO){context.contentResolver.openOutputStream(uri)?.use{it.write(bytes)}?:error("Cannot write selected file")};notice="Attachment saved."}catch(e:Exception){notice=e.message?:"Download failed"}finally{busy=false}}}}
 message.optJSONArray("attachments").objects().forEach{a->TextButton(onClick={part=a.getString("part");picker.launch(a.optString("name","attachment").substringAfterLast('/').substringAfterLast('\\'))},enabled=model!=null&&!busy){Text(a.optString("name","Download attachment"))}}
 if(busy)LinearProgressIndicator(Modifier.fillMaxWidth().padding(4.dp));if(notice.isNotBlank())Text(notice,style=MaterialTheme.typography.bodySmall)
}
