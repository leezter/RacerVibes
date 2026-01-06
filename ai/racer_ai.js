(function (global) {
  const utils = global.RacerUtils || {};
  const clamp = utils.clamp || ((v, min, max) => (v < min ? min : v > max ? max : v));
  const lerp = utils.lerp || ((a, b, t) => a + (b - a) * t);

  const DEFAULT_LINE_CFG = {
    maxOffset: 0.9, // Maximum fraction of half-width to use
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
      searchWindow: 48,
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
      brakingLookaheadFactor: 1.35, // Slightly later braking (was 1.4)
      searchWindow: 56,
      corneringGrip: 0.98, // More confident cornering (was 0.95)
      slipThreshold: 0.98, // More combined input allowed (was 0.95)
    },
    hard: {
      maxThrottle: 1.5,
      brakeAggro: 1.5, // Reduced from 1.8 (Stop slamming brakes causing lockups)
      steerP: 3.8, // Reduced from 4.5 (Less twitchy)
      steerD: 0.22,
      brakingLookaheadFactor: 1.2, // Brake later for faster cornering (was 1.3)
      searchWindow: 80, // Track line better
      corneringGrip: 1.02, // Slightly above physics limits for aggressive cornering (was 0.99)
      slipThreshold: 1.0, // 100% Limit (No sliding allowance)
    },
    realistic: {
      maxThrottle: 5.0, // Unlocked potential
      brakeAggro: 2.0, // Maximum braking aggression
      steerP: 5.5, // Extremely fast steering response
      steerD: 0.35, // High damping to prevent oscillation at speed
      lookaheadBase: 80, // Look further ahead
      lookaheadSpeed: 0.25, // Scale lookahead significantly with speed
      brakingLookaheadFactor: 0.6, // Wait until the last moment (High Decel allows this)
      searchWindow: 80, // Reduced from 120 to prevent hopping to adjacent track legs
      corneringGrip: 1.3, // "Cheating" grip level for superhuman cornering
      slipThreshold: 1.2, // Uses more than 100% of available physics grip
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

  function buildRacingLine(centerline, roadWidth, options = {}) {
    if (!Array.isArray(centerline) || centerline.length < 3) return [];
    const cfg = { ...DEFAULT_LINE_CFG, ...options };

    // 1. Resample centerline to ensure consistent node density
    // A step of ~24px gives good resolution for corner cutting
    const step = 24;
    const points = resample(centerline, step);
    const n = points.length;
    if (n < 3) return points;

    // 2. Setup Constraints
    const halfWidth = roadWidth / 2;
    const maxOff = cfg.maxOffset !== undefined ? cfg.maxOffset : 0.95;
    // Base usable width on track configuration
    const usableWidth = halfWidth * maxOff;

    // 3. Pre-calculate Normals for constraints
    // We need these to ensure the point stays within legal lateral bounds relative to centerline
    const normals = [];
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      normals[i] = { x: -dy / len, y: dx / len };
    }

    // 4. Initialize Racing Line
    // Start with the centerline. The algorithm will "pull" this string tight.
    const path = points.map(p => ({ x: p.x, y: p.y }));

    // 5. 'Bead on a Rod' Constrained Optimization
    const ITERATIONS = 200;
    const OMEGA = 1.5; // Aggressive SOR
    const offsets = new Float32Array(n).fill(0);

    // Bounds checking helper
    const updateOffsets = (iters) => {
      for (let k = 0; k < iters; k++) {
        for (let i = 0; i < n; i++) {
          const prev = path[(i - 1 + n) % n];
          const next = path[(i + 1) % n];

          const idealX = (prev.x + next.x) * 0.5;
          const idealY = (prev.y + next.y) * 0.5;

          const center = points[i];
          const norm = normals[i];

          const dx = idealX - center.x;
          const dy = idealY - center.y;

          const targetOffset = dx * norm.x + dy * norm.y;
          let newOffset = offsets[i] + OMEGA * (targetOffset - offsets[i]);

          if (newOffset > usableWidth) newOffset = usableWidth;
          else if (newOffset < -usableWidth) newOffset = -usableWidth;

          offsets[i] = newOffset;
          path[i].x = center.x + norm.x * newOffset;
          path[i].y = center.y + norm.y * newOffset;
        }
      }
    };

    // Initial Convergence
    updateOffsets(ITERATIONS);

    // 5.5 Keypoint Forcing (Outside-Inside-Outside)
    // Identify apices and push them to the limits to ensure aggressive line usage.
    const lookahead = 6; // ~144px

    // Calculate curvature profile
    const profile = [];
    for (let i = 0; i < n; i++) {
      const prev = path[(i - 1 + n) % n];
      const next = path[(i + 1) % n];
      profile[i] = signedCurvature(prev, path[i], next);
    }
    const smoothProfile = smoothValues(profile, 4, 0.5); // Smooth curvature to find clean peaks

    // Apply Forces
    for (let i = 0; i < n; i++) {
      const k = smoothProfile[i];
      // If local max curvature > threshold
      if (Math.abs(k) > 0.0015) {
        let isPeak = true;
        // Check neighbors
        const kPrev = smoothProfile[(i - 1 + n) % n];
        const kNext = smoothProfile[(i + 1) % n];
        if (Math.abs(k) < Math.abs(kPrev) || Math.abs(k) < Math.abs(kNext)) isPeak = false;

        if (isPeak) {
          const sign = Math.sign(k); // + means Inside is +Offset (Left Turn? No, depends on coord sys)
          // Actually, Normal points "Left".
          // Curvature is + if Turning Left.
          // So Center of Curvature is Left.
          // So we want to go Left (Positive Offset).
          // Correct: Target = sign * usableWidth.

          const targetInside = sign * usableWidth;
          const targetOutside = -sign * usableWidth;

          // Nudge Apex (Inside)
          offsets[i] = offsets[i] * 0.5 + targetInside * 0.5;

          // Nudge Entry/Exit (Outside)
          const idxEntry = (i - lookahead + n) % n;
          const idxExit = (i + lookahead) % n;
          offsets[idxEntry] = offsets[idxEntry] * 0.5 + targetOutside * 0.5;
          offsets[idxExit] = offsets[idxExit] * 0.5 + targetOutside * 0.5;

          // Also update position immediately for the re-optimization to see
          path[i].x = points[i].x + normals[i].x * offsets[i];
          path[i].y = points[i].y + normals[i].y * offsets[i];
        }
      }
    }

    // Smoothing / Re-Convergence Pass
    // Allow the elastic band to smooth out the forced keypoints
    updateOffsets(50);

    // 6. Final Smoothing
    const smoothPath = gaussianSmooth(path, 3);

    // 7. Calculate Metadata
    const g = cfg.gravity;
    let arc = 0;

    return smoothPath.map((pt, idx) => {
      const prev = smoothPath[(idx - 1 + n) % n];
      const next = smoothPath[(idx + 1) % n];

      const segLen = Math.hypot(next.x - pt.x, next.y - pt.y) || 1;
      arc += segLen;

      const tangent = { x: (next.x - pt.x) / segLen, y: (next.y - pt.y) / segLen };
      const normal = { x: -tangent.y, y: tangent.x };

      const curvature = signedCurvature(prev, pt, next);
      const radiusPx = Math.max(cfg.minRadius, Math.abs(1 / (curvature || 1e-6)));

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

  function nearestIndex(line, seed, x, y, windowSize, carAngle, speed) {
    if (!line.length) return 0;

    // Default inputs to safety values
    speed = Number.isFinite(speed) ? speed : 0;
    // carAngle is optional, handled by check later

    const count = line.length;

    // CONSTANTS for Search Control
    // Limit search window to prevent track hopping (e.g. adjacent hairpin legs)
    const SPEED_SCALE_CAP = 3000;
    const MIN_SEARCH = 6;
    const MAX_SEARCH = 25; // Cap at 25 nodes (~600px) deviation

    // Scale window with speed: tight window at slow speeds (corners), larger at high speeds
    const speedRatio = Math.min(speed, SPEED_SCALE_CAP) / SPEED_SCALE_CAP;
    const dynamicLimit = Math.floor(MIN_SEARCH + speedRatio * (MAX_SEARCH - MIN_SEARCH));

    // Use the smaller of the requested window or our safety limit
    const search = Math.min(windowSize | 0, dynamicLimit);

    let best = ((seed % count) + count) % count;
    let bestDist = Infinity;

    // DIRECTION FILTERING
    // CRITICAL FIX: Disable at low speeds (< 40) to prevent "wrong way" false positives 
    // when starting or recovering from a spin. At 0 speed, car heading might be slightly off
    // track heading, but we shouldn't penalize the correct node.
    const useDirectionFilter = typeof carAngle === 'number' && speed > 40;

    const fwdX = useDirectionFilter ? Math.cos(carAngle) : 0;
    const fwdY = useDirectionFilter ? Math.sin(carAngle) : 0;

    for (let offset = -search; offset <= search; offset++) {
      const idx = (best + offset + count) % count;
      const node = line[idx];
      const dx = node.x - x;
      const dy = node.y - y;
      const dist = dx * dx + dy * dy;

      let penalty = 1.0;

      // BIAS: Prefer forward progress slightly
      // Helps break ties in favor of moving down the track
      if (offset < 0) {
        penalty *= 1.2;
      }

      // Directional Penalty (Only at speed)
      if (useDirectionFilter && node.tangent) {
        const dot = fwdX * node.tangent.x + fwdY * node.tangent.y;
        if (dot < -0.5) {
          // Wrong way (opposing traffic) -> Huge Penalty
          penalty *= 100.0;
        } else if (dot < 0) {
          // Perpendicular/Slightly Backwards -> Moderate Penalty
          penalty *= 5.0;
        }
      }

      if (dist * penalty < bestDist) {
        bestDist = dist * penalty;
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
      const MAX_SPEED_CAP = 5000; // Unlocked speed for maximum performance

      for (let i = 0; i < n; i++) {
        const k = Math.abs(sm[i]);
        const radius = k > 1e-4 ? 1 / k : 10000;
        const limit = Math.sqrt(FRICTION_LIMIT * GRAVITY * radius);
        line[i].targetSpeed = clamp(limit, 120, MAX_SPEED_CAP);
      }

      // 4. Smooth speeds to prevent abrupt braking changes
      const speeds = line.map(p => p.targetSpeed);
      const smoothSpeeds = smoothValues(speeds, 8, 0.4); // Reduced smoothing to preserve higher corner speeds
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

        const speed = Math.hypot(
          (car.physics && car.physics.vx) || car.vx || 0,
          (car.physics && car.physics.vy) || car.vy || 0,
        );

        // Pass car angle and speed to nearestIndex to prevent latching onto opposite track segments (e.g. hairpins)
        idx = nearestIndex(line, idx, car.x, car.y, skill.searchWindow, car.angle, speed);

        const lookahead = skill.lookaheadBase + speed * skill.lookaheadSpeed;
        const sample = sampleAlongLine(line, idx, lookahead) || {
          point: { x: line[idx].x, y: line[idx].y },
          targetSpeed: line[idx].targetSpeed,
          nextIndex: idx,
        };
        // BUG FIX: Do NOT update idx to the lookahead index. 
        // idx must track the car's current position (closest point), not the target.
        // Updating it causes the search window to race ahead of the car, leading to tracking loss.
        // idx = sample.nextIndex || idx;

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
            inputState.throttle = 1.0;
            inputState.brake = 0;
            inputState.steer = seekSteer; // Direct snap for recovery
            return { throttle: 1.0, brake: 0, steer: seekSteer };
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

          // Realistic MAX_BRAKE_DECEL
          // We include aerodynamic drag in the estimate because at high speeds (3000+),
          // drag deceleration (~4000 px/s²) dwarfs brake deceleration (~270 px/s²).
          // Using a dynamic estimate encourages "late braking" at high speeds.
          // Model: BaseBrake(300) + Drag(0.00045 * v^2)
          const MAX_BRAKE_DECEL = 500 + (speed * speed * 0.0004);
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
        // Start assist / Anti-Stall
        // If moving very slowly but track is open, FORCE throttle to overcome friction/inertia
        if (speed < 20 && minFutureSpeed > 30) {
          targetThrottle = Math.max(targetThrottle, 1.0 * throttleGain);
          targetBrake = 0;
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
          // NEW: Exponential penalty to strictly forbid throttle at high steering angles.
          // At 0.5 steer: (1-0.5)^2 = 0.25 throttle max.
          // At 0.8 steer: (1-0.8)^2 = 0.04 throttle max.
          const steerFactor = clamp(1.0 - steerUsage, 0, 1);
          const stabilityBias = steerFactor * steerFactor;

          const throttleGrip = tractionAvailable * stabilityBias;

          // FIX: Allow full throttle at low speed for launch/recovery even if steering
          if (speed > 50) {
            targetThrottle = Math.min(targetThrottle, throttleGrip);
          }
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
