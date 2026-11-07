package online.captnuu.dcc

import org.junit.Assert.*
import org.junit.Test

class DestinationTest {
    @Test fun destinationsHaveUniqueNamesAndClearDisconnectedDescriptions() {
        assertEquals(4, Destination.entries.map { it.name }.toSet().size)
        assertFalse(Destination.entries.any{it.name=="Prices"})
        assertEquals(Destination.Today,restoredDestination("Prices"))
        Destination.entries.forEach {
            assertEquals(it, Destination.valueOf(it.name))
            assertTrue(it.description.contains("connection"))
        }
    }
}
