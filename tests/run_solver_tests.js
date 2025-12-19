/**
 * Node.js Test Runner for Racing Line Solver Tests
 * 
 * Run with: node tests/run_solver_tests.js
 */

// Mock window/global for Node.js environment
const global = globalThis;
global.window = global;

// Load the solver module
require('../racing_line_solver.js');

// Load the tests
require('./racing_line_solver_tests.js');

// Run all tests
console.log('\n');
const results = global.RacingLineSolverTests.runAll();
console.log('\n');

// Exit with appropriate code
process.exit(results.failed > 0 ? 1 : 0);
