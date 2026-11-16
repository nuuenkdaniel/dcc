package online.captnuu.dcc
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun PendingEdits(state:WorkspaceState,model:WorkspaceModel?){
 var open by remember{mutableStateOf(false)};var discard by remember{mutableStateOf<String?>(null)};var notice by remember{mutableStateOf("")};val scope=rememberCoroutineScope()
 TextButton(onClick={open=true}){Text("Previous device drafts (${state.legacyDrafts.size})")}
 if(open)AlertDialog(onDismissRequest={open=false},title={Text("Previous device drafts")},text={LazyColumn(Modifier.heightIn(max=400.dp)){
  item{Text("These drafts came from the previous version. Open a draft to copy its details and review the current server record before saving.",style=MaterialTheme.typography.bodySmall)}
  items(state.legacyDrafts){raw->val entry=JSONObject(raw);var details by remember{mutableStateOf(false)};val body=entry.getJSONObject("body");Text(body.optJSONObject("data")?.optString("title")?:body.optString("title"),style=MaterialTheme.typography.titleSmall)
   if(entry.has("error"))Text(entry.getString("error"),style=MaterialTheme.typography.bodySmall)
   TextButton(onClick={details=!details}){Text("Review retained draft")};if(details)SelectionContainer{Text(body.toString(2),style=MaterialTheme.typography.bodySmall)}
   TextButton(onClick={discard=entry.getString("key")}){Text("Discard draft")}
  }
  if(notice.isNotBlank())item{Text(notice)}
 }},confirmButton={TextButton(onClick={open=false}){Text("Close")}})
 discard?.let{key->AlertDialog(onDismissRequest={discard=null},title={Text("Discard unsent edit?")},text={Text("This removes the retained draft, not the server record.")},confirmButton={TextButton(onClick={scope.launch{try{model?.discardLegacyDraft(key);discard=null}catch(e:Exception){notice=e.message.orEmpty()}}}){Text("Discard")}},dismissButton={TextButton(onClick={discard=null}){Text("Cancel")}})}
}
