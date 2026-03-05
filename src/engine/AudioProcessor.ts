import Meyda from 'meyda';

export interface SpectralMap {
    timestamps: number[];
    bass: number[];
    mid: number[];
    high: number[];
    energy: number[];
}

export class AudioProcessor {
    private audioContext: AudioContext | null = null;

    // Running peak per channel for adaptive normalization
    private peakBass = 0.001;
    private peakMid = 0.001;
    private peakHigh = 0.001;
    private peakEnergy = 0.001;

    private getContext(): AudioContext {
        if (!this.audioContext) {
            this.audioContext = new AudioContext();
        }
        return this.audioContext;
    }

    async analyze(audioFile: File, onProgress?: (percent: number) => void): Promise<SpectralMap> {
        const ctx = this.getContext();
        const arrayBuffer = await audioFile.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        const spectralMap: SpectralMap = {
            timestamps: [],
            bass: [],
            mid: [],
            high: [],
            energy: []
        };

        const bufferSize = 2048;
        const sampleRate = audioBuffer.sampleRate;
        const channelData = audioBuffer.getChannelData(0);

        // Reset peaks for new file
        this.peakBass = 0.001;
        this.peakMid = 0.001;
        this.peakHigh = 0.001;
        this.peakEnergy = 0.001;

        const totalChunks = Math.floor(channelData.length / bufferSize);

        for (let i = 0; i < channelData.length; i += bufferSize) {
            const chunkIndex = Math.floor(i / bufferSize);
            if (onProgress && chunkIndex % 50 === 0) {
                onProgress(chunkIndex / totalChunks);
            }

            const signal = channelData.slice(i, i + bufferSize);
            if (signal.length < bufferSize) break;

            const features = Meyda.extract(['amplitudeSpectrum', 'energy'], signal);

            if (features) {
                const spectrum = features.amplitudeSpectrum as Float32Array;

                const rawBass = this.getAverageIndexed(spectrum, 0, 10);
                const rawMid = this.getAverageIndexed(spectrum, 10, 100);
                const rawHigh = this.getAverageIndexed(spectrum, 100, 256);
                const rawEnergy = features.energy as number;

                // Track running peaks with a bit of "leeway" (95th percentile approach)
                // This prevents singular loud pops from squashing the entire visual headroom.
                this.peakBass = Math.max(this.peakBass * 0.999, rawBass);
                this.peakMid = Math.max(this.peakMid * 0.999, rawMid);
                this.peakHigh = Math.max(this.peakHigh * 0.999, rawHigh);
                this.peakEnergy = Math.max(this.peakEnergy * 0.999, rawEnergy);

                spectralMap.timestamps.push(i / sampleRate);
                spectralMap.bass.push(rawBass);
                spectralMap.mid.push(rawMid);
                spectralMap.high.push(rawHigh);
                spectralMap.energy.push(rawEnergy);
            }
        }

        if (onProgress) onProgress(1);

        // Normalize all values to 0–1 using the peaks found during analysis
        for (let i = 0; i < spectralMap.timestamps.length; i++) {
            spectralMap.bass[i] = Math.min(spectralMap.bass[i] / this.peakBass, 1);
            spectralMap.mid[i] = Math.min(spectralMap.mid[i] / this.peakMid, 1);
            spectralMap.high[i] = Math.min(spectralMap.high[i] / this.peakHigh, 1);
            spectralMap.energy[i] = Math.min(spectralMap.energy[i] / this.peakEnergy, 1);
        }

        return spectralMap;
    }

    // Fix #11: Use indexed loop instead of allocating a new slice array on every call.
    private getAverageIndexed(data: Float32Array, start: number, end: number): number {
        const actualEnd = Math.min(end, data.length);
        if (actualEnd <= start) return 0;
        let sum = 0;
        for (let i = start; i < actualEnd; i++) {
            sum += data[i];
        }
        return sum / (actualEnd - start);
    }
}
