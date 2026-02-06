---
description: How to test the racing game visually in the browser
---

# Visual Testing Instructions

This workflow describes how to test the racing game visually, including how to zoom out to see the entire track.

## Starting the Game

> [!CAUTION]
> **Browser Cache Issue**: The browser subagent CANNOT reliably clear the browser cache. `location.reload(true)` does NOT clear cached JavaScript files in modern browsers.

1. Ensure the dev server is running:
   ```powershell
   npx http-server -p 8080 .
   ```

2. **Clear browser cache for localhost:8080** (CRITICAL for testing code changes):
   
   **For Manual Testing:**
   - Open DevTools (F12)
   - Right-click the browser refresh button and select "Empty Cache and Hard Reload"
   - OR in DevTools > Network tab, check "Disable cache" (stays active while DevTools is open)
   
   **For Automated Agent Testing:**
   - The browser subagent CANNOT clear the cache reliably
   - Instead, use a cache-busting query parameter:
     ```javascript
     window.location.href = 'http://localhost:8080/racer.html?v=' + Date.now();
     ```
   - OR ask the user to manually clear the browser cache before testing
   - **If testing critical code changes, STOP and ask the user to verify the changes manually**

3. Open http://localhost:8080/racer.html in the browser (for the start menu: http://localhost:8080/racer_start_menu.html)

4. Click "TAP TO CONTINUE" to start the race

5. Wait for the countdown to finish

## Camera and Resolution Testing (Critical)

Use the in-game camera controls. Do **not** rely on mutating `CAM_BASE_ZOOM` from console.

### Manual path
1. Click the "Dev" button in the top-left corner during a race.
2. Click "Scales".
3. Use "Camera distance" slider to control zoom.

### Automated path
Use localStorage + cache-busting reload so values are applied reliably:
```javascript
(() => {
  localStorage.setItem('cameraDistance', '1.6');
  localStorage.setItem('graphicsQuality', 'high');
  window.location.href = 'http://localhost:8080/racer.html?v=' + Date.now();
  return 'Applied cameraDistance/high quality and reloading';
})()
```

## Resolution Change Regression Checklist

When testing a change to resolution or quality logic, verify all of these:

1. Set graphics quality to `high`; set camera distance to a known value (for example `1.6`).
2. Capture a baseline screenshot at 1920x1080 (or the largest practical viewport).
3. Switch quality between `high`, `medium`, and `low` and confirm camera distance stays the same.
4. Test multiple viewport sizes (for example 360x640, 844x390, 1280x720, 1920x1080) and confirm camera distance stays the same.
5. Open `http://localhost:8080/tests/resolution_test.html` and click "Run Camera Test".

If any check fails, inspect these runtime contracts in `racer.html`:

- `sizeBackbufferToViewport()` must derive `baseDisplayScaleRef` from `canvas.width / BASE_WORLD_W`.
- `computeCameraZoom()` must use `CAMERA_SCALE_NORMALIZER` (1920x1080 baseline) and current ref values (`cameraDistanceRef`, `zoom*Ref`).
- Frame-loop camera updates must read ref-backed settings (to avoid stale closure behavior).

## Teleporting the Car

To quickly test different parts of the track:
```javascript
(() => {
  playerCar.x = 2500;  // X coordinate
  playerCar.y = 700;   // Y coordinate
  return 'Teleported car';
})()
```

## Useful Global Variables

| Variable | Purpose |
|----------|---------|
| `playerCar` | Player car object with x, y, speed, angle properties |
| `TrackStore` | Track data storage |
| `localStorage.cameraDistance` | Persisted camera distance slider value |
| `localStorage.graphicsQuality` | Persisted quality setting (`high`/`medium`/`low`) |

## Quick Test Sequence for Track Visuals

// turbo-all
1. Navigate to http://localhost:8080/racer.html
2. Click "TAP TO CONTINUE"
3. Wait 5 seconds for race to start
4. Open Dev > Scales, set camera distance to max
5. Capture screenshot to verify camera framing and track boundaries
