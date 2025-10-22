import { createWorld, stepWorld, meters, pixels, PPM_DEFAULT } from './physics/planckWorld.js';
import { buildTrackBodies } from './trackCollision.js';
import { Gearbox, gearboxDefaults } from './gearbox.js';

(function(){
  "use strict";
  /*
   Summary of physics changes (2025-10):
   - Longitudinal slip-ratio response replaces hard traction clamp (smooth build-up/peak/falloff)
   - Combined-slip ellipse applied to front axle (rear already existed); rear ellipse now uses wheel-originated Fx
   - Tire load sensitivity: effective mu decreases slightly as Fz increases
   - Downforce (downforceK) contributes to axle loads based on speed
   - Analog throttle/brake inputs supported (0..1)
   New params per vehicle (with defaults):
     longSlipPeak: 0.14, longSlipFalloff: 0.65,
     frontCircle: 0.50, brakeFrontShare: 0.60,
     loadSenseK: 0.08
  */
  // Gravity in pixel-units. Scale up so tire traction (mu*Fz) matches engineForce magnitudes
  // This fixes cars feeling like "slow motion" due to tiny normal loads.
  const g = 600; // px/s^2 (tuned so GT tops ~330-350 px/s on road)

  // Default per-vehicle physical parameters (pixel-space, tuned empirically)
  const PLANCK_DEFAULTS = {
    usePlanck: true,
    pixelsPerMeter: PPM_DEFAULT,
    linearDamp: 0.0,
    angularDamp: 0.0,
    restitution: 0.0,
    velIters: 8,
    posIters: 3,
    planckDoSleep: true
  };

  const VEHICLE_DEFAULTS = {
    F1: {
      ...PLANCK_DEFAULTS,
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
  downforceK: 0.00025,
  longSlipPeak: 0.18,
  longSlipFalloff: 0.80,
  frontCircle: 0.50,
  brakeFrontShare: 0.60,
  loadSenseK: 0.08,
  muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
  vKineBlend: 1.8,
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
      ...PLANCK_DEFAULTS,
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
  downforceK: 0.00025,
  longSlipPeak: 0.18,
  longSlipFalloff: 0.80,
  frontCircle: 0.50,
  brakeFrontShare: 0.60,
  loadSenseK: 0.08,
  muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
  vKineBlend: 1.8,
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
      ...PLANCK_DEFAULTS,
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
  downforceK: 0.00025,
  longSlipPeak: 0.18,
  longSlipFalloff: 0.80,
  frontCircle: 0.50,
  brakeFrontShare: 0.60,
  loadSenseK: 0.08,
  muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
  vKineBlend: 1.8,
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
      ...PLANCK_DEFAULTS,
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
  downforceK: 0.00025,
  longSlipPeak: 0.18,
  longSlipFalloff: 0.80,
  frontCircle: 0.50,
  brakeFrontShare: 0.60,
  loadSenseK: 0.08,
  muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
  vKineBlend: 1.8,
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

  const planckState = {
    world: null,
    trackBody: null,
    trackSegments: [],
    ppm: PLANCK_DEFAULTS.pixelsPerMeter,
    velIters: PLANCK_DEFAULTS.velIters,
    posIters: PLANCK_DEFAULTS.posIters,
    gravityY: 0,
    doSleep: PLANCK_DEFAULTS.planckDoSleep,
    pendingDt: 0,
    steppedThisFrame: false,
    carEntries: new Map(),
    restitution: PLANCK_DEFAULTS.restitution,
    needsWorldBuild: false
  };

  function destroyPlanckWorld(){
    if (!planckState.world) return;
    for (const { body } of planckState.carEntries.values()) {
      try { planckState.world.destroyBody(body); } catch(_){}
    }
    planckState.carEntries.clear();
    if (planckState.trackBody) {
      try { planckState.world.destroyBody(planckState.trackBody); } catch(_){}
    }
    planckState.trackBody = null;
    planckState.world = null;
  }

  function configureTrackCollision(trackSegments, opts = {}){
    planckState.trackSegments = Array.isArray(trackSegments) ? trackSegments.slice() : [];
    if (typeof opts.ppm === 'number' && Number.isFinite(opts.ppm) && opts.ppm > 0) {
      planckState.ppm = opts.ppm;
    }
    if (typeof opts.restitution === 'number') {
      planckState.restitution = opts.restitution;
    }
    if (typeof opts.gravityY === 'number') {
      planckState.gravityY = opts.gravityY;
    }
    if (typeof opts.doSleep === 'boolean') {
      planckState.doSleep = opts.doSleep;
    }
    planckState.needsWorldBuild = true;
  }

  function rebuildPlanckWorld({ cars } = {}){
    const carList = Array.isArray(cars) ? cars.slice() : Array.from(planckState.carEntries.keys());
    destroyPlanckWorld();
    const world = createWorld({ gravityY: planckState.gravityY, doSleep: planckState.doSleep });
    planckState.world = world;
    if (planckState.trackSegments.length) {
      try {
        planckState.trackBody = buildTrackBodies(world, planckState.trackSegments, planckState.ppm, { restitution: planckState.restitution });
      } catch(err) {
        console.warn('[RacerPhysics] Failed to build track bodies', err);
        planckState.trackBody = null;
      }
    }
    planckState.needsWorldBuild = false;
    planckState.steppedThisFrame = false;
    planckState.pendingDt = 0;
    if (carList.length) {
      registerPlanckCars(carList);
    }
  }

  function removePlanckBody(car){
    if (!car) return;
    const entry = planckState.carEntries.get(car);
    if (entry && planckState.world) {
      try { planckState.world.destroyBody(entry.body); } catch(_){}
    }
    planckState.carEntries.delete(car);
    if (car.physics) {
      car.physics.planckBody = null;
    }
  }

  function updateBodyPose(body, car, ppm){
    if (!body || !car) return;
    const pl = window.planck;
    if (!pl) return;
    const pos = pl.Vec2(meters(car.x || 0, ppm), meters(car.y || 0, ppm));
    body.setTransform(pos, car.angle || 0);
    body.setLinearVelocity(pl.Vec2(0, 0));
    body.setAngularVelocity(0);
  }

  function createCarBody(world, car, P, ppmOverride){
    const pl = window.planck;
    if (!world || !car || !pl) return null;
    const ppm = ppmOverride || planckState.ppm || PPM_DEFAULT;
    const widthPx = car.width || (car.dim && car.dim.widthPx) || 18;
    const lengthPx = car.length || (car.dim && car.dim.lengthPx) || 36;
  const w = meters(widthPx, ppm);
  const h = meters(lengthPx, ppm);
  const desiredMass = (P && typeof P.mass === 'number') ? Math.max(0.01, P.mass) : 1.0;
  const area = Math.max(1e-6, w * h);
  const density = desiredMass / area;
    const body = world.createBody({
      type: 'dynamic',
      position: pl.Vec2(meters(car.x || 0, ppm), meters(car.y || 0, ppm)),
      angle: car.angle || 0,
      linearDamping: P && typeof P.linearDamp === 'number' ? P.linearDamp : 0,
      angularDamping: P && typeof P.angularDamp === 'number' ? P.angularDamp : 0,
      bullet: true,
      allowSleep: P && typeof P.planckDoSleep === 'boolean' ? P.planckDoSleep : planckState.doSleep
    });
    const shape = pl.Box(Math.max(0.01, w * 0.5), Math.max(0.01, h * 0.5));
    body.createFixture(shape, {
      density,
      friction: 0.45,
      restitution: P && typeof P.restitution === 'number' ? P.restitution : planckState.restitution
    });
    car.physics.planckBody = body;
    return body;
  }

  function ensurePlanckBody(car, P){
    if (!car || !P || !P.usePlanck) {
      removePlanckBody(car);
      return null;
    }
    if (planckState.needsWorldBuild || !planckState.world) {
      rebuildPlanckWorld();
    }
    if (!planckState.world) return null;
    const desiredPpm = P.pixelsPerMeter || planckState.ppm || PPM_DEFAULT;
    if (desiredPpm > 0 && desiredPpm !== planckState.ppm) {
      planckState.ppm = desiredPpm;
    }
    if (typeof P.velIters === 'number') planckState.velIters = P.velIters;
    if (typeof P.posIters === 'number') planckState.posIters = P.posIters;
    if (typeof P.planckDoSleep === 'boolean') planckState.doSleep = P.planckDoSleep;
    let entry = planckState.carEntries.get(car);
    if (entry && entry.ppm !== planckState.ppm) {
      removePlanckBody(car);
      entry = null;
    }
    if (!entry) {
      const body = createCarBody(planckState.world, car, P, planckState.ppm);
      if (!body) return null;
      entry = { body, ppm: planckState.ppm };
      planckState.carEntries.set(car, entry);
    }
    return entry.body;
  }

  function registerPlanckCars(cars){
    if (!cars) return;
    const arr = Array.isArray(cars) ? cars : [cars];
    for (const car of arr) {
      if (!car || !car.physics) continue;
      const P = car.physics.params || car.physics;
      if (P && P.usePlanck) {
        ensurePlanckBody(car, P);
      } else {
        removePlanckBody(car);
      }
    }
  }

  function planckBeginStep(dt, cars){
    if (dt <= 0) { planckState.pendingDt = 0; planckState.steppedThisFrame = false; return; }
    if (cars) registerPlanckCars(cars);
    planckState.pendingDt = dt;
    planckState.steppedThisFrame = false;
  }

  function syncCarFromBody(car, entry){
    if (!car || !entry) return;
    const body = entry.body;
    if (!body) return;
    const ppm = entry.ppm || planckState.ppm || PPM_DEFAULT;
    const pos = body.getPosition();
    const vel = body.getLinearVelocity();
    const angle = body.getAngle();
    const omega = body.getAngularVelocity();
    car.x = pixels(pos.x, ppm);
    car.y = pixels(pos.y, ppm);
    car.angle = angle;
    if (car.physics) {
      car.physics.vx = pixels(vel.x, ppm);
      car.physics.vy = pixels(vel.y, ppm);
      car.physics.r = omega;
      car.vx = car.physics.vx;
      car.vy = car.physics.vy;
      car.physics.planckBody = body;
    }
    car.speed = Math.hypot(car.vx || 0, car.vy || 0);
  }

  function planckStep(){
    if (!planckState.world || planckState.steppedThisFrame) return;
    const dt = planckState.pendingDt;
    if (!dt || dt <= 0) return;
    try {
      stepWorld(planckState.world, dt, planckState.velIters, planckState.posIters);
    } catch(err) {
      console.warn('[RacerPhysics] Planck world step failed', err);
    }
    planckState.steppedThisFrame = true;
    planckState.pendingDt = 0;
    for (const [car, entry] of planckState.carEntries.entries()) {
      syncCarFromBody(car, entry);
    }
  }

  function usesPlanckWorld(){
    if (!planckState.world) return false;
    if (!planckState.carEntries.size) return false;
    for (const car of planckState.carEntries.keys()) {
      const params = car && car.physics && car.physics.params;
      if (params && params.usePlanck) {
        return true;
      }
    }
    return false;
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
  const params = { ...PLANCK_DEFAULTS, ...base, touchSteer: touchSteerDefaults };
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
      skid: 0,            // last computed skid intensity 0..1
      planckBody: null
    };
    if (!car.gearbox) {
      car.gearbox = new Gearbox(gearboxDefaults);
    }
    return car.physics;
  }

  function tireLateralForce(muLat, Fz, Calpha, slipAngle){
    // Simple linear up to limit, then saturate (friction circle simplified)
    const Fy_lin = -Calpha * slipAngle; // negative: resists slip
    const Fy_max = muLat * Fz;
    return clamp(Fy_lin, -Fy_max, Fy_max);
  }

  // Longitudinal slip ratio response: linear rise up to sPeak, soft falloff towards `falloff`
  function slipRatioResponse(s, sPeak = 0.15, falloff = 0.65){
    // s approx in [-1,1]
    const x = Math.min(1, Math.max(0, Math.abs(s)));
    const up = Math.min(1, x / Math.max(1e-6, sPeak));
    const down = (x <= sPeak) ? 1 : (1 - (x - sPeak) / Math.max(1e-6, 1 - sPeak));
    const y = up * (falloff + (1 - falloff) * down);
    return Math.sign(s) * y;
  }
  function lerp(a,b,t){ return a + (b - a) * t; }

  function updateCar(car, input, surface, dt){
    // input: {throttle:0..1, brake:0..1, steer:-1..1}
    // surface: {onRoad:boolean}
    if (!car.physics) initCar(car, car.kind);
    const P = car.physics.params;
    if (car.gearbox) {
      if (input && input.shiftUp) car.gearbox.shiftUp();
      if (input && input.shiftDown) car.gearbox.shiftDown();
      if (input && typeof input.manual === 'boolean') car.gearbox.setManual(input.manual);
    }
    let usePlanck = !!(P && P.usePlanck);
    let ppm = P.pixelsPerMeter || planckState.ppm || PPM_DEFAULT;
    let planckBody = null;
    const mass = P.mass;
    if (usePlanck) {
      planckBody = ensurePlanckBody(car, P);
      if (!planckBody) {
        usePlanck = false;
      } else {
        ppm = planckState.ppm || ppm;
        const vel = planckBody.getLinearVelocity();
        const angle = planckBody.getAngle();
        const omega = planckBody.getAngularVelocity();
        car.physics.vx = pixels(vel.x, ppm);
        car.physics.vy = pixels(vel.y, ppm);
        car.physics.r = omega;
        car.vx = car.physics.vx;
        car.vy = car.physics.vy;
        car.angle = angle;
        car.physics.planckBody = planckBody;
      }
    } else if (car.physics.planckBody) {
      removePlanckBody(car);
    }
    const Izz = car.physics.Izz || inferIzz(P.mass, car.length||36, car.width||18);
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

  // Speed-based downforce split by static distribution
  {
    const vDF = Math.hypot(car.physics.vx, car.physics.vy);
    const DF  = (P.downforceK != null ? P.downforceK : 0) * vDF * vDF;
    const frontShare = b / (a + b);
    const rearShare  = a / (a + b);
    Fzf += DF * frontShare;
    Fzr += DF * rearShare;
  }

  // Cornering stiffness proportional to available grip (linear range roughly at ~8 deg)
  const slip0 = 0.14; // ~8 degrees
  // Define reference loads for load sensitivity
  const Fzf_ref = loadsStatic.Fzf, Fzr_ref = loadsStatic.Fzr;
  const loadSenseK = (P.loadSenseK != null ? P.loadSenseK : 0.08);
  let muLatF = muLat * (1 - loadSenseK * (Fzf / Math.max(1e-6, Fzf_ref) - 1));
  let muLatR = muLat * (1 - loadSenseK * (Fzr / Math.max(1e-6, Fzr_ref) - 1));
  let Cf = muLatF * Fzf / slip0;
  let Cr = muLatR * Fzr / slip0;

    // Avoid singularity at very low speed
  const eps = 0.001;
  const speedBody = Math.hypot(vx, vy);
  const fwd = Math.abs(vx) < 0.5 ? 1 : sign(vx); // stable forward reference near zero
  const vxAbs = Math.max(eps, Math.abs(vx));
  const vxSigned = vxAbs * fwd;
  const deltaEff = delta * fwd; // invert steering when rolling backwards
  const vyFront = vy + a * car.physics.r;
  const vyRear  = vy - b * car.physics.r;
  let slipF, slipR;
  if (fwd >= 0) {
    slipF = Math.atan2(vyFront, vxAbs) - delta;
    slipR = Math.atan2(vyRear, vxAbs);
  } else {
    slipF = Math.atan2(-vyFront, vxAbs) + delta;
    slipR = Math.atan2(-vyRear, vxAbs);
  }
  const slipLimit = 0.7; // cap extreme slip angles to avoid runaway forces at very low speed
  slipF = clamp(slipF, -slipLimit, slipLimit);
  slipR = clamp(slipR, -slipLimit, slipLimit);

  // Lateral forces will be computed after load transfer adjustments
  let FyF = 0;
  let FyR_unc = 0;

  // Longitudinal forces (drive on rear axle), limited by traction; analog inputs 0..1
  let throttle = clamp(+((input && input.throttle) || 0), 0, 1);
  let brake = clamp(+((input && input.brake) || 0), 0, 1);
  if (car.physics.prevDriveSlip == null) car.physics.prevDriveSlip = 0;
  const slipInfo = { driveSlip: car.physics.prevDriveSlip || 0 };

  const throttlePressedGlobal = throttle > 0.05;
  const brakePressedGlobal = brake > 0.05;
  const vForward = vx / Math.max(1e-3, ppm); // m/s forward velocity (body X projected)
  const gb = car.gearbox instanceof Gearbox ? car.gearbox : null;
  let gbState = null;
  if (gb) {
    if (gb.c.auto) {
      const throttlePressed = throttlePressedGlobal;
      const brakePressed = brakePressedGlobal;
      const speedMag = Math.hypot(car.physics.vx, car.physics.vy);
      const forwardSpeed = vx;

      if (brakePressed && !throttlePressed) {
        if (gb.gearIndex > -1 && Math.abs(forwardSpeed) < 35 && speedMag < 45) {
          if (gb.gearIndex > 0) gb.shiftDown();
          if (gb.gearIndex > -1) gb.shiftDown();
        }
      } else if (throttlePressed) {
        if (gb.gearIndex <= 0 && Math.abs(forwardSpeed) < 35 && speedMag < 45) {
          while (gb.gearIndex < 1) gb.shiftUp();
        }
      }

      if (gb.gearIndex === 1 && throttlePressed && forwardSpeed < -12) {
        brake = Math.max(brake, Math.min(1, Math.abs(forwardSpeed) / 60));
        throttle = 0;
      }

      if (gb.gearIndex === -1) {
        if (brakePressed && !throttlePressed) {
          throttle = brake;
          brake = 0;
        } else if (throttlePressed && forwardSpeed < -20) {
          brake = Math.max(brake, throttle);
          throttle = 0;
        }
      } else if (gb.gearIndex >= 1) {
        if (throttlePressed && forwardSpeed < -20) {
          brake = Math.max(brake, throttle);
          throttle = 0;
        }
      }
    }
    gbState = gb.step(dt, vForward, throttle, slipInfo);
  }
  const reversing = gbState ? gbState.isReverse : false;
  let Fx_drive;
  let gbForceScale = 1;
  if (gbState) {
    if (!gbState.isNeutral) {
      const norm = Math.max(1e-4, gbState.forceNorm || (gb && gb._lastForceNorm) || 1);
      gbForceScale = P.engineForce / norm;
      Fx_drive = gbState.requestedForce * gbForceScale;
      const reverseCap = -Math.abs(P.engineForce) * 0.55;
      const forwardCap = Math.abs(P.engineForce) * 1.2;
      Fx_drive = clamp(Fx_drive, reverseCap, forwardCap);
      if (gbState.isReverse) {
        Fx_drive = Math.max(Fx_drive, reverseCap);
      }
    } else {
      Fx_drive = 0;
    }
  } else {
    Fx_drive = throttle * P.engineForce;
  }
  if (!reversing && !throttlePressedGlobal && !brakePressedGlobal) {
    Fx_drive -= clamp(Fx_drive, -P.engineForce * 0.18, P.engineForce * 0.18);
  }
    const vxAbsSmall = Math.abs(vx);
    const brakeForceCmd = brake * P.brakeForce;
    let Fx_brake = 0;
    if (brakeForceCmd > 0) {
      if (vxAbsSmall > 2) {
        Fx_brake = brakeForceCmd * sign(vx);
      } else if (vxAbsSmall > 0.25) {
        Fx_brake = brakeForceCmd * sign(vx === 0 ? (reversing ? -1 : 1) : vx);
      } else if (vxAbsSmall > 0.02) {
        const scale = clamp(-vx / 0.25, -1, 1);
        Fx_brake = brakeForceCmd * scale;
      }
    }
    // Body X resistances (drag/roll) oppose motion
    const vmag = Math.max(eps, Math.hypot(vx, vy));
    const ux_bx = vx / vmag; // projection of velocity direction on body X
    const F_drag = dragK * vmag * vmag * ux_bx;
    const F_roll = rollK * vmag * ux_bx;

    // Compute command-only acceleration estimate for load transfer
    const Fx_cmd = Fx_drive - Fx_brake;
    const ax_est = (Fx_cmd - F_drag - F_roll) / mass;

    // Longitudinal load transfer update
    const cgH = (P.cgHeight!=null?P.cgHeight:8);
    if (cgH > 0) {
      const dF = mass * cgH * ax_est / L; // shift proportional to accel
      Fzf = clamp(loadsStatic.Fzf - dF, 0, mass*g);
      Fzr = clamp(loadsStatic.Fzr + dF, 0, mass*g);
      // Recompute load-sensitive mu and cornering stiffness with updated loads
      muLatF = muLat * (1 - loadSenseK * (Fzf / Math.max(1e-6, Fzf_ref) - 1));
      muLatR = muLat * (1 - loadSenseK * (Fzr / Math.max(1e-6, Fzr_ref) - 1));
      Cf = muLatF * Fzf / slip0;
      Cr = muLatR * Fzr / slip0;
    }
    car.physics.lastFzf = Fzf; car.physics.lastFzr = Fzr;

    // Now compute lateral forces with updated loads (mu load-sensitive per axle)
    if (reversing) {
      Cf *= 0.6;
      Cr *= 0.6;
    }
    let FyF_unc = tireLateralForce(muLatF, Fzf, Cf, slipF);
    FyR_unc = tireLateralForce(muLatR, Fzr, Cr, slipR);

    // Longitudinal load-sensitivity for grip (effective muLong per axle)
    const kL = (P.muLongLoadSenseK != null ? P.muLongLoadSenseK : 0.04);
    const muLongEffF = muLong * (1 - kL * (Fzf / Math.max(1e-6, Fzf_ref) - 1));
    const muLongEffR = muLong * (1 - kL * (Fzr / Math.max(1e-6, Fzr_ref) - 1));

    // Front combined-slip ellipse (trail-braking reduces lateral)
    const frontCircle = (P.frontCircle != null ? P.frontCircle : (P.rearCircle != null ? P.rearCircle : 0.5));
    const brakeFrontShare = (P.brakeFrontShare != null ? P.brakeFrontShare : 0.6);
    const FxF_cmd = -brakeFrontShare * (brake * P.brakeForce) * fwd;
    if (frontCircle > 0) {
      const uxF = (muLongEffF * Fzf > 1e-6) ? (FxF_cmd / (muLongEffF * Fzf)) : 0;
      const uyF = (muLatF * Fzf > 1e-6) ? (FyF_unc  / (muLatF * Fzf)) : 0;
      const lambdaF = Math.hypot(uxF, uyF);
      if (lambdaF > 1) {
        FyF_unc = FyF_unc / (1 + frontCircle * (lambdaF - 1));
      }
      car.physics._dbgLambdaF = lambdaF;
    } else {
      car.physics._dbgLambdaF = 0;
    }
    FyF = FyF_unc;

    // Mild rear combined slip limiting (scale only lateral)
    const rearCircle = (P.rearCircle!=null?P.rearCircle:0.5);
    let lambda = 0;
    if (rearCircle > 0) {
      // Use wheel-originated longitudinal at rear contact for combined slip
      const brakeFrontShare = (P.brakeFrontShare != null ? P.brakeFrontShare : 0.6);
      const brakeRearShare = 1 - brakeFrontShare;
      const FxR_cmd = Fx_drive - brakeRearShare * (brake * P.brakeForce) * (reversing ? -1 : sign(vx));
      const uxR = (muLongEffR*Fzr>1e-6) ? (FxR_cmd / (muLongEffR * Fzr)) : 0;
      const uy = (muLatR*Fzr>1e-6) ? (FyR_unc / (muLatR * Fzr)) : 0;
      lambda = Math.hypot(uxR, uy);
      if (lambda > 1) {
        FyR_unc = FyR_unc / (1 + rearCircle * (lambda - 1));
      }
      car.physics._dbgLambda = lambda;
    } else car.physics._dbgLambda = 0;
    let FyR = FyR_unc;

    // Now compute post-transfer longitudinal traction using slip ratio
    const Fr_max = muLongEffR * Fzr;
    const sPeak  = (P.longSlipPeak != null ? P.longSlipPeak : 0.18);
    const s_req  = Fr_max > 1e-6 ? (Fx_cmd / Fr_max) : 0;
    const s_eff  = clamp(s_req, -1, 1);
    if (Math.abs(s_req) > sPeak) {
      const overPeak = Math.min(1, Math.abs(s_req) - sPeak);
      const latScale = Math.max(0, 1 - 0.35 * overPeak);
      FyR *= latScale;
    }
    const falloff= (P.longSlipFalloff != null ? P.longSlipFalloff : 0.80);
    let Fx_trac = Fr_max * slipRatioResponse(s_eff, sPeak, falloff);
    const FxCapAbs = Math.abs(P && typeof P.engineForce === 'number' ? P.engineForce : 500) * 1.6;
    Fx_trac = clamp(Fx_trac, -FxCapAbs, FxCapAbs);
    if (gb) {
      const gbOut = gbState ? { ...gbState } : { rpm: gb.rpm|0, gear: gb.gear, requestedForce: Fx_drive, clutchLock: gb.clutchLock };
      gbOut.forceScale = gbForceScale;
      gbOut.requestedForceRaw = gbState ? gbState.requestedForce : Fx_drive;
      gbOut.requestedForce = Fx_drive;
      car.physics.lastGb = gbOut;
      gb.lastRequestedForce = Fx_drive;
      gb.lastForceScale = gbForceScale;
    } else {
      car.physics.lastGb = null;
    }
    car.physics.lastSlipReq = s_req;
    car.physics.prevDriveSlip = Math.max(0, Math.abs(s_req) - sPeak);
    let Fx_long = Fx_trac - F_drag - F_roll;
    const FxLongCap = FxCapAbs * 1.1;
    Fx_long = clamp(Fx_long, -FxLongCap, FxLongCap);
    const ax = Fx_long / mass;
    car.physics.lastAx = ax;
    car.physics._dbgFyR_avail = muLatR * Fzr;
    car.physics._dbgUx = Math.min(1, Math.abs(Fx_long)/Math.max(1e-6, Fr_max));
    car.physics._dbgFyR = FyR;

    if (usePlanck && planckBody) {
      const pl = window.planck;
      if (pl) {
        const cosA = Math.cos(car.angle);
        const sinA = Math.sin(car.angle);
        const toWorld = (Fx, Fy) => ({ x: Fx * cosA - Fy * sinA, y: Fx * sinA + Fy * cosA });
        const FxFyToVec = (Fx, Fy) => toWorld(Fx, Fy);
        const aM = meters(a, ppm);
        const bM = meters(b, ppm);
        const frontLocal = pl.Vec2(aM, 0);
        const rearLocal = pl.Vec2(-bM, 0);
        const frontWorld = FxFyToVec(0, FyF);
        const rearWorld = FxFyToVec(Fx_trac, FyR);
        const dragWorld = FxFyToVec(-F_drag, 0);
        const rollWorld = FxFyToVec(-F_roll, 0);
        const scaleForce = (vec) => pl.Vec2(vec.x / ppm, vec.y / ppm);
        planckBody.applyForce(scaleForce(frontWorld), planckBody.getWorldPoint(frontLocal));
        planckBody.applyForce(scaleForce(rearWorld), planckBody.getWorldPoint(rearLocal));
        const resist = pl.Vec2((dragWorld.x + rollWorld.x) / ppm, (dragWorld.y + rollWorld.y) / ppm);
        planckBody.applyForce(resist, planckBody.getWorldCenter());
        const yawDampK = (P.yawDampK!=null?P.yawDampK:0.12);
        if (yawDampK) {
          const torquePx = -yawDampK * car.physics.r * Izz;
          planckBody.applyTorque(torquePx / (ppm * ppm));
        }
      }
    }

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
      dr_kine = (vxSigned / L) * Math.tan(deltaEff);
      dvy_kine = dr_kine * vxSigned; // rotate forward velocity into lateral
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

    if (!usePlanck) {
      vx += dvx * dt;
      vy += dvy * dt;
      car.physics.r += dr * dt;

      const vw = bodyToWorld(vx, vy, car.angle);
      car.physics.vx = vw.x;
      car.physics.vy = vw.y;
      car.vx = car.physics.vx;
      car.vy = car.physics.vy;
      car.x += car.physics.vx * dt;
      car.y += car.physics.vy * dt;
      car.angle += car.physics.r * dt;
    }

  // Cache debug values
  car.physics.lastSlipF = slipF;
  car.physics.lastSlipR = slipR;
  car.physics.lastFx_long = Fx_long;
  car.physics.lastFwd = fwd;
  car.physics.lastDeltaEff = deltaEff;
  car.physics.lastLambda = car.physics._dbgLambda || 0;
  car.physics.lastReversing = reversing;

    // Additional damping at very low speeds to prevent runaway spin/creep
    const speedMag = Math.hypot(car.physics.vx, car.physics.vy);
    const maxSpeedClamp = 520;
    if (speedMag > maxSpeedClamp) {
      const scale = maxSpeedClamp / speedMag;
      car.physics.vx *= scale;
      car.physics.vy *= scale;
      car.vx = car.physics.vx;
      car.vy = car.physics.vy;
      if (usePlanck && car.physics.planckBody && typeof car.physics.planckBody.getLinearVelocity === 'function') {
        const lv = car.physics.planckBody.getLinearVelocity();
        if (lv && typeof lv === 'object' && typeof car.physics.planckBody.setLinearVelocity === 'function') {
          lv.x *= scale;
          lv.y *= scale;
          car.physics.planckBody.setLinearVelocity(lv);
        }
      }
    }
    const angMax = 7.5;
    if (Math.abs(car.physics.r) > angMax) {
      car.physics.r = clamp(car.physics.r, -angMax, angMax);
      if (usePlanck && car.physics.planckBody && typeof car.physics.planckBody.getAngularVelocity === 'function' && typeof car.physics.planckBody.setAngularVelocity === 'function') {
        const omega = car.physics.planckBody.getAngularVelocity();
        const clampedOmega = Math.max(-angMax, Math.min(angMax, omega));
        car.physics.planckBody.setAngularVelocity(clampedOmega);
      }
    }
    const lowInput = Math.abs(throttle) < 0.04 && brake < 0.04;
    const neutralHold = gbState && gbState.isNeutral && speedMag < 10;
    if (neutralHold) {
      car.physics.vx = 0;
      car.physics.vy = 0;
      car.physics.r = 0;
      car.vx = 0;
      car.vy = 0;
      if (usePlanck && car.physics.planckBody) {
        if (typeof car.physics.planckBody.setLinearVelocity === "function") {
          const pl = (typeof window !== "undefined" && window.planck) ? window.planck : null;
          if (pl && typeof pl.Vec2 === "function") {
            car.physics.planckBody.setLinearVelocity(pl.Vec2(0, 0));
          } else if (typeof car.physics.planckBody.getLinearVelocity === "function") {
            const lv = car.physics.planckBody.getLinearVelocity();
            if (lv && typeof lv === "object" && "x" in lv && "y" in lv) {
              lv.x = 0;
              lv.y = 0;
              car.physics.planckBody.setLinearVelocity(lv);
            }
          }
        }
        if (typeof car.physics.planckBody.setAngularVelocity === "function") {
          car.physics.planckBody.setAngularVelocity(0);
        }
      }
    } else if (speedMag < 35 && lowInput) {
      const linDamp = Math.exp(-dt * 18);
      const angDamp = Math.exp(-dt * 22);
      car.physics.vx *= linDamp;
      car.physics.vy *= linDamp;
      car.physics.r *= angDamp;
      const body = car.physics.planckBody;
      if (usePlanck && body) {
        if (typeof body.getLinearVelocity === 'function' && typeof body.setLinearVelocity === 'function') {
          const lv = body.getLinearVelocity();
          if (lv && typeof lv === 'object') {
            lv.x *= linDamp;
            lv.y *= linDamp;
            body.setLinearVelocity(lv);
          }
        }
        if (typeof body.getAngularVelocity === 'function' && typeof body.setAngularVelocity === 'function') {
          body.setAngularVelocity(body.getAngularVelocity() * angDamp);
        }
      }
    }

    // Derived properties for compatibility
    car.speed = Math.hypot(car.physics.vx, car.physics.vy);
    car.sfxThrottle = throttle;
    car.sfxRPM = gb ? gb.rpm : 0;
    car.sfxGear = gb ? gb.gear : 0;
    car.sfxDriveForce = gb ? (gb.lastRequestedForce ?? 0) : 0;
    car.sfxGrass = !onRoad;

    // Skid intensity from combined slip
    const skidLatRaw = Math.max(0, Math.min(1, (Math.abs(slipF) + Math.abs(slipR)) / (2*0.35)));
    const driveSlipRaw = Math.max(0, Math.min(1, Math.abs(Fx_long) / Math.max(1, muLong * Fzr) - 0.85));
    const skidSpeedThreshold = (P.skidSpeedThreshold != null ? P.skidSpeedThreshold : 120);
    const skidEligible = !reversing && vxAbs > 60 && car.speed > skidSpeedThreshold; // suppress low-speed or backward skids
    const skid = skidEligible ? clamp(0.5*skidLatRaw + 0.5*driveSlipRaw, 0, 1) : 0;
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
      reversing,
      skidEligible
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
        const gbState = car.physics.lastGb || (car.gearbox ? {
          gear: car.gearbox.gear,
          rpm: car.gearbox.rpm,
          requestedForce: car.gearbox.lastRequestedForce ?? 0
        } : null);
        const slipReq = car.physics.lastSlipReq != null ? car.physics.lastSlipReq : 0;
        const gbLine = gbState ? ` G${gbState.gear} ${Math.round(gbState.rpm||0)}rpm ReqF=${Math.round(gbState.requestedForce||0)} Slip=${Math.round(Math.abs(slipReq)*100)}%` : '';
        const line = `fwd=${(p.lastFwd!=null?p.lastFwd:1)} ${(p.lastReversing?'REV ':'')}|v|=${speedMag.toFixed(1)} vx=${(car.physics.vx||0).toFixed(1)} vy=${(car.physics.vy||0).toFixed(1)} dEff=${(p.lastDeltaEff||0).toFixed(3)} slipF=${(p.lastSlipF||0).toFixed(3)} slipR=${(p.lastSlipR||0).toFixed(3)} lambda=${lambda.toFixed(2)} ax=${(p.lastAx||0).toFixed(2)} FzF=${(p.lastFzf||0).toFixed(0)} FzR=${(p.lastFzr||0).toFixed(0)} ${(p.lastAlphaBlend<0.999)?'KIN':''}${gbLine}`;
        ctx.font = '11px monospace';
        ctx.textBaseline = 'top';
        const x = car.x + 20, y = car.y - 30;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; const w = ctx.measureText(line).width + 8; ctx.fillRect(x-4,y-2,w,16);
        ctx.fillStyle = (lambda>1.01) ? '#ff5050' : '#e0f2f1';
        ctx.fillText(line, x, y);
      }
    } catch(_){ }
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

    const DESCRIPTIONS = {
      vehicle: "Select which vehicle preset you are tuning.",
      applyToAI: "Apply the current tuning to AI cars as well.",
      debugOverlay: "Show on-screen debug info (forces, slip, etc.).",
      usePlanck: "Use Planck (Box2D) for integration/collisions. Off = legacy integrator.",
      pixelsPerMeter: "Scale from pixels to physics meters. Affects body sizes in the solver.",
      linearDamp: "Planck: global damping on linear velocity. Prefer Drag/Rolling for coasting.",
      angularDamp: "Planck: damping on yaw (rotational) velocity. Prefer Yaw damp for tuning feel.",
      restitution: "Bounciness on wall impacts.",
      velIters: "Solver velocity iterations. Higher = more accurate contacts (slower).",
      posIters: "Solver position iterations. Higher = fewer penetrations (slower).",
      mass: "Car mass & inertia. Higher = more planted, harder to spin; may need more Brake.",
      engineForce: "Peak engine drive force. Higher = stronger acceleration.",
      brakeForce: "Peak braking force. Higher = shorter stops; too high can overwhelm grip.",
      maxSteer: "Maximum steering lock. Higher = tighter turns, riskier at speed.",
      steerSpeed: "How fast steering moves toward target. Higher = snappier steering.",
      muLatRoad: "Sideways (lateral) grip on road. Raises cornering limit before slide.",
      muLongRoad: "Forward/back (longitudinal) grip on road. Affects traction & braking.",
      muLatGrass: "Sideways grip on grass (usually much lower than road).",
      muLongGrass: "Forward/back grip on grass (usually lower than road).",
      dragK: "Aerodynamic drag (~speed²). Higher = more lift-off decel & lower top speed.",
      rollK: "Rolling resistance (~speed). Higher = more coasting loss at any speed.",
      rearCircle: "Rear combined-slip blend. Higher = rear loses lateral sooner under drive/brake (stabilizes on throttle).",
      frontCircle: "Front combined-slip blend. Higher = front loses lateral sooner under braking (reduces trail-brake bite).",
      brakeFrontShare: "Front brake bias (0.50 = 50% front). Higher = more front braking, less rear lock.",
      longSlipPeak: "Slip ratio at which drive/brake force peaks. Higher = peak at larger slip (strong bite).",
      longSlipFalloff: "How gently force falls after the peak. Higher = softer, more forgiving breakaway.",
      loadSenseK: "Lateral load sensitivity. Higher = diminishing returns with load (tames extremes).",
      muLongLoadSenseK: "Longitudinal load sensitivity. Higher = traction/braking gain less with load.",
      downforceK: "Speed-based downforce. Higher = more high-speed grip without changing low-speed feel.",
      vKineBlend: "Low-speed kinematic blend (legacy helper). Often inactive when Planck is on.",
      cgHeight: "CG height for accel/brake weight transfer. Higher = stronger lift-off oversteer.",
      yawDampK: "Extra yaw damping torque. Higher = rotations settle faster.",
      reverseEntry: "Speed threshold/window to allow reverse mode.",
      reverseTorque: "Percent of engine torque available in reverse.",
      rebuildWorld: "Rebuild the Planck physics world/bodies with current settings.",
      resetDefaults: "Reset this vehicle’s sliders to default values."
    };

    const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const tipAttr = (key) => {
      const desc = DESCRIPTIONS[key];
      return desc ? ` title="${escapeAttr(desc)}"` : '';
    };

    const wrap = document.createElement('div');
    wrap.id = 'rv-devtools';
    wrap.className = 'rv-devtools';
    wrap.innerHTML = `
      <button class="toggle">Dev tools ▾</button>
      <div class="rv-panel" role="dialog" aria-label="Dev tools">
        <div class="rv-row"><label for="rv-kind"><span class="rv-name"${tipAttr('vehicle')}>Vehicle</span></label>
          <select id="rv-kind">
            <option>F1</option><option selected>GT</option><option>Rally</option><option>Truck</option>
          </select>
          <label class="small" for="rv-apply-ai"><input type="checkbox" id="rv-apply-ai"> <span class="rv-name"${tipAttr('applyToAI')}>Apply to AI</span></label>
        </div>
        <div class="rv-row"><label for="rv-debug"><span class="rv-name"${tipAttr('debugOverlay')}>Debug overlay</span></label><input type="checkbox" id="rv-debug"></div>
        <div class="rv-row"><label for="rv-planck"><span class="rv-name"${tipAttr('usePlanck')}>Use Planck</span></label><input type="checkbox" id="rv-planck"></div>
        <div class="rv-row"><label for="rv-ppm"><span class="rv-name"${tipAttr('pixelsPerMeter')}>Pixels / m</span></label><input id="rv-ppm" type="number" min="5" max="200" step="1"></div>
        <div class="rv-row"><label for="rv-ldamp"><span class="rv-name"${tipAttr('linearDamp')}>Linear damp</span></label><input id="rv-ldamp" type="range" min="0" max="5" step="0.05"><div class="val" id="rv-ldamp-v"></div></div>
        <div class="rv-row"><label for="rv-adamp"><span class="rv-name"${tipAttr('angularDamp')}>Angular damp</span></label><input id="rv-adamp" type="range" min="0" max="5" step="0.05"><div class="val" id="rv-adamp-v"></div></div>
        <div class="rv-row"><label for="rv-rest"><span class="rv-name"${tipAttr('restitution')}>Restitution</span></label><input id="rv-rest" type="range" min="0" max="1" step="0.02"><div class="val" id="rv-rest-v"></div></div>
        <div class="rv-row"><label for="rv-veliters"><span class="rv-name"${tipAttr('velIters')}>Vel iters</span></label><input id="rv-veliters" type="number" min="1" max="50" step="1"></div>
        <div class="rv-row"><label for="rv-positers"><span class="rv-name"${tipAttr('posIters')}>Pos iters</span></label><input id="rv-positers" type="number" min="1" max="50" step="1"></div>
        <div class="rv-row"><label for="rv-mass"><span class="rv-name"${tipAttr('mass')}>Mass</span></label><input id="rv-mass" type="range" min="0.6" max="2.2" step="0.05"><div class="val" id="rv-mass-v"></div></div>
        <div class="rv-row"><label for="rv-eng"><span class="rv-name"${tipAttr('engineForce')}>Engine</span></label><input id="rv-eng" type="range" min="280" max="900" step="10"><div class="val" id="rv-eng-v"></div></div>
        <div class="rv-row"><label for="rv-brk"><span class="rv-name"${tipAttr('brakeForce')}>Brake</span></label><input id="rv-brk" type="range" min="380" max="1100" step="10"><div class="val" id="rv-brk-v"></div></div>
        <div class="rv-row"><label for="rv-steer"><span class="rv-name"${tipAttr('maxSteer')}>Max steer</span></label><input id="rv-steer" type="range" min="0.25" max="0.85" step="0.01"><div class="val" id="rv-steer-v"></div></div>
        <div class="rv-row"><label for="rv-steers"><span class="rv-name"${tipAttr('steerSpeed')}>Steer speed</span></label><input id="rv-steers" type="range" min="2" max="10" step="0.1"><div class="val" id="rv-steers-v"></div></div>
        <div class="rv-row"><label for="rv-mulr"><span class="rv-name"${tipAttr('muLatRoad')}>Grip lat (road)</span></label><input id="rv-mulr" type="range" min="0.8" max="2.2" step="0.05"><div class="val" id="rv-mulr-v"></div></div>
        <div class="rv-row"><label for="rv-muor"><span class="rv-name"${tipAttr('muLongRoad')}>Grip long (road)</span></label><input id="rv-muor" type="range" min="0.6" max="1.8" step="0.05"><div class="val" id="rv-muor-v"></div></div>
        <div class="rv-row"><label for="rv-mulg"><span class="rv-name"${tipAttr('muLatGrass')}>Grip lat (grass)</span></label><input id="rv-mulg" type="range" min="0.3" max="1.0" step="0.02"><div class="val" id="rv-mulg-v"></div></div>
        <div class="rv-row"><label for="rv-muog"><span class="rv-name"${tipAttr('muLongGrass')}>Grip long (grass)</span></label><input id="rv-muog" type="range" min="0.25" max="0.9" step="0.02"><div class="val" id="rv-muog-v"></div></div>
        <div class="rv-row"><label for="rv-drag"><span class="rv-name"${tipAttr('dragK')}>Drag</span></label><input id="rv-drag" type="range" min="0.001" max="0.0035" step="0.0001"><div class="val" id="rv-drag-v"></div></div>
        <div class="rv-row"><label for="rv-roll"><span class="rv-name"${tipAttr('rollK')}>Rolling</span></label><input id="rv-roll" type="range" min="0.10" max="0.35" step="0.005"><div class="val" id="rv-roll-v"></div></div>
        <div class="rv-row"><label for="rv-rearc"><span class="rv-name"${tipAttr('rearCircle')}>Rear circle</span></label><input id="rv-rearc" type="range" min="0.00" max="1.00" step="0.05"><div class="val" id="rv-rearc-v"></div></div>
        <div class="rv-row"><label for="rv-frontc"><span class="rv-name"${tipAttr('frontCircle')}>Front circle</span></label><input id="rv-frontc" type="range" min="0.00" max="1.00" step="0.05"><div class="val" id="rv-frontc-v"></div></div>
        <div class="rv-row"><label for="rv-brkfs"><span class="rv-name"${tipAttr('brakeFrontShare')}>Brake F share</span></label><input id="rv-brkfs" type="range" min="0.30" max="0.80" step="0.02"><div class="val" id="rv-brkfs-v"></div></div>
        <div class="rv-row"><label for="rv-lspe"><span class="rv-name"${tipAttr('longSlipPeak')}>Long slip peak</span></label><input id="rv-lspe" type="range" min="0.08" max="0.30" step="0.01"><div class="val" id="rv-lspe-v"></div></div>
        <div class="rv-row"><label for="rv-lsfo"><span class="rv-name"${tipAttr('longSlipFalloff')}>Long falloff</span></label><input id="rv-lsfo" type="range" min="0.40" max="1.00" step="0.01"><div class="val" id="rv-lsfo-v"></div></div>
        <div class="rv-row"><label for="rv-llat"><span class="rv-name"${tipAttr('loadSenseK')}>Lat load K</span></label><input id="rv-llat" type="range" min="0.00" max="0.20" step="0.01"><div class="val" id="rv-llat-v"></div></div>
        <div class="rv-row"><label for="rv-llong"><span class="rv-name"${tipAttr('muLongLoadSenseK')}>Long load K</span></label><input id="rv-llong" type="range" min="0.00" max="0.20" step="0.01"><div class="val" id="rv-llong-v"></div></div>
        <div class="rv-row"><label for="rv-df"><span class="rv-name"${tipAttr('downforceK')}>DownforceK</span></label><input id="rv-df" type="range" min="0.0000" max="0.0050" step="0.00005"><div class="val" id="rv-df-v"></div></div>
        <div class="rv-row"><label for="rv-vkine"><span class="rv-name"${tipAttr('vKineBlend')}>vKineBlend</span></label><input id="rv-vkine" type="range" min="0.0" max="5.0" step="0.1"><div class="val" id="rv-vkine-v"></div></div>
        <div class="rv-row"><label for="rv-cgh"><span class="rv-name"${tipAttr('cgHeight')}>cgHeight</span></label><input id="rv-cgh" type="range" min="0" max="14" step="1"><div class="val" id="rv-cgh-v"></div></div>
        <div class="rv-row"><label for="rv-yawd"><span class="rv-name"${tipAttr('yawDampK')}>Yaw damp</span></label><input id="rv-yawd" type="range" min="0" max="0.30" step="0.02"><div class="val" id="rv-yawd-v"></div></div>
        <div class="rv-row"><label for="rv-reventry"><span class="rv-name"${tipAttr('reverseEntry')}>Reverse entry</span></label><input id="rv-reventry" type="range" min="0" max="120" step="5"><div class="val" id="rv-reventry-v"></div></div>
        <div class="rv-row"><label for="rv-revtorque"><span class="rv-name"${tipAttr('reverseTorque')}>Reverse torque</span></label><input id="rv-revtorque" type="range" min="0.30" max="1.00" step="0.05"><div class="val" id="rv-revtorque-v"></div></div>
        <div class="rv-row"><button id="rv-planck-rebuild"${tipAttr('rebuildWorld')}>Rebuild physics world</button></div>
        <div class="rv-row"><button id="rv-reset"${tipAttr('resetDefaults')}>Reset defaults</button></div>
      </div>`;
    document.body.appendChild(wrap);

    const panel = wrap.querySelector('.rv-panel');
    const toggle = wrap.querySelector('.toggle');
    toggle.addEventListener('click', ()=>{ panel.classList.toggle('open'); });

    const els = {
      kind: wrap.querySelector('#rv-kind'),
      applyAI: wrap.querySelector('#rv-apply-ai'),
      debug: wrap.querySelector('#rv-debug'),
  planck: wrap.querySelector('#rv-planck'),
  ppm: wrap.querySelector('#rv-ppm'),
  ldamp: wrap.querySelector('#rv-ldamp'),     ldampV: wrap.querySelector('#rv-ldamp-v'),
  adamp: wrap.querySelector('#rv-adamp'),     adampV: wrap.querySelector('#rv-adamp-v'),
  rest: wrap.querySelector('#rv-rest'),       restV: wrap.querySelector('#rv-rest-v'),
  veliters: wrap.querySelector('#rv-veliters'),
  positers: wrap.querySelector('#rv-positers'),
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
  frontc: wrap.querySelector('#rv-frontc'), frontcV: wrap.querySelector('#rv-frontc-v'),
  brkfs: wrap.querySelector('#rv-brkfs'), brkfsV: wrap.querySelector('#rv-brkfs-v'),
  lspe: wrap.querySelector('#rv-lspe'), lspeV: wrap.querySelector('#rv-lspe-v'),
  lsfo: wrap.querySelector('#rv-lsfo'), lsfoV: wrap.querySelector('#rv-lsfo-v'),
  llat: wrap.querySelector('#rv-llat'), llatV: wrap.querySelector('#rv-llat-v'),
  llong: wrap.querySelector('#rv-llong'), llongV: wrap.querySelector('#rv-llong-v'),
  df: wrap.querySelector('#rv-df'), dfV: wrap.querySelector('#rv-df-v'),
  vkine: wrap.querySelector('#rv-vkine'), vkineV: wrap.querySelector('#rv-vkine-v'),
  cgh: wrap.querySelector('#rv-cgh'), cghV: wrap.querySelector('#rv-cgh-v'),
  yawd: wrap.querySelector('#rv-yawd'), yawdV: wrap.querySelector('#rv-yawd-v'),
  reventry: wrap.querySelector('#rv-reventry'), reventryV: wrap.querySelector('#rv-reventry-v'),
  revtorque: wrap.querySelector('#rv-revtorque'), revtorqueV: wrap.querySelector('#rv-revtorque-v'),
      planckRebuild: wrap.querySelector('#rv-planck-rebuild'),
      reset: wrap.querySelector('#rv-reset')
    };

    function refresh(kind){
      const k = kind || els.kind.value;
      const d = VEHICLE_DEFAULTS[k];
      els.planck.checked = !!(d.usePlanck !== false);
      if (els.ppm) els.ppm.value = (d.pixelsPerMeter != null ? d.pixelsPerMeter : PPM_DEFAULT);
      const ld = d.linearDamp != null ? d.linearDamp : 0;
      els.ldamp.value = ld;
      els.ldampV.textContent = ld.toFixed(2);
      const ad = d.angularDamp != null ? d.angularDamp : 0;
      els.adamp.value = ad;
      els.adampV.textContent = ad.toFixed(2);
      const rest = d.restitution != null ? d.restitution : 0;
      els.rest.value = rest;
      els.restV.textContent = rest.toFixed(2);
      els.veliters.value = (d.velIters != null ? d.velIters : PLANCK_DEFAULTS.velIters);
      els.positers.value = (d.posIters != null ? d.posIters : PLANCK_DEFAULTS.posIters);
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
  els.frontc.value = (d.frontCircle!=null?d.frontCircle:0.50).toFixed(2); els.frontcV.textContent = (+els.frontc.value).toFixed(2);
  els.brkfs.value = (d.brakeFrontShare!=null?d.brakeFrontShare:0.60).toFixed(2); els.brkfsV.textContent = (+els.brkfs.value).toFixed(2);
  els.lspe.value = (d.longSlipPeak!=null?d.longSlipPeak:0.18).toFixed(2); els.lspeV.textContent = (+els.lspe.value).toFixed(2);
  els.lsfo.value = (d.longSlipFalloff!=null?d.longSlipFalloff:0.80).toFixed(2); els.lsfoV.textContent = (+els.lsfo.value).toFixed(2);
  els.llat.value = (d.loadSenseK!=null?d.loadSenseK:0.08).toFixed(2); els.llatV.textContent = (+els.llat.value).toFixed(2);
  els.llong.value = (d.muLongLoadSenseK!=null?d.muLongLoadSenseK:0.04).toFixed(2); els.llongV.textContent = (+els.llong.value).toFixed(2);
  els.df.value = (d.downforceK!=null?d.downforceK:0.00025).toFixed(5); els.dfV.textContent = (+els.df.value).toFixed(5);
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
        usePlanck: !!els.planck.checked,
        pixelsPerMeter: Math.max(1, +els.ppm.value || PLANCK_DEFAULTS.pixelsPerMeter),
        linearDamp: +els.ldamp.value,
        angularDamp: +els.adamp.value,
        restitution: +els.rest.value,
        velIters: clamp(+els.veliters.value || PLANCK_DEFAULTS.velIters, 1, 50),
        posIters: clamp(+els.positers.value || PLANCK_DEFAULTS.posIters, 1, 50),
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
  frontCircle: +els.frontc.value,
  brakeFrontShare: +els.brkfs.value,
  longSlipPeak: +els.lspe.value,
  longSlipFalloff: +els.lsfo.value,
  loadSenseK: +els.llat.value,
  muLongLoadSenseK: +els.llong.value,
  downforceK: +els.df.value,
  vKineBlend: +els.vkine.value,
  cgHeight: +els.cgh.value,
  yawDampK: +els.yawd.value,
  reverseEntrySpeed: +els.reventry.value,
  reverseTorqueScale: +els.revtorque.value
      };
      const cars = (getCars && getCars()) || {};
      const applyTo = [cars.player].filter(Boolean);
      if (els.applyAI.checked && Array.isArray(cars.ai)) applyTo.push(...cars.ai);
      for (const c of applyTo){
        if (!c) continue;
        if (!c.physics) initCar(c, c.kind);
        c.physics.params = { ...c.physics.params, ...p };
        if (c.physics.planckBody) {
          const body = c.physics.planckBody;
          try {
            body.setLinearDamping(p.linearDamp ?? 0);
            body.setAngularDamping(p.angularDamp ?? 0);
            for (let fix = body.getFixtureList(); fix; fix = fix.getNext()) {
              fix.setFriction(p.contactFriction != null ? p.contactFriction : 0.45);
              fix.setRestitution(p.restitution ?? planckState.restitution);
            }
          } catch(_){/* ignore */}
        }
      }
      registerPlanckCars(applyTo);
      if (p.usePlanck) {
        planckState.ppm = p.pixelsPerMeter;
        planckState.velIters = p.velIters;
        planckState.posIters = p.posIters;
        planckState.restitution = p.restitution;
        planckState.doSleep = p.planckDoSleep != null ? !!p.planckDoSleep : planckState.doSleep;
        planckState.needsWorldBuild = true;
      }
      setDebugEnabled(!!els.debug.checked);
      refresh(k);
    }

  for (const key of ['ldamp','adamp','rest','mass','eng','brk','steer','steers','mulr','muor','mulg','muog','drag','roll','rearc','frontc','brkfs','lspe','lsfo','llat','llong','df','vkine','cgh','yawd','reventry','revtorque']){
      els[key].addEventListener('input', ()=>{ const v = els[key].value; const label = key+'V'; if (els[label]) els[label].textContent = (''+v).slice(0, (key==='drag'?6:(key==='revtorque'?6:4))); apply(); });
    }
    els.kind.addEventListener('change', ()=>refresh(els.kind.value));
    if (els.planck) els.planck.addEventListener('change', apply);
    if (els.ppm) els.ppm.addEventListener('change', apply);
    if (els.veliters) els.veliters.addEventListener('change', apply);
    if (els.positers) els.positers.addEventListener('change', apply);
    if (els.planckRebuild) {
      els.planckRebuild.addEventListener('click', ()=>{
        apply();
        if (typeof rebuildPlanckWorld === 'function' && getCars) {
          const cset = getCars() || {};
          const list = [];
          if (cset.player) list.push(cset.player);
          if (Array.isArray(cset.ai)) list.push(...cset.ai);
          rebuildPlanckWorld({ cars: list });
        }
      });
    }
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
    configureTrackCollision,
    rebuildPlanckWorld,
    registerPlanckCars,
    planckBeginStep,
    planckStep,
    usesPlanckWorld,
    defaults: VEHICLE_DEFAULTS
  };
  window.RacerPhysics = API;
})();


















