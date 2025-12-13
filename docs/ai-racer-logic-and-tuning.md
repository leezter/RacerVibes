# AI Racer Logic & Tuning Guide

## Overview
The AI racer logic (`ai/racer_ai.js`) controls opponent behavior, specifically how they follow the racing line and manage speed.

## Key Behaviors

### 1. Runtime Speed Sanitization
Racing line metadata (target speeds) saved with tracks can sometimes be unreliable or unphysically fast. To prevent AI from crashing, the controller **recalculates safe cornering speeds** when it initializes.
- **Mechanism**: Scans the racing line, calculates signed curvature, and applies a max speed limit based on physics (Friction ~1.25, Gravity 750).
- **Impact**: AI will always respect the physical curvature of the track, regardless of what the "target speed" property of the waypoint says.

### 2. Braking Logic
Braking is completely physics-based and does not use artificial speed scaling.
- **Anticipation**: The AI looks ahead by a distance calculated as `base + speed * brakingLookaheadSpeedFactor`.
- **Trigger**: Braking is triggered when `currentSpeed > futureCornerLimit`.
- **Intensity**: Deceleration is calculated to reach the target speed by the time the car reaches the corner.

## Tuning Guide (How to Adjust)

If you need to change AI behavior, look for `createController` in `ai/racer_ai.js`.

| Parameter | Location | Effect |
| :--- | :--- | :--- |
| **`brakingLookaheadSpeedFactor`** | `createController.update` | **Increase (e.g. 1.2 -> 1.5)**: AI sees corners sooner, brakes earlier and softer. <br>**Decrease**: AI brakes later and harder. |
| **`FRICTION_LIMIT`** | `createController` (Sanitization) | **Increase (1.25 -> 1.4)**: AI takes corners faster (riskier). <br>**Decrease**: AI slows down more for corners (safer). |
| **`SKILL_PRESETS`** | `ai/racer_ai.js` top-level | Adjust `brakeAggro`, `cornerMargin`, and `maxThrottle` per difficulty level. |

### Common Issues & Fixes
- **AI braking too late/skidding**: Increase `brakingLookaheadSpeedFactor`.
- **AI stopping/reversing**: Ensure the "Anti-reverse clamp" (checks speed < 20) remains active in the braking block.
- **AI taking corners too slowly**: Increase `FRICTION_LIMIT` in the sanitization block.
