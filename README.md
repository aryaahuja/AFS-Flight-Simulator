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

### Ring Race forfeit notification hotfix
- The server now includes `forfeitWinnerId` in every room-state broadcast, not just a one-time WebSocket notification.
- The remaining pilot sees **YOU WIN! · BY FORFEIT** if all opponents leave an active race, even if the one-time event was missed.
- The client also supports older servers with a room-state fallback. For best results deploy both `public/multiplayer.js` and `realtime-server/server.js`.
- This only triggers for Ring Race with opponents present; it does not trigger for a solo waiting room or Free Flight.


## November 2026 visual upgrade (approved Startway landscape + seven aircraft)
- This is a **full multi-file Next.js + WebSocket server project**, NOT a replacement single-file website.
- Original baseline: archived `AFS-Flight-Simulator-v1.0.2-Forfeit-Notification-Hotfix.zip` (October 24, 2026). It includes the mobile/desktop airbrake updates reflected in `afs-game.html`, the forfeit notification logic in `multiplayer.js`/`realtime-server/server.js`, the rest of the Next.js frontend, and deployment configuration.
- Newly added files: `public/js/afs-glb-loader.js`, `public/assets/aircraft/*.glb` (seven), `public/assets/scenery/startway_approved.glb`, and `public/preview/landscape.html`.
- The original 3D airplanes are retained as **hidden fallback/flight-animation objects**. The new GLBs are displayed after they load. This preserves collision, flight model, effects, original controls and multiplayer server logic; however, the new GLB landing gear/control surfaces are not rigged, so their visual animation is limited.
- For Startway, the old terminal and old taxiway meshes are excluded to avoid obvious overlays. Existing runway markings, other airports, terrain and flight collisions stay in their original locations. The new landscape remains an approximation of the approved preview.
- These are authentic 3D GLB objects but **not guaranteed photorealistic**. JavaScript syntax and archive structure can be checked automatically; live browser, multiplayer, and flight tests are still required.

**Crucial version caution:** The files are recovered from your older archived October 24 v1.0.2 ZIP. They might **not** match all 25 current repository files/changes exactly. Before deploying, back up/clone the current GitHub repository, diff these against it and test on a staging Vercel project. Do not delete your current repository. If you want an exact in-place merge of whatever is deployed today, connect GitHub or supply the current repository ZIP.

### GitHub upload
1. Download and extract this ZIP. The root must contain `package.json`, `app/`, `public/`, and `realtime-server/`.
2. **Back up your live GitHub repository first** (Code → Download ZIP or make a new branch).
3. Upload all extracted files/folders together into a fresh branch or repository copy; do **not** upload the ZIP itself as the website.
4. Run the frontend as your existing Next.js deployment and the `realtime-server` separately according to `render.yaml`. Do not replace your existing WebSocket URL with an invented address.
5. Verify seven aircraft load, Startway landscape displays, airport/terrain height, brakes, ring counting, forfeit messages, mobile UI, and multiplayer before promoting to production.
