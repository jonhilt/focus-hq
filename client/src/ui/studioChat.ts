import { EFFORT_LEVELS, type StudioPitches, type StudioSession, type StudioVideo } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import { openPitches, shownTakes } from '../world/studio';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h } from './dom';
import { readout } from './panels';

/** The models the captain can put the computer on; the empty one leaves it to the office's `model` setting. */
const MODELS: [id: string, name: string][] = [
  ['', 'Ship’s model'],
  ['claude-fable-5-1', 'Fable 5.1'],
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
];

type View = 'chat' | 'script';

/**
 * The studio holodeck's chat with its computer (docs/studio.md), docked down the right so the room stays in view:
 * describe a video, and watch the premise, beats, threads and takes appear as it builds them. Its head says which model
 * it's on and how hard it thinks (both the captain's to change); the Script tab has the video in full, each beat with
 * its lines. Click the room (or Esc) to walk about again; Enter or E on the premise brings the chat back, and E on a
 * beat's card opens the script at that beat.
 */
export function openStudioChat(ui: Ui, beat?: number): void {
  let view: View = beat === undefined ? 'chat' : 'script';
  const body = h('div', { class: 'briefing-chat studio-chat' });

  // the pickers, the tabs and the message box outlive re-renders, so a reply arriving doesn't close a picker or wipe what you're typing
  const model = h('select', { class: 'effort', title: 'The model the computer thinks with, from its next turn' },
    ...MODELS.map(([id, name]) => h('option', { value: id }, name)));
  const effort = h('select', { class: 'effort', title: 'How hard the computer thinks, from its next turn: lower is quicker for small tweaks' },
    h('option', { value: '' }, 'default'),
    ...EFFORT_LEVELS.map((e) => h('option', { value: e }, e)));
  const tune = () => void api.studioTune(model.value, EFFORT_LEVELS.find((e) => e === effort.value)).catch((e: Error) => ui.error(e.message));
  model.onchange = tune;
  effort.onchange = tune;
  const ranOn = h('b');
  const cost = h('b');
  const head = h('div', { class: 'readouts studio-head' },
    readout('Model', model),
    readout('Effort', effort),
    h('div', { class: 'readout', title: 'The model its last turn ran on, as Claude Code reported it' }, h('small', null, 'Ran on'), ranOn),
    h('div', { class: 'readout' }, h('small', null, 'Spent'), cost),
  );
  const tabs = (['chat', 'script'] as const).map((v) => {
    const b = h('button', { class: 'btn small option-tab' }, v === 'chat' ? 'Chat' : 'Script');
    b.onclick = () => {
      view = v;
      beat = undefined;
      render();
    };
    return b;
  });

  const input = h('textarea', { class: 'briefing-input' });
  input.placeholder = 'Describe the video, or say what to change (“make b slower”)… Enter to send';
  const inputBox = withMic(ui, input);
  const send = h('button', { class: 'btn primary' }, 'Send');
  const say = (text: string, clear: boolean) => {
    if (!text.trim() || send.disabled) return;
    void busy(send, async () => {
      await api.studioSay(text);
      if (clear) input.value = '';
    }, ui.error).then(render);
  };
  const sendNow = () => say(input.value, true);
  send.onclick = sendNow;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendNow();
    }
  });
  const fresh = h('button', { class: 'btn small', title: 'Clear the studio for a new video: the computer starts afresh, even mid-thought' }, 'New video');
  fresh.onclick = () => void busy(fresh, () => api.studioNew(), ui.error);
  let shownMessages = -1;

  function render(): void {
    const session = state.studio;
    const messages = session?.messages ?? [];
    const thinking = session?.status === 'thinking';
    if (document.activeElement !== model) model.value = session?.model ?? '';
    if (document.activeElement !== effort) effort.value = session?.effort ?? '';
    ranOn.textContent = modelName(session?.ranOn);
    cost.textContent = `$${(session?.costUsd ?? 0).toFixed(2)}`;
    tabs.forEach((t, i) => t.classList.toggle('on', (i === 0) === (view === 'chat')));
    send.disabled = thinking;
    fresh.disabled = !messages.length && !thinking && !session?.video;
    const bar = h('div', { class: 'row studio-tabs' }, ...tabs, h('span', { class: 'grow' }), fresh);

    if (view === 'script') {
      const page = scriptView(session, beat);
      fill(body, head, bar, page);
      if (beat !== undefined) requestAnimationFrame(() => page.querySelector('.studio-beat.picked')?.scrollIntoView({ block: 'start' }));
      return;
    }

    const log = h('div', { class: 'briefing-log' },
      messages.length || thinking
        ? null
        : h('div', { class: 'briefing-note' }, 'Say what the video’s about. The computer puts the premise on the far wall, the beats under it, loose threads in the air, and tries ways of showing things on the floor. Say what to change and it swaps them in.'),
      ...messages.map((m) =>
        h('div', { class: `briefing-msg ${m.from}` },
          h('strong', null, m.from === 'captain' ? 'You' : 'Computer'),
          ...m.text.split(/\n{2,}/).map((p) => h('p', null, ...bold(p))),
        ),
      ),
      ...openPitches(session?.pitches, session?.takes ?? []).map((set) => pitchBoard(set, session?.video, thinking, (text) => say(text, false))),
      thinking ? h('div', { class: 'briefing-msg computer typing' }, h('strong', null, 'Computer'), h('p', null, session.activity)) : null,
      session?.status === 'failed' ? h('div', { class: 'briefing-note error' }, `${session.error ?? 'Something went wrong'}. Say something to carry on.`) : null,
    );
    const takes = session?.takes ?? [];
    const onFloor = takes.length
      ? h('div', { class: 'studio-takes' }, `On the floor: ${shownTakes(takes).map((t) => `${t.id.toUpperCase()}${t.beat !== undefined ? ` (beat ${t.beat + 1})` : ''} ${t.label}${t.error ? ' (stopped)' : ''}`).join(' · ')}`)
      : null;
    fill(body, head, bar, log, onFloor, h('div', null, inputBox, h('div', { class: 'row' }, send)));
    if (messages.length !== shownMessages) {
      shownMessages = messages.length;
      requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    } else {
      log.scrollTop = log.scrollHeight;
    }
    if (document.activeElement !== input && document.activeElement !== model && document.activeElement !== effort) input.focus();
  }

  ui.panels.open({ title: 'Studio · Holodeck computer', body, accent: LCARS.gold, docked: true });
  ui.panels.own(state.on('studio', render));
  render();
}

/** The video in full, to read and narrate from: premise, takeaway, each beat with its lines and takes, and the threads. */
function scriptView(session: StudioSession | null, picked?: number): HTMLElement {
  const video = session?.video;
  if (!video) return h('div', { class: 'studio-script' }, h('div', { class: 'briefing-note' }, 'Nothing yet: tell the computer what the video’s about, and its script builds up here.'));
  const takes = session.takes;
  const open = video.threads.filter((t) => !t.closed);
  const closed = video.threads.filter((t) => t.closed);
  return h('div', { class: 'studio-script' },
    h('section', null, h('small', null, 'Premise'), h('p', { class: 'premise' }, video.premise)),
    video.takeaway ? h('section', null, h('small', null, 'The viewer comes away with'), h('p', null, video.takeaway)) : null,
    ...video.beats.map((b, i) => {
      const shown = takes.filter((t) => t.beat === i);
      return h('section', { class: `studio-beat${i === picked ? ' picked' : ''}` },
        h('small', null, `Beat ${String(i + 1).padStart(2, '0')}`),
        h('h3', null, b.title),
        b.point ? h('p', { class: 'point' }, b.point) : null,
        b.lines ? h('blockquote', null, ...b.lines.split(/\n+/).map((l) => h('p', null, l))) : h('p', { class: 'muted' }, 'No lines yet.'),
        ...(session.pitches?.find((set) => set.beat === i)?.pitches ?? []).map((p, n) => h('p', { class: 'studio-pitched' }, h('b', null, `Pitch ${n + 1}`), ` ${p.title} (${p.scale}): ${p.metaphor}`)),
        ...shown.map((t) => h('p', { class: 'studio-takes' }, h('b', null, `Take ${t.id.toUpperCase()}`), ` ${t.label}${t.metaphor ? `: ${t.metaphor}` : ''} (${t.seconds}s${t.phases ? `, ${Object.keys(t.phases).join(' → ')}` : ''})`)),
      );
    }),
    open.length || closed.length
      ? h('section', null,
        h('small', null, 'Loose threads'),
        ...open.map((t) => h('p', { class: 'thread open' }, h('b', null, t.id), ' ', t.text)),
        ...closed.map((t) => h('p', { class: 'thread closed' }, h('b', null, t.id), ' ', t.text, h('br'), h('span', null, t.closed!.as === 'answered' ? `Answered: ${t.closed!.answer ?? ''}` : 'Dropped'))),
      )
      : null,
  );
}

/**
 * The ways the computer's pitched to show a beat, waiting on the captain: each with what it's shown as, how big, and
 * how it holds up, and a button to build it. Mixing them or pushing back is said in the chat.
 */
function pitchBoard(set: StudioPitches, video: StudioVideo | undefined, thinking: boolean, say: (text: string) => void): HTMLElement {
  const beat = set.beat !== undefined ? video?.beats[set.beat] : undefined;
  const what = set.beat !== undefined ? `beat ${set.beat + 1}${beat ? ` (“${beat.title}”)` : ''}` : 'the video';
  return h('div', { class: 'studio-pitches' },
    h('small', null, `Ways to show ${what}: pick one, or say what to mix or change`),
    ...set.pitches.map((p, i) => {
      const build = h('button', { class: 'btn small primary', title: 'Ask the computer to stage this one' }, 'Build this');
      build.disabled = thinking;
      build.onclick = () => say(`Build pitch ${i + 1} for ${what}: “${p.title}”.`);
      return h('div', { class: 'studio-pitch' },
        h('div', { class: 'row' }, h('b', { class: 'n' }, String(i + 1)), h('strong', null, p.title), h('span', { class: 'pill' }, p.scale)),
        h('p', null, p.metaphor),
        p.check ? h('p', { class: 'check' }, p.check) : null,
        h('div', { class: 'row end' }, build),
      );
    }),
  );
}

/** A model's short name, as the picker has it, or its id without the `claude-`. */
function modelName(id?: string): string {
  if (!id) return '—';
  return MODELS.find(([m]) => m && id.startsWith(m))?.[1] ?? id.replace(/^claude-/, '');
}

/** A paragraph with its **bold** runs bold, as the computer writes take ids. */
function bold(text: string): (string | HTMLElement)[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? h('b', null, part) : part));
}
