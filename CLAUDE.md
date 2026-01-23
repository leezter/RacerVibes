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
