(function (global) {
  const rallyMode = {
    id: 'rally',
    label: 'Rally',
    ai: {
      defaultDifficulty: 'hard',
      difficulties: ['easy', 'medium', 'hard'],
      count: 7,
      vehicleType: 'Rally',
    },
  };
  const modesApi = global.RacerModes;
  if (!modesApi || typeof modesApi.register !== 'function') {
    return;
  }
  modesApi.register(rallyMode);
})(window);
