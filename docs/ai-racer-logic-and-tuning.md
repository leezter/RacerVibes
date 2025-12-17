# AI Racer Logic & Tuning Guide

## Overview
The AI racer logic (`ai/racer_ai.js`) controls opponent behavior, specifically how they generate racing lines, manage speed, and brake. Two racing line algorithms are available: **Anchor-Based** (default) and **MCP (Minimum Curvature Path)**.

## 1. Racing Line Generation

### Algorithm Selection
The game now supports two racing line generation algorithms that can be selected in the AI Controls panel:

1. **Anchor-Based** (Default) - Event-driven with anchor points at corners
2. **MCP (Minimum Curvature Path)** - Iterative optimization for smoothest possible path

### 1.1. Anchor-Based Algorithm (Default)
The **Anchor-Based** algorithm identifies corners as "events" and places anchor points (Entry, Apex, Exit) to construct the racing line. This mimics how professional drivers conceptualize racing lines.

#### How it Works
1. **Apex Detection**: The algorithm identifies "events" (corners) by finding local maxima in the track's curvature.
   - **Threshold**: `apexThreshold = 0.002` (radius < ~500px to qualify as a corner). Gentler bends are ignored.
   - **Displacement Filter**: Apices are filtered by lateral displacement (`MIN_DISPLACEMENT_RATIO = 0.15`). Track noise with high curvature but low sideways movement is ignored.
2. **Apex Merging**: Consecutive same-direction apices that form a continuous curve (e.g., a hairpin) are merged into a **single apex at their weighted centroid**. This ensures long sweeping turns have ONE apex at the geometric center, producing the classic "outside-inside-outside" racing line.
3. **Compound Turn Detection**: Consecutive turns in the same direction are analyzed. If they are connected by a curve or are very close (gap < ~720px), they are merged into a single compound turn by removing the intermediate "Exit" and "Entry" anchors.
4. **Smart Entry/Exit Placement**: Entry and exit anchors are moved closer to the apex if they would fall on a straight section (curvature < `MIN_CURVATURE_FOR_ANCHOR = 0.002`). This prevents corner offsets from bleeding into unrelated straight sections.
5. **Anchor Placement & Severity Scaling**: For each corner, it places three key anchors (Entry, Apex, Exit).
   - **Amplitude Scaling**: The lateral offset of the anchors is scaled by the **Curvature Severity**.
   - **Severity Formula**: `severity = clamp((curvature - 0.002) / 0.003, 0, 1)` — maps curvature to 0-1 range.
   - **Minimum Floor**: Detected corners always get at least 30% amplitude (`amplitude = max(0.3, severity)`).
   - **Sharp Turns**: Higher severity means progressively more offset, up to full track width.
6. **Linear Interpolation**: The algorithm linearly interpolates between anchors. This creates **Straight Diagonal Lines** between corners.
7. **Anchor-Preserving Smoothing**: A smoothing pass blends the sharp corners at anchors while preserving the anchor positions themselves.
8. **Path Straightening**: A chord-based optimization pass eliminates unnecessary weaving on "lumpy" track sections.
   - **Corner Protection**: Sections with high curvature (> `CORNER_CURVATURE_THRESHOLD = 0.005`) are skipped.
   - **Wavering Threshold**: `0.08` (cumulative direction change to trigger straightening).
   - **Max Chord Length**: `60` indices (~720px).
9. **Direction Reversal Fix**: A post-processing pass fixes path segments that fold back on themselves, preventing zigzag artifacts.
10. **Clustered Point Removal**: Near-duplicate points (distance < 3px) are removed to prevent numerical instability in curvature calculations.

### How it Works
1.  **Apex Detection**: The algorithm identifies "events" (corners) by finding local maxima in the track's curvature.
    *   **Threshold**: `apexThreshold = 0.002` (radius < ~500px to qualify as a corner). Gentler bends are ignored.
    *   **Displacement Filter**: Apices are filtered by lateral displacement (`MIN_DISPLACEMENT_RATIO = 0.15`). Track noise with high curvature but low sideways movement is ignored.
2.  **Apex Merging**: Consecutive same-direction apices that form a continuous curve (e.g., a hairpin) are merged into a **single apex at their weighted centroid**. This ensures long sweeping turns have ONE apex at the geometric center, producing the classic "outside-inside-outside" racing line.
3.  **Compound Turn Detection**: Consecutive turns in the same direction are analyzed. If they are connected by a curve or are very close (gap < ~720px), they are merged into a single compound turn by removing the intermediate "Exit" and "Entry" anchors.
4.  **Smart Entry/Exit Placement**: Entry and exit anchors are moved closer to the apex if they would fall on a straight section (curvature < `MIN_CURVATURE_FOR_ANCHOR = 0.002`). This prevents corner offsets from bleeding into unrelated straight sections.
5.  **Anchor Placement & Severity Scaling**: For each corner, it places three key anchors (Entry, Apex, Exit).
    *   **Amplitude Scaling**: The lateral offset of the anchors is scaled by the **Curvature Severity**.
    *   **Severity Formula**: `severity = clamp((curvature - 0.002) / 0.003, 0, 1)` — maps curvature to 0-1 range.
    *   **Minimum Floor**: Detected corners always get at least 30% amplitude (`amplitude = max(0.3, severity)`).
    *   **Sharp Turns**: Higher severity means progressively more offset, up to full track width.
6.  **Linear Interpolation**: The algorithm linearly interpolates between anchors. This creates **Straight Diagonal Lines** between corners.
7.  **Anchor-Preserving Smoothing**: A smoothing pass blends the sharp corners at anchors while preserving the anchor positions themselves.
8.  **Path Straightening**: A chord-based optimization pass eliminates unnecessary weaving on "lumpy" track sections.
    *   **Corner Protection**: Sections with high curvature (> `CORNER_CURVATURE_THRESHOLD = 0.005`) are skipped.
    *   **Wavering Threshold**: `0.08` (cumulative direction change to trigger straightening).
    *   **Max Chord Length**: `60` indices (~720px).
9.  **Direction Reversal Fix**: A post-processing pass fixes path segments that fold back on themselves, preventing zigzag artifacts.
10. **Clustered Point Removal**: Near-duplicate points (distance < 3px) are removed to prevent numerical instability in curvature calculations.

## 2. Speed & Grip Logic
AI speed is primarily limited by physics (friction), not artificial caps.

### Runtime Speed Sanitization
When the AI initializes, it scans the racing line and calculates the maximum potential speed for every point based on the corner radius.
*   **Formula**: `MaxSpeed = Sqrt(FRICTION_LIMIT * GRAVITY * Radius)`
*   **Difficulty Scaling**: The `FRICTION_LIMIT` is scaled by the `corneringGrip` parameter in `SKILL_PRESETS`.

### Difficulty Tuning (`SKILL_PRESETS`)
### Difficulty Tuning (`SKILL_PRESETS`)
*   **Easier AI**: Lower `corneringGrip` (e.g., 0.75). They slow down more for corners.
*   **Hard AI**: **Pro Physics (0.98)**. They drive at 98% of the vehicle's theoretical limit. They no longer cheat with extra grip; instead, they use optimal braking and racing lines.

## 3. Braking Logic
Braking is reactive and physics-based.
*   **Anticipation**: The AI looks ahead a certain distance (`base + speed * factor`).
*   **Trigger**: If the current speed > the target speed of a future point, braking begins.
*   **Aggression**: Adjusted via `brakingLookaheadFactor` (in `SKILL_PRESETS`) and `brakeAggro`.
    *   **brakingLookaheadFactor**: Controls how far ahead the AI looks for corners.
        *   High Speed requires Higher Factor (e.g. 1.5) to prevent overshooting.
    *   **brakeAggro**: Multiplier for braking force.
        *   Higher (> 1.0) = Uses full braking power (Threshold braking).
        *   Lower (< 0.8) = Gentle/Early braking.

## 4. Pro Control Loop (Smoothing)
To mimic human pro drivers, the AI uses:
1.  **Input Filtering**: Outputs are passed through a low-pass filter (LPF) to simulate the physical travel time of pedals and steering wheel, preventing jerky inputs.
2.  **Trail Braking**: Braking is blended out as steering increases, following the "Traction Circle" concept.
3.  **Smooth Throttle**: Throttle is rolled off smoothly during high-steering events to prevent understeer, rather than being cut abruptly.

### 1.2. MCP (Minimum Curvature Path) Algorithm
The **MCP** algorithm generates racing lines using iterative optimization to minimize path curvature. Unlike the anchor-based approach, MCP considers the entire path holistically.

#### How MCP Works
1. **Resample centerline** evenly by arc length (default: 800 points)
2. **Compute geometry**: tangents and normals at each point
3. **Represent path** as `p[i] = centerline[i] + normal[i] * offset[i]`
4. **Iteratively optimize** offsets to minimize curvature:
   - Calculate second differences as curvature proxy: `d2[i] = p[i-1] - 2*p[i] + p[i+1]`
   - Push against curvature: `offset[i] += alpha * dot(d2[i], normal[i])`
   - Add regularization to prevent jitter: `offset[i] -= beta * (offset[i-1] - 2*offset[i] + offset[i+1])`
   - Clamp to track bounds each iteration
5. **Final smoothing** pass for visual quality

#### MCP Configuration
Default parameters (in `ai/mcp_racing_line.js`):
- **`numSamples`**: 800 - Points to resample centerline
- **`iterations`**: 120 - Optimization iterations
- **`alpha`**: 0.35 - Step size for curvature reduction
- **`beta`**: 0.08 - Regularization strength (smoothness)
- **`margin`**: 8px - Safety margin from track edges
- **`finalSmoothingPasses`**: 8 - Post-optimization smoothing
- **`finalSmoothingStrength`**: 0.4 - Smoothing strength (0-1)

#### When to Use MCP
✅ **Use MCP for:**
- Smoother, more natural racing lines
- Tracks with gentle, flowing curves
- Competitive lap times (often 10-25% shorter than centerline)
- AI that takes more "geometric" optimal paths

⚠️ **Stick with Anchor for:**
- Tracks with tight hairpins (anchor handles these better)
- More "realistic" human-like racing lines with visible entry/apex/exit points
- Traditional racing line behavior

#### Comparison
| Metric | Anchor-Based | MCP |
|--------|--------------|-----|
| **Line Length** | 1827px (test track) | 1361px (25% shorter) |
| **Boundary Violations** | 0 | 0 |
| **Self-Intersections** | 1 (minor) | 0 |
| **Computation Time** | ~5-10ms | ~20-40ms |
| **Visual Style** | Sharp at apices, linear between | Smooth throughout |
| **Hairpin Handling** | Excellent | Good |

### 1.3. Enabling MCP Mode
1. Open **AI Controls** panel in-game (Dev menu → AI Controls)
2. Set **Racing line algorithm** to "MCP (Minimum Curvature)"
3. The AI will regenerate the racing line and all opponents will follow the new path

### 1.4. Debug Visualization
The **Visualize line** dropdown lets you compare both algorithms:
- **Anchor Only**: Blue dashed line (default)
- **MCP Only**: Lime green dashed line
- **Both (A/B Compare)**: Both lines shown simultaneously

Enable **Show validation metrics** to display:
- Path length
- Boundary violations (red highlight if any)
- Self-intersections
- Minimum distance to track edge
- Average curvature

## Tuning Cheatsheet

### Anchor-Based Parameters
| Parameter | Location | Effect |
| :--- | :--- | :--- |
| **`apexThreshold`** | `buildRacingLine()` | **0.002**: Radius < ~500px = corner. Higher = fewer corners detected. |
| **`MIN_DISPLACEMENT_RATIO`** | `buildRacingLine()` | **0.15**: Minimum lateral displacement as ratio of half-width. Higher = more filtering. |
| **`MIN_CURVATURE_FOR_ANCHOR`** | `buildRacingLine()` | **0.002**: Entry/exit anchors on straighter sections are moved closer to apex. |
| **`CORNER_CURVATURE_THRESHOLD`** | `straightenPath()` | **0.005**: Skip straightening sections with curvature above this. |
| **`WAVERING_THRESHOLD`** | `straightenPath()` | **0.08**: Sensitivity for detecting unnecessary weaving. Lower = more aggressive straightening. |
| **`GENTLE_CURVE_THRESHOLD`** | `straightenPath()` | **0.0012**: Max curvature to allow S-curve straightening. |

### MCP Parameters
| Parameter | Location | Effect |
| :--- | :--- | :--- |
| **`numSamples`** | `DEFAULT_MCP_CONFIG` | **800**: Resolution of path sampling. Higher = more precise, slower. |
| **`iterations`** | `DEFAULT_MCP_CONFIG` | **120**: Optimization iterations. Higher = smoother, slower. |
| **`alpha`** | `DEFAULT_MCP_CONFIG` | **0.35**: Step size. Higher = faster convergence, risk of instability. |
| **`beta`** | `DEFAULT_MCP_CONFIG` | **0.08**: Regularization. Higher = smoother offsets, less responsive to curvature. |
| **`margin`** | `DEFAULT_MCP_CONFIG` | **8px**: Safety margin from walls. Increase for more conservative lines. |

### Common Parameters
| Parameter | Location | Effect |
| :--- | :--- | :--- |
| **`corneringGrip`** | `SKILL_PRESETS` | **Pro (1.02)**: Optimal. **Easy (0.75)**: Safe. |
| **`maxThrottle`** | `SKILL_PRESETS` | Global throttle multiplier. **1.5 (Hard)** is max attack. |
| **`straightSpeed`** | `DEFAULT_LINE_CFG` | **3000**: Caps the raw speed on straights. |
| **`brakingLookaheadFactor`** | `SKILL_PRESETS` | **Safe (1.6+)**. **Late Braking (1.15)**. |
| **`brakeAggro`** | `SKILL_PRESETS` | **Increase (1.8)**: Very hard braking. **Decrease**: Soft braking. |
