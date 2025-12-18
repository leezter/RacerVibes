/**
 * PRO_LINE (Professional Racing Line) Generator
 *
 * Generates a pro-style outside→inside→outside racing line using MCP as a baseline.
 * This mode detects corners and applies soft constraints to create classic racing geometry:
 * - Entry: Outside edge (maximum approach speed)
 * - Apex: Inside edge (late apex, minimum path)
 * - Exit: Outside edge (early throttle, maximum exit speed)
 *
 * Algorithm:
 * 1. Generate MCP baseline (smooth, stable foundation)
 * 2. Detect corner regions using curvature analysis
 * 3. Identify entry/apex/exit points for each corner
 * 4. Compute target offsets (outside/inside based on turn direction)
 * 5. Re-optimize with combined objective:
 *    - Curvature minimization (smoothness)
 *    - Soft constraints toward entry/apex/exit targets
 *    - Path length on straights
 * 6. Final smoothing
 */

(function (global) {
  'use strict';

  const utils = global.RacerUtils || {};
  const clamp = utils.clamp || ((v, min, max) => (v < min ? min : v > max ? max : v));

  // Default configuration for PRO_LINE mode
  // Strategy: Use MCP's stable elastic band solver directly
  const DEFAULT_PRO_LINE_CONFIG = {
    // Core MCP settings (use proven stable algorithm)
    numSamples: 800,
    iterations: 150, // More iterations for refinement
    alpha: 0.3, // Step size for curvature minimization
    beta: 0.08, // Regularization strength
    margin: 3, // Safety margin from walls

    // Pro-style shaping (optional second pass - currently disabled for stability)
    enableProShaping: false, // Set to true to enable entry/apex/exit shaping
    shapingIterations: 40, // Additional iterations if shaping enabled
    shapingWeight: 0.3, // Weight for pro-style constraints

    // Corner detection (only used if enableProShaping = true)
    curvatureEnterThreshold: 0.0005, // Very conservative
    curvatureExitThreshold: 0.0002,
    curvaturePeakMin: 0.0006,
    minCornerLength: 30, // Longer minimum
    cornerMergeGap: 15,
    entryLead: 15,
    exitLead: 15,
    lateApexFraction: 0.35,

    // Final smoothing
    finalSmoothingPasses: 3,
    finalSmoothingStrength: 0.2,

    debug: false,
  };

  /**
   * Detect corner regions in the path using curvature analysis with hysteresis
   * @param {Array} centerline - Path points [{x, y}, ...]
   * @param {Array} normals - Normal vectors for each point
   * @param {object} cfg - Configuration with curvature thresholds
   * @returns {Array} - Corner regions [{start, end, insideSign, maxCurvIdx, peakCurv, curvVec}, ...]
   */
  function detectCorners(centerline, normals, cfg) {
    const n = centerline.length;
    const curvatures = new Array(n);
    const curvatureVectors = new Array(n);

    // Compute raw curvature at each point using second differences
    for (let i = 0; i < n; i++) {
      const iPrev = (i - 1 + n) % n;
      const iNext = (i + 1) % n;

      const p0 = centerline[iPrev];
      const p1 = centerline[i];
      const p2 = centerline[iNext];

      // Second difference d2 = p[i-1] - 2*p[i] + p[i+1]
      // This vector points toward the inside of the turn
      const d2x = p0.x - 2 * p1.x + p2.x;
      const d2y = p0.y - 2 * p1.y + p2.y;
      const d2Mag = Math.hypot(d2x, d2y);

      // Store curvature magnitude
      curvatures[i] = d2Mag;
      
      // Store normalized curvature vector (points toward inside of turn)
      if (d2Mag > 1e-6) {
        curvatureVectors[i] = { x: d2x / d2Mag, y: d2y / d2Mag };
      } else {
        curvatureVectors[i] = { x: 0, y: 0 }; // Straight section
      }
    }

    // Apply moving average smoothing to reduce micro-curvature noise
    const smoothedCurv = new Array(n);
    const windowSize = cfg.cornerSmoothWindow;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -windowSize; j <= windowSize; j++) {
        const idx = (i + j + n) % n;
        sum += curvatures[idx];
      }
      smoothedCurv[i] = sum / (2 * windowSize + 1);
    }

    // Find regions using hysteresis thresholds
    const corners = [];
    let inCorner = false;
    let cornerStart = -1;
    let cornerPeakCurv = 0;
    let cornerPeakIdx = -1;

    for (let i = 0; i < n + 1; i++) {
      // Wrap around to close loop
      const idx = i % n;
      const curv = smoothedCurv[idx];

      if (!inCorner && curv > cfg.curvatureEnterThreshold) {
        // Start new corner (enter threshold)
        inCorner = true;
        cornerStart = idx;
        cornerPeakCurv = curv;
        cornerPeakIdx = idx;
      } else if (inCorner && curv < cfg.curvatureExitThreshold) {
        // End corner (exit threshold)
        const cornerEnd = (idx - 1 + n) % n;
        const length = cornerEnd >= cornerStart 
          ? cornerEnd - cornerStart + 1
          : n - cornerStart + cornerEnd + 1;

        // Only keep corners that meet length and peak curvature requirements
        if (length >= cfg.minCornerLength && cornerPeakCurv >= cfg.curvaturePeakMin) {
          // Compute insideSign from curvature vector at peak
          const kVec = curvatureVectors[cornerPeakIdx];
          const normal = normals[cornerPeakIdx];
          const insideSign = Math.sign(kVec.x * normal.x + kVec.y * normal.y);
          
          corners.push({
            start: cornerStart,
            end: cornerEnd,
            insideSign: insideSign, // +1 or -1 (or 0 for straight)
            maxCurvIdx: cornerPeakIdx,
            peakCurv: cornerPeakCurv,
          });
        }
        inCorner = false;
      } else if (inCorner) {
        // Track peak curvature while in corner
        if (curv > cornerPeakCurv) {
          cornerPeakCurv = curv;
          cornerPeakIdx = idx;
        }
      }
    }

    // Merge nearby corners of same sign
    const merged = [];
    for (let i = 0; i < corners.length; i++) {
      const curr = corners[i];
      const next = corners[(i + 1) % corners.length];
      
      const gap = next.start >= curr.end
        ? next.start - curr.end
        : n - curr.end + next.start;

      if (gap < cfg.cornerMergeGap && curr.insideSign === next.insideSign) {
        // Merge with next - update peak if needed
        if (next.peakCurv > curr.peakCurv) {
          curr.maxCurvIdx = next.maxCurvIdx;
          curr.peakCurv = next.peakCurv;
        }
        curr.end = next.end;
        i++; // Skip next
      }
      merged.push(curr);
    }

    return merged;
  }

  /**
   * Compute entry, apex, exit indices for a corner
   * @param {object} corner - Corner region {start, end, turnSign, maxCurvIdx}
   * @param {number} n - Total number of points
   * @param {number} entryLead - Points before start
   * @param {number} exitLead - Points after end
   * @param {number} lateApexFrac - Shift apex toward exit (0-1)
   * @returns {object} - {iEntry, iApex, iExit}
   */
  function computeCornerPoints(corner, n, entryLead, exitLead, lateApexFrac) {
    const iEntry = (corner.start - entryLead + n) % n;
    const iExit = (corner.end + exitLead) % n;

    // Apply late apex shift
    const cornerLength = corner.end >= corner.start
      ? corner.end - corner.start
      : n - corner.start + corner.end;
    const apexShift = Math.floor(lateApexFrac * cornerLength);
    const iApex = (corner.maxCurvIdx + apexShift) % n;

    return { iEntry, iApex, iExit };
  }

  /**
   * Generate PRO_LINE racing line
   * Uses MCP's proven stable elastic band solver directly.
   * Pro-style shaping (entry/apex/exit) can optionally be enabled as a second pass.
   * 
   * @param {Array} centerline - Track centerline points [{x, y}, ...]
   * @param {number} roadWidth - Track width (px)
   * @param {object} options - Configuration overrides
   * @returns {object} - {points, meta}
   */
  function generateProLine(centerline, roadWidth, options = {}) {
    try {
      const cfg = { ...DEFAULT_PRO_LINE_CONFIG, ...options };
      const halfWidth = roadWidth / 2;

      if (cfg.debug) {
        console.log('[PRO_LINE] Using stable MCP elastic band solver');
        console.log(`  Centerline points: ${centerline.length}`);
        console.log(`  Track width: ${roadWidth}px, Half width: ${halfWidth}px`);
        console.log(`  Pro shaping: ${cfg.enableProShaping ? 'ENABLED' : 'DISABLED (stable mode)'}`);
      }

      // Validate inputs
      if (!centerline || !Array.isArray(centerline) || centerline.length < 3) {
        throw new Error('PRO_LINE requires valid centerline with at least 3 points');
      }
      if (!roadWidth || roadWidth <= 0) {
        throw new Error('PRO_LINE requires positive road width');
      }

      // Use MCP module directly with PRO_LINE config
      if (!global.McpRacingLine || !global.McpRacingLine.generateMcpLine) {
        throw new Error('McpRacingLine module not loaded. Include mcp_racing_line.js first.');
      }

      // Generate using MCP's stable elastic band algorithm
      const mcpOptions = {
        numSamples: cfg.numSamples,
        iterations: cfg.iterations, // Use PRO_LINE's iteration count
        alpha: cfg.alpha,
        beta: cfg.beta,
        margin: cfg.margin,
        finalSmoothingPasses: cfg.finalSmoothingPasses,
        finalSmoothingStrength: cfg.finalSmoothingStrength,
        centerBias: 0, // No center bias
        debug: cfg.debug,
      };

      const result = global.McpRacingLine.generateMcpLine(centerline, roadWidth, mcpOptions);
      
      if (!result || !result.points || !result.meta) {
        throw new Error('MCP generation failed');
      }

      // If pro shaping is disabled (default for stability), return MCP result directly
      if (!cfg.enableProShaping) {
        if (cfg.debug) {
          console.log('[PRO_LINE] Returning stable MCP elastic band solution (no pro shaping)');
        }
        
        // Update metadata to indicate PRO_LINE algorithm
        result.meta.algorithm = 'PRO_LINE';
        result.meta.baselineAlgorithm = 'MCP';
        result.meta.proShapingEnabled = false;
        
        return result;
      }

      // Optional: Pro-style shaping as second pass
      // This section is only reached if enableProShaping = true
      if (cfg.debug) {
        console.log('[PRO_LINE] Applying optional pro-style shaping...');
      }

      const basePoints = result.points;
      const normals = result.meta.normals;
      const c = result.meta.centerline;
      const n = c.length;

      // Detect corners
      const corners = detectCorners(c, normals, cfg);

      if (cfg.debug) {
        console.log(`[PRO_LINE] Detected ${corners.length} corners for shaping`);
      }

      // If no corners, return baseline
      if (corners.length === 0) {
        result.meta.algorithm = 'PRO_LINE';
        result.meta.baselineAlgorithm = 'MCP';
        result.meta.proShapingEnabled = true;
        result.meta.cornersDetected = 0;
        return result;
      }

      // Compute entry/apex/exit points
      const cornerTargets = corners.map((corner) => {
        const pts = computeCornerPoints(corner, n, cfg.entryLead, cfg.exitLead, cfg.lateApexFraction);
        const W = halfWidth - cfg.margin;
        const aInside = corner.insideSign * W;
        const aOutside = -corner.insideSign * W;
        return { ...corner, ...pts, aInside, aOutside };
      });

      // Extract offsets from baseline
      const offsets = result.meta.offsets || new Array(n).fill(0);
      const aMin = -(halfWidth - cfg.margin);
      const aMax = halfWidth - cfg.margin;

      // Apply very gentle shaping iterations
      for (let iter = 0; iter < cfg.shapingIterations; iter++) {
        const p = offsets.map((a, i) => ({
          x: c[i].x + normals[i].x * a,
          y: c[i].y + normals[i].y * a,
        }));

        const d2 = new Array(n);
        for (let i = 0; i < n; i++) {
          const iPrev = (i - 1 + n) % n;
          const iNext = (i + 1) % n;
          d2[i] = {
            x: p[iPrev].x - 2 * p[i].x + p[iNext].x,
            y: p[iPrev].y - 2 * p[i].y + p[iNext].y,
          };
        }

        const newOffsets = new Array(n);
        for (let i = 0; i < n; i++) {
          const iPrev = (i - 1 + n) % n;
          const iNext = (i + 1) % n;

          // Primary: curvature minimization
          const curvPush = cfg.alpha * (d2[i].x * normals[i].x + d2[i].y * normals[i].y);
          const jitterUpdate = cfg.beta * (offsets[iPrev] - 2 * offsets[i] + offsets[iNext]);

          // Secondary: very gentle shaping pull
          let shapingPull = 0;
          for (const target of cornerTargets) {
            const entryDist = Math.min(Math.abs(i - target.iEntry), n - Math.abs(i - target.iEntry));
            const apexDist = Math.min(Math.abs(i - target.iApex), n - Math.abs(i - target.iApex));
            const exitDist = Math.min(Math.abs(i - target.iExit), n - Math.abs(i - target.iExit));

            const falloff = 20; // Wide falloff
            if (entryDist < falloff) {
              const w = cfg.shapingWeight * 0.3 * Math.exp(-entryDist * entryDist / (2 * falloff * falloff));
              shapingPull += w * (target.aOutside - offsets[i]);
            }
            if (apexDist < falloff) {
              const w = cfg.shapingWeight * 0.5 * Math.exp(-apexDist * apexDist / (2 * falloff * falloff));
              shapingPull += w * (target.aInside - offsets[i]);
            }
            if (exitDist < falloff) {
              const w = cfg.shapingWeight * 0.3 * Math.exp(-exitDist * exitDist / (2 * falloff * falloff));
              shapingPull += w * (target.aOutside - offsets[i]);
            }
          }

          newOffsets[i] = clamp(
            offsets[i] + curvPush + jitterUpdate + shapingPull,
            aMin,
            aMax
          );
        }

        offsets.splice(0, n, ...newOffsets);
      }

      // Build final points
      const finalPoints = offsets.map((a, i) => ({
        x: c[i].x + normals[i].x * a,
        y: c[i].y + normals[i].y * a,
      }));

      const maxAbsOffset = Math.max(...offsets.map(Math.abs));
      const widthUsageRatio = maxAbsOffset / (halfWidth - cfg.margin);

      if (cfg.debug) {
        console.log('[PRO_LINE] Shaping complete');
        console.log(`  Width usage: ${(widthUsageRatio * 100).toFixed(1)}%`);
        console.log(`  Corners shaped: ${corners.length}`);
      }

      return {
        points: finalPoints,
        meta: {
          algorithm: 'PRO_LINE',
          baselineAlgorithm: 'MCP',
          proShapingEnabled: true,
          cornersDetected: corners.length,
          widthUsageRatio,
          maxAbsOffset,
          centerline: c,
          normals,
          offsets,
        },
      };
    } catch (error) {
      console.error('[PRO_LINE] Error during generation:', error);
      console.error('[PRO_LINE] Stack trace:', error.stack);
      
      // Return fallback: use MCP if available, else simple centerline copy
      if (global.McpRacingLine && global.McpRacingLine.generateMcpLine) {
        console.warn('[PRO_LINE] Falling back to MCP baseline');
        try {
          return global.McpRacingLine.generateMcpLine(centerline, roadWidth, options);
        } catch (mcpError) {
          console.error('[PRO_LINE] MCP fallback also failed:', mcpError);
        }
      }
      
      // Last resort: return centerline as-is
      console.warn('[PRO_LINE] All algorithms failed, returning centerline');
      return {
        points: centerline.map(p => ({ x: p.x, y: p.y })),
        meta: {
          algorithm: 'FALLBACK_CENTERLINE',
          error: error.message,
        },
      };
    }
  }

  // Export
  global.ProLineRacing = {
    generateProLine,
    detectCorners,
    DEFAULT_PRO_LINE_CONFIG,
  };
})(window);
