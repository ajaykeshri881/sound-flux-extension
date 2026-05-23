# Sound Flux

Boost audio volume up to 1000% with a live visualizer, custom EQ presets, compressor, and per-site volume memory. Sound Flux is a powerful browser extension that dramatically enhances your audio listening experience on the web.

## Features

- **Volume Booster:** Increase audio volume up to 1000% beyond the system default for any media playing in your browser.
- **Live Audio Visualizer:** Real-time visual representation of the audio currently being played.
- **Custom EQ Presets:** Tailor your sound with adjustable equalizer settings and save your own custom presets for different types of content (music, movies, podcasts).
- **Audio Compressor:** Balance the loud and quiet parts of your audio for a consistent listening experience without constantly adjusting the volume.
- **Per-Site Volume Memory:** Automatically remembers and applies your preferred volume settings for individual websites.
- **Cross-Frame Audio Capture:** Reliably captures and processes audio even when it's embedded across different frames.

## Tech Stack

- **Platform:** Chrome Extension (Manifest V3)
- **Languages:** HTML5, CSS3, JavaScript (ES6+)
- **APIs & Core Technologies:**
  - **Web Audio API:** The core engine used for real-time audio processing, volume boosting, equalization, dynamic range compression, and extracting visualizer data.
  - **Chrome Storage API:** Used for persistently saving user preferences, custom EQ presets, and per-site volume states.
  - **Chrome Scripting & Tabs APIs:** Essential for interacting with the active tab and injecting necessary audio processing scripts.
  - **Service Workers (`background.js`):** Operates background processes efficiently using the Manifest V3 background service worker pattern.
  - **Main World Content Scripts (`injected.js`):** Injects scripts directly into the page's main execution environment to reliably intercept and hook into web audio contexts (`window.AudioContext`).
