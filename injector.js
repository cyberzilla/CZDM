chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "show_page_notification") {
        chrome.storage.local.get('settings', (res) => {
            const theme = res.settings?.theme || 'auto';
            showCzdmNotification(request.url, request.filename, theme);
        });
        sendResponse({status: "ok"});
    } else if (request.action === "show_page_prompt") {
        chrome.storage.local.get('settings', (res) => {
            const theme = res.settings?.theme || 'auto';
            showCzdmPrompt(request.url, request.filename, request.fileSize, theme, sendResponse);
        });
        return true;
    }
});

// Mengekstrak nama dari Chrome langsung, atau mem-fallback dengan elegan untuk URL G-Drive
function extractCzdmFilename(url, providedName) {
    if (providedName && providedName !== 'Pending...' && providedName !== 'Google Drive File') {
        return providedName.replace(/^.*[\\\/]/, ''); // Menghapus format path 'C:\...' jika ada
    }
    if (!url) return 'Unknown File';
    try {
        if (url.includes('drive.google.com')) return 'Google Drive Document';
        let name = url.split('/').pop().split('?')[0];
        name = decodeURIComponent(name);
        return name || 'Unknown File';
    } catch(e) {
        return 'Unknown File';
    }
}

function formatBytes(bytes) {
    if (!+bytes || bytes <= 0) return 'Unknown Size';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function getThemeStyles(themeMode) {
    const isDarkOS = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = themeMode === 'dark' || (themeMode === 'auto' && isDarkOS) || (themeMode === 'glass' && isDarkOS);

    if (themeMode === 'glass') {
        return {
            bg: isDark ? 'rgba(30, 41, 59, 0.65)' : 'rgba(255, 255, 255, 0.7)',
            text: isDark ? '#f8fafc' : '#0f172a',
            subText: isDark ? '#94a3b8' : '#64748b',
            border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)',
            backdrop: 'blur(16px)',
            overlayBg: 'rgba(15, 23, 42, 0.4)'
        };
    }

    if (isDark) {
        return {
            bg: '#1e293b',
            text: '#f8fafc',
            subText: '#94a3b8',
            border: '1px solid #334155',
            backdrop: 'none',
            overlayBg: 'rgba(15, 23, 42, 0.7)'
        };
    } else {
        return {
            bg: '#ffffff',
            text: '#0f172a',
            subText: '#64748b',
            border: '1px solid #e2e8f0',
            backdrop: 'none',
            overlayBg: 'rgba(15, 23, 42, 0.4)'
        };
    }
}

function showCzdmNotification(url, providedFilename, themeMode) {
    const filename = extractCzdmFilename(url, providedFilename);
    const style = getThemeStyles(themeMode);

    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${style.bg};
        color: ${style.text};
        padding: 16px 20px;
        border-radius: 8px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        border: ${style.border};
        backdrop-filter: ${style.backdrop};
        -webkit-backdrop-filter: ${style.backdrop};
        z-index: 2147483647;
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        align-items: center;
        gap: 16px;
        border-left: 4px solid #3b82f6;
        transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.4s ease;
        transform: translateX(150%);
        opacity: 0;
        pointer-events: none;
    `;

    const iconDiv = document.createElement('div');
    iconDiv.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
    `;
    iconDiv.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(59, 130, 246, 0.15);
        padding: 8px;
        border-radius: 50%;
    `;

    const textContainer = document.createElement('div');
    textContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        overflow: hidden;
        max-width: 280px;
    `;

    const titleObj = document.createElement('span');
    titleObj.innerText = 'Added to CzDM';
    titleObj.style.cssText = `
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 4px;
        color: ${style.text};
        line-height: 1.2;
    `;

    const fileObj = document.createElement('span');
    fileObj.innerText = filename;
    fileObj.style.cssText = `
        font-size: 12px;
        color: ${style.subText};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.2;
    `;

    textContainer.appendChild(titleObj);
    textContainer.appendChild(fileObj);

    container.appendChild(iconDiv);
    container.appendChild(textContainer);

    document.body.appendChild(container);

    requestAnimationFrame(() => {
        container.style.transform = 'translateX(0)';
        container.style.opacity = '1';
    });

    setTimeout(() => {
        container.style.transform = 'translateX(150%)';
        container.style.opacity = '0';
        setTimeout(() => {
            if (container.parentNode) container.parentNode.removeChild(container);
        }, 400);
    }, 3500);
}

function showCzdmPrompt(url, providedFilename, fileSize, themeMode, sendResponse) {
    const filename = extractCzdmFilename(url, providedFilename);
    const displaySize = formatBytes(fileSize);
    const style = getThemeStyles(themeMode);

    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: ${style.overlayBg}; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
        z-index: 2147483647; display: flex; align-items: center; justify-content: center;
        font-family: system-ui, -apple-system, sans-serif;
        opacity: 0; transition: opacity 0.3s ease;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: ${style.bg}; color: ${style.text}; padding: 24px; border-radius: 12px;
        width: 90%; max-width: 400px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
        border: ${style.border}; backdrop-filter: ${style.backdrop}; -webkit-backdrop-filter: ${style.backdrop};
        transform: translateY(20px); transition: transform 0.3s ease;
    `;

    const title = document.createElement('h3');
    title.style.cssText = 'margin: 0 0 16px 0; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 8px;';
    title.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Download with CzDM?
    `;

    const infoBox = document.createElement('div');
    infoBox.style.cssText = `
        background: ${themeMode === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.2)'};
        padding: 12px; border-radius: 8px; margin-bottom: 24px;
        border: ${style.border};
    `;

    const fileRow = document.createElement('div');
    fileRow.style.cssText = 'display: flex; margin-bottom: 8px; font-size: 13px;';
    fileRow.innerHTML = `<span style="color: ${style.subText}; width: 45px; flex-shrink: 0;">File:</span> <span style="font-weight: 500; word-break: break-all;">${filename}</span>`;

    const sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display: flex; font-size: 13px;';
    sizeRow.innerHTML = `<span style="color: ${style.subText}; width: 45px; flex-shrink: 0;">Size:</span> <span style="font-weight: 500; color: #3b82f6;">${displaySize}</span>`;

    infoBox.appendChild(fileRow);
    infoBox.appendChild(sizeRow);

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 12px;';

    const btnCancel = document.createElement('button');
    btnCancel.innerText = 'Cancel';
    btnCancel.style.cssText = `
        padding: 8px 16px; border: 1px solid ${themeMode === 'light' ? '#cbd5e1' : '#475569'};
        border-radius: 6px; background: transparent; color: ${style.text}; font-weight: 500; cursor: pointer; transition: background 0.2s;
    `;
    btnCancel.onmouseover = () => btnCancel.style.background = themeMode === 'light' ? '#f1f5f9' : '#334155';
    btnCancel.onmouseout = () => btnCancel.style.background = 'transparent';
    btnCancel.onclick = () => { closePrompt(false); };

    const btnOk = document.createElement('button');
    btnOk.innerText = 'Download';
    btnOk.style.cssText = 'padding: 8px 16px; border: none; border-radius: 6px; background: #3b82f6; color: #ffffff; font-weight: 500; cursor: pointer; transition: background 0.2s;';
    btnOk.onmouseover = () => btnOk.style.background = '#2563eb';
    btnOk.onmouseout = () => btnOk.style.background = '#3b82f6';
    btnOk.onclick = () => { closePrompt(true); };

    function closePrompt(isDownload) {
        overlay.style.opacity = '0';
        dialog.style.transform = 'translateY(20px)';
        setTimeout(() => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            sendResponse({ download: isDownload });
        }, 300);
    }

    btnContainer.appendChild(btnCancel);
    btnContainer.appendChild(btnOk);
    dialog.appendChild(title);
    dialog.appendChild(infoBox);
    dialog.appendChild(btnContainer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        dialog.style.transform = 'translateY(0)';
    });
}