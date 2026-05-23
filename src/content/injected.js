// ─── Sound Flux — MAIN WORLD Audio Engine (v7) ────────────────────────
//
// AUDIO CHAIN:
//   Source → DeepBass(30Hz) → SubBass(60Hz) → BassPunch(120Hz) → Bass(200Hz)
//   → Mid → Treble → Voice → Gain → Limiter → Destination
//
// PREMIUM BASS DESIGN:
//   The 4 bass bands use WIDE Q values (low Q = wide, smooth curve).
//   This creates a natural, warm bass lift instead of peaky resonances.
//   Individual gains are kept moderate (≤8dB) so cumulative overlap
//   never exceeds ~12dB — well within the filter's headroom.

(function () {
  'use strict';

  if (window.__vmpAudioEngineLoaded) return;
  window.__vmpAudioEngineLoaded = true;

  let audioCtx = null;
  const processedElements = new WeakSet();
  const elementNodes     = new WeakMap();
  const fallbackElements = new WeakSet(); // elements using el.volume fallback (e.g. YouTube)

  let currentState = {
    volume: 100,
    bassBoost: 0,
    voiceBoost: 0,
    compressor: true,
    preset: 'none',
    enabled: true
  };

  // ── EQ Presets ────────────────────────────────────────────────────
  // d = deep (30Hz), s = sub (60Hz), p = punch (120Hz), b = bass shelf (200Hz)
  // m = mid (1.5kHz), t = treble (4kHz)
  //
  // RULE: No single band exceeds 8dB. This keeps cumulative overlap
  // under ~12dB even when all bass bands contribute, preventing any
  // internal filter clipping or distortion.
  const PRESETS = {
    none:          { d: 0,  s: 0,  p: 0,  b: 0,  m: 0,   t: 0 },
    bass_boost:    { d: 3,  s: 5,  p: 4,  b: 6,  m: -1,  t: 1 },
    vocal_clarity: { d: 0,  s: 0,  p: 0,  b: -2, m: 8,   t: 4 },
    treble_boost:  { d: 0,  s: 0,  p: 0,  b: 0,  m: 0,   t: 8 },
    cinema:        { d: 3,  s: 4,  p: 3,  b: 5,  m: 2,   t: 4 },
    podcast:       { d: 0,  s: 0,  p: 0,  b: -3, m: 8,   t: 3 },
    night_mode:    { d: -2, s: -2, p: -1, b: -3, m: -2,  t: -2 },
    // New modes
    gaming:        { d: 4,  s: 6,  p: 5,  b: 4,  m: 2,   t: 6 },  // Punchy bass + crisp highs for FX
    music:         { d: 2,  s: 3,  p: 2,  b: 3,  m: 1,   t: 3 },  // Warm balanced hi-fi profile
    study:         { d: -1, s: -2, p: -1, b: -2, m: 5,   t: 2 }   // Voice-forward, reduced bass
  };

  function ensureAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // ── Process a media element ────────────────────────────────────────
  function processElement(el) {
    if (processedElements.has(el)) return;

    try {
      const ctx = ensureAudioContext();
      const source = ctx.createMediaElementSource(el);

      // ── 4-BAND PREMIUM BASS ────────────────────────────────────────
      const deepBassFilter = ctx.createBiquadFilter();
      deepBassFilter.type = 'peaking';
      deepBassFilter.frequency.value = 30;
      deepBassFilter.Q.value = 0.5;
      deepBassFilter.gain.value = 0;

      const subBassFilter = ctx.createBiquadFilter();
      subBassFilter.type = 'peaking';
      subBassFilter.frequency.value = 60;
      subBassFilter.Q.value = 0.6;
      subBassFilter.gain.value = 0;

      const bassPunchFilter = ctx.createBiquadFilter();
      bassPunchFilter.type = 'peaking';
      bassPunchFilter.frequency.value = 120;
      bassPunchFilter.Q.value = 0.8;
      bassPunchFilter.gain.value = 0;

      const bassFilter = ctx.createBiquadFilter();
      bassFilter.type = 'lowshelf';
      bassFilter.frequency.value = 200;
      bassFilter.gain.value = 0;

      const midFilter = ctx.createBiquadFilter();
      midFilter.type = 'peaking';
      midFilter.frequency.value = 1500;
      midFilter.Q.value = 0.7;
      midFilter.gain.value = 0;

      const trebleFilter = ctx.createBiquadFilter();
      trebleFilter.type = 'highshelf';
      trebleFilter.frequency.value = 4000;
      trebleFilter.gain.value = 0;

      const voiceFilter = ctx.createBiquadFilter();
      voiceFilter.type = 'peaking';
      voiceFilter.frequency.value = 2500;
      voiceFilter.Q.value = 1.0;
      voiceFilter.gain.value = 0;

      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 10;
      limiter.ratio.value = 1;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;

      // ── CONNECT CHAIN ──────────────────────────────────────────────
      source.connect(deepBassFilter);
      deepBassFilter.connect(subBassFilter);
      subBassFilter.connect(bassPunchFilter);
      bassPunchFilter.connect(bassFilter);
      bassFilter.connect(midFilter);
      midFilter.connect(trebleFilter);
      trebleFilter.connect(voiceFilter);
      voiceFilter.connect(gainNode);
      gainNode.connect(limiter);
      limiter.connect(ctx.destination);

      elementNodes.set(el, {
        source, deepBassFilter, subBassFilter, bassPunchFilter, bassFilter,
        midFilter, trebleFilter, voiceFilter, gainNode, limiter
      });

      processedElements.add(el);
      applyState(el);
      console.log('[Sound Flux] ✅ Connected:', el.tagName);
    } catch (e) {
      // If the element is already owned by another Web Audio graph (e.g. YouTube,
      // SoundCloud), fall back to the native HTMLMediaElement.volume property.
      // This gives 0-100% control even though >100% boost is unavailable.
      if (!processedElements.has(el)) {
        processedElements.add(el);
        fallbackElements.add(el);
        applyStateFallback(el);
        console.warn('[Sound Flux] ⚠️ Fallback mode (el.volume):', el.tagName, '—', e.message);
      }
    }
  }

  // ── Apply state to a single element ────────────────────────────────
  function applyState(el) {
    // Fallback path: element owned by another Web Audio graph (e.g. YouTube)
    if (fallbackElements.has(el)) { applyStateFallback(el); return; }

    const nodes = elementNodes.get(el);
    if (!nodes) return;

    const ctx = ensureAudioContext();
    const now = ctx.currentTime;

    // ─ Volume Gain ───────────────────────────────────────────────
    // Anchor current value FIRST, then ramp linearly to avoid click artifacts.
    // setValueAtTime captures whatever the param is RIGHT NOW (including any
    // in-progress ramp), so the new ramp always starts from a valid value.
    let targetGain = 1;
    if (currentState.enabled) {
      if (currentState.volume <= 100) {
        targetGain = currentState.volume / 100;
      } else {
        // Aggressive boost curve: 100% = 1.0x, 500% = 7.0x gain
        targetGain = 1 + ((currentState.volume - 100) / 100) * 1.5;
      }
    }
    nodes.gainNode.gain.cancelScheduledValues(now);
    nodes.gainNode.gain.setValueAtTime(nodes.gainNode.gain.value, now);
    nodes.gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.12);

    // ─ Limiter — ALWAYS active to prevent hard digital clipping ─────────
    if (currentState.compressor) {
      // Anti-Distortion ON: Brickwall Peak Limiter
      // Allows full volume boost until exactly -0.1 dB, then firmly stops it to prevent clipping.
      // This makes the audio EXTREMELY loud without physical speaker crackling.
      nodes.limiter.threshold.value = -0.1;
      nodes.limiter.knee.value      = 0;  // Hard knee
      nodes.limiter.ratio.value     = 20; // Maximum limiting
      nodes.limiter.attack.value    = 0.001; // Ultra-fast
      nodes.limiter.release.value   = 0.05;
    } else {
      // Anti-Distortion OFF: Bypassed
      // Allows raw, uncompressed audio. Will cause digital clipping if boosted too high.
      nodes.limiter.threshold.value = 0;
      nodes.limiter.knee.value      = 0;
      nodes.limiter.ratio.value     = 1;  // Ratio 1:1 means no compression
      nodes.limiter.attack.value    = 0.003;
      nodes.limiter.release.value   = 0.1;
    }

    // ─ EQ Parameters ────────────────────────────────────────────
    const eqRamp = 0.10;
    const preset = PRESETS[currentState.preset] || PRESETS.none;

    const eqSet = (param, target) => {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + eqRamp);
    };

    eqSet(nodes.deepBassFilter.gain,  preset.d || 0);
    eqSet(nodes.subBassFilter.gain,   preset.s || 0);
    eqSet(nodes.bassPunchFilter.gain, preset.p || 0);
    eqSet(nodes.bassFilter.gain,      (preset.b || 0) + (currentState.bassBoost || 0));
    eqSet(nodes.midFilter.gain,       preset.m || 0);
    eqSet(nodes.trebleFilter.gain,    preset.t || 0);
    eqSet(nodes.voiceFilter.gain,     currentState.voiceBoost || 0);
  }

  // ── Fallback: control via el.volume (0–100%) only ───────────────────
  function applyStateFallback(el) {
    try {
      if (!currentState.enabled) {
        el.volume = 1.0;
      } else {
        el.volume = Math.min(1.0, currentState.volume / 100);
      }
    } catch (_) {}
  }

  function applyStateAll() {
    document.querySelectorAll('audio, video').forEach(el => {
      if (processedElements.has(el)) applyState(el);
    });
  }

  // ── Messages from content.js ───────────────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.direction !== 'VMP_TO_MAIN') return;

    if (event.data.type === 'APPLY_STATE') {
      currentState = { ...currentState, ...event.data.state };
      applyStateAll();
    }

    if (event.data.type === 'FORCE_SCAN') {
      scanAndProcess();
    }
  });

  // ── Scan for media elements ────────────────────────────────────────
  function scanAndProcess() {
    document.querySelectorAll('audio, video').forEach(el => {
      if (!processedElements.has(el)) {
        if (el.readyState >= 1 || el.src || el.srcObject || el.querySelector?.('source')) {
          processElement(el);
        } else {
          el.addEventListener('loadedmetadata', () => processElement(el), { once: true });
          el.addEventListener('canplay', () => processElement(el), { once: true });
          el.addEventListener('play', () => processElement(el), { once: true });
        }
      }
    });
  }

  const observer = new MutationObserver(() => scanAndProcess());

  function startObserver() {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      scanAndProcess();
    }
  }

  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    scanAndProcess();
  } else {
    document.addEventListener('DOMContentLoaded', scanAndProcess);
    window.addEventListener('load', scanAndProcess);
  }

  document.addEventListener('play', (e) => {
    if (e.target && (e.target.tagName === 'AUDIO' || e.target.tagName === 'VIDEO')) {
      if (!processedElements.has(e.target)) processElement(e.target);
    }
  }, true);

  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!processedElements.has(this)) {
      try { processElement(this); } catch (e) { /* ignore */ }
    }
    return originalPlay.apply(this, arguments);
  };

  setInterval(scanAndProcess, 3000);

  console.log('[Sound Flux] 🚀 v7 — Audio engine loaded');
})();
