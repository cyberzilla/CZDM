// NONAKTIFKAN KLIK KANAN (Kecuali pada Input Text)
document.addEventListener('contextmenu', (event) => {
    if (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') {
        event.preventDefault();
    }
});

let selectedIds = new Set();
let currentTasks = [];

// --- DOM ELEMENTS ---
const listContainer = document.getElementById('listContainer');
const loadingOverlay = document.getElementById('loadingOverlay');
const toastContainer = document.getElementById('toastContainer');

// Buttons
const toolAdd = document.getElementById('toolAdd');
const toolStart = document.getElementById('toolStart');
const toolPause = document.getElementById('toolPause');
const toolDelete = document.getElementById('toolDelete');
const toolSelectAll = document.getElementById('toolSelectAll');
const toolClear = document.getElementById('toolClear');

// Modal
const addModal = document.getElementById('addModal');
const newUrlInput = document.getElementById('newUrlInput');
const pasteBtn = document.getElementById('pasteBtn');
const urlDetails = document.getElementById('urlDetails');
const addConfirm = document.getElementById('addConfirm');
const addCancel = document.getElementById('addCancel');
let addUrlTimeout = null;

// Grabber
const scanBtn = document.getElementById('scanBtn');
const rescanBtn = document.getElementById('rescanBtn');
const grabList = document.getElementById('grabList');
const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
const grabSelectAllBtn = document.getElementById('grabSelectAllBtn');
const filterInput = document.getElementById('filterInput');
const grabCountLabel = document.getElementById('grabCountLabel');

// About
const appVersion = document.getElementById('appVersion');
const appDesc = document.getElementById('appDesc');

// INIT
document.addEventListener('DOMContentLoaded', () => {
  loadManifestInfo();
  requestUpdate(true);
  setInterval(() => requestUpdate(false), 1000);
  
  const activeTab = document.querySelector('.tab-btn.active');
  if(activeTab && activeTab.dataset.tab === 'grabber') checkPageEligibility();
});

function loadManifestInfo() {
    try {
        const manifest = chrome.runtime.getManifest();
        if(appVersion) appVersion.innerText = `v${manifest.version}`;
        if(appDesc) appDesc.innerText = manifest.description;
    } catch (e) { console.error("Manifest error", e); }
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

        if (isBlocked) { grabInit.classList.add('hidden'); grabBlocked.classList.remove('hidden'); } 
        else { grabBlocked.classList.add('hidden'); grabInit.classList.remove('hidden'); }
    });
}

function requestUpdate(isInit) {
  chrome.runtime.sendMessage({ action: "get_tasks" }, (tasks) => {
    if (isInit) setTimeout(() => { if(loadingOverlay) loadingOverlay.style.display = 'none'; }, 300);
    else if(loadingOverlay && loadingOverlay.style.display !== 'none') loadingOverlay.style.display = 'none';

    if (!chrome.runtime.lastError && tasks) {
        currentTasks = tasks;
        renderList(tasks);
        updateToolbarState();
    }
  });
}

// --- RENDER DASHBOARD ---
function renderList(tasks) {
  if(!tasks || tasks.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
        <p>No downloads yet.</p>
      </div>`;
    return;
  }
  
  if(listContainer.querySelector('.empty-state') || listContainer.querySelector('.empty-placeholder')) {
      listContainer.innerHTML = '';
  }

  const taskIds = new Set(tasks.map(t => t.id));
  Array.from(listContainer.children).forEach(row => { if (row.dataset.id && !taskIds.has(row.dataset.id)) row.remove(); });
  for (let id of selectedIds) { if (!taskIds.has(id)) selectedIds.delete(id); }

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
            <div class="file-name">${task.filename}</div>
            <div class="progress-compact">
                <div class="prog-fill"></div>
                <div class="prog-threads" style="display:none"></div>
            </div>
            <div class="file-meta">
                <span class="meta-left">Waiting...</span>
                <span class="meta-right status-text">QUEUED</span>
            </div>
          </div>
        `;
        row.addEventListener('click', () => toggleSelection(task.id));
        const ref = listContainer.children[index];
        listContainer.insertBefore(row, ref);
    } else {
         if (Array.from(listContainer.children).indexOf(row) !== index) listContainer.insertBefore(row, listContainer.children[index]);
    }

    if (row.classList.contains('selected') !== isSelected) row.className = `task-row ${isSelected ? 'selected' : ''}`;

    const nameEl = row.querySelector('.file-name');
    if (nameEl.innerText !== task.filename) nameEl.innerText = task.filename;

    let percent = 0;
    if(task.total > 0) percent = Math.round((task.loaded / task.total) * 100);
    if(task.status === 'assembling' || task.status === 'completed') percent = 100;

    const fill = row.querySelector('.prog-fill');
    
    // VISUAL FIX: Hide main bar if multi-thread active
    if (task.status === 'running' && task.threads && task.threads.length > 1) {
        fill.style.display = 'none'; 
    } else {
        fill.style.display = 'block'; 
        fill.style.width = `${percent}%`;
        fill.style.background = (task.status === 'error') ? 'var(--danger)' : 
                                (task.status === 'completed') ? 'var(--success)' : 
                                (task.status === 'paused') ? 'var(--warning)' : 'var(--primary)';
    }

    const metaLeft = row.querySelector('.meta-left');
    const metaRight = row.querySelector('.meta-right');
    const sizeStr = formatBytes(task.total); 
    
    metaRight.className = `meta-right status-text ${task.status}`;

    if (task.status === 'completed') {
        metaLeft.innerText = sizeStr; 
        metaRight.innerText = "COMPLETED";
        row.querySelector('.prog-threads').style.display = 'none';
        fill.style.display = 'block';
        fill.style.width = '100%';
        fill.style.background = 'var(--success)';

    } else if (task.status === 'running') {
        const loadedStr = formatBytes(task.loaded);
        metaLeft.innerText = `${loadedStr} / ${sizeStr} • ${percent}%`;
        metaRight.innerText = formatSpeed(task.speed);
        
        const threadsDiv = row.querySelector('.prog-threads');
        if(task.threads && task.threads.length > 1) {
             threadsDiv.style.display = 'flex';
             while(threadsDiv.children.length < task.threads.length) {
                 const d = document.createElement('div'); d.className='th-bit';
                 d.appendChild(document.createElement('div')).className='th-bit-fill';
                 threadsDiv.appendChild(d);
             }
             const fills = threadsDiv.querySelectorAll('.th-bit-fill');
             task.threads.forEach((t, i) => {
                 if(fills[i]) {
                     const tot = t.end - t.start;
                     const ld = t.current - t.start;
                     let p = tot > 0 ? (ld/tot)*100 : 0;
                     if(t.complete) p = 100;
                     fills[i].style.width = `${p}%`;
                 }
             });
        } else {
            row.querySelector('.prog-threads').style.display = 'none';
        }
    } else {
        metaLeft.innerText = `${formatBytes(task.loaded)} / ${sizeStr} • ${percent}%`;
        metaRight.innerText = task.status.toUpperCase();
        row.querySelector('.prog-threads').style.display = 'none';
    }
  });
}

function toggleSelection(id) {
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    renderList(currentTasks); updateToolbarState();
}

function updateToolbarState() {
    const count = selectedIds.size;
    if (count === 0) { 
        toolStart.disabled = true; toolPause.disabled = true; toolDelete.disabled = true; 
        toolSelectAll.querySelector('span').innerText = "Select All"; 
        return; 
    }
    toolDelete.disabled = false;
    let hasRunning = false; let hasPaused = false;
    selectedIds.forEach(id => { const t = currentTasks.find(x => x.id === id); if (t) { if (t.status === 'running') hasRunning = true; if (t.status === 'paused' || t.status === 'queued' || t.status === 'error') hasPaused = true; } });
    toolPause.disabled = !hasRunning; toolStart.disabled = !hasPaused;
    toolSelectAll.querySelector('span').innerText = (count === currentTasks.length) ? "Deselect" : "Select All";
}

toolSelectAll.onclick = () => { if (selectedIds.size === currentTasks.length) selectedIds.clear(); else currentTasks.forEach(t => selectedIds.add(t.id)); renderList(currentTasks); updateToolbarState(); };
toolDelete.onclick = () => { showConfirm('Delete Items?', `Delete ${selectedIds.size} tasks?`, 'Delete', () => { selectedIds.forEach(id => chrome.runtime.sendMessage({ action: 'cancel_task', id: id })); selectedIds.clear(); showToast('Items deleted'); }); };
toolPause.onclick = () => { selectedIds.forEach(id => { const t = currentTasks.find(x => x.id === id); if (t && t.status === 'running') chrome.runtime.sendMessage({ action: 'pause_task', id: id }); }); };
toolStart.onclick = () => { selectedIds.forEach(id => { const t = currentTasks.find(x => x.id === id); if (t && t.status !== 'running' && t.status !== 'completed') chrome.runtime.sendMessage({ action: 'resume_task', id: id }); }); };
toolClear.onclick = () => {
    const hasCompletedOrError = currentTasks.some(t => t.status === 'completed' || t.status === 'error');
    if (!hasCompletedOrError) { showToast('No history to clear.'); return; }
    showConfirm('Clear History?', 'Remove all completed/failed tasks?', 'Clear', () => {
        chrome.runtime.sendMessage({ action: "clear_tasks" }); showToast('History cleared');
    });
};

toolAdd.onclick = () => {
    addModal.classList.add('active'); newUrlInput.value = ''; urlDetails.classList.add('hidden'); addConfirm.disabled = true; newUrlInput.focus();
};
addCancel.onclick = () => addModal.classList.remove('active');
newUrlInput.addEventListener('input', (e) => triggerUrlCheck(e.target.value));

pasteBtn.onclick = async () => {
    try {
        newUrlInput.focus(); 
        const text = await navigator.clipboard.readText();
        if (text && text.startsWith('http')) {
            newUrlInput.value = text;
            triggerUrlCheck(text);
            showToast('URL Pasted');
        } else {
            showToast('Clipboard invalid');
        }
    } catch (err) {
        showToast('Clipboard error');
    }
};

function triggerUrlCheck(url) {
    if (addUrlTimeout) clearTimeout(addUrlTimeout);
    urlDetails.classList.add('hidden');
    addConfirm.disabled = true;
    if (!url || !url.startsWith('http')) return;

    addUrlTimeout = setTimeout(() => {
        urlDetails.classList.remove('hidden');
        urlDetails.innerHTML = ''; 
        const addRow = (lbl, val) => {
            const r = document.createElement('div'); r.className='detail-row';
            r.innerHTML = `<span class="label">${lbl}:</span><span class="value">${val}</span>`;
            urlDetails.appendChild(r);
        };
        addRow("Status", "Checking...");

        chrome.runtime.sendMessage({ action: 'check_url', url: url }, (res) => {
            urlDetails.innerHTML = ''; 
            if (res && res.success) {
                addRow("File", res.filename);
                addRow("Size", formatBytes(res.size));
                addRow("Type", res.mime || '-'); 
                if(res.checksum && res.checksum !== '-') addRow("ETag", res.checksum); 
                addConfirm.disabled = false;
            } else {
                addRow("Error", "Check Failed");
                addConfirm.disabled = false; 
            }
        });
    }, 500);
}

addConfirm.onclick = () => {
    const url = newUrlInput.value;
    if (url) { chrome.runtime.sendMessage({ action: "add_task", url: url }); addModal.classList.remove('active'); showToast('Added to queue'); }
};

// GRABBER LOGIC
async function performScan() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    document.getElementById('grabberInit').classList.add('hidden');
    document.getElementById('grabberResults').classList.remove('hidden');
    grabList.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg><p>Scanning...</p></div>';
    grabCountLabel.innerText = "Found: 0";

    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }, (results) => {
        if (chrome.runtime.lastError || !results || !results[0]) {
            grabList.innerHTML = '<div class="empty-state" style="color:var(--danger)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><p>Access Denied</p></div>'; return;
        }
        const links = results[0].result || [];
        grabCountLabel.innerText = `Found: ${links.length}`;
        renderGrab(links);
        
        filterInput.oninput = (e) => {
            const val = e.target.value.toLowerCase();
            const filtered = links.filter(i => i.text.toLowerCase().includes(val) || i.url.toLowerCase().includes(val));
            renderGrab(filtered);
            grabCountLabel.innerText = `Found: ${filtered.length}`;
        };

        let allSelected = false;
        grabSelectAllBtn.onclick = () => {
            allSelected = !allSelected;
            const rows = document.querySelectorAll('.grab-row');
            rows.forEach(r => {
                if(allSelected) r.classList.add('selected');
                else r.classList.remove('selected');
            });
            grabSelectAllBtn.querySelector('span').innerText = allSelected ? "Deselect" : "Select All";
        };
        
        downloadSelectedBtn.onclick = () => {
            const selectedRows = document.querySelectorAll('.grab-row.selected');
            const urls = Array.from(selectedRows).map(r => r.dataset.url);
            if (urls.length === 0) return showToast('Select files first');
            chrome.runtime.sendMessage({ action: "add_batch_tasks", urls });
            document.querySelector('[data-tab="dashboard"]').click();
            showToast(`${urls.length} added`);
        };
    });
}

function renderGrab(items) {
    grabList.innerHTML = '';
    if (!items.length) {
        grabList.innerHTML = `
          <div class="empty-state">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
             <p>No media found on page.</p>
          </div>`;
        return;
    }
    
    items.forEach(i => {
        const row = document.createElement('div'); 
        row.className = 'grab-row';
        row.dataset.url = i.url;
        
        let iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path></svg>`;
        if (i.type === 'image') iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;

        row.innerHTML = `
           <div class="col-chk"><div class="chk-box"></div></div>
           <div class="row-icon" style="color:var(--primary)">${iconSvg}</div>
           <div class="row-details">
                <div class="file-name">${i.text}</div>
                <div class="grab-url">${i.url}</div>
           </div>
        `;

        row.addEventListener('click', () => {
             row.classList.toggle('selected');
        });

        grabList.appendChild(row);
    });
}

if(scanBtn) scanBtn.addEventListener('click', performScan);
if(rescanBtn) rescanBtn.addEventListener('click', performScan);

// UTILS
function formatBytes(bytes) { if (!+bytes) return '0 B'; const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`; }
function formatSpeed(s) { return (!s || s<0) ? '0 B/s' : formatBytes(s) + '/s'; }
function showToast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.innerText = msg; toastContainer.appendChild(t); setTimeout(() => t.remove(), 2500); }
function showConfirm(title, text, btnText, cb) { const m = document.getElementById('confirmModal'); document.getElementById('modalTitle').innerText = title; document.getElementById('modalText').innerText = text; document.getElementById('modalOk').innerText = btnText; m.classList.add('active'); document.getElementById('modalOk').onclick = () => { cb(); m.classList.remove('active'); }; document.getElementById('modalCancel').onclick = () => m.classList.remove('active'); }