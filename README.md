# kaladaxe

臺灣原住民族語言「基礎詞彙200+」地圖。自訂詞表含 214 個概念、42 語言別，以及原始南島語（PAn）與原始馬來玻里尼西亞語（PMP）。

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

詞表由 kaladaxe 自行編排。原有概念 ID 保持固定，數詞移至最後，依一至十、二十、一百排列，總計 214 詞。內部欄位 swadesh_number 與檔名 swadesh.csv 沿用既有格式，前端統一顯示「基礎詞彙200+」。重新編號後，water 為第 145 詞；分享網址仍使用 ?concept=water。

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
| source/import/ | 可編輯的中文詞義對應與 ACD Form ID 選擇 |

目前地圖收錄 8,396 筆概念 × 語言別組合，42 語言別各涵蓋 187–192 詞；PAn 183 詞，PMP 206 詞。PMP 的雲、唱歌、雪、二十以對應 PAn 形式補入，各詞備註及來源表皆有標記。無來源形式的概念留在缺項清單。

語意對應採明列的中文詞義與 ACD Form ID。詞條包含多個形式時保留來源拼寫；同一概念有多個來源詞條時以「 / 」並列，原始詞義與使用範圍保存在備註。Excel 的「無此詞彙」保留於 learning.csv，地圖不將它當作詞形。來源未附 IPA，匯入時留白。

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
  "location_note": "花蓮吉安一帶（概略座標，可調整）"
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

- 搜尋中文、英文、編號；預設顯示「水」。
- 「語言別」與「原始語言」開關同步控制地圖、清單及詳情。
- 展開分類樹，按「查看此語群」篩選子群與祖語。
- 點選地圖或清單查看詞形、來源、IPA 與位置。
- 文字標籤避讓時以細線連回原座標；完整詞形也可由清單查看。
- 分享網址支援重新整理及上一頁／下一頁。

Natural Earth 島嶼輪廓與 HydroRIVERS 水系都使用 WGS84，投影至 Leaflet EPSG:3857。兩層共用 SVG 座標範圍。水系依底圖海岸加上 SVG clipPath，河口顯示止於海岸；縮放、拖曳與視窗調整沿用完整路徑，原始 GeoJSON 座標保留。底圖載入失敗時，水系等待海岸遮罩，重試底圖後恢復顯示。

水系保留 HydroRIVERS v1.0 ORD_CLAS 1、全長至少 40 公里的主流。換來源時執行 scripts/prepare_rivers.py，需 pyshp 與 Shapely；日常建置使用已整理的本地 GeoJSON。底圖包含澎湖、綠島與蘭嶼。

Leaflet 與地理資料隨網站發布；來源、授權見 THIRD_PARTY_NOTICES.md。

## 瀏覽器測試

~~~sh
node tests/browser_smoke.mjs
~~~

需 Playwright；PLAYWRIGHT_MODULE 可指定套件目錄，CHROME_EXECUTABLE 可指定 Chrome，PYTHON 可指定 Python。測試涵蓋正式資料、子路徑、搜尋、篩選、IPA 留白、下載失敗重試、請求競態、地圖遮罩、標籤與手機畫面。截圖輸出至 .work/browser-smoke/。

左下角 k 連按五次可載入 999 合成示範語料；切回一般詞項或重新整理即回到正式資料。

## GitHub Pages

推送 main 後，GitHub Actions 執行測試、建置並發布 dist/。PR 事件執行測試與建置。

在 repository 的 Settings → Pages 將 Source 設為 GitHub Actions。網站：[rngagi.github.io/kaladaxe](https://rngagi.github.io/kaladaxe/)。
