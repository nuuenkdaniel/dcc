package online.captnuu.dcc

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.Source
import okio.Timeout
import okio.buffer
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class MailResourceOwnerTest {
 private fun png(bytes:ByteArray=byteArrayOf(0x89.toByte(),0x50,0x4e,0x47))=bytes
 private fun response(req:Request,code:Int=200,body:ByteArray=png(),mime:String="image/png",headers:Map<String,String> = emptyMap()):Response{
  var b=Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message(if(code==200)"OK" else "Synthetic")
   .header("Content-Type",mime)
   .body(body.toResponseBody(mime.toMediaType()))
  headers.forEach{(k,v)->b=b.header(k,v)}
  return b.build()
 }

 @Test fun stripsAuthCookieRefererAndSetsImageAccept(){
  var seen:Request?=null
  val owner=MailResourceOwner{req-> seen=req; response(req) }
  val r=owner.fetchImageResult("https://images.example.com/p.png")
  owner.dispose()
  assertEquals(200,r.statusCode)
  assertTrue(r.isImage())
  assertNotNull(seen)
  assertNull(seen!!.header("Authorization"))
  assertNull(seen!!.header("Cookie"))
  assertNull(seen!!.header("Referer"))
  assertTrue(seen!!.header("Accept").orEmpty().contains("image/png"))
 }

 @Test fun redirectResponseIsBlockedAndNoDownstreamFetch(){
  val calls=AtomicInteger(0)
  val owner=MailResourceOwner{req-> calls.incrementAndGet(); response(req,302,byteArrayOf(),headers=mapOf("Location" to "http://127.0.0.1/x")) }
  val r=owner.fetchImageResult("https://images.example.com/p.png")
  owner.dispose()
  assertEquals(403,r.statusCode)
  assertEquals(1,calls.get())
 }

 @Test fun oversizedBodyIsBlockedByKnownLengthAndBoundedRead(){
  val r1=MailResourceOwner(MailResourceBudgets(maxBodyBytes=8)){req-> response(req,200,ByteArray(64)) }.useOwner { it.fetchImageResult("https://images.example.com/p.png") }
  assertEquals(403,r1.statusCode)
  val r2=MailResourceOwner(MailResourceBudgets(maxBodyBytes=8)){req-> response(req,200,ByteArray(7)) }.useOwner { it.fetchImageResult("https://images.example.com/p.png") }
  assertEquals(200,r2.statusCode)
 }
 private inline fun <T> MailResourceOwner.useOwner(block:(MailResourceOwner)->T):T=try{block(this)}finally{dispose()}

 @Test fun countAndAggregateBudgetsFailClosed(){
  val owner=MailResourceOwner(MailResourceBudgets(maxCount=1,maxAggregateBytes=8,maxBodyBytes=8)){req-> response(req,200,ByteArray(6)) }
  try{
   assertEquals(200,owner.fetchImageResult("https://images.example.com/a.png").statusCode)
   assertEquals(403,owner.fetchImageResult("https://images.example.com/b.png").statusCode)
  }finally{owner.dispose()}
  val agg=MailResourceOwner(MailResourceBudgets(maxCount=5,maxAggregateBytes=8,maxBodyBytes=8)){req-> response(req,200,ByteArray(6)) }
  try{
   assertEquals(200,agg.fetchImageResult("https://images.example.com/a.png").statusCode)
   assertEquals(403,agg.fetchImageResult("https://images.example.com/b.png").statusCode)
  }finally{agg.dispose()}
 }

 @Test fun unsupportedMimeIsBlocked(){
  val r=MailResourceOwner{req-> response(req,200,"alert(1)".toByteArray(),"text/html") }.useOwner{it.fetchImageResult("https://images.example.com/x")}
  assertEquals(403,r.statusCode)
 }

 @Test fun disposeBlocksSubsequentFetches(){
  val calls=AtomicInteger(0)
  val owner=MailResourceOwner{req-> calls.incrementAndGet(); response(req) }
  owner.dispose()
  val r=owner.fetchImageResult("https://images.example.com/p.png")
  assertEquals(403,r.statusCode)
  assertEquals(0,calls.get())
 }

 @Test fun disposeDuringStalledBodyClosesOwnedOperationAndRefusesLateFetch(){
  val bodyStarted=CountDownLatch(1)
  val releaseBody=CountDownLatch(1)
  val bodyClosed=CountDownLatch(1)
  val resultRef=AtomicReference<MailFetchResult?>(null)
  val owner=MailResourceOwner(MailResourceBudgets(maxBodyBytes=64,maxAggregateBytes=64,callTimeoutMs=5000,readTimeoutMs=5000)){ req ->
   val source=object:Source{
    @Volatile private var closed=false
    override fun read(sink: Buffer, byteCount: Long): Long {
     if(closed) throw IOException("closed")
     bodyStarted.countDown()
     // Block until released or closed; dispose closes tracked body.
     val end=System.currentTimeMillis()+5000
     while(System.currentTimeMillis()<end && !closed && releaseBody.count==1L) Thread.sleep(10)
     if(closed) throw IOException("closed")
     return -1
    }
    override fun timeout(): Timeout = Timeout.NONE
    override fun close(){ closed=true; bodyClosed.countDown() }
   }
   Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("OK")
    .header("Content-Type","image/png")
    .body(okhttp3.ResponseBody.create("image/png".toMediaType(), -1L, source.buffer()))
    .build()
  }
  val t=Thread{ resultRef.set(owner.fetchImageResult("https://images.example.com/stall.png")) }
  t.start()
  assertTrue("stalled body did not start", bodyStarted.await(5,TimeUnit.SECONDS))
  owner.dispose() // must close tracked body/cancel call; fetch should unblock and fail closed
  t.join(5000)
  assertNotNull("fetch should complete after dispose", resultRef.get())
  assertEquals(403, resultRef.get()!!.statusCode)
  assertTrue("dispose should close owned body stream", bodyClosed.await(2,TimeUnit.SECONDS))
  releaseBody.countDown()
  assertEquals(403, owner.fetchImageResult("https://images.example.com/late.png").statusCode)
 }

 @Test fun aggregateBytesCountActualConsumptionOnFailedOrUnknownLengthBody(){
  // Unknown-length body: chunks are consumed before exceeding per-body cap; consumed bytes must
  // still count against aggregate (no refund permitting excessive further downloads).
  val chunk=ByteArray(4){1}
  val totalConsumed=AtomicInteger(0)
  fun unknownLengthResponse(req:Request)=run {
   val reads=AtomicInteger(0)
   val source=object:Source{
    override fun read(sink: Buffer, byteCount: Long): Long {
     val i=reads.incrementAndGet()
     if(i<=4){ val n=minOf(chunk.size, byteCount.toInt()); sink.write(chunk,0,n); totalConsumed.addAndGet(n); return n.toLong() }
     return -1
    }
    override fun timeout(): Timeout = Timeout.NONE
    override fun close(){}
   }
   Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("OK")
    .header("Content-Type","image/png")
    .removeHeader("Content-Length")
    .body(okhttp3.ResponseBody.create("image/png".toMediaType(), -1L, source.buffer()))
    .build()
  }
  val owner=MailResourceOwner(MailResourceBudgets(maxBodyBytes=8,maxAggregateBytes=10,maxCount=5)){ req -> unknownLengthResponse(req) }
  try{
   val first=owner.fetchImageResult("https://images.example.com/a.png")
   assertEquals(403, first.statusCode)
   val afterFirst=totalConsumed.get()
   assertTrue("failing fetch must consume bytes from source (including boundary/failing chunk): $afterFirst", afterFirst>0)
   val second=owner.fetchImageResult("https://images.example.com/b.png")
   assertEquals(403, second.statusCode)
   val afterSecond=totalConsumed.get()
   assertTrue("second fetch must also be bounded by consumed aggregate (source interaction tracked): $afterSecond", afterSecond>=afterFirst)
  } finally { owner.dispose() }
 }
}
