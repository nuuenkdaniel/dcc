package online.captnuu.dcc
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
class OfflineTest {
 class Memory:SessionStorage{var raw:String?=null;override fun read()=raw;override fun write(value:String){raw=value};override fun clear(){raw=null}}
 fun task(id:String,title:String=id)=JSONObject().put("id",id).put("title",title).put("date","2026-10-04")
 @Test fun mergeDeletionAndConcurrentEdit(){val result=mergeManualTasks(listOf(task("a"),task("b")),listOf(task("a","mine")),listOf(task("a"),task("b"),task("c")));assertEquals(listOf("a","c"),result.first.map{it.getString("id")});assertTrue(result.second.isEmpty())}
 @Test fun mergeConflicts(){assertEquals(listOf("a"),mergeManualTasks(listOf(task("a")),listOf(task("a","mine")),listOf(task("a","theirs"))).second)}
 @Test fun durableQueue(){val storage=Memory();val q=MutationQueue(storage);val body=JSONObject().put("kind","project").put("version",3).put("data",task("a"));val key=q.enqueue("/api/v1/planner/entity",body);assertEquals(3,MutationQueue(storage).list().single().getJSONObject("body").getInt("version"));q.failure(key,"Conflict");assertEquals("Conflict",MutationQueue(storage).list().single().getString("error"));q.remove(key);assertTrue(MutationQueue(storage).list().isEmpty())}
 @Test fun priceValidation(){assertEquals(280000,targetCents("2800.00"));assertNull(targetCents("1.001"));assertNull(targetCents("-1"));assertNull(targetCents("n/a"))}
 @Test fun normalizedNoOpTaskSyncPreservesOrderAndTombstones(){
  val remote=listOf(task("a"),task("b"))
  assertFalse(manualTasksNeedWrite(listOf(task("a"),task("b")),remote))
  assertTrue(manualTasksNeedWrite(listOf(task("b"),task("a")),remote))
  assertTrue(manualTasksNeedWrite(listOf(task("a")),remote))
 }
 @Test fun tombstonesSurviveNormalizationNoOpAndMerge(){
  val live=task("a");val deleted=JSONObject(live.toString()).put("deleted",true)
  assertTrue(normalizeTask(deleted).getBoolean("deleted"))
  assertFalse(manualTasksNeedWrite(listOf(deleted),listOf(deleted)))
  val merged=mergeManualTasks(listOf(live),listOf(live),listOf(deleted)).first.single()
  assertTrue(merged.getBoolean("deleted"))
  assertFalse(manualTaskVisible(merged,"2026-10-04","",false))
 }
}
