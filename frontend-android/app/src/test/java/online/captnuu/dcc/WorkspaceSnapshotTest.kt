package online.captnuu.dcc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceSnapshotTest {
    @Test fun confirmedCalendarIsUnchangedWhenAProvisionalWriteRollsBack() {
        val canonical = """{"events":[{"id":"event","title":"Confirmed"}]}"""
        val pending = """{"path":"/api/v1/calendar/changes","body":{"id":"request","eventId":"event","title":"Provisional"}}"""
        val state = WorkspaceState(snapshots=mapOf("calendar" to canonical),pending=listOf(pending))
        val projected = workspaceSnapshot(state,"calendar").getJSONArray("events").getJSONObject(0)
        assertEquals("Provisional",projected.getString("title"))
        assertTrue(projected.getBoolean("pending"))
        val rolledBack = workspaceSnapshot(state.copy(pending=emptyList()),"calendar").getJSONArray("events").getJSONObject(0)
        assertEquals("Confirmed",rolledBack.getString("title"))
        assertFalse(rolledBack.has("pending"))
        assertEquals(canonical,state.snapshots.getValue("calendar"))
    }

    @Test fun legacyDraftsAndPersistedReceiptOnlyEntriesNeverLookLikeConfirmedEvents() {
        val oldDraft = """{"path":"/api/v1/calendar/changes","body":{"id":"old","title":"Old draft"}}"""
        val receipt = """{"path":"/api/v1/calendar/changes","id":"receipt"}"""
        val state = WorkspaceState(snapshots=mapOf("calendar" to """{"events":[]}"""),pending=listOf(receipt),legacyDrafts=listOf(oldDraft))
        assertEquals(0,workspaceSnapshot(state,"calendar").getJSONArray("events").length())
    }
}
