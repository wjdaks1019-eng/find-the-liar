'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=Number(process.env.PORT||3000),HOST=process.env.HOST||'0.0.0.0';
const ADMIN_PIN=process.env.ADMIN_PIN||'2468';
const DEFAULT_WORDS=[
['김밥','영화관','고양이','휴대전화','축구','생일'],
['라면','병원','코끼리','우산','수영','시험'],
['피자','편의점','강아지','냉장고','노래방','방학'],
['아이스크림','공항','모기','에어컨','여행','숙제'],
['치킨','놀이공원','원숭이','자전거','게임','콘서트'] ];
const CAP=[6,6,6,6,6,6],MAX_ROUND=5;
const newTeam=i=>({id:i+1,capacity:CAP[i],players:[],assignments:{}});
let state={round:0,phase:'lobby',version:1,mode:'normal',teams:CAP.map((_,i)=>newTeam(i)),words:DEFAULT_WORDS.map(r=>r.slice()),wordsVersion:1};
const DATA_FILE=process.env.DATA_FILE||path.join(__dirname,'.game-state.json');
try{const saved=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));if(saved&&saved.teams?.length===6&&saved.words?.length===5){state=saved;state.teams.forEach((t,i)=>t.capacity=CAP[i]);}}catch{}
function save(){try{const f=DATA_FILE+'.tmp';fs.writeFileSync(f,JSON.stringify(state));fs.renameSync(f,DATA_FILE);}catch(e){console.error('Persistence (ephemeral on Render free):',e.message);}}
const rand=()=>crypto.randomBytes(24).toString('hex');
const randomInt=n=>crypto.randomInt(n);
const hash=s=>crypto.createHash('sha256').update(String(s)).digest();
const checkPIN=p=>typeof p==='string'&&crypto.timingSafeEqual(hash(p),hash(ADMIN_PIN));
const fail=(res,msg,status=400)=>send(res,status,{error:msg});
function send(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(payload));}
function parse(req){return new Promise((resolve,reject)=>{let b='',aborted=false;req.on('data',x=>{b+=x;if(b.length>24000&&!aborted){aborted=true;reject(new Error('Too large'));req.destroy();}});req.on('end',()=>{if(aborted)return;try{resolve(JSON.parse(b||'{}'));}catch{reject(new Error('Invalid JSON'));}});req.on('error',reject);});}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function getPlayer(token){if(typeof token!=='string'||token.length!==48)return null;for(const team of state.teams){const p=team.players.find(x=>x.token===token);if(p)return {team,p};}return null;}
function pupilStatus(v){const {team,p}=v;const ret={phase:state.phase,round:state.round,team:team.id,capacity:team.capacity,ready:team.players.length,players:team.players.map(x=>({name:x.name,isMe:x.token===p.token})),me:p.name,version:state.version};if(state.phase==='playing'){const r=team.assignments[p.token];if(r)ret.card={role:r.role,potato:r.potato,word:r.role==='시민'?state.words[state.round-1][team.id-1]:null};else ret.inactive=true;}return ret;}
function hostStatus(showCards=false){return {round:state.round,phase:state.phase,mode:state.mode,version:state.version,wordsVersion:state.wordsVersion,teams:state.teams.map(t=>({id:t.id,capacity:t.capacity,ready:t.players.length,names:t.players.map(x=>x.name),active:state.phase==='playing'&&Object.keys(t.assignments).length>0, ...(showCards&&state.mode==='test'?{testCards:Object.values(t.assignments).map(a=>({name:a.name,role:a.role,potato:a.potato,word:a.role==='시민'?state.words[state.round-1][t.id-1]:null}))}:{})})),words:state.words.map(r=>r.slice()),warning:process.env.ADMIN_PIN?'':'기본 관리자 암호 2468 사용 중. 실제 수업 전 Render에서 ADMIN_PIN을 변경하세요.'};}
const validWords=w=>Array.isArray(w)&&w.length===5&&w.every(r=>Array.isArray(r)&&r.length===6&&r.every(v=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=40));
async function api(req,res,u){
 try{
  if(req.method==='GET'&&u.pathname==='/api/health')return send(res,200,{ok:true,version:'2.1.0'});
  if(req.method==='GET'&&u.pathname==='/api/status'){const v=getPlayer(u.searchParams.get('token'));return v?send(res,200,pupilStatus(v)):fail(res,'입장 정보가 만료되었어요. 다시 입장해 주세요.',401);}
  if(req.method!=='POST')return fail(res,'지원하지 않는 요청입니다.',405);
  const b=await parse(req);
  if(u.pathname==='/api/join'){
   const team=state.teams[Number(b.team)-1],name=String(b.name||'').trim().slice(0,24);
   if(!team)return fail(res,'조를 선택해 주세요.');if(!name)return fail(res,'이름을 입력해 주세요.');
   if(state.phase!=='lobby')return fail(res,'지금은 입장할 수 없어요. 다음 수업이 시작될 때 입장해 주세요.');
   if(team.players.length>=team.capacity)return fail(res,'이 조는 정원이 찼어요.');
   if(team.players.some(x=>x.name===name))return fail(res,'같은 이름이 있어요. 번호를 추가해 주세요.');
   const p={token:rand(),name};team.players.push(p);save();return send(res,200,{token:p.token,...pupilStatus({team,p})});
  }
  if(u.pathname==='/api/leave'){
    const v=getPlayer(b.token);if(!v)return fail(res,'참가 정보를 찾을 수 없어요.',401);
    if(state.phase==='playing')return fail(res,'게임 중에는 나갈 수 없어요.');
    v.team.players=v.team.players.filter(p=>p.token!==b.token);save();return send(res,200,{ok:true});
  }
  if(!u.pathname.startsWith('/api/host/'))return fail(res,'주소가 잘못됐어요.',404);
  if(!checkPIN(b.pin))return fail(res,'교사용 암호가 틀렸어요.',403);
  const action=u.pathname.slice('/api/host/'.length);
  if(action==='status')return send(res,200,hostStatus(true));
  if(action==='words'){
   if(state.phase==='playing')return fail(res,'게임 진행 중에는 제시어를 수정할 수 없어요.');
   if(!validWords(b.words))return fail(res,'5행 × 6조, 총 30개의 제시어를 입력해 주세요. (각 40자 이내)');
   state.words=b.words.map(r=>r.map(w=>w.trim()));state.wordsVersion++;save();return send(res,200,hostStatus());
  }
  if(action==='mode'){
   if(state.phase!=='lobby'||state.round!==0)return fail(res,'모드 변경은 새 수업 시작 전에만 가능해요. 전체 초기화 후 변경하세요.');
   if(!['normal','test'].includes(b.mode))return fail(res,'모드를 선택해 주세요.');
   state.mode=b.mode;state.version++;save();return send(res,200,hostStatus());
  }
  if(action==='start'){
   if(state.phase!=='lobby')return fail(res,'이미 시작했거나 종료된 게임이에요.');
   const minPlayers=state.mode==='test'?1:3;
   const active=state.teams.filter(t=>t.players.length>=minPlayers);
   if(!active.length)return fail(res,`시작할 수 있는 조가 없어요. ${state.mode==='test'?'테스트는 한 조에 1명':'일반 수업은 한 조에 최소 3명'}이 필요해요.`);
   if(state.round>=MAX_ROUND)return fail(res,'5판을 마쳤어요. 전체 초기화를 이용하세요.');
   state.round++;
   for(const team of state.teams){
    if(team.players.length<(state.mode==='test'?1:3)){team.assignments={};continue;}
    const slots=team.players.map(p=>({token:p.token,name:p.name}));
    if(state.mode==='test')for(let i=slots.length;i<team.capacity;i++)slots.push({token:`virtual-${team.id}-${i}`,name:`가상 학생 ${i+1}`});
    const ids=shuffle(slots.map(x=>x.token));const liar=ids[0],potato=ids[randomInt(ids.length)];
    team.assignments=Object.fromEntries(slots.map(x=>[x.token,{name:x.name,role:x.token===liar?'라이어':'시민',potato:x.token===potato}]));
   }
   state.phase='playing';state.version++;save();return send(res,200,hostStatus(true));
  }
  if(action==='next'){
   if(state.phase!=='playing')return fail(res,'진행 중인 판이 없어요.');
   if(state.round===MAX_ROUND){state.phase='complete';state.teams.forEach(t=>t.assignments={});state.version++;save();return send(res,200,hostStatus());}
   state.round++;
   for(const team of state.teams){
    if(team.players.length<(state.mode==='test'?1:3)){team.assignments={};continue;}
    const slots=team.players.map(p=>({token:p.token,name:p.name}));
    if(state.mode==='test')for(let i=slots.length;i<team.capacity;i++)slots.push({token:`virtual-${team.id}-${i}`,name:`가상 학생 ${i+1}`});
    const ids=shuffle(slots.map(x=>x.token)),liar=ids[0],potato=ids[randomInt(ids.length)];
    team.assignments=Object.fromEntries(slots.map(x=>[x.token,{name:x.name,role:x.token===liar?'라이어':'시민',potato:x.token===potato}]));
   }
   state.version++;save();return send(res,200,hostStatus(true));
  }
  if(action==='reset'){
   if(b.confirm!=='RESET')return fail(res,'초기화 확인이 필요해요.');
   state.round=0;state.phase='lobby';state.teams=CAP.map((_,i)=>newTeam(i));state.version++;save();return send(res,200,hostStatus());
  }
  return fail(res,'지원하지 않는 요청이에요.',404);
 }catch(e){console.error(e);return fail(res,'서버 오류가 발생했어요.',500);}
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer((req,res)=>{
 let u;try{u=new URL(req.url,'http://localhost');}catch{return fail(res,'잘못된 주소');}
 if(u.pathname.startsWith('/api/'))return api(req,res,u);
 if(req.method!=='GET')return fail(res,'GET 요청만 허용',405);
 const f=path.join(__dirname,'public',u.pathname==='/host'?'index.html':'index.html');
 fs.readFile(f,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':types['.html'],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);});
});server.listen(PORT,HOST,()=>console.log(`Liar game v2 running on ${HOST}:${PORT}`));
