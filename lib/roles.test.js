/**
 * 角色與計票規則的離線測試。
 *   node lib/roles.test.js
 *
 * 這些規則彼此會互相影響（國王加權 × 壞皇后作廢 × 魔法師交換），
 * 用固定的假資料把每種組合都跑一遍，比在畫面上點半天可靠。
 */
const { ROLES, assignRoles, pickMystery, tally } = require("./roles");

let pass = 0, fail = 0;
function ok(c, label, extra){
  if(c){ pass++; console.log("  ✓ " + label); }
  else{ fail++; console.log("  ✗ " + label + (extra ? "　→ " + extra : "")); }
}
function eq(a, b, label){ ok(a === b, label, "得到 " + JSON.stringify(a) + "，預期 " + JSON.stringify(b)); }

/** 可重現的假亂數，測試才不會時好時壞 */
function seeded(seed){
  let s = seed;
  return function(){ s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
const names = { m1:"小明", m2:"小華", m3:"小美", m4:"阿哲", m5:"婷婷", m6:"Yuki", m7:"阿良" };
const nameOf = function(id){ return names[id] || id; };

console.log("\n── 角色發放 ──");
[1,2,3,4,5,6,7].forEach(function(n){
  const ids = Array.from({length:n}, function(_,i){ return "m" + (i+1); });
  const roles = assignRoles(ids, seeded(n * 97));
  const vals = Object.values(roles);
  const specials = vals.filter(function(r){ return r !== "commoner"; });
  const uniqueSpecials = new Set(specials);

  ok(Object.keys(roles).length === n, n + " 人都拿到角色");
  ok(specials.length === uniqueSpecials.size, n + " 人：特殊角色沒有重複", specials.join("/"));
  if(n >= 5){
    ok(specials.length === 4, n + " 人：正好 4 個特殊角色，其餘平民", specials.join("/"));
    ok(vals.filter(function(r){ return r === "commoner"; }).length === n - 4, n + " 人：平民數量正確");
  }else{
    ok(specials.length === n, n + " 人：全部都是特殊角色（人不夠不放平民）", specials.join("/"));
  }
});

console.log("\n── 小場次的角色組合會變化 ──");
const combos = new Set();
for(let s = 1; s <= 40; s++){
  const r = assignRoles(["m1","m2","m3"], seeded(s * 31));
  combos.add(Object.values(r).slice().sort().join(","));
}
ok(combos.size > 1, "3 人場的角色組合不是固定的（跑 40 次得到 " + combos.size + " 種）");

console.log("\n── 計票：平民基準 ──");
let r = tally(
  { m1:{picks:["A"]}, m2:{picks:["A","B"]}, m3:{picks:["B"]} },
  { m1:"commoner", m2:"commoner", m3:"commoner" }, nameOf);
eq(r.totals.A, 2, "A 得 2 票");
eq(r.totals.B, 2, "B 得 2 票");
eq(r.voters.A.join("、"), "小明、小華", "A 的投票者正確");

console.log("\n── 國王：每一家都 ×2 ──");
r = tally(
  { m1:{picks:["A","B"]}, m2:{picks:["A"]} },
  { m1:"king", m2:"commoner" }, nameOf);
eq(r.totals.A, 3, "A = 國王 2 + 平民 1 = 3");
eq(r.totals.B, 2, "B = 國王 2");

console.log("\n── 壞皇后：被毒的人整票作廢 ──");
r = tally(
  { m1:{picks:["A"]}, m2:{picks:["A","B"], poisoned:true}, m3:{picks:["B"]} },
  { m1:"queen", m2:"commoner", m3:"commoner" }, nameOf);
eq(r.totals.A, 1, "A 只剩皇后那票（被毒的人不算）");
eq(r.totals.B, 1, "B 只剩小美那票");
eq(r.poisonedIds.join(","), "m2", "有記錄誰被毒");
ok(!r.voters.A || r.voters.A.indexOf("小華") < 0, "被毒的人不會出現在投票者名單");

console.log("\n── 魔法師：投票結束後交換兩家票數 ──");
r = tally(
  { m1:{picks:["A"]}, m2:{picks:["A"]}, m3:{picks:["A"]}, m4:{picks:["B"], swap:["A","B"]} },
  { m1:"commoner", m2:"commoner", m3:"commoner", m4:"wizard" }, nameOf);
eq(r.totals.A, 1, "A 原本 3 票，換成 B 的 1 票");
eq(r.totals.B, 3, "B 原本 1 票，換成 A 的 3 票");
ok(r.swap && r.swap.a === "A" && r.swap.b === "B", "有記錄交換了哪兩家");

console.log("\n── 魔法師交換的其中一家沒人投 ──");
r = tally(
  { m1:{picks:["A"]}, m2:{picks:["A"]}, m3:{picks:["A"], swap:["A","C"]} },
  { m1:"commoner", m2:"commoner", m3:"wizard" }, nameOf);
eq(r.totals.A, 0, "A 的 3 票換成 C 的 0 票");
eq(r.totals.C, 3, "沒人投的 C 直接拿到 3 票");

console.log("\n── 魔法師被毒：票不算數，但交換照樣生效 ──");
r = tally(
  { m1:{picks:["A"]}, m2:{picks:["B"], swap:["A","B"], poisoned:true} },
  { m1:"commoner", m2:"wizard" }, nameOf);
eq(r.totals.B, 1, "A 原有的 1 票被換到 B");
eq(r.totals.A, 0, "A 換到 B 的 0 票（魔法師自己投的 B 因為被毒不算）");
ok(r.swap && r.swap.a === "A" && r.swap.b === "B", "被毒的魔法師仍然完成交換");
eq(r.poisonedIds.join(","), "m2", "魔法師仍被記錄為被毒");
ok(!r.voters.B || r.voters.B.indexOf("小華") < 0, "被毒的魔法師不會出現在投票者名單");

console.log("\n── 三個技能同時發生 ──");
// 國王投 A（×2）、平民投 A、被毒的人投 B（作廢）、魔法師投 B 並指定交換 A↔B
r = tally(
  { m1:{picks:["A"]},                       // 國王 → A 得 2
    m2:{picks:["A"]},                       // 平民 → A 得 1，小計 3
    m3:{picks:["B"], poisoned:true},        // 被毒 → 不算
    m4:{picks:["B"], swap:["A","B"]} },     // 魔法師 → B 得 1
  { m1:"king", m2:"commoner", m3:"commoner", m4:"wizard" }, nameOf);
eq(r.totals.A, 1, "A（原 3 票）交換後變 1 票");
eq(r.totals.B, 3, "B（原 1 票）交換後變 3 票");
eq(r.poisonedIds.length, 1, "有一個人被毒");

console.log("\n── 笨蛋：只會有一票 ──");
r = tally(
  { m1:{picks:["C"]}, m2:{picks:["A","B","C"]} },
  { m1:"fool", m2:"commoner" }, nameOf);
eq(r.totals.C, 2, "笨蛋那票正常計入（權重 1）");
eq((r.voters.C||[]).length, 2, "笨蛋出現在投票者名單");

console.log("\n── 隱藏彩蛋 ──");
const eligible = ["A","B","C","D","E"].map(function(id){
  return { restaurant:{ id:id }, typeLabel:"火鍋", typeEmoji:"🍲" };
});
const m = pickMystery(eligible, ["A","B"], seeded(7));
ok(m && ["C","D","E"].indexOf(m.restaurantId) >= 0, "彩蛋一定從候選名單「之外」抽", m && m.restaurantId);
ok(m.alias && m.tagline, "有代稱與宣傳詞", m.alias + "／" + m.tagline);
eq(pickMystery(eligible, ["A","B","C","D","E"], seeded(7)), null, "沒有多的店可抽時回 null");

const seen = new Set();
for(let s = 1; s <= 30; s++){
  const x = pickMystery(eligible, [], seeded(s * 13));
  seen.add(x.restaurantId + "|" + x.tagline);
}
ok(seen.size > 5, "彩蛋店家與宣傳詞會變化（30 次得到 " + seen.size + " 種組合）");

console.log("\n── 角色說明文字都在 ──");
["king","queen","wizard","fool","commoner"].forEach(function(k){
  ok(ROLES[k] && ROLES[k].name && ROLES[k].emoji && ROLES[k].power && ROLES[k].detail,
     k + " 的名稱／圖示／技能說明齊全");
});

console.log("\n" + (fail === 0 ? "全部 " + pass + " 項通過 ✅" : pass + " 通過、" + fail + " 失敗 ❌"));
process.exit(fail === 0 ? 0 : 1);
