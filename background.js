// background.js - CZDM Engine v1.1 Optimized
// Resource-friendly storage management & Corruption-proof assembly

const DB_NAME = 'CZDM_DB';
const DB_VERSION = 1;
let db = null;
let tasks = new Map();
let activeControllers = new Map();

const MAX_CONCURRENT_DOWNLOADS = 3;
const CHUNK_SIZE = 1024 * 1024 * 1; // 1MB Buffer

// --- THROTTLING VARIABLES ---
let lastSaveTime = 0;
const SAVE_INTERVAL = 2000; // Simpan state ke storage max tiap 2 detik
let broadcastInterval = null;

// Loop utama untuk kalkulasi kecepatan & broadcast ke UI
function startBroadcastLoop() {
    if (broadcastInterval) clearInterval(broadcastInterval);
    broadcastInterval = setInterval(() => {
        let needsBroadcast = false;
        tasks.forEach(task => {
            if (task.status === 'running') {
                const currentLoaded = task.loaded;
                const prevLoaded = task.prevLoaded || 0;

                // Hitung speed
                let diff = currentLoaded - prevLoaded;
                if (diff < 0) diff = 0; // Prevent negative speed glitch
                task.speed = diff;

                task.prevLoaded = currentLoaded;

                if (task.speed > 0 && task.total > 0) {
                    const remainingBytes = task.total - task.loaded;
                    task.remainingTime = Math.ceil(remainingBytes / task.speed);
                } else {
                    task.remainingTime = -1;
                }
                needsBroadcast = true;
            } else {
                task.speed = 0;
                // Jangan reset prevLoaded disini agar resume startnya benar
            }
        });
        if (needsBroadcast) broadcast();
    }, 1000);
}

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (db.objectStoreNames.contains('chunks')) db.deleteObjectStore('chunks');
            db.createObjectStore('chunks', { keyPath: ['taskId', 'offset'] });
        };
        request.onsuccess = (event) => { db = event.target.result; resolve(db); };
        request.onerror = (e) => reject(e);
    });
}

// --- OPTIMIZED SAVE STATE ---
function saveState(force = false) {
    const now = Date.now();
    // Jika tidak dipaksa (force) dan belum waktunya save, skip.
    if (!force && (now - lastSaveTime < SAVE_INTERVAL)) return;

    lastSaveTime = now;

    const serialized = Array.from(tasks.entries()).map(([id, t]) => {
        // Kita tidak perlu menyimpan speed atau remainingTime ke storage
        const { speed, remainingTime, ...cleanTask } = t;

        // Simpan state thread agar bisa resume
        cleanTask.threadStates = t.threads ? t.threads.map(th => ({
            index: th.index,
            start: th.start,
            end: th.end,
            current: th.current,
            complete: th.complete
        })) : [];

        // Hapus properti runtime yang berat jika ada
        const taskCopy = JSON.parse(JSON.stringify(cleanTask));
        delete taskCopy.threads; // Gunakan threadStates untuk storage

        return [id, taskCopy];
    });

    chrome.storage.local.set({ 'tasks': serialized });
}

// Helper untuk loop download agar tidak berat
function throttledSave() {
    saveState(false);
}

async function restoreState() {
    const res = await chrome.storage.local.get('tasks');
    if (res.tasks) {
        tasks = new Map(res.tasks);
        tasks.forEach(t => {
            // Reset status yang sedang berjalan menjadi queued/paused saat browser restart
            if(t.status === 'running' || t.status === 'assembling') t.status = 'queued';
            t.speed = 0;
            t.prevLoaded = t.loaded;

            // Restore threads structure
            if(t.threadStates && t.threadStates.length > 0) {
                t.threads = t.threadStates;
            } else {
                t.threads = [];
            }
        });
        processQueue();
        updateBadge();
    }
    startBroadcastLoop();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "add_task") queueDownload(msg.url);
    else if (msg.action === "add_batch_tasks") msg.urls?.forEach(url => queueDownload(url));
    else if (msg.action === "get_tasks") sendResponse(Array.from(tasks.values()));
    else if (msg.action === "check_url") {
        // Head request logic (optimized)
        fetch(msg.url, { method: 'GET', headers: { 'Range': 'bytes=0-0' } })
            .then(resp => {
                if (!resp.ok && resp.status !== 206) throw new Error('Fail');

                let size = 0;
                const contentRange = resp.headers.get('content-range');
                if (contentRange) size = parseInt(contentRange.split('/')[1]);
                else size = parseInt(resp.headers.get('content-length') || 0);

                let name = msg.url.split('/').pop().split('?')[0];
                const disp = resp.headers.get('content-disposition');
                if (disp && disp.includes('filename=')) {
                    name = disp.split('filename=')[1].replace(/["']/g, '').trim();
                }
                try { name = decodeURIComponent(name); } catch(e){}

                sendResponse({
                    success: true,
                    size: size,
                    filename: name || 'unknown',
                    mime: resp.headers.get('content-type') || 'unknown',
                    checksum: (resp.headers.get('etag') || '-').replace(/["']/g, '')
                });
            }).catch((err) => {
            console.error("Check URL Error:", err);
            sendResponse({ success: false });
        });
        return true; // Keep channel open
    }
    else if (msg.action === "pause_task") {
        const task = tasks.get(msg.id);
        if(task && (task.status === 'running' || task.status === 'queued')) {
            task.status = 'paused';
            if (activeControllers.has(task.id)) {
                activeControllers.get(task.id).abort();
                activeControllers.delete(task.id);
            }
            saveState(true); // Force save on user action
            broadcast();
            processQueue();
        }
    }
    else if (msg.action === "resume_task") {
        const task = tasks.get(msg.id);
        if(task) {
            if (activeControllers.has(task.id)) {
                activeControllers.get(task.id).abort();
                activeControllers.delete(task.id);
            }
            task.status = 'queued';
            // Penting: Jangan reset loaded jadi 0 jika resume
            task.prevLoaded = task.loaded;
            saveState(true);
            broadcast();
            processQueue();
        }
    }
    else if (msg.action === "cancel_task") cancelTask(msg.id);
    else if (msg.action === "clear_tasks") {
        tasks.forEach((task, id) => {
            if (task.status === 'completed' || task.status === 'error') {
                cleanupDB(id);
                tasks.delete(id);
            }
        });
        saveState(true);
        broadcast();
        updateBadge();
    }
    else if (msg.action === "assembly_report") handleAssemblyReport(msg);
    return true;
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: "czdm-download", title: "Download with CZDM", contexts: ["link", "image", "video", "audio"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "czdm-download") {
        const url = info.linkUrl || info.srcUrl;
        if (url) queueDownload(url);
    }
});

function getRunningCount() {
    let count = 0;
    tasks.forEach(t => { if(t.status === 'running' || t.status === 'assembling') count++; });
    return count;
}

function updateBadge() {
    const count = getRunningCount();
    if (count > 0) {
        chrome.action.setBadgeText({ text: count.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

function processQueue() {
    if (getRunningCount() >= MAX_CONCURRENT_DOWNLOADS) return;
    for (const [id, task] of tasks) {
        if (task.status === 'queued') {
            startDownload(task);
            if (getRunningCount() >= MAX_CONCURRENT_DOWNLOADS) break;
        }
    }
    updateBadge();
}

async function queueDownload(url) {
    // Gunakan ID String random, pastikan unik
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 5);
    const task = {
        id,
        url,
        filename: 'pending...',
        loaded: 0,
        total: 0,
        status: 'queued',
        startTime: Date.now(),
        isResumable: false,
        useCredentials: false,
        threads: [],
        speed: 0,
        prevLoaded: 0,
        remainingTime: -1
    };
    tasks.set(id, task);
    saveState(true);
    broadcast();
    processQueue();
}

async function startDownload(task) {
    if (!db) await initDB();

    task.status = 'running';
    saveState(true); // Save status change immediately
    broadcast();

    const masterController = new AbortController();
    activeControllers.set(task.id, masterController);

    try {
        // Initial check for size and resumability
        let response = await fetch(task.url, { method: 'GET', headers: { 'Range': 'bytes=0-0' }, signal: masterController.signal });
        if (response.status === 401 || response.status === 403) {
            response = await fetch(task.url, { method: 'GET', headers: { 'Range': 'bytes=0-0' }, signal: masterController.signal, credentials: 'include' });
            if (response.ok || response.status === 206) task.useCredentials = true;
            else throw new Error(`Access Denied (HTTP ${response.status})`);
        } else if (!response.ok && response.status !== 206) {
            throw new Error(`HTTP Error ${response.status}`);
        }

        task.finalUrl = response.url;

        // Size Detection
        const contentRange = response.headers.get('content-range');
        const contentLength = response.headers.get('content-length');
        if (contentRange) task.total = parseInt(contentRange.split('/')[1]);
        else if (contentLength) task.total = parseInt(contentLength);
        else task.total = 0;

        // Resumable Check
        const acceptRanges = response.headers.get('accept-ranges');
        task.isResumable = (response.status === 206) || (acceptRanges === 'bytes') || !!contentRange;

        // Filename Logic
        const disposition = response.headers.get('content-disposition');
        let filename = task.finalUrl.split('/').pop().split('?')[0];
        if (disposition && disposition.includes('filename=')) {
            filename = disposition.split('filename=')[1].replace(/["']/g, '').trim();
        }
        try { filename = decodeURIComponent(filename); } catch(e){}
        if(!filename || filename === '') filename = `file-${task.id}.bin`;
        task.filename = filename;

        // Thread Calculation (Only if threads empty/new download)
        if (task.threads.length === 0) {
            let optimalThreads = 1;
            if (task.isResumable && task.total > 0) {
                if (task.total > 100 * 1024 * 1024) optimalThreads = 8;      // >100MB
                else if (task.total > 50 * 1024 * 1024) optimalThreads = 6; // >50MB
                else if (task.total > 10 * 1024 * 1024) optimalThreads = 4; // >10MB
                else if (task.total > 2 * 1024 * 1024) optimalThreads = 2;  // >2MB
            }

            const partSize = Math.floor(task.total / optimalThreads);
            for (let i = 0; i < optimalThreads; i++) {
                const start = i * partSize;
                let end = (start + partSize - 1);
                if (i === optimalThreads - 1) end = task.total - 1;
                // Jika single thread atau unknown size
                if (optimalThreads === 1) end = task.total > 0 ? task.total - 1 : 0; // 0 means until end if handle correctly

                task.threads.push({ index: i, start: start, end: end, current: start, complete: false });
            }
        }

        saveState(true); // Save structure
        broadcast();

        // Start Threads
        const promises = task.threads
            .filter(t => !t.complete)
            .map(t => downloadThread(task, t, masterController.signal));

        await Promise.all(promises);

        // If all promises resolved and not aborted
        if (task.status === 'running') triggerAssembly(task);

    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error(`[BG] Error Task ${task.id}:`, e);
            task.status = 'error';
            saveState(true); // Force save error
        }
        activeControllers.delete(task.id);
        broadcast();
        processQueue();
    }
}

async function downloadThread(task, threadInfo, signal) {
    const downloadUrl = task.finalUrl || task.url;

    // Logic Resume: start dari current, bukan start awal
    let offset = threadInfo.current;

    // Safety: jika tidak resumable, tapi offset > 0 (aneh), reset
    if (!task.isResumable && offset > 0) {
        offset = 0;
        // Reset loaded global jika single thread restart
        if (task.threads.length === 1) task.loaded = 0;
    }

    const headers = {};
    // Gunakan range request jika resumable atau kita tahu totalnya
    if (task.isResumable || task.total > 0) {
        // Jika unknown end, fetch sampai akhir
        const endRange = (threadInfo.end > 0 && threadInfo.end >= offset) ? threadInfo.end : '';
        headers['Range'] = `bytes=${offset}-${endRange}`;
    }

    const options = { headers, signal };
    if (task.useCredentials) options.credentials = 'include';

    try {
        const resp = await fetch(downloadUrl, options);

        if (!resp.ok) {
            if (resp.status === 200 && task.isResumable && task.loaded > 0) throw new Error("Server rejected resume (sent 200 OK).");
            if (resp.status !== 206 && resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
        }

        const reader = resp.body.getReader();

        let chunksArray = [];
        let bytesInBuffer = 0;
        let lastBroadcastThread = Date.now();
        let streamPos = offset;

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            if (signal.aborted) break;

            const len = value.length;
            threadInfo.current += len;
            task.loaded += len;

            chunksArray.push(value);
            bytesInBuffer += len;

            // Broadcast UI (Throttled per thread ~500ms)
            const now = Date.now();
            if (now - lastBroadcastThread > 500) {
                broadcast();
                lastBroadcastThread = now;
            }

            // FLUSH BUFFER (Write to DB)
            if (bytesInBuffer >= CHUNK_SIZE) {
                await flushBufferToDB(task.id, chunksArray, bytesInBuffer, streamPos);

                streamPos += bytesInBuffer;
                chunksArray = [];
                bytesInBuffer = 0;

                // *** OPTIMIZATION FIX ***
                // Jangan panggil saveState() disini. Gunakan throttledSave.
                throttledSave();
            }
        }

        // Flush remaining buffer
        if (bytesInBuffer > 0) {
            await flushBufferToDB(task.id, chunksArray, bytesInBuffer, streamPos);
        }

        if (!signal.aborted) {
            threadInfo.complete = true;
            // Save completion state
            saveState(false);
        }

    } catch (e) {
        if (signal.aborted) throw e;
        throw e;
    }
}

async function flushBufferToDB(taskId, chunksArray, totalSize, offsetKey) {
    // Gabungkan array of Uint8Array menjadi satu Blob/Uint8Array
    const combined = new Uint8Array(totalSize);
    let pos = 0;
    for (let val of chunksArray) {
        combined.set(val, pos);
        pos += val.length;
    }
    await saveChunk(taskId, offsetKey, combined.buffer);
}

function saveChunk(taskId, offset, data) {
    return new Promise((resolve, reject) => {
        // Transaction 'readwrite' ke object store 'chunks'
        const tx = db.transaction(['chunks'], 'readwrite');
        const store = tx.objectStore('chunks');
        store.put({ taskId, offset, data });
        tx.oncomplete = resolve;
        tx.onerror = (e) => reject(e);
    });
}

function cleanupDB(taskId) {
    if(!db) return;
    const tx = db.transaction(['chunks'], 'readwrite');
    const store = tx.objectStore('chunks');
    // Delete all chunks with this taskId
    const range = IDBKeyRange.bound([taskId, 0], [taskId, Infinity]);
    store.openCursor(range).onsuccess = (e) => {
        const cursor = e.target.result;
        if(cursor) {
            cursor.delete();
            cursor.continue();
        }
    };
}

function cancelTask(id) {
    if (activeControllers.has(id)) {
        activeControllers.get(id).abort();
        activeControllers.delete(id);
    }
    if (tasks.has(id)) {
        tasks.delete(id);
        cleanupDB(id);
        saveState(true);
        broadcast();
        processQueue();
    }
}

function broadcast() {
    // Kirim data ringan saja jika bisa, tapi untuk sekarang kirim full list
    // UI akan menangani rendering pintar
    const list = Array.from(tasks.values());
    updateBadge();
    chrome.runtime.sendMessage({ action: "update_list", tasks: list }).catch(() => {
        // Ignored: Popup closed usually throws error
    });
}

async function triggerAssembly(task) {
    task.status = 'assembling';
    saveState(true);
    broadcast();

    try {
        // Cek offscreen document untuk assembly Blob besar
        const hasOffscreen = await chrome.offscreen.hasDocument();
        if (!hasOffscreen) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['BLOBS'],
                justification: 'Assembly huge file'
            });
        }
        chrome.runtime.sendMessage({ action: 'assemble_file', taskId: task.id, filename: task.filename });
    } catch (e) {
        console.error("Assembly Launch Error:", e);
        task.status = 'error';
        saveState(true);
        broadcast();
        processQueue();
    }
}

function handleAssemblyReport(msg) {
    const task = tasks.get(msg.taskId);
    if (!task) return;

    if (msg.success && msg.blobUrl) {
        // Trigger browser download API
        chrome.downloads.download({ url: msg.blobUrl, filename: task.filename, saveAs: false }, (id) => {
            if (chrome.runtime.lastError) {
                console.error("Chrome DL Error:", chrome.runtime.lastError);
                task.status = 'error';
            } else {
                task.status = 'completed';
                // Hapus chunks dari IDB karena sudah jadi file
                cleanupDB(msg.taskId);
            }
            saveState(true);
            broadcast();
            processQueue();
        });
    } else {
        task.status = 'error';
        console.error("Assembly Failed:", msg.error);
        saveState(true);
        broadcast();
        processQueue();
    }
}

// Init
initDB();
restoreState();