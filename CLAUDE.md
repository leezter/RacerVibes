# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RacingVibes is a browser-based top-down racing game with PWA support. Uses vanilla JavaScript, React 18 (via CDN), Babel (CDN for JSX), and Planck.js 0.3.0 (Box2D port) for physics. No build system required - static HTML/JS served directly.

## Running Locally

```powershell
# Python 3
python -m http.server 8080

# Node.js
npx http-server -p 8080 .
```

Open: `http://localhost:8080/racer_start_menu.html`

## Linting & Formatting

```bash
npx eslint . --ext .js
npx prettier --write .
```

Prettier config: 100 char width, single quotes, trailing commas, semicolons.

## Testing

Manual testing only - no automated test suite. Open `tests/test_runner.html` or `tests/vehicle_test_runner.html` in browser.

Additional targeted suites now exist for decor/stadium geometry:

- `node tests/decor_stadium_geometry_tests.js`
- `tests/decor_stadium_test_runner.html` (browser matrix runner)

## Architecture

### Entry Flow
1. `racer_start_menu.html` - Vehicle/track/AI selection
2. Selection stored in `sessionStorage.RACER_START_PAYLOAD`
3. `racer.html` reads payload and initializes game (5700+ lines inline JS/JSX)

### Module System (Hybrid)
- **IIFEs** (most files): Attach to `window` object, no imports
- **ES Modules**: `physics.js`, `trackCollision.js`, `gearbox.js`, `physics/planckWorld.js`, `src/gearbox.js`
- Script load order matters - `planck.min.js` must load before physics modules

### Global APIs (on `window`)
| API | Source | Purpose |
|-----|--------|---------|
| `RacerPhysics` | `physics.js` | Car physics, Planck world, dev tools |
| `RacerAI` | `ai/racer_ai.js` | Racing line computation, AI controllers |
| `TrackStore` | `track_storage.js` | Custom track CRUD (IndexedDB) |
| `RacerModes` | `modes/registry.js` | Game mode registration |
| `RacerUtils` | `utils/utils.js` | `clamp`, `lerp`, `once`, `toRad` |

### Key Config Objects
- `VEHICLE_DEFAULTS` in `physics.js` - per-vehicle physics params
- `SKILL_PRESETS` in `ai/racer_ai.js` - AI difficulty levels (easy, medium, hard, realistic)
- `CarProfiles` in `racer.html` - rendering dimensions per vehicle
- `AI_RECOVERY_CFG` in `racer.html` (~line 612) - stuck/wrong-way AI behavior
- `GEARBOX_CONFIG` in `src/gearbox.js` - drivetrain params

## Physics Notes

- All values in **pixel-space**, not SI units
- Gravity: ~750 px/s² (not 9.8 m/s²)
- `pixelsPerMeter = 30` for Planck.js conversion
- Top speed relationship: `sqrt(enginePowerMult / dragK)`
- Mobile uses lower physics iterations for performance

## Resolution & Camera Contract (Critical)

When changing render resolution or graphics quality in `racer.html`, preserve these invariants:

1. **Camera distance must be screen-size invariant** (same world-space distance on different viewport sizes/DPRs).
2. **Camera distance must be quality invariant** (same at low/medium/high graphics quality).
3. **1920x1080 legacy distance is the calibration baseline**.

Implementation details that must stay aligned:

- Resolution scaling happens in `sizeBackbufferToViewport()` via:
  - `canvas.width/height = scaled * dpr * qualityMult` (with caps)
- Camera scaling depends on **actual backbuffer width**:
  - `baseDisplayScaleRef.current = canvas.width / BASE_WORLD_W`
- Camera zoom baseline in `computeCameraZoom()`:
  - `zoomBase = CAM_BASE_ZOOM * cameraDistance * baseDisplayScale * CAMERA_SCALE_NORMALIZER`
  - `CAMERA_SCALE_NORMALIZER` preserves the old 1920x1080 behavior.

Do **not** reintroduce prior broken patterns:

- Do not divide zoom by display scale for camera distance.
- Do not apply a separate `pixelRatio` multiplier to camera zoom to "compensate" quality.

Live update caveat:

- The frame loop is created inside a `useEffect(..., [trackName])`, so camera/zoom settings read in-frame must use refs (`cameraDistanceRef`, `zoom*Ref`) to avoid stale closures.

## Coding Conventions

- **Files**: `snake_case.js` for scripts, `camelCase.js` in `src/`
- **Functions/Variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE` for config objects
- **Patterns**: IIFEs for browser globals, factory functions over classes, config objects for tunable params
- **JSX**: Only works in `<script type="text/babel">` blocks

## Common Gotchas

1. JSX requires `type="text/babel"` script tags
2. Physics uses pixels, not meters - don't mix units
3. Service worker caching - bump `CACHE_VERSION` in `service-worker.js` after asset changes
4. Script order matters - dependencies must load before dependents
5. **Chrome GPU canvas issue**: Stadium shadows in `decor_generator.js` cause Chrome (Windows, hardware acceleration ON) to silently lose canvas content. Stadium shadows are currently **disabled** (commented out at line ~1720). Other shadows work fine. Don't re-enable without thorough Chrome testing.
6. **Camera/resolution changes can appear "ignored" if stale JS is cached**: hard reload and/or bump `CACHE_VERSION` before judging camera behavior.

## Stadium Buildings Status (As Of February 13, 2026)

This section is for future AI agents. Stadium/building density behavior was revised so in-game controls now have an observable impact.

### Current Architecture

- The active "buildings" system is stadium generation in `decor_generator.js` (`createStadiums` + `drawStadiums`).
- Legacy block buildings (`createBuildings` / `drawBuildings`) are intentionally disabled in runtime output:
  - metadata stores `buildings: []`
  - `drawBuildings(...)` is commented out in replay path.
- Stadium placement source is `innerWalls` from `createInnerWalls(...)`, not the deprecated standalone building layer.

### Current Runtime Cache/Versioning

- Decor metadata version currently expected by generator reuse logic: `version >= 8`.
- Service worker cache version was bumped to force asset refresh:
  - `service-worker.js` -> `CACHE_VERSION = 'rv-static-v20260213-stadium-facing-v1'`
- If gameplay appears unchanged after code edits, assume stale service worker cache first.

### What Has Been Tried

- Added deterministic outer-path sanitization for spikes/self-intersections.
- Added endpoint locking/orientation cleanup for outer stadium boundary.
- Added robust self-intersection cleanup and fallback polygon candidates.
- Re-enabled legacy small buildings briefly, then removed again because it created detached, incorrect block artifacts.
- Added coverage-oriented run tuning (shallower depth thresholds, shorter run thresholds, short-gap bridging).
- Added explicit wall-coverage checks in automated and browser decor runners.

### Known Struggles / Failure Modes Encountered

- **Synthetic pass vs gameplay fail mismatch**:
  - Geometry tests and browser runner can pass while in-game visuals still look sparse.
  - The user reports "no visible increase" despite passing matrix tests.
- **Aggressive depth expansion regressions**:
  - Using road-mask-driven depth expansion created oversized stadium polygons that overlapped drivable track.
- **Over-merged runs**:
  - Large gap-bridging created a few very large stadiums instead of many edge-following segments.
- **Detached legacy blocks**:
  - Reintroducing old `createBuildings` path did not match intended stadium behavior and was rejected.

### Current Practical Interpretation

- `buildingDensity` now directly affects stadium segmentation (`createStadiums` splits long wall runs by density and adjusts gap-bridging).
- Stadium orientation now uses `roadMask` side-scoring so `innerPoints` consistently face the track (prevents backwards-facing stands).
- Runtime decor generation now uses Dev-panel decor sliders (with quality multipliers), instead of fixed quality presets.
- In-game decor debug overlay is available from Dev > Scales > Decor (`Decor debug overlay`) and shows stadium count, wall coverage, lengths, depth/area, density, and seed.
- Automated tests now include stadium density responsiveness checks and baseline regeneration support (`UPDATE_STADIUM_BASELINE=1`).

### If You Pick This Up Again (Recommended Next Steps)

1. Compare `racer.html` overlay metrics with `tests/decor_stadium_test_runner.html` for the same track/seed/scale when tuning thresholds.
2. Keep service worker cache/version bumps mandatory whenever `decor_generator.js` changes.
3. If stadium density perception regresses, tune `targetStadiumLength`, `minChunkLength`, and `deepMaskGapPoints` in `createStadiums`.
4. Do not re-enable legacy small-block building rendering unless explicitly requested.

## Adding Features

### New Vehicle
1. Add to `VEHICLE_DEFAULTS` in `physics.js`
2. Add to `CarProfiles` in `racer.html`
3. Add sprite to `assets/vehicles/`
4. Update `CORE_ASSETS` in `service-worker.js`
5. Optionally add gearbox ratios in `src/gearbox.js`

### New Game Mode
Create `modes/mymode.js`:
```js
(function(global) {
  global.RacerModes.register({
    id: 'mymode',
    label: 'My Mode',
    ai: { defaultDifficulty: 'medium' }
  });
})(window);
```
Include after `modes/registry.js` in `racer.html`.

## Dev Tools

- In-game "Dev" button (top-left) for physics tuning panel
- `RacerPhysics.injectDevTools(getCars)` - runtime parameter adjustment
- Collider overlay toggle for debugging hitboxes

## Documentation

- `docs/ai-racer-logic-and-tuning.md` - Racing line algorithm, speed/grip logic, tuning
- `docs/AI_CONTROLS_REFERENCE.md` - Control system details
- `docs/TIME_TRIAL_GHOST.md` - Ghost/replay system
