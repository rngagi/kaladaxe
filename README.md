# kaladaxe

臺灣原住民族語言詞彙地圖，提供「基礎詞彙 200+」（214 個概念）與「千詞表（學習詞表）」（1,094 項）兩種模式，含 42 語言別，以及原始南島語（PAn）與原始馬來玻里尼西亞語（PMP）。

網站使用 HTML/CSS、Vanilla JavaScript 與 Leaflet；Python 在建置時產生靜態資料。

## 建置與預覽

需要 Python 3.10 以上版本。

~~~sh
python3 -m unittest discover -s tests -v
python3 scripts/build.py
python3 -m http.server 8000 --directory dist
~~~

開啟 http://localhost:8000/ 。網站透過 HTTP 載入 JavaScript 模組與 JSON。

## 詞表與語料

詞表由 kaladaxe 自行編排。原有概念 ID 保持固定，數詞移至最後，依一至十、二十、一百排列，總計 214 詞。內部欄位 swadesh_number 與檔名 swadesh.csv 沿用既有格式，前端統一顯示「基礎詞彙 200+」。重新編號後，water 為第 145 詞；分享網址仍使用 ?concept=water。

語料來源為使用者提供的原住民族語言研究發展基金會《2026年學習詞表》42 份 Excel，以及 acd-2.0/cldf/forms.csv。

| 檔案 | 用途 |
| --- | --- |
| source/concepts.json | 自訂概念 ID、編號、中英文詞義 |
| source/subgroups.json | 語言分類與祖語關聯 |
| source/varieties.json | 42 語言別與 PAn、PMP 的代碼、名稱、座標 |
| source/swadesh.csv | 地圖使用的詞形、選填 IPA 與備註 |
| source/learning.csv | Excel 的 45,948 筆詞條與原始中文、備註、檔名、工作表、列號 |
| source/word_sources.csv | 每個匯入詞形的來源紀錄，可追溯 Excel 詞條或 ACD Form ID |
| source/missing.csv | 尚未對應的概念與語言別組合 |
| source/import_summary.json | 匯入數量、各語言別涵蓋率、PMP 補入項目與來源檔案 SHA-256 |
| source/import/ | 可編輯的中文詞義對應、學習詞項對照與 ACD Form ID 選擇 |

基礎詞彙模式收錄 8,392 筆概念 × 語言別組合，42 語言別各涵蓋 187–192 詞；PAn 183 詞，PMP 202 詞。PMP 僅收錄有獨立 PMP 來源的形式；雲、唱歌、雪、二十等缺項保持空白。無來源形式的概念留在缺項清單。

語意對應採明列的中文詞義與 ACD Form ID。詞條包含多個形式時保留來源拼寫；同一概念有多個來源詞條時以「 / 」並列，原始詞義與使用範圍保存在備註。Excel 的「無此詞彙」保留於 learning.csv，地圖不將它當作詞形。來源未附 IPA，匯入時留白。

### 千詞表（學習詞表）模式

詞項選擇區可切換詞表；初次開啟預設使用基礎詞彙模式。學習模式使用原始編號，例如「一」為 `01-01`、「水」為 `21-02`，按編號各段數值排序（`26-99` 在 `26-100` 前）。搜尋支援原編號、中文、英文和各語言別的其他中文釋義。清單名稱採 42 語言別的多數釋義，同票時採 `varieties.json` 的語言別順序；詞形詳情仍保留各語言的原義、程度、來源檔名、工作表及列號。

網址 `?mode=learning&concept=21-02` 可直接分享學習詞項；原有 `?concept=water` 仍指向基礎詞彙。切換模式會選擇對應詞項（多個候選取目標詞表編號最前者），無對應則回到「水」，清空搜尋並保留語群及顯示類別。切換有 280ms 淡入過場，不阻擋操作；系統設定「減少動態效果」時停用。

學習模式共有 46,844 筆詞項 × 語言別組合：現代語言 45,762 筆、PAn 490 項、PMP 592 項。原表 188 筆缺項中補入兩筆：邵語 `04-07`「配偶」以同語言 `04-15`「丈夫」近義補入，明示不代表妻子；雅美語 `36-28`「都」以 `01-43`「全部」補入。其餘現代語言缺項 186 筆；祖語缺項 1,106 筆，合計 1,292 筆。519 個編號存在跨語言中文釋義差異。

正式建置只使用以下已納入版本控制的資料，不讀取 `.work`、外部詞典或本地 ACD 安裝：

| 檔案 | 用途 |
| --- | --- |
| `source/learning.csv` | 完整 45,948 筆原始記錄，包含缺項標記 |
| `source/import/learning_matches.json` | 每個編號的顯示詞義、既有概念關係、固定 ACD Form ID 與同語言補入來源 |
| `source/import/learning_acd_records.json` | 選用的 938 筆 ACD 原始記錄及本地摘錄 SHA-256 |

`scripts/learning.py` 驗證來源及對應，產生 `dist/data/learning/concepts.json` 與逐詞的 `words/<entry_id>.json`。前端以模式及詞項共同作為快取鍵；不一次下載所有詞形。無學習詞表的合成測試與空白模板仍可建置，學習模式選項停用。

每次建置另產生 `dist/data/learning/reports/`，網站「關於」視窗提供統計、缺項與近義清單連結：

| 報告 | 內容 |
| --- | --- |
| `summary.json` | 各語言涵蓋率、補入與缺項數量 |
| `additions.json` | 祖語及現代語言補入的來源、原義與對應說明 |
| `near_matches.json` | 近義與較廣／較窄義，供後續語言專家校訂 |
| `missing.json` | 每個缺項的原編號、中文與語言別 |
| `gloss_variants.json` | 同編號在不同語言別的原始釋義差異 |
| `concept_matches.json`、`sources.json` | 完整對應表與來源明細 |

維護時直接調整正式對應 JSON；關係 `equivalent`、`near`、`broader`、`narrower` 都以「來源詞義相對於學習詞義」為方向。對照關係僅供導覽，不整批複製基礎詞彙的合併形式。祖語對應以 Form ID 逐筆明列，沒有相應 PMP 來源時保持缺項，不使用 PAn 代補。未找到可靠來源的概念保持空陣列，不生成形式。

更新 `learning.csv` 後須覆核編號、詞義與來源關係，再更新 `learning_matches.json` 的 `source_sha256`、預期列數與版本；未覆核的來源變更會使 `--check` 失敗。新增 ACD Form ID 時同步加入原始記錄，刪除不再使用的摘錄，避免來源漂移。一般建置仍只需 Python 標準函式庫。

## 手動維護

source/ 是正式資料來源；dist/ 為產生的網站，未納入 Git。可直接編輯 source/varieties.json 的 latitude、longitude、location_note，或修改 source/swadesh.csv 的詞形。

CSV 表頭：

~~~csv
concept_id,variety_id,orth,ipa,note
~~~

每個 concept_id × variety_id 最多一筆。orth 必填，ipa、note 可留白；未提供 IPA 時，前端隱藏音標欄位。CSV 支援 UTF-8、BOM、引號、逗號與欄位內換行。拼寫、星號與音標按資料原樣顯示。

概念記錄：

~~~json
{"id":"water","swadesh_number":145,"gloss_en":"water","gloss_zh":"水"}
~~~

語言別記錄：

~~~json
{
  "id": "ami_nt",
  "name": "南勢阿美語",
  "native_name": null,
  "type": "dialect",
  "subgroup_id": "ami",
  "latitude": 23.97,
  "longitude": 121.60,
  "klokah_code": "ami_nt",
  "klokah_number": 1,
  "location_note": "花蓮吉安一帶"
}
~~~

type 可為 language、dialect、proto。subgroup_id 指向分類；群的 parent_id 形成單一根節點的樹，proto_variety_id 可指定該群的祖語。ID 使用小寫英文字母開頭，後接小寫英文字母、數字或底線。

42 語言別代碼取自 klokah/commands/kl.py。座標以代表聚落附近的位置初填，供後續調整；區域分布參考 [原民會族群分布](https://www.cip.gov.tw/zh-tw/menu/data-list/6726E5B80C8822F9-info.html?cumid=6726E5B80C8822F9)、[布農族介紹](https://www.cip.gov.tw/zh-tw/tribe/grid-list/F39C8394699DD2D6D0636733C6861689/info.html?cumid=FF8E0A73EBC8DFA2A698DC8F96468B9E)與[魯凱族介紹](https://www.cip.gov.tw/zh-tw/tribe/grid-list/409F703B4E592A82D0636733C6861689/info.html?cumid=D0636733C6861689)。數值為人工概估，並非上述來源提供的精確座標。PAn 設在台南新化（23.04, 120.31），PMP 設在台東市近海（22.75, 121.20）。

分類先以語言名稱分組於南島語系之下，雅美語置於馬來玻里尼西亞語族；多層分類可直接在 subgroups.json 調整。

### 重新匯入

匯入工具需 openpyxl 讀取 XLSX；例行建置與測試只需 Python 標準函式庫。匯入工具讀取本地來源，依 source/import/ 的對應重建五份 CSV/JSON 產物，不更動語言座標或概念表。

~~~sh
python3 scripts/import_lexicon.py \
  --excel-dir /path/to/excel \
  --acd-dir /path/to/acd-2.0 \
  --klokah-dir /path/to/klokah \
  --out .work/reimport
~~~

比對新產物後再放回 source/；省略 --out 會直接更新 source/ 中的產生檔，包括手動編輯過的詞形 CSV。對應原則見 source/import/README.md。

### 資料驗證

~~~sh
python3 scripts/build.py --check
~~~

建置器檢查概念與語言 ID、重複詞形、必要欄位、座標、分類循環及祖語關聯。通過後才替換 dist/。templates/ 提供空白資料格式，tests/fixtures/ 提供獨立的合成測試資料。

## 地圖操作與地理圖層

- 選擇基礎詞彙或學習詞表，搜尋中文、英文、編號；預設顯示「水」。
- 「語言別」與「原始語言」開關同步控制地圖、清單及詳情。
- 展開分類樹，按「查看此語群」篩選子群與祖語。
- 點選地圖或清單查看詞形、來源、IPA 與位置。
- 文字標籤避讓時以細線連回原座標；完整詞形也可由清單查看。
- 分享網址支援重新整理及上一頁／下一頁。
- 手機版或主要使用觸控的裝置，單指在地圖上滑動會捲動頁面，兩指可平移及縮放地圖；桌面仍可用滑鼠拖曳。地圖至少四分之一進入畫面時，首次顯示半透明操作提示，點按或 5 秒後關閉。同一分頁工作階段只顯示一次；瀏覽器不允許 sessionStorage 時改為每次載入只顯示一次。

Natural Earth 島嶼輪廓與 HydroRIVERS 水系都使用 WGS84，投影至 Leaflet EPSG:3857。兩層共用 SVG 座標範圍。水系依底圖海岸加上 SVG clipPath，河口顯示止於海岸；縮放、拖曳與視窗調整沿用完整路徑，原始 GeoJSON 座標保留。底圖載入失敗時，水系等待海岸遮罩，重試底圖後恢復顯示。

水系保留 HydroRIVERS v1.0 ORD_CLAS 1、全長至少 40 公里的主流。換來源時執行 scripts/prepare_rivers.py，需 pyshp 與 Shapely；日常建置使用已整理的本地 GeoJSON。底圖包含澎湖、綠島與蘭嶼。

語料、祖語形式、IPA 與詞形備註使用隨網站提供的 Gentium 7.000 襯線字體，含原生正常體、半粗體及半粗斜體；中文沿用系統襯線字體。字型載入完成後會重新排列地圖標籤。

Leaflet 與地理資料隨網站發布；來源、授權見 THIRD_PARTY_NOTICES.md。

## 瀏覽器測試

~~~sh
node tests/browser_smoke.mjs
~~~

需 Playwright；PLAYWRIGHT_MODULE 可指定套件目錄，CHROME_EXECUTABLE 可指定 Chrome，PYTHON 可指定 Python。測試涵蓋正式資料、子路徑、搜尋、篩選、IPA 留白、下載失敗重試、請求競態、地圖遮罩、標籤與手機畫面，以及學習模式的原編號、異義搜尋、近義補入、模式歷史導覽、跨模式請求競態與減少動態效果。截圖輸出至 .work/browser-smoke/。

左下角 k 連按五次可載入 999 合成示範語料；切回一般詞項或重新整理即回到正式資料。

## 社群分享預覽

首頁 SEO 使用固定標題「kaladaxe｜臺灣原住民族語言詞彙地圖」，搜尋描述與 Open Graph／Twitter 分享文案都直接寫入 HTML，無需 JavaScript 即可讀取。模式與詞項切換保留首頁標題；帶有 `concept` 或 `mode` 的互動網址仍可分享，其 canonical 統一指向 `https://rngagi.github.io/kaladaxe/`。本階段只處理首頁，沒有新增詞項 HTML 頁面。

首頁附 `WebPage` JSON-LD，名稱、描述與圖片和 HTML metadata 一致；不將專案子路徑宣告成網域層級的網站名稱設定。`site/sitemap.xml` 隨建置發布至 `https://rngagi.github.io/kaladaxe/sitemap.xml`，只列首頁，可提交至 Google Search Console；更新時不要加入互動參數網址或不實的每日更新日期。更換正式網址時同步更新 canonical、Open Graph、JSON-LD、sitemap 及測試。

`robots.txt` 必須位於主機根目錄 `https://rngagi.github.io/robots.txt` 才生效，因此本專案不產生 `/kaladaxe/robots.txt`。Search Console 驗證與網站地圖提交需另外連接相應帳號；本次變更不包含帳號設定或提交。

`site/index.html` 提供靜態 Open Graph 與 Twitter Card 標題、說明及圖片，分享爬蟲不需執行 JavaScript。正式分享網址為 `https://rngagi.github.io/kaladaxe/`；更換網域或部署路徑時，需同步更新分享網址與圖片的絕對網址。

`site/assets/social-preview.png` 為 1200 × 630 圖片，沿用網站 logo、底圖與水系。圖片已納入 Git，例行建置不需 Chrome；要重製圖片時，先依前述方式建置並啟動本地預覽，再執行：

~~~sh
node scripts/render_social_preview.mjs
python3 scripts/build.py
~~~

渲染工具使用與瀏覽器測試相同的 `PLAYWRIGHT_MODULE`、`CHROME_EXECUTABLE` 設定，也可用第一個參數指定本地預覽網址。

## GitHub Pages

推送 main 後，GitHub Actions 執行測試、建置並發布 dist/。PR 事件執行測試與建置。

在 repository 的 Settings → Pages 將 Source 設為 GitHub Actions。網站：[rngagi.github.io/kaladaxe](https://rngagi.github.io/kaladaxe/)。
