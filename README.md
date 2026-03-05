i vibecoded this shit
here is it deployed on vimu.ajbali.com



# ViMu

A high-performance, immersive 3D audio visualizer built with **Three.js** and **Vite**.

## Features

- **Warp Tunnel Visuals**: Radial high-frequency reactive streaks that respond to the music's energy.
- **Dynamic Floor Grid**: Real-time bass-driven waves originating from beneath the camera.
- **Pre-Analysis Engine**: Analyzes audio files before playback for perfectly synchronized visuals.
- **Immersive UX**: 
  - Keyboard playback controls (`Space` to toggle).
  - Auto-hiding UI and cursor during playback for a cinematic experience.
  - Real-time sliders for Bloom and Chromatic Aberration effects.
- **Optimized Performance**:
  - GPU-side vertex transformations.
  - Frustum clipping and LOD (Level of Detail) optimizations.
  - Shared materials and disabled matrix auto-updates for maximum FPS.

## Tech Stack

- **Three.js**: 3D Rendering engine.
- **Vite**: Modern frontend build tool.
- **TypeScript**: Static typing for robust code.
- **Post-Processing**: UnrealBloomPass and custom Chromatic Aberration shaders.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16+)
- [npm](https://www.npmjs.com/)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/vimu.git
   cd vimu
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:5173` in your browser.

## Usage

1. Click **Choose Audio File** and select an `.mp3` or `.wav` file.
2. Wait for the spectral analysis to complete.
3. Use the **Chromatic** and **Bloom** sliders to customize the intensity.
4. Press **Space** to play/pause the music.
5. Stop moving the mouse to hide the UI and enter immersive mode.

## License

MIT
