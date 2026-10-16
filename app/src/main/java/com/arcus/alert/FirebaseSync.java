package com.arcus.alert;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.ListenerRegistration;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.*;

public final class FirebaseSync {
    public interface Result { void done(boolean ok, String message); }
    public interface Status { void changed(String message); }
    private static FirebaseAuth auth;
    private static FirebaseFirestore db;
    private static ListenerRegistration listener;
    private static Context appContext;
    private static boolean applying;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private FirebaseSync() {}

    public static synchronized void init(Context context, Status status) {
        appContext = context.getApplicationContext();
        try {
            if (FirebaseApp.getApps(appContext).isEmpty()) {
                FirebaseOptions options = new FirebaseOptions.Builder()
                    .setApiKey("AIzaSyA4eRekhLCoY-MtBtapmVJcln5s987Ssro")
                    .setApplicationId("1:248498715281:web:45fcd1ff7c3c1b827fdd30")
                    .setProjectId("arcus-alert")
                    .setGcmSenderId("248498715281")
                    .build();
                FirebaseApp.initializeApp(appContext, options);
            }
            auth = FirebaseAuth.getInstance();
            db = FirebaseFirestore.getInstance();
            auth.addAuthStateListener(a -> {
                if (listener != null) { listener.remove(); listener = null; }
                if (a.getCurrentUser() == null) {
                    notifyStatus(status, "Not signed in · this device only");
                } else {
                    notifyStatus(status, "Signed in · syncing Arcus alerts");
                    attachCloudListener(status);
                    syncNow();
                }
            });
            if (auth.getCurrentUser() != null) {
                attachCloudListener(status);
                syncNow();
            } else notifyStatus(status, "Not signed in · this device only");
        } catch (Exception e) {
            notifyStatus(status, "Firebase setup error: " + e.getMessage());
        }
    }

    private static void notifyStatus(Status s, String message) {
        if (s != null) main.post(() -> s.changed(message));
    }

    public static boolean signedIn() { return auth != null && auth.getCurrentUser() != null; }
    public static String accountEmail() { return signedIn() ? auth.getCurrentUser().getEmail() : ""; }

    public static void signIn(String email, String password, Result result) {
        if (auth == null) { result.done(false, "Firebase is not initialized"); return; }
        auth.signInWithEmailAndPassword(email.trim(), password)
            .addOnSuccessListener(x -> result.done(true, "Signed in successfully"))
            .addOnFailureListener(e -> result.done(false, e.getMessage()));
    }
    public static void signUp(String email, String password, Result result) {
        if (auth == null) { result.done(false, "Firebase is not initialized"); return; }
        auth.createUserWithEmailAndPassword(email.trim(), password)
            .addOnSuccessListener(x -> result.done(true, "Account created successfully"))
            .addOnFailureListener(e -> result.done(false, e.getMessage()));
    }
    public static void signOut() { if (auth != null) auth.signOut(); }

    private static DocumentReference stateRef() {
        return db.collection("users").document(auth.getCurrentUser().getUid())
            .collection("appData").document("state");
    }

    private static void attachCloudListener(Status status) {
        if (listener != null || !signedIn()) return;
        listener = stateRef().addSnapshotListener((snapshot, error) -> {
            if (error != null) { notifyStatus(status, "Cloud sync error: " + error.getMessage()); return; }
            if (snapshot == null || !snapshot.exists()) { syncNow(); return; }
            try {
                applying = true;
                SharedPreferences p = appContext.getSharedPreferences("arcus_native", 0);
                if (snapshot.contains("levels")) {
                    JSONArray cloud = new JSONArray();
                    Object value = snapshot.get("levels");
                    if (value instanceof List) {
                        for (Object item : (List<?>) value) {
                            if (!(item instanceof Map)) continue;
                            Map<?,?> m = (Map<?,?>) item;
                            JSONObject o = new JSONObject();
                            o.put("symbol", String.valueOf(m.get("symbol")));
                            o.put("price", number(m.get("price")));
                            String mode = String.valueOf(m.get("mode"));
                            o.put("mode", "NEAR".equals(mode) ? 2 : ("TOUCH".equals(mode) ? 1 : 0));
                            Object id = m.get("id");
                            long created = parseLong(id, System.currentTimeMillis());
                            o.put("created", created);
                            o.put("enabled", m.get("enabled") == null || Boolean.parseBoolean(String.valueOf(m.get("enabled"))));
                            cloud.put(o);
                        }
                    }
                    JSONArray local = new JSONArray(p.getString("levels", "[]"));
                    LinkedHashMap<String, JSONObject> merged = new LinkedHashMap<>();
                    for (int i=0;i<cloud.length();i++) { JSONObject o=cloud.optJSONObject(i); if(o!=null) merged.put(levelKey(o),o); }
                    for (int i=0;i<local.length();i++) { JSONObject o=local.optJSONObject(i); if(o!=null) merged.putIfAbsent(levelKey(o),o); }
                    JSONArray result = new JSONArray(); for(JSONObject o:merged.values()) result.put(o);
                    p.edit().putString("levels", result.toString()).apply();
                }
                if (snapshot.contains("favorites")) {
                    Set<String> merged = new HashSet<>(p.getStringSet("favorites", new HashSet<>()));
                    Object v = snapshot.get("favorites");
                    if (v instanceof List) for (Object s : (List<?>)v) if(s!=null) merged.add(String.valueOf(s));
                    p.edit().putStringSet("favorites", merged).apply();
                }
                if (snapshot.contains("history") && snapshot.get("history") instanceof List) {
                    JSONArray h = new JSONArray();
                    for (Object item : (List<?>)snapshot.get("history")) if(item instanceof Map) {
                        Map<?,?> m=(Map<?,?>)item; JSONObject o=new JSONObject();
                        o.put("symbol",String.valueOf(m.get("symbol")));
                        o.put("price",number(m.get("price")));
                        o.put("target",number(m.get("price")));
                        o.put("time",String.valueOf(m.get("time")));
                        h.put(o);
                    }
                    p.edit().putString("history",h.toString()).apply();
                }
                notifyStatus(status, "Cloud sync active · " + accountEmail());
            } catch (Exception e) { notifyStatus(status, "Cloud data error: " + e.getMessage()); }
            finally { applying = false; }
        });
    }

    public static void syncNow() {
        if (!signedIn() || applying || db == null || appContext == null) return;
        try {
            SharedPreferences p = appContext.getSharedPreferences("arcus_native", 0);
            JSONArray local = new JSONArray(p.getString("levels", "[]"));
            ArrayList<Map<String,Object>> levels = new ArrayList<>();
            for (int i=0;i<local.length();i++) {
                JSONObject o=local.optJSONObject(i); if(o==null) continue;
                int mode=o.optInt("mode",0);
                Map<String,Object> item=new HashMap<>();
                item.put("id",String.valueOf(o.optLong("created",System.currentTimeMillis())));
                item.put("symbol",o.optString("symbol"));
                item.put("price",o.optDouble("price",0));
                item.put("mode",mode==2?"NEAR":mode==1?"TOUCH":"CROSS");
                item.put("nearPct",0.1);
                item.put("enabled",o.optBoolean("enabled",true));
                levels.add(item);
            }
            Set<String> fav=p.getStringSet("favorites",new HashSet<>());
            ArrayList<String> favorites=new ArrayList<>(fav);
            JSONArray rawHistory=new JSONArray(p.getString("history","[]"));
            ArrayList<Map<String,Object>> history=new ArrayList<>();
            for(int i=0;i<rawHistory.length();i++) {
                JSONObject o=rawHistory.optJSONObject(i); if(o==null) continue;
                Map<String,Object> item=new HashMap<>();
                item.put("id",String.valueOf(o.optString("time",i+"")));
                item.put("symbol",o.optString("symbol"));
                item.put("price",o.optDouble("target",o.optDouble("price",0)));
                item.put("actual",o.optDouble("price",0));
                item.put("time",System.currentTimeMillis());
                history.add(item);
            }
            Map<String,Object> data=new HashMap<>();
            data.put("levels",levels); data.put("favorites",favorites); data.put("history",history);
            data.put("schemaVersion",1); data.put("updatedAt",FieldValue.serverTimestamp());
            stateRef().set(data, com.google.firebase.firestore.SetOptions.merge())
                .addOnFailureListener(e -> {});
        } catch (Exception ignored) {}
    }

    private static String levelKey(JSONObject o) {
        return o.optString("symbol")+"|"+o.optString("price")+"|"+o.optInt("mode")+"|"+o.optLong("created");
    }
    private static double number(Object x) { try { return Double.parseDouble(String.valueOf(x)); } catch(Exception e) { return 0; } }
    private static long parseLong(Object x,long fallback) { try { return Long.parseLong(String.valueOf(x)); } catch(Exception e) { return fallback; } }
}
