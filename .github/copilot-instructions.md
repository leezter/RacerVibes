# RacingVibes - AI Agent Instructions

## Project Overview
Browser-based top-down racing game with PWA support for Android. Single HTML entry points (`racer_start_menu.html` → `racer.html`) with vanilla JS, React via CDN, and Planck.js (Box2D) physics.

## Architecture

### Core Data Flow
1. **Entry**: `racer_start_menu.html` → selects vehicle/track → launches `racer.html`
2. **Physics loop** (`racer.html`):
   - `planckBeginStep(dt, cars)` → `updatePlayer()/updateAI()` → `planckStep()` → render
3. **Global APIs** exposed on `window`:
   - `RacerPhysics` (physics.js) - car physics, Planck integration, dev tools
   - `RacerAI` (ai/racer_ai.js) - racing line computation & AI controllers
   - `TrackStore` (track_storage.js) - IndexedDB persistence for custom tracks
   - `RacerModes` (modes/registry.js) - game mode registry
   - `RacerUtils` (utils/utils.js) - shared helpers (clamp, lerp, once)

### Physics System (`physics.js`)
- Hybrid: custom tire model + Planck.js rigid-body collisions
- `VEHICLE_DEFAULTS` object defines per-vehicle physics params (GT, F1, Rally, Truck)
- Key functions: `initCar(car, kind)`, `updateCar(car, input, surface, dt)`
- Planck world managed via `planckState` object; use `rebuildPlanckWorld()` after track changes
- All physics in **pixel-space** (not meters); `pixelsPerMeter` (default 30) converts for Planck

### Module System
- Most files are IIFEs attaching to `window` (not ES modules)
- Exceptions: `physics.js`, `trackCollision.js`, `gearbox.js` use ES module imports
- `gearbox.js` re-exports from `src/gearbox.js` - drivetrain/transmission simulation

### Game Modes (`modes/`)
```js
// Register a mode
RacerModes.register({ id: 'grip', label: 'Grip', ai: { defaultDifficulty: 'hard' } });
RacerModes.setDefault('grip');
```

## Key Patterns

### Adding a New Vehicle Type
1. Add entry to `VEHICLE_DEFAULTS` in `physics.js` with physics params
2. Add to `CarProfiles` in `racer.html` with rendering/art dimensions
3. Add sprite to `assets/vehicles/` and update `service-worker.js` cache list

### Touch/Mobile Controls
- Touch HUD defined in `racer.html` (`.btn.left`, `.btn.right`, `.btn.thr`, `.btn.brk`)
- Motion steering via DeviceOrientation (enabled on first tap)
- Portrait orientation shows warning overlay

### Track System
- Built-in tracks defined inline in `racer.html` (`loadTrack()` function)
- Custom tracks saved to IndexedDB via `TrackStore`
- Track editor in `track_editor.js`, opened from start menu

### Dev Tools
- `RacerPhysics.injectDevTools(getCars)` adds runtime tuning panel
- `RacerPhysics.injectVehicleTweaker(bridge, getCars)` for art/collider adjustment

### AI System (`ai/racer_ai.js`)
- `SKILL_PRESETS` defines difficulty levels: `easy`, `medium`, `hard`
- Key tuning params: `maxThrottle`, `brakeAggro`, `steerP/D`, `lookaheadBase`, `cornerMargin`
- Racing line computed via `resample()` → `smooth()` → curvature analysis
- `MAX_TARGET_SPEED` (2600 px/s) caps AI target speeds

### Gearbox/Drivetrain (`src/gearbox.js`)
Core transmission simulation with realistic torque curves:
- `GEARBOX_CONFIG`: global defaults (redlineRpm, finalDrive, tireRadiusM, shiftCutMs)
- `gearboxDefaults`: per-vehicle ratios and shift points
- `torqueCurve(rpm, throttle, params)`: engine output model (idle → peak → falloff)
- `suggestGearRatios({ targetTopSpeedMps, gears, spacing })`: auto-generate ratio sets
- `Gearbox` class manages gear state, auto/manual shifting, rev limiting

### Track Editor (`track_editor.js`)
- `TrackEditor.create({ onSaved, onTestDrive })` - factory for editor instance
- Tracks stored via `TrackStore` (IndexedDB) with `id`, `name`, `points`, `updatedAt`
- Custom tracks referenced as `"custom:<id>"` in track selection

## Speed & Acceleration Tuning

### Factors Affecting Time-to-Top-Speed
1. **Engine power** (`enginePowerMult` in `VEHICLE_DEFAULTS`) - direct force multiplier
2. **Torque curve** (`torquePeak`, `torquePeakRpm` in gearbox) - power delivery shape
3. **Gear ratios** (`gearboxDefaults.ratios`) - lower ratios = faster acceleration, lower top speed
4. **Final drive** (`finalDrive`) - overall gearing multiplier
5. **Drag coefficient** (`dragK`) - aerodynamic resistance (quadratic with speed)
6. **Rolling resistance** (`rollK`) - constant friction loss
7. **Mass** (`mass` in physics) - affects acceleration but not top speed
8. **Tire grip** (`muLongRoad`) - limits usable power at low speeds

### Extending Time-to-Top-Speed (Same Top Speed)
Top speed is reached when `Fx_drive = F_drag + F_roll` (forces balance). To keep the same top speed but take longer to reach it, you must **reduce acceleration while preserving terminal equilibrium**.

**The challenge**: Most params affect both acceleration AND top speed. The key is **paired adjustments**:

```js
// APPROACH 1 (RECOMMENDED): Lower power + Lower drag by SAME factor
// Physics: v_max = sqrt(enginePower / dragK)
// If both scale by factor k: sqrt(P*k / D*k) = sqrt(P/D) → same top speed
// But acceleration drops by factor k → longer time to reach it
enginePowerMult: 1.155,  // ↓ from 1.65 (× 0.70 = 30% less power)
dragK: 0.00070,          // ↓ from 0.0010 (× 0.70 = 30% less drag)
// Result: same top speed, ~30% longer to reach it

// APPROACH 2: Flatten torque curve (less low-end punch)
// In src/gearbox.js torqueCurve(): torque ramps from torqueIdle → torquePeak
torqueIdle: 180,        // ↑ from ~140 (flatter curve, less low-RPM torque)
torquePeakRpm: 6500,    // ↑ from 5000 (peak power arrives later)

// APPROACH 3: Taller gear ratios (same final top speed, slower through gears)
// Use suggestGearRatios() with higher spacing value
suggestGearRatios({ targetTopSpeedMps: 54, gears: 6, spacing: 1.40 }) // ↑ from 1.28
```

**Why this is tricky**: The `updateCar()` function in `physics.js` computes:
- `Fx_long = Fx_trac - F_drag - F_roll` where `F_drag = dragK * v²`
- At top speed: `Fx_drive ≈ dragK * v_max²`, so `v_max = sqrt(Fx_drive / dragK)`
- Changing `enginePowerMult` alone shifts BOTH acceleration AND top speed

**Recommended approach**: Paired power/drag reduction (Approach 1). Scale both `enginePowerMult` and `dragK` by the same factor to preserve top speed while reducing acceleration.

**Avoid using mass**: While `mass` doesn't affect top speed directly, it changes tire normal force (`Fz = mass * g`), which alters grip limits, skid thresholds, and weight transfer feel. This makes cornering and slip behavior inconsistent with other vehicles.

### Quick Tuning Guide
```js
// Faster acceleration, same top speed:
enginePowerMult: 1.80,  // ↑ from 1.65
torquePeak: 300,        // ↑ from 260

// Higher top speed (longer to reach):
dragK: 0.0008,          // ↓ from 0.0010
// OR adjust gear ratios for taller gearing

// Quicker shifts (snappier feel):
shiftCutMs: 70,         // ↓ from 90
minShiftGapMs: 180,     // ↓ from 220
```

## Running Locally
```powershell
# Python 3
python -m http.server 8080

# Or Node
npx http-server -p 8080 .
```
Open: `http://localhost:8080/racer_start_menu.html`

## File Conventions
- Main game logic: inline `<script type="text/babel">` in `racer.html`
- Utilities: `utils/*.js` (pure functions, no DOM)
- Assets: `assets/decor/` (shared atlas), `assets/vehicles/` (car sprites)
- PWA: `manifest.webmanifest`, `service-worker.js`, `icons/`

## Common Gotchas
- React/Babel loaded via CDN - JSX works only inside `type="text/babel"` scripts
- Physics params are in pixels, not SI units (gravity ~750 px/s²)
- `planck.min.js` must load before `physics.js` (script order matters)
- Service worker caches files - bump `CACHE_VERSION` when changing cached assets

## Camera System & World Scale

### World Scale (`GEO_SCALE`)
- Controlled by slider in dev tools, stored as `displayGeoScale` in localStorage
- Multiplies track dimensions: `applyWorldSize(baseWorldWidth * GEO_SCALE, baseWorldHeight * GEO_SCALE)`
- Higher values = larger world `W`/`H`, same viewport = more zoomed out appearance

### Camera Distance Calculation (`computeCameraZoom` in `racer.html`)
```js
// displayScaleRef = canvas.width / W (pixels per world unit)
// As W increases (higher world scale), displayScale decreases
const zoomBase = (CAM_BASE_ZOOM * zoomFactor) / displayScale;
```

**Known Issue**: Camera distance is coupled to World Scale because:
1. `displayScaleRef.current = canvas.width / W` — set in `sizeBackbufferToViewport()`
2. `computeCameraZoom()` divides by `displayScale`, so larger worlds → smaller displayScale → larger zoom factor → camera appears zoomed IN

**To fix camera distance being affected by World Scale**:
The camera calculation needs to normalize for world scale. Options:
1. Multiply `displayScale` by `GEO_SCALE` before using it in zoom calculation
2. Store and use a reference `displayScale` from default world scale (1.0)
3. Calculate zoom based on fixed pixel distances rather than world-relative distances

**Key variables**:
- `GEO_SCALE` / `WIDTH_SCALE` — track geometry/road width multipliers
- `displayScaleRef.current` — pixels per world unit (changes with world size)
- `CAM_BASE_ZOOM` (1.1) — baseline zoom factor
- `cameraDistance` — user-adjustable zoom multiplier (0.6–1.6)
- `camRef.current.scale` — actual applied camera scale

### Camera State
```js
camRef.current = { x, y, scale, targetScale, targetX, targetY }
// scale lerps toward targetScale each frame for smooth zoom
```

## Testing
- Manual browser testing only (no automated test suite)
- Use Dev Tools panel (top-right toggle) for real-time physics tuning
- Test on both desktop (keyboard) and mobile (touch HUD + gyro)
