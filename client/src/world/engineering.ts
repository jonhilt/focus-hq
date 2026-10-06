import * as THREE from 'three';
import { chiefEngineer, engineerAtBriefing } from '../../../shared/crew';
import { state } from '../net/state';
import { type Builder, interactive } from './builder';
import { canvasTexture, makeCanvas, wrap } from './canvas';
import { Character, type CrewView } from './character';
import { LOBBY } from './layout';
import { flat } from './materials';
import { LCARS, LCARS_FONT, lcarsConsole, lcarsFrame, lcarsSign, workstation } from './starship';

/** Against the concourse's south wall, east of the corridor: the first post you pass on the way up from the holodecks. */
const STATION = { x: 4.8, z: LOBBY.z0 + 1.35 };

/**
 * The engineering station: where the ship's engineer works when no briefing needs them. They leave it for the lounge
 * table when a briefing asks engineering, and its screen says where they've gone. Built in world coordinates.
 */
export class EngineeringStation {
  private readonly engineer: Character;
  private readonly screen = makeCanvas(800, 512);
  private readonly screenTex = canvasTexture(this.screen.canvas);
  private screenKey = '';

  constructor(b: Builder) {
    const station = workstation(flat(this.screenTex), LCARS.gold);
    station.group.position.set(STATION.x, 0, STATION.z);
    station.group.rotation.y = Math.PI / 2; // facing the wall, like an engineer at their board
    b.add(station.group);
    b.collideObject(station.group);
    this.engineer = new Character(this.view());
    station.seat.add(this.engineer.group);
    interactive(station.group, { kind: 'briefing' }, () => this.label());

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.42), flat(lcarsSign('Engineering', { color: LCARS.gold, code: '04-07', h: 216 })));
    sign.position.set(STATION.x, 2.82, LOBBY.z0 + 0.12);
    b.add(sign);
    const board = lcarsConsole(1.8, 0.8, 43);
    board.position.set(STATION.x, 2.0, LOBBY.z0 + 0.13);
    b.add(board);
    this.sync();
  }

  private label(): string {
    const briefing = state.briefing;
    if (briefing && engineerAtBriefing(briefing)) return `${chiefEngineer().name} is in the observation lounge`;
    return `${chiefEngineer().name}, engineering: ask for options from a briefing`;
  }

  private view(): CrewView {
    const crew = chiefEngineer();
    return { name: crew.name, avatar: crew.avatar, tag: 'Eng', icon: '🔧', status: 'queued', line: 'Big change? Ask engineering from a briefing' };
  }

  /** Sends the engineer to the lounge for a briefing that asked engineering, and back again after it. */
  sync(): void {
    const briefing = state.briefing;
    const away = engineerAtBriefing(briefing);
    this.engineer.group.visible = !away;
    this.engineer.set(this.view());
    this.drawScreen(away && briefing ? `At the observation lounge: options for ${state.project(briefing.projectId)?.name ?? 'a project'}` : 'Standing by');
  }

  update(t: number, camera: THREE.Vector3): void {
    if (this.engineer.group.visible) this.engineer.update(t, camera.distanceTo(this.engineer.group.getWorldPosition(tmp)));
  }

  private drawScreen(status: string): void {
    if (status === this.screenKey) return;
    this.screenKey = status;
    const { canvas, ctx } = this.screen;
    const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: 'Engineering', color: LCARS.gold, seed: 4707 });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = LCARS.peach;
    ctx.font = `600 40px ${LCARS_FONT}`;
    for (const [i, line] of wrap(ctx, status.toUpperCase(), area.w, 3).entries()) ctx.fillText(line, area.x, area.y + 10 + i * 48);
    ctx.fillStyle = LCARS.sky;
    ctx.font = `500 26px ${LCARS_FONT}`;
    for (const [i, line] of wrap(ctx, 'Reads the code and lays out options for a big change. Read-only: no code, no spikes.'.toUpperCase(), area.w, 3).entries()) {
      ctx.fillText(line, area.x, area.y + 190 + i * 34);
    }
    this.screenTex.needsUpdate = true;
  }

  dispose(): void {
    this.engineer.dispose();
    this.screenTex.dispose();
  }
}

const tmp = new THREE.Vector3();
