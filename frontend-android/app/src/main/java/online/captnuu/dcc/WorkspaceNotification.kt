package online.captnuu.dcc

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

internal fun notifyWorkspaceSaved(context:Context,operation:String){
    if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return
    val manager=context.getSystemService(NotificationManager::class.java)
    if(!manager.areNotificationsEnabled())return
    val channel="workspace-saves"
    manager.createNotificationChannel(NotificationChannel(channel,"Workspace saves",NotificationManager.IMPORTANCE_LOW))
    val notification=Notification.Builder(context,channel)
        .setSmallIcon(android.R.drawable.stat_notify_sync)
        .setContentTitle("dcc")
        .setContentText("Workspace change saved")
        .setOnlyAlertOnce(true)
        .setTimeoutAfter(60000)
        .setAutoCancel(true)
        .build()
    runCatching{manager.notify(operation,1,notification)}
}
