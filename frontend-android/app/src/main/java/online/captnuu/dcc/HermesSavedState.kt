package online.captnuu.dcc

import org.json.JSONArray
import org.json.JSONObject

enum class HermesStorageStatus { READY, READ_BLOCKED, DECODE_BLOCKED, VERSION_BLOCKED, VALIDATION_BLOCKED, CAPACITY_BLOCKED, WRITE_BLOCKED }
internal class HermesRestoreFailure(val status:HermesStorageStatus):Exception()
internal data class HermesSavedState(val state:HermesState,val clientId:String,val retained:JSONArray,val expiresAt:Long,val usedChars:Int,val usedBytes:Int)

/** Decode completely before publishing or writing anything. Diagnostics contain
 * a finite category only, never values, ciphertext or exception messages. */
internal fun decodeHermesSaved(raw:String,owner:String,now:Long,recovery:Boolean):HermesSavedState {
    var category=HermesStorageStatus.DECODE_BLOCKED
    try{
        require(raw.length<=2000000);val d=JSONObject(raw)
        category=HermesStorageStatus.VERSION_BLOCKED
        fun version(name:String,allowed:Set<Int>,default:Int){
            if(!d.has(name))return require(default in allowed)
            val n=d.get(name) as? Number?:error("Version")
            require(n.toDouble()==n.toInt().toDouble()&&n.toInt() in allowed)
        }
        version("composerVersion",setOf(1,2),1)
        version("timelineVersion",setOf(1),1)
        if(recovery)version("recoveryVersion",setOf(1),0) else require(!d.has("recoveryVersion"))
        category=HermesStorageStatus.VALIDATION_BLOCKED
        require(d.keys().asSequence().all{it in setOf("composerVersion","owner","clientId","expiresAt","usedChars","usedBytes","draft","answer","editedAfterSubmit","retained","timelineVersion","timeline","historyPruned","rootKey","view","receipt","attemptKey","submitted","settledReceiptKey","draftContext","recoveryVersion","preservedOwner")})
        require(d.get("owner")==owner)
        if(recovery)require(d.get("preservedOwner")==owner)
        fun optionalObject(name:String):JSONObject? {
            if(!d.has(name))return null
            return d.get(name) as? JSONObject?:error("Object")
        }
        fun optionalKey(name:String):String? {
            if(!d.has(name))return null
            val value=d.get(name) as? String?:error("Identity")
            require(Regex("^\\w[\\w-]{15,79}$").matches(value));return value
        }
        val client=d.get("clientId") as? String?:error("Client")
        require(Regex("^[a-f0-9-]{36}$").matches(client))
        val expiry=d.get("expiresAt") as? Number?:error("Expiry")
        require(expiry.toDouble()==expiry.toLong().toDouble()&&expiry.toLong() in 0..9007199254740991L)
        val retained=if(d.has("retained"))d.getJSONArray("retained") else JSONArray()
        require(retained.length()<=20&&retained.objects().size==retained.length()&&retained.objects().all(::validHermesReceipt))
        val receipt=optionalObject("receipt")?.also{require(validHermesReceipt(it))}?.toString()
        val view=optionalObject("view")?.also{require(validHermesView(it))}?.toString()
        val draft=d.get("draft") as? String?:error("Draft");val answer=d.get("answer") as? String?:error("Answer")
        require(hermesTextFits(listOf(draft,answer)))
        fun counter(name:String,max:Int):Int {val n=d.get(name) as? Number?:error("Counter");require(n.toDouble()==n.toInt().toDouble()&&n.toInt() in 0..max);return n.toInt()}
        val chars=counter("usedChars",4000);val bytes=counter("usedBytes",8192)
        val root=optionalKey("rootKey");val attempt=optionalKey("attemptKey")
        if(view!=null&&root!=null)require(JSONObject(view).getString("rootKey")==root)
        val settled=optionalKey("settledReceiptKey")
        if(d.has("editedAfterSubmit"))require(d.get("editedAfterSubmit") is Boolean)
        if(d.has("historyPruned"))require(d.get("historyPruned") is Boolean)
        val entries=if(d.has("timeline"))readChat(d.getJSONArray("timeline")) else emptyList()
        val context=optionalObject("draftContext")?.also{require(validHermesReference(it))}?.toString()
        var state=HermesState(draft=draft,answer=answer,view=view,receipt=receipt,rootKey=root,attemptKey=attempt,
            editedAfterSubmit=d.optBoolean("editedAfterSubmit",false),submitted=optionalObject("submitted")?.let(::submittedOf),
            timeline=entries,historyReady=d.has("timeline"),historyPruned=d.optBoolean("historyPruned",false),ownerKey=owner,settledReceiptKey=settled,draftContext=context)
        require(attempt==null||root!=null)
        state.submitted?.let{require(root==null||root==it.rootKey);require(attempt==null||attempt==it.turnKey)}
        if(d.optInt("composerVersion",1)==1){
            val q=view?.let{JSONObject(it).optJSONObject("question")}
            if(attempt!=null&&root!=null&&!state.editedAfterSubmit&&state.submitted==null){
                val sent=if(q!=null)answer else draft
                if(sent.isNotBlank())state=state.copy(draft="",answer="",submitted=HermesSubmitted(root,attempt,sent,q!=null,expiry.toLong(),if(q!=null)JSONObject(view!!).getString("turnKey") else null,q?.getString("id")))
            }else if(q!=null&&draft==JSONObject(view!!).optString("original"))state=if(attempt!=null)state.copy(draft=answer,answer="") else state.copy(draft="")
        }
        val expired=expiry.toLong()<=now
        state=state.copy(submitted=state.submitted?.let{if(expired||it.expiresAt<=now)it.copy(text="",context=null) else it},
            notice=if(attempt!=null)"Submitted turn is not confirmed. Check receipt; nothing was resent." else "")
        if(expired)state=state.copy(draft="",answer="",view=null,draftContext=null)
        if(state.submitted?.chat==true&&attempt!=null)state=state.copy(notice="",timeline=state.timeline.map{if(it.kind=="pending")it.copy(kind="unknown",text="This reply was interrupted. Nothing was automatically resent; you can continue chatting.") else it})
        return HermesSavedState(state,client,retained,if(expired)now+HERMES_TTL_MS else expiry.toLong(),if(expired)0 else chars,if(expired)0 else bytes)
    }catch(_:Exception){throw HermesRestoreFailure(category)}
}
