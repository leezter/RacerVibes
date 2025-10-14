export const gearboxDefaults = {
  ratios:       [3.10, 2.05, 1.55, 1.25, 1.05, 0.88],
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
  auto: true
};

export class Gearbox {
  constructor(cfg = {}) {
    this.c = { ...gearboxDefaults, ...cfg };
    this.gear = 1;
    this.rpm = this.c.idleRPM;
    this.shiftCut = 0;
    this.clutchLock = 1;
    this._justShifted = false;
  }
  setManual(on) { this.c.auto = !on; }
  shiftUp()   { if (this.gear < this.c.ratios.length) { this.gear++; this._kickShiftCut(); } }
  shiftDown() { if (this.gear > 1) { this.gear--; this._kickShiftCut(); } }
  _kickShiftCut(){ this.shiftCut = this.c.shiftCutMs; this._justShifted = true; this.clutchLock = Math.min(this.clutchLock, 0.25); }
  _torqueAt(rpm, throttle) {
    if (this.c.torqueCurve) return this.c.torqueCurve(rpm, throttle);
    const x = Math.max(0, Math.min(1, rpm / this.c.redlineRPM));
    const peakX = 0.65;
    const shape = Math.max(0.18, 1 - Math.abs(x - peakX) * 2.0);
    return throttle * this.c.torquePeak * shape;
  }
  step(dt, vForward, throttle, slipInfo) {
    const c = this.c;
    const g = c.ratios[this.gear - 1] * c.finalDrive;
    const wheelOmega = vForward / Math.max(1e-6, c.wheelRadius);
    const wheelRPM = wheelOmega * 60 / (2*Math.PI);
    const lockedRPM = Math.max(c.idleRPM, wheelRPM * g);

    const targetLock = this._justShifted ? 0.25 : 1.0;
    this.clutchLock += (targetLock - this.clutchLock) * Math.min(1, c.clutchEngageRate * dt);
    if (Math.abs(throttle) < 0.15) this.clutchLock = Math.min(this.clutchLock + 2.0*dt, 1);

    const freeTarget = Math.max(c.idleRPM, this.rpm + (throttle * 2200 * dt));
    let targetRPM = lockedRPM * this.clutchLock + freeTarget * (1 - this.clutchLock);

    if ((slipInfo?.driveSlip || 0) > 0.15 || Math.abs(vForward) < 0.4) {
      targetRPM += c.clutchSlipBoost * (c.redlineRPM - targetRPM) * Math.min(1, throttle);
    }

    const a = Math.max(0.02, Math.min(1.0, c.engineInertia));
    this.rpm = Math.min(c.redlineRPM, Math.max(c.idleRPM, a*targetRPM + (1-a)*this.rpm));

    if (c.auto && throttle > 0.2 && this.shiftCut <= 0) {
      if (this.rpm > c.upshiftRPM && this.gear < c.ratios.length) this.shiftUp();
      else if (this.rpm < c.downshiftRPM && this.gear > 1) this.shiftDown();
    }

    let cut = 1.0;
    if (this.shiftCut > 0) {
      this.shiftCut -= dt*1000;
      cut = 0.35;
      if (this.shiftCut <= 0) this._justShifted = false;
    }

    const Te = this._torqueAt(this.rpm, throttle) * cut;
    const Tw = Te * g * c.drivelineEff;
    const denom = Math.max(1e-4, c.wheelRadius);
    const Fnorm = (c.torquePeak * g * c.drivelineEff) / denom;
    const Freq = Tw / denom;
    this._lastForceNorm = Fnorm;
    return { rpm: this.rpm|0, gear: this.gear, requestedForce: Freq, clutchLock: this.clutchLock, forceNorm: Fnorm };
  }
}
