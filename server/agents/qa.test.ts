import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { QaReport } from '../../shared/types';
import type { PullRequestDetail } from '../github/provider';
import { diffAnchor, evidencePath, filesPrompt, filesSection, fixPrompt, keptCaptions, parseQaReport, QA_SCHEMA, qaAgentModel, qaComment, qaPlaybook, qaPrompt, qaSteps, qaSystemAppend, recordingPath, recordingSection, qaStamp, repoChecks, siblingList, openedFiles, toolCalls, postedAlready, verdictMark, MAX_SCREENSHOTS } from './qa';
import { mustOpen } from '../../shared/qa';
import { huntingSteps } from './qaProof';
import { CREW_DIR, crewFile, crewWith } from './crewFiles';
import { SCRATCH_RULE } from './scratch';
import { WAIT_RULE } from './wait';

const report = (r: Partial<QaReport> = {}): QaReport => ({
  verdict: 'pass',
  summary: 'Saving for later works and survives a reload.',
  checks: [{ name: 'Item moves to Saved for later', result: 'pass', details: 'Clicked "Save for later" on the cart' }],
  commands: [{ command: 'npm test', result: '42 passed' }],
  captions: [],
  ...r,
});

const pr: PullRequestDetail = {
  number: 12,
  title: 'Save items for later',
  body: 'Adds a saved-for-later list.\n\nCloses #7',
  url: 'https://github.com/acme/shop/pull/12',
  branch: 'focus/7-save-for-later-ab12',
  baseBranch: 'main',
  headSha: 'abc1234def5678',
  author: 'jon',
  linkedIssues: [7],
};

describe('parseQaReport', () => {
  it('takes the SDK’s structured output', () => {
    expect(parseQaReport(report())).toEqual(report());
  });

  it('falls back to the last fenced JSON in the final message', () => {
    const text = `Done.\n\n\`\`\`json\n{"verdict":"fail","summary":"old"}\n\`\`\`\n\nFinal:\n\`\`\`json\n${JSON.stringify(report({ verdict: 'fail', fixInstructions: 'Handle the empty cart' }))}\n\`\`\``;
    const parsed = parseQaReport(undefined, text);
    expect(parsed?.verdict).toBe('fail');
    expect(parsed?.summary).toBe(report().summary);
    expect(parsed?.fixInstructions).toBe('Handle the empty cart');
  });

  it('reads bare JSON too', () => {
    expect(parseQaReport(null, `Here you go: ${JSON.stringify(report())}`)?.verdict).toBe('pass');
  });

  it('gives up without a valid verdict', () => {
    expect(parseQaReport({ verdict: 'maybe', summary: 'hmm' })).toBeNull();
    expect(parseQaReport(undefined, 'I ran out of time.')).toBeNull();
    expect(parseQaReport(undefined, '{not json')).toBeNull();
    expect(parseQaReport(['pass'])).toBeNull();
  });

  it('cleans up loose fields', () => {
    const parsed = parseQaReport({ verdict: 'pass', checks: [{ name: ' A ', result: 'weird' }, null, 'x', ['B']], commands: 'nope', fixInstructions: 'ignored on a pass' });
    expect(parsed).toEqual({ verdict: 'pass', summary: '', checks: [{ name: 'A', result: 'pass', details: '' }], commands: [], fixInstructions: undefined, captions: [] });
  });

  it('reads the screenshot captions in order', () => {
    expect(parseQaReport({ verdict: 'pass', screenshots: [' Cart with 2 items ', 'Saved list', null] })?.captions).toEqual(['Cart with 2 items', 'Saved list', '']);
    expect(parseQaReport({ verdict: 'pass', screenshots: 'nope' })?.captions).toEqual([]);
  });
});

describe('keptCaptions', () => {
  it('pairs each caption with its screenshot', () => {
    expect(keptCaptions(['a', 'b'], 2, 2)).toEqual(['a', 'b']);
  });

  it('keeps the captions of the last screenshots when the early ones were dropped', () => {
    expect(keptCaptions(['1', '2', '3', '4'], 4, 2)).toEqual(['3', '4']);
  });

  it('numbers screenshots QA didn’t caption', () => {
    expect(keptCaptions(['first', ''], 5, 3)).toEqual(['Screenshot 3', 'Screenshot 4', 'Screenshot 5']);
    expect(keptCaptions(['first', ''], 3, 3)).toEqual(['first', 'Screenshot 2', 'Screenshot 3']);
  });

  it('is empty without screenshots', () => {
    expect(keptCaptions(['orphan caption'], 0, 0)).toEqual([]);
  });
});

describe('evidencePath', () => {
  it('gives each review round its own folder', () => {
    expect(evidencePath(12, 'abc1234def', 1700000000000, 0, 'jpg')).toBe('pr-12/abc1234-1700000000000/1.jpg');
    expect(evidencePath(12, undefined, 1700000000000, 2, 'svg')).toBe('pr-12/1700000000000/3.svg');
  });

  it('puts the recording of the browser beside the round’s screenshots', () => {
    expect(recordingPath(12, 'abc1234def', 1700000000000, 'mp4')).toBe('pr-12/abc1234-1700000000000/recording.mp4');
  });
});

describe('filesSection', () => {
  const files = [
    { file: 'server/gate.ts', tests: 'gate.test.ts', checked: 'Read every changed line' },
    { file: 'scripts/plant.ts', tests: 'none', checked: 'Read the | pipes' },
    { file: 'docs/qa.md', tests: 'none', checked: 'Read against the code' },
  ];
  const changed = ['server/gate.ts', 'scripts/plant.ts', 'docs/qa.md', 'shared/schema.json'];

  it('heads with code files opened by evidence, those with no test, those left out and the send-back, untested unopened code first', () => {
    const lines = filesSection(report({ files }), { changed, opened: ['server/gate.ts'], sentBack: 2 });
    expect(lines.slice(0, 4)).toEqual(['', '### 📂 Files reviewed', '', '**1 of 3** changed code files opened by QA (from its tool calls) · **2** code files with no test · **1** left out of QA\'s report · sent back once for 2 files']);
    expect(lines).toContain('<details open><summary>Each file</summary>');
    expect(lines.filter((l) => l.startsWith('| `'))).toEqual([
      '| `scripts/plant.ts` | ❌ | ⚠️ none | Read the \\| pipes |',
      '| `shared/schema.json` | ❌ | ⚠️ not in the report |   |',
      '| `server/gate.ts` | ✅ | gate.test.ts | Read every changed line |',
      '| `docs/qa.md` | – | none | Read against the code |',
    ]);
  });

  it('drops the opened column when Ops couldn’t read QA’s tool calls, and folds a long table away', () => {
    const many = Array.from({ length: 13 }, (_, i) => `src/f${i}.ts`);
    const lines = filesSection(report({ files }), { changed: many });
    expect(lines[3]).toBe('**13** changed files · **13** code files with no test · **13** left out of QA\'s report');
    expect(lines).toContain('<details><summary>Each file</summary>');
    expect(lines).toContain('| File | Tests | What QA checked |');
  });

  it('falls back on the report’s own files, and is nothing when there are none', () => {
    expect(filesSection(report({ files }), undefined)[3]).toBe('**3** changed files · **1** code files with no test');
    expect(filesSection(report(), undefined)).toEqual([]);
  });
});

describe('qaComment', () => {
  it('leads with the verdict, the tester and the commit', () => {
    const body = qaComment(report(), { officer: 'Lt. Varga', sha: 'abc1234def5678' }, [], true);
    expect(body.split('\n')[0]).toBe('## 🔍 QA report: ✅ Passed');
    expect(body).toContain('Lt. Varga');
    expect(body).toContain('`abc1234`');
    expect(body).toContain('| ✅ | Item moves to Saved for later |');
    expect(body).not.toContain('What needs fixing');
  });

  it('leaves out the officer and Focus when attribution is off, but keeps the commit', () => {
    const body = qaComment(report(), { officer: 'Lt. Varga', sha: 'abc1234def5678' }, [], false);
    expect(body.split('\n').slice(0, 2)).toEqual(['## 🔍 QA report: ✅ Passed', '**Tested at** commit `abc1234`']);
    expect(body).not.toContain('Lt. Varga');
    expect(body).not.toContain('Focus');
  });

  it('adds the fix instructions on a fail', () => {
    const body = qaComment(report({ verdict: 'fail', fixInstructions: 'Guard the empty cart in cart.ts' }), { officer: 'Lt. Varga' }, [], true);
    expect(body).toContain('❌ Failed');
    expect(body).toContain('### 🔧 What needs fixing\n\nGuard the empty cart in cart.ts');
  });

  it('keeps pipes and line breaks from breaking the table', () => {
    const body = qaComment(report({ checks: [{ name: 'a | b', result: 'fail', details: 'line 1\nline 2' }] }), { officer: 'X' }, [], true);
    expect(body).toContain('| ❌ | a \\| b | line 1<br>line 2 |');
  });

  it('embeds the screenshots in order, each under its caption', () => {
    const body = qaComment(report(), { officer: 'X' }, [
      { caption: 'Cart with 2 items', file: 'a.jpg', url: 'https://github.com/acme/shop/blob/focus-qa-evidence/pr-12/1/1.jpg?raw=true' },
      { caption: 'Saved [for] later', file: 'b.jpg', url: 'https://github.com/acme/shop/blob/focus-qa-evidence/pr-12/1/2.jpg?raw=true' },
    ], true);
    expect(body).toContain('### 📸 Screenshots');
    const first = body.indexOf('**1. Cart with 2 items**\n\n![Cart with 2 items](https://github.com/acme/shop/blob/focus-qa-evidence/pr-12/1/1.jpg?raw=true)');
    const second = body.indexOf('**2. Saved [for] later**\n\n![Saved for later](https://github.com/acme/shop/blob/focus-qa-evidence/pr-12/1/2.jpg?raw=true)');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it('puts the per-file account after the spot-checks, before the screenshots', () => {
    const body = qaComment(report({ files: [{ file: 'a.ts', tests: 'a.test.ts', checked: 'read it' }] }), { officer: 'X' }, [], true, { changed: ['a.ts'], opened: ['a.ts'] });
    expect(body.indexOf('### 📂 Files reviewed')).toBeGreaterThan(-1);
    expect(body.indexOf('### 📂 Files reviewed')).toBeLessThan(body.indexOf('### 📸 Screenshots'));
  });

  it('says so when the review has no screenshots', () => {
    expect(qaComment(report(), { officer: 'X' }, [], true)).toContain('### 📸 Screenshots\n\nNo screenshots were taken during this review.');
  });

  it('shows the recording of the browser as a GIF that links to its MP4, and says how it was edited', () => {
    const recording = { mp4Url: 'https://x/recording.mp4', gifUrl: 'https://x/recording.gif', realSeconds: 312, shownSeconds: 48, actions: 14 };
    const body = qaComment(report(), { officer: 'X' }, [], true, undefined, recording);
    expect(body).toContain("### 🎬 Recording\n\n[![QA's browser session](https://x/recording.gif)](https://x/recording.mp4)");
    expect(body).toContain('The session took 5:12; the clip shows it in 0:48. Each of its 14 browser actions plays at real speed');
    expect(body).toContain('fast-forwarded (marked ⏩), never cut');
    expect(body.indexOf('🎬 Recording')).toBeLessThan(body.indexOf('📸 Screenshots'));
  });

  it('links the MP4 alone when there’s no GIF of it, and has no recording section without a recording', () => {
    const section = recordingSection({ mp4Url: 'https://x/recording.mp4', realSeconds: 60, shownSeconds: 20, actions: 1 }).join('\n');
    expect(section).not.toContain('![');
    expect(section).toContain('Each of its 1 browser action plays');
    expect(section).toContain('[Watch the MP4](https://x/recording.mp4)');
    expect(qaComment(report(), { officer: 'X' }, [], true)).not.toContain('Recording');
  });

  it('keeps the caption but leaves out an image that failed to upload', () => {
    const body = qaComment(report(), { officer: 'X' }, [{ caption: 'Empty cart', file: 'a.jpg' }], true);
    expect(body).toContain('**1. Empty cart**\n\n_The image couldn\'t be uploaded._');
    expect(body).not.toContain('![');
    expect(body).not.toContain('No screenshots');
  });
});

describe('QA instructions', () => {
  it('include the project’s QA brief only when there is one', () => {
    expect(qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop', qaBrief: '- Check the phone layout' }, pr, pr.headSha)).toContain('- Check the phone layout');
    expect(qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha)).not.toContain('from the manager');
  });

  it('keep the brief’s ship words out of the report', () => {
    const text = qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop', qaBrief: '- Tell the captain if the layout breaks' }, pr, pr.headSha);
    expect(text).toContain('your report says "the maintainer" or "the reviewer" instead');
  });

  it('ask QA to read the changed lines no test exercises, since a green suite says nothing about them', () => {
    const text = qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha);
    expect(text).toContain('go through every file the diff changes (`git diff --stat origin/main...HEAD` lists them all: however many there are, don\'t pick a few)');
    expect(text).toContain('Read each of those files\' changed lines one by one');
    expect(text).toContain('an argument or index read from the wrong place');
  });

  it('tell QA its browser is recorded only when the project records it', () => {
    expect(qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop', qaVideo: true }, pr, pr.headSha)).toContain('Your browser is recorded');
    expect(qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha)).not.toContain('Your browser is recorded');
  });

  it('ask QA to look for tests that only raise coverage', () => {
    expect(qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha)).toContain('new tests that run code without checking what it does');
  });

  it('number the steps the Playbook lists, word for word as QA has always had them', () => {
    const text = qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, { ...pr, baseBranch: 'develop' }, pr.headSha);
    const steps = qaSteps('develop');
    expect(text).toContain(`How to test:\n${steps.map((s, i) => `${i + 1}. ${s.text}`).join('\n')}\n`);
    // the section as it read before the steps were a list
    expect(text).toContain(`How to test:
1. Read the PR description and the linked issue, and work out the acceptance criteria. Check every one.
2. Review the code as a careful reviewer would: \`git diff origin/develop...HEAD\`. Look for bugs, unhandled errors and edge cases, security problems, leftover debug code, new logic without tests, and new tests that run code without checking what it does (they raise coverage but catch nothing).
3. Install dependencies if needed, then run the project's test suite, linters, type checks and build (whichever exist).
4. Then go through every file the diff changes (\`git diff --stat origin/develop...HEAD\` lists them all: however many there are, don't pick a few), and find those whose changes no test exercises. Scripts, schemas, prompts and config often aren't tested, and a coverage report may not reach them. Read each of those files' changed lines one by one: a green suite says nothing about them, and they're where bugs get through. For each line, ask what input or state makes it wrong: a comparison off by one, a condition or guard the wrong way round, an argument or index read from the wrong place, a flag, default or schema setting flipped. A real bug there fails the PR like any other: name its file and line. Your report's files lists every changed file, none left out: the tests that exercise it (or none) and what you checked.
5. If the change touches a web UI, start its dev server in the background and exercise the change with the mcp__browser__ tools: click through it, try the edge cases, and check the console for errors. Stop the server afterwards.
   Call mcp__browser__screenshot on each state that shows the change working or failing: the last ${MAX_SCREENSHOTS} go on the pull request with your report, each with the caption you give it.
6. You may write throwaway scripts to probe behaviour, but don't commit them. ${SCRATCH_RULE} ${WAIT_RULE}
`);
  });

  it('name the repo’s checks when Ops knows them, else leave QA to work them out', () => {
    const named = qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha, [], ['pnpm run typecheck', 'pnpm test']);
    expect(named).toContain("3. Install dependencies if needed, then run these checks: `pnpm run typecheck`, `pnpm test`, and anything else the repo's CLAUDE.md asks.");
    expect(qaSteps('main', [])[2].text).toContain('(whichever exist)');
  });

  it('build proof mode’s section from its steps', () => {
    const [hunt, probe, proof] = huntingSteps();
    const text = qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha);
    expect(text).toContain(`\n\n## Hunting the bugs that get past review\n\n${hunt.text}\n\n${probe.text}\n\n## Fail only with proof\n\n${proof.text}\n\nRules:`);
  });

  it('diff against the PR’s base and name the commit under test', () => {
    const text = qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, { ...pr, baseBranch: 'develop' }, pr.headSha);
    expect(text).toContain('git diff origin/develop...HEAD');
    expect(text).toContain('commit abc1234');
  });

  it('hand over the linked issues, or say there are none', () => {
    const issue = { repo: 'acme/shop', number: 7, title: 'Save for later', body: '- [ ] survives a reload', url: '', labels: [], createdAt: '', comments: [] };
    expect(qaPrompt('acme/shop', pr, [issue])).toContain('Linked issue #7: Save for later\n- [ ] survives a reload');
    expect(qaPrompt('acme/shop', pr, [])).toContain('No linked issue');
  });
});

const failed = report({
  verdict: 'fail',
  summary: 'The cart breaks when it is empty.',
  checks: [
    { name: 'Saves for later', result: 'pass', details: 'ok' },
    { name: 'Empty cart', result: 'fail', details: 'Page goes blank' },
  ],
  fixInstructions: 'Guard the empty cart in cart.ts',
});

describe('re-test', () => {
  it('tells QA last round’s findings and diffs from the commit it tested', () => {
    const text = qaPrompt('acme/shop', pr, [], { lastRound: { sha: 'fed9876543', report: failed } });
    expect(text).toContain('Last round you failed it at commit fed9876');
    expect(text).toContain('- Empty cart: Page goes blank');
    expect(text).not.toContain('- Saves for later');
    expect(text).toContain('Guard the empty cart in cart.ts');
    expect(text).toContain('`git diff fed9876..HEAD`');
    expect(text).toContain('smoke test');
  });

  it('lists last round’s failed and skipped checks with their details, not just its summary', () => {
    const notes = report({
      verdict: 'fail',
      summary: 'Two problems are noted below.',
      checks: [
        { name: 'Saves for later', result: 'pass', details: 'ok' },
        { name: 'Empty cart', result: 'fail', details: 'Page goes blank' },
        { name: 'Phone layout', result: 'skip', details: 'No mobile viewport available' },
      ],
      fixInstructions: 'Guard the empty cart in cart.ts',
    });
    const text = qaPrompt('acme/shop', pr, [], { lastRound: { sha: 'fed9876543', report: notes } });
    expect(text).toContain('Failed checks:\n- Empty cart: Page goes blank');
    expect(text).toContain('Skipped checks:\n- Phone layout: No mobile viewport available');
    expect(text).toContain('What needs fixing:\nGuard the empty cart in cart.ts');
    expect(text).not.toContain('Saves for later');
  });

  it('passes on why the operations officer sent it back to QA', () => {
    expect(qaPrompt('acme/shop', pr, [], { retryNote: 'Lt. Haddad sent it back: QA ran the old build.' })).toContain('Lt. Haddad sent it back: QA ran the old build.');
  });

  it('is a full review the first time round', () => {
    expect(qaPrompt('acme/shop', pr, [])).not.toContain('re-test');
  });
});

describe('fixPrompt', () => {
  it('hands the developer QA’s summary, failed checks and fix instructions', () => {
    const text = fixPrompt(pr, { sha: 'fed9876543', report: failed });
    expect(text.split('\n')[0]).toBe('QA failed pull request #12 (commit fed9876) and sent it back to you. Please fix it.');
    expect(text).toContain('The cart breaks when it is empty.');
    expect(text).toContain('- Empty cart: Page goes blank');
    expect(text).toContain('What needs fixing:\nGuard the empty cart in cart.ts');
    expect(text).toContain('`focus/7-save-for-later-ab12`');
    expect(text).toContain('Ops pushes your commits');
  });

  it('tells a developer fixing a goal’s pull request what the goal is for, and to leave its calls to the lead', () => {
    const text = fixPrompt(pr, { sha: 'fed9876543', report: failed }, { title: 'Save for later', brief: 'Let shoppers park items', lead: 'Lt. Okafor' });
    expect(text).toContain('#12 is part of a goal Lt. Okafor leads: "Save for later".');
    expect(text).toContain('Let shoppers park items');
    expect(text).toContain('commit nothing and say why, and it goes back to Lt. Okafor');
    expect(fixPrompt(pr, { sha: 'fed9876543', report: failed })).not.toContain('part of a goal');
  });
});

describe('repoChecks', () => {
  const facts = { packageJson: true, scripts: { typecheck: 'tsc', lint: 'eslint .', test: 'vitest run' }, lockfiles: ['pnpm-lock.yaml'], claudeMd: true };

  it('turns the project’s merge checks the repo has into commands for its package manager', () => {
    expect(repoChecks('acme/shop', facts)).toEqual({ repo: 'acme/shop', cloned: true, packageJson: true, claudeMd: true, commands: ['pnpm run typecheck', 'pnpm run lint', 'pnpm test'] });
    expect(repoChecks('acme/shop', facts, ['test']).commands).toEqual(['pnpm test']);
  });

  it('has none for a repo without a clone or a package.json', () => {
    expect(repoChecks('acme/shop', undefined)).toEqual({ repo: 'acme/shop', cloned: false, packageJson: false, claudeMd: false, commands: [] });
    expect(repoChecks('acme/shop', { packageJson: false, lockfiles: [], claudeMd: false }).commands).toEqual([]);
  });
});

describe('qaPlaybook', () => {
  const repos = [repoChecks('acme/shop', { packageJson: true, scripts: { lint: 'eslint .' }, lockfiles: [], claudeMd: false })];

  it('lists the steps QA gets, proof mode’s only when it’s on', () => {
    const on = qaPlaybook('Lt. Q', { name: 'Shop', repos: ['acme/shop'] }, repos);
    expect(on.steps.map((s) => s.title)).toEqual([...qaSteps('main').map((s) => s.title), ...huntingSteps().map((s) => s.title)]);
    expect(qaPlaybook('Lt. Q', { name: 'Shop', repos: ['acme/shop'], qaProof: false }, repos).steps).toHaveLength(qaSteps('main').length);
  });

  it('shows QA’s whole instructions for an example pull request, with the first repo’s checks', () => {
    const playbook = qaPlaybook('Lt. Q', { name: 'Shop', repos: ['acme/shop'], qaBrief: 'Works at phone width' }, repos);
    expect(playbook.prompt).toContain('Pull request #123 "Example PR", branch `feature` into `main`: https://github.com/acme/shop/pull/123');
    expect(playbook.prompt).toContain('run these checks: `npm run lint`');
    expect(playbook.prompt).toContain('Works at phone width');
    for (const step of playbook.steps) expect(playbook.prompt).toContain(step.text);
  });
});

describe('qaAgentModel', () => {
  it("uses Focus's own model when no QA model is set", () => {
    expect(qaAgentModel({ model: 'claude-opus-5-5', qaModel: '' })).toBe('claude-opus-5-5');
  });

  it('prefers the QA model', () => {
    expect(qaAgentModel({ model: 'claude-opus-5-5', qaModel: ' claude-sonnet-5-5 ' })).toBe('claude-sonnet-5-5');
  });

  it("leaves it to Claude Code's default when neither is set", () => {
    expect(qaAgentModel({ model: '', qaModel: '' })).toBeUndefined();
  });
});

describe('spot-checks', () => {
  it('reads QA’s picks, keeping at most three and dropping ones without a file or a why', () => {
    const parsed = parseQaReport({
      verdict: 'pass', summary: 'ok', checks: [], commands: [],
      spotChecks: [
        { file: ' server/merge.ts ', line: 41, why: ' New merge path ' },
        { file: 'client/a.ts', line: -3, why: 'Bad line' },
        { file: '', why: 'No file' },
        { file: 'b.ts', why: 'Third' },
        { file: 'c.ts', why: 'Fourth' },
      ],
    });
    expect(parsed?.spotChecks).toEqual([
      { file: 'server/merge.ts', line: 41, why: 'New merge path', anchor: diffAnchor('server/merge.ts', 41) },
      { file: 'client/a.ts', why: 'Bad line', anchor: diffAnchor('client/a.ts') },
      { file: 'b.ts', why: 'Third', anchor: diffAnchor('b.ts') },
    ]);
    expect(parseQaReport({ verdict: 'pass', summary: 'ok', checks: [], commands: [] })).not.toHaveProperty('spotChecks');
  });

  it('finds each one in the pull request’s changed files on GitHub: the SHA-256 of its path, then its line', () => {
    // GitHub's own anchor for octocat/Hello-World#1's README, read off its changed files page
    expect(diffAnchor('README')).toBe('diff-2b7814d3fca2e99e56c51b6ff2aa313ea6e9da6424804240aa8ad891fdfe0900');
    expect(diffAnchor('README', 12)).toBe('diff-2b7814d3fca2e99e56c51b6ff2aa313ea6e9da6424804240aa8ad891fdfe0900R12');
    // a path QA wrote from the repo's root another way is the same file
    expect(diffAnchor('./README')).toBe(diffAnchor('README'));
  });

  it('links each to its file and line on the pull request, when it knows the pull request', () => {
    const check = { file: 'server/merge.ts', line: 41, why: 'New merge path', anchor: diffAnchor('server/merge.ts', 41) };
    const body = qaComment(report({ spotChecks: [check] }), { officer: 'Lt. Moreau', pr: 'https://github.com/acme/shop/pull/9' }, [], false);
    expect(body).toContain(`- [\`server/merge.ts:41\`](https://github.com/acme/shop/pull/9/files#${check.anchor}): New merge path`);
  });

  it('lists them on the pull request for a human look', () => {
    const body = qaComment(report({ spotChecks: [{ file: 'server/merge.ts', line: 41, why: 'New merge path' }, { file: 'b.ts', why: 'Gate changed' }] }), { officer: 'Lt. Moreau' }, [], false);
    expect(body).toContain('### 🔦 Worth a human look\n\n- `server/merge.ts:41`: New merge path\n- `b.ts`: Gate changed');
    expect(qaComment(report(), { officer: 'Lt. Moreau' }, [], false)).not.toContain('Worth a human look');
  });
});

describe('what a QA verdict is stamped with', () => {
  it('is QA’s crew file’s digest, the model and effort QA was seated on, and Focus’s commit', () => {
    expect(qaStamp({ model: 'claude-opus-5-5', effort: 'high' }, 'abc1234')).toEqual({ digest: crewFile('qa').digest, model: 'claude-opus-5-5', effort: 'high', commit: 'abc1234' });
    // the session's defaults leave them out
    expect(qaStamp({}, 'abc1234')).toEqual({ digest: crewFile('qa').digest, commit: 'abc1234' });
  });
});

describe('QA told by a candidate’s qa.md, for a benchmark to compare', () => {
  const qa = fs.readFileSync(path.join(CREW_DIR, 'qa.md'), 'utf8');
  const candidate = () => crewWith(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-candidate-')), 'qa', qa.replace('QA officer for {{project}}', 'reviewer for {{project}}').replace('Hunts the bugs that get past review', 'Hunts the bugs review misses'), 'qa.md at candidate');

  it('gets the candidate’s words in its instructions, steps and hunting steps, and Focus’s own QA keeps its own', () => {
    const crew = candidate();
    expect(qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha, [], [], crew)).toContain('# You are Lt. Varga, reviewer for Shop');
    expect(qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha)).toContain('# You are Lt. Varga, QA officer for Shop');
    expect(huntingSteps(crew)[0]?.title).toBe('Hunts the bugs review misses');
    expect(huntingSteps()[0]?.title).toBe('Hunts the bugs that get past review');
    expect(qaSteps('main', [], false, crew)).toEqual(qaSteps('main'));
  });

  it('is stamped with the candidate’s digest', () => {
    const crew = candidate();
    expect(qaStamp({}, 'abc1234', crew).digest).toBe(crew.file('qa').digest);
    expect(qaStamp({}, 'abc1234', crew).digest).not.toBe(crewFile('qa').digest);
  });

  it('names the candidate when its qa.md doesn’t load', () => {
    expect(() => crewWith(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-candidate-')), 'qa', qa.replace('{{project}} aboard', '{{projcet}} aboard'), 'qa.md at focus/typo')).toThrow(
      /^qa\.md at focus\/typo:65: \{\{projcet\}\} isn't something this role's prompt can refer to/,
    );
  });
});

describe('the slice’s other pull requests', () => {
  it('says nothing of them for a PR tested on its own', () => {
    expect(siblingList([])).toBe('');
    expect(qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha)).not.toContain('one of a slice');
  });

  it('points QA at the slice’s other PRs beside them, and keeps the verdict on their own PR', () => {
    const text = qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha, [
      { repo: 'acme/web', number: 40, folder: 'web', sha: 'abcdef1234' },
      { repo: 'acme/docs', number: 3, folder: 'docs', error: 'no such ref' },
    ]);
    expect(text).toContain('- `../web`: acme/web#40, head abcdef1, detached');
    expect(text).toContain("- acme/docs#3: couldn't be checked out (no such ref)");
    expect(text).toContain('Your verdict is on this PR only');
  });
});

describe('every changed file, accounted for', () => {
  it('asks for the files in the report, and names them in the prompt', () => {
    expect((QA_SCHEMA as { required: string[] }).required).toContain('files');
    const prompt = qaPrompt('acme/shop', pr, [], {}, ['src/cart.ts', 'scripts/sync.ts']);
    expect(prompt).toContain("The files it changes (2): your report's files accounts for every one.\n- src/cart.ts\n- scripts/sync.ts");
    expect(qaPrompt('acme/shop', pr, [])).not.toContain('The files it changes');
    const many = Array.from({ length: 205 }, (_, i) => `f${i}.ts`);
    expect(qaPrompt('acme/shop', pr, [], {}, many)).toContain('- …and 5 more (`git diff --name-only` lists them)');
  });

  it('sends QA back to the files it left out, or says it only skimmed, to report again in full', () => {
    const text = filesPrompt({ missing: ['scripts/sync.ts', 'schema.json'], unread: [], unopened: [] });
    expect(text).toMatch(/^Your report leaves out 2 of the files this pull request changes:\n- scripts\/sync\.ts\n- schema\.json\n/);
    expect(text).toContain('give your whole report again, every file in it');
    expect(filesPrompt({ missing: [], unread: ['server/crew.ts'], unopened: [] })).toMatch(/^Your report says you only skimmed, or didn't read, this file:\n- server\/crew\.ts\n\nReview each properly/);
    expect(filesPrompt({ missing: ['a.ts'], unread: ['b.ts', 'c.ts'], unopened: [] })).toContain('- a.ts\n\nYour report says you only skimmed, or didn\'t read, these 2 files:\n- b.ts\n- c.ts');
    expect(filesPrompt({ missing: [], unread: [], unopened: ['server/crew.ts'] })).toMatch(/^Your session never opened this file, whatever your report says about it:\n- server\/crew\.ts\n\nReview each properly/);
  });
});

describe('what QA actually opened', () => {
  const changed = ['server/crew.ts', 'shared/types.ts', 'scripts/sync.ts'];
  const bash = (command: string) => ({ name: 'Bash', input: { command } });
  it('counts a file read, or printed whole, and not one only listed, grepped or cut short', () => {
    expect([...openedFiles([{ name: 'Read', input: { file_path: '/tmp/clone/server/crew.ts' } }], changed)]).toEqual(['server/crew.ts']);
    expect([...openedFiles([bash('git diff origin/main...HEAD -- shared/types.ts scripts/sync.ts')], changed)]).toEqual(['shared/types.ts', 'scripts/sync.ts']);
    expect([...openedFiles([bash('sed -n 1,400p server/crew.ts')], changed)]).toEqual(['server/crew.ts']);
    expect(openedFiles([bash('git diff origin/main...HEAD -- server/crew.ts | head -250'), bash('grep -n tools server/crew.ts'), bash('git diff --stat origin/main...HEAD')], changed).size).toBe(0);
  });

  it('counts a whole diff of the pull request, not cut short, as opening every file', () => {
    expect(openedFiles([bash('git diff origin/main...HEAD')], changed).size).toBe(3);
    expect(openedFiles([bash('git diff origin/main...HEAD | head -400')], changed).size).toBe(0);
  });

  it('reads the tool calls from a transcript, and asks for code files only', () => {
    const jsonl = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }),
    ].join('\n');
    expect(toolCalls(jsonl)).toEqual([{ name: 'Read', input: { file_path: 'a.ts' } }]);
    const odd = (input: unknown) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input }] } });
    expect(toolCalls([odd('ls'), odd(['ls']), odd(null)].join('\n')).map((c) => c.input)).toEqual([{}, {}, {}]);
    expect(['server/crew.ts', 'config/app.yml', 'package.json'].every(mustOpen)).toBe(true);
    expect(['server/crew.test.ts', 'docs/qa.md', 'pnpm-lock.yaml', 'client/public/deck.glb'].some(mustOpen)).toBe(false);
  });
});

describe('a verdict’s mark', () => {
  const body = `## ✅ QA passed${verdictMark('verdict_a1b2c')}`;

  it('finds the very verdict among the pull request’s comments', () => {
    expect(postedAlready(['Looks good', `## ✅ QA passed\n\n<!-- focus-qa-verdict verdict_a1b2c -->`], body)).toBe(true);
  });

  it('doesn’t take another verdict on the same pull request for this one', () => {
    expect(postedAlready([`## ❌ QA failed${verdictMark('verdict_0ld00')}`], body)).toBe(false);
  });

  it('never says a verdict without a mark went up: posting it again beats losing it', () => {
    expect(postedAlready(['## ✅ QA passed'], '## ✅ QA passed')).toBe(false);
  });

  it('hides the mark from whoever reads the comment', () => {
    expect(verdictMark('verdict_a1b2c')).toMatch(/^\n\n<!-- .* -->$/);
  });
});

describe('proof', () => {
  const held = { kind: 'test' as const, finding: 'Loses the saved list on reload', file: 'src/saved.proof.test.ts', command: 'pnpm vitest run src/saved.proof.test.ts', outcome: 'failed' as const, note: 'AssertionError: expected [] to have length 1', source: 'it("keeps it")' };

  it('asks for proofs in the report, and reads them', () => {
    expect(QA_SCHEMA.properties).toHaveProperty('proofs');
    expect(parseQaReport({ ...report({ verdict: 'fail' }), proofs: [{ kind: 'check', finding: 'Doesn’t type-check', command: 'pnpm run typecheck' }] })?.proofs).toEqual([{ kind: 'check', finding: 'Doesn’t type-check', command: 'pnpm run typecheck' }]);
    expect(parseQaReport(report())?.proofs).toBeUndefined();
  });

  it('tells QA to hunt and to fail only with proof, unless the project doesn’t ask for it', () => {
    const on = qaSystemAppend({ name: 'Lt. Q' }, { name: 'Shop' }, pr, pr.headSha);
    expect(on).toContain('Hunting the bugs that get past review');
    expect(on).toContain('Fail only with proof');
    expect(on).toContain('and only with proof (below)');
    const off = qaSystemAppend({ name: 'Lt. Q' }, { name: 'Shop', qaProof: false }, pr, pr.headSha);
    expect(off).not.toContain('Fail only with proof');
    expect(off).not.toContain('Hunting');
  });

  it('shows a blocking fail’s proof on the comment, with what Ops saw', () => {
    const body = qaComment(report({ verdict: 'fail', fixInstructions: 'Persist the list.', proofs: [held, { kind: 'test', finding: 'Double save', file: 'b.proof.test.ts', command: 'vitest run b.proof.test.ts', outcome: 'broken', note: 'it ran no tests' }] }), { officer: 'Lt. Q' }, [], false);
    expect(body).toContain('QA report: ❌ Failed');
    expect(body).toContain('### 🧪 Proof');
    expect(body).toContain('| ❌ | Loses the saved list on reload | test: `src/saved.proof.test.ts` with `pnpm vitest run src/saved.proof.test.ts` | fails: AssertionError: expected [] to have length 1 |');
    expect(body).toContain('| ⚠️ | Double save | test: `b.proof.test.ts` with `vitest run b.proof.test.ts` | not proof: it ran no tests |');
    expect(body).toContain('### 🔧 What needs fixing');
  });

  it('heads a fail without proof that held as a pass with advice, its findings as advice', () => {
    const body = qaComment(report({ verdict: 'pass', advisory: true, fixInstructions: 'Persist the list.', proofs: [{ ...held, outcome: 'passed', note: undefined, source: undefined }] }), { officer: 'Lt. Q' }, [], false);
    expect(body).toContain('QA report: ✅ Passed with advice');
    expect(body).toContain('none came with proof that held');
    expect(body).toContain('passed when Focus ran it');
    expect(body).toContain('### 💡 Advice (not proved)\n\nPersist the list.');
    expect(body).not.toContain('What needs fixing');
  });

  it('hands the developer the proof tests to keep, and the re-test the proof that held', () => {
    const failed = report({ verdict: 'fail', fixInstructions: 'Persist the list.', proofs: [held] });
    const fix = fixPrompt({ number: 12, branch: pr.branch }, { sha: 'abc1234', report: failed });
    expect(fix).toContain('it("keeps it")');
    expect(fix).toContain('drop the `.proof`');
    const retest = qaPrompt('acme/shop', pr, [], { lastRound: { sha: 'abc1234', report: failed } });
    expect(retest).toContain('Proof that held');
    expect(retest).toContain('`src/saved.proof.test.ts` with `pnpm vitest run src/saved.proof.test.ts`');
  });

  it('tells a re-test that last round’s fail went up as advice', () => {
    const retest = qaPrompt('acme/shop', pr, [], { lastRound: { sha: 'abc1234', report: report({ verdict: 'pass', advisory: true, fixInstructions: 'Persist the list.' }) } });
    expect(retest).toContain('failed it without proof that held, so it went up as a pass with advice');
    expect(retest).toContain('Advice (no proof held');
  });
});
