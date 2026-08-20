/**
 * 選填的 Google Places API 串接。
 *
 * 沒有設定 GOOGLE_MAPS_API_KEY 時，整個模組等於不存在，
 * 前端就只顯示內建資料 + Google Maps 連結（連結不需要 key，一定有效）。
 *
 * 有設定時，會在伺服器端補上即時評分、評論數與營業狀態。
 * key 放在伺服器，不會出現在瀏覽器裡 —— 這是有後端才有的好處。
 *
 * 提醒：Google Maps Platform 要開通 API key 必須先綁定帳單帳戶（信用卡），
 * 免費額度是 Essentials 每月 10,000 次呼叫。這個 app 的用量遠低於此。
 */

const KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const ENABLED = !!KEY;

const TTL = 24 * 60 * 60 * 1000; // 評分快取一天，避免重複燒額度
const cache = new Map();

async function lookup(name, station){
  if(!ENABLED) return null;

  const q = name + " 捷運" + station + "站";
  const hit = cache.get(q);
  if(hit && Date.now() - hit.at < TTL) return hit.data;

  try{
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": [
          "places.displayName",
          "places.rating",
          "places.userRatingCount",
          "places.currentOpeningHours.openNow",
          "places.priceLevel",
          "places.googleMapsUri",
          "places.formattedAddress"
        ].join(",")
      },
      body: JSON.stringify({
        textQuery: q, languageCode: "zh-TW", regionCode: "TW", maxResultCount: 1
      })
    });

    if(!res.ok){
      console.warn("[places] " + res.status + " " + (await res.text()).slice(0, 200));
      cache.set(q, { at: Date.now(), data: null });
      return null;
    }

    const json = await res.json();
    const p = json.places && json.places[0];
    const data = p ? {
      rating: p.rating || null,
      ratingCount: p.userRatingCount || null,
      openNow: p.currentOpeningHours ? p.currentOpeningHours.openNow : null,
      address: p.formattedAddress || null,
      mapUrl: p.googleMapsUri || null
    } : null;

    cache.set(q, { at: Date.now(), data: data });
    return data;
  }catch(e){
    console.warn("[places] 查詢失敗：", e.message);
    return null;
  }
}

/** 批次補資料，失敗就靜靜跳過，絕不讓推薦流程掛掉 */
async function enrich(items){
  if(!ENABLED) return items;
  const out = await Promise.all(items.map(async function(x){
    const live = await lookup(x.restaurant.name, x.restaurant.station);
    if(!live) return x;
    return Object.assign({}, x, {
      restaurant: Object.assign({}, x.restaurant, {
        rating: live.rating,
        ratingCount: live.ratingCount,
        openNow: live.openNow,
        address: live.address,
        mapUrl: live.mapUrl || x.restaurant.mapUrl
      })
    });
  }));
  return out;
}

module.exports = { ENABLED, lookup, enrich };
