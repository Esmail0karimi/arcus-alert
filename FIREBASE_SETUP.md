# Firebase setup for unified Arcus Alert

This branch keeps the existing chart and alert UI while adding per-user Firestore state sync and a scheduled push-alert worker.

## Firebase Console prerequisites

1. Open the `arcus-alert` Firebase project.
2. In Authentication → Sign-in method, enable **Email/Password**.
3. In Authentication → Settings → Authorized domains, add `esmail0karimi.github.io` for the GitHub Pages web app.
4. Create the Cloud Firestore database.
5. In Project settings → General → Your apps, register an **Android app** with package name `com.arcus.alert`. Use its Android Firebase App ID / native configuration for FCM. The current checked-in web Firebase config is suitable for Auth/Firestore initialization; Android push delivery uses the Android App ID supplied at build time as `FIREBASE_ANDROID_APP_ID` (do not reuse the web App ID for Android FCM).
6. In Project settings → Cloud Messaging → Web Push certificates, generate or copy the public VAPID key.

## Deploy Firestore rules and the scheduled worker

Cloud Functions scheduled jobs require the Firebase **Blaze** billing plan. From the repository root, with Firebase CLI authenticated to the `arcus-alert` project:

```bash
npm --prefix functions install
firebase deploy --only firestore:rules,functions
```

The scheduled function reads Arcus public prices once per minute, evaluates signed-in users' active levels, removes triggered levels, records history, and sends data-only FCM messages to registered device tokens.

## Web push build setting

Add a repository Actions variable named `FIREBASE_WEB_VAPID_KEY` containing the public VAPID key from Firebase Console. The web build maps it to `VITE_FIREBASE_VAPID_KEY`. Users must sign in and grant browser notification permission before their web push token is registered.

## Android FCM registration

The Android client registers its FCM token under `users/{uid}/devices/{token}`. Set the repository Actions variable `FIREBASE_ANDROID_APP_ID` to the Android App ID from Firebase Console → Project settings → Your apps, or set the same environment variable for local Gradle builds. The package name must be `com.arcus.alert`. Without this value, email login and Firestore sync still build, but Android FCM token registration is intentionally skipped.

## Data layout

- `users/{uid}/appData/state`: levels, favorites, history, drawings, last observed prices.
- `users/{uid}/devices/{token}`: push token and platform.
- `firestore.rules`: only the authenticated owner can read/write their own user subtree.

No Firebase Admin private key or service-account JSON is stored in the repository. Cloud Functions use the runtime service identity.
