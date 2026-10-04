package online.captnuu.dcc

import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import org.json.JSONObject
import org.json.JSONArray
import java.time.LocalDate
import java.util.Locale

enum class Destination(val label:String,val description:String) {
 Today("Today","Daily actions and calendar connection"), Inbox("Inbox","Email connection"),
 Focus("Focus","Local focus session; no connection required"), Projects("Projects","Project connection"), Prices("Prices","Price connection")
}
fun JSONArray?.objects():List<JSONObject> = if(this==null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
@Composable fun DccTheme(content:@Composable ()->Unit) {
 val context=androidx.compose.ui.platform.LocalContext.current
 val prefs=remember{context.getSharedPreferences("dcc-preferences",0)}
 var preference by remember{mutableStateOf(prefs.getString("theme","dark")?:"dark")}
 DisposableEffect(prefs){val listener=android.content.SharedPreferences.OnSharedPreferenceChangeListener{_,key->if(key=="theme")preference=prefs.getString("theme","dark")?:"dark"};prefs.registerOnSharedPreferenceChangeListener(listener);onDispose{prefs.unregisterOnSharedPreferenceChangeListener(listener)}}
 val dark=preference=="dark"||(preference=="system"&&androidx.compose.foundation.isSystemInDarkTheme())
 MaterialTheme(colorScheme=if(dark)darkColorScheme(primary=Color(0xFFB4A5F5),background=Color(0xFF10111D),surface=Color(0xFF191A2A),onSurface=Color(0xFFE7E8F1)) else lightColorScheme(primary=Color(0xFF6750A4)),content=content)
}
@Composable fun DccApp(model:WorkspaceModel=viewModel()) {
 val state by model.state.collectAsStateWithLifecycle()
 Workspace(state,model::signIn,model::refresh,model::signOut,model::complete,model::feedback,projectModel=model)
}
@Composable fun Workspace(state:WorkspaceState,onLogin:(String,String)->Unit,onRefresh:()->Unit,onLogout:()->Unit,onComplete:(JSONObject,Boolean)->Unit,onFeedback:(String,Boolean)->Unit,initialDestination:Destination=Destination.Today,projectModel:WorkspaceModel?=null) {
 var selected by rememberSaveable { mutableStateOf(initialDestination.name) }
 var settings by rememberSaveable { mutableStateOf(false) }
 var local by rememberSaveable { mutableStateOf(false) }
 val destination=Destination.valueOf(selected)
 Scaffold(bottomBar={Column {
  NavigationBar { Destination.entries.forEach { item ->
   val icon=when(item) { Destination.Today->Icons.Default.Home;Destination.Inbox->Icons.Default.Email;Destination.Focus->Icons.Default.PlayArrow;Destination.Projects->Icons.AutoMirrored.Filled.List;Destination.Prices->Icons.Default.ShoppingCart }
   NavigationBarItem(selected=destination==item,onClick={selected=item.name},icon={Icon(icon,null)},label={Text(item.label)})
  }
 }}}) { padding ->
  Column(Modifier.fillMaxSize().padding(padding).padding(horizontal=20.dp)) {
   Row(Modifier.fillMaxWidth().padding(vertical=8.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
    Text(destination.label,style=MaterialTheme.typography.headlineSmall,modifier=Modifier.weight(1f))
    IconButton(onClick=onRefresh,enabled=(state.signedIn||state.restorePending)&&!state.busy){Icon(Icons.Default.Refresh,"Refresh")}
    IconButton(onClick={settings=true}){Icon(Icons.Default.Settings,"Settings")}
   }
   if(!androidx.compose.ui.platform.LocalInspectionMode.current)UpdateControl(compact=true)
   if(state.notice!="Workspace refreshed" && state.notice!="Signed in") Text(state.notice,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
   if(state.busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical=8.dp))
   if(state.restoring) {
    Text("Checking saved sign-in…")
   } else if(state.restorePending&&!local&&!state.signedIn) {
    Button(onClick=onRefresh,enabled=!state.busy){Text("Retry connection")}
    TextButton(onClick=onLogout,enabled=!state.busy){Text("Forget saved sign-in")}
    TextButton(onClick={local=true}){Text("Continue locally")}
   } else if(!state.signedIn&&!local&&destination!=Destination.Focus) {
    LoginForm(state.busy,onLogin);TextButton(onClick={local=true}) { Text("Continue locally") }
   } else when(destination) {
    Destination.Focus->FocusScreen()
    Destination.Today->TodayScreen(state,onComplete,projectModel)
    Destination.Inbox->InboxScreen(state,onFeedback,projectModel)
    Destination.Projects->ProjectPage(state,projectModel,onRefresh,onComplete)
    Destination.Prices->PricesScreen(state,projectModel)
   }
  }
 }
 if(settings) AlertDialog(onDismissRequest={settings=false},title={Text("Settings")},text={Column {
  Text("Server: dcc.home.captnuu.online")
  Text("Session and cached workspace data are encrypted on this phone. Session expiry is set by the server; the next backend release supports 30 days. Passwords are never saved.")
  AppearanceControl()
  TaskBackup()
  UpdateControl()
  PendingEdits(state,projectModel)
 }},confirmButton={TextButton(onClick={settings=false}){Text("Done")}},dismissButton={TextButton(onClick={if(state.signedIn||state.restorePending)onLogout();local=false;settings=false}){Text(if(state.signedIn)"Sign out" else "Sign in")}})
}
@Composable private fun LoginForm(busy:Boolean,onLogin:(String,String)->Unit) {
 var username by rememberSaveable { mutableStateOf("") };var password by remember { mutableStateOf("") }
 Column(verticalArrangement=Arrangement.spacedBy(12.dp),modifier=Modifier.padding(vertical=20.dp)) {
  OutlinedTextField(username,{username=it},label={Text("Username")},singleLine=true,modifier=Modifier.fillMaxWidth())
  OutlinedTextField(password,{password=it},label={Text("Password")},singleLine=true,visualTransformation=PasswordVisualTransformation(),modifier=Modifier.fillMaxWidth())
  Button(onClick={onLogin(username,password);password=""},enabled=!busy&&username.isNotBlank()&&password.isNotEmpty(),modifier=Modifier.fillMaxWidth()){Text("Sign in")}
 }
}
private fun snapshot(state:WorkspaceState,name:String)=workspaceSnapshot(state,name)
@Composable private fun InfoCard(title:String,body:String,extra:@Composable ColumnScope.()->Unit={}) {
 OutlinedCard(Modifier.fillMaxWidth().padding(vertical=6.dp)) { Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) { Text(title,style=MaterialTheme.typography.titleMedium);if(body.isNotBlank())Text(body);extra() } }
}
@Composable private fun TodayScreen(state:WorkspaceState,onComplete:(JSONObject,Boolean)->Unit,model:WorkspaceModel?) {
 var date by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
 var tasksVisible by rememberSaveable { mutableStateOf(false) }
 var month by rememberSaveable { mutableStateOf(java.time.YearMonth.now().toString()) }
 val planner=snapshot(state,"planner")
 val actions=planner.optJSONArray("actions").objects().filter { it.getJSONObject("data").optString("date")==date&&!it.getJSONObject("data").optBoolean("dismissed") }
 val groups=actions.groupBy { entry -> val d=entry.getJSONObject("data");d.optString("preparationId").takeIf{it.isNotBlank()} ?: if(d.optBoolean("assignmentStep"))d.optString("projectId") else d.optString("id") }
 Column(Modifier.fillMaxSize()) {
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
   FilterChip(selected=!tasksVisible,onClick={tasksVisible=false},label={Text("Calendar")},modifier=Modifier.weight(1f))
   FilterChip(selected=tasksVisible,onClick={tasksVisible=true},label={Text("Tasks")},modifier=Modifier.weight(1f))
  }
  key(tasksVisible) {
 LazyColumn(modifier=Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp),contentPadding=PaddingValues(bottom=20.dp)) {
  if(!tasksVisible) item { CalendarControls(state,date,model) }
  if(!tasksVisible) item { MonthCalendar(date,month,{date=it},{month=it}) }
  item { Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
   IconButton(onClick={date=LocalDate.parse(date).minusDays(1).toString()}){Icon(Icons.Default.KeyboardArrowLeft,"Previous day")}
   TextButton(onClick={date=LocalDate.now().toString()},modifier=Modifier.weight(1f)) { Text(LocalDate.parse(date).format(java.time.format.DateTimeFormatter.ofPattern("EEE, MMM d"))) }
   IconButton(onClick={date=LocalDate.parse(date).plusDays(1).toString()}){Icon(Icons.Default.KeyboardArrowRight,"Next day")}
  } }
  if(tasksVisible) {
  item { Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
   Text("Tasks",style=MaterialTheme.typography.titleMedium)
  } }
  item { ManualTasks(date,model) }
  if(actions.isEmpty())item { Text("No actions for this day",style=MaterialTheme.typography.bodyMedium,modifier=Modifier.padding(vertical=24.dp)) }
  items(groups.entries.toList(),key={it.key}) { group ->
   val first=group.value.first().getJSONObject("data")
   val preparation=first.optString("preparationId")
   val grouped=preparation.isNotBlank()||first.optBoolean("assignmentStep")
   val source=planner.optJSONArray(if(preparation.isNotBlank())"preparations" else "projects").objects().firstOrNull{it.getJSONObject("data").optString("id")==if(preparation.isNotBlank())preparation else first.optString("projectId")}?.getJSONObject("data")
   var expanded by rememberSaveable(group.key,date){mutableStateOf(false)}
   Card(colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surface),modifier=Modifier.fillMaxWidth()) {
    Column(Modifier.padding(12.dp)) {
     if(grouped) {
      TextButton(onClick={expanded=!expanded},contentPadding=PaddingValues(horizontal=12.dp,vertical=12.dp),shape=androidx.compose.foundation.shape.RoundedCornerShape(8.dp),modifier=Modifier.fillMaxWidth()) {
       Column(Modifier.weight(1f)) {
        Text(source?.optString("title")?:"Planned work",style=MaterialTheme.typography.titleSmall,color=MaterialTheme.colorScheme.onSurface,modifier=Modifier.fillMaxWidth())
        Text("${group.value.size} steps · ${group.value.sumOf{it.getJSONObject("data").optInt("minutes")}} min",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.fillMaxWidth())
       }
       Icon(if(expanded)Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,if(expanded)"Collapse steps" else "Expand steps")
      }
     }
     if(!grouped||expanded)group.value.forEach { entry ->
      val d=entry.getJSONObject("data")
      var details by rememberSaveable(d.getString("id")){mutableStateOf(false)}
      Row(verticalAlignment=androidx.compose.ui.Alignment.Top) {
       Checkbox(d.optBoolean("completed"),{onComplete(entry,it)},enabled=(state.signedIn||state.restorePending)&&!state.busy&&!entry.optBoolean("pending"))
       Column(Modifier.weight(1f).padding(top=10.dp)) {
        Text(d.optString("title"),style=MaterialTheme.typography.bodyMedium)
        Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
         Text("${d.optInt("minutes")} min",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
         TextButton(onClick={details=!details}){Text(if(details)"Hide details" else "Details",style=MaterialTheme.typography.labelMedium)}
        }
        if(details){Text(d.optString("notes"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(bottom=12.dp));ActionControls(entry,model)}
       }
      }
     }
    }
   }
  }
  } else {
  item { Text("Schedule",style=MaterialTheme.typography.titleMedium,modifier=Modifier.padding(top=12.dp)) }
  val events=snapshot(state,"calendar").optJSONArray("events").objects().filter { eventOnDay(it.optString("start"),it.optString("end"),it.optBoolean("allDay"),LocalDate.parse(date),java.time.ZoneId.systemDefault()) }.sortedBy{it.optString("start")}
  if(events.isEmpty())item { Text("No events loaded for this day",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
  items(events) { event -> InfoCard(event.optString("title",event.optString("summary")),eventTimeLabel(event)){EventActions(state,event,model)} }

 }
}
 }
 }
 }

@Composable private fun InboxScreen(state:WorkspaceState,onFeedback:(String,Boolean)->Unit,model:WorkspaceModel?) {
 var search by rememberSaveable { mutableStateOf("") };var account by rememberSaveable { mutableStateOf("all") };var important by rememberSaveable { mutableStateOf(false) }
 Column {
  OutlinedTextField(search,{search=it},label={Text("Search email")},modifier=Modifier.fillMaxWidth())
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(4.dp)) {
   listOf("all","personal","school","work").forEach { a ->
    TextButton(
     onClick={account=a},
     modifier=Modifier.weight(1f).semantics { selected = a==account },
     shape=androidx.compose.foundation.shape.CircleShape,
     contentPadding=PaddingValues(horizontal=4.dp,vertical=8.dp),
     colors=ButtonDefaults.textButtonColors(
      containerColor=if(a==account)MaterialTheme.colorScheme.primary else Color.Transparent,
      contentColor=if(a==account)MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.primary
     )
    ){Text(a)}
   }
  }
  Row(
   modifier=Modifier.fillMaxWidth().then(Modifier.toggleable(
    value=important,onValueChange={important=it},role=androidx.compose.ui.semantics.Role.Checkbox
   )).padding(vertical=4.dp),
   verticalAlignment=androidx.compose.ui.Alignment.CenterVertically
  ) {
   Checkbox(checked=important,onCheckedChange=null,modifier=Modifier.size(48.dp))
   Text("Important only",modifier=Modifier.weight(1f))
  }
  Row{TextButton(onClick={model?.loadMoreMail(search,account,important)},enabled=state.signedIn&&!state.busy){Text("Search all mail")};TextButton(onClick={search="";account="all";important=false;model?.loadMoreMail("","all",false)},enabled=state.signedIn&&!state.busy){Text("Reset")}}
  MailControls(state,model)
  val messages=snapshot(state,"mail").optJSONArray("messages").objects().filter { m -> val d=m.getJSONObject("data");(account=="all"||d.optString("account")==account)&&(d.optString("subject")+d.optString("sender")).contains(search,true)&&(!important||if(!m.isNull("override"))m.optBoolean("override") else m.optJSONObject("analysis")?.optBoolean("important")==true) }
  LazyColumn {
  item { Text("Daily brief",style=MaterialTheme.typography.titleMedium,modifier=Modifier.padding(top=16.dp));Text("Important email received today · Eastern time",style=MaterialTheme.typography.bodySmall) }
  val brief=(snapshot(state,"mail").optJSONArray("briefing")?:snapshot(state,"mail").optJSONArray("messages")).objects().filter { m -> receivedEasternToday(m.getJSONObject("data").optString("receivedAt")) && (if(!m.isNull("override"))m.optBoolean("override") else m.optJSONObject("analysis")?.optBoolean("important")==true) }
  if(brief.isEmpty())item { Text("No important email loaded for today.",style=MaterialTheme.typography.bodySmall) }
  items(brief,key={"brief-"+it.getJSONObject("data").getString("id")}) { m ->val d=m.getJSONObject("data");InfoCard(d.optString("subject"),d.optString("account")) { Text(m.optJSONObject("analysis")?.optString("summary")?.takeIf{it.isNotBlank()}?:"Marked important. Open Inbox to read the message.",style=MaterialTheme.typography.bodyMedium) } }
   item { Text("All emails",style=MaterialTheme.typography.titleMedium,modifier=Modifier.padding(top=16.dp)) }
   item{Text("${snapshot(state,"mail").optJSONArray("messages")?.length()?:0} cached of ${snapshot(state,"mail").optInt("total")} messages · filters above search cached metadata",style=MaterialTheme.typography.bodySmall)}
   if(messages.isEmpty())item { Text("No matching cached messages. Use Search all mail when online.") }
   if(!snapshot(state,"mail").isNull("nextCursor"))item{TextButton(onClick={model?.loadMoreMail()},enabled=state.signedIn&&!state.busy){Text("Load older messages")}}
   items(messages,key={it.getJSONObject("data").getString("id")}) { m -> val d=m.getJSONObject("data");var open by rememberSaveable(d.getString("id")) { mutableStateOf(false) }
    InfoCard(d.optString("subject"),d.optString("account")+" · "+d.optString("sender")) {
     TextButton(onClick={open=!open}){Text(if(open)"Close" else "Read message")}
     if(open) { MailBody(d,model);Row { TextButton(onClick={onFeedback(d.getString("id"),true)},enabled=!state.busy){Text("Important")};TextButton(onClick={onFeedback(d.getString("id"),false)},enabled=!state.busy){Text("Not important")} };if((d.optJSONArray("attachments")?.length()?:0)>0)MailAttachments(d,model) }
    }
   }
  }
 }
}
@Composable private fun PricesScreen(state:WorkspaceState,model:WorkspaceModel?) {
 var used by rememberSaveable {mutableStateOf(false)}
 val data=snapshot(state,"prices")
 LazyColumn {
  item { Row { FilterChip(!used,{used=false},label={Text("New")});Spacer(Modifier.width(8.dp));FilterChip(used,{used=true},label={Text("Open-box")}) } }
  items(data.optJSONArray("items").objects()) { item ->
   InfoCard(item.optString("title"),"Target below "+String.format(Locale.US,"$%.2f",item.optInt("target_cents")/100.0)) {
    PriceControls(item,data,model,state.signedIn&&!state.busy)
    data.optJSONArray("sources").objects().filter{it.optString("item_id")==item.optString("id")}.forEach { source ->
     Text(source.optString("store")+" · "+source.optString("status"))
     source.optJSONObject("last_good")?.let { good ->Text("Observed "+good.optString("observedAt"));good.optJSONArray("offers").objects().filter { (it.optString("condition")!="new")==used }.forEach { offer ->Text(String.format(Locale.US,"$%.2f",offer.optInt("cents")/100.0));Text(offer.optString("availability"));RetailerLink(offer.optString("url")) } }
     var details by rememberSaveable(source.optString("item_id"),source.optString("store")){mutableStateOf(false)}
     TextButton(onClick={details=!details}){Text(if(details)"Hide verification" else "Verification details")}
     if(details)Text(source.optString("detail"),style=MaterialTheme.typography.bodySmall)
    }
   }
  }
  item { Text("Cached prices · confirm delivery before buying",style=MaterialTheme.typography.bodySmall) }
 }
}
@Composable private fun FocusScreen(model:TimerModel?=if(androidx.compose.ui.platform.LocalInspectionMode.current)null else viewModel()) {
 val timer = model?.state?.collectAsStateWithLifecycle()?.value ?: TimerState()
 val timerLifecycle=androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
 LaunchedEffect(model,timerLifecycle){timerLifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED){if(model!=null)while(true){model.refreshDisplay();delay(1000)}}}
 var setup by rememberSaveable {mutableStateOf(false)}
 Column(Modifier.fillMaxWidth().padding(vertical=24.dp),horizontalAlignment=androidx.compose.ui.Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(20.dp)) {
  Text(timer.label,style=MaterialTheme.typography.titleLarge)
  Text(String.format(Locale.US,"%02d:%02d",timer.remaining/60,timer.remaining%60),style=MaterialTheme.typography.displayLarge)
  if(timer.steps.isNotEmpty()&&!timer.onBreak)Text("${timer.index+1} of ${timer.steps.size}",style=MaterialTheme.typography.labelMedium)
  Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
   Button(onClick={model?.toggle()}){Text(if(timer.running)"Pause" else "Start")}
   OutlinedButton(onClick={model?.reset()}){Text("Reset")}
  }
  TextButton(onClick={if(timer.running)model?.toggle();setup=true}){Text("Timer settings")}
  if(timer.steps.isNotEmpty())LazyColumn {items(timer.steps.withIndex().toList()){(i,step)->ListItem(headlineContent={Text(step.name)},supportingContent={Text("${step.minutes} min")},trailingContent={Text(if(!timer.onBreak&&i==timer.index)"Current" else if(timer.onBreak||i<timer.index)"Done" else "")})}}
  TimerPermissions()
 }
 if(setup)TimerSetup(timer,{setup=false},{f,b,steps->model?.configure(f,b,steps);setup=false})
}
@Composable private fun TimerSetup(timer:TimerState,dismiss:()->Unit,save:(Int,Int,List<FocusStep>)->Unit) {
 var focus by remember {mutableStateOf(timer.focus.toString())};var rest by remember {mutableStateOf(timer.rest.toString())}
 var steps by remember {mutableStateOf(timer.steps)};var name by remember {mutableStateOf("")};var minutes by remember {mutableStateOf("15")}
 AlertDialog(onDismissRequest=dismiss,title={Text("Timer settings")},text={
  LazyColumn(verticalArrangement=Arrangement.spacedBy(8.dp)) {
   item {OutlinedTextField(focus,{focus=it},label={Text("Focus minutes (1–180)")},singleLine=true)}
   item {OutlinedTextField(rest,{rest=it},label={Text("Break minutes (1–60)")},singleLine=true)}
   item {Text("Optional focus sequence",style=MaterialTheme.typography.titleSmall)}
   items(steps.withIndex().toList()){(i,step)->Column {
    Text("${step.name} · ${step.minutes} min")
    Row {TextButton(onClick={steps=steps.toMutableList().apply{add(i-1,removeAt(i))}},enabled=i>0){Text("Up")};TextButton(onClick={steps=steps.toMutableList().apply{add(i+1,removeAt(i))}},enabled=i<steps.lastIndex){Text("Down")};TextButton(onClick={steps=steps.filterIndexed{n,_->n!=i}}){Text("Remove")}}
   }}
   item {OutlinedTextField(name,{name=it},label={Text("Mini timer name")},singleLine=true)}
   item {OutlinedTextField(minutes,{minutes=it},label={Text("Minutes (1–120)")},singleLine=true)}
   item {TextButton(onClick={steps=steps+FocusStep(name.trim(),minutes.toInt());name=""},enabled=name.isNotBlank()&&minutes.toIntOrNull() in 1..120&&steps.size<20){Text("Add mini timer")}}
  }
 },confirmButton={TextButton(onClick={save(focus.toInt(),rest.toInt(),steps)},enabled=focus.toIntOrNull() in 1..180&&rest.toIntOrNull() in 1..60){Text("Save & reset")}},dismissButton={TextButton(onClick=dismiss){Text("Cancel")}})
}
@Preview(showBackground=true,widthDp=393,heightDp=852)
@Composable private fun PhonePreview(){DccTheme { Workspace(WorkspaceState(),{_,_->},{},{},{_,_->},{_,_->}) }}
@Preview(showBackground=true,widthDp=800,heightDp=600,fontScale=1.3f)
@Composable private fun LargeTextPreview(){DccTheme { Workspace(WorkspaceState(),{_,_->},{},{},{_,_->},{_,_->}) }}

@Preview(showBackground=true,widthDp=393,heightDp=852)
@Composable private fun FocusPreview(){DccTheme { Workspace(WorkspaceState(),{_,_->},{},{},{_,_->},{_,_->},Destination.Focus) }}
@Preview(showBackground=true,widthDp=393,heightDp=852)
@Composable private fun InboxPreview(){DccTheme { Workspace(WorkspaceState(signedIn=true,notice="Preview — no messages loaded"),{_,_->},{},{},{_,_->},{_,_->},Destination.Inbox) }}
@Preview(showBackground=true,widthDp=393,heightDp=852)
@Composable private fun PricesPreview(){DccTheme { Workspace(WorkspaceState(signedIn=true,notice="Preview — no observations loaded"),{_,_->},{},{},{_,_->},{_,_->},Destination.Prices) }}
