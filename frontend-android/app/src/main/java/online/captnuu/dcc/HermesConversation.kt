package online.captnuu.dcc

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
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
fun validHermesView(v:JSONObject,allowDisplaySync:Boolean=false):Boolean=runCatching {
    require(v.keys().asSequence().all{it in setOf("version","rootKey","turnKey","expiresAt","questions","original","question","receipt","continuable","assistantReply","replyUnavailable","chatVersion","toolSummary")||allowDisplaySync&&it=="displaySync"})
    if(v.has("displaySync"))require(allowDisplaySync&&v.optInt("chatVersion")==1&&validHermesDisplaySync(v.getJSONObject("displaySync")))
    if(v.has("chatVersion"))require(v.integer("chatVersion",1,1)&&!v.has("question"))
    if(v.has("toolSummary"))require(v.has("chatVersion")&&validHermesAssistantReply(v.getJSONObject("toolSummary")))
    if(v.has("assistantReply"))require(validHermesAssistantReply(v.getJSONObject("assistantReply"))&&!v.has("question")&&!v.has("replyUnavailable"))
    if(v.has("replyUnavailable"))require(v.get("replyUnavailable")==true)
    if(v.has("continuable"))require(v.get("continuable") is Boolean)
    require(v.integer("version",1,1)&&v.integer("questions",0,3)&&v.integer("expiresAt",0,9007199254740991))
    listOf("rootKey","turnKey").forEach{require(Regex("^\\w[\\w-]{15,79}$").matches(v.getString(it)))}
    val receipt=v.getJSONObject("receipt");require(validHermesReceipt(receipt)&&receipt.getString("key")==v.getString("turnKey"))
    if(v.has("original"))require(hermesTextFits(listOf(v.getString("original"))))
    if(v.has("question")){
        val q=v.getJSONObject("question");require(q.exact("id","reason","question"))
        require(Regex("^[a-f0-9]{64}$").matches(q.getString("id")))
        val wording=q.getString("question")
        require(hermesQuestions[q.getString("reason")]==wording||q.getString("reason")=="task_names"&&wording.length<=500&&hermesTextFits(listOf(wording))&&!wording.any{it.code<32||it.code==127}&&(wording.startsWith("Which tasks do you mean?")||wording.startsWith("I couldn't find matching current tasks.")))
        require(v.has("original")&&receipt.getString("outcome")=="question")
    }
    require(receipt.getString("outcome")!="question"||v.has("question"))
    if(v.optBoolean("continuable",false))require(!v.has("question")&&receipt.getString("outcome") in setOf("complete","partial")&&receipt.getInt("verified")>0&&receipt.getJSONArray("targets").objects().all{it.getString("state")=="applied"&&it.getString("verification")=="verified"||it.getString("state") in setOf("conflict","rejected")})
    true
}.getOrDefault(false)
data class HermesSubmitted(val rootKey:String,val turnKey:String,val text:String,val isAnswer:Boolean,val expiresAt:Long,val parentKey:String?=null,val questionId:String?=null,val closed:Boolean=false,val context:String?=null,val chat:Boolean=false)
private fun HermesSubmitted.json()=JSONObject().put("rootKey",rootKey).put("turnKey",turnKey).put("text",text).put("isAnswer",isAnswer).put("expiresAt",expiresAt).put("closed",closed).also{v->if(chat)v.put("chat",true);parentKey?.let{v.put("parentKey",it)};questionId?.let{v.put("questionId",it)};context?.let{v.put("context",JSONObject(it))}}
internal fun submittedOf(v:JSONObject):HermesSubmitted {
    require(v.keys().asSequence().all{it in setOf("rootKey","turnKey","text","isAnswer","expiresAt","parentKey","questionId","closed","context","chat")})
    val key=Regex("^\\w[\\w-]{15,79}$")
    require(key.matches(v.getString("rootKey"))&&key.matches(v.getString("turnKey")))
    require(v.get("text") is String&&hermesTextFits(listOf(v.getString("text")))&&(v.getString("text").isEmpty()||v.getString("text").isNotBlank()))
    require(v.get("isAnswer") is Boolean&&v.integer("expiresAt",0,9007199254740991))
    val answer=v.getBoolean("isAnswer")
    val parent=v.optString("parentKey").takeIf{it.isNotEmpty()};val question=v.optString("questionId").takeIf{it.isNotEmpty()}
    require(if(answer)parent!=null&&key.matches(parent)&&question!=null&&Regex("^[a-f0-9]{64}$").matches(question) else parent==null&&question==null)
    val context=if(v.has("context"))v.getJSONObject("context").also{require(!answer&&validHermesReference(it))}.toString() else null
    if(v.has("closed"))require(v.get("closed") is Boolean)
    if(v.has("chat"))require(v.get("chat") is Boolean&&!answer)
    return HermesSubmitted(v.getString("rootKey"),v.getString("turnKey"),v.getString("text"),answer,v.getLong("expiresAt"),parent,question,v.optBoolean("closed",false),context,v.optBoolean("chat",false))
}
data class HermesState(val draft:String="",val answer:String="",val view:String?=null,val receipt:String?=null,val busy:Boolean=false,val notice:String="",val available:Boolean=false,val rootKey:String?=null,val attemptKey:String?=null,val editedAfterSubmit:Boolean=false,val submitted:HermesSubmitted?=null,val timeline:List<HermesChatEntry> = emptyList(),val historyPruned:Boolean=false,val historyReady:Boolean=false,val ownerKey:String?=null,val contextVersion:Int=0,val settledReceiptKey:String?=null,val draftContext:String?=null,val replyVersion:Int=0,val storageStatus:HermesStorageStatus=HermesStorageStatus.READY,val canRecoverSeparately:Boolean=false,val receiptCheck:HermesReceiptCheck=HermesReceiptCheck.IDLE,val legacyTimeline:List<HermesChatEntry> = emptyList(),val chatVersion:Int=0,val displaySyncVersion:Int=0){
    val storageReady:Boolean get()=storageStatus==HermesStorageStatus.READY
    val receiptChecking:Boolean get()=receiptCheck==HermesReceiptCheck.CHECKING
    val conversationFirst:Boolean get()=chatVersion==1||submitted?.chat==true
}
internal fun answering(s:HermesState)=!s.conversationFirst&&s.view?.let{JSONObject(it).has("question")}==true&&s.attemptKey==null&&(s.submitted==null||s.draft.isEmpty())
data class HermesOwnerFence(val owner:String,val generation:Long)

/** Bounded encrypted client state. It is not an outbox: reconnection ONLY reads
 * receipts, and cannot replay a start or answer. All AI/effects stay on server. */
class HermesConversationController(private val scope:CoroutineScope,private val storageFor:(String)->SessionStorage,private val api:suspend (JSONObject)->JSONObject,private val now:()->Long={System.currentTimeMillis()},private val recoveryStorageFor:((String)->SessionStorage)?=null,private val receiptTimeoutMillis:Long=HERMES_RECEIPT_TIMEOUT_MS,private val chatStorageFor:((String)->SessionStorage)?=null,private val legacyRecoveryStorageFor:((String)->SessionStorage)?=null,private val onDisplaySync:(JSONObject,HermesOwnerFence)->Unit={_,_->}) {
    init{require(receiptTimeoutMillis in 1..HERMES_RECEIPT_TIMEOUT_MS)}
    private val mutable=MutableStateFlow(HermesState())
    val state=mutable.asStateFlow()
    var legacyHistory:List<HermesChatEntry> = emptyList();private set
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
    private var readSequence=0L
    private var expiryJob:Job?=null
    private var usingRecovery=false
    private var separateAbsent=false
    // Content-free latches prevent same-process rebind from writing a record
    // whose restore/save failed. Never retain another owner's draft here.
    private val blockedSlots=mutableMapOf<String,HermesStorageStatus>()
    private fun slot()=owner.orEmpty()+if(usingRecovery)":separate" else ":original"
    private fun block(status:HermesStorageStatus){
        blockedSlots[slot()]=status;expiryJob?.cancel()
        val explanation=when(status){
            HermesStorageStatus.READ_BLOCKED->"Saved chat could not be read."
            HermesStorageStatus.DECODE_BLOCKED->"Saved chat format could not be decoded."
            HermesStorageStatus.VERSION_BLOCKED->"Saved chat version is unsupported."
            HermesStorageStatus.VALIDATION_BLOCKED->"Saved chat validation failed."
            HermesStorageStatus.CAPACITY_BLOCKED->"Saved chat has no safe room for more history."
            HermesStorageStatus.WRITE_BLOCKED->"Saved chat could not be written."
            HermesStorageStatus.READY->""
        }
        mutable.value=mutable.value.copy(busy=false,storageStatus=status,canRecoverSeparately=!usingRecovery&&separateAbsent&&recoveryStorageFor!=null,
            notice="$explanation [$status] Original record preserved. Draft edits stay in memory; Send is disabled."+if(!usingRecovery&&separateAbsent&&recoveryStorageFor!=null)" Conversation actions offers Start separate local chat." else "")
    }
    private var retained=JSONArray()
    fun ownerFence():HermesOwnerFence?=owner?.let{HermesOwnerFence(it,generation)}
    fun isCurrent(fence:HermesOwnerFence):Boolean=owner==fence.owner&&generation==fence.generation
    fun unbind(){generation++;operationGeneration++;readSequence++;job?.cancel();readJob?.cancel();expiryJob?.cancel();owner=null;storage=null;clientId=UUID.randomUUID().toString();usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS;retained=JSONArray();legacyHistory=emptyList();mutable.value=HermesState()}
    private fun scheduleExpiry(){
        if(!mutable.value.storageReady){expiryJob?.cancel();return}
        expiryJob?.cancel();val contextExpiry=mutable.value.draftContext?.let{JSONObject(it).getJSONArray("entries").objects().minOfOrNull{e->e.getLong("at")+HERMES_TTL_MS}}?:Long.MAX_VALUE
        val deadline=minOf(expiresAt,mutable.value.submitted?.takeIf{it.text.isNotEmpty()}?.expiresAt?:Long.MAX_VALUE,mutable.value.timeline.filter{it.text.isNotEmpty()}.minOfOrNull{it.expiresAt}?:Long.MAX_VALUE,contextExpiry);val boundOwner=owner
        expiryJob=scope.launch {
            delay((deadline-now()).coerceAtLeast(1L))
            if(owner==boundOwner){
                expireText()
                scheduleExpiry()
            }
        }
    }
    internal fun expireText(){
        if(!mutable.value.storageReady||owner==null)return
        val time=now();val s=mutable.value
        if(expiresAt<=time){
            generation++;operationGeneration++;readSequence++;job?.cancel();readJob?.cancel();usedChars=0;usedBytes=0;expiresAt=time+HERMES_TTL_MS
            mutable.value=s.copy(draft="",draftContext=null,answer="",view=null,busy=false,submitted=s.submitted?.copy(text="",context=null),receiptCheck=if(s.receiptChecking)HermesReceiptCheck.CANCELLED else s.receiptCheck,notice="Pending text expired after 24 hours and was cleared. Receipts are unchanged; nothing resent.")
        }else if(s.submitted?.expiresAt?.let{it<=time}==true)mutable.value=s.copy(submitted=s.submitted?.copy(text="",context=null))
        try{persist()}catch(_:Exception){/* Finite storage diagnostic already published. */}
    }
    fun bind(nextOwner:String){
        require(Regex("^[a-f0-9]{64}$").matches(nextOwner))
        if(owner==nextOwner)return
        unbind();owner=nextOwner;mutable.value=HermesState(ownerKey=nextOwner,historyReady=true)
        legacyHistory=emptyList()
        var legacyDraft=""
        usingRecovery=true;separateAbsent=false
        val raw=try{
            val separate=recoveryStorageFor?.invoke(nextOwner)
            val recovered=separate?.read()
            if(recovered!=null){storage=separate;recovered}
            else{usingRecovery=false;separateAbsent=true;storage=(chatStorageFor?:storageFor)(nextOwner);storage!!.read()}
        }catch(_:Exception){block(HermesStorageStatus.READ_BLOCKED);return}
        val saved=if(raw!=null)try{decodeHermesSaved(raw,nextOwner,now(),usingRecovery)}catch(error:HermesRestoreFailure){block(error.status);return} else null
        if(chatStorageFor!=null){
            try{
                val recovered=legacyRecoveryStorageFor?.invoke(nextOwner)?.read()?.let{decodeHermesSaved(it,nextOwner,now(),true)}
                val original=try{storageFor(nextOwner).read()?.let{decodeHermesSaved(it,nextOwner,now(),false)}}catch(error:Exception){if(recovered==null)throw error else null}
                val legacy=recovered?:original
                legacyHistory=listOfNotNull(original,recovered).flatMap{projectChat(it.state,now()).timeline}
                if(legacy!=null){legacyDraft=legacy.state.draft;if(raw==null)clientId=legacy.clientId}
            }catch(_:Exception){if(saved==null&&!usingRecovery){block(HermesStorageStatus.READ_BLOCKED);return}}
        }
        if(saved!=null){
            clientId=saved.clientId;retained=saved.retained;expiresAt=saved.expiresAt;usedChars=saved.usedChars;usedBytes=saved.usedBytes;mutable.value=saved.state
            blockedSlots[slot()]?.let{block(it);return}
            try{persist()}catch(_:Exception){return}
        }else{blockedSlots[slot()]?.let{block(it);return};if(chatStorageFor!=null)mutable.value=mutable.value.copy(draft=legacyDraft)}
        mutable.value=mutable.value.copy(legacyTimeline=legacyHistory)
        scheduleExpiry()
    }
    /** Explicit local fork only. The original encrypted file is never read back
     * into the new identity, rewritten, deleted, or represented as reconciled. */
    fun recoverSeparately(){
        val before=mutable.value;val boundOwner=owner?:return
        if(before.storageReady||!before.canRecoverSeparately)return
        val oldStorage=storage;val oldRoute=usingRecovery
        val oldClient=clientId;val oldRetained=retained;val oldExpiry=expiresAt;val oldChars=usedChars;val oldBytes=usedBytes
        try{
            val separate=recoveryStorageFor?.invoke(boundOwner)?:return
            require(separate.read()==null) // Never overwrite an existing recovery.
            generation++;operationGeneration++;readSequence++;job?.cancel();readJob?.cancel();expiryJob?.cancel()
            usingRecovery=true;separateAbsent=false;storage=separate;clientId=UUID.randomUUID().toString();retained=JSONArray();usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS
            val fresh=HermesState(draft=if(answering(before))before.answer else before.draft,available=before.available,contextVersion=before.contextVersion,replyVersion=before.replyVersion,chatVersion=before.chatVersion,
                ownerKey=boundOwner,historyReady=true,notice="Separate local chat. Original record retained; earlier work is not reconciled. Press Send only for a new request.")
            // Publish only after the separate protected record is durable.
            val durable=persist(fresh,creatingSeparate=true)
            val verified=decodeHermesSaved(requireNotNull(separate.read()),boundOwner,now(),recovery=true)
            require(verified.clientId==clientId&&verified.state.draft==fresh.draft&&verified.state.rootKey==null&&verified.state.attemptKey==null)
            blockedSlots.remove(slot());mutable.value=durable;scheduleExpiry()
        }catch(_:Exception){
            storage=oldStorage;usingRecovery=oldRoute;separateAbsent=false;clientId=oldClient;retained=oldRetained;expiresAt=oldExpiry;usedChars=oldChars;usedBytes=oldBytes
            mutable.value=before.copy(storageStatus=HermesStorageStatus.WRITE_BLOCKED,canRecoverSeparately=false,notice="[WRITE_BLOCKED] Separate chat could not be saved. Original record and memory-only draft retained. No request sent.")
        }
    }
    private fun persist(s:HermesState=mutable.value,creatingSeparate:Boolean=false):HermesState{
        if(!mutable.value.storageReady&&!(creatingSeparate&&usingRecovery&&s.storageReady))throw HermesRestoreFailure(mutable.value.storageStatus)
        val projected=try{projectChat(s.copy(ownerKey=owner,draftContext=s.draftContext?.let{frozenHermesReference(it,now(),s.draft)}),now())}
            catch(error:HermesHistoryLimit){block(HermesStorageStatus.CAPACITY_BLOCKED);throw error}
        val d=JSONObject().put("composerVersion",2).put("owner",owner).put("clientId",clientId).put("expiresAt",expiresAt).put("usedChars",usedChars).put("usedBytes",usedBytes).put("draft",projected.draft).put("answer",projected.answer).put("editedAfterSubmit",projected.editedAfterSubmit).put("retained",retained).put("timelineVersion",1).put("timeline",chatJson(projected.timeline)).put("historyPruned",projected.historyPruned)
        projected.rootKey?.let{d.put("rootKey",it)};projected.view?.let{d.put("view",JSONObject(it))};projected.receipt?.let{d.put("receipt",JSONObject(it))}
        projected.attemptKey?.let{d.put("attemptKey",it)}
        projected.submitted?.let{d.put("submitted",it.json())}
        projected.settledReceiptKey?.let{d.put("settledReceiptKey",it)}
        projected.draftContext?.let{d.put("draftContext",JSONObject(it))}
        if(usingRecovery)d.put("recoveryVersion",1).put("preservedOwner",owner)
        try{storage?.write(d.toString())?:error("Sign in required")}catch(error:Exception){block(HermesStorageStatus.WRITE_BLOCKED);throw error}
        if(s===mutable.value)mutable.value=projected
        return projected
    }
    fun availability(available:Boolean,contextVersion:Int=0,replyVersion:Int=0,chatVersion:Int=0){mutable.value=mutable.value.copy(available=available,contextVersion=if(available&&contextVersion==1)1 else 0,replyVersion=if(available&&replyVersion==1)1 else 0,chatVersion=if(available&&replyVersion==1&&chatVersion==1)1 else 0)}
    fun chatCapabilities(v:JSONObject){
        fun version(name:String)=(v.opt(name) as? Number)?.toDouble()==1.0
        val supported=v.optBoolean("conversation",false)&&version("conversationReplyVersion")&&version("conversationChatVersion")
        availability(supported,if(version("conversationContextVersion"))1 else 0,if(supported)1 else 0,if(supported)1 else 0)
        mutable.value=mutable.value.copy(displaySyncVersion=if(supported&&version("conversationDisplaySyncVersion"))1 else 0)
    }
    fun edit(text:String){
        val question=answering(mutable.value)
        if(!hermesTextFits(listOf(text))||question&&(usedChars+text.length>4000||usedBytes+text.toByteArray(Charsets.UTF_8).size>8192)){mutable.value=mutable.value.copy(notice="Original plus answers must fit 4,000 UTF-16 characters and 8 KiB UTF-8.");return}
        // Draft edits fence local cache/401 publication, NOT the submitted turn.
        // Keep its operation alive and let its receipt update beside the draft.
        generation++
        val s=mutable.value;val changed=s.editedAfterSubmit||s.rootKey!=null&&(!question||s.attemptKey!=null)
        if(s.conversationFirst)expiresAt=now()+HERMES_TTL_MS
        if(!s.storageReady){mutable.value=if(question)s.copy(answer=text) else s.copy(draft=text);return}
        mutable.value=if(question)s.copy(answer=text,editedAfterSubmit=changed) else s.copy(draft=text,editedAfterSubmit=changed,draftContext=if(text.isEmpty())null else if(s.draft.isEmpty())hermesReference(s,now(),text) else s.draftContext)
        try{persist()}catch(_:Exception){/* Retain memory draft and storage diagnostic. */}
        scheduleExpiry()
    }
    private fun accept(v:JSONObject){
        require(validHermesView(v,mutable.value.displaySyncVersion==1))
        if(mutable.value.submitted?.chat==true){acceptChat(v);return}
        if(!mutable.value.storageReady){mutable.value=mutable.value.copy(receipt=v.getJSONObject("receipt").toString(),busy=false);return}
        val r=v.getJSONObject("receipt");val question=v.has("question");val complete=r.getString("outcome") in setOf("complete","read-only")||v.optBoolean("continuable",false)
        if(!question&&!complete){val previous=retained.objects().filter{it.optString("key")!=r.getString("key")}.takeLast(19);retained=JSONArray(previous+r)}
        val claimed=mutable.value.attemptKey
        val before=mutable.value;val previousQuestion=before.view?.let{JSONObject(it).optJSONObject("question")}
        val sent=before.submitted?.let{if(it.rootKey==v.getString("rootKey"))it.copy(expiresAt=minOf(it.expiresAt,v.getLong("expiresAt"))) else it}?.let{if(it.expiresAt<=now())it.copy(text="",context=null) else it}
        if(v.getLong("expiresAt")<=now()){
            usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS
            mutable.value=before.copy(view=null,receipt=r.toString(),busy=false,submitted=sent?.copy(text="",context=null),notice="Request text expired; receipt retained. Nothing was resent.")
            persist();scheduleExpiry();return
        }
        if(complete){
            val fresh=before.draft.ifEmpty{if(previousQuestion!=null&&claimed==null)before.answer else ""}
            usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS
            mutable.value=HermesState(draft=fresh,receipt=r.toString(),available=before.available,submitted=sent,timeline=before.timeline,historyPruned=before.historyPruned,historyReady=true,ownerKey=owner,contextVersion=before.contextVersion,settledReceiptKey=r.getString("key"),draftContext=before.draftContext,replyVersion=before.replyVersion)
        }else if(before.submitted?.closed==true&&before.rootKey==null){
            mutable.value=before.copy(receipt=r.toString(),view=null,busy=false,submitted=sent,notice="Earlier request closed. Saved effects are not rolled back.")
        }else{
            expiresAt=v.getLong("expiresAt")
            mutable.value=before.copy(view=v.toString(),receipt=r.toString(),answer=if(question&&previousQuestion?.optString("id")!=v.getJSONObject("question").getString("id"))"" else before.answer,rootKey=v.getString("rootKey"),attemptKey=if(question&&claimed==v.getString("turnKey"))null else claimed,busy=false,submitted=sent,notice=if(question&&before.draft.isNotEmpty())"New draft retained. Clear it to answer this question, or choose New request." else "")
        }
        mutable.value=projectAssistantReply(mutable.value,v,now())
        if(v.optBoolean("replyUnavailable",false))mutable.value=mutable.value.copy(notice=listOf(mutable.value.notice,"Assistant text unavailable. Receipt status is unchanged.").filter{it.isNotEmpty()}.joinToString(" "))
        persist()
        scheduleExpiry()
    }
    private fun checked(status:HermesReceiptCheck){
        val s=mutable.value
        if(status!=HermesReceiptCheck.CHECKING)readJob=null
        mutable.value=s.copy(receiptCheck=status,notice=if(s.storageReady)status.message else s.notice)
    }
    fun readReceipt(){
        val s=mutable.value
        if(s.receiptChecking||readJob?.isActive==true)return
        if(!s.storageReady){checked(HermesReceiptCheck.STORAGE);return}
        val boundOwner=owner?:run{checked(HermesReceiptCheck.AUTH);return}
        val root=s.rootKey?:s.submitted?.rootKey?:run{checked(HermesReceiptCheck.NO_REQUEST);return}
        if(!scope.isActive){checked(HermesReceiptCheck.INACTIVE);return}
        if(s.busy){checked(HermesReceiptCheck.BUSY);return}
        val op=operationGeneration;val sequence=++readSequence
        fun current()=op==operationGeneration&&owner==boundOwner&&sequence==readSequence
        checked(HermesReceiptCheck.CHECKING)
        // Install the job before starting it, including with an unconfined scope.
        val lookup=scope.launch(start=CoroutineStart.LAZY){
            try{
                val v=withTimeout(receiptTimeoutMillis){api(JSONObject().put("op","read").put("workspaceOwner",boundOwner).put("clientId",clientId).put("rootKey",root))}
                if(!current())return@launch
                if(!validHermesView(v,mutable.value.displaySyncVersion==1)){checked(HermesReceiptCheck.INVALID);return@launch}
                val claim=mutable.value.attemptKey
                if(v.getString("rootKey")!=root||claim!=null&&v.getString("turnKey")!=claim){checked(HermesReceiptCheck.CORRELATION);return@launch}
                if(!mutable.value.storageReady){checked(HermesReceiptCheck.STORAGE);return@launch}
                accept(v)
                checked(if(!mutable.value.storageReady)HermesReceiptCheck.STORAGE else if(v.getLong("expiresAt")<=now())HermesReceiptCheck.EXPIRED else when(v.getJSONObject("receipt").getString("outcome")){
                    "uncertain"->HermesReceiptCheck.UNCONFIRMED;"partial"->HermesReceiptCheck.PARTIAL;"failed"->HermesReceiptCheck.FAILED;"question"->HermesReceiptCheck.QUESTION;else->HermesReceiptCheck.CHECKED
                })
            }catch(_:TimeoutCancellationException){if(current())checked(HermesReceiptCheck.TIMEOUT)}
            catch(error:CancellationException){if(current())checked(HermesReceiptCheck.CANCELLED);throw error}
            catch(error:Exception){if(current())checked(if(!mutable.value.storageReady)HermesReceiptCheck.STORAGE else when(error){
                is HermesHttpFailure->if(error.auth)HermesReceiptCheck.AUTH else HermesReceiptCheck.HTTP
                is java.io.InterruptedIOException->HermesReceiptCheck.TIMEOUT
                is org.json.JSONException->HermesReceiptCheck.DECODE
                is java.io.IOException->HermesReceiptCheck.NETWORK
                else->HermesReceiptCheck.INVALID
            })}
        }
        readJob=lookup
        lookup.invokeOnCompletion{if(current()&&mutable.value.receiptChecking)checked(if(scope.isActive)HermesReceiptCheck.CANCELLED else HermesReceiptCheck.INACTIVE)}
        lookup.start()
    }
    fun send(){
        val s=mutable.value;if(s.busy||!s.storageReady)return
        if(owner==null){mutable.value=s.copy(notice="Sign in to send. Nothing sent. [AUTH]");return}
        val boundOwner=owner?:return
        if(s.chatVersion==1){sendChat(s,boundOwner);return}
        if(chatStorageFor!=null||s.submitted?.chat==true){mutable.value=s.copy(notice="This server does not currently support conversational chat. Nothing sent; no legacy fallback.");return}
        val v=s.view?.let{JSONObject(it)};val question=if(answering(s))v?.optJSONObject("question") else null
        val text=if(question!=null)s.answer else s.draft
        if(text.isBlank())return
        if(!scope.isActive){mutable.value=s.copy(notice="Composer unavailable. Nothing sent.");return}
        if(!s.available){mutable.value=s.copy(notice="Hermes needs an online server. No effects simulated or queued. [UNAVAILABLE]");return}
        if(repeatsUnconfirmedHermesRequest(s)){mutable.value=s.copy(notice="This repeats an unconfirmed earlier request. Check its receipt and details before repeating. Nothing sent.");return}
        if(s.attemptKey!=null){mutable.value=s.copy(notice="This turn was already submitted and is not confirmed. No resend. Check receipt or start a new request.");return}
        if(expiresAt<=now()){mutable.value=s.copy(notice="Conversation expired. Start a new request; nothing was resent.");return}
        val chars=if(question!=null)usedChars+text.length else text.length
        val bytes=if(question!=null)usedBytes+text.toByteArray(Charsets.UTF_8).size else text.toByteArray(Charsets.UTF_8).size
        if(!hermesTextFits(listOf(text))||chars>4000||bytes>8192){mutable.value=s.copy(notice="Original plus answers must fit 4,000 UTF-16 characters and 8 KiB UTF-8.");return}
        if(s.rootKey!=null&&question==null){mutable.value=s.copy(notice="Request may already have effects. Start a new request; do not resend.");return}
        val key=UUID.randomUUID().toString()
        val body=JSONObject().put("op",if(question!=null)"answer" else "start").put("workspaceOwner",boundOwner).put("clientId",clientId).put("key",key)
        if(question==null&&s.replyVersion==1)body.put("replyVersion",1)
        if(question!=null)body.put("rootKey",s.rootKey).put("parentKey",v!!.getString("turnKey")).put("questionId",question.getString("id")).put("answer",text) else body.put("prompt",text)
        val context=if(question==null&&s.contextVersion==1)frozenHermesReference(s.draftContext,now(),text) else null
        context?.let{body.put("context",JSONObject(it))}
        val previousChars=usedChars;val previousBytes=usedBytes
        val contextExpiry=context?.let{JSONObject(it).getJSONArray("entries").objects().minOfOrNull{e->e.getLong("at")+HERMES_TTL_MS}}?:expiresAt
        val submitted=HermesSubmitted(s.rootKey?:key,key,text,question!=null,minOf(expiresAt,contextExpiry),question?.let{v!!.getString("turnKey")},question?.getString("id"),context=context)
        val next=s.copy(draft=if(question==null)"" else s.draft,draftContext=if(question==null)null else s.draftContext,answer="",rootKey=s.rootKey?:key,attemptKey=key,editedAfterSubmit=false,busy=true,notice="",submitted=submitted,receiptCheck=HermesReceiptCheck.IDLE)
        usedChars=chars;usedBytes=bytes
        val durable=try{persist(next)}catch(_:Exception){usedChars=previousChars;usedBytes=previousBytes;if(mutable.value.storageReady)block(HermesStorageStatus.WRITE_BLOCKED);mutable.value=mutable.value.copy(notice=mutable.value.notice+" Nothing sent for this draft.");return}
        // Submitting a restored answer need not involve edit(). Older receipt
        // reads (including failures) must become stale before starting this turn.
        generation++;val op=++operationGeneration;readSequence++;readJob?.cancel();mutable.value=durable;scheduleExpiry()
        job=scope.launch {
            try{val response=api(body);require(response.getString("rootKey")== (s.rootKey?:key)&&response.getString("turnKey")==key);if(op==operationGeneration&&owner==boundOwner)accept(response)}
            catch(_:Exception){if(op==operationGeneration&&owner==boundOwner){mutable.value=mutable.value.copy(busy=false,notice=if(mutable.value.storageReady)"Action not confirmed; effects may have saved. Check receipt before repeating. No automatic resend." else mutable.value.notice);try{persist()}catch(_:Exception){/* The durable submitted claim remains intact. */}}}
        }
    }
    /** A message is independent of older action roots; this is not an outbox. */
    private fun sendChat(s:HermesState,boundOwner:String){
        if(s.draft.isBlank())return
        if(!scope.isActive||!s.available){mutable.value=s.copy(notice="Chat is unavailable. Nothing sent.");return}
        val unresolved=s.attemptKey!=null||s.receipt?.let{JSONObject(it).getString("outcome") in setOf("uncertain","partial")}==true
        if(s.submitted?.chat==true&&unresolved&&s.submitted.text.trim()==s.draft.trim()){
            mutable.value=s.copy(notice="That message was already submitted. Its result is unknown; it was not resent. You can send a different message.");return
        }
        val turn=UUID.randomUUID().toString();val expiry=now()+HERMES_TTL_MS
        val previousExpiry=expiresAt;expiresAt=expiry
        val context=hermesReference(s,now(),s.draft)
        val submitted=HermesSubmitted(turn,turn,s.draft,false,expiry,context=context,chat=true)
        val user=HermesChatEntry("chat-user:$turn",turn,turn,"user","user",s.draft,expiry,settled=true)
        val pending=HermesChatEntry("chat-status:$turn",turn,turn,"assistant","pending","Thinking…",expiry,settled=true)
        val previous=s.timeline.map{if(it.kind=="pending")it.copy(kind="unknown",text="Earlier reply delivery is unconfirmed. Nothing was resent.") else it}
        val next=s.copy(draft="",answer="",view=null,receipt=null,rootKey=turn,attemptKey=turn,submitted=submitted,busy=true,notice="",draftContext=null,timeline=previous+user+pending,receiptCheck=HermesReceiptCheck.IDLE)
        val durable=try{persist(next)}catch(_:Exception){expiresAt=previousExpiry;return}
        generation++;val op=++operationGeneration;readSequence++;readJob?.cancel();mutable.value=durable
        val boundClient=clientId
        job=scope.launch{
            fun current()=op==operationGeneration&&owner==boundOwner&&clientId==boundClient&&mutable.value.submitted?.turnKey==turn
            var failure:HermesDeliveryFailure?=null
            try{
                val response=api(JSONObject().put("op","start").put("clientId",boundClient).put("workspaceOwner",boundOwner).put("key",turn).put("prompt",submitted.text).put("replyVersion",1).put("chatVersion",1).put("context",JSONObject(context)))
                if(!current()||!kotlinx.coroutines.currentCoroutineContext().isActive)return@launch
                failure=chatReplyFailure(response,submitted)
                if(failure==null){
                    try{acceptChat(response)}catch(_:Exception){failure=HermesDeliveryFailure(HermesDeliveryCategory.STORAGE)}
                    if(failure==null)return@launch
                }
            }catch(error:TimeoutCancellationException){failure=hermesDeliveryFailure(error,mutable.value.storageReady)}
            catch(error:CancellationException){
                if(current())chatDeliveryFailed(turn,HermesDeliveryFailure(HermesDeliveryCategory.CANCELLED))
                throw error
            }catch(error:Exception){failure=hermesDeliveryFailure(error,mutable.value.storageReady)}
            val original=failure?:return@launch
            if(!current())return@launch
            if(!mutable.value.storageReady||!mutable.value.available||original.category in setOf(HermesDeliveryCategory.AUTH,HermesDeliveryCategory.STORAGE)||!scope.isActive||!kotlinx.coroutines.currentCoroutineContext().isActive){
                chatDeliveryFailed(turn,original);return@launch
            }
            if(submitted.expiresAt<=now()){chatDeliveryFailed(turn,original,HermesDeliveryFailure(HermesDeliveryCategory.EXPIRED));return@launch}
            // One read of this exact original claim, never another dispatch.
            // A different explicit Send can supersede this wait without losing
            // the old unknown entry or accepting its late response.
            val lookup=kotlinx.coroutines.currentCoroutineContext()[Job]
            readJob=lookup
            mutable.value=mutable.value.copy(busy=false,notice="",timeline=mutable.value.timeline.map{
                if(it.id==pending.id)it.copy(text="Reply delivery [${original.code}]. Looking for a saved reply once…") else it
            })
            try{
                val response=withTimeout(receiptTimeoutMillis){api(JSONObject().put("op","read").put("workspaceOwner",boundOwner).put("clientId",boundClient).put("rootKey",turn))}
                if(!current()||!kotlinx.coroutines.currentCoroutineContext().isActive)return@launch
                if(!mutable.value.available){chatDeliveryFailed(turn,original);return@launch}
                val invalid=chatReplyFailure(response,submitted)
                if(invalid!=null){chatDeliveryFailed(turn,original,invalid);return@launch}
                if(!mutable.value.storageReady){chatDeliveryFailed(turn,original,HermesDeliveryFailure(HermesDeliveryCategory.STORAGE));return@launch}
                try{
                    acceptChat(response)
                    mutable.value=mutable.value.copy(notice="Stored reply recovered after delivery [${original.code}]. Nothing was resent.")
                }catch(_:Exception){chatDeliveryFailed(turn,original,HermesDeliveryFailure(HermesDeliveryCategory.STORAGE))}
            }catch(error:TimeoutCancellationException){if(current())chatDeliveryFailed(turn,original,HermesDeliveryFailure(HermesDeliveryCategory.TIMEOUT))}
            catch(error:CancellationException){
                if(current())chatDeliveryFailed(turn,original,HermesDeliveryFailure(HermesDeliveryCategory.CANCELLED))
                throw error
            }catch(error:Exception){if(current())chatDeliveryFailed(turn,original,hermesDeliveryFailure(error,mutable.value.storageReady))}
            finally{if(readJob===lookup)readJob=null}
        }
        scheduleExpiry()
    }
    private fun chatReplyFailure(v:JSONObject,sent:HermesSubmitted):HermesDeliveryFailure? {
        if(!validHermesView(v,mutable.value.displaySyncVersion==1)||v.optInt("chatVersion")!=1||v.getString("rootKey")!=sent.rootKey||v.getString("turnKey")!=sent.turnKey||v.has("question"))return HermesDeliveryFailure(HermesDeliveryCategory.INVALID)
        if(minOf(sent.expiresAt,v.getLong("expiresAt"))<=now())return HermesDeliveryFailure(HermesDeliveryCategory.EXPIRED)
        // These fields are only published for closed turns by the producer.
        // A valid running receipt without final text/facts is not a recovered reply.
        if(!v.has("assistantReply")&&!v.has("toolSummary"))return HermesDeliveryFailure(HermesDeliveryCategory.NO_FINAL)
        return null
    }
    private fun chatDeliveryFailed(turn:String,original:HermesDeliveryFailure,recovery:HermesDeliveryFailure?=null){
        val s=mutable.value
        val reason="Reply delivery was interrupted [${original.code}]."+(recovery?.let{" Saved reply lookup did not recover a final reply [${it.code}]."}?:"")
        val text="$reason Any attempted operations may have effects; nothing was resent. You can continue chatting."
        mutable.value=s.copy(busy=false,notice=if(s.storageReady)"" else s.notice,timeline=s.timeline.map{if(it.id=="chat-status:$turn")it.copy(kind="unknown",text=text) else it})
        if(s.storageReady)try{persist()}catch(_:Exception){
            val blocked=mutable.value
            mutable.value=blocked.copy(timeline=blocked.timeline.map{if(it.id=="chat-status:$turn")it.copy(kind="unknown",text="$reason Reply state could not be saved [STORAGE]. Nothing was resent.") else it})
        }
    }
    private fun acceptChat(v:JSONObject){
        val current=mutable.value;val sent=current.submitted?:return
        require(v.optInt("chatVersion")==1&&v.getString("rootKey")==sent.rootKey&&v.getString("turnKey")==sent.turnKey&&!v.has("question"))
        val text=v.optJSONObject("assistantReply")?.getString("text")?:v.optJSONObject("toolSummary")?.getString("text")?:"No reply text was returned. Nothing was automatically resent."
        val expiry=minOf(sent.expiresAt,v.getLong("expiresAt"))
        val entry=HermesChatEntry("reply:${sent.turnKey}",sent.rootKey,sent.turnKey,"assistant","reply",if(expiry>now())text else "",expiry,settled=true)
        val sync=v.optJSONObject("displaySync")?.takeIf{current.displaySyncVersion==1&&validHermesDisplaySync(it)&&expiry>now()}
        val summary=v.optJSONObject("toolSummary")?.getString("text")?.takeIf{it!=text}?.let{HermesChatEntry("tools:${sent.turnKey}",sent.rootKey,sent.turnKey,"assistant","reply",if(expiry>now())it else "",expiry,settled=true)}
        val replies=listOfNotNull(entry,summary)
        val timeline=current.timeline.filterNot{it.id in replies.map{e->e.id}}.flatMap{if(it.id=="chat-status:${sent.turnKey}")replies else listOf(it)}.let{if(it.any{e->e.id==entry.id})it else it+replies}
        val syncId="sync:${sent.turnKey}";val freshSync=sync!=null&&current.timeline.none{it.id==syncId}
        val withSync=if(freshSync)timeline+HermesChatEntry(syncId,sent.rootKey,sent.turnKey,"assistant","reply","Saved — syncing…",expiry,settled=true) else timeline
        val next=current.copy(busy=false,rootKey=null,attemptKey=null,view=null,receipt=v.getJSONObject("receipt").toString(),submitted=sent.copy(closed=true,expiresAt=expiry),timeline=withSync,notice="")
        val durable=persist(next)
        mutable.value=durable;scheduleExpiry()
        if(freshSync)ownerFence()?.let{onDisplaySync(JSONObject(v.toString()),it)}
    }
    internal fun displaySyncFeedback(fence:HermesOwnerFence,turn:String,text:String){
        if(!isCurrent(fence)||mutable.value.submitted?.turnKey!=turn||!mutable.value.storageReady)return
        val next=mutable.value.copy(timeline=mutable.value.timeline.map{if(it.id=="sync:$turn"&&it.expiresAt>now())it.copy(text=text) else it})
        try{mutable.value=persist(next)}catch(_:Exception){/* Preserve original claim and finite storage diagnostic. */}
    }
    internal fun interruptDisplaySync(boundOwner:String,turn:String){
        val s=mutable.value
        if(s.ownerKey!=boundOwner||!s.storageReady)return
        val next=s.copy(timeline=s.timeline.map{if(it.id=="sync:$turn"&&it.text.contains("syncing…"))it.copy(text="Saved — refresh interrupted; visibility not fully confirmed.") else it})
        if(next.timeline!=s.timeline)try{mutable.value=persist(next)}catch(_:Exception){/* Keep protected state blocked. */}
    }
    fun newRequest(){
        val s=mutable.value;if(owner==null||!s.storageReady)return
        if(!scope.isActive){mutable.value=s.copy(busy=false,notice="Close unavailable: composer is inactive. Nothing new sent. [INACTIVE]");return}
        val boundOwner=owner?:return
        val root=s.rootKey;generation++;val op=++operationGeneration;readSequence++;job?.cancel();readJob?.cancel()
        mutable.value=s.copy(busy=true,receiptCheck=HermesReceiptCheck.IDLE,notice="Closing request; earlier effects are not rolled back.")
        job=scope.launch {
            try{
                val closed=if(root!=null)withTimeout(HERMES_CLOSE_TIMEOUT_MS){api(JSONObject().put("op","cancel").put("workspaceOwner",boundOwner).put("clientId",clientId).put("rootKey",root))}.also{
                    require(validHermesView(it)&&it.getString("rootKey")==root&&!it.has("question"))
                    val turn=it.getString("turnKey")
                    val submitted=s.submitted?.takeIf{sent->sent.rootKey==root&&(s.attemptKey==null||sent.turnKey==s.attemptKey)}
                    // Cancel fences the root, even if the saved answer never
                    // arrived. Its ACK may name known ancestry, not that answer.
                    require(turn==root||turn==s.attemptKey||turn==submitted?.turnKey||submitted?.isAnswer==true&&turn==submitted.parentKey)
                } else null
                if(op!=operationGeneration||owner!=boundOwner)return@launch
                if(!mutable.value.storageReady){mutable.value=mutable.value.copy(busy=false,receipt=closed?.getJSONObject("receipt")?.toString()?:mutable.value.receipt);return@launch}
                val current=mutable.value
                closed?.getJSONObject("receipt")?.takeIf{it.getString("outcome") !in setOf("complete","read-only","question")}?.let { r->
                    retained=JSONArray(retained.objects().filter{it.optString("key")!=r.getString("key")}.takeLast(19)+r)
                }
                usedChars=0;usedBytes=0;expiresAt=now()+HERMES_TTL_MS
                val next=HermesState(draft=current.draft.ifEmpty{current.answer},receipt=closed?.getJSONObject("receipt")?.toString()?:current.receipt,available=current.available,submitted=current.submitted?.copy(closed=true),notice="Earlier request closed for further work, not rolled back. Draft retained. Press Send separately for a new request.",timeline=current.timeline,historyPruned=current.historyPruned,historyReady=true,ownerKey=owner,contextVersion=current.contextVersion,settledReceiptKey=current.settledReceiptKey,draftContext=current.draftContext,replyVersion=current.replyVersion)
                val durable=persist(next)
                mutable.value=durable;scheduleExpiry()
            }catch(error:Exception){if(op==operationGeneration&&owner==boundOwner)mutable.value=mutable.value.copy(busy=false,notice=if(mutable.value.storageReady)when(error){
                is TimeoutCancellationException,is java.io.InterruptedIOException->"Close timed out. Old claim and draft retained; no new submission. [CLOSE_TIMEOUT]"
                is HermesHttpFailure->if(error.auth)"Close unavailable: sign in again. Old claim retained. [AUTH]" else "Close failed. Old claim and draft retained. [HTTP]"
                else->"Could not close the server request. Old claim and draft retained; nothing new sent. [CLOSE_FAILED]"
            } else mutable.value.notice)}
        }
    }
    fun dismiss(){
        val s=mutable.value;val r=s.receipt?.let{JSONObject(it)}
        if(!s.storageReady)return
        val confirmed=s.rootKey==null&&r?.optString("key")==s.submitted?.turnKey&&r?.optString("outcome") in setOf("complete","read-only")
        // Dismissing a confirmed receipt also closes its sent preview, rather
        // than relabelling known saved work as unknown. Pending claims survive.
        mutable.value=s.copy(receipt=null,submitted=if(confirmed)null else s.submitted)
        try{persist()}catch(_:Exception){/* Preserve the finite storage diagnostic. */}
    }
    fun newConversation(){
        val s=mutable.value
        if(!s.storageReady)return
        if(s.busy||s.rootKey!=null){mutable.value=s.copy(notice="Check the current receipt or explicitly close the unresolved request first. Chat history was not cleared.");return}
        val protected=s.timeline.filter{!it.settled}.map{it.rootKey?:it.turnKey}.toSet()
        mutable.value=s.copy(timeline=s.timeline.filter{(it.rootKey?:it.turnKey) in protected},historyPruned=false,historyReady=true,submitted=s.submitted?.takeIf{it.rootKey in protected},receipt=s.receipt?.takeIf{r->s.timeline.any{!it.settled&&it.turnKey==JSONObject(r).getString("key")}},notice=if(protected.isEmpty())"Settled local chat cleared. Saved records were not changed." else "Settled local chat cleared; unresolved receipts and claims were retained.")
        try{persist()}catch(_:Exception){mutable.value=s.copy(storageStatus=mutable.value.storageStatus,canRecoverSeparately=mutable.value.canRecoverSeparately,notice=mutable.value.notice)}
    }
}

// The legacy signature remains for source fixtures; all actual presentation is
// the compact field + modal host, never an expanded dock or a second chat router.
@Composable fun HermesComposer(state:HermesState,onEdit:(String)->Unit,onSend:()->Unit,onNew:()->Unit,onDismiss:()->Unit,onRead:()->Unit={},modifier:Modifier=Modifier,docked:Boolean=false,onClearChat:()->Unit={},onRecover:()->Unit={}){
    HermesChatHost(state,onEdit,onSend,onNew,onRead,onClearChat,modifier,onRecover)
}
