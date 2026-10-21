import * as THREE from 'three';
import { chiefEngineer } from '../../../shared/crew';
import { type ReportCard, reportLines } from '../../../shared/ledger';
import type { StationSays } from '../plugins';
import { interactive } from './builder';
import { canvasTexture, makeCanvas } from './canvas';
import { Character } from './character';
import { type Box2, type Seat, seatYaw } from './layout';
import { flat } from './materials';
import { LCARS, LCARS_FONT, lcarsFrame, workstation } from './starship';
import { contactShadow } from './contactShadow';

/**
 * The engineering station: where the ship's engineer keeps the ship running, facing their board on the wall, which
 * shows the ledger's report card (how the ship's work has gone lately) and, under it, what a plugin has them busy
 * with (`EngineeringPart.station`). E opens the station's panel. In world coordinates: whoever places it adds `group`
 * to the scene and `footprint` to the colliders.
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
    // the deck's floor has its occlusion baked in, but not under a station built here (contactShadow.ts)
    const shadow = contactShadow(this.group);
    if (shadow) this.group.add(shadow);
    const crew = chiefEngineer();
    this.engineer = new Character(engineerView(null));
    station.seat.add(this.engineer.group);
    interactive(this.group, { kind: 'engineering' }, () => `Talk to ${crew.name}, chief engineer: the report card and the station`);
    this.drawScreen(null, null);
  }

  /** The report card on the screen, and what the engineer says they're busy with (`says`), if anything. */
  showReport(report: ReportCard | null, says: StationSays | null): void {
    this.engineer.set(engineerView(says));
    this.drawScreen(report, says);
  }

  update(t: number, camera: THREE.Vector3): void {
    if (this.engineer.group.visible) this.engineer.update(t, camera.distanceTo(this.engineer.group.getWorldPosition(tmp)));
  }

  private drawScreen(report: ReportCard | null, says: StationSays | null): void {
    const { canvas, ctx } = this.screen;
    const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: 'Engineering', color: LCARS.gold, seed: 4707 });
    const { headline, lines } = report ? reportLines(report) : { headline: 'All systems nominal', lines: [] };
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = LCARS.peach;
    ctx.font = `600 40px ${LCARS_FONT}`;
    ctx.fillText(headline.toUpperCase(), area.x, area.y + 10, area.w);
    ctx.fillStyle = LCARS.sky;
    ctx.font = `500 26px ${LCARS_FONT}`;
    for (const [i, line] of lines.entries()) ctx.fillText(line.toUpperCase(), area.x, area.y + 70 + i * 36, area.w);
    const said = says?.line;
    if (said) {
      ctx.fillStyle = LCARS.gold;
      ctx.font = `600 28px ${LCARS_FONT}`;
      ctx.fillText(said.toUpperCase(), area.x, area.y + area.h - 40, area.w);
    }
    this.screenTex.needsUpdate = true;
  }

  dispose(): void {
    this.engineer.dispose();
    this.screenTex.dispose();
  }
}

const tmp = new THREE.Vector3();

/** What the engineer's bubble says: what they're busy with, or keeping the ship running. */
function engineerView(says: StationSays | null) {
  const crew = chiefEngineer();
  return { name: crew.name, avatar: crew.avatar, tag: 'Eng', icon: '🔧', status: says?.status ?? 'queued', line: says?.line ?? 'Keeping the ship running' };
}
