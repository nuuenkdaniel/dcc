package online.captnuu.dcc
import org.json.JSONObject
import org.json.JSONArray
fun containsSubmitted(saved:Any?,submitted:Any?):Boolean=when(submitted){
 is JSONObject -> saved is JSONObject && submitted.keys().asSequence().all{saved.has(it)&&containsSubmitted(saved.opt(it),submitted.opt(it))}
 is JSONArray -> saved is JSONArray && saved.length()==submitted.length() && (0 until submitted.length()).all{containsSubmitted(saved.opt(it),submitted.opt(it))}
 is Number -> saved is Number && submitted.toDouble()==saved.toDouble()
 else -> saved==submitted
}
