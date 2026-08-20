/**
 * 雙北餐廳種子資料
 *
 * 這份清單是「起始種子」，設計成很好改：
 *   - CHAINS  連鎖品牌，一個品牌對應多個捷運站，會自動展開成多筆
 *   - INDIE   單店，直接指定所在捷運站
 *
 * price = 每人概估消費（新台幣），純粹顯示用；不確定就填 null。
 * 地圖與訂位一律用「搜尋連結」產生，不寫死網址，所以不會有連結失效的問題。
 *
 * 想加自己的口袋名單，直接往下面陣列加一筆就好，伺服器重啟就生效。
 */

/** 餐廳類型（前端「今天想吃啥」的選項就是這份清單） */
const TYPES = [
  { id: "japanese",  label: "日式定食・丼飯", emoji: "🍱" },
  { id: "ramen",     label: "拉麵",           emoji: "🍜" },
  { id: "sushi",     label: "壽司・生魚片",   emoji: "🍣" },
  { id: "korean",    label: "韓式",           emoji: "🇰🇷" },
  { id: "hotpot",    label: "火鍋",           emoji: "🍲" },
  { id: "bbq",       label: "燒肉・燒烤",     emoji: "🥩" },
  { id: "taiwanese", label: "熱炒・台菜",     emoji: "🥘" },
  { id: "sichuan",   label: "川菜・麻辣",     emoji: "🌶️" },
  { id: "canto",     label: "港式・粵菜",     emoji: "🥟" },
  { id: "italian",   label: "義式・西餐",     emoji: "🍝" },
  { id: "american",  label: "美式・牛排",     emoji: "🍔" },
  { id: "thai",      label: "泰式・南洋",     emoji: "🍤" },
  { id: "izakaya",   label: "居酒屋・小酌",   emoji: "🍶" },
  { id: "brunch",    label: "早午餐・輕食",   emoji: "🥐" },
  { id: "veggie",    label: "素食・蔬食",     emoji: "🥗" },
  { id: "noodle",    label: "小吃・麵食",     emoji: "🍚" },
  { id: "buffet",    label: "吃到飽・自助餐", emoji: "🍽️" }
];

/** 連鎖品牌：一個品牌 × 多個捷運站 */
const CHAINS = [
  // 火鍋
  { name:"海底撈火鍋", type:"hotpot", price:800, note:"服務誇張、客製湯底，人多聊天很適合", book:true,
    stations:["台北101/世貿","忠孝復興","西門","板橋","南港展覽館","中山"] },
  { name:"築間幸福鍋物", type:"hotpot", price:450, note:"平價個人鍋，肉品可加購，等位快", book:true,
    stations:["忠孝復興","公館","板橋","市政府","中山","景安","南港"] },
  { name:"這一鍋皇室秘藏鍋物", type:"hotpot", price:900, note:"擺盤華麗、適合有點儀式感的聚餐", book:true,
    stations:["台北101/世貿","板橋","中山","市政府"] },
  { name:"石二鍋", type:"hotpot", price:280, note:"最沒有壓力的個人鍋，隨到隨吃", book:false,
    stations:["西門","公館","忠孝敦化","板橋","士林","南京復興","永安市場","江子翠"] },
  { name:"錢都日式涮涮鍋", type:"hotpot", price:250, note:"銅板價個人鍋，宵夜時段也開", book:false,
    stations:["公館","景美","板橋","三重","蘆洲","士林"] },
  { name:"老四川巴蜀麻辣燙", type:"hotpot", price:900, note:"老字號麻辣鍋，鴨血豆腐吃到飽", book:true,
    stations:["忠孝復興","板橋","中山","市政府"] },
  { name:"涮乃葉 syabu-yo", type:"hotpot", price:650, note:"日式涮涮鍋吃到飽，蔬菜吧很齊", book:true,
    stations:["台北101/世貿","板橋","中山","南港"] },

  // 燒肉
  { name:"乾杯燒肉居酒屋", type:"bbq", price:900, note:"氣氛熱鬧，經典乾杯儀式", book:true,
    stations:["忠孝復興","市政府","中山","板橋","公館"] },
  { name:"原燒優質燒肉", type:"bbq", price:750, note:"套餐制不用點菜、附湯附飲料", book:true,
    stations:["忠孝復興","板橋","南京復興","市政府","士林"] },
  { name:"燒肉LIKE", type:"bbq", price:400, note:"一人一爐，午餐時段快速解決", book:false,
    stations:["西門","台北車站","板橋","中山"] },
  { name:"胡同燒肉", type:"bbq", price:1200, note:"和牛品質高，訂位要早", book:true,
    stations:["忠孝復興","中山","台北101/世貿"] },

  // 日式
  { name:"大戶屋", type:"japanese", price:400, note:"定食選擇多，一個人或一群人都自在", book:false,
    stations:["忠孝復興","台北101/世貿","板橋","中山","市政府","公館","南港"] },
  { name:"定食8", type:"japanese", price:300, note:"平價日式定食，白飯味噌湯續加", book:false,
    stations:["公館","西門","士林","板橋","忠孝敦化"] },
  { name:"勝博殿日式豬排", type:"japanese", price:420, note:"炸豬排本體很穩，高麗菜無限續", book:false,
    stations:["台北車站","板橋","市政府","台北101/世貿","中山"] },
  { name:"丸龜製麵", type:"japanese", price:250, note:"現做烏龍麵，配天婦羅很划算", book:false,
    stations:["台北車站","西門","板橋","忠孝復興","市政府","士林"] },
  { name:"吉野家", type:"japanese", price:180, note:"牛丼快速方便，預算緊時的保底選項", book:false,
    stations:["台北車站","西門","公館","板橋","士林","忠孝復興"] },

  // 拉麵
  { name:"一風堂拉麵", type:"ramen", price:400, note:"豚骨湯頭經典，白丸黑丸各有擁護者", book:false,
    stations:["台北車站","忠孝復興","板橋","中山"] },
  { name:"花月嵐拉麵", type:"ramen", price:350, note:"招牌嗆蒜拉麵，重口味首選", book:false,
    stations:["西門","公館","板橋","市政府","中山"] },
  { name:"屯京拉麵", type:"ramen", price:420, note:"魚介豚骨雙湯頭，麵條偏粗有嚼勁", book:false,
    stations:["忠孝復興","中山","台北101/世貿"] },

  // 壽司
  { name:"藏壽司 Kura Sushi", type:"sushi", price:350, note:"五盤抽一次扭蛋，帶朋友來很好玩", book:false,
    stations:["西門","忠孝復興","板橋","士林","市政府","中山","南港"] },
  { name:"壽司郎 Sushiro", type:"sushi", price:400, note:"CP 值高，尖峰要先線上取號", book:false,
    stations:["板橋","中山","市政府","公館","南港展覽館"] },
  { name:"爭鮮迴轉壽司", type:"sushi", price:200, note:"銅板價，臨時想吃就有位子", book:false,
    stations:["西門","台北車站","公館","板橋","士林","忠孝敦化","三重"] },

  // 韓式
  { name:"涓豆腐", type:"korean", price:550, note:"豆腐鍋辣度可選，附小菜", book:true,
    stations:["台北101/世貿","板橋","中山","市政府"] },
  { name:"兩班家韓式碳烤", type:"korean", price:600, note:"烤肉加小菜吃到飽，適合放開吃", book:true,
    stations:["忠孝復興","板橋","中山"] },
  { name:"bb.q CHICKEN", type:"korean", price:450, note:"韓式炸雞配啤酒，外帶也方便", book:false,
    stations:["西門","中山","忠孝復興","板橋"] },

  // 川菜
  { name:"開飯川食堂", type:"sichuan", price:550, note:"川菜做得下飯，人多合菜剛好", book:true,
    stations:["市政府","板橋","中山","忠孝復興","南港"] },

  // 港式
  { name:"添好運", type:"canto", price:400, note:"酥皮焗叉燒包必點，翻桌快", book:false,
    stations:["忠孝復興","板橋","市政府","台北車站"] },
  { name:"點點心", type:"canto", price:400, note:"港式點心單點制，兩個人也能吃很多樣", book:false,
    stations:["中山","西門","板橋"] },

  // 義式西餐
  { name:"薩莉亞 Saizeriya", type:"italian", price:250, note:"便宜到不可思議，學生時代的回憶", book:false,
    stations:["西門","板橋","中山","公館","士林","忠孝復興"] },
  { name:"洋城義大利餐廳", type:"italian", price:600, note:"份量大、適合分食，聚餐好點菜", book:true,
    stations:["市政府","板橋","中山","台北101/世貿"] },

  // 美式
  { name:"樂子 the Diner", type:"american", price:480, note:"美式早午餐加漢堡，份量很誠實", book:true,
    stations:["忠孝復興","大安","中山","市政府"] },
  { name:"我家牛排", type:"american", price:300, note:"平價牛排附自助吧，吃粗飽首選", book:false,
    stations:["板橋","三重","士林","公館","南勢角"] },
  { name:"孫東寶台式牛排", type:"american", price:250, note:"台式鐵板牛排，濃湯麵包無限", book:false,
    stations:["西門","板橋","公館","士林","三重"] },

  // 泰式
  { name:"瓦城泰國料理", type:"thai", price:650, note:"月亮蝦餅打拋豬，聚餐點菜不會出錯", book:true,
    stations:["忠孝復興","台北101/世貿","板橋","中山","市政府","南港"] },
  { name:"非常泰概念餐坊", type:"thai", price:600, note:"裝潢有氣氛，適合慶生", book:true,
    stations:["忠孝復興","中山"] },

  // 居酒屋
  { name:"鳥貴族", type:"izakaya", price:400, note:"均一價串燒，喝酒聊天很輕鬆", book:false,
    stations:["中山","西門","忠孝復興"] },
  { name:"燒鳥串道", type:"izakaya", price:450, note:"深夜也開，下班後續攤好去處", book:false,
    stations:["中山","公館","忠孝敦化","板橋"] },

  // 早午餐
  { name:"貳樓 Second Floor", type:"brunch", price:480, note:"全天候早午餐，寵物友善", book:true,
    stations:["忠孝復興","公館","板橋","中山","大安"] },
  { name:"早安美芝城", type:"brunch", price:100, note:"最平價的選項，趕時間時很好用", book:false,
    stations:["公館","士林","板橋","三重","景美","永安市場"] },

  // 素食
  { name:"舒果新米蘭蔬食", type:"veggie", price:500, note:"蔬食做成西式套餐，葷食者也吃得慣", book:true,
    stations:["市政府","板橋","中山","台北101/世貿"] },
  { name:"寬心園精緻蔬食", type:"veggie", price:550, note:"精緻中式蔬食，帶長輩合適", book:true,
    stations:["市政府","板橋","南京復興"] },

  // 小吃麵食
  { name:"鼎泰豐", type:"noodle", price:600, note:"小籠包國際知名，尖峰排隊要有心理準備", book:false,
    stations:["東門","台北101/世貿","忠孝復興","板橋","中山"] },
  { name:"三商巧福", type:"noodle", price:180, note:"牛肉麵連鎖，隨處可見不用想", book:false,
    stations:["台北車站","西門","公館","板橋","士林","三重"] },
  { name:"八方雲集", type:"noodle", price:130, note:"鍋貼酸辣湯，最沒有負擔的一餐", book:false,
    stations:["公館","西門","板橋","士林","三重","景美","忠孝新生"] },

  // 吃到飽
  { name:"饗食天堂", type:"buffet", price:1200, note:"經典自助餐，慶祝場合的安全牌", book:true,
    stations:["台北101/世貿","板橋","中山","忠孝復興"] },
  { name:"漢來海港自助餐廳", type:"buffet", price:1300, note:"海鮮強項，生蠔螃蟹吃到飽", book:true,
    stations:["台北車站","台北101/世貿","南港展覽館"] }
];

/** 單店：直接指定捷運站 */
const INDIE = [
  { name:"詹記麻辣火鍋", type:"hotpot", price:900, station:"中山國小", note:"復古裝潢，訂位一位難求", book:true },
  { name:"太和殿麻辣鍋", type:"hotpot", price:1000, station:"信義安和", note:"老字號麻辣鍋，湯頭厚實", book:true },
  { name:"Solo Pasta", type:"italian", price:650, station:"忠孝復興", note:"義大利麵做得很正統，訂位建議提前", book:true },
  { name:"Osteria by Angie", type:"italian", price:900, station:"忠孝復興", note:"手工麵food，約會或慶祝很合適", book:true },
  { name:"欣葉台菜創始店", type:"taiwanese", price:750, station:"雙連", note:"經典台菜，帶長輩或外國朋友都體面", book:true },
  { name:"青葉台灣料理", type:"taiwanese", price:700, station:"中山", note:"老台菜館，菜脯蛋與雞捲是招牌", book:true },
  { name:"梅子餐廳", type:"taiwanese", price:650, station:"雙連", note:"台式熱炒與海鮮，適合人多合菜", book:true },
  { name:"好記擔仔麵", type:"taiwanese", price:550, station:"行天宮", note:"菜色鋪滿門口，指著點就對了", book:false },
  { name:"雙月食品社", type:"taiwanese", price:350, station:"善導寺", note:"台式雞湯與麻油麵線，清爽不油膩", book:false },
  { name:"上引水產", type:"sushi", price:900, station:"中山國中", note:"立食生魚片超新鮮，也能買回家煮", book:false },
  { name:"三味食堂", type:"sushi", price:600, station:"龍山寺", note:"巨無霸鮭魚握壽司，排隊名店", book:false },
  { name:"一蘭拉麵", type:"ramen", price:500, station:"中山", note:"隔板獨食，湯頭濃度可以自己調", book:false },
  { name:"樂麵屋", type:"ramen", price:380, station:"忠孝敦化", note:"客製化麵條軟硬與湯頭濃淡", book:false },
  { name:"鷹流東京醬油拉麵", type:"ramen", price:400, station:"松江南京", note:"醬油湯頭清爽，叉燒表現好", book:false },
  { name:"山頭火拉麵", type:"ramen", price:400, station:"台北車站", note:"北海道系豚骨，鹽味拉麵值得試", book:false },
  { name:"韓姜熙的小廚房", type:"korean", price:650, station:"忠孝復興", note:"韓式家常菜，小菜續加不手軟", book:true },
  { name:"豬對有韓式烤肉", type:"korean", price:550, station:"忠孝敦化", note:"厚切五花，店員代烤不用自己顧", book:true },
  { name:"NARA Thai Cuisine", type:"thai", price:700, station:"台北101/世貿", note:"泰國本地評鑑常勝軍，酸辣夠味", book:true },
  { name:"泰市場 Spice Market", type:"thai", price:1100, station:"台北101/世貿", note:"泰式海鮮自助餐，慶祝場合很有面子", book:true },
  { name:"誠記越南麵食館", type:"thai", price:300, station:"東門", note:"生牛肉河粉老店，湯頭清甜", book:false },
  { name:"珍寶海鮮", type:"thai", price:1000, station:"台北101/世貿", note:"新加坡辣椒螃蟹，配饅頭很涮嘴", book:true },
  { name:"林東芳牛肉麵", type:"noodle", price:280, station:"忠孝新生", note:"湯頭與辣椒醬是靈魂，宵夜也開", book:false },
  { name:"永康牛肉麵", type:"noodle", price:330, station:"東門", note:"紅燒牛肉麵老店，觀光客與在地人都愛", book:false },
  { name:"廖家牛肉麵", type:"noodle", price:300, station:"東門", note:"清燉紅燒都有水準，小菜也好", book:false },
  { name:"金峰魯肉飯", type:"noodle", price:180, station:"中正紀念堂", note:"魯肉飯配排骨酥湯，銅板價經典", book:false },
  { name:"阜杭豆漿", type:"brunch", price:120, station:"善導寺", note:"厚燒餅加蛋，要早起排隊", book:false },
  { name:"天天利美食坊", type:"noodle", price:150, station:"西門", note:"半熟蛋滷肉飯，西門町必吃", book:false },
  { name:"阿宗麵線", type:"noodle", price:90, station:"西門", note:"站著吃的大腸麵線，續攤前墊胃剛好", book:false },
  { name:"富霸王豬腳", type:"noodle", price:280, station:"行天宮", note:"燉到入口即化的豬腳，配滷肉飯", book:false },
  { name:"度小月擔仔麵", type:"noodle", price:350, station:"中山", note:"台南擔仔麵北上版，小點多樣", book:false },
  { name:"興波咖啡 Simple Kaffa", type:"brunch", price:350, station:"忠孝新生", note:"世界冠軍咖啡，甜點也有水準", book:false },
  { name:"好初早餐", type:"brunch", price:220, station:"江子翠", note:"板橋人氣早午餐，蛋餅系列很強", book:false },
  { name:"Ooh Cha Cha 自然食", type:"veggie", price:350, station:"古亭", note:"純素也吃得滿足，沙拉碗份量足", book:false },
  { name:"果然匯蔬食百匯", type:"veggie", price:750, station:"台北101/世貿", note:"蔬食吃到飽，選擇比想像中多", book:true },
  { name:"Ed's Diner", type:"american", price:550, station:"忠孝敦化", note:"美式煙燻烤肉，配啤酒很對", book:true },
  { name:"KUA `AINA 夏威夷漢堡", type:"american", price:450, station:"台北101/世貿", note:"酪梨漢堡是招牌，份量偏大", book:false },
  { name:"TGI FRIDAYS", type:"american", price:750, station:"台北101/世貿", note:"美式連鎖，慶生氣氛做得足", book:true },
  { name:"添好運（板橋大遠百）", type:"canto", price:400, station:"板橋", note:"逛街順道吃，翻桌率高", book:false },
  { name:"港點大師", type:"canto", price:450, station:"台北101/世貿", note:"港點單點制，兩人也能吃到多樣", book:false },
  { name:"天府川菜", type:"sichuan", price:600, station:"南京復興", note:"道地川味，怕辣要先講", book:true },
  { name:"川外川", type:"sichuan", price:550, station:"市政府", note:"水煮牛與口水雞穩定，適合合菜", book:true },
  { name:"饗饗 INPARADISE", type:"buffet", price:1600, station:"忠孝復興", note:"高檔自助餐，重要日子的選擇", book:true },
  { name:"點爭鮮（微風南山）", type:"sushi", price:300, station:"台北101/世貿", note:"點餐送到桌，不用等迴轉盤", book:false },
  { name:"銀兔湯咖哩", type:"japanese", price:450, station:"忠孝復興", note:"北海道湯咖哩，辣度與配料可選", book:false },
  { name:"金子半之助", type:"japanese", price:400, station:"台北車站", note:"江戶前天丼，醬汁很涮嘴", book:false },
  { name:"大心新泰式麵食", type:"thai", price:350, station:"市政府", note:"泰式湯麵，辣度可調，一人也自在", book:false },
  { name:"六張犁老賊魯肉飯", type:"noodle", price:160, station:"六張犁", note:"在地人的日常，價格佛心", book:false },
  { name:"公館夜市小吃", type:"noodle", price:200, station:"公館", note:"整條街隨便挑，學生價位", book:false },
  { name:"寧夏夜市", type:"noodle", price:250, station:"雙連", note:"小吃密度高，邊走邊吃最省事", book:false },
  { name:"饒河街觀光夜市", type:"noodle", price:250, station:"松山", note:"胡椒餅與藥燉排骨，捷運站出口就到", book:false },
  { name:"晴光市場美食", type:"noodle", price:220, station:"中山國小", note:"在地老市場，牛雜湯與泰式小吃都有", book:false }
];


/**
 * 平價小吃專區
 *
 * OSM 撈得到店，但撈不到價位 —— 而「便宜」正是小吃最重要的資訊。
 * 所以這一區是人工整理的，每一筆都有實際的人均價位。
 *
 * 選店偏向兩種：一是各站的夜市／傳統市場（一定存在、也一定便宜），
 * 二是有名字的老店。刻意往外圍站別鋪，因為平價小吃本來就不在市中心。
 */
const CHEAP_EATS = [
  // ── 夜市與傳統市場（整區覓食，最不會出錯的平價選項）──
  { name:"士林夜市", type:"noodle", price:250, station:"劍潭", note:"規模最大的夜市，從劍潭站 1 號出口過馬路就到", book:false },
  { name:"寧夏夜市", type:"noodle", price:220, station:"雙連", note:"小吃密度高，走一圈就飽，適合邊走邊分食", book:false },
  { name:"饒河街觀光夜市", type:"noodle", price:230, station:"松山", note:"胡椒餅與藥燉排骨，捷運站出口直接接夜市口", book:false },
  { name:"華西街夜市", type:"noodle", price:220, station:"龍山寺", note:"老派台北味，蛇肉店已少但小吃仍在", book:false },
  { name:"公館夜市", type:"noodle", price:200, station:"公館", note:"學生價位，整條街隨便挑都不會太貴", book:false },
  { name:"師大夜市", type:"noodle", price:200, station:"古亭", note:"從古亭站走約 8 分鐘，異國小吃比例高", book:false },
  { name:"通化街夜市", type:"noodle", price:230, station:"信義安和", note:"又叫臨江街夜市，在地人比觀光客多", book:false },
  { name:"遼寧街夜市", type:"noodle", price:250, station:"南京復興", note:"規模小但都是熟客店，宵夜時段最熱鬧", book:false },
  { name:"景美夜市", type:"noodle", price:200, station:"景美", note:"出站就到，蒸餃與生煎包是招牌", book:false },
  { name:"樂華夜市", type:"noodle", price:200, station:"頂溪", note:"永和最大夜市，走路 5 分鐘", book:false },
  { name:"興南夜市", type:"noodle", price:190, station:"南勢角", note:"中和在地夜市，價位比台北市低一截", book:false },
  { name:"華新街(緬甸街)", type:"thai", price:180, station:"南勢角", note:"緬甸與雲南小吃聚落，魚湯麵與烤餅很值得", book:false },
  { name:"三和夜市", type:"noodle", price:190, station:"三和國中", note:"三重在地夜市，銅板價選擇多", book:false },
  { name:"湳雅夜市", type:"noodle", price:200, station:"板橋", note:"板橋人的宵夜場，攤位密集", book:false },
  { name:"黃石市場", type:"noodle", price:160, station:"府中", note:"板橋老市場，白天就開，肉圓與臭豆腐有名", book:false },
  { name:"新莊廟街夜市", type:"noodle", price:190, station:"新莊", note:"廟口小吃聚落，走路 5 分鐘", book:false },
  { name:"蘆洲廟口小吃", type:"noodle", price:180, station:"蘆洲", note:"切仔麵與黑白切的大本營", book:false },
  { name:"延三夜市", type:"noodle", price:200, station:"大橋頭", note:"老台北小吃聚落，米粉湯與滷味攤多", book:false },
  { name:"南門市場", type:"noodle", price:180, station:"中正紀念堂", note:"傳統市場熟食區，江浙點心與滷味", book:false },
  { name:"北投市場", type:"noodle", price:150, station:"北投", note:"在地人的早午餐場，滷肉飯與麵攤便宜", book:false },
  { name:"淡水老街小吃", type:"noodle", price:200, station:"淡水", note:"阿給、魚丸、鐵蛋，順便看夕陽", book:false },
  { name:"虎林街夜市", type:"noodle", price:190, station:"永春", note:"純在地夜市，沒什麼觀光客", book:false },
  { name:"晴光市場美食", type:"noodle", price:200, station:"中山國小", note:"老市場，牛雜湯與泰式小吃都有", book:false },

  // ── 麵食與飯類老店 ──
  { name:"賣麵炎仔", type:"noodle", price:160, station:"大橋頭", note:"百年切仔麵，紅燒肉必點，中午前常賣完", book:false },
  { name:"今大魯肉飯", type:"noodle", price:130, station:"菜寮", note:"三重排隊名店，魯肉飯配油豆腐", book:false },
  { name:"矮仔財滷肉飯", type:"noodle", price:120, station:"北投", note:"北投市場裡的排隊店，滷肉肥瘦適中", book:false },
  { name:"老牌牛肉拉麵大王", type:"noodle", price:180, station:"西門", note:"西門町老店，手工拉麵份量大", book:false },
  { name:"鴨肉扁", type:"noodle", price:160, station:"西門", note:"其實是鵝肉，切盤配麵是標準吃法", book:false },
  { name:"兩喜號魷魚羹", type:"noodle", price:100, station:"龍山寺", note:"百年老店，羹湯甜而不膩", book:false },
  { name:"周記傳統肉粥", type:"noodle", price:110, station:"龍山寺", note:"肉粥配紅燒肉，早上就開", book:false },
  { name:"藍家割包", type:"noodle", price:80, station:"公館", note:"割包選肥瘦，配四神湯剛好", book:false },
  { name:"雄記蔥抓餅", type:"noodle", price:60, station:"公館", note:"現桿現煎，加蛋加起司都便宜", book:false },
  { name:"上豪蒸餃", type:"noodle", price:130, station:"景美", note:"景美夜市名店，蒸餃皮薄餡多", book:false },
  { name:"阿財鍋貼水餃", type:"noodle", price:130, station:"南京復興", note:"鍋貼底部煎得很脆，配酸辣湯", book:false },
  { name:"許記生煎包", type:"noodle", price:60, station:"古亭", note:"師大商圈老攤，一顆銅板價", book:false },
  { name:"東門餃子館", type:"noodle", price:250, station:"東門", note:"老北方麵食，牛肉捲餅與酸辣湯", book:false },
  { name:"大橋頭老牌筒仔米糕", type:"noodle", price:100, station:"大橋頭", note:"米糕配四神湯，傳統早午餐吃法", book:false },
  { name:"東發號油飯", type:"noodle", price:100, station:"松山", note:"饒河夜市口，油飯與魷魚焿", book:false },
  { name:"頂級甜不辣", type:"noodle", price:80, station:"龍山寺", note:"甜不辣配特調醬，湯可以續", book:false },
  { name:"老天祿滷味", type:"noodle", price:180, station:"西門", note:"鴨舌與豆干，外帶當宵夜", book:false },
  { name:"燈籠滷味", type:"noodle", price:170, station:"古亭", note:"自己夾的滷味，師大商圈老字號", book:false },
  { name:"好朋友涼麵", type:"noodle", price:90, station:"士林", note:"24 小時營業，宵夜或早餐都行", book:false },
  { name:"世界豆漿大王", type:"brunch", price:110, station:"頂溪", note:"24 小時中式早餐，永和豆漿的源頭", book:false },
  { name:"雙連圓仔湯", type:"noodle", price:90, station:"雙連", note:"燒麻糬與圓仔湯，寧夏夜市旁的甜點收尾", book:false },
  { name:"江記東門豆花", type:"noodle", price:70, station:"東門", note:"傳統豆花，永康商圈吃完的甜點", book:false },
  { name:"台一牛奶大王", type:"brunch", price:100, station:"公館", note:"紅豆牛奶冰與燒麻糬，台大學生的回憶", book:false },
  { name:"三元號魯肉飯", type:"noodle", price:140, station:"雙連", note:"寧夏夜市老店，魯肉飯與魚翅羹", book:false },
  { name:"陳董藥燉排骨", type:"noodle", price:150, station:"松山", note:"饒河夜市排隊店，冬天喝特別暖", book:false },
  { name:"永和四海豆漿", type:"brunch", price:100, station:"永安市場", note:"燒餅油條蛋餅，中式早餐標配", book:false },
  { name:"施家鮮肉湯圓", type:"noodle", price:110, station:"善導寺", note:"華山市場名攤，鹹湯圓配餛飩", book:false },
  { name:"祥記純糖麻糬", type:"noodle", price:70, station:"龍山寺", note:"花生粉麻糬與杏仁露，飯後甜點", book:false },
  { name:"雙城街夜市", type:"noodle", price:190, station:"中山國小", note:"晴光市場旁，白天晚上都有攤", book:false },
  { name:"永樂市場小吃", type:"noodle", price:150, station:"北門", note:"迪化街旁，米粉湯與旗魚米粉", book:false },
  { name:"後山埤市場", type:"noodle", price:150, station:"後山埤", note:"傳統市場熟食區，滷味與麵線", book:false },
];

/* ---------- 展開成統一格式 ---------- */
/*
 * 地圖與查詢連結都用「搜尋」而不是寫死網址，所以不會有連結失效的問題。
 * 關鍵字刻意放寬成「店名 站名」而不是「店名 捷運X站」——
 * 加上「捷運」「站」會把查詢綁太死，萬一店搬家或資料有誤就整個查不到東西。
 */
function mapUrl(name, station){
  return "https://www.google.com/maps/search/?api=1&query=" +
         encodeURIComponent(name + " " + station);
}
function bookUrl(name, station){
  return "https://www.google.com/search?q=" +
         encodeURIComponent(name + " " + station + " 訂位");
}
function menuUrl(name, station){
  return "https://www.google.com/search?q=" +
         encodeURIComponent(name + " " + station + " 菜單");
}

/**
 * 讀入 OSM 匯入的資料（如果有的話）。
 * 跑過 `node tools/import-osm.js` 才會有這個檔案，沒有就只用上面的精選清單。
 *
 * 寫成這樣是因為這支檔案也會被 build-preview.js 打包進瀏覽器，
 * 那邊沒有 fs，所以要能安全地退回空陣列。
 */
var _req = typeof require === "function" ? require : null;

function loadOsm(){
  // 預覽版：由 build-preview.js 事先把資料掛在 globalThis 上
  if(typeof globalThis !== "undefined" && globalThis.__OSM_DATA__){
    return globalThis.__OSM_DATA__.restaurants || [];
  }
  if(!_req) return [];
  try{
    const fs = _req("fs"), path = _req("path");
    const f = path.join(__dirname, "osm-restaurants.json");
    if(!fs.existsSync(f)) return [];
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    return j.restaurants || [];
  }catch(e){
    console.warn("[restaurants] 讀取 osm-restaurants.json 失敗：" + e.message);
    return [];
  }
}

function build(){
  const out = [];
  const seen = new Set();
  let n = 0;

  // 先把 OSM 資料建成索引。精選清單裡的店如果 OSM 也有，
  // 就把「離車站幾公尺」繼承過來 —— 那是從實際座標算的，比人工估準。
  const osmList = loadOsm();
  const osmByKey = new Map();
  osmList.forEach(function(r){ osmByKey.set(r.name + "@" + r.station, r); });

  function push(r){
    const key = r.name + "@" + r.station;
    if(seen.has(key)) return;          // 精選清單優先，OSM 重複的就跳過
    seen.add(key);
    const hit = osmByKey.get(key);
    out.push(Object.assign({ id: "r" + (++n) }, r, {
      dist: r.dist != null ? r.dist : (hit ? hit.dist : null),
      mapUrl: mapUrl(r.name, r.station),
      bookUrl: bookUrl(r.name, r.station),
      menuUrl: menuUrl(r.name, r.station)
    }));
  }

  CHAINS.forEach(function(c){
    c.stations.forEach(function(st){
      push({ name: c.name, type: c.type, price: c.price, station: st,
             note: c.note, chain: true, book: !!c.book, source: "curated" });
    });
  });

  INDIE.forEach(function(r){
    push({ name: r.name, type: r.type, price: r.price, station: r.station,
           note: r.note, chain: false, book: !!r.book, source: "curated" });
  });

  CHEAP_EATS.forEach(function(r){
    push({ name: r.name, type: r.type, price: r.price, station: r.station,
           note: r.note, chain: false, book: false, source: "curated" });
  });

  const curatedCount = out.length;

  osmList.forEach(function(r){
    if(!TYPES.some(function(t){ return t.id === r.type; })) return;
    push({ name: r.name, type: r.type, price: r.price || null, station: r.station,
           dist: r.dist, note: r.note, chain: !!r.chain, book: false, source: "osm" });
  });

  if(out.length > curatedCount){
    console.log("[restaurants] 精選 " + curatedCount + " 筆 + OSM " +
                (out.length - curatedCount) + " 筆 = 共 " + out.length + " 筆");
  }

  return out;
}

const RESTAURANTS = build();

module.exports = { TYPES, RESTAURANTS, CHAINS, INDIE, CHEAP_EATS };
