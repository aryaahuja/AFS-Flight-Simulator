/** AFS Realtime room server — deploy separately from Vercel (Render/Railway/VM). */
'use strict';
const http = require('node:http');
const {randomBytes,randomUUID} = require('node:crypto');
const {WebSocketServer,WebSocket} = require('ws');

const PORT=Number(process.env.PORT||8787);
const MAX_PLAYERS=Math.max(2,Math.min(128,Number(process.env.MAX_PLAYERS||64)));
const SNAPSHOT_MS=150; // ~6.7 fps network: clients interpolate every rendering frame
const HEARTBEAT_MS=25000;
const IDLE_ROOM_MS=15*60*1000;
const rooms=new Map();
const clients=new Map();
const allowedAirframes=new Set(['737','A320','A350','787','F18','F22','B2']);
const modes=new Set(['free','race']);
const inboundLimit=2048;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const str=(v,max=24)=>String(v??'').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,max);
const num=(v,a,b)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b?v:null;
const validVec=(v,length,min,max)=>Array.isArray(v)&&v.length===length&&v.every(n=>num(n,min,max)!==null);
const wsSend=(ws,data)=>{if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<700000)ws.send(data);};
const send=(ws,obj)=>wsSend(ws,JSON.stringify(obj));
const httpServer=http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store');
  if(req.url==='/health'||req.url==='/'){
    res.setHeader('Content-Type','application/json');res.writeHead(200);
    res.end(JSON.stringify({ok:true,service:'AFS Multiplayer',rooms:rooms.size,players:clients.size,maxPerRoom:MAX_PLAYERS}));
  }else {res.writeHead(404);res.end('Not found');}
});
const wss=new WebSocketServer({server:httpServer,path:'/ws',maxPayload:inboundLimit,perMessageDeflate:false,clientTracking:true});
function worldFrom(request){
  const weather=request.weather||{};
  const airport=new Set(['startway','destination','coastal','metro']);
  const dep=airport.has(request.departure)?request.departure:'startway';
  let arr=airport.has(request.arrival)?request.arrival:'destination';if(dep===arr)arr=dep==='destination'?'startway':'destination';
  return {departure:dep,arrival:arr,weather:{time:clamp(Number(weather.time)||12,0,24),clouds:clamp(Number(weather.clouds)||50,0,100),rain:!!weather.rain&&Number(weather.clouds)>=40}};
}
function allocatePrivateCode(){
  for(let i=0;i<30;i++){
    const code=randomBytes(5).toString('hex').slice(0,6).toUpperCase();
    if(!rooms.has(code))return code;
  }throw Error('Please retry creating your room.');
}
function createRoom(code,mode,request){
  const r={code,mode,world:worldFrom(request),hostId:null,players:new Map(),raceState:'waiting',startAt:0,raceStartedAt:0,raceTimer:null,lastActive:Date.now()};
  rooms.set(code,r);return r;
}
function getPublicRoom(mode,request){
  const base=`PUBLIC-${mode.toUpperCase()}`;
  for(let i=0;i<1000;i++){
    const code=i?`${base}-${i+1}`:base;
    const existing=rooms.get(code);
    if(existing&&existing.mode===mode&&existing.players.size<MAX_PLAYERS){
      if(mode==='free'||existing.raceState==='waiting')return existing;
    }
    if(!existing)return createRoom(code,mode,request);
  }
  throw Error('Public servers are full. Please try creating a private room.');
}
function publicPlayer(p){
  return {id:p.id,name:p.name,aircraft:p.aircraft,livery:p.livery,position:p.position,rotation:p.rotation,speed:p.speed,progress:p.progress,finished:p.finished,finishedAt:p.finishedAt,place:p.place||0,dnf:p.dnf,premium:p.premium};
}
function roomPlayers(room){return [...room.players.values()].map(publicPlayer);}
function broadcast(room,obj){const body=JSON.stringify(obj);for(const p of room.players.values())wsSend(p.ws,body);}
function broadcastRoom(room){broadcast(room,{type:'room_state',code:room.code,mode:room.mode,hostId:room.hostId,maxPlayers:MAX_PLAYERS,players:roomPlayers(room),raceState:room.raceState,startAt:room.startAt});}
function safeName(request,room){
  let base=str(request.name,20).replace(/[\u007f-\u009f]/g,'');
  if(base.length<2)throw Error('Username needs at least 2 characters.');
  const taken=new Set([...room.players.values()].map(p=>p.name.toLowerCase()));
  if(!taken.has(base.toLowerCase()))return base;
  for(let i=2;i<100;i++){
    const n=`${base.slice(0,16)}#${i}`;
    if(!taken.has(n.toLowerCase()))return n;
  }
  throw Error('This name is already taken.');
}
function hello(ws,m){
  if(clients.has(ws))return;
  // Reject unnamed clients BEFORE allocating or joining any room.
  if(str(m.name,20).replace(/[\u007f-\u009f]/g,'').length<2)throw Error('Enter a username (2–20 characters) to join multiplayer.');
  const kind=['public','create','join'].includes(m.roomKind)?m.roomKind:'public';
  const mode=modes.has(m.mode)?m.mode:'free';
  let room;
  if(kind==='public')room=getPublicRoom(mode,m);
  else if(kind==='create')room=createRoom(allocatePrivateCode(),mode,m);
  else {
    const code=str(m.code,12).toUpperCase();room=rooms.get(code);
    if(!room)throw Error('Room not found. Check the private room code.');
    // The private room owns the mode. Never require the joining pilot to guess it.
    // Clients learn it from the welcome message before starting their flight.
  }
  if(room.players.size>=MAX_PLAYERS)throw Error(`Room is full (${MAX_PLAYERS} pilots).`);
  const player={ws,id:randomUUID(),name:safeName(m,room),aircraft:allowedAirframes.has(m.aircraft)?m.aircraft:'A320',livery:str(m.livery,40),premium:!!m.premium,position:null,rotation:null,speed:0,progress:0,total:0,finished:false,finishedAt:0,place:0,dnf:false,lastState:0,lastProgress:0,joinedAt:Date.now()};
  room.players.set(player.id,player);room.lastActive=Date.now();clients.set(ws,{room,player});
  if(!room.hostId)room.hostId=player.id;
  send(ws,{type:'welcome',id:player.id,code:room.code,mode:room.mode,world:room.world,hostId:room.hostId,maxPlayers:MAX_PLAYERS,players:roomPlayers(room),raceState:room.raceState,startAt:room.startAt});
  broadcastRoom(room);
}
function startRace(room,requester){
  if(room.mode!=='race')throw Error('This room is not a race.');
  if(room.hostId!==requester.id)throw Error('Only the room host can start a race.');
  if(room.players.size<2)throw Error('At least two pilots are needed to race.');
  if(room.raceState==='running'||room.raceState==='countdown')return;
  if(room.raceTimer)clearTimeout(room.raceTimer);
  room.raceState='countdown';room.startAt=Date.now()+6500;
  for(const p of room.players.values()){p.progress=0;p.total=0;p.finished=false;p.finishedAt=0;p.place=0;p.dnf=false;p.lastProgress=0;}
  broadcast(room,{type:'race_countdown',startAt:room.startAt});
  broadcastRoom(room);
  room.raceTimer=setTimeout(()=>{
    if(!rooms.has(room.code))return;
    room.raceState='running';room.raceStartedAt=room.startAt;room.raceTimer=null;
    broadcastRoom(room);
  },Math.max(0,room.startAt-Date.now()));
}
function stateFromPlayer(p,m){
  const now=Date.now();if(now-p.lastState<90)return;
  if(!validVec(m.position,3,-500000,500000)||!validVec(m.rotation,4,-1.001,1.001))return;
  const length=Math.hypot(...m.rotation);if(length<.8||length>1.2)return;
  const newPosition=m.position.map(v=>Math.round(v*10)/10);
  // Basic rate/teleport sanity check; accepts runway loading at initial spawn.
  if(p.position){const d=Math.hypot(...newPosition.map((v,i)=>v-p.position[i]));if(d>Math.max(450,((now-p.lastState)/1000)*900))return;}
  p.position=newPosition;p.rotation=m.rotation.map(v=>Math.round(v/length*10000)/10000);
  p.speed=clamp(Number(m.speed)||0,0,2600);p.lastState=now;
}
function progressFromPlayer(room,p,m){
  if(room.mode!=='race'||room.raceState!=='running'||p.finished||p.dnf)return;
  const next=Math.floor(Number(m.ring));const total=Math.floor(Number(m.total));const now=Date.now();
  if(!Number.isFinite(next)||!Number.isFinite(total)||total<10||total>220)return;
  if(next!==p.progress+1||now-p.lastProgress<180)return;
  if(p.total&&p.total!==total)return;
  p.progress=next;p.total=total;p.lastProgress=now;
  broadcastRoom(room);
}
function finishFromPlayer(room,p,m){
  if(room.mode!=='race'||room.raceState!=='running'||p.finished)return;
  if(p.total<10||p.progress<p.total){send(p.ws,{type:'error',message:'Collect every checkpoint to complete the race.'});return;}
  // Rank finishing pilots by their actual finish order. Only first three earn a place.
  const completed=[...room.players.values()].filter(x=>x.finished).length;
  p.finished=true;p.finishedAt=Date.now();p.place=completed<3?completed+1:0;
  if(p.place)send(p.ws,{type:'race_placement',place:p.place});
  broadcastRoom(room);
  const racers=[...room.players.values()];if(racers.every(x=>x.finished||x.dnf)){
    room.raceState='finished';broadcastRoom(room);
  }
}
function probeRoom(ws,m){
  const kind=['public','create','join'].includes(m.roomKind)?m.roomKind:'public';
  const requested=modes.has(m.mode)?m.mode:'free';
  if(kind==='join'){
    const code=str(m.code,12).toUpperCase();const room=rooms.get(code);
    if(!room){send(ws,{type:'error',message:'Room not found. Check the private room code.'});return;}
    send(ws,{type:'room_info',mode:room.mode,code:room.code,players:room.players.size,roomKind:kind,full:room.players.size>=MAX_PLAYERS});
  }else if(kind==='public'){
    const room=[...rooms.values()].find(r=>r.code.startsWith('PUBLIC-')&&r.mode===requested&&r.players.size<MAX_PLAYERS&&(requested==='free'||r.raceState==='waiting'));
    send(ws,{type:'room_info',mode:requested,code:room?.code||'PUBLIC',players:room?.players.size||0,roomKind:kind,full:false});
  }else send(ws,{type:'room_info',mode:requested,code:'AUTO',players:0,roomKind:kind,full:false});
}
function disconnect(ws){
  const found=clients.get(ws);if(!found)return;
  clients.delete(ws);const {room,player}=found;room.players.delete(player.id);room.lastActive=Date.now();
  if(room.hostId===player.id)room.hostId=room.players.keys().next().value||null;
  if(room.players.size===0){if(room.raceTimer)clearTimeout(room.raceTimer);rooms.delete(room.code);}
  else{
    broadcast(room,{type:'pilot_left',name:player.name,aircraft:player.aircraft});
    if(room.mode==='race'&&(room.raceState==='running'||room.raceState==='countdown')){
      if(room.players.size===1){const survivor=[...room.players.values()][0];if(!survivor.dnf){survivor.finished=true;survivor.finishedAt=survivor.finishedAt||Date.now();survivor.place=1;room.raceState='finished';if(room.raceTimer){clearTimeout(room.raceTimer);room.raceTimer=null;}send(survivor.ws,{type:'race_forfeit_win',winnerId:survivor.id});}}
      else if([...room.players.values()].every(p=>p.finished||p.dnf))room.raceState='finished';
    }
    broadcastRoom(room);
  }
}
wss.on('connection',ws=>{
  ws.alive=true;ws.on('pong',()=>ws.alive=true);
  ws.on('message',(raw,isBinary)=>{
    if(isBinary)return;
    try{
      const m=JSON.parse(raw.toString());if(!m||typeof m.type!=='string')return;
      if(m.type==='room_probe'){probeRoom(ws,m);return;}
      if(m.type==='hello'){hello(ws,m);return;}
      const found=clients.get(ws);if(!found)return;
      const {room,player:p}=found;
      if(m.type==='state')stateFromPlayer(p,m);
      else if(m.type==='progress')progressFromPlayer(room,p,m);
      else if(m.type==='finish')finishFromPlayer(room,p,m);
      else if(m.type==='start_race')startRace(room,p);
      else if(m.type==='dnf'&&room.mode==='race'){p.dnf=true;broadcastRoom(room);}
      else if(m.type==='respawn'){p.dnf=false;p.position=null;p.rotation=null;p.lastState=0;broadcastRoom(room);}
      else if(m.type==='ping')send(ws,{type:'pong',t:Number(m.t)||0});
    }catch(err){send(ws,{type:'error',message:str(err.message||'Invalid request',170)});}
  });
  ws.on('close',()=>disconnect(ws));ws.on('error',()=>disconnect(ws));
});
const broadcastSnapshots=setInterval(()=>{
  for(const room of rooms.values()){
    if(room.players.size<2)continue;
    const body=JSON.stringify({type:'snapshot',players:[...room.players.values()].filter(p=>p.position).map(publicPlayer)});
    for(const p of room.players.values())wsSend(p.ws,body);
  }
},SNAPSHOT_MS);
const heartbeat=setInterval(()=>{
  for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}
  for(const [code,room] of rooms){if(room.players.size===0&&Date.now()-room.lastActive>IDLE_ROOM_MS)rooms.delete(code);}
},HEARTBEAT_MS);
function shutdown(){clearInterval(broadcastSnapshots);clearInterval(heartbeat);for(const room of rooms.values())if(room.raceTimer)clearTimeout(room.raceTimer);wss.close(()=>httpServer.close(()=>process.exit(0)));setTimeout(()=>process.exit(1),7000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
httpServer.listen(PORT,'0.0.0.0',()=>console.log(`AFS multiplayer ready on :${PORT}, max ${MAX_PLAYERS} pilots per room`));
