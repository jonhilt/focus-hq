import { describe, expect, it } from 'vitest';
import type { Board, PullRequest } from '../shared/types';
import { artifactServing, effort, picks, pluginSecretChange, pushedPr, pushKind, qaShotServing, resumeHow, str } from './apiRequests';

const PAGE_SANDBOX = 'sandbox allow-scripts allow-popups';
const SVG_SANDBOX = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const KEEP = 'max-age=31536000, immutable';

describe('str', () => {
  it('takes a string, and the fallback for anything else', () => {
    expect(str('a')).toBe('a');
    expect(str(3)).toBe('');
    expect(str(undefined, 'x')).toBe('x');
  });
});

describe('picks', () => {
  it("keeps each repo's PR number or null, and drops the rest", () => {
    expect(picks({ 'o/a': 12, 'o/b': null, 'o/c': '12', 'o/d': 1.5 })).toEqual({ 'o/a': 12, 'o/b': null });
  });

  it('is none for anything but an object', () => {
    expect(picks(null)).toBeUndefined();
    expect(picks([12])).toBeUndefined();
    expect(picks('o/a')).toBeUndefined();
  });
});

describe('resumeHow', () => {
  it('is key or wait, and none for anything else', () => {
    expect(resumeHow('key')).toBe('key');
    expect(resumeHow('wait')).toBe('wait');
    expect(resumeHow('now')).toBeUndefined();
  });
});

describe('effort', () => {
  it("is the model's default when missing or empty", () => {
    expect(effort(undefined)).toBeUndefined();
    expect(effort('')).toBeUndefined();
  });

  it('takes a level, and refuses anything else', () => {
    expect(effort('high')).toBe('high');
    expect(() => effort('extreme')).toThrow(/Effort must be one of/);
  });
});

describe('qaShotServing', () => {
  it('keeps a screenshot for good, an SVG one sandboxed', () => {
    expect(qaShotServing('o-a-12-1700-1.jpg')).toEqual({ type: 'jpg', headers: { 'Cache-Control': KEEP } });
    expect(qaShotServing('o-a-12-1700-1.svg')).toEqual({ type: 'svg', headers: { 'Cache-Control': KEEP, 'Content-Security-Policy': SVG_SANDBOX } });
  });

  it('keeps a recording of QA’s browser for good, as its GIF and its MP4', () => {
    expect(qaShotServing('o-a-12-1700-recording.gif')).toEqual({ type: 'gif', headers: { 'Cache-Control': KEEP } });
    expect(qaShotServing('o-a-12-1700-recording.mp4')).toEqual({ type: 'mp4', headers: { 'Cache-Control': KEEP } });
  });

  it("doesn't serve any other name", () => {
    for (const file of ['../store.json', 'a.html', 'a.jpg.html', 'a b.png', '.jpg', 'a.webm']) expect(qaShotServing(file)).toBeUndefined();
  });
});

describe('artifactServing', () => {
  it("serves a lead's page, or a question's option, sandboxed and never kept", () => {
    const page = { type: 'html', headers: { 'Content-Security-Policy': PAGE_SANDBOX, 'Cache-Control': 'no-cache' } };
    expect(artifactServing('lead_1', 'data-flow.html')).toEqual(page);
    expect(artifactServing('lead_1', 'q1.a.html')).toEqual(page);
  });

  it("keeps a page's picture for good, since its URL changes with each version", () => {
    expect(artifactServing('lead_1', 'data-flow.jpg')).toEqual({ type: 'jpg', headers: { 'Cache-Control': KEEP } });
  });

  it("doesn't keep a waypoint's evidence, which keeps its name from round to round, and sandboxes an SVG one", () => {
    expect(artifactServing('lead_1', 'shot-o-a-12-1.jpg')).toEqual({ type: 'jpg', headers: { 'Cache-Control': 'no-cache' } });
    expect(artifactServing('lead_1', 'shot-o-a-12-1.png')).toEqual({ type: 'png', headers: { 'Cache-Control': 'no-cache' } });
    expect(artifactServing('lead_1', 'shot-o-a-12-1.svg')).toEqual({ type: 'svg', headers: { 'Cache-Control': 'no-cache', 'Content-Security-Policy': SVG_SANDBOX } });
  });

  it("doesn't serve another lead's folder or any other name", () => {
    expect(artifactServing('../lead_1', 'a.html')).toBeUndefined();
    expect(artifactServing('agent_1', 'a.html')).toBeUndefined();
    for (const file of ['../a.html', 'A.html', '-a.html', 'a.svg', 'q1.e.html', 'a.html.jpg.js', 'shot-A.png']) {
      expect(artifactServing('lead_1', file)).toBeUndefined();
    }
  });
});

describe('a change to a plugin’s secret', () => {
  it('takes a string to set it or null to clear it, and refuses anything else', () => {
    expect(pluginSecretChange({ plugin: 'number-one', name: 'OPENAI_API_KEY', value: 'sk' })).toEqual({ plugin: 'number-one', name: 'OPENAI_API_KEY', value: 'sk' });
    expect(pluginSecretChange({ plugin: 'number-one', name: 'OPENAI_API_KEY', value: null })).toMatchObject({ value: null });
    expect(() => pluginSecretChange({ plugin: 'p', name: 'N', value: 3 })).toThrow('as a string, or null');
    expect(() => pluginSecretChange(undefined)).toThrow('as a string, or null');
  });
});

describe('pushKind', () => {
  it('changes the PR’s own code when asked, and otherwise merges its base in', () => {
    expect(pushKind('change')).toBe('change');
    expect(pushKind('merge-base')).toBe('merge-base');
    expect(pushKind(undefined)).toBe('merge-base');
    expect(pushKind(['change'])).toBe('merge-base');
  });
});

describe('pushedPr', () => {
  const pr = (repo: string, number: number): PullRequest => ({
    repo,
    number,
    title: `PR ${number}`,
    url: '',
    branch: `focus/${number}`,
    baseBranch: 'main',
    isDraft: false,
    mergeable: 'MERGEABLE',
    checks: 'passing',
    failedChecks: [],
    closes: [],
    createdAt: '2026-10-01T00:00:00Z',
  });
  const projects = [{ id: 'p1', repos: ['acme/shop'] }, { id: 'p2', repos: ['acme/api', 'acme/web'] }];
  const boards = new Map<string, Board>([
    ['p1', { projectId: 'p1', issues: [], prs: [pr('acme/shop', 7)], updatedAt: 0 }],
    ['p2', { projectId: 'p2', issues: [], prs: [pr('acme/web', 7), pr('acme/api', 8)], updatedAt: 0 }],
  ]);

  it('finds the PR on the board of the project its repo belongs to', () => {
    expect(pushedPr(projects, boards, 'acme/api', 8)).toEqual({ projectId: 'p2', title: 'PR 8' });
  });

  it('tells a PR from one of the same number in another repo', () => {
    expect(pushedPr(projects, boards, 'acme/web', 7)).toEqual({ projectId: 'p2', title: 'PR 7' });
    expect(pushedPr(projects, boards, 'acme/api', 7)).toBeUndefined();
  });

  it('finds nothing for a repo no project has, or a project with no board yet', () => {
    expect(pushedPr(projects, boards, 'acme/other', 7)).toBeUndefined();
    expect(pushedPr(projects, new Map(), 'acme/shop', 7)).toBeUndefined();
  });
});
