package online.captnuu.dcc
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalUriHandler
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.math.BigDecimal

fun targetCents(text:String):Int?=runCatching{BigDecimal(text).movePointRight(2).intValueExact().takeIf{it in 1..10000000}}.getOrNull()
@Composable fun PriceControls(item:JSONObject,snapshot:JSONObject,model:WorkspaceModel?,enabled:Boolean){
 var open by rememberSaveable(item.optString("id")){mutableStateOf(false)};var history by rememberSaveable{mutableStateOf(false)}
 var target by rememberSaveable(item.optString("id")){mutableStateOf(BigDecimal(item.optInt("target_cents")).movePointLeft(2).toPlainString())};var paused by rememberSaveable(item.optString("id")){mutableStateOf(item.optBoolean("paused"))}
 var busy by remember{mutableStateOf(false)};var message by remember{mutableStateOf("")};val scope=rememberCoroutineScope()
 Row{TextButton(onClick={open=true}){Text("Settings")};TextButton(onClick={history=!history}){Text(if(history)"Hide history" else "History")}}
 if(history)snapshot.optJSONArray("history").objects().filter{it.optString("item_id")==item.optString("id")}.take(30).forEach{row->Text(row.optString("store")+" · "+row.optString("observed_at"),style=MaterialTheme.typography.labelMedium);row.optJSONObject("data")?.optJSONArray("offers").objects().forEach{offer->Text(offer.optString("condition")+" · $"+BigDecimal(offer.optInt("cents")).movePointLeft(2).toPlainString(),style=MaterialTheme.typography.bodySmall)}}
 if(open)AlertDialog(onDismissRequest={if(!busy)open=false},title={Text("Price watch")},text={Column{
  OutlinedTextField(target,{target=it},label={Text("Target price ($)")},singleLine=true,enabled=!busy)
  Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Checkbox(paused,{paused=it},enabled=!busy);Text("Paused")}
  TextButton(onClick={busy=true;scope.launch{try{message=model!!.api("/api/v1/prices/refresh",JSONObject()).optString("note");model.refresh()}catch(e:Exception){message=e.message.orEmpty()}finally{busy=false}}},enabled=enabled&&model!=null&&!busy){Text("Check prices now")}
  if(message.isNotBlank())Text(message,style=MaterialTheme.typography.bodySmall)
 }},confirmButton={TextButton(onClick={busy=true;scope.launch{try{model!!.api("/api/v1/prices/settings",JSONObject().put("id",item.getString("id")).put("targetCents",targetCents(target)).put("paused",paused));val saved=model.api("/api/v1/prices/snapshot").getJSONArray("items").objects().first{it.getString("id")==item.getString("id")};check(saved.getInt("target_cents")==targetCents(target)&&saved.getBoolean("paused")==paused){"Settings could not be confirmed"};model.refresh();open=false}catch(e:Exception){message=e.message.orEmpty()}finally{busy=false}}},enabled=enabled&&model!=null&&!busy&&targetCents(target)!=null){Text("Save")}},dismissButton={TextButton(onClick={open=false},enabled=!busy){Text("Cancel")}})
}
@Composable fun RetailerLink(url:String){val uri=LocalUriHandler.current;val parsed=runCatching{java.net.URI(url)}.getOrNull();if(parsed?.scheme=="https"&&parsed.host!=null)TextButton(onClick={uri.openUri(url)}){Text("Open retailer")}}
