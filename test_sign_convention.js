// Test to verify the sign convention issue

// Create a simple right turn (clockwise)
// Start at (0, 0), go right to (100, 0), then turn down to (100, -100)
const rightTurn = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 100, y: 0 },      // Turn starts here
  { x: 100, y: -50 },
  { x: 100, y: -100 },
];

// Calculate curvature at the turn point (index 2)
const prev = rightTurn[1];
const curr = rightTurn[2];
const next = rightTurn[3];

const v1x = curr.x - prev.x;
const v1y = curr.y - prev.y;
const v2x = next.x - curr.x;
const v2y = next.y - curr.y;
const len1 = Math.hypot(v1x, v1y) || 1;
const len2 = Math.hypot(v2x, v2y) || 1;
const t1x = v1x / len1;
const t1y = v1y / len1;
const t2x = v2x / len2;
const t2y = v2y / len2;
const cross = t1x * t2y - t1y * t2x;
const dot = t1x * t2x + t1y * t2y;
const angle = Math.atan2(cross, dot);
const avgLen = (len1 + len2) * 0.5 || 1;
const curvature = angle / avgLen;

console.log('=== RIGHT TURN TEST ===');
console.log('Path: Going RIGHT (east), then turning DOWN (south)');
console.log('This is a CLOCKWISE turn (turning right)');
console.log(`Curvature sign: ${Math.sign(curvature)} (${curvature.toFixed(6)})`);
console.log(`Cross product: ${cross.toFixed(4)}`);

// Calculate normal direction at turn
const dx = next.x - prev.x;
const dy = next.y - prev.y;
const len = Math.hypot(dx, dy) || 1;
const normalX = -dy / len;
const normalY = dx / len;

console.log(`\nNormal vector: (${normalX.toFixed(4)}, ${normalY.toFixed(4)})`);
console.log('Normal points to the LEFT of travel direction');

// For a RIGHT turn (clockwise), the INSIDE is on the RIGHT
// The RIGHT side is the NEGATIVE normal direction
console.log('\n=== INSIDE/OUTSIDE ANALYSIS ===');
console.log('For a RIGHT turn:');
console.log('  - INSIDE of turn = RIGHT side = -Normal direction');
console.log('  - OUTSIDE of turn = LEFT side = +Normal direction');
console.log(`  - Curvature sign = ${Math.sign(curvature)} (negative for right/clockwise)`);
console.log('\nCurrent code places apex at: sign * width');
console.log(`  - Apex position = ${Math.sign(curvature)} * width = ${Math.sign(curvature) > 0 ? '+' : '-'}width`);
console.log(`  - This means: ${Math.sign(curvature) > 0 ? 'LEFT (normal)' : 'RIGHT (-normal)'}`);
console.log(`  - For RIGHT turn, should be RIGHT (inside)`);
console.log(`  - Result: ${Math.sign(curvature) < 0 ? '✓ CORRECT' : '✗ WRONG'}`);

console.log('\n=== LEFT TURN TEST ===');
// Create a simple left turn (counter-clockwise)
// Start at (0, 0), go right to (100, 0), then turn up to (100, 100)
const leftTurn = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 100, y: 0 },      // Turn starts here
  { x: 100, y: 50 },
  { x: 100, y: 100 },
];

const prev2 = leftTurn[1];
const curr2 = leftTurn[2];
const next2 = leftTurn[3];

const v1x2 = curr2.x - prev2.x;
const v1y2 = curr2.y - prev2.y;
const v2x2 = next2.x - curr2.x;
const v2y2 = next2.y - curr2.y;
const len12 = Math.hypot(v1x2, v1y2) || 1;
const len22 = Math.hypot(v2x2, v2y2) || 1;
const t1x2 = v1x2 / len12;
const t1y2 = v1y2 / len12;
const t2x2 = v2x2 / len22;
const t2y2 = v2y2 / len22;
const cross2 = t1x2 * t2y2 - t1y2 * t2x2;
const curvature2 = Math.atan2(cross2, t1x2 * t2x2 + t1y2 * t2y2) / ((len12 + len22) * 0.5);

console.log('Path: Going RIGHT (east), then turning UP (north)');
console.log('This is a COUNTER-CLOCKWISE turn (turning left)');
console.log(`Curvature sign: ${Math.sign(curvature2)} (${curvature2.toFixed(6)})`);
console.log('\nFor a LEFT turn:');
console.log('  - INSIDE of turn = LEFT side = +Normal direction');
console.log('  - OUTSIDE of turn = RIGHT side = -Normal direction');
console.log(`  - Curvature sign = ${Math.sign(curvature2)} (positive for left/counter-clockwise)`);
console.log('\nCurrent code places apex at: sign * width');
console.log(`  - Apex position = ${Math.sign(curvature2)} * width = ${Math.sign(curvature2) > 0 ? '+' : '-'}width`);
console.log(`  - This means: ${Math.sign(curvature2) > 0 ? 'LEFT (normal)' : 'RIGHT (-normal)'}`);
console.log(`  - For LEFT turn, should be LEFT (inside)`);
console.log(`  - Result: ${Math.sign(curvature2) > 0 ? '✓ CORRECT' : '✗ WRONG'}`);

console.log('\n=== CONCLUSION ===');
console.log('The current sign convention appears CORRECT:');
console.log('  - Positive curvature (left turn) → apex at +width (left/inside) ✓');
console.log('  - Negative curvature (right turn) → apex at -width (right/inside) ✓');
console.log('\nBUT the issue reported is "stays within inside half before corners"');
console.log('This suggests the ENTRY is wrong, not the apex!');
console.log('\nEntry code: targetOffsets[entryIdx] = -apexSide * currentWidth');
console.log('For RIGHT turn (neg curvature): entry = -(-) * width = +width (LEFT)');
console.log('For RIGHT turn, we want to be on LEFT (outside) before turn ✓');
console.log('For LEFT turn (pos curvature): entry = -(+) * width = -width (RIGHT)');
console.log('For LEFT turn, we want to be on RIGHT (outside) before turn ✓');
console.log('\n→ Code looks mathematically correct!');
console.log('→ Issue must be elsewhere (parameter values, amplitude scaling, etc.)');
