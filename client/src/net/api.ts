import type { Agent, Board, Issue, Project, Settings, TermLine } from '../../../shared/types';

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
  createProject: (name: string, color: string, repos: string[]) => call<Project>('POST', '/projects', { name, color, repos }),
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

  createIssue: (body: { projectId: string; repo: string; title: string; body: string; labels: string[]; assign: boolean }) =>
    call<{ issue: Issue; agent?: Agent }>('POST', '/issues', body),
  mergePr: (projectId: string, repo: string, number: number) => call('POST', '/prs/merge', { projectId, repo, number }),

  hire: (projectId: string, issue: Issue) =>
    call<Agent>('POST', '/agents', { projectId, repo: issue.repo, number: issue.number, title: issue.title, url: issue.url }),
  lines: (id: string) => call<TermLine[]>('GET', `/agents/${id}/lines`),
  message: (id: string, text: string) => call('POST', `/agents/${id}/message`, { text }),
  permission: (id: string, requestId: string, allow: boolean) => call('POST', `/agents/${id}/permission`, { requestId, allow }),
  stop: (id: string) => call('POST', `/agents/${id}/stop`),
  dismiss: (id: string) => call('DELETE', `/agents/${id}`),
};
