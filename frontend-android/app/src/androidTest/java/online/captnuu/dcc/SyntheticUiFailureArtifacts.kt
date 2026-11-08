package online.captnuu.dcc

import android.graphics.Bitmap
import android.os.Looper
import android.util.Log
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.rules.TestWatcher
import org.junit.runner.Description

// One bounded, one-shot daemon per stage. It never asks Compose to synchronize
// and dumps only the two test/UI thread stacks, not app state or other threads.
internal class SyntheticUiStageTrace(private val test:String){
    private fun emit(message:String){println(message);Log.i("DccSyntheticUi",message)}
    fun <T> stage(name:String,action:()->T):T {
        val instrumentationThread=Thread.currentThread()
        val mainThread=Looper.getMainLooper().thread
        emit("QA_UI_STAGE $test BEFORE $name")
        val watchdog=Thread({
            try{
                Thread.sleep(15000)
                emit("QA_UI_STALLED $test stage=$name after 15s")
                listOf("main" to mainThread,"instrumentation" to instrumentationThread).forEach{(label,thread)->
                    emit("QA_UI_STACK $label name=${thread.name} state=${thread.state}")
                    thread.stackTrace.take(80).forEach{emit("QA_UI_STACK $label at $it")}
                }
            }catch(_:InterruptedException){/* Stage completed before the deadline. */}
        },"dcc-ui-stage-watchdog").apply{isDaemon=true;start()}
        try{
            return action().also{emit("QA_UI_STAGE $test AFTER $name")}
        }catch(error:Throwable){
            emit("QA_UI_STAGE $test FAILED $name ${error.javaClass.simpleName}")
            throw error
        }finally{watchdog.interrupt()}
    }
}

internal fun ComposeTestRule.showHermesChatText(text:String){
    val history=onNodeWithTag("hermes-chat-history")
    val viewport=history.fetchSemanticsNode().boundsInRoot
    if(viewport.height<=0f||viewport.width<=0f)throw AssertionError("Chat history needs a positive viewport before searching: $viewport")
    history.performScrollToNode(hasText(text))
    // LazyColumn finds the enclosing message, which can exceed one viewport.
    // Swipe that actual container to expose the inner receipt text; don't merely
    // assert existence or align the same oversized item's top again.
    repeat(32){attempt->
        try{onNodeWithText(text).assertIsDisplayed();return}catch(error:AssertionError){if(attempt==31)throw error}
        history.performTouchInput{swipeUp(startY=height*.8f,endY=height*.4f,durationMillis=180)}
    }
}

// Failure-only diagnostics for these synthetic fixtures. Keep this watcher INSIDE
// the Compose rule so roots/activity still exist when capturing the failure.
internal class SyntheticUiFailureArtifacts(private val compose:ComposeTestRule):TestWatcher() {
    override fun failed(error:Throwable,description:Description){
        runCatching {
        val originalStack=error.stackTraceToString()
        println("QA_UI_ORIGINAL_FAILURE ${description.displayName}\n$originalStack")
        // Chunk to avoid logcat entry truncation losing the nested cause/frames.
        // This happens before any screenshot or Compose synchronization.
        originalStack.chunked(3000).forEachIndexed{index,part->
            Log.e("DccSyntheticUi","QA_UI_ORIGINAL_FAILURE ${description.displayName} part=${index+1}\n$part")
        }
        // After a fatal runtime/recomposition error, asking Espresso/Compose to
        // become idle can block forever. This affects diagnostics only: JUnit
        // still reports the original failure and all test assertions stay intact.
        val skipSemantics=generateSequence(error){it.cause}.take(32).any{
            it is RuntimeException||it is java.util.concurrent.ExecutionException
        }
        SyntheticUiStageTrace(description.methodName).stage("failure-artifacts"){
            val instrumentation=InstrumentationRegistry.getInstrumentation()
            val directory=instrumentation.targetContext.getExternalFilesDir("qa-test-failures")?:return@stage
            check(directory.isDirectory||directory.mkdirs())
            val name=(description.className.substringAfterLast('.')+"-"+description.methodName).replace(Regex("[^A-Za-z0-9_.-]"),"_")
            // Persist the real assertion before screenshots/Compose waits can stall.
            val reportFile=File(directory,"$name.txt")
            File(directory,"$name-stacktrace.txt").writeText("${description.displayName}\n$originalStack\n")
            reportFile.writeText("${description.displayName}\n$originalStack\n")
            val screenshotFailure=runCatching {
                val screenshot=instrumentation.uiAutomation.takeScreenshot()?:error("Screenshot unavailable")
                try{
                    File(directory,"$name.png").outputStream().use{check(screenshot.compress(Bitmap.CompressFormat.PNG,100,it))}
                }finally{screenshot.recycle()}
            }.exceptionOrNull()
            val report=buildString {
                appendLine(description.displayName);appendLine(originalStack)
                if(screenshotFailure!=null)appendLine("Screenshot capture unavailable: ${screenshotFailure.javaClass.simpleName}")
                if(skipSemantics){
                    val reason="Compose semantics skipped after fatal runtime failure; original test failure preserved."
                    appendLine(reason);Log.e("DccSyntheticUi",reason)
                }else runCatching {
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
            reportFile.writeText(report)
        }
        } // Diagnostics must never mask the original assertion failure.
    }
}
