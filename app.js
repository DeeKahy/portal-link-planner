import {
  SEARCH, blocksOf, targetFrom, resolveTrips, tripMargin, verifyAll,
  strayWarnings, solve, serializeState, deserializeState, isCandidate,
} from "./engine.js?v=5";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = { edition: "java", portals: [], links: [] };
let nextId = 1;
// Which unlocked portal the click-to-place dropdown targets, per dimension.
const placeChoice = { overworld: null, nether: null };
// Map view state, kept across re-renders.
const mapZoom = { overworld: 1, nether: 1 };
const mapScroll = {};
// Portal to flash on the next render (after click-to-place).
let flashId = null;
// Snapshots for the Undo button.
const undoStack = [];

const PRESETS = {
  worked: {
    edition: "java",
    portals: [
      { id: "p1", name: "Storage", dim: "overworld", x: 814, y: 87, z: -2513, axis: "x", locked: true, minY: null, maxY: null },
      { id: "p2", name: "Pretty", dim: "overworld", x: 828, y: 87, z: -2471, axis: "x", locked: true, minY: null, maxY: null },
      { id: "p3", name: "Roof portal", dim: "nether", x: 101, y: 128, z: -315, axis: "x", locked: false, minY: 128, maxY: 128 },
      { id: "p4", name: "Below portal", dim: "nether", x: 103, y: 87, z: -296, axis: "x", locked: false, minY: 70, maxY: 122 },
    ],
    links: [
      { from: "p1", to: "p3" }, { from: "p3", to: "p1" },
      { from: "p2", to: "p4" }, { from: "p4", to: "p2" },
    ],
  },
  simple: {
    edition: "java",
    portals: [
      { id: "p1", name: "Base", dim: "overworld", x: 200, y: 64, z: -400, axis: "x", locked: true, minY: null, maxY: null },
      { id: "p2", name: "Nether side", dim: "nether", x: 25, y: 64, z: -50, axis: "x", locked: false, minY: null, maxY: null },
    ],
    links: [{ from: "p1", to: "p2" }, { from: "p2", to: "p1" }],
  },
  hub: {
    edition: "java",
    portals: [
      { id: "p1", name: "Base A", dim: "overworld", x: 0, y: 64, z: 0, axis: "x", locked: true, minY: null, maxY: null },
      { id: "p2", name: "Base B", dim: "overworld", x: 180, y: 64, z: 40, axis: "x", locked: true, minY: null, maxY: null },
      { id: "p3", name: "Hub gate A", dim: "nether", x: 0, y: 64, z: 0, axis: "x", locked: false, minY: 60, maxY: 80 },
      { id: "p4", name: "Hub gate B", dim: "nether", x: 22, y: 64, z: 5, axis: "x", locked: false, minY: 60, maxY: 80 },
    ],
    links: [
      { from: "p1", to: "p3" }, { from: "p3", to: "p1" },
      { from: "p2", to: "p4" }, { from: "p4", to: "p2" },
    ],
  },
};
const EXAMPLE_SNAPSHOT = JSON.stringify({ p: PRESETS.worked.portals, l: PRESETS.worked.links });

function sanitizeState(s) {
  const portals = (s.portals || []).filter((p) => p && p.id && p.dim);
  const ids = new Map(portals.map((p) => [p.id, p]));
  const seen = new Set();
  const links = (s.links || []).filter((l) => {
    if (!l || !ids.has(l.from) || !ids.has(l.to) || l.from === l.to) return false;
    if (ids.get(l.from).dim === ids.get(l.to).dim) return false; // impossible in game
    const k = l.from + ">" + l.to;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { edition: s.edition === "legacy" ? "legacy" : "java", portals, links };
}

function loadInitialState() {
  const q = new URLSearchParams(location.search).get("s");
  if (q) {
    try { return sanitizeState(deserializeState(q)); } catch { /* fall through */ }
  }
  const saved = localStorage.getItem("portal-planner-state");
  if (saved) {
    try { return sanitizeState(JSON.parse(saved)); } catch { /* fall through */ }
  }
  return structuredClone(PRESETS.worked);
}

function persist() {
  localStorage.setItem("portal-planner-state", JSON.stringify(state));
}

function syncNextId() {
  for (const p of state.portals) {
    const n = parseInt(String(p.id).replace(/\D/g, ""), 10);
    if (!isNaN(n) && n >= nextId) nextId = n + 1;
  }
}

function pushUndo() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 50) undoStack.shift();
}

function isExampleState() {
  return JSON.stringify({ p: state.portals, l: state.links }) === EXAMPLE_SNAPSHOT;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);

function render() {
  persist();
  $("#edition").value = state.edition;
  $("#undo").disabled = undoStack.length === 0;
  $("#example-banner").hidden = !isExampleState();
  renderPortals();
  renderLinks();
  renderVerification();
  renderMaps();
  renderExport();
}

function num(v, fallback = 0) {
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

// Accepts an F3 line ("XYZ: 814.500 / 87.00000 / -2513.300") or any text
// containing three numbers, and returns them floored.
function parseCoords(text) {
  const m = String(text).match(/-?\d+(?:\.\d+)?/g);
  if (!m || m.length < 3) return null;
  return { x: Math.floor(+m[0]), y: Math.floor(+m[1]), z: Math.floor(+m[2]) };
}

function renderPortals() {
  const list = $("#portal-list");
  list.innerHTML = "";
  for (const p of state.portals) {
    const card = document.createElement("div");
    card.className = "portal-card " + p.dim + (p.id === flashId ? " flash-card" : "");
    card.innerHTML = `
      <div class="row">
        <span class="dim-tag">${p.dim === "nether" ? "NETHER" : "OVERWORLD"}</span>
        <input type="text" data-f="name" value="${escapeHtml(p.name)}" aria-label="Portal name">
        <label title="Locked portals are already built and stay where they are"><input type="checkbox" data-f="locked" ${p.locked ? "checked" : ""}> locked</label>
        <button class="del" data-del title="Delete portal">&times;</button>
      </div>
      <div class="row">
        <label>X <input type="number" data-f="x" value="${p.x}"></label>
        <label>Y <input type="number" data-f="y" value="${p.y}"></label>
        <label>Z <input type="number" data-f="z" value="${p.z}"></label>
        <input type="text" class="paste-box" data-paste placeholder="or paste F3 line" title="Paste coordinates in any format, e.g. an F3 line or 814 87 -2513">
      </div>
      <details class="adv">
        <summary>More options</summary>
        <div class="row">
          <label>frame along
            <select data-f="axis"><option value="x" ${p.axis === "x" ? "selected" : ""}>X</option><option value="z" ${p.axis === "z" ? "selected" : ""}>Z</option></select>
          </label>
          <span class="hint">(direction the 2-wide opening runs; changes results by at most 1 block)</span>
        </div>
        ${p.locked ? "" : `
        <div class="row">
          <label>solver height limits: min Y <input type="number" data-f="minY" value="${p.minY ?? ""}" placeholder="any"></label>
          <label>max Y <input type="number" data-f="maxY" value="${p.maxY ?? ""}" placeholder="any"></label>
        </div>`}
      </details>`;
    card.addEventListener("change", (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      if (f === "locked") p.locked = e.target.checked;
      else if (f === "name") p.name = e.target.value || p.name;
      else if (f === "axis") p.axis = e.target.value;
      else if (f === "minY" || f === "maxY") p[f] = e.target.value === "" ? null : num(e.target.value);
      else p[f] = num(e.target.value, p[f]);
      render();
    });
    card.querySelector("[data-paste]").addEventListener("input", (e) => {
      const c = parseCoords(e.target.value);
      if (!c) return;
      p.x = c.x; p.y = c.y; p.z = c.z;
      render();
    });
    card.querySelector("[data-del]").addEventListener("click", () => {
      pushUndo();
      state.portals = state.portals.filter((q) => q.id !== p.id);
      state.links = state.links.filter((l) => l.from !== p.id && l.to !== p.id);
      render();
    });
    list.appendChild(card);
  }
  renderPairSelectors();
}

function renderPairSelectors() {
  const a = $("#pair-a"), bSel = $("#pair-b");
  const curA = a.value;
  a.innerHTML = state.portals.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.dim})</option>`).join("");
  if ([...a.options].some((o) => o.value === curA)) a.value = curA;
  const from = state.portals.find((p) => p.id === a.value);
  const curB = bSel.value;
  const others = from ? state.portals.filter((p) => p.dim !== from.dim) : [];
  bSel.innerHTML = others.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.dim})</option>`).join("");
  if ([...bSel.options].some((o) => o.value === curB)) bSel.value = curB;
  const disabled = !from || others.length === 0;
  $("#pair-btn").disabled = disabled;
  $("#pair-one").disabled = disabled;
}

function renderLinks() {
  const list = $("#link-list");
  list.innerHTML = "";
  if (state.links.length === 0) {
    list.innerHTML = `<p class="hint">No connections yet. Pick two portals below.</p>`;
  }
  state.links.forEach((l, i) => {
    const row = document.createElement("div");
    row.className = "link-row";
    const fromPortal = state.portals.find((p) => p.id === l.from);
    const fromOpts = state.portals.map((p) =>
      `<option value="${p.id}" ${p.id === l.from ? "selected" : ""}>${escapeHtml(p.name)} (${p.dim})</option>`).join("");
    // Destination can only be a portal in the other dimension.
    const toOpts = state.portals.filter((p) => !fromPortal || p.dim !== fromPortal.dim).map((p) =>
      `<option value="${p.id}" ${p.id === l.to ? "selected" : ""}>${escapeHtml(p.name)} (${p.dim})</option>`).join("");
    row.innerHTML = `<select data-e="from">${fromOpts}</select> →
      <select data-e="to">${toOpts}</select>
      <button data-del title="Remove connection">&times;</button>`;
    row.addEventListener("change", (e) => {
      const f = e.target.dataset.e;
      if (!f) return;
      l[f] = e.target.value;
      if (f === "from") {
        // Keep the destination in the opposite dimension.
        const from = state.portals.find((p) => p.id === l.from);
        const to = state.portals.find((p) => p.id === l.to);
        if (from && (!to || to.dim === from.dim)) {
          const alt = state.portals.find((p) => p.dim !== from.dim);
          l.to = alt ? alt.id : l.to;
        }
      }
      render();
    });
    row.querySelector("[data-del]").addEventListener("click", () => {
      pushUndo();
      state.links.splice(i, 1);
      render();
    });
    list.appendChild(row);
  });
}

function statusWord(s) {
  return s === "green" ? "SAFE" : s === "yellow" ? "FRAGILE" : "BROKEN";
}

const STATUS_RANK = { red: 0, yellow: 1, green: 2 };

// One line summarizing a single direction of a connection.
function dirLine(r) {
  const nominal = r.trips[0];
  const who = `${escapeHtml(r.src.name)} to ${escapeHtml(r.dst.name)}`;
  if (nominal.result === "NEW_PORTAL") {
    return `<span class="red-t">BROKEN</span> ${who}: no portal within ${nominal.radius} blocks (sideways) of the arrival spot ${fmtPt(nominal.target)}; the game would create a brand-new portal there.`;
  }
  if (nominal.winner.id !== r.dst.id) {
    return `<span class="red-t">BROKEN</span> ${who}: arrives at <strong>${escapeHtml(nominal.winner.name)}</strong> instead, because it sits closer to the arrival spot.`;
  }
  const m = r.minMargin === Infinity ? "no rival portals anywhere near" : `${r.minMargin.toFixed(1)} blocks of slack`;
  const note = !r.allCorrect
    ? "breaks if you stand on the wrong side of the frame"
    : r.status === "green" ? "works wherever you stand" : "risky, very little room for error";
  return `<span class="${r.status}-t">${statusWord(r.status)}</span> ${who}: ${m}; ${note}.`;
}

function tripTable(r) {
  const rows = r.trips.map((t) => {
    const cand = t.cands.map((c) => `${escapeHtml(c.portal.name)} @ ${c.dist.toFixed(1)}`).join(", ") || "none";
    const excl = t.excluded.map((e) => `${escapeHtml(e.portal.name)} (+${e.outside} outside)`).join(", ") || "none";
    const win = t.result === "LINK" ? escapeHtml(t.winner.name) : "NEW PORTAL";
    const mg = tripMargin(t);
    return `<tr><td>(${t.entry.x}, ${t.entry.y}, ${t.entry.z})</td><td>${fmtPt(t.target)}</td>
      <td>${cand}</td><td>${excl}</td><td>${win}</td>
      <td>${mg ? mg.margin.toFixed(1) + " (" + mg.kind + " vs " + escapeHtml(mg.against.name) + ")" : "none"}</td></tr>`;
  }).join("");
  return `<div class="tbl-cap">${escapeHtml(r.src.name)} to ${escapeHtml(r.dst.name)}, from both standing positions:</div>
    <table><tr><th>standing at</th><th>arrival spot</th><th>portals found (3D distance)</th><th>ignored (blocks outside zone)</th><th>winner</th><th>margin</th></tr>${rows}</table>`;
}

function renderVerification() {
  const out = $("#verify-output");
  out.innerHTML = "";
  const results = verifyAll(state.portals, state.links, state.edition);
  if (results.length === 0) {
    out.innerHTML = `<p class="hint">Add portals and connections to see the simulation.</p>`;
    return;
  }
  // Group each connection with its return direction, if present.
  const used = new Set();
  const groups = [];
  results.forEach((r, i) => {
    if (used.has(i)) return;
    used.add(i);
    const group = [r];
    const j = results.findIndex((r2, k) => k > i && !used.has(k) && r2.src.id === r.dst.id && r2.dst.id === r.src.id);
    if (j >= 0) { used.add(j); group.push(results[j]); }
    groups.push(group);
  });
  for (const group of groups) {
    const worst = group.reduce((w, r) => STATUS_RANK[r.status] < STATUS_RANK[w] ? r.status : w, "green");
    const div = document.createElement("div");
    div.className = "verdict " + worst;
    const title = group.length === 2
      ? `${escapeHtml(group[0].src.name)} and ${escapeHtml(group[0].dst.name)}`
      : `${escapeHtml(group[0].src.name)} to ${escapeHtml(group[0].dst.name)} (one way)`;
    div.innerHTML = `<div class="pair-title">${title}</div>
      ${group.map((r) => `<div class="dir">${dirLine(r)}</div>`).join("")}
      <details><summary>show the math</summary>${group.map(tripTable).join("")}</details>`;
    out.appendChild(div);
  }
  const warn = $("#warnings");
  warn.innerHTML = "";
  for (const w of strayWarnings(state.portals, state.links, state.edition)) {
    const d = document.createElement("p");
    d.className = "warning";
    d.textContent = `"${w.intruder.name}" is inside "${w.source.name}"'s search zone but is not its destination. If it should not exist, demolish it in-game too.`;
    warn.appendChild(d);
  }
}

// ---------------------------------------------------------------------------
// Maps (SVG, one panel per dimension, independent fit + zoom)
// ---------------------------------------------------------------------------
function renderMaps() {
  const container = $("#maps");
  // Preserve scroll positions across the rebuild.
  container.querySelectorAll(".map-scroll").forEach((el) => {
    mapScroll[el.dataset.dim] = { l: el.scrollLeft, t: el.scrollTop };
  });
  container.innerHTML = "";
  const dims = ["overworld", "nether"];
  const geo = { overworld: { portals: [], targets: [], arrows: [] }, nether: { portals: [], targets: [], arrows: [] } };
  for (const p of state.portals) geo[p.dim].portals.push(p);
  const results = verifyAll(state.portals, state.links, state.edition);
  for (const r of results) {
    const t = r.trips[0].target;
    geo[t.dim].targets.push({ t, radius: r.trips[0].radius, srcId: r.src.id });
    if (r.trips[0].result === "LINK") {
      geo[t.dim].arrows.push({
        from: { x: t.x, z: t.z },
        to: { x: r.trips[0].winner.x, z: r.trips[0].winner.z },
        good: r.trips[0].winner.id === r.dst.id,
      });
    }
  }
  const W = container.clientWidth || 640;

  for (const d of dims) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const eat = (x, z) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };
    for (const p of geo[d].portals) eat(p.x, p.z);
    for (const { t, radius } of geo[d].targets) { eat(t.x - radius, t.z - radius); eat(t.x + radius, t.z + radius); }
    if (minX === Infinity) { eat(-10, -10); eat(10, 10); }
    const pad = Math.max(6, (maxX - minX) * 0.08);
    const b = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
    const spanX = Math.max(b.maxX - b.minX, 1);
    const spanZ = Math.max(b.maxZ - b.minZ, 1);
    // Fit each dimension independently; zoom multiplies the fitted scale.
    const fit = Math.min(W / spanX, 440 / spanZ, 14);
    const s = Math.min(fit * mapZoom[d], 24);
    const w = spanX * s, h = Math.max(spanZ * s, 40);
    const X = (x) => (x - b.minX) * s;
    const Z = (z) => (z - b.minZ) * s;

    let svg = `<svg viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">`;
    for (const { t, radius, srcId } of geo[d].targets) {
      svg += `<rect class="search-square" data-square-src="${srcId}" x="${X(t.x - radius)}" y="${Z(t.z - radius)}" width="${2 * radius * s}" height="${2 * radius * s}"/>`;
    }
    for (const a of geo[d].arrows) {
      svg += `<line class="link-arrow ${a.good ? "good" : "bad"}" x1="${X(a.from.x)}" y1="${Z(a.from.z)}" x2="${X(a.to.x)}" y2="${Z(a.to.z)}" stroke-width="1.5" marker-end="url(#arr-${d})"/>`;
    }
    for (const { t } of geo[d].targets) {
      const c = 5;
      svg += `<g stroke="#b45309" stroke-width="1.2">
        <line x1="${X(t.x) - c}" y1="${Z(t.z)}" x2="${X(t.x) + c}" y2="${Z(t.z)}"/>
        <line x1="${X(t.x)}" y1="${Z(t.z) - c}" x2="${X(t.x)}" y2="${Z(t.z) + c}"/></g>`;
    }
    for (const p of geo[d].portals) {
      const color = d === "nether" ? "#dc2626" : "#7c3aed";
      svg += `<g class="portal-marker" data-portal="${p.id}">
        <rect class="${p.id === flashId ? "flash" : ""}" x="${X(p.x) - 4}" y="${Z(p.z) - 4}" width="8" height="8" rx="1.5" fill="${color}" stroke="#2a2440" stroke-width="${p.locked ? 1.6 : 0.5}"/>
        <text x="${X(p.x) + 7}" y="${Z(p.z) + 4}" font-size="11" fill="#3a3352">${escapeHtml(p.name)} (Y ${p.y}${p.locked ? ", locked" : ""})</text></g>`;
    }
    svg += `<rect class="cursor-cell" width="${s}" height="${s}" visibility="hidden"/>`;
    svg += `<defs><marker id="arr-${d}" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6" fill="none" stroke="context-stroke" stroke-width="1.2"/></marker></defs></svg>`;

    const wrap = document.createElement("div");
    wrap.className = "map-wrap";
    const unlocked = geo[d].portals.filter((p) => !p.locked);
    const placeUI = unlocked.length
      ? `<label>Click the map to move: <select data-place>${unlocked.map((p) =>
          `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}</select></label>`
      : `<span class="hint">all portals here are locked</span>`;
    wrap.innerHTML = `<div class="map-tools">
        <strong>${d === "nether" ? "Nether" : "Overworld"}</strong>
        ${placeUI}
        <span class="zoom-ui">${s.toFixed(1)} px/block
          <button data-zoom="out" title="Zoom out">&minus;</button>
          <button data-zoom="in" title="Zoom in">+</button>
          <button data-zoom="fit" title="Fit to view">fit</button>
        </span>
      </div>
      <div class="map-scroll" data-dim="${d}">${svg}<div class="map-tooltip" hidden></div></div>`;
    container.appendChild(wrap);

    const scrollEl = wrap.querySelector(".map-scroll");
    if (mapScroll[d]) { scrollEl.scrollLeft = mapScroll[d].l; scrollEl.scrollTop = mapScroll[d].t; }

    wrap.querySelectorAll("[data-zoom]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const z = btn.dataset.zoom;
        mapZoom[d] = z === "fit" ? 1 : Math.max(1, Math.min(16, mapZoom[d] * (z === "in" ? 2 : 0.5)));
        render();
      });
    });

    // Cursor tooltip: block coordinates + which search zones contain the spot.
    const svgEl = wrap.querySelector("svg");
    const tooltip = wrap.querySelector(".map-tooltip");
    const toWorld = (e) => {
      const ctm = svgEl.getScreenCTM?.();
      if (!ctm) return null;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      return { x: Math.floor(b.minX + pt.x / s), z: Math.floor(b.minZ + pt.y / s), px: pt.x, pz: pt.y };
    };
    const cursorCell = svgEl.querySelector(".cursor-cell");
    svgEl.addEventListener("pointermove", (e) => {
      const pos = toWorld(e);
      if (!pos) return;
      const zones = geo[d].targets
        .filter(({ t, radius }) => Math.abs(pos.x - t.x) <= radius && Math.abs(pos.z - t.z) <= radius)
        .map(({ srcId }) => state.portals.find((p) => p.id === srcId)?.name)
        .filter(Boolean);
      tooltip.innerHTML = `<strong>X ${pos.x}, Z ${pos.z}</strong><br>${
        zones.length ? "in the zone of: " + zones.map(escapeHtml).join(", ") : "outside every search zone"}`;
      tooltip.hidden = false;
      const box = scrollEl.getBoundingClientRect();
      tooltip.style.left = (e.clientX - box.left + scrollEl.scrollLeft + 14) + "px";
      tooltip.style.top = (e.clientY - box.top + scrollEl.scrollTop + 14) + "px";
      cursorCell.setAttribute("x", X(pos.x));
      cursorCell.setAttribute("y", Z(pos.z));
      cursorCell.setAttribute("visibility", "visible");
    });
    svgEl.addEventListener("pointerleave", () => {
      tooltip.hidden = true;
      cursorCell.setAttribute("visibility", "hidden");
    });

    // Click-to-place: move the chosen unlocked portal to the clicked block.
    if (unlocked.length) {
      const sel = wrap.querySelector("[data-place]");
      if (placeChoice[d] && unlocked.some((p) => p.id === placeChoice[d])) sel.value = placeChoice[d];
      placeChoice[d] = sel.value;
      sel.addEventListener("change", () => { placeChoice[d] = sel.value; });
      svgEl.style.cursor = "crosshair";
      svgEl.addEventListener("click", (e) => {
        const pos = toWorld(e);
        const portal = state.portals.find((p) => p.id === sel.value);
        if (!pos || !portal || portal.locked) return;
        pushUndo();
        portal.x = pos.x;
        portal.z = pos.z;
        flashId = portal.id;
        render();
      });
    }
  }

  // Hovering a portal marker highlights every search zone it competes in.
  const squareIndex = [];
  for (const r of results) {
    const t0 = r.trips[0];
    squareIndex.push({ srcId: r.src.id, target: t0.target, radius: t0.radius });
  }
  container.querySelectorAll(".portal-marker").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      const p = state.portals.find((q) => q.id === el.dataset.portal);
      if (!p) return;
      for (const sq of squareIndex) {
        if (isCandidate(p, sq.target, sq.radius)) {
          container.querySelectorAll(`[data-square-src="${sq.srcId}"]`).forEach((r) => r.classList.add("hl"));
        }
      }
    });
    el.addEventListener("mouseleave", () => {
      container.querySelectorAll(".search-square.hl").forEach((r) => r.classList.remove("hl"));
    });
  });

  flashId = null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function coordText() {
  return state.portals.map((p) =>
    `${p.name} [${p.dim}]${p.locked ? " (locked)" : ""}: ${p.x} ${p.y} ${p.z}  (frame along ${p.axis.toUpperCase()}, blocks ${blocksOf(p).map((b) => `${b.x},${b.y},${b.z}`).join(" + ")})`
  ).join("\n");
}

function tpText() {
  return state.portals.map((p) =>
    `/execute in minecraft:${p.dim === "nether" ? "the_nether" : "overworld"} run tp @s ${p.x} ${p.y} ${p.z}`
  ).join("\n");
}

function renderExport() {
  $("#coords-out").textContent = coordText();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function addPortal(dim) {
  pushUndo();
  const id = "p" + nextId++;
  // Default a new portal to the arrival spot of an existing portal in the
  // other dimension, so fresh pairs start out linked instead of at 0,0.
  let x = 0, y = 64, z = 0;
  const other = state.portals.find((p) => p.dim !== dim);
  if (other) {
    const t = targetFrom(blocksOf(other)[0], other.dim);
    x = t.x; y = t.y; z = t.z;
  }
  state.portals.push({
    id, name: (dim === "nether" ? "Nether portal " : "Overworld portal ") + id.slice(1),
    dim, x, y, z, axis: "x", locked: false, minY: null, maxY: null,
  });
  render();
}

$("#add-overworld").addEventListener("click", () => addPortal("overworld"));
$("#add-nether").addEventListener("click", () => addPortal("nether"));

$("#pair-a").addEventListener("change", renderPairSelectors);

function addLinkPair(bothWays) {
  const a = $("#pair-a").value, b = $("#pair-b").value;
  const pa = state.portals.find((p) => p.id === a);
  const pb = state.portals.find((p) => p.id === b);
  if (!pa || !pb || pa.dim === pb.dim) return;
  pushUndo();
  const has = (f, t) => state.links.some((l) => l.from === f && l.to === t);
  if (!has(a, b)) state.links.push({ from: a, to: b });
  if (bothWays && !has(b, a)) state.links.push({ from: b, to: a });
  render();
}
$("#pair-btn").addEventListener("click", () => addLinkPair(true));
$("#pair-one").addEventListener("click", () => addLinkPair(false));

$("#edition").addEventListener("change", (e) => {
  state.edition = e.target.value;
  render();
});

$("#preset").addEventListener("change", (e) => {
  if (!e.target.value) return;
  if (state.portals.length) pushUndo();
  state = structuredClone(PRESETS[e.target.value]);
  syncNextId();
  e.target.value = "";
  render();
});

function clearAll() {
  if (state.portals.length) pushUndo();
  state = { edition: state.edition, portals: [], links: [] };
  render();
}
$("#clear").addEventListener("click", clearAll);
$("#banner-clear").addEventListener("click", clearAll);

$("#undo").addEventListener("click", () => {
  if (!undoStack.length) return;
  state = JSON.parse(undoStack.pop());
  syncNextId();
  render();
});

$("#share").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "?s=" + serializeState(state);
  history.replaceState(null, "", url);
  await copy(url, $("#share"), "Copy share link");
});

$("#solve").addEventListener("click", () => {
  const out = $("#solver-output");
  const sol = solve(state.portals, state.links, state.edition);
  if (!sol.ok) {
    out.innerHTML = `<p class="sol-fail">No solution: ${escapeHtml(sol.reason)}</p>`;
    return;
  }
  pushUndo();
  state.portals = sol.portals;
  const moved = sol.portals.filter((p) => sol.moved.includes(p.id))
    .map((p) => `${escapeHtml(p.name)} → (${p.x}, ${p.y}, ${p.z})`).join("; ");
  render();
  out.innerHTML = `<p class="sol-ok">Solved. Worst-case slack across all connections: ${sol.score.toFixed(1)} blocks, standing position included. Moved: ${moved || "nothing (already optimal)"}. Return trips re-checked. Press Undo to revert.</p>`;
});

$("#copy-coords").addEventListener("click", (e) => copy(coordText(), e.target, "Copy coordinates"));
$("#copy-tp").addEventListener("click", (e) => copy(tpText(), e.target, "Copy /tp commands"));

// Quick convert (header): scaled coordinates without building a scenario.
function runQuickConvert() {
  const dim = $("#qc-dim").value;
  const t = targetFrom({ x: num($("#qc-x").value), y: 0, z: num($("#qc-z").value) }, dim);
  $("#qc-out").textContent = `${dim === "overworld" ? "Nether" : "Overworld"} X ${t.x}, Z ${t.z}`;
}
for (const id of ["#qc-dim", "#qc-x", "#qc-z"]) $(id).addEventListener("input", runQuickConvert);

async function copy(text, btn, label) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied";
  } catch {
    btn.textContent = "Copy failed";
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtPt(t) {
  return `(${t.x}, ${t.y}, ${t.z})`;
}

// ---------------------------------------------------------------------------
state = loadInitialState();
syncNextId();
runQuickConvert();
render();
