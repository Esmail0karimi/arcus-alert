# Arcus Alert

Price level alerts for Arcus markets (prices come from `api.arcus.xyz`). There are two clients that share the same alerts through a Firebase account:

- **Android app** (`app/`): watches prices in a foreground service (1-second checks), shows high-priority notifications and plays a looping alarm until you stop it. Also has a market overview, a watchlist and a candlestick chart where you can tap or drag price lines to create and move alerts.
- **Web app** (`index.html`, `preview-firebase.html`): a browser version. It only checks alerts while the page is open. `preview-firebase.html` adds the cloud sync panel and is the version deployed to GitHub Pages; `index.html` is the local-only prototype.

## Android app

Requires JDK 17 and Gradle 8.9 (there is no Gradle wrapper in the repo).

```
gradle assembleDebug
```

The APK ends up in `app/build/outputs/apk/debug/app-debug.apk`. The workflow `.github/workflows/build-android.yml` builds it on every push that touches `app/` and uploads it as an artifact.

Alert modes: **At price**, **Touch / cross** and **Near** (within a percentage of the target, 0.1% by default; alerts that come from the web use that alert's own percentage). A triggered alert is removed from the list after it fires.

## Cloud sync

Open **Settings → Cloud sync** in the Android app (or the Cloud Sync panel on the web page) and sign in with a Firebase email/password account. Use the same account on both clients.

- Alerts live in the Firestore document `users/{uid}/appData/state`, field `levels`.
- Android talks to Firebase over REST (`CloudSync.java`), so no `google-services.json` or Firebase SDK is needed. The Firebase project id and web API key are the same ones used in `preview-firebase.html`.
- The service syncs every 10 seconds. The first sync after signing in merges the cloud and local alerts; after that the newest change wins, and if both sides changed at once the two lists are merged.
- Android modes are stored as web modes (`CROSS`, `TOUCH`, `NEAR`) plus an extra `androidMode` field that the web app leaves untouched.

### Firebase setup notes

- Email/password sign-in must be enabled in the Firebase console.
- Firestore security rules should only let a user read and write their own data, for example:

  ```
  match /users/{uid}/{document=**} {
    allow read, write: if request.auth != null && request.auth.uid == uid;
  }
  ```
- If the web API key has HTTP referrer restrictions, Android requests will be rejected. Use an unrestricted key (Firebase web keys are not secrets) or switch the app to the official Firebase SDK with a `google-services.json`.

## Web preview

`.github/workflows/deploy-preview-pages.yml` publishes the repository root to GitHub Pages when `preview-firebase.html` changes. The page is installable as a PWA (`manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`).

## Known limits

- The web app can only alert while the page is open; use the Android app for reliable background alerts.
- Both clients evaluate alerts, so with the web page open and the app running you can be notified twice for the same level.
- Android sync polls every 10 seconds, so a change made on the web can take a few seconds to appear.
