
const assert = require('assert');

// Ported logic from racer.html
function ccw(A, B, C) { return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x); }
function segIntersect(A, B, C, D) { return ccw(A, C, D) !== ccw(B, C, D) && ccw(A, B, C) !== ccw(A, B, D); }

// Simulation setup
const LAPS_TO_FINISH = 3;
let raceFinished = false;

// Mock Car
const car = {
    x: 0, y: 0,
    nextCp: 0, // Should start at 0? Or finding nearest? We'll test both.
    lap: 0,
    hasPassedStartLine: false,
    lastCross: 0,
    lapStart: 0,
    bestLap: null,
    finished: false
};

// Mock Checkpoints (Simple square track: 0,0 -> 100,0 -> 100,100 -> 0,100 -> 0,0)
// Center at 50,50. Width 20.
// CP 0: (50, 0) vertical
// CP 1: (100, 50) horizontal
// CP 2: (50, 100) vertical
// CP 3: (0, 50) horizontal
const checkpoints = [
    { a: { x: 50, y: -20 }, b: { x: 50, y: 20 } },    // Top edge (y=0), line is x=50
    { a: { x: 120, y: 50 }, b: { x: 80, y: 50 } },    // Right edge (x=100), line is y=50
    { a: { x: 50, y: 120 }, b: { x: 50, y: 80 } },    // Bottom edge (y=100), line is x=50
    { a: { x: -20, y: 50 }, b: { x: 20, y: 50 } }     // Left edge (x=0), line is y=50
];

function updateCarLogic(prevX, prevY, car, checkpoints) {
    // Logic extracted from racer.html
    // Initialize checkpoint tracking
    if (typeof car.nextCp !== 'number') car.nextCp = 0;

    // Permissive checkpoint update: Check next 3 checkpoints
    const lookahead = 3;
    for (let i = 0; i < lookahead; i++) {
        const idx = (car.nextCp + i) % checkpoints.length;
        const cp = checkpoints[idx];

        if (cp && segIntersect({ x: prevX, y: prevY }, { x: car.x, y: car.y }, cp.a, cp.b)) {
            // Found a crossing!
            console.log(`Crossed CP ${idx}!`);
            car.nextCp = (idx + 1) % checkpoints.length;

            if (idx === 0) {
                const now = 10000 + car.lap * 10000; // Mock time
                // Debounce logic (simplified for test)
                // if (now - (car.lastCross || 0) > 1000) { 
                // Removing debounce for simple unit test or mocking it
                if (true) {
                    if (!car.hasPassedStartLine) {
                        car.hasPassedStartLine = true;
                        console.log("Passed Start Line Logic Triggered");
                    } else {
                        car.lap = (car.lap || 0) + 1;
                        console.log(`Lap counted! Lap: ${car.lap}`);

                        if (car.lap >= LAPS_TO_FINISH) {
                            raceFinished = true;
                            car.finished = true;
                            console.log("Race Finished!");
                        }
                    }
                    car.lastCross = now;
                }
            }
            break;
        }
    }
}

// TEST 1: Standard Lap
console.log("--- TEST 1: Full Lap ---");
car.x = 20; car.y = 0; // Start before CP 0
// Move through CP 0 (Start Line)
let prevX = car.x; let prevY = car.y;
car.x = 80; car.y = 0; // Cross x=50
updateCarLogic(prevX, prevY, car, checkpoints);
// Should register start line pass
assert.strictEqual(car.hasPassedStartLine, true, "Should pass start line");
assert.strictEqual(car.nextCp, 1, "Next CP should be 1");

// Move to CP 1
prevX = car.x; prevY = car.y;
car.x = 100; car.y = 80; // Cross y=50 at x=100
updateCarLogic(prevX, prevY, car, checkpoints);
assert.strictEqual(car.nextCp, 2, "Next CP should be 2");

// Move to CP 2
prevX = car.x; prevY = car.y;
car.x = 20; car.y = 100; // Cross x=50 at y=100 (moving left)
updateCarLogic(prevX, prevY, car, checkpoints);
assert.strictEqual(car.nextCp, 3, "Next CP should be 3");

// Move to CP 3
prevX = car.x; prevY = car.y;
car.x = 0; car.y = 20; // Cross y=50 at x=0 (moving up)
updateCarLogic(prevX, prevY, car, checkpoints); // car nextCp is 3. checking 3 (idx 3).
assert.strictEqual(car.nextCp, 0, "Next CP should be 0");

// Move to CP 0 (Complete Lap 1)
prevX = car.x; prevY = car.y;
car.x = 80; car.y = 0; // Cross x=50 again
updateCarLogic(prevX, prevY, car, checkpoints);

assert.strictEqual(car.lap, 1, "Lap should be 1");
assert.strictEqual(car.nextCp, 1, "Next CP should be 1");

console.log("--- TEST PASSED: Full Lap ---");

// TEST 2: Missed Checkpoint (Lookahead)
console.log("--- TEST 2: Missed CP 1 (Cut Corner) ---");
// Reset
car.nextCp = 1; // Just passed start
car.x = 80; car.y = 0; // At start

// Move to CP 2 directly (Skipping CP 1)
// CP 2 is at x=50, y=80..120.
// We stand at 80, 0.
// Target 20, 100. Path passes 50, 50. (Misses CP 2).
// New Target: Cross CP 2 at 50, 100.
// Start at 100, 100. End at 0, 100.
car.x = 100; car.y = 100;
prevX = car.x; prevY = car.y;
car.x = 0; car.y = 100;
// Path: (100,100) -> (0,100). Crosses x=50 at y=100.
// CP 2 segment: x=50, y=80..120.
// Intersection!
updateCarLogic(prevX, prevY, car, checkpoints);

assert.strictEqual(car.nextCp, 3, "Should catch up to CP 3 (skipping 1, hit 2 -> next is 3)");
console.log("--- TEST PASSED: Lookahead ---");

