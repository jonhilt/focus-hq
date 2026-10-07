import * as THREE from 'three';
import { chiefEngineer } from '../../../shared/crew';
import { canvasTexture, makeCanvas } from './canvas';
import { Character } from './character';
import { type Box2, type Seat, seatYaw } from './layout';
import { flat } from './materials';
import { LCARS, LCARS_FONT, lcarsFrame, workstation } from './starship';

/**
 * The engineering station: where the ship's engineer keeps the ship running, facing their board on the wall. In world
 * coordinates: whoever places it adds `group` to the scene and `footprint` to the colliders.
 */
export class EngineeringStation {
  readonly group: THREE.Group;
  readonly footprint: Box2;
  private readonly engineer: Character;
  private readonly screen = makeCanvas(800, 512);
  private readonly screenTex = canvasTexture(this.screen.canvas);

  constructor(seat: Seat) {
    const station = workstation(flat(this.screenTex), LCARS.gold);
    this.group = station.group;
    this.group.position.copy(seat.at);
    this.group.rotation.y = seatYaw(seat);
    // measured before the engineer sits down, whose speech bubble would stretch it across the room
    this.group.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(this.group);
    this.footprint = { minX: b.min.x - 0.05, maxX: b.max.x + 0.05, minZ: b.min.z - 0.05, maxZ: b.max.z + 0.05 };
    const crew = chiefEngineer();
    this.engineer = new Character({ name: crew.name, avatar: crew.avatar, tag: 'Eng', icon: '🔧', status: 'queued', line: 'Keeping the ship running' });
    station.seat.add(this.engineer.group);
    this.drawScreen();
  }

  update(t: number, camera: THREE.Vector3): void {
    if (this.engineer.group.visible) this.engineer.update(t, camera.distanceTo(this.engineer.group.getWorldPosition(tmp)));
  }

  private drawScreen(): void {
    const { canvas, ctx } = this.screen;
    const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: 'Engineering', color: LCARS.gold, seed: 4707 });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = LCARS.peach;
    ctx.font = `600 40px ${LCARS_FONT}`;
    ctx.fillText('ALL SYSTEMS NOMINAL', area.x, area.y + 10);
    ctx.fillStyle = LCARS.sky;
    ctx.font = `500 26px ${LCARS_FONT}`;
    for (const [i, line] of ['Warp core stable', 'Structural integrity 100%', 'Holodeck power nominal'].entries()) ctx.fillText(line.toUpperCase(), area.x, area.y + 190 + i * 34);
    this.screenTex.needsUpdate = true;
  }

  dispose(): void {
    this.engineer.dispose();
    this.screenTex.dispose();
  }
}

const tmp = new THREE.Vector3();
