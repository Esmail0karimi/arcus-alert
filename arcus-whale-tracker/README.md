# Arcus Whale Tracker

Standalone analytics module for the Arcus ecosystem.

## Isolation and safety
- Lives in `/arcus-whale-tracker/`; it does not replace or modify the existing Arcus Alert app.
- No Firebase SDK, Firebase Authentication, Firestore, or Firebase configuration.
- No TradingView dependency.
- No mock wallets, fabricated leaderboard rows, estimated points, or synthetic PnL.

## Current status
The first UI shell is in place with these sections:
- Overview
- Leaderboard
- RWA Analytics
- Crypto Analytics
- Wallet Explorer
- Weekly History

All metrics are intentionally blank until official Arcus sources are verified.

## Data integration gate
Before enabling live analytics, verify from official Arcus documentation/API:
1. Wallet discovery or public leaderboard endpoint and pagination/rate limits.
2. Per-wallet fills/trades and market classification (RWA vs crypto).
3. Official points/weekly distribution endpoint and historical retention.
4. PnL fields and whether realized/unrealized values are provided.
5. Any supported WebSocket streams for live updates.

Do not infer points from volume or PnL from incomplete trade history. Use a small request budget, cache responses, and respect Arcus rate limits. Keep the existing Arcus Alert WebSocket implementation untouched.
