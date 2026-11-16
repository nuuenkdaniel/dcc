package online.captnuu.dcc

import org.json.JSONObject

internal fun validHermesAssistantReply(v:JSONObject):Boolean=runCatching{
    require(v.keys().asSequence().toSet()==setOf("version","text")&&v.get("version") is Number&&(v.get("version") as Number).toDouble()==1.0)
    val text=v.get("text") as? String?:error("Invalid reply")
    require(!Regex("[\\t\\n\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*").matches(text)&&text.length<=2048&&text.toByteArray(Charsets.UTF_8).size<=4096&&hermesTextFits(listOf(text)))
    true
}.getOrDefault(false)

/** The enclosing authenticated view supplies correlation, never model text. */
internal fun projectAssistantReply(s:HermesState,v:JSONObject,now:Long):HermesState {
    val reply=v.optJSONObject("assistantReply")?:return s
    require(validHermesAssistantReply(reply))
    val expiry=v.getLong("expiresAt");if(expiry<=now)return s
    val turn=v.getString("turnKey");val id="reply:$turn"
    if(s.timeline.any{it.id==id})return s
    val entry=HermesChatEntry(id,v.getString("rootKey"),turn,"assistant","reply",reply.getString("text"),expiry,settled=s.settledReceiptKey==turn)
    val timeline=s.timeline.toMutableList()
    val pending=timeline.indexOfFirst{it.turnKey==turn&&it.kind in setOf("pending","unknown")}
    if(pending>=0)timeline[pending]=entry else timeline+=entry
    return s.copy(timeline=timeline)
}
