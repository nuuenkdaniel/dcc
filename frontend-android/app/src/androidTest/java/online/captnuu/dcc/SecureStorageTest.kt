package online.captnuu.dcc
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.File
import kotlinx.coroutines.*
@RunWith(AndroidJUnit4::class)
class SecureStorageTest {
 @Test fun encryptedRoundTripAndDeletion(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  val storage=EncryptedSessionStorage(context,"instrumentation-test.enc",strict=true)
  try{storage.write("synthetic-test-session");assertEquals("synthetic-test-session",EncryptedSessionStorage(context,"instrumentation-test.enc",strict=true).read());assertFalse(File(context.noBackupFilesDir,"instrumentation-test.enc").readText().contains("synthetic-test-session"));storage.clear();assertNull(storage.read())}finally{storage.clear()}
 }
 @Test fun corruptedDraftFailsClosed(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext;val storage=EncryptedSessionStorage(context,"instrumentation-draft.enc",strict=true)
  try{storage.write("draft");File(context.noBackupFilesDir,"instrumentation-draft.enc").writeBytes(byteArrayOf(1,2,3));assertThrows(IllegalStateException::class.java){storage.read()};assertTrue(File(context.noBackupFilesDir,"instrumentation-draft.enc").exists())}finally{storage.clear()}
 }
 @Test fun separateHermesRecoveryPreservesCorruptCiphertextAndRestoresUpdatedDraft(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  val source=EncryptedSessionStorage(context,"instrumentation-hermes-original.enc",strict=true)
  val separate=EncryptedSessionStorage(context,"instrumentation-hermes-separate.enc",strict=true,existingKeyOnly=true)
  val file=File(context.noBackupFilesDir,"instrumentation-hermes-original.enc")
  val scope=CoroutineScope(Dispatchers.Unconfined)
  try{
   source.write("Synthetic original record")
   val backup=File(file.path+".bak");assertTrue(file.renameTo(backup))
   assertEquals("Synthetic original record",source.read());assertTrue(file.exists())
   val corrupt=file.readBytes();corrupt[corrupt.lastIndex]=(corrupt.last().toInt() xor 1).toByte();file.writeBytes(corrupt)
   val owner="a".repeat(64);var requests=0
   fun controller()=HermesConversationController(scope,{source},{requests++;error("No transport")},recoveryStorageFor={separate})
   val first=controller();first.bind(owner);assertEquals(HermesStorageStatus.READ_BLOCKED,first.state.value.storageStatus)
   first.edit("Synthetic recovered draft");first.send();assertEquals(0,requests);assertArrayEquals(corrupt,file.readBytes())
   first.recoverSeparately();assertTrue(first.state.value.storageReady);assertArrayEquals(corrupt,file.readBytes())
   first.edit("Synthetic updated separate draft")
   val restored=controller();restored.bind(owner)
   assertEquals("Synthetic updated separate draft",restored.state.value.draft);assertTrue(restored.state.value.storageReady)
   assertArrayEquals(corrupt,file.readBytes());assertEquals(0,requests)
   assertFalse(File(context.noBackupFilesDir,"instrumentation-hermes-separate.enc").readText().contains("Synthetic updated separate draft"))
  }finally{scope.cancel();source.clear();separate.clear()}
 }
}
