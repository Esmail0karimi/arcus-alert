package com.arcus.alert;
import android.app.Application;
public class ArcusApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        FirebaseSync.init(this, null);
    }
}
