// ─── Sound Flux — Service Worker ─────────────────────────────────────
// Handles messaging between popup and content scripts, manages per-tab state
// and per-site volume memory.

const DEFAULT_STATE = {
  volume: 100,
  bassBoost: 0,
  voiceBoost: 0,
  compressor: true,
  preset: 'none',
  enabled: true
};

// In-memory cache for quick access (persisted to storage on change)
const tabStates = new Map();

// Listen for messages from popup & content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATE') {
    getTabState(message.tabId).then(state => sendResponse(state));
    return true; // async
  }

  if (message.type === 'SET_STATE') {
    setTabState(message.tabId, message.state).then(() => {
      // Forward the state to the content script in that tab
      chrome.tabs.sendMessage(message.tabId, {
        type: 'APPLY_STATE',
        state: message.state
      }).catch(() => {});
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Per-Site Volume Memory ──────────────────────────────────────────
  if (message.type === 'GET_SITE_VOLUME') {
    const key = `site_vol_${message.hostname}`;
    chrome.storage.local.get(key).then(result => {
      sendResponse({ volume: result[key] ?? null });
    });
    return true;
  }

  if (message.type === 'SET_SITE_VOLUME') {
    const key = `site_vol_${message.hostname}`;
    chrome.storage.local.set({ [key]: message.volume }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Global Volume Memory ─────────────────────────────────────────────
  if (message.type === 'GET_GLOBAL_PREF') {
    chrome.storage.local.get(['global_vol_enabled', 'global_vol']).then(res => {
      sendResponse(res);
    });
    return true;
  }

  if (message.type === 'SET_GLOBAL_PREF') {
    chrome.storage.local.set({ 
      global_vol_enabled: message.enabled, 
      global_vol: message.volume 
    }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }
});

// Clean up state when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  chrome.storage.local.remove(`tab_${tabId}`);
});

async function getTabState(tabId) {
  if (tabStates.has(tabId)) return tabStates.get(tabId);
  const key = `tab_${tabId}`;
  const result = await chrome.storage.local.get(key);
  const state = result[key] || { ...DEFAULT_STATE };
  tabStates.set(tabId, state);
  return state;
}

async function setTabState(tabId, state) {
  tabStates.set(tabId, state);
  await chrome.storage.local.set({ [`tab_${tabId}`]: state });
}
