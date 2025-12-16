# AI Racer Logic & Tuning Guide

## Overview
The AI racer logic (`ai/racer_ai.js`) controls opponent behavior, specifically how they generate racing lines, manage speed, and brake.

## 1. Racing Line Generation ("Anchor-Based")
The AI uses an **Anchor-Based** algorithm to generate the optimal racing line. This replaces previous continuous-curvature methods to ensure a smooth, professional line.

### How it Works
1.  **Apex Detection**: The algorithm identifies "events" (corners) by finding local maxima in the track's curvature.
2.  **Compound Turn Detection**: Consecutive turns in the same direction are analyzed. If they are connected by a curve or are very close (gap < ~600px), they are merged into a single compound turn by removing the intermediate "Exit" and "Entry" anchors. This prevents unnecessary side-swapping on lumpy corners.
3.  **Anchor Placement & Severity Scaling**: For each corner, it places three key anchors (Entry, Apex, Exit).
    *   **Amplitude Scaling**: The lateral offset of the anchors is scaled by the **Curvature Severity**.
    *   **Gentle Bends**: Low severity -> Small offset (stay near center).
    *   **Sharp Turns**: High severity -> Full offset (use full track width).
    *   **Compound Exits**: As a complex turn opens up, the reduced severity allows the AI to naturally drift away from the inside edge.
4.  **Linear Interpolation**: The algorithm linearly interpolates between these anchors. This creates **Straight Diagonal Lines** between corners, which is the mathematically shortest path and prevents wobbling/center-hugging.
5.  **Smoothing & Relaxation**: A physics-based "elastic band" pass smooths the sharp corners at the anchors.
6.  **Path Straightening**: A chord-based optimization pass eliminates unnecessary weaving on "lumpy" track sections. It identifies segments where direction oscillates without significant net change and replaces them with straight lines when valid.

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

## Tuning Cheatsheet

| Parameter | Location | Effect |
| :--- | :--- | :--- |
| **`corneringGrip`** | `SKILL_PRESETS` | **Pro (1.02)**: Optimal. **Easy (0.75)**: Safe. |
| **`maxThrottle`** | `SKILL_PRESETS` | Global throttle multiplier. **1.5 (Hard)** is max attack. |
| **`straightSpeed`** | `DEFAULT_LINE_CFG` | **Must be 2600**. Caps the raw speed on straights. |
| **`brakingLookaheadFactor`** | `SKILL_PRESETS` | **Safe (1.6+)**. **Late Braking (1.15)**. |
| **`brakeAggro`** | `SKILL_PRESETS` | **Increase (1.8)**: Very hard braking. **Decrease**: Soft braking. |
