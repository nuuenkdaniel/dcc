package online.captnuu.dcc
import java.math.BigDecimal

fun targetCents(text:String):Int?=runCatching{BigDecimal(text).movePointRight(2).intValueExact().takeIf{it in 1..10000000}}.getOrNull()
// Historical numeric parser only. Tracker UI, settings and provider entrypoints
// are retired; this helper cannot read, schedule or mutate anything.
