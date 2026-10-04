package online.captnuu.dcc

import java.time.*

fun readableMail(text:String):String = text.replace("\r\n","\n").replace('\r','\n')
    .split('\n').joinToString("\n") { it.trimEnd(' ', '\t', '\u00a0') }
    .replace(Regex("\\n{3,}"),"\n\n").trim()

fun eventInstant(value:String,zone:ZoneId):Instant = try { OffsetDateTime.parse(value).toInstant() }
    catch (_:Exception) { LocalDateTime.parse(value).atZone(zone).toInstant() }

fun eventOnDay(start:String,end:String,allDay:Boolean,date:LocalDate,zone:ZoneId):Boolean = try {
    if(allDay) date>=LocalDate.parse(start.take(10)) && date<LocalDate.parse(end.take(10))
    else { val s=eventInstant(start,zone);val e=eventInstant(end,zone)
        s<date.plusDays(1).atStartOfDay(zone).toInstant() && (e>date.atStartOfDay(zone).toInstant() || s==e&&s>=date.atStartOfDay(zone).toInstant()) }
} catch (_:Exception) { false }
fun receivedEasternToday(value:String,today:LocalDate=LocalDate.now(ZoneId.of("America/New_York"))):Boolean = try {
    Instant.parse(value).atZone(ZoneId.of("America/New_York")).toLocalDate()==today
} catch (_:Exception) { false }
