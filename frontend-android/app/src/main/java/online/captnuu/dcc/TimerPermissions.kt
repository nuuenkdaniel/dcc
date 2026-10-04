package online.captnuu.dcc
import android.Manifest
import android.app.AlarmManager
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
@Composable fun TimerPermissions(){
 val context=LocalContext.current
 var notice by remember{mutableStateOf("")}
 val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){allowed->notice=if(allowed)"Notifications enabled." else "Timer works without notifications."}
 TextButton(onClick={if(Build.VERSION.SDK_INT>=33)permission.launch(Manifest.permission.POST_NOTIFICATIONS) else {context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,context.packageName))}}){Text("Timer notifications")}
 if(Build.VERSION.SDK_INT>=31&&!context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms())TextButton(onClick={context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:${context.packageName}")))}){Text("Allow precise timer alerts")}
 Text("Timer position survives restarts. Without precise-alarm permission, Android may delay background alerts. Force-stop disables alerts until you reopen the app.",style=MaterialTheme.typography.bodySmall)
 if(notice.isNotBlank())Text(notice,style=MaterialTheme.typography.bodySmall)
}
