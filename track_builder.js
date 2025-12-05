(function(global){
  const GRID_SPACING = 40;
  const MIN_POINTS = 32;
  const DEFAULT_ROAD_WIDTH = 80;
  const DEFAULT_SCALE = 1.0;
  const DEFAULT_TEXTURE = 'default';
  const ROAD_WIDTH_RANGE = [40, 180];
  const SCALE_RANGE = [0.6, 2.5];
  const ERASE_RADIUS = 24;
  const SAMPLING_SPACING = 10;
  
  // Canvas and world coordinate system
  const BASE_WORLD_WIDTH = 960;
  const BASE_WORLD_HEIGHT = 640;
  
  // Smoothing algorithm constants
  const MAX_RADIUS_ENFORCEMENT_ITERATIONS = 200;
  const MAX_BLEND_STRENGTH = 0.7;
  const BLEND_SCALE_FACTOR = 0.3;

  // Track texture options available in the builder
  const TEXTURE_OPTIONS = [
    { id: 'default', name: 'Standard' },
    { id: 'vintage', name: 'Vintage Circuit' },
    { id: 'modern', name: 'Modern GP' },
    { id: 'night', name: 'Night Race' }
  ];

  function clamp(v, min, max){ return Math.min(max, Math.max(min, v)); }

  function distance(a, b){
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function copyPoints(points){
    return points.map((p) => ({ x: p.x, y: p.y }));
  }

  function ensureClosed(points, tolerance = 12){
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

  function simplifyPath(points, tolerance){
    if (points.length < 3) return points;
    const closed = ensureClosed(points);
    const pts = closed.slice(0, -1);
    const result = rdpSimplify(pts, tolerance);
    result.push({ ...result[0] });
    return result;
  }

  function rdpSimplify(points, epsilon){
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

  function pointLineDistance(point, a, b){
    const num = Math.abs((b.y - a.y) * point.x - (b.x - a.x) * point.y + b.x * a.y - b.y * a.x);
    const den = Math.hypot(b.y - a.y, b.x - a.x) || 1;
    return num / den;
  }

  function smoothPath(points, iterations){
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

  function enforceMinimumRadius(points, minRadius, maxIterations = MAX_RADIUS_ENFORCEMENT_ITERATIONS) {
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
          
          const blend = Math.min(MAX_BLEND_STRENGTH, BLEND_SCALE_FACTOR * violation);
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

  function resamplePath(points, spacing){
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

  function segmentIntersection(a1, a2, b1, b2){
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

  function findSelfIntersections(points){
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

  function normalFromSegment(a, b){
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  }

  function tangentFromSegment(a, b){
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len, len };
  }

  function computeTrackMeta(centerline, roadWidth){
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

  function boundingBox(points){
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function buildCheckpoints(centerline, roadWidth){
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

  function makeMask(centerline, roadWidth, worldWidth, worldHeight){
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

  function makeThumbnail(centerline, worldWidth, worldHeight){
    const thumb = document.createElement("canvas");
    const THUMB_W = 320;
    const aspect = worldWidth / worldHeight || 1;
    const THUMB_H = Math.round(THUMB_W / aspect);
    thumb.width = THUMB_W;
    thumb.height = THUMB_H;
    const ctx = thumb.getContext("2d");
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, thumb.width, thumb.height);
    const scaleX = thumb.width / worldWidth;
    const scaleY = thumb.height / worldHeight;
    ctx.save();
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = Math.max(2, (thumb.width / worldWidth) * 6);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < centerline.length; i++) {
      const p = centerline[i];
      const x = p.x * scaleX;
      const y = p.y * scaleY;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    return {
      width: thumb.width,
      height: thumb.height,
      pngData: thumb.toDataURL("image/png")
    };
  }

  function TrackBuilder(options){
    this.options = options || {};
    this.onSaved = typeof options.onSaved === "function" ? options.onSaved : () => {};
    this.onTestDrive = typeof options.onTestDrive === "function" ? options.onTestDrive : () => {};
    this.onClose = typeof options.onClose === "function" ? options.onClose : () => {};
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

  TrackBuilder.prototype.init = function(){
    this.buildUI();
    this.attachEvents();
    this.pushHistory();
  };

  TrackBuilder.prototype.buildUI = function(){
    const textureOptionsHtml = TEXTURE_OPTIONS.map(opt => 
      `<option value="${opt.id}"${opt.id === DEFAULT_TEXTURE ? ' selected' : ''}>${opt.name}</option>`
    ).join('');

    const container = document.createElement("div");
    container.className = "track-builder-fullscreen hidden";
    container.innerHTML = `
      <div class="tb-layout">
        <!-- Left Sidebar -->
        <aside class="tb-sidebar">
          <div class="tb-sidebar-header">
            <div class="tb-logo">
              <span class="tb-logo-icon">🛤️</span>
              <span class="tb-logo-text">Track Builder</span>
            </div>
            <button type="button" class="tb-close-btn" data-action="close" aria-label="Close">×</button>
          </div>
          
          <div class="tb-sidebar-content">
            <!-- Track Name -->
            <div class="tb-section">
              <label class="tb-label">Track Name</label>
              <input type="text" class="tb-input" data-field="name" placeholder="My Custom Circuit" maxlength="48" />
            </div>
            
            <!-- Drawing Tools -->
            <div class="tb-section">
              <label class="tb-label">Tools</label>
              <div class="tb-tool-grid">
                <button type="button" class="tb-tool-btn active" data-tool="pen" title="Pen Tool">
                  <span class="tb-tool-icon">✏️</span>
                  <span class="tb-tool-name">Draw</span>
                </button>
                <button type="button" class="tb-tool-btn" data-tool="erase" title="Eraser">
                  <span class="tb-tool-icon">🧹</span>
                  <span class="tb-tool-name">Erase</span>
                </button>
              </div>
            </div>
            
            <!-- Edit Actions -->
            <div class="tb-section">
              <label class="tb-label">Edit</label>
              <div class="tb-action-row">
                <button type="button" class="tb-action-btn" data-action="undo" title="Undo (Ctrl+Z)">
                  <span>↶</span> Undo
                </button>
                <button type="button" class="tb-action-btn" data-action="redo" title="Redo (Ctrl+Y)">
                  <span>↷</span> Redo
                </button>
              </div>
              <button type="button" class="tb-action-btn tb-action-danger" data-action="clear">
                <span>🗑️</span> Clear All
              </button>
            </div>
            
            <!-- Track Settings -->
            <div class="tb-section">
              <label class="tb-label">Track Settings</label>
              
              <div class="tb-slider-group">
                <div class="tb-slider-header">
                  <span>Road Width</span>
                  <span class="tb-slider-value" data-label="roadWidth">${DEFAULT_ROAD_WIDTH}</span>
                </div>
                <input type="range" class="tb-slider" min="${ROAD_WIDTH_RANGE[0]}" max="${ROAD_WIDTH_RANGE[1]}" value="${DEFAULT_ROAD_WIDTH}" step="1" data-field="roadWidth" />
              </div>
              
              <div class="tb-slider-group">
                <div class="tb-slider-header">
                  <span>World Scale</span>
                  <span class="tb-slider-value" data-label="scale">${DEFAULT_SCALE.toFixed(2)}x</span>
                </div>
                <input type="range" class="tb-slider" min="${SCALE_RANGE[0]}" max="${SCALE_RANGE[1]}" value="${DEFAULT_SCALE}" step="0.01" data-field="scale" />
              </div>
              
              <div class="tb-select-group">
                <span>Track Texture</span>
                <select class="tb-select" data-field="texture">
                  ${textureOptionsHtml}
                </select>
              </div>
            </div>
          </div>
          
          <!-- Sidebar Footer -->
          <div class="tb-sidebar-footer">
            <div class="tb-status" aria-live="polite"></div>
            
            <div class="tb-primary-actions">
              <button type="button" class="tb-btn tb-btn-secondary" data-action="export">
                <span>📦</span> Export
              </button>
              <button type="button" class="tb-btn tb-btn-primary" data-action="bake">
                <span>💾</span> Save Track
              </button>
            </div>
            
            <div class="tb-test-actions hidden" data-test-actions>
              <div class="tb-test-label">Test your track:</div>
              <button type="button" class="tb-btn tb-btn-success" data-action="test-grip">
                <span>🏎️</span> Test Drive
              </button>
            </div>
          </div>
        </aside>
        
        <!-- Main Canvas Area -->
        <main class="tb-main">
          <div class="tb-canvas-container">
            <canvas class="tb-canvas"></canvas>
            <div class="tb-canvas-overlay">
              <div class="tb-instructions">
                <span class="tb-instructions-icon">✏️</span>
                <span>Draw a closed loop to create your track</span>
              </div>
            </div>
          </div>
          
          <!-- Mini Info Bar -->
          <div class="tb-info-bar">
            <div class="tb-info-item">
              <span class="tb-info-label">Points:</span>
              <span class="tb-info-value" data-info="points">0</span>
            </div>
            <div class="tb-info-item">
              <span class="tb-info-label">Tool:</span>
              <span class="tb-info-value" data-info="tool">Draw</span>
            </div>
            <div class="tb-info-item tb-info-hint">
              <span>💡 Tip: Draw a complete loop and click "Save Track"</span>
            </div>
          </div>
        </main>
      </div>
    `;
    document.body.appendChild(container);
    this.container = container;
    this.canvas = container.querySelector(".tb-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.statusEl = container.querySelector(".tb-status");
    this.nameInput = container.querySelector('[data-field="name"]');
    this.roadWidthInput = container.querySelector('[data-field="roadWidth"]');
    this.scaleInput = container.querySelector('[data-field="scale"]');
    this.textureSelect = container.querySelector('[data-field="texture"]');
    this.roadWidthLabel = container.querySelector('[data-label="roadWidth"]');
    this.scaleLabel = container.querySelector('[data-label="scale"]');
    this.testActions = container.querySelector("[data-test-actions]");
    this.canvasOverlay = container.querySelector(".tb-canvas-overlay");
    this.pointsInfo = container.querySelector('[data-info="points"]');
    this.toolInfo = container.querySelector('[data-info="tool"]');
    
    this.resizeCanvas();
  };

  TrackBuilder.prototype.resizeCanvas = function(){
    const containerRect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = containerRect.width;
    const height = containerRect.height;
    
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.ctx.scale(dpr, dpr);
    
    this.displayWidth = width;
    this.displayHeight = height;
    
    this.render();
  };

  TrackBuilder.prototype.attachEvents = function(){
    const container = this.container;
    
    // Close button
    container.querySelector('[data-action="close"]').addEventListener("click", () => this.close());
    container.querySelector('[data-action="undo"]').addEventListener("click", () => this.undo());
    container.querySelector('[data-action="redo"]').addEventListener("click", () => this.redo());
    container.querySelector('[data-action="clear"]').addEventListener("click", () => this.clear());
    container.querySelector('[data-action="bake"]').addEventListener("click", () => this.bake());
    container.querySelector('[data-action="export"]').addEventListener("click", () => this.exportBundle());
    container.querySelector('[data-action="test-grip"]').addEventListener("click", () => this.testDrive("grip"));

    // Tool buttons
    const toolButtons = container.querySelectorAll(".tb-tool-btn");
    toolButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        toolButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.state.tool = btn.dataset.tool;
        this.toolInfo.textContent = btn.dataset.tool === 'pen' ? 'Draw' : 'Erase';
      });
    });

    // Sliders
    this.roadWidthInput.addEventListener("input", () => {
      const value = clamp(parseFloat(this.roadWidthInput.value) || DEFAULT_ROAD_WIDTH, ROAD_WIDTH_RANGE[0], ROAD_WIDTH_RANGE[1]);
      this.state.roadWidth = value;
      this.roadWidthLabel.textContent = value.toFixed(0);
      this.render();
    });

    this.scaleInput.addEventListener("input", () => {
      const value = clamp(parseFloat(this.scaleInput.value) || DEFAULT_SCALE, SCALE_RANGE[0], SCALE_RANGE[1]);
      this.state.scale = value;
      this.scaleLabel.textContent = value.toFixed(2) + 'x';
    });

    this.textureSelect.addEventListener("change", () => {
      this.state.textureId = this.textureSelect.value || DEFAULT_TEXTURE;
    });

    // Canvas events
    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.canvas.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    this.canvas.addEventListener("pointerleave", (e) => this.onPointerUp(e));

    // Keyboard shortcuts
    this.keyHandler = (e) => {
      if (this.container.classList.contains("hidden")) return;
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
    };
    window.addEventListener("keydown", this.keyHandler, { passive: false });

    // Window resize
    this.resizeHandler = () => {
      if (!this.container.classList.contains("hidden")) {
        this.resizeCanvas();
      }
    };
    window.addEventListener("resize", this.resizeHandler);
  };

  TrackBuilder.prototype.open = function(){
    this.container.classList.remove("hidden");
    document.body.style.overflow = 'hidden';
    this.resizeCanvas();
    this.render();
  };

  TrackBuilder.prototype.close = function(){
    this.container.classList.add("hidden");
    document.body.style.overflow = '';
    this.state.isDrawing = false;
    this.state.pointerId = null;
    this.onClose();
  };

  TrackBuilder.prototype.reset = function(){
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
    this.scaleLabel.textContent = DEFAULT_SCALE.toFixed(2) + 'x';
    this.state.roadWidth = DEFAULT_ROAD_WIDTH;
    this.state.scale = DEFAULT_SCALE;
    this.state.textureId = DEFAULT_TEXTURE;
    this.nameInput.value = "";
    this.pushHistory();
    this.updateInfo();
    this.render();
  };

  TrackBuilder.prototype.onPointerDown = function(e){
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const pos = this.getCanvasPos(e);
    this.state.pointerId = e.pointerId;
    
    // Hide instructions overlay on first draw
    if (this.canvasOverlay) {
      this.canvasOverlay.classList.add("hidden");
    }
    
    if (this.state.tool === "pen") {
      if (!this.state.isDrawing) this.pushHistory();
      this.state.isDrawing = true;
      this.addPoint(pos, true);
    } else if (this.state.tool === "erase") {
      this.eraseAt(pos);
      this.pushHistory();
    }
    this.updateInfo();
    this.render();
  };

  TrackBuilder.prototype.onPointerMove = function(e){
    if (this.state.pointerId !== e.pointerId) return;
    const pos = this.getCanvasPos(e);
    if (this.state.tool === "pen" && this.state.isDrawing) {
      if (this.state.points.length > 0) {
        const last = this.state.points[this.state.points.length - 1];
        if (distance(last, pos) < SAMPLING_SPACING) return;
      }
      this.addPoint(pos, false);
      this.updateInfo();
      this.render();
    } else if (this.state.tool === "erase" && e.buttons) {
      this.eraseAt(pos);
      this.updateInfo();
      this.render();
    }
  };

  TrackBuilder.prototype.onPointerUp = function(e){
    if (this.state.pointerId !== e.pointerId) return;
    if (this.state.tool === "pen" && this.state.isDrawing) {
      this.state.isDrawing = false;

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

      this.pushHistory();
      this.updateInfo();
      this.render();
    }
    this.state.pointerId = null;
  };

  TrackBuilder.prototype.getCanvasPos = function(e){
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    return { x, y };
  };

  TrackBuilder.prototype.addPoint = function(point, force){
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

  TrackBuilder.prototype.eraseAt = function(point){
    const pts = this.state.points;
    if (!pts.length) return;
    const next = pts.filter((p) => distance(p, point) > ERASE_RADIUS);
    if (next.length !== pts.length) {
      this.state.points = next;
      this.pushHistory();
    }
  };

  TrackBuilder.prototype.undo = function(){
    if (this.state.historyIndex <= 0) return;
    this.state.historyIndex -= 1;
    this.state.points = copyPoints(this.state.history[this.state.historyIndex]);
    this.updateInfo();
    this.render();
  };

  TrackBuilder.prototype.redo = function(){
    if (this.state.historyIndex >= this.state.history.length - 1) return;
    this.state.historyIndex += 1;
    this.state.points = copyPoints(this.state.history[this.state.historyIndex]);
    this.updateInfo();
    this.render();
  };

  TrackBuilder.prototype.clear = function(){
    this.state.points = [];
    this.state.history = [];
    this.state.historyIndex = -1;
    this.state.lastBakeResult = null;
    this.testActions.classList.add("hidden");
    this.setStatus("", "");
    this.pushHistory();
    this.updateInfo();
    this.render();
    
    // Show instructions overlay again
    if (this.canvasOverlay) {
      this.canvasOverlay.classList.remove("hidden");
    }
  };

  TrackBuilder.prototype.pushHistory = function(){
    const snapshot = copyPoints(this.state.points);
    this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
    this.state.history.push(snapshot);
    this.state.historyIndex = this.state.history.length - 1;
  };

  TrackBuilder.prototype.updateInfo = function(){
    if (this.pointsInfo) {
      this.pointsInfo.textContent = this.state.points.length;
    }
  };

  TrackBuilder.prototype.render = function(){
    const ctx = this.ctx;
    const width = this.displayWidth;
    const height = this.displayHeight;
    
    ctx.clearRect(0, 0, width, height);
    
    // Background
    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(0, 0, width, height);
    
    // Grid
    this.drawGrid(ctx, width, height);
    
    // Track path
    this.drawPath(ctx);
  };

  TrackBuilder.prototype.drawGrid = function(ctx, width, height){
    ctx.save();
    ctx.strokeStyle = "rgba(148,163,184,0.08)";
    ctx.lineWidth = 1;
    
    for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  TrackBuilder.prototype.drawPath = function(ctx){
    const pts = this.state.points;
    if (!pts.length) return;
    
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    
    // Road preview (semi-transparent)
    ctx.lineWidth = this.state.roadWidth * 0.5;
    ctx.strokeStyle = "rgba(59, 130, 246, 0.25)";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    if (pts.length > 2) ctx.closePath();
    ctx.stroke();
    
    // Center line
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#3b82f6";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    if (pts.length > 2) ctx.closePath();
    ctx.stroke();
    
    // Start point marker
    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Start point label
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("S", pts[0].x, pts[0].y);
    
    ctx.restore();
  };

  TrackBuilder.prototype.setStatus = function(message, tone){
    this.statusEl.textContent = message || "";
    this.statusEl.dataset.tone = tone || "";
  };

  TrackBuilder.prototype.validate = function(){
    if (this.state.points.length < MIN_POINTS) {
      throw new Error("Draw a longer loop before saving.");
    }
  };

  TrackBuilder.prototype.bake = async function(){
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
    
    // Scale points to match canvas size to world size
    const canvasWidth = this.displayWidth;
    const canvasHeight = this.displayHeight;
    
    const scaleX = BASE_WORLD_WIDTH / canvasWidth;
    const scaleY = BASE_WORLD_HEIGHT / canvasHeight;
    
    let processed = closedRaw.map(p => ({
      x: p.x * scaleX,
      y: p.y * scaleY
    }));
    
    processed = simplifyPath(processed, 2.0);
    processed = resamplePath(processed, 8);
    processed = relaxPath(processed, 60, 0.5);
    processed = resamplePath(processed, 8);
    
    const minTurnRadius = roadWidth * 0.55;
    processed = enforceMinimumRadius(processed, minTurnRadius, 300);
    
    processed = resamplePath(processed, SAMPLING_SPACING);
    processed = relaxPath(processed, 15, 0.3);
    
    const intersections = findSelfIntersections(processed);
    const scaled = processed.map((p) => ({
      x: p.x * this.state.scale,
      y: p.y * this.state.scale
    }));
    
    const worldWidth = Math.round(BASE_WORLD_WIDTH * this.state.scale);
    const worldHeight = Math.round(BASE_WORLD_HEIGHT * this.state.scale);
    const meta = computeTrackMeta(scaled, roadWidth);
    const mask = makeMask(scaled, roadWidth, worldWidth, worldHeight);
    const thumbnail = makeThumbnail(scaled, worldWidth, worldHeight);
    
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
      `"${name}" saved! Warning: ${intersections.length} self-intersection${intersections.length > 1 ? "s" : ""}.` :
      `"${name}" saved successfully!`;
    this.setStatus(msg, intersections.length ? "warn" : "success");
    this.onSaved(entry);
  };

  TrackBuilder.prototype.exportBundle = function(){
    if (this.state.lastBakeResult) {
      TrackStore.downloadBundle(this.state.lastBakeResult);
      return;
    }
    this.setStatus("Save the track before exporting.", "info");
  };

  TrackBuilder.prototype.testDrive = function(mode){
    if (!this.state.lastBakeResult) {
      this.setStatus("Save the track first.", "info");
      return;
    }
    this.onTestDrive(mode, this.state.lastBakeResult);
  };

  function create(options){
    return new TrackBuilder(options);
  }

  global.TrackBuilder = { create };
})(typeof window !== "undefined" ? window : this);
