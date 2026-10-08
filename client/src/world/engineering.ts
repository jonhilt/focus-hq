import * as THREE from 'three';
import { chiefEngineer } from '../../../shared/crew';
import { type ReportCard, reportLines } from '../../../shared/ledger';
import type { AgentStatus, Retro } from '../../../shared/types';
import { interactive } from './builder';
import { canvasTexture, makeCanvas } from './canvas';
import { Character } from './character';
import { type Box2, type Seat, seatYaw } from './layout';
import { flat } from './materials';
import { LCARS, LCARS_FONT, lcarsFrame, workstation } from './starship';
import { contactShadow } from './contactShadow';

/**
 * The engineering station: where the ship's engineer keeps the ship running, facing their board on the wall, which
 * shows the ledger's report card (how the office's work has gone lately) and how their retro stands. E opens the
 * station's panel, where the captain starts a retro and reads its proposals. In world
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
    // the deck's floor has its occlusion baked in, but not under a station built here (contactShadow.ts)
    const shadow = contactShadow(this.group);
    if (shadow) this.group.add(shadow);
    const crew = chiefEngineer();
    this.engineer = new Character(engineerView(null));
    station.seat.add(this.engineer.group);
    interactive(this.group, { kind: 'engineering' }, () => `Talk to ${crew.name}, chief engineer: the report card and retros`);
    this.drawScreen(null, null);
  }

  showReport(report: ReportCard | null, retro: Retro | null): void {
    this.engineer.set(engineerView(retro));
    this.drawScreen(report, retro);
  }

  update(t: number, camera: THREE.Vector3): void {
    if (this.engineer.group.visible) this.engineer.update(t, camera.distanceTo(this.engineer.group.getWorldPosition(tmp)));
  }

  private drawScreen(report: ReportCard | null, retro: Retro | null): void {
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
    const said = retroLine(retro);
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

const STATUS: Record<Retro['status'], AgentStatus> = { idle: 'queued', gathering: 'working', thinking: 'working', done: 'done', failed: 'error' };

/** What the engineer's bubble says: what they're doing on a retro, or what came of the last one. */
function engineerView(retro: Retro | null) {
  const crew = chiefEngineer();
  const line = retro && retro.status !== 'idle' ? retro.status === 'failed' ? `Retro: ${retro.error ?? 'couldn’t finish'}` : retro.activity : 'Keeping the ship running';
  return { name: crew.name, avatar: crew.avatar, tag: 'Eng', icon: '🔧', status: STATUS[retro?.status ?? 'idle'], line };
}

/** The screen's last line: how the retro stands. */
function retroLine(retro: Retro | null): string | undefined {
  if (!retro || retro.status === 'idle') return 'Retro: press E to start one';
  if (retro.status === 'done') return `Retro: ${retro.proposals.length} proposals waiting`;
  if (retro.status === 'failed') return 'Retro: didn’t finish';
  return `Retro: ${retro.activity}`;
}
