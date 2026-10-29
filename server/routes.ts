import express, { type NextFunction, type Request, type Response } from 'express';
import { isAutonomy } from '../shared/autonomy';
import { closedGoals } from '../shared/ledger';
import { ledgerWindow } from '../shared/ledgerReview';
import { isKokoroVoice } from '../shared/voice';
import { logFrom, personalMark } from '../shared/personalLog';
import { replay } from './agents/runJournal';
import { artifactServing, codingAgent, effort, picks, pluginSecretChange, qaShotServing, resumeHow, str } from './apiRequests';
import { botChange, botGuard } from './bot';
import { paths } from './config';
import { appendFrameStats } from './frameStats';
import type { Focus } from './focus';
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

/** A route's named path parts, each as text. */
const pathParams = (req: Request): Record<string, string> => Object.fromEntries(Object.keys(req.params).map((name) => [name, param(req, name)]));

export function apiRouter(focus: Focus, store: Store, botToken: () => string | undefined = () => focus.bot.config().token): express.Router {
  const r = express.Router();
  r.use(express.json({ limit: '2mb' }));
  r.get('/state', h(() => focus.snapshot()));
  // how the 3D view runs in a browser opened with ?stats=1, kept here so a run on another machine can be read where Focus is
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
  r.post('/github/check', h(() => focus.checkGitHub()));
  r.get('/github/repos', h(() => focus.listRepos()));
  r.patch('/settings', h((req) => focus.updateSettings(req.body ?? {})));
  // a bot speaking for the captain (server/bot.ts): its secrets go in, never out (Focus's info says only where each comes from)
  r.patch('/settings/bot', h((req) => focus.changeBot(botChange(req.body))));
  r.post('/settings/bot/token', h(() => focus.newBotToken()));
  r.delete('/settings/bot/token', h(() => focus.clearBotToken()));
  // a plugin's secret (an API key), set in the Plugins tab: in, never out
  r.patch('/settings/plugin-secret', h((req) => {
    const { plugin, name, value } = pluginSecretChange(req.body);
    return focus.changePluginSecret(plugin, name, value);
  }));
  r.post('/restart', h(() => focus.restartFocus()));

  // projects (rooms)
  r.post('/projects', h((req) => focus.createProject(str(req.body.name), req.body.color, Array.isArray(req.body.repos) ? req.body.repos : [], req.body.theme)));
  r.patch('/projects/:id', h((req) => focus.updateProject(param(req, 'id'), req.body ?? {})));
  r.delete('/projects/:id', h((req) => focus.deleteProject(param(req, 'id'))));
  r.post('/projects/:id/repos', h((req) => focus.connectRepo(param(req, 'id'), str(req.body.repo))));
  r.delete('/projects/:id/repos', h((req) => focus.disconnectRepo(param(req, 'id'), str(req.query.repo))));
  // what QA does on the project, from its instructions and settings as they are now (the QA station's Playbook)
  r.get('/projects/:id/qa-playbook', h((req) => focus.agents.qaPlaybook(param(req, 'id'))));
  // the captain talking to the QA officer there: it answers, and may propose a change the captain applies or not
  r.post('/projects/:id/qa-chat', h((req) => focus.agents.qaChat(param(req, 'id'), req.body.messages)));
  r.post('/projects/:id/refresh', h(async (req) => {
    await focus.refreshBoard(param(req, 'id'));
    return store.boards.get(param(req, 'id'));
  }));

  // blank repositories
  r.post('/repos', h((req) =>
    focus.createRepo(
      str(req.body.name),
      { owner: str(req.body.owner) || undefined, private: req.body.private !== false, description: str(req.body.description) },
      str(req.body.projectId) || undefined,
    ).then((repo) => ({ repo })),
  ));

  // issues and pull requests
  r.post('/issues', h((req) =>
    focus.createIssue(
      str(req.body.projectId),
      str(req.body.repo),
      str(req.body.title),
      str(req.body.body),
      Array.isArray(req.body.labels) ? req.body.labels.filter((l: unknown) => typeof l === 'string' && l.trim()) : [],
      req.body.assign === true ? { effort: effort(req.body.effort), cloud: req.body.cloud === true, agent: codingAgent(req.body.agent) } : undefined,
      req.body.fromDraft === true,
    ),
  ));

  // the planner at each room's Ops station: rough idea in, issue draft out (over the websocket)
  r.post('/projects/:id/draft', h((req) => {
    const revise = req.body.revise;
    return focus.planner.start(
      param(req, 'id'),
      str(req.body.idea),
      revise && typeof revise === 'object'
        ? { repo: str(revise.repo), title: str(revise.title), body: str(revise.body), notes: str(revise.notes) }
        : undefined,
    );
  }));
  r.delete('/projects/:id/draft', h((req) => focus.planner.discard(param(req, 'id'))));

  // every closed goal the ledger kept, so what its lead showed can be found once it's off the room's log
  r.get('/goals/archive', h((req) => closedGoals(store.ledger, typeof req.query.project === 'string' ? req.query.project : undefined)));
  // the captain's personal log: what they jotted down to come back to (shared/personalLog.ts)
  r.get('/personal-log', h(() => store.personalEntries));
  r.post('/personal-log', h((req) => focus.notePersonal(req.body.text, logFrom(req.body.from))));
  r.post('/personal-log/:id', h((req) => focus.markPersonal(personalMark(param(req, 'id'), req.body))));
  r.get('/ledger', h((req) => ledgerWindow(store.ledger, Date.now(), Number(req.query.days ?? 14))));
  r.get('/digests/backfill', h(async () => ({ sessions: (await focus.agents.undigested()).length })));
  r.post('/digests/backfill', h(() => focus.agents.backfill()));
  r.post('/prs/qa', h((req) => focus.requestReview(str(req.body.projectId), str(req.body.repo), Number(req.body.number))));
  r.post('/prs/resolve-conflicts', h((req) => focus.resolveConflicts(str(req.body.projectId), str(req.body.repo), Number(req.body.number))));
  r.post('/prs/merge', h((req) => focus.mergeFromBoard(str(req.body.projectId), str(req.body.repo), Number(req.body.number), req.body.override === true)));
  r.post('/prs/merge-when-passed', h((req) => focus.mergeWhenPassed(str(req.body.projectId), str(req.body.repo), Number(req.body.number), req.body.on !== false)));

  // previews: a PR running on this machine, one per project
  r.post('/previews', h((req) => focus.startPreview(str(req.body.projectId), str(req.body.repo), Number(req.body.number), picks(req.body.with))));
  r.delete('/previews/:projectId', h((req) => focus.previews.stop(param(req, 'projectId'))));
  r.get('/previews/:projectId/log', h((req) => focus.previews.log(param(req, 'projectId'))));
  r.get('/previews/:projectId/logs', h((req) => focus.previews.logFiles(param(req, 'projectId'))));
  r.get('/previews/:projectId/logs/:name', h((req) => focus.previews.logFile(param(req, 'projectId'), param(req, 'name'))));

  // agents
  r.post('/agents', h((req) =>
    focus.agents.hire(str(req.body.projectId), str(req.body.repo), {
      number: Number(req.body.number),
      title: str(req.body.title) || undefined,
      url: str(req.body.url) || undefined,
    }, { effort: effort(req.body.effort), cloud: req.body.cloud === true, agent: codingAgent(req.body.agent) }),
  ));
  // a goal: its own lead (the user's own Claude Code session for it, across the project's repos). A project has any
  // number, so it always starts; a `station` sent by an older client is ignored
  r.post('/projects/:id/goals', h((req) =>
    focus.agents.startGoal(param(req, 'id'), str(req.body.text), {
      effort: effort(req.body.effort),
      from: str(req.body.from) || undefined,
      shaping: req.body.shaping === true,
    }),
  ));
  // goals waiting in line (from when goals waited for a free team station): started by the user, never by themselves
  r.post('/projects/:id/goals/queue/:qid/start', h((req) =>
    focus.agents.startQueued(param(req, 'id'), param(req, 'qid'), {
      text: str(req.body.text) || undefined,
      effort: effort(req.body.effort),
      shaping: typeof req.body.shaping === 'boolean' ? req.body.shaping : undefined,
    }),
  ));
  r.post('/projects/:id/goals/queue/:qid/move', h((req) => focus.agents.moveQueued(param(req, 'id'), param(req, 'qid'), Math.sign(Number(req.body.by)) || 0)));
  // a closed goal from the room's log, back on its branch and session
  r.post('/projects/:id/goals/:gid/reopen', h((req) => focus.agents.reopenGoal(param(req, 'id'), param(req, 'gid'))));
  r.delete('/projects/:id/goals/queue/:qid', h((req) => focus.agents.dropQueued(param(req, 'id'), param(req, 'qid'))));
  r.get('/agents/:id/lines', h((req) => store.allLines(param(req, 'id'))));
  r.get('/agents/:id/run', h((req) => replay(store.journalEntries(param(req, 'id')))));
  r.get('/agents/:id/background/:task/output', h((req) => focus.agents.backgroundOutput(param(req, 'id'), param(req, 'task'))));
  r.post('/agents/:id/background/:task/stop', h((req) => focus.agents.stopBackground(param(req, 'id'), param(req, 'task'))));
  r.get('/agents/:id/workflows/:workflow/script', h((req) => focus.agents.workflowScript(param(req, 'id'), param(req, 'workflow'))));
  r.get('/agents/:id/workflows/:workflow/agents/:agent/lines', h((req) => focus.agents.workflowAgentLines(param(req, 'id'), param(req, 'workflow'), param(req, 'agent'))));
  // on your API key, picking a long conversation back up costs enough that the captain says how first (`how`)
  // the captain's answers, which the plugins hear of once they've gone through (`AgentManager.captainAnswers`)
  r.post('/agents/:id/message', h((req) => {
    const text = str(req.body.text);
    return focus.agents.captainAnswers(param(req, 'id'), { text: text.trim() }, () => focus.agents.message(param(req, 'id'), text, undefined, resumeHow(req.body.how)));
  }));
  r.post('/agents/:id/answer', h((req) => {
    const option = str(req.body.option);
    const note = typeof req.body.note === 'string' ? req.body.note : undefined;
    const answer = { option, ...(note?.trim() && { note: note.trim() }) };
    return focus.agents.captainAnswers(param(req, 'id'), answer, () => focus.agents.answer(param(req, 'id'), str(req.body.question), option, note, resumeHow(req.body.how)));
  }));
  r.post('/agents/:id/read', h((req) => focus.agents.readTurn(param(req, 'id'))));
  r.post('/agents/:id/spot-checks', h((req) => focus.agents.tickSpotCheck(param(req, 'id'), Number(req.body.slice), Number(req.body.index), req.body.checked === true)));
  r.post('/agents/:id/contacts/:contact/spin-off', h((req) => focus.agents.spinOffContact(param(req, 'id'), param(req, 'contact'), str(req.body.text))));
  r.post('/agents/:id/ideas/spin-off', h((req) => focus.agents.spinOffIdea(param(req, 'id'), str(req.body.idea), str(req.body.text))));
  r.post('/agents/:id/permission', h((req) => {
    const allow = req.body.allow === true;
    return focus.agents.captainAnswers(param(req, 'id'), { allow }, () => focus.agents.resolvePermission(param(req, 'id'), str(req.body.requestId), allow));
  }));
  r.post('/agents/:id/stop', h((req) => focus.agents.stop(param(req, 'id'))));
  r.post('/agents/:id/compact', h((req) => focus.agents.compactNow(param(req, 'id'))));
  r.post('/agents/:id/cloud', h((req) => focus.agents.moveToCloud(param(req, 'id'))));
  r.post('/agents/:id/cloud/terminal', h((req) => focus.agents.openCloudTerminal(param(req, 'id'))));
  r.post('/agents/:id/cloud/attach', h((req) => focus.agents.attachCloud(param(req, 'id'), str(req.body.link))));
  r.post('/agents/:id/cloud/stay', h((req) => focus.agents.stayLocal(param(req, 'id'))));
  r.post('/agents/:id/close', h((req) => focus.agents.captainAnswers(param(req, 'id'), { close: true }, () => focus.agents.closeGoal(param(req, 'id'), req.body.force === true))));
  r.post('/agents/:id/effort', h((req) => {
    const level = effort(req.body.effort);
    if (!level) throw new Error('Pick an effort level');
    return focus.agents.setEffort(param(req, 'id'), level);
  }));
  r.post('/agents/:id/autonomy', h((req) => {
    const mode: unknown = req.body.autonomy;
    if (!isAutonomy(mode)) throw new Error('Pick an autonomy mode: ask, auto or full');
    return focus.agents.setAutonomy(param(req, 'id'), mode);
  }));
  r.delete('/agents/:id', h((req) => focus.agents.dismiss(param(req, 'id'))));

  // dictation: whisper.cpp on this machine turns the browser's 16 kHz WAV into text
  r.get('/voice/status', h(() => focus.voice.refresh()));
  r.post('/voice/download-model', h(() => focus.voice.startDownload()));
  r.post('/transcribe', express.raw({ type: 'audio/wav', limit: '25mb' }), h(async (req) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('Send the recording as an audio/wav body');
    return { text: await focus.voice.transcribe(req.body) };
  }));
  // the crew's voices: Kokoro on this machine turns a line into a WAV
  r.post('/voice/speech/load', h(() => focus.voice.loadSpeech()));
  r.post('/voice/speak', h(async (req, res) => {
    const text = str(req.body.text).trim();
    if (!text) throw new Error('Send the line to say');
    if (!isKokoroVoice(req.body.voice)) throw new Error('Unknown voice');
    // a line nobody's waiting for any more (the page hushed it, or went) is dropped from Kokoro's queue
    const gone = new AbortController();
    res.on('close', () => !res.writableFinished && gone.abort());
    const urgency = req.body.urgency === 'ahead' ? 'ahead' : 'now';
    res.type('audio/wav').send(await focus.voice.speak(text.slice(0, 1000), req.body.voice, urgency, gone.signal));
  }));

  // each plugin's own routes (docs/plugins.md), under its id; those for a bot speaking for the captain under /bot, open
  // only to Focus's bot token (server/bot.ts)
  r.use('/bot', botGuard(botToken));
  for (const { plugin, route } of focus.agents.plugins.routes()) {
    const handle = h((req) => route.handle({ body: req.body ?? {}, query: req.query, params: pathParams(req) }));
    r[route.method](route.bot ? `/bot${route.path}` : `/plugins/${plugin}${route.path}`, handle);
  }

  r.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return r;
}
