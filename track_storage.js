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

  global.TrackStore = {
    openDB,
    listTracks,
    getTrack,
    saveTrack,
    deleteTrack,
    uuid,
    downloadBundle
  };
})(typeof window !== "undefined" ? window : this);
