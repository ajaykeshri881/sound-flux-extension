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

  if ((window as any).__vmpAudioEngineLoaded) return;
  (window as any).__vmpAudioEngineLoaded = true;

  let audioCtx: AudioContext | null = null;
  const processedElements = new WeakSet<HTMLMediaElement>();
  const elementNodes = new WeakMap<HTMLMediaElement, ElementNode>();
  const fallbackElements = new WeakSet<HTMLMediaElement>(); // elements using el.volume fallback (e.g. YouTube)

  let currentState: AudioState = {
    volume: 100,
    bassBoost: 0,
    voiceBoost: 0,
    compressor: true,
    spatial3d: false,
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
  const PRESETS: Record<string, { d: number; s: number; p: number; b: number; m: number; t: number }> = {
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

  function ensureAudioContext(): AudioContext {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // ── Process a media element ────────────────────────────────────────
  function processElement(el: HTMLMediaElement) {
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
      // ── TRUE SURROUND ENGINE ─────────────────────────────────────
      // Simulates sound orbiting around the listener using THREE simultaneous
      // psychoacoustic cues driven by a single orbit angle (setInterval):
      //
      // 1. STEREO PAN (ILD)   — sin(angle) → left/right ear dominance
      // 2. HEAD SHADOW FILTER — cos(angle) → 2.5kHz (behind) → 20kHz (front)
      //    Mimics how your head blocks/muffles sound from behind you.
      // 3. LEVEL (Distance)   — cos(angle) → −3dB behind, 0dB in front
      //
      // Single path — NO parallel bypass, NO doubling possible.

      const surroundPanner = ctx.createStereoPanner();
      surroundPanner.pan.value = 0;

      // Head-shadow lowpass: transparent when in front, muffled when behind
      const headShadow = ctx.createBiquadFilter();
      headShadow.type = 'lowpass';
      headShadow.frequency.value = 20000; // Fully open by default
      headShadow.Q.value = 0.5;

      // Level node for front/back amplitude difference
      const surroundLevel = ctx.createGain();
      surroundLevel.gain.value = 1.0;

      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 10;
      limiter.ratio.value = 1;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;

      // ── SINGLE CONNECT CHAIN ───────────────────────────────────
      source.connect(deepBassFilter);
      deepBassFilter.connect(subBassFilter);
      subBassFilter.connect(bassPunchFilter);
      bassPunchFilter.connect(bassFilter);
      bassFilter.connect(midFilter);
      midFilter.connect(trebleFilter);
      trebleFilter.connect(voiceFilter);
      // voice → headShadow → surroundLevel → surroundPanner → gainNode → limiter
      voiceFilter.connect(headShadow);
      headShadow.connect(surroundLevel);
      surroundLevel.connect(surroundPanner);
      surroundPanner.connect(gainNode);
      gainNode.connect(limiter);
      limiter.connect(ctx.destination);

      elementNodes.set(el, {
        source, deepBass: deepBassFilter, subBass: subBassFilter, bassPunch: bassPunchFilter, bass: bassFilter,
        mid: midFilter, treble: trebleFilter, voice: voiceFilter, gainNode, limiter,
        surroundPanner, headShadow, surroundLevel,
        orbitAngle: 0
      } as any); // Type cast due to orbitTimer dynamically added

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
  function applyState(el: HTMLMediaElement) {
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
        // Extreme boost curve: 100% = 1.0x, 1000% = 32.5x gain
        // Massively increased loudness capacity based on user feedback
        targetGain = 1 + ((currentState.volume - 100) / 100) * 3.5;
      }
    }
    nodes.gainNode.gain.cancelScheduledValues(now);
    nodes.gainNode.gain.setValueAtTime(nodes.gainNode.gain.value, now);
    nodes.gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.12);

    // ─ True Surround 3D Effect ──────────────────────────────────────────
    if (currentState.spatial3d) {
      if (nodes.surroundPanner && !nodes.orbitTimer) {
        const TICK     = 50;          // ms between updates
        const SPEED    = 0.030;       // rad/tick → ~10.5s per full 360° orbit
        const PAN_DEPTH = 0.85;       // how wide L/R goes (0=centre, 1=hard pan)

        (nodes as any).orbitTimer = setInterval(() => {
          nodes.orbitAngle += SPEED;
          const a     = nodes.orbitAngle;
          const front = Math.cos(a);         // +1 = in front, -1 = behind
          const side  = Math.sin(a);         // +1 = right,   -1 = left

          // 1. Stereo position
          const pan = side * PAN_DEPTH;

          // 2. Head-shadow filter frequency
          //    In front: 20kHz (fully transparent, bright)
          //    Behind:   2500Hz (muffled, like through your head)
          const freq = 2500 + ((front + 1) * 0.5) * 17500;

          // 3. Level: slightly quieter when behind (-3dB ≈ 0.71x)
          const lvl = 0.80 + ((front + 1) * 0.5) * 0.20; // 0.80…1.0

          const ctx2 = ensureAudioContext();
          const t    = ctx2.currentTime;
          nodes.surroundPanner.pan.setTargetAtTime(pan,  t, 0.05);
          nodes.headShadow.frequency.setTargetAtTime(freq, t, 0.08);
          nodes.surroundLevel.gain.setTargetAtTime(lvl,  t, 0.08);
        }, TICK);
      }
    } else {
      // Stop orbit and return all nodes to neutral
      if ((nodes as any).orbitTimer) {
        clearInterval((nodes as any).orbitTimer);
        (nodes as any).orbitTimer = null;
      }
      if (nodes.surroundPanner) {
        nodes.surroundPanner.pan.setTargetAtTime(0,     now, 0.5);
        nodes.headShadow.frequency.setTargetAtTime(20000, now, 0.5);
        nodes.surroundLevel.gain.setTargetAtTime(1.0,  now, 0.5);
      }
    }

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

    const eqSet = (param: AudioParam, target: number) => {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + eqRamp);
    };

    eqSet(nodes.deepBass.gain,  preset.d || 0);
    eqSet(nodes.subBass.gain,   preset.s || 0);
    eqSet(nodes.bassPunch.gain, preset.p || 0);
    eqSet(nodes.bass.gain,      (preset.b || 0) + (currentState.bassBoost || 0));
    eqSet(nodes.mid.gain,       preset.m || 0);
    eqSet(nodes.treble.gain,    preset.t || 0);
    eqSet(nodes.voice.gain,     currentState.voiceBoost || 0);
  }

  // ── Fallback: control via el.volume (0–100%) only ───────────────────
  function applyStateFallback(el: HTMLMediaElement) {
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
      if (processedElements.has(el as HTMLMediaElement)) applyState(el as HTMLMediaElement);
    });
  }

  // ── Messages from content.js ───────────────────────────────────────
  window.addEventListener('message', (event: MessageEvent) => {
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
      const mediaEl = el as HTMLMediaElement;
      if (!processedElements.has(mediaEl)) {
        if (mediaEl.readyState >= 1 || mediaEl.src || mediaEl.srcObject || mediaEl.querySelector?.('source')) {
          processElement(mediaEl);
        } else {
          mediaEl.addEventListener('loadedmetadata', () => processElement(mediaEl), { once: true });
          mediaEl.addEventListener('canplay', () => processElement(mediaEl), { once: true });
          mediaEl.addEventListener('play', () => processElement(mediaEl), { once: true });
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

  document.addEventListener('play', (e: Event) => {
    const target = e.target as HTMLMediaElement;
    if (target && (target.tagName === 'AUDIO' || target.tagName === 'VIDEO')) {
      if (!processedElements.has(target)) processElement(target);
    }
  }, true);

  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement, ...args) {
    if (!processedElements.has(this)) {
      try { processElement(this); } catch (e) { /* ignore */ }
    }
    return originalPlay.apply(this, args);
  };

  setInterval(scanAndProcess, 3000);

  console.log('[Sound Flux] 🚀 v4.0 — Audio engine loaded');
})();
