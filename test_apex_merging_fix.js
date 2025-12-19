// Test to verify the apex merging fix for opposite-direction corners

// Load dependencies
const fs = require('fs');
const path = require('path');

// Create a minimal RacerUtils mock
global.RacerUtils = {
  clamp: (v, min, max) => (v < min ? min : v > max ? max : v),
  lerp: (a, b, t) => a + (b - a) * t
};

// Load racer_ai.js
const racerAiPath = path.join(__dirname, 'ai/racer_ai.js');
const racerAiCode = fs.readFileSync(racerAiPath, 'utf-8');
eval(racerAiCode);

console.log('=== APEX MERGING FIX TEST ===\n');

// Create a test track with an S-curve:
// Straight → RIGHT turn → Straight → LEFT turn → Straight
const track = [];
const segLen = 10;

// Straight section going east
for (let x = 0; x <= 200; x += segLen) {
  track.push({ x, y: 0 });
}

// RIGHT turn (clockwise) - quarter circle
const r1 = 80;
const cx1 = 200;
const cy1 = -r1;
for (let ang = 0; ang <= Math.PI / 2; ang += Math.PI / 20) {
  track.push({
    x: cx1 + r1 * Math.cos(ang),
    y: cy1 + r1 * Math.sin(ang)
  });
}

// Short straight going south
for (let y = -80; y >= -120; y -= segLen) {
  track.push({ x: 200, y });
}

// LEFT turn (counter-clockwise) - quarter circle
const r2 = 80;
const cx2 = 200 - r2;
const cy2 = -120;
for (let ang = 0; ang <= Math.PI / 2; ang += Math.PI / 20) {
  track.push({
    x: cx2 - r2 * Math.sin(ang),
    y: cy2 - r2 * Math.cos(ang)
  });
}

// Straight going west
for (let x = 120; x >= -100; x -= segLen) {
  track.push({ x, y: -200 });
}

console.log(`Test track: ${track.length} points`);
console.log('Pattern: Straight → RIGHT turn → Short straight → LEFT turn → Straight');
console.log('This is an S-curve pattern\n');

// Generate racing line
const roadWidth = 100;
const racingLine = RacerAI.buildRacingLine(track, roadWidth, {
  apexAggression: 0.8,
  maxOffset: 0.95
});

if (!racingLine || racingLine.length === 0) {
  console.log('❌ FAIL: Failed to generate racing line');
  process.exit(1);
}

console.log(`Racing line: ${racingLine.length} points\n`);

// Analyze offsets in different sections
function analyzeSection(name, startRatio, endRatio) {
  const start = Math.floor(racingLine.length * startRatio);
  const end = Math.floor(racingLine.length * endRatio);
  const offsets = [];
  
  for (let i = start; i < end && i < racingLine.length; i++) {
    const rlPt = racingLine[i];
    const trackIdx = Math.floor(i * track.length / racingLine.length);
    const centerPt = track[Math.min(trackIdx, track.length - 1)];
    
    const dx = rlPt.x - centerPt.x;
    const dy = rlPt.y - centerPt.y;
    
    // Calculate signed offset
    const nextTrackIdx = Math.min(trackIdx + 1, track.length - 1);
    const travelDx = track[nextTrackIdx].x - centerPt.x;
    const travelDy = track[nextTrackIdx].y - centerPt.y;
    const travelLen = Math.hypot(travelDx, travelDy) || 1;
    const cross = (dx * travelDy - dy * travelDx) / travelLen;
    const signedOffset = Math.hypot(dx, dy) * Math.sign(cross);
    
    offsets.push(signedOffset);
  }
  
  const avg = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const side = avg > 5 ? 'LEFT ' : avg < -5 ? 'RIGHT' : 'CENTER';
  console.log(`${name.padEnd(25)}: ${avg.toFixed(1).padStart(7)}px (${side})`);
  return avg;
}

console.log('Offset Analysis:');
console.log('─'.repeat(50));

const entry1 = analyzeSection('RIGHT turn entry', 0.15, 0.20);
const apex1 = analyzeSection('RIGHT turn apex', 0.22, 0.27);
const exit1 = analyzeSection('RIGHT turn exit', 0.29, 0.34);

const mid = analyzeSection('Middle straight', 0.40, 0.50);

const entry2 = analyzeSection('LEFT turn entry', 0.60, 0.65);
const apex2 = analyzeSection('LEFT turn apex', 0.67, 0.72);
const exit2 = analyzeSection('LEFT turn exit', 0.74, 0.79);

console.log('─'.repeat(50));
console.log('\n=== EXPECTED PATTERN ===');
console.log('RIGHT turn:');
console.log('  Entry (outside) = LEFT side  = positive offset');
console.log('  Apex  (inside)  = RIGHT side = negative offset');
console.log('  Exit  (outside) = LEFT side  = positive offset');
console.log('\nLEFT turn:');
console.log('  Entry (outside) = RIGHT side = negative offset');
console.log('  Apex  (inside)  = LEFT side  = positive offset');
console.log('  Exit  (outside) = RIGHT side = negative offset');

console.log('\n=== ACTUAL RESULTS ===');

// Check RIGHT turn
console.log('\nRIGHT turn:');
const rightEntry = entry1 > 10 ? '✓ LEFT (outside)' : entry1 < -10 ? '✗ RIGHT (inside!)' : '✗ CENTER';
const rightApex = apex1 < -10 ? '✓ RIGHT (inside)' : apex1 > 10 ? '✗ LEFT (outside!)' : '✗ CENTER';
const rightExit = exit1 > 10 ? '✓ LEFT (outside)' : exit1 < -10 ? '✗ RIGHT (inside!)' : '✗ CENTER';

console.log(`  Entry: ${rightEntry}`);
console.log(`  Apex:  ${rightApex}`);
console.log(`  Exit:  ${rightExit}`);

// Check LEFT turn
console.log('\nLEFT turn:');
const leftEntry = entry2 < -10 ? '✓ RIGHT (outside)' : entry2 > 10 ? '✗ LEFT (inside!)' : '✗ CENTER';
const leftApex = apex2 > 10 ? '✓ LEFT (inside)' : apex2 < -10 ? '✗ RIGHT (outside!)' : '✗ CENTER';
const leftExit = exit2 < -10 ? '✓ RIGHT (outside)' : exit2 > 10 ? '✗ LEFT (inside!)' : '✗ CENTER';

console.log(`  Entry: ${leftEntry}`);
console.log(`  Apex:  ${leftApex}`);
console.log(`  Exit:  ${leftExit}`);

// Overall test result
const allCorrect = 
  entry1 > 10 && apex1 < -10 && exit1 > 10 &&  // RIGHT turn pattern
  entry2 < -10 && apex2 > 10 && exit2 < -10;    // LEFT turn pattern

console.log('\n=== TEST RESULT ===');
if (allCorrect) {
  console.log('✅ PASS: Racing line uses correct outside-inside-outside pattern for both turns');
  process.exit(0);
} else {
  console.log('❌ FAIL: Racing line pattern is incorrect');
  console.log('\nIssue: Corners may be getting merged with wrong signs');
  console.log('Fix: Updated apex merging to NOT merge opposite-direction corners');
  process.exit(1);
}
