(function (global) {
  const utils = global.RacerUtils || {};
  const clamp = utils.clamp || ((v, min, max) => (v < min ? min : v > max ? max : v));
  const lerp = utils.lerp || ((a, b, t) => a + (b - a) * t);

  const DEFAULT_LINE_CFG = {
    sampleStep: 6,
    smoothingPasses: 5,
    apexAggression: 0.0,
    maxOffset: 0.65,
    minRadius: 12,
    roadFriction: 1.1,
    gravity: 750,        // px/s^2 to roughly match RacerPhysics defaults
    straightSpeed: 520,  // px/s cap before scaling
    cornerSpeedFloor: 140
  };
  const MAX_TARGET_SPEED = 2600; // ~190 mph with ppm ≈ 30

  const SKILL_PRESETS = {
    easy: {
      maxThrottle: 0.85,
      brakeAggro: 0.65,
      steerP: 1.6,
      steerD: 0.06,
      lookaheadBase: 40,
      lookaheadSpeed: 0.22,
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
      lookaheadSpeed: 0.25,
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
      lookaheadBase: 80,
      lookaheadSpeed: 0.5,
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

  function buildRacingLine(centerline, roadWidth, options = {}) {
    if (!Array.isArray(centerline) || centerline.length < 3) return [];
    const cfg = { ...DEFAULT_LINE_CFG, ...options };

    // 1. Resample centerline to fixed steps for stability
    // A step of ~20-30 creates a nice flowing line
    const step = 25; 
    const points = resample(centerline, step);
    const n = points.length;
    if (n < 3) return points;

    // 2. Calculate "Virtual Center" (Outside Hugging Path)
    // We shift the centerline points to the outside of the turn based on curvature.
    // This creates an "attractor" path that encourages the line to stay wide on entry/exit.
    const curvatureMap = new Float32Array(n);
    const virtualCenter = points.map((p, i) => {
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];
      const c = signedCurvature(prev, p, next);
      curvatureMap[i] = Math.abs(c);
      
      // Calculate normal
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      
      // Shift to outside: -Sign(Curvature)
      // If curvature is positive (Left turn), Normal is Left. We want Right (Outside).
      // So -1 * Normal.
      // Magnitude: Use a significant portion of the track width (e.g. 45%)
      const shift = -Math.sign(c) * (roadWidth * 0.45);
      
      return {
        x: p.x + nx * shift,
        y: p.y + ny * shift
      };
    });

    // Initialize racing line as the Virtual Center (Outside)
    // This gives the solver a "wide" starting guess.
    const path = virtualCenter.map(p => ({ x: p.x, y: p.y }));
    
    // 3. "Elastic Band" Iteration
    // We try to straighten the line (zero curvature) while keeping it on track.
    const iterations = 100; 
    
    // Calculate limit based on AI settings
    const halfWidth = roadWidth / 2;
    const maxOff = (cfg.maxOffset !== undefined) ? cfg.maxOffset : 0.65;
    const aggression = (cfg.apexAggression !== undefined) ? cfg.apexAggression : 0.5;

    // Limit: How close to the edge can we go?
    const limit = halfWidth * maxOff;
    const limitSq = limit * limit;

    // Tension Base:
    // High aggression -> Higher tension (cuts corners more tightly).
    // Range: 0.96 (Loose) to 0.99 (Tight)
    const baseAlpha = 0.96 + (0.03 * aggression);

    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < n; i++) {
        const prev = path[(i - 1 + n) % n];
        const next = path[(i + 1) % n];
        const curr = path[i];
        const center = points[i]; // The original center point
        const attractor = virtualCenter[i];
        const cMag = curvatureMap[i];

        // Calculate the "straightest" position (midpoint of neighbors)
        const targetX = (prev.x + next.x) / 2;
        const targetY = (prev.y + next.y) / 2;

        // Dynamic Weighting:
        // If curvature is high (Apex), we ignore the Attractor (Outside) and use Pure Tension (Inside).
        // If curvature is low (Entry/Exit), we allow the Attractor to pull us Outside.
        // curveFactor: 0 (Straight) -> 1 (Tight Turn)
        // Radius 100px => c=0.01. We want this to be significant.
        const curveFactor = Math.min(1, cMag * 100); 
        
        // Mix: When curveFactor is 1, we use 1.0 (Pure Tension).
        // When curveFactor is 0, we use baseAlpha (Some Attractor).
        const mix = baseAlpha + (1.0 - baseAlpha) * curveFactor;

        // Move current point towards target (Tension) mixed with Attractor
        let newX = targetX * mix + attractor.x * (1 - mix);
        let newY = targetY * mix + attractor.y * (1 - mix);

        // Constraint: Clamp point to stay within track width (Real limits)
        const dx = newX - center.x;
        const dy = newY - center.y;
        const distSq = dx*dx + dy*dy;

        if (distSq > limitSq) {
          const dist = Math.sqrt(distSq);
          const ratio = limit / dist;
          newX = center.x + dx * ratio;
          newY = center.y + dy * ratio;
        }

        path[i].x = newX;
        path[i].y = newY;
      }
    }

    // 4. Calculate metadata (speed, curvature, etc.) for the new path
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
        const targetX = sample.point.x - car.x;
        const targetY = sample.point.y - car.y;
        const targetHeading = Math.atan2(targetY, targetX);
        const error = normalizeAngle(targetHeading - car.angle);
        const steer = clamp(error * skill.steerP + ((error - prevError) / Math.max(1e-3, dt)) * skill.steerD, -1, 1);
        prevError = error;

          const currentNode = line[idx] || line[0];
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
          throttle *= (1 - cut);
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
