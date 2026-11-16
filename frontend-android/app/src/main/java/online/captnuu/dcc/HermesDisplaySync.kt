package online.captnuu.dcc

import kotlinx.coroutines.*
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate

/** Display facts only. No command, prose parser, provider refresh or mutation API. */
internal fun validHermesDisplaySync(v:JSONObject):Boolean=runCatching{
    fun JSONObject.exact(vararg names:String)=keys().asSequence().toSet()==names.toSet()
    fun JSONObject.number(name:String,min:Long,max:Long){val n=get(name) as? Number?:error("Number");require(n.toDouble()==n.toLong().toDouble()&&n.toLong() in min..max)}
    fun JSONObject.text(name:String,max:Int){require(get(name) is String&&getString(name).isNotBlank()&&getString(name).length<=max)}
    require(v.exact("version","tasks","calendar"));v.number("version",1,1)
    require(v.toString().toByteArray(Charsets.UTF_8).size<=16384)
    val tasks=v.getJSONArray("tasks");val calendar=v.getJSONArray("calendar")
    require(tasks.length()+calendar.length() in 1..16)
    tasks.objects().forEach{t->
        require(t.exact("id","version","after"));t.text("id",100);t.number("version",1,2147483647)
        require(Regex("[a-zA-Z0-9_.-]{1,100}").matches(t.getString("id")))
        val after=t.getJSONObject("after")
        require(after.keys().asSequence().all{it in setOf("title","date","completed","deleted","important")})
        after.text("title",240);after.text("date",10);LocalDate.parse(after.getString("date"))
        for(k in listOf("completed","deleted","important"))if(after.has(k))require(after.get(k) is Boolean)
    }
    calendar.objects().forEach{c->
        require(c.exact("mutationId","calendarId","resourceKey","uid","start","end","allDay","deleted","recurrenceId"))
        c.text("mutationId",100);c.text("calendarId",500);c.text("start",64);c.text("end",64)
        require(c.get("allDay") is Boolean&&c.get("deleted") is Boolean)
        if(!c.isNull("resourceKey"))require(Regex("[a-f0-9]{64}").matches(c.getString("resourceKey")))
        for(k in listOf("uid","recurrenceId"))if(!c.isNull(k))c.text(k,500)
        if(c.getBoolean("allDay")){LocalDate.parse(c.getString("start").take(10));LocalDate.parse(c.getString("end").take(10))}
        else{Instant.parse(c.getString("start"));Instant.parse(c.getString("end"))}
    }
    require(tasks.objects().size==tasks.length()&&calendar.objects().size==calendar.length())
    require(tasks.objects().map{it.getString("id")}.distinct().size==tasks.length())
    require(calendar.objects().map{it.getString("mutationId")}.distinct().size==calendar.length())
    true
}.getOrDefault(false)

internal fun hermesTasksPresent(facts:List<JSONObject>,remote:ManualTaskReadback):Boolean = facts.all{f->
    remote.version>=f.getLong("version")&&remote.tasks.any{t->
        t.getString("id")==f.getString("id")&&f.getJSONObject("after").let{after->after.keys().asSequence().all{k->
            if(k in setOf("completed","deleted","important"))t.optBoolean(k)==after.getBoolean(k) else t.opt(k)==after.get(k)
        }}
    }
}
internal fun hermesCalendarPresent(facts:List<JSONObject>,snapshot:JSONObject):Boolean = facts.all{f->
    // Absence alone cannot prove a deletion or a series change was synced.
    !f.getBoolean("deleted")&&!f.isNull("resourceKey")&&!f.isNull("uid")&&
        snapshot.optJSONArray("calendars").objects().any{it.optString("id")==f.getString("calendarId")}&&snapshot.optJSONArray("events").objects().any{e->
        fun sameTime(name:String)=runCatching{
            if(f.getBoolean("allDay"))e.getString(name).take(10)==f.getString(name).take(10)
            else Instant.parse(e.getString(name))==Instant.parse(f.getString(name))
        }.getOrDefault(false)
        val resource=e.optString("resource")
        val digest=MessageDigest.getInstance("SHA-256").digest(resource.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
        e.optString("calendarId")==f.getString("calendarId")&&digest==f.getString("resourceKey")&&e.optString("uid")==f.getString("uid")&&
            e.optString("mutationId")==f.getString("mutationId")&&e.optBoolean("allDay")==f.getBoolean("allDay")&&
            (if(f.isNull("recurrenceId"))e.isNull("recurrenceId") else e.optString("recurrenceId")==f.getString("recurrenceId"))&&sameTime("start")&&sameTime("end")
    }
}
internal data class HermesDisplaySyncTiming(
    val offsets:List<Long> = listOf(0,5000,15000,30000,50000,75000),
    val readMillis:Long=12000,val budgetMillis:Long=90000
){init{require(offsets.size in 1..6&&offsets.first()==0L&&offsets.zipWithNext().all{it.first<=it.second}&&offsets.all{it in 0..75000});require(readMillis in 1..12000&&budgetMillis in 1..90000)}}
internal enum class HermesCalendarSyncResult { CONFIRMED, PENDING, ERROR }
internal suspend fun readHermesCalendar(
    facts:List<JSONObject>,timing:HermesDisplaySyncTiming,current:()->Boolean,
    read:suspend ()->JSONObject,publish:suspend (JSONObject)->Unit
):HermesCalendarSyncResult {
    val start=System.nanoTime()/1000000
    return try{withTimeout(timing.budgetMillis) budget@{
        for(offset in timing.offsets){
            delay((start+offset-System.nanoTime()/1000000).coerceAtLeast(0))
            currentCoroutineContext().ensureActive();if(!current())throw CancellationException()
            val snapshot=try{withTimeout(timing.readMillis){read()}}catch(_:TimeoutCancellationException){currentCoroutineContext().ensureActive();return@budget HermesCalendarSyncResult.ERROR}
            if(!current())throw CancellationException()
            publish(snapshot)
            if(hermesCalendarPresent(facts,snapshot))return@budget HermesCalendarSyncResult.CONFIRMED
        }
        HermesCalendarSyncResult.PENDING
    }}catch(_:TimeoutCancellationException){HermesCalendarSyncResult.PENDING}
    catch(error:CancellationException){throw error}
    catch(_:Exception){HermesCalendarSyncResult.ERROR}
}
