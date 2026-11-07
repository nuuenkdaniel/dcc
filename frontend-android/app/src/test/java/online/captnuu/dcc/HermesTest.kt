package online.captnuu.dcc
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
class HermesTest {
    // Wire projection fixture only, not a claim that these synthetic IDs exist.
    private fun receipt()=JSONObject("""{"version":1,"key":"conversation_answer_01","outcome":"complete","line":"Added 3/3 tasks · 2026-11-07","verified":3,"expected":3,"targets":[{"kind":"task","id":"task1","action":"added","title":"CSE354: Lectures","date":"2026-11-07","state":"applied","verification":"verified","before":{},"after":{"title":"CSE354: Lectures","date":"2026-11-07","completed":false}},{"kind":"task","id":"task2","action":"added","title":"CSE354: practice problems","date":"2026-11-07","state":"applied","verification":"verified"},{"kind":"task","id":"task3","action":"added","title":"CSE354: review","date":"2026-11-07","state":"applied","verification":"verified"}]}""")
    @Test fun countsAreDistinctAndReadbackRequired(){
        val r=receipt();assertTrue(validHermesReceipt(r))
        r.getJSONArray("targets").getJSONObject(2).put("id","task2");assertFalse(validHermesReceipt(r))
        val uncertain=receipt();uncertain.getJSONArray("targets").getJSONObject(0).put("verification","unavailable");assertFalse(validHermesReceipt(uncertain))
    }
    @Test fun partialIsNotDone(){val r=receipt().put("outcome","partial").put("verified",2);r.getJSONArray("targets").remove(2);assertTrue(validHermesReceipt(r));r.put("outcome","complete");assertFalse(validHermesReceipt(r))}
    @Test fun sharedUtf16AndUtf8Caps(){assertTrue(hermesTextFits(listOf("a".repeat(4000))));assertFalse(hermesTextFits(listOf("a".repeat(4000),"x")));assertFalse(hermesTextFits(listOf("界".repeat(3000))));assertFalse(hermesTextFits(listOf("bad\u0000")));assertFalse(hermesTextFits(listOf("\ud800")))}
    @Test fun htmlAndUnboundedFieldsNotAllowed(){val r=receipt();r.getJSONArray("targets").getJSONObject(0).getJSONObject("after").put("html","<b>untrusted</b>");assertFalse(validHermesReceipt(r))}
}
