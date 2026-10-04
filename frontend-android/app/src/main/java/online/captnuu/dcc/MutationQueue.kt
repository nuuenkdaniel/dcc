package online.captnuu.dcc
import org.json.JSONArray
import org.json.JSONObject

class MutationQueue(private val storage:SessionStorage){
 private var loaded=false
 private var entries=mutableListOf<JSONObject>()
 @Synchronized fun load(){if(!loaded){entries=storage.read()?.let{JSONArray(it).objects().toMutableList()}?:mutableListOf();loaded=true}}
 @Synchronized fun list():List<JSONObject>{load();return entries.map{JSONObject(it.toString())}}
 private fun persist(next:List<JSONObject>){storage.write(JSONArray(next).toString());entries=next.toMutableList()}
 @Synchronized fun enqueue(path:String,body:JSONObject):String {
  load();require(path in listOf("/api/v1/planner/entity","/api/v1/calendar/changes"))
  val id=if(path.endsWith("entity"))body.getJSONObject("data").getString("id") else body.getString("id")
  val key="$path:$id"
  check(entries.none{it.getString("key")==key}){"This item has an unsent edit. Sync or discard it before editing again."}
  persist(entries+JSONObject().put("key",key).put("path",path).put("body",JSONObject(body.toString())))
  return key
 }
 @Synchronized fun retry(key:String){load();persist(entries.map{if(it.getString("key")==key)JSONObject(it.toString()).apply{remove("error")} else it})}
 @Synchronized fun remove(key:String){load();persist(entries.filter{it.getString("key")!=key})}
 @Synchronized fun failure(key:String,message:String){load();persist(entries.map{if(it.getString("key")==key)JSONObject(it.toString()).put("error",message) else it})}
}
