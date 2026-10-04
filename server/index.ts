import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { BrowserPool } from './agents/browserTool';
import { ClaudeRunner } from './agents/claudeRunner';
import { DemoRunner, demoWorkspace } from './agents/demoRunner';
import { AgentManager } from './agents/manager';
import type { WorkspaceOps } from './agents/types';
import * as git from './agents/workspace';
import { config } from './config';
import { DemoGitHub } from './github/demo';
import { GhCliProvider } from './github/ghCli';
import { Hub } from './hub';
import { Office } from './office';
import { apiRouter } from './routes';
import { Store } from './store';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const liveWorkspace: WorkspaceOps = {
  create: git.createWorktree,
  remove: git.removeWorktree,
  dir: git.workspaceDir,
  hasUncommittedChanges: git.hasUncommittedChanges,
  commitsAhead: git.commitsAhead,
  push: git.pushBranch,
};

async function main() {
  const store = new Store(!config.demo);
  store.load();

  const hub = new Hub();
  const github = config.demo ? new DemoGitHub() : new GhCliProvider();
  const browsers = new BrowserPool();
  const runner = config.demo ? new DemoRunner() : new ClaudeRunner(browsers);
  const office = new Office(store, hub, github);
  office.agents = new AgentManager(store, hub, github, runner, config.demo ? demoWorkspace : liveWorkspace, (id) => office.boardChanged(id));

  if (config.demo && store.projects.length === 0) {
    const shop = store.addProject('Sock Shop', '#ff8a5b', 'beach');
    shop.repos = ['demo/webshop-frontend', 'demo/webshop-api'];
    shop.maxAgents = 4;
    const game = store.addProject('Space Dodger', '#5bc0eb', 'moon');
    game.repos = ['demo/space-dodger'];
  }

  const app = express();
  app.use('/api', apiRouter(office, store));
  const server = http.createServer(app);
  hub.attach(server, () => office.snapshot());

  if (config.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(root, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(root, 'dist');
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

  const shutdown = async () => {
    console.log('\nClosing the office…');
    for (const agent of store.agents.values()) office.agents.stop(agent.id);
    store.save();
    await browsers.shutdown();
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
