import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { BrowserPool } from './agents/browserTool';
import { Briefings, type IssueFiler } from './agents/briefing';
import { ClaudeBriefingQa, ClaudeDrafter, ClaudeOfficer } from './agents/claudeCrew';
import { ClaudeRunner } from './agents/claudeRunner';
import { DemoBriefingQa, DemoDrafter, DemoOfficer, DemoRunner, demoWorkspace } from './agents/demoRunner';
import { AgentManager } from './agents/manager';
import { IssuePlanner } from './agents/planner';
import type { WorkspaceOps } from './agents/types';
import * as git from './agents/workspace';
import { config } from './config';
import { demoLayer } from './github/demo';
import { ghCliLayer } from './github/ghCli';
import { toProvider } from './github/service';
import { Hub } from './hub';
import { Office } from './office';
import { demoPreviewPage, Previews } from './previews';
import { apiRouter } from './routes';
import { Store } from './store';
import { currentVersion, RESTART_EXIT_CODE, Updater } from './updater';
import { Voice } from './voice';

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
  const github = toProvider(config.demo ? demoLayer : ghCliLayer);
  const browsers = new BrowserPool();
  const runner = config.demo ? new DemoRunner() : new ClaudeRunner(browsers);
  const previews = new Previews(hub, github, config.demo);
  const planner = new IssuePlanner(store, hub, config.demo ? new DemoDrafter() : new ClaudeDrafter());
  // a briefing only files once the office is up
  const filer: IssueFiler = {
    file: (projectId, repo, title, body) => office.fileIssue(projectId, repo, title, body),
    addSubIssue: (repo, parent, child) => github.addSubIssue(repo, parent, child),
  };
  const briefings = new Briefings(store, hub, planner, config.demo ? new DemoOfficer() : new ClaudeOfficer(), config.demo ? new DemoBriefingQa() : new ClaudeBriefingQa(), filer);
  const office = new Office(store, hub, github, previews, planner, briefings, new Voice(hub, config.demo), await currentVersion());
  office.agents = new AgentManager(store, hub, github, runner, config.demo ? demoWorkspace : liveWorkspace, (id) => office.boardChanged(id));

  if (config.demo && store.projects.length === 0) {
    const shop = store.addProject('Sock Shop', '#ff8a5b', 'beach');
    shop.repos = ['demo/webshop-frontend', 'demo/webshop-api'];
    shop.maxAgents = 4;
    const game = store.addProject('Space Dodger', '#5bc0eb', 'moon');
    game.repos = ['demo/space-dodger'];
    // so the demo shows a PR going QA pass → checks green → merged by itself
    game.autoMerge = true;
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
    const info = await office.checkGitHub();
    if (!info.github.ok) console.warn(`  ⚠ ${info.github.error}`);
    else console.log(`  GitHub: signed in as ${info.github.login}`);
  }

  let closing = false;
  const shutdown = async (exitCode = 0) => {
    if (closing) return;
    closing = true;
    console.log('\nClosing the office…');
    for (const agent of store.agents.values()) office.agents.stop(agent.id);
    store.save();
    await Promise.all([browsers.shutdown(), previews.shutdown()]);
    setTimeout(() => process.exit(exitCode), 300);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  if (config.autoUpdate) await new Updater(store, hub, () => shutdown(RESTART_EXIT_CODE)).start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
