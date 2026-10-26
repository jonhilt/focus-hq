import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import express from 'express';
import { keyFallback, signInToast } from './agents/apiKey';
import { BrowserPool } from './agents/browserTool';
import { ClaudeDrafter, ClaudeQaChat, ClaudeTriager, titleGoal } from './agents/claudeCrew';
import { DemoQaChat } from './agents/demoQaChat';
import { githubRepo } from './github/repo';
import { transcriptFolders, transcriptReader } from './agents/transcript';
import { ClaudeRunner } from './agents/claudeRunner';
import { CrewFileError, readCrew } from './agents/crewFiles';
import { DemoDrafter, DemoRunner, DemoTriager, demoTranscripts, demoWorkspace } from './agents/demoRunner';
import { AgentManager } from './agents/manager';
import { QaChat, Recordings, Renderer, Sessions, Triage, Workspace } from './agents/services';
import { closedGoalPrs, lookUpPrStates, type ShipStatus, summariseShip } from './agents/shipStatus';
import { type Drafter, IssuePlanner } from './agents/planner';
import type { QaChatter } from './agents/qaChat';
import type { Triager } from './agents/triage';
import type { AgentRunner, WorkspaceOps } from './agents/types';
import * as git from './agents/workspace';
import { demoLedger } from './demoLedger';
import { config, paths } from './config';
import { demoLayer, demoPush } from './github/demo';
import { clampSpeed } from '../shared/demoPace';
import { setDemoPace } from './demoPace';
import { ghCliLayer } from './github/ghCli';
import { GitHub, toProvider } from './github/service';
import { allowedHosts, allowedLogins, type Caller, refusal, tailnetRefusal } from './hostGuardRules';
import { Hub } from './hub';
import { flowRecorder } from './flows';
import { loadPlugins, pluginCatalog } from './plugins/load';
import { pluginChoice } from '../shared/shipPluginRules';
import { Focus } from './focus';
import { mirrorHosts, PreviewMirrors } from './previewMirrors';
import { demoPreviewPage, Previews } from './previews';
import { pushedPr, pushKind } from './apiRequests';
import { apiRouter } from './routes';
import { settingsInForce } from './settings';
import { openLines } from './startup';
import { StateLockedError, Store } from './store';
import { currentVersion, RESTART_MESSAGE, Updater } from './updater';
import { errorMessage, run, seedShip } from './util';
import { Voice } from './voice';

/** How often orphaned agent workspaces are swept up, besides once at startup. */
const SWEEP_EVERY_MS = 60 * 60_000;

/**
 * What differs between the demo and a live ship, chosen once: the demo's GitHub lives in memory, its agents, workspaces
 * and Claude calls are pretend, and its ship is seeded; a live one runs gh, Claude Code and git, and looks after itself.
 */
interface ShipParts {
  github: typeof ghCliLayer;
  runner: AgentRunner;
  /** The demo's pretend agents, whose transcripts plugins read. */
  demoRunner?: DemoRunner;
  drafter: Drafter;
  triager: Triager;
  qaChat: QaChatter;
  workspace: WorkspaceOps;
  mirrors?: PreviewMirrors;
  /** Focus's own repo, for plugins that work on it. */
  ownRepo(): Promise<string | undefined>;
  /** Where each agent session's transcript is read from, to digest it into the ledger as it ends. */
  readTranscripts(agents: AgentManager): void;
  /** Sets the ship up the first time it starts. */
  seed(store: Store, agents: AgentManager): void;
  /** What Focus keeps doing once it's open. */
  afterStart(focus: Focus, store: Store, hub: Hub, restart: () => Promise<void>): Promise<void>;
}

function demoParts(): ShipParts {
  const demoRunner = new DemoRunner();
  return {
    github: demoLayer,
    runner: demoRunner,
    demoRunner,
    drafter: new DemoDrafter(),
    triager: new DemoTriager(),
    qaChat: new DemoQaChat(),
    workspace: demoWorkspace,
    // the demo has no repo of its own
    ownRepo: async () => undefined,
    // the demo's agents have no transcripts: its older sessions are its scripted ones, digested without Haiku
    readTranscripts: (agents) => (agents.transcripts = demoTranscripts),
    seed: seedDemoShip,
    afterStart: async () => undefined,
  };
}

function liveParts(store: Store, browsers: BrowserPool): ShipParts {
  return {
    github: ghCliLayer,
    runner: new ClaudeRunner(browsers, () => settingsInForce(store.settings).terminal),
    drafter: new ClaudeDrafter(),
    triager: new ClaudeTriager(),
    qaChat: new ClaudeQaChat(),
    workspace: git.liveWorkspace,
    mirrors: new PreviewMirrors(() => mirrorHosts(settingsInForce(store.settings).previewHosts, os.networkInterfaces())),
    ownRepo: async () => githubRepo(await run('git', ['remote', 'get-url', 'origin'], { cwd: config.root }).catch(() => '')),
    readTranscripts: (agents) => {
      agents.readTranscript = transcriptReader(paths.transcripts, paths.workspaces);
      agents.titleGoal = (brief) => titleGoal(brief, store.settings);
      agents.transcripts = transcriptFolders(paths.transcripts, paths.workspaces);
      // the captain's replies to leads, from the spans digested before they were kept, while their transcripts last
      void agents.backfillReplies().catch((err: unknown) => console.warn(`Couldn't keep the captain's older replies: ${errorMessage(err)}`));
    },
    seed: () => undefined,
    afterStart: liveChores,
  };
}

async function main() {
  // a crew file that's wrong stops Focus here, saying which and where, before any agent is told half of it
  readCrew();
  // the demo rolls the same ids each run
  seedShip(config);
  const store = new Store(!config.demo);
  store.load();

  const hub = new Hub();
  keyFallback.onChange = (onKey, spell) => {
    // Focus is up by the time a session runs into the plan's limit
    focus.agents.plugins.signInChanged(keyFallback.signIn());
    const { level, text } = signInToast(onKey, spell, keyFallback.budgetUsd, Date.now());
    hub.toast(level, text);
  };
  const browsers = new BrowserPool(() => settingsInForce(store.settings).browserPath);
  const parts = config.demo ? demoParts() : liveParts(store, browsers);
  // one GitHub for the whole ship (the demo's lives in memory), as an Effect service and through the Promise adapter
  const gitHub = Layer.succeed(GitHub, await ManagedRuntime.make(parts.github).runPromise(GitHub.use(Effect.succeed)));
  const github = toProvider(gitHub);
  const previews = new Previews(hub, github, config.demo, undefined, parts.mirrors);
  const planner = new IssuePlanner(store, hub, parts.drafter);
  // plugins read the ship through `focus`, which is up by the time anyone asks
  const shipStatus = async (): Promise<ShipStatus> => {
    const snapshot = await focus.snapshot();
    // closed goals' PRs, looked up live on every call: one that fails falls back to what was recorded
    const prStates = await lookUpPrStates(closedGoalPrs(snapshot), (repo, number) => github.pullRequestState(repo, number));
    return summariseShip(snapshot, (id) => parts.workspace.dir(id), prStates);
  };
  const version = await currentVersion();
  const focus = new Focus(store, hub, github, previews, planner, new Voice(hub, config.demo, () => settingsInForce(store.settings)), version);
  focus.voice.warmSpeech();
  const crew = Layer.mergeAll(gitHub, Workspace.fromOps(parts.workspace), Sessions.fromRunner(parts.runner), Triage.fromTriager(parts.triager), Renderer.fromBrowser(browsers), Recordings.fromBrowser(browsers), QaChat.fromChatter(parts.qaChat));
  focus.agents = new AgentManager(store, hub, crew, (id) => focus.boardChanged(id), version);
  focus.ownRepo = await parts.ownRepo();
  parts.readTranscripts(focus.agents);
  await startPlugins(focus, store, parts.demoRunner, shipStatus);
  // turns Focus stopped part way through carry on, from each agent's run journal
  focus.agents.recover();
  parts.seed(store, focus.agents);

  const { app, refuse } = httpApp(focus, store, previews);
  const server = http.createServer(app);
  hub.attach(server, () => focus.snapshot(), refuse);
  await serveClient(app, server);
  server.listen(config.port, config.host, () => {
    const lines = openLines({ host: config.host, port: config.port, demo: config.demo, keyMode: keyFallback.mode, budgetUsd: keyFallback.budgetUsd, apiKeySet: Boolean(process.env.ANTHROPIC_API_KEY) });
    for (const line of lines) console.log(line);
  });

  await focus.start();
  const restart = shutDownOnSignals(focus, store, browsers, previews);
  await parts.afterStart(focus, store, hub, restart);
}

/**
 * Plugins read the agents' transcripts as Ops does; in the demo, its pretend leads keep transcripts of their own, and
 * its older sessions are the scripted ones.
 */
async function startPlugins(focus: Focus, store: Store, demoRunner: DemoRunner | undefined, shipStatus: () => Promise<ShipStatus>): Promise<void> {
  const choice = pluginChoice(config.pluginsEnv, config.demo, store.settings.plugins);
  const plugins = await loadPlugins(choice.names, config.root);
  focus.startPlugins(plugins, {
    transcript: demoRunner && (async (id) => demoRunner.transcript(id) ?? (await demoTranscripts()).find((t) => t.sessionId === id)?.read()),
    shipStatus,
  }, {
    pinnedBy: choice.pinnedBy,
    startedWith: plugins.map((p) => p.id),
    available: await pluginCatalog(config.root),
    // the supervisor's ipc channel carries the restart request
    canRestart: typeof process.send === 'function',
  });
}

/** The demo's ship, the first time it starts: two projects, each with what a project can do switched on, and two goals under way. */
function seedDemoShip(store: Store, agents: AgentManager): void {
  if (store.projects.length > 0) return;
  const shop = store.addProject('Sock Shop', '#ff8a5b', 'beach');
  shop.repos = ['demo/webshop-frontend', 'demo/webshop-api'];
  shop.maxAgents = 2;
  const game = store.addProject('Space Dodger', '#5bc0eb', 'moon');
  game.repos = ['demo/space-dodger'];
  // so the demo shows a PR going QA pass → checks green → merged by itself
  game.autoMerge = true;
  // and every PR going to QA by itself, and one QA fails going back to be fixed, which a new project leaves to the captain
  for (const p of [shop, game]) Object.assign(p, { autoQa: true, autoSendBack: true });
  // and what each plugin that works per project does, in both: switched on for them all (the others don't look)
  for (const p of [shop, game]) p.plugins = agents.plugins.ids();
  // the demo keeps no ledger: a few days of one, to review at the master systems table
  store.ledger = demoLedger(shop.id, game.id, Date.now());
  // two goals under way side by side, each with its own lead at its own team station
  agents.startGoal(shop.id, 'Shoppers can save items for later and find them again on any device');
  agents.startGoal(shop.id, 'Show how many of each sock are left in stock on the product page', { station: 2 });
}

/** The API, behind the host guard, and in the demo the routes that pretend what GitHub and its previews would do. */
function httpApp(focus: Focus, store: Store, previews: Previews): { app: express.Express; refuse: (req: http.IncomingMessage) => string | undefined } {
  const app = express();
  // Focus has no login: it only answers the captain's own browser (server/hostGuardRules.ts)
  const addresses = Object.values(os.networkInterfaces()).flatMap((list) => (list ?? []).map((i) => i.address));
  const hosts = allowedHosts(config.host, process.env.FOCUS_ALLOWED_HOSTS ?? '', { hostname: os.hostname(), addresses });
  const hostRefusal = (req: http.IncomingMessage) => refusal({ host: req.headers.host, origin: req.headers.origin }, hosts);
  // and a tagged tailnet device (Grok Bot's box) only reaches the bot's routes
  const logins = allowedLogins(process.env.FOCUS_ALLOWED_LOGINS ?? '');
  const deviceRefusal = (req: http.IncomingMessage) => tailnetRefusal(caller(req), logins);
  const refuse = (req: http.IncomingMessage) => hostRefusal(req) ?? deviceRefusal(req);
  app.use((req, res, next) => {
    const byHost = hostRefusal(req);
    const why = byHost ?? deviceRefusal(req);
    if (!why) return next();
    console.warn(`Refused ${req.method} ${req.originalUrl}: ${why}`);
    res.status(403).type('text').send(byHost ? `${why}. Add it to FOCUS_ALLOWED_HOSTS if it's yours.` : `${why}.`);
  });
  // recording a run's flows (`pnpm run flows`): each /api request, against the browser's file that made it
  const recorder = flowRecorder;
  if (recorder) {
    app.use(recorder.http);
    app.get('/api/flows', (_req, res) => res.json(recorder.recording(process.env.FOCUS_FLOWS ?? '')));
  }
  if (config.demo) demoRoutes(app, focus, store, previews);
  app.use('/api', apiRouter(focus, store));
  // the Tricorder's page lives in a folder (client/tricorder/index.html), and its relative URLs need the slash
  app.get('/tricorder', (req, res, next) => (req.path.endsWith('/') ? next() : res.redirect(req.originalUrl.replace('/tricorder', '/tricorder/'))));
  return { app, refuse };
}
/** What `tailnetRefusal` reads of a request: Tailscale Serve's headers, the peer's address, the host and the URL. */
function caller(req: http.IncomingMessage): Caller {
  const one = (name: string) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value.join(',') : value;
  };
  return {
    login: one('tailscale-user-login'),
    forwardedFor: one('x-forwarded-for'),
    funnel: one('tailscale-funnel-request'),
    remoteAddress: req.socket.remoteAddress,
    host: req.headers.host,
    url: req.url,
  };
}
/** The demo's own routes: its pace, its previews' pages, and pretend pushes to its PRs. */
function demoRoutes(app: express.Express, focus: Focus, store: Store, previews: Previews): void {
  // the demo's pace, which the captain steps slower or faster as they watch (shared/demoPace.ts): every tab hears it
  app.post('/api/demo/speed', express.json(), (req, res) => {
    const speed = setDemoPace(clampSpeed((req.body as { speed?: unknown } | undefined)?.speed));
    focus.infoChanged();
    res.json({ speed });
  });
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
    const pr = pushedPr(store.projects, store.boards, repo, number);
    if (!pr || !demoPush) return void res.status(404).json({ error: `${repo}#${number} is not an open pull request on a board` });
    const head = demoPush(repo, number, pushKind(req.query.kind));
    void focus.refreshBoard(pr.projectId).then(() => focus.agents.requestReview(pr.projectId, repo, number, pr.title)).catch((err: unknown) => console.warn(`Demo push to ${repo}#${number}: ${String(err)}`));
    res.json({ head });
  });
}

/** The client: through Vite, as it changes, in development, or else the build in dist/, which has to be there. */
async function serveClient(app: express.Express, server: http.Server): Promise<void> {
  if (config.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(config.root, 'vite.config.ts'),
      // .ts.net: the phone reaches Focus through Tailscale Serve
      server: { middlewareMode: true, hmr: { server }, allowedHosts: ['.ts.net'] },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    return;
  }
  const dist = path.join(config.root, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('No client build found. Run "pnpm run build" first, or use "pnpm run dev".');
    process.exit(1);
  }
  app.use(express.static(dist));
  app.get('/{*any}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

/** A live ship, once it's open: its orphaned workspaces swept up, who GitHub says it is, and Focus kept up to date. */
async function liveChores(focus: Focus, store: Store, hub: Hub, restart: () => Promise<void>): Promise<void> {
  const sweep = () =>
    git
      .sweepWorkspaces(store.agents.keys(), store.projects.map((p) => p.id))
      .catch((err: unknown) => console.error(`Workspace sweep failed: ${errorMessage(err)}`));
  void sweep();
  setInterval(() => void sweep(), SWEEP_EVERY_MS);
  const info = await focus.checkGitHub();
  if (!info.github.ok) console.warn(`  ⚠ ${info.github.error}`);
  else console.log(`  GitHub: signed in as ${info.github.login}`);
  await new Updater(store, hub, restart).start();
}

/** Shuts Focus down on SIGINT or SIGTERM, once; returns the restart Focus asks the supervisor for. */
function shutDownOnSignals(focus: Focus, store: Store, browsers: BrowserPool, previews: Previews): () => Promise<void> {
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    console.log('\nShutting Focus down…');
    // their sessions stop, and the turns they were in carry on when Focus starts again
    focus.agents.shutDown();
    store.save();
    // Kokoro's process goes by SIGKILL (see server/speech.ts): with onnxruntime out of this process, exiting can't abort
    focus.voice.close();
    await Promise.all([browsers.shutdown(), previews.shutdown()]);
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  const restart = () => {
    process.send?.(RESTART_MESSAGE);
    return shutdown();
  };
  focus.restart = restart;
  return restart;
}

main().catch((err: unknown) => {
  // another running Focus on the same data folder is expected, and a crew file that's wrong says where: no stack trace to bury either
  if (err instanceof StateLockedError || err instanceof CrewFileError) console.error(err.message);
  else console.error(err);
  process.exit(1);
});
