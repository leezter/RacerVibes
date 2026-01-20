---
description: How to test the racing game visually in the browser
---

# Visual Testing Instructions

This workflow describes how to test the racing game visually, including how to zoom out to see the entire track.

## Starting the Game

1. Ensure the dev server is running:
   ```powershell
   npx http-server -p 8080 .
   ```

2. Open http://localhost:8080/racer.html in the browser

3. Click "TAP TO CONTINUE" to start the race

4. Wait for the countdown to finish

## Zooming Out to See the Full Track

The game has a `CAM_BASE_ZOOM` global variable that controls the camera zoom level. You can manipulate this via the browser console or JavaScript execution:

### Via Browser Console (Manual Testing)
1. Open browser DevTools (F12)
2. In the Console tab, run:
   ```javascript
   CAM_BASE_ZOOM = 0.2;  // Very zoomed out - see entire track
   ```
3. Adjust the value as needed:
   - `0.2` = Very zoomed out (full track view)
   - `0.5` = Medium zoom
   - `1.0` = Default zoom
   - Higher values = More zoomed in

### Via JavaScript Execution (Automated Testing)
When using browser automation, execute this JavaScript:
```javascript
(() => {
  CAM_BASE_ZOOM = 0.2;
  return 'Set CAM_BASE_ZOOM to 0.2';
})()
```

## Using the In-Game Dev Menu

1. Click the "Dev" button in the top-left corner during a race
2. Click "Scales" to access camera/zoom settings
3. Adjust "Camera distance" slider for zoom control

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
| `CAM_BASE_ZOOM` | Camera zoom level (lower = more zoomed out) |
| `playerCar` | Player car object with x, y, speed, angle properties |
| `TrackStore` | Track data storage |

## Quick Test Sequence for Track Visuals

// turbo-all
1. Navigate to http://localhost:8080/racer.html
2. Click "TAP TO CONTINUE"
3. Wait 5 seconds for race to start
4. Execute JavaScript: `CAM_BASE_ZOOM = 0.2`
5. Capture screenshot to verify track boundaries
