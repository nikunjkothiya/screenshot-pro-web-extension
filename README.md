# 📷 SnapShot Pro — Universal Browser Screenshot Extension

A production-grade Chrome extension that captures screenshots on **any page** — including `chrome://` system pages, extension pages, PDFs, `file://` URLs, and regular websites.

---

## ✨ Features

| Mode | Description |
|------|-------------|
| **Visible Page** | Instant screenshot of exactly what's on screen |
| **Full Page** | Auto-scrolls the entire page and stitches all pieces into one image |
| **Select Area** | Drag a custom region, then copy it or open it in the editor |

- Works on ALL pages — even where most screenshot extensions fail
- Graceful fallback on restricted pages (shows visible capture instead)
- Opens visible, full-page, and area captures in the built-in editor before download
- Copy to clipboard (PNG)
- Preview + re-download last capture from popup
- Zero external dependencies — pure Manifest V3

---

## 🚀 Installation

### Step 1 — Load the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer Mode** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Select this project folder

The extension icon will appear in your Chrome toolbar. Pin it for easy access.

---

## 📖 Usage

Click the **SnapShot Pro** icon in the toolbar.

### Visible Page
Click once — captures the current viewport and opens it in the editor.

### Full Page
Automatically scrolls from top to bottom, captures each viewport section, stitches them into one full-page PNG, then opens it in the editor. Works best on pages with finite content.

### Select Area
The popup closes and a crosshair overlay appears. Drag to draw your selection, then choose **Copy**, **Capture**, or **Cancel**. **Copy** sends the cropped image to your clipboard, while **Capture** opens it in the built-in editor. Press **Esc** to cancel at any time.

---

## ⚠️ Known Limitations

| Situation | Behaviour |
|-----------|-----------|
| `chrome://` pages, DevTools, New Tab | Full Page and Select Area fall back to Visible capture |
| `file://` local files | Requires enabling *"Allow access to file URLs"* in `chrome://extensions/` |
| Pages with infinite scroll / lazy-loading | Full Page captures whatever has loaded; slow-loading sections may be blank |
| Extremely tall pages (>16 384px) | Full Page raises an error; use Select Area instead |
| Chrome 108 and below | Not supported (requires Manifest V3 + OffscreenCanvas in service workers) |

---

## 🗂 File Structure

```
snapshot-pro/
├── manifest.json          Extension manifest (MV3)
├── background.js          Service worker — all capture logic
├── content.js             Injected page script — area-selection overlay
├── popup.html             Extension popup UI
├── popup.css              Popup styles (light theme)
├── popup.js               Popup interactions
├── editor.html            Screenshot editor tab
├── editor.css             Editor styles
├── editor.js              Editor interactions
├── offscreen.html         Clipboard helper document
├── offscreen.js           Clipboard helper logic
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 🛠 How It Works

**Full Page Stitching**
The background service worker uses `chrome.scripting.executeScript` to read page dimensions, then programmatically scrolls the page via `window.scrollTo()`, capturing each viewport section with `chrome.tabs.captureVisibleTab`. All pieces are painted onto a single `OffscreenCanvas` and exported as PNG — entirely within the service worker, no external libraries needed.

**Area Selection**
The content script injects a full-viewport overlay with a crosshair cursor. After you drag a region, it keeps the selection in place and offers **Copy**, **Capture**, and **Cancel** actions. The background captures the visible tab only after you choose an action, then either copies the cropped image to the clipboard or opens it in the editor tab.

**Restricted Pages**
When `chrome.scripting.executeScript` fails (e.g. on `chrome://` pages), the extension automatically falls back to a simple `captureVisibleTab` and notifies the user.

---

## 📋 Permissions Used

| Permission | Why |
|------------|-----|
| `activeTab` | Capture the current tab's screenshot |
| `tabs` | Read tab URL and window ID |
| `scripting` | Inject content scripts and run page-dimension queries |
| `storage` | Remember the last screenshot for the popup preview |
| `downloads` | Save PNG files to the user's Downloads folder |
| `clipboardWrite` | Copy manually selected screenshots to the system clipboard |
| `offscreen` | Run clipboard writes from an offscreen extension document |
| `host_permissions: <all_urls>` | Allow script injection on any URL |

---

## 🔧 Browser Support

- **Chrome 109+** ✓
- **Microsoft Edge 109+** ✓
- Firefox — not supported (uses Chrome-specific MV3 APIs)
