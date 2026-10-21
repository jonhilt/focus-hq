import { callerOf, FLOW_FROM_HEADER, FLOWS_PARAM } from '../../../shared/flows';
import type { Decide, Inbox } from '../../../shared/captainsInbox';
import type { PersonalEntry } from '../../../shared/personalLog';
import type { Agent, Autonomy, Board, ConflictsOutcome, Effort, FrameStatsLine, Issue, IssueDraft, MergeMethod, MessageReply, Preview, PreviewLog, PreviewLogFile, PreviewSet, QaChatReply, QaChatTurn, QaPlaybook, QaReview, Project, QueuedGoal, ReplayStep, ResumeHow, RoomTheme, Settings, TermLine, VoiceStatus, WorkflowScript } from '../../../shared/types';
import type { LedgerEvent } from '../../../shared/ledger';
import type { KokoroVoice } from '../../../shared/voice';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  return send<T>(method, url, body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** While a run's flows are recorded (`?flows`, shared/flows.ts), each request names the file that made it. */
// (no location where tests run the module under Node)
const recording = new URLSearchParams((globalThis as { location?: Location }).location?.search ?? '').has(FLOWS_PARAM);

function from(init: RequestInit): RequestInit {
  const file = recording && callerOf(new Error().stack, ['client/src/net/api.ts']);
  return file ? { ...init, headers: { ...(init.headers as Record<string, string> | undefined), [FLOW_FROM_HEADER]: file } } : init;
}

async function send<T>(method: string, url: string, init: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, { method, ...from(init) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  createProject: (name: string, color: string, repos: string[], theme?: RoomTheme) => call<Project>('POST', '/projects', { name, color, repos, theme }),
  /** A null QA effort goes back to the model's default. */
  updateProject: (id: string, patch: Omit<Partial<Project>, 'qaEffort'> & { qaEffort?: Effort | null; plugin?: { id: string; on: boolean } }) => call<Project>('PATCH', `/projects/${id}`, patch),
  /** An empty method goes back to Settings' merge method for that repo. */
  setMergeMethod: (id: string, repo: string, method: MergeMethod | '') => call<Project>('PATCH', `/projects/${id}`, { mergeMethod: { repo, method } }),
  deleteProject: (id: string) => call('DELETE', `/projects/${id}`),
  connectRepo: (id: string, repo: string) => call<Project>('POST', `/projects/${id}/repos`, { repo }),
  disconnectRepo: (id: string, repo: string) => call<Project>('DELETE', `/projects/${id}/repos?repo=${encodeURIComponent(repo)}`),
  refreshBoard: (id: string) => call<Board>('POST', `/projects/${id}/refresh`),
  createRepo: (body: { name: string; owner?: string; private: boolean; description: string; projectId?: string }) =>
    call<{ repo: string }>('POST', '/repos', body),
  listRepos: () => call<string[]>('GET', '/github/repos'),
  checkGitHub: () => call('POST', '/github/check'),
  updateSettings: (patch: Partial<Settings>) => call<Settings>('PATCH', '/settings', patch),

  createIssue: (body: { projectId: string; repo: string; title: string; body: string; labels: string[]; assign: boolean; effort?: Effort; cloud?: boolean; fromDraft?: boolean }) =>
    call<{ issue: Issue; agent?: Agent }>('POST', '/issues', body),
  draftIssue: (projectId: string, idea: string, revise?: { repo: string; title: string; body: string; notes: string }) =>
    call<IssueDraft>('POST', `/projects/${projectId}/draft`, { idea, revise }),
  discardDraft: (projectId: string) => call('DELETE', `/projects/${projectId}/draft`),
  /**
   * Starts a goal at a team station (the first free one unless `station` says): a lead of its own hears `text` first.
   * With every station taken, the goal waits in line instead.
   */
  startGoal: (projectId: string, text: string, how: { station?: number; effort?: Effort; from?: string } = {}) =>
    call<{ agent: Agent } | { queued: QueuedGoal }>('POST', `/projects/${projectId}/goals`, { text, ...how }),
  /** Demo only: how fast the pretend agents go (below 1 is slower than `pnpm run demo`), told to every tab. */
  demoSpeed: (speed: number) => call<{ speed: number }>('POST', '/demo/speed', { speed }),
  startQueued: (projectId: string, queueId: string, edits: { text?: string; effort?: Effort; station?: number } = {}) =>
    call<Agent>('POST', `/projects/${projectId}/goals/queue/${queueId}/start`, edits),
  moveQueued: (projectId: string, queueId: string, by: -1 | 1) => call('POST', `/projects/${projectId}/goals/queue/${queueId}/move`, { by }),
  dropQueued: (projectId: string, queueId: string) => call('DELETE', `/projects/${projectId}/goals/queue/${queueId}`),
  /** Reopens a closed goal from the room's log at a free team station, on its branch and with its lead's session. */
  reopenGoal: (projectId: string, goalId: string) => call<Agent>('POST', `/projects/${projectId}/goals/${goalId}/reopen`, {}),
  /** Closes a goal, unless something would be lost or left behind: then it says what, and `force` closes it anyway. */
  closeGoal: (id: string, force = false) => call<{ closed: true } | { warn: string[] }>('POST', `/agents/${id}/close`, { force }),
  /** A plugin's own route (docs/plugins.md), under `/api/plugins/<id>`. */
  plugin: <T>(id: string, path: string, body?: unknown) => call<T>('POST', `/plugins/${encodeURIComponent(id)}${path}`, body),
  /** The ledger's events of the last `days` days, for reviewing at the master systems table. */
  ledger: (days: number) => call<LedgerEvent[]>('GET', `/ledger?days=${days}`),
  /** Jots a thought down in the captain's personal log. */
  notePersonal: (text: string) => call<PersonalEntry>('POST', '/personal-log', { text }),
  markPersonal: (id: string, body: { kind: 'done' | 'dropped' | 'reopened' } | { kind: 'snoozed'; until: number } | { kind: 'edited'; text: string }) =>
    call<PersonalEntry>('POST', `/personal-log/${id}`, body),
  undigested: () => call<{ sessions: number }>('GET', '/digests/backfill'),
  backfillDigests: () => call<{ sessions: number }>('POST', '/digests/backfill'),
  sendToQa: (projectId: string, repo: string, number: number) => call<QaReview>('POST', '/prs/qa', { projectId, repo, number }),
  /** What QA does on the project, built from its instructions and settings as they are now. */
  qaPlaybook: (projectId: string) => call<QaPlaybook>('GET', `/projects/${projectId}/qa-playbook`),
  /** The QA officer's answer to the talk so far at the Playbook, and maybe a change for the captain to apply (it applies nothing). */
  qaChat: (projectId: string, messages: QaChatTurn[]) => call<QaChatReply>('POST', `/projects/${projectId}/qa-chat`, { messages }),
  resolveConflicts: (projectId: string, repo: string, number: number) =>
    call<ConflictsOutcome>('POST', '/prs/resolve-conflicts', { projectId, repo, number }),
  mergePr: (projectId: string, repo: string, number: number, override = false) => call<{ checking: true }>('POST', '/prs/merge', { projectId, repo, number, override }),
  mergeWhenPassed: (projectId: string, repo: string, number: number, on: boolean) => call<QaReview>('POST', '/prs/merge-when-passed', { projectId, repo, number, on }),
  /** `picks`: what other repos run (a PR number, or null for the default branch); left out, the PRs linked to this one. */
  startPreview: (projectId: string, repo: string, number: number, picks?: PreviewSet) => call<Preview>('POST', '/previews', { projectId, repo, number, with: picks }),
  stopPreview: (projectId: string) => call('DELETE', `/previews/${projectId}`),
  previewLog: (projectId: string) => call<PreviewLog>('GET', `/previews/${projectId}/log`),
  previewLogFiles: (projectId: string) => call<PreviewLogFile[]>('GET', `/previews/${projectId}/logs`),
  previewLogFile: (projectId: string, name: string) =>
    call<{ name: string; text: string; truncated: boolean }>('GET', `/previews/${projectId}/logs/${encodeURIComponent(name)}`),

  hire: (projectId: string, issue: Issue, effort?: Effort, cloud?: boolean) =>
    call<Agent>('POST', '/agents', { projectId, repo: issue.repo, number: issue.number, title: issue.title, url: issue.url, effort, cloud }),
  lines: (id: string) => call<TermLine[]>('GET', `/agents/${id}/lines`),
  /** An agent's run journal replayed: each fact in words, and where the run was after it. */
  run: (id: string) => call<ReplayStep[]>('GET', `/agents/${id}/run`),
  /** The tail of what a lead's background command (or monitor) has written, read again each call. */
  backgroundOutput: (leadId: string, taskId: string) => call<Omit<TermLine, 't'>[]>('GET', `/agents/${leadId}/background/${encodeURIComponent(taskId)}/output`),
  /** Stops it, and tells the lead; `stopped` is false when the lead's session can't be asked. */
  stopBackground: (leadId: string, taskId: string) => call<{ stopped: boolean }>('POST', `/agents/${leadId}/background/${encodeURIComponent(taskId)}/stop`),
  workflowScript: (leadId: string, workflowId: string) => call<WorkflowScript>('GET', `/agents/${leadId}/workflows/${encodeURIComponent(workflowId)}/script`),
  workflowAgentLines: (leadId: string, workflowId: string, agentId: string) =>
    call<TermLine[]>('GET', `/agents/${leadId}/workflows/${encodeURIComponent(workflowId)}/agents/${encodeURIComponent(agentId)}/lines`),
  /**
   * On your API key, with a long conversation to pick back up, the message isn't sent: it comes back `costly`, for the
   * captain to say `how` (`messageAgent` asks them).
   */
  message: (id: string, text: string, how?: ResumeHow) => call<MessageReply>('POST', `/agents/${id}/message`, { text, how }),
  answer: (id: string, question: string, option: string, note?: string, how?: ResumeHow) =>
    call<Agent | MessageReply>('POST', `/agents/${id}/answer`, { question, option, note, how }),
  /** The captain's inbox: what needs them, and what they decided lately (docs/ledger.md#the-captains-inbox-api). */
  inbox: () => call<Inbox>('GET', '/inbox'),
  /** Answers an inbox item by its id, from the office (docs/ledger.md#the-captains-inbox-api). */
  decide: (id: string, decide: Decide) => call<{ ok: true } | MessageReply>('POST', `/inbox/${encodeURIComponent(id)}/decide`, { ...decide, via: 'office' }),
  /** Holds the chief of staff's words on an inbox item, so they wait for the captain rather than going by themselves. */
  hold: (id: string) => call('POST', `/inbox/${encodeURIComponent(id)}/hold`),
  /** The captain has read the lead's latest turn, here: every screen stops hailing about it. */
  readTurn: (id: string) => call('POST', `/agents/${id}/read`),
  spinOffContact: (id: string, contact: string, text: string) => call<{ agent: Agent } | { queued: QueuedGoal }>('POST', `/agents/${id}/contacts/${contact}/spin-off`, { text }),
  spinOffIdea: (id: string, idea: string, text: string) => call<{ agent: Agent } | { queued: QueuedGoal }>('POST', `/agents/${id}/ideas/spin-off`, { idea, text }),
  tickSpotCheck: (id: string, slice: number, index: number, checked: boolean) => call('POST', `/agents/${id}/spot-checks`, { slice, index, checked }),
  permission: (id: string, requestId: string, allow: boolean) => call('POST', `/agents/${id}/permission`, { requestId, allow }),
  stop: (id: string) => call('POST', `/agents/${id}/stop`),
  dismiss: (id: string) => call('DELETE', `/agents/${id}`),
  setEffort: (id: string, effort: Effort) => call<Agent>('POST', `/agents/${id}/effort`, { effort }),
  /** What this one agent may do without asking, from now on: the office's setting stays as it is. */
  setAutonomy: (id: string, autonomy: Autonomy) => call<Agent>('POST', `/agents/${id}/autonomy`, { autonomy }),
  /** Compacts the agent's conversation between turns, keeping what their work needs. */
  compact: (id: string) => call<Agent>('POST', `/agents/${id}/compact`),
  /** Moves a local agent's work to a Claude Code cloud session, which the captain then starts. */
  moveToCloud: (id: string) => call<Agent>('POST', `/agents/${id}/cloud`),
  /** Opens a terminal on this machine that starts the waiting agent's cloud session. */
  cloudTerminal: (id: string) => call<Agent>('POST', `/agents/${id}/cloud/terminal`),
  /** Hands the waiting agent the cloud session at `link` (claude.ai/code/session_…). */
  attachCloud: (id: string, link: string) => call<Agent>('POST', `/agents/${id}/cloud/attach`, { link }),
  /** Keeps the waiting agent on this machine. */
  stayLocal: (id: string) => call<Agent>('POST', `/agents/${id}/cloud/stay`),

  voiceStatus: () => call<VoiceStatus>('GET', '/voice/status'),
  downloadVoiceModel: () => call<VoiceStatus>('POST', '/voice/download-model'),
  transcribe: (wav: ArrayBuffer) => send<{ text: string }>('POST', '/transcribe', { headers: { 'Content-Type': 'audio/wav' }, body: wav }),
  loadSpeech: () => call<VoiceStatus>('POST', '/voice/speech/load'),
  /** The line as Kokoro says it, as a WAV: `ahead` for one fetched before it's needed, which waits behind any wanted now. Aborting drops it from Kokoro's queue. */
  speak: async (text: string, voice: KokoroVoice, signal: AbortSignal, urgency: 'now' | 'ahead' = 'now'): Promise<Blob> => {
    const res = await fetch('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice, urgency }), signal });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `${res.status} ${res.statusText}`);
    return res.blob();
  },
  /** Lines of the frame-stats log (?stats=1), sent even as the page closes (keepalive); the office says where it keeps them. */
  logFrameStats: (session: string, lines: FrameStatsLine[]) =>
    send<{ file: string }>('POST', '/frame-stats', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, lines }), keepalive: true }),
};
