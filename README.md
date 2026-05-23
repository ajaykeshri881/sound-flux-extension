# Sound Flux

Boost your audio listening experience on the web with a professional, premium-grade extension. Sound Flux goes beyond simple volume boosting by providing a true audiophile toolkit right in your browser. 

Features include up to 1000% volume amplification, a true surround 3D spatial engine, anti-distortion limiters, premium bass/vocal tuning, dynamic live visualizer, and an elegant glassmorphism UI.

## ✨ Key Features

- **Volume Booster (up to 1000%):** Increase audio volume massively beyond system limits. Uses a proprietary exponential gain curve to handle extreme boosts while minimizing artifacting.
- **True Surround 3D Spatial Audio:** A sophisticated interval-based 3D engine that simulates sound orbiting your head. It uses three simultaneous psychoacoustic cues: stereo panning (ILD), head-shadow lowpass filtering (timbre shifts), and distance attenuation (level fading).
- **Anti-Distortion Engine:** Built-in dynamic range compressor acts as a brickwall limiter. Prevents severe audio clipping and protects your speakers when pushing volumes to the extreme.
- **Premium Sound Tuning:** 
  - **Bass Boost:** Uses 4 wide-Q cascading filter bands (Deep, Sub, Punch, Bass) for a warm, distortion-free lift.
  - **Voice Clarity:** Custom peaking filters to isolate and enhance dialogue, making podcasts and movies crystal clear.
- **10 EQ Presets:** Tailor your sound with presets including *Bass+, Vocal, Treble+, Cinema, Podcast, Night, Gaming, Music,* and *Study*.
- **Live Audio Visualizer:** A stunning, buttery-smooth HTML5 Canvas visualizer that reacts in real-time to the audio waveform.
- **Per-Site Volume Memory:** Automatically remembers and applies your preferred volume and EQ settings on a per-domain basis.
- **Premium UI / UX:** Beautiful glassmorphism aesthetic with seamless Light/Dark mode support, animated icons, and non-intrusive toast notifications.

## 💻 Tech Stack

- **Platform:** Chrome Extension (Manifest V3)
- **Languages:** HTML5, CSS3, Vanilla JavaScript (ES6+)
- **APIs & Core Technologies:**
  - **Web Audio API:** The beating heart of the extension. Used for all real-time audio processing (`GainNode`, `DynamicsCompressorNode`, `BiquadFilterNode`, `StereoPannerNode`).
  - **HTML5 Canvas:** Powers the high-performance live visualizer rendering.
  - **Chrome Storage API (`chrome.storage.local`):** Persistently saves user configurations and domain-specific settings.
  - **Chrome Scripting & Tabs APIs:** Injects the core audio routing scripts into the active tabs.
  - **DOM & CSS Variables:** Handles dynamic theming (Light/Dark mode) and interactive glassmorphism UI elements without any heavy frontend frameworks.

## 📂 File Architecture

The extension is structured cleanly to separate the UI, the background service worker, and the injected audio engine.

```text
sound-flux-extension/
├── manifest.json              # Extension configuration, permissions, and entry points
├── README.md                  # Project documentation (You are here)
├── icons/                     # Extension icons (16x16, 48x48, 128x128)
│
└── src/                       # Source Code
    ├── background/            
    │   └── background.js      # Service Worker: Manages state, tab injection, and messaging
    │
    ├── content/               
    │   ├── content.js         # Bridge: Injects injected.js into the main page execution world
    │   └── injected.js        # Core Audio Engine: Runs in the page's main world. 
    │                          # Hijacks HTMLMediaElements to route audio through the Web Audio API graph.
    │
    └── popup/                 
        ├── popup.html         # UI Layout: The glassmorphism extension interface
        ├── popup.css          # UI Styling: Themes, animations, layout, and visual components
        └── popup.js           # UI Logic: Handles sliders, toggles, visualizer drawing, and message passing
```

### Deep Dive: How the Audio Routing Works

Because of Chrome's strict extension isolation, the extension cannot easily intercept audio from a standard content script. 

1. `background.js` listens for tab updates and injects `content.js` into the webpage.
2. `content.js` creates a `<script>` tag that loads `injected.js` directly into the DOM's main execution environment (Main World).
3. `injected.js` intercepts the creation of `<audio>` and `<video>` tags (or finds existing ones).
4. It passes their sources into a complex `AudioContext` graph consisting of deep bass filters, voice clarity filters, a true surround spatial panner, and finally an anti-distortion limiter before sending it to the speakers.
