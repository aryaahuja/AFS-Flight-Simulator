/* AFS multiplayer client. The simulator itself is unchanged; only pilot state crosses the socket. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const ui = { setup:el('multiplayer-setup'),tile:el('multiplayerModeBtn'),single:el('singleplayerModeBtn'),singleModes:el('single-player-modes'),multiModes:el('multiplayer-modes'),heading:el('flight-mode-heading'),name:el('mp-username'),mode:el('mp-mode'),roomKind:el('mp-room-kind'),roomWrap:el('mp-room-code-wrap'),roomCode:el('mp-room-code'),url:el('mp-server-url'),menu:el('mp-menu-status'),help:el('mp-setup-help'),hud:el('mp-hud'),room:el('mp-room-indicator'),count:el('mp-count'),ping:el('mp-ping'),status:el('mp-status'),scores:el('mp-scoreboard'),gate:el('mp-race-gate'),gateTitle:el('mp-gate-title'),gateInfo:el('mp-gate-info'),startRace:el('mp-race-start') };
  if (!ui.tile || !ui.single || !ui.multiModes || !el('startButton')) return;
  const mp = {selected:false,ws:null,id:'',room:'',hostId:'',mode:'free',state:'waiting',max:64,roster:[],remote:new Map(),lagAccumulator:0,sendAccumulator:0,uiAccumulator:0,lastPingAt:0,latency:0,raceStartAt:0,raceStarted:false,lastCheckpoint:0,hasFinished:false,connecting:false,forfeitShown:false,departures:[],roomName:''};
  let singleChoice=null;
  let onlineChoice=null;
  const showError = message => { ui.menu.textContent=message; ui.help.textContent=message; ui.help.style.color='#fda4af'; };
  const text = (node,str) => { if(node) node.textContent=str; };
  const safe = val => String(val == null?'':val).trim().slice(0,36);
  const networkIsOpen = () => mp.ws && mp.ws.readyState === WebSocket.OPEN;
  const emit = obj => { if(networkIsOpen())mp.ws.send(JSON.stringify(obj)); };
  const isOnline = () => !!mp.id && networkIsOpen();
  try{ui.url.value=localStorage.getItem('afsRealtimeUrl')||'';}catch(_){ }
  // Require a deliberate username entry on every new multiplayer session.
  ui.name.value='';
  ui.name.required=true;ui.name.minLength=2;ui.name.maxLength=20;
  ui.name.setAttribute('aria-required','true');
  const validPilotName=()=>safe(ui.name.value).replace(/[<>"'`]/g,'').length>=2;
  const originalUpdateStartButton=updateStartButton;
  updateStartButton=function(){
    originalUpdateStartButton();
    if(mp.selected && !validPilotName()) el('startButton').disabled=true;
  };
  ui.name.addEventListener('input',()=>{
    if(validPilotName() && ui.menu.textContent.includes('username')) {ui.menu.textContent='Not connected';ui.help.textContent='Choose a multiplayer mode and enter the server.';ui.help.style.color='';}
    updateStartButton();
  });

  function refreshSelection(){
    ui.single.classList.toggle('active',!mp.selected);
    ui.tile.classList.toggle('active',mp.selected);
    ui.single.setAttribute('aria-pressed',String(!mp.selected));
    ui.tile.setAttribute('aria-pressed',String(mp.selected));
    ui.singleModes.hidden=mp.selected;
    ui.multiModes.hidden=!mp.selected;
    ui.heading.textContent=mp.selected?'2 · Select Multiplayer Mode':'2 · Select Single-Player Mode';
    ui.setup.classList.toggle('open',mp.selected);
    ui.roomWrap.hidden=ui.roomKind.value!=='join';
    ui.roomCode.required=ui.roomKind.value==='join';
    el('startButton').textContent=mp.selected?'Enter Multiplayer':'Take Command';
    if(mp.selected){
      ui.mode.value=onlineChoice||'free';
      gameMode=onlineChoice?(onlineChoice==='race'?'arcade':'realistic'):null;
    }else{
      gameMode=singleChoice;
    }
    document.querySelectorAll('#single-player-modes [data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===singleChoice));
    document.querySelectorAll('#multiplayer-modes [data-online-mode]').forEach(b=>{
      const active=b.dataset.onlineMode===onlineChoice;
      b.classList.toggle('active',active);
      b.setAttribute('aria-pressed',String(active));
    });
    updateRouteSelectorVisibility();
    updateStartButton();
  }
  ui.single.addEventListener('click',()=>{mp.selected=false;refreshSelection();});
  ui.tile.addEventListener('click',()=>{mp.selected=true;refreshSelection();});
  document.querySelectorAll('#single-player-modes [data-mode]').forEach(b=>b.addEventListener('click',()=>{
    singleChoice=b.dataset.mode;
    if(!mp.selected)refreshSelection();
  }));
  document.querySelectorAll('#multiplayer-modes [data-online-mode]').forEach(b=>b.addEventListener('click',()=>{
    onlineChoice=b.dataset.onlineMode;
    mp.selected=true;
    refreshSelection();
  }));
  ui.roomKind.addEventListener('change',()=>{
    const joiningPrivate=ui.roomKind.value==='join';
    ui.roomWrap.hidden=!joiningPrivate;
    ui.roomCode.required=joiningPrivate;
    if(!joiningPrivate)ui.roomCode.value='';
  });
  el('mp-leave').addEventListener('click',()=>{if(window.confirm('Leave multiplayer and return to hangar?'))returnToHangar();});
  const copyRoomButton=el('mp-copy-room');
  copyRoomButton.addEventListener('click',()=>{if(mp.room&&navigator.clipboard)navigator.clipboard.writeText(mp.room).then(()=>showToast('Room code copied: '+mp.room)).catch(()=>showToast('Your room code: '+mp.room));});
  el('mp-copy-inline').addEventListener('click',()=>copyRoomButton.click());
  ui.startRace.addEventListener('click',()=>{if(mp.id===mp.hostId)emit({type:'start_race'});});
  ui.url.addEventListener('change',()=>{try{localStorage.setItem('afsRealtimeUrl',ui.url.value.trim())}catch(_){}});
  refreshSelection();

  // Vercel hosts the game; this route returns the separately deployed WS server URL.
  fetch('/api/multiplayer-config',{cache:'no-store'}).then(r=>r.ok?r.json():{}).then(c=>{
    if(!ui.url.value.trim()&&c.url)ui.url.value=c.url;
    if(!ui.url.value.trim()&&/^(localhost|127\.0\.0\.1)$/.test(location.hostname))ui.url.value='ws://localhost:8787/ws';
  }).catch(()=>{});

  // The original menu's start listener was installed first. Capture lets us connect before start().
  el('startButton').addEventListener('click',event=>{
    if(!mp.selected)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(mp.connecting||isOnline())return;
    connectAndStart();
  },true);

  async function connectAndStart(){
    if(!onlineChoice){showError('Select Free Flight or Ring Race before joining multiplayer.');return;}
    const username=safe(ui.name.value).replace(/[<>"'`]/g,'');
    if(username.length<2){showError('You must enter a username (2–20 characters) before joining multiplayer.');ui.name.focus();return;}
    let url=ui.url.value.trim();
    if(!url){showError('Multiplayer server is not deployed yet. Add its wss:// URL under Connection settings.');ui.setup.querySelector('details').open=true;return;}
    if(/^https:\/\//i.test(url))url=url.replace(/^https:/i,'wss:');
    if(/^http:\/\//i.test(url))url=url.replace(/^http:/i,'ws:');
    if(!/^wss?:\/\//i.test(url)){showError('Use a wss:// multiplayer server URL.');return;}
    try{const parsed=new URL(url);if(parsed.pathname==='/'||!parsed.pathname)parsed.pathname='/ws';url=parsed.toString();}catch(_){showError('Invalid multiplayer URL.');return;}
    if(location.protocol==='https:'&&/^ws:\/\//i.test(url)){showError('Your Vercel website requires a secure wss:// multiplayer connection.');return;}
    let room=ui.roomKind.value==='join'?ui.roomCode.value.toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,12):'';
    if(ui.roomKind.value==='join'&&!room){showError('Enter your friend\'s private room code.');return;}
    // Identify the room BEFORE entering it. Private join reads the server's actual mode.
    mp.connecting=true;text(ui.menu,'Identifying server…');ui.help.style.color='';
    el('startButton').disabled=true;
    try{
      const info=await new Promise((resolve,reject)=>{
        const probe=new WebSocket(url);let finished=false;
        const timeout=setTimeout(()=>{if(!finished){finished=true;probe.close();reject(new Error('Server identification timed out.'));}},18000);
        probe.onopen=()=>probe.send(JSON.stringify({type:'room_probe',roomKind:ui.roomKind.value,code:room,mode:ui.mode.value}));
        probe.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch(_){return;}if(finished)return;
          if(m.type==='room_info'||m.type==='error'){finished=true;clearTimeout(timeout);probe.close();if(m.type==='error')reject(new Error(m.message));else resolve(m);}};
        probe.onerror=()=>{if(!finished){finished=true;clearTimeout(timeout);reject(new Error('Unable to identify server.'));}};
        probe.onclose=()=>{if(!finished){finished=true;clearTimeout(timeout);reject(new Error('Server closed the identification connection.'));}};
      });
      if(info.full)throw new Error('That multiplayer room is full.');
      const approved=ui.roomKind.value!=='join'?true:await new Promise(resolve=>{
        const modal=el('mp-room-confirm');const title=el('mp-confirm-title');const body=el('mp-confirm-description');
        const modeTitle=info.mode==='race'?'RING RACE':'FREE FLIGHT';
        title.textContent=modeTitle+' SERVER';
        body.textContent=`${info.roomKind==='create'?'You are creating a new private':info.roomKind==='join'?'You are joining a private':'You are joining a public'} ${modeTitle.toLowerCase()} server. ${info.players} pilot(s) currently inside. Do you want to proceed or return to hangar?`;
        modal.hidden=false;
        const yes=el('mp-confirm-proceed'),no=el('mp-confirm-back');
        const settle=answer=>{modal.hidden=true;yes.onclick=null;no.onclick=null;resolve(answer);};
        yes.onclick=()=>settle(true);no.onclick=()=>settle(false);
      });
      if(!approved){text(ui.menu,'Join cancelled · back at hangar');return;}
      // A private room has one authoritative mode; never trust the user's old selection.
      if(info.mode!==ui.mode.value){ui.mode.value=info.mode;onlineChoice=info.mode;gameMode=info.mode==='race'?'arcade':'realistic';refreshSelection();}
      await enterRoom(url,room,username);
    }catch(err){showError(err.message||'Unable to join multiplayer');}
    finally{mp.connecting=false;updateStartButton();}
  }

  async function enterRoom(url,room,username){
    try{
      const ws=new WebSocket(url);mp.ws=ws;
      const reply=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Connection timed out. Check that the real-time server is running.')),30000);
        ws.onopen=()=>ws.send(JSON.stringify({type:'hello',roomKind:ui.roomKind.value,code:room,mode:ui.mode.value,name:username,aircraft:selection,livery:selectedLivery,premium:!!premiumEnabled,departure:departureAirportId,arrival:arrivalAirportId,weather:{time:timeOfDay,clouds:cloudDensity,rain:rainEnabled}}));
        ws.onerror=()=>{clearTimeout(timeout);reject(new Error('Could not reach the multiplayer server.'));};
        ws.onmessage=event=>{
          let message;try{message=JSON.parse(event.data);}catch(_){return;}
          if(message.type==='welcome'){clearTimeout(timeout);resolve(message);} else if(message.type==='error'){clearTimeout(timeout);reject(new Error(message.message||'Server rejected the connection.'));}
          else onMessage(message);
        };
        ws.onclose=()=>{clearTimeout(timeout);if(mp.id){text(ui.status,'Server disconnected — flight continues offline');mp.id='';ui.ping.textContent='Offline';}else reject(new Error('Server closed the connection.'));};
      });
      try{localStorage.setItem('afsRealtimeUrl',url);}catch(_){ }
      mp.id=reply.id;mp.room=reply.code;copyRoomButton.hidden=mp.room.startsWith('PUBLIC');mp.hostId=reply.hostId;mp.max=reply.maxPlayers||64;mp.mode=reply.mode;mp.state=reply.raceState||'waiting';mp.roster=reply.players||[];
      mp.raceStartAt=reply.startAt||0;mp.raceStarted=reply.raceState==='running';mp.hasFinished=false;mp.lastCheckpoint=0;mp.forfeitShown=false;mp.departures=[];
      const world=reply.world||{};
      if(mp.mode==='race'){
        gameMode='arcade';departureAirportId=world.departure||departureAirportId;arrivalAirportId=world.arrival||arrivalAirportId;
        el('departureAirport').value=departureAirportId;el('arrivalAirport').value=arrivalAirportId;
      }else gameMode='realistic';
      if(world.weather){timeOfDay=Number(world.weather.time)||12;cloudDensity=Number(world.weather.clouds)||50;rainEnabled=!!world.weather.rain&&cloudDensity>=RAIN_CLOUD_MIN;
        el('timeSlider').value=timeOfDay;el('cloudSlider').value=cloudDensity;el('rainToggle').checked=rainEnabled;
        el('timeSliderValue').textContent=formatTimeOfDay(timeOfDay);el('cloudSliderValue').textContent=`${Math.round(cloudDensity)}%`;updateRainAvailability(false);applyWeather();}
      configureMissionAirports();
      start(); // run original game setup only after server confirms joining
      // Space starting aircraft across runway rows rather than stacking 64 aircraft in one spot.
      const slot=Math.max(0,mp.roster.findIndex(p=>p.id===mp.id));
      const offsetX=((slot%4)-1.5)*13;const offsetZ=Math.floor(slot/4)*55;
      plane.position.x+=offsetX;plane.position.z+=offsetZ;
      camera.position.x+=offsetX;camera.position.z+=offsetZ;
      smoothedCameraTarget.x+=offsetX;smoothedCameraTarget.z+=offsetZ;
      aiTraffic.forEach(a=>a.model.visible=false);
      ui.hud.hidden=false;document.body.classList.add('afs-online');
      ui.room.textContent=(mp.room.startsWith('PUBLIC')?'PUBLIC SERVER':'PRIVATE ROOM')+(mp.mode==='race'?' · RACE':' · FREE');
      el('mp-room-code-line').hidden=mp.room.startsWith('PUBLIC');el('mp-code-text').textContent=mp.room;showMinimap();
      if(mp.mode==='race'){paused=mp.state!=='running';mp.raceStarted=mp.state==='running';ui.gate.hidden=mp.raceStarted;}
      else ui.gate.hidden=true;
      text(ui.menu,mp.room.startsWith('PUBLIC')?`Connected to ${mp.room}`:`Private room code: ${mp.room} — share with friends`);
      showToast(mp.room.startsWith('PUBLIC')?`Connected as ${username}`:`Your room code: ${mp.room} · share it with friends`);
      drawHud();
    }catch(err){if(mp.ws){mp.ws.onclose=null;mp.ws.close();}mp.ws=null;throw err;}
  }

  function onMessage(msg){
    if(msg.type==='pilot_left'){
      const notice=`${safe(msg.name)} (${typeNames[msg.aircraft]||msg.aircraft||'Aircraft'}) left the server`;
      mp.departures.unshift(notice);mp.departures=mp.departures.slice(0,8);drawDepartures();
      if(isOnline())showToast(notice);return;
    }
    if(msg.type==='race_forfeit_win'){
      if(msg.winnerId===mp.id&&!mp.forfeitShown){mp.forfeitShown=true;mp.state='finished';mp.hasFinished=true;paused=true;
        el('mp-race-forfeit').hidden=false;showToast('All opponents left — you win by forfeit!');}
      return;
    }
    if(msg.type==='room_state'){
      mp.hostId=msg.hostId||mp.hostId;mp.state=msg.raceState||mp.state;mp.roster=msg.players||mp.roster;mp.raceStartAt=msg.startAt||mp.raceStartAt;mp.max=msg.maxPlayers||mp.max;
      for(const p of mp.roster)if(p.id!==mp.id&&p.position)receiveRemote(p);
      const valid=new Set(mp.roster.map(p=>p.id));for(const [id] of mp.remote)if(!valid.has(id))removeRemote(id);
      drawHud();return;
    }
    if(msg.type==='snapshot'){
      for(const p of msg.players||[])if(p.id!==mp.id)receiveRemote(p);
      return;
    }
    if(msg.type==='race_countdown'){
      mp.state='countdown';mp.raceStartAt=msg.startAt;mp.raceStarted=false;mp.hasFinished=false;
      if(plane){parkingBrake=true;state.throttleCommand=0;state.vel.set(0,0,0);state.pitchRate=state.rollRate=state.yawRate=0;}
      ringsPassed=0;rings.forEach(r=>{r.userData.passed=false;r.userData.passedAt=0;r.visible=true;});refreshRingRunVisuals();
      paused=true;ui.gate.hidden=false;drawHud();return;
    }
    if(msg.type==='standings'){mp.roster=msg.players||mp.roster;drawHud();return;}
    if(msg.type==='error'){text(ui.status,msg.message||'Server error');return;}
    if(msg.type==='pong'&&msg.t){mp.latency=Math.max(0,Date.now()-msg.t);}
  }

  function drawDepartures(){el('mp-departures').replaceChildren();for(const d of mp.departures){const line=document.createElement('div');line.textContent=d;el('mp-departures').appendChild(line);}}
  el('mp-forfeit-hangar').addEventListener('click',()=>returnToHangar());
  el('mp-forfeit-stay').addEventListener('click',()=>{el('mp-race-forfeit').hidden=true;paused=false;mp.raceStarted=true;ui.gate.hidden=true;});

  // Remote pilots use the SAME detailed geometry and livery builders as local aircraft.
  // Clone cached templates for players using the same aircraft/livery to share GPU assets.
  const aircraftTemplates = new Map();
  const typeNames = { '737':'Boeing 737-800', A320:'Airbus A320neo', A350:'Airbus A350-900', '787':'Boeing 787-9', F18:'F/A-18E', F22:'F-22A', B2:'B-2 Spirit' };
  function remoteAircraftModel(p){
    const key=p.aircraft+':'+p.livery;
    if(!aircraftTemplates.has(key)){
      const oldSelection=selection, oldLivery=selectedLivery;
      let source;
      try {
        selection=p.aircraft;
        selectedLivery=p.livery;
        source=p.aircraft==='737'?create737():p.aircraft==='787'?create787():p.aircraft==='A320'?createA320():p.aircraft==='A350'?createA350():p.aircraft==='F18'?createF18():p.aircraft==='F22'?createF22():createB2();
      } finally {selection=oldSelection;selectedLivery=oldLivery;}
      aircraftTemplates.set(key,source);
    }
    return aircraftTemplates.get(key).clone(true);
  }
  function createRemoteAircraft(p){
    const model=remoteAircraftModel(p);
    model.name=`Online Pilot · ${safe(p.name)} · ${typeNames[p.aircraft]||p.aircraft}`;
    const livery=(liveryCatalog[p.aircraft]||[]).find(l=>l.id===p.livery);
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=140;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='rgba(4,15,34,.85)';ctx.fillRect(0,0,768,140);
    ctx.strokeStyle='#39d5ff';ctx.lineWidth=4;ctx.strokeRect(3,3,762,134);
    ctx.font='bold 54px Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ffffff';
    ctx.fillText(safe(p.name),384,49,735);
    ctx.font='32px Arial,sans-serif';ctx.fillStyle='#80dfff';
    ctx.fillText(`${typeNames[p.aircraft]||p.aircraft} · ${p.premium?'★ PREMIUM':'STANDARD'}`,384,104,730);
    const texture=new THREE.CanvasTexture(canvas);
    const nameplate=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,depthTest:false}));
    nameplate.name='pilotUsernameLabel';nameplate.scale.set(32,5.83,1);
    nameplate.position.set(0,p.aircraft==='B2'?9:11,0);
    // The label is attached to the *actual* plane, not a stand-in geometric marker.
    model.add(nameplate);
    scene.add(model);
    return {group:model,position:new THREE.Vector3(),quaternion:new THREE.Quaternion(),ready:false,stale:performance.now(),name:p.name,aircraft:p.aircraft,livery:p.livery,premium:!!p.premium};
  }
  function removeRemote(id){const item=mp.remote.get(id);if(!item)return;scene.remove(item.group);item.group.traverse(o=>{if(o.isSprite&&o.material){if(o.material.map)o.material.map.dispose();o.material.dispose();}});mp.remote.delete(id);}
  function receiveRemote(p){
    if(!Array.isArray(p.position)||p.position.length!==3||!Array.isArray(p.rotation)||p.rotation.length!==4)return;
    let remote=mp.remote.get(p.id);if(remote && (remote.aircraft!==p.aircraft||remote.livery!==p.livery)){removeRemote(p.id);remote=null;}if(!remote){remote=createRemoteAircraft(p);mp.remote.set(p.id,remote);}
    remote.name=p.name;remote.premium=!!p.premium;remote.position.set(...p.position);remote.quaternion.set(...p.rotation).normalize();
    if(!remote.ready){remote.group.position.copy(remote.position);remote.group.quaternion.copy(remote.quaternion);remote.ready=true;}
    remote.stale=performance.now();
  }
  function drawHud(){
    if(!isOnline())return;
    const online=mp.roster.length||1;ui.count.textContent=`${online} / ${mp.max} PILOTS`;
    ui.ping.textContent=mp.latency?`${mp.latency}ms`:'Connected';
    if(mp.mode==='race'){
      const ordered=[...mp.roster].sort((a,b)=>{if(a.finished&&b.finished)return a.finishedAt-b.finishedAt;if(a.finished)return -1;if(b.finished)return 1;return (b.progress||0)-(a.progress||0);});
      ui.scores.replaceChildren();ordered.slice(0,12).forEach((p,i)=>{
        const row=document.createElement('div');row.className='mp-rank'+(p.id===mp.id?' self':'');
        const num=document.createElement('span');num.textContent=`${i+1}.`;
        const name=document.createElement('span');name.className='mp-name';name.textContent=p.name;
        const score=document.createElement('span');score.textContent=p.finished?`FIN ${p.finishedAt?((p.finishedAt-(mp.raceStartAt||p.finishedAt))/1000).toFixed(0)+'s':''}`:p.dnf?'DNF':`${p.progress||0} rings`;
        row.append(num,name,score);ui.scores.appendChild(row);
      });
      if(mp.state==='running')text(ui.status,`Race underway · ${mp.roster.length} pilots`);
      else if(mp.state==='countdown')text(ui.status,'Race countdown in progress');
      else if(mp.state==='finished')text(ui.status,'Race finished · see standings');
      else text(ui.status,'Waiting for host to launch race');
      const waiting=(mp.state==='waiting'||mp.state==='finished');
      ui.startRace.hidden=!(waiting&&mp.id===mp.hostId&&online>=2);
      ui.gate.hidden=!(waiting||mp.state==='countdown')||mp.raceStarted;
      if(waiting){text(ui.gateTitle,mp.state==='finished'?'RACE COMPLETE':'WAITING FOR PILOTS');text(ui.gateInfo,online<2?'At least two pilots are needed to race.':mp.id===mp.hostId?'Press START RACE when everyone is ready.':'The room host starts the race.');}
    }else{
      ui.scores.replaceChildren();text(ui.status,`Flying together · ${mp.room}`);ui.gate.hidden=true;
    }
  }
  // Drag-only header. Default location avoids HUD, throttle and joystick.
  const mapPanel=el('mp-minimap'),mapCanvas=el('mp-map-canvas'),mapCtx=mapCanvas.getContext('2d');
  let mapDragged=false,mapCollapsed=false,mapDrag=null,mapAccumulator=0;
  function placeMapSafely(){
    if(mapDragged||mapPanel.hidden)return;
    mapPanel.style.left='';mapPanel.style.right='';mapPanel.style.top='';mapPanel.style.bottom='';
    const w=mapPanel.offsetWidth,h=mapPanel.offsetHeight,vw=innerWidth,vh=innerHeight;
    const hudRect=ui.hud.getBoundingClientRect();
    const candidates=[
      {x:vw-w-12,y:Math.max(60,hudRect.bottom+12)},
      {x:12,y:Math.max(215,Math.round(vh*.43))},
      {x:Math.max(12,(vw-w)/2),y:Math.max(80,vh-h-14)},
      {x:vw-w-12,y:Math.max(80,vh-h-190)}
    ];
    const blockers=['hud-strip','hud-left','controls-panel','power-controls','mobile-controls','attitude','mp-hud'].map(id=>el(id)).filter(Boolean).filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(node).display!=='none'}).map(node=>node.getBoundingClientRect());
    const penalty=pos=>{const x=Math.max(6,Math.min(vw-w-6,pos.x)),y=Math.max(6,Math.min(vh-h-6,pos.y));let overlap=0;
      for(const r of blockers)overlap+=Math.max(0,Math.min(x+w,r.right)-Math.max(x,r.left))*Math.max(0,Math.min(y+h,r.bottom)-Math.max(y,r.top));return {x,y,overlap};};
    let best=candidates.map(penalty).sort((a,b)=>a.overlap-b.overlap)[0];
    mapPanel.style.left=best.x+'px';mapPanel.style.top=best.y+'px';
  }
  function showMinimap(){mapPanel.hidden=false;mapDragged=false;requestAnimationFrame(placeMapSafely);}
  el('mp-map-toggle').addEventListener('click',()=>{mapCollapsed=!mapCollapsed;mapPanel.classList.toggle('collapsed',mapCollapsed);el('mp-map-toggle').textContent=mapCollapsed?'+':'−';if(!mapDragged)requestAnimationFrame(placeMapSafely);});
  el('mp-map-head').addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;mapDragged=true;const rect=mapPanel.getBoundingClientRect();mapDrag={id:e.pointerId,dx:e.clientX-rect.left,dy:e.clientY-rect.top};e.currentTarget.setPointerCapture(e.pointerId);});
  el('mp-map-head').addEventListener('pointermove',e=>{if(!mapDrag||mapDrag.id!==e.pointerId)return;
    const x=Math.max(4,Math.min(innerWidth-mapPanel.offsetWidth-4,e.clientX-mapDrag.dx));const y=Math.max(4,Math.min(innerHeight-mapPanel.offsetHeight-4,e.clientY-mapDrag.dy));mapPanel.style.left=x+'px';mapPanel.style.top=y+'px';});
  const endMapDrag=()=>mapDrag=null;
  el('mp-map-head').addEventListener('pointerup',endMapDrag);el('mp-map-head').addEventListener('pointercancel',endMapDrag);
  window.addEventListener('resize',()=>{if(!mapPanel.hidden&&!mapDragged)placeMapSafely();});
  function drawMap(){if(mapPanel.hidden||mapCollapsed||!plane)return;
    const c=mapCtx,w=mapCanvas.width,h=mapCanvas.height;c.clearRect(0,0,w,h);
    c.fillStyle='#071729';c.fillRect(0,0,w,h);c.strokeStyle='#2b5671';c.lineWidth=1;
    for(let i=1;i<4;i++){c.beginPath();c.arc(w/2,h/2,i*19,0,Math.PI*2);c.stroke();}
    c.beginPath();c.moveTo(w/2,0);c.lineTo(w/2,h);c.moveTo(0,h/2);c.lineTo(w,h/2);c.stroke();
    // Always retain distant traffic on radar. Zoom automatically out to fit the room.
    let range=2000;for(const r of mp.remote.values())if(r.ready)range=Math.max(range,Math.hypot(r.position.x-plane.position.x,r.position.z-plane.position.z)*1.32);
    range=Math.min(100000,range);
    c.font='bold 10px Arial';c.fillStyle='#4ade80';c.beginPath();c.arc(w/2,h/2,4.3,0,Math.PI*2);c.fill();c.fillText('YOU',w/2+7,h/2-6);
    for(const r of mp.remote.values()){
      if(!r.ready)continue;const x=w/2+(r.position.x-plane.position.x)*((w*.40)/range),y=h/2-(r.position.z-plane.position.z)*((h*.43)/range);
      c.fillStyle=r.premium?'#facc15':'#38bdf8';c.beginPath();c.arc(x,y,3.7,0,Math.PI*2);c.fill();
      const txt=`${r.name} · ${typeNames[r.aircraft]||r.aircraft}`;
      c.font='9px Arial';c.strokeStyle='#071729';c.lineWidth=3;c.strokeText(txt,Math.min(x+6,w-118),Math.max(11,y-5),119);c.fillStyle='#e5f4ff';c.fillText(txt,Math.min(x+6,w-118),Math.max(11,y-5),119);
    }
    const list=el('mp-map-list');list.replaceChildren();for(const r of mp.remote.values()){
      const row=document.createElement('div');row.textContent=`● ${r.name} · ${typeNames[r.aircraft]||r.aircraft}`;list.appendChild(row);
    }
    if(!mp.remote.size)list.textContent='No other pilots in range';
  }
  function frame(dt){
    if(!isOnline()||!plane)return;
    // Online humans replace the decorative offline AI pattern flights.
    for(const a of aiTraffic)a.model.visible=false;
    mp.sendAccumulator+=dt;mp.uiAccumulator+=dt;mp.lagAccumulator+=dt;mapAccumulator+=dt;if(mapAccumulator>.35){mapAccumulator=0;drawMap();}
    if(mp.mode==='race'&&(mp.state==='countdown'||(mp.state==='running'&&!mp.raceStarted))){
      const remains=Math.max(0,Math.ceil((mp.raceStartAt-Date.now())/1000));
      if(remains>0){paused=true;ui.gate.hidden=false;text(ui.gateTitle,String(remains));text(ui.gateInfo,'Get ready! Hold your throttle until GO.');}
      else if(!mp.raceStarted){paused=false;mp.raceStarted=true;mp.state='running';parkingBrake=true;ui.gate.hidden=true;showToast('GO! · Release parking brake and take off');drawHud();}
    }else if(mp.mode==='race'&&!mp.raceStarted&&mp.state!=='running'&&mp.state!=='finished')paused=true;
    if(mp.sendAccumulator>.125){
      mp.sendAccumulator=0;
      if(!systems.replay)emit({type:'state',position:[plane.position.x,plane.position.y,plane.position.z].map(n=>Math.round(n*10)/10),rotation:[plane.quaternion.x,plane.quaternion.y,plane.quaternion.z,plane.quaternion.w].map(n=>Math.round(n*10000)/10000),speed:Math.round(state.iasKnots||0)});
    }
    for(const [id,r] of mp.remote){
      if(performance.now()-r.stale>12000){r.group.visible=false;continue;}
      const distance=plane.position.distanceTo(r.position);
      r.group.visible=distance<100000;
      if(!r.group.visible)continue;
      const alpha=1-Math.exp(-Math.min(dt,.12)*11);
      r.group.position.lerp(r.position,alpha);r.group.quaternion.slerp(r.quaternion,alpha);
      const label=r.group.getObjectByName('pilotUsernameLabel');
      if(label){const scale=Math.max(32,Math.min(1250,distance*.030));label.scale.set(scale,scale*5.83/32,1);}

    }
    if(mp.uiAccumulator>.5){mp.uiAccumulator=0;drawHud();}
    if(mp.lagAccumulator>4){mp.lagAccumulator=0;mp.lastPingAt=Date.now();emit({type:'ping',t:mp.lastPingAt});}
  }
  function checkpoint(n){if(isOnline()&&mp.mode==='race'&&mp.raceStarted&&n>mp.lastCheckpoint){mp.lastCheckpoint=n;emit({type:'progress',ring:n,total:rings.length});}}
  function landed(score){if(isOnline()&&mp.mode==='race'&&mp.raceStarted&&!mp.hasFinished){mp.hasFinished=true;emit({type:'finish',score:Math.round(score),rings:ringsPassed,total:rings.length});}}
  function crashed(){/* A crash is recoverable; do not mark a racer DNF. */}
  function onRespawn(){if(isOnline())emit({type:'respawn'});}
  const mode=()=>mp.mode;const lastCheckpoint=()=>mp.lastCheckpoint;
  function cleanup(){el('mp-room-code-line').hidden=true;el('mp-departures').replaceChildren();el('mp-race-forfeit').hidden=true;el('mp-room-confirm').hidden=true;mapPanel.hidden=true;mp.forfeitShown=false;mp.raceStarted=false;mp.hasFinished=false;mp.lastCheckpoint=0;mp.roster=[];mp.departures=[];if(mp.ws){mp.ws.onclose=null;mp.ws.close();}mp.ws=null;mp.id='';for(const [id] of mp.remote)removeRemote(id);ui.hud.hidden=true;ui.gate.hidden=true;}
  window.AFSMP={frame,checkpoint,landed,crashed,cleanup,isOnline,mode,lastCheckpoint,onRespawn};
})();
