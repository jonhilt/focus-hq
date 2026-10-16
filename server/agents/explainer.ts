import type { ArtifactInput } from './lead';

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

/** The three.js a 3D stage loads: the office's own (package.json), so what a lead learns here holds there too. */
export const THREE_VERSION = '0.186.1';
const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
/** Libraries a stage can ask for: three.js, and its addons by path (`three/addons/environments/RoomEnvironment.js`). */
const LIB = /^three(\/addons\/[\w-]+(\/[\w-]+)*\.js)?$/;
/** The addon kit3d lights its scenes with, loaded with three whether the stage asks for it or not. */
const ROOM_ENVIRONMENT = 'three/addons/environments/RoomEnvironment.js';

export interface ExplainerBeat {
  title: string;
  /** The caption under the stage while it plays. */
  text: string;
  seconds: number;
  /** A word or two for its block down the left and its part of the timeline; the title's first words when missing. */
  label?: string;
  /** What the voice says over it, talking the captain through the stage; its title and caption when missing. */
  narration?: string;
}

export interface ExplainerInput {
  id: string;
  title: string;
  beats: ExplainerBeat[];
  /** The scene: its elements, their styles, and a script that defines render(t). */
  stage: { html: string; css?: string; script: string; libs?: string[] };
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

/** What the office saw on the stage at one moment: how much of it is one flat colour, and where kit3d's labels landed. */
export interface StageMoment {
  at: number;
  /** The share (0 to 1) of the stage's pixels that are its commonest colour. */
  flat: number;
  /** kit3d's labels showing, in stage pixels, and whether what each is pinned to is in view. */
  labels: { text: string; x: number; y: number; w: number; h: number; onScreen: boolean }[];
}

/** A stage this close to one colour all over has nothing on it (a lone small label is about 0.997). */
const EMPTY = 0.999;
/** More labels than this at once crowd a stage. */
const MANY_LABELS = 6;

/** What looks wrong at each moment, a line per beat, for the lead to fix: nothing when all looks well. */
export function momentNotes(moments: readonly StageMoment[]): string[] {
  return moments.flatMap((m, i) => {
    const which = `Beat ${i + 1}`;
    if (m.flat >= EMPTY) return [`${which} looks empty (one flat colour across the stage): check that the camera faces the scene, that it's lit, and that render(t) draws it.`];
    const seen: string[] = [];
    for (const l of m.labels) {
      if (!l.onScreen) seen.push(`the "${l.text}" label's object is out of view`);
      else if (l.x < 0 || l.y < 0 || l.x + l.w > STAGE_SIZE.w || l.y + l.h > STAGE_SIZE.h) seen.push(`the "${l.text}" label is cut off at the stage's edge`);
    }
    m.labels.forEach((a, j) => {
      for (const b of m.labels.slice(j + 1)) {
        const across = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const down = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (across > 4 && down > 4) seen.push(`the "${a.text}" and "${b.text}" labels overlap`);
      }
    });
    if (m.labels.length > MANY_LABELS) seen.push(`${m.labels.length} labels at once: a handful reads better`);
    return seen.length ? [`${which}: ${seen.join('; ')}.`] : [];
  });
}

/** What the lead hears with the pictures of their explainer's beats: what the office's checks found, and to look. */
export function explainerCheck(notes: readonly string[]): string {
  const look = "Here's the stage at the middle of each beat, in order: look at each, and if one doesn't show what its caption says, fix it and explain it again under the same id.";
  return notes.length ? `${look} The office's checks found: ${notes.join(' ')}` : `${look} The office's checks (an empty stage, labels out of view, cut off or overlapping) found nothing.`;
}

/** The player page for an explainer, ready to show under its id and title. Or why it was refused. */
export function explainerPage(input: ExplainerInput): ArtifactInput | { error: string } {
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
  const { html, css = '', script, libs = [] } = input.stage;
  if (!script.trim()) return { error: 'The stage needs a script that defines render(t)' };
  const odd = libs.find((lib) => !LIB.test(lib));
  if (odd !== undefined) return { error: `The stage can't load "${odd}": libs takes "three" and its addons, like "three/addons/environments/RoomEnvironment.js"` };
  if (libs.length && !libs.includes('three')) return { error: 'Addons need three itself: put "three" in libs too' };
  if (/<\/script/i.test(script)) return { error: 'The stage script can’t contain </script>: build that string in pieces' };
  if (/<\/style/i.test(css)) return { error: 'The stage CSS can’t contain </style>' };
  if (Buffer.byteLength(html + css + script) > L.stageBytes) return { error: `The stage is over ${L.stageBytes / 1_000_000} MB: keep it small` };

  let at = 0;
  const beats = input.beats.map((b, i) => {
    const beat = { at, title: clean(b.title), text: clean(b.text), label: beatLabel(b), colour: BEAT_COLOURS[i], say: beatNarration(b) };
    at += b.seconds;
    return beat;
  });
  const title = clean(input.title);
  return { id: input.id, title, html: page(title, beats, at, html, css, script, libs.length ? [...new Set([...libs, ROOM_ENVIRONMENT])] : []) };
}

/** The player around the lead's stage. The kit's own script defines its helpers on window, so the lead's names win. */
function page(title: string, beats: { at: number; title: string; text: string; label: string; colour: string; say: string }[], dur: number, stageHtml: string, stageCss: string, stageScript: string, libs: string[]): string {
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
${libs.length ? `<script type="importmap">${scriptJson({ imports: { three: `${THREE_CDN}/build/three.module.js`, 'three/addons/': `${THREE_CDN}/examples/jsm/` } })}</script>` : ''}
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
${libs.length ? `<script type="text/x-kit" id="kit-3d">${KIT_3D}</script>
<script type="text/x-kit" id="kit-stage">
${stageScript}
</script>
<script type="text/x-kit" id="kit-player">${KIT_PLAYER}</script>
<script type="module">${KIT_LOADER.replace('LIBS', scriptJson(libs))}</script>` : `<script>
${stageScript}
</script>
<script>${KIT_PLAYER}</script>`}
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
  .caption .bx { font:400 22px/1.4 var(--ui); color:var(--text); letter-spacing:.02em; max-width:1020px; }
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
  canvas.kit3d { position:absolute; left:0; top:0; width:100%; height:100%; }
  .pill.kit3d-label { height:30px; border-radius:15px; font-size:16px; line-height:30px; padding:0 13px; transform:translate(-50%, -100%); pointer-events:none; }
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
// voice is on it sets the pace: a beat holds on its last frame until its line is finished. It tells the screen which beat
// it's on as that changes, so a question the captain asks about it says where they were, and the screen can pause it.
const KIT_PLAYER = String.raw`
(function () {
  var BEATS = window.KIT_BEATS, DUR = window.KIT_DUR, el = function (id) { return document.getElementById(id); };
  var draw = typeof render === 'function' ? render : null;
  if (!draw) window.kitFault('The stage script must define render(t).');
  var end = function (i) { return i + 1 < BEATS.length ? BEATS[i + 1].at : DUR; };
  // hold: the beat a step just finished, whose caption stays up while its last frame does (t is then the next one's start)
  var t = DUR, raf = 0, stopAt = DUR, playing = false, hold = -1;
  // the voice-over: whether it's on, and the beat whose line is being said (-1 for none), finished or paused
  var screen = window.parent !== window ? window.parent : null, voice = false;
  var talk = { beat: -1, done: true, paused: false };
  var tell = function (message) { if (screen) screen.postMessage(message, '*'); };
  function say(i) { talk = { beat: i, done: false, paused: false }; tell({ kit: 'say', beat: i }); }
  function hush() { if (!talk.done) tell({ kit: 'hush' }); talk = { beat: -1, done: true, paused: false }; }
  // the beat last shown, as the screen was told
  var shownBeat = -1;
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
  var describe = function (err, at) { return (at === undefined ? '' : 'at t = ' + at.toFixed(2) + 's: ') + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : String(err)); };
  function frame() {
    if (draw) try { draw(t); } catch (err) { draw = null; window.kitFault(describe(err)); stop(); }
    var bi = beatAt(t);
    if (hold >= 0 && Math.abs(t - end(hold)) < .001) bi = hold;
    el('kit-bt').textContent = BEATS[bi].title; el('kit-bx').textContent = BEATS[bi].text;
    if (bi !== shownBeat) { shownBeat = bi; tell({ kit: 'beat', beat: bi, title: BEATS[bi].title }); }
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
    // the captain's asking about it: it waits, its line too, until they play it again
    else if (m.kit === 'pause') pause();
  });
  tell({ kit: 'lines', lines: BEATS.map(function (b) { return b.say; }) });
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
  window.kitReady = true;
})();
`;

// A stage that loads libraries runs once they have: its script and the player wait in inert elements until then, so
// render(t) can use THREE straight away, as a classic script (its render on window, where the player looks for it).
// THREE holds three.js and every addon asked for, so an addon's classes sit beside the core's (THREE.RoomEnvironment).
const KIT_LOADER = String.raw`
var libs = LIBS;
Promise.all(libs.map(function (lib) { return import(lib); })).then(function (mods) {
  window.THREE = Object.assign.apply(Object, [{}].concat(mods));
  ['kit-3d', 'kit-stage', 'kit-player'].forEach(function (id) {
    var s = document.createElement('script');
    s.text = document.getElementById(id).textContent;
    document.body.appendChild(s);
  });
}, function (err) {
  window.kitFault('Couldn’t load ' + libs.join(', ') + ': ' + (err && err.message || err));
});
`;

// kit3d(): the scaffold a 3D stage starts from, so a lead writes the scene and render(t), not the setup. A renderer the
// size of the stage behind its HTML, lit by a soft studio environment and a key light, a camera, a grid to stand on;
// named objects, camera shots that hold still through a beat and move only at its start, and HTML labels that follow
// objects. draw(t) renders and leaves window.__scene saying where everything ended up, for the office's checks.
const KIT_3D = String.raw`
window.kit3d = function (opts) {
  opts = opts || {};
  var W = stage.clientWidth || ${STAGE_SIZE.w}, H = stage.clientHeight || ${STAGE_SIZE.h};
  var canvas = document.createElement('canvas'); canvas.className = 'kit3d';
  stage.insertBefore(canvas, stage.firstChild);
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  var scene = new THREE.Scene();
  var pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture; pmrem.dispose();
  var key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(5, 10, 7); scene.add(key);
  var camera = new THREE.PerspectiveCamera(opts.fov || 40, W / H, 0.1, 200);
  var target = new THREE.Vector3();
  var size = opts.grid === undefined ? 12 : opts.grid;
  if (size) scene.add(new THREE.GridHelper(size, size * 2, 0x9999ff, 0x3a3352));
  var named = {}, labels = [], v = new THREE.Vector3(), box = new THREE.Box3();
  function look(pos, at) { camera.position.set(pos[0], pos[1], pos[2]); target.set(at[0], at[1], at[2]); camera.lookAt(target); }
  look([6, 5, 9], [0, 0.5, 0]);
  function onScreen(p) { return p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1; }
  // where a label sits: just over the top of its object, or at a point
  function anchor(target) {
    if (target.isObject3D) { box.setFromObject(target); box.getCenter(v); v.y = box.max.y + 0.15; return v; }
    return v.set(target[0], target[1], target[2]);
  }
  var k = {
    THREE: THREE, scene: scene, camera: camera, renderer: renderer,
    add: function (name, obj) { obj.name = name; named[name] = obj; scene.add(obj); return obj; },
    look: look,
    // one shot per beat ({ pos, look }): the camera holds through a beat and eases to the next shot in its first seconds
    shots: function (t, list, move) {
      move = move || 1.2;
      var i = 0;
      B.forEach(function (b, j) { if (t >= b && j < list.length) i = j; });
      var from = list[Math.max(0, i - 1)], to = list[i], f = i === 0 ? 1 : window.p(t, B[i], B[i] + move);
      var mix = function (a, b) { return [0, 1, 2].map(function (n) { return a[n] + (b[n] - a[n]) * f; }); };
      look(mix(from.pos, to.pos), mix(from.look || [0, 0.5, 0], to.look || [0, 0.5, 0]));
    },
    label: function (text, colour) {
      var el = document.createElement('div');
      el.className = 'pill kit3d-label'; el.style.setProperty('--c', 'var(--' + (colour || 'lilac') + ')'); el.textContent = text;
      stage.appendChild(el);
      var l = { text: text, el: el, target: null, opacity: 0 };
      // at(object or [x, y, z], opacity): call it in render(t) for every frame the label shows; a frame that doesn't
      // hides it, so jumping back to before it appears hides it too (hide() says so outright)
      l.at = function (target, opacity) { l.target = target; l.opacity = opacity === undefined ? 1 : opacity; return l; };
      l.hide = function () { l.opacity = 0; return l; };
      labels.push(l);
      return l;
    },
    draw: function (t) {
      scene.updateMatrixWorld(); camera.updateMatrixWorld();
      renderer.render(scene, camera);
      var shown = [];
      labels.forEach(function (l) {
        if (!l.target || l.opacity <= 0) { l.el.style.display = 'none'; return; }
        var at = anchor(l.target).project(camera), seen = onScreen(at);
        l.el.style.display = at.z < 1 ? '' : 'none';
        l.el.style.left = ((at.x + 1) / 2 * W) + 'px'; l.el.style.top = ((1 - at.y) / 2 * H) + 'px'; l.el.style.opacity = l.opacity;
        shown.push({ text: l.text, onScreen: seen });
      });
      labels.forEach(function (l) { l.target = null; l.opacity = 0; });
      window.__scene = {
        t: t,
        camera: { position: camera.position.toArray(), target: target.toArray() },
        objects: Object.keys(named).map(function (name) {
          var o = named[name];
          return { name: name, visible: o.visible, onScreen: onScreen(o.getWorldPosition(v).project(camera)) };
        }),
        labels: shown,
      };
    },
  };
  return k;
};
`;
