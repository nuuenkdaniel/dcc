package online.captnuu.dcc
import org.json.JSONObject
import org.json.JSONArray
fun workspaceSnapshot(state:WorkspaceState,name:String):JSONObject {
 val snapshot=state.snapshots[name]?.let{JSONObject(it)}?:JSONObject()
 if(name=="planner")for(raw in state.pending){val entry=JSONObject(raw);if(entry.optString("path")!="/api/v1/planner/entity")continue;val body=entry.getJSONObject("body");val kind=body.getString("kind");val field=if(kind=="preparation")"preparations" else kind+"s";val data=body.getJSONObject("data");val updated=JSONObject().put("data",data).put("kind",kind).put("version",body.getInt("version")).put("pending",true)
  snapshot.put(field,JSONArray(snapshot.optJSONArray(field).objects().filter{it.getJSONObject("data").getString("id")!=data.getString("id")}+updated))
 }
 if(name=="calendar")for(raw in state.pending){val entry=JSONObject(raw);if(entry.optString("path")!="/api/v1/calendar/changes")continue;val body=entry.getJSONObject("body");val id=body.optString("eventId",body.getString("id"));val events=snapshot.optJSONArray("events").objects().filter{it.optString("id")!=id}
  snapshot.put("events",JSONArray(if(body.optString("operation")=="delete")events else events+JSONObject(body.toString()).put("id",id).put("pending",true)))
 }
 return snapshot
}
