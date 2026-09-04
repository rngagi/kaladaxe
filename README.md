# kaladaxe

台灣原住民族語言 Swadesh 207 詞彙地圖。純 HTML/CSS、Vanilla JavaScript 與 Leaflet；Python 只在建置時執行，不需要 backend、資料庫、CMS、npm 或 API key。

## 本機建置與預覽

需要 Python 3.10 以上版本。在專案根目錄執行：

~~~sh
python3 -m unittest discover -s tests -v
python3 scripts/build.py
python3 -m http.server 8000 --directory dist
~~~

開啟 http://localhost:8000/ 。請透過 HTTP 預覽，直接開啟 HTML 檔案的 file:// 網址無法正確載入模組與 JSON。

第一版已整理 207 個概念，正式族語資料留白。地圖顯示「詞彙，正待收錄」是正常狀態；不會將合成資料當作真實詞形展示。

## 人工維護資料

只有 source/ 是正式資料來源。dist/ 由建置器產生，不要手動修改，也不納入 Git。

| 檔案 | 用途 |
| --- | --- |
| source/concepts.json | 固定概念 ID、Swadesh 編號、中英文 gloss、詞表來源 |
| source/subgroups.json | 手動定義的多層分類樹 |
| source/varieties.json | 語言／方言／proto 的名稱、分類、座標、metadata |
| source/swadesh.csv | 書寫形式 orth、IPA 及備註 |

建議先定義語群，再加入 variety，最後填詞彙。proto 關聯與 variety 可在同一次修改中加入。

### 空白模板

templates/ 提供四份可建置的空白模板：swadesh.csv、concepts.json、varieties.json、subgroups.json。JSON 陣列留空；概念模板保留 source 與 items 外層結構。使用者可自行填入下列記錄結構。

**source/concepts.json 已有完整 207 概念，不要為了開始填族語而用空白概念模板覆蓋它。**

概念記錄：

~~~json
{
  "id": "water",
  "swadesh_number": 150,
  "gloss_en": "water",
  "gloss_zh": "水"
}
~~~

整份概念檔為 {"source": {...}, "items": [...]}。詞表採 Wikipedia「Swadesh 207 list」指定版本，來源連結、revision、日期保存在 source。英文保留單複數、詞義與詞性區別；繁體中文為本專案整理，供人工校訂。概念 ID 不隨 gloss 更名而改變。

語群記錄（以下皆為結構示例，不代表實際分類）：

~~~json
[
  {"id": "sample_family", "name": "示例語系", "parent_id": null},
  {"id": "sample_group", "name": "示例語群", "parent_id": "sample_family",
   "proto_variety_id": "sample_proto"}
]
~~~

- 空分類陣列有效；非空分類樹必須有一個根節點。
- 每個群只有一個 parent_id，不得形成循環。
- proto_variety_id 可省略或為 null。
- 指定的重建語必須是 type: "proto"，且它的 subgroup_id 必須指回此群。
- 分類表達人工採用的語言關係，不自動推導詞源或同源詞。

variety 記錄：

~~~json
{
  "id": "sample_proto",
  "name": "示例重建語",
  "native_name": null,
  "type": "proto",
  "subgroup_id": "sample_group",
  "latitude": 24.0,
  "longitude": 120.5,
  "iso639_3": null,
  "glottocode": null,
  "location_note": "僅作展示的手動位置。"
}
~~~

- type 只接受 language、dialect、proto。
- 名稱必填，native_name 可為 null；ISO 與 Glottocode 為可選文字，不是主鍵。
- latitude 與 longitude 為必填數字，使用 WGS84 經緯度。座標應分別在 −90～90、−180～180 範圍內。
- 所有 proto 座標都只表示「展示位置」，不表達推定祖居地。
- 地理位置可以重複；所有形式仍可由清單逐筆查看。
- ID 使用小寫英文字母開頭，其後只使用小寫英文字母、數字或底線。

CSV 表頭固定為：

~~~csv
concept_id,variety_id,orth,ipa,note
~~~

每個 concept_id × variety_id 最多一筆；orth 與 ipa 都不可空白。未知或尚不完整的形式先不建立列，note 可空。UTF-8（含 BOM）皆支援。試算表軟體可另存為 UTF-8 CSV。

逗號、引號或換行需按 CSV 規則引用，例如此合成示例：

~~~csv
water,sample_proto,*TEST,*tɛst,"示例備註，""引號""。"
~~~

建置不會自動加上星號、斜線或方括號，也不會正規化／改寫 IPA、大小寫、組合附加符號。請在 orth／ipa 原樣填入希望顯示的完整形式。metadata 與 note 是純文字，不支援 HTML。

### 資料驗證

~~~sh
python3 scripts/build.py --check
~~~

未知 ID、重複詞彙組合、缺必要欄位、非法座標、分類循環、錯誤重建語關聯均阻止建置，並指出檔案與行號或 ID。CSV 跨行欄位的行號指向該筆資料的結束行。

建置器先完成驗證並準備暫存產物，再替換輸出。驗證失敗不更動上一次產物；成功建置會移除舊產物。輸出必須是新目錄，或包含 .kaladaxe-build 標記的既有建置目錄，不可與 source/、site/ 等來源重疊。

## 合成資料預覽與測試

~~~sh
python3 scripts/build.py --source tests/fixtures --out .work/preview/repo
python3 -m http.server 8001 --directory .work/preview
~~~

開啟 http://localhost:8001/repo/ 。頁面上方有「合成測試資料」提示，包含重建語、多層語群、同座標、長詞形、缺詞與特殊字元。這些 fixtures 不會進入正式 dist/。

Python 測試只需標準函式庫。另提供 tests/browser_smoke.mjs 以 Playwright 實際驗證網站根目錄與 /repo/、按需載入、重試、競態、標籤排列、選取、篩選及手機版。這是可選的開發測試工具，網站建置與發布不依賴 Node。

若開發環境已有 Playwright：

~~~sh
node tests/browser_smoke.mjs
~~~

如果 Playwright 安裝在其他位置，設定 PLAYWRIGHT_MODULE 為套件絕對目錄；使用系統 Chrome 時可設定 CHROME_EXECUTABLE 為瀏覽器執行檔路徑。PYTHON 可指定 Python 執行檔。測試腳本自行建立暫存網站與本機 HTTP server，結束後清除；截圖輸出於 .work/browser-smoke/。

## 網站操作

- 搜尋詞項編號、中英文 gloss，預設開啟 water（第 150 詞）。
- 語群分類樹可展開；「查看此語群」包含所有子群及其重建語。
- 清單與地圖共用選取狀態；詳情提供 orth、IPA、分類路徑與位置說明。
- 文字與 variety 名稱小幅避讓（相對預設位置最多 48 CSS px），移位時以細線連回原座標；排不下只隱藏文字，marker 保留。
- 正在查看的標籤優先。細線只表示文字與 marker 的對應，不表示語言親緣或遷徙。
- 完全同座標可從完整清單逐筆查看，不修改資料座標。
- 分享網址使用 ?concept=water，支援重新整理及上一頁／下一頁。
- 「尚未收錄」表示這份資料尚不完整，不代表語言不存在該概念。

## 檔案與資料流

~~~text
source/ → scripts/build.py → dist/
site/   ────────────────────┘
                             ├── index.html
                             ├── assets/
                             └── data/
                                 ├── concepts.json
                                 ├── varieties.json
                                 ├── subgroups.json
                                 └── words/<concept_id>.json
~~~

app.js 負責頁面與狀態，data.js 負責 JSON 載入與請求快取，map.js 負責 Leaflet、marker 與標籤。初次只下載 metadata、地理輪廓和一個詞項；沒有全部詞彙預載或 service worker。失敗請求可重試，過期回應不更新目前畫面。

Leaflet 與地理輪廓隨網站發布；不使用外部圖磚或網路字體。字體依裝置可用的 Noto Serif TC、Songti TC、Georgia 與系統字體顯示，字形可能略有差異。

## GitHub Pages

1. 免費方案使用公開 repository。若 repository 為私有，先確認 GitHub 方案是否支援；更改為公開會公開程式碼與歷史紀錄。
2. 在 repository 的 Settings → Pages → Build and deployment，將 Source 設為 GitHub Actions。
3. 將程式推送至 main。workflow 執行 Python 測試、建置並發布 dist/。
4. workflow 成功後，開啟 https://rngagi.github.io/kaladaxe/ 。

workflow 的 PR 事件只測試與建置，不部署。部署使用 github-pages environment，權限僅為 contents: read、pages: write、id-token: write。若變更預設分支名稱，同步更新 workflow 的 push.branches。

所有本地資源使用相對路徑，JSON 以模組位置為基準，不依賴 repository 名稱。部署失敗不替換既有 Pages 站點。

來源、授權與地理資料處理方式見 THIRD_PARTY_NOTICES.md。
