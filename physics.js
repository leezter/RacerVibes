import { createWorld, stepWorld, meters, pixels, PPM_DEFAULT } from './physics/planckWorld.js';
import { buildTrackBodies } from './trackCollision.js';
import { Gearbox, gearboxDefaults, updateGearbox, getDriveForce, GEARBOX_CONFIG, suggestGearRatios } from './gearbox.js';

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
  const PHYS_CONST = {
    GRAVITY_MIN: 100,
    GRAVITY_MAX: 1500,
    GRAVITY_DEFAULT: 750
  };
  const { GRAVITY_MIN, GRAVITY_MAX, GRAVITY_DEFAULT } = PHYS_CONST;
  let g = GRAVITY_DEFAULT; // px/s^2 (tuned so GT tops ~330-350 px/s on road)

  // Default per-vehicle physical parameters (pixel-space, tuned empirically)
  const PLANCK_DEFAULTS = {
    usePlanck: true,
    pixelsPerMeter: PPM_DEFAULT,
    linearDamp: 0.00,
    angularDamp: 6.50,
  restitution: 1.0,
    velIters: 20,
    posIters: 8,
    planckDoSleep: true
  };

  // Gearbox configuration constants for Vehicle Tweaker
  const GEARBOX_DEFAULT_SPACING = 1.28; // Default spacing ratio between consecutive gears
  const GEARBOX_DEFAULT_TOP_SPEED_MPS = 64; // Default target top speed in m/s for gear ratio calculations (~1920 px/s)

  const VEHICLE_DEFAULTS = {
    F1: {
      ...PLANCK_DEFAULTS,
  mass: 2.20,
      wheelbase: 42,
      cgToFront: 20,
      cgToRear: 22,
  enginePowerMult: 1.65,
  accelDurationMult: 5.0,
  maxSpeed: 10000, // px/s - top speed cap (default: effectively unlimited)
  gearCount: 6, // number of forward gears
  brakeForce: 600,
      maxSteer: 0.55,
      steerSpeed: 6.0,
  muLatRoad: 1.40,
  muLongRoad: 1.80,
      muLatGrass: 0.55,
      muLongGrass: 0.45,
  dragK: 0.0010,
  rollK: 0.10,
  downforceK: 0.00025,
  longSlipPeak: 0.18,
  longSlipFalloff: 0.80,
  frontCircle: 0.50,
  brakeFrontShare: 0.60,
  loadSenseK: 0.08,
  muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
  vKineBlend: 1.8,
      cgHeight: 2,
        yawDampK: 0.00,
    reverseEntrySpeed: 40, // px/s threshold below which brake engages reverse
    reverseTorqueScale: 0.50, // fraction of engineForce when reversing
      touchSteer: {
        maxSteerLowSpeed: 0.75,
        maxSteerHighSpeed: 0.10,
        falloffSpeed: 340,
        baseSteerRate: 6.6,
        steerRateFalloff: 0.0035,
        returnGain: 0,
        filterTau: 0.12
      }
    },
    GT: {
      ...PLANCK_DEFAULTS,
      restitution: 0.40,
  mass: 2.20,
      wheelbase: 36,
      cgToFront: 17,
      cgToRear: 19,
  enginePowerMult: 1.65,
  accelDurationMult: 5.0,
  maxSpeed: 10000, // px/s - top speed cap (default: effectively unlimited)
  gearCount: 6, // number of forward gears
  brakeForce: 600,
      maxSteer: 0.50,
      steerSpeed: 5.0,
  muLatRoad: 1.40,
  muLongRoad: 1.80,
      muLatGrass: 0.50,
      muLongGrass: 0.40,
  dragK: 0.0010,
  rollK: 0.10,
  downforceK: 0.00025,
  longSlipPeak: 0.18,
  longSlipFalloff: 0.80,
  frontCircle: 0.50,
  brakeFrontShare: 0.60,
  loadSenseK: 0.08,
  muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
      vKineBlend: 1.8,
      cgHeight: 3,
        yawDampK: 0.30,
    reverseEntrySpeed: 40,
    reverseTorqueScale: 0.50,
      touchSteer: {
        maxSteerLowSpeed: 0.75,
        maxSteerHighSpeed: 0.10,
        falloffSpeed: 350,
        baseSteerRate: 5.4,
        steerRateFalloff: 0.0032,
        returnGain: 0,
        filterTau: 0.40
      }
    },
    Rally: {
      ...PLANCK_DEFAULTS,
  mass: 2.20,
      wheelbase: 34,
      cgToFront: 16,
      cgToRear: 18,
  enginePowerMult: 1.65,
  accelDurationMult: 5.0,
  maxSpeed: 10000, // px/s - top speed cap (default: effectively unlimited)
  gearCount: 6, // number of forward gears
  brakeForce: 600,
      maxSteer: 0.58,
      steerSpeed: 6.5,
  muLatRoad: 1.40,
  muLongRoad: 1.80,
      muLatGrass: 0.46,
      muLongGrass: 0.38,
  dragK: 0.0010,
  rollK: 0.10,
  downforceK: 0.00025,
  longSlipPeak: 0.18,
  longSlipFalloff: 0.80,
  frontCircle: 0.50,
  brakeFrontShare: 0.60,
  loadSenseK: 0.08,
  muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
  vKineBlend: 1.8,
      cgHeight: 2,
        yawDampK: 0.00,
    reverseEntrySpeed: 40,
    reverseTorqueScale: 0.50,
      touchSteer: {
        maxSteerLowSpeed: 0.75,
        maxSteerHighSpeed: 0.10,
        falloffSpeed: 220,
        baseSteerRate: 6.8,
        steerRateFalloff: 0.0038,
        returnGain: 0,
        filterTau: 0.12
      }
    },
    Truck: {
      ...PLANCK_DEFAULTS,
  mass: 2.20,
      wheelbase: 57,
      cgToFront: 27,
      cgToRear: 30,
  enginePowerMult: 1.65,
  accelDurationMult: 5.0,
  maxSpeed: 10000, // px/s - top speed cap (default: effectively unlimited)
  gearCount: 6, // number of forward gears
  brakeForce: 600,
      maxSteer: 0.40,
      steerSpeed: 3.5,
  muLatRoad: 1.40,
  muLongRoad: 1.80,
      muLatGrass: 0.42,
      muLongGrass: 0.34,
  dragK: 0.0010,
  rollK: 0.10,
  downforceK: 0.00025,
  longSlipPeak: 0.18,
  longSlipFalloff: 0.80,
  frontCircle: 0.50,
  brakeFrontShare: 0.60,
  loadSenseK: 0.08,
  muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
  vKineBlend: 1.8,
      cgHeight: 2,
        yawDampK: 0.00,
    reverseEntrySpeed: 40,
    reverseTorqueScale: 0.50,
      touchSteer: {
        maxSteerLowSpeed: 0.75,
        maxSteerHighSpeed: 0.10,
        falloffSpeed: 200,
        baseSteerRate: 3.8,
        steerRateFalloff: 0.0028,
        returnGain: 0,
        filterTau: 0.12
      }
    },
    Bubble: {
      ...PLANCK_DEFAULTS,
      restitution: 0.60,
  mass: 2.20,
      wheelbase: 28,
      cgToFront: 14,
      cgToRear: 14,
  enginePowerMult: 1.65,
  accelDurationMult: 5.0,
  maxSpeed: 10000, // px/s - top speed cap (default: effectively unlimited)
  gearCount: 6, // number of forward gears
  brakeForce: 600,
      maxSteer: 0.52,
      steerSpeed: 5.5,
  muLatRoad: 1.40,
  muLongRoad: 1.80,
      muLatGrass: 0.48,
      muLongGrass: 0.40,
  dragK: 0.0010,
  rollK: 0.10,
  downforceK: 0.00025,
  longSlipPeak: 0.18,
  longSlipFalloff: 0.80,
  frontCircle: 0.50,
  brakeFrontShare: 0.60,
  loadSenseK: 0.08,
  muLongLoadSenseK: 0.04,
      rearCircle: 0.50,
  vKineBlend: 1.8,
      cgHeight: 2,
        yawDampK: 0.00,
    reverseEntrySpeed: 40,
    reverseTorqueScale: 0.50,
      touchSteer: {
        maxSteerLowSpeed: 0.75,
        maxSteerHighSpeed: 0.10,
        falloffSpeed: 260,
        baseSteerRate: 5.8,
        steerRateFalloff: 0.0035,
        returnGain: 0,
        filterTau: 0.15
      }
    }
  };

  const fallbackClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clamp = window.RacerUtils && typeof window.RacerUtils.clamp === 'function'
    ? window.RacerUtils.clamp
    : fallbackClamp;
  const fallbackSign = (x) => (x < 0 ? -1 : x > 0 ? 1 : 0);
  const sign = window.RacerUtils && typeof window.RacerUtils.sign === 'function'
    ? window.RacerUtils.sign
    : fallbackSign;

  function inferIzz(mass, length, width){
    // Rectangular body moment around vertical (top-down)
    return mass * (length*length + width*width) / 12;
  }

  function recordColliderHull(car, widthPx, lengthPx){
    if (!car) return;
    const resolvedWidth = Number.isFinite(widthPx)
      ? widthPx
      : (car.colliderWidth || car.width || 18);
    const resolvedLength = Number.isFinite(lengthPx)
      ? lengthPx
      : (car.colliderLength || car.length || 36);
    if (!car.physics) car.physics = {};
    car.physics.colliderHull = {
      width: resolvedWidth,
      length: resolvedLength
    };
  }

  let sharedPlanckRefresh = null;

  function injectVehicleTweaker(bridge = {}, getCars){
    const existing = document.getElementById('rv-vehicle-tweaker');
    if (existing) {
      // Check version - v1.3+ has the gear count slider
      const version = existing.dataset.version;
      if (version === '1.3') return; // Current version, no upgrade needed
      // Old version detected, remove and re-inject
      console.log('[Vehicle Tweaker] Upgrading from version', version || 'unknown', 'to 1.3');
      existing.remove();
    }
    ensureDevPanelStyles();
    const listKinds = typeof bridge.listKinds === 'function'
      ? bridge.listKinds
      : (() => Object.keys(VEHICLE_DEFAULTS));
    const kinds = (listKinds() || []).filter((k) => VEHICLE_DEFAULTS[k]);
    if (!kinds.length) return;
    const artState = {};
    const artDefaults = {};
    const colliderState = {};
    const colliderDefaults = {};
    const fetchArt = typeof bridge.getArtDimensions === 'function'
      ? bridge.getArtDimensions
      : (() => null);
    const fetchCollider = typeof bridge.getColliderDimensions === 'function'
      ? bridge.getColliderDimensions
      : (() => null);
    for (const kind of kinds) {
      const dims = fetchArt(kind) || {};
      const width = Number.isFinite(dims.width) ? dims.width : 30;
      const length = Number.isFinite(dims.length) ? dims.length : 50;
      artState[kind] = { width, length };
      artDefaults[kind] = { width, length };
      const colliderDims = fetchCollider(kind) || {};
      const colliderWidth = Number.isFinite(colliderDims.width) ? colliderDims.width : width;
      const colliderLength = Number.isFinite(colliderDims.length) ? colliderDims.length : length;
      colliderState[kind] = { width: colliderWidth, length: colliderLength };
      colliderDefaults[kind] = { width: colliderWidth, length: colliderLength };
    }
    const physDefaults = JSON.parse(JSON.stringify(VEHICLE_DEFAULTS));
    let colliderVisible = typeof bridge.getColliderVisibility === 'function'
      ? !!bridge.getColliderVisibility()
      : false;
    const DESCRIPTIONS = {
      vehSelect: 'Choose a vehicle preset or Global to affect all presets.',
      lockAspect: 'When enabled, changing length keeps the sprite width/length ratio.',
      artWidth: 'Sprite/collision width in pixels. Larger values make the car visually wider.',
      artLength: 'Sprite/collision length in pixels. Larger values make the car visually longer.',
      colliderWidth: 'Physics collider width (px). Larger values expand the contact patch.',
      colliderLength: 'Physics collider length (px). Longer values extend the hitbox forward/back.',
      colliderVisible: 'Toggle a debug overlay that renders each vehicle collider.',
      wheelbase: 'Distance between axles (px). Influences stability and weight transfer.',
      cgFront: 'Distance from the CG to the front axle. Adjust for balance on braking.',
      cgRear: 'Distance from the CG to the rear axle. Adjust for traction on throttle.',
      accelDuration: '0-to-top-speed duration multiplier. Higher = slower acceleration (maintains top speed by adjusting drag).',
      topSpeed: 'Maximum speed cap in px/s. Vehicle cannot exceed this speed regardless of engine power.',
      gearCount: 'Number of forward gears (3-10). Ratios auto-calculate for optimal performance.',
      syncActive: 'Force currently spawned cars to rebuild physics bodies with the latest settings.',
      resetSelection: 'Restore the selected vehicle(s) to their original geometry defaults.'
    };
    const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const tipAttr = (key) => (DESCRIPTIONS[key] ? ` title="${escapeAttr(DESCRIPTIONS[key])}"` : '');

    const wrap = document.createElement('div');
    wrap.id = 'rv-vehicle-tweaker';
    wrap.className = 'rv-devtools rv-veh';
    wrap.dataset.version = '1.3'; // Version with accel slider, top speed, and gear count
    wrap.innerHTML = `
      <button class="toggle">Vehicle Tweaker ▾</button>
      <div class="rv-panel" role="dialog" aria-label="Vehicle Tweaker">
        <div class="rv-row"><label for="rv-veh-kind"><span${tipAttr('vehSelect')}>Vehicle</span></label>
          <select id="rv-veh-kind">
            <option value="Global">Global</option>
            ${kinds.map((k) => `<option value="${k}">${k}</option>`).join('')}
          </select>
        </div>
        <div class="rv-row"><label for="rv-veh-lock"><span${tipAttr('lockAspect')}>Lock aspect</span></label><input type="checkbox" id="rv-veh-lock"></div>
        <div class="rv-section vehicle">
          <h4>Visual Footprint</h4>
          <div class="rv-row"><label for="rv-veh-width"><span${tipAttr('artWidth')}>Width (px)</span></label><input id="rv-veh-width" type="range" min="10" max="80" step="1"><div class="val" id="rv-veh-width-v"></div></div>
          <div class="rv-row"><label for="rv-veh-length"><span${tipAttr('artLength')}>Length (px)</span></label><input id="rv-veh-length" type="range" min="30" max="140" step="1"><div class="val" id="rv-veh-length-v"></div></div>
        </div>
        <div class="rv-section vehicle">
          <h4>Collider</h4>
          <div class="rv-row"><label for="rv-veh-colw"><span${tipAttr('colliderWidth')}>Width (px)</span></label><input id="rv-veh-colw" type="range" min="10" max="80" step="1"><div class="val" id="rv-veh-colw-v"></div></div>
          <div class="rv-row"><label for="rv-veh-coll"><span${tipAttr('colliderLength')}>Length (px)</span></label><input id="rv-veh-coll" type="range" min="30" max="140" step="1"><div class="val" id="rv-veh-coll-v"></div></div>
          <div class="rv-row"><label for="rv-veh-colshow"><span${tipAttr('colliderVisible')}>Show collider</span></label><input type="checkbox" id="rv-veh-colshow"></div>
        </div>
        <div class="rv-section vehicle">
          <h4>Physics Footprint</h4>
          <div class="rv-row"><label for="rv-veh-wheel"><span${tipAttr('wheelbase')}>Wheelbase</span></label><input id="rv-veh-wheel" type="range" min="20" max="140" step="1"><div class="val" id="rv-veh-wheel-v"></div></div>
          <div class="rv-row"><label for="rv-veh-cgf"><span${tipAttr('cgFront')}>CG → front</span></label><input id="rv-veh-cgf" type="range" min="5" max="120" step="1"><div class="val" id="rv-veh-cgf-v"></div></div>
          <div class="rv-row"><label for="rv-veh-cgr"><span${tipAttr('cgRear')}>CG → rear</span></label><input id="rv-veh-cgr" type="range" min="5" max="120" step="1"><div class="val" id="rv-veh-cgr-v"></div></div>
          <div class="rv-row"><label for="rv-veh-accel"><span${tipAttr('accelDuration')}>0-to-top mult</span></label><input id="rv-veh-accel" type="range" min="1.0" max="10.0" step="0.1"><div class="val" id="rv-veh-accel-v"></div></div>
          <div class="rv-row"><label for="rv-veh-maxspeed"><span${tipAttr('topSpeed')}>Top speed</span></label><input id="rv-veh-maxspeed" type="range" min="100" max="2000" step="10"><div class="val" id="rv-veh-maxspeed-v"></div></div>
          <div class="rv-row"><label for="rv-veh-gears"><span${tipAttr('gearCount')}>Gears amount</span></label><input id="rv-veh-gears" type="range" min="3" max="10" step="1"><div class="val" id="rv-veh-gears-v"></div></div>
        </div>
        <div class="rv-row rv-btns">
          <button id="rv-veh-sync" class="rv-mini"${tipAttr('syncActive')}>Sync active cars</button>
          <button id="rv-veh-reset" class="rv-mini"${tipAttr('resetSelection')}>Reset selection</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const els = {
      panel: wrap.querySelector('.rv-panel'),
      toggle: wrap.querySelector('.toggle'),
      kind: document.getElementById('rv-veh-kind'),
      lock: document.getElementById('rv-veh-lock'),
      width: document.getElementById('rv-veh-width'),
      widthVal: document.getElementById('rv-veh-width-v'),
      length: document.getElementById('rv-veh-length'),
      lengthVal: document.getElementById('rv-veh-length-v'),
        colWidth: document.getElementById('rv-veh-colw'),
        colWidthVal: document.getElementById('rv-veh-colw-v'),
        colLength: document.getElementById('rv-veh-coll'),
        colLengthVal: document.getElementById('rv-veh-coll-v'),
        colShow: document.getElementById('rv-veh-colshow'),
      wheel: document.getElementById('rv-veh-wheel'),
      wheelVal: document.getElementById('rv-veh-wheel-v'),
      cgf: document.getElementById('rv-veh-cgf'),
      cgfVal: document.getElementById('rv-veh-cgf-v'),
      cgr: document.getElementById('rv-veh-cgr'),
      cgrVal: document.getElementById('rv-veh-cgr-v'),
      accel: document.getElementById('rv-veh-accel'),
      accelVal: document.getElementById('rv-veh-accel-v'),
      maxSpeed: document.getElementById('rv-veh-maxspeed'),
      maxSpeedVal: document.getElementById('rv-veh-maxspeed-v'),
      gears: document.getElementById('rv-veh-gears'),
      gearsVal: document.getElementById('rv-veh-gears-v'),
      sync: document.getElementById('rv-veh-sync'),
      reset: document.getElementById('rv-veh-reset')
    };

    function targetKinds(){
      if (!els.kind) return [];
      const sel = els.kind.value;
      return sel === 'Global' ? kinds.slice() : [sel];
    }

    function anchorKind(){
      if (!els.kind) return kinds[0];
      return els.kind.value === 'Global' ? kinds[0] : els.kind.value;
    }

    function refreshFields(){
      const anchor = anchorKind();
      const art = artState[anchor];
      const collider = colliderState[anchor];
      const phys = VEHICLE_DEFAULTS[anchor];
      if (art) {
        if (els.width) {
          els.width.value = art.width;
          if (els.widthVal) els.widthVal.textContent = `${Math.round(art.width)}`;
        }
        if (els.length) {
          els.length.value = art.length;
          if (els.lengthVal) els.lengthVal.textContent = `${Math.round(art.length)}`;
        }
      }
      if (collider) {
        if (els.colWidth) {
          els.colWidth.value = collider.width;
          if (els.colWidthVal) els.colWidthVal.textContent = `${Math.round(collider.width)}`;
        }
        if (els.colLength) {
          els.colLength.value = collider.length;
          if (els.colLengthVal) els.colLengthVal.textContent = `${Math.round(collider.length)}`;
        }
      }
      if (els.colShow) {
        els.colShow.checked = !!colliderVisible;
      }
      if (phys) {
        if (els.wheel) {
          els.wheel.value = phys.wheelbase;
          if (els.wheelVal) els.wheelVal.textContent = `${Math.round(phys.wheelbase)}`;
        }
        if (els.cgf) {
          els.cgf.value = phys.cgToFront;
          if (els.cgfVal) els.cgfVal.textContent = `${Math.round(phys.cgToFront)}`;
        }
        if (els.cgr) {
          els.cgr.value = phys.cgToRear;
          if (els.cgrVal) els.cgrVal.textContent = `${Math.round(phys.cgToRear)}`;
        }
        if (els.accel) {
          const accelMult = phys.accelDurationMult != null ? phys.accelDurationMult : 1.0;
          els.accel.value = accelMult;
          if (els.accelVal) els.accelVal.textContent = accelMult.toFixed(2);
        }
        if (els.maxSpeed) {
          const maxSpd = phys.maxSpeed != null ? phys.maxSpeed : 10000;
          els.maxSpeed.value = maxSpd;
          if (els.maxSpeedVal) els.maxSpeedVal.textContent = `${Math.round(maxSpd)}`;
        }
        if (els.gears) {
          const gearCount = phys.gearCount != null ? phys.gearCount : 6;
          els.gears.value = gearCount;
          if (els.gearsVal) els.gearsVal.textContent = `${gearCount}`;
        }
      }
    }

    function refreshActiveCarPhysics(kindsToRefresh){
      if (typeof getCars !== 'function') return;
      const listKinds = Array.isArray(kindsToRefresh) ? kindsToRefresh : [kindsToRefresh];
      const cset = getCars() || {};
      const cars = [];
      if (cset.player && listKinds.includes(cset.player.kind)) cars.push(cset.player);
      if (Array.isArray(cset.ai)) {
        for (const car of cset.ai) {
          if (car && listKinds.includes(car.kind)) cars.push(car);
        }
      }
      if (!cars.length) return;
      for (const car of cars) {
        const base = VEHICLE_DEFAULTS[car.kind];
        if (!base) continue;
        
        // Ensure physics is initialized
        if (!car.physics || !car.physics.params) {
          initCar(car, car.kind);
        }
        
        if (car.physics && car.physics.params) {
          car.physics.params.wheelbase = base.wheelbase;
          car.physics.params.cgToFront = base.cgToFront;
          car.physics.params.cgToRear = base.cgToRear;
          car.physics.params.accelDurationMult = base.accelDurationMult != null ? base.accelDurationMult : 1.0;
          car.physics.params.maxSpeed = base.maxSpeed != null ? base.maxSpeed : 10000;
          car.physics.a = base.cgToFront;
          car.physics.b = base.cgToRear;
          
          // Ensure gearbox exists
          if (!car.gearbox) {
            car.gearbox = new Gearbox(gearboxDefaults);
          }
          
          // Update gearbox with new gear count and recalculated ratios
          if (car.gearbox && car.gearbox.c) {
            const basePowerMult = base.enginePowerMult != null ? base.enginePowerMult : 1;
            const accelDurMult = base.accelDurationMult != null ? base.accelDurationMult : 1.0;
            const accelDurMultSq = accelDurMult * accelDurMult;
            car.gearbox.c.powerMult = basePowerMult / accelDurMultSq;
            
            // Recalculate gear ratios ONLY if gear count has changed
            const gearCount = base.gearCount != null ? base.gearCount : 6;
            const currentGearCount = car.gearbox.c.ratios ? car.gearbox.c.ratios.length : 0;
            
            // Only recalculate if the gear count differs from current configuration
            if (gearCount >= 3 && gearCount <= 10 && gearCount !== currentGearCount) {
              // Use a reasonable target top speed for gear ratio calculations
              // The maxSpeed setting is typically a physics limiter (e.g., 10000 px/s), not actual achievable speed
              // Use GEARBOX_DEFAULT_TOP_SPEED_MPS (~64 m/s or 1920 px/s) which matches original gear designs
              const targetTopSpeedMps = GEARBOX_DEFAULT_TOP_SPEED_MPS;
              
              const newRatios = suggestGearRatios({
                redlineRpm: car.gearbox.c.redlineRPM || GEARBOX_CONFIG.redlineRpm,
                finalDrive: car.gearbox.c.finalDrive || GEARBOX_CONFIG.finalDrive,
                tireRadiusM: car.gearbox.c.tireRadiusM || GEARBOX_CONFIG.tireRadiusM,
                targetTopSpeedMps: targetTopSpeedMps,
                gears: gearCount,
                spacing: GEARBOX_DEFAULT_SPACING
              });
              
              // Update ratios in config and state
              car.gearbox.c.ratios = newRatios;
              car.gearbox.state.gearRatios = newRatios;
              car.gearbox.state.maxGear = newRatios.length;
              
              // Let the gearbox recalculate gear and RPM based on current speed and new ratios
              // This will select the appropriate gear for the current speed
              car.gearbox.refreshFromConfig();
            }
          }
          const art = artState[car.kind];
          const collider = colliderState[car.kind];
          const mass = car.physics.params.mass || base.mass || 1;
          const Lpx = Number.isFinite(car.colliderLength) ? car.colliderLength
            : (collider ? collider.length : Number.isFinite(car.length) ? car.length : (art ? art.length : 50));
          const Wpx = Number.isFinite(car.colliderWidth) ? car.colliderWidth
            : (collider ? collider.width : Number.isFinite(car.width) ? car.width : (art ? art.width : 20));
          recordColliderHull(car, Wpx, Lpx);
          car.physics.Izz = inferIzz(mass, Lpx, Wpx);
        }
        removePlanckBody(car);
      }
      registerPlanckCars(cars);
      
      // If clone physics is enabled, sync changes to all AI cars through the clone system
      if (els.clonePhysics && els.clonePhysics.checked) {
        applyClonePhysicsToAI();
      }
    }
      sharedPlanckRefresh = refreshActiveCarPhysics;

    function applyArtChange(prop, value, opts = {}){
      const targets = targetKinds();
      let changed = false;
      for (const kind of targets) {
        const entry = artState[kind];
        if (!entry) continue;
        const prevRatio = entry.length ? entry.width / entry.length : 1;
        if (prop === 'length') {
          entry.length = value;
          if (opts.lockAspect) {
            entry.width = clamp(value * prevRatio, 10, 80);
          }
        } else {
          entry.width = value;
        }
        if (typeof bridge.setArtDimensions === 'function') {
          bridge.setArtDimensions(kind, { ...entry });
        }
        changed = true;
      }
      if (changed) {
        refreshActiveCarPhysics(targets);
        refreshFields();
      }
    }

    function applyColliderChange(prop, value){
      const targets = targetKinds();
      let changed = false;
      for (const kind of targets) {
        const entry = colliderState[kind];
        if (!entry) continue;
        entry[prop] = value;
        if (typeof bridge.setColliderDimensions === 'function') {
          bridge.setColliderDimensions(kind, { ...entry });
        }
        changed = true;
      }
      if (changed) {
        refreshActiveCarPhysics(targets);
        refreshFields();
      }
    }

    function applyColliderVisibilityChange(next){
      const enabled = !!next;
      colliderVisible = enabled;
      if (els.colShow) els.colShow.checked = enabled;
      if (typeof bridge.setColliderVisibility === 'function') {
        bridge.setColliderVisibility(enabled);
      }
    }

    function applyPhysChange(prop, value){
      const targets = targetKinds();
      for (const kind of targets) {
        const base = VEHICLE_DEFAULTS[kind];
        if (!base) continue;
        if (prop === 'wheelbase') {
          const total = Math.max(1, base.cgToFront + base.cgToRear);
          const ratio = total > 0 ? base.cgToFront / total : 0.5;
          base.wheelbase = value;
          base.cgToFront = clamp(value * ratio, 1, 140);
          base.cgToRear = clamp(value - base.cgToFront, 1, 140);
        } else if (prop === 'cgToFront') {
          base.cgToFront = value;
          base.wheelbase = clamp(base.cgToFront + base.cgToRear, 5, 180);
        } else if (prop === 'cgToRear') {
          base.cgToRear = value;
          base.wheelbase = clamp(base.cgToFront + base.cgToRear, 5, 180);
        } else if (prop === 'accelDurationMult') {
          base.accelDurationMult = value;
        } else if (prop === 'maxSpeed') {
          base.maxSpeed = value;
        } else if (prop === 'gearCount') {
          base.gearCount = value;
        }
      }
      refreshActiveCarPhysics(targets);
      refreshFields();
    }

    function resetSelection(){
      const targets = targetKinds();
      for (const kind of targets) {
        if (artDefaults[kind]) {
          artState[kind] = { ...artDefaults[kind] };
          if (typeof bridge.setArtDimensions === 'function') {
            bridge.setArtDimensions(kind, { ...artState[kind] });
          }
        }
        if (colliderDefaults[kind]) {
          colliderState[kind] = { ...colliderDefaults[kind] };
          if (typeof bridge.setColliderDimensions === 'function') {
            bridge.setColliderDimensions(kind, { ...colliderState[kind] });
          }
        }
        if (physDefaults[kind]) {
          VEHICLE_DEFAULTS[kind].wheelbase = physDefaults[kind].wheelbase;
          VEHICLE_DEFAULTS[kind].cgToFront = physDefaults[kind].cgToFront;
          VEHICLE_DEFAULTS[kind].cgToRear = physDefaults[kind].cgToRear;
          VEHICLE_DEFAULTS[kind].accelDurationMult = physDefaults[kind].accelDurationMult != null ? physDefaults[kind].accelDurationMult : 1.0;
          VEHICLE_DEFAULTS[kind].maxSpeed = physDefaults[kind].maxSpeed != null ? physDefaults[kind].maxSpeed : 10000;
          VEHICLE_DEFAULTS[kind].gearCount = physDefaults[kind].gearCount != null ? physDefaults[kind].gearCount : 6;
        }
      }
      refreshActiveCarPhysics(targets);
      refreshFields();
    }

    if (els.toggle && els.panel) {
      els.toggle.addEventListener('click', ()=>{
        els.panel.classList.toggle('open');
        els.toggle.textContent = els.panel.classList.contains('open') ? 'Vehicle Tweaker ▴' : 'Vehicle Tweaker ▾';
      });
    }
    if (els.kind) {
      els.kind.addEventListener('change', ()=> refreshFields());
    }
    if (els.width) {
      els.width.addEventListener('input', ()=>{
        const v = clamp(+els.width.value || 0, 10, 80);
        applyArtChange('width', v);
      });
    }
    if (els.length) {
      els.length.addEventListener('input', ()=>{
        const v = clamp(+els.length.value || 0, 30, 140);
        applyArtChange('length', v, { lockAspect: !!(els.lock && els.lock.checked) });
      });
    }
    if (els.colWidth) {
      els.colWidth.addEventListener('input', ()=>{
        const v = clamp(+els.colWidth.value || 0, 10, 80);
        applyColliderChange('width', v);
      });
    }
    if (els.colLength) {
      els.colLength.addEventListener('input', ()=>{
        const v = clamp(+els.colLength.value || 0, 30, 140);
        applyColliderChange('length', v);
      });
    }
    if (els.colShow) {
      els.colShow.addEventListener('change', ()=>{
        applyColliderVisibilityChange(!!els.colShow.checked);
      });
    }
    if (els.wheel) {
      els.wheel.addEventListener('input', ()=>{
        const v = clamp(+els.wheel.value || 0, 20, 140);
        applyPhysChange('wheelbase', v);
      });
    }
    if (els.cgf) {
      els.cgf.addEventListener('input', ()=>{
        const v = clamp(+els.cgf.value || 0, 5, 120);
        applyPhysChange('cgToFront', v);
      });
    }
    if (els.cgr) {
      els.cgr.addEventListener('input', ()=>{
        const v = clamp(+els.cgr.value || 0, 5, 120);
        applyPhysChange('cgToRear', v);
      });
    }
    if (els.accel) {
      els.accel.addEventListener('input', ()=>{
        const v = clamp(+els.accel.value || 1.0, 1.0, 10.0);
        applyPhysChange('accelDurationMult', v);
      });
    }
    if (els.maxSpeed) {
      els.maxSpeed.addEventListener('input', ()=>{
        const v = clamp(+els.maxSpeed.value || 100, 100, 2000);
        applyPhysChange('maxSpeed', v);
      });
    }
    if (els.gears) {
      els.gears.addEventListener('input', ()=>{
        const v = Math.round(clamp(+els.gears.value || 6, 3, 10));
        applyPhysChange('gearCount', v);
      });
    }
    if (els.reset) els.reset.addEventListener('click', resetSelection);
    if (els.sync) els.sync.addEventListener('click', ()=>{
      refreshActiveCarPhysics(targetKinds());
    });

    refreshFields();
  }

  function forcePlanckRefresh(kinds){
    if (!sharedPlanckRefresh) return;
    const list = Array.isArray(kinds) ? kinds : [kinds];
    sharedPlanckRefresh(list);
  }

  // -- Reverse stability knobs (single source of truth) --
  const REVERSE_CFG_DEFAULTS = {
    vxHyst: 18,   // hysteresis band (px/s) for forward/backward direction
    steerScale: 0.55, // steering scale when reversing (0.3..1.0)
    yawMul: 1.30  // yaw damping multiplier when reversing (1.0..2.0)
  };
  let REVERSE_CFG = { ...REVERSE_CFG_DEFAULTS };

  function loadReverseCfg(){
    try {
      if (typeof localStorage === 'undefined') return;
      const j = JSON.parse(localStorage.getItem('RacingVibesReverseCfg.json') || '{}');
      REVERSE_CFG = { ...REVERSE_CFG, ...j };
    } catch(_){}
  }
  function saveReverseCfg(){
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem('RacingVibesReverseCfg.json', JSON.stringify(REVERSE_CFG));
    } catch(_){}
  }
  loadReverseCfg();
  // -------------------------------------------------------------

  const DEVTOOLS_SAVE_KEY = 'RacingVibesSavedDevTools.json';
  let DEVTOOLS_SAVED = {};
  function loadDevtoolsSaved(){
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(DEVTOOLS_SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          DEVTOOLS_SAVED = parsed;
        }
      }
    } catch(_){}
  }
  function saveDevtoolsSaved(){
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(DEVTOOLS_SAVE_KEY, JSON.stringify(DEVTOOLS_SAVED));
    } catch(_){}
  }
  loadDevtoolsSaved();

  async function ensureStoragePersistence(){
    try {
      if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) return;
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    } catch(_){/* ignore */}
  }
  ensureStoragePersistence();


  const PRESET_DB_NAME = 'RacingVibesDevPresets';
  const PRESET_DB_STORE = 'presets';
  const PRESET_FALLBACK_KEY = 'RacingVibesDevPresetsFallback';
  let presetDBPromise = null;

  function loadPresetFallbackMap(){
    try {
      const raw = localStorage.getItem(PRESET_FALLBACK_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch(_){/* ignore */}
    return {};
  }

  function savePresetFallbackMap(map){
    try {
      localStorage.setItem(PRESET_FALLBACK_KEY, JSON.stringify(map));
    } catch(_){/* ignore */}
  }

  function hasIndexedDB(){
    try {
      return typeof indexedDB !== 'undefined';
    } catch(_){
      return false;
    }
  }

  function openPresetDB(){
    if (!hasIndexedDB()) return Promise.resolve(null);
    if (presetDBPromise) return presetDBPromise;
    presetDBPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(PRESET_DB_NAME, 1);
      request.onerror = () => reject(request.error || new Error('Preset DB open failed'));
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(PRESET_DB_STORE)) {
          db.createObjectStore(PRESET_DB_STORE, { keyPath: 'name' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    }).catch((err) => {
      console.warn('[DevTools] Unable to open preset storage', err);
      presetDBPromise = null;
      return null;
    });
    return presetDBPromise;
  }

  async function listPresetEntries(){
    try {
      const db = await openPresetDB();
      if (!db) {
        const map = loadPresetFallbackMap();
        const arr = Object.values(map);
        arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return arr;
      }
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(PRESET_DB_STORE, 'readonly');
        const store = tx.objectStore(PRESET_DB_STORE);
        const request = store.getAll();
        request.onsuccess = () => {
          const arr = Array.isArray(request.result) ? request.result : [];
          arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          resolve(arr);
        };
        request.onerror = () => reject(request.error || new Error('Preset getAll failed'));
        tx.onerror = () => reject(tx.error || new Error('Preset transaction failed'));
      });
    } catch (err) {
      console.warn('[DevTools] Failed to read presets', err);
      const map = loadPresetFallbackMap();
      return Object.values(map);
    }
  }

  async function savePresetRecord(entry){
    try {
      const db = await openPresetDB();
      entry.updatedAt = Date.now();
      if (!db) {
        const map = loadPresetFallbackMap();
        map[entry.name] = entry;
        savePresetFallbackMap(map);
        return entry;
      }
      await new Promise((resolve, reject) => {
        const tx = db.transaction(PRESET_DB_STORE, 'readwrite');
        tx.objectStore(PRESET_DB_STORE).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Preset save failed'));
        tx.onabort = () => reject(tx.error || new Error('Preset save aborted'));
      });
      return entry;
    } catch (err) {
      console.error('[DevTools] Failed to save preset', err);
      const map = loadPresetFallbackMap();
      map[entry.name] = entry;
      savePresetFallbackMap(map);
      return entry;
    }
  }

  async function deletePresetRecord(name){
    try {
      const db = await openPresetDB();
      if (!db) {
        const map = loadPresetFallbackMap();
        if (map[name]) {
          delete map[name];
          savePresetFallbackMap(map);
        }
        return;
      }
      await new Promise((resolve, reject) => {
        const tx = db.transaction(PRESET_DB_STORE, 'readwrite');
        tx.objectStore(PRESET_DB_STORE).delete(name);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Preset delete failed'));
        tx.onabort = () => reject(tx.error || new Error('Preset delete aborted'));
      });
    } catch (err) {
      console.error('[DevTools] Failed to delete preset', err);
      const map = loadPresetFallbackMap();
      if (map[name]) {
        delete map[name];
        savePresetFallbackMap(map);
      }
    }
  }

  let DEVTOOLS_PRESETS = {};
  async function loadDevtoolsPresets(){
    const entries = await listPresetEntries();
    DEVTOOLS_PRESETS = {};
    for (const entry of entries) {
      if (entry && entry.name) DEVTOOLS_PRESETS[entry.name] = entry;
    }
    return DEVTOOLS_PRESETS;
  }
  loadDevtoolsPresets().catch(()=>{});

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
    const visualWidthPx = car.width || (car.dim && car.dim.widthPx) || 18;
    const visualLengthPx = car.length || (car.dim && car.dim.lengthPx) || 36;
    const colliderWidthPx = car.colliderWidth || visualWidthPx;
    const colliderLengthPx = car.colliderLength || visualLengthPx;
    recordColliderHull(car, colliderWidthPx, colliderLengthPx);
    const lengthMeters = meters(colliderLengthPx, ppm);
    const widthMeters = meters(colliderWidthPx, ppm);
    const halfLength = Math.max(0.01, lengthMeters * 0.5);
    const halfWidth  = Math.max(0.01, widthMeters  * 0.5);
    const desiredMass = (P && typeof P.mass === 'number') ? Math.max(0.01, P.mass) : 1.0;
    const area = Math.max(1e-6, lengthMeters * widthMeters);
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
    const shape = pl.Box(halfLength, halfWidth);
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
    const Lpx = car.colliderLength || car.length || 36;
    const Wpx = car.colliderWidth || car.width || 18;
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
      dir: 1,           // +1 forward, -1 backward (persistent direction)
      skid: 0,            // last computed skid intensity 0..1
      planckBody: null
    };
    recordColliderHull(car, Wpx, Lpx);
    if (!car.gearbox) {
      car.gearbox = new Gearbox(gearboxDefaults);
    }
    const basePowerMult = (base && base.enginePowerMult != null) ? base.enginePowerMult : 1;
    const accelDurMult = (base && base.accelDurationMult != null) ? base.accelDurationMult : 1.0;
    const accelDurMultSq = accelDurMult * accelDurMult;
    const effectivePowerMult = basePowerMult / accelDurMultSq;
    if (car.gearbox && (car.gearbox.c.powerMult == null)) {
      car.gearbox.c.powerMult = effectivePowerMult;
    }
    return car.physics;
  }

  function tireLateralForce(muLat, Fz, Calpha, slipAngle){
    // Simple linear up to limit, then saturate (friction circle simplified)
    const Fy_lin = -Calpha * slipAngle; // negative: resists slip
    const Fy_max = muLat * Fz;
    return clamp(Fy_lin, -Fy_max, Fy_max);
  }

  // Longitudinal slip ratio response: unity gain around zero, saturates at |1|
  function slipRatioResponse(s, _sPeak = 0.15, _falloff = 0.65){
    if (!Number.isFinite(s)) return 0;
    if (s > 1) return 1;
    if (s < -1) return -1;
    return s;
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
      if (typeof car.gearbox.refreshFromConfig === 'function') {
        car.gearbox.refreshFromConfig();
      }
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
    const inertiaLength = car.colliderLength || car.length || 36;
    const inertiaWidth = car.colliderWidth || car.width || 18;
    const Izz = car.physics.Izz || inferIzz(P.mass, inertiaLength, inertiaWidth);
    const a = car.physics.a, b = car.physics.b, L=a+b;
    const onRoad = surface && surface.onRoad !== false;
    const muLat = onRoad ? P.muLatRoad : P.muLatGrass;
    const muLong = onRoad ? P.muLongRoad : P.muLongGrass;
  const accelDurMult = (P.accelDurationMult != null) ? P.accelDurationMult : 1.0;
  const accelDurMultSq = accelDurMult * accelDurMult;
  const dragK = (P.dragK / accelDurMultSq) * (onRoad?1:0.7); // slightly less aero on grass due to lower speeds
  const rollK = P.rollK  * (onRoad?1.0:1.6); // higher rolling on grass

    // Body-frame velocity
    const vb = worldToBody(car.physics.vx, car.physics.vy, car.angle);
    let vx = vb.x, vy = vb.y;
    const vxBody = vx;
    const gb = car.gearbox instanceof Gearbox ? car.gearbox : null;
    const VX_HYST = REVERSE_CFG.vxHyst;
    let dir = (car.physics.dir == null ? 1 : car.physics.dir);
    if (vxBody > VX_HYST) dir = 1;
    else if (vxBody < -VX_HYST) dir = -1;
    car.physics.dir = dir;
    const fwd = dir;
    const vxAbs = Math.max(12, Math.abs(vxBody));
    const vxSigned = vxAbs * fwd;
    let reversing = (gb && gb.gearIndex === -1) || (fwd < 0);
    let yawDamp = (P.yawDampK != null ? P.yawDampK : 0.12);
    if (reversing) yawDamp *= REVERSE_CFG.yawMul;

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
  let steerEff = car.physics.steer;
  if (reversing) steerEff *= REVERSE_CFG.steerScale;
  const delta = steerEff;
  const deltaEff = delta; // body-frame wheel angle; reverse handled in slipF
  car.physics.visualSteerTarget = deltaEff;
  car.physics.visualSteerLimit = Math.max(1e-3, (steerMax || 0) * (reversing ? REVERSE_CFG.steerScale : 1));
  const visualTarget = deltaEff;
  const prevVisual = (car.steerVis == null || !Number.isFinite(car.steerVis)) ? visualTarget : car.steerVis;
  const blend = Math.min(1, dt * 12);
  const blendedVisual = prevVisual + (visualTarget - prevVisual) * blend;
  const visLimit = car.physics.visualSteerLimit;
  car.steerVis = clamp(blendedVisual, -visLimit, visLimit);

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
  const vyFront = vy + a * car.physics.r;
  const vyRear  = vy - b * car.physics.r;
  // IMPORTANT: Reverse is handled by fwd*delta in slipF. Do NOT also flip vy or multiply delta again elsewhere.
  let slipF = Math.atan2(vyFront, vxAbs) - fwd * delta;
  let slipR = Math.atan2(vyRear, vxAbs);
  const slipLimit = 0.7; // cap extreme slip angles to avoid runaway forces at very low speed
  slipF = clamp(slipF, -slipLimit, slipLimit);
  slipR = clamp(slipR, -slipLimit, slipLimit);
  const devReverseCheckEnabled = ((typeof window !== 'undefined' && window.__DEV__) || (typeof DEBUG !== 'undefined' && DEBUG));
  if (devReverseCheckEnabled) {
    if (Math.abs(vxBody) < 1 && Math.abs(delta) > 0.02) {
      const expected = Math.sign(-fwd * delta) || 0;
      const got = Math.sign(slipF) || 0;
      if (expected && got && expected !== got) {
        console.warn('[ReverseCheck] Slip sign mismatch near vx≈0', { vxBody, fwd, delta, slipF });
      }
    }
    
  }

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
  if (gb) {
    if (car.physics.exitReverseHold == null) car.physics.exitReverseHold = false;
    let exitReverseHold = !!car.physics.exitReverseHold;
    const forwardSpeedBody = vx;
    const reverseEntrySpeed = (P.reverseEntrySpeed != null ? P.reverseEntrySpeed : 40);
    const reverseDeadband = Math.max(6, VX_HYST * 0.5);
    const reverseShiftReady = Math.max(4, reverseDeadband * 0.6);
    const reverseBrakeRamp = Math.max(30, reverseEntrySpeed);
    if (throttlePressedGlobal && (forwardSpeedBody < -reverseShiftReady || exitReverseHold)) {
      exitReverseHold = true;
    } else if (!throttlePressedGlobal) {
      exitReverseHold = false;
    }

    if (exitReverseHold) {
      const backwardSpeed = Math.max(0, -forwardSpeedBody);
      const brakeRamp = backwardSpeed > 0
        ? Math.min(1, backwardSpeed / reverseBrakeRamp)
        : 0.35;
      const requestedBrake = Math.max(throttle, brakeRamp);
      brake = Math.max(brake, requestedBrake);
      throttle = 0;

      if (backwardSpeed <= reverseShiftReady) {
        if (gb.gearIndex < 1) {
          const before = gb.gearIndex;
          gb.shiftUp();
          if (gb.gearIndex === before && gb.state) {
            gb.state.manualShiftUp = true;
          }
        } else {
          exitReverseHold = false;
        }
      }
    }
    car.physics.exitReverseHold = exitReverseHold;

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
          if (gb.gearIndex < 1) {
            const before = gb.gearIndex;
            gb.shiftUp();
            if (gb.gearIndex === before && gb.state) {
              gb.state.manualShiftUp = true;
            }
          }
        }
      }

      if (gb.gearIndex === 1 && throttlePressed && forwardSpeed < -12) {
        brake = Math.max(brake, Math.min(1, Math.abs(forwardSpeed) / 60));
        throttle = 0;
      }
      if (gb.gearIndex === -1 && throttlePressed && forwardSpeed > 12) {
        brake = Math.max(brake, Math.min(1, forwardSpeed / 60));
        throttle = 0;
      }

      if (gb.gearIndex === -1) {
        if (brakePressed && !throttlePressed) {
          throttle = brake;
          brake = 0;
        }
      } else if (gb.gearIndex >= 1) {
        if (throttlePressed && forwardSpeed < -12) {
          const ramp = Math.min(1, Math.abs(forwardSpeed) / 60);
          brake = Math.max(brake, ramp);
          throttle = 0;
        }
      }

    }

    // --- universal anti-reverse assist (runs for auto & manual) ---
    const throttlePressed = throttle > 0.05;
    const forwardSpeed = vxBody;
    if (gb.gearIndex >= 1 && throttlePressed && fwd < 0 && forwardSpeed < -12) {
      const ramp = Math.min(1, Math.abs(forwardSpeed) / 60);
      brake = Math.max(brake, ramp);
      throttle = 0;
    }
    if (gb.gearIndex === -1 && throttlePressed && fwd > 0 && forwardSpeed > 12) {
      const ramp = Math.min(1, forwardSpeed / 60);
      brake = Math.max(brake, ramp);
      throttle = 0;
    }
    // --------------------------------------------------------------
  }
  const gbState = gb ? gb.state : null;
  let Fx_drive = 0;
  if (gbState && gb) {
    const speedForGearbox = Math.max(0, Math.abs(vForward));
    const gbInputs = {
      throttle,
      brake,
      speedMps: speedForGearbox,
      auto: gb.c.auto !== false
    };
    if (gbState.manualShiftUp) gbInputs.shiftUp = true;
    if (gbState.manualShiftDown) gbInputs.shiftDown = true;
    updateGearbox(gbState, dt, gbInputs);
    if (typeof gb.applyState === 'function') {
      gb.applyState();
    }
    Fx_drive = getDriveForce(gbState, speedForGearbox, throttle);
    gb.lastRequestedForce = Fx_drive;
    const wheelRadius = gbState.tireRadiusM ?? gbState.wheelRadius ?? GEARBOX_CONFIG.tireRadiusM;
    car.physics.lastGb = {
      gear: gb.gear,
      gearIndex: gbState.gear,
      rpm: gb.rpm,
      smoothedRpm: gbState.smoothedRpm ?? gb.rpm,
      requestedForce: Fx_drive,
      requestedForceRaw: gbState.lastDriveForce ?? Fx_drive,
      cutRemainingMs: gbState.cutRemainingMs ?? 0,
      ratio: gbState.currentRatio ?? 0,
      totalRatio: gbState.totalRatio ?? 0,
      engineTorque: gbState.lastEngineTorque ?? 0,
      wheelTorque: gbState.lastWheelTorque ?? Fx_drive * wheelRadius,
      isReverse: gbState.isReverse,
      isNeutral: gbState.isNeutral
    };
    reversing = reversing || !!gbState.isReverse;
  } else {
    car.physics.lastGb = null;
    Fx_drive = 0;
  }
    const brakeForceCmd = brake * P.brakeForce;
    let Fx_brake = 0;
    if (brakeForceCmd > 0) {
      const velSign = (Math.abs(vxBody) > 2)
        ? fwd
        : ((Math.abs(vxBody) > 0.25) ? fwd : clamp(-vx / 0.25, -1, 1));
      Fx_brake = brakeForceCmd * velSign;
    }
    // Body X resistances (drag/roll) oppose motion
    const vmag = Math.max(eps, Math.hypot(vx, vy));
    const ux_bx = vx / vmag; // projection of velocity direction on body X
    const F_drag = dragK * vmag * vmag * ux_bx;
    const F_roll = rollK * vmag * ux_bx;

    // Compute command-only acceleration estimate for load transfer
    const Fx_cmd = Fx_drive - Fx_brake;
    const ax_cmd = (Fx_cmd - F_drag - F_roll) / mass;
    const prevAx = Number.isFinite(car.physics.axLongFiltered) ? car.physics.axLongFiltered : 0;
    const dtClamp = clamp(dt, 1/400, 0.25);
    const tauAx = 0.10;
    const alphaAx = clamp(1 - Math.exp(-dtClamp / tauAx), 0, 1);
    const ax_est = prevAx + (ax_cmd - prevAx) * alphaAx;
    car.physics.axLongFiltered = ax_est;
    car.physics.axLongRaw = ax_cmd;

    // Longitudinal load transfer update
    const cgH = (P.cgHeight!=null?P.cgHeight:8);
    if (cgH > 0) {
      const dF = mass * cgH * ax_est / L; // shift proportional to accel (filtered)
      const totalLoad = Math.max(1e-3, loadsStatic.Fzf + loadsStatic.Fzr);
      const maxTransfer = totalLoad * 0.30; // limit realistic forward/backward weight shift
      const limited = clamp(dF, -maxTransfer, maxTransfer);
      const minShare = 0.28;
      const maxShare = 0.72;
      let frontLoad = clamp(loadsStatic.Fzf - limited, totalLoad * minShare, totalLoad * maxShare);
      Fzf = frontLoad;
      Fzr = totalLoad - frontLoad;
      car.physics.lastLoadFront = Fzf;
      car.physics.lastLoadRear = Fzr;
      // Recompute load-sensitive mu and cornering stiffness with updated loads
      muLatF = muLat * (1 - loadSenseK * (Fzf / Math.max(1e-6, Fzf_ref) - 1));
      muLatR = muLat * (1 - loadSenseK * (Fzr / Math.max(1e-6, Fzr_ref) - 1));
      Cf = muLatF * Fzf / slip0;
      Cr = muLatR * Fzr / slip0;
    }
    car.physics.lastFzf = Fzf; car.physics.lastFzr = Fzr;

    // Now compute lateral forces with updated loads (mu load-sensitive per axle)
    if (reversing) {
      Cf *= 0.9;
      Cr *= 0.9;
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
      const FxR_cmd_raw = Fx_drive - brakeRearShare * (brake * P.brakeForce) * (reversing ? -1 : fwd);
      const Fr_cap = Math.max(1e-6, muLongEffR * Fzr);
      const FxR_cmd = Math.max(-Fr_cap, Math.min(Fr_cap, FxR_cmd_raw));
      const uxR = FxR_cmd / Fr_cap;
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
    if (Math.abs(s_req) > sPeak) {
      const overPeak = Math.min(1, Math.abs(s_req) - sPeak);
      const latScale = Math.max(0, 1 - 0.35 * overPeak);
      FyR *= latScale;
    }
    const falloff= (P.longSlipFalloff != null ? P.longSlipFalloff : 0.80);
    const tractionRatio = slipRatioResponse(s_req, sPeak, falloff);
    let Fx_trac = Fr_max * tractionRatio;
    car.physics.lastSlipReq = s_req;
    car.physics.prevDriveSlip = Math.max(0, Math.abs(s_req) - sPeak);
    let Fx_long = Fx_trac - F_drag - F_roll;
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
        if (yawDamp) {
          const torquePx = -yawDamp * car.physics.r * Izz;
          planckBody.applyTorque(torquePx / (ppm * ppm));
        }
      }
    }

    // Dynamic derivatives (force-based)
    const dvx_dyn = (Fx_long - FyF * Math.sin(deltaEff) + vy * car.physics.r) / mass;
    const dvy_dyn = (FyF * Math.cos(deltaEff) + FyR - vx * car.physics.r) / mass;
    let dr_dyn = (a * FyF * Math.cos(deltaEff) - b * FyR) / Izz;
    // Yaw damping
    dr_dyn += -yawDamp * car.physics.r;

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

    // Apply top speed cap
    const maxSpeed = P.maxSpeed != null ? P.maxSpeed : 10000;
    const currentSpeed = Math.hypot(car.physics.vx, car.physics.vy);
    if (currentSpeed > maxSpeed) {
      const scale = maxSpeed / currentSpeed;
      car.physics.vx *= scale;
      car.physics.vy *= scale;
      car.vx = car.physics.vx;
      car.vy = car.physics.vy;
      // Also clamp Planck body velocity if using Planck
      if (usePlanck && car.physics.planckBody && typeof car.physics.planckBody.setLinearVelocity === 'function') {
        const pl = (typeof window !== 'undefined' && window.planck) ? window.planck : null;
        if (pl && typeof pl.Vec2 === 'function') {
          const ppm = planckState.pixelsPerMeter || 30;
          car.physics.planckBody.setLinearVelocity(pl.Vec2(car.physics.vx / ppm, car.physics.vy / ppm));
        }
      }
    }

    // Additional damping at very low speeds to prevent runaway spin/creep
    const speedMag = Math.hypot(car.physics.vx, car.physics.vy);
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
    const skidEligible = (fwd > 0) && vxAbs > 60 && car.speed > skidSpeedThreshold; // suppress low-speed or backward skids
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
  const DEVTOOLS_STYLE = `
    .rv-devtools{position:fixed;top:var(--dev-panel-top, 56px);left:12px;z-index:35;font:11px system-ui;}
    .rv-devtools .toggle{display:none !important;} /* Hidden - now accessed through Dev dropdown menu */
    .rv-panel{display:none; margin-top:6px; padding:10px; border:1px solid rgba(71,85,105,0.6); background:rgba(15,23,42,0.94); color:#e6eef6; border-radius:10px; width:min(260px, calc(100vw - 24px)); box-shadow:0 8px 24px rgba(0,0,0,.5); max-height:calc(100vh - 100px); overflow-y:auto; overscroll-behavior:contain; touch-action:pan-y; -webkit-overflow-scrolling:touch}
    .rv-panel.open{display:block;}
    .rv-row{display:flex; align-items:center; gap:6px; margin:5px 0}
    .rv-row label{width:100px; opacity:.9; font-size:11px}
    .rv-row input[type=range]{flex:1}
    .rv-row input[type=number]{width:60px;background:#0b1322;color:#e6eef6;border:1px solid #334;border-radius:6px;padding:3px;font-size:10px}
    .rv-row select{flex:1;background:#0b1322;color:#e6eef6;border:1px solid #334;border-radius:6px;padding:4px 6px;font-size:10px}
    .rv-row .val{width:36px; text-align:right; opacity:.8; font-size:10px}
    .rv-row .rv-btns{display:flex;flex-direction:column;gap:3px}
    .rv-row .rv-mini{appearance:none;border:1px solid #334;background:#18253c;color:#e6eef6;font-size:10px;padding:2px 5px;border-radius:4px;cursor:pointer}
    .rv-row .rv-mini:hover{background:#223454}
    .rv-row.preset-row{justify-content:space-between;align-items:flex-start}
    .rv-row.preset-row .rv-mini{font-size:11px;padding:5px 8px}
    .rv-preset-chooser{position:relative;flex:1;display:flex;flex-direction:column;gap:4px}
    .rv-preset-chooser .toggle{width:100%}
    .rv-preset-menu{position:absolute;top:100%;left:0;right:0;background:#0b1322;border:1px solid #334;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.45);margin-top:4px;max-height:200px;overflow-y:auto;display:none;z-index:60}
    .rv-preset-menu.open{display:block}
    .rv-preset-menu button{width:100%;text-align:left;padding:5px 8px;border:none;background:transparent;color:#e6eef6;font-size:11px;cursor:pointer}
    .rv-preset-menu button:hover{background:#1a2640}
    .rv-preset-menu .rv-empty{padding:6px 8px;font-size:11px;opacity:.75}
    .rv-row .small{opacity:.75;font-size:10px}
    .rv-section{margin:10px 0;padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.65)}
    .rv-section h4{margin:0 0 5px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#cbd5f5}
    .rv-section.planck{border-color:rgba(34,197,94,0.45);background:rgba(21,128,61,0.25)}
    .rv-section.planck h4{color:#34d399}
    .rv-section.legacy{border-color:rgba(251,146,60,0.45);background:rgba(180,83,9,0.25)}
    .rv-section.legacy h4{color:#fb923c}
    .rv-section .rv-row{margin:5px 0}
    .rv-devtools.rv-veh{left:12px;right:auto;top:var(--dev-panel-top, 56px)}
    .rv-caution{display:none;margin-left:4px;font-size:12px;cursor:help}
    .rv-panel.clone-active .rv-row[data-no-ai-clone] .rv-caution{display:inline}
    @media (max-width: 600px) {
      .rv-devtools{font-size:10px}
      .rv-panel{width:min(220px, calc(100vw - 24px));padding:8px}
      .rv-row label{width:80px;font-size:10px}
      .rv-row input[type=number]{width:48px;font-size:9px}
      .rv-row .val{width:32px;font-size:9px}
    }
  `;

  function ensureDevPanelStyles(){
    if (document.getElementById('rv-devtools-style')) return;
    const style = document.createElement('style');
    style.id = 'rv-devtools-style';
    style.textContent = DEVTOOLS_STYLE;
    document.head.appendChild(style);
  }

  // Dev tools UI
  async function injectDevTools(getCars){
    if (document.getElementById('rv-devtools')) return; // once
    ensureDevPanelStyles();

    const DESCRIPTIONS = {
      vehicle: "Select which vehicle preset you are tuning.",
      applyToAI: "Apply the current tuning to AI cars as well.",
      debugOverlay: "Show on-screen debug info (forces, slip, etc.).",
      usePlanck: "Use Planck (Box2D) for integration/collisions. Off = legacy integrator.",
      pixelsPerMeter: "Scale from pixels to physics meters. Affects body sizes in the solver.",
      linearDamp: "Planck: global damping on linear velocity. Prefer Drag/Rolling for coasting.",
      angularDamp: "Planck: damping on yaw (rotational) velocity. Prefer Yaw damp for tuning feel.",
  gravity: "World gravity in px/s². Higher values increase weight transfer and available grip.",
      restitution: "Bounciness on wall impacts.",
      velIters: "Solver velocity iterations. Higher = more accurate contacts (slower).",
      posIters: "Solver position iterations. Higher = fewer penetrations (slower).",
      mass: "Car mass & inertia. Higher = more planted, harder to spin; may need more Brake.",
  enginePowerMult: "Multiplier on gearbox drive torque. >1 = more power, <1 = detuned.",
      brakeForce: "Peak braking force. Higher = shorter stops; too high can overwhelm grip.",
      maxSteer: "Maximum steering lock. Higher = tighter turns, riskier at speed.",
      steerSpeed: "How fast steering moves toward target. Higher = snappier steering.",
  steerMode: "Switch player steering between manual input and adaptive touch assist.",
  touchMaxLow: "Touch: steering lock available at low speeds before blending down.",
  touchMaxHigh: "Touch: steering lock available at high speeds after blending.",
  touchFalloff: "Touch: speed (px/s) where steering lock transitions toward the high-speed limit.",
  touchBaseRate: "Touch: base steering slew rate before speed-based reductions.",
  touchRateFalloff: "Touch: controls how quickly steer rate slows down as speed rises.",
  touchReturn: "Touch: centering gain that eases the wheel back toward center.",
  touchFilter: "Touch: smoothing constant (seconds) for the speed filter driving the assist.",
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
    DESCRIPTIONS.vxHyst = "Hysteresis around 0 px/s before direction flips (prevents sign flapping).";
    DESCRIPTIONS.reverseSteer = "Steering scale when reversing (lower = calmer).";
    DESCRIPTIONS.yawReverseMul = "Yaw damping multiplier when reversing.";
    DESCRIPTIONS.clonePhysics = "Continuously sync player physics (engine, grip, mass, etc.) to all AI cars of the same vehicle type. Each vehicle type gets its own physics from the player driving that type.";

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
        <div class="rv-row preset-row">
          <button id="rv-preset-save" class="rv-mini">Save Preset</button>
          <div class="rv-preset-chooser">
            <button id="rv-preset-load" class="rv-mini toggle">Choose Preset ▾</button>
            <div id="rv-preset-menu" class="rv-preset-menu"></div>
          </div>
        </div>
        <div class="rv-row"><label for="rv-kind"><span class="rv-name"${tipAttr('vehicle')}>Vehicle</span></label>
          <select id="rv-kind">
            <option>F1</option><option selected>GT</option><option>Rally</option><option>Truck</option>
          </select>
          <label class="small" for="rv-apply-ai"><input type="checkbox" id="rv-apply-ai"> <span class="rv-name"${tipAttr('applyToAI')}>Apply to AI</span></label>
        </div>
        <div class="rv-row"><label class="small" for="rv-clone-physics"><input type="checkbox" id="rv-clone-physics"> <span class="rv-name"${tipAttr('clonePhysics')}>Clone player physics to AI (per vehicle)</span></label></div>
        <div class="rv-row"><label for="rv-debug"><span class="rv-name"${tipAttr('debugOverlay')}>Debug overlay</span></label><input type="checkbox" id="rv-debug"></div>
        <div class="rv-section planck">
          <h4>Planck</h4>
          <div class="rv-row" data-no-ai-clone><label for="rv-planck"><span class="rv-name"${tipAttr('usePlanck')}>Use Planck</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input type="checkbox" id="rv-planck"></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-ppm"><span class="rv-name"${tipAttr('pixelsPerMeter')}>Pixels / m</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-ppm" type="number" min="5" max="200" step="1"></div>
          <div class="rv-row"><label for="rv-gravity"><span class="rv-name"${tipAttr('gravity')}>Gravity</span></label><input id="rv-gravity" type="range" min="${GRAVITY_MIN}" max="${GRAVITY_MAX}" step="10"><div class="val" id="rv-gravity-v"></div></div>
          <div class="rv-row"><label for="rv-ldamp"><span class="rv-name"${tipAttr('linearDamp')}>Linear damp</span></label><input id="rv-ldamp" type="range" min="0" max="5" step="0.05"><div class="val" id="rv-ldamp-v"></div></div>
          <div class="rv-row"><label for="rv-adamp"><span class="rv-name"${tipAttr('angularDamp')}>Angular damp</span></label><input id="rv-adamp" type="range" min="0" max="8" step="0.05"><div class="val" id="rv-adamp-v"></div></div>
          <div class="rv-row"><label for="rv-rest"><span class="rv-name"${tipAttr('restitution')}>Restitution</span></label><input id="rv-rest" type="range" min="0" max="1" step="0.02"><div class="val" id="rv-rest-v"></div></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-veliters"><span class="rv-name"${tipAttr('velIters')}>Vel iters</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-veliters" type="number" min="1" max="50" step="1"></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-positers"><span class="rv-name"${tipAttr('posIters')}>Pos iters</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-positers" type="number" min="1" max="50" step="1"></div>
          <div class="rv-row"><button id="rv-planck-rebuild"${tipAttr('rebuildWorld')}>Rebuild physics world</button></div>
        </div>
        <div class="rv-row"><label for="rv-mass"><span class="rv-name"${tipAttr('mass')}>Mass</span></label><input id="rv-mass" type="range" min="0.6" max="2.2" step="0.05"><div class="val" id="rv-mass-v"></div></div>
  <div class="rv-row"><label for="rv-eng"><span class="rv-name"${tipAttr('enginePowerMult')}>Engine</span></label><input id="rv-eng" type="range" min="0.5" max="2" step="0.05"><div class="val" id="rv-eng-v"></div></div>
        <div class="rv-row"><label for="rv-brk"><span class="rv-name"${tipAttr('brakeForce')}>Brake</span></label><input id="rv-brk" type="range" min="380" max="1100" step="10"><div class="val" id="rv-brk-v"></div></div>
        <div class="rv-row"><label for="rv-steer"><span class="rv-name"${tipAttr('maxSteer')}>Max steer</span></label><input id="rv-steer" type="range" min="0.25" max="0.85" step="0.01"><div class="val" id="rv-steer-v"></div></div>
        <div class="rv-row"><label for="rv-steers"><span class="rv-name"${tipAttr('steerSpeed')}>Steer speed</span></label><input id="rv-steers" type="range" min="2" max="10" step="0.1"><div class="val" id="rv-steers-v"></div></div>
        <div class="rv-section">
          <h4>Steering</h4>
          <div class="rv-row" data-no-ai-clone><label for="rv-steerMode"><span class="rv-name"${tipAttr('steerMode')}>Steering mode</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label>
            <select id="rv-steerMode">
              <option value="manual">Manual</option>
              <option value="touch">Touch</option>
            </select>
          </div>
          <div class="rv-row" data-no-ai-clone><label for="rv-touchMaxLow"><span class="rv-name"${tipAttr('touchMaxLow')}>Touch max (low)</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-touchMaxLow" type="range" min="0.30" max="0.90" step="0.01"><div class="val" id="rv-touchMaxLow-v"></div></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-touchMaxHigh"><span class="rv-name"${tipAttr('touchMaxHigh')}>Touch max (high)</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-touchMaxHigh" type="range" min="0.10" max="0.60" step="0.01"><div class="val" id="rv-touchMaxHigh-v"></div></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-touchFalloff"><span class="rv-name"${tipAttr('touchFalloff')}>Falloff speed</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-touchFalloff" type="range" min="80" max="460" step="5"><div class="val" id="rv-touchFalloff-v"></div></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-touchBaseRate"><span class="rv-name"${tipAttr('touchBaseRate')}>Base steer rate</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-touchBaseRate" type="range" min="2" max="12" step="0.1"><div class="val" id="rv-touchBaseRate-v"></div></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-touchRateFalloff"><span class="rv-name"${tipAttr('touchRateFalloff')}>Rate falloff</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-touchRateFalloff" type="range" min="0" max="0.0100" step="0.0001"><div class="val" id="rv-touchRateFalloff-v"></div></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-touchReturn"><span class="rv-name"${tipAttr('touchReturn')}>Return gain</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-touchReturn" type="range" min="0" max="6" step="0.1"><div class="val" id="rv-touchReturn-v"></div></div>
          <div class="rv-row" data-no-ai-clone><label for="rv-touchFilter"><span class="rv-name"${tipAttr('touchFilter')}>Filter tau</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-touchFilter" type="range" min="0.05" max="0.40" step="0.01"><div class="val" id="rv-touchFilter-v"></div></div>
        </div>
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
        <div class="rv-row"><label for="rv-cgh"><span class="rv-name"${tipAttr('cgHeight')}>cgHeight</span></label><input id="rv-cgh" type="range" min="0" max="14" step="1"><div class="val" id="rv-cgh-v"></div></div>
        <div class="rv-row"><label for="rv-yawd"><span class="rv-name"${tipAttr('yawDampK')}>Yaw damp</span></label><input id="rv-yawd" type="range" min="0" max="0.30" step="0.02"><div class="val" id="rv-yawd-v"></div></div>
        <div class="rv-section legacy">
          <h4>Legacy</h4>
          <div class="rv-row" data-no-ai-clone><label for="rv-vkine"><span class="rv-name"${tipAttr('vKineBlend')}>vKineBlend</span><span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label><input id="rv-vkine" type="range" min="0.0" max="5.0" step="0.1"><div class="val" id="rv-vkine-v"></div></div>
          <div class="rv-row" data-no-ai-clone>
            <label for="rv-vxhyst" title="Hysteresis band around 0 px/s before direction flips">VX hysteresis<span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label>
            <input id="rv-vxhyst" type="range" min="6" max="40" step="1"><div class="val" id="rv-vxhyst-v"></div>
          </div>
          <div class="rv-row" data-no-ai-clone>
            <label for="rv-rsteer" title="Steering scale when reversing (lower = calmer)">Reverse steer<span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label>
            <input id="rv-rsteer" type="range" min="0.30" max="1.00" step="0.01"><div class="val" id="rv-rsteer-v"></div>
          </div>
          <div class="rv-row" data-no-ai-clone>
            <label for="rv-yawmul" title="Yaw damping multiplier when reversing">Yaw reverse×<span class="rv-caution" title="This setting does not sync to AI vehicles">⚠️</span></label>
            <input id="rv-yawmul" type="range" min="1.00" max="2.00" step="0.05"><div class="val" id="rv-yawmul-v"></div>
          </div>
          <div class="rv-row"><label for="rv-reventry"><span class="rv-name"${tipAttr('reverseEntry')}>Reverse entry</span></label><input id="rv-reventry" type="range" min="0" max="120" step="5"><div class="val" id="rv-reventry-v"></div></div>
          <div class="rv-row"><label for="rv-revtorque"><span class="rv-name"${tipAttr('reverseTorque')}>Reverse torque</span></label><input id="rv-revtorque" type="range" min="0.30" max="1.00" step="0.05"><div class="val" id="rv-revtorque-v"></div></div>
        </div>
        <div class="rv-row"><button id="rv-reset"${tipAttr('resetDefaults')}>Reset defaults</button></div>
      </div>`;
    document.body.appendChild(wrap);

    const panel = wrap.querySelector('.rv-panel');
    const toggle = wrap.querySelector('.toggle');
    toggle.addEventListener('click', ()=>{ panel.classList.toggle('open'); });

    const els = {
      kind: wrap.querySelector('#rv-kind'),
      applyAI: wrap.querySelector('#rv-apply-ai'),
      clonePhysics: wrap.querySelector('#rv-clone-physics'),
      debug: wrap.querySelector('#rv-debug'),
  planck: wrap.querySelector('#rv-planck'),
  ppm: wrap.querySelector('#rv-ppm'),
  gravity: wrap.querySelector('#rv-gravity'), gravityV: wrap.querySelector('#rv-gravity-v'),
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
  steerMode: wrap.querySelector('#rv-steerMode'),
  touchMaxLow: wrap.querySelector('#rv-touchMaxLow'), touchMaxLowV: wrap.querySelector('#rv-touchMaxLow-v'),
  touchMaxHigh: wrap.querySelector('#rv-touchMaxHigh'), touchMaxHighV: wrap.querySelector('#rv-touchMaxHigh-v'),
  touchFalloff: wrap.querySelector('#rv-touchFalloff'), touchFalloffV: wrap.querySelector('#rv-touchFalloff-v'),
  touchBaseRate: wrap.querySelector('#rv-touchBaseRate'), touchBaseRateV: wrap.querySelector('#rv-touchBaseRate-v'),
  touchRateFalloff: wrap.querySelector('#rv-touchRateFalloff'), touchRateFalloffV: wrap.querySelector('#rv-touchRateFalloff-v'),
  touchReturn: wrap.querySelector('#rv-touchReturn'), touchReturnV: wrap.querySelector('#rv-touchReturn-v'),
  touchFilter: wrap.querySelector('#rv-touchFilter'), touchFilterV: wrap.querySelector('#rv-touchFilter-v'),
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

    const vxh = document.getElementById('rv-vxhyst');
    const rsteer = document.getElementById('rv-rsteer');
    const yawm = document.getElementById('rv-yawmul');
    const vxhv = document.getElementById('rv-vxhyst-v');
    const rsteerv = document.getElementById('rv-rsteer-v');
    const yawmv = document.getElementById('rv-yawmul-v');

    const syncReverseUI = () => {
      if (!vxh || !rsteer || !yawm) return;
      vxh.value = REVERSE_CFG.vxHyst;
      rsteer.value = REVERSE_CFG.steerScale;
      yawm.value = REVERSE_CFG.yawMul;
      if (vxhv) vxhv.textContent = String(REVERSE_CFG.vxHyst);
      if (rsteerv) rsteerv.textContent = REVERSE_CFG.steerScale.toFixed(2);
      if (yawmv) yawmv.textContent = REVERSE_CFG.yawMul.toFixed(2);
    };
    

    const onReverseInput = () => {
      if (!vxh || !rsteer || !yawm) return;
      REVERSE_CFG.vxHyst = Math.round(Number(vxh.value));
      REVERSE_CFG.steerScale = Math.max(0.3, Math.min(1.0, Number(rsteer.value)));
      REVERSE_CFG.yawMul = Math.max(1.0, Math.min(2.0, Number(yawm.value)));
      saveReverseCfg();
      syncReverseUI();
    };
    if (vxh) vxh.addEventListener('input', onReverseInput);
    if (rsteer) rsteer.addEventListener('input', onReverseInput);
    if (yawm) yawm.addEventListener('input', onReverseInput);
    if (toggle) toggle.addEventListener('click', syncReverseUI);
    const fmtInt = (v) => String(Math.round(Number(v)));
    const fmtTwo = (v) => (+v).toFixed(2);
    const fmtOne = (v) => (+v).toFixed(1);
    const fmtFour = (v) => (+v).toFixed(4);
    const fmtFive = (v) => (+v).toFixed(5);

    const controlHandlers = {};
    const CONTROL_META = {};
    const STEERING_MODES = new Set(['manual', 'touch']);
    const getStoredSteeringMode = () => {
      try {
        const stored = (typeof localStorage !== 'undefined') ? localStorage.getItem('steeringMode') : null;
        return STEERING_MODES.has(stored) ? stored : 'touch';
      } catch(_) {
        return 'touch';
      }
    };
    const applySteeringModeSelection = (mode, carSet) => {
      const chosen = STEERING_MODES.has(mode) ? mode : 'touch';
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem('steeringMode', chosen);
      } catch(_){/* ignore */}
      let set = carSet;
      if (!set && typeof getCars === 'function') {
        set = getCars() || {};
      }
      if (set) {
        const player = set.player;
        if (player) {
          player.steeringMode = chosen;
          if (player.physics) player.physics.steeringMode = chosen;
        }
      }
    };

    function attachControlButtons(input, id){
      if (!input) return;
      const row = input.closest('.rv-row');
      if (!row) return;
      if (row.querySelector(`.rv-btns[data-for="${id}"]`)) return;
      const btns = document.createElement('div');
      btns.className = 'rv-btns';
      btns.dataset.for = id;
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'rv-mini';
      saveBtn.textContent = 'Save';
      const defaultBtn = document.createElement('button');
      defaultBtn.type = 'button';
      defaultBtn.className = 'rv-mini';
      defaultBtn.textContent = 'Default';
      btns.append(saveBtn, defaultBtn);
      row.appendChild(btns);
      saveBtn.addEventListener('click', () => handleSave(id));
      defaultBtn.addEventListener('click', () => handleDefault(id));
    }

    function handleSave(id){
      const handler = controlHandlers[id];
      if (!handler) return;
      const meta = CONTROL_META[id] || {};
      const value = handler.get();
      if (meta.skipStorage) {
        if (typeof meta.onSave === 'function') meta.onSave(value);
        return;
      }
      DEVTOOLS_SAVED[id] = value;
      saveDevtoolsSaved();
      if (typeof meta.onSave === 'function') meta.onSave(value);
    }

    function handleDefault(id){
      const handler = controlHandlers[id];
      if (!handler) return;
      const meta = CONTROL_META[id] || {};
      if (meta.skipStorage) {
        if (typeof meta.getDefault === 'function') {
          const val = meta.getDefault();
          if (val != null) handler.set(val);
        }
        if (typeof meta.onDefault === 'function') meta.onDefault(handler.get());
        return;
      }
      const kind = els.kind.value;
      const defaultVal = typeof handler.getDefault === 'function' ? handler.getDefault(kind) : undefined;
      if (defaultVal == null) return;
      handler.set(defaultVal);
      delete DEVTOOLS_SAVED[id];
      saveDevtoolsSaved();
      if (typeof meta.onDefault === 'function') meta.onDefault(defaultVal);
      if (typeof handler.applyChange === 'function') handler.applyChange();
    }

    function registerControl(id, meta){
      const input = document.getElementById(id);
      if (!input) return;
      CONTROL_META[id] = meta || {};
      const effectiveMeta = CONTROL_META[id];
      const valueEl = effectiveMeta.valueEl || document.getElementById(`${id}-v`);
      const type = effectiveMeta.type || input.type || 'range';
      const parser = effectiveMeta.parse || ((value) => Number(value));
      const formatter = effectiveMeta.format || ((value) => {
        if (type === 'checkbox') return value ? 'On' : 'Off';
        if (typeof value === 'number') {
          if (Number.isInteger(value)) return String(value);
          return value.toFixed(2);
        }
        return String(value);
      });
      controlHandlers[id] = {
        get: () => {
          if (type === 'checkbox') return !!input.checked;
          if (type === 'number' || type === 'range') return parser(input.value);
          return input.value;
        },
        set: (value) => {
          if (type === 'checkbox') {
            input.checked = !!value;
          } else {
            input.value = `${value}`;
          }
          if (valueEl) valueEl.textContent = formatter(value);
          if (typeof effectiveMeta.afterSet === 'function') effectiveMeta.afterSet(value);
        },
        getDefault: effectiveMeta.getDefault,
        applyChange: effectiveMeta.apply === false
          ? (typeof effectiveMeta.onApply === 'function' ? effectiveMeta.onApply : undefined)
          : (() => apply())
      };
      attachControlButtons(input, id);
    }

    function applySavedControlValues(){
      for (const [id, handler] of Object.entries(controlHandlers)) {
        const meta = CONTROL_META[id] || {};
        if (meta.skipStorage) continue;
        if (!Object.prototype.hasOwnProperty.call(DEVTOOLS_SAVED, id)) continue;
        handler.set(DEVTOOLS_SAVED[id]);
      }
    }

    const vehicleDefault = (prop, fallback) => (kind) => {
      const defaults = defaultSnapshot[kind] || {};
      let val = defaults[prop];
      if ((val === undefined || val === null) && fallback !== undefined) {
        val = typeof fallback === 'function' ? fallback(defaults) : fallback;
      }
      return val;
    };
    const vehicleTouchDefault = (prop, fallback) => (kind) => {
      const defaults = defaultSnapshot[kind] || {};
      const touch = defaults.touchSteer || {};
      let val = touch[prop];
      if ((val === undefined || val === null) && fallback !== undefined) {
        val = typeof fallback === 'function' ? fallback(defaults, touch) : fallback;
      }
      return val;
    };

    const CONTROL_SETUP = [
      ['rv-debug', { kind: 'global', type: 'checkbox', getDefault: () => false, apply: false, afterSet: () => setDebugEnabled(!!els.debug.checked) }],
      ['rv-planck', { kind: 'vehicle', type: 'checkbox', getDefault: (kind) => {
        const defaults = defaultSnapshot[kind] || {};
        return defaults.usePlanck !== false;
      }}],
      ['rv-apply-ai', { kind: 'global', type: 'checkbox', getDefault: () => false, apply: false }],
      ['rv-clone-physics', { kind: 'global', type: 'checkbox', getDefault: () => true, apply: false, afterSet: () => applyClonePhysicsToAI() }],
      ['rv-ppm', { kind: 'vehicle', type: 'number', format: fmtInt, getDefault: (kind) => {
        const defaults = defaultSnapshot[kind] || {};
        return defaults.pixelsPerMeter != null ? defaults.pixelsPerMeter : PLANCK_DEFAULTS.pixelsPerMeter;
      }}],
      ['rv-gravity', { kind: 'global', valueEl: els.gravityV, format: fmtInt, getDefault: () => GRAVITY_DEFAULT }],
      ['rv-ldamp', { kind: 'vehicle', valueEl: els.ldampV, format: fmtTwo, getDefault: vehicleDefault('linearDamp', 0) }],
      ['rv-adamp', { kind: 'vehicle', valueEl: els.adampV, format: fmtTwo, getDefault: vehicleDefault('angularDamp', 0) }],
      ['rv-rest', { kind: 'vehicle', valueEl: els.restV, format: fmtTwo, getDefault: vehicleDefault('restitution', 0) }],
      ['rv-veliters', { kind: 'vehicle', type: 'number', parse: (v) => parseInt(v, 10) || 0, format: fmtInt, getDefault: vehicleDefault('velIters', PLANCK_DEFAULTS.velIters) }],
      ['rv-positers', { kind: 'vehicle', type: 'number', parse: (v) => parseInt(v, 10) || 0, format: fmtInt, getDefault: vehicleDefault('posIters', PLANCK_DEFAULTS.posIters) }],
      ['rv-mass', { kind: 'vehicle', valueEl: els.massV, format: fmtTwo, getDefault: vehicleDefault('mass') }],
  ['rv-eng', { kind: 'vehicle', valueEl: els.engV, format: fmtTwo, getDefault: vehicleDefault('enginePowerMult', 1) }],
      ['rv-brk', { kind: 'vehicle', valueEl: els.brkV, format: fmtInt, getDefault: vehicleDefault('brakeForce') }],
      ['rv-steer', { kind: 'vehicle', valueEl: els.steerV, format: fmtTwo, getDefault: vehicleDefault('maxSteer') }],
      ['rv-steers', { kind: 'vehicle', valueEl: els.steersV, format: fmtOne, getDefault: vehicleDefault('steerSpeed') }],
  ['rv-steerMode', { kind: 'global', type: 'select', getDefault: () => 'touch', format: (value) => value === 'manual' ? 'Manual' : 'Touch', afterSet: (value) => applySteeringModeSelection(value) }],
      ['rv-touchMaxLow', { kind: 'vehicle', valueEl: els.touchMaxLowV, format: fmtTwo, getDefault: vehicleTouchDefault('maxSteerLowSpeed', (defaults) => (defaults.maxSteer != null ? defaults.maxSteer : 0.60)) }],
      ['rv-touchMaxHigh', { kind: 'vehicle', valueEl: els.touchMaxHighV, format: fmtTwo, getDefault: vehicleTouchDefault('maxSteerHighSpeed', (defaults) => {
        const base = defaults.maxSteer != null ? defaults.maxSteer : 0.50;
        return base * 0.6;
      }) }],
      ['rv-touchFalloff', { kind: 'vehicle', valueEl: els.touchFalloffV, format: fmtInt, getDefault: vehicleTouchDefault('falloffSpeed', 260) }],
      ['rv-touchBaseRate', { kind: 'vehicle', valueEl: els.touchBaseRateV, format: fmtOne, getDefault: vehicleTouchDefault('baseSteerRate', (defaults) => (defaults.steerSpeed != null ? defaults.steerSpeed : 5)) }],
      ['rv-touchRateFalloff', { kind: 'vehicle', valueEl: els.touchRateFalloffV, format: fmtFour, getDefault: vehicleTouchDefault('steerRateFalloff', 0.0035) }],
      ['rv-touchReturn', { kind: 'vehicle', valueEl: els.touchReturnV, format: fmtOne, getDefault: vehicleTouchDefault('returnGain', 0) }],
      ['rv-touchFilter', { kind: 'vehicle', valueEl: els.touchFilterV, format: fmtTwo, getDefault: vehicleTouchDefault('filterTau', 0.12) }],
      ['rv-mulr', { kind: 'vehicle', valueEl: els.mulrV, format: fmtTwo, getDefault: vehicleDefault('muLatRoad') }],
      ['rv-muor', { kind: 'vehicle', valueEl: els.muorV, format: fmtTwo, getDefault: vehicleDefault('muLongRoad') }],
      ['rv-mulg', { kind: 'vehicle', valueEl: els.mulgV, format: fmtTwo, getDefault: vehicleDefault('muLatGrass') }],
      ['rv-muog', { kind: 'vehicle', valueEl: els.muogV, format: fmtTwo, getDefault: vehicleDefault('muLongGrass') }],
      ['rv-drag', { kind: 'vehicle', valueEl: els.dragV, format: fmtFour, getDefault: vehicleDefault('dragK') }],
      ['rv-roll', { kind: 'vehicle', valueEl: els.rollV, format: fmtTwo, getDefault: vehicleDefault('rollK') }],
      ['rv-rearc', { kind: 'vehicle', valueEl: els.rearcV, format: fmtTwo, getDefault: vehicleDefault('rearCircle', 0.50) }],
      ['rv-frontc', { kind: 'vehicle', valueEl: els.frontcV, format: fmtTwo, getDefault: vehicleDefault('frontCircle', 0.50) }],
      ['rv-brkfs', { kind: 'vehicle', valueEl: els.brkfsV, format: fmtTwo, getDefault: vehicleDefault('brakeFrontShare', 0.60) }],
      ['rv-lspe', { kind: 'vehicle', valueEl: els.lspeV, format: fmtTwo, getDefault: vehicleDefault('longSlipPeak', 0.18) }],
      ['rv-lsfo', { kind: 'vehicle', valueEl: els.lsfoV, format: fmtTwo, getDefault: vehicleDefault('longSlipFalloff', 0.80) }],
      ['rv-llat', { kind: 'vehicle', valueEl: els.llatV, format: fmtTwo, getDefault: vehicleDefault('loadSenseK', 0.08) }],
      ['rv-llong', { kind: 'vehicle', valueEl: els.llongV, format: fmtTwo, getDefault: vehicleDefault('muLongLoadSenseK', 0.04) }],
      ['rv-df', { kind: 'vehicle', valueEl: els.dfV, format: fmtFive, getDefault: vehicleDefault('downforceK', 0.00025) }],
      ['rv-vkine', { kind: 'vehicle', valueEl: els.vkineV, format: fmtInt, getDefault: vehicleDefault('vKineBlend', 40) }],
      ['rv-cgh', { kind: 'vehicle', valueEl: els.cghV, format: fmtInt, getDefault: vehicleDefault('cgHeight', 8) }],
      ['rv-yawd', { kind: 'vehicle', valueEl: els.yawdV, format: fmtTwo, getDefault: vehicleDefault('yawDampK', 0.12) }],
      ['rv-reventry', { kind: 'vehicle', valueEl: els.reventryV, format: fmtInt, getDefault: vehicleDefault('reverseEntrySpeed', 40) }],
      ['rv-revtorque', { kind: 'vehicle', valueEl: els.revtorqueV, format: fmtTwo, getDefault: vehicleDefault('reverseTorqueScale', 0.60) }],
      ['rv-vxhyst', { kind: 'reverse', valueEl: vxhv, format: fmtInt, skipStorage: true, getDefault: () => REVERSE_CFG_DEFAULTS.vxHyst, afterSet: (value) => {
        REVERSE_CFG.vxHyst = Math.round(Number(value));
        saveReverseCfg();
      }, onSave: () => {
        saveReverseCfg();
      }}],
      ['rv-rsteer', { kind: 'reverse', valueEl: rsteerv, format: fmtTwo, skipStorage: true, getDefault: () => REVERSE_CFG_DEFAULTS.steerScale, afterSet: (value) => {
        REVERSE_CFG.steerScale = Math.max(0.3, Math.min(1.0, Number(value)));
        saveReverseCfg();
      }, onSave: () => {
        saveReverseCfg();
      }}],
      ['rv-yawmul', { kind: 'reverse', valueEl: yawmv, format: fmtTwo, skipStorage: true, getDefault: () => REVERSE_CFG_DEFAULTS.yawMul, afterSet: (value) => {
        REVERSE_CFG.yawMul = Math.max(1.0, Math.min(2.0, Number(value)));
        saveReverseCfg();
      }, onSave: () => {
        saveReverseCfg();
      }}]
    ];
    CONTROL_SETUP.forEach(([id, meta]) => registerControl(id, meta));
    const steerModeHandler = controlHandlers['rv-steerMode'];
    if (steerModeHandler && !Object.prototype.hasOwnProperty.call(DEVTOOLS_SAVED, 'rv-steerMode')) {
      steerModeHandler.set(getStoredSteeringMode());
    }

    const presetChooser = wrap.querySelector('.rv-preset-chooser');
    const presetSaveBtn = document.getElementById('rv-preset-save');
    const presetLoadBtn = document.getElementById('rv-preset-load');
    const presetMenu = document.getElementById('rv-preset-menu');

    const closePresetMenu = () => { if (presetMenu) presetMenu.classList.remove('open'); };
    const gatherControlValues = () => {
      const values = {};
      for (const [id, handler] of Object.entries(controlHandlers)) {
        values[id] = handler.get();
      }
      return values;
    };

    let refreshPresetMenu;
    const applyPresetData = async (preset) => {
      if (!preset) return;
      closePresetMenu();
      const { name, kind, values, reverse, savedValues } = preset;
      if (kind) {
        els.kind.value = kind;
      }
      refresh(els.kind.value);
      DEVTOOLS_SAVED = savedValues ? { ...savedValues } : {};
      saveDevtoolsSaved();
      applySavedControlValues();
      if (values) {
        for (const [id, handler] of Object.entries(controlHandlers)) {
          if (Object.prototype.hasOwnProperty.call(values, id)) {
            handler.set(values[id]);
          }
        }
      }
      if (reverse) {
        REVERSE_CFG = { ...REVERSE_CFG, ...reverse };
        saveReverseCfg();
        syncReverseUI();
      } else {
        syncReverseUI();
      }
      if (name) {
        const existing = DEVTOOLS_PRESETS[name] || {};
        DEVTOOLS_PRESETS[name] = { ...existing, ...preset, updatedAt: preset.updatedAt ?? existing.updatedAt ?? Date.now() };
      }
      apply();
      if (refreshPresetMenu) await refreshPresetMenu();
    };

    refreshPresetMenu = async () => {
      if (!presetMenu) return;
      presetMenu.innerHTML = '';
      await loadDevtoolsPresets();
      const entries = Object.values(DEVTOOLS_PRESETS);
      entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'rv-empty';
        empty.textContent = 'No presets saved.';
        presetMenu.appendChild(empty);
        return;
      }
      for (const entry of entries) {
        if (!entry || !entry.name) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = entry.name;
        btn.addEventListener('click', () => {
          applyPresetData(entry);
        });
        presetMenu.appendChild(btn);
      }
    };

    await refreshPresetMenu();

    if (presetSaveBtn) {
      presetSaveBtn.addEventListener('click', async () => {
        const name = (window.prompt('Enter a name for this preset:') || '').trim();
        if (!name) return;
        if (DEVTOOLS_PRESETS[name] && !window.confirm(`Preset "${name}" exists. Overwrite?`)) return;
        const presetData = {
          name,
          kind: els.kind.value,
          values: gatherControlValues(),
          reverse: { ...REVERSE_CFG },
          savedValues: { ...DEVTOOLS_SAVED }
        };
        try {
          const savedEntry = await savePresetRecord({ ...presetData });
          DEVTOOLS_PRESETS[name] = savedEntry;
          await refreshPresetMenu();
          closePresetMenu();
        } catch (err) {
          console.error('[DevTools] Unable to save preset', err);
          window.alert('Failed to save preset. See console for details.');
        }
      });
    }

    if (presetLoadBtn && presetMenu) {
      presetLoadBtn.addEventListener('click', async () => {
        if (presetMenu.classList.contains('open')) {
          closePresetMenu();
        } else {
          await refreshPresetMenu();
          presetMenu.classList.add('open');
        }
      });
      document.addEventListener('click', (evt) => {
        if (!presetMenu.classList.contains('open')) return;
        if (!presetChooser || !presetChooser.contains(evt.target)) closePresetMenu();
      });
      document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape') closePresetMenu();
      });
    }

    function refresh(kind){
      const k = kind || els.kind.value;
      const d = VEHICLE_DEFAULTS[k];
      if (els.gravity) {
        const gv = Math.round(g);
        els.gravity.value = gv;
        if (els.gravityV) els.gravityV.textContent = String(gv);
      }
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
      const powerMult = (d.enginePowerMult != null ? d.enginePowerMult : 1);
      els.eng.value = powerMult;
      els.engV.textContent = (+powerMult).toFixed(2);
      els.brk.value = d.brakeForce; els.brkV.textContent = d.brakeForce|0;
      els.steer.value = d.maxSteer; els.steerV.textContent = (+d.maxSteer).toFixed(2);
      els.steers.value = d.steerSpeed; els.steersV.textContent = d.steerSpeed.toFixed(1);
      if (els.steerMode) {
        els.steerMode.value = getStoredSteeringMode();
      }
      const ts = d.touchSteer || {};
      if (els.touchMaxLow) {
        const val = ts.maxSteerLowSpeed != null ? ts.maxSteerLowSpeed : (d.maxSteer != null ? d.maxSteer : 0.60);
        els.touchMaxLow.value = val;
        if (els.touchMaxLowV) els.touchMaxLowV.textContent = (+val).toFixed(2);
      }
      if (els.touchMaxHigh) {
        const base = d.maxSteer != null ? d.maxSteer : 0.50;
        const val = ts.maxSteerHighSpeed != null ? ts.maxSteerHighSpeed : base * 0.6;
        els.touchMaxHigh.value = val;
        if (els.touchMaxHighV) els.touchMaxHighV.textContent = (+val).toFixed(2);
      }
      if (els.touchFalloff) {
        const val = ts.falloffSpeed != null ? ts.falloffSpeed : 260;
        els.touchFalloff.value = val;
        if (els.touchFalloffV) els.touchFalloffV.textContent = String(Math.round(+val));
      }
      if (els.touchBaseRate) {
        const val = ts.baseSteerRate != null ? ts.baseSteerRate : (d.steerSpeed != null ? d.steerSpeed : 5);
        els.touchBaseRate.value = val;
        if (els.touchBaseRateV) els.touchBaseRateV.textContent = (+val).toFixed(1);
      }
      if (els.touchRateFalloff) {
        const val = ts.steerRateFalloff != null ? ts.steerRateFalloff : 0.0035;
        els.touchRateFalloff.value = val;
        if (els.touchRateFalloffV) els.touchRateFalloffV.textContent = (+val).toFixed(4);
      }
      if (els.touchReturn) {
        const val = ts.returnGain != null ? ts.returnGain : 0;
        els.touchReturn.value = val;
        if (els.touchReturnV) els.touchReturnV.textContent = (+val).toFixed(1);
      }
      if (els.touchFilter) {
        const val = ts.filterTau != null ? ts.filterTau : 0.12;
        els.touchFilter.value = val;
        if (els.touchFilterV) els.touchFilterV.textContent = (+val).toFixed(2);
      }
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
      const steeringModeSelection = els.steerMode ? els.steerMode.value : getStoredSteeringMode();
      const carSet = (typeof getCars === 'function') ? (getCars() || {}) : null;
      const prevVehicle = VEHICLE_DEFAULTS[k] || {};
      const prevTouch = prevVehicle.touchSteer || {};
      const readTouch = (el, fallback) => {
        if (!el) return fallback;
        const num = Number(el.value);
        return Number.isFinite(num) ? num : fallback;
      };
      const powerMult = clamp(+els.eng.value || 1, 0.5, 2);
      let gravityValue = g;
      if (els.gravity) {
        gravityValue = clamp(+els.gravity.value || GRAVITY_DEFAULT, GRAVITY_MIN, GRAVITY_MAX);
        g = gravityValue;
        els.gravity.value = gravityValue;
        if (els.gravityV) {
          els.gravityV.textContent = String(Math.round(gravityValue));
        }
      }
      const touchSteerCfg = {
        maxSteerLowSpeed: readTouch(els.touchMaxLow, prevTouch.maxSteerLowSpeed ?? (prevVehicle.maxSteer ?? 0.60)),
        maxSteerHighSpeed: readTouch(els.touchMaxHigh, prevTouch.maxSteerHighSpeed ?? ((prevVehicle.maxSteer ?? 0.50) * 0.6)),
        falloffSpeed: readTouch(els.touchFalloff, prevTouch.falloffSpeed ?? 260),
        baseSteerRate: readTouch(els.touchBaseRate, prevTouch.baseSteerRate ?? (prevVehicle.steerSpeed ?? 5)),
        steerRateFalloff: readTouch(els.touchRateFalloff, prevTouch.steerRateFalloff ?? 0.0035),
        returnGain: readTouch(els.touchReturn, prevTouch.returnGain ?? 0),
        filterTau: readTouch(els.touchFilter, prevTouch.filterTau ?? 0.12)
      };
      const p = VEHICLE_DEFAULTS[k] = {
        ...prevVehicle,
        usePlanck: !!els.planck.checked,
        pixelsPerMeter: Math.max(1, +els.ppm.value || PLANCK_DEFAULTS.pixelsPerMeter),
        linearDamp: +els.ldamp.value,
        angularDamp: +els.adamp.value,
        restitution: +els.rest.value,
        velIters: clamp(+els.veliters.value || PLANCK_DEFAULTS.velIters, 1, 50),
        posIters: clamp(+els.positers.value || PLANCK_DEFAULTS.posIters, 1, 50),
        mass: +els.mass.value,
        enginePowerMult: powerMult,
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
  reverseTorqueScale: +els.revtorque.value,
        touchSteer: { ...touchSteerCfg }
      };
      const cars = carSet || {};
      const applyTo = [cars.player].filter(Boolean);
      if (els.applyAI.checked && Array.isArray(cars.ai)) applyTo.push(...cars.ai);
      applySteeringModeSelection(steeringModeSelection, cars);
      for (const c of applyTo){
        if (!c) continue;
        if (!c.physics) initCar(c, c.kind);
        c.physics.params = { ...c.physics.params, ...p };
        if (c.gearbox instanceof Gearbox) {
          const accelDurMult = (p.accelDurationMult != null) ? p.accelDurationMult : 1.0;
          const accelDurMultSq = accelDurMult * accelDurMult;
          c.gearbox.c.powerMult = powerMult / accelDurMultSq;
        }
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
      // After applying, also sync physics to AI if clone mode is enabled
      if (els.clonePhysics && els.clonePhysics.checked) {
        applyClonePhysicsToAI();
      }
    }

    // Clone player physics to all AI cars, matching by vehicle type
    // Each AI car gets the physics params from VEHICLE_DEFAULTS for its own kind
    function applyClonePhysicsToAI() {
      if (!els.clonePhysics || !els.clonePhysics.checked) return;
      const carSet = (typeof getCars === 'function') ? (getCars() || {}) : null;
      if (!carSet) return;
      const player = carSet.player;
      const aiCars = carSet.ai;
      if (!player || !Array.isArray(aiCars) || !aiCars.length) return;

      // Get player's vehicle kind and physics
      const playerKind = player.kind || 'GT';
      const playerParams = player.physics && player.physics.params;
      if (!playerParams) return;

      // Store the player's current physics as the reference for their vehicle type
      // This ensures AI cars of the same type as player get player's tuned physics
      const physicsPerKind = { [playerKind]: { ...playerParams } };

      // Also include current VEHICLE_DEFAULTS for other vehicle types
      // (in case player has tuned those via the dropdown)
      for (const kind of Object.keys(VEHICLE_DEFAULTS)) {
        if (!physicsPerKind[kind]) {
          physicsPerKind[kind] = { ...VEHICLE_DEFAULTS[kind] };
        }
      }

      // Apply physics to each AI car based on its vehicle kind
      for (const car of aiCars) {
        if (!car) continue;
        const carKind = car.kind || 'GT';
        const sourceParams = physicsPerKind[carKind];
        if (!sourceParams) continue;

        if (!car.physics) initCar(car, carKind);

        // Clone safe physics parameters (not steering mode stuff)
        const safeParams = {
          enginePowerMult: sourceParams.enginePowerMult,
          accelDurationMult: sourceParams.accelDurationMult,
          brakeForce: sourceParams.brakeForce,
          mass: sourceParams.mass,
          dragK: sourceParams.dragK,
          rollK: sourceParams.rollK,
          muLatRoad: sourceParams.muLatRoad,
          muLongRoad: sourceParams.muLongRoad,
          muLatGrass: sourceParams.muLatGrass,
          muLongGrass: sourceParams.muLongGrass,
          maxSteer: sourceParams.maxSteer,
          steerSpeed: sourceParams.steerSpeed,
          downforceK: sourceParams.downforceK,
          rearCircle: sourceParams.rearCircle,
          frontCircle: sourceParams.frontCircle,
          brakeFrontShare: sourceParams.brakeFrontShare,
          longSlipPeak: sourceParams.longSlipPeak,
          longSlipFalloff: sourceParams.longSlipFalloff,
          loadSenseK: sourceParams.loadSenseK,
          muLongLoadSenseK: sourceParams.muLongLoadSenseK,
          cgHeight: sourceParams.cgHeight,
          yawDampK: sourceParams.yawDampK,
          reverseEntrySpeed: sourceParams.reverseEntrySpeed,
          reverseTorqueScale: sourceParams.reverseTorqueScale,
          // Planck params
          linearDamp: sourceParams.linearDamp,
          angularDamp: sourceParams.angularDamp,
          restitution: sourceParams.restitution
        };

        // Merge into car's physics params
        car.physics.params = { ...car.physics.params, ...safeParams };

        // Also sync gearbox power multiplier with accelDurationMult applied
        if (car.gearbox instanceof Gearbox && sourceParams.enginePowerMult != null) {
          const accelDurMult = (sourceParams.accelDurationMult != null) ? sourceParams.accelDurationMult : 1.0;
          const accelDurMultSq = accelDurMult * accelDurMult;
          car.gearbox.c.powerMult = sourceParams.enginePowerMult / accelDurMultSq;
        }

        // Update Planck body properties if present
        if (car.physics.planckBody) {
          const body = car.physics.planckBody;
          try {
            body.setLinearDamping(safeParams.linearDamp ?? 0);
            body.setAngularDamping(safeParams.angularDamp ?? 0);
            for (let fix = body.getFixtureList(); fix; fix = fix.getNext()) {
              fix.setRestitution(safeParams.restitution ?? planckState.restitution);
            }
          } catch(_){/* ignore */}
        }
      }
    }

  for (const key of ['gravity','ldamp','adamp','rest','mass','eng','brk','steer','steers','touchMaxLow','touchMaxHigh','touchFalloff','touchBaseRate','touchRateFalloff','touchReturn','touchFilter','mulr','muor','mulg','muog','drag','roll','rearc','frontc','brkfs','lspe','lsfo','llat','llong','df','vkine','cgh','yawd','reventry','revtorque']){
    const controlId = `rv-${key}`;
      els[key].addEventListener('input', ()=>{
        const v = els[key].value;
        const label = key+'V';
        if (els[label]) {
          let display;
          switch (key) {
            case 'drag':
            case 'touchRateFalloff':
              display = (+v).toFixed(4);
              break;
            case 'revtorque':
            case 'eng':
            case 'touchMaxLow':
            case 'touchMaxHigh':
              display = (+v).toFixed(2);
              break;
            case 'touchBaseRate':
            case 'touchReturn':
              display = (+v).toFixed(1);
              break;
            case 'touchFilter':
              display = (+v).toFixed(2);
              break;
            case 'touchFalloff':
            case 'gravity':
              display = String(Math.round(+v));
              break;
            default:
              display = (''+v).slice(0, 4);
          }
          els[label].textContent = display;
        }
        apply();
        handleSave(controlId);
      });
    }
    if (els.steerMode) {
      els.steerMode.addEventListener('change', ()=>{
        apply();
        handleSave('rv-steerMode');
      });
    }
    els.kind.addEventListener('change', ()=>{
      refresh(els.kind.value);
      applySavedControlValues();
      apply();
      applySavedControlValues();
    });
    if (els.planck) els.planck.addEventListener('change', ()=>{ apply(); handleSave('rv-planck'); });
    if (els.ppm) els.ppm.addEventListener('change', ()=>{ apply(); handleSave('rv-ppm'); });
    if (els.veliters) els.veliters.addEventListener('change', ()=>{ apply(); handleSave('rv-veliters'); });
    if (els.positers) els.positers.addEventListener('change', ()=>{ apply(); handleSave('rv-positers'); });
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
    els.debug.addEventListener('change', ()=>{
      setDebugEnabled(!!els.debug.checked);
      handleSave('rv-debug');
    });
    if (els.applyAI) {
      els.applyAI.addEventListener('change', ()=>{
        handleSave('rv-apply-ai');
      });
    }
    if (els.clonePhysics) {
      els.clonePhysics.addEventListener('change', ()=>{
        handleSave('rv-clone-physics');
        // Toggle caution icons visibility
        if (els.clonePhysics.checked) {
          panel.classList.add('clone-active');
          applyClonePhysicsToAI();
        } else {
          panel.classList.remove('clone-active');
        }
      });
      // Initialize clone-active class on load if checkbox is already checked
      if (els.clonePhysics.checked) {
        panel.classList.add('clone-active');
      }
    }

    // Apply the initial slider values to the cars so physics match dev tools on race start
    try {
      apply();
    } catch (e) {
      console.warn('[RacerPhysics] Failed to apply initial dev tools settings:', e);
    }
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
    injectVehicleTweaker,
    configureTrackCollision,
    rebuildPlanckWorld,
    registerPlanckCars,
    planckBeginStep,
    planckStep,
    usesPlanckWorld,
    forcePlanckRefresh,
    defaults: VEHICLE_DEFAULTS,
    forceVehicleTweakerRefresh: () => {
      const existing = document.getElementById('rv-vehicle-tweaker');
      if (existing) {
        console.log('[Vehicle Tweaker] Force removing existing panel');
        existing.remove();
      }
      console.log('[Vehicle Tweaker] Panel will be re-injected on next call to injectVehicleTweaker');
      return 'Panel removed. Reload the page to see the updated version.';
    }
  };
  window.RacerPhysics = API;
})();

