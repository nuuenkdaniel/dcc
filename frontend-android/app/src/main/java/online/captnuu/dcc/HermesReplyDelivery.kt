package online.captnuu.dcc

/** Content-free local delivery diagnostics, never receipt/effect authority. */
internal enum class HermesDeliveryCategory { AUTH, HTTP, TIMEOUT, NETWORK, DECODE, INVALID, STORAGE, NO_FINAL, EXPIRED, CANCELLED }
internal data class HermesDeliveryFailure(val category:HermesDeliveryCategory,val status:Int?=null){
    val code:String get()=category.name+(status?.takeIf{it in 100..599}?.let{" $it"}?:"")
}
/** Bounded automatic read-only recovery for one failed chat turn. Production defaults must not be weakened. */
data class HermesChatRecoveryTiming(
    val delaysMs:List<Long> = listOf(0,4000,8000,14000,22000,31000,48000),
    val overallWindowMs:Long = 140000,
    val perReadTimeoutMs:Long = HERMES_RECEIPT_TIMEOUT_MS
){
    init{
        require(delaysMs.size in 1..7&&delaysMs.all{it>=0}&&overallWindowMs in 1..140000&&perReadTimeoutMs in 1..HERMES_RECEIPT_TIMEOUT_MS)
    }
}
internal fun hermesDeliveryFailure(error:Exception,storageReady:Boolean=true):HermesDeliveryFailure {
    val category=when{
        !storageReady||error is HermesRestoreFailure||error is HermesHistoryLimit->HermesDeliveryCategory.STORAGE
        error is HermesHttpFailure->if(error.auth||error.status in setOf(401,403))HermesDeliveryCategory.AUTH else HermesDeliveryCategory.HTTP
        error is kotlinx.coroutines.TimeoutCancellationException||error is java.io.InterruptedIOException->HermesDeliveryCategory.TIMEOUT
        error is kotlinx.coroutines.CancellationException->HermesDeliveryCategory.CANCELLED
        error is org.json.JSONException->HermesDeliveryCategory.DECODE
        error is java.io.IOException->HermesDeliveryCategory.NETWORK
        else->HermesDeliveryCategory.INVALID
    }
    return HermesDeliveryFailure(category,(error as? HermesHttpFailure)?.status)
}
