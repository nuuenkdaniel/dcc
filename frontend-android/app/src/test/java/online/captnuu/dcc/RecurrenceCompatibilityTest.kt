package online.captnuu.dcc

import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*

class RecurrenceCompatibilityTest {
 private fun task()=JSONObject("""{"id":"weekly","title":"Synthetic","date":"2026-10-02","notes":"","completed":false,"recurrence":{"version":1,"kind":"template","frequency":"weekly","weekday":5,"startDate":"2026-10-02","paused":false},"extension":{"b":2,"a":1}}""")
 @Test fun normalizationAndLocalEditRetainAllMetadata(){
  val old=task();val edited=JSONObject(old.toString()).put("title","Edited").put("completed",true)
  val normalized=normalizeTask(edited)
  assertTrue(normalized.has("recurrence"));assertTrue(normalized.has("extension"))
  assertTrue(normalized.getBoolean("completed"))
  assertFalse(manualTasksNeedWrite(listOf(old),listOf(JSONObject(old.toString()).put("extension",JSONObject("""{"a":1,"b":2}""")))))
  assertEquals("Edited",mergeManualTasks(listOf(old),listOf(edited),listOf(old)).first.single().getString("title"))
 }
 @Test fun recurrenceChangesAreVersionedConflicts(){
  val old=task();val mine=task();mine.getJSONObject("recurrence").put("paused",true)
  val theirs=task();theirs.getJSONObject("recurrence").put("weekday",3)
  assertTrue(manualTasksNeedWrite(listOf(mine),listOf(old)))
  assertEquals(listOf("weekly"),mergeManualTasks(listOf(old),listOf(mine),listOf(theirs)).second)
 }
 @Test fun malformedOrStrippedRecurrenceFailsClosed(){
  for(value in listOf(JSONObject.NULL,JSONObject(),task().getJSONObject("recurrence").put("weekday",7),task().getJSONObject("recurrence").put("extra",true))){
   try{normalizeTask(task().put("recurrence",value));fail("must reject malformed recurrence")}catch(_:IllegalArgumentException){}
  }
  val old=task();val stripped=task().apply{remove("recurrence")}
  try{mergeManualTasks(listOf(old),listOf(stripped),listOf(old),"local");fail("must reject stripping")}catch(_:IllegalArgumentException){}
 }
 @Test fun omittedCompletedDeletedOccurrenceRemainsATombstone(){
  val old=task().put("id","occ.weekly.2026-10-09").put("completed",true).put("deleted",true).put("recurrence",JSONObject("""{"version":1,"kind":"occurrence","templateId":"weekly","sourceDate":"2026-10-09"}"""))
  val result=mergeManualTasks(listOf(old),emptyList(),listOf(old)).first.single()
  assertTrue(result.getBoolean("completed"));assertTrue(result.getBoolean("deleted"));assertTrue(result.has("extension"));assertTrue(result.has("recurrence"))
 }
}
