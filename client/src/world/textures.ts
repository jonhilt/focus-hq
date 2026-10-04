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

export function woodTexture(): THREE.Texture {
  return cached('wood', () => {
    const { canvas, ctx } = makeCanvas(256, 256);
    const colors = ['#d9a066', '#cf9458', '#e0aa70', '#d39c60'];
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(0, i * 32, 256, 32);
      ctx.fillStyle = 'rgba(80,40,10,0.35)';
      ctx.fillRect(0, i * 32, 256, 2);
      const seam = ((i * 97) % 200) + 20;
      ctx.fillRect(seam, i * 32, 2, 32);
    }
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

export function skyTexture(): THREE.Texture {
  return cached('sky', () => {
    const { canvas, ctx } = makeCanvas(256, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#5ec8ff');
    g.addColorStop(1, '#c9f0ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#ffffff';
    for (const [x, y, s] of [[60, 70, 1], [180, 50, 0.8], [140, 120, 0.6]]) {
      ctx.beginPath();
      ctx.arc(x, y, 22 * s, 0, Math.PI * 2);
      ctx.arc(x + 24 * s, y - 10 * s, 26 * s, 0, Math.PI * 2);
      ctx.arc(x + 50 * s, y, 20 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // rolling hills and a tree line
    ctx.fillStyle = '#7bd389';
    ctx.beginPath();
    ctx.moveTo(0, 256);
    for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, 205 + Math.sin(x / 30) * 12);
    ctx.lineTo(256, 256);
    ctx.fill();
    ctx.fillStyle = '#4caf6a';
    ctx.beginPath();
    ctx.moveTo(0, 256);
    for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, 228 + Math.cos(x / 22) * 8);
    ctx.lineTo(256, 256);
    ctx.fill();
    return canvasTexture(canvas);
  });
}

export const tiled = {
  checker: (a: string, b: string, x: number, y: number) => repeat(checkerTexture(a, b).clone(), x, y),
  wood: (x: number, y: number) => repeat(woodTexture().clone(), x, y),
  carpet: (color: string, x: number, y: number) => repeat(carpetTexture(color).clone(), x, y),
};
