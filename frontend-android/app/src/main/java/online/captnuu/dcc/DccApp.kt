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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
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
 Focus("Focus","Local focus session; no connection required"), Projects("Projects","Project connection")
}
fun restoredDestination(name:String)=Destination.entries.firstOrNull{it.name==name}?:Destination.Today
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
 val lifecycle=androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
 DisposableEffect(lifecycle,model){
  val observer=androidx.lifecycle.LifecycleEventObserver{_,event->
   if(event==androidx.lifecycle.Lifecycle.Event.ON_START)model.setWorkspaceForeground(true)
   if(event==androidx.lifecycle.Lifecycle.Event.ON_STOP)model.setWorkspaceForeground(false)
  }
  lifecycle.addObserver(observer)
  onDispose{lifecycle.removeObserver(observer);model.setWorkspaceForeground(false)}
 }
 Workspace(state,model::signIn,model::refresh,model::signOut,model::complete,model::feedback,projectModel=model)
}
@Composable fun Workspace(state:WorkspaceState,onLogin:(String,String)->Unit,onRefresh:()->Unit,onLogout:()->Unit,onComplete:(JSONObject,Boolean)->Unit,onFeedback:(String,Boolean)->Unit,initialDestination:Destination=Destination.Today,projectModel:WorkspaceModel?=null,hermesContent:(@Composable (Modifier)->Unit)?=null) {
 var selected by rememberSaveable { mutableStateOf(initialDestination.name) }
 var settings by rememberSaveable { mutableStateOf(false) }
 var local by rememberSaveable { mutableStateOf(false) }
 val destination=restoredDestination(selected)
 val pages=rememberSaveableStateHolder()
  var hermesModalOpen by remember{mutableStateOf(false)}
  var mailModalOpen by remember{mutableStateOf(false)}
  var modalOwnsIme by remember{mutableStateOf(false)}
  val modalVisibility=remember { {visible:Boolean->
   hermesModalOpen=visible
   if(visible)modalOwnsIme=true
  } }
  val anyModalOpen=hermesModalOpen || mailModalOpen
  val workspaceIme=WindowInsets.ime
  val density=LocalDensity.current
  val imeBottom=workspaceIme.getBottom(density)
  // Do not release on X/Back alone: the dismissing Dialog's IME may still be
  // animating. Releasing only once hidden avoids a transient background reflow.
  LaunchedEffect(anyModalOpen,imeBottom){
   if(!anyModalOpen&&imeBottom==0){
    withFrameNanos{}
    if(!anyModalOpen&&workspaceIme.getBottom(density)==0)modalOwnsIme=false
   }
  }
  val keyboardVisible=!modalOwnsIme&&imeBottom>0
   Box(Modifier.fillMaxSize().windowInsetsPadding(if(modalOwnsIme)WindowInsets(0,0,0,0) else workspaceIme)) {
 Scaffold(bottomBar={Column {
  if(state.signedIn&&(projectModel!=null||hermesContent!=null))Surface(modifier=Modifier.testTag("hermes-dock"),tonalElevation=3.dp) {
    val dockModifier=Modifier.fillMaxWidth().padding(horizontal=12.dp,vertical=2.dp)
    CompositionLocalProvider(LocalHermesModalVisibility provides modalVisibility){
   if(hermesContent!=null)hermesContent(dockModifier)
   else if(projectModel!=null){
    val hermes by projectModel.hermes.state.collectAsStateWithLifecycle()
     HermesComposer(hermes,projectModel.hermes::edit,projectModel.hermes::send,projectModel.hermes::newRequest,projectModel.hermes::dismiss,projectModel.hermes::readReceipt,modifier=dockModifier,docked=true,onClearChat=projectModel.hermes::newConversation,onRecover=projectModel.hermes::recoverSeparately)
    }
    }
  }
  // Keyboard owns the lower inset while editing; restore the same selection
  // afterwards, rather than covering navigation or consuming another nav height.
  if(!keyboardVisible)NavigationBar(modifier=Modifier.testTag("main-navigation")) { Destination.entries.forEach { item ->
   val icon=when(item) { Destination.Today->Icons.Default.Home;Destination.Inbox->Icons.Default.Email;Destination.Focus->Icons.Default.PlayArrow;Destination.Projects->Icons.AutoMirrored.Filled.List }
   NavigationBarItem(selected=destination==item,onClick={selected=item.name},icon={Icon(icon,null)},label={Text(item.label)})
  }
 }}}) { padding ->
  Column(Modifier.fillMaxSize().padding(padding).testTag("workspace-page").clipToBounds().padding(horizontal=20.dp)) {
   if(!keyboardVisible&&!androidx.compose.ui.platform.LocalInspectionMode.current)UpdateControl(compact=true)
   if(state.notice.isNotBlank() && state.notice!="Workspace refreshed" && state.notice!="Signed in") Text(state.notice,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
   if(state.busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical=8.dp))
   if(selected=="Prices")Text("Price tracker retired; stored history is preserved.",style=MaterialTheme.typography.bodySmall)
   if(state.restoring) {
    Text("Checking saved sign-in…")
   } else if(state.restorePending&&state.snapshots.isEmpty()&&!local&&!state.signedIn) {
    Button(onClick=onRefresh,enabled=!state.busy){Text("Retry connection")}
    TextButton(onClick=onLogout,enabled=!state.busy){Text("Forget saved sign-in")}
    TextButton(onClick={local=true}){Text("Continue locally")}
   } else if(!state.signedIn&&!state.restorePending&&!local&&destination!=Destination.Focus) {
    LoginForm(state.busy,onLogin);TextButton(onClick={local=true}) { Text("Continue locally") }
   } else pages.SaveableStateProvider(destination.name) { when(destination) {
    Destination.Focus->FocusScreen(onRefresh=onRefresh,onSettings={settings=true})
    Destination.Today->TodayScreen(state,onComplete,projectModel,onRefresh=onRefresh,onSettings={settings=true})
    Destination.Inbox->InboxScreen(state,onFeedback,projectModel,onRefresh=onRefresh,onSettings={settings=true},onMailModal={open->mailModalOpen=open;if(open)modalOwnsIme=true})
    Destination.Projects->ProjectPage(state,projectModel,onRefresh,onComplete,onSettings={settings=true})
   } }
  }
 }
 }
  if(settings) AlertDialog(onDismissRequest={settings=false},title={Text("Settings")},text={LazyColumn(Modifier.heightIn(max=420.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
   item{Text("Server: dcc.home.captnuu.online")}
   item{Text("The session, confirmed workspace cache, mail bodies, and save receipts are encrypted on this phone. Previous device tasks and exported task backups may be plaintext.")}
   item{AppearanceControl()}
   item{TaskBackup()}
   item{UpdateControl()}
   if(state.legacyDrafts.isNotEmpty())item{PendingEdits(state,projectModel)}
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
@Composable private fun TodayScreen(state:WorkspaceState,onComplete:(JSONObject,Boolean)->Unit,model:WorkspaceModel?,onRefresh:()->Unit={},onSettings:()->Unit={}) {
 var date by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
 var tasksVisible by rememberSaveable { mutableStateOf(false) }
 var month by rememberSaveable { mutableStateOf(java.time.YearMonth.now().toString()) }
 val planner=snapshot(state,"planner")
 val actions=planner.optJSONArray("actions").objects().filter { it.getJSONObject("data").optString("date")==date&&!it.getJSONObject("data").optBoolean("dismissed") }
 val groups=actions.groupBy { entry -> val d=entry.getJSONObject("data");d.optString("preparationId").takeIf{it.isNotBlank()} ?: if(d.optBoolean("assignmentStep"))d.optString("projectId") else d.optString("id") }
  Column(Modifier.fillMaxSize()) {
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
   FilterChip(selected=!tasksVisible,onClick={tasksVisible=false},label={Text("Calendar")},modifier=Modifier.weight(1f))
   FilterChip(selected=tasksVisible,onClick={tasksVisible=true},label={Text("Tasks")},modifier=Modifier.weight(1f))
   var todayMenu by remember{mutableStateOf(false)}
   Box{IconButton(onClick={todayMenu=true},modifier=Modifier.size(40.dp)){Icon(Icons.Default.MoreVert,"Page actions")}
    DropdownMenu(expanded=todayMenu,onDismissRequest={todayMenu=false}){
     DropdownMenuItem(text={Text("Settings")},onClick={todayMenu=false;onSettings()})
    }}
  }
  key(tasksVisible) {
  LazyColumn(modifier=Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp),contentPadding=PaddingValues(bottom=20.dp)) {
  if(!tasksVisible) item { CalendarControls(state,date,model) }
  if(!tasksVisible) item { MonthCalendar(date,month,{date=it},{month=it}) }
  item { Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
    IconButton(onClick={date=LocalDate.parse(date).minusDays(1).toString()}){Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft,"Previous day")}
   TextButton(onClick={date=LocalDate.now().toString()},modifier=Modifier.weight(1f)) { Text(LocalDate.parse(date).format(java.time.format.DateTimeFormatter.ofPattern("EEE, MMM d"))) }
    IconButton(onClick={date=LocalDate.parse(date).plusDays(1).toString()}){Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight,"Next day")}
  } }
  if(tasksVisible) {
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
       Checkbox(d.optBoolean("completed"),{onComplete(entry,it)},enabled=state.online&&!entry.optBoolean("pending"))
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
  items(events) { event -> InfoCard(event.optString("title",event.optString("summary")),eventTimeLabel(event)+(if(event.optBoolean("pending"))" · Saving…" else "")){EventActions(state,event,model)} }

 }
}
 }
 }
 }

@Composable private fun InboxScreen(state:WorkspaceState,onFeedback:(String,Boolean)->Unit,model:WorkspaceModel?,onRefresh:()->Unit={},onSettings:()->Unit={},onMailModal:(Boolean)->Unit={}) {
 var search by rememberSaveable { mutableStateOf("") };var account by rememberSaveable { mutableStateOf("all") };var important by rememberSaveable { mutableStateOf(false) }
 var filtersOpen by rememberSaveable { mutableStateOf(false) };var briefOpen by rememberSaveable { mutableStateOf(false) }
 var reading by rememberSaveable { mutableStateOf<String?>(null) }
 val listState=androidx.compose.foundation.lazy.rememberLazyListState()
 val messages=snapshot(state,"mail").optJSONArray("messages").objects().filter { m -> val d=m.getJSONObject("data");(account=="all"||d.optString("account")==account)&&(d.optString("subject")+d.optString("sender")).contains(search,true)&&(!important||if(!m.isNull("override"))m.optBoolean("override") else m.optJSONObject("analysis")?.optBoolean("important")==true) }
 val activeFilters=account!="all"||important
 reading?.let{id-> val entry=snapshot(state,"mail").optJSONArray("messages").objects().firstOrNull{it.getJSONObject("data").optString("id")==id} ?: snapshot(state,"mail").optJSONArray("briefing").objects().firstOrNull{it.getJSONObject("data").optString("id")==id}; if(entry!=null) MailReader(mailMessage(entry),model,busy=state.busy,onFeedback=onFeedback){reading=null; onMailModal(false)} else {reading=null; onMailModal(false)} }
 LazyColumn(Modifier.fillMaxSize().testTag("inbox-list"),state=listState) {
  item(key="mail-search") {
   OutlinedTextField(search,{search=it},label={Text("Search email")},modifier=Modifier.fillMaxWidth().testTag("mail-search"),singleLine=true,keyboardOptions=androidx.compose.foundation.text.KeyboardOptions(imeAction=androidx.compose.ui.text.input.ImeAction.Search),keyboardActions=androidx.compose.foundation.text.KeyboardActions(onSearch={model?.loadMoreMail(search,account,important)}),trailingIcon={if(search.isNotBlank()||activeFilters)TextButton(onClick={model?.loadMoreMail(search,account,important)},enabled=state.signedIn&&!state.busy){Text("Search all")}else null})
  }
  item(key="mail-filter-toggle") {
   Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
    FilterChip(selected=filtersOpen||activeFilters,onClick={filtersOpen=!filtersOpen},label={Text(if(activeFilters)"Filters · active" else "Filters")})
    if(activeFilters||search.isNotBlank())TextButton(onClick={search="";account="all";important=false;filtersOpen=false;model?.loadMoreMail("","all",false)}){Text("Reset")}
    Spacer(Modifier.weight(1f))
    IconButton(onClick=onSettings,modifier=Modifier.size(40.dp)){Icon(Icons.Default.Settings,"Settings")}
   }
  }
  if(filtersOpen) item(key="mail-filters") {
   Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(4.dp)) {
     listOf("all","personal","school","work").forEach { a ->
      TextButton(onClick={account=a},modifier=Modifier.weight(1f).semantics { selected = a==account },shape=androidx.compose.foundation.shape.CircleShape,contentPadding=PaddingValues(horizontal=4.dp,vertical=8.dp),colors=ButtonDefaults.textButtonColors(containerColor=if(a==account)MaterialTheme.colorScheme.primary else Color.Transparent,contentColor=if(a==account)MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.primary)){Text(a)}
     }
    }
    Row(modifier=Modifier.fillMaxWidth().toggleable(value=important,onValueChange={important=it},role=androidx.compose.ui.semantics.Role.Checkbox).padding(vertical=2.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
     Checkbox(checked=important,onCheckedChange=null,modifier=Modifier.size(48.dp))
     Text("Important only",modifier=Modifier.weight(1f))
    }
    MailControls(state,model)
   }
  }
  item(key="mail-brief-header") { TextButton(onClick={briefOpen=!briefOpen},contentPadding=PaddingValues(0.dp)){Text(if(briefOpen)"Daily brief · hide" else "Daily brief · today",style=MaterialTheme.typography.titleMedium)} }
  if(briefOpen) {
   val brief=(snapshot(state,"mail").optJSONArray("briefing")?:snapshot(state,"mail").optJSONArray("messages")).objects().filter { m -> receivedEasternToday(m.getJSONObject("data").optString("receivedAt")) && (if(!m.isNull("override"))m.optBoolean("override") else m.optJSONObject("analysis")?.optBoolean("important")==true) }
   if(brief.isEmpty()) item(key="mail-brief-empty") { Text("No important email loaded for today.",style=MaterialTheme.typography.bodySmall) }
   items(brief,key={"brief-"+it.getJSONObject("data").getString("id")}) { m -> val msg=mailMessage(m)
    OutlinedCard(Modifier.fillMaxWidth().padding(vertical=4.dp).clickable{onMailModal(true);reading=msg.id}) { Column(Modifier.padding(12.dp)) { Text(msg.subject,style=MaterialTheme.typography.titleSmall);Text(msg.account,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(m.optJSONObject("analysis")?.optString("summary")?.takeIf{it.isNotBlank()}?:"Marked important.",style=MaterialTheme.typography.bodySmall,maxLines=2) } }
   }
  }
   item { Text("Messages",style=MaterialTheme.typography.titleMedium,modifier=Modifier.padding(top=8.dp)) }
   item{Text("${snapshot(state,"mail").optJSONArray("messages")?.length()?:0} cached of ${snapshot(state,"mail").optInt("total")}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
   if(messages.isEmpty())item { Text("No matching cached messages. Use Search all mail when online.",style=MaterialTheme.typography.bodySmall) }
   if(!snapshot(state,"mail").isNull("nextCursor"))item{TextButton(onClick={model?.loadMoreMail()},enabled=state.signedIn&&!state.busy){Text("Load older messages")}}
   items(messages,key={it.getJSONObject("data").getString("id")}) { m -> val msg=mailMessage(m)
    OutlinedCard(Modifier.fillMaxWidth().padding(vertical=4.dp).clickable{onMailModal(true);reading=msg.id}.testTag("mail-row-${msg.id}")) {
     Column(Modifier.padding(12.dp)) { Text(msg.subject,style=MaterialTheme.typography.titleMedium);Text(listOf(msg.account,msg.sender).filter{it.isNotBlank()}.joinToString(" · "),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
    }
   }
  }
}
@Composable private fun FocusScreen(model:TimerModel?=if(androidx.compose.ui.platform.LocalInspectionMode.current)null else viewModel(),onRefresh:()->Unit={},onSettings:()->Unit={}) {
 val timer = model?.state?.collectAsStateWithLifecycle()?.value ?: TimerState()
 val timerLifecycle=androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
 LaunchedEffect(model,timerLifecycle){timerLifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED){if(model!=null)while(true){model.refreshDisplay();delay(1000)}}}
 var setup by rememberSaveable {mutableStateOf(false)};var permissions by rememberSaveable {mutableStateOf(false)}
 Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(vertical=16.dp),horizontalAlignment=androidx.compose.ui.Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) {
  Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
   Spacer(Modifier.weight(1f))
   Text(timer.label,style=MaterialTheme.typography.titleLarge)
   Spacer(Modifier.weight(1f))
   var focusMenu by remember{mutableStateOf(false)}
   Box{IconButton(onClick={focusMenu=true},modifier=Modifier.size(40.dp)){Icon(Icons.Default.MoreVert,"Page actions")}
    DropdownMenu(expanded=focusMenu,onDismissRequest={focusMenu=false}){
     DropdownMenuItem(text={Text("Settings")},onClick={focusMenu=false;onSettings()})
    }}
  }
  Text(String.format(Locale.US,"%02d:%02d",timer.remaining/60,timer.remaining%60),style=MaterialTheme.typography.displayLarge)
  if(timer.steps.isNotEmpty()&&!timer.onBreak)Text("${timer.index+1} of ${timer.steps.size}",style=MaterialTheme.typography.labelMedium)
  Button(onClick={model?.toggle()},modifier=Modifier.defaultMinSize(minWidth=160.dp,minHeight=48.dp)){Text(if(timer.running)"Pause" else "Start")}
  Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
   TextButton(onClick={model?.reset()}){Text("Reset")}
   TextButton(onClick={if(timer.running)model?.toggle();setup=true}){Text("Timer settings")}
  }
  if(timer.steps.isNotEmpty())Column(Modifier.fillMaxWidth()) {timer.steps.withIndex().forEach{(i,step)->ListItem(headlineContent={Text(step.name)},supportingContent={Text("${step.minutes} min")},trailingContent={Text(if(!timer.onBreak&&i==timer.index)"Current" else if(timer.onBreak||i<timer.index)"Done" else "")})}}
  TextButton(onClick={permissions=!permissions}){Text(if(permissions)"Hide timer permissions" else "Timer permissions & alerts")}
  if(permissions)TimerPermissions()
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
