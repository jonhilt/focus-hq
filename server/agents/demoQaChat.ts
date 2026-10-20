import type { QaSettingsNow } from '../../shared/qaChat';
import type { QaChatTurn } from '../../shared/types';
import { demoPace } from '../demoPace';
import { sleep } from '../util';
import type { QaChatAnswer, QaChatRequest, QaChatter } from './qaChat';

// The demo's QA officer at the Playbook: canned answers, with a sample change for the requests the demo shows off
// (the e2e suite, sending failed PRs back, the browser), so talking to QA works without tokens.

/** A line added to the end of the brief, unless it's there already. */
const withLine = (brief: string, line: string) => (brief.includes(line) ? brief : [brief.trimEnd(), line].filter(Boolean).join('\n'));

/** What the demo's officer answers to the captain's last words, with the settings as they are `now`. */
export function demoQaAnswer(turns: QaChatTurn[], now: QaSettingsNow): QaChatAnswer {
  const said = turns.at(-1)?.text.toLowerCase() ?? '';
  if (/\be2e\b|end[- ]to[- ]end|playwright/.test(said)) {
    return { reply: 'I’ll run the e2e script on every pull request, after the others. The merge check runs the same list, so a red e2e run stops a merge too.', change: { mergeChecks: [...now.mergeChecks.filter((c) => c !== 'e2e'), 'e2e'] } };
  }
  if (/send(ing)? .*back|send-back/.test(said)) {
    const off = /\b(stop|don’t|don't|no longer|off|never)\b/.test(said);
    return {
      reply: off ? 'Then a pull request I fail comes to you, and nobody is sent to fix it.' : 'A pull request the crew opened that I fail will go back to its developer, up to 3 rounds.',
      change: { autoSendBack: !off },
    };
  }
  if (/browser|checkout|phone|mobile/.test(said)) {
    return { reply: 'My steps are fixed, but the brief can steer them: I’ll add a line so I only open the browser when the diff touches the checkout.', change: { qaBrief: withLine(now.qaBrief, '- Skip the browser unless the pull request touches the checkout.') } };
  }
  if (/\b(step|every file|read)\b/.test(said)) {
    return { reply: 'In the catch-rate runs, every bug I missed was in a file I didn’t open, so step 5 has me read each one. I can’t change my steps here; a line in the brief can point me at what matters most.' };
  }
  return { reply: 'I can change when I run, how hard I think, the scripts I run and my brief. Tell me what you’d like, in plain words.' };
}

/** The demo's officer: thinks for a moment, then answers from `demoQaAnswer`. */
export class DemoQaChat implements QaChatter {
  constructor(private readonly seconds = 1.5) {}

  async answer(req: Pick<QaChatRequest, 'turns' | 'now' | 'signal'>): Promise<QaChatAnswer> {
    await sleep((this.seconds * 1000) / demoPace());
    if (req.signal.aborted) throw new Error('Stopped');
    return demoQaAnswer(req.turns, req.now);
  }
}
