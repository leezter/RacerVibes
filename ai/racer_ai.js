(function (global) {
  const utils = global.RacerUtils || {};
  const clamp = utils.clamp || ((v, min, max) => (v < min ? min : v > max ? max : v));
  const lerp = utils.lerp || ((a, b, t) => a + (b - a) * t);

  const DEFAULT_LINE_CFG = {
    sampleStep: 6,
    smoothingPasses: 2,
    apexAggression: 0.6,
    maxOffset: 0.48,
    minRadius: 12,
    roadFriction: 1.1,
    gravity: 750,        // px/s^2 to roughly match RacerPhysics defaults
    straightSpeed: 420,  // px/s cap
    cornerSpeedFloor: 140
  };

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
      lookaheadBase: 55,
      lookaheadSpeed: 0.32,
      cornerMargin: 22,
      steerCutThrottle: 0.3,
      searchWindow: 56,
      speedHysteresis: 10,
      cornerEntryFactor: 0.6,
      minTargetSpeed: 110
    },
    hard: {
      maxThrottle: 1.0,
      brakeAggro: 1.15,
      steerP: 2.4,
      steerD: 0.16,
      lookaheadBase: 68,
      lookaheadSpeed: 0.4,
      cornerMargin: 12,
      steerCutThrottle: 0.18,
      searchWindow: 64,
      speedHysteresis: 7,
      cornerEntryFactor: 0.75,
      minTargetSpeed: 120
    }
  };

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
    const dense = smooth(resample(centerline, cfg.sampleStep), cfg.smoothingPasses);
    const halfWidth = roadWidth * 0.5;
    const g = cfg.gravity;
    let arc = 0;
    return dense.map((pt, idx) => {
      const prev = dense[(idx - 1 + dense.length) % dense.length];
      const next = dense[(idx + 1) % dense.length];
      const segLen = Math.hypot(next.x - pt.x, next.y - pt.y) || 1;
      arc += segLen;
      const tangent = { x: (next.x - pt.x) / segLen, y: (next.y - pt.y) / segLen };
      const normal = { x: -tangent.y, y: tangent.x };
      const curvature = signedCurvature(prev, pt, next);
      const curvatureMag = Math.abs(curvature);
      const offsetRatio = clamp(curvatureMag * halfWidth * cfg.apexAggression, 0, cfg.maxOffset);
      const apexOffset = Math.sign(curvature || 0) * offsetRatio * halfWidth;
      const rx = pt.x + normal.x * apexOffset;
      const ry = pt.y + normal.y * apexOffset;
      const radiusPx = Math.max(cfg.minRadius, Math.abs(1 / (curvature || 1e-4)));
      const rawSpeed = Math.sqrt(Math.max(0, cfg.roadFriction * g * radiusPx));
      const targetSpeed = clamp(rawSpeed, cfg.cornerSpeedFloor, cfg.straightSpeed);
      return {
        index: idx,
        s: arc,
        x: rx,
        y: ry,
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
        const currentSpeed = (currentNode && Number.isFinite(currentNode.targetSpeed)) ? currentNode.targetSpeed : skill.minTargetSpeed;
        const futureSpeed = Number.isFinite(sample.targetSpeed) ? sample.targetSpeed : currentSpeed;
        const targetSpeed = Math.max(skill.minTargetSpeed, Math.min(currentSpeed, futureSpeed) - skill.cornerMargin);
        const speedError = targetSpeed - speed;
        let throttle = speedError > 0 ? clamp(speedError / Math.max(targetSpeed, 60), 0, 1) * skill.maxThrottle : 0;
        let brake = speedError < 0 ? clamp(-speedError / Math.max(targetSpeed, 60), 0, 1) * skill.brakeAggro : 0;

        const futureDrop = currentSpeed - futureSpeed;
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
