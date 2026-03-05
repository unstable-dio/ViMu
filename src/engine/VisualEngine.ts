import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export interface VisualData {
    bass: number;
    mid: number;
    high: number;
    energy: number;
}

// ------------------------------------------------------------------
//  Chromatic Aberration post-process shader
// ------------------------------------------------------------------
const ChromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        uAmount: { value: 0.0005 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uAmount;
        varying vec2 vUv;
        void main() {
            vec2 dir    = vUv - 0.5;
            float dist  = length(dir);
            vec2 offset = uAmount * dist * normalize(dir);
            float r = texture2D(tDiffuse, vUv - offset).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv + offset).b;
            gl_FragColor = vec4(r, g, b, 1.0);
        }
    `,
};

// ------------------------------------------------------------------
//  Floor vertex shader — GPU-animated, forward-scrolling
// ------------------------------------------------------------------
const floorVertexShader = `
    uniform float uTime;
    uniform float uBass;
    varying vec3 vPosition;
    varying float vWave;

    void main() {
        vPosition = position;
        
        // The camera is at world Z=6, floor center is at world Z=-54.
        // So in the floor's local space, the camera is sitting exactly at the near edge: vec2(0.0, 60.0).
        float dist = distance(position.xz, vec2(0.0, 60.0));

        // Radial ripple driven by bass (Converges towards camera from the horizon)
        float radial = sin(dist * 0.4 + uTime * 4.0) * (uBass * 3.0)
                     + sin(dist * 0.8 + uTime * 6.0) * (uBass * 1.2);

        // Forward scroll along Z — constant motion toward camera from the horizon
        float scroll = sin(position.z * 0.5  - uTime * 5.0) * 0.18
                     + sin(position.z * 0.25 - uTime * 3.0) * 0.10;

        float wave = radial + scroll * (1.0 + uBass * 2.5);

        // The camera is at world Z=6, floor is at world Z=-10.
        // So in the floor's local space, the camera is sitting at Z=16.
        // We calculate distance to the camera and flatten any waves within a 1-unit radius,
        // smoothly blending back to full wave height by 15 units away.
        float cameraDist = distance(position.xz, vec2(0.0, 60.0));
        float cameraMask = smoothstep(1.0, 15.0, cameraDist);
        wave *= cameraMask;

        vWave = wave;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0.0, wave, 0.0), 1.0);
    }
`;

const floorFragmentShader = `
    precision mediump float;
    uniform float uTime;
    varying vec3 vPosition;
    varying float vWave;

    void main() {
        // Discard fragments far from the camera to save GPU fillrate
        float cameraDist = distance(vPosition.xz, vec2(0.0, 60.0));
        if (cameraDist > 110.0) discard;

        float t = clamp((vPosition.x + 20.0) / 40.0, 0.0, 1.0);
        vec3 col = mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 0.0, 1.0), t);
        float intensity = clamp(smoothstep(0.0, 0.9, 0.2 + abs(vWave) * 0.5), 0.0, 0.7);
        
        // Fade out gently before hitting the discard plane
        float alpha = smoothstep(110.0, 80.0, cameraDist);
        gl_FragColor = vec4(col * intensity * alpha, 1.0);
    }
`;

const roofVertexShader = `
    uniform float uTime;
    uniform float uBass;
    varying vec3 vPosition;
    varying float vWave;

    void main() {
        vPosition = position;
        float dist = length(position.xz);

        // Radial ripple driven by bass
        float radial = sin(dist * 0.4 - uTime * 4.0) * (uBass * 3.0)
                     + sin(dist * 0.8 - uTime * 6.0) * (uBass * 1.2);

        // Forward scroll along Z
        float scroll = sin(position.z * 0.5  + uTime * 5.0) * 0.18
                     + sin(position.z * 0.25 + uTime * 3.0) * 0.10;

        float wave = radial + scroll * (1.0 + uBass * 2.5);

        // Tunnel curve: arch the sides down significantly more so they meet/pass the floor.
        // position.x * position.x * 0.025 means at x=40 (the edge) it drops by 40 units down.
        // We also add +4.0 so the very top of the tunnel drops a bit to close the horizon gap.
        float curve = (position.x * position.x * 0.025) + 4.0;

        // Dampen waves near the camera
        float cameraDist = distance(position.xz, vec2(0.0, 16.0));
        float cameraMask = smoothstep(1.0, 15.0, cameraDist);
        wave *= cameraMask;

        vWave = wave;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0.0, wave + curve, 0.0), 1.0);
    }
`;

// ------------------------------------------------------------------
//  VisualEngine — floor only
// ------------------------------------------------------------------
export class VisualEngine {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private composer!: EffectComposer;
    private chromaticPass!: ShaderPass;

    private floorMesh!: THREE.Mesh;
    private floorUniforms!: { uTime: { value: number }; uBass: { value: number }; uColor1: { value: THREE.Color }; uColor2: { value: THREE.Color } };

    // Roof (mirrors the floor, reacts to highs)
    private roofMesh!: THREE.LineSegments;
    private roofUniforms!: { uTime: { value: number }; uHighs: { value: number }; uColor1: { value: THREE.Color }; uColor2: { value: THREE.Color } };

    // Chromatic aberration base amount (0–1 user scale, mapped internally)
    private chromaticBase = 0.0005;

    // Bloom pass reference for live strength control
    private bloomPass!: UnrealBloomPass;

    public setColors(color1: THREE.Color, color2: THREE.Color) {
        this.floorUniforms.uColor1.value.copy(color1);
        this.floorUniforms.uColor2.value.copy(color2);
        this.roofUniforms.uColor1.value.copy(color1);
        this.roofUniforms.uColor2.value.copy(color2);
    }

    public setChromaticAmount(normalised: number) {
        // normalised: 0–1 from slider → internal range 0–0.008
        this.chromaticBase = normalised * 0.008;
    }

    public setBloomStrength(normalised: number) {
        // normalised: 0–1 from slider → internal range 0–2.0
        this.bloomPass.strength = normalised * 2.0;
    }

    constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        this.scene.fog = new THREE.FogExp2(0x000000, 0.04);

        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
        // The floor is at Y = -10. To get the low-angle perspective from the reference image, 
        // we put the camera just slightly above the floor.
        this.camera.position.set(0, -8.5, 6);
        this.camera.lookAt(0, -8.5, -30);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        container.appendChild(this.renderer.domElement);

        this.buildPostProcessing();
        this.createFloor();
        this.setupEvents();
    }

    private buildPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        // Render bloom at exactly half the window resolution to massively save GPU fillrate
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
            0.9,  // strength
            0.6,  // radius
            0.2   // threshold
        );
        this.composer.addPass(this.bloomPass);

        this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
        this.composer.addPass(this.chromaticPass);
    }

    private createFloor() {
        // High-res floor geometry
        const floorGeo = new THREE.PlaneGeometry(80, 200, 400, 400);
        floorGeo.rotateX(-Math.PI / 2);

        const color1 = new THREE.Color(0x00ffff); // Cyan
        const color2 = new THREE.Color(0xff00ff); // Magenta

        this.floorUniforms = {
            uTime: { value: 0 },
            uBass: { value: 0 },
            uColor1: { value: color1.clone() },
            uColor2: { value: color2.clone() }
        };
        this.roofUniforms = {
            uTime: { value: 0 },
            uHighs: { value: 0 },
            uColor1: { value: color1.clone() },
            uColor2: { value: color2.clone() }
        };

        const materialParams = {
            uniforms: this.floorUniforms,
            vertexShader: floorVertexShader,
            fragmentShader: `
                precision mediump float;
                uniform float uTime;
                uniform vec3 uColor1;
                uniform vec3 uColor2;
                varying vec3 vPosition;
                varying float vWave;

                void main() {
                    float cameraDist = distance(vPosition.xz, vec2(0.0, 60.0));
                    if (cameraDist > 110.0) discard;

                    float t = clamp((vPosition.x + 20.0) / 40.0, 0.0, 1.0);
                    vec3 col = mix(uColor1, uColor2, t);
                    float intensity = clamp(smoothstep(0.0, 0.9, 0.2 + abs(vWave) * 0.5), 0.0, 0.7);
                    
                    float alpha = smoothstep(110.0, 80.0, cameraDist);
                    gl_FragColor = vec4(col * intensity * alpha, 1.0);
                }
            `,
            wireframe: true,
            side: THREE.DoubleSide
        };

        const solidMaterialParams = {
            uniforms: this.floorUniforms,
            vertexShader: floorVertexShader,
            fragmentShader: `void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }`,
            wireframe: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        };

        const floorWireMat = new THREE.ShaderMaterial(materialParams);
        const floorSolidMat = new THREE.ShaderMaterial(solidMaterialParams);

        // Custom shader for the roof warp lines
        const roofWarpVertexShader = `
            uniform float uTime;
            uniform float uHighs;
            varying vec3 vPosition;
            varying float vWave; 

            void main() {
                vPosition = position;
                float speed = 25.0;
                float zOffset = mod(position.z + uTime * speed, 120.0) - 100.0;
                float curve = position.x * position.x * 0.015;
                float dist = abs(zOffset);
                float alpha = smoothstep(5.0, 30.0, dist) * smoothstep(110.0, 80.0, dist);
                vWave = alpha;

                gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, position.y - curve, zOffset, 1.0);
            }
        `;

        const roofWarpFragmentShader = `
            precision mediump float;
            uniform float uHighs;
            uniform vec3 uColor1;
            uniform vec3 uColor2;
            varying vec3 vPosition;
            varying float vWave;

            void main() {
                float t = clamp((vPosition.x + 20.0) / 40.0, 0.0, 1.0);
                vec3 col = mix(uColor1, uColor2, t);
                float intensity = vWave * (0.2 + uHighs * 2.5);
                gl_FragColor = vec4(col * intensity, 1.0);
            }
        `;

        const roofWireMat = new THREE.ShaderMaterial({
            vertexShader: roofWarpVertexShader,
            fragmentShader: roofWarpFragmentShader,
            uniforms: this.roofUniforms,
            transparent: true,
            blending: THREE.AdditiveBlending
        });

        // Floor Mesh
        this.floorMesh = new THREE.Mesh(floorGeo, floorWireMat);
        this.floorMesh.position.set(0, -10, -54);
        this.floorMesh.frustumCulled = false;
        this.floorMesh.matrixAutoUpdate = false;
        this.floorMesh.updateMatrix();
        this.scene.add(this.floorMesh);

        // Floor Solid Mesh
        const floorSolid = new THREE.Mesh(floorGeo, floorSolidMat);
        floorSolid.position.set(0, -10, -54);
        floorSolid.frustumCulled = false;
        floorSolid.matrixAutoUpdate = false;
        floorSolid.updateMatrix();
        this.scene.add(floorSolid);

        // Build radial warp streaks for the roof
        const roofPositions = [];
        const numStreaks = 400;
        for (let i = 0; i < numStreaks; i++) {
            const x = (Math.pow(Math.random(), 1.5) * (Math.random() > 0.5 ? 1 : -1)) * 50.0;
            const startZ = Math.random() * -100.0;
            const length = 5.0 + Math.random() * 20.0;
            roofPositions.push(x, 0, startZ);
            roofPositions.push(x, 0, startZ - length);
        }

        const roofGeo = new THREE.BufferGeometry();
        roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPositions, 3));

        this.roofMesh = new THREE.LineSegments(roofGeo, roofWireMat);
        this.roofMesh.position.set(0, 15.0, -10);
        this.roofMesh.frustumCulled = false;
        this.scene.add(this.roofMesh);
    }

    private setupEvents() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);

            // Re-enforce half-resolution for the bloom pass on window resize
            this.bloomPass.setSize(
                window.innerWidth / 2,
                window.innerHeight / 2
            );
        });
    }

    public update(data: VisualData) {
        const time = performance.now() * 0.001;

        // Chromatic amount = base (from slider) + small energy pulse on top
        (this.chromaticPass.uniforms as typeof ChromaticAberrationShader.uniforms)
            .uAmount.value = this.chromaticBase + data.energy * 0.001;

        this.floorUniforms.uTime.value = time;
        this.floorUniforms.uBass.value = data.bass;

        // Roof is driven by highs
        this.roofUniforms.uTime.value = time;
        this.roofUniforms.uHighs.value = data.high;

        this.composer.render();
    }
}
