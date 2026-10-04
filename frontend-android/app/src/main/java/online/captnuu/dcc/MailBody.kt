package online.captnuu.dcc
import androidx.compose.material3.*
import androidx.compose.runtime.*
import org.json.JSONObject
@Composable fun MailBody(data:JSONObject,model:WorkspaceModel?){
 val id=data.optString("id");var body by remember(id){mutableStateOf(data.optString("body").takeIf{data.has("body")})};var error by remember(id){mutableStateOf("")};var original by remember(id){mutableStateOf(false)};var retry by remember(id){mutableIntStateOf(0)}
 LaunchedEffect(id,retry){if(body==null&&model!=null)try{body=model.mailBody(id);error=""}catch(e:Exception){error=e.message?:"Message is not cached. Reconnect to load it."}}
 if(body!=null){TextButton(onClick={original=!original}){Text(if(original)"Readable spacing" else "Original text")};Text(if(original)body!! else readableMail(body!!),style=MaterialTheme.typography.bodyMedium)}else if(error.isNotBlank()){Text(error,style=MaterialTheme.typography.bodySmall);TextButton(onClick={retry++}){Text("Retry")}}else Text("Loading message…")
}
