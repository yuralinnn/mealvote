/**
 * 模擬 serverless：同一場飯局的每一次請求，輪流打到兩個「完全獨立的行程」。
 * 這兩個行程不共用任何記憶體，只共用同一個資料庫 ——
 * 正是 Vercel 上會發生的情況。程式只要有一點點依賴記憶體狀態，這裡就會爆。
 */
// 用法：開兩個終端機，各跑一次（同一個 DATABASE_URL、不同 PORT）
//   DATABASE_URL=... npm start
//   DATABASE_URL=... PORT=3001 npm start
// 然後 node serverless.js
const HOSTS=(process.env.HOSTS||'http://localhost:3000/api,http://localhost:3001/api').split(',');
let n=0;
const j=async(m,p,b)=>{
  const host=HOSTS[n++%HOSTS.length];                 // 每一次請求換一台
  const r=await fetch(host+p,{method:m,headers:b?{'Content-Type':'application/json'}:{},body:b?JSON.stringify(b):undefined});
  const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||('HTTP '+r.status)); return d;};
let pass=0,fail=0;
const ok=(c,l,e)=>{c?(pass++,console.log('  ✓ '+l)):(fail++,console.log('  ✗ '+l+(e!==undefined?'　→ '+e:'')))};

(async()=>{
const room=await j('POST','/rooms',{title:'跨行程測試',date:'2026-09-05',time:'19:00'});
ok(!!room.id,'A 建立房間，B 也看得到：'+room.id);
const seen=await j('GET',`/rooms/${room.id}`);
ok(seen.id===room.id,'另一台讀得到同一個房間');

const PEOPLE=[['小明','忠孝復興',['hotpot','ramen']],['小華','中山',['hotpot','sushi']],
  ['小美','市政府',['bbq','hotpot']],['阿哲','公館',['thai']],['婷婷','板橋',['italian']]];
const ms=[];
for(const [nm,s,t] of PEOPLE) ms.push(await j('POST',`/rooms/${room.id}/members`,{name:nm,station:s,maxStations:10,types:t}));
const after=await j('GET',`/rooms/${room.id}`);
ok(after.members.length===5,'五個人輪流在兩台填寫，全部都在',after.members.length);

await j('POST',`/rooms/${room.id}/generate`,{});
const pub=await j('GET',`/rooms/${room.id}`);
ok(pub.stage==='voting','在 A 產生推薦，B 讀到的已經是投票階段',pub.stage);
ok(!!pub.mystery,'彩蛋在另一台也看得到：'+(pub.mystery&&pub.mystery.alias));
ok(!pub.mystery.entry,'投票期間仍然不外洩真實店家');

const cands=pub.result.consensus.concat(pub.result.byType).map(x=>x.restaurant.id);
const roles={};
for(const m of ms){ const me=await j('GET',`/rooms/${room.id}/me?secret=${m.secret}`); roles[m.secret]=me.role.id; }
ok(Object.values(roles).filter(r=>r!=='commoner').length===4,'角色在跨行程之後仍然一致',Object.values(roles).join('/'));

// 每個人在「不同台」上送出
const order=ms.slice();
for(const m of order){
  const role=roles[m.secret];
  if(role==='fool'){ await j('POST',`/rooms/${room.id}/spin`,{secret:m.secret}); continue; }
  const body={secret:m.secret,picks:[cands[0],cands[1]]};
  if(role==='wizard') body.swap=[cands[0],cands[2]];
  await j('POST',`/rooms/${room.id}/ballot`,body);
}
const fin=await j('GET',`/rooms/${room.id}`);
ok(fin.stage==='revealed','五個人在兩台之間輪流投完 → 自動揭曉',fin.stage);
ok(fin.members.every(m=>m.hasVoted),'沒有人的票在切換行程時掉了');
ok(fin.final.poisoned.length<=1,'下毒仍然只作用一次',fin.final.poisoned.join('、'));
ok(!!fin.mystery.entry,'揭曉後真實店家公開：'+(fin.mystery.entry&&fin.mystery.entry.restaurant.name));
ok(fin.final.roles.length===5,'角色揭曉五個人都在');

console.log('\n'+(fail===0?`全部 ${pass} 項通過 ✅`:`${pass} 通過、${fail} 失敗 ❌`));
process.exit(fail===0?0:1);
})().catch(e=>{console.error('❌ '+e.message);process.exit(1)});
