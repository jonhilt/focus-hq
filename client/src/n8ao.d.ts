// n8ao ships JavaScript without types: just the part of its three.js pass that sceneRenderer.ts uses.
declare module 'n8ao' {
  import type * as THREE from 'three';

  export class N8AOPass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      halfRes: boolean;
      depthAwareUpsampling: boolean;
      autoRenderBeauty: boolean;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
    };
    beautyRenderTarget: THREE.WebGLRenderTarget;
    renderToScreen: boolean;
    setSize(width: number, height: number): void;
    render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget | null, readBuffer: THREE.WebGLRenderTarget | null): void;
    dispose(): void;
  }
}
