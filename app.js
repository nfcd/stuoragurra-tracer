/* Stuoragurra scarp tracer — edit mode.
 * Coordinates are ETRS89 / UTM 33N (EPSG:25833) metres throughout; Leaflet's
 * CRS.Simple is used with lat = northing, lng = easting.
 */
(async function () {
  "use strict";
  const STORE = "stuoragurra_tracer_v1";
  const VIEW = "stuoragurra_tracer_view_v1";
  const CONF_COLOR = { certain: "#e11d48", probable: "#f97316", possible: "#eab308" };
  const CONF_DASH = { certain: null, probable: "8 5", possible: "2 5" };

  const meta = await (await fetch("meta.json")).json();
  const { X0, Y1, width, height, zmin, zmax, tile: T } = meta;
  const S = Math.pow(2, zmax);                 // zoom zmax = 1 m per pixel
  const crs = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(1 / S, -X0 / S, -1 / S, Y1 / S) });
  const bounds = L.latLngBounds([Y1 - height, X0], [Y1, X0 + width]);
  const ll = (e, n) => L.latLng(n, e);
  const en = (latlng) => [latlng.lng, latlng.lat];

  // ---------------------------------------------------------------- map
  const map = L.map("map", { crs, minZoom: zmin, maxZoom: zmax + 3, zoomSnap: 0.5, doubleClickZoom: false,
                             maxBounds: bounds.pad(0.2), attributionControl: true, boxZoom: true });
  map.attributionControl.setPrefix(false).addAttribution("Elevation data: Kartverket / høydedata.no");
  const tileOpts = { tileSize: T, minZoom: zmin, maxZoom: zmax + 3, minNativeZoom: zmin, maxNativeZoom: zmax,
                     noWrap: true, bounds, errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" };
  // ---------------------------------------------------------------- elevation coloured in the browser
  // Elevation (dem/) and hillshade (hs/) tiles are combined here so the colour limits can change.
  const COLS = "stuoragurra_tracer_colours_v1";
  const GREY = Array.from({ length: 256 }, (_, i) => [i, i, i]);
  const PALETTES = { terrain: meta.terrain_lut, grey: GREY, greyr: GREY.slice().reverse() };
  const col = { min: meta.elev_range[0], max: meta.elev_range[1], shade: 0.45, pal: "terrain" };
  try { Object.assign(col, JSON.parse(localStorage.getItem(COLS)) || {}); } catch (e) { /* ignore */ }
  if (!PALETTES[col.pal]) col.pal = "terrain";
  let LUT = PALETTES[col.pal];
  const pyr = new Map();                 // "z/x/y" -> {z: Int32Array (cm), h: Uint8Array} | null
  const PYR_MAX = 300;
  function readPixels(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = T; c.height = T;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, T, T).data);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  async function tileData(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (pyr.has(key)) { const v = pyr.get(key); pyr.delete(key); pyr.set(key, v); return v; }   // LRU touch
    const [dd, hh] = await Promise.all([readPixels(`tiles/dem/${z}/${x}/${y}.webp`),
                                        readPixels(`tiles/hs/${z}/${x}/${y}.webp`)]);
    let v = null;
    if (dd) {
      const zc = new Int32Array(T * T), h = new Uint8Array(T * T);
      for (let i = 0; i < T * T; i++) {
        zc[i] = (dd[4 * i] << 16) | (dd[4 * i + 1] << 8) | dd[4 * i + 2];
        h[i] = hh ? hh[4 * i] : 128;
      }
      v = { z: zc, h };
    }
    pyr.set(key, v);
    if (pyr.size > PYR_MAX) pyr.delete(pyr.keys().next().value);
    return v;
  }
  function paint(canvas, d) {
    const ctx = canvas.getContext("2d");
    const im = ctx.createImageData(T, T), px = im.data;
    if (d) {
      const lo = col.min * 100, span = Math.max(1, (col.max - col.min) * 100), s = col.shade;
      for (let i = 0; i < T * T; i++) {
        const v = d.z[i];
        if (v === 0) continue;                              // no data: transparent
        let k = Math.round((v - lo) / span * 255);
        k = k < 0 ? 0 : k > 255 ? 255 : k;
        const hv = d.h[i] > 0 ? (d.h[i] - 1) / 254 : 1;
        const f = (1 - s) + s * hv, c = LUT[k];
        px[4 * i] = c[0] * f; px[4 * i + 1] = c[1] * f; px[4 * i + 2] = c[2] * f; px[4 * i + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
  }
  const live = new Map();                // canvas -> "z/x/y"
  const ElevLayer = L.GridLayer.extend({
    createTile(coords, done) {
      const c = document.createElement("canvas"); c.width = T; c.height = T;
      const key = `${coords.z}/${coords.x}/${coords.y}`;
      live.set(c, key);
      tileData(coords.z, coords.x, coords.y).then((d) => { paint(c, d); done(null, c); });
      return c;
    },
  });
  const elevLayer = new ElevLayer(tileOpts);
  elevLayer.on("tileunload", (ev) => live.delete(ev.tile));
  let repaintQueued = false;
  function repaint() {
    if (repaintQueued) return;
    repaintQueued = true;
    requestAnimationFrame(() => {
      repaintQueued = false;
      for (const [c, key] of live) { const d = pyr.get(key); if (d !== undefined) paint(c, d); }
    });
  }
  const byId = (id) => document.getElementById(id);
  function drawColourBar() {
    const cv = byId("cbar"), w = cv.clientWidth || 260;
    cv.width = w; cv.height = 14;
    const ctx = cv.getContext("2d");
    for (let i = 0; i < w; i++) { const c = LUT[Math.round(i / (w - 1) * 255)]; ctx.fillStyle = `rgb(${c})`; ctx.fillRect(i, 0, 1, 14); }
  }
  function setColours(min, max, shade, pal) {
    if (pal !== undefined && PALETTES[pal]) { col.pal = pal; LUT = PALETTES[pal]; drawColourBar(); }
    byId("c-pal").value = col.pal;
    if (min !== undefined && max !== undefined && isFinite(min) && isFinite(max) && max > min) { col.min = min; col.max = max; }
    if (shade !== undefined) col.shade = shade;
    byId("c-min").value = col.min.toFixed(1);
    byId("c-max").value = col.max.toFixed(1);
    byId("c-shade").value = col.shade;
    try { localStorage.setItem(COLS, JSON.stringify(col)); } catch (e) { /* ignore */ }
    repaint();
  }
  function fitToView() {
    const b = map.getBounds(), vals = [];
    for (const [, key] of live) {
      const d = pyr.get(key); if (!d) continue;
      const [z, x, y] = key.split("/").map(Number), m = Math.pow(2, zmax - z);
      const e0 = X0 + x * T * m, n0 = Y1 - y * T * m;
      for (let j = 0; j < T; j += 2) {
        const n = n0 - (j + 0.5) * m; if (n < b.getSouth() || n > b.getNorth()) continue;
        for (let i = 0; i < T; i += 2) {
          const e = e0 + (i + 0.5) * m; if (e < b.getWest() || e > b.getEast()) continue;
          const v = d.z[j * T + i]; if (v) vals.push(v);
        }
      }
    }
    if (vals.length < 50) return;
    vals.sort((a, c) => a - c);
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] / 100;
    setColours(Math.floor(q(0.02) * 10) / 10, Math.ceil(q(0.98) * 10) / 10);
  }
  byId("c-min").addEventListener("change", () => setColours(parseFloat(byId("c-min").value), col.max));
  byId("c-max").addEventListener("change", () => setColours(col.min, parseFloat(byId("c-max").value)));
  byId("c-shade").addEventListener("input", () => setColours(undefined, undefined, parseFloat(byId("c-shade").value)));
  byId("c-reset").onclick = () => setColours(meta.elev_range[0], meta.elev_range[1], 0.45);
  byId("c-pal").addEventListener("change", () => setColours(undefined, undefined, undefined, byId("c-pal").value));

  // ---------------------------------------------------------------- hillshade / texture (grey tiles)
  const GREYS = "stuoragurra_tracer_greys_v1";
  const GREY_INFO = {
    hs: ["Hillshade", "Sun from the NW (azimuth 315°, altitude 35°)."],
    tex: ["Texture shading", `Fractional Laplacian of the DEM (α = ${meta.texture ? meta.texture.alpha : 0.8}); ` +
          "fine relief is enhanced while the local shape of the terrain is kept."],
  };
  let greys = { hs: { c: 1, b: 1 }, tex: { c: 1, b: 1 } };
  try { Object.assign(greys, JSON.parse(localStorage.getItem(GREYS)) || {}); } catch (e) { /* ignore */ }
  // Hillshade view: tiles/hsv (white outside the corridor; DEMs/build_hillshade_view.py). tiles/hs (black no data)
  // stays for the Elevation view, which mixes it in.
  const greyLayers = { hs: L.tileLayer("tiles/hsv/{z}/{x}/{y}.webp", tileOpts),
                       tex: L.tileLayer("tiles/tex/{z}/{x}/{y}.webp", tileOpts) };
  function applyGrey(name) {
    const lay = greyLayers[name], g = greys[name];
    if (lay.getContainer()) lay.getContainer().style.filter = `contrast(${g.c}) brightness(${g.b})`;
  }
  for (const n of Object.keys(greyLayers)) greyLayers[n].on("add", () => applyGrey(n));
  function showGreyPanel(name) {
    byId("grey-panel").hidden = !greyLayers[name];
    if (!greyLayers[name]) return;
    greys[name] = greys[name] || { c: 1, b: 1 };
    byId("grey-title").textContent = GREY_INFO[name][0];
    byId("grey-desc").textContent = GREY_INFO[name][1];
    byId("g-contrast").value = greys[name].c;
    byId("g-bright").value = greys[name].b;
  }
  function setGrey(c, b) {
    if (!greyLayers[bg]) return;
    if (c !== undefined) greys[bg].c = c;
    if (b !== undefined) greys[bg].b = b;
    try { localStorage.setItem(GREYS, JSON.stringify(greys)); } catch (e) { /* ignore */ }
    applyGrey(bg);
  }
  byId("g-contrast").addEventListener("input", () => setGrey(parseFloat(byId("g-contrast").value)));
  byId("g-bright").addEventListener("input", () => setGrey(undefined, parseFloat(byId("g-bright").value)));
  byId("g-reset").onclick = () => { setGrey(1, 1); showGreyPanel(bg); };
  function fitElevation() {
    if (bg !== "elev") { setBackground("elev"); elevLayer.once("load", fitToView); }
    else fitToView();
  }
  byId("c-fit").onclick = fitElevation;
  setColours();

  const layers = { scarp: L.tileLayer("tiles/scarp/{z}/{x}/{y}.webp", tileOpts), elev: elevLayer,
                   hs: greyLayers.hs, tex: greyLayers.tex };
  let bg = "scarp";
  layers.scarp.addTo(map);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

  let view = null;
  try { view = JSON.parse(localStorage.getItem(VIEW)); } catch (e) { /* ignore */ }
  if (view) map.setView([view.lat, view.lng], view.z); else map.fitBounds(bounds);
  map.on("moveend", () => {
    const c = map.getCenter();
    try { localStorage.setItem(VIEW, JSON.stringify({ lat: c.lat, lng: c.lng, z: map.getZoom() })); } catch (e) { /* ignore */ }
  });

  function setBackground(name) {
    if (name === bg) return;
    map.removeLayer(layers[bg]);
    layers[name].addTo(map).bringToBack();
    bg = name;
    byId("elev-panel").hidden = name !== "elev";
    showGreyPanel(name);
    if (name === "elev") drawColourBar();
    document.querySelectorAll("button.bg").forEach((b) => b.classList.toggle("active", b.id === "bg-" + name));
  }
  document.getElementById("bg-scarp").onclick = () => setBackground("scarp");
  document.getElementById("bg-elev").onclick = () => setBackground("elev");
  document.getElementById("bg-tex").onclick = () => setBackground("tex");
  document.getElementById("bg-hs").onclick = () => setBackground("hs");
  setBackground("elev");                               // start on Elevation (first in the menu)

  // ---------------------------------------------------------------- elevation data tiles
  const demCache = new Map();          // "x/y" -> Int32Array (cm) | null | Promise
  function loadDem(tx, ty) {
    const key = tx + "/" + ty;
    if (demCache.has(key)) return demCache.get(key);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = T; c.height = T;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, T, T).data;
        const v = new Int32Array(T * T);
        for (let i = 0; i < T * T; i++) v[i] = (d[4 * i] << 16) | (d[4 * i + 1] << 8) | d[4 * i + 2];
        demCache.set(key, v);
        resolve(v);
      };
      img.onerror = () => { demCache.set(key, null); resolve(null); };
      img.src = `tiles/dem/${zmax}/${tx}/${ty}.webp`;
    });
    demCache.set(key, p);
    return p;
  }
  function rawZ(ix, iy) {             // pixel indices at 1 m; returns metres or NaN
    const tx = Math.floor(ix / T), ty = Math.floor(iy / T);
    const v = demCache.get(tx + "/" + ty);
    if (!(v instanceof Int32Array)) return NaN;
    const c = v[(iy - ty * T) * T + (ix - tx * T)];
    return c === 0 ? NaN : c / 100;
  }
  function zAt(e, n) {                // bilinear between pixel centres
    const fx = e - X0 - 0.5, fy = Y1 - n - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
    const z00 = rawZ(ix, iy), z10 = rawZ(ix + 1, iy), z01 = rawZ(ix, iy + 1), z11 = rawZ(ix + 1, iy + 1);
    return (z00 * (1 - ax) + z10 * ax) * (1 - ay) + (z01 * (1 - ax) + z11 * ax) * ay;
  }
  function tilesFor(points) {
    const s = new Set();
    for (const [e, n] of points) {
      const fx = e - X0 - 0.5, fy = Y1 - n - 0.5;
      for (const dx of [0, 1]) for (const dy of [0, 1])
        s.add(Math.floor((Math.floor(fx) + dx) / T) + "/" + Math.floor((Math.floor(fy) + dy) / T));
    }
    return [...s].map((k) => k.split("/").map(Number));
  }
  async function ensureTiles(points) {
    await Promise.all(tilesFor(points).map(([x, y]) => loadDem(x, y)));
  }

  // ---------------------------------------------------------------- state, storage, undo
  let state = { strands: [], profiles: [] };
  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.strands) state = s; } catch (e) { /* ignore */ }
  state.profiles = state.profiles || [];
  const traceName = (nm) => (nm || "").replace(/^strand(\s+\d+)$/i, "trace$1");   // older versions named the traces "strand N"
  state.strands.forEach((s) => { s.name = traceName(s.name); });
  let nextId = 1 + Math.max(0, ...state.strands.map((s) => s.id), ...state.profiles.map((p) => p.id || 0));
  const undoStack = [], redoStack = [];
  const snap = () => JSON.stringify(state);

  function commit(before) {
    undoStack.push(before);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    persist();
  }
  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
      setSaveState("Saved in this browser " + new Date().toLocaleTimeString());
    } catch (e) {
      setSaveState("Could not save in the browser — export now!");
    }
    renderAll();
  }
  function setSaveState(t) { document.getElementById("savestate").textContent = t; }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snap()); state = JSON.parse(undoStack.pop());
    if (!state.strands.some((s) => s.id === selId)) select(null);
    drawing = null; persist();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snap()); state = JSON.parse(redoStack.pop());
    drawing = null; persist();
  }
  document.getElementById("undo").onclick = undo;
  document.getElementById("redo").onclick = redo;

  // ---------------------------------------------------------------- modes
  let mode = "pan";
  let selId = null;            // selected strand id
  let selV = null;             // selected point (vertex index) of the selected strand
  let drawing = null;          // id of the strand being drawn (trace mode)
  let drawAtStart = false;     // drawing adds points before the first one
  let tool = "move";           // editing tool for the selected strand: move | insert | delete
  const mapEl = document.getElementById("map");
  function updateMapClass() {
    for (const c of [...mapEl.classList]) if (c.startsWith("mode-") || c.startsWith("tool-")) mapEl.classList.remove(c);
    mapEl.classList.add("mode-" + mode);
    if (mode === "pan" && selId !== null) mapEl.classList.add("tool-" + tool);
  }
  function setMode(m) {
    const was = mode;
    mode = m;
    if (m !== "trace") finishDrawing();
    if (m !== "profile") { profA = profB = null; profData = null; hidePanel(); }
    if (m === "profile" && was !== "profile") { clearProfilePanel(); showPanel(); drawChart(); }   // panel only in Profile mode
    $("profiles-section").hidden = m !== "profile";      // side-panel list of saved profiles: also only in Profile mode
    document.querySelectorAll("button.mode").forEach((b) => b.classList.toggle("active", b.id === "mode-" + m));
    renderAll();
    if (m === "review" && was !== "review") enterReview();
    if (m !== "review" && was === "review") leaveReview();
  }
  function setTool(t) {
    if (selId === null) return;
    if (mode !== "pan") setMode("pan");
    tool = t;
    renderAll();
  }
  document.getElementById("mode-pan").onclick = () => setMode("pan");
  document.getElementById("mode-trace").onclick = () => setMode("trace");
  document.getElementById("mode-profile").onclick = () => setMode("profile");
  document.getElementById("mode-review").onclick = () => setMode("review");

  // ---------------------------------------------------------------- strands
  const strandLayer = L.layerGroup().addTo(map);
  const vertexLayer = L.layerGroup().addTo(map);
  const strand = (id) => state.strands.find((s) => s.id === id);
  function select(id, v = null) { selId = id; selV = v; }
  const mpp = () => Math.pow(2, zmax - map.getZoom());          // metres per screen pixel

  function newStrand() {
    const n = state.strands.length + 1;
    const s = { id: nextId++, name: "trace " + n, confidence: "certain", notes: "", coords: [], hidden: false };
    state.strands.push(s);
    return s;
  }
  function finishDrawing() {
    if (drawing === null) return;
    const s = strand(drawing);
    drawing = null; drawAtStart = false;
    if (s && s.coords.length < 2) {
      const before = snap();
      state.strands = state.strands.filter((x) => x !== s);
      if (selId === s.id) select(null);
      commit(before);
    } else {
      renderAll();
    }
  }
  function lengthOf(coords) {
    let L_ = 0;
    for (let i = 1; i < coords.length; i++) L_ += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    return L_;
  }
  function nearestSegment(coords, p) {
    let best = { d: Infinity, i: -1, q: null };
    for (let i = 1; i < coords.length; i++) {
      const [ax, ay] = coords[i - 1], [bx, by] = coords[i];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2)) : 0;
      const q = [ax + t * dx, ay + t * dy], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < best.d) best = { d, i, q };
    }
    return best;
  }
  function insertAt(s, i, pt) {
    const b = snap();
    s.coords.splice(i, 0, pt);
    select(s.id, i);
    commit(b);
  }
  function deleteVertex(s, i) {
    const b = snap();
    s.coords.splice(i, 1);
    if (s.coords.length === 0) { state.strands = state.strands.filter((x) => x !== s); select(null); }
    else if (s.id === selId) selV = Math.min(i, s.coords.length - 1);
    commit(b);
  }

  function vertexIcon(onSel, isCur, isFirst) {
    const cls = "vx" + (onSel ? " sel" : "") + (isCur ? " cur" : "") + (isFirst && onSel ? " first" : "");
    return L.divIcon({ className: "", html: `<div class="${cls}"></div>`, iconSize: [0, 0] });
  }
  const midIcon = L.divIcon({ className: "", html: '<div class="mid"></div>', iconSize: [0, 0] });

  function renderStrands() {
    strandLayer.clearLayers();
    vertexLayer.clearLayers();
    const sel = strand(selId);
    if (sel && selV !== null && selV >= sel.coords.length) selV = sel.coords.length - 1;
    for (const s of state.strands) {
      if (s.hidden && s.id !== drawing) continue;
      const latlngs = s.coords.map(([e, n]) => ll(e, n));
      const isSel = s.id === selId || s.id === drawing;
      if (latlngs.length >= 2) {
        if (isSel) L.polyline(latlngs, { color: "#0b6bcb", weight: 7, opacity: 0.35, interactive: false }).addTo(strandLayer);
        const line = L.polyline(latlngs, { color: CONF_COLOR[s.confidence], weight: 3, dashArray: CONF_DASH[s.confidence],
                                          bubblingMouseEvents: false }).addTo(strandLayer);
        line.on("click", (ev) => onStrandClick(s, ev));
      }
      if (!(isSel || latlngs.length === 1)) continue;
      s.coords.forEach(([e, n], i) => {
        const cur = s.id === selId && i === selV;
        const m = L.marker(ll(e, n), { icon: vertexIcon(isSel, cur, i === 0), draggable: isSel && tool === "move" && mode === "pan",
                                       keyboard: false, bubblingMouseEvents: false, zIndexOffset: cur ? 1000 : 0 })
          .addTo(vertexLayer);
        let before = null;
        m.on("dragstart", () => { before = snap(); select(s.id, i); });
        m.on("drag", (ev) => { s.coords[i] = en(ev.target.getLatLng()); drawStrandQuick(); });
        m.on("dragend", () => { commit(before); });
        m.on("contextmenu", (ev) => { L.DomEvent.stop(ev); deleteVertex(s, i); });
        m.on("click", (ev) => {
          L.DomEvent.stop(ev);
          if (mode === "trace" && drawing !== null) { addVertex(ev.latlng); return; }
          if (mode === "profile") { onProfileClick(ev.latlng); return; }
          if (ev.originalEvent.altKey || (isSel && tool === "delete")) { deleteVertex(s, i); return; }
          select(s.id, i); renderAll();
        });
      });
      // mid-segment handles: drag (or click) to insert a point
      if (s.id === selId && drawing === null && mode === "pan" && tool === "move" && latlngs.length >= 2) {
        for (let i = 1; i < s.coords.length; i++) {
          const a = s.coords[i - 1], b = s.coords[i];
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) / mpp() < 28) continue;      // too short on screen
          const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const h = L.marker(ll(...mid), { icon: midIcon, draggable: true, keyboard: false, bubblingMouseEvents: false })
            .addTo(vertexLayer);
          h.bindTooltip("drag or click to insert a point", { direction: "top", offset: [0, -6] });
          let before = null;
          h.on("dragstart", () => { before = snap(); s.coords.splice(i, 0, mid.slice()); select(s.id, i); });
          h.on("drag", (ev) => { s.coords[i] = en(ev.target.getLatLng()); drawStrandQuick(); });
          h.on("dragend", () => { commit(before); });
          h.on("click", (ev) => { L.DomEvent.stop(ev); insertAt(s, i, mid.slice()); });
        }
      }
    }
    updateMapClass();
  }
  map.on("zoomend", () => { if (selId !== null) renderStrands(); });
  // cheap redraw during dragging
  function drawStrandQuick() {
    strandLayer.eachLayer((l) => { if (l instanceof L.Polyline) strandLayer.removeLayer(l); });
    for (const t of state.strands) {
      if (t.coords.length < 2 || (t.hidden && t.id !== drawing)) continue;
      L.polyline(t.coords.map(([e, n]) => ll(e, n)), { color: CONF_COLOR[t.confidence], weight: 3,
        dashArray: CONF_DASH[t.confidence], interactive: false }).addTo(strandLayer);
    }
  }

  function onStrandClick(s, ev) {
    L.DomEvent.stop(ev);
    const p = en(ev.latlng);
    if (mode === "profile") { onProfileClick(ev.latlng); return; }
    if (mode === "trace" && drawing !== null) { addVertex(ev.latlng); return; }
    if (ev.originalEvent.shiftKey || (s.id === selId && tool === "insert")) {
      const nb = nearestSegment(s.coords, p);
      if (nb.i > 0) insertAt(s, nb.i, nb.q);
      return;
    }
    select(s.id); renderAll();
  }

  function addVertex(latlng) {
    const before = snap();
    let s = drawing !== null ? strand(drawing) : null;
    if (!s) { s = newStrand(); drawing = s.id; drawAtStart = false; }
    const p = en(latlng);
    if (drawAtStart) s.coords.unshift(p); else s.coords.push(p);
    select(s.id, drawAtStart ? 0 : s.coords.length - 1);
    commit(before);
  }

  let flashTimer = null;
  function flash(msg) {
    setSaveState(msg);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => setSaveState("Saved in this browser"), 2500);
  }
  map.on("click", (ev) => {
    if (mode === "trace") { addVertex(ev.latlng); return; }
    if (mode === "profile") { onProfileClick(ev.latlng); return; }
    const s = strand(selId);
    if (s && tool === "insert") {                 // insert the clicked point into the nearest segment
      const p = en(ev.latlng), nb = nearestSegment(s.coords, p);
      if (nb.i > 0 && nb.d / mpp() <= 40) insertAt(s, nb.i, p);
      else flash("Insert: click on or close to the selected trace");
      return;
    }
    if (s && tool === "delete") return;
    select(null); renderAll();
  });
  map.on("dblclick", (ev) => { if (mode === "trace") { L.DomEvent.stop(ev); finishDrawing(); } });

  // visibility
  function saveQuiet() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ }
    renderAll();
  }
  function setVisible(s, v) {
    s.hidden = !v;
    if (!v && selId === s.id) select(null);
    saveQuiet();
  }
  function showAll(v) {
    for (const s of state.strands) s.hidden = !v;
    if (!v) select(null);
    saveQuiet();
  }
  function soloSelected() {
    if (selId === null) { flash("Select a trace first"); return; }
    for (const s of state.strands) s.hidden = s.id !== selId;
    saveQuiet();
  }

  // strand and point panel
  const $ = (id) => document.getElementById(id);
  function bindField(id, key) {
    let before = null;
    $(id).addEventListener("focus", () => { before = snap(); });
    $(id).addEventListener("input", () => {
      const s = strand(selId); if (!s) return;
      s[key] = $(id).value;
      try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ }
      renderStrands(); renderLists();
    });
    $(id).addEventListener("change", () => { if (before) { commit(before); before = null; } });
  }
  bindField("s-name", "name");
  bindField("s-conf", "confidence");
  bindField("s-notes", "notes");
  $("s-delete").onclick = () => deleteSelected();
  $("s-reverse").onclick = () => {
    const s = strand(selId); if (!s) return;
    const b = snap(); s.coords.reverse();
    if (selV !== null) selV = s.coords.length - 1 - selV;
    commit(b);
  };
  $("s-continue").onclick = () => continueSelected(false);
  $("s-prepend").onclick = () => continueSelected(true);
  $("s-hide").onclick = () => { const s = strand(selId); if (s) setVisible(s, false); };
  $("tool-move").onclick = () => setTool("move");
  $("tool-insert").onclick = () => setTool("insert");
  $("tool-delete").onclick = () => setTool("delete");
  $("vis-all").onclick = () => showAll(true);
  $("vis-none").onclick = () => showAll(false);
  $("vis-solo").onclick = () => soloSelected();
  function deleteSelected() {
    const s = strand(selId); if (!s) return;
    const b = snap();
    state.strands = state.strands.filter((x) => x !== s);
    select(null); drawing = null;
    commit(b);
  }
  function continueSelected(atStart) {
    const s = strand(selId); if (!s) return;
    s.hidden = false;
    setMode("trace");
    drawing = s.id; drawAtStart = !!atStart;
    select(s.id, atStart ? 0 : s.coords.length - 1);
    renderAll();
  }
  function stepVertex(d) {
    const s = strand(selId); if (!s || !s.coords.length) return;
    selV = selV === null ? (d > 0 ? 0 : s.coords.length - 1) : Math.max(0, Math.min(s.coords.length - 1, selV + d));
    const [e, n] = s.coords[selV];
    if (!map.getBounds().pad(-0.1).contains(ll(e, n))) map.panTo(ll(e, n));
    renderAll();
  }
  function nudge(de, dn) {
    const s = strand(selId); if (!s || selV === null) return;
    const b = snap();
    s.coords[selV] = [s.coords[selV][0] + de, s.coords[selV][1] + dn];
    commit(b);
  }
  function editPoint() {
    const s = strand(selId); if (!s || selV === null) return;
    const e = parseFloat($("pt-e").value), n = parseFloat($("pt-n").value);
    if (!isFinite(e) || !isFinite(n)) return;
    const b = snap(); s.coords[selV] = [e, n]; commit(b);
  }
  $("pt-e").addEventListener("change", editPoint);
  $("pt-n").addEventListener("change", editPoint);
  $("pt-prev").onclick = () => stepVertex(-1);
  $("pt-next").onclick = () => stepVertex(1);
  $("pt-del").onclick = () => { const s = strand(selId); if (s && selV !== null) deleteVertex(s, selV); };
  $("pt-zoom").onclick = () => {
    const s = strand(selId); if (!s || selV === null) return;
    map.setView(ll(...s.coords[selV]), Math.max(map.getZoom(), zmax));
  };

  // ---------------------------------------------------------------- profiles
  const profLayer = L.layerGroup().addTo(map);
  let profA = null, profB = null, profData = null, hoverMarker = null;

  function onProfileClick(latlng) {
    if (!profA || (profA && profB)) { profA = en(latlng); profB = null; profData = null; clearProfilePanel(); drawChart(); }
    else { profB = en(latlng); computeProfile(); }
    renderProfile();
  }
  function renderProfile() {
    profLayer.clearLayers();
    for (const p of state.profiles) {
      L.polyline([ll(...p.a), ll(...p.b)], { color: "#0b6bcb", weight: 2, opacity: 0.6, dashArray: "4 4" })
        .bindTooltip(p.name, { sticky: true }).addTo(profLayer)
        .on("click", (ev) => { L.DomEvent.stop(ev); openSaved(p); });
    }
    if (!profA) return;
    if (profB) L.polyline([ll(...profA), ll(...profB)], { color: "#0b6bcb", weight: 3, interactive: false }).addTo(profLayer);
    const ends = [["A", profA, (v) => { profA = v; }], ["B", profB, (v) => { profB = v; }]];
    for (const [lab, p, setp] of ends) {
      if (!p) continue;
      const m = L.marker(ll(...p), { draggable: true, icon: L.divIcon({ className: "", html: '<div class="pend"></div>', iconSize: [0, 0] }),
                                     bubblingMouseEvents: false }).addTo(profLayer);
      m.bindTooltip(lab, { permanent: true, direction: "right", className: "plabel", offset: [8, 0] });
      m.on("drag", (ev) => { setp(en(ev.target.getLatLng())); });
      m.on("dragend", () => { if (profA && profB) computeProfile(); renderProfile(); });
      m.on("click", (ev) => L.DomEvent.stop(ev));
    }
  }
  async function computeProfile() {
    const [ae, an] = profA, [be, bn] = profB;
    const L_ = Math.hypot(be - ae, bn - an);
    if (L_ < 2) return;
    const n = Math.floor(L_) + 1, pts = [];
    for (let i = 0; i < n; i++) { const t = i / (n - 1); pts.push([ae + t * (be - ae), an + t * (bn - an), t * L_]); }
    showPanel();
    $("p-info").textContent = "loading…";
    await ensureTiles(pts);
    profData = pts.map(([e, n2, d]) => ({ d, e, n: n2, z: zAt(e, n2) }));
    const az = (Math.atan2(be - ae, bn - an) * 180 / Math.PI + 360) % 360;
    const zs = profData.map((p) => p.z).filter((z) => !isNaN(z));
    $("p-title").textContent = "Profile";
    $("p-info").textContent = zs.length
      ? `A→B ${L_.toFixed(0)} m, azimuth ${az.toFixed(0)}°, relief ${(Math.max(...zs) - Math.min(...zs)).toFixed(1)} m`
      : "no elevation data along this line";
    drawChart();
  }
  function showPanel() { $("profile-panel").hidden = false; map.invalidateSize(); }
  function hidePanel() { $("profile-panel").hidden = true; map.invalidateSize(); if (hoverMarker) { map.removeLayer(hoverMarker); hoverMarker = null; } }
  function clearProfilePanel() { $("p-title").textContent = "Profile"; $("p-info").textContent = ""; }
  $("p-vex").onchange = () => drawChart();

  function niceStep(range, n) {
    const raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  let chartGeom = null;
  function drawChart(hoverIdx) {
    const cv = $("p-canvas"), dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    if (!profData) {                                   // Profile mode, no profile yet
      ctx.fillStyle = "#888"; ctx.font = "13px -apple-system, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(profA ? "Click the second point" : "Click two points on the map to draw a profile", W / 2, H / 2);
      return;
    }
    const ok = profData.filter((p) => !isNaN(p.z));
    if (!ok.length) return;
    const pad = { l: 56, r: 16, t: 10, b: 28 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const dmax = profData[profData.length - 1].d;
    let z0 = Math.min(...ok.map((p) => p.z)), z1 = Math.max(...ok.map((p) => p.z));
    const vex = $("p-vex").value;
    if (vex !== "auto") {          // fixed vertical exaggeration: metres per pixel vertically = horizontal / vex
      const mpp = dmax / pw / Number(vex), span = mpp * ph, mid = (z0 + z1) / 2;
      z0 = mid - span / 2; z1 = mid + span / 2;
    } else {
      const m = Math.max(0.5, (z1 - z0) * 0.08); z0 -= m; z1 += m;
    }
    const X = (d) => pad.l + d / dmax * pw, Y = (z) => pad.t + (z1 - z) / (z1 - z0) * ph;
    chartGeom = { X, pad, pw, dmax };
    ctx.strokeStyle = "#e5e2dc"; ctx.fillStyle = "#6b7280"; ctx.font = "11px -apple-system, sans-serif"; ctx.lineWidth = 1;
    const sx = niceStep(dmax, 8), sz = niceStep(z1 - z0, 5);
    ctx.textAlign = "center";
    for (let d = 0; d <= dmax + 1e-6; d += sx) {
      ctx.beginPath(); ctx.moveTo(X(d), pad.t); ctx.lineTo(X(d), pad.t + ph); ctx.stroke();
      ctx.fillText(d.toFixed(sx < 1 ? 1 : 0), X(d), H - 10);
    }
    ctx.textAlign = "right";
    for (let z = Math.ceil(z0 / sz) * sz; z <= z1; z += sz) {
      ctx.beginPath(); ctx.moveTo(pad.l, Y(z)); ctx.lineTo(pad.l + pw, Y(z)); ctx.stroke();
      ctx.fillText(z.toFixed(sz < 1 ? 1 : 0), pad.l - 6, Y(z) + 4);
    }
    ctx.save(); ctx.translate(12, pad.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center";
    ctx.fillText("elevation (m)", 0, 0); ctx.restore();
    ctx.textAlign = "left"; ctx.fillStyle = "#0b6bcb"; ctx.font = "bold 11px -apple-system, sans-serif";
    ctx.fillText("A", pad.l + 2, pad.t + 12); ctx.textAlign = "right"; ctx.fillText("B", pad.l + pw - 2, pad.t + 12);
    ctx.fillStyle = "#6b7280"; ctx.font = "11px -apple-system, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("distance from A (m)", pad.l + pw / 2, H - 10 + 0 * 1);
    // profile line
    ctx.strokeStyle = "#1f2328"; ctx.lineWidth = 1.4; ctx.beginPath();
    let pen = false;
    for (const p of profData) {
      if (isNaN(p.z)) { pen = false; continue; }
      if (!pen) { ctx.moveTo(X(p.d), Y(p.z)); pen = true; } else ctx.lineTo(X(p.d), Y(p.z));
    }
    ctx.stroke();
    if (hoverIdx != null && profData[hoverIdx] && !isNaN(profData[hoverIdx].z)) {
      const p = profData[hoverIdx];
      ctx.strokeStyle = "#0b6bcb"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(p.d), pad.t); ctx.lineTo(X(p.d), pad.t + ph); ctx.stroke();
      ctx.fillStyle = "#0b6bcb"; ctx.beginPath(); ctx.arc(X(p.d), Y(p.z), 3.5, 0, 2 * Math.PI); ctx.fill();
      ctx.textAlign = X(p.d) > pad.l + pw - 150 ? "right" : "left";
      ctx.fillText(`${p.d.toFixed(0)} m, ${p.z.toFixed(2)} m`, X(p.d) + (ctx.textAlign === "left" ? 6 : -6), pad.t + 24);
    }
  }
  $("p-canvas").addEventListener("mousemove", (ev) => {
    if (!profData || !chartGeom) return;
    const r = ev.target.getBoundingClientRect();
    const d = (ev.clientX - r.left - chartGeom.pad.l) / chartGeom.pw * chartGeom.dmax;
    const i = Math.max(0, Math.min(profData.length - 1, Math.round(d / (profData[1] ? profData[1].d : 1))));
    drawChart(i);
    const p = profData[i];
    if (!hoverMarker) hoverMarker = L.circleMarker(ll(p.e, p.n), { radius: 6, color: "#0b6bcb", fillOpacity: 1, interactive: false }).addTo(map);
    else hoverMarker.setLatLng(ll(p.e, p.n));
  });
  $("p-canvas").addEventListener("mouseleave", () => { drawChart(); if (hoverMarker) { map.removeLayer(hoverMarker); hoverMarker = null; } });
  window.addEventListener("resize", () => drawChart());

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function profileName() { return "profile " + (state.profiles.length + 1); }
  $("p-save").onclick = () => {
    if (!profA || !profB) return;
    const b = snap();
    const name = prompt("Name for this profile", profileName()) || profileName();
    state.profiles.push({ id: nextId++, name, a: profA, b: profB });
    commit(b);
    $("p-title").textContent = name;
  };
  $("p-csv").onclick = () => {
    if (!profData) return;
    const lines = ["# Stuoragurra scarp tracer profile, ETRS89 / UTM 33N (EPSG:25833), elevation m (NN2000)",
      `# A ${profA[0].toFixed(1)} ${profA[1].toFixed(1)}  B ${profB[0].toFixed(1)} ${profB[1].toFixed(1)}`,
      "distance_m,E,N,elevation_m"];
    for (const p of profData) lines.push(`${p.d.toFixed(1)},${p.e.toFixed(1)},${p.n.toFixed(1)},${isNaN(p.z) ? "" : p.z.toFixed(2)}`);
    download(($("p-title").textContent || "profile").replace(/\s+/g, "_") + ".csv", lines.join("\n"), "text/csv");
  };
  function openSaved(p) {
    setMode("profile");
    profA = p.a; profB = p.b;
    renderProfile();
    computeProfile().then(() => { $("p-title").textContent = p.name; });
  }

  // ---------------------------------------------------------------- side lists
  function renderLists() {
    const ul = $("strand-list"); ul.innerHTML = "";
    state.strands.forEach((s) => {
      const li = document.createElement("li");
      li.className = (s.id === selId ? "sel" : "") + (s.hidden ? " off" : "");
      li.innerHTML = `<button class="li-eye" title="${s.hidden ? "Show" : "Hide"} this trace">${s.hidden ? "○" : "●"}</button>` +
        `<span class="swatch" style="background:${CONF_COLOR[s.confidence]}"></span>` +
        `<span class="li-name"></span><span class="muted small">${(lengthOf(s.coords) / 1000).toFixed(2)} km</span>`;
      li.querySelector(".li-name").textContent = s.name;
      li.querySelector(".li-eye").onclick = (ev) => { ev.stopPropagation(); setVisible(s, !!s.hidden); };
      li.onclick = () => {
        s.hidden = false;
        select(s.id);
        if (s.coords.length) map.fitBounds(L.latLngBounds(s.coords.map(([e, n]) => ll(e, n))).pad(0.3), { maxZoom: zmax });
        saveQuiet();
      };
      ul.appendChild(li);
    });
    const nh = state.strands.filter((x) => x.hidden).length;
    $("strand-count").textContent = state.strands.length ? `(${state.strands.length}${nh ? ", " + nh + " hidden" : ""})` : "";
    $("vis-row").hidden = state.strands.length === 0;
    $("no-strands").hidden = state.strands.length > 0;

    const pl = $("profile-list"); pl.innerHTML = "";
    state.profiles.forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="li-name"></span><button class="li-x" title="Remove">×</button>`;
      li.querySelector(".li-name").textContent = p.name;
      li.onclick = () => { map.fitBounds(L.latLngBounds([ll(...p.a), ll(...p.b)]).pad(1), { maxZoom: zmax }); openSaved(p); };
      li.querySelector(".li-x").onclick = (ev) => {
        ev.stopPropagation();
        const b = snap(); state.profiles = state.profiles.filter((x) => x !== p); commit(b);
      };
      pl.appendChild(li);
    });
    $("prof-count").textContent = state.profiles.length ? `(${state.profiles.length})` : "";
    $("no-profiles").hidden = state.profiles.length > 0;

    const s = strand(selId);
    $("strand-panel").hidden = !s;
    if (s) {
      if (document.activeElement !== $("s-name")) $("s-name").value = s.name;
      $("s-conf").value = s.confidence;
      if (document.activeElement !== $("s-notes")) $("s-notes").value = s.notes || "";
      $("s-stats").textContent = `${s.coords.length} points, ${lengthOf(s.coords).toFixed(0)} m` +
        (drawing === s.id ? ` — adding points at the ${drawAtStart ? "start" : "end"} (Enter to finish)` : "");
      document.querySelectorAll("button.tool").forEach((b) => b.classList.toggle("active", mode === "pan" && b.id === "tool-" + tool));
    }
    const pv = s && selV !== null ? s.coords[selV] : null;
    $("pt-panel").hidden = !pv;
    if (pv) {
      $("pt-idx").textContent = `${selV + 1} of ${s.coords.length}` + (selV === 0 ? " (start)" : selV === s.coords.length - 1 ? " (end)" : "");
      if (document.activeElement !== $("pt-e")) $("pt-e").value = pv[0].toFixed(1);
      if (document.activeElement !== $("pt-n")) $("pt-n").value = pv[1].toFixed(1);
      const z = zAt(pv[0], pv[1]);
      $("pt-z").textContent = isNaN(z) ? "" : `elevation ${z.toFixed(2)} m`;
      if (isNaN(z)) ensureTiles([pv]).then(() => { const z2 = zAt(pv[0], pv[1]); if (!isNaN(z2)) $("pt-z").textContent = `elevation ${z2.toFixed(2)} m`; });
      map.keyboard.disable();            // arrow keys nudge the point instead of panning
    } else {
      map.keyboard.enable();
    }
    $("undo").disabled = !undoStack.length;
    $("redo").disabled = !redoStack.length;
  }
  function renderAll() { renderStrands(); renderProfile(); renderLists(); renderOverview(); }

  // ---------------------------------------------------------------- cursor readout
  let lastMove = 0;
  map.on("mousemove", (ev) => {
    const [e, n] = en(ev.latlng);
    const now = performance.now();
    if (now - lastMove < 40) return;
    lastMove = now;
    const fx = Math.floor(e - X0 - 0.5), fy = Math.floor(Y1 - n - 0.5);
    const key = Math.floor(fx / T) + "/" + Math.floor(fy / T);
    let z = zAt(e, n);
    if (!demCache.has(key)) ensureTiles([[e, n]]);
    $("cursor").textContent = `E ${e.toFixed(0)}  N ${n.toFixed(0)}  z ${isNaN(z) ? "–" : z.toFixed(2) + " m"}`;
  });

  // ---------------------------------------------------------------- export / import
  $("export").onclick = () => {
    const crsObj = { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::25833" } };
    const feats = state.strands.filter((s) => s.coords.length >= 2).map((s) => ({
      type: "Feature",
      properties: { kind: "scarp", name: s.name, confidence: s.confidence, notes: s.notes || "",
                    length_m: Math.round(lengthOf(s.coords)), visible: !s.hidden },
      geometry: { type: "LineString", coordinates: s.coords.map(([e, n]) => [+e.toFixed(2), +n.toFixed(2)]) } }))
      .concat(state.profiles.map((p) => ({
        type: "Feature", properties: { kind: "profile", name: p.name },
        geometry: { type: "LineString", coordinates: [p.a, p.b].map(([e, n]) => [+e.toFixed(2), +n.toFixed(2)]) } })));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    download(`scarps_${stamp}.geojson`, JSON.stringify({ type: "FeatureCollection", crs: crsObj, features: feats }, null, 1),
             "application/geo+json");
    setSaveState("Exported " + new Date().toLocaleTimeString());
  };
  $("import").onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    await importTraces(await f.text(), false);
    ev.target.value = "";
  };
  // read a GeoJSON of traces; replaceAll = true replaces without asking (used by "Paper's interpretation")
  async function importTraces(text, replaceAll) {
    try {
      const gj = JSON.parse(text);
      const b = snap();
      const replace = replaceAll || state.strands.length === 0 ||
        confirm("Replace the current traces and profiles? (Cancel adds the imported ones instead)");
      if (replace) { state.strands = []; state.profiles = []; }
      for (const ft of gj.features || []) {
        if (!ft.geometry || ft.geometry.type !== "LineString") continue;
        const c = ft.geometry.coordinates.map(([e, n]) => [e, n]);
        const pr = ft.properties || {};
        if (pr.kind === "profile") state.profiles.push({ id: nextId++, name: pr.name || profileName(), a: c[0], b: c[c.length - 1] });
        else state.strands.push({ id: nextId++, name: traceName(pr.name) || "trace " + (state.strands.length + 1),
                                  confidence: CONF_COLOR[pr.confidence] ? pr.confidence : "certain", notes: pr.notes || "", coords: c,
                                  hidden: pr.visible === false });
      }
      select(null); drawing = null;
      commit(b);
      return true;
    } catch (e) {
      alert("Could not read that file: " + e.message);
      return false;
    }
  }

  // ---------------------------------------------------------------- review of profiles across the traces
  // Stations every R_SPACING m from each trace's first point, perpendicular to the strike over
  // +-R_STRIKE m, profile direction pointing SE (same rules and ids as DEMs/fault_profiles.py).
  const REVIEW = "stuoragurra_review_v1";
  const R_SPACING = 100, R_STRIKE = 50, R_STALE = 5;
  const DEC_COL = { accept: "#2d6a4f", unsure: "#e09f3e", reject: "#c1121f" };
  let decisions = {};
  try { decisions = JSON.parse(localStorage.getItem(REVIEW)) || {}; } catch (e) { /* ignore */ }
  let rList = [], rIdx = 0, rData = null;
  const reviewLayer = L.layerGroup().addTo(map);
  const saveDecisions = () => { try { localStorage.setItem(REVIEW, JSON.stringify(decisions)); } catch (e) { /* ignore */ } };

  function traceNumber(s, i) {
    const d = (s.name || "").match(/\d+/);
    return d ? parseInt(d[0], 10) : i + 1;
  }
  function buildStations() {
    const out = [];
    state.strands.forEach((s, i) => {
      const c = s.coords;
      if (c.length < 2) return;
      const num = traceNumber(s, i);
      const d = [0];
      for (let k = 1; k < c.length; k++) d.push(d[k - 1] + Math.hypot(c[k][0] - c[k - 1][0], c[k][1] - c[k - 1][1]));
      const L_ = d[d.length - 1];
      const at = (sv) => {
        sv = Math.max(0, Math.min(L_, sv));
        let k = 1; while (k < d.length - 1 && d[k] < sv) k++;
        const f = (sv - d[k - 1]) / ((d[k] - d[k - 1]) || 1);
        return [c[k - 1][0] + f * (c[k][0] - c[k - 1][0]), c[k - 1][1] + f * (c[k][1] - c[k - 1][1])];
      };
      for (let sv = 0, k = 0; sv <= L_ + 1e-6; sv += R_SPACING, k++) {
        const a = at(sv - R_STRIKE), b = at(sv + R_STRIKE), p = at(sv);
        let te = b[0] - a[0], tn = b[1] - a[1];
        const tl = Math.hypot(te, tn) || 1; te /= tl; tn /= tl;
        let ne = tn, nn = -te;
        if (ne - nn < 0) { ne = -ne; nn = -nn; }          // towards the SE
        out.push({ id: `T${String(num).padStart(2, "0")}_P${String(k).padStart(3, "0")}`, trace: num, k, s: sv,
                   c: p, t: [te, tn], n: [ne, nn],
                   strike: (Math.atan2(te, tn) * 180 / Math.PI + 360) % 360,
                   az: (Math.atan2(ne, nn) * 180 / Math.PI + 360) % 360 });
      }
    });
    out.sort((x, y) => x.trace - y.trace || x.k - y.k);
    return out;
  }
  function decisionOf(st) {
    const d = decisions[st.id];
    if (!d) return null;
    if (Math.hypot(d.e - st.c[0], d.n - st.c[1]) > R_STALE) return { ...d, stale: true };
    return d;
  }

  // profiles drawn on the map outside Review mode ("Profiles" in the toolbar; Nestor, 14 Oct)
  const overviewLayer = L.layerGroup().addTo(map);
  function renderOverview() {
    overviewLayer.clearLayers();
    const show = $("map-prof").value;
    if (show === "off" || mode === "review") return;
    const half = +$("r-half").value || 50;
    buildStations().forEach((st, i) => {
      const d = decisionOf(st);
      if (show === "accept" && !(d && !d.stale && d.d === "accept")) return;
      const col = d && !d.stale ? DEC_COL[d.d] : "#6c757d";
      const a = [st.c[0] - half * st.n[0], st.c[1] - half * st.n[1]], b = [st.c[0] + half * st.n[0], st.c[1] + half * st.n[1]];
      L.polyline([ll(...a), ll(...b)], { color: col, weight: 2, opacity: 0.85, dashArray: d && !d.stale ? null : "4 4",
                                         bubblingMouseEvents: false })
        .bindTooltip(st.id, { sticky: true })
        .on("click", (ev) => { L.DomEvent.stop(ev); rIdx = i; setMode("review"); })
        .addTo(overviewLayer);
    });
  }
  $("map-prof").onchange = renderOverview;

  function enterReview() {
    rList = buildStations();
    if (!rList.length) { flash("No traces to review"); setMode("pan"); return; }
    rIdx = Math.min(rIdx, rList.length - 1);
    const sel = $("r-trace"); sel.innerHTML = "";
    [...new Set(rList.map((x) => x.trace))].forEach((t) => {
      const o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o);
    });
    $("review-panel").hidden = false;
    map.invalidateSize();
    showStation(rIdx, true);
  }
  function leaveReview() {
    $("review-panel").hidden = true;
    reviewLayer.clearLayers();
    map.invalidateSize();
    renderOverview();
  }

  // "Show" filter: which profiles are drawn and stepped through (Nestor, 14 Oct)
  function passes(st) {
    const f = $("r-filter").value;
    if (f === "all") return true;
    const q = decisionOf(st);
    if (f === "none") return !q || q.stale;
    return !!q && !q.stale && q.d === f;
  }
  let rNone = false;
  let rXr = 50;                                       // half-width of the x-axis drawn in the review chart (m)                                  // the "Show" filter matches no profile: nothing selected or drawn
  function step(dir) {                                // next / previous profile that passes the filter
    for (let i = rIdx + dir; i >= 0 && i < rList.length; i += dir) if (passes(rList[i])) { showStation(i); return true; }
    flash("No more profiles of this kind in this direction");
    return false;
  }

  function renderReviewMap() {
    reviewLayer.clearLayers();
    if (mode !== "review" || rNone) return;
    const half = +$("r-half").value || 200, band = +$("r-band").value || 0;
    rList.forEach((st, i) => {
      if (i !== rIdx && !passes(st)) return;
      const d = decisionOf(st);
      const col = d && !d.stale ? DEC_COL[d.d] : "#6c757d";
      const a = [st.c[0] - half * st.n[0], st.c[1] - half * st.n[1]], b = [st.c[0] + half * st.n[0], st.c[1] + half * st.n[1]];
      const line = L.polyline([ll(...a), ll(...b)], { color: col, weight: i === rIdx ? 3 : 2, opacity: i === rIdx ? 1 : 0.75,
                                                     dashArray: d && !d.stale ? null : "4 4", bubblingMouseEvents: false })
        .addTo(reviewLayer);
      line.bindTooltip(st.id, { sticky: true });
      line.on("click", (ev) => { L.DomEvent.stop(ev); showStation(i); });
    });
    const st = rList[rIdx];
    if (st && band > 0) {
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
        ll(st.c[0] + sx * half * st.n[0] + sy * band * st.t[0], st.c[1] + sx * half * st.n[1] + sy * band * st.t[1]));
      L.polygon(q, { color: "#0b6bcb", weight: 1, fillOpacity: 0.08, interactive: false }).addTo(reviewLayer);
    }
  }

  async function showStation(i, recentre) {
    rNone = false;
    rIdx = Math.max(0, Math.min(rList.length - 1, i));
    const st = rList[rIdx];
    const half = Math.max(10, +$("r-half").value || 200), band = Math.max(0, +$("r-band").value || 0);
    const view = map.getBounds().pad(-0.15);
    const ends = [ll(st.c[0] - half * st.n[0], st.c[1] - half * st.n[1]), ll(st.c[0] + half * st.n[0], st.c[1] + half * st.n[1])];
    if (recentre || !view.contains(ends[0]) || !view.contains(ends[1]) || map.getZoom() < zmax - 2)
      map.setView(ll(...st.c), Math.max(map.getZoom(), zmax - 1));
    $("r-trace").value = st.trace;
    renderReviewMap();
    updateReviewPanel();
    // swath samples
    const xs = [], offs = [];
    for (let x = -half; x <= half + 1e-6; x += 1) xs.push(x);
    for (let o = -band; o <= band + 1e-6; o += 1) offs.push(o);
    const pts = [];
    for (const o of offs) for (const x of xs)
      pts.push([st.c[0] + x * st.n[0] + o * st.t[0], st.c[1] + x * st.n[1] + o * st.t[1]]);
    $("r-metrics").textContent = "loading…";
    await ensureTiles(pts);
    if (rList[rIdx] !== st) return;                      // moved on meanwhile
    const nx = xs.length, no = offs.length;
    // swath statistics across the lines along strike: median and 25-75 % range, as in the paper figures (Nestor, 14 Oct)
    const med = new Float64Array(nx), q25 = new Float64Array(nx), q75 = new Float64Array(nx);
    const cen = new Float64Array(nx);
    const mid = Math.floor(no / 2);
    const quant = (v, q) => { const p = (v.length - 1) * q, i = Math.floor(p), f = p - i;
                              return i + 1 < v.length ? v[i] * (1 - f) + v[i + 1] * f : v[i]; };   // linear, as numpy
    for (let j = 0; j < nx; j++) {
      const v = [];
      for (let k = 0; k < no; k++) {
        const z = zAt(...pts[k * nx + j]);
        if (k === mid) cen[j] = z;
        if (!isNaN(z)) v.push(z);
      }
      v.sort((a, b) => a - b);
      med[j] = v.length ? quant(v, 0.5) : NaN; q25[j] = v.length ? quant(v, 0.25) : NaN; q75[j] = v.length ? quant(v, 0.75) : NaN;
    }
    rData = { st, xs, med, q25, q75, cen, half, band };
    $("r-metrics").textContent = "";                      // only used for "loading…" (advice text removed, 14 Oct)
    drawReview();
  }

  function drawReview(hoverX) {
    const cv = $("r-canvas"), dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
    if (rNone) {
      ctx.fillStyle = "#888"; ctx.font = "13px -apple-system, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("No profiles of this kind", W / 2, H / 2);
      return;
    }
    if (!rData) return;
    const { xs, med, q25, q75, cen, half, band } = rData;
    const vals = [...q25, ...q75, ...($("r-line").checked ? cen : [])].filter((v) => !isNaN(v));
    if (!vals.length) { ctx.fillText("no elevation data", 20, 20); return; }
    let z0 = Math.min(...vals), z1 = Math.max(...vals);
    const m = Math.max(0.5, (z1 - z0) * 0.06); z0 -= m; z1 += m;
    const pad = { l: 52, r: 12, t: 10, b: 26 }, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const rvex = $("r-vex").value;                 // vertical exaggeration as in the Profile panel (Nestor, 14 Oct)
    let xr = half;                                 // half-width of the x-axis drawn
    if (rvex !== "auto") {                         // fixed factor: vertical m/px = horizontal m/px / factor. The scale is the
      const v = Number(rvex);                      // largest that fits both the profile length and its relief, so the whole
      const s = Math.max(2 * half / pw, (z1 - z0) / (v * ph));   // profile always fits; axes extend as needed (Nestor, 14 Oct)
      xr = s * pw / 2;
      const span = s / v * ph, mid = (z0 + z1) / 2;
      z0 = mid - span / 2; z1 = mid + span / 2;
    }
    rXr = xr;
    const ve = (z1 - z0) > 0 ? (2 * xr / pw) / ((z1 - z0) / ph) : 1;
    const X = (x) => pad.l + (x + xr) / (2 * xr) * pw, Y = (z) => pad.t + (z1 - z) / (z1 - z0) * ph;
    ctx.strokeStyle = "#e5e2dc"; ctx.fillStyle = "#6b7280"; ctx.font = "11px -apple-system, sans-serif"; ctx.lineWidth = 1;
    const sx = niceStep(2 * xr, 8), sz = niceStep(z1 - z0, 5);
    ctx.textAlign = "center";
    for (let x = Math.ceil(-xr / sx) * sx; x <= xr + 1e-9; x += sx) {
      ctx.beginPath(); ctx.moveTo(X(x), pad.t); ctx.lineTo(X(x), pad.t + ph); ctx.stroke();
      ctx.fillText(x.toFixed(0), X(x), H - 8);
    }
    ctx.textAlign = "right";
    for (let z = Math.ceil(z0 / sz) * sz; z <= z1; z += sz) {
      ctx.beginPath(); ctx.moveTo(pad.l, Y(z)); ctx.lineTo(pad.l + pw, Y(z)); ctx.stroke();
      ctx.fillText(z.toFixed(sz < 1 ? 1 : 0), pad.l - 6, Y(z) + 4);
    }
    ctx.textAlign = "center"; ctx.fillText(rvex === "1" ? "true scale (1:1)" : `vertical exaggeration ×${ve.toFixed(ve < 10 ? 1 : 0)}`,
                                            pad.l + pw / 2, pad.t + 12);
    ctx.textAlign = "left"; ctx.fillText("NW", pad.l + 4, pad.t + 12);
    ctx.textAlign = "right"; ctx.fillText("SE", pad.l + pw - 4, pad.t + 12);
    const band_ = (a, b, col) => {
      ctx.fillStyle = col; ctx.beginPath();
      let started = false;
      xs.forEach((x, i) => { if (isNaN(a[i])) return; if (!started) { ctx.moveTo(X(x), Y(a[i])); started = true; } else ctx.lineTo(X(x), Y(a[i])); });
      for (let i = xs.length - 1; i >= 0; i--) if (!isNaN(b[i])) ctx.lineTo(X(xs[i]), Y(b[i]));
      ctx.closePath(); ctx.fill();
    };
    if (band > 0) band_(q25, q75, "#c6dbef");                // 25-75 % range (light blue, as in the paper figures)
    const line = (a, col, w) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); let pen = false;
      xs.forEach((x, i) => { if (isNaN(a[i])) { pen = false; return; } if (!pen) { ctx.moveTo(X(x), Y(a[i])); pen = true; } else ctx.lineTo(X(x), Y(a[i])); });
      ctx.stroke();
    };
    if ($("r-line").checked) line(cen, "#0b6bcb", 0.8);
    line(med, "#111", 1.4);                               // median
    ctx.strokeStyle = "#c1121f"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(0), pad.t); ctx.lineTo(X(0), pad.t + ph); ctx.stroke(); ctx.setLineDash([]);
    if (hoverX !== undefined) {
      const i = Math.round(hoverX + half);
      if (xs[i] !== undefined && !isNaN(med[i])) {
        ctx.fillStyle = "#0b6bcb"; ctx.beginPath(); ctx.arc(X(xs[i]), Y(med[i]), 3.5, 0, 2 * Math.PI); ctx.fill();
        ctx.textAlign = "left"; ctx.fillText(`x ${xs[i]} m, ${med[i].toFixed(2)} m`, X(xs[i]) + 6, pad.t + 26);
      }
    }
  }
  $("r-vex").onchange = () => drawReview();
  let rHover = null;
  $("r-canvas").addEventListener("mousemove", (ev) => {
    if (!rData) return;
    const r = ev.target.getBoundingClientRect(), pw = r.width - 52 - 12;
    const x = Math.max(-rData.half, Math.min(rData.half, Math.round(((ev.clientX - r.left - 52) / pw) * 2 * rXr - rXr)));
    drawReview(x);
    const st = rData.st, p = ll(st.c[0] + x * st.n[0], st.c[1] + x * st.n[1]);
    if (!rHover) rHover = L.circleMarker(p, { radius: 5, color: "#0b6bcb", fillOpacity: 1, interactive: false }).addTo(map);
    else rHover.setLatLng(p);
  });
  $("r-canvas").addEventListener("mouseleave", () => { drawReview(); if (rHover) { map.removeLayer(rHover); rHover = null; } });
  window.addEventListener("resize", () => { if (mode === "review") drawReview(); });

  function updateReviewPanel() {
    for (const id of ["r-accept", "r-unsure", "r-reject", "r-clear", "r-note"]) $(id).disabled = rNone;
    if (rNone) {
      $("r-title").textContent = "No profiles of this kind";
      $("r-status").textContent = ""; $("r-metrics").textContent = ""; $("r-note").value = "";
      for (const k of ["accept", "unsure", "reject"]) $("r-" + k).classList.remove("on");
      $("r-fcount").textContent = `0 of ${rList.length}`;
      return;
    }
    const st = rList[rIdx]; if (!st) return;
    const d = decisionOf(st);
    $("r-title").textContent = `${st.id}  (${st.s.toFixed(0)} m along trace ${st.trace})`;
    const ofTrace = rList.filter((x) => x.trace === st.trace);
    const cnt = (lst, k) => lst.filter((x) => { const q = decisionOf(x); return q && !q.stale && q.d === k; }).length;
    const rev = (lst) => lst.filter((x) => { const q = decisionOf(x); return q && !q.stale; }).length;
    const summary = (lst) => {                            // plain-language counts (Nestor, 14 Oct)
      const open = lst.length - rev(lst);
      return `${cnt(lst, "accept")} accepted, ${cnt(lst, "unsure")} unsure, ${cnt(lst, "reject")} rejected` +
             (open ? `, ${open} not reviewed` : "");
    };
    $("r-status").textContent =
      `Trace ${st.trace} (${ofTrace.length} profiles): ${summary(ofTrace)}  ·  All traces (${rList.length} profiles): ${summary(rList)}` +
      (d && d.stale ? "  ·  ⚠ decision outdated (trace edited)" : "");
    for (const k of ["accept", "unsure", "reject"]) $("r-" + k).classList.toggle("on", !!d && !d.stale && d.d === k);
    $("r-fcount").textContent = $("r-filter").value === "all" ? "" : `${rList.filter(passes).length} of ${rList.length}`;
    if (document.activeElement !== $("r-note")) $("r-note").value = d ? d.note || "" : "";
  }
  function decide(k) {
    if (rNone) return;
    const st = rList[rIdx]; if (!st) return;
    if (k === null) delete decisions[st.id];
    else decisions[st.id] = { d: k, note: $("r-note").value.trim(), e: +st.c[0].toFixed(1), n: +st.c[1].toFixed(1),
                              t: new Date().toISOString() };
    saveDecisions();
    if (k !== null && rIdx < rList.length - 1 && step(1)) return;
    renderReviewMap(); updateReviewPanel();
  }
  function nextOpen() {
    for (let j = 1; j <= rList.length; j++) {
      const i = (rIdx + j) % rList.length, q = decisionOf(rList[i]);
      if (!q || q.stale) { showStation(i); return; }
    }
    flash("All profiles reviewed");
  }
  $("r-accept").onclick = () => decide("accept");
  $("r-unsure").onclick = () => decide("unsure");
  $("r-reject").onclick = () => decide("reject");
  $("r-clear").onclick = () => decide(null);
  $("r-prev").onclick = () => step(-1);
  $("r-next").onclick = () => step(1);
  $("r-filter").onchange = () => {                     // jump to the first matching profile if the current one does not match
    const i = rList.findIndex(passes);
    if (i < 0) { rNone = true; renderReviewMap(); updateReviewPanel(); drawReview(); return; }   // none: show nothing
    rNone = false;
    if (!passes(rList[rIdx])) { showStation(i, true); return; }
    renderReviewMap(); updateReviewPanel(); drawReview();
  };
  $("r-nextopen").onclick = nextOpen;
  $("r-trace").onchange = () => { const i = rList.findIndex((x) => x.trace === +$("r-trace").value); if (i >= 0) showStation(i, true); };
  $("r-half").onchange = () => showStation(rIdx);
  $("r-band").onchange = () => showStation(rIdx);
  $("r-line").onchange = () => drawReview();
  $("r-note").addEventListener("change", () => {
    const st = rList[rIdx], d = decisions[st && st.id];
    if (d) { d.note = $("r-note").value.trim(); saveDecisions(); }
  });
  $("r-export").onclick = () => {
    const half = +$("r-half").value, band = +$("r-band").value;
    const lines = ["# Stuoragurra profile review; ETRS89 / UTM 33N (EPSG:25833)",
      `# profiles every ${R_SPACING} m from each trace's first point, perpendicular to the strike over +-${R_STRIKE} m, x > 0 towards SE`,
      `# reviewed with half-length ${half} m and swath +-${band} m (1 m corridor DEM); decision: accept / unsure / reject / (empty = not reviewed)`,
      "id,trace,profile,dist_along_m,centre_E,centre_N,strike_deg,azimuth_deg,decision,note,reviewed_at"];
    for (const st of rList) {
      const d = decisionOf(st), ok = d && !d.stale;
      const note = ok && d.note ? `"${d.note.replace(/"/g, '""')}"` : "";
      lines.push([st.id, st.trace, st.k, st.s.toFixed(0), st.c[0].toFixed(1), st.c[1].toFixed(1), st.strike.toFixed(0),
                  st.az.toFixed(0), ok ? d.d : "", note, ok ? d.t : ""].join(","));
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    download(`profile_review_${stamp}.csv`, lines.join("\n"), "text/csv");
    flash("Review exported");
  };
  $("r-import").onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    importReview(await f.text(), false);
    ev.target.value = "";
  };
  // read a review CSV; replaceAll = true first removes the decisions stored in this browser
  function importReview(text, replaceAll) {
    if (replaceAll) decisions = {};
    const rows = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
    const hdr = rows.shift().split(",");
    const col = (k) => hdr.indexOf(k);
    let n = 0;
    for (const r of rows) {
      const c = r.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
      const dec = c[col("decision")];
      if (!dec) continue;
      decisions[c[col("id")]] = { d: dec, note: c[col("note")] || "", e: +c[col("centre_E")], n: +c[col("centre_N")],
                                  t: c[col("reviewed_at")] || new Date().toISOString() };
      n++;
    }
    saveDecisions(); flash(`${n} decisions imported`); renderOverview();
    if (mode === "review") { renderReviewMap(); updateReviewPanel(); }
    return n;
  }

  // ---------------------------------------------------------------- the paper's interpretation (interpretation/)
  $("paper").onclick = async () => {
    if ((state.strands.length || Object.keys(decisions).length) &&
        !confirm("Load the paper's scarp traces and profile review? This replaces the traces and decisions in this browser " +
                 "(export them first to keep them; Undo brings the traces back).")) return;
    try {
      const [gj, csv] = await Promise.all(["interpretation/scarps.geojson", "interpretation/profile_review.csv"].map(async (u) => {
        const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error(u + ": " + r.status); return r.text(); }));
      if (!(await importTraces(gj, true))) return;
      const n = importReview(csv, true);
      flash(`Paper's interpretation loaded: ${state.strands.length} traces, ${n} profile decisions`);
    } catch (e) {
      alert("Could not load the paper's interpretation: " + e.message);
    }
  };

  // ---------------------------------------------------------------- start from scratch
  $("new").onclick = () => {
    if (!confirm("Start from scratch? This removes all traces, profiles and review decisions stored in this browser.\n" +
                 "Export your traces and review first if you want to keep them.")) return;
    const b = snap();
    state.strands = []; state.profiles = [];
    select(null); drawing = null;
    commit(b);                                       // strands and profiles can still be brought back with Undo
    decisions = {}; saveDecisions(); renderOverview();
    if (mode === "review") { renderReviewMap(); updateReviewPanel(); }
    flash("Started from scratch");
  };
  function reviewKey(ev) {
    if (mode !== "review") return false;
    const k = ev.key;
    if (k === "ArrowRight") step(1);
    else if (k === "ArrowLeft") step(-1);
    else if (k === "y" || k === "Y") decide("accept");
    else if (k === "n" || k === "N") decide("reject");
    else if (k === "u" || k === "U") decide("unsure");
    else if (k === "0") decide(null);
    else if (k === " ") nextOpen();
    else if (k === "Escape") setMode("pan");
    else return false;
    ev.preventDefault();
    return true;
  }

  // ---------------------------------------------------------------- help & keys
  $("help-btn").onclick = () => { $("help").hidden = false; };
  $("help-close").onclick = () => { $("help").hidden = true; };
  $("help").onclick = (ev) => { if (ev.target.id === "help") $("help").hidden = true; };
  document.addEventListener("keydown", (ev) => {
    const tag = (ev.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if (mod) return;
    if (reviewKey(ev)) return;
    switch (ev.key) {
      case "r": case "R": setMode("review"); break;
      case "v": case "V": setMode("pan"); break;
      case "t": case "T": setMode("trace"); break;
      case "p": case "P": setMode("profile"); break;
      case "c": case "C": continueSelected(false); break;
      case "a": case "A": continueSelected(true); break;
      case "m": case "M": setTool("move"); break;
      case "i": case "I": setTool("insert"); break;
      case "d": case "D": setTool("delete"); break;
      case "h": if (strand(selId)) setVisible(strand(selId), false); break;
      case "H": showAll(true); break;
      case "[": stepVertex(-1); break;
      case "]": stepVertex(1); break;
      case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown":
        if (selV === null || strand(selId) === undefined) break;
        ev.preventDefault();
        { const k = ev.shiftKey ? 5 : 1;
          nudge(ev.key === "ArrowLeft" ? -k : ev.key === "ArrowRight" ? k : 0,
                ev.key === "ArrowDown" ? -k : ev.key === "ArrowUp" ? k : 0); }
        break;
      case "1": setBackground("elev"); break;
      case "2": setBackground("hs"); break;
      case "3": setBackground("tex"); break;
      case "4": setBackground("scarp"); break;
      case "f": case "F": fitElevation(); break;
      case "?": $("help").hidden = !$("help").hidden; break;
      case "Enter": finishDrawing(); break;
      case "Escape":
        if (!$("help").hidden) { $("help").hidden = true; break; }
        if (drawing !== null) finishDrawing();
        else if (selV !== null) { selV = null; renderAll(); }
        else if (mode === "profile") setMode("pan");     // leaving Profile mode closes its panel
        else { select(null); renderAll(); }
        break;
      case "Backspace": case "Delete":
        if (drawing !== null) {            // remove the last added point while drawing
          const s = strand(drawing); if (!s) break;
          const b = snap(); if (drawAtStart) s.coords.shift(); else s.coords.pop(); commit(b);
        } else if (selId !== null && selV !== null) deleteVertex(strand(selId), selV);
        else if (selId !== null) deleteSelected();
        ev.preventDefault();
        break;
    }
  });

  if (!state.strands.length) $("help").hidden = false;
  renderAll();
})().catch((e) => {
  document.body.insertAdjacentHTML("afterbegin",
    `<div style="padding:12px;background:#fee;color:#900">Could not start: ${e.message}. ` +
    `Open the tracer with start_tracer.command (it needs a local web server), not by double-clicking index.html.</div>`);
});
