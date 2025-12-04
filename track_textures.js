/**
 * Track Texture Styles Module
 * Defines different asphalt texture presets for race tracks
 */
(function(global) {
  'use strict';

  /**
   * Track texture style definitions
   * Each style defines the visual properties of the track surface
   */
  const TEXTURE_STYLES = {
    /**
     * Modern - Fresh, very dark asphalt with minimal tire marks
     * Represents a newly paved professional racing circuit - pristine condition
     */
    modern: {
      id: 'modern',
      name: 'Modern Circuit',
      description: 'Fresh dark asphalt - newly paved, minimal tire marks',
      // Very dark, almost black asphalt (fresh pavement)
      baseColor: '#1a1c1e',
      // Low variation for uniform new surface
      baseVariation: 4,
      // Very subtle tire marks (new track)
      tireMarkBaseShade: 12,
      tireMarkVariation: 8,
      // Low tire mark visibility (fresh track)
      tireMarkIntensity: 0.15,
      tireMarkBaseIntensity: 0.02,
      tireMarkCurvatureBoost: 0.12,
      // Minimal noise for smooth new surface
      noiseBaseShade: 25,
      noiseVariation: 12,
      noiseBaseAlpha: 0.04,
      noiseAlphaVariation: 0.05,
      // Bright white center line (fresh paint)
      centerLineColor: '#ffffff',
      wearPatternIntensity: 0.05,
      oilStainIntensity: 0.02
    },

    /**
     * Classic - Medium grey with heavy tire marks from years of racing
     * Represents an established racing venue with decades of history
     */
    classic: {
      id: 'classic',
      name: 'Classic Raceway',
      description: 'Decades of racing history - heavy tire marks, worn surface',
      // Medium grey (well-used track)
      baseColor: '#4a4d52',
      // Moderate variation from wear
      baseVariation: 12,
      // Dark, prominent tire marks
      tireMarkBaseShade: 20,
      tireMarkVariation: 18,
      // Very visible tire marks (lots of racing)
      tireMarkIntensity: 0.55,
      tireMarkBaseIntensity: 0.15,
      tireMarkCurvatureBoost: 0.45,
      // Moderate roughness
      noiseBaseShade: 50,
      noiseVariation: 28,
      noiseBaseAlpha: 0.18,
      noiseAlphaVariation: 0.15,
      // Slightly faded center line
      centerLineColor: '#d8dce0',
      wearPatternIntensity: 0.35,
      oilStainIntensity: 0.20
    },

    /**
     * Weathered - Very light grey, sun-bleached old track
     * Represents an abandoned or poorly maintained circuit
     */
    weathered: {
      id: 'weathered',
      name: 'Weathered Tarmac',
      description: 'Sun-bleached, cracked surface - heavily worn and faded',
      // Light grey, sun-bleached appearance
      baseColor: '#787c82',
      // High variation for cracked/patchy surface
      baseVariation: 22,
      // Faded tire marks (old and weathered)
      tireMarkBaseShade: 55,
      tireMarkVariation: 35,
      // Moderate visibility but faded
      tireMarkIntensity: 0.40,
      tireMarkBaseIntensity: 0.12,
      tireMarkCurvatureBoost: 0.30,
      // Very rough, speckled surface
      noiseBaseShade: 85,
      noiseVariation: 45,
      noiseBaseAlpha: 0.28,
      noiseAlphaVariation: 0.22,
      // Very faded, barely visible center line
      centerLineColor: '#9ea3a8',
      wearPatternIntensity: 0.55,
      oilStainIntensity: 0.30
    },

    /**
     * Night Circuit - Deep black with blue tint, high contrast markings
     * Optimized for night racing with reflective properties
     */
    night: {
      id: 'night',
      name: 'Night Circuit',
      description: 'Deep black surface with blue tint - high contrast for night racing',
      // Very dark with slight blue tint
      baseColor: '#0f1218',
      // Very low variation for smooth surface
      baseVariation: 3,
      // High contrast tire marks (visible under lights)
      tireMarkBaseShade: 35,
      tireMarkVariation: 15,
      // Very visible, high contrast marks
      tireMarkIntensity: 0.50,
      tireMarkBaseIntensity: 0.10,
      tireMarkCurvatureBoost: 0.40,
      // Subtle speckling
      noiseBaseShade: 30,
      noiseVariation: 18,
      noiseBaseAlpha: 0.06,
      noiseAlphaVariation: 0.08,
      // Bright reflective center line
      centerLineColor: '#f8faff',
      wearPatternIntensity: 0.08,
      oilStainIntensity: 0.04
    },

    /**
     * Street Circuit - Brownish urban road with rough texture
     * City streets converted to racing - patches, repairs, rough surface
     */
    street: {
      id: 'street',
      name: 'Street Circuit',
      description: 'Urban road surface - brownish grey with patches and rough texture',
      // Brownish-grey urban road color
      baseColor: '#3d3a36',
      // Very high variation for patchy urban roads
      baseVariation: 28,
      // Scattered tire marks from regular traffic + racing
      tireMarkBaseShade: 28,
      tireMarkVariation: 30,
      // Moderate tire marks
      tireMarkIntensity: 0.38,
      tireMarkBaseIntensity: 0.08,
      tireMarkCurvatureBoost: 0.28,
      // Very rough, varied surface
      noiseBaseShade: 45,
      noiseVariation: 55,
      noiseBaseAlpha: 0.25,
      noiseAlphaVariation: 0.22,
      // Worn yellow-ish center line (urban roads)
      centerLineColor: '#e8e4d0',
      wearPatternIntensity: 0.45,
      oilStainIntensity: 0.25,
      // Street circuit specific: patches
      hasPatchwork: true,
      patchDensity: 0.15
    }
  };

  // Default style if none specified
  const DEFAULT_STYLE = 'modern';

  /**
   * Get a texture style by ID
   * @param {string} styleId - The style identifier
   * @returns {object} The texture style configuration
   */
  function getStyle(styleId) {
    const id = styleId && typeof styleId === 'string' ? styleId.toLowerCase() : DEFAULT_STYLE;
    return TEXTURE_STYLES[id] || TEXTURE_STYLES[DEFAULT_STYLE];
  }

  /**
   * Get all available texture styles
   * @returns {object} Map of all texture styles
   */
  function getAllStyles() {
    return { ...TEXTURE_STYLES };
  }

  /**
   * Get style options for dropdown menus
   * @returns {Array} Array of {id, name, description} objects
   */
  function getStyleOptions() {
    return Object.values(TEXTURE_STYLES).map(style => ({
      id: style.id,
      name: style.name,
      description: style.description
    }));
  }

  /**
   * Get the default style ID
   * @returns {string} Default style identifier
   */
  function getDefaultStyleId() {
    return DEFAULT_STYLE;
  }

  // Fallback RGB color when hex parsing fails (neutral grey)
  const FALLBACK_RGB = { r: 80, g: 85, b: 88 };

  /**
   * Parse a hex color to RGB components
   * @param {string} hex - Hex color string (e.g., '#3a3d40')
   * @returns {object} {r, g, b} values 0-255
   */
  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return { ...FALLBACK_RGB };
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    };
  }

  /**
   * Get the base color with optional variation
   * @param {object} style - Texture style configuration
   * @param {number} seed - Random seed for variation
   * @returns {string} CSS color string
   */
  function getBaseColorWithVariation(style, seed) {
    const rgb = hexToRgb(style.baseColor);
    const variation = style.baseVariation || 0;
    const seededRand = (s) => {
      const x = Math.sin(s * 9999) * 10000;
      return x - Math.floor(x);
    };
    const v = (seededRand(seed) - 0.5) * 2 * variation;
    const r = Math.max(0, Math.min(255, Math.round(rgb.r + v)));
    const g = Math.max(0, Math.min(255, Math.round(rgb.g + v)));
    const b = Math.max(0, Math.min(255, Math.round(rgb.b + v)));
    return `rgb(${r}, ${g}, ${b})`;
  }

  // Expose the module
  global.TrackTextures = {
    STYLES: TEXTURE_STYLES,
    DEFAULT_STYLE,
    getStyle,
    getAllStyles,
    getStyleOptions,
    getDefaultStyleId,
    hexToRgb,
    getBaseColorWithVariation
  };

})(typeof window !== 'undefined' ? window : this);
