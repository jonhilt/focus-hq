import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import express from 'express';
import { clock } from '../shared/clock';
import { keyFallback } from './agents/apiKey';
import { BrowserPool } from './agents/browserTool';
import { ClaudeDrafter, ClaudeQaChat, ClaudeTriager, titleGoal } from './agents/claudeCrew';
import { DemoQaChat } from './agents/demoQaChat';
import { githubRepo } from './github/repo';
import { transcriptFolders, transcriptReader } from './agents/transcript';
import { ClaudeRunner } from './agents/claudeRunner';
import { DemoDrafter, DemoRunner, DemoTriager, demoTranscripts, demoWorkspace } from './agents/demoRunner';
import { AgentManager } from './agents/manager';
import { QaChat, Renderer, Sessions, Triage, Workspace } from './agents/services';
import { closedGoalPrs, lookUpPrStates, type ShipStatus, summariseShip } from './agents/shipStatus';
import { IssuePlanner } from './agents/planner';
import * as git from './agents/workspace';
import { demoLedger } from './demoLedger';
import { config, paths } from './config';
import { demoLayer, demoPush } from './github/demo';
import { clampSpeed } from '../shared/demoPace';
import { setDemoPace } from './demoPace';
import { ghCliLayer } from './github/ghCli';
import { GitHub, toProvider } from './github/service';
import { allowedHosts, listensBeyondLoopback, refusal } from './hostGuard';
import { Hub } from './hub';
import { flowRecorder } from './flows';
import { loadPlugins } from './plugins/load';
import { Focus } from './focus';
import { PreviewMirrors } from './previewMirrors';
import { demoPreviewPage, Previews } from './previews';
import { apiRouter } from './routes';
import { StateLockedError, Store } from './store';
import { currentVersion, RESTART_MESSAGE, Updater } from './updater';
import { errorMessage, run, seedShip } from './util';
import { Voice } from './voice';

/** How often orphaned agent workspaces are swept up, besides once at startup. */
const SWEEP_EVERY_MS = 60 * 60_000;

async function main() {
  // the demo rolls the same ids each run
  seedShip(config);
  const store = new Store(!config.demo);
  store.load();

  const hub = new Hub();
  keyFallback.onChange = (onKey, spell) => {
    // Focus is up by the time a session runs into the plan's limit
    focus.agents.plugins.signInChanged(keyFallback.signIn());
    if (onKey) hub.toast('info', `🔑 Your plan's usage limit is reached until ${clock(spell.until)}: agents carry on with your API key (up to $${keyFallback.budgetUsd})`);
    else if (spell.until > Date.now()) hub.toast('error', `🔑 Your API key has spent its $${keyFallback.budgetUsd}: agents wait for your plan's usage limit to reset at ${clock(spell.until)}`);
    else hub.toast('success', `🔑 Your plan's usage limit has reset: agents are back on it (the key spent about $${spell.spentUsd.toFixed(2)})`);
  };
  // one GitHub for the whole ship (the demo's lives in memory), as an Effect service and through the Promise adapter
  const gitHub = Layer.succeed(GitHub, await ManagedRuntime.make(config.demo ? demoLayer : ghCliLayer).runPromise(GitHub.use(Effect.succeed)));
  const github = toProvider(gitHub);
  const browsers = new BrowserPool();
  const demoRunner = config.demo ? new DemoRunner() : undefined;
  const runner = demoRunner ?? new ClaudeRunner(browsers);
  const previews = new Previews(hub, github, config.demo, undefined, config.demo ? undefined : new PreviewMirrors());
  const planner = new IssuePlanner(store, hub, config.demo ? new DemoDrafter() : new ClaudeDrafter());
  const workspace = config.demo ? demoWorkspace : git.liveWorkspace;
  // plugins read the ship through `focus`, which is up by the time anyone asks
  const shipStatus = async (): Promise<ShipStatus> => {
    const snapshot = await focus.snapshot();
    // closed goals' PRs, looked up live on every call: one that fails falls back to what was recorded
    const prStates = await lookUpPrStates(closedGoalPrs(snapshot), (repo, number) => github.pullRequestState(repo, number));
    return summariseShip(snapshot, (id) => workspace.dir(id), prStates);
  };
  const focus = new Focus(store, hub, github, previews, planner, new Voice(hub, config.demo), await currentVersion());
  focus.voice.warmSpeech();
  const crew = Layer.mergeAll(gitHub, Workspace.fromOps(workspace), Sessions.fromRunner(runner), Triage.fromTriager(config.demo ? new DemoTriager() : new ClaudeTriager()), Renderer.fromBrowser(browsers), QaChat.fromChatter(config.demo ? new DemoQaChat() : new ClaudeQaChat()));
  focus.agents = new AgentManager(store, hub, crew, (id) => focus.boardChanged(id));
  // Focus's own repo, for plugins that work on it (the demo has none)
  focus.ownRepo = config.demo ? undefined : githubRepo(await run('git', ['remote', 'get-url', 'origin'], { cwd: config.root }).catch(() => ''));
  // each agent session is digested into the ledger as it ends: the demo's agents have no transcripts
  // the demo's older sessions are its scripted ones, digested without Haiku
  if (config.demo) {
    focus.agents.transcripts = demoTranscripts;
  } else {
    focus.agents.readTranscript = transcriptReader(paths.transcripts, paths.workspaces);
    focus.agents.titleGoal = (brief) => titleGoal(brief, store.settings);
    focus.agents.transcripts = transcriptFolders(paths.transcripts, paths.workspaces);
    // the captain's replies to leads, from the spans digested before they were kept, while their transcripts last
    void focus.agents.backfillReplies().catch((err: unknown) => console.warn(`Couldn't keep the captain's older replies: ${errorMessage(err)}`));
  }
  // plugins read the agents' transcripts as Ops does; in the demo, its pretend leads keep transcripts of their
  // own, and its older sessions are the scripted ones
  focus.startPlugins(await loadPlugins(config.plugins, config.root), {
    transcript: demoRunner && (async (id) => demoRunner.transcript(id) ?? (await demoTranscripts()).find((t) => t.sessionId === id)?.read()),
    shipStatus,
  });
  // turns Focus stopped part way through carry on, from each agent's run journal
  focus.agents.recover();

  if (config.demo && store.projects.length === 0) {
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
    for (const p of [shop, game]) p.plugins = focus.agents.plugins.ids();
    // the demo keeps no ledger: a few days of one, to review at the master systems table
    store.ledger = demoLedger(shop.id, game.id, Date.now());
    // two goals under way side by side, each with its own lead at its own team station
    focus.agents.startGoal(shop.id, 'Shoppers can save items for later and find them again on any device');
    focus.agents.startGoal(shop.id, 'Show how many of each sock are left in stock on the product page', { station: 2 });
  }

  const app = express();
  // Focus has no login: it only answers the captain's own browser (server/hostGuard.ts)
  const hosts = allowedHosts(config.host, process.env.FOCUS_ALLOWED_HOSTS);
  const refuse = (req: http.IncomingMessage) => refusal({ host: req.headers.host, origin: req.headers.origin }, hosts);
  app.use((req, res, next) => {
    const why = refuse(req);
    if (!why) return next();
    console.warn(`Refused ${req.method} ${req.originalUrl}: ${why}`);
    res.status(403).type('text').send(`${why}. Add it to FOCUS_ALLOWED_HOSTS if it's yours.`);
  });
  // recording a run's flows (`pnpm run flows`): each /api request, against the browser's file that made it
  const recorder = flowRecorder;
  if (recorder) {
    app.use(recorder.http);
    app.get('/api/flows', (_req, res) => res.json(recorder.recording(process.env.FOCUS_FLOWS ?? '')));
  }
  // the demo's pace, which the captain steps slower or faster as they watch (shared/demoPace.ts): every tab hears it
  if (config.demo)
    app.post('/api/demo/speed', express.json(), (req, res) => {
      const speed = setDemoPace(clampSpeed((req.body as { speed?: unknown } | undefined)?.speed));
      focus.infoChanged();
      res.json({ speed });
    });
  app.use('/api', apiRouter(focus, store));
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
      void focus.refreshBoard(project.id).then(() => focus.agents.requestReview(project.id, repo, number, pr.title)).catch((err: unknown) => console.warn(`Demo push to ${repo}#${number}: ${String(err)}`));
      res.json({ head });
    });
  }
  // the Tricorder's page lives in a folder (client/tricorder/index.html), and its relative URLs need the slash
  app.get('/tricorder', (req, res, next) => (req.path.endsWith('/') ? next() : res.redirect(req.originalUrl.replace('/tricorder', '/tricorder/'))));
  const server = http.createServer(app);
  hub.attach(server, () => focus.snapshot(), refuse);

  if (config.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(config.root, 'vite.config.ts'),
      // .ts.net: the phone reaches Focus through Tailscale Serve
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
    console.log(`\n  🖖  Focus is open: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`      mode: ${config.demo ? 'demo (fake GitHub, pretend agents)' : 'live (gh CLI + Claude Agent SDK)'}`);
    if (!config.demo && keyFallback.mode === 'fallback') {
      console.log(`      agents use your Claude login, and ANTHROPIC_API_KEY while your plan's usage limit is reached (up to $${keyFallback.budgetUsd} each time).`);
    } else if (!config.demo && process.env.ANTHROPIC_API_KEY && keyFallback.mode === 'login') {
      console.log('      note: ANTHROPIC_API_KEY is set but agents ignore it and use your Claude login (set FOCUS_USE_API_KEY=1 to use the key, or =fallback to use it when your plan runs out).');
    }
    if (listensBeyondLoopback(config.host)) {
      console.log(`      ⚠ HOST=${config.host}: anyone who can reach this port can drive your agents, which act with your GitHub and Claude logins.`);
    }
    console.log('');
  });

  await focus.start();
  if (!config.demo) {
    const sweep = () =>
      git
        .sweepWorkspaces(store.agents.keys(), store.projects.map((p) => p.id))
        .catch((err: unknown) => console.error(`Workspace sweep failed: ${errorMessage(err)}`));
    void sweep();
    setInterval(() => void sweep(), SWEEP_EVERY_MS);
    const info = await focus.checkGitHub();
    if (!info.github.ok) console.warn(`  ⚠ ${info.github.error}`);
    else console.log(`  GitHub: signed in as ${info.github.login}`);
  }

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
  if (config.autoUpdate) await new Updater(store, hub, restart).start();
}

main().catch((err: unknown) => {
  // another running Focus on the same data folder is expected, and its message says what to do: no stack trace to bury it
  if (err instanceof StateLockedError) console.error(err.message);
  else console.error(err);
  process.exit(1);
});
