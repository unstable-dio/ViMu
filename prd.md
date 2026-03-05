# ViMu - Product Requirements Document

## 1. Visual Architecture
The application will render a 3D environment with a centralized vanishing point to create a "warp speed" perspective.

- **Primary Waveforms**: Two high-amplitude, glowing neon "strings" positioned on the left (Cyan/Blue) and right (Purple/Pink).
- **Floor Grid**: A horizontal plane consisting of low-amplitude, undulating strings that move continuously from the foreground to the background.
- **Ceiling Starfield**: A collection of thin, white linear particles radiating from the center toward the camera to simulate forward motion.

## 2. Technical Requirements
- **Graphics Engine**: [Three.js](https://threejs.org/) (WebGL) for 3D rendering and camera perspective.
- **Audio Processing**: Web Audio API using `AnalyserNode` to extract real-time frequency data.
- **Post-Processing**: A "Bloom" pass to create the signature neon glow on the primary strings.

## 3. Functional Logic (The "Flow")
- **Data Mapping**: The vertical displacement ($Y$-axis) of the front-most string points is mapped to the `byteFrequencyData` of the music.
- **The Propagation Algorithm**: Use a "Shift and Push" logic for the floor grid. Every 16ms (60fps), the waveform data from row $N$ is passed to row $N+1$, creating the visual illusion of sound traveling into the distance.

### Dynamic Reactivity
- **Bass**: Controls the amplitude (height) of the floor grid ripples.
- **Mids/Highs**: Controls the "jitter" and peak intensity of the two primary side-strings.