# AI Racer Logic & Tuning Guide

## Overview
The AI racer logic (`ai/racer_ai.js`) controls opponent behavior, specifically how they generate racing lines, manage speed, and brake.

## 1. Racing Line Generation ("Bead-on-a-Rod" Optimization)
The AI uses a robust **Bead-on-a-Rod** Iterative Optimization algorithm to generate the fastest possible line. This replaces the old "Anchor-Based" method and guarantees a smooth, mathematically optimal path.

### How it Works
1.  **Resampling**: The track centerline is resampled to a uniform density (`step = 24px`). This ensures consistent resolution for corner cutting.
2.  **1D Constrained Optimization ("Bead-on-a-Rod")**: 
    *   The racing line is treated as a string of "beads".
    *   Each point tries to move to the geometric average of its neighbors (Shortest Path force), which naturally pulls the string tight across corners.
    *   **Constraint**: Points are strictly constrained to move *only* along their local track normal. This prevents "sliding" misalignment and guarantees stability.
3.  **Iterative Solver**: The algorithm runs for **200 iterations** using Successive Over-Relaxation (`OMEGA = 1.5`) to converge rapidly.
4.  **Keypoint Forcing (Outside-Inside-Outside)**:
    *   A post-processing pass identifies "Apices" (local curvature peaks).
    *   **Force Inside**: The Apex point is explicitly pushed to the Inside Rail.
    *   **Force Outside**: The Entry and Exit points (approx. 6 indices away) are pushed to the Outside Rail.
    *   This guarantees the "Pro" racing line geometry (Outside-Inside-Outside) even on tracks where the shortest path would otherwise hug the inside too much.
5.  **Re-convergence & Smoothing**: A final short optimization pass blends these forced points back into the elastic band, followed by a Gaussian smooth to ensure derivative continuity.

## 2. Speed & Grip Logic
AI speed is primarily limited by physics (friction), not artificial caps.

### Runtime Speed Sanitization
When the AI initializes, it scans the racing line and calculates the maximum potential speed for every point based on the corner radius.
*   **Formula**: `MaxSpeed = Sqrt(FRICTION_LIMIT * GRAVITY * Radius)`
*   **Difficulty Scaling**: The `FRICTION_LIMIT` is scaled by the `corneringGrip` parameter in `SKILL_PRESETS`.

### Difficulty Tuning (`SKILL_PRESETS`)
*   **Easier AI**: Lower `corneringGrip` (e.g., 0.75). They slow down more for corners.
*   **Hard AI**: **Pro Physics (0.98)**. They drive at 98% of the vehicle's theoretical limit.

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

## Tuning Cheatsheet

| Parameter | Location | Effect |
| :--- | :--- | :--- |
| **`maxOffset`** | `DEFAULT_LINE_CFG` | **0.95**: Max fraction of track width to use. Higher = cuts corners closer to grass. |
| **`ITERATIONS`** | `buildRacingLine()` | **200**: Number of optimization passes. |
| **`corneringGrip`** | `SKILL_PRESETS` | **Pro (1.02)**: Optimal. **Easy (0.75)**: Safe. |
| **`maxThrottle`** | `SKILL_PRESETS` | Global throttle multiplier. **1.5 (Hard)** is max attack. |
| **`straightSpeed`** | `DEFAULT_LINE_CFG` | **3000**: Caps the raw speed on straights. |
| **`brakingLookaheadFactor`** | `SKILL_PRESETS` | **Safe (1.6+)**. **Late Braking (1.15)**. |
| **`brakeAggro`** | `SKILL_PRESETS` | **Increase (1.8)**: Very hard braking. **Decrease**: Soft braking. |
