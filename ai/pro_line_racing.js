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
  const DEFAULT_PRO_LINE_CONFIG = {
    // MCP baseline settings
    numSamples: 800,
    mcpIterations: 60, // Fewer iterations for baseline (PRO will refine)
    mcpAlpha: 0.25,
    mcpBeta: 0.08,
    margin: 3,

    // Corner detection (with hysteresis)
    curvatureEnterThreshold: 0.0003, // Higher threshold to START detecting a corner
    curvatureExitThreshold: 0.00015, // Lower threshold to STOP detecting a corner
    curvaturePeakMin: 0.0004, // Discard corners with peak below this
    minCornerLength: 20, // Minimum points to be considered a corner (increased)
    cornerMergeGap: 12, // Merge corners separated by < this many points
    cornerSmoothWindow: 5, // Moving average window for curvature smoothing

    // Entry/Apex/Exit positioning
    entryLead: 12, // Points before corner start for entry
    exitLead: 12, // Points after corner end for exit
    lateApexFraction: 0.35, // Shift apex this fraction toward exit (0.35 = 35% late)

    // Pro-line optimization
    proIterations: 80, // Additional iterations for pro-style refinement
    proAlpha: 0.3, // Step size
    proBeta: 0.06, // Regularization
    
    // Soft constraint weights (reduced to avoid oscillation)
    entryWeight: 0.5, // Pull toward outside before corner
    apexWeight: 0.8, // Pull toward inside at apex (strongest)
    exitWeight: 0.5, // Pull toward outside after corner
    constraintFalloff: 12, // Gaussian falloff distance (points) - wider spread

    // Final smoothing
    finalSmoothingPasses: 4,
    finalSmoothingStrength: 0.25,

    debug: false,
  };

  /**
   * Detect corner regions in the path using curvature analysis with hysteresis
   * @param {Array} centerline - Path points [{x, y}, ...]
   * @param {object} cfg - Configuration with curvature thresholds
   * @returns {Array} - Corner regions [{start, end, turnSign, maxCurvIdx, peakCurv}, ...]
   */
  function detectCorners(centerline, cfg) {
    const n = centerline.length;
    const curvatures = new Array(n);

    // Compute raw curvature at each point using cross product
    for (let i = 0; i < n; i++) {
      const iPrev = (i - 1 + n) % n;
      const iNext = (i + 1) % n;

      const p0 = centerline[iPrev];
      const p1 = centerline[i];
      const p2 = centerline[iNext];

      const dx1 = p1.x - p0.x;
      const dy1 = p1.y - p0.y;
      const dx2 = p2.x - p1.x;
      const dy2 = p2.y - p1.y;

      // Cross product gives signed curvature
      const crossProduct = dx1 * dy2 - dy1 * dx2;
      const denom = Math.hypot(dx1, dy1) * Math.hypot(dx2, dy2) + 1e-9;
      curvatures[i] = crossProduct / denom;
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
    let cornerSign = 0;
    let cornerPeakCurv = 0;

    for (let i = 0; i < n + 1; i++) {
      // Wrap around to close loop
      const idx = i % n;
      const curv = smoothedCurv[idx];
      const absCurv = Math.abs(curv);

      if (!inCorner && absCurv > cfg.curvatureEnterThreshold) {
        // Start new corner (enter threshold)
        inCorner = true;
        cornerStart = idx;
        cornerSign = curv > 0 ? 1 : -1;
        cornerPeakCurv = absCurv;
      } else if (inCorner && absCurv < cfg.curvatureExitThreshold) {
        // End corner (exit threshold)
        const cornerEnd = (idx - 1 + n) % n;
        const length = cornerEnd >= cornerStart 
          ? cornerEnd - cornerStart + 1
          : n - cornerStart + cornerEnd + 1;

        // Only keep corners that meet length and peak curvature requirements
        if (length >= cfg.minCornerLength && cornerPeakCurv >= cfg.curvaturePeakMin) {
          corners.push({
            start: cornerStart,
            end: cornerEnd,
            turnSign: cornerSign,
            maxCurvIdx: -1, // Will compute later
            peakCurv: cornerPeakCurv,
          });
        }
        inCorner = false;
      } else if (inCorner) {
        // Track peak curvature while in corner
        cornerPeakCurv = Math.max(cornerPeakCurv, absCurv);
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

      if (gap < cfg.cornerMergeGap && curr.turnSign === next.turnSign) {
        // Merge with next
        curr.end = next.end;
        curr.peakCurv = Math.max(curr.peakCurv, next.peakCurv);
        i++; // Skip next
      }
      merged.push(curr);
    }

    // Find apex (max curvature) for each corner using smoothed curvatures
    for (const corner of merged) {
      let maxCurv = 0;
      let maxIdx = corner.start;

      for (let i = corner.start; ; i++) {
        const idx = i % n;
        const absCurv = Math.abs(smoothedCurv[idx]);
        if (absCurv > maxCurv) {
          maxCurv = absCurv;
          maxIdx = idx;
        }
        if (idx === corner.end) break;
      }

      corner.maxCurvIdx = maxIdx;
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
   * @param {Array} centerline - Track centerline points [{x, y}, ...]
   * @param {number} roadWidth - Track width (px)
   * @param {object} options - Configuration overrides
   * @returns {object} - {points, meta, corners}
   */
  function generateProLine(centerline, roadWidth, options = {}) {
    try {
      const cfg = { ...DEFAULT_PRO_LINE_CONFIG, ...options };
      const halfWidth = roadWidth / 2;
      const n = cfg.numSamples;

      if (cfg.debug) {
        console.log('[PRO_LINE] Starting generation...');
        console.log(`  Centerline points: ${centerline.length}, Target samples: ${n}`);
        console.log(`  Track width: ${roadWidth}px, Half width: ${halfWidth}px`);
      }

      // Validate inputs
      if (!centerline || !Array.isArray(centerline) || centerline.length < 3) {
        console.error('[PRO_LINE] Invalid centerline:', centerline);
        throw new Error('PRO_LINE requires valid centerline with at least 3 points');
      }
      if (!roadWidth || roadWidth <= 0) {
        console.error('[PRO_LINE] Invalid road width:', roadWidth);
        throw new Error('PRO_LINE requires positive road width');
      }

      // Step 1: Generate MCP baseline using existing module
      if (!global.McpRacingLine) {
        console.error('[PRO_LINE] McpRacingLine module not found on window/global');
        throw new Error('McpRacingLine module not loaded. Include mcp_racing_line.js first.');
      }
      if (!global.McpRacingLine.generateMcpLine) {
        console.error('[PRO_LINE] McpRacingLine.generateMcpLine function not found');
        throw new Error('McpRacingLine.generateMcpLine function not available');
      }

      const mcpOptions = {
        numSamples: cfg.numSamples,
        iterations: cfg.mcpIterations,
        alpha: cfg.mcpAlpha,
        beta: cfg.mcpBeta,
        margin: cfg.margin,
        centerBias: 0,
        debug: false,
      };

      const mcpResult = global.McpRacingLine.generateMcpLine(centerline, roadWidth, mcpOptions);
      
      if (!mcpResult || !mcpResult.points || !mcpResult.meta) {
        console.error('[PRO_LINE] MCP result invalid:', mcpResult);
        throw new Error('MCP baseline generation failed');
      }
      
      const basePoints = mcpResult.points;
      const normals = mcpResult.meta.normals;
      const c = mcpResult.meta.centerline;

    if (cfg.debug) {
      console.log(`[PRO_LINE] MCP baseline generated: ${basePoints.length} points`);
    }

    // Step 2: Detect corners
    const corners = detectCorners(c, cfg);

    if (cfg.debug) {
      console.log(`[PRO_LINE] Detected ${corners.length} corners:`);
      corners.forEach((corner, idx) => {
        const length = corner.end >= corner.start
          ? corner.end - corner.start + 1
          : n - corner.start + corner.end + 1;
        console.log(`  Corner ${idx + 1}: [${corner.start}..${corner.end}] (${length} points), turnSign=${corner.turnSign}, apex=${corner.maxCurvIdx}, peakCurv=${corner.peakCurv.toFixed(6)}`);
      });
    }

    // If no corners detected, just return smoothed MCP baseline
    if (corners.length === 0) {
      if (cfg.debug) {
        console.log('[PRO_LINE] No corners detected, returning MCP baseline');
      }
      return mcpResult;
    }

    // Step 3: Compute entry/apex/exit points for each corner
    const cornerTargets = corners.map(corner => {
      const pts = computeCornerPoints(corner, n, cfg.entryLead, cfg.exitLead, cfg.lateApexFraction);
      return { ...corner, ...pts };
    });

    // Step 4: Compute target offsets
    const aMin = -(halfWidth - cfg.margin);
    const aMax = halfWidth - cfg.margin;

    // Extract initial offsets from MCP baseline
    const offsets = new Array(n);
    for (let i = 0; i < n; i++) {
      // Project basePoint onto normal to get offset
      const dx = basePoints[i].x - c[i].x;
      const dy = basePoints[i].y - c[i].y;
      offsets[i] = dx * normals[i].x + dy * normals[i].y;
      offsets[i] = clamp(offsets[i], aMin, aMax);
    }

    if (cfg.debug) {
      console.log('[PRO_LINE] Starting pro-style optimization...');
    }

    // Step 5: Pro-line optimization with soft constraints
    for (let iter = 0; iter < cfg.proIterations; iter++) {
      // Build points from current offsets
      const p = offsets.map((a, i) => ({
        x: c[i].x + normals[i].x * a,
        y: c[i].y + normals[i].y * a,
      }));

      // Compute second differences (curvature proxy)
      const d2 = new Array(n);
      for (let i = 0; i < n; i++) {
        const iPrev = (i - 1 + n) % n;
        const iNext = (i + 1) % n;
        d2[i] = {
          x: p[iPrev].x - 2 * p[i].x + p[iNext].x,
          y: p[iPrev].y - 2 * p[i].y + p[iNext].y,
        };
      }

      // Update offsets
      const newOffsets = new Array(n);
      for (let i = 0; i < n; i++) {
        const iPrev = (i - 1 + n) % n;
        const iNext = (i + 1) % n;

        // Curvature minimization (push against bending)
        const curvPush = cfg.proAlpha * (d2[i].x * normals[i].x + d2[i].y * normals[i].y);

        // Regularization (jitter reduction)
        const jitterUpdate = cfg.proBeta * (offsets[iPrev] - 2 * offsets[i] + offsets[iNext]);

        // Soft constraints toward entry/apex/exit targets
        // Use weighted average of all nearby constraints
        let constraintPull = 0;
        for (const target of cornerTargets) {
          // Compute distances (handle wrap-around)
          const entryDist = Math.min(Math.abs(i - target.iEntry), n - Math.abs(i - target.iEntry));
          const apexDist = Math.min(Math.abs(i - target.iApex), n - Math.abs(i - target.iApex));
          const exitDist = Math.min(Math.abs(i - target.iExit), n - Math.abs(i - target.iExit));

          // Apply Gaussian falloff for each constraint type
          const falloffDist = cfg.constraintFalloff * 2.5;
          
          // Entry constraint (outside)
          if (entryDist < falloffDist) {
            const entryTarget = -target.turnSign * (halfWidth - cfg.margin);
            const entryWeight = cfg.entryWeight * Math.exp(-entryDist * entryDist / (2 * cfg.constraintFalloff * cfg.constraintFalloff));
            constraintPull += entryWeight * (entryTarget - offsets[i]);
          }

          // Apex constraint (inside) - strongest
          if (apexDist < falloffDist) {
            const apexTarget = target.turnSign * (halfWidth - cfg.margin);
            const apexWeight = cfg.apexWeight * Math.exp(-apexDist * apexDist / (2 * cfg.constraintFalloff * cfg.constraintFalloff));
            constraintPull += apexWeight * (apexTarget - offsets[i]);
          }

          // Exit constraint (outside)
          if (exitDist < falloffDist) {
            const exitTarget = -target.turnSign * (halfWidth - cfg.margin);
            const exitWeight = cfg.exitWeight * Math.exp(-exitDist * exitDist / (2 * cfg.constraintFalloff * cfg.constraintFalloff));
            constraintPull += exitWeight * (exitTarget - offsets[i]);
          }
        }

        // Combine updates
        newOffsets[i] = clamp(
          offsets[i] + curvPush + jitterUpdate + constraintPull,
          aMin,
          aMax
        );
      }

      offsets.splice(0, n, ...newOffsets);
    }

    if (cfg.debug) {
      console.log('[PRO_LINE] Optimization complete');
    }

    // Step 6: Final smoothing on offsets
    for (let pass = 0; pass < cfg.finalSmoothingPasses; pass++) {
      const smoothed = new Array(n);
      for (let i = 0; i < n; i++) {
        const iPrev = (i - 1 + n) % n;
        const iNext = (i + 1) % n;
        const neighborAvg = (offsets[iPrev] + offsets[iNext]) / 2;
        smoothed[i] = offsets[i] + (neighborAvg - offsets[i]) * cfg.finalSmoothingStrength;
        smoothed[i] = clamp(smoothed[i], aMin, aMax);
      }
      offsets.splice(0, n, ...smoothed);
    }

    // Build final points
    const finalPoints = offsets.map((a, i) => ({
      x: c[i].x + normals[i].x * a,
      y: c[i].y + normals[i].y * a,
    }));

    // Calculate metrics
    const maxAbsOffset = Math.max(...offsets.map(Math.abs));
    const widthUsageRatio = maxAbsOffset / (halfWidth - cfg.margin);

    if (cfg.debug) {
      console.log('[PRO_LINE Debug - Final Results]');
      console.log(`  Half width: ${halfWidth.toFixed(1)}px`);
      console.log(`  Margin: ${cfg.margin}px`);
      console.log(`  Max abs offset: ${maxAbsOffset.toFixed(1)}px`);
      console.log(`  Width usage ratio: ${(widthUsageRatio * 100).toFixed(1)}% (target: 80-100%)`);
      console.log(`  Corners detected: ${corners.length}`);
    }

      return {
        points: finalPoints,
        meta: {
          algorithm: 'PRO_LINE',
          baselineAlgorithm: 'MCP',
          corners: cornerTargets,
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
