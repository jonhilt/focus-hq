import express, { type NextFunction, type Request, type Response } from 'express';
import { type BreakdownEdits, EFFORT_LEVELS, type Effort, type PreviewSet } from '../shared/types';
import { isKokoroVoice } from '../shared/voice';
import type { Office } from './office';
import type { Store } from './store';
import { errorMessage } from './util';

type Handler = (req: Request, res: Response) => unknown;

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
/** Missing or empty = the model's default effort. */
/** A preview's per-repo choices: { "owner/name": 12 } for a PR, null for the default branch. Anything else is dropped. */
const picks = (v: unknown): PreviewSet | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, number | null] => e[1] === null || Number.isInteger(e[1])));
};
const effort = (v: unknown): Effort | undefined => {
  if (v === undefined || v === '') return undefined;
  const level = EFFORT_LEVELS.find((e) => e === v);
  if (!level) throw new Error(`Effort must be one of ${EFFORT_LEVELS.join(', ')}`);
  return level;
};

/** A breakdown as the manager edited it; any other shape is a bad request. */
const breakdownEdits = (v: unknown): BreakdownEdits => {
  const issue = (i: unknown) => ({ title: str((i as Record<string, unknown> | null)?.title), body: str((i as Record<string, unknown> | null)?.body) });
  const raw = (v ?? {}) as Record<string, unknown>;
  if (!Array.isArray(raw.subIssues)) throw new Error('Send the breakdown’s sub-issues');
  return { epic: issue(raw.epic), subIssues: (raw.subIssues as unknown[]).map((s) => ({ key: str((s as Record<string, unknown> | null)?.key), ...issue(s) })) };
};

export function apiRouter(office: Office, store: Store): express.Router {
  const r = express.Router();
  r.use(express.json({ limit: '2mb' }));

  r.get('/state', h(() => office.snapshot()));
  r.get('/qa-shots/:file', async (req, res) => {
    const file = param(req, 'file');
    const bytes = /^[\w-]+\.(jpg|png|svg)$/.test(file) ? await store.readShot(file) : undefined;
    if (!bytes) return void res.sendStatus(404);
    res.type(file.split('.').pop()!).set('Cache-Control', 'max-age=31536000, immutable').send(bytes);
  });
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
      req.body.assign === true ? { effort: effort(req.body.effort), cloud: req.body.cloud === true } : undefined,
      req.body.fromDraft === true,
    ),
  ));

  // the planner at each room's ＋ New issue stand: rough idea in, issue draft out (over the websocket)
  r.post('/projects/:id/draft', h((req) => {
    const revise = req.body.revise;
    return office.planner.start(
      param(req, 'id'),
      str(req.body.idea),
      revise && typeof revise === 'object'
        ? { repo: str(revise.repo), title: str(revise.title), body: str(revise.body), notes: str(revise.notes) }
        : undefined,
    );
  }));
  r.delete('/projects/:id/draft', h((req) => office.planner.discard(param(req, 'id'))));

  // briefings in the observation lounge: one at a time, ending in an issue draft at the project's stand or a filed breakdown;
  // a goal instead goes one step at a time, parked out of the lounge between steps
  r.post('/briefing', h((req) => office.briefings.call(str(req.body.projectId), str(req.body.idea), req.body.goal === true)));
  r.post('/briefing/say', h((req) => office.briefings.say(str(req.body.text))));
  r.post('/briefing/wrap-up', h((req) => office.briefings.wrapUp(req.body.shape === 'breakdown' || req.body.shape === 'step' ? req.body.shape : 'one')));
  r.post('/briefing/step', h((req) => office.briefings.fileStep({ title: str(req.body.title), body: str(req.body.body) })));
  r.post('/briefing/park', h(() => office.briefings.park()));
  r.post('/goals/:id/reconvene', h((req) => office.briefings.reconvene(param(req, 'id'))));
  r.delete('/goals/:id', h((req) => office.briefings.dropGoal(param(req, 'id'))));
  r.post('/briefing/file', h((req) => office.briefings.file(breakdownEdits(req.body))));
  r.post('/briefing/engineering', h((req) => office.briefings.askEngineering(str(req.body.text))));
  r.post('/briefing/approach', h((req) => office.briefings.pickApproach(Number(req.body.option))));
  r.delete('/briefing', h(() => office.briefings.end()));
  r.post('/prs/qa', h((req) => office.requestReview(str(req.body.projectId), str(req.body.repo), Number(req.body.number))));
  r.post('/prs/resolve-conflicts', h((req) => office.resolveConflicts(str(req.body.projectId), str(req.body.repo), Number(req.body.number))));
  r.post('/prs/merge', h((req) => office.mergePullRequest(str(req.body.projectId), str(req.body.repo), Number(req.body.number))));

  // previews: a PR running on this machine, one per project
  r.post('/previews', h((req) => office.startPreview(str(req.body.projectId), str(req.body.repo), Number(req.body.number), picks(req.body.with))));
  r.delete('/previews/:projectId', h((req) => office.previews.stop(param(req, 'projectId'))));
  r.get('/previews/:projectId/log', h((req) => office.previews.log(param(req, 'projectId'))));
  r.get('/previews/:projectId/logs', h((req) => office.previews.logFiles(param(req, 'projectId'))));
  r.get('/previews/:projectId/logs/:name', h((req) => office.previews.logFile(param(req, 'projectId'), param(req, 'name'))));

  // agents
  r.post('/agents', h((req) =>
    office.agents.hire(str(req.body.projectId), str(req.body.repo), {
      number: Number(req.body.number),
      title: str(req.body.title) || undefined,
      url: str(req.body.url) || undefined,
    }, { effort: effort(req.body.effort), cloud: req.body.cloud === true }),
  ));
  r.get('/agents/:id/lines', h((req) => store.allLines(param(req, 'id'))));
  r.post('/agents/:id/message', h((req) => office.agents.message(param(req, 'id'), str(req.body.text))));
  r.post('/agents/:id/permission', h((req) => office.agents.resolvePermission(param(req, 'id'), str(req.body.requestId), req.body.allow === true)));
  r.post('/agents/:id/stop', h((req) => office.agents.stop(param(req, 'id'))));
  r.delete('/agents/:id', h((req) => office.agents.dismiss(param(req, 'id'))));

  // dictation: whisper.cpp on this machine turns the browser's 16 kHz WAV into text
  r.get('/voice/status', h(() => office.voice.refresh()));
  r.post('/voice/download-model', h(() => office.voice.startDownload()));
  r.post('/transcribe', express.raw({ type: 'audio/wav', limit: '25mb' }), h(async (req) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('Send the recording as an audio/wav body');
    return { text: await office.voice.transcribe(req.body) };
  }));
  // the crew's voices in briefings: Kokoro on this machine turns a line into a WAV
  r.post('/voice/speech/load', h(() => office.voice.loadSpeech()));
  r.post('/voice/speak', h(async (req, res) => {
    const text = str(req.body.text).trim();
    if (!text) throw new Error('Send the line to say');
    if (!isKokoroVoice(req.body.voice)) throw new Error('Unknown voice');
    res.type('audio/wav').send(await office.voice.speak(text.slice(0, 1000), req.body.voice));
  }));

  r.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return r;
}
