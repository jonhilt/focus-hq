// The astrometrics table (README.md): a round table with the project's map floating over it in miniature
// (miniature.ts), each layer a ring of its parts and a line for each import, turning slowly in a column of light. Step
// into it and you're in the architecture space; the one in the space takes you back. Its light is its own glow (no
// lamp: a light in the hall would cost every surface there).
import * as THREE from 'three';
import { type Miniature, MINIATURE } from './miniature';

/** How tall the table stands, and how wide its top is: the miniature hangs over it at about eye height. */
export const TABLE = { height: 0.95, radius: 1.15 } as const;

/** A table with a miniature over it, standing on the floor at its origin. */
export class AstrometricsTable {
  readonly group = new THREE.Group();
  private readonly model = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private modelOwned: { dispose(): void }[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    const base = new THREE.Mesh(
      this.own(new THREE.CylinderGeometry(TABLE.radius, TABLE.radius * 0.75, TABLE.height, 48)),
      this.own(new THREE.MeshStandardMaterial({ color: '#2a2f40', roughness: 0.4, metalness: 0.6 })),
    );
    base.position.y = TABLE.height / 2;
    const top = new THREE.Mesh(this.own(new THREE.CircleGeometry(TABLE.radius - 0.06, 64)), this.own(new THREE.MeshBasicMaterial({ color: '#0b2236', toneMapped: false })));
    top.rotation.x = -Math.PI / 2;
    top.position.y = TABLE.height + 0.003;
    const rim = new THREE.Mesh(this.own(new THREE.RingGeometry(TABLE.radius - 0.08, TABLE.radius - 0.01, 96)), this.own(new THREE.MeshBasicMaterial({ color: '#99ccff', toneMapped: false })));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = TABLE.height + 0.005;
    this.beam = new THREE.Mesh(
      this.own(new THREE.CylinderGeometry(TABLE.radius - 0.1, TABLE.radius - 0.08, MINIATURE.high + 0.25, 48, 1, true)),
      this.own(new THREE.MeshBasicMaterial({ color: '#99ccff', transparent: true, opacity: 0.015, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })),
    );
    this.beam.position.y = TABLE.height + (MINIATURE.high + 0.25) / 2;
    this.model.position.y = TABLE.height;
    this.group.add(base, top, rim, this.beam, this.model);
  }

  /** Puts `mini` over the table, in place of what was there. */
  show(mini: Miniature): void {
    this.model.clear();
    for (const d of this.modelOwned) d.dispose();
    this.modelOwned = [];
    const box = this.ownModel(new THREE.BoxGeometry(1, 0.6, 1));
    const edges = this.ownModel(new THREE.EdgesGeometry(box));
    const edgeMaterial = this.ownModel(new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, toneMapped: false }));
    const materials = new Map<string, THREE.MeshBasicMaterial>();
    for (const p of mini.parts) {
      let material = materials.get(p.colour);
      if (!material) materials.set(p.colour, (material = this.ownModel(new THREE.MeshBasicMaterial({ color: p.colour, toneMapped: false }))));
      const mesh = new THREE.Mesh(box, material);
      mesh.position.set(p.x, p.y, p.z);
      mesh.scale.setScalar(p.size);
      const outline = new THREE.LineSegments(edges, edgeMaterial);
      outline.position.copy(mesh.position);
      outline.scale.copy(mesh.scale);
      this.model.add(mesh, outline);
    }
    if (mini.links.length) {
      const points = mini.links.flatMap(([a, b]) => [mini.parts[a], mini.parts[b]].map((p) => new THREE.Vector3(p.x, p.y, p.z)));
      const lines = new THREE.LineSegments(
        this.ownModel(new THREE.BufferGeometry().setFromPoints(points)),
        this.ownModel(new THREE.LineBasicMaterial({ color: '#ffcc66', transparent: true, opacity: 0.5, toneMapped: false })),
      );
      this.model.add(lines);
    }
  }

  private own<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  private ownModel<T extends { dispose(): void }>(thing: T): T {
    this.modelOwned.push(thing);
    return thing;
  }

  /** The miniature turns, bobbing a little, in a light that breathes. */
  update(t: number): void {
    this.model.rotation.y = t * 0.2;
    this.model.position.y = TABLE.height + Math.sin(t * 1.2) * 0.02;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.012 + 0.006 * Math.sin(t * 2);
  }

  dispose(): void {
    for (const d of [...this.modelOwned, ...this.disposables]) d.dispose();
  }
}
