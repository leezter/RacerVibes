const PPM_FALLBACK = 30;

export const PPM_DEFAULT = PPM_FALLBACK;

function ensurePlanck() {
  const pl = typeof window !== 'undefined' ? window.planck : undefined;
  if (!pl) {
    throw new Error('Planck.js is not loaded. Ensure planck.min.js is included before using PlanckWorld.');
  }
  return pl;
}

export function createWorld({ gravityY = 0, doSleep = true } = {}) {
  const pl = ensurePlanck();
  const world = new pl.World(pl.Vec2(0, gravityY));
  world.setAllowSleeping(!!doSleep);
  return world;
}

export function meters(px, ppm) {
  const scale = ppm || PPM_FALLBACK;
  return px / (scale || PPM_FALLBACK);
}

export function pixels(m, ppm) {
  const scale = ppm || PPM_FALLBACK;
  return m * (scale || PPM_FALLBACK);
}

export function stepWorld(world, dt, velIters, posIters) {
  if (!world) return;
  const vi = typeof velIters === 'number' ? velIters : 8;
  const pi = typeof posIters === 'number' ? posIters : 3;
  world.step(dt, vi, pi);
}

// Optional global bridge so legacy scripts can access without modules
if (typeof window !== 'undefined') {
  window.PlanckWorld = window.PlanckWorld || {};
  Object.assign(window.PlanckWorld, {
    PPM_DEFAULT,
    createWorld,
    meters,
    pixels,
    stepWorld
  });
}
