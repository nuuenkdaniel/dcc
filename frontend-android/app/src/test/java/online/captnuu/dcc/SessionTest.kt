package online.captnuu.dcc
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test
class SessionTest {
 private class Memory:SessionStorage {var value:String?=null;override fun read()=value;override fun write(value:String){this.value=value};override fun clear(){value=null}}
 private val origin="https://dcc.home.captnuu.online".toHttpUrl()
 private fun cookie()=Cookie.Builder().name("daymark_session").value("test-session").hostOnlyDomain(origin.host).path("/").secure().httpOnly().expiresAt(2000000000000L).build()
 @Test fun restoresAcrossInstances(){val disk=Memory();PersistentSessionJar(disk,origin,{1000}).saveFromResponse(origin,listOf(cookie()));val restored=PersistentSessionJar(disk,origin,{1000});restored.restore();assertEquals("test-session",restored.loadForRequest(origin).single().value)}
 @Test fun expiryClearsDisk(){val disk=Memory();PersistentSessionJar(disk,origin,{1000}).saveFromResponse(origin,listOf(cookie()));val expired=PersistentSessionJar(disk,origin,{2000000000001L});expired.restore();assertFalse(expired.hasSession());assertNull(disk.value)}
 @Test fun logoutClearsRestoration(){val disk=Memory();val jar=PersistentSessionJar(disk,origin,{1000});jar.saveFromResponse(origin,listOf(cookie()));jar.clear();val restored=PersistentSessionJar(disk,origin,{1000});restored.restore();assertFalse(restored.hasSession())}
 @Test fun unrelatedCookiesDoNotEraseSession(){val disk=Memory();val jar=PersistentSessionJar(disk,origin,{1000});jar.saveFromResponse(origin,listOf(cookie()));jar.saveFromResponse(origin,listOf(Cookie.Builder().name("other").value("1").hostOnlyDomain(origin.host).build()));assertTrue(jar.hasSession())}
 @Test fun originAndTransportRestricted(){val jar=PersistentSessionJar(Memory(),origin,{1000});jar.saveFromResponse(origin,listOf(cookie()));assertTrue(jar.loadForRequest("http://dcc.home.captnuu.online".toHttpUrl()).isEmpty());assertTrue(jar.loadForRequest("https://other.example".toHttpUrl()).isEmpty());assertTrue(jar.loadForRequest("https://dcc.home.captnuu.online:444".toHttpUrl()).isEmpty())}
 @Test fun corruptCookieRejected(){val disk=Memory();disk.value="garbage";val jar=PersistentSessionJar(disk,origin);jar.restore();assertFalse(jar.hasSession());assertNull(disk.value)}
 @Test fun deletionCookieClears(){val disk=Memory();val jar=PersistentSessionJar(disk,origin,{1000});jar.saveFromResponse(origin,listOf(cookie()));jar.saveFromResponse(origin,listOf(Cookie.parse(origin,"daymark_session=; Max-Age=0; Path=/")!!));assertFalse(jar.hasSession());assertNull(disk.value)}
}
