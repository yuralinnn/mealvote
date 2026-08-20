const express = require("express");
const path = require("path");
const crypto = require("crypto");

const store = require("./lib/store");
const places = require("./lib/places");
const { recommend, evaluate } = require("./lib/recommend");
const { ROLES, assignRoles, pickMystery, tally } = require("./lib/roles");
const mrt = require("./data/mrt");
const { TYPES, RESTAURANTS } = require("./data/restaurants");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

/* ---------- 小工具 ---------- */
// 房號用純英數，貼到 LINE 才不會變成一長串 %E7%8F%8D 的亂碼。
// 去掉容易看錯的 0/O/1/I/L。
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function roomId(){
  const b = crypto.randomBytes(6);
  let s = "";
  for(let i = 0; i < 6; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}
function uid(){ return crypto.randomBytes(6).toString("hex"); }
function bad(res, msg, code){ return res.status(code || 400).json({ error: msg }); }

function clampInt(v, lo, hi, dflt){
  const n = parseInt(v, 10);
  if(isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
function cleanName(s){
  return String(s == null ? "" : s).trim().slice(0, 12);
}

/**
 * 對外回傳的房間樣貌。
 *
 * 這一層是整個遊戲的安全邊界，三件事絕對不能外流：
 *   1. roles       —— 誰抽到什麼角色，只有本人能查（用自己的 secret）
 *   2. ballots     —— 誰投了什麼，揭曉之前不給看
 *   3. mystery 的真實店家 —— 投票期間絕對不給看，揭曉之後才隨結果公開
 * 成員的 secret 也不在這裡，只有建立／更新自己資料時才拿得到。
 */
function publicRoom(room){
  const revealed = room.stage === "revealed";
  const ballots = room.ballots || {};

  const out = {
    id: room.id, title: room.title, date: room.date, time: room.time,
    stage: room.stage, createdAt: room.createdAt, gameNonce: room.gameNonce || null,
    members: room.members.map(function(m){
      return {
        id: m.id, name: m.name, station: m.station, maxStations: m.maxStations,
        types: m.types, submittedAt: m.submittedAt,
        // 誰投完了是公開的（大家要知道還在等誰），但投了什麼不是
        hasVoted: !!(ballots[m.id] && ballots[m.id].submittedAt)
      };
    }),
    result: room.result ? {
      consensus: room.result.consensus,
      byType: room.result.byType,
      warnings: room.result.warnings,
      noOverlap: room.result.noOverlap,
      perSoloType: room.result.perSoloType,
      soloTypeCount: room.result.soloTypeCount
    } : null,
    mystery: room.mystery ? {
      id: "mystery",
      alias: room.mystery.alias,
      tagline: room.mystery.tagline,
      typeLabel: room.mystery.typeLabel,
      typeEmoji: room.mystery.typeEmoji,
      // 揭曉之後才把真面目掛上去。revealed 之前這兩個欄位根本不存在，
      // 不是前端藏起來而已 —— 拿 curl 打 API 也看不到。
      revealed: revealed || undefined,
      entry: revealed ? room.mystery.entry : undefined
    } : null,
    votedCount: Object.keys(ballots).filter(function(k){ return ballots[k].submittedAt; }).length,
    liveRatings: places.ENABLED
  };

  if(revealed) out.final = computeFinal(room);
  return out;
}

/** 揭曉時才算：套用國王加權、壞皇后作廢、魔法師交換，然後排名次 */
function computeFinal(room){
  const nameOf = function(mid){
    const m = room.members.find(function(x){ return x.id === mid; });
    return m ? m.name : "?";
  };
  const t = tally(room.ballots || {}, room.roles || {}, nameOf);

  const ranked = Object.keys(t.totals)
    .filter(function(rid){ return t.totals[rid] > 0; })
    .map(function(rid){ return { id: rid, votes: t.totals[rid], voters: t.voters[rid] || [] }; })
    .sort(function(a, b){ return b.votes - a.votes; });

  let rank = 0, prev = null;
  ranked.forEach(function(x, i){
    if(prev === null || x.votes !== prev){ rank = i + 1; prev = x.votes; }
    x.rank = rank;
  });

  // 揭曉之後才公開誰是什麼角色，這時已經不影響投票心理了
  const roleReveal = room.members.map(function(m){
    const r = ROLES[(room.roles || {})[m.id]] || ROLES.commoner;
    return { name: m.name, role: r.id, roleName: r.name, emoji: r.emoji,
             poisoned: !!(room.ballots[m.id] && room.ballots[m.id].poisoned) };
  });

  return {
    ranked: ranked,
    swap: t.swap,
    poisoned: t.poisonedIds.map(nameOf),
    roles: roleReveal
  };
}

/** 有人加入或改條件 → 推薦、角色、彩蛋、票全部重來 */
function resetGame(room){
  room.result = null;
  room.roles = {};
  room.mystery = null;
  room.ballots = {};
  room.pendingPoison = false;
  room.gameNonce = null;
  room.stage = "collecting";
}

/** 用 secret 找人。找不到就是沒權限。 */
function memberBySecret(room, secret){
  if(!secret) return null;
  return room.members.find(function(m){ return m.secret === secret; }) || null;
}

/** 這一輪可以投的所有選項（推薦候選；彩蛋另外算） */
function candidateIds(room){
  if(!room.result) return [];
  return room.result.consensus.concat(room.result.byType)
    .map(function(x){ return x.restaurant.id; });
}

/* ---------- Meta ---------- */
app.get("/api/meta", function(req, res){
  res.json({
    types: TYPES,
    stations: mrt.ALL_STATIONS,
    lines: mrt.STATIONS_BY_LINE,
    restaurantCount: RESTAURANTS.length,
    liveRatings: places.ENABLED
  });
});

/* ---------- 建立房間 ---------- */
app.post("/api/rooms", function(req, res){
  const b = req.body || {};
  const title = String(b.title || "").trim().slice(0, 40) || "下班吃什麼";
  if(!b.date) return bad(res, "請選擇日期");

  let id = roomId();
  let guard = 0;
  while(store.getRoom(id) && guard++ < 20) id = roomId();

  const room = {
    id: id, title: title,
    date: String(b.date).slice(0, 10),
    time: String(b.time || "19:00").slice(0, 5),
    stage: "collecting",
    members: [], result: null,
    roles: {}, mystery: null, ballots: {}, pendingPoison: false,
    createdAt: Date.now()
  };
  store.putRoom(room);
  res.json(publicRoom(room));
});

/* ---------- 讀房間 ---------- */
app.get("/api/rooms/:id", function(req, res){
  const room = store.getRoom(req.params.id);
  if(!room) return bad(res, "找不到這個房間，連結可能打錯或已過期", 404);
  res.json(publicRoom(room));
});

/* ---------- 修改飯局名稱與時間 ---------- */
// 只動顯示用的欄位，不影響配對，所以不需要重算推薦或清掉投票
app.put("/api/rooms/:id", function(req, res){
  const room = store.getRoom(req.params.id);
  if(!room) return bad(res, "找不到這個房間", 404);

  const b = req.body || {};
  if(b.title !== undefined){
    const t = String(b.title).trim().slice(0, 40);
    if(!t) return bad(res, "飯局名稱不能空白");
    room.title = t;
  }
  if(b.date !== undefined){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return bad(res, "日期格式不對");
    room.date = b.date;
  }
  if(b.time !== undefined){
    if(!/^\d{2}:\d{2}$/.test(b.time)) return bad(res, "時間格式不對");
    room.time = b.time;
  }
  store.putRoom(room);
  res.json(publicRoom(room));
});

/* ---------- 加入 / 更新成員 ---------- */
function readMember(b){
  const name = cleanName(b.name);
  if(!name) return { error: "請填暱稱" };

  const station = mrt.normalizeStation(b.station);
  if(!station) return { error: "認不出「" + (b.station || "") + "」這一站，請從清單挑一個" };

  const types = Array.isArray(b.types)
    ? b.types.filter(function(t){ return TYPES.some(function(x){ return x.id === t; }); }).slice(0, 8)
    : [];
  if(!types.length) return { error: "至少選一種想吃的" };

  return {
    name: name, station: station,
    maxStations: clampInt(b.maxStations, 0, 40, 5),
    types: types
  };
}

app.post("/api/rooms/:id/members", function(req, res){
  const room = store.getRoom(req.params.id);
  if(!room) return bad(res, "找不到這個房間", 404);
  if(room.members.length >= 20) return bad(res, "一個房間最多 20 人");

  const parsed = readMember(req.body || {});
  if(parsed.error) return bad(res, parsed.error);

  // secret 是這個人的私鑰：查自己的角色、送出投票都要它。
  // 公開的 id 誰都看得到，secret 只有本人的瀏覽器有，所以別人偷看不到你的角色。
  const member = Object.assign({ id: uid(), secret: uid() + uid(), submittedAt: Date.now() }, parsed);
  room.members.push(member);
  resetGame(room);
  store.putRoom(room);
  res.json({ memberId: member.id, secret: member.secret, room: publicRoom(room) });
});

app.put("/api/rooms/:id/members/:mid", function(req, res){
  const room = store.getRoom(req.params.id);
  if(!room) return bad(res, "找不到這個房間", 404);
  const m = room.members.find(function(x){ return x.id === req.params.mid; });
  if(!m) return bad(res, "找不到你的資料，請重新填一次", 404);

  const parsed = readMember(req.body || {});
  if(parsed.error) return bad(res, parsed.error);

  if(!m.secret) m.secret = uid() + uid();     // 相容舊房間
  Object.assign(m, parsed, { submittedAt: Date.now() });
  resetGame(room);
  store.putRoom(room);
  res.json({ memberId: m.id, secret: m.secret, room: publicRoom(room) });
});

app.delete("/api/rooms/:id/members/:mid", function(req, res){
  const room = store.getRoom(req.params.id);
  if(!room) return bad(res, "找不到這個房間", 404);
  room.members = room.members.filter(function(x){ return x.id !== req.params.mid; });
  resetGame(room);
  store.putRoom(room);
  res.json(publicRoom(room));
});

/* ---------- 產生推薦 ---------- */
app.post("/api/rooms/:id/generate", async function(req, res){
  const room = store.getRoom(req.params.id);
  if(!room) return bad(res, "找不到這個房間", 404);
  if(!room.members.length) return bad(res, "還沒有人填寫條件");

  const out = recommend(room.members);

  // 有設定 API key 才會走這段，失敗也不影響推薦本身
  try{
    out.consensus = await places.enrich(out.consensus);
    out.byType = await places.enrich(out.byType);
  }catch(e){
    console.warn("[generate] 即時評分補充失敗：", e.message);
  }

  room.result = out;
  room.ballots = {};
  room.pendingPoison = false;

  // 角色與彩蛋都由伺服器決定一次，存進房間 —— 這樣同一房間的人看到的一定一致，
  // 也沒辦法自己重抽到喜歡的角色。
  room.roles = assignRoles(room.members.map(function(m){ return m.id; }));

  const used = out.consensus.concat(out.byType).map(function(x){ return x.restaurant.id; });
  room.mystery = pickMystery(out.spare || [], used);

  // 這一局的識別碼。前端靠它判斷「換局了」——角色卡與彩蛋要重新跳一次，
  // 上一局在 localStorage 存的彩蛋決定也不能沿用。
  room.gameNonce = crypto.randomBytes(4).toString("hex");

  room.stage = "voting";
  store.putRoom(room);
  res.json(publicRoom(room));
});

/* ---------- 查自己的角色（只有本人查得到） ---------- */
app.get("/api/rooms/:id/me", function(req, res){
  const room = store.getRoom(req.params.id);
  if(!room) return bad(res, "找不到這個房間", 404);

  const me = memberBySecret(room, req.query.secret);
  if(!me) return bad(res, "認不出你是誰，請重新填寫條件", 403);

  const roleId = (room.roles || {})[me.id];
  const role = ROLES[roleId] || null;
  const b = (room.ballots || {})[me.id] || null;

  res.json({
    memberId: me.id,
    name: me.name,
    role: role ? { id: role.id, name: role.name, emoji: role.emoji,
                   power: role.power, detail: role.detail } : null,
    ballot: b ? { picks: b.picks || [], swap: b.swap || null,
                  poisoned: !!b.poisoned, submittedAt: b.submittedAt || null,
                  wheelPick: b.wheelPick || null } : null
  });
});

/* ---------- 送出投票 ---------- */
app.post("/api/rooms/:id/ballot", function(req, res){
  const room = store.getRoom(req.params.id);
  if(!room) return bad(res, "找不到這個房間", 404);
  if(room.stage !== "voting") return bad(res, "現在不是投票階段");

  const me = memberBySecret(room, (req.body || {}).secret);
  if(!me) return bad(res, "認不出你是誰，請重新填寫條件", 403);

  room.ballots = room.ballots || {};
  if(room.ballots[me.id] && room.ballots[me.id].submittedAt){
    return bad(res, "你已經送出過了，投票不能反悔");
  }

  const roleId = (room.roles || {})[me.id];
  if(roleId === "fool") return bad(res, "你是笨蛋，要用轉盤決定，不能自己選");

  const valid = candidateIds(room).concat(room.mystery ? ["mystery"] : []);
  const picks = Array.isArray(req.body.picks)
    ? req.body.picks.filter(function(x){ return valid.indexOf(x) >= 0; })
    : [];
  if(!picks.length) return bad(res, "至少要選一家");

  let swap = null;
  if(roleId === "wizard"){
    const sw = req.body.swap;
    if(!Array.isArray(sw) || sw.length !== 2 || sw[0] === sw[1] ||
       valid.indexOf(sw[0]) < 0 || valid.indexOf(sw[1]) < 0){
      return bad(res, "魔法師要指定兩家不同的餐廳來交換票數");
    }
    swap = [sw[0], sw[1]];
  }

  const ballot = { picks: picks, swap: swap, submittedAt: Date.now(), poisoned: false };

  // 壞皇后的毒：她送出之後，接著第一個送出的人整票作廢。
  // 她自己不會中毒；如果她是最後一個送出的，毒就沒人接，自然失效。
  if(room.pendingPoison && roleId !== "queen"){
    ballot.poisoned = true;
    room.pendingPoison = false;
  }
  if(roleId === "queen") room.pendingPoison = true;

  room.ballots[me.id] = ballot;
  maybeReveal(room);
  store.putRoom(room);

  res.json({ poisoned: ballot.poisoned, room: publicRoom(room) });
});

/* ---------- 笨蛋的轉盤 ---------- */
app.post("/api/rooms/:id/spin", function(req, res){
  const room = store.getRoom(req.params.id);
  if(!room) return bad(res, "找不到這個房間", 404);
  if(room.stage !== "voting") return bad(res, "現在不是投票階段");

  const me = memberBySecret(room, (req.body || {}).secret);
  if(!me) return bad(res, "認不出你是誰", 403);
  if((room.roles || {})[me.id] !== "fool") return bad(res, "只有笨蛋要轉轉盤");

  room.ballots = room.ballots || {};
  if(room.ballots[me.id] && room.ballots[me.id].submittedAt) return bad(res, "你已經轉過了");

  const ids = candidateIds(room);
  if(!ids.length) return bad(res, "沒有候選餐廳可以轉");

  // 由伺服器決定結果，前端只負責把轉盤動畫轉到這一格 —— 使用者改不了
  const idx = Math.floor(Math.random() * ids.length);
  const ballot = {
    picks: [ids[idx]], swap: null, wheelPick: ids[idx],
    submittedAt: Date.now(), poisoned: false
  };

  if(room.pendingPoison){ ballot.poisoned = true; room.pendingPoison = false; }

  room.ballots[me.id] = ballot;
  maybeReveal(room);
  store.putRoom(room);

  res.json({ index: idx, total: ids.length, restaurantId: ids[idx],
             poisoned: ballot.poisoned, room: publicRoom(room) });
});

/** 全部人都送出就自動揭曉 */
function maybeReveal(room){
  const done = room.members.every(function(m){
    return room.ballots[m.id] && room.ballots[m.id].submittedAt;
  });
  if(done && room.members.length) room.stage = "revealed";
}

/* ---------- 提前結算（還有人沒投時，發起人可以直接開） ---------- */
app.post("/api/rooms/:id/reveal", function(req, res){
  const room = store.getRoom(req.params.id);
  if(!room) return bad(res, "找不到這個房間", 404);
  if(room.stage !== "voting") return bad(res, "現在不能結算");
  const voted = Object.keys(room.ballots || {}).length;
  if(!voted) return bad(res, "還沒有人投票");
  room.stage = "revealed";
  store.putRoom(room);
  res.json(publicRoom(room));
});

/* ---------- 回到填寫階段 ---------- */
app.post("/api/rooms/:id/reopen", function(req, res){
  const room = store.getRoom(req.params.id);
  if(!room) return bad(res, "找不到這個房間", 404);
  resetGame(room);
  store.putRoom(room);
  res.json(publicRoom(room));
});

/* ---------- 單獨查兩站之間幾站（前端即時預覽用） ---------- */
app.get("/api/distance", function(req, res){
  const d = mrt.distance(req.query.from, req.query.to);
  if(!d) return bad(res, "站名認不出來");
  res.json(d);
});

// keep-alive 用的端點。Render 免費方案閒置 15 分鐘會休眠，
// 用 cron-job.org 之類的服務每 10 分鐘打這裡就能讓它一直醒著。
app.get("/healthz", function(req, res){
  res.json({ ok: true, storage: store.backendName(), rooms: Object.keys(store.allRooms()).length });
});

app.use(function(req, res){
  if(req.path.indexOf("/api/") === 0) return bad(res, "沒有這個 API", 404);
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 先把資料載完才開始收請求，不然剛開機的那幾百毫秒會回「找不到房間」
store.ready().then(function(mode){
  app.listen(PORT, function(){
    console.log("約飯神器跑在 http://localhost:" + PORT);
    console.log("餐廳 " + RESTAURANTS.length + " 筆 · 捷運 " + mrt.ALL_STATIONS.length + " 站 · 即時評分：" + (places.ENABLED ? "開啟" : "關閉（未設定 API key）"));
    console.log("儲存方式：" + (mode === "pg" ? "PostgreSQL（重開機資料還在）" : "JSON 檔案（部署在免費方案上會掉資料）"));
  });
});

module.exports = app;
