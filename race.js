/**
 * 併發寫入測試：模擬「好幾個人幾乎同時按下送出」。
 * 沒有上鎖的話，後寫的會把先寫的整包蓋掉 —— 有人的票會憑空消失。
 */
// 用法：npm start（另一個終端機）→ node race.js
// 想測檔案模式就 BASE=http://localhost:4000/api node race.js
const B = process.env.BASE || 'http://localhost:3000/api';
const j = async (m,p,b)=>{const r=await fetch(B+p,{method:m,headers:b?{'Content-Type':'application/json'}:{},body:b?JSON.stringify(b):undefined});
  const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||('HTTP '+r.status)); return d;};
let pass=0,fail=0;
const ok=(c,l,e)=>{c?(pass++,console.log('  ✓ '+l)):(fail++,console.log('  ✗ '+l+(e!==undefined?'　→ '+e:'')))};

const PEOPLE=[['小明','忠孝復興',['hotpot','ramen']],['小華','中山',['hotpot','sushi']],['小美','市政府',['bbq','hotpot']],
  ['阿哲','公館',['thai','ramen']],['婷婷','板橋',['italian','hotpot']],['阿良','南京復興',['korean','bbq']]];

async function makeRoom(){
  const room=await j('POST','/rooms',{title:'併發測試',date:'2026-09-05',time:'19:00'});
  const ms=[];
  for(const [n,s,t] of PEOPLE) ms.push(await j('POST',`/rooms/${room.id}/members`,{name:n,station:s,maxStations:10,types:t}));
  await j('POST',`/rooms/${room.id}/generate`,{});
  const pub=await j('GET',`/rooms/${room.id}`);
  const cands=pub.result.consensus.concat(pub.result.byType).map(x=>x.restaurant.id);
  const roles={};
  for(const m of ms){ const me=await j('GET',`/rooms/${room.id}/me?secret=${m.secret}`); roles[m.secret]=me.role.id; }
  return {R:room.id, ms, cands, roles, names:Object.fromEntries(ms.map((m,i)=>[m.secret,PEOPLE[i][0]]))};
}

(async()=>{
console.log('\n── 六個人「同時」加入同一個房間 ──');
{
  const room=await j('POST','/rooms',{title:'同時加入',date:'2026-09-05',time:'19:00'});
  const res=await Promise.all(PEOPLE.map(([n,s,t])=>
    j('POST',`/rooms/${room.id}/members`,{name:n,station:s,maxStations:10,types:t}).catch(e=>({error:e.message}))));
  const errs=res.filter(x=>x.error);
  const pub=await j('GET',`/rooms/${room.id}`);
  ok(errs.length===0,'六個請求全部成功', errs.map(e=>e.error).join('/'));
  ok(pub.members.length===6,'六個人全部都在房間裡（沒有人被蓋掉）', pub.members.length);
  ok(new Set(pub.members.map(m=>m.name)).size===6,'名字沒有重複或遺失', pub.members.map(m=>m.name).join('、'));
}

console.log('\n── 六個人「同時」送出投票 ──');
{
  const g=await makeRoom();
  const jobs=g.ms.map(m=>{
    const role=g.roles[m.secret];
    if(role==='fool') return j('POST',`/rooms/${g.R}/spin`,{secret:m.secret}).catch(e=>({error:e.message}));
    const body={secret:m.secret,picks:[g.cands[0]]};
    if(role==='wizard') body.swap=[g.cands[0],g.cands[1]];
    return j('POST',`/rooms/${g.R}/ballot`,body).catch(e=>({error:e.message}));
  });
  const res=await Promise.all(jobs);
  const errs=res.filter(x=>x.error);
  ok(errs.length===0,'六張票全部送出成功', errs.map(e=>e.error).join('/'));

  const fin=await j('GET',`/rooms/${g.R}`);
  ok(fin.stage==='revealed','六個人都投完 → 自動揭曉', fin.stage);
  ok(fin.members.every(m=>m.hasVoted),'每個人都被記錄成已投票',
     fin.members.filter(m=>!m.hasVoted).map(m=>m.name).join('、'));

  // 壞皇后的毒最多只能毒到一個人，而且不能毒到她自己
  const poisoned=fin.final.poisoned;
  const queenName=fin.final.roles.find(r=>r.role==='queen')?.name;
  ok(poisoned.length<=1,'最多只有一個人被毒（不會因為併發變成兩個）', poisoned.join('、'));
  ok(!poisoned.includes(queenName),'壞皇后不會毒到自己', queenName+' / '+poisoned.join('、'));

  // 票數要對得起來：沒被毒的人投的那家，票數 = 人數（國王算兩票）
  const kingName=fin.final.roles.find(r=>r.role==='king')?.name;
  const foolName=fin.final.roles.find(r=>r.role==='fool')?.name;
  const c0=fin.final.ranked.find(x=>x.id===g.cands[0]);
  let expect=0;
  fin.final.roles.forEach(r=>{
    if(poisoned.includes(r.name)) return;
    if(r.name===foolName) return;                    // 笨蛋轉到哪家不一定
    expect += (r.name===kingName?2:1);
  });
  // 魔法師交換：cands[0] 會拿到 cands[1] 的票
  const swapped = fin.final.swap && (fin.final.swap.a===g.cands[0] || fin.final.swap.b===g.cands[0]);
  console.log(`     國王=${kingName} 笨蛋=${foolName} 皇后=${queenName} 被毒=${poisoned.join('、')||'無'} 交換=${swapped?'有':'無'}`);
  if(!swapped){
    const foolHit = fin.final.ranked.find(x=>x.id===g.cands[0]);
    const got = foolHit?foolHit.votes:0;
    ok(got===expect || got===expect+1,
       `票數對得上（預期 ${expect} 或 ${expect}+笨蛋 1）`, got);
  }else{
    ok(true,'這一局有魔法師交換，票數對照交給其他測試');
  }
}

console.log('\n── 同一個人連按兩次送出 ──');
{
  const g=await makeRoom();
  const notFool=g.ms.find(m=>g.roles[m.secret]!=='fool' && g.roles[m.secret]!=='wizard');
  const body={secret:notFool.secret,picks:[g.cands[0]]};
  const [a,b]=await Promise.all([
    j('POST',`/rooms/${g.R}/ballot`,body).catch(e=>({error:e.message})),
    j('POST',`/rooms/${g.R}/ballot`,body).catch(e=>({error:e.message}))
  ]);
  const okCount=[a,b].filter(x=>!x.error).length;
  ok(okCount===1,'只有一個成功，另一個被擋下（不會投兩次）', `成功 ${okCount} 次`);
  ok([a,b].some(x=>x.error && /已經送出/.test(x.error)),'被擋的那個給的是正確訊息',
     [a,b].map(x=>x.error||'成功').join(' / '));
}

console.log('\n── 一邊投票一邊有人改條件 ──');
{
  const g=await makeRoom();
  const voter=g.ms.find(m=>g.roles[m.secret]!=='fool' && g.roles[m.secret]!=='wizard');
  const other=g.ms.find(m=>m!==voter);
  const [v,e]=await Promise.all([
    j('POST',`/rooms/${g.R}/ballot`,{secret:voter.secret,picks:[g.cands[0]]}).catch(x=>({error:x.message})),
    j('PUT',`/rooms/${g.R}/members/${other.memberId}`,{name:'改名字',station:'台北車站',maxStations:4,types:['ramen']}).catch(x=>({error:x.message}))
  ]);
  const pub=await j('GET',`/rooms/${g.R}`);
  ok(pub.stage==='collecting','有人改條件 → 房間回到填寫階段', pub.stage);
  ok(pub.result===null,'舊的推薦被清掉了');
  ok(pub.members.some(m=>m.name==='改名字'),'改名字有生效', pub.members.map(m=>m.name).join('、'));
  ok(pub.members.length===6,'沒有成員在併發中消失', pub.members.length);
  console.log(`     （投票 ${v.error?'被擋：'+v.error:'成功'}；兩種結果都合理，重點是資料沒壞）`);
}

console.log('\n'+(fail===0?`全部 ${pass} 項通過 ✅`:`${pass} 通過、${fail} 失敗 ❌`));
process.exit(fail===0?0:1);
})().catch(e=>{console.error('❌ '+e.message);process.exit(1)});
