package online.captnuu.dcc

import android.net.Uri
import android.webkit.*
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import java.io.ByteArrayInputStream

internal data class MailMessage(val id:String,val account:String,val sender:String,val subject:String,val hasHtml:Boolean,val data:JSONObject)

internal fun mailMessage(entry:JSONObject):MailMessage {
 val d=entry.optJSONObject("data")?:entry
 val hasHtml=if(!d.has("hasHtml")||d.isNull("hasHtml")) true else d.optBoolean("hasHtml",true)
 return MailMessage(d.optString("id"),d.optString("account"),d.optString("sender"),d.optString("subject"),hasHtml,d)
}

internal fun mailDocumentUrl(id:String):String = "https://mail.invalid/?id="+java.net.URLEncoder.encode(id,Charsets.UTF_8.name())

private fun mailCsp()="default-src 'none'; style-src 'unsafe-inline'; img-src http: https:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
private fun safeMailHtml(raw:String):String {
 // Narrow bounded document policy without a DOMPurify dependency (not DOM sanitization):
 // JS/file/content/bridge access disabled, restrictive CSP/meta, navigation/request fences.
 // Producer main-document interception must serve only the exact known document for this reader.
 val csp=mailCsp()
 val policyHead="<meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"$csp\"><meta name=\"referrer\" content=\"no-referrer\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><base href=\"https://mail.invalid/\"><style>html,body{margin:0;padding:12px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.45;word-break:break-word;overflow-wrap:anywhere;background:#fff;color:#111}img,table,pre{max-width:100%}table{border-collapse:collapse}pre{white-space:pre-wrap}</style>"
 fun injectAfterFirst(re:Regex,insert:(String)->String,src:String):String{val m=re.find(src);return if(m!=null) src.replaceRange(m.range,insert(m.value)) else src}
 val hasDoc=Regex("(?is)<!doctype\\b|<html\\b").containsMatchIn(raw)
 return if(hasDoc){
  val withHead=if(Regex("(?is)<head\\b").containsMatchIn(raw)) injectAfterFirst(Regex("(?is)<head\\b[^>]*>"),{"$it$policyHead"},raw) else injectAfterFirst(Regex("(?is)<html\\b[^>]*>"),{"$it<head>$policyHead</head>"},raw)
  if(Regex("(?is)<!doctype\\b").containsMatchIn(withHead)) withHead else "<!doctype html>$withHead"
 }else "<!doctype html><html><head>$policyHead</head><body>$raw</body></html>"
}

internal fun mailBlockedResponse()=WebResourceResponse("text/plain","utf-8",403,"Blocked",mapOf("Cache-Control" to "no-store"),ByteArrayInputStream(ByteArray(0)))
private fun blockedResponse()=mailBlockedResponse()
private fun htmlResponse(body:String)=WebResourceResponse("text/html","utf-8",200,"OK",mapOf("Content-Security-Policy" to mailCsp(),"Referrer-Policy" to "no-referrer","Cache-Control" to "no-store"),ByteArrayInputStream(body.toByteArray(Charsets.UTF_8)))

internal fun toWebResource(result:MailFetchResult):WebResourceResponse=
 if(result.isImage()) WebResourceResponse(result.mime,null,200,"OK",mapOf("Cache-Control" to "no-store","X-Content-Type-Options" to "nosniff"),ByteArrayInputStream(result.bytes))
 else mailBlockedResponse()

internal fun mailValidatedExternalLink(url:Uri):String?=mailValidatedExternalLink(url.scheme,url.host,url.userInfo,url.buildUpon().fragment(null).build().toString())

internal fun launchValidatedExternalLink(context:android.content.Context,url:String,launcher:MailExternalLinkLauncher?=null):MailLinkResult {
 val valid=runCatching{mailValidatedExternalLink(Uri.parse(url))}.getOrNull() ?: return MailLinkResult.Blocked
 val opened=if(launcher!=null) launcher.launch(valid) else runCatching{
  val intent=android.content.Intent(android.content.Intent.ACTION_VIEW,Uri.parse(valid)).addCategory(android.content.Intent.CATEGORY_BROWSABLE).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
  context.startActivity(intent); true
 }.getOrDefault(false)
 return if(opened) MailLinkResult.Opened else MailLinkResult.Blocked
}

internal fun allowedRemoteMailResource(scheme:String?,host:String?,userInfo:String?):Boolean {
 val s=scheme?.lowercase() ?: return false
 if(s!="http" && s!="https") return false
 val h=(host?:"").trimEnd('.').lowercase()
 if(h.isBlank() || h=="mail.invalid" || h==MAIL_APP_ORIGIN_HOST || h=="localhost" || h=="home.arpa") return false
 if(h.endsWith(".localhost")||h.endsWith(".local")||h.endsWith(".internal")||h.endsWith(".lan")||h.endsWith(".home")||h.endsWith(".localdomain")||h.endsWith(".home.arpa")) return false
 if(!userInfo.isNullOrBlank()) return false
 val literal=h.startsWith("[") && h.endsWith("]")
 if(Regex("^\\d+(?:\\.\\d+){3}$").matches(h)){
  val p=h.split('.').mapNotNull{it.toIntOrNull()}; if(p.size!=4) return false
  val a=p[0]; val b=p[1]; val c=p[2]
  val reserved=a==0||a==10||a==127||a>=224||(a==100&&b in 64..127)||(a==169&&b==254)||(a==172&&b in 16..31)||(a==192&&((b==168)||(b==0&&c==0)||(b==0&&c==2)||(b==88&&c==99)))||(a==198&&((b==18)||(b==19)||(b==51&&c==100)))||(a==203&&b==0&&c==113)
  if(reserved) return false
 }
 if(literal || h.contains(':')) return false
 return h.contains('.')
}
internal fun allowedRemoteMailResource(url:Uri):Boolean = allowedRemoteMailResource(url.scheme,url.host,url.userInfo)
internal class MailDocumentDiagnostics {
 val mainIntercepts=java.util.concurrent.atomic.AtomicInteger(0)
 val mainBytes=java.util.concurrent.atomic.AtomicInteger(-1)
 val mainEmpty=java.util.concurrent.atomic.AtomicInteger(0)
 val pageStarted=java.util.concurrent.atomic.AtomicInteger(0)
 val pageFinished=java.util.concurrent.atomic.AtomicInteger(0)
 val pageErrors=java.util.concurrent.atomic.AtomicInteger(0)
 @Volatile var lastTitle:String?=null
 @Volatile var lastError:String?=null
 fun snapshot():String="intercepts=${mainIntercepts.get()} bytes=${mainBytes.get()} empty=${mainEmpty.get()} started=${pageStarted.get()} finished=${pageFinished.get()} errors=${pageErrors.get()} title=${lastTitle} error=${lastError}"
}
internal fun mailResourcePolicy(request:WebResourceRequest,documentUrl:String,documentHtml:()->String?,resourceOwner:MailResourceOwner?=null,diagnostics:MailDocumentDiagnostics?=null):WebResourceResponse{
 val url=request.url; val target=url.toString()
 if(target=="about:blank") return mailBlockedResponse()
 if(request.isForMainFrame){
  if(target==documentUrl){
   val body=documentHtml()?:""
   diagnostics?.mainIntercepts?.incrementAndGet()
   diagnostics?.mainBytes?.set(body.toByteArray(Charsets.UTF_8).size)
   if(body.isEmpty()) diagnostics?.mainEmpty?.incrementAndGet()
   return htmlResponse(body)
  }
  return mailBlockedResponse()
 }
 // Validate URL first; never fetch or fall back to WebView network for mail subresources.
 // CSP img-src excludes data:; arbitrary/data-SVG inline images are not fetched.
 if(!allowedRemoteMailResource(url.scheme,url.host,url.userInfo)) return mailBlockedResponse()
 return resourceOwner?.fetchImageResult(target)?.let{toWebResource(it)} ?: mailBlockedResponse()
}

@Composable internal fun MailReader(message:MailMessage,model:WorkspaceModel?,busy:Boolean=false,onFeedback:((String,Boolean)->Unit)?=null,resourceTerminalInterceptor:((okhttp3.Request)->okhttp3.Response?)?=null,externalLinkLauncher:MailExternalLinkLauncher?=null,diagnostics:MailDocumentDiagnostics?=null,onClose:()->Unit) {
 val context=androidx.compose.ui.platform.LocalContext.current
 fun currentFence()=model?.hermes?.ownerFence()
 fun fenceCurrent(f:HermesOwnerFence?=currentFence())=f!=null && model?.hermes?.isCurrent(f)==true
 var fenceKey by remember(message.id){mutableStateOf(currentFence()?.let{it.owner to it.generation})}
 LaunchedEffect(message.id,model){ if(model!=null) model.hermes.state.collect{ fenceKey=model.hermes.ownerFence()?.let{f->f.owner to f.generation} } else fenceKey=null }
 var loadingHtml by remember(message.id,fenceKey){mutableStateOf(message.hasHtml && model!=null)}
 var loadingPlain by remember(message.id,fenceKey){mutableStateOf(false)}
 var status by remember(message.id,fenceKey){mutableStateOf(if(!message.hasHtml) "No formatted version available. Showing text." else "")}
 var html by remember(message.id,fenceKey){mutableStateOf<String?>(null)}
 var plain by remember(message.id,fenceKey){mutableStateOf<String?>(message.data.optString("body").takeIf{message.data.has("body")&&it.isNotBlank()})}
 var original by rememberSaveable(message.id){mutableStateOf(false)}
 var retry by rememberSaveable(message.id){mutableIntStateOf(0)}
 var showPlain by rememberSaveable(message.id){mutableStateOf(!message.hasHtml)}
 var triedPlain by remember(message.id,fenceKey){mutableStateOf(false)}
 var resourceStatus by remember(message.id,retry){mutableStateOf("")}
 var formatUnavailable by remember(message.id,fenceKey){mutableStateOf(false)}
 val documentUrl=remember(message.id){mailDocumentUrl(message.id)}
 val latestHtml=rememberUpdatedState(html)
 suspend fun loadPlain(force:Boolean=false,capturedFence:HermesOwnerFence?=currentFence()){
  if(model==null) return
  if(!force && (plain!=null || triedPlain || loadingPlain)) return
  val fence=capturedFence
  loadingPlain=true; triedPlain=true
  try{val body=model.mailBody(message.id,fence); if(fence==null||model.hermes.isCurrent(fence)==true) plain=body}
  catch(e:CancellationException){throw e}
  catch(_:Exception){val f=fence; if((f==null||model.hermes.isCurrent(f)==true) && latestHtml.value==null) status="Message unavailable while offline or not cached."}
  finally{loadingPlain=false}
 }
 LaunchedEffect(message.id,retry,fenceKey){
  html=null; formatUnavailable=false; loadingHtml=message.hasHtml && model!=null
  status=if(!message.hasHtml) "No formatted version available. Showing text." else ""
  val captured=currentFence()
  try{
   if(message.hasHtml && model!=null){
    // Cached read may be authorized offline by owner context; live network requires current fence.
    val result=model.mailHtml(message.id,captured)
    if(captured!=null && !model.hermes.isCurrent(captured)) return@LaunchedEffect
    if(result.hasHtml && result.html!=null) { html=safeMailHtml(result.html); showPlain=false }
    else { status="No formatted version available. Showing text."; showPlain=true; formatUnavailable=!result.hasHtml }
   }
  }catch(e:CancellationException){throw e}
  catch(_:Exception){val f=captured?:currentFence(); if(f==null||model?.hermes?.isCurrent(f)==true || !message.hasHtml) { status=if(f!=null && model?.hermes?.isCurrent(f)==true) "Formatted view unavailable. Showing text." else status; if(html==null){ showPlain=true; formatUnavailable=message.hasHtml } }}
  finally{ loadingHtml=false }
 }
 LaunchedEffect(message.id,showPlain,html,plain,fenceKey){
  if(showPlain || (html==null && !loadingHtml)) loadPlain(capturedFence=currentFence())
 }
 BackHandler(onBack=onClose)
 Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false,dismissOnBackPress=true,dismissOnClickOutside=false)) {
  Surface(Modifier.fillMaxSize().testTag("mail-reader")) {
   Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
    Surface(tonalElevation=2.dp) {
     Row(Modifier.fillMaxWidth().padding(start=8.dp,end=4.dp,top=4.dp,bottom=4.dp),verticalAlignment=Alignment.CenterVertically){
      Column(Modifier.weight(1f).padding(start=8.dp)){
       Text(message.subject.ifBlank{"Message"},style=MaterialTheme.typography.titleMedium,maxLines=2)
       Text(listOf(message.account,message.sender).filter{it.isNotBlank()}.joinToString(" · "),style=MaterialTheme.typography.bodySmall,maxLines=1,color=MaterialTheme.colorScheme.onSurfaceVariant)
      }
      IconButton(onClick=onClose,modifier=Modifier.testTag("mail-reader-close")){Icon(Icons.Default.Close,"Close message")}
     }
    }
    if(status.isNotBlank())Text(status,style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(horizontal=16.dp,vertical=8.dp))
    if(resourceStatus.isNotBlank())Text(resourceStatus,style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(horizontal=16.dp,vertical=2.dp),color=MaterialTheme.colorScheme.onSurfaceVariant)
    if(loadingHtml || loadingPlain)LinearProgressIndicator(Modifier.fillMaxWidth())
    val canShowHtml=html!=null && !showPlain
    val documentHtml=html
    if(documentHtml!=null){
     Row(Modifier.padding(horizontal=8.dp)){TextButton(onClick={showPlain=!showPlain},modifier=Modifier.testTag("mail-reader-toggle")){Text(if(showPlain)"Formatted" else "Text")}}
    }
    if(message.hasHtml && model!=null && !loadingHtml && html==null && (plain!=null || formatUnavailable)){
     Row(Modifier.padding(horizontal=8.dp)){TextButton(onClick={showPlain=false; formatUnavailable=false; retry++},modifier=Modifier.testTag("mail-reader-retry-formatted")){Text("Retry formatted")}}
    }
    when {
     canShowHtml && documentHtml!=null -> key(documentUrl,retry,documentHtml) {
      // Freeze immutable document bytes for this WebView identity; never read mutable Compose state
      // from WebView worker threads or serve an empty successful main document for available HTML.
      val frozenHtml=documentHtml
      val resourceOwner=remember(documentUrl,retry,documentHtml,resourceTerminalInterceptor){MailResourceOwner(terminalInterceptor=resourceTerminalInterceptor)}
      DisposableEffect(resourceOwner){onDispose{resourceOwner.dispose()}}
      val client=remember(documentUrl,retry,frozenHtml,resourceOwner,externalLinkLauncher,diagnostics,context){
       object:WebViewClient(){
        override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean{
         if(!request.hasGesture()) return true
         val result=launchValidatedExternalLink(context,request.url?.toString().orEmpty(),externalLinkLauncher)
         return true // always consume; never let WebView navigate main frame
        }
        override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse=mailResourcePolicy(request,documentUrl,{frozenHtml},resourceOwner,diagnostics)
        override fun onPageStarted(view:WebView?,url:String?,favicon:android.graphics.Bitmap?){diagnostics?.pageStarted?.incrementAndGet()}
        override fun onPageFinished(view:WebView?,url:String?){diagnostics?.pageFinished?.incrementAndGet(); diagnostics?.lastTitle=view?.title}
        @Suppress("DEPRECATION")
        override fun onReceivedError(view:WebView?,errorCode:Int,description:String?,failingUrl:String?){diagnostics?.pageErrors?.incrementAndGet(); diagnostics?.lastError=description?.take(120)}
        override fun onReceivedError(view:WebView?,request:WebResourceRequest?,error:WebResourceError?){if(request?.isForMainFrame==true){diagnostics?.pageErrors?.incrementAndGet(); diagnostics?.lastError=error?.description?.toString()?.take(120)}}
       }
      }
      AndroidView(modifier=Modifier.fillMaxWidth().weight(1f).testTag("mail-reader-html"),factory={ctx->
       WebView(ctx).apply{
        settings.javaScriptEnabled=false
        settings.allowFileAccess=false
        settings.allowContentAccess=false
        settings.allowFileAccessFromFileURLs=false
        settings.allowUniversalAccessFromFileURLs=false
        settings.domStorageEnabled=false
        @Suppress("DEPRECATION")
        settings.databaseEnabled=false
        settings.setGeolocationEnabled(false)
        settings.loadsImagesAutomatically=true
        settings.blockNetworkLoads=false
        settings.cacheMode=WebSettings.LOAD_NO_CACHE
        settings.mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.setSupportMultipleWindows(false)
        settings.userAgentString="DccMailReader/1"
        isVerticalScrollBarEnabled=true
        isHorizontalScrollBarEnabled=true
        webViewClient=client
        webChromeClient=object:WebChromeClient(){}
        setBackgroundColor(android.graphics.Color.WHITE)
        tag=documentUrl
        loadUrl(documentUrl)
       }
      },update={view->
       // Load once per immutable document identity; do not unconditionally reload on recomposition.
       view.webViewClient=client
       val identity=view.tag as? String
       if(identity!=documentUrl){view.tag=documentUrl; view.loadUrl(documentUrl)}
      },onRelease={view->view.stopLoading();resourceOwner.dispose();view.loadUrl("about:blank");view.webChromeClient=null;view.destroy()})
     }
     plain!=null -> {
      Row(Modifier.padding(horizontal=8.dp)){TextButton(onClick={original=!original}){Text(if(original)"Readable spacing" else "Original text")}}
      Text(if(original)plain!! else readableMail(plain!!),style=MaterialTheme.typography.bodyMedium,modifier=Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(horizontal=16.dp,vertical=8.dp).testTag("mail-reader-text"))
     }
     !loadingHtml && !loadingPlain -> Column(Modifier.weight(1f).padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
      Text(status.ifBlank{"Message unavailable."},style=MaterialTheme.typography.bodyMedium)
      if(model!=null)TextButton(onClick={retry++; triedPlain=false}){Text("Retry")}
     }
     else -> Spacer(Modifier.weight(1f))
    }
    if(!loadingHtml && !loadingPlain && (onFeedback!=null||(message.data.optJSONArray("attachments")?.length()?:0)>0)){
     Surface(tonalElevation=1.dp){
      Column(Modifier.fillMaxWidth().padding(horizontal=8.dp,vertical=4.dp)){
       if(onFeedback!=null)Row{TextButton(onClick={onFeedback(message.id,true)},enabled=!busy){Text("Important")};TextButton(onClick={onFeedback(message.id,false)},enabled=!busy){Text("Not important")}}
       if((message.data.optJSONArray("attachments")?.length()?:0)>0)MailAttachments(message.data,model)
      }
     }
    }
   }
  }
 }
}