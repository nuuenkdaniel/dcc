package online.captnuu.dcc

import org.json.JSONArray
import org.json.JSONObject

const val HERMES_CHAT_MAX_ENTRIES=40
const val HERMES_CHAT_MAX_BYTES=65536
private const val REPLY_RESERVE=18432 // Receipt plus separately bounded assistant text.
data class HermesChatEntry(val id:String,val rootKey:String?,val turnKey:String,val role:String,val kind:String,val text:String,val expiresAt:Long,val settled:Boolean=false,val questionId:String?=null,val receipt:String?=null)
class HermesHistoryLimit:IllegalStateException("Local chat history is full of unresolved work. Check receipts before sending more. Nothing sent.")
internal fun HermesChatEntry.json()=JSONObject().put("id",id).put("rootKey",rootKey).put("turnKey",turnKey).put("role",role).put("kind",kind).put("text",text).put("expiresAt",expiresAt).put("settled",settled).also{v->questionId?.let{v.put("questionId",it)};receipt?.let{v.put("receipt",JSONObject(it))}}
internal fun chatJson(entries:List<HermesChatEntry>)=JSONArray(entries.map{it.json()})
internal fun readChat(array:JSONArray):List<HermesChatEntry>{
    require(array.length()<=HERMES_CHAT_MAX_ENTRIES&&array.toString().toByteArray(Charsets.UTF_8).size<=HERMES_CHAT_MAX_BYTES)
    val key=Regex("^\\w[\\w-]{15,79}$")
    val entries=array.objects().map { v->
        val root=v.optString("rootKey").takeIf{it.isNotEmpty()&&it!="null"};val turn=v.getString("turnKey")
        require(key.matches(turn)&&(root==null||key.matches(root)))
        val role=v.getString("role");val kind=v.getString("kind");val text=v.getString("text")
        require(role in setOf("user","assistant")&&kind in setOf("user","pending","unknown","question","receipt","reply"))
        require(text.length<=4000&&text.toByteArray(Charsets.UTF_8).size<=8192)
        if(kind=="reply")require(role=="assistant"&&(text.isEmpty()||validHermesAssistantReply(JSONObject().put("version",1).put("text",text))))
        val receipt=v.optJSONObject("receipt")?.also{require(validHermesReceipt(it)&&it.getString("key")==turn)}?.toString()
        val expiry=v.getLong("expiresAt");require(expiry in 0..9007199254740991L)
        HermesChatEntry(v.getString("id"),root,turn,role,kind,text,expiry,v.getBoolean("settled"),v.optString("questionId").takeIf{it.isNotEmpty()},receipt)
    }
    require(entries.size==array.length()&&entries.map{it.id}.toSet().size==entries.size)
    return entries
}
private fun compactChatReceipt(r:JSONObject):String? {
    val copy=JSONObject(r.toString())
    copy.getJSONArray("targets").objects().forEach{it.remove("before");it.remove("after")}
    return copy.toString().takeIf{it.toByteArray(Charsets.UTF_8).size<=6144}
}
private fun historyCost(entries:List<HermesChatEntry>):Int {
    fun cost(entry:HermesChatEntry)=entry.json().toString().toByteArray(Charsets.UTF_8).size+1
    val reserved=entries.filter{it.role=="assistant"&&!it.settled}.groupBy{it.rootKey?:it.turnKey}.values.sumOf{group->
        (REPLY_RESERVE-group.sumOf(::cost)).coerceAtLeast(0)
    }
    return entries.sumOf(::cost)+reserved+2
}

/** Display projection only. Optional reference text is untrusted, not a guard or
 * current tool result; no execution decision reads this projection as authority.
 * Reserve reply space before writes; refuse admission rather than prune unknowns. */
internal fun projectChat(s:HermesState,now:Long):HermesState {
    val entries=s.timeline.toMutableList();var pruned=s.historyPruned
    fun put(candidate:HermesChatEntry){
        val entry=candidate.copy(expiresAt=minOf(candidate.expiresAt,now+HERMES_TTL_MS))
        val existing=entries.indexOfFirst{it.id==entry.id}
        if(existing>=0){
            val old=entries[existing]
            entries[existing]=if(entry.role=="user")entry.copy(text=old.text,expiresAt=minOf(old.expiresAt,entry.expiresAt),settled=old.settled) else entry.copy(expiresAt=minOf(old.expiresAt,entry.expiresAt))
        }else{
            val pending=if(entry.role=="assistant"&&entry.kind in setOf("question","receipt"))entries.indexOfFirst{it.turnKey==entry.turnKey&&it.kind in setOf("pending","unknown")} else -1
            if(pending>=0)entries[pending]=entry.copy(expiresAt=minOf(entries[pending].expiresAt,entry.expiresAt)) else entries+=entry
        }
    }
    fun receipt(r:JSONObject,root:String?,expiry:Long){
        if(r.getString("outcome")=="question")return
        val turn=r.getString("key");val previous=entries.firstOrNull{it.id=="receipt:$turn"};val known=entries.firstOrNull{it.turnKey==turn}?.rootKey?:root
        val settled=r.getString("outcome") in setOf("complete","read-only","failed")||previous?.settled==true||s.settledReceiptKey==turn
        put(HermesChatEntry("receipt:$turn",known,turn,"assistant","receipt",r.getString("line"),minOf(previous?.expiresAt?:expiry,expiry),settled,receipt=compactChatReceipt(r)))
        if(settled)for(i in entries.indices)if((known!=null&&entries[i].rootKey==known)||(known==null&&entries[i].turnKey==turn))entries[i]=entries[i].copy(settled=true)
    }
    val sent=s.submitted;val view=s.view?.let{JSONObject(it)};val r=s.receipt?.let{JSONObject(it)}
    // A known earlier receipt is not attached to the latest submitted text.
    if(r!=null&&r.optString("key")!=sent?.turnKey)receipt(r,view?.takeIf{it.optString("turnKey")==r.optString("key")}?.optString("rootKey"),view?.optLong("expiresAt")?:now+HERMES_TTL_MS)
    if(view?.has("question")==true){
        val root=view.getString("rootKey");val turn=view.getString("turnKey");val expiry=view.getLong("expiresAt");val q=view.getJSONObject("question")
        if(sent!=null&&!sent.isAnswer&&sent.rootKey==root)put(HermesChatEntry("user:${sent.turnKey}",root,sent.turnKey,"user","user",sent.text,sent.expiresAt))
        else if(entries.none{it.id=="user:$root"})put(HermesChatEntry("user:$root",root,root,"user","user",view.getString("original"),expiry))
        put(HermesChatEntry("question:$turn:${q.getString("id")}",root,turn,"assistant","question",q.getString("question"),expiry,questionId=q.getString("id")))
    }
    if(sent!=null&&sent.text.isNotEmpty()){
        put(HermesChatEntry("user:${sent.turnKey}",sent.rootKey,sent.turnKey,"user","user",sent.text,sent.expiresAt))
        if(r?.optString("key")==sent.turnKey)receipt(r,sent.rootKey,sent.expiresAt)
        val hasResult=entries.any{it.turnKey==sent.turnKey&&it.kind in setOf("question","receipt")}
        if(!hasResult&&!sent.closed){
            val pending=s.busy
            put(HermesChatEntry("status:${sent.turnKey}",sent.rootKey,sent.turnKey,"assistant",if(pending)"pending" else "unknown",if(pending)"Sending — no saved effects confirmed." else s.notice.ifBlank{"Submitted turn is unconfirmed. Check receipt before repeating."},sent.expiresAt))
        }
    }
    for(i in entries.indices){
        val entry=entries[i]
        if(entry.expiresAt<=now)entries[i]=entry.copy(text="")
    }
    // Remove expired settled transcript text, but retain every unresolved root.
    val expired=entries.filter{it.settled&&it.expiresAt<=now&&it.rootKey!=s.rootKey}.map{it.id}.toSet()
    if(expired.isNotEmpty()){entries.removeAll{it.id in expired};pruned=true}
    // One pending event can become separate reply and receipt events. Reserve
    // that entry before submission, not after effects have already happened.
    while(entries.size+entries.count{it.kind in setOf("pending","unknown")}>HERMES_CHAT_MAX_ENTRIES||historyCost(entries)>HERMES_CHAT_MAX_BYTES){
        val removable=entries.firstOrNull { entry->
            val group=entry.rootKey?:entry.turnKey
            group!=s.rootKey&&entries.filter{(it.rootKey?:it.turnKey)==group}.all{it.settled}
        }?:throw HermesHistoryLimit()
        val group=removable.rootKey?:removable.turnKey
        entries.removeAll{(it.rootKey?:it.turnKey)==group};pruned=true
    }
    return s.copy(timeline=entries.toList(),historyPruned=pruned,historyReady=true)
}
internal fun visibleChat(s:HermesState):List<HermesChatEntry>{
    if(!s.historyReady)return projectChat(s,0L).timeline // Synthetic/legacy presentation seam only.
    if(s.timeline.isNotEmpty())return s.timeline
    val receipt=s.receipt?.let{JSONObject(it)}?.takeIf{it.getString("outcome")!="question"}?:return emptyList()
    // Transcript expiry does not remove the independent latest operation receipt.
    val turn=receipt.getString("key")
    return listOf(HermesChatEntry("receipt:$turn",null,turn,"assistant","receipt",receipt.getString("line"),0L,receipt=compactChatReceipt(receipt)))
}
