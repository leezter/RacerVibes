(function (global) {
  const DEFAULT_PARAMS = {
    treeDensity: 0.55,
    buildingDensity: 0.4,
    kerbWidthScale: 1.0,
    shadowStrength: 0.55,
  };
  const DECOR_TEXTURE_LIMITS = {
    maxSize: 4096,
    targetPxPerMeter: 6,
  };
  const BUFFER_RADIUS = 28;
  const TREE_MIN_SPACING = 26;
  const TREE_MAX_SPACING = 40;
  const BUILDING_SPACING = 160;
  const BARRIER_SPACING = 42;
  const BARRIER_CURVATURE_THRESHOLD = 0.35;
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

  function buildEdges(centerline, roadWidth) {
    const inner = [];
    const outer = [];
    const normals = [];
    const half = (roadWidth || 80) * 0.5;
    for (let i = 0; i < centerline.length - 1; i++) {
      const a = centerline[i];
      const b = centerline[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      normals.push({ x: nx, y: ny });
      inner.push({ x: a.x - nx * half, y: a.y - ny * half, nx, ny });
      outer.push({ x: a.x + nx * half, y: a.y + ny * half, nx, ny });
    }
    const last = centerline[centerline.length - 1];
    const first = centerline[0];
    const dx0 = first.x - last.x;
    const dy0 = first.y - last.y;
    const len0 = Math.hypot(dx0, dy0) || 1;
    const nx0 = -dy0 / len0;
    const ny0 = dx0 / len0;
    inner.push({ x: last.x - nx0 * half, y: last.y - ny0 * half, nx: nx0, ny: ny0 });
    outer.push({ x: last.x + nx0 * half, y: last.y + ny0 * half, nx: nx0, ny: ny0 });
    normals.push({ x: nx0, y: ny0 });
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

  function lerpPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function paintKerbMetadata(edgePoints, curvature, params, side) {
    const stripes = [];
    const stripeLength = 18;
    const kerbWidth = Math.max(6, 0.14 * params.roadWidth * params.kerbWidthScale);
    let acc = 0;
    for (let i = 0; i < edgePoints.length - 1; i++) {
      const a = edgePoints[i];
      const b = edgePoints[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const segAngle = Math.atan2(b.y - a.y, b.x - a.x);
      let t = 0;
      while (t < segLen) {
        const next = Math.min(segLen, t + stripeLength);
        const mid = (t + next) * 0.5 / segLen;
        const p1 = lerpPoint(a, b, t / segLen);
        const p2 = lerpPoint(a, b, next / segLen);
        const curveBoost = 1 + Math.min(0.8, Math.abs(curvature[i]) * 2.2);
        stripes.push({
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          angle: segAngle,
          width: kerbWidth * curveBoost,
          stripeIndex: ((acc / stripeLength) & 1) === 0 ? 0 : 1,
          side,
        });
        t = next;
        acc += stripeLength;
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

  function sampleTrees(zones, rng, params) {
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

  function drawBuildings(ctx, buildings, atlas) {
    ctx.save();
    ctx.fillStyle = "#8b93a0";
    ctx.strokeStyle = "#1f2933";
    ctx.lineWidth = 2;
    for (const b of buildings) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      if (atlas) {
        const sprite = SPRITE_MAP.building;
        ctx.drawImage(
          atlas,
          sprite.x,
          sprite.y,
          sprite.w,
          sprite.h,
          -b.width * 0.5,
          -b.depth * 0.5,
          b.width,
          b.depth
        );
      } else {
        ctx.fillRect(-b.width * 0.5, -b.depth * 0.5, b.width, b.depth);
        ctx.strokeRect(-b.width * 0.5, -b.depth * 0.5, b.width, b.depth);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(-b.width * 0.4, -b.depth * 0.3, b.width * 0.8, b.depth * 0.6);
      }
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
    for (const b of metadata.items.buildings) {
      const offset = Math.max(16, Math.min(42, (b.depth + b.width) * 0.2));
      const dx = Math.cos(b.angle) * offset * 0.6;
      const dy = Math.sin(b.angle) * offset * 0.6;
      shadowCtx.save();
      shadowCtx.translate(b.x + dx, b.y + dy);
      shadowCtx.rotate(b.angle);
      shadowCtx.scale(1.1, 0.6);
      shadowCtx.fillRect(-b.width * 0.5, -b.depth * 0.5, b.width, b.depth);
      shadowCtx.restore();
    }
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
    const trees = sampleTrees(zones, rng, effectiveParams);
    const buildings = createBuildings(edges, zones, rng, effectiveParams);
    return {
      version: 2,
      seed,
      params: {
        treeDensity: effectiveParams.treeDensity,
        buildingDensity: effectiveParams.buildingDensity,
        kerbWidthScale: effectiveParams.kerbWidthScale,
        shadowStrength: effectiveParams.shadowStrength,
      },
      items: {
        kerbs,
        barriers,
        trees,
        buildings,
      },
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
    drawBarriers(decorCtx, metadata.items.barriers, atlas);
    drawBuildings(decorCtx, metadata.items.buildings, atlas);
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

    let metadata = null;
    const existing = options.existing;
    const canReuse = existing && existing.version >= 2 && !options.force;
    const mappingMatches = canReuse && existing.mapping &&
      Math.abs((existing.mapping.worldMinX || 0) - mapping.worldMinX) < 0.5 &&
      Math.abs((existing.mapping.worldMinY || 0) - mapping.worldMinY) < 0.5 &&
      Math.abs((existing.mapping.worldWidth || 0) - mapping.worldWidth) < 1 &&
      Math.abs((existing.mapping.worldHeight || 0) - mapping.worldHeight) < 1 &&
      Math.abs((existing.mapping.ppm || existing.mapping.worldToTex || 0) - mapping.ppm) < 0.01;

    if (canReuse && mappingMatches && existing.seed === options.seed) {
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

    metadata.mapping = mapping;

    replay(metadata, {
      decorCtx,
      shadowCtx,
      atlas: options.atlas || getAtlas(),
      maskCanvas: options.maskCanvas,
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
    textureLimits: DECOR_TEXTURE_LIMITS,
  };
})(typeof window !== "undefined" ? window : this);
