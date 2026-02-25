# CZDM - Cyberzilla Download Manager

![Version](https://img.shields.io/badge/version-1.0.1-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Chromium-orange.svg)

**CZDM (Cyberzilla Download Manager)** is a high-performance, open-source browser extension designed to accelerate download speeds using advanced multi-threading technology. It features a robust file assembly engine to prevent corruption, a smart media grabber, and a modern, user-friendly interface.

Built for Chromium-based browsers (Google Chrome, Microsoft Edge, Brave, Opera).

## 🌟 Key Features

* **🚀 Multi-Threaded Engine:** Splits files into multiple chunks (up to 8 threads) to maximize bandwidth usage and download speed.
* **🛡️ Corruption-Proof Architecture:** Utilizes an **Offset-based IndexedDB** storage system. This ensures chunks are assembled based on their exact byte position, guaranteeing 100% data integrity even if threads finish out of order.
* **⏯️ Resume Capability:** Pause and resume downloads anytime without losing progress (requires server support for byte-ranges).
* **🔍 Smart Media Grabber:** Automatically scans active webpages for video, audio, images, and archives. Includes "Select All" and filtering capabilities.
* **📋 Smart Paste:** Automatically detects valid URLs from your clipboard when opening the "Add URL" modal.
* **💬 Smart Page Prompt:** Intercepts downloads and displays a clean confirmation prompt inside the current webpage, automatically checking file size and type before downloading.
* **🔔 In-Page Notifications:** Displays a sleek toast notification directly on the webpage when a download is successfully added to the queue.
* **🧩 Large File Support:** Leverages the **Offscreen API** and **Blob Assembly** to handle large files (GBs) efficiently without crashing browser memory.
* **🎨 Modern UI:** A unified, clean interface with Dark/Light mode, Liquid Glass theme support, consistent styling across Dashboard and Grabber, and a native app feel.

## 📂 Project Structure

```text
CZDM_Source/
├── background.js      # Core engine (Downloader, Multi-threading logic, DB handling)
├── content.js         # Content script for scanning web pages (Grabber feature)
├── injector.js        # Content script for rendering in-page prompts and notifications
├── manifest.json      # Extension configuration, permissions, and icons
├── offscreen.html     # Offscreen document entry point
├── offscreen.js       # Dedicated logic for assembling large Blobs efficiently
├── popup.html         # Main user interface (HTML structure)
├── popup.js           # UI Logic, DOM manipulation, and user interactions
├── style.css          # Styling (Grid layout, Animations, Unified theme)
├── README.md          # Documentation
└── img/               # Icons folder
    ├── 16x16.png
    ├── 48x48.png
    └── 128x128.png
```

## 🛠️ Installation (Developer Mode)

Since this is an open-source project, you need to load it as an "Unpacked Extension".

1.  **Download** or **Clone** this repository to your local machine.
2.  Open your browser (Chrome, Edge, or Brave).
3.  Navigate to the Extensions management page:
    * **Chrome:** `chrome://extensions`
    * **Edge:** `edge://extensions`
4.  Enable **"Developer mode"** (usually a toggle switch in the top-right or bottom-left corner).
5.  Click the **"Load unpacked"** button.
6.  Select the folder containing the CZDM source code.
7.  The **CZDM** icon should now appear in your browser toolbar.

## 📖 Usage Guide

### Dashboard
1.  **Add URL:** Click the **Add URL** button. Use the **Paste** icon to instantly grab a URL from your clipboard. The system will pre-check the file size and MIME type.
2.  **Manage Downloads:**
    * **Start:** Resume or start selected tasks.
    * **Pause:** Pause running tasks.
    * **Delete:** Remove tasks from the list (prompts for confirmation).
    * **Select All:** Quickly select all items for bulk actions.
3.  **Clear:** Removes all "Completed" or "Error" tasks from the list to clean up the view.

### Smart Grabber
1.  Navigate to any website containing media (images, videos, archives).
2.  Open the extension and switch to the **Grabber** tab.
3.  Click **Start Scan**.
4.  Use the **Filter** box to find specific file types (e.g., `mp4`, `jpg`).
5.  Check the boxes for the files you want (or use **Select All**) and click **Download**.

## 🔒 Permissions Explained

CZDM requests the minimum permissions necessary to function:

* `downloads`: To trigger the browser's download API for saving the final file.
* `storage` / `unlimitedStorage`: To store temporary file chunks in IndexedDB before assembly.
* `offscreen`: To process large blobs in the background without freezing the UI.
* `activeTab` / `scripting`: Required for the Smart Grabber to scan the current page.
* `clipboardRead`: Enables the "Smart Paste" button in the Add URL modal.
* `contextMenus`: Adds a "Download with CZDM" option to the browser's right-click menu.
* `notifications`: To show native OS desktop notifications.
* `<all_urls>`: Required to download files from any domain via XHR/Fetch and inject prompts/toasts into web pages.

## 📄 License

**MIT License**

Copyright (c) 2026 Cyberzilla

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---
**© 2026 Cyberzilla**