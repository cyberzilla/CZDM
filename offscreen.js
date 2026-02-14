const DB_NAME = 'CZDM_DB';
const DB_VERSION = 1;
let db = null;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => reject(e);
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'assemble_file') {
    processAssembly(msg.taskId, msg.filename);
  }
});

async function processAssembly(taskId, filename) {
  if (!db) await initDB();
  try {
    const opfsRoot = await navigator.storage.getDirectory();
    const fileHandle = await opfsRoot.getFileHandle(`czdm_${taskId}.bin`, { create: true });
    const writable = await fileHandle.createWritable();

    // Ambil daftar kunci saja untuk menghindari memori bengkak (OOM)
    const keys = await new Promise((resolve, reject) => {
      const tx = db.transaction(['chunks'], 'readonly');
      const store = tx.objectStore('chunks');
      const request = store.getAllKeys(IDBKeyRange.bound([taskId, 0], [taskId, Infinity]));
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });

    if (keys.length === 0) throw new Error("Chunks empty");

    for (let key of keys) {
      const chunkData = await new Promise((resolve, reject) => {
        const tx = db.transaction(['chunks'], 'readonly');
        const store = tx.objectStore('chunks');
        const request = store.get(key);
        request.onsuccess = (e) => resolve(e.target.result.data);
        request.onerror = (e) => reject(e.target.error);
      });
      await writable.write(chunkData);
    }

    await writable.close();

    const file = await fileHandle.getFile();
    const url = URL.createObjectURL(file);

    chrome.runtime.sendMessage({ action: 'assembly_report', taskId, success: true, blobUrl: url });

    setTimeout(async () => {
      URL.revokeObjectURL(url);
      await opfsRoot.removeEntry(`czdm_${taskId}.bin`).catch(() => {});
    }, 60000);

  } catch (err) {
    chrome.runtime.sendMessage({ action: 'assembly_report', taskId, success: false, error: err.message });
  }
}