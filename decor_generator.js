(function (global) {
  const DEFAULT_PARAMS = {
    treeDensity: 0.35,
    buildingDensity: 0.25,
    kerbWidthScale: 1.0,
    shadowStrength: 0.55,
  };
  // Canvas size limit - 2048 works on most devices
  const DECOR_TEXTURE_LIMITS = {
    maxSize: 2048,
    targetPxPerMeter: 6,
  };
  const BUFFER_RADIUS = 28;
  const TREE_MIN_SPACING = 35;
  const TREE_MAX_SPACING = 55;
  const BUILDING_SPACING = 160;
  const BARRIER_SPACING = 42;
  const BARRIER_CURVATURE_THRESHOLD = 0.35;
  const INNER_WALL_SEGMENT_LENGTH = 80; // Length of each wall segment on inner edge
  const EDGE_SHADOW_BLUR = 8;
  const SPRITE_ATLAS_URL = "assets/decor/decor_atlas.png";

  const SPRITE_MAP = {
    tree: [
      { x: 0, y: 0, w: 48, h: 48 },
      { x: 48, y: 0, w: 48, h: 48 },
      { x: 96, y: 0, w: 48, h: 48 },
      { x: 144, y: 0, w: 48, h: 48 },
    ],
    barrier: { x: 0, y: 48, w: 32, h: 16 },
    building: { x: 32, y: 48, w: 48, h: 32 },
    kerb: { x: 80, y: 48, w: 16, h: 16 },
  };

  let atlasPromise = null;
  let atlasImage = null;

  function createCanvas2d(width, height, willRead = false) {
    const canvas = (typeof OffscreenCanvas !== "undefined" && typeof document === "undefined")
      ? new OffscreenCanvas(width, height)
      : (() => {
        const cnv = (typeof document !== "undefined") ? document.createElement("canvas") : new OffscreenCanvas(width, height);
        cnv.width = width;
        cnv.height = height;
        return cnv;
      })();
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d", willRead ? { willReadFrequently: true } : undefined) || canvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
    }
    return { canvas, ctx };
  }

  function copyCanvasRegion(srcCanvas, bounds) {
    if (!srcCanvas) return null;
    const sx = Math.max(0, Math.floor(bounds.minX));
    const sy = Math.max(0, Math.floor(bounds.minY));
    const sw = Math.max(1, Math.ceil(bounds.maxX - bounds.minX));
    const sh = Math.max(1, Math.ceil(bounds.maxY - bounds.minY));
    const tmp = (typeof OffscreenCanvas !== "undefined") ? new OffscreenCanvas(sw, sh) : document.createElement("canvas");
    tmp.width = sw;
    tmp.height = sh;
    const tctx = tmp.getContext("2d", { willReadFrequently: true }) || tmp.getContext("2d");
    if (!tctx) return null;
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return { canvas: tmp, offsetX: sx, offsetY: sy, width: sw, height: sh };
  }

  function computeBounds(points, fallbackWidth, fallbackHeight) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    if (Array.isArray(points) && points.length) {
      for (const p of points) {
        if (!p) continue;
        const x = Number(p.x);
        const y = Number(p.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return {
        minX: 0,
        minY: 0,
        maxX: Math.max(1, Number(fallbackWidth) || 1000),
        maxY: Math.max(1, Number(fallbackHeight) || 700),
      };
    }
    return { minX, minY, maxX, maxY };
  }

  function expandBounds(bounds, pad, limitWidth, limitHeight) {
    if (!bounds) return null;
    const out = {
      minX: bounds.minX - pad,
      minY: bounds.minY - pad,
      maxX: bounds.maxX + pad,
      maxY: bounds.maxY + pad,
    };
    if (typeof limitWidth === "number") {
      out.minX = Math.max(0, out.minX);
      out.maxX = Math.min(limitWidth, out.maxX);
    }
    if (typeof limitHeight === "number") {
      out.minY = Math.max(0, out.minY);
      out.maxY = Math.min(limitHeight, out.maxY);
    }
    if (out.maxX <= out.minX) {
      out.maxX = out.minX + 1;
    }
    if (out.maxY <= out.minY) {
      out.maxY = out.minY + 1;
    }
    return out;
  }

  function pickDecorResolution(bounds, opts = {}) {
    const limits = Object.assign({}, DECOR_TEXTURE_LIMITS, opts.textureLimits || {});
    const dpr = Math.max(1, Number(opts.devicePixelRatio) || ((typeof window !== "undefined" && window.devicePixelRatio) || 1));
    const targetPPM = Math.max(2, Math.round(((opts.pxPerMeter != null ? Number(opts.pxPerMeter) : limits.targetPxPerMeter) || limits.targetPxPerMeter) * dpr));
    let ppm = targetPPM;
    let texW = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * ppm));
    let texH = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) * ppm));
    const over = Math.max(texW / limits.maxSize, texH / limits.maxSize, 1);
    if (over > 1) {
      ppm = Math.max(2, Math.floor(ppm / over));
      texW = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * ppm));
      texH = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) * ppm));
    }
    return { ppm, texW, texH };
  }

  function loadAtlas(url = SPRITE_ATLAS_URL) {
    if (atlasPromise) return atlasPromise;
    atlasPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = function () {
        if (img.naturalWidth < 160 || img.naturalHeight < 64) {
          atlasImage = null;
          resolve(null);
          return;
        }
        atlasImage = img;
        resolve(img);
      };
      img.onerror = function () {
        atlasImage = null;
        resolve(null);
      };
      img.src = url;
    });
    return atlasPromise;
  }

  function getAtlas() {
    return atlasImage;
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    let s = seed >>> 0 || 1;
    const rand = function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    rand.int = function (max) {
      return Math.floor(rand() * max);
    };
    rand.range = function (min, max) {
      return min + (max - min) * rand();
    };
    rand.choice = function (arr) {
      return arr[rand.int(arr.length)];
    };
    return rand;
  }

  function cloneMetadata(meta) {
    return meta ? JSON.parse(JSON.stringify(meta)) : null;
  }

  function polylineLength(points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (!a || !b) continue;
      total += Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0));
    }
    return total;
  }

  function polygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      if (!p || !q) continue;
      area += (p.x || 0) * (q.y || 0) - (q.x || 0) * (p.y || 0);
    }
    return Math.abs(area) * 0.5;
  }

  function medianValue(values) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if ((sorted.length % 2) === 0) {
      return (sorted[mid - 1] + sorted[mid]) * 0.5;
    }
    return sorted[mid];
  }

  function computeStadiumStats(items) {
    const stadiums = Array.isArray(items && items.stadiums) ? items.stadiums : [];
    const innerWalls = items && items.innerWalls ? items.innerWalls : {};
    const segments = [
      ...((innerWalls && innerWalls.outerSegments) || []),
      ...((innerWalls && innerWalls.innerSegments) || []),
    ];

    let wallLength = 0;
    for (const segment of segments) {
      wallLength += polylineLength(segment && segment.points ? segment.points : []);
    }

    const innerLengths = [];
    const areas = [];
    const depthEstimates = [];
    let stadiumInnerLength = 0;

    for (const stadium of stadiums) {
      const innerLength = polylineLength(stadium && stadium.innerPoints ? stadium.innerPoints : []);
      const area = polygonArea(stadium && stadium.points ? stadium.points : []);
      const depthEstimate = innerLength > 0 ? area / innerLength : 0;
      innerLengths.push(innerLength);
      areas.push(area);
      depthEstimates.push(depthEstimate);
      stadiumInnerLength += innerLength;
    }

    const avg = (values) => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;

    return {
      stadiumCount: stadiums.length,
      wallLength,
      stadiumInnerLength,
      wallCoverageRatio: wallLength > 0 ? (stadiumInnerLength / wallLength) : 0,
      averageInnerLength: avg(innerLengths),
      medianInnerLength: medianValue(innerLengths),
      maxInnerLength: innerLengths.length ? Math.max(...innerLengths) : 0,
      averageArea: avg(areas),
      averageDepth: avg(depthEstimates),
    };
  }

  function readMask(canvas) {
    const width = canvas.width;
    const height = canvas.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) || canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = data[i * 4] > 14 ? 1 : 0;
    }
    return { width, height, data: mask };
  }

  function blurMask(canvas, radius) {
    const width = canvas.width;
    const height = canvas.height;
    const tmp = (typeof OffscreenCanvas !== "undefined") ? new OffscreenCanvas(width, height) : document.createElement("canvas");
    if (tmp.width !== width) tmp.width = width;
    if (tmp.height !== height) tmp.height = height;
    const tctx = tmp.getContext("2d", { willReadFrequently: true }) || tmp.getContext("2d");
    tctx.clearRect(0, 0, width, height);
    try {
      tctx.filter = `blur(${radius}px)`;
      tctx.drawImage(canvas, 0, 0);
      tctx.filter = "none";
    } catch (err) {
      // Fallback: no filter support, fall back to simple draw.
      tctx.drawImage(canvas, 0, 0);
    }
    const blurred = tctx.getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = blurred[i * 4] > 8 ? 1 : 0;
    }
    return mask;
  }

  function createZones(maskCanvas, bufferRadius, cropBounds) {
    let sourceCanvas = maskCanvas;
    let offsetX = 0;
    let offsetY = 0;
    if (cropBounds) {
      const region = copyCanvasRegion(maskCanvas, cropBounds);
      if (region && region.canvas) {
        sourceCanvas = region.canvas;
        offsetX = region.offsetX;
        offsetY = region.offsetY;
      }
    }
    const road = readMask(sourceCanvas);
    const bufferMask = blurMask(sourceCanvas, bufferRadius);
    const greenMask = new Uint8Array(road.data.length);
    for (let i = 0; i < greenMask.length; i++) {
      greenMask[i] = bufferMask[i] ? 0 : 1;
    }
    return {
      roadMask: road.data,
      bufferMask,
      greenMask,
      width: road.width,
      height: road.height,
      offsetX,
      offsetY,
    };
  }

  /**
   * Build edge curves (inner and outer) from a centerline.
   * Uses miter-style averaging at corners with curvature-based offset limiting
   * to prevent self-intersection on sharp turns.
   */
  function buildEdges(centerline, roadWidth) {
    const inner = [];
    const outer = [];
    const normals = [];
    const half = (roadWidth || 80) * 0.5;
    const n = centerline.length;

    if (n < 2) return { inner, outer, normals };

    // Pre-compute segment normals
    const segNormals = [];
    for (let i = 0; i < n - 1; i++) {
      const a = centerline[i];
      const b = centerline[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      segNormals.push({ x: -dy / len, y: dx / len });
    }
    // For closed loop: add normal from last to first
    const lastPt = centerline[n - 1];
    const firstPt = centerline[0];
    const dxClose = firstPt.x - lastPt.x;
    const dyClose = firstPt.y - lastPt.y;
    const lenClose = Math.hypot(dxClose, dyClose) || 1;
    segNormals.push({ x: -dyClose / lenClose, y: dxClose / lenClose });

    for (let i = 0; i < n; i++) {
      const pt = centerline[i];

      // Get normals of adjacent segments
      const prevSegIdx = (i - 1 + n) % n;
      const currSegIdx = i % segNormals.length;

      // For first point, use next segment normal; for others, average prev and curr
      let nx, ny;
      if (i === 0) {
        // Average closing segment normal with first segment normal
        const n1 = segNormals[segNormals.length - 1];
        const n2 = segNormals[0];
        nx = (n1.x + n2.x) / 2;
        ny = (n1.y + n2.y) / 2;
      } else if (i === n - 1) {
        // Last point (same as first for closed loop)
        const n1 = segNormals[i - 1];
        const n2 = segNormals[segNormals.length - 1];
        nx = (n1.x + n2.x) / 2;
        ny = (n1.y + n2.y) / 2;
      } else {
        // Average previous and current segment normals
        const n1 = segNormals[i - 1];
        const n2 = segNormals[i];
        nx = (n1.x + n2.x) / 2;
        ny = (n1.y + n2.y) / 2;
      }

      // Normalize the averaged normal
      const avgLen = Math.hypot(nx, ny) || 1;
      nx /= avgLen;
      ny /= avgLen;

      // Calculate miter factor (how much to extend/contract at corners)
      // For sharp corners (low avgLen before normalization), this can get very large
      // Limit it to prevent extreme miter extensions
      const miterFactor = 1 / (avgLen + 0.001);

      // For inner curve (negative offset), limit the offset at sharp corners
      // to prevent self-intersection
      // The key insight: at sharp inward corners, reduce the inner offset
      let innerOffset = half;
      let outerOffset = half;

      // Check if this is a sharp corner by looking at the angle between normals
      if (i > 0 && i < n - 1) {
        const n1 = segNormals[i - 1];
        const n2 = segNormals[i];
        const dot = n1.x * n2.x + n1.y * n2.y;

        // dot < 1 means there's an angle; dot < 0 means > 90 degree turn
        if (dot < 0.7) {
          // Sharp corner - limit the inner offset to prevent overlap
          // For very sharp corners, use a smaller offset
          const sharpness = Math.max(0.3, dot);
          innerOffset = half * Math.max(0.3, (sharpness + 0.3));
          // Outer can extend slightly more
          outerOffset = half * Math.min(1.5, 1 / Math.max(0.5, avgLen));
        }
      }

      normals.push({ x: nx, y: ny });
      inner.push({
        x: pt.x - nx * innerOffset,
        y: pt.y - ny * innerOffset,
        nx, ny
      });
      outer.push({
        x: pt.x + nx * outerOffset,
        y: pt.y + ny * outerOffset,
        nx, ny
      });
    }

    return { inner, outer, normals };
  }

  function computeCurvature(points) {
    const curv = new Array(points.length).fill(0);
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];
      const a = Math.atan2(curr.y - prev.y, curr.x - prev.x);
      const b = Math.atan2(next.y - curr.y, next.x - curr.x);
      let diff = b - a;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      curv[i] = diff;
    }
    curv[0] = curv[curv.length - 1];
    return curv;
  }

  /**
   * Ensure a path is closed (first and last points match).
   */
  function ensureClosedPath(points) {
    if (!points || points.length < 2) return points;
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.x - last.x) > 0.1 || Math.abs(first.y - last.y) > 0.1) {
      return [...points, { x: first.x, y: first.y }];
    }
    return points;
  }

  /**
   * Laplacian smoothing for wall paths to eliminate sharp corners.
   * Adapted from track_editor.js relaxPath().
   */
  function relaxWallPath(points, iterations = 1, strength = 0.5) {
    let pts = ensureClosedPath(points).map(p => ({ x: p.x, y: p.y, nx: p.nx, ny: p.ny }));
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
          y: curr.y + (midY - curr.y) * strength,
          nx: curr.nx,
          ny: curr.ny
        };
      }
      next[n - 1] = { ...next[0] };
      pts = next;
    }
    return pts;
  }

  /**
   * Calculate the signed curvature at a point given its neighbors.
   * Returns: curvature (1/radius).
   */
  function calcWallCurvature(prev, curr, next) {
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const cross = v1x * v2y - v1y * v2x;
    const dot = v1x * v2x + v1y * v2y;
    const len1 = Math.hypot(v1x, v1y) || 1;
    const len2 = Math.hypot(v2x, v2y) || 1;

    const angle = Math.atan2(cross, dot);
    const avgLen = (len1 + len2) / 2;

    return angle / avgLen;
  }

  /**
   * Enforce minimum turning radius by iteratively smoothing points
   * where curvature exceeds the limit. Prevents wall overlap at sharp corners.
   * Adapted from track_editor.js enforceMinimumRadius().
   */
  function enforceMinimumWallRadius(points, minRadius, maxIterations = 200) {
    let pts = ensureClosedPath(points).map(p => ({ x: p.x, y: p.y, nx: p.nx, ny: p.ny }));
    const n = pts.length;
    if (n < 4) return pts;

    const maxCurvature = 1 / minRadius;

    for (let iter = 0; iter < maxIterations; iter++) {
      let maxViolation = 0;
      const next = pts.map(p => ({ x: p.x, y: p.y, nx: p.nx, ny: p.ny }));

      for (let i = 0; i < n - 1; i++) {
        const prevIdx = (i - 1 + n - 1) % (n - 1);
        const nextIdx = (i + 1) % (n - 1);

        const prev = pts[prevIdx];
        const curr = pts[i];
        const nextPt = pts[nextIdx];

        const curvature = Math.abs(calcWallCurvature(prev, curr, nextPt));

        if (curvature > maxCurvature) {
          const violation = curvature / maxCurvature;
          maxViolation = Math.max(maxViolation, violation);

          // Aggressive blend - higher violations get moved almost all the way
          const blend = Math.min(0.95, 0.5 + 0.3 * violation);
          const midX = (prev.x + nextPt.x) / 2;
          const midY = (prev.y + nextPt.y) / 2;

          next[i] = {
            x: curr.x + (midX - curr.x) * blend,
            y: curr.y + (midY - curr.y) * blend,
            nx: curr.nx,
            ny: curr.ny
          };
        }
      }

      next[n - 1] = { ...next[0] };
      pts = next;

      if (maxViolation <= 1.0) break;
    }

    return pts;
  }

  /**
   * Smooth wall path to prevent overlap at sharp corners.
   * Walls need MORE aggressive smoothing than curbs because they're offset
   * further from the track, which amplifies corner sharpness.
   */
  function smoothWallPath(points, roadWidth) {
    if (!points || points.length < 4) return points;

    // Walls are offset by roadWidth * 0.6, so they need a much larger minimum
    // turning radius to avoid self-intersection at sharp corners
    const minTurnRadius = roadWidth * 1.2;

    // Stage 1: Heavy Laplacian relaxation to round out corners
    let smoothed = relaxWallPath(points, 50, 0.5);

    // Stage 2: Enforce minimum radius (run multiple times for very sharp corners)
    smoothed = enforceMinimumWallRadius(smoothed, minTurnRadius, 300);

    // Stage 3: Another round of relaxation after radius enforcement
    smoothed = relaxWallPath(smoothed, 30, 0.5);

    // Stage 4: Re-enforce minimum radius
    smoothed = enforceMinimumWallRadius(smoothed, minTurnRadius, 300);

    // Stage 5: Final smoothing pass
    smoothed = relaxWallPath(smoothed, 20, 0.3);

    // Stage 6: Remove self-intersecting portions (create V-shape instead of X-shape)
    smoothed = removeSelfIntersections(smoothed);

    return smoothed;
  }

  /**
   * Find intersection point of two line segments.
   * Returns { x, y, t, u } where t and u are the parametric positions on each segment.
   * Returns null if segments don't intersect.
   */
  function getSegmentIntersection(p1, p2, p3, p4) {
    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 0.0001) return null;

    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross;
    const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / cross;

    if (t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99) {
      return {
        x: p1.x + t * d1x,
        y: p1.y + t * d1y,
        t: t,
        u: u
      };
    }
    return null;
  }

  /**
   * Remove self-intersecting portions of a path.
   * When the path crosses itself at SHARP CORNERS, cut out the loop to create a V-shape.
   * Only removes SMALL loops - large loops (from parallel track sections) are preserved.
   */
  function removeSelfIntersections(points) {
    if (!points || points.length < 4) return points;

    let result = points.map(p => ({
      x: p.x,
      y: p.y,
      nx: p.nx,
      ny: p.ny,
      idx: p.idx,
      partnerIdx: p.partnerIdx,
      merged: p.merged
    }));
    let changed = true;
    let iterations = 0;
    const maxIterations = 100;

    // Maximum loop size to cut (as fraction of total path)
    // Larger loops are likely parallel section crossings, not sharp corners
    // Increased to 0.40 to handle very sharp hairpin corners
    // Changed from 0.40 to 0.80 for wall paths to handle large hairpin loops
    const maxLoopFraction = 0.80;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      const n = result.length;
      if (n < 4) break;

      // Maximum number of points to remove in one cut
      const maxLoopSize = Math.max(10, Math.floor(n * maxLoopFraction));

      // Check for self-intersections (only skip immediately adjacent segment)
      outerLoop:
      for (let i = 0; i < n - 1; i++) {
        const p1 = result[i];
        const p2 = result[i + 1];

        // Check against non-adjacent segments (skip only i and i+1)
        // Start from i+2 to catch sharp corner intersections
        for (let j = i + 2; j < n - 1; j++) {
          // Skip if j wraps around to be adjacent to i (for closed paths)
          if (i === 0 && j >= n - 2) continue;

          // Calculate how many points would be removed
          const loopSize = j - i - 1;

          // Only cut SMALL loops (sharp corner artifacts)
          // Large loops are likely from parallel track sections and should be preserved
          if (loopSize > maxLoopSize) continue;

          const p3 = result[j];
          const p4 = result[j + 1];

          const intersection = getSegmentIntersection(p1, p2, p3, p4);
          if (intersection) {
            // Found intersection with small loop - remove it to create V-shape
            // Keep points [0..i], add intersection point, then [j+1..end]
            const newResult = [];

            // Add points up to and including i
            for (let k = 0; k <= i; k++) {
              newResult.push(result[k]);
            }

            // Add the intersection point
            newResult.push({
              x: intersection.x,
              y: intersection.y,
              nx: p1.nx,
              ny: p1.ny,
              idx: p1.idx,
              partnerIdx: p1.partnerIdx,
              merged: p1.merged
            });

            // Add points from j+1 onwards
            for (let k = j + 1; k < n; k++) {
              newResult.push(result[k]);
            }

            result = newResult;
            changed = true;
            break outerLoop;
          }
        }
      }
    }

    return result;
  }

  function lerpPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  /**
   * Check if two line segments intersect (excluding endpoints)
   */
  function segmentsIntersect(p1, p2, p3, p4) {
    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 0.0001) return false;
    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross;
    const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / cross;
    return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
  }

  function paintKerbMetadata(edgePoints, curvature, params, side) {
    const stripes = [];
    const stripeLength = 18;
    const kerbWidth = Math.max(6, 0.14 * params.roadWidth * params.kerbWidthScale);
    let acc = 0;

    // First pass: collect all potential stripes
    const potentialStripes = [];
    for (let i = 0; i < edgePoints.length - 1; i++) {
      const a = edgePoints[i];
      const b = edgePoints[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);

      // Skip very short segments (can cause issues at sharp corners)
      if (segLen < 2) continue;

      // Check for "folded" segments at sharp corners (inner edge crossing itself)
      // by comparing direction with previous segment
      if (i > 0) {
        const prevA = edgePoints[i - 1];
        const prevDir = { x: a.x - prevA.x, y: a.y - prevA.y };
        const currDir = { x: b.x - a.x, y: b.y - a.y };
        const cross = prevDir.x * currDir.y - prevDir.y * currDir.x;
        const dot = prevDir.x * currDir.x + prevDir.y * currDir.y;

        // If the segment has reversed direction significantly, skip it
        // This happens when the inner edge folds back on itself at sharp corners
        if (dot < 0 && side === "inner") {
          continue;
        }
      }

      const segAngle = Math.atan2(b.y - a.y, b.x - a.x);
      let t = 0;
      while (t < segLen) {
        const next = Math.min(segLen, t + stripeLength);
        const mid = (t + next) * 0.5 / segLen;
        const p1 = lerpPoint(a, b, t / segLen);
        const p2 = lerpPoint(a, b, next / segLen);
        const curveBoost = 1 + Math.min(0.8, Math.abs(curvature[i]) * 2.2);
        potentialStripes.push({
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          angle: segAngle,
          width: kerbWidth * curveBoost,
          stripeIndex: ((acc / stripeLength) & 1) === 0 ? 0 : 1,
          side,
          segIdx: i,
        });
        t = next;
        acc += stripeLength;
      }
    }

    // Second pass: filter out stripes that would cause visual artifacts
    // Check for stripes from non-adjacent segments that intersect
    for (let i = 0; i < potentialStripes.length; i++) {
      const s1 = potentialStripes[i];
      let hasIntersection = false;

      // Check against nearby (but not adjacent) stripes
      for (let j = i + 3; j < Math.min(i + 20, potentialStripes.length); j++) {
        const s2 = potentialStripes[j];
        // Skip if from same or adjacent segments
        if (Math.abs(s1.segIdx - s2.segIdx) <= 2) continue;

        if (segmentsIntersect(
          { x: s1.x1, y: s1.y1 }, { x: s1.x2, y: s1.y2 },
          { x: s2.x1, y: s2.y1 }, { x: s2.x2, y: s2.y2 }
        )) {
          hasIntersection = true;
          break;
        }
      }

      if (!hasIntersection) {
        stripes.push(s1);
      }
    }

    return stripes;
  }

  function createKerbs(edges, curvature, params) {
    const meta = {
      inner: paintKerbMetadata(edges.inner, curvature, params, "inner"),
      outer: paintKerbMetadata(edges.outer, curvature, params, "outer"),
    };
    return meta;
  }

  function createBarriers(edges, curvature, params, rng, zones) {
    const width = zones.width;
    const height = zones.height;
    const offsetX = zones.offsetX || 0;
    const offsetY = zones.offsetY || 0;
    const worldMaxX = offsetX + width;
    const worldMaxY = offsetY + height;
    const posts = [];
    const outer = edges.outer;
    let lastPlaced = -BARRIER_SPACING;
    for (let i = 0; i < outer.length; i++) {
      const p = outer[i];
      const curv = Math.abs(curvature[i] || 0);
      const nearEdge =
        p.x < offsetX + 40 || p.x > worldMaxX - 40 || p.y < offsetY + 40 || p.y > worldMaxY - 40;
      if (curv > BARRIER_CURVATURE_THRESHOLD || nearEdge) {
        const dist = Math.hypot(p.x - outer[Math.max(0, lastPlaced)].x, p.y - outer[Math.max(0, lastPlaced)].y);
        if (i - lastPlaced < 2 || dist < BARRIER_SPACING) continue;
        posts.push({
          x: p.x,
          y: p.y,
          angle: Math.atan2(p.ny, p.nx),
          length: 18 + rng.range(0, 4),
        });
        lastPlaced = i;
      }
    }
    return posts;
  }

  function noise2D(x, y, seed) {
    const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 0.001) * 43758.5453;
    return (s - Math.floor(s));
  }

  function isPointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function sampleTrees(zones, rng, params, stadiums) {
    const { width, height, greenMask, offsetX = 0, offsetY = 0 } = zones;
    const minSpacing = TREE_MIN_SPACING;
    const target = Math.min(
      Math.floor((width * height) / 2800 * params.treeDensity),
      900
    );
    const accepted = [];
    const minSpacingSq = Math.pow(minSpacing, 2);
    const maxAttempts = target * 20;
    let attempts = 0;
    while (accepted.length < target && attempts < maxAttempts) {
      const x = rng.int(width);
      const y = rng.int(height);
      const idx = y * width + x;
      if (!greenMask[idx]) {
        attempts++;
        continue;
      }
      const worldX = x + offsetX;
      const worldY = y + offsetY;

      // Check against stadiums
      if (stadiums && stadiums.length > 0) {
        let insideStadium = false;
        for (const s of stadiums) {
          if (s.points && s.points.length >= 3) {
            // Simple optimization: check bounding box first?
            // Since we don't have BBoxes precalculated here, we skip it for simplicity
            // unless performance is still bad (unlikely for <1000 trees vs ~10 stadiums).
            if (isPointInPolygon(worldX, worldY, s.points)) {
              insideStadium = true;
              break;
            }
          }
        }
        if (insideStadium) {
          attempts++;
          continue;
        }
      }

      const n = noise2D(worldX * 0.035, worldY * 0.035, zones.seed || 1);
      if (n < 0.22) {
        attempts++;
        continue;
      }
      let tooClose = false;
      for (let j = 0; j < accepted.length; j++) {
        const t = accepted[j];
        const dx = t.x - worldX;
        const dy = t.y - worldY;
        if (dx * dx + dy * dy < minSpacingSq) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) {
        attempts++;
        continue;
      }
      accepted.push({
        x: worldX,
        y: worldY,
        radius: rng.range(16, 28),
        variant: rng.int(4),
      });
      attempts++;
    }
    return accepted;
  }


  function pointInsideMask(mask, width, height, x, y, offsetX = 0, offsetY = 0) {
    const ix = Math.round(x - offsetX);
    const iy = Math.round(y - offsetY);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return false;
    return mask[iy * width + ix] === 1;
  }

  function createBuildings(edges, zones, rng, params) {
    const { width, height, bufferMask, greenMask, offsetX = 0, offsetY = 0 } = zones;
    const worldMaxX = offsetX + width;
    const worldMaxY = offsetY + height;
    const outer = edges.outer;
    const points = [];
    const spacing = Math.max(80, BUILDING_SPACING * (1.2 - params.buildingDensity * 0.6));
    let acc = 0;
    const taken = [];
    for (let i = 0; i < outer.length - 1; i++) {
      const a = outer[i];
      const b = outer[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      acc += segLen;
      if (acc < spacing) continue;
      acc = 0;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const normal = { x: Math.cos(angle + Math.PI / 2), y: Math.sin(angle + Math.PI / 2) };
      const widthRange = rng.range(60, 120);
      const depthRange = rng.range(40, 80);
      const center = {
        x: (a.x + b.x) * 0.5 + normal.x * (depthRange * 0.6 + params.roadWidth),
        y: (a.y + b.y) * 0.5 + normal.y * (depthRange * 0.6 + params.roadWidth),
      };
      const footprint = [
        { x: center.x + Math.cos(angle) * widthRange * 0.5 + normal.x * depthRange * 0.5, y: center.y + Math.sin(angle) * widthRange * 0.5 + normal.y * depthRange * 0.5 },
        { x: center.x - Math.cos(angle) * widthRange * 0.5 + normal.x * depthRange * 0.5, y: center.y - Math.sin(angle) * widthRange * 0.5 + normal.y * depthRange * 0.5 },
        { x: center.x - Math.cos(angle) * widthRange * 0.5 - normal.x * depthRange * 0.5, y: center.y - Math.sin(angle) * widthRange * 0.5 - normal.y * depthRange * 0.5 },
        { x: center.x + Math.cos(angle) * widthRange * 0.5 - normal.x * depthRange * 0.5, y: center.y + Math.sin(angle) * widthRange * 0.5 - normal.y * depthRange * 0.5 },
      ];
      let rejected = false;
      for (let k = 0; k < footprint.length; k++) {
        const pt = footprint[k];
        const ix = Math.round(pt.x - offsetX);
        const iy = Math.round(pt.y - offsetY);
        if (ix < 0 || iy < 0 || ix >= width || iy >= height) {
          rejected = true;
          break;
        }
        if (bufferMask[iy * width + ix]) {
          rejected = true;
          break;
        }
        if (!greenMask[iy * width + ix]) {
          rejected = true;
          break;
        }
      }
      if (rejected) continue;
      // overlap check
      const bb = {
        minX: Math.min(footprint[0].x, footprint[1].x, footprint[2].x, footprint[3].x),
        maxX: Math.max(footprint[0].x, footprint[1].x, footprint[2].x, footprint[3].x),
        minY: Math.min(footprint[0].y, footprint[1].y, footprint[2].y, footprint[3].y),
        maxY: Math.max(footprint[0].y, footprint[1].y, footprint[2].y, footprint[3].y),
      };
      let overlaps = false;
      for (const other of taken) {
        if (
          bb.minX < other.maxX &&
          bb.maxX > other.minX &&
          bb.minY < other.maxY &&
          bb.maxY > other.minY
        ) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      taken.push(bb);
      points.push({
        x: center.x,
        y: center.y,
        width: widthRange,
        depth: depthRange,
        angle,
      });
    }
    return points;
  }

  function createStadiums(wallData, zones, rng, params) {
    const { width, height, greenMask, offsetX = 0, offsetY = 0 } = zones;
    const stadiums = [];
    const minStadiumDepth = 22; // Minimum depth to be considered for a stadium
    const maxStadiumDepth = 300; // Cap depth
    const minStadiumLength = 24; // Minimum length of wall to form a stadium
    const rawDensity = Number(params && params.buildingDensity);
    const stadiumDensity = Number.isFinite(rawDensity) ? Math.max(0, Math.min(1, rawDensity)) : 0.4;
    const deepMaskGapPoints = stadiumDensity < 0.35 ? 2 : (stadiumDensity < 0.75 ? 1 : 0);
    const targetStadiumLength = 3000 - stadiumDensity * 2200;
    const minChunkLength = Math.max(minStadiumLength, 260 - stadiumDensity * 180);

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    // Helper to check depth at a point with a given normal.
    function checkDepth(x, y, nx, ny) {
      const step = 20;
      let depth = 0;
      for (let d = 20; d < maxStadiumDepth; d += step) {
        const tx = x + nx * d;
        const ty = y + ny * d;

        const ix = Math.round(tx - offsetX);
        const iy = Math.round(ty - offsetY);

        if (ix < 0 || iy < 0 || ix >= width || iy >= height) return d;

        if (!greenMask[iy * width + ix]) {
          return d;
        }

        depth = d;
      }
      return depth;
    }

    function isFinitePoint(point) {
      return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
    }

    function pointDistance(a, b) {
      if (!isFinitePoint(a) || !isFinitePoint(b)) return Number.POSITIVE_INFINITY;
      return Math.hypot(b.x - a.x, b.y - a.y);
    }

    function getStableNormal(points, index) {
      const point = points[index] || {};
      let nx = point.nx;
      let ny = point.ny;

      if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
        const prev = points[Math.max(0, index - 1)] || point;
        const next = points[Math.min(points.length - 1, index + 1)] || point;
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        nx = -dy / len;
        ny = dx / len;
      }

      const len = Math.hypot(nx, ny) || 1;
      return { x: nx / len, y: ny / len };
    }

    function dedupeConsecutivePoints(points, epsilon = 0.5, dropClosingDuplicate = false) {
      if (!Array.isArray(points) || points.length === 0) return [];
      const out = [];
      for (const point of points) {
        if (!isFinitePoint(point)) continue;
        if (out.length === 0 || pointDistance(out[out.length - 1], point) > epsilon) {
          out.push({ x: point.x, y: point.y });
        }
      }
      if (dropClosingDuplicate && out.length > 2 && pointDistance(out[0], out[out.length - 1]) <= epsilon) {
        out.pop();
      }
      return out;
    }

    function dedupeConsecutiveSamples(samples, epsilon = 0.5) {
      if (!Array.isArray(samples) || samples.length === 0) return [];
      const out = [];
      for (const sample of samples) {
        if (!sample || !Number.isFinite(sample.outerX) || !Number.isFinite(sample.outerY)) continue;
        if (out.length === 0) {
          out.push(sample);
          continue;
        }
        const prev = out[out.length - 1];
        const dist = Math.hypot(sample.outerX - prev.outerX, sample.outerY - prev.outerY);
        if (dist > epsilon) {
          out.push(sample);
        }
      }
      return out;
    }

    function medianWindow5(values) {
      if (!Array.isArray(values) || values.length === 0) return [];
      if (values.length <= 2) return values.slice();
      const out = new Array(values.length);
      for (let i = 0; i < values.length; i++) {
        const window = [];
        for (let j = i - 2; j <= i + 2; j++) {
          const idx = clamp(j, 0, values.length - 1);
          window.push(values[idx]);
        }
        window.sort((a, b) => a - b);
        out[i] = window[Math.floor(window.length / 2)];
      }
      return out;
    }

    function boxWindow3(values) {
      if (!Array.isArray(values) || values.length === 0) return [];
      if (values.length <= 2) return values.slice();
      const out = new Array(values.length);
      for (let i = 0; i < values.length; i++) {
        const a = values[clamp(i - 1, 0, values.length - 1)];
        const b = values[i];
        const c = values[clamp(i + 1, 0, values.length - 1)];
        out[i] = (a + b + c) / 3;
      }
      return out;
    }

    function clampDepthDeltas(values, maxDelta = 35) {
      const out = values.slice();
      if (out.length <= 1) return out;

      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < out.length; i++) {
          const hi = out[i - 1] + maxDelta;
          const lo = out[i - 1] - maxDelta;
          if (out[i] > hi) out[i] = hi;
          if (out[i] < lo) out[i] = lo;
        }
        for (let i = out.length - 2; i >= 0; i--) {
          const hi = out[i + 1] + maxDelta;
          const lo = out[i + 1] - maxDelta;
          if (out[i] > hi) out[i] = hi;
          if (out[i] < lo) out[i] = lo;
        }
      }

      return out;
    }

    function smoothDepthProfile(depths) {
      if (!Array.isArray(depths) || depths.length === 0) return [];
      const median = medianWindow5(depths);
      const boxed = boxWindow3(median);
      return clampDepthDeltas(boxed, 35);
    }

    function medianValue(values) {
      if (!Array.isArray(values) || values.length === 0) return 0;
      const sorted = values.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      if ((sorted.length % 2) === 0) {
        return (sorted[mid - 1] + sorted[mid]) * 0.5;
      }
      return sorted[mid];
    }

    function buildClosedDeepMask(depths, minDepth, maxGapPoints = 2) {
      const mask = depths.map((depth) => depth >= minDepth);
      if (mask.length <= 2 || maxGapPoints <= 0) return mask;

      let i = 0;
      while (i < mask.length) {
        if (mask[i]) {
          i++;
          continue;
        }
        let j = i;
        while (j < mask.length && !mask[j]) {
          j++;
        }
        const gapLen = j - i;
        const left = i - 1;
        const right = j;
        if (gapLen <= maxGapPoints && left >= 0 && right < mask.length && mask[left] && mask[right]) {
          for (let k = i; k < j; k++) {
            mask[k] = true;
          }
        }
        i = j;
      }

      return mask;
    }

    function splitRunByLength(startIdx, endIdx, cumulativeLengths, targetLength, minLength) {
      if (!Number.isFinite(startIdx) || !Number.isFinite(endIdx) || endIdx <= startIdx) {
        return [];
      }
      const chunks = [];
      let cursor = startIdx;

      while (cursor < endIdx) {
        let chunkEnd = endIdx;
        if (Number.isFinite(targetLength) && targetLength > 0) {
          const targetDistance = cumulativeLengths[cursor] + targetLength;
          let probe = cursor + 1;
          while (probe < endIdx && cumulativeLengths[probe] < targetDistance) {
            probe++;
          }
          chunkEnd = Math.min(endIdx, Math.max(cursor + 1, probe));
        }

        const remainingLength = cumulativeLengths[endIdx] - cumulativeLengths[chunkEnd];
        if (remainingLength > 0 && remainingLength < minLength && chunkEnd < endIdx) {
          chunkEnd = endIdx;
        }

        const chunkLength = cumulativeLengths[chunkEnd] - cumulativeLengths[cursor];
        if (chunkLength < minLength && chunks.length > 0) {
          const prev = chunks[chunks.length - 1];
          prev.endIdx = chunkEnd;
          prev.length = cumulativeLengths[chunkEnd] - cumulativeLengths[prev.startIdx];
        } else {
          chunks.push({ startIdx: cursor, endIdx: chunkEnd, length: chunkLength });
        }

        if (chunkEnd >= endIdx) break;
        cursor = chunkEnd;
      }

      if (chunks.length === 0) {
        chunks.push({
          startIdx,
          endIdx,
          length: cumulativeLengths[endIdx] - cumulativeLengths[startIdx],
        });
      }

      return chunks.filter((chunk) => chunk.length >= minStadiumLength);
    }

    function subdivideLongSegments(points, maxLen) {
      if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(maxLen) || maxLen <= 0) {
        return Array.isArray(points) ? points.slice() : [];
      }
      const out = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const prev = out[out.length - 1];
        const curr = points[i];
        const len = pointDistance(prev, curr);
        if (!Number.isFinite(len) || len <= maxLen) {
          out.push(curr);
          continue;
        }
        const steps = Math.max(1, Math.ceil(len / maxLen));
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          out.push({
            x: prev.x + (curr.x - prev.x) * t,
            y: prev.y + (curr.y - prev.y) * t,
          });
        }
      }
      return out;
    }

    function vertexAngleDegrees(prev, curr, next) {
      const ux = prev.x - curr.x;
      const uy = prev.y - curr.y;
      const vx = next.x - curr.x;
      const vy = next.y - curr.y;
      const ul = Math.hypot(ux, uy) || 1;
      const vl = Math.hypot(vx, vy) || 1;
      const dot = clamp((ux * vx + uy * vy) / (ul * vl), -1, 1);
      return Math.acos(dot) * 180 / Math.PI;
    }

    function sanitizeOuterSamples(samples, maxPasses = 8) {
      let working = dedupeConsecutiveSamples(samples, 0.5);
      if (working.length < 3) return working;

      for (let pass = 0; pass < maxPasses; pass++) {
        const flagged = new Set();

        for (let i = 0; i < working.length - 1; i++) {
          const a = working[i];
          const b = working[i + 1];
          const outerLen = Math.hypot(b.outerX - a.outerX, b.outerY - a.outerY);
          const innerLen = Math.hypot(b.innerX - a.innerX, b.innerY - a.innerY);
          if (outerLen > Math.max(220, 3 * innerLen + 40)) {
            const idx = Math.min(i + 1, working.length - 2);
            if (idx > 0 && idx < working.length - 1) {
              flagged.add(idx);
            }
          }
        }

        for (let i = 1; i < working.length - 1; i++) {
          const prev = working[i - 1];
          const curr = working[i];
          const next = working[i + 1];
          const prevLen = Math.hypot(curr.outerX - prev.outerX, curr.outerY - prev.outerY);
          const nextLen = Math.hypot(next.outerX - curr.outerX, next.outerY - curr.outerY);
          if (prevLen <= 120 || nextLen <= 120) continue;

          const angle = vertexAngleDegrees(
            { x: prev.outerX, y: prev.outerY },
            { x: curr.outerX, y: curr.outerY },
            { x: next.outerX, y: next.outerY },
          );
          if (angle < 8) {
            flagged.add(i);
          }
        }

        if (flagged.size === 0) break;

        const orderedFlags = Array.from(flagged).sort((a, b) => a - b);
        for (const idx of orderedFlags) {
          if (idx <= 0 || idx >= working.length - 1) continue;
          const prev = working[idx - 1];
          const curr = working[idx];
          const next = working[idx + 1];
          const midpointX = (prev.outerX + next.outerX) * 0.5;
          const midpointY = (prev.outerY + next.outerY) * 0.5;
          const projectedDepth = (midpointX - curr.innerX) * curr.nx + (midpointY - curr.innerY) * curr.ny;
          const maxDepthForPoint = Number.isFinite(curr.maxDepth) ? curr.maxDepth : (maxStadiumDepth - 10);
          const minDepthForPoint = Number.isFinite(curr.minDepth) ? curr.minDepth : minStadiumDepth;
          const targetDepth = clamp((projectedDepth + curr.depth) * 0.5, minDepthForPoint, maxDepthForPoint);
          working[idx] = {
            ...curr,
            depth: targetDepth,
            outerX: curr.innerX + curr.nx * targetDepth,
            outerY: curr.innerY + curr.ny * targetDepth,
          };
        }

        working = dedupeConsecutiveSamples(working, 0.5);
        if (working.length < 3) break;
      }

      return dedupeConsecutiveSamples(working, 0.5);
    }

    function getStrictSegmentIntersection(p1, p2, p3, p4) {
      const d1x = p2.x - p1.x;
      const d1y = p2.y - p1.y;
      const d2x = p4.x - p3.x;
      const d2y = p4.y - p3.y;
      const cross = d1x * d2y - d1y * d2x;
      if (Math.abs(cross) < 0.000001) return null;

      const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross;
      const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / cross;
      if (t > 0.0001 && t < 0.9999 && u > 0.0001 && u < 0.9999) {
        return { x: p1.x + t * d1x, y: p1.y + t * d1y };
      }
      return null;
    }

    function removeSelfIntersectionsPolyline(points, closed = false, maxIterations = 100) {
      if (!Array.isArray(points) || points.length < 4) {
        return dedupeConsecutivePoints(points || [], 0.5, closed);
      }

      let working = points.map((point) => ({ x: point.x, y: point.y }));
      if (closed) {
        working.push({ x: working[0].x, y: working[0].y });
      }

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        let changed = false;
        const n = working.length;

        outerLoop:
        for (let i = 0; i < n - 1; i++) {
          const a = working[i];
          const b = working[i + 1];
          for (let j = i + 2; j < n - 1; j++) {
            if (closed && i === 0 && j === n - 2) continue;
            const c = working[j];
            const d = working[j + 1];
            const hit = getStrictSegmentIntersection(a, b, c, d);
            if (!hit) continue;

            working = [
              ...working.slice(0, i + 1),
              { x: hit.x, y: hit.y },
              ...working.slice(j + 1),
            ];
            changed = true;
            break outerLoop;
          }
        }

        if (!changed) break;
      }

      if (closed && working.length > 1) {
        working.pop();
      }

      return dedupeConsecutivePoints(working, 0.5, closed);
    }

    function hasSelfIntersections(points, closed = true) {
      if (!Array.isArray(points) || points.length < 4) return false;
      const n = points.length;

      if (closed) {
        for (let i = 0; i < n; i++) {
          const a1 = points[i];
          const a2 = points[(i + 1) % n];
          for (let j = i + 1; j < n; j++) {
            const b1 = points[j];
            const b2 = points[(j + 1) % n];
            if (i === j) continue;
            if (((i + 1) % n) === j) continue;
            if (((j + 1) % n) === i) continue;
            if (getStrictSegmentIntersection(a1, a2, b1, b2)) return true;
          }
        }
        return false;
      }

      for (let i = 0; i < n - 1; i++) {
        const a1 = points[i];
        const a2 = points[i + 1];
        for (let j = i + 2; j < n - 1; j++) {
          const b1 = points[j];
          const b2 = points[j + 1];
          if (getStrictSegmentIntersection(a1, a2, b1, b2)) return true;
        }
      }
      return false;
    }

    function isValidPolygon(points) {
      return Array.isArray(points) && points.length >= 6 && !hasSelfIntersections(points, true);
    }

    function polygonStartsWithInner(polygon, innerPoints, epsilon = 1.5) {
      if (!Array.isArray(polygon) || !Array.isArray(innerPoints)) return false;
      if (polygon.length < innerPoints.length) return false;
      for (let i = 0; i < innerPoints.length; i++) {
        if (pointDistance(polygon[i], innerPoints[i]) > epsilon) {
          return false;
        }
      }
      return true;
    }

    function alignOuterPathToInnerEndpoints(points, expectedStart, expectedEnd) {
      if (!Array.isArray(points) || points.length === 0) return [];
      if (!isFinitePoint(expectedStart) || !isFinitePoint(expectedEnd)) {
        return dedupeConsecutivePoints(points, 0.5, false);
      }

      let aligned = dedupeConsecutivePoints(points, 0.5, false);
      if (aligned.length === 0) return aligned;

      const forwardScore =
        pointDistance(aligned[0], expectedStart) +
        pointDistance(aligned[aligned.length - 1], expectedEnd);
      const reversed = aligned.slice().reverse();
      const reversedScore =
        pointDistance(reversed[0], expectedStart) +
        pointDistance(reversed[reversed.length - 1], expectedEnd);

      if (reversedScore + 1 < forwardScore) {
        aligned = reversed;
      }

      if (pointDistance(aligned[0], expectedStart) > 1) {
        aligned.unshift({ x: expectedStart.x, y: expectedStart.y });
      }
      if (pointDistance(aligned[aligned.length - 1], expectedEnd) > 1) {
        aligned.push({ x: expectedEnd.x, y: expectedEnd.y });
      }

      return dedupeConsecutivePoints(aligned, 0.5, false);
    }

    const segmentsToCheck = [
      ...(wallData.outerSegments || []),
      ...(wallData.innerSegments || []),
    ];

    for (const segment of segmentsToCheck) {
      if (!segment.points || segment.points.length < 5) continue;

      const pts = segment.points;
      const pointDepths = new Array(pts.length).fill(0);
      const pointDepthsForward = new Array(pts.length).fill(0);
      const pointDepthsBackward = new Array(pts.length).fill(0);
      const cumulativeLengths = new Array(pts.length).fill(0);

      for (let i = 1; i < pts.length; i++) {
        cumulativeLengths[i] = cumulativeLengths[i - 1] + pointDistance(pts[i - 1], pts[i]);
      }

      for (let i = 0; i < pts.length; i++) {
        const normal = getStableNormal(pts, i);
        const forwardDepth = checkDepth(pts[i].x, pts[i].y, normal.x, normal.y);
        const backwardDepth = checkDepth(pts[i].x, pts[i].y, -normal.x, -normal.y);
        pointDepthsForward[i] = forwardDepth;
        pointDepthsBackward[i] = backwardDepth;
        pointDepths[i] = Math.max(forwardDepth, backwardDepth);
      }
      const deepMask = buildClosedDeepMask(pointDepths, minStadiumDepth, deepMaskGapPoints);

      let startIdx = -1;
      for (let i = 0; i < pts.length; i++) {
        const isDeepEnough = !!deepMask[i];

        if (isDeepEnough && startIdx === -1) {
          startIdx = i;
        } else if ((!isDeepEnough || i === pts.length - 1) && startIdx !== -1) {
          const endIdx = isDeepEnough ? i : i - 1;
          const runLength = cumulativeLengths[endIdx] - cumulativeLengths[startIdx];

          if (runLength > minStadiumLength) {
            const runChunks = splitRunByLength(
              startIdx,
              endIdx,
              cumulativeLengths,
              targetStadiumLength,
              minChunkLength,
            );
            for (const runChunk of runChunks) {
              const chunkStartIdx = runChunk.startIdx;
              const chunkEndIdx = runChunk.endIdx;
              const innerPath = [];
              const outerSamples = [];
              let previousOutward = null;

              for (let k = chunkStartIdx; k <= chunkEndIdx; k += 2) {
                const point = pts[k];
                innerPath.push({ x: point.x, y: point.y });

                const normal = getStableNormal(pts, k);
                const forwardDepth = pointDepthsForward[k];
                const backwardDepth = pointDepthsBackward[k];

                let useBackward = backwardDepth > forwardDepth;
                let outward = useBackward
                  ? { x: -normal.x, y: -normal.y }
                  : { x: normal.x, y: normal.y };
                let chosenDepth = useBackward ? backwardDepth : forwardDepth;
                const alternativeDepth = useBackward ? forwardDepth : backwardDepth;

                if (previousOutward) {
                  const continuityDot = outward.x * previousOutward.x + outward.y * previousOutward.y;
                  if (continuityDot < -0.05 &&
                    alternativeDepth >= (minStadiumDepth + 10) &&
                    Math.abs(chosenDepth - alternativeDepth) <= 28) {
                    useBackward = !useBackward;
                    outward = { x: -outward.x, y: -outward.y };
                    chosenDepth = alternativeDepth;
                  }
                }
                previousOutward = outward;

                const minDepthForPoint = 10;
                const maxDepthForPoint = clamp(Math.max(10, chosenDepth - 10), minDepthForPoint, maxStadiumDepth - 10);
                const depth = maxDepthForPoint;

                outerSamples.push({
                  innerX: point.x,
                  innerY: point.y,
                  nx: outward.x,
                  ny: outward.y,
                  depth,
                  minDepth: minDepthForPoint,
                  maxDepth: maxDepthForPoint,
                  outerX: point.x + outward.x * depth,
                  outerY: point.y + outward.y * depth,
                });
              }

            if (innerPath.length >= 2 && outerSamples.length >= 2) {
              const smoothed = smoothDepthProfile(outerSamples.map((sample) => sample.depth));
              for (let depthIndex = 0; depthIndex < outerSamples.length; depthIndex++) {
                const sample = outerSamples[depthIndex];
                const minDepthForPoint = Number.isFinite(sample.minDepth)
                  ? sample.minDepth
                  : minStadiumDepth;
                const maxDepthForPoint = Number.isFinite(sample.maxDepth)
                  ? sample.maxDepth
                  : (maxStadiumDepth - 10);
                const depth = clamp(smoothed[depthIndex], minDepthForPoint, maxDepthForPoint);
                sample.depth = depth;
                sample.outerX = sample.innerX + sample.nx * depth;
                sample.outerY = sample.innerY + sample.ny * depth;
              }

              let sanitizedSamples = sanitizeOuterSamples(outerSamples, 8);
              if (sanitizedSamples.length < 2) {
                sanitizedSamples = outerSamples.slice();
              }

              if (sanitizedSamples.length >= 2 && outerSamples.length >= 2) {
                sanitizedSamples[0] = { ...sanitizedSamples[0], ...outerSamples[0] };
                sanitizedSamples[sanitizedSamples.length - 1] = {
                  ...sanitizedSamples[sanitizedSamples.length - 1],
                  ...outerSamples[outerSamples.length - 1],
                };
              }
              sanitizedSamples = dedupeConsecutiveSamples(sanitizedSamples, 0.5);

              const innerSegLens = [];
              for (let idx = 1; idx < innerPath.length; idx++) {
                innerSegLens.push(pointDistance(innerPath[idx - 1], innerPath[idx]));
              }
              const medianInnerSegLen = Math.max(1, medianValue(innerSegLens));
              const maxOuterSegLen = Math.max(240, 3.2 * medianInnerSegLen);

              let outerPath = dedupeConsecutivePoints(
                subdivideLongSegments(sanitizedSamples.map((sample) => ({ x: sample.outerX, y: sample.outerY })), maxOuterSegLen),
                0.5,
                false,
              );
              let fallbackOuterPath = dedupeConsecutivePoints(
                subdivideLongSegments(outerSamples.map((sample) => ({ x: sample.outerX, y: sample.outerY })), maxOuterSegLen),
                0.5,
                false,
              );
              const expectedOuterStart = {
                x: outerSamples[0].outerX,
                y: outerSamples[0].outerY,
              };
              const expectedOuterEnd = {
                x: outerSamples[outerSamples.length - 1].outerX,
                y: outerSamples[outerSamples.length - 1].outerY,
              };

              if (outerPath.length < 2) {
                outerPath = fallbackOuterPath.slice();
              }

              const cleanedOuterPath = removeSelfIntersectionsPolyline(outerPath, false, 100);
              if (cleanedOuterPath.length >= 2) {
                outerPath = cleanedOuterPath;
              }
              const cleanedFallbackOuterPath = removeSelfIntersectionsPolyline(fallbackOuterPath, false, 100);
              if (cleanedFallbackOuterPath.length >= 2) {
                fallbackOuterPath = cleanedFallbackOuterPath;
              }

              outerPath = alignOuterPathToInnerEndpoints(outerPath, expectedOuterStart, expectedOuterEnd);
              fallbackOuterPath = alignOuterPathToInnerEndpoints(fallbackOuterPath, expectedOuterStart, expectedOuterEnd);

              const conservativeOuterPath = dedupeConsecutivePoints(
                subdivideLongSegments(
                  outerSamples.map((sample) => ({
                    x: sample.innerX + sample.nx * (minStadiumDepth + 20),
                    y: sample.innerY + sample.ny * (minStadiumDepth + 20),
                  })),
                  maxOuterSegLen,
                ),
                0.5,
                false,
              );
              const alignedConservativeOuterPath = alignOuterPathToInnerEndpoints(
                conservativeOuterPath,
                expectedOuterStart,
                expectedOuterEnd,
              );

              const candidatePolygons = [];
              function pushCandidate(outerCandidate) {
                if (!Array.isArray(outerCandidate) || outerCandidate.length < 2) return;
                const raw = dedupeConsecutivePoints([
                  ...innerPath,
                  ...outerCandidate.slice().reverse(),
                ], 0.5, true);
                if (raw.length >= 3) {
                  candidatePolygons.push(raw);
                }
                const cleaned = removeSelfIntersectionsPolyline(raw, true, 100);
                if (cleaned.length >= 3) {
                  candidatePolygons.push(cleaned);
                }
              }

              pushCandidate(outerPath);
              pushCandidate(fallbackOuterPath);
              pushCandidate(alignedConservativeOuterPath);

              let finalPolygon = null;
              let lastValid = null;

              for (const candidate of candidatePolygons) {
                const normalized = dedupeConsecutivePoints(candidate, 0.5, true);
                if (isValidPolygon(normalized)) {
                  if (!finalPolygon) finalPolygon = normalized;
                  lastValid = normalized;
                }
              }

              if (!finalPolygon && lastValid) {
                finalPolygon = lastValid;
              }

              if (!finalPolygon) {
                const emergencyStrip = dedupeConsecutivePoints([
                  ...innerPath,
                  ...alignedConservativeOuterPath.slice().reverse(),
                ], 0.5, true);
                const cleanedEmergencyStrip = removeSelfIntersectionsPolyline(emergencyStrip, true, 100);
                if (cleanedEmergencyStrip.length >= 3) {
                  finalPolygon = cleanedEmergencyStrip;
                }
              }

              if (!finalPolygon || finalPolygon.length < 3) {
                finalPolygon = dedupeConsecutivePoints([
                  ...innerPath,
                  ...fallbackOuterPath.slice().reverse(),
                ], 0.5, true);
              }

              if (finalPolygon && finalPolygon.length >= 3) {
                const cleaned = removeSelfIntersectionsPolyline(finalPolygon, true, 100);
                if (cleaned.length >= 3) {
                  finalPolygon = cleaned;
                }
              }

              if (!finalPolygon || finalPolygon.length < 3) {
                const midpoint = outerSamples[Math.floor(outerSamples.length * 0.5)] || outerSamples[0];
                if (midpoint) {
                  finalPolygon = dedupeConsecutivePoints([
                    { x: innerPath[0].x, y: innerPath[0].y },
                    { x: midpoint.outerX, y: midpoint.outerY },
                    { x: innerPath[innerPath.length - 1].x, y: innerPath[innerPath.length - 1].y },
                  ], 0.5, true);
                }
              }

              if (!finalPolygon || finalPolygon.length < 3) {
                finalPolygon = innerPath.slice(0, 3).map((point) => ({ x: point.x, y: point.y }));
              }
              if (hasSelfIntersections(finalPolygon, true)) {
                finalPolygon = dedupeConsecutivePoints([
                  { x: innerPath[0].x, y: innerPath[0].y },
                  { x: expectedOuterStart.x, y: expectedOuterStart.y },
                  { x: expectedOuterEnd.x, y: expectedOuterEnd.y },
                  { x: innerPath[innerPath.length - 1].x, y: innerPath[innerPath.length - 1].y },
                ], 0.5, true);
              }

              let exportedOuterPoints = null;
              if (polygonStartsWithInner(finalPolygon, innerPath) && finalPolygon.length > innerPath.length + 1) {
                exportedOuterPoints = dedupeConsecutivePoints(
                  subdivideLongSegments(finalPolygon.slice(innerPath.length).reverse(), maxOuterSegLen),
                  0.5,
                  false,
                );
              }
              if (!exportedOuterPoints || exportedOuterPoints.length < 2) {
                exportedOuterPoints = outerPath.slice();
              }

              const stadium = {
                points: finalPolygon,
                innerPoints: innerPath,
                type: 'stadium',
              };
              if (exportedOuterPoints && exportedOuterPoints.length >= 2) {
                stadium.outerPoints = exportedOuterPoints;
              }
              stadiums.push(stadium);
            }
          }
          }

          startIdx = -1;
        }
      }
    }

    return stadiums;
  }
  /**
   * Build a continuous wall path from a track edge.
   * Returns an array of points that form the wall centerline.
   * When parallel track sections are close, walls merge smoothly.
   * NEVER skips points - every track edge point gets a wall position.
   * @param {Array} edge - The edge points (either outer or inner edge)
   * @param {number} roadWidth - The road width for calculating offsets
   * @param {number} offsetDirection - 1 for outward (outer edge), -1 for inward (inner edge)
   */
  function buildWallPath(edge, roadWidth, offsetDirection = 1) {
    if (!edge || edge.length < 3) return [];

    const wallOffset = roadWidth * 0.6 * offsetDirection;
    // Fix for sharp corners: Use a small constant gap instead of a percentage.
    // This allows walls on the "return" side of a hairpin to be considered for merging,
    // even if they are relatively close in index (e.g. very tight turns).
    const minIndexGap = 2; // Reduced from 15 to catch even tighter loops
    const mergeThreshold = Math.abs(wallOffset) * 2.2;

    // Pass 1: Compute default wall positions and normals for all points
    const wallPoints = [];
    for (let i = 0; i < edge.length; i++) {
      const pt = edge[i];
      let nx = pt.nx;
      let ny = pt.ny;

      // Recompute normal if missing or for consistency
      const prev = edge[(i - 1 + edge.length) % edge.length];
      const next = edge[(i + 1) % edge.length];

      if (nx === undefined || ny === undefined) {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        nx = -dy / len;
        ny = dx / len;
      }

      // Calculate local curvature to detect sharp corners
      // Vector from prev to curr
      const v1x = pt.x - prev.x;
      const v1y = pt.y - prev.y;
      // Vector from curr to next
      const v2x = next.x - pt.x;
      const v2y = next.y - pt.y;

      // Cross product to determine turn direction (Left > 0, Right < 0)
      const cross = v1x * v2y - v1y * v2x; // z-component of cross product
      const turnDir = cross > 0 ? 1 : -1; // 1 = Left, -1 = Right

      // Calculate angle of turn (approximate curvature)
      const dot = v1x * v2x + v1y * v2y;
      const l1 = Math.hypot(v1x, v1y) || 1;
      const l2 = Math.hypot(v2x, v2y) || 1;
      // Cosine of angle change. close to 1 = straight, close to -1 = u-turn
      const cosTheta = dot / (l1 * l2);

      // Effective radius of curvature approx = segment_len / angle
      // For sharp turns, we want to clamp the offset to be less than the radius

      let effectiveOffset = wallOffset;

      // Check if we are offsetting INTO the turn
      // offsetDirection: 1 (Left/Outer), -1 (Right/Inner)
      // If Turn Left (turnDir 1) and Offset Left (offsetDirection 1) -> DANGER
      // If Turn Right (turnDir -1) and Offset Right (offsetDirection -1) -> DANGER

      // Note: checking sign match is sufficient
      // However, wallOffset already includes offsetDirection sign? 
      // No, wallOffset is calculated as `roadWidth * 0.6 * offsetDirection`
      // So wallOffset is Positive for Left, Negative for Right.

      // If (Turn Left AND WallOffset Positive) OR (Turn Right AND WallOffset Negative)
      // This is equivalent to: turnDir * wallOffset > 0

      if (turnDir * wallOffset > 0) {
        // We are on the inside of the turn. DANGER of overlap.
        // Calculate safe radius
        // Angle constraint: avoid crossing the center
        const angle = Math.acos(Math.max(-1, Math.min(1, cosTheta)));
        if (angle > 0.05) { // Only clamp if there is an actual turn
          const avgLen = (l1 + l2) / 2;
          // Radius approx = ArcLength / Angle
          const radius = avgLen / (2 * Math.tan(angle / 2));
          // Use a safety factor (0.8) to stay well clear of the singularity
          const maxSafeOffset = Math.max(10, radius * 0.9);

          if (Math.abs(effectiveOffset) > maxSafeOffset) {
            // Clamp magnitude, preserve sign
            effectiveOffset = Math.sign(effectiveOffset) * maxSafeOffset;
          }
        }
      }

      wallPoints.push({
        x: pt.x + nx * effectiveOffset,
        y: pt.y + ny * effectiveOffset,
        edgeX: pt.x,
        edgeY: pt.y,
        nx: nx,
        ny: ny,
        idx: i
      });
    }

    // Pass 2: For each point, find its closest potential partner
    // IMPORTANT: Only merge if walls face TOWARD each other (opposite normals)
    // This distinguishes true merges (loop-back) from hairpin turns
    const closestPartner = new Map();
    for (let i = 0; i < edge.length; i++) {
      const wp = wallPoints[i];
      let closestIdx = -1;
      let closestDist = mergeThreshold;

      for (let j = 0; j < edge.length; j++) {
        const indexDist = Math.min(Math.abs(i - j), edge.length - Math.abs(i - j));
        if (indexDist < minIndexGap) continue;

        const otherWp = wallPoints[j];
        const dist = Math.hypot(wp.x - otherWp.x, wp.y - otherWp.y);

        if (dist < closestDist) {
          // Check if walls face toward each other (normals should be roughly opposite)
          // Dot product of normals: -1 = opposite, 0 = perpendicular, +1 = same direction
          const dotNormals = wp.nx * otherWp.nx + wp.ny * otherWp.ny;

          // For a valid merge, walls should face toward each other
          // At hairpins, walls face the same direction (dot > 0), so DON'T merge
          // At loop-backs, walls face opposite directions (dot < 0), so DO merge
          // Use threshold of 0.3 to allow some tolerance
          if (dotNormals > 0.3) continue; // Same direction - hairpin, not a merge

          closestDist = dist;
          closestIdx = j;
        }
      }

      if (closestIdx >= 0) {
        closestPartner.set(i, { idx: closestIdx, dist: closestDist });
      }
    }

    // Pass 3: Build path - ALL points added, but merged points use midpoint
    // Both partners add their point at the midpoint position
    const path = [];
    for (let i = 0; i < edge.length; i++) {
      const wp = wallPoints[i];
      const myPartnerInfo = closestPartner.get(i);

      if (myPartnerInfo) {
        // Has a close partner - use midpoint
        const otherWp = wallPoints[myPartnerInfo.idx];
        path.push({
          x: (wp.x + otherWp.x) / 2,
          y: (wp.y + otherWp.y) / 2,
          idx: i,
          partnerIdx: myPartnerInfo.idx,
          merged: true
        });
      } else {
        // No partner - use normal position
        path.push({
          x: wp.x,
          y: wp.y,
          idx: i,
          partnerIdx: -1,
          merged: false
        });
      }
    }

    return path;
  }

  /**
   * Build wall segments from a wall path.
   * Creates continuous segments - detects duplicate regions to avoid double-drawing.
   */
  function buildWallSegments(wallPath, maxGap) {
    if (!wallPath || wallPath.length < 3) return [];

    const n = wallPath.length;
    const segments = [];
    let currentSegment = [];

    // Track merged points we've added so far (only merged points can be duplicates)
    const addedMergedPoints = [];
    const duplicateThreshold = maxGap * 0.35; // Tighter threshold - only skip true overlaps
    const minIndexGapForDuplicate = Math.max(20, Math.floor(n * 0.1));

    for (let i = 0; i < n; i++) {
      const wallPt = wallPath[i];

      const pt = {
        x: wallPt.x,
        y: wallPt.y,
        merged: wallPt.merged,
        origIdx: wallPt.idx,
        pathIdx: i
      };

      // Check if this point is a duplicate of one we've already added
      // ONLY merged points can be duplicates - this ensures corner tips are preserved
      let isDuplicate = false;
      if (pt.merged) {
        for (const added of addedMergedPoints) {
          const indexDist = Math.abs(i - added.pathIdx);
          if (indexDist < minIndexGapForDuplicate) continue; // Too close in path order

          const spatialDist = Math.hypot(pt.x - added.x, pt.y - added.y);
          if (spatialDist < duplicateThreshold) {
            isDuplicate = true;
            break;
          }
        }
      }

      if (isDuplicate) {
        // This point is a duplicate - end current segment and skip
        if (currentSegment.length > 1) {
          segments.push({ points: currentSegment });
        }
        currentSegment = [];
        continue; // Skip this point
      }

      // Check for large spatial gaps that indicate segment breaks
      if (currentSegment.length > 0) {
        const last = currentSegment[currentSegment.length - 1];
        const gap = Math.hypot(pt.x - last.x, pt.y - last.y);

        if (gap > maxGap) {
          // Large gap - start new segment
          if (currentSegment.length > 1) {
            segments.push({ points: currentSegment });
          }
          currentSegment = [];
        }
      }

      currentSegment.push(pt);
      // Only track merged points for duplicate detection
      if (pt.merged) {
        addedMergedPoints.push(pt);
      }
    }

    // Add final segment
    if (currentSegment.length > 1) {
      segments.push({ points: currentSegment });
    }

    // Try to close the loop by connecting last segment to first
    if (segments.length >= 2) {
      const firstSeg = segments[0];
      const lastSeg = segments[segments.length - 1];
      const firstPt = firstSeg.points[0];
      const lastPt = lastSeg.points[lastSeg.points.length - 1];
      const gap = Math.hypot(firstPt.x - lastPt.x, firstPt.y - lastPt.y);

      if (gap < maxGap * 2) {
        // Merge last segment into first
        firstSeg.points = lastSeg.points.concat(firstSeg.points);
        segments.pop();
      }
    } else if (segments.length === 1) {
      // Single segment - check if it should close on itself
      const seg = segments[0];
      const firstPt = seg.points[0];
      const lastPt = seg.points[seg.points.length - 1];
      const gap = Math.hypot(firstPt.x - lastPt.x, firstPt.y - lastPt.y);

      if (gap < maxGap * 2) {
        // Close the loop
        seg.points.push({ ...firstPt });
      }
    }

    return segments;
  }

  /**
   * Process an edge to create wall segments.
   * Smooths the edge, builds wall path, removes self-intersections, and creates segments.
   * @param {Array} edge - The edge points
   * @param {number} roadWidth - The road width
   * @param {number} offsetDirection - 1 for outer edge (offset outward), -1 for inner edge (offset inward toward center grass)
   */
  function processEdgeForWalls(edge, roadWidth, offsetDirection = 1) {
    if (!edge || edge.length < 3) return [];

    // Smooth the path to prevent sharp corner issues
    const smoothedEdge = smoothWallPath(edge, roadWidth);

    // Build wall centerline path - handles merging of parallel sections
    let wallPath = buildWallPath(smoothedEdge, roadWidth, offsetDirection);
    if (wallPath.length < 3) return [];

    // Remove self-intersections AFTER the offset is applied
    // This is critical because the offset can create new intersections at sharp corners
    wallPath = removeSelfIntersections(wallPath);
    if (wallPath.length < 3) return [];

    // Build segments from the wall path
    const maxGap = roadWidth * 0.8;
    return buildWallSegments(wallPath, maxGap);
  }

  /**
   * Create wall data for continuous path-based rendering on both track edges.
   * When walls from different track sections overlap, they merge into one.
   */
  function createInnerWalls(edges, zones, params) {
    // Process outer edge walls (offset outward, away from track)
    const outerSegments = processEdgeForWalls(edges.outer, params.roadWidth, 1);

    // Process inner edge walls (offset inward toward center grass, opposite of normal direction)
    const innerSegments = processEdgeForWalls(edges.inner, params.roadWidth, -1);

    return {
      outerSegments: outerSegments,
      innerSegments: innerSegments,
      wallWidth: 28
    };
  }

  function drawKerbs(ctx, kerbMeta, atlas) {
    const colors = ["#d63d3d", "#f2f4f8"];
    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    for (const stripe of kerbMeta.inner.concat(kerbMeta.outer)) {
      const color = colors[stripe.stripeIndex % colors.length];
      const midX = (stripe.x1 + stripe.x2) * 0.5;
      const midY = (stripe.y1 + stripe.y2) * 0.5;
      const angle = Math.atan2(stripe.y2 - stripe.y1, stripe.x2 - stripe.x1);
      const length = Math.hypot(stripe.x2 - stripe.x1, stripe.y2 - stripe.y1);
      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      if (atlas) {
        const kerbSprite = SPRITE_MAP.kerb;
        ctx.drawImage(
          atlas,
          kerbSprite.x,
          kerbSprite.y,
          kerbSprite.w,
          kerbSprite.h,
          -length * 0.5,
          -stripe.width * 0.5,
          length,
          stripe.width
        );
      } else {
        ctx.fillRect(-length * 0.5, -stripe.width * 0.5, length, stripe.width);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawBarriers(ctx, barriers, atlas) {
    ctx.save();
    ctx.fillStyle = "#b7bbc6";
    ctx.strokeStyle = "#1f2933";
    ctx.lineWidth = 2;
    for (const post of barriers) {
      ctx.save();
      ctx.translate(post.x, post.y);
      ctx.rotate(post.angle);
      if (atlas) {
        const sprite = SPRITE_MAP.barrier;
        ctx.drawImage(
          atlas,
          sprite.x,
          sprite.y,
          sprite.w,
          sprite.h,
          -sprite.w * 0.5,
          -sprite.h * 0.5,
          sprite.w,
          sprite.h
        );
      } else {
        ctx.fillRect(-5, -post.length * 0.5, 10, post.length);
        ctx.strokeRect(-5, -post.length * 0.5, 10, post.length);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Draw a set of wall segments with the red/white striped pattern.
   */
  function drawWallSegments(ctx, segments, wallWidth, stripeLength, stripeWidth) {
    for (const segment of segments) {
      if (segment.points.length < 2) continue;

      // Build the path once
      ctx.beginPath();
      ctx.moveTo(segment.points[0].x, segment.points[0].y);
      for (let i = 1; i < segment.points.length; i++) {
        ctx.lineTo(segment.points[i].x, segment.points[i].y);
      }

      // Dark outline first (drawn thicker, underneath)
      ctx.strokeStyle = "#2d3138";
      ctx.lineWidth = wallWidth + 4;
      ctx.setLineDash([]);
      ctx.stroke();

      // Gray wall body on top
      ctx.strokeStyle = "#9fa3ab";
      ctx.lineWidth = wallWidth;
      ctx.stroke();

      // Draw red/white stripes as dashed lines along the same path
      // This ensures stripes curve properly with the wall
      ctx.lineCap = "butt";
      ctx.lineWidth = stripeWidth;

      // Red stripes (offset by 0)
      ctx.strokeStyle = "#e63946";
      ctx.setLineDash([stripeLength, stripeLength]);
      ctx.lineDashOffset = 0;
      ctx.stroke();

      // White stripes (offset by stripeLength so they fill the gaps)
      ctx.strokeStyle = "#f8f9fa";
      ctx.lineDashOffset = -stripeLength;
      ctx.stroke();

      // Reset line dash
      ctx.setLineDash([]);
      ctx.lineCap = "round";
    }
  }

  function drawInnerWalls(ctx, wallData) {
    if (!wallData) return;

    const { outerSegments = [], innerSegments = [], wallWidth = 28 } = wallData;
    const stripeLength = 20;
    const stripeWidth = 8;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Draw outer edge walls
    if (outerSegments.length > 0) {
      drawWallSegments(ctx, outerSegments, wallWidth, stripeLength, stripeWidth);
    }

    // Draw inner edge walls
    if (innerSegments.length > 0) {
      drawWallSegments(ctx, innerSegments, wallWidth, stripeLength, stripeWidth);
    }

    ctx.restore();
  }

  function drawTrees(ctx, trees, atlas) {
    ctx.save();
    for (const tree of trees) {
      ctx.save();
      ctx.translate(tree.x, tree.y);
      const scale = tree.radius / 24;
      if (atlas) {
        const sprite = SPRITE_MAP.tree[tree.variant % SPRITE_MAP.tree.length];
        const w = sprite.w * scale;
        const h = sprite.h * scale;
        ctx.drawImage(
          atlas,
          sprite.x,
          sprite.y,
          sprite.w,
          sprite.h,
          -w * 0.5,
          -h * 0.8,
          w,
          h
        );
      } else {
        const gradient = ctx.createRadialGradient(0, -tree.radius * 0.25, tree.radius * 0.2, 0, 0, tree.radius);
        gradient.addColorStop(0, "#3a8f3a");
        gradient.addColorStop(1, "#1e4520");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, tree.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#5d3c14";
        ctx.fillRect(-tree.radius * 0.14, 0, tree.radius * 0.28, tree.radius * 0.8);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawStadiums(ctx, stadiums, audienceImage) {
    if (!stadiums || stadiums.length === 0) return;

    ctx.save();
    ctx.lineJoin = "round";

    for (const stadium of stadiums) {
      if (!stadium.points || stadium.points.length < 3) continue;

      // Draw the main stadium body
      ctx.beginPath();
      ctx.moveTo(stadium.points[0].x, stadium.points[0].y);
      for (let i = 1; i < stadium.points.length; i++) {
        ctx.lineTo(stadium.points[i].x, stadium.points[i].y);
      }
      ctx.closePath();

      // Concrete/Structure color
      ctx.fillStyle = "#cbd5e1"; // Slate-300
      ctx.fill();

      // Border
      ctx.strokeStyle = "#64748b"; // Slate-500
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw audience along the FRONT edge (the track-facing side)
      if (stadium.innerPoints && stadium.innerPoints.length > 1) {
        // If we have an audience image, tiling it along the path
        if (audienceImage) {
          ctx.save();
          // Clip to the "stands" area to ensure clean edges
          // We'll create a clipping path that is slightly wider than the image to handle corners
          ctx.beginPath();
          const clipWidth = 24; // Width of the audience strip
          // We need to build a polygon for clipping or just draw carefully
          // Simple tiling approach: transform to each segment

          // Clip to the stadium polygon so we can fill it with audience without spilling
          ctx.save();
          if (stadium.points && stadium.points.length > 2) {
            ctx.beginPath();
            ctx.moveTo(stadium.points[0].x, stadium.points[0].y);
            for (let k = 1; k < stadium.points.length; k++) {
              ctx.lineTo(stadium.points[k].x, stadium.points[k].y);
            }
            ctx.closePath();
            ctx.clip();
          }

          // Initialize distance tracking before the loop
          if (stadium.innerPoints) stadium.distFlown = 0;

          for (let j = 0; j < stadium.innerPoints.length - 1; j++) {
            const p1 = stadium.innerPoints[j];
            const p2 = stadium.innerPoints[j + 1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy);
            const angle = Math.atan2(dy, dx);

            if (len < 1) continue;

            ctx.save();
            ctx.translate(p1.x, p1.y);
            ctx.rotate(angle);

            // Draw tiles
            // Increased from 18 to 60 per user request
            const targetHeight = 60;
            const imgAspect = audienceImage.width / audienceImage.height;
            const tileWidth = targetHeight * imgAspect;
            // Shift "inward" (positive Y) so it sits on the stadium structure.
            // Using -5 to have a slight overhang covering the edge line, but mostly inside.
            const yOffset = -5;

            let currentSegX = 0;
            // Draw chunks that fit within the texture wrapping
            while (currentSegX < len) {
              const currentGlobalDist = (stadium.distFlown || 0) + currentSegX;
              const texOffset = currentGlobalDist % tileWidth;
              const remainingInTile = tileWidth - texOffset;
              const drawLen = Math.min(len - currentSegX, remainingInTile);

              const srcX = (texOffset / tileWidth) * audienceImage.width;
              // Ensure we don't sample past image width due to floating point
              const safeSrcX = Math.min(srcX, audienceImage.width - 1);
              const srcW = (drawLen / tileWidth) * audienceImage.width;

              // Draw multiple rows to fill the stadium depth
              // 4 rows * 60px = 240px depth, usually enough to fill most stadiums
              // The clipping path ensures we don't draw outside the back
              for (let row = 0; row < 5; row++) {
                // Offset each row by 30% of image width in texture space to break up patterns
                // (Optional, but looks better)
                // For now, keep it aligned for continuity

                const rowY = yOffset + (row * targetHeight);
                ctx.drawImage(
                  audienceImage,
                  safeSrcX, 0, srcW, audienceImage.height,
                  currentSegX, rowY, drawLen, targetHeight
                );
              }

              currentSegX += drawLen;
            }
            if (stadium.distFlown !== undefined) stadium.distFlown += len;

            ctx.restore();
          }
          ctx.restore(); // Undo clip
          // End loop for segments
          ctx.restore();
        } else {
          // Fallback to simple colored bands
          ctx.save();
          ctx.lineCap = "butt";
          ctx.lineJoin = "round";

          ctx.beginPath();
          ctx.moveTo(stadium.innerPoints[0].x, stadium.innerPoints[0].y);
          for (let j = 1; j < stadium.innerPoints.length; j++) {
            ctx.lineTo(stadium.innerPoints[j].x, stadium.innerPoints[j].y);
          }

          // Single "stands" band - simplified from 8 strokes to avoid GPU context loss
          ctx.strokeStyle = "#475569"; // Stands base (slate-600)
          ctx.lineWidth = 20;
          ctx.stroke();

          // Single "crowd" band on top
          ctx.strokeStyle = "#94a3b8"; // Crowd (slate-400)
          ctx.lineWidth = 8;
          ctx.stroke();

          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  function drawBuildings(ctx, buildings) {
    if (!buildings || buildings.length === 0) return;
    ctx.save();
    for (const b of buildings) {
      if (!b) continue;
      const w = Math.max(20, b.width || 60);
      const d = Math.max(16, b.depth || 40);
      const x = b.x || 0;
      const y = b.y || 0;
      const angle = b.angle || 0;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);

      // Base building body.
      ctx.fillStyle = "#d5dbe5";
      ctx.fillRect(-w * 0.5, -d * 0.5, w, d);

      // Subtle roof strip for depth.
      ctx.fillStyle = "#b7c0ce";
      ctx.fillRect(-w * 0.5, -d * 0.5, w, Math.max(6, d * 0.22));

      // Outline.
      ctx.strokeStyle = "#6b778b";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-w * 0.5, -d * 0.5, w, d);

      ctx.restore();
    }
    ctx.restore();
  }

  function drawShadows(shadowCtx, metadata, maskCanvas, mapping) {
    const params = metadata.params || DEFAULT_PARAMS;
    const shadowAlpha = params.shadowStrength != null ? params.shadowStrength : DEFAULT_PARAMS.shadowStrength;
    const worldMinX = mapping ? (mapping.worldMinX || 0) : 0;
    const worldMinY = mapping ? (mapping.worldMinY || 0) : 0;
    const worldWidth = mapping ? (mapping.worldWidth || (maskCanvas ? maskCanvas.width : shadowCtx.canvas.width)) : (maskCanvas ? maskCanvas.width : shadowCtx.canvas.width);
    const worldHeight = mapping ? (mapping.worldHeight || (maskCanvas ? maskCanvas.height : shadowCtx.canvas.height)) : (maskCanvas ? maskCanvas.height : shadowCtx.canvas.height);
    const worldToTex = mapping && mapping.worldToTex ? mapping.worldToTex : 1;

    shadowCtx.save();
    shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
    shadowCtx.clearRect(0, 0, shadowCtx.canvas.width, shadowCtx.canvas.height);
    shadowCtx.restore();

    shadowCtx.save();
    if (mapping && mapping.worldToTex) {
      shadowCtx.setTransform(worldToTex, 0, 0, worldToTex, -worldMinX * worldToTex, -worldMinY * worldToTex);
    } else {
      shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    shadowCtx.imageSmoothingEnabled = false;
    shadowCtx.globalCompositeOperation = "source-over";
    shadowCtx.fillStyle = "rgba(8, 8, 8, 0.28)";
    shadowCtx.globalAlpha = 0.5 * shadowAlpha;
    for (const tree of metadata.items.trees) {
      shadowCtx.save();
      shadowCtx.translate(tree.x + tree.radius * 0.25, tree.y + tree.radius * 0.35);
      shadowCtx.scale(1.6, 0.6);
      shadowCtx.beginPath();
      shadowCtx.arc(0, 0, tree.radius, 0, Math.PI * 2);
      shadowCtx.fill();
      shadowCtx.restore();
    }
    shadowCtx.fillStyle = "rgba(12, 12, 12, 0.32)";

    // DISABLED: Stadium shadows cause Chrome (Windows, hardware acceleration ON) to silently
    // lose all canvas content. The large polygon fills combined with other shadow operations
    // trigger GPU context loss. Tree shadows and mask shadows below work fine.
    // See CLAUDE.md "Common Gotchas" for details. Don't re-enable without Chrome testing.
    /*
    if (metadata.items.stadiums) {
      for (const stadium of metadata.items.stadiums) {
        if (!stadium.points || stadium.points.length < 3) continue;
  
        shadowCtx.save();
        // Offset shadow
        shadowCtx.translate(16, 16);
  
        shadowCtx.beginPath();
        shadowCtx.moveTo(stadium.points[0].x, stadium.points[0].y);
        for (let i = 1; i < stadium.points.length; i++) {
          shadowCtx.lineTo(stadium.points[i].x, stadium.points[i].y);
        }
        shadowCtx.closePath();
        shadowCtx.fill();
        shadowCtx.restore();
      }
    }
    */

    if (maskCanvas) {
      shadowCtx.save();
      shadowCtx.globalAlpha = 0.45 * shadowAlpha;
      shadowCtx.globalCompositeOperation = "multiply";
      const maskWidth = maskCanvas.width || 0;
      const maskHeight = maskCanvas.height || 0;
      const srcX = Math.max(0, Math.floor(worldMinX));
      const srcY = Math.max(0, Math.floor(worldMinY));
      const srcW = Math.max(1, Math.min(maskWidth - srcX, Math.ceil(worldWidth)));
      const srcH = Math.max(1, Math.min(maskHeight - srcY, Math.ceil(worldHeight)));
      try {
        shadowCtx.filter = `blur(${EDGE_SHADOW_BLUR}px)`;
        shadowCtx.drawImage(maskCanvas, srcX, srcY, srcW, srcH, worldMinX, worldMinY, worldWidth, worldHeight);
        shadowCtx.filter = "none";
      } catch (err) {
        shadowCtx.globalAlpha *= 0.3;
        shadowCtx.drawImage(maskCanvas, srcX, srcY, srcW, srcH, worldMinX, worldMinY, worldWidth, worldHeight);
      }
      shadowCtx.restore();
    }
    shadowCtx.restore();
  }

  function buildMetadata(options) {
    const { maskCanvas, roadWidth, centerline, params, seed } = options;
    const bounds = options.bounds;
    const zones = createZones(maskCanvas, BUFFER_RADIUS, bounds);
    zones.seed = seed;
    const effectiveParams = {
      treeDensity: Math.max(0, Math.min(1.2, params.treeDensity ?? DEFAULT_PARAMS.treeDensity)),
      buildingDensity: Math.max(0, Math.min(1.1, params.buildingDensity ?? DEFAULT_PARAMS.buildingDensity)),
      kerbWidthScale: Math.max(0.25, Math.min(2.5, params.kerbWidthScale ?? DEFAULT_PARAMS.kerbWidthScale)),
      shadowStrength: Math.max(0, Math.min(1, params.shadowStrength ?? DEFAULT_PARAMS.shadowStrength)),
      roadWidth: roadWidth,
    };
    const rng = makeRng(seed);
    const edges = buildEdges(centerline, roadWidth);
    const curvature = computeCurvature(centerline);
    const kerbs = createKerbs(edges, curvature, effectiveParams);
    const barriers = createBarriers(edges, curvature, effectiveParams, rng, zones);
    const innerWalls = createInnerWalls(edges, zones, effectiveParams);

    // Create stadiums FIRST so we can mask them out for trees
    const stadiums = createStadiums(innerWalls, zones, rng, effectiveParams);

    const trees = sampleTrees(zones, rng, effectiveParams, stadiums);
    const stats = computeStadiumStats({ stadiums, innerWalls });

    return {
      version: 8,
      seed,
      params: {
        treeDensity: effectiveParams.treeDensity,
        buildingDensity: effectiveParams.buildingDensity,
        kerbWidthScale: effectiveParams.kerbWidthScale,
        shadowStrength: effectiveParams.shadowStrength,
      },
      items: {
        stadiums,
        buildings: [], // Deprecated legacy layer
        kerbs,
        barriers,
        trees,
        innerWalls,
      },
      stats,
      zones: {
        offsetX: zones.offsetX || 0,
        offsetY: zones.offsetY || 0,
      },
    };
  }

  function replay(metadata, options) {
    const decorCtx = options.decorCtx;
    const shadowCtx = options.shadowCtx;
    const atlas = options.atlas;
    const maskCanvas = options.maskCanvas;
    const mapping = options.mapping;
    const worldMinX = mapping ? (mapping.worldMinX || 0) : 0;
    const worldMinY = mapping ? (mapping.worldMinY || 0) : 0;
    const worldToTex = mapping && mapping.worldToTex ? mapping.worldToTex : 1;

    // Clear in texture space before drawing
    decorCtx.save();
    decorCtx.setTransform(1, 0, 0, 1, 0, 0);
    decorCtx.clearRect(0, 0, decorCtx.canvas.width, decorCtx.canvas.height);
    decorCtx.restore();

    decorCtx.save();
    if (mapping && mapping.worldToTex) {
      decorCtx.setTransform(worldToTex, 0, 0, worldToTex, -worldMinX * worldToTex, -worldMinY * worldToTex);
    } else {
      decorCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    decorCtx.imageSmoothingEnabled = false;
    decorCtx.globalCompositeOperation = "source-over";
    drawKerbs(decorCtx, metadata.items.kerbs, atlas);
    if (metadata.items.innerWalls &&
      ((metadata.items.innerWalls.outerSegments && metadata.items.innerWalls.outerSegments.length > 0) ||
        (metadata.items.innerWalls.innerSegments && metadata.items.innerWalls.innerSegments.length > 0))) {
      drawInnerWalls(decorCtx, metadata.items.innerWalls);
    }
    drawBarriers(decorCtx, metadata.items.barriers, atlas);
    drawBarriers(decorCtx, metadata.items.barriers, atlas);
    drawStadiums(decorCtx, metadata.items.stadiums, options.audienceImage);
    // drawBuildings(decorCtx, metadata.items.buildings); // Legacy path intentionally disabled.
    drawTrees(decorCtx, metadata.items.trees, atlas);
    drawTrees(decorCtx, metadata.items.trees, atlas);
    decorCtx.restore();

    drawShadows(shadowCtx, metadata, maskCanvas, mapping);
  }

  function generate(options) {
    if (!options) throw new Error("Decor.generate requires options");
    const limits = Object.assign({}, DECOR_TEXTURE_LIMITS, options.textureLimits || {});
    const devicePixelRatio = Math.max(1, Number(options.devicePixelRatio) || ((typeof window !== "undefined" && window.devicePixelRatio) || 1));
    const baseWorldWidth = Math.max(1, Number(options.baseWorldWidth) || Number(options.width) || 1000);
    const baseWorldHeight = Math.max(1, Number(options.baseWorldHeight) || Number(options.height) || 700);
    const worldWidth = Math.max(1, Number(options.width) || Math.round(baseWorldWidth));
    const worldHeight = Math.max(1, Number(options.height) || Math.round(baseWorldHeight));
    const worldScale = Math.max(0.0001, (worldWidth / baseWorldWidth));
    const roadWidth = Math.max(12, Number(options.roadWidth) || 80);

    const rawBounds = options.bounds && typeof options.bounds === "object"
      ? {
        minX: Number(options.bounds.minX) ?? 0,
        minY: Number(options.bounds.minY) ?? 0,
        maxX: Number(options.bounds.maxX) ?? worldWidth,
        maxY: Number(options.bounds.maxY) ?? worldHeight,
      }
      : computeBounds(options.centerline, worldWidth, worldHeight);
    const pad = (options.boundsPadding != null ? Number(options.boundsPadding) : (roadWidth * 1.25 + BUFFER_RADIUS));
    const bounds = expandBounds(rawBounds, pad, worldWidth, worldHeight);
    const { ppm, texW, texH } = pickDecorResolution(bounds, {
      textureLimits: limits,
      devicePixelRatio,
      pxPerMeter: options.pxPerMeter,
    });

    const decorPair = createCanvas2d(texW, texH, false);
    const shadowPair = createCanvas2d(texW, texH, false);
    if (!decorPair.ctx || !shadowPair.ctx) {
      throw new Error("Decor canvas contexts unavailable");
    }

    const decorCanvas = decorPair.canvas;
    const shadowCanvas = shadowPair.canvas;
    const decorCtx = decorPair.ctx;
    const shadowCtx = shadowPair.ctx;

    decorCtx.setTransform(1, 0, 0, 1, 0, 0);
    decorCtx.clearRect(0, 0, texW, texH);
    shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
    shadowCtx.clearRect(0, 0, texW, texH);

    const texToWorld = 1 / ppm;
    const mapping = {
      textureWidth: texW,
      textureHeight: texH,
      worldMinX: bounds.minX,
      worldMinY: bounds.minY,
      worldWidth: bounds.maxX - bounds.minX,
      worldHeight: bounds.maxY - bounds.minY,
      baseWorldWidth,
      baseWorldHeight,
      worldScale,
      ppm,
      worldToTex: ppm,
      texToWorld,
    };

    function paramsApproximatelyMatch(existingParams, nextParams) {
      if (!existingParams || !nextParams) return false;
      const keys = ["treeDensity", "buildingDensity", "kerbWidthScale", "shadowStrength"];
      for (const key of keys) {
        const nextValue = Number(nextParams[key]);
        if (!Number.isFinite(nextValue)) continue;
        const existingValue = Number(existingParams[key]);
        if (!Number.isFinite(existingValue)) return false;
        if (Math.abs(existingValue - nextValue) > 0.0001) return false;
      }
      return true;
    }

    let metadata = null;
    const existing = options.existing;
    const canReuse = existing && existing.version >= 8 && !options.force;
    const mappingMatches = canReuse && existing.mapping &&
      Math.abs((existing.mapping.worldMinX || 0) - mapping.worldMinX) < 0.5 &&
      Math.abs((existing.mapping.worldMinY || 0) - mapping.worldMinY) < 0.5 &&
      Math.abs((existing.mapping.worldWidth || 0) - mapping.worldWidth) < 1 &&
      Math.abs((existing.mapping.worldHeight || 0) - mapping.worldHeight) < 1 &&
      Math.abs((existing.mapping.ppm || existing.mapping.worldToTex || 0) - mapping.ppm) < 0.01;
    const paramsMatch = canReuse && paramsApproximatelyMatch(existing.params || {}, options.params || {});

    if (canReuse && mappingMatches && existing.seed === options.seed && paramsMatch) {
      metadata = cloneMetadata(existing);
      metadata.params = Object.assign({}, metadata.params, options.params || {});
      metadata.bounds = {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
      };
    } else {
      const metaOptions = Object.assign({}, options, {
        bounds,
        params: options.params || {},
      });
      metadata = buildMetadata(metaOptions);
      metadata.bounds = {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
      };
    }

    if (!metadata.stats) {
      metadata.stats = computeStadiumStats(metadata.items || {});
    }
    metadata.mapping = mapping;

    replay(metadata, {
      decorCtx,
      shadowCtx,
      atlas: options.atlas || getAtlas(),
      maskCanvas: options.maskCanvas,
      audienceImage: options.audienceImage,
      mapping,
    });

    return {
      decorCanvas,
      shadowCanvas,
      metadata,
    };
  }

  global.Decor = {
    defaults: DEFAULT_PARAMS,
    loadAtlas,
    getAtlas,
    generate,
    hash: hashString,
    computeStadiumStats,
    textureLimits: DECOR_TEXTURE_LIMITS,
  };
})(typeof window !== "undefined" ? window : this);
