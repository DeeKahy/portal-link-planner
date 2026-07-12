// Unit tests for the resolver, using the spec's verified worked example.
// Run: node test/test.mjs
import {
  targetFrom, resolveTrips, verifyAll, solve, serializeState, deserializeState,
} from "../engine.js";

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log("  ok  " + msg);
  else { failures++; console.error("FAIL  " + msg); }
}

// --- floor semantics for negative coordinates -------------------------------
const t1 = targetFrom({ x: 814, y: 87, z: -2513 }, "overworld");
assert(t1.x === 101 && t1.z === -315, `floor(-2513/8) = -315 → target ${t1.x},${t1.z}`);
const t2 = targetFrom({ x: 828, y: 87, z: -2471 }, "overworld");
assert(t2.x === 103 && t2.z === -309, `pretty target → ${t2.x},${t2.z}`);

// --- worked example: storage/pretty + roof/below -----------------------------
const portals = [
  { id: "storage", name: "Storage", dim: "overworld", x: 814, y: 87, z: -2513, axis: "x", locked: true },
  { id: "pretty",  name: "Pretty",  dim: "overworld", x: 828, y: 87, z: -2471, axis: "x", locked: true },
  { id: "roof",    name: "Roof",    dim: "nether",    x: 101, y: 128, z: -315, axis: "x", locked: true },
  { id: "below",   name: "Below",   dim: "nether",    x: 103, y: 87,  z: -296, axis: "x", locked: true },
];
const links = [
  { from: "storage", to: "roof" },
  { from: "pretty", to: "below" },
  { from: "roof", to: "storage" },
  { from: "below", to: "pretty" },
];

const results = verifyAll(portals, links, "java");
for (const r of results) {
  assert(r.allCorrect, `${r.src.name} → ${r.dst.name} links correctly in all wobble variants`);
  assert(r.status === "green", `${r.src.name} → ${r.dst.name} is green (margin ${r.minMargin.toFixed(1)})`);
}

// storage→roof must win by exclusion: below is outside the ±16 square (ΔZ=19).
const st = resolveTrips(portals[0], portals, "java")[0];
assert(st.winner.id === "roof", "storage resolves to roof");
assert(st.cands.length === 1, "below is excluded from storage's square");
const belowExcl = st.excluded.find((e) => e.portal.id === "below");
assert(belowExcl && belowExcl.outside === 3, `below sits 3 blocks outside the square (got ${belowExcl?.outside})`);

// pretty→below wins on distance: 13.0 vs ≈41.5.
const pt = resolveTrips(portals[1], portals, "java")[0];
assert(pt.winner.id === "below", "pretty resolves to below");
const dists = pt.cands.map((c) => c.dist.toFixed(1)).join(" vs ");
assert(Math.abs(pt.cands[0].dist - 13.0) < 0.05 && Math.abs(pt.cands[1].dist - 41.5) < 0.1,
  `pretty distances 13.0 vs 41.5 (got ${dists})`);

// roof→storage: 42.0 vs 66.9.
const rt = resolveTrips(portals[2], portals, "java")[0];
assert(rt.winner.id === "storage", "roof resolves to storage");
assert(Math.abs(rt.cands[0].dist - 42.0) < 0.1 && Math.abs(rt.cands[1].dist - 66.9) < 0.1,
  `roof distances 42.0 vs 66.9 (got ${rt.cands.map((c) => c.dist.toFixed(1)).join(" vs ")})`);

// below→pretty: storage excluded from the ±128 return square (ΔZ=145).
const bt = resolveTrips(portals[3], portals, "java")[0];
assert(bt.winner.id === "pretty", "below resolves to pretty");
assert(!bt.cands.some((c) => c.portal.id === "storage"), "storage excluded from below's return square");
const stExcl = bt.excluded.find((e) => e.portal.id === "storage");
assert(stExcl && stExcl.outside === 17, `storage 17 blocks outside return square (ΔZ=145>128, got ${stExcl?.outside})`);

// --- naive placement causes link-stealing (the problem the app solves) -------
const naive = portals.map((p) => p.id === "below" ? { ...p, z: -309 } : p);
const naiveStorage = verifyAll(naive, links, "java").find((r) => r.src.id === "storage");
assert(naiveStorage.status === "red" || naiveStorage.minMargin < 3,
  "naive below placement (on-target) breaks or endangers storage→roof");

// --- solver reproduces a valid plan from locked overworld portals ------------
const toSolve = [
  { id: "storage", name: "Storage", dim: "overworld", x: 814, y: 87, z: -2513, axis: "x", locked: true },
  { id: "pretty",  name: "Pretty",  dim: "overworld", x: 828, y: 87, z: -2471, axis: "x", locked: true },
  { id: "roof",    name: "Roof",    dim: "nether",    x: 0, y: 128, z: 0, axis: "x", locked: false, minY: 128, maxY: 128 },
  { id: "below",   name: "Below",   dim: "nether",    x: 0, y: 87,  z: 0, axis: "x", locked: false, minY: 70, maxY: 122 },
];
const sol = solve(toSolve, links, "java");
assert(sol.ok, "solver finds a valid plan");
if (sol.ok) {
  for (const r of sol.results) {
    assert(r.allCorrect, `solver plan: ${r.src.name} → ${r.dst.name} verifies (margin ${r.minMargin.toFixed(1)})`);
  }
  const roof = sol.portals.find((p) => p.id === "roof");
  console.log("  solver placed roof at", roof.x, roof.y, roof.z,
    "and below at", ...["x", "y", "z"].map((k) => sol.portals.find((p) => p.id === "below")[k]));
}

// --- legacy mode: exclusion impossible for these, distance dominance needed ---
const legacySol = solve(toSolve, links, "legacy");
console.log("  legacy solver:", legacySol.ok ? `ok, margin ${legacySol.score.toFixed(1)}` : legacySol.reason);

// --- per-axis locks: pin only Y of the roof portal --------------------------
const axisLocked = [
  { id: "storage", name: "Storage", dim: "overworld", x: 814, y: 87, z: -2513, axis: "x", lock: { x: true, y: true, z: true } },
  { id: "pretty",  name: "Pretty",  dim: "overworld", x: 828, y: 87, z: -2471, axis: "x", lock: { x: true, y: true, z: true } },
  { id: "roof",    name: "Roof",    dim: "nether",    x: 0, y: 128, z: 0, axis: "x", lock: { x: false, y: true, z: false } },
  { id: "below",   name: "Below",   dim: "nether",    x: 0, y: 87,  z: 0, axis: "x", lock: { x: false, y: false, z: false }, maxY: 122 },
];
const axisSol = solve(axisLocked, links, "java");
assert(axisSol.ok, "solver works with per-axis locks");
if (axisSol.ok) {
  const roof = axisSol.portals.find((p) => p.id === "roof");
  assert(roof.y === 128, `Y-locked roof portal stays at 128 (got ${roof.y})`);
  assert(axisSol.results.every((r) => r.allCorrect), "per-axis-lock plan verifies");
}
// A portal with X and Z locked but Y free: solver may only slide it vertically.
const xzLocked = axisLocked.map((p) => p.id === "below" ? { ...p, x: 103, z: -296, y: 100, lock: { x: true, y: false, z: true }, maxY: null } : p);
const xzSol = solve(xzLocked, links, "java");
if (xzSol.ok) {
  const below = xzSol.portals.find((p) => p.id === "below");
  assert(below.x === 103 && below.z === -296, `XZ-locked portal kept its X/Z (got ${below.x},${below.z})`);
} else {
  console.log("  xz-locked case unsolvable (acceptable):", xzSol.reason);
}

// --- serialization round-trip -------------------------------------------------
globalThis.btoa ??= (s) => Buffer.from(s, "binary").toString("base64");
globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");
const state = { edition: "java", portals, links };
const rt2 = deserializeState(serializeState(state));
assert(JSON.stringify(rt2.portals.map((p) => [p.x, p.y, p.z, p.dim])) ===
       JSON.stringify(portals.map((p) => [p.x, p.y, p.z, p.dim])), "serialize/deserialize round-trips");
// Legacy locked booleans become full per-axis locks.
assert(rt2.portals[0].lock.x && rt2.portals[0].lock.y && rt2.portals[0].lock.z,
  "legacy locked flag round-trips as all-axes lock");
// Partial locks survive a v2 round-trip.
const rt3 = deserializeState(serializeState({ edition: "java", links: [], portals: [
  { id: "a", name: "A", dim: "nether", x: 1, y: 128, z: 3, axis: "x", lock: { x: false, y: true, z: false }, minY: null, maxY: null },
] }));
assert(!rt3.portals[0].lock.x && rt3.portals[0].lock.y && !rt3.portals[0].lock.z,
  "per-axis locks survive serialization");

console.log(failures ? `\n${failures} FAILURES` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
