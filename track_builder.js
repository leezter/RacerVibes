(function(global){
  'use strict';
  
  // ===== Constants =====
  const DEFAULT_ROAD_WIDTH = 120;
  const ROAD_WIDTH_RANGE = [60, 140];
  const MIN_POINTS = 32;
  const SAMPLING_SPACING = 10;
  const ERASE_RADIUS = 24;
  
  // Width scale from racer.html - used to show accurate preview
  // NOTE: These values must match SCALE_MIN/SCALE_MAX/SCALE_DEFAULT in racer.html
  const RACE_WIDTH_SCALE_DEFAULT = 2.5;
  const RACE_WIDTH_SCALE_MIN = 0.5;
  const RACE_WIDTH_SCALE_MAX = 3.0;
  
  // Car profiles matching racer.html for starting grid visualization
  // NOTE: Only visual properties (width, length, color) are needed here
  // These values must match CarProfiles in racer.html
  const CAR_PROFILES = {
    "GT":    { width: 24, length: 45, color: "#3949ab" },
    "F1":    { width: 18, length: 44, color: "#d32f2f" },
    "Rally": { width: 18, length: 34, color: "#2e7d32" },
    "Truck": { width: 29, length: 60, color: "#f97316" }
  };
  const DEFAULT_CAR_PROFILE = CAR_PROFILES.GT;
  const DEFAULT_AI_CAR_COUNT = 9;
  
  // Read width scale from localStorage (same key as racer.html)
  function readWidthScale() {
    try {
      const stored = localStorage.getItem('widthScale');
      if (stored === null) return RACE_WIDTH_SCALE_DEFAULT;
      const parsed = parseFloat(stored);
      if (Number.isFinite(parsed)) {
        return Math.min(RACE_WIDTH_SCALE_MAX, Math.max(RACE_WIDTH_SCALE_MIN, parsed));
      }
    } catch (_) {}
    return RACE_WIDTH_SCALE_DEFAULT;
  }
  
  // Surface types matching the reference image
  const SURFACE_TYPES = [
    { id: 'tarmac-pro', name: 'Tarmac Pro', color: '#4a5568', roadColor: '#6b7280' },
    { id: 'rally-dirt', name: 'Rally Dirt', color: '#92400e', roadColor: '#b45309' },
    { id: 'field', name: 'Field', color: '#166534', roadColor: '#22c55e' },
    { id: 'neon-city', name: 'Neon City', color: '#1e1b4b', roadColor: '#8b5cf6' },
    { id: 'glacier', name: 'Glacier', color: '#164e63', roadColor: '#67e8f9' }
  ];
  
  // ===== Helper Functions =====
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  
  function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }
  
  function copyPoints(points) {
    return points.map(p => ({ x: p.x, y: p.y }));
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
    const pts = closed.slice(0, -1);
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
        const midX = (prev.x + nextPt.x) / 2;
        const midY = (prev.y + nextPt.y) / 2;
        next[i] = {
          x: curr.x + (midX - curr.x) * strength,
          y: curr.y + (midY - curr.y) * strength
        };
      }
      next[n - 1] = { ...next[0] };
      pts = next;
    }
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
    if (distance(result[0], result[result.length - 1]) > 1) {
      result.push({ ...result[0] });
    } else {
      result[result.length - 1] = { ...result[0] };
    }
    return result;
  }
  
  function calcCurvature(prev, curr, next) {
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
          const violation = curvature / maxCurvature;
          maxViolation = Math.max(maxViolation, violation);
          const blend = Math.min(0.7, 0.3 * violation);
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
      if (maxViolation < 1.05) break;
    }
    return pts;
  }
  
  function findSelfIntersections(points) {
    const pts = ensureClosed(points);
    const intersections = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a1 = pts[i];
      const a2 = pts[i + 1];
      for (let j = i + 2; j < pts.length - 1; j++) {
        if (Math.abs(i - j) <= 1) continue;
        const b1 = pts[j];
        const b2 = pts[j + 1];
        if (i === 0 && j === pts.length - 2) continue;
        const hit = segmentIntersection(a1, a2, b1, b2);
        if (hit) intersections.push(hit);
      }
    }
    return intersections;
  }
  
  function segmentIntersection(a1, a2, b1, b2) {
    const det = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
    if (Math.abs(det) < 1e-6) return null;
    const ua = ((b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)) / det;
    const ub = ((a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x)) / det;
    if (ua <= 0 || ua >= 1 || ub <= 0 || ub >= 1) return null;
    return { x: a1.x + ua * (a2.x - a1.x), y: a1.y + ua * (a2.y - a1.y) };
  }
  
  function tangentFromSegment(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len, len };
  }
  
  function normalFromSegment(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
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
    return { startLine, spawn: { player: spawnPlayer, ai: spawnAIBase }, checkpoints, bounds: bbox };
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
    const canvas = document.createElement('canvas');
    canvas.width = worldWidth;
    canvas.height = worldHeight;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#fff';
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
    return { width: canvas.width, height: canvas.height, pngData: canvas.toDataURL('image/png') };
  }
  
  function makeThumbnail(centerline, worldWidth, worldHeight) {
    const thumb = document.createElement('canvas');
    const THUMB_W = 320;
    const aspect = worldWidth / worldHeight || 1;
    const THUMB_H = Math.round(THUMB_W / aspect);
    thumb.width = THUMB_W;
    thumb.height = THUMB_H;
    const ctx = thumb.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, thumb.width, thumb.height);
    const scaleX = thumb.width / worldWidth;
    const scaleY = thumb.height / worldHeight;
    ctx.save();
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = Math.max(2, (thumb.width / worldWidth) * 6);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < centerline.length; i++) {
      const p = centerline[i];
      const x = p.x * scaleX;
      const y = p.y * scaleY;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    return { width: thumb.width, height: thumb.height, pngData: thumb.toDataURL('image/png') };
  }
  
  function estimateTurns(points) {
    if (points.length < 3) return 0;
    let turns = 0;
    let prevAngle = null;
    const threshold = Math.PI / 6; // ~30 degrees
    
    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[(i + 1) % points.length];
      const angle = Math.atan2(next.y - curr.y, next.x - curr.x);
      
      if (prevAngle !== null) {
        let diff = angle - prevAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) > threshold) {
          turns++;
        }
      }
      prevAngle = angle;
    }
    return Math.floor(turns / 3); // Roughly count significant turns
  }
  
  function calculateTrackLength(points) {
    if (points.length < 2) return 0;
    let length = 0;
    for (let i = 0; i < points.length - 1; i++) {
      length += distance(points[i], points[i + 1]);
    }
    return Math.round(length);
  }
  
  // ===== Track Builder Class =====
  function TrackBuilder(options) {
    this.options = options || {};
    this.onSaved = typeof options.onSaved === 'function' ? options.onSaved : () => {};
    this.onTestDrive = typeof options.onTestDrive === 'function' ? options.onTestDrive : () => {};
    this.onClose = typeof options.onClose === 'function' ? options.onClose : () => {};
    
    this.state = {
      tool: 'draw',
      points: [],
      roadWidth: DEFAULT_ROAD_WIDTH,
      surfaceType: 'tarmac-pro',
      isDrawing: false,
      pointerId: null,
      history: [],
      historyIndex: -1,
      lastBakeResult: null,
      isClosed: false,
      panOffset: { x: 0, y: 0 },
      zoom: 1,
      isPanning: false,
      panStart: null,
      trackName: 'Grand Prix 1'
    };
    
    this.init();
  }
  
  TrackBuilder.prototype.init = function() {
    this.buildUI();
    this.attachEvents();
    this.pushHistory();
    this.render();
  };
  
  TrackBuilder.prototype.buildUI = function() {
    const surfaceButtonsHtml = SURFACE_TYPES.map(s => 
      `<button class="tb-surface-btn ${s.id === this.state.surfaceType ? 'active' : ''}" data-surface="${s.id}">${s.name}</button>`
    ).join('');
    
    // Calculate initial visual road width
    const initialWidthScale = readWidthScale();
    const initialVisualWidth = Math.round(DEFAULT_ROAD_WIDTH * initialWidthScale);
    
    const overlay = document.createElement('div');
    overlay.className = 'track-builder-overlay hidden';
    overlay.innerHTML = `
      <div class="track-builder-container">
        <!-- Header -->
        <header class="tb-header">
          <div class="tb-header-left">
            <div class="tb-logo">
              <span class="tb-logo-icon">🏁</span>
              <div class="tb-logo-text">
                <span class="tb-logo-title">APEX BUILDER</span>
                <input type="text" class="tb-track-name-input" value="${this.state.trackName}" maxlength="32" />
              </div>
            </div>
          </div>
          <div class="tb-header-center">
            <!-- Status indicator -->
          </div>
          <div class="tb-header-right">
            <button class="tb-icon-btn" data-action="undo" title="Undo">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 10h10a5 5 0 0 1 5 5v2a5 5 0 0 1-5 5H8"></path>
                <path d="M7 6L3 10l4 4"></path>
              </svg>
            </button>
            <button class="tb-icon-btn" data-action="redo" title="Redo">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10H11a5 5 0 0 0-5 5v2a5 5 0 0 0 5 5h5"></path>
                <path d="M17 6l4 4-4 4"></path>
              </svg>
            </button>
            <button class="tb-icon-btn tb-danger" data-action="clear" title="Clear Track">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18"></path>
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"></path>
                <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
              </svg>
            </button>
            <button class="tb-bake-btn" data-action="bake">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"></path>
                <polyline points="17,21 17,13 7,13 7,21"></polyline>
                <polyline points="7,3 7,8 15,8"></polyline>
              </svg>
              BAKE & SAVE
            </button>
          </div>
        </header>
        
        <!-- Main Area -->
        <div class="tb-main">
          <!-- Canvas Area -->
          <div class="tb-canvas-area">
            <canvas class="tb-canvas"></canvas>
            
            <!-- Circuit Status Indicator -->
            <div class="tb-circuit-status hidden">
              <span class="tb-status-text">CIRCUIT CLOSED</span>
            </div>
            
            <!-- Bottom Toolbar -->
            <div class="tb-toolbar">
              <button class="tb-tool-btn active" data-tool="draw" title="Draw">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
                  <path d="M2 2l7.586 7.586"></path>
                  <circle cx="11" cy="11" r="2"></circle>
                </svg>
                <span>Draw</span>
              </button>
              <button class="tb-tool-btn" data-tool="erase" title="Eraser">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 20H7L3 16a1 1 0 010-1.4l9.6-9.6a2 2 0 012.8 0l4.6 4.6a2 2 0 010 2.8L14 18"></path>
                  <path d="M6.5 13.5L11 18"></path>
                </svg>
                <span>Eraser</span>
              </button>
              <button class="tb-tool-btn" data-tool="pan" title="Pan">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 9l-3 3 3 3"></path>
                  <path d="M9 5l3-3 3 3"></path>
                  <path d="M15 19l-3 3-3-3"></path>
                  <path d="M19 9l3 3-3 3"></path>
                  <path d="M2 12h20"></path>
                  <path d="M12 2v20"></path>
                </svg>
                <span>Pan</span>
              </button>
              <button class="tb-tool-btn" data-action="fit" title="Fit to View">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M8 3H5a2 2 0 00-2 2v3"></path>
                  <path d="M21 8V5a2 2 0 00-2-2h-3"></path>
                  <path d="M3 16v3a2 2 0 002 2h3"></path>
                  <path d="M16 21h3a2 2 0 002-2v-3"></path>
                </svg>
                <span></span>
              </button>
            </div>
          </div>
          
          <!-- Properties Panel Toggle -->
          <button class="tb-panel-toggle" data-action="toggle-panel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
          
          <!-- Properties Panel -->
          <aside class="tb-properties-panel">
            <div class="tb-panel-header">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"></path>
              </svg>
              <span>TRACK PROPERTIES</span>
            </div>
            
            <!-- Track Stats -->
            <div class="tb-stats">
              <div class="tb-stat">
                <span class="tb-stat-label">LENGTH</span>
                <span class="tb-stat-value" data-stat="length">0<small>px</small></span>
              </div>
              <div class="tb-stat">
                <span class="tb-stat-label">TURNS (EST)</span>
                <span class="tb-stat-value" data-stat="turns">0</span>
              </div>
            </div>
            
            <!-- Surface Type -->
            <div class="tb-section">
              <div class="tb-section-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                </svg>
                <span>SURFACE TYPE</span>
              </div>
              <div class="tb-surface-grid">
                ${surfaceButtonsHtml}
              </div>
            </div>
            
            <!-- Road Width Slider -->
            <div class="tb-section">
              <div class="tb-slider-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12H3"></path>
                  <path d="M21 6H3"></path>
                  <path d="M21 18H3"></path>
                </svg>
                <span>ROAD WIDTH</span>
                <span class="tb-slider-value" data-label="roadWidth">${initialVisualWidth}px (visual)</span>
              </div>
              <input type="range" class="tb-slider" data-field="roadWidth" 
                     min="${ROAD_WIDTH_RANGE[0]}" max="${ROAD_WIDTH_RANGE[1]}" 
                     value="${DEFAULT_ROAD_WIDTH}" />
            </div>
            
            <!-- Pro Tips -->
            <div class="tb-tips">
              <p>Pro Tip: Close the loop to enable baking. Use smooth strokes for better racing lines.</p>
            </div>
          </aside>
        </div>
        
        <!-- Close button -->
        <button class="tb-close-btn" data-action="close" title="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;
    
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.container = overlay.querySelector('.track-builder-container');
    this.canvas = overlay.querySelector('.tb-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.circuitStatus = overlay.querySelector('.tb-circuit-status');
    this.trackNameInput = overlay.querySelector('.tb-track-name-input');
    this.roadWidthSlider = overlay.querySelector('[data-field="roadWidth"]');
    this.roadWidthLabel = overlay.querySelector('[data-label="roadWidth"]');
    this.lengthStat = overlay.querySelector('[data-stat="length"]');
    this.turnsStat = overlay.querySelector('[data-stat="turns"]');
    this.propertiesPanel = overlay.querySelector('.tb-properties-panel');
    
    this.resizeCanvas();
  };
  
  TrackBuilder.prototype.resizeCanvas = function() {
    const canvasArea = this.overlay.querySelector('.tb-canvas-area');
    if (!canvasArea) return;
    
    const rect = canvasArea.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    
    this.ctx.scale(dpr, dpr);
    this.displayWidth = rect.width;
    this.displayHeight = rect.height;
    
    this.render();
  };
  
  TrackBuilder.prototype.attachEvents = function() {
    const overlay = this.overlay;
    
    // Close button
    overlay.querySelector('[data-action="close"]').addEventListener('click', () => this.close());
    
    // Escape key
    window.addEventListener('keydown', (e) => {
      if (this.overlay.classList.contains('hidden')) return;
      if (e.key === 'Escape') this.close();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo(); else this.undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      }
    }, { passive: false });
    
    // Header actions
    overlay.querySelector('[data-action="undo"]').addEventListener('click', () => this.undo());
    overlay.querySelector('[data-action="redo"]').addEventListener('click', () => this.redo());
    overlay.querySelector('[data-action="clear"]').addEventListener('click', () => this.clear());
    overlay.querySelector('[data-action="bake"]').addEventListener('click', () => this.bake());
    overlay.querySelector('[data-action="fit"]').addEventListener('click', () => this.fitToView());
    overlay.querySelector('[data-action="toggle-panel"]').addEventListener('click', () => this.togglePanel());
    
    // Tool buttons
    overlay.querySelectorAll('.tb-tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.tb-tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.tool = btn.dataset.tool;
      });
    });
    
    // Surface buttons
    overlay.querySelectorAll('.tb-surface-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.tb-surface-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.surfaceType = btn.dataset.surface;
        this.render();
      });
    });
    
    // Sliders
    this.roadWidthSlider.addEventListener('input', () => {
      const value = clamp(parseFloat(this.roadWidthSlider.value) || DEFAULT_ROAD_WIDTH, ROAD_WIDTH_RANGE[0], ROAD_WIDTH_RANGE[1]);
      this.state.roadWidth = value;
      // Show the visual width that will appear in the race
      const widthScale = readWidthScale();
      const visualWidth = Math.round(value * widthScale);
      this.roadWidthLabel.textContent = visualWidth + 'px (visual)';
      this.render();
    });
    
    // Track name
    this.trackNameInput.addEventListener('input', () => {
      this.state.trackName = this.trackNameInput.value || 'Grand Prix 1';
    });
    
    // Canvas events
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointerleave', (e) => this.onPointerUp(e));
    
    // Wheel for zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      this.state.zoom = clamp(this.state.zoom + delta, 0.25, 4);
      this.render();
    }, { passive: false });
    
    // Resize handler
    window.addEventListener('resize', () => {
      if (!this.overlay.classList.contains('hidden')) {
        this.resizeCanvas();
      }
    });
  };
  
  TrackBuilder.prototype.getCanvasPos = function(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    // Transform by pan and zoom
    return {
      x: (x - this.state.panOffset.x) / this.state.zoom,
      y: (y - this.state.panOffset.y) / this.state.zoom
    };
  };
  
  TrackBuilder.prototype.onPointerDown = function(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.state.pointerId = e.pointerId;
    const pos = this.getCanvasPos(e);
    
    if (this.state.tool === 'draw') {
      if (!this.state.isDrawing) this.pushHistory();
      this.state.isDrawing = true;
      this.addPoint(pos, true);
    } else if (this.state.tool === 'erase') {
      this.eraseAt(pos);
      this.pushHistory();
    } else if (this.state.tool === 'pan') {
      this.state.isPanning = true;
      this.state.panStart = { x: e.clientX, y: e.clientY };
    }
    this.render();
  };
  
  TrackBuilder.prototype.onPointerMove = function(e) {
    if (this.state.pointerId !== e.pointerId) return;
    const pos = this.getCanvasPos(e);
    
    if (this.state.tool === 'draw' && this.state.isDrawing) {
      if (this.state.points.length > 0) {
        const last = this.state.points[this.state.points.length - 1];
        if (distance(last, pos) < SAMPLING_SPACING) return;
      }
      this.addPoint(pos, false);
      this.render();
    } else if (this.state.tool === 'erase' && e.buttons) {
      this.eraseAt(pos);
      this.render();
    } else if (this.state.tool === 'pan' && this.state.isPanning) {
      const dx = e.clientX - this.state.panStart.x;
      const dy = e.clientY - this.state.panStart.y;
      this.state.panOffset.x += dx;
      this.state.panOffset.y += dy;
      this.state.panStart = { x: e.clientX, y: e.clientY };
      this.render();
    }
  };
  
  TrackBuilder.prototype.onPointerUp = function(e) {
    if (this.state.pointerId !== e.pointerId) return;
    
    if (this.state.tool === 'draw' && this.state.isDrawing) {
      this.state.isDrawing = false;
      
      // Post-processing for smooth tracks
      if (this.state.points.length > 10) {
        this.state.points = simplifyPath(this.state.points, 2.0);
        this.state.points = resamplePath(this.state.points, 8);
        this.state.points = relaxPath(this.state.points, 40, 0.5);
        this.state.points = resamplePath(this.state.points, 10);
        const minRadius = this.state.roadWidth * 0.55;
        this.state.points = enforceMinimumRadius(this.state.points, minRadius);
        this.state.points = relaxPath(this.state.points, 10, 0.3);
        this.state.points = ensureClosed(this.state.points, 32);
      }
      
      this.updateCircuitStatus();
      this.pushHistory();
      this.render();
    }
    
    this.state.isPanning = false;
    this.state.panStart = null;
    this.state.pointerId = null;
  };
  
  TrackBuilder.prototype.addPoint = function(point, force) {
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
  
  TrackBuilder.prototype.eraseAt = function(point) {
    const pts = this.state.points;
    if (!pts.length) return;
    const next = pts.filter(p => distance(p, point) > ERASE_RADIUS);
    if (next.length !== pts.length) {
      this.state.points = next;
      this.updateCircuitStatus();
      this.pushHistory();
    }
  };
  
  TrackBuilder.prototype.updateCircuitStatus = function() {
    const pts = this.state.points;
    if (pts.length < MIN_POINTS) {
      this.state.isClosed = false;
      this.circuitStatus.classList.add('hidden');
      return;
    }
    
    const first = pts[0];
    const last = pts[pts.length - 1];
    const isClosed = distance(first, last) < 50;
    this.state.isClosed = isClosed;
    
    if (isClosed) {
      this.circuitStatus.classList.remove('hidden');
    } else {
      this.circuitStatus.classList.add('hidden');
    }
    
    // Update stats
    this.lengthStat.innerHTML = calculateTrackLength(pts) + '<small>px</small>';
    this.turnsStat.textContent = estimateTurns(pts);
  };
  
  TrackBuilder.prototype.undo = function() {
    if (this.state.historyIndex <= 0) return;
    this.state.historyIndex -= 1;
    this.state.points = copyPoints(this.state.history[this.state.historyIndex]);
    this.updateCircuitStatus();
    this.render();
  };
  
  TrackBuilder.prototype.redo = function() {
    if (this.state.historyIndex >= this.state.history.length - 1) return;
    this.state.historyIndex += 1;
    this.state.points = copyPoints(this.state.history[this.state.historyIndex]);
    this.updateCircuitStatus();
    this.render();
  };
  
  TrackBuilder.prototype.clear = function() {
    this.state.points = [];
    this.state.history = [];
    this.state.historyIndex = -1;
    this.state.lastBakeResult = null;
    this.state.isClosed = false;
    this.circuitStatus.classList.add('hidden');
    this.pushHistory();
    this.updateCircuitStatus();
    this.render();
  };
  
  TrackBuilder.prototype.pushHistory = function() {
    const snapshot = copyPoints(this.state.points);
    this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
    this.state.history.push(snapshot);
    this.state.historyIndex = this.state.history.length - 1;
  };
  
  TrackBuilder.prototype.fitToView = function() {
    const pts = this.state.points;
    if (!pts.length) {
      this.state.zoom = 1;
      this.state.panOffset = { x: 0, y: 0 };
      this.render();
      return;
    }
    
    const bbox = boundingBox(pts);
    const padding = 80;
    const trackWidth = bbox.width + padding * 2;
    const trackHeight = bbox.height + padding * 2;
    
    const zoomX = this.displayWidth / trackWidth;
    const zoomY = this.displayHeight / trackHeight;
    this.state.zoom = Math.min(zoomX, zoomY, 2);
    
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;
    
    this.state.panOffset = {
      x: this.displayWidth / 2 - centerX * this.state.zoom,
      y: this.displayHeight / 2 - centerY * this.state.zoom
    };
    
    this.render();
  };
  
  TrackBuilder.prototype.togglePanel = function() {
    this.propertiesPanel.classList.toggle('collapsed');
    const toggle = this.overlay.querySelector('.tb-panel-toggle');
    toggle.classList.toggle('collapsed');
  };
  
  TrackBuilder.prototype.render = function() {
    if (!this.ctx || !this.displayWidth) return;
    
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    // Background
    const surface = SURFACE_TYPES.find(s => s.id === this.state.surfaceType) || SURFACE_TYPES[0];
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);
    
    // Apply zoom and pan
    ctx.translate(this.state.panOffset.x, this.state.panOffset.y);
    ctx.scale(this.state.zoom, this.state.zoom);
    
    // Draw grid
    this.drawGrid(ctx);
    
    // Draw track
    this.drawTrack(ctx, surface);
    
    ctx.restore();
  };
  
  TrackBuilder.prototype.drawGrid = function(ctx) {
    const gridSize = 50;
    const w = this.displayWidth / this.state.zoom + 1000;
    const h = this.displayHeight / this.state.zoom + 1000;
    const offsetX = -this.state.panOffset.x / this.state.zoom;
    const offsetY = -this.state.panOffset.y / this.state.zoom;
    
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1 / this.state.zoom;
    
    const startX = Math.floor(offsetX / gridSize) * gridSize;
    const startY = Math.floor(offsetY / gridSize) * gridSize;
    
    for (let x = startX; x < offsetX + w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + h);
      ctx.stroke();
    }
    
    for (let y = startY; y < offsetY + h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(offsetX, y);
      ctx.lineTo(offsetX + w, y);
      ctx.stroke();
    }
  };
  
  TrackBuilder.prototype.drawTrack = function(ctx, surface) {
    const pts = this.state.points;
    if (!pts.length) return;
    
    // Get the width scale from localStorage to match race appearance
    const widthScale = readWidthScale();
    const visualRoadWidth = this.state.roadWidth * widthScale;
    
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    
    // Track outline (darker edge)
    ctx.lineWidth = visualRoadWidth + 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    if (this.state.isClosed) ctx.closePath();
    ctx.stroke();
    
    // Road surface
    ctx.lineWidth = visualRoadWidth;
    ctx.strokeStyle = surface.roadColor;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    if (this.state.isClosed) ctx.closePath();
    ctx.stroke();
    
    // Center line (dashed)
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    if (this.state.isClosed) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Start marker
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw starting grid when track is closed
    if (this.state.isClosed && pts.length >= 2) {
      this.drawStartingGrid(ctx, pts, visualRoadWidth);
    }
    
    ctx.restore();
  };
  
  // Draw visual representation of car lineup at starting line
  // pts: track centerline points
  // visualRoadWidth: road width scaled by width scale
  TrackBuilder.prototype.drawStartingGrid = function(ctx, pts, visualRoadWidth) {
    if (!pts || pts.length < 2) return;
    
    const first = pts[0];
    const second = pts[1];
    
    // Calculate forward direction (tangent at start)
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const len = Math.hypot(dx, dy) || 1;
    const tangent = { x: dx / len, y: dy / len };
    const normal = { x: -tangent.y, y: tangent.x };
    const angle = Math.atan2(tangent.y, tangent.x);
    
    // Get car profile (use GT as reference)
    // Car dimensions are NOT scaled - they remain at their true pixel size
    // This matches how cars are rendered in the actual race
    const car = DEFAULT_CAR_PROFILE;
    const carWidth = car.width;
    const carLength = car.length;
    
    // Calculate grid layout to match racer.html buildGridSlots logic
    const totalCars = 1 + DEFAULT_AI_CAR_COUNT; // player + AI cars
    
    // Match the slot sizing logic from racer.html buildGridSlots
    const baseWidth = visualRoadWidth;
    const slotWidth = clamp(baseWidth * 0.22, 14, Math.min(baseWidth * 0.5, 48));
    const slotLength = clamp(baseWidth * 0.65, 28, 90);
    const rowGap = Math.max(slotLength * 0.9, 26);
    const startGap = Math.max(slotLength * 0.35, 8);
    const laneSpacing = totalCars === 1 ? 0 : Math.max(slotWidth + 8, Math.min(baseWidth * 0.45, slotWidth * 1.8));
    const columns = totalCars === 1 ? 1 : 2;
    const lateralOffsets = columns === 1 ? [0] : [-laneSpacing * 0.5, laneSpacing * 0.5];
    
    ctx.save();
    
    // Draw start/finish line
    const halfWidth = visualRoadWidth * 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(first.x + normal.x * halfWidth, first.y + normal.y * halfWidth);
    ctx.lineTo(first.x - normal.x * halfWidth, first.y - normal.y * halfWidth);
    ctx.stroke();
    
    // Draw checkered pattern on start line
    const checkSize = 8;
    const numChecks = Math.floor(visualRoadWidth / checkSize);
    for (let i = 0; i < numChecks; i++) {
      const offset = -halfWidth + (i + 0.5) * (visualRoadWidth / numChecks);
      const px = first.x + normal.x * offset;
      const py = first.y + normal.y * offset;
      if (i % 2 === 0) {
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.fillStyle = '#1a1a1a';
      }
      ctx.beginPath();
      ctx.arc(px, py, checkSize * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Draw cars in grid formation
    const colors = ["#3949ab", "#1e88e5", "#43a047", "#f4511e", "#8e24aa", "#00897b", "#fdd835", "#f97316", "#00acc1", "#c0ca33"];
    
    for (let i = 0; i < Math.min(totalCars, 10); i++) {
      const row = Math.floor(i / columns);
      const column = columns === 1 ? 0 : (i % columns);
      
      // Position car behind the start line, matching racer.html logic
      const forwardOffset = -(row * rowGap + slotLength * 0.6 + startGap);
      const lateralOffset = lateralOffsets[column] || 0;
      
      const carX = first.x - tangent.x * (-forwardOffset) + normal.x * lateralOffset;
      const carY = first.y - tangent.y * (-forwardOffset) + normal.y * lateralOffset;
      
      // Draw car body
      ctx.save();
      ctx.translate(carX, carY);
      ctx.rotate(angle);
      
      // Car shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-carLength / 2 + 2, -carWidth / 2 + 2, carLength, carWidth);
      
      // Car body
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(-carLength / 2, -carWidth / 2, carLength, carWidth);
      
      // Windshield area (darker)
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(carLength * 0.1, -carWidth / 2 + 3, carLength * 0.25, carWidth - 6);
      
      // Highlight stripe
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(-carLength / 2, -2, carLength, 4);
      
      // Player indicator (first car)
      if (i === 0) {
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        ctx.strokeRect(-carLength / 2 - 2, -carWidth / 2 - 2, carLength + 4, carWidth + 4);
      }
      
      ctx.restore();
    }
    
    // Draw "START" label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelOffset = halfWidth + 20;
    ctx.fillText('START', first.x + normal.x * labelOffset, first.y + normal.y * labelOffset);
    
    ctx.restore();
  };
  
  TrackBuilder.prototype.open = function() {
    this.overlay.classList.remove('hidden');
    setTimeout(() => this.resizeCanvas(), 50);
  };
  
  TrackBuilder.prototype.close = function() {
    this.overlay.classList.add('hidden');
    this.state.isDrawing = false;
    this.state.isPanning = false;
    this.state.pointerId = null;
    this.onClose();
  };
  
  TrackBuilder.prototype.reset = function() {
    this.state.points = [];
    this.state.history = [];
    this.state.historyIndex = -1;
    this.state.lastBakeResult = null;
    this.state.isClosed = false;
    this.state.panOffset = { x: 0, y: 0 };
    this.state.zoom = 1;
    this.state.roadWidth = DEFAULT_ROAD_WIDTH;
    this.state.surfaceType = 'tarmac-pro';
    this.state.trackName = 'Grand Prix 1';
    
    this.roadWidthSlider.value = DEFAULT_ROAD_WIDTH;
    // Show the visual width that will appear in the race
    const widthScale = readWidthScale();
    const visualWidth = Math.round(DEFAULT_ROAD_WIDTH * widthScale);
    this.roadWidthLabel.textContent = visualWidth + 'px (visual)';
    this.trackNameInput.value = this.state.trackName;
    
    this.overlay.querySelectorAll('.tb-surface-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.surface === 'tarmac-pro');
    });
    
    this.circuitStatus.classList.add('hidden');
    this.pushHistory();
    this.updateCircuitStatus();
    this.render();
  };
  
  TrackBuilder.prototype.bake = async function() {
    if (!this.state.isClosed) {
      alert('Please close the circuit loop before baking.');
      return;
    }
    
    if (this.state.points.length < MIN_POINTS) {
      alert('Need more detail. Draw a longer loop before baking.');
      return;
    }
    
    const name = this.state.trackName || 'Custom Circuit';
    const closedRaw = ensureClosed(copyPoints(this.state.points));
    const roadWidth = this.state.roadWidth;
    
    // Processing pipeline
    let processed = simplifyPath(closedRaw, 2.0);
    processed = resamplePath(processed, 8);
    processed = relaxPath(processed, 60, 0.5);
    processed = resamplePath(processed, 8);
    const minTurnRadius = roadWidth * 0.55;
    processed = enforceMinimumRadius(processed, minTurnRadius, 300);
    processed = resamplePath(processed, SAMPLING_SPACING);
    processed = relaxPath(processed, 15, 0.3);
    
    const intersections = findSelfIntersections(processed);
    
    const bbox = boundingBox(processed);
    const worldWidth = Math.round(bbox.width + roadWidth * 4);
    const worldHeight = Math.round(bbox.height + roadWidth * 4);
    
    // Offset points to fit in world
    const offsetX = -bbox.minX + roadWidth * 2;
    const offsetY = -bbox.minY + roadWidth * 2;
    const offsetPoints = processed.map(p => ({ x: p.x + offsetX, y: p.y + offsetY }));
    
    const meta = computeTrackMeta(offsetPoints, roadWidth);
    const mask = makeMask(offsetPoints, roadWidth, worldWidth, worldHeight);
    const thumbnail = makeThumbnail(offsetPoints, worldWidth, worldHeight);
    const racingLine = (window.RacerAI && typeof window.RacerAI.buildRacingLine === 'function')
      ? window.RacerAI.buildRacingLine(offsetPoints, roadWidth)
      : [];
    
    const data = {
      name,
      world: { width: worldWidth, height: worldHeight },
      points: offsetPoints,
      roadWidth,
      textureId: this.state.surfaceType,
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
    
    await TrackStore.saveTrack(entry);
    this.state.lastBakeResult = entry;
    
    const msg = intersections.length
      ? `${name} saved with ${intersections.length} warning${intersections.length > 1 ? 's' : ''}.`
      : `${name} saved and ready to race!`;
    alert(msg);
    
    this.onSaved(entry);
    this.close();
  };
  
  // ===== Factory =====
  function create(options) {
    return new TrackBuilder(options);
  }
  
  global.TrackBuilder = { create };
  
})(typeof window !== 'undefined' ? window : this);
