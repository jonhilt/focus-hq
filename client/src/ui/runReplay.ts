import { runLine } from '../../../shared/agentStatus';
import { clock } from '../../../shared/clock';
import type { ReplayStep, TermLine } from '../../../shared/types';
import { api } from '../net/api';
import { fill, h } from './dom';
import { TermView } from './terminal';

/** How many of a stretch's terminal lines the replay shows: its last ones. */
const SLICE_LINES = 60;

/**
 * An agent's run replayed from its journal, beside their terminal: a scrubber over its facts, and at each one where the
 * run was (its machine's phase), what happened, and what their terminal showed in the stretch that led up to it.
 */
export class RunReplay {
  readonly el = h('div', { class: 'pane run-replay' });
  private steps: ReplayStep[] = [];
  private lines: TermLine[] = [];
  /** The fact picked on the scrubber; undefined follows the latest. */
  private at: number | undefined;
  /** The journal's last fact read so far. */
  private read = -1;

  constructor(private readonly id: string) {}

  /** Shows the replay, reading the journal (and the terminal) again when it's grown past `seq`. */
  show(seq: number, error: (message: string) => void): void {
    if (seq === this.read) return;
    this.read = seq;
    Promise.all([api.run(this.id), api.lines(this.id)])
      .then(([steps, lines]) => {
        this.steps = steps;
        this.lines = lines;
        this.render();
      })
      .catch((err: unknown) => error(err instanceof Error ? err.message : String(err)));
  }

  private pick(index: number | undefined): void {
    this.at = index === undefined || index >= this.steps.length - 1 ? undefined : Math.max(0, index);
    this.render();
  }

  private render(): void {
    const steps = this.steps;
    if (!steps.length) {
      fill(this.el, h('p', { class: 'muted' }, 'Nothing in their journal yet.'));
      return;
    }
    const index = this.at ?? steps.length - 1;
    const step = steps[index];
    const from = index > 0 ? steps[index - 1].t : 0;

    const scrubber = h('input', { type: 'range', min: '0', max: String(steps.length - 1), value: String(index), class: 'replay-scrubber', attrs: { 'aria-label': 'Fact in the journal' } });
    scrubber.oninput = () => this.pick(Number(scrubber.value));
    const back = h('button', { class: 'btn small', title: 'The fact before', onclick: () => this.pick(index - 1) }, '◀');
    const on = h('button', { class: 'btn small', title: 'The fact after', onclick: () => this.pick(index + 1) }, '▶');
    const latest = h('button', { class: 'btn small', title: 'Follow the run as it goes', onclick: () => this.pick(undefined) }, this.at === undefined ? 'Following' : 'Latest');
    back.disabled = index === 0;
    on.disabled = index === steps.length - 1;

    // what their terminal showed in the stretch leading up to this fact
    const stretch = this.lines.filter((l) => l.t > from && l.t <= step.t).slice(-SLICE_LINES);
    const term = new TermView();
    term.append(stretch);

    fill(
      this.el,
      h('div', { class: 'replay-bar' }, back, scrubber, on, latest),
      h('div', { class: 'replay-now' },
        h('div', { class: 'replay-phase' }, runLine(step.run)),
        h('div', null, step.fact),
        h('div', { class: 'muted' }, `Fact #${step.seq} of ${steps[steps.length - 1].seq} · ${clock(step.t)}`),
      ),
      h('div', { class: 'replay-label muted' }, stretch.length ? 'Their terminal, leading up to it' : 'Nothing in their terminal leading up to it'),
      stretch.length ? term.el : null,
      h('ol', { class: 'replay-steps' },
        ...steps.map((s, i) =>
          h('li', { class: i === index ? 'on' : '', onclick: () => this.pick(i) },
            h('span', { class: 'muted' }, `#${s.seq} ${clock(s.t)}`), ' ', h('strong', null, runLine(s.run)), ` · ${s.fact}`,
          ),
        ),
      ),
    );
    this.el.querySelector('.replay-steps li.on')?.scrollIntoView({ block: 'nearest' });
  }
}
