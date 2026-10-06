import type { Agent, Board, Effort, Issue, IssueDraft, NumberOneChat, Preview, PreviewLog, PreviewLogFile, PreviewSet, QaReview, Project, QueuedGoal, RoomTheme, Settings, TermLine, VoiceStatus } from '../../../shared/types';
import type { KokoroVoice } from '../../../shared/voice';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  return send<T>(method, url, body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function send<T>(method: string, url: string, init: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, { method, ...init });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  createProject: (name: string, color: string, repos: string[], theme?: RoomTheme) => call<Project>('POST', '/projects', { name, color, repos, theme }),
  updateProject: (id: string, patch: Partial<Project>) => call<Project>('PATCH', `/projects/${id}`, patch),
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
  startQueued: (projectId: string, queueId: string, edits: { text?: string; effort?: Effort } = {}) =>
    call<Agent>('POST', `/projects/${projectId}/goals/queue/${queueId}/start`, edits),
  moveQueued: (projectId: string, queueId: string, by: -1 | 1) => call('POST', `/projects/${projectId}/goals/queue/${queueId}/move`, { by }),
  dropQueued: (projectId: string, queueId: string) => call('DELETE', `/projects/${projectId}/goals/queue/${queueId}`),
  /** Closes a goal, unless something would be lost or left behind: then it says what, and `force` closes it anyway. */
  closeGoal: (id: string, force = false) => call<{ closed: true } | { warn: string[] }>('POST', `/agents/${id}/close`, { force }),
  numberOneSay: (text: string) => call<NumberOneChat>('POST', '/number-one/say', { text }),
  numberOneNew: () => call<NumberOneChat>('POST', '/number-one/new'),
  sendToQa: (projectId: string, repo: string, number: number) => call<QaReview>('POST', '/prs/qa', { projectId, repo, number }),
  resolveConflicts: (projectId: string, repo: string, number: number) =>
    call<Agent>('POST', '/prs/resolve-conflicts', { projectId, repo, number }),
  mergePr: (projectId: string, repo: string, number: number) => call('POST', '/prs/merge', { projectId, repo, number }),
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
  message: (id: string, text: string) => call('POST', `/agents/${id}/message`, { text }),
  permission: (id: string, requestId: string, allow: boolean) => call('POST', `/agents/${id}/permission`, { requestId, allow }),
  stop: (id: string) => call('POST', `/agents/${id}/stop`),
  dismiss: (id: string) => call('DELETE', `/agents/${id}`),
  setEffort: (id: string, effort: Effort) => call<Agent>('POST', `/agents/${id}/effort`, { effort }),
  /** Compacts the agent's conversation between turns, keeping what their work needs. */
  compact: (id: string) => call<Agent>('POST', `/agents/${id}/compact`),

  voiceStatus: () => call<VoiceStatus>('GET', '/voice/status'),
  downloadVoiceModel: () => call<VoiceStatus>('POST', '/voice/download-model'),
  transcribe: (wav: ArrayBuffer) => send<{ text: string }>('POST', '/transcribe', { headers: { 'Content-Type': 'audio/wav' }, body: wav }),
  loadSpeech: () => call<VoiceStatus>('POST', '/voice/speech/load'),
  /** The line as Kokoro says it, as a WAV. */
  speak: async (text: string, voice: KokoroVoice, signal: AbortSignal): Promise<Blob> => {
    const res = await fetch('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }), signal });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `${res.status} ${res.statusText}`);
    return res.blob();
  },
};
