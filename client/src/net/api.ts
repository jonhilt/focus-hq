import type { Agent, Board, Briefing, Effort, Issue, IssueDraft, Preview, PreviewLog, PreviewLogFile, PreviewSet, QaReview, Project, RoomTheme, Settings, TermLine } from '../../../shared/types';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  callBriefing: (projectId: string, idea: string) => call<Briefing>('POST', '/briefing', { projectId, idea }),
  briefingSay: (text: string) => call<Briefing>('POST', '/briefing/say', { text }),
  briefingWrapUp: () => call<Briefing>('POST', '/briefing/wrap-up'),
  briefingEnd: () => call('DELETE', '/briefing'),
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
};
