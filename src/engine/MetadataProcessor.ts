// @ts-ignore
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js';
import * as THREE from 'three';

export interface Metadata {
    title?: string;
    artist?: string;
    album?: string;
    artUrl?: string;
    colors?: {
        primary: THREE.Color;
        secondary: THREE.Color;
    };
}

export class MetadataProcessor {
    async extract(file: File): Promise<Metadata> {
        return new Promise((resolve, reject) => {
            jsmediatags.read(file, {
                onSuccess: async (tag: any) => {
                    const { title, artist, album, picture } = tag.tags;
                    let artUrl: string | undefined;
                    let colors: { primary: THREE.Color; secondary: THREE.Color } | undefined;

                    if (picture) {
                        const { data, format } = picture;
                        const base64String = data.reduce((acc: string, current: number) => acc + String.fromCharCode(current), '');
                        artUrl = `data:${format};base64,${window.btoa(base64String)}`;

                        try {
                            colors = await this.extractColors(artUrl);
                        } catch (e) {
                            console.warn('Failed to extract colors from album art', e);
                        }
                    }

                    resolve({
                        title,
                        artist,
                        album,
                        artUrl,
                        colors
                    });
                },
                onError: (error: any) => {
                    reject(error);
                }
            });
        });
    }

    private async extractColors(artUrl: string): Promise<{ primary: THREE.Color; secondary: THREE.Color }> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject('No canvas context');

                // Resize for faster processing
                canvas.width = 50;
                canvas.height = 50;
                ctx.drawImage(img, 0, 0, 50, 50);

                const data = ctx.getImageData(0, 0, 50, 50).data;
                const colorCounts: Record<string, number> = {};

                const tempColor = new THREE.Color();
                const tempHSL = { h: 0, s: 0, l: 0 };

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const a = data[i + 3];

                    if (a < 128) continue; // Skip transparent

                    // Vibrancy check: Convert to HSL to filter out junk
                    tempColor.setRGB(r / 255, g / 255, b / 255);
                    tempColor.getHSL(tempHSL as any);

                    // Skip colors that are too dark (blackish), too bright (whitish), or too gray.
                    // These make poor neon colors for a visualizer.
                    if (tempHSL.l < 0.2 || tempHSL.l > 0.85 || tempHSL.s < 0.15) {
                        continue;
                    }

                    // Reduce color space for grouping
                    const key = `${Math.round(r / 15) * 15},${Math.round(g / 15) * 15},${Math.round(b / 15) * 15}`;

                    // Weight the "count" by saturation and mid-range luminance.
                    // This makes vibrant colors more likely to win even if they aren't the majority pixel count.
                    const vibrancyWeight = tempHSL.s * (1.0 - Math.abs(tempHSL.l - 0.5) * 2.0);
                    colorCounts[key] = (colorCounts[key] || 0) + vibrancyWeight;
                }

                // If everything was filtered out (e.g., purely black/white image), do a fallback pass
                if (Object.keys(colorCounts).length === 0) {
                    for (let i = 0; i < data.length; i += 4) {
                        if (data[i + 3] < 128) continue;
                        const key = `${Math.round(data[i] / 15) * 15},${Math.round(data[i + 1] / 15) * 15},${Math.round(data[i + 2] / 15) * 15}`;
                        colorCounts[key] = (colorCounts[key] || 0) + 1;
                    }
                }

                const sortedColors = Object.entries(colorCounts)
                    .sort((a, b) => b[1] - a[1]) // Sort by weighted score
                    .map(([key]) => {
                        const [r, g, b] = key.split(',').map(Number);
                        return new THREE.Color(r / 255, g / 255, b / 255);
                    });

                // Pick primary and a secondary that is distinct enough
                const primary = sortedColors[0] || new THREE.Color(0, 1, 1);

                // Use HSL distance for better perceptual distinctness
                const primaryHSL = { h: 0, s: 0, l: 0 };
                primary.getHSL(primaryHSL as any);

                let secondary = sortedColors.find(c => {
                    const cHSL = { h: 0, s: 0, l: 0 };
                    c.getHSL(cHSL as any);
                    const hueDiff = Math.abs(cHSL.h - primaryHSL.h);
                    const wrappedHueDiff = hueDiff > 0.5 ? 1.0 - hueDiff : hueDiff;
                    // Look for distinct hue OR significantly different luminance/saturation if hue is same
                    return wrappedHueDiff > 0.15 || Math.abs(cHSL.l - primaryHSL.l) > 0.3;
                });

                // Fallback if no distinct secondary found
                if (!secondary || secondary === primary) {
                    secondary = primary.clone().offsetHSL(0.5, 0, 0);
                }

                resolve({ primary, secondary });
            };
            img.onerror = (err) => reject(err);
            img.src = artUrl;
        });
    }
}
