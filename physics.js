"use strict";
(function(){
  // Gravity in pixel-units. Scale up so tire traction (mu*Fz) matches engineForce magnitudes
  // This fixes cars feeling like "slow motion" due to tiny normal loads.
  const g = 600; // px/s^2 (tuned so GT tops ~330-350 px/s on road)

  // Default per-vehicle physical parameters (pixel-space, tuned empirically)
  const VEHICLE_DEFAULTS = {
    F1: {
      mass: 0.9,
      wheelbase: 42,
      cgToFront: 20,
      cgToRear: 22,
      engineForce: 620,
      brakeForce: 680,
      maxSteer: 0.55,
      steerSpeed: 6.0,
      muLatRoad: 1.8,
      muLongRoad: 1.4,
      muLatGrass: 0.55,
      muLongGrass: 0.45,
      dragK: 0.0018,
      rollK: 0.15,
      downforceK: 0.0009,
      rearCircle: 0.50,
      vKineBlend: 40,
      cgHeight: 8,
      yawDampK: 0.12,
    reverseEntrySpeed: 40, // px/s threshold below which brake engages reverse
    reverseTorqueScale: 0.60, // fraction of engineForce when reversing
      touchSteer: {
        maxSteerLowSpeed: 0.65,
        maxSteerHighSpeed: 0.24,
        falloffSpeed: 340,
        baseSteerRate: 6.6,
        steerRateFalloff: 0.0035,
        returnGain: 0,
        filterTau: 0.12
      }
    },
    GT: {
      mass: 1.0,
      wheelbase: 36,
      cgToFront: 17,
      cgToRear: 19,
      engineForce: 520,
      brakeForce: 640,
      maxSteer: 0.50,
      steerSpeed: 5.0,
      muLatRoad: 1.45,
      muLongRoad: 1.2,
      muLatGrass: 0.50,
      muLongGrass: 0.40,
      dragK: 0.0020,
      rollK: 0.18,
      downforceK: 0.0006,
      rearCircle: 0.50,
      vKineBlend: 40,
      cgHeight: 7,
      yawDampK: 0.12,
    reverseEntrySpeed: 40,
    reverseTorqueScale: 0.60,
      touchSteer: {
        maxSteerLowSpeed: 0.58,
        maxSteerHighSpeed: 0.28,
        falloffSpeed: 260,
        baseSteerRate: 5.4,
        steerRateFalloff: 0.0032,
        returnGain: 0,
        filterTau: 0.12
      }
    },
    Rally: {
      mass: 0.95,
      wheelbase: 34,
      cgToFront: 16,
      cgToRear: 18,
      engineForce: 560,
      brakeForce: 650,
      maxSteer: 0.58,
      steerSpeed: 6.5,
      muLatRoad: 1.35,
      muLongRoad: 1.15,
      muLatGrass: 0.46,
      muLongGrass: 0.38,
      dragK: 0.0022,
      rollK: 0.20,
      downforceK: 0.0005,
      rearCircle: 0.50,
      vKineBlend: 40,
      cgHeight: 8,
      yawDampK: 0.12,
    reverseEntrySpeed: 40,
    reverseTorqueScale: 0.60,
      touchSteer: {
        maxSteerLowSpeed: 0.68,
        maxSteerHighSpeed: 0.32,
        falloffSpeed: 220,
        baseSteerRate: 6.8,
        steerRateFalloff: 0.0038,
        returnGain: 0,
        filterTau: 0.12
      }
    },
    Truck: {
      mass: 1.6,
      wheelbase: 44,
      cgToFront: 21,
      cgToRear: 23,
      engineForce: 400,
      brakeForce: 820,
      maxSteer: 0.40,
      steerSpeed: 3.5,
      muLatRoad: 1.10,
      muLongRoad: 0.95,
      muLatGrass: 0.42,
      muLongGrass: 0.34,
      dragK: 0.0026,
      rollK: 0.26,
      downforceK: 0.0008,
      rearCircle: 0.50,
      vKineBlend: 40,
      cgHeight: 10,
      yawDampK: 0.12,
    reverseEntrySpeed: 40,
    reverseTorqueScale: 0.60,
      touchSteer: {
        maxSteerLowSpeed: 0.50,
        maxSteerHighSpeed: 0.24,
        falloffSpeed: 200,
        baseSteerRate: 3.8,
        steerRateFalloff: 0.0028,
        returnGain: 0,
        filterTau: 0.12
      }
    }
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
    const touchSteerDefaults = base.touchSteer ? { ...base.touchSteer } : {
      maxSteerLowSpeed: base.maxSteer,
      maxSteerHighSpeed: base.maxSteer * 0.6,
      falloffSpeed: 240,
      baseSteerRate: base.steerSpeed,
      steerRateFalloff: 0.003,
      returnGain: 0,
      filterTau: 0.12
    };
    const params = { ...base, touchSteer: touchSteerDefaults };
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
      steeringState: { filteredSpeed: 0 },
      steeringMode: car && car.steeringMode === 'touch' ? 'touch' : 'manual',
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

    // Steering mode and filtered speed for adaptive touch steering
    const steeringMode = (car && car.steeringMode === 'touch') ? 'touch' : 'manual';
    car.physics.steeringMode = steeringMode;
    const steeringState = car.physics.steeringState || (car.physics.steeringState = { filteredSpeed: 0 });
    const speedWorld = Math.hypot(car.physics.vx, car.physics.vy);
    if (steeringState.filteredSpeed == null || !Number.isFinite(steeringState.filteredSpeed)) {
      steeringState.filteredSpeed = speedWorld;
    }
    if (steeringMode === 'touch') {
      const cfg = P.touchSteer || {};
      const tau = Math.max(0.05, cfg.filterTau || 0.12);
      const alpha = clamp(1 - Math.exp(-dt / tau), 0, 1);
      steeringState.filteredSpeed += (speedWorld - steeringState.filteredSpeed) * alpha;
    } else {
      steeringState.filteredSpeed = speedWorld;
    }

    // Steer target and rate limit
    const steerNormTarget = clamp(((input && input.steer) || 0), -1, 1);
    let steerMax = P.maxSteer;
    let steerRate = P.steerSpeed;
    let returnGain = 0;
    if (steeringMode === 'touch') {
      const cfg = P.touchSteer || {};
      const low = cfg.maxSteerLowSpeed != null ? cfg.maxSteerLowSpeed : P.maxSteer;
      const high = cfg.maxSteerHighSpeed != null ? cfg.maxSteerHighSpeed : (P.maxSteer * 0.6);
      const falloff = Math.max(1, cfg.falloffSpeed || 240);
      const filtered = steeringState.filteredSpeed;
      const blend = Math.exp(-filtered / falloff);
      steerMax = high + (low - high) * blend;
      const baseRate = cfg.baseSteerRate != null ? cfg.baseSteerRate : P.steerSpeed;
      const falloffScale = cfg.steerRateFalloff != null ? cfg.steerRateFalloff : 0;
      steerRate = baseRate / (1 + filtered * falloffScale);
      if (!Number.isFinite(steerRate) || steerRate <= 0) steerRate = baseRate;
      returnGain = Math.max(0, cfg.returnGain || 0);
    }
    steerRate = Math.max(1e-3, steerRate);
    const steerTarget = steerNormTarget * steerMax;
    const steerStep = clamp(steerTarget - car.physics.steer, -steerRate * dt, steerRate * dt);
    car.physics.steer += steerStep;
    if (returnGain > 0) {
      const alignStep = clamp(-car.physics.steer * returnGain * dt, -steerRate * dt, steerRate * dt);
      car.physics.steer += alignStep;
    }
    if (steeringMode === 'touch') {
      car.physics.steer = clamp(car.physics.steer, -steerMax, steerMax);
    }
    const delta = car.physics.steer;
    car.steerVis = (car.steerVis==null?0:car.steerVis) + (steerNormTarget - (car.steerVis||0))*Math.min(1, dt*10);
    car.steerVis = clamp(car.steerVis, -1, 1);

  // Normal loads per axle (static baseline)
  const loadsStatic = axleNormalLoads(mass, a, b);
  let Fzf = loadsStatic.Fzf, Fzr = loadsStatic.Fzr;

  // Cornering stiffness proportional to available grip (linear range roughly at ~8 deg)
  const slip0 = 0.14; // ~8 degrees
  let Cf = muLat * Fzf / slip0;
  let Cr = muLat * Fzr / slip0;

    // Avoid singularity at very low speed
  const eps = 0.001;
  const speedBody = Math.hypot(vx, vy);
  const fwd = Math.abs(vx) < 0.5 ? 1 : sign(vx); // stable forward reference near zero
  const vxEff = fwd * Math.max(eps, Math.abs(vx));
  const deltaEff = delta * fwd; // invert steering when rolling backwards
  let slipF = Math.atan2(vy + a*car.physics.r, vxEff) - deltaEff;
  let slipR = Math.atan2(vy - b*car.physics.r, vxEff);

  // Lateral forces will be computed after load transfer adjustments
  let FyF = 0;
  let FyR_unc = 0;

    // Longitudinal forces (drive on rear axle), limited by traction
    const throttle = clamp((input && input.throttle) ? 1 : 0, 0, 1);
    const brake = clamp((input && input.brake) ? 1 : 0, 0, 1);

    // Reverse mode: if near stopped and braking, allow controlled reverse torque
    let reversing = false;
    const reverseEntrySpeed = P.reverseEntrySpeed != null ? P.reverseEntrySpeed : 40;
    const reverseTorqueScale = P.reverseTorqueScale != null ? P.reverseTorqueScale : 0.60;
    const almostStopped = speedWorld < reverseEntrySpeed;
    if (almostStopped && brake && !throttle && reverseTorqueScale > 0 && reverseEntrySpeed > 0){
      reversing = true;
    }
    let Fx_drive = reversing ? -P.engineForce * reverseTorqueScale : throttle * P.engineForce;
    let Fx_brake = reversing ? 0 : (brake * P.brakeForce * sign(vx));
    // Resistances (aero & rolling) oppose actual motion direction in body frame along X
    const vmag = Math.max(eps, Math.hypot(vx, vy));
    const ux_bx = vx / vmag; // projection of velocity direction on body X
    const F_drag = dragK * vmag * vmag * ux_bx;
    const F_roll = rollK * vmag * ux_bx;

  // Preliminary longitudinal force (will re-evaluate traction limit after load transfer)
  const Fx_long_raw_pre = Fx_drive - Fx_brake - F_drag - F_roll;
  // Use current Fzr for initial clamp; will recalc after transfer
  let Fx_long = clamp(Fx_long_raw_pre, -muLong * Fzr, muLong * Fzr);
    const ax = Fx_long / mass; // longitudinal accel (approx) for load transfer
    // Debug cache (will be refreshed after possible load transfer too)
    car.physics.lastAx = ax;

    // Longitudinal load transfer update
    const cgH = (P.cgHeight!=null?P.cgHeight:8);
    if (cgH > 0) {
      const dF = mass * cgH * ax / L; // shift proportional to accel
      Fzf = clamp(loadsStatic.Fzf - dF, 0, mass*g);
      Fzr = clamp(loadsStatic.Fzr + dF, 0, mass*g);
      Cf = muLat * Fzf / slip0;
      Cr = muLat * Fzr / slip0;
    }
    car.physics.lastFzf = Fzf; car.physics.lastFzr = Fzr;

    // Now compute lateral forces with updated loads
    FyF = tireLateralForce(muLat, Fzf, Cf, slipF);
    FyR_unc = tireLateralForce(muLat, Fzr, Cr, slipR);

    // Mild rear combined slip limiting (scale only lateral)
    const rearCircle = (P.rearCircle!=null?P.rearCircle:0.5);
    let lambda = 0;
    if (rearCircle > 0) {
      const ux = (muLong*Fzr>1e-6) ? (Fx_long / (muLong * Fzr)) : 0;
      const uy = (muLat*Fzr>1e-6) ? (FyR_unc / (muLat * Fzr)) : 0;
      lambda = Math.hypot(ux, uy);
      if (lambda > 1) {
        FyR_unc = FyR_unc / (1 + rearCircle * (lambda - 1));
      }
      car.physics._dbgLambda = lambda;
    } else car.physics._dbgLambda = 0;
    let FyR = FyR_unc;

  // Recompute longitudinal traction limit after possible load shift
  const Fr_max = muLong * Fzr;
  // Clamp again in case load transfer changed available traction
  Fx_long = clamp(Fx_long, -Fr_max, Fr_max);
  car.physics._dbgFyR_avail = muLat * Fzr; car.physics._dbgUx = Math.min(1, Math.abs(Fx_long)/Math.max(1e-6, Fr_max)); car.physics._dbgFyR = FyR;

    // Dynamic derivatives (force-based)
    const dvx_dyn = (Fx_long - FyF * Math.sin(deltaEff) + vy * car.physics.r) / mass;
    const dvy_dyn = (FyF * Math.cos(deltaEff) + FyR - vx * car.physics.r) / mass;
    let dr_dyn = (a * FyF * Math.cos(deltaEff) - b * FyR) / Izz;
    // Yaw damping
    const yawDampK = (P.yawDampK!=null?P.yawDampK:0.12);
    dr_dyn += -yawDampK * car.physics.r;

    // Kinematic fallback
    const vKineBlend = (P.vKineBlend!=null?P.vKineBlend:40);
    const speedBody2 = Math.hypot(vx, vy);
    let dvx_kine = 0, dvy_kine = 0, dr_kine = 0;
    if (vKineBlend > 0) {
      dr_kine = (vxEff / L) * Math.tan(deltaEff);
      dvy_kine = dr_kine * vxEff; // rotate forward velocity into lateral
    }
    let alphaBlend = 1;
    if (vKineBlend > 0) {
      const t = clamp(speedBody2 / vKineBlend, 0, 1);
      alphaBlend = t*t*(3-2*t);
    }
  // IMPORTANT: do NOT blend longitudinal acceleration; previous version blended dvx
  // which zeroed propulsion at low speed (alphaBlend~0) causing cars to stay frozen.
  const dvx = dvx_dyn;
    const dvy = dvy_kine + (dvy_dyn - dvy_kine) * alphaBlend;
    let dr = dr_kine + (dr_dyn - dr_kine) * alphaBlend;
  car.physics.lastAlphaBlend = alphaBlend;

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

  // Cache debug values
  car.physics.lastSlipF = slipF;
  car.physics.lastSlipR = slipR;
  car.physics.lastFx_long = Fx_long;
  car.physics.lastFwd = fwd;
  car.physics.lastDeltaEff = deltaEff;
  car.physics.lastLambda = car.physics._dbgLambda || 0;
  car.physics.lastReversing = reversing;

    // Derived properties for compatibility
    car.speed = Math.hypot(car.physics.vx, car.physics.vy);
    car.sfxThrottle = throttle;
    car.sfxGrass = !onRoad;

    // Skid intensity from combined slip
    const skidLat = Math.max(0, Math.min(1, (Math.abs(slipF) + Math.abs(slipR)) / (2*0.35)));
  const driveSlip = Math.max(0, Math.min(1, Math.abs(Fx_long) / Math.max(1, muLong * Fzr) - 0.85));
    const skid = clamp(0.5*skidLat + 0.5*driveSlip, 0, 1);
    car.physics.skid = skid;
    car.sfxSlip = (car.sfxSlip||0) * 0.85 + skid * 0.15;

    return {
      skid,
      steerAngle: delta,
      onGrass: !onRoad,
      Fx_long,
      FyR: car.physics._dbgFyR,
      FyR_avail: car.physics._dbgFyR_avail,
      ux: car.physics._dbgUx,
      slipF, slipR,
      speed: car.speed,
      fwd,
      reversing
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

    // Compact physics line (player-oriented). Expect prior updateCar to have stored debug fields.
    try {
      const p = car.physics || {};
      if (p._dbgFyR_avail != null){
        const lambda = p.lastLambda != null ? p.lastLambda : 0;
        const speedMag = Math.hypot(car.physics.vx||0, car.physics.vy||0);
        const line = `fwd=${(p.lastFwd!=null?p.lastFwd:1)} ${(p.lastReversing?'REV ':'')}|v|=${speedMag.toFixed(1)} vx=${(car.physics.vx||0).toFixed(1)} vy=${(car.physics.vy||0).toFixed(1)} dEff=${(p.lastDeltaEff||0).toFixed(3)} slipF=${(p.lastSlipF||0).toFixed(3)} slipR=${(p.lastSlipR||0).toFixed(3)} λ=${lambda.toFixed(2)} ax=${(p.lastAx||0).toFixed(2)} FzF=${(p.lastFzf||0).toFixed(0)} FzR=${(p.lastFzr||0).toFixed(0)} ${(p.lastAlphaBlend<0.999)?'KIN':''}`;
        ctx.font = '11px monospace';
        ctx.textBaseline = 'top';
        const x = car.x + 20, y = car.y - 30;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; const w = ctx.measureText(line).width + 8; ctx.fillRect(x-4,y-2,w,16);
        ctx.fillStyle = (lambda>1.01) ? '#ff5050' : '#e0f2f1';
        ctx.fillText(line, x, y);
      }
    } catch(_){}
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
  <div class="rv-row"><label>Rear circle</label><input id="rv-rearc" type="range" min="0" max="1" step="0.05"><div class="val" id="rv-rearc-v"></div></div>
  <div class="rv-row"><label>vKineBlend</label><input id="rv-vkine" type="range" min="0" max="120" step="5"><div class="val" id="rv-vkine-v"></div></div>
  <div class="rv-row"><label>cgHeight</label><input id="rv-cgh" type="range" min="0" max="14" step="1"><div class="val" id="rv-cgh-v"></div></div>
  <div class="rv-row"><label>Yaw damp</label><input id="rv-yawd" type="range" min="0" max="0.30" step="0.02"><div class="val" id="rv-yawd-v"></div></div>
  <div class="rv-row"><label>Reverse entry</label><input id="rv-reventry" type="range" min="0" max="120" step="5"><div class="val" id="rv-reventry-v"></div></div>
  <div class="rv-row"><label>Reverse torque</label><input id="rv-revtorque" type="range" min="0.30" max="1.00" step="0.05"><div class="val" id="rv-revtorque-v"></div></div>
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
  rearc: wrap.querySelector('#rv-rearc'), rearcV: wrap.querySelector('#rv-rearc-v'),
  vkine: wrap.querySelector('#rv-vkine'), vkineV: wrap.querySelector('#rv-vkine-v'),
  cgh: wrap.querySelector('#rv-cgh'), cghV: wrap.querySelector('#rv-cgh-v'),
  yawd: wrap.querySelector('#rv-yawd'), yawdV: wrap.querySelector('#rv-yawd-v'),
  reventry: wrap.querySelector('#rv-reventry'), reventryV: wrap.querySelector('#rv-reventry-v'),
  revtorque: wrap.querySelector('#rv-revtorque'), revtorqueV: wrap.querySelector('#rv-revtorque-v'),
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
  els.rearc.value = (d.rearCircle!=null?d.rearCircle:0.50).toFixed(2); els.rearcV.textContent = (+els.rearc.value).toFixed(2);
  els.vkine.value = (d.vKineBlend!=null?d.vKineBlend:40).toFixed(0); els.vkineV.textContent = els.vkine.value;
  els.cgh.value = (d.cgHeight!=null?d.cgHeight:8).toFixed(0); els.cghV.textContent = els.cgh.value;
  els.yawd.value = (d.yawDampK!=null?d.yawDampK:0.12).toFixed(2); els.yawdV.textContent = (+els.yawd.value).toFixed(2);
      els.reventry.value = (d.reverseEntrySpeed!=null?d.reverseEntrySpeed:40).toFixed(0); els.reventryV.textContent = els.reventry.value;
      els.revtorque.value = (d.reverseTorqueScale!=null?d.reverseTorqueScale:0.60).toFixed(2); els.revtorqueV.textContent = (+els.revtorque.value).toFixed(2);
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
    rollK: +els.roll.value,
  rearCircle: +els.rearc.value,
  vKineBlend: +els.vkine.value,
  cgHeight: +els.cgh.value,
  yawDampK: +els.yawd.value,
  reverseEntrySpeed: +els.reventry.value,
  reverseTorqueScale: +els.revtorque.value
      };
      const cars = (getCars && getCars()) || {};
      const applyTo = [cars.player].filter(Boolean);
      if (els.applyAI.checked && Array.isArray(cars.ai)) applyTo.push(...cars.ai);
      for (const c of applyTo){ if (!c) continue; if (!c.physics) initCar(c, c.kind); c.physics.params = { ...c.physics.params, ...p }; }
      setDebugEnabled(!!els.debug.checked);
      refresh(k);
    }

  for (const key of ['mass','eng','brk','steer','steers','mulr','muor','mulg','muog','drag','roll','rearc','vkine','cgh','yawd','reventry','revtorque']){
      els[key].addEventListener('input', ()=>{ const v = els[key].value; const label = key+'V'; if (els[label]) els[label].textContent = (''+v).slice(0, (key==='drag'?6:(key==='revtorque'?6:4))); apply(); });
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
