package online.captnuu.dcc

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal const val HERMES_RECEIPT_TIMEOUT_MS=15000L
internal const val HERMES_CLOSE_TIMEOUT_MS=22000L
internal class HermesHttpFailure(val auth:Boolean=false,val status:Int?=null):IOException("Hermes request unavailable")
internal data class HermesHttpResult(val code:Int,val body:String)

internal fun hermesConversationClient(base:OkHttpClient,op:String?):OkHttpClient {
    // Server execution remains bounded at 90s, bridge at 105s. Preserve the
    // existing 180s complete-call allowance, including response/receipt overhead,
    // but do not inherit OkHttp's shorter default socket read timeout.
    val seconds=when(op){"read"->12L;"cancel"->20L;else->180L}
    return base.newBuilder().callTimeout(seconds,TimeUnit.SECONDS).readTimeout(seconds,TimeUnit.SECONDS)
        .retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false).build()
}

/** Only the conversation lane uses this cancellable wait. Cancellation closes
 * its actual call; no blocking execute() can outlive a receipt lookup's UI bound. */
internal suspend fun awaitHermesHttp(factory:Call.Factory,request:Request):HermesHttpResult=suspendCancellableCoroutine{continuation->
    val call=factory.newCall(request)
    continuation.invokeOnCancellation{call.cancel()}
    call.enqueue(object:Callback{
        override fun onFailure(call:Call,e:IOException){if(continuation.isActive)continuation.resumeWithException(e)}
        override fun onResponse(call:Call,response:Response){
            if(!continuation.isActive){response.close();return}
            try{
                val result=response.use{HermesHttpResult(it.code,if(it.isSuccessful)it.body?.string()?:"{}" else "{}")}
                if(continuation.isActive)continuation.resume(result)
            }catch(error:IOException){if(continuation.isActive)continuation.resumeWithException(error)}
            catch(_:Exception){if(continuation.isActive)continuation.resumeWithException(HermesHttpFailure())}
        }
    })
}
