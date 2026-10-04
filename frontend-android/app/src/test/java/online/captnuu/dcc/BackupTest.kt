package online.captnuu.dcc
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
class BackupTest {
 @Test fun validBackup(){assertEquals("x",validatedTaskBackup("""[{"id":"x","title":"Study","date":"2026-10-04","notes":"","completed":false}]""").single().getString("id"))}
 @Test(expected=IllegalArgumentException::class) fun rejectsBadDate(){validatedTaskBackup("""[{"id":"x","title":"Study","date":"not-a-date","notes":"","completed":false}]""")}
 @Test fun readbackRequiresEverySubmittedField(){assertTrue(containsSubmitted(JSONObject("""{"id":"x","title":"new","extra":true}"""),JSONObject("""{"id":"x","title":"new"}""")));assertFalse(containsSubmitted(JSONObject("""{"id":"x","title":"old"}"""),JSONObject("""{"id":"x","title":"new"}""")))}
}
