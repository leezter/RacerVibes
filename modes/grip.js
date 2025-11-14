(function (global) {
  const gripMode = {
    id: 'grip',
    label: 'Grip',
    ai: {
      defaultDifficulty: 'hard',
      difficulties: ['easy', 'medium', 'hard']
    }
    // Keep config optional for now to avoid any behavior drift.
    // Future modes can add physicsPreset, gearboxConfig, hooks, uiTweaks, etc.
  };
  const modesApi = global.RacerModes;
  if (!modesApi || typeof modesApi.register !== 'function' || typeof modesApi.setDefault !== 'function') {
    // TODO: remove guard once registry is guaranteed to load ahead of mode definitions.
    return;
  }
  modesApi.register(gripMode);
  modesApi.setDefault('grip');
})(window);
