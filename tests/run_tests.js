/**
 * Node.js Test Runner for Racing Line Tests
 * 
 * Run with: node run_tests.js
 */

// Mock window/global for Node.js environment
const global = globalThis;
global.window = global;
global.RacerUtils = {
  clamp: (v, min, max) => (v < min ? min : v > max ? max : v),
  lerp: (a, b, t) => a + (b - a) * t
};

// Load the AI module
require('../ai/racer_ai.js');

// Load the tests
require('./racing_line_tests.js');

// Run all tests
console.log('\n');
const results = global.RacingLineTests.runAll();
console.log('\n');

// Exit with appropriate code
process.exit(results.failed > 0 ? 1 : 0);
