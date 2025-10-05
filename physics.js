"use strict";
(function(){
  // Gravity in pixel-units. Scale up so tire traction (mu*Fz) matches engineForce magnitudes
  // This fixes cars feeling like "slow motion" due to tiny normal loads.
  const g = 600; // px/s^2 (tuned so GT tops ~330-350 px/s on road)

  // Default per-vehicle physical parameters (pixel-space, tuned empirically)
  const VEHICLE_DEFAULTS = {
    F1:    { mass: 0.9,  wheelbase: 42, cgToFront: 20, cgToRear: 22, engineForce: 620, brakeForce: 680, maxSteer: 0.55, steerSpeed: 6.0, muLatRoad: 1.8, muLongRoad: 1.4, muLatGrass: 0.55, muLongGrass: 0.45, dragK: 0.0018, rollK: 0.15, downforceK: 0.0009 },
    GT:    { mass: 1.0,  wheelbase: 36, cgToFront: 17, cgToRear: 19, engineForce: 520, brakeForce: 640, maxSteer: 0.50, steerSpeed: 5.0, muLatRoad: 1.45, muLongRoad: 1.2, muLatGrass: 0.50, muLongGrass: 0.40, dragK: 0.0020, rollK: 0.18, downforceK: 0.0006 },
    Rally: { mass: 0.95, wheelbase: 34, cgToFront: 16, cgToRear: 18, engineForce: 560, brakeForce: 650, maxSteer: 0.58, steerSpeed: 6.5, muLatRoad: 1.35, muLongRoad: 1.15, muLatGrass: 0.46, muLongGrass: 0.38, dragK: 0.0022, rollK: 0.20, downforceK: 0.0005 },
    Truck: { mass: 1.6,  wheelbase: 44, cgToFront: 21, cgToRear: 23, engineForce: 400, brakeForce: 820, maxSteer: 0.40, steerSpeed: 3.5, muLatRoad: 1.10, muLongRoad: 0.95, muLatGrass: 0.42, muLongGrass: 0.34, dragK: 0.0026, rollK: 0.26, downforceK: 0.0008 }
  };

  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function sign(x){ return x<0?-1:x>0?1:0; }

  function inferIzz(mass, length, width){
    // Rectangular body moment around vertical (top-down)
    return mass * (length*length + width*width) / 12;
  }

  function worldToBody(vx, vy, angle){
    const c=Math.cos(angle), s=Math.sin(angle);
    return { x:  c*vx + s*vy, y: -s*vx + c*vy };
  }
  function bodyToWorld(vx, vy, angle){
    const c=Math.cos(angle), s=Math.sin(angle);
    return { x: c*vx - s*vy, y: s*vx + c*vy };
  }

  function axleNormalLoads(mass, a, b){
    // Static distribution across front (at distance a from CG) and rear (b)
    const L = a+b; const Fzf = mass * g * (b/L); const Fzr = mass * g * (a/L); // per axle (aggregate of 2 tires)
    return { Fzf, Fzr };
  }

  function initCar(car, kind){
    const k = kind || car.kind || 'GT';
    const base = VEHICLE_DEFAULTS[k] || VEHICLE_DEFAULTS.GT;
    const params = { ...base };
    // If the art length/width differs, adapt wheelbase slightly to fit
    const Lpx = (car.length || 36); const Wpx = (car.width || 18);
    // Keep cg distances proportional to given wheelbase
    const scale = params.wheelbase / Math.max(1, (params.cgToFront + params.cgToRear));
    const a = params.cgToFront, b = params.cgToRear; // already sum to wheelbase
    const Izz = inferIzz(params.mass, Lpx, Wpx);
    car.physics = {
      vx: 0, vy: 0, r: 0, // world-frame velocity and yaw rate
      vxb: 0, vyb: 0,     // body-frame velocity (cached)
      steer: 0,           // actual steer angle applied (rad)
      params,
      a, b,
      Izz,
      skid: 0             // last computed skid intensity 0..1
    };
    return car.physics;
  }

  function tireLateralForce(muLat, Fz, Calpha, slipAngle){
    // Simple linear up to limit, then saturate (friction circle simplified)
    const Fy_lin = -Calpha * slipAngle; // negative: resists slip
    const Fy_max = muLat * Fz;
    return clamp(Fy_lin, -Fy_max, Fy_max);
  }

  function updateCar(car, input, surface, dt){
    // input: {throttle:0..1, brake:0..1, steer:-1..1}
    // surface: {onRoad:boolean}
    if (!car.physics) initCar(car, car.kind);
    const P = car.physics.params;
    const mass = P.mass;
    const Izz = car.physics.Izz || inferIzz(mass, car.length||36, car.width||18);
    const a = car.physics.a, b = car.physics.b, L=a+b;
    const onRoad = surface && surface.onRoad !== false;
    const muLat = onRoad ? P.muLatRoad : P.muLatGrass;
    const muLong = onRoad ? P.muLongRoad : P.muLongGrass;
    const dragK = P.dragK * (onRoad?1:0.7); // slightly less aero on grass due to lower speeds
    const rollK = P.rollK  * (onRoad?1.0:1.6); // higher rolling on grass

    // Body-frame velocity
    const vb = worldToBody(car.physics.vx, car.physics.vy, car.angle);
    let vx = vb.x, vy = vb.y;

    // Steer target and rate limit
    const steerNormTarget = clamp((input?.steer||0), -1, 1);
    const steerTarget = steerNormTarget * P.maxSteer;
    const ds = clamp(steerTarget - car.physics.steer, -P.steerSpeed*dt, P.steerSpeed*dt);
    car.physics.steer += ds;
    const delta = car.physics.steer;
    car.steerVis = (car.steerVis==null?0:car.steerVis) + (steerNormTarget - (car.steerVis||0))*Math.min(1, dt*10);
    car.steerVis = clamp(car.steerVis, -1, 1);

    // Normal loads per axle
    const { Fzf, Fzr } = axleNormalLoads(mass, a, b);

    // Cornering stiffness proportional to available grip (linear range roughly at ~8 deg)
    const slip0 = 0.14; // ~8 degrees
    const Cf = muLat * Fzf / slip0;
    const Cr = muLat * Fzr / slip0;

    // Avoid singularity at very low speed
    const eps = 0.001;
    const slipF = Math.atan2(vy + a*car.physics.r, Math.max(eps, vx)) - delta;
    const slipR = Math.atan2(vy - b*car.physics.r, Math.max(eps, vx));

    const FyF = tireLateralForce(muLat, Fzf, Cf, slipF);
    const FyR = tireLateralForce(muLat, Fzr, Cr, slipR);

    // Longitudinal forces (drive on rear axle), limited by traction
    const throttle = clamp(input?.throttle?1:0, 0, 1);
    const brake = clamp(input?.brake?1:0, 0, 1);

    let Fx_drive = throttle * P.engineForce;
    let Fx_brake = brake * P.brakeForce * sign(vx);
    // Resistances (aero and rolling)
    const v = Math.hypot(vx, vy);
    const F_drag = dragK * v * v * sign(vx);
    const F_roll = rollK * v * sign(vx);

    // Traction limit on drive axle (rear). Enforce friction circle approximately
    const Fr_max = muLong * Fzr;
    const Fx_long = clamp(Fx_drive - Fx_brake - F_drag - F_roll, -Fr_max, Fr_max);

    // State derivatives in body frame per standard bicycle model
    const dvx = (Fx_long - FyF * Math.sin(delta) + vy * car.physics.r) / mass;
    const dvy = (FyF * Math.cos(delta) + FyR - vx * car.physics.r) / mass;
    const dr = (a * FyF * Math.cos(delta) - b * FyR) / Izz;

    vx += dvx * dt;
    vy += dvy * dt;
    car.physics.r += dr * dt;

    // Convert back to world frame for integration
    const vw = bodyToWorld(vx, vy, car.angle);
    car.physics.vx = vw.x;
    car.physics.vy = vw.y;
    // Mirror to legacy fields for compatibility with existing code
    car.vx = car.physics.vx;
    car.vy = car.physics.vy;
    car.x += car.physics.vx * dt;
    car.y += car.physics.vy * dt;
    car.angle += car.physics.r * dt;

    // Derived properties for compatibility
    car.speed = Math.hypot(car.physics.vx, car.physics.vy);
    car.sfxThrottle = throttle;
    car.sfxGrass = !onRoad;

    // Skid intensity from combined slip
    const skidLat = Math.max(0, Math.min(1, (Math.abs(slipF) + Math.abs(slipR)) / (2*0.35)));
    const driveSlip = Math.max(0, Math.min(1, Math.abs(Fx_long) / Math.max(1, Fr_max) - 0.85));
    const skid = clamp(0.5*skidLat + 0.5*driveSlip, 0, 1);
    car.physics.skid = skid;
    car.sfxSlip = (car.sfxSlip||0) * 0.85 + skid * 0.15;

    return {
      skid,
      steerAngle: delta,
      onGrass: !onRoad
    };
  }

  function wheelPositions(car){
    const halfW = (car.width||18) * 0.45;
    const nx = -Math.sin(car.angle), ny = Math.cos(car.angle);
    return {
      left:  { x: car.x + nx*halfW, y: car.y + ny*halfW },
      right: { x: car.x - nx*halfW, y: car.y - ny*halfW }
    };
  }

  // Simple debug draw: velocity vector and slip
  let DEBUG = false;
  function setDebugEnabled(v){ DEBUG = !!v; }
  function drawDebug(ctx, car){
    if (!DEBUG) return;
    ctx.save();
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 1.5; // velocity
    ctx.beginPath(); ctx.moveTo(car.x, car.y); ctx.lineTo(car.x + car.physics.vx*0.25, car.y + car.physics.vy*0.25); ctx.stroke();
    ctx.strokeStyle = '#ff4081'; // heading
    ctx.beginPath(); ctx.moveTo(car.x, car.y); ctx.lineTo(car.x + Math.cos(car.angle)*18, car.y + Math.sin(car.angle)*18); ctx.stroke();
    ctx.restore();
  }

  // Dev tools UI
  function injectDevTools(getCars){
    if (document.getElementById('rv-devtools')) return; // once
    const style = document.createElement('style');
    style.textContent = `
    .rv-devtools{position:fixed;top:12px;left:12px;z-index:40;font:12px system-ui;}
    .rv-devtools .toggle{appearance:none;border:1px solid #334; background:#0b1322; color:#e6eef6; padding:8px 10px; border-radius:8px; cursor:pointer;}
    .rv-panel{display:none; margin-top:8px; padding:10px; border:1px solid #334; background:#0e1729ee; color:#e6eef6; border-radius:10px; min-width:280px; max-width:340px; box-shadow:0 8px 24px rgba(0,0,0,.5)}
    .rv-panel.open{display:block;}
    .rv-row{display:flex; align-items:center; gap:8px; margin:6px 0}
    .rv-row label{width:120px; opacity:.9}
    .rv-row input[type=range]{flex:1}
    .rv-row input[type=number]{width:80px;background:#0b1322;color:#e6eef6;border:1px solid #334;border-radius:6px;padding:4px}
    .rv-row .val{width:40px; text-align:right; opacity:.8}
    .rv-row .small{opacity:.75;font-size:11px}
    `;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'rv-devtools';
    wrap.className = 'rv-devtools';
    wrap.innerHTML = `
      <button class="toggle">Dev tools ▾</button>
      <div class="rv-panel" role="dialog" aria-label="Dev tools">
        <div class="rv-row"><label>Vehicle</label>
          <select id="rv-kind">
            <option>F1</option><option selected>GT</option><option>Rally</option><option>Truck</option>
          </select>
          <label class="small"><input type="checkbox" id="rv-apply-ai"> Apply to AI</label>
        </div>
        <div class="rv-row"><label>Debug overlay</label><input type="checkbox" id="rv-debug"></div>
        <div class="rv-row"><label>Mass</label><input id="rv-mass" type="range" min="0.6" max="2.2" step="0.05"><div class="val" id="rv-mass-v"></div></div>
        <div class="rv-row"><label>Engine</label><input id="rv-eng" type="range" min="280" max="900" step="10"><div class="val" id="rv-eng-v"></div></div>
        <div class="rv-row"><label>Brake</label><input id="rv-brk" type="range" min="380" max="1100" step="10"><div class="val" id="rv-brk-v"></div></div>
        <div class="rv-row"><label>Max steer</label><input id="rv-steer" type="range" min="0.25" max="0.85" step="0.01"><div class="val" id="rv-steer-v"></div></div>
        <div class="rv-row"><label>Steer speed</label><input id="rv-steers" type="range" min="2" max="10" step="0.1"><div class="val" id="rv-steers-v"></div></div>
        <div class="rv-row"><label>Grip lat (road)</label><input id="rv-mulr" type="range" min="0.8" max="2.2" step="0.05"><div class="val" id="rv-mulr-v"></div></div>
        <div class="rv-row"><label>Grip long (road)</label><input id="rv-muor" type="range" min="0.6" max="1.8" step="0.05"><div class="val" id="rv-muor-v"></div></div>
        <div class="rv-row"><label>Grip lat (grass)</label><input id="rv-mulg" type="range" min="0.3" max="1.0" step="0.02"><div class="val" id="rv-mulg-v"></div></div>
        <div class="rv-row"><label>Grip long (grass)</label><input id="rv-muog" type="range" min="0.25" max="0.9" step="0.02"><div class="val" id="rv-muog-v"></div></div>
        <div class="rv-row"><label>Drag</label><input id="rv-drag" type="range" min="0.001" max="0.0035" step="0.0001"><div class="val" id="rv-drag-v"></div></div>
        <div class="rv-row"><label>Rolling</label><input id="rv-roll" type="range" min="0.10" max="0.35" step="0.005"><div class="val" id="rv-roll-v"></div></div>
        <div class="rv-row"><button id="rv-reset">Reset defaults</button></div>
      </div>`;
    document.body.appendChild(wrap);

    const panel = wrap.querySelector('.rv-panel');
    const toggle = wrap.querySelector('.toggle');
    toggle.addEventListener('click', ()=>{ panel.classList.toggle('open'); });

    const els = {
      kind: wrap.querySelector('#rv-kind'),
      applyAI: wrap.querySelector('#rv-apply-ai'),
      debug: wrap.querySelector('#rv-debug'),
      mass: wrap.querySelector('#rv-mass'),   massV: wrap.querySelector('#rv-mass-v'),
      eng: wrap.querySelector('#rv-eng'),     engV: wrap.querySelector('#rv-eng-v'),
      brk: wrap.querySelector('#rv-brk'),     brkV: wrap.querySelector('#rv-brk-v'),
      steer: wrap.querySelector('#rv-steer'), steerV: wrap.querySelector('#rv-steer-v'),
      steers: wrap.querySelector('#rv-steers'), steersV: wrap.querySelector('#rv-steers-v'),
      mulr: wrap.querySelector('#rv-mulr'),   mulrV: wrap.querySelector('#rv-mulr-v'),
      muor: wrap.querySelector('#rv-muor'),   muorV: wrap.querySelector('#rv-muor-v'),
      mulg: wrap.querySelector('#rv-mulg'),   mulgV: wrap.querySelector('#rv-mulg-v'),
      muog: wrap.querySelector('#rv-muog'),   muogV: wrap.querySelector('#rv-muog-v'),
      drag: wrap.querySelector('#rv-drag'),   dragV: wrap.querySelector('#rv-drag-v'),
      roll: wrap.querySelector('#rv-roll'),   rollV: wrap.querySelector('#rv-roll-v'),
      reset: wrap.querySelector('#rv-reset')
    };

    function refresh(kind){
      const k = kind || els.kind.value;
      const d = VEHICLE_DEFAULTS[k];
      els.mass.value = d.mass; els.massV.textContent = d.mass.toFixed(2);
      els.eng.value = d.engineForce; els.engV.textContent = d.engineForce|0;
      els.brk.value = d.brakeForce; els.brkV.textContent = d.brakeForce|0;
      els.steer.value = d.maxSteer; els.steerV.textContent = (+d.maxSteer).toFixed(2);
      els.steers.value = d.steerSpeed; els.steersV.textContent = d.steerSpeed.toFixed(1);
      els.mulr.value = d.muLatRoad; els.mulrV.textContent = d.muLatRoad.toFixed(2);
      els.muor.value = d.muLongRoad; els.muorV.textContent = d.muLongRoad.toFixed(2);
      els.mulg.value = d.muLatGrass; els.mulgV.textContent = d.muLatGrass.toFixed(2);
      els.muog.value = d.muLongGrass; els.muogV.textContent = d.muLongGrass.toFixed(2);
      els.drag.value = d.dragK; els.dragV.textContent = (+d.dragK).toFixed(4);
      els.roll.value = d.rollK; els.rollV.textContent = d.rollK.toFixed(2);
    }
    refresh(els.kind.value);

    function apply(){
      const k = els.kind.value;
      const p = VEHICLE_DEFAULTS[k] = {
        ...VEHICLE_DEFAULTS[k],
        mass: +els.mass.value,
        engineForce: +els.eng.value,
        brakeForce: +els.brk.value,
        maxSteer: +els.steer.value,
        steerSpeed: +els.steers.value,
        muLatRoad: +els.mulr.value,
        muLongRoad: +els.muor.value,
        muLatGrass: +els.mulg.value,
        muLongGrass: +els.muog.value,
        dragK: +els.drag.value,
        rollK: +els.roll.value
      };
      const cars = (getCars && getCars()) || {};
      const applyTo = [cars.player].filter(Boolean);
      if (els.applyAI.checked && Array.isArray(cars.ai)) applyTo.push(...cars.ai);
      for (const c of applyTo){ if (!c) continue; if (!c.physics) initCar(c, c.kind); c.physics.params = { ...c.physics.params, ...p }; }
      setDebugEnabled(!!els.debug.checked);
      refresh(k);
    }

    for (const key of ['mass','eng','brk','steer','steers','mulr','muor','mulg','muog','drag','roll']){
      els[key].addEventListener('input', ()=>{ const v = els[key].value; const label = key+'V'; if (els[label]) els[label].textContent = (''+v).slice(0, (key==='drag'?6:4)); apply(); });
    }
    els.kind.addEventListener('change', ()=>refresh(els.kind.value));
    els.reset.addEventListener('click', ()=>{ VEHICLE_DEFAULTS[els.kind.value] = { ...defaultSnapshot[els.kind.value] }; refresh(els.kind.value); apply(); });
    els.debug.addEventListener('change', ()=>setDebugEnabled(!!els.debug.checked));
  }

  // Snapshot factory defaults for reset
  const defaultSnapshot = JSON.parse(JSON.stringify(VEHICLE_DEFAULTS));

  const API = {
    initCar,
    updateCar,
    wheelPositions,
    drawDebug,
    setDebugEnabled,
    injectDevTools,
    defaults: VEHICLE_DEFAULTS
  };
  window.RacerPhysics = API;
})();
