package com.arcus.alert;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;

/**
 * Firebase email/password sign-in and Firestore sync of the alert levels, over plain REST.
 *
 * It reads and writes the same document as preview-firebase.html
 * (users/{uid}/appData/state, field "levels"), so alerts follow the account between
 * the web app and Android. No google-services.json or Firebase SDK is needed.
 *
 * Android stores mode as an int (0 at price, 1 touch/cross, 2 near); the web uses
 * CROSS / TOUCH / NEAR. The cloud document uses the web format, plus an extra
 * "androidMode" field that the web app keeps untouched, so Android modes survive a round trip.
 */
public final class CloudSync {
    static final String PREF = "arcus_native";
    // Same public Firebase web config as preview-firebase.html.
    static final String API_KEY = "AIzaSyA4eRekhLCoY-MtBtapmVJcln5s987Ssro";
    static final String PROJECT_ID = "arcus-alert";

    private CloudSync() {}

    static final class HttpError extends Exception {
        final int code;
        final String body;

        HttpError(int code, String body) {
            super("HTTP " + code);
            this.code = code;
            this.body = body == null ? "" : body;
        }
    }

    // ---------------------------------------------------------------- public state

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREF, 0);
    }

    static boolean isSignedIn(Context ctx) {
        return !prefs(ctx).getString("cloud_refresh_token", "").isEmpty();
    }

    static String email(Context ctx) {
        return prefs(ctx).getString("cloud_email", "");
    }

    static String status(Context ctx) {
        return prefs(ctx).getString("cloud_status", "");
    }

    /** Call after any local change to the alert levels so the next sync uploads them. */
    static void markDirty(Context ctx) {
        prefs(ctx).edit().putBoolean("cloud_dirty", true).apply();
    }

    /** Tells the UI (which polls this value) that the stored levels changed behind its back. */
    static void signalUi(Context ctx) {
        prefs(ctx).edit().putLong("levels_applied_at", System.currentTimeMillis()).apply();
    }

    static void signOut(Context ctx) {
        prefs(ctx).edit()
                .remove("cloud_email").remove("cloud_uid").remove("cloud_refresh_token")
                .remove("cloud_id_token").remove("cloud_id_expiry").remove("cloud_dirty")
                .remove("cloud_first").remove("cloud_remote_time").remove("cloud_status")
                .apply();
    }

    private static void setStatus(Context ctx, String message) {
        prefs(ctx).edit().putString("cloud_status", message).apply();
    }

    // ---------------------------------------------------------------- sign in

    /** Returns null on success, otherwise a message that can be shown to the person. */
    static String signIn(Context ctx, String email, String password, boolean create) {
        try {
            JSONObject req = new JSONObject();
            req.put("email", email);
            req.put("password", password);
            req.put("returnSecureToken", true);
            String endpoint = create ? "accounts:signUp" : "accounts:signInWithPassword";
            JSONObject r = new JSONObject(request("POST",
                    "https://identitytoolkit.googleapis.com/v1/" + endpoint + "?key=" + API_KEY,
                    req.toString(), "application/json", null));
            long seconds = Long.parseLong(r.optString("expiresIn", "3600"));
            prefs(ctx).edit()
                    .putString("cloud_email", r.optString("email", email))
                    .putString("cloud_uid", r.getString("localId"))
                    .putString("cloud_refresh_token", r.getString("refreshToken"))
                    .putString("cloud_id_token", r.getString("idToken"))
                    .putLong("cloud_id_expiry", System.currentTimeMillis() + seconds * 1000L)
                    .putBoolean("cloud_first", true)
                    .remove("cloud_remote_time")
                    .apply();
            sync(ctx);
            return null;
        } catch (Exception e) {
            return friendlyError(e);
        }
    }

    private static String idToken(Context ctx) throws Exception {
        SharedPreferences p = prefs(ctx);
        String token = p.getString("cloud_id_token", "");
        long expiry = p.getLong("cloud_id_expiry", 0);
        if (!token.isEmpty() && System.currentTimeMillis() < expiry - 60000L) return token;
        return refresh(ctx);
    }

    private static String refresh(Context ctx) throws Exception {
        String refreshToken = prefs(ctx).getString("cloud_refresh_token", "");
        if (refreshToken.isEmpty()) throw new Exception("Not signed in");
        String body = "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(refreshToken, "UTF-8");
        try {
            JSONObject r = new JSONObject(request("POST",
                    "https://securetoken.googleapis.com/v1/token?key=" + API_KEY,
                    body, "application/x-www-form-urlencoded", null));
            long seconds = Long.parseLong(r.optString("expires_in", "3600"));
            String token = r.getString("id_token");
            prefs(ctx).edit()
                    .putString("cloud_id_token", token)
                    .putString("cloud_refresh_token", r.optString("refresh_token", refreshToken))
                    .putLong("cloud_id_expiry", System.currentTimeMillis() + seconds * 1000L)
                    .apply();
            return token;
        } catch (HttpError e) {
            String message = errorMessage(e);
            if (e.code == 400 && (message.contains("TOKEN_EXPIRED") || message.contains("INVALID_REFRESH_TOKEN")
                    || message.contains("USER_DISABLED") || message.contains("USER_NOT_FOUND"))) {
                signOut(ctx);
                throw new Exception("Session expired. Please sign in again.");
            }
            throw e;
        }
    }

    // ---------------------------------------------------------------- sync

    /**
     * One sync pass. Safe to call from any background thread; passes never overlap.
     *
     * - first pass after sign-in: union of cloud and local alerts (same as the web app),
     * - cloud changed and nothing local pending: take the cloud version,
     * - local changed and cloud unchanged: upload the local version,
     * - both changed: union, with the local copy winning for the same alert id.
     */
    static synchronized void sync(Context ctx) {
        if (!isSignedIn(ctx)) return;
        SharedPreferences p = prefs(ctx);
        boolean wasDirty = p.getBoolean("cloud_dirty", false);
        // Clear the flag before reading local data: a change made while we sync sets it again.
        p.edit().putBoolean("cloud_dirty", false).apply();
        try {
            String uid = p.getString("cloud_uid", "");
            JSONObject doc = getDocument(ctx, uid);
            JSONArray local = toCloudList(localLevelsWithIds(ctx));
            boolean first = p.getBoolean("cloud_first", true);
            String lastRemoteTime = p.getString("cloud_remote_time", "");
            String message;

            if (doc == null) {
                push(ctx, uid, local);
                message = "Synced · " + local.length() + " alert(s) uploaded";
            } else {
                JSONArray remote = normalize(decodeLevels(doc));
                String remoteTime = doc.optString("updateTime", "");
                if (first) {
                    JSONArray merged = merge(remote, local);
                    applyLocal(ctx, merged);
                    if (fingerprint(merged).equals(fingerprint(remote))) {
                        p.edit().putString("cloud_remote_time", remoteTime).apply();
                    } else {
                        push(ctx, uid, merged);
                    }
                    message = "Synced · " + merged.length() + " alert(s)";
                } else if (!remoteTime.equals(lastRemoteTime)) {
                    if (wasDirty) {
                        JSONArray merged = merge(local, remote);
                        applyLocal(ctx, merged);
                        push(ctx, uid, merged);
                        message = "Synced · " + merged.length() + " alert(s) merged";
                    } else {
                        applyLocal(ctx, remote);
                        p.edit().putString("cloud_remote_time", remoteTime).apply();
                        message = "Synced · " + remote.length() + " alert(s) from cloud";
                    }
                } else if (wasDirty) {
                    push(ctx, uid, local);
                    message = "Synced · " + local.length() + " alert(s) saved";
                } else {
                    message = "Synced · " + local.length() + " alert(s)";
                }
            }
            p.edit().putBoolean("cloud_first", false).apply();
            setStatus(ctx, message + " · " + new SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(new Date()));
        } catch (Exception e) {
            if (wasDirty) markDirty(ctx);
            // If the session expired we are signed out now; keep the reason visible on the sign-in form.
            setStatus(ctx, isSignedIn(ctx) ? "Sync error: " + friendlyError(e) : friendlyError(e));
        }
    }

    // ---------------------------------------------------------------- Firestore REST

    private static String documentUrl(String uid) {
        return "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                + "/databases/(default)/documents/users/" + uid + "/appData/state";
    }

    /** Returns the document, or null if it does not exist yet. */
    private static JSONObject getDocument(Context ctx, String uid) throws Exception {
        try {
            return new JSONObject(authed(ctx, "GET", documentUrl(uid), null));
        } catch (HttpError e) {
            if (e.code == 404) return null;
            throw e;
        }
    }

    private static void push(Context ctx, String uid, JSONArray cloudLevels) throws Exception {
        JSONArray values = new JSONArray();
        for (int i = 0; i < cloudLevels.length(); i++) {
            JSONObject o = cloudLevels.getJSONObject(i);
            JSONObject fields = new JSONObject();
            fields.put("id", stringValue(o.getString("id")));
            fields.put("symbol", stringValue(o.getString("symbol")));
            fields.put("price", doubleValue(o.getDouble("price")));
            fields.put("mode", stringValue(o.optString("mode", "CROSS")));
            fields.put("nearPct", doubleValue(o.optDouble("nearPct", 0.1)));
            fields.put("enabled", new JSONObject().put("booleanValue", o.optBoolean("enabled", true)));
            fields.put("created", integerValue(o.optLong("created", 0)));
            if (o.has("androidMode")) fields.put("androidMode", integerValue(o.optInt("androidMode", 0)));
            values.put(new JSONObject().put("mapValue", new JSONObject().put("fields", fields)));
        }
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        JSONObject docFields = new JSONObject();
        docFields.put("levels", new JSONObject().put("arrayValue", new JSONObject().put("values", values)));
        docFields.put("schemaVersion", integerValue(1));
        docFields.put("updatedAt", new JSONObject().put("timestampValue", iso.format(new Date())));
        String body = new JSONObject().put("fields", docFields).toString();
        String url = documentUrl(uid)
                + "?updateMask.fieldPaths=levels&updateMask.fieldPaths=schemaVersion&updateMask.fieldPaths=updatedAt";
        JSONObject response = new JSONObject(authed(ctx, "PATCH", url, body));
        prefs(ctx).edit().putString("cloud_remote_time", response.optString("updateTime", "")).apply();
    }

    private static JSONObject stringValue(String s) throws Exception {
        return new JSONObject().put("stringValue", s);
    }

    private static JSONObject doubleValue(double d) throws Exception {
        return new JSONObject().put("doubleValue", d);
    }

    private static JSONObject integerValue(long n) throws Exception {
        return new JSONObject().put("integerValue", Long.toString(n));
    }

    /** Turns the Firestore field encoding back into plain JSON objects. */
    private static JSONArray decodeLevels(JSONObject doc) {
        JSONArray out = new JSONArray();
        JSONObject fields = doc.optJSONObject("fields");
        if (fields == null) return out;
        JSONObject levels = fields.optJSONObject("levels");
        if (levels == null) return out;
        JSONObject arrayValue = levels.optJSONObject("arrayValue");
        if (arrayValue == null) return out;
        JSONArray values = arrayValue.optJSONArray("values");
        if (values == null) return out;
        for (int i = 0; i < values.length(); i++) {
            JSONObject item = values.optJSONObject(i);
            JSONObject map = item == null ? null : item.optJSONObject("mapValue");
            JSONObject f = map == null ? null : map.optJSONObject("fields");
            if (f == null) continue;
            JSONObject plain = new JSONObject();
            java.util.Iterator<String> keys = f.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                JSONObject v = f.optJSONObject(key);
                if (v == null) continue;
                try {
                    if (v.has("stringValue")) plain.put(key, v.getString("stringValue"));
                    else if (v.has("doubleValue")) plain.put(key, v.getDouble("doubleValue"));
                    else if (v.has("integerValue")) plain.put(key, Long.parseLong(v.getString("integerValue")));
                    else if (v.has("booleanValue")) plain.put(key, v.getBoolean("booleanValue"));
                } catch (Exception ignored) {
                    // skip fields we cannot read
                }
            }
            out.put(plain);
        }
        return out;
    }

    private static String authed(Context ctx, String method, String url, String body) throws Exception {
        try {
            return request(method, url, body, "application/json", idToken(ctx));
        } catch (HttpError e) {
            if (e.code != 401) throw e;
            return request(method, url, body, "application/json", refresh(ctx));
        }
    }

    private static String request(String method, String url, String body, String contentType, String bearer)
            throws Exception {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(10000);
            c.setUseCaches(false);
            c.setRequestMethod(method);
            c.setRequestProperty("Accept", "application/json");
            if (bearer != null) c.setRequestProperty("Authorization", "Bearer " + bearer);
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", contentType);
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int code = c.getResponseCode();
            InputStream in = code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream();
            String text = "";
            if (in != null) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) != -1) buffer.write(chunk, 0, n);
                in.close();
                text = buffer.toString("UTF-8");
            }
            if (code < 200 || code >= 300) throw new HttpError(code, text);
            return text;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    // ---------------------------------------------------------------- level conversion

    private static JSONArray readLevels(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString("levels", "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /** Alerts created before sync existed have no id; give each one and keep it. */
    private static JSONArray localLevelsWithIds(Context ctx) throws Exception {
        JSONArray levels = readLevels(ctx);
        boolean changed = false;
        for (int i = 0; i < levels.length(); i++) {
            JSONObject o = levels.optJSONObject(i);
            if (o != null && o.optString("id", "").isEmpty()) {
                o.put("id", UUID.randomUUID().toString());
                changed = true;
            }
        }
        if (changed) prefs(ctx).edit().putString("levels", levels.toString()).apply();
        return levels;
    }

    private static String webMode(int androidMode) {
        return androidMode == 2 ? "NEAR" : "CROSS";
    }

    private static JSONArray toCloudList(JSONArray androidLevels) throws Exception {
        JSONArray out = new JSONArray();
        for (int i = 0; i < androidLevels.length(); i++) {
            JSONObject a = androidLevels.optJSONObject(i);
            if (a == null) continue;
            int mode = Math.max(0, Math.min(2, a.optInt("mode", 0)));
            JSONObject o = new JSONObject();
            o.put("id", a.optString("id", ""));
            o.put("symbol", a.optString("symbol", ""));
            o.put("price", a.optDouble("price", 0));
            o.put("mode", webMode(mode));
            o.put("nearPct", a.optDouble("nearPct", 0.1));
            o.put("enabled", a.optBoolean("enabled", true));
            o.put("created", a.optLong("created", 0));
            o.put("androidMode", mode);
            out.put(o);
        }
        return normalize(out);
    }

    /** Same cleanup the web app applies: valid symbol and price, known mode, always an id. */
    private static JSONArray normalize(JSONArray in) {
        JSONArray out = new JSONArray();
        for (int i = 0; i < in.length(); i++) {
            JSONObject x = in.optJSONObject(i);
            if (x == null) continue;
            String symbol = x.optString("symbol", "").trim().toUpperCase(Locale.ROOT);
            double price = x.optDouble("price", 0);
            if (symbol.isEmpty() || !(price > 0)) continue;
            try {
                JSONObject o = new JSONObject();
                String id = x.optString("id", "");
                o.put("id", id.isEmpty() ? UUID.randomUUID().toString() : id);
                o.put("symbol", symbol);
                o.put("price", price);
                String mode = x.optString("mode", "CROSS");
                o.put("mode", mode.equals("TOUCH") || mode.equals("NEAR") ? mode : "CROSS");
                double near = x.optDouble("nearPct", 0.1);
                o.put("nearPct", near >= 0 ? near : 0.1);
                o.put("enabled", x.optBoolean("enabled", true));
                o.put("created", x.optLong("created", 0));
                if (x.has("androidMode")) o.put("androidMode", x.optInt("androidMode", -1));
                out.put(o);
            } catch (Exception ignored) {
                // skip malformed entry
            }
        }
        return out;
    }

    /** Union of both lists; for the same alert (same id, or same symbol/price/mode) the first list wins. */
    private static JSONArray merge(JSONArray first, JSONArray second) {
        JSONArray out = new JSONArray();
        Set<String> seen = new HashSet<>();
        for (JSONArray source : new JSONArray[]{first, second}) {
            for (int i = 0; i < source.length(); i++) {
                JSONObject o = source.optJSONObject(i);
                if (o == null) continue;
                String byId = o.optString("id", "");
                String bySignature = o.optString("symbol") + "|" + o.optDouble("price") + "|" + o.optString("mode");
                if (seen.contains(byId) || seen.contains(bySignature)) continue;
                seen.add(byId);
                seen.add(bySignature);
                out.put(o);
            }
        }
        return out;
    }

    /** Order-independent summary, used to tell whether two lists hold the same alerts. */
    private static String fingerprint(JSONArray list) {
        ArrayList<String> parts = new ArrayList<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null) continue;
            parts.add(o.optString("id") + "|" + o.optString("symbol") + "|" + o.optDouble("price") + "|"
                    + o.optString("mode") + "|" + o.optDouble("nearPct") + "|" + o.optBoolean("enabled", true));
        }
        Collections.sort(parts);
        return parts.toString();
    }

    /** Writes cloud-format alerts into local storage in the Android format. Does not mark anything dirty. */
    private static void applyLocal(Context ctx, JSONArray cloud) throws Exception {
        Map<String, JSONObject> existing = new HashMap<>();
        JSONArray current = readLevels(ctx);
        for (int i = 0; i < current.length(); i++) {
            JSONObject o = current.optJSONObject(i);
            if (o != null) existing.put(o.optString("id", ""), o);
        }
        long now = System.currentTimeMillis();
        JSONArray out = new JSONArray();
        for (int i = 0; i < cloud.length(); i++) {
            JSONObject c = cloud.getJSONObject(i);
            String id = c.getString("id");
            String mode = c.optString("mode", "CROSS");
            int stored = c.optInt("androidMode", -1);
            int androidMode;
            if (stored >= 0 && stored <= 2 && webMode(stored).equals(mode)) androidMode = stored;
            else androidMode = "NEAR".equals(mode) ? 2 : 1;
            long created = c.optLong("created", 0);
            if (created <= 0) {
                JSONObject old = existing.get(id);
                created = old != null ? old.optLong("created", now) : now;
            }
            JSONObject a = new JSONObject();
            a.put("id", id);
            a.put("symbol", c.getString("symbol"));
            a.put("price", c.getDouble("price"));
            a.put("mode", androidMode);
            a.put("nearPct", c.optDouble("nearPct", 0.1));
            a.put("enabled", c.optBoolean("enabled", true));
            a.put("created", created);
            out.put(a);
        }
        prefs(ctx).edit().putString("levels", out.toString()).apply();
        signalUi(ctx);
    }

    // ---------------------------------------------------------------- errors

    private static String errorMessage(HttpError e) {
        try {
            JSONObject error = new JSONObject(e.body).optJSONObject("error");
            if (error != null) return error.optString("message", e.body);
        } catch (Exception ignored) {
            // body is not JSON
        }
        return e.body;
    }

    static String friendlyError(Exception e) {
        if (e instanceof HttpError) {
            HttpError h = (HttpError) e;
            String m = errorMessage(h);
            if (m.contains("INVALID_LOGIN_CREDENTIALS") || m.contains("INVALID_PASSWORD") || m.contains("EMAIL_NOT_FOUND"))
                return "Wrong email or password.";
            if (m.contains("EMAIL_EXISTS")) return "An account with this email already exists. Use Sign in.";
            if (m.contains("WEAK_PASSWORD")) return "Password must be at least 6 characters.";
            if (m.contains("INVALID_EMAIL")) return "Invalid email address.";
            if (m.contains("TOO_MANY_ATTEMPTS")) return "Too many attempts. Try again later.";
            if (m.contains("OPERATION_NOT_ALLOWED")) return "Email/password sign-in is not enabled in Firebase.";
            if (h.code == 403 && (m.contains("referer") || m.contains("API key") || m.contains("blocked")))
                return "Firebase rejected the API key (check its restrictions in Google Cloud).";
            if (h.code == 403 || m.contains("PERMISSION_DENIED") || m.contains("insufficient permissions"))
                return "Permission denied by Firestore rules.";
            return m.isEmpty() ? "HTTP " + h.code : m;
        }
        String message = e.getMessage();
        return message == null ? e.getClass().getSimpleName() : message;
    }
}
