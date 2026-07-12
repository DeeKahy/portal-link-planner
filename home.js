// Landing-page logic: quick converter + two-portal link checker.
// The heavy lifting (search squares, 3D winner, wobble) lives in engine.js.
import { targetFrom, resolveTrips, SEARCH } from "./engine.js";

// Old share links pointed at / with ?s=… — the full editor now lives on advanced.html.
if (new URLSearchParams(location.search).has("s")) {
  location.replace("advanced.html" + location.search);
}

const $ = (s) => document.querySelector(s);
const num = (id) => {
  const n = parseInt($(id).value, 10);
  return isNaN(n) ? 0 : n;
};

// ---------------------------------------------------------------------------
// Calculator: "where should I build?"
// ---------------------------------------------------------------------------
let calcDim = "overworld";

function runCalc() {
  const pos = { x: num("#calc-x"), y: num("#calc-y"), z: num("#calc-z") };
  const t = targetFrom(pos, calcDim);
  const out = $("#calc-out");
  const there = calcDim === "overworld" ? "Nether" : "Overworld";
  const emoji = calcDim === "overworld" ? "🔥" : "🌳";
  out.innerHTML = `Build your ${there} portal at ${emoji}
    <div class="coords">X: ${t.x} &nbsp; Y: ~${t.y} &nbsp; Z: ${t.z}</div>
    <div class="why">${calcDim === "overworld"
      ? "That's your X and Z divided by 8 (rounded down). Y isn't scaled — build at a similar height if you can."
      : "That's your X and Z multiplied by 8. Y isn't scaled — build at a similar height if you can."}
      Build there and your portals will link perfectly, both ways.</div>`;
  out.dataset.coords = `${t.x} ${t.y} ${t.z}`;
}

$("#calc-dir").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  calcDim = btn.dataset.dir;
  $("#calc-dir").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
  runCalc();
});
for (const id of ["#calc-x", "#calc-y", "#calc-z"]) $(id).addEventListener("input", runCalc);
$("#calc-copy").addEventListener("click", async (e) => {
  try {
    await navigator.clipboard.writeText($("#calc-out").dataset.coords || "");
    e.target.textContent = "✓ Copied!";
  } catch { e.target.textContent = "Copy failed"; }
  setTimeout(() => (e.target.textContent = "📋 Copy coordinates"), 1500);
});

// ---------------------------------------------------------------------------
// Checker: "will my two portals link?"
// ---------------------------------------------------------------------------
function checkPair() {
  const edition = $("#edition").value;
  const ow = { id: "ow", name: "Overworld portal", dim: "overworld", x: num("#ow-x"), y: num("#ow-y"), z: num("#ow-z"), axis: "x", locked: true };
  const ne = { id: "ne", name: "Nether portal", dim: "nether", x: num("#ne-x"), y: num("#ne-y"), z: num("#ne-z"), axis: "x", locked: true };
  const portals = [ow, ne];
  const out = $("#check-out");
  out.innerHTML = "";
  out.appendChild(directionVerdict(ow, ne, portals, edition, "🌳 → 🔥 Going to the Nether"));
  out.appendChild(directionVerdict(ne, ow, portals, edition, "🔥 → 🌳 Coming back home"));
}

function directionVerdict(src, dst, portals, edition, title) {
  const trips = resolveTrips(src, portals, edition);
  const nominal = trips[0];
  const radius = SEARCH[edition][nominal.target.dim];
  const div = document.createElement("div");

  const okTrips = trips.filter((t) => t.result === "LINK" && t.winner.id === dst.id).length;
  if (okTrips === trips.length) {
    const d = nominal.cands[0].dist;
    div.className = "verdict-card ok";
    div.innerHTML = `<div class="v-title">${title}: ✅ links!</div>
      <p>You'll arrive at your ${dst.name.toLowerCase()} — it's ${d.toFixed(1)} blocks from the arrival spot, comfortably inside the ±${radius} search zone.</p>
      <p class="detail">Checked from both standing positions in the frame — solid either way.</p>`;
  } else if (okTrips > 0) {
    div.className = "verdict-card warn";
    div.innerHTML = `<div class="v-title">${title}: ⚠️ fragile</div>
      <p>It works from one side of the portal frame but <strong>breaks if you stand on the other side</strong> — the arrival spot shifts just enough to miss the ±${radius} zone.</p>
      <p class="detail">Move the destination portal 2–3 blocks deeper inside the zone to make it bulletproof.</p>`;
  } else {
    const t = nominal.target;
    const excess = nominal.excluded.length ? Math.min(...nominal.excluded.map((e) => e.outside)) : null;
    div.className = "verdict-card bad";
    div.innerHTML = `<div class="v-title">${title}: ❌ won't link</div>
      <p>The game will look for a portal within <strong>±${radius} blocks (sideways)</strong> of <strong>(${t.x}, ${t.z})</strong> and find nothing${excess != null ? ` — yours is ${excess} block${excess === 1 ? "" : "s"} outside that zone` : ""}. A <strong>brand-new portal will spawn</strong> instead. 😱</p>
      <p class="detail">Perfect spot: <strong>X ${t.x}, Y ~${t.y}, Z ${t.z}</strong> — or anywhere within ±${radius > 16 ? radius - 3 : 13} blocks of it sideways.</p>
      <button class="mini" data-fix="${dst.id}" data-x="${t.x}" data-y="${t.y}" data-z="${t.z}">✨ Fix it for me</button>`;
    div.querySelector("[data-fix]").addEventListener("click", (e) => {
      const p = e.target.dataset.fix === "ne" ? "#ne-" : "#ow-";
      $(p + "x").value = e.target.dataset.x;
      $(p + "y").value = e.target.dataset.y;
      $(p + "z").value = e.target.dataset.z;
      checkPair();
    });
  }
  return div;
}

$("#check-btn").addEventListener("click", checkPair);
$("#edition").addEventListener("change", () => {
  if ($("#check-out").children.length) checkPair();
});

runCalc();
