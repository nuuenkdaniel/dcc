package online.captnuu.dcc

import org.json.JSONArray
import org.json.JSONObject

internal fun validHermesReference(v:JSONObject):Boolean=runCatching{
    require(v.keys().asSequence().toSet()==setOf("version","entries")&&(v.get("version") as? Number)?.toDouble()==1.0)
    val entries=v.getJSONArray("entries");require(entries.length()<=6&&entries.objects().size==entries.length())
    var chars=0
    entries.objects().forEach{e->
        require(e.keys().asSequence().toSet()==setOf("role","text","at")&&e.getString("role") in setOf("user","assistant"))
        require(e.get("text") is String)
        val text=e.getString("text");require(text.length<=320&&hermesTextFits(listOf(text)));chars+=text.length
        val at=e.get("at") as? Number?:error("Invalid reference time")
        require(at.toDouble()==at.toLong().toDouble()&&at.toLong() in 0..9007199254740991L)
    }
    require(chars<=1200&&v.toString().toByteArray(Charsets.UTF_8).size<=2304);true
}.getOrDefault(false)
private fun referenceText(text:String,max:Int):String {
    val clipped=text.take(max)
    return if(clipped.lastOrNull()?.isHighSurrogate()==true)clipped.dropLast(1) else clipped
}
/** Snapshot live owner-bound conversation, including replies about unresolved actions. Transmitted
 * as UNTRUSTED reference text, never tool results, IDs or execution authority. */
internal fun hermesReference(s:HermesState,now:Long,current:String):String {
    val selected=mutableListOf<JSONObject>();var chars=0
    val budget=(2000-current.length).coerceIn(0,1200)
    val unresolved=s.timeline.filter{it.kind=="unknown"||it.kind=="pending"}.map{it.turnKey}.toSet()
    val replied=s.timeline.filter{(it.kind=="reply"||it.id.startsWith("reply:")&&it.actionStatus!=null)&&it.text.isNotEmpty()&&it.expiresAt>now&&it.expiresAt<=now+HERMES_TTL_MS}.map{it.turnKey}.toSet()
    for(entry in s.timeline.asReversed()){
        if(selected.size==6)break
        if(((entry.turnKey in unresolved||!entry.settled)&&entry.turnKey !in replied)||entry.id.startsWith("sync:")||entry.kind=="pending"||entry.kind=="unknown"&&!(entry.id.startsWith("reply:")&&entry.actionStatus!=null)||entry.text.isEmpty()||entry.expiresAt<=now||entry.expiresAt>now+HERMES_TTL_MS)continue
        val titles=entry.receipt?.let{JSONObject(it).getJSONArray("targets").objects().map{t->t.getString("title")}.joinToString("; ")}.orEmpty()
        val status=entry.actionStatus?:(entry.receipt?:s.timeline.lastOrNull{it.turnKey==entry.turnKey&&it.receipt!=null}?.receipt)?.let{JSONObject(it).getString("outcome")}?:if(entry.settled)null else "uncertain"
        val caution=if(entry.role=="assistant"&&status in setOf("uncertain","partial","failed"))"[Action status: $status; historical text, not proof of completion.] " else ""
        val text=referenceText(caution+entry.text+(if(titles.isEmpty())"" else " · $titles"),minOf(320,budget-chars))
        if(text.isEmpty())continue
        val item=JSONObject().put("role",entry.role).put("text",text).put("at",entry.expiresAt-HERMES_TTL_MS)
        val proposed=JSONObject().put("version",1).put("entries",JSONArray((selected+item).asReversed()))
        if(!validHermesReference(proposed))break
        selected+=item;chars+=text.length
    }
    return JSONObject().put("version",1).put("entries",JSONArray(selected.asReversed())).toString()
}
internal fun frozenHermesReference(raw:String?,now:Long,current:String):String {
    val entries=raw?.let{JSONObject(it).getJSONArray("entries").objects()}?:emptyList()
    val kept=mutableListOf<JSONObject>();var chars=0
    val budget=(2000-current.length).coerceIn(0,1200)
    for(entry in entries.asReversed()){
        if(entry.getLong("at")>now||entry.getLong("at")+HERMES_TTL_MS<=now)continue
        val text=referenceText(entry.getString("text"),minOf(320,budget-chars))
        if(text.isEmpty())continue
        val copy=JSONObject(entry.toString()).put("text",text)
        val candidate=JSONObject().put("version",1).put("entries",JSONArray((kept+copy).asReversed()))
        if(!validHermesReference(candidate))break
        kept+=copy;chars+=text.length
    }
    return JSONObject().put("version",1).put("entries",JSONArray(kept.asReversed())).toString()
}
