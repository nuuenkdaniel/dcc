package online.captnuu.dcc
import org.json.JSONObject

fun normalizeTask(t:JSONObject)=JSONObject().put("id",t.getString("id")).put("title",t.optString("title")).put("date",t.optString("date")).put("notes",t.optString("notes")).put("completed",t.optBoolean("completed")).put("important",t.optBoolean("important")).put("deleted",t.optBoolean("deleted"))
fun manualTasksNeedWrite(merged:List<JSONObject>,remote:List<JSONObject>)=merged.map(::normalizeTask).map{it.toString()}!=remote.map(::normalizeTask).map{it.toString()}
fun manualTaskVisible(task:JSONObject,date:String,search:String,onlyOpen:Boolean)=!task.optBoolean("deleted")&&task.optString("date")==date&&task.optString("title").contains(search,true)&&(!onlyOpen||!task.optBoolean("completed"))
fun mergeManualTasks(base:List<JSONObject>,local:List<JSONObject>,remote:List<JSONObject>,choice:String?=null):Pair<List<JSONObject>,List<String>> {
 fun index(items:List<JSONObject>)=items.associate{it.getString("id") to normalizeTask(it)}
 val b=index(base);val l=index(local);val r=index(remote);val result=mutableListOf<JSONObject>();val conflicts=mutableListOf<String>()
 fun equal(a:JSONObject?,other:JSONObject?)=a?.toString()==other?.toString()
 for(id in b.keys+l.keys+r.keys){val old=b[id];val mine=l[id];val theirs=r[id]
  val selected=if(equal(mine,old))theirs else if(equal(theirs,old)||equal(mine,theirs))mine else {conflicts.add(id);if(choice=="remote")theirs else mine}
  selected?.let{result.add(it)}
 }
 return result to conflicts
}
