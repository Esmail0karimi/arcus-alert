const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { randomUUID } = require("node:crypto");

initializeApp();
const db = getFirestore();

exports.checkArcusAlerts = onSchedule(
  { schedule: "every 1 minutes", timeoutSeconds: 120, memory: "256MiB", maxInstances: 1 },
  async () => {
    const response = await fetch("https://api.arcus.xyz/v1/prices", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Arcus API HTTP " + response.status);
    const raw = await response.json();
    const prices = {};
    for (const item of Object.values(raw || {})) {
      if (!item || !item.marketDisplayName) continue;
      const price = Number(item.markPrice ?? item.oraclePrice);
      if (Number.isFinite(price)) prices[String(item.marketDisplayName).toUpperCase()] = price;
    }
    if (!Object.keys(prices).length) throw new Error("Arcus returned no usable prices");

    const users = await db.collection("users").get();
    for (const userDoc of users.docs) {
      const stateRef = userDoc.ref.collection("appData").doc("state");
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(stateRef);
        if (!snap.exists) return [];
        const state = snap.data() || {};
        const levels = Array.isArray(state.levels) ? state.levels : [];
        const lastPrices = { ...(state.lastPrices || {}) };
        const remaining = [];
        const fired = [];
        for (const level of levels) {
          if (!level || level.enabled === false) { remaining.push(level); continue; }
          const symbol = String(level.symbol || "").toUpperCase();
          const target = Number(level.price);
          const current = prices[symbol];
          if (!symbol || !Number.isFinite(target) || target <= 0 || !Number.isFinite(current)) {
            remaining.push(level); continue;
          }
          const previous = Number(lastPrices[symbol]);
          const mode = String(level.mode || "CROSS").toUpperCase();
          let hit = false;
          if (mode === "NEAR") {
            const threshold = Math.max(0, Number(level.nearPct ?? 0.1));
            hit = Math.abs(current - target) / target * 100 <= threshold;
          } else if (Number.isFinite(previous)) {
            hit = (previous < target && current >= target) ||
                  (previous > target && current <= target) || current === target;
          }
          if (hit) {
            fired.push({ id: randomUUID(), symbol, target, current, time: Date.now() });
          } else {
            remaining.push(level);
          }
        }
        Object.assign(lastPrices, prices);
        if (fired.length || Object.keys(prices).length) {
          const history = Array.isArray(state.history) ? state.history.slice(0, 200) : [];
          for (const item of fired) history.unshift({
            id: item.id, symbol: item.symbol, price: item.target,
            actual: item.current, time: item.time
          });
          tx.set(stateRef, {
            levels: remaining,
            history: history.slice(0, 200),
            lastPrices,
            schemaVersion: 1,
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        }
        return fired;
      });

      if (!result.length) continue;
      const deviceSnap = await userDoc.ref.collection("devices").get();
      const tokens = deviceSnap.docs.map(d => String(d.data().token || d.id)).filter(Boolean);
      if (!tokens.length) continue;
      for (const alert of result) {
        const message = {
          tokens,
          data: {
            title: "Arcus Alert · " + alert.symbol,
            body: alert.symbol + " crossed " + alert.target + " · Current " + alert.current,
            symbol: alert.symbol,
            target: String(alert.target),
            current: String(alert.current)
          },
          android: { priority: "high" }
        };
        try {
          await getMessaging().sendEachForMulticast(message);
        } catch (error) {
          console.error("FCM delivery failed", error);
        }
      }
    }
  }
);
