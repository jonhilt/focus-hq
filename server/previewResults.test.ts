import { describe, expect, it } from 'vitest';
import { jsonLinks, lastJson, type Listing, localUrls, MAX_LINKS, mentions, ourStack, resultChanges, type ResultSeen } from './previewResults';

const paths = ['/work/focus/app', '/private/work/focus/app'];
const unseen: Listing = { listed: false, unlisted: 0 };
const listed: Listing = { listed: true, unlisted: 0 };
const sessions = (...stacks: object[]) => JSON.stringify({ sessions: stacks });
const ours = { id: 'a', dir: '/work/focus/app/', status: 'starting' };
const theirs = { id: 'b', dir: '/work/other/app', status: 'ready' };

describe('lastJson', () => {
  it('reads all of stdout, a pretty-printed object at the end, or the last JSON line', () => {
    expect(lastJson('{"status":"ready"}')).toEqual({ status: 'ready' });
    expect(lastJson('installing…\n{\n  "status": "ready"\n}\n')).toEqual({ status: 'ready' });
    expect(lastJson('{"phase":"install"}\nbuilding\n{"phase":"build"}')).toEqual({ phase: 'build' });
  });

  it('finds nothing when stdout doesn’t end in an object', () => {
    expect(lastJson('{"status":"ready"}\nbye')).toBeNull();
    expect(lastJson('[1, 2]')).toBeNull();
    expect(lastJson('not {json}')).toBeNull();
  });
});

describe('mentions', () => {
  it('finds one of the paths anywhere in the value, a trailing separator or not', () => {
    expect(mentions({ a: [{ dir: '/work/focus/app/' }] }, paths)).toBe(true);
    expect(mentions('/private/work/focus/app', paths)).toBe(true);
    expect(mentions({ dir: '/work/focus/app/src' }, paths)).toBe(false);
    expect(mentions(42, paths)).toBe(false);
  });
});

describe('jsonLinks', () => {
  it('reads named urls, a list of urls or a single url', () => {
    expect(jsonLinks({ urls: { web: 'http://localhost:3000/' } })).toEqual([{ name: 'web', url: 'http://localhost:3000/' }]);
    expect(jsonLinks({ urls: ['http://localhost:3000/'] })).toEqual([{ url: 'http://localhost:3000/' }]);
    expect(jsonLinks({ url: 'http://0.0.0.0:3000' })).toEqual([{ url: 'http://localhost:3000/' }]);
  });

  it('puts what a person opens first ahead of APIs and databases, and drops what a browser can’t open', () => {
    const links = jsonLinks({ urls: { api: 'http://localhost:4000', db: 'postgres://localhost:5432', web: 'http://localhost:3000', bad: 7 } });
    expect(links.map((l) => l.name)).toEqual(['web', 'api']);
  });

  it(`keeps at most ${MAX_LINKS}`, () => {
    const urls = Array.from({ length: MAX_LINKS + 2 }, (_, i) => `http://localhost:${3000 + i}`);
    expect(jsonLinks({ urls })).toHaveLength(MAX_LINKS);
  });

  it('finds none without a url', () => {
    expect(jsonLinks({ status: 'ready' })).toEqual([]);
  });
});

describe('localUrls', () => {
  it('finds local URLs in a line, without the punctuation after them', () => {
    expect(localUrls('  ➜  Local:   http://localhost:5173/, or http://[::]:8080.')).toEqual(['http://localhost:5173/', 'http://localhost:8080/']);
    expect(localUrls('see https://example.com')).toEqual([]);
  });
});

describe('ourStack', () => {
  it('takes a single stack’s JSON as ours', () => {
    expect(ourStack('{"status":"starting"}', paths, unseen)).toEqual({ stack: { status: 'starting' }, seen: unseen });
    expect(ourStack('{"phase":"install","sessions":[]}', paths, unseen).stack).toEqual({ phase: 'install', sessions: [] });
  });

  it('picks ours out of a list of stacks by the checkouts it mentions, and remembers it was listed', () => {
    expect(ourStack(sessions(theirs, ours), paths, unseen)).toEqual({ stack: ours, seen: listed });
    expect(ourStack(sessions(ours), paths, { listed: true, unlisted: 1 })).toEqual({ stack: ours, seen: listed });
  });

  it('takes the list of stacks to be the first list of objects', () => {
    expect(ourStack(JSON.stringify({ warnings: ['disk low'], sessions: [ours] }), paths, unseen)).toEqual({ stack: ours, seen: listed });
  });

  it('says nothing while ours hasn’t been listed yet', () => {
    expect(ourStack(sessions(theirs), paths, unseen)).toEqual({ stack: undefined, seen: unseen });
  });

  it('calls a listed stack gone once it’s missing from the list twice in a row', () => {
    const once = ourStack(sessions(theirs), paths, listed);
    expect(once).toEqual({ stack: undefined, seen: { listed: true, unlisted: 1 } });
    expect(ourStack(sessions(theirs), paths, once.seen)).toEqual({ stack: 'gone', seen: { listed: true, unlisted: 2 } });
  });

  it('leaves the count alone when the command printed nothing to read', () => {
    const missing = { listed: true, unlisted: 1 };
    expect(ourStack('connection refused', paths, missing)).toEqual({ stack: undefined, seen: missing });
  });
});

describe('resultChanges', () => {
  const starting: ResultSeen = { status: 'starting', links: [] };

  it('shows a new phase while starting', () => {
    expect(resultChanges({ phase: 'install' }, starting, true)).toEqual({ phase: 'install' });
    expect(resultChanges({ phase: 'install' }, { ...starting, phase: 'install' }, true)).toEqual({});
  });

  it('shows no phase once the stack is ready, or once the preview is past starting', () => {
    expect(resultChanges({ status: 'ready', phase: 'running' }, starting, true)).toEqual({});
    expect(resultChanges({ status: 'running', phase: 'serve' }, starting, true)).toEqual({});
    expect(resultChanges({ phase: 'build' }, { ...starting, status: 'running' }, true)).toEqual({});
  });

  it('takes only the phase from the progress command', () => {
    expect(resultChanges({ phase: 'build', urls: { web: 'http://localhost:3000' }, logs: '/tmp/logs' }, starting, true)).toEqual({ phase: 'build' });
  });

  it('takes named links and the logs folder from a result, when they changed', () => {
    const result = { status: 'ready', urls: { web: 'http://localhost:3000' }, logs: '/tmp/logs' };
    const links = [{ name: 'web', url: 'http://localhost:3000/' }];
    expect(resultChanges(result, starting, false)).toEqual({ links, logs: '/tmp/logs' });
    expect(resultChanges(result, { ...starting, links, logs: '/tmp/logs' }, false)).toEqual({});
  });

  it('keeps the links it has when a result names none', () => {
    expect(resultChanges({ status: 'ready' }, { ...starting, links: [{ url: 'http://localhost:3000/' }] }, false)).toEqual({});
  });
});
