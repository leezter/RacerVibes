(function (global) {
  const _modes = new Map();
  let _defaultId = null;

  function register(mode) {
    if (!mode || !mode.id) throw new Error('Mode must have an id');
    if (_modes.has(mode.id)) throw new Error('Duplicate mode id: ' + mode.id);
    _modes.set(mode.id, Object.freeze(mode));
    if (!_defaultId) _defaultId = mode.id;
  }

  function setDefault(id) {
    if (!_modes.has(id)) throw new Error('Unknown mode: ' + id);
    _defaultId = id;
  }

  function get(id) {
    if (id && _modes.has(id)) return _modes.get(id);
    return _modes.get(_defaultId);
  }

  function list() {
    return Array.from(_modes.values());
  }

  function getDefaultId() {
    return _defaultId;
  }

  global.RacerModes = global.RacerModes || { register, setDefault, get, list, getDefaultId };
})(window);
