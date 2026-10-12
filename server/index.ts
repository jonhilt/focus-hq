import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import express from 'express';
import { clock } from '../shared/clock';
import { seededRandom } from '../shared/studio';
import { keyFallback } from './agents/apiKey';
import { BrowserPool } from './agents/browserTool';
import { ClaudeDrafter, ClaudeEngineer, ClaudeNumberOne, ClaudeStudio, ClaudeTriager } from './agents/claudeCrew';
import { StudioComputer } from './agents/studioComputer';
import { ChiefEngineer, transcriptFolders, transcriptReader } from './agents/engineer';
import { ClaudeRunner } from './agents/claudeRunner';
import { DemoDrafter, DemoEngineer, DemoNumberOne, DemoRunner, DemoStudio, DemoTriager, demoTranscripts, demoWorkspace } from './agents/demoRunner';
import { AgentManager } from './agents/manager';
import { Renderer, Sessions, Triage, Workspace } from './agents/services';
import { closedGoalPrs, lookUpPrStates, NumberOne, type ShipStatus, summariseShip } from './agents/numberOne';
import { IssuePlanner } from './agents/planner';
import type { WorkspaceOps } from './agents/types';
import * as git from './agents/workspace';
import { demoLedger } from './demoLedger';
import type { Snapshot } from '../shared/types';
import { Calls } from './call/calls';
import { callKeys, config, paths } from './config';
import { demoLayer, demoPush } from './github/demo';
import { ghCliLayer } from './github/ghCli';
import { GitHub, toProvider } from './github/service';
import { Hub } from './hub';
import { Office } from './office';
import { demoPreviewPage, Previews } from './previews';
import { apiRouter } from './routes';
import { StateLockedError, Store } from './store';
import { currentVersion, RESTART_MESSAGE, Updater } from './updater';
import { errorMessage, seedIds } from './util';
import { Voice } from './voice';

/** How often orphaned agent workspaces are swept up, besides once at startup. */
const SWEEP_EVERY_MS = 60 * 60_000;

const liveWorkspace: WorkspaceOps = {
  create: git.createWorktree,
  remove: git.removeWorktree,
  dir: git.workspaceDir,
  hasUncommittedChanges: git.hasUncommittedChanges,
  commitsAhead: git.commitsAhead,
  head: git.head,
  unshippedCommits: git.unshippedCommits,
  freshBranch: git.freshBranch,
  cherryPick: git.cherryPick,
  push: git.pushBranch,
  publish: git.publishBranch,
  pull: git.pullBranch,
  checkoutPullRequest: git.checkoutPullRequest,
  mergeBase: git.mergeBase,
  missingRemoteCommits: git.missingRemoteCommits,
  reopen: git.reopenWorktree,
  snapshot: git.snapshot,
  branchState: git.branchState,
  sinceVerdict: git.sinceVerdict,
  runChecks: git.runChecks,
};

async function main() {
  // the studio films the same episode each run: the demo's waits and picks roll the same dice
  // and its ids, which the crew's names hash from
  if (config.studio) {
    const seed = Number(process.env.FOCUS_DEMO_SEED ?? 1);
    Math.random = seededRandom(seed);
    seedIds(seededRandom(seed + 1));
  }
  const store = new Store(!config.demo);
  store.load();

  const hub = new Hub();
  keyFallback.onChange = (onKey, spell) => {
    if (onKey) hub.toast('info', `🔑 Your plan's usage limit is reached until ${clock(spell.until)}: agents carry on with your API key (up to $${keyFallback.budgetUsd})`);
    else if (spell.until > Date.now()) hub.toast('error', `🔑 Your API key has spent its $${keyFallback.budgetUsd}: agents wait for your plan's usage limit to reset at ${clock(spell.until)}`);
    else hub.toast('success', `🔑 Your plan's usage limit has reset: agents are back on it (the key spent about $${spell.spentUsd.toFixed(2)})`);
  };
  // one GitHub for the whole office (the demo's lives in memory), as an Effect service and through the Promise adapter
  const gitHub = Layer.succeed(GitHub, await ManagedRuntime.make(config.demo ? demoLayer : ghCliLayer).runPromise(GitHub.use(Effect.succeed)));
  const github = toProvider(gitHub);
  const browsers = new BrowserPool();
  const runner = config.demo ? new DemoRunner() : new ClaudeRunner(browsers);
  const previews = new Previews(hub, github, config.demo);
  const planner = new IssuePlanner(store, hub, config.demo ? new DemoDrafter() : new ClaudeDrafter());
  const workspace = config.demo ? demoWorkspace : liveWorkspace;
  // Number One reads the ship through the office, which is up by the time anyone asks
  const numberOne = new NumberOne(store, hub, config.demo ? new DemoNumberOne() : new ClaudeNumberOne(), async (): Promise<ShipStatus> => {
    const snapshot = await office.snapshot();
    // closed goals' PRs, looked up live on every call: one that fails falls back to what was recorded
    const prStates = await lookUpPrStates(closedGoalPrs(snapshot), (repo, number) => github.pullRequestState(repo, number));
    return summariseShip(snapshot, (id) => workspace.dir(id), prStates);
  });
  // the chief engineer reads the agents' sessions for frictions at retro time (the demo's are scripted), and writes what
  // they find to the ledger through the manager, which is up by the time anyone starts a retro
  const engineer = new ChiefEngineer(store, hub, config.demo ? new DemoEngineer() : new ClaudeEngineer(), paths.retros, {
    readTranscript: config.demo
      ? async (id) => (await demoTranscripts()).find((t) => t.sessionId === id)?.read()
      : transcriptReader(paths.transcripts, paths.workspaces),
    record: (projectId, entry, at) => office.agents.record(projectId, entry, at),
    pauseMs: config.demo ? 500 : 20_000,
  });
  // calls to Number One read the ship and start queued goals through the office, which is up by the time anyone calls
  const calls: Calls = new Calls(hub, {
    snapshot: (): Promise<Snapshot> => office.snapshot(),
    ledger: () => store.ledger,
    startQueued: (projectId, queueId, station) => office.agents.startQueued(projectId, queueId, { station }),
    startGoal: (projectId, text) => office.agents.startGoal(projectId, text, { from: 'a call' }),
    message: (agentId, text) => office.agents.message(agentId, text),
  }, callKeys, config.demo);
  const studio = new StudioComputer(store, hub, config.demo ? new DemoStudio() : new ClaudeStudio());
  const office = new Office(store, hub, github, previews, planner, numberOne, studio, engineer, new Voice(hub, config.demo), calls, await currentVersion());
  const crew = Layer.mergeAll(gitHub, Workspace.fromOps(workspace), Sessions.fromRunner(runner), Triage.fromTriager(config.demo ? new DemoTriager() : new ClaudeTriager()), Renderer.fromBrowser(browsers));
  office.agents = new AgentManager(store, hub, crew, (id) => office.boardChanged(id));
  // each agent session is digested into the ledger as it ends: the demo's agents have no transcripts
  // the demo's older sessions are its scripted ones, digested without Haiku
  if (config.demo) office.agents.transcripts = demoTranscripts;
  else {
    office.agents.readTranscript = transcriptReader(paths.transcripts, paths.workspaces);
    office.agents.transcripts = transcriptFolders(paths.transcripts, paths.workspaces);
  }

  if (config.demo && store.projects.length === 0) {
    const shop = store.addProject('Sock Shop', '#ff8a5b', 'beach');
    shop.repos = ['demo/webshop-frontend', 'demo/webshop-api'];
    shop.maxAgents = 2;
    const game = store.addProject('Space Dodger', '#5bc0eb', 'moon');
    game.repos = ['demo/space-dodger'];
    // so the demo shows a PR going QA pass → checks green → merged by itself
    game.autoMerge = true;
    // the studio's recorder starts the one goal it films itself
    if (!config.studio) {
      // the demo keeps no ledger: a few days of one, to review at the master systems table
      store.ledger = demoLedger(shop.id, game.id, Date.now());
      // two goals under way side by side, each with its own lead at its own team station
      office.agents.startGoal(shop.id, 'Shoppers can save items for later and find them again on any device');
      office.agents.startGoal(shop.id, 'Show how many of each sock are left in stock on the product page', { station: 2 });
    }
  }

  const app = express();
  app.use('/api', apiRouter(office, store));
  if (config.demo) {
    app.get('/demo-preview/:owner/:name/:number', (req, res) => {
      const repo = `${req.params.owner}/${req.params.name}`;
      const preview = previews.list().find((p) => p.repo === repo && p.number === Number(req.params.number));
      const site = typeof req.query.site === 'string' ? req.query.site : 'web';
      res.type('html').send(demoPreviewPage(repo, Number(req.params.number), preview?.title ?? 'Pull request preview', site));
    });
    // pretend someone pushed to a PR (?kind=merge-base merges main in, ?kind=change changes its code), which goes to QA
    app.post('/demo-push/:owner/:name/:number', (req, res) => {
      const repo = `${req.params.owner}/${req.params.name}`;
      const number = Number(req.params.number);
      const project = store.projects.find((p) => p.repos.includes(repo));
      const pr = project && store.boards.get(project.id)?.prs.find((p) => p.repo === repo && p.number === number);
      if (!project || !pr || !demoPush) return void res.status(404).json({ error: `${repo}#${number} is not an open pull request on a board` });
      const head = demoPush(repo, number, req.query.kind === 'change' ? 'change' : 'merge-base');
      void office.refreshBoard(project.id).then(() => office.agents.requestReview(project.id, repo, number, pr.title)).catch((err: unknown) => console.warn(`Demo push to ${repo}#${number}: ${String(err)}`));
      res.json({ head });
    });
  }
  // the Tricorder's page lives in a folder (client/tricorder/index.html), and its relative URLs need the slash
  app.get('/tricorder', (req, res, next) => (req.path.endsWith('/') ? next() : res.redirect(req.originalUrl.replace('/tricorder', '/tricorder/'))));
  const server = http.createServer(app);
  hub.attach(server, () => office.snapshot());

  if (config.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(config.root, 'vite.config.ts'),
      // .ts.net: the phone reaches the office through Tailscale Serve (see docs/tricorder.md)
      server: { middlewareMode: true, hmr: { server }, allowedHosts: ['.ts.net'] },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(config.root, 'dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      console.error('No client build found. Run "pnpm run build" first, or use "pnpm run dev".');
      process.exit(1);
    }
    app.use(express.static(dist));
    app.get('/{*any}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  server.listen(config.port, config.host, () => {
    console.log(`\n  🏢  Focus office is open: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`      mode: ${config.demo ? 'demo (fake GitHub, pretend agents)' : 'live (gh CLI + Claude Agent SDK)'}`);
    if (!config.demo && keyFallback.mode === 'fallback') {
      console.log(`      agents use your Claude login, and ANTHROPIC_API_KEY while your plan's usage limit is reached (up to $${keyFallback.budgetUsd} each time).`);
    } else if (!config.demo && process.env.ANTHROPIC_API_KEY && keyFallback.mode === 'login') {
      console.log('      note: ANTHROPIC_API_KEY is set but agents ignore it and use your Claude login (set FOCUS_USE_API_KEY=1 to use the key, or =fallback to use it when your plan runs out).');
    }
    console.log('');
  });

  await office.start();
  if (!config.demo) {
    const sweep = () =>
      git
        .sweepWorkspaces(store.agents.keys(), store.projects.map((p) => p.id))
        .catch((err: unknown) => console.error(`Workspace sweep failed: ${errorMessage(err)}`));
    void sweep();
    setInterval(() => void sweep(), SWEEP_EVERY_MS);
    const info = await office.checkGitHub();
    if (!info.github.ok) console.warn(`  ⚠ ${info.github.error}`);
    else console.log(`  GitHub: signed in as ${info.github.login}`);
  }

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    console.log('\nClosing the office…');
    for (const agent of store.agents.values()) office.agents.stop(agent.id);
    store.save();
    // Kokoro's process goes by SIGKILL (see server/speech.ts): with onnxruntime out of this process, exiting can't abort
    office.voice.close();
    await Promise.all([browsers.shutdown(), previews.shutdown()]);
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  const restart = () => {
    process.send?.(RESTART_MESSAGE);
    return shutdown();
  };
  if (config.autoUpdate) await new Updater(store, hub, restart).start();
}

main().catch((err: unknown) => {
  // another office on the same data folder is expected, and its message says what to do: no stack trace to bury it
  if (err instanceof StateLockedError) console.error(err.message);
  else console.error(err);
  process.exit(1);
});
