/**
 * Racing Line Validation Module
 *
 * Provides validation and metrics for racing lines:
 * - Boundary violations (points outside track)
 * - Self-intersections (path crosses itself)
 * - Curvature statistics
 * - Path length and loop closure
 *
 * Works with both anchor-based and MCP racing lines.
 */

(function (global) {
  'use strict';

  /**
   * Find the nearest point on the centerline to a given point
   * @param {Object} point - Point to check {x, y}
   * @param {Array} centerline - Track centerline
   * @returns {Object} - { distance, index, signedOffset }
   */
  function findNearestCenterlinePoint(point, centerline) {
    let minDist = Infinity;
    let nearestIdx = 0;

    for (let i = 0; i < centerline.length; i++) {
      const dx = point.x - centerline[i].x;
      const dy = point.y - centerline[i].y;
      const dist = Math.hypot(dx, dy);
      if (dist < minDist) {
        minDist = dist;
        nearestIdx = i;
      }
    }

    // Calculate signed offset (perpendicular distance from centerline)
    const n = centerline.length;
    const prev = centerline[(nearestIdx - 1 + n) % n];
    const next = centerline[(nearestIdx + 1) % n];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const normalX = -dy / len;
    const normalY = dx / len;

    const offsetX = point.x - centerline[nearestIdx].x;
    const offsetY = point.y - centerline[nearestIdx].y;
    const signedOffset = offsetX * normalX + offsetY * normalY;

    return { distance: minDist, index: nearestIdx, signedOffset };
  }

  /**
   * Check if two line segments intersect (non-adjacent segments)
   * @param {Object} p1 - First segment start {x, y}
   * @param {Object} p2 - First segment end {x, y}
   * @param {Object} p3 - Second segment start {x, y}
   * @param {Object} p4 - Second segment end {x, y}
   * @returns {boolean} - True if segments intersect
   */
  function segmentsIntersect(p1, p2, p3, p4) {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x;
    const d2y = p4.y - p3.y;

    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-10) return false; // Parallel

    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
    const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;

    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  /**
   * Calculate discrete curvature at a point using three consecutive points
   * @param {Object} prev - Previous point {x, y}
   * @param {Object} curr - Current point {x, y}
   * @param {Object} next - Next point {x, y}
   * @returns {number} - Curvature estimate
   */
  function calculateCurvature(prev, curr, next) {
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const len1 = Math.hypot(v1x, v1y) || 1;
    const len2 = Math.hypot(v2x, v2y) || 1;

    const t1x = v1x / len1;
    const t1y = v1y / len1;
    const t2x = v2x / len2;
    const t2y = v2y / len2;

    const cross = t1x * t2y - t1y * t2x;
    const dot = t1x * t2x + t1y * t2y;
    const angle = Math.atan2(cross, dot);
    const avgLen = (len1 + len2) / 2 || 1;

    return Math.abs(angle / avgLen);
  }

  /**
   * Validate a racing line against track geometry
   * @param {Array} centerline - Track centerline points [{x, y}, ...]
   * @param {number} roadWidth - Track width in pixels
   * @param {Array} racingLine - Racing line points to validate [{x, y}, ...]
   * @returns {Object} - Validation results
   */
  function validateRacingLine(centerline, roadWidth, racingLine) {
    if (!racingLine || racingLine.length < 3) {
      return {
        valid: false,
        error: 'Invalid racing line',
      };
    }

    const halfWidth = roadWidth / 2;
    const n = racingLine.length;

    // 1. Check boundary violations
    let boundaryViolationsCount = 0;
    let maxBoundaryPenetration = 0;
    let minDistanceToEdge = Infinity;
    const violationIndices = [];

    for (let i = 0; i < n; i++) {
      const { distance, signedOffset } = findNearestCenterlinePoint(racingLine[i], centerline);
      const distToEdge = halfWidth - Math.abs(signedOffset);
      minDistanceToEdge = Math.min(minDistanceToEdge, distToEdge);

      if (distToEdge < 0) {
        boundaryViolationsCount++;
        maxBoundaryPenetration = Math.max(maxBoundaryPenetration, -distToEdge);
        violationIndices.push(i);
      }
    }

    // 2. Check self-intersections
    let selfIntersectionsCount = 0;
    const intersectionPairs = [];

    for (let i = 0; i < n; i++) {
      const p1 = racingLine[i];
      const p2 = racingLine[(i + 1) % n];

      // Check against non-adjacent segments (skip neighbors and wrap neighbors)
      for (let j = i + 2; j < n; j++) {
        // Skip if segments are too close (adjacent or wrap-around adjacent)
        if (j === n - 1 && i === 0) continue; // Last segment wraps to first
        if (i === n - 1 && j === 1) continue; // First wraps to last

        const p3 = racingLine[j];
        const p4 = racingLine[(j + 1) % n];

        if (segmentsIntersect(p1, p2, p3, p4)) {
          selfIntersectionsCount++;
          intersectionPairs.push([i, j]);
        }
      }
    }

    // 3. Calculate curvature statistics
    const curvatures = [];
    for (let i = 0; i < n; i++) {
      const prev = racingLine[(i - 1 + n) % n];
      const curr = racingLine[i];
      const next = racingLine[(i + 1) % n];
      curvatures.push(calculateCurvature(prev, curr, next));
    }

    const minCurvature = Math.min(...curvatures);
    const maxCurvature = Math.max(...curvatures);
    const avgCurvature = curvatures.reduce((sum, c) => sum + c, 0) / curvatures.length;

    // 4. Calculate path length
    let length = 0;
    for (let i = 0; i < n; i++) {
      const p1 = racingLine[i];
      const p2 = racingLine[(i + 1) % n];
      length += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }

    // 5. Check loop closure
    const closingDist = Math.hypot(
      racingLine[0].x - racingLine[n - 1].x,
      racingLine[0].y - racingLine[n - 1].y
    );
    const isClosedLoop = closingDist < 20; // 20px threshold

    // 6. Overall validity
    const valid = boundaryViolationsCount === 0 && selfIntersectionsCount === 0 && isClosedLoop;

    return {
      valid,
      boundaryViolationsCount,
      maxBoundaryPenetration,
      minDistanceToEdge,
      violationIndices,
      selfIntersectionsCount,
      intersectionPairs,
      curvatureStats: {
        min: minCurvature,
        max: maxCurvature,
        avg: avgCurvature,
      },
      length,
      closingDistance: closingDist,
      isClosedLoop,
      numPoints: n,
    };
  }

  /**
   * Format validation results as human-readable text
   * @param {Object} results - Validation results
   * @returns {string} - Formatted summary
   */
  function formatValidationResults(results) {
    if (results.error) {
      return `ERROR: ${results.error}`;
    }

    const lines = [];
    lines.push(`Points: ${results.numPoints}`);
    lines.push(`Length: ${results.length.toFixed(1)}px`);
    lines.push(
      `Closed Loop: ${results.isClosedLoop ? 'Yes' : 'No'} (gap: ${results.closingDistance.toFixed(1)}px)`
    );
    lines.push('');
    lines.push('Boundary Checks:');
    lines.push(`  Violations: ${results.boundaryViolationsCount}`);
    if (results.boundaryViolationsCount > 0) {
      lines.push(`  Max Penetration: ${results.maxBoundaryPenetration.toFixed(1)}px`);
    }
    lines.push(`  Min Distance to Edge: ${results.minDistanceToEdge.toFixed(1)}px`);
    lines.push('');
    lines.push('Self-Intersections:');
    lines.push(`  Count: ${results.selfIntersectionsCount}`);
    lines.push('');
    lines.push('Curvature:');
    lines.push(`  Min: ${results.curvatureStats.min.toFixed(6)}`);
    lines.push(`  Avg: ${results.curvatureStats.avg.toFixed(6)}`);
    lines.push(`  Max: ${results.curvatureStats.max.toFixed(6)}`);
    lines.push('');
    lines.push(`Overall: ${results.valid ? '✓ VALID' : '✗ INVALID'}`);

    return lines.join('\n');
  }

  // Export to global scope
  global.RacingLineValidation = {
    validateRacingLine,
    formatValidationResults,
    // Utility exports for testing
    findNearestCenterlinePoint,
    segmentsIntersect,
    calculateCurvature,
  };
})(typeof window !== 'undefined' ? window : this);
