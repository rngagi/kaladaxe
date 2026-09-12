// Build and serve dist first; optional argument: local preview URL.
// Uses the same PLAYWRIGHT_MODULE / CHROME_EXECUTABLE overrides as browser_smoke.mjs.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const options = { headless: true };
if (process.env.CHROME_EXECUTABLE) options.executablePath = process.env.CHROME_EXECUTABLE;
const browser = await chromium.launch(options);
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.route("**/assets/map.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text())
      .replace("const map = L.map(element,", "const map = window.previewMap = L.map(element,") });
  });
  await page.goto(process.argv[2] || "http://127.0.0.1:8000/");
  await page.waitForFunction(() => document.querySelector("#atlas-river-land path"));
  await page.waitForFunction(() => /已收錄/.test(document.getElementById("coverage").textContent));
  await page.evaluate(() => {
    document.querySelector(".brand-description strong").textContent = "詞彙地圖";
    const modes = document.createElement("span");
    modes.className = "preview-modes";
    modes.textContent = "基礎詞彙 200+ · 千詞表";
    document.querySelector(".brand-description").append(modes);
    document.querySelector(".header-note").textContent = "一個詞，看見族語的風景";
  });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: `
    body { width: 1200px; height: 630px; overflow: hidden; }
    .skip-link, .exploration-bar, .sidebar, .map-legend, .atlas-caption,
    .map-notice, .basemap-error, .detail-card, .demo-notice, .about-button,
    .leaflet-control-attribution, .leaflet-control-zoom, .home-control, .leaflet-marker-pane,
    .leaflet-atlasLabels-pane, .leaflet-atlasLines-pane { display: none !important; }
    .workspace { position: absolute; inset: 0; display: block; height: 630px; }
    .atlas { height: 100%; }
    .masthead { position: absolute; left: 64px; top: 122px; padding: 0;
      display: block; min-height: 0; border: 0; background: transparent; z-index: 10; }
    .brand { font-size: 120px; letter-spacing: -4px; }
    .brand-description { margin-top: 32px; padding-left: 0; border: 0;
      font-size: 38px; letter-spacing: 3px; gap: 14px; }
    .brand-description strong { font-size: 36px; letter-spacing: 2px; }
    .preview-modes { font-size: 24px; letter-spacing: 1px; color: #706662; }
    .header-note { display: block; margin-top: 44px; font-size: 28px; letter-spacing: 2px; }
  ` });
  await page.evaluate(() => {
    const map = window.previewMap;
    map.invalidateSize({ pan: false });
    map.fitBounds([[21.7, 119.25], [25.45, 122.2]], {
      paddingTopLeft: [570, 42], paddingBottomRight: [52, 42], animate: false,
    });
  });
  await page.waitForTimeout(300);
  const output = fileURLToPath(new URL("../site/assets/social-preview.png", import.meta.url));
  await page.screenshot({ path: output });
  console.log(output);
} finally {
  await browser.close();
}
