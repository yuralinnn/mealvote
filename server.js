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

/* ---------- 錯誤與非同步路由的共用外殼 ---------- */

/**
 * 業務邏輯的錯誤（「房間不存在」「你已經投過了」這種），
 * 和程式壞掉的錯誤要分開：前者回 4xx 給使用者看，後者記 log 回 500。
 */
class ApiError extends Error {
  constructor(msg, code){ super(msg); this.code = code || 400; }
}
function fail(msg, code){ throw new ApiError(msg, code); }

/** 把 async handler 包起來，錯誤統一處理，不然 express 4 會直接吞掉 rejection */
function route(handler){
  return function(req, res){
    Promise.resolve(handler(req, res)).catch(function(e){
      if(e instanceof ApiError) return bad(res, e.message, e.code);
      console.error("[api] " + req.method + " " + req.path, e);
      bad(res, "伺服器出了點問題，請重試一次", 500);
    });
  };
}

/** 鎖住房間改東西。房間不存在就直接回 404，每一支都要寫一遍太囉嗦。 */
function withRoom(id, mutate){
  return store.update(id, function(room){
    if(!room) fail("找不到這個房間，連結可能打錯或已過期", 404);
    return mutate(room);
  });
}

/* ---------- 建立房間 ---------- */
app.post("/api/rooms", route(async function(req, res){
  const b = req.body || {};
  const title = String(b.title || "").trim().slice(0, 40) || "下班吃什麼";
  if(!b.date) fail("請選擇日期");

  const base = {
    title: title,
    date: String(b.date).slice(0, 10),
    time: String(b.time || "19:00").slice(0, 5),
    stage: "collecting",
    members: [], result: null,
    roles: {}, mystery: null, ballots: {}, pendingPoison: false,
    createdAt: Date.now()
  };

  // 房號是 31^6 ≈ 8.8 億種組合，撞到的機率極低，但真的撞到就換一個再試
  let room = null;
  for(let i = 0; i < 8 && !room; i++){
    const candidate = Object.assign({ id: roomId() }, base);
    if(await store.insertRoom(candidate)) room = candidate;
  }
  if(!room) fail("房號一直產生失敗，請重試", 500);

  // 順手清掉過期房間。放在這裡是因為 serverless 沒有「一直在的行程」可以跑排程，
  // 而建立房間是最不忙的時刻，偶爾做一次就夠了。
  if(Math.random() < 0.05){
    try{ await store.prune(); }catch(e){ console.warn("[prune] " + e.message); }
  }

  res.json(publicRoom(room));
}));

/* ---------- 讀房間 ---------- */
app.get("/api/rooms/:id", route(async function(req, res){
  const room = await store.getRoom(req.params.id);
  if(!room) fail("找不到這個房間，連結可能打錯或已過期", 404);
  res.json(publicRoom(room));
}));

/* ---------- 修改飯局名稱與時間 ---------- */
// 只動顯示用的欄位，不影響配對，所以不需要重算推薦或清掉投票
app.put("/api/rooms/:id", route(async function(req, res){
  const out = await withRoom(req.params.id, function(room){
    const b = req.body || {};
    if(b.title !== undefined){
      const t = String(b.title).trim().slice(0, 40);
      if(!t) fail("飯局名稱不能空白");
      room.title = t;
    }
    if(b.date !== undefined){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) fail("日期格式不對");
      room.date = b.date;
    }
    if(b.time !== undefined){
      if(!/^\d{2}:\d{2}$/.test(b.time)) fail("時間格式不對");
      room.time = b.time;
    }
    return publicRoom(room);
  });
  res.json(out);
}));

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

app.post("/api/rooms/:id/members", route(async function(req, res){
  const out = await withRoom(req.params.id, function(room){
    if(room.members.length >= 20) fail("一個房間最多 20 人");

    const parsed = readMember(req.body || {});
    if(parsed.error) fail(parsed.error);

    // secret 是這個人的私鑰：查自己的角色、送出投票都要它。
    // 公開的 id 誰都看得到，secret 只有本人的瀏覽器有，所以別人偷看不到你的角色。
    const member = Object.assign({ id: uid(), secret: uid() + uid(), submittedAt: Date.now() }, parsed);
    room.members.push(member);
    resetGame(room);
    return { memberId: member.id, secret: member.secret, room: publicRoom(room) };
  });
  res.json(out);
}));

app.put("/api/rooms/:id/members/:mid", route(async function(req, res){
  const out = await withRoom(req.params.id, function(room){
    const m = room.members.find(function(x){ return x.id === req.params.mid; });
    if(!m) fail("找不到你的資料，請重新填一次", 404);

    const parsed = readMember(req.body || {});
    if(parsed.error) fail(parsed.error);

    if(!m.secret) m.secret = uid() + uid();     // 相容舊房間
    Object.assign(m, parsed, { submittedAt: Date.now() });
    resetGame(room);
    return { memberId: m.id, secret: m.secret, room: publicRoom(room) };
  });
  res.json(out);
}));

app.delete("/api/rooms/:id/members/:mid", route(async function(req, res){
  const out = await withRoom(req.params.id, function(room){
    room.members = room.members.filter(function(x){ return x.id !== req.params.mid; });
    resetGame(room);
    return publicRoom(room);
  });
  res.json(out);
}));

/* ---------- 產生推薦 ---------- */

/** 這一組成員的指紋。用來確認鎖住房間之後，成員名單跟算推薦時是同一份。 */
function memberFingerprint(members){
  return members.map(function(m){
    return m.id + ":" + m.station + ":" + m.maxStations + ":" + m.types.join(",");
  }).join("|");
}

app.post("/api/rooms/:id/generate", route(async function(req, res){
  // 推薦計算與（選用的）Google 評分查詢放在交易外面做。
  // 這兩件事可能要花上幾百毫秒甚至更久，握著資料庫的鎖去等外部 API
  // 會把同一個房間的其他人一起卡住。
  const pre = await store.getRoom(req.params.id);
  if(!pre) fail("找不到這個房間", 404);
  if(!pre.members.length) fail("還沒有人填寫條件");

  const fingerprint = memberFingerprint(pre.members);
  let out = recommend(pre.members);

  // 有設定 API key 才會走這段，失敗也不影響推薦本身
  try{
    out.consensus = await places.enrich(out.consensus);
    out.byType = await places.enrich(out.byType);
  }catch(e){
    console.warn("[generate] 即時評分補充失敗：", e.message);
  }

  const result = await withRoom(req.params.id, function(room){
    if(!room.members.length) fail("還沒有人填寫條件");

    // 剛剛算的時候有人改了條件 → 用最新的名單重算一次（這次不查外部評分，很快）
    if(memberFingerprint(room.members) !== fingerprint) out = recommend(room.members);

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
    return publicRoom(room);
  });
  res.json(result);
}));

/* ---------- 查自己的角色（只有本人查得到） ---------- */
app.get("/api/rooms/:id/me", route(async function(req, res){
  const room = await store.getRoom(req.params.id);
  if(!room) fail("找不到這個房間", 404);

  const me = memberBySecret(room, req.query.secret);
  if(!me) fail("認不出你是誰，請重新填寫條件", 403);

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
}));

/* ---------- 送出投票 ---------- */
// 這一支一定要在交易裡做完：壞皇后的毒是「誰接在誰後面送出」，
// 兩個人同時按送出的話，沒上鎖就會兩個人都讀到 pendingPoison=true，
// 變成毒到兩個人（或都沒毒到）。
app.post("/api/rooms/:id/ballot", route(async function(req, res){
  const out = await withRoom(req.params.id, function(room){
    if(room.stage !== "voting") fail("現在不是投票階段");

    const me = memberBySecret(room, (req.body || {}).secret);
    if(!me) fail("認不出你是誰，請重新填寫條件", 403);

    room.ballots = room.ballots || {};
    if(room.ballots[me.id] && room.ballots[me.id].submittedAt){
      fail("你已經送出過了，投票不能反悔");
    }

    const roleId = (room.roles || {})[me.id];
    if(roleId === "fool") fail("你是笨蛋，要用轉盤決定，不能自己選");

    const valid = candidateIds(room).concat(room.mystery ? ["mystery"] : []);
    const picks = Array.isArray(req.body.picks)
      ? req.body.picks.filter(function(x){ return valid.indexOf(x) >= 0; })
      : [];
    if(!picks.length) fail("至少要選一家");

    let swap = null;
    if(roleId === "wizard"){
      const sw = req.body.swap;
      if(!Array.isArray(sw) || sw.length !== 2 || sw[0] === sw[1] ||
         valid.indexOf(sw[0]) < 0 || valid.indexOf(sw[1]) < 0){
        fail("魔法師要指定兩家不同的餐廳來交換票數");
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
    return { poisoned: ballot.poisoned, room: publicRoom(room) };
  });
  res.json(out);
}));

/* ---------- 笨蛋的轉盤 ---------- */
app.post("/api/rooms/:id/spin", route(async function(req, res){
  const out = await withRoom(req.params.id, function(room){
    if(room.stage !== "voting") fail("現在不是投票階段");

    const me = memberBySecret(room, (req.body || {}).secret);
    if(!me) fail("認不出你是誰", 403);
    if((room.roles || {})[me.id] !== "fool") fail("只有笨蛋要轉轉盤");

    room.ballots = room.ballots || {};
    if(room.ballots[me.id] && room.ballots[me.id].submittedAt) fail("你已經轉過了");

    const ids = candidateIds(room);
    if(!ids.length) fail("沒有候選餐廳可以轉");

    // 由伺服器決定結果，前端只負責把轉盤動畫轉到這一格 —— 使用者改不了
    const idx = crypto.randomInt(ids.length);
    const ballot = {
      picks: [ids[idx]], swap: null, wheelPick: ids[idx],
      submittedAt: Date.now(), poisoned: false
    };

    if(room.pendingPoison){ ballot.poisoned = true; room.pendingPoison = false; }

    room.ballots[me.id] = ballot;
    maybeReveal(room);
    return { index: idx, total: ids.length, restaurantId: ids[idx],
             poisoned: ballot.poisoned, room: publicRoom(room) };
  });
  res.json(out);
}));

/** 全部人都送出就自動揭曉 */
function maybeReveal(room){
  const done = room.members.every(function(m){
    return room.ballots[m.id] && room.ballots[m.id].submittedAt;
  });
  if(done && room.members.length) room.stage = "revealed";
}

/* ---------- 提前結算（還有人沒投時，任何人都可以直接開） ---------- */
app.post("/api/rooms/:id/reveal", route(async function(req, res){
  const out = await withRoom(req.params.id, function(room){
    if(room.stage !== "voting") fail("現在不能結算");
    if(!Object.keys(room.ballots || {}).length) fail("還沒有人投票");
    room.stage = "revealed";
    return publicRoom(room);
  });
  res.json(out);
}));

/* ---------- 再玩一局：回到填寫階段 ---------- */
app.post("/api/rooms/:id/reopen", route(async function(req, res){
  const out = await withRoom(req.params.id, function(room){
    resetGame(room);
    return publicRoom(room);
  });
  res.json(out);
}));

/* ---------- 單獨查兩站之間幾站（前端即時預覽用） ---------- */
app.get("/api/distance", function(req, res){
  const d = mrt.distance(req.query.from, req.query.to);
  if(!d) return bad(res, "站名認不出來");
  res.json(d);
});

// 健康檢查。部署完先打這裡，storage 要顯示 "pg" 才代表資料庫真的接上了。
app.get("/healthz", route(async function(req, res){
  res.json({ ok: true, storage: store.backendName(), rooms: await store.count() });
}));

app.use(function(req, res){
  if(req.path.indexOf("/api/") === 0) return bad(res, "沒有這個 API", 404);
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * 只有「自己起一個伺服器」時才 listen。
 * Vercel 是 serverless：那邊由 api/index.js 直接把這個 app 當 handler 用，
 * 不會有人來 listen，所以這裡要判斷一下，不然本機與雲端得維護兩份程式。
 */
if(require.main === module){
  store.ready().then(function(mode){
    app.listen(PORT, function(){
      console.log("約飯神器跑在 http://localhost:" + PORT);
      console.log("餐廳 " + RESTAURANTS.length + " 筆 · 捷運 " + mrt.ALL_STATIONS.length + " 站 · 即時評分：" + (places.ENABLED ? "開啟" : "關閉（未設定 API key）"));
      console.log("儲存方式：" + (mode === "pg" ? "PostgreSQL（重開機資料還在）" : "JSON 檔案（重新部署會清空）"));
    });
  }).catch(function(e){
    console.error("\n連不上資料庫，服務起不來：" + e.message);
    console.error("檢查 DATABASE_URL 是不是填對了。想先跑檔案模式的話，把 DATABASE_URL 拿掉再試。\n");
    process.exit(1);
  });
}

module.exports = app;
