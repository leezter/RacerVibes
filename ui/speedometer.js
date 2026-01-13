(function () {
  // Prefer shared RacerVibes helpers when they are already on the page.
  const Utils = window.RacerUtils || {};
  const clamp = Utils.clamp ? (v, a, b) => Utils.clamp(v, a, b) : (v, a, b) => Math.max(a, Math.min(b, v));
  const toRad = Utils.toRad ? (deg) => Utils.toRad(deg) : (deg) => (deg * Math.PI) / 180;
  const makeOnce = Utils.once
    ? (fn) => Utils.once(fn)
    : (fn) => {
      let called = false;
      return (...args) => {
        if (called) return;
        called = true;
        return fn(...args);
      };
    };
  const NS = 'http://www.w3.org/2000/svg';
  function polar(cx, cy, r, a) { a = toRad(a); return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function arcPath(cx, cy, r, a0, a1) {
    const [sx, sy] = polar(cx, cy, r, a0), [ex, ey] = polar(cx, cy, r, a1);
    const sw = ((a1 - a0 + 360) % 360), lg = sw > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${r} ${r} 0 ${lg} 1 ${ex} ${ey}`;
  }
  function blendHex(a, b, t) {
    const toRGB = h => {
      h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
      const n = parseInt(h, 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: (n & 255) };
    };
    const toHex = (r, g, bb) => '#' + [r, g, bb].map(x => x.toString(16).padStart(2, '0')).join('');
    const A = toRGB(a), B = toRGB(b);
    return toHex(
      Math.round(A.r + (B.r - A.r) * t),
      Math.round(A.g + (B.g - A.g) * t),
      Math.round(A.b + (B.b - A.b) * t)
    );
  }

  // Responsive speedometer: scales with viewport width, positioned lower on screen
  const defaults = { width: 200, bottomOffset: 40, mphMax: 180, smoothing: 0.18 };

  // Inject responsive styles for speedometer (only once)
  const injectSpeedoStyles = (() => {
    let injected = false;
    return () => {
      if (injected) return;
      injected = true;
      const style = document.createElement('style');
      style.textContent = `
        #rv-speedometer svg {
          width: clamp(240px, 26vw, 380px) !important;
        }
        /* Tablet and smaller */
        @media (max-width: 1024px) {
          #rv-speedometer svg {
            width: clamp(170px, 22vw, 240px) !important;
          }
        }
        /* Mobile landscape and smaller */
        @media (max-width: 768px) {
          #rv-speedometer svg {
            width: 130px !important;
          }
        }
        /* Small mobile */
        @media (max-width: 480px) {
          #rv-speedometer svg {
            width: 110px !important;
          }
        }
        /* Very small or low height (mobile landscape) */
        @media (max-height: 500px) {
          #rv-speedometer svg {
            width: 100px !important;
          }
        }
      `;
      document.head.appendChild(style);
    };
  })();

  function buildGauge(root, width) {
    injectSpeedoStyles();
    const W = width, H = width; // square viewbox
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 600 600');
    // Base size - will be overridden by media queries above
    svg.style.width = '280px';
    svg.style.height = 'auto';
    svg.style.display = 'block';

    const defs = document.createElementNS(NS, 'defs');
    const grad = document.createElementNS(NS, 'linearGradient'); grad.id = 'revGradient';
    grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '0%');
    const st1 = document.createElementNS(NS, 'stop'); const st2 = document.createElementNS(NS, 'stop'); const st3 = document.createElementNS(NS, 'stop');
    st1.setAttribute('offset', '0%'); st2.setAttribute('offset', '60%'); st3.setAttribute('offset', '100%');
    [st1, st2, st3].forEach(s => s.setAttribute('stop-color', '#26e0b4'));
    grad.appendChild(st1); grad.appendChild(st2); grad.appendChild(st3);
    const filt = document.createElementNS(NS, 'filter'); filt.id = 'softGlow';
    filt.setAttribute('x', '-50%'); filt.setAttribute('y', '-50%');
    filt.setAttribute('width', '200%'); filt.setAttribute('height', '200%');
    const blur = document.createElementNS(NS, 'feGaussianBlur'); blur.setAttribute('stdDeviation', '6'); blur.setAttribute('result', 'blur');
    const merge = document.createElementNS(NS, 'feMerge'); const n1 = document.createElementNS(NS, 'feMergeNode'); n1.setAttribute('in', 'blur');
    const n2 = document.createElementNS(NS, 'feMergeNode'); n2.setAttribute('in', 'SourceGraphic');
    merge.appendChild(n1); merge.appendChild(n2); filt.appendChild(blur); filt.appendChild(merge);
    defs.appendChild(grad); defs.appendChild(filt); svg.appendChild(defs);

    const cx = 300, cy = 340;
    const baseStart = 210, baseEnd = -30;
    const overshootStart = 26, overshootEnd = 64;
    const trackStart = baseStart - overshootStart, trackEnd = baseEnd + overshootEnd;
    const trackSweep = ((trackEnd - trackStart + 360) % 360);
    const mphGapStart = 8, mphGapEnd = 10;
    const tickStart = trackStart + mphGapStart, tickEnd = trackEnd - mphGapEnd, tickSweep = ((tickEnd - tickStart + 360) % 360);
    const outerR = 220, trackW = 30, tickOuterR = 182, labelR = 142;

    const bg = document.createElementNS(NS, 'path');
    bg.setAttribute('d', arcPath(cx, cy, outerR, trackStart, trackStart + trackSweep));
    bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', '#0f1116');
    bg.setAttribute('stroke-width', trackW); bg.setAttribute('stroke-linecap', 'round');
    svg.appendChild(bg);

    const progress = document.createElementNS(NS, 'path');
    progress.setAttribute('fill', 'none'); progress.setAttribute('stroke', 'url(#revGradient)');
    progress.setAttribute('stroke-width', trackW); progress.setAttribute('stroke-linecap', 'round');
    progress.setAttribute('filter', 'url(#softGlow)');
    svg.appendChild(progress);

    const knob = document.createElementNS(NS, 'circle');
    knob.setAttribute('r', trackW * 0.5); knob.setAttribute('fill', 'url(#revGradient)');
    knob.setAttribute('filter', 'url(#softGlow)'); svg.appendChild(knob);

    for (let v = 0; v <= 180; v += 10) {
      const t = v / 180, a = tickStart + tickSweep * t;
      const major = v % 20 === 0, len = major ? 22 : 12;
      const r1 = tickOuterR, r2 = r1 - len;
      const ln = document.createElementNS(NS, 'line');
      const [x1, y1] = polar(cx, cy, r1, a), [x2, y2] = polar(cx, cy, r2, a);
      ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
      ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
      ln.setAttribute('stroke', major ? '#a3a3a3' : '#6b7280');
      ln.setAttribute('stroke-width', '3'); ln.setAttribute('stroke-linecap', 'round'); ln.setAttribute('opacity', '.9');
      svg.appendChild(ln);
    }
    for (let v = 0; v <= 180; v += 20) {
      const t = v / 180, a = tickStart + tickSweep * t;
      const [tx, ty] = polar(cx, cy, labelR, a);
      const txEl = document.createElementNS(NS, 'text');
      txEl.setAttribute('x', tx); txEl.setAttribute('y', ty);
      txEl.setAttribute('fill', '#cbd5e1'); txEl.setAttribute('font-size', '18');
      txEl.setAttribute('text-anchor', 'middle'); txEl.setAttribute('dominant-baseline', 'middle');
      txEl.textContent = String(v); svg.appendChild(txEl);
    }

    const gearText = document.createElementNS(NS, 'text');
    gearText.setAttribute('x', cx); gearText.setAttribute('y', cy - 6);
    gearText.setAttribute('text-anchor', 'middle'); gearText.setAttribute('font-size', '96');
    gearText.setAttribute('font-weight', '700'); gearText.setAttribute('fill', '#9bd6ff'); gearText.textContent = '1';
    svg.appendChild(gearText);

    const sub = document.createElementNS(NS, 'text');
    sub.setAttribute('x', cx); sub.setAttribute('y', cy + 34);
    sub.setAttribute('text-anchor', 'middle'); sub.setAttribute('font-size', '15');
    sub.setAttribute('letter-spacing', '3'); sub.setAttribute('fill', '#9ca3af');
    sub.textContent = 'GEAR'; svg.appendChild(sub);

    const needle = document.createElementNS(NS, 'line');
    needle.setAttribute('stroke', '#9bd6ff'); needle.setAttribute('stroke-width', '4');
    needle.setAttribute('stroke-linecap', 'round'); needle.setAttribute('filter', 'url(#softGlow)');
    needle.setAttribute('opacity', '0.95'); svg.appendChild(needle);

    const needleTip = document.createElementNS(NS, 'circle');
    needleTip.setAttribute('r', '6'); needleTip.setAttribute('fill', '#9bd6ff');
    needleTip.setAttribute('filter', 'url(#softGlow)'); svg.appendChild(needleTip);

    const hub = document.createElementNS(NS, 'circle');
    hub.setAttribute('cx', cx); hub.setAttribute('cy', cy); hub.setAttribute('r', '8');
    hub.setAttribute('fill', '#111827'); hub.setAttribute('stroke', '#374151'); hub.setAttribute('stroke-width', '2');
    svg.appendChild(hub);

    function setGradientAuto(p) {
      p = clamp(p, 0, 1);
      const low = ["#26e0b4", "#45c2ff", "#2aa7ff"], mid = ["#2fe2c6", "#5f7cff", "#9c6bff"], high = ["#35d3ff", "#ff5bbd", "#ff3e8a"];
      const centerLow = "#7dd3fc", centerMid = "#a78bfa", centerHigh = "#fb7185";
      let t, from, to, cFrom, cTo;
      if (p <= 0.5) { t = p / 0.5; from = low; to = mid; cFrom = centerLow; cTo = centerMid; }
      else { t = (p - 0.5) / 0.5; from = mid; to = high; cFrom = centerMid; cTo = centerHigh; }
      const blended = [0, 1, 2].map(i => blendHex(from[i], to[i], t));
      const [st1, st2, st3] = grad.querySelectorAll('stop');
      st1.setAttribute('stop-color', blended[0]); st2.setAttribute('stop-color', blended[1]); st3.setAttribute('stop-color', blended[2]);
      gearText.setAttribute('fill', blendHex(cFrom, cTo, t));
    }

    function updateVisuals(rpmPct, mph, mphMax) {
      const revP = clamp(rpmPct, 0, 1);
      const progEnd = trackStart + trackSweep * revP;
      progress.setAttribute('d', arcPath(cx, cy, outerR, trackStart, progEnd));
      const [kx, ky] = polar(cx, cy, outerR, progEnd);
      knob.setAttribute('cx', kx); knob.setAttribute('cy', ky);
      setGradientAuto(revP);

      const t = clamp(mph / mphMax, 0, 1);
      const a = tickStart + tickSweep * t;
      const [nx, ny] = polar(cx, cy, tickOuterR - 18, a);
      needle.setAttribute('x1', cx); needle.setAttribute('y1', cy);
      needle.setAttribute('x2', nx); needle.setAttribute('y2', ny);
      needleTip.setAttribute('cx', nx); needleTip.setAttribute('cy', ny);
    }

    root.appendChild(svg);

    return { svg, gearText, updateVisuals };
  }

  function addDevPanel(root, getState, setState) {
    const btn = document.createElement('button');
    btn.textContent = 'SPD';
    btn.id = 'spd-dev-toggle';
    // Hide SPD button by default - now accessed through Dev menu
    btn.style.cssText = 'display:none;position:fixed;right:12px;bottom:12px;z-index:51;border:1px solid #334;padding:6px 10px;border-radius:8px;background:#0f172a;color:#e2e8f0;font:12px system-ui;cursor:pointer;';
    const panel = document.createElement('div');
    panel.id = 'spd-dev-panel';
    // Uses CSS variable --dev-panel-top for consistent positioning with other dev panels
    panel.style.cssText = 'position:fixed;left:12px;top:var(--dev-panel-top, 56px);width:min(200px, calc(100vw - 24px));display:none;background:rgba(15,23,42,0.94);color:#e5e7eb;border:1px solid rgba(71,85,105,0.6);border-radius:10px;padding:10px;z-index:35;font:11px system-ui;';

    panel.innerHTML = `
      <div style="display:grid;gap:8px;">
        <label style="display:grid;grid-template-columns:1fr 72px;gap:8px;align-items:center;">
          <span>MPH max</span><input id="spd-mphmax" type="number" step="1" min="60" max="360">
        </label>
        <label style="display:grid;grid-template-columns:1fr 72px;gap:8px;align-items:center;">
          <span>Smoothing</span><input id="spd-smooth" type="number" step="0.02" min="0" max="1">
        </label>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="spd-save">Save</button>
          <button id="spd-reset">Reset</button>
        </div>
      </div>
    `;
    const mphInput = panel.querySelector('#spd-mphmax');
    const smoothInput = panel.querySelector('#spd-smooth');
    const saveBtn = panel.querySelector('#spd-save');
    const resetBtn = panel.querySelector('#spd-reset');

    function setInputs(cfg) {
      mphInput.value = cfg.mphMax;
      smoothInput.value = cfg.smoothing;
    }
    function readInputs() {
      return {
        mphMax: parseFloat(mphInput.value || '180'),
        smoothing: parseFloat(smoothInput.value || '0.18'),
      };
    }

    const togglePanel = () => {
      panel.style.display = (panel.style.display === 'none' || !panel.style.display) ? 'block' : 'none';
    };
    const handleKey = (e) => { if (e.code === 'F8') { togglePanel(); } };
    const handleSave = () => {
      const cfg = readInputs(); setState(cfg);
      try { localStorage.setItem('speedometerCfg', JSON.stringify(getState())); } catch (_) { }
    };
    const handleReset = () => {
      const d = getState().__defaults; setState({ mphMax: d.mphMax, smoothing: d.smoothing });
      try { localStorage.setItem('speedometerCfg', JSON.stringify(getState())); } catch (_) { }
      setInputs(getState());
    };

    btn.addEventListener('click', togglePanel);
    window.addEventListener('keydown', handleKey);
    saveBtn.addEventListener('click', handleSave);
    resetBtn.addEventListener('click', handleReset);

    root.appendChild(btn); root.appendChild(panel);
    setInputs(getState());

    return makeOnce(() => {
      btn.removeEventListener('click', togglePanel);
      window.removeEventListener('keydown', handleKey);
      saveBtn.removeEventListener('click', handleSave);
      resetBtn.removeEventListener('click', handleReset);
      try { btn.remove(); } catch (_) { }
      try { panel.remove(); } catch (_) { }
    });
  }

  const Speedometer = {
    init(opts = {}) {
      const cfg = { ...defaults, ...(opts || {}) };
      const el = document.createElement('div');
      el.id = 'rv-speedometer';
      el.style.cssText = `
        position:fixed; left:50%; transform:translateX(-50%);
        bottom:${cfg.bottomOffset}px; z-index:50; pointer-events:none;
      `;
      (opts.mount || document.body).appendChild(el);

      const { svg, gearText, updateVisuals } = buildGauge(el, cfg.width);

      const state = {
        mphMax: cfg.mphMax,
        smoothing: cfg.smoothing,
        mphSmoothed: 0,
        rpmPctSmoothed: 0,
        __defaults: { mphMax: cfg.mphMax, smoothing: cfg.smoothing }
      };

      // load saved cfg
      try {
        const saved = JSON.parse(localStorage.getItem('speedometerCfg') || 'null');
        if (saved && typeof saved.mphMax === 'number' && typeof saved.smoothing === 'number') {
          state.mphMax = saved.mphMax;
          state.smoothing = saved.smoothing;
        }
      } catch (_) { }

      function update({ gear, rpm, smoothedRpm, redline, idle, mph }) {
        // number
        if (gearText.textContent !== String(gear || 1)) gearText.textContent = String(gear || 1);
        // smoothing
        const rpmValue = Number.isFinite(smoothedRpm) ? smoothedRpm : rpm;
        const rpmPct = (redline > idle) ? clamp((rpmValue - idle) / (redline - idle), 0, 1) : 0;
        state.rpmPctSmoothed = state.rpmPctSmoothed + (rpmPct - state.rpmPctSmoothed) * state.smoothing;
        state.mphSmoothed = state.mphSmoothed + (Math.max(0, mph) - state.mphSmoothed) * state.smoothing;
        updateVisuals(state.rpmPctSmoothed, state.mphSmoothed, state.mphMax);
      }

      const destroyDev = addDevPanel(document.body,
        () => state,
        (patch) => Object.assign(state, patch)
      );

      return {
        update,
        destroy() { destroyDev(); try { el.remove(); } catch (_) { } },
        get state() { return { mphMax: state.mphMax, smoothing: state.smoothing }; }
      };
    }
  };

  window.RacerUI = window.RacerUI || {};
  window.RacerUI.Speedometer = Speedometer;
})();
