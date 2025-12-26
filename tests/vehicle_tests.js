/**
 * Vehicle Collider and Size Tests
 * 
 * Tests to validate that vehicle colliders and sizes are proportionally correct
 * and consistent with physics parameters.
 */

(function(global) {
  'use strict';

  // Expected vehicle profiles from racer.html CarProfiles
  const VEHICLE_PROFILES = {
    "F1":    { width: 18, length: 44, colliderWidth: 18, colliderLength: 44 },
    "GT":    { width: 24, length: 45, colliderWidth: 20, colliderLength: 39 },
    "Rally": { width: 18, length: 34, colliderWidth: 18, colliderLength: 34 },
    "Truck": { width: 29, length: 60, colliderWidth: 22, colliderLength: 58 },
    "Bubble": { width: 40, length: 40, colliderWidth: 16, colliderLength: 38 }
  };

  // Expected physics parameters (wheelbase values from physics.js)
  const VEHICLE_PHYSICS = {
    "F1":    { wheelbase: 42 },
    "GT":    { wheelbase: 36 },
    "Rally": { wheelbase: 34 },
    "Truck": { wheelbase: 57 },
    "Bubble": { wheelbase: 28 }
  };

  // Test suite
  const tests = [];

  // ============================================================
  // TEST 1: Verify all vehicles have valid dimensions
  // ============================================================
  tests.push({
    name: 'All vehicles have positive dimensions',
    fn: function() {
      for (const [vehicle, profile] of Object.entries(VEHICLE_PROFILES)) {
        if (profile.width <= 0 || profile.length <= 0) {
          return { pass: false, message: `${vehicle} has invalid dimensions: width=${profile.width}, length=${profile.length}` };
        }
        if (profile.colliderWidth <= 0 || profile.colliderLength <= 0) {
          return { pass: false, message: `${vehicle} has invalid collider dimensions: colliderWidth=${profile.colliderWidth}, colliderLength=${profile.colliderLength}` };
        }
      }
      return { pass: true, message: 'All vehicles have positive dimensions' };
    }
  });

  // ============================================================
  // TEST 2: Verify colliders are not larger than visual size
  // ============================================================
  tests.push({
    name: 'Colliders do not exceed visual dimensions',
    fn: function() {
      for (const [vehicle, profile] of Object.entries(VEHICLE_PROFILES)) {
        if (profile.colliderWidth > profile.width) {
          return { pass: false, message: `${vehicle} collider width (${profile.colliderWidth}) exceeds visual width (${profile.width})` };
        }
        if (profile.colliderLength > profile.length) {
          return { pass: false, message: `${vehicle} collider length (${profile.colliderLength}) exceeds visual length (${profile.length})` };
        }
      }
      return { pass: true, message: 'All colliders within visual bounds' };
    }
  });

  // ============================================================
  // TEST 3: Verify aspect ratios are reasonable (between 1.5 and 3.0)
  // ============================================================
  tests.push({
    name: 'Vehicle aspect ratios are reasonable',
    fn: function() {
      const MIN_RATIO = 1.5;
      const MAX_RATIO = 3.0;
      for (const [vehicle, profile] of Object.entries(VEHICLE_PROFILES)) {
        const ratio = profile.length / profile.width;
        if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
          return { pass: false, message: `${vehicle} aspect ratio (${ratio.toFixed(2)}) outside reasonable range [${MIN_RATIO}, ${MAX_RATIO}]` };
        }
      }
      return { pass: true, message: 'All vehicle aspect ratios reasonable' };
    }
  });

  // ============================================================
  // TEST 4: Verify wheelbase is smaller than vehicle length
  // ============================================================
  tests.push({
    name: 'Wheelbase does not exceed vehicle length',
    fn: function() {
      for (const [vehicle, profile] of Object.entries(VEHICLE_PROFILES)) {
        const physics = VEHICLE_PHYSICS[vehicle];
        if (!physics) {
          return { pass: false, message: `${vehicle} missing physics data` };
        }
        if (physics.wheelbase > profile.length) {
          return { pass: false, message: `${vehicle} wheelbase (${physics.wheelbase}) exceeds length (${profile.length})` };
        }
      }
      return { pass: true, message: 'All wheelbases within vehicle length' };
    }
  });

  // ============================================================
  // TEST 5: Verify Bubble dimensions are proportional
  // ============================================================
  tests.push({
    name: 'Bubble vehicle has appropriate dimensions',
    fn: function() {
      const bubble = VEHICLE_PROFILES["Bubble"];
      
      // Bubble should be compact and rounded (shorter than Rally)
      if (bubble.length >= VEHICLE_PROFILES["Rally"].length) {
        return { pass: false, message: `Bubble length (${bubble.length}) should be less than Rally (${VEHICLE_PROFILES["Rally"].length})` };
      }
      
      // Bubble should be wider than Rally (more rounded shape)
      if (bubble.width <= VEHICLE_PROFILES["Rally"].width) {
        return { pass: false, message: `Bubble width (${bubble.width}) should be greater than Rally (${VEHICLE_PROFILES["Rally"].width})` };
      }
      
      return { pass: true, message: `Bubble dimensions appropriate: ${bubble.width}x${bubble.length}` };
    }
  });

  // ============================================================
  // TEST 6: Verify collider proportions relative to visual size
  // ============================================================
  tests.push({
    name: 'Collider proportions are consistent',
    fn: function() {
      for (const [vehicle, profile] of Object.entries(VEHICLE_PROFILES)) {
        const widthRatio = profile.colliderWidth / profile.width;
        const lengthRatio = profile.colliderLength / profile.length;
        
        // Collider should be at least 70% of visual size
        if (widthRatio < 0.70 || lengthRatio < 0.70) {
          return { pass: false, message: `${vehicle} collider too small: width ratio=${widthRatio.toFixed(2)}, length ratio=${lengthRatio.toFixed(2)}` };
        }
        
        // Collider should not exceed 100% of visual size
        if (widthRatio > 1.0 || lengthRatio > 1.0) {
          return { pass: false, message: `${vehicle} collider exceeds visual: width ratio=${widthRatio.toFixed(2)}, length ratio=${lengthRatio.toFixed(2)}` };
        }
      }
      return { pass: true, message: 'All collider proportions consistent' };
    }
  });

  // ============================================================
  // TEST 7: Compare Bubble to other vehicles
  // ============================================================
  tests.push({
    name: 'Bubble size comparison with other vehicles',
    fn: function() {
      const bubble = VEHICLE_PROFILES["Bubble"];
      const comparisons = [];
      
      for (const [vehicle, profile] of Object.entries(VEHICLE_PROFILES)) {
        if (vehicle === "Bubble") continue;
        
        const sizeRatio = (bubble.width * bubble.length) / (profile.width * profile.length);
        comparisons.push(`${vehicle}: ${sizeRatio.toFixed(2)}x area`);
      }
      
      return { 
        pass: true, 
        message: `Bubble comparisons - ${comparisons.join(', ')}` 
      };
    }
  });

  // ============================================================
  // TEST 8: Verify wheelbase to length ratio is realistic
  // ============================================================
  tests.push({
    name: 'Wheelbase to length ratios are realistic',
    fn: function() {
      const MIN_RATIO = 0.70;  // Wheelbase should be at least 70% of length
      const MAX_RATIO = 0.98;  // But not too close to full length
      
      for (const [vehicle, profile] of Object.entries(VEHICLE_PROFILES)) {
        const physics = VEHICLE_PHYSICS[vehicle];
        if (!physics) continue;
        
        const ratio = physics.wheelbase / profile.length;
        if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
          return { 
            pass: false, 
            message: `${vehicle} wheelbase ratio (${ratio.toFixed(2)}) outside realistic range [${MIN_RATIO}, ${MAX_RATIO}]` 
          };
        }
      }
      
      return { pass: true, message: 'All wheelbase ratios realistic' };
    }
  });

  // ============================================================
  // TEST 9: Verify Bubble collider is proportional to visual
  // ============================================================
  tests.push({
    name: 'Bubble collider is properly proportioned',
    fn: function() {
      const bubble = VEHICLE_PROFILES["Bubble"];
      
      const widthRatio = bubble.colliderWidth / bubble.width;
      const lengthRatio = bubble.colliderLength / bubble.length;
      
      // Collider should be at least 85% of visual size for Bubble
      if (widthRatio < 0.85 || lengthRatio < 0.85) {
        return { 
          pass: false, 
          message: `Bubble collider too small: width ratio=${widthRatio.toFixed(2)}, length ratio=${lengthRatio.toFixed(2)}` 
        };
      }
      
      // Collider should not exceed visual size
      if (widthRatio > 1.0 || lengthRatio > 1.0) {
        return { 
          pass: false, 
          message: `Bubble collider exceeds visual: width ratio=${widthRatio.toFixed(2)}, length ratio=${lengthRatio.toFixed(2)}` 
        };
      }
      
      return { pass: true, message: `Bubble collider properly proportioned: ${bubble.colliderWidth}x${bubble.colliderLength} (${(widthRatio*100).toFixed(0)}%×${(lengthRatio*100).toFixed(0)}%)` };
    }
  });

  // ============================================================
  // TEST 10: Verify all vehicles are distinct sizes
  // ============================================================
  tests.push({
    name: 'All vehicles have unique dimensions',
    fn: function() {
      const sizes = [];
      
      for (const [vehicle, profile] of Object.entries(VEHICLE_PROFILES)) {
        const sizeKey = `${profile.width}x${profile.length}`;
        if (sizes.includes(sizeKey)) {
          return { 
            pass: false, 
            message: `Duplicate size found: ${sizeKey}` 
          };
        }
        sizes.push(sizeKey);
      }
      
      return { pass: true, message: `All ${sizes.length} vehicles have unique dimensions` };
    }
  });

  // ============================================================
  // Test Runner API
  // ============================================================
  function runTest(index) {
    if (index < 0 || index >= tests.length) {
      return { pass: false, message: 'Invalid test index' };
    }
    
    const test = tests[index];
    try {
      return test.fn();
    } catch (err) {
      return { pass: false, message: `Test error: ${err.message}` };
    }
  }

  function runAll() {
    const results = tests.map((test, idx) => {
      const result = runTest(idx);
      return { ...result, name: test.name };
    });
    
    const passed = results.filter(r => r.pass).length;
    const failed = results.length - passed;
    
    return { results, passed, failed };
  }

  // Export test suite
  global.VehicleTests = {
    tests: tests.map(t => ({ name: t.name })),
    runTest,
    runAll,
    profiles: VEHICLE_PROFILES,
    physics: VEHICLE_PHYSICS
  };

})(window);
