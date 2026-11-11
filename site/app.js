/* Baron's Library — an interactive book constellation.
   Canvas + d3-force. Data comes from data.json (built by scripts/build_graph.py). */
(() => {
"use strict";
const $ = (s) => document.querySelector(s);
const canvas = $("#stage"), ctx = canvas.getContext("2d");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (t) => { const c = 1.70158; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

/* ---------- state ---------- */
let W = 0, H = 0, DPR = 1, T = d3.zoomIdentity;
let data, nodes = [], links = [], byId = new Map(), adj = new Map(), genreNodes = new Map();
let vNodes = [], vLinks = [], drawOrder = [];
let mode = "constellation", showRecs = true, alwaysLabels = false;
let hover = null, selected = null, focusGenre = null, searchSet = null, press = null;
let sim, zoom, timeline = null, C = {}, stars = [];
const imgs = new Map();
const UNCAT = "#9aa5c0";
const isItem = (n) => n.kind === "book" || n.kind === "rec" || n.kind === "queue";
let recLimit = 999, showQueue = true, atlasImg = null, atlasReady = false, A = null, fullLoading = 0;
const NOIMG = { ok: false };

/* ---------- theme ---------- */
function readColors() {
  const s = getComputedStyle(document.documentElement), g = (k) => s.getPropertyValue(k).trim();
  C = { bg0: g("--bg0"), bg1: g("--bg1"), ink: g("--ink"), muted: g("--muted"), edge: g("--edge"), halo: g("--halo"), light: document.documentElement.dataset.theme === "light" };
}
function setTheme(t) {
  document.documentElement.dataset.theme = t; store.set("theme", t);
  document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#f7f2e8" : "#070a14";
  readColors();
}
setTheme(store.get("theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));

/* ---------- color helpers ---------- */
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function shade(hex, f) { // f<0 darken, f>0 lighten
  const n = parseInt(hex.slice(1), 16), c = (v) => Math.round(clamp(f < 0 ? v * (1 + f) : v + (255 - v) * f, 0, 255));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/* ---------- boot ---------- */
fetch("data.json", { cache: "no-cache" }).then((r) => r.json()).then(init).catch((e) => {
  $("#loader p").textContent = "Couldn't load data.json — " + e.message;
});

function loadAtlas(a) {
  A = a;
  if (!a) return Promise.resolve();
  return new Promise((res) => { atlasImg = new Image(); atlasImg.onload = () => { atlasReady = true; res(); }; atlasImg.onerror = res; atlasImg.src = a.src; });
}

function init(d) {
  data = d;
  if (window.LibraryEdits) { try { window.LibraryEdits.apply(d); } catch (e) { console.warn("edits not applied", e); } }
  const atlasP = loadAtlas(d.atlas);
  build();
  resize();
  initStars();
  setupSim();
  setupZoom();
  bindUI();
  renderLegend();
  renderPanel();
  $("#brand-sub").textContent = `${d.meta.read} read · ${d.meta.queued || 0} queued · ${d.meta.recommended} recommended` + (d.meta.sample ? " · sample data" : "");
  applyLayout(1, true);
  sim.tick(160);
  fitView(vNodes, false);
  const hashed = decodeURIComponent(location.hash.slice(1));
  if (hashed && byId.has(hashed)) select(byId.get(hashed), true);
  const ready = Promise.race([atlasP, new Promise((r) => setTimeout(r, 1200))]);
  ready.then(() => { $("#loader").classList.add("done"); const t0 = performance.now();
    const order = [...vNodes].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    order.forEach((n, i) => { n.born = reduce ? 0 : t0 + 120 + (i / order.length) * 800; }); });
  requestAnimationFrame(frame);
}

/* ---------- graph model ---------- */
function build() {
  const gmap = new Map(data.genres.map((g) => [g.id, g]));
  const add = (n) => { n.a = 1; n.s = 1; n.born = 0; n.vis = false; n.x = (Math.random() - .5) * 60; n.y = (Math.random() - .5) * 60; nodes.push(n); byId.set(n.id, n); return n; };
  add({ id: "root", kind: "root", name: "Baron's Library", color: "#ffd43b", rad: 34, gset: new Set() });
  for (const g of data.genres.filter((g) => !g.parent)) genreNodes.set(g.id, add({ id: "g:" + g.id, gid: g.id, kind: "macro", name: g.name, color: g.color, rad: 26, count: g.count, gset: new Set() }));
  for (const g of data.genres.filter((g) => g.parent)) genreNodes.set(g.id, add({ id: "g:" + g.id, gid: g.id, kind: "sub", name: g.name, color: g.color, parentG: g.parent, rad: 15, count: g.count, gset: new Set() }));

  const sMin = d3.min(data.recs, (r) => r.score) ?? 0, sMax = d3.max(data.recs, (r) => r.score) ?? 1;
  const qs = (data.queue || []).filter((q) => q.score != null), qMin = d3.min(qs, (q) => q.score) ?? 0, qMax = d3.max(qs, (q) => q.score) ?? 1;
  const qt = (q) => (q.score == null ? 0 : (q.score - qMin) / ((qMax - qMin) || 1));
  const item = (b, kind) => {
    const gs = b.genres || [], primary = gs[0], macro = primary ? gmap.get(primary)?.parent : null;
    return add({ ...b, kind, name: b.title, genreIds: gs, macroId: macro, color: macro ? gmap.get(macro).color : UNCAT,
      rad: kind === "rec" ? 25 : 27, tt: kind === "rec" ? (b.score - sMin) / ((sMax - sMin) || 1) : kind === "queue" ? qt(b) : 0, sc: kind === "rec" ? 0.86 + 0.26 * ((b.score - sMin) / ((sMax - sMin) || 1)) : kind === "queue" ? 0.9 + 0.1 * qt(b) : 0.88 + 0.07 * (b.rating || 3),
      gset: new Set([...gs, ...gs.map((g) => gmap.get(g)?.parent).filter(Boolean)]), yr: yearOf(b) });
  };
  data.books.forEach((b) => item(b, "book"));
  data.recs.forEach((r) => item(r, "rec"));
  (data.queue || []).forEach((q) => item(q, "queue"));

  const root = byId.get("root"), L = (s, t, type, extra) => links.push({ s, t, type, ...extra });
  genreNodes.forEach((g) => { if (g.kind === "macro") L(root, g, "tree"); else L(genreNodes.get(g.parentG), g, "tree"); });
  for (const n of nodes) {
    if (!isItem(n)) continue;
    if (!n.genreIds.length) L(root, n, "genre", { primary: true });
    n.genreIds.forEach((g, i) => L(genreNodes.get(g), n, "genre", { primary: i === 0 }));
  }
  const series = d3.group(nodes.filter((n) => (n.kind === "book" || n.kind === "queue") && n.series), (n) => n.series);
  series.forEach((arr) => { arr.sort((a, b) => (a.seriesNo ?? 99) - (b.seriesNo ?? 99)); for (let i = 1; i < arr.length; i++) L(arr[i - 1], arr[i], "series"); });
  for (const r of nodes.filter((n) => n.kind === "rec")) for (const id of r.because || []) if (byId.has(id)) L(byId.get(id), r, "rec");

  for (const l of links) { for (const [a, b] of [[l.s, l.t], [l.t, l.s]]) { if (!adj.has(a.id)) adj.set(a.id, new Set()); adj.get(a.id).add(b.id); } }
  // covers
  // genre membership for hover/filter
  for (const n of nodes) if (n.gset.size && (isItem(n))) n.gset.forEach((g) => genreNodes.get(g)?.gset.add(n.id));
}
function yearOf(b) {
  if (b.year) return b.year;
  const y = parseInt((b.dateRead || "").slice(0, 4)); return y || null;
}

/* ---------- visibility + layout ---------- */
function visibleGraph() {
  let ns = nodes.filter((n) => (showRecs || n.kind !== "rec") && (n.kind !== "rec" || n.rank <= recLimit) && (showQueue || n.kind !== "queue"));
  if (mode === "timeline") ns = ns.filter((n) => isItem(n));
  if (mode === "clusters") ns = ns.filter((n) => n.kind !== "root");
  let set = new Set(ns.map((n) => n.id));
  let ls = links.filter((l) => set.has(l.s.id) && set.has(l.t.id));
  if (mode === "timeline") ls = ls.filter((l) => l.type === "series" || l.type === "rec");
  if (mode === "clusters") ls = ls.filter((l) => !(l.type === "tree" && l.s.kind === "root"));
  if (mode !== "timeline") { // drop genre nodes that no longer lead anywhere
    const used = new Set(); ls.forEach((l) => { if (l.type === "genre") used.add(l.s.id); });
    ns = ns.filter((n) => n.kind !== "sub" || used.has(n.id));
    const usedSubs = new Set(ns.filter((n) => n.kind === "sub").map((n) => n.parentG));
    ns = ns.filter((n) => n.kind !== "macro" || usedSubs.has(n.gid) || [...used].includes(n.id));
    set = new Set(ns.map((n) => n.id)); ls = ls.filter((l) => set.has(l.s.id) && set.has(l.t.id));
  }
  return { ns, ls };
}

function setupSim() {
  sim = d3.forceSimulation().alphaDecay(0.025).velocityDecay(0.38).on("tick", () => {});
}
function applyLayout(alpha = 0.9, instant = false) {
  const { ns, ls } = visibleGraph();
  const now = performance.now();
  const prev = new Set(vNodes.map((n) => n.id));
  ns.forEach((n) => { if (!prev.has(n.id) && !instant) { n.born = reduce ? 0 : now + Math.random() * 260; } });
  vNodes = ns; vLinks = ls;
  const rank = { root: 0, macro: 1, sub: 2, book: 3, queue: 4, rec: 5 };
  drawOrder = [...ns].sort((a, b) => rank[a.kind] - rank[b.kind]);

  const m = nodes.filter((n) => n.kind === "macro" && ns.includes(n));
  const cl = mode === "clusters", tl = mode === "timeline";
  const L = ls.map((l) => ({ source: l.s, target: l.t, type: l.type, primary: l.primary }));
  const dist = (l) => l.type === "tree" ? (l.source.kind === "root" ? (cl ? 175 : 300) : cl ? 125 : 170) : l.type === "genre" ? (l.primary ? (cl ? 95 : 70) : 150) : l.type === "series" ? 48 : 125;
  const str = (l) => tl ? (l.type === "series" ? 0.04 : 0) : l.type === "tree" ? (cl ? 0.85 : 0.35) : l.type === "genre" ? (l.primary ? (cl ? 0.9 : 0.55) : cl ? 0.04 : 0.07) : l.type === "series" ? 0.5 : 0.07;
  sim.nodes(ns).force("link", d3.forceLink(L).distance(dist).strength(str))
    .force("charge", d3.forceManyBody().strength((n) => tl ? -20 : n.kind === "root" ? -1100 : n.kind === "macro" ? -800 : n.kind === "sub" ? (cl ? -520 : -300) : cl ? -150 : -110).distanceMax(520))
    .force("collide", d3.forceCollide((n) => n.rad * (n.sc || 1) + (tl ? 4 : n.kind === "sub" ? 26 : n.kind === "macro" ? 22 : 8)).iterations(2).strength(0.9));

  let fx = null, fy = null;
  if (cl) {
    const R = Math.max(300, 135 * m.length), anchor = new Map(m.map((g, i) => { const a = -Math.PI / 2 + (i / m.length) * Math.PI * 2; return [g.gid, [Math.cos(a) * R, Math.sin(a) * R]]; }));
    const at = (n) => anchor.get(n.kind === "macro" ? n.gid : n.kind === "sub" ? n.parentG : n.macroId) || [0, 0];
    fx = d3.forceX((n) => at(n)[0]).strength((n) => n.kind === "macro" ? 0.5 : n.kind === "sub" ? 0.03 : 0.04);
    fy = d3.forceY((n) => at(n)[1]).strength((n) => n.kind === "macro" ? 0.5 : n.kind === "sub" ? 0.03 : 0.04);
  } else if (tl) {
    const ys = ns.map((n) => n.yr).filter(Boolean), med = d3.median(ys) || 2000;
    const lo = Math.max(d3.min(ys) ?? 1990, 1880), hi = d3.max(ys) ?? 2024,  // older works (e.g. Marcus Aurelius) pin to the left edge
      halfW = clamp(ns.length * 7, 700, 1700);
    // history is squeezed, the recent decades (where most reading happens) get the room
    const cuts = [lo, 1950, 1980, 2000, Math.max(hi, 2001)].filter((v, i, a) => i === 0 || v > a[i - 1]);
    const share = [0, 0.1, 0.2, 0.5, 1].slice(0, cuts.length - 1).concat(1);
    const xs = d3.scaleLinear(cuts, share.map((f) => -halfW + f * halfW * 2)).clamp(true);
    const macros = data.genres.filter((g) => !g.parent);
    const cnt = (m) => ns.filter((n) => n.macroId === m.id).length;
    let acc = 0; const lanes = macros.map((g) => { const h = Math.max(200, cnt(g) * 3.2); const l = { g, y0: acc, h, cy: acc + h / 2 }; acc += h; return l; });
    const off = acc / 2; lanes.forEach((l) => { l.y0 -= off; l.cy -= off; });
    const laneOf = (n) => Math.max(0, macros.findIndex((g) => g.id === n.macroId));
    timeline = { xs, lo, hi, lanes, halfW, top: lanes[0].y0, bot: lanes.at(-1).y0 + lanes.at(-1).h };
    fx = d3.forceX((n) => xs(n.yr || med)).strength(0.55);
    fy = d3.forceY((n) => lanes[laneOf(n)].cy).strength(0.16);
  } else {
    // mind map: genres fan out around the root, sub-genres further out, books gather around their sub-genre
    const mac = nodes.filter((n) => n.kind === "macro" && ns.includes(n)).sort((a, b) => b.count - a.count);
    const pos = new Map(mac.map((g, i) => { const a = -Math.PI / 2 + ((i + 0.5) / mac.length) * Math.PI * 2 + 0.35, r = 300 + 34 * Math.sqrt(g.count); return [g.gid, [Math.cos(a) * r, Math.sin(a) * r]]; }));
    const at = (n) => { const p = pos.get(n.kind === "macro" ? n.gid : n.parentG) || [0, 0], k = n.kind === "sub" ? 1.45 : 1; return [p[0] * k, p[1] * k]; };
    fx = d3.forceX((n) => (n.kind === "macro" || n.kind === "sub" ? at(n)[0] : 0)).strength((n) => n.kind === "macro" ? 0.3 : n.kind === "sub" ? 0.05 : 0.004);
    fy = d3.forceY((n) => (n.kind === "macro" || n.kind === "sub" ? at(n)[1] : 0)).strength((n) => n.kind === "macro" ? 0.3 : n.kind === "sub" ? 0.05 : 0.004);
  }
  sim.force("x", fx).force("y", fy);
  const root = byId.get("root"); root.fx = mode === "constellation" ? 0 : null; root.fy = mode === "constellation" ? 0 : null;
  if (mode === "timeline") timeline = timeline; else timeline = null;
  sim.alpha(alpha).restart();
}

function setMode(m) {
  if (m === mode) return;
  mode = m;
  document.querySelectorAll(".modes button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  applyLayout(1);
  setTimeout(() => fitView(focusedItems() || vNodes), reduce ? 0 : 1400);
}

/* ---------- camera ---------- */
function panelOffset() { return W > 900 ? 346 : 0; }
function fitView(list, animate = true, maxK = 1.5) {
  const ns = list.filter((n) => n.x != null);
  if (!ns.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of ns) { const r = n.rad * (n.sc || 1) + 30; x0 = Math.min(x0, n.x - r); x1 = Math.max(x1, n.x + r); y0 = Math.min(y0, n.y - r); y1 = Math.max(y1, n.y + r); }
  const aw = W - panelOffset() - (W > 900 ? 260 : 0), ah = H - 180;
  const k = clamp(Math.min(aw / (x1 - x0), ah / (y1 - y0)), 0.15, maxK);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ox = W > 900 ? 260 : 0;
  moveTo(d3.zoomIdentity.translate(ox + aw / 2 - cx * k, 96 + ah / 2 - cy * k).scale(k), animate);
}
function moveTo(t, animate = true) {
  const sel = d3.select(canvas);
  if (!animate || reduce) sel.call(zoom.transform, t);
  else sel.transition().duration(900).ease(d3.easeCubicInOut).call(zoom.transform, t);
}
function flyTo(n, k) {
  k = k ?? Math.max(T.k, 1.5);
  const aw = W - panelOffset();
  moveTo(d3.zoomIdentity.translate(aw / 2 - n.x * k, (H - 60) / 2 - n.y * k).scale(k));
}
function setupZoom() {
  zoom = d3.zoom().scaleExtent([0.12, 7]).filter((e) => {
    if (e.type === "wheel") return true;
    if (e.ctrlKey || e.button) return false;
    const p = d3.pointer(e.touches ? e.touches[0] : e, canvas);
    return !pick(p[0], p[1]);
  }).on("zoom", (e) => { T = e.transform; });
  d3.select(canvas).call(zoom).on("dblclick.zoom", null);
}

/* ---------- hit testing ---------- */
function visibleFor(n) { return matchesFilter(n); }
function pick(sx, sy) {
  const [x, y] = T.invert([sx, sy]);
  for (let i = drawOrder.length - 1; i >= 0; i--) {
    const n = drawOrder[i];
    if (n.a < 0.2 || !visibleFor(n) || performance.now() < n.born) continue;
    const s = n.s * bornScale(n, performance.now());
    if (isItem(n)) {
      const hw = 16 * n.sc * s, hh = 24 * n.sc * s;
      if (Math.abs(x - n.x) <= hw + 2 && Math.abs(y - n.y) <= hh + 2) return n;
    } else if (Math.hypot(x - n.x, y - n.y) <= n.rad * s) return n;
  }
  return null;
}
function bornScale(n, t) { const p = clamp((t - n.born) / 650, 0, 1); return p <= 0 ? 0 : easeOutBack(p); }

/* ---------- filter / highlight ---------- */
function matchesFilter(n) {
  if (!focusGenre) return true;
  if (n.kind === "root") return true;
  const f = genreNodes.get(focusGenre);
  if (n.kind === "macro") return n.gid === focusGenre || f.parentG === n.gid;
  if (n.kind === "sub") return n.gid === focusGenre || n.parentG === focusGenre;
  return n.gset.has(focusGenre);
}
function focusedItems() { return focusGenre ? vNodes.filter((n) => matchesFilter(n) && n.kind !== "root") : null; }
function targetAlpha(n) {
  if (!matchesFilter(n)) return 0.06;
  if (searchSet) return searchSet.has(n.id) ? 1 : n.kind === "root" ? 0.5 : 0.1;
  const act = hover || selected;
  if (!act) return 1;
  if (n === act || adj.get(act.id)?.has(n.id)) return 1;
  if ((act.kind === "macro" || act.kind === "sub") && n.gset?.has(act.gid)) return 1;
  if ((n.kind === "macro" || n.kind === "sub") && (isItem(act)) && act.gset.has(n.gid)) return 1;
  return 0.12;
}

/* ---------- rendering ---------- */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
}
addEventListener("resize", () => { resize(); renderPanelVisibility(); });

function initStars() {
  const rnd = d3.randomLcg(7);
  stars = d3.range(260).map(() => ({ x: rnd(), y: rnd(), z: 0.15 + rnd() * 0.85, r: 0.4 + rnd() * 1.3, p: rnd() * 6.28 }));
}
function drawBackground(t) {
  const g = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.8);
  g.addColorStop(0, C.bg1); g.addColorStop(1, C.bg0);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // drifting nebulae tinted by the genres
  const gs = data.genres.filter((x) => !x.parent).slice(0, 4);
  gs.forEach((ge, i) => {
    const a = t * 0.00004 * (i + 1) + i * 1.7, px = W * (0.5 + 0.38 * Math.cos(a)) + T.x * 0.05, py = H * (0.5 + 0.34 * Math.sin(a * 1.3)) + T.y * 0.05, r = Math.max(W, H) * 0.42;
    const ng = ctx.createRadialGradient(px, py, 0, px, py, r);
    ng.addColorStop(0, rgba(ge.color, C.light ? 0.1 : 0.085)); ng.addColorStop(1, rgba(ge.color, 0));
    ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H);
  });
  for (const s of stars) {
    const x = (((s.x * W * 1.3 + T.x * s.z * 0.12) % (W * 1.3)) + W * 1.3) % (W * 1.3) - W * 0.15;
    const y = (((s.y * H * 1.3 + T.y * s.z * 0.12) % (H * 1.3)) + H * 1.3) % (H * 1.3) - H * 0.15;
    const tw = reduce ? 0.7 : 0.55 + 0.45 * Math.sin(t * 0.0015 * s.z + s.p);
    ctx.fillStyle = C.light ? `rgba(60,70,100,${0.16 * s.z * tw})` : `rgba(220,230,255,${0.75 * s.z * tw})`;
    ctx.beginPath(); ctx.arc(x, y, s.r * s.z + 0.2, 0, 6.283); ctx.fill();
  }
}

function drawTimeline() {
  if (!timeline) return;
  const { xs, lo, hi, lanes, halfW, top, bot } = timeline, k = T.k;
  ctx.save();
  for (const { g, y0, h } of lanes) {
    ctx.fillStyle = rgba(g.color, C.light ? 0.07 : 0.05);
    ctx.fillRect(-halfW - 160, y0 + 6, halfW * 2 + 320, h - 12);
    ctx.fillStyle = rgba(g.color, 0.9); ctx.font = `600 ${15 / k}px Fraunces, Georgia, serif`; ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(g.name, -halfW - 140, y0 + 16);
  }
  const ticks = [...d3.range(Math.ceil(lo / 10) * 10, 2000, 10), ...d3.range(2000, hi + 1, k > 0.5 ? 2 : 5)];
  ctx.lineWidth = 1 / k; ctx.textAlign = "center"; ctx.font = `500 ${11 / k}px Inter, sans-serif`; ctx.textBaseline = "bottom";
  let lastX = -Infinity;
  for (const y of ticks) {
    const major = y % 10 === 0, x = xs(y);
    ctx.strokeStyle = `rgba(${C.edge},${major ? 0.16 : 0.07})`; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
    if ((x - lastX) * k >= 40) { ctx.fillStyle = C.muted; ctx.fillText(String(y), x, top - 4 / k); lastX = x; } // skip labels that would overlap
  }
  ctx.restore();
}

function curve(l, off) {
  const a = l.s, b = l.t, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
  return [mx - dy * off, my + dx * off];
}
function drawLinks(t) {
  const k = T.k, act = hover || selected;
  vLinks.forEach((l, i) => {
    const a = Math.min(l.s.a, l.t.a) * Math.min(bornScale(l.s, t), bornScale(l.t, t), 1);
    if (a < 0.02) return;
    const off = l.type === "series" ? 0.12 : l.type === "rec" ? ((i % 2) ? 0.16 : -0.16) : 0.07 * (i % 2 ? 1 : -1);
    const [cx, cy] = curve(l, off);
    const col = l.type === "tree" ? l.t.color : l.t.kind === "rec" ? l.t.color : l.s.color === "#ffd43b" ? l.t.color : l.s.color;
    const hot = act && (l.s === act || l.t === act);
    const isRec = l.type === "rec", tt = isRec ? l.t.tt : 0, express = isRec && l.t.rank <= 10;
    const path = () => { ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.quadraticCurveTo(cx, cy, l.t.x, l.t.y); };
    if (express) { // express lane: a soft wide glow under the line
      path(); ctx.setLineDash([]); ctx.strokeStyle = rgba(col, (0.08 + 0.12 * tt) * a * (hot ? 2 : 1)); ctx.lineWidth = Math.max(8 + 6 * tt, 2 / k); ctx.stroke();
    }
    path();
    if (isRec) {
      const d = (5 + 7 * (1 - tt)) / k ** 0.3;
      ctx.setLineDash([d, d]); ctx.lineDashOffset = reduce ? 0 : -t * (0.008 + 0.034 * tt * tt);
      ctx.strokeStyle = rgba(col, Math.min(1, 0.26 + 0.6 * tt + (hot ? 0.25 : 0)) * a); ctx.lineWidth = Math.max(1.1 + 1.9 * tt + (hot ? 0.8 : 0), 1 / k);
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = l.type === "tree" ? rgba(col, 0.42 * a) : l.type === "series" ? rgba(col, (hot ? 0.95 : 0.6) * a) : rgba(col, (l.primary ? 0.34 : 0.15) * a * (hot ? 2.2 : 1));
      ctx.lineWidth = Math.max(l.type === "tree" ? 2.6 : l.type === "series" ? 2 : 1.2, 1 / k);
    }
    ctx.stroke(); ctx.setLineDash([]);
    if (isRec && !reduce && a > 0.3) { // sparks travel from the book you read to the recommendation: better picks get more, faster ones
      const n = 1 + Math.round(tt * 3), speed = 0.00007 + 0.00046 * tt * tt, r = (2.1 + 2.2 * tt) / Math.sqrt(k);
      const at = (u) => { const q = 1 - u; return [q * q * l.s.x + 2 * q * u * cx + u * u * l.t.x, q * q * l.s.y + 2 * q * u * cy + u * u * l.t.y]; };
      for (let j = 0; j < n; j++) {
        const u = (t * speed + j / n + i * 0.13) % 1;
        if (express) for (let m = 5; m >= 1; m--) { // comet trail
          const [tx, ty] = at(Math.max(0, u - m * 0.014)); ctx.fillStyle = rgba(col, 0.5 * (1 - m / 6) * a); ctx.beginPath(); ctx.arc(tx, ty, r * (1 - m * 0.12), 0, 6.283); ctx.fill();
        }
        const [x, y] = at(u); ctx.fillStyle = rgba(col, 0.95 * a); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
        if (express) { ctx.fillStyle = rgba("#ffffff", 0.7 * a); ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, 6.283); ctx.fill(); }
      }
    }
  });
}

function haloText(txt, x, y, size, weight, color, family, align = "center", baseline = "top") {
  ctx.font = `${weight} ${size}px ${family}`; ctx.textAlign = align; ctx.textBaseline = baseline;
  ctx.lineJoin = "round"; ctx.lineWidth = size * 0.28; ctx.strokeStyle = `rgba(${C.halo},.85)`; ctx.strokeText(txt, x, y);
  ctx.fillStyle = color; ctx.fillText(txt, x, y);
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function drawGenre(n, t, s) {
  const r = n.rad * s, k = T.k, lit = n === (hover || selected) || n.gid === focusGenre;
  const g = ctx.createRadialGradient(n.x, n.y, r * 0.2, n.x, n.y, r * (lit ? 3.4 : 2.6));
  g.addColorStop(0, rgba(n.color, (lit ? 0.6 : 0.4) * n.a)); g.addColorStop(1, rgba(n.color, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, r * 3.4, 0, 6.283); ctx.fill();
  const body = ctx.createRadialGradient(n.x - r * 0.3, n.y - r * 0.35, r * 0.1, n.x, n.y, r);
  body.addColorStop(0, shade(n.color, 0.55)); body.addColorStop(1, shade(n.color, n.kind === "root" ? -0.1 : -0.35));
  ctx.globalAlpha = n.a; ctx.fillStyle = body; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.283); ctx.fill();
  ctx.lineWidth = 1.5 / k ** 0.5; ctx.strokeStyle = rgba("#ffffff", 0.45); ctx.stroke();
  if (n.kind === "root") { // orbiting ring
    ctx.strokeStyle = rgba(n.color, 0.5 * n.a); ctx.setLineDash([3, 7]); ctx.lineDashOffset = -t * 0.01; ctx.beginPath(); ctx.arc(n.x, n.y, r * 1.35, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}
function drawGenreLabel(n, s) {
  const k = T.k, r = n.rad * s, size = (n.kind === "sub" ? 12 : n.kind === "macro" ? 15 : 17) / Math.max(k, 0.55) ** 0.85;
  ctx.globalAlpha = Math.max(n.a, 0.25);
  haloText(n.name, n.x, n.y + r + 5 / k ** 0.6, size, n.kind === "sub" ? 500 : 600, C.ink, n.kind === "sub" ? "Inter, sans-serif" : "Fraunces, Georgia, serif");
  ctx.globalAlpha = 1;
}

function fullImg(n) {
  let im = imgs.get(n.id);
  if (!im) {
    if (fullLoading >= 6) return NOIMG;
    im = new Image(); im.decoding = "async"; fullLoading++;
    im.onload = () => { im.ok = true; fullLoading--; }; im.onerror = () => fullLoading--;
    im.src = n.cover; imgs.set(n.id, im);
  }
  return im;
}
function cover(n, x, y, w, h) {
  if (n.cover && (w * T.k >= 70 || !n.atlas)) { const im = fullImg(n); if (im.ok) { ctx.drawImage(im, x, y, w, h); return; } }
  if (atlasReady && n.atlas) { ctx.drawImage(atlasImg, n.atlas[0], n.atlas[1], A.cw, A.ch, x, y, w, h); return; }
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, shade(n.color, -0.1)); g.addColorStop(1, shade(n.color, -0.6));
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  if (w * T.k > 14) { ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.font = `700 ${w * 0.3}px Fraunces, Georgia, serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(n.title.split(/\s+/).slice(0, 2).map((w) => w[0]).join(""), x + w / 2, y + h / 2); }
}
function rankBadge(n, x, y, w, h) { // top-10 picks wear a numbered medal
  const medal = n.rank === 1 ? "#ffd43b" : n.rank === 2 ? "#dfe3ee" : n.rank === 3 ? "#e8a46b" : null, r = n.rank <= 3 ? 9.5 : 8, bx = x, by = y + h;
  ctx.beginPath(); ctx.arc(bx, by, r, 0, 6.283); ctx.fillStyle = medal || (C.light ? "#1c2334" : "#0e1426"); ctx.fill();
  ctx.lineWidth = 1.6; ctx.strokeStyle = medal || n.color; ctx.stroke();
  ctx.fillStyle = medal ? "#1a1400" : "#ffffff"; ctx.font = `800 ${n.rank > 9 ? 8 : 9.5}px Inter, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(n.rank), bx, by + 0.5);
}

function drawBook(n, t, s) {
  const isRec = n.kind === "rec", isQ = n.kind === "queue", reading = isQ && n.shelf === "reading";
  const w = 32 * n.sc * s, h = 48 * n.sc * s, x = n.x - w / 2, y = n.y - h / 2, k = T.k;
  const sx = n.x * k + T.x, sy = n.y * k + T.y, mg = h * k + 70;
  if (sx < -mg || sx > W + mg || sy < -mg || sy > H + mg) return; // off-screen: skip
  const lit = n === (hover || selected);
  if (w * k < 9) { // far away: a plain star
    ctx.globalAlpha = n.a; ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(n.x, n.y, 5.5 * n.sc * s, 0, 6.283); ctx.fill();
    if (isRec || isQ) { ctx.setLineDash(isRec ? [2, 2] : [1, 2]); ctx.strokeStyle = reading ? "#ffd43b" : n.color; ctx.lineWidth = 1 / k; ctx.beginPath(); ctx.arc(n.x, n.y, 9 * s, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }
    ctx.globalAlpha = 1; return;
  }
  const pulse = (isRec || reading) && !reduce ? 0.5 + 0.5 * Math.sin(t * 0.003 + n.x) : 0.5;
  const gr = h * (lit ? 1.5 : 1.15 + 0.2 * n.tt * (isRec ? 1 : 0)) + (isRec ? pulse * (4 + 8 * n.tt) : reading ? pulse * 6 : 0);
  const g = ctx.createRadialGradient(n.x, n.y, h * 0.2, n.x, n.y, gr);
  g.addColorStop(0, reading ? rgba("#ffd43b", (0.3 + pulse * 0.2) * n.a) : rgba(n.color, (lit ? 0.55 : isRec ? 0.13 + 0.22 * n.tt + pulse * (0.07 + 0.15 * n.tt) : isQ ? 0.1 + 0.12 * n.tt : 0.26) * n.a)); g.addColorStop(1, rgba(n.color, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, gr, 0, 6.283); ctx.fill();

  ctx.globalAlpha = n.a * (isRec ? 0.93 : isQ && !reading ? 0.9 : 1);
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, 3 * s); ctx.clip();
  cover(n, x, y, w, h);
  if (isRec) { ctx.fillStyle = rgba(C.light ? "#ffffff" : "#0b1020", 0.12); ctx.fillRect(x, y, w, h); }
  const sh = ctx.createLinearGradient(x, y, x + w, y); sh.addColorStop(0, "rgba(255,255,255,.22)"); sh.addColorStop(0.08, "rgba(0,0,0,.18)"); sh.addColorStop(0.16, "rgba(255,255,255,0)"); // spine highlight
  ctx.fillStyle = sh; ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 3 * s);
  if (isRec) { ctx.setLineDash([5, 4]); ctx.lineDashOffset = reduce ? 0 : -t * (0.008 + 0.03 * n.tt); ctx.strokeStyle = rgba(n.color, 0.7 + pulse * 0.3); ctx.lineWidth = 2 + 0.9 * n.tt; }
  else if (isQ && !reading) { ctx.setLineDash([1.5, 4]); ctx.lineCap = "round"; ctx.strokeStyle = lit ? "#ffffff" : n.color; ctx.lineWidth = 2.6; }
  else if (reading) { ctx.strokeStyle = "#ffd43b"; ctx.lineWidth = 2.8; }
  else { ctx.strokeStyle = lit ? "#ffffff" : n.color; ctx.lineWidth = lit ? 2.6 : 2; }
  ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = "butt";
  if (reading) { // marching outer ring
    ctx.beginPath(); ctx.roundRect(x - 5, y - 5, w + 10, h + 10, 6); ctx.setLineDash([9, 7]); ctx.lineDashOffset = reduce ? 0 : -t * 0.03;
    ctx.strokeStyle = rgba("#ffd43b", 0.85); ctx.lineWidth = 1.8; ctx.stroke(); ctx.setLineDash([]);
  }
  if (isRec) { // sparkle badge
    ctx.fillStyle = "#ffd43b"; ctx.beginPath(); const bx = x + w, by = y, br = 6.5;
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, rr = i % 2 ? br * 0.42 : br; ctx.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
    if (n.rank <= 10 && k > 0.45) rankBadge(n, x, y, w, h);
  } else if (isQ && !reading) { // bookmark ribbon
    if (n.rank <= 5 && k > 0.45) rankBadge(n, x, y, w, h);
    const bx = x + w - 11, by = y - 3;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 9, by); ctx.lineTo(bx + 9, by + 14); ctx.lineTo(bx + 4.5, by + 10); ctx.lineTo(bx, by + 14); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = n.color; ctx.stroke();
  } else if (reading) { // play badge
    const bx = x + w, by = y; ctx.fillStyle = "#ffd43b"; ctx.beginPath(); ctx.arc(bx, by, 8, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#1a1400"; ctx.beginPath(); ctx.moveTo(bx - 2.5, by - 4); ctx.lineTo(bx + 4.5, by); ctx.lineTo(bx - 2.5, by + 4); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const near = adj.get((hover || selected)?.id)?.has(n.id);
  if ((alwaysLabels && k > 0.7 && n.a > 0.5) || lit || (near && n.a > 0.6) || (searchSet?.has(n.id) && k > 0.5) || (reading && k > 0.6))
    haloText(trunc(n.title, 28), n.x, y + h + 5 / k ** 0.7, 12 / Math.max(k, 0.6) ** 0.85, 600, C.ink, "Inter, sans-serif");
}

function frame(t) {
  requestAnimationFrame(frame);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawBackground(t);
  ctx.save(); ctx.translate(T.x, T.y); ctx.scale(T.k, T.k);
  drawTimeline();
  for (const n of vNodes) {
    n.a = lerp(n.a, targetAlpha(n), 0.14);
    const ts = n === selected ? 1.28 : n === hover ? 1.2 : 1; n.s = lerp(n.s, ts, 0.2);
  }
  drawLinks(t);
  const top = [];
  for (const n of drawOrder) {
    const bs = bornScale(n, t); if (bs <= 0) continue;
    if (n === hover || n === selected) { top.push([n, bs]); continue; }
    isItem(n) ? drawBook(n, t, n.s * bs) : drawGenre(n, t, n.s * bs);
  }
  for (const n of drawOrder) { const bs = bornScale(n, t); if (bs > 0 && !isItem(n)) drawGenreLabel(n, n.s * bs); }
  for (const [n, bs] of top) isItem(n) ? drawBook(n, t, n.s * bs) : drawGenre(n, t, n.s * bs);
  if (selected && matchesFilter(selected)) { // selection beacon
    const s = selected, r = (isItem(s) ? 38 : s.rad + 14) * s.s * (s.sc || 1), p = (t % 1800) / 1800;
    ctx.strokeStyle = rgba(s.color, 0.6 * (1 - p)); ctx.lineWidth = 2 / T.k; ctx.beginPath(); ctx.arc(s.x, s.y, r + p * 26, 0, 6.283); ctx.stroke();
  }
  ctx.restore();
}

/* ---------- pointer interaction ---------- */
const tip = $("#tip");
canvas.addEventListener("pointerdown", (e) => {
  const [x, y] = d3.pointer(e, canvas), n = pick(x, y);
  press = { x, y, n, moved: false, id: e.pointerId };
  if (n) { canvas.setPointerCapture(e.pointerId); canvas.classList.add("drag"); const [wx, wy] = T.invert([x, y]); press.ox = n.x - wx; press.oy = n.y - wy; n.fx = n.x; n.fy = n.y; sim.alphaTarget(0.25).restart(); hideTip(); }
});
canvas.addEventListener("pointermove", (e) => {
  const [x, y] = d3.pointer(e, canvas);
  if (press) {
    if (Math.hypot(x - press.x, y - press.y) > 4) press.moved = true;
    if (press.n && press.moved) { const [wx, wy] = T.invert([x, y]); press.n.fx = wx + press.ox; press.n.fy = wy + press.oy; }
    return;
  }
  if (e.pointerType === "touch") return;
  const n = pick(x, y);
  if (n !== hover) { hover = n; canvas.classList.toggle("hit", !!n); }
  if (n) showTip(n, e.clientX, e.clientY); else hideTip();
});
canvas.addEventListener("pointerup", (e) => {
  const p = press; press = null; canvas.classList.remove("drag");
  if (!p) return;
  if (p.n) { sim.alphaTarget(0); if (!(p.n.kind === "root" && mode === "constellation")) { p.n.fx = null; p.n.fy = null; } }
  if (!p.moved) { p.n ? clickNode(p.n) : (selected && select(null)); }
});
canvas.addEventListener("pointerleave", () => { if (!press) { hover = null; hideTip(); canvas.classList.remove("hit"); } });
canvas.addEventListener("dblclick", (e) => { const [x, y] = d3.pointer(e, canvas), n = pick(x, y); if (n) flyTo(n, Math.max(T.k * 1.6, 2.2)); });

function clickNode(n) {
  if (n.kind === "macro" || n.kind === "sub") setFocus(focusGenre === n.gid ? null : n.gid);
  else if (n.kind === "root") { setFocus(null); select(null); fitView(vNodes); }
  else select(n);
}
function showTip(n, cx, cy) {
  if (n.kind === "root") return hideTip();
  let h;
  if (isItem(n)) {
    h = `<b>${esc(n.title)}</b><small>${esc(n.author)}${n.year ? " · " + n.year : ""}</small>`;
    if (n.kind === "rec") h += `<p class="tipm">★ ${n.score}% match · #${n.rank} of ${data.recs.length}</p>${n.reason ? `<p>✦ ${esc(trunc(n.reason, 110))}</p>` : ""}`;
    else if (n.kind === "queue") h += `<p>${n.shelf === "reading" ? "▶ Reading right now" : n.rank ? `🔖 Read-next #${n.rank} of ${qCount()} · ${n.score}%` : "🔖 On my to-read list"}</p>`;
    else if (n.rating) h += `<p><span class="stars">${"★".repeat(n.rating)}<i>${"★".repeat(5 - n.rating)}</i></span></p>`;
  } else h = `<b>${esc(n.name)}</b><small>${n.count} book${n.count === 1 ? "" : "s"} · click to ${focusGenre === n.gid ? "show all" : "isolate"}</small>`;
  tip.innerHTML = h; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(cx, innerWidth - r.width - 24) + "px"; tip.style.top = Math.min(cy, innerHeight - r.height - 24) + "px";
}
function hideTip() { tip.hidden = true; }

/* ---------- selection, focus, panel ---------- */
function select(n, instant) {
  selected = n;
  history.replaceState(null, "", n ? "#" + encodeURIComponent(n.id) : location.pathname + location.search);
  renderPanel();
  if (n && n.x != null) flyTo(n, Math.max(T.k, 1.4)), instant && 0;
}
function setFocus(g) {
  focusGenre = g; renderLegend();
  if (g) fitView(focusedItems(), true, 1.8); else fitView(vNodes);
}

const stars5 = (r) => `<span class="stars" aria-label="${r} of 5 stars">${"★".repeat(r)}<i>${"★".repeat(5 - r)}</i></span>`;
const thumb = (n, w = 34) => A && n.atlas
  ? `<span class="ph" style="width:${w}px;height:${w * 1.5}px;background:url(${A.src}) no-repeat -${(n.atlas[0] * w) / A.cw}px -${(n.atlas[1] * w) / A.cw}px / ${(A.w * w) / A.cw}px ${(A.h * w) / A.cw}px"></span>`
  : n.cover ? `<img src="${esc(n.cover)}" alt="" loading="lazy">` : `<span class="ph"></span>`;

const qCount = () => (data.queue || []).filter((q) => q.rank != null).length;
function readNextHTML(n) {
  const p = n.parts || {}, N = qCount();
  const tier = n.rank <= 3 ? "Start here" : n.rank <= 8 ? "Up next" : n.rank <= 20 ? "When the mood strikes" : "Someday";
  const bar = (label, v, note) => `<div class="part"><span>${label}</span><i style="--w:${v}%"></i><b>${note}</b></div>`;
  return `<div class="match" style="--c:${n.color}"><div class="mring" style="--p:${n.score}"><b>${n.score}<small>%</small></b></div>
    <div><strong>#${n.rank} <em>of ${N} to read</em></strong><span>${tier}</span></div></div>
    <div class="parts">${bar("Taste fit", p.taste, "my call")}${bar("Author", p.author, p.nAuthor ? p.avgStars + "★ avg of " + p.nAuthor + " read" : "new author")}${bar("Series", p.series, p.series === 100 ? "continues a series" : "standalone / new")}</div>`;
}
function readNextListHTML() {
  const top = (data.queue || []).filter((q) => q.rank != null).sort((a, b) => a.rank - b.rank).slice(0, 5);
  if (!top.length) return "";
  return `<h4>Read next</h4><div class="minis picks">${top.map((q) => { const n = byId.get(q.id); return `<button class="mini" data-go="${esc(n.id)}"><b class="rk" style="--c:${n.color}">${n.rank}</b>${thumb(n, 30)}<span><b>${esc(n.title)}</b><small>${esc(n.author)}</small></span><em class="pct" style="--c:${n.color}">${n.score}%</em></button>`; }).join("")}</div>`;
}
function matchHTML(n) {
  const p = n.parts || {}, N = data.recs.length;
  const tier = n.rank <= 5 ? "Read this next" : n.rank <= 15 ? "Strong match" : n.rank <= 35 ? "Good match" : "Worth a look";
  const bar = (label, v, note) => `<div class="part"><span>${label}</span><i style="--w:${v}%"></i><b>${note}</b></div>`;
  return `<div class="match" style="--c:${n.color}"><div class="mring" style="--p:${n.score}"><b>${n.score}<small>%</small></b></div>
    <div><strong>#${n.rank} <em>of ${N} picks</em></strong><span>${tier}</span></div></div>
    <div class="parts">${bar("Taste fit", p.taste, "my call")}${bar("Your ratings", p.ratings, p.avgStars ? p.avgStars + "★ avg of linked books" : "no ratings yet")}${bar("Connections", p.links, (n.because || []).length + " of your books")}</div>`;
}
function topPicksHTML() {
  const top = data.recs.slice().sort((a, b) => a.rank - b.rank).slice(0, 8);
  return `<h4>Top picks</h4><div class="minis picks">${top.map((r) => { const n = byId.get(r.id); return `<button class="mini" data-go="${esc(n.id)}"><b class="rk" style="--c:${n.color}">${n.rank}</b>${thumb(n, 30)}<span><b>${esc(n.title)}</b><small>${esc(n.author)}</small></span><em class="pct" style="--c:${n.color}">${n.score}%</em></button>`; }).join("")}</div>`;
}
const miniBtn = (n, sub) => `<button class="mini" data-go="${esc(n.id)}">${thumb(n)}<span><b>${esc(n.title)}</b><small>${esc(sub ?? n.author)}</small></span></button>`;

function renderPanelVisibility() { $("#panel").classList.toggle("hide", W <= 900 && !selected); }
function renderPanel() {
  const p = $("#panel");
  p.scrollTop = 0;
  if (!selected) { p.innerHTML = overviewHTML(); animateTiles(); }
  else p.innerHTML = detailHTML(selected);
  renderPanelVisibility();
}
function overviewHTML() {
  const bs = data.books, rated = bs.filter((b) => b.rating), pages = d3.sum(bs, (b) => b.pages || 0);
  const avg = rated.length ? d3.mean(rated, (b) => b.rating) : 0;
  const hist = d3.range(1, 6).map((r) => rated.filter((b) => b.rating === r).length), hmax = Math.max(1, ...hist);
  const yrs = d3.rollups(bs.filter((b) => b.dateRead), (v) => v.length, (b) => b.dateRead.slice(0, 4)).sort((a, b) => a[0] - b[0]).slice(-9), ymax = Math.max(1, ...yrs.map((y) => y[1]));
  const au = d3.rollups(bs, (v) => v.length, (b) => b.author).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `<h2>Overview</h2><p class="by">Every book I've read, and what to read next.</p>
  <div class="tiles">
    <div class="tile"><b data-n="${bs.length}">0</b><span>Books read</span></div>
    <div class="tile"><b data-n="${data.recs.length}">0</b><span>Recommended</span></div>
    <div class="tile"><b data-n="${pages}">0</b><span>Pages</span></div>
    <div class="tile"><b>${avg ? avg.toFixed(1) : "–"}</b><span>Avg rating</span></div>
  </div>
  ${rated.length ? `<h4>How I rate</h4><div class="bars">${hist.map((v, i) => `<div style="height:${(v / hmax) * 100}%;animation-delay:${i * 70}ms" data-t="${i + 1}★ · ${v}"></div>`).join("")}</div><div class="axis"><span>1★</span><span>5★</span></div>` : ""}
  ${yrs.length > 1 ? `<h4>Read per year</h4><div class="bars">${yrs.map((y, i) => `<div style="height:${(y[1] / ymax) * 100}%;animation-delay:${i * 60}ms" data-t="${y[0]} · ${y[1]}"></div>`).join("")}</div><div class="axis"><span>${yrs[0][0]}</span><span>${yrs.at(-1)[0]}</span></div>` : ""}
  <h4>Most-read authors</h4><ul class="authors">${au.map((a) => `<li data-author="${esc(a[0])}"><b>${esc(a[0])}</b><small>${a[1]}</small></li>`).join("")}</ul>
  ${topPicksHTML()}
  ${readNextListHTML()}
  <h4>The key</h4>
  <ul class="key"><li><i class="k-read"></i>Read</li><li><i class="k-reading"></i>Reading now</li><li><i class="k-queue"></i>To read (${data.queue?.length || 0})</li><li><i class="k-rec"></i>Recommended</li></ul>
  <p class="hint">Click anything to dive in. Recommendations are linked to the books that inspired them.</p>`;
}
function animateTiles() {
  document.querySelectorAll(".tile b[data-n]").forEach((el) => {
    const to = +el.dataset.n, t0 = performance.now();
    (function step(t) { const p = reduce ? 1 : clamp((t - t0) / 900, 0, 1); el.textContent = Math.round(to * (1 - (1 - p) ** 3)).toLocaleString(); if (p < 1) requestAnimationFrame(step); })(t0);
  });
}
function detailHTML(n) {
  const isRec = n.kind === "rec", gen = (n.genreIds || []).map((g) => genreNodes.get(g)).filter(Boolean);
  const url = !isRec && /^\d+$/.test(n.id) ? `https://www.goodreads.com/book/show/${n.id}` : `https://www.goodreads.com/search?q=${encodeURIComponent(n.title + " " + n.author)}`;
  let h = `<button class="close" data-close aria-label="Close">✕</button>
  <div class="cover-wrap" style="--c:${n.color}">${n.cover ? `<img class="cover" src="${esc(n.cover)}" alt="Cover of ${esc(n.title)}">` : `<div class="cover noart" style="background:linear-gradient(150deg,${n.color},${shade(n.color, -0.65)})"><span>${esc(n.title)}</span></div>`}</div>
  <span class="kind ${isRec ? "rec" : n.kind === "queue" ? "queue" : "read"}" style="--c:${n.color}">${isRec ? "✦ Recommended" : n.kind === "queue" ? (n.shelf === "reading" ? "▶ Reading now" : "🔖 To read") : "Read"}</span>
  <h2>${esc(n.title)}</h2><p class="by">${esc(n.author)}</p>`;
  if (!isRec && n.rating) h += stars5(n.rating);
  const facts = [n.series && `${esc(n.series)}${n.seriesNo ? " #" + n.seriesNo : ""}`, n.year, n.pages && `${n.pages} pages`, n.dateRead && `read ${esc(n.dateRead)}`, !isRec && n.avg && `avg ${n.avg}`].filter(Boolean);
  if (facts.length) h += `<div class="facts">${facts.map((f) => `<span>${f}</span>`).join("")}</div>`;
  if (n.blurb) h += `<p class="blurb">${esc(n.blurb)}</p>`;
  if (isRec && n.reason) h += `<div class="why" style="--c:${n.color}">${esc(n.reason)}</div>`;
  if (isRec) h += matchHTML(n);
  else if (n.kind === "queue" && n.rank) h += readNextHTML(n);
  if (gen.length) h += `<h4>Genres</h4><div class="chips">${gen.map((g) => `<button class="chip" style="--c:${g.color}" data-genre="${esc(g.gid)}">${esc(g.name)}</button>`).join("")}</div>`;
  if (isRec) { const bs = (n.because || []).map((id) => byId.get(id)).filter(Boolean); if (bs.length) h += `<h4>Because I read</h4><div class="minis">${bs.map((b) => miniBtn(b)).join("")}</div>`; }
  else {
    const recs = nodes.filter((r) => r.kind === "rec" && r.because?.includes(n.id));
    if (recs.length) h += `<h4>Leads to</h4><div class="minis">${recs.map((r) => miniBtn(r, (showRecs ? "" : "(hidden) ") + r.author)).join("")}</div>`;
    const sib = nodes.filter((b) => (b.kind === "book" || b.kind === "queue") && b !== n && ((b.series && b.series === n.series) || b.author === n.author)).slice(0, 5);
    if (sib.length) h += `<h4>${n.series ? "In this series / by this author" : "More by this author"}</h4><div class="minis">${sib.map((b) => miniBtn(b, b.series ? b.series + (b.seriesNo ? " #" + b.seriesNo : "") : b.author)).join("")}</div>`;
  }
  h += window.LibraryEdits?.panelExtra?.(n) || "";
  return h + `<a class="cta" href="${url}" target="_blank" rel="noopener">${isRec ? "Find on" : "Open in"} Goodreads ↗</a>`;
}

document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]"), ge = e.target.closest("[data-genre]"), au = e.target.closest("[data-author]");
  if (e.target.closest("[data-close]")) select(null);
  else if (go) { const n = byId.get(go.dataset.go); if (n) { if (n.kind === "rec" && !showRecs) setRecs(true); select(n); } }
  else if (ge) setFocus(ge.dataset.genre);
  else if (au) { q.value = au.dataset.author; runSearch(); fitView(nodes.filter((n) => searchSet?.has(n.id) && vNodes.includes(n))); }
});

/* ---------- legend ---------- */
function renderLegend() {
  const macros = data.genres.filter((g) => !g.parent), f = focusGenre && genreNodes.get(focusGenre), activeMacro = f ? (f.kind === "macro" ? f.gid : f.parentG) : null;
  $("#legend").classList.toggle("dim", !!f);
  $("#legend").innerHTML = `<h3>Genres ${f ? `<button data-clear>Show all</button>` : ""}</h3>` + macros.map((g) => {
    const subs = data.genres.filter((s) => s.parent === g.id);
    return `<button class="macro ${activeMacro === g.id ? "on" : ""}" style="--c:${g.color}" data-g="${esc(g.id)}"><i></i><span>${esc(g.name)}</span><small>${g.count}</small></button>` +
      (activeMacro === g.id ? `<div class="subs">${subs.map((s) => `<button class="chip ${focusGenre === s.id ? "on" : ""}" style="--c:${s.color}" data-g="${esc(s.id)}">${esc(s.name)} <small>${s.count}</small></button>`).join("")}</div>` : "");
  }).join("") + (window.LibraryEdits?.legendExtra?.() || "");
}
$("#legend").addEventListener("click", (e) => {
  if (e.target.closest("[data-clear]")) return setFocus(null);
  const b = e.target.closest("[data-g]"); if (!b) return;
  const g = b.dataset.g; setFocus(focusGenre === g ? null : g);
});

/* ---------- search ---------- */
const q = $("#q"), resEl = $("#results"); let resList = [], resSel = 0;
function runSearch() {
  const s = q.value.trim().toLowerCase();
  if (!s) { searchSet = null; resEl.hidden = true; return; }
  const hit = (n) => [n.title, n.author, n.series, ...(n.genreIds || [])].some((v) => v && String(v).toLowerCase().includes(s));
  const items = nodes.filter((n) => isItem(n) && (showRecs || n.kind !== "rec") && (showQueue || n.kind !== "queue") && hit(n));
  searchSet = new Set(items.map((n) => n.id));
  const gen = [...genreNodes.values()].filter((g) => g.name.toLowerCase().includes(s)).slice(0, 3);
  resList = [...items.slice(0, 7), ...gen]; resSel = 0;
  resEl.innerHTML = resList.length ? resList.map((n, i) => `<li data-i="${i}" class="${i === 0 ? "sel" : ""}" tabindex="-1">${n.cover ? `<img src="${esc(n.cover)}" alt="">` : `<span class="ph"></span>`}<span><b>${esc(n.name)}</b><small>${n.author ? esc(n.author) : (n.count + " books")}</small></span><span class="tag">${n.kind === "rec" ? "✦ " + n.score + "%" : n.kind === "queue" ? (n.shelf === "reading" ? "▶ reading" : "to read") : n.kind === "book" ? "read" : "genre"}</span></li>`).join("") : `<li class="muted">No matches</li>`;
  resEl.hidden = false;
}
function chooseResult(i) {
  const n = resList[i]; if (!n) return;
  q.value = ""; resEl.hidden = true; searchSet = null; q.blur();
  if (n.kind === "macro" || n.kind === "sub") setFocus(n.gid); else select(n);
}
q.addEventListener("input", runSearch);
q.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); resSel = clamp(resSel + (e.key === "ArrowDown" ? 1 : -1), 0, resList.length - 1); [...resEl.children].forEach((li, i) => li.classList.toggle("sel", i === resSel)); }
  else if (e.key === "Enter") { e.preventDefault(); if (resList.length) chooseResult(resSel); }
  else if (e.key === "Escape") { q.value = ""; runSearch(); q.blur(); }
});
resEl.addEventListener("pointerdown", (e) => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); chooseResult(+li.dataset.i); } });
q.addEventListener("blur", () => setTimeout(() => { resEl.hidden = true; if (!q.value) searchSet = null; }, 120));

/* ---------- rebuild after edits (new books, genres, re-tagging) ---------- */
function recount() {
  const items = [...data.books, ...data.recs, ...(data.queue || [])], gm = new Map(data.genres.map((g) => [g.id, g]));
  data.genres.forEach((g) => (g.count = 0));
  for (const b of items) {
    for (const g of (b.genres || []).filter((g) => gm.has(g))) { gm.get(g).count++; const m = gm.get(gm.get(g).parent); if (m) m.count++; } // same counting as build_graph.py
  }
  data.meta.read = data.books.length; data.meta.queued = (data.queue || []).length; data.meta.recommended = data.recs.length;
}
function rebuild() {
  const old = new Map(nodes.map((n) => [n.id, [n.x, n.y, n.vx, n.vy]]));
  nodes = []; links = []; byId = new Map(); adj = new Map(); genreNodes = new Map();
  recount(); build();
  nodes.forEach((n) => { const p = old.get(n.id); if (p) [n.x, n.y, n.vx, n.vy] = p; });
  if (focusGenre && !genreNodes.has(focusGenre)) focusGenre = null;
  selected = selected ? byId.get(selected.id) || null : null; hover = null;
  $("#brand-sub").textContent = `${data.meta.read} read · ${data.meta.queued || 0} queued · ${data.meta.recommended} recommended`;
  renderLegend(); renderPanel(); applyLayout(0.8);
}
window.Library = { get data() { return data; }, rebuild, select: (id) => select(byId.get(id) || null), node: (id) => byId.get(id), refreshPanel: () => renderPanel(), refreshLegend: () => renderLegend() };

/* ---------- dock + keyboard ---------- */
function setQueue(v) { showQueue = v; $("#t-queue").checked = v; if (!v && selected?.kind === "queue") select(null); applyLayout(0.7); }
function setRecs(v) { showRecs = v; $("#t-recs").checked = v; $("#r-limit").disabled = !v; if (!v && selected?.kind === "rec") select(null); applyLayout(0.7); }
function surprise() {
  const pool = vNodes.filter((n) => n.kind === "rec").concat(showRecs ? [] : vNodes.filter((n) => n.kind === "book"));
  if (!pool.length) return;
  setFocus(null); select(pool[Math.floor(Math.random() * pool.length)]);
}
function savePNG() {
  canvas.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "barons-library.png"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
}
function bindUI() {
  document.querySelectorAll(".modes button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("#t-recs").addEventListener("change", (e) => setRecs(e.target.checked));
  const lim = $("#r-limit"), N = data.recs.length; lim.max = N; lim.value = N; let limRaf = 0;
  lim.addEventListener("input", () => {
    recLimit = +lim.value; $("#r-val").textContent = recLimit >= N ? "all" : recLimit;
    if (selected?.kind === "rec" && selected.rank > recLimit) select(null);
    cancelAnimationFrame(limRaf); limRaf = requestAnimationFrame(() => applyLayout(0.5));
  });
  $("#t-queue").addEventListener("change", (e) => setQueue(e.target.checked));
  $("#t-labels").addEventListener("change", (e) => (alwaysLabels = e.target.checked));
  $("#b-zoom-in").onclick = () => d3.select(canvas).transition().duration(300).call(zoom.scaleBy, 1.5);
  $("#b-zoom-out").onclick = () => d3.select(canvas).transition().duration(300).call(zoom.scaleBy, 1 / 1.5);
  $("#b-fit").onclick = () => { setFocus(null); fitView(vNodes); };
  $("#b-surprise").onclick = surprise;
  $("#b-png").onclick = savePNG;
  $("#b-theme").onclick = () => setTheme(C.light ? "dark" : "light");
  $("#b-help").onclick = () => ($("#help").hidden = false);
  $("#help-close").onclick = () => ($("#help").hidden = true);
  $("#help").addEventListener("click", (e) => { if (e.target.id === "help") e.currentTarget.hidden = true; });
  addEventListener("keydown", (e) => {
    if (e.target === q || e.target.closest?.("input, select, textarea")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case "/": e.preventDefault(); q.focus(); break;
      case "Escape": if (!$("#help").hidden) $("#help").hidden = true; else if (selected) select(null); else if (focusGenre) setFocus(null); break;
      case "1": setMode("constellation"); break; case "2": setMode("clusters"); break; case "3": setMode("timeline"); break;
      case "r": case "R": setRecs(!showRecs); break;
      case "q": case "Q": setQueue(!showQueue); break;
      case "t": case "T": alwaysLabels = !alwaysLabels; $("#t-labels").checked = alwaysLabels; break;
      case "s": case "S": surprise(); break;
      case "d": case "D": setTheme(C.light ? "dark" : "light"); break;
      case "0": setFocus(null); fitView(vNodes); break;
      case "?": $("#help").hidden = false; break;
    }
  });
}
})();
