/**
 * 離線測試 OSM 匯入邏輯。
 *
 *   node tools/osm-lib.test.js
 *
 * 用假的 Overpass 回應來驗分類、最近車站指派、去重、連鎖判定，
 * 不需要連網。真正跑 import-osm.js 之前先跑這支，可以先排除程式的問題。
 */
const { classify, pickName, haversine, nearestStation, buildRestaurants } = require("./osm-lib");

let pass = 0, fail = 0;
function ok(cond, label, extra){
  if(cond){ pass++; console.log("  ✓ " + label); }
  else{ fail++; console.log("  ✗ " + label + (extra ? "　→ " + extra : "")); }
}
function eq(a, b, label){ ok(a === b, label, "得到 " + JSON.stringify(a) + "，預期 " + JSON.stringify(b)); }

/* 幾個真實車站的座標（用來當測試基準） */
const STATIONS = [
  { name: "忠孝復興", lat: 25.041708, lon: 121.543563 },
  { name: "市政府",   lat: 25.041171, lon: 121.567780 },
  { name: "中山",     lat: 25.052780, lon: 121.520277 },
  { name: "公館",     lat: 25.014649, lon: 121.534559 }
];

console.log("\n── 料理類型分類 ──");
eq(classify({ amenity:"restaurant", cuisine:"ramen", name:"某拉麵店" }), "ramen", "cuisine=ramen → 拉麵");
eq(classify({ amenity:"restaurant", cuisine:"sushi", name:"X" }), "sushi", "cuisine=sushi → 壽司");
eq(classify({ amenity:"restaurant", cuisine:"hot_pot", name:"X" }), "hotpot", "cuisine=hot_pot → 火鍋");
eq(classify({ amenity:"restaurant", cuisine:"japanese;sushi", name:"X" }), "japanese", "多個 cuisine 取第一個對得上的");
eq(classify({ amenity:"restaurant", cuisine:"unknown_thing", name:"阿婆牛肉麵" }), "noodle", "cuisine 認不得 → 用店名猜");
eq(classify({ amenity:"restaurant", name:"老張燒肉專門店" }), "bbq", "沒 cuisine，店名有「燒肉」");
eq(classify({ amenity:"restaurant", name:"永和豆漿大王" }), "brunch", "豆漿店 → 早午餐");
eq(classify({ amenity:"restaurant", name:"Zhang's Place" }), null, "完全猜不出來的 restaurant → null（會被略過）");
eq(classify({ amenity:"fast_food", name:"隨便什麼店" }), "noodle", "fast_food 猜不出來 → 歸小吃麵食");
eq(classify({ amenity:"restaurant", name:"金蓬萊遵古台菜" }), "taiwanese", "店名有「台菜」");
eq(classify({ amenity:"restaurant", cuisine:"vietnamese", name:"X" }), "thai", "越南菜歸到泰式南洋");

console.log("\n── 台灣街邊小吃的判斷 ──");
// 這一類在 OSM 上最常沒有 cuisine 標籤，全靠店名判斷，所以測厚一點
[["阿婆臭豆腐","noodle"],["老張蚵仔煎","noodle"],["三重肉圓","noodle"],
 ["林家乾麵","noodle"],["陳記排骨飯","noodle"],["李記火雞肉飯","noodle"],
 ["王記鹹酥雞","noodle"],["老王刈包","noodle"],["黃記滷味","noodle"],
 ["阿宗麵線","noodle"],["周記肉粥","noodle"],["某某小籠包","noodle"],
 ["林記米糕","noodle"],["張家碗粿","noodle"],["永樂米粉湯","noodle"],
 ["高記生煎包","noodle"],["劉媽媽飯糰","brunch"],["世界豆漿大王","brunch"]
].forEach(function(c){ eq(classify({ amenity:"restaurant", name:c[0] }), c[1], c[0] + " → " + c[1]); });

console.log("\n── 台灣語境下容易分錯的標籤 ──");
eq(classify({ amenity:"restaurant", cuisine:"rice", name:"X" }), "noodle", "cuisine=rice（滷肉飯類）→ 小吃，不是台菜");
eq(classify({ amenity:"restaurant", cuisine:"dumpling", name:"X" }), "noodle", "cuisine=dumpling（水餃）→ 小吃，不是港點");
eq(classify({ amenity:"restaurant", cuisine:"bento", name:"X" }), "noodle", "cuisine=bento（便當）→ 小吃，不是日式");
eq(classify({ amenity:"restaurant", cuisine:"dim_sum", name:"X" }), "canto", "cuisine=dim_sum 仍是港式");
eq(classify({ amenity:"restaurant", cuisine:"chicken", name:"嘉義雞肉飯" }), "noodle", "cuisine=chicken 已移除，改由店名判斷");
eq(classify({ amenity:"restaurant", cuisine:"fried_chicken", name:"X" }), "american", "炸雞仍歸美式");
eq(classify({ amenity:"restaurant", cuisine:"taiwanese", name:"海產快炒" }), "taiwanese", "台菜熱炒不受影響");

console.log("\n── 店名取用 ──");
eq(pickName({ name:"Din Tai Fung", "name:zh-Hant":"鼎泰豐" }), "鼎泰豐", "優先取繁體中文名");
eq(pickName({ name:"Some Place" }), "Some Place", "只有英文名就用英文名");
eq(pickName({}), null, "沒名字回 null");

console.log("\n── 距離計算 ──");
const d = haversine(25.041708, 121.543563, 25.041171, 121.567780);
ok(d > 2300 && d < 2600, "忠孝復興↔市政府 直線約 2.4 公里", d + " 公尺");
eq(haversine(25.04, 121.54, 25.04, 121.54), 0, "同一點距離 0");

console.log("\n── 最近車站指派 ──");
const near = nearestStation(25.0420, 121.5440, STATIONS, 500);
eq(near && near.name, "忠孝復興", "站旁邊的點指到忠孝復興");
ok(nearestStation(25.0420, 121.5440, STATIONS, 500).dist < 100, "距離算出來在 100 公尺內");
eq(nearestStation(24.95, 121.20, STATIONS, 500), null, "離所有站都太遠 → null");

console.log("\n── 整批轉換 ──");
const ELEMENTS = [
  // 忠孝復興旁邊的獨立小店
  { type:"node", id:1, lat:25.0420, lon:121.5440, tags:{ amenity:"restaurant", cuisine:"ramen", name:"巷口拉麵", opening_hours:"11:00-21:00" } },
  // way 型態（用 center 取座標）
  { type:"way", id:2, center:{ lat:25.0415, lon:121.5430 }, tags:{ amenity:"restaurant", cuisine:"korean", name:"韓식堂" } },
  // 沒有名字 → 略過
  { type:"node", id:3, lat:25.0418, lon:121.5436, tags:{ amenity:"restaurant", cuisine:"thai" } },
  // 手搖飲 → 略過
  { type:"node", id:4, lat:25.0418, lon:121.5436, tags:{ amenity:"fast_food", name:"50嵐" } },
  // 便利商店 → 略過
  { type:"node", id:5, lat:25.0418, lon:121.5436, tags:{ amenity:"fast_food", name:"7-ELEVEN 忠孝門市" } },
  // 離所有車站太遠 → 略過
  { type:"node", id:6, lat:24.9500, lon:121.2000, tags:{ amenity:"restaurant", cuisine:"italian", name:"山上的餐廳" } },
  // 不是餐廳類的 amenity → 略過
  { type:"node", id:7, lat:25.0418, lon:121.5436, tags:{ amenity:"pharmacy", name:"某藥局" } },
  // 同名同站，較遠的那筆要被去掉
  { type:"node", id:8, lat:25.0419, lon:121.5437, tags:{ amenity:"restaurant", cuisine:"ramen", name:"巷口拉麵" } },
  // 跨三站的同名店 → 判定為連鎖
  { type:"node", id:9,  lat:25.0417, lon:121.5436, tags:{ amenity:"restaurant", cuisine:"japanese", name:"多分店食堂" } },
  { type:"node", id:10, lat:25.0412, lon:121.5678, tags:{ amenity:"restaurant", cuisine:"japanese", name:"多分店食堂" } },
  { type:"node", id:11, lat:25.0528, lon:121.5203, tags:{ amenity:"restaurant", cuisine:"japanese", name:"多分店食堂" } },
  // 只有兩站的同名店 → 不算連鎖
  { type:"node", id:12, lat:25.0146, lon:121.5346, tags:{ amenity:"restaurant", cuisine:"thai", name:"兩家小店" } },
  { type:"node", id:13, lat:25.0528, lon:121.5204, tags:{ amenity:"restaurant", cuisine:"thai", name:"兩家小店" } }
];

const { list, stats } = buildRestaurants(ELEMENTS, STATIONS, { radius: 500 });

eq(stats.total, 13, "原始筆數 13");
ok(stats.excluded >= 2, "手搖與超商被排除", "excluded=" + stats.excluded);
eq(stats.tooFar, 1, "1 筆離車站太遠");

const names = list.map(function(r){ return r.name + "@" + r.station; });
console.log("  收錄：" + names.join("、"));

eq(list.filter(function(r){ return r.name === "巷口拉麵"; }).length, 1, "同名同站去重後只剩 1 筆");
const ramen = list.find(function(r){ return r.name === "巷口拉麵"; });
eq(ramen.station, "忠孝復興", "巷口拉麵指到忠孝復興");
eq(ramen.type, "ramen", "巷口拉麵歸類為拉麵");
eq(ramen.price, null, "OSM 沒有價位資料，price 為 null");
ok(typeof ramen.dist === "number" && ramen.dist > 0 && ramen.dist < 500,
   "有算出離車站幾公尺（畫面上會換算成步行時間）", "dist=" + ramen.dist);
ok(ramen.note.indexOf("11:00-21:00") >= 0, "營業時間有帶進備註");
ok(ramen.note.indexOf("公尺") < 0, "備註不再重複寫距離（已改由 dist 欄位帶）", ramen.note);
eq(ramen.source, "osm", "來源標記為 osm");

const multi = list.filter(function(r){ return r.name === "多分店食堂"; });
eq(multi.length, 3, "多分店食堂有 3 個站");
ok(multi.every(function(r){ return r.chain === true; }), "跨 3 站 → 判定為連鎖");

const two = list.filter(function(r){ return r.name === "兩家小店"; });
eq(two.length, 2, "兩家小店有 2 個站");
ok(two.every(function(r){ return r.chain === false; }), "只跨 2 站 → 不算連鎖");

ok(!list.some(function(r){ return r.name === "某藥局"; }), "藥局沒有被收進來");
ok(!list.some(function(r){ return /50嵐|7-ELEVEN/.test(r.name); }), "手搖與超商沒有被收進來");

console.log("\n── 與正式資料格式相容 ──");
const { TYPES } = require("../data/restaurants");
ok(list.every(function(r){ return TYPES.some(function(t){ return t.id === r.type; }); }),
   "所有類型都對得上 TYPES 定義");
ok(list.every(function(r){ return r.name && r.station && r.type; }), "必要欄位都在");

console.log("\n" + (fail === 0
  ? "全部 " + pass + " 項通過 ✅"
  : pass + " 通過、" + fail + " 失敗 ❌"));
process.exit(fail === 0 ? 0 : 1);
