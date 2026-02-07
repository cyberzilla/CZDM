// background.js - CZDM Engine v1.0
// Offset-based Chunk Storage to prevent corruption

const DB_NAME = 'CZDM_DB';
const DB_VERSION = 1;
let db = null;
let tasks = new Map();
let activeControllers = new Map(); 

const MAX_CONCURRENT_DOWNLOADS = 3; 
const CHUNK_SIZE = 1024 * 1024 * 1; 

setInterval(() => {
    let needsBroadcast = false;
    tasks.forEach(task => {
        if (task.status === 'running') {
            const currentLoaded = task.loaded;
            const prevLoaded = task.prevLoaded || 0;
            task.speed = currentLoaded - prevLoaded;
            task.prevLoaded = currentLoaded;
            if (task.speed > 0 && task.total > 0) {
                const remainingBytes = task.total - task.loaded;
                task.remainingTime = Math.ceil(remainingBytes / task.speed);
            } else task.remainingTime = -1;
            needsBroadcast = true;
        } else {
            task.speed = 0; task.prevLoaded = task.loaded;
        }
    });
    if (needsBroadcast) broadcast();
}, 1000);

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

function saveState() {
  const serialized = Array.from(tasks.entries()).map(([id, t]) => {
      const { threads, speed, prevLoaded, remainingTime, ...cleanTask } = t; 
      cleanTask.threadStates = t.threads ? t.threads.map(th => ({ start: th.start, end: th.end, current: th.current, complete: th.complete })) : [];
      return [id, cleanTask];
  });
  chrome.storage.local.set({ 'tasks': serialized });
}

async function restoreState() {
  const res = await chrome.storage.local.get('tasks');
  if (res.tasks) {
    tasks = new Map(res.tasks);
    tasks.forEach(t => { 
        if(t.status === 'running' || t.status === 'assembling') t.status = 'queued';
        t.speed = 0; t.prevLoaded = t.loaded;
        if(t.threadStates && t.threadStates.length > 0) t.threads = t.threadStates; 
    });
    processQueue(); updateBadge();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "add_task") queueDownload(msg.url);
  else if (msg.action === "add_batch_tasks") msg.urls?.forEach(url => queueDownload(url));
  else if (msg.action === "get_tasks") sendResponse(Array.from(tasks.values()));
  else if (msg.action === "check_url") {
      fetch(msg.url, {
          method: 'GET',
          headers: { 'Range': 'bytes=0-0' }
      }).then(resp => {
          if (!resp.ok && resp.status !== 206) throw new Error('Fail');

          const contentRange = resp.headers.get('content-range');
          let size = 0;
          if (contentRange) {
              size = parseInt(contentRange.split('/')[1]);
          } else {
              // Fallback ke Content-Length jika server mengabaikan Range
              size = parseInt(resp.headers.get('content-length') || 0);
          }

          const type = resp.headers.get('content-type') || 'unknown';
          const etag = resp.headers.get('etag') || '-';

          // Logika nama file tetap sama
          let name = msg.url.split('/').pop().split('?')[0];
          const disp = resp.headers.get('content-disposition');
          if (disp && disp.includes('filename=')) {
              name = disp.split('filename=')[1].replace(/["']/g, '').trim();
          }
          try { name = decodeURIComponent(name); } catch(e){}

          sendResponse({
              success: true,
              size: size,
              filename: name,
              mime: type,
              checksum: etag.replace(/["']/g, '')
          });
      }).catch((err) => {
          console.error("Check URL Error:", err);
          sendResponse({ success: false });
      });
      return true;
  }
  else if (msg.action === "pause_task") {
    const task = tasks.get(msg.id);
    if(task && (task.status === 'running' || task.status === 'queued')) {
        task.status = 'paused';
        if (activeControllers.has(task.id)) { activeControllers.get(task.id).abort(); activeControllers.delete(task.id); }
        saveState(); broadcast(); processQueue();
    }
  }
  else if (msg.action === "resume_task") {
    const task = tasks.get(msg.id);
    if(task) {
        if (activeControllers.has(task.id)) { activeControllers.get(task.id).abort(); activeControllers.delete(task.id); }
        task.status = 'queued'; task.prevLoaded = task.loaded; 
        saveState(); broadcast(); processQueue();
    }
  }
  else if (msg.action === "cancel_task") cancelTask(msg.id);
  else if (msg.action === "clear_tasks") {
    tasks.forEach((task, id) => { if (task.status === 'completed' || task.status === 'error') { cleanupDB(id); tasks.delete(id); } });
    saveState(); broadcast(); updateBadge();
  }
  else if (msg.action === "assembly_report") handleAssemblyReport(msg);
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "czdm-download", title: "Download with CZDM", contexts: ["link", "image", "video", "audio"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "czdm-download") { const url = info.linkUrl || info.srcUrl; if (url) queueDownload(url); }
});

function getRunningCount() { let count = 0; tasks.forEach(t => { if(t.status === 'running' || t.status === 'assembling') count++; }); return count; }
function updateBadge() {
    const count = getRunningCount();
    if (count > 0) { chrome.action.setBadgeText({ text: count.toString() }); chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' }); } else { chrome.action.setBadgeText({ text: '' }); }
}
function processQueue() {
    if (getRunningCount() >= MAX_CONCURRENT_DOWNLOADS) return;
    for (const [id, task] of tasks) {
        if (task.status === 'queued') { startDownload(task); if (getRunningCount() >= MAX_CONCURRENT_DOWNLOADS) break; }
    }
    updateBadge();
}
async function queueDownload(url) {
  const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
  const task = {
    id, url, filename: 'pending...', loaded: 0, total: 0, status: 'queued', 
    startTime: Date.now(), isResumable: false, useCredentials: false, threads: [],
    speed: 0, prevLoaded: 0, remainingTime: -1
  };
  tasks.set(id, task); saveState(); broadcast(); processQueue();
}

async function startDownload(task) {
  if (!db) await initDB();
  task.status = 'running'; saveState(); broadcast();
  const masterController = new AbortController();
  activeControllers.set(task.id, masterController);
  try {
    let response = await fetch(task.url, { method: 'GET', headers: { 'Range': 'bytes=0-0' }, signal: masterController.signal });
    if (response.status === 401 || response.status === 403) {
        response = await fetch(task.url, { method: 'GET', headers: { 'Range': 'bytes=0-0' }, signal: masterController.signal, credentials: 'include' });
        if (response.ok || response.status === 206) task.useCredentials = true; else throw new Error(`Access Denied (HTTP ${response.status})`);
    } else if (!response.ok && response.status !== 206) throw new Error(`HTTP Error ${response.status}`);

    task.finalUrl = response.url;
    const contentRange = response.headers.get('content-range');
    const contentLength = response.headers.get('content-length');
    if (contentRange) task.total = parseInt(contentRange.split('/')[1]);
    else if (contentLength) task.total = parseInt(contentLength);
    else task.total = 0;
    const acceptRanges = response.headers.get('accept-ranges');
    task.isResumable = (response.status === 206) || (acceptRanges === 'bytes') || !!contentRange;

    const disposition = response.headers.get('content-disposition');
    let filename = task.finalUrl.split('/').pop().split('?')[0];
    if (disposition && disposition.includes('filename=')) filename = disposition.split('filename=')[1].replace(/["']/g, '').trim();
    try { filename = decodeURIComponent(filename); } catch(e){}
    if(!filename || filename === '') filename = `file-${task.id}.bin`;
    task.filename = filename;

    if (task.threads.length === 0) {
        let optimalThreads = 1;
        if (task.isResumable && task.total > 0) {
            if (task.total > 100 * 1024 * 1024) optimalThreads = 8;
            else if (task.total > 50 * 1024 * 1024) optimalThreads = 6;
            else if (task.total > 10 * 1024 * 1024) optimalThreads = 4;
            else if (task.total > 2 * 1024 * 1024) optimalThreads = 2;
        }
        const partSize = Math.floor(task.total / optimalThreads);
        for (let i = 0; i < optimalThreads; i++) {
            const start = i * partSize;
            let end = (start + partSize - 1);
            if (i === optimalThreads - 1) end = task.total - 1;
            if (optimalThreads === 1) end = task.total > 0 ? task.total - 1 : 0;
            task.threads.push({ index: i, start: start, end: end, current: start, complete: false });
        }
    }
    saveState(); broadcast();
    const promises = task.threads.filter(t => !t.complete).map(t => downloadThread(task, t, masterController.signal));
    await Promise.all(promises);
    if (task.status === 'running') triggerAssembly(task);
  } catch (e) {
    if (e.name !== 'AbortError') { console.error(`[BG] Error:`, e); task.status = 'error'; }
    activeControllers.delete(task.id); saveState(); broadcast(); processQueue();
  }
}

async function downloadThread(task, threadInfo, signal) {
  const downloadUrl = task.finalUrl || task.url;
  let offset = threadInfo.current;
  if (!task.isResumable && offset > 0) { offset = 0; task.loaded = 0; }
  const headers = {};
  if (task.isResumable || task.total > 0) headers['Range'] = `bytes=${offset}-${threadInfo.end}`;
  const options = { headers, signal };
  if (task.useCredentials) options.credentials = 'include';
  try {
      const resp = await fetch(downloadUrl, options);
      if (!resp.ok) { if (resp.status === 200 && task.isResumable) throw new Error("Resume rejected."); if (resp.status !== 206) throw new Error(`HTTP ${resp.status}`); }
      const reader = resp.body.getReader();
      let chunksArray = []; let bytesInBuffer = 0; let lastBroadcast = Date.now(); let streamPos = offset;
      while (true) {
          const {done, value} = await reader.read();
          if (done) break; if (signal.aborted) break;
          threadInfo.current += value.length; task.loaded += value.length;
          chunksArray.push(value); bytesInBuffer += value.length;
          const now = Date.now(); if (now - lastBroadcast > 500) { broadcast(); lastBroadcast = now; }
          if (bytesInBuffer >= CHUNK_SIZE) { await flushBufferToDB(task.id, chunksArray, bytesInBuffer, streamPos); streamPos += bytesInBuffer; chunksArray = []; bytesInBuffer = 0; saveState(); }
      }
      if (bytesInBuffer > 0) await flushBufferToDB(task.id, chunksArray, bytesInBuffer, streamPos);
      if (!signal.aborted) threadInfo.complete = true;
  } catch (e) { if (signal.aborted) throw e; throw e; }
}

async function flushBufferToDB(taskId, chunksArray, totalSize, offsetKey) {
    const combined = new Uint8Array(totalSize); let pos = 0;
    for (let val of chunksArray) { combined.set(val, pos); pos += val.length; }
    await saveChunk(taskId, offsetKey, combined.buffer);
}
function saveChunk(taskId, offset, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['chunks'], 'readwrite'); const store = tx.objectStore('chunks');
    store.put({ taskId, offset, data });
    tx.oncomplete = resolve; tx.onerror = (e) => reject(e);
  });
}
function cleanupDB(taskId) {
    if(!db) return;
    const tx = db.transaction(['chunks'], 'readwrite'); const store = tx.objectStore('chunks');
    const range = IDBKeyRange.bound([taskId, 0], [taskId, Infinity]);
    store.openCursor(range).onsuccess = (e) => { const cursor = e.target.result; if(cursor) { cursor.delete(); cursor.continue(); } };
}
function cancelTask(id) {
    if (activeControllers.has(id)) { activeControllers.get(id).abort(); activeControllers.delete(id); }
    if (tasks.has(id)) { tasks.delete(id); cleanupDB(id); saveState(); broadcast(); processQueue(); } else { broadcast(); }
}
function broadcast() { const list = Array.from(tasks.values()); updateBadge(); chrome.runtime.sendMessage({ action: "update_list", tasks: list }).catch(() => {}); }
async function triggerAssembly(task) {
  task.status = 'assembling'; saveState(); broadcast();
  try {
    const hasOffscreen = await chrome.offscreen.hasDocument();
    if (!hasOffscreen) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Assembly huge file' });
    chrome.runtime.sendMessage({ action: 'assemble_file', taskId: task.id, filename: task.filename });
  } catch (e) { task.status = 'error'; saveState(); broadcast(); processQueue(); }
}
function handleAssemblyReport(msg) {
  const task = tasks.get(msg.taskId); if (!task) return;
  if (msg.success && msg.blobUrl) {
    chrome.downloads.download({ url: msg.blobUrl, filename: task.filename, saveAs: false }, () => {
      if (chrome.runtime.lastError) task.status = 'error'; else { task.status = 'completed'; cleanupDB(msg.taskId); }
      saveState(); broadcast(); processQueue();
    });
  } else { task.status = 'error'; saveState(); broadcast(); processQueue(); }
}
initDB(); restoreState();