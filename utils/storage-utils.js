(function (global) {
  const hasIndexedDB = () => {
    try {
      return typeof global.indexedDB !== 'undefined';
    } catch (err) {
      return false;
    }
  };
  const StorageUtils = { hasIndexedDB };
  global.RacerStorageUtils = global.RacerStorageUtils || StorageUtils;
})(window);
