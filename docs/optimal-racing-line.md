# Optimal Racing Line (Min-Curvature) Algorithm

## Overview

The Optimal Racing Line algorithm is a geometric optimizer that generates smooth, pro-style racing lines by minimizing overall bending/curvature within the track corridor. Unlike the Anchor algorithm which places discrete waypoints at corners, this algorithm produces a globally optimized path.

## Key Features

- **Global optimization**: Minimizes curvature across the entire track
- **Smooth output**: No kinks or discontinuities
- **Natural pro-style patterns**: Outside → apex → outside emerges naturally
- **Corridor-constrained**: Always stays within track bounds with safety margin
- **Deterministic**: Same track always produces the same line

## Algorithm Details

### Representation

The racing line is represented as offsets from a smooth centerline:
- `p[i] = c[i] + n[i] * a[i]`
  - `c[i]`: centerline point
  - `n[i]`: unit normal vector (perpendicular to track direction)
  - `a[i]`: offset distance (positive = left, negative = right)

### Process

1. **Resample centerline** to constant arc-length spacing (~12px)
2. **Smooth centerline** slightly to avoid jitter in normals
3. **Compute tangents and normals** at each point
4. **Build corridor bounds** from track edges minus safety margin
5. **Initialize offsets** at zero (centerline)
6. **Iterate** (default 200 iterations):
   - Apply bending-energy smoothing (discrete Laplacian)
   - Project back to corridor by clamping offsets
   - Optional anti-wobble low-pass filter
7. **Validate** and return final path with metrics

### Configuration Parameters

```javascript
{
  resampleStep: 12,        // Arc-length spacing (pixels)
  iterations: 200,         // Number of smoothing iterations
  lambda: 0.1,             // Smoothing strength (must be small for stability)
  safetyMargin: 15,        // Margin from track edges (pixels)
  enableAntiWobble: false, // Optional low-pass filter
  centerlineSmoothing: 3,  // Pre-smooth centerline passes
  debugMode: false         // Enable console logging
}
```

## Usage

### In the Game UI

1. Open the game and start a race
2. Click "Dev" button (top-left)
3. Select "AI Controls" from the dropdown
4. Change "Racing line algorithm" to "Optimal Racing Line (Min-Curvature)"
5. Enable "Show racing line" to visualize
6. Enable "Compare lines (A/B)" to overlay both algorithms
7. Enable "Show corridor bounds" to see the optimization constraints

### In Code

```javascript
// Generate optimal racing line
const racingLine = window.RacerOptimalLine.generate(
  centerline,  // Array of {x, y} points
  roadWidth,   // Track width in pixels
  {
    debugMode: true,
    iterations: 200,
    safetyMargin: 15
  }
);

// Each point has:
// - x, y: line position
// - offset: distance from centerline
// - aMin, aMax: corridor bounds
// - centerX, centerY: centerline position
// - normalX, normalY: normal vector
```

## Validation Metrics

The algorithm reports these metrics when `debugMode: true`:

- **Max lateral step**: Maximum change in offset between consecutive points
- **Min margin to bounds**: Closest approach to track edges
- **Path length**: Total length of the racing line
- **Max curvature**: Sharpest bend in the line

### Expected Values

- Max lateral step: < 10px (smooth line)
- Min margin: ≥ 0px (no violations)
- Path length: Similar to or shorter than centerline
- Max curvature: Varies by track complexity

## Comparison with Anchor Algorithm

| Feature | Anchor | Optimal (Min-Curvature) |
|---------|--------|------------------------|
| **Approach** | Discrete waypoints at corners | Global continuous optimization |
| **Corner detection** | Explicit apex finding | Implicit from curvature |
| **Straightening** | Post-process heuristic | Natural from smoothing |
| **Track width usage** | Parameterized aggression | Emerges from optimization |
| **Stability** | Depends on apex detection | Mathematically stable |
| **Customization** | Apex aggression, max offset | Lambda, iterations, margin |

## Visual Comparison

When "Compare lines (A/B)" is enabled:
- **Blue dashed line**: Anchor algorithm (default)
- **Red dashed line**: Optimal min-curvature algorithm
- **Yellow bounds**: Corridor constraints (if enabled)

The optimal line typically:
- Uses more track width in corners
- Has smoother transitions
- Stays straighter on gentle curves
- Adapts naturally to corner sequences

## Troubleshooting

### Line jitters or has sawtooth pattern
- Reduce `lambda` (e.g., 0.05)
- Increase `iterations` (e.g., 300)
- Enable `enableAntiWobble: true`

### Line hugs boundaries everywhere
- Increase `safetyMargin`
- Check that track centerline is well-centered

### Kink at track seam (start/finish)
- Verify centerline forms a smooth closed loop
- Check that endpoints are very close together

### Boundary violations (min margin < 0)
- Increase `safetyMargin`
- Reduce `lambda`
- Decrease `iterations` (less aggressive smoothing)

## Testing

Run the test suite:
```bash
node tests/test_optimal_line.js
```

Tests include:
- Circle track (constant curvature)
- Wavy track (straightening behavior)
- 90-degree corner (width usage)

## Implementation Notes

### Stability

The algorithm uses a stable elastic-band iteration approach:
1. Smooth in path space (Cartesian coordinates)
2. Project back to offset space
3. Clamp to corridor bounds
4. Repeat

This avoids large gradient descent steps that could cause instability.

### Performance

- Generation is done once at track load (not per-frame)
- Typical time: 10-50ms for 200 iterations
- Scales with track complexity and resampled point count

### Future Enhancements

Potential improvements not in v1:
- Exit priority weighting (favor wider exits)
- Speed-aware optimization (bank earlier for high-speed corners)
- Multi-line variants (defensive vs overtaking lines)
- Adaptive iteration count based on convergence

## References

The algorithm is based on elastic band optimization techniques used in robotics path planning, adapted for racing line generation with track-specific constraints.
