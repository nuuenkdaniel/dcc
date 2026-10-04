package online.captnuu.dcc

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

interface SessionStorage { fun read():String?; fun write(value:String); fun clear() }

/** Only encrypted session cookies live here; never usernames or passwords. */
class EncryptedSessionStorage(context:Context,private val filename:String="session.enc",private val strict:Boolean=false):SessionStorage {
 private val file=AtomicFile(File(context.noBackupFilesDir,filename))
 private val alias="dcc.session.v1"
 private fun key():SecretKey {
  val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
  (store.getKey(alias,null) as? SecretKey)?.let{return it}
  return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
   init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
  }.generateKey()
 }
 @Synchronized override fun read():String? {
  if(!file.baseFile.exists())return null
  return try {
   val bytes=file.readFully();require(bytes.size>28)
   Cipher.getInstance("AES/GCM/NoPadding").run {
    init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12)))
    updateAAD((if(filename=="session.enc")"dcc.session.v1" else "dcc.session.v1:"+filename).toByteArray());String(doFinal(bytes.copyOfRange(12,bytes.size)),Charsets.UTF_8)
   }
  }catch(e:Exception){if(strict)throw IllegalStateException("Encrypted drafts could not be read; edits paused to protect them.",e);clear();null}
 }
 @Synchronized override fun write(value:String) {
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());cipher.updateAAD((if(filename=="session.enc")"dcc.session.v1" else "dcc.session.v1:"+filename).toByteArray())
  val bytes=cipher.iv+cipher.doFinal(value.toByteArray(Charsets.UTF_8))
  val output=file.startWrite()
  try{output.write(bytes);file.finishWrite(output)}catch(e:Exception){file.failWrite(output);throw e}
 }
 @Synchronized override fun clear(){file.delete()}
}

class PersistentSessionJar(private val storage:SessionStorage,private val origin:HttpUrl,private val now:()->Long={System.currentTimeMillis()}):CookieJar {
 private var cookie:Cookie?=null
 @Synchronized fun restore(){cookie=storage.read()?.let{Cookie.parse(origin,it)}?.takeIf{valid(it)};if(cookie==null)storage.clear()}
 private fun valid(c:Cookie)=c.name=="daymark_session"&&c.secure&&c.httpOnly&&c.hostOnly&&c.domain==origin.host&&c.path=="/"&&c.expiresAt>now()
 @Synchronized fun hasSession():Boolean=loadForRequest(origin).isNotEmpty()
 @Synchronized override fun saveFromResponse(url:HttpUrl,cookies:List<Cookie>){
  if(url.scheme!=origin.scheme||url.host!=origin.host||url.port!=origin.port)return
  val incoming=cookies.lastOrNull{it.name=="daymark_session"}?:return
  if(!valid(incoming)){clear();return}
  storage.write(incoming.toString());cookie=incoming
 }
 @Synchronized override fun loadForRequest(url:HttpUrl):List<Cookie>{
  val current=cookie?:return emptyList()
  if(!valid(current)){clear();return emptyList()}
  return if(url.scheme==origin.scheme&&url.host==origin.host&&url.port==origin.port&&current.matches(url))listOf(current) else emptyList()
 }
 @Synchronized fun clear(){cookie=null;storage.clear()}
}
