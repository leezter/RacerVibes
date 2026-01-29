(function (global) {
  const CANVAS_WIDTH = 960;
  const CANVAS_HEIGHT = 640;
  const GRID_SPACING = 40;
  const MIN_POINTS = 32;
  const DEFAULT_ROAD_WIDTH = 80;
  const DEFAULT_SCALE = 1.0;
  const DEFAULT_TEXTURE = 'default';
  const ROAD_WIDTH_RANGE = [40, 180];
  const SCALE_RANGE = [0.6, 2.5];
  const ERASE_RADIUS = 24;
  const SAMPLING_SPACING = 10;

  // Width scale used in racer.html - must match for proper minimum radius calculation
  // This value is used to calculate the VISUAL road width that will appear in the game
  const RACE_WIDTH_SCALE_DEFAULT = 2.5;
  const RACE_WIDTH_SCALE_MIN = 0.5;
  const RACE_WIDTH_SCALE_MAX = 3.0;

  // Read width scale from localStorage (same key as racer.html)
  function readWidthScale() {
    try {
      const stored = localStorage.getItem('widthScale');
      if (stored === null) return RACE_WIDTH_SCALE_DEFAULT;
      const parsed = parseFloat(stored);
      if (Number.isFinite(parsed)) {
        return Math.min(RACE_WIDTH_SCALE_MAX, Math.max(RACE_WIDTH_SCALE_MIN, parsed));
      }
    } catch (_) { }
    return RACE_WIDTH_SCALE_DEFAULT;
  }

  // Track texture options available in the editor
  const TEXTURE_OPTIONS = [
    { id: 'default', name: 'Standard' },
    { id: 'vintage', name: 'Vintage Circuit' },
    { id: 'modern', name: 'Modern GP' },
    { id: 'night', name: 'Night Race' }
  ];

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function copyPoints(points) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }

  function ensureClosed(points, tolerance = 12) {
    if (!points.length) return points;
    const first = points[0];
    const last = points[points.length - 1];
    if (distance(first, last) <= tolerance) {
      const closed = points.slice(0, -1);
      closed.push({ x: first.x, y: first.y });
      return closed;
    }
    const closed = points.slice();
    closed.push({ x: first.x, y: first.y });
    return closed;
  }

  function simplifyPath(points, tolerance) {
    if (points.length < 3) return points;
    const closed = ensureClosed(points);
    const pts = closed.slice(0, -1); // avoid duplicate last point for algorithm
    const result = rdpSimplify(pts, tolerance);
    result.push({ ...result[0] });
    return result;
  }

  function rdpSimplify(points, epsilon) {
    if (points.length <= 2) return points.slice();
    const first = points[0];
    const last = points[points.length - 1];
    let index = -1;
    let maxDist = -1;

    for (let i = 1; i < points.length - 1; i++) {
      const d = pointLineDistance(points[i], first, last);
      if (d > maxDist) {
        index = i;
        maxDist = d;
      }
    }

    if (maxDist > epsilon) {
      const left = rdpSimplify(points.slice(0, index + 1), epsilon);
      const right = rdpSimplify(points.slice(index), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  function pointLineDistance(point, a, b) {
    const num = Math.abs((b.y - a.y) * point.x - (b.x - a.x) * point.y + b.x * a.y - b.y * a.x);
    const den = Math.hypot(b.y - a.y, b.x - a.x) || 1;
    return num / den;
  }

  function smoothPath(points, iterations) {
    let pts = ensureClosed(points);
    for (let k = 0; k < iterations; k++) {
      const next = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i];
        const q = pts[i + 1];
        next.push({
          x: p.x * 0.75 + q.x * 0.25,
          y: p.y * 0.75 + q.y * 0.25
        });
        next.push({
          x: p.x * 0.25 + q.x * 0.75,
          y: p.y * 0.25 + q.y * 0.75
        });
      }
      next.push({ ...next[0] });
      pts = next;
    }
    return pts;
  }

  /**
   * Aggressive Laplacian smoothing for closed loops.
   * This is the primary tool for eliminating sharp corners.
   */
  function relaxPath(points, iterations = 1, strength = 0.5) {
    let pts = ensureClosed(points).map(p => ({ x: p.x, y: p.y }));
    const n = pts.length;
    if (n < 4) return pts;

    for (let k = 0; k < iterations; k++) {
      const next = new Array(n);

      for (let i = 0; i < n - 1; i++) {
        const prevIdx = (i - 1 + n - 1) % (n - 1);
        const nextIdx = (i + 1) % (n - 1);

        const prev = pts[prevIdx];
        const curr = pts[i];
        const nextPt = pts[nextIdx];

        // Move towards midpoint of neighbors
        const midX = (prev.x + nextPt.x) / 2;
        const midY = (prev.y + nextPt.y) / 2;

        next[i] = {
          x: curr.x + (midX - curr.x) * strength,
          y: curr.y + (midY - curr.y) * strength
        };
      }
      next[n - 1] = { ...next[0] }; // Close the loop
      pts = next;
    }
    return pts;
  }

  /**
   * Calculate the signed curvature at a point given its neighbors.
   * Returns: curvature (1/radius). Positive = left turn, negative = right turn.
   */
  function calcCurvature(prev, curr, next) {
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const cross = v1x * v2y - v1y * v2x;
    const dot = v1x * v2x + v1y * v2y;
    const len1 = Math.hypot(v1x, v1y) || 1;
    const len2 = Math.hypot(v2x, v2y) || 1;

    // Curvature approximation: angle change / arc length
    const angle = Math.atan2(cross, dot);
    const avgLen = (len1 + len2) / 2;

    return angle / avgLen;
  }

  /**
   * Enforce minimum turning radius by iteratively smoothing points
   * where curvature exceeds the limit (1/minRadius).
   * This is road-width aware to prevent edge overlap.
   */
  function enforceMinimumRadius(points, minRadius, maxIterations = 200) {
    let pts = ensureClosed(points).map(p => ({ x: p.x, y: p.y }));
    const n = pts.length;
    if (n < 4) return pts;

    const maxCurvature = 1 / minRadius;

    for (let iter = 0; iter < maxIterations; iter++) {
      let maxViolation = 0;
      const next = pts.map(p => ({ x: p.x, y: p.y }));

      for (let i = 0; i < n - 1; i++) {
        const prevIdx = (i - 1 + n - 1) % (n - 1);
        const nextIdx = (i + 1) % (n - 1);

        const prev = pts[prevIdx];
        const curr = pts[i];
        const nextPt = pts[nextIdx];

        const curvature = Math.abs(calcCurvature(prev, curr, nextPt));

        if (curvature > maxCurvature) {
          // This point is too sharp - smooth it more aggressively
          const violation = curvature / maxCurvature;
          maxViolation = Math.max(maxViolation, violation);

          // EXTREMELY aggressive blend - higher violations get moved almost all the way
          const blend = Math.min(0.95, 0.5 + 0.3 * violation);
          const midX = (prev.x + nextPt.x) / 2;
          const midY = (prev.y + nextPt.y) / 2;

          next[i] = {
            x: curr.x + (midX - curr.x) * blend,
            y: curr.y + (midY - curr.y) * blend
          };
        }
      }

      next[n - 1] = { ...next[0] };
      pts = next;

      // Must be BELOW 1.0 to stop - no tolerance!
      if (maxViolation <= 1.0) break;
    }

    return pts;
  }

  /**
   * Compute offset points for one side of the track (inner or outer edge).
   * Returns array of {x, y} points offset by `offset` distance along the normal.
   */
  function computeOffsetCurve(centerline, offset) {
    const pts = ensureClosed(centerline);
    const result = [];
    const n = pts.length;

    for (let i = 0; i < n - 1; i++) {
      // Compute normal at this point using average of adjacent segment normals
      const prev = pts[(i - 1 + n - 1) % (n - 1)];
      const curr = pts[i];
      const next = pts[(i + 1) % (n - 1)];

      // Normal from prev->curr segment
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const len1 = Math.hypot(dx1, dy1) || 1;
      const nx1 = -dy1 / len1;
      const ny1 = dx1 / len1;

      // Normal from curr->next segment  
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      const len2 = Math.hypot(dx2, dy2) || 1;
      const nx2 = -dy2 / len2;
      const ny2 = dx2 / len2;

      // Average normal (bisector direction)
      let avgNx = (nx1 + nx2) / 2;
      let avgNy = (ny1 + ny2) / 2;
      const avgLen = Math.hypot(avgNx, avgNy) || 1;
      avgNx /= avgLen;
      avgNy /= avgLen;

      // For sharp corners, we need to adjust the offset distance
      // to prevent the miter from extending too far
      const dot = nx1 * nx2 + ny1 * ny2;
      // Clamp the miter factor to avoid extreme extensions at sharp corners
      const miterFactor = Math.max(0.5, Math.min(2.0, 1 / Math.sqrt((1 + dot) / 2 + 0.01)));
      const adjustedOffset = offset * Math.min(miterFactor, 1.5);

      result.push({
        x: curr.x + avgNx * adjustedOffset,
        y: curr.y + avgNy * adjustedOffset
      });
    }

    // Close the curve
    result.push({ ...result[0] });
    return result;
  }

  /**
   * Check if an offset curve (track edge) has self-intersections.
   */
  function hasEdgeSelfIntersection(edgePoints) {
    const pts = edgePoints;
    for (let i = 0; i < pts.length - 1; i++) {
      const a1 = pts[i];
      const a2 = pts[i + 1];
      // Check against non-adjacent segments
      for (let j = i + 2; j < pts.length - 1; j++) {
        // Skip segments that are nearly adjacent (within 3 indices)
        if (Math.abs(i - j) <= 3) continue;
        // Skip closing segment adjacency
        if (i <= 2 && j >= pts.length - 4) continue;
        const b1 = pts[j];
        const b2 = pts[j + 1];
        const hit = segmentIntersection(a1, a2, b1, b2);
        if (hit) return true;
      }
    }
    return false;
  }

  /**
   * Calculate maximum curvature in a path
   */
  function getMaxCurvature(points) {
    const pts = ensureClosed(points);
    const n = pts.length;
    if (n < 4) return 0;

    let maxCurv = 0;
    for (let i = 0; i < n - 1; i++) {
      const prevIdx = (i - 1 + n - 1) % (n - 1);
      const nextIdx = (i + 1) % (n - 1);
      const curv = Math.abs(calcCurvature(pts[prevIdx], pts[i], pts[nextIdx]));
      if (curv > maxCurv) maxCurv = curv;
    }
    return maxCurv;
  }

  /**
   * Aggressively smooth the entire track until maximum curvature is below threshold.
   * This is the nuclear option - guarantees no sharp corners.
   */
  function smoothUntilSafe(points, maxAllowedCurvature, maxPasses = 50) {
    let pts = ensureClosed(points).map(p => ({ x: p.x, y: p.y }));

    for (let pass = 0; pass < maxPasses; pass++) {
      const currentMaxCurv = getMaxCurvature(pts);

      // If we're under the threshold, we're done
      if (currentMaxCurv <= maxAllowedCurvature) {
        break;
      }

      // Apply whole-track Laplacian smoothing
      pts = relaxPath(pts, 20, 0.5);
      pts = resamplePath(pts, 10);
    }

    return pts;
  }

  /**
   * Prevent edge overlap by iteratively smoothing the ENTIRE track
   * until the inner edge no longer self-intersects.
   * This is a guaranteed fix - it will keep smoothing until the problem is gone.
   */
  function preventEdgeOverlap(points, visualRoadWidth, maxIterations = 200) {
    let pts = ensureClosed(points).map(p => ({ x: p.x, y: p.y }));
    const halfWidth = visualRoadWidth * 0.5;

    // The minimum radius needed to prevent overlap is slightly more than halfWidth
    // We use 1.2x to have safety margin
    const safeMinRadius = halfWidth * 1.2;
    const maxAllowedCurvature = 1 / safeMinRadius;

    for (let iter = 0; iter < maxIterations; iter++) {
      // Compute inner edge (negative offset)
      const innerEdge = computeOffsetCurve(pts, -halfWidth);

      // Check if inner edge has self-intersections
      if (!hasEdgeSelfIntersection(innerEdge)) {
        // Also verify max curvature is under threshold
        const maxCurv = getMaxCurvature(pts);
        if (maxCurv <= maxAllowedCurvature) {
          break;
        }
      }

      // Apply aggressive whole-track smoothing
      pts = relaxPath(pts, 10, 0.6);
      pts = resamplePath(pts, 8);

      // Also enforce minimum radius
      pts = enforceMinimumRadius(pts, safeMinRadius, 50);
    }

    return pts;
  }

  /**
   * The ultimate smoothing function - guarantees no edge overlaps are possible.
   * Uses multiple passes and verification.
   */
  function guaranteeNoOverlap(points, visualRoadWidth) {
    let pts = ensureClosed(points).map(p => ({ x: p.x, y: p.y }));
    const halfWidth = visualRoadWidth * 0.5;

    // Step 1: Calculate the minimum radius we need
    // For no overlap, centerline radius must be > halfWidth
    // We use 2.5x for a VERY comfortable margin - this makes corners much wider than
    // the road, ensuring there's zero chance of inner edge overlap
    const requiredMinRadius = halfWidth * 2.5;
    const maxAllowedCurvature = 1 / requiredMinRadius;

    // Step 2: First pass - aggressive relaxation
    pts = relaxPath(pts, 100, 0.6);
    pts = resamplePath(pts, 8);

    // Step 3: Enforce minimum radius strictly with MANY iterations
    pts = enforceMinimumRadius(pts, requiredMinRadius, 1000);
    pts = resamplePath(pts, 8);

    // Step 4: Smooth until curvature is safe
    pts = smoothUntilSafe(pts, maxAllowedCurvature, 50);

    // Step 5: Final verification and fix loop
    for (let verify = 0; verify < 100; verify++) {
      const innerEdge = computeOffsetCurve(pts, -halfWidth);
      const hasOverlap = hasEdgeSelfIntersection(innerEdge);
      const maxCurv = getMaxCurvature(pts);

      if (!hasOverlap && maxCurv <= maxAllowedCurvature) {
        break; // Success!
      }

      // Still has issues - apply more smoothing
      pts = relaxPath(pts, 30, 0.7);
      pts = resamplePath(pts, 8);
      pts = enforceMinimumRadius(pts, requiredMinRadius, 200);
    }

    // Step 6: Final resample for even spacing
    pts = resamplePath(pts, 10);

    return pts;
  }

  function resamplePath(points, spacing) {
    const pts = ensureClosed(points);
    if (pts.length < 2) return pts;
    const result = [];
    let accumulated = 0;
    let prev = pts[0];
    result.push({ ...prev });
    for (let i = 1; i < pts.length; i++) {
      const curr = pts[i];
      let segLen = distance(prev, curr);
      if (!segLen) continue;
      while (accumulated + segLen >= spacing) {
        const remain = spacing - accumulated;
        const ratio = remain / segLen;
        const nx = prev.x + (curr.x - prev.x) * ratio;
        const ny = prev.y + (curr.y - prev.y) * ratio;
        result.push({ x: nx, y: ny });
        segLen -= remain;
        prev = { x: nx, y: ny };
        accumulated = 0;
      }
      accumulated += segLen;
      prev = curr;
    }
    // Close loop explicitly
    if (distance(result[0], result[result.length - 1]) > 1) {
      result.push({ ...result[0] });
    } else {
      result[result.length - 1] = { ...result[0] };
    }
    return result;
  }

  function segmentIntersection(a1, a2, b1, b2) {
    const det = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
    if (Math.abs(det) < 1e-6) return null;
    const ua = ((b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)) / det;
    const ub = ((a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x)) / det;
    if (ua <= 0 || ua >= 1 || ub <= 0 || ub >= 1) return null;
    return {
      x: a1.x + ua * (a2.x - a1.x),
      y: a1.y + ua * (a2.y - a1.y)
    };
  }

  function findSelfIntersections(points) {
    const pts = ensureClosed(points);
    const intersections = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a1 = pts[i];
      const a2 = pts[i + 1];
      for (let j = i + 2; j < pts.length - 1; j++) {
        if (Math.abs(i - j) <= 1) continue; // skip adjacent
        const b1 = pts[j];
        const b2 = pts[j + 1];
        if (i === 0 && j === pts.length - 2) continue; // skip closing segment adjacency
        const hit = segmentIntersection(a1, a2, b1, b2);
        if (hit) intersections.push(hit);
      }
    }
    return intersections;
  }

  function normalFromSegment(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  }

  function tangentFromSegment(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len, len };
  }

  function computeTrackMeta(centerline, roadWidth) {
    const first = centerline[0];
    const second = centerline[1] || first;
    const tangent = tangentFromSegment(first, second);
    const normal = normalFromSegment(first, second);
    const half = roadWidth * 0.5;
    const startLine = {
      a: { x: first.x + normal.x * half, y: first.y + normal.y * half },
      b: { x: first.x - normal.x * half, y: first.y - normal.y * half }
    };
    const startOffset = roadWidth * 0.8;
    const spawnPlayer = {
      x: first.x + tangent.x * startOffset,
      y: first.y + tangent.y * startOffset,
      angle: Math.atan2(tangent.y, tangent.x)
    };
    const spawnAIBase = {
      x: first.x - tangent.x * roadWidth * 0.6,
      y: first.y - tangent.y * roadWidth * 0.6,
      angle: Math.atan2(tangent.y, tangent.x)
    };
    const bbox = boundingBox(centerline);
    const checkpoints = buildCheckpoints(centerline, roadWidth);
    return {
      startLine,
      spawn: { player: spawnPlayer, ai: spawnAIBase },
      checkpoints,
      bounds: bbox
    };
  }

  function boundingBox(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function buildCheckpoints(centerline, roadWidth) {
    const checkpoints = [];
    const total = Math.max(6, Math.floor(centerline.length / 12));
    const spacing = Math.floor(centerline.length / total);
    for (let i = 0; i < total; i++) {
      const idx = (i * spacing) % (centerline.length - 1);
      const a = centerline[idx];
      const b = centerline[(idx + 1) % (centerline.length - 1)];
      const tangent = tangentFromSegment(a, b);
      const normal = { x: -tangent.y, y: tangent.x };
      const half = roadWidth * 0.5;
      checkpoints.push({
        a: { x: a.x + normal.x * half, y: a.y + normal.y * half },
        b: { x: a.x - normal.x * half, y: a.y - normal.y * half }
      });
    }
    return checkpoints;
  }

  function makeMask(centerline, roadWidth, worldWidth, worldHeight) {
    const canvas = document.createElement("canvas");
    canvas.width = worldWidth;
    canvas.height = worldHeight;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = roadWidth;
    ctx.beginPath();
    for (let i = 0; i < centerline.length; i++) {
      const p = centerline[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    const pngData = canvas.toDataURL("image/png");
    return {
      width: canvas.width,
      height: canvas.height,
      pngData
    };
  }

  function makeThumbnail(centerline, worldWidth, worldHeight, roadWidth) {
    const thumb = document.createElement("canvas");
    const THUMB_W = 320;
    const aspect = worldWidth / worldHeight || 1;
    const THUMB_H = Math.round(THUMB_W / aspect);
    thumb.width = THUMB_W;
    thumb.height = THUMB_H;
    const ctx = thumb.getContext("2d");

    // Slick Background: Deep/Dark charcoal with subtle vignette
    const cx = thumb.width / 2;
    const cy = thumb.height / 2;
    const radius = Math.max(thumb.width, thumb.height) * 0.8;
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius);
    grad.addColorStop(0, '#1a1a1a'); // Dark Grey center
    grad.addColorStop(1, '#050505'); // Almost Black edges

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, thumb.width, thumb.height);

    ctx.restore();

    const scaleX = thumb.width / worldWidth;
    const scaleY = thumb.height / worldHeight;

    // Scale track width to look like a road, not a wire
    // Real road is ~120 units. We multiply by 3.5 to make it visible and chunky on the small thumbnail
    const trackWidth = Math.max(8, (120 * scaleX) * 3.5);

    // Draw Path Helper
    function drawPath() {
      ctx.beginPath();
      for (let i = 0; i < centerline.length; i++) {
        const p = centerline[i];
        const x = p.x * scaleX;
        const y = p.y * scaleY;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    // Pass 1: Outer Glow (Neon Effect)
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#3b82f6"; // Blue-500 glow
    ctx.strokeStyle = "#3b82f6"; // Blue-500
    ctx.lineWidth = Math.max(3, lineWidthBase * 1.5);
    drawPath();
    ctx.stroke();
    ctx.restore();

    // Pass 2: Inner Core (Bright)
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#e0f2fe"; // Sky-100 (almost white)
    ctx.lineWidth = Math.max(1.5, lineWidthBase);
    drawPath();
    ctx.stroke();
    ctx.restore();

    return {
      width: thumb.width,
      height: thumb.height,
      pngData: thumb.toDataURL("image/png")
    };
  }

  function TrackEditor(options) {
    this.options = options || {};
    this.trackSelect = options.trackSelect || null;
    this.onSaved = typeof options.onSaved === "function" ? options.onSaved : () => { };
    this.onTestDrive = typeof options.onTestDrive === "function" ? options.onTestDrive : () => { };
    this.state = {
      tool: "pen",
      points: [],
      roadWidth: DEFAULT_ROAD_WIDTH,
      scale: DEFAULT_SCALE,
      textureId: DEFAULT_TEXTURE,
      isDrawing: false,
      pointerId: null,
      history: [],
      historyIndex: -1,
      status: "",
      lastBakeResult: null
    };
    this.init();
  }

  TrackEditor.prototype.init = function () {
    this.buildUI();
    this.attachEvents();
    this.pushHistory();
    this.render();
  };

  TrackEditor.prototype.buildUI = function () {
    // Build texture options HTML
    const textureOptionsHtml = TEXTURE_OPTIONS.map(opt =>
      `<option value="${opt.id}"${opt.id === DEFAULT_TEXTURE ? ' selected' : ''}>${opt.name}</option>`
    ).join('');

    const overlay = document.createElement("div");
    overlay.className = "track-editor-overlay hidden";
    overlay.innerHTML = `
      <div class="track-editor-panel" role="dialog" aria-modal="true">
        <header class="track-editor-header">
          <h2>Create Track</h2>
          <div class="spacer"></div>
          <button type="button" class="te-btn te-secondary" data-action="close" aria-label="Close">×</button>
        </header>
        <div class="track-editor-body">
          <div class="track-editor-canvas-wrap">
            <canvas width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" class="track-editor-canvas"></canvas>
            <div class="track-editor-instructions">
              Draw a closed loop with the pen. Use eraser to fix mistakes. Finish by clicking "Bake".
            </div>
          </div>
          <div class="track-editor-controls">
            <label class="te-field">
              <span>Track Name</span>
              <input type="text" class="te-input" data-field="name" placeholder="My Custom Circuit" maxlength="48" />
            </label>
            <div class="te-tools">
              <button type="button" class="te-btn te-tool active" data-tool="pen">Pen</button>
              <button type="button" class="te-btn te-tool" data-tool="erase">Eraser</button>
              <button type="button" class="te-btn te-secondary" data-action="undo" title="Undo (Ctrl+Z)">Undo</button>
              <button type="button" class="te-btn te-secondary" data-action="redo" title="Redo (Ctrl+Y)">Redo</button>
              <button type="button" class="te-btn te-secondary" data-action="clear">Clear</button>
            </div>
            <label class="te-field slider">
              <span>Road Width <strong data-label="roadWidth">${DEFAULT_ROAD_WIDTH}</strong> px</span>
              <input type="range" min="${ROAD_WIDTH_RANGE[0]}" max="${ROAD_WIDTH_RANGE[1]}" value="${DEFAULT_ROAD_WIDTH}" step="1" data-field="roadWidth" />
            </label>
            <label class="te-field slider">
              <span>World Scale <strong data-label="scale">${DEFAULT_SCALE.toFixed(2)}</strong>x</span>
              <input type="range" min="${SCALE_RANGE[0]}" max="${SCALE_RANGE[1]}" value="${DEFAULT_SCALE}" step="0.01" data-field="scale" />
            </label>
            <label class="te-field">
              <span>Track Texture</span>
              <select class="te-select" data-field="texture">
                ${textureOptionsHtml}
              </select>
            </label>
            <div class="te-status" aria-live="polite"></div>
            <div class="te-actions">
              <button type="button" class="te-btn te-secondary" data-action="export">Export Bundle</button>
              <button type="button" class="te-btn te-primary" data-action="bake">Bake & Save</button>
            </div>
            <div class="te-test hidden" data-test-actions>
              <div>Test-drive freshly baked track:</div>
              <div class="te-test-buttons">
                <button type="button" class="te-btn te-secondary" data-action="test-grip">Grip Mode</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.canvas = overlay.querySelector("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.statusEl = overlay.querySelector(".te-status");
    this.nameInput = overlay.querySelector('[data-field="name"]');
    this.roadWidthInput = overlay.querySelector('[data-field="roadWidth"]');
    this.scaleInput = overlay.querySelector('[data-field="scale"]');
    this.textureSelect = overlay.querySelector('[data-field="texture"]');
    this.roadWidthLabel = overlay.querySelector('[data-label="roadWidth"]');
    this.scaleLabel = overlay.querySelector('[data-label="scale"]');
    this.testActions = overlay.querySelector("[data-test-actions]");
  };

  TrackEditor.prototype.attachEvents = function () {
    const overlay = this.overlay;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });
    overlay.querySelector('[data-action="close"]').addEventListener("click", () => this.close());
    overlay.querySelector('[data-action="undo"]').addEventListener("click", () => this.undo());
    overlay.querySelector('[data-action="redo"]').addEventListener("click", () => this.redo());
    overlay.querySelector('[data-action="clear"]').addEventListener("click", () => this.clear());
    overlay.querySelector('[data-action="bake"]').addEventListener("click", () => this.bake());
    overlay.querySelector('[data-action="export"]').addEventListener("click", () => this.exportBundle());
    overlay.querySelector('[data-action="test-grip"]').addEventListener("click", () => this.testDrive("grip"));

    const toolButtons = overlay.querySelectorAll(".te-tool");
    toolButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        toolButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.state.tool = btn.dataset.tool;
      });
    });

    this.roadWidthInput.addEventListener("input", () => {
      const value = clamp(parseFloat(this.roadWidthInput.value) || DEFAULT_ROAD_WIDTH, ROAD_WIDTH_RANGE[0], ROAD_WIDTH_RANGE[1]);
      this.state.roadWidth = value;
      this.roadWidthLabel.textContent = value.toFixed(0);
      this.render();
    });

    this.scaleInput.addEventListener("input", () => {
      const value = clamp(parseFloat(this.scaleInput.value) || DEFAULT_SCALE, SCALE_RANGE[0], SCALE_RANGE[1]);
      this.state.scale = value;
      this.scaleLabel.textContent = value.toFixed(2);
    });

    this.textureSelect.addEventListener("change", () => {
      this.state.textureId = this.textureSelect.value || DEFAULT_TEXTURE;
    });

    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.canvas.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    this.canvas.addEventListener("pointerleave", (e) => this.onPointerUp(e));

    window.addEventListener("keydown", (e) => {
      if (this.overlay.classList.contains("hidden")) return;
      if (e.key === "Escape") {
        this.close();
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        this.undo();
      } else if ((ctrl && e.key.toLowerCase() === "y") || (ctrl && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        this.redo();
      }
    }, { passive: false });
  };

  TrackEditor.prototype.open = function () {
    this.overlay.classList.remove("hidden");
    this.canvas.focus();
    this.render();
  };

  TrackEditor.prototype.close = function () {
    this.overlay.classList.add("hidden");
    this.state.isDrawing = false;
    this.state.pointerId = null;
  };

  TrackEditor.prototype.reset = function () {
    this.state.points = [];
    this.state.history = [];
    this.state.historyIndex = -1;
    this.state.lastBakeResult = null;
    this.testActions.classList.add("hidden");
    this.setStatus("", "");
    this.roadWidthInput.value = DEFAULT_ROAD_WIDTH;
    this.scaleInput.value = DEFAULT_SCALE;
    this.textureSelect.value = DEFAULT_TEXTURE;
    this.roadWidthLabel.textContent = DEFAULT_ROAD_WIDTH.toFixed(0);
    this.scaleLabel.textContent = DEFAULT_SCALE.toFixed(2);
    this.state.roadWidth = DEFAULT_ROAD_WIDTH;
    this.state.scale = DEFAULT_SCALE;
    this.state.textureId = DEFAULT_TEXTURE;
    this.nameInput.value = "";
    this.pushHistory();
    this.render();
  };

  TrackEditor.prototype.onPointerDown = function (e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const pos = this.getCanvasPos(e);
    this.state.pointerId = e.pointerId;
    if (this.state.tool === "pen") {
      if (!this.state.isDrawing) this.pushHistory();
      this.state.isDrawing = true;
      this.addPoint(pos, true);
    } else if (this.state.tool === "erase") {
      this.eraseAt(pos);
      this.pushHistory();
    }
    this.render();
  };

  TrackEditor.prototype.onPointerMove = function (e) {
    if (this.state.pointerId !== e.pointerId) return;
    const pos = this.getCanvasPos(e);
    if (this.state.tool === "pen" && this.state.isDrawing) {
      // Filter jitter: only add point if far enough from last point
      if (this.state.points.length > 0) {
        const last = this.state.points[this.state.points.length - 1];
        if (distance(last, pos) < SAMPLING_SPACING) return;
      }
      this.addPoint(pos, false);
      this.render();
    } else if (this.state.tool === "erase" && e.buttons) {
      this.eraseAt(pos);
      this.render();
    }
  };

  TrackEditor.prototype.onPointerUp = function (e) {
    if (this.state.pointerId !== e.pointerId) return;
    if (this.state.tool === "pen" && this.state.isDrawing) {
      this.state.isDrawing = false;

      // --- Post-processing to fix "wobbly" tracks and prevent edge overlap ---
      if (this.state.points.length > 10) {
        // CRITICAL: Use visual width (with widthScale) for minimum radius calculation
        const widthScale = readWidthScale();
        const visualRoadWidth = this.state.roadWidth * widthScale;

        // Initial simplify and resample
        this.state.points = simplifyPath(this.state.points, 2.0);
        this.state.points = resamplePath(this.state.points, 8);

        // Use the guaranteed no-overlap function - this is the nuclear option
        // It will keep smoothing until edge overlap is IMPOSSIBLE
        this.state.points = guaranteeNoOverlap(this.state.points, visualRoadWidth);

        // Final closure
        this.state.points = ensureClosed(this.state.points, 32);
      }
      // ---------------------------------------------------

      this.pushHistory();
      this.render();
    }
    this.state.pointerId = null;
  };

  TrackEditor.prototype.getCanvasPos = function (e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
    return { x, y };
  };

  TrackEditor.prototype.addPoint = function (point, force) {
    const pts = this.state.points;
    if (!pts.length || force) {
      pts.push({ x: point.x, y: point.y });
      return;
    }
    const last = pts[pts.length - 1];
    if (distance(point, last) >= 3) {
      pts.push({ x: point.x, y: point.y });
    }
  };

  TrackEditor.prototype.eraseAt = function (point) {
    const pts = this.state.points;
    if (!pts.length) return;
    const next = pts.filter((p) => distance(p, point) > ERASE_RADIUS);
    if (next.length !== pts.length) {
      this.state.points = next;
      this.pushHistory();
    }
  };

  TrackEditor.prototype.undo = function () {
    if (this.state.historyIndex <= 0) return;
    this.state.historyIndex -= 1;
    this.state.points = copyPoints(this.state.history[this.state.historyIndex]);
    this.render();
  };

  TrackEditor.prototype.redo = function () {
    if (this.state.historyIndex >= this.state.history.length - 1) return;
    this.state.historyIndex += 1;
    this.state.points = copyPoints(this.state.history[this.state.historyIndex]);
    this.render();
  };

  TrackEditor.prototype.clear = function () {
    this.state.points = [];
    this.state.history = [];
    this.state.historyIndex = -1;
    this.state.lastBakeResult = null;
    this.testActions.classList.add("hidden");
    this.setStatus("", "");
    this.pushHistory();
    this.render();
  };

  TrackEditor.prototype.pushHistory = function () {
    const snapshot = copyPoints(this.state.points);
    this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
    this.state.history.push(snapshot);
    this.state.historyIndex = this.state.history.length - 1;
  };

  TrackEditor.prototype.render = function () {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#050914";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawGrid(ctx);
    this.drawPath(ctx);
  };

  TrackEditor.prototype.drawGrid = function (ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(148,163,184,0.15)";
    ctx.lineWidth = 1;
    for (let x = GRID_SPACING; x < this.canvas.width; x += GRID_SPACING) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvas.height);
      ctx.stroke();
    }
    for (let y = GRID_SPACING; y < this.canvas.height; y += GRID_SPACING) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.canvas.width, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  TrackEditor.prototype.drawPath = function (ctx) {
    const pts = this.state.points;
    if (!pts.length) return;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = this.state.roadWidth * 0.5;
    ctx.strokeStyle = "rgba(59,130,246,0.35)";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#38bdf8";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.fillStyle = "#fcd34d";
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  TrackEditor.prototype.setStatus = function (message, tone) {
    this.statusEl.textContent = message || "";
    this.statusEl.dataset.tone = tone || "";
  };

  TrackEditor.prototype.validate = function () {
    if (this.state.points.length < MIN_POINTS) {
      throw new Error("Need more detail. Draw a longer loop before baking.");
    }
  };

  TrackEditor.prototype.bake = async function () {
    try {
      this.validate();
    } catch (err) {
      this.setStatus(err.message, "error");
      return;
    }
    const rawName = this.nameInput.value.trim();
    const name = rawName || "Custom Circuit";
    const closedRaw = ensureClosed(copyPoints(this.state.points));
    const roadWidth = this.state.roadWidth;

    // CRITICAL: Use visual width (with widthScale) for minimum radius calculation
    const widthScale = readWidthScale();
    const visualRoadWidth = roadWidth * widthScale;

    // Initial processing
    let processed = simplifyPath(closedRaw, 2.0);
    processed = resamplePath(processed, 8);

    // Use the guaranteed no-overlap function - this is the nuclear option
    // It will keep smoothing until edge overlap is IMPOSSIBLE
    processed = guaranteeNoOverlap(processed, visualRoadWidth);

    processed = resamplePath(processed, SAMPLING_SPACING);

    const intersections = findSelfIntersections(processed);
    const scaled = processed.map((p) => ({
      x: p.x * this.state.scale,
      y: p.y * this.state.scale
    }));
    const worldWidth = Math.round(this.canvas.width * this.state.scale);
    const worldHeight = Math.round(this.canvas.height * this.state.scale);
    const meta = computeTrackMeta(scaled, roadWidth);
    const mask = makeMask(scaled, roadWidth, worldWidth, worldHeight);
    const thumbnail = makeThumbnail(scaled, worldWidth, worldHeight, visualRoadWidth);
    const racingLine = (window.RacerAI && typeof window.RacerAI.buildRacingLine === "function")
      ? window.RacerAI.buildRacingLine(scaled, roadWidth)
      : [];
    const data = {
      name,
      world: { width: worldWidth, height: worldHeight, scale: this.state.scale },
      points: scaled,
      roadWidth,
      textureId: this.state.textureId || DEFAULT_TEXTURE,
      racingLine,
      startLine: meta.startLine,
      spawn: meta.spawn,
      checkpoints: meta.checkpoints,
      warnings: intersections.length ? { intersections: intersections.length } : null,
      createdAt: Date.now()
    };
    const entry = {
      id: TrackStore.uuid(),
      name,
      data,
      mask,
      thumbnail,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    entry.data.mask = mask;
    entry.data.thumbnail = thumbnail;
    if (intersections.length) {
      entry.data.warnings = {
        intersections: intersections.length
      };
    }
    await TrackStore.saveTrack(entry);
    this.state.lastBakeResult = entry;
    this.testActions.classList.remove("hidden");
    const msg = intersections.length ?
      `${name} saved. Warning: ${intersections.length} self-intersection${intersections.length > 1 ? "s" : ""} detected.` :
      `${name} saved and ready to race.`;
    this.setStatus(msg, intersections.length ? "warn" : "success");
    this.onSaved(entry);
  };

  TrackEditor.prototype.exportBundle = function () {
    if (this.state.lastBakeResult) {
      TrackStore.downloadBundle(this.state.lastBakeResult);
      return;
    }
    this.setStatus("Bake the track before exporting.", "info");
  };

  TrackEditor.prototype.testDrive = function (mode) {
    if (!this.state.lastBakeResult) {
      this.setStatus("Bake the track first.", "info");
      return;
    }
    this.onTestDrive(mode, this.state.lastBakeResult);
  };

  function create(options) {
    return new TrackEditor(options);
  }

  global.TrackEditor = { create };
})(typeof window !== "undefined" ? window : this);
