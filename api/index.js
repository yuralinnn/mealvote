/**
 * Vercel 的進入點。
 *
 * Vercel 是 serverless：沒有「一直在的行程」，每一次請求都可能落在
 * 全新的執行實例上。所以這裡不 listen，只是把 Express app 當成
 * 一個 (req, res) 的處理函式交給平台。
 *
 * vercel.json 會把所有網址都導到這裡，靜態檔案由 Express 自己的
 * express.static 處理，這樣本機跑 `npm start` 跟部署到 Vercel
 * 走的是同一份程式碼、同一套路由。
 */
module.exports = require("../server.js");
