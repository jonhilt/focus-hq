import { describe, expect, it } from 'vitest';
import { qaSettingsNow } from '../../shared/qaChat';
import type { QaPlaybook } from '../../shared/types';
import { parseQaChat, QA_CHANGE_PROPERTIES, QA_CHAT_SCHEMA, qaChatPrompt, qaChatSystemPrompt } from './qaChat';

const playbook: QaPlaybook = {
  steps: [{ title: 'Reads every changed file', text: 'Go through every file the diff changes, never a chosen few.' }],
  repos: [
    { repo: 'acme/shop', cloned: true, packageJson: true, claudeMd: true, commands: ['pnpm test'] },
    { repo: 'acme/docs', cloned: false, packageJson: false, claudeMd: false, commands: [] },
  ],
  prompt: '(the whole thing)',
};

const request = {
  officer: 'Lt. Q',
  projectName: 'Shop',
  playbook,
  now: qaSettingsNow({ autoQa: false, mergeChecks: ['test'], qaBrief: 'Works at phone width' }),
  who: 'Works on claude-sonnet-5-5.',
  turns: [
    { who: 'captain' as const, text: 'Why do you read every file?' },
    { who: 'officer' as const, text: 'Bugs hide in the ones I skip.' },
    { who: 'captain' as const, text: 'Run the e2e suite too' },
  ],
};

describe('the QA officer’s talk with the captain', () => {
  it('says what it may change, and that its steps stay', () => {
    const system = qaChatSystemPrompt(request);
    expect(system).toContain('# You are Lt. Q, QA officer for Shop');
    expect(system).toContain('Your steps are fixed');
    expect(system).toContain('You change nothing yourself');
  });

  it('writes the brief in plain words, since QA’s reports on pull requests come from it', () => {
    expect(qaChatSystemPrompt(request)).toContain('never "the captain", "the crew"');
    expect(String((QA_CHANGE_PROPERTIES.qaBrief as { description: string }).description)).toContain('none of the ship’s');
  });

  it('gives it the Playbook as it is, and the talk ending with the captain’s words', () => {
    const prompt = qaChatPrompt(request);
    expect(prompt).toContain('- Test every PR: off. Runs only when you press Send to QA');
    expect(prompt).toContain('How hard you think: default.');
    expect(prompt).toContain('1. Reads every changed file\nGo through every file the diff changes');
    expect(prompt).toContain('- acme/shop: Runs pnpm test, and anything else the repo’s CLAUDE.md asks. It has a CLAUDE.md, which you follow.');
    expect(prompt).toContain('- acme/docs: QA works out the checks itself (Ops hasn’t cloned it yet, so it can’t say).\n');
    expect(prompt).toContain('Scripts to run: test');
    expect(prompt).toContain('### The brief\nWorks at phone width');
    expect(prompt).toMatch(/Captain: Why do you read every file\?\nYou: Bugs hide in the ones I skip\.\nCaptain: Run the e2e suite too\n\nAnswer/);
  });

  it('says when there’s no brief or scripts', () => {
    const prompt = qaChatPrompt({ ...request, now: { ...request.now, mergeChecks: [], qaBrief: ' ', qaEffort: 'high' } });
    expect(prompt).toContain('Scripts to run: none');
    expect(prompt).toContain('### The brief\n(empty)');
    expect(prompt).toContain('How hard you think: high.');
  });

  it('asks for a reply, and a change to only the settings it may change', () => {
    expect(QA_CHAT_SCHEMA).toMatchObject({ required: ['reply'], properties: { change: { additionalProperties: false, properties: QA_CHANGE_PROPERTIES } } });
    expect(Object.keys(QA_CHANGE_PROPERTIES)).toEqual(['autoQa', 'autoSendBack', 'qaProof', 'autoMerge', 'qaEffort', 'mergeChecks', 'qaBrief']);
  });

  it('reads its answer', () => {
    expect(parseQaChat({ reply: ' Done. ', change: { autoQa: true } })).toEqual({ reply: 'Done.', change: { autoQa: true } });
    expect(parseQaChat({ reply: 'Because.' })).toEqual({ reply: 'Because.' });
    expect(parseQaChat({ reply: '  ' })).toBeNull();
    expect(parseQaChat(undefined)).toBeNull();
  });
});
