// File: page_injector.js

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "show_page_prompt") {
        injectPrompt(msg.url);
        sendResponse({ success: true });
    } else if (msg.action === "show_page_notification") {
        injectNotification(msg.url);
        sendResponse({ success: true });
    }
    return true;
});

function injectPrompt(url) {
    // Hindari duplikasi prompt
    if (document.getElementById('czdm-prompt-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'czdm-prompt-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        font-family: 'Segoe UI', system-ui, sans-serif;
        opacity: 0; transition: opacity 0.2s ease-in-out;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background: #ffffff; padding: 20px; border-radius: 10px;
        width: 380px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
        color: #334155; transform: translateY(15px); transition: transform 0.2s ease-out;
    `;

    box.innerHTML = `
        <div style="font-size: 16px; font-weight: 700; margin-bottom: 15px; color: #0f172a;">Add New Download</div>
        <input type="text" value="${url}" readonly style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; outline: none; margin-bottom: 12px; box-sizing: border-box; background: #f8fafc; color: #334155;">
        <div id="czdm-url-details" style="background: #f8fafc; padding: 12px; border-radius: 6px; font-size: 12px; border: 1px solid #e2e8f0; margin-bottom: 20px; min-height: 40px; display: flex; flex-direction: column; justify-content: center;">
            <div style="color: #64748b; text-align: center;">Checking file info...</div>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="czdm-btn-cancel" style="padding: 8px 16px; border-radius: 6px; border: 1px solid #e2e8f0; background: #ffffff; color: #334155; cursor: pointer; font-size: 13px; font-weight: 500; transition: background 0.2s;">Cancel</button>
            <button id="czdm-btn-confirm" disabled style="padding: 8px 16px; border-radius: 6px; border: 1px solid #3b82f6; background: #3b82f6; color: white; cursor: default; font-size: 13px; font-weight: 500; opacity: 0.5; transition: opacity 0.2s;">Download Now</button>
        </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Animasi masuk
    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        box.style.transform = 'translateY(0)';
    });

    const detailsDiv = box.querySelector('#czdm-url-details');
    const btnConfirm = box.querySelector('#czdm-btn-confirm');
    const btnCancel = box.querySelector('#czdm-btn-cancel');

    const closePrompt = () => {
        overlay.style.opacity = '0';
        box.style.transform = 'translateY(15px)';
        setTimeout(() => overlay.remove(), 200);
    };

    btnCancel.onclick = closePrompt;

    // Cek Header File (memanfaatkan endpoint background Anda yang sudah ada)
    chrome.runtime.sendMessage({ action: 'check_url', url: url }, (res) => {
        if (res && res.success) {
            detailsDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px; gap: 10px;">
                    <span style="color: #64748b; flex-shrink: 0;">File:</span>
                    <span style="font-weight: 600; color: #334155; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${res.filename}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">Size:</span>
                    <span style="font-weight: 600; color: #334155;">${formatBytes(res.size)}</span>
                </div>
            `;
            btnConfirm.disabled = false;
            btnConfirm.style.opacity = '1';
            btnConfirm.style.cursor = 'pointer';
        } else {
            detailsDiv.innerHTML = `<div style="color: #ef4444; text-align: center; font-weight: 500;">Check Failed. You can still proceed to download.</div>`;
            btnConfirm.disabled = false;
            btnConfirm.style.opacity = '1';
            btnConfirm.style.cursor = 'pointer';
        }
    });

    btnConfirm.onclick = () => {
        chrome.runtime.sendMessage({ action: "add_task", url: url });
        closePrompt();
    };
}

function injectNotification(url) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 24px; right: 24px;
        background: #1e293b; color: #ffffff; padding: 14px 20px;
        border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.15);
        z-index: 2147483647; font-family: 'Segoe UI', system-ui, sans-serif;
        font-size: 14px; display: flex; align-items: center; gap: 12px;
        transform: translateY(30px); opacity: 0; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
    `;

    toast.innerHTML = `
        <div style="background: #3b82f6; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        </div>
        <div>
            <div style="font-weight: 600; margin-bottom: 2px;">Added to CZDM</div>
            <div style="font-size: 11px; color: #94a3b8; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${url}</div>
        </div>
    `;

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.transform = 'translateY(20px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function formatBytes(bytes) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}