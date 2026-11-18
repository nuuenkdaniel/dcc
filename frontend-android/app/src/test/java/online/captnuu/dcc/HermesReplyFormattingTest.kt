package online.captnuu.dcc

import androidx.compose.ui.text.font.FontWeight
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HermesReplyFormattingTest {
    @Test fun calendarReplyUsesBoldSpansForEachMarkedPhrase() {
        val reply = formatHermesReply("Saved on your **Work** calendar for **9:30–10:30 PM Eastern**.")

        assertEquals("Saved on your Work calendar for 9:30–10:30 PM Eastern.", reply.text)
        assertEquals(listOf("Work", "9:30–10:30 PM Eastern"), reply.spanStyles.map {
            assertEquals(FontWeight.Bold, it.item.fontWeight)
            reply.text.substring(it.start, it.end)
        })
    }

    @Test fun incompleteMarkersAndOrdinaryAsterisksRemainVisible() {
        val text = "8 * 7 = 56\n**unfinished"
        val reply = formatHermesReply(text)

        assertEquals(text, reply.text)
        assertTrue(reply.spanStyles.isEmpty())
    }
}
