// Keep geographic pins fixed. Labels use measured, bounded screen-space offsets.
export function createAtlas(element, onSelect, onBasemapError, onRiversError) {
  const L = window.L;
  if (!L) throw new Error("Leaflet 載入失敗");
  const map = L.map(element, { zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 5, maxZoom: 14, attributionControl: true });
  L.control.zoom({ position: "topright", zoomInTitle: "放大地圖", zoomOutTitle: "縮小地圖" }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com/">Leaflet</a>');
  map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>');
  const initialBounds = [[21.7, 119.25], [25.45, 122.2]];
  const reset = () => map.fitBounds(initialBounds, { paddingTopLeft: [30, 65], paddingBottomRight: [30, 30], animate: false });
  const home = L.control({ position: "topright" });
  home.onAdd = () => {
    const wrapper = L.DomUtil.create("div", "home-control leaflet-bar");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "⌖";
    button.title = "回到台灣全圖";
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", reset);
    L.DomEvent.disableClickPropagation(wrapper);
    wrapper.append(button);
    return wrapper;
  };
  home.addTo(map);
  reset();
  const riversPane = map.createPane("atlasRivers");
  riversPane.style.zIndex = "410";
  riversPane.style.pointerEvents = "none";
  const linesPane = map.createPane("atlasLines");
  linesPane.style.zIndex = "580";
  linesPane.style.pointerEvents = "none";
  const labelsPane = map.createPane("atlasLabels");
  labelsPane.style.zIndex = "620";
  labelsPane.style.pointerEvents = "none";
  const pins = L.layerGroup().addTo(map);
  const lines = L.layerGroup().addTo(map);
  let records = [];
  let selectedId = null;
  let frame = 0;
  let basemap = null;
  let baseRequest = null;
  let rivers = null;
  let riverRequest = null;

  function loadRivers() {
    if (riverRequest) return riverRequest;
    onRiversError(false);
    riverRequest = fetch(new URL("./taiwan-rivers.geojson", import.meta.url))
      .then((response) => {
        if (!response.ok) throw new Error("水系圖層下載失敗");
        return response.json();
      })
      .then((geojson) => {
        if (rivers) rivers.remove();
        rivers = L.geoJSON(geojson, {
          pane: "atlasRivers", interactive: false,
          style: { color: "#c4bbae", weight: 1, opacity: 0.6, fill: false,
            lineCap: "round", lineJoin: "round" },
        }).addTo(map);
        map.attributionControl.addAttribution('<a href="https://www.hydrosheds.org/products/hydrorivers">HydroRIVERS</a>');
      })
      .catch(() => onRiversError(true))
      .finally(() => { riverRequest = null; });
    return riverRequest;
  }

  function loadBasemap() {
    if (baseRequest) return baseRequest;
    onBasemapError(false);
    baseRequest = fetch(new URL("./taiwan.geojson", import.meta.url))
      .then((response) => {
        if (!response.ok) throw new Error("地理輪廓下載失敗");
        return response.json();
      })
      .then((geojson) => {
        if (basemap) basemap.remove();
        basemap = L.geoJSON(geojson, {
          interactive: false,
          style: { color: "#c9c2b7", weight: 1.3, fillColor: "#e8e3d7", fillOpacity: 0.46 },
        }).addTo(map);
      })
      .catch(() => onBasemapError(true))
      .finally(() => { baseRequest = null; });
    return baseRequest;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; layout(); });
  }

  const candidates = [{ x: 0, y: 0 }];
  for (const radius of [12, 24, 36, 48]) {
    for (let direction = 0; direction < 8; direction++) {
      const angle = direction * Math.PI / 4;
      candidates.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
  }
  const overlaps = (a, b) => a.x < b.x + b.width + 4 && a.x + a.width + 4 > b.x
    && a.y < b.y + b.height + 4 && a.y + a.height + 4 > b.y;

  function layout() {
    lines.clearLayers();
    const size = map.getSize();
    const boxes = [];
    // Chrome is a layout obstacle too, especially the selected detail card.
    const origin = element.getBoundingClientRect();
    for (const node of element.parentElement.querySelectorAll(".map-legend, .demo-notice:not([hidden]), .detail-card:not([hidden]), .map-notice:not([hidden]), .leaflet-control-zoom, .home-control")) {
      const rect = node.getBoundingClientRect();
      if (rect.bottom > origin.top && rect.top < origin.bottom) {
        boxes.push({ x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height });
      }
    }
    const ordered = records.slice().sort((a, b) => {
      if (a.variety.id === selectedId) return -1;
      if (b.variety.id === selectedId) return 1;
      return a.variety.id < b.variety.id ? -1 : a.variety.id > b.variety.id ? 1 : 0;
    });
    for (const record of ordered) {
      const { label, marker, pin, variety } = record;
      const selected = variety.id === selectedId;
      label.classList.toggle("selected", selected);
      pin.classList.toggle("selected", selected);
      label.setAttribute("aria-pressed", String(selected));
      pin.setAttribute("aria-pressed", String(selected));
      marker.setZIndexOffset(selected ? 1000 : 0);
      label.style.visibility = "hidden";
      const anchor = map.latLngToContainerPoint(marker.getLatLng());
      if (anchor.x < 0 || anchor.x > size.x || anchor.y < 0 || anchor.y > size.y) continue;
      const width = label.offsetWidth;
      const height = label.offsetHeight;
      const defaultPoint = { x: anchor.x + 12, y: anchor.y - height / 2 };
      let placed = null;
      for (const offset of candidates) {
        const box = { x: defaultPoint.x + offset.x, y: defaultPoint.y + offset.y, width, height };
        if (box.x < 4 || box.y < 4 || box.x + width > size.x - 4 || box.y + height > size.y - 4) continue;
        if (boxes.some((other) => overlaps(box, other))) continue;
        placed = { ...box, offset };
        break;
      }
      if (!placed) continue;
      boxes.push(placed);
      L.DomUtil.setPosition(label, map.containerPointToLayerPoint([placed.x, placed.y]));
      label.style.visibility = "visible";
      if (placed.offset.x !== 0 || placed.offset.y !== 0) {
        const endpoint = [Math.max(placed.x, Math.min(anchor.x, placed.x + width)),
          Math.max(placed.y, Math.min(anchor.y, placed.y + height))];
        L.polyline([marker.getLatLng(), map.containerPointToLatLng(endpoint)], {
          pane: "atlasLines", interactive: false, color: selected ? "#991b1b" : "#9b8b7b",
          weight: 1, opacity: 0.65,
        }).addTo(lines);
      }
    }
  }

  function setData(entries, selection = null) {
    selectedId = selection;
    pins.clearLayers();
    lines.clearLayers();
    labelsPane.replaceChildren();
    records = entries.map(({ variety, form }) => {
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "map-pin" + (variety.type === "proto" ? " proto" : "");
      pin.dataset.varietyId = variety.id;
      pin.setAttribute("aria-label", variety.name + "：" + form.orth + "，查看詞彙詳情");
      const marker = L.marker([variety.latitude, variety.longitude], {
        icon: L.divIcon({ className: "pin-container", html: pin, iconSize: [16, 16], iconAnchor: [8, 8] }),
        keyboard: false, interactive: true, bubblingMouseEvents: false,
      }).addTo(pins);
      pin.addEventListener("click", () => onSelect(variety.id));
      L.DomEvent.disableClickPropagation(pin);
      const label = document.createElement("button");
      label.type = "button";
      label.className = "word-label";
      label.dataset.varietyId = variety.id;
      label.style.pointerEvents = "auto";
      label.style.visibility = "hidden";
      label.setAttribute("aria-label", variety.name + "：" + form.orth + "，" + form.ipa);
      const orth = document.createElement("span");
      orth.className = "label-orth";
      orth.dir = "auto";
      orth.textContent = form.orth;
      const name = document.createElement("span");
      name.className = "label-name";
      name.textContent = variety.name;
      label.append(orth, name);
      label.addEventListener("click", () => onSelect(variety.id));
      L.DomEvent.disableClickPropagation(label);
      labelsPane.append(label);
      return { variety, label, marker, pin };
    });
    schedule();
  }

  function select(id, reveal = false) {
    selectedId = id;
    const record = records.find((item) => item.variety.id === id);
    if (reveal && record) {
      const point = record.marker.getLatLng();
      if (!map.getBounds().pad(-0.15).contains(point)) map.panTo(point, { animate: false });
    }
    schedule();
  }

  map.on("moveend zoomend", schedule);
  map.on("zoomstart", () => { labelsPane.style.opacity = "0"; linesPane.style.opacity = "0"; });
  map.on("zoomend", () => { labelsPane.style.opacity = "1"; linesPane.style.opacity = "1"; });
  const observer = new ResizeObserver(() => { map.invalidateSize({ pan: false }); schedule(); });
  observer.observe(element);
  const detail = element.parentElement.querySelector("#detail");
  if (detail) observer.observe(detail);
  if (document.fonts) document.fonts.ready.then(schedule);
  loadBasemap();
  loadRivers();
  return { setData, select, schedule, loadBasemap, loadRivers, reset };
}
