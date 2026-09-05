// Optional browser acceptance checks. No Node dependency is needed to build the site.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
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
      const x = anchor.left + 8 + 12;
      const y = anchor.top + 8 - box.height / 2;
      const distance = Math.hypot(box.left - x, box.top - y);
      if (distance > 49) errors.push("offset " + distance + " for " + label.dataset.varietyId);
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
    await page.locator('[data-filter-group="test_empty_group"]').click();
    assert.equal(await page.locator(".map-pin").count(), 0);
    assert.equal(await page.locator("#notice-title").textContent(), "此語群尚無資料");
    await page.locator("#all-groups").click();
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
    await sleep(350);
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
    assert.equal(await page.locator("#current-number").textContent(), "145");
    assert.ok(!requests.some((url) => url.endsWith("/debug/999.json")));
    await trigger.click();
    await page.waitForFunction(() => document.getElementById("current-number").textContent === "999");
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
    await page.waitForFunction(() => document.getElementById("current-number").textContent === "999");
    assert.equal(requests.filter((url) => url.endsWith("/debug/999.json")).length, 1);
    await page.reload();
    await settled(page);
    assert.equal(await page.locator("#current-number").textContent(), "145");
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
    await retry.waitForFunction(() => document.getElementById("current-number").textContent === "999");
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
    await page.waitForFunction(() => document.getElementById("current-number").textContent === "999");
    assert.equal(await page.locator(".map-pin").count(), 9);
    await page.locator("#show-proto").check();
    assert.equal(await page.locator(".map-pin").count(), 12);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await layoutCheck(page);
    await page.screenshot({ path: join(screenshots, "demo-mobile.png"), fullPage: true });
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
