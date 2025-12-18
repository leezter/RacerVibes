/**
 * Geometric Optimal Racing Line (Min-Curvature)
 *
 * This module implements a global geometric optimizer that minimizes overall
 * bending/curvature inside the track corridor. The racing line naturally produces
 * pro-style patterns (outside -> apex -> outside) without explicit corner detection.
 *
 * Algorithm:
 * 1. Represent racing line as offsets from a resampled smooth centerline
 * 2. Use elastic-band iteration with bending-energy smoothing
 * 3. Project back to corridor bounds each iteration
 * 4. Optional anti-wobble low-pass filter
 */

(function (global) {
  'use strict';

  const utils = global.RacerUtils || {};
  const clamp = utils.clamp || ((v, min, max) => (v < min ? min : v > max ? max : v));

  // Configuration constants
  const DEFAULT_CONFIG = {
    resampleStep: 12, // Arc-length spacing for centerline resampling
    iterations: 200, // Number of smoothing iterations
    lambda: 0.1, // Bending-energy smoothing strength (must be small for stability)
    safetyMargin: 15, // Safety margin from track edges (pixels)
    enableAntiWobble: false, // Optional low-pass filter to reduce oscillations
    centerlineSmoothing: 3, // Pre-smooth centerline to avoid jitter normals
    debugMode: false, // Enable console logging
  };

  /**
   * Resample a path to approximately constant arc-length spacing
   */
  function resamplePath(points, step) {
    if (!points || points.length < 2) return points;

    const resampled = [{ x: points[0].x, y: points[0].y }];
    let accumulated = 0;

    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segmentLength = Math.hypot(dx, dy);

      if (segmentLength === 0) continue;

      accumulated += segmentLength;

      while (accumulated >= step) {
        const remainder = accumulated - step;
        const t = 1 - remainder / segmentLength;
        resampled.push({
          x: a.x + dx * t,
          y: a.y + dy * t,
        });
        accumulated = remainder;
      }
    }

    // Ensure loop closure - adjust last point to match first
    if (resampled.length > 1) {
      const last = resampled[resampled.length - 1];
      const first = resampled[0];
      const closeDist = Math.hypot(first.x - last.x, first.y - last.y);

      // If the last point is very close to first, remove it to avoid duplicate
      if (closeDist < step * 0.5) {
        resampled.pop();
      }
    }

    return resampled;
  }

  /**
   * Apply simple moving average smoothing to a closed path
   */
  function smoothPath(points, passes, weight = 0.5) {
    if (!points || points.length < 3 || passes === 0) return points;

    let result = points.map((p) => ({ x: p.x, y: p.y }));
    const n = result.length;

    for (let pass = 0; pass < passes; pass++) {
      const smoothed = [];
      for (let i = 0; i < n; i++) {
        const prev = result[(i - 1 + n) % n];
        const curr = result[i];
        const next = result[(i + 1) % n];
        smoothed.push({
          x: curr.x * (1 - weight) + (prev.x + next.x) * 0.5 * weight,
          y: curr.y * (1 - weight) + (prev.y + next.y) * 0.5 * weight,
        });
      }
      result = smoothed;
    }

    return result;
  }

  /**
   * Compute unit tangent and normal vectors at each point
   * Ensures normals are continuous (no flipping)
   */
  function computeTangentsAndNormals(points) {
    const n = points.length;
    const tangents = [];
    const normals = [];

    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;

      const tx = dx / len;
      const ty = dy / len;
      tangents.push({ x: tx, y: ty });

      // Normal is perpendicular to tangent (rotate 90 degrees)
      let nx = -ty;
      let ny = tx;

      // Ensure continuity: if normal flips relative to previous, flip it back
      if (i > 0) {
        const prevNormal = normals[i - 1];
        const dot = nx * prevNormal.x + ny * prevNormal.y;
        if (dot < 0) {
          nx = -nx;
          ny = -ny;
        }
      }

      normals.push({ x: nx, y: ny });
    }

    return { tangents, normals };
  }

  /**
   * Compute corridor bounds from track edges
   * aMin[i] = max offset toward right edge (negative)
   * aMax[i] = max offset toward left edge (positive)
   */
  function computeCorridorBounds(centerline, normals, roadWidth, safetyMargin) {
    const n = centerline.length;
    const aMin = new Array(n);
    const aMax = new Array(n);
    const halfWidth = roadWidth / 2 - safetyMargin;

    for (let i = 0; i < n; i++) {
      // Assuming symmetric corridor around centerline
      // In a real implementation, you might have explicit left/right edges
      aMin[i] = -halfWidth;
      aMax[i] = halfWidth;

      // Validate bounds
      if (aMin[i] >= aMax[i]) {
        // Invalid corridor - use previous or default
        if (i > 0) {
          aMin[i] = aMin[i - 1];
          aMax[i] = aMax[i - 1];
        } else {
          aMin[i] = -halfWidth;
          aMax[i] = halfWidth;
        }
        if (cfg.debugMode) {
          console.warn(`Invalid corridor at point ${i}, using fallback`);
        }
      }
    }

    return { aMin, aMax };
  }

  /**
   * Build path points from centerline and offsets
   */
  function buildPathFromOffsets(centerline, normals, offsets) {
    const n = centerline.length;
    const path = [];

    for (let i = 0; i < n; i++) {
      path.push({
        x: centerline[i].x + normals[i].x * offsets[i],
        y: centerline[i].y + normals[i].y * offsets[i],
      });
    }

    return path;
  }

  /**
   * Project a point back to the corridor by computing its offset and clamping
   */
  function projectToCorridorOffset(point, centerPoint, normal, aMin, aMax) {
    const dx = point.x - centerPoint.x;
    const dy = point.y - centerPoint.y;
    const offset = dx * normal.x + dy * normal.y;
    return clamp(offset, aMin, aMax);
  }

  /**
   * Calculate path curvature (unsigned - just magnitude)
   * Higher curvature = tighter turn = higher cost
   */
  function calculatePathCurvature(prev, curr, next) {
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len1 = Math.hypot(v1x, v1y) || 1;
    const len2 = Math.hypot(v2x, v2y) || 1;
    
    // Normalized vectors
    const n1x = v1x / len1;
    const n1y = v1y / len1;
    const n2x = v2x / len2;
    const n2y = v2y / len2;
    
    // Cross product magnitude (unsigned curvature)
    const cross = Math.abs(n1x * n2y - n1y * n2x);
    const avgLen = (len1 + len2) / 2;
    
    // Return squared curvature (heavily penalize tight turns)
    const kappa = cross / avgLen;
    return kappa * kappa;
  }

  /**
   * Calculate centerline curvature with direction
   * Returns {magnitude, sign} where sign indicates turn direction
   */
  function calculateCenterlineCurvature(prev, curr, next) {
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len1 = Math.hypot(v1x, v1y) || 1;
    const len2 = Math.hypot(v2x, v2y) || 1;
    
    // Cross product (SIGNED) - tells us turn direction
    const cross = (v1x / len1) * (v2y / len2) - (v1y / len1) * (v2x / len2);
    const avgLen = (len1 + len2) / 2;
    const curvature = cross / avgLen;
    
    return {
      magnitude: Math.abs(curvature),
      sign: Math.sign(curvature)
    };
  }

  /**
   * Calculate local cost for offset optimization
   * Primary: minimize path curvature
   * Secondary: smooth offset profile
   * Tertiary: on curves, reward cutting inside (racing line heuristic)
   */
  function calculateLocalCost(centerline, normals, offsets, i, wCurvature, wSmooth, wRacingLine, centerlineCurvatures) {
    const n = offsets.length;
    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const prev2Idx = (i - 2 + n) % n;
    const next2Idx = (i + 2) % n;
    
    // Build path points for curvature calculation
    // We need to check curvature at i-1, i, and i+1 since offset[i] affects all three
    let totalCurvature = 0;
    
    // Curvature at i-1
    const pp1 = {
      x: centerline[prev2Idx].x + normals[prev2Idx].x * offsets[prev2Idx],
      y: centerline[prev2Idx].y + normals[prev2Idx].y * offsets[prev2Idx]
    };
    const pp2 = {
      x: centerline[prevIdx].x + normals[prevIdx].x * offsets[prevIdx],
      y: centerline[prevIdx].y + normals[prevIdx].y * offsets[prevIdx]
    };
    const pp3 = {
      x: centerline[i].x + normals[i].x * offsets[i],
      y: centerline[i].y + normals[i].y * offsets[i]
    };
    totalCurvature += calculatePathCurvature(pp1, pp2, pp3);
    
    // Curvature at i
    const pNext = {
      x: centerline[nextIdx].x + normals[nextIdx].x * offsets[nextIdx],
      y: centerline[nextIdx].y + normals[nextIdx].y * offsets[nextIdx]
    };
    totalCurvature += calculatePathCurvature(pp2, pp3, pNext);
    
    // Curvature at i+1
    const pNext2 = {
      x: centerline[next2Idx].x + normals[next2Idx].x * offsets[next2Idx],
      y: centerline[next2Idx].y + normals[next2Idx].y * offsets[next2Idx]
    };
    totalCurvature += calculatePathCurvature(pp3, pNext, pNext2);
    
    const curvatureCost = totalCurvature * wCurvature;
    
    // Smoothness cost (second derivative of offsets) - prevents wobble
    const accel = offsets[prevIdx] - 2 * offsets[i] + offsets[nextIdx];
    const smoothCost = accel * accel * wSmooth;
    
    // Racing line heuristic: on curves, reward moving toward inside
    // centerlineCurvature.sign tells us turn direction
    // Reward offset in the direction that cuts inside the turn
    const curv = centerlineCurvatures[i];
    const racingLineCost = -(curv.sign * offsets[i] * curv.magnitude) * wRacingLine;
    
    return curvatureCost + smoothCost + racingLineCost;
  }

  /**
   * Apply anti-wobble low-pass filter (simple 3-point moving average)
   */
  function applyAntiWobble(offsets) {
    const n = offsets.length;
    const filtered = new Array(n);

    for (let i = 0; i < n; i++) {
      const prev = offsets[(i - 1 + n) % n];
      const curr = offsets[i];
      const next = offsets[(i + 1) % n];
      filtered[i] = 0.25 * prev + 0.5 * curr + 0.25 * next;
    }

    return filtered;
  }

  /**
   * Calculate curvature at a point using three points
   */
  function calculateCurvatureAtPoint(prev, curr, next) {
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len1 = Math.hypot(v1x, v1y) || 1;
    const len2 = Math.hypot(v2x, v2y) || 1;
    const cross = (v1x / len1) * (v2y / len2) - (v1y / len1) * (v2x / len2);
    const avgLen = (len1 + len2) / 2;
    return Math.abs(cross / avgLen);
  }

  /**
   * Calculate validation metrics for the racing line
   */
  function calculateMetrics(path, offsets, aMin, aMax) {
    const n = path.length;
    let maxLateralStep = 0;
    let minMargin = Infinity;
    let pathLength = 0;
    let maxCurvature = 0;

    for (let i = 0; i < n; i++) {
      // Max lateral step
      const prevIdx = (i - 1 + n) % n;
      const lateralStep = Math.abs(offsets[i] - offsets[prevIdx]);
      maxLateralStep = Math.max(maxLateralStep, lateralStep);

      // Min margin to bounds
      const marginToMin = offsets[i] - aMin[i];
      const marginToMax = aMax[i] - offsets[i];
      const margin = Math.min(marginToMin, marginToMax);
      minMargin = Math.min(minMargin, margin);

      // Path length
      const nextIdx = (i + 1) % n;
      const dx = path[nextIdx].x - path[i].x;
      const dy = path[nextIdx].y - path[i].y;
      pathLength += Math.hypot(dx, dy);

      // Curvature estimate (using three points)
      const prev = path[prevIdx];
      const curr = path[i];
      const next = path[nextIdx];
      const curvature = calculateCurvatureAtPoint(prev, curr, next);
      maxCurvature = Math.max(maxCurvature, curvature);
    }

    return {
      maxLateralStep,
      minMargin,
      pathLength,
      maxCurvature,
    };
  }

  /**
   * Main function: Generate optimal racing line using min-curvature approach
   *
   * @param {Array} centerline - Track centerline points [{x, y}, ...]
   * @param {number} roadWidth - Track width in pixels
   * @param {Object} options - Configuration options
   * @returns {Array} - Racing line points with additional properties
   */
  function generateOptimalRacingLineMinCurvature(centerline, roadWidth, options = {}) {
    if (!Array.isArray(centerline) || centerline.length < 3) {
      console.error('Invalid centerline for optimal racing line generation');
      return [];
    }

    const cfg = { ...DEFAULT_CONFIG, ...options };

    if (cfg.debugMode) {
      console.log('=== Optimal Racing Line Generation ===');
      console.log('Centerline points:', centerline.length);
      console.log('Road width:', roadWidth);
      console.log('Configuration:', cfg);
    }

    // Step 1: Resample centerline to constant arc-length spacing
    let resampled = resamplePath(centerline, cfg.resampleStep);

    // Step 2: Smooth centerline slightly to avoid jitter normals
    if (cfg.centerlineSmoothing > 0) {
      resampled = smoothPath(resampled, cfg.centerlineSmoothing, 0.3);
    }

    const n = resampled.length;
    if (n < 3) {
      console.error('Not enough points after resampling');
      return [];
    }

    if (cfg.debugMode) {
      console.log('Resampled points:', n);
    }

    // Step 3: Compute tangents and normals
    const { tangents, normals } = computeTangentsAndNormals(resampled);

    // Step 4: Compute centerline curvatures
    const centerlineCurvatures = new Array(n);
    for (let i = 0; i < n; i++) {
      const prevIdx = (i - 1 + n) % n;
      const nextIdx = (i + 1) % n;
      centerlineCurvatures[i] = calculateCenterlineCurvature(
        resampled[prevIdx],
        resampled[i],
        resampled[nextIdx]
      );
    }

    // Step 5: Compute corridor bounds
    const { aMin, aMax } = computeCorridorBounds(resampled, normals, roadWidth, cfg.safetyMargin);

    // Step 6: Initialize offsets (start at centerline)
    let offsets = new Array(n).fill(0);

    // Optimization parameters
    const wCurvature = 1000.0;    // Path curvature weight (primary: minimize bending)
    const wSmooth = 0.01;         // Smoothness weight (prevent wobble)
    const wRacingLine = 50000.0;  // Racing line heuristic (cut inside on curves)
    const step = 3.0;             // Gradient descent step size
    const eps = 1.0;              // Finite difference epsilon
    const maxStepSize = 10.0;     // Maximum offset change per iteration

    // Log bounds info if debug mode
    if (cfg.debugMode) {
      const minAMin = Math.min(...aMin);
      const maxAMin = Math.max(...aMin);
      const minAMax = Math.min(...aMax);
      const maxAMax = Math.max(...aMax);
      const minWidth = Math.min(...aMin.map((min, i) => aMax[i] - min));
      console.log('=== Corridor Bounds ===');
      console.log(`aMin range: [${minAMin.toFixed(2)}, ${maxAMin.toFixed(2)}]`);
      console.log(`aMax range: [${minAMax.toFixed(2)}, ${maxAMax.toFixed(2)}]`);
      console.log(`Min corridor width: ${minWidth.toFixed(2)}px`);
    }

    // Step 7: Iterative optimization with projected gradient descent
    for (let iter = 0; iter < cfg.iterations; iter++) {
      // Compute gradient for each offset via finite differences
      const gradients = new Array(n);
      
      for (let i = 0; i < n; i++) {
        // Calculate base cost
        const baseCost = calculateLocalCost(resampled, normals, offsets, i, wCurvature, wSmooth, wRacingLine, centerlineCurvatures);
        
        // Perturb offset and calculate new cost
        const originalOffset = offsets[i];
        offsets[i] = clamp(originalOffset + eps, aMin[i], aMax[i]);
        const perturbedCost = calculateLocalCost(resampled, normals, offsets, i, wCurvature, wSmooth, wRacingLine, centerlineCurvatures);
        offsets[i] = originalOffset; // Restore
        
        // Finite difference gradient
        gradients[i] = (perturbedCost - baseCost) / eps;
      }
      
      // Update offsets via gradient descent with step size limiting
      for (let i = 0; i < n; i++) {
        const delta = -step * gradients[i];
        // Limit maximum change per iteration for stability
        const limitedDelta = clamp(delta, -maxStepSize, maxStepSize);
        offsets[i] = clamp(offsets[i] + limitedDelta, aMin[i], aMax[i]);
      }
      
      // Apply low-pass filter every 10 iterations to reduce numerical chatter
      if (iter % 10 === 9) {
        const filtered = applyAntiWobble(offsets);
        for (let i = 0; i < n; i++) {
          offsets[i] = clamp(filtered[i], aMin[i], aMax[i]);
        }
      }
      
      // Log progress at key iterations
      if (cfg.debugMode && (iter === 0 || iter === 10 || iter === 50 || iter === cfg.iterations - 1)) {
        const minOffset = Math.min(...offsets);
        const maxOffset = Math.max(...offsets);
        const meanAbsOffset = offsets.reduce((sum, a) => sum + Math.abs(a), 0) / n;
        let maxLateralStep = 0;
        for (let i = 0; i < n; i++) {
          const prevIdx = (i - 1 + n) % n;
          maxLateralStep = Math.max(maxLateralStep, Math.abs(offsets[i] - offsets[prevIdx]));
        }
        console.log(`Iter ${iter}: offset range [${minOffset.toFixed(2)}, ${maxOffset.toFixed(2)}], mean|a|=${meanAbsOffset.toFixed(2)}, maxLateralStep=${maxLateralStep.toFixed(2)}`);
      }
    }

    // Step 7: Build final path
    const finalPath = buildPathFromOffsets(resampled, normals, offsets);

    // Step 8: Calculate validation metrics
    const metrics = calculateMetrics(finalPath, offsets, aMin, aMax);

    if (cfg.debugMode) {
      console.log('=== Optimal Line Metrics ===');
      
      // Calculate additional useful metrics
      const minOffset = Math.min(...offsets);
      const maxOffset = Math.max(...offsets);
      const meanAbsOffset = offsets.reduce((sum, a) => sum + Math.abs(a), 0) / n;
      const availableHalfWidth = roadWidth / 2 - cfg.safetyMargin;
      const percentWidthUsed = (meanAbsOffset / availableHalfWidth) * 100;
      
      console.log('Offset range:', `[${minOffset.toFixed(2)}, ${maxOffset.toFixed(2)}] px`);
      console.log('Mean |offset|:', meanAbsOffset.toFixed(2), 'px');
      console.log('% of half-width used:', percentWidthUsed.toFixed(1) + '%');
      console.log('Max lateral step:', metrics.maxLateralStep.toFixed(2), 'px');
      console.log('Min margin to bounds:', metrics.minMargin.toFixed(2), 'px');
      console.log('Path length:', metrics.pathLength.toFixed(1), 'px');
      console.log('Max curvature:', metrics.maxCurvature.toFixed(6));

      if (metrics.minMargin < 0) {
        console.warn('WARNING: Line violates boundary constraints!');
      }
    }

    // Store additional data for visualization and debugging
    return finalPath.map((p, i) => ({
      x: p.x,
      y: p.y,
      offset: offsets[i],
      aMin: aMin[i],
      aMax: aMax[i],
      centerX: resampled[i].x,
      centerY: resampled[i].y,
      normalX: normals[i].x,
      normalY: normals[i].y,
    }));
  }

  // Export to global namespace
  global.RacerOptimalLine = {
    generate: generateOptimalRacingLineMinCurvature,
    calculateCurvature: calculateCurvatureAtPoint,
    DEFAULT_CONFIG,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.RacerOptimalLine;
  }
})(typeof window !== 'undefined' ? window : this);
