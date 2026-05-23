// Global types for Sound Flux

interface AudioState {
  volume: number;
  bassBoost: number;
  voiceBoost: number;
  compressor: boolean;
  preset: string;
  enabled: boolean;
  spatial3d?: boolean;
}

interface ElementNode {
  source: MediaElementAudioSourceNode;
  deepBass: BiquadFilterNode;
  subBass: BiquadFilterNode;
  bassPunch: BiquadFilterNode;
  bass: BiquadFilterNode;
  mid: BiquadFilterNode;
  treble: BiquadFilterNode;
  voice: BiquadFilterNode;
  headShadow: BiquadFilterNode;
  surroundLevel: GainNode;
  surroundPanner: StereoPannerNode;
  gainNode: GainNode;
  limiter: DynamicsCompressorNode;
  orbitAngle?: number;
  orbitTimer?: number | NodeJS.Timeout | null;
}
