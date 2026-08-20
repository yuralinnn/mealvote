const mrt = require("../data/mrt");
const { RESTAURANTS, TYPES } = require("../data/restaurants");

const TYPE_MAP = {};
TYPES.forEach(function(t){ TYPE_MAP[t.id] = t; });

/**
 * 對單一餐廳，逐一評估每位成員是否吃得到。
 * 回傳每個人的站數、換乘、是否超出可接受站數、是不是他想吃的類型。
 */
function evaluate(restaurant, members){
  const per = members.map(function(m){
    const d = mrt.distance(m.station, restaurant.station);
    const stations = d ? d.stations : null;
    const transfers = d ? d.transfers : null;
    const okDist = stations !== null && stations <= m.maxStations;
    const okType = Array.isArray(m.types) && m.types.indexOf(restaurant.type) >= 0;
    return {
      memberId: m.id, name: m.name,
      stations: stations, transfers: transfers,
      okDist: okDist, okType: okType,
      over: stations === null ? null : Math.max(0, stations - m.maxStations)
    };
  });

  const dists = per.map(function(p){ return p.stations === null ? 999 : p.stations; });
  return {
    per: per,
    nDist:   per.filter(function(p){ return p.okDist; }).length,
    nType:   per.filter(function(p){ return p.okType; }).length,
    nAll:    per.filter(function(p){ return p.okDist; }).length,
    maxStations: Math.max.apply(null, dists),
    avgStations: dists.reduce(function(a,b){ return a+b; }, 0) / dists.length,
    totalStations: dists.reduce(function(a,b){ return a+b; }, 0)
  };
}

/** 同一個品牌只留最好的那家分店 */
function dedupeByName(list){
  const seen = new Set();
  return list.filter(function(x){
    if(seen.has(x.restaurant.name)) return false;
    seen.add(x.restaurant.name);
    return true;
  });
}

/**
 * 共識區的挑選：照排序走一遍，同時遵守「每種類型最多幾家」與「每一站最多幾家」，
 * 直到湊滿想要的數量為止。
 *
 * 不用「先 cap 類型再 cap 車站」串接，是因為那樣兩層會互相削減 —— 
 * 第一層留下的剛好集中在同一站，第二層砍完就湊不滿數量了。
 * 一次走完並邊走邊檢查，才能既分散又補滿。
 */
function pickDiverse(list, want, perType, perStation){
  const byType = {}, byStation = {};
  const out = [];
  for(let i = 0; i < list.length && out.length < want; i++){
    const x = list[i];
    const t = x.restaurant.type, st = x.restaurant.station;
    if((byType[t] || 0) >= perType) continue;
    if((byStation[st] || 0) >= perStation) continue;
    byType[t] = (byType[t] || 0) + 1;
    byStation[st] = (byStation[st] || 0) + 1;
    out.push(x);
  }
  return out;
}

/**
 * 排序原則（依序）：
 *  1. 幾個人在可接受的站數內 —— 多數決
 *  2. 走最遠的那個人要走幾站 —— 公平性，不要有人特別犧牲
 *  3. 全體平均站數
 *  4. 個人小店優先於連鎖店 —— 不然畫面上永遠是那幾個連鎖品牌
 *  5. 精選清單優先於 OSM —— 精選的有價位、特色說明與訂位提示，資訊完整得多
 *  6. 有寫價位的優先於沒寫的
 */
function rank(a, b){
  if(b.ev.nAll !== a.ev.nAll) return b.ev.nAll - a.ev.nAll;
  if(a.ev.maxStations !== b.ev.maxStations) return a.ev.maxStations - b.ev.maxStations;

  // 平均站數取整數再比。差 0.3 站在現實中感覺不出來，
  // 不該讓這種差距壓過「個人小店優先」——不然連鎖品牌分店多，
  // 總有一家剛好近一點點，畫面上就永遠是那幾個連鎖。
  const aAvg = Math.round(a.ev.avgStations), bAvg = Math.round(b.ev.avgStations);
  if(aAvg !== bAvg) return aAvg - bAvg;

  const ac = a.restaurant.chain ? 1 : 0, bc = b.restaurant.chain ? 1 : 0;
  if(ac !== bc) return ac - bc;

  const as = a.restaurant.source === "curated" ? 0 : 1;
  const bs = b.restaurant.source === "curated" ? 0 : 1;
  if(as !== bs) return as - bs;

  if(a.ev.avgStations !== b.ev.avgStations) return a.ev.avgStations - b.ev.avgStations;
  const ap = a.restaurant.price ? 0 : 1, bp = b.restaurant.price ? 0 : 1;
  if(ap !== bp) return ap - bp;
  return (a.restaurant.price || 9999) - (b.restaurant.price || 9999);
}

function recommend(members){
  if(!members.length) return { consensus: [], byType: [], warnings: [], noOverlap: false };

  const n = members.length;
  const warnings = [];

  const scored = RESTAURANTS.map(function(r){
    return { restaurant: r, ev: evaluate(r, members) };
  });

  /* ---------- 1. 硬條件：所有人的站數都要符合 ---------- */
  // 站數不符的直接不出現，不再「放寬讓某人多坐幾站」。
  // 與其推薦一家有人到不了的店，不如老實說配不出來、請大家放寬條件。
  const eligible = scored.filter(function(x){ return x.ev.nAll === n; });

  if(!eligible.length){
    // 找出是誰卡住的，講清楚比只說「找不到」有用
    const tight = members.slice().sort(function(a, b){ return a.maxStations - b.maxStations; })[0];
    warnings.push("在「每個人都到得了」的條件下配不出任何餐廳。" +
      "目前限制最緊的是 " + tight.name + "（" + tight.station + "站 " + tight.maxStations + " 站內），" +
      "請至少一個人把可接受的站數放寬。");
    return { consensus: [], byType: [], warnings: warnings, noOverlap: false };
  }

  /* ---------- 2. 統計每種類型有幾個人選 ---------- */
  const typeVoters = {};
  members.forEach(function(m){
    (m.types || []).forEach(function(t){
      if(!typeVoters[t]) typeVoters[t] = [];
      typeVoters[t].push(m.name);
    });
  });

  function decorate(x, t, bucket){
    return Object.assign({}, x, {
      bucket: bucket,
      typeId: t,
      typeLabel: TYPE_MAP[t] ? TYPE_MAP[t].label : t,
      typeEmoji: TYPE_MAP[t] ? TYPE_MAP[t].emoji : "🍴",
      voters: typeVoters[t]
    });
  }

  /**
   * 從某個類型裡挑最多 max 家。
   * 這裡不限制「同一站只能一家」—— 同一站的兩家不同餐廳是兩個真實的選項，
   * 為了分散而換成更遠的店反而本末倒置。
   */
  function pickForType(t, max){
    const pool = eligible.filter(function(x){ return x.restaurant.type === t; });
    if(!pool.length) return [];
    return dedupeByName(pool.sort(rank)).slice(0, max);
  }

  /* ---------- 3. 共識區：兩個人以上都選的類型 ---------- */
  // 只有一個人選的類型不放這裡，放到下面「每個人想吃的」。
  const sharedTypes = Object.keys(typeVoters)
    .filter(function(t){ return typeVoters[t].length >= 2; })
    .sort(function(a, b){ return typeVoters[b].length - typeVoters[a].length; });

  const consensus = [];
  sharedTypes.forEach(function(t){
    if(consensus.length >= 8) return;
    const picked = pickForType(t, 2);
    if(!picked.length){
      warnings.push("「" + (TYPE_MAP[t] ? TYPE_MAP[t].label : t) + "」有 " + typeVoters[t].length +
        " 個人想吃，但在大家都到得了的範圍內沒有這一類的店。");
      return;
    }
    picked.forEach(function(x){ consensus.push(decorate(x, t, "consensus")); });
  });

  const noOverlap = sharedTypes.length === 0;
  if(noOverlap){
    warnings.push("大家想吃的類型完全沒有交集，所以沒有「最多人想吃」這一區。直接看下面每個人各自想吃的吧。");
  }

  /* ---------- 4. 每個人想吃的：只有一個人選的類型 ---------- */
  const soloTypes = Object.keys(typeVoters).filter(function(t){ return typeVoters[t].length === 1; });

  // 依「有幾種單人類型」決定每種給幾家，而不是看有幾個人 ——
  // 真正會讓畫面爆掉的是類型數，三個人也可能各選三種不同的。
  // 三種以內每種給兩家當備案，四種以上每種一家，卡片數就控制在 6 張上下。
  const perSoloType = soloTypes.length <= 3 ? 2 : 1;

  const byType = [];
  soloTypes.forEach(function(t){
    const picked = pickForType(t, perSoloType);
    if(!picked.length){
      warnings.push("「" + (TYPE_MAP[t] ? TYPE_MAP[t].label : t) + "」（" + typeVoters[t][0] +
        " 想吃）在大家都到得了的範圍內找不到店。");
      return;
    }
    picked.forEach(function(x){ byType.push(decorate(x, t, "type")); });
  });

  // 依成員填寫順序排，看起來比較像「一人一區」
  const order = {};
  members.forEach(function(m, i){ order[m.name] = i; });
  byType.sort(function(a, b){
    const ao = order[a.voters[0]], bo = order[b.voters[0]];
    if(ao !== bo) return ao - bo;                       // 先照成員順序分群
    if(a.typeId !== b.typeId) return a.typeId < b.typeId ? -1 : 1;  // 同一人的同類型排在一起
    return rank(a, b);
  });

  // 隱藏彩蛋要從「大家都到得了、但沒被選進推薦」的店裡抽，所以留一批備用的
  const usedIds = consensus.concat(byType).map(function(x){ return x.restaurant.id; });
  const spare = eligible
    .filter(function(x){ return usedIds.indexOf(x.restaurant.id) < 0; })
    .sort(rank)
    .slice(0, 50)
    .map(function(x){
      const t = x.restaurant.type;
      return {
        restaurant: x.restaurant,
        typeLabel: TYPE_MAP[t] ? TYPE_MAP[t].label : t,
        typeEmoji: TYPE_MAP[t] ? TYPE_MAP[t].emoji : "🍴"
      };
    });

  return {
    consensus: consensus, byType: byType, warnings: warnings, noOverlap: noOverlap, spare: spare,
    // 讓前端直接用這個值寫文案，不要自己去推 —— 推錯就會出現「說兩家卻只給一家」
    perSoloType: perSoloType,
    soloTypeCount: soloTypes.length
  };
}

module.exports = { recommend, evaluate };
