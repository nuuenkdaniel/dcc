package online.captnuu.dcc

/** Local feedback, not a receipt or execution authority. Never stored as a claim. */
enum class HermesReceiptCheck(val message:String){
    IDLE(""),
    CHECKING("Checking receipt…"),
    CHECKED("Receipt checked. Review the recorded details."),
    UNCONFIRMED("Receipt checked: still unconfirmed. Earlier effects may have saved; nothing was resent."),
    PARTIAL("Receipt checked: partial result. Review earlier effects before repeating."),
    FAILED("Receipt checked: not completed. Review details before repeating."),
    QUESTION("Receipt checked: clarification is still required."),
    EXPIRED("Receipt checked: text expired. Earlier effects and saved receipts are unchanged."),
    NO_REQUEST("Receipt check: no saved request to look up. Nothing was sent. [NO_REQUEST]"),
    STORAGE("Receipt check unavailable: protected storage needs recovery. [STORAGE]"),
    AUTH("Receipt check unavailable: sign in again. Saved claims are retained. [AUTH]"),
    INACTIVE("Receipt check unavailable: composer is inactive. [INACTIVE]"),
    BUSY("Receipt check unavailable while the request is in progress. Nothing was resent. [BUSY]"),
    HTTP("Receipt check failed: server request was unsuccessful. Claim retained; try Check receipt again. [HTTP]"),
    DECODE("Receipt check failed: response could not be decoded. Claim retained. [DECODE]"),
    INVALID("Receipt check failed: response validation failed. Claim retained. [INVALID]"),
    CORRELATION("Receipt check refused: response did not match the saved request. [CORRELATION]"),
    TIMEOUT("Receipt check timed out. Claim retained; try Check receipt again. [TIMEOUT]"),
    NETWORK("Receipt check unavailable: connection failed. Claim retained. [NETWORK]"),
    CANCELLED("Receipt check stopped. Nothing was resent. [CANCELLED]")
}

internal fun needsHermesClose(s:HermesState)=!answering(s)&&(s.rootKey!=null||s.attemptKey!=null)
internal fun repeatsUnconfirmedHermesRequest(s:HermesState):Boolean {
    fun normalized(text:String)=text.trim().replace(Regex("\\s+")," ")
    val draft=normalized(s.draft);if(draft.isEmpty()||answering(s))return false
    val submitted=s.submitted
    val unconfirmed=s.receipt?.let{org.json.JSONObject(it).getString("outcome") !in setOf("complete","read-only")}?:true
    if(submitted!=null&&unconfirmed&&(needsHermesClose(s)||submitted.closed)&&normalized(submitted.text)==draft)return true
    return s.timeline.any{it.role=="user"&&!it.settled&&normalized(it.text)==draft}
}
