# Racing Line Fix Summary

## Final Root Cause

After 15 commits and extensive debugging, the actual bug was found in the apex merging logic.

### The Bug

**Location:** `ai/racer_ai.js` lines 746-753 (before fix)

**Problem:** The code was merging **opposite-direction corners** that were close together:
```javascript
// BROKEN: Merges nearby apexes regardless of sign
let bestApex = toMerge[0];
for (const apex of toMerge) {
  if (apex.mag > bestApex.mag) {
    bestApex = apex;
  }
}
finalApices.push(bestApex);
```

**Why It Broke:**
1. A RIGHT turn (curvature: negative) and LEFT turn (curvature: positive) that are close together (e.g., in an S-curve)
2. Get merged into a SINGLE apex using the sign of whichever has higher magnitude
3. The entry anchor for one corner gets placed using the wrong sign
4. Result: Entry on INSIDE instead of OUTSIDE

**User's Symptom:** "The line only ever stays within the inside half of the track before corners"

### The Fix

**Commit:** 10bca46

**Solution:** Check for mixed signs before merging:
```javascript
// FIXED: Only merge same-direction corners
const signs = toMerge.map(a => a.sign);
const hasMixedSigns = signs.some(s => s !== signs[0]);

if (hasMixedSigns) {
  // Keep all apexes separate - don't merge opposite-direction corners
  finalApices.push(...toMerge);
} else {
  // Same direction: merge into one (e.g., long sweeping turn)
  let bestApex = toMerge[0];
  for (const apex of toMerge) {
    if (apex.mag > bestApex.mag) {
      bestApex = apex;
    }
  }
  finalApices.push(bestApex);
}
```

### Why Previous Fixes Didn't Work

| Commit | Fix Attempted | Why It Failed |
|--------|---------------|---------------|
| 88138a1 | Increased default aggression (0.5→0.8) | Parameters weren't being passed due to ternary bug |
| 929e654 | Improved apex merging, updated UI defaults | Parameters still not passed, AND apex merging still broken |
| dd190cf | Removed cached racing lines | Parameters still not passed, apex merging still broken |
| de5686c | Fixed parameter passing (ternary → nullish coalescing) | ✓ Parameters now passed, BUT apex merging still broken |
| 10bca46 | Fixed apex merging (don't merge opposite signs) | ✅ FULLY FIXED |

### Technical Details

**Merge Logic Purpose:**
- **Intended:** Combine multiple curvature peaks within a SINGLE long corner (e.g., hairpin with 3-4 local maxima)
- **Bug:** Was also merging DIFFERENT corners that happened to be close together

**Merge Threshold:** `max(n/8, 40)` points (~31 points or 360px)
- Appropriate for merging peaks within one hairpin
- Too aggressive for keeping S-curves separate

**Sign Convention (for reference):**
- Positive curvature = LEFT turn (counter-clockwise)
- Negative curvature = RIGHT turn (clockwise)
- Apex at `sign * width` = inside of turn
- Entry/Exit at `-sign * width` = outside of turn

### Test Coverage

Created diagnostic tools:
- `test_sign_convention.js` - Verified sign math is correct
- `test_apex_merging_fix.js` - Tests S-curve handling
- `diagnose_racing_line.html` - Browser diagnostic tool

### Impact

**Affected Tracks:**
- Any track with S-curves, chicanes, or close opposite-direction corners
- Examples: Monaco, Suzuka, Laguna Seca

**Fixed Behavior:**
- Racing line now properly goes to OUTSIDE before each corner
- Correct outside-inside-outside pattern for EVERY corner
- Line crosses centerline appropriately between opposite turns

### Combined Fixes

Both bugs needed to be fixed for the racing line to work:
1. ✅ Parameter passing (commit de5686c) - Fixed ternary operator bug
2. ✅ Apex merging (commit 10bca46) - Don't merge opposite-direction corners

Without BOTH fixes, the racing line remained broken.
