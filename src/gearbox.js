export const gearboxDefaults = {
  ratios:       [3.10, 2.05, 1.55, 1.25, 1.05, 0.88],
  reverseRatio: 3.30,
  finalDrive:   3.90,
  redlineRPM:   7600,
  idleRPM:      1100,
  upshiftRPM:   6900,
  downshiftRPM: 3000,
  wheelRadius:  0.30,
  drivelineEff: 0.90,
  torquePeak:   290,
  torqueCurve:  null,
  shiftCutMs:   110,
  engineInertia: 0.2,
  clutchEngageRate: 6.0,
  clutchSlipBoost: 0.35,
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

    if (engaged && ((slipInfo?.driveSlip || 0) > 0.15 || Math.abs(vForward) < 0.4)) {
      targetRPM += c.clutchSlipBoost * (c.redlineRPM - targetRPM) * Math.min(1, throttle);
    }

    const inertia = Math.max(0.02, Math.min(1.0, c.engineInertia));
    let rpmNext;
    if (engaged) {
      rpmNext = inertia * targetRPM + (1 - inertia) * this.rpm;
    } else {
      const revGain = 0.7;
      const idleTarget = throttle > 0.02
        ? c.idleRPM + revGain * throttle * (c.redlineRPM - c.idleRPM)
        : c.idleRPM;
      rpmNext = inertia * idleTarget + (1 - inertia) * this.rpm;
    }
    this.rpm = Math.min(c.redlineRPM, Math.max(c.idleRPM, rpmNext));

   

    let cut = 1.0;
    if (this.shiftCut > 0) {
      this.shiftCut -= dt * 1000;
      cut = 0.35;
      if (this.shiftCut <= 0) this._justShifted = false;
    }

    let requestedForce = 0;
    let forceNorm = 1;
    if (engaged) {
      const Te = this._torqueAt(this.rpm, throttle) * cut;
      const Tw = Te * finalRatio * c.drivelineEff;
      const denom = Math.max(1e-4, c.wheelRadius);
      forceNorm = (c.torquePeak * Math.abs(finalRatio) * c.drivelineEff) / denom;
      requestedForce = Tw / denom;
      this._lastForceNorm = forceNorm;
      this.lastRequestedForce = requestedForce;
    } else {
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
      isNeutral: !engaged
    };
  }
}


