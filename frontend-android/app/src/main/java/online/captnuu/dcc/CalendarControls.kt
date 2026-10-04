package online.captnuu.dcc
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.*
import java.util.UUID

fun calendarInstant(value:String,allDay:Boolean):String=if(allDay)LocalDate.parse(value).toString() else LocalDateTime.parse(value).atZone(ZoneId.systemDefault()).toInstant().toString()
@Composable fun CalendarControls(state:WorkspaceState,date:String,model:WorkspaceModel?) {
 var open by rememberSaveable{mutableStateOf(false)};var message by remember{mutableStateOf("")};val scope=rememberCoroutineScope();var busy by remember{mutableStateOf(false)}
 Row{TextButton(onClick={open=true},enabled=model!=null){Text("New event")};TextButton(onClick={busy=true;scope.launch{try{model!!.api("/api/v1/calendar/refresh",JSONObject());model.refresh();message="Calendar sync requested."}catch(e:Exception){message=e.message.orEmpty()}finally{busy=false}}},enabled=model!=null&&!busy){Text("Sync calendar")}}
 if(message.isNotBlank())Text(message,style=MaterialTheme.typography.bodySmall)
 if(open)EventEditor(state,date,null,model!!){open=false}
}
@Composable fun EventActions(state:WorkspaceState,event:JSONObject,model:WorkspaceModel?){
 var edit by rememberSaveable(event.optString("id")){mutableStateOf(false)};var prepare by rememberSaveable(event.optString("id")){mutableStateOf(false)}
 Row{TextButton(onClick={edit=true},enabled=model!=null){Text("Edit event")};TextButton(onClick={prepare=true},enabled=model!=null){Text("Prepare")}}
 if(edit)EventEditor(state,event.optString("start").take(10),event,model!!){edit=false}
 if(prepare)StudyEditor(state,event,model!!){prepare=false}
}
@Composable private fun EventEditor(state:WorkspaceState,date:String,event:JSONObject?,model:WorkspaceModel,dismiss:()->Unit){
 val calendars=state.snapshots["calendar"]?.let{JSONObject(it).optJSONArray("calendars").objects()}.orEmpty()
 var title by rememberSaveable{mutableStateOf(event?.optString("title")?:"")};var description by rememberSaveable{mutableStateOf(event?.optString("description")?:"")};var location by rememberSaveable{mutableStateOf(event?.optString("location")?:"")}
 var allDay by rememberSaveable{mutableStateOf(event?.optBoolean("allDay")?:false)}
 fun local(value:String)=runCatching{Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDateTime().toString()}.getOrDefault(value)
 var start by rememberSaveable{mutableStateOf(event?.optString("start")?.let{if(allDay)it else local(it)}?:"${date}T09:00")}
 var end by rememberSaveable{mutableStateOf(event?.optString("end")?.let{if(allDay)it else local(it)}?:"${date}T10:00")}
 var calendar by rememberSaveable{mutableStateOf(event?.optString("calendarId")?:calendars.firstOrNull()?.optString("id").orEmpty())}
 var mutation by rememberSaveable{mutableStateOf(UUID.randomUUID().toString())};var error by rememberSaveable{mutableStateOf("")};var busy by remember{mutableStateOf(false)};var confirm by remember{mutableStateOf(false)};val scope=rememberCoroutineScope()
 fun save(delete:Boolean=false){busy=true;scope.launch{try{
  val from=calendarInstant(start,allDay);val to=calendarInstant(end,allDay);require(title.isNotBlank()&&calendar.isNotBlank()&&(if(allDay)LocalDate.parse(to)>LocalDate.parse(from) else Instant.parse(to)>Instant.parse(from))){"Choose a calendar, title and an end after the start."}
  val body=JSONObject().put("id",mutation).put("calendarId",calendar).put("title",title).put("description",description).put("location",location).put("start",from).put("end",to).put("allDay",allDay)
  event?.let{body.put("eventId",it.getString("id")).put("etag",it.optString("etag"))};if(delete)body.put("operation","delete")
  model.mutate("/api/v1/calendar/changes",body);model.refresh();dismiss()
 }catch(e:Exception){error=e.message?:"Save failed; draft retained"}finally{busy=false}}}
 Dialog(onDismissRequest={if(!busy)dismiss()},properties=DialogProperties(usePlatformDefaultWidth=false)){Surface(Modifier.fillMaxSize()){Column(Modifier.safeDrawingPadding().padding(16.dp)){
  Text(if(event==null)"New event" else "Edit event",style=MaterialTheme.typography.titleLarge)
  LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(8.dp)){
   if(event==null)items(calendars){c->FilterChip(calendar==c.optString("id"),{calendar=c.optString("id");mutation=UUID.randomUUID().toString()},label={Text(c.optString("name",c.optString("id")))})}
   item{OutlinedTextField(title,{title=it.take(500);mutation=UUID.randomUUID().toString()},label={Text("Title")},enabled=!busy,modifier=Modifier.fillMaxWidth())}
   item{Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Checkbox(allDay,{checked->allDay=checked;start=if(checked)start.take(10) else start.take(10)+"T09:00";end=if(checked)LocalDate.parse(start.take(10)).plusDays(1).toString() else start.take(10)+"T10:00";mutation=UUID.randomUUID().toString()},enabled=!busy);Text("All day")}}
   item{OutlinedTextField(start,{start=it;mutation=UUID.randomUUID().toString()},label={Text(if(allDay)"Start · YYYY-MM-DD" else "Start · YYYY-MM-DDTHH:MM")},enabled=!busy,modifier=Modifier.fillMaxWidth())}
   item{OutlinedTextField(end,{end=it;mutation=UUID.randomUUID().toString()},label={Text(if(allDay)"End date (exclusive)" else "End · local date and time")},enabled=!busy,modifier=Modifier.fillMaxWidth())}
   item{OutlinedTextField(location,{location=it.take(1000);mutation=UUID.randomUUID().toString()},label={Text("Location")},enabled=!busy,modifier=Modifier.fillMaxWidth())}
   item{OutlinedTextField(description,{description=it.take(20000);mutation=UUID.randomUUID().toString()},label={Text("Description")},enabled=!busy,modifier=Modifier.fillMaxWidth(),maxLines=8)}
   if(event!=null)item{TextButton(onClick={confirm=true},enabled=!busy){Text("Delete this occurrence")}}
   if(error.isNotBlank())item{Text(error,color=MaterialTheme.colorScheme.error)}
  }
  Row{TextButton(onClick=dismiss,enabled=!busy){Text("Cancel")};Button(onClick={save()},enabled=!busy){Text("Save")}}
 }}}
 if(confirm)AlertDialog(onDismissRequest={confirm=false},title={Text("Delete event?")},text={Text("Only this occurrence is cancelled. Other recurring occurrences are preserved.")},confirmButton={TextButton(onClick={confirm=false;save(true)}){Text("Delete")}},dismissButton={TextButton(onClick={confirm=false}){Text("Cancel")}})
}
