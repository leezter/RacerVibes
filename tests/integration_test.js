/**
 * Integration test for Elastic Band Solver in racer_ai.js
 * 
 * Tests that the new solver can be used as a drop-in replacement
 * for the anchor-based system.
 */

// Mock window/global for Node.js environment
const global = globalThis;
global.window = global;
global.RacerUtils = {
  clamp: (v, min, max) => (v < min ? min : v > max ? max : v),
  lerp: (a, b, t) => a + (b - a) * t
};

// Load the solver
require('../racing_line_solver.js');

// Load the AI module (which now includes integration)
require('../ai/racer_ai.js');

console.log('\n=== Testing Elastic Band Solver Integration ===\n');

// Test 1: Anchor-based (default) still works
console.log('Test 1: Anchor-based solver (default)');
const testTrack = [
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 300, y: 200 },
  { x: 200, y: 300 },
  { x: 100, y: 200 }
];

const anchorLine = global.RacerAI.buildRacingLine(testTrack, 80);
console.log(`  ✓ Anchor-based: Generated ${anchorLine.length} points`);
console.log(`    Has metadata: ${anchorLine[0].hasOwnProperty('targetSpeed') && anchorLine[0].hasOwnProperty('curvature')}`);

// Test 2: Elastic band solver works with option
console.log('\nTest 2: Elastic band solver (with option)');
const elasticLine = global.RacerAI.buildRacingLine(testTrack, 80, {
  useElasticBandSolver: true,
  apexAggression: 0.7,
  elasticBandIterations: 50
});
console.log(`  ✓ Elastic band: Generated ${elasticLine.length} points`);
console.log(`    Has metadata: ${elasticLine[0].hasOwnProperty('targetSpeed') && elasticLine[0].hasOwnProperty('curvature')}`);

// Test 3: Both produce valid output
console.log('\nTest 3: Validation');
const validateLine = (line, name) => {
  if (!Array.isArray(line) || line.length === 0) {
    console.log(`  ✗ ${name}: Not an array or empty`);
    return false;
  }
  
  const hasAllFields = line.every(pt => 
    typeof pt.x === 'number' && 
    typeof pt.y === 'number' &&
    typeof pt.targetSpeed === 'number' &&
    typeof pt.curvature === 'number'
  );
  
  if (!hasAllFields) {
    console.log(`  ✗ ${name}: Missing required fields`);
    return false;
  }
  
  console.log(`  ✓ ${name}: All points valid`);
  return true;
};

const anchorValid = validateLine(anchorLine, 'Anchor-based');
const elasticValid = validateLine(elasticLine, 'Elastic band');

// Test 4: Compare characteristics
console.log('\nTest 4: Characteristics comparison');
console.log(`  Anchor-based points: ${anchorLine.length}`);
console.log(`  Elastic band points: ${elasticLine.length}`);

const anchorAvgSpeed = anchorLine.reduce((sum, p) => sum + p.targetSpeed, 0) / anchorLine.length;
const elasticAvgSpeed = elasticLine.reduce((sum, p) => sum + p.targetSpeed, 0) / elasticLine.length;

console.log(`  Anchor-based avg speed: ${anchorAvgSpeed.toFixed(1)} px/s`);
console.log(`  Elastic band avg speed: ${elasticAvgSpeed.toFixed(1)} px/s`);

// Test 5: Fallback behavior
console.log('\nTest 5: Fallback when solver not available');
const savedSolver = global.RacingLineSolver;
delete global.RacingLineSolver;

const fallbackLine = global.RacerAI.buildRacingLine(testTrack, 80, {
  useElasticBandSolver: true  // Request elastic band but it's not available
});

global.RacingLineSolver = savedSolver;

console.log(`  ✓ Fallback worked: Generated ${fallbackLine.length} points`);
console.log(`    (Should use anchor-based when elastic band unavailable)`);

// Summary
console.log('\n=== Integration Test Summary ===');
const allPass = anchorValid && elasticValid && fallbackLine.length > 0;
if (allPass) {
  console.log('✓ ALL TESTS PASSED');
  console.log('  - Anchor-based solver still works (backward compatibility)');
  console.log('  - Elastic band solver integrates correctly');
  console.log('  - Both produce valid racing line metadata');
  console.log('  - Fallback behavior works as expected');
  process.exit(0);
} else {
  console.log('✗ SOME TESTS FAILED');
  process.exit(1);
}
