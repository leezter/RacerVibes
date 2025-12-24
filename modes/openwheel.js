(function (global) {
  const openWheelMode = {
    id: 'openwheel',
    label: 'Open Wheel',
    ai: {
      defaultDifficulty: 'hard',
      difficulties: ['easy', 'medium', 'hard'],
      count: 7,
      vehicleType: 'F1',
    },
  };
  const modesApi = global.RacerModes;
  if (!modesApi || typeof modesApi.register !== 'function') {
    return;
  }
  modesApi.register(openWheelMode);
})(window);
