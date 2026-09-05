import { createDataStore } from "./data.js";
import { createAtlas } from "./map.js";

const $ = (id) => document.getElementById(id);
const store = createDataStore();
const typeNames = { language: "語言", dialect: "方言", proto: "原始語言" };
let atlas;
let concepts = [];
let varieties = [];
let groups = [];
let conceptIndex = new Map();
let varietyIndex = new Map();
let groupIndex = new Map();
let currentId = null;
let selectedId = null;
let filterId = null;
let word = null;
let requestVersion = 0;
let initialized = false;
let booting = false;
let loadState = "loading";
let showLanguages = true;
let showProto = false;
let editorialData = null;
let demoData = null;
let demoActive = false;
let retryDemo = false;
let debugClicks = 0;
let lastDebugClick = 0;

function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function hasForm(id) {
  return word !== null && Object.hasOwn(word.forms, id);
}

function isInGroup(variety, target = filterId) {
  if (!target) return true;
  let id = variety.subgroup_id;
  while (id) {
    if (id === target) return true;
    id = groupIndex.get(id)?.parent_id;
  }
  return false;
}

function typeIsVisible(variety) {
  return variety.type === "proto" ? showProto : showLanguages;
}

function visibleVarieties() {
  return varieties.filter((variety) => isInGroup(variety) && typeIsVisible(variety));
}

function pathOf(variety) {
  const names = [];
  let id = variety.subgroup_id;
  while (id) {
    const group = groupIndex.get(id);
    if (!group) break;
    names.unshift(group.name);
    id = group.parent_id;
  }
  return names.join(" › ");
}

function notice(title, message, retry = false) {
  $("map-notice").hidden = !title;
  $("notice-title").textContent = title;
  $("notice-text").textContent = message;
  $("retry").hidden = !retry;
  atlas?.schedule();
}

function syncSelection() {
  document.querySelectorAll("[data-select-variety]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.selectVariety === selectedId));
  });
}

function showDetail(id, reveal = false) {
  const variety = varietyIndex.get(id);
  if (!variety || !hasForm(id) || !isInGroup(variety) || !typeIsVisible(variety)) return;
  selectedId = id;
  const form = word.forms[id];
  $("detail-type").textContent = typeNames[variety.type];
  $("detail-name").textContent = variety.name;
  $("detail-native").textContent = variety.native_name || "";
  $("detail-native").hidden = !variety.native_name;
  $("detail-orth").textContent = form.orth;
  $("detail-ipa").textContent = form.ipa;
  $("detail-ipa").hidden = !form.ipa?.trim();
  $("detail-ipa-label").hidden = !form.ipa?.trim();
  $("detail-note").textContent = form.note;
  $("detail-note").hidden = !form.note;
  $("detail-id").textContent = id;
  const metadata = $("detail-metadata");
  metadata.replaceChildren();
  const fields = [
    ["語群分類", pathOf(variety)],
    [variety.type === "proto" ? "地圖位置" : "地圖座標",
      Math.abs(variety.latitude).toFixed(4) + (variety.latitude < 0 ? "° S / " : "° N / ") + Math.abs(variety.longitude).toFixed(4) + (variety.longitude < 0 ? "° W" : "° E")],
    ["位置說明", variety.location_note],
    ["ISO 639-3", variety.iso639_3],
    ["Glottocode", variety.glottocode],
  ];
  for (const [label, value] of fields) {
    if (value) metadata.append(node("dt", "", label), node("dd", "", value));
  }
  $("detail").hidden = false;
  syncSelection();
  atlas.select(id, reveal);
}

function closeDetail(restoreFocus = false) {
  const previous = selectedId;
  selectedId = null;
  $("detail").hidden = true;
  syncSelection();
  atlas?.select(null);
  if (restoreFocus && previous) {
    const trigger = Array.from($("results").querySelectorAll("button")).find((button) => button.dataset.selectVariety === previous);
    (trigger || $("concept-search")).focus();
  }
}

function makeVarietyButton(variety, proto = false) {
  const button = node("button", "group-button group-member");
  button.type = "button";
  button.dataset.selectVariety = variety.id;
  button.setAttribute("aria-pressed", "false");
  if (proto) button.append(node("span", "proto-tag", "原始語言"));
  button.append(node("span", "", variety.name));
  button.addEventListener("click", () => {
    if (!isInGroup(variety)) applyFilter(variety.subgroup_id);
    showDetail(variety.id, true);
  });
  return button;
}

function renderTree() {
  const tree = $("group-tree");
  tree.replaceChildren();
  function renderGroup(group) {
    const details = node("details", "group-node");
    details.open = true;
    const summary = node("summary", "", group.name);
    const children = node("div", "group-children");
    const filter = node("button", "group-button", "查看此語群");
    filter.type = "button";
    filter.dataset.filterGroup = group.id;
    filter.setAttribute("aria-pressed", "false");
    filter.addEventListener("click", () => applyFilter(group.id));
    children.append(filter);
    if (group.proto_variety_id) children.append(makeVarietyButton(varietyIndex.get(group.proto_variety_id), true));
    for (const variety of varieties.filter((item) => item.subgroup_id === group.id && item.id !== group.proto_variety_id)) {
      children.append(makeVarietyButton(variety, variety.type === "proto"));
    }
    for (const child of groups.filter((item) => item.parent_id === group.id)) children.append(renderGroup(child));
    details.append(summary, children);
    return details;
  }
  for (const root of groups.filter((group) => group.parent_id === null)) tree.append(renderGroup(root));
  $("tree-empty").hidden = groups.length > 0;
  $("variety-count").textContent = varieties.length;
}

function applyFilter(id) {
  filterId = id;
  $("filter-label").textContent = id ? groupIndex.get(id).name : "全部語群";
  $("all-groups").classList.toggle("active", id === null);
  $("all-groups").setAttribute("aria-pressed", String(id === null));
  document.querySelectorAll("[data-filter-group]").forEach((button) => {
    const active = button.dataset.filterGroup === id;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (selectedId && !isInGroup(varietyIndex.get(selectedId))) closeDetail();
  renderWord();
}

function renderConcepts() {
  const query = $("concept-search").value.trim().toLocaleLowerCase().normalize("NFC");
  const matches = concepts.filter((concept) =>
    [concept.swadesh_number, concept.gloss_zh, concept.gloss_en].some((value) => String(value).toLocaleLowerCase().normalize("NFC").includes(query)));
  const list = $("concept-list");
  list.replaceChildren();
  for (const concept of matches) {
    const button = node("button", "concept-button");
    button.type = "button";
    button.dataset.conceptId = concept.id;
    button.setAttribute("aria-current", String(concept.id === currentId));
    const english = node("span", "english", concept.gloss_en);
    english.lang = "en";
    button.append(node("span", "number", String(concept.swadesh_number).padStart(3, "0")), node("span", "", concept.gloss_zh), english);
    button.addEventListener("click", () => selectConcept(concept.id, "push"));
    list.append(button);
  }
  $("search-empty").hidden = matches.length > 0;
}

function syncConcept() {
  const concept = conceptIndex.get(currentId);
  $("current-series").textContent = demoActive ? "DEMO" : "基礎詞彙200+";
  $("current-number").textContent = concept?.swadesh_number || "—";
  $("current-zh").textContent = concept?.gloss_zh || "探索詞彙";
  $("current-en").textContent = concept?.gloss_en || "";
  document.title = (concept ? concept.gloss_zh + " · " : "") + "kaladaxe · 基礎詞彙200+ 地圖";
  document.querySelectorAll("[data-concept-id]").forEach((button) => {
    button.setAttribute("aria-current", String(button.dataset.conceptId === currentId));
  });
}

function renderWord() {
  const visible = visibleVarieties();
  const available = visible.filter((variety) => hasForm(variety.id));
  const missing = visible.filter((variety) => !hasForm(variety.id));
  $("results").replaceChildren();
  $("missing-results").replaceChildren();
  $("result-count").textContent = available.length;
  $("coverage").textContent = loadState === "ready"
    ? available.length + " / " + visible.length + " 個變體已收錄" : loadState === "loading" ? "資料載入中" : "載入失敗";
  $("missing-section").hidden = loadState !== "ready" || !missing.length;
  $("missing-count").textContent = missing.length;
  for (const variety of missing) $("missing-results").append(node("li", "", variety.name));
  for (const variety of available) {
    const form = word.forms[variety.id];
    const item = node("li");
    const button = node("button", "result-button");
    button.type = "button";
    button.dataset.selectVariety = variety.id;
    button.setAttribute("aria-pressed", String(variety.id === selectedId));
    const name = node("span", "result-name", variety.name);
    if (variety.type === "proto") name.append(node("span", "proto-tag", "原始語言"));
    const orth = node("span", "result-orth", form.orth);
    orth.dir = "auto";
    const ipa = node("span", "result-ipa", form.ipa);
    ipa.dir = "ltr";
    button.append(name, orth);
    if (form.ipa?.trim()) button.append(ipa);
    button.addEventListener("click", () => showDetail(variety.id, true));
    item.append(button);
    $("results").append(item);
  }
  $("group-tree").querySelectorAll("[data-select-variety]").forEach((button) => {
    button.hidden = !typeIsVisible(varietyIndex.get(button.dataset.selectVariety));
    button.disabled = !hasForm(button.dataset.selectVariety);
    button.title = button.disabled ? "此詞項尚未收錄" : "查看詞彙詳情";
  });
  $("variety-count").textContent = varieties.filter(typeIsVisible).length;
  if (loadState === "loading") {
    $("results-message").textContent = "正在讀取這個詞項…";
    notice("正在讀取詞彙", "稍候片刻，也可以繼續選擇其他詞項。");
  } else if (loadState === "error") {
    $("results-message").textContent = "詞彙下載失敗，請重試。";
    notice("暫時無法讀取詞彙", "請檢查連線並重新載入。", true);
  } else if (!showLanguages && !showProto) {
    $("results-message").textContent = "請開啟至少一種顯示類別。";
    notice("尚未開啟語言圖層", "勾選「語言別」或「原始語言」以查看詞彙。");
  } else if (!varieties.length) {
    $("results-message").textContent = "詞彙會隨資料整理逐步加入。";
    notice("詞彙，正待收錄", "加入語言與詞彙資料後即可查看。");
  } else if (!visible.length && varieties.some((variety) => isInGroup(variety))) {
    $("results-message").textContent = "目前顯示類別沒有資料。";
    notice("此類別沒有可顯示的資料", "試試開啟另一種顯示類別，或選擇其他語群。");
  } else if (!visible.length) {
    $("results-message").textContent = "這個語群尚無語言資料。";
    notice("此語群尚無資料", "選擇其他語群，或回到全部語群。");
  } else if (!available.length) {
    $("results-message").textContent = "此詞項在目前語群中尚未收錄。";
    notice("這個詞，尚待補齊", "目前語群尚未收錄這個詞。試試其他詞項或語群。");
  } else {
    $("results-message").textContent = "";
    notice("", "");
  }
  $("results-message").hidden = !($("results-message").textContent);
  atlas.setData(available.map((variety) => ({ variety, form: word.forms[variety.id] })), selectedId);
  if (selectedId && hasForm(selectedId) && isInGroup(varietyIndex.get(selectedId)) && typeIsVisible(varietyIndex.get(selectedId))) showDetail(selectedId);
  syncSelection();
}

function updateURL(mode) {
  if (demoActive) return; // Debug is session-only and never becomes a shareable concept URL.
  const url = new URL(location.href);
  if (currentId) url.searchParams.set("concept", currentId);
  else url.searchParams.delete("concept");
  if (mode === "push" && url.href !== location.href) history.pushState(null, "", url);
  else if (mode === "replace") history.replaceState(null, "", url);
}

async function selectConcept(id, mode = "none") {
  const next = conceptIndex.has(id) ? id : conceptIndex.has("water") ? "water" : concepts[0]?.id;
  const useDemo = Boolean(demoData && next === demoData.concept.id);
  if (useDemo !== demoActive) {
    demoActive = useDemo;
    const dataset = useDemo ? demoData : editorialData;
    varieties = dataset.varieties;
    groups = dataset.subgroups;
    varietyIndex = new Map(varieties.map((item) => [item.id, item]));
    groupIndex = new Map(groups.map((item) => [item.id, item]));
    filterId = null;
    selectedId = null;
    $("filter-label").textContent = "全部語群";
    $("all-groups").classList.add("active");
    $("all-groups").setAttribute("aria-pressed", "true");
    renderTree();
  }
  $("demo-notice").hidden = !demoActive;
  retryDemo = false;
  currentId = next || null;
  syncConcept();
  updateURL(next !== id ? "replace" : mode);
  const version = ++requestVersion;
  const previousSelection = selectedId;
  word = null;
  loadState = "loading";
  $("detail").hidden = true;
  renderWord();
  if (!next) {
    loadState = "ready";
    selectedId = null;
    renderWord();
    notice("尚無詞項", "概念清單尚未收錄。");
    return;
  }
  try {
    const data = useDemo ? { concept_id: next, forms: demoData.forms } : await store.loadWord(next);
    if (version !== requestVersion) return;
    word = data;
    loadState = "ready";
    // A new selection is possible only after this request has completed.
    selectedId = previousSelection && hasForm(previousSelection) && isInGroup(varietyIndex.get(previousSelection)) && typeIsVisible(varietyIndex.get(previousSelection))
      ? previousSelection : null;
  } catch {
    if (version !== requestVersion) return;
    loadState = "error";
    selectedId = null;
  }
  renderWord();
}

async function boot() {
  if (booting) return;
  booting = true;
  $("retry").disabled = true;
  notice("正在準備地圖", "讀取詞項與語言分類。");
  try {
    if (!atlas) atlas = createAtlas($("map"), (id) => showDetail(id), (failed) => { $("basemap-error").hidden = !failed; }, (failed) => { $("rivers-error").hidden = !failed; });
    const index = await store.loadIndex();
    editorialData = { varieties: index.varieties, subgroups: index.subgroups };
    concepts = index.concepts.items;
    varieties = index.varieties;
    groups = index.subgroups;
    conceptIndex = new Map(concepts.map((item) => [item.id, item]));
    varietyIndex = new Map(varieties.map((item) => [item.id, item]));
    groupIndex = new Map(groups.map((item) => [item.id, item]));
    initialized = true;
    $("concept-count").textContent = concepts.length;
    document.querySelector(".search-hint").textContent = concepts.length + " 詞";
    $("source-version").textContent = "版本：" + (index.concepts.source.version || "自訂詞表") + "。";
    $("concept-search").disabled = false;
    renderTree();
    const fromURL = new URL(location.href).searchParams.get("concept");
    renderConcepts();
    await selectConcept(fromURL || "water", "replace");
    const active = $("concept-list").querySelector('[aria-current="true"]');
    if (active) $("concept-list").scrollTop = active.offsetTop - $("concept-list").offsetTop - 30;
  } catch {
    initialized = false;
    $("coverage").textContent = "載入失敗";
    $("results-message").textContent = "目前無法載入詞項與分類。";
    notice("地圖資料載入失敗", "請檢查連線並重試。", true);
  } finally {
    booting = false;
    $("retry").disabled = false;
  }
}

async function enterDemo() {
  if (!initialized) return;
  const version = ++requestVersion;
  try {
    const data = await store.loadDemo();
    if (version !== requestVersion) return;
    demoData = data;
    conceptIndex.set(data.concept.id, data.concept);
    await selectConcept(data.concept.id);
  } catch {
    if (version !== requestVersion) return;
    retryDemo = true;
    notice("示範語料載入失敗", "請檢查連線並重新載入。", true);
  }
}

$("debug-trigger").addEventListener("click", () => {
  const now = performance.now();
  debugClicks = now - lastDebugClick > 3000 ? 1 : debugClicks + 1;
  lastDebugClick = now;
  if (debugClicks === 5) {
    debugClicks = 0;
    enterDemo();
  }
});

function updateVisibility() {
  showLanguages = $("show-languages").checked;
  showProto = $("show-proto").checked;
  if (selectedId && !typeIsVisible(varietyIndex.get(selectedId))) closeDetail();
  if (initialized) renderWord();
}

$("show-languages").addEventListener("change", updateVisibility);
$("show-proto").addEventListener("change", updateVisibility);
$("rivers-retry").addEventListener("click", () => atlas?.loadRivers());
$("concept-search").addEventListener("input", renderConcepts);
$("all-groups").addEventListener("click", () => { if (initialized) applyFilter(null); });
$("detail-close").addEventListener("click", () => closeDetail(true));
$("retry").addEventListener("click", () => retryDemo ? enterDemo() : initialized ? selectConcept(currentId) : boot());
$("basemap-retry").addEventListener("click", () => atlas?.loadBasemap());
$("about-open").addEventListener("click", () => $("about-dialog").showModal());
$("about-close").addEventListener("click", () => $("about-dialog").close());
$("about-dialog").addEventListener("click", (event) => {
  const rect = $("about-dialog").getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $("about-dialog").close();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("about-dialog").open && !$("detail").hidden) closeDetail(true);
});
window.addEventListener("popstate", () => {
  if (initialized) selectConcept(new URL(location.href).searchParams.get("concept") || "water");
});
if (matchMedia("(max-width: 760px)").matches) {
  document.querySelector(".classification-section").open = false;
  document.querySelector(".results-section").open = false;
}
boot();
