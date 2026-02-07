const DB_NAME = 'CZDM_DB';
const DB_VERSION = 1;
let db = null;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onerror = (e) => reject(e);
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'assemble_file') processAssembly(msg.taskId, msg.filename);
});

async function processAssembly(taskId, filename) {
  if (!db) await initDB();
  try {
    const chunks = await getAllChunks(taskId);
    if (chunks.length === 0) throw new Error("Chunks empty");
    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    chrome.runtime.sendMessage({ action: 'assembly_report', taskId, success: true, blobUrl: url });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    chrome.runtime.sendMessage({ action: 'assembly_report', taskId, success: false, error: err.message });
  }
}

function getAllChunks(taskId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['chunks'], 'readonly');
    const store = tx.objectStore('chunks');
    const request = store.openCursor(IDBKeyRange.bound([taskId, 0], [taskId, Infinity]));
    const chunks = [];
    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { chunks.push(cursor.value.data); cursor.continue(); } else { resolve(chunks); }
    };
    request.onerror = (e) => reject(e.target.error);
  });
}