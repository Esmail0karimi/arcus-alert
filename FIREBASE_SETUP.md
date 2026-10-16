# Firebase setup for unified Arcus Alert

This branch keeps the existing chart and alert UI while adding per-user Firestore state sync and a scheduled push-alert worker.

## Firebase Console prerequisites

1. Open the `arcus-alert` Firebase project.
2. In Authentication → Sign-in method, enable **Email/Password**.
3. Create the Cloud Firestore database.
4. In Project settings → General → Your apps, register an **Android app** with package name `com.arcus.alert`. Use its Android Firebase App ID / native configuration for FCM. The current checked-in web Firebase config is suitable for the web renderer; Android push delivery must use the Android app registration (do not reuse the web App ID for Android FCM).
5. In Project settings → Cloud Messaging → Web Push certificates, generate or copy the public VAPID key.

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

The Android client registers its FCM token under `users/{uid}/devices/{token}`. Before relying on push on Android, complete the Android app registration in Firebase Console and verify the Android Firebase App ID / native app configuration is supplied to the Android build. The account and Firestore sync code is initialized independently.

## Data layout

- `users/{uid}/appData/state`: levels, favorites, history, drawings, last observed prices.
- `users/{uid}/devices/{token}`: push token and platform.
- `firestore.rules`: only the authenticated owner can read/write their own user subtree.

No Firebase Admin private key or service-account JSON is stored in the repository. Cloud Functions use the runtime service identity.
