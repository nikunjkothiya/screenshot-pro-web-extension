// ================================================================
// SnapShot Pro — Content Script
// Handles the interactive area-selection overlay.
// ================================================================

(function () {
  'use strict';

  const VERSION = 'manual-area-v2';
  const START_MESSAGE = 'snapshot:startSelectV2';
  const ROOT_ID = '__snapshot_root_v2__';

  if (window.__snapshotProAreaState?.version === VERSION) {
    return;
  }

  const state = {
    version: VERSION,
    active: false
  };
  window.__snapshotProAreaState = state;

  function sendRuntimeMessage(msg, attempt = 0) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError;
          const retryable = /Receiving end does not exist|Could not establish connection/i.test(error.message);

          if (retryable && attempt < 2) {
            setTimeout(() => {
              sendRuntimeMessage(msg, attempt + 1).then(resolve, reject);
            }, 250);
            return;
          }

          reject(new Error(error.message));
          return;
        }

        resolve(response);
      });
    });
  }

  function showToast(message, tone = 'success') {
    const toast = document.createElement('div');
    const isError = tone === 'error';

    Object.assign(toast.style, {
      position: 'fixed',
      top: '18px',
      left: '50%',
      transform: 'translateX(-50%) translateY(-8px)',
      zIndex: '2147483647',
      padding: '10px 16px',
      borderRadius: '999px',
      background: isError ? 'rgba(127, 29, 29, 0.96)' : 'rgba(15, 23, 42, 0.94)',
      color: '#f8fafc',
      border: isError ? '1px solid rgba(254, 202, 202, 0.28)' : '1px solid rgba(148, 163, 184, 0.22)',
      boxShadow: '0 12px 32px rgba(15, 23, 42, 0.24)',
      font: '600 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      letterSpacing: '0.01em',
      opacity: '0',
      transition: 'opacity 0.16s ease, transform 0.16s ease',
      pointerEvents: 'none'
    });

    toast.textContent = message;
    document.documentElement.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-8px)';
      setTimeout(() => toast.remove(), 180);
    }, 1800);
  }

  function startSelection() {
    if (state.active) {
      return;
    }

    state.active = true;

    const root = document.createElement('div');
    root.id = ROOT_ID;

    const style = document.createElement('style');
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        cursor: crosshair;
        user-select: none;
        -webkit-user-select: none;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${ROOT_ID}.is-busy {
        cursor: progress;
      }

      #${ROOT_ID}.is-hidden {
        opacity: 0;
        pointer-events: none;
      }

      #${ROOT_ID} .snapshot-dim {
        position: absolute;
        inset: 0;
        background: rgba(15, 23, 42, 0.18);
      }

      #${ROOT_ID} .snapshot-selection {
        position: absolute;
        display: none;
        box-sizing: border-box;
        border: 2px solid rgba(59, 130, 246, 0.95);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.08);
        box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.38);
      }

      #${ROOT_ID} .snapshot-handle {
        position: absolute;
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #ffffff;
        border: 2px solid #3b82f6;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.24);
        pointer-events: none;
      }

      #${ROOT_ID} .snapshot-handle.tl { top: -6px; left: -6px; }
      #${ROOT_ID} .snapshot-handle.tr { top: -6px; right: -6px; }
      #${ROOT_ID} .snapshot-handle.bl { bottom: -6px; left: -6px; }
      #${ROOT_ID} .snapshot-handle.br { bottom: -6px; right: -6px; }

      #${ROOT_ID} .snapshot-badge {
        position: absolute;
        display: none;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.92);
        color: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.24);
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.24);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap;
        pointer-events: none;
      }

      #${ROOT_ID} .snapshot-toolbar {
        position: absolute;
        display: none;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(203, 213, 225, 0.95);
        box-shadow: 0 18px 38px rgba(15, 23, 42, 0.18);
      }

      #${ROOT_ID} .snapshot-btn {
        appearance: none;
        border: 1px solid #d7e2ef;
        border-radius: 12px;
        padding: 9px 13px;
        background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
        color: #1e293b;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.01em;
        cursor: pointer;
        transition: transform 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease, background 0.14s ease;
      }

      #${ROOT_ID} .snapshot-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.12);
        border-color: #bfdbfe;
        background: linear-gradient(180deg, #ffffff 0%, #eef5ff 100%);
      }

      #${ROOT_ID} .snapshot-btn:disabled {
        opacity: 0.65;
        cursor: wait;
        transform: none;
        box-shadow: none;
      }

      #${ROOT_ID} .snapshot-btn.capture {
        border-color: rgba(59, 130, 246, 0.32);
        background: linear-gradient(135deg, #3b82f6 0%, #7c5cff 100%);
        color: #ffffff;
      }

      #${ROOT_ID} .snapshot-btn.capture:hover {
        border-color: rgba(59, 130, 246, 0.4);
        background: linear-gradient(135deg, #3478e5 0%, #6e54f5 100%);
      }

      #${ROOT_ID} .snapshot-hint {
        position: fixed;
        left: 50%;
        bottom: 22px;
        transform: translateX(-50%);
        max-width: min(560px, calc(100vw - 28px));
        padding: 11px 18px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.92);
        color: #dbeafe;
        border: 1px solid rgba(96, 165, 250, 0.2);
        box-shadow: 0 18px 38px rgba(15, 23, 42, 0.2);
        font-size: 12px;
        font-weight: 600;
        line-height: 1.4;
        text-align: center;
        pointer-events: none;
      }
    `;
    root.appendChild(style);

    const dim = document.createElement('div');
    dim.className = 'snapshot-dim';
    root.appendChild(dim);

    const selection = document.createElement('div');
    selection.className = 'snapshot-selection';
    ['tl', 'tr', 'bl', 'br'].forEach((position) => {
      const handle = document.createElement('div');
      handle.className = `snapshot-handle ${position}`;
      selection.appendChild(handle);
    });
    root.appendChild(selection);

    const badge = document.createElement('div');
    badge.className = 'snapshot-badge';
    root.appendChild(badge);

    const toolbar = document.createElement('div');
    toolbar.className = 'snapshot-toolbar';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'snapshot-btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'snapshot-btn';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';

    const captureBtn = document.createElement('button');
    captureBtn.className = 'snapshot-btn capture';
    captureBtn.type = 'button';
    captureBtn.textContent = 'Capture';

    toolbar.appendChild(cancelBtn);
    toolbar.appendChild(copyBtn);
    toolbar.appendChild(captureBtn);
    root.appendChild(toolbar);

    const hint = document.createElement('div');
    hint.className = 'snapshot-hint';
    hint.textContent = 'Drag to select an area. Press Esc to cancel.';
    root.appendChild(hint);

    document.documentElement.appendChild(root);

    let dragging = false;
    let busy = false;
    let startX = 0;
    let startY = 0;
    let selectedRect = null;

    function setButtonsDisabled(disabled) {
      cancelBtn.disabled = disabled;
      copyBtn.disabled = disabled;
      captureBtn.disabled = disabled;
    }

    function setHint(text) {
      hint.textContent = text;
    }

    function positionBadge(clientX, clientY) {
      const margin = 12;
      const width = badge.offsetWidth;
      const height = badge.offsetHeight;
      let left = clientX + 12;
      let top = clientY - height - 14;

      if (left + width > window.innerWidth - margin) {
        left = clientX - width - 12;
      }
      if (left < margin) {
        left = margin;
      }
      if (top < margin) {
        top = clientY + 18;
      }

      badge.style.left = `${left}px`;
      badge.style.top = `${top}px`;
    }

    function positionToolbar(rect) {
      toolbar.style.display = 'flex';

      const margin = 12;
      const width = toolbar.offsetWidth;
      const height = toolbar.offsetHeight;
      let left = rect.x + rect.w - width;
      let top = rect.y + rect.h + 12;

      left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);

      if (top + height > window.innerHeight - margin) {
        top = rect.y - height - 12;
      }
      if (top < margin) {
        top = Math.min(window.innerHeight - height - margin, rect.y + 12);
      }

      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${top}px`;
    }

    function renderSelection(clientX, clientY) {
      const x = Math.min(clientX, startX);
      const y = Math.min(clientY, startY);
      const w = Math.abs(clientX - startX);
      const h = Math.abs(clientY - startY);

      selection.style.display = 'block';
      selection.style.left = `${x}px`;
      selection.style.top = `${y}px`;
      selection.style.width = `${w}px`;
      selection.style.height = `${h}px`;

      badge.textContent = `${Math.round(w)} x ${Math.round(h)}`;
      badge.style.display = 'block';
      positionBadge(clientX, clientY);
    }

    function clearSelectionUI() {
      selection.style.display = 'none';
      badge.style.display = 'none';
      toolbar.style.display = 'none';
      selectedRect = null;
      setHint('Drag to select an area. Press Esc to cancel.');
      root.style.cursor = 'crosshair';
    }

    function cleanup() {
      if (!state.active) {
        return;
      }

      state.active = false;
      root.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('keydown', onKeyDown, true);
      root.remove();
    }

    async function handleAction(action) {
      if (!selectedRect || busy) {
        return;
      }

      busy = true;
      setButtonsDisabled(true);
      root.classList.add('is-busy', 'is-hidden');
      setHint(action === 'copy' ? 'Copying your selection...' : 'Opening the selected screenshot in the editor...');

      try {
        const response = await sendRuntimeMessage({
          type: 'areaAction',
          action,
          rect: selectedRect
        });

        if (!response?.success) {
          throw new Error(response?.error || 'Unable to complete that action.');
        }

        cleanup();
        showToast(
          action === 'copy'
            ? 'Selection copied to clipboard.'
            : 'Screenshot opened in a new editor tab.'
        );
      } catch (error) {
        busy = false;
        setButtonsDisabled(false);
        root.classList.remove('is-busy', 'is-hidden');
        setHint('Selection ready. Choose Copy, Capture, or Cancel.');
        showToast(error.message || 'Unable to complete that action.', 'error');
      }
    }

    function onMouseDown(event) {
      if (busy || event.button !== 0) {
        return;
      }
      if (toolbar.contains(event.target)) {
        return;
      }
      if (selectedRect) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      selection.style.display = 'block';
      selection.style.left = `${startX}px`;
      selection.style.top = `${startY}px`;
      selection.style.width = '0px';
      selection.style.height = '0px';
      badge.style.display = 'none';
      toolbar.style.display = 'none';
    }

    function onMouseMove(event) {
      if (!dragging) {
        return;
      }

      event.preventDefault();
      renderSelection(event.clientX, event.clientY);
    }

    function onMouseUp(event) {
      if (!dragging) {
        return;
      }

      event.preventDefault();
      dragging = false;

      const x = Math.min(event.clientX, startX);
      const y = Math.min(event.clientY, startY);
      const w = Math.abs(event.clientX - startX);
      const h = Math.abs(event.clientY - startY);

      if (w < 5 || h < 5) {
        clearSelectionUI();
        return;
      }

      selectedRect = {
        x,
        y,
        w,
        h,
        dpr: window.devicePixelRatio || 1
      };

      badge.style.display = 'none';
      root.style.cursor = 'default';
      setHint('Selection ready. Choose Copy, Capture, or Cancel.');
      positionToolbar(selectedRect);
    }

    function onKeyDown(event) {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      cleanup();
    }

    cancelBtn.addEventListener('click', cleanup);
    copyBtn.addEventListener('click', () => handleAction('copy'));
    captureBtn.addEventListener('click', () => handleAction('capture'));

    root.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === START_MESSAGE) {
      startSelection();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
})();
