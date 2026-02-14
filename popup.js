document.addEventListener('contextmenu', (event) => {
    if (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') {
        event.preventDefault();
    }
});

let selectedIds = new Set();
let currentTasks = [];
let grabberLinks = [];
let checkQueue = [];
let isCheckingQueue = false;

const DEFAULT_SETTINGS = {
    theme: 'auto',
    downloadLocation: 'default',
    autoOverride: true,
    maxConcurrent: 3,
    maxThreads: 8,
    interceptExts: 'zip, rar, 7z, iso, exe, msi, apk, mp4, mkv, avi, mp3, pdf, dmg, pkg',
    minSizeMB: 5,
    notifications: true
};

// --- DOM ELEMENTS ---
const listContainer = document.getElementById('listContainer');
const loadingOverlay = document.getElementById('loadingOverlay');
const toastContainer = document.getElementById('toastContainer');

// Toolbar Buttons
const toolAdd = document.getElementById('toolAdd');
const toolStart = document.getElementById('toolStart');
const toolPause = document.getElementById('toolPause');
const toolDelete = document.getElementById('toolDelete');
const toolSelectAll = document.getElementById('toolSelectAll');
const toolClear = document.getElementById('toolClear');

// Settings Elements
const sTheme = document.getElementById('sTheme');
const sDownloadLocation = document.getElementById('sDownloadLocation');
const sAutoOverride = document.getElementById('sAutoOverride');
const sInterceptExts = document.getElementById('sInterceptExts');
const sMinSize = document.getElementById('sMinSize');
const sMaxConcurrent = document.getElementById('sMaxConcurrent');
const sMaxThreads = document.getElementById('sMaxThreads');
const sNotifications = document.getElementById('sNotifications');

// Modal Elements
const addModal = document.getElementById('addModal');
const newUrlInput = document.getElementById('newUrlInput');
const pasteBtn = document.getElementById('pasteBtn');
const urlDetails = document.getElementById('urlDetails');
const addConfirm = document.getElementById('addConfirm');
const addCancel = document.getElementById('addCancel');

const confirmModal = document.getElementById('confirmModal');
const modalTitle = document.getElementById('modalTitle');
const modalText = document.getElementById('modalText');
const modalOk = document.getElementById('modalOk');
const modalCancel = document.getElementById('modalCancel');

// Grabber Elements
const scanBtn = document.getElementById('scanBtn');
const rescanBtn = document.getElementById('rescanBtn');
const grabList = document.getElementById('grabList');
const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
const grabSelectAllBtn = document.getElementById('grabSelectAllBtn');
const filterInput = document.getElementById('filterInput');
const grabCountLabel = document.getElementById('grabCountLabel');

let addUrlTimeout = null;
let settingsSaveTimeout = null;

document.addEventListener('DOMContentLoaded', () => {
    loadManifestInfo();
    loadSettings();
    requestUpdate(true);
    setInterval(() => requestUpdate(false), 1000);

    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab && activeTab.dataset.tab === 'grabber') {
        checkPageEligibility();
    }
});

function loadManifestInfo() {
    try {
        const manifest = chrome.runtime.getManifest();

        const appHeaderName = document.getElementById('appHeaderName');
        const aboutAppName = document.getElementById('aboutAppName');
        const aboutAppFullName = document.getElementById('aboutAppFullName');
        const appDeveloper = document.getElementById('appDeveloper');
        const appVersion = document.getElementById('appVersion');
        const appDesc = document.getElementById('appDesc');

        if (appVersion) appVersion.innerText = `v${manifest.version}`;
        if (appDesc) appDesc.innerText = manifest.description;
        if (appHeaderName) appHeaderName.innerText = manifest.short_name || "CzDM";
        if (aboutAppName) aboutAppName.innerText = manifest.short_name || "CzDM";
        if (aboutAppFullName) aboutAppFullName.innerText = manifest.full_name;
        if (appDeveloper) appDeveloper.innerText = `© ${new Date().getFullYear()} ${manifest.author || 'Cyberzilla'}`;
    } catch (e) {
        console.error("Gagal memuat info manifest:", e);
    }
}

function applyTheme(themeValue) {
    if (themeValue === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else if (themeValue === 'light') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (sTheme.value === 'auto') {
        applyTheme('auto');
    }
});

function loadSettings() {
    chrome.storage.local.get('settings', (res) => {
        const s = Object.assign({}, DEFAULT_SETTINGS, res.settings || {});
        sTheme.value = s.theme;
        sDownloadLocation.value = s.downloadLocation || 'default';
        sAutoOverride.checked = s.autoOverride;
        sInterceptExts.value = s.interceptExts;
        sMinSize.value = s.minSizeMB;
        sMaxConcurrent.value = s.maxConcurrent;
        sMaxThreads.value = s.maxThreads;
        sNotifications.checked = s.notifications;

        applyTheme(s.theme);
    });
}

function saveSettings() {
    const newSettings = {
        theme: sTheme.value,
        downloadLocation: sDownloadLocation.value,
        autoOverride: sAutoOverride.checked,
        interceptExts: sInterceptExts.value,
        minSizeMB: parseInt(sMinSize.value) || 5,
        maxConcurrent: parseInt(sMaxConcurrent.value) || 3,
        maxThreads: parseInt(sMaxThreads.value) || 8,
        notifications: sNotifications.checked
    };

    applyTheme(newSettings.theme);
    chrome.storage.local.set({ settings: newSettings }, () => {
        showToast('Settings Saved!');
    });
}

[sTheme, sDownloadLocation, sAutoOverride, sMinSize, sMaxConcurrent, sMaxThreads, sNotifications].forEach(el => {
    if(el) el.addEventListener('change', saveSettings);
});

if (sInterceptExts) {
    sInterceptExts.addEventListener('input', () => {
        clearTimeout(settingsSaveTimeout);
        settingsSaveTimeout = setTimeout(saveSettings, 1000);
    });
}

const tabs = document.querySelectorAll('.tab-btn');
const panes = document.querySelectorAll('.tab-pane');
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panes.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'grabber') checkPageEligibility();
    });
});

function checkPageEligibility() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;
        const url = tabs[0].url;
        const isBlocked = url.startsWith('chrome:') || url.startsWith('edge:') || url.startsWith('about:') || url.startsWith('https://chrome.google.com/webstore');

        const grabInit = document.getElementById('grabberInit');
        const grabBlocked = document.getElementById('grabberBlocked');
        const grabResults = document.getElementById('grabberResults');

        if (!grabResults.classList.contains('hidden')) return;

        if (isBlocked) {
            grabInit.classList.add('hidden');
            grabBlocked.classList.remove('hidden');
        } else {
            grabBlocked.classList.add('hidden');
            grabInit.classList.remove('hidden');
        }
    });
}

function requestUpdate(isInit) {
    chrome.runtime.sendMessage({ action: "get_tasks" }, (tasks) => {
        if (isInit) setTimeout(() => { if (loadingOverlay) loadingOverlay.style.display = 'none'; }, 300);
        if (!chrome.runtime.lastError && tasks) {
            currentTasks = tasks;
            renderList(tasks);
            updateToolbarState();
        }
    });
}

listContainer.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-url-btn');
    if (copyBtn) {
        const row = copyBtn.closest('.task-row');
        if (row) {
            const task = currentTasks.find(t => t.id === row.dataset.id);
            if (task) {
                navigator.clipboard.writeText(task.url);
                showToast('URL copied!');
            }
        }
        return;
    }

    const row = e.target.closest('.task-row');
    if (!row) return;

    const taskId = row.dataset.id;

    if (e.target.closest('.col-chk')) {
        if (selectedIds.has(taskId)) selectedIds.delete(taskId);
        else selectedIds.add(taskId);
    } else {
        selectedIds.clear();
        selectedIds.add(taskId);
    }

    updateSelectionVisuals();
    updateToolbarState();
});

function updateSelectionVisuals() {
    Array.from(listContainer.children).forEach(row => {
        const id = row.dataset.id;
        if (selectedIds.has(id)) row.classList.add('selected');
        else row.classList.remove('selected');
    });
}

function renderList(tasks) {
    if (!tasks || tasks.length === 0) {
        listContainer.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><p>No downloads yet.</p></div>`;
        return;
    }

    if (listContainer.querySelector('.empty-state')) listContainer.innerHTML = '';
    const taskIds = new Set(tasks.map(t => t.id));

    Array.from(listContainer.children).forEach(row => {
        const rid = row.dataset.id;
        if (!taskIds.has(rid)) {
            row.remove();
            selectedIds.delete(rid);
        }
    });

    [...tasks].reverse().forEach((task, index) => {
        let row = document.getElementById(`task-${task.id}`);
        const isSelected = selectedIds.has(task.id);

        if (!row) {
            row = document.createElement('div');
            row.id = `task-${task.id}`;
            row.dataset.id = task.id;
            row.className = `task-row ${isSelected ? 'selected' : ''}`;
            row.innerHTML = `
                <div class="col-chk"><div class="chk-box"></div></div>
                <div class="row-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                </div>
                <div class="row-details">
                    <div class="file-name-row">
                        <div class="file-name">${task.filename}</div> 
                        <button class="copy-url-btn" title="Copy URL"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
                    </div>
                    <div class="progress-compact">
                        <div class="prog-fill"></div>
                        <div class="prog-threads" style="display:none"></div>
                    </div>
                    <div class="file-meta">
                        <span class="meta-left">Waiting...</span>
                        <span class="meta-right status-text">QUEUED</span>
                    </div>
                </div>`;
            const refNode = listContainer.children[index];
            listContainer.insertBefore(row, refNode || null);
        } else {
            const currentRowAtIndex = listContainer.children[index];
            if (currentRowAtIndex && currentRowAtIndex !== row) {
                listContainer.insertBefore(row, currentRowAtIndex);
            }
        }

        if (isSelected && !row.classList.contains('selected')) row.classList.add('selected');
        if (!isSelected && row.classList.contains('selected')) row.classList.remove('selected');

        const nameEl = row.querySelector('.file-name');
        if (nameEl && nameEl.innerText !== task.filename) nameEl.innerText = task.filename;

        const rawStatus = task.status ? task.status.toLowerCase() : '';
        const isComplete = rawStatus.includes('complete') || rawStatus === 'finished';
        const isRunning = rawStatus === 'running';
        const isError = rawStatus === 'error';
        const isPaused = rawStatus === 'paused';

        let percent = task.total > 0 ? Math.round((task.loaded / task.total) * 100) : 0;
        if (isComplete || rawStatus === 'assembling') percent = 100;

        const fill = row.querySelector('.prog-fill');
        const threadsDiv = row.querySelector('.prog-threads');
        const metaLeft = row.querySelector('.meta-left');
        const metaRight = row.querySelector('.meta-right');

        if (isRunning && task.threads && task.threads.length > 1) {
            fill.style.display = 'none';
            threadsDiv.style.display = 'flex';

            while (threadsDiv.children.length < task.threads.length) {
                const d = document.createElement('div'); d.className = 'th-bit';
                d.appendChild(document.createElement('div')).className = 'th-bit-fill';
                threadsDiv.appendChild(d);
            }
            while (threadsDiv.children.length > task.threads.length) threadsDiv.lastChild.remove();

            const fills = threadsDiv.querySelectorAll('.th-bit-fill');
            task.threads.forEach((t, i) => {
                if (fills[i]) {
                    const tot = t.end - t.start;
                    const ld = t.current - t.start;
                    let p = tot > 0 ? (ld / tot) * 100 : 0;
                    if (t.complete) p = 100;
                    fills[i].style.width = `${p}%`;
                }
            });
        } else {
            threadsDiv.style.display = 'none';
            fill.style.display = 'block';
            fill.style.width = `${percent}%`;

            let colorVar = 'var(--primary)';
            if (isError) colorVar = 'var(--danger)';
            else if (isComplete) colorVar = 'var(--success)';
            else if (isPaused) colorVar = 'var(--warning)';
            fill.style.background = colorVar;
        }

        const newMetaLeft = `${formatBytes(task.loaded)} / ${formatBytes(task.total)} • ${percent}%`;
        if (metaLeft.innerText !== newMetaLeft) metaLeft.innerText = newMetaLeft;

        let statusText = isRunning ? formatSpeed(task.speed) : task.status.toUpperCase();
        if (metaRight.innerText !== statusText) metaRight.innerText = statusText;

        let statusClass = rawStatus;
        if (isComplete) statusClass = 'completed';
        const newMetaClass = `meta-right status-text ${statusClass}`;
        if (metaRight.className !== newMetaClass) metaRight.className = newMetaClass;
    });
}

function updateToolbarState() {
    const count = selectedIds.size;
    if (count === 0) {
        toolStart.disabled = true; toolPause.disabled = true; toolDelete.disabled = true;
        toolSelectAll.querySelector('span').innerText = "Select All";
        return;
    }

    toolDelete.disabled = false;
    let canStart = false, canPause = false;
    selectedIds.forEach(id => {
        const task = currentTasks.find(t => t.id === id);
        if (task) {
            const s = task.status ? task.status.toLowerCase() : '';
            if (s === 'running') canPause = true;
            if (['paused', 'queued', 'error'].includes(s)) canStart = true;
        }
    });

    toolStart.disabled = !canStart;
    toolPause.disabled = !canPause;
    toolSelectAll.querySelector('span').innerText = (currentTasks.length > 0 && count === currentTasks.length) ? "Deselect" : "Select All";
}

toolSelectAll.onclick = () => {
    if (selectedIds.size === currentTasks.length && currentTasks.length > 0) {
        selectedIds.clear();
    } else {
        currentTasks.forEach(t => selectedIds.add(t.id));
    }
    updateSelectionVisuals();
    updateToolbarState();
};

toolDelete.onclick = () => {
    if (selectedIds.size === 0) return;
    showConfirm('Delete Items?', `Are you sure you want to delete ${selectedIds.size} tasks?`, 'Delete', () => {
        selectedIds.forEach(id => chrome.runtime.sendMessage({ action: 'cancel_task', id: id }));
        showToast(`${selectedIds.size} items deleted`);
        selectedIds.clear();
        updateSelectionVisuals();
        updateToolbarState();
    });
};

toolClear.onclick = () => {
    const hasHistory = currentTasks.some(t => t.status === 'completed' || t.status === 'error');
    if (!hasHistory) {
        showToast('No history to clear.');
        return;
    }
    showConfirm('Clear History?', 'Remove all completed and failed tasks?', 'Clear All', () => {
        chrome.runtime.sendMessage({ action: "clear_tasks" });
        showToast('History cleared');
    });
};

toolPause.onclick = () => selectedIds.forEach(id => chrome.runtime.sendMessage({ action: 'pause_task', id: id }));
toolStart.onclick = () => selectedIds.forEach(id => chrome.runtime.sendMessage({ action: 'resume_task', id: id }));

toolAdd.onclick = () => { addModal.classList.add('active'); newUrlInput.value = ''; urlDetails.classList.add('hidden'); addConfirm.disabled = true; newUrlInput.focus(); };
addCancel.onclick = () => addModal.classList.remove('active');
pasteBtn.onclick = async () => { try { newUrlInput.focus(); const text = await navigator.clipboard.readText(); if (text && text.startsWith('http')) { newUrlInput.value = text; triggerUrlCheck(text); showToast('URL Pasted'); } } catch (e) {} };
newUrlInput.addEventListener('input', (e) => triggerUrlCheck(e.target.value));

function triggerUrlCheck(url) {
    if (addUrlTimeout) clearTimeout(addUrlTimeout);
    urlDetails.classList.add('hidden');
    addConfirm.disabled = true;
    if (!url || !url.startsWith('http')) return;
    addUrlTimeout = setTimeout(() => {
        urlDetails.classList.remove('hidden');
        urlDetails.innerHTML = '<div class="detail-row"><span>Checking...</span></div>';
        chrome.runtime.sendMessage({ action: 'check_url', url: url }, (res) => {
            urlDetails.innerHTML = '';
            if (res && res.success) {
                const addRow = (l, v) => urlDetails.innerHTML += `<div class="detail-row"><span class="label">${l}:</span><span class="value">${v}</span></div>`;
                addRow("File", res.filename); addRow("Size", formatBytes(res.size)); addRow("Type", res.mime || '-');
                addConfirm.disabled = false;
            } else {
                urlDetails.innerHTML = '<div class="detail-row"><span class="label" style="color:var(--danger)">Error:</span><span class="value">Check Failed</span></div>';
            }
        });
    }, 500);
}
addConfirm.onclick = () => { if (newUrlInput.value) { chrome.runtime.sendMessage({ action: "add_task", url: newUrlInput.value }); addModal.classList.remove('active'); showToast('Added to queue'); } };

function updateGrabberToolbarState() {
    const rows = Array.from(grabList.querySelectorAll('.grab-row'));
    if (rows.length === 0) {
        grabSelectAllBtn.querySelector('span').innerText = "Select All";
        return;
    }
    const selectedCount = rows.filter(r => r.classList.contains('selected')).length;
    const allSelected = selectedCount === rows.length;
    grabSelectAllBtn.querySelector('span').innerText = allSelected ? "Deselect" : "Select All";
}

function queueCheckItemSize(item, row) {
    if (item.cachedSize !== undefined || item.isChecking) return;
    item.isChecking = true;
    const sizeEl = row.querySelector('.grab-size-info');
    if (sizeEl) sizeEl.textContent = 'Wait...';
    checkQueue.push({ item, row });
    processCheckQueue();
}

function processCheckQueue() {
    if (isCheckingQueue || checkQueue.length === 0) return;
    isCheckingQueue = true;
    const batch = checkQueue.splice(0, 5);

    const promises = batch.map(({ item, row }) => {
        return new Promise(resolve => {
            const sizeEl = row.querySelector('.grab-size-info');
            if (sizeEl) sizeEl.textContent = 'Checking...';
            chrome.runtime.sendMessage({ action: 'check_url', url: item.url }, (res) => {
                if (res && res.success) {
                    item.cachedSize = res.size;
                    if (sizeEl) sizeEl.textContent = formatBytes(res.size);
                } else {
                    item.cachedSize = 'unknown';
                    if (sizeEl) sizeEl.textContent = 'Unknown';
                }
                resolve();
            });
        });
    });

    Promise.all(promises).then(() => {
        isCheckingQueue = false;
        processCheckQueue();
    });
}

grabList.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-url-btn');
    if (copyBtn) {
        const row = copyBtn.closest('.grab-row');
        if (row && row.dataset.url) {
            navigator.clipboard.writeText(row.dataset.url);
            showToast('URL copied!');
        }
        return;
    }

    const row = e.target.closest('.grab-row');
    if (!row) return;
    const url = row.dataset.url;
    const item = grabberLinks.find(i => i.url === url);

    if (e.target.closest('.col-chk')) {
        row.classList.toggle('selected');
        if (!row.classList.contains('selected')) {
            checkQueue = checkQueue.filter(q => {
                if (q.row === row) {
                    q.item.isChecking = false;
                    const sizeEl = row.querySelector('.grab-size-info');
                    if (sizeEl && sizeEl.textContent === 'Wait...') sizeEl.textContent = '-';
                    return false;
                }
                return true;
            });
        } else {
            if (item) queueCheckItemSize(item, row);
        }
    } else {
        const currentlySelected = grabList.querySelectorAll('.grab-row.selected');
        currentlySelected.forEach(r => r.classList.remove('selected'));
        checkQueue.forEach(q => {
            q.item.isChecking = false;
            const sizeEl = q.row.querySelector('.grab-size-info');
            if (sizeEl && sizeEl.textContent === 'Wait...') sizeEl.textContent = '-';
        });
        checkQueue = [];
        row.classList.add('selected');
        if (item) queueCheckItemSize(item, row);
    }
    updateGrabberToolbarState();
});

function renderGrab(items) {
    grabList.innerHTML = '';
    grabCountLabel.innerText = `Found: ${items.length}`;
    grabSelectAllBtn.querySelector('span').innerText = "Select All";

    if (!items.length) {
        grabList.innerHTML = `<div class="empty-state"><p>No media found.</p></div>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach(i => {
        const row = document.createElement('div');
        row.className = 'grab-row';
        row.dataset.url = i.url;
        row.style.userSelect = 'none';
        row.style.cursor = 'pointer';

        let filename = i.url.split('/').pop().split('?')[0];
        try { filename = decodeURIComponent(filename); } catch(e){}
        if (!filename || filename.trim() === '') filename = 'unknown_file';

        let displaySize = '-';
        if (i.cachedSize === 'unknown') displaySize = 'Unknown';
        else if (i.cachedSize !== undefined) displaySize = formatBytes(i.cachedSize);
        else if (i.isChecking) displaySize = 'Wait...';

        row.innerHTML = `
           <div class="col-chk"><div class="chk-box"></div></div>
           <div class="row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><polyline points="21 15 16 10 5 21"></polyline></svg>
           </div>
           <div class="row-details">
                <div class="file-name-row">
                    <div class="file-name">${filename}</div>
                    <button class="copy-url-btn" title="Copy URL"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
                </div>
                <div class="grab-meta-row">
                    <span class="grab-size-info">${displaySize}</span>
                    <span class="grab-url-sub">• ${i.url}</span>
                </div>
           </div>`;
        fragment.appendChild(row);
    });
    grabList.appendChild(fragment);
    updateGrabberToolbarState();
}

function applyCurrentFilter() {
    const val = filterInput.value.toLowerCase();
    if (!val) {
        renderGrab(grabberLinks);
        return;
    }
    const filtered = grabberLinks.filter(i =>
        (i.url.split('/').pop() || '').toLowerCase().includes(val) ||
        i.url.toLowerCase().includes(val)
    );
    renderGrab(filtered);
}

filterInput.addEventListener('input', applyCurrentFilter);
scanBtn.onclick = performScan;
rescanBtn.onclick = performScan;

grabSelectAllBtn.onclick = () => {
    const rows = grabList.querySelectorAll('.grab-row');
    const currentlyAllSelected = Array.from(rows).every(r => r.classList.contains('selected'));

    if (currentlyAllSelected) {
        rows.forEach(r => r.classList.remove('selected'));
        checkQueue.forEach(({ item, row }) => {
            item.isChecking = false;
            const sizeEl = row.querySelector('.grab-size-info');
            if (sizeEl) sizeEl.textContent = '-';
        });
        checkQueue = [];
    } else {
        rows.forEach(r => {
            r.classList.add('selected');
            const url = r.dataset.url;
            const item = grabberLinks.find(i => i.url === url);
            if (item) queueCheckItemSize(item, r);
        });
    }
    updateGrabberToolbarState();
};

downloadSelectedBtn.onclick = () => {
    const urls = Array.from(grabList.querySelectorAll('.grab-row.selected')).map(r => r.dataset.url);
    if (!urls.length) return showToast('Select files first');
    chrome.runtime.sendMessage({ action: "add_batch_tasks", urls });
    document.querySelector('[data-tab="dashboard"]').click();
    showToast(`${urls.length} tasks added`);
};

async function performScan() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    checkQueue = [];
    isCheckingQueue = false;

    document.getElementById('grabberInit').classList.add('hidden');
    document.getElementById('grabberResults').classList.remove('hidden');
    grabList.innerHTML = '<div class="empty-state"><p>Scanning...</p></div>';

    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }, (results) => {
        if (!chrome.runtime.lastError && results && results[0]) {
            grabberLinks = (results[0].result || []).map(link => ({
                ...link,
                cachedSize: undefined,
                isChecking: false
            }));
            applyCurrentFilter();
        }
    });
}

function formatBytes(bytes) { if (!+bytes) return '0 B'; const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.floor(Math.log(bytes) / Math.log(k)); return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`; }
function formatSpeed(s) { return (!s || s < 0) ? '0 B/s' : formatBytes(s) + '/s'; }

function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerText = msg;
    toastContainer.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

function showConfirm(title, text, btnText, cb) {
    if (!confirmModal) return;
    modalTitle.innerText = title;
    modalText.innerText = text;
    modalOk.innerText = btnText;
    modalOk.classList.add('confirm');
    confirmModal.classList.add('active');

    const cleanup = () => {
        confirmModal.classList.remove('active');
        modalOk.classList.remove('confirm');
        modalOk.onclick = null;
        modalCancel.onclick = null;
    };

    modalOk.onclick = () => { cb(); cleanup(); };
    modalCancel.onclick = () => { cleanup(); };
}