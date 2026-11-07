package online.captnuu.dcc

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

// Actual controls in a short lazy header, synthetic API only. The separate shell
// suite checks the real Inbox header placement. No WorkspaceModel or providers.
class MailSettingsTest {
    @get:Rule val compose=createComposeRule()
    @Composable private fun Header(owner:String,isCurrent:()->Boolean={true},api:suspend (String,JSONObject?)->JSONObject){
        DccTheme {LazyColumn(Modifier.width(360.dp).height(260.dp).testTag("mail-settings-list")){
            item(key="mail-settings"){MailSettingsControls(WorkspaceState(signedIn=true),owner,isCurrent,api)}
            items((0 until 30).toList()){Text("Synthetic message $it",Modifier.height(64.dp))}
        }}
    }
    @Test fun dirtyDraftAndLoadedStateSurviveLazyRecyclingAndRestoreAndSaveRequiresReadback(){
        val restoration=StateRestorationTester(compose)
        var server="Synthetic server rules";var allowSave=false
        val requests=mutableListOf<Pair<String,String?>>()
        restoration.setContent{Header("owner-a"){path,body->
            assertEquals("/api/v1/mail/preferences",path)
            requests+=Pair(if(body==null)"GET" else "POST",body?.getString("rules"))
            if(body!=null&&allowSave)server=body.getString("rules")
            JSONObject().put("rules",server)
        }}
        compose.onNodeWithText("Mail settings & sync").performClick()
        compose.onNodeWithText("Importance rules").assertTextContains(server)
        compose.onNodeWithText("Importance rules").performTextReplacement("Unsaved synthetic draft")
        compose.onNodeWithText("Close",useUnmergedTree=true).performClick()
        compose.onNodeWithTag("mail-settings-list").performScrollToIndex(30)
        compose.onNodeWithText("Mail settings & sync").assertDoesNotExist()
        compose.onNodeWithTag("mail-settings-list").performScrollToIndex(0)
        compose.onNodeWithText("Mail settings & sync").performClick()
        compose.onNodeWithText("Importance rules").assertTextContains("Unsaved synthetic draft")
        compose.runOnIdle{assertEquals(listOf(Pair("GET",null)),requests)}
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("Importance rules").assertTextContains("Unsaved synthetic draft")
        compose.onNodeWithText("Save rules").performClick()
        compose.onNodeWithText("Could not confirm rules").assertIsDisplayed()
        compose.onNodeWithText("Rules saved.").assertDoesNotExist()
        compose.onNodeWithText("Importance rules").assertTextContains("Unsaved synthetic draft")
        compose.runOnIdle{allowSave=true}
        compose.onNodeWithText("Save rules").performClick()
        compose.onNodeWithText("Rules saved.").assertIsDisplayed()
        compose.runOnIdle{
            assertEquals(listOf("GET","POST","GET","POST","GET"),requests.map{it.first})
            assertEquals(listOf("Unsaved synthetic draft","Unsaved synthetic draft"),requests.filter{it.first=="POST"}.map{it.second})
            assertEquals("Unsaved synthetic draft",server)
        }
    }
    @Test fun lateReadFromDisposedOwnerCannotPopulateAnotherOwnersSettings(){
        var owner by mutableStateOf("owner-a")
        val oldRead=CompletableDeferred<JSONObject>();val requests=mutableListOf<String>()
        compose.setContent{
            val bound=owner
            Header(bound,{owner==bound}){_,_->
                requests+=bound
                if(bound=="owner-a")withContext(NonCancellable){oldRead.await()}
                else JSONObject().put("rules","Owner B rules")
            }
        }
        compose.onNodeWithText("Mail settings & sync").performClick()
        compose.runOnIdle{owner="owner-b"}
        compose.onNodeWithText("Mail settings & sync").performClick()
        compose.onNodeWithText("Importance rules").assertTextContains("Owner B rules")
        compose.runOnIdle{oldRead.complete(JSONObject().put("rules","Late owner A rules"))}
        compose.onNodeWithText("Importance rules").assertTextContains("Owner B rules")
        compose.onNodeWithText("Late owner A rules").assertDoesNotExist()
        compose.runOnIdle{assertEquals(listOf("owner-a","owner-b"),requests)}
    }
    @Test fun sessionChangeRejectsEarlierReadEvenForTheSameOwner(){
        var session by mutableStateOf(1)
        val oldRead=CompletableDeferred<JSONObject>();var reads=0
        compose.setContent{
            val bound=session
            Header("owner-a",{session==bound}){_,_->
                reads++
                if(bound==1)withContext(NonCancellable){oldRead.await()}
                else JSONObject().put("rules","Current session rules")
            }
        }
        compose.onNodeWithText("Mail settings & sync").performClick()
        compose.runOnIdle{session=2;oldRead.complete(JSONObject().put("rules","Stale session rules"))}
        assertEquals("",compose.onNodeWithText("Importance rules").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        compose.onNodeWithText("Stale session rules").assertDoesNotExist()
        compose.onNodeWithText("Close",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Mail settings & sync").performClick()
        compose.onNodeWithText("Importance rules").assertTextContains("Current session rules")
        compose.runOnIdle{assertEquals(2,reads)}
    }
}
