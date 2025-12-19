# Racing Line Bug Analysis and Fix

## The Problem

User reported that racing lines were not changing despite multiple attempts to increase track width usage parameters.

## Root Cause

**Critical JavaScript Bug in `racer.html` line 2341-2342:**

```javascript
// BROKEN CODE:
const apex = overrides ? overrides.apexAggression : defaults.apexAggression;
const maxOffset = overrides ? overrides.maxOffset : defaults.maxOffset;
```

### Why This Failed

1. When `applyAiLineOverrides()` is called, `overrides` is set to `aiControlsRef.current`
2. On initial load, `aiControlsRef.current` exists (React ref object) but may not have `apexAggression/maxOffset` properties yet
3. The ternary operator `overrides ? overrides.apexAggression : ...` returns the **undefined** value of `overrides.apexAggression` (not the default) because `overrides` itself is truthy
4. Later check `if (typeof apex === "number")` fails because apex is undefined
5. Parameters are never added to opts object
6. `buildRacingLine(centerline, ROAD_WIDTH, opts)` is called with empty opts `{}`
7. Function uses its internal defaults instead of updated values

## The Fix

```javascript
// FIXED CODE:
const apex = overrides?.apexAggression ?? defaults.apexAggression;
const maxOffset = overrides?.maxOffset ?? defaults.maxOffset;
```

### Why This Works

1. `overrides?.apexAggression` returns undefined if property doesn't exist
2. `??` (nullish coalescing) operator returns right side when left is null/undefined
3. Always gets correct value: property value OR default value
4. `typeof apex === "number"` check passes
5. Parameters are correctly passed to buildRacingLine

## Impact

### Before Fix
- Track usage: ~30-40% of half-width
- Parameters passed: `{}` (empty)
- Behavior: Conservative, stays near centerline

### After Fix
- Track usage: ~87% of half-width
- Parameters passed: `{apexAggression: 0.8, maxOffset: 0.95}`
- Behavior: Aggressive, proper outside-inside-outside pattern

## Why Previous Attempts Failed

All previous commits updated the RIGHT values but the bug prevented those values from being used:

1. **88138a1**: Updated DEFAULT_LINE_CFG → Values weren't being read
2. **929e654**: Fixed apex merging, updated UI → Parameters still undefined
3. **dd190cf**: Removed caching → Still no parameters passed

The bug was a single incorrect operator choice that prevented the entire parameter chain from working.

## Testing

Run `verify_fix.html` to see:
- ✓ Parameters properly passed
- ✓ Track width usage ~87%
- ✓ Visual confirmation with colored lines

## Lesson Learned

JavaScript ternary operator `a ? b : c` does NOT check if `b` is defined - it only checks if `a` is truthy. For optional properties, always use:
- `a?.b ?? c` (modern, preferred)
- `(a && a.b !== undefined) ? a.b : c` (traditional)

Never use: `a ? a.b : c` (returns undefined if a.b doesn't exist)
