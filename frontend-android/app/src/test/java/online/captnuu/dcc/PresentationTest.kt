package online.captnuu.dcc
import org.junit.Assert.*
import org.junit.Test
import java.time.*
class PresentationTest {
 @Test fun whitespacePreservesParagraphsAndIndentation(){assertEquals("Title\n\n  code\nNext",readableMail("\nTitle\r\n \r\n\r\n\r\n  code\nNext\n"))}
 @Test fun midnightAndExclusiveEnd(){val zone=ZoneId.of("America/New_York");assertTrue(eventOnDay("2026-10-04T02:00:00Z","2026-10-04T04:00:00Z",false,LocalDate.parse("2026-10-03"),zone));assertFalse(eventOnDay("2026-10-04T02:00:00Z","2026-10-04T04:00:00Z",false,LocalDate.parse("2026-10-04"),zone))}
 @Test fun allDaySpansDates(){assertTrue(eventOnDay("2026-10-03","2026-10-05",true,LocalDate.parse("2026-10-04"),ZoneId.of("UTC")));assertFalse(eventOnDay("2026-10-03","2026-10-05",true,LocalDate.parse("2026-10-05"),ZoneId.of("UTC")))}
 @Test fun briefingUsesEasternDate(){assertTrue(receivedEasternToday("2026-10-04T02:00:00Z",LocalDate.parse("2026-10-03")));assertFalse(receivedEasternToday("invalid"))}
}
