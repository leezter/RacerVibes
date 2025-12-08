# RacingVibes - AI Agent Instructions

## Project Overview

Browser-based top-down racing game with PWA support for Android. Uses vanilla JavaScript, React (via CDN), and Planck.js (Box2D) for physics. Single-page entry points with inline game logic.

**Tech Stack:**
- **Frontend**: Vanilla JS + React 18 (CDN) + Babel (CDN for JSX)
- **Physics**: Planck.js 0.3.0 (Box2D port)
- **Storage**: IndexedDB (custom tracks), localStorage (settings)
- **PWA**: Service worker + manifest for offline/installable support

---

## Folder Structure

```
RacingVibes/
├── racer_start_menu.html   # Main entry - vehicle/track selection
├── racer.html              # Game runtime (5700+ lines inline JS/JSX)
├── physics.js              # Car physics + Planck integration (ES module)
├── gearbox.js              # Re-exports from src/gearbox.js
├── trackCollision.js       # Track boundary collision bodies (ES module)
├── track_editor.js         # Visual track editor (IIFE)
├── track_storage.js        # IndexedDB wrapper for custom tracks (IIFE)
├── track_builder.js        # Track geometry utilities
├── decor_generator.js      # Procedural scenery generation (IIFE)
├── service-worker.js       # PWA caching
├── manifest.webmanifest    # PWA manifest
│
├── ai/
│   └── racer_ai.js         # AI racing line + controller (IIFE → window.RacerAI)
│
├── modes/
│   ├── registry.js         # Game mode registry (IIFE → window.RacerModes)
│   └── grip.js             # Default "Grip" mode definition
│
├── physics/
│   └── planckWorld.js      # Planck.js world creation helpers (ES module)
│
├── src/
│   └── gearbox.js          # Core drivetrain/transmission model (ES module)
│
├── ui/
│   └── speedometer.js      # SVG speedometer component (IIFE)
│
├── utils/
│   ├── utils.js            # Shared helpers: clamp, lerp, once (IIFE → window.RacerUtils)
│   ├── storage-utils.js    # IndexedDB availability check (IIFE)
│   └── mode-utils.js       # Mode key helpers (IIFE)
│
├── assets/
│   ├── decor/              # decor_atlas.png (trees, kerbs, barriers)
│   └── vehicles/           # Car sprites (truck_orange.png, ClipperGT.png)
│
└── icons/                  # PWA icons (192px, 512px)
```

---

## Architecture

### Entry Flow
1. `racer_start_menu.html` → User selects vehicle, track, AI count
2. Selection stored in `sessionStorage` as `RACER_START_PAYLOAD`
3. Navigates to `racer.html` which reads payload and initializes game

### Global APIs (exposed on `window`)
| API | Source | Purpose |
|-----|--------|---------|
| `RacerPhysics` | `physics.js` | Car physics, Planck world, dev tools |
| `RacerAI` | `ai/racer_ai.js` | Racing line computation, AI controllers |
| `TrackStore` | `track_storage.js` | Custom track CRUD (IndexedDB) |
| `RacerModes` | `modes/registry.js` | Game mode registration |
| `RacerUtils` | `utils/utils.js` | `clamp`, `lerp`, `once`, `toRad` |
| `PlanckWorld` | `physics/planckWorld.js` | World creation, unit conversion |

### Module System
- **IIFEs** (most files): Attach to `window`, no import/export
- **ES Modules**: `physics.js`, `trackCollision.js`, `gearbox.js`, `physics/planckWorld.js`, `src/gearbox.js`
- Script load order matters — `planck.min.js` must load before `physics.js`

---

## Key Components

### Physics (`physics.js`)
- Hybrid tire model + Planck.js rigid-body collisions
- All values in **pixel-space** (not SI units); `pixelsPerMeter = 30` for Planck conversion
- `VEHICLE_DEFAULTS` defines per-vehicle params: F1, GT, Rally, Truck

```js
// Key physics params per vehicle
{
  mass, wheelbase, cgToFront, cgToRear,
  enginePowerMult, brakeForce, maxSteer, steerSpeed,
  muLatRoad, muLongRoad, dragK, rollK, downforceK,
  longSlipPeak, longSlipFalloff, frontCircle, rearCircle
}
```

### Car Profiles (`racer.html`)
Rendering dimensions and multipliers (separate from physics):

```js
const CarProfiles = {
  "F1":    { width: 18, length: 44, colliderWidth: 18, colliderLength: 44, ... },
  "GT":    { width: 24, length: 45, colliderWidth: 20, colliderLength: 39, ... },
  "Rally": { width: 18, length: 34, ... },
  "Truck": { width: 29, length: 60, ... }
};
```

### Gearbox (`src/gearbox.js`)
Drivetrain simulation with torque curves:
- `GEARBOX_CONFIG`: redlineRpm, finalDrive, tireRadiusM, shiftCutMs
- `torqueCurve(rpm, throttle, params)` — engine output model
- `Gearbox` class — gear state, auto/manual shifting

### AI System (`ai/racer_ai.js`)
- `SKILL_PRESETS`: `easy`, `medium`, `hard` — tuning for throttle, braking, steering PD gains
- Racing line: `resample()` → `smooth()` → curvature analysis
- Controller uses PD steering with speed-scaled lookahead

### AI Recovery (`racer.html` - `AI_RECOVERY_CFG`)
Handles stuck/wrong-way AI cars. Key params:
- `stuckSpeed`, `stuckTime` — when to trigger recovery
- `reverseSwitch`, `reverseDuration` — turn vs reverse timing
- `exitDot`, `exitSpeed` — when recovery ends

### Track Editor (`track_editor.js`)
- `TrackEditor.create({ onSaved, onTestDrive })`
- Stores tracks via `TrackStore` with `id`, `name`, `points`, `updatedAt`
- Custom tracks referenced as `"custom:<id>"`

---

## Coding Conventions

### Naming
- **Files**: `snake_case.js` for scripts, `camelCase.js` in `src/`
- **Functions/Variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE` for config objects
- **Classes**: `PascalCase` (rare — mostly factory functions)

### Formatting
Configured in `.prettierrc`:
```json
{ "semi": true, "singleQuote": true, "trailingComma": "all", "printWidth": 100 }
```

### Patterns
- **IIFEs** for browser globals: `(function(global){ ... })(window);`
- **Factory functions** over classes: `TrackEditor.create()`, `createController()`
- **Config objects** for tunable params: `AI_RECOVERY_CFG`, `SKILL_PRESETS`, `VEHICLE_DEFAULTS`
- **Inline JSX** in `racer.html` via `<script type="text/babel">`

### Error Handling
- Defensive checks with fallbacks: `const value = stored ?? DEFAULT`
- localStorage/IndexedDB access wrapped in try-catch
- Console warnings for non-critical failures

---

## How to Add/Modify Features

### Adding a New Vehicle
1. **Physics**: Add entry to `VEHICLE_DEFAULTS` in `physics.js`
2. **Rendering**: Add to `CarProfiles` in `racer.html`
3. **Sprite**: Add image to `assets/vehicles/`
4. **Caching**: Update `CORE_ASSETS` in `service-worker.js`
5. **Gearbox** (optional): Add ratios to `gearboxDefaults` in `src/gearbox.js`

### Adding a New Game Mode
1. Create `modes/mymode.js`:
```js
(function(global) {
  global.RacerModes.register({
    id: 'mymode',
    label: 'My Mode',
    ai: { defaultDifficulty: 'medium' }
  });
})(window);
```
2. Include script in `racer.html` after `modes/registry.js`

### Tuning AI Behavior
- **Difficulty**: Edit `SKILL_PRESETS` in `ai/racer_ai.js`
- **Recovery**: Edit `AI_RECOVERY_CFG` in `racer.html` (~line 612)
- **Collision avoidance**: Edit `AI_COLLISION_AVOIDANCE_CFG` in `racer.html`

### Tuning Vehicle Physics
Edit `VEHICLE_DEFAULTS` in `physics.js`. Key relationships:
- Top speed ∝ `sqrt(enginePowerMult / dragK)`
- To change acceleration without affecting top speed: scale `enginePowerMult` and `dragK` by same factor

---

## Running Locally

```powershell
# Python 3
python -m http.server 8080

# Node
npx http-server -p 8080 .
```

Open: `http://localhost:8080/racer_start_menu.html`

---

## Common Gotchas

1. **JSX only works in `type="text/babel"` scripts** — React/Babel loaded via CDN
2. **Physics in pixels** — gravity ~750 px/s², not 9.8 m/s²
3. **Script order matters** — `planck.min.js` → `physics.js`
4. **Service worker caching** — bump `CACHE_VERSION` in `service-worker.js` after asset changes
5. **Mobile testing** — use Dev Tools gyro emulation or real device on same network

---

## Dev Tools

- **In-game**: Click "Dev" button (top-left) for physics tuning panel
- `RacerPhysics.injectDevTools(getCars)` — runtime parameter adjustment
- `RacerPhysics.injectVehicleTweaker(bridge, getCars)` — art/collider adjustment
- Collider overlay toggle in dev menu for debugging hitboxes

---

## Testing

- **Manual only** — no automated test suite
- Test on desktop (keyboard) and mobile (touch HUD + gyro)
- Use Dev Tools panel for real-time physics tuning
- Test custom tracks via Track Editor → Test Drive

---

## Keeping This Document Updated

**Important for AI agents**: After making significant changes to the codebase, update this document to reflect:

1. **New files/modules**: Add to folder structure and describe purpose
2. **New global APIs**: Add to the APIs table
3. **Config changes**: Update relevant config object documentation
4. **New patterns**: Document in Coding Conventions if introducing new approaches
5. **Breaking changes**: Note any gotchas or migration steps

Run a quick diff check: if you've added/renamed files, changed major config objects, or introduced new architectural patterns, this document needs updating
