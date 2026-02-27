// =============================================================================
// CZDM - Cyberzilla Download Manager | background.js v1.3.0
//
// Fix v1.3.0:
//   Sistem prioritas sekarang memperhitungkan SEMUA task aktif (termasuk 
//   yang sedang running/assembling) agar urutan antrian bersifat global 
//   dan tidak tumpang tindih saat task dipause.
// =============================================================================

const DB_NAME      = 'CZDM_DB';
const DB_VERSION   = 1;
const CHUNK_SIZE   = 1024 * 1024 * 1; // 1 MB
const SAVE_INTERVAL = 2000;

const BROWSER_CONN_LIMIT = 6;

let db                = null;
let tasks             = new Map();
let activeControllers = new Map();
let lastSaveTime      = 0;
let broadcastInterval = null;
let broadcastPending  = false;

const bwThrottle = {
    bytes:  0,
    window: Date.now(),
    async check(amount) {
        const limit = (appSettings.bandwidthLimit || 0) * 1024;
        if (!limit) return;
        const now = Date.now();
        if (now - this.window >= 1000) { this.bytes = 0; this.window = now; }
        this.bytes += amount;
        if (this.bytes > limit) {
            const wait = 1000 - (Date.now() - this.window);
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
            this.bytes  = amount;
            this.window = Date.now();
        }
    }
};

let appSettings = {
    theme:                'auto',
    autoOverride:         true,
    maxConcurrent:        3,
    maxThreads:           8,
    interceptExts:        'zip, rar, 7z, iso, exe, msi, apk, mp4, mkv, avi, mp3, pdf, dmg, pkg',
    minSizeMB:            5,
    notifications:        true,
    downloadLocation:     'default',
    showPrompt:           false,
    showPageNotification: false,
    bandwidthLimit:       0,
    maxRetries:           3
};

function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (d.objectStoreNames.contains('chunks')) d.deleteObjectStore('chunks');
            d.createObjectStore('chunks', { keyPath: ['taskId', 'offset'] });
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
        req.onerror   = (e) => reject(e);
    });
}

async function restoreState() {
    const res = await chrome.storage.local.get(['tasks', 'settings']);
    if (res.settings) appSettings = Object.assign({}, appSettings, res.settings);

    let resumedCount = 0;
    if (res.tasks) {
        tasks = new Map(res.tasks);
        tasks.forEach(t => {
            if (['running', 'assembling', 'queued'].includes(t.status)) {
                t.status = 'paused';
                resumedCount++;
            }
            t.speed        = 0;
            t.prevLoaded   = t.loaded;
            t.isConnecting = false;
            t.threads      = (t.threadStates && t.threadStates.length > 0) ? t.threadStates : [];
            t.retryCount   = t.retryCount || 0;
            if (t.priority === undefined || t.priority === null) t.priority = 50;
        });

        normalizePriorities();
        updateBadge();

        if (resumedCount > 0) {
            notifyUser(
                'CzDM - Downloads Paused',
                `${resumedCount} download(s) paused after browser restart. Open CzDM to resume.`
            );
        }
    }
    startBroadcastLoop();
    runGarbageCollector();
}

function saveState(force = false) {
    const now = Date.now();
    if (!force && (now - lastSaveTime < SAVE_INTERVAL)) return;
    lastSaveTime = now;
    const serialized = Array.from(tasks.entries()).map(([id, t]) => {
        const { speed, remainingTime, isConnecting, checkCompletion, handleError, ...cleanTask } = t;
        cleanTask.threadStates = t.threads ? t.threads.map(th => ({
            index: th.index, start: th.start, end: th.end,
            current: th.current, complete: th.complete
        })) : [];
        const copy = JSON.parse(JSON.stringify(cleanTask));
        delete copy.threads;
        return [id, copy];
    });
    chrome.storage.local.set({ tasks: serialized });
}

function throttledSave() { saveState(false); }

function getNextPriority() {
    let max = 0;
    tasks.forEach(t => {
        if (t.status !== 'completed' && t.status !== 'error' && (t.priority || 0) > max) {
            max = t.priority;
        }
    });
    return max + 10;
}

function normalizePriorities() {
    const activeTasks = Array.from(tasks.values())
        .filter(t => t.status !== 'completed' && t.status !== 'error')
        .sort((a, b) => (a.priority || 50) - (b.priority || 50));
    activeTasks.forEach((t, i) => { t.priority = (i + 1) * 10; });
}

function movePriority(taskId, direction) {
    const activeTasks = Array.from(tasks.values())
        .filter(t => t.status !== 'completed' && t.status !== 'error')
        .sort((a, b) => (a.priority || 0) - (b.priority || 0));

    const idx = activeTasks.findIndex(t => t.id === taskId);
    if (idx < 0) return;

    if (direction === 'up' && idx > 0) {
        [activeTasks[idx], activeTasks[idx - 1]] = [activeTasks[idx - 1], activeTasks[idx]];
    } else if (direction === 'down' && idx < activeTasks.length - 1) {
        [activeTasks[idx], activeTasks[idx + 1]] = [activeTasks[idx + 1], activeTasks[idx]];
    } else {
        return; 
    }

    activeTasks.forEach((t, i) => { t.priority = (i + 1) * 10; });

    saveState(true);
    broadcast();
}

function getActiveTaskCountForHost(hostname) {
    let count = 0;
    tasks.forEach(t => {
        if (t.status === 'running' || t.status === 'assembling') {
            try {
                if (new URL(t.finalUrl || t.url).hostname === hostname) count++;
            } catch (e) {}
        }
    });
    return count;
}

function getEffectiveMaxThreads(hostname) {
    const activeSameHost = Math.max(1, getActiveTaskCountForHost(hostname));
    const availableConns = BROWSER_CONN_LIMIT - 1; 
    const fairShare      = Math.max(1, Math.floor(availableConns / activeSameHost));
    return Math.min(appSettings.maxThreads, fairShare);
}

function startBroadcastLoop() {
    if (broadcastInterval) clearInterval(broadcastInterval);
    broadcastInterval = setInterval(() => {
        let needsBroadcast = false;
        tasks.forEach(task => {
            if (task.status === 'running' || task.status === 'assembling') {
                if (typeof task.downloadDuration !== 'number') task.downloadDuration = 0;
                task.downloadDuration += 1000;
            }
            if (task.status === 'running') {
                const diff       = Math.max(0, task.loaded - (task.prevLoaded || 0));
                task.speed       = diff;
                task.prevLoaded  = task.loaded;
                task.remainingTime = (task.speed > 0 && task.total > 0)
                    ? Math.ceil((task.total - task.loaded) / task.speed) : -1;
                needsBroadcast   = true;
            } else {
                task.speed = 0;
                if (task.status === 'assembling') needsBroadcast = true;
            }
        });
        if (needsBroadcast) broadcast();
    }, 1000);
}

function broadcast() {
    if (broadcastPending) return;
    broadcastPending = true;
    setTimeout(() => {
        broadcastPending = false;
        updateBadge();
        chrome.runtime.sendMessage({
            action: 'update_list',
            tasks: Array.from(tasks.values())
        }).catch(() => {});
    }, 200);
}

async function runGarbageCollector() {
    if (!db) await initDB();
    const tx    = db.transaction(['chunks'], 'readwrite');
    const store = tx.objectStore('chunks');
    store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            if (!tasks.has(cursor.value.taskId)) cursor.delete();
            cursor.continue();
        }
    };
}

async function cleanOrphanedOPFS() {
    try {
        if (!(await chrome.offscreen.hasDocument())) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Cleanup OPFS Storage'
            });
        }
        chrome.runtime.sendMessage({
            action: 'cleanup_orphaned_opfs', activeIds: Array.from(tasks.keys())
        }).catch(() => {});
    } catch (e) {}
}

function getRunningCount() {
    let n = 0;
    tasks.forEach(t => { if (t.status === 'running' || t.status === 'assembling') n++; });
    return n;
}

function updateBadge() {
    try {
        const count = getRunningCount();
        chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
        if (count > 0) chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
    } catch (e) {}
}

function notifyUser(title, message) {
    try {
        if (!appSettings.notifications) return;
        chrome.notifications.create({ type: 'basic', iconUrl: 'img/128x128.png', title, message: message || '' });
    } catch (e) {}
}

function parseGoogleDriveLink(url) {
    if (!url) return url;
    const m = url.match(/drive\.google\.com\/.*\/d\/([a-zA-Z0-9_-]+)/);
    if (m && m[1]) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
    return url;
}

function parseContentDisposition(disp) {
    if (!disp) return null;
    const rfc5987 = disp.match(/filename\*\s*=\s*([^;]+)/i);
    if (rfc5987) {
        const parts = rfc5987[1].trim().split("''");
        if (parts.length === 2) {
            try { return decodeURIComponent(parts[1]); } catch (e) {}
        }
    }
    const simple = disp.match(/filename\s*=\s*["']?([^"';\r\n]+)["']?/i);
    if (simple) {
        let name = simple[1].trim();
        try { name = decodeURIComponent(name); } catch (e) {}
        return name;
    }
    return null;
}

const HISTORY_MAX = 200;

function addToHistory(task) {
    chrome.storage.local.get('downloadHistory', (res) => {
        const history = res.downloadHistory || [];
        history.unshift({
            id:         task.id,
            filename:   task.filename,
            url:        task.url,
            size:       task.total,
            mime:       task.mime || '-',
            status:     task.status,
            serverHash: task.serverHash || '-',
            localCrc32: task.localCrc32 || '-',
            sha256:     task.sha256 || '-',
            timestamp:  Date.now(),
            duration:   task.downloadDuration || 0,
            retryCount: task.retryCount || 0
        });
        if (history.length > HISTORY_MAX) history.splice(HISTORY_MAX);
        chrome.storage.local.set({ downloadHistory: history });
    });
}

chrome.alarms.create('czdm_keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'czdm_keepalive') return;
    const hasActive = Array.from(tasks.values())
        .some(t => t.status === 'running' || t.status === 'assembling');
    if (hasActive) chrome.runtime.getPlatformInfo();
});

chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns === 'local' && changes.settings) {
        appSettings = Object.assign({}, appSettings, changes.settings.newValue);
        processQueue();
    }
});

chrome.downloads.onCreated.addListener((item) => {
    if (!appSettings.autoOverride) return;
    if (item.byExtensionId === chrome.runtime.id) return;
    if (!item.url || (!item.url.startsWith('http://') && !item.url.startsWith('https://'))) return;

    const interceptExts = appSettings.interceptExts.split(',')
        .map(e => e.trim().toLowerCase()).filter(Boolean);
    const fname = item.filename || '';
    let fileExt = fname.includes('.') ? fname.split('.').pop().toLowerCase() : '';

    if (!interceptExts.includes(fileExt)) {
        try {
            const decoded = decodeURIComponent(item.url).toLowerCase();
            const matched = interceptExts.find(ext => decoded.includes(`.${ext}`));
            if (matched) fileExt = matched;
        } catch (e) {}
    }

    const knownAndLarge = item.fileSize > 0
        && item.fileSize > (appSettings.minSizeMB * 1024 * 1024);

    if (!interceptExts.includes(fileExt) && !knownAndLarge) return;

    chrome.downloads.cancel(item.id, () => {
        chrome.downloads.erase({ id: item.id });
        if (appSettings.showPrompt) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs[0] && tabs[0].id) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'show_page_prompt',
                        url: item.url, fileSize: item.fileSize, filename: item.filename
                    }, (res) => {
                        if (chrome.runtime.lastError || (res && res.download)) {
                            queueDownload(item.url, item.filename);
                        }
                    });
                } else {
                    queueDownload(item.url, item.filename);
                }
            });
        } else {
            queueDownload(item.url, item.filename);
        }
    });
});

chrome.downloads.onChanged.addListener((delta) => {
    if (!delta.state) return;
    const cur = delta.state.current;
    if (cur !== 'complete' && cur !== 'interrupted') return;
    for (const [, t] of tasks.entries()) {
        if (t.downloadId === delta.id && t.status === 'completed') {
            setTimeout(() => {
                chrome.runtime.sendMessage({ action: 'cleanup_opfs', taskId: t.id }).catch(() => {});
            }, 5000);
            break;
        }
    }
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'czdm-download', title: 'Download with CZDM',
        contexts: ['link', 'image', 'video', 'audio']
    });
});

chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === 'czdm-download') {
        const url = info.linkUrl || info.srcUrl;
        if (url) queueDownload(url);
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.action) {

        case 'add_task':
            queueDownload(msg.url);
            break;

        case 'add_batch_tasks':
            (msg.urls || []).forEach(url => queueDownload(url));
            break;

        case 'get_tasks':
            sendResponse(Array.from(tasks.values()));
            break;

        case 'open_file':
            if (msg.downloadId) chrome.downloads.open(msg.downloadId);
            break;

        case 'open_folder':
            if (msg.downloadId) chrome.downloads.show(msg.downloadId);
            break;

        case 'get_history':
            chrome.storage.local.get('downloadHistory', (res) => {
                sendResponse(res.downloadHistory || []);
            });
            return true;

        case 'clear_history':
            chrome.storage.local.set({ downloadHistory: [] });
            break;

        case 'check_url':
            handleCheckUrl(msg.url, sendResponse);
            return true;

        case 'pause_task': {
            const task = tasks.get(msg.id);
            if (task && (task.status === 'running' || task.status === 'queued')) {
                task.status       = 'paused';
                task.isConnecting = false;
                if (activeControllers.has(task.id)) {
                    activeControllers.get(task.id).abort();
                    activeControllers.delete(task.id);
                }
                saveState(true); broadcast(); processQueue();
            }
            break;
        }

        case 'resume_task': {
            const task = tasks.get(msg.id);
            if (task && (task.status === 'paused' || task.status === 'error')) {
                if (activeControllers.has(task.id)) {
                    activeControllers.get(task.id).abort();
                    activeControllers.delete(task.id);
                }
                task.status       = 'queued';
                task.retryCount   = 0;
                task.prevLoaded   = task.loaded;
                task.isConnecting = false;
                saveState(true); broadcast(); processQueue();
            }
            break;
        }

        case 'cancel_task':
            cancelTask(msg.id);
            break;

        case 'clear_tasks':
            tasks.forEach((task, id) => {
                if (task.status === 'completed' || task.status === 'error') {
                    cleanupDB(id);
                    tasks.delete(id);
                }
            });
            saveState(true); broadcast(); updateBadge();
            break;

        case 'move_priority':
            movePriority(msg.id, msg.direction);
            break;

        case 'assembly_report':
            handleAssemblyReport(msg);
            break;

        case 'revoke_blob':
            chrome.runtime.sendMessage({ action: '_do_revoke_blob', url: msg.url }).catch(() => {});
            break;
    }
    return true;
});

function processQueue() {
    if (getRunningCount() >= appSettings.maxConcurrent) return;
    const queued = Array.from(tasks.values())
        .filter(t => t.status === 'queued')
        .sort((a, b) => (a.priority || 0) - (b.priority || 0));
    for (const task of queued) {
        startDownload(task);
        if (getRunningCount() >= appSettings.maxConcurrent) break;
    }
    updateBadge();
}

async function queueDownload(rawUrl, providedFilename = '') {
    const url = parseGoogleDriveLink(rawUrl);
    const id  = Date.now().toString() + Math.random().toString(36).substring(2, 5);

    let initialName = 'Pending...';
    if (providedFilename && typeof providedFilename === 'string' && providedFilename.trim()) {
        initialName = providedFilename.replace(/^.*[\\/]/, '');
    } else if (url.includes('drive.google.com')) {
        initialName = 'Google Drive File';
    }

    const priority = getNextPriority();

    const task = {
        id,
        url,
        filename:         initialName,
        loaded:           0,
        total:            0,
        status:           'queued',
        startTime:        Date.now(),
        isResumable:      false,
        useCredentials:   false,
        threads:          [],
        speed:            0,
        prevLoaded:       0,
        remainingTime:    -1,
        downloadDuration: 0,
        serverHash:       '-',
        sha256:           '-',
        localCrc32:       '-',
        mime:             '-',
        downloadId:       null,
        retryCount:       0,
        isConnecting:     false,
        priority
    };
    tasks.set(id, task);
    saveState(true);
    broadcast();
    processQueue();

    if (appSettings.showPageNotification) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'show_page_notification', url, filename: initialName
                }).catch(() => {});
            }
        });
    }
}

async function handleCheckUrl(rawUrl, sendResponse) {
    const url        = parseGoogleDriveLink(rawUrl);
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 15000);
    try {
        let resp = await fetch(url, { method: 'HEAD', signal: controller.signal });
        if (!resp.ok) resp = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: controller.signal });
        if (resp.status === 401 || resp.status === 403) {
            resp = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, credentials: 'include', signal: controller.signal });
        }
        clearTimeout(timeoutId);
        if (!resp.ok && resp.status !== 206 && resp.status !== 200) throw new Error(`HTTP ${resp.status}`);

        let size = 0;
        const cr = resp.headers.get('content-range');
        if (cr) size = parseInt(cr.split('/')[1]);
        else    size = parseInt(resp.headers.get('content-length') || '0');

        let name = parseContentDisposition(resp.headers.get('content-disposition'));
        if (!name) {
            name = url.split('/').pop().split('?')[0];
            try { name = decodeURIComponent(name); } catch (e) {}
        }

        const etag   = (resp.headers.get('etag') || '-').replace(/['"]/g, '');
        const sha256 = resp.headers.get('x-checksum-sha256')
            || resp.headers.get('x-amz-checksum-sha256') || '-';

        sendResponse({
            success: true, size, filename: name || 'unknown',
            mime: resp.headers.get('content-type') || 'unknown',
            checksum: etag, sha256
        });
        controller.abort();
    } catch (err) {
        clearTimeout(timeoutId);
        sendResponse({ success: false });
    }
}

async function startDownload(task) {
    if (!db) await initDB();
    task.status       = 'running';
    task.isConnecting = true; 
    saveState(true);
    broadcast();

    const masterController = new AbortController();
    activeControllers.set(task.id, masterController);

    try {
        let response = await fetch(task.url, {
            method: 'GET', headers: { Range: 'bytes=0-0' }, signal: masterController.signal
        });

        if (response.status === 401 || response.status === 403) {
            response = await fetch(task.url, {
                method: 'GET', headers: { Range: 'bytes=0-0' },
                credentials: 'include', signal: masterController.signal
            });
            if (response.ok || response.status === 206) task.useCredentials = true;
            else throw new Error(`Access Denied (HTTP ${response.status})`);
        } else if (!response.ok && response.status !== 206) {
            throw new Error(`HTTP Error ${response.status}`);
        }

        task.isConnecting = false;

        task.finalUrl    = response.url;
        const cr         = response.headers.get('content-range');
        const cl         = response.headers.get('content-length');
        task.total       = cr ? parseInt(cr.split('/')[1]) : (cl ? parseInt(cl) : 0);
        task.isResumable = (response.status === 206)
            || (response.headers.get('accept-ranges') === 'bytes') || !!cr;
        task.serverHash  = (response.headers.get('etag') || '-').replace(/['"]/g, '');
        task.sha256      = response.headers.get('x-checksum-sha256')
            || response.headers.get('x-amz-checksum-sha256') || '-';
        task.mime        = response.headers.get('content-type') || 'unknown';

        const dispName = parseContentDisposition(response.headers.get('content-disposition'));
        if (dispName) {
            task.filename = dispName;
        } else if (!task.filename || task.filename === 'Pending...' || task.filename === 'Google Drive File') {
            let fn = task.finalUrl.split('/').pop().split('?')[0];
            try { fn = decodeURIComponent(fn); } catch (e) {}
            task.filename = fn || `file-${task.id}.bin`;
        }

        if (task.threads.length === 0) {
            let hostname        = '';
            try { hostname = new URL(task.finalUrl || task.url).hostname; } catch (e) {}
            const effectiveMax  = hostname ? getEffectiveMaxThreads(hostname) : appSettings.maxThreads;

            let optimalThreads = 1;
            if (task.isResumable && task.total > 0) {
                if      (task.total > 100 * 1024 * 1024) optimalThreads = 8;
                else if (task.total >  50 * 1024 * 1024) optimalThreads = 6;
                else if (task.total >  10 * 1024 * 1024) optimalThreads = 4;
            }
            optimalThreads = Math.min(optimalThreads, effectiveMax);

            const partSize = task.total > 0 ? Math.floor(task.total / optimalThreads) : 0;
            for (let i = 0; i < optimalThreads; i++) {
                const start = i * partSize;
                const end   = (i === optimalThreads - 1)
                    ? (task.total > 0 ? task.total - 1 : 0)
                    : (start + partSize - 1);
                task.threads.push({ index: i, start, end, current: start, complete: false });
            }
        } else if (!task.isResumable && task.threads.length <= 1) {
            task.threads = [{ index: 0, start: 0, end: task.total > 0 ? task.total - 1 : 0, current: 0, complete: false }];
        } else if (task.threads.length > 1) {
            task.isResumable = true;
        }

        saveState(true);
        broadcast();

        await new Promise((resolve, reject) => {
            task.checkCompletion = () => {
                if (masterController.signal.aborted) return;
                if (task.threads.every(t => t.complete)) resolve();
            };
            task.handleError = (e) => reject(e);

            const pending = task.threads.filter(t => !t.complete);
            if (pending.length === 0) {
                task.checkCompletion();
            } else {
                pending.forEach(t => {
                    downloadThread(task, t, masterController.signal).catch(e => {
                        if (e.name !== 'AbortError') task.handleError(e);
                    });
                });
            }
        });

        if (masterController.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (task.status === 'running') triggerAssembly(task);

    } catch (e) {
        task.isConnecting = false; 
        const isAbort = e.name === 'AbortError';
        if (!isAbort) {
            masterController.abort();
            const maxRetries = appSettings.maxRetries || 3;
            if (task.retryCount < maxRetries) {
                task.retryCount++;
                const delay = Math.pow(2, task.retryCount) * 1000; 
                task.status = 'queued';
                activeControllers.delete(task.id);
                saveState(true);
                broadcast();
                notifyUser('CzDM - Retrying Download',
                    `${task.filename} — Attempt ${task.retryCount + 1} of ${maxRetries + 1}`);
                await new Promise(r => setTimeout(r, delay));
                if (tasks.has(task.id) && task.status === 'queued') processQueue();
                return;
            }
            task.status = 'error';
            addToHistory(task);
        }
        activeControllers.delete(task.id);
        saveState(true);
        broadcast();
        processQueue();
        if (!isAbort) notifyUser('CzDM - Download Failed', task.filename);
    }
}

async function downloadThread(task, threadInfo, signal) {
    const downloadUrl = task.finalUrl || task.url;
    let offset    = threadInfo.current;
    let streamPos = offset;

    if (!task.isResumable && offset > 0) {
        offset = streamPos = threadInfo.current = 0;
        if (task.threads.length === 1) task.loaded = 0;
        await cleanupDB(task.id);
    }

    const headers = {};
    if (task.isResumable || task.total > 0) {
        const endRange = (threadInfo.end > 0 && threadInfo.end >= offset) ? threadInfo.end : '';
        headers['Range'] = `bytes=${offset}-${endRange}`;
    }
    const options = { headers, signal };
    if (task.useCredentials) options.credentials = 'include';

    let bytesInBuffer = 0;

    try {
        const resp = await fetch(downloadUrl, options);
        if (!resp.ok && resp.status !== 206 && resp.status !== 200) throw new Error(`HTTP ${resp.status}`);

        if (offset > 0 && resp.status === 200) {
            if (task.threads.length > 1) {
                throw new Error('Server no longer supports multi-threading. Please restart download.');
            }
            task.loaded -= threadInfo.current;
            offset = streamPos = threadInfo.current = 0;
            await cleanupDB(task.id);
        }

        const reader          = resp.body.getReader();
        let chunksArray       = [];
        let lastBroadcastTime = Date.now();

        while (true) {
            const { done, value } = await reader.read();
            if (done || signal.aborted) break;

            let chunk        = value;
            let isDynamicEnd = false;

            if (task.isResumable && threadInfo.end > 0
                && (threadInfo.current + chunk.length > threadInfo.end + 1)) {
                const allowed = (threadInfo.end + 1) - threadInfo.current;
                chunk = allowed > 0 ? chunk.slice(0, allowed) : new Uint8Array(0);
                isDynamicEnd = true;
            }

            const len = chunk.length;
            if (len > 0) {
                threadInfo.current += len;
                task.loaded        += len;
                chunksArray.push(chunk);
                bytesInBuffer      += len;
                await bwThrottle.check(len);
            }

            if (Date.now() - lastBroadcastTime > 500) {
                broadcast();
                lastBroadcastTime = Date.now();
            }

            if (bytesInBuffer >= CHUNK_SIZE) {
                await flushBufferToDB(task.id, chunksArray, bytesInBuffer, streamPos);
                streamPos    += bytesInBuffer;
                chunksArray   = [];
                bytesInBuffer = 0;
                throttledSave();
            }

            if (isDynamicEnd) { try { reader.cancel(); } catch (e) {} break; }
        }

        if (bytesInBuffer > 0) {
            await flushBufferToDB(task.id, chunksArray, bytesInBuffer, streamPos);
        }

        if (!signal.aborted) {
            threadInfo.complete = true;
            saveState(false);
            spawnNewThreadIfNeeded(task, signal);
            if (task.checkCompletion) task.checkCompletion();
        }

    } catch (e) {
        if (bytesInBuffer > 0) {
            threadInfo.current -= bytesInBuffer;
            task.loaded        -= bytesInBuffer;
        }
        throw e;
    }
}

function spawnNewThreadIfNeeded(task, signal) {
    if (!task.isResumable || task.total <= 0) return;

    let hostname = '';
    try { hostname = new URL(task.finalUrl || task.url).hostname; } catch (e) {}
    const effectiveMax  = hostname ? getEffectiveMaxThreads(hostname) : appSettings.maxThreads;
    const activeThreads = task.threads.filter(t => !t.complete).length;

    if (activeThreads >= effectiveMax || activeThreads === 0) return;

    let largestRemaining = 0, targetThread = null;
    task.threads.forEach(t => {
        if (!t.complete) {
            const remain = t.end - t.current;
            if (remain > largestRemaining) { largestRemaining = remain; targetThread = t; }
        }
    });

    const MIN_SPLIT = 1024 * 1024 * 2;
    if (largestRemaining > MIN_SPLIT && targetThread) {
        const mid    = targetThread.current + Math.floor(largestRemaining / 2);
        const oldEnd = targetThread.end;
        targetThread.end = mid - 1;
        const newThread  = { index: task.threads.length, start: mid, end: oldEnd, current: mid, complete: false };
        task.threads.push(newThread);
        task.threads.sort((a, b) => a.start - b.start);
        saveState(true);
        broadcast();
        downloadThread(task, newThread, signal).catch(e => {
            if (e.name !== 'AbortError' && task.handleError) task.handleError(e);
        });
    }
}

async function flushBufferToDB(taskId, chunksArray, totalSize, offsetKey) {
    const combined = new Uint8Array(totalSize);
    let pos = 0;
    for (const val of chunksArray) { combined.set(val, pos); pos += val.length; }
    await saveChunk(taskId, offsetKey, combined.buffer);
}

function saveChunk(taskId, offset, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['chunks'], 'readwrite');
        tx.objectStore('chunks').put({ taskId, offset, data });
        tx.oncomplete = resolve;
        tx.onerror    = (e) => reject(e);
    });
}

function cleanupDB(taskId) {
    return new Promise((resolve) => {
        if (!db) return resolve();
        try {
            const tx    = db.transaction(['chunks'], 'readwrite');
            const store = tx.objectStore('chunks');
            const range = IDBKeyRange.bound([taskId, 0], [taskId, Infinity]);
            store.delete(range).onsuccess = resolve;
        } catch (e) { resolve(); }
    });
}

function cancelTask(id) {
    if (activeControllers.has(id)) {
        activeControllers.get(id).abort();
        activeControllers.delete(id);
    }
    if (tasks.has(id)) {
        tasks.delete(id);
        cleanupDB(id);
        chrome.runtime.sendMessage({ action: 'cleanup_opfs', taskId: id }).catch(() => {});
        saveState(true);
        broadcast();
        processQueue();
    }
}

async function triggerAssembly(task) {
    task.status = 'assembling';
    saveState(true);
    broadcast();
    try {
        if (!(await chrome.offscreen.hasDocument())) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Assembly large file'
            });
        }
        chrome.runtime.sendMessage({ action: 'assemble_file', taskId: task.id, filename: task.filename });
    } catch (e) {
        task.status = 'error';
        addToHistory(task);
        saveState(true); broadcast(); processQueue();
        notifyUser('CzDM - Assembly Failed', task.filename);
    }
}

function handleAssemblyReport(msg) {
    const task = tasks.get(msg.taskId);
    if (!task) return;

    if (msg.success && msg.blobUrl) {
        task.localCrc32 = msg.crc32 || '-';
        chrome.downloads.download({
            url: msg.blobUrl, filename: task.filename,
            saveAs: appSettings.downloadLocation === 'custom'
        }, (downloadId) => {
            const hasError  = !!chrome.runtime.lastError;
            task.status     = hasError ? 'error' : 'completed';
            if (downloadId) task.downloadId = downloadId;
            saveState(true); broadcast(); processQueue();
            addToHistory(task);
            if (!hasError) {
                cleanupDB(msg.taskId);
                notifyUser('CzDM - Download Complete', task.filename);
                setTimeout(() => {
                    chrome.runtime.sendMessage({ action: 'cleanup_opfs', taskId: msg.taskId }).catch(() => {});
                }, 8000);
            } else {
                notifyUser('CzDM - Save Failed', task.filename);
            }
            setTimeout(() => {
                chrome.runtime.sendMessage({ action: 'revoke_blob_url', url: msg.blobUrl }).catch(() => {});
            }, 10000);
        });
    } else {
        task.status = 'error';
        addToHistory(task);
        saveState(true); broadcast(); processQueue();
        notifyUser('CzDM - Assembly Failed', task.filename);
    }
}

initDB().then(() => {
    restoreState();
    cleanOrphanedOPFS();
});