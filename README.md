# Portal Link Planner

**Live at [portals.smallapp.cc](https://portals.smallapp.cc/)**

A client-side web app that helps Minecraft players plan Nether portal placements so portals link the way they intend, including "locking" scenarios where some portals are fixed and others can be moved, and where multiple portal pairs are close enough to steal each other's links (e.g. a nether-roof portal plus a normal portal serving nearby Overworld bases).

No backend, no build step: plain HTML/CSS/JS on a single page. All math runs in the browser; state persists in `localStorage` and can be shared via URL. The page also includes an illustrated guide to how portal linking works.

## What it models

The real portal-linking rules for Java Edition 1.16+ (with a Bedrock / pre-1.16 toggle):

1. **No stored links**: every trip recalculates the destination from scratch.
2. **Coordinate scaling**: Overworld→Nether `(floor(x/8), y, floor(z/8))`, Nether→Overworld `(x×8, y, z×8)`. Y never scales. Floor semantics handle negatives correctly (`floor(−2513/8) = −315`).
3. **Candidate search**: a Chebyshev *square* around the target: ±16 in the Nether, ±128 in the Overworld (±128 both in legacy mode). The full Y column is searched.
4. **Winner selection**: smallest 3D Euclidean distance to the target among candidate portal *blocks*. No candidates → a new portal spawns (flagged as an error state).
5. **Target wobble**: the player stands somewhere in a 2-wide frame, so targets shift ±1 in X/Z; the verifier checks every variant.

Two ways to guarantee portal A beats portal B: **exclusion** (B outside the search square, strongest, achievable in Java's ±16 Nether) and **distance dominance** (A is 3D-closer, e.g. via a big Y handicap on a roof portal). Both directions of every link are checked, the ×8 return-trip amplification trap is the classic failure mode.

## Features

- **Portal editor**: any number of portals, locked/movable, Y constraints, frame orientation, directed link pairs.
- **Verifier**: simulates every trip: target, candidate set with distances, winner, margins, wobble-safety. Green/yellow/red verdicts plus stale-portal warnings.
- **Solver**: proposes coordinates for movable portals: exclusion placement with a wobble buffer where possible, distance-dominance fallback otherwise, with return trips re-verified. Explains the binding constraint when no solution exists.
- **Map**: top-down SVG per dimension at true 8:1 relative scale: search squares, targets, resolved links (green = intended, red = hijacked), hover to see where a portal competes.
- **QoL**: presets (including a real verified link-stealing scenario), copy coordinates / `/tp` commands, shareable URLs, collapsible mechanics explainer.

## Development

Open `index.html` in a browser (or `python3 -m http.server`). Run the tests with:

```
node test/test.mjs
```

The test fixture is the worked example from the spec: two locked Overworld portals whose Nether targets are only 6.3 blocks apart, solved with a roof portal (exclusion + Y handicap) and an offset below-roof portal.

## License

MIT
