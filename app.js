import {
  SEARCH, blocksOf, targetFrom, resolveTrips, tripMargin, verifyAll,
  strayWarnings, solve, serializeState, deserializeState, isCandidate,
} from "./engine.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = { edition: "java", portals: [], links: [] };
let nextId = 1;

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

function loadInitialState() {
  const q = new URLSearchParams(location.search).get("s");
  if (q) {
    try { return deserializeState(q); } catch { /* fall through */ }
  }
  const saved = localStorage.getItem("portal-planner-state");
  if (saved) {
    try { return JSON.parse(saved); } catch { /* fall through */ }
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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);

function render() {
  persist();
  $("#edition").value = state.edition;
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

function renderPortals() {
  const list = $("#portal-list");
  list.innerHTML = "";
  for (const p of state.portals) {
    const card = document.createElement("div");
    card.className = "portal-card " + p.dim;
    card.innerHTML = `
      <div class="row">
        <span class="dim-tag">${p.dim === "nether" ? "NETHER" : "OVERWORLD"}</span>
        <input type="text" data-f="name" value="${escapeHtml(p.name)}" aria-label="Portal name">
        <label><input type="checkbox" data-f="locked" ${p.locked ? "checked" : ""}> locked</label>
        <button class="del" data-del title="Delete portal">✕</button>
      </div>
      <div class="row">
        <label>X <input type="number" data-f="x" value="${p.x}"></label>
        <label>Y <input type="number" data-f="y" value="${p.y}"></label>
        <label>Z <input type="number" data-f="z" value="${p.z}"></label>
        <label>frame along
          <select data-f="axis"><option value="x" ${p.axis === "x" ? "selected" : ""}>X</option><option value="z" ${p.axis === "z" ? "selected" : ""}>Z</option></select>
        </label>
      </div>
      <div class="row">
        <label>Y constraint: min <input type="number" data-f="minY" value="${p.minY ?? ""}" placeholder="—" ${p.locked ? "disabled" : ""}></label>
        <label>max <input type="number" data-f="maxY" value="${p.maxY ?? ""}" placeholder="—" ${p.locked ? "disabled" : ""}></label>
      </div>`;
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
    card.querySelector("[data-del]").addEventListener("click", () => {
      state.portals = state.portals.filter((q) => q.id !== p.id);
      state.links = state.links.filter((l) => l.from !== p.id && l.to !== p.id);
      render();
    });
    list.appendChild(card);
  }
  // pair selectors
  for (const sel of [$("#pair-a"), $("#pair-b")]) {
    const cur = sel.value;
    sel.innerHTML = state.portals.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }
}

function renderLinks() {
  const list = $("#link-list");
  list.innerHTML = "";
  state.links.forEach((l, i) => {
    const row = document.createElement("div");
    row.className = "link-row";
    const opts = (sel) => state.portals.map((p) =>
      `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${escapeHtml(p.name)} (${p.dim})</option>`).join("");
    row.innerHTML = `<select data-e="from">${opts(l.from)}</select> →
      <select data-e="to">${opts(l.to)}</select>
      <button data-del title="Remove link">✕</button>`;
    row.addEventListener("change", (e) => {
      const f = e.target.dataset.e;
      if (f) { l[f] = e.target.value; render(); }
    });
    row.querySelector("[data-del]").addEventListener("click", () => {
      state.links.splice(i, 1);
      render();
    });
    list.appendChild(row);
  });
}

function statusWord(s) {
  return s === "green" ? "✔ SAFE" : s === "yellow" ? "⚠ FRAGILE" : "✘ BROKEN";
}

function renderVerification() {
  const out = $("#verify-output");
  out.innerHTML = "";
  const results = verifyAll(state.portals, state.links, state.edition);
  if (results.length === 0) {
    out.innerHTML = `<p class="hint">Add portals and desired links to see the simulation.</p>`;
    return;
  }
  for (const r of results) {
    const div = document.createElement("div");
    div.className = "verdict " + r.status;
    const nominal = r.trips[0];
    let headline;
    if (nominal.result === "NEW_PORTAL") {
      headline = `<span class="red-t">${escapeHtml(r.src.name)} → NEW PORTAL WOULD SPAWN</span> at ${fmtPt(nominal.target)} (no candidate within ±${nominal.radius})`;
    } else if (nominal.winner.id === r.dst.id) {
      const m = r.minMargin === Infinity ? "unopposed" : `margin ${r.minMargin.toFixed(1)} blocks`;
      const wobble = r.allCorrect ? "wobble-safe" : "BREAKS under ±1 wobble";
      headline = `<span class="${r.status}-t">${statusWord(r.status)}</span> ${escapeHtml(r.src.name)} → ${escapeHtml(r.dst.name)} (${m}, ${wobble})`;
    } else {
      headline = `<span class="red-t">${statusWord(r.status)}</span> ${escapeHtml(r.src.name)} → hijacked by <strong>${escapeHtml(nominal.winner.name)}</strong> (wanted ${escapeHtml(r.dst.name)})`;
    }
    const tripRows = r.trips.map((t) => {
      const cand = t.cands.map((c) =>
        `${escapeHtml(c.portal.name)} @ ${c.dist.toFixed(1)}`).join(", ") || "—";
      const excl = t.excluded.map((e) =>
        `${escapeHtml(e.portal.name)} (+${e.outside} outside)`).join(", ") || "—";
      const win = t.result === "LINK" ? escapeHtml(t.winner.name) : "NEW PORTAL";
      const mg = tripMargin(t);
      return `<tr><td>(${t.entry.x}, ${t.entry.y}, ${t.entry.z})</td><td>${fmtPt(t.target)}</td>
        <td>${cand}</td><td>${excl}</td><td>${win}</td>
        <td>${mg ? mg.margin.toFixed(1) + " (" + mg.kind + " vs " + escapeHtml(mg.against.name) + ")" : "—"}</td></tr>`;
    }).join("");
    div.innerHTML = `<div class="headline">${headline}</div>
      <details><summary>trip detail (both wobble variants)</summary>
      <table><tr><th>entity at</th><th>target</th><th>candidates (3D dist)</th><th>excluded (blocks outside square)</th><th>winner</th><th>margin</th></tr>${tripRows}</table>
      </details>`;
    out.appendChild(div);
  }
  // stray-portal warnings
  const warn = $("#warnings");
  warn.innerHTML = "";
  for (const w of strayWarnings(state.portals, state.links, state.edition)) {
    const d = document.createElement("p");
    d.className = "warning";
    d.textContent = `⚠ "${w.intruder.name}" is a candidate in "${w.source.name}"'s search square (${w.dist.toFixed(1)} blocks from target) but is not its intended destination. If this portal shouldn't exist (stale/auto-generated), remember to demolish it in-game too.`;
    warn.appendChild(d);
  }
}

// ---------------------------------------------------------------------------
// Maps (SVG, one panel per dimension, 8:1 true relative scale)
// ---------------------------------------------------------------------------
function renderMaps() {
  const container = $("#maps");
  container.innerHTML = "";
  const dims = ["overworld", "nether"];
  // Gather geometry per dimension: portals, targets (+search squares), links.
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
  // Bounds per dim (portals + squares), then force 8:1 scale ratio.
  const bounds = {};
  for (const d of dims) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const eat = (x, z) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };
    for (const p of geo[d].portals) eat(p.x, p.z);
    for (const { t, radius } of geo[d].targets) { eat(t.x - radius, t.z - radius); eat(t.x + radius, t.z + radius); }
    if (minX === Infinity) { eat(-10, -10); eat(10, 10); }
    const pad = Math.max(6, (maxX - minX) * 0.08);
    bounds[d] = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
  }
  const W = 640;
  const spanN = Math.max(bounds.nether.maxX - bounds.nether.minX, 1);
  const spanO = Math.max(bounds.overworld.maxX - bounds.overworld.minX, 1);
  // scale (px per block): nether scale is 8× overworld scale.
  const scaleN = Math.min(W / spanN, (W / spanO) * 8, 14);
  const scaleO = scaleN / 8;
  const scales = { nether: scaleN, overworld: scaleO };

  for (const d of dims) {
    const b = bounds[d], s = scales[d];
    const w = (b.maxX - b.minX) * s, h = Math.max((b.maxZ - b.minZ) * s, 40);
    const X = (x) => (x - b.minX) * s;
    const Z = (z) => (z - b.minZ) * s;
    let svg = `<svg viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-height:420px">`;
    // search squares
    for (const { t, radius, srcId } of geo[d].targets) {
      svg += `<rect class="search-square" data-square-src="${srcId}" x="${X(t.x - radius)}" y="${Z(t.z - radius)}" width="${2 * radius * s}" height="${2 * radius * s}"/>`;
    }
    // arrows
    for (const a of geo[d].arrows) {
      svg += `<line class="link-arrow ${a.good ? "good" : "bad"}" x1="${X(a.from.x)}" y1="${Z(a.from.z)}" x2="${X(a.to.x)}" y2="${Z(a.to.z)}" stroke-width="1.5" marker-end="url(#arr-${d})"/>`;
    }
    // target crosshairs
    for (const { t } of geo[d].targets) {
      const c = 5;
      svg += `<g stroke="#fbbf24" stroke-width="1.2">
        <line x1="${X(t.x) - c}" y1="${Z(t.z)}" x2="${X(t.x) + c}" y2="${Z(t.z)}"/>
        <line x1="${X(t.x)}" y1="${Z(t.z) - c}" x2="${X(t.x)}" y2="${Z(t.z) + c}"/></g>`;
    }
    // portals
    for (const p of geo[d].portals) {
      const color = d === "nether" ? "#ef4444" : "#a855f7";
      svg += `<g class="portal-marker" data-portal="${p.id}">
        <rect x="${X(p.x) - 4}" y="${Z(p.z) - 4}" width="8" height="8" rx="1.5" fill="${color}" stroke="#fff" stroke-width="${p.locked ? 1.6 : 0.6}"/>
        <text x="${X(p.x) + 7}" y="${Z(p.z) + 4}" font-size="11" fill="#e8e2f4">${escapeHtml(p.name)}${p.locked ? " 🔒" : ""}</text></g>`;
    }
    svg += `<defs><marker id="arr-${d}" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6" fill="none" stroke="context-stroke" stroke-width="1.2"/></marker></defs></svg>`;
    const wrap = document.createElement("div");
    wrap.className = "map-wrap";
    wrap.innerHTML = `<h3>${d === "nether" ? "Nether" : "Overworld"} — 1 block = ${s.toFixed(2)} px · squares = search areas · ✛ = scaled targets</h3>${svg}`;
    container.appendChild(wrap);
  }

  // Hover: highlight every search square the hovered portal is a candidate in.
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
  const id = "p" + nextId++;
  state.portals.push({
    id, name: (dim === "nether" ? "Nether portal " : "Overworld portal ") + id.slice(1),
    dim, x: 0, y: dim === "nether" ? 64 : 64, z: 0, axis: "x", locked: false, minY: null, maxY: null,
  });
  render();
}

$("#add-overworld").addEventListener("click", () => addPortal("overworld"));
$("#add-nether").addEventListener("click", () => addPortal("nether"));

$("#add-link").addEventListener("click", () => {
  if (state.portals.length < 2) return;
  state.links.push({ from: state.portals[0].id, to: state.portals[state.portals.length - 1].id });
  render();
});

$("#pair-btn").addEventListener("click", () => {
  const a = $("#pair-a").value, b = $("#pair-b").value;
  if (!a || !b || a === b) return;
  const has = (f, t) => state.links.some((l) => l.from === f && l.to === t);
  if (!has(a, b)) state.links.push({ from: a, to: b });
  if (!has(b, a)) state.links.push({ from: b, to: a });
  render();
});

$("#edition").addEventListener("change", (e) => {
  state.edition = e.target.value;
  render();
});

$("#preset").addEventListener("change", (e) => {
  if (!e.target.value) return;
  state = structuredClone(PRESETS[e.target.value]);
  syncNextId();
  e.target.value = "";
  render();
});

$("#clear").addEventListener("click", () => {
  state = { edition: state.edition, portals: [], links: [] };
  render();
});

$("#share").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "?s=" + serializeState(state);
  history.replaceState(null, "", url);
  await copy(url, $("#share"), "🔗 Copy share link");
});

$("#solve").addEventListener("click", () => {
  const out = $("#solver-output");
  const sol = solve(state.portals, state.links, state.edition);
  if (!sol.ok) {
    out.innerHTML = `<p class="sol-fail">✘ No solution: ${escapeHtml(sol.reason)}</p>`;
    return;
  }
  state.portals = sol.portals;
  const moved = sol.portals.filter((p) => sol.moved.includes(p.id))
    .map((p) => `${escapeHtml(p.name)} → (${p.x}, ${p.y}, ${p.z})`).join("; ");
  render();
  out.innerHTML = `<p class="sol-ok">✔ Solved with worst-case margin ${sol.score.toFixed(1)} blocks (wobble included). Moved: ${moved || "nothing (already optimal)"}. Return trips re-verified.</p>`;
});

$("#copy-coords").addEventListener("click", (e) => copy(coordText(), e.target, "📋 Copy coordinates"));
$("#copy-tp").addEventListener("click", (e) => copy(tpText(), e.target, "📋 Copy /tp commands"));

async function copy(text, btn, label) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "✓ Copied!";
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
render();
