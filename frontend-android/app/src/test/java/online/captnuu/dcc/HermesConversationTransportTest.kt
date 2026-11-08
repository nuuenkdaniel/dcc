package online.captnuu.dcc

import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test

class HermesConversationTransportTest {
    @Test fun executionOverridesInheritedShortReadTimeoutWhileStatusAndCloseHaveIndependentBounds(){
        val base=OkHttpClient.Builder().callTimeout(20,java.util.concurrent.TimeUnit.SECONDS).build()
        assertEquals(10000,base.readTimeoutMillis)
        for(op in listOf("start","answer")){
            val client=hermesConversationClient(base,op)
            assertEquals(180000,client.readTimeoutMillis);assertEquals(180000,client.callTimeoutMillis)
            assertFalse(client.retryOnConnectionFailure);assertFalse(client.followRedirects);assertFalse(client.followSslRedirects)
            assertSame(base.cookieJar,client.cookieJar)
        }
        val read=hermesConversationClient(base,"read");assertEquals(12000,read.callTimeoutMillis);assertEquals(12000,read.readTimeoutMillis)
        val close=hermesConversationClient(base,"cancel");assertEquals(20000,close.callTimeoutMillis);assertEquals(20000,close.readTimeoutMillis)
        assertEquals(10000,base.readTimeoutMillis);assertEquals(20000,base.callTimeoutMillis)
    }
    @Test fun actualAsyncAdapterReadsInjectedResponseWithoutSocketAndDoesNotRetryHttpFailure(){runBlocking{
        var requests=0
        val base=OkHttpClient.Builder().addInterceptor{chain->requests++;Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(503).message("Synthetic").body("private synthetic body".toResponseBody("application/json".toMediaType())).build()}.build()
        try{
            val result=awaitHermesHttp(hermesConversationClient(base,"read"),Request.Builder().url("https://synthetic.invalid/").build())
            assertEquals(503,result.code);assertEquals("{}",result.body);assertEquals(1,requests)
        }finally{base.dispatcher.executorService.shutdownNow();base.connectionPool.evictAll()}
    }}
    @Test fun cancellingStatusWaitCancelsTheActualCall(){runBlocking{
        val request=Request.Builder().url("https://synthetic.invalid/").build();var cancelled=false;var enqueued=false
        val call=object:Call{
            override fun request()=request
            override fun execute():Response=error("Blocking execute must not be used")
            override fun enqueue(responseCallback:Callback){enqueued=true}
            override fun cancel(){cancelled=true}
            override fun isExecuted()=enqueued
            override fun isCanceled()=cancelled
            override fun timeout()=okio.Timeout()
            override fun clone():Call=error("No retry")
        }
        val factory=object:Call.Factory{override fun newCall(request:Request)=call}
        val wait=launch(start=CoroutineStart.UNDISPATCHED){awaitHermesHttp(factory,request)}
        assertTrue(enqueued);wait.cancelAndJoin();assertTrue(cancelled)
    }}
}
