package com.arcus.alert;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class ArcusMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) { FirebaseSync.saveFcmToken(token); }
    @Override public void onMessageReceived(RemoteMessage message) {
        Map<String,String> data = message.getData();
        String symbol = data.getOrDefault("symbol", "Arcus");
        String target = data.getOrDefault("target", "");
        String current = data.getOrDefault("current", "");
        String title = data.getOrDefault("title", "Arcus Alert");
        String body = data.getOrDefault("body", symbol + " crossed " + target + " · Current " + current);
        String channel = "arcus_alert_notifications_v2";
        NotificationManager manager = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(channel) == null) {
            NotificationChannel c = new NotificationChannel(channel, "Arcus price alerts", NotificationManager.IMPORTANCE_HIGH);
            c.enableVibration(true);
            manager.createNotificationChannel(c);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.putExtra("open_chart_alert", true);
        open.putExtra("alert_symbol", symbol);
        try { open.putExtra("alert_target", Double.parseDouble(target)); } catch (Exception ignored) {}
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int id = (int)(System.currentTimeMillis() & 0x7fffffff);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent content = PendingIntent.getActivity(this, id, open, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, channel) : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setContentIntent(content).setAutoCancel(true)
            .setPriority(Notification.PRIORITY_MAX).setCategory(Notification.CATEGORY_ALARM);
        manager.notify(id, builder.build());
    }
}
