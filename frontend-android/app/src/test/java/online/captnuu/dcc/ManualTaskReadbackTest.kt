package online.captnuu.dcc
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
class ManualTaskReadbackTest {
    private fun task(id:String,title:String=id)=JSONObject().put("id",id).put("title",title).put("date","2026-11-07").put("notes","").put("completed",false)
    private fun snapshot(version:Long,tasks:List<JSONObject>)=JSONObject().put("version",version).put("data",JSONObject().put("tasks",JSONArray(tasks)))
    @Test fun exactHttpEnvelopeRetainsUnknownFieldsAndVersions(){
        val remote=parseManualTaskReadback(snapshot(3,listOf(task("a").put("future",JSONObject().put("retained",true)))))
        assertEquals(3L,remote.version);assertTrue(remote.tasks.single().getJSONObject("future").getBoolean("retained"))
        assertNull(mergeManualTaskReadback("[]","[]",remote,4))
        assertTrue(runCatching{parseManualTaskReadback(snapshot(3,listOf(task("a"))).put("version","3"))}.isFailure)
        assertTrue(runCatching{parseManualTaskReadback(snapshot(3,listOf(task("a"),task("a"))))}.isFailure)
    }
    @Test fun readonlyMergePreservesDirtyLocalAndDeletionMarkersWithoutWrite(){
        val original=task("a");val deleted=task("b").put("deleted",true)
        val base=JSONArray(listOf(original,deleted)).toString()
        val local=JSONArray(listOf(task("a","offline edit"),deleted,task("offline-new"))).toString()
        val remote=parseManualTaskReadback(snapshot(8,listOf(original,deleted,task("server-new"))))
        val merged=mergeManualTaskReadback(base,local,remote,7)!!
        assertTrue(merged.conflicts.isEmpty());assertEquals("offline edit",JSONArray(merged.tasks).objects().first{it.getString("id")=="a"}.getString("title"))
        assertTrue(JSONArray(merged.tasks).objects().first{it.getString("id")=="b"}.getBoolean("deleted"))
        assertEquals(setOf("a","b","offline-new","server-new"),JSONArray(merged.tasks).objects().map{it.getString("id")}.toSet())
        assertTrue(manualTasksNeedWrite(JSONArray(merged.tasks).objects(),remote.tasks)) // dirty edits remain dirty, NOT silently posted
        assertEquals(8L,merged.version)
    }
    @Test fun conflictsDoNotAuthorizeReplacingTheLocalCacheAndNoopStaysNoop(){
        val base=JSONArray(listOf(task("a"))).toString();val local=JSONArray(listOf(task("a","mine"))).toString()
        val remote=parseManualTaskReadback(snapshot(2,listOf(task("a","theirs"))))
        assertEquals(listOf("a"),mergeManualTaskReadback(base,local,remote,1)!!.conflicts)
        val noop=mergeManualTaskReadback(base,base,parseManualTaskReadback(snapshot(2,listOf(task("a")))),1)!!
        assertFalse(manualTasksNeedWrite(JSONArray(noop.tasks).objects(),JSONArray(noop.base).objects()))
    }
}
