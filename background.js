const DB_NAME = 'CZDM_DB';
const DB_VERSION = 1;
let db = null;
let tasks = new Map();
let activeControllers = new Map();
const CHUNK_SIZE = 1024 * 1024 * 1;
let lastSaveTime = 0;
const SAVE_INTERVAL = 2000;
let broadcastInterval = null;

let appSettings = {
    theme: 'auto',
    autoOverride: true,
    maxConcurrent: 3,
    maxThreads: 8,
    interceptExts: 'zip, rar, 7z, iso, exe, msi, apk, mp4, mkv, avi, mp3, pdf, dmg, pkg',
    minSizeMB: 5,
    notifications: true,
    downloadLocation: 'default'
};

chrome.alarms.create("czdm_keepalive", {periodInMinutes: 0.5});
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "czdm_keepalive") {
        const hasRunning = Array.from(tasks.values()).some(t => t.status === 'running' || t.status === 'assembling');
        if (hasRunning) console.log("[CZDM] Keep-alive ping");
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.settings) {
        appSettings = Object.assign({}, appSettings, changes.settings.newValue);
        processQueue();
    }
});

function notifyUser(title, message) {
    try {
        if (!appSettings.notifications) return;
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'img/128x128.png',
            title: title,
            message: message || 'Unknown file'
        });
    } catch (e) {
    }
}

chrome.downloads.onCreated.addListener((downloadItem) => {
    if (!appSettings.autoOverride) return;
    if (downloadItem.byExtensionId === chrome.runtime.id) return;
    if (!downloadItem.url || (!downloadItem.url.startsWith('http://') && !downloadItem.url.startsWith('https://'))) return;

    const interceptExts = appSettings.interceptExts.split(',').map(e => e.trim().toLowerCase()).filter(e => e);
    const filename = downloadItem.filename || "";
    let fileExt = filename.includes('.') ? filename.split('.').pop().toLowerCase() : "";

    if (!interceptExts.includes(fileExt)) {
        try {
            const decodedUrl = decodeURIComponent(downloadItem.url).toLowerCase();
            const matchedExt = interceptExts.find(ext => decodedUrl.includes(`.${ext}`));
            if (matchedExt) fileExt = matchedExt;
        } catch (e) {
        }
    }

    if (interceptExts.includes(fileExt) || downloadItem.fileSize > (appSettings.minSizeMB * 1024 * 1024)) {
        chrome.downloads.cancel(downloadItem.id, () => {
            chrome.downloads.erase({id: downloadItem.id});
            queueDownload(downloadItem.url);
        });
    }
});

function parseGoogleDriveLink(url) {
    if (!url) return url;
    if (url.includes('drive.google.com')) {
        const regex = /\/d\/([a-zA-Z0-9_-]+)/;
        const match = url.match(regex);
        if (match && match[1]) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
    return url;
}

function startBroadcastLoop() {
    if (broadcastInterval) clearInterval(broadcastInterval);
    broadcastInterval = setInterval(() => {
        let needsBroadcast = false;
        tasks.forEach(task => {
            if (task.status === 'running') {
                const currentLoaded = task.loaded;
                const prevLoaded = task.prevLoaded || 0;
                let diff = currentLoaded - prevLoaded;
                if (diff < 0) diff = 0;
                task.speed = diff;
                task.prevLoaded = currentLoaded;
                task.remainingTime = (task.speed > 0 && task.total > 0) ? Math.ceil((task.total - task.loaded) / task.speed) : -1;
                needsBroadcast = true;
            } else {
                task.speed = 0;
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
            db.createObjectStore('chunks', {keyPath: ['taskId', 'offset']});
        };
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e);
    });
}

async function runGarbageCollector() {
    if (!db) await initDB();
    const tx = db.transaction(['chunks'], 'readwrite');
    const store = tx.objectStore('chunks');
    const request = store.openCursor();
    request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            if (!tasks.has(cursor.value.taskId)) cursor.delete();
            cursor.continue();
        }
    };
}

function saveState(force = false) {
    const now = Date.now();
    if (!force && (now - lastSaveTime < SAVE_INTERVAL)) return;
    lastSaveTime = now;
    const serialized = Array.from(tasks.entries()).map(([id, t]) => {
        const {speed, remainingTime, ...cleanTask} = t;
        cleanTask.threadStates = t.threads ? t.threads.map(th => ({
            index: th.index,
            start: th.start,
            end: th.end,
            current: th.current,
            complete: th.complete
        })) : [];
        const taskCopy = JSON.parse(JSON.stringify(cleanTask));
        delete taskCopy.threads;
        return [id, taskCopy];
    });
    chrome.storage.local.set({'tasks': serialized});
}

function throttledSave() {
    saveState(false);
}

async function restoreState() {
    const res = await chrome.storage.local.get(['tasks', 'settings']);
    if (res.settings) appSettings = Object.assign({}, appSettings, res.settings);
    if (res.tasks) {
        tasks = new Map(res.tasks);
        tasks.forEach(t => {
            if (t.status === 'running' || t.status === 'assembling' || t.status === 'queued') t.status = 'paused';
            t.speed = 0;
            t.prevLoaded = t.loaded;
            t.threads = (t.threadStates && t.threadStates.length > 0) ? t.threadStates : [];
        });
        updateBadge();
    }
    startBroadcastLoop();
    runGarbageCollector();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "add_task") queueDownload(msg.url);
    else if (msg.action === "add_batch_tasks") msg.urls?.forEach(url => queueDownload(url));
    else if (msg.action === "get_tasks") sendResponse(Array.from(tasks.values()));
    else if (msg.action === "open_file" && msg.downloadId) chrome.downloads.open(msg.downloadId);
    else if (msg.action === "open_folder" && msg.downloadId) chrome.downloads.show(msg.downloadId);
    else if (msg.action === "check_url") {
        const checkTargetUrl = parseGoogleDriveLink(msg.url);
        (async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            try {
                let resp = await fetch(checkTargetUrl, {method: 'HEAD', signal: controller.signal});
                if (!resp.ok) resp = await fetch(checkTargetUrl, {
                    method: 'GET',
                    headers: {'Range': 'bytes=0-0'},
                    signal: controller.signal
                });
                if (resp.status === 401 || resp.status === 403) resp = await fetch(checkTargetUrl, {
                    method: 'GET',
                    headers: {'Range': 'bytes=0-0'},
                    credentials: 'include',
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (!resp.ok && resp.status !== 206 && resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
                let size = 0;
                const contentRange = resp.headers.get('content-range');
                if (contentRange) size = parseInt(contentRange.split('/')[1]);
                else size = parseInt(resp.headers.get('content-length') || 0);
                let name = checkTargetUrl.split('/').pop().split('?')[0];
                const disp = resp.headers.get('content-disposition');
                if (disp && disp.includes('filename=')) name = disp.split('filename=')[1].replace(/["']/g, '').trim();
                try {
                    name = decodeURIComponent(name);
                } catch (e) {
                }

                const etag = (resp.headers.get('etag') || '-').replace(/["']/g, '');

                sendResponse({
                    success: true,
                    size: size,
                    filename: name || 'unknown',
                    mime: resp.headers.get('content-type') || 'unknown',
                    checksum: etag
                });
                controller.abort();
            } catch (err) {
                clearTimeout(timeoutId);
                sendResponse({success: false});
            }
        })();
        return true;
    } else if (msg.action === "pause_task") {
        const task = tasks.get(msg.id);
        if (task && (task.status === 'running' || task.status === 'queued')) {
            task.status = 'paused';
            if (activeControllers.has(task.id)) {
                activeControllers.get(task.id).abort();
                activeControllers.delete(task.id);
            }
            saveState(true);
            broadcast();
            processQueue();
        }
    } else if (msg.action === "resume_task") {
        const task = tasks.get(msg.id);
        if (task) {
            if (activeControllers.has(task.id)) {
                activeControllers.get(task.id).abort();
                activeControllers.delete(task.id);
            }
            task.status = 'queued';
            task.prevLoaded = task.loaded;
            saveState(true);
            broadcast();
            processQueue();
        }
    } else if (msg.action === "cancel_task") cancelTask(msg.id);
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
    } else if (msg.action === "assembly_report") handleAssemblyReport(msg);
    return true;
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "czdm-download",
        title: "Download with CZDM",
        contexts: ["link", "image", "video", "audio"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "czdm-download") {
        const url = info.linkUrl || info.srcUrl;
        if (url) queueDownload(url);
    }
});

function getRunningCount() {
    let count = 0;
    tasks.forEach(t => {
        if (t.status === 'running' || t.status === 'assembling') count++;
    });
    return count;
}

function updateBadge() {
    try {
        const count = getRunningCount();
        if (count > 0) {
            chrome.action.setBadgeText({text: count.toString()});
            chrome.action.setBadgeBackgroundColor({color: '#3b82f6'});
        } else {
            chrome.action.setBadgeText({text: ''});
        }
    } catch (e) {
    }
}

function processQueue() {
    if (getRunningCount() >= appSettings.maxConcurrent) return;
    for (const [id, task] of tasks) {
        if (task.status === 'queued') {
            startDownload(task);
            if (getRunningCount() >= appSettings.maxConcurrent) break;
        }
    }
    updateBadge();
}

async function queueDownload(rawUrl) {
    const url = parseGoogleDriveLink(rawUrl);
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
        remainingTime: -1,
        serverHash: '-',
        localCrc32: '-',
        mime: '-',
        downloadId: null
    };
    tasks.set(id, task);
    saveState(true);
    broadcast();
    processQueue();
}

async function startDownload(task) {
    if (!db) await initDB();
    task.status = 'running';
    saveState(true);
    broadcast();
    const masterController = new AbortController();
    activeControllers.set(task.id, masterController);

    try {
        let response = await fetch(task.url, {
            method: 'GET',
            headers: {'Range': 'bytes=0-0'},
            signal: masterController.signal
        });
        if (response.status === 401 || response.status === 403) {
            response = await fetch(task.url, {
                method: 'GET',
                headers: {'Range': 'bytes=0-0'},
                signal: masterController.signal,
                credentials: 'include'
            });
            if (response.ok || response.status === 206) task.useCredentials = true;
            else throw new Error(`Access Denied (HTTP ${response.status}). Token might be expired.`);
        } else if (!response.ok && response.status !== 206) {
            throw new Error(`HTTP Error ${response.status}`);
        }

        task.finalUrl = response.url;
        const contentRange = response.headers.get('content-range');
        const contentLength = response.headers.get('content-length');
        task.total = contentRange ? parseInt(contentRange.split('/')[1]) : (contentLength ? parseInt(contentLength) : 0);
        task.isResumable = (response.status === 206) || (response.headers.get('accept-ranges') === 'bytes') || !!contentRange;

        task.serverHash = (response.headers.get('etag') || '-').replace(/["']/g, '');
        task.mime = response.headers.get('content-type') || 'unknown';

        const disposition = response.headers.get('content-disposition');
        let filename = task.finalUrl.split('/').pop().split('?')[0];
        if (disposition && disposition.includes('filename=')) filename = disposition.split('filename=')[1].replace(/["']/g, '').trim();
        try {
            filename = decodeURIComponent(filename);
        } catch (e) {
        }
        task.filename = filename || `file-${task.id}.bin`;

        if (task.threads.length === 0) {
            let optimalThreads = 1;
            if (task.isResumable && task.total > 0) {
                if (task.total > 100 * 1024 * 1024) optimalThreads = 8;
                else if (task.total > 50 * 1024 * 1024) optimalThreads = 6;
                else if (task.total > 10 * 1024 * 1024) optimalThreads = 4;
            }
            if (optimalThreads > appSettings.maxThreads) optimalThreads = appSettings.maxThreads;
            const partSize = Math.floor(task.total / optimalThreads);
            for (let i = 0; i < optimalThreads; i++) {
                const start = i * partSize;
                let end = (i === optimalThreads - 1) ? task.total - 1 : (start + partSize - 1);
                if (optimalThreads === 1) end = task.total > 0 ? task.total - 1 : 0;
                task.threads.push({index: i, start, end, current: start, complete: false});
            }
        } else if (!task.isResumable) {
            task.threads = [{
                index: 0,
                start: 0,
                end: task.total > 0 ? task.total - 1 : 0,
                current: 0,
                complete: false
            }];
        }

        saveState(true);
        broadcast();
        const promises = task.threads.filter(t => !t.complete).map(t => downloadThread(task, t, masterController.signal));
        await Promise.all(promises);
        if (task.status === 'running') triggerAssembly(task);

    } catch (e) {
        const isAbort = e.name === 'AbortError';
        if (!isAbort) {
            console.error(`[BG] Error Task ${task.id}:`, e);
            task.status = 'error';
        }
        activeControllers.delete(task.id);
        saveState(true);
        broadcast();
        processQueue();
        if (!isAbort) notifyUser('Download Failed', task.filename);
    }
}

async function downloadThread(task, threadInfo, signal) {
    const downloadUrl = task.finalUrl || task.url;
    let offset = threadInfo.current;
    if (!task.isResumable && offset > 0) {
        offset = 0;
        if (task.threads.length === 1) task.loaded = 0;
    }

    const headers = {};
    if (task.isResumable || task.total > 0) {
        const endRange = (threadInfo.end > 0 && threadInfo.end >= offset) ? threadInfo.end : '';
        headers['Range'] = `bytes=${offset}-${endRange}`;
    }
    const options = {headers, signal};
    if (task.useCredentials) options.credentials = 'include';

    try {
        const resp = await fetch(downloadUrl, options);
        if (!resp.ok && resp.status !== 206 && resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
        const reader = resp.body.getReader();
        let chunksArray = [];
        let bytesInBuffer = 0;
        let lastBroadcastThread = Date.now();
        let streamPos = offset;

        while (true) {
            const {done, value} = await reader.read();
            if (done || signal.aborted) break;
            const len = value.length;
            threadInfo.current += len;
            task.loaded += len;
            chunksArray.push(value);
            bytesInBuffer += len;
            if (Date.now() - lastBroadcastThread > 500) {
                broadcast();
                lastBroadcastThread = Date.now();
            }
            if (bytesInBuffer >= CHUNK_SIZE) {
                await flushBufferToDB(task.id, chunksArray, bytesInBuffer, streamPos);
                streamPos += bytesInBuffer;
                chunksArray = [];
                bytesInBuffer = 0;
                throttledSave();
            }
        }
        if (bytesInBuffer > 0) await flushBufferToDB(task.id, chunksArray, bytesInBuffer, streamPos);
        if (!signal.aborted) {
            threadInfo.complete = true;
            saveState(false);
        }
    } catch (e) {
        throw e;
    }
}

async function flushBufferToDB(taskId, chunksArray, totalSize, offsetKey) {
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
        const tx = db.transaction(['chunks'], 'readwrite');
        tx.objectStore('chunks').put({taskId, offset, data});
        tx.oncomplete = resolve;
        tx.onerror = (e) => reject(e);
    });
}

function cleanupDB(taskId) {
    if (!db) return;
    const tx = db.transaction(['chunks'], 'readwrite');
    const store = tx.objectStore('chunks');
    const range = IDBKeyRange.bound([taskId, 0], [taskId, Infinity]);
    store.openCursor(range).onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
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
    const list = Array.from(tasks.values());
    updateBadge();
    chrome.runtime.sendMessage({action: "update_list", tasks: list}).catch(() => {
    });
}

async function triggerAssembly(task) {
    task.status = 'assembling';
    saveState(true);
    broadcast();
    try {
        if (!(await chrome.offscreen.hasDocument())) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['BLOBS'],
                justification: 'Assembly huge file'
            });
        }
        chrome.runtime.sendMessage({action: 'assemble_file', taskId: task.id, filename: task.filename});
    } catch (e) {
        task.status = 'error';
        saveState(true);
        broadcast();
        processQueue();
        notifyUser('Assembly Failed', task.filename);
    }
}

function handleAssemblyReport(msg) {
    const task = tasks.get(msg.taskId);
    if (!task) return;

    if (msg.success && msg.blobUrl) {
        const askWhereToSave = appSettings.downloadLocation === 'custom';
        task.localCrc32 = msg.crc32 || '-'; // Simpan Hash CRC32 dari Offscreen

        chrome.downloads.download({url: msg.blobUrl, filename: task.filename, saveAs: askWhereToSave}, (downloadId) => {
            task.status = chrome.runtime.lastError ? 'error' : 'completed';
            if (downloadId) task.downloadId = downloadId; // Simpan ID untuk Open File/Folder

            saveState(true);
            broadcast();
            processQueue();

            if (!chrome.runtime.lastError) {
                cleanupDB(msg.taskId);
                notifyUser('Download Complete', task.filename);
            } else {
                notifyUser('Save Failed', task.filename);
            }
        });
    } else {
        task.status = 'error';
        saveState(true);
        broadcast();
        processQueue();
        notifyUser('Assembly Failed', task.filename);
    }
}

initDB();
restoreState();