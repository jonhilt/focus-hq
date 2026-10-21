import type { Issue } from './types';

const LINE = /\b(?:depends\s+on|blocked\s+by)\b:?[ \t]*((?:#\d+(?:[ \t]*(?:,|&|\band\b)?[ \t]*))+)/gi;

/** The same-repo issue numbers a body says it waits for: `Depends on #12`, `Blocked by #12, #13`. */
export function dependsOn(body: string): number[] {
  const numbers = new Set<number>();
  for (const [, refs] of body.matchAll(LINE)) {
    for (const [, n] of refs.matchAll(/#(\d+)/g)) numbers.add(Number(n));
  }
  return [...numbers];
}

/** How `waitingFor` keys an issue. */
export const issueKey = (repo: string, number: number) => `${repo}#${number}`;

/**
 * The dependency graph among open issues. An edge to an issue that isn't open (closed, or never existed) is dropped, and
 * so is an edge inside a cycle: nothing in a cycle could ever start otherwise, so its members don't wait for each other.
 */
function graph(issues: Issue[]) {
  const open = new Map(issues.map((i) => [issueKey(i.repo, i.number), i]));
  const edges = new Map(
    issues.map((i) => [issueKey(i.repo, i.number), dependsOn(i.body).map((n) => issueKey(i.repo, n)).filter((k) => open.has(k) && k !== issueKey(i.repo, i.number))]),
  );

  // Tarjan's strongly connected components, so cycle members can be recognised: `visit` returns the lowest index it reached
  const component = new Map<string, number>();
  const index = new Map<string, number>();
  const stack: string[] = [];
  let next = 0;
  const visit = (k: string): number => {
    const at = next++;
    index.set(k, at);
    stack.push(k);
    let low = at;
    for (const d of edges.get(k) ?? []) {
      const seen = index.get(d);
      if (seen === undefined) low = Math.min(low, visit(d));
      else if (!component.has(d)) low = Math.min(low, seen);
    }
    if (low === at) {
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member !== undefined) component.set(member, at);
      } while (member !== undefined && member !== k);
    }
    return low;
  };
  for (const k of open.keys()) if (!index.has(k)) visit(k);

  const waits = new Map([...edges].map(([k, deps]) => [k, deps.filter((d) => component.get(d) !== component.get(k))]));
  return { open, waits };
}

/** For each open issue that has to wait (keyed `repo#number`), the open issues it waits for. */
export function waitingFor(issues: Issue[]): Map<string, number[]> {
  const { open, waits } = graph(issues);
  const waiting = new Map<string, number[]>();
  for (const [k, deps] of waits) if (deps.length) waiting.set(k, deps.flatMap((d) => open.get(d)?.number ?? []));
  return waiting;
}

/** The open issues an agent could start on now, best first: the ones holding up the longest chain of others, then the oldest. */
export function startOrder(issues: Issue[]): Issue[] {
  const { open, waits } = graph(issues);
  const dependents = new Map<string, string[]>([...open.keys()].map((k) => [k, []]));
  for (const [k, deps] of waits) for (const d of deps) dependents.get(d)?.push(k);
  // without the edges inside cycles the graph is acyclic, so this recursion ends
  const chain = new Map<string, number>();
  const chainOf = (k: string): number => {
    let n = chain.get(k);
    if (n === undefined) chain.set(k, (n = Math.max(0, ...(dependents.get(k) ?? []).map((d) => 1 + chainOf(d)))));
    return n;
  };
  return [...open]
    .filter(([k]) => !waits.get(k)?.length)
    .sort(([a, ia], [b, ib]) => chainOf(b) - chainOf(a) || ia.createdAt.localeCompare(ib.createdAt))
    .map(([, issue]) => issue);
}

/**
 * The issues auto-assign hires an agent for, in the order to hire them, as many as there are free slots: those that can
 * start now (`startOrder`), carry the project's auto label if it has one, no agent has claimed and have no Ops branch
 * (`focus/<number>-…`) open as a PR yet.
 */
export function issuesToAssign(
  issues: Issue[],
  prs: readonly { repo: string; branch: string }[],
  room: { slots: number; autoLabel?: string; claimed: (repo: string) => ReadonlySet<number> },
): Issue[] {
  const hasPr = (issue: Issue) => prs.some((p) => p.repo === issue.repo && p.branch.startsWith(`focus/${issue.number}-`));
  return startOrder(issues)
    .filter((issue) => (!room.autoLabel || issue.labels.includes(room.autoLabel)) && !room.claimed(issue.repo).has(issue.number) && !hasPr(issue))
    .slice(0, Math.max(0, room.slots));
}

/** "waits for #12, #13", or '' when the issue can start. */
export const waitsLabel = (waitsFor: number[]) => (waitsFor.length ? `waits for ${waitsFor.map((n) => `#${n}`).join(', ')}` : '');

/** What to ask before assigning an agent by hand to an issue that waits for others, or undefined when it can start. */
export const assignWarning = (issue: { number: number; waitsFor: number[] }) =>
  issue.waitsFor.length
    ? `#${issue.number} ${waitsLabel(issue.waitsFor)}, which ${issue.waitsFor.length > 1 ? 'are' : 'is'} still open. Assign an agent anyway?`
    : undefined;
