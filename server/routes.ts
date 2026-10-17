import express, { type NextFunction, type Request, type Response } from 'express';
import { isAutonomy } from '../shared/autonomy';
import { closedGoals } from '../shared/ledger';
import { ledgerWindow } from '../shared/ledgerReview';
import { isKokoroVoice } from '../shared/voice';
import { logFrom, personalMark } from '../shared/personalLog';
import { logSince } from '../shared/captainsLog';
import { captainsLog } from './agents/captainsLog';
import { replay } from './agents/runJournal';
import { artifactServing, briefingSpot, effort, picks, qaShotServing, resumeHow, str } from './apiRequests';
import { paths } from './config';
import { appendFrameStats } from './frameStats';
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

const param = (req: Request, name: string) => str(req.params[name]);

export function apiRouter(office: Office, store: Store): express.Router {
  const r = express.Router();
  r.use(express.json({ limit: '2mb' }));

  r.get('/state', h(() => office.snapshot()));
  // how the 3D view runs in a browser opened with ?stats=1, kept here so a run on another machine can be read where the office is
  r.post('/frame-stats', h((req) => appendFrameStats(paths.frameStats, req.body.session, req.body.lines)));
  r.get('/qa-shots/:file', async (req, res) => {
    const file = param(req, 'file');
    const serving = qaShotServing(file);
    const bytes = serving && (await store.readShot(file));
    if (!serving || !bytes) return void res.sendStatus(404);
    res.type(serving.type).set(serving.headers).send(bytes);
  });
  // what a goal's lead put on their station's screen, sandboxed in an origin of its own (artifactServing)
  r.get('/artifacts/:lead/:file', async (req, res) => {
    const lead = param(req, 'lead');
    const file = param(req, 'file');
    const serving = artifactServing(lead, file);
    const bytes = serving && (await store.readArtifact(lead, file));
    if (!serving || !bytes) return void res.sendStatus(404);
    res.type(serving.type).set(serving.headers).send(bytes);
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

  // the planner at each room's Ops station: rough idea in, issue draft out (over the websocket)
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

  // the studio holodeck's computer: one conversation, and the scenes it stages in the middle of the hall
  r.post('/studio/say', h((req) => office.studio.say(str(req.body.text))));
  r.post('/studio/new', h(() => office.studio.startOver()));
  r.post('/studio/tune', h((req) => office.studio.tune(typeof req.body.model === 'string' ? req.body.model : '', effort(req.body.effort))));
  r.get('/studio/source', h((req) => office.studio.source(str(req.query.file), Number(req.query.line))));
  r.post('/studio/takes/:id/recall', h((req) => office.studio.recall(param(req, 'id'))));
  r.post('/studio/takes/:id/report', h((req) => office.studio.report(param(req, 'id'), Number(req.body.version), typeof req.body.error === 'string' ? req.body.error : undefined, typeof req.body.sheet === 'string' ? req.body.sheet : undefined)));
  // every closed goal the ledger kept, so what its lead showed can be found once it's off the room's log
  r.get('/goals/archive', h((req) => closedGoals(store.ledger, typeof req.query.project === 'string' ? req.query.project : undefined)));
  // the captain's log: every journal and the ledger on one timeline, since `since` (the last day by default, a week at most)
  r.get('/log', h((req) => {
    const since = logSince(Date.now(), Number(req.query.since));
    return captainsLog(store.logSources(since), since);
  }));
  // the captain's personal log: what they jotted down to come back to (shared/personalLog.ts)
  r.get('/personal-log', h(() => store.personalEntries));
  r.post('/personal-log', h((req) => office.notePersonal(req.body.text, logFrom(req.body.from))));
  r.post('/personal-log/:id', h((req) => office.markPersonal(personalMark(param(req, 'id'), req.body))));
  r.get('/ledger', h((req) => ledgerWindow(store.ledger, Date.now(), Number(req.query.days ?? 14))));
  r.get('/digests/backfill', h(async () => ({ sessions: (await office.agents.undigested()).length })));
  r.post('/digests/backfill', h(() => office.agents.backfill()));
  r.post('/prs/qa', h((req) => office.requestReview(str(req.body.projectId), str(req.body.repo), Number(req.body.number))));
  r.post('/prs/resolve-conflicts', h((req) => office.resolveConflicts(str(req.body.projectId), str(req.body.repo), Number(req.body.number))));
  r.post('/prs/merge', h((req) => office.mergeFromBoard(str(req.body.projectId), str(req.body.repo), Number(req.body.number), req.body.override === true)));
  r.post('/prs/merge-when-passed', h((req) => office.mergeWhenPassed(str(req.body.projectId), str(req.body.repo), Number(req.body.number), req.body.on !== false)));

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
  // a goal: its own lead (the captain's own Claude Code session for it, across the project's repos) at a team station
  r.post('/projects/:id/goals', h((req) =>
    office.agents.startGoal(param(req, 'id'), str(req.body.text), {
      station: typeof req.body.station === 'number' ? req.body.station : undefined,
      effort: effort(req.body.effort),
      from: str(req.body.from) || undefined,
    }),
  ));
  // goals waiting for a free team station: started by the captain, never by themselves
  r.post('/projects/:id/goals/queue/:qid/start', h((req) =>
    office.agents.startQueued(param(req, 'id'), param(req, 'qid'), {
      text: str(req.body.text) || undefined,
      effort: effort(req.body.effort),
      station: typeof req.body.station === 'number' ? req.body.station : undefined,
    }),
  ));
  r.post('/projects/:id/goals/queue/:qid/move', h((req) => office.agents.moveQueued(param(req, 'id'), param(req, 'qid'), Math.sign(Number(req.body.by)) || 0)));
  // a closed goal from the room's log, back at a free team station on its branch and session
  r.post('/projects/:id/goals/:gid/reopen', h((req) =>
    office.agents.reopenGoal(param(req, 'id'), param(req, 'gid'), typeof req.body.station === 'number' ? req.body.station : undefined),
  ));
  r.delete('/projects/:id/goals/queue/:qid', h((req) => office.agents.dropQueued(param(req, 'id'), param(req, 'qid'))));
  r.get('/agents/:id/lines', h((req) => store.allLines(param(req, 'id'))));
  r.get('/agents/:id/run', h((req) => replay(store.journalEntries(param(req, 'id')))));
  r.get('/agents/:id/background/:task/output', h((req) => office.agents.backgroundOutput(param(req, 'id'), param(req, 'task'))));
  r.post('/agents/:id/background/:task/stop', h((req) => office.agents.stopBackground(param(req, 'id'), param(req, 'task'))));
  r.get('/agents/:id/workflows/:workflow/script', h((req) => office.agents.workflowScript(param(req, 'id'), param(req, 'workflow'))));
  r.get('/agents/:id/workflows/:workflow/agents/:agent/lines', h((req) => office.agents.workflowAgentLines(param(req, 'id'), param(req, 'workflow'), param(req, 'agent'))));
  // on your API key, picking a long conversation back up costs enough that the captain says how first (`how`)
  r.post('/agents/:id/message', h((req) => office.agents.message(param(req, 'id'), str(req.body.text), undefined, resumeHow(req.body.how))));
  // a question about a lead's briefing, up close: the lead answers it, or the quick answerer while they're busy
  r.post('/agents/:id/briefing-question', h((req) => office.briefings.ask(param(req, 'id'), {
    briefing: str(req.body.briefing),
    spot: briefingSpot(req.body.spot),
    question: str(req.body.question),
    how: resumeHow(req.body.how),
  })));
  r.post('/agents/:id/answer', h((req) => office.agents.answer(param(req, 'id'), str(req.body.question), str(req.body.option), typeof req.body.note === 'string' ? req.body.note : undefined, resumeHow(req.body.how))));
  r.post('/agents/:id/read', h((req) => office.agents.readTurn(param(req, 'id'))));
  r.post('/agents/:id/spot-checks', h((req) => office.agents.tickSpotCheck(param(req, 'id'), Number(req.body.slice), Number(req.body.index), req.body.checked === true)));
  r.post('/agents/:id/contacts/:contact/spin-off', h((req) => office.agents.spinOffContact(param(req, 'id'), param(req, 'contact'), str(req.body.text))));
  r.post('/agents/:id/ideas/spin-off', h((req) => office.agents.spinOffIdea(param(req, 'id'), str(req.body.idea), str(req.body.text))));
  r.post('/agents/:id/permission', h((req) => office.agents.resolvePermission(param(req, 'id'), str(req.body.requestId), req.body.allow === true)));
  r.post('/agents/:id/stop', h((req) => office.agents.stop(param(req, 'id'))));
  r.post('/agents/:id/compact', h((req) => office.agents.compactNow(param(req, 'id'))));
  r.post('/agents/:id/cloud', h((req) => office.agents.moveToCloud(param(req, 'id'))));
  r.post('/agents/:id/cloud/terminal', h((req) => office.agents.openCloudTerminal(param(req, 'id'))));
  r.post('/agents/:id/cloud/attach', h((req) => office.agents.attachCloud(param(req, 'id'), str(req.body.link))));
  r.post('/agents/:id/cloud/stay', h((req) => office.agents.stayLocal(param(req, 'id'))));
  r.post('/agents/:id/close', h((req) => office.agents.closeGoal(param(req, 'id'), req.body.force === true)));
  r.post('/agents/:id/effort', h((req) => {
    const level = effort(req.body.effort);
    if (!level) throw new Error('Pick an effort level');
    return office.agents.setEffort(param(req, 'id'), level);
  }));
  r.post('/agents/:id/autonomy', h((req) => {
    const mode: unknown = req.body.autonomy;
    if (!isAutonomy(mode)) throw new Error('Pick an autonomy mode: ask, auto or full');
    return office.agents.setAutonomy(param(req, 'id'), mode);
  }));
  r.delete('/agents/:id', h((req) => office.agents.dismiss(param(req, 'id'))));

  // dictation: whisper.cpp on this machine turns the browser's 16 kHz WAV into text
  r.get('/voice/status', h(() => office.voice.refresh()));
  r.post('/voice/download-model', h(() => office.voice.startDownload()));
  r.post('/transcribe', express.raw({ type: 'audio/wav', limit: '25mb' }), h(async (req) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('Send the recording as an audio/wav body');
    return { text: await office.voice.transcribe(req.body) };
  }));
  // the crew's voices: Kokoro on this machine turns a line into a WAV
  r.post('/voice/speech/load', h(() => office.voice.loadSpeech()));
  r.post('/voice/speak', h(async (req, res) => {
    const text = str(req.body.text).trim();
    if (!text) throw new Error('Send the line to say');
    if (!isKokoroVoice(req.body.voice)) throw new Error('Unknown voice');
    // a line nobody's waiting for any more (the page hushed it, or went) is dropped from Kokoro's queue
    const gone = new AbortController();
    res.on('close', () => !res.writableFinished && gone.abort());
    const urgency = req.body.urgency === 'ahead' ? 'ahead' : 'now';
    res.type('audio/wav').send(await office.voice.speak(text.slice(0, 1000), req.body.voice, urgency, gone.signal));
  }));

  // each plugin's own routes (docs/plugins.md), under its id
  for (const { plugin, route } of office.agents.plugins.routes()) {
    r[route.method](`/plugins/${plugin}${route.path}`, h((req) => route.handle({ body: req.body ?? {}, query: req.query })));
  }

  r.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return r;
}
