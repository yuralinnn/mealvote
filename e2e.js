const {chromium} = require('playwright');
const BASE='http://localhost:3000';
const errs=[];

function watch(p,tag){
  p.on('dialog',d=>d.accept());
  p.on('pageerror',e=>errs.push(`[${tag}] PAGEERROR ${e.message}`));
  p.on('console',m=>{ if(m.type()==='error' && !/ZZZZZZ|404/.test(m.text())) errs.push(`[${tag}] CONSOLE ${m.text()}`); });
  p.on('requestfailed',r=>{ if(!/ZZZZZZ/.test(r.url())) errs.push(`[${tag}] REQFAIL ${r.url()}`); });
}

async function fill(page,{name,station,dist,types}){
  await page.fill('#fName',name);
  await page.fill('#fStation',station);
  await page.click(`#fDist button[data-v="${dist}"]`);
  for(const t of types) await page.click(`#fTypes .opt[data-t="${t}"]`);
  await page.click('#btnSubmit');
  await page.waitForSelector('#meDone:not(.hide)',{timeout:5000});
}

(async()=>{
  const b = await chromium.launch();

  // ---- 發起人：小明（手機尺寸）----
  const c1 = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const p1 = await c1.newPage(); watch(p1,'小明');
  await p1.goto(BASE);
  await p1.fill('#hTitle','週五下班聚餐');
  await p1.fill('#hDate','2026-08-21');
  await p1.fill('#hTime','19:30');
  await p1.click('#btnCreate');
  await p1.waitForSelector('#viewRoom:not(.hide)');
  const roomId = await p1.textContent('#rCode');
  console.log('✅ 建立房間：', roomId, '→', p1.url());

  await fill(p1,{name:'小明',station:'市政府',dist:6,types:['japanese','bbq']});
  console.log('✅ 小明填寫完成');

  // ---- 小華在自己的手機（獨立 context = 獨立 localStorage）----
  const c2 = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const p2 = await c2.newPage(); watch(p2,'小華');
  await p2.goto(`${BASE}/r/${roomId}`);
  await p2.waitForSelector('#viewRoom:not(.hide)');
  const seen = await p2.textContent('#mCount');
  console.log('✅ 小華用連結進入，看到成員數：', seen.trim());
  await fill(p2,{name:'小華',station:'公館',dist:10,types:['hotpot','ramen']});

  // ---- 小美用房號加入 ----
  const c3 = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const p3 = await c3.newPage(); watch(p3,'小美');
  await p3.goto(BASE);
  await p3.fill('#hJoin',roomId.toLowerCase());
  await p3.click('#btnJoin');
  await p3.waitForSelector('#viewRoom:not(.hide)');
  console.log('✅ 小美用房號（小寫）加入成功');
  await fill(p3,{name:'小美',station:'中山',dist:4,types:['korean','hotpot']});

  // ---- 小明的畫面應該自動輪詢到 3 人 ----
  await p1.waitForFunction(()=>document.querySelectorAll('#mList .m').length===3,{timeout:12000});
  console.log('✅ 小明畫面自動更新為 3 人（未重新整理）');

  // ---- 產生推薦 ----
  await p1.click('#btnGen');
  await p1.waitForSelector('#results .r',{timeout:15000});
  const recs = await p1.evaluate(()=>{
    const secs=[...document.querySelectorAll('#results .sec')].map(s=>({
      t:s.querySelector('h3').textContent,
      items:[...s.querySelectorAll('.r')].map(r=>({
        name:r.querySelector('h4').textContent,
        pill:r.querySelector('.pill')?.textContent||'',
        meta:r.querySelector('.meta')?.innerText.replace(/\n/g,' ')||'',
        why:r.querySelector('.why')?.textContent.trim()||'',
        who:[...r.querySelectorAll('.who span')].map(x=>x.textContent)
      }))
    }));
    return {secs, warn:document.querySelector('.warnbox')?.innerText||null};
  });
  console.log('\n📋 推薦結果：');
  recs.secs.forEach(s=>{
    console.log('\n  ── '+s.t);
    s.items.forEach(i=>{
      console.log(`     ${i.name} [${i.pill}] ${i.meta}`);
      if(i.why) console.log(`       ${i.why}`);
      console.log(`       ${i.who.join(' / ')}`);
    });
  });
  if(recs.warn) console.log('\n  ⚠️ '+recs.warn.replace(/\n/g,' '));

  // ---- 投票：三人各自在自己的瀏覽器（獨立 context）----
  await p2.waitForSelector('#results .r',{timeout:12000});
  await p3.waitForSelector('#results .r',{timeout:12000});
  console.log('\n✅ 小華、小美的畫面自動進入投票階段');

  const pages = { 小明:p1, 小華:p2, 小美:p3 };

  // 角色卡：每個人只看得到自己的
  const myRole = {};
  for(const [who,pg] of Object.entries(pages)){
    await pg.waitForSelector('#modal.on .mrole',{timeout:10000});
    myRole[who] = await pg.textContent('#modal.on .mrole h3');
  }
  console.log('✅ 角色卡各自跳出：', Object.entries(myRole).map(([k,v])=>k+'='+v).join('、'));

  // 別人的角色不可從前端資料看到
  const leaked = await p1.evaluate(()=>JSON.stringify(window.ROOM||{}).match(/king|queen|wizard|fool|commoner/));
  if(leaked) throw new Error('房間資料外洩了角色：'+leaked[0]);
  const apiLeak = await p1.evaluate(async()=>{
    const r = await fetch('/api/rooms/'+location.pathname.split('/').pop()).then(x=>x.json());
    return JSON.stringify(r).match(/"roles"|"secret"|"ballots"|"restaurantId"/);
  });
  if(apiLeak) throw new Error('公開 API 外洩：'+apiLeak[0]);
  console.log('✅ 公開房間資料不含 roles / secret / ballots / 彩蛋真實店家');

  // 彩蛋：三個人看到的代稱必須一樣，而且只有 10 秒可以決定
  const aliases = [];
  const bet = {};
  let betTaken = false;
  for(const [who,pg] of Object.entries(pages)){
    await pg.click('#modal .btn');                       // 關角色卡 → 跳彩蛋
    await pg.waitForSelector('#modal.on .mmystery',{timeout:10000});
    aliases.push(await pg.textContent('#modal.on .mmystery h3'));

    const acts = await pg.evaluate(()=>[...document.querySelectorAll('.myacts .btn')].map(b=>b.textContent));
    if(acts.length === 2){
      const cd = await pg.textContent('#myCd');
      if(cd !== '10') throw new Error('倒數沒有從 10 開始：'+cd);
      // 第一個有決定權的人賭一把，其餘的人放棄
      if(!betTaken){ await pg.click('.myacts .btn'); bet[who] = true; betTaken = true; }
      else { await pg.click('.myacts .btn.ghost'); bet[who] = false; }
    }else{
      // 笨蛋沒有決定權，只能看
      await pg.click('#modal .btn'); bet[who] = false;
    }
    await pg.waitForFunction(()=>!document.getElementById('modal').classList.contains('on'));
  }
  if(new Set(aliases).size !== 1) throw new Error('同房間彩蛋不一致：'+aliases.join('/'));
  console.log('✅ 今日隱藏推薦全房共用同一間：'+aliases[0]+'（10 秒視窗，'+
    Object.entries(bet).map(([k,v])=>k+(v?'賭了':'放棄')).join('、')+'）');

  // 決定完之後，那張卡片不能再點 —— 錯過就是錯過
  for(const [who,pg] of Object.entries(pages)){
    const st = await pg.evaluate(()=>{
      const c=document.querySelector('.r.mystery');
      return c ? {txt:c.innerText.replace(/\n+/g,' '), clickable:!!c.querySelector('button.pickbtn')} : null;});
    if(!st) continue;
    if(st.clickable) throw new Error(who+' 的彩蛋卡片還可以點');
    const want = bet[who] ? '已押注' : (myRole[who] === '笨蛋' ? '轉盤不含這一家' : '已錯過');
    if(st.txt.indexOf(want) < 0) throw new Error(who+' 的彩蛋卡片狀態不對：'+st.txt);
  }
  console.log('✅ 10 秒過後彩蛋卡片鎖住（押注／錯過各自顯示，都不能再點）');

  // 取得可投的餐廳 id（彩蛋不在其中，它的去留在彈窗就決定了）。
  // 笨蛋畫面上沒有可點的卡片，所以要挑一個不是笨蛋的人來讀。
  const foolName = Object.keys(myRole).find(k=>myRole[k]==='笨蛋');
  const voterName = Object.keys(pages).find(k=>k !== foolName);
  const vp = pages[voterName];
  const ids = await vp.evaluate(()=>[...document.querySelectorAll('button.pickbtn')]
    .map(b=>b.getAttribute('onclick').match(/'([^']+)'/)[1]));
  if(!ids.length) throw new Error(voterName+' 畫面上沒有可投的卡片');
  if(ids.indexOf('mystery') >= 0) throw new Error('彩蛋不該還在可點清單裡');
  console.log('✅ 一般選項 '+ids.length+' 家可以自由勾選');

  // 複選：勾三家再取消一家
  for(const id of ids.slice(0,3)){ await vp.click(`button.pickbtn[onclick*="'${id}'"]`); await vp.waitForTimeout(120); }
  const mine = await vp.evaluate(()=>document.querySelectorAll('button.pickbtn.on').length);
  if(mine !== 3) throw new Error('複選失敗，應為 3 家，實得 '+mine);
  // 押了彩蛋的話，送出鍵上的數字要把它算進去
  const expectCount = 3 + (bet[voterName] ? 1 : 0);
  const btnTxt = await vp.textContent('#btnBallot');
  if(btnTxt.indexOf(String(expectCount)) < 0)
    throw new Error('送出數不對，預期 '+expectCount+'：'+btnTxt);
  await vp.click(`button.pickbtn[onclick*="'${ids[2]}'"]`);   // 再點一次取消
  await vp.waitForTimeout(200);
  if(await vp.evaluate(()=>document.querySelectorAll('button.pickbtn.on').length) !== 2)
    throw new Error('再點一次取消失敗');
  console.log('✅ 投票可複選、再點一次可取消（'+voterName+'，送出鍵顯示 '+expectCount+' 家）');

  // 魔法師要指定兩家才能送出
  const wizWho = Object.keys(myRole).find(k=>myRole[k]==='魔法師');
  if(wizWho){
    const wp = pages[wizWho];
    if(!await wp.evaluate(()=>!!document.querySelector('.wizbox'))) throw new Error('魔法師沒有看到交換區塊');
    await wp.click(`button.pickbtn[onclick*="'${ids[0]}'"]`);
    await wp.click(`.swapbtn[onclick*="'${ids[0]}'"]`);
    await wp.click('#btnBallot'); await wp.waitForTimeout(500);
    const t = await wp.textContent('#toast');
    if(!/兩家/.test(t)) throw new Error('魔法師只指定一家竟然送得出去');
    console.log('✅ 魔法師只指定一家會被擋下：', t.trim());
    await wp.click(`.swapbtn[onclick*="'${ids[1]}'"]`);
    // 盲選：畫面上不該出現任何票數
    if(await wp.evaluate(()=>/\d+\s*票/.test(document.querySelector('.wizbox').innerText)))
      throw new Error('魔法師指定當下看得到票數，不是盲選');
    console.log('✅ 魔法師指定當下看不到票數（盲選）');
  }

  // 依序送出：小明 → 小華 → 小美，觀察壞皇后下毒對象
  const order = ['小明','小華','小美'];
  const queenWho = Object.keys(myRole).find(k=>myRole[k]==='壞皇后');
  const foolWho  = Object.keys(myRole).find(k=>myRole[k]==='笨蛋');
  async function castVote(who, isLast){
    const pg = pages[who];
    if(who === foolWho){
      await pg.waitForSelector('#btnSpin',{timeout:8000});
      if(await pg.evaluate(()=>!!document.querySelector('button.pickbtn'))) throw new Error('笨蛋不該能自己選');
      await pg.click('#btnSpin');
      await pg.waitForTimeout(5300);
      console.log('✅ 笨蛋（'+who+'）只能轉盤，轉完自動送出');
    }else{
      if(!await pg.evaluate(()=>document.querySelectorAll('button.pickbtn.on').length))
        await pg.click(`button.pickbtn[onclick*="'${ids[0]}'"]`);
      await pg.click('#btnBallot');
      await pg.waitForTimeout(900);
      if(await pg.evaluate(()=>!!document.querySelector('#modal.on .poison'))){
        await pg.click('#modal .btn');
        console.log('✅ '+who+' 送出後被壞皇后毒啞（皇后是 '+queenWho+'）');
      }
    }
    if(!isLast) await pg.waitForSelector('.doneBox',{timeout:8000});
  }

  await castVote(order[0], false);
  await castVote(order[1], false);
  console.log('✅ 前兩人已送出');

  // 還沒全部投完之前，任何人都不該看到票數
  for(const [who,pg] of Object.entries(pages)){
    const peek = await pg.evaluate(()=>document.body.innerText.match(/\d+\s*票/));
    if(peek) throw new Error(who+' 在結算前就看得到票數：'+peek[0]);
  }
  console.log('✅ 結算前所有人都看不到票數');

  await castVote(order[2], true);
  console.log('✅ 三人都已送出投票');

  // 全部投完 → 自動結算
  await p1.waitForSelector('.board.reveal',{timeout:15000});
  await p2.waitForSelector('.board.reveal',{timeout:15000});
  const board = await p1.evaluate(()=>({
    rows:[...document.querySelectorAll('.board.reveal .row')].map(r=>
      r.querySelector('.medal').textContent+' '+r.querySelector('.info b').textContent+' — '+r.querySelector('.cnt').textContent.trim()),
    fx:[...document.querySelectorAll('.warnbox li')].map(x=>x.textContent),
    roles:[...document.querySelectorAll('.rolelist > *')].map(x=>x.innerText.replace(/\n/g,' '))
  }));
  console.log('✅ 全部投完自動結算，前三名：');
  board.rows.forEach(r=>console.log('     '+r));
  if(board.rows.some(r=>!/^[🥇🥈🥉]/u.test(r))) throw new Error('排行榜出現前三名以外的列');
  if(board.rows.length > 5) throw new Error('排行榜列數超過上限 5');
  console.log('   技能結算：'); board.fx.forEach(x=>console.log('     '+x));
  console.log('   角色揭曉：'+board.roles.join(' / '));
  if(board.roles.length !== 3) throw new Error('結算後應揭曉全部 3 人的角色');

  // 神秘店家：揭曉後公開真面目
  const unmask = await p1.evaluate(()=>{
    const box=document.querySelector('.unmaskbox');
    return box ? {text:box.innerText.replace(/\n+/g,' ｜ '),
                  real:box.querySelector('.real')?.textContent||''} : null;});
  if(!unmask) throw new Error('揭曉後沒有公開神秘店家');
  if(!unmask.real || unmask.real === aliases[0]) throw new Error('神秘店家沒有換成真實店名');
  console.log('✅ 神秘店家揭曉：'+unmask.text);
  const nowLeaked = await p2.evaluate(async()=>{
    const r = await fetch('/api/rooms/'+location.pathname.split('/').pop()).then(x=>x.json());
    return !!(r.mystery && r.mystery.revealed && r.mystery.entry);});
  if(!nowLeaked) throw new Error('揭曉後 API 沒有帶出真實店家');
  console.log('✅ 揭曉後 API 才帶出真實店家（投票期間先前已驗證為不帶）');

  // 想吃人數的標籤顏色分級
  const pills = await p1.evaluate(()=>[...new Set([...document.querySelectorAll('#results .pill')]
    .map(p=>p.className.replace('pill ','')).filter(c=>/^v/.test(c)))]);
  console.log('✅ 想吃人數標籤分級：', pills.join('、'));

  // 再玩一局：重抽角色
  await p1.click('#btnReopen');
  await p1.waitForSelector('#btnGen',{timeout:10000});
  await p1.click('#btnGen');
  await p1.waitForSelector('#modal.on .mrole',{timeout:12000});
  const role2 = await p1.textContent('#modal.on .mrole h3');
  console.log('✅「再玩一局」重抽角色：小明 ' + myRole['小明'] + ' → ' + role2);
  await p1.click('#modal .btn');
  await p1.waitForSelector('#modal.on .mmystery',{timeout:8000});
  const alias2 = await p1.textContent('#modal.on .mmystery h3');
  console.log('   神秘店家也重抽了：' + aliases[0] + ' → ' + alias2);
  await p1.click('#modal .btn');
  await p1.waitForFunction(()=>!document.getElementById('modal').classList.contains('on'));

  // ---- 單人類型的家數是看「類型數」不是「人數」 ----
  const solo = await p1.evaluate(()=>{
    const s=[...document.querySelectorAll('#results .sec')].find(x=>x.querySelector('h3').textContent.includes('各自'));
    if(!s) return null;
    const t={};
    [...s.querySelectorAll('.r')].forEach(r=>{
      const k=r.querySelector('.why').textContent.split('\u3000')[0].trim();
      t[k]=(t[k]||0)+1;
    });
    return { lead:s.querySelector('.lead').textContent.trim(), types:t };
  });
  if(solo){
    const counts = Object.values(solo.types);
    const kinds = counts.length;
    const per = counts[0];
    const same = counts.every(c=>c===per);
    console.log(`✅ 單人類型 ${kinds} 種，每種 ${per} 家（各類型一致：${same}）`);
    if(!same) throw new Error('同一輪裡各類型的家數不一致');
    if(kinds <= 3 && per !== 2) throw new Error('3 種以內應為每種 2 家');
    if(kinds >= 4 && per !== 1) throw new Error('4 種以上應為每種 1 家');
    const saysTwo = solo.lead.indexOf('兩家') >= 0;
    if(saysTwo !== (per === 2)) throw new Error('文案與實際家數不符：' + solo.lead);
    console.log('   文案與實際一致：', solo.lead);
  }

  // 換局之後，其他人的畫面也會重新跳出新的角色卡（不是沿用上一局的）
  await p3.waitForSelector('#modal.on .mrole',{timeout:12000});
  console.log('✅ 換局後其他人也重新收到角色卡：小美 '+myRole['小美']+' → '+
    await p3.textContent('#modal.on .mrole h3'));
  // 把三個人畫面上殘留的彈窗清乾淨（角色卡關掉會接著跳彩蛋，所以要用真的按鈕點、而且要點到不再跳為止）
  async function clearModals(pg){
    for(let k=0;k<12;k++){
      const open = await pg.evaluate(()=>document.getElementById('modal').classList.contains('on'));
      if(!open){
        await pg.waitForTimeout(1200);   // 等一次輪詢，確認不會又跳出來
        if(!await pg.evaluate(()=>document.getElementById('modal').classList.contains('on'))) return;
        continue;
      }
      const ghost = await pg.evaluate(()=>!!document.querySelector('#modal .btn.ghost'));
      await pg.click(ghost ? '#modal .btn.ghost' : '#modal .btn');
      await pg.waitForTimeout(400);
    }
    throw new Error('彈窗關不掉');
  }
  for(const pg of Object.values(pages)) await clearModals(pg);

  // ---- 改條件應清掉推薦 ----
  await p3.click('#btnEdit');
  await p3.click('#fDist button[data-v="10"]');
  await p3.click('#btnSubmit');
  await p3.waitForSelector('#meDone:not(.hide)');
  const cleared = await p3.evaluate(()=>document.getElementById('results').innerHTML.trim()==='');
  console.log('✅ 有人改條件 → 推薦與投票已重置：', cleared);
  await p1.waitForFunction(()=>document.getElementById('results').innerHTML.trim()==='',{timeout:12000});
  console.log('✅ 小明畫面也同步回到填寫階段');

  // ---- 重整後仍記得我是誰 ----
  await p2.reload();
  await p2.waitForSelector('#meDone:not(.hide)',{timeout:8000});
  const remembered = await p2.textContent('#meName');
  console.log('✅ 重新整理後仍記得身分：', remembered);

  // ---- 編輯飯局名稱與時間，其他人要同步看到 ----
  await p1.click('#btnEditRoom');
  await p1.fill('#eTitle','改期！週六午餐');
  await p1.fill('#eDate','2026-09-05');
  await p1.fill('#eTime','12:30');
  await p1.click('#btnSaveRoom');
  await p1.waitForFunction(()=>document.getElementById('rTitle').textContent==='改期！週六午餐',{timeout:8000});
  console.log('✅ 發起人改了飯局名稱與時間：', await p1.textContent('#rTitle'), '/', await p1.textContent('#rWhen'));
  await p2.waitForFunction(()=>document.getElementById('rTitle').textContent==='改期！週六午餐',{timeout:15000});
  console.log('✅ 小華的畫面也同步更新：', await p2.textContent('#rWhen'));

  // ---- 捷運站沒有下拉選單，改自填 + 可點建議 ----
  const noDatalist = await p2.evaluate(()=>!document.getElementById('stationList')
    && !document.getElementById('fStation').hasAttribute('list'));
  console.log('✅ 站名下拉選單已移除：', noDatalist);
  if(!noDatalist) throw new Error('datalist 還在');
  await p2.click('#btnEdit');
  await p2.fill('#fStation','忠孝');
  await p2.waitForSelector('#stationMsg button',{timeout:5000});
  const sugg = await p2.evaluate(()=>[...document.querySelectorAll('#stationMsg button')].map(b=>b.textContent));
  console.log('✅ 自填「忠孝」跳出可點建議：', sugg.join('、'));
  await p2.click('#stationMsg button');
  console.log('   點下去自動帶入：', await p2.inputValue('#fStation'));

  // ---- 依路線選擇仍可用 ----
  await p2.click('#btnLines');
  await p2.waitForSelector('#lineList button',{timeout:5000});
  await p2.click('#lineList button[data-line="BL"]');
  const stops = await p2.evaluate(()=>document.querySelectorAll('#stopList button').length);
  console.log('✅ 依路線選擇仍可用，板南線', stops, '站');

  // ---- 錯誤處理 ----
  await p2.evaluate(()=>{history.pushState({},'','/r/ZZZZZZ')});
  await p2.goto(`${BASE}/r/ZZZZZZ`);
  await p2.waitForSelector('#viewHome:not(.hide)',{timeout:8000});
  console.log('✅ 不存在的房號 → 退回首頁');

  // 截圖
  await p1.click('#btnGen');
  await p1.waitForSelector('#results .r',{timeout:15000});
  await p1.screenshot({path:'/home/claude/shot-room.png',fullPage:false});
  await p1.evaluate(()=>document.getElementById('results').scrollIntoView());
  await p1.waitForTimeout(400);
  await p1.screenshot({path:'/home/claude/shot-recs.png',fullPage:false});

  console.log('\n'+(errs.length?'❌ 前端錯誤:\n'+errs.join('\n'):'✅ 全程無 JS 錯誤'));
  await b.close();
})().catch(e=>{console.error('❌ 測試失敗:',e.message);process.exit(1)});
