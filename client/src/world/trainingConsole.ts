import * as THREE from 'three';
import { SCENARIOS, TRAINING } from '../../../shared/scenarios';
import { interactive } from './builder';
import { canvasTexture, makeCanvas } from './canvas';
import { contactShadow } from './contactShadow';
import { type Box2, type Seat, seatYaw } from './layout';
import { flat } from './materials';
import { LCARS, LCARS_FONT, lcarsFrame, workstation } from './starship';

/**
 * The demo ship's training console on the bridge (docs/studio.md): an empty workstation whose screen lists the
 * scenarios; E opens its panel, where picking one resets the ship and readies that scenario's goal. In world
 * coordinates: whoever places it adds `group` to the scene and `footprint` to the colliders.
 */
export class TrainingConsole {
  readonly group: THREE.Group;
  readonly footprint: Box2;
  private readonly screen = makeCanvas(800, 512);
  private readonly screenTex = canvasTexture(this.screen.canvas);

  constructor(seat: Seat) {
    const station = workstation(flat(this.screenTex), LCARS.gold);
    this.group = station.group;
    this.group.position.copy(seat.at);
    this.group.rotation.y = seatYaw(seat);
    this.group.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(this.group);
    this.footprint = { minX: b.min.x - 0.05, maxX: b.max.x + 0.05, minZ: b.min.z - 0.05, maxZ: b.max.z + 0.05 };
    const shadow = contactShadow(this.group);
    if (shadow) this.group.add(shadow);
    interactive(this.group, { kind: 'training' }, () => 'Holodeck training: reset the ship for a scenario');
    this.draw();
  }

  private draw(): void {
    const { canvas, ctx } = this.screen;
    const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: 'Holodeck training', color: LCARS.gold, seed: 1701 });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = LCARS.peach;
    ctx.font = `600 40px ${LCARS_FONT}`;
    ctx.fillText('SCENARIOS', area.x, area.y + 10, area.w);
    ctx.font = `500 30px ${LCARS_FONT}`;
    for (const [i, scenario] of SCENARIOS.entries()) {
      ctx.fillStyle = [LCARS.sky, LCARS.lilac, LCARS.periwinkle][i % 3];
      ctx.fillText(TRAINING[scenario].label.toUpperCase(), area.x, area.y + 74 + i * 44, area.w);
    }
    ctx.fillStyle = LCARS.gold;
    ctx.font = `600 28px ${LCARS_FONT}`;
    ctx.fillText('PRESS E TO BEGIN', area.x, area.y + area.h - 40, area.w);
    this.screenTex.needsUpdate = true;
  }

  dispose(): void {
    this.screenTex.dispose();
  }
}
