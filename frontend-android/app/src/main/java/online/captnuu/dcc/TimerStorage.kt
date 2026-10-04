package online.captnuu.dcc

import android.app.*
import android.content.*
import android.os.Build
import org.json.JSONObject
import org.json.JSONArray

/** Persistent deadline, no foreground service or wake lock. */
class TimerStorage(private val context:Context){
 private fun boot()=android.provider.Settings.Global.getInt(context.contentResolver,"boot_count",-1)
 private val prefs=context.getSharedPreferences("dcc-timer",Context.MODE_PRIVATE)
 fun load():Pair<TimerState,Long> = try{
  val d=JSONObject(prefs.getString("state","{}")!!)
  TimerState(focus=d.optInt("focus",25),rest=d.optInt("rest",5),steps=d.optJSONArray("steps").objects().map{FocusStep(it.getString("name"),it.getInt("minutes"))},index=d.optInt("index"),onBreak=d.optBoolean("onBreak"),remaining=d.optLong("remaining",1500),running=d.optBoolean("running")) to (if(d.optInt("boot",-2)==boot()&&boot()>=0)System.currentTimeMillis()+d.optLong("elapsedDeadline")-android.os.SystemClock.elapsedRealtime() else d.optLong("deadline"))
 }catch(_:Exception){TimerState() to 0L}
 fun write(state:TimerState,deadline:Long){
  val d=JSONObject().put("focus",state.focus).put("rest",state.rest).put("steps",JSONArray(state.steps.map{JSONObject().put("name",it.name).put("minutes",it.minutes)})).put("index",state.index).put("onBreak",state.onBreak).put("remaining",state.remaining).put("running",state.running).put("deadline",deadline).put("boot",boot()).put("elapsedDeadline",android.os.SystemClock.elapsedRealtime()+deadline-System.currentTimeMillis())
  check(prefs.edit().putString("state",d.toString()).commit()){"Could not persist timer"};schedule(state,deadline)
 }
 fun advance(now:Long=System.currentTimeMillis()):TimerState{
  val (old,end)=load();val (updated,deadline)=advanceTimer(old,end,now)
  if(old.running&&(old.onBreak!=updated.onBreak||old.index!=updated.index||old.running!=updated.running)){write(updated,deadline);notifyPhase(updated)}
  return updated
 }
 fun schedule(state:TimerState,deadline:Long){
  val manager=context.getSystemService(AlarmManager::class.java)
  val intent=PendingIntent.getBroadcast(context,200,Intent(context,TimerReceiver::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  manager.cancel(intent)
  if(state.running){
   val elapsed=android.os.SystemClock.elapsedRealtime()+deadline-System.currentTimeMillis()
   try{if(Build.VERSION.SDK_INT<31||manager.canScheduleExactAlarms())manager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,elapsed,intent) else manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,elapsed,intent)}catch(_:SecurityException){manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,elapsed,intent)}
  } else context.getSystemService(NotificationManager::class.java).cancel(200)
 }
 private fun notifyPhase(state:TimerState){
  val manager=context.getSystemService(NotificationManager::class.java)
  manager.createNotificationChannel(NotificationChannel("focus","Focus timer",NotificationManager.IMPORTANCE_DEFAULT))
  val open=PendingIntent.getActivity(context,201,Intent(context,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  try{manager.notify(200,Notification.Builder(context,"focus").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(if(state.running)state.label else "Focus session complete").setContentText(if(state.running)"Next phase started" else "Your break has finished.").setContentIntent(open).setAutoCancel(true).build())}catch(_:SecurityException){/* User may decline notifications. Timer remains functional. */}
 }
}
class TimerReceiver:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){val store=TimerStorage(context);store.advance();val (s,d)=store.load();if(s.running)store.schedule(s,d)}}
fun advanceTimer(initial:TimerState,initialDeadline:Long,now:Long):Pair<TimerState,Long>{
 var s=initial;var deadline=initialDeadline
 while(s.running&&now>=deadline){s=nextPhase(s);if(s.running)deadline+=s.remaining*1000}
 return (if(s.running)s.copy(remaining=((deadline-now+999)/1000).coerceAtLeast(0)) else s) to deadline
}
