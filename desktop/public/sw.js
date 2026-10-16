importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyA4eRekhLCoY-MtBtapmVJcln5s987Ssro",
  authDomain: "arcus-alert.firebaseapp.com",
  projectId: "arcus-alert",
  storageBucket: "arcus-alert.firebasestorage.app",
  messagingSenderId: "248498715281",
  appId: "1:248498715281:web:45fcd1ff7c3c1b827fdd30"
});
const firebaseMessaging = firebase.messaging();
firebaseMessaging.onBackgroundMessage(payload => {
  const data = payload.data || {};
  const title = data.title || "Arcus Alert";
  const options = {
    body: data.body || "An Arcus price alert was triggered.",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { symbol: data.symbol || "", target: data.target || "" },
    tag: "arcus-" + (data.symbol || "alert") + "-" + (data.target || "")
  };
  self.registration.showNotification(title, options);
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if ("focus" in client) {
        client.postMessage({ type: "ARCUS_ALERT_OPEN", symbol: data.symbol, target: data.target });
        return client.focus();
      }
    }
    return clients.openWindow(new URL("./", self.location.href).href);
  }));
});
const CACHE='arcus-alert-shell-v1';self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['./','./manifest.webmanifest','./icon.svg'])));self.skipWaiting()});self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;event.respondWith(fetch(event.request).then(response=>{if(response.ok&&url.pathname.includes('/assets/')){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;}).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('./'))));});