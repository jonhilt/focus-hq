// The holodeck's arch (README.md): the way out of the architecture space, as a holodeck's is ("Computer, arch"): a
// freestanding doorway with the holodeck's yellow grid showing through it and a control panel on its pillar.
import * as THREE from 'three';

/** How big it is: the opening between its pillars, and how deep they are. */
export const ARCH = { width: 1.6, height: 2.5, pillar: 0.32, depth: 0.32 } as const;

/** The holodeck's black and yellow grid, a square of it. */
function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#050505';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#e0b000';
    g.lineWidth = 4;
    g.strokeRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 6);
  return t;
}

/** Its control panel: LCARS bars over the word EXIT. */
function panelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, 128, 256);
    const bars: [string, number][] = [['#ff9900', 40], ['#cc99cc', 24], ['#9999ff', 32], ['#ffcc66', 20]];
    let y = 12;
    for (const [colour, h] of bars) {
      g.fillStyle = colour;
      g.fillRect(14, y, 100, h);
      y += h + 8;
    }
    g.fillStyle = '#ff9900';
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center';
    g.fillText('EXIT', 64, 226);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** An arch standing on the floor at its origin, its face and panel towards -Z. */
export class HolodeckArch {
  readonly group = new THREE.Group();
  private readonly grid: THREE.MeshBasicMaterial;
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    const { width, height, pillar, depth } = ARCH;
    const frame = this.own(new THREE.MeshStandardMaterial({ color: '#8d8a86', roughness: 0.45, metalness: 0.5 }));
    const box = (w: number, h: number, x: number, y: number) => {
      const mesh = new THREE.Mesh(this.own(new THREE.BoxGeometry(w, h, depth)), frame);
      mesh.position.set(x, y, 0);
      this.group.add(mesh);
    };
    box(pillar, height, -(width + pillar) / 2, height / 2);
    box(pillar, height, (width + pillar) / 2, height / 2);
    box(width + pillar * 2, pillar, 0, height + pillar / 2);
    // the holodeck showing through it
    this.grid = this.own(new THREE.MeshBasicMaterial({ map: this.own(gridTexture()), transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false }));
    const through = new THREE.Mesh(this.own(new THREE.PlaneGeometry(width, height)), this.grid);
    through.position.y = height / 2;
    // its control panel, on the right-hand pillar as you face it, a little proud of its face
    const panel = new THREE.Mesh(this.own(new THREE.PlaneGeometry(pillar * 0.8, pillar * 1.6)), this.own(new THREE.MeshBasicMaterial({ map: this.own(panelTexture()), toneMapped: false })));
    panel.rotation.y = Math.PI;
    panel.position.set(-(width + pillar) / 2, 1.3, -depth / 2 - 0.004);
    this.group.add(through, panel);
  }

  private own<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  /** The grid through it shimmers a little. */
  update(t: number): void {
    this.grid.opacity = 0.75 + 0.1 * Math.sin(t * 3);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
