import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from '../../config';
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
import { demoModel, sessionModel } from '../modelSession';
import { MACHINES } from '../machines';

/**
 * What the office lends a plugin that the manager doesn't have: where it runs, its own repo, filing issues, the demo's
 * transcripts, the whole office's snapshot and the ship's status.
 */
export interface Lent {
  demo: boolean;
  ownRepo: () => string | undefined;
  /** Files an issue and puts it on the project's board (`Office.fileIssue`): none in a test that doesn't need it. */
  fileIssue?: (projectId: string, repo: string, title: string, body: string) => Promise<Issue>;
  /** Reads a session's transcript in place of the manager's `readTranscript`: the demo's stand-ins for its scripted agents. */
  transcript?: (sessionId: string) => Promise<string | undefined>;
  /** The office's snapshot (`Office.snapshot`): none in a test that doesn't need it. */
  snapshot?: () => Promise<Snapshot>;
  /** The ship's status, with closed goals' pull requests looked up on GitHub (index.ts): none in a test that doesn't need it. */
  shipStatus?: () => Promise<ShipStatus>;
  /** The captain's personal log (`Office.notePersonal`): none in a test that doesn't need it. */
  personalLog?: { entries: () => readonly PersonalEntry[]; note: (text: string, via: string) => PersonalEntry };
  /** How the office's sessions sign in: the office's own `keyFallback` unless a test lends another. */
  signIn?: () => SignIn;
}

/** What a test office (one without it) answers for something the office lends. */
/** A file's plain name, as a lead's artifacts are named (`ledger.html`, `q1.a.jpg`): no folders, nothing hidden. */
const PLAIN_FILE = /^[\w-]+(\.[\w-]+)+$/;

const missing = (what: string) => Promise.reject(new Refused({ message: `This office has no ${what}` }));

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

/** What the office lends the plugin `id` (docs/plugins.md): the manager's seating, its terminals and toasts, and the store. */
export function pluginHost(core: Core, id: string, lent: Lent): PluginHost {
  const dataDir = (how: { movedFrom?: string } = {}) => {
    const dir = pluginDataDir(id, how);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  // what a plugin reads of the office is its own copy: it can't change the office's by changing it
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
    // both become a path: only an agent's own id, and a file's plain name
    artifact: (leadId, file) => (core.store.agents.has(leadId) && PLAIN_FILE.test(file) ? core.store.readArtifact(leadId, file) : Promise.resolve(undefined)),
    // read as it's asked for: the office sets the manager's reader once the plugins have started
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
        if (!lent.personalLog) throw new Refused({ message: 'This office has no personal log' });
        return lent.personalLog.note(text, via);
      },
    },
    goals: {
      start: (projectId, text, how) => core.leads.startGoal(projectId, text, { from: how.from }),
      startQueued: (projectId, queueId, station) => core.leads.startQueued(projectId, queueId, { station }),
      judged: (agentId, judged) => core.comms.judged(agentId, judged),
      message: (agentId, text, opts) => (opts?.from === undefined ? core.goalTools.captainMessage(agentId, text, opts?.how) : core.comms.message(agentId, text, opts.from, opts.how)),
    },
    fileIssue: (projectId, repo, title, body) => {
      // a plugin files only where the captain works: in one of the project's own repos
      const project = core.store.projects.find((p) => p.id === projectId);
      if (!project?.repos.includes(repo)) return Promise.reject(new Refused({ message: `${repo} isn’t one of ${project ? `${project.name}’s` : 'the project’s'} repositories` }));
      if (!lent.fileIssue) return Promise.reject(new Refused({ message: 'This office can’t file issues' }));
      return lent.fileIssue(projectId, repo, title, body);
    },
    ownRepo: lent.ownRepo,
    officeDir: config.root,
    dataDir,
    readOnlySession: (run) => runReadOnly(run),
    drawModel: async ({ question, title, dirs }) => {
      const ask = { question, dirs };
      const model = lent.demo ? demoModel(ask) : await sessionModel(ask, core.store.settings, (run) => runReadOnly(run));
      const drawn = await core.goalTools.drawn(model, title, dirs);
      return { id: title, title, ...drawn };
    },
    shipSession: (run) => shipSession(id, run),
    checkout: async (repo) => {
      // a plugin checks out only the captain's repos, and only into its own folder
      if (!core.store.projects.some((p) => p.repos.includes(repo))) throw new Refused({ message: `${repo} isn’t one of the office’s repositories` });
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
      // the office's own record of them, not the plugin's copy
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
