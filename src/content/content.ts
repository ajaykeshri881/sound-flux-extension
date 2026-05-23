// ─── Sound Flux — Content Script (ISOLATED world bridge) ─────────────
// Bridges Chrome extension messaging ↔ MAIN world audio engine.

(function () {
  'use strict';

  if ((window as any).__vmpBridgeLoaded) return;
  (window as any).__vmpBridgeLoaded = true;

  // ── Listen for messages from background/popup ──────────────────────
  chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (message.type === 'APPLY_STATE') {
      window.postMessage({
        direction: 'VMP_TO_MAIN',
        type: 'APPLY_STATE',
        state: message.state
      }, '*');
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'FORCE_SCAN') {
      window.postMessage({
        direction: 'VMP_TO_MAIN',
        type: 'FORCE_SCAN'
      }, '*');
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'DETECT_MEDIA') {
      const count = document.querySelectorAll('audio, video').length;
      sendResponse({ count });
      return false;
    }

    return false;
  });

})();
