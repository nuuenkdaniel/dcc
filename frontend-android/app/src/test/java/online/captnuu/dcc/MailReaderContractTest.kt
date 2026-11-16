package online.captnuu.dcc

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MailReaderContractTest {
 @Test fun hasHtmlUnknownOrAbsentIsEligibleButExplicitFalseIsNot(){
  fun msg(json:String)=mailMessage(JSONObject(json))
  assertTrue(msg("""{"data":{"id":"a","account":"x","sender":"s","subject":"t"}}""").hasHtml)
  assertTrue(msg("""{"data":{"id":"a","account":"x","sender":"s","subject":"t","hasHtml":null}}""").hasHtml)
  assertTrue(msg("""{"data":{"id":"a","account":"x","sender":"s","subject":"t","hasHtml":true}}""").hasHtml)
  assertFalse(msg("""{"data":{"id":"a","account":"x","sender":"s","subject":"t","hasHtml":false}}""").hasHtml)
 }
 @Test fun remoteMailResourcesBlockPrivateAndUnsafeUrls(){
  assertTrue(allowedRemoteMailResource("https","images.example.com",null))
  assertTrue(allowedRemoteMailResource("http","cdn.example.org",null))
  assertFalse(allowedRemoteMailResource("data",null,null))
  assertFalse(allowedRemoteMailResource("javascript","example.com",null))
  assertFalse(allowedRemoteMailResource("file","example.com",null))
  assertFalse(allowedRemoteMailResource("https","localhost",null))
  assertFalse(allowedRemoteMailResource("https","127.0.0.1",null))
  assertFalse(allowedRemoteMailResource("https","192.168.1.5",null))
  assertFalse(allowedRemoteMailResource("https","10.0.0.1",null))
  assertFalse(allowedRemoteMailResource("https","169.254.169.254",null))
  assertFalse(allowedRemoteMailResource("https","printer.local",null))
  assertFalse(allowedRemoteMailResource("https","mail.invalid",null))
  assertFalse(allowedRemoteMailResource("https",MAIL_APP_ORIGIN_HOST,null))
  assertFalse(allowedRemoteMailResource("https","user@example.com","user:pass"))
  assertFalse(allowedRemoteMailResource("https","[::1]",null))
 }
 @Test fun validatedExternalLinksAllowOnlySafeHttpTargets(){
  fun v(u:String)=runCatching{val j=java.net.URI(u); mailValidatedExternalLink(j.scheme,j.host,j.rawUserInfo,u)}.getOrNull()
  assertNotNull(v("https://example.com/page"))
  assertNotNull(v("http://docs.example.org/"))
  assertNull(v("javascript:alert(1)"))
  assertNull(v("data:text/html,x"))
  assertNull(v("file:///sdcard/x"))
  assertNull(v("content://provider/x"))
  assertNull(v("intent://x"))
  assertNull(v("https://$MAIL_APP_ORIGIN_HOST/path"))
  assertNull(v("https://localhost/x"))
  assertNull(v("https://127.0.0.1/x"))
  assertNull(v("https://192.168.1.2/x"))
  assertNull(v("https://mail.invalid/x"))
  assertNull(v("https://user:pass@example.com/x"))
 }
 @Test fun validatedLinkLaunchUsesSeamOnlyForSafeTargets(){
  val launched=mutableListOf<String>()
  val launcher=MailExternalLinkLauncher { url -> launched+=url; true }
  assertEquals(MailLinkResult.Opened,launchValidatedExternalLink("https://example.com/page#frag",launcher))
  assertEquals(listOf("https://example.com/page"),launched)
  assertEquals(MailLinkResult.Blocked,launchValidatedExternalLink("https://127.0.0.1/x",launcher))
  assertEquals(MailLinkResult.Blocked,launchValidatedExternalLink("javascript:alert(1)",launcher))
  assertEquals(1,launched.size)
 }
 @Test fun mailDocumentUrlIsStableAndScoped(){
  val a=mailDocumentUrl("abc123")
  assertTrue(a.startsWith("https://mail.invalid/?id="))
  assertTrue(a.contains("abc123"))
 }
 @Test fun mailHtmlPayloadRejectsInconsistentAndOversize(){
  assertEquals(false, parseMailHtmlPayload("""{"hasHtml":false,"html":null}""").hasHtml)
  assertNull(parseMailHtmlPayload("""{"hasHtml":false,"html":null}""").html)
  val ok=parseMailHtmlPayload("""{"hasHtml":true,"html":"<p>ok</p>"}""")
  assertTrue(ok.hasHtml); assertEquals("<p>ok</p>",ok.html)
  assertThrows(IllegalArgumentException::class.java){parseMailHtmlPayload("""{"hasHtml":true,"html":null}""")}
  assertThrows(IllegalArgumentException::class.java){parseMailHtmlPayload("""{"hasHtml":false,"html":"x"}""")}
  assertThrows(IllegalArgumentException::class.java){parseMailHtmlPayload("""{"hasHtml":true,"html":""}""")}
  assertThrows(IllegalArgumentException::class.java){parseMailHtmlPayload("""{"hasHtml":"yes","html":"x"}""")}
  val big="x".repeat(2*1024*1024 + 1)
  assertThrows(IllegalArgumentException::class.java){parseMailHtmlPayload("""{"hasHtml":true,"html":"$big"}""")}
 }
 @Test fun producerValidHtmlEscapingExceedsCurrentWireCapButParserShouldAccept(){
  // Backend allows 2MiB decoded HTML; JSON escaping (quotes/backslashes) inflates wire size.
  val body="<p>"+("\""+"\\" ).repeat(700_000)+"</p>" // many chars that escape to 2 bytes in JSON
  val bodyBytes=body.toByteArray(Charsets.UTF_8).size
  assertTrue("body must be under 2MiB ceiling: $bodyBytes", bodyBytes<=2_000_000)
  val payload=JSONObject().put("hasHtml",true).put("html",body).toString()
  val wireBytes=payload.toByteArray(Charsets.UTF_8).size
  assertTrue("wire envelope should exceed current 2.5MiB cap for this producer shape: $wireBytes", wireBytes>2_500_000)
  // Expected RED with current implementation: parser rejects by wire cap/body handling despite producer-valid decoded HTML.
  val parsed=parseMailHtmlPayload(payload)
  assertTrue(parsed.hasHtml)
  assertEquals(body, parsed.html)
 }
 private fun <T:Throwable> assertThrows(type:Class<T>,block:()->Unit){try{block(); fail("Expected ${type.simpleName}")}catch(e:Throwable){if(!type.isInstance(e)) throw e}}
}