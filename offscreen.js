// ================================================================
// SnapShot Pro — Offscreen Clipboard Helper
// ================================================================

'use strict';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'offscreen:copyImage' && msg.type !== 'offscreen:copyImageBlob') {
    return false;
  }

  (async () => {
    try {
      if (typeof ClipboardItem === 'undefined') {
        throw new Error('ClipboardItem is not available in this browser.');
      }

      const blob = msg.type === 'offscreen:copyImageBlob'
        ? msg.blob
        : await (async () => {
          const response = await fetch(msg.dataUrl);
          return response.blob();
        })();

      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob
        })
      ]);

      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});
