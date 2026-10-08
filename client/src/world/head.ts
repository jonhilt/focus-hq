import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Avatar, Hairstyle, Species } from '../../../shared/types';
import { darken, toon, toonMaterial } from './materials';
import { mergeStatic } from './merge';
import { ball, capsule, cyl } from './props';

export const PIP_GOLD = '#f2c94c';
const HEAD_R = 0.25;
/** Below the eyes the skull is drawn out into a jaw, and narrows towards the chin. */
const JAW = 1.3;
const CHIN_NARROWING = 0.18;
/** Where the eyes sit: just above the middle of the head, close together. */
const EYE_Y = 0.02;
const EYE_Z = 0.08;

const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z = 0): T => (o.position.set(x, y, z), o);

/** Where the skin is at (x, y) on the side of the face, for things stuck on it. */
function skinZ(x: number, y: number): number {
  const down = Math.max(0, -y / (HEAD_R * JAW));
  const sy = y < 0 ? y / JAW : y;
  return Math.sqrt(Math.max(0, HEAD_R * HEAD_R - x * x - sy * sy)) * (1 - CHIN_NARROWING * down * down);
}

/** A round cranium over a longer jaw: the Lower Decks head shape rather than a ball. One per head, as characters dispose their geometry. */
function skullGeometry(): THREE.BufferGeometry {
  const sphere = new THREE.SphereGeometry(HEAD_R, 32, 24);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const pos = sphere.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y >= 0) continue;
    const down = -y / HEAD_R;
    pos.setY(i, y * JAW);
    pos.setZ(i, pos.getZ(i) * (1 - CHIN_NARROWING * down * down));
  }
  const geo = mergeVertices(sphere);
  geo.computeVertexNormals();
  return geo;
}

/** Hair and whatever is tied up in it, on a head of radius HEAD_R facing +X. */
function hairdo(style: Hairstyle, color: string): THREE.Object3D[] {
  const cap = (theta: number, tilt: number, r = HEAD_R + 0.015) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, theta), toon(color));
    m.rotation.z = tilt;
    return m;
  };
  switch (style) {
    case 'bald':
      return [];
    case 'crop':
      return [cap(Math.PI * 0.52, 0.7)];
    case 'bowl':
      // the Vulcan cut: a straight fringe high on the brow, low at the back
      return [cap(Math.PI * 0.53, 0.62, HEAD_R + 0.025)];
    case 'bun':
      return [cap(Math.PI * 0.52, 0.7), at(ball(0.1, color), -0.2, 0.17)];
    case 'ponytail': {
      const tail = capsule(0.055, 0.2, color);
      tail.rotation.z = -0.35;
      return [cap(Math.PI * 0.52, 0.7), at(ball(0.06, color), -0.25, 0.1), at(tail, -0.32, -0.06)];
    }
    case 'curls': {
      const curls: THREE.Object3D[] = [cap(Math.PI * 0.52, 0.7)];
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.55 + i * 0.1);
        curls.push(at(ball(0.075, color, 10), Math.cos(a) * 0.25, 0.04 + Math.sin(i * 1.7) * 0.05, Math.sin(a) * 0.25));
      }
      for (const [x, z] of [[-0.05, 0.12], [-0.05, -0.12], [0.06, 0], [-0.15, 0]]) curls.push(at(ball(0.08, color, 10), x, 0.22, z));
      return curls;
    }
  }
}

/** Ears for everyone, and what tells the species apart beyond skin colour. */
function features(species: Species, skin: string): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const ear = ball(0.055, skin, 10);
    ear.scale.set(0.6, 1, 0.45);
    ear.position.set(0, 0, s * HEAD_R);
    parts.push(ear);
  }
  switch (species) {
    case 'human':
    case 'orion':
      return parts;
    case 'vulcan':
      for (const s of [-1, 1]) {
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 8), toon(skin));
        tip.position.set(-0.01, 0.07, s * (HEAD_R + 0.01));
        tip.rotation.x = s * 0.45;
        parts.push(tip);
      }
      return parts;
    case 'bajoran': {
      for (let i = 0; i < 3; i++) {
        const ridge = capsule(0.007, 0.022, darken(skin, 0.15));
        ridge.rotation.x = Math.PI / 2;
        ridge.position.set(HEAD_R - 0.003, 0.012 + i * 0.024, 0);
        parts.push(ridge);
      }
      // the earring, with its chain up to the top of the right ear
      for (let i = 0; i < 3; i++) parts.push(at(ball(0.018, PIP_GOLD, 8), 0.01, 0.05 - i * 0.06, HEAD_R + 0.025));
      return parts;
    }
    case 'andorian':
      for (const s of [-1, 1]) {
        const stalk = cyl(0.014, 0.018, 0.2, skin, 8);
        stalk.position.set(0.02, HEAD_R + 0.06, s * 0.1);
        stalk.rotation.x = s * 0.35;
        parts.push(stalk);
        parts.push(at(ball(0.032, skin, 10), 0.02, HEAD_R + 0.155, s * 0.135));
      }
      return parts;
    case 'trill':
      // spots from the temples down the sides of the face
      for (const s of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          const y = 0.1 - i * 0.065;
          const x = 0.06 + (i % 2) * 0.025;
          const spot = ball(0.017, darken(skin, 0.4), 8);
          spot.position.set(x, y, s * skinZ(x, y));
          parts.push(spot);
        }
      }
      return parts;
  }
}

function accessory(kind: Avatar['accessory']): THREE.Object3D[] {
  switch (kind) {
    case 'none':
      return [];
    case 'glasses': {
      const parts: THREE.Object3D[] = [];
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.011, 6, 18), toon('#222'));
        ring.rotation.y = Math.PI / 2;
        ring.position.set(0.255, EYE_Y, s * EYE_Z);
        parts.push(ring);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.04), toon('#222'));
      bridge.position.set(0.258, EYE_Y + 0.025, 0);
      parts.push(bridge);
      return parts;
    }
    case 'implant': {
      // a cybernetic plate over the left temple, with a red sensor by the eye
      const plate = ball(0.09, '#9aa3ad', 12);
      plate.scale.set(0.55, 1, 0.8);
      plate.position.set(0.15, 0.05, -0.18);
      return [plate, at(ball(0.022, '#ff3b3b', 8), 0.2, 0.07, -0.15)];
    }
  }
}

/** What a face shows, picked from what its owner is doing. */
export type Expression = 'idle' | 'focused' | 'thinking' | 'eager' | 'happy' | 'grin' | 'worried' | 'asleep';
type Mouth = 'flat' | 'smile' | 'frown' | 'open';

interface Look {
  /** Upper eyelids: 0 covers the top half of the eye (the Lower Decks deadpan), 1 is wide open, negative shuts them. */
  lids: number;
  /** How far the brows rise, and how much their inner ends lift (worry) or drop (concentration). */
  brows: number;
  browsInner: number;
  /** Extra lift for the left brow only. */
  quirk: number;
  /** Where the eyes look: up and to the side, in radians. */
  gaze: [number, number];
  mouth: Mouth;
}

const LOOKS: Record<Expression, Look> = {
  idle: { lids: 0.45, brows: 0, browsInner: 0, quirk: 0, gaze: [0, 0], mouth: 'smile' },
  focused: { lids: 0.12, brows: -0.008, browsInner: -0.22, quirk: 0, gaze: [-0.15, 0], mouth: 'flat' },
  thinking: { lids: 0.35, brows: 0, browsInner: 0.05, quirk: 0.035, gaze: [0.4, 0.35], mouth: 'flat' },
  eager: { lids: 0.95, brows: 0.03, browsInner: 0.1, quirk: 0, gaze: [0, 0], mouth: 'smile' },
  happy: { lids: 0.3, brows: 0.012, browsInner: 0.05, quirk: 0, gaze: [0, 0], mouth: 'smile' },
  grin: { lids: 0.85, brows: 0.04, browsInner: 0.15, quirk: 0, gaze: [0.1, 0], mouth: 'open' },
  worried: { lids: 0.9, brows: 0.02, browsInner: 0.45, quirk: 0, gaze: [0, 0], mouth: 'frown' },
  asleep: { lids: -1.5, brows: -0.01, browsInner: 0, quirk: 0, gaze: [0, 0], mouth: 'flat' },
};

const EYE_R = 0.062;
/** Eyes are tall ovals, set close together. */
const EYE_SHAPE = new THREE.Vector3(0.55, 1.2, 0.85);
const BROW_Y = 0.106;
const MOUTH_Y = -0.15;
const LIPS = '#4a1c22';
/** Open mouths are a hollow half-ball, so they need their insides drawn. */
const MOUTH_INSIDE = toonMaterial({ color: LIPS, side: THREE.DoubleSide });

/** A mouth line curving along a circle of radius r, bent up at the ends (smile) or down (frown), facing +X. */
function arcMouth(r: number, smile: boolean): THREE.Group {
  const arc = Math.PI * 0.55;
  const torus = new THREE.Mesh(new THREE.TorusGeometry(r, 0.009, 6, 16, arc), toon(LIPS));
  torus.rotation.z = smile ? -(Math.PI + arc) / 2 : (Math.PI - arc) / 2;
  torus.position.y = smile ? r : -r;
  const g = new THREE.Group();
  g.add(torus);
  g.rotation.y = Math.PI / 2;
  return g;
}

/** A crew member's head, facing +X: skull, hair, species features, face and accessory. */
export class Head {
  readonly group = new THREE.Group();
  private lids: THREE.Object3D[] = [];
  private gazes: THREE.Object3D[] = [];
  private brows: THREE.Object3D[] = [];
  private mouths: Record<Mouth, THREE.Object3D>;

  constructor(avatar: Avatar) {
    const { species, skin, hair, hairstyle } = avatar;
    this.group.add(new THREE.Mesh(skullGeometry(), toon(skin)));
    this.group.add(...hairdo(hairstyle, hair), ...features(species, skin), ...accessory(avatar.accessory));

    const browColour = hairstyle === 'bald' ? darken(skin, 0.45) : darken(hair, 0.3);
    const eyes: THREE.Object3D[] = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(0.214, EYE_Y, s * EYE_Z);
      eye.scale.copy(EYE_SHAPE);
      eye.add(ball(EYE_R, '#ffffff', 16));
      const gaze = new THREE.Group();
      const pupil = ball(0.017, '#1b1b1b', 10);
      pupil.scale.x = 0.4;
      pupil.position.x = EYE_R - 0.005;
      gaze.add(pupil);
      eye.add(gaze);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(EYE_R + 0.005, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(skin));
      eye.add(lid);
      this.group.add(eye);
      eyes.push(eye);
      this.gazes.push(gaze);
      this.lids.push(lid);

      const brow = new THREE.Group();
      const line = capsule(0.01, 0.07, browColour);
      line.rotation.x = Math.PI / 2;
      brow.add(line);
      brow.position.set(0.222, BROW_Y, s * EYE_Z);
      this.group.add(brow);
      this.brows.push(brow);
    }

    const nose = ball(0.042, skin, 14);
    nose.scale.set(0.9, 1.25, 0.8);
    nose.position.set(0.248, -0.055, 0);
    this.group.add(nose);

    const flat = capsule(0.009, 0.06, LIPS);
    flat.rotation.x = Math.PI / 2;
    const open = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), MOUTH_INSIDE);
    open.scale.set(0.35, 0.9, 1.2);
    this.mouths = { flat, smile: arcMouth(0.06, true), frown: arcMouth(0.05, false), open };
    for (const mouth of Object.values(this.mouths)) {
      mouth.position.add(new THREE.Vector3(0.222, MOUTH_Y, 0));
      this.group.add(mouth);
    }
    this.express('idle', false);
    // skull, hair and features are a draw call each until merged; what moves or changes stays as it is
    mergeStatic(this.group, [...eyes, ...this.brows, ...Object.values(this.mouths)]);
  }

  express(expression: Expression, blinking: boolean): void {
    const look = LOOKS[expression];
    for (const lid of this.lids) lid.rotation.z = blinking ? -1.5 : look.lids;
    for (const gaze of this.gazes) gaze.rotation.set(0, -look.gaze[1], look.gaze[0]);
    this.brows.forEach((brow, i) => {
      const s = i === 0 ? -1 : 1;
      brow.position.y = BROW_Y + look.brows + (s < 0 ? look.quirk : 0);
      brow.rotation.x = s * look.browsInner;
    });
    for (const [mouth, mesh] of Object.entries(this.mouths)) mesh.visible = mouth === look.mouth;
  }
}
