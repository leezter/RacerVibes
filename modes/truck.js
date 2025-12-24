(function (global) {
  const truckMode = {
    id: 'truck',
    label: 'Truck',
    ai: {
      defaultDifficulty: 'hard',
      difficulties: ['easy', 'medium', 'hard'],
      count: 7,
      vehicleType: 'Truck',
    },
  };
  const modesApi = global.RacerModes;
  if (!modesApi || typeof modesApi.register !== 'function') {
    return;
  }
  modesApi.register(truckMode);
})(window);
