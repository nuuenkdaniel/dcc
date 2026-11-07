package online.captnuu.dcc

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.rules.TestWatcher
import org.junit.runner.Description

// Failure-only diagnostics for these synthetic fixtures. Keep this watcher INSIDE
// the Compose rule so roots/activity still exist when capturing the failure.
internal class SyntheticUiFailureArtifacts(private val compose:ComposeTestRule):TestWatcher() {
    override fun failed(error:Throwable,description:Description){
        runCatching {
            val instrumentation=InstrumentationRegistry.getInstrumentation()
            val directory=instrumentation.targetContext.getExternalFilesDir("qa-test-failures")?:return
            check(directory.isDirectory||directory.mkdirs())
            val name=(description.className.substringAfterLast('.')+"-"+description.methodName).replace(Regex("[^A-Za-z0-9_.-]"),"_")
            val screenshotFailure=runCatching {
                val screenshot=instrumentation.uiAutomation.takeScreenshot()?:error("Screenshot unavailable")
                try{
                    File(directory,"$name.png").outputStream().use{check(screenshot.compress(Bitmap.CompressFormat.PNG,100,it))}
                }finally{screenshot.recycle()}
            }.exceptionOrNull()
            val report=buildString {
                appendLine(description.displayName);appendLine(error.toString())
                if(screenshotFailure!=null)appendLine("Screenshot capture unavailable: ${screenshotFailure.javaClass.simpleName}")
                runCatching {
                    val roots=compose.onAllNodes(isRoot(),useUnmergedTree=true)
                    roots.fetchSemanticsNodes().forEachIndexed { i,node->
                        appendLine("ROOT $i boundsInRoot=${node.boundsInRoot}")
                        appendLine(roots[i].printToString())
                    }
                    val relevant=hasSetTextAction() or hasTestTag("hermes-dock") or hasTestTag("main-navigation") or hasTestTag("workspace-page") or hasTestTag("inbox-list") or hasTestTag("composer-ime-viewport") or hasTestTag("composer-test-scroll") or hasText("Synthetic message",substring=true)
                    compose.onAllNodes(relevant,useUnmergedTree=true).fetchSemanticsNodes().forEach { node->
                        appendLine("BOUNDS ${node.boundsInRoot} ${node.config}")
                    }
                }.onFailure{appendLine("Semantics capture unavailable: ${it.javaClass.simpleName}")}
            }
            File(directory,"$name.txt").writeText(report)
        } // Diagnostics must never mask the original assertion failure.
    }
}
