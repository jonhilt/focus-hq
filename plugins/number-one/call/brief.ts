import { type Contact, frictionGroups, type GoalNote, type GoalRecord, hasLeadWork, type LeadAgent, type LedgerEvent, prKey, type Project, qaBadge, shownProjects, type Snapshot, trace, type Waypoint } from '../../../plugin-api/server';

// What the captain can talk through on a call, and the briefing the voice model talks from: the record (a goal's brief,
// its lead's note, its slices, its pull requests, and what the ledger saw of it), not the code. Pure, so it's unit
// tested (brief.test.ts).

/** Closed goals offered per project, newest first. */
const CLOSED_PER_PROJECT = 4;
/** The voice model takes context in pieces of up to 500 tokens: a piece of the briefing is at most this long. */
export const PIECE_CHARS = 1_800;
/** The most of a briefing the voice model is given, in pieces. */
const MAX_PIECES = 10;
const MAX_QUOTES = 8;
const MAX_ISSUES = 10;
const DAY_MS = 86_400_000;
/** How far back a project's briefing looks in the ledger. */
const PROJECT_DAYS = 14;

/** Something to talk through: a goal under way, a closed one, or a project as a whole. */
export type Topic =
  | { kind: 'goal'; id: string; label: string; projectId: string; leadId: string; title: string }
  | { kind: 'closed-goal'; id: string; label: string; projectId: string; goalId: string; title: string }
  | { kind: 'project'; id: string; label: string; projectId: string; title: string };

/** Everything that can be talked through, as Jev's options: open goals first, then closed ones, then the projects. */
export function topics(snapshot: Snapshot): Topic[] {
  const projects = shownProjects(snapshot.projects);
  const open = projects.flatMap((p) =>
    snapshot.agents
      .filter(hasLeadWork)
      .filter((a) => a.projectId === p.id && a.task === 'lead')
      .map((a): Topic => ({ kind: 'goal', id: `goal:${a.id}`, label: `The goal "${a.lead.title}" in ${p.name}, led by ${a.name}`, projectId: p.id, leadId: a.id, title: a.lead.title })),
  );
  const closed = projects.flatMap((p) =>
    (p.goals ?? [])
      .slice(0, CLOSED_PER_PROJECT)
      .map((g): Topic => ({ kind: 'closed-goal', id: `closed:${g.id}`, label: `The closed goal "${g.title}" in ${p.name}`, projectId: p.id, goalId: g.id, title: g.title })),
  );
  const whole = projects.map((p): Topic => ({ kind: 'project', id: `project:${p.id}`, label: `${p.name} as a whole: how it's going, its issues, what keeps getting in the way`, projectId: p.id, title: p.name }));
  return [...open, ...closed, ...whole];
}

const bullets = (title: string, items: string[]) => (items.length ? `${title}:\n${items.map((i) => `- ${i}`).join('\n')}` : '');

function noteLines(note: GoalNote | undefined, contacts: Contact[] = []): string[] {
  if (!note) return ['The lead has written no note yet.'];
  const open = contacts.filter((c) => !c.closed);
  return [
    note.done ? `What done looks like: ${note.done}` : '',
    bullets('What the slices taught', note.learned),
    bullets('Ideas for next', note.next),
    bullets('Loose threads still open', open.map((c) => c.text)),
  ];
}

function slicesLines(waypoints: Waypoint[] = []): string {
  return bullets(
    'Its slices so far',
    waypoints.map((w) => [
      `Slice ${w.slice}: ${w.title ?? w.heading ?? 'not shipped yet'}${w.landedAt ? ' (landed)' : ''}`,
      w.summary,
      // the lead's own tasks in it, from the task list it keeps
      ...(w.tasks ?? []).map((t) => `${t.status === 'completed' ? '[done]' : t.status === 'in_progress' ? '[doing]' : '[to do]'} ${t.subject}`),
      ...(w.learned ?? []).map((l) => `learned: ${l}`),
    ].filter(Boolean).join('. ')),
  );
}

/** What the ledger saw of a goal: QA rounds, conflicts, and the moments its sessions got stuck. */
function ledgerLines(ledger: LedgerEvent[], title: string): string {
  const { totals, steps } = trace(ledger, { kind: 'goal', title });
  if (!steps.length) return 'The ship’s log has nothing on it yet.';
  const quotes = steps.flatMap((s) => s.quotes ?? []).slice(-MAX_QUOTES);
  return [
    `From the ship’s log: ${totals.prs} pull requests, ${totals.verdicts} QA verdicts (${totals.fails} failed), ${totals.conflicts} merge conflicts, ${totals.sessions} sessions over ${Math.round(totals.minutes)} minutes.`,
    bullets('Where its sessions got stuck (quoted)', quotes),
  ]
    .filter(Boolean)
    .join('\n');
}

function openGoal(snapshot: Snapshot, ledger: LedgerEvent[], lead: LeadAgent, project: Project): string[] {
  const work = lead.lead;
  const reviews = new Map(snapshot.reviews.map((r) => [prKey(r.repo, r.number), r]));
  const board = snapshot.boards.find((b) => b.projectId === project.id);
  const prs = work.prs.map((p) => {
    const pr = board?.prs.find((b) => b.repo === p.repo && b.number === p.number);
    return `${p.repo} pull request ${p.number}${pr ? `, "${pr.title}": ${qaBadge(reviews.get(prKey(p.repo, p.number)), pr).label}` : ''}${p.outcome ? `, ${p.outcome}` : ''}`;
  });
  return [
    `Topic: the goal "${work.title}" in ${project.name}. ${lead.name} leads it, at station ${work.station + 1}, on slice ${work.slice}.`,
    work.brief ? `The goal as the captain first put it: ${work.brief}` : '',
    ...noteLines(work.note, work.contacts),
    slicesLines(work.waypoints),
    bullets("This slice's pull requests", prs),
    ledgerLines(ledger, work.title),
  ];
}

function closedGoal(ledger: LedgerEvent[], goal: GoalRecord, project: Project): string[] {
  return [
    `Topic: the closed goal "${goal.title}" in ${project.name}, led by ${goal.leadName}, over ${goal.slices} slices, closed ${new Date(goal.closedAt).toDateString()}.`,
    goal.brief ? `The goal as the captain first put it: ${goal.brief}` : '',
    ...noteLines(goal.note, goal.contacts),
    slicesLines(goal.waypoints),
    bullets('Its pull requests', goal.prs.map((p) => `${p.repo} ${p.number}: ${p.outcome ?? 'still open'}`)),
    ledgerLines(ledger, goal.title),
  ];
}

function wholeProject(snapshot: Snapshot, ledger: LedgerEvent[], project: Project, now: number): string[] {
  const leads = snapshot.agents.filter(hasLeadWork).filter((a) => a.projectId === project.id && a.task === 'lead');
  const mine = ledger.filter((e) => e.projectId === project.id);
  const recent = mine.filter((e) => e.at >= now - PROJECT_DAYS * DAY_MS);
  const verdicts = recent.filter((e) => e.kind === 'qa-verdict');
  const issues = snapshot.boards.find((b) => b.projectId === project.id)?.issues ?? [];
  return [
    `Topic: ${project.name} as a whole.`,
    bullets('Goals under way', leads.map((a) => `"${a.lead.title}", led by ${a.name}${a.lead.note?.done ? `: done looks like ${a.lead.note.done}` : ''}`)),
    bullets('Goals queued', (project.goalQueue ?? []).map((q) => q.text.split('\n')[0])),
    bullets('Closed goals, newest first', (project.goals ?? []).slice(0, CLOSED_PER_PROJECT).map((g) => `"${g.title}"${g.note?.learned.length ? `; learned: ${g.note.learned.join(' / ')}` : ''}`)),
    bullets('Open issues', issues.slice(0, MAX_ISSUES).map((i) => `${i.number}: ${i.title}`)),
    `In the last ${PROJECT_DAYS} days the log has ${verdicts.length} QA verdicts (${verdicts.filter((e) => e.kind === 'qa-verdict' && e.verdict === 'fail').length} failed), ${recent.filter((e) => e.kind === 'conflicts' && e.resolved !== 'up-to-date').length} merge conflicts and ${recent.filter((e) => e.kind === 'merged').length} merges.`,
    bullets(
      'What keeps getting in the way (the frictions found in the agents’ sessions)',
      frictionGroups(mine, now, PROJECT_DAYS).slice(0, MAX_QUOTES).map((g) => `${g.signature}, in ${g.sessions} sessions: “${g.moments[0]?.quote ?? ''}”`),
    ),
  ];
}

/** The briefing on a topic, as the record has it; empty when the topic's gone (a goal closed since). */
export function briefing(snapshot: Snapshot, ledger: LedgerEvent[], topic: Topic, now: number): string {
  const project = snapshot.projects.find((p) => p.id === topic.projectId);
  if (!project) return '';
  const lines = (() => {
    switch (topic.kind) {
      case 'goal': {
        const lead = snapshot.agents.filter(hasLeadWork).find((a) => a.id === topic.leadId);
        return lead ? openGoal(snapshot, ledger, lead, project) : [];
      }
      case 'closed-goal': {
        const goal = project.goals?.find((g) => g.id === topic.goalId);
        return goal ? closedGoal(ledger, goal, project) : [];
      }
      case 'project':
        return wholeProject(snapshot, ledger, project, now);
    }
  })();
  return lines.filter(Boolean).join('\n\n');
}

/** A briefing in pieces the voice model can take, split between paragraphs (or lines, or words) and capped. */
export function pieces(text: string, size = PIECE_CHARS): string[] {
  const out: string[] = [];
  let current = '';
  for (const part of text.split(/(?<=\n)/)) {
    for (const chunk of part.length > size ? part.match(new RegExp(`[^]{1,${size}}`, 'g')) ?? [part] : [part]) {
      if (current.length + chunk.length > size) {
        out.push(current.trim());
        current = '';
      }
      current += chunk;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out.slice(0, MAX_PIECES);
}
