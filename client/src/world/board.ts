import * as THREE from 'three';
import type { Agent, Board, Issue, Project, PullRequest } from '../../../shared/types';
import { canvasTexture, fitText, makeCanvas, roundRect, UI_FONT, wrap } from './canvas';
import { state } from '../net/state';
import { flat } from './materials';

export interface Columns {
  todo: Issue[];
  doing: Agent[];
  prs: (PullRequest & { agent?: Agent })[];
  /** Open PRs hidden by the project's "only my PRs" filter. */
  hiddenPrs: number;
}

/** Splits a project's issues, agents and PRs into the three Kanban columns. */
export function columns(project: Project, board: Board | undefined, agents: Agent[]): Columns {
  const prs = board?.prs ?? [];
  const claimed = (issue: Issue) =>
    agents.some((a) => a.repo === issue.repo && a.issue.number === issue.number) ||
    prs.some((p) => p.repo === issue.repo && p.branch.startsWith(`focus/${issue.number}-`));
  const login = state.info?.github.login;
  const all = prs.map((p) => ({ ...p, agent: agents.find((a) => a.repo === p.repo && a.pr?.number === p.number) }));
  // agents' PRs are opened with your gh account, so author === login covers them too; the agent check catches stale data
  const shown = project.onlyMyPrs && login ? all.filter((p) => p.agent || p.author === login) : all;
  return {
    todo: (board?.issues ?? []).filter((i) => project.repos.includes(i.repo) && !claimed(i)),
    doing: agents.filter((a) => a.status !== 'done').sort((a, b) => a.startedAt - b.startedAt),
    prs: shown,
    hiddenPrs: all.length - shown.length,
  };
}

const shortRepo = (repo: string) => repo.split('/')[1] ?? repo;

/** The big whiteboard on each room's back wall. */
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
    const { canvas, ctx } = this.c;
    const W = canvas.width;
    const H = canvas.height;
    const cols = columns(project, board, agents);
    const multiRepo = project.repos.length > 1;

    ctx.fillStyle = '#fdfdfb';
    ctx.fillRect(0, 0, W, H);
    // faint marker smudges
    ctx.fillStyle = 'rgba(120,140,160,0.05)';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse(200 + i * 290, 380 + Math.sin(i) * 200, 160, 40, i, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = project.color;
    ctx.font = `700 58px ${UI_FONT}`;
    ctx.fillText(fitText(ctx, project.name, 900), 40, 52);
    ctx.fillStyle = '#868e96';
    ctx.font = `500 28px ${UI_FONT}`;
    ctx.textAlign = 'right';
    const repos = project.repos.length ? project.repos.join('  ·  ') : 'No repositories yet – connect one in the Manager’s office';
    ctx.fillText(fitText(ctx, repos, 820), W - 40, 56);
    if (board?.error) {
      ctx.fillStyle = '#e03131';
      ctx.font = `500 22px ${UI_FONT}`;
      ctx.fillText(fitText(ctx, `⚠ ${board.error.split('\n')[0]}`, 820), W - 40, 92);
    }

    const colW = (W - 80) / 3;
    const titles: [string, string, number][] = [
      ['📋 To do', '#f08c00', cols.todo.length],
      ['🔨 In progress', '#1c7ed6', cols.doing.length],
      [cols.hiddenPrs ? '👀 My PRs' : '👀 Ready to merge', '#2f9e44', cols.prs.length],
    ];
    titles.forEach(([title, color, count], i) => {
      const x = 40 + i * colW;
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 10, 150);
      ctx.lineTo(x + colW - 20, 152);
      ctx.stroke();
      if (i > 0) {
        ctx.strokeStyle = '#ced4da';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 6, 120);
        ctx.lineTo(x - 4, H - 30);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.font = `700 40px ${UI_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(title, x + 10, 120);
      ctx.font = `700 30px ${UI_FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(String(count), x + colW - 24, 122);
    });

    const noteH = 92;
    const gap = 12;
    const top = 172;
    const maxNotes = Math.floor((H - top - 20) / (noteH + gap));

    const note = (col: number, row: number, seed: number, bg: string, title: string, meta: string, metaColor = '#495057', dot?: string) => {
      const x = 40 + col * colW + 12;
      const y = top + row * (noteH + gap);
      const w = colW - 44;
      ctx.save();
      ctx.translate(x + w / 2, y + noteH / 2);
      ctx.rotate(((seed * 37) % 7 - 3) * 0.004);
      ctx.translate(-w / 2, -noteH / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      roundRect(ctx, 4, 6, w, noteH, 8);
      ctx.fill();
      ctx.fillStyle = bg;
      roundRect(ctx, 0, 0, w, noteH, 8);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; // tape
      ctx.fillRect(w / 2 - 40, -8, 80, 18);
      let tx = 16;
      if (dot) {
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(30, 32, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1b1b1b';
        ctx.lineWidth = 3;
        ctx.stroke();
        tx = 56;
      }
      ctx.fillStyle = '#212529';
      ctx.font = `600 26px ${UI_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(wrap(ctx, title, w - tx - 14, 1)[0], tx, 32);
      ctx.fillStyle = metaColor;
      ctx.font = `500 22px ${UI_FONT}`;
      ctx.fillText(fitText(ctx, meta, w - 30), 16, 68);
      ctx.restore();
    };

    const more = (col: number, n: number) => {
      ctx.fillStyle = '#868e96';
      ctx.font = `600 26px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`+ ${n} more…`, 40 + col * colW + colW / 2, H - 28);
    };

    const fit = (n: number) => (n > maxNotes ? maxNotes - 1 : n);

    cols.todo.slice(0, fit(cols.todo.length)).forEach((issue, i) => {
      const labels = issue.labels.slice(0, 2).join(', ');
      note(0, i, issue.number, '#fff3bf', `#${issue.number} ${issue.title}`, [multiRepo ? shortRepo(issue.repo) : '', labels].filter(Boolean).join(' · ') || 'Unassigned');
    });
    if (cols.todo.length > maxNotes) more(0, cols.todo.length - fit(cols.todo.length));
    if (cols.todo.length === 0) {
      ctx.fillStyle = '#adb5bd';
      ctx.font = `500 28px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('Nothing to do – add an issue!', 40 + colW / 2, top + 50);
    }

    cols.doing.slice(0, fit(cols.doing.length)).forEach((agent, i) => {
      const statusColor = agent.status === 'waiting' ? '#e67700' : agent.status === 'error' ? '#c92a2a' : '#1864ab';
      const meta = `${agent.name} · ${agent.status === 'waiting' ? '✋ needs approval' : agent.status}${multiRepo ? ` · ${shortRepo(agent.repo)}` : ''}`;
      note(1, i, agent.issue.number, agent.status === 'error' ? '#ffe3e3' : '#d0ebff', `#${agent.issue.number} ${agent.issue.title}`, meta, statusColor, agent.avatar.shirt);
    });
    if (cols.doing.length > maxNotes) more(1, cols.doing.length - fit(cols.doing.length));

    cols.prs.slice(0, fit(cols.prs.length)).forEach((pr, i) => {
      const checks = { passing: '✓ checks pass', failing: '✗ checks failing', pending: '⏳ checks running', none: 'no checks' }[pr.checks];
      const flags = [pr.isDraft ? 'draft' : '', pr.mergeable === 'CONFLICTING' ? '⚠ conflicts' : '', pr.reviewDecision === 'APPROVED' ? '👍 approved' : ''].filter(Boolean);
      const meta = [pr.agent ? pr.agent.name : pr.author ? `@${pr.author}` : '', checks, ...flags].filter(Boolean).join(' · ');
      const color = pr.checks === 'failing' || pr.mergeable === 'CONFLICTING' ? '#c92a2a' : '#2b8a3e';
      note(2, i, pr.number, '#d3f9d8', `PR #${pr.number} ${pr.title}`, meta, color, pr.agent?.avatar.shirt);
    });
    if (cols.prs.length > maxNotes) more(2, cols.prs.length - fit(cols.prs.length));

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
