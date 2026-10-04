package online.captnuu.dcc
import org.junit.Assert.*
import org.junit.Test
class TimerTest {
 @Test fun focusThenBreakThenStop(){val s=TimerState(running=true);val b=nextPhase(s);assertTrue(b.onBreak);assertEquals(300L,b.remaining);val done=nextPhase(b);assertFalse(done.running);assertFalse(done.onBreak);assertEquals(1500L,done.remaining)}
 @Test fun miniSequenceDoesNotBreakEarly(){val s=TimerState(steps=listOf(FocusStep("First",2),FocusStep("Second",3)),running=true);val second=nextPhase(s);assertEquals(1,second.index);assertFalse(second.onBreak);assertEquals(180L,second.remaining);assertTrue(nextPhase(second).onBreak)}
}
