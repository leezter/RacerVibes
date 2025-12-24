(function (global) {
  const gtMode = {
    id: 'gt',
    label: 'GT',
    ai: {
      defaultDifficulty: 'hard',
      difficulties: ['easy', 'medium', 'hard'],
      count: 7,
      vehicleType: 'GT',
    },
  };
  const modesApi = global.RacerModes;
  if (!modesApi || typeof modesApi.register !== 'function') {
    return;
  }
  modesApi.register(gtMode);
})(window);
