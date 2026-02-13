/**
 * Stadium geometry regression tests.
 *
 * Run with:
 *   node tests/decor_stadium_geometry_tests.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const globalObj = globalThis;
globalObj.window = globalObj;
const syntheticMaskCache = new Map();

function loadDecorInternals() {
  const decorPath = path.join(__dirname, '..', 'decor_generator.js');
  let decorSrc = fs.readFileSync(decorPath, 'utf8');
  decorSrc = decorSrc.replace(
    '  global.Decor = {',
    '  global.__DecorInternals = { buildEdges, createInnerWalls, createStadiums, createBuildings };\n\n  global.Decor = {',
  );
  vm.runInThisContext(decorSrc, { filename: decorPath });
  return globalObj.__DecorInternals;
}

function loadBuiltInTracks() {
  const tracksPath = path.join(__dirname, '..', 'builtin_tracks.js');
  const tracksSrc = fs.readFileSync(tracksPath, 'utf8');
  vm.runInThisContext(tracksSrc, { filename: tracksPath });
  return globalObj.BUILTIN_TRACKS || {};
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function fnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function hashInnerPath(points) {
  const payload = points
    .map((p) => `${round2(p.x).toFixed(2)},${round2(p.y).toFixed(2)}`)
    .join('|');
  return fnv1a(payload);
}

function innerPathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.hypot(dx, dy);
  }
  return round2(total);
}

function segmentIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 0.000001) return null;

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / cross;
  if (t > 0.0001 && t < 0.9999 && u > 0.0001 && u < 0.9999) {
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  }
  return null;
}

function hasSelfIntersections(points, closed = true) {
  if (!points || points.length < 4) return false;
  const n = points.length;

  if (closed) {
    for (let i = 0; i < n; i++) {
      const a1 = points[i];
      const a2 = points[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        const b1 = points[j];
        const b2 = points[(j + 1) % n];
        if (i === j) continue;
        if (((i + 1) % n) === j) continue;
        if (((j + 1) % n) === i) continue;
        if (segmentIntersection(a1, a2, b1, b2)) return true;
      }
    }
    return false;
  }

  for (let i = 0; i < n - 1; i++) {
    const a1 = points[i];
    const a2 = points[i + 1];
    for (let j = i + 2; j < n - 1; j++) {
      if (i === 0 && j === n - 2) continue;
      const b1 = points[j];
      const b2 = points[j + 1];
      if (segmentIntersection(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function hasConsecutiveDuplicatePoints(points, epsilon = 0.5) {
  if (!points || points.length < 2) return false;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    if (Math.hypot(dx, dy) <= epsilon) return true;
  }
  if (points.length > 2) {
    const seamDx = points[0].x - points[points.length - 1].x;
    const seamDy = points[0].y - points[points.length - 1].y;
    if (Math.hypot(seamDx, seamDy) <= epsilon) return true;
  }
  return false;
}

function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) * 0.5;
  }
  return sorted[mid];
}

function stampCircle(mask, width, height, cx, cy, radius) {
  const r = Math.max(1, radius);
  const r2 = r * r;
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(height - 1, Math.ceil(cy + r));
  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    const dxMax = Math.sqrt(Math.max(0, r2 - dy * dy));
    const minX = Math.max(0, Math.floor(cx - dxMax));
    const maxX = Math.min(width - 1, Math.ceil(cx + dxMax));
    let idx = y * width + minX;
    for (let x = minX; x <= maxX; x++) {
      mask[idx++] = 0;
    }
  }
}

function createSyntheticGreenMask(trackId, track, roadWidth, width, height) {
  const cacheKey = `${trackId}|${Math.round(roadWidth * 100)}`;
  if (syntheticMaskCache.has(cacheKey)) {
    return syntheticMaskCache.get(cacheKey);
  }

  const greenMask = new Uint8Array(width * height);
  greenMask.fill(1);
  const points = track.points || [];
  const corridorRadius = roadWidth * 0.5 + 28;
  const step = Math.max(10, corridorRadius * 0.45);

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      stampCircle(greenMask, width, height, x, y, corridorRadius);
    }
  }

  // Ensure closure if first/last are not identical.
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) > 0.5) {
      const dx = first.x - last.x;
      const dy = first.y - last.y;
      const len = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(len / step));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = last.x + dx * t;
        const y = last.y + dy * t;
        stampCircle(greenMask, width, height, x, y, corridorRadius);
      }
    }
  }

  syntheticMaskCache.set(cacheKey, greenMask);
  return greenMask;
}

function buildStadiumsForTrack(trackId, internals, tracks, roadWidthScale = 1, buildingDensity = 0.4) {
  const track = tracks[trackId];
  if (!track) throw new Error(`Track not found: ${trackId}`);

  const roadWidth = (track.roadWidth || 120) * roadWidthScale;
  const edges = internals.buildEdges(track.points, roadWidth);
  const innerWalls = internals.createInnerWalls(edges, {}, { roadWidth });

  const width = Math.max(1, Math.ceil(track.world?.width || 6000));
  const height = Math.max(1, Math.ceil(track.world?.height || 4000));
  const greenMask = createSyntheticGreenMask(trackId, track, roadWidth, width, height);

  const stadiums = internals.createStadiums(
    innerWalls,
    { width, height, greenMask, offsetX: 0, offsetY: 0 },
    null,
    { roadWidth, buildingDensity },
  );

  return { stadiums, track, innerWalls, roadWidth };
}

function polygonArea(points) {
  if (!points || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) * 0.5;
}

function isPointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function centerlineCoverageRatio(points, centerline, stride = 8) {
  if (!points || points.length < 3 || !centerline || centerline.length === 0) return 0;
  let sampled = 0;
  let covered = 0;
  for (let i = 0; i < centerline.length; i += stride) {
    sampled++;
    if (isPointInPolygon(centerline[i].x, centerline[i].y, points)) {
      covered++;
    }
  }
  return sampled > 0 ? (covered / sampled) : 0;
}

function verifyOuterSegmentBound(stadium) {
  const innerPoints = stadium.innerPoints || [];
  const points = stadium.points || [];
  const innerCount = innerPoints.length;
  if (innerCount < 2 || points.length <= innerCount + 1) return true;

  const outerPoints = Array.isArray(stadium.outerPoints) && stadium.outerPoints.length > 1
    ? stadium.outerPoints
    : points.slice(innerCount).reverse();
  if (outerPoints.length < 2) return true;

  const innerLens = [];
  for (let i = 1; i < innerPoints.length; i++) {
    innerLens.push(Math.hypot(
      innerPoints[i].x - innerPoints[i - 1].x,
      innerPoints[i].y - innerPoints[i - 1].y,
    ));
  }
  const medianInnerSegLen = Math.max(1, median(innerLens));
  const maxAllowed = Math.max(240, 3.2 * medianInnerSegLen);

  let maxOuterSegLen = 0;
  for (let i = 1; i < outerPoints.length; i++) {
    const len = Math.hypot(
      outerPoints[i].x - outerPoints[i - 1].x,
      outerPoints[i].y - outerPoints[i - 1].y,
    );
    if (len > maxOuterSegLen) maxOuterSegLen = len;
  }
  return maxOuterSegLen <= maxAllowed;
}

function polylineLength(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  return total;
}

function computeWallCoverageRatio(stadiums, innerWalls) {
  const segments = [
    ...((innerWalls && innerWalls.outerSegments) || []),
    ...((innerWalls && innerWalls.innerSegments) || []),
  ];
  let wallLength = 0;
  for (const seg of segments) {
    wallLength += polylineLength(seg.points || []);
  }

  let stadiumInnerLength = 0;
  for (const stadium of stadiums || []) {
    stadiumInnerLength += polylineLength(stadium.innerPoints || []);
  }

  if (wallLength <= 0) return 0;
  return stadiumInnerLength / wallLength;
}

function run() {
  const baselinePath = path.join(__dirname, 'fixtures', 'stadium_layout_baseline.json');
  const baseline = fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    : { tracks: {} };
  const updateBaseline = process.env.UPDATE_STADIUM_BASELINE === '1';
  const internals = loadDecorInternals();
  const tracks = loadBuiltInTracks();

  const failures = [];
  const trackIds = Object.keys(baseline.tracks || {}).length
    ? Object.keys(baseline.tracks || {})
    : ['Test', 'Sharp_Corners', 'Bendy_Vibes'];
  const nextBaseline = {
    version: 8,
    generatedAt: new Date().toISOString(),
    note: 'Baseline captured from deterministic synthetic green-mask harness with density-sensitive stadium run splitting.',
    tracks: {},
  };
  let scenarioChecks = 0;

  for (const trackId of trackIds) {
    const expected = baseline.tracks ? baseline.tracks[trackId] : null;
    const { stadiums, innerWalls } = buildStadiumsForTrack(trackId, internals, tracks);

    const gotHashes = stadiums.map((s) => hashInnerPath(s.innerPoints || []));
    const gotLengths = stadiums.map((s) => innerPathLength(s.innerPoints || []));
    const gotPointCounts = stadiums.map((s) => (s.innerPoints || []).length);
    nextBaseline.tracks[trackId] = {
      stadiumCount: stadiums.length,
      innerPathHash: gotHashes,
      innerPathLength: gotLengths,
      innerPathPointCount: gotPointCounts,
    };

    if (!updateBaseline) {
      if (!expected) {
        failures.push(`[${trackId}] missing baseline entry`);
        continue;
      }

      if (stadiums.length !== expected.stadiumCount) {
        failures.push(`[${trackId}] stadiumCount expected ${expected.stadiumCount}, got ${stadiums.length}`);
        continue;
      }
      if (JSON.stringify(gotHashes) !== JSON.stringify(expected.innerPathHash)) {
        failures.push(`[${trackId}] innerPathHash mismatch`);
      }
      if (JSON.stringify(gotLengths) !== JSON.stringify(expected.innerPathLength)) {
        failures.push(`[${trackId}] innerPathLength mismatch`);
      }
      if (JSON.stringify(gotPointCounts) !== JSON.stringify(expected.innerPathPointCount)) {
        failures.push(`[${trackId}] innerPathPointCount mismatch`);
      }
    }

    for (let i = 0; i < stadiums.length; i++) {
      const s = stadiums[i];
      if (hasSelfIntersections(s.points || [], true)) {
        failures.push(`[${trackId}] stadium ${i} has self-intersections`);
      }
      if (hasConsecutiveDuplicatePoints(s.points || [], 0.5)) {
        failures.push(`[${trackId}] stadium ${i} has consecutive duplicate points`);
      }
      if (!verifyOuterSegmentBound(s)) {
        failures.push(`[${trackId}] stadium ${i} violates outer segment length bound`);
      }
    }

    const wallCoverageRatio = computeWallCoverageRatio(stadiums, innerWalls);
    if (wallCoverageRatio < 0.84) {
      failures.push(`[${trackId}] wall coverage ratio too low (${(wallCoverageRatio * 100).toFixed(2)}%)`);
    }
  }

  const matrixTracks = ['Test', 'Sharp_Corners', 'Bendy_Vibes'];
  const buildingDensities = [0.2, 0.4, 0.8];
  const treeDensities = [0.2, 0.5];
  const seedOffsets = [0, 1, 5, 25];
  const roadWidthScales = [1.0, 2.5];

  for (const trackId of matrixTracks) {
    for (const buildingDensity of buildingDensities) {
      for (const treeDensity of treeDensities) {
        for (const seedOffset of seedOffsets) {
          for (const roadScale of roadWidthScales) {
            const { stadiums, track, innerWalls } = buildStadiumsForTrack(
              trackId,
              internals,
              tracks,
              roadScale,
              buildingDensity,
            );
            scenarioChecks++;
            for (let i = 0; i < stadiums.length; i++) {
              const s = stadiums[i];
              if (hasSelfIntersections(s.points || [], true)) {
                failures.push(
                  `[Matrix ${trackId} rw=${roadScale.toFixed(2)} b=${buildingDensity} t=${treeDensity} s=${seedOffset}] stadium ${i} self-intersects`,
                );
              }
              if (hasConsecutiveDuplicatePoints(s.points || [], 0.5)) {
                failures.push(
                  `[Matrix ${trackId} rw=${roadScale.toFixed(2)} b=${buildingDensity} t=${treeDensity} s=${seedOffset}] stadium ${i} has duplicate points`,
                );
              }
              if (!verifyOuterSegmentBound(s)) {
                failures.push(
                  `[Matrix ${trackId} rw=${roadScale.toFixed(2)} b=${buildingDensity} t=${treeDensity} s=${seedOffset}] stadium ${i} violates outer segment length bound`,
                );
              }
              const coverage = centerlineCoverageRatio(s.points || [], track.points || [], 8);
              if (coverage > 0.01) {
                failures.push(
                  `[Matrix ${trackId} rw=${roadScale.toFixed(2)} b=${buildingDensity} t=${treeDensity} s=${seedOffset}] stadium ${i} covers centerline (${(coverage * 100).toFixed(2)}%)`,
                );
              }
            }
            const wallCoverageRatio = computeWallCoverageRatio(stadiums, innerWalls);
            if (wallCoverageRatio < 0.84) {
              failures.push(
                `[Matrix ${trackId} rw=${roadScale.toFixed(2)} b=${buildingDensity} t=${treeDensity} s=${seedOffset}] wall coverage too low (${(wallCoverageRatio * 100).toFixed(2)}%)`,
              );
            }
          }
        }
      }
    }
  }

  // Density sensitivity check: stadium segmentation must respond to buildingDensity.
  for (const trackId of matrixTracks) {
    for (const roadScale of roadWidthScales) {
      const low = buildStadiumsForTrack(trackId, internals, tracks, roadScale, 0.2);
      const high = buildStadiumsForTrack(trackId, internals, tracks, roadScale, 0.8);
      const lowInnerLens = low.stadiums.map((s) => innerPathLength(s.innerPoints || []));
      const highInnerLens = high.stadiums.map((s) => innerPathLength(s.innerPoints || []));
      const lowMedianLen = median(lowInnerLens);
      const highMedianLen = median(highInnerLens);
      const lowCoverage = computeWallCoverageRatio(low.stadiums, low.innerWalls);
      const highCoverage = computeWallCoverageRatio(high.stadiums, high.innerWalls);
      const minCountDelta = Math.max(1, Math.ceil(low.stadiums.length * 0.12));
      const countDelta = high.stadiums.length - low.stadiums.length;
      const hasCountResponse = countDelta >= minCountDelta;
      const hasLengthResponse = highMedianLen <= (Math.max(1, lowMedianLen) * 0.92);

      if (!hasCountResponse && !hasLengthResponse) {
        failures.push(
          `[Density ${trackId} rw=${roadScale.toFixed(2)}] buildingDensity has negligible stadium effect (lowCount=${low.stadiums.length}, highCount=${high.stadiums.length}, lowMedianLen=${lowMedianLen.toFixed(2)}, highMedianLen=${highMedianLen.toFixed(2)})`,
        );
      }
      if (highCoverage + 0.02 < lowCoverage) {
        failures.push(
          `[Density ${trackId} rw=${roadScale.toFixed(2)}] high density unexpectedly reduced wall coverage (low=${(lowCoverage * 100).toFixed(2)}%, high=${(highCoverage * 100).toFixed(2)}%)`,
        );
      }
    }
  }

  if (updateBaseline && failures.length === 0) {
    fs.writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`, 'utf8');
    console.log(`Decor Stadium Geometry Tests: baseline updated (${trackIds.length} tracks)`);
    return { passed: trackIds.length, failed: 0, failures: [] };
  }

  if (failures.length > 0) {
    console.log('Decor Stadium Geometry Tests: FAIL');
    for (const f of failures) {
      console.log(` - ${f}`);
    }
    return { passed: 0, failed: failures.length, failures };
  }

  console.log(`Decor Stadium Geometry Tests: PASS (${trackIds.length} baseline tracks, ${scenarioChecks} matrix scenarios)`);
  return { passed: trackIds.length, failed: 0, failures: [] };
}

if (require.main === module) {
  const result = run();
  process.exit(result.failed > 0 ? 1 : 0);
}

module.exports = { run };
