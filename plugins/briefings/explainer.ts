import { isRecord } from '../../plugin-api/shared';
import type { Receipt, Ref } from './receipts';

/** A page for the lead's screen, as show takes it. */
export interface ExplainerPage {
  id: string;
  title: string;
  html: string;
}

/**
 * Explainers: an animated walk-through a lead builds with the office's explain tool, for a concept that's hard to take
 * in from text. The lead gives the beats (each a caption and how long it plays) and a stage that draws the whole scene
 * from the time t; `explainerPage` wraps them in the ship's LCARS player (an elbow frame, the beats down the left, the
 * caption under the stage, step and play along the bottom) as a page the office shows like any of show's.
 */
export const EXPLAINER_LIMITS = { minBeats: 2, maxBeats: 8, label: 16, beatTitle: 60, text: 320, narration: 600, minSeconds: 1, maxSeconds: 30, stageBytes: 1_500_000 } as const;

/** The stage's box inside the player, in CSS pixels: the lead lays their scene out in it. */
export const STAGE_SIZE = { w: 1050, h: 500 } as const;
/** Where the stage sits on the player's 1280 × 800 page. */
export const STAGE_AT = { x: 200, y: 58 } as const;

export interface ExplainerBeat {
  title: string;
  /** The caption under the stage while it plays. */
  text: string;
  seconds: number;
  /** A word or two for its block down the left and its part of the timeline; the title's first words when missing. */
  label?: string;
  /** What the voice says over it, talking the captain through the stage; its title and caption when missing. */
  narration?: string;
  /** Where its facts come from, quoted (receipts.ts); none, and it's the lead's interpretation. */
  refs?: Ref[];
}

export interface ExplainerInput {
  id: string;
  title: string;
  beats: ExplainerBeat[];
  /** The scene: its elements, their styles, and a script that defines render(t). */
  stage: { html: string; css?: string; script: string };
}

// red is kept for alerts on the stage, so a beat's block never reads as one
const BEAT_COLOURS = ['orange', 'peri', 'sky', 'lilac', 'peach', 'gold', 'green', 'orange'];

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
/** JSON that can sit inside a script element: no `</script>` or `<!--` in it can close or confuse the element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

/** The label for a beat's block: the lead's, or as many of the title's words as fit. */
export function beatLabel(beat: ExplainerBeat): string {
  const own = beat.label && clean(beat.label);
  if (own) return own;
  let label = '';
  for (const word of clean(beat.title).replace(/[,.:;!?].*$/, '').split(' ')) {
    const next = label ? `${label} ${word}` : word;
    if (next.length > EXPLAINER_LIMITS.label) break;
    label = next;
  }
  return label || clean(beat.title).slice(0, EXPLAINER_LIMITS.label);
}

/** What the voice says over a beat: the lead's narration, or failing that its title and caption read out. */
export function beatNarration(beat: ExplainerBeat): string {
  const own = beat.narration && clean(beat.narration);
  if (own) return own;
  const title = clean(beat.title);
  return `${title}${/[.!?]$/.test(title) ? '' : '.'} ${clean(beat.text)}`;
}

/** The moments the office takes a picture of the stage at, for the lead to check: the middle of each beat. */
export function beatMoments(beats: readonly Pick<ExplainerBeat, 'seconds'>[]): number[] {
  let at = 0;
  return beats.map((b) => {
    const middle = at + b.seconds / 2;
    at += b.seconds;
    return middle;
  });
}

/** What the office saw on the stage at one moment: how much of it is one flat colour. */
export interface StageMoment {
  at: number;
  /** The share (0 to 1) of the stage's pixels that are its commonest colour. */
  flat: number;
}

/** The stage's box on the player's page, for a picture of the stage alone. */
export const STAGE_CLIP = { x: STAGE_AT.x, y: STAGE_AT.y, width: STAGE_SIZE.w, height: STAGE_SIZE.h } as const;

/** What the player said it saw on its stage at a moment (its `kitSeen`), read back from the page; null when it said nothing it should. */
export function stageSeen(at: number, seen: unknown): StageMoment | null {
  if (!isRecord(seen) || typeof seen.flat !== 'number') return null;
  return { at, flat: seen.flat };
}

/** A stage this close to one colour all over has nothing on it (a lone small label is about 0.997). */
const EMPTY = 0.999;

/** What looks wrong at each moment, a line per beat, for the lead to fix: nothing when all looks well. */
export function momentNotes(moments: readonly StageMoment[]): string[] {
  return moments.flatMap((m, i) => (m.flat >= EMPTY ? [`Beat ${i + 1} looks empty (one flat colour across the stage): check that render(t) draws it.`] : []));
}

/** What the lead hears with the pictures of their explainer's beats: what the office's checks found, and to look. */
export function explainerCheck(notes: readonly string[]): string {
  const look = "Here's the stage at the middle of each beat, in order: look at each, and if one doesn't show what its caption says, fix it and explain it again under the same id.";
  return notes.length ? `${look} The office's checks found: ${notes.join(' ')}` : `${look} The office's check for an empty stage found nothing.`;
}

/**
 * The player page for an explainer, ready to show under its id and title. Or why it was refused. `receipts`: each beat's,
 * as the office found them in their sources; a beat with none shows as the lead's interpretation.
 */
export function explainerPage(input: ExplainerInput, receipts: readonly (readonly Receipt[])[] = []): ExplainerPage | { error: string } {
  const L = EXPLAINER_LIMITS;
  const n = input.beats.length;
  if (n < L.minBeats || n > L.maxBeats) return { error: `Give ${L.minBeats} to ${L.maxBeats} beats (you gave ${n})` };
  for (const [i, b] of input.beats.entries()) {
    const which = `Beat ${i + 1}`;
    if (!clean(b.title)) return { error: `${which} needs a title` };
    if (clean(b.title).length > L.beatTitle) return { error: `${which}'s title is ${clean(b.title).length} characters (at most ${L.beatTitle})` };
    if (!clean(b.text)) return { error: `${which} needs a caption` };
    if (clean(b.text).length > L.text) return { error: `${which}'s caption is ${clean(b.text).length} characters (at most ${L.text}): say less, or split it into two beats` };
    if (b.narration && clean(b.narration).length > L.narration) return { error: `${which}'s narration is ${clean(b.narration).length} characters (at most ${L.narration}): say less, or split it into two beats` };
    if (b.label && clean(b.label).length > L.label) return { error: `${which}'s label is ${clean(b.label).length} characters (at most ${L.label})` };
    if (!(b.seconds >= L.minSeconds && b.seconds <= L.maxSeconds)) return { error: `${which} plays for ${b.seconds} seconds (${L.minSeconds} to ${L.maxSeconds})` };
  }
  const { html, css = '', script } = input.stage;
  if (!script.trim()) return { error: 'The stage needs a script that defines render(t)' };
  if (/<\/script/i.test(script)) return { error: 'The stage script can’t contain </script>: build that string in pieces' };
  if (/<\/style/i.test(css)) return { error: 'The stage CSS can’t contain </style>' };
  if (Buffer.byteLength(html + css + script) > L.stageBytes) return { error: `The stage is over ${L.stageBytes / 1_000_000} MB: keep it small` };

  let at = 0;
  const beats = input.beats.map((b, i) => {
    const beat = { at, title: clean(b.title), text: clean(b.text), label: beatLabel(b), colour: BEAT_COLOURS[i], say: beatNarration(b), receipts: receipts[i] ?? [] };
    at += b.seconds;
    return beat;
  });
  const title = clean(input.title);
  return { id: input.id, title, html: page(title, beats, at, html, css, script) };
}

/** The player around the lead's stage. The kit's own script defines its helpers on window, so the lead's names win. */
function page(title: string, beats: { at: number; title: string; text: string; label: string; colour: string; say: string; receipts: readonly Receipt[] }[], dur: number, stageHtml: string, stageCss: string, stageScript: string): string {
  // the left column holds the beats between the two elbows, however many there are
  const beatH = Math.floor((320 - 6 * (beats.length - 1)) / beats.length);
  // Antonio in capitals is about 0.47em a character: a long title takes the lilac block's room too, then shrinks to fit
  const long = title.length > 36;
  const titlePx = Math.max(18, Math.min(30, Math.floor((long ? 630 : 530) / (title.length * 0.47))));
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escape(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Antonio:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap">
<style>${KIT_CSS}
  .beat { height:${beatH}px; }
  .title { font-size:${titlePx}px; }
</style>
<style>${stageCss}</style>
</head>
<body class="rest">
${FRAME}
<div class="bar" style="left:566px;right:0;top:0">
  ${long ? '' : '<div class="blk" style="width:90px;background:var(--lilac)"></div>'}
  <div class="blk" style="flex:1;min-width:20px;background:var(--peach);height:20px"></div>
  <div class="title">${escape(title)}</div>
  <div class="endcap" style="background:var(--orange)"></div>
</div>
<div class="beats" id="kit-beats"></div>
<div class="stage" id="stage">
${stageHtml}
</div>
<div class="fault" id="kit-fault"><div class="hd">Stage fault</div><div class="bd" id="kit-fault-text"></div></div>
<button class="run" id="kit-run">▶ Run briefing</button>
<div class="caption"><div class="bt" id="kit-bt"></div><div class="bx" id="kit-bx"></div></div>
<div class="receipts" id="kit-rc"></div>
<div class="quoted" id="kit-quote" hidden><div class="hd" id="kit-quote-from"></div><div class="bd" id="kit-quote-text"></div></div>
<div class="bar" style="left:306px;right:0;top:766px">
  <button class="btn" id="kit-prev" style="background:var(--lilac)">◀ Step</button>
  <button class="btn" id="kit-pp" style="background:var(--gold);width:118px">▶ Play</button>
  <button class="btn" id="kit-next" style="background:var(--lilac)">Step ▶</button>
  <button class="btn voice" id="kit-voice" title="A voice talks you through each beat">Voice</button>
  <div id="kit-segs" style="flex:1;display:flex;gap:4px"></div>
  <div class="clock" id="kit-clock"></div>
  <div class="endcap" style="background:var(--peri)"></div>
</div>
<script>window.KIT_BEATS = ${scriptJson(beats)}; window.KIT_DUR = ${dur};</script>
<script>${KIT_HELPERS}</script>
<script>
${stageScript}
</script>
<script>${KIT_PLAYER}</script>
</body></html>
`;
}

// The ship's palette and font, as in client/src/styles.css and world/starship.ts.
const KIT_CSS = String.raw`
  :root { --orange:#ff9966; --lilac:#cc99cc; --peri:#9999ff; --peach:#ffcc99; --red:#cc6666; --gold:#ff9900; --sky:#99ccff; --green:#99cc66;
    --text:#f1eaff; --muted:#a49db4; --line:#3a3352; --ui:'Antonio','Arial Narrow',sans-serif; --mono:'JetBrains Mono',ui-monospace,Menlo,monospace; }
  * { box-sizing:border-box; }
  html, body { margin:0; width:1280px; height:800px; position:relative; overflow:hidden; background:#000; color:var(--text); font-family:var(--ui); }
  svg.frame { position:absolute; left:0; top:0; }
  .bar { position:absolute; display:flex; gap:6px; align-items:stretch; height:34px; }
  .bar > * { flex:none; }
  .blk { height:34px; }
  .bar > .title { flex:0 1 auto; min-width:0; padding:0 14px; color:var(--orange); font-weight:600; line-height:34px; text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .endcap { width:46px; border-radius:0 17px 17px 0; }
  .beats { position:absolute; left:0; top:246px; width:160px; display:flex; flex-direction:column; gap:6px; }
  .beat { width:160px; display:flex; align-items:flex-end; justify-content:flex-end; padding:0 10px 4px; color:#000; font:500 17px/1 var(--ui); text-transform:uppercase; letter-spacing:.04em; cursor:pointer; text-align:right; overflow:hidden; }
  .beat b { font-weight:700; margin-right:6px; }
  .beat.on { width:184px; border-radius:0 29px 29px 0; padding-right:22px; }
  .stage { position:absolute; left:200px; top:58px; width:1050px; height:500px; }
  .caption { position:absolute; left:200px; top:584px; width:1050px; }
  .caption .bt { font:600 30px/1.1 var(--ui); color:var(--gold); text-transform:uppercase; letter-spacing:.04em; margin-bottom:8px; }
  .caption .bx { font:400 19px/1.45 var(--mono); color:var(--text); letter-spacing:0; max-width:1020px; }
  .btn { height:34px; border-radius:17px; border:0; padding:0 20px; color:#000; font:600 19px/34px var(--ui); text-transform:uppercase; letter-spacing:.06em; cursor:pointer; }
  .btn:hover { filter:brightness(1.15); }
  .seg { position:relative; height:34px; background:#241e38; cursor:pointer; overflow:hidden; }
  .seg i { position:absolute; left:0; top:0; bottom:0; background:var(--gold); }
  .seg span { position:absolute; right:8px; top:0; font:500 15px/34px var(--ui); text-transform:uppercase; letter-spacing:.06em; white-space:nowrap; }
  .btn.voice { display:none; background:var(--muted); }
  .btn.voice.on { background:var(--green); }
  .voiced .btn.voice { display:block; }
  .clock { width:64px; color:var(--peach); font:500 19px/34px var(--ui); text-align:right; }
  .rest .stage, .rest .caption { opacity:.35; }
  .run { position:absolute; left:575px; top:272px; width:300px; height:72px; border-radius:36px; border:0; background:var(--gold); color:#000; font:700 32px/72px var(--ui); letter-spacing:.08em; text-transform:uppercase; cursor:pointer; display:none; }
  .rest .run { display:block; }
  .fault { position:absolute; left:400px; top:200px; width:650px; border:3px solid var(--red); border-radius:22px; background:#000; overflow:hidden; display:none; z-index:5; }
  .fault .hd { background:var(--red); color:#000; font:600 21px/34px var(--ui); padding:0 16px; text-transform:uppercase; letter-spacing:.04em; }
  .fault .bd { padding:12px 16px; font:400 14px/1.5 var(--mono); color:var(--text); white-space:pre-wrap; }
  .faulted .fault { display:block; }
  .faulted .run { display:none; }
  .receipts { position:absolute; left:200px; top:726px; width:1050px; height:28px; display:flex; gap:8px; overflow:hidden; }
  .rc { height:26px; border-radius:13px; border:2px solid var(--sky); background:#000; color:var(--sky); padding:0 12px; font:500 14px/22px var(--mono); white-space:nowrap; cursor:pointer; max-width:340px; flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }
  .rc.on { background:var(--sky); color:#000; }
  .rc.interp { border-style:dashed; border-color:var(--muted); color:var(--muted); cursor:default; font-family:var(--ui); text-transform:uppercase; letter-spacing:.06em; }
  .rest .receipts { opacity:.35; }
  .quoted { position:absolute; left:200px; top:398px; width:1050px; border:3px solid var(--sky); border-radius:22px; background:#000; overflow:hidden; z-index:4; }
  .quoted .hd { background:var(--sky); color:#000; font:600 17px/30px var(--mono); padding:0 16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .quoted .bd { padding:10px 16px; font:400 16px/1.45 var(--mono); color:var(--text); white-space:pre-wrap; max-height:110px; overflow:auto; }

  /* for the lead's stage */
  .panel { position:absolute; border:3px solid var(--c, var(--sky)); border-radius:22px; background:#000; overflow:hidden; }
  .panel > .hd { background:var(--c, var(--sky)); color:#000; font:600 21px/34px var(--ui); padding:0 16px; text-transform:uppercase; letter-spacing:.04em; display:flex; justify-content:space-between; gap:10px; white-space:nowrap; }
  .panel > .hd > :first-child { overflow:hidden; text-overflow:ellipsis; }
  .panel > .bd { padding:10px 16px; font:400 18px/1.35 var(--ui); color:var(--muted); letter-spacing:.02em; }
  .pill { position:absolute; height:40px; border-radius:20px; background:var(--c, var(--lilac)); color:#000; font:500 19px/40px var(--ui); padding:0 18px; text-transform:uppercase; white-space:nowrap; letter-spacing:.03em; }
  .lbl { position:absolute; color:var(--peach); font:500 17px var(--ui); text-transform:uppercase; letter-spacing:.12em; display:flex; align-items:center; gap:8px; }
  .lbl::before { content:""; width:22px; height:14px; border-radius:7px 0 0 7px; background:var(--peach); }
  .tag { display:inline-block; height:26px; padding:0 14px; border-radius:13px; color:#000; font:600 16px/26px var(--ui); text-transform:uppercase; letter-spacing:.06em; white-space:nowrap; }
  .mono { font-family:var(--mono); font-size:13px; }
`;

const FRAME = `<svg class="frame" width="1280" height="800">
  <path d="M0,238 L0,110 A110,110 0 0 1 110,0 L560,0 L560,34 L196,34 A36,36 0 0 0 160,70 L160,238 Z" fill="var(--orange)"/>
  <path d="M0,572 L160,572 L160,730 A36,36 0 0 0 196,766 L300,766 L300,800 L110,800 A110,110 0 0 1 0,690 Z" fill="var(--peri)"/>
  <text x="150" y="226" text-anchor="end" font-family="Antonio, Arial Narrow, sans-serif" font-weight="600" font-size="19" fill="#000">EXPLAINER</text>
  <text x="150" y="600" text-anchor="end" font-family="Antonio, Arial Narrow, sans-serif" font-weight="600" font-size="19" fill="#000">PLAYBACK</text>
</svg>`;

// The helpers the lead's render(t) can use. Set on window rather than declared, so a lead's own const of the same name
// shadows them instead of failing to load.
const KIT_HELPERS = String.raw`
(function () {
  var B = window.KIT_BEATS.map(function (b) { return b.at; });
  window.B = B;
  window.DUR = window.KIT_DUR;
  window.clamp = function (x, lo, hi) { return Math.min(hi === undefined ? 1 : hi, Math.max(lo === undefined ? 0 : lo, x)); };
  window.ease = function (x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  window.p = function (t, a, b) { return window.ease(window.clamp((t - a) / (b - a))); };
  window.stage = document.getElementById('stage');
  window.$ = function (sel) { return window.stage.querySelector(sel); };
  window.$$ = function (sel) { return Array.prototype.slice.call(window.stage.querySelectorAll(sel)); };
  window.tag = function (text, colour) { return '<span class="tag" style="background:var(--' + colour + ')">' + text + '</span>'; };
  window.addEventListener('error', function (e) { window.kitFault(e.message || String(e.error)); });
  // false until the player has drawn its resting frame: the office waits for it before taking the screen's picture
  window.kitReady = false;
  window.kitFault = function (message) {
    window.kitReady = true;
    console.error('Stage fault: ' + message);
    document.body.classList.add('faulted');
    document.getElementById('kit-fault-text').textContent = message;
  };
})();
`;

// Playback: play runs to the end; step plays one beat and stops; a beat's block or its part of the timeline jumps there.
// It rests, dimmed, on the last frame until the captain presses play, so the screen's picture sums it up.
// Up close, the office's screen offers a voice-over: the page can't reach the office itself (it runs in a sandbox of its
// own), so it asks the screen around it to say each beat's line, and the screen says when the line is done. While the
// voice is on it sets the pace: a beat holds on its last frame until its line is finished. When a new version changed a
// beat, the screen has it show that beat, waiting at its start.
const KIT_PLAYER = String.raw`
(function () {
  var BEATS = window.KIT_BEATS, DUR = window.KIT_DUR, el = function (id) { return document.getElementById(id); };
  var draw = typeof render === 'function' ? render : null;
  if (!draw) window.kitFault('The stage script must define render(t).');
  var end = function (i) { return i + 1 < BEATS.length ? BEATS[i + 1].at : DUR; };
  // how far short of the next beat's start a held beat's last frame is drawn
  var HELD = .001;
  // hold: the beat a step just finished, whose caption stays up while its last frame does (t is then the next one's start)
  var t = DUR, raf = 0, stopAt = DUR, playing = false, hold = -1;
  // the voice-over: whether it's on, and the beat whose line is being said (-1 for none), finished or paused
  var screen = window.parent !== window ? window.parent : null, voice = false;
  var talk = { beat: -1, done: true, paused: false };
  var tell = function (message) { if (screen) screen.postMessage(message, '*'); };
  function say(i) { talk = { beat: i, done: false, paused: false }; tell({ kit: 'say', beat: i }); }
  function hush() { if (!talk.done) tell({ kit: 'hush' }); talk = { beat: -1, done: true, paused: false }; }
  var beatEls = BEATS.map(function (b, i) {
    var d = document.createElement('div'); d.className = 'beat'; d.style.background = 'var(--' + b.colour + ')';
    d.innerHTML = '<span><b>0' + (i + 1) + '</b></span>'; d.firstChild.appendChild(document.createTextNode(b.label));
    d.onclick = function () { run(b.at, end(i)); };
    el('kit-beats').appendChild(d); return d;
  });
  var segEls = BEATS.map(function (b, i) {
    var d = document.createElement('div'); d.className = 'seg'; d.style.flex = String(end(i) - b.at);
    d.innerHTML = '<i></i><span></span>'; d.lastChild.textContent = b.label;
    d.onclick = function (e) { var r = d.getBoundingClientRect(); stop(); hush(); hold = -1; document.body.classList.remove('rest'); t = b.at + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (end(i) - b.at); frame(); stop(); };
    el('kit-segs').appendChild(d); return d;
  });
  // the receipts for the beat on screen: a chip per source, which opens to its quote; never said aloud
  var chipsFor = -1;
  function receipts(bi) {
    chipsFor = bi; el('kit-quote').hidden = true;
    var row = el('kit-rc'); row.textContent = '';
    if (!BEATS[bi].receipts.length) {
      var none = document.createElement('span'); none.className = 'rc interp'; none.textContent = 'Interpretation';
      none.title = 'No source cited: this beat is the lead’s reading'; row.appendChild(none); return;
    }
    BEATS[bi].receipts.forEach(function (r) {
      var chip = document.createElement('button'); chip.className = 'rc'; chip.textContent = r.label; chip.title = r.quote;
      chip.onclick = function () {
        var open = chip.classList.contains('on');
        Array.prototype.forEach.call(row.children, function (c) { c.classList.remove('on'); });
        el('kit-quote').hidden = open;
        if (open) return;
        chip.classList.add('on'); el('kit-quote-from').textContent = r.label; el('kit-quote-text').textContent = r.quote;
      };
      row.appendChild(chip);
    });
  }
  var describe = function (err, at) { return (at === undefined ? '' : 'at t = ' + at.toFixed(2) + 's: ') + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : String(err)); };
  function frame() {
    var held = hold >= 0 && Math.abs(t - end(hold)) < .001;
    // a held beat draws its own last frame: at t itself, a stage that switches scene at a beat's start shows the next one's
    if (draw) try { draw(held ? t - HELD : t); } catch (err) { draw = null; window.kitFault(describe(err)); stop(); }
    var bi = held ? hold : beatAt(t);
    el('kit-bt').textContent = BEATS[bi].title; el('kit-bx').textContent = BEATS[bi].text;
    if (bi !== chipsFor) receipts(bi);
    beatEls.forEach(function (d, i) { d.classList.toggle('on', i === bi); });
    segEls.forEach(function (d, i) {
      var k = Math.min(1, Math.max(0, (t - BEATS[i].at) / (end(i) - BEATS[i].at)));
      d.firstChild.style.width = (k * 100) + '%';
      d.lastChild.style.color = k > .6 ? '#000' : 'var(--muted)';
    });
    el('kit-clock').textContent = t.toFixed(1);
  }
  // carryOn: Play picks up where it paused, its beat's line too; anything else starts afresh, cutting the voice short
  function run(from, to, carryOn) {
    document.body.classList.remove('rest');
    var playingBeat = beatIndexAt(from);
    var midLine = talk.beat >= 0 && from > BEATS[talk.beat].at + .01 && from <= end(talk.beat) + .001;
    if (!carryOn || !midLine) hush();
    else if (talk.paused) { talk.paused = false; tell({ kit: 'resume' }); }
    cancelAnimationFrame(raf); t = from; stopAt = to; playing = true; hold = -1; el('kit-pp').textContent = '❚❚ Pause';
    var last = performance.now();
    var step = function (now) {
      // the beat being said holds on its last frame until its line is done
      var until = voice && !talk.done && end(talk.beat) < stopAt && end(talk.beat) >= t ? end(talk.beat) : stopAt;
      // a frame's timestamp can come from just before the click that started the run: never step back into the beat before
      t = Math.min(until, t + Math.max(0, now - last) / 1000); last = now;
      var waiting = until < stopAt && t >= until;
      if (waiting) hold = talk.beat;
      else if (t >= stopAt && stopAt < DUR) hold = playingBeat;
      else hold = -1;
      if (voice && !waiting && t < stopAt && beatAt(t) !== talk.beat) say(beatAt(t));
      frame();
      if (t < stopAt && playing) raf = requestAnimationFrame(step); else stop();
    };
    raf = requestAnimationFrame(step);
  }
  function stop() {
    playing = false; cancelAnimationFrame(raf); el('kit-pp').textContent = t >= DUR ? '↻ Replay' : '▶ Play';
    if (t >= DUR) window.kitDone = true;
  }
  function pause() {
    stop();
    if (!talk.done && !talk.paused) { talk.paused = true; tell({ kit: 'pause' }); }
  }
  // the beat t is in; beatIndexAt allows for t landing a hair short of a beat's start
  function beatAt(at) { var bi = 0; BEATS.forEach(function (b, i) { if (at >= b.at) bi = i; }); return bi; }
  function beatIndexAt(at) { var bi = 0; BEATS.forEach(function (b, i) { if (at >= b.at - .01) bi = i; }); return bi; }
  var beatIndex = function () { return beatIndexAt(t); };
  // the office records the screen's video by playing it once from the top
  window.kitPlay = function () { window.kitDone = false; run(0, DUR); };
  el('kit-run').onclick = function () { run(0, DUR); };
  el('kit-pp').onclick = function () { if (playing) pause(); else run(t >= DUR ? 0 : t, DUR, true); };
  el('kit-next').onclick = function () {
    if (t >= DUR) return run(0, end(0));
    var i = beatIndex(), e = end(i), done = t >= e - .01;
    run(done ? e : t, done ? end(i + 1) : e, !done);
  };
  el('kit-prev').onclick = function () { var cur = beatIndex(), i = Math.max(0, cur - (t - BEATS[cur].at < .5 ? 1 : 0)); run(BEATS[i].at, end(i)); };
  // the screen offers the voice once it has the lines, and says whether it's on; the button asks it to switch
  el('kit-voice').onclick = function () { tell({ kit: 'voice', on: !voice }); };
  addEventListener('message', function (e) {
    var m = e.data;
    if (!screen || e.source !== screen || !m || typeof m.kit !== 'string') return;
    if (m.kit === 'voice') {
      voice = !!m.on;
      document.body.classList.add('voiced');
      el('kit-voice').classList.toggle('on', voice);
      el('kit-voice').textContent = voice ? 'Voice on' : 'Voice off';
      if (!voice) hush();
    } else if (m.kit === 'said' && m.beat === talk.beat) talk.done = true;
    // a new version that changed this beat: it waits at the beat's start, to play from there
    else if (m.kit === 'show' && BEATS[m.beat]) { stop(); hush(); hold = -1; document.body.classList.remove('rest'); t = BEATS[m.beat].at; frame(); stop(); }
  });
  tell({ kit: 'lines', lines: BEATS.map(function (b) { return b.say; }), titles: BEATS.map(function (b) { return b.title; }) });
  addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') el('kit-next').click();
    else if (e.key === 'ArrowLeft') el('kit-prev').click();
    else if (e.key === ' ') { e.preventDefault(); (document.body.classList.contains('rest') ? el('kit-run') : el('kit-pp')).click(); }
  });
  // a dry run through every moment before resting on the last, so a stage that breaks partway through says so up front
  if (draw) for (var s = 0; s <= DUR; s += .25) try { draw(s); } catch (err) { draw = null; window.kitFault(describe(err, s)); break; }
  frame(); stop();
  // for a stage whose things arrive later (a texture, a font): draw the frame it's on again
  window.kitRedraw = frame;
  // the office's pictures of each beat jump straight to a moment, lit as when playing
  window.kitSeek = function (at) { stop(); hush(); hold = -1; document.body.classList.remove('rest'); t = at; frame(); };
  // and what the office's checks see in each: how much of the stage is its commonest colour (counted in coarse steps,
  // so a JPEG's noise doesn't split one colour into many)
  window.kitSeen = function (jpeg) {
    var img = new Image();
    img.src = 'data:image/jpeg;base64,' + jpeg;
    return img.decode().then(function () {
      var canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      var g = canvas.getContext('2d');
      g.drawImage(img, 0, 0);
      var px = g.getImageData(0, 0, img.width, img.height).data, counts = new Map(), n = 0, most = 0;
      for (var i = 0; i < px.length; i += 8) {
        var key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4), c = (counts.get(key) || 0) + 1;
        counts.set(key, c); if (c > most) most = c; n++;
      }
      return { flat: most / n };
    });
  };
  window.kitReady = true;
})();
`;
