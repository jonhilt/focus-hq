import { Effect, Layer, Schema } from 'effect';
import type { Issue } from '../../shared/types';
import { closingIssues, evidenceUrl, failedChecks, QA_EVIDENCE_BRANCH, rollupChecks } from './provider';
import { decodeJson, GhBadOutput, GhRunner } from './runner';
import { GitHub } from './service';

const Login = Schema.optional(Schema.NullOr(Schema.Struct({ login: Schema.String })));
const NumberAndUrl = Schema.Struct({ number: Schema.Number, url: Schema.String });
const Sha = Schema.Struct({ sha: Schema.String });

const RawIssue = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.String,
  labels: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
  author: Login,
  createdAt: Schema.String,
  comments: Schema.optional(Schema.Array(Schema.Struct({ author: Login, body: Schema.String }))),
});

/** What `getPullRequest` asks gh for. */
const RawPrDetail = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.String,
  headRefName: Schema.String,
  headRefOid: Schema.optional(Schema.String),
  baseRefName: Schema.String,
  author: Login,
  closingIssuesReferences: Schema.optional(Schema.Array(Schema.Struct({ number: Schema.Number }))),
});

const RawPr = Schema.Struct({
  ...RawPrDetail.fields,
  isDraft: Schema.Boolean,
  mergeable: Schema.optional(Schema.Literals(['MERGEABLE', 'CONFLICTING', 'UNKNOWN'])),
  reviewDecision: Schema.optional(Schema.NullOr(Schema.String)),
  statusCheckRollup: Schema.optional(Schema.Unknown),
  createdAt: Schema.String,
  updatedAt: Schema.optional(Schema.String),
});

const RawPastPr = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.String,
  headRefName: Schema.String,
  state: Schema.Literals(['OPEN', 'CLOSED', 'MERGED']),
  createdAt: Schema.String,
  closedAt: Schema.optional(Schema.NullOr(Schema.String)),
  comments: Schema.Array(Schema.Struct({ author: Login, body: Schema.String })),
});

const RawRepo = Schema.Struct({
  nameWithOwner: Schema.String,
  defaultBranchRef: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  url: Schema.String,
  description: Schema.NullOr(Schema.String),
  isEmpty: Schema.Boolean,
});

const ISSUE_FIELDS = 'number,title,body,url,labels,author,createdAt';
const PR_FIELDS = 'number,title,url,headRefName,headRefOid,baseRefName,author,isDraft,mergeable,reviewDecision,statusCheckRollup,createdAt,updatedAt,body,closingIssuesReferences';

function toIssue(repo: string, raw: typeof RawIssue.Type): Issue {
  return {
    repo,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    url: raw.url,
    labels: (raw.labels ?? []).map((l) => l.name),
    author: raw.author?.login,
    createdAt: raw.createdAt,
  };
}

/** Issues a PR closes: the ones GitHub links to it and the ones its body names. */
function linkedIssues(references: readonly { number: number }[] | undefined, body: string): number[] {
  return [...new Set([...(references ?? []).map((i) => i.number), ...closingIssues(body)])];
}

const lastLine = (out: string) => out.trim().split('\n').pop() ?? '';

/** Talks to GitHub through the `gh` CLI, so it uses whatever account `gh auth login` set up. */
const make = Effect.gen(function* () {
  const runner = yield* GhRunner;
  const gh = (args: string[], input?: string) => runner.run(args, input);
  const ghJson = <T>(schema: Schema.Decoder<T>, args: string[]) => gh(args).pipe(Effect.flatMap(decodeJson(schema, args)));
  /** A REST call with a JSON body on stdin (screenshots are too big for the command line). */
  const ghPost = <T>(schema: Schema.Decoder<T>, method: 'POST' | 'PUT', endpoint: string, body: unknown) => {
    const args = ['api', '-X', method, endpoint, '--input', '-'];
    return gh(args, JSON.stringify(body)).pipe(Effect.flatMap(decodeJson(schema, args)));
  };
  /** The number at the end of the URL gh prints after creating an issue or PR. */
  const created = (args: string[], input: string) =>
    gh(args, input).pipe(
      Effect.flatMap((out) => {
        const url = lastLine(out);
        const match = /\/(\d+)$/.exec(url);
        return match
          ? Effect.succeed({ number: Number(match[1]), url })
          : Effect.fail(new GhBadOutput({ args, output: out, reason: `no issue or PR number in "${url}"` }));
      }),
    );

  const repoInfo = (repo: string) =>
    ghJson(RawRepo, ['repo', 'view', repo, '--json', 'nameWithOwner,defaultBranchRef,url,description,isEmpty']).pipe(
      Effect.map((raw) => ({
        nameWithOwner: raw.nameWithOwner,
        defaultBranch: raw.defaultBranchRef?.name || 'main',
        url: raw.url,
        description: raw.description ?? '',
        isEmpty: raw.isEmpty,
      })),
    );

  /** Creates the QA evidence branch as an orphan (a root commit of its own) unless it's there already. */
  const evidenceBranch = Effect.fnUntraced(function* (repo: string) {
    const exists = gh(['api', `repos/${repo}/git/ref/heads/${QA_EVIDENCE_BRANCH}`]).pipe(Effect.as(true), Effect.orElseSucceed(() => false));
    if (yield* exists) return;
    const readme = `# QA evidence\n\nScreenshots the Focus QA officer took while testing pull requests, linked from their reports. This branch shares no history with the code and is never merged.\n`;
    const tree = yield* ghPost(Sha, 'POST', `repos/${repo}/git/trees`, { tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: readme }] });
    const commit = yield* ghPost(Sha, 'POST', `repos/${repo}/git/commits`, { message: 'Start the QA evidence branch', tree: tree.sha, parents: [] });
    yield* ghPost(Schema.Unknown, 'POST', `repos/${repo}/git/refs`, { ref: `refs/heads/${QA_EVIDENCE_BRANCH}`, sha: commit.sha }).pipe(
      // another room's QA officer may have just created it
      Effect.catch((err) => Effect.flatMap(exists, (there) => (there ? Effect.void : Effect.fail(err)))),
    );
  });

  return GitHub.of({
    status: gh(['api', 'user', '--jq', '.login']).pipe(
      Effect.map((out) => ({ ok: true, login: out.trim() })),
      Effect.catch((err) => Effect.succeed({ ok: false, error: `gh is not ready: ${err.message}. Install the GitHub CLI and run "gh auth login".` })),
    ),

    listRepos: gh(['repo', 'list', '--limit', '200', '--json', 'nameWithOwner', '--jq', '.[].nameWithOwner']).pipe(
      Effect.map((out) => out.split('\n').map((s) => s.trim()).filter(Boolean)),
    ),

    repoInfo,

    listIssues: (repo) =>
      ghJson(Schema.Array(RawIssue), ['issue', 'list', '-R', repo, '--state', 'open', '--limit', '100', '--json', ISSUE_FIELDS]).pipe(
        Effect.map((raw) => raw.map((i) => toIssue(repo, i))),
      ),

    getIssue: (repo, number) =>
      ghJson(RawIssue, ['issue', 'view', String(number), '-R', repo, '--json', `${ISSUE_FIELDS},comments`]).pipe(
        Effect.map((raw) => ({
          ...toIssue(repo, raw),
          comments: (raw.comments ?? []).map((c) => ({ author: c.author?.login ?? 'someone', body: c.body })),
        })),
      ),

    createIssue: (repo, title, body, labels = []) => {
      const args = ['issue', 'create', '-R', repo, '--title', title, '--body-file', '-'];
      for (const label of labels) args.push('--label', label);
      return created(args, body).pipe(Effect.map(({ number, url }) => ({ repo, number, title, body, url, labels, createdAt: new Date().toISOString() })));
    },

    listPullRequests: (repo) =>
      ghJson(Schema.Array(RawPr), ['pr', 'list', '-R', repo, '--state', 'open', '--limit', '100', '--json', PR_FIELDS]).pipe(
        Effect.map((raw) =>
          raw.map((p) => ({
            repo,
            number: p.number,
            title: p.title,
            url: p.url,
            branch: p.headRefName,
            headSha: p.headRefOid,
            baseBranch: p.baseRefName,
            author: p.author?.login,
            isDraft: p.isDraft,
            mergeable: p.mergeable ?? 'UNKNOWN',
            reviewDecision: p.reviewDecision || undefined,
            checks: rollupChecks(p.statusCheckRollup),
            failedChecks: failedChecks(p.statusCheckRollup),
            closes: linkedIssues(p.closingIssuesReferences, p.body ?? ''),
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
        ),
      ),

    pullRequestsFrom: (repo, prefix) =>
      ghJson(Schema.Array(RawPastPr), [
        'pr', 'list', '-R', repo, '--state', 'all', '--search', `head:${prefix}`, '--limit', '100',
        '--json', 'number,title,body,url,headRefName,state,createdAt,closedAt,comments',
      ]).pipe(
        Effect.map((raw) =>
          // the search matches words in the branch name loosely: keep only the branches that really start with it
          raw.filter((p) => p.headRefName.startsWith(prefix)).map((p) => ({
            number: p.number,
            title: p.title,
            body: p.body ?? '',
            url: p.url,
            branch: p.headRefName,
            state: p.state,
            createdAt: p.createdAt,
            closedAt: p.closedAt ?? undefined,
            comments: p.comments.map((c) => ({ author: c.author?.login ?? '', body: c.body })),
          })),
        ),
      ),

    pullRequestState: (repo, number) =>
      ghJson(Schema.Struct({ state: Schema.Literals(['OPEN', 'CLOSED', 'MERGED']) }), ['pr', 'view', String(number), '-R', repo, '--json', 'state']).pipe(
        Effect.map((raw) => raw.state),
      ),

    findPullRequest: (repo, branch) =>
      ghJson(Schema.Array(NumberAndUrl), ['pr', 'list', '-R', repo, '--head', branch, '--state', 'open', '--json', 'number,url']).pipe(
        Effect.map((raw) => raw[0] ?? null),
      ),

    getPullRequest: (repo, number) =>
      ghJson(RawPrDetail, ['pr', 'view', String(number), '-R', repo, '--json', 'number,title,body,url,headRefName,headRefOid,baseRefName,author,closingIssuesReferences']).pipe(
        Effect.map((raw) => ({
          number: raw.number,
          title: raw.title,
          body: raw.body ?? '',
          url: raw.url,
          branch: raw.headRefName,
          baseBranch: raw.baseRefName,
          headSha: raw.headRefOid ?? '',
          author: raw.author?.login,
          linkedIssues: linkedIssues(raw.closingIssuesReferences, raw.body ?? ''),
        })),
      ),

    commentOnPullRequest: (repo, number, body) => gh(['pr', 'comment', String(number), '-R', repo, '--body-file', '-'], body).pipe(Effect.map(lastLine)),

    uploadQaEvidence: (repo, path, bytes) =>
      evidenceBranch(repo).pipe(
        Effect.andThen(ghPost(Schema.Unknown, 'PUT', `repos/${repo}/contents/${path}`, {
          message: `QA evidence: ${path}`,
          content: bytes.toString('base64'),
          branch: QA_EVIDENCE_BRANCH,
        })),
        Effect.as(evidenceUrl(repo, path)),
      ),

    createPullRequest: (repo, pr) =>
      created(['pr', 'create', '-R', repo, '--head', pr.head, '--base', pr.base, '--title', pr.title, '--body-file', '-'], pr.body),

    mergePullRequest: (repo, number, method, headSha) =>
      gh(['pr', 'merge', String(number), '-R', repo, `--${method}`, '--delete-branch', ...(headSha ? ['--match-head-commit', headSha] : [])]).pipe(Effect.asVoid),

    rerunFailedRuns: (repo, runIds) => Effect.forEach(runIds, (id) => gh(['run', 'rerun', String(id), '--failed', '-R', repo]), { discard: true }),

    closePullRequest: (repo, number, comment) => gh(['pr', 'close', String(number), '-R', repo, '--comment', comment]).pipe(Effect.asVoid),

    pullRequestDiff: (repo, number) => gh(['pr', 'diff', String(number), '-R', repo]),


    createRepo: (name, opts) => {
      const full = opts.owner ? `${opts.owner}/${name}` : name;
      const args = ['repo', 'create', full, opts.private ? '--private' : '--public', '--add-readme'];
      if (opts.description) args.push('--description', opts.description);
      return gh(args).pipe(
        Effect.flatMap((out) => {
          const match = /github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(lastLine(out));
          return match ? Effect.succeed(match[1]) : repoInfo(full).pipe(Effect.map((info) => info.nameWithOwner));
        }),
      );
    },
  });
});

/** GitHub over whichever `GhRunner` it's given; tests hand it a fake one. */
export const ghCliService = Layer.effect(GitHub, make);

export const ghCliLayer = ghCliService.pipe(Layer.provide(GhRunner.layer));
