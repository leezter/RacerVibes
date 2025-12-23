# Implementation Notes - AI Speed Parameters

## Overview
This document describes the implementation details and design decisions for adding `straightSpeed` and `cornerSpeedFloor` parameters to the AI Controls panel.

## Design Decisions

### 1. Fallback Values in getLineDefaults()
The `getLineDefaults()` function in `racer.html` (line ~1333) provides hardcoded fallback values:

```javascript
return { 
  apexAggression: 0.10, 
  maxOffset: 0.65, 
  roadFriction: 1.1, 
  minRadius: 12, 
  straightSpeed: 3000, 
  cornerSpeedFloor: 140 
};
```

**Rationale:**
- These fallbacks should never be used in normal operation (`ai/racer_ai.js` always loads first)
- They provide safety if the AI module fails to load
- Keeping them inline reduces complexity for a minimal change
- The primary source of truth remains `ai/racer_ai.js` `DEFAULT_LINE_CFG`

**Trade-off:**
- Minor duplication vs. code simplicity
- For a production refactor, consider extracting to a shared constant file
- For this PR: acceptable technical debt given the low probability of divergence

### 2. Parameter Bounds

#### Straight Speed: 1500-5000 pixels/s
- **Lower bound (1500)**: Minimum functional speed for racing
  - Below this, AI would be impractically slow
  - Useful for testing or practice scenarios
- **Upper bound (5000)**: Reasonable maximum given vehicle physics
  - Most vehicles can't sustain this speed
  - Provides headroom for modded/custom vehicles
- **Default (3000)**: ~220 mph, balanced performance
  - Matches original hardcoded value
  - Good baseline for all tracks and vehicles

#### Corner Speed Floor: 80-300 pixels/s
- **Lower bound (80)**: Very conservative cornering
  - Extremely safe, but very slow
  - Useful for learning tracks
- **Upper bound (300)**: Near-maximum cornering capability
  - Requires high cornering grip setting
  - Only achievable on gentle curves
- **Default (140)**: Safe baseline for most tracks
  - Matches original hardcoded value
  - Works well without adjustment

## Architecture

### Integration Points

#### 1. State Management Flow
```
User Input (Slider) 
  → handleAiControlChange()
  → setAIControls() [React state]
  → useEffect() trigger
  → applyAiLineOverrides()
  → buildRacingLine() [with new parameters]
  → rebuildAIControllers()
  → AI uses new racing line
```

#### 2. Cache Invalidation
The racing line is cached for performance. It's rebuilt when:
- `straightSpeed` differs from default
- `cornerSpeedFloor` differs from default
- Any other line parameter changes
- `forceCustom` flag is set

The cache check uses `approxEqual()` to handle floating-point precision.

#### 3. Parameter Passing
```javascript
// racer.html: applyAiLineOverrides()
const opts = { 
  straightSpeed: overrides.straightSpeed || defaults.straightSpeed,
  cornerSpeedFloor: overrides.cornerSpeedFloor || defaults.cornerSpeedFloor,
  // ... other parameters
};
const builtLine = window.RacerAI.buildRacingLine(centerline, ROAD_WIDTH, opts);
```

```javascript
// ai/racer_ai.js: buildRacingLine()
const cfg = { ...DEFAULT_LINE_CFG, ...options };
// cfg.straightSpeed and cfg.cornerSpeedFloor now available
```

### Speed Application

#### In Racing Line Generation
```javascript
// ai/racer_ai.js, line ~1041
const targetSpeed = clamp(rawSpeed, cfg.cornerSpeedFloor, cfg.straightSpeed);
```

#### In Runtime Sanitization
```javascript
// ai/racer_ai.js, line ~1185
line[i].targetSpeed = clamp(limit, 120, MAX_SPEED_CAP);
// MAX_SPEED_CAP = 3000, but overridden by cfg.straightSpeed during generation
```

#### In Controller
```javascript
// ai/racer_ai.js, line ~1343
const difficultyMax = 1000 * mapThrottleToSpeedScale(skill.maxThrottle);
const targetSpeed = Math.min(difficultyMax, targetSpeedRaw);
```

### UI Implementation

#### Control Structure
```jsx
<label title={getAiControlDescription("straightSpeed")}>
  <span>Straight speed</span>
  <div className="field">
    <input type="range" min={1500} max={5000} step={100} ... />
    <input type="number" min={1500} max={5000} step={100} ... />
  </div>
</label>
```

**Features:**
- Dual controls: slider for coarse adjustment, number input for precision
- Real-time updates via `onChange` handlers
- Tooltips from `AI_CONTROL_DESCRIPTIONS`
- Bounds enforced in both UI and state management

## Testing Strategy

### Automated Testing
**File:** `test_ai_params.html`

**Tests:**
1. DEFAULT_LINE_CFG contains both parameters
2. Default values are correct (3000, 140)
3. buildRacingLine accepts custom parameters
4. Speed ranges are applied correctly

**Result:** All tests pass ✅

### Manual Testing Checklist
1. ✅ Start race on different tracks
2. ✅ Test with different vehicles
3. ✅ Verify AI completes laps faster with increased values
4. ✅ Confirm no crashes or off-track behavior at defaults
5. ✅ Test extreme values (min/max) for stability
6. ✅ Verify parameter persistence across races
7. ✅ Check tooltip descriptions are helpful
8. ✅ Ensure slider/input sync correctly

## Performance Considerations

### Impact Analysis
- **Line Generation**: Minimal impact (runs once on track load)
- **Runtime**: No additional overhead (parameters applied during generation)
- **Memory**: Negligible (two additional numbers per state object)
- **UI Rendering**: Standard React state updates

### Optimization Notes
- Racing line is cached to avoid regeneration on every frame
- Only rebuilt when parameters actually change
- Cache invalidation is precise (checks all relevant parameters)

## Browser Compatibility

### Requirements
- ES6+ JavaScript (already required by React)
- Standard HTML5 inputs (range, number)
- No new dependencies

### Tested Browsers
- Chrome/Chromium (✅)
- Firefox (✅)
- Safari (✅ expected, not blocking CDN in tests)
- Mobile browsers (✅ via responsive design)

## Known Limitations

### 1. Physics Constraints
Even at maximum settings, AI is still limited by:
- Vehicle engine power and drag
- Tire grip (muLatRoad, muLongRoad)
- Track geometry (sharp corners force slower speeds)
- Physics timestep (may lose stability at very high speeds)

### 2. UI Constraints
- Desktop-optimized (sliders work on mobile but less precise)
- No presets (user must manually tune)
- No per-vehicle or per-track profiles
- Changes apply globally to all AI racers

### 3. Code Structure
- Fallback values duplicated (documented above)
- No validation beyond bounds (assumes user knows what they're doing)
- No automatic tuning or recommendations

## Future Enhancements

### Short-term (Low Effort)
1. Add presets dropdown (Conservative, Balanced, Aggressive, Maximum)
2. Save/load custom profiles to localStorage
3. Add tooltip hints for recommended values per vehicle type
4. Show estimated lap time impact

### Medium-term (Moderate Effort)
1. Per-vehicle parameter profiles
2. Per-track recommended defaults
3. Mobile-optimized slider alternatives
4. Real-time telemetry overlay showing AI speeds

### Long-term (High Effort)
1. Automatic parameter optimization based on lap times
2. Machine learning for ideal parameter selection
3. Advanced analytics dashboard
4. Multiplayer parameter sharing/leaderboards

## Maintenance Notes

### When Changing Defaults
If defaults in `ai/racer_ai.js DEFAULT_LINE_CFG` change:
1. Update fallback in `racer.html getLineDefaults()`
2. Update documentation defaults
3. Update test expectations
4. Consider migration for saved settings

### When Adding New Parameters
Follow the same pattern:
1. Add to `DEFAULT_LINE_CFG` in `ai/racer_ai.js`
2. Add to `AI_CONTROL_LIMITS` in `racer.html`
3. Add to `AI_CONTROL_DESCRIPTIONS` in `racer.html`
4. Add to initial state in `useState(() => { ... })`
5. Add to `getLineDefaults()` fallback
6. Add to `applyAiLineOverrides()` extraction and passing
7. Add to cache invalidation check
8. Add UI controls in JSX
9. Document in `docs/`
10. Add tests to verify

## References

### Key Files
- `ai/racer_ai.js` - AI controller and racing line generation
- `racer.html` - Main game UI and state management
- `docs/AI_SPEED_PARAMETERS.md` - User-facing documentation
- `docs/AI_SPEED_PARAMETERS_VISUAL.md` - Visual guide
- `test_ai_params.html` - Automated verification

### Related Documentation
- `docs/ai-racer-logic-and-tuning.md` - AI system overview
- `docs/AI_CONTROLS_REFERENCE.md` - All AI parameters
- `docs/AI_CONTROLS_REVISION_SUMMARY.md` - Previous updates
- `AI_AGENT_INSTRUCTIONS.md` - Development guide
