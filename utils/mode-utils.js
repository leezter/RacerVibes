(function (global) {
  function getCurrentModeId() {
    // Prefer runtime selection if set, else registry default, else 'grip'
    const fromBootstrap = typeof global.RACER_CURRENT_MODE === 'string' && global.RACER_CURRENT_MODE
      ? global.RACER_CURRENT_MODE
      : undefined;
    if (fromBootstrap) return fromBootstrap;
    return (global.RacerModes && global.RacerModes.getDefaultId && global.RacerModes.getDefaultId()) ||
           'grip';
  }

  function modeKey(base) {
    // Future use: `RV:<mode>:<base>`
    const mode = getCurrentModeId();
    return `RV:${mode}:${base}`;
  }

  global.RacerModeUtils = global.RacerModeUtils || { getCurrentModeId, modeKey };
})(window);
