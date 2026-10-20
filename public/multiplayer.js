/* AFS multiplayer client. The simulator itself is unchanged; only pilot state crosses the socket. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const ui = { setup:el('multiplayer-setup'),tile:el('multiplayerModeBtn'),single:el('singleplayerModeBtn'),singleModes:el('single-player-modes'),multiModes:el('multiplayer-modes'),heading:el('flight-mode-heading'),name:el('mp-username'),mode:el('mp-mode'),roomKind:el('mp-room-kind'),roomWrap:el('mp-room-code-wrap'),roomCode:el('mp-room-code'),url:el('mp-server-url'),menu:el('mp-menu-status'),help:el('mp-setup-help'),hud:el('mp-hud'),room:el('mp-room-indicator'),count:el('mp-count'),ping:el('mp-ping'),status:el('mp-status'),scores:el('mp-scoreboard'),gate:el('mp-race-gate'),gateTitle:el('mp-gate-title'),gateInfo:el('mp-gate-info'),startRace:el('mp-race-start') };
  if (!ui.tile || !ui.single || !ui.multiModes || !el('startButton')) return;
  const mp = {selected:false,ws:null,id:'',room:'',hostId:'',mode:'free',state:'waiting',max:64,roster:[],remote:new Map(),lagAccumulator:0,sendAccumulator:0,uiAccumulator:0,lastPingAt:0,latency:0,raceStartAt:0,raceStarted:false,lastCheckpoint:0,hasFinished:false,connecting:false};
  let singleChoice=null;
  let onlineChoice=null;
  const showError = message => { ui.menu.textContent=message; ui.help.textContent=message; ui.help.style.color='#fda4af'; };
  const text = (node,str) => { if(node) node.textContent=str; };
  const safe = val => String(val == null?'':val).trim().slice(0,36);
  const networkIsOpen = () => mp.ws && mp.ws.readyState === WebSocket.OPEN;
  const emit = obj => { if(networkIsOpen())mp.ws.send(JSON.stringify(obj)); };
  const isOnline = () => !!mp.id && networkIsOpen();
  try{ui.name.value=localStorage.getItem('afsPilotName')||'';ui.url.value=localStorage.getItem('afsRealtimeUrl')||'';}catch(_){ }

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
  ui.roomKind.addEventListener('change',()=>{ui.roomWrap.hidden=ui.roomKind.value!=='join';});
  el('mp-leave').addEventListener('click',()=>{if(window.confirm('Leave multiplayer and return to hangar?')){cleanup();location.reload();}});
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
    if(username.length<2){showError('Enter a username (2–20 characters).');ui.name.focus();return;}
    let url=ui.url.value.trim();
    if(!url){showError('Multiplayer server is not deployed yet. Add its wss:// URL under Connection settings.');ui.setup.querySelector('details').open=true;return;}
    if(/^https:\/\//i.test(url))url=url.replace(/^https:/i,'wss:');
    if(/^http:\/\//i.test(url))url=url.replace(/^http:/i,'ws:');
    if(!/^wss?:\/\//i.test(url)){showError('Use a wss:// multiplayer server URL.');return;}
    try{const parsed=new URL(url);if(parsed.pathname==='/'||!parsed.pathname)parsed.pathname='/ws';url=parsed.toString();}catch(_){showError('Invalid multiplayer URL.');return;}
    if(location.protocol==='https:'&&/^ws:\/\//i.test(url)){showError('Your Vercel website requires a secure wss:// multiplayer connection.');return;}
    let room=ui.roomCode.value.toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,12);
    if(ui.roomKind.value==='join'&&!room){showError('Enter your friend\'s private room code.');return;}
    mp.connecting=true; text(ui.menu,'Connecting…');ui.help.style.color='';
    el('startButton').disabled=true;
    try{
      const ws=new WebSocket(url);mp.ws=ws;
      const reply=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Connection timed out. Check that the real-time server is running.')),30000);
        ws.onopen=()=>ws.send(JSON.stringify({type:'hello',roomKind:ui.roomKind.value,code:room,mode:ui.mode.value,name:username,aircraft:selection,livery:selectedLivery,departure:departureAirportId,arrival:arrivalAirportId,weather:{time:timeOfDay,clouds:cloudDensity,rain:rainEnabled}}));
        ws.onerror=()=>{clearTimeout(timeout);reject(new Error('Could not reach the multiplayer server.'));};
        ws.onmessage=event=>{
          let message;try{message=JSON.parse(event.data);}catch(_){return;}
          if(message.type==='welcome'){clearTimeout(timeout);resolve(message);} else if(message.type==='error'){clearTimeout(timeout);reject(new Error(message.message||'Server rejected the connection.'));}
          else onMessage(message);
        };
        ws.onclose=()=>{clearTimeout(timeout);if(mp.id){text(ui.status,'Server disconnected — flight continues offline');mp.id='';ui.ping.textContent='Offline';}else reject(new Error('Server closed the connection.'));};
      });
      try{localStorage.setItem('afsPilotName',username);localStorage.setItem('afsRealtimeUrl',url);}catch(_){ }
      mp.id=reply.id;mp.room=reply.code;mp.hostId=reply.hostId;mp.max=reply.maxPlayers||64;mp.mode=reply.mode;mp.state=reply.raceState||'waiting';mp.roster=reply.players||[];
      mp.raceStartAt=reply.startAt||0;mp.raceStarted=reply.raceState==='running';mp.hasFinished=false;
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
      ui.room.textContent=(mp.room.startsWith('PUBLIC')?'PUBLIC':'ROOM '+mp.room)+(mp.mode==='race'?' · RACE':' · FREE');
      if(mp.mode==='race'){paused=true;mp.raceStarted=false;ui.gate.hidden=false;}
      else ui.gate.hidden=true;
      text(ui.menu,`Connected: ${mp.room}`);
      showToast(`Connected as ${username} · ${mp.room}`);
      drawHud();
    }catch(err){if(mp.ws){mp.ws.onclose=null;mp.ws.close();}mp.ws=null;showError(err.message||'Multiplayer unavailable');}
    finally{mp.connecting=false;updateStartButton();}
  }

  function onMessage(msg){
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

  // Low-draw-call airliner used after the dozen nearest/detailled replicas; keeps large rooms flyable.
  function createLiteRemoteAirliner(livery,airframe){
    const g=new THREE.Group();const wide=airframe==='787'||airframe==='A350';
    const span=wide?20:15,len=wide?20:15;
    const bodyMat=new THREE.MeshStandardMaterial({color:livery.body||0xffffff,roughness:.40,metalness:.15});
    const wingMat=new THREE.MeshStandardMaterial({color:livery.upper||0xdce8ef,roughness:.44,side:THREE.DoubleSide});
    const accent=new THREE.MeshStandardMaterial({color:livery.primary||0x175488,roughness:.41});
    const body=new THREE.Mesh(new THREE.CylinderGeometry(1.0,1.08,len,10),bodyMat);body.rotation.x=Math.PI/2;g.add(body);
    const wing=new THREE.Mesh(new THREE.BoxGeometry(span,.24,3.5),wingMat);wing.position.z=-.7;g.add(wing);
    const stab=new THREE.Mesh(new THREE.BoxGeometry(span*.36,.17,1.3),wingMat);stab.position.z=-len*.42;g.add(stab);
    const fin=new THREE.Mesh(new THREE.BoxGeometry(.19,3.6,2.6),accent);fin.position.set(0,1.7,-len*.43);g.add(fin);
    for(const side of [-1,1]){
      const eng=new THREE.Mesh(new THREE.CylinderGeometry(.60,.63,2.1,10),bodyMat);eng.rotation.x=Math.PI/2;eng.position.set(side*span*.20,-.85,.35);g.add(eng);
      const stripe=new THREE.Mesh(new THREE.BoxGeometry(.04,.17,len*.66),accent);stripe.position.set(side*1.09,.08,.2);g.add(stripe);
      addSideDecal(g,livery.label||'AFS',livery.text||'#123d7a',1.1,.50,1.65,5.2,.8,side);
    }
    g.scale.setScalar(wide?1.5:1.3);return g;
  }
  function createRemoteAircraft(p){
    const livery=(liveryCatalog[p.aircraft]||[]).find(l=>l.id===p.livery)||(liveryCatalog[p.aircraft]||[])[0]||{body:0xf4f5f7,primary:0x2266aa,secondary:0x38bdf8,label:'AFS'};
    let model;
    if(['737','A320','A350','787'].includes(p.aircraft)&&mp.remote.size<12)model=createSimpleAIAircraft(livery,p.aircraft);
    else if(['737','A320','A350','787'].includes(p.aircraft))model=createLiteRemoteAirliner(livery,p.aircraft);
    else{
      model=new THREE.Group();
      const body=new THREE.Mesh(new THREE.CylinderGeometry(.72,.98,p.aircraft==='B2'?9:12,12),new THREE.MeshStandardMaterial({color:livery.body||0x4b5563,metalness:.20,roughness:.53}));body.rotation.x=Math.PI/2;model.add(body);
      const span=p.aircraft==='B2'?28:12;
      const shape=new THREE.Shape();shape.moveTo(0,4);shape.lineTo(span,-2);shape.lineTo(span*.68,-5);shape.lineTo(0,-2.6);shape.lineTo(-span*.68,-5);shape.lineTo(-span,-2);shape.closePath();
      const geo=new THREE.ExtrudeGeometry(shape,{depth:.16,bevelEnabled:false});geo.rotateX(Math.PI/2);
      model.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:livery.upper||livery.body||0x64748b,side:THREE.DoubleSide,roughness:.56})));
      if(p.aircraft!=='B2')for(const side of [-1,1]){const tail=new THREE.Mesh(new THREE.BoxGeometry(.12,2.4,2.9),new THREE.MeshStandardMaterial({color:livery.primary||0x64748b}));tail.position.set(side*2.1,1.1,-4.3);tail.rotation.z=side*.20;model.add(tail);}
      model.scale.setScalar(p.aircraft==='B2'?1.5:1.15);
    }
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=90;const ctx=canvas.getContext('2d');
    ctx.fillStyle='rgba(2,12,25,.82)';ctx.fillRect(0,0,512,90);ctx.strokeStyle='#38bdf8';ctx.lineWidth=3;ctx.strokeRect(3,3,506,84);
    ctx.font='bold 43px Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ffffff';ctx.fillText(safe(p.name),256,48,490);
    const tex=new THREE.CanvasTexture(canvas);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,depthTest:false}));sprite.scale.set(21,4,1);sprite.position.y=9;model.add(sprite);
    model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    scene.add(model);
    return {group:model,position:new THREE.Vector3(),quaternion:new THREE.Quaternion(),ready:false,stale:performance.now(), name:p.name};
  }
  function removeRemote(id){const item=mp.remote.get(id);if(!item)return;scene.remove(item.group);item.group.traverse(o=>{if(o.isSprite&&o.material){if(o.material.map)o.material.map.dispose();o.material.dispose();}});mp.remote.delete(id);}
  function receiveRemote(p){
    if(!Array.isArray(p.position)||p.position.length!==3||!Array.isArray(p.rotation)||p.rotation.length!==4)return;
    let remote=mp.remote.get(p.id);if(!remote){remote=createRemoteAircraft(p);mp.remote.set(p.id,remote);}
    remote.position.set(...p.position);remote.quaternion.set(...p.rotation).normalize();
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
      r.group.visible=distance<33000;
      if(!r.group.visible)continue;
      const alpha=1-Math.exp(-Math.min(dt,.12)*11);
      r.group.position.lerp(r.position,alpha);r.group.quaternion.slerp(r.quaternion,alpha);
    }
    if(mp.uiAccumulator>.5){mp.uiAccumulator=0;drawHud();}
    if(mp.lagAccumulator>4){mp.lagAccumulator=0;mp.lastPingAt=Date.now();emit({type:'ping',t:mp.lastPingAt});}
  }
  function checkpoint(n){if(isOnline()&&mp.mode==='race'&&mp.raceStarted&&n>mp.lastCheckpoint){mp.lastCheckpoint=n;emit({type:'progress',ring:n,total:rings.length});}}
  function landed(score){if(isOnline()&&mp.mode==='race'&&mp.raceStarted&&!mp.hasFinished){mp.hasFinished=true;emit({type:'finish',score:Math.round(score),rings:ringsPassed,total:rings.length});}}
  function crashed(){if(isOnline()&&mp.mode==='race'&&mp.raceStarted)emit({type:'dnf'});}
  function cleanup(){if(mp.ws){mp.ws.onclose=null;mp.ws.close();}mp.ws=null;mp.id='';for(const [id] of mp.remote)removeRemote(id);ui.hud.hidden=true;ui.gate.hidden=true;}
  window.AFSMP={frame,checkpoint,landed,crashed,cleanup};
})();
