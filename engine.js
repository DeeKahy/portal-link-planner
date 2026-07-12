// Portal Link Planner, core domain logic.
// Models Minecraft nether-portal linking (Java 1.16+ and Bedrock/legacy).
// Pure functions, no DOM, imported by both the UI (app.js) and the tests.

export const SEARCH = {
  java:   { nether: 16,  overworld: 128 },
  legacy: { nether: 128, overworld: 128 },
};

export function otherDim(dim) {
  return dim === "overworld" ? "nether" : "overworld";
}

// A portal is stored as its bottom-two portal blocks: one corner + orientation.
// { id, name, dim, x, y, z, axis: "x"|"z", lock: {x,y,z}, minY, maxY }
// Older states carry a single boolean `locked` instead of per-axis `lock`;
// locksOf() normalizes both forms.
export function locksOf(p) {
  if (p.lock && typeof p.lock === "object") {
    return { x: !!p.lock.x, y: !!p.lock.y, z: !!p.lock.z };
  }
  return p.locked ? { x: true, y: true, z: true } : { x: false, y: false, z: false };
}
export function blocksOf(p) {
  return p.axis === "x"
    ? [{ x: p.x, y: p.y, z: p.z }, { x: p.x + 1, y: p.y, z: p.z }]
    : [{ x: p.x, y: p.y, z: p.z }, { x: p.x, y: p.y, z: p.z + 1 }];
}

// Scaled destination point for an entity standing at `pos` in `dim`.
// Math.floor handles negatives correctly: floor(-2513/8) = -315.
export function targetFrom(pos, dim) {
  return dim === "overworld"
    ? { x: Math.floor(pos.x / 8), y: pos.y, z: Math.floor(pos.z / 8), dim: "nether" }
    : { x: pos.x * 8, y: pos.y, z: pos.z * 8, dim: "overworld" };
}

export function nearestBlockDist(p, t) {
  let best = Infinity;
  for (const b of blocksOf(p)) {
    const d = Math.hypot(b.x - t.x, b.y - t.y, b.z - t.z);
    if (d < best) best = d;
  }
  return best;
}

// Chebyshev distance (XZ only) from a target to a portal's nearest block -
// used for candidacy and for exclusion margins.
export function chebXZ(p, t) {
  let best = Infinity;
  for (const b of blocksOf(p)) {
    const d = Math.max(Math.abs(b.x - t.x), Math.abs(b.z - t.z));
    if (d < best) best = d;
  }
  return best;
}

export function isCandidate(p, t, radius) {
  return p.dim === t.dim && chebXZ(p, t) <= radius;
}

// Resolve one trip from an entity at `pos` in `srcDim`.
export function resolveFromPos(pos, srcDim, portals, edition) {
  const t = targetFrom(pos, srcDim);
  const radius = SEARCH[edition][t.dim];
  const cands = portals
    .filter((p) => isCandidate(p, t, radius))
    .map((p) => ({ portal: p, dist: nearestBlockDist(p, t) }))
    .sort((a, b) => a.dist - b.dist);
  const excluded = portals
    .filter((p) => p.dim === t.dim && !isCandidate(p, t, radius))
    .map((p) => ({ portal: p, outside: chebXZ(p, t) - radius }));
  if (cands.length === 0) return { result: "NEW_PORTAL", target: t, radius, cands, excluded };
  return { result: "LINK", target: t, radius, winner: cands[0].portal, cands, excluded };
}

// All wobble variants of a source portal's trip: the entity can stand in
// either block column of the 2-wide frame, shifting the computed target.
export function resolveTrips(source, portals, edition) {
  const others = portals.filter((p) => p.id !== source.id);
  return blocksOf(source).map((entry) => ({
    entry,
    ...resolveFromPos(entry, source.dim, others, edition),
  }));
}

// Safety margin of a resolved trip against every competing portal:
//  - excluded competitor: blocks outside the search square (Chebyshev excess)
//  - candidate competitor: 3D-distance gap to the winner
// Returns { margin, kind, against } for the tightest competitor, or null if unopposed.
export function tripMargin(trip) {
  if (trip.result !== "LINK") return null;
  let worst = null;
  for (const c of trip.cands.slice(1)) {
    const m = { margin: c.dist - trip.cands[0].dist, kind: "distance", against: c.portal };
    if (!worst || m.margin < worst.margin) worst = m;
  }
  for (const e of trip.excluded) {
    const m = { margin: e.outside, kind: "exclusion", against: e.portal };
    if (!worst || m.margin < worst.margin) worst = m;
  }
  return worst;
}

// Check one desired link (src portal id -> dst portal id) across all wobble
// variants. Status: "green" (right winner everywhere, margin >= 3),
// "yellow" (right nominal winner but tight or wobble-broken), "red" (wrong
// winner or new-portal spawn on the nominal trip).
export function checkLink(link, portals, edition) {
  const src = portals.find((p) => p.id === link.from);
  const dst = portals.find((p) => p.id === link.to);
  if (!src || !dst) return null;
  const trips = resolveTrips(src, portals, edition);
  let allCorrect = true;
  let anyCorrect = false;
  let minMargin = Infinity;
  for (const trip of trips) {
    const ok = trip.result === "LINK" && trip.winner.id === dst.id;
    if (ok) anyCorrect = true; else allCorrect = false;
    const m = tripMargin(trip);
    if (ok && m) minMargin = Math.min(minMargin, m.margin);
  }
  const nominalOk = trips[0].result === "LINK" && trips[0].winner.id === dst.id;
  let status;
  if (!nominalOk) status = "red";
  else if (allCorrect && (minMargin === Infinity || minMargin >= 3)) status = "green";
  else status = "yellow";
  return { link, src, dst, trips, status, allCorrect, anyCorrect, nominalOk, minMargin };
}

export function verifyAll(portals, links, edition) {
  return links.map((l) => checkLink(l, portals, edition)).filter(Boolean);
}

// Stray-portal warning: any portal that is a candidate for some trip but is
// not the desired destination of that trip.
export function strayWarnings(portals, links, edition) {
  const warnings = [];
  for (const link of links) {
    const src = portals.find((p) => p.id === link.from);
    if (!src) continue;
    for (const trip of resolveTrips(src, portals, edition)) {
      for (const c of trip.cands) {
        if (c.portal.id !== link.to) {
          warnings.push({ source: src, intruder: c.portal, dist: c.dist, link });
        }
      }
    }
  }
  // dedupe by (source, intruder)
  const seen = new Set();
  return warnings.filter((w) => {
    const k = w.source.id + "|" + w.intruder.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Solver: propose coordinates for movable portals.
// Brute-force grid around each movable portal's own target, scored by the
// worst margin across every trip of every desired link (wobble included).
// Coordinate descent over the movable portals, a few passes.
// ---------------------------------------------------------------------------

function anchorTargetFor(portal, portals, links) {
  // The target of the first portal that wants to link TO this one.
  for (const l of links) {
    if (l.to === portal.id) {
      const src = portals.find((p) => p.id === l.from);
      if (src) return targetFrom(blocksOf(src)[0], src.dim);
    }
  }
  // Fall back: this portal links somewhere; sit near the scaled-back position.
  for (const l of links) {
    if (l.from === portal.id) {
      const dst = portals.find((p) => p.id === l.to);
      if (dst) return targetFrom(blocksOf(dst)[0], dst.dim);
    }
  }
  return null;
}

function scorePlacement(portals, links, edition) {
  // Overall plan score = min margin across all links; wrong link = -1000.
  let worst = Infinity;
  for (const r of verifyAll(portals, links, edition)) {
    if (!r.allCorrect) return -1000;
    const m = r.minMargin === Infinity ? 100 : r.minMargin;
    worst = Math.min(worst, m);
  }
  return worst === Infinity ? 100 : worst;
}

function rangeAround(center, radius, step) {
  const out = [];
  for (let d = -radius; d <= radius; d += step) out.push(center + d);
  return out;
}

export function solve(portals, links, edition) {
  const work = portals.map((p) => ({ ...p }));
  // Movable = involved in a link and at least one coordinate is unlocked.
  const movable = work.filter((p) => {
    const lk = locksOf(p);
    return !(lk.x && lk.y && lk.z) && links.some((l) => l.from === p.id || l.to === p.id);
  });
  if (movable.length === 0) {
    return { ok: false, reason: "No movable portals involved in any desired link.", portals: work };
  }

  // Initialize each movable portal at its anchor target, respecting per-axis
  // locks and Y constraints.
  for (const m of movable) {
    const t = anchorTargetFor(m, work, links);
    if (t) {
      const lk = locksOf(m);
      if (!lk.x) m.x = t.x;
      if (!lk.z) m.z = t.z;
      if (!lk.y) m.y = clampY(t.y, m);
    }
  }

  const passes = movable.length > 1 ? 3 : 2;
  for (let pass = 0; pass < passes; pass++) {
    for (const m of movable) {
      const anchor = anchorTargetFor(m, work, links);
      if (!anchor) continue;
      const lk = locksOf(m);
      const radius = SEARCH[edition][m.dim];
      const step = radius > 20 ? 4 : 1;
      const xs = lk.x ? [m.x] : rangeAround(anchor.x, radius, step);
      const zs = lk.z ? [m.z] : rangeAround(anchor.z, radius, step);
      const yOptions = lk.y ? [m.y] : yCandidates(anchor.y, m);
      let best = { score: -Infinity, x: m.x, y: m.y, z: m.z, off: Infinity };
      const consider = (x, y, z) => {
        m.x = x; m.y = y; m.z = z;
        const s = scorePlacement(work, links, edition);
        const off = Math.abs(x - anchor.x) + Math.abs(z - anchor.z);
        // Prefer higher margin (capped so huge margins don't drag portals far
        // off-target), then smaller offset from the ideal spot.
        const capped = Math.min(s, 25);
        if (capped > best.score + 1e-9 || (Math.abs(capped - best.score) < 1e-9 && off < best.off)) {
          best = { score: capped, x, y, z, off };
        }
      };
      for (const x of xs) for (const z of zs) for (const y of yOptions) consider(x, y, z);
      // Local refinement around the coarse best when we stepped > 1.
      if (step > 1) {
        const rxs = lk.x ? [best.x] : rangeAround(best.x, step, 1).filter((x) => Math.abs(x - anchor.x) <= radius);
        const rzs = lk.z ? [best.z] : rangeAround(best.z, step, 1).filter((z) => Math.abs(z - anchor.z) <= radius);
        for (const x of rxs) for (const z of rzs) for (const y of yOptions) consider(x, y, z);
      }
      m.x = best.x; m.y = best.y; m.z = best.z;
    }
  }

  const finalScore = scorePlacement(work, links, edition);
  const results = verifyAll(work, links, edition);
  if (finalScore <= -1000) {
    return { ok: false, reason: explainFailure(work, links, edition), portals: work, results };
  }
  return { ok: true, score: finalScore, portals: work, results, moved: movable.map((m) => m.id) };
}

function clampY(y, p) {
  const lo = p.minY ?? -Infinity;
  const hi = p.maxY ?? Infinity;
  return Math.max(lo, Math.min(hi, y));
}

function yCandidates(anchorY, p) {
  const set = new Set([clampY(anchorY, p)]);
  if (p.minY != null) set.add(p.minY);
  if (p.maxY != null) set.add(p.maxY);
  return [...set];
}

function explainFailure(portals, links, edition) {
  // Find the failing link and describe the binding constraint.
  for (const r of verifyAll(portals, links, edition)) {
    if (r.allCorrect) continue;
    const trip = r.trips.find((t) => !(t.result === "LINK" && t.winner.id === r.dst.id)) || r.trips[0];
    if (trip.result === "NEW_PORTAL") {
      return `"${r.src.name}" finds no candidate near its target ${fmtT(trip.target)}, ` +
        `so a new portal would spawn. "${r.dst.name}" must sit within ${trip.radius} blocks (X/Z) of that target.`;
    }
    const hijacker = trip.winner;
    const wanted = trip.cands.find((c) => c.portal.id === r.dst.id);
    const hj = trip.cands[0];
    return `"${r.src.name}" links to "${hijacker.name}" instead of "${r.dst.name}": at target ${fmtT(trip.target)}, ` +
      `"${hijacker.name}" is ${hj.dist.toFixed(1)} blocks away vs ` +
      `${wanted ? wanted.dist.toFixed(1) + " blocks" : "not a candidate at all"} for "${r.dst.name}". ` +
      `No placement inside the ${trip.radius}-block search zone separates them. Move the locked portals further apart, ` +
      `or add a height offset to win on 3D distance.`;
  }
  return "No valid placement found within the search zones and constraints.";
}

function fmtT(t) {
  return `(${t.x}, ${t.y}, ${t.z})`;
}

// ---------------------------------------------------------------------------
// State (de)serialization for share links / localStorage.
// ---------------------------------------------------------------------------

export function serializeState(state) {
  const compact = {
    v: 2,
    e: state.edition,
    p: state.portals.map((p) => {
      const lk = locksOf(p);
      const bits = (lk.x ? 1 : 0) | (lk.y ? 2 : 0) | (lk.z ? 4 : 0);
      return [p.id, p.name, p.dim === "nether" ? 1 : 0, p.x, p.y, p.z, p.axis === "z" ? 1 : 0, bits, p.minY ?? "", p.maxY ?? ""];
    }),
    l: state.links.map((l) => [l.from, l.to]),
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(compact)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deserializeState(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const json = decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad)));
  const c = JSON.parse(json);
  const v2 = c.v === 2;
  return {
    edition: c.e === "legacy" ? "legacy" : "java",
    portals: c.p.map((a) => {
      // v1 links stored a single locked boolean; v2 stores per-axis bits.
      const bits = v2 ? (+a[7] || 0) : (a[7] ? 7 : 0);
      return {
        id: a[0], name: String(a[1]), dim: a[2] ? "nether" : "overworld",
        x: +a[3], y: +a[4], z: +a[5], axis: a[6] ? "z" : "x",
        lock: { x: !!(bits & 1), y: !!(bits & 2), z: !!(bits & 4) },
        minY: a[8] === "" ? null : +a[8], maxY: a[9] === "" ? null : +a[9],
      };
    }),
    links: c.l.map((a) => ({ from: a[0], to: a[1] })),
  };
}
