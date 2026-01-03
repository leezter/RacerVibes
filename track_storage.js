(function(global){
  const DB_NAME = "RacingVibesTracks";
  const DB_VERSION = 1;
  const STORE_NAME = "tracks";
  let dbPromise = null;
  const logZipInfoOnce = window.RacerUtils && typeof window.RacerUtils.once === "function"
    ? window.RacerUtils.once(() => console.info("JSZip not found - falling back to multi-file export."))
    : () => {};

  function hasIndexedDB(){
    return window.RacerStorageUtils && typeof window.RacerStorageUtils.hasIndexedDB === "function"
      ? window.RacerStorageUtils.hasIndexedDB()
      : !!window.indexedDB;
  }

  function openDB(){
    if (!hasIndexedDB()) {
      return Promise.reject(new Error("IndexedDB unavailable"));
    }
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("byUpdatedAt", "updatedAt", { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
    return dbPromise;
  }

  async function runTransaction(mode, fn){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let result;
      try {
        result = fn(store);
      } catch (err) {
        tx.abort();
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  }

  async function listTracks(){
    if (!hasIndexedDB()) return [];
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const arr = Array.isArray(request.result) ? request.result : [];
        arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(arr);
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB getAll failed"));
    });
  }

  async function getTrack(id){
    if (!hasIndexedDB()) return null;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("IndexedDB get failed"));
    });
  }

  async function saveTrack(entry){
    if (!entry || !entry.id) {
      throw new Error("Track entry requires an id");
    }
    const now = Date.now();
    entry.updatedAt = now;
    if (!entry.createdAt) entry.createdAt = now;
    if (!hasIndexedDB()) {
      console.warn("IndexedDB unavailable; track not persisted.");
      return entry;
    }
    await runTransaction("readwrite", (store) => store.put(entry));
    return entry;
  }

  async function deleteTrack(id){
    if (!hasIndexedDB()) return;
    await runTransaction("readwrite", (store) => store.delete(id));
  }

  function uuid(){
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    let d = Date.now();
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      d += performance.now();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (d + Math.random() * 16) % 16 | 0;
      d = Math.floor(d / 16);
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function downloadBundle(entry){
    if (!entry) return;
    const utils = window.RacerUtils;
    const name = utils && typeof utils.sanitizeFilename === "function"
      ? utils.sanitizeFilename(entry.name || "track")
      : (entry.name || "track").replace(/[^a-z0-9_\-]+/gi, "_");
    const dataBlob = new Blob([JSON.stringify(entry.data, null, 2)], { type: "application/json" });
    const maskBlob = entry.mask && entry.mask.pngData ? dataURLToBlob(entry.mask.pngData) : null;
    const files = [
      { blob: dataBlob, filename: `${name}_data.json` }
    ];
    if (maskBlob) files.push({ blob: maskBlob, filename: `${name}_mask.png` });
    if (entry.thumbnail && entry.thumbnail.pngData) {
      files.push({ blob: dataURLToBlob(entry.thumbnail.pngData), filename: `${name}_thumb.png` });
    }
    if (files.length === 1) {
      triggerDownload(files[0].blob, files[0].filename);
      return;
    }
    if (typeof JSZip === "undefined") {
      logZipInfoOnce();
      files.forEach((file) => triggerDownload(file.blob, file.filename));
      return;
    }
    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.filename, file.blob);
    }
    zip.generateAsync({ type: "blob" }).then((blob) => triggerDownload(blob, `${name}_bundle.zip`));
  }

  function triggerDownload(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function dataURLToBlob(dataUrl){
    const m = /^data:(.+);base64,(.*)$/.exec(dataUrl || "");
    if (!m) return null;
    const mime = m[1];
    const binary = atob(m[2]);
    const len = binary.length;
    const buffer = new Uint8Array(len);
    for (let i = 0; i < len; i++) buffer[i] = binary.charCodeAt(i);
    return new Blob([buffer], { type: mime });
  }

  /**
   * Export a track as a JSON file for adding to built-in tracks.
   * The exported format includes only the essential data needed to recreate the track.
   * @param {string} id - Track ID to export
   */
  async function exportTrack(id) {
    const track = await getTrack(id);
    if (!track) {
      console.warn('Track not found:', id);
      return null;
    }
    const exportData = {
      _comment: 'RacingVibes Track Export - Copy the "points" array to add as a built-in track in racer.html',
      name: track.name,
      points: track.data?.points || track.points || [],
      exportedAt: new Date().toISOString(),
    };
    const utils = window.RacerUtils;
    const safeName = utils && typeof utils.sanitizeFilename === 'function'
      ? utils.sanitizeFilename(track.name || 'track')
      : (track.name || 'track').replace(/[^a-z0-9_\-]+/gi, '_');
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `${safeName}.racingvibes.json`);
    return true;
  }

  /**
   * Export a track as a complete JavaScript object definition for adding to racer.html as a built-in track.
   * This exports ALL necessary data including world dimensions, roadWidth, spawn points, etc.
   * The output can be directly pasted into the Tracks object in racer.html.
   * @param {string} id - Track ID to export
   */
  async function exportAsBuiltin(id) {
    const track = await getTrack(id);
    if (!track) {
      console.warn('Track not found:', id);
      return null;
    }
    
    const data = track.data || {};
    const name = track.name || data.name || 'Custom Track';
    const points = data.points || [];
    const world = data.world || { width: 960, height: 640, scale: 1 };
    const roadWidth = data.roadWidth || 80;
    const spawn = data.spawn || {};
    const startLine = data.startLine || {};
    const speedZones = data.speedZones || [];
    const labels = data.labels || [];
    const textureId = data.textureId || 'default';
    
    // Sample points to reduce file size (every 5th point for smooth curves)
    const sampledPoints = [];
    const step = Math.max(1, Math.floor(points.length / 400)); // Aim for ~400 points max
    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      sampledPoints.push({ x: Math.round(p.x), y: Math.round(p.y) });
    }
    // Ensure last point is included for closed loop
    if (points.length > 0) {
      const last = points[points.length - 1];
      const lastSampled = sampledPoints[sampledPoints.length - 1];
      if (lastSampled.x !== Math.round(last.x) || lastSampled.y !== Math.round(last.y)) {
        sampledPoints.push({ x: Math.round(last.x), y: Math.round(last.y) });
      }
    }
    
    // Format spawn and startLine
    const spawnPlayer = spawn.player || sampledPoints[0] || { x: 0, y: 0 };
    const spawnAi = spawn.ai || { x: (spawnPlayer.x || 0) - 20, y: spawnPlayer.y || 0 };
    const startA = startLine.a || spawnPlayer;
    const startB = startLine.b || { x: spawnPlayer.x, y: (spawnPlayer.y || 0) + 40 };
    
    // Create the JavaScript code for the built-in track
    const trackKey = name.replace(/[^a-zA-Z0-9]/g, '_');
    
    // Format points as compact array
    const pointsStr = sampledPoints.map(p => `{x:${p.x},y:${p.y}}`).join(',');
    
    const jsCode = `
// =============================================================================
// BUILT-IN TRACK: "${name}"
// Generated: ${new Date().toISOString()}
// =============================================================================
// 
// STEP 1: Add this track definition to the Tracks object in racer.html
//         (around line 1860, inside the "const Tracks = {" block)
//
// STEP 2: Add the track to the tracks array in racer_start_menu.html
//         (around line 2000, in "const tracks = [...]")
//         Add: { id: '${trackKey}', name: '${name}', desc: 'Your track description' }
//
// =============================================================================

            "${trackKey}": {
              name: "${name}",
              isCustom: true,
              world: { width: ${world.width}, height: ${world.height}, scale: ${world.scale || 1} },
              spawn: { 
                player: { x: ${Math.round(spawnPlayer.x)}, y: ${Math.round(spawnPlayer.y)}, angle: ${typeof spawnPlayer.angle === 'number' ? spawnPlayer.angle.toFixed(4) : 'Math.PI'} }, 
                ai: { x: ${Math.round(spawnAi.x)}, y: ${Math.round(spawnAi.y)}, angle: ${typeof spawnAi.angle === 'number' ? spawnAi.angle.toFixed(4) : 'Math.PI'} } 
              },
              startLine: { 
                a: { x: ${Math.round(startA.x)}, y: ${Math.round(startA.y)} }, 
                b: { x: ${Math.round(startB.x)}, y: ${Math.round(startB.y)} } 
              },
              textureId: "${textureId}",
              points: [
                ${pointsStr}
              ],
              speedZones: ${JSON.stringify(speedZones)},
              labels: ${JSON.stringify(labels)},
              roadWidth: ${roadWidth}
            },
`;

    const utils = window.RacerUtils;
    const safeName = utils && typeof utils.sanitizeFilename === 'function'
      ? utils.sanitizeFilename(name)
      : name.replace(/[^a-z0-9_\-]+/gi, '_');
    
    const blob = new Blob([jsCode], { type: 'text/javascript' });
    triggerDownload(blob, `${safeName}_builtin.js`);
    
    return true;
  }

  global.TrackStore = {
    openDB,
    listTracks,
    getTrack,
    saveTrack,
    deleteTrack,
    uuid,
    downloadBundle,
    exportTrack,
    exportAsBuiltin
  };
})(typeof window !== "undefined" ? window : this);
