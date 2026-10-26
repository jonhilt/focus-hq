// The stream lab's voices (lab.js, the Voice slot): the thread told by the chief of staff rather than by the lead and
// the chief of staff in turn. Each of the lead's turns leaves the thread, and the chief of staff's reading of it, to
// the user, stands in its place (`says` on a verdict: today's verdicts have only `why`, written about the lead). The
// variations differ in how the lead's own words stay a glance away on the same screen.
(function () {
  const V = window.labVariation;
  const ROUTE = {
    1: { label: 'Carrying on', c: 'var(--muted)' },
    2: { label: 'For you', c: 'var(--lcars-gold)' },
    3: { label: 'Needs you now', c: 'var(--lcars-red)' },
    4: { label: 'Sent back to the lead', c: 'var(--lcars-lilac)' },
  };
  const short = (g) => g.lead.replace(/^Lt\. /, '');
  const latestTurn = (g) => g.entries.findLast((e) => e.kind === 'lead');

  /** One reading of the chief of staff's: who, what it made of the turn, and its say on where it goes. */
  function reading(ctx, g, item, ...extra) {
    const { h } = ctx;
    const r = ROUTE[item.entry.route];
    return h('div', { class: `rd r${item.entry.route}`, style: `--rc:${r.c}`, 'data-turn': item.turn?.at ?? '' },
      h('div', { class: 'rd-h' }, h('b', null, 'Chief of staff'), h('span', { class: 'rd-route' }, r.label), h('small', null, ctx.time(item.entry.at))),
      h('div', { class: 'rd-says' }, item.entry.says ?? item.entry.why),
      item.entry.superseded ? h('div', { class: 'rd-gone' }, `Answered when you wrote to ${g.lead} directly`) : null,
      item.entry.route === 4 && item.entry.message ? h('details', { class: 'rd-sent' }, h('summary', null, 'What I told the lead'), h('div', null, item.entry.message)) : null,
      ...extra);
  }
  /** The CoS-first thread: readings in place of turns, the user's words and the quiet lines as the other slots draw them. */
  const rows = (ctx, g, readingOf) => ctx.cosSegments(g.entries, ctx.seen[g.id]).map((s) =>
    s.type === 'new' ? ctx.newLine() : s.type === 'reading' ? readingOf(s) : s.type === 'quiet' ? ctx.quietRun(s.entries, g) : ctx.message(s.entry, g));

  const CSS = `
    .rd { --rc: var(--muted); max-width: 74ch; border-left: 3px solid var(--rc); padding: 6px 0 6px 12px; margin: 4px 0; }
    .rd-h { display: flex; gap: 10px; align-items: baseline; font-size: 12px; color: var(--muted); }
    .rd-h b { font: 600 12px/1 var(--ui); letter-spacing: 0.12em; text-transform: uppercase; color: var(--lcars-peach); }
    .rd-route { color: var(--rc); font-weight: 600; }
    .rd-h small { margin-left: auto; font-size: 12px; }
    .rd-says { font-size: 16px; line-height: 1.5; margin-top: 2px; }
    .rd.r1 .rd-says { opacity: 0.85; }
    .rd-sent { font-size: 14px; margin-top: 4px; }
    .rd-gone { font-size: 13px; color: var(--muted); margin-top: 2px; }
    .rd-gone::before { content: '✓ '; color: var(--lcars-green); }
    .rd:has(.rd-gone) .rd-says { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--muted) 70%, transparent); opacity: 0.7; }
    .rd-sent summary, .rd-peek { cursor: pointer; color: var(--lcars-sky); font-size: 13px; }
    .rd-sent > div { border-left: 2px solid var(--lcars-lilac); padding: 2px 10px; margin-top: 4px; }
    .rd.hot { background: color-mix(in srgb, var(--surface-2) 70%, transparent); }
    .lead-turn { background: var(--surface-2); border-radius: 10px; padding: 10px 14px; font-size: 15px; line-height: 1.5; }
    .lead-turn > small { display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }
    .lead-turn .st-md > :last-child { margin-bottom: 0; }
    /* on the Paper skin (20), the ship's orange labels darken to read */
    .v-20.v-23 .pane-h, .v-20.v-24 .latest > small { color: #a5591f; }
  `;

  // a lead's turn, whole, as a quoted block: the side and the pane show it so
  const turnEl = (ctx, g, e, cls = '') => ctx.h('div', { class: `lead-turn ${cls}`, 'data-at': e.at }, ctx.h('small', null, `${g.lead} · ${ctx.time(e.at)}`), ctx.h('div', { class: 'st-md', html: ctx.md(e.text) }));

  V({
    id: 21, slot: 'voice', name: 'CoS speaks, the lead\'s words beside',
    idea: 'The thread is the chief of staff\'s readings; a column beside it holds the lead\'s recent messages, newest first. Point at a reading to find the turn it read.',
    css: CSS + `
      .v-21 .words { display: flex; flex-direction: column; gap: 8px; }
      .v-21 .words .lead-turn { transition: box-shadow 0.15s; }
      .v-21 .words .lead-turn.hot { box-shadow: inset 0 0 0 2px var(--lcars-orange); }
      .v-21 .words .lead-turn:not(.open) .st-md { max-height: 9em; overflow: hidden; -webkit-mask-image: linear-gradient(#000 60%, transparent); mask-image: linear-gradient(#000 60%, transparent); cursor: pointer; }
    `,
    thread(ctx, g) {
      const { h } = ctx;
      const turns = g.entries.filter((e) => e.kind === 'lead').slice(-6).reverse();
      const side = h('div', { class: 'words' }, h('h3', null, `${short(g)}'s recent messages`),
        turns.length ? turns.map((e, i) => {
          const el = turnEl(ctx, g, e, i === 0 ? 'open' : '');
          el.addEventListener('click', () => el.classList.add('open'));
          return el;
        }) : h('p', { class: 'muted' }, 'Nothing from them yet.'));
      const point = (at, on) => {
        const t = side.querySelector(`.lead-turn[data-at="${at}"]`);
        if (!t) return;
        t.classList.toggle('hot', on);
        if (on) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      return {
        rows: rows(ctx, g, (s) => {
          const el = reading(ctx, g, s);
          el.addEventListener('mouseenter', () => point(s.turn?.at, true));
          el.addEventListener('mouseleave', () => point(s.turn?.at, false));
          return el;
        }),
        side,
      };
    },
  });

  V({
    id: 22, slot: 'voice', name: 'CoS speaks, the lead\'s words folded under',
    idea: 'Each reading has the turn it read folded under it: one press opens the lead\'s own words in place, drawn as the Messages slot draws them.',
    css: CSS + `
      .v-22 .rd-fold > summary { list-style: none; cursor: pointer; color: var(--lcars-sky); font-size: 13px; margin-top: 4px; }
      .v-22 .rd-fold > summary::-webkit-details-marker { display: none; }
      .v-22 .rd-fold[open] > summary { margin-bottom: 4px; }
      .v-22 .rd-fold > :not(summary) { border-left: 2px solid var(--line); padding-left: 12px; }
    `,
    thread(ctx, g) {
      return { rows: rows(ctx, g, (s) => reading(ctx, g, s, s.turn ? ctx.h('details', { class: 'rd-fold' }, ctx.h('summary', null, `${short(g)}'s words ›`), ctx.message(s.turn, g)) : null)) };
    },
  });

  let peekAt = null;
  V({
    id: 23, slot: 'voice', name: 'CoS speaks, a pane to read the lead',
    idea: 'Readings above, and under them a pane with the lead\'s turn in full, like a mail reader. It shows the latest; press any reading to read the turn behind it.',
    css: CSS + `
      .v-23 .rd { cursor: pointer; border-radius: 0 8px 8px 0; }
      .v-23 .rd:hover { background: color-mix(in srgb, var(--surface-2) 50%, transparent); }
      .v-23 .rd.sel { background: var(--surface-2); }
      .v-23 .pane { border-top: 2px solid var(--lcars-orange); padding-top: 8px; min-height: 120px; }
      .v-23 .pane .lead-turn { background: transparent; padding: 0; }
      .v-23 .pane-h { display: flex; justify-content: space-between; font: 600 12px/1 var(--ui); letter-spacing: 0.12em; text-transform: uppercase; color: var(--lcars-orange); margin-bottom: 6px; }
      .v-23 .pane-h button { background: none; border: 0; color: var(--lcars-sky); cursor: pointer; font: inherit; }
    `,
    thread(ctx, g) {
      const { h } = ctx;
      const all = g.entries.filter((e) => e.kind === 'lead');
      const shown = all.find((e) => e.at === peekAt) ?? all.at(-1);
      const idx = all.indexOf(shown);
      const go = (e) => { peekAt = e?.at ?? null; ctx.render(); };
      const below = h('div', { class: 'pane' },
        h('div', { class: 'pane-h' }, h('span', null, shown ? `${short(g)}'s words · ${idx + 1} of ${all.length}` : `${short(g)}'s words`),
          h('span', null, h('button', { disabled: idx <= 0, onclick: () => go(all[idx - 1]) }, '‹ older'), ' ', h('button', { disabled: idx >= all.length - 1, onclick: () => go(all[idx + 1]) }, 'newer ›'))),
        shown ? turnEl(ctx, g, shown) : h('p', { class: 'muted' }, 'Nothing from them yet.'));
      return {
        rows: rows(ctx, g, (s) => {
          const el = reading(ctx, g, s);
          if (s.turn && s.turn === shown) el.classList.add('sel');
          el.addEventListener('click', (e) => { if (!e.target.closest('details')) go(s.turn); });
          return el;
        }),
        below,
      };
    },
  });

  V({
    id: 24, slot: 'voice', name: 'CoS speaks, the latest from the lead whole',
    idea: 'The past is the chief of staff\'s readings; the lead\'s latest turn, the one you\'d answer, stays whole at the end. Hover an older reading for the start of what it read.',
    css: CSS + `
      .v-24 .latest { margin-top: 10px; }
      .v-24 .latest > small { display: block; font: 600 12px/1 var(--ui); letter-spacing: 0.12em; text-transform: uppercase; color: var(--lcars-orange); margin-bottom: 6px; }
    `,
    thread(ctx, g) {
      const last = latestTurn(g);
      const out = rows(ctx, g, (s) => {
        const el = reading(ctx, g, s);
        if (s.turn && s.turn !== last) el.title = `${g.lead}: ${ctx.firstPara(s.turn.text)}`;
        return el;
      });
      // the latest turn goes after its reading, so the user reads the summary, then the words they'd answer
      if (last) out.push(ctx.h('div', { class: 'latest' }, ctx.h('small', null, `Latest from ${short(g)}`), ctx.message(last, g)));
      return { rows: out };
    },
  });

  let heard = 'cos';
  V({
    id: 25, slot: 'voice', name: 'Switch whose voice',
    idea: 'A switch at the top of the thread: the chief of staff alone, the lead alone, or both as today. One press to check the lead\'s words, and it stays where you left it.',
    css: CSS + `
      .v-25 .who-switch { position: sticky; top: 0; z-index: 2; align-self: center; display: inline-flex; background: var(--surface-2); border-radius: 999px; padding: 3px; margin-bottom: 6px; box-shadow: 0 6px 14px #000a; }
      .v-25 .who-switch button { background: none; border: 0; border-radius: 999px; padding: 5px 14px; cursor: pointer; font-size: 13px; color: var(--muted); }
      .v-25 .who-switch button.on { background: var(--lcars-orange); color: var(--ink); font-weight: 600; }
    `,
    thread(ctx, g) {
      const { h } = ctx;
      const sw = h('div', { class: 'who-switch' }, [['cos', 'Chief of staff'], ['lead', short(g)], ['both', 'Both']].map(([k, label]) =>
        h('button', { class: heard === k ? 'on' : '', onclick: () => { heard = k; ctx.render(); } }, label)));
      if (heard === 'cos') return { rows: [sw, rows(ctx, g, (s) => reading(ctx, g, s))] };
      if (heard === 'both') return { rows: [sw, ctx.drawMessages(ctx.segments(g.entries, ctx.seen[g.id]), g)] };
      // the lead alone: their turns and the user's words, nothing between
      const talk = g.entries.filter((e) => e.kind === 'lead' || e.kind === 'you');
      return { rows: [sw, talk.map((e) => ctx.message(e, g))] };
    },
  });
  // the workspace voices (workspace.js) tell the thread the same way
  window.labVoice = { reading, rows, turnEl, CSS };
})();
