package online.captnuu.dcc

import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.InputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

internal const val MAIL_APP_ORIGIN_HOST = "dcc.home.captnuu.online"

internal data class MailResourceBudgets(
 val connectTimeoutMs:Long=3_000,
 val readTimeoutMs:Long=5_000,
 val callTimeoutMs:Long=8_000,
 val maxBodyBytes:Int=1_500_000,
 val maxCount:Int=24,
 val maxAggregateBytes:Long=4_000_000,
)

internal enum class MailLinkResult { Opened, Blocked }
internal fun interface MailExternalLinkLauncher {
 fun launch(url:String):Boolean
}
internal data class MailFetchResult(val statusCode:Int,val mime:String?,val bytes:ByteArray=ByteArray(0)){
 fun isImage()=statusCode==200 && mime!=null
}

internal class MailResourceOwner(
 private val budgets:MailResourceBudgets=MailResourceBudgets(),
 terminalInterceptor:((Request)->Response?)? = null,
) {
 private val calls=CopyOnWriteArrayList<okhttp3.Call>()
 private val bodies=CopyOnWriteArrayList<java.io.Closeable>()
 private val callLock=Object()
 private val count=AtomicInteger(0)
 private val aggregate=AtomicLong(0)
 @Volatile private var disposed=false
 private val client=OkHttpClient.Builder()
  .cookieJar(CookieJar.NO_COOKIES)
  .followRedirects(false)
  .followSslRedirects(false)
  .retryOnConnectionFailure(false)
  .cache(null)
  .connectTimeout(budgets.connectTimeoutMs,TimeUnit.MILLISECONDS)
  .readTimeout(budgets.readTimeoutMs,TimeUnit.MILLISECONDS)
  .callTimeout(budgets.callTimeoutMs,TimeUnit.MILLISECONDS)
  .addInterceptor{chain->
   val stripped=chain.request().newBuilder()
    .removeHeader("Authorization").removeHeader("Cookie").removeHeader("Referer")
    .header("Accept","image/avif,image/webp,image/apng,image/png,image/jpeg,image/gif,*/*;q=0.2")
    .build()
   terminalInterceptor?.invoke(stripped) ?: chain.proceed(stripped)
  }
  .build()

 fun dispose(){
  val toCancel:Array<okhttp3.Call>
  val toClose:Array<java.io.Closeable>
  synchronized(callLock){ disposed=true; toCancel=calls.toTypedArray(); calls.clear(); toClose=bodies.toTypedArray(); bodies.clear() }
  toCancel.forEach{runCatching{it.cancel()}}
  toClose.forEach{runCatching{it.close()}}
  client.dispatcher.executorService.shutdown()
  client.connectionPool.evictAll()
 }

 private fun blockedResult()=MailFetchResult(403,null)
 internal fun safeRasterMime(contentType:String?):String?{
  val mime=(contentType?:"").substringBefore(';').trim().lowercase()
  return when(mime){
   "image/png","image/jpeg","image/jpg","image/gif","image/webp","image/avif","image/apng" -> if(mime=="image/jpg") "image/jpeg" else mime
   else -> null
  }
 }
 private fun boundedRead(stream:InputStream,max:Int):ByteArray?{
  val out=java.io.ByteArrayOutputStream(minOf(max,16*1024))
  val buf=ByteArray(8*1024)
  while(true){
   if(disposed) return null
   val remainingBody=max-out.size()
   val remainingAgg=(budgets.maxAggregateBytes-aggregate.get()).coerceAtLeast(0L)
   if(remainingBody<=0 || remainingAgg<=0L) return null
   val want=minOf(buf.size, remainingBody, (remainingAgg+1L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
   val n=try{stream.read(buf,0,want.coerceAtLeast(1))}catch(_:Exception){ return null }
   if(n<0) break
   val nextAgg=aggregate.addAndGet(n.toLong()) // actual consumed bytes; no refund
   if(out.size()+n>max || nextAgg>budgets.maxAggregateBytes) return null
   out.write(buf,0,n)
  }
  return out.toByteArray()
 }

 internal fun fetchImageResult(url:String):MailFetchResult{
  if(disposed) return blockedResult()
  if(count.incrementAndGet()>budgets.maxCount){ return blockedResult()}
  val call=client.newCall(Request.Builder().url(url).get().build())
  synchronized(callLock){
   if(disposed){ call.cancel(); return blockedResult() }
   calls+=call
  }
  try{
   if(disposed){ call.cancel(); return blockedResult() }
   val response=call.execute()
   synchronized(callLock){ if(disposed){ runCatching{response.close()}; return blockedResult() }; response.body?.let{bodies+=it} }
   try{
    response.use { r ->
     if(disposed) return blockedResult()
     if(!r.isSuccessful || r.isRedirect) return blockedResult()
     val mime=safeRasterMime(r.header("Content-Type")) ?: return blockedResult()
     val len=r.body?.contentLength() ?: -1L
     if(len>budgets.maxBodyBytes) return blockedResult()
     if(len>budgets.maxAggregateBytes) return blockedResult() // cannot fit even before consuming
     val bytes=r.body?.byteStream()?.use{boundedRead(it,budgets.maxBodyBytes)} ?: return blockedResult()
     if(disposed) return blockedResult()
     return MailFetchResult(200,mime,bytes)
    }
   } finally { synchronized(callLock){ bodies.remove(response.body) } }
  } catch(_:Exception){ return blockedResult() } finally { synchronized(callLock){calls-=call} }
 }

 // CSP rejects data: images (img-src http: https:); this helper remains bounded/consistent but policy no longer routes data: through it.
 internal fun maybeInlineDataImageResult(uriString:String,scheme:String?):MailFetchResult?{
  if(!scheme.equals("data",ignoreCase=true)) return null
  if(disposed) return blockedResult()
  if(count.incrementAndGet()>budgets.maxCount){count.decrementAndGet(); return blockedResult()}
  val comma=uriString.indexOf(',')
  if(comma<0 || uriString.length>budgets.maxBodyBytes){ count.decrementAndGet(); return blockedResult() }
  val meta=uriString.substring(5,comma).lowercase()
  if(!meta.contains(";base64")){ count.decrementAndGet(); return blockedResult() }
  val mime=safeRasterMime(meta.substringBefore(';')) ?: run{ count.decrementAndGet(); return blockedResult() }
  return try{
   val bytes=java.util.Base64.getMimeDecoder().decode(uriString.substring(comma+1))
   if(bytes.size>budgets.maxBodyBytes || bytes.isEmpty()){ count.decrementAndGet(); blockedResult() }
   else {
    val nextAgg=aggregate.addAndGet(bytes.size.toLong())
    if(nextAgg>budgets.maxAggregateBytes){ aggregate.addAndGet(-bytes.size.toLong()); count.decrementAndGet(); blockedResult() }
    else MailFetchResult(200,mime,bytes)
   }
  }catch(_:Exception){ count.decrementAndGet(); blockedResult() }
 }
}

internal fun mailValidatedExternalLink(scheme:String?,host:String?,userInfo:String?,uriString:String):String?{
 val s=scheme?.lowercase() ?: return null
 if(s!="http" && s!="https") return null
 if(!userInfo.isNullOrBlank()) return null
 val h=(host?:"").trimEnd('.').lowercase()
 if(h.isBlank() || h==MAIL_APP_ORIGIN_HOST || h=="mail.invalid") return null
 if(h=="localhost"||h=="home.arpa"||h.endsWith(".localhost")||h.endsWith(".local")||h.endsWith(".internal")||h.endsWith(".lan")||h.endsWith(".home")||h.endsWith(".localdomain")||h.endsWith(".home.arpa")) return null
 if(Regex("^\\d+(?:\\.\\d+){3}$").matches(h)){
  val p=h.split('.').mapNotNull{it.toIntOrNull()}; if(p.size!=4) return null
  val a=p[0]; val b=p[1]; val c=p[2]
  val reserved=a==0||a==10||a==127||a>=224||(a==100&&b in 64..127)||(a==169&&b==254)||(a==172&&b in 16..31)||(a==192&&((b==168)||(b==0&&c==0)||(b==0&&c==2)||(b==88&&c==99)))||(a==198&&((b==18)||(b==19)||(b==51&&c==100)))||(a==203&&b==0&&c==113)
  if(reserved) return null
 } else if(h.startsWith("[")||h.contains(':')||!h.contains('.')) return null
 return uriString.substringBefore('#')
}
internal fun launchValidatedExternalLink(uriString:String,launcher:MailExternalLinkLauncher):MailLinkResult {
 val valid=runCatching{val j=java.net.URI(uriString); mailValidatedExternalLink(j.scheme,j.host,j.rawUserInfo,uriString)}.getOrNull() ?: return MailLinkResult.Blocked
 return if(launcher.launch(valid)) MailLinkResult.Opened else MailLinkResult.Blocked
}
