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
import com.google.firebase.firestore.SetOptions;
import com.google.firebase.messaging.FirebaseMessaging;
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
    private static boolean initialized;
    private static boolean cloudInitialized;
    private static Status currentStatus;
    private static String pendingFcmToken = "";
    private static String lastStatus = "Not initialized";
    private static int cloudAlertCount = -1;
    private static long lastSyncAt = 0;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private FirebaseSync() {}

    public static synchronized void init(Context context, Status status) {
        appContext = context.getApplicationContext();
        currentStatus = status;
        if (initialized) { notifyStatus(currentStatus, signedIn() ? "Signed in · cloud sync active" : "Not signed in · this device only"); return; }
        try {
            if (FirebaseApp.getApps(appContext).isEmpty()) {
                FirebaseOptions options = new FirebaseOptions.Builder()
                    .setApiKey("AIzaSyA4eRekhLCoY-MtBtapmVJcln5s987Ssro")
                    .setApplicationId(BuildConfig.FIREBASE_ANDROID_APP_ID.isEmpty() ? "1:248498715281:android:f616760cb1e918367fdd30" : BuildConfig.FIREBASE_ANDROID_APP_ID)
                    .setProjectId("arcus-alert")
                    .setGcmSenderId("248498715281")
                    .build();
                FirebaseApp.initializeApp(appContext, options);
            }
            auth = FirebaseAuth.getInstance();
            db = FirebaseFirestore.getInstance();
            initialized = true;
            if (!BuildConfig.FIREBASE_ANDROID_APP_ID.isEmpty()) FirebaseMessaging.getInstance().getToken().addOnSuccessListener(FirebaseSync::saveFcmToken);
            auth.addAuthStateListener(a -> {
                if (listener != null) { listener.remove(); listener = null; }
                cloudInitialized = false;
                if (a.getCurrentUser() == null) {
                    cloudAlertCount = -1; lastSyncAt = 0;
                    notifyStatus(currentStatus, "Not signed in · this device only");
                } else {
                    String uid = a.getCurrentUser().getUid();
                    SharedPreferences accountPrefs = appContext.getSharedPreferences("arcus_native", 0);
                    String previousUid = accountPrefs.getString("firebase_uid", "");
                    if (!previousUid.isEmpty() && !previousUid.equals(uid)) accountPrefs.edit().remove("levels").remove("favorites").remove("history").apply();
                    accountPrefs.edit().putString("firebase_uid", uid).apply();
                    notifyStatus(currentStatus, "Signed in · syncing Arcus alerts");
                    // Wait for the first Firestore snapshot before uploading local state.
                    // Uploading here can overwrite alerts created on the web before they are downloaded.
                    attachCloudListener(status);
                    if (!pendingFcmToken.isEmpty()) saveFcmToken(pendingFcmToken);
                }
            });
            if (auth.getCurrentUser() != null) {
                // The snapshot listener decides when a first upload is safe.
                attachCloudListener(status);
            } else notifyStatus(status, "Not signed in · this device only");
        } catch (Exception e) {
            notifyStatus(currentStatus, "Firebase setup error: " + e.getMessage());
        }
    }

    private static void notifyStatus(Status s, String message) {
        lastStatus = message == null ? "Unknown" : message;
        if (s != null) main.post(() -> s.changed(lastStatus));
    }

    public static String syncStatus() { return lastStatus; }
    public static int cloudAlertCount() { return cloudAlertCount; }
    public static long lastSyncAt() { return lastSyncAt; }
    public static String accountUidShort() {
        if (!signedIn()) return "—";
        String uid = auth.getCurrentUser().getUid();
        return uid.length() <= 12 ? uid : uid.substring(0, 6) + "…" + uid.substring(uid.length() - 4);
    }
    public static void refreshCloud() {
        if (!signedIn()) { notifyStatus(currentStatus, "Not signed in · this device only"); return; }
        if (listener != null) { listener.remove(); listener = null; }
        cloudInitialized = false;
        notifyStatus(currentStatus, "Refreshing cloud connection…");
        attachCloudListener(currentStatus);
    }

    public static boolean signedIn() { return auth != null && auth.getCurrentUser() != null; }
    public static String accountEmail() { return signedIn() ? auth.getCurrentUser().getEmail() : ""; }
    public static void saveFcmToken(String token) {
        pendingFcmToken = token == null ? "" : token;
        if (!signedIn() || pendingFcmToken.isEmpty()) return;
        Map<String,Object> data = new HashMap<>();
        data.put("token", pendingFcmToken); data.put("platform", "android"); data.put("updatedAt", FieldValue.serverTimestamp());
        db.collection("users").document(auth.getCurrentUser().getUid()).collection("devices").document(pendingFcmToken).set(data, SetOptions.merge());
    }

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
    public static void signOut() { if (auth == null) return; if (signedIn() && !pendingFcmToken.isEmpty()) db.collection("users").document(auth.getCurrentUser().getUid()).collection("devices").document(pendingFcmToken).delete().addOnCompleteListener(task -> auth.signOut()); else auth.signOut(); }

    private static DocumentReference stateRef() {
        return db.collection("users").document(auth.getCurrentUser().getUid())
            .collection("appData").document("state");
    }

    private static void attachCloudListener(Status status) {
        if (listener != null || !signedIn()) return;
        listener = stateRef().addSnapshotListener((snapshot, error) -> {
            if (error != null) { notifyStatus(currentStatus, "Cloud sync error: " + error.getMessage()); return; }
            if (snapshot == null || !snapshot.exists()) { cloudAlertCount = 0; lastSyncAt = System.currentTimeMillis(); cloudInitialized = true; notifyStatus(currentStatus, "Cloud connected · no cloud alerts yet"); syncNow(); return; }
            boolean firstCloudSnapshot = !cloudInitialized;
            Object cloudLevelsValue = snapshot.get("levels");
            cloudAlertCount = cloudLevelsValue instanceof List ? ((List<?>) cloudLevelsValue).size() : 0;
            lastSyncAt = System.currentTimeMillis();
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
                            o.put("cloudId", String.valueOf(id));
                            o.put("enabled", m.get("enabled") == null || Boolean.parseBoolean(String.valueOf(m.get("enabled"))));
                            cloud.put(o);
                        }
                    }
                    JSONArray local = new JSONArray(p.getString("levels", "[]"));
                    LinkedHashMap<String, JSONObject> merged = new LinkedHashMap<>();
                    for (int i=0;i<cloud.length();i++) { JSONObject o=cloud.optJSONObject(i); if(o!=null) merged.put(levelKey(o),o); }
                    if (firstCloudSnapshot) for (int i=0;i<local.length();i++) { JSONObject o=local.optJSONObject(i); if(o!=null) merged.putIfAbsent(levelKey(o),o); }
                    JSONArray result = new JSONArray(); for(JSONObject o:merged.values()) result.put(o);
                    p.edit().putString("levels", result.toString()).apply();
                }
                if (snapshot.contains("favorites")) {
                    Set<String> merged = firstCloudSnapshot ? new HashSet<>(p.getStringSet("favorites", new HashSet<>())) : new HashSet<>();
                    Object v = snapshot.get("favorites");
                    if (v instanceof List) for (Object s : (List<?>)v) if(s!=null) merged.add(String.valueOf(s));
                    p.edit().putStringSet("favorites", merged).apply();
                }
                if (snapshot.contains("history") && snapshot.get("history") instanceof List) {
                    JSONArray h = new JSONArray();
                    for (Object item : (List<?>)snapshot.get("history")) if(item instanceof Map) {
                        Map<?,?> m=(Map<?,?>)item; JSONObject o=new JSONObject();
                        o.put("symbol",String.valueOf(m.get("symbol")));
                        o.put("price",number(m.get("actual") == null ? m.get("price") : m.get("actual")));
                        o.put("target",number(m.get("price")));
                        o.put("time",String.valueOf(m.get("time")));
                        h.put(o);
                    }
                    if (firstCloudSnapshot) {
                        JSONArray localHistory = new JSONArray(p.getString("history", "[]"));
                        Set<String> seen = new HashSet<>();
                        for (int i=0;i<h.length();i++) { JSONObject o=h.optJSONObject(i); if(o!=null) seen.add(o.optString("symbol")+"|"+o.optString("target",o.optString("price"))+"|"+o.optString("time")); }
                        for (int i=0;i<localHistory.length();i++) { JSONObject o=localHistory.optJSONObject(i); if(o==null) continue; String key=o.optString("symbol")+"|"+o.optString("target",o.optString("price"))+"|"+o.optString("time"); if(seen.add(key)) h.put(o); }
                    }
                    p.edit().putString("history",h.toString()).apply();
                }
                notifyStatus(currentStatus, "Cloud sync active · " + accountEmail());
                cloudInitialized = true;
            } catch (Exception e) { notifyStatus(currentStatus, "Cloud data error: " + e.getMessage()); }
            finally { applying = false; }
            if (firstCloudSnapshot) main.postDelayed(FirebaseSync::syncNow, 400);
        });
    }

    public static void syncNow() {
        if (!signedIn() || applying || !cloudInitialized || db == null || appContext == null) return;
        try {
            SharedPreferences p = appContext.getSharedPreferences("arcus_native", 0);
            JSONArray local = new JSONArray(p.getString("levels", "[]"));
            ArrayList<Map<String,Object>> levels = new ArrayList<>();
            for (int i=0;i<local.length();i++) {
                JSONObject o=local.optJSONObject(i); if(o==null) continue;
                int mode=o.optInt("mode",0);
                Map<String,Object> item=new HashMap<>();
                item.put("id",o.optString("cloudId",String.valueOf(o.optLong("created",System.currentTimeMillis()))));
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
                .addOnSuccessListener(v -> { cloudAlertCount = levels.size(); lastSyncAt = System.currentTimeMillis(); notifyStatus(currentStatus, "Cloud sync active · " + accountEmail()); })
                .addOnFailureListener(e -> notifyStatus(currentStatus, "Cloud sync error: " + e.getMessage()));
        } catch (Exception ignored) {}
    }

    private static String levelKey(JSONObject o) {
        return o.optString("symbol")+"|"+o.optString("price")+"|"+o.optInt("mode")+"|"+o.optLong("created");
    }
    private static double number(Object x) { try { return Double.parseDouble(String.valueOf(x)); } catch(Exception e) { return 0; } }
    private static long parseLong(Object x,long fallback) { try { return Long.parseLong(String.valueOf(x)); } catch(Exception e) { return fallback; } }
}
