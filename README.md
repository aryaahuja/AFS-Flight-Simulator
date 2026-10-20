# AFS Flight Simulator — Single-Player + Multiplayer

This ZIP contains the complete **Next.js game for Vercel** and a separate **WebSocket multiplayer server for Render**. You must publish **both** for multiplayer to work online. Single-player works without the server.

## What's on the new game menu?

1. Choose your **aircraft and livery**.
2. Under **1 · Choose How to Play**, select either:
   - **Single Player** → Free Flight, Ring Run, Training.
   - **Multiplayer** → Free Flight, Ring Race.
3. Choose the desired flight mode in the **2 · Select ... Mode** area. Ring Run / Ring Race also shows the departure and arrival runway selectors.
4. For multiplayer only: enter a username, choose Public Server / Create Private Room / Join Private Room, and select **Enter Multiplayer**.

**Capacity:** Default is up to **64 pilots per room** (`MAX_PLAYERS=64`). Actual stable concurrent capacity depends on host hardware/bandwidth and device performance; it has not been stress-tested with 64 real players.

## Step-by-step: make multiplayer work on the internet

### 1. Unzip and put the files on GitHub

1. Download and **extract** the ZIP (do not upload the ZIP itself as the source repository).
2. Go to https://github.com and sign in. Create a new repository, for example `afs-flight-simulator` (public or private).
3. Upload **the files and folders inside the unzipped project** to the repository root. Do not accidentally add an extra enclosing folder. The GitHub repository's top level should contain:
   ```
   app/
   public/
   realtime-server/
   package.json
   render.yaml
   vercel.json
   README.md
   ```
   You may use GitHub **Add file → Upload files**, or Git from your computer if you prefer.
4. Commit the changes to the repository (typically its `main` branch).

### 2. Deploy the live multiplayer server using Render

1. Go to https://dashboard.render.com/ and sign up/sign in.
2. Choose **New → Web Service** (Node). Connect your GitHub account and choose the repository you just made.
3. Fill in the deployment form:

   | Render setting | Value |
   | --- | --- |
   | **Name** | `afs-realtime-server` (or any unique name) |
   | **Language/Runtime** | `Node` |
   | **Root Directory** | `realtime-server` |
   | **Build Command** | `npm install --omit=dev` |
   | **Start Command** | `npm start` |
   | **Environment Variable** | `MAX_PLAYERS` = `64` |

   If Render asks you to select a Node version, Node **24** matches the included `package.json`.
4. Choose a service plan. Render plan availability and limits can change. A sleeping/free server may be slow to wake up or disconnect players, so use an always-on plan if you want reliable multiplayer.
5. Press **Deploy Web Service** and wait for its status to show the server running.
6. Copy the server's HTTPS URL (Render provides one), for example:
   `https://afs-realtime-server.onrender.com`
7. **Test the server:** open `https://YOUR-RENDER-NAME.onrender.com/health` in a browser. A response containing `"ok":true` means the server process is reachable.
8. Convert the Render address into the multiplayer WebSocket address by changing `https://` to `wss://` and appending `/ws`:
   `wss://YOUR-RENDER-NAME.onrender.com/ws`

**Alternative:** The repository also includes `render.yaml` to deploy as a Render **Blueprint**, instead of manually creating a Web Service. Only use one of these deployment methods so you don't create duplicate servers.

### 3. Deploy/update the game on Vercel

1. Go to https://vercel.com/new and sign in.
2. Import the **same GitHub repository**. If you already have an AFS game project in Vercel, update the code of that linked repository and keep the existing Vercel project instead of creating a duplicate.
3. The **Root Directory** must be the **repository root**, not `realtime-server`.
4. Vercel should recognize **Next.js** automatically. Keep the default build settings unless your project requires custom ones.
5. Before deploying (or afterwards under **Project → Settings → Environment Variables**), add:
   - **Name:** `AFS_MULTIPLAYER_SERVER_URL`
   - **Value:** `wss://YOUR-RENDER-NAME.onrender.com/ws`
   - **Environment:** **Production** (and **Preview** too if you will test preview URLs).
6. Save and **Deploy**. If you added/changed the environment variable after a deployment, start a **new deployment** from **Deployments → ⋯ → Redeploy**; existing deployments do not automatically get the new value.
7. Open your live Vercel URL and verify the simulator loads normally.

### 4. Test multiplayer with a friend

1. Both of you open the **same Vercel game URL** in separate browsers/devices.
2. Each selects **PC** or **Mobile**, an aircraft, and a livery.
3. Choose **Multiplayer**, then **Free Flight** (or **Ring Race**).
4. Enter **different usernames** and choose a room type:
   - **Join Public Server**: players selecting the same multiplayer mode join an available shared room automatically.
   - **Create Private Room**: the game creates a code, shown in the in-game room label.
   - **Join Private Room**: enter the friend's room code; **both players must select the same mode**.
5. Click **Enter Multiplayer**. When connected, you'll see the room/pilot-count HUD and other pilots' planes.
6. For **Ring Race**, at least **two pilots** must join the same room. The room **host presses START RACE**; everyone gets the same countdown and course, with scores as you pass the rings.

### 5. If it doesn't connect

- **"Server is not deployed yet"**: check that `AFS_MULTIPLAYER_SERVER_URL` is configured for your deployed environment, then redeploy Vercel. Or expand **Connection settings** in the game and paste the `wss://.../ws` URL temporarily.
- **"Could not reach the multiplayer server"**: check `https://YOUR-RENDER-NAME.onrender.com/health`; inspect Render logs; try again after the service starts.
- **"wss:// required"**: your live Vercel HTTPS game cannot connect to an insecure `ws://` address. Use Render's secure `wss://` address.
- **"Room not found"**: enter the code exactly, make sure the host is connected, and choose the same Free Flight / Ring Race mode.
- **"Host can't start race"**: two or more people must be in the same Ring Race room. Only the host can press START RACE.
- **Free flight works but you can't see anybody**: make sure everyone is in the **same room**, is near enough in the world for aircraft to render, and is connected to the **same server URL**.
- **High player counts lag**: lower `MAX_PLAYERS` (e.g. 16/32) and increase server resources. The maximum configurable range in this server is 2–128, **not a performance guarantee**.

## Local multiplayer test (optional)

Run in two terminal windows:

```bash
# terminal 1, from the unzipped project
cd realtime-server
npm install
npm start
```

```bash
# terminal 2, from the project root
npm install
npm run dev
```

Then open http://localhost:3000 in two tabs. The game automatically defaults to `ws://localhost:8787/ws` when running locally and the server URL is not configured.

## Existing game features retained

All 7 aircraft, their liveries and Premium choices, flight handling and stability fixes, smooth Ring Run, 4 airports, single-player training, weather, GPWS, mobile and desktop controls, cockpit/camera modes, engine toggle, and existing scoring/replays remain. Single-player does not need a network connection to the multiplayer server.

## Honest limits

- The server supports live guest sessions. It does **not** include account verification, voice chat, persistent stats, or authoritative anti-cheat checks.
- Rooms exist in the running server's memory and disappear after server restarts. Scaling to multiple server instances needs shared room/session storage and routing, not just an environment variable.
- The server must actually be hosted online; merely uploading the ZIP to Vercel cannot run a persistent WebSocket server on Vercel functions.
- Real-world load testing and two-device end-to-end tests must be done after deployment.
