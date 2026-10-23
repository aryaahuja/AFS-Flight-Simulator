# AFS Flight Simulator — Multiplayer / Recovery Update (v1.0.2)

## What's new
- Recover after a crash: single-player **Restart Flight** at departure runway, or **Return to Hangar**. Multiplayer Free Flight **Respawn on Runway**; Ring Race **Continue from Last Checkpoint**.
- Hangar navigation stays within the same browser page and preserves the PC/mobile device choice. Hold **Space for 3 seconds** while flying to return, with a progress animation; tap Space for pause, or use P.
- More readable **IMPORTANT: Read controls first before flying** notice and hold-Space control.
- Multiplayer room verification: when joining a private room, the server reports whether the room is a **Ring Race** or **Free Flight** before you confirm. Public joining and private room hosting stay automatic.
- Pilots are labeled by username, aircraft type and Premium/Standard; private rooms show the code in the flight panel with a clipboard button.
- Multiplayer-only draggable radar starts away from other visible cockpit/HUD controls, with player names and aircraft types (no liveries). Nearby and distant players remain visible on radar.
- Departing pilots appear in the room's activity list; when all other opponents leave a running race, the remaining pilot wins by forfeit.

## How to deploy the update
Commit the **contents of this folder** (not the outer folder) into the root of your existing GitHub `AFS-Flight-Simulator` repository. Keep the existing paths including `public/afs-game.html`, `public/multiplayer.js`, and `realtime-server/server.js`. Don't create a duplicate nested folder. Vercel builds the Next.js game from your GitHub `main` branch. Render must also deploy the updated `realtime-server/` (enable Auto Deploy for that Render Web Service or manually deploy the new GitHub commit). Both services need the same compatible update.

Your Vercel Production environment variable `AFS_MULTIPLAYER_SERVER_URL` should point to your own deployed `wss://...onrender.com/ws` service, not to a made-up address.

## Validation
JavaScript syntax and HTML ID checks passed. End-to-end multiplayer gameplay, varied viewport minimap placement, and real 64-player performance still require browser/load testing after deployment.

### Join Private Room fix
When Join Private Room is selected, the multiplayer mode cards are hidden. Enter the room code; the server detects the room mode and shows a confirmation before joining. Public and Host still require a mode choice.


Update: Multiplayer minimap/radar fully removed; all other multiplayer functionality remains.

## Ring Race reliability fix (October 2026)

- Ring checkpoints now use swept movement detection so high-speed aircraft can collect rings between physics frames.
- The browser resends its current cumulative ring count until the server acknowledges it.
- The multiplayer server accepts cumulative progress without dropping closely spaced checkpoints.
- An active Ring Race awards a by-forfeit victory to the last connected pilot when all other participants disconnect, and displays the result above the waiting overlay.

**Deployment:** Push the full project to the same GitHub repo. Confirm Vercel deploys `public/afs-game.html` and `public/multiplayer.js`, and Render deploys `realtime-server/server.js`. Both deployments are required for this fix.
