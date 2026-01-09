# Time Trial Ghost Replay System

This document describes the ghost replay system used in Time Trial mode.

## Overview

The ghost replay feature allows players to race against a semi-transparent "ghost car" that replays their best lap. This helps players see where they can improve their times by comparing their current driving line to their personal best.

## How It Works

### Enabling Ghost Mode

The ghost system is **only active in Time Trial mode**. It is controlled by:

1. **Start Menu**: When entering Time Trial mode, a "Ghost" checkbox appears in the Race Settings screen (enabled by default)
2. **Payload**: The `ghostEnabled` flag is passed via `START_PAYLOAD` from `racer_start_menu.html` to `racer.html`
3. **Mode Check**: Ghost is only enabled when `state.gameMode === 'time_trial'` AND the checkbox is checked

### Key Variables (racer.html)

```javascript
// Line ~2605-2609
const GHOST_ENABLED = !!(START_PAYLOAD && START_PAYLOAD.ghostEnabled);
let ghostRecording = [];    // Current lap: {x, y, angle, t}
let bestLapGhost = null;    // Recording of the best lap
let ghostLapStartTime = 0;  // When current lap started
```

### Recording (Game Loop)

Every frame during a lap, if ghost is enabled, the player's position is recorded:

```javascript
// Line ~5311-5316
if (GHOST_ENABLED && player.hasPassedStartLine && ghostLapStartTime > 0) {
  const now = performance.now();
  const t = now - ghostLapStartTime;
  ghostRecording.push({ x: player.x, y: player.y, angle: player.angle, t });
}
```

### Saving Best Lap (Lap Completion)

When the player completes a lap:

1. If the lap time is a new personal best AND there's recorded data, save it to `bestLapGhost`
2. Reset `ghostRecording` for the next lap
3. Reset `ghostLapStartTime`

```javascript
// Line ~5035-5043
if (car === player && GHOST_ENABLED) {
  const isNewBest = !car.bestLap || lapTime < car.bestLap;
  if (isNewBest && ghostRecording.length > 0) {
    bestLapGhost = ghostRecording.slice(); // Copy recording
  }
  ghostRecording = [];
  ghostLapStartTime = now;
}
```

### Rendering the Ghost (Draw Loop)

The ghost car is drawn with interpolation for smooth playback:

```javascript
// Line ~4600-4641
if (GHOST_ENABLED && bestLapGhost && bestLapGhost.length > 1 && player.hasPassedStartLine) {
  // Find frames that bracket current time
  // Interpolate position between frames
  // Draw with transparency (globalAlpha = 0.4)
  // Ghost color: '#06d6a0' (teal/cyan)
}
```

## Visual Style

- **Color**: Teal/cyan (`#06d6a0`)
- **Transparency**: 40% opacity (`globalAlpha = 0.4`)
- **Size**: Same dimensions as player car

## Files Modified

| File | Changes |
|------|---------|
| `racer_start_menu.html` | Ghost checkbox UI, payload with `ghostEnabled` flag, mode check |
| `racer.html` | Ghost state variables, recording logic, lap save logic, rendering |

## Future Improvements

Potential enhancements:
- Persist best ghost to localStorage for cross-session ghost racing
- Allow importing/exporting ghost data
- Multiple ghost cars (show top 3 attempts)
- Ghost trail/path visualization
- Network ghosts (race against friends' ghosts)
