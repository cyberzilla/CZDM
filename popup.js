// =============================================================================
// CZDM popup.js v1.4.0
//
// Fix v1.4.0:
//   [1] Animasi transisi yang smooth saat pindah tab Single vs Batch.
//   [2] Tombol paste untuk Batch mode.
//   [3] Bug fix: Tool Start/Resume mengabaikan task yang sudah completed.
// =============================================================================

'use strict';

let selectedIds    = new Set();
let currentTasks   = [];
let grabberLinks   = [];
let checkQueue     = [];
let isCheckingQueue = false;

const DEFAULT_SETTINGS = {
    theme:                'auto',
    downloadLocation:     'default',
    autoOverride:         true,
    maxConcurrent:        3,
    maxThreads:           8,
    interceptExts:        'zip, rar, 7z, iso, exe, msi, apk, mp4, mkv, avi, mp3, pdf, dmg, pkg',
    minSizeMB:            5,
    notifications:        true,
    showPrompt:           false,
    showPageNotification: false,
    bandwidthLimit:       0,
    maxRetries:           3
};

const listContainer   = document.getElementById('listContainer');
const loadingOverlay  = document.getElementById('loadingOverlay');
const toastContainer  = document.getElementById('toastContainer');
const tabSlider       = document.getElementById('tabSlider');

const toolAdd          = document.getElementById('toolAdd');
const toolStart        = document.getElementById('toolStart');
const toolPause        = document.getElementById('toolPause');
const toolDelete       = document.getElementById('toolDelete');
const toolSelectAll    = document.getElementById('toolSelectAll');
const toolClear        = document.getElementById('toolClear');
const toolInfo         = document.getElementById('toolInfo');
const toolPriorityUp   = document.getElementById('toolPriorityUp');
const toolPriorityDown = document.getElementById('toolPriorityDown');

const sTheme            = document.getElementById('sTheme');
const sDownloadLocation = document.getElementById('sDownloadLocation');
const sAutoOverride     = document.getElementById('sAutoOverride');
const sInterceptExts    = document.getElementById('sInterceptExts');
const sMinSize          = document.getElementById('sMinSize');
const sMaxConcurrent    = document.getElementById('sMaxConcurrent');
const sMaxThreads       = document.getElementById('sMaxThreads');
const sNotifications    = document.getElementById('sNotifications');
const sShowPrompt       = document.getElementById('sShowPrompt');
const sShowNotification = document.getElementById('sShowNotification');
const sBandwidthLimit   = document.getElementById('sBandwidthLimit');
const sMaxRetries       = document.getElementById('sMaxRetries');

const addModal      = document.getElementById('addModal');
const newUrlInput   = document.getElementById('newUrlInput');
const pasteBtn      = document.getElementById('pasteBtn');
const batchPasteBtn = document.getElementById('batchPasteBtn');
const urlDetails    = document.getElementById('urlDetails');
const addConfirm    = document.getElementById('addConfirm');
const addCancel     = document.getElementById('addCancel');
const addModeSingle = document.getElementById('addModeSingle');
const addModeBatch  = document.getElementById('addModeBatch');
const addPanelSingle = document.getElementById('addPanelSingle');
const addPanelBatch  = document.getElementById('addPanelBatch');
const batchUrlInput  = document.getElementById('batchUrlInput');
const batchCount     = document.getElementById('batchCount');

const confirmModal  = document.getElementById('confirmModal');
const modalTitle    = document.getElementById('modalTitle');
const modalText     = document.getElementById('modalText');
const modalOk       = document.getElementById('modalOk');
const modalCancel   = document.getElementById('modalCancel');

const infoModal      = document.getElementById('infoModal');
const infoClose      = document.getElementById('infoClose');
const btnOpenFile    = document.getElementById('btnOpenFile');
const btnOpenFolder  = document.getElementById('btnOpenFolder');
const infName        = document.getElementById('infName');
const infType        = document.getElementById('infType');
const infMime        = document.getElementById('infMime');
const infSize        = document.getElementById('infSize');
const infRetry       = document.getElementById('infRetry');
const infHashServer  = document.getElementById('infHashServer');
const infHashSha256  = document.getElementById('infHashSha256');
const infHashLocal   = document.getElementById('infHashLocal');
let currentInfoDownloadId = null;

const scanBtn             = document.getElementById('scanBtn');
const rescanBtn           = document.getElementById('rescanBtn');
const grabList            = document.getElementById('grabList');
const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
const grabSelectAllBtn    = document.getElementById('grabSelectAllBtn');
const filterInput         = document.getElementById('filterInput');
const grabCountLabel      = document.getElementById('grabCountLabel');

const historyContainer = document.getElementById('historyContainer');
const toolClearHistory = document.getElementById('toolClearHistory');
const histStatFiles    = document.getElementById('histStatFiles');
const histStatSize     = document.getElementById('histStatSize');

let addUrlTimeout       = null;
let settingsSaveTimeout = null;
let isBatchMode         = false;

document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') e.preventDefault();
});

document.addEventListener('DOMContentLoaded', () => {
    loadManifestInfo();
    loadSettings();
    requestUpdate(true);
    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab?.dataset.tab === 'grabber') checkPageEligibility();
    setTimeout(() => updateTabSlider(document.querySelector('.tab-btn.active')), 50);
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'update_list' && msg.tasks) {
        currentTasks = msg.tasks;
        renderList(msg.tasks);
        updateToolbarState();
    }
});

function loadManifestInfo() {
    try {
        const m = chrome.runtime.getManifest();
        const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        s('appVersion',       `v${m.version}`);
        s('appDesc',          m.description);
        s('appHeaderName',    m.short_name || 'CzDM');
        s('aboutAppName',     m.short_name || 'CzDM');
        s('aboutAppFullName', m.full_name);
        s('appDeveloper',     `© ${new Date().getFullYear()} ${m.author || 'Cyberzilla'}`);
    } catch (e) {}
}

function generateRandomDeepColor() {
    const h = Math.floor(Math.random() * 360);
    const s = Math.floor(Math.random() * 40) + 60;
    const l = Math.floor(Math.random() * 25) + 15;
    return `hsl(${h}, ${s}%, ${l}%)`;
}

function applyTheme(themeValue) {
    if (themeValue !== 'glass') {
        ['--glass-color-1','--glass-color-2','--glass-color-3','--glass-color-4']
            .forEach(v => document.documentElement.style.removeProperty(v));
    }
    if (themeValue === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else if (themeValue === 'glass') {
        document.documentElement.setAttribute('data-theme', 'glass');
        ['--glass-color-1','--glass-color-2','--glass-color-3','--glass-color-4']
            .forEach(v => document.documentElement.style.setProperty(v, generateRandomDeepColor()));
    } else if (themeValue === 'light') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        window.matchMedia('(prefers-color-scheme: dark)').matches
            ? document.documentElement.setAttribute('data-theme', 'dark')
            : document.documentElement.removeAttribute('data-theme');
    }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (sTheme.value === 'auto') applyTheme('auto');
});

function loadSettings() {
    chrome.storage.local.get('settings', (res) => {
        const s = Object.assign({}, DEFAULT_SETTINGS, res.settings || {});
        sTheme.value              = s.theme;
        sDownloadLocation.value   = s.downloadLocation || 'default';
        sAutoOverride.checked     = s.autoOverride;
        sInterceptExts.value      = s.interceptExts;
        sMinSize.value            = s.minSizeMB;
        sMaxConcurrent.value      = s.maxConcurrent;
        sMaxThreads.value         = s.maxThreads;
        sNotifications.checked    = s.notifications;
        sShowPrompt.checked       = s.showPrompt;
        sShowNotification.checked = s.showPageNotification;
        sBandwidthLimit.value     = s.bandwidthLimit || 0;
        sMaxRetries.value         = s.maxRetries !== undefined ? s.maxRetries : 3;
        applyTheme(s.theme);
    });
}

function saveSettings() {
    const clamp = (v, min, max) => Math.min(Math.max(parseInt(v) || min, min), max);
    const ns = {
        theme:                sTheme.value,
        downloadLocation:     sDownloadLocation.value,
        autoOverride:         sAutoOverride.checked,
        interceptExts:        sInterceptExts.value,
        minSizeMB:            clamp(sMinSize.value,         0,      5000),
        maxConcurrent:        clamp(sMaxConcurrent.value,   1,      10),
        maxThreads:           clamp(sMaxThreads.value,      1,      16),
        notifications:        sNotifications.checked,
        showPrompt:           sShowPrompt.checked,
        showPageNotification: sShowNotification.checked,
        bandwidthLimit:       clamp(sBandwidthLimit.value,  0,      999999),
        maxRetries:           clamp(sMaxRetries.value,      0,      5)
    };
    applyTheme(ns.theme);
    chrome.storage.local.set({ settings: ns }, () => showToast('Settings Saved'));
}

[sTheme, sDownloadLocation, sAutoOverride, sMinSize, sMaxConcurrent, sMaxThreads,
    sNotifications, sShowPrompt, sShowNotification, sBandwidthLimit, sMaxRetries]
    .forEach(el => { if (el) el.addEventListener('change', saveSettings); });

if (sInterceptExts) {
    sInterceptExts.addEventListener('input', () => {
        clearTimeout(settingsSaveTimeout);
        settingsSaveTimeout = setTimeout(saveSettings, 1000);
    });
}

const tabs  = document.querySelectorAll('.tab-btn');
const panes = document.querySelectorAll('.tab-pane');

function updateTabSlider(activeTabEl) {
    if (!tabSlider || !activeTabEl) return;
    tabSlider.style.transform = `translateX(${activeTabEl.offsetLeft}px)`;
    tabSlider.style.width     = `${activeTabEl.offsetWidth}px`;
}

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panes.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
        updateTabSlider(tab);
        if (tab.dataset.tab === 'grabber') checkPageEligibility();
        if (tab.dataset.tab === 'history') loadHistory();
    });
});

function checkPageEligibility() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;
        const url     = tabs[0].url || '';
        const blocked = url.startsWith('chrome:') || url.startsWith('edge:')
            || url.startsWith('about:') || url.startsWith('https://chrome.google.com/webstore');
        const grabInit    = document.getElementById('grabberInit');
        const grabBlocked = document.getElementById('grabberBlocked');
        const grabResults = document.getElementById('grabberResults');
        if (!grabResults.classList.contains('hidden')) return;
        grabInit.classList.toggle('hidden', blocked);
        grabBlocked.classList.toggle('hidden', !blocked);
    });
}

function requestUpdate(isInit) {
    chrome.runtime.sendMessage({ action: 'get_tasks' }, (tasks) => {
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
        const row  = copyBtn.closest('.task-row');
        const task = row && currentTasks.find(t => t.id === row.dataset.id);
        if (task) { navigator.clipboard.writeText(task.url); showToast('URL Copied'); }
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
        row.classList.toggle('selected', selectedIds.has(row.dataset.id));
    });
}

function renderList(tasks) {
    if (!tasks || tasks.length === 0) {
        listContainer.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline></svg>`;
        const p = document.createElement('p');
        p.textContent = 'No downloads yet.';
        empty.appendChild(p);
        listContainer.appendChild(empty);
        selectedIds.clear();
        return;
    }

    if (listContainer.querySelector('.empty-state')) listContainer.innerHTML = '';

    const taskIds = new Set(tasks.map(t => t.id));
    Array.from(listContainer.children).forEach(row => {
        if (!taskIds.has(row.dataset.id)) { row.remove(); selectedIds.delete(row.dataset.id); }
    });

    const waitingByPriority = tasks
        .filter(t => t.status !== 'completed' && t.status !== 'error')
        .sort((a, b) => (a.priority || 0) - (b.priority || 0));

    const queuePositionMap = new Map();
    waitingByPriority.forEach((t, i) => queuePositionMap.set(t.id, i + 1));

    const queuedSorted = tasks.filter(t => t.status === 'queued')
        .sort((a, b) => (a.priority || 0) - (b.priority || 0));
    const runningTasks = tasks.filter(t => t.status === 'running');
    const avgSpeed = runningTasks.length > 0
        ? runningTasks.reduce((s, t) => s + (t.speed || 0), 0) / runningTasks.length
        : 0;

    const statusOrder = { running: 0, assembling: 0, queued: 0, paused: 0, error: 1, completed: 2 };
    const sorted = [...tasks].sort((a, b) => {
        const sa = statusOrder[a.status] ?? 3;
        const sb = statusOrder[b.status] ?? 3;
        if (sa !== sb) return sa - sb;
        return (a.priority || 0) - (b.priority || 0);
    });

    sorted.forEach((task, index) => {
        let row = document.getElementById(`task-${task.id}`);
        const isSelected = selectedIds.has(task.id);

        if (!row) {
            row = createTaskRow(task.id);
            listContainer.insertBefore(row, listContainer.children[index] || null);
        } else {
            const current = listContainer.children[index];
            if (current && current !== row) listContainer.insertBefore(row, current);
        }

        row.classList.toggle('selected', isSelected);
        updateTaskRow(row, task, avgSpeed, queuedSorted, queuePositionMap);
    });
}

function createTaskRow(taskId) {
    const row      = document.createElement('div');
    row.id         = `task-${taskId}`;
    row.dataset.id = taskId;
    row.className  = 'task-row';

    const colChk = document.createElement('div');
    colChk.className = 'col-chk';
    const chkBox = document.createElement('div');
    chkBox.className = 'chk-box';
    colChk.appendChild(chkBox);

    const icon = document.createElement('div');
    icon.className = 'row-icon';
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
        <polyline points="13 2 13 9 20 9"></polyline></svg>`;

    const details = document.createElement('div');
    details.className = 'row-details';

    const nameRow = document.createElement('div');
    nameRow.className = 'file-name-row';

    const nameEl = document.createElement('div');
    nameEl.className = 'file-name';

    const priBadge = document.createElement('span');
    priBadge.className = 'priority-badge';
    priBadge.style.display = 'none';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-url-btn';
    copyBtn.title = 'Copy URL';
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

    nameRow.appendChild(nameEl);
    nameRow.appendChild(priBadge);
    nameRow.appendChild(copyBtn);

    const progWrap = document.createElement('div');
    progWrap.className = 'progress-compact';
    const fill    = document.createElement('div');
    fill.className = 'prog-fill';
    const threads = document.createElement('div');
    threads.className  = 'prog-threads';
    threads.style.display = 'none';
    progWrap.appendChild(fill);
    progWrap.appendChild(threads);

    const meta     = document.createElement('div');
    meta.className = 'file-meta';
    const metaLeft  = document.createElement('span');
    metaLeft.className = 'meta-left';
    const metaRight = document.createElement('span');
    metaRight.className = 'meta-right status-text';
    meta.appendChild(metaLeft);
    meta.appendChild(metaRight);

    details.appendChild(nameRow);
    details.appendChild(progWrap);
    details.appendChild(meta);

    row.appendChild(colChk);
    row.appendChild(icon);
    row.appendChild(details);

    return row;
}

function updateTaskRow(row, task, avgSpeed, queuedSorted, queuePositionMap) {
    const nameEl    = row.querySelector('.file-name');
    const priBadge  = row.querySelector('.priority-badge');
    const fill      = row.querySelector('.prog-fill');
    const threadsDiv = row.querySelector('.prog-threads');
    const metaLeft  = row.querySelector('.meta-left');
    const metaRight = row.querySelector('.meta-right');

    if (nameEl.textContent !== task.filename) nameEl.textContent = task.filename;

    const isActive = task.status !== 'completed' && task.status !== 'error';
    if (isActive && queuePositionMap.has(task.id)) {
        const pos     = queuePositionMap.get(task.id);
        const newText = `#${pos}`;
        if (priBadge.textContent !== newText) priBadge.textContent = newText;
        priBadge.style.display = '';
        priBadge.className = (task.status === 'paused') ? 'priority-badge muted' : 'priority-badge';
    } else {
        priBadge.style.display = 'none';
    }

    const rawStatus    = (task.status || '').toLowerCase();
    const isComplete   = rawStatus === 'completed' || rawStatus === 'finished';
    const isRunning    = rawStatus === 'running';
    const isError      = rawStatus === 'error';
    const isPaused     = rawStatus === 'paused';
    const isAssembling = rawStatus === 'assembling';
    const isConnecting = !!task.isConnecting;

    let percent = task.total > 0 ? Math.round((task.loaded / task.total) * 100) : 0;
    if (isComplete || isAssembling) percent = 100;

    const showThreads = task.threads && task.threads.length > 1 && !isComplete && !isAssembling;

    if (isConnecting) {
        threadsDiv.style.display = 'none';
        fill.style.display       = 'block';
        fill.style.width         = '100%';
        fill.style.background    = 'linear-gradient(90deg, transparent 0%, var(--primary) 50%, transparent 100%)';
        fill.style.animation     = 'connectingShimmer 1.5s ease-in-out infinite';
    } else if (showThreads) {
        fill.style.display       = 'none';
        fill.style.animation     = '';
        threadsDiv.style.display = 'flex';

        const sortedThreads = [...task.threads].sort((a, b) => a.start - b.start);
        while (threadsDiv.children.length < sortedThreads.length) {
            const d = document.createElement('div');
            d.className = 'th-bit';
            const f = document.createElement('div');
            f.className = 'th-bit-fill';
            d.appendChild(f);
            threadsDiv.appendChild(d);
        }
        while (threadsDiv.children.length > sortedThreads.length) threadsDiv.lastChild.remove();

        const fills = threadsDiv.querySelectorAll('.th-bit-fill');
        sortedThreads.forEach((t, i) => {
            if (!fills[i]) return;
            const parent = fills[i].parentElement;
            const tot    = Math.max((t.end - t.start) + 1, 0);
            const ld     = Math.max(t.current - t.start, 0);
            const p      = t.complete ? 100 : (tot > 0 ? Math.min((ld / tot) * 100, 100) : 0);
            fills[i].style.width = `${p}%`;
            if (task.total > 0) parent.style.flex = `0 0 ${(tot / task.total) * 100}%`;
            parent.classList.toggle('merged-right', !!(t.complete && sortedThreads[i + 1]?.complete));
            fills[i].style.background = isError   ? 'var(--danger)'
                : isPaused ? 'var(--warning)' : 'var(--primary)';
        });
    } else {
        threadsDiv.style.display = 'none';
        fill.style.display       = 'block';
        fill.style.animation     = '';
        fill.style.width         = `${percent}%`;
        fill.style.background    = isError    ? 'var(--danger)'
            : isComplete  ? 'var(--success)'
                : isPaused    ? 'var(--warning)'
                    : 'var(--primary)';
    }

    let etaStr = '';
    if (isRunning && !isConnecting && task.total > 0 && percent < 100) {
        etaStr = task.remainingTime >= 0
            ? ` • ETA: ${formatTime(task.remainingTime)}`
            : ' • ETA: Calculating…';
    } else if (isComplete || isAssembling) {
        const secs = Math.floor((task.downloadDuration || 0) / 1000);
        if (secs > 0) etaStr = ` • Time: ${formatTime(secs)}`;
    } else if (rawStatus === 'queued' && avgSpeed > 0) {
        const idx = queuedSorted.findIndex(t => t.id === task.id);
        if (idx >= 0) {
            const ahead = queuedSorted.slice(0, idx)
                .reduce((s, t) => s + Math.max(t.total - t.loaded, 0), 0);
            const wait  = ahead / avgSpeed;
            if (wait > 0) etaStr = ` • Wait ~${formatTime(Math.ceil(wait))}`;
        }
    }

    const retryStr = (task.retryCount && task.retryCount > 0) ? ` • Retry ${task.retryCount}` : '';
    const newMetaLeft = `${formatBytes(task.loaded)} / ${formatBytes(task.total)} • ${percent}%${etaStr}${retryStr}`;
    if (metaLeft.textContent !== newMetaLeft) metaLeft.textContent = newMetaLeft;

    let statusText;
    if (isConnecting) {
        statusText = 'CONNECTING…';
    } else if (isRunning) {
        statusText = formatSpeed(task.speed);
    } else {
        statusText = task.status.toUpperCase();
    }
    if (metaRight.textContent !== statusText) metaRight.textContent = statusText;

    const statusClass = isConnecting ? 'connecting' : (isComplete ? 'completed' : rawStatus);
    const newClass = `meta-right status-text ${statusClass}`;
    if (metaRight.className !== newClass) metaRight.className = newClass;
}

function updateToolbarState() {
    const count  = selectedIds.size;
    const hasAny = currentTasks && currentTasks.length > 0;

    toolSelectAll.disabled = !hasAny;
    toolClear.disabled     = !hasAny;

    if (!hasAny || count === 0) {
        toolStart.disabled        = true;
        toolPause.disabled        = true;
        toolDelete.disabled       = count === 0;
        toolInfo.disabled         = true;
        toolPriorityUp.disabled   = true;
        toolPriorityDown.disabled = true;
        toolSelectAll.querySelector('span').textContent = 'Select All';
        return;
    }

    toolDelete.disabled = false;
    toolInfo.disabled   = count !== 1;

    let canStart = false, canPause = false, canMove = false;
    selectedIds.forEach(id => {
        const task = currentTasks.find(t => t.id === id);
        if (!task) return;
        const s = (task.status || '').toLowerCase();
        if (s === 'running' || s === 'assembling')  canPause = true;
        if (['paused', 'queued', 'error'].includes(s)) canStart = true;

        if (s !== 'completed' && s !== 'error') canMove = true;
    });

    toolStart.disabled        = !canStart;
    toolPause.disabled        = !canPause;
    toolPriorityUp.disabled   = !(count === 1 && canMove);
    toolPriorityDown.disabled = !(count === 1 && canMove);

    toolSelectAll.querySelector('span').textContent =
        (count === currentTasks.length) ? 'Deselect' : 'Select All';
}

toolInfo.onclick = () => {
    if (selectedIds.size !== 1) return;
    const task = currentTasks.find(t => t.id === Array.from(selectedIds)[0]);
    if (!task) return;

    const ext = task.filename.includes('.') ? task.filename.split('.').pop().toUpperCase() : 'UNKNOWN';
    infName.textContent        = task.filename;
    infType.textContent        = ext + ' File';
    infMime.textContent        = task.mime || '-';
    infSize.textContent        = formatBytes(task.total);
    infRetry.textContent       = task.retryCount ? `${task.retryCount} attempt(s)` : 'None';
    infHashServer.textContent  = task.serverHash || '-';
    infHashSha256.textContent  = task.sha256 || '-';
    infHashLocal.textContent   = task.localCrc32 || '-';

    currentInfoDownloadId = task.downloadId || null;
    const isCompleted     = task.status === 'completed' && !!currentInfoDownloadId;
    btnOpenFile.disabled   = !isCompleted;
    btnOpenFolder.disabled = !isCompleted;
    infoModal.classList.add('active');
};

infoClose.onclick     = () => infoModal.classList.remove('active');
btnOpenFile.onclick   = () => { if (currentInfoDownloadId) chrome.runtime.sendMessage({ action: 'open_file',   downloadId: currentInfoDownloadId }); };
btnOpenFolder.onclick = () => { if (currentInfoDownloadId) chrome.runtime.sendMessage({ action: 'open_folder', downloadId: currentInfoDownloadId }); };

toolSelectAll.onclick = () => {
    if (selectedIds.size === currentTasks.length && currentTasks.length > 0) selectedIds.clear();
    else currentTasks.forEach(t => selectedIds.add(t.id));
    updateSelectionVisuals();
    updateToolbarState();
};

toolDelete.onclick = () => {
    if (selectedIds.size === 0) return;
    showConfirm('Delete Items', `Delete ${selectedIds.size} task(s)?`, 'Delete', () => {
        selectedIds.forEach(id => chrome.runtime.sendMessage({ action: 'cancel_task', id }));
        showToast(`${selectedIds.size} item(s) deleted`);
        selectedIds.clear();
        updateSelectionVisuals();
        updateToolbarState();
    });
};

toolClear.onclick = () => {
    const hasHistory = currentTasks.some(t => t.status === 'completed' || t.status === 'error');
    if (!hasHistory) return showToast('No completed tasks to clear');
    showConfirm('Clear History', 'Remove all completed and failed tasks?', 'Clear All', () => {
        chrome.runtime.sendMessage({ action: 'clear_tasks' });
        selectedIds.clear();
        showToast('History cleared');
        updateSelectionVisuals();
        updateToolbarState();
    });
};

toolPause.onclick = () => selectedIds.forEach(id => chrome.runtime.sendMessage({ action: 'pause_task',  id }));

// FIX: UI memastikan toolStart tidak pernah mengirimkan perintah resume untuk file yang sudah completed.
toolStart.onclick = () => {
    selectedIds.forEach(id => {
        const task = currentTasks.find(t => t.id === id);
        if (task && (task.status === 'paused' || task.status === 'error')) {
            chrome.runtime.sendMessage({ action: 'resume_task', id });
        }
    });
};

toolPriorityUp.onclick = () => {
    if (selectedIds.size !== 1) return;
    const id = Array.from(selectedIds)[0];
    chrome.runtime.sendMessage({ action: 'move_priority', id, direction: 'up' });
    showToast('Priority increased');
};
toolPriorityDown.onclick = () => {
    if (selectedIds.size !== 1) return;
    const id = Array.from(selectedIds)[0];
    chrome.runtime.sendMessage({ action: 'move_priority', id, direction: 'down' });
    showToast('Priority decreased');
};

toolAdd.onclick = () => {
    addModal.classList.add('active');
    newUrlInput.value   = '';
    batchUrlInput.value = '';
    urlDetails.classList.add('hidden');
    addConfirm.disabled = true;
    batchCount.textContent = '0 valid URLs detected';
    switchAddMode('single');
    newUrlInput.focus();
};

addCancel.onclick    = () => addModal.classList.remove('active');
addModeSingle.onclick = () => switchAddMode('single');
addModeBatch.onclick  = () => switchAddMode('batch');

// FIX: Logic animasi saat switching tab, dan penyesuaian validasi button confirm
function switchAddMode(mode) {
    isBatchMode = mode === 'batch';
    addModeSingle.classList.toggle('active', !isBatchMode);
    addModeBatch.classList.toggle('active',   isBatchMode);

    addPanelSingle.classList.toggle('active', !isBatchMode);
    addPanelBatch.classList.toggle('active',   isBatchMode);

    addConfirm.disabled = true;
    if (isBatchMode) {
        batchUrlInput.focus();
        const urls = parseBatchUrls(batchUrlInput.value);
        if (urls.length > 0) addConfirm.disabled = false;
    } else {
        newUrlInput.focus();
        if (newUrlInput.value) triggerUrlCheck(newUrlInput.value);
    }
}

batchUrlInput.addEventListener('input', () => {
    const urls = parseBatchUrls(batchUrlInput.value);
    batchCount.textContent = `${urls.length} valid URL${urls.length !== 1 ? 's' : ''} detected`;
    addConfirm.disabled    = urls.length === 0;
});

function parseBatchUrls(text) {
    return text.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('http://') || l.startsWith('https://'))
        .slice(0, 50);
}

pasteBtn.onclick = async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (text && text.startsWith('http')) {
            newUrlInput.value = text;
            triggerUrlCheck(text);
            showToast('URL Pasted');
        }
    } catch (e) {}
};

// FIX: Menambahkan aksi untuk Batch Paste Button
batchPasteBtn.onclick = async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            const currentVal = batchUrlInput.value.trim();
            batchUrlInput.value = currentVal ? currentVal + '\n' + text : text;

            const urls = parseBatchUrls(batchUrlInput.value);
            batchCount.textContent = `${urls.length} valid URL${urls.length !== 1 ? 's' : ''} detected`;
            addConfirm.disabled    = urls.length === 0;

            showToast('URLs Pasted');
            batchUrlInput.focus();
        }
    } catch (e) {}
};

newUrlInput.addEventListener('input', (e) => triggerUrlCheck(e.target.value));

function triggerUrlCheck(url) {
    if (addUrlTimeout) clearTimeout(addUrlTimeout);
    urlDetails.classList.add('hidden');
    addConfirm.disabled = true;
    if (!url || !url.startsWith('http')) return;

    addUrlTimeout = setTimeout(() => {
        urlDetails.classList.remove('hidden');
        urlDetails.innerHTML = '';
        const checking = document.createElement('div');
        checking.className = 'detail-row';
        const span = document.createElement('span');
        span.textContent = 'Checking…';
        checking.appendChild(span);
        urlDetails.appendChild(checking);

        chrome.runtime.sendMessage({ action: 'check_url', url }, (res) => {
            urlDetails.innerHTML = '';
            const addRow = (label, value) => {
                const row  = document.createElement('div');
                row.className = 'detail-row';
                const lEl  = document.createElement('span');
                lEl.className = 'label';
                lEl.textContent = label + ':';
                const vEl  = document.createElement('span');
                vEl.className = 'value';
                vEl.textContent = value;
                row.appendChild(lEl);
                row.appendChild(vEl);
                urlDetails.appendChild(row);
            };
            if (res && res.success) {
                addRow('File', res.filename);
                addRow('Size', formatBytes(res.size));
                addRow('Type', res.mime || '-');
                if (res.sha256 && res.sha256 !== '-') addRow('SHA-256', res.sha256.slice(0, 16) + '…');
                addConfirm.disabled = false;
            } else {
                const errRow  = document.createElement('div');
                errRow.className = 'detail-row';
                const lEl = document.createElement('span');
                lEl.className = 'label';
                lEl.style.color = 'var(--danger)';
                lEl.textContent = 'Error:';
                const vEl = document.createElement('span');
                vEl.className = 'value';
                vEl.textContent = 'Check failed — URL may be invalid or unreachable.';
                errRow.appendChild(lEl);
                errRow.appendChild(vEl);
                urlDetails.appendChild(errRow);
            }
        });
    }, 500);
}

addConfirm.onclick = () => {
    if (isBatchMode) {
        const urls = parseBatchUrls(batchUrlInput.value);
        if (!urls.length) return;
        chrome.runtime.sendMessage({ action: 'add_batch_tasks', urls });
        addModal.classList.remove('active');
        showToast(`${urls.length} task(s) added to queue`);
        document.querySelector('[data-tab="dashboard"]').click();
    } else {
        if (!newUrlInput.value) return;
        chrome.runtime.sendMessage({ action: 'add_task', url: newUrlInput.value });
        addModal.classList.remove('active');
        showToast('Added to queue');
    }
};

function loadHistory() {
    historyContainer.innerHTML = '';
    const loading = document.createElement('div');
    loading.className = 'empty-state';
    const lp = document.createElement('p');
    lp.textContent = 'Loading…';
    loading.appendChild(lp);
    historyContainer.appendChild(loading);

    chrome.runtime.sendMessage({ action: 'get_history' }, (history) => {
        historyContainer.innerHTML = '';
        if (!history || history.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            const p = document.createElement('p');
            p.textContent = 'No download history yet.';
            empty.appendChild(p);
            historyContainer.appendChild(empty);
            histStatFiles.textContent = '0 files';
            histStatSize.textContent  = '0 B total';
            return;
        }

        const totalSize = history.reduce((s, h) => s + (h.size || 0), 0);
        histStatFiles.textContent = `${history.length} file${history.length !== 1 ? 's' : ''}`;
        histStatSize.textContent  = `${formatBytes(totalSize)} total`;

        const frag = document.createDocumentFragment();
        history.forEach(entry => {
            const row = document.createElement('div');
            row.className = 'hist-row';

            const icon = document.createElement('div');
            icon.className = 'hist-icon';
            icon.innerHTML = entry.status === 'completed'
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;

            const details = document.createElement('div');
            details.className = 'hist-details';

            const name = document.createElement('div');
            name.className   = 'hist-name';
            name.textContent = entry.filename;

            const meta = document.createElement('div');
            meta.className   = 'hist-meta';
            const date       = new Date(entry.timestamp).toLocaleString();
            const dur        = entry.duration ? formatTime(Math.floor(entry.duration / 1000)) : '-';
            const retry      = entry.retryCount > 0 ? ` • ${entry.retryCount} retry` : '';
            meta.textContent = `${date} • ${formatBytes(entry.size)} • ${dur}${retry}`;

            details.appendChild(name);
            details.appendChild(meta);

            if (entry.localCrc32 && entry.localCrc32 !== '-') {
                const hash       = document.createElement('div');
                hash.className   = 'hist-hash';
                hash.textContent = `CRC32: ${entry.localCrc32}`;
                details.appendChild(hash);
            }

            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-url-btn';
            copyBtn.title     = 'Copy URL';
            copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
            copyBtn.onclick = () => { navigator.clipboard.writeText(entry.url); showToast('URL Copied'); };

            row.appendChild(icon);
            row.appendChild(details);
            row.appendChild(copyBtn);
            frag.appendChild(row);
        });
        historyContainer.appendChild(frag);
    });
}

toolClearHistory.onclick = () => {
    showConfirm('Clear History', 'Delete all download history permanently?', 'Clear', () => {
        chrome.runtime.sendMessage({ action: 'clear_history' });
        loadHistory();
        showToast('Download history cleared');
    });
};

function updateGrabberToolbarState() {
    const rows   = Array.from(grabList.querySelectorAll('.grab-row'));
    const allSel = rows.length > 0 && rows.every(r => r.classList.contains('selected'));
    grabSelectAllBtn.querySelector('span').textContent = allSel ? 'Deselect' : 'Select All';
}

function queueCheckItemSize(item, row) {
    if (item.cachedSize !== undefined || item.isChecking) return;
    item.isChecking = true;
    const sizeEl = row.querySelector('.grab-size-info');
    if (sizeEl) sizeEl.textContent = 'Wait…';
    checkQueue.push({ item, row });
    processCheckQueue();
}

function processCheckQueue() {
    if (isCheckingQueue || checkQueue.length === 0) return;
    isCheckingQueue = true;
    const batch = checkQueue.splice(0, 5);
    Promise.all(batch.map(({ item, row }) => new Promise(resolve => {
        const sizeEl  = row.querySelector('.grab-size-info');
        const checkEl = row.querySelector('.grab-checksum');
        if (sizeEl) sizeEl.textContent = 'Checking…';
        chrome.runtime.sendMessage({ action: 'check_url', url: item.url }, (res) => {
            if (res && res.success) {
                item.cachedSize     = res.size;
                item.cachedChecksum = res.checksum;
                if (sizeEl)  sizeEl.textContent  = formatBytes(res.size);
                if (checkEl && res.checksum && res.checksum !== '-')
                    checkEl.textContent = `• Hash: ${res.checksum}`;
            } else {
                item.cachedSize     = 'unknown';
                item.cachedChecksum = '-';
                if (sizeEl)  sizeEl.textContent  = 'Unknown';
                if (checkEl) checkEl.textContent = '';
            }
            resolve();
        });
    }))).then(() => { isCheckingQueue = false; processCheckQueue(); });
}

grabList.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-url-btn');
    if (copyBtn) {
        const row = copyBtn.closest('.grab-row');
        if (row?.dataset.url) { navigator.clipboard.writeText(row.dataset.url); showToast('URL Copied'); }
        return;
    }
    const row  = e.target.closest('.grab-row');
    if (!row) return;
    const url  = row.dataset.url;
    const item = grabberLinks.find(i => i.url === url);
    if (e.target.closest('.col-chk')) {
        row.classList.toggle('selected');
        if (!row.classList.contains('selected')) {
            checkQueue = checkQueue.filter(q => { if (q.row === row) { q.item.isChecking = false; return false; } return true; });
        } else if (item) {
            queueCheckItemSize(item, row);
        }
    } else {
        grabList.querySelectorAll('.grab-row.selected').forEach(r => r.classList.remove('selected'));
        checkQueue.forEach(q => { q.item.isChecking = false; });
        checkQueue = [];
        row.classList.add('selected');
        if (item) queueCheckItemSize(item, row);
    }
    updateGrabberToolbarState();
});

function renderGrab(items) {
    grabList.innerHTML = '';
    grabCountLabel.textContent = `Found: ${items.length}`;
    grabSelectAllBtn.querySelector('span').textContent = 'Select All';

    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        const p = document.createElement('p');
        p.textContent = 'No media found.';
        empty.appendChild(p);
        grabList.appendChild(empty);
        return;
    }

    const frag = document.createDocumentFragment();
    items.forEach(item => {
        let filename = item.url.split('/').pop().split('?')[0];
        try { filename = decodeURIComponent(filename); } catch (e) {}
        if (!filename || !filename.trim()) filename = 'unknown_file';

        const row      = document.createElement('div');
        row.className  = 'grab-row';
        row.dataset.url = item.url;

        const colChk = document.createElement('div');
        colChk.className = 'col-chk';
        const chkBox = document.createElement('div');
        chkBox.className = 'chk-box';
        colChk.appendChild(chkBox);

        const icon = document.createElement('div');
        icon.className = 'row-icon';
        icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"></rect>
            <polyline points="21 15 16 10 5 21"></polyline></svg>`;

        const details = document.createElement('div');
        details.className = 'row-details';

        const nameRow = document.createElement('div');
        nameRow.className = 'file-name-row';
        const nameEl  = document.createElement('div');
        nameEl.className   = 'file-name';
        nameEl.textContent = filename;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-url-btn';
        copyBtn.title     = 'Copy URL';
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        nameRow.appendChild(nameEl);
        nameRow.appendChild(copyBtn);

        const metaRow = document.createElement('div');
        metaRow.className = 'grab-meta-row';
        const sizeEl  = document.createElement('span');
        sizeEl.className = 'grab-size-info';
        const checkEl = document.createElement('span');
        checkEl.className = 'grab-checksum';
        const urlSub  = document.createElement('span');
        urlSub.className   = 'grab-url-sub';
        urlSub.textContent = `• ${item.url}`;

        if (item.cachedSize === 'unknown') sizeEl.textContent = 'Unknown';
        else if (item.cachedSize !== undefined) sizeEl.textContent = formatBytes(item.cachedSize);
        else if (item.isChecking) sizeEl.textContent = 'Wait…';
        else sizeEl.textContent = '-';

        checkEl.textContent = (item.cachedChecksum && item.cachedChecksum !== '-')
            ? `• Hash: ${item.cachedChecksum}` : '';

        metaRow.appendChild(sizeEl);
        metaRow.appendChild(checkEl);
        metaRow.appendChild(urlSub);
        details.appendChild(nameRow);
        details.appendChild(metaRow);
        row.appendChild(colChk);
        row.appendChild(icon);
        row.appendChild(details);
        frag.appendChild(row);
    });
    grabList.appendChild(frag);
    updateGrabberToolbarState();
}

function applyCurrentFilter() {
    const val = filterInput.value.toLowerCase();
    if (!val) return renderGrab(grabberLinks);
    renderGrab(grabberLinks.filter(i =>
        (i.url.split('/').pop() || '').toLowerCase().includes(val) || i.url.toLowerCase().includes(val)));
}

filterInput.addEventListener('input', applyCurrentFilter);
scanBtn.onclick   = performScan;
rescanBtn.onclick = performScan;

grabSelectAllBtn.onclick = () => {
    const rows   = grabList.querySelectorAll('.grab-row');
    const allSel = Array.from(rows).every(r => r.classList.contains('selected'));
    if (allSel) {
        rows.forEach(r => r.classList.remove('selected'));
        checkQueue.forEach(({ item }) => { item.isChecking = false; });
        checkQueue = [];
    } else {
        rows.forEach(r => {
            r.classList.add('selected');
            const item = grabberLinks.find(i => i.url === r.dataset.url);
            if (item) queueCheckItemSize(item, r);
        });
    }
    updateGrabberToolbarState();
};

downloadSelectedBtn.onclick = () => {
    const urls = Array.from(grabList.querySelectorAll('.grab-row.selected')).map(r => r.dataset.url);
    if (!urls.length) return showToast('Select files first');
    chrome.runtime.sendMessage({ action: 'add_batch_tasks', urls });
    document.querySelector('[data-tab="dashboard"]').click();
    showToast(`${urls.length} task(s) added`);
};

async function performScan() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    checkQueue      = [];
    isCheckingQueue = false;
    document.getElementById('grabberInit').classList.add('hidden');
    document.getElementById('grabberResults').classList.remove('hidden');
    grabList.innerHTML = '';
    const loading = document.createElement('div');
    loading.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = 'Scanning…';
    loading.appendChild(p);
    grabList.appendChild(loading);

    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }, (results) => {
        if (!chrome.runtime.lastError && results && results[0]) {
            grabberLinks = (results[0].result || []).map(link => ({
                ...link, cachedSize: undefined, isChecking: false, cachedChecksum: '-'
            }));
            applyCurrentFilter();
        }
    });
}

function formatBytes(bytes) {
    if (!+bytes || bytes <= 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatSpeed(s) {
    return (!s || s < 0) ? '0 B/s' : formatBytes(s) + '/s';
}

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return 'Calculating…';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function showToast(msg) {
    const t = document.createElement('div');
    t.className   = 'toast';
    t.textContent = msg;
    toastContainer.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

function showConfirm(title, text, btnText, cb) {
    if (!confirmModal) return;
    modalTitle.textContent = title;
    modalText.textContent  = text;
    modalOk.textContent    = btnText;
    modalOk.classList.add('confirm');
    confirmModal.classList.add('active');
    const cleanup = () => {
        confirmModal.classList.remove('active');
        modalOk.classList.remove('confirm');
        modalOk.onclick    = null;
        modalCancel.onclick = null;
    };
    modalOk.onclick     = () => { cb(); cleanup(); };
    modalCancel.onclick = () => cleanup();
}