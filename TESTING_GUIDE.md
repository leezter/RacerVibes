# Top Speed Slider - Testing & Verification Guide

## Quick Verification Checklist

✅ **Implementation Complete** - All code changes committed
✅ **UI Added** - Slider appears in Vehicle Tweaker panel
✅ **Physics Integration** - Speed cap applied in physics step
✅ **Documentation** - Implementation summary and UI mockup created

---

## Test Plan

### Test 1: Basic Functionality
**Objective**: Verify the slider appears and can be adjusted

**Steps**:
1. Start a race (any vehicle, any track)
2. Press `D` key or click Dev button (top-left)
3. Click "Vehicle Tweaker" in dev menu
4. Expand the panel if collapsed
5. Scroll to "Physics Footprint" section

**Expected Result**:
- ✅ "Top speed" slider visible after "0-to-top mult"
- ✅ Slider range: 100 to 2000
- ✅ Default value displays: 10000
- ✅ Value updates when slider is moved

---

### Test 2: Speed Cap Enforcement
**Objective**: Verify the speed cap actually limits vehicle speed

**Steps**:
1. Continue from Test 1
2. Select "GT" vehicle from dropdown
3. Set "Top speed" slider to 300 px/s
4. Click "Sync active cars" button
5. Drive and accelerate to full speed
6. Observe speedometer (if visible) or use Dev panel to check speed

**Expected Result**:
- ✅ Vehicle accelerates normally
- ✅ Speed caps at approximately 300 px/s
- ✅ Vehicle maintains 300 px/s on straightaway
- ✅ Cannot exceed 300 px/s even with drafting/downhill

---

### Test 3: Per-Vehicle Configuration
**Objective**: Verify each vehicle can have different speed caps

**Setup**: Race with multiple AI cars of different types

**Steps**:
1. Open Vehicle Tweaker panel
2. Select "F1" from dropdown
3. Set "Top speed" to 500 px/s
4. Click "Sync active cars"
5. Select "GT" from dropdown
6. Set "Top speed" to 300 px/s
7. Click "Sync active cars"
8. Race and observe different vehicles

**Expected Result**:
- ✅ F1 cars cap at ~500 px/s
- ✅ GT cars cap at ~300 px/s
- ✅ Other vehicles unaffected (10000 px/s default)
- ✅ Each vehicle maintains its own limit

---

### Test 4: Global Mode
**Objective**: Verify "Global" selection affects all vehicles

**Steps**:
1. Open Vehicle Tweaker panel
2. Select "Global" from dropdown
3. Set "Top speed" to 400 px/s
4. Click "Sync active cars"
5. Observe all vehicles on track

**Expected Result**:
- ✅ All vehicles cap at 400 px/s
- ✅ Player and AI vehicles affected equally
- ✅ No vehicle type exempted

---

### Test 5: Reset Functionality
**Objective**: Verify reset restores default values

**Steps**:
1. Set various vehicles to different speed caps (e.g., F1=200, GT=300)
2. Select "F1" from dropdown
3. Click "Reset selection" button
4. Check the slider value
5. Repeat for other vehicles

**Expected Result**:
- ✅ Slider returns to 10000 (default)
- ✅ Speed cap removed (effectively unlimited)
- ✅ Vehicle returns to normal performance

---

### Test 6: Real-Time Application
**Objective**: Verify changes apply immediately without restart

**Steps**:
1. Start race and accelerate to full speed
2. While moving, open Vehicle Tweaker
3. Set "Top speed" to 200 px/s
4. Click "Sync active cars"
5. Observe immediate effect

**Expected Result**:
- ✅ Speed immediately reduces to 200 px/s if above
- ✅ No need to restart race
- ✅ Change persists until modified again

---

### Test 7: Acceleration Unchanged
**Objective**: Verify acceleration rate is NOT affected by speed cap

**Steps**:
1. Set "Top speed" to 500 px/s
2. Note time to reach 300 px/s (about 60% of cap)
3. Reset and set "Top speed" to 1000 px/s
4. Note time to reach 300 px/s again
5. Compare times

**Expected Result**:
- ✅ Time to reach 300 px/s is the same in both cases
- ✅ Acceleration curve identical up to the cap
- ✅ Only top speed differs, not acceleration

---

### Test 8: Physics Engine Compatibility
**Objective**: Verify cap works with both physics systems

**Test A - Custom Physics**:
- Normal gameplay uses custom physics
- Follow Test 2 steps
- Verify speed cap works

**Test B - Planck.js Physics** (if enabled):
- Enable Planck physics mode (if available)
- Follow Test 2 steps
- Verify speed cap works

**Expected Result**:
- ✅ Speed cap works with custom physics
- ✅ Speed cap works with Planck.js physics
- ✅ No physics glitches or jitter
- ✅ Smooth capping behavior

---

## Edge Cases

### Edge Case 1: Very Low Cap (100 px/s)
**Test**: Set cap to minimum (100 px/s)
**Expected**: Vehicle drives slowly but controllably, no crashes

### Edge Case 2: Maximum Cap (2000 px/s)
**Test**: Set cap to maximum (2000 px/s)
**Expected**: Most vehicles can't reach this naturally, no effect on normal gameplay

### Edge Case 3: Cap During Collision
**Test**: Set low cap while colliding with wall/car
**Expected**: Speed clamps properly, no physics explosion

### Edge Case 4: Rapid Slider Changes
**Test**: Rapidly move slider back and forth
**Expected**: No lag, crashes, or strange behavior

---

## Known Behaviors (Not Bugs)

1. **Default 10000 px/s**: This is intentionally high to not affect normal gameplay
2. **Slider range 100-2000**: Covers typical racing speeds; higher values unnecessary
3. **Speed cap persists**: Changes remain until manually reset or game reload
4. **No speed cap indicator**: Speed cap is not displayed on HUD (dev tool only)
5. **Acceleration rate unchanged**: This is by design - only max speed is limited

---

## Code Verification

Run these checks to verify the implementation:

```bash
# Check maxSpeed in all vehicle defaults
grep "maxSpeed:" physics.js

# Verify slider HTML element exists
grep "rv-veh-maxspeed" physics.js

# Confirm physics cap implementation
grep -A10 "Apply top speed cap" physics.js

# Check panel version is 1.2
grep "dataset.version = " physics.js
```

**Expected Output**:
- 5 vehicle types with maxSpeed: 10000
- 5 references to rv-veh-maxspeed
- Speed capping logic present
- Version shows '1.2'

---

## Troubleshooting

### Issue: Slider not visible
**Solution**: 
- Hard refresh page (Ctrl+Shift+R)
- Check you're in "Vehicle Tweaker" not "Dev tools"
- Scroll down in panel to "Physics Footprint" section

### Issue: Speed cap not working
**Solution**:
- Click "Sync active cars" button after changing slider
- Verify correct vehicle is selected in dropdown
- Check slider value is actually changed (not at default 10000)

### Issue: All vehicles affected when selecting one
**Solution**:
- Make sure "Global" is NOT selected in dropdown
- Check you clicked "Sync active cars" after selecting specific vehicle

### Issue: Changes don't persist
**Solution**:
- This is expected - changes are runtime only
- Settings reset on page reload (by design)

---

## Success Criteria

✅ All 8 main tests pass
✅ All 4 edge cases behave correctly  
✅ Code verification commands return expected output
✅ No console errors in browser
✅ No physics glitches or crashes
✅ Slider visible and functional in UI

---

## Files Modified

- **physics.js**: Main implementation (47 lines added/modified)

## Files Created (Documentation)

- **IMPLEMENTATION_SUMMARY.md**: Technical implementation details
- **UI_MOCKUP.html**: Visual mockup of the new slider
- **test_top_speed_slider.html**: Standalone test page
- **TESTING_GUIDE.md**: This file

---

## Screenshot

![Top Speed Slider UI](https://github.com/user-attachments/assets/308f0428-31f4-40e7-b002-771a83b90d86)

The new "Top speed" slider (highlighted in yellow) in the Physics Footprint section.
