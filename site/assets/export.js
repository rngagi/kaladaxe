// Capture the rendered SVG geography and screen-space labels without remote assets.
export async function exportMapPNG(element, { title, subtitle, filename }) {
  const bounds = element.getBoundingClientRect();
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (!width || !height) throw new Error("地圖沒有可匯出的尺寸");
  const header = 100;
  const canvas = document.createElement("canvas");
  const scale = Math.min(2, 8192 / Math.max(width, height + header));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round((height + header) * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("瀏覽器不支援圖片匯出");
  context.scale(scale, scale);
  context.fillStyle = "#faf9f6";
  context.fillRect(0, 0, width, height + header);
  context.fillStyle = "#292321";
  context.font = "600 32px serif";
  context.fillText(title, 20, 42, width - 40);
  context.fillStyle = "#796d65";
  context.font = "16px sans-serif";
  context.fillText(subtitle, 20, 70, width - 40);
  context.fillText("kaladaxe · 臺灣原住民族語言詞彙地圖", 20, 94, width - 40);

  // Snapshot all positions and styles before the first asynchronous image decode.
  const relative = (node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height };
  };
  const layers = [...element.querySelectorAll(".leaflet-overlay-pane > svg, .leaflet-atlasRivers-pane > svg, .leaflet-atlasLines-pane > svg")].map((svg) => {
    const rect = relative(svg);
    const copy = svg.cloneNode(true);
    copy.removeAttribute("style");
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copy.setAttribute("width", rect.width);
    copy.setAttribute("height", rect.height);
    return { rect, source: new XMLSerializer().serializeToString(copy) };
  });
  const pins = [...element.querySelectorAll(".map-pin")].map((pin) => ({
    rect: relative(pin), proto: pin.classList.contains("proto"), selected: pin.classList.contains("selected"),
  }));
  const labels = [...element.querySelectorAll(".word-label")]
    .filter((label) => getComputedStyle(label).visibility === "visible")
    .map((label) => {
      const style = getComputedStyle(label);
      const runs = [];
      for (const span of label.children) {
        const text = span.firstChild;
        if (!text || text.nodeType !== Node.TEXT_NODE) continue;
        const css = getComputedStyle(span);
        // Range rectangles preserve the browser's wrapping, including long forms.
        const range = document.createRange();
        let start = 0;
        while (start < text.length) {
          range.setStart(text, start);
          range.setEnd(text, start + 1);
          const top = range.getBoundingClientRect().top;
          let end = start + 1;
          while (end < text.length) {
            range.setStart(text, end);
            range.setEnd(text, end + 1);
            if (Math.abs(range.getBoundingClientRect().top - top) > 1) break;
            end++;
          }
          range.setStart(text, start);
          range.setEnd(text, end);
          const rect = range.getBoundingClientRect();
          runs.push({ text: text.textContent.slice(start, end), x: rect.left - bounds.left,
            y: rect.top - bounds.top, font: css.font, color: css.color, direction: css.direction });
          start = end;
        }
      }
      return { rect: relative(label), background: style.backgroundColor, runs };
    });
  context.save();
  context.translate(0, header);
  context.beginPath();
  context.rect(0, 0, width, height);
  context.clip();
  for (const { rect, source } of layers) {
    const image = new Image();
    // A data URL keeps the self-contained SVG origin-clean for canvas export.
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
    await image.decode();
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  }
  for (const { rect, proto, selected } of pins) {
    context.beginPath();
    context.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2 - 1, 0, Math.PI * 2);
    context.fillStyle = proto ? "#ffffff" : "#991b1b";
    context.fill();
    context.strokeStyle = selected ? "#991b1b" : proto ? "#77685e" : "#ffffff";
    context.lineWidth = 2;
    context.setLineDash(proto ? [2, 2] : []);
    context.stroke();
  }
  context.setLineDash([]);
  for (const { rect, background, runs } of labels) {
    context.fillStyle = background;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    for (const run of runs) {
      context.font = run.font;
      context.fillStyle = run.color;
      context.textBaseline = "top";
      context.textAlign = "left";
      context.direction = run.direction;
      context.fillText(run.text, run.x, run.y);
    }
  }
  context.restore();
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (result) => result ? resolve(result) : reject(new Error("PNG 編碼失敗")), "image/png"));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
