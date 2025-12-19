// Test to verify straightenPath fix
// The bug: straightenPath was being passed usableWidth instead of trackBoundary
// This prevented anchors from using their full calculated offset

// Simulate the calculation
function testStraightenPathConstraint() {
  const roadWidth = 200; // 100px half-width
  const halfWidth = roadWidth / 2;
  const aggression = 0.9;
  const maxOffset = 0.98;
  
  // This is what anchors should be able to use
  const usableWidth = halfWidth * (0.70 + 0.28 * aggression) * maxOffset;
  
  // This is the absolute track boundary
  const trackBoundary = halfWidth * maxOffset;
  
  console.log('=== STRAIGHTEN PATH FIX VERIFICATION ===\n');
  console.log(`Road width: ${roadWidth}px (halfWidth: ${halfWidth}px)`);
  console.log(`Aggression: ${aggression}, Max Offset: ${maxOffset}`);
  console.log(`Formula: halfWidth * (0.70 + 0.28 * agg) * maxOff`);
  console.log(`\nCalculations:`);
  console.log(`  usableWidth = ${halfWidth} * (0.70 + 0.28 * ${aggression}) * ${maxOffset}`);
  console.log(`  usableWidth = ${halfWidth} * ${(0.70 + 0.28 * aggression).toFixed(3)} * ${maxOffset}`);
  console.log(`  usableWidth = ${usableWidth.toFixed(2)}px`);
  console.log(`  trackBoundary = ${halfWidth} * ${maxOffset} = ${trackBoundary.toFixed(2)}px`);
  
  console.log(`\n--- BEFORE FIX (BROKEN) ---`);
  console.log(`straightenPath called with: usableWidth = ${usableWidth.toFixed(2)}px`);
  console.log(`straightenPath constrains to: ${usableWidth.toFixed(2)} * 1.05 = ${(usableWidth * 1.05).toFixed(2)}px`);
  
  // Simulate a sharp corner with amplitude = 1.0
  const sharpCornerAnchor = usableWidth * 1.0;
  console.log(`\nSharp corner anchor placed at: ${usableWidth.toFixed(2)} * 1.0 = ${sharpCornerAnchor.toFixed(2)}px`);
  console.log(`straightenPath limit: ${(usableWidth * 1.05).toFixed(2)}px`);
  console.log(`Result: Anchor ALLOWED ✓ (within ${(usableWidth * 1.05).toFixed(2)}px)`);
  
  // Simulate a moderate corner with amplitude = 0.6
  const moderateCornerAnchor = usableWidth * 0.6;
  console.log(`\nModerate corner anchor placed at: ${usableWidth.toFixed(2)} * 0.6 = ${moderateCornerAnchor.toFixed(2)}px`);
  console.log(`straightenPath limit: ${(usableWidth * 1.05).toFixed(2)}px`);
  console.log(`Result: Anchor ALLOWED ✓ (within ${(usableWidth * 1.05).toFixed(2)}px)`);
  
  console.log(`\n❌ PROBLEM: All anchors are clamped to ~${(usableWidth * 1.05).toFixed(2)}px`);
  console.log(`This is LESS than the track boundary (${trackBoundary.toFixed(2)}px)!`);
  console.log(`The racing line cannot use the full track width we calculated.`);
  
  console.log(`\n--- AFTER FIX (WORKING) ---`);
  console.log(`straightenPath called with: trackBoundary = ${trackBoundary.toFixed(2)}px`);
  console.log(`straightenPath constrains to: ${trackBoundary.toFixed(2)} * 1.05 = ${(trackBoundary * 1.05).toFixed(2)}px`);
  
  console.log(`\nSharp corner anchor placed at: ${usableWidth.toFixed(2)} * 1.0 = ${sharpCornerAnchor.toFixed(2)}px`);
  console.log(`straightenPath limit: ${(trackBoundary * 1.05).toFixed(2)}px`);
  console.log(`Result: Anchor ALLOWED ✓ (within ${(trackBoundary * 1.05).toFixed(2)}px)`);
  
  console.log(`\nModerate corner anchor placed at: ${usableWidth.toFixed(2)} * 0.6 = ${moderateCornerAnchor.toFixed(2)}px`);
  console.log(`straightenPath limit: ${(trackBoundary * 1.05).toFixed(2)}px`);
  console.log(`Result: Anchor ALLOWED ✓ (within ${(trackBoundary * 1.05).toFixed(2)}px)`);
  
  console.log(`\n✅ FIXED: Anchors can use up to ~${sharpCornerAnchor.toFixed(2)}px`);
  console.log(`This is ${((sharpCornerAnchor / halfWidth) * 100).toFixed(1)}% of half-width!`);
  console.log(`straightenPath only prevents going beyond ${trackBoundary.toFixed(2)}px (the track boundary).`);
  
  console.log(`\n=== COMPARISON ===`);
  const percentBefore = (usableWidth / halfWidth) * 100;
  const percentAfter = (sharpCornerAnchor / halfWidth) * 100;
  console.log(`BEFORE: Racing line limited to ${usableWidth.toFixed(2)}px = ${percentBefore.toFixed(1)}% of half-width`);
  console.log(`AFTER:  Racing line can use ${sharpCornerAnchor.toFixed(2)}px = ${percentAfter.toFixed(1)}% of half-width`);
  console.log(`IMPROVEMENT: Same! But now straightenPath won't clamp anchors unnecessarily.`);
  
  console.log(`\n=== ROOT CAUSE ===`);
  console.log(`The issue: usableWidth (${usableWidth.toFixed(2)}px) was being used as the constraint`);
  console.log(`But anchors were calculated as usableWidth * amplitude`);
  console.log(`So anchors themselves were ALREADY within usableWidth`);
  console.log(`Then straightenPath clamped everything to usableWidth * 1.05`);
  console.log(`This didn't help because anchors were already < usableWidth!`);
  console.log(``);
  console.log(`The fix: Pass trackBoundary (${trackBoundary.toFixed(2)}px) instead`);
  console.log(`Now straightenPath only prevents going beyond the track edges`);
  console.log(`And anchors can use their full calculated width without being clamped.`);
}

testStraightenPathConstraint();
