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

  // Steering blend weights for following the racing line
  // Higher lookahead weight = smoother steering, car uses line as a guide
  // Lower lookahead weight = stricter line following but can cause oscillation
  const TANGENT_BLEND_WEIGHT = 0.35;    // Weight for following the racing line's tangent direction
  const LOOKAHEAD_BLEND_WEIGHT = 0.65;  // Weight for looking ahead to anticipate turns (smoother)
  const LATERAL_CORRECTION_GAIN = 0.003; // Very gentle correction to avoid oscillation

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
      minTargetSpeed: 90
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
      minTargetSpeed: 110
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
      minTargetSpeed: 120
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

  // Catmull-Rom spline interpolation for ultra-smooth centerline
  function catmullRomInterpolate(points, numPoints) {
    if (!points.length) return [];
    const n = points.length;
    const result = [];
    
    for (let i = 0; i < numPoints; i++) {
      const t = (i / numPoints) * n;
      const idx = Math.floor(t);
      const frac = t - idx;
      
      const p0 = points[(idx - 1 + n) % n];
      const p1 = points[idx % n];
      const p2 = points[(idx + 1) % n];
      const p3 = points[(idx + 2) % n];
      
      // Catmull-Rom spline coefficients
      const t2 = frac * frac;
      const t3 = t2 * frac;
      
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * frac +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * frac +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      
      result.push({ x, y });
    }
    
    return result;
  }

  function smooth(points, passes) {
    let current = points.slice();
    for (let k = 0; k < passes; k++) {
      current = current.map((p, idx) => {
        const prev = current[(idx - 1 + current.length) % current.length];
        const next = current[(idx + 1) % current.length];
        return { x: (prev.x + p.x + next.x) / 3, y: (prev.y + p.y + next.y) / 3 };
      });
    }
    return current;
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

  // Gaussian-weighted smoothing for ultra-smooth racing lines
  function gaussianSmooth(values, windowRadius, sigma) {
    const n = values.length;
    if (n < 3) return values.slice();
    
    // Pre-compute Gaussian weights
    const weights = [];
    let weightSum = 0;
    for (let j = -windowRadius; j <= windowRadius; j++) {
      const w = Math.exp(-(j * j) / (2 * sigma * sigma));
      weights.push(w);
      weightSum += w;
    }
    // Normalize weights
    for (let k = 0; k < weights.length; k++) {
      weights[k] /= weightSum;
    }
    
    const result = [];
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -windowRadius; j <= windowRadius; j++) {
        const idx = (i + j + n) % n;
        sum += values[idx] * weights[j + windowRadius];
      }
      result[i] = sum;
    }
    return result;
  }

  function buildRacingLine(centerline, roadWidth, options = {}) {
    if (!Array.isArray(centerline) || centerline.length < 3) return [];
    const cfg = { ...DEFAULT_LINE_CFG, ...options };

    // 1. First, use Catmull-Rom spline to create ultra-smooth centerline
    // This eliminates sharp corners from the input and creates natural curves
    const targetPoints = Math.max(100, centerline.length * 8);
    const smoothCenterline = catmullRomInterpolate(centerline, targetPoints);
    
    // 2. Resample the smooth centerline to consistent spacing
    const step = 10;
    const points = resample(smoothCenterline, step);
    const n = points.length;
    if (n < 3) return points;

    // 3. Setup Constraints
    const halfWidth = roadWidth / 2;
    const maxOff = (cfg.maxOffset !== undefined) ? cfg.maxOffset : 0.85;
    const aggression = clamp((cfg.apexAggression !== undefined) ? cfg.apexAggression : 0.5, 0, 1);
    const usableWidth = halfWidth * (0.6 + 0.35 * aggression) * maxOff;

    // 4. Calculate curvature with larger window for stable estimation
    const curvatures = [];
    const windowSize = Math.max(5, Math.floor(n / 20));
    for (let i = 0; i < n; i++) {
      const prevIdx = (i - windowSize + n) % n;
      const nextIdx = (i + windowSize) % n;
      curvatures[i] = signedCurvature(points[prevIdx], points[i], points[nextIdx]);
    }

    // 5. Multi-pass Gaussian smoothing of curvature for ultra-smooth profile
    const curvSmoothWindow = Math.max(4, Math.floor(n / 30));
    const curvSigma = curvSmoothWindow / 2;
    let smoothCurvatures = gaussianSmooth(curvatures, curvSmoothWindow, curvSigma);
    // Second pass for even smoother curvature
    smoothCurvatures = gaussianSmooth(smoothCurvatures, curvSmoothWindow, curvSigma);

    // 6. Find max absolute curvature for normalization
    let maxAbsCurv = 0;
    for (let i = 0; i < n; i++) {
      maxAbsCurv = Math.max(maxAbsCurv, Math.abs(smoothCurvatures[i]));
    }
    if (maxAbsCurv < 1e-6) maxAbsCurv = 1e-6;

    // 7. Calculate normals at each point
    const normals = [];
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      normals[i] = { x: -dy / len, y: dx / len };
    }

    // 8. Create smooth offset profile using curvature integration
    // This creates the classic outside→inside→outside pattern naturally
    const rawOffsets = [];
    for (let i = 0; i < n; i++) {
      const curv = smoothCurvatures[i];
      const normalizedCurv = curv / maxAbsCurv;
      // Use a softer response curve for smoother offset transitions
      const softCurv = Math.sign(normalizedCurv) * Math.pow(Math.abs(normalizedCurv), 0.7);
      rawOffsets[i] = softCurv * usableWidth;
    }

    // 9. Apply Gaussian smoothing to offsets for smooth transitions
    const offsetSmoothWindow = Math.max(6, Math.floor(n / 18));
    const offsetSigma = offsetSmoothWindow / 2;
    let smoothOffsets = gaussianSmooth(rawOffsets, offsetSmoothWindow, offsetSigma);
    // Second smoothing pass for tire-mark-like smoothness
    smoothOffsets = gaussianSmooth(smoothOffsets, offsetSmoothWindow, offsetSigma);

    // 10. Apply anticipation shift: move to outside BEFORE corners using smooth blending
    const anticipationWindow = Math.max(8, Math.floor(n / 10));
    const anticipatedOffsets = [];
    
    for (let i = 0; i < n; i++) {
      // Find upcoming corner intensity with distance-weighted sampling
      let peakFutureCurv = 0;
      let peakFutureOffset = 0;
      let peakDistance = 0;
      
      for (let j = 1; j <= anticipationWindow; j++) {
        const futureIdx = (i + j) % n;
        const absCurv = Math.abs(smoothCurvatures[futureIdx]);
        // Weight by distance (closer corners matter more)
        const distanceWeight = 1 - (j / anticipationWindow) * 0.3;
        const weightedCurv = absCurv * distanceWeight;
        if (weightedCurv > peakFutureCurv) {
          peakFutureCurv = weightedCurv;
          peakFutureOffset = smoothOffsets[futureIdx];
          peakDistance = j;
        }
      }
      
      const currentAbsCurv = Math.abs(smoothCurvatures[i]);
      
      // Use smooth sine-based blend for natural corner entry
      if (peakFutureCurv > currentAbsCurv * 1.3 && peakFutureCurv > 0.2 * maxAbsCurv) {
        // Approaching corner - blend toward outside (opposite of apex)
        const setupOffset = -peakFutureOffset * (0.7 + 0.2 * aggression);
        // Smooth blend using sine curve for natural entry arc
        const rawBlend = clamp((peakFutureCurv - currentAbsCurv) / (maxAbsCurv * 0.8), 0, 1);
        const blend = 0.5 * (1 - Math.cos(rawBlend * Math.PI)); // Smooth S-curve
        anticipatedOffsets[i] = lerp(smoothOffsets[i], setupOffset, blend * 0.6);
      } else {
        anticipatedOffsets[i] = smoothOffsets[i];
      }
    }

    // 11. Apply exit shift: move to outside AFTER corners using smooth blending
    const exitWindow = Math.max(8, Math.floor(n / 10));
    const exitOffsets = [];
    
    for (let i = 0; i < n; i++) {
      let peakPastCurv = 0;
      let peakPastOffset = 0;
      
      for (let j = 1; j <= exitWindow; j++) {
        const pastIdx = (i - j + n) % n;
        const absCurv = Math.abs(smoothCurvatures[pastIdx]);
        const distanceWeight = 1 - (j / exitWindow) * 0.3;
        const weightedCurv = absCurv * distanceWeight;
        if (weightedCurv > peakPastCurv) {
          peakPastCurv = weightedCurv;
          peakPastOffset = smoothOffsets[pastIdx];
        }
      }
      
      const currentAbsCurv = Math.abs(smoothCurvatures[i]);
      
      if (peakPastCurv > currentAbsCurv * 1.3 && peakPastCurv > 0.2 * maxAbsCurv) {
        const exitOffset = -peakPastOffset * (0.7 + 0.2 * aggression);
        const rawBlend = clamp((peakPastCurv - currentAbsCurv) / (maxAbsCurv * 0.8), 0, 1);
        const blend = 0.5 * (1 - Math.cos(rawBlend * Math.PI));
        exitOffsets[i] = lerp(anticipatedOffsets[i], exitOffset, blend * 0.6);
      } else {
        exitOffsets[i] = anticipatedOffsets[i];
      }
    }

    // 12. Final Gaussian smoothing of offsets for silky-smooth result
    const finalSmoothWindow = Math.max(5, Math.floor(n / 20));
    const finalSigma = finalSmoothWindow / 2;
    let finalOffsets = gaussianSmooth(exitOffsets, finalSmoothWindow, finalSigma);
    finalOffsets = gaussianSmooth(finalOffsets, finalSmoothWindow, finalSigma);

    // 13. Apply offsets to create racing line path
    const path = [];
    for (let i = 0; i < n; i++) {
      const offset = clamp(finalOffsets[i], -usableWidth, usableWidth);
      path.push({
        x: points[i].x + normals[i].x * offset,
        y: points[i].y + normals[i].y * offset
      });
    }

    // 14. Path optimization: iterative smoothing with constraint enforcement
    // Use more iterations with smaller alpha for smoother convergence
    const smoothIterations = 200;
    const smoothAlpha = 0.20;
    
    for (let iter = 0; iter < smoothIterations; iter++) {
      for (let i = 0; i < n; i++) {
        const prev = path[(i - 1 + n) % n];
        const next = path[(i + 1) % n];
        const center = points[i];
        
        // Move toward midpoint of neighbors
        const targetX = (prev.x + next.x) / 2;
        const targetY = (prev.y + next.y) / 2;
        
        let newX = path[i].x + (targetX - path[i].x) * smoothAlpha;
        let newY = path[i].y + (targetY - path[i].y) * smoothAlpha;
        
        // Enforce track width constraint
        const dx = newX - center.x;
        const dy = newY - center.y;
        const dist = Math.hypot(dx, dy);
        
        if (dist > usableWidth) {
          const ratio = usableWidth / dist;
          newX = center.x + dx * ratio;
          newY = center.y + dy * ratio;
        }
        
        path[i].x = newX;
        path[i].y = newY;
      }
    }

    // 15. Final polish: 7-point weighted average smoothing for tire-mark smoothness
    for (let pass = 0; pass < 8; pass++) {
      const smoothed = [];
      for (let i = 0; i < n; i++) {
        const p3 = path[(i - 3 + n) % n];
        const p2 = path[(i - 2 + n) % n];
        const p1 = path[(i - 1 + n) % n];
        const p0 = path[i];
        const n1 = path[(i + 1) % n];
        const n2 = path[(i + 2) % n];
        const n3 = path[(i + 3) % n];
        // 7-point Gaussian-like weighted average for ultra-smooth curves
        smoothed.push({
          x: p3.x * 0.03 + p2.x * 0.09 + p1.x * 0.19 + p0.x * 0.38 + n1.x * 0.19 + n2.x * 0.09 + n3.x * 0.03,
          y: p3.y * 0.03 + p2.y * 0.09 + p1.y * 0.19 + p0.y * 0.38 + n1.y * 0.19 + n2.y * 0.09 + n3.y * 0.03
        });
      }
      // Re-clamp after smoothing
      for (let i = 0; i < n; i++) {
        const p = smoothed[i];
        const center = points[i];
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const dist = Math.hypot(dx, dy);
        if (dist > usableWidth) {
          const ratio = usableWidth / dist;
          p.x = center.x + dx * ratio;
          p.y = center.y + dy * ratio;
        }
        path[i] = p;
      }
    }

    // 16. Calculate metadata (speed, curvature, etc.)
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
          const targetSpeed = Math.max(skill.minTargetSpeed, Math.min(scaledCurrent, scaledFuture) - skill.cornerMargin);
          const speedError = targetSpeed - speed;
          const throttleGain = clamp(skill.maxThrottle ?? 1, 0.1, 2);
          let throttle = speedError > 0 ? clamp(speedError / Math.max(targetSpeed, 60), 0, 1) * throttleGain : 0;
          let brake = speedError < 0 ? clamp(-speedError / Math.max(targetSpeed, 60), 0, 1) * skill.brakeAggro : 0;

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
