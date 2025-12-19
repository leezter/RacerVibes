/**
 * Test suite for Optimal Racing Line algorithm
 * Run in Node.js environment
 */

// Mock window object for Node.js
global.window = global;
global.RacerUtils = {
  clamp: (v, min, max) => (v < min ? min : v > max ? max : v),
};

// Load the optimal line module
require('../ai/optimal_line.js');

console.log('=== Testing Optimal Racing Line Algorithm ===\n');

// Test 1: Basic circle track
console.log('Test 1: Circle Track');
const circleTrack = [];
const radius = 300;
const numPoints = 50;
for (let i = 0; i < numPoints; i++) {
  const angle = (i / numPoints) * Math.PI * 2;
  circleTrack.push({
    x: 600 + radius * Math.cos(angle),
    y: 500 + radius * Math.sin(angle),
  });
}

const roadWidth = 80;
const result1 = global.RacerOptimalLine.generate(circleTrack, roadWidth, {
  debugMode: true,
  iterations: 200,
});

if (result1 && result1.length > 0) {
  console.log('✓ Circle track generated successfully');
  console.log(`  Points: ${result1.length}`);
  
  // Check if line stays within bounds
  let violations = 0;
  for (const p of result1) {
    if (p.offset < p.aMin || p.offset > p.aMax) {
      violations++;
    }
  }
  console.log(`  Boundary violations: ${violations}`);
  
  if (violations === 0) {
    console.log('✓ All points within bounds');
  } else {
    console.log('✗ Some points violate bounds');
  }
} else {
  console.log('✗ Failed to generate racing line');
}

console.log('\n');

// Test 2: Straight track with gentle curves
console.log('Test 2: Gentle Wavy Track');
const wavyTrack = [];
const length = 1000;
const amplitude = 30;
const frequency = 3;
for (let i = 0; i < 100; i++) {
  const t = i / 100;
  wavyTrack.push({
    x: 100 + length * t,
    y: 400 + amplitude * Math.sin(t * Math.PI * 2 * frequency),
  });
}
// Close the loop
for (let i = 99; i > 0; i--) {
  const t = i / 100;
  wavyTrack.push({
    x: 100 + length * t,
    y: 700 - amplitude * Math.sin(t * Math.PI * 2 * frequency),
  });
}

const result2 = global.RacerOptimalLine.generate(wavyTrack, roadWidth, {
  debugMode: true,
  iterations: 200,
});

if (result2 && result2.length > 0) {
  console.log('✓ Wavy track generated successfully');
  console.log(`  Points: ${result2.length}`);
  
  // Calculate smoothness (max lateral step)
  let maxStep = 0;
  for (let i = 1; i < result2.length; i++) {
    const step = Math.abs(result2[i].offset - result2[i - 1].offset);
    maxStep = Math.max(maxStep, step);
  }
  console.log(`  Max lateral step: ${maxStep.toFixed(2)}px`);
  
  if (maxStep < 10) {
    console.log('✓ Line is smooth (low lateral variation)');
  } else {
    console.log('⚠ Line has some lateral variation');
  }
} else {
  console.log('✗ Failed to generate racing line');
}

console.log('\n');

// Test 3: Sharp corner (90 degrees)
console.log('Test 3: 90-Degree Corner');
const cornerTrack = [];
const straight1 = 300;
const cornerRadius = 100;
const cornerPoints = 25;

// Entry straight
for (let i = 0; i < 30; i++) {
  cornerTrack.push({ x: 500, y: 800 - (i / 30) * straight1 });
}

// 90-degree turn
const turnCenterX = 500 + cornerRadius;
const turnCenterY = 800 - straight1;
for (let i = 0; i <= cornerPoints; i++) {
  const angle = Math.PI + (i / cornerPoints) * (Math.PI / 2);
  cornerTrack.push({
    x: turnCenterX + cornerRadius * Math.cos(angle),
    y: turnCenterY + cornerRadius * Math.sin(angle),
  });
}

// Exit straight
for (let i = 1; i <= 30; i++) {
  cornerTrack.push({
    x: turnCenterX + cornerRadius + (i / 30) * straight1,
    y: turnCenterY,
  });
}

// Close loop
const endX = turnCenterX + cornerRadius + straight1;
for (let i = 1; i < 30; i++) {
  const t = i / 30;
  cornerTrack.push({ x: endX, y: turnCenterY + (800 - turnCenterY) * t });
}
for (let i = 1; i < 30; i++) {
  const t = i / 30;
  cornerTrack.push({ x: endX - (endX - 500) * t, y: 800 });
}

const result3 = global.RacerOptimalLine.generate(cornerTrack, roadWidth, {
  debugMode: true,
  iterations: 200,
});

if (result3 && result3.length > 0) {
  console.log('✓ Corner track generated successfully');
  console.log(`  Points: ${result3.length}`);
  
  // Check if line uses track width
  let maxOffset = 0;
  for (const p of result3) {
    maxOffset = Math.max(maxOffset, Math.abs(p.offset));
  }
  const halfWidth = roadWidth / 2 - 15; // account for safety margin
  const usagePercent = (maxOffset / halfWidth) * 100;
  console.log(`  Max offset: ${maxOffset.toFixed(1)}px (${usagePercent.toFixed(1)}% of available)`);
  
  if (maxOffset > 10) {
    console.log('✓ Line uses track width effectively');
  } else {
    console.log('⚠ Line stays close to centerline');
  }
} else {
  console.log('✗ Failed to generate racing line');
}

console.log('\n=== All tests completed ===');
