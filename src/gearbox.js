const clamp01 = (x) => Math.max(0, Math.min(1, x));

export const gearboxDefaults = {
  ratios:       [7.00, 5.00, 4.00, 3.00, 2.50, 2.00],
  reverseRatio: 3.30,
  finalDrive:   6.00,
  redlineRPM:   9500,
  idleRPM:      1100,
  upshiftRPM:   6900,
  downshiftRPM: 3000,
  wheelRadius:  0.50,
  drivelineEff: 1.00,
  torquePeak:   40,
  torqueCurve:  null,
  engineBrakePeak: 0.0,
  throttleDead: 0.05,
  shiftCutMs:   110,
  engineInertia: 0.6,
  clutchEngageRate: 12.0,
  clutchSlipBoost: 0.0,
  auto: true,
  enableReverse: true
};

export class Gearbox {
  constructor(cfg = {}) {
    this.c = { ...gearboxDefaults, ...cfg };
    this._gearIndex = 1; // -1:R, 0:N, 1..N forward
    this._gearMax = this.c.ratios.length;
    this._justShifted = false;
    this.rpm = this.c.idleRPM;
    this.shiftCut = 0;
    this.clutchLock = 1;
    this.lastRequestedForce = 0;
    this._updateGearLabel();
  }

  _updateGearLabel() {
    if (this._gearIndex === -1) this.gear = "R";
    else if (this._gearIndex === 0) this.gear = "N";
    else this.gear = this._gearIndex;
  }

  get gearIndex() {
    return this._gearIndex;
  }

  get isReverse() {
    return this._gearIndex === -1;
  }

  get isNeutral() {
    return this._gearIndex === 0;
  }

  setManual(on) {
    this.c.auto = !on;
  }

  shiftUp() {
    if (this._gearIndex >= this._gearMax) return;
    this._gearIndex += 1;
    if (this._gearIndex === 0 && this.c.auto) this._gearIndex = 1; // autos skip N upward
    this._kickShiftCut();
  }

  shiftDown() {
    const minGear = this.c.enableReverse === false ? 0 : -1;
    if (this._gearIndex <= minGear) return;
    this._gearIndex -= 1;
    this._kickShiftCut();
  }

  _kickShiftCut() {
    this.shiftCut = this.c.shiftCutMs;
    this._justShifted = true;
    if (this.isNeutral) {
      this.clutchLock = 0;
    } else {
      this.clutchLock = Math.min(this.clutchLock, 0.25);
    }
    this._updateGearLabel();
  }

  _torqueAt(rpm, throttle) {
    if (this.c.torqueCurve) return this.c.torqueCurve(rpm, throttle);
    const x = Math.max(0, Math.min(1, rpm / this.c.redlineRPM));
    const peakX = 0.65;
    const shape = Math.max(0.18, 1 - Math.abs(x - peakX) * 2.0);
    return throttle * this.c.torquePeak * shape;
  }

  _engineBrakeAt(rpm) {
    const c = this.c;
    const span = Math.max(1, c.redlineRPM - c.idleRPM);
    const x = Math.max(0, Math.min(1, (rpm - c.idleRPM) / span));
    const shape = Math.min(1, x / 0.7);
    return c.engineBrakePeak * shape;
  }

  _currentRatio() {
    if (this._gearIndex === -1 && this.c.enableReverse !== false) {
      return -Math.abs(this.c.reverseRatio || this.c.ratios[0] || 3);
    }
    if (this._gearIndex >= 1 && this._gearIndex <= this.c.ratios.length) {
      return this.c.ratios[this._gearIndex - 1];
    }
    return 0;
  }

  step(dt, vForward, throttle, slipInfo) {
    const c = this.c;
    if (this._gearMax !== this.c.ratios.length) {
      this._gearMax = this.c.ratios.length;
      if (this._gearIndex > this._gearMax) {
        this._gearIndex = this._gearMax;
        this._updateGearLabel();
      }
    }
  const ratio = this._currentRatio();
  const engaged = ratio !== 0;
  const finalRatio = ratio * c.finalDrive;
    const wheelOmega = vForward / Math.max(1e-6, c.wheelRadius);
    const wheelRPM = wheelOmega * 60 / (2 * Math.PI);
    const lockedRPM = engaged ? Math.max(c.idleRPM, Math.abs(wheelRPM * finalRatio)) : c.idleRPM;

    const targetLock = engaged ? (this._justShifted ? 0.25 : 1.0) : 0;
    this.clutchLock += (targetLock - this.clutchLock) * Math.min(1, c.clutchEngageRate * dt);
    if (!engaged || Math.abs(throttle) < 0.15) {
      this.clutchLock = Math.min(this.clutchLock + 2.0 * dt, 1);
    }

    const freeTarget = Math.max(c.idleRPM, this.rpm + (throttle * 2200 * dt));
    let targetRPM = engaged
      ? lockedRPM * this.clutchLock + freeTarget * (1 - this.clutchLock)
      : freeTarget;

    const redline = c.redlineRPM;
    const onThrottle = throttle > c.throttleDead;
    const limiterSoft = redline * 0.97;
    const limiterActive = engaged && onThrottle && lockedRPM >= limiterSoft;

    if (engaged && !limiterActive && ((slipInfo?.driveSlip || 0) > 0.15 || Math.abs(vForward) < 0.4)) {
      targetRPM += c.clutchSlipBoost * (redline - targetRPM) * Math.min(1, throttle);
    }

    const inertia = Math.max(0.02, Math.min(1.0, c.engineInertia));
    let rpmNext;
    if (engaged) {
      rpmNext = inertia * targetRPM + (1 - inertia) * this.rpm;
    } else {
      const revGain = 0.7;
      const idleTarget = throttle > 0.02
        ? c.idleRPM + revGain * throttle * (redline - c.idleRPM)
        : c.idleRPM;
      rpmNext = inertia * idleTarget + (1 - inertia) * this.rpm;
    }
    this.rpm = Math.min(redline, Math.max(c.idleRPM, rpmNext));

    let driveCut = 1.0;
    if (this.shiftCut > 0) {
      this.shiftCut -= dt * 1000;
      driveCut = 0.35;
      if (this.shiftCut <= 0) this._justShifted = false;
    }

    if (limiterActive) {
      const span = Math.max(1, redline - limiterSoft);
      const limiterScale = lockedRPM >= redline
        ? 0
        : 1 - (lockedRPM - limiterSoft) / span;
      driveCut *= clamp01(limiterScale);
      this.clutchLock = 1;
    }

    const Te_drive = onThrottle ? this._torqueAt(this.rpm, throttle) * driveCut : 0;
    const Te_brake = (!onThrottle && engaged) ? -this._engineBrakeAt(this.rpm) : 0;
    const Te_total = Te_drive + Te_brake;
    const Tw = Te_total * finalRatio * c.drivelineEff;
    const denom = Math.max(1e-4, c.wheelRadius);
    let requestedForce = Tw / denom;
    let forceNorm = (c.torquePeak * Math.abs(finalRatio) * c.drivelineEff) / denom;

    if (engaged) {
      this._lastForceNorm = forceNorm;
      this.lastRequestedForce = requestedForce;
    } else {
      requestedForce = 0;
      forceNorm = 1;
      this.lastRequestedForce = 0;
    }

    this._updateGearLabel();

    return {
      rpm: this.rpm | 0,
      gear: this.gear,
      requestedForce,
      clutchLock: this.clutchLock,
      forceNorm,
      gearRatio: finalRatio,
      isReverse: ratio < 0,
      isNeutral: !engaged,
      T_engine: Te_total,
      T_wheel: Tw,
      wheelRadius: c.wheelRadius
    };
  }
}


