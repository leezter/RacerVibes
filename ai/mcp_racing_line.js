/**
 * Minimum Curvature Path (MCP) Racing Line Generator
 *
 * This module generates an optimal racing line using an iterative optimization approach
 * that minimizes path curvature. Unlike the anchor-based method, MCP considers the entire
 * path holistically and converges to a smooth, minimum-curvature solution.
 *
 * Algorithm:
 * 1. Sample centerline evenly by arc length
 * 2. Compute tangents and normals at each point
 * 3. Represent path as p[i] = c[i] + n[i] * a[i] (lateral offsets)
 * 4. Iteratively optimize offsets to minimize curvature:
 *    - Use second differences as curvature proxy
 *    - Push against curvature along normal direction
 *    - Add regularization to prevent jitter
 *    - Clamp to track bounds
 * 5. Final smoothing pass for visual quality
 */

(function (global) {
  'use strict';

  const utils = global.RacerUtils || {};
  const clamp = utils.clamp || ((v, min, max) => (v < min ? min : v > max ? max : v));

  // Default configuration
  const DEFAULT_MCP_CONFIG = {
    numSamples: 800, // Points to resample centerline to
    iterations: 120, // Optimization iterations
    alpha: 0.35, // Step size for curvature reduction
    beta: 0.08, // Regularization strength (smoothness)
    margin: 3, // Safety margin from track edges (px) - reduced to allow more width usage
    finalSmoothingPasses: 3, // Post-optimization smoothing - reduced to preserve offsets
    finalSmoothingStrength: 0.2, // Smoothing strength (0-1) - reduced to prevent center bias
    centerBias: 0.0, // Optional center pull (0 = no bias, higher = pulls toward center)
    debug: false, // Enable debug logging
  };

  /**
   * Resample a closed path to have evenly-spaced points by arc length
   * @param {Array} points - Original path points [{x, y}, ...]
   * @param {number} numSamples - Desired number of output points
   * @returns {Array} - Resampled points
   */
  function resampleByArcLength(points, numSamples) {
    if (!points || points.length < 3) return points;

    // Calculate total path length
    let totalLength = 0;
    const segmentLengths = [];
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      segmentLengths.push(len);
      totalLength += len;
    }

    if (totalLength === 0) return points;

    // Resample at even intervals
    const targetSpacing = totalLength / numSamples;
    const resampled = [];
    let currentDist = 0;
    let segIdx = 0;
    let segRemaining = segmentLengths[0];

    for (let i = 0; i < numSamples; i++) {
      const targetDist = i * targetSpacing;

      // Advance to the segment containing targetDist
      while (currentDist + segRemaining < targetDist && segIdx < points.length) {
        currentDist += segRemaining;
        segIdx++;
        segRemaining = segmentLengths[segIdx % points.length];
      }

      // Interpolate within the current segment
      const t = (targetDist - currentDist) / segRemaining;
      const p1 = points[segIdx % points.length];
      const p2 = points[(segIdx + 1) % points.length];
      resampled.push({
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
      });
    }

    return resampled;
  }

  /**
   * Compute tangent vectors for each point (closed loop)
   * @param {Array} points - Path points
   * @returns {Array} - Tangent vectors [{x, y}, ...]
   */
  function computeTangents(points) {
    const n = points.length;
    const tangents = [];
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      tangents.push({ x: dx / len, y: dy / len });
    }
    return tangents;
  }

  /**
   * Compute normal vectors (perpendicular to tangents, pointing "right")
   * @param {Array} tangents - Tangent vectors
   * @returns {Array} - Normal vectors [{x, y}, ...]
   */
  function computeNormals(tangents) {
    return tangents.map((t) => ({ x: -t.y, y: t.x }));
  }

  /**
   * Laplacian smoothing for closed loop paths
   * @param {Array} points - Path points
   * @param {number} passes - Number of smoothing iterations
   * @param {number} strength - Smoothing strength (0-1)
   * @returns {Array} - Smoothed points
   */
  function smoothPath(points, passes, strength = 0.5) {
    let pts = points.map((p) => ({ x: p.x, y: p.y }));
    const n = pts.length;
    if (n < 3) return pts;

    for (let k = 0; k < passes; k++) {
      const next = new Array(n);
      for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const curr = pts[i];
        const nextPt = pts[(i + 1) % n];
        const midX = (prev.x + nextPt.x) / 2;
        const midY = (prev.y + nextPt.y) / 2;
        next[i] = {
          x: curr.x + (midX - curr.x) * strength,
          y: curr.y + (midY - curr.y) * strength,
        };
      }
      pts = next;
    }
    return pts;
  }

  /**
   * Generate MCP racing line using iterative curvature minimization
   * @param {Array} centerline - Track centerline points [{x, y}, ...]
   * @param {number} roadWidth - Track width in pixels
   * @param {Object} options - Configuration options
   * @returns {Object} - { points: [...], meta: {...} }
   */
  function generateMcpLine(centerline, roadWidth, options = {}) {
    const cfg = { ...DEFAULT_MCP_CONFIG, ...options };

    if (!Array.isArray(centerline) || centerline.length < 3) {
      return { points: [], meta: { error: 'Invalid centerline' } };
    }

    // 1. Resample centerline evenly
    const c = resampleByArcLength(centerline, cfg.numSamples);
    const n = c.length;

    // 2. Compute geometry
    const tangents = computeTangents(c);
    const normals = computeNormals(tangents);

    // 3. Initialize offsets (start at centerline)
    let offsets = new Array(n).fill(0);

    // 4. Compute bounds
    const halfWidth = roadWidth / 2;
    const aMin = -(halfWidth - cfg.margin);
    const aMax = halfWidth - cfg.margin;

    // 5. Iterative optimization
    let maxCurvProxy = 0;
    let avgCurvProxy = 0;
    let maxAbsOffset = 0;

    for (let iter = 0; iter < cfg.iterations; iter++) {
      // Compute current path points
      const p = new Array(n);
      for (let i = 0; i < n; i++) {
        p[i] = {
          x: c[i].x + normals[i].x * offsets[i],
          y: c[i].y + normals[i].y * offsets[i],
        };
      }

      // Compute second differences (curvature proxy)
      const d2 = new Array(n);
      maxCurvProxy = 0;
      avgCurvProxy = 0;
      for (let i = 0; i < n; i++) {
        const prev = p[(i - 1 + n) % n];
        const curr = p[i];
        const next = p[(i + 1) % n];
        d2[i] = {
          x: prev.x - 2 * curr.x + next.x,
          y: prev.y - 2 * curr.y + next.y,
        };
        const mag = Math.hypot(d2[i].x, d2[i].y);
        maxCurvProxy = Math.max(maxCurvProxy, mag);
        avgCurvProxy += mag;
      }
      avgCurvProxy /= n;

      // Update offsets
      const newOffsets = new Array(n);
      for (let i = 0; i < n; i++) {
        // Push against curvature
        const curvPush = cfg.alpha * (d2[i].x * normals[i].x + d2[i].y * normals[i].y);

        // Regularization (prevent jitter) - smooths offsets without center bias
        const prevOffset = offsets[(i - 1 + n) % n];
        const currOffset = offsets[i];
        const nextOffset = offsets[(i + 1) % n];
        const regPush = cfg.beta * (prevOffset - 2 * currOffset + nextOffset);

        // Optional center bias (disabled by default)
        const centerPull = -cfg.centerBias * currOffset;

        // Apply update and clamp
        newOffsets[i] = clamp(currOffset + curvPush + regPush + centerPull, aMin, aMax);
      }
      offsets = newOffsets;
    }

    // Calculate max absolute offset after optimization
    maxAbsOffset = 0;
    for (let i = 0; i < n; i++) {
      maxAbsOffset = Math.max(maxAbsOffset, Math.abs(offsets[i]));
    }

    // 6. Construct final path
    let finalPath = new Array(n);
    for (let i = 0; i < n; i++) {
      finalPath[i] = {
        x: c[i].x + normals[i].x * offsets[i],
        y: c[i].y + normals[i].y * offsets[i],
      };
    }

    // 7. Final smoothing pass
    finalPath = smoothPath(finalPath, cfg.finalSmoothingPasses, cfg.finalSmoothingStrength);

    // 8. Calculate path length
    let pathLength = 0;
    for (let i = 0; i < finalPath.length; i++) {
      const p1 = finalPath[i];
      const p2 = finalPath[(i + 1) % finalPath.length];
      pathLength += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }

    // 9. Calculate closing distance (should be small for closed loop)
    const closingDist = Math.hypot(
      finalPath[0].x - finalPath[finalPath.length - 1].x,
      finalPath[0].y - finalPath[finalPath.length - 1].y
    );

    // Debug logging
    const usableWidth = halfWidth - cfg.margin;
    const widthUsageRatio = usableWidth > 0 ? maxAbsOffset / usableWidth : 0;
    
    if (cfg.debug) {
      console.log('[MCP Debug]');
      console.log(`  Half width: ${halfWidth.toFixed(1)}px`);
      console.log(`  Margin: ${cfg.margin}px`);
      console.log(`  Usable width per side: ${usableWidth.toFixed(1)}px`);
      console.log(`  Max abs offset: ${maxAbsOffset.toFixed(1)}px`);
      console.log(`  Width usage ratio: ${(widthUsageRatio * 100).toFixed(1)}%`);
      console.log(`  Avg curvature proxy: ${avgCurvProxy.toFixed(6)}`);
      console.log(`  Max curvature proxy: ${maxCurvProxy.toFixed(6)}`);
    }

    return {
      points: finalPath,
      meta: {
        iterations: cfg.iterations,
        maxCurvatureProxy: maxCurvProxy,
        avgCurvatureProxy: avgCurvProxy,
        maxAbsOffset: maxAbsOffset,
        widthUsageRatio: widthUsageRatio,
        usableWidth: usableWidth,
        length: pathLength,
        closingDistance: closingDist,
        isClosedLoop: closingDist < 10, // threshold: 10px
        numPoints: finalPath.length,
        config: cfg,
      },
    };
  }

  // Export to global scope
  global.McpRacingLine = {
    generateMcpLine,
    // Utility exports for testing
    resampleByArcLength,
    computeTangents,
    computeNormals,
    smoothPath,
  };
})(typeof window !== 'undefined' ? window : this);
