// =============================================================================
// CZDM offscreen.js v1.1.0
// FIX: Revoke blob URLs after use to prevent memory leaks
// =============================================================================

const DB_NAME   = 'CZDM_DB';
const DB_VERSION = 1;
let db = null;

const crcTable = new Uint32Array(256);

function initCRC32Table() {
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        crcTable[i] = c;
    }
}

function calculateCRC32Chunk(buffer, previousCrc32 = 0) {
    let crc  = previousCrc32 ^ (-1);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < view.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ view[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
}

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
        request.onerror   = (e) => reject(e);
    });
}

async function processAssembly(taskId, filename) {
    if (!db) await initDB();

    // Track the blob URL so we can revoke it later
    let createdBlobUrl = null;

    try {
        const opfsRoot  = await navigator.storage.getDirectory();
        const fileHandle = await opfsRoot.getFileHandle(`czdm_${taskId}.bin`, { create: true });
        const writable   = await fileHandle.createWritable();

        const keys = await new Promise((resolve, reject) => {
            const tx    = db.transaction(['chunks'], 'readonly');
            const store = tx.objectStore('chunks');
            const req   = store.getAllKeys(IDBKeyRange.bound([taskId, 0], [taskId, Infinity]));
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror   = (e) => reject(e.target.error);
        });

        if (keys.length === 0) throw new Error('Storage empty');

        let currentCrc32 = 0;

        for (const key of keys) {
            const chunkData = await new Promise((resolve, reject) => {
                const tx    = db.transaction(['chunks'], 'readonly');
                const store = tx.objectStore('chunks');
                const req   = store.get(key);
                req.onsuccess = (e) => resolve(e.target.result.data);
                req.onerror   = (e) => reject(e.target.error);
            });

            currentCrc32 = calculateCRC32Chunk(chunkData, currentCrc32);
            await writable.write(chunkData);
        }

        await writable.close();

        const file            = await fileHandle.getFile();
        const url             = URL.createObjectURL(file);
        createdBlobUrl        = url;
        const finalCrc32Hex   = currentCrc32.toString(16).padStart(8, '0').toUpperCase();

        chrome.runtime.sendMessage({
            action:   'assembly_report',
            taskId,
            success:  true,
            blobUrl:  url,
            crc32:    finalCrc32Hex
        });

    } catch (err) {
        // Clean up any blob URL if creation partially succeeded
        if (createdBlobUrl) {
            try { URL.revokeObjectURL(createdBlobUrl); } catch (e) {}
        }
        chrome.runtime.sendMessage({ action: 'assembly_report', taskId, success: false, error: err.message });
    }
}

async function cleanupOPFSFile(taskId) {
    try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry(`czdm_${taskId}.bin`);
    } catch (e) {}
}

async function cleanupOrphanedOPFS(activeIds) {
    try {
        const opfsRoot = await navigator.storage.getDirectory();
        for await (const [name] of opfsRoot.entries()) {
            if (name.startsWith('czdm_') && name.endsWith('.bin')) {
                const taskId = name.replace('czdm_', '').replace('.bin', '');
                if (!activeIds.includes(taskId)) {
                    await opfsRoot.removeEntry(name);
                }
            }
        }
    } catch (e) {}
}

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'assemble_file') {
        processAssembly(msg.taskId, msg.filename);

    } else if (msg.action === 'cleanup_opfs') {
        cleanupOPFSFile(msg.taskId);

    } else if (msg.action === 'cleanup_orphaned_opfs') {
        cleanupOrphanedOPFS(msg.activeIds || []);

    } else if (msg.action === 'revoke_blob_url' && msg.url) {
        // FIX: Revoke the blob URL to free memory after Chrome finishes downloading
        try { URL.revokeObjectURL(msg.url); } catch (e) {}
    }
});

initCRC32Table();
