# Racing Line Solver Documentation

## Overview

The Racing Line Solver is a JavaScript module that generates optimal racing lines for racing games using an **Elastic Band Algorithm** with iterative gradient descent. This solver produces mathematically optimized paths that follow the Outside-Inside-Outside apex pattern naturally.

## Algorithm: Elastic Band Method

The solver uses a physics-inspired approach where the racing line is treated as an elastic band that:
- Wants to be as short as possible (tension force)
- Must stay smooth (no sharp kinks)
- Cannot leave the track boundaries (constraints)

### Three-Step Process

#### Step 1: Uniform Resampling
The user's irregular anchor points are converted to a high-resolution centerline with uniform spacing.

```javascript
// Input: Irregular user points
[{x: 0, y: 0}, {x: 100, y: 0}, {x: 110, y: 0}]  // Irregular spacing

// Output: Uniformly spaced (e.g., every 10px)
[{x: 0, y: 0}, {x: 10, y: 0}, {x: 20, y: 0}, ...] // Regular spacing
```

**Why?** Uniform spacing ensures:
- Consistent force application during optimization
- Smooth curvature calculations
- Predictable convergence

#### Step 2: Boundary Pre-calculation
For every resampled point, the solver calculates the left and right track edges.

```javascript
// At each point:
1. Calculate tangent (direction of travel)
2. Calculate normal (perpendicular to tangent)
3. Left boundary = center + normal × (trackWidth/2)
4. Right boundary = center - normal × (trackWidth/2)
```

**Why?** Pre-calculating boundaries allows:
- Fast constraint checking during optimization
- Accurate projection onto valid track areas
- No boundary violations

#### Step 3: Elastic Band Optimization
The racing line is iteratively smoothed while respecting track boundaries.

```javascript
for (iteration = 0; iteration < iterations; iteration++) {
  for (each point i) {
    // Smoothing: Pull toward midpoint of neighbors
    target = (point[i-1] + point[i+1]) / 2
    
    // Apply optimization factor (controls aggressiveness)
    smoothed = lerp(point[i], target, strength × optimizationFactor)
    
    // Constraint: Keep within track boundaries
    point[i] = constrainToTrack(smoothed, boundaries[i])
  }
}
```

**Key Features:**
- **Midpoint smoothing**: Creates smooth, flowing curves
- **Curvature awareness**: More aggressive in corners (high curvature)
- **Boundary constraints**: Hard limits prevent off-track excursions

## API Reference

### Constructor

```javascript
const solver = new RacingLineSolver({
  resampleSpacing: 10,      // Distance between resampled points (px)
  iterations: 75,           // Number of optimization iterations
  optimizationFactor: 0.7,  // Aggressiveness (0.0-1.0)
  smoothingStrength: 0.5    // Force per iteration (0.0-1.0)
});
```

#### Parameters

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `resampleSpacing` | number | 10 | 5-20 | Distance between resampled points. Smaller = more detail, slower. |
| `iterations` | number | 75 | 10-300 | Optimization iterations. More = smoother, slower convergence. |
| `optimizationFactor` | number | 0.7 | 0.0-1.0 | How aggressively to cut corners. 0 = conservative, 1 = aggressive. |
| `smoothingStrength` | number | 0.5 | 0.0-1.0 | Smoothing force per iteration. Higher = faster convergence but less stable. |

### solve()

```javascript
const racingLine = solver.solve(centerLinePoints, trackWidth);
```

#### Parameters
- `centerLinePoints`: Array of `{x, y}` objects defining the track center
- `trackWidth`: Width of the track in pixels

#### Returns
Array of `{x, y}` objects representing the optimized racing line

#### Example

```javascript
const centerline = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 150, y: 50 },
  { x: 100, y: 100 },
  { x: 0, y: 100 }
];

const solver = new RacingLineSolver({
  optimizationFactor: 0.8,
  iterations: 100
});

const racingLine = solver.solve(centerline, 80);
// Returns: [{x: ..., y: ...}, ...]
```

## Integration with RacerAI

The elastic band solver is integrated into the existing `racer_ai.js` module and can be used as a drop-in replacement for the anchor-based system.

### Usage

```javascript
// Default behavior (anchor-based, backward compatible)
const line = RacerAI.buildRacingLine(centerline, roadWidth);

// Use elastic band solver
const line = RacerAI.buildRacingLine(centerline, roadWidth, {
  useElasticBandSolver: true,
  apexAggression: 0.7,           // Maps to optimizationFactor
  elasticBandIterations: 75,     // Number of iterations
  elasticBandSmoothing: 0.5,     // Smoothing strength
  elasticBandSpacing: 10         // Resample spacing
});
```

### Metadata Enrichment

The integration automatically adds racing line metadata:

```javascript
[
  {
    index: 0,
    s: 0,              // Arc length along path
    x: 100,
    y: 100,
    tangent: {x, y},   // Direction of travel
    normal: {x, y},    // Perpendicular direction
    curvature: 0.002,  // Signed curvature (1/radius)
    radius: 500,       // Corner radius (px)
    targetSpeed: 1200  // AI target speed (px/s)
  },
  // ... more points
]
```

## Tuning Guide

### Conservative vs Aggressive Lines

**Conservative (0.3-0.5)**
- Stays closer to centerline
- Smoother transitions
- Safer for beginners
- Slower lap times

**Balanced (0.6-0.8)**
- Good compromise
- Uses track width effectively
- Recommended default

**Aggressive (0.9-1.0)**
- Maximum corner cutting
- Uses full track width
- Requires more iterations for stability
- Fastest lap times

### Iteration Count

| Track Type | Recommended Iterations |
|-----------|----------------------|
| Simple (circle, oval) | 50-75 |
| Medium (Silverstone) | 75-100 |
| Complex (hairpins, chicanes) | 100-150 |
| Very twisty | 150-300 |

**Rule of thumb**: More corners = more iterations needed

### Smoothing Strength

| Value | Behavior |
|-------|----------|
| 0.1-0.3 | Very gradual convergence, stable but slow |
| 0.4-0.6 | Balanced (recommended) |
| 0.7-0.9 | Fast convergence, may oscillate |

**Warning**: Smoothing > 0.8 can cause instability in tight corners

### Resample Spacing

| Spacing | Use Case | Performance |
|---------|----------|-------------|
| 5-8px | High detail, slow corners | Slower |
| 10-12px | Balanced (recommended) | Normal |
| 15-20px | Fast preview, simple tracks | Faster |

**Trade-off**: Smaller spacing = more detail but slower computation

## Performance Considerations

### Optimization Time

Typical solve times (JavaScript, single-core):
- Simple track (50 points, 75 iterations): ~5ms
- Medium track (200 points, 100 iterations): ~50ms
- Complex track (500 points, 150 iterations): ~300ms

### Memory Usage

Memory per track:
- Input centerline: ~24 bytes/point
- Resampled path: ~16 bytes/point
- Boundaries: ~64 bytes/point
- Racing line: ~16 bytes/point

**Example**: 200-point track ≈ 24KB

### Optimization Tips

1. **Cache results**: Racing lines don't change unless the track changes
2. **Use fewer iterations for preview**: 30-40 iterations for real-time editing
3. **Increase iterations for final**: 100+ for race-ready lines
4. **Adjust spacing for track size**: Larger tracks can use larger spacing

## Comparison: Anchor-Based vs Elastic Band

| Feature | Anchor-Based | Elastic Band |
|---------|--------------|--------------|
| **Algorithm** | Identify apices, place anchors, interpolate | Iterative smoothing with constraints |
| **Advantages** | Fast, explicit control points | Natural optimization, no apex detection needed |
| **Disadvantages** | Complex apex logic, sensitive to noise | More iterations for complex tracks |
| **Best For** | Real racing tracks with clear corners | Any track shape, especially smooth flows |
| **Speed** | ~10-20ms | ~50-100ms |
| **Code Complexity** | High (~900 lines) | Low (~350 lines) |

## Testing

### Unit Tests

```bash
# Run solver tests
node tests/run_solver_tests.js

# Expected output: 10/10 tests passing
```

### Integration Tests

```bash
# Run integration test
node tests/integration_test.js

# Verifies backward compatibility
```

### Visual Testing

Open `tests/test_solver_runner.html` in a browser to:
- Run all tests with UI
- Visualize racing lines
- Adjust parameters in real-time
- Compare centerline vs racing line

## Troubleshooting

### Line stays too close to center

**Cause**: `optimizationFactor` too low
**Solution**: Increase to 0.7-0.9

### Line oscillates/wiggles

**Cause**: `smoothingStrength` too high or insufficient iterations
**Solution**: 
- Reduce `smoothingStrength` to 0.4-0.5
- Increase `iterations` by 50%

### Line goes off-track

**Cause**: Bug in boundary calculation or constraint projection
**Solution**: This should never happen - if it does, it's a solver bug. Please report.

### Poor performance

**Cause**: Too many points or iterations
**Solution**:
- Increase `resampleSpacing` (12-15)
- Reduce `iterations` (50-75)
- Simplify input centerline (fewer anchor points)

### Line too jagged

**Cause**: Insufficient iterations or high resample spacing
**Solution**:
- Increase `iterations` (100-150)
- Decrease `resampleSpacing` (8-10)

## Advanced Usage

### Custom Curvature Scaling

The solver automatically applies more force in high-curvature areas. To customize:

```javascript
// Edit racing_line_solver.js:
const curvatureFactor = Math.min(1, curvature * 200); // Default
const curvatureFactor = Math.min(1, curvature * 300); // More aggressive in corners
const curvatureFactor = Math.min(1, curvature * 100); // Less aggressive
```

### Progressive Refinement

For interactive applications, use progressive refinement:

```javascript
// Quick preview (30 iterations)
const preview = solver.solve(centerline, width);
renderLine(preview);

// Then refine in background (100 iterations)
setTimeout(() => {
  const solver2 = new RacingLineSolver({ iterations: 100 });
  const refined = solver2.solve(centerline, width);
  renderLine(refined);
}, 100);
```

### Multi-pass Optimization

For extremely complex tracks:

```javascript
// Pass 1: Coarse optimization (large spacing)
const solver1 = new RacingLineSolver({
  resampleSpacing: 20,
  iterations: 50
});
const coarse = solver1.solve(centerline, width);

// Pass 2: Fine optimization (small spacing)
const solver2 = new RacingLineSolver({
  resampleSpacing: 8,
  iterations: 100
});
const fine = solver2.solve(coarse, width);
```

## References

### Algorithm Papers

1. **Elastic Bands**: Quinlan & Khatib (1993) - "Elastic Bands: Connecting Path Planning and Control"
2. **Minimum Curvature Paths**: Dubins (1957) - "On Curves of Minimal Length"
3. **Racing Line Optimization**: Casanova et al. (2000) - "Minimum-time trajectory generation for race cars"

### Related Concepts

- **Gradient Descent**: Iterative optimization method
- **Constrained Optimization**: Optimization with boundary constraints
- **Spline Smoothing**: Mathematical curve smoothing
- **Racing Line Theory**: Outside-Inside-Outside apex pattern

## Future Enhancements

Potential improvements for future versions:

1. **Velocity-aware optimization**: Account for car physics (braking, acceleration)
2. **Multi-line support**: Generate multiple racing lines (defensive, overtaking)
3. **Surface-aware**: Different lines for different surfaces (tarmac, gravel)
4. **AI difficulty levels**: Pre-tuned parameter sets
5. **GPU acceleration**: Use WebGL for parallel computation
6. **Adaptive iteration count**: Stop when convergence detected
7. **Line comparison**: Visual diff between different parameter sets

## License

This module is part of the RacerVibes project and follows the project's license.

## Contributing

When contributing improvements:
1. Run all tests (`npm test` or `node tests/run_solver_tests.js`)
2. Verify backward compatibility (integration tests must pass)
3. Add tests for new features
4. Update this documentation
5. Maintain code comments

## Support

For issues, questions, or suggestions:
1. Check this documentation
2. Review test cases in `tests/racing_line_solver_tests.js`
3. Try the visual test runner (`tests/test_solver_runner.html`)
4. Open an issue on GitHub with:
   - Track data (centerline points)
   - Parameters used
   - Expected vs actual behavior
   - Screenshots if visual issue
