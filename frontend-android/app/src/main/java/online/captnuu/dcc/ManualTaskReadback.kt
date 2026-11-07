package online.captnuu.dcc

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** Exact existing GET /planner/manual-tasks envelope; never an AI proposal. */
data class ManualTaskReadback(val version:Long,val tasks:List<JSONObject>)
fun parseManualTaskReadback(response:JSONObject):ManualTaskReadback {
    val version=response.opt("version") as? Number?:error("Missing collection version")
    require(version.toDouble().isFinite()&&version.toDouble()==version.toLong().toDouble()&&version.toLong() in 0..2147483647L)
    val array=response.getJSONObject("data").getJSONArray("tasks")
    require(array.length()<=10000&&array.objects().size==array.length())
    val tasks=array.objects().map { t->
        require(t.opt("id") is String&&Regex("[a-zA-Z0-9_.-]{1,100}").matches(t.getString("id")))
        require(t.opt("title") is String&&t.getString("title").isNotBlank()&&t.getString("title").length<=240)
        require(t.opt("date") is String&&Regex("\\d{4}-\\d{2}-\\d{2}").matches(t.getString("date"))&&LocalDate.parse(t.getString("date")).toString()==t.getString("date"))
        require(t.opt("notes") is String&&t.getString("notes").length<=4000&&t.opt("completed") is Boolean)
        listOf("important","deleted").forEach{k->require(!t.has(k)||t.opt(k) is Boolean)}
        normalizeTask(t) // Also validates recurrence and preserves additive fields.
    }
    require(tasks.map{it.getString("id")}.distinct().size==tasks.size)
    return ManualTaskReadback(version.toLong(),tasks)
}
data class ManualTaskCacheMerge(val tasks:String,val base:String,val version:Long,val conflicts:List<String>)
fun mergeManualTaskReadback(base:String,local:String,remote:ManualTaskReadback,minimumVersion:Long):ManualTaskCacheMerge? {
    if(remote.version<minimumVersion)return null
    fun saved(raw:String):List<JSONObject>{
        val a=JSONArray(raw);require(a.length()<=10000&&a.objects().size==a.length())
        val items=a.objects();require(items.map{it.getString("id")}.distinct().size==items.size)
        return items
    }
    val merged=mergeManualTasks(saved(base),saved(local),remote.tasks)
    return ManualTaskCacheMerge(JSONArray(merged.first.map(::normalizeTask)).toString(),JSONArray(remote.tasks).toString(),remote.version,merged.second)
}
