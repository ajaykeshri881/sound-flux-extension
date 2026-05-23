// ─── Sound Flux — Popup Controller v3.0 ────────────────────────────────
// Manages the popup UI: reads/writes state from the background service worker,
// updates the circular volume ring, sliders, presets, live visualizer,
// custom EQ presets, and per-site volume memory.

(function () {
  'use strict';

  // ── DOM References ──────────────────────────────────────────────────
  const app              = document.getElementById('app');
  const tabNameEl        = document.getElementById('tabName');
  const powerBtn         = document.getElementById('powerBtn');
  const resetBtn         = document.getElementById('resetBtn');
  const volumeSlider     = document.getElementById('volumeSlider');
  const volumeValue      = document.getElementById('volumeValue');
  const ringFill         = document.getElementById('ringFill');
  const bassSlider       = document.getElementById('bassSlider');
  const bassValue        = document.getElementById('bassValue');
  const voiceSlider      = document.getElementById('voiceSlider');
  const voiceValue       = document.getElementById('voiceValue');
  const compressorToggle = document.getElementById('compressorToggle');
  const presetGrid       = document.getElementById('presetGrid');
  const volPresetBtns    = document.querySelectorAll('.vol-preset-btn');
  const themeBtn         = document.getElementById('themeBtn');
  const globalVolumeToggle = document.getElementById('globalVolumeToggle');
  const siteMemoryBadge  = document.getElementById('siteMemoryBadge');
  const visualizerCanvas = document.getElementById('liveVisualizer');
  const ctx2d            = visualizerCanvas.getContext('2d');

  const volWarnOverlay   = document.getElementById('volWarnOverlay');
  const volWarnCancel    = document.getElementById('volWarnCancel');
  const volWarnConfirm   = document.getElementById('volWarnConfirm');
  const volWarnNever     = document.getElementById('volWarnNever');

  // ── State ───────────────────────────────────────────────────────────
  let currentTabId  = null;
  let currentHost   = null;
  let siteMemoryActive = false;
  let currentTheme = 'dark'; // default
  let hasConfirmedHighVolume = false;
  let pendingHighVolume = null;
  let isAudible = false;
  let isGlobalVolume = false;

  const DEFAULT_STATE = {
    volume: 100,
    bassBoost: 0,
    voiceBoost: 0,
    compressor: true,
    preset: 'none',
    enabled: true,
    neverWarnHighVolume: false
  };

  let state = { ...DEFAULT_STATE };

  // ── Ring Constants ──────────────────────────────────────────────────
  const RING_CIRCUMFERENCE = 2 * Math.PI * 70; // r=70 => 439.82

  // ── Live Visualizer State ───────────────────────────────────────────
  const NUM_BARS   = 40;
  const barOffsets = Array.from({ length: NUM_BARS }, (_, i) => Math.random() * Math.PI * 2);
  const barSpeeds  = Array.from({ length: NUM_BARS }, (_, i) => 0.6 + Math.random() * 1.2);
  let   vizTime    = 0;
  let   rafId      = null;

  // ── Initialize ──────────────────────────────────────────────────────
  async function init() {
    // Inject SVG gradient into the ring
    const svg = document.querySelector('.ring-svg');
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradient.setAttribute('id', 'ringGradient');
    gradient.setAttribute('x1', '0%'); gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '100%'); gradient.setAttribute('y2', '100%');
    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', '#9b7fff');
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', '#7c5cfc');
    gradient.appendChild(stop1); gradient.appendChild(stop2);
    defs.appendChild(gradient);
    svg.insertBefore(defs, svg.firstChild);

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = tab.id;
      isAudible = !!tab.audible;
      tabNameEl.textContent = truncate(tab.title || tab.url || 'Current Tab', 30);
      try {
        currentHost = new URL(tab.url).hostname;
      } catch (_) {
        currentHost = null;
      }
    }

    // Theme Logic
    await initTheme();

    // Load Global Volume Preference first
    chrome.runtime.sendMessage({ type: 'GET_GLOBAL_PREF' }, (globalPref) => {
      if (globalPref && globalPref.global_vol_enabled) {
        isGlobalVolume = true;
        globalVolumeToggle.checked = true;
      }

      // Load saved state for this tab
      chrome.runtime.sendMessage({ type: 'GET_STATE', tabId: currentTabId }, async (response) => {
        if (chrome.runtime.lastError) return;
        if (response) state = { ...state, ...response };

        // If Global Volume is on, it overrides site memory and tab state
        if (isGlobalVolume && globalPref.global_vol !== undefined) {
          state.volume = globalPref.global_vol;
          siteMemoryBadge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Global Memory`;
          siteMemoryBadge.classList.add('visible');
          applyUIState();
          pushState();
          if (currentTabId) {
            chrome.tabs.sendMessage(currentTabId, { type: 'FORCE_SCAN' }).catch(() => {});
          }
        } 
        // Otherwise use per-site volume memory
        else if (currentHost) {
          chrome.runtime.sendMessage({ type: 'GET_SITE_VOLUME', hostname: currentHost }, (res) => {
            if (chrome.runtime.lastError) return;
            if (res && res.volume !== null && res.volume !== undefined) {
              state.volume = res.volume;
              siteMemoryBadge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Site Memory`;
              siteMemoryBadge.classList.add('visible');
            }
            applyUIState();
            pushState();
            if (currentTabId) {
              chrome.tabs.sendMessage(currentTabId, { type: 'FORCE_SCAN' }).catch(() => {});
            }
          });
        } else {
          applyUIState();
          pushState();
          if (currentTabId) {
            chrome.tabs.sendMessage(currentTabId, { type: 'FORCE_SCAN' }).catch(() => {});
          }
        }
      });
    });

    bindEvents();
    startVisualizer();
  }

  // ── Bind UI Events ──────────────────────────────────────────────────
  function bindEvents() {
    // Listen for tab audio state changes to pause/resume visualizer
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (tabId === currentTabId && changeInfo.audible !== undefined) {
        isAudible = changeInfo.audible;
      }
    });

    // Theme Toggle
    themeBtn.addEventListener('click', toggleTheme);

    // Power toggle
    powerBtn.addEventListener('click', () => {
      state.enabled = !state.enabled;
      applyUIState();
      pushState();
    });

    // Reset
    resetBtn.addEventListener('click', () => {
      state = { ...DEFAULT_STATE };
      siteMemoryActive = false;
      siteMemoryBadge.classList.remove('visible');
      applyUIState();
      pushState();
      // Save reset volume for site too
      saveSiteVolume(DEFAULT_STATE.volume);
      // Visual feedback
      resetBtn.style.transition = 'transform 0.4s ease';
      resetBtn.style.transform = 'rotate(-360deg)';
      setTimeout(() => { resetBtn.style.transform = ''; }, 450);
    });

    // Volume slider
    volumeSlider.addEventListener('input', (e) => {
      const newVol = parseInt(e.target.value, 10);
      
      // Warning threshold
      if (newVol > 800 && !hasConfirmedHighVolume && !state.neverWarnHighVolume && newVol > state.volume) {
        pendingHighVolume = newVol;
        volumeSlider.value = Math.min(state.volume, 800); // snap back temporarily
        volWarnOverlay.setAttribute('aria-hidden', 'false');
        return;
      }

      state.volume = newVol;
      updateVolumeUI();
      updateVolPresetHighlight();
      forceApply();
      saveSiteVolume(state.volume);
    });

    // Warning Dialog Actions
    volWarnCancel.addEventListener('click', () => {
      volWarnOverlay.setAttribute('aria-hidden', 'true');
      pendingHighVolume = null;
      // Ensure slider max value reflects any preset over 1000 (though we removed 1000, keep for safety)
      if (state.volume > parseInt(volumeSlider.max, 10)) {
        volumeSlider.max = state.volume;
        document.querySelector('.slider-max').textContent = state.volume + '%';
      } else if (volumeSlider.max > 1000 && state.volume <= 1000) {
        volumeSlider.max = 1000;
        document.querySelector('.slider-max').textContent = '1000%';
      }
      state.volume = Math.min(state.volume, 800);
      volumeSlider.value = state.volume;
      updateVolumeUI();
      updateVolPresetHighlight();
      forceApply();
    });

    volWarnConfirm.addEventListener('click', () => {
      volWarnOverlay.setAttribute('aria-hidden', 'true');
      hasConfirmedHighVolume = true;
      if (pendingHighVolume !== null) {
        state.volume = pendingHighVolume;
        volumeSlider.value = state.volume;
        updateVolumeUI();
        updateVolPresetHighlight();
        forceApply();
        saveSiteVolume(state.volume);
        pendingHighVolume = null;
      }
    });

    volWarnNever.addEventListener('click', () => {
      volWarnOverlay.setAttribute('aria-hidden', 'true');
      hasConfirmedHighVolume = true;
      state.neverWarnHighVolume = true;
      pushState();
      
      if (pendingHighVolume !== null) {
        state.volume = pendingHighVolume;
        volumeSlider.value = state.volume;
        updateVolumeUI();
        updateVolPresetHighlight();
        forceApply();
        saveSiteVolume(state.volume);
        pendingHighVolume = null;
      }
    });

    // Bass slider
    bassSlider.addEventListener('input', (e) => {
      state.bassBoost = parseInt(e.target.value, 10);
      bassValue.textContent = `${state.bassBoost} dB`;
      updateSliderFill(bassSlider, state.bassBoost, 0, 15, '#f59e0b');
      pushState();
    });

    // Voice slider
    voiceSlider.addEventListener('input', (e) => {
      state.voiceBoost = parseInt(e.target.value, 10);
      voiceValue.textContent = `${state.voiceBoost} dB`;
      updateSliderFill(voiceSlider, state.voiceBoost, 0, 15, '#34d399');
      pushState();
    });

    // Compressor toggle
    compressorToggle.addEventListener('change', () => {
      state.compressor = compressorToggle.checked;
      pushState();
    });

    // Global Volume toggle
    globalVolumeToggle.addEventListener('change', () => {
      isGlobalVolume = globalVolumeToggle.checked;
      chrome.runtime.sendMessage({
        type: 'SET_GLOBAL_PREF',
        enabled: isGlobalVolume,
        volume: state.volume
      }, () => { void chrome.runtime.lastError; });
      
      if (isGlobalVolume) {
        siteMemoryBadge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Global Memory`;
        siteMemoryBadge.classList.add('visible');
      } else {
        // Turning it off reverts to Site Memory
        siteMemoryBadge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Site Memory`;
        saveSiteVolume(state.volume);
      }
    });

    // Volume preset buttons
    volPresetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const vol = parseInt(btn.dataset.vol, 10);
        
        if (vol > 800 && !hasConfirmedHighVolume && !state.neverWarnHighVolume) {
          pendingHighVolume = vol;
          volWarnOverlay.setAttribute('aria-hidden', 'false');
          return;
        }

        state.volume = vol;
        volumeSlider.value = vol;
        updateVolumeUI();
        updateVolPresetHighlight();
        forceApply();
        saveSiteVolume(vol);
      });
    });

    // EQ preset buttons
    presetGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.preset-btn');
      if (!btn) return;
      state.preset = btn.dataset.preset;
      presetGrid.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pushState();
    });
  }

  // ── Per-Site or Global Volume Memory ───────────────────────────────
  function saveSiteVolume(volume) {
    if (isGlobalVolume) {
      chrome.runtime.sendMessage({
        type: 'SET_GLOBAL_PREF',
        enabled: true,
        volume: volume
      }, () => { void chrome.runtime.lastError; });
      return;
    }

    if (!currentHost) return;
    chrome.runtime.sendMessage({
      type: 'SET_SITE_VOLUME',
      hostname: currentHost,
      volume
    }, () => { void chrome.runtime.lastError; });
    siteMemoryActive = true;
    siteMemoryBadge.classList.add('visible');
  }

  // ── Apply Full UI State ─────────────────────────────────────────────
  function applyUIState() {
    // Enabled/disabled
    if (state.enabled) {
      app.classList.remove('disabled');
      powerBtn.classList.remove('disabled');
    } else {
      app.classList.add('disabled');
      powerBtn.classList.add('disabled');
    }

    // Volume
    volumeSlider.value = state.volume;
    updateVolumeUI();
    updateVolPresetHighlight();

    // Bass
    bassSlider.value = state.bassBoost;
    bassValue.textContent = `${state.bassBoost} dB`;
    updateSliderFill(bassSlider, state.bassBoost, 0, 15, '#f59e0b');

    // Voice
    voiceSlider.value = state.voiceBoost;
    voiceValue.textContent = `${state.voiceBoost} dB`;
    updateSliderFill(voiceSlider, state.voiceBoost, 0, 15, '#34d399');

    // Compressor
    compressorToggle.checked = state.compressor;

    // EQ Presets
    presetGrid.querySelectorAll('.preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === state.preset);
    });
  }

  // ── Update Volume UI (ring + value + slider fill) ───────────────────
  function updateVolumeUI() {
    const vol = state.volume;
    volumeValue.textContent = `${vol}%`;

    const fraction = Math.min(vol / 1000, 1);
    const offset   = RING_CIRCUMFERENCE * (1 - fraction);
    ringFill.style.strokeDasharray  = RING_CIRCUMFERENCE;
    ringFill.style.strokeDashoffset = offset;

    // Dynamic ring color
    if (vol <= 100) {
      ringFill.style.stroke = '';
    } else if (vol <= 500) {
      ringFill.style.stroke = '#fbbf24';
    } else {
      ringFill.style.stroke = '#f87171';
    }

    // Slider fill
    // Use maximum of whatever slider max is dynamically, default 1000
    const maxVal = parseInt(volumeSlider.max, 10) || 1000;
    const pct = vol / maxVal;
    let color = '#7c5cfc';
    if (vol > 800) color = '#ef4444';
    else if (vol > 300) color = '#f59e0b';
    const trackColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated').trim();
    
    // Pixel-perfect thumb alignment (16px thumb width)
    const thumbOffset = (0.5 - pct) * 16;
    volumeSlider.style.background = `linear-gradient(to right, ${color} calc(${pct * 100}% + ${thumbOffset}px), ${trackColor} calc(${pct * 100}% + ${thumbOffset}px))`;
  }

  // ── Volume Preset Highlight ─────────────────────────────────────────
  function updateVolPresetHighlight() {
    volPresetBtns.forEach(btn => {
      const bvol = parseInt(btn.dataset.vol, 10);
      btn.classList.toggle('active', bvol === state.volume);
    });
  }

  // ── Generic Slider Fill ─────────────────────────────────────────────
  function updateSliderFill(slider, value, min, max, color) {
    const pct = (value - min) / (max - min);
    const trackColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated').trim();
    const thumbOffset = (0.5 - pct) * 16;
    slider.style.background = `linear-gradient(to right, ${color} calc(${pct * 100}% + ${thumbOffset}px), ${trackColor} calc(${pct * 100}% + ${thumbOffset}px))`;
  }

  // ── Push State to Background + Content Script ─────────────────────
  function pushState() {
    if (!currentTabId) return;

    // 1. Persist to background (which also forwards APPLY_STATE to the tab)
    chrome.runtime.sendMessage({
      type: 'SET_STATE',
      tabId: currentTabId,
      state: { ...state }
    }, () => {
      // Suppress runtime errors (e.g. SW restarting) silently
      void chrome.runtime.lastError;
    });

    // 2. Also send APPLY_STATE directly to the tab's content script as a
    //    redundant path — ensures audio updates even if the background
    //    message ordering has delays.
    chrome.tabs.sendMessage(currentTabId, {
      type: 'APPLY_STATE',
      state: { ...state }
    }).catch(() => {});
  }

  function forceApply() {
    pushState();
    if (currentTabId) {
      chrome.tabs.sendMessage(currentTabId, { type: 'FORCE_SCAN' }).catch(() => {});
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // THEME MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════

  async function initTheme() {
    const res = await chrome.storage.local.get('soundflux_theme');
    if (res.soundflux_theme) {
      currentTheme = res.soundflux_theme;
    } else {
      // Default to Dark Mode
      currentTheme = 'dark';
    }
    applyTheme();
  }

  function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    chrome.storage.local.set({ soundflux_theme: currentTheme });
    applyTheme();
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    const svgPath = currentTheme === 'dark' 
      ? 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' // Moon
      : 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.36-7.36l-.71.71M6.34 17.66l-.71.71m12.02 0l.71.71M6.34 6.34l.71.71M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'; // Sun
    
    const icon = themeBtn.querySelector('svg');
    if(icon) {
      icon.innerHTML = `<path d="${svgPath}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // LIVE AUDIO VISUALIZER
  // ══════════════════════════════════════════════════════════════════════

  function startVisualizer() {
    let accentColor = '#6366f1';
    let warningColor = '#f59e0b';
    let dangerColor = '#ef4444';

    function updateColors() {
      const root = getComputedStyle(document.documentElement);
      accentColor = root.getPropertyValue('--accent').trim() || accentColor;
      warningColor = root.getPropertyValue('--warning').trim() || warningColor;
      dangerColor = root.getPropertyValue('--danger').trim() || dangerColor;
    }
    
    // Initial color grab
    updateColors();
    // Update colors when theme changes
    themeBtn.addEventListener('click', () => {
      setTimeout(updateColors, 50); // slight delay to allow CSS to apply
    });

    let currentVolFraction = 0;

    function drawFrame() {
      rafId = requestAnimationFrame(drawFrame);

      const W = visualizerCanvas.width;
      const H = visualizerCanvas.height;
      ctx2d.clearRect(0, 0, W, H);

      // Amplitude driven by volume and whether music is actually playing:
      let targetFraction = state.enabled ? Math.min(1.0, 0.3 + (state.volume / 1200)) : 0.05;
      if (!isAudible) targetFraction = 0.02; // Flatline when paused/no audio
      
      // Smooth interpolation so it gracefully falls/rises
      currentVolFraction += (targetFraction - currentVolFraction) * 0.1;

      const barW   = (W - (NUM_BARS - 1) * 2) / NUM_BARS;
      const gap    = 2;
      const maxH   = H * 0.92;

      vizTime += 0.04;

      for (let i = 0; i < NUM_BARS; i++) {
        // Layered sinusoidal animation for organic feel
        const wave1 = Math.sin(vizTime * barSpeeds[i] + barOffsets[i]);
        const wave2 = Math.sin(vizTime * barSpeeds[i] * 0.7 + barOffsets[i] * 1.3) * 0.4;
        const wave  = (wave1 + wave2) / 1.4;
        const norm  = (wave + 1) / 2; // 0..1

        // Bass band bars are taller (simulate frequency spectrum look)
        const freqCurve = 1 - Math.abs(i / NUM_BARS - 0.2) * 0.6; // peaks at ~20% from left
        const barHeight = Math.max(2, norm * maxH * currentVolFraction * freqCurve);

        const x = i * (barW + gap);
        const y = H - barHeight;

        // Color based on volume
        let barColor = accentColor;
        if (state.volume > 400) barColor = dangerColor;
        else if (state.volume > 200) barColor = warningColor;

        // Create a nice sleek gradient for each bar
        const gradient = ctx2d.createLinearGradient(x, y, x, H);
        gradient.addColorStop(0, barColor);
        // Fade to transparent at the bottom
        gradient.addColorStop(1, 'transparent');

        ctx2d.fillStyle = gradient;
        ctx2d.beginPath();
        // Rounded top corners
        ctx2d.roundRect(x, y, barW, barHeight, [2, 2, 0, 0]);
        ctx2d.fill();
      }
    }

    drawFrame();
  }

  // ── External Links (target=_blank blocked in extension popups) ───────
  function bindExternalLinks() {
    const authorLink  = document.getElementById('authorLink');
    const sponsorBtn  = document.getElementById('sponsorBtn');

    if (authorLink) {
      authorLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'https://www.ajaykeshri.com' });
      });
    }

    if (sponsorBtn) {
      sponsorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'https://github.com/sponsors/ajaykeshri881' });
      });
    }
  }

  // ── Utility ─────────────────────────────────────────────────────────
  function truncate(str, max) {
    return str.length > max ? str.substring(0, max) + '…' : str;
  }

  // ── Boot ─────────────────────────────────────────────────────────────
  bindExternalLinks();
  init();
})();
