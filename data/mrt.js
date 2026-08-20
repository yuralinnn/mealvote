/**
 * 台北捷運路網（雙北）
 * 每條線以「站點順序陣列」表示，相鄰兩站 = 1 站距離。
 * 同名車站自動視為轉乘點（不額外計算站數，但會記錄換乘次數）。
 * 資料來源：維基百科各路線條目、台北捷運官網、新北大眾捷運。
 */

const LINES = [
  {
    id: "BR", name: "文湖線", color: "#B57A25",
    stations: ["動物園","木柵","萬芳社區","萬芳醫院","辛亥","麟光","六張犁","科技大樓","大安","忠孝復興","南京復興","中山國中","松山機場","大直","劍南路","西湖","港墘","文德","內湖","大湖公園","葫洲","東湖","南港軟體園區","南港展覽館"]
  },
  {
    id: "R", name: "淡水信義線", color: "#D90023",
    stations: ["淡水","紅樹林","竹圍","關渡","忠義","復興崗","北投","奇岩","唭哩岸","石牌","明德","芝山","士林","劍潭","圓山","民權西路","雙連","中山","台北車站","台大醫院","中正紀念堂","東門","大安森林公園","大安","信義安和","台北101/世貿","象山"]
  },
  {
    id: "R-b", name: "新北投支線", color: "#D90023",
    stations: ["北投","新北投"]
  },
  {
    id: "G", name: "松山新店線", color: "#107B41",
    stations: ["松山","南京三民","台北小巨蛋","南京復興","松江南京","中山","北門","西門","小南門","中正紀念堂","古亭","台電大樓","公館","萬隆","景美","大坪林","七張","新店區公所","新店"]
  },
  {
    id: "G-b", name: "小碧潭支線", color: "#107B41",
    stations: ["七張","小碧潭"]
  },
  {
    id: "O", name: "中和新蘆線", color: "#F5A302",
    stations: ["南勢角","景安","永安市場","頂溪","古亭","東門","忠孝新生","松江南京","行天宮","中山國小","民權西路","大橋頭"]
  },
  {
    id: "O-h", name: "中和新蘆線（迴龍）", color: "#F5A302",
    stations: ["大橋頭","台北橋","菜寮","三重","先嗇宮","頭前庄","新莊","輔大","丹鳳","迴龍"]
  },
  {
    id: "O-l", name: "中和新蘆線（蘆洲）", color: "#F5A302",
    stations: ["大橋頭","三重國小","三和國中","徐匯中學","三民高中","蘆洲"]
  },
  {
    id: "BL", name: "板南線", color: "#0070BD",
    stations: ["頂埔","永寧","土城","海山","亞東醫院","府中","板橋","新埔","江子翠","龍山寺","西門","台北車站","善導寺","忠孝新生","忠孝復興","忠孝敦化","國父紀念館","市政府","永春","後山埤","昆陽","南港","南港展覽館"]
  },
  {
    id: "Y", name: "環狀線", color: "#FFDB00",
    stations: ["大坪林","十四張","秀朗橋","景平","景安","中和","橋和","中原","板新","板橋","新埔民生","頭前庄","幸福","新北產業園區"]
  },
  // 以下兩條是新北捷運的輕軌，不屬於台北捷運本體，但同屬雙北路網、也能轉乘，
  // 所以一起收進來。紅樹林與十四張是它們跟捷運的轉乘點。
  {
    id: "V", name: "淡海輕軌綠山線", color: "#96C954", lrt: true,
    stations: ["紅樹林","竿蓁林","淡金鄧公","淡江大學","淡金北新","新市一路","淡水行政中心","濱海義山","濱海沙崙","淡海新市鎮","崁頂"]
  },
  {
    id: "V-b", name: "淡海輕軌藍海線", color: "#5BB3D9", lrt: true,
    stations: ["濱海沙崙","台北海洋科技大學","沙崙","淡水漁人碼頭"]
  },
  {
    id: "K", name: "安坑輕軌", color: "#7ECBC4", lrt: true,
    stations: ["雙城","玫瑰中國城","台北小城","耕莘安康院區","景文科大","安康","陽光運動公園","新和國小","十四張"]
  }
];

/** 站名不同但實際可步行轉乘，成本以 1 站計 */
const WALK_LINKS = [
  ["新埔民生", "新埔", 1]
];

/** 常見別名 → 正式站名 */
const ALIASES = {
  "臺北車站":"台北車站","北車":"台北車站","台北":"台北車站","主車站":"台北車站",
  "101":"台北101/世貿","世貿":"台北101/世貿","台北101":"台北101/世貿","象山101":"台北101/世貿",
  "小巨蛋":"台北小巨蛋","巨蛋":"台北小巨蛋",
  "中紀":"中正紀念堂","國館":"國父紀念館","國紀":"國父紀念館",
  "台電":"台電大樓","北科大":"忠孝新生","師大":"古亭","台大":"公館",
  "SOGO":"忠孝復興","東區":"忠孝復興","信義區":"市政府","市府":"市政府",
  "新板":"板橋","板橋車站":"板橋","新莊副都心":"新北產業園區",
  "漁人碼頭":"淡水漁人碼頭","海洋大學":"台北海洋科技大學","台北海洋大學":"台北海洋科技大學",
  "淡江":"淡江大學","景文":"景文科大"
};

/* ---------- 建圖 ---------- */
function buildGraph(){
  const adj = new Map();          // 站名 -> Map(鄰站 -> {cost, line})
  const stationLines = new Map(); // 站名 -> Set(路線 id)

  function ensure(s){ if(!adj.has(s)) adj.set(s, new Map()); return adj.get(s); }
  function link(a, b, cost, line){
    const A = ensure(a), B = ensure(b);
    if(!A.has(b) || A.get(b).cost > cost) A.set(b, {cost, line});
    if(!B.has(a) || B.get(a).cost > cost) B.set(a, {cost, line});
  }

  LINES.forEach(function(L){
    L.stations.forEach(function(s, i){
      ensure(s);
      if(!stationLines.has(s)) stationLines.set(s, new Set());
      stationLines.get(s).add(L.id);
      if(i > 0) link(L.stations[i-1], s, 1, L.id);
    });
  });

  WALK_LINKS.forEach(function(w){ link(w[0], w[1], w[2], "walk"); });

  return { adj, stationLines };
}

const GRAPH = buildGraph();

// 供比對用：全部站名（排序過，順序不具意義）
const ALL_STATIONS = Array.from(GRAPH.adj.keys()).sort();

// 供前端選單用：依路線分組，站序照官方路線圖由起點到終點
const STATIONS_BY_LINE = LINES.map(function(L){
  return { id: L.id, name: L.name, color: L.color, lrt: !!L.lrt, stations: L.stations.slice() };
});

function normalizeStation(name){
  if(!name) return null;
  let s = String(name).trim().replace(/[站臺]/g, function(m){ return m === "臺" ? "台" : ""; });
  if(GRAPH.adj.has(s)) return s;
  if(ALIASES[s]) return ALIASES[s];
  const raw = String(name).trim();
  if(GRAPH.adj.has(raw)) return raw;
  if(ALIASES[raw]) return ALIASES[raw];
  // 模糊比對：包含關係
  const hit = ALL_STATIONS.find(function(x){ return x.indexOf(s) >= 0 || s.indexOf(x) >= 0; });
  return hit || null;
}

/**
 * 最短路徑，字典序最佳化：先讓「站數」最少，站數相同時再挑「換乘次數」最少的走法。
 *
 * 這樣做是為了跟使用者填的「最遠可接受幾站」保持一致 —— 篩選與顯示用的
 * 是同一個數字，不會出現「明明有 4 站的走法卻顯示 5 站」這種矛盾。
 * 實作上把成本編碼成 站數 × STATION_WEIGHT + 換乘數，換乘只用來打平手。
 */
const STATION_WEIGHT = 100;
const _cache = new Map();

function distance(from, to){
  const a = normalizeStation(from), b = normalizeStation(to);
  if(!a || !b) return null;
  if(a === b) return { stations: 0, transfers: 0, path: [a] };

  const key = a + " " + b;
  if(_cache.has(key)) return _cache.get(key);

  const best = new Map();   // "站名|路線" -> 排序成本
  const meta = new Map();   // "站名|路線" -> {station, stations, transfers, prev}
  const visited = new Set();
  const pq = [];

  function push(station, line, cost, stations, transfers, prevKey){
    const k = station + "|" + line;
    if(best.has(k) && best.get(k) <= cost) return;
    best.set(k, cost);
    meta.set(k, { station: station, stations: stations, transfers: transfers, prev: prevKey });
    pq.push([cost, k, station, line]);
  }

  push(a, "*", 0, 0, 0, null);
  let goalKey = null;

  while(pq.length){
    pq.sort(function(x, y){ return x[0] - y[0]; });
    const cur = pq.shift();
    const cost = cur[0], k = cur[1], u = cur[2], line = cur[3];
    if(visited.has(k)) continue;
    visited.add(k);
    if(best.get(k) < cost) continue;
    if(u === b){ goalKey = k; break; }

    const nbrs = GRAPH.adj.get(u);
    if(!nbrs) continue;
    const m = meta.get(k);
    nbrs.forEach(function(info, v){
      const changed = (line !== "*" && info.line !== line);
      const nCost = cost + info.cost * STATION_WEIGHT + (changed ? 1 : 0);
      push(v, info.line, nCost, m.stations + info.cost, m.transfers + (changed ? 1 : 0), k);
    });
  }

  if(!goalKey){ _cache.set(key, null); return null; }

  const path = [];
  let k = goalKey;
  while(k){ const m = meta.get(k); path.unshift(m.station); k = m.prev; }

  const g = meta.get(goalKey);
  const res = { stations: g.stations, transfers: g.transfers, path: path };
  _cache.set(key, res);
  return res;
}

module.exports = { LINES, ALL_STATIONS, STATIONS_BY_LINE, ALIASES, normalizeStation, distance };
