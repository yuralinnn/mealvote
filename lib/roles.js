/**
 * 角色抽籤與計票規則。
 *
 * 設計上的一個關鍵決定：投票改成「勾選 → 按送出」兩段式。
 * 因為壞皇后要毒「後面一位投票的人」，而複選模式下如果勾一下就即時記錄，
 * 根本沒有「這個人投完了」這個時間點可以定義先後順序。
 * 有了送出這個動作，順序就是「按下送出的先後」，非同步也成立。
 *
 * 角色只有伺服器知道誰是誰。對外的房間資料永遠不含 roles，
 * 成員只能拿自己的 secret 查自己的角色。
 */

const ROLES = {
  king: {
    id: "king", name: "國王", emoji: "👑",
    power: "你這一票，每一家都算兩票。",
    detail: "投票權重 ×2。你勾的每一家餐廳都會拿到 2 票。"
  },
  queen: {
    id: "queen", name: "壞皇后", emoji: "🍎",
    power: "下一個送出投票的人會被你毒啞，那一票不算數。",
    detail: "你按下送出之後，接著第一個送出投票的人會被毒啞，他的票會作廢。如果你是最後一個送出的，技能就沒有效果。你不會知道會毒到誰。毒只讓對方的「票」不算數，如果毒到魔法師，他指定的交換照樣會發生。"
  },
  wizard: {
    id: "wizard", name: "魔法師", emoji: "🧙",
    power: "指定兩家餐廳，投票結束後它們的票數互換。",
    detail: "送出投票時要同時指定兩家。交換在所有人都投完之後才發生，所以你現在並不知道那兩家各有幾票——這是盲選。就算你被壞皇后毒啞（自己那一票不算數），交換還是會發生。"
  },
  fool: {
    id: "fool", name: "笨蛋", emoji: "🤡",
    power: "你不能自己選，由轉盤決定你投給誰。",
    detail: "輪到你投票時會跳出轉盤，系統隨機決定你投給哪一家，而且只會投到一家。"
  },
  commoner: {
    id: "commoner", name: "平民", emoji: "🧑‍🌾",
    power: "一票就是一票，沒有特殊能力。",
    detail: "權重 ×1，不受任何技能影響。安穩過日子。"
  }
};

/** 有特殊技能的四個角色，每場最多各出現一次 */
const SPECIAL_ORDER = ["king", "queen", "wizard", "fool"];

function shuffle(arr, rnd){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * 發角色。
 *   5 人以上：四個特殊角色各一，其餘都是平民
 *   5 人以下：從四個特殊角色裡隨機抽，抽到幾個算幾個（所以小場次角色組合每次都不同）
 * 回傳 { memberId: roleId }
 */
function assignRoles(memberIds, rnd){
  rnd = rnd || Math.random;
  const specials = shuffle(SPECIAL_ORDER, rnd).slice(0, Math.min(memberIds.length, SPECIAL_ORDER.length));
  const pool = specials.concat(
    new Array(Math.max(0, memberIds.length - specials.length)).fill("commoner")
  );
  const shuffled = shuffle(pool, rnd);

  const out = {};
  memberIds.forEach(function(id, i){ out[id] = shuffled[i]; });
  return out;
}

/* ---------- 隱藏彩蛋：今日主廚 ---------- */

const ALIASES = ["神秘店家 X", "神秘店家 Y", "神秘店家 Z", "神秘店家 α", "神秘店家 Ω"];

const TAGLINES = [
  "吃過的人都不肯透露地址，怕排隊變長。",
  "老闆脾氣很硬，但你會原諒他。",
  "招牌小到會走過頭，走過頭的人後來都回來了。",
  "菜單只有一面，因為不需要第二面。",
  "據說有人為了它提早三站下車。",
  "上菜速度很慢，慢到你開始期待。",
  "沒有冷氣但有風扇，沒有裝潢但有味道。",
  "老闆娘會問你吃不吃辣，答錯後果自負。",
  "隔壁桌一直在講話，但你會專心吃自己的。",
  "第一次來會覺得普通，第三次來會開始想念。",
  "沒有menu照片，因為端上來比照片好看。",
  "營業時間寫得很隨性，但該開的時候都會開。",
  "座位很擠，擠到你跟隔壁桌變成朋友。",
  "有人說它被高估了，那個人上週又去了。",
  "湯可以續，但你續到第三碗店員會看你。",
  "位置很偏，偏到只有在地人知道。",
  "門口那條隊伍不是在等公車。",
  "吃完會有一種「早知道就早點來」的悔恨。"
];

/**
 * 從「大家都到得了、但沒被選進推薦名單」的餐廳裡抽一家當彩蛋。
 * 刻意挑候選之外的，這樣它是額外的第 N+1 個選項，不會擠掉正常推薦。
 */
function pickMystery(eligible, usedIds, rnd){
  rnd = rnd || Math.random;
  const pool = eligible.filter(function(x){ return usedIds.indexOf(x.restaurant.id) < 0; });
  if(!pool.length) return null;

  const hit = pool[Math.floor(rnd() * pool.length)];
  return {
    restaurantId: hit.restaurant.id,
    alias: ALIASES[Math.floor(rnd() * ALIASES.length)],
    tagline: TAGLINES[Math.floor(rnd() * TAGLINES.length)],
    typeLabel: hit.typeLabel || null,
    typeEmoji: hit.typeEmoji || "🍴",
    // 真實店家的完整資料。投票期間伺服器絕對不會把這個欄位吐出去，
    // 只有 stage 進到 revealed 之後才隨結果一起公開。
    entry: hit
  };
}

/* ---------- 計票 ---------- */

/**
 * 依角色規則算出最終票數。
 * @param ballots { memberId: { picks:[rid], poisoned:bool, swap:[ridA,ridB] } }
 * @param roles   { memberId: roleId }
 * @returns { totals:{rid:票數}, voters:{rid:[名字]}, swap:{a,b}|null, poisonedIds:[] }
 */
function tally(ballots, roles, nameOf){
  const totals = {};
  const voters = {};
  const poisonedIds = [];

  Object.keys(ballots || {}).forEach(function(mid){
    const b = ballots[mid] || {};
    if(b.poisoned){ poisonedIds.push(mid); return; }

    const weight = roles[mid] === "king" ? 2 : 1;
    (b.picks || []).forEach(function(rid){
      totals[rid] = (totals[rid] || 0) + weight;
      if(!voters[rid]) voters[rid] = [];
      voters[rid].push(nameOf(mid));
    });
  });

  // 魔法師交換：等所有票都算完才發生，所以他指定當下確實不知道會換到什麼。
  // 注意：壞皇后的毒只會讓魔法師「那一票」不算數，交換技能照樣生效 ——
  // 毒的是嘴巴不是魔法。
  let swap = null;
  const wizardId = Object.keys(roles || {}).find(function(k){ return roles[k] === "wizard"; });
  const wb = wizardId && ballots[wizardId];
  if(wb && Array.isArray(wb.swap) && wb.swap.length === 2 && wb.swap[0] !== wb.swap[1]){
    const a = wb.swap[0], b2 = wb.swap[1];
    const ta = totals[a] || 0, tb = totals[b2] || 0;
    totals[a] = tb; totals[b2] = ta;
    swap = { a: a, b: b2, movedToA: tb, movedToB: ta };
  }

  return { totals: totals, voters: voters, swap: swap, poisonedIds: poisonedIds };
}

module.exports = { ROLES, SPECIAL_ORDER, assignRoles, pickMystery, tally, TAGLINES, ALIASES };
