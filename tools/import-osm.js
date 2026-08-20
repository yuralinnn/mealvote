#!/usr/bin/env node
/**
 * 從 OpenStreetMap 匯入雙北餐廳。
 *
 *   node tools/import-osm.js
 *
 * 做三件事：
 *   1. 從 Overpass 撈台北捷運各站的座標
 *   2. 撈雙北範圍內所有標記為餐廳／小吃店的地點（一次撈完，不逐站查，對伺服器比較友善）
 *   3. 依座標指派最近的捷運站、判斷料理類型，寫入 data/osm-restaurants.json
 *
 * OpenStreetMap 的資料是 ODbL 授權，免費、不需要 API key、不需要綁信用卡。
 * 資料由志工維護，所以會有缺漏或過期，但量遠大於手工整理的清單。
 *
 * 參數：
 *   --radius=500      餐廳離捷運站多遠內才收（公尺，預設 500）
 *   --cafes           連咖啡廳一起收（預設不收，因為多半不是聚餐場合）
 *   --endpoint=URL    換一個 Overpass 鏡像站
 *   --out=PATH        換輸出路徑
 */

const fs = require("fs");
const path = require("path");
const mrt = require("../data/mrt");
const { buildRestaurants } = require("./osm-lib");

/* ---------- 參數 ---------- */
const argv = process.argv.slice(2);
function arg(name, dflt){
  const hit = argv.find(function(a){ return a.indexOf("--" + name + "=") === 0; });
  return hit ? hit.split("=").slice(1).join("=") : dflt;
}
const RADIUS = parseInt(arg("radius", "500"), 10);
const INCLUDE_CAFES = argv.indexOf("--cafes") >= 0;
const OUT = path.resolve(__dirname, "..", arg("out", "data/osm-restaurants.json"));

const ENDPOINTS = [
  arg("endpoint", "https://overpass-api.de/api/interpreter"),
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter"
];

// 雙北大致範圍（南、西、北、東）
const BBOX = "24.90,121.30,25.25,121.75";

/* ---------- Overpass 查詢 ---------- */
async function overpass(query, label){
  let lastErr = null;
  for(let e = 0; e < ENDPOINTS.length; e++){
    const url = ENDPOINTS[e];
    for(let attempt = 1; attempt <= 3; attempt++){
      try{
        process.stdout.write("  [" + label + "] " + new URL(url).host + " 第 " + attempt + " 次…");
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            // Overpass 要求標明用途，方便他們在被濫用時聯絡
            "User-Agent": "mealvote-import/1.0 (personal dinner-planning app)"
          },
          body: "data=" + encodeURIComponent(query)
        });

        if(res.status === 429 || res.status === 504){
          console.log(" 伺服器忙碌（" + res.status + "），等一下再試");
          await sleep(attempt * 8000);
          continue;
        }
        if(!res.ok){
          console.log(" 失敗 " + res.status);
          lastErr = new Error("HTTP " + res.status);
          break;                       // 換下一個鏡像站
        }

        const json = await res.json();
        console.log(" 取得 " + (json.elements || []).length + " 筆");
        return json.elements || [];
      }catch(err){
        console.log(" 連線錯誤：" + err.message);
        lastErr = err;
        await sleep(attempt * 4000);
      }
    }
  }
  throw new Error("三個 Overpass 站台都失敗了：" + (lastErr ? lastErr.message : "未知原因"));
}

function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

/* ---------- 1. 捷運站座標 ---------- */
const Q_STATIONS = `
[out:json][timeout:120];
(
  node["railway"="station"]["station"="subway"](${BBOX});
  node["railway"="station"]["subway"="yes"](${BBOX});
  node["public_transport"="station"]["subway"="yes"](${BBOX});
);
out body;
`;

function matchStations(elements){
  const wanted = mrt.ALL_STATIONS;
  const found = new Map();

  elements.forEach(function(el){
    const t = el.tags || {};
    const raw = t["name:zh-Hant"] || t["name:zh"] || t.name || "";
    const clean = raw.replace(/[臺]/g, "台").replace(/站$/, "").trim();
    if(!clean) return;

    let hit = wanted.indexOf(clean) >= 0 ? clean : mrt.normalizeStation(clean);
    if(!hit) return;

    // 同一站可能有多個節點（不同出入口），取第一個就好
    if(!found.has(hit)) found.set(hit, { name: hit, lat: el.lat, lon: el.lon });
  });

  return found;
}

/* ---------- 2. 餐廳 ---------- */
const Q_FOOD = `
[out:json][timeout:180];
(
  node["amenity"~"^(restaurant|fast_food${INCLUDE_CAFES ? "|cafe" : ""})$"](${BBOX});
  way["amenity"~"^(restaurant|fast_food${INCLUDE_CAFES ? "|cafe" : ""})$"](${BBOX});
);
out center tags;
`;

/* ---------- 主流程 ---------- */
(async function main(){
  console.log("從 OpenStreetMap 匯入雙北餐廳");
  console.log("範圍 " + BBOX + " · 車站半徑 " + RADIUS + " 公尺 · 咖啡廳：" + (INCLUDE_CAFES ? "收" : "不收"));
  console.log("");

  console.log("步驟 1／3　抓捷運站座標");
  const stationEls = await overpass(Q_STATIONS, "車站");
  const stationMap = matchStations(stationEls);
  const stations = Array.from(stationMap.values());
  console.log("  對上本專案的 " + stations.length + " / " + mrt.ALL_STATIONS.length + " 站");

  const missing = mrt.ALL_STATIONS.filter(function(s){ return !stationMap.has(s); });
  if(missing.length){
    console.log("  沒對到座標的站（這些站附近的店會收不到）：" + missing.join("、"));
  }
  if(stations.length < 30){
    console.log("\n對到的車站太少，可能是 OSM 標籤有變動。先中止，避免產生錯誤資料。");
    process.exit(1);
  }
  console.log("");

  console.log("步驟 2／3　抓餐廳（資料量大，可能要等 30 秒到 2 分鐘）");
  const foodEls = await overpass(Q_FOOD, "餐廳");
  console.log("");

  console.log("步驟 3／3　分類與指派車站");
  const { list, stats } = buildRestaurants(foodEls, stations, {
    radius: RADIUS, includeCafes: INCLUDE_CAFES
  });

  console.log("  原始 " + stats.total + " 筆");
  console.log("  略過：沒店名 " + stats.noName + " · 非餐廳類 " + stats.excluded +
              " · 判不出類型 " + stats.noType + " · 離車站太遠 " + stats.tooFar);
  console.log("  收錄 " + list.length + " 筆（去重後）");

  const byType = {};
  list.forEach(function(r){ byType[r.type] = (byType[r.type] || 0) + 1; });
  console.log("  類型分布：" + Object.keys(byType).sort(function(a,b){ return byType[b]-byType[a]; })
    .map(function(k){ return k + " " + byType[k]; }).join(" · "));

  const st = {};
  list.forEach(function(r){ st[r.station] = (st[r.station] || 0) + 1; });
  console.log("  涵蓋 " + Object.keys(st).length + " 站");
  console.log("  獨立小店 " + list.filter(function(r){ return !r.chain; }).length +
              " · 連鎖 " + list.filter(function(r){ return r.chain; }).length);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "OpenStreetMap contributors (ODbL)",
    radius: RADIUS,
    count: list.length,
    restaurants: list
  }, null, 1), "utf8");

  console.log("\n已寫入 " + path.relative(process.cwd(), OUT));
  console.log("重新啟動伺服器（Ctrl+C 之後再 npm start）就會生效。");
})().catch(function(e){
  console.error("\n匯入失敗：" + e.message);
  console.error("Overpass 是免費的公共服務，忙碌時常常會塞住。過幾分鐘再跑一次通常就好了。");
  process.exit(1);
});
