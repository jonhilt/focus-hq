// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { qaSettingsNow } from '../../../shared/qaChat';
import type { QaChatReply, QaChatTurn } from '../../../shared/types';
import { type QaChatDeps, qaChat, turnsToSend } from './qaChat';

/** Lets a click's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

function talk(answers: (QaChatReply | Error)[], deps: Partial<QaChatDeps> = {}) {
  const asked: QaChatTurn[][] = [];
  const errors: string[] = [];
  const all: QaChatDeps = {
    officer: 'Lt. Q',
    ask: (turns) => {
      asked.push(turns);
      const next = answers.shift();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? { reply: '…' });
    },
    apply: vi.fn(() => Promise.resolve()),
    now: () => qaSettingsNow({ autoSendBack: true, qaBrief: 'Works at phone width' }),
    error: (message) => void errors.push(message),
    field: (input) => input,
    ...deps,
  };
  const el = qaChat(all);
  const say = async (text: string) => {
    const input = el.querySelector('textarea');
    if (!input) throw new Error('no box to type in');
    input.value = text;
    el.querySelector<HTMLButtonElement>('.qa-chat-say button')?.click();
    await settle();
  };
  const turns = () => [...el.querySelectorAll('.qa-chat-turn')].map((t) => `${t.querySelector('strong')?.textContent}: ${t.querySelector('p')?.textContent}`);
  const button = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.qa-chat-change button')].find((b) => b.textContent === label);
  return { el, asked, errors, apply: all.apply, say, turns, button };
}

describe('talking to the QA officer at the Playbook', () => {
  it('shows what the captain said and the officer’s answer, sending the talk so far', async () => {
    const t = talk([{ reply: 'Bugs hide in the files I skip.' }, { reply: 'Sure.' }]);
    await t.say('Why do you read every file?');
    await t.say('Fair enough');
    expect(t.turns()).toEqual(['You: Why do you read every file?', 'Lt. Q: Bugs hide in the files I skip.', 'You: Fair enough', 'Lt. Q: Sure.']);
    expect(t.asked[1]).toEqual([
      { who: 'captain', text: 'Why do you read every file?' },
      { who: 'officer', text: 'Bugs hide in the files I skip.' },
      { who: 'captain', text: 'Fair enough' },
    ]);
    expect(t.el.querySelector('.qa-chat-change')).toBeNull();
  });

  it('shows a proposed change as a diff, the brief a line at a time, and applies it on Apply', async () => {
    const change = { autoSendBack: false, qaBrief: 'Works at phone width\nSkip the browser unless it touches checkout' };
    const t = talk([{ reply: 'Done, if you apply it.', change }]);
    await t.say('Stop sending failed PRs back, and skip the browser unless it touches checkout');
    const rows = [...t.el.querySelectorAll('.qa-chat-change tr')];
    expect(rows[0].textContent).toBe('Send failed PRs backon→off');
    expect([...rows[1].querySelectorAll('.qa-chat-diff div')].map((d) => [d.className, d.textContent])).toEqual([
      ['same', '  Works at phone width'],
      ['added', '+ Skip the browser unless it touches checkout'],
    ]);
    t.button('Apply')?.click();
    await settle();
    expect(t.apply).toHaveBeenCalledWith(change);
    expect(t.el.querySelector('.qa-chat-change')?.textContent).toContain('Applied.');
    expect(t.button('Apply')).toBeUndefined();
  });

  it('tells the officer what the captain did with its change', async () => {
    const t = talk([{ reply: 'Off it goes.', change: { autoSendBack: false } }, { reply: 'OK.' }]);
    await t.say('Stop sending failed PRs back');
    t.button('Discard')?.click();
    await t.say('Actually, why?');
    expect(t.apply).not.toHaveBeenCalled();
    expect(t.el.querySelector('.qa-chat-change')?.textContent).toContain('Discarded.');
    expect(t.asked[1][1].text).toBe('Off it goes.\n(Proposed: Send failed PRs back on → off. The captain discarded it.)');
  });

  it('keeps the change to apply when applying fails, and says why', async () => {
    const t = talk([{ reply: 'Here.', change: { autoQa: false } }], { apply: () => Promise.reject(new Error('Offline')) });
    await t.say('Only when I ask');
    t.button('Apply')?.click();
    await settle();
    expect(t.errors).toEqual(['Offline']);
    expect(t.button('Apply')).toBeDefined();
  });

  it('puts the captain’s words back in the box when the officer can’t answer', async () => {
    const t = talk([new Error('The QA officer finished without answering')]);
    await t.say('Run the e2e suite too');
    expect(t.errors).toEqual(['The QA officer finished without answering']);
    expect(t.turns()).toEqual([]);
    expect(t.el.querySelector('textarea')?.value).toBe('Run the e2e suite too');
  });

  it('sends nothing blank', async () => {
    const t = talk([]);
    await t.say('   ');
    expect(t.asked).toEqual([]);
  });
});

describe('turnsToSend', () => {
  it('sends only the latest turns, and a new brief by name', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ who: 'captain' as const, text: String(i) }));
    expect(turnsToSend(entries).map((t) => t.text)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    const proposed = { who: 'officer' as const, text: 'Here.', rows: [{ field: 'qaBrief' as const, label: 'Your brief', from: '', to: 'x' }] };
    expect(turnsToSend([proposed])[0].text).toBe('Here.\n(Proposed: a new brief. The captain hasn’t applied it yet.)');
  });
});
