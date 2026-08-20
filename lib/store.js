/**
 * 持久化。兩種後端，開機時看環境變數決定：
 *
 *   有 DATABASE_URL  → PostgreSQL（部署用）
 *   沒有             → 一個 JSON 檔（本機開發）
 *
 * ── 為什麼介面全部是非同步的 ──
 *
 * 這個 app 要能跑在 serverless（Vercel）上，那裡沒有「一直在的行程」：
 * 每一次請求都可能落在不同的執行實例，記憶體裡快取的房間對不起來，
 * 而且函式回應之後就會被凍結，來不及做延遲寫入。
 * 所以規則是：**每一次請求都直接讀資料庫、寫完才回應**，不靠任何記憶體狀態。
 *
 * ── 為什麼要上鎖 ──
 *
 * 房間是一整包 JSON，所有的修改都是「讀出來 → 改 → 整包寫回去」。
 * 同一個行程裡這樣做很安全（Node 是單執行緒），但 serverless 上兩個人
 * 幾乎同時送出投票時，會變成兩個實例各自讀到同一份舊資料、各自改、各自寫回，
 * 後寫的那個把先寫的蓋掉 —— 有人的票會憑空消失，壞皇后的下毒順序也會錯亂。
 *
 * 所以凡是會改到房間的操作，一律走 update()：開一個交易，
 * SELECT ... FOR UPDATE 把那一列鎖住，改完 commit 才放行。
 * 同一個房間的併發修改會排隊，不會互相覆蓋。
 *
 * 檔案模式沒有這個問題（單一行程、單執行緒），但為了介面一致也走同一套流程。
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "storage");
const FILE = path.join(DATA_DIR, "rooms.json");
const PG_URL = process.env.DATABASE_URL || "";
const TABLE = "mealvote_rooms";

const usingPg = !!PG_URL;
let pool = null;
let initPromise = null;

/* ================= PostgreSQL ================= */

function getPool(){
  if(pool) return pool;
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: PG_URL,
    // 本機測試不需要 SSL；雲端的 Postgres（Neon / Render）都需要，
    // 而且憑證是自簽的，所以不驗證憑證鏈。
    ssl: /localhost|127\.0\.0\.1|\.internal/.test(PG_URL) ? false : { rejectUnauthorized: false },
    // serverless 上每個實例只會同時處理一兩個請求，連線開太多只是浪費
    max: Number(process.env.PG_POOL_MAX || 3),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000
  });
  pool.on("error", function(e){ console.error("[store] 連線池錯誤：", e.message); });
  return pool;
}

/** 建表。只會真的跑一次，之後回同一個 promise。 */
function init(){
  if(initPromise) return initPromise;
  initPromise = (async function(){
    if(!usingPg){
      fs.mkdirSync(DATA_DIR, { recursive: true });
      return "file";
    }
    await getPool().query(
      "CREATE TABLE IF NOT EXISTS " + TABLE + " (" +
      "  id TEXT PRIMARY KEY," +
      "  data JSONB NOT NULL," +
      "  created_at BIGINT NOT NULL DEFAULT 0," +
      "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()" +
      ")"
    );
    await getPool().query(
      "CREATE INDEX IF NOT EXISTS " + TABLE + "_created_idx ON " + TABLE + " (created_at)"
    );
    return "pg";
  })().catch(function(e){
    initPromise = null;              // 失敗就讓下一次請求重試，不要卡死
    throw e;
  });
  return initPromise;
}

async function pgGet(id){
  await init();
  const r = await getPool().query("SELECT data FROM " + TABLE + " WHERE id = $1", [id]);
  return r.rows.length ? r.rows[0].data : null;
}

async function pgPut(room){
  await init();
  await getPool().query(
    "INSERT INTO " + TABLE + " (id, data, created_at, updated_at) VALUES ($1, $2, $3, now()) " +
    "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
    [room.id, JSON.stringify(room), room.createdAt || 0]
  );
  return room;
}

/**
 * 鎖住一個房間、改它、寫回去。
 * mutate(room) 回傳的東西會原封不動傳給呼叫端，方便回傳額外資訊
 * （例如「這一票有沒有被毒到」）。mutate 裡丟出錯誤就整個 rollback。
 *
 * mutate 收到 null 代表房間不存在。
 */
async function pgUpdate(id, mutate){
  await init();
  const client = await getPool().connect();
  try{
    await client.query("BEGIN");
    const r = await client.query("SELECT data FROM " + TABLE + " WHERE id = $1 FOR UPDATE", [id]);
    const room = r.rows.length ? r.rows[0].data : null;

    const out = await mutate(room);

    // mutate 可能把房間改掉、也可能只是讀（例如驗證失敗提早結束）
    if(room){
      await client.query(
        "UPDATE " + TABLE + " SET data = $2, updated_at = now() WHERE id = $1",
        [id, JSON.stringify(room)]
      );
    }
    await client.query("COMMIT");
    return out;
  }catch(e){
    await client.query("ROLLBACK").catch(function(){});
    throw e;
  }finally{
    client.release();
  }
}

/* ================= JSON 檔 ================= */

let fileDb = null;
let fileChain = Promise.resolve();   // 把檔案模式的寫入排成一列，避免互相覆蓋

function fileLoad(){
  if(fileDb) return fileDb;
  try{
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fileDb = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { rooms: {} };
    if(!fileDb.rooms) fileDb.rooms = {};
  }catch(e){
    console.error("[store] 載入失敗，改用空白資料：", e.message);
    fileDb = { rooms: {} };
  }
  return fileDb;
}

function fileWrite(){
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(fileDb), "utf8");   // 先寫暫存檔再 rename，斷電也不會寫壞
  fs.renameSync(tmp, FILE);
}

/** 把工作排進佇列，前一個做完才做下一個 */
function serial(fn){
  const next = fileChain.then(fn, fn);
  fileChain = next.catch(function(){});
  return next;
}

/* ================= 對外介面 ================= */

/** 讀一個房間。回傳的是複本，改它不會動到儲存的內容。 */
async function getRoom(id){
  if(usingPg) return pgGet(id);
  const db = fileLoad();
  const r = db.rooms[id];
  return r ? JSON.parse(JSON.stringify(r)) : null;
}

/** 整包寫回去。只用在「建立新房間」這種不需要先鎖的情況。 */
async function putRoom(room){
  if(usingPg) return pgPut(room);
  return serial(function(){
    const db = fileLoad();
    db.rooms[room.id] = JSON.parse(JSON.stringify(room));
    fileWrite();
    return room;
  });
}

/**
 * 建立新房間。房號已經存在就回 false（不會覆蓋別人的房間）。
 * 用 INSERT ... ON CONFLICT DO NOTHING，「有沒有真的插進去」由資料庫判斷，
 * 不會有「先檢查再寫入」中間被別人插隊的空窗。
 */
async function insertRoom(room){
  if(usingPg){
    await init();
    const r = await getPool().query(
      "INSERT INTO " + TABLE + " (id, data, created_at) VALUES ($1, $2, $3) " +
      "ON CONFLICT (id) DO NOTHING RETURNING id",
      [room.id, JSON.stringify(room), room.createdAt || 0]
    );
    return r.rowCount > 0;
  }
  return serial(function(){
    const db = fileLoad();
    if(db.rooms[room.id]) return false;
    db.rooms[room.id] = JSON.parse(JSON.stringify(room));
    fileWrite();
    return true;
  });
}

/**
 * 鎖住 → 改 → 寫回。所有會改到房間的 API 都要走這個。
 * @param id      房號
 * @param mutate  function(room){...}，room 為 null 表示房間不存在
 * @returns mutate 的回傳值
 */
async function update(id, mutate){
  if(usingPg) return pgUpdate(id, mutate);
  return serial(async function(){
    const db = fileLoad();
    const room = db.rooms[id] || null;
    const out = await mutate(room);
    if(room){ db.rooms[id] = room; fileWrite(); }
    return out;
  });
}

/** 清掉 30 天前的房間。這個 app 的資料本來就是一次性的。 */
async function prune(){
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if(usingPg){
    await init();
    const r = await getPool().query("DELETE FROM " + TABLE + " WHERE created_at > 0 AND created_at < $1", [cutoff]);
    if(r.rowCount) console.log("[store] 清除 " + r.rowCount + " 個過期房間");
    return r.rowCount;
  }
  return serial(function(){
    const db = fileLoad();
    let n = 0;
    Object.keys(db.rooms).forEach(function(id){
      if((db.rooms[id].createdAt || 0) < cutoff){ delete db.rooms[id]; n++; }
    });
    if(n){ console.log("[store] 清除 " + n + " 個過期房間"); fileWrite(); }
    return n;
  });
}

async function count(){
  if(usingPg){
    await init();
    return Number((await getPool().query("SELECT count(*)::int AS n FROM " + TABLE)).rows[0].n);
  }
  return Object.keys(fileLoad().rooms).length;
}

/** 開機檢查：確認資料庫連得上、表建好了。連不上就丟錯，讓呼叫端決定怎麼辦。 */
async function ready(){
  await init();
  return usingPg ? "pg" : "file";
}

async function shutdown(){
  if(pool){ await pool.end().catch(function(){}); pool = null; initPromise = null; }
}

process.on("SIGTERM", function(){ shutdown().then(function(){ process.exit(0); }); });
process.on("SIGINT",  function(){ shutdown().then(function(){ process.exit(0); }); });

module.exports = {
  ready: ready,
  backendName: function(){ return usingPg ? "pg" : "file"; },
  getRoom: getRoom,
  putRoom: putRoom,
  insertRoom: insertRoom,
  update: update,
  prune: prune,
  count: count,
  shutdown: shutdown
};
