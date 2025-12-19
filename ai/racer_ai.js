(function (global) {
  const utils = global.RacerUtils || {};
  const clamp = utils.clamp || ((v, min, max) => (v < min ? min : v > max ? max : v));
  const lerp = utils.lerp || ((a, b, t) => a + (b - a) * t);

  const DEFAULT_LINE_CFG = {
    sampleStep: 6,
    smoothingPasses: 5,
    apexAggression: 0.9, // INCREASED: 0 = conservative (65% track width), 1 = aggressive (98% track width)  
    maxOffset: 0.98, // INCREASED: Maximum fraction of half-width to use
    minRadius: 12,
    roadFriction: 1.1,
    gravity: 750, // px/s^2 to roughly match RacerPhysics defaults
    straightSpeed: 3000, // INCREASED: Allow higher top speeds
    cornerSpeedFloor: 140,
  };
  const MAX_TARGET_SPEED = 3000; // ~220 mph

  // Racing line smoothing constants
  // Note: The racing line is computed once when track loads, not per-frame, so
  // these higher iteration counts are acceptable for silky smooth results.
  const CORNER_BLEND_FACTOR = 0.7; // How aggressively to blend toward entry/exit positions

  // Steering blend weights for following the racing line
  // Higher lookahead weight = smoother steering, car uses line as a guide
  // Lower lookahead weight = stricter line following but can cause oscillation
  // Steering blend weights for following the racing line
  // Higher lookahead weight = smoother steering, car uses line as a guide
  // Lower lookahead weight = stricter line following but can cause oscillation
  const TANGENT_BLEND_WEIGHT = 0.35; // Weight for following the racing line's tangent direction
  const LOOKAHEAD_BLEND_WEIGHT = 0.65; // Weight for looking ahead to anticipate turns (smoother)
  const LATERAL_CORRECTION_GAIN = 0.003; // Very gentle correction to avoid oscillation

  const SKILL_PRESETS = {
    easy: {
      maxThrottle: 0.85,
      brakeAggro: 0.8,
      steerP: 1.6,
      steerD: 0.06,
      lookaheadBase: 35,
      lookaheadSpeed: 0.12,
      brakingLookaheadFactor: 1.2,
      cornerMargin: 32,
      searchWindow: 48,
      speedHysteresis: 14,
      cornerEntryFactor: 0.45,
      minTargetSpeed: 90,
      corneringGrip: 0.75,
      slipThreshold: 0.8, // Stay well within limits
    },
    medium: {
      maxThrottle: 1.0,
      brakeAggro: 1.0,
      steerP: 2.1,
      steerD: 0.1,
      lookaheadBase: 40,
      lookaheadSpeed: 0.14,
      brakingLookaheadFactor: 1.4,
      cornerMargin: 22,
      searchWindow: 56,
      speedHysteresis: 10,
      cornerEntryFactor: 0.6,
      minTargetSpeed: 110,
      corneringGrip: 0.95,
      slipThreshold: 0.95,
    },
    hard: {
      maxThrottle: 1.5,
      brakeAggro: 1.5, // Reduced from 1.8 (Stop slamming brakes causing lockups)
      steerP: 3.8, // Reduced from 4.5 (Less twitchy)
      steerD: 0.22,
      lookaheadBase: 42, // Increased from 30 (More stable lines)
      lookaheadSpeed: 0.17,
      brakingLookaheadFactor: 1.3, // Brake slightly earlier (Safety margin)
      cornerMargin: 0,
      searchWindow: 80, // Track line better
      speedHysteresis: 5,
      cornerEntryFactor: 0.85,
      minTargetSpeed: 130,
      corneringGrip: 0.99, // 99% Confidence (REALISTIC limit) - Fixes sharp bend crashes
      slipThreshold: 1.0, // 100% Limit (No sliding allowance)
    },
  };

  function mapThrottleToSpeedScale(value) {
    const raw = Number.isFinite(value) ? value : 1;
    const normalized = clamp((raw - 0.6) / 0.6, 0, 1);
    return 1 + normalized * 5; // 1x at 0.6, 6x at 1.2
  }

  function resample(points, step) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const slices = Math.max(1, Math.round(dist / step));
      for (let j = 0; j < slices; j++) {
        const t = j / slices;
        out.push({ x: a.x + dx * t, y: a.y + dy * t });
      }
    }
    return out;
  }

  /**
   * Smooth an array of scalar values using Laplacian smoothing.
   * Works on closed loops (wraps around).
   */
  function smoothValues(values, passes, strength = 0.5) {
    let current = values.slice();
    const n = current.length;
    for (let k = 0; k < passes; k++) {
      const next = new Array(n);
      for (let i = 0; i < n; i++) {
        const prev = current[(i - 1 + n) % n];
        const curr = current[i];
        const nextVal = current[(i + 1) % n];
        const mid = (prev + nextVal) / 2;
        next[i] = curr + (mid - curr) * strength;
      }
      current = next;
    }
    return current;
  }

  /**
   * Laplacian relaxation for path smoothing (works on closed loops).
   * Creates a new array each iteration to avoid ripple effects.
   */
  function relaxPath(points, iterations, strength = 0.5) {
    let pts = points.map((p) => ({ x: p.x, y: p.y }));
    const n = pts.length;
    if (n < 3) return pts;

    for (let k = 0; k < iterations; k++) {
      const next = new Array(n);
      for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const curr = pts[i];
        const nextPt = pts[(i + 1) % n];
        const midX = (prev.x + nextPt.x) / 2;
        const midY = (prev.y + nextPt.y) / 2;
        next[i] = {
          x: curr.x + (midX - curr.x) * strength,
          y: curr.y + (midY - curr.y) * strength,
        };
      }
      pts = next;
    }
    return pts;
  }

  /**
   * Gaussian-like smoothing using 5-point kernel for very smooth curves.
   * Weights: [0.1, 0.2, 0.4, 0.2, 0.1]
   */
  function gaussianSmooth(points, passes) {
    let pts = points.map((p) => ({ x: p.x, y: p.y }));
    const n = pts.length;
    if (n < 5) return pts;

    for (let k = 0; k < passes; k++) {
      const next = new Array(n);
      for (let i = 0; i < n; i++) {
        const p2 = pts[(i - 2 + n) % n];
        const p1 = pts[(i - 1 + n) % n];
        const p0 = pts[i];
        const n1 = pts[(i + 1) % n];
        const n2 = pts[(i + 2) % n];
        next[i] = {
          x: p2.x * 0.1 + p1.x * 0.2 + p0.x * 0.4 + n1.x * 0.2 + n2.x * 0.1,
          y: p2.y * 0.1 + p1.y * 0.2 + p0.y * 0.4 + n1.y * 0.2 + n2.y * 0.1,
        };
      }
      pts = next;
    }
    return pts;
  }

  function signedCurvature(prev, curr, next) {
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
    return angle / avgLen;
  }

  /**
   * Straighten path sections where the line is "wavering" (weaving back and forth)
   * without a significant net direction change. This mimics how pro racers cut
   * straight through lumpy track sections instead of following every undulation.
   *
   * @param {Array} path - The racing line path [{x, y}, ...]
   * @param {Array} centerline - The track centerline for bounds checking
   * @param {number} maxOffset - Maximum allowed distance from centerline
   * @param {Array} curvatures - Smoothed curvature values for each point (optional)
   * @returns {Array} - Optimized path with unnecessary weaving removed
   */
  function straightenPath(path, centerline, maxOffset, curvatures = null) {
    if (!path || path.length < 20) return path;
    
    const DEBUG_STRAIGHTEN = false;

    const n = path.length;
    const result = path.map((p) => ({ x: p.x, y: p.y }));
    const smoothCurvatures = curvatures; // Use passed curvatures for gentle curve detection

    // Configuration - More aggressive to catch subtle wavering
    const MIN_CHORD_LENGTH = 6; // Detect smaller wavering sections (~72px)
    const MAX_CHORD_LENGTH = 60; // Allow longer straightening (~720px)
    const DIRECTION_VARIANCE_LIMIT = 0.3; // Consider more gradual curves as "straight"
    const WAVERING_THRESHOLD = 0.08; // Detect subtler oscillations

    // Track which points have been straightened to avoid re-processing
    const processed = new Array(n).fill(false);

    // Helper: Check if a point is within track bounds
    const isWithinBounds = (px, py, centerIdx) => {
      const ci = Math.min(centerIdx, centerline.length - 1);
      const center = centerline[ci];
      const dx = px - center.x;
      const dy = py - center.y;
      const dist = Math.hypot(dx, dy);
      return dist <= maxOffset * 1.05; // 5% tolerance
    };

    // Helper: Get direction angle between two points
    const getDirection = (from, to) => {
      return Math.atan2(to.y - from.y, to.x - from.x);
    };

    // Helper: Normalize angle to [-PI, PI]
    const normalizeAngle = (a) => {
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return a;
    };

    // Scan the path looking for straightenable sections
    // Use multiple passes to catch wavering at chord boundaries
    for (let pass = 0; pass < 2; pass++) {
      // Second pass starts from different offset to catch boundary cases
      const startOffset = pass === 0 ? 0 : Math.floor(MIN_CHORD_LENGTH / 2);

      for (let startIdx = startOffset; startIdx < n; startIdx++) {
        if (processed[startIdx]) continue;

        // Try different chord lengths, preferring longer chords
        for (let chordLen = MAX_CHORD_LENGTH; chordLen >= MIN_CHORD_LENGTH; chordLen -= 3) {
          const endIdx = (startIdx + chordLen) % n;

          // Skip if we'd cross the loop boundary awkwardly
          if (startIdx + chordLen >= n + MIN_CHORD_LENGTH) continue;

          const startPt = result[startIdx];
          const endPt = result[endIdx];

          // Calculate chord direction
          const chordDir = getDirection(startPt, endPt);

          // Measure net direction change and cumulative wavering along the path
          let cumulativeChange = 0;
          let lastDir = getDirection(startPt, result[(startIdx + 1) % n]);
          let maxCurvInChord = 0; // Track maximum curvature within the chord

          for (let j = 1; j < chordLen - 1; j++) {
            const idx = (startIdx + j) % n;
            const nextIdx = (startIdx + j + 1) % n;
            const currDir = getDirection(result[idx], result[nextIdx]);
            const change = Math.abs(normalizeAngle(currDir - lastDir));
            cumulativeChange += change;
            lastDir = currDir;
            
            // Track curvature if available
            if (smoothCurvatures) {
              maxCurvInChord = Math.max(maxCurvInChord, Math.abs(smoothCurvatures[idx]));
            }
          }

          // Net direction change from start to end
          const netChange = Math.abs(normalizeAngle(chordDir - getDirection(startPt, result[(startIdx + 1) % n])));

          // This section is "wavering" if there's significant cumulative change
          // but small net change (meaning it's oscillating, not turning)
          const isWavering = cumulativeChange > WAVERING_THRESHOLD && netChange < DIRECTION_VARIANCE_LIMIT;

          if (!isWavering) continue;
          
          // NEW: Skip sections that pass through actual corners (high curvature)
          // This prevents straightening through hairpins and other real turns
          const CORNER_CURVATURE_THRESHOLD = 0.005; // Radius < 200px is definitely a corner
          if (maxCurvInChord > CORNER_CURVATURE_THRESHOLD) continue;

          // NEW: Check if this section crosses the track centerline
          // If the path goes from one side of the track to the other, it's a
          // legitimate racing line transition (exit→entry), not meaningless wavering
          const startCenterIdx = Math.floor(startIdx * centerline.length / n) % centerline.length;
          const endCenterIdx = Math.floor(endIdx * centerline.length / n) % centerline.length;
          const startCenter = centerline[startCenterIdx];
          const endCenter = centerline[endCenterIdx];

          // Calculate perpendicular offset from centerline (positive = one side, negative = other)
          const getNormal = (idx) => {
            const ci = Math.floor(idx * centerline.length / n) % centerline.length;
            const prev = centerline[(ci - 1 + centerline.length) % centerline.length];
            const next = centerline[(ci + 1) % centerline.length];
            const dx = next.x - prev.x;
            const dy = next.y - prev.y;
            const len = Math.hypot(dx, dy) || 1;
            return { x: -dy / len, y: dx / len };
          };

          const startNormal = getNormal(startIdx);
          const endNormal = getNormal(endIdx);
          const startOffset = (startPt.x - startCenter.x) * startNormal.x + (startPt.y - startCenter.y) * startNormal.y;
          const endOffset = (endPt.x - endCenter.x) * endNormal.x + (endPt.y - endCenter.y) * endNormal.y;

          // If start and end are on opposite sides of the centerline, this is a real transition
          const SIDE_THRESHOLD = 15; // Minimum offset to count as "on a side"
          const crossesCenterline = (Math.abs(startOffset) > SIDE_THRESHOLD && Math.abs(endOffset) > SIDE_THRESHOLD &&
            Math.sign(startOffset) !== Math.sign(endOffset));

          // NEW: Even if it crosses centerline, allow straightening if both ends are gentle curves
          // This prevents S-curves with gentle bends from blocking the straightening pass
          const startCurv = Math.abs(smoothCurvatures ? smoothCurvatures[startIdx] : 0);
          const endCurv = Math.abs(smoothCurvatures ? smoothCurvatures[endIdx] : 0);
          const GENTLE_CURVE_THRESHOLD = 0.0012; // Slightly above apex threshold
          const isGentleTransition = startCurv < GENTLE_CURVE_THRESHOLD && endCurv < GENTLE_CURVE_THRESHOLD;

          if (crossesCenterline && !isGentleTransition) continue; // Don't straighten a real racing line transition

          // Validate that the chord stays within track bounds
          let chordValid = true;
          const chordDx = endPt.x - startPt.x;
          const chordDy = endPt.y - startPt.y;

          for (let j = 1; j < chordLen - 1; j++) {
            const t = j / chordLen;
            const chordX = startPt.x + chordDx * t;
            const chordY = startPt.y + chordDy * t;
            const centerIdx = Math.floor((startIdx + j) * centerline.length / n) % centerline.length;

            if (!isWithinBounds(chordX, chordY, centerIdx)) {
              chordValid = false;
              break;
            }
          }

          if (!chordValid) continue;

          if (DEBUG_STRAIGHTEN) {
            console.log(`STRAIGHTENING: idx ${startIdx} to ${endIdx} (len ${chordLen}), cumChange=${cumulativeChange.toFixed(3)}, netChange=${netChange.toFixed(3)}`);
          }

          // Apply the chord - replace intermediate points with straight line
          for (let j = 1; j < chordLen - 1; j++) {
            const idx = (startIdx + j) % n;
            const t = j / chordLen;
            result[idx] = {
              x: startPt.x + chordDx * t,
              y: startPt.y + chordDy * t,
            };
            processed[idx] = true;
          }

          // Mark endpoints and skip ahead
          processed[startIdx] = true;
          startIdx += chordLen - 2; // -1 for loop increment, -1 to check overlap
          break; // Found a valid chord, move to next section
        }
      }
    }

    // No final smoothing - it destroys anchor positions
    // The straightening itself creates clean chords that don't need blending
    return result;
  }

  /**
   * Enrich a simple path with racing line metadata (curvature, speed, etc.)
   * Used by both anchor-based and elastic band solvers
   */
  function enrichRacingLine(path, cfg) {
    if (!path || path.length < 3) return [];
    
    const n = path.length;
    const g = cfg.gravity || 750;
    const minRadius = cfg.minRadius || 12;
    const straightSpeed = cfg.straightSpeed || 3000;
    const cornerSpeedFloor = cfg.cornerSpeedFloor || 140;
    
    let arc = 0;
    return path.map((pt, idx) => {
      const prev = path[(idx - 1 + n) % n];
      const next = path[(idx + 1) % n];
      const segLen = Math.hypot(next.x - pt.x, next.y - pt.y) || 1;
      arc += segLen;
      
      const tangent = { x: (next.x - pt.x) / segLen, y: (next.y - pt.y) / segLen };
      const normal = { x: -tangent.y, y: tangent.x };
      const curvature = signedCurvature(prev, pt, next);
      const radiusPx = Math.max(minRadius, Math.abs(1 / (curvature || 1e-4)));
      const rawSpeed = Math.sqrt(Math.max(0, (cfg.roadFriction || 1.1) * g * radiusPx));
      const targetSpeed = clamp(rawSpeed, cornerSpeedFloor, straightSpeed);
      
      return {
        index: idx,
        s: arc,
        x: pt.x,
        y: pt.y,
        tangent,
        normal,
        curvature,
        radius: radiusPx,
        targetSpeed,
      };
    });
  }

  function buildRacingLine(centerline, roadWidth, options = {}) {
    if (!Array.isArray(centerline) || centerline.length < 3) return [];
    const cfg = { ...DEFAULT_LINE_CFG, ...options };

    // NEW: Option to use the elastic band solver instead of anchor-based
    if (cfg.useElasticBandSolver && global.RacingLineSolver) {
      try {
        const solver = new global.RacingLineSolver({
          resampleSpacing: cfg.elasticBandSpacing || 10,
          iterations: cfg.elasticBandIterations || 75,
          optimizationFactor: cfg.apexAggression !== undefined ? cfg.apexAggression : 0.7,
          smoothingStrength: cfg.elasticBandSmoothing || 0.5,
        });
        
        const optimizedPath = solver.solve(centerline, roadWidth);
        
        // Convert to full racing line format with metadata
        return enrichRacingLine(optimizedPath, cfg);
      } catch (err) {
        console.warn('Elastic band solver failed, falling back to anchor-based:', err);
        // Fall through to anchor-based solver
      }
    }

    // ORIGINAL: Anchor-based racing line generation
    // 1. Resample centerline to fine spacing for smooth curves
    const step = 12; // Finer spacing for smoother curves
    const points = resample(centerline, step);
    const n = points.length;
    if (n < 3) return points;

    // 2. Setup Constraints
    const halfWidth = roadWidth / 2;
    const maxOff = cfg.maxOffset !== undefined ? cfg.maxOffset : 0.98; // Increased from 0.95
    const aggression = clamp(cfg.apexAggression !== undefined ? cfg.apexAggression : 0.9, 0, 1);
    const usableWidth = halfWidth * (0.70 + 0.28 * aggression) * maxOff; // EVEN MORE aggressive formula

    // 3. Calculate curvature at each point using wider window for stability
    const rawCurvatures = [];
    const windowSize = Math.max(4, Math.floor(n / 25)); // Wider window for stability
    for (let i = 0; i < n; i++) {
      const prevIdx = (i - windowSize + n) % n;
      const nextIdx = (i + windowSize) % n;
      rawCurvatures[i] = signedCurvature(points[prevIdx], points[i], points[nextIdx]);
    }

    // 4. Smooth curvature values to identify true corners vs noise
    let smoothCurvatures = smoothValues(rawCurvatures, 12, 0.5);

    // 5. Calculate Normals
    const normals = [];
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      normals[i] = { x: -dy / len, y: dx / len };
    }

    // --- ANCHOR-BASED GENERATION START ---
    // Instead of continuous mapping, we identify "Events" (Corners) and place anchors.

    // A. Identify Apices (Local Maxima in Curvature)
    const apexThreshold = 0.002; // Ignore gentle bends (Radius > ~500px)
    const apices = [];

    // Helper to find distance between indices
    const distIndices = (i, j) => {
      let d = Math.abs(i - j);
      return Math.min(d, n - d);
    };

    // Helper to estimate turn length (hoisted)
    const getTurnLen = (mag) => {
      const r = 1 / (mag + 1e-6);
      return Math.min(n / 8, Math.sqrt(r * 20));
    };

    // Helper: Calculate lateral displacement of a curve section
    // This measures how far the track deviates from a straight line between endpoints
    const measureLateralDisplacement = (startIdx, endIdx) => {
      const start = points[startIdx];
      const end = points[endIdx];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.hypot(dx, dy) || 1;
      
      let maxDist = 0;
      let indices = endIdx > startIdx ? 
        Array.from({length: endIdx - startIdx + 1}, (_, i) => startIdx + i) :
        [...Array.from({length: n - startIdx}, (_, i) => startIdx + i), 
         ...Array.from({length: endIdx + 1}, (_, i) => i)];
      
      for (const idx of indices) {
        const pt = points[idx];
        // Distance from point to line
        const t = Math.max(0, Math.min(1, ((pt.x - start.x) * dx + (pt.y - start.y) * dy) / (len * len)));
        const projX = start.x + t * dx;
        const projY = start.y + t * dy;
        const dist = Math.hypot(pt.x - projX, pt.y - projY);
        maxDist = Math.max(maxDist, dist);
      }
      return maxDist;
    };

    // DEBUG: Enable apex detection logging
    const DEBUG_APEX_DETECTION = false;
    
    if (DEBUG_APEX_DETECTION) {
      console.log(`\n=== APEX DETECTION DEBUG ===`);
      console.log(`Track has ${n} resampled points`);
      console.log(`Road width: ${roadWidth}px`);
      console.log(`Apex threshold: ${apexThreshold} (radius > ${(1/apexThreshold).toFixed(0)}px ignored)`);
      console.log(`Displacement threshold: ${(roadWidth * 0.5 * 0.15).toFixed(1)}px (15% of half-width)`);
      
      // Log curvature range
      const curvatures = smoothCurvatures.map(c => Math.abs(c));
      const maxCurv = Math.max(...curvatures);
      const minCurv = Math.min(...curvatures.filter(c => c > 0));
      console.log(`Curvature range: ${minCurv.toFixed(5)} to ${maxCurv.toFixed(5)}`);
      console.log(`Points above threshold: ${curvatures.filter(c => c >= apexThreshold).length}`);
    }

    // Simple peak detection
    for (let i = 0; i < n; i++) {
      const c = Math.abs(smoothCurvatures[i]);
      if (c < apexThreshold) continue;

      const prev = Math.abs(smoothCurvatures[(i - 1 + n) % n]);
      const next = Math.abs(smoothCurvatures[(i + 1) % n]);

      if (c >= prev && c >= next) {
        // It's a local peak. Check if it's too close to a previous apex (noise)
        if (apices.length > 0) {
          const lastApex = apices[apices.length - 1];
          if (distIndices(i, lastApex.index) < n / 30) {
            // Too close, keep the larger one
            if (c > lastApex.mag) {
              apices[apices.length - 1] = { index: i, mag: c, sign: Math.sign(smoothCurvatures[i]) };
            }
            continue;
          }
        }
        
        // FILTER: Check if this apex represents significant lateral displacement
        // A "real" corner moves the track significantly sideways
        // Track noise (gentle waves) has high curvature but low displacement
        // Use a fixed small window to measure local displacement, not the full turn length
        let windowSize = Math.min(15, Math.round(getTurnLen(c) / 2)); // Small local window
        let entryIdx = (i - windowSize + n) % n;
        let exitIdx = (i + windowSize) % n;
        
        // Check if window crosses the loop boundary (entry > i or exit < i after wrap)
        // If so, shrink the window to avoid measuring across the track closure
        if (entryIdx > i) {
          // Window wrapped backward past start - clamp to not cross boundary
          windowSize = i; // Shrink to start from index 0
          entryIdx = 0;
        }
        if (exitIdx < i) {
          // Window wrapped forward past end - clamp to not cross boundary  
          const maxForward = n - 1 - i;
          if (maxForward < windowSize) {
            windowSize = maxForward;
            exitIdx = n - 1;
          }
        }
        
        // If window is too small after clamping, skip this apex (it's at track boundary)
        if (windowSize < 5) {
          if (DEBUG_APEX_DETECTION) {
            console.log(`  Peak at ${i}: SKIPPED (window too small after boundary clamp)`);
          }
          continue; // Skip apex at track boundary
        }
        
        const displacement = measureLateralDisplacement(entryIdx, exitIdx);
        
        // Only create apex if displacement is at least 15% of road half-width
        // Lower threshold to catch gentle but significant turns
        const MIN_DISPLACEMENT_RATIO = 0.15;
        const threshold = roadWidth * 0.5 * MIN_DISPLACEMENT_RATIO;
        
        if (DEBUG_APEX_DETECTION) {
          console.log(`  Peak at ${i}: curv=${c.toFixed(4)}, disp=${displacement.toFixed(1)}px vs threshold=${threshold.toFixed(1)}px, window=[${entryIdx}-${exitIdx}]`);
        }
        
        if (displacement < threshold) {
          if (DEBUG_APEX_DETECTION) {
            console.log(`    -> FILTERED (displacement too low)`);
          }
          continue; // Skip this apex - it's just track noise
        }
        
        if (DEBUG_APEX_DETECTION) {
          console.log(`    -> ACCEPTED`);
        }
        
        // Store displacement for amplitude scaling later
        apices.push({ index: i, mag: c, sign: Math.sign(smoothCurvatures[i]), displacement });
      }
    }

    // MERGE CONSECUTIVE SAME-DIRECTION APICES INTO SINGLE APEX
    // For long sweeping turns (hairpins), multiple apex points are detected along the curve.
    // A pro driver treats this as ONE turn with ONE apex at the geometric center.
    // We merge consecutive same-sign apices that are connected by continuous curvature.
    if (apices.length > 1) {
      const mergedApices = [];
      let group = [apices[0]];

      for (let i = 1; i <= apices.length; i++) {
        const curr = apices[i % apices.length];
        const prev = group[group.length - 1];
        
        // Check if curr should join the group
        let shouldMerge = false;
        if (curr.sign === prev.sign && i < apices.length) {
          // Calculate distance
          let dist = curr.index - prev.index;
          if (dist < 0) dist += n;
          
          // Check if curvature stays above threshold between them (continuous turn)
          let minK = Infinity;
          for (let j = 1; j < dist; j++) {
            const idx = (prev.index + j) % n;
            minK = Math.min(minK, Math.abs(smoothCurvatures[idx]));
          }
          
          // Merge if: same direction, continuous curvature, and reasonably close
          // "Reasonably close" = within 1/4 of track length (covers large hairpins)
          const isContinuous = minK > apexThreshold * 0.5; // Half the apex threshold
          const isClose = dist < n / 4;
          shouldMerge = isContinuous && isClose;
        }

        if (shouldMerge) {
          group.push(curr);
        } else {
          // Finalize the current group - create single apex at weighted centroid
          if (group.length === 1) {
            mergedApices.push(group[0]);
          } else {
            // Weighted average by curvature magnitude
            let totalWeight = 0;
            let weightedIndex = 0;
            let maxMag = 0;
            const baseIndex = group[0].index;
            
            for (const apex of group) {
              let relIdx = apex.index - baseIndex;
              if (relIdx < 0) relIdx += n; // Handle wrap-around
              weightedIndex += relIdx * apex.mag;
              totalWeight += apex.mag;
              if (apex.mag > maxMag) maxMag = apex.mag;
            }
            
            const centroidIdx = Math.round(baseIndex + weightedIndex / totalWeight) % n;
            mergedApices.push({
              index: centroidIdx,
              mag: maxMag, // Use max magnitude for severity scaling
              sign: group[0].sign
            });
          }
          
          // Start new group (if not at the end)
          if (i < apices.length) {
            group = [curr];
          }
        }
      }
      
      // Replace apices with merged version
      apices.length = 0;
      apices.push(...mergedApices);
    }

    // ADDITIONAL MERGE PASS: Merge very close apexes regardless of sign
    // This handles cases where curvature calculation creates oscillations in a single corner
    // For example, a 90-degree turn might be split into multiple peaks with alternating signs
    if (apices.length > 1) {
      const finalApices = [];
      let i = 0;
      
      while (i < apices.length) {
        const curr = apices[i];
        const toMerge = [curr];
        let j = i + 1;
        
        // Look ahead for nearby apexes to merge with current
        while (j < apices.length) {
          const next = apices[j];
          let dist = next.index - curr.index;
          if (dist < 0) dist += n;
          
          // Merge if very close (within typical turn length)
          // This threshold should catch peaks within the same corner
          // Use a generous threshold to merge multi-peak corners into single apexes
          const maxMergeDist = Math.max(n / 8, 40); // ~31 points or 40, whichever is larger
          
          if (dist < maxMergeDist) {
            toMerge.push(next);
            j++;
          } else {
            break; // Too far, stop looking
          }
        }
        
        // Create single apex from the group
        if (toMerge.length === 1) {
          finalApices.push(toMerge[0]);
        } else {
          // Check if the group contains apexes with DIFFERENT signs
          // If so, these are OPPOSITE direction corners (e.g., chicane or S-curve)
          // DO NOT merge them - keep them separate!
          const signs = toMerge.map(a => a.sign);
          const hasMixedSigns = signs.some(s => s !== signs[0]);
          
          if (hasMixedSigns) {
            // Keep all apexes separate - don't merge opposite-direction corners
            finalApices.push(...toMerge);
          } else {
            // Same direction: merge multiple apexes into one (e.g., long sweeping turn)
            // Use the one with highest magnitude
            let bestApex = toMerge[0];
            for (const apex of toMerge) {
              if (apex.mag > bestApex.mag) {
                bestApex = apex;
              }
            }
            finalApices.push(bestApex);
          }
        }
        
        i = j;
      }
      
      apices.length = 0;
      apices.push(...finalApices);
    }

    // B. Create Offset Map (Anchors)
    // Initialize with null to signify "undefined/interpolate"
    const targetOffsets = new Array(n).fill(null);

    // Identify Compound Turns: if two DIFFERENT-direction apices are very close,
    // we may need to skip intermediate anchors (e.g., tight chicanes).
    // NOTE: Same-direction apices were already merged above, so this mainly handles
    // left-right or right-left sequences that are too close to fully unwind between.
    apices.forEach(a => { a.skipEntry = false; a.skipExit = false; });

    if (apices.length > 1) {
      for (let i = 0; i < apices.length; i++) {
        const curr = apices[i];
        const next = apices[(i + 1) % apices.length];

        // Calculate distance between apices
        let dist = next.index - curr.index;
        if (dist < 0) dist += n;

        // Gap Heuristic: Calculate the theoretical "Straight" length between turns.
        const len1 = getTurnLen(curr.mag);
        const len2 = getTurnLen(next.mag);
        const gap = dist - len1 - len2;

        // Only skip entry/exit if there's truly not enough room to go outside and back
        // This is now VERY conservative - only skip for truly overlapping turn arcs
        const isVeryShortGap = gap < 5;

        if (isVeryShortGap && curr.sign === next.sign) {
          // Same direction, very close - skip intermediate anchors
          curr.skipExit = true;
          next.skipEntry = true;
        }
      }
    }

    // Define turn geometry based on curvature
    // Tighter turns cover less distance but require wider entry/exit Setup
    const DEBUG_ANCHORS = false; // Set to true to debug anchor placement
    
    if (DEBUG_ANCHORS) {
      console.log(`\n--- ANCHOR DEBUG ---`);
      console.log(`Resampled points (n): ${n}`);
      console.log(`Number of apices after merging: ${apices.length}`);
    }
    
    apices.forEach((apex, apexIdx) => {
      const turnHalfLength = getTurnLen(apex.mag);

      let entryIdx = (Math.round(apex.index - turnHalfLength) + n) % n;
      let exitIdx = (Math.round(apex.index + turnHalfLength) + n) % n;
      
      // SMART ENTRY/EXIT: Don't place anchors on straight sections
      // If the curvature at entry/exit is very low (straight), move them closer to apex
      // This prevents corner offsets from bleeding into unrelated straight sections
      const MIN_CURVATURE_FOR_ANCHOR = 0.002; // Move entry/exit if curvature is this gentle
      
      // Move entry closer if it's on a straight
      while (Math.abs(smoothCurvatures[entryIdx]) < MIN_CURVATURE_FOR_ANCHOR) {
        const newEntry = (entryIdx + 1) % n;
        if (newEntry === apex.index) break; // Don't move past apex
        const distToApex = distIndices(newEntry, apex.index);
        if (distToApex < 3) break; // Keep minimum separation
        entryIdx = newEntry;
      }

      // Move exit closer if it's on a straight
      while (Math.abs(smoothCurvatures[exitIdx]) < MIN_CURVATURE_FOR_ANCHOR) {
        const newExit = (exitIdx - 1 + n) % n;
        if (newExit === apex.index) break; // Don't move past apex
        const distToApex = distIndices(newExit, apex.index);
        if (distToApex < 3) break; // Keep minimum separation
        exitIdx = newExit;
      }

      // APEX ANCHOR: Inside of turn
      // Sign > 0 = Turning Right -> Offset Left (-)
      // Wait, curvature sign depends on coordinate system. 
      // Let's assume standard: we want to be opposite to the turn direction.
      // If curvature is + (turning one way), we go - (inside).
      const apexSide = apex.sign;

      // --- AMPLITUDE SCALING ---
      // Scale the offset based on curvature severity.
      // Small curvature (Gentle bend) -> Stay near center.
      // High curvature (Sharp turn) -> Use full width.
      // Map 0.002 (Threshold) -> 0.005 (Full Width Radius ~200px)
      const severity = clamp((apex.mag - 0.002) / 0.003, 0, 1);

      // Use severity directly with a HIGHER minimum floor for detected corners
      // If an apex passed the displacement filter, it deserves at least 50% amplitude
      // Sharp turns (high severity) get progressively more offset up to 100%
      let amplitude = Math.max(0.5, severity); // INCREASED from 0.3 to 0.5
      
      const currentWidth = usableWidth * amplitude;
      
      // Skip creating anchors for very small offsets (less than 10px)
      // These are just track noise, not real corners worth reacting to
      if (currentWidth < 10) {
        if (DEBUG_ANCHORS) {
          console.log(`Apex ${apexIdx}: SKIPPED (offset ${currentWidth.toFixed(1)}px too small)`);
        }
        return; // Skip this apex entirely
      }

      if (DEBUG_ANCHORS) {
        console.log(`Apex ${apexIdx}: idx=${apex.index}, sign=${apex.sign}, mag=${apex.mag.toFixed(4)}, severity=${severity.toFixed(2)}, amplitude=${amplitude.toFixed(2)}, width=${currentWidth.toFixed(1)}`);
        console.log(`  Entry: idx=${entryIdx}, skip=${apex.skipEntry}, offset=${(-apexSide * currentWidth).toFixed(1)}`);
        console.log(`  Apex:  idx=${apex.index}, offset=${(apexSide * currentWidth).toFixed(1)}`);
        console.log(`  Exit:  idx=${exitIdx}, skip=${apex.skipExit}, offset=${(-apexSide * currentWidth).toFixed(1)}`);
      }

      // ANCHOR PLACEMENT
      // 1. Apex
      targetOffsets[apex.index] = apexSide * currentWidth;

      // 2. Entry Point (Turn-in) -> Outside
      // We want to be on the OUTSIDE before turning in.
      // Outside = -Inside = -(-Sign) = Sign
      if (!apex.skipEntry) {
        targetOffsets[entryIdx] = -apexSide * currentWidth;
      }

      // 3. Exit Point (Track-out) -> Outside
      if (!apex.skipExit) {
        targetOffsets[exitIdx] = -apexSide * currentWidth;
      }
    });

    // C. Interpolate gaps (Linear "Connect the dots")
    // Gaps between Exit of one turn and Entry of next are Straight Lines (Diagonals)

    // Find first defined point to start handling wrap-around correctly
    let firstDefined = targetOffsets.findIndex(v => v !== null);
    if (firstDefined === -1) {
      // No corners found, just stay in center (or maybe slightly offset to one side?)
      return centerline.map((p, i) => ({
        ...p, index: i, s: i * step, curvature: 0, radius: 10000, targetSpeed: cfg.straightSpeed,
        tangent: { x: 1, y: 0 }, normal: { x: 0, y: -1 } // Dummies
      }));
    }

    // Rotate array so we start with a defined value to simplify logic
    // (Actually, just loop twice to handle wrap)
    let lastDefinedVal = targetOffsets[firstDefined];
    let lastDefinedIdx = firstDefined;

    // Fill forward
    for (let k = 1; k <= n; k++) {
      const i = (firstDefined + k) % n;
      if (targetOffsets[i] !== null) {
        // Is defined
        lastDefinedVal = targetOffsets[i];
        lastDefinedIdx = i;
      } else {
        // Is null, need to interpolate
        // Find next defined
        let nextDefinedIdx = -1;
        let distToNext = 0;
        for (let j = 1; j < n; j++) {
          const search = (i + j) % n;
          if (targetOffsets[search] !== null) {
            nextDefinedIdx = search;
            distToNext = j;
            break;
          }
        }

        // Linear blend
        const prevVal = lastDefinedVal;
        const nextVal = targetOffsets[nextDefinedIdx];
        const t = 1 / (distToNext + 1); // 1 step into a gap of size distToNext

        // Wait, simple linear interpolation loop is better
        // Calculating 't' relative to the segment
        // Let's just do a separate pass for filling nulls
      }
    }

    // Better Fill Pass:
    // We have a sparse array. Let's create a list of {index, value} and interpolate between them.
    const anchors = [];
    const anchorIndices = new Set(); // Track which indices are anchors
    for (let i = 0; i < n; i++) {
      if (targetOffsets[i] !== null) {
        anchors.push({ index: i, value: targetOffsets[i] });
        anchorIndices.add(i);
      }
    }

    // Interpolate between anchors
    for (let k = 0; k < anchors.length; k++) {
      const curr = anchors[k];
      const next = anchors[(k + 1) % anchors.length];

      let dist = next.index - curr.index;
      if (dist < 0) dist += n; // Wrap around

      for (let j = 1; j < dist; j++) {
        const idx = (curr.index + j) % n;
        const t = j / dist;
        targetOffsets[idx] = lerp(curr.value, next.value, t);
      }
    }

    // D. Smooth the offsets with ANCHOR PRESERVATION
    // The linear interpolation creates sharp corners in the path (e.g. at Turn-in point). 
    // We smooth only the NON-ANCHOR points to preserve the outside-inside-outside pattern.
    function smoothWithAnchors(values, passes, strength, preserveSet) {
      let current = values.slice();
      const len = current.length;
      for (let k = 0; k < passes; k++) {
        const next = new Array(len);
        for (let i = 0; i < len; i++) {
          if (preserveSet.has(i)) {
            // Anchor point - keep original value
            next[i] = current[i];
          } else {
            // Non-anchor - smooth normally
            const prev = current[(i - 1 + len) % len];
            const curr = current[i];
            const nextVal = current[(i + 1) % len];
            const mid = (prev + nextVal) / 2;
            next[i] = curr + (mid - curr) * strength;
          }
        }
        current = next;
      }
      return current;
    }
    
    if (DEBUG_ANCHORS) {
      console.log(`\nAnchor indices preserved: ${[...anchorIndices].slice(0, 20).join(', ')}${anchorIndices.size > 20 ? '...' : ''}`);
      console.log(`Total anchors: ${anchorIndices.size}`);
      console.log(`Is 46 in anchors: ${anchorIndices.has(46)}`);
      console.log(`Is 70 in anchors: ${anchorIndices.has(70)}`);
      console.log(`Is 94 in anchors: ${anchorIndices.has(94)}`);
      console.log(`Offset at 46 before smooth: ${targetOffsets[46]?.toFixed(1)}`);
      console.log(`Offset at 70 before smooth: ${targetOffsets[70]?.toFixed(1)}`);
      console.log(`Offset at 94 before smooth: ${targetOffsets[94]?.toFixed(1)}`);
    }
    
    let finalOffsets = smoothWithAnchors(targetOffsets, 8, 0.5, anchorIndices);
    
    if (DEBUG_ANCHORS) {
      console.log(`Offset at 46 after smooth: ${finalOffsets[46]?.toFixed(1)}`);
      console.log(`Offset at 70 after smooth: ${finalOffsets[70]?.toFixed(1)}`);
      console.log(`Offset at 94 after smooth: ${finalOffsets[94]?.toFixed(1)}`);
    }

    // 6. Generate Path
    let path = [];
    for (let i = 0; i < n; i++) {
      const offset = clamp(finalOffsets[i], -usableWidth, usableWidth);
      path.push({
        x: points[i].x + normals[i].x * offset,
        y: points[i].y + normals[i].y * offset,
      });
    }

    // 7. Path Smoothing
    // Anchor-preserving offset smoothing already creates smooth curves.
    // No additional path smoothing needed - it destroys anchor positions.

    // 7.5 Straighten wavering sections (removes unnecessary weaving on lumpy tracks)
    path = straightenPath(path, points, usableWidth, smoothCurvatures);

    // 7.6 Fix Direction Reversals (prevent path from folding back on itself)
    // When anchors are close together with opposite offsets, the path can zigzag
    // and create direction reversals. This smooths out such artifacts.
    function fixDirectionReversals(pathArr, centerlineArr) {
      const len = pathArr.length;
      if (len < 10) return pathArr;
      
      const result = pathArr.map(p => ({ x: p.x, y: p.y }));
      
      // Calculate centerline tangent at each point
      const tangents = [];
      for (let i = 0; i < len; i++) {
        const prev = centerlineArr[(i - 1 + len) % len];
        const next = centerlineArr[(i + 1) % len];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const mag = Math.hypot(dx, dy) || 1;
        tangents.push({ x: dx / mag, y: dy / mag });
      }
      
      // Make multiple passes to propagate fixes
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < len - 1; i++) {
          const prev = result[i - 1];
          const curr = result[i];
          const next = result[i + 1];
          
          // Direction vectors
          const dir1x = curr.x - prev.x;
          const dir1y = curr.y - prev.y;
          const dir2x = next.x - curr.x;
          const dir2y = next.y - curr.y;
          
          // Dot product - negative means reversal
          const dot = dir1x * dir2x + dir1y * dir2y;
          
          if (dot < 0) {
            // Reversal detected - blend this point toward its neighbors
            // This smooths out the kink without destroying the racing line intent
            const smoothX = (prev.x + 2 * curr.x + next.x) / 4;
            const smoothY = (prev.y + 2 * curr.y + next.y) / 4;
            
            // Ensure we're still moving in the track direction
            const tan = tangents[i];
            const newDir1x = smoothX - prev.x;
            const newDir1y = smoothY - prev.y;
            const newDir2x = next.x - smoothX;
            const newDir2y = next.y - smoothY;
            
            // Check if smoothed version would still have reversal
            const newDot = newDir1x * newDir2x + newDir1y * newDir2y;
            
            if (newDot >= 0) {
              result[i] = { x: smoothX, y: smoothY };
            } else {
              // Stronger smoothing - interpolate between prev and next
              result[i] = { x: (prev.x + next.x) / 2, y: (prev.y + next.y) / 2 };
            }
          }
        }
      }
      
      return result;
    }
    
    path = fixDirectionReversals(path, points);
    
    // 7.7 Remove Near-Duplicate Points (clustered points cause curvature spikes)
    // When multiple anchors are placed close together, points can cluster with
    // distances < 2px, causing numerical instability in curvature calculation
    function removeClusteredPoints(pathArr, centerlineArr, minDist = 3) {
      const len = pathArr.length;
      if (len < 10) return { path: pathArr, centerline: centerlineArr };
      
      const newPath = [pathArr[0]];
      const newCenterline = [centerlineArr[0]];
      
      for (let i = 1; i < len; i++) {
        const prev = newPath[newPath.length - 1];
        const curr = pathArr[i];
        const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
        
        if (dist >= minDist) {
          newPath.push(curr);
          newCenterline.push(centerlineArr[i]);
        }
      }
      
      return { path: newPath, centerline: newCenterline };
    }
    
    const cleaned = removeClusteredPoints(path, points, 3);
    path = cleaned.path;
    const cleanedCenterline = cleaned.centerline;
    const newN = path.length;

    // 8. Constrain to Track Width (Safety check ONLY - no smoothing)
    // Just ensure points don't exceed track bounds
    for (let i = 0; i < newN; i++) {
      const center = cleanedCenterline[i];
      const dx = path[i].x - center.x;
      const dy = path[i].y - center.y;
      const dist = Math.hypot(dx, dy);
      if (dist > usableWidth) {
        const ratio = usableWidth / dist;
        path[i] = {
          x: center.x + dx * ratio,
          y: center.y + dy * ratio,
        };
      }
    }

    // 9. Final Metadata Calculation
    const g = cfg.gravity;
    let arc = 0;
    return path.map((pt, idx) => {
      const prev = path[(idx - 1 + newN) % newN];
      const next = path[(idx + 1) % newN];
      const segLen = Math.hypot(next.x - pt.x, next.y - pt.y) || 1;
      arc += segLen;
      const tangent = { x: (next.x - pt.x) / segLen, y: (next.y - pt.y) / segLen };
      const normal = { x: -tangent.y, y: tangent.x };
      const curvature = signedCurvature(prev, pt, next);
      const radiusPx = Math.max(cfg.minRadius, Math.abs(1 / (curvature || 1e-4)));
      const rawSpeed = Math.sqrt(Math.max(0, cfg.roadFriction * g * radiusPx));
      const targetSpeed = clamp(rawSpeed, cfg.cornerSpeedFloor, cfg.straightSpeed);
      return {
        index: idx,
        s: arc,
        x: pt.x,
        y: pt.y,
        tangent,
        normal,
        curvature,
        radius: radiusPx,
        targetSpeed,
      };
    });
  }

  function sampleAlongLine(line, startIndex, distance) {
    if (!line.length) return null;
    const count = line.length;
    let idx = ((startIndex % count) + count) % count;
    let remaining = Math.max(0, distance);
    while (remaining > 0) {
      const curr = line[idx];
      const nextIdx = (idx + 1) % count;
      const next = line[nextIdx];
      const segLen = Math.hypot(next.x - curr.x, next.y - curr.y);
      if (segLen >= remaining && segLen > 0) {
        const t = remaining / segLen;
        return {
          index: idx,
          nextIndex: nextIdx,
          point: { x: curr.x + (next.x - curr.x) * t, y: curr.y + (next.y - curr.y) * t },
          targetSpeed: lerp(curr.targetSpeed, next.targetSpeed, t),
        };
      }
      remaining -= segLen;
      idx = nextIdx;
    }
    return {
      index: idx,
      nextIndex: (idx + 1) % count,
      point: { x: line[idx].x, y: line[idx].y },
      targetSpeed: line[idx].targetSpeed,
    };
  }

  function nearestIndex(line, seed, x, y, windowSize) {
    if (!line.length) return 0;
    const count = line.length;
    const search = Math.max(1, windowSize | 0);
    let best = ((seed % count) + count) % count;
    let bestDist = Infinity;
    for (let offset = -search; offset <= search; offset++) {
      const idx = (best + offset + count) % count;
      const node = line[idx];
      const dx = node.x - x;
      const dy = node.y - y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    }
    return best;
  }

  function findClosestIndexGlobal(line, x, y, step = 10) {
    if (!line || !line.length) return 0;
    let bestIdx = 0;
    let bestDist = Infinity;
    // Scan the entire line with a stride to find the approximate closest point
    for (let i = 0; i < line.length; i += step) {
      const node = line[i];
      const dx = node.x - x;
      const dy = node.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    // Refine search locally around the best coarse index
    return nearestIndex(line, bestIdx, x, y, step * 2);
  }

  function normalizeAngle(angle) {
    let a = angle;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function createController(initialLine, preset = 'medium', initialState = null) {
    let line = Array.isArray(initialLine) ? initialLine : [];
    let idx = 0;
    let prevError = 0;

    // Use initial state (if provided) to snap to the correct part of the track immediately
    if (initialState && line.length > 0) {
      idx = findClosestIndexGlobal(line, initialState.x, initialState.y);
    }

    const resolveSkill = (level) => {
      if (typeof level === 'string' && SKILL_PRESETS[level]) {
        return { ...SKILL_PRESETS[level], id: level };
      }
      if (typeof level === 'object' && level) {
        return { ...SKILL_PRESETS.medium, ...level, id: 'custom' };
      }
      return { ...SKILL_PRESETS.medium, id: 'medium' };
    };

    let skill = resolveSkill(preset);

    // --- Runtime Line Sanitization ---
    // Re-calculate speeds to ensure they match physics, regardless of how the line was saved.
    // This fixes issues where saved lines have excessive speeds (e.g., 2600 everywhere).
    if (line.length > 3) {
      const n = line.length;
      // 1. Calculate raw curvatures with a window to reduce noise
      const curvatures = new Float32Array(n);
      const windowSize = Math.max(3, Math.floor(n / 30));
      for (let i = 0; i < n; i++) {
        const prev = line[(i - windowSize + n) % n];
        const next = line[(i + windowSize) % n];
        curvatures[i] = signedCurvature(prev, line[i], next);
      }

      // 2. Smooth curvatures for stability
      const sm = smoothValues(Array.from(curvatures), 4, 0.5);

      // 3. Apply physics limits
      // Standard physics: friction 1.4 (road), gravity 750 (approx)
      // MATCHED to physics.js: muLatRoad=1.4
      const BASE_FRICTION = 1.4;
      const difficultyGrip = skill.corneringGrip || 0.90;
      const FRICTION_LIMIT = BASE_FRICTION * difficultyGrip;

      const GRAVITY = 750;
      const MAX_SPEED_CAP = 3000; // Unlocked speed for maximum performance

      for (let i = 0; i < n; i++) {
        const k = Math.abs(sm[i]);
        const radius = k > 1e-4 ? 1 / k : 10000;
        const limit = Math.sqrt(FRICTION_LIMIT * GRAVITY * radius);
        line[i].targetSpeed = clamp(limit, 120, MAX_SPEED_CAP);
      }

      // 4. Smooth speeds to prevent abrupt braking changes
      const speeds = line.map(p => p.targetSpeed);
      const smoothSpeeds = smoothValues(speeds, 12, 0.5); // Heavy smoothing for velocity profile
      for (let i = 0; i < n; i++) {
        line[i].targetSpeed = smoothSpeeds[i];
      }
    }



    // State for input smoothing
    const inputState = {
      throttle: 0,
      brake: 0,
      steer: 0
    };

    const api = {
      setLine(newLine, carState) {
        line = Array.isArray(newLine) ? newLine : [];
        if (carState) {
          idx = findClosestIndexGlobal(line, carState.x, carState.y);
        } else {
          idx = 0;
        }
      },
      setDifficulty(level) {
        skill = resolveSkill(level);
      },
      update(car, dt) {
        if (!line.length || !car) return { throttle: 0, brake: 1, steer: 0 };
        idx = nearestIndex(line, idx, car.x, car.y, skill.searchWindow);
        const speed = Math.hypot(
          (car.physics && car.physics.vx) || car.vx || 0,
          (car.physics && car.physics.vy) || car.vy || 0,
        );
        const lookahead = skill.lookaheadBase + speed * skill.lookaheadSpeed;
        const sample = sampleAlongLine(line, idx, lookahead) || {
          point: { x: line[idx].x, y: line[idx].y },
          targetSpeed: line[idx].targetSpeed,
          nextIndex: idx,
        };
        idx = sample.nextIndex || idx;

        // Get current node on the racing line
        const currentNode = line[idx] || line[0];

        // Calculate heading toward lookahead point
        const targetX = sample.point.x - car.x;
        const targetY = sample.point.y - car.y;
        const lookaheadHeading = Math.atan2(targetY, targetX);

        // Get the racing line's tangent direction at current position
        const tangent = currentNode.tangent;
        let tangentHeading = car.angle; // fallback
        if (tangent && Number.isFinite(tangent.x) && Number.isFinite(tangent.y)) {
          tangentHeading = Math.atan2(tangent.y, tangent.x);
        }

        // Calculate lateral offset from the racing line (for path-following correction)
        const dx = car.x - currentNode.x;
        const dy = car.y - currentNode.y;
        const normal = currentNode.normal;
        let lateralOffset = 0;
        if (normal && Number.isFinite(normal.x) && Number.isFinite(normal.y)) {
          lateralOffset = dx * normal.x + dy * normal.y; // positive = left of line, negative = right
        }

        // Blend tangent direction (following the line) with lookahead direction (anticipating turns)
        const tangentError = normalizeAngle(tangentHeading - car.angle);
        const lookaheadError = normalizeAngle(lookaheadHeading - car.angle);

        // Lateral correction: only apply when significantly off the line (deadband)
        const LATERAL_DEADBAND = 15; // pixels - ignore small offsets
        const absOffset = Math.abs(lateralOffset);
        let lateralCorrection = 0;
        let isSeeking = false;

        // --- Smooth Seeking Mode ---
        // If we are very far from the racing line (e.g., displaced by collision), 
        // switch to a "Seeking" behavior that smoothly steers back to the line.
        const SEEK_THRESHOLD = 120;

        if (absOffset > SEEK_THRESHOLD) {
          isSeeking = true;
          // Find a merge point further ahead on the line to avoid sharp turns
          const mergeDistance = Math.max(250, lookahead * 2.5);
          const mergeSample = sampleAlongLine(line, idx, mergeDistance);
          const mergePoint = mergeSample ? mergeSample.point : currentNode;

          const dxMerge = mergePoint.x - car.x;
          const dyMerge = mergePoint.y - car.y;
          const mergeHeading = Math.atan2(dyMerge, dxMerge);

          // Check if we are facing the wrong way
          const trackDir = Math.atan2(currentNode.tangent.y, currentNode.tangent.x);
          const carDir = car.angle;
          const dirDiff = Math.abs(normalizeAngle(trackDir - carDir));

          let seekSteer = 0;
          if (dirDiff > Math.PI * 0.75) {
            // Backward recovery
            const error = normalizeAngle(mergeHeading - car.angle);
            seekSteer = Math.sign(error);
            inputState.throttle = 0.2;
            inputState.brake = 0;
            inputState.steer = seekSteer; // Direct snap for recovery
            return { throttle: 0.2, brake: 0, steer: seekSteer };
          }

          // Smooth seek steering
          const seekError = normalizeAngle(mergeHeading - car.angle);
          seekSteer = clamp(seekError * 1.8, -1, 1);

          prevError = seekError;

          // Apply smoothing to seek inputs for transition
          const blendSpeed = 5 * dt;
          inputState.steer += (seekSteer - inputState.steer) * blendSpeed;
          inputState.throttle += (0.5 - inputState.throttle) * blendSpeed;
          inputState.brake += (0 - inputState.brake) * blendSpeed;

          return {
            throttle: inputState.throttle,
            brake: inputState.brake,
            steer: inputState.steer
          };
        }

        if (absOffset > LATERAL_DEADBAND) {
          const excessOffset = absOffset - LATERAL_DEADBAND;
          const speedFactor = clamp(1 - speed / 1200, 0.4, 1); // Maintain more correction at speed
          lateralCorrection = clamp(
            -Math.sign(lateralOffset) * excessOffset * 0.005 * speedFactor, // Increased gain 0.003 -> 0.005
            -0.25, // Increased max correction
            0.25
          );
        }

        // Blend: use lookahead primarily for smooth steering
        const blendedError =
          tangentError * TANGENT_BLEND_WEIGHT +
          lookaheadError * LOOKAHEAD_BLEND_WEIGHT +
          lateralCorrection;
        const error = normalizeAngle(blendedError);

        const targetSteerRaw = clamp(
          error * skill.steerP + ((error - prevError) / Math.max(1e-3, dt)) * skill.steerD,
          -1,
          1,
        );
        prevError = error;

        // --- Speed Control ---
        const targetSpeedRaw = currentNode.targetSpeed;
        const difficultyMax = 1000 * mapThrottleToSpeedScale(skill.maxThrottle);
        const targetSpeed = Math.min(difficultyMax, targetSpeedRaw);

        const speedError = targetSpeed - speed;
        const throttleGain = clamp(skill.maxThrottle ?? 1, 0.1, 3.0);

        let targetThrottle = 0;
        if (speedError > 0) {
          targetThrottle = clamp(speedError / Math.max(targetSpeed, 60), 0, 1) * throttleGain;
        }

        // Enhanced corner braking anticipation
        const brakingLookaheadBase = 150;
        const brakingLookaheadSpeedFactor = skill.brakingLookaheadFactor || 1.4;
        const brakingLookahead = brakingLookaheadBase + speed * brakingLookaheadSpeedFactor;

        // Sample multiple points ahead
        const numBrakingSamples = 16;
        let minFutureSpeed = Infinity;
        let brakingDistance = brakingLookahead;

        for (let i = 1; i <= numBrakingSamples; i++) {
          const sampleDist = (brakingLookahead / numBrakingSamples) * i;
          const futureSample = sampleAlongLine(line, idx, sampleDist);
          if (futureSample && Number.isFinite(futureSample.targetSpeed)) {
            const limit = futureSample.targetSpeed;
            if (limit < minFutureSpeed) {
              minFutureSpeed = limit;
              brakingDistance = sampleDist;
            }
          }
        }

        if (minFutureSpeed === Infinity) minFutureSpeed = targetSpeed;
        const speedExcess = speed - minFutureSpeed;

        let targetBrake = 0;
        let baseBrake = 0;

        // 1. Reactive Braking
        if (speedError < 0) {
          const baseIntensity = clamp(-speedError / 150, 0, 1);
          baseBrake = Math.sqrt(baseIntensity) * skill.brakeAggro;
        }

        // 2. Anticipatory Braking
        if (speedExcess > 0 && brakingDistance > 0 && minFutureSpeed < speed) {
          const avgSpeed = (speed + minFutureSpeed) / 2;
          const timeToCorner = avgSpeed > 10 ? brakingDistance / avgSpeed : 1.0;
          const requiredDecel = speedExcess / Math.max(timeToCorner, 0.2);

          // Realistic MAX_BRAKE_DECEL ~600-700
          // Higher = AI thinks it can stop faster = Brakes Later
          const MAX_BRAKE_DECEL = 720;
          let brakingIntensity = clamp(requiredDecel / MAX_BRAKE_DECEL, 0, 1);

          const anticipation = brakingIntensity * skill.brakeAggro;
          targetBrake = Math.max(baseBrake, anticipation);

          // Basic throttle cut on braking
          if (brakingIntensity > 0.1) {
            targetThrottle = 0;
          } else {
            targetThrottle *= (1 - brakingIntensity);
          }
        } else {
          targetBrake = baseBrake;
        }

        targetBrake = Math.min(1, targetBrake);

        // Anti-reverse / Low speed clamp
        if (speed < 20 && speedExcess < 10) {
          targetBrake = 0;
        }
        // Start assist
        if (speed < 15 && minFutureSpeed > 30 && targetThrottle < 0.1 && targetBrake < 0.1) {
          targetThrottle = 1.0 * throttleGain;
        }

        // --- TRAIL BRAKING & TRACTION CIRCLE LOGIC ---
        // Implementation of professional grip management.
        // Formula: AvailableLongitudinal = Sqrt(SlipThreshold^2 - SteerUsage^2) (Simplified)

        const slipThreshold = skill.slipThreshold || 0.9;
        const steerUsage = Math.abs(inputState.steer); // 0..1

        // Calculate remaining grip for braking/acceleration
        // If steer is 1.0, we have very little grip left for braking.
        // We square the inputs to model the traction circle ellipse.
        const gripUsedSq = steerUsage * steerUsage;
        const totalGripSq = slipThreshold * slipThreshold;

        // Available grip for longitudinal force (0..1)
        const tractionAvailable = Math.sqrt(Math.max(0, totalGripSq - gripUsedSq));

        // 1. Apply to Braking
        // "Pro" Trail Braking: We ask for 100% brake, but physics limits us to 'tractionAvailable'.
        // If we are going straight (steer=0), tractionAvailable = 1.0 -> Full Brake.
        // If we represent steering (steer=1.0), tractionAvailable ~ 0 -> No Brake (prevent lockup).
        if (targetBrake > 0) {
          targetBrake = Math.min(targetBrake, tractionAvailable);
        }

        // 2. Apply to Throttle
        // "Pro" Corner Exit: We can only accelerate as we unwind the wheel.
        // As steer decreases, tractionAvailable increases -> Throttle increases.
        if (targetThrottle > 0) {
          // Strict physics adherence: Don't ask for more grip than exists.
          // FIX: Added Understeer Prevention. Traction Circle says we HAVE grip, 
          // but applying torque shifts weight back and causes understeer.
          // We bias the throttle to be lower when steering is high.
          const stabilityBias = Math.max(0, 1.0 - steerUsage * 0.6); // 60% penalty at full lock
          const throttleGrip = tractionAvailable * stabilityBias;
          targetThrottle = Math.min(targetThrottle, throttleGrip);
        }

        // 3. Input Filtering (Low Pass Filter)
        // Simulates physical speed of pedals/wheel.
        // Use different speeds for attack vs release for pro feel.

        // Steer: Quick response
        const steerAlpha = clamp(15 * dt, 0, 1);
        inputState.steer += (targetSteerRaw - inputState.steer) * steerAlpha;

        // Throttle: Instant off, smooth on (but much faster now for Pro)
        const throttleAlpha = targetThrottle < inputState.throttle ? clamp(20 * dt, 0, 1) : clamp(15 * dt, 0, 1);
        inputState.throttle += (targetThrottle - inputState.throttle) * throttleAlpha;

        // Brake: Fast on, smooth off (trail braking)
        const brakeAlpha = targetBrake > inputState.brake ? clamp(15 * dt, 0, 1) : clamp(5 * dt, 0, 1);
        inputState.brake += (targetBrake - inputState.brake) * brakeAlpha;

        return {
          throttle: inputState.throttle,
          brake: inputState.brake,
          steer: inputState.steer,
        };
      },
    };
    return api;
  }

  const existing = global.RacerAI || {};
  existing.buildRacingLine = buildRacingLine;
  existing.sampleRacingLine = sampleAlongLine;
  existing.createController = createController;
  existing.AISkill = SKILL_PRESETS;
  existing.DEFAULT_LINE_CFG = DEFAULT_LINE_CFG;
  global.RacerAI = existing;
})(typeof window !== 'undefined' ? window : this);
