(function (global) {
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sign = (x) => (x === 0 ? 0 : x > 0 ? 1 : -1);
  const toRad = (deg) => (deg * Math.PI) / 180;
  const sanitizeFilename = (s) => {
    return s.replace(/[^a-z0-9_\-]+/gi, '_');
  };
  const exposeGlobal = (path, obj) => {
    const parts = path.split('.');
    let ref = global;
    for (let i = 0; i < parts.length - 1; i++) {
      ref[parts[i]] = ref[parts[i]] || {};
      ref = ref[parts[i]];
    }
    const leaf = parts[parts.length - 1];
    if (ref[leaf] && ref[leaf] !== obj) return ref[leaf];
    ref[leaf] = obj;
    return obj;
  };
  const once = (fn) => {
    let done = false;
    return (...args) => {
      if (done) return;
      done = true;
      return fn(...args);
    };
  };
  const Utils = { clamp, lerp, sign, toRad, sanitizeFilename, exposeGlobal, once };
  global.RacerUtils = global.RacerUtils || Utils;
})(window);
