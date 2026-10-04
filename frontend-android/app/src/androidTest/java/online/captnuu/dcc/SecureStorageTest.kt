package online.captnuu.dcc
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.File
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
}
