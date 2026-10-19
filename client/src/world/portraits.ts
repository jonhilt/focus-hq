import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import type { Avatar } from '../../../shared/types';
import { Character } from './character';

// Head-and-shoulders portraits of the crew, for the boards that list them (goalScreens.ts): each one their own
// Character, lit and outlined as aboard, rendered once in a little booth of its own and kept for whoever has the
// same looks.

const SIZE = 192;

interface Booth {
  renderer: THREE.WebGLRenderer;
  effect: OutlineEffect;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

let booth: Booth | null | undefined;
const portraits = new Map<string, HTMLCanvasElement>();

/** A booth of its own, so drawing a portrait never touches the ship's renderer: null where there's no WebGL. */
function open(): Booth | null {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#d9c7a8', 1.9), new THREE.AmbientLight('#ffffff', 0.35));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.3);
    sun.position.set(6, 10, 4);
    scene.add(sun);
    // a Character faces +X: from in front of them, a little above, framing the head and the top of the shoulders
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 10);
    camera.position.set(2.2, 1.32, 0.35);
    camera.lookAt(0, 1.18, 0);
    const effect = new OutlineEffect(renderer, { defaultThickness: 0.006, defaultColor: [0.1, 0.1, 0.12], defaultAlpha: 1 });
    return { renderer, effect, scene, camera };
  } catch {
    return null;
  }
}

/** A crew member's portrait, on a transparent background; null where it can't be drawn (no WebGL). */
export function portrait(avatar: Avatar): HTMLCanvasElement | null {
  const key = JSON.stringify(avatar);
  const kept = portraits.get(key);
  if (kept) return kept;
  if (booth === undefined) booth = open();
  if (!booth) return null;
  const sitter = new Character({ name: '', avatar, status: 'done', line: '' });
  sitter.group.traverse((o) => {
    if (o instanceof THREE.Sprite) o.visible = false;
  });
  sitter.update(0);
  booth.scene.add(sitter.group);
  // the outline effect leaves clearing to whoever renders: without it, each portrait lands on the last
  booth.renderer.clear();
  booth.effect.render(booth.scene, booth.camera);
  booth.scene.remove(sitter.group);
  sitter.dispose();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  canvas.getContext('2d')?.drawImage(booth.renderer.domElement, 0, 0);
  portraits.set(key, canvas);
  return canvas;
}
