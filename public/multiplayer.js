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
    if(mp.selected){
      const allowedMode=ui.roomKind.value==='join'||!!onlineChoice;
      el('startButton').disabled=!(selection && selectedLivery && validPilotName() && allowedMode);
    }
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
    ui.multiModes.hidden=!mp.selected||ui.roomKind.value==='join';
    const joinExisting=mp.selected&&ui.roomKind.value==='join';
    ui.heading.textContent=mp.selected?'2 · Select Multiplayer Mode':'2 · Select Single-Player Mode';
    ui.heading.hidden=joinExisting;
    ui.setup.classList.toggle('open',mp.selected);
    ui.roomWrap.hidden=ui.roomKind.value!=='join';
    ui.roomCode.required=ui.roomKind.value==='join';
    el('startButton').textContent=mp.selected?'Enter Multiplayer':'Take Command';
    if(mp.selected){
      ui.mode.value=onlineChoice||'free';
      gameMode=joinExisting?'realistic':onlineChoice?(onlineChoice==='race'?'arcade':'realistic'):null;
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
    if(mp.selected){ui.help.textContent=joinExisting?'Enter your friend’s room code. The server will identify Free Flight or Ring Race automatically.':'Choose Free Flight or Ring Race, enter your pilot name, and choose a plane and livery.';ui.help.style.color='';}
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
    refreshSelection();
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
    if(ui.roomKind.value!=='join'&&!onlineChoice){showError('Select Free Flight or Ring Race before joining multiplayer.');return;}
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
    // Connect once. The welcome packet identifies the actual room mode.
    // A separate room_probe could hang forever against a server not yet updated.
    mp.connecting=true;
    text(ui.menu,ui.roomKind.value==='join'?'Connecting and identifying room…':'Connecting to multiplayer…');
    ui.help.style.color='';
    el('startButton').disabled=true;
    try{await enterRoom(url,room,username);}
    catch(err){showError(err.message||'Unable to join multiplayer');}
    finally{mp.connecting=false;updateStartButton();}
  }

  async function enterRoom(url,room,username,detectedMode=null){
    try{
      const ws=new WebSocket(url);mp.ws=ws;
      const reply=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Connection timed out. Check that the real-time server is running.')),30000);
        ws.onopen=()=>ws.send(JSON.stringify({type:'hello',roomKind:ui.roomKind.value,code:room,mode:detectedMode||ui.mode.value,name:username,aircraft:selection,livery:selectedLivery,premium:!!premiumEnabled,departure:departureAirportId,arrival:arrivalAirportId,weather:{time:timeOfDay,clouds:cloudDensity,rain:rainEnabled}}));
        ws.onerror=()=>{clearTimeout(timeout);reject(new Error('Could not reach the multiplayer server.'));};
        ws.onmessage=event=>{
          let message;try{message=JSON.parse(event.data);}catch(_){return;}
          if(message.type==='welcome'){clearTimeout(timeout);resolve(message);} else if(message.type==='error'){clearTimeout(timeout);reject(new Error(message.message||'Server rejected the connection.'));}
          else onMessage(message);
        };
        ws.onclose=()=>{clearTimeout(timeout);if(mp.id){text(ui.status,'Server disconnected — flight continues offline');mp.id='';ui.ping.textContent='Offline';}else reject(new Error('Server closed the connection.'));};
      });
      // Private rooms announce their own authoritative mode, without a preflight probe.
      if(ui.roomKind.value==='join'){
        const approved=await new Promise(resolve=>{
          const modal=el('mp-room-confirm'),title=el('mp-confirm-title'),body=el('mp-confirm-description');
          const modeTitle=reply.mode==='race'?'Ring Race':'Free Flight';
          title.textContent='Join '+modeTitle+'?';
          body.textContent=`This server is ${modeTitle}. Do you want to proceed or return to hangar? ${Math.max(0,(reply.players||[]).length-1)} other pilot(s) are inside.`;
          modal.hidden=false;
          const yes=el('mp-confirm-proceed'),no=el('mp-confirm-back');
          const settle=answer=>{modal.hidden=true;yes.onclick=null;no.onclick=null;resolve(answer);};
          yes.onclick=()=>settle(true);no.onclick=()=>settle(false);
        });
        if(!approved){ws.onclose=null;ws.close();mp.ws=null;text(ui.menu,'Join cancelled · back at hangar');return;}
        ui.mode.value=reply.mode;onlineChoice=reply.mode;
      }
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
      el('mp-room-code-line').hidden=mp.room.startsWith('PUBLIC');el('mp-code-text').textContent=mp.room;
      if(mp.mode==='race'){paused=mp.state!=='running';mp.raceStarted=mp.state==='running';ui.gate.hidden=mp.raceStarted;}
      else ui.gate.hidden=true;
      text(ui.menu,mp.room.startsWith('PUBLIC')?`Connected to ${mp.room}`:`Private room code: ${mp.room} — share with friends`);
      showToast(mp.room.startsWith('PUBLIC')?`Connected as ${username}`:`Your room code: ${mp.room} · share it with friends`);
      drawHud();
    }catch(err){
      if(mp.ws){mp.ws.onclose=null;mp.ws.close();}mp.ws=null;
      // Compatibility with an older Render server that insists the client select
      // the private room's mode before it will send a welcome packet.
      // The joiner must not select a mode: identify the mode from that server
      // message, reconnect once and then show the normal Proceed/Back dialog.
      const message=String(err&&err.message||'');
      const legacyMode=/\b(ring\s*race|ring\s*run)\b/i.test(message)?'race':/\bfree\s*flight\b/i.test(message)?'free':null;
      const modeMismatch=/select.*(option|mode)|choose.*(option|mode)|mode.*mismatch/i.test(message);
      if(ui.roomKind.value==='join' && !detectedMode && legacyMode && modeMismatch){
        text(ui.menu,'Identified '+(legacyMode==='race'?'Ring Race':'Free Flight')+' room. Connecting…');
        return enterRoom(url,room,username,legacyMode);
      }
      throw err;
    }
  }

  function onMessage(msg){
    if(msg.type==='pilot_left'){
      const notice=`${safe(msg.name)} (${typeNames[msg.aircraft]||msg.aircraft||'Aircraft'}) left the server`;
      mp.departures.unshift(notice);mp.departures=mp.departures.slice(0,8);drawDepartures();
      if(isOnline())showToast(notice);return;
    }
    if(msg.type==='race_placement'){
      const labels={1:['YOU WIN! · 1ST PLACE','Congratulations! You finished first in the Ring Race.'],2:['2ND PLACE','You finished second in the Ring Race.'],3:['3RD PLACE','You finished third in the Ring Race.']};
      const result=labels[msg.place];
      if(result&&isOnline()){
        el('mp-race-result-title').textContent=result[0];el('mp-race-result-message').textContent=result[1];
        el('mp-race-forfeit').hidden=false;showToast(result[0]);
      }return;
    }
    if(msg.type==='race_forfeit_win'){
      if(msg.winnerId===mp.id&&!mp.forfeitShown){mp.forfeitShown=true;mp.state='finished';mp.hasFinished=true;paused=true;
        el('mp-race-result-title').textContent='YOU WIN! · BY FORFEIT';
        el('mp-race-result-message').textContent='All other pilots have left this Ring Race. You are the last remaining pilot and have won by forfeit.';
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
        const num=document.createElement('span');num.textContent=p.finished?(p.place&&p.place<=3?`${p.place}.`:'—'):'·';
        const name=document.createElement('span');name.className='mp-name';name.textContent=p.name;
        const score=document.createElement('span');score.textContent=p.finished?`${p.place&&p.place<=3?['','1ST','2ND','3RD'][p.place]+' · ':''}FIN ${p.finishedAt?((p.finishedAt-(mp.raceStartAt||p.finishedAt))/1000).toFixed(0)+'s':''}`:p.dnf?'DNF':`${p.progress||0} rings`;
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
  function frame(dt){
    if(!isOnline()||!plane)return;
    // Online humans replace the decorative offline AI pattern flights.
    for(const a of aiTraffic)a.model.visible=false;
    mp.sendAccumulator+=dt;mp.uiAccumulator+=dt;mp.lagAccumulator+=dt;
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
  function cleanup(){el('mp-room-code-line').hidden=true;el('mp-departures').replaceChildren();el('mp-race-forfeit').hidden=true;el('mp-room-confirm').hidden=true;mp.forfeitShown=false;mp.raceStarted=false;mp.hasFinished=false;mp.lastCheckpoint=0;mp.roster=[];mp.departures=[];if(mp.ws){mp.ws.onclose=null;mp.ws.close();}mp.ws=null;mp.id='';for(const [id] of mp.remote)removeRemote(id);ui.hud.hidden=true;ui.gate.hidden=true;}
  window.AFSMP={frame,checkpoint,landed,crashed,cleanup,isOnline,mode,lastCheckpoint,onRespawn};
})();
