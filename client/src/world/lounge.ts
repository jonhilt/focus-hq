import * as THREE from 'three';
import { plannerFor, qaAtBriefing, qaOfficerFor } from '../../../shared/crew';
import type { Brief, Briefing } from '../../../shared/types';
import { state } from '../net/state';
import { type Builder, interactive } from './builder';
import { canvasTexture, makeCanvas, wrap } from './canvas';
import { Character, type CrewView } from './character';
import { LOUNGE, LOUNGE_DOOR_X, OFFICE, OVER_DOOR, WALL_H, WALL_T } from './layout';
import { box, flat, toon } from './materials';
import { ceilingLight, chair, cyl, plant } from './props';
import { LCARS, LCARS_FONT, lcarsConsole, lcarsFrame, lcarsSign, viewport } from './starship';

const TABLE = { x: 0.6, z: 21.3, length: 5.2, width: 1.5 };
/** Seats round the table: [x, z, facing], facing being the chair's rotation (0 faces +X). */
const SEATS: [number, number, number][] = [
  ...[-1.3, TABLE.x, 2.5].map((x): [number, number, number] => [x, TABLE.z + TABLE.width / 2 + 0.45, Math.PI / 2]),
  ...[-1.3, TABLE.x, 2.5].map((x): [number, number, number] => [x, TABLE.z - TABLE.width / 2 - 0.45, -Math.PI / 2]),
  [TABLE.x - TABLE.length / 2 - 0.5, TABLE.z, 0],
  [TABLE.x + TABLE.length / 2 + 0.5, TABLE.z, Math.PI],
];
/** The officer's seat: the middle of the north side, back to the viewports, facing whoever walks in. */
const OFFICER_SEAT = 1;
/** QA sits at the officer's elbow, at the east end of the north side. */
const QA_SEAT = 2;

/** A crew member's chair at the table: empty, or holding whoever the briefing needs there. */
class Chair {
  readonly seat = new THREE.Group();
  private character: Character | null = null;
  private who = '';

  constructor(private readonly label: () => string) {}

  /** Seats `view` (`who` says whose it is), or empties the chair. */
  set(who: string, view: CrewView | null): void {
    if (this.character && (!view || who !== this.who)) {
      this.seat.remove(this.character.group);
      this.character.dispose();
      this.character = null;
    }
    if (!view) return;
    if (this.character) return this.character.set(view);
    // there's no keyboard on the lounge table: whoever sits here reads and taps a PADD
    this.character = new Character(view, 'padd');
    this.who = who;
    this.seat.add(this.character.group);
    interactive(this.character.group, { kind: 'briefing' }, this.label);
  }

  update(t: number, camera: THREE.Vector3): void {
    this.character?.update(t, camera.distanceTo(this.character.group.getWorldPosition(tmp)));
  }

  dispose(): void {
    this.character?.dispose();
  }
}

/**
 * The observation lounge: a long table under the viewports, where the manager and a project's operations officer hold
 * briefings, the project's QA officer sitting in. The wall screen shows the brief as it takes shape. Built in world
 * coordinates.
 */
export class Lounge {
  private officer = new Chair(() => this.label());
  private qa = new Chair(() => this.label());
  private screen = makeCanvas(1280, 768);
  private screenTex = canvasTexture(this.screen.canvas);
  private screenKey = '';

  constructor(b: Builder) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.56), flat(lcarsSign('Observation lounge', { color: LCARS.lilac, code: '04-00' })));
    sign.position.set(LOUNGE_DOOR_X, 2.88, OFFICE.z1 - OVER_DOOR);
    sign.rotation.y = Math.PI;
    b.add(sign);
    interactive(sign, { kind: 'briefing' }, () => 'Briefings in the observation lounge');

    // viewports along the outer hull
    for (const x of [-3.7, 0, 3.7]) {
      const w = viewport(3.0, 1.8); // 3 wide so the thick surrounds clear each other at 3.7 apart
      w.position.set(x, 1.85, LOUNGE.z1 - WALL_T / 2 - 0.005);
      w.rotation.y = Math.PI;
      b.add(w);
    }

    // the table: a dark stadium on two pedestals
    const table = new THREE.Group();
    table.position.set(TABLE.x, 0, TABLE.z);
    const top = '#2b2d42';
    const straight = TABLE.length - TABLE.width;
    table.add(box(straight, 0.07, TABLE.width, top, 0, 0.72, 0));
    for (const s of [-1, 1]) {
      const end = cyl(TABLE.width / 2, TABLE.width / 2, 0.07, top, 28);
      end.position.set((s * straight) / 2, 0.755, 0);
      table.add(end);
      table.add(box(0.5, 0.72, 0.5, '#495057', (s * straight) / 3, 0, 0));
    }
    table.add(box(straight * 0.8, 0.01, 0.12, LCARS.lilac, 0, 0.79, 0)); // a lit strip down the middle
    b.add(table);
    b.collide(TABLE.x - TABLE.length / 2, TABLE.x + TABLE.length / 2, TABLE.z - TABLE.width / 2, TABLE.z + TABLE.width / 2);
    interactive(table, { kind: 'briefing' }, () => this.label());

    SEATS.forEach(([x, z, facing], i) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = facing;
      g.add(chair('#7b2d43'));
      b.add(g);
      if (i === OFFICER_SEAT) g.add(this.officer.seat);
      if (i === QA_SEAT) g.add(this.qa.seat);
    });

    // the brief, on the west wall where everyone at the table can read it
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.4), flat(this.screenTex));
    screen.position.set(LOUNGE.x0 + 0.16, 1.75, TABLE.z);
    screen.rotation.y = Math.PI / 2;
    b.add(screen);
    b.add(box(0.08, 2.6, 4.2, '#212529', LOUNGE.x0 + 0.1, 0.45, TABLE.z));
    interactive(screen, { kind: 'briefing' }, () => this.label());

    const panel = lcarsConsole(1.6, 1.0, 7);
    panel.position.set(LOUNGE.x1 - 0.13, 1.9, TABLE.z);
    panel.rotation.y = -Math.PI / 2;
    b.add(panel);
    for (const [x, z] of [[LOUNGE.x1 - 0.6, LOUNGE.z1 - 0.6], [LOUNGE.x1 - 0.6, LOUNGE.z0 + 0.6]]) {
      const p = plant(1.1, '#3d405b');
      p.position.set(x, 0, z);
      b.add(p);
      b.collideObject(p.children[0]);
    }
    for (const x of [-2.5, 3.2]) {
      const light = ceilingLight(1.6, 0.9);
      light.position.set(x, WALL_H - 0.03, TABLE.z);
      b.add(light);
    }
    const carpetStripe = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.length + 2.4, TABLE.width + 2.6), toon('#4a4e74').clone());
    carpetStripe.material.userData.outlineParameters = { visible: false };
    carpetStripe.rotation.x = -Math.PI / 2;
    carpetStripe.position.set(TABLE.x, 0.008, TABLE.z);
    b.add(carpetStripe);

    this.sync();
  }

  private label(): string {
    const briefing = state.briefing;
    return briefing ? `Join the briefing about ${state.project(briefing.projectId)?.name ?? 'a project'}` : 'Call a briefing';
  }

  /** Seats (or dismisses) the officer and QA, and redraws the screen to match the current briefing. */
  sync(): void {
    const briefing = state.briefing;
    const projectId = briefing?.projectId ?? '';
    this.officer.set(projectId, briefing && officerView(briefing));
    this.qa.set(projectId, briefing && qaAtBriefing(projectId, briefing, state.qaAgent(projectId)) ? qaView(briefing) : null);
    this.drawScreen(briefing);
  }

  update(t: number, camera: THREE.Vector3): void {
    if (camera.z < OFFICE.z0) return;
    this.officer.update(t, camera);
    this.qa.update(t, camera);
  }

  private drawScreen(briefing: Briefing | null): void {
    const key = JSON.stringify([briefing?.projectId, briefing?.status, briefing?.brief]);
    if (key === this.screenKey) return;
    this.screenKey = key;
    const { canvas, ctx } = this.screen;
    const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: briefing ? 'Briefing' : 'Observation lounge', color: LCARS.lilac, seed: 1864 });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (!briefing) {
      ctx.fillStyle = LCARS.peach;
      ctx.font = `600 56px ${LCARS_FONT}`;
      ctx.fillText('NO BRIEFING IN SESSION', area.x, area.y + 20);
      ctx.fillStyle = LCARS.sky;
      ctx.font = `500 34px ${LCARS_FONT}`;
      for (const [i, line] of wrap(ctx, 'Call one from a holodeck’s New issue stand, or press E here, when an idea needs talking through before anyone builds it.'.toUpperCase(), area.w).entries()) {
        ctx.fillText(line, area.x, area.y + 110 + i * 44);
      }
      this.screenTex.needsUpdate = true;
      return;
    }
    drawBrief(ctx, area, briefing.brief, state.project(briefing.projectId)?.name ?? '', briefing.idea);
    this.screenTex.needsUpdate = true;
  }

  dispose(): void {
    this.officer.dispose();
    this.qa.dispose();
    this.screenTex.dispose();
  }
}

const tmp = new THREE.Vector3();

function officerView(briefing: Briefing): CrewView {
  const crew = plannerFor(briefing.projectId);
  const base = { name: crew.name, avatar: crew.avatar, tag: 'Ops' };
  const project = state.project(briefing.projectId)?.name ?? 'the project';
  switch (briefing.status) {
    case 'thinking':
      return { ...base, status: 'working', icon: '💭', line: briefing.activity, thinking: true };
    case 'qa-checking':
      return { ...base, status: 'waiting', icon: '👂', line: `Hearing from ${qaOfficerFor(briefing.projectId).name}` };
    case 'wrapping-up':
      return { ...base, status: 'working', icon: '📝', line: 'Writing up the issue' };
    case 'waiting':
      return { ...base, status: 'waiting', icon: '🖖', line: 'Your turn' };
    case 'done':
      return { ...base, status: 'done', icon: '📋', line: `The issue’s at ${project}’s stand` };
    case 'failed':
      return { ...base, status: 'error', line: 'Lost my train of thought – say again?' };
  }
}

/** QA at the table: reading the criteria when they've just changed, otherwise listening, their last note to hand. */
function qaView(briefing: Briefing): CrewView {
  const crew = qaOfficerFor(briefing.projectId);
  const base = { name: crew.name, avatar: crew.avatar, tag: 'QA' };
  if (briefing.status === 'qa-checking') return { ...base, status: 'working', icon: '🔍', line: briefing.activity, thinking: true };
  const last = briefing.messages[briefing.messages.length - 1];
  if (last?.from === 'qa') return { ...base, status: 'waiting', icon: '🧪', line: last.text };
  return { ...base, status: 'queued', icon: '🧪', line: 'Listening in on the acceptance criteria' };
}

/** The brief as LCARS columns: summary across the top, why/who on the left, scope and criteria on the right. */
function drawBrief(ctx: CanvasRenderingContext2D, area: { x: number; y: number; w: number; h: number }, brief: Brief, project: string, idea: string): void {
  const colW = (area.w - 40) / 2;
  let y = area.y;
  ctx.fillStyle = LCARS.gold;
  ctx.font = `500 26px ${LCARS_FONT}`;
  ctx.fillText(project.toUpperCase(), area.x, y);
  y += 34;
  ctx.fillStyle = LCARS.peach;
  ctx.font = `600 40px ${LCARS_FONT}`;
  for (const line of wrap(ctx, (brief.summary || idea).toUpperCase(), area.w, 2)) {
    ctx.fillText(line, area.x, y);
    y += 46;
  }
  y += 10;
  const top = y;
  const bottom = area.y + area.h;
  const section = (x: number, y0: number, title: string, color: string, entries: string[], maxY: number): number => {
    if (y0 > maxY - 40) return y0;
    ctx.fillStyle = color;
    ctx.fillRect(x, y0 + 4, 10, 24);
    ctx.font = `600 26px ${LCARS_FONT}`;
    ctx.fillText(title.toUpperCase(), x + 18, y0);
    let yy = y0 + 34;
    ctx.font = `400 24px ${LCARS_FONT}`;
    ctx.fillStyle = '#e8e2f0';
    const items = entries.length ? entries : ['—'];
    for (const entry of items) {
      for (const line of wrap(ctx, entry, colW - 30, 2)) {
        if (yy > maxY - 28) {
          ctx.fillText('…', x + 18, yy);
          return yy + 30;
        }
        ctx.fillText(line, x + 18, yy);
        yy += 28;
      }
    }
    return yy + 12;
  };
  let left = section(area.x, top, 'Why', LCARS.orange, brief.why ? [brief.why] : [], bottom);
  left = section(area.x, left, 'Who for', LCARS.sky, brief.who ? [brief.who] : [], bottom);
  section(area.x, left, 'Open questions', LCARS.red, brief.openQuestions, bottom);
  const rx = area.x + colW + 40;
  let right = section(rx, top, 'Scope', LCARS.periwinkle, brief.scope, bottom);
  right = section(rx, right, 'Out of scope', LCARS.lilac, brief.outOfScope, bottom);
  section(rx, right, 'Acceptance criteria', LCARS.gold, brief.acceptance, bottom);
}
