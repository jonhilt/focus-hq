import { columns, goalState } from '../../../shared/board';
import { UNIFORM } from '../../../shared/crew';
import { waitsLabel } from '../../../shared/dependencies';
import * as THREE from 'three';
import { prKey, qaBadge } from '../../../shared/qa';
import { triageLabel } from '../../../shared/triage';
import type { Agent, Board, Project } from '../../../shared/types';
import { state } from '../net/state';
import { canvasTexture, fitText, makeCanvas, wrap } from './canvas';
import { flat } from './materials';
import { LCARS, LCARS_FONT, LCARS_STATUS, lcarsFrame } from './starship';

const shortRepo = (repo: string) => repo.split('/')[1] ?? repo;

/** The big LCARS display on each room's back wall. */
export class KanbanBoard {
  readonly material: THREE.MeshBasicMaterial;
  private readonly c = makeCanvas(1800, 760);
  private readonly texture: THREE.CanvasTexture;

  constructor() {
    this.texture = canvasTexture(this.c.canvas);
    this.material = flat(this.texture);
  }

  /** Width / height of the drawing, so the board mesh can match it. */
  get aspect(): number {
    return this.c.canvas.width / this.c.canvas.height;
  }

  draw(project: Project, board: Board | undefined, agents: Agent[]): void {
    const { ctx } = this.c;
    const cols = columns(project, board, agents, state.info?.github.login);
    const multiRepo = project.repos.length > 1;
    const seed = [...project.id].reduce((n, ch) => n + ch.charCodeAt(0), 0);
    const area = lcarsFrame(ctx, this.c.canvas.width, this.c.canvas.height, { title: project.name, color: project.color, seed });
    const bottom = area.y + area.h;

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = LCARS.peach;
    ctx.font = `500 28px ${LCARS_FONT}`;
    const repos = project.repos.length ? project.repos.join('  ·  ') : 'No repositories yet – connect one in the ready room';
    ctx.fillText(fitText(ctx, repos.toUpperCase(), area.w * 0.5), area.x, area.y + 12);
    if (board?.error) {
      ctx.fillStyle = LCARS_STATUS.error;
      ctx.textAlign = 'right';
      ctx.fillText(fitText(ctx, `⚠ ${board.error.split('\n')[0]}`.toUpperCase(), area.w * 0.48), area.x + area.w, area.y + 12);
    }

    const gutter = 24;
    const colW = (area.w - gutter * 2) / 3;
    const colX = (i: number) => area.x + i * (colW + gutter);
    const headY = area.y + 48;
    const headH = 46;
    const titles: [string, string, number][] = [
      ['📋 To do', LCARS.orange, cols.todo.length],
      ['🔨 In progress', LCARS.sky, cols.goals.length + cols.doing.length],
      [cols.hiddenPrs ? '👀 My PRs' : '👀 Ready to merge', LCARS.lilac, cols.prs.length],
    ];
    titles.forEach(([title, color, count], i) => {
      const x = colX(i);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, headY, colW, headH, [headH / 2, 0, 0, headH / 2]);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.font = `600 34px ${LCARS_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(title.toUpperCase(), x + 26, headY + headH / 2 + 2);
      ctx.textAlign = 'right';
      ctx.fillText(String(count), x + colW - 16, headY + headH / 2 + 2);
    });

    const noteH = 88;
    const gap = 12;
    const top = headY + headH + 16;
    const maxNotes = Math.floor((bottom - top + gap) / (noteH + gap));

    const note = (col: number, row: number, tone: string, title: string, meta: string, dot?: string) => {
      const x = colX(col);
      const y = top + row * (noteH + gap);
      ctx.fillStyle = '#1b1630';
      ctx.beginPath();
      ctx.roundRect(x, y, colW, noteH, [0, 12, 12, 0]);
      ctx.fill();
      ctx.fillStyle = tone;
      ctx.fillRect(x, y, 10, noteH);
      let tx = x + 26;
      if (dot) {
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(x + 40, y + 30, 14, 0, Math.PI * 2);
        ctx.fill();
        tx = x + 66;
      }
      ctx.fillStyle = '#f1eaff';
      ctx.font = `500 28px ${LCARS_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(wrap(ctx, title, x + colW - tx - 14, 1)[0], tx, y + 30);
      ctx.fillStyle = tone;
      ctx.font = `500 23px ${LCARS_FONT}`;
      ctx.fillText(fitText(ctx, meta.toUpperCase(), colW - 40), x + 26, y + 66);
    };

    const more = (col: number, n: number) => {
      ctx.fillStyle = LCARS.lilac;
      ctx.font = `600 26px ${LCARS_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`+ ${n} MORE…`, colX(col) + colW / 2, bottom - 14);
    };

    const fit = (n: number) => (n > maxNotes ? maxNotes - 1 : n);

    cols.todo.slice(0, fit(cols.todo.length)).forEach((issue, i) => {
      const labels = issue.labels.slice(0, 2).join(', ');
      const waits = waitsLabel(issue.waitsFor);
      const meta = [issue.closedPr && `🧭 PR #${issue.closedPr.pr} closed, try again`, waits && `⏸ ${waits}`, multiRepo ? shortRepo(issue.repo) : '', labels].filter(Boolean).join(' · ') || 'Unassigned';
      note(0, i, waits ? LCARS.lilac : LCARS.peach, `#${issue.number} ${issue.title}`, meta);
    });
    if (cols.todo.length > maxNotes) more(0, cols.todo.length - fit(cols.todo.length));
    if (cols.todo.length === 0) {
      ctx.fillStyle = LCARS.lilac;
      ctx.font = `500 30px ${LCARS_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('NOTHING TO DO – ADD AN ISSUE!', colX(0) + colW / 2, top + 44);
    }

    // the goals first: each is in progress for as long as it's open, whether or not its lead is at it right now
    const doing = [
      ...cols.goals.map((lead) => ({
        tone: lead.lead?.closing ? LCARS.gold : lead.status === 'waiting' || lead.status === 'error' ? LCARS_STATUS[lead.status] : LCARS.periwinkle,
        title: `🎯 ${lead.lead?.title ?? lead.issue.title}`,
        meta: `${lead.name} · ${goalState(lead)}`,
        dot: UNIFORM[lead.avatar.division],
      })),
      ...cols.doing.map((agent) => ({
        tone: LCARS_STATUS[agent.status],
        title: `#${agent.issue.number} ${agent.issue.title}`,
        meta: `${agent.name} · ${agent.status === 'waiting' ? agent.handover ? '☁ needs a cloud session' : '✋ needs approval' : agent.status}${multiRepo ? ` · ${shortRepo(agent.repo)}` : ''}`,
        dot: UNIFORM[agent.avatar.division],
      })),
    ];
    doing.slice(0, fit(doing.length)).forEach((n, i) => note(1, i, n.tone, n.title, n.meta, n.dot));
    if (doing.length > maxNotes) more(1, doing.length - fit(doing.length));

    cols.prs.slice(0, fit(cols.prs.length)).forEach((pr, i) => {
      const checks = { passing: '✓ checks pass', failing: '✗ checks failing', pending: '⏳ checks running', none: 'no checks' }[pr.checks];
      const review = state.reviews.get(prKey(pr.repo, pr.number));
      const qa = qaBadge(review, pr);
      const flags = [pr.isDraft ? 'draft' : '', pr.mergeable === 'CONFLICTING' ? '⚠ conflicts' : '', pr.reviewDecision === 'APPROVED' ? '👍 approved' : ''].filter(Boolean);
      const triage = review?.triage && qa.state !== 'triaging' ? triageLabel(review.triage) : '';
      const meta = [qa.state === 'none' ? '' : qa.label, triage, pr.agent ? pr.agent.name : pr.author ? `@${pr.author}` : '', checks, ...flags].filter(Boolean).join(' · ');
      const tone = pr.checks === 'failing' || pr.mergeable === 'CONFLICTING' || ['failed', 'fixing', 'needs-you'].includes(qa.state) ? LCARS_STATUS.error : LCARS_STATUS.done;
      note(2, i, tone, `PR #${pr.number} ${pr.title}`, meta, pr.agent && UNIFORM[pr.agent.avatar.division]);
    });
    if (cols.prs.length > maxNotes) more(2, cols.prs.length - fit(cols.prs.length));

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
