import { describe, expect, it } from 'vitest';
import type { QaReport } from '../../shared/types';
import type { PullRequestDetail } from '../github/provider';
import { diffAnchor, evidencePath, filesPrompt, filesSection, fixPrompt, keptCaptions, parseQaReport, QA_SCHEMA, qaAgentModel, qaComment, qaPrompt, qaSystemAppend, siblingsSection, skimmed, unaccounted, filesToRevisit, openedFiles, toolCalls } from './qa';
import { mustOpen } from '../../shared/qa';

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
  });

  it('cleans up loose fields', () => {
    const parsed = parseQaReport({ verdict: 'pass', checks: [{ name: ' A ', result: 'weird' }, null, 'x'], commands: 'nope', fixInstructions: 'ignored on a pass' });
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

  it('drops the opened column when the office couldn’t read QA’s tool calls, and folds a long table away', () => {
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

  it('ask QA to read the changed lines no test exercises, since a green suite says nothing about them', () => {
    const text = qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha);
    expect(text).toContain('go through every file the diff changes (`git diff --stat origin/main...HEAD` lists them all: however many there are, don\'t pick a few)');
    expect(text).toContain('Read each of those files\' changed lines one by one');
    expect(text).toContain('an argument or index read from the wrong place');
  });

  it('ask QA to look for tests that only raise coverage', () => {
    expect(qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha)).toContain('new tests that run code without checking what it does');
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
    expect(text).toContain('The office pushes your commits');
  });

  it('has a cloud developer push the fix themselves', () => {
    const text = fixPrompt(pr, { sha: 'fed9876543', report: failed }, true);
    expect(text).toContain('git push origin HEAD:focus/7-save-for-later-ab12');
    expect(text).not.toContain('The office pushes');
  });
});

describe('qaAgentModel', () => {
  it("uses the office's model when no QA model is set", () => {
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

describe('siblingsSection', () => {
  it('says nothing for a PR tested on its own', () => {
    expect(siblingsSection([])).toBe('');
  });

  it('points QA at the slice’s other PRs beside them, and keeps the verdict on their own PR', () => {
    const text = siblingsSection([
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

  it('reads the report’s files, and finds the changed ones it leaves out', () => {
    const parsed = parseQaReport({ verdict: 'pass', summary: '', checks: [], commands: [], files: [{ file: './src/cart.ts', tests: 'cart.test.ts', checked: 'read' }, { tests: 'none' }] });
    expect(parsed?.files).toEqual([{ file: './src/cart.ts', tests: 'cart.test.ts', checked: 'read' }]);
    expect(parsed && unaccounted(parsed, ['src/cart.ts', 'scripts/sync.ts', 'web/src/cart.ts'])).toEqual(['scripts/sync.ts']);
    expect(parseQaReport({ verdict: 'pass', summary: '', checks: [], commands: [] })?.files).toBeUndefined();
  });

  it('sends QA back to the files it left out, or says it only skimmed, to report again in full', () => {
    const text = filesPrompt({ missing: ['scripts/sync.ts', 'schema.json'], unread: [], unopened: [] });
    expect(text).toMatch(/^Your report leaves out 2 of the files this pull request changes:\n- scripts\/sync\.ts\n- schema\.json\n/);
    expect(text).toContain('give your whole report again, every file in it');
    expect(filesPrompt({ missing: [], unread: ['server/crew.ts'], unopened: [] })).toMatch(/^Your report says you only skimmed, or didn't read, this file:\n- server\/crew\.ts\n\nReview each properly/);
    expect(filesPrompt({ missing: ['a.ts'], unread: ['b.ts', 'c.ts'], unopened: [] })).toContain('- a.ts\n\nYour report says you only skimmed, or didn\'t read, these 2 files:\n- b.ts\n- c.ts');
    expect(filesPrompt({ missing: [], unread: [], unopened: ['server/crew.ts'] })).toMatch(/^Your session never opened this file, whatever your report says about it:\n- server\/crew\.ts\n\nReview each properly/);
  });

  it('takes QA at its word on the files it only skimmed or didn’t read', () => {
    const file = (f: string, checked: string) => ({ file: f, tests: 'none', checked });
    const report = parseQaReport({ verdict: 'pass', summary: '', checks: [], commands: [], files: [file('a.ts', 'Scene tools; skimmed.'), file('b.ts', 'Read every changed line'), file('c.ts', "Didn't read: generated"), file('d.ts', 'glanced at the diff'), file('e.ts', 'Not reviewed in depth')] });
    expect(report && skimmed(report)).toEqual(['a.ts', 'c.ts', 'd.ts', 'e.ts']);
  });
});

describe('filesToRevisit', () => {
  const report = parseQaReport({ verdict: 'pass', summary: '', checks: [], commands: [], files: [{ file: 'a.ts', tests: 'none', checked: 'skimmed' }, { file: 'b.ts', tests: 'none', checked: 'read every line' }] });
  it('names what to go back to once a review, and nothing when there’s nothing or it was asked already', () => {
    if (!report) throw new Error('no report');
    expect(filesToRevisit(report, { changed: ['a.ts', 'b.ts', 'c.ts'], askedAgain: false })).toEqual({ missing: ['c.ts'], unread: ['a.ts'], unopened: [] });
    // the evidence: b.ts was never opened, whatever the report says; a.ts and c.ts are already named
    expect(filesToRevisit(report, { changed: ['a.ts', 'b.ts', 'c.ts'], askedAgain: false }, new Set())).toEqual({ missing: ['c.ts'], unread: ['a.ts'], unopened: ['b.ts'] });
    expect(filesToRevisit(report, { changed: ['a.ts', 'b.ts', 'c.ts'], askedAgain: true })).toBeUndefined();
    expect(filesToRevisit(report, undefined)).toBeUndefined();
    const clean = parseQaReport({ verdict: 'pass', summary: '', checks: [], commands: [], files: [{ file: 'b.ts', tests: 'none', checked: 'read' }] });
    expect(clean && filesToRevisit(clean, { changed: ['b.ts'], askedAgain: false })).toBeUndefined();
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
    expect(['server/crew.ts', 'config/app.yml', 'package.json'].every(mustOpen)).toBe(true);
    expect(['server/crew.test.ts', 'docs/qa.md', 'pnpm-lock.yaml', 'client/public/deck.glb'].some(mustOpen)).toBe(false);
  });
});
