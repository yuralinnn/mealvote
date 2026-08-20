/**
 * OSM 匯入的純邏輯部分（分類、距離、指派車站、去重）。
 *
 * 刻意跟「連網抓資料」拆開，這樣不用真的打 Overpass 也能測這些邏輯。
 * tools/osm-lib.test.js 就是用假資料在測這一支。
 */

/* ---------- OSM cuisine → 本專案的 17 種類型 ---------- */
const CUISINE_MAP = {
  // 日式
  japanese:"japanese", donburi:"japanese", teppanyaki:"japanese", tonkatsu:"japanese",
  curry:"japanese", japanese_curry:"japanese", udon:"japanese", soba:"japanese",
  okonomiyaki:"japanese", tempura:"japanese", oden:"japanese",
  // 拉麵
  ramen:"ramen", noodle_ramen:"ramen",
  // 壽司
  sushi:"sushi", sashimi:"sushi", seafood:"sushi", fish:"sushi",
  // 韓式
  korean:"korean", korean_bbq:"korean", bibimbap:"korean",
  // 火鍋
  hot_pot:"hotpot", hotpot:"hotpot", shabu_shabu:"hotpot", sukiyaki:"hotpot", steamboat:"hotpot",
  // 燒肉燒烤
  barbecue:"bbq", bbq:"bbq", grill:"bbq", yakiniku:"bbq", yakitori:"bbq", skewer:"bbq",
  // 台菜熱炒
  taiwanese:"taiwanese", chinese:"taiwanese", asian:"taiwanese", regional:"taiwanese",
  local:"taiwanese", stir_fry:"taiwanese",
  // 川菜
  sichuan:"sichuan", szechuan:"sichuan", hunan:"sichuan", spicy:"sichuan", mala:"sichuan",
  // 港式粵菜
  cantonese:"canto", dim_sum:"canto", hong_kong:"canto", roast_duck:"canto",
  // 義式西餐
  italian:"italian", pizza:"italian", pasta:"italian", french:"italian",
  spanish:"italian", mediterranean:"italian", european:"italian", international:"italian",
  // 美式牛排
  american:"american", burger:"american", steak:"american", steak_house:"american",
  fried_chicken:"american", sandwich:"american", mexican:"american",
  hot_dog:"american", diner:"american",
  // 泰式南洋
  thai:"thai", vietnamese:"thai", indonesian:"thai", malaysian:"thai", singaporean:"thai",
  filipino:"thai", indian:"thai", pho:"thai", southeast_asian:"thai",
  // 居酒屋
  izakaya:"izakaya", pub:"izakaya", bar:"izakaya", beer:"izakaya", tapas:"izakaya",
  // 早午餐輕食
  breakfast:"brunch", brunch:"brunch", cafe:"brunch", coffee_shop:"brunch",
  bakery:"brunch", sandwich_shop:"brunch", toast:"brunch", bagel:"brunch", salad:"brunch",
  soy_milk:"brunch",
  // 素食
  vegetarian:"veggie", vegan:"veggie", buddhist:"veggie",
  // 小吃麵食
  // 台北街邊店最大的一類。dumpling（水餃）、rice（滷肉飯／雞肉飯）、bento（便當）
  // 在台灣語境下都是小吃，不是港點或日式，所以放在這裡。
  noodle:"noodle", noodles:"noodle", beef_noodle:"noodle", wonton:"noodle",
  street_food:"noodle", snack:"noodle", lu_rou_fan:"noodle", braised:"noodle",
  porridge:"noodle", soup:"noodle", fast_food:"noodle",
  dumpling:"noodle", dumplings:"noodle", rice:"noodle", bento:"noodle",
  gua_bao:"noodle", oyster:"noodle", meatball:"noodle", tofu:"noodle",
  // 吃到飽
  buffet:"buffet", all_you_can_eat:"buffet"
};

/** 有些店沒有 cuisine 標籤，只好從店名猜 */
const NAME_HINTS = [
  [/拉麵|らーめん|ラーメン|ramen/i, "ramen"],
  [/壽司|寿司|sushi|生魚片|刺身|海鮮丼/i, "sushi"],
  [/燒肉|烧肉|炭烤|串燒|燒烤|yakiniku/i, "bbq"],
  [/火鍋|鍋物|涮涮|麻辣鍋|石頭火鍋|shabu/i, "hotpot"],
  [/韓|韩式|韓式|石鍋|部隊鍋|烤肉店|kimchi|korean/i, "korean"],
  [/居酒屋|串道|燒鳥|izakaya|酒場/i, "izakaya"],
  // 台灣街邊小吃的關鍵字盡量鋪滿 —— 這一類在 OSM 上最常沒有 cuisine 標籤，
  // 全靠店名判斷，漏掉就會整批被丟掉。
  [/牛肉麵|麵館|麵店|麵食|意麵|陽春麵|擔仔麵|切仔麵|拌麵|乾麵|麵攤|麵線/i, "noodle"],
  [/米粉|米線|米苔目|米糕|油飯|粿|碗粿|肉圓|肉羹|肉粥|魷魚羹|羹麵|焿/i, "noodle"],
  [/水餃|鍋貼|蒸餃|餛飩|抄手|小籠包|生煎|湯包|包子|饅頭/i, "noodle"],
  [/滷肉飯|魯肉飯|雞肉飯|火雞肉飯|排骨飯|焢肉飯|便當|自助餐|快餐|簡餐|飯館|飯店小吃/i, "noodle"],
  [/割包|刈包|蚵仔|臭豆腐|滷味|鹹酥雞|甜不辣|黑白切|四神湯|豬血糕|大腸|粥品|清粥/i, "noodle"],
  [/小吃|夜市|老店|攤|食堂部|小館/i, "noodle"],
  [/咖啡|coffee|cafe|早餐|早午餐|brunch|吐司|三明治|貝果|bakery|烘焙|豆漿|燒餅|油條|飯糰|蛋餅/i, "brunch"],
  [/素食|蔬食|養生|齋|vegan|vegetarian/i, "veggie"],
  [/披薩|pizza|義大利|意大利|pasta|義式|西餐|bistro|trattoria/i, "italian"],
  [/漢堡|burger|牛排|steak|美式|diner|炸雞/i, "american"],
  [/泰|越南|河粉|南洋|叻沙|thai|pho|vietnam/i, "thai"],
  [/港式|茶餐廳|飲茶|point|燒臘|粵|叉燒|港點/i, "canto"],
  [/川|麻辣|重慶|成都|水煮/i, "sichuan"],
  [/吃到飽|buffet|自助百匯|放題/i, "buffet"],
  [/丼|定食|日本|日式|居食屋|天婦羅|豬排|咖哩|和食/i, "japanese"],
  [/熱炒|快炒|台菜|海產|合菜|客家|活蝦|羊肉爐|薑母鴨/i, "taiwanese"]
];

/** 明顯不是「聚餐餐廳」的，直接濾掉 */
const EXCLUDE_NAME = /手搖|飲料|茶飲|珍珠奶茶|清心|50嵐|CoCo都可|五十嵐|麥當勞|肯德基|摩斯漢堡|7-ELEVEN|全家|萊爾富|OK超商|超商|便利商店|加油站|藥局|超市|全聯|家樂福|美廉社|冰淇淋|霜淇淋|雞蛋糕|雞排店/i;

function classify(tags){
  const cuisines = String(tags.cuisine || "").toLowerCase().split(/[;,]/).map(function(s){ return s.trim(); });
  for(let i = 0; i < cuisines.length; i++){
    const c = cuisines[i];
    if(CUISINE_MAP[c]) return CUISINE_MAP[c];
  }
  const name = pickName(tags) || "";
  for(let i = 0; i < NAME_HINTS.length; i++){
    if(NAME_HINTS[i][0].test(name)) return NAME_HINTS[i][1];
  }
  // 真的看不出來就歸到小吃麵食，這是台北街邊店最大的那一類
  return tags.amenity === "fast_food" ? "noodle" : null;
}

/** 優先取中文店名 */
function pickName(tags){
  return tags["name:zh-Hant"] || tags["name:zh"] || tags["name:zh_TW"] || tags.name || tags["name:en"] || null;
}

/** 兩點球面距離（公尺） */
function haversine(lat1, lon1, lat2, lon2){
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(lat1*rad) * Math.cos(lat2*rad) * Math.sin(dLon/2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** 找最近的捷運站；超過 radius 就回 null */
function nearestStation(lat, lon, stations, radius){
  let best = null;
  for(let i = 0; i < stations.length; i++){
    const s = stations[i];
    const d = haversine(lat, lon, s.lat, s.lon);
    if(d <= radius && (!best || d < best.dist)) best = { name: s.name, dist: d };
  }
  return best;
}

/**
 * 把 Overpass 回來的元素整理成本專案的餐廳格式。
 * @param elements Overpass elements（node 或帶 center 的 way）
 * @param stations [{name, lat, lon}]
 * @param opts {radius, includeCafes}
 */
function buildRestaurants(elements, stations, opts){
  opts = opts || {};
  const radius = opts.radius || 500;
  const allowed = { restaurant: 1, fast_food: 1 };
  if(opts.includeCafes) allowed.cafe = 1;

  const out = [];
  const stats = { total: elements.length, noName: 0, excluded: 0, noType: 0, tooFar: 0, kept: 0 };

  elements.forEach(function(el){
    const tags = el.tags || {};
    if(!allowed[tags.amenity]) return;

    const name = pickName(tags);
    if(!name || name.length > 30){ stats.noName++; return; }
    if(EXCLUDE_NAME.test(name)){ stats.excluded++; return; }

    const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
    const lon = el.lon != null ? el.lon : (el.center && el.center.lon);
    if(lat == null || lon == null){ stats.noName++; return; }

    const type = classify(tags);
    if(!type){ stats.noType++; return; }

    const near = nearestStation(lat, lon, stations, radius);
    if(!near){ stats.tooFar++; return; }

    out.push({
      name: name.trim(),
      type: type,
      price: null,
      station: near.name,
      dist: near.dist,
      hours: tags["opening_hours"] || null,
      book: false,
      source: "osm",
      osmId: el.type + "/" + el.id
    });
    stats.kept++;
  });

  return { list: dedupe(out), stats: stats };
}

/**
 * 同名同站只留最近的一家，但會把另一筆的營業時間補進來
 * —— OSM 常有同一家店被標成好幾個節點，各自帶著不同的欄位。
 * 同名跨 3 站以上視為連鎖。
 */
function dedupe(list){
  const byKey = new Map();
  list.forEach(function(r){
    const k = r.name + "@" + r.station;
    const prev = byKey.get(k);
    if(!prev){ byKey.set(k, Object.assign({}, r)); return; }
    // 留近的那筆的座標與距離，但欄位取兩者的聯集
    const keep = r.dist < prev.dist ? Object.assign({}, r) : prev;
    const other = r.dist < prev.dist ? prev : r;
    if(!keep.hours && other.hours) keep.hours = other.hours;
    byKey.set(k, keep);
  });

  const kept = Array.from(byKey.values());

  // 距離改由 dist 欄位帶，畫面上會換算成步行時間，所以備註只留營業時間
  kept.forEach(function(r){
    r.note = r.hours ? "營業時間 " + r.hours : "";
  });

  const stationCount = {};
  kept.forEach(function(r){
    if(!stationCount[r.name]) stationCount[r.name] = new Set();
    stationCount[r.name].add(r.station);
  });

  kept.forEach(function(r){ r.chain = stationCount[r.name].size >= 3; });

  return kept.sort(function(a, b){
    return a.station.localeCompare(b.station) || a.dist - b.dist;
  });
}

module.exports = { classify, pickName, haversine, nearestStation, buildRestaurants, dedupe, CUISINE_MAP, NAME_HINTS };
