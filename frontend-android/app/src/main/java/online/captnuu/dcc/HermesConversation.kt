package online.captnuu.dcc

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

const val HERMES_TTL_MS=86400000L
fun hermesTextFits(parts:List<String>):Boolean {
    val text=parts.joinToString("")
    var i=0
    while(i<text.length){
        val c=text[i].code
        if(c in 0xd800..0xdbff){i++;if(i>=text.length||text[i].code !in 0xdc00..0xdfff)return false}
        else if(c in 0xdc00..0xdfff)return false
        i++
    }
    return text.length<=4000&&text.toByteArray(Charsets.UTF_8).size<=8192&&!Regex("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]").containsMatchIn(text)
}
private val receiptFields=setOf("title","date","completed","deleted","important","status","deadline","startDate","start","end","allDay","minutes","remainingMinutes","importance")
private val hermesQuestions=mapOf(
    "task_topics" to "Should these study chunks use specific topics, or just general chunks? Give the task names, or say “just general chunks”.",
    "task_names" to "Please give exactly the requested number of task names, separated by semicolons, or say “just general chunks” for study chunks.",
    "missing_calendar" to "Which calendar should I use?",
    "missing_duration" to "How many minutes should this take?",
    "missing_event_time" to "What date and start time should the event use?",
    "ambiguous_project" to "Which project or assignment do you mean? Please give its exact name or ID.",
    "ambiguous_calendar" to "Which calendar do you mean? Please give its exact name or ID.",
    "ambiguous_relative_date" to "What exact date (including year) do you mean?",
    "dst_gap" to "That local time does not exist because the clocks move forward. What valid local time should I use?",
    "dst_fold" to "That local time occurs twice when the clocks move back. Which UTC offset or occurrence do you mean?"
)
private fun JSONObject.integer(key:String,min:Long,max:Long):Boolean {
    val n=opt(key) as? Number?:return false
    return n.toDouble().isFinite()&&n.toDouble()==n.toLong().toDouble()&&n.toLong() in min..max
}
private fun JSONObject.exact(vararg keys:String)=this.keys().asSequence().toSet()==keys.toSet()
fun validHermesReceipt(r:JSONObject):Boolean=runCatching {
    require(r.exact("version","key","outcome","line","verified","expected","targets"))
    require(r.integer("version",1,1)&&Regex("^\\w[\\w-]{15,79}$").matches(r.getString("key")))
    require(r.getString("outcome") in setOf("complete","partial","failed","uncertain","question","read-only"))
    require(r.getString("line").length<=500&&r.integer("verified",0,4))
    val expected=if(r.isNull("expected"))null else r.getInt("expected").also{require(r.integer("expected",1,4))}
    val array=r.getJSONArray("targets");require(array.length()<=4&&array.objects().size==array.length())
    val targets=array.objects()
    targets.forEach { t->
        require(t.keys().asSequence().all{it in setOf("kind","id","action","title","date","state","verification","before","after")})
        listOf("kind","id","action","title","state","verification").forEach{require(t.get(it) is String&&t.getString(it).length<=500)}
        require(t.getString("verification") in setOf("verified","unavailable","snapshot_pending"))
        if(t.has("date"))require(Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(t.getString("date")))
        listOf("before","after").filter{t.has(it)}.forEach { name->
            val fields=t.getJSONObject(name);require(fields.length()<=16)
            fields.keys().asSequence().forEach { k->val v=fields.get(k);require(k in receiptFields&&(v is Boolean||v is Number||v is String&&v.length<=500)) }
        }
    }
    val verified=targets.filter{it.getString("verification")=="verified"&&it.getString("state")=="applied"}.map{it.getString("kind")+"\u0000"+it.getString("id")}.distinct().size
    require(verified==r.getInt("verified"))
    if(r.getString("outcome")=="complete")require(expected==verified&&verified>0&&targets.all{it.getString("state")=="applied"&&it.getString("verification")=="verified"})
    true
}.getOrDefault(false)
fun validHermesView(v:JSONObject):Boolean=runCatching {
    require(v.keys().asSequence().all{it in setOf("version","rootKey","turnKey","expiresAt","questions","original","question","receipt")})
    require(v.integer("version",1,1)&&v.integer("questions",0,3)&&v.integer("expiresAt",0,9007199254740991))
    listOf("rootKey","turnKey").forEach{require(Regex("^\\w[\\w-]{15,79}$").matches(v.getString(it)))}
    val receipt=v.getJSONObject("receipt");require(validHermesReceipt(receipt)&&receipt.getString("key")==v.getString("turnKey"))
    if(v.has("original"))require(hermesTextFits(listOf(v.getString("original"))))
    if(v.has("question")){
        val q=v.getJSONObject("question");require(q.exact("id","reason","question"))
        require(Regex("^[a-f0-9]{64}$").matches(q.getString("id")))
        require(hermesQuestions[q.getString("reason")]==q.getString("question"))
        require(v.has("original")&&receipt.getString("outcome")=="question")
    }
    require(receipt.getString("outcome")!="question"||v.has("question"))
    true
}.getOrDefault(false)
data class HermesState(val draft:String="",val answer:String="",val view:String?=null,val receipt:String?=null,val busy:Boolean=false,val notice:String="",val available:Boolean=false,val rootKey:String?=null,val attemptKey:String?=null,val editedAfterSubmit:Boolean=false)
data class HermesOwnerFence(val owner:String,val generation:Long)

/** Bounded encrypted client state. It is not an outbox: reconnection ONLY reads
 * receipts, and cannot replay a start or answer. All AI/effects stay on server. */
class HermesConversationController(private val scope:CoroutineScope,private val storageFor:(String)->SessionStorage,private val api:suspend (JSONObject)->JSONObject,private val now:()->Long={System.currentTimeMillis()}) {
    private val mutable=MutableStateFlow(HermesState())
    val state=mutable.asStateFlow()
    private var storage:SessionStorage?=null
    private var owner:String?=null
    private var clientId=UUID.randomUUID().toString()
    private var expiresAt=now()+HERMES_TTL_MS
    private var usedChars=0
    private var usedBytes=0
    @Volatile private var generation=0L
    private var job:Job?=null
    private var expiryJob:Job?=null
    private var paused=false
    private var retained=JSONArray()
    fun ownerFence():HermesOwnerFence?=owner?.let{HermesOwnerFence(it,generation)}
    fun isCurrent(fence:HermesOwnerFence):Boolean=owner==fence.owner&&generation==fence.generation
    fun unbind(){generation++;job?.cancel();expiryJob?.cancel();owner=null;storage=null;clientId=UUID.randomUUID().toString();usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS;retained=JSONArray();mutable.value=HermesState()}
    private fun scheduleExpiry(){
        expiryJob?.cancel();val deadline=expiresAt;val boundOwner=owner
        expiryJob=scope.launch {
            delay((deadline-now()).coerceAtLeast(1L))
            if(owner==boundOwner&&expiresAt==deadline){
                generation++;job?.cancel();usedChars=0;usedBytes=0
                mutable.value=mutable.value.copy(draft="",answer="",view=null,busy=false,notice="Pending text expired after 24 hours and was cleared. Receipts are unchanged; nothing resent.")
                try{persist()}catch(_:Exception){mutable.value=mutable.value.copy(notice="Expired text cleared from memory; encrypted storage could not be updated.")}
            }
        }
    }
    fun bind(nextOwner:String){
        require(Regex("^[a-f0-9]{64}$").matches(nextOwner))
        if(owner==nextOwner)return
        unbind();owner=nextOwner;storage=storageFor(nextOwner);paused=false
        try {
            storage!!.read()?.let { raw->
                require(raw.length<=2000000);val d=JSONObject(raw)
                require(d.getString("owner")==nextOwner)
                clientId=d.getString("clientId");require(Regex("^[a-f0-9-]{36}$").matches(clientId))
                retained=d.optJSONArray("retained")?:JSONArray();require(retained.length()<=20&&retained.objects().size==retained.length()&&retained.objects().all(::validHermesReceipt))
                val receipt=d.optJSONObject("receipt")?.also{require(validHermesReceipt(it))}?.toString()
                expiresAt=d.getLong("expiresAt")
                if(expiresAt>now()){
                    val view=d.optJSONObject("view")?.also{require(validHermesView(it))}?.toString()
                    usedChars=d.getInt("usedChars");usedBytes=d.getInt("usedBytes")
                    require(usedChars in 0..4000&&usedBytes in 0..8192)
                    val draft=d.getString("draft");val answer=d.getString("answer");require(hermesTextFits(listOf(draft,answer)))
                    mutable.value=HermesState(draft,answer,view,receipt,rootKey=d.optString("rootKey").takeIf{it.isNotEmpty()},attemptKey=d.optString("attemptKey").takeIf{it.isNotEmpty()},editedAfterSubmit=d.optBoolean("editedAfterSubmit",false))
                }else{expiresAt=now()+HERMES_TTL_MS;usedChars=0;usedBytes=0;mutable.value=HermesState(receipt=receipt);persist()}
            }
            scheduleExpiry()
        }catch(_:Exception){paused=true;mutable.value=HermesState(notice="Encrypted Hermes draft unreadable and preserved. Sending is paused.")}
    }
    private fun persist(){
        val s=mutable.value
        val d=JSONObject().put("owner",owner).put("clientId",clientId).put("expiresAt",expiresAt).put("usedChars",usedChars).put("usedBytes",usedBytes).put("draft",s.draft).put("answer",s.answer).put("editedAfterSubmit",s.editedAfterSubmit).put("retained",retained)
        s.rootKey?.let{d.put("rootKey",it)};s.view?.let{d.put("view",JSONObject(it))};s.receipt?.let{d.put("receipt",JSONObject(it))}
        s.attemptKey?.let{d.put("attemptKey",it)}
        storage?.write(d.toString())?:error("Sign in required")
    }
    fun availability(available:Boolean){mutable.value=mutable.value.copy(available=available)}
    fun edit(text:String){
        val question=mutable.value.view?.let{JSONObject(it).has("question")}==true
        if(!hermesTextFits(listOf(text))||question&&(usedChars+text.length>4000||usedBytes+text.toByteArray(Charsets.UTF_8).size>8192)){mutable.value=mutable.value.copy(notice="Original plus answers must fit 4,000 UTF-16 characters and 8 KiB UTF-8.");return}
        generation++;job?.cancel()
        val s=mutable.value;val changed=s.editedAfterSubmit||s.rootKey!=null&&(!question||s.attemptKey!=null)
        mutable.value=if(question)s.copy(answer=text,busy=false,editedAfterSubmit=changed) else s.copy(draft=text,busy=false,editedAfterSubmit=changed)
        try{persist()}catch(_:Exception){mutable.value=mutable.value.copy(notice="Draft could not be saved. Nothing new was sent.")}
    }
    private fun accept(v:JSONObject){
        require(validHermesView(v))
        val r=v.getJSONObject("receipt");val question=v.has("question");val complete=r.getString("outcome") in setOf("complete","read-only")
        if(!question&&!complete){val previous=retained.objects().filter{it.optString("key")!=r.getString("key")}.takeLast(19);retained=JSONArray(previous+r)}
        expiresAt=v.getLong("expiresAt")
        val claimed=mutable.value.attemptKey
        val before=mutable.value;val previousQuestion=before.view?.let{JSONObject(it).optJSONObject("question")}
        if(complete){
            val preserve=before.editedAfterSubmit||previousQuestion!=null&&before.answer.isNotBlank()&&claimed==null
            usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS
            mutable.value=HermesState(draft=if(r.getString("outcome")=="read-only")before.draft else if(preserve){if(previousQuestion!=null)before.answer else before.draft}else "",receipt=r.toString(),available=before.available)
        }else mutable.value=before.copy(view=v.toString(),receipt=r.toString(),draft=if(question)v.getString("original") else before.draft,answer=if(question&&previousQuestion?.optString("id")!=v.getJSONObject("question").getString("id"))"" else before.answer,rootKey=v.getString("rootKey"),attemptKey=if(claimed==v.getString("turnKey"))null else claimed,busy=false,notice="")
        persist()
        scheduleExpiry()
    }
    fun readReceipt(){
        val s=mutable.value;val root=s.rootKey?:return
        val boundOwner=owner?:return
        if(s.busy)return
        val g=generation;job=scope.launch {
            try{val v=api(JSONObject().put("op","read").put("workspaceOwner",boundOwner).put("clientId",clientId).put("rootKey",root));require(v.getString("rootKey")==root);if(g==generation&&owner==boundOwner)accept(v)}
            catch(_:Exception){if(g==generation)mutable.value=mutable.value.copy(notice="Hermes unavailable. No automatic resend; saved request retained.")}
        }
    }
    fun send(){
        val s=mutable.value;if(s.busy||owner==null||paused)return
        val boundOwner=owner?:return
        val v=s.view?.let{JSONObject(it)};val question=v?.optJSONObject("question")
        val text=if(question!=null)s.answer else s.draft
        if(text.isBlank())return
        if(s.attemptKey!=null){mutable.value=s.copy(notice="This turn was already submitted and is not confirmed. No resend. Check receipt or start a new request.");return}
        if(!s.available){mutable.value=s.copy(notice="Hermes needs an online server. No effects simulated or queued.");return}
        if(expiresAt<=now()){mutable.value=s.copy(notice="Conversation expired. Start a new request; nothing was resent.");return}
        val chars=if(question!=null)usedChars+text.length else text.length
        val bytes=if(question!=null)usedBytes+text.toByteArray(Charsets.UTF_8).size else text.toByteArray(Charsets.UTF_8).size
        if(!hermesTextFits(listOf(text))||chars>4000||bytes>8192){mutable.value=s.copy(notice="Original plus answers must fit 4,000 UTF-16 characters and 8 KiB UTF-8.");return}
        if(s.rootKey!=null&&question==null){mutable.value=s.copy(notice="Request may already have effects. Start a new request; do not resend.");return}
        val key=UUID.randomUUID().toString()
        val body=JSONObject().put("op",if(question!=null)"answer" else "start").put("workspaceOwner",boundOwner).put("clientId",clientId).put("key",key)
        if(question!=null)body.put("rootKey",s.rootKey).put("parentKey",v!!.getString("turnKey")).put("questionId",question.getString("id")).put("answer",text) else body.put("prompt",text)
        val previousChars=usedChars;val previousBytes=usedBytes
        usedChars=chars;usedBytes=bytes;mutable.value=s.copy(rootKey=s.rootKey?:key,attemptKey=key,editedAfterSubmit=false,busy=true,notice="Checking DCC…")
        try{persist()}catch(_:Exception){usedChars=previousChars;usedBytes=previousBytes;mutable.value=s.copy(notice="Could not persist the request. Nothing sent.");return}
        // Submitting a restored answer need not involve edit(). Older receipt
        // reads (including failures) must become stale before starting this turn.
        val g=++generation;job=scope.launch {
            try{val response=api(body);require(response.getString("rootKey")== (s.rootKey?:key)&&response.getString("turnKey")==key);if(g==generation&&owner==boundOwner)accept(response)}
            catch(_:Exception){if(g==generation)mutable.value=mutable.value.copy(busy=false,notice="Action not confirmed; effects may have saved. Edit or clear. No automatic resend.")}
        }
    }
    fun newRequest(){
        val s=mutable.value;if(owner==null)return
        val boundOwner=owner?:return
        val root=s.rootKey;val g=++generation;job?.cancel()
        job=scope.launch {
            try{
                if(root!=null)api(JSONObject().put("op","cancel").put("workspaceOwner",boundOwner).put("clientId",clientId).put("rootKey",root)).also{require(validHermesView(it))}
                if(g!=generation)return@launch
                usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS
                mutable.value=HermesState(receipt=s.receipt,available=s.available,notice="Earlier effects were not rolled back. Check before repeating.");persist();scheduleExpiry()
            }catch(_:Exception){if(g==generation)mutable.value=mutable.value.copy(busy=false,notice="Could not close the server request. Draft retained; nothing new sent.")}
        }
    }
    fun dismiss(){mutable.value=mutable.value.copy(receipt=null);try{persist()}catch(_:Exception){mutable.value=mutable.value.copy(notice="Receipt dismissal could not be saved.")}}
}

@Composable fun HermesComposer(state:HermesState,onEdit:(String)->Unit,onSend:()->Unit,onNew:()->Unit,onDismiss:()->Unit,onRead:()->Unit={},modifier:Modifier=Modifier,docked:Boolean=false){
    val view=state.view?.let{JSONObject(it)};val question=view?.optJSONObject("question")
    var expanded by rememberSaveable(view?.optString("turnKey")){mutableStateOf(question!=null)}
    var receiptOpen by rememberSaveable(state.receipt){mutableStateOf(false)}
 val editor:@Composable ()->Unit={
        OutlinedTextField(if(question!=null)state.answer else state.draft,onValueChange=onEdit,label={Text(if(question!=null)"Answer Hermes" else "Hermes")},singleLine=true,modifier=Modifier.fillMaxWidth(),keyboardOptions=androidx.compose.foundation.text.KeyboardOptions(imeAction=androidx.compose.ui.text.input.ImeAction.Send),keyboardActions=androidx.compose.foundation.text.KeyboardActions(onSend={onSend()}))
 }
 val details:@Composable ColumnScope.()->Unit={
  if(question!=null){
            TextButton(onClick={expanded=!expanded}){Text(if(expanded)"Close details" else "Show question")}
            if(expanded){Text("Original request: ${state.draft}");Text(question.getString("question"));Text("Question ${view!!.getInt("questions")}/3");TextButton(onClick=onSend,enabled=!state.busy&&state.answer.isNotBlank()){Text("Answer")}}
        }
        if(state.notice.isNotBlank())Text(state.notice,style=MaterialTheme.typography.bodySmall)
        state.receipt?.let { raw->val receipt=JSONObject(raw)
            if(receipt.getString("outcome")!="question"){
                Text(receipt.getString("line"),style=MaterialTheme.typography.bodySmall,maxLines=1,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Row {TextButton(onClick={receiptOpen=!receiptOpen}){Text(if(receiptOpen)"Hide receipt" else "View")};TextButton(onClick=onDismiss){Text("Dismiss")}}
                if(receiptOpen){
                    Text(receipt.getString("line"),style=MaterialTheme.typography.bodySmall)
                    val targets=receipt.getJSONArray("targets").objects()
                    if(targets.isEmpty())Text("No verified record targets.")
                    targets.forEach { t->
                        Text("${t.getString("action")}: ${t.getString("title")}${if(t.has("date"))" · "+t.getString("date") else ""}")
                        Text("${t.getString("kind")} · ${t.getString("id")} · ${t.getString("state")} · ${t.getString("verification")}",style=MaterialTheme.typography.bodySmall)
                        val before=t.optJSONObject("before");val after=t.optJSONObject("after")
                        if(before!=null&&after!=null)(before.keys().asSequence().toSet()+after.keys().asSequence().toSet()).forEach { k->Text("$k: ${before.opt(k)?:"—"} → ${after.opt(k)?:"—"}",style=MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
        if(state.rootKey!=null)TextButton(onClick=onNew){Text("New request / cancel")}
  if(state.rootKey!=null&&!state.busy&&(state.attemptKey!=null||state.receipt?.let{JSONObject(it).getString("outcome") in setOf("uncertain","partial")}==true))TextButton(onClick=onRead){Text("Check receipt")}
 }
 Column(modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(4.dp)) {
  if(docked){Column(Modifier.weight(1f,fill=false).verticalScroll(rememberScrollState()),content=details);editor()}
  else{editor();details()}
 }
}
