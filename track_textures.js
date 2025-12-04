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
     * Modern - Fresh, dark asphalt with clean tire marks
     * Represents a newly paved professional racing circuit
     */
    modern: {
      id: 'modern',
      name: 'Modern Circuit',
      description: 'Fresh dark asphalt with clean, crisp tire marks',
      // Base asphalt color (dark charcoal)
      baseColor: '#3a3d40',
      // Color variation range for base
      baseVariation: 8,
      // Tire mark colors (darker shades)
      tireMarkBaseShade: 25,
      tireMarkVariation: 15,
      // Tire mark intensity (0-1)
      tireMarkIntensity: 0.32,
      // Base intensity for tire marks
      tireMarkBaseIntensity: 0.06,
      // Curvature boost for tire marks at corners
      tireMarkCurvatureBoost: 0.28,
      // Asphalt noise speckle settings
      noiseBaseShade: 45,
      noiseVariation: 25,
      noiseBaseAlpha: 0.10,
      noiseAlphaVariation: 0.12,
      // Center line color
      centerLineColor: '#e0e5e8',
      // Additional styling
      wearPatternIntensity: 0.15,
      oilStainIntensity: 0.08
    },

    /**
     * Classic - Lighter grey asphalt with aged appearance
     * Represents an established racing venue with years of racing history
     */
    classic: {
      id: 'classic',
      name: 'Classic Raceway',
      description: 'Lighter grey asphalt with worn character',
      baseColor: '#5c6066',
      baseVariation: 10,
      tireMarkBaseShade: 35,
      tireMarkVariation: 20,
      tireMarkIntensity: 0.38,
      tireMarkBaseIntensity: 0.08,
      tireMarkCurvatureBoost: 0.30,
      noiseBaseShade: 60,
      noiseVariation: 30,
      noiseBaseAlpha: 0.14,
      noiseAlphaVariation: 0.14,
      centerLineColor: '#d0d5d8',
      wearPatternIntensity: 0.25,
      oilStainIntensity: 0.12
    },

    /**
     * Weathered - Heavily worn track with faded markings
     * Represents an old track that has seen many races
     */
    weathered: {
      id: 'weathered',
      name: 'Weathered Tarmac',
      description: 'Aged asphalt with heavy wear and faded markings',
      baseColor: '#6a6e72',
      baseVariation: 14,
      tireMarkBaseShade: 42,
      tireMarkVariation: 25,
      tireMarkIntensity: 0.42,
      tireMarkBaseIntensity: 0.10,
      tireMarkCurvatureBoost: 0.35,
      noiseBaseShade: 70,
      noiseVariation: 35,
      noiseBaseAlpha: 0.18,
      noiseAlphaVariation: 0.16,
      centerLineColor: '#b8bdc0',
      wearPatternIntensity: 0.35,
      oilStainIntensity: 0.18
    },

    /**
     * Night Circuit - Dark surface optimized for night racing
     * Features high contrast markings visible under lights
     */
    night: {
      id: 'night',
      name: 'Night Circuit',
      description: 'Dark surface with high-contrast tire marks',
      baseColor: '#2a2d30',
      baseVariation: 6,
      tireMarkBaseShade: 18,
      tireMarkVariation: 12,
      tireMarkIntensity: 0.40,
      tireMarkBaseIntensity: 0.08,
      tireMarkCurvatureBoost: 0.32,
      noiseBaseShade: 35,
      noiseVariation: 20,
      noiseBaseAlpha: 0.08,
      noiseAlphaVariation: 0.10,
      centerLineColor: '#f0f4f7',
      wearPatternIntensity: 0.12,
      oilStainIntensity: 0.06
    },

    /**
     * Street Circuit - Urban racing surface
     * Rougher texture with patches and repairs visible
     */
    street: {
      id: 'street',
      name: 'Street Circuit',
      description: 'Urban road surface with patches and repairs',
      baseColor: '#4a4e52',
      baseVariation: 16,
      tireMarkBaseShade: 30,
      tireMarkVariation: 22,
      tireMarkIntensity: 0.35,
      tireMarkBaseIntensity: 0.07,
      tireMarkCurvatureBoost: 0.25,
      noiseBaseShade: 55,
      noiseVariation: 40,
      noiseBaseAlpha: 0.16,
      noiseAlphaVariation: 0.18,
      centerLineColor: '#c5cad0',
      wearPatternIntensity: 0.30,
      oilStainIntensity: 0.15,
      // Street circuit specific: patches
      hasPatchwork: true,
      patchDensity: 0.08
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

  /**
   * Parse a hex color to RGB components
   * @param {string} hex - Hex color string (e.g., '#3a3d40')
   * @returns {object} {r, g, b} values 0-255
   */
  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return { r: 80, g: 85, b: 88 }; // fallback grey
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
