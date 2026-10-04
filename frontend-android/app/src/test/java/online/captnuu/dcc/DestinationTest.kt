package online.captnuu.dcc

import org.junit.Assert.*
import org.junit.Test

class DestinationTest {
    @Test fun destinationsHaveUniqueNamesAndClearDisconnectedDescriptions() {
        assertEquals(5, Destination.entries.map { it.name }.toSet().size)
        Destination.entries.forEach {
            assertEquals(it, Destination.valueOf(it.name))
            assertTrue(it.description.contains("connection"))
        }
    }
}
