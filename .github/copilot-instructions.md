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

### Resolution/Camera Safety Rules (CRITICAL)

When changing graphics quality or resolution behavior, maintain all of the following:

1. Camera distance must be consistent across viewport size and DPR.
2. Camera distance must be consistent across quality settings (`high`/`medium`/`low`).
3. Distance should remain calibrated to legacy 1920x1080 behavior.

Current contract in `racer.html`:

- Resolution scaling: `sizeBackbufferToViewport()` sets `canvas.width/height` from `scaled * dpr * qualityMult`.
- Camera scale source: `baseDisplayScaleRef.current = canvas.width / BASE_WORLD_W`.
- Camera zoom baseline: `computeCameraZoom()` uses
  `CAM_BASE_ZOOM * cameraDistanceRef.current * baseDisplayScaleRef.current * CAMERA_SCALE_NORMALIZER`.

Do not regress to older formulas:

- Do not divide camera zoom by display scale.
- Do not add a second quality compensation term (for example an extra `pixelRatio` zoom multiplier).

React closure caveat:

- The frame loop is inside `useEffect(..., [trackName])`. Camera/zoom values used inside the loop must come from refs (`cameraDistanceRef`, `zoomMaxDeltaRef`, `zoomResponseRateRef`, `zoomStartSpeedRef`, `zoomFullSpeedRef`) so runtime slider changes take effect immediately.

Quick verification after edits:

1. Hard reload (or bump `CACHE_VERSION` in `service-worker.js`) before testing.
2. In race, move "Camera distance" slider and confirm zoom changes instantly.
3. Switch quality high/medium/low and verify same camera distance.
4. Resize viewport (or test different devices) and verify same camera distance.
5. Open `tests/resolution_test.html` and run the camera test.

### Error Handling
- Defensive checks with fallbacks: `const value = stored ?? DEFAULT`
- localStorage/IndexedDB access wrapped in try-catch
- Console warnings for non-critical failures

---

## How to Add/Modify Features

### Adding a New Vehicle

To add a new vehicle with a PNG sprite to the game, follow ALL these steps:

#### 1. Prepare the Vehicle Sprite
- Place PNG file in `assets/vehicles/` (e.g., `MyNewCar.png`)
- Sprite should be a top-down view of the vehicle
- **CRITICAL**: Do NOT include a dark oval shadow in the sprite — shadows are rendered separately

**⚠️ IMPORTANT - Vehicle Sizing:**
The game renders a dark oval shadow under non-sprite vehicles (see line ~5171 in `racer.html`). When you exclude a vehicle from shadow rendering (step 4g below), you MUST compensate by making the sprite dimensions LARGER in `CarProfiles` to maintain visual size parity.

**Rule of thumb**: If your sprite has no shadow/ground effect baked in, make the `width` and `length` in `CarProfiles` approximately **40-50% larger** than the sprite's actual car body dimensions to compensate for the missing shadow visual bulk.

**Example**: The Rallycross sprite actual car is small, but CarProfiles has `width: 26, length: 48` (not 18×34) to match the visual size of cars with shadows. Compare to GT which has shadow: `width: 24, length: 45`.


#### 2. Update `racer_start_menu.html`
Add entry to `VEHICLES` array (~line 2790):

```javascript
{
  id: 'MyNewCar',           // Must match physics.js and racer.html
  name: 'My New Car',        // Display name in menu
  class: 'newclass',         // Vehicle class (gt, rally, truck, etc.)
  icon: '<img src="assets/vehicles/MyNewCar.png" alt="My New Car">'
}
```

#### 3. Update `physics.js`
Add to `VEHICLE_DEFAULTS` object (~line 131):

```javascript
MyNewCar: {
  ...PLANCK_DEFAULTS,
  mass: 2.20,                    // Vehicle mass
  wheelbase: 34,                 // Distance between axles
  cgToFront: 16,                 // CG to front axle
  cgToRear: 18,                  // CG to rear axle
  enginePowerMult: 1.65,         // Engine power multiplier
},
```

#### 4. Update `racer.html` - Multiple Changes Required

**4a. Add to CarProfiles (~line 1370)**
```javascript
"MyNewCar": { 
  width: 18,              // Visual width
  length: 34,             // Visual length
  colliderWidth: 18,      // Physics hitbox width
  colliderLength: 34,     // Physics hitbox length
  maxK: 0.95,             // Max speed multiplier
  accelK: 1.05,           // Acceleration multiplier
  brakeK: 1.05,           // Braking multiplier
  turnK: 1.15,            // Turning multiplier
  color: "#2e7d32"        // Fallback color if sprite fails
},
```

**4b. Load sprite (~line 1388)**
```javascript
const myNewCarSprite = loadSpriteAsset("mynewcar", "assets/vehicles/MyNewCar.png");
```

**4c. Add to warmup sprite checks (~line 4881)**
Add sprite to BOTH sprite readiness checks:
```javascript
let spritesReady = [clipperSprite, truckSprite, bubbleSprite, rallycrossSprite, myNewCarSprite].every(
  img => !img || (img.complete && img.naturalWidth > 0)
);
```

**4d. Add warmup draw call (~line 4909)**
```javascript
if (myNewCarSprite && myNewCarSprite.complete) {
  ctx.drawImage(myNewCarSprite, -99999, -99999, 1, 1);
}
```

**4e. Create draw functions (~line 5382+)**
```javascript
function drawMyNewCarSprite() {
  const img = myNewCarSprite;
  if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return false;
  const drawLength = L;
  const aspect = img.naturalWidth / img.naturalHeight;
  const drawWidth = drawLength * aspect;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, -drawWidth / 2, -drawLength / 2, drawWidth, drawLength);
  ctx.restore();
  return true;
}

function drawMyNewCar() {
  if (drawMyNewCarSprite()) return;
  drawGT(); // Fallback if sprite not ready
}
```

**4f. Update drawCarDetailed switch (~line 5380)**
```javascript
case 'MyNewCar': drawMyNewCar(); break;
```

**4g. CRITICAL: Shadow exclusion (~line 5110)**
Add vehicle to shadow exclusion to prevent dark oval:
```javascript
if (!(car.kind === 'Truck' || car.kind === 'Bubble' || car.kind === 'Rallycross' || car.kind === 'MyNewCar' || clipperReady)) {
  // Shadow rendering code...
}
```

#### 5. Update `service-worker.js` (Optional)
Add sprite to `CORE_ASSETS` for offline caching:
```javascript
'./assets/vehicles/MyNewCar.png',
```

#### 6. AI Spawning Behavior
**NO CHANGES NEEDED** — AI spawning adapts automatically:
- **Class-specific modes** (GT Class, Rally Class, etc.): All AI cars match player's vehicle
- **Mixed mode** (`mode: 'grip'`): AI randomly selects from ALL `CarProfiles` keys

The `getRandomCarKind()` function (~line 4765) uses `Object.keys(CarProfiles)`, so new vehicles are auto-included.

#### Testing Checklist
1. Start server: `npx http-server -p 8080 .`
2. Open `http://localhost:8080/racer_start_menu.html`
3. Verify:
   - ✅ Vehicle appears in selection menu
   - ✅ Sprite renders correctly in-game
   - ✅ NO dark oval shadow appears
   - ✅ Physics feel appropriate
   - ✅ In Mixed mode, vehicle appears randomly among AI

#### Common Issues
- **Sprite not showing**: Check console for 404, verify file path case-sensitivity
- **Dark shadow visible**: Missing shadow exclusion in step 4g
- **AI all same type in Mixed**: Check `isMixedMode()` detects `mode === 'grip'`
- **Collision issues**: Adjust `colliderWidth`/`colliderLength` to match visual bounds

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
- **Logic & Braking**: See [AI Racer Logic & Tuning](../docs/ai-racer-logic-and-tuning.md) for details on speed sanitization and physics-based braking.

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
6. **Camera/resolution regressions are easy to miss with stale cache** — if behavior seems unchanged after code edits, force a cache-busting reload before debugging formulas

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
