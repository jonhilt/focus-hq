import * as THREE from 'three';
import { canvasTexture, makeCanvas } from './canvas';

function repeat(tex: THREE.Texture, x: number, y: number): THREE.Texture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(x, y);
  tex.needsUpdate = true;
  return tex;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let tex = cache.get(key);
  if (!tex) cache.set(key, (tex = make()));
  return tex;
}

export function checkerTexture(a: string, b: string): THREE.Texture {
  return cached(`checker${a}${b}`, () => {
    const { canvas, ctx } = makeCanvas(128, 128);
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillRect(64, 64, 64, 64);
    return canvasTexture(canvas);
  });
}

export function carpetTexture(color: string): THREE.Texture {
  return cached(`carpet${color}`, () => {
    const { canvas, ctx } = makeCanvas(128, 128);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 128, 128);
    const base = new THREE.Color(color);
    for (let i = 0; i < 900; i++) {
      const c = base.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
    return canvasTexture(canvas);
  });
}

export const tiled = {
  carpet: (color: string, x: number, y: number) => repeat(carpetTexture(color).clone(), x, y),
};
