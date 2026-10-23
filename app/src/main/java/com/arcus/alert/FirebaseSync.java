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
                    .setApplicationId(BuildConfig.FIREBASE_ANDROID_APP_ID.isEmpty() ? "1:248498715281:web:45fcd1ff7c3c1b827fdd30" : BuildConfig.FIREBASE_ANDROID_APP_ID)
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
                    notifyStatus(currentStatus, "Not signed in · this device only");
                } else {
                    String uid = a.getCurrentUser().getUid();
                    SharedPreferences accountPrefs = appContext.getSharedPreferences("arcus_native", 0);
                    String previousUid = accountPrefs.getString("firebase_uid", "");
                    if (!previousUid.isEmpty() && !previousUid.equals(uid)) accountPrefs.edit().remove("levels").remove("favorites").remove("history").apply();
                    accountPrefs.edit().putString("firebase_uid", uid).apply();
                    notifyStatus(currentStatus, "Signed in · syncing Arcus alerts");
                    attachCloudListener(status);
                    syncNow();
                    if (!pendingFcmToken.isEmpty()) saveFcmToken(pendingFcmToken);
                }
            });
            if (auth.getCurrentUser() != null) {
                attachCloudListener(status);
                syncNow();
            } else notifyStatus(status, "Not signed in · this device only");
        } catch (Exception e) {
            notifyStatus(currentStatus, "Firebase setup error: " + e.getMessage());
        }
    }

    private static void notifyStatus(Status s, String message) {
        if (s != null) main.post(() -> s.changed(message));
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
            if (snapshot == null || !snapshot.exists()) return; // web app is the master: nothing to push
            boolean firstCloudSnapshot = !cloudInitialized;
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
                            String cloudId = id == null ? "" : String.valueOf(id);
                            // Keep the cloud id: alerts made on the web have UUID ids, not numbers.
                            o.put("cid", cloudId);
                            o.put("created", createdFromId(cloudId));
                            double nearPct = number(m.get("nearPct"));
                            o.put("nearPct", nearPct > 0 ? nearPct : 0.1);
                            o.put("enabled", m.get("enabled") == null || Boolean.parseBoolean(String.valueOf(m.get("enabled"))));
                            cloud.put(o);
                        }
                    }
                    JSONArray local = new JSONArray(p.getString("levels", "[]"));
                    LinkedHashMap<String, JSONObject> merged = new LinkedHashMap<>();
                    for (int i=0;i<cloud.length();i++) { JSONObject o=cloud.optJSONObject(i); if(o!=null) merged.put(levelKey(o),o); }
                    JSONArray result = new JSONArray(); for(JSONObject o:merged.values()) result.put(o);
                    p.edit().putString("levels", result.toString()).apply();
                }
                if (snapshot.contains("favorites")) {
                    Set<String> merged = new HashSet<>();
                    Object v = snapshot.get("favorites");
                    if (v instanceof List) for (Object s : (List<?>)v) if(s!=null) merged.add(String.valueOf(s));
                    p.edit().putStringSet("favorites", merged).apply();
                }
                notifyStatus(currentStatus, "Cloud sync active · " + accountEmail());
                cloudInitialized = true;
            } catch (Exception e) { notifyStatus(currentStatus, "Cloud data error: " + e.getMessage()); }
            finally { applying = false; }
        });
    }

    /** The web app is the master copy: the phone only receives alerts and never writes them back. */
    public static void syncNow() { }

    /** Id shared with the cloud: the stored cloud id, or the creation time for alerts made on this phone. */
    private static String levelId(JSONObject o) {
        String cid = o.optString("cid", "");
        return cid.isEmpty() ? String.valueOf(o.optLong("created", System.currentTimeMillis())) : cid;
    }
    /** Same alert on both sides gets the same key, so merging cloud and local data never duplicates it. */
    private static String levelKey(JSONObject o) {
        return "id:" + levelId(o);
    }
    /**
     * Numeric ids (made on Android) are the creation time itself. Web ids are UUIDs, so derive a stable number
     * from them; PriceMonitorService keys its per-alert state on "created", and a value that changed on every
     * sync would reset crossing detection and could re-fire an alert.
     */
    private static long createdFromId(String id) {
        if (id.isEmpty()) return System.currentTimeMillis();
        try { return Long.parseLong(id); }
        catch (NumberFormatException e) { return 1_000_000_000_000L + (id.hashCode() & 0x7fffffffL); }
    }
    private static double number(Object x) { try { return Double.parseDouble(String.valueOf(x)); } catch(Exception e) { return 0; } }
    private static long parseLong(Object x,long fallback) { try { return Long.parseLong(String.valueOf(x)); } catch(Exception e) { return fallback; } }
}
