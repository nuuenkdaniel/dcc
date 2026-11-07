package online.captnuu.dcc
import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
// Same asset asserted against production backend projection by
// backend/test/mcp/conversation-fixtures.test.ts; no private/live records.
internal fun hermesWireFixtures():JSONObject {
        val name="src/androidTest/assets/hermes-conversation.json"
        val file=listOf(File(name),File("app/$name"),File("frontend-android/app/$name")).firstOrNull{it.isFile}?:error("Shared Hermes fixture asset missing")
        return JSONObject(file.readText(Charsets.UTF_8))
}
class HermesWireFixtureTest {
    @Test fun mapsQuestionAndReceiptWithoutTranscribingOpaqueIds(){
        val fixture=hermesWireFixtures();val q=fixture.getJSONObject("question");val done=fixture.getJSONObject("complete")
        assertTrue(validHermesView(q));assertTrue(validHermesView(done))
        assertEquals("task_topics",q.getJSONObject("question").getString("reason"))
        val targets=done.getJSONObject("receipt").getJSONArray("targets").objects()
        assertEquals(listOf("synthetic-task-1","synthetic-task-2","synthetic-task-3"),targets.map{it.getString("id")})
        assertEquals("CSE354: practice problems",targets[1].getString("title"));assertEquals("2026-11-07",targets[1].getString("date"))
        assertFalse(done.has("original"));assertFalse(done.has("question"))
        val forged=JSONObject(done.toString());forged.getJSONObject("receipt").getJSONArray("targets").remove(2)
        assertFalse(validHermesView(forged))
    }
    @Test fun malformedNumericAndQuestionContractsAreRejected(){
        val q=hermesWireFixtures().getJSONObject("question");q.put("questions","1");assertFalse(validHermesView(q))
        val another=hermesWireFixtures().getJSONObject("question");another.getJSONObject("question").put("question","All three done!");assertFalse(validHermesView(another))
    }
}
