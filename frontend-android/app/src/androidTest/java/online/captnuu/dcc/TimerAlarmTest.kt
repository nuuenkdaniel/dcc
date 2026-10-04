package online.captnuu.dcc
import android.Manifest
import android.app.NotificationManager
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.rule.GrantPermissionRule
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
@RunWith(AndroidJUnit4::class) class TimerAlarmTest {
 @get:Rule val permission=GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)
 @Test fun deadlineAlarmCompletesAndNotifies(){
  val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
  android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("appops set ${context.packageName} SCHEDULE_EXACT_ALARM allow")).use{it.readBytes()}
  val storage=TimerStorage(context);val previous=storage.load();val deadline=System.currentTimeMillis()+1500
  try{
   val running=TimerState(running=true,onBreak=true,remaining=1)
   storage.write(running,deadline);storage.schedule(running,deadline)
   assertTrue(TimerStorage(context).load().first.running)
   val until=System.currentTimeMillis()+10000
   while((storage.load().first.running||context.getSystemService(NotificationManager::class.java).activeNotifications.none{it.id==200})&&System.currentTimeMillis()<until)Thread.sleep(100)
   assertFalse("Alarm receiver did not persist completion",storage.load().first.running)
   assertTrue(context.getSystemService(NotificationManager::class.java).activeNotifications.any{it.id==200})
  }finally{storage.write(previous.first,previous.second);storage.schedule(previous.first,previous.second)}
 }
}
