// The stream lab's workspace voices (lab.js, the Voice slot): the centre is the chief of staff's alone, and the lead's
// workspace (their conversation, what they put on their screen, their browser preview, their pull requests and what
// they've been doing) opens in a pane to the right. Each reading carries a way into the part of it that it read.
(function () {
  const V = window.labVariation;
  const { reading, rows, turnEl, CSS } = window.labVoice;
  const short = (g) => g.lead.replace(/^Lt\. /, '');
  const working = (g) => ['working', 'testing', 'pushing', 'setting-up'].includes(g.status);

  /** Where the pane is: its tab, the turn or artifact it points at, and (as a drawer) whether it's open. */
  const ws = { goal: null, tab: 'talk', at: null, art: null, open: false };
  window.addEventListener('lab-reset', () => Object.assign(ws, { goal: null, open: false }));
  /** The last ctx drawn with a workspace, so the talk box's "Write to …" (lab.js) can open it. */
  let lastCtx = null;
  window.labWorkspace = { open: (tab) => lastCtx && show(lastCtx, tab) };
  const show = (ctx, tab, at = null, art = null) => {
    Object.assign(ws, { tab, at, art, open: true });
    ctx.render();
  };

  /** What a reading read: the turn, and what the lead put on their screen while working towards it. */
  function behind(g, item, prevAt) {
    const arts = (g.artifacts ?? []).filter((a) => a.at > prevAt && a.at <= item.entry.at);
    return { turn: item.turn, arts };
  }

  /** The chief of staff's thread, each reading with its ways into the workspace. */
  function thread(ctx, g, pinned) {
    const { h } = ctx;
    const open = pinned || ws.open;
    lastCtx = ctx;
    if (ws.goal !== g.id) Object.assign(ws, { goal: g.id, tab: 'talk', at: null, art: null, open: false });
    let prevAt = 0;
    const latestReading = g.entries.findLast((e) => e.kind === 'cos');
    return rows(ctx, g, (s) => {
      const { turn, arts } = behind(g, s, prevAt);
      prevAt = s.entry.at;
      const chips = h('div', { class: 'ws-chips' },
        turn ? h('button', { class: `ws-chip${open && ws.tab === 'talk' && ws.at === turn.at ? ' on' : ''}`, onclick: (e) => { e.stopPropagation(); show(ctx, 'talk', turn.at); } }, `${short(g)}'s words`) : null,
        arts.map((a) => h('button', { class: `ws-chip${open && ws.tab === 'screen' && ws.art === a ? ' on' : ''}`, onclick: (e) => { e.stopPropagation(); show(ctx, 'screen', null, a); } }, `▣ ${a.title}`)),
        s.entry === latestReading && g.preview ? h('button', { class: 'ws-chip', onclick: (e) => { e.stopPropagation(); show(ctx, 'browser'); } }, '◍ Their preview') : null);
      const el = reading(ctx, g, s, chips);
      if (open && turn && ws.at === turn.at && ws.tab === 'talk') el.classList.add('hot');
      return el;
    });
  }

  /** The lead's workspace: a tab for each part, the one picked below. */
  function pane(ctx, g, drawer) {
    const { h } = ctx;
    const talk = g.entries.filter((e) => e.kind === 'lead' || e.kind === 'you');
    const arts = g.artifacts ?? [];
    const prs = g.prs ?? [];
    const act = g.activity ?? [];
    const TABS = [
      ['talk', 'Conversation', talk.length],
      ['screen', 'Screen', arts.length],
      ['browser', 'Browser', g.preview ? 1 : 0],
      ['prs', 'Pull requests', prs.length],
      ['activity', 'Activity', act.length],
    ];
    const body = h('div', { class: 'ws-body' });
    if (ws.tab === 'talk') {
      body.append(...(talk.length ? talk.map((e) => {
        const el = ctx.message(e, g);
        el.dataset.at = e.at;
        if (e.at === ws.at) el.classList.add('ws-focus');
        return el;
      }) : [h('p', { class: 'muted' }, 'Nothing said yet.')]));
      // to the turn a reading pointed at, else the latest
      requestAnimationFrame(() => {
        const to = body.querySelector('.ws-focus');
        body.scrollTop = to ? to.offsetTop - body.offsetTop - 8 : body.scrollHeight;
      });
    } else if (ws.tab === 'screen') {
      const shown = ws.art && arts.includes(ws.art) ? ws.art : arts.at(-1);
      body.append(...(shown ? [
        h('div', { class: 'ws-art-h' }, h('b', null, shown.title), h('small', null, `${shown.kind} · ${ctx.time(shown.at)}`)),
        h('iframe', { class: 'ws-frame', srcdoc: shown.html, title: shown.title }),
        arts.length > 1 ? h('div', { class: 'ws-thumbs' }, [...arts].reverse().map((a) => h('button', { class: `ws-thumb${a === shown ? ' on' : ''}`, onclick: () => show(ctx, 'screen', null, a) }, h('b', null, a.title), h('small', null, `${a.kind} · ${ctx.ago(a.at)} ago`)))) : null,
      ] : [h('p', { class: 'muted' }, `${short(g)} hasn't put anything on their screen.`)]));
    } else if (ws.tab === 'browser') {
      body.append(...(g.preview ? [
        h('div', { class: 'ws-url' }, h('span', null, '◍'), g.preview.url),
        h('iframe', { class: 'ws-frame tall', srcdoc: g.preview.html, title: 'Their preview' }),
      ] : [h('p', { class: 'muted' }, `${short(g)} has no preview open.`)]));
    } else if (ws.tab === 'prs') {
      body.append(...(prs.length ? prs.map((p) => {
        const said = g.entries.filter((e) => e.kind === 'ops' && e.text.includes(`#${p.number}`));
        return h('div', { class: `ws-pr ${p.state}` },
          h('div', null, h('b', null, p.title), h('span', { class: 'ws-state' }, p.state === 'qa' ? 'with QA' : p.state)),
          h('small', null, `${p.repo}#${p.number}`),
          said.map((e) => h('div', { class: 'ws-pr-line' }, `${e.from}: ${e.text}`)));
      }) : [h('p', { class: 'muted' }, 'No pull requests yet.')]));
    } else {
      body.append(...(act.length ? act.map((a) => h('div', { class: `ws-act${a.bad ? ' bad' : ''}${a.live ? ' live' : ''}${a.quiet ? ' quiet' : ''}` }, h('small', null, ctx.time(a.at)), h('span', null, a.text))) : [h('p', { class: 'muted' }, 'Nothing recorded.')]));
    }
    lastCtx = ctx;
    // the box to talk to the lead goes here when the Talk box slot says so (28), under every tab: it's who it's for
    const box = ctx.pick.talk === '28' ? ctx.talk(g, { inWorkspace: true, rows: 2, placeholder: `Write to ${g.lead}: it goes straight to them` }) : null;
    return h('div', { class: `ws${drawer ? ' drawer' : ''}` },
      h('div', { class: 'ws-h' },
        h('i', { class: `ws-live${working(g) ? ' on' : ''}${g.status === 'error' ? ' bad' : ''}` }),
        h('b', null, `${g.lead}'s workspace`), h('small', null, ctx.doing(g.status)),
        drawer ? h('button', { class: 'ws-close', title: 'Close', onclick: () => { ws.open = false; ctx.render(); } }, '×') : null),
      h('div', { class: 'ws-tabs' }, TABS.map(([k, label, n]) => h('button', { class: `ws-tab${ws.tab === k ? ' on' : ''}`, onclick: () => show(ctx, k, k === 'talk' ? ws.at : null, k === 'screen' ? ws.art : null) }, label, n ? h('span', null, String(n)) : null))),
      body,
      box);
  }

  const WS_CSS = CSS + `
    .ws { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; font: 15px/1.5 var(--read); }
    .ws-h { display: flex; gap: 10px; align-items: baseline; }
    .ws-h b { font: 600 15px/1 var(--ui); letter-spacing: 0.08em; text-transform: uppercase; color: var(--lcars-orange); }
    .ws-h small { color: var(--muted); font-size: 13px; }
    .ws-live { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); align-self: center; }
    .ws-live.on { background: var(--lcars-green); animation: lab-pulse 1.4s infinite; }
    .ws-live.bad { background: var(--lcars-red); }
    .ws-close { margin-left: auto; background: none; border: 0; color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer; }
    .ws-tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
    .ws-tab { background: none; border: 0; border-bottom: 3px solid transparent; padding: 6px 10px; cursor: pointer; color: var(--muted); font-size: 13px; display: inline-flex; gap: 6px; align-items: center; }
    .ws-tab span { background: var(--surface-2); border-radius: 999px; padding: 0 6px; font-size: 12px; }
    .ws-tab.on { color: var(--text); border-bottom-color: var(--lcars-orange); }
    .ws-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 6px; position: relative; }
    .ws-body .ws-focus { box-shadow: -4px 0 0 var(--lcars-orange); padding-left: 10px; }
    .ws-art-h { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
    .ws-art-h small { color: var(--muted); font-size: 12px; }
    .ws-frame { width: 100%; height: 300px; border: 1px solid var(--line); border-radius: 10px; background: #0b0912; flex: none; }
    .ws-frame.tall { height: 100%; min-height: 320px; flex: 1; }
    .ws-thumbs { display: flex; flex-direction: column; gap: 4px; }
    .ws-thumb { text-align: left; background: var(--surface-2); border: 1px solid transparent; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
    .ws-thumb small { display: block; color: var(--muted); font-size: 12px; }
    .ws-thumb.on { border-color: var(--lcars-orange); }
    .ws-url { display: flex; gap: 8px; align-items: center; background: var(--surface-2); border-radius: 999px; padding: 5px 12px; font: 13px var(--mono); color: var(--muted); }
    .ws-pr { background: var(--surface-2); border-radius: 10px; padding: 8px 12px; border-left: 4px solid var(--line); }
    .ws-pr.merged { border-left-color: var(--lcars-green); }
    .ws-pr.qa { border-left-color: var(--lcars-sky); }
    .ws-pr > div:first-child { display: flex; justify-content: space-between; gap: 10px; }
    .ws-pr small { color: var(--muted); font-size: 12px; }
    .ws-state { font-size: 12px; color: var(--muted); flex: none; }
    .ws-pr-line { font-size: 13px; color: var(--muted); margin-top: 4px; }
    .ws-act { display: grid; grid-template-columns: 82px 1fr; gap: 8px; font: 13px/1.45 var(--mono); padding: 3px 0; }
    .ws-act small { color: var(--muted); font-size: 12px; }
    .ws-act.bad span { color: var(--lcars-red); }
    .ws-act.quiet span { color: var(--muted); }
    .ws-act.live span::after { content: ' ●'; color: var(--lcars-green); animation: lab-pulse 1.4s infinite; }
    .ws-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .ws-chip { background: var(--surface-2); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; color: var(--lcars-sky); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ws-chip.on { border-color: var(--lcars-orange); color: var(--text); }
    .rd.hot { background: color-mix(in srgb, var(--surface-2) 70%, transparent); }
  `;

  V({
    id: 26, slot: 'voice', name: 'CoS in the centre, the lead\'s workspace on the right',
    idea: 'Three columns: goals, the chief of staff\'s thread, and the lead\'s workspace (conversation, screen, browser, pull requests, activity). Each reading opens the part it read.',
    css: WS_CSS + `
      .v-26 { --side-w: minmax(0, 1.1fr); }
      .v-26 .st-frame.has-side { grid-template-columns: var(--left-w, minmax(190px, 240px)) minmax(0, 1fr) var(--side-w); }
      .v-26 .st-side { border-left: 1px solid var(--line); padding-left: 18px; overflow: hidden; }
      .v-26 .st-side > .ws ~ * { margin-top: 14px; }
      .v-20.v-26 .ws-h b { color: #a5591f; }
    `,
    thread(ctx, g) {
      return { rows: thread(ctx, g, true), side: pane(ctx, g, false) };
    },
  });

  V({
    id: 27, slot: 'voice', name: 'CoS in the centre, the workspace slides over',
    idea: 'The chief of staff\'s thread has the room; press a reading, or one of its chips, and the lead\'s workspace slides over from the right. × puts it away.',
    css: WS_CSS + `
      .v-27 .st-right { position: relative; }
      .v-27 .st-right > .ws.drawer { position: absolute; top: 0; right: 0; bottom: 0; width: min(620px, 62%); max-height: none; z-index: 4; background: #000; border-left: 2px solid var(--lcars-orange); padding: 12px 14px; box-shadow: -24px 0 40px #000c; overflow: hidden; }
      .v-27 .rd { cursor: pointer; }
      .v-20.v-27 .st-right > .ws.drawer { background: #f7f1e6; }
      .v-20.v-27 .ws-h b { color: #a5591f; }
    `,
    thread(ctx, g) {
      const out = thread(ctx, g, false).map((el) => {
        if (el.classList?.contains('rd')) el.addEventListener('click', (e) => { if (!e.target.closest('button, details')) show(ctx, 'talk', Number(el.dataset.turn) || null); });
        return el;
      });
      return { rows: out, below: ws.open ? pane(ctx, g, true) : null };
    },
  });
})();
