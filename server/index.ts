import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import express from 'express';
import { BrowserPool } from './agents/browserTool';
import { ClaudeDrafter, ClaudeNumberOne, ClaudeTriager } from './agents/claudeCrew';
import { ClaudeRunner } from './agents/claudeRunner';
import { DemoDrafter, DemoNumberOne, DemoRunner, DemoTriager, demoWorkspace } from './agents/demoRunner';
import { AgentManager } from './agents/manager';
import { Sessions, Triage, Workspace } from './agents/services';
import { NumberOne, type ShipStatus, summariseShip } from './agents/numberOne';
import { IssuePlanner } from './agents/planner';
import type { WorkspaceOps } from './agents/types';
import * as git from './agents/workspace';
import { config } from './config';
import { demoLayer } from './github/demo';
import { ghCliLayer } from './github/ghCli';
import { GitHub, toProvider } from './github/service';
import { Hub } from './hub';
import { Office } from './office';
import { demoPreviewPage, Previews } from './previews';
import { apiRouter } from './routes';
import { Store } from './store';
import { currentVersion, RESTART_MESSAGE, Updater } from './updater';
import { errorMessage } from './util';
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
  push: git.pushBranch,
  publish: git.publishBranch,
  pull: git.pullBranch,
  checkoutPullRequest: git.checkoutPullRequest,
};

async function main() {
  const store = new Store(!config.demo);
  store.load();

  const hub = new Hub();
  // one GitHub for the whole office (the demo's lives in memory), as an Effect service and through the Promise adapter
  const gitHub = Layer.succeed(GitHub, await ManagedRuntime.make(config.demo ? demoLayer : ghCliLayer).runPromise(GitHub.use(Effect.succeed)));
  const github = toProvider(gitHub);
  const browsers = new BrowserPool();
  const runner = config.demo ? new DemoRunner() : new ClaudeRunner(browsers);
  const previews = new Previews(hub, github, config.demo);
  const planner = new IssuePlanner(store, hub, config.demo ? new DemoDrafter() : new ClaudeDrafter());
  const workspace = config.demo ? demoWorkspace : liveWorkspace;
  // Number One reads the ship through the office, which is up by the time anyone asks
  const numberOne = new NumberOne(store, hub, config.demo ? new DemoNumberOne() : new ClaudeNumberOne(), async (): Promise<ShipStatus> => summariseShip(await office.snapshot(), (id) => workspace.dir(id)));
  const office = new Office(store, hub, github, previews, planner, numberOne, new Voice(hub, config.demo), await currentVersion());
  const crew = Layer.mergeAll(gitHub, Workspace.fromOps(workspace), Sessions.fromRunner(runner), Triage.fromTriager(config.demo ? new DemoTriager() : new ClaudeTriager()));
  office.agents = new AgentManager(store, hub, crew, (id) => office.boardChanged(id));

  if (config.demo && store.projects.length === 0) {
    const shop = store.addProject('Sock Shop', '#ff8a5b', 'beach');
    shop.repos = ['demo/webshop-frontend', 'demo/webshop-api'];
    shop.maxAgents = 4;
    const game = store.addProject('Space Dodger', '#5bc0eb', 'moon');
    game.repos = ['demo/space-dodger'];
    // so the demo shows a PR going QA pass → checks green → merged by itself
    game.autoMerge = true;
    // two goals under way side by side, each with its own lead at its own team station
    office.agents.startGoal(shop.id, 'Shoppers can save items for later and find them again on any device');
    office.agents.startGoal(shop.id, 'Show how many of each sock are left in stock on the product page', { station: 2 });
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
  }
  // the Tricorder's page lives in a folder (client/tricorder/index.html), and its relative URLs need the slash
  app.get('/tricorder', (req, res, next) => (req.path.endsWith('/') ? next() : res.redirect(req.originalUrl.replace('/tricorder', '/tricorder/'))));
  const server = http.createServer(app);
  hub.attach(server, () => office.snapshot());

  if (config.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(config.root, 'vite.config.ts'),
      // .ts.net: the phone reaches the office through Tailscale Serve (see "On your phone" in the README)
      server: { middlewareMode: true, hmr: { server }, allowedHosts: ['.ts.net'] },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(config.root, 'dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      console.error('No client build found. Run "npm run build" first, or use "npm run dev".');
      process.exit(1);
    }
    app.use(express.static(dist));
    app.get('/{*any}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  server.listen(config.port, config.host, () => {
    console.log(`\n  🏢  Focus office is open: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`      mode: ${config.demo ? 'demo (fake GitHub, pretend agents)' : 'live (gh CLI + Claude Agent SDK)'}`);
    if (!config.demo && process.env.ANTHROPIC_API_KEY && process.env.FOCUS_USE_API_KEY !== '1') {
      console.log('      note: ANTHROPIC_API_KEY is set but agents ignore it and use your Claude login (set FOCUS_USE_API_KEY=1 to use the key).');
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
