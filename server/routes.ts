import express, { type NextFunction, type Request, type Response } from 'express';
import type { Office } from './office';
import type { Store } from './store';
import { errorMessage } from './util';

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;

/** Wraps a handler so thrown errors become `{ error }` JSON with a 400. */
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await fn(req, res);
    if (!res.headersSent) res.json(result ?? { ok: true });
  } catch (err) {
    if (res.headersSent) return next(err);
    res.status(400).json({ error: errorMessage(err) });
  }
};

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const param = (req: Request, name: string) => str(req.params[name]);

export function apiRouter(office: Office, store: Store): express.Router {
  const r = express.Router();
  r.use(express.json({ limit: '2mb' }));

  r.get('/state', h(() => office.snapshot()));
  r.post('/github/check', h(() => office.checkGitHub()));
  r.get('/github/repos', h(() => office.listRepos()));
  r.patch('/settings', h((req) => office.updateSettings(req.body ?? {})));

  // projects (rooms)
  r.post('/projects', h((req) => office.createProject(str(req.body.name), req.body.color, Array.isArray(req.body.repos) ? req.body.repos : [], req.body.theme)));
  r.patch('/projects/:id', h((req) => office.updateProject(param(req, 'id'), req.body ?? {})));
  r.delete('/projects/:id', h((req) => office.deleteProject(param(req, 'id'))));
  r.post('/projects/:id/repos', h((req) => office.connectRepo(param(req, 'id'), str(req.body.repo))));
  r.delete('/projects/:id/repos', h((req) => office.disconnectRepo(param(req, 'id'), str(req.query.repo))));
  r.post('/projects/:id/refresh', h(async (req) => {
    await office.refreshBoard(param(req, 'id'));
    return store.boards.get(param(req, 'id'));
  }));

  // blank repositories
  r.post('/repos', h((req) =>
    office.createRepo(
      str(req.body.name),
      { owner: str(req.body.owner) || undefined, private: req.body.private !== false, description: str(req.body.description) },
      str(req.body.projectId) || undefined,
    ).then((repo) => ({ repo })),
  ));

  // issues and pull requests
  r.post('/issues', h((req) =>
    office.createIssue(
      str(req.body.projectId),
      str(req.body.repo),
      str(req.body.title),
      str(req.body.body),
      Array.isArray(req.body.labels) ? req.body.labels.filter((l: unknown) => typeof l === 'string' && l.trim()) : [],
      req.body.assign === true,
    ),
  ));
  r.post('/prs/resolve-conflicts', h((req) => office.resolveConflicts(str(req.body.projectId), str(req.body.repo), Number(req.body.number))));
  r.post('/prs/merge', h((req) => office.mergePullRequest(str(req.body.projectId), str(req.body.repo), Number(req.body.number))));

  // agents
  r.post('/agents', h((req) =>
    office.agents.hire(str(req.body.projectId), str(req.body.repo), {
      number: Number(req.body.number),
      title: str(req.body.title) || undefined,
      url: str(req.body.url) || undefined,
    }),
  ));
  r.get('/agents/:id/lines', h((req) => store.allLines(param(req, 'id'))));
  r.post('/agents/:id/message', h((req) => office.agents.message(param(req, 'id'), str(req.body.text))));
  r.post('/agents/:id/permission', h((req) => office.agents.resolvePermission(param(req, 'id'), str(req.body.requestId), req.body.allow === true)));
  r.post('/agents/:id/stop', h((req) => office.agents.stop(param(req, 'id'))));
  r.delete('/agents/:id', h((req) => office.agents.dismiss(param(req, 'id'))));

  r.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return r;
}
