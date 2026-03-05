import './style.css'
import { VisualEngine, VisualData } from './engine/VisualEngine'
import { AudioProcessor, SpectralMap } from './engine/AudioProcessor'
import { MetadataProcessor, Metadata } from './engine/MetadataProcessor'
import * as THREE from 'three'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <div id="ui">
    <div id="album-art-container">
        <img id="album-art" src="" alt="" style="display: none;" />
    </div>
    <h1>ViMu</h1>
    <div id="metadata-info">
        <div id="track-title"></div>
        <div id="track-artist"></div>
    </div>
    <p>Upload a track to begin the experience</p>
    <div class="input-wrapper">
      <input type="file" id="audio-input" accept="audio/*" />
      <label for="audio-input">Choose Audio File</label>
    </div>
    <div id="status"></div>
    <div id="progress-container"><div id="progress-bar"></div></div>
  </div>

  <div id="controls">
    <div class="slider-row">
      <label for="sync-colors">Sync to Art</label>
      <input type="checkbox" id="sync-colors" checked />
    </div>
    <div class="slider-row">
      <label for="chroma-slider">Chromatic</label>
      <input type="range" id="chroma-slider" min="0" max="100" value="6" />
      <span id="chroma-value">6%</span>
    </div>
    <div class="slider-row">
      <label for="bloom-slider">Bloom</label>
      <input type="range" id="bloom-slider" min="0" max="100" value="45" />
      <span id="bloom-value">45%</span>
    </div>
    <div id="keyboard-hint">Press ESC to go back</div>
  </div>
`

const visualEngine = new VisualEngine(app);
const audioProcessor = new AudioProcessor();
const metadataProcessor = new MetadataProcessor();

const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const progressBar = document.querySelector<HTMLDivElement>('#progress-bar')!;
const inputEl = document.querySelector<HTMLInputElement>('#audio-input')!;
const controlsEl = document.querySelector<HTMLDivElement>('#controls')!;
const chromaSlider = document.querySelector<HTMLInputElement>('#chroma-slider')!;
const chromaValue = document.querySelector<HTMLSpanElement>('#chroma-value')!;
const bloomSlider = document.querySelector<HTMLInputElement>('#bloom-slider')!;
const bloomValue = document.querySelector<HTMLSpanElement>('#bloom-value')!;
const syncToggle = document.querySelector<HTMLInputElement>('#sync-colors')!;
const albumArt = document.querySelector<HTMLImageElement>('#album-art')!;
const trackTitle = document.querySelector<HTMLDivElement>('#track-title')!;
const trackArtist = document.querySelector<HTMLDivElement>('#track-artist')!;

// Default Colors
const CYAN = new THREE.Color(0x00ffff);
const MAGENTA = new THREE.Color(0xff00ff);

// Set initial values
visualEngine.setChromaticAmount(parseInt(chromaSlider.value) / 100);
visualEngine.setBloomStrength(parseInt(bloomSlider.value) / 100);

chromaSlider.addEventListener('input', () => {
    const pct = parseInt(chromaSlider.value);
    chromaValue.textContent = `${pct}%`;
    visualEngine.setChromaticAmount(pct / 100);
});

bloomSlider.addEventListener('input', () => {
    const pct = parseInt(bloomSlider.value);
    bloomValue.textContent = `${pct}%`;
    visualEngine.setBloomStrength(pct / 100);
});

// ----------------------------------------------------------------
//  Audio lifecycle
// ----------------------------------------------------------------
let currentMap: SpectralMap | null = null;
let currentMetadata: Metadata | null = null;
let isPlaying = false;
let audio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

function stopCurrentAudio() {
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    isPlaying = false;
    currentMap = null;
    currentMetadata = null;
    resetIdleTimer(true); // Show UI when stopping

    // Reset UI
    albumArt.style.display = 'none';
    albumArt.src = '';
    trackTitle.innerText = '';
    trackArtist.innerText = '';
    visualEngine.setColors(CYAN, MAGENTA);

    // Show selection menu
    document.querySelector('#ui')?.classList.remove('hidden');
    controlsEl.classList.remove('visible');
    statusEl.classList.remove('visible');
}

function updateVisualColors() {
    if (syncToggle.checked && currentMetadata?.colors) {
        visualEngine.setColors(currentMetadata.colors.primary, currentMetadata.colors.secondary);
    } else {
        visualEngine.setColors(CYAN, MAGENTA);
    }
}

syncToggle.addEventListener('change', updateVisualColors);

function togglePlayPause() {
    if (!audio || !currentMap) return;
    if (isPlaying) {
        audio.pause();
        isPlaying = false;
        resetIdleTimer(true); // Show UI when paused
    } else {
        audio.play();
        isPlaying = true;
        resetIdleTimer(); // Start/Restart idle timer when playing
    }
}

inputEl.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    stopCurrentAudio();
    statusEl.innerText = 'Extracting metadata...';
    statusEl.classList.add('visible');

    try {
        currentMetadata = await metadataProcessor.extract(file);
        if (currentMetadata.title) trackTitle.innerText = currentMetadata.title;
        if (currentMetadata.artist) trackArtist.innerText = currentMetadata.artist;
        if (currentMetadata.artUrl) {
            albumArt.src = currentMetadata.artUrl;
            albumArt.style.display = 'block';
        }

        updateVisualColors();

        statusEl.innerText = 'Analyzing spectrum...';
        progressBar.style.width = '0%';

        currentMap = await audioProcessor.analyze(file, (pct) => {
            progressBar.style.width = `${pct * 100}%`;
        });

        statusEl.innerText = 'Analysis complete!';
        progressBar.style.width = '0%';

        currentObjectUrl = URL.createObjectURL(file);
        audio = new Audio(currentObjectUrl);
        audio.play();
        isPlaying = true;

        audio.addEventListener('ended', () => {
            isPlaying = false;
            document.querySelector('#ui')?.classList.remove('hidden');
            controlsEl.classList.remove('visible');
        });

        document.querySelector('#ui')?.classList.add('hidden');
        controlsEl.classList.add('visible');
        resetIdleTimer();
    } catch (err) {
        statusEl.innerText = 'Error: ' + (err as Error).message;
    }
});

// ----------------------------------------------------------------
//  Keyboard & Idle Controls
// ----------------------------------------------------------------
let idleTimer: number | null = null;
const IDLE_TIME = 3000;

function resetIdleTimer(forceShow = false) {
    if (idleTimer) clearTimeout(idleTimer);

    controlsEl.classList.remove('hidden-idle');
    document.body.classList.remove('hide-cursor');

    if (!isPlaying || forceShow) return;

    idleTimer = window.setTimeout(() => {
        if (isPlaying) {
            controlsEl.classList.add('hidden-idle');
            document.body.classList.add('hide-cursor');
        }
    }, IDLE_TIME);
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
    } else if (e.code === 'Escape') {
        e.preventDefault();
        stopCurrentAudio();
    }
    resetIdleTimer();
});

window.addEventListener('mousemove', () => {
    resetIdleTimer();
});

// ----------------------------------------------------------------
//  Binary search — O(log n) per frame
// ----------------------------------------------------------------
function binarySearch(timestamps: number[], target: number): number {
    let lo = 0, hi = timestamps.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (timestamps[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

// ----------------------------------------------------------------
//  Render loop with smoothed visual decay
// ----------------------------------------------------------------
let rafId: number;
const currentVisuals: VisualData = { bass: 0, mid: 0, high: 0, energy: 0 };
const ATTACK_RATE = 0.4;
const DECAY_RATE = 0.05;

function animate() {
    rafId = requestAnimationFrame(animate);

    if (isPlaying && currentMap && audio) {
        const idx = binarySearch(currentMap.timestamps, audio.currentTime);

        // Fast attack, normal decay for punchy response while playing
        currentVisuals.bass += ((currentMap.bass[idx] ?? 0) - currentVisuals.bass) * ATTACK_RATE;
        currentVisuals.mid += ((currentMap.mid[idx] ?? 0) - currentVisuals.mid) * ATTACK_RATE;
        currentVisuals.high += ((currentMap.high[idx] ?? 0) - currentVisuals.high) * ATTACK_RATE;
        currentVisuals.energy += ((currentMap.energy[idx] ?? 0) - currentVisuals.energy) * ATTACK_RATE;
    } else {
        // Music stopped: smooth decay down to 0 instead of snapping instantly
        currentVisuals.bass *= (1 - DECAY_RATE);
        currentVisuals.mid *= (1 - DECAY_RATE);
        currentVisuals.high *= (1 - DECAY_RATE);
        currentVisuals.energy *= (1 - DECAY_RATE);

        // Snap to pure 0 when nearly flat to prevent micro-math forever
        if (currentVisuals.energy < 0.001) {
            currentVisuals.bass = currentVisuals.mid = currentVisuals.high = currentVisuals.energy = 0;
        }
    }

    visualEngine.update(currentVisuals);
}

animate();

export function stopVimu() {
    cancelAnimationFrame(rafId);
    stopCurrentAudio();
}
