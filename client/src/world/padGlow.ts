import * as THREE from 'three';
import { canvasTexture, makeCanvas } from './canvas';
import { padGlow, type PadOccupant } from './workflowRooms';

// The light on a transporter pad under whoever's on it, in their phase's colour (or green or red once they've
// finished): bright across the pad inside its ring, spilling a little past its edge onto the tier, breathing while they
// work. One flat additive disc per pad, just over the pad's top and under its ring (transporter_room.py: the ring lies
// 4 mm over the pad); it writes no depth, so the outlines and the agents standing in it pass straight through.

/** How far the light reaches from a pad's middle (m): the pads are 0.36 m across and stand 0.8 m apart. */
const REACH = 0.62;
/** How far over the pad's top it lies (m): halfway to its ring. */
const LIFT = 0.002;
/** How bright the light is at its brightest: enough to colour the pad, not to wash out the agent's feet. */
const STRENGTH = 1;

let falloff: THREE.Texture | undefined;
/** White, nearly solid out to the pad's edge, then fading to nothing at `REACH`. */
function padLight(): THREE.Texture {
  if (falloff) return falloff;
  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(0.34 / REACH, 'rgba(255, 255, 255, 0.95)');
  g.addColorStop(0.42 / REACH, 'rgba(255, 255, 255, 0.4)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return (falloff = canvasTexture(canvas));
}

export class PadGlows {
  private readonly discs: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[];
  private readonly geometry = new THREE.PlaneGeometry(REACH * 2, REACH * 2).rotateX(-Math.PI / 2);
  /** What's on each pad: its colour and how its agent stands, or nothing. */
  private readonly lit: ({ colour: THREE.Color; status: PadOccupant['status'] } | undefined)[];

  constructor(
    parent: THREE.Object3D,
    /** Each pad's middle, on its top (world). */
    pads: { at: THREE.Vector3 }[],
  ) {
    this.discs = pads.map((pad) => {
      const material = new THREE.MeshBasicMaterial({
        map: padLight(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0,
      });
      const disc = new THREE.Mesh(this.geometry, material);
      // neighbours' light overlaps between the pads, in one plane: additive and depthless, it adds up rather than fights
      disc.position.copy(pad.at).setY(pad.at.y + LIFT);
      disc.visible = false;
      disc.renderOrder = 2;
      parent.add(disc);
      return disc;
    });
    this.lit = pads.map(() => undefined);
  }

  /** Pad `i` lit in `colour` for an agent standing as `status`, or dark with nobody on it. */
  set(i: number, lit: { colour: THREE.ColorRepresentation; status: PadOccupant['status'] } | undefined): void {
    const disc = this.discs[i];
    if (!disc) return;
    disc.visible = !!lit;
    if (!lit) {
      this.lit[i] = undefined;
      return;
    }
    const colour = this.lit[i]?.colour ?? new THREE.Color();
    this.lit[i] = { colour: colour.set(lit.colour), status: lit.status };
    disc.material.color.copy(colour);
  }

  /** Moves them on to `t` seconds: the lit ones breathe while their agents work. */
  update(t: number): void {
    this.lit.forEach((lit, i) => {
      if (lit) this.discs[i].material.opacity = STRENGTH * padGlow(lit.status, t, i);
    });
  }

  dispose(): void {
    for (const disc of this.discs) {
      disc.removeFromParent();
      disc.material.dispose();
    }
    this.geometry.dispose();
  }
}
