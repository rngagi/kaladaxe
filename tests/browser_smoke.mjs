// Optional browser acceptance checks. No Node dependency is needed to build the site.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const python = process.env.PYTHON || "python3";
const temp = await mkdtemp(join(tmpdir(), "kaladaxe-browser-"));
const site = join(temp, "site");
const screenshots = join(root, ".work/browser-smoke");
await mkdir(screenshots, { recursive: true });
let server;
let browser;
let passed = 0;

function buildSite(source, output) {
  const result = spawnSync(python, ["scripts/build.py", "--source", source, "--out", output], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function port() {
  const socket = createServer();
  await new Promise((done) => socket.listen(0, "127.0.0.1", done));
  const number = socket.address().port;
  await new Promise((done) => socket.close(done));
  return number;
}
async function settled(page) {
  await page.waitForFunction(() => /已收錄/.test(document.getElementById("coverage").textContent));
}
async function check(name, action) {
  await action();
  passed++;
  console.log("PASS " + name);
}
async function pick(page, id) {
  const input = page.locator("#concept-search");
  if (await input.inputValue()) await input.fill("");
  await page.locator('[data-concept-id="' + id + '"]').click();
  await settled(page);
}
async function layoutCheck(page) {
  // Wait for the scheduled layout and browser geometry to settle.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const result = await page.evaluate(() => {
    const visible = [...document.querySelectorAll(".word-label")].filter((label) => getComputedStyle(label).visibility === "visible");
    const errors = [];
    const rects = visible.map((label) => {
      const box = label.getBoundingClientRect();
      const marker = [...document.querySelectorAll(".map-pin")].find((pin) => pin.dataset.varietyId === label.dataset.varietyId);
      const anchor = marker.closest(".leaflet-marker-icon").getBoundingClientRect();
      const x = anchor.left + 8;
      const y = anchor.top + 8;
      const distance = Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
      if (distance > 49) errors.push("offset " + distance + " for " + label.dataset.varietyId);
      for (const pin of document.querySelectorAll(".map-pin")) {
        const dot = pin.getBoundingClientRect();
        if (box.left < dot.right + 2 && box.right > dot.left - 2
          && box.top < dot.bottom + 2 && box.bottom > dot.top - 2) errors.push("label covers pin " + pin.dataset.varietyId);
      }
      return box.toJSON();
    });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) errors.push("overlapping labels");
      }
    }
    return { errors, visible: visible.length, pins: document.querySelectorAll(".map-pin").length };
  });
  assert.deepEqual(result.errors, []);
  return result;
}

try {
  buildSite("source", site);
  buildSite("tests/fixtures", join(site, "repo"));
  buildSite("source", join(site, "learning-repo"));
  buildSite("templates", join(site, "blank"));
  const serverPort = await port();
  const base = "http://127.0.0.1:" + serverPort;
  server = spawn(python, ["-m", "http.server", String(serverPort), "--bind", "127.0.0.1", "--directory", site], { stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { ready = (await fetch(base)).ok; } catch {}
    if (ready) break;
    await sleep(100);
  }
  assert.ok(ready, "preview server did not start");
  const options = { headless: true };
  if (process.env.CHROME_EXECUTABLE) options.executablePath = process.env.CHROME_EXECUTABLE;
  browser = await chromium.launch(options);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const badResponses = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) badResponses.push(response.url()); });
  page.on("request", (request) => requests.push(request.url()));

  await check("production root, 214 concepts, 42 varieties, local assets", async () => {
    await page.goto(base + "/");
    await settled(page);
    assert.equal(await page.locator(".concept-button").count(), 214);
    assert.equal(await page.locator("#current-zh").textContent(), "水");
    assert.ok(await page.locator("#map-notice").isHidden());
    assert.ok(!(await page.locator("body").innerText()).toLowerCase().includes("swadesh"));
    assert.equal(await page.locator(".test-banner").count(), 0);
    assert.equal(await page.locator(".map-pin").count(), 42);
    assert.deepEqual(requests.filter((url) => /\/data\/words\//.test(url)).map((url) => new URL(url).pathname), ["/data/words/water.json"]);
    assert.ok(requests.every((url) => url.startsWith(base)), "unexpected external dependency");
    await page.locator('#results [data-select-variety="ami_nt"]').click();
    assert.ok(await page.locator("#detail-ipa").isHidden());
    assert.ok(await page.locator("#detail-ipa-label").isHidden());
    assert.ok((await page.locator("#detail-orth").textContent()).length > 0);
    await page.locator("#detail-close").click();
    await page.locator("#show-proto").check();
    assert.equal(await page.locator(".map-pin").count(), 44);
    await page.locator("#show-proto").uncheck();
    await page.screenshot({ path: join(screenshots, "production-desktop.png"), fullPage: true });
  });
  await check("PNG export downloads a portrait map without changing the live view", async () => {
    let downloadCount = 0;
    const countDownload = () => downloadCount++;
    page.on("download", countDownload);
    const before = await page.locator("#map").boundingBox();
    const panesBefore = await page.locator("#map .leaflet-map-pane").getAttribute("style");
    const downloadEvent = page.waitForEvent("download");
    await page.locator("#export-png").click();
    await page.locator("#export-download:not([disabled])").waitFor();
    assert.equal(downloadCount, 0, "opening the preview must not start a download");
    assert.ok(await page.locator("#export-preview-image").isVisible());
    const previewBytes = await page.evaluate(async () => Array.from(new Uint8Array(
      await (await fetch(document.getElementById("export-preview-image").src)).arrayBuffer())));
    await page.screenshot({ path: join(screenshots, "export-preview-desktop.png") });
    await page.locator("#export-download").click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), "kaladaxe-basic-water.png");
    const path = join(screenshots, "export-water.png");
    await download.saveAs(path);
    const bytes = await readFile(path);
    assert.deepEqual(bytes, Buffer.from(previewBytes), "download must match the preview exactly");
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(bytes.readUInt32BE(16), 1600);
    assert.equal(bytes.readUInt32BE(20), 2400);
    assert.ok(bytes.length > 20000, "export must contain map content");
    await page.waitForFunction(() => document.getElementById("export-status").textContent === "PNG 已匯出");
    assert.ok(await page.locator("#export-png").isEnabled());
    assert.equal(await page.locator(".png-export-map").count(), 0);
    assert.deepEqual(await page.locator("#map").boundingBox(), before);
    assert.equal(await page.locator("#map .leaflet-map-pane").getAttribute("style"), panesBefore);
    page.off("download", countDownload);
  });
  await check("PNG preview cancellation, Escape and cancellation during rendering never download", async () => {
    let downloads = 0;
    const countDownload = () => downloads++;
    page.on("download", countDownload);
    await page.locator("#export-png").click();
    await page.locator("#export-download:not([disabled])").waitFor();
    await page.locator("#export-cancel").click();
    await page.waitForFunction(() => !document.getElementById("export-preview-image").hasAttribute("src"));
    assert.ok(await page.locator("#export-dialog").isHidden());
    await page.locator("#export-png").click();
    await page.locator("#export-download:not([disabled])").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("#export-dialog").waitFor({ state: "hidden" });
    await page.evaluate(() => {
      window.originalPreviewToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type) {
        window.releasePreviewBlob = () => window.originalPreviewToBlob.call(this, callback, type);
      };
    });
    await page.locator("#export-png").click();
    await page.waitForFunction(() => Boolean(window.releasePreviewBlob));
    assert.ok(await page.locator("#export-download").isDisabled());
    await page.locator("#export-cancel").click();
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = window.originalPreviewToBlob;
      window.releasePreviewBlob();
    });
    await page.waitForFunction(() => !document.getElementById("export-png").disabled);
    assert.ok(await page.locator("#export-dialog").isHidden());
    assert.equal(await page.locator(".png-export-map").count(), 0);
    assert.equal(downloads, 0);
    page.off("download", countDownload);
  });
  await check("PNG export supports mobile learning filters and recovers from encoding failure", async () => {
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(base + "/learning-repo/?mode=learning&concept=21-02");
    await settled(mobile);
    await mobile.locator("#show-languages").uncheck();
    await mobile.locator("#show-proto").check();
    assert.equal(await mobile.locator(".map-pin").count(), 2);
    const event = mobile.waitForEvent("download");
    await mobile.locator("#export-png").click();
    await mobile.locator("#export-download:not([disabled])").waitFor();
    await mobile.screenshot({ path: join(screenshots, "export-preview-mobile.png") });
    const dialog = await mobile.locator("#export-dialog").boundingBox();
    assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= 390);
    assert.ok(dialog.y >= 0 && dialog.y + dialog.height <= 844);
    await mobile.locator("#export-download").click();
    const download = await event;
    assert.equal(download.suggestedFilename(), "kaladaxe-learning-21-02.png");
    await download.saveAs(join(screenshots, "export-learning-mobile.png"));
    const bytes = await readFile(join(screenshots, "export-learning-mobile.png"));
    assert.equal(bytes.readUInt32BE(16), 1600);
    assert.equal(bytes.readUInt32BE(20), 2400);
    await mobile.waitForFunction(() => !document.getElementById("export-png").disabled);
    await mobile.evaluate(() => {
      window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); };
    });
    await mobile.locator("#export-png").click();
    await mobile.waitForFunction(() => document.getElementById("export-status").textContent.includes("匯出失敗"));
    assert.ok(await mobile.locator("#export-png").isEnabled());
    assert.equal(await mobile.locator(".png-export-map").count(), 0);
    assert.ok(await mobile.locator("#export-download").isDisabled());
    await mobile.locator("#export-cancel").click();
    await mobile.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.originalToBlob; });
    const retry = mobile.waitForEvent("download");
    await mobile.locator("#export-png").click();
    await mobile.locator("#export-download:not([disabled])").waitFor();
    await mobile.locator("#export-download").click();
    await retry;
    await mobile.close();
  });
  await check("complete geography survives zoom, offscreen pans and an unfinished drag", async () => {
    const atlasPage = await context.newPage();
    const geographyRequests = [];
    atlasPage.on("request", (request) => {
      if (/taiwan(?:-rivers)?\.geojson$/.test(request.url())) geographyRequests.push(request.url());
    });
    // Expose the instance only in the test response; production has no debug global.
    await atlasPage.route("**/assets/map.js", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace(
        "const map = L.map(element,", "const map = window.__testAtlas = L.map(element,") });
    });
    await atlasPage.goto(base + "/");
    await atlasPage.waitForFunction(() => document.querySelectorAll(".geography-overlay > path").length === 2);
    await atlasPage.evaluate(() => {
      window.__geographyPaths = [...document.querySelectorAll(".geography-overlay > path")];
      window.__geographyData = window.__geographyPaths.map((path) => path.getAttribute("d"));
    });
    async function intact() {
      const result = await atlasPage.evaluate(() => {
        const paths = [...document.querySelectorAll(".geography-overlay > path")];
        return {
          same: paths.every((path, index) => path === window.__geographyPaths[index]
            && path.getAttribute("d") === window.__geographyData[index]),
          parts: paths.map((path) => (path.getAttribute("d").match(/M/g) || []).length).sort((a, b) => a - b),
          overflow: paths.map((path) => getComputedStyle(path.ownerSVGElement).overflow),
          strokes: paths.map((path) => path.getAttribute("vector-effect")),
        };
      });
      assert.ok(result.same, "zoom/pan must retain the original complete SVG paths");
      assert.deepEqual(result.parts, [7, 23]);
      assert.deepEqual(result.overflow, ["visible", "visible"]);
      assert.deepEqual(result.strokes, ["non-scaling-stroke", "non-scaling-stroke"]);
      const clipped = await atlasPage.evaluate(() => {
        const river = document.querySelector(".leaflet-atlasRivers-pane .geography-overlay > path");
        const coast = document.querySelector(".leaflet-overlay-pane .geography-overlay > path");
        const clip = document.querySelector("#atlas-river-land path");
        return river.getAttribute("clip-path") === "url(#atlas-river-land)"
          && clip?.getAttribute("d") === coast.getAttribute("d");
      });
      assert.ok(clipped, "rivers must remain clipped to the projected coastline after zoom/pan");
    }
    for (const zoom of [9, 12, 14]) {
      await atlasPage.evaluate((zoom) => window.__testAtlas.setView([25.1, 121.5], zoom, {animate: false}), zoom);
      await intact();
    }
    const alignment = await atlasPage.evaluate(async () => {
      const map = window.__testAtlas, rect = map.getContainer().getBoundingClientRect();
      const values = [];
      for (const [file, selector] of [
        ["taiwan.geojson", ".leaflet-overlay-pane .geography-overlay > path"],
        ["taiwan-rivers.geojson", ".leaflet-atlasRivers-pane .geography-overlay > path"]]) {
        const data = await (await fetch("./assets/" + file)).json();
        let coords = data.features[0].geometry.coordinates;
        while (Array.isArray(coords[0])) coords = coords[0];
        const expected = map.latLngToContainerPoint([coords[1], coords[0]]);
        const path = document.querySelector(selector);
        const actual = path.getPointAtLength(0).matrixTransform(path.getScreenCTM());
        values.push(Math.hypot(actual.x - rect.left - expected.x, actual.y - rect.top - expected.y));
      }
      return values;
    });
    assert.ok(alignment.every((error) => error < 1.5), "SVG and Leaflet coordinates must agree within pixel rounding");
    // Move every geographic feature offscreen, then return without losing geometry.
    await atlasPage.evaluate(() => window.__testAtlas.setView([23.5, 116], 10, {animate: false}));
    await intact();
    await atlasPage.evaluate(() => window.__testAtlas.setView([23.5, 119.3], 10, {animate: false}));
    const box = await atlasPage.locator("#map").boundingBox();
    await atlasPage.mouse.move(box.x + box.width - 90, box.y + box.height * 0.6);
    await atlasPage.mouse.down();
    await atlasPage.mouse.move(box.x + 90, box.y + box.height * 0.6, {steps: 20});
    await intact();
    await atlasPage.screenshot({path: join(screenshots, "geography-during-drag.png")});
    await atlasPage.mouse.up();
    await atlasPage.setViewportSize({width: 390, height: 844});
    await atlasPage.evaluate(() => window.__testAtlas.setView([23.8, 121], 9, {animate: false}));
    await intact();
    await atlasPage.screenshot({path: join(screenshots, "geography-mobile.png"), fullPage: true});
    // Two initial downloads plus two deliberate coordinate checks above; no pan/zoom downloads.
    assert.equal(geographyRequests.length, 4);
    await atlasPage.close();
  });
  await check("Chinese / English / number search, invalid URL fallback", async () => {
    for (const query of ["眼睛", "eye", "69"]) {
      await page.locator("#concept-search").fill(query);
      assert.equal(await page.locator('[data-concept-id="eye"]').count(), 1);
    }
    await page.locator("#concept-search").fill("no-such-concept");
    assert.equal(await page.locator(".concept-button").count(), 0);
    assert.ok(await page.locator("#search-empty").isVisible());
    await page.goto(base + "/?concept=unknown");
    await settled(page);
    assert.equal(new URL(page.url()).searchParams.get("concept"), "water");
    assert.ok(!requests.some((url) => url.endsWith("/unknown.json")));
  });
  await check("project subpath, fixtures isolated, missing words and classification", async () => {
    await page.goto(base + "/repo/?concept=water");
    await settled(page);
    assert.ok(await page.locator(".test-banner").isVisible());
    assert.ok(await page.locator("#show-languages").isChecked());
    assert.equal(await page.locator("#show-proto").isChecked(), false);
    assert.equal(await page.locator(".map-pin").count(), 4);
    assert.equal(await page.locator(".map-pin.proto").count(), 0);
    await page.locator("#show-proto").check();
    assert.equal(await page.locator(".map-pin").count(), 6);
    assert.equal(await page.locator("#missing-count").textContent(), "1");
    assert.equal(await page.locator('#group-tree [data-select-variety="test_proto_branch"]').count(), 1);
    await page.locator('[data-filter-group="test_dialects"]').click();
    assert.equal(await page.locator(".map-pin").count(), 3);
    await page.locator('[data-filter-group="test_branch"]').click();
    assert.equal(await page.locator(".map-pin").count(), 5);
    assert.ok(await page.locator('[data-filter-group="test_dialects"]').isChecked());
    assert.ok(await page.locator('[data-filter-group="test_branch"]').isChecked());
    await page.locator('[data-filter-group="test_branch"]').uncheck();
    assert.equal(await page.locator(".map-pin").count(), 3);
    await page.locator('[data-filter-group="test_dialects"]').uncheck();
    assert.equal(await page.locator(".map-pin").count(), 6);
    await page.locator('[data-filter-group="test_empty_group"]').check();
    assert.equal(await page.locator(".map-pin").count(), 0);
    assert.equal(await page.locator("#notice-title").textContent(), "此語群尚無資料");
    await page.locator("#all-groups").click();
    assert.equal(await page.locator("[data-filter-group]:checked").count(), 0);
    assert.equal(await page.locator(".map-pin").count(), 6);
  });
  await check("same-coordinate selection, proto notice, bounded non-overlapping labels", async () => {
    for (const id of ["test_dialect_a", "test_dialect_b", "test_language", "test_long"]) {
      await page.locator('#results [data-select-variety="' + id + '"]').click();
      assert.equal(await page.locator("#detail-id").textContent(), id);
      await layoutCheck(page);
      assert.ok(await page.locator('.word-label[data-variety-id="' + id + '"]').isVisible(), "selected label must be visible");
      assert.equal(await page.locator(".map-pin").count(), 6);
    }
    await page.locator('#results [data-select-variety="test_proto_branch"]').click();
    assert.match(await page.locator("#detail-type").textContent(), /原始語言/);
    assert.match(await page.locator("#detail-metadata").textContent(), /地圖位置/);
    await page.locator("#detail-close").click();
    await layoutCheck(page);
    const before = await page.locator(".leaflet-atlasLines-pane path").count();
    assert.ok(before > 0, "fixture should exercise connector lines");
    await page.locator(".leaflet-control-zoom-in").click();
    // Allow the zoom animation and the 200 ms label layout debounce to finish.
    await sleep(600);
    assert.equal((await layoutCheck(page)).pins, 6);
    await page.screenshot({ path: join(screenshots, "fixture-desktop.png"), fullPage: true });
  });
  await check("lazy cache, selection clearing, plain text notes, URL history", async () => {
    const beforeWater = requests.filter((url) => url === base + "/repo/data/words/water.json").length;
    await page.locator('#results [data-select-variety="test_dialect_a"]').click();
    await pick(page, "fire");
    assert.ok(await page.locator("#detail").isHidden());
    await page.locator('#results [data-select-variety="test_language"]').click();
    assert.match(await page.locator("#detail-note").textContent(), /<img src=x/);
    assert.equal(await page.locator("#detail img").count(), 0);
    await pick(page, "water");
    assert.equal(requests.filter((url) => url === base + "/repo/data/words/water.json").length, beforeWater);
    await page.goBack();
    await settled(page);
    assert.equal(await page.locator("#current-en").textContent(), "fire");
    await page.reload();
    await settled(page);
    assert.equal(await page.locator(".map-pin").count(), 1);
    await pick(page, "eye");
    assert.equal(await page.locator(".map-pin").count(), 0);
    assert.equal(await page.locator("#missing-count").textContent(), "5");
  });
  await check("in-flight request deduplication", async () => {
    const before = requests.filter((url) => url === base + "/repo/data/words/eye.json").length;
    const same = await page.evaluate(async () => {
      const { createDataStore } = await import("./assets/data.js");
      const store = createDataStore();
      await store.loadIndex();
      const one = store.loadWord("eye");
      const two = store.loadWord("eye");
      await Promise.all([one, two]);
      return one === two;
    });
    assert.ok(same);
    assert.equal(requests.filter((url) => url === base + "/repo/data/words/eye.json").length - before, 1);
  });
  await check("slow old response cannot overwrite a newer concept", async () => {
    const race = await context.newPage();
    let release;
    const gate = new Promise((done) => { release = done; });
    await race.route("**/data/words/fire.json", async (route) => { await gate; await route.continue(); });
    await race.goto(base + "/repo/");
    await settled(race);
    await race.locator('[data-concept-id="fire"]').click();
    await race.locator('[data-concept-id="water"]').click();
    await settled(race);
    const response = race.waitForResponse((res) => res.url().endsWith("/data/words/fire.json"));
    release();
    await response;
    await sleep(100);
    assert.equal(await race.locator("#current-en").textContent(), "water");
    assert.equal(await race.locator(".map-pin").count(), 4);
    await race.close();
  });
  await check("word download failure retries without poisoning cache", async () => {
    const retry = await context.newPage();
    let count = 0;
    await retry.route("**/data/words/water.json", (route) => ++count === 1
      ? route.fulfill({ status: 503, body: "temporary failure" }) : route.continue());
    await retry.goto(base + "/repo/");
    await retry.locator("#retry").waitFor({ state: "visible" });
    await retry.locator("#retry").click();
    await settled(retry);
    assert.equal(count, 2);
    assert.equal(await retry.locator(".map-pin").count(), 4);
    await retry.close();
  });
  await check("metadata and basemap failures have independent retries", async () => {
    const retry = await context.newPage();
    let metadata = 0, baseCount = 0, riverCount = 0;
    await retry.route("**/data/concepts.json", (route) => ++metadata === 1
      ? route.fulfill({ status: 503, body: "failure" }) : route.continue());
    await retry.route("**/assets/taiwan.geojson", (route) => ++baseCount === 1
      ? route.fulfill({ status: 503, body: "failure" }) : route.continue());
    await retry.route("**/assets/taiwan-rivers.geojson", (route) => ++riverCount === 1
      ? route.fulfill({ status: 503, body: "failure" }) : route.continue());
    await retry.goto(base + "/repo/");
    await retry.locator("#retry").waitFor({ state: "visible" });
    await retry.locator("#retry").click();
    await settled(retry);
    await retry.locator("#rivers-error").waitFor({ state: "visible" });
    await retry.locator("#rivers-retry").click();
    await retry.locator(".leaflet-atlasRivers-pane .geography-overlay > path").first().waitFor({ state: "attached" });
    assert.equal(riverCount, 2);
    assert.ok(await retry.locator("#basemap-error").isVisible());
    await Promise.all([retry.waitForResponse((res) => res.url().endsWith("taiwan.geojson")), retry.locator("#basemap-retry").click()]);
    await retry.locator("#basemap-error").waitFor({ state: "hidden" });
    assert.equal(metadata, 2);
    await retry.close();
  });
  await check("major rivers, hidden demo 999, category toggles and production restoration", async () => {
    await page.goto(base + "/?concept=debug_999");
    await settled(page);
    assert.equal(new URL(page.url()).searchParams.get("concept"), "water");
    assert.ok(!requests.some((url) => url.endsWith("/debug/999.json")));
    await page.locator(".leaflet-atlasRivers-pane .geography-overlay > path").first().waitFor({ state: "attached" });
    assert.equal(await page.locator(".leaflet-atlasRivers-pane .geography-overlay > path").count(), 1);
    assert.deepEqual(await page.locator(".leaflet-atlasRivers-pane .geography-overlay > path").evaluateAll(
      (paths) => paths.map((path) => path.getAttribute("fill"))), ["none"]);
    assert.equal(await page.locator(".ocean-label").count(), 0);
    const trigger = page.locator("#debug-trigger");
    assert.equal(await trigger.evaluate((el) => getComputedStyle(el).cursor), "default");
    for (let i = 0; i < 4; i++) await trigger.click();
    assert.equal(await page.locator("#current-number").textContent(), "No. 145");
    assert.ok(!requests.some((url) => url.endsWith("/debug/999.json")));
    await trigger.click();
    await page.waitForFunction(() => document.getElementById("current-number").textContent === "No. 999");
    assert.equal(await page.locator(".map-pin").count(), 9);
    assert.equal(await page.locator(".map-pin.proto").count(), 0);
    assert.ok(await page.locator("#demo-notice").isVisible());
    assert.equal(await page.locator(".concept-button").count(), 214);
    await page.locator("#concept-search").fill("999");
    assert.equal(await page.locator(".concept-button").count(), 0);
    await page.locator("#concept-search").fill("");
    await page.locator('#results [data-select-variety="demo_north"]').click();
    assert.ok((await page.locator("#detail-orth").textContent()).length);
    assert.ok((await page.locator("#detail-ipa").textContent()).length);
    await layoutCheck(page);
    await page.locator("#detail-close").click();
    await page.screenshot({ path: join(screenshots, "demo-desktop.png"), fullPage: true });
    await page.locator("#show-proto").check();
    assert.equal(await page.locator(".map-pin").count(), 12);
    await page.locator("#show-languages").uncheck();
    assert.equal(await page.locator(".map-pin").count(), 3);
    await page.locator('#results [data-select-variety="demo_proto"]').click();
    assert.equal(await page.locator("#detail-type").textContent(), "原始語言");
    await page.locator("#show-proto").uncheck();
    assert.ok(await page.locator("#detail").isHidden());
    assert.equal(await page.locator(".map-pin").count(), 0);
    await page.locator("#show-languages").check();
    assert.equal(await page.locator(".map-pin").count(), 9);
    await pick(page, "water");
    assert.ok(await page.locator("#demo-notice").isHidden());
    assert.equal(await page.locator(".map-pin").count(), 42);
    assert.equal(await page.locator("#variety-count").textContent(), "42");
    for (let i = 0; i < 5; i++) await trigger.click();
    await page.waitForFunction(() => document.getElementById("current-number").textContent === "No. 999");
    assert.equal(requests.filter((url) => url.endsWith("/debug/999.json")).length, 1);
    await page.reload();
    await settled(page);
    assert.equal(await page.locator("#current-number").textContent(), "No. 145");
    assert.equal(await page.locator("#show-proto").isChecked(), false);
  });
  await check("demo download failure retries and stale activation is discarded", async () => {
    const retry = await context.newPage();
    let attempts = 0;
    await retry.route("**/debug/999.json", (route) => ++attempts === 1
      ? route.fulfill({ status: 503, body: "failure" }) : route.continue());
    await retry.goto(base + "/");
    await settled(retry);
    for (let i = 0; i < 5; i++) await retry.locator("#debug-trigger").click();
    await retry.locator("#retry").waitFor({ state: "visible" });
    await retry.locator("#retry").click();
    await retry.waitForFunction(() => document.getElementById("current-number").textContent === "No. 999");
    assert.equal(attempts, 2);
    await retry.close();
    const race = await context.newPage();
    let release;
    const gate = new Promise((done) => { release = done; });
    await race.route("**/debug/999.json", async (route) => { await gate; await route.continue(); });
    await race.goto(base + "/");
    await settled(race);
    for (let i = 0; i < 5; i++) await race.locator("#debug-trigger").click();
    await pick(race, "eye");
    const response = race.waitForResponse((res) => res.url().endsWith("/debug/999.json"));
    release();
    await response;
    await sleep(100);
    assert.equal(await race.locator("#current-en").textContent(), "eye");
    assert.ok(await race.locator("#demo-notice").isHidden());
    await race.close();
  });
  await check("fully empty templates remain browseable", async () => {
    await page.goto(base + "/blank/");
    await page.waitForFunction(() => document.getElementById("notice-title").textContent === "尚無詞項");
    assert.equal(await page.locator(".concept-button").count(), 0);
    assert.equal(await page.locator(".map-pin").count(), 0);
  });
  await check("mobile, keyboard, detail below map, and resize", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/repo/");
    await settled(page);
    assert.equal(await page.locator(".classification-section").getAttribute("open"), null);
    await page.locator(".results-section > summary").click();
    const result = page.locator('#results [data-select-variety="test_dialect_b"]');
    await result.focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#detail-id").textContent(), "test_dialect_b");
    const mapBox = await page.locator("#map").boundingBox();
    const detailBox = await page.locator("#detail").boundingBox();
    assert.ok(detailBox.y >= mapBox.y + mapBox.height - 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await layoutCheck(page);
    await page.screenshot({ path: join(screenshots, "fixture-mobile.png"), fullPage: true });
    await page.keyboard.press("Escape");
    assert.ok(await page.locator("#detail").isHidden());
    await page.locator("#about-open").click();
    assert.ok(await page.locator("#about-dialog").isVisible());
    await page.keyboard.press("Escape");
    assert.ok(await page.locator("#about-dialog").isHidden());
    await page.goto(base + "/");
    await settled(page);
    await page.screenshot({ path: join(screenshots, "production-mobile.png"), fullPage: true });
    for (let i = 0; i < 5; i++) await page.locator("#debug-trigger").click();
    await page.waitForFunction(() => document.getElementById("current-number").textContent === "No. 999");
    assert.equal(await page.locator(".map-pin").count(), 9);
    await page.locator("#show-proto").check();
    assert.equal(await page.locator(".map-pin").count(), 12);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await layoutCheck(page);
    await page.screenshot({ path: join(screenshots, "demo-mobile.png"), fullPage: true });
  });
  await check("learning mode numbers, search aliases, sources, filters and history", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + "/?concept=water");
    await settled(page);
    await page.locator('[data-filter-group="ami"]').click();
    await page.locator("#show-proto").check();
    await page.locator("#concept-search").fill("water");
    await page.locator("#wordlist-mode").selectOption("learning");
    await settled(page);
    assert.equal(await page.locator("#current-number").textContent(), "No. 21-02");
    assert.equal(await page.locator("#concept-search").inputValue(), "");
    assert.equal(await page.locator(".concept-button").count(), 1094);
    assert.equal(await page.locator("#show-proto").isChecked(), true);
    assert.ok(await page.locator('[data-filter-group="ami"]').isChecked());
    assert.equal(new URL(page.url()).searchParams.get("mode"), "learning");
    await page.locator("#concept-search").fill("一些些");
    assert.equal(await page.locator('[data-concept-id="01-38"]').count(), 1);
    await page.locator("#concept-search").fill("01-01");
    await page.locator('[data-concept-id="01-01"]').click();
    await settled(page);
    assert.equal(await page.locator("#current-number").textContent(), "No. 01-01");
    await page.locator('#results [data-select-variety="ami_nt"]').click();
    assert.ok((await page.locator("#detail-note").textContent()).includes("第 5 列"));
    assert.ok((await page.locator("#detail-metadata").textContent()).includes("來源原義一"));
    await page.locator("#wordlist-mode").selectOption("basic");
    await settled(page);
    assert.equal(new URL(page.url()).searchParams.get("concept"), "one");
    assert.equal(new URL(page.url()).searchParams.has("mode"), false);
    await page.goBack();
    await settled(page);
    assert.equal(await page.locator("#wordlist-mode").inputValue(), "learning");
    assert.equal(await page.locator("#current-number").textContent(), "No. 01-01");
    await page.goForward();
    await settled(page);
    assert.equal(await page.locator("#wordlist-mode").inputValue(), "basic");
    assert.equal(await page.locator(".concept-button").count(), 214);
  });
  await check("learning direct URL, prototype additions, reload and fallback", async () => {
    await page.goto(base + "/?mode=learning&concept=07-02");
    await settled(page);
    await page.locator("#show-proto").check();
    await page.locator('#results [data-select-variety="pan"]').click();
    assert.ok((await page.locator("#detail-note").textContent()).includes("ACD PAN Form ID"));
    assert.ok((await page.locator("#detail-metadata").textContent()).includes("pig"));
    await page.locator("#detail-close").click();
    await page.locator(".sidebar").evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: join(screenshots, "learning-desktop.png"), fullPage: true });
    await page.reload();
    await settled(page);
    assert.equal(await page.locator("#current-number").textContent(), "No. 07-02");
    await page.locator("#wordlist-mode").selectOption("basic");
    await settled(page);
    assert.equal(await page.locator("#current-zh").textContent(), "水");
    await page.goto(base + "/?mode=learning&concept=unknown");
    await settled(page);
    assert.equal(new URL(page.url()).searchParams.get("concept"), "21-02");
    await page.goto(base + "/?mode=invalid&concept=water");
    await settled(page);
    assert.equal(new URL(page.url()).searchParams.has("mode"), false);
    await page.goto(base + "/?mode=learning&concept=04-07");
    await settled(page);
    await page.locator('#results [data-select-variety="tha"]').click();
    assert.equal(await page.locator("#detail-orth").textContent(), "ayuzi");
    assert.ok((await page.locator("#detail-note").textContent()).includes("不代表妻子"));
    await page.goto(base + "/learning-repo/?mode=learning&concept=21-02");
    await settled(page);
    assert.equal(await page.locator("#current-number").textContent(), "No. 21-02");
    assert.equal(await page.locator(".map-pin").count(), 42);
  });
  await check("learning slow request cannot overwrite a later mode", async () => {
    const race = await context.newPage();
    let release, started;
    const gate = new Promise((done) => { release = done; });
    const ready = new Promise((done) => { started = done; });
    await race.route("**/data/learning/words/21-02.json", async (route) => {
      started(); await gate; await route.continue();
    });
    await race.goto(base + "/");
    await settled(race);
    await race.locator("#wordlist-mode").selectOption("learning");
    await ready;
    await race.locator("#wordlist-mode").selectOption("basic");
    await settled(race);
    const response = race.waitForResponse((res) => res.url().endsWith("/learning/words/21-02.json"));
    release();
    await response;
    await sleep(100);
    assert.equal(await race.locator("#current-number").textContent(), "No. 145");
    assert.equal(await race.locator("#wordlist-mode").inputValue(), "basic");
    assert.equal(await race.locator(".map-pin").count(), 42);
    await race.locator("#wordlist-mode").selectOption("learning");
    await settled(race);
    assert.equal(await race.locator("#current-number").textContent(), "No. 21-02");
    await race.close();
  });
  await check("learning metadata and word failures retry", async () => {
    for (const filename of ["concepts.json", "words/21-02.json"]) {
      const retry = await context.newPage();
      let attempts = 0;
      await retry.route("**/data/learning/" + filename, (route) => ++attempts === 1
        ? route.fulfill({ status: 503, body: "failure" }) : route.continue());
      await retry.goto(base + "/?mode=learning&concept=21-02");
      await retry.locator("#retry").waitFor({ state: "visible" });
      await retry.locator("#retry").click();
      await settled(retry);
      assert.equal(await retry.locator("#current-number").textContent(), "No. 21-02");
      assert.equal(attempts, 2);
      await retry.close();
    }
  });
  await check("learning mobile, three digit suffix, reduced motion and animation", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(base + "/?mode=learning&concept=26-100");
    await settled(page);
    assert.equal(await page.locator("#current-number").textContent(), "No. 26-100");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(screenshots, "learning-mobile.png"), fullPage: true });
    await page.locator("#wordlist-mode").selectOption("basic");
    await settled(page);
    assert.equal(await page.evaluate(() => document.getElementById("concept-list").getAnimations().length), 0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const animations = await page.evaluate(() => {
      const select = document.getElementById("wordlist-mode");
      select.value = "learning";
      select.dispatchEvent(new Event("change"));
      return document.getElementById("concept-list").getAnimations().length;
    });
    assert.equal(animations, 1);
    await settled(page);
  });
  await check("homepage SEO survives JavaScript, mode changes and history", async () => {
    const title = "kaladaxe｜臺灣原住民族語言詞彙地圖";
    await page.goto(base + "/");
    await settled(page);
    assert.equal(await page.title(), title);
    await page.locator("#wordlist-mode").selectOption("learning");
    await settled(page);
    await pick(page, "07-02");
    assert.equal(await page.title(), title);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://rngagi.github.io/kaladaxe/");
    await page.goBack();
    await settled(page);
    assert.equal(await page.title(), title);
    const staticPage = await browser.newPage({ javaScriptEnabled: false });
    await staticPage.goto(base + "/");
    assert.equal(await staticPage.title(), title);
    assert.equal(await staticPage.locator('meta[name="description"]').getAttribute("content"),
      "透過互動式地圖探索臺灣原住民族 42 語言別的詞彙，提供基礎詞彙 200+ 與千詞表模式，比較族語書寫形式。");
    assert.equal(await staticPage.locator('script[type="application/ld+json"]').count(), 1);
    const sitemap = await staticPage.request.get(base + "/sitemap.xml");
    assert.ok(sitemap.ok());
    assert.ok((await sitemap.text()).includes("https://rngagi.github.io/kaladaxe/"));
    await staticPage.close();
  });
  await check("mobile real touch scroll, two-finger pan/pinch and first-visible hint", async () => {
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const touch = await touchContext.newPage();
    const touchErrors = [];
    touch.on("pageerror", (error) => touchErrors.push(error.message));
    await touch.route(base + "/", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace("</head>",
        '<style id="hint-test-spacing">.concept-section { min-height: 1200px; }</style></head>') });
    });
    await touch.route("**/assets/map.js", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace(
        "const map = L.map(element,", "const map = window.__touchAtlas = L.map(element,") });
    });
    await touch.goto(base + "/");
    await settled(touch);
    await sleep(5200);
    assert.ok(await touch.locator("#map-touch-hint").isHidden(), "offscreen hint must not start its timer");
    await touch.locator("#map").scrollIntoViewIfNeeded();
    await touch.locator("#map-touch-hint").waitFor({ state: "visible" });
    await touch.screenshot({ path: join(screenshots, "mobile-touch-hint.png"), fullPage: false });
    await touch.locator("#map-touch-hint").tap();
    assert.ok(await touch.locator("#map-touch-hint").isHidden());
    await touch.reload();
    await settled(touch);
    await touch.locator("#map").scrollIntoViewIfNeeded();
    assert.ok(await touch.locator("#map-touch-hint").isHidden(), "hint is once per tab session");
    const cdp = await touchContext.newCDPSession(touch);
    async function frame() {
      return touch.evaluate(() => ({ scroll: scrollY, zoom: window.__touchAtlas.getZoom(),
        lat: window.__touchAtlas.getCenter().lat, lng: window.__touchAtlas.getCenter().lng }));
    }
    async function mapTop() {
      await touch.evaluate(() => window.scrollTo(0, scrollY + document.getElementById("map").getBoundingClientRect().top - 80));
      await sleep(100);
      return (await touch.locator("#map").boundingBox()).y;
    }
    async function gesture(start, end) {
      const points = (coordinates) => coordinates.map(([x, y], id) => ({ x, y, id, radiusX: 6, radiusY: 6 }));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(start) });
      for (let step = 1; step <= 10; step++) {
        const coordinates = start.map(([x, y], i) => [x + (end[i][0] - x) * step / 10, y + (end[i][1] - y) * step / 10]);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(coordinates) });
        await sleep(25);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(400);
    }
    let y = await mapTop();
    const beforeScroll = await frame();
    // The map is near the page bottom; drag down to scroll toward earlier content.
    await gesture([[35, y + 120]], [[35, y + 240]]);
    const afterScroll = await frame();
    assert.ok(afterScroll.scroll < beforeScroll.scroll - 40, "one finger should scroll the document: " + JSON.stringify({ beforeScroll, afterScroll }));
    assert.equal(afterScroll.lat, beforeScroll.lat);
    assert.equal(afterScroll.lng, beforeScroll.lng);
    y = await mapTop();
    const beforePan = await frame();
    await gesture([[110, y + 200], [230, y + 200]], [[145, y + 250], [265, y + 250]]);
    const afterPan = await frame();
    assert.ok(Math.abs(afterPan.lat - beforePan.lat) > 0.01, "two fingers should pan the map");
    assert.ok(Math.abs(afterPan.zoom - beforePan.zoom) < 0.01, "parallel fingers should preserve zoom");
    assert.ok(Math.abs(afterPan.scroll - beforePan.scroll) < 2, "two fingers must not scroll the document");
    y = await mapTop();
    const beforePinch = await frame();
    await gesture([[140, y + 250], [240, y + 250]], [[90, y + 250], [290, y + 250]]);
    const afterPinch = await frame();
    assert.ok(afterPinch.zoom > beforePinch.zoom + 0.5, "pinch zoom must still work");
    assert.ok(Math.abs(afterPinch.scroll - beforePinch.scroll) < 2);
    await touch.evaluate(() => sessionStorage.removeItem("kaladaxe:map-touch-hint-seen"));
    await touch.goto(base + "/");
    await settled(touch);
    await touch.locator("#map").scrollIntoViewIfNeeded();
    await touch.locator("#map-touch-hint").waitFor({ state: "visible" });
    await sleep(3000);
    assert.ok(await touch.locator("#map-touch-hint").isVisible());
    await touch.locator("#map-touch-hint").waitFor({ state: "hidden", timeout: 3000 });
    assert.deepEqual(touchErrors, []);
    await touchContext.close();
  });
  assert.deepEqual(errors, [], "unexpected browser errors");
  assert.deepEqual(badResponses, [], "unexpected missing assets");
  console.log(passed + " browser scenarios passed. Screenshots: " + screenshots);
} finally {
  await browser?.close();
  if (server) {
    server.kill();
    await new Promise((done) => server.once("exit", done));
  }
  await rm(temp, { recursive: true, force: true });
}
