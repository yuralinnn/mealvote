/* 朋友約飯神器 — 前端 */
(function(){
"use strict";

var META = null;          // 類型與站名清單
var ROOM = null;          // 目前房間狀態
var MY_ID = null;         // 我在這個房間的成員 id（公開）
var MY_SECRET = null;     // 我的私鑰，查自己的角色與送出投票才需要
var MY_ROLE = null;       // 我抽到的角色（只有我看得到）
var MY_BALLOT = null;     // 我送出的票
var PICKS = [];           // 還沒送出前，我勾選的餐廳
var SWAP = [];            // 魔法師指定要交換的兩家
var SEEN_ROLE = false, SEEN_MYSTERY = false;
var GAME_NONCE = null;    // 目前這一局的識別碼，換局了就要重新跳角色卡與彩蛋
var MYSTERY_WINDOW = 10;  // 彩蛋只給 10 秒決定，時間到就關門
var MYSTERY_TIMER = null;
var POLL = null;
var EDITING = false;

var sel = { dist: 6, types: [] };

/* ---------- 小工具 ---------- */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function toast(msg){
  var t = $("toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(window.__tt);
  window.__tt = setTimeout(function(){ t.classList.remove("on"); }, 2200);
}
function showErr(msg){
  $("errBox").innerHTML = msg ? '<div class="err">' + esc(msg) + "</div>" : "";
  if(msg) window.scrollTo({ top: 0, behavior: "smooth" });
}

/* localStorage 可能被隱私模式擋掉，失敗就退回記憶體 */
var memStore = {};
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return memStore[k] || null; } }
function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){ memStore[k] = v; } }

async function api(method, path, body){
  // 預覽版沒有伺服器，改由瀏覽器內的模擬後端回應（正式版不會進到這一行）
  if(window.__MOCK_API__) return window.__MOCK_API__(method, path, body);
  var res = await fetch("/api" + path, {
    method: method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  var json = await res.json().catch(function(){ return {}; });
  if(!res.ok) throw new Error(json.error || ("伺服器錯誤 " + res.status));
  return json;
}

function roomIdFromUrl(){
  var m = location.pathname.match(/^\/r\/([A-Z0-9]{4,8})/i);
  return m ? m[1].toUpperCase() : null;
}

/* ---------- 啟動 ---------- */
async function boot(){
  try{
    META = await api("GET", "/meta");
  }catch(e){
    showErr("載不到基本資料，請重新整理頁面");
    return;
  }

  $("statR").textContent = META.restaurantCount;
  $("statS").textContent = META.stations.length;
  $("fTypes").innerHTML = META.types.map(function(t){
    return '<button type="button" class="opt" data-t="' + t.id + '">' + t.emoji + " " + esc(t.label) + "</button>";
  }).join("");

  var d = new Date();
  $("hDate").value = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");

  bindHome();
  bindForm();

  var rid = roomIdFromUrl();
  if(rid) await openRoom(rid);
}

/* ---------- 首頁 ---------- */
function bindHome(){
  $("btnCreate").onclick = async function(){
    var btn = this;
    btn.disabled = true;
    try{
      var room = await api("POST", "/rooms", {
        title: $("hTitle").value, date: $("hDate").value, time: $("hTime").value
      });
      history.pushState({}, "", "/r/" + room.id);
      await openRoom(room.id);
    }catch(e){ toast(e.message); }
    btn.disabled = false;
  };
  $("btnJoin").onclick = function(){
    var code = ($("hJoin").value || "").trim().toUpperCase();
    if(code.length < 4) return toast("房號長度不對");
    history.pushState({}, "", "/r/" + code);
    openRoom(code);
  };
  $("hJoin").addEventListener("keydown", function(e){ if(e.key === "Enter") $("btnJoin").click(); });
}

/* ---------- 表單 ---------- */
function bindForm(){
  $("fTypes").addEventListener("click", function(e){
    var b = e.target.closest(".opt"); if(!b) return;
    var t = b.dataset.t, i = sel.types.indexOf(t);
    if(i >= 0) sel.types.splice(i, 1);
    else{
      if(sel.types.length >= 8) return toast("最多選 8 種");
      sel.types.push(t);
    }
    b.classList.toggle("on");
  });

  function seg(id, key, after){
    $(id).addEventListener("click", function(e){
      var b = e.target.closest("button"); if(!b) return;
      this.querySelectorAll("button").forEach(function(x){ x.classList.remove("on"); });
      b.classList.add("on");
      sel[key] = parseInt(b.dataset.v, 10);
      if(after) after();
    });
  }
  seg("fDist", "dist");

  /* 沒有下拉選單了，所以打到一半要給得出可以直接點的建議 */
  $("fStation").addEventListener("input", function(){
    var v = this.value.trim();
    var box = $("stationMsg");
    if(!v){ box.className = ""; box.innerHTML = ""; return; }

    if(META.stations.indexOf(v) >= 0){
      box.className = "stationOK"; box.textContent = "✓ " + v + "站";
      return;
    }
    var near = META.stations.filter(function(s){ return s.indexOf(v) >= 0; }).slice(0, 6);
    if(near.length){
      box.className = "suggest";
      box.innerHTML = "<span>你是不是要找：</span>" + near.map(function(s){
        return '<button type="button" data-stop="' + esc(s) + '">' + esc(s) + "</button>";
      }).join("");
    }else{
      box.className = "stationBad";
      box.textContent = "找不到這一站，按下面「依路線選擇」挑一個";
    }
  });

  $("stationMsg").addEventListener("click", function(e){
    var b = e.target.closest("button[data-stop]"); if(!b) return;
    $("fStation").value = b.dataset.stop;
    $("fStation").dispatchEvent(new Event("input"));
  });

  /* 依路線選站：datalist 只適合已經知道站名的人，
     不熟的人需要看到「這條線上有哪些站、順序長怎樣」 */
  var pickerOpen = false, pickedLine = null;
  $("btnLines").onclick = function(){
    pickerOpen = !pickerOpen;
    $("linePicker").classList.toggle("hide", !pickerOpen);
    this.textContent = pickerOpen ? "🚇 收起路線" : "🚇 依路線選擇";
    if(pickerOpen && !$("lineList").innerHTML) renderLines();
  };

  function renderLines(){
    $("lineList").innerHTML = META.lines.map(function(l){
      return '<button type="button" data-line="' + l.id + '" style="color:' + l.color + '">' +
        '<span class="dot" style="background:' + l.color + '"></span>' +
        esc(l.name) + '</button>';
    }).join("");
  }

  $("lineList").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    pickedLine = b.dataset.line;
    this.querySelectorAll("button").forEach(function(x){ x.classList.remove("on"); });
    b.classList.add("on");
    var line = META.lines.find(function(l){ return l.id === pickedLine; });
    $("stopList").innerHTML = '<div class="seq">' + esc(line.name) + '　' +
      esc(line.stations[0]) + " → " + esc(line.stations[line.stations.length - 1]) + "</div>" +
      line.stations.map(function(st){
        return '<button type="button" data-stop="' + esc(st) + '">' + esc(st) + "</button>";
      }).join("");
  });

  $("stopList").addEventListener("click", function(e){
    var b = e.target.closest("button[data-stop]"); if(!b) return;
    $("fStation").value = b.dataset.stop;
    $("fStation").dispatchEvent(new Event("input"));
    pickerOpen = false;
    $("linePicker").classList.add("hide");
    $("btnLines").textContent = "🚇 依路線選擇";
  });

  $("btnSubmit").onclick = submitMe;
  $("btnEdit").onclick = function(){ EDITING = true; render(); };
  $("btnGen").onclick = generate;

  $("btnCopy").onclick = function(){
    var url = location.origin + "/r/" + ROOM.id;
    var txt = "【" + ROOM.title + "】" + ROOM.date + " " + ROOM.time + "\n填一下你的條件：" + url;
    navigator.clipboard.writeText(txt).then(
      function(){ toast("邀請訊息已複製，貼到群組就行"); },
      function(){ toast("複製失敗，請手動複製網址列"); }
    );
  };
  /* 飯局名稱與時間可以事後改 —— 時間常常會喬 */
  $("btnEditRoom").onclick = function(){
    $("roomView").classList.add("hide");
    $("roomEdit").classList.remove("hide");
    $("eTitle").value = ROOM.title;
    $("eDate").value = ROOM.date;
    $("eTime").value = ROOM.time;
    $("eTitle").focus();
  };
  $("btnCancelRoom").onclick = function(){
    $("roomEdit").classList.add("hide");
    $("roomView").classList.remove("hide");
  };
  $("btnSaveRoom").onclick = async function(){
    this.disabled = true;
    try{
      ROOM = await api("PUT", "/rooms/" + ROOM.id, {
        title: $("eTitle").value, date: $("eDate").value, time: $("eTime").value
      });
      $("roomEdit").classList.add("hide");
      $("roomView").classList.remove("hide");
      render();
      toast("已更新，其他人的畫面也會跟著變");
    }catch(e){ toast(e.message); }
    this.disabled = false;
  };

  $("btnHome").onclick = function(){
    history.pushState({}, "", "/");
    clearInterval(POLL); POLL = null;
    $("viewRoom").classList.add("hide");
    $("viewHome").classList.remove("hide");
  };

  window.addEventListener("popstate", function(){
    var rid = roomIdFromUrl();
    if(rid) openRoom(rid);
    else $("btnHome").click();
  });
}

async function submitMe(){
  showErr("");
  var payload = {
    name: $("fName").value,
    station: $("fStation").value,
    maxStations: sel.dist,
    types: sel.types
  };
  if(!payload.name.trim()) return showErr("請填暱稱");
  if(!payload.station.trim()) return showErr("請選擇你所在的捷運站");
  if(!payload.types.length) return showErr("至少選一種今天想吃的");

  var btn = $("btnSubmit");
  btn.disabled = true;
  try{
    var out = MY_ID
      ? await api("PUT", "/rooms/" + ROOM.id + "/members/" + MY_ID, payload)
      : await api("POST", "/rooms/" + ROOM.id + "/members", payload);
    MY_ID = out.memberId;
    MY_SECRET = out.secret || MY_SECRET;
    if(window.__MOCK_API__){                    // 預覽版才需要：記住每個人的 secret 好切換身分
      window.__secrets = window.__secrets || {};
      window.__secrets[MY_ID] = MY_SECRET;
    }
    lsSet("mealvote:" + ROOM.id, MY_ID);
    lsSet("mealvote:s:" + ROOM.id, MY_SECRET);
    ROOM = out.room;
    EDITING = false;
    render();
    toast("已送出，等其他人填完就可以產生推薦");
  }catch(e){ showErr(e.message); }
  btn.disabled = false;
}

async function generate(){
  var btn = $("btnGen");
  btn.disabled = true; btn.textContent = "配對中…";
  try{
    ROOM = await api("POST", "/rooms/" + ROOM.id + "/generate");
    await loadMe();          // 角色是這一刻才發的，要重新拿
    render();
    setTimeout(function(){
      var el = $("results");
      if(el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }catch(e){ showErr(e.message); }
  btn.disabled = false; btn.textContent = "產生餐廳推薦";
}

/* ---------- 角色與投票 ---------- */

/** 拿自己的角色與投票狀態。角色是私密的，只有帶著 secret 才查得到。 */
async function loadMe(){
  MY_ROLE = null; MY_BALLOT = null;
  if(!MY_SECRET || !ROOM || ROOM.stage === "collecting") return;
  try{
    const me = await api("GET", "/rooms/" + ROOM.id + "/me?secret=" + encodeURIComponent(MY_SECRET));
    MY_ROLE = me.role;
    MY_BALLOT = me.ballot;
    if(MY_BALLOT && MY_BALLOT.picks && MY_BALLOT.picks.length) PICKS = MY_BALLOT.picks.slice();
    if(MY_BALLOT && MY_BALLOT.swap) SWAP = MY_BALLOT.swap.slice();
    // 重整頁面之後，把「當時押了彩蛋」這件事撿回來（10 秒不會因為重整而重來一次）
    if(!(MY_BALLOT && MY_BALLOT.submittedAt) && mysteryChoice() === "bet" && PICKS.indexOf("mystery") < 0){
      PICKS.push("mystery");
    }
  }catch(e){ /* 沒填過條件的人查不到，正常 */ }
}

function togglePick(rid){
  if(MY_BALLOT && MY_BALLOT.submittedAt) return;
  const i = PICKS.indexOf(rid);
  if(i >= 0) PICKS.splice(i, 1); else PICKS.push(rid);
  render();
}

function toggleSwap(rid){
  if(MY_BALLOT && MY_BALLOT.submittedAt) return;
  const i = SWAP.indexOf(rid);
  if(i >= 0) SWAP.splice(i, 1);
  else{
    if(SWAP.length >= 2) SWAP.shift();
    SWAP.push(rid);
  }
  render();
}

async function submitBallot(){
  if(!PICKS.length) return toast("至少要選一家");
  if(MY_ROLE && MY_ROLE.id === "wizard" && SWAP.length !== 2){
    return toast("魔法師還要指定兩家來交換票數");
  }
  const btn = $("btnBallot");
  if(btn) btn.disabled = true;
  try{
    const out = await api("POST", "/rooms/" + ROOM.id + "/ballot", {
      secret: MY_SECRET, picks: PICKS, swap: SWAP.length === 2 ? SWAP : undefined
    });
    ROOM = out.room;
    await loadMe();
    render();
    if(out.poisoned) showModal(poisonedModal());
    else toast("已送出，結果等大家投完才會揭曉");
  }catch(e){ toast(e.message); }
  if(btn) btn.disabled = false;
}

/** 笨蛋的轉盤：結果由伺服器決定，前端只負責把指針轉到那一格 */
async function spinWheel(){
  const btn = $("btnSpin");
  if(btn) btn.disabled = true;
  try{
    const out = await api("POST", "/rooms/" + ROOM.id + "/spin", { secret: MY_SECRET });
    const seg = 360 / out.total;
    // 多轉五圈再停在目標格的正中間，看起來才像真的在轉
    const target = 360 * 5 + (360 - (out.index * seg + seg / 2));
    const wheel = $("wheel");
    if(wheel){
      wheel.style.transition = "transform 4.2s cubic-bezier(.17,.67,.16,1)";
      wheel.style.transform = "rotate(" + target + "deg)";
    }
    setTimeout(async function(){
      ROOM = out.room;
      await loadMe();
      render();
      if(out.poisoned) showModal(poisonedModal());
    }, 4500);
  }catch(e){ toast(e.message); if(btn) btn.disabled = false; }
}

async function revealNow(){
  if(!confirm("還有人沒投票，確定要直接結算嗎？沒投的人就不算了。")) return;
  try{
    ROOM = await api("POST", "/rooms/" + ROOM.id + "/reveal");
    await loadMe();
    render();
  }catch(e){ toast(e.message); }
}

/** 再玩一局：清掉票、重抽角色、重抽彩蛋，條件保留 */
async function reopenGame(){
  if(!confirm("再玩一局？票數會歸零，角色與神秘店家都會重抽。大家填的條件會留著。")) return;
  try{
    ROOM = await api("POST", "/rooms/" + ROOM.id + "/reopen");
    SEEN_ROLE = false; SEEN_MYSTERY = false;
    PICKS = []; SWAP = []; MY_BALLOT = null; MY_ROLE = null;
    await loadMe();
    render();
    toast("角色重抽了，按「產生餐廳推薦」開始新的一局");
  }catch(e){ toast(e.message); }
}

/* ---------- 彈窗 ---------- */
function showModal(html){
  var el = $("modal");
  el.innerHTML = '<div class="mbox">' + html + "</div>";
  el.classList.add("on");
}
function closeModal(){ $("modal").classList.remove("on"); }
window.__closeModal = closeModal;

function roleModal(r){
  return '<div class="mrole">' +
    '<div class="mtag">你抽到的角色（只有你看得到）</div>' +
    '<div class="memoji">' + r.emoji + "</div>" +
    "<h3>" + esc(r.name) + "</h3>" +
    '<p class="mpower">' + esc(r.power) + "</p>" +
    '<p class="mdetail">' + esc(r.detail) + "</p>" +
    '<button class="btn" onclick="__closeRole()">知道了</button></div>';
}
/** 關掉角色卡之後，接著把彩蛋跳出來（不用等下一次輪詢） */
function closeRoleModal(){
  closeModal();
  if(ROOM && ROOM.stage === "voting" && ROOM.mystery && !SEEN_MYSTERY){
    SEEN_MYSTERY = true;
    setTimeout(function(){ showMysteryModal(ROOM.mystery); }, 180);
  }
}
window.__closeRole = closeRoleModal;
/* ---------- 彩蛋的 10 秒視窗 ---------- */

/** 這一場、這個人對彩蛋做過的決定。存起來是為了重整頁面不能重來一次。 */
function mysteryKey(){
  // 帶上這一局的 nonce：再玩一局時彩蛋會重抽，上一局的決定不能沿用
  return "mv.myst." + (ROOM ? ROOM.id : "?") + "." + (ROOM && ROOM.gameNonce || "-") + "." + (MY_ID || "?");
}
function mysteryChoice(){ return lsGet(mysteryKey()); }          // "bet" | "missed" | null
function setMysteryChoice(v){ lsSet(mysteryKey(), v); }

function mysteryModal(m){
  const decidable = !(MY_BALLOT && MY_BALLOT.submittedAt) && !(MY_ROLE && MY_ROLE.id === "fool");
  return '<div class="mmystery">' +
    '<div class="mtag">今日主廚隱藏推薦</div>' +
    '<div class="memoji">🕵️</div>' +
    "<h3>" + esc(m.alias) + "</h3>" +
    '<p class="mtagline">「' + esc(m.tagline) + '」</p>' +
    '<p class="mdetail">不會告訴你是哪一家。' +
      (m.typeLabel ? "只透露類型是「" + esc(m.typeLabel) + "」，" : "") +
      "而且大家都到得了。結算之後才會公開是哪一家。</p>" +
    (decidable
      ? '<div class="mycd"><span class="num" id="myCd">' + MYSTERY_WINDOW + "</span> 秒內決定" +
          '<div class="mybar"><i id="myBar" style="width:100%"></i></div>' +
          '<p class="mynote">時間到就關門了，之後不能再投給它。</p></div>' +
        '<div class="myacts">' +
          '<button class="btn" onclick="__mysteryBet()">🎲 賭一把，投給它</button>' +
          '<button class="btn ghost" onclick="__mysteryPass()">算了，不冒險</button>' +
        "</div>"
      : '<p class="mynote">' +
          (MY_ROLE && MY_ROLE.id === "fool"
            ? "你是笨蛋，投給誰由轉盤決定，這一間也在轉盤之外。"
            : "你已經送出投票了，這一間只能看看。") +
        "</p><button class=\"btn\" onclick=\"__closeModal()\">知道了</button>") +
  "</div>";
}

/** 跳出彩蛋並開始倒數。時間到自動關門，之後那張卡片就不能投了。 */
function showMysteryModal(m){
  showModal(mysteryModal(m));
  stopMysteryTimer();
  if(!$("myCd")) return;                       // 沒有決定權的人不倒數

  var left = MYSTERY_WINDOW;
  MYSTERY_TIMER = setInterval(function(){
    left--;
    var n = $("myCd"), bar = $("myBar");
    if(!n){ stopMysteryTimer(); return; }      // 彈窗被別的東西蓋掉了
    n.textContent = Math.max(0, left);
    if(bar) bar.style.width = Math.max(0, left / MYSTERY_WINDOW * 100) + "%";
    if(left <= 0){
      stopMysteryTimer();
      setMysteryChoice("missed");
      closeModal();
      render();
      toast("10 秒到了，神秘店家關門了");
    }
  }, 1000);
}
function stopMysteryTimer(){
  if(MYSTERY_TIMER){ clearInterval(MYSTERY_TIMER); MYSTERY_TIMER = null; }
}

function mysteryBet(){
  stopMysteryTimer();
  setMysteryChoice("bet");
  if(PICKS.indexOf("mystery") < 0) PICKS.push("mystery");
  closeModal();
  render();
  toast("押上去了。別忘了最後還要按送出投票");
}
function mysteryPass(){
  stopMysteryTimer();
  setMysteryChoice("missed");
  const i = PICKS.indexOf("mystery");
  if(i >= 0) PICKS.splice(i, 1);
  closeModal();
  render();
}
window.__mysteryBet = mysteryBet;
window.__mysteryPass = mysteryPass;
function poisonedModal(){
  const wiz = MY_ROLE && MY_ROLE.id === "wizard";
  return '<div class="mrole poison">' +
    '<div class="memoji">🍎</div><h3>你被壞皇后毒啞了</h3>' +
    '<p class="mpower">你剛剛送出的票整張作廢，這一輪不算數。</p>' +
    '<p class="mdetail">壞皇后會毒掉「緊接在她之後送出投票」的人。你只是運氣不好，剛好排在她後面。' +
      (wiz ? "不過你指定的那兩家還是會交換 —— 毒的是嘴巴，不是魔法。" : "") + "</p>" +
    '<button class="btn" onclick="__closeModal()">' + (wiz ? "哼，還好" : "可惡") + "</button></div>";
}

/* ---------- 房間 ---------- */
async function openRoom(id){
  try{
    ROOM = await api("GET", "/rooms/" + id);
  }catch(e){
    $("viewHome").classList.remove("hide");
    toast(e.message);
    history.replaceState({}, "", "/");
    return;
  }

  MY_ID = lsGet("mealvote:" + ROOM.id);
  MY_SECRET = lsGet("mealvote:s:" + ROOM.id);
  if(MY_ID && !ROOM.members.some(function(m){ return m.id === MY_ID; })){ MY_ID = null; MY_SECRET = null; }
  await loadMe();

  $("viewHome").classList.add("hide");
  $("viewRoom").classList.remove("hide");
  render();

  clearInterval(POLL);
  POLL = setInterval(async function(){
    if(document.hidden) return;
    try{
      var fresh = await api("GET", "/rooms/" + ROOM.id);
      // 自己正在打字時不要被輪詢蓋掉畫面
      var editingRoom = !$("roomEdit").classList.contains("hide");
      if(JSON.stringify(fresh) !== JSON.stringify(ROOM) && !EDITING && !editingRoom){
        var stageChanged = fresh.stage !== ROOM.stage;
        ROOM = fresh;
        // 別人按下產生推薦時，我的角色是那一刻才發的，要去拿回來
        if(stageChanged || (!MY_ROLE && fresh.stage !== "collecting")) await loadMe();
        render();
      }
    }catch(e){ /* 網路瞬斷就跳過這一輪 */ }
  }, 3500);
}

/* ---------- 畫面 ---------- */
function render(){
  // 換了一局（有人改條件、或按了「再玩一局」）→ 角色卡與彩蛋要重新跳一次
  if(ROOM.gameNonce !== GAME_NONCE){
    GAME_NONCE = ROOM.gameNonce;
    SEEN_ROLE = false; SEEN_MYSTERY = false;
    stopMysteryTimer();
    if(!(MY_BALLOT && MY_BALLOT.submittedAt)){ PICKS = []; SWAP = []; }
  }

  $("rTitle").textContent = ROOM.title;
  var wd = ["日","一","二","三","四","五","六"][new Date(ROOM.date + "T00:00:00").getDay()];
  $("rWhen").textContent = ROOM.date + "（" + wd + "）" + ROOM.time;
  $("rCode").textContent = ROOM.id;

  var me = ROOM.members.find(function(m){ return m.id === MY_ID; });

  /* 我的條件 */
  if(me && !EDITING){
    $("meForm").classList.add("hide");
    $("meDone").classList.remove("hide");
    $("meTitle").textContent = "你的條件";
    $("meSub").textContent = "改了之後推薦會重新計算";
    $("meAv").textContent = me.name.slice(0, 1);
    $("meName").textContent = me.name;
    $("meDetail").textContent = me.station + "站 · " + distLabel(me.maxStations) +
      " · " + me.types.map(typeLabel).join("、");
  }else{
    $("meForm").classList.remove("hide");
    $("meDone").classList.add("hide");
    $("meTitle").textContent = me ? "修改你的條件" : "填寫你的條件";
    $("meSub").textContent = me ? "改完記得送出" : "三個問題，20 秒填完";
    if(me && EDITING) fillForm(me);
  }

  /* 成員列表 */
  $("mCount").textContent = ROOM.members.length ? "（" + ROOM.members.length + " 人）" : "";
  $("mList").innerHTML = ROOM.members.length
    ? ROOM.members.map(function(m){
        return '<div class="m' + (m.id === MY_ID ? " me" : "") + '">' +
          '<div class="av">' + esc(m.name.slice(0,1)) + "</div>" +
          '<div class="info"><b>' + esc(m.name) + "</b>" +
          '<div class="d">' + esc(m.station) + "站 · " + distLabel(m.maxStations) +
          " · " + m.types.map(typeLabel).join("、") + "</div></div>" +
          (m.id === MY_ID ? '<span class="tag">你</span>' : "") + "</div>";
      }).join("")
    : '<div class="blank"><div class="big">👀</div><p>還沒有人填，把連結丟到群組吧</p></div>';

  $("btnGen").disabled = ROOM.members.length === 0;
  $("btnGen").textContent = ROOM.stage === "collecting"
    ? "產生餐廳推薦" + (ROOM.members.length ? "（" + ROOM.members.length + " 人）" : "")
    : "重新產生推薦";

  renderResults();
}

function fillForm(m){
  $("fName").value = m.name;
  $("fStation").value = m.station;
  sel.dist = m.maxStations; sel.types = m.types.slice();

  $("fDist").querySelectorAll("button").forEach(function(b){
    b.classList.toggle("on", parseInt(b.dataset.v,10) === m.maxStations);
  });
  if(!$("fDist").querySelector(".on")) $("fDist").lastElementChild.classList.add("on");

  $("fTypes").querySelectorAll(".opt").forEach(function(b){
    b.classList.toggle("on", m.types.indexOf(b.dataset.t) >= 0);
  });
}

function clearForm(){
  $("fName").value = ""; $("fStation").value = ""; $("stationMsg").innerHTML = "";
  sel = { dist: 6, types: [] };
  $("fDist").querySelectorAll("button").forEach(function(b){ b.classList.toggle("on", b.dataset.v === "6"); });
  $("fTypes").querySelectorAll(".opt").forEach(function(b){ b.classList.remove("on"); });
}

function typeLabel(id){
  var t = META.types.find(function(x){ return x.id === id; });
  return t ? t.label.split("・")[0] : id;
}
function distLabel(n){ return n >= 40 ? "距離不限" : n + " 站內"; }

/* 步行時間：用不動產業界慣用的每分鐘 80 公尺換算，不足一分鐘也算一分鐘 */
function walkMins(metres){ return Math.max(1, Math.ceil(metres / 80)); }

/* ---------- 推薦結果 ---------- */
function renderResults(){
  const box = $("results");
  if(ROOM.stage === "collecting" || !ROOM.result){ box.innerHTML = ""; return; }
  box.innerHTML = (ROOM.stage === "revealed") ? revealedHtml() : votingHtml();

  // 進到投票階段時，角色卡與彩蛋各跳一次
  if(ROOM.stage === "voting"){
    if(MY_ROLE && !SEEN_ROLE){ SEEN_ROLE = true; showModal(roleModal(MY_ROLE)); return; }
    if(ROOM.mystery && !SEEN_MYSTERY && SEEN_ROLE){ SEEN_MYSTERY = true; showMysteryModal(ROOM.mystery); }
  }
}

/** 這一輪所有可以投的選項（推薦候選 + 彩蛋） */
function allOptions(){
  const res = ROOM.result;
  const list = (res.consensus || []).concat(res.byType || []);
  if(ROOM.mystery){
    if(ROOM.mystery.revealed && ROOM.mystery.entry){
      // 揭曉之後換成真面目：拿真實店家的完整資料，但 id 仍保持 "mystery"，
      // 不然對不上大家投的那一票。
      const e = ROOM.mystery.entry;
      list.push(Object.assign({}, e, {
        bucket: "mystery",
        restaurant: Object.assign({}, e.restaurant, {
          id: "mystery", mystery: true, wasAlias: ROOM.mystery.alias, tagline: ROOM.mystery.tagline
        })
      }));
    }else{
      list.push({
        bucket: "mystery", typeLabel: ROOM.mystery.typeLabel, typeEmoji: ROOM.mystery.typeEmoji,
        voters: [], ev: null,
        restaurant: { id: "mystery", name: ROOM.mystery.alias, note: ROOM.mystery.tagline,
                      station: null, price: null, mystery: true }
      });
    }
  }
  return list;
}

/* ---------- 投票中 ---------- */
function votingHtml(){
  const n = ROOM.members.length;
  const res = ROOM.result;
  const locked = !!(MY_BALLOT && MY_BALLOT.submittedAt);
  const isFool = MY_ROLE && MY_ROLE.id === "fool";
  const isWizard = MY_ROLE && MY_ROLE.id === "wizard";
  let html = "";

  /* 進度條 */
  html += '<div class="board"><div class="board-h">投票進行中' +
    "<span>" + ROOM.votedCount + " / " + n + " 人已送出</span></div>" +
    '<div class="waiting">' + ROOM.members.map(function(m){
      return '<span class="' + (m.hasVoted ? "done" : "") + '">' +
        (m.hasVoted ? "✓ " : "⏳ ") + esc(m.name) + "</span>";
    }).join("") + "</div>" +
    '<p class="hidden-note">🔒 結果會等大家都投完才揭曉，投票期間看不到任何票數。</p>' +
    (MY_ID && ROOM.votedCount > 0 && ROOM.votedCount < n
      ? '<button class="clearv" onclick="__reveal()">不等了，直接結算</button>' : "") +
    "</div>";

  /* 我的角色小卡 */
  if(MY_ROLE){
    html += '<div class="myrole" onclick="__showRole()">' +
      '<span class="e">' + MY_ROLE.emoji + "</span>" +
      "<div><b>你是「" + esc(MY_ROLE.name) + "」</b><span>" + esc(MY_ROLE.power) + "</span></div>" +
      '<span class="q">?</span></div>';
  }

  if(locked){
    html += '<div class="doneBox">' +
      (MY_BALLOT.poisoned
        ? "<b>🍎 你被壞皇后毒啞了</b><p>這一輪你的票不算數，等大家投完看結果吧。" +
          (isWizard ? "不過你指定的交換照樣會生效 —— 毒的是嘴巴，不是魔法。" : "") + "</p>"
        : "<b>✅ 你已經送出投票</b><p>投票不能反悔。等其他人投完就會自動揭曉。</p>") +
      "</div>";
  }

  /* 笨蛋的轉盤 */
  if(isFool && !locked){
    const ids = (res.consensus || []).concat(res.byType || []);
    const seg = 360 / ids.length;
    const colors = ["#e2622f","#2f9169","#c8891c","#5b8fc9","#a05fb4","#c4483a","#3fa39b","#8a8f3a"];
    const stops = ids.map(function(x, i){
      return colors[i % colors.length] + " " + (i * seg) + "deg " + ((i + 1) * seg) + "deg";
    }).join(",");
    html += '<div class="wheelbox"><h3>🤡 你是笨蛋，不能自己選</h3>' +
      "<p>按下去讓轉盤決定你投給誰。轉到哪家就是哪家，不能重來。</p>" +
      '<div class="wheelwrap"><div class="pointer">▼</div>' +
      '<div class="wheel" id="wheel" style="background:conic-gradient(' + stops + ')">' +
      ids.map(function(x, i){
        const a = i * seg + seg / 2;
        return '<span class="wl" style="transform:rotate(' + a + 'deg) translateY(-38%)">' +
          esc(x.restaurant.name.slice(0, 6)) + "</span>";
      }).join("") + "</div></div>" +
      '<button class="btn" id="btnSpin" onclick="__spin()">轉！</button></div>';
  }

  /* 魔法師的交換指定 */
  if(isWizard && !locked){
    html += '<div class="wizbox"><h3>🧙 指定兩家交換票數</h3>' +
      "<p>交換會在所有人投完之後才發生，所以你現在不知道那兩家各有幾票。閉著眼睛選吧。</p>" +
      '<div class="swaptags">' + (SWAP.length
        ? SWAP.map(function(rid){
            const o = allOptions().find(function(x){ return x.restaurant.id === rid; });
            return "<span>" + esc(o ? o.restaurant.name : rid) + "</span>";
          }).join('<em>↔</em>')
        : '<span class="ph">還沒指定，點下面卡片的「選來交換」</span>') + "</div></div>";
  }

  /* 候選卡片：維持「最多人想吃」與「每個人各自想吃的」兩區，投的是同一張票 */
  const opts = allOptions();
  const hint = isFool ? "笨蛋不能自己選，看轉盤決定。" : "可以複選，喜歡的都按下去，最後記得送出。";
  const card = function(x){ return optionCard(x, n, locked, isFool, isWizard); };

  const consensus = opts.filter(function(x){ return x.bucket === "consensus"; });
  const solo      = opts.filter(function(x){ return x.bucket !== "consensus" && x.bucket !== "mystery"; });
  const mystery   = opts.filter(function(x){ return x.bucket === "mystery"; });

  html += '<div class="sec"><div class="sec-h"><h3>🔥 最多人想吃的</h3>' +
    '<span class="cnt">' + consensus.length + " 家</span></div>" +
    '<p class="lead">' + (consensus.length
      ? "兩個人以上都選了同一個類型，依想吃的人數排。" + hint
      : "大家想吃的類型完全沒有交集，所以這一區是空的——直接從下面各自的選項裡挑吧。") + "</p>" +
    consensus.map(card).join("") + "</div>";

  if(solo.length){
    const per = res.perSoloType === 2 ? "每種挑兩家備用。" : "每種只挑一家。";
    html += '<div class="sec"><div class="sec-h"><h3>🎯 每個人各自想吃的</h3>' +
      '<span class="cnt">' + solo.length + " 家</span></div>" +
      '<p class="lead">只有一個人選的類型，' + per + "</p>" +
      solo.map(card).join("") + "</div>";
  }

  if(mystery.length){
    html += '<div class="sec"><div class="sec-h"><h3>🕵️ 今日主廚隱藏推薦</h3>' +
      '<span class="cnt">1 家</span></div>' +
      '<p class="lead">不會告訴你是哪一家，全房間看到的是同一間。要不要賭一把隨你。</p>' +
      mystery.map(card).join("") + "</div>";
  }

  if(!locked && !isFool){
    html += '<div class="sticky"><button class="btn green" id="btnBallot" onclick="__submitBallot()">' +
      "送出投票（已選 " + PICKS.length + " 家）</button></div>";
  }

  if(res.warnings && res.warnings.length){
    html += '<div class="warnbox"><b>幾件事先說一下</b><ul>' +
      res.warnings.map(function(w){ return "<li>" + esc(w) + "</li>"; }).join("") + "</ul></div>";
  }
  return html;
}

function optionCard(x, n, locked, isFool, isWizard){
  const r = x.restaurant;
  const picked = PICKS.indexOf(r.id) >= 0;
  const inSwap = SWAP.indexOf(r.id) >= 0;
  const unmasked = !!r.wasAlias;              // 揭曉後的神秘店家：已經知道是誰了
  const isMystery = !!r.mystery && !unmasked; // 還蒙著面的神秘店家

  const why = x.typeLabel
    ? x.typeEmoji + " " + esc(x.typeLabel) + (x.voters && x.voters.length ? "　" + esc(x.voters.join("、")) + " 想吃" : "")
    : "";

  let pill = "";
  if(isMystery){
    pill = '<span class="pill mys">神秘</span>';
  }else if(unmasked){
    pill = '<span class="pill mys">🕵️ 揭曉</span>';
  }else if(x.voters){
    const c = x.voters.length;
    let cls, txt;
    if(c >= n && n >= 2){ cls = "v-all"; txt = "全員 " + n + " 人都想吃"; }
    else if(c >= 4)     { cls = "v4";    txt = c + " 人想吃"; }
    else if(c === 3)    { cls = "v3";    txt = "3 人想吃"; }
    else if(c === 2)    { cls = "v2";    txt = "2 人想吃"; }
    else                { cls = "v1";    txt = "1 人想吃"; }
    pill = '<span class="pill ' + cls + '">' + txt + "</span>";
  }

  return '<div class="r' + (picked ? " picked" : "") + (isMystery || unmasked ? " mystery" : "") + '">' +
    (why ? '<div class="why">' + why + "</div>" : "") +
    (unmasked ? '<div class="unmask">' + esc(r.wasAlias) + " 其實是 👇</div>" : "") +
    '<div class="rh"><h4>' + esc(r.name) + "</h4>" + pill + "</div>" +
    (isMystery
      ? '<p class="note">「' + esc(r.note) + '」</p><p class="note dim">今天只透露類型是「' +
        esc(x.typeLabel || "保密") + '」，而且大家都到得了。真實店名要等結算才會公開。</p>'
      : '<div class="meta"><span>🚇 ' + esc(r.station) + "站</span>" +
        (r.price ? "<span class='dot'>·</span><span>約 $" + r.price + " / 人</span>" : "") +
        (r.book ? '<span class="pill warn">建議訂位</span>' : "") + "</div>" +
        (r.dist != null ? '<div class="meta"><span class="walk">🚶 出站後約 ' + r.dist + " 公尺・走路 " + walkMins(r.dist) + " 分鐘</span></div>" : "") +
        (r.note ? '<p class="note">' + esc(r.note) + "</p>" : "") +
        '<div class="links">' +
          '<a href="' + r.mapUrl + '" target="_blank" rel="noopener">地圖・評分</a>' +
          '<a href="' + r.menuUrl + '" target="_blank" rel="noopener">看菜單</a>' +
          '<a href="' + r.bookUrl + '" target="_blank" rel="noopener">查訂位</a>' +
        "</div>") +
    // 彩蛋那張卡片永遠要說明白它現在是什麼狀態，笨蛋與已送出的人也要
    (isMystery && (locked || isFool)
      ? '<div class="pickbar"><span class="pickbtn locked' + (picked ? " on" : "") + '">' +
          (isFool ? "🤡 轉盤不含這一家"
                  : picked ? "🎲 已押注" : "⏳ 沒有押注") + "</span></div>"
      : "") +
    (locked || isFool ? "" :
      '<div class="pickbar">' +
        // 彩蛋的去留在那 10 秒的彈窗裡就決定了，這裡只顯示結果，不再給第二次機會
        (isMystery
          ? '<span class="pickbtn locked' + (picked ? " on" : "") + '">' +
              (picked ? "🎲 已押注" : mysteryChoice() ? "⏳ 已錯過，不能再投" : "⏳ 等你決定…") + "</span>"
          : '<button class="pickbtn' + (picked ? " on" : "") + '" onclick="__pick(\'' + r.id + '\')">' +
              (picked ? "✓ 已選" : "＋ 選這家") + "</button>") +
        (isWizard ? '<button class="swapbtn' + (inSwap ? " on" : "") + '" onclick="__swap(\'' + r.id + '\')">' +
          (inSwap ? "🧙 交換中" : "選來交換") + "</button>" : "") +
      "</div>") +
  "</div>";
}

/* ---------- 揭曉 ---------- */
function revealedHtml(){
  const f = ROOM.final;
  const opts = allOptions();
  const nameOf = function(rid){
    const o = opts.find(function(x){ return x.restaurant.id === rid; });
    return o ? o.restaurant.name : rid;
  };
  let html = "";

  const top = f.ranked.filter(function(x){ return x.rank <= 3; }).slice(0, 5);
  const medal = ["🥇", "🥈", "🥉"];

  html += '<div class="board reveal"><div class="board-h">最終結果' +
    "<span>已套用角色技能</span></div>" +
    (top.length ? top.map(function(x){
      const max = f.ranked[0].votes || 1;
      return '<div class="row' + (x.rank === 1 ? " lead" : "") + '">' +
        '<span class="medal">' + (medal[x.rank - 1] || "") + "</span>" +
        '<div class="info"><b>' + esc(nameOf(x.id)) + (x.id === "mystery" ? " 🕵️" : "") + "</b>" +
          '<span class="sub">' + esc(x.voters.join("、") || "—") + "</span>" +
          '<span class="bar"><i style="width:' + Math.round(x.votes / max * 100) + '%"></i></span>' +
        "</div>" +
        '<span class="cnt">' + x.votes + ' <em>票</em></span>' +
      "</div>";
    }).join("") : '<p class="hidden-note">沒有人投票。</p>') +
    "</div>";

  /* 技能結算說明 */
  let fx = "";
  const wizRole = (f.roles || []).find(function(r){ return r.role === "wizard"; });
  if(f.swap){
    fx += "<li>🧙 魔法師把「" + esc(nameOf(f.swap.a)) + "」與「" + esc(nameOf(f.swap.b)) + "」的票數對調了" +
      (wizRole && wizRole.poisoned ? "（他被毒啞了，但交換照樣生效）" : "") + "</li>";
  }
  if(f.poisoned && f.poisoned.length) fx += "<li>🍎 " + esc(f.poisoned.join("、")) + " 被壞皇后毒啞，票不算數</li>";
  const king = (f.roles || []).find(function(r){ return r.role === "king"; });
  if(king) fx += "<li>👑 " + esc(king.name) + " 是國王，每一票都算兩票</li>";
  const fool = (f.roles || []).find(function(r){ return r.role === "fool"; });
  if(fool) fx += "<li>🤡 " + esc(fool.name) + " 是笨蛋，那一票是轉盤轉出來的</li>";
  if(fx) html += '<div class="warnbox"><b>這一局發生了什麼</b><ul>' + fx + "</ul></div>";

  /* 角色揭曉 */
  html += '<div class="board"><div class="board-h">角色揭曉<span>現在可以說了</span></div>' +
    '<div class="rolelist">' + (f.roles || []).map(function(r){
      return '<span><b>' + r.emoji + "</b> " + esc(r.name) + "　" + esc(r.roleName) +
        (r.poisoned ? " 😵" : "") + "</span>";
    }).join("") + "</div></div>";

  if(ROOM.mystery){
    const my = opts.find(function(x){ return x.restaurant.id === "mystery"; });
    const hit = f.ranked.find(function(y){ return y.id === "mystery"; });
    const got = hit ? hit.votes : 0;
    html += '<div class="unmaskbox"><b>🕵️ 神秘店家的真面目</b>' +
      '<p class="alias">' + esc(ROOM.mystery.alias) + " 其實是——</p>" +
      (my && !my.restaurant.wasAlias
        ? '<p class="real">（這一局沒有抽到神秘店家）</p>'
        : '<p class="real">' + esc(my ? my.restaurant.name : "?") + "</p>" +
          '<p class="sub">' + esc(ROOM.mystery.typeEmoji + " " + (ROOM.mystery.typeLabel || "")) +
            (my && my.restaurant.station ? "　🚇 " + esc(my.restaurant.station) + "站" : "") + "</p>" +
          '<p class="sub">' + (got ? "有 " + got + " 票賭了下去 —— 賭得值不值，你們自己評斷。" : "沒有人敢賭它，可惜了。") + "</p>") +
      "</div>";
  }

  html += '<div class="sticky"><button class="btn ghost" id="btnReopen" onclick="__reopen()">' +
    "🔄 再玩一局（重抽角色）</button></div>";

  html += '<div class="sec"><div class="sec-h"><h3>完整名單</h3></div>' +
    opts.map(function(x){
      const hit = f.ranked.find(function(y){ return y.id === x.restaurant.id; });
      return optionCard(x, ROOM.members.length, true, false, false).replace("</div>",
        '<div class="votebar"><div class="tally"><span class="num">' + (hit ? hit.votes : 0) +
        '</span><span class="names">' + esc(hit && hit.voters.length ? hit.voters.join("、") : "沒有人投") +
        "</span></div></div></div>");
    }).join("") + "</div>";

  return html;
}

window.__pick = togglePick;
window.__swap = toggleSwap;
window.__submitBallot = submitBallot;
window.__spin = spinWheel;
window.__reveal = revealNow;
window.__reopen = reopenGame;
window.__showRole = function(){ if(MY_ROLE) showModal(roleModal(MY_ROLE)); };

/* 預覽版專用掛勾。正式版沒有 __MOCK_API__，這段等於不存在。 */
if(window.__MOCK_API__){
  window.__preview = {
    open: openRoom,
    newMember: function(){
      MY_ID = null; MY_SECRET = null; MY_ROLE = null; MY_BALLOT = null;
      PICKS = []; SWAP = []; SEEN_ROLE = false; SEEN_MYSTERY = false;
      EDITING = false; clearForm(); render();
    },
    setMember: async function(id){
      MY_ID = id;
      MY_SECRET = (window.__secrets || {})[id] || null;
      MY_ROLE = null; MY_BALLOT = null; PICKS = []; SWAP = [];
      SEEN_ROLE = false; SEEN_MYSTERY = false; EDITING = false;
      await loadMe();
      render();
    },
    reload: function(){ return openRoom(ROOM ? ROOM.id : "DEMO01"); }
  };
}

boot();
})();
