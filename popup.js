// ================================================================
// SnapShot Pro — Popup Script
// ================================================================

'use strict';

// ── Helpers ─────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function copyImageToClipboard(dataUrl) {
  try {
    const response = await sendMsg({ type: 'copyImageToClipboard', dataUrl });
    return !!response?.success;
  } catch {
    return false;
  }
}

function triggerDownload(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// ── View Switching ───────────────────────────────────────────────

let currentDataUrl = null;
let progressTimer  = null;

function showView(id) {
  ['view-main', 'view-loading', 'view-error', 'view-success'].forEach(v => {
    $(v).style.display = (v === id) ? (id === 'view-main' ? 'block' : 'flex') : 'none';
  });
}

function showLoading(title = 'Capturing…', sub = 'Please wait') {
  showView('view-loading');
  $('loading-title').textContent = title;
  $('loading-sub').textContent   = sub;
  setProgress(5);
}

function showError(title, detail = '') {
  stopProgress();
  showView('view-error');
  $('error-title').textContent = title;
  $('error-msg').textContent   = detail;
}

function showSuccess(dataUrl, type, note = 'Opened in editor') {
  stopProgress();
  currentDataUrl = dataUrl;
  setProgress(100);

  setTimeout(() => {
    showView('view-success');
    $('preview-img').src           = dataUrl;
    $('success-note').textContent  = note;
    $('preview-type').textContent  = type;
    loadLastThumb();
  }, 160);
}

// ── Progress Bar ─────────────────────────────────────────────────

function setProgress(pct) {
  $('progress-bar').style.width = Math.min(100, pct) + '%';
}

function startAutoProgress(targetPct = 80, intervalMs = 350) {
  let pct = 5;
  progressTimer = setInterval(() => {
    if (pct < targetPct) {
      pct += (Math.random() * 4 + 1);
      setProgress(Math.min(targetPct, pct));
    }
  }, intervalMs);
}

function stopProgress() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

// ── Last Thumbnail ───────────────────────────────────────────────

async function loadLastThumb() {
  try {
    const last = await sendMsg({ type: 'getLastScreenshot' });
    if (last?.dataUrl) {
      $('last-thumb').src = last.dataUrl;
      $('last-wrap').style.display = 'block';
    }
  } catch { /* silent */ }
}

// ── Capture Flows ────────────────────────────────────────────────

async function captureVisible() {
  try {
    showLoading('Capturing visible page…', 'Snapping current viewport');
    setProgress(40);
    const tab = await getActiveTab();
    const res = await sendMsg({ type: 'captureVisible', tabId: tab.id });

    if (!res?.success) {
      showError('Capture Failed', res?.error || 'Unknown error. Please try again.');
      return;
    }
    const note = res.fallback
      ? `Fallback used. Opened in editor: ${res.fallbackReason}`
      : 'Visible capture opened in editor';
    showSuccess(res.dataUrl, 'visible', note);
  } catch (e) {
    showError('Capture Failed', e.message);
  }
}

async function captureFullPage() {
  try {
    showLoading('Capturing full page…', 'Scrolling and stitching — this may take a moment');
    startAutoProgress(82);

    const tab = await getActiveTab();
    const res = await sendMsg({ type: 'captureFullPage', tabId: tab.id });

    stopProgress();
    if (!res?.success) {
      showError('Capture Failed', res?.error || 'Unknown error. Please try again.');
      return;
    }
    const note = res.fallback
      ? `Fallback used. Opened in editor: ${res.fallbackReason}`
      : 'Full-page capture opened in editor';
    showSuccess(res.dataUrl, 'full page', note);
  } catch (e) {
    stopProgress();
    showError('Capture Failed', e.message);
  }
}

async function startAreaSelect() {
  try {
    const tab = await getActiveTab();
    const res = await sendMsg({ type: 'startAreaSelect', tabId: tab.id });

    if (!res?.success) {
      showError('Area Select Unavailable', res?.error || 'Cannot start area selection on this page.');
      return;
    }
    // Close the popup so the user can interact with the page
    window.close();
  } catch (e) {
    showError('Area Select Failed', e.message);
  }
}

// ── Button Event Listeners ───────────────────────────────────────

$('btn-visible').addEventListener('click', captureVisible);
$('btn-fullpage').addEventListener('click', captureFullPage);
$('btn-area').addEventListener('click', startAreaSelect);

// Error view
$('btn-err-back').addEventListener('click', () => {
  showView('view-main');
  loadLastThumb();
});

// Success view
$('btn-suc-back').addEventListener('click', () => {
  showView('view-main');
  loadLastThumb();
});

$('btn-suc-dl').addEventListener('click', () => {
  if (!currentDataUrl) return;
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  triggerDownload(currentDataUrl, `snapshot-${ts}.png`);
});

$('btn-suc-copy').addEventListener('click', async (e) => {
  if (!currentDataUrl) return;
  const btn = e.currentTarget;
  const ok = await copyImageToClipboard(currentDataUrl);
  btn.style.color = ok ? '#4ade80' : '#f87171';
  setTimeout(() => { btn.style.color = ''; }, 1500);
});

// Last screenshot strip
$('last-dl').addEventListener('click', async () => {
  const last = await sendMsg({ type: 'getLastScreenshot' });
  if (!last?.dataUrl) return;
  triggerDownload(last.dataUrl, `snapshot-${last.ts || 'last'}.png`);
});

$('last-copy').addEventListener('click', async (e) => {
  const last = await sendMsg({ type: 'getLastScreenshot' });
  if (!last?.dataUrl) return;
  const ok = await copyImageToClipboard(last.dataUrl);
  e.currentTarget.style.color = ok ? '#4ade80' : '#f87171';
  setTimeout(() => { e.currentTarget.style.color = ''; }, 1400);
});

// ── Init ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  showView('view-main');
  loadLastThumb();
});
