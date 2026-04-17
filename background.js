// ================================================================
// SnapShot Pro — Background Service Worker
// Works on all pages. Falls back gracefully on restricted pages.
// ================================================================

'use strict';

const AREA_START_MESSAGE = 'snapshot:startSelectV2';
const CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS = 550;
let captureVisibleTabQueue = Promise.resolve();
let lastCaptureVisibleTabAt = 0;

// ── Utilities ──────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createTimestamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function createDraftId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `${createTimestamp()}-${random}`;
}

function editorDraftKey(id) {
  return `editorDraft:${id}`;
}

/** Capture the visible tab of a given window */
function captureTab(windowId) {
  return new Promise((resolve, reject) => {
    captureVisibleTabQueue = captureVisibleTabQueue
      .catch(() => {})
      .then(async () => {
        const waitMs = Math.max(
          0,
          (lastCaptureVisibleTabAt + CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS) - Date.now()
        );

        if (waitMs > 0) {
          await sleep(waitMs);
        }

        return new Promise((innerResolve, innerReject) => {
          chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
            lastCaptureVisibleTabAt = Date.now();

            if (chrome.runtime.lastError) {
              innerReject(new Error(chrome.runtime.lastError.message));
            } else {
              innerResolve(dataUrl);
            }
          });
        });
      });

    captureVisibleTabQueue.then(resolve).catch(reject);
  });
}

/** Run an arbitrary function in a tab via scripting API */
async function runInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return results[0]?.result;
}

/** Check if we can inject scripts into this tab */
async function canInject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => true });
    return true;
  } catch {
    return false;
  }
}

// ── Canvas Operations (OffscreenCanvas in Service Worker) ──────

/** Load a data URL into an ImageBitmap (works in service workers) */
async function loadImageBitmap(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

/** Convert a Blob to a data URL (service-worker compatible, no FileReader) */
async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return 'data:image/png;base64,' + btoa(binary);
}

/** Stitch multiple viewport captures into one full-page image */
async function stitchStrips(strips, totalWidth, totalHeight, dpr) {
  const width = Math.round(totalWidth * dpr);
  const height = Math.round(totalHeight * dpr);
  const maxDimension = 32767;
  const maxArea = 268435456;

  if (width > maxDimension || height > maxDimension || (width * height) > maxArea) {
    throw new Error(
      `Page is too large to stitch (${width}x${height}px). ` +
      'Try capturing a smaller section using Select Area.'
    );
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');

  for (const strip of strips) {
    const img = await loadImageBitmap(strip.dataUrl);
    ctx.drawImage(
      img,
      0, 0, img.width, img.height,
      Math.round(strip.x * dpr),
      Math.round(strip.y * dpr),
      img.width,
      img.height
    );
    img.close();
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataUrl(blob);
}

/** Crop a captured image to a selection rectangle */
async function cropImage(dataUrl, rect) {
  const dpr = rect.dpr || 1;
  const img = await loadImageBitmap(dataUrl);

  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.min(Math.round(rect.w * dpr), img.width - sx);
  const sh = Math.min(Math.round(rect.h * dpr), img.height - sy);

  if (sw <= 0 || sh <= 0) {
    img.close();
    throw new Error('Selected area is outside the captured viewport.');
  }

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  img.close();

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataUrl(blob);
}

// ── Capture: Visible ────────────────────────────────────────────

async function captureVisible(tab) {
  const dataUrl = await captureTab(tab.windowId);
  return { dataUrl, type: 'visible' };
}

// ── Capture: Full Page ──────────────────────────────────────────

function buildScrollStops(totalSize, viewportSize) {
  const safeViewport = Math.max(1, Math.round(viewportSize));
  const maxScroll = Math.max(0, Math.round(totalSize - safeViewport));
  const stops = [0];

  for (let offset = safeViewport; offset < maxScroll; offset += safeViewport) {
    stops.push(offset);
  }

  if (stops[stops.length - 1] !== maxScroll) {
    stops.push(maxScroll);
  }

  return Array.from(new Set(stops.map((stop) => Math.max(0, Math.round(stop)))));
}

async function captureFullPage(tab) {
  if (!await canInject(tab.id)) {
    const dataUrl = await captureTab(tab.windowId);
    return {
      dataUrl,
      type: 'visible',
      fallback: true,
      fallbackReason: 'Scripts cannot run on this page type. Captured visible area only.'
    };
  }

  const metrics = await runInTab(tab.id, () => ({
    sw: Math.max(
      document.scrollingElement?.scrollWidth || 0,
      document.body?.scrollWidth || 0,
      document.documentElement.scrollWidth,
      window.innerWidth
    ),
    sh: Math.max(
      document.scrollingElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      document.documentElement.scrollHeight,
      window.innerHeight
    ),
    vw: Math.max(
      document.documentElement.clientWidth || 0,
      document.scrollingElement?.clientWidth || 0,
      window.innerWidth
    ),
    vh: Math.max(
      document.documentElement.clientHeight || 0,
      document.scrollingElement?.clientHeight || 0,
      window.innerHeight
    ),
    dpr: window.devicePixelRatio || 1,
    ox: Math.round(window.scrollX),
    oy: Math.round(window.scrollY)
  }));

  const { sw, sh, vw, vh, dpr, ox, oy } = metrics;
  const xStops = buildScrollStops(sw, vw);
  const yStops = buildScrollStops(sh, vh);

  await runInTab(tab.id, () => {
    const root = document.documentElement;
    const body = document.body;
    root.__snapScrollBehavior = root.style.scrollBehavior || '';
    root.style.scrollBehavior = 'auto';

    if (body) {
      body.__snapScrollBehavior = body.style.scrollBehavior || '';
      body.style.scrollBehavior = 'auto';
    }
  });

  const strips = [];
  const capturedPositions = new Set();

  try {
    for (const yTarget of yStops) {
      for (const xTarget of xStops) {
        const pos = await runInTab(tab.id, async (x, y) => {
          const scrollRoot = document.scrollingElement || document.documentElement;
          const targetX = Math.max(0, Math.round(x));
          const targetY = Math.max(0, Math.round(y));
          const deadline = performance.now() + 1500;

          window.scrollTo(targetX, targetY);
          if (scrollRoot && typeof scrollRoot.scrollTo === 'function') {
            scrollRoot.scrollTo(targetX, targetY);
          }

          return new Promise((resolve) => {
            let stableFrames = 0;
            let lastX = Number.NaN;
            let lastY = Number.NaN;

            const check = () => {
              const currentX = Math.round(window.scrollX || scrollRoot?.scrollLeft || 0);
              const currentY = Math.round(window.scrollY || scrollRoot?.scrollTop || 0);
              const reachedTarget =
                Math.abs(currentX - targetX) <= 2 &&
                Math.abs(currentY - targetY) <= 2;
              const unchanged = currentX === lastX && currentY === lastY;

              stableFrames = (reachedTarget || unchanged) ? stableFrames + 1 : 0;
              lastX = currentX;
              lastY = currentY;

              if (stableFrames >= 2 || performance.now() >= deadline) {
                resolve({ x: currentX, y: currentY });
                return;
              }

              requestAnimationFrame(check);
            };

            requestAnimationFrame(check);
          });
        }, [xTarget, yTarget]);
        const posKey = `${pos.x}:${pos.y}`;

        if (capturedPositions.has(posKey)) {
          continue;
        }

        capturedPositions.add(posKey);
        await sleep(140);

        const dataUrl = await captureTab(tab.windowId);
        strips.push({ dataUrl, x: pos.x, y: pos.y });
      }
    }
  } finally {
    await runInTab(tab.id, (restoreX, restoreY) => {
      try {
        const root = document.documentElement;
        const body = document.body;
        window.scrollTo(restoreX, restoreY);
        root.style.scrollBehavior = root.__snapScrollBehavior || '';
        delete root.__snapScrollBehavior;

        if (body) {
          body.style.scrollBehavior = body.__snapScrollBehavior || '';
          delete body.__snapScrollBehavior;
        }
      } catch (_error) {
        // Best-effort cleanup.
      }
    }, [ox, oy]).catch(() => {});
  }

  const dataUrl = await stitchStrips(strips, sw, sh, dpr);
  return { dataUrl, type: 'fullPage' };
}

// ── Capture: Area ───────────────────────────────────────────────

async function startAreaSelect(tabId) {
  if (!await canInject(tabId)) {
    return {
      success: false,
      error: 'Area selection is unavailable on restricted pages (chrome://, extension pages, etc.).\n\nUse "Visible" or "Full Page" instead.'
    };
  }

  try {
    await chrome.tabs.sendMessage(tabId, { type: AREA_START_MESSAGE });
    return { success: true };
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await sleep(80);
      await chrome.tabs.sendMessage(tabId, { type: AREA_START_MESSAGE });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

async function captureAreaSelection(tab, rect) {
  await sleep(120);
  const dataUrl = await captureTab(tab.windowId);
  return cropImage(dataUrl, rect);
}

// ── Clipboard + Editor ──────────────────────────────────────────

let offscreenDocumentPromise = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    if (contexts.length > 0) {
      return;
    }
  }

  if (!chrome.offscreen?.createDocument) {
    throw new Error('Clipboard copy is not supported in this browser version.');
  }

  if (!offscreenDocumentPromise) {
    offscreenDocumentPromise = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason?.CLIPBOARD || 'CLIPBOARD'],
      justification: 'Copy captured screenshots to the system clipboard.'
    }).catch((error) => {
      offscreenDocumentPromise = null;
      if (!/Only a single offscreen document/i.test(error.message)) {
        throw error;
      }
    });
  }

  await offscreenDocumentPromise;
}

async function copyImageToClipboard(dataUrl) {
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'offscreen:copyImage', dataUrl }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || 'Clipboard copy failed.'));
        return;
      }
      resolve();
    });
  });
}

async function copyBlobToClipboard(blob) {
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'offscreen:copyImageBlob', blob }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || 'Clipboard copy failed.'));
        return;
      }
      resolve();
    });
  });
}

async function storeLastScreenshot(dataUrl, type, ts = createTimestamp()) {
  await chrome.storage.local.set({ lastScreenshot: { dataUrl, type, ts } });
  return ts;
}

async function saveScreenshot(dataUrl, type) {
  const ts = await storeLastScreenshot(dataUrl, type);
  const filename = `snapshot-${type}-${ts}.png`;
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
  return ts;
}

async function openEditor(dataUrl, type = 'area') {
  const draftId = createDraftId();
  const draft = { dataUrl, type, ts: draftId, draftId };

  await storeLastScreenshot(dataUrl, type, draftId);
  await chrome.storage.local.set({ [editorDraftKey(draftId)]: draft });
  await chrome.tabs.create({
    url: `${chrome.runtime.getURL('editor.html')}?draft=${encodeURIComponent(draftId)}`,
    active: true
  });

  return draft;
}

async function handleAreaAction(tab, rect, action) {
  const dataUrl = await captureAreaSelection(tab, rect);

  if (action === 'copy') {
    const ts = createTimestamp();
    await copyImageToClipboard(dataUrl);
    await storeLastScreenshot(dataUrl, 'area', ts);
    return { dataUrl, type: 'area', ts };
  }

  if (action === 'capture') {
    return openEditor(dataUrl, 'area');
  }

  throw new Error(`Unsupported area action: ${action}`);
}

// ── Badge ───────────────────────────────────────────────────────

function setBadge(text, color = '#22c55e') {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  if (text) {
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
  }
}

// ── Message Router ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'captureVisible') {
    (async () => {
      try {
        const tab = await chrome.tabs.get(msg.tabId);
        const result = await captureVisible(tab);
        const editor = await openEditor(result.dataUrl, result.type);
        setBadge('ED');
        sendResponse({ success: true, ...result, ...editor, openedEditor: true });
      } catch (error) {
        setBadge('!', '#ef4444');
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.type === 'captureFullPage') {
    (async () => {
      try {
        const tab = await chrome.tabs.get(msg.tabId);
        const result = await captureFullPage(tab);
        const editor = await openEditor(result.dataUrl, result.type);
        setBadge('ED');
        sendResponse({ success: true, ...result, ...editor, openedEditor: true });
      } catch (error) {
        setBadge('!', '#ef4444');
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.type === 'startAreaSelect') {
    startAreaSelect(msg.tabId).then(sendResponse);
    return true;
  }

  if (msg.type === 'areaAction') {
    (async () => {
      try {
        if (!sender.tab) {
          throw new Error('Area actions must come from an active browser tab.');
        }
        const tab = await chrome.tabs.get(sender.tab.id);
        const result = await handleAreaAction(tab, msg.rect, msg.action);
        setBadge(msg.action === 'copy' ? 'CP' : 'ED');
        sendResponse({ success: true, ...result });
      } catch (error) {
        setBadge('!', '#ef4444');
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.type === 'areaSelected') {
    sendResponse({ success: false, error: 'Area selection now requires an explicit action.' });
    return false;
  }

  if (msg.type === 'getLastScreenshot') {
    chrome.storage.local.get('lastScreenshot', (data) => {
      sendResponse(data.lastScreenshot || null);
    });
    return true;
  }

  if (msg.type === 'copyImageToClipboard') {
    (async () => {
      try {
        await copyImageToClipboard(msg.dataUrl);
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.type === 'copyImageBlobToClipboard') {
    (async () => {
      try {
        await copyBlobToClipboard(msg.blob);
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  return false;
});
