(function (global) {
  const bubbleMode = {
    id: 'bubble',
    label: 'Bubble',
    ai: {
      defaultDifficulty: 'medium',
      difficulties: ['easy', 'medium', 'hard'],
      count: 7,
      vehicleType: 'Bubble',
    },
  };
  const modesApi = global.RacerModes;
  if (!modesApi || typeof modesApi.register !== 'function') {
    return;
  }
  modesApi.register(bubbleMode);
})(window);
