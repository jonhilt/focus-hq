import * as THREE from 'three';
import { chiefEngineer } from '../../../shared/crew';
import type { Builder } from './builder';
import { canvasTexture, makeCanvas } from './canvas';
import { Character } from './character';
import { LOBBY } from './layout';
import { flat } from './materials';
import { LCARS, LCARS_FONT, lcarsConsole, lcarsFrame, lcarsSign, workstation } from './starship';

/** Against the concourse's south wall, east of the corridor: the first post you pass on the way up from the holodecks. */
const STATION = { x: 4.8, z: LOBBY.z0 + 1.35 };

/** The engineering station: where the ship's engineer keeps the ship running. Scenery, built in world coordinates. */
export class EngineeringStation {
  private readonly engineer: Character;
  private readonly screen = makeCanvas(800, 512);
  private readonly screenTex = canvasTexture(this.screen.canvas);

  constructor(b: Builder) {
    const station = workstation(flat(this.screenTex), LCARS.gold);
    station.group.position.set(STATION.x, 0, STATION.z);
    station.group.rotation.y = Math.PI / 2; // facing the wall, like an engineer at their board
    b.add(station.group);
    b.collideObject(station.group);
    const crew = chiefEngineer();
    this.engineer = new Character({ name: crew.name, avatar: crew.avatar, tag: 'Eng', icon: '🔧', status: 'queued', line: 'Keeping the ship running' });
    station.seat.add(this.engineer.group);

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.42), flat(lcarsSign('Engineering', { color: LCARS.gold, code: '04-07', h: 216 })));
    sign.position.set(STATION.x, 2.82, LOBBY.z0 + 0.12);
    b.add(sign);
    const board = lcarsConsole(1.8, 0.8, 43);
    board.position.set(STATION.x, 2.0, LOBBY.z0 + 0.13);
    b.add(board);
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
