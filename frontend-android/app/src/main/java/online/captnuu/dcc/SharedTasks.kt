package online.captnuu.dcc
import org.json.JSONObject

// Canonicalize object keys only, retaining every additive JSON value.
private fun canonicalTaskValue(value:Any?):String=when(value){
 is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",","{","}"){JSONObject.quote(it)+":"+canonicalTaskValue(value.get(it))}
 is org.json.JSONArray -> (0 until value.length()).joinToString(",","[","]"){canonicalTaskValue(value.get(it))}
 is String -> JSONObject.quote(value)
 is Number -> JSONObject.numberToString(value)
 else -> value?.toString()?:"null"
}
private fun validTaskDate(value:Any?):Boolean=value is String&&Regex("\\d{4}-\\d{2}-\\d{2}").matches(value)&&runCatching{java.time.LocalDate.parse(value).toString()==value}.getOrDefault(false)
private fun validRecurrence(t:JSONObject):Boolean {
 if(!t.has("recurrence"))return true
 val r=t.opt("recurrence") as? JSONObject?:return false
 val keys=r.keys().asSequence().toSet()
 if(r.opt("version") !is Number||r.optDouble("version")!=1.0)return false
 return when(r.optString("kind")){
  "template" -> Regex("[a-zA-Z0-9_.-]{1,80}").matches(t.getString("id"))&&keys==setOf("version","kind","frequency","weekday","startDate","paused")&&r.opt("frequency")=="weekly"&&r.opt("weekday") is Number&&r.optDouble("weekday") in 0.0..6.0&&r.optDouble("weekday")%1.0==0.0&&validTaskDate(r.opt("startDate"))&&r.opt("paused") is Boolean
  "occurrence" -> keys==setOf("version","kind","templateId","sourceDate")&&r.opt("templateId") is String&&Regex("[a-zA-Z0-9_.-]{1,80}").matches(r.getString("templateId"))&&validTaskDate(r.opt("sourceDate"))&&t.getString("id")=="occ.${r.getString("templateId")}.${r.getString("sourceDate")}"
  else -> false
 }
}
fun normalizeTask(t:JSONObject):JSONObject {
 require(validRecurrence(t)){"Invalid recurrence metadata; saved tasks were retained."}
 return JSONObject(t.toString()).put("id",t.getString("id")).put("title",t.optString("title")).put("date",t.optString("date")).put("notes",t.optString("notes")).put("completed",t.optBoolean("completed")).put("important",t.optBoolean("important")).put("deleted",t.optBoolean("deleted"))
}
private fun requireRecurrencePreserved(old:JSONObject?,next:JSONObject?){
 val before=old?.optJSONObject("recurrence")?:return
 val after=next?.optJSONObject("recurrence")
 require(after!=null&&before.getString("kind")==after.optString("kind")&&(before.getString("kind")!="occurrence"||canonicalTaskValue(before)==canonicalTaskValue(after))){"Existing recurrence metadata cannot be removed or its occurrence source changed. Use a compatible client; saved tasks were retained."}
}
fun manualTasksNeedWrite(merged:List<JSONObject>,remote:List<JSONObject>)=merged.map(::normalizeTask).map(::canonicalTaskValue)!=remote.map(::normalizeTask).map(::canonicalTaskValue)
fun manualTaskVisible(task:JSONObject,date:String,search:String,onlyOpen:Boolean)=!task.optBoolean("deleted")&&task.optString("date")==date&&task.optString("title").contains(search,true)&&(!onlyOpen||!task.optBoolean("completed"))
fun mergeManualTasks(base:List<JSONObject>,local:List<JSONObject>,remote:List<JSONObject>,choice:String?=null):Pair<List<JSONObject>,List<String>> {
 fun index(items:List<JSONObject>)=items.associate{it.getString("id") to normalizeTask(it)}
 val b=index(base);val l=index(local);val r=index(remote);val result=mutableListOf<JSONObject>();val conflicts=mutableListOf<String>()
  fun equal(a:JSONObject?,other:JSONObject?)=canonicalTaskValue(a)==canonicalTaskValue(other)
  for(id in b.keys+l.keys+r.keys){val old=b[id]
   val mine=l[id]?:old?.let{JSONObject(it.toString()).put("deleted",true)}
   val theirs=r[id]?:old?.let{JSONObject(it.toString()).put("deleted",true)}
   requireRecurrencePreserved(old,mine);requireRecurrencePreserved(old,theirs)
   if(mine!=null&&theirs!=null){requireRecurrencePreserved(mine,theirs);requireRecurrencePreserved(theirs,mine)}
   val selected=if(old==null&&mine!=null&&theirs!=null&&mine.optBoolean("deleted")!=theirs.optBoolean("deleted")){if(mine.optBoolean("deleted"))mine else theirs} else if(equal(mine,old))theirs else if(equal(theirs,old)||equal(mine,theirs))mine else {conflicts.add(id);if(choice=="remote")theirs else mine}
   selected?.let{picked->
    val retained=JSONObject(old?.toString()?:"{}")
    picked.keys().forEach{key->retained.put(key,picked.get(key))}
    result.add(retained)
   }
 }
 return result to conflicts
}
