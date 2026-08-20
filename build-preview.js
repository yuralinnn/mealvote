/**
 * 產生「預覽版」單一 HTML 檔。
 *
 * 把 data/mrt.js、data/restaurants.js、lib/recommend.js 這三個原本跑在 Node 的模組
 * 包進瀏覽器，再加上一個模擬後端，就能在沒有伺服器的環境（例如側邊預覽面板）
 * 完整看到畫面與推薦結果。
 *
 * 重點：演算法與資料都是直接引用專案裡的同一份檔案，不是另外抄一份，
 * 所以預覽看到的推薦結果，跟正式版跑出來的一模一樣。
 *
 * 用法：node build-preview.js  →  產生 preview.html
 */
const fs = require("fs");
const path = require("path");

function read(p){ return fs.readFileSync(path.join(__dirname, p), "utf8"); }

/** 把 CommonJS 模組轉成瀏覽器可用的 IIFE */
function toBrowserModule(src, exportsExpr){
  return src
    .replace(/^\s*const\s+.*=\s*require\([^)]*\);\s*$/gm, "")   // 拿掉 require
    .replace(/^\s*module\.exports\s*=[\s\S]*?;\s*$/m, "")        // 拿掉 module.exports
    + "\nreturn " + exportsExpr + ";";
}

const mrtSrc = toBrowserModule(read("data/mrt.js"),
  "{ LINES: LINES, ALL_STATIONS: ALL_STATIONS, STATIONS_BY_LINE: STATIONS_BY_LINE, ALIASES: ALIASES, normalizeStation: normalizeStation, distance: distance }");
const restSrc = toBrowserModule(read("data/restaurants.js"),
  "{ TYPES: TYPES, RESTAURANTS: RESTAURANTS }");
const recSrc = toBrowserModule(read("lib/recommend.js"),
  "{ recommend: recommend, evaluate: evaluate }");
const roleSrc = toBrowserModule(read("lib/roles.js"),
  "{ ROLES: ROLES, assignRoles: assignRoles, pickMystery: pickMystery, tally: tally }");

/* 有跑過 tools/import-osm.js 的話，把 OSM 資料一起打包進預覽版 */
let osmInject = "";
try{
  const osmPath = path.join(__dirname, "data", "osm-restaurants.json");
  if(fs.existsSync(osmPath)){
    const raw = fs.readFileSync(osmPath, "utf8");
    osmInject = "globalThis.__OSM_DATA__ = " + raw + ";\n";
    console.log("預覽版已包含 OSM 資料：" + JSON.parse(raw).count + " 筆");
  }else{
    console.log("找不到 data/osm-restaurants.json，預覽版只含精選清單（跑 node tools/import-osm.js 可補上）");
  }
}catch(e){ console.warn("讀取 OSM 資料失敗：" + e.message); }

const bundle = `
/* ===== 由 build-preview.js 自動產生，請勿手動修改 ===== */
${osmInject}
var MRT = (function(){
${mrtSrc}
})();
var DB = (function(){
${restSrc}
})();
var ENGINE = (function(){
  var mrt = MRT;
  var RESTAURANTS = DB.RESTAURANTS, TYPES = DB.TYPES;
${recSrc}
})();
var GAME = (function(){
${roleSrc}
})();

/* ===== 模擬後端：把伺服器的 API 行為搬到瀏覽器裡 ===== */
(function(){
  var room = null;
  var seq = 0;
  function uid(){ return "m" + (++seq); }

  function publicRoom(){
    var ballots = room.ballots || {};
    var out = {
      id: room.id, title: room.title, date: room.date, time: room.time,
      stage: room.stage, createdAt: room.createdAt, gameNonce: room.gameNonce || null,
      members: room.members.map(function(m){
        return { id:m.id, name:m.name, station:m.station, maxStations:m.maxStations,
                 types:m.types, submittedAt:m.submittedAt,
                 hasVoted: !!(ballots[m.id] && ballots[m.id].submittedAt) };
      }),
      result: room.result ? {
        consensus: room.result.consensus, byType: room.result.byType,
        warnings: room.result.warnings, noOverlap: room.result.noOverlap,
        perSoloType: room.result.perSoloType, soloTypeCount: room.result.soloTypeCount
      } : null,
      mystery: room.mystery ? { id:"mystery", alias:room.mystery.alias, tagline:room.mystery.tagline,
                                typeLabel:room.mystery.typeLabel, typeEmoji:room.mystery.typeEmoji,
                                revealed: room.stage === "revealed" || undefined,
                                entry: room.stage === "revealed" ? room.mystery.entry : undefined } : null,
      votedCount: Object.keys(ballots).filter(function(k){ return ballots[k].submittedAt; }).length,
      liveRatings: false
    };
    if(room.stage === "revealed") out.final = computeFinal();
    return JSON.parse(JSON.stringify(out));
  }

  function computeFinal(){
    var nameOf = function(mid){
      var m = room.members.find(function(x){ return x.id === mid; });
      return m ? m.name : "?";
    };
    var t = GAME.tally(room.ballots || {}, room.roles || {}, nameOf);
    var ranked = Object.keys(t.totals).filter(function(r){ return t.totals[r] > 0; })
      .map(function(r){ return { id:r, votes:t.totals[r], voters:t.voters[r] || [] }; })
      .sort(function(a,b){ return b.votes - a.votes; });
    var rank = 0, prev = null;
    ranked.forEach(function(x,i){ if(prev===null||x.votes!==prev){ rank=i+1; prev=x.votes; } x.rank=rank; });
    return {
      ranked: ranked, swap: t.swap, poisoned: t.poisonedIds.map(nameOf),
      roles: room.members.map(function(m){
        var r = GAME.ROLES[(room.roles||{})[m.id]] || GAME.ROLES.commoner;
        return { name:m.name, role:r.id, roleName:r.name, emoji:r.emoji,
                 poisoned: !!(room.ballots[m.id] && room.ballots[m.id].poisoned) };
      })
    };
  }

  function resetGame(){
    room.result = null; room.roles = {}; room.mystery = null;
    room.ballots = {}; room.pendingPoison = false; room.gameNonce = null; room.stage = "collecting";
  }
  function bySecret(sec){
    return room.members.find(function(m){ return m.secret === sec; }) || null;
  }
  function candidateIds(){
    if(!room.result) return [];
    return room.result.consensus.concat(room.result.byType).map(function(x){ return x.restaurant.id; });
  }
  function maybeReveal(){
    var done = room.members.every(function(m){ return room.ballots[m.id] && room.ballots[m.id].submittedAt; });
    if(done && room.members.length) room.stage = "revealed";
  }

  function readMember(b){
    var name = String(b.name || "").trim().slice(0, 12);
    if(!name) return { error: "請填暱稱" };
    var station = MRT.normalizeStation(b.station);
    if(!station) return { error: "認不出「" + (b.station || "") + "」這一站，請從清單挑一個" };
    var types = (b.types || []).filter(function(t){
      return DB.TYPES.some(function(x){ return x.id === t; });
    }).slice(0, 8);
    if(!types.length) return { error: "至少選一種想吃的" };
    return {
      name: name, station: station,
      maxStations: Math.min(40, Math.max(0, parseInt(b.maxStations, 10) || 5)),
      types: types
    };
  }

  function ensureRoom(){
    if(room) return;
    var d = new Date();
    room = {
      id: "DEMO01", title: "週五下班聚餐",
      date: d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"),
      time: "19:30", stage: "collecting", members: [], result: null,
      roles: {}, mystery: null, ballots: {}, pendingPoison: false,
      createdAt: Date.now()
    };
  }

  window.__MOCK_API__ = function(method, p, body){
    ensureRoom();
    return new Promise(function(resolve, reject){
      setTimeout(function(){
        try{ resolve(handle(method, p, body || {})); }
        catch(e){ reject(e); }
      }, 40);   // 給一點延遲，才看得出載入的感覺
    });
  };

  function handle(method, p, b){
    if(p === "/meta"){
      return { types: DB.TYPES, stations: MRT.ALL_STATIONS,
               lines: MRT.STATIONS_BY_LINE, restaurantCount: DB.RESTAURANTS.length, liveRatings: false };
    }
    if(method === "POST" && p === "/rooms"){
      room.title = String(b.title || "").trim().slice(0,40) || "下班吃什麼";
      room.date = b.date; room.time = b.time || "19:00";
      room.members = []; room.votes = {}; room.result = null; room.stage = "collecting";
      return publicRoom();
    }
    if(method === "GET" && /^\\/rooms\\/[^/?]+$/.test(p)) return publicRoom();

    // 修改飯局名稱與時間
    if(method === "PUT" && /^\\/rooms\\/[^/]+$/.test(p)){
      if(b.title !== undefined){
        var t = String(b.title).trim().slice(0, 40);
        if(!t) throw new Error("飯局名稱不能空白");
        room.title = t;
      }
      if(b.date !== undefined) room.date = b.date;
      if(b.time !== undefined) room.time = b.time;
      return publicRoom();
    }

    if(method === "POST" && /\\/members$/.test(p)){
      var parsed = readMember(b);
      if(parsed.error) throw new Error(parsed.error);
      parsed.id = uid(); parsed.secret = "s" + parsed.id + Math.floor(Math.random()*1e9);
      parsed.submittedAt = Date.now();
      room.members.push(parsed);
      resetGame();
      return { memberId: parsed.id, secret: parsed.secret, room: publicRoom() };
    }
    if(method === "PUT" && /\\/members\\//.test(p)){
      var mid = p.split("/members/")[1];
      var m = room.members.find(function(x){ return x.id === mid; });
      if(!m) throw new Error("找不到你的資料");
      var up = readMember(b);
      if(up.error) throw new Error(up.error);
      if(!m.secret) m.secret = "s" + m.id + Math.floor(Math.random()*1e9);
      Object.assign(m, up, { submittedAt: Date.now() });
      resetGame();
      return { memberId: m.id, secret: m.secret, room: publicRoom() };
    }
    if(method === "DELETE" && /\\/members\\//.test(p)){
      var did = p.split("/members/")[1];
      room.members = room.members.filter(function(x){ return x.id !== did; });
      resetGame();
      return publicRoom();
    }
    if(method === "POST" && /\\/generate$/.test(p)){
      if(!room.members.length) throw new Error("還沒有人填寫條件");
      room.result = ENGINE.recommend(room.members);
      room.ballots = {}; room.pendingPoison = false;
      room.roles = GAME.assignRoles(room.members.map(function(m){ return m.id; }));
      var used = room.result.consensus.concat(room.result.byType).map(function(x){ return x.restaurant.id; });
      room.mystery = GAME.pickMystery(room.result.spare || [], used);
      room.gameNonce = Math.random().toString(16).slice(2, 10);
      room.stage = "voting";
      return publicRoom();
    }
    if(method === "GET" && /\\/me$/.test(p.split("?")[0])){
      var sec = (p.split("secret=")[1] || "");
      var me = bySecret(decodeURIComponent(sec));
      if(!me) throw new Error("認不出你是誰，請重新填寫條件");
      var role = GAME.ROLES[(room.roles||{})[me.id]] || null;
      var bal = (room.ballots||{})[me.id] || null;
      return { memberId: me.id, name: me.name,
        role: role ? { id:role.id, name:role.name, emoji:role.emoji, power:role.power, detail:role.detail } : null,
        ballot: bal ? { picks:bal.picks||[], swap:bal.swap||null, poisoned:!!bal.poisoned,
                        submittedAt:bal.submittedAt||null, wheelPick:bal.wheelPick||null } : null };
    }
    if(method === "POST" && /\\/ballot$/.test(p)){
      if(room.stage !== "voting") throw new Error("現在不是投票階段");
      var mb = bySecret(b.secret);
      if(!mb) throw new Error("認不出你是誰");
      if(room.ballots[mb.id] && room.ballots[mb.id].submittedAt) throw new Error("你已經送出過了，投票不能反悔");
      var rid = (room.roles||{})[mb.id];
      if(rid === "fool") throw new Error("你是笨蛋，要用轉盤決定，不能自己選");
      var valid = candidateIds().concat(room.mystery ? ["mystery"] : []);
      var picks = (b.picks||[]).filter(function(x){ return valid.indexOf(x) >= 0; });
      if(!picks.length) throw new Error("至少要選一家");
      var swap = null;
      if(rid === "wizard"){
        var sw = b.swap;
        if(!Array.isArray(sw) || sw.length !== 2 || sw[0] === sw[1] ||
           valid.indexOf(sw[0]) < 0 || valid.indexOf(sw[1]) < 0)
          throw new Error("魔法師要指定兩家不同的餐廳來交換票數");
        swap = [sw[0], sw[1]];
      }
      var bal2 = { picks:picks, swap:swap, submittedAt:Date.now(), poisoned:false };
      if(room.pendingPoison && rid !== "queen"){ bal2.poisoned = true; room.pendingPoison = false; }
      if(rid === "queen") room.pendingPoison = true;
      room.ballots[mb.id] = bal2;
      maybeReveal();
      return { poisoned: bal2.poisoned, room: publicRoom() };
    }
    if(method === "POST" && /\\/spin$/.test(p)){
      if(room.stage !== "voting") throw new Error("現在不是投票階段");
      var mf = bySecret(b.secret);
      if(!mf) throw new Error("認不出你是誰");
      if((room.roles||{})[mf.id] !== "fool") throw new Error("只有笨蛋要轉轉盤");
      if(room.ballots[mf.id] && room.ballots[mf.id].submittedAt) throw new Error("你已經轉過了");
      var ids = candidateIds();
      if(!ids.length) throw new Error("沒有候選餐廳可以轉");
      var idx = Math.floor(Math.random() * ids.length);
      var bal3 = { picks:[ids[idx]], swap:null, wheelPick:ids[idx], submittedAt:Date.now(), poisoned:false };
      if(room.pendingPoison){ bal3.poisoned = true; room.pendingPoison = false; }
      room.ballots[mf.id] = bal3;
      maybeReveal();
      return { index:idx, total:ids.length, restaurantId:ids[idx], poisoned:bal3.poisoned, room:publicRoom() };
    }
    if(method === "POST" && /\\/reveal$/.test(p)){
      if(room.stage !== "voting") throw new Error("現在不能結算");
      if(!Object.keys(room.ballots||{}).length) throw new Error("還沒有人投票");
      room.stage = "revealed";
      return publicRoom();
    }
    if(method === "POST" && /\\/reopen$/.test(p)){
      resetGame();
      return publicRoom();
    }
    throw new Error("預覽版沒有實作這個 API：" + method + " " + p);
  }
})();
`;

/* ---------- 組出 preview.html ---------- */
let html = read("public/index.html");
const css = read("public/style.css");
const app = read("public/app.js");

const previewCss = `
/* 預覽版專用 */
.pvbar{position:sticky;top:0;z-index:50;background:#2a2724;color:#fff;padding:10px 14px;margin:0 -16px 14px;
  display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}
.pvbar b{background:#e2622f;padding:2px 8px;border-radius:6px;font-size:11.5px;letter-spacing:.5px}
.pvbar button{background:#443f39;color:#fff;border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:700}
.pvbar button:hover{background:#5a534b}
.pvbar span{color:#a9a199;font-size:12px}
.pvnote{background:#fff8ec;border:1px solid #f0dcb8;border-radius:11px;padding:11px 14px;
  font-size:12.5px;color:#7d5410;margin-bottom:14px;line-height:1.65}
`;

html = html
  .replace('<link rel="stylesheet" href="/style.css">', "<style>\n" + css + previewCss + "\n</style>")
  .replace('<script src="/app.js"></script>',
    "<script>\n" + bundle + "\n</script>\n<script>\n" + app + "\n</script>\n<script>\n" + previewInit() + "\n</script>")
  .replace("<title>朋友約飯神器</title>", "<title>朋友約飯神器（預覽版）</title>")
  .replace('<div class="wrap">', '<div class="wrap">\n' + bar());

function bar(){
  return `  <div class="pvbar">
    <b>預覽版</b>
    <button onclick="pvDemo()">載入 3 位示範成員</button>
    <button onclick="pvNew()">＋ 換一個人填</button>
    <button onclick="pvSwitch()">切換身分</button>
    <button onclick="pvReset()">全部重來</button>
    <span id="pvWho"></span>
  </div>`;
}

function previewInit(){
  return `
/* 預覽版的操作列。正式版沒有這一段。 */
var DEMO = [
  { name:"小明", station:"市政府", maxStations:6,  types:["japanese","bbq"] },
  { name:"小華", station:"公館",   maxStations:10, types:["hotpot","ramen"] },
  { name:"小美", station:"中山",   maxStations:4,  types:["korean","hotpot"] }
];

function pvNote(){
  var el = document.querySelector(".pvnote");
  if(el) return;
  var n = document.createElement("div");
  n.className = "pvnote";
  n.innerHTML = "這是<b>預覽版</b>：畫面、餐廳資料與推薦演算法都跟正式版完全相同，" +
    "但後端換成了瀏覽器內的模擬，所以「每個人在自己手機上填」「即時同步」看不出來，" +
    "重新整理也會清空。用上面的按鈕就能在同一個畫面加好幾個人、試投票。";
  var bar = document.querySelector(".pvbar");
  bar.parentNode.insertBefore(n, bar.nextSibling);
}

async function pvDemo(){
  for(var i = 0; i < DEMO.length; i++){
    var d = DEMO[i];
    await window.__MOCK_API__("POST", "/rooms/DEMO01/members", d);
  }
  await window.__preview.reload();
  var ms = await window.__MOCK_API__("GET", "/rooms/DEMO01");
  if(ms.members.length) window.__preview.setMember(ms.members[0].id);
  await pvWho();
}
function pvNew(){ window.__preview.newMember(); pvWho(); window.scrollTo({ top:0, behavior:"smooth" }); }
/* 表單送出後身分列也要跟著更新 */
document.addEventListener("click", function(e){
  if(e.target && e.target.id === "btnSubmit") setTimeout(pvWho, 400);
});
async function pvReset(){
  await window.__MOCK_API__("POST", "/rooms", { title:"週五下班聚餐", date:document.getElementById("hDate").value, time:"19:30" });
  window.__preview.newMember();
  await window.__preview.reload();
  await pvWho();
}
async function pvSwitch(){
  var r = await window.__MOCK_API__("GET", "/rooms/DEMO01");
  if(!r.members.length) return alert("還沒有人填寫");
  var names = r.members.map(function(m,i){ return (i+1) + ". " + m.name; }).join("\\n");
  var pick = prompt("要用誰的身分看畫面？輸入編號：\\n" + names + "\\n（0 = 都不是，當成新來的人）", "1");
  if(pick === null) return;
  var i = parseInt(pick, 10);
  if(i === 0) window.__preview.newMember();
  else if(r.members[i-1]) window.__preview.setMember(r.members[i-1].id);
  await pvWho();
}
async function pvWho(){
  var r = await window.__MOCK_API__("GET", "/rooms/DEMO01");
  var me = document.querySelector(".m.me b");
  document.getElementById("pvWho").textContent =
    "目前身分：" + (me ? me.textContent : "新來的人") + "　·　房內 " + r.members.length + " 人";
}

/* 直接進到房間，不用先經過首頁 */
setTimeout(async function(){
  pvNote();
  await window.__preview.open("DEMO01");
  document.getElementById("viewHome").classList.add("hide");
  pvWho();
}, 120);
`;
}

fs.writeFileSync(path.join(__dirname, "preview.html"), html, "utf8");
console.log("已產生 preview.html（" + Math.round(fs.statSync(path.join(__dirname,"preview.html")).size/1024) + " KB）");
