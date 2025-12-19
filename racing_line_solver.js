/**
 * RacingLineSolver - Elastic Band Algorithm for Minimum Curvature Racing Lines
 * 
 * Implements an iterative gradient descent solver that generates optimal racing lines
 * following the Outside-Inside-Outside apex pattern through mathematical optimization.
 * 
 * Algorithm:
 * 1. Uniform Resampling: Convert irregular user points to evenly-spaced centerline
 * 2. Boundary Calculation: Compute left/right track edges using normal vectors
 * 3. Elastic Band Solver: Iteratively smooth the line while respecting track boundaries
 * 
 * @module RacingLineSolver
 */

(function (global) {
  'use strict';

  // ============================================================
  // HELPER FUNCTIONS
  // ============================================================

  /**
   * Calculate Euclidean distance between two points
   */
  function getDistance(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.hypot(dx, dy);
  }

  /**
   * Normalize a vector to unit length
   */
  function normalizeVector(v) {
    const len = Math.hypot(v.x, v.y);
    if (len < 1e-10) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  /**
   * Calculate dot product of two vectors
   */
  function dotProduct(v1, v2) {
    return v1.x * v2.x + v1.y * v2.y;
  }

  /**
   * Clamp a value between min and max
   */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * Linear interpolation
   */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // ============================================================
  // RACING LINE SOLVER CLASS
  // ============================================================

  class RacingLineSolver {
    /**
     * Create a new racing line solver
     * @param {Object} options - Configuration options
     * @param {number} options.resampleSpacing - Distance between resampled points (default: 10)
     * @param {number} options.iterations - Number of optimization iterations (default: 75)
     * @param {number} options.optimizationFactor - Aggressiveness of corner cutting 0.0-1.0 (default: 0.7)
     * @param {number} options.smoothingStrength - Strength of smoothing force 0.0-1.0 (default: 0.5)
     */
    constructor(options = {}) {
      this.resampleSpacing = options.resampleSpacing || 10;
      this.iterations = options.iterations || 75;
      this.optimizationFactor = clamp(options.optimizationFactor || 0.7, 0, 1);
      this.smoothingStrength = clamp(options.smoothingStrength || 0.5, 0, 1);
    }

    /**
     * Solve for optimal racing line
     * @param {Array<{x: number, y: number}>} centerLinePoints - Raw user-drawn path
     * @param {number} trackWidth - Width of the track in pixels
     * @returns {Array<{x: number, y: number}>} - Optimized racing line points
     */
    solve(centerLinePoints, trackWidth) {
      if (!Array.isArray(centerLinePoints) || centerLinePoints.length < 3) {
        console.warn('RacingLineSolver: Invalid input - need at least 3 points');
        return centerLinePoints || [];
      }

      // Step 1: Uniform Resampling
      const resampledCenter = this._resamplePath(centerLinePoints, this.resampleSpacing);
      
      if (resampledCenter.length < 3) {
        console.warn('RacingLineSolver: Resampling produced too few points');
        return centerLinePoints;
      }

      // Step 2: Pre-calculate Boundaries
      const boundaries = this._calculateBoundaries(resampledCenter, trackWidth);

      // Step 3: Elastic Band Solver
      const optimizedLine = this._elasticBandSolver(resampledCenter, boundaries);

      return optimizedLine;
    }

    /**
     * Step 1: Resample the path with uniform spacing using linear interpolation
     * @private
     */
    _resamplePath(points, spacing) {
      if (points.length < 2) return points;

      const resampled = [];
      const n = points.length;
      const isLoop = getDistance(points[0], points[n - 1]) < spacing * 2;

      for (let i = 0; i < n; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        
        // Skip last segment if not a closed loop
        if (!isLoop && i === n - 1) break;

        const segmentDist = getDistance(p1, p2);
        const numSlices = Math.max(1, Math.round(segmentDist / spacing));

        for (let j = 0; j < numSlices; j++) {
          const t = j / numSlices;
          resampled.push({
            x: lerp(p1.x, p2.x, t),
            y: lerp(p1.y, p2.y, t),
          });
        }
      }

      // For closed loops, ensure we don't duplicate the start point
      if (isLoop && resampled.length > 0) {
        const first = resampled[0];
        const last = resampled[resampled.length - 1];
        if (getDistance(first, last) < spacing * 0.5) {
          resampled.pop();
        }
      }

      return resampled;
    }

    /**
     * Step 2: Calculate left and right track boundaries for each point
     * @private
     */
    _calculateBoundaries(centerLine, trackWidth) {
      const n = centerLine.length;
      const halfWidth = trackWidth / 2;
      const boundaries = [];

      for (let i = 0; i < n; i++) {
        const prev = centerLine[(i - 1 + n) % n];
        const curr = centerLine[i];
        const next = centerLine[(i + 1) % n];

        // Calculate tangent vector (direction of travel)
        const tangent = normalizeVector({
          x: next.x - prev.x,
          y: next.y - prev.y,
        });

        // Normal vector (perpendicular to tangent, points left)
        // In 2D: if tangent is (dx, dy), normal is (-dy, dx) for left
        const normal = { x: -tangent.y, y: tangent.x };

        // Calculate boundary positions
        const leftBound = {
          x: curr.x + normal.x * halfWidth,
          y: curr.y + normal.y * halfWidth,
        };

        const rightBound = {
          x: curr.x - normal.x * halfWidth,
          y: curr.y - normal.y * halfWidth,
        };

        boundaries.push({
          center: { x: curr.x, y: curr.y },
          left: leftBound,
          right: rightBound,
          normal: normal,
        });
      }

      return boundaries;
    }

    /**
     * Step 3: Elastic Band Solver - Iterative gradient descent optimization
     * @private
     */
    _elasticBandSolver(centerLine, boundaries) {
      const n = centerLine.length;
      
      // Initialize racing line as a copy of the centerline
      let racingLine = centerLine.map((p) => ({ x: p.x, y: p.y }));

      // Calculate curvature to identify corners that need cutting
      const curvatures = this._calculateCurvature(racingLine);

      // Run optimization iterations
      for (let iter = 0; iter < this.iterations; iter++) {
        const newLine = [];

        for (let i = 0; i < n; i++) {
          const prev = racingLine[(i - 1 + n) % n];
          const curr = racingLine[i];
          const next = racingLine[(i + 1) % n];

          // Calculate target position as midpoint of neighbors (smoothing force)
          const targetX = (prev.x + next.x) / 2;
          const targetY = (prev.y + next.y) / 2;

          // Calculate how much this point should move based on local curvature
          // Higher curvature = more aggressive cutting
          const curvature = Math.abs(curvatures[i]);
          const curvatureFactor = Math.min(1, curvature * 200); // Scale curvature to 0-1
          
          // Blend smoothing strength with optimization factor and curvature
          const effectiveStrength = this.smoothingStrength * (0.5 + 0.5 * this.optimizationFactor * (1 + curvatureFactor));

          const smoothedX = lerp(curr.x, targetX, effectiveStrength);
          const smoothedY = lerp(curr.y, targetY, effectiveStrength);

          // Constraint: Project onto track boundaries
          const constrained = this._constrainToTrack(
            { x: smoothedX, y: smoothedY },
            boundaries[i]
          );

          newLine.push(constrained);
        }

        racingLine = newLine;
        
        // Update curvatures for next iteration
        if (iter < this.iterations - 1) {
          curvatures.splice(0, curvatures.length, ...this._calculateCurvature(racingLine));
        }
      }

      return racingLine;
    }

    /**
     * Calculate signed curvature at each point
     * @private
     */
    _calculateCurvature(path) {
      const n = path.length;
      const curvatures = [];
      
      for (let i = 0; i < n; i++) {
        const prev = path[(i - 1 + n) % n];
        const curr = path[i];
        const next = path[(i + 1) % n];
        
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
        const avgLen = (len1 + len2) * 0.5 || 1;
        
        curvatures.push(angle / avgLen);
      }
      
      return curvatures;
    }

    /**
     * Constrain a point to stay within track boundaries
     * Projects the point onto the line segment between left and right boundaries
     * @private
     */
    _constrainToTrack(point, boundary) {
      const { left, right, center, normal } = boundary;

      // Calculate the track width vector from right to left
      const trackVector = {
        x: left.x - right.x,
        y: left.y - right.y,
      };

      // Vector from right boundary to the point
      const pointVector = {
        x: point.x - right.x,
        y: point.y - right.y,
      };

      // Project point onto the track width line segment
      const trackLength = Math.hypot(trackVector.x, trackVector.y);
      if (trackLength < 1e-10) return { x: center.x, y: center.y };

      // Calculate projection parameter t (0 = right boundary, 1 = left boundary)
      const t = dotProduct(pointVector, trackVector) / (trackLength * trackLength);

      // Clamp t to [0, 1] to stay within boundaries
      const tClamped = clamp(t, 0, 1);

      // Calculate final constrained position
      return {
        x: right.x + trackVector.x * tClamped,
        y: right.y + trackVector.y * tClamped,
      };
    }
  }

  // ============================================================
  // EXPORT
  // ============================================================

  // Export to global scope
  if (typeof module !== 'undefined' && module.exports) {
    // Node.js - export as module and attach to global
    module.exports = RacingLineSolver;
    global.RacingLineSolver = RacingLineSolver;
  } else {
    // Browser
    global.RacingLineSolver = RacingLineSolver;
  }
})(typeof window !== 'undefined' ? window : globalThis);
