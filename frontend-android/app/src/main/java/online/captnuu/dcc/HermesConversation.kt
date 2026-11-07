package online.captnuu.dcc

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
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
data class HermesSubmitted(val rootKey:String,val turnKey:String,val text:String,val isAnswer:Boolean,val expiresAt:Long,val parentKey:String?=null,val questionId:String?=null,val closed:Boolean=false)
private fun HermesSubmitted.json()=JSONObject().put("rootKey",rootKey).put("turnKey",turnKey).put("text",text).put("isAnswer",isAnswer).put("expiresAt",expiresAt).put("closed",closed).also{v->parentKey?.let{v.put("parentKey",it)};questionId?.let{v.put("questionId",it)}}
private fun submittedOf(v:JSONObject):HermesSubmitted {
    val key=Regex("^\\w[\\w-]{15,79}$")
    require(key.matches(v.getString("rootKey"))&&key.matches(v.getString("turnKey")))
    require(v.get("text") is String&&hermesTextFits(listOf(v.getString("text")))&&(v.getString("text").isEmpty()||v.getString("text").isNotBlank()))
    require(v.get("isAnswer") is Boolean&&v.integer("expiresAt",0,9007199254740991))
    val answer=v.getBoolean("isAnswer")
    val parent=v.optString("parentKey").takeIf{it.isNotEmpty()};val question=v.optString("questionId").takeIf{it.isNotEmpty()}
    require(if(answer)parent!=null&&key.matches(parent)&&question!=null&&Regex("^[a-f0-9]{64}$").matches(question) else parent==null&&question==null)
    return HermesSubmitted(v.getString("rootKey"),v.getString("turnKey"),v.getString("text"),answer,v.getLong("expiresAt"),parent,question,v.optBoolean("closed",false))
}
data class HermesState(val draft:String="",val answer:String="",val view:String?=null,val receipt:String?=null,val busy:Boolean=false,val notice:String="",val available:Boolean=false,val rootKey:String?=null,val attemptKey:String?=null,val editedAfterSubmit:Boolean=false,val submitted:HermesSubmitted?=null)
private fun answering(s:HermesState)=s.view?.let{JSONObject(it).has("question")}==true&&s.attemptKey==null&&(s.submitted==null||s.draft.isEmpty())
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
    // Claim/owner epoch is independent of editor edits. Only a new submitted
    // turn, explicit close, expiry or owner change can stale its callbacks.
    private var operationGeneration=0L
    private var job:Job?=null
    private var readJob:Job?=null
    private var expiryJob:Job?=null
    private var paused=false
    private var retained=JSONArray()
    fun ownerFence():HermesOwnerFence?=owner?.let{HermesOwnerFence(it,generation)}
    fun isCurrent(fence:HermesOwnerFence):Boolean=owner==fence.owner&&generation==fence.generation
    fun unbind(){generation++;operationGeneration++;job?.cancel();readJob?.cancel();expiryJob?.cancel();owner=null;storage=null;clientId=UUID.randomUUID().toString();usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS;retained=JSONArray();mutable.value=HermesState()}
    private fun scheduleExpiry(){
        expiryJob?.cancel();val deadline=minOf(expiresAt,mutable.value.submitted?.takeIf{it.text.isNotEmpty()}?.expiresAt?:Long.MAX_VALUE);val boundOwner=owner
        expiryJob=scope.launch {
            delay((deadline-now()).coerceAtLeast(1L))
            if(owner==boundOwner){
                val time=now();val s=mutable.value
                if(expiresAt<=time){
                    generation++;operationGeneration++;job?.cancel();readJob?.cancel();usedChars=0;usedBytes=0;expiresAt=time+HERMES_TTL_MS
                    mutable.value=s.copy(draft="",answer="",view=null,busy=false,submitted=s.submitted?.copy(text=""),notice="Pending text expired after 24 hours and was cleared. Receipts are unchanged; nothing resent.")
                }else if(s.submitted?.expiresAt?.let{it<=time}==true)mutable.value=s.copy(submitted=s.submitted?.copy(text=""))
                try{persist()}catch(_:Exception){mutable.value=mutable.value.copy(notice="Expired text cleared from memory; encrypted storage could not be updated.")}
                scheduleExpiry()
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
                    var restored=HermesState(draft,answer,view,receipt,rootKey=d.optString("rootKey").takeIf{it.isNotEmpty()},attemptKey=d.optString("attemptKey").takeIf{it.isNotEmpty()},editedAfterSubmit=d.optBoolean("editedAfterSubmit",false),submitted=d.optJSONObject("submitted")?.let(::submittedOf)?.let{if(it.expiresAt<=now())it.copy(text="") else it})
                    restored.submitted?.let{require(restored.rootKey==null||restored.rootKey==it.rootKey);require(restored.attemptKey==null||restored.attemptKey==it.turnKey)}
                    if(d.optInt("composerVersion",1)==1){
                        val q=view?.let{JSONObject(it).optJSONObject("question")}
                        // Old APKs kept submitted text in the editor. Migrate only
                        // an unedited known claim; never invent a lost old payload.
                        if(restored.attemptKey!=null&&restored.rootKey!=null&&!restored.editedAfterSubmit){
                            val sent=if(q!=null)answer else draft
                            if(sent.isNotBlank())restored=restored.copy(draft="",answer="",submitted=HermesSubmitted(restored.rootKey!!,restored.attemptKey!!,sent,q!=null,expiresAt,if(q!=null)JSONObject(view!!).getString("turnKey") else null,q?.getString("id")))
                        }else if(q!=null&&draft==JSONObject(view!!).optString("original")){
                            restored=if(restored.attemptKey!=null)restored.copy(draft=answer,answer="") else restored.copy(draft="")
                        }
                    }
                    mutable.value=restored.copy(notice=if(restored.attemptKey!=null)"Submitted turn is not confirmed. Check receipt; nothing was resent." else "")
                    persist()
                }else{expiresAt=now()+HERMES_TTL_MS;usedChars=0;usedBytes=0;mutable.value=HermesState(receipt=receipt,rootKey=d.optString("rootKey").takeIf{it.isNotEmpty()},attemptKey=d.optString("attemptKey").takeIf{it.isNotEmpty()},submitted=d.optJSONObject("submitted")?.let(::submittedOf)?.copy(text=""));persist()}
            }
            scheduleExpiry()
        }catch(_:Exception){paused=true;mutable.value=HermesState(notice="Encrypted Hermes draft unreadable and preserved. Sending is paused.")}
    }
    private fun persist(s:HermesState=mutable.value){
        val d=JSONObject().put("composerVersion",2).put("owner",owner).put("clientId",clientId).put("expiresAt",expiresAt).put("usedChars",usedChars).put("usedBytes",usedBytes).put("draft",s.draft).put("answer",s.answer).put("editedAfterSubmit",s.editedAfterSubmit).put("retained",retained)
        s.rootKey?.let{d.put("rootKey",it)};s.view?.let{d.put("view",JSONObject(it))};s.receipt?.let{d.put("receipt",JSONObject(it))}
        s.attemptKey?.let{d.put("attemptKey",it)}
        s.submitted?.let{d.put("submitted",it.json())}
        storage?.write(d.toString())?:error("Sign in required")
    }
    fun availability(available:Boolean){mutable.value=mutable.value.copy(available=available)}
    fun edit(text:String){
        val question=answering(mutable.value)
        if(!hermesTextFits(listOf(text))||question&&(usedChars+text.length>4000||usedBytes+text.toByteArray(Charsets.UTF_8).size>8192)){mutable.value=mutable.value.copy(notice="Original plus answers must fit 4,000 UTF-16 characters and 8 KiB UTF-8.");return}
        // Draft edits fence local cache/401 publication, NOT the submitted turn.
        // Keep its operation alive and let its receipt update beside the draft.
        generation++
        val s=mutable.value;val changed=s.editedAfterSubmit||s.rootKey!=null&&(!question||s.attemptKey!=null)
        mutable.value=if(question)s.copy(answer=text,editedAfterSubmit=changed) else s.copy(draft=text,editedAfterSubmit=changed)
        try{persist()}catch(_:Exception){mutable.value=mutable.value.copy(notice="Draft could not be saved. Nothing new was sent.")}
    }
    private fun accept(v:JSONObject){
        require(validHermesView(v))
        val r=v.getJSONObject("receipt");val question=v.has("question");val complete=r.getString("outcome") in setOf("complete","read-only")
        if(!question&&!complete){val previous=retained.objects().filter{it.optString("key")!=r.getString("key")}.takeLast(19);retained=JSONArray(previous+r)}
        val claimed=mutable.value.attemptKey
        val before=mutable.value;val previousQuestion=before.view?.let{JSONObject(it).optJSONObject("question")}
        val sent=before.submitted?.let{if(it.rootKey==v.getString("rootKey"))it.copy(expiresAt=minOf(it.expiresAt,v.getLong("expiresAt"))) else it}?.let{if(it.expiresAt<=now())it.copy(text="") else it}
        if(v.getLong("expiresAt")<=now()){
            usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS
            mutable.value=before.copy(view=null,receipt=r.toString(),busy=false,submitted=sent?.copy(text=""),notice="Request text expired; receipt retained. Nothing was resent.")
            persist();scheduleExpiry();return
        }
        if(complete){
            val fresh=before.draft.ifEmpty{if(previousQuestion!=null&&claimed==null)before.answer else ""}
            usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS
            mutable.value=HermesState(draft=fresh,receipt=r.toString(),available=before.available,submitted=sent)
        }else if(before.submitted?.closed==true&&before.rootKey==null){
            mutable.value=before.copy(receipt=r.toString(),view=null,busy=false,submitted=sent,notice="Earlier request closed. Saved effects are not rolled back.")
        }else{
            expiresAt=v.getLong("expiresAt")
            mutable.value=before.copy(view=v.toString(),receipt=r.toString(),answer=if(question&&previousQuestion?.optString("id")!=v.getJSONObject("question").getString("id"))"" else before.answer,rootKey=v.getString("rootKey"),attemptKey=if(question&&claimed==v.getString("turnKey"))null else claimed,busy=false,submitted=sent,notice=if(question&&before.draft.isNotEmpty())"New draft retained. Clear it to answer this question, or choose New request." else "")
        }
        persist()
        scheduleExpiry()
    }
    fun readReceipt(){
        val s=mutable.value;val root=s.rootKey?:s.submitted?.takeIf{it.closed}?.rootKey?:return
        val boundOwner=owner?:return
        if(s.busy||readJob?.isActive==true)return
        val op=operationGeneration;readJob=scope.launch {
            try{
                val v=api(JSONObject().put("op","read").put("workspaceOwner",boundOwner).put("clientId",clientId).put("rootKey",root))
                require(validHermesView(v)&&v.getString("rootKey")==root)
                if(op==operationGeneration&&owner==boundOwner){
                    val claim=mutable.value.attemptKey
                    if(claim!=null&&v.getString("turnKey")!=claim)mutable.value=mutable.value.copy(notice="Latest submitted turn is not confirmed. Nothing was resent.")
                    else accept(v)
                }
            }catch(_:Exception){if(op==operationGeneration&&owner==boundOwner)mutable.value=mutable.value.copy(notice="Hermes unavailable. No automatic resend; submitted request retained.")}
        }
    }
    fun send(){
        val s=mutable.value;if(s.busy||owner==null||paused)return
        val boundOwner=owner?:return
        val v=s.view?.let{JSONObject(it)};val question=if(answering(s))v?.optJSONObject("question") else null
        val text=if(question!=null)s.answer else s.draft
        if(text.isBlank())return
        if(!scope.isActive){mutable.value=s.copy(notice="Composer unavailable. Nothing sent.");return}
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
        val submitted=HermesSubmitted(s.rootKey?:key,key,text,question!=null,expiresAt,question?.let{v!!.getString("turnKey")},question?.getString("id"))
        val next=s.copy(draft=if(question==null)"" else s.draft,answer="",rootKey=s.rootKey?:key,attemptKey=key,editedAfterSubmit=false,busy=true,notice="",submitted=submitted)
        usedChars=chars;usedBytes=bytes
        try{persist(next)}catch(_:Exception){usedChars=previousChars;usedBytes=previousBytes;mutable.value=s.copy(notice="Could not persist the request. Nothing sent.");return}
        // Submitting a restored answer need not involve edit(). Older receipt
        // reads (including failures) must become stale before starting this turn.
        generation++;val op=++operationGeneration;mutable.value=next
        job=scope.launch {
            try{val response=api(body);require(response.getString("rootKey")== (s.rootKey?:key)&&response.getString("turnKey")==key);if(op==operationGeneration&&owner==boundOwner)accept(response)}
            catch(_:Exception){if(op==operationGeneration&&owner==boundOwner){mutable.value=mutable.value.copy(busy=false,notice="Action not confirmed; effects may have saved. Check receipt before repeating. No automatic resend.");try{persist()}catch(_:Exception){/* The durable submitted claim remains intact. */}}}
        }
    }
    fun newRequest(){
        val s=mutable.value;if(owner==null)return
        val boundOwner=owner?:return
        val root=s.rootKey;generation++;val op=++operationGeneration;job?.cancel();readJob?.cancel()
        mutable.value=s.copy(busy=true,notice="Closing request; earlier effects are not rolled back.")
        job=scope.launch {
            try{
                val closed=if(root!=null)api(JSONObject().put("op","cancel").put("workspaceOwner",boundOwner).put("clientId",clientId).put("rootKey",root)).also{require(validHermesView(it)&&it.getString("rootKey")==root)} else null
                if(op!=operationGeneration||owner!=boundOwner)return@launch
                val current=mutable.value
                closed?.getJSONObject("receipt")?.takeIf{it.getString("outcome") !in setOf("complete","read-only","question")}?.let { r->
                    retained=JSONArray(retained.objects().filter{it.optString("key")!=r.getString("key")}.takeLast(19)+r)
                }
                usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS
                mutable.value=HermesState(draft=current.draft.ifEmpty{current.answer},receipt=closed?.getJSONObject("receipt")?.toString()?:current.receipt,available=current.available,submitted=current.submitted?.copy(closed=true),notice="Earlier effects were not rolled back. Check before repeating.");persist();scheduleExpiry()
            }catch(_:Exception){if(op==operationGeneration&&owner==boundOwner)mutable.value=mutable.value.copy(busy=false,notice="Could not close the server request. Draft retained; nothing new sent.")}
        }
    }
    fun dismiss(){
        val s=mutable.value;val r=s.receipt?.let{JSONObject(it)}
        val confirmed=s.rootKey==null&&r?.optString("key")==s.submitted?.turnKey&&r?.optString("outcome") in setOf("complete","read-only")
        // Dismissing a confirmed receipt also closes its sent preview, rather
        // than relabelling known saved work as unknown. Pending claims survive.
        mutable.value=s.copy(receipt=null,submitted=if(confirmed)null else s.submitted)
        try{persist()}catch(_:Exception){mutable.value=mutable.value.copy(notice="Receipt dismissal could not be saved.")}
    }
}

@Composable fun HermesComposer(state:HermesState,onEdit:(String)->Unit,onSend:()->Unit,onNew:()->Unit,onDismiss:()->Unit,onRead:()->Unit={},modifier:Modifier=Modifier,docked:Boolean=false){
    val view=state.view?.let{JSONObject(it)};val question=if(state.attemptKey==null)view?.optJSONObject("question") else null
    val answerEditor=answering(state)
    var expanded by rememberSaveable(view?.optString("turnKey")){mutableStateOf(question!=null)}
    var receiptOpen by rememberSaveable(state.receipt){mutableStateOf(false)}
    var sentOpen by rememberSaveable(state.submitted?.turnKey){mutableStateOf(false)}
    val keyboard=LocalSoftwareKeyboardController.current;val focus=LocalFocusManager.current
    LaunchedEffect(state.submitted?.turnKey){if(state.submitted!=null&&state.draft.isEmpty()&&state.answer.isEmpty()){keyboard?.hide();focus.clearFocus()}}
 val editor:@Composable ()->Unit={
        OutlinedTextField(if(answerEditor)state.answer else state.draft,onValueChange=onEdit,label={Text(if(answerEditor)"Answer Hermes" else "Hermes")},singleLine=true,modifier=Modifier.fillMaxWidth().testTag("hermes-editor"),keyboardOptions=androidx.compose.foundation.text.KeyboardOptions(imeAction=androidx.compose.ui.text.input.ImeAction.Send),keyboardActions=androidx.compose.foundation.text.KeyboardActions(onSend={onSend()}))
 }
 val details:@Composable ColumnScope.()->Unit={
  state.submitted?.takeIf{it.text.isNotEmpty()}?.let { sent->
    val r=state.receipt?.let{JSONObject(it)}?.takeIf{it.getString("key")==sent.turnKey}
    val phase=when{
      state.busy->if(state.notice.startsWith("Closing"))"Closing — not rolled back" else "Sending — not confirmed saved"
      r?.optString("outcome")=="complete"->"Saved · ${r.getInt("verified")}/${r.getInt("expected")}"
      sent.closed->"Closed — effects not rolled back"
      r?.optString("outcome")=="question"->"Details needed"
      r?.optString("outcome")=="partial"->if(r.isNull("expected"))"Partial · ${r.getInt("verified")} verified" else "Partial · ${r.getInt("verified")}/${r.getInt("expected")}"
      r?.optString("outcome")=="read-only"->"Read-only"
      else->"Unconfirmed — check receipt"
    }
    TextButton(onClick={sentOpen=!sentOpen},modifier=Modifier.fillMaxWidth().testTag("hermes-submitted").semantics{stateDescription=if(sentOpen)"Expanded submitted text" else "Collapsed submitted text"}){
      Column(Modifier.fillMaxWidth()){
        Text("${if(sent.isAnswer)"Sent answer" else "Sent request"} · $phase",style=MaterialTheme.typography.labelSmall)
        Row(Modifier.fillMaxWidth()){
          Text(sent.text,modifier=Modifier.weight(1f),maxLines=if(sentOpen)Int.MAX_VALUE else 1,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall)
          Text(if(sentOpen)"−" else "+",modifier=Modifier.padding(start=8.dp))
        }
      }
    }
  }
  if(question!=null){
            TextButton(onClick={expanded=!expanded}){Text(if(expanded)"Close details" else "Show question")}
            if(expanded){Text("Original request: ${view!!.getString("original")}");Text(question.getString("question"));Text("Question ${view.getInt("questions")}/3");TextButton(onClick=onSend,enabled=answerEditor&&!state.busy&&state.answer.isNotBlank()){Text("Answer")}}
        }
        if(state.notice.isNotBlank())Text(state.notice,style=MaterialTheme.typography.bodySmall)
        state.receipt?.let { raw->val receipt=JSONObject(raw)
             if(receipt.getString("outcome")!="question"){
                if(state.submitted!=null&&receipt.getString("key")!=state.submitted.turnKey)Text("Earlier receipt · ${receipt.getString("key")}",style=MaterialTheme.typography.labelSmall)
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
  if(!state.busy&&(state.rootKey!=null||state.submitted?.closed==true)&&(state.attemptKey!=null||state.submitted?.closed==true||state.receipt?.let{JSONObject(it).getString("outcome") in setOf("uncertain","partial")}==true))TextButton(onClick=onRead){Text("Check receipt")}
 }
 Column(modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(4.dp)) {
  if(docked){Column(Modifier.weight(1f,fill=false).verticalScroll(rememberScrollState()),content=details);editor()}
  else{editor();details()}
 }
}
