package com.arcus.alert;

import android.app.*;
import android.content.*;
import android.os.*;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.graphics.Color;
import org.json.*;
import java.net.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

public class PriceMonitorService extends Service {
    static final String CHANNEL="arcus_price_alerts", PREF="arcus_native";
    ScheduledExecutorService executor;
    final Set<String> fired=new HashSet<>();
    ToneGenerator tone;
    @Override public void onCreate(){super.onCreate();createChannel();tone=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,100);startForeground(41,buildNotification("Watching Arcus prices in background"));executor=Executors.newSingleThreadScheduledExecutor();executor.scheduleWithFixedDelay(this::checkPrices,0,5,TimeUnit.SECONDS);}
    @Override public int onStartCommand(Intent i,int flags,int id){return START_STICKY;}
    @Override public IBinder onBind(Intent i){return null;}
    void createChannel(){if(Build.VERSION.SDK_INT>=26){NotificationChannel c=new NotificationChannel(CHANNEL,"Arcus price alerts",NotificationManager.IMPORTANCE_HIGH);c.setDescription("Price level notifications and alert sounds");c.enableVibration(true);((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(c);}}
    Notification buildNotification(String message){Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);return b.setContentTitle("Arcus Alert").setContentText(message).setSmallIcon(android.R.drawable.ic_dialog_info).setOngoing(true).build();}
    JSONArray levels(){try{return new JSONArray(getSharedPreferences(PREF,0).getString("levels","[]"));}catch(Exception e){return new JSONArray();}}
    void checkPrices(){
        HttpURLConnection conn=null;
        try{
            conn=(HttpURLConnection)new URL("https://api.arcus.xyz/v1/prices").openConnection();conn.setConnectTimeout(5000);conn.setReadTimeout(5000);conn.setRequestProperty("Accept","application/json");
            InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);
            JSONObject data=new JSONObject(out.toString("UTF-8"));JSONArray a=levels();
            for(int i=0;i<a.length();i++){
                JSONObject l=a.getJSONObject(i);String sym=l.getString("symbol").toUpperCase();double target=l.getDouble("price");int mode=l.optInt("mode",0);
                JSONObject item=findMarket(data,sym);if(item==null)continue;Object raw=item.has("markPrice")&&!item.isNull("markPrice")?item.get("markPrice"):item.opt("oraclePrice");if(raw==null)continue;double price=Double.parseDouble(raw.toString());
                String key=sym+"|"+target+"|"+mode+"|"+l.optLong("created");boolean hit=false;
                if(mode==0){String pk="prev:"+sym;String old=getSharedPreferences(PREF,0).getString(pk,"");if(!old.isEmpty()){double prev=Double.parseDouble(old);hit=(prev<target&&price>=target)||(prev>target&&price<=target);}getSharedPreferences(PREF,0).edit().putString(pk,Double.toString(price)).apply();}
                else if(mode==1)hit=Math.abs(price-target)/target<=0.0005;
                else hit=Math.abs(price-target)/target*100<=0.1;
                if(hit&&fired.add(key)){alert(sym,target,price,key);}
            }
            ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(41,buildNotification("Monitoring active · "+a.length()+" saved alerts"));
        }catch(Exception ignored){}finally{if(conn!=null)conn.disconnect();}
    }
    JSONObject findMarket(JSONObject data,String symbol){Iterator<String> it=data.keys();while(it.hasNext()){String k=it.next();JSONObject o=data.optJSONObject(k);if(o!=null&&symbol.equalsIgnoreCase(o.optString("marketDisplayName")))return o;}return null;}
    void alert(String sym,double target,double price,String key){
        String body=sym+" reached alert level "+target+". Current price: "+price;
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
        b.setContentTitle("Arcus price alert").setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setSmallIcon(android.R.drawable.ic_dialog_alert).setAutoCancel(true).setDefaults(Notification.DEFAULT_ALL);
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify((int)(System.currentTimeMillis()%Integer.MAX_VALUE),b.build());
        try{tone.startTone(ToneGenerator.TONE_PROP_BEEP,700);}catch(Exception ignored){}
        getSharedPreferences(PREF,0).edit().putString("last_alert",body+" @ "+new Date()).apply();
    }
    @Override public void onDestroy(){if(executor!=null)executor.shutdownNow();if(tone!=null)tone.release();super.onDestroy();}
}
