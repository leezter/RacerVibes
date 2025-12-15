(function (global) {
  const utils = global.RacerUtils || {};
  const clamp = utils.clamp || ((v, min, max) => (v < min ? min : v > max ? max : v));
  const lerp = utils.lerp || ((a, b, t) => a + (b - a) * t);

  const DEFAULT_LINE_CFG = {
    sampleStep: 6,
    smoothingPasses: 5,
    apexAggression: 0.7, // 0 = conservative (60% track width), 1 = aggressive (95% track width)
    maxOffset: 0.9, // Maximum fraction of half-width to use
    minRadius: 12,
    roadFriction: 1.1,
    gravity: 750, // px/s^2 to roughly match RacerPhysics defaults
    straightSpeed: 2600, // px/s cap before scaling
    cornerSpeedFloor: 140,
  };
  const MAX_TARGET_SPEED = 2600; // ~190 mph with ppm ≈ 30

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
      cornerEntryFactor: 0.45,
      minTargetSpeed: 90,
      corneringGrip: 0.85,
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
      corneringGrip: 1.05,
    },
    hard: {
      maxThrottle: 1.25,
      brakeAggro: 0.55,
      steerP: 3.2,
      steerD: 0.16,
      lookaheadBase: 50,
      lookaheadSpeed: 0.17,

      cornerMargin: 0,
      steerCutThrottle: 0.4,
      searchWindow: 64,
      speedHysteresis: 7,
      cornerEntryFactor: 0.75,
      minTargetSpeed: 120,
      corneringGrip: 2.5, // Significant boost for Hard difficulty
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
    const maxOff = cfg.maxOffset !== undefined ? cfg.maxOffset : 0.85;
    const aggression = clamp(cfg.apexAggression !== undefined ? cfg.apexAggression : 0.5, 0, 1);
    const usableWidth = halfWidth * (0.6 + 0.35 * aggression) * maxOff;

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
    const apexThreshold = 0.0005; // Ignore very gentle bends (Radius > 2000px)
    const apices = [];

    // Helper to find distance between indices
    const distIndices = (i, j) => {
      let d = Math.abs(i - j);
      return Math.min(d, n - d);
    };

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
        apices.push({ index: i, mag: c, sign: Math.sign(smoothCurvatures[i]) });
      }
    }

    // B. Create Offset Map (Anchors)
    // Initialize with null to signify "undefined/interpolate"
    const targetOffsets = new Array(n).fill(null);

    // Define turn geometry based on curvature
    // Tighter turns cover less distance but require wider entry/exit Setup
    apices.forEach(apex => {
      const r = 1 / (apex.mag + 1e-6);
      const turnHalfLength = Math.min(n / 8, Math.sqrt(r * 20)); // Heuristic for turn length based on radius

      const entryIdx = (Math.round(apex.index - turnHalfLength) + n) % n;
      const exitIdx = (Math.round(apex.index + turnHalfLength) + n) % n;

      // APEX ANCHOR: Inside of turn
      // Sign > 0 = Turning Right -> Offset Left (-)
      // Wait, curvature sign depends on coordinate system. 
      // Let's assume standard: we want to be opposite to the turn direction.
      // If curvature is + (turning one way), we go - (inside).
      // Let's stick to: Apex Offset = -Sign * UsableWidth
      const apexSide = apex.sign;

      // ANCHOR PLACEMENT
      // 1. Apex
      targetOffsets[apex.index] = apexSide * usableWidth;

      // 2. Entry Point (Turn-in) -> Outside
      // We want to be on the OUTSIDE before turning in.
      // Outside = -Inside = -(-Sign) = Sign
      targetOffsets[entryIdx] = -apexSide * usableWidth;

      // 3. Exit Point (Track-out) -> Outside
      targetOffsets[exitIdx] = -apexSide * usableWidth;
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
    for (let i = 0; i < n; i++) {
      if (targetOffsets[i] !== null) anchors.push({ index: i, value: targetOffsets[i] });
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

    // D. Smooth the offsets
    // The linear interpolation creates sharp corners in the path (e.g. at Turn-in point). 
    // We smooth these to create nice rounded entries.
    let finalOffsets = smoothValues(targetOffsets, 15, 0.5); // Initial heavy smoothing
    finalOffsets = smoothValues(finalOffsets, 10, 0.3); // Refinement

    // 6. Generate Path
    let path = [];
    for (let i = 0; i < n; i++) {
      const offset = clamp(finalOffsets[i], -usableWidth, usableWidth);
      path.push({
        x: points[i].x + normals[i].x * offset,
        y: points[i].y + normals[i].y * offset,
      });
    }

    // 7. Physics-Based Relaxation (Elastic Band)
    // This pulls the string tight, naturally cutting corners and smoothing transitions further.
    // It creates the "Racing Line" flow.
    path = relaxPath(path, 30, 0.2);
    path = gaussianSmooth(path, 5);

    // 8. Constrain to Track Width (Safety check)
    // Relaxation might have pulled it off track (unlikely with 0.2 but possible)
    for (let iter = 0; iter < 5; iter++) {
      const next = new Array(n);
      for (let i = 0; i < n; i++) {
        const prev = path[(i - 1 + n) % n];
        const curr = path[i];
        const nextPt = path[(i + 1) % n];
        const center = points[i];

        // Smooth toward neighbors
        const midX = (prev.x + nextPt.x) / 2;
        const midY = (prev.y + nextPt.y) / 2;
        let newX = curr.x + (midX - curr.x) * 0.2;
        let newY = curr.y + (midY - curr.y) * 0.2;

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

    // 9. Final Metadata Calculation
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
      // Standard physics: friction 1.1, gravity 750 (approx)
      // We start with a base friction of 1.4 and scale by difficulty
      const BASE_FRICTION = 1.4;
      const difficultyGrip = skill.corneringGrip || 1.0;
      const FRICTION_LIMIT = BASE_FRICTION * difficultyGrip;

      const GRAVITY = 750;
      const MAX_SPEED_CAP = 2600; // Unlocked speed for maximum performance

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



    const api = {
      setLine(newLine, carState) {
        line = Array.isArray(newLine) ? newLine : [];
        if (carState) {
          idx = findClosestIndexGlobal(line, carState.x, carState.y);
        } else {
          idx = 0;
        }
        // Note: ideally sanitize would be called here too, but for now we focus on init
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
        // switch to a "Seeking" behavior that smoothly steers back to the line 
        // rather than snapping aggressively to the lookahead point.
        // We use a larger threshold (e.g. 120px) to trigger this mode.
        const SEEK_THRESHOLD = 120;

        if (absOffset > SEEK_THRESHOLD) {
          isSeeking = true;
          // Find a merge point further ahead on the line to avoid sharp turns
          const mergeDistance = Math.max(250, lookahead * 2.5);
          const mergeSample = sampleAlongLine(line, idx, mergeDistance);
          const mergePoint = mergeSample ? mergeSample.point : currentNode;

          // Calculate vector to merge point
          const dxMerge = mergePoint.x - car.x;
          const dyMerge = mergePoint.y - car.y;
          const distToMerge = Math.hypot(dxMerge, dyMerge) || 1;
          const mergeHeading = Math.atan2(dyMerge, dxMerge);

          // Check if we are facing the wrong way relative to track direction
          // If dot product of car vector and track tangent is very negative, we might be backwards
          const trackDir = Math.atan2(currentNode.tangent.y, currentNode.tangent.x);
          const carDir = car.angle;
          const dirDiff = Math.abs(normalizeAngle(trackDir - carDir));

          if (dirDiff > Math.PI * 0.75) {
            // We are facing backwards. Don't try to seek normally.
            // Rely on recovery logic (handled by game loop via AI_RECOVERY_CFG), 
            // but here we can just target the line immediately to help orient.
            const error = normalizeAngle(mergeHeading - car.angle);
            // Aggressive steering to turn around
            return { throttle: 0.2, brake: 0, steer: Math.sign(error) };
          }

          // Smooth seek steering
          // Interpolate between current heading and merge heading
          // The error is just the angle to the merge point
          const seekError = normalizeAngle(mergeHeading - car.angle);

          // Use a gentle P-controller for seeking to avoid wobbling
          // Lower gain than normal racing
          const seekSteer = clamp(seekError * 1.8, -1, 1);

          // Blend with normal steering based on how far we are? 
          // actually, just return the seek steer if we are truly far off.
          // But let's blend it to avoid a snap when crossing the threshold.
          // Blend factor: 0 at threshold, 1 at threshold + 100
          const seekBlend = clamp((absOffset - SEEK_THRESHOLD) / 100, 0, 1);

          // Initial calculation of standard steering for blending
          // (We'll recompute the standard logic and blend)
          // ... Actually, let's just override the error term used below.

          // Override lookaheadHeading to satisfy seeking
          // But standard logic blends tangent... 
          // Let's force the heading error to be the seek error
          // And set lateralCorrection to 0 because we are handling it via the merge point.

          // Simplified: Direct return for seeking if fully engaged
          // We use a blend for smooth transition? No, let's just commit if we are this far off.
          // To prevent snapping, we could lerp the error, but for now direct control is safer
          // to ensure we actually get back to the track.
          prevError = seekError; // Reset derivative to prevent d-term spikes
          return {
            throttle: 0.5, // Moderate throttle to get back to line safely
            brake: 0,
            steer: seekSteer
          };
        }

        if (absOffset > LATERAL_DEADBAND) {
          const excessOffset = absOffset - LATERAL_DEADBAND;
          const speedFactor = clamp(1 - speed / 800, 0.2, 1);
          lateralCorrection = clamp(
            -Math.sign(lateralOffset) * excessOffset * LATERAL_CORRECTION_GAIN * speedFactor,
            -0.15,
            0.15,
          );
        }

        // Blend: use lookahead primarily for smooth steering
        const blendedError =
          tangentError * TANGENT_BLEND_WEIGHT +
          lookaheadError * LOOKAHEAD_BLEND_WEIGHT +
          lateralCorrection;
        const error = normalizeAngle(blendedError);

        const steer = clamp(
          error * skill.steerP + ((error - prevError) / Math.max(1e-3, dt)) * skill.steerD,
          -1,
          1,
        );
        prevError = error;

        // --- Speed Control ---
        // Get target speed from the line (Sanitized, so it's a real physics limit)
        const targetSpeedRaw = currentNode.targetSpeed;

        // Apply difficulty scaling only to max cap, NOT to corner limits
        // We trust the line speed is the corner limit.
        const difficultyMax = 1000 * mapThrottleToSpeedScale(skill.maxThrottle);
        const targetSpeed = Math.min(difficultyMax, targetSpeedRaw);

        const speedError = targetSpeed - speed;
        const throttleGain = clamp(skill.maxThrottle ?? 1, 0.1, 2);
        let throttle =
          speedError > 0 ? clamp(speedError / Math.max(targetSpeed, 60), 0, 1) * throttleGain : 0;

        // Enhanced corner braking anticipation
        const brakingLookaheadBase = 100;
        const brakingLookaheadSpeedFactor = 0.7;
        const brakingLookahead = brakingLookaheadBase + speed * brakingLookaheadSpeedFactor;

        // Sample multiple points ahead
        const numBrakingSamples = 8;
        let minFutureSpeed = Infinity;
        let brakingDistance = brakingLookahead;

        const enableDebug = typeof window !== 'undefined' && window.DEBUG_AI_BRAKING && Math.random() < 0.01;

        for (let i = 1; i <= numBrakingSamples; i++) {
          const sampleDist = (brakingLookahead / numBrakingSamples) * i;
          const futureSample = sampleAlongLine(line, idx, sampleDist);
          if (futureSample && Number.isFinite(futureSample.targetSpeed)) {
            // Use raw line speed (limit). No scaling.
            const limit = futureSample.targetSpeed;
            if (limit < minFutureSpeed) {
              minFutureSpeed = limit;
              brakingDistance = sampleDist;
            }
          }
        }

        // Fallback
        if (minFutureSpeed === Infinity) minFutureSpeed = targetSpeed;

        const speedExcess = speed - minFutureSpeed;

        if (enableDebug) {
          console.log(`[AI] spd=${speed.toFixed(0)} minF=${minFutureSpeed.toFixed(0)} exc=${speedExcess.toFixed(0)}`);
        }



        let brake = 0;
        let baseBrake = 0;

        // 1. Reactive Braking (if we are currently over speed)
        if (speedError < 0) {
          const baseIntensity = clamp(-speedError / 150, 0, 1);
          baseBrake = Math.sqrt(baseIntensity) * skill.brakeAggro;
        }

        // 2. Anticipatory Braking (corner ahead)
        if (speedExcess > 0 && brakingDistance > 0 && minFutureSpeed < speed) {
          const avgSpeed = (speed + minFutureSpeed) / 2;
          const timeToCorner = avgSpeed > 10 ? brakingDistance / avgSpeed : 1.0;
          // Decel needed: (current - target) / time
          const requiredDecel = speedExcess / Math.max(timeToCorner, 0.2);

          // Max braking decel (approx 400-600 px/s^2 depending on friction)
          const MAX_BRAKE_DECEL = 350; // Conservative estimate
          let brakingIntensity = clamp(requiredDecel / MAX_BRAKE_DECEL, 0, 1);

          // Scale by aggression
          const anticipation = brakingIntensity * skill.brakeAggro * 1.5;
          brake = Math.max(baseBrake, anticipation);

          // Cut throttle if we need to brake hard for corner
          if (brakingIntensity > 0.3) {
            throttle = 0;
          } else {
            throttle *= (1 - brakingIntensity);
          }
        } else {
          brake = baseBrake;
        }

        brake = Math.min(1, brake);

        // Anti-reverse / Low speed clamp
        if (speed < 20 && speedExcess < 10) {
          brake = 0;
        }

        // 3. Start Assist / Low speed recovery
        // If we are moving very slowly and the path ahead allows speed, ensure we have initial throttle.
        // This fixes issues where cars on the starting line (with 0 speed) calculate 0 throttle.
        if (speed < 15 && minFutureSpeed > 30 && throttle < 0.1 && brake < 0.1) {
          throttle = 1.0 * throttleGain;
        }

        // Hysteresis for throttle at high speed (prevent stutter)
        if (speedError < -10 && brake < 0.1) {
          throttle = 0;
        }

        // --- Throttle Cut on Steering ---
        // Prevent understeer by cutting throttle when steering is significant.
        // This ensures the car finishes the turn before accelerating.
        const steerMag = Math.abs(steer);
        if (speed > 60 && steerMag > skill.steerCutThrottle) {
          const excess = steerMag - skill.steerCutThrottle;
          // Normalize excess (0 to 1) based on remaining steer range
          const range = Math.max(0.01, 1.0 - skill.steerCutThrottle);
          const cutFactor = clamp(excess / range, 0, 1);

          // Apply non-linear power curve to cut throttle aggressively
          // If cutFactor is 0.5, we cut 75% of throttle. If 1.0, cut 100%.
          const aggressiveCut = Math.pow(cutFactor, 0.5);
          throttle *= (1.0 - aggressiveCut);
        }

        return {
          throttle,
          brake,
          steer,
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
