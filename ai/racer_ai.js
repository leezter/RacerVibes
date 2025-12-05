(function (global) {
  const utils = global.RacerUtils || {};
  const clamp = utils.clamp || ((v, min, max) => (v < min ? min : v > max ? max : v));
  const lerp = utils.lerp || ((a, b, t) => a + (b - a) * t);

  const DEFAULT_LINE_CFG = {
    sampleStep: 6,
    smoothingPasses: 5,
    apexAggression: 0.70,   // 0 = conservative (60% track width), 1 = aggressive (95% track width)
    maxOffset: 0.90,        // Maximum fraction of half-width to use
    minRadius: 12,
    roadFriction: 1.1,
    gravity: 750,        // px/s^2 to roughly match RacerPhysics defaults
    straightSpeed: 520,  // px/s cap before scaling
    cornerSpeedFloor: 140
  };
  const MAX_TARGET_SPEED = 2600; // ~190 mph with ppm ≈ 30

  // Racing line smoothing constants
  // Note: The racing line is computed once when track loads, not per-frame, so
  // these higher iteration counts are acceptable for silky smooth results.
  const CORNER_BLEND_FACTOR = 0.7; // How aggressively to blend toward entry/exit positions

  // Steering blend weights for following the racing line
  // Higher lookahead weight = smoother steering, car uses line as a guide
  // Lower lookahead weight = stricter line following but can cause oscillation
  const TANGENT_BLEND_WEIGHT = 0.35;    // Weight for following the racing line's tangent direction
  const LOOKAHEAD_BLEND_WEIGHT = 0.65;  // Weight for looking ahead to anticipate turns (smoother)
  const LATERAL_CORRECTION_GAIN = 0.003; // Very gentle correction to avoid oscillation

  // Braking physics constants for corner anticipation
  const BRAKING_CFG = {
    deceleration: 1800,      // px/s^2 - assumed braking deceleration (tuned for grip)
    safetyMargin: 1.15,      // multiplier on required braking distance for safety
    minBrakingLookahead: 80, // minimum pixels to scan ahead for corners
    maxBrakingLookahead: 400,// maximum pixels to scan ahead (limit computation)
    scanStep: 12,            // pixels between scan samples along racing line
    cornerSpeedBuffer: 20    // px/s extra margin below corner target speed
  };

  const SKILL_PRESETS = {
    easy: {
      maxThrottle: 0.85,
      brakeAggro: 0.65,
      steerP: 1.6,
      steerD: 0.06,
      lookaheadBase: 35,
      lookaheadSpeed: 0.12,
      cornerMargin: 32,
      steerCutThrottle: 0.45,
      searchWindow: 48,
      speedHysteresis: 14,
      cornerEntryFactor: 0.45,
      minTargetSpeed: 90,
      brakingDecel: 1400,      // easier AI brakes less aggressively
      brakingSafety: 1.3       // more safety margin
    },
    medium: {
      maxThrottle: 0.95,
      brakeAggro: 0.9,
      steerP: 2.1,
      steerD: 0.1,
      lookaheadBase: 40,
      lookaheadSpeed: 0.14,
      cornerMargin: 22,
      steerCutThrottle: 0.3,
      searchWindow: 56,
      speedHysteresis: 10,
      cornerEntryFactor: 0.6,
      minTargetSpeed: 110,
      brakingDecel: 1600,
      brakingSafety: 1.2
    },
    hard: {
      maxThrottle: 1.2,
      brakeAggro: 0.62,
      steerP: 3.2,
      steerD: 0.16,
      lookaheadBase: 50,
      lookaheadSpeed: 0.16,
      cornerMargin: 0,
      steerCutThrottle: 0.18,
      searchWindow: 64,
      speedHysteresis: 7,
      cornerEntryFactor: 0.75,
      minTargetSpeed: 120,
      brakingDecel: 1900,      // harder AI brakes more precisely
      brakingSafety: 1.1       // less safety margin
    }
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
    let pts = points.map(p => ({ x: p.x, y: p.y }));
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
          y: curr.y + (midY - curr.y) * strength
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
    let pts = points.map(p => ({ x: p.x, y: p.y }));
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
          y: p2.y * 0.1 + p1.y * 0.2 + p0.y * 0.4 + n1.y * 0.2 + n2.y * 0.1
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

  function buildRacingLine(centerline, roadWidth, options = {}) {
    if (!Array.isArray(centerline) || centerline.length < 3) return [];
    const cfg = { ...DEFAULT_LINE_CFG, ...options };

    // 1. Resample centerline to fine spacing for smooth curves
    const step = 12; // Finer spacing for smoother curves
    const points = resample(centerline, step);
    const n = points.length;
    if (n < 3) return points;

    // 2. Setup Constraints
    const halfWidth = roadWidth / 2;
    const maxOff = (cfg.maxOffset !== undefined) ? cfg.maxOffset : 0.85;
    const aggression = clamp((cfg.apexAggression !== undefined) ? cfg.apexAggression : 0.5, 0, 1);
    const usableWidth = halfWidth * (0.6 + 0.35 * aggression) * maxOff;

    // 3. Calculate curvature at each point using wider window for stability
    const rawCurvatures = [];
    const windowSize = Math.max(4, Math.floor(n / 25)); // Wider window for stability
    for (let i = 0; i < n; i++) {
      const prevIdx = (i - windowSize + n) % n;
      const nextIdx = (i + windowSize) % n;
      rawCurvatures[i] = signedCurvature(points[prevIdx], points[i], points[nextIdx]);
    }

    // 4. Heavy smoothing of curvature values for stable racing line
    // This is key to creating smooth transitions between corners
    let smoothCurvatures = smoothValues(rawCurvatures, 8, 0.5); // 8 passes of smoothing
    smoothCurvatures = smoothValues(smoothCurvatures, 4, 0.3);  // Additional light passes

    // 5. Find max absolute curvature for normalization
    let maxAbsCurv = 0;
    for (let i = 0; i < n; i++) {
      maxAbsCurv = Math.max(maxAbsCurv, Math.abs(smoothCurvatures[i]));
    }
    if (maxAbsCurv < 1e-6) maxAbsCurv = 1e-6;

    // 6. Calculate normals at each point (perpendicular to track direction)
    const normals = [];
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      normals[i] = { x: -dy / len, y: dx / len };
    }

    // 7. Calculate base offset based on curvature (apex positioning)
    // At apex, we want to be on the INSIDE of the turn
    const baseOffsets = [];
    for (let i = 0; i < n; i++) {
      const curv = smoothCurvatures[i];
      const normalizedCurv = curv / maxAbsCurv; // -1 to 1
      baseOffsets[i] = normalizedCurv * usableWidth;
    }

    // 8. Apply lookahead/lookbehind for outside-inside-outside pattern
    // This creates smooth entry and exit trajectories
    const lookaheadDist = Math.max(8, Math.floor(n / 10));
    const lookbehindDist = lookaheadDist;
    const adjustedOffsets = [];
    
    for (let i = 0; i < n; i++) {
      const currentAbsCurv = Math.abs(smoothCurvatures[i]);
      
      // Look ahead for upcoming corners
      let maxFutureCurv = 0;
      let futureApexOffset = 0;
      for (let j = 1; j <= lookaheadDist; j++) {
        const futureIdx = (i + j) % n;
        const absCurv = Math.abs(smoothCurvatures[futureIdx]);
        if (absCurv > maxFutureCurv) {
          maxFutureCurv = absCurv;
          futureApexOffset = baseOffsets[futureIdx];
        }
      }
      
      // Look behind for recent corners
      let maxPastCurv = 0;
      let pastApexOffset = 0;
      for (let j = 1; j <= lookbehindDist; j++) {
        const pastIdx = (i - j + n) % n;
        const absCurv = Math.abs(smoothCurvatures[pastIdx]);
        if (absCurv > maxPastCurv) {
          maxPastCurv = absCurv;
          pastApexOffset = baseOffsets[pastIdx];
        }
      }
      
      let offset = baseOffsets[i];
      
      // Approaching a corner - position on the outside
      if (maxFutureCurv > currentAbsCurv * 1.3 && maxFutureCurv > 0.25 * maxAbsCurv) {
        const setupOffset = -futureApexOffset * (CORNER_BLEND_FACTOR + 0.25 * aggression);
        const blend = clamp((maxFutureCurv - currentAbsCurv) / maxAbsCurv, 0, 0.85);
        offset = lerp(offset, setupOffset, blend * CORNER_BLEND_FACTOR);
      }
      
      // Exiting a corner - track out to the outside
      if (maxPastCurv > currentAbsCurv * 1.3 && maxPastCurv > 0.25 * maxAbsCurv) {
        const exitOffset = -pastApexOffset * (CORNER_BLEND_FACTOR + 0.25 * aggression);
        const blend = clamp((maxPastCurv - currentAbsCurv) / maxAbsCurv, 0, 0.85);
        offset = lerp(offset, exitOffset, blend * CORNER_BLEND_FACTOR);
      }
      
      adjustedOffsets[i] = offset;
    }

    // 9. Heavy smoothing of offsets for very smooth transitions
    // The racing line is computed once at track load, so this is not a per-frame cost
    let finalOffsets = smoothValues(adjustedOffsets, 12, 0.5);
    finalOffsets = smoothValues(finalOffsets, 8, 0.4);
    finalOffsets = smoothValues(finalOffsets, 4, 0.3);

    // 10. Apply offsets to create initial racing line path
    let path = [];
    for (let i = 0; i < n; i++) {
      const offset = clamp(finalOffsets[i], -usableWidth, usableWidth);
      path.push({
        x: points[i].x + normals[i].x * offset,
        y: points[i].y + normals[i].y * offset
      });
    }

    // 11. Apply Laplacian relaxation for path smoothing
    // This creates naturally flowing curves without ripple effects
    path = relaxPath(path, 20, 0.4);

    // 12. Apply Gaussian smoothing for extra smoothness
    path = gaussianSmooth(path, 6);

    // 13. Constrained relaxation - smooth while respecting track bounds
    for (let iter = 0; iter < 15; iter++) {
      const next = new Array(n);
      for (let i = 0; i < n; i++) {
        const prev = path[(i - 1 + n) % n];
        const curr = path[i];
        const nextPt = path[(i + 1) % n];
        const center = points[i];
        
        // Smooth toward neighbors
        const midX = (prev.x + nextPt.x) / 2;
        const midY = (prev.y + nextPt.y) / 2;
        let newX = curr.x + (midX - curr.x) * 0.3;
        let newY = curr.y + (midY - curr.y) * 0.3;
        
        // Constrain to track width
        const dx = newX - center.x;
        const dy = newY - center.y;
        const dist = Math.hypot(dx, dy);
        if (dist > usableWidth) {
          const ratio = usableWidth / dist;
          newX = center.x + dx * ratio;
          newY = center.y + dy * ratio;
        }
        
        next[i] = { x: newX, y: newY };
      }
      path = next;
    }

    // 14. Final Gaussian smoothing pass for silky smooth result
    path = gaussianSmooth(path, 3);

    // 15. Calculate metadata (speed, curvature, etc.)
    const g = cfg.gravity;
    let arc = 0;
    return path.map((pt, idx) => {
      const prev = path[(idx - 1 + n) % n];
      const next = path[(idx + 1) % n];
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
        targetSpeed
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
          targetSpeed: lerp(curr.targetSpeed, next.targetSpeed, t)
        };
      }
      remaining -= segLen;
      idx = nextIdx;
    }
    return {
      index: idx,
      nextIndex: (idx + 1) % count,
      point: { x: line[idx].x, y: line[idx].y },
      targetSpeed: line[idx].targetSpeed
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

  function normalizeAngle(angle) {
    let a = angle;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /**
   * Scan ahead along the racing line to find the minimum target speed within braking range.
   * Returns { minSpeed, distance, urgency } where:
   * - minSpeed: the lowest targetSpeed found ahead
   * - distance: how far ahead that slowest point is (px)
   * - urgency: 0-1 value indicating how urgently we need to brake
   * 
   * The key insight: if we're going at currentSpeed and need to reach minSpeed,
   * we need to brake starting at: d = (v_current² - v_min²) / (2 * deceleration)
   */
  function scanAheadForCorners(line, startIdx, currentSpeed, skill, speedScale) {
    if (!line || !line.length) return null;
    
    const count = line.length;
    const decel = (skill && skill.brakingDecel) || BRAKING_CFG.deceleration;
    const safety = (skill && skill.brakingSafety) || BRAKING_CFG.safetyMargin;
    const minTargetSpeed = (skill && skill.minTargetSpeed) || 90;
    
    // Calculate how far we could theoretically need to look ahead
    // braking distance = v² / (2*a), so max lookahead scales with speed squared
    const speedSq = currentSpeed * currentSpeed;
    const theoreticalBrakingDist = speedSq / (2 * decel) * safety;
    const maxLookahead = clamp(
      theoreticalBrakingDist + BRAKING_CFG.minBrakingLookahead,
      BRAKING_CFG.minBrakingLookahead,
      BRAKING_CFG.maxBrakingLookahead
    );
    
    let dist = 0;
    let curIdx = ((startIdx % count) + count) % count;
    let minSpeed = currentSpeed;
    let minSpeedDist = 0;
    let prevPt = line[curIdx];
    
    // Scan along the racing line
    while (dist < maxLookahead) {
      const nextIdx = (curIdx + 1) % count;
      const nextPt = line[nextIdx];
      const segLen = Math.hypot(nextPt.x - prevPt.x, nextPt.y - prevPt.y);
      dist += segLen;
      
      // Get target speed at this point, scaled by maxThrottle
      const nodeSpeed = nextPt.targetSpeed || minTargetSpeed;
      const scaledSpeed = Math.min(MAX_TARGET_SPEED, nodeSpeed * speedScale);
      
      // Track the minimum speed we'll encounter
      if (scaledSpeed < minSpeed) {
        minSpeed = scaledSpeed;
        minSpeedDist = dist;
      }
      
      prevPt = nextPt;
      curIdx = nextIdx;
      
      // If we've looped all the way around, stop
      if (curIdx === startIdx) break;
    }
    
    // Apply corner speed buffer for safety
    minSpeed = Math.max(minTargetSpeed, minSpeed - BRAKING_CFG.cornerSpeedBuffer);
    
    // Calculate required braking distance from current speed to minSpeed
    const speedDelta = currentSpeed - minSpeed;
    if (speedDelta <= 0) {
      // Already slow enough for upcoming corners
      return { minSpeed, distance: minSpeedDist, urgency: 0, requiredBrakeDist: 0 };
    }
    
    // Physics: d = (v1² - v2²) / (2*a)
    const requiredBrakeDist = (speedSq - minSpeed * minSpeed) / (2 * decel) * safety;
    
    // Urgency: how close are we to needing to brake?
    // urgency = 1 when we should have already started braking
    // urgency = 0 when we have plenty of distance
    const urgency = clamp(requiredBrakeDist / Math.max(minSpeedDist, 1), 0, 1.5);
    
    return {
      minSpeed,
      distance: minSpeedDist,
      requiredBrakeDist,
      urgency
    };
  }

  function createController(initialLine, preset = 'medium') {
    let line = Array.isArray(initialLine) ? initialLine : [];
    let idx = 0;
    let prevError = 0;

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

    const api = {
      setLine(newLine) {
        line = Array.isArray(newLine) ? newLine : [];
        idx = 0;
      },
      setDifficulty(level) {
        skill = resolveSkill(level);
      },
      update(car, dt) {
        if (!line.length || !car) return { throttle: 0, brake: 1, steer: 0 };
        idx = nearestIndex(line, idx, car.x, car.y, skill.searchWindow);
        const speed = Math.hypot((car.physics && car.physics.vx) || car.vx || 0, (car.physics && car.physics.vy) || car.vy || 0);
        const lookahead = skill.lookaheadBase + speed * skill.lookaheadSpeed;
        const sample = sampleAlongLine(line, idx, lookahead) || { point: { x: line[idx].x, y: line[idx].y }, targetSpeed: line[idx].targetSpeed, nextIndex: idx };
        idx = sample.nextIndex || idx;
        
        // Get current node on the racing line
        const currentNode = line[idx] || line[0];
        
        // Calculate heading toward lookahead point
        const targetX = sample.point.x - car.x;
        const targetY = sample.point.y - car.y;
        const lookaheadHeading = Math.atan2(targetY, targetX);
        
        // Get the racing line's tangent direction at current position
        // This tells us where the racing line is actually pointing right now
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
        // Use primarily lookahead direction for smoother steering (racing line as guide, not strict path)
        const tangentError = normalizeAngle(tangentHeading - car.angle);
        const lookaheadError = normalizeAngle(lookaheadHeading - car.angle);
        
        // Lateral correction: only apply when significantly off the line (deadband)
        // Also reduce correction at higher speeds to avoid oscillation
        const LATERAL_DEADBAND = 15; // pixels - ignore small offsets
        const absOffset = Math.abs(lateralOffset);
        let lateralCorrection = 0;
        if (absOffset > LATERAL_DEADBAND) {
          // Apply gentle correction only for significant deviations
          const excessOffset = absOffset - LATERAL_DEADBAND;
          const speedFactor = clamp(1 - speed / 800, 0.2, 1); // Reduce correction at high speed
          lateralCorrection = clamp(-Math.sign(lateralOffset) * excessOffset * LATERAL_CORRECTION_GAIN * speedFactor, -0.15, 0.15);
        }
        
        // Blend: use lookahead primarily for smooth steering, tangent helps follow the line shape
        const blendedError = tangentError * TANGENT_BLEND_WEIGHT + lookaheadError * LOOKAHEAD_BLEND_WEIGHT + lateralCorrection;
        const error = normalizeAngle(blendedError);
        
        const steer = clamp(error * skill.steerP + ((error - prevError) / Math.max(1e-3, dt)) * skill.steerD, -1, 1);
        prevError = error;

          const rawCurrent = (currentNode && Number.isFinite(currentNode.targetSpeed)) ? currentNode.targetSpeed : skill.minTargetSpeed;
          const rawFuture = Number.isFinite(sample.targetSpeed) ? sample.targetSpeed : rawCurrent;
          const speedScale = mapThrottleToSpeedScale(skill.maxThrottle);
          const scaledCurrent = Math.min(MAX_TARGET_SPEED, rawCurrent * speedScale);
          const scaledFuture = Math.min(MAX_TARGET_SPEED, rawFuture * speedScale);
          
        // === Enhanced corner anticipation using physics-based braking ===
        // Scan ahead along the racing line to find the minimum speed we'll need
        const cornerScan = scanAheadForCorners(line, idx, speed, skill, speedScale);
        
        let targetSpeed;
        let anticipatoryBrake = 0;
        let anticipatoryThrottleCut = 0;
        
        if (cornerScan && cornerScan.urgency > 0) {
          // We have a corner coming up that requires slowing down
          const { minSpeed, urgency } = cornerScan;
          
          // Target speed should consider the upcoming corner's requirements
          // Blend between current segment speed and the corner's minimum speed based on urgency
          const effectiveMinSpeed = Math.max(skill.minTargetSpeed, minSpeed);
          targetSpeed = Math.max(skill.minTargetSpeed, Math.min(scaledCurrent, scaledFuture, effectiveMinSpeed) - skill.cornerMargin);
          
          // Calculate braking intensity based on how urgent the situation is
          // urgency > 1.0 means we should have already started braking
          // urgency = 0.5 means we're halfway to needing full brakes
          if (urgency > 0.3) {
            // Start anticipatory braking
            // Progressive braking: gentle at first, harder as we get closer
            const brakeIntensity = clamp((urgency - 0.3) / 0.7, 0, 1);
            anticipatoryBrake = brakeIntensity * skill.brakeAggro;
            
            // Also cut throttle proportionally to urgency
            anticipatoryThrottleCut = clamp(urgency * 0.8, 0, 0.95);
          }
          
          // Emergency braking if we're very late
          if (urgency > 1.0) {
            anticipatoryBrake = Math.min(1, anticipatoryBrake * 1.3);
            anticipatoryThrottleCut = 0.95;
          }
        } else {
          // No significant corner ahead, use the simpler calculation
          targetSpeed = Math.max(skill.minTargetSpeed, Math.min(scaledCurrent, scaledFuture) - skill.cornerMargin);
        }
        
        const speedError = targetSpeed - speed;
        const throttleGain = clamp(skill.maxThrottle ?? 1, 0.1, 2);
        let throttle = speedError > 0 ? clamp(speedError / Math.max(targetSpeed, 60), 0, 1) * throttleGain : 0;
        let brake = speedError < 0 ? clamp(-speedError / Math.max(targetSpeed, 60), 0, 1) * skill.brakeAggro : 0;

        // Apply anticipatory braking from corner scanning
        brake = Math.max(brake, anticipatoryBrake);
        throttle *= (1 - anticipatoryThrottleCut);

        // Legacy futureDrop anticipation (kept as backup, but corner scanning should handle most cases)
        const futureDrop = scaledCurrent - scaledFuture;
        if (futureDrop > 0) {
          const anticipation = clamp(futureDrop / 160, 0, 1);
          brake = Math.max(brake, anticipation * skill.cornerEntryFactor);
          throttle *= (1 - anticipation * 0.7);
        }

        const steerMag = Math.abs(steer);
        if (steerMag > skill.steerCutThrottle) {
          const cut = clamp((steerMag - skill.steerCutThrottle) / (1 - skill.steerCutThrottle), 0, 1);
          // Reduce throttle cut at low speeds so AI cars can accelerate even when steering significantly
          // This prevents AI from sitting idle when they need to steer toward the racing line at startup
          const LOW_SPEED_THRESHOLD = 150; // px/s - below this speed, allow more throttle while steering
          const LOW_SPEED_CUT_REDUCTION = 0.8; // At 0 speed, only (1 - 0.8) = 20% of throttle cut applies
          const speedCutReduction = 1 - clamp(speed / LOW_SPEED_THRESHOLD, 0, 1);
          const effectiveCut = cut * (1 - speedCutReduction * LOW_SPEED_CUT_REDUCTION);
          throttle *= (1 - effectiveCut);
        }

        const hyst = skill.speedHysteresis;
        if (speedError > hyst) brake = Math.min(brake, 0.2);
        if (speedError < -hyst) throttle = Math.min(throttle, 0.2);

        return {
          throttle,
          brake,
          steer
        };
      }
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
