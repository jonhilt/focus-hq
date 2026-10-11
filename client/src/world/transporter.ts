import * as THREE from 'three';
import { canvasTexture, makeCanvas } from './canvas';

// A Federation transporter beam, the way crew arrive and leave: a column of shimmering blue-white sparkles in a soft
// glow, the figure fading in out of it (or into it), lit up blue until it's solid.

/** How long a beam takes, start to finish. */
export const BEAM_MS = 2600;
const SPARKLES = 170;
const COLUMN = { radius: 0.36, height: 1.7 };
const GLOW = new THREE.Color('#8fd8ff');

/** 0 → 1 over [a, b], eased. */
const ramp = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How bright the sparkles are, and how solid the figure is, `p` of the way through a beam in (or out: reversed). */
export function beamPhase(p: number, mode: 'in' | 'out'): { sparkle: number; solid: number } {
  const sparkle = ramp(p, 0, 0.3) * (1 - ramp(p, 0.72, 1));
  const solid = mode === 'in' ? ramp(p, 0.25, 0.8) : 1 - ramp(p, 0.2, 0.75);
  return { sparkle, solid };
}

let dotTexture: THREE.Texture | null = null;
/** A soft round dot for the sparkles. */
function dot(): THREE.Texture {
  if (dotTexture) return dotTexture;
  const { canvas, ctx } = makeCanvas(32, 32);
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(200,236,255,0.9)');
  g.addColorStop(1, 'rgba(120,200,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return (dotTexture = canvasTexture(canvas));
}

let glowTexture: THREE.Texture | null = null;
/** The column's glow: brightest in the middle, fading out at the top and bottom. */
function glow(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const { canvas, ctx } = makeCanvas(4, 64);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 64);
  return (glowTexture = canvasTexture(canvas));
}

/** A material the beam fades, and what it was before. */
interface Faded {
  mesh: THREE.Mesh;
  original: THREE.Material;
  clone: THREE.Material & { opacity: number; emissive?: THREE.Color };
  opacity: number;
}

/**
 * One beam on a figure (a Character's group): sparkles and glow next to it in its parent, its meshes faded through
 * copies of their materials (shared materials stay untouched), put back when the beam is done.
 */
export class Beam {
  private readonly fx = new THREE.Group();
  private readonly sparkles: THREE.Points;
  private readonly column: THREE.Mesh;
  private readonly faded: Faded[] = [];
  private readonly start: number;
  private readonly height: number;
  private finished = false;

  constructor(
    private readonly figure: THREE.Object3D,
    private readonly mode: 'in' | 'out',
    now: number,
    private readonly onDone?: () => void,
  ) {
    this.start = now;
    const positions = new Float32Array(SPARKLES * 3);
    this.sparkles = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)),
      new THREE.PointsMaterial({ map: dot(), color: '#e4f6ff', size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    );
    // as tall as the figure says it is (a standing Character), or a seated one's
    const height = (figure.userData.height as number | undefined) ?? COLUMN.height;
    this.height = height;
    this.column = new THREE.Mesh(
      new THREE.CylinderGeometry(COLUMN.radius, COLUMN.radius, height, 24, 1, true),
      new THREE.MeshBasicMaterial({ map: glow(), color: GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0 }),
    );
    this.column.position.y = height / 2;
    this.fx.add(this.column, this.sparkles);
    this.fx.position.copy(figure.position);
    this.fx.rotation.copy(figure.rotation);
    figure.parent?.add(this.fx);

    figure.traverse((o) => {
      // the speech bubble fades by distance on its own
      if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
      const original = o.material as THREE.Material;
      const clone = original.clone() as Faded['clone'];
      clone.transparent = true;
      // writing no depth as it fades: its outlines, drawn from the depth, would stay as solid as ever round it
      clone.depthWrite = false;
      if (clone.emissive) clone.emissive = clone.emissive.clone();
      o.material = clone;
      this.faded.push({ mesh: o, original, clone, opacity: original.opacity });
    });
    this.update(now);
  }

  /** Moves the beam on; true once it's over (the figure is solid again, or gone). */
  update(now: number): boolean {
    if (this.finished) return true;
    const p = Math.min(1, (now - this.start) / BEAM_MS);
    const { sparkle, solid } = beamPhase(p, this.mode);

    // the sparkles twinkle: a few jump somewhere new in the column every frame
    const pos = this.sparkles.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < SPARKLES; i++) {
      if (p > 0 && Math.random() > 0.3) continue;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * COLUMN.radius * 0.9;
      pos.setXYZ(i, Math.cos(a) * r, 0.05 + Math.random() * (this.height - 0.1), Math.sin(a) * r);
    }
    pos.needsUpdate = true;
    (this.sparkles.material as THREE.PointsMaterial).opacity = sparkle;
    (this.column.material as THREE.MeshBasicMaterial).opacity = 0.5 * sparkle;

    for (const f of this.faded) {
      f.clone.opacity = f.opacity * solid;
      // glowing blue while the pattern resolves
      if (f.clone.emissive) f.clone.emissive.copy(GLOW).multiplyScalar(0.7 * sparkle * (1 - solid * 0.6));
    }
    this.figure.visible = solid > 0.01 || sparkle > 0.01;
    if (p < 1) return false;
    this.finish();
    return true;
  }

  /** Ends the beam now: the figure gets its own materials back, and the effect goes. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const f of this.faded) {
      f.mesh.material = f.original;
      f.clone.dispose();
    }
    this.figure.visible = this.mode === 'in';
    this.fx.removeFromParent();
    this.sparkles.geometry.dispose();
    (this.sparkles.material as THREE.Material).dispose();
    this.column.geometry.dispose();
    (this.column.material as THREE.Material).dispose();
    this.onDone?.();
  }
}
