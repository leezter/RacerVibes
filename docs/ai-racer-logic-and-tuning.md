# AI Racer Logic & Tuning Guide

## Overview
The AI racer logic (`ai/racer_ai.js`) controls opponent behavior, specifically how they generate racing lines, manage speed, and brake.

## 1. Racing Line Generation ("Anchor-Based")
The AI uses an **Anchor-Based** algorithm to generate the optimal racing line. This replaces previous continuous-curvature methods to ensure a smooth, professional line.

### How it Works
1.  **Apex Detection**: The algorithm identifies "events" (corners) by finding local maxima in the track's curvature.
2.  **Anchor Placement**: For each corner, it places three key anchors:
    *   **Entry**: Outside of the track.
    *   **Apex**: Inside of the track (flipped based on turn direction).
    *   **Exit**: Outside of the track.
3.  **Linear Interpolation**: The algorithm linearly interpolates between these anchors. This creates **Straight Diagonal Lines** between corners, which is the mathematically shortest path and prevents wobbling/center-hugging.
4.  **Smoothing & Relaxation**: A final physics-based "elastic band" pass smooths the sharp corners at the anchors.

## 2. Speed & Grip Logic
AI speed is primarily limited by physics (friction), not artificial caps.

### Runtime Speed Sanitization
When the AI initializes, it scans the racing line and calculates the maximum potential speed for every point based on the corner radius.
*   **Formula**: `MaxSpeed = Sqrt(FRICTION_LIMIT * GRAVITY * Radius)`
*   **Difficulty Scaling**: The `FRICTION_LIMIT` is scaled by the `corneringGrip` parameter in `SKILL_PRESETS`.

### Difficulty Tuning (`SKILL_PRESETS`)
*   **Easier AI**: Lower `corneringGrip` (e.g., 0.85). They slow down more for corners.
*   **Hard AI**: Higher `corneringGrip` (e.g., 2.5). They assume "arcade-like" grip levels, allowing them to take corners significantly faster than the player physics might normally allow.

## 3. Braking Logic
Braking is reactive and physics-based.
*   **Anticipation**: The AI looks ahead a certain distance (`base + speed * factor`).
*   **Trigger**: If the current speed > the target speed of a future point, braking begins.
*   **Aggression**: Adjusted via `brakingLookaheadBase` and `brakingLookaheadSpeedFactor`.
    *   **Lower values** (e.g., Base 100, Factor 0.7) = Later, harder braking (More aggressive).
    *   **Higher values** = Earlier, softer braking.

## Tuning Cheatsheet

| Parameter | Location | Effect |
| :--- | :--- | :--- |
| **`corneringGrip`** | `SKILL_PRESETS` | **Increase (e.g. 2.5)**: AI corners much faster (Hard mode). <br>**Decrease (e.g. 0.85)**: AI corners slower. |
| **`maxThrottle`** | `SKILL_PRESETS` | Global throttle multiplier. Increase to make AI accelerate faster. |
| **`straightSpeed`** | `DEFAULT_LINE_CFG` | **Must be 2600**. Caps the raw speed on straights. |
| **`brakingLookaheadSpeedFactor`** | `createController` | **Decrease**: AI brakes later. **Increase**: AI brakes earlier. |
