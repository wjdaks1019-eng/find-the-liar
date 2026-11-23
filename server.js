'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '.game-state.json');
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const MAX_ROUND = 5;
const CAPACITIES = [5, 5, 5, 5, 5, 6];
const WORDS = [
  ['김밥','영화관','고양이','휴대전화','축구','생일'],
  ['라면','병원','코끼리','우산','수영','시험'],
  ['피자','편의점','강아지','냉장고','노래방','방학'],
  ['아이스크림','공항','모기','에어컨','여행','숙제'],
  ['치킨','놀이공원','원숭이','자전거','게임','콘서트'],
];
const validTeam = n => Number.isInteger(n) && n >= 1 && n <= 6;
const newTeam = (i) => ({id:i+1, capacity:CAPACITIES[i], round:0, phase:'lobby', players:[], assignments:{}, history:[]});
let teams = CAPACITIES.map((_,i)=>newTeam(i));
function load() {try {const j=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));if(Array.isArray(j.teams)&&j.teams.length===6)teams=j.teams;}catch{}}
load();
function save() {try{const temp=DATA_FILE+'.tmp';fs.writeFileSync(temp,JSON.stringify({teams}));fs.renameSync(temp,DATA_FILE);}catch(err){console.error('save failed:',err.message)}}
const secret = () => crypto.randomBytes(24).toString('hex');
const shuffle = (arr) => {const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
function getPlayer(token) {if(typeof token!=='string'||token.length!==48)return null;for(const team of teams){const player=team.players.find(p=>p.token===token);if(player)return {team,player};}return null;}
function status(team,player){const out={team:team.id, capacity:team.capacity, round:team.round, phase:team.phase, players:team.players.map(p=>({name:p.name,isMe:p.token===player.token})), isCaptain:team.players[0]?.token===player.token,me:player.name,ready:team.players.length};if(team.phase==='playing'){const assignment=team.assignments[player.token];if(assignment){out.card={role:assignment.role,potato:assignment.potato,word:assignment.role==='시민'?WORDS[team.round-1][team.id-1]:null};}}return out;}
function json(res,status,obj) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj));}
function error(res,message,status=400){json(res,status,{error:message});}
function body(req){return new Promise((resolve,reject)=>{let b='';req.on('data',x=>{b+=x;if(b.length>12000){reject(Error('too-large'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(b||'{}'));}catch{reject(Error('invalid-json'));}});req.on('error',reject);});}
async function api(req,res,url){
  try{
    if(req.method==='GET'&&url.pathname==='/api/status'){const v=getPlayer(url.searchParams.get('token'));return v?json(res,200,status(v.team,v.player)):error(res,'참가 정보를 찾지 못했습니다. 다시 입장하세요.',401);}
    if(req.method==='GET'&&url.pathname==='/api/health'){return json(res,200,{ok:true,teams:6,rounds:MAX_ROUND});}
    if(req.method!=='POST')return error(res,'허용되지 않는 요청입니다.',405);
    const b=await body(req);
    if(url.pathname==='/api/join'){
      const n=Number(b.team),name=String(b.name||'').trim().slice(0,24);
      if(!validTeam(n))return error(res,'1~6조를 선택하세요.');
      if(name.length<1)return error(res,'이름 또는 번호를 입력하세요.');
      const team=teams[n-1];
      if(team.phase==='playing')return error(res,'이 조는 게임 진행 중입니다. 다음 판에 입장하세요.');
      if(team.players.length>=team.capacity)return error(res,`${n}조 정원은 ${team.capacity}명입니다.`);
      if(team.players.some(p=>p.name===name))return error(res,'같은 조에 같은 이름이 있습니다. 이름 뒤에 번호를 붙여 주세요.');
      const p={name,token:secret()};team.players.push(p);save();return json(res,200,{token:p.token,...status(team,p)});
    }
    const v=getPlayer(b.token);if(!v)return error(res,'참가 정보가 없습니다. 새로 입장하세요.',401);
    const {team,player}=v;
    if(url.pathname==='/api/start'){
      if(team.players[0]?.token!==player.token)return error(res,'첫 번째 입장 학생(조장)만 시작할 수 있습니다.',403);
      if(team.phase==='playing')return error(res,'이미 게임이 진행 중입니다.');
      if(team.round>=MAX_ROUND)return error(res,'5판이 모두 끝났습니다.');
      if(team.players.length<3)return error(res,'최소 3명이 입장해야 시작할 수 있습니다.');
      team.round++;
      const order=shuffle(team.players.map(p=>p.token));
      const liar=order[0],potato=order[crypto.randomInt(order.length)];
      team.assignments=Object.fromEntries(order.map(t=>[t,{role:t===liar?'라이어':'시민',potato:t===potato}]));
      team.phase='playing';team.history.push({round:team.round,playerCount:team.players.length});save();return json(res,200,status(team,player));
    }
    if(url.pathname==='/api/finish'){
      if(team.players[0]?.token!==player.token)return error(res,'조장만 판을 종료할 수 있습니다.',403);
      if(team.phase!=='playing')return error(res,'진행 중인 판이 없습니다.');
      team.phase=team.round>=MAX_ROUND?'complete':'lobby';team.assignments={};save();return json(res,200,status(team,player));
    }
    if(url.pathname==='/api/leave'){
      if(team.phase==='playing')return error(res,'진행 중에는 나갈 수 없습니다. 판을 끝낸 뒤 나가세요.');
      team.players=team.players.filter(p=>p.token!==player.token);save();return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/reset-team'){
      // Only captain can reset the group's session; not available during a round.
      if(team.players[0]?.token!==player.token)return error(res,'조장만 초기화할 수 있습니다.',403);
      if(team.phase==='playing')return error(res,'게임 중에는 초기화할 수 없습니다.');
      team.round=0;team.phase='lobby';team.assignments={};team.history=[];save();return json(res,200,status(team,player));
    }
    if(url.pathname==='/api/admin-reset'){
      if(!ADMIN_PIN)return error(res,'관리자 초기화 기능이 비활성화되어 있습니다.',403);
      if(typeof b.pin!=='string'||!crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(b.pin).digest()),Buffer.from(crypto.createHash('sha256').update(ADMIN_PIN).digest())))return error(res,'관리자 암호가 올바르지 않습니다.',403);
      teams=CAPACITIES.map((_,i)=>newTeam(i));save();return json(res,200,{ok:true});
    }
    return error(res,'지원하지 않는 요청입니다.',404);
  }catch(err){console.error(err);return error(res,'요청을 처리하지 못했습니다.',500);}
}
const mimetype={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 let url;try{url=new URL(req.url,'http://localhost');}catch{return error(res,'잘못된 주소입니다.');}
 if(url.pathname.startsWith('/api/'))return api(req,res,url);
 if(req.method!=='GET')return error(res,'허용되지 않는 요청입니다.',405);
 const pathName=url.pathname==='/'?'/index.html':url.pathname;
 const f=path.resolve(ROOT,'.'+pathName);
 if(!f.startsWith(ROOT+path.sep))return error(res,'접근할 수 없습니다.',403);
 fs.readFile(f,(err,buf)=>{if(err)return error(res,'파일을 찾을 수 없습니다.',404);res.writeHead(200,{'Content-Type':mimetype[path.extname(f)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(buf);});
});
server.listen(PORT,HOST,()=>console.log(`Find the Liar on http://${HOST}:${PORT}`));
