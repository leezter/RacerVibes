// Test the anchor-based racing line algorithm
// Run with: node test_anchor_algorithm.js

// Mock globals
global.RacerUtils = {
  clamp: (v, min, max) => (v < min ? min : v > max ? max : v),
  lerp: (a, b, t) => a + (b - a) * t,
  toRad: (deg) => (deg * Math.PI) / 180,
};

// Load the racer_ai module
require('./ai/racer_ai.js');

function createSharpCorner() {
  // 90-degree corner
  const points = [];
  const r = 80;
  const cx = 400, cy = 300;
  
  // Approach (straight)
  for (let i = 0; i < 20; i++) {
    points.push({ x: cx - r - 100 + i * 5, y: cy - r });
  }
  
  // Corner (quarter circle)
  for (let i = 0; i <= 20; i++) {
    const angle = (Math.PI / 2) * (i / 20);
    points.push({
      x: cx - r * Math.cos(angle),
      y: cy - r + r * Math.sin(angle)
    });
  }
  
  // Exit (straight)
  for (let i = 1; i <= 20; i++) {
    points.push({ x: cx, y: cy + i * 5 });
  }
  
  return points;
}

function createHairpin() {
  // 180-degree hairpin
  const points = [];
  const r = 50;
  const cx = 400, cy = 300;
  
  // Approach
  for (let i = 0; i < 15; i++) {
    points.push({ x: cx - r - 80 + i * 5, y: cy });
  }
  
  // Hairpin (semi-circle)
  for (let i = 0; i <= 30; i++) {
    const angle = Math.PI * (i / 30);
    points.push({
      x: cx - r * Math.cos(angle),
      y: cy + r * Math.sin(angle)
    });
  }
  
  // Exit
  for (let i = 1; i <= 15; i++) {
    points.push({ x: cx + r + i * 5, y: cy });
  }
  
  return points;
}

function testTrack(centerline, trackWidth, testName) {
  console.log(`\n=== ${testName} ===`);
  console.log(`Centerline: ${centerline.length} points, Track width: ${trackWidth}px`);
  
  // Test with default values (should use apexAggression=0.8, maxOffset=0.95)
  const racingLine = global.RacerAI.buildRacingLine(centerline, trackWidth, {
    straightSpeed: 440
  });
  
  if (!racingLine || racingLine.length === 0) {
    console.log('❌ FAIL: No racing line generated!');
    return;
  }
  
  console.log(`Racing line: ${racingLine.length} points`);
  
  // Calculate offsets from centerline
  const offsets = [];
  const halfWidth = trackWidth / 2;
  
  for (let i = 0; i < Math.min(centerline.length, racingLine.length); i++) {
    const center = centerline[i];
    
    // Find closest racing line point
    let minDist = Infinity;
    let closestPoint = null;
    for (let j = 0; j < racingLine.length; j++) {
      const racing = racingLine[j];
      const dist = Math.hypot(racing.x - center.x, racing.y - center.y);
      if (dist < minDist) {
        minDist = dist;
        closestPoint = racing;
      }
    }
    
    if (closestPoint) {
      offsets.push(minDist);
    }
  }
  
  const maxOffset = Math.max(...offsets);
  const avgOffset = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const percentOfHalfWidth = (maxOffset / halfWidth * 100).toFixed(1);
  
  // Expected: With aggression=0.8 and maxOffset=0.95:
  // usableWidth = halfWidth * (0.65 + 0.33 * 0.8) * 0.95 = halfWidth * 0.868
  const expectedMax = halfWidth * 0.868;
  
  console.log(`Max offset: ${maxOffset.toFixed(1)}px (${percentOfHalfWidth}% of half-width)`);
  console.log(`Avg offset: ${avgOffset.toFixed(1)}px`);
  console.log(`Expected: ~${expectedMax.toFixed(1)}px (87% of half-width)`);
  
  // Check if it's using enough track width (at least 70% of expected)
  if (maxOffset >= expectedMax * 0.7) {
    console.log(`✓ PASS: Line uses adequate track width`);
  } else {
    console.log(`❌ FAIL: Line too conservative! Only ${percentOfHalfWidth}% vs expected 87%`);
  }
  
  // Show some sample points
  console.log(`\nSample offsets (first 10):`);
  for (let i = 0; i < Math.min(10, offsets.length); i++) {
    console.log(`  Point ${i}: ${offsets[i].toFixed(1)}px`);
  }
}

console.log('==========================================');
console.log('ANCHOR-BASED RACING LINE ALGORITHM TEST');
console.log('==========================================');
console.log('Testing default configuration:');
console.log('  apexAggression: 0.8 (from DEFAULT_LINE_CFG)');
console.log('  maxOffset: 0.95 (from DEFAULT_LINE_CFG)');
console.log('  Expected formula: halfWidth * (0.65 + 0.33 * 0.8) * 0.95');
console.log('  Expected result: ~87% of half-width');
console.log('==========================================');

testTrack(createSharpCorner(), 200, 'Sharp 90° Corner');
testTrack(createHairpin(), 200, '180° Hairpin');

console.log('\n==========================================');
console.log('TEST COMPLETE');
console.log('==========================================\n');
