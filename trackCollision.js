import { meters } from './physics/planckWorld.js';

export function buildTrackBodies(world, trackSegments, ppm, opts = {}) {
  if (!world || !trackSegments || !trackSegments.length) return null;
  const pl = typeof window !== 'undefined' ? window.planck : undefined;
  if (!pl) {
    throw new Error('Planck.js is required to build track bodies.');
  }
  const ground = world.createBody();
  const restitution = typeof opts.restitution === 'number' ? opts.restitution : 0.0;
  const segments = Array.isArray(trackSegments) ? trackSegments : [];
  const scale = ppm || 0;

  segments.forEach((segment) => {
    if (!segment) return;
    const { x1, y1, x2, y2 } = segment;
    if ([x1, y1, x2, y2].some((v) => !Number.isFinite(v))) return;
    const a = pl.Vec2(meters(x1, scale), meters(y1, scale));
    const b = pl.Vec2(meters(x2, scale), meters(y2, scale));
    const edge = pl.Edge(a, b);
    ground.createFixture(edge, {
      density: 0,
      friction: 0.0,
      restitution
    });
  });

  return ground;
}

if (typeof window !== 'undefined') {
  window.TrackCollision = window.TrackCollision || {};
  window.TrackCollision.buildTrackBodies = buildTrackBodies;
}
