package online.captnuu.dcc
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test
class NavigationTest {
 @get:Rule val compose=createComposeRule()
 private fun launch(){compose.setContent{CompositionLocalProvider(LocalInspectionMode provides true){DccTheme{Workspace(WorkspaceState(signedIn=true,notice="",snapshots=mapOf("planner" to "{\"projects\":[],\"actions\":[]}","calendar" to "{\"events\":[],\"calendars\":[]}","mail" to "{\"messages\":[]}")),{_,_->},{},{},{_,_->},{_,_->})}}}}
 @Test fun calendarAndTasksAreSeparate(){launch();compose.onNodeWithText("New event").assertIsDisplayed();compose.onNodeWithText("Tasks",useUnmergedTree=true).performClick();compose.onNodeWithText("New event").assertDoesNotExist();compose.onNodeWithText("Add a task").assertIsDisplayed()}
 @Test fun inboxFiltersToggle(){launch();compose.onNodeWithText("Inbox").performClick();compose.onNodeWithText("Filters").performScrollTo().performClick();compose.onNodeWithText("personal").performScrollTo().performClick();compose.onNodeWithText("personal").assertIsSelected();compose.onNodeWithText("Important only").performScrollTo().performClick();compose.onNodeWithText("Important only").assertIsOn();compose.onNodeWithText("Daily brief",substring=true).performScrollTo().assertIsDisplayed()}
 @Test fun settingsContentCanScrollToStorageDisclosure(){launch();compose.onNodeWithContentDescription("Page actions").performClick();compose.onNodeWithText("Settings").performClick();compose.onNodeWithText("The session, confirmed workspace cache",substring=true).performScrollTo().assertIsDisplayed()}
 @Test fun destinationHeaderDoesNotDuplicateBottomNavigationLabel(){launch();compose.onNodeWithText("Inbox").performClick();compose.onAllNodesWithText("Inbox").assertCountEquals(1)}
}
