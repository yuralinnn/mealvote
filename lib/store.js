/**
 * 持久化：兩種後端，開機時看環境變數決定用哪一個。
 *
 *   有 DATABASE_URL  → PostgreSQL（部署到 Render / Railway 這種免費方案時用）
 *   沒有             → 一個 JSON 檔（本機開發、自己的機器）
 *
 * 為什麼需要資料庫：Render 免費方案的檔案系統是「暫時的」，
 * 服務閒置 15 分鐘會被休眠，醒來時檔案會回到剛部署的樣子 ——
 * 也就是大家填到一半的資料會整個不見。這個 app 的使用情境
 * 正好是「早上開房間、傍晚才投票」，中間一定會閒置，所以檔案存不住。
 *
 * 兩種後端的介面完全一樣，而且都是「全部資料放在記憶體、寫入非同步刷回去」，
 * 所以 server.js 的讀取仍然是同步的，不需要為了資料庫改寫每一支 API。
 * 這個 app 的資料量（一個房間 < 5KB、30 天就清掉）放得下記憶體。
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "storage");
const FILE = path.join(DATA_DIR, "rooms.json");
const PG_URL = process.env.DATABASE_URL || "";
const TABLE = "mealvote_rooms";

let db = { rooms: {} };
let writeTimer = null;
const dirtyIds = new Set();
const deletedIds = new Set();

let pool = null;          // pg 連線池，只有 PG 模式才有
let backend = "file";
let readyPromise = null;

/* ---------- JSON 檔後端 ---------- */

function fileLoad(){
  try{
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if(fs.existsSync(FILE)){
      db = JSON.parse(fs.readFileSync(FILE, "utf8"));
      if(!db.rooms) db.rooms = {};
      console.log("[store] 檔案模式，已載入 " + Object.keys(db.rooms).length + " 個房間");
    }else{
      console.log("[store] 檔案模式，全新的資料");
    }
  }catch(e){
    console.error("[store] 載入失敗，改用空白資料：", e.message);
    db = { rooms: {} };
  }
}

function fileFlush(){
  try{
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db), "utf8");   // 先寫暫存檔再 rename，斷電也不會寫壞
    fs.renameSync(tmp, FILE);
  }catch(e){
    console.error("[store] 寫入失敗：", e.message);
  }
}

/* ---------- PostgreSQL 後端 ---------- */

async function pgLoad(){
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: PG_URL,
    // Render 的內部連線不需要 SSL，外部連線需要但憑證是它自己簽的
    ssl: /localhost|127\.0\.0\.1|\.internal/.test(PG_URL) ? false : { rejectUnauthorized: false },
    max: 4
  });

  await pool.query(
    "CREATE TABLE IF NOT EXISTS " + TABLE + " (" +
    "  id TEXT PRIMARY KEY," +
    "  data JSONB NOT NULL," +
    "  created_at BIGINT NOT NULL DEFAULT 0," +
    "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()" +
    ")"
  );

  const rows = (await pool.query("SELECT id, data FROM " + TABLE)).rows;
  db = { rooms: {} };
  rows.forEach(function(r){ db.rooms[r.id] = r.data; });
  console.log("[store] PostgreSQL 模式，已載入 " + rows.length + " 個房間");
}

async function pgFlush(){
  if(!pool) return;
  const ids = Array.from(dirtyIds);
  const gone = Array.from(deletedIds);
  dirtyIds.clear();
  deletedIds.clear();

  try{
    for(const id of ids){
      const room = db.rooms[id];
      if(!room) continue;
      await pool.query(
        "INSERT INTO " + TABLE + " (id, data, created_at, updated_at) VALUES ($1, $2, $3, now()) " +
        "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
        [id, JSON.stringify(room), room.createdAt || 0]
      );
    }
    if(gone.length){
      await pool.query("DELETE FROM " + TABLE + " WHERE id = ANY($1)", [gone]);
    }
  }catch(e){
    // 寫失敗就把 id 放回待寫清單，下一輪再試。記憶體裡的資料還在，服務不會壞。
    console.error("[store] 資料庫寫入失敗（稍後重試）：", e.message);
    ids.forEach(function(x){ dirtyIds.add(x); });
    gone.forEach(function(x){ deletedIds.add(x); });
  }
}

/* ---------- 共用 ---------- */

/** 把待寫入的變更真的落地。開機、關機、以及每 200ms 的合併寫入都會呼叫。 */
async function flush(){
  if(!dirtyIds.size && !deletedIds.size) return;
  if(backend === "pg") await pgFlush();
  else { dirtyIds.clear(); deletedIds.clear(); fileFlush(); }
}

/** 標記為待寫入，200ms 內的多次變更合併成一次 */
function save(){
  if(writeTimer) return;
  writeTimer = setTimeout(function(){
    writeTimer = null;
    flush().catch(function(e){ console.error("[store] flush 出錯：", e.message); });
  }, 200);
}

/** 清掉 30 天前的房間。這個 app 的資料本來就是一次性的，留著只是佔空間。 */
function prune(){
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let removed = 0;
  Object.keys(db.rooms).forEach(function(id){
    if((db.rooms[id].createdAt || 0) < cutoff){
      delete db.rooms[id];
      dirtyIds.delete(id);
      deletedIds.add(id);
      removed++;
    }
  });
  if(removed){ console.log("[store] 清除 " + removed + " 個過期房間"); save(); }
}

/**
 * 開機初始化。server.js 要 await 這個才 listen，
 * 不然資料庫還沒載完就有人打 API，會看到「找不到房間」。
 */
function ready(){
  if(readyPromise) return readyPromise;
  readyPromise = (async function(){
    if(PG_URL){
      try{
        await pgLoad();
        backend = "pg";
      }catch(e){
        // 資料庫連不上不該讓整個服務起不來 —— 退回檔案模式，
        // 至少大家還能用，只是重開會掉資料。訊息寫得刺眼一點，方便發現。
        console.error("\n[store] ⚠️  連不上 DATABASE_URL：" + e.message);
        console.error("[store] ⚠️  改用檔案模式。在 Render 免費方案上，這代表服務休眠後資料會消失。\n");
        backend = "file";
        fileLoad();
      }
    }else{
      fileLoad();
    }
    prune();
    setInterval(prune, 6 * 60 * 60 * 1000).unref();
    return backend;
  })();
  return readyPromise;
}

/** 關機前把還沒寫完的資料寫掉。Render 重新部署時會送 SIGTERM。 */
async function shutdown(){
  if(writeTimer){ clearTimeout(writeTimer); writeTimer = null; }
  await flush();
  if(pool) await pool.end().catch(function(){});
}

process.on("SIGTERM", function(){ shutdown().then(function(){ process.exit(0); }); });
process.on("SIGINT",  function(){ shutdown().then(function(){ process.exit(0); }); });

module.exports = {
  ready: ready,
  backendName: function(){ return backend; },
  getRoom: function(id){ return db.rooms[id] || null; },
  putRoom: function(room){ db.rooms[room.id] = room; dirtyIds.add(room.id); save(); return room; },
  allRooms: function(){ return db.rooms; },
  flush: flush,
  shutdown: shutdown
};
