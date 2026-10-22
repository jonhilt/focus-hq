import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from '../../config';
import { columns } from '../../../shared/board';
import { pluginOn } from '../../../shared/projectPlugins';
import type { Issue, PluginStates, SignIn, Snapshot } from '../../../shared/types';
import { keyFallback } from '../apiKey';
import type { PersonalEntry } from '../../../shared/personalLog';
import type { ShipStatus } from '../shipStatus';
import type { BriefWork, PluginHost, PluginState } from '../../plugins/contract';
import type { Core } from './core';
import { Refused } from './core';
import { checkoutLatest } from '../workspace';
import { pluginDataDir } from '../../plugins/dataDir';
import { lend, lentLog } from '../../plugins/lend';
import { runReadOnly, shipSession } from '../claudeCrew';
import { MACHINES } from '../machines';

/**
 * What Focus lends a plugin that the manager doesn't have: where it runs, its own repo, filing issues, the demo's
 * transcripts, the whole ship's snapshot and its status.
 */
export interface Lent {
  demo: boolean;
  ownRepo: () => string | undefined;
  /** Files an issue and puts it on the project's board (`Focus.fileIssue`): none in a test that doesn't need it. */
  fileIssue?: (projectId: string, repo: string, title: string, body: string) => Promise<Issue>;
  /** Reads a session's transcript in place of the manager's `readTranscript`: the demo's stand-ins for its scripted agents. */
  transcript?: (sessionId: string) => Promise<string | undefined>;
  /** Focus's snapshot (`Focus.snapshot`): none in a test that doesn't need it. */
  snapshot?: () => Promise<Snapshot>;
  /** The ship's status, with closed goals' pull requests looked up on GitHub (index.ts): none in a test that doesn't need it. */
  shipStatus?: () => Promise<ShipStatus>;
  /** The captain's personal log (`Focus.notePersonal`): none in a test that doesn't need it. */
  personalLog?: { entries: () => readonly PersonalEntry[]; note: (text: string, via: string) => PersonalEntry };
  /** How Focus's sessions sign in: Focus's own `keyFallback` unless a test lends another. */
  signIn?: () => SignIn;
  /** The GitHub account Focus works as, for a board's "only my PRs" (`Focus.githubLogin`): none in a test that doesn't need it. */
  githubLogin?: () => string | undefined;
  /** A bot speaking for the captain, as it is now (`Focus.bot`): none in a test that doesn't need it. */
  bot?: () => PluginHost['bot'];
}

/** What a test (one without it) is told of something Focus lends. */
/** A file's plain name, as a lead's artifacts are named (`ledger.html`, `q1.a.jpg`): no folders, nothing hidden. */
const PLAIN_FILE = /^[\w-]+(\.[\w-]+)+$/;

const missing = (what: string) => Promise.reject(new Refused({ message: `Focus has no ${what} to lend here` }));

/** A plugin's slot in `saved`, `fresh()` with what was saved on top (a field added since starts fresh). */
function slot<S extends object>(saved: () => PluginStates, id: string, fresh: () => S, changed: (state: S) => void): PluginState<S> {
  // what's saved under a plugin's id is the plugin's own: only this slot writes it
  const get = () => ({ ...fresh(), ...(saved()[id] as Partial<S> | undefined) });
  return {
    get,
    set: (patch) => {
      const state = { ...get(), ...patch };
      saved()[id] = state;
      changed(state);
    },
  };
}

/** What Focus lends the plugin `id` (docs/plugins.md): the manager's seating, its terminals and toasts, and the store. */
export function pluginHost(core: Core, id: string, lent: Lent): PluginHost {
  const dataDir = (how: { movedFrom?: string } = {}) => {
    const dir = pluginDataDir(id, how);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  // what a plugin reads of Focus is its own copy: it can't change Focus's by changing it
  const ledger = lentLog(() => core.store.ledger);
  return {
    demo: lent.demo,
    state: (fresh, how) => {
      const saved = how?.saved ?? true;
      return slot(() => (saved ? core.store.plugins : core.plugins.unsaved), id, fresh, () => {
        if (saved) core.store.save();
        core.hub.send({ type: 'plugin', id, state: core.plugins.stateOf(id) });
      });
    },
    projects: () => lend(core.store.projects),
    on: (projectId) => pluginOn(core.store.projects.find((p) => p.id === projectId), id),
    agent: (agentId) => {
      const agent = core.store.agents.get(agentId);
      return agent && lend(agent);
    },
    agents: () => lend([...core.store.agents.values()]),
    recentLines: (agentId, count) => lend(core.store.recentLines(agentId, count)),
    boardPrs: (projectId) => {
      const project = core.store.projects.find((p) => p.id === projectId);
      return project ? lend(columns(project, core.store.boards.get(projectId), core.store.agentsIn(projectId), lent.githubLogin?.()).prs) : [];
    },
    reviews: () => lend(core.store.reviews),
    // read afresh each time, as the captain changes it in Settings
    get bot() {
      return lend(lent.bot?.() ?? {});
    },
    // both become a path: only an agent's own id, and a file's plain name
    artifact: (leadId, file) => (core.store.agents.has(leadId) && PLAIN_FILE.test(file) ? core.store.readArtifact(leadId, file) : Promise.resolve(undefined)),
    // read as it's asked for: Focus sets the manager's reader once the plugins have started
    transcript: (sessionId) => (lent.transcript ?? core.ledger.readTranscript)?.(sessionId) ?? Promise.resolve(undefined),
    ledger,
    machines: () => ({ graphs: MACHINES, runs: lend(core.store.machineRuns()) }),
    machinePath: (machine, key) => core.store.machinePath(machine, key),
    journals: (since) => lend(core.store.journalsSince(since)),
    record: (projectId, entry, at) => core.ledger.record(projectId, entry, at),
    settings: () => lend(core.store.settings),
    signIn: () => lent.signIn?.() ?? keyFallback.signIn(),
    snapshot: () => lent.snapshot?.().then(lend) ?? missing('snapshot'),
    shipStatus: () => lent.shipStatus?.() ?? missing('ship’s status'),
    personalLog: {
      entries: () => lend([...(lent.personalLog?.entries() ?? [])]),
      note: (text, via) => {
        if (!lent.personalLog) throw new Refused({ message: 'Focus has no personal log to lend here' });
        return lent.personalLog.note(text, via);
      },
    },
    goals: {
      start: (projectId, text, how) => core.leads.startGoal(projectId, text, { from: how.from }),
      startQueued: (projectId, queueId, station) => core.leads.startQueued(projectId, queueId, { station }),
      resolvePermission: (agentId, requestId, allow) => core.comms.resolvePermission(agentId, requestId, allow),
      answer: (agentId, questionId, option, note, how) => core.goalTools.answer(agentId, questionId, option, note, how),
      closeGoal: (agentId, force) => core.leads.closeGoal(agentId, force),
      readTurn: (agentId) => core.comms.readTurn(agentId),
      mark: (agentId, data, since) => core.comms.mark(agentId, id, lend(data), since),
      raiseLane: (agentId, lane, why) => core.leads.raiseLane(agentId, lane, why, id),
      message: (agentId, text, opts) => (opts?.from === undefined ? core.goalTools.captainMessage(agentId, text, opts?.how) : core.comms.message(agentId, text, opts.from, opts.how)),
    },
    fileIssue: (projectId, repo, title, body) => {
      // a plugin files only where the captain works: in one of the project's own repos
      const project = core.store.projects.find((p) => p.id === projectId);
      if (!project?.repos.includes(repo)) return Promise.reject(new Refused({ message: `${repo} isn’t one of ${project ? `${project.name}’s` : 'the project’s'} repositories` }));
      if (!lent.fileIssue) return Promise.reject(new Refused({ message: 'Focus can’t file issues here' }));
      return lent.fileIssue(projectId, repo, title, body);
    },
    ownRepo: lent.ownRepo,
    focusDir: config.root,
    dataDir,
    readOnlySession: (run) => runReadOnly(run),
    shipSession: (run) => shipSession(id, run),
    checkout: async (repo) => {
      // a plugin checks out only the captain's repos, and only into its own folder
      if (!core.store.projects.some((p) => p.repos.includes(repo))) throw new Refused({ message: `${repo} isn’t one of the captain’s repositories` });
      const dir = path.join(dataDir(), 'checkouts', repo.replace('/', '__'));
      await checkoutLatest(repo, dir);
      return dir;
    },
    leadCheckouts: (agentId) => {
      const agent = core.store.agents.get(agentId);
      // where sessions.ts runs a lead: their workspace, a folder a repo
      return (agent?.lead?.repos ?? []).map((r) => ({ repo: r.repo, dir: path.join(paths.workspaces, agentId, r.folder), baseBranch: r.baseBranch }));
    },
    seat: (projectId, repo, work: BriefWork, crew) => {
      const brief = core.plugins.brief({ plugin: id, kind: work.kind });
      if (!brief) throw new Refused({ message: `${id} has no brief called ${work.kind}` });
      return core.seating.seat(projectId, repo, {
        id: work.id,
        task: 'brief',
        brief: { plugin: id, kind: work.kind, label: brief.label, icon: brief.icon },
        issue: { number: 0, title: work.title, url: '' },
        branch: work.branch,
        baseBranch: work.baseBranch,
      }, crew);
    },
    forget: (agentId) => {
      // what waited for them is kept in their run journal, not the runtime
      core.rt(agentId).inbox.clear();
      core.runtimes.delete(agentId);
    },
    print: (agent, text) => {
      // Focus's own record of them, not the plugin's copy
      const own = core.store.agents.get(agent.id);
      if (own) core.print(own, [{ kind: 'system', text }]);
    },
    toast: (level, text, agentId) => core.hub.toast(level, text, agentId),
    uses: <T extends object>(other: string) => {
      const provided = core.plugins.requires(id, other) ? core.plugins.provided(other) : undefined;
      if (!provided) throw new Error(`${id} uses ${other}, so it has to require it, and ${other} has to provide something`);
      // a required plugin's own type for what it provides: the plugins agree on it through a type-only import
      return provided as T;
    },
  };
}
