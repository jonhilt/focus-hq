// The stream lab's twenty variations (lab.js): each takes one slot of the stream and draws it its own way. Each slot's
// functions get `ctx` (the lab's helpers, the sample data and the parts already drawn) and the goal picked.
(function () {
  const V = window.labVariation;
  const over = (ctx, props) => Object.assign(Object.create(ctx), props);
  const TONE_DOT = { needs: 'var(--lcars-gold)', new: 'var(--lcars-sky)', quiet: 'var(--muted)' };
  const PR_TONE = { merged: 'var(--lcars-green)', qa: 'var(--lcars-sky)', open: 'transparent' };
  const prPips = (h, g) => h('span', { class: 'pips', title: g.prs.map((p) => `#${p.number} ${p.title} (${p.state})`).join('\n') },
    g.prs.map((p) => h('i', { class: `pip ${p.state}`, style: `--c:${PR_TONE[p.state]}` })));
  const initials = (name) => name.replace(/^Lt\. /, '').slice(0, 2).toUpperCase();
  /** The thread, with a column of its own beside it when something goes at the side (a tray, a workspace). */
  const split = (h, right, side) => (side ? h('div', { class: 'st-split' }, right, h('div', { class: 'st-side' }, side)) : right);
  const working = (g) => ['working', 'testing', 'pushing', 'setting-up'].includes(g.status);
  const SHARED = `
    .pips { display: inline-flex; gap: 3px; vertical-align: middle; }
    .pip { width: 9px; height: 9px; border-radius: 2px; background: var(--c); box-shadow: inset 0 0 0 1.5px var(--lcars-green); }
    .pip.qa { box-shadow: none; } .pip.merged { box-shadow: none; }
    @keyframes lab-pulse { 50% { opacity: 0.35; } }
  `;

  // ======================= Frame =======================

  V({
    id: 1, slot: 'frame', name: 'Goal dossier',
    idea: 'A third column keeps what the goal is for beside its thread: done looks like, its pull requests, its decisions.',
    css: SHARED + `
      .v-1 .st-frame { grid-template-columns: var(--left-w, minmax(200px, 260px)) 1fr var(--side-w, 260px); }
      .v-1 .dossier { overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: 16px; font-size: 14px; border-left: 1px solid var(--line); padding-left: 16px; }
      .v-1 .dossier .done { background: var(--surface-2); border-radius: 10px; padding: 10px 12px; line-height: 1.45; }
      .v-1 .dossier .pr { display: grid; grid-template-columns: 12px 1fr; gap: 0 8px; align-items: baseline; margin-bottom: 6px; }
      .v-1 .dossier .pr small { grid-column: 2; color: var(--muted); font-size: 12px; }
      .v-1 .dossier .dec { color: #9cc4ff; margin-bottom: 6px; }
      .v-1 .dossier .dec b { color: var(--text); font-weight: 600; }
      .v-1 .st-frame.taken { grid-template-columns: var(--left-w, minmax(190px, 240px)) minmax(0, 1fr) var(--side-w, 300px); }
      .v-1 .dossier.taken { overflow: hidden; }
      .v-1 .dossier-fold > summary { cursor: pointer; color: var(--lcars-sky); font-size: 13px; }
      .v-1 .dossier-fold .dossier { border-left: 0; padding: 8px 0 0; }
    `,
    frame(ctx, g) {
      const { h } = ctx;
      const n = ctx.needs;
      const facts = g ? [
        h('div', null, h('h3', null, 'Done looks like'), h('div', { class: 'done' }, g.done)),
        h('div', null, h('h3', null, `Pull requests · ${g.prs.length}`), g.prs.length ? g.prs.map((p) => h('div', { class: 'pr' }, h('i', { class: `pip ${p.state}`, style: `--c:${PR_TONE[p.state]}` }), h('span', null, p.title), h('small', null, `${p.repo}#${p.number} · ${p.state === 'qa' ? 'with QA' : p.state}`))) : h('p', { class: 'muted' }, 'None yet.')),
        h('div', null, h('h3', null, 'Decided'), g.decisions.length ? g.decisions.map((d) => h('div', { class: 'dec' }, `${d.q} → `, h('b', null, d.chosen))) : h('p', { class: 'muted' }, 'Nothing yet.'))] : [];
      // something at the side (a tray, a workspace) takes the third column, and the dossier folds up under the header
      const third = n.side ? h('div', { class: 'dossier taken' }, n.side) : h('div', { class: 'dossier' }, facts);
      const fold = n.side && g ? h('details', { class: 'dossier-fold' }, h('summary', null, 'Done looks like, pull requests, decisions ›'), h('div', { class: 'dossier' }, facts)) : null;
      return h('div', { class: `st-frame${n.side ? ' taken' : ''}` },
        h('div', { class: 'st-tabs' }, ctx.tabs),
        h('div', { class: 'st-left' }, h('h3', null, 'Goals'), ctx.goals, ctx.shelf),
        h('div', { class: 'st-right' }, ctx.head, fold, n.top, ctx.thread, n.below, n.foot),
        third);
    },
  });

  V({
    id: 2, slot: 'frame', name: 'One column, goals as a strip',
    idea: 'The goals run along the top under the projects; the thread gets the whole width, at a reading measure.',
    css: `
      .v-2 .one { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; }
      .v-2 .one .st-tabs { display: flex; gap: 6px; }
      .v-2 .strip { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; flex: none; }
      .v-2 .strip > * { display: contents; }
      .v-2 .strip .st-goals, .v-2 .strip .gl-rows, .v-2 .strip .gl-cards, .v-2 .strip .triage { display: flex; flex-direction: row; gap: 8px; }
      .v-2 .strip .triage > div { display: flex; gap: 8px; align-items: stretch; }
      .v-2 .strip .triage h3 { writing-mode: vertical-rl; transform: rotate(180deg); margin: 0; font-size: 10px; }
      .v-2 .strip :is(.st-goal, .gl-row, .gl-card) { flex: none; width: 250px; }
      .v-2 .strip .st-goal-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .v-2 .one .st-right { flex: 1; width: 100%; max-width: 820px; margin: 0 auto; }
      .v-2 .loose { font-size: 13px; color: var(--muted); flex: none; }
      .v-2 .loose b { color: var(--lcars-gold); }
    `,
    frame(ctx) {
      const { h } = ctx;
      const n = ctx.needs;
      const loose = ctx.data.loose.filter((l) => l.projectId === ctx.project);
      return h('div', { class: 'one' },
        h('div', { class: 'st-tabs' }, ctx.tabs),
        h('div', { class: 'strip' }, ctx.goals),
        loose.length ? h('div', { class: 'loose' }, h('b', null, `Ready for you · ${loose.length}: `), loose.map((l) => `${l.what} (${l.who})`).join(' · ')) : null,
        split(h, h('div', { class: 'st-right' }, ctx.head, n.top, ctx.thread, n.below, n.foot), n.side));
    },
  });

  V({
    id: 3, slot: 'frame', name: 'Every project in one list',
    idea: 'No project tabs: the left lists every goal aboard, what needs you first, then each project\'s goals under its name.',
    css: `
      .v-3 .river { display: grid; grid-template-columns: var(--left-w, minmax(230px, 310px)) 1fr; gap: 0 22px; height: 100%; min-height: 0; }
      .v-3 .river .st-left { gap: 10px; }
      .v-3 .river .proj { font: 600 13px/1 var(--ui); letter-spacing: 0.14em; text-transform: uppercase; color: var(--tone); margin: 10px 0 6px; display: flex; gap: 8px; align-items: center; }
      .v-3 .river .proj::after { content: ''; flex: 1; height: 2px; background: var(--tone); opacity: 0.4; border-radius: 2px; }
      .v-3 .river .proj.needs { --tone: var(--lcars-gold); }
    `,
    frame(ctx) {
      const { h } = ctx;
      const n = ctx.needs;
      const needing = ctx.allGoals.filter((g) => g.needs.length);
      const sections = [
        needing.length ? [h('div', { class: 'proj needs' }, `Needs you · ${needing.length}`), ctx.drawGoals(needing)] : null,
        ...ctx.projects.map((p) => {
          const rest = ctx.allGoals.filter((g) => g.projectId === p.id && !g.needs.length);
          const loose = ctx.data.loose.filter((l) => l.projectId === p.id);
          if (!rest.length && !loose.length) return null;
          return [h('div', { class: 'proj', style: `--tone:${p.color}` }, p.name), rest.length ? ctx.drawGoals(rest) : null,
            loose.map((i) => h('div', { class: 'st-shelf-item' }, h('span', null, i.what), h('small', null, `Ready for you · ${i.who}`)))];
        }),
      ];
      return h('div', { class: 'river' },
        h('div', { class: 'st-left' }, sections),
        split(h, h('div', { class: 'st-right' }, ctx.head, n.top, ctx.thread, n.below, n.foot), n.side));
    },
  });

  V({
    id: 4, slot: 'frame', name: 'A rail of leads',
    idea: 'The goals shrink to a rail of their leads, a ring for what needs you; hover the rail for the full list. The thread gets the room.',
    css: `
      .v-4 .railf { display: grid; grid-template-columns: 64px 1fr; grid-template-rows: auto 1fr; gap: 14px 18px; height: 100%; min-height: 0; position: relative; }
      .v-4 .railf .st-tabs { grid-column: 1 / -1; display: flex; gap: 6px; }
      .v-4 .rail { display: flex; flex-direction: column; gap: 10px; align-items: center; position: relative; }
      .v-4 .face { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; font: 600 16px/1 var(--ui); letter-spacing: 0.04em; background: var(--surface-2); border: 3px solid var(--ring); cursor: pointer; position: relative; color: var(--text); }
      .v-4 .face.sel { background: var(--lcars-orange); color: var(--ink); }
      .v-4 .face.work::after { content: ''; position: absolute; right: -2px; bottom: -2px; width: 12px; height: 12px; border-radius: 50%; background: var(--lcars-green); border: 2px solid #000; animation: lab-pulse 1.4s infinite; }
      .v-4 .fly { position: absolute; left: 0; top: 0; width: 320px; max-height: 100%; overflow-y: auto; background: #000; border: 1px solid var(--line); border-radius: 12px; padding: 12px; z-index: 5; box-shadow: 0 20px 50px #000c; display: none; }
      .v-4 .rail:hover .fly { display: block; }
    `,
    frame(ctx) {
      const { h } = ctx;
      const n = ctx.needs;
      const faces = ctx.goalsHere.map((g) => {
        const line = ctx.goalLine(g, ctx.seen[g.id]);
        return h('button', { class: `face${g.id === ctx.goalId ? ' sel' : ''}${working(g) ? ' work' : ''}`, style: `--ring:${TONE_DOT[line.tone]}`, title: `${g.title}\n${g.lead} · ${line.text}`, onclick: () => ctx.select(g.id) }, initials(g.lead));
      });
      return h('div', { class: 'railf' },
        h('div', { class: 'st-tabs' }, ctx.tabs),
        h('div', { class: 'rail' }, faces, h('div', { class: 'fly' }, h('h3', null, 'Goals'), ctx.goals, ctx.shelf)),
        split(h, h('div', { class: 'st-right' }, ctx.head, n.top, ctx.thread, n.below, n.foot), n.side));
    },
  });

  // ======================= Goals list =======================

  V({
    id: 5, slot: 'goals', name: 'Triage: needs you, new, quiet',
    idea: 'The goals sorted into what needs you, what\'s new since you looked, and the rest, each under its heading.',
    css: `
      .v-5 .triage { display: flex; flex-direction: column; gap: 14px; }
      .v-5 .triage h3 { margin-bottom: 6px; }
      .v-5 .triage .t-needs h3 { color: var(--lcars-gold); }
      .v-5 .triage .t-new h3 { color: var(--lcars-sky); }
      .v-5 .triage .t-quiet h3 { color: var(--muted); }
      .v-5 .triage .t-quiet .st-goal { background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
    `,
    goals(ctx) {
      const { h } = ctx;
      const by = { needs: [], new: [], quiet: [] };
      for (const g of ctx.goalsHere) by[ctx.goalLine(g, ctx.seen[g.id]).tone].push(g);
      const label = { needs: 'Needs you', new: 'New since you looked', quiet: 'Under way' };
      const groups = Object.entries(by).filter(([, l]) => l.length);
      // one group needs no heading (a frame may have put these goals under one already)
      return h('div', { class: 'triage' }, groups.map(([k, l]) =>
        h('div', { class: `t-${k}` }, groups.length > 1 ? h('h3', null, `${label[k]} · ${l.length}`) : null, ctx.base.goals(over(ctx, { goalsHere: l })))));
    },
  });

  V({
    id: 6, slot: 'goals', name: 'Compact rows',
    idea: 'A line a goal: a dot for its state, the title, and how long since anything came in. Many goals fit without scrolling.',
    css: `
      .v-6 .gl-rows { display: flex; flex-direction: column; }
      .v-6 .gl-row { display: grid; grid-template-columns: 10px 1fr auto; gap: 10px; align-items: center; text-align: left; background: none; border: 0; border-radius: 8px; padding: 8px 8px; cursor: pointer; font: 14px/1.3 var(--read); }
      .v-6 .gl-row:hover { background: var(--surface-2); }
      .v-6 .gl-row.sel { background: color-mix(in srgb, var(--surface-2) 70%, var(--lcars-sky) 12%); }
      .v-6 .gl-row .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--d); }
      .v-6 .gl-row .dot.work { animation: lab-pulse 1.4s infinite; }
      .v-6 .gl-row .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .v-6 .gl-row.needs .t, .v-6 .gl-row.new .t { font-weight: 600; }
      .v-6 .gl-row small { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
      .v-6 .gl-row.needs small { color: var(--lcars-gold); }
    `,
    goals(ctx) {
      const { h } = ctx;
      return h('div', { class: 'gl-rows' }, ctx.goalsHere.map((g) => {
        const line = ctx.goalLine(g, ctx.seen[g.id]);
        const dot = g.status === 'error' ? 'var(--lcars-red)' : line.tone === 'quiet' && working(g) ? 'var(--lcars-green)' : TONE_DOT[line.tone];
        return h('button', { class: `gl-row ${line.tone}${g.id === ctx.goalId ? ' sel' : ''}`, title: `${g.lead} · ${line.text}`, onclick: () => ctx.select(g.id) },
          h('i', { class: `dot${working(g) ? ' work' : ''}`, style: `--d:${dot}` }),
          h('span', { class: 't' }, g.title),
          h('small', null, g.needs.length ? `${g.needs.length} ●` : ctx.ago(g.entries.at(-1)?.at ?? Date.now())));
      }));
    },
  });

  V({
    id: 7, slot: 'goals', name: 'Cards with the latest word',
    idea: 'Each goal shows the start of its lead\'s latest report and pips for its pull requests, so you can tell what\'s happening before opening it.',
    css: SHARED + `
      .v-7 .gl-cards { display: flex; flex-direction: column; gap: 8px; }
      .v-7 .gl-card { display: flex; flex-direction: column; gap: 6px; text-align: left; background: var(--surface-2); border: 0; border-top: 3px solid var(--d); border-radius: 10px; padding: 10px 12px; cursor: pointer; font: 14px/1.4 var(--read); }
      .v-7 .gl-card.sel { box-shadow: inset 0 0 0 2px var(--lcars-sky); }
      .v-7 .gl-card .t { font-weight: 600; font-size: 15px; }
      .v-7 .gl-card .w { color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; }
      .v-7 .gl-card .m { display: flex; justify-content: space-between; align-items: center; color: var(--muted); font-size: 12px; }
      .v-7 .gl-card .need { color: var(--lcars-gold); font-size: 13px; font-weight: 600; }
    `,
    goals(ctx) {
      const { h } = ctx;
      return h('div', { class: 'gl-cards' }, ctx.goalsHere.map((g) => {
        const line = ctx.goalLine(g, ctx.seen[g.id]);
        const last = g.entries.findLast((e) => e.kind === 'lead');
        return h('button', { class: `gl-card${g.id === ctx.goalId ? ' sel' : ''}`, style: `--d:${line.tone === 'quiet' ? 'var(--line)' : TONE_DOT[line.tone]}`, onclick: () => ctx.select(g.id) },
          h('span', { class: 't' }, g.title),
          g.needs.length ? h('span', { class: 'need' }, `Needs you · ${g.needs[0].what}`) : last ? h('span', { class: 'w' }, ctx.firstPara(last.text)) : null,
          h('span', { class: 'm' }, h('span', null, `${g.lead.replace(/^Lt\. /, '')} · ${ctx.doing(g.status)}${line.tone === 'new' ? ' · new' : ''}`), prPips(h, g)));
      }));
    },
  });

  // ======================= Header =======================

  V({
    id: 8, slot: 'head', name: 'What\'s agreed, up top',
    idea: 'The header carries what\'s agreed: done looks like, the decisions made, and the pull requests, with the lead\'s state live.',
    css: SHARED + `
      .v-8 .agreed { flex: none; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--line); padding-bottom: 12px; }
      .v-8 .agreed .top { display: flex; gap: 12px; align-items: baseline; justify-content: space-between; }
      .v-8 .agreed .st-title { font-size: 21px; }
      .v-8 .agreed .who { flex: none; font-size: 13px; color: var(--muted); display: inline-flex; gap: 6px; align-items: center; }
      .v-8 .agreed .live { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
      .v-8 .agreed .live.work { animation: lab-pulse 1.4s infinite; }
      .v-8 .agreed .done { font-size: 14px; color: var(--lcars-peach); }
      .v-8 .agreed .done b { font: 600 12px/1 var(--ui); letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-right: 6px; }
      .v-8 .agreed .chips { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; }
      .v-8 .agreed .chip { background: var(--surface-2); border-radius: 999px; padding: 3px 10px; color: #9cc4ff; }
      .v-8 .agreed .chip.pr { color: var(--text); display: inline-flex; gap: 6px; align-items: center; }
    `,
    head(ctx, g) {
      const { h } = ctx;
      const c = g.status === 'error' ? 'var(--lcars-red)' : working(g) ? 'var(--lcars-green)' : 'var(--muted)';
      const merged = g.prs.filter((p) => p.state === 'merged').length;
      return h('div', { class: 'agreed' },
        h('div', { class: 'top' }, h('div', { class: 'st-title' }, g.title),
          h('span', { class: 'who' }, h('i', { class: `live${working(g) ? ' work' : ''}`, style: `--c:${c}` }), `${g.lead} · ${ctx.doing(g.status)}`)),
        h('div', { class: 'done' }, h('b', null, 'Done looks like'), g.done),
        h('div', { class: 'chips' },
          g.prs.length ? h('span', { class: 'chip pr' }, prPips(h, g), `${merged} of ${g.prs.length} merged`) : null,
          g.decisions.map((d) => h('span', { class: 'chip', title: d.q }, `✓ ${d.chosen}`)),
          h('a', { class: 'chip', href: '#', style: 'color:var(--lcars-sky)', onclick: (e) => e.preventDefault() }, 'Their room ›')));
    },
  });

  // ======================= Messages =======================

  V({
    id: 9, slot: 'messages', name: 'Chat, both sides',
    idea: 'The lead speaks in bubbles too, on the left with their face; you on the right. It reads like a conversation with a person.',
    css: `
      .v-9 .chat { display: flex; gap: 10px; align-items: flex-end; max-width: 78ch; margin: 6px 0; }
      .v-9 .chat.me { align-self: flex-end; flex-direction: row-reverse; max-width: 64ch; }
      .v-9 .chat .av { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font: 600 13px/1 var(--ui); background: var(--lcars-orange); color: var(--ink); }
      .v-9 .chat.me .av { background: #4a6aa8; color: var(--text); }
      .v-9 .chat .b { background: var(--surface-2); border-radius: 16px 16px 16px 4px; padding: 10px 14px; min-width: 0; }
      .v-9 .chat.me .b { background: #24304d; border-radius: 16px 16px 4px 16px; }
      .v-9 .chat .b small { display: block; color: var(--muted); font-size: 12px; margin-bottom: 2px; }
      .v-9 .chat .b .st-md > :last-child { margin-bottom: 0; }
    `,
    message(ctx, e, g) {
      const { h } = ctx;
      const me = e.kind === 'you';
      return h('div', { class: `chat${me ? ' me' : ''}` },
        h('div', { class: 'av' }, me ? 'YOU' : initials(g.lead)),
        h('div', { class: 'b' }, h('small', null, `${me ? `You${e.via ? `, from ${e.via}` : ''}` : g.lead} · ${ctx.time(e.at)}`),
          me ? h('div', { class: 'st-text' }, e.text) : h('div', { class: 'st-md', html: ctx.md(e.text) })));
    },
  });

  V({
    id: 10, slot: 'messages', name: 'Reports with a headline',
    idea: 'Each turn of the lead\'s is a report: its first paragraph as the headline, the rest folded. The latest opens itself.',
    css: `
      .v-10 .rep { border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; max-width: 76ch; margin: 6px 0; background: color-mix(in srgb, var(--surface-2) 40%, transparent); }
      .v-10 .rep small { display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }
      .v-10 .rep .hl { font-size: 17px; font-weight: 600; line-height: 1.4; }
      .v-10 .rep details { margin-top: 8px; }
      .v-10 .rep summary { cursor: pointer; color: var(--lcars-sky); font-size: 13px; }
      .v-10 .rep details[open] summary { margin-bottom: 8px; }
      .v-10 .said { align-self: flex-end; max-width: 60ch; color: #c9d6f2; font-size: 15px; border-right: 3px solid #4a6aa8; padding: 4px 12px; margin: 6px 0; text-align: right; }
      .v-10 .said small { display: block; color: var(--muted); font-size: 12px; }
    `,
    message(ctx, e, g) {
      const { h } = ctx;
      if (e.kind === 'you') return h('div', { class: 'said' }, h('small', null, `You${e.via ? `, from ${e.via}` : ''} · ${ctx.time(e.at)}`), e.text);
      const paras = e.text.split(/\n{2,}/);
      const rest = paras.slice(1).join('\n\n');
      const latest = g.entries.findLast((x) => x.kind === 'lead') === e;
      const words = rest.split(/\s+/).filter(Boolean).length;
      return h('div', { class: 'rep' }, h('small', null, `${g.lead} reported · ${ctx.time(e.at)}`),
        h('div', { class: 'hl', html: ctx.md(paras[0]).replace(/^<p>|<\/p>$/g, '') }),
        rest ? h('details', { open: latest }, h('summary', null, `The whole report · ${words} more words`), h('div', { class: 'st-md', html: ctx.md(rest) })) : null);
    },
  });

  V({
    id: 11, slot: 'messages', name: 'Long reports clipped',
    idea: 'Older reports show their first lines and fade; the latest is whole. One press opens any of them.',
    css: `
      .v-11 .clip { position: relative; }
      .v-11 .clip.shut .st-md { max-height: 7.2em; overflow: hidden; -webkit-mask-image: linear-gradient(#000 55%, transparent); mask-image: linear-gradient(#000 55%, transparent); }
      .v-11 .clip .more { background: none; border: 0; color: var(--lcars-sky); cursor: pointer; padding: 2px 0; font-size: 13px; }
      .v-11 .clip:not(.shut) .more { display: none; }
    `,
    message(ctx, e, g) {
      const el = ctx.base.message(ctx, e, g);
      if (e.kind !== 'lead') return el;
      const latest = g.entries.findLast((x) => x.kind === 'lead') === e;
      if (latest || e.text.length < 320) return el;
      el.classList.add('clip', 'shut');
      el.append(ctx.h('button', { class: 'more', onclick: () => el.classList.remove('shut') }, 'Read it all ⌄'));
      return el;
    },
  });

  V({
    id: 12, slot: 'messages', name: 'Exchanges',
    idea: 'The thread as exchanges: each thing you said opens one, with everything after it until you spoke again. Older exchanges fold to a line.',
    css: `
      .v-12 .ex { border-left: 3px solid var(--line); padding: 2px 0 2px 14px; margin: 8px 0; }
      .v-12 .ex.live { border-left-color: var(--lcars-orange); }
      .v-12 .ex > summary { cursor: pointer; list-style: none; }
      .v-12 .ex > summary::-webkit-details-marker { display: none; }
      .v-12 .ex .q { font-weight: 600; font-size: 16px; }
      .v-12 .ex .q small { font-weight: 400; color: var(--muted); font-size: 12px; margin-left: 8px; }
      .v-12 .ex .gist { color: var(--muted); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 72ch; }
      .v-12 .ex[open] .gist { display: none; }
      .v-12 .ex-body { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
    `,
    messages(ctx, segs, g) {
      const { h } = ctx;
      const groups = [];
      for (const s of segs) {
        if (s.type === 'msg' && s.entry.kind === 'you') groups.push({ ask: s.entry, rest: [] });
        else (groups.at(-1) ?? groups[groups.push({ ask: null, rest: [] }) - 1]).rest.push(s);
      }
      return groups.map((grp, i) => {
        const hasNew = grp.rest.some((s) => s.type === 'new');
        const open = i >= groups.length - 2 || hasNew;
        const reply = grp.rest.findLast((s) => s.type === 'msg');
        const body = grp.rest.map((s) => (s.type === 'new' ? ctx.newLine() : s.type === 'quiet' ? ctx.quietRun(s.entries, g) : ctx.message(s.entry, g)));
        return h('details', { class: `ex${i === groups.length - 1 ? ' live' : ''}`, open },
          h('summary', null,
            h('div', { class: 'q' }, grp.ask ? `“${grp.ask.text}”` : 'How it began', h('small', null, grp.ask ? `You${grp.ask.via ? `, from ${grp.ask.via}` : ''} · ${ctx.time(grp.ask.at)}` : '')),
            reply ? h('div', { class: 'gist' }, `${g.lead}: ${ctx.firstPara(reply.entry.text)}`) : null),
          h('div', { class: 'ex-body' }, body));
      });
    },
  });

  // ======================= Quiet lines =======================

  function runSummary(entries) {
    const bits = [];
    const merged = entries.filter((e) => e.kind === 'merged');
    if (merged.length) bits.push(`merged ${merged.map((e) => `#${e.number}`).join(', ')}`);
    const passed = entries.filter((e) => e.kind === 'ops' && /^QA/.test(e.from) && /passed/.test(e.text)).length;
    if (passed) bits.push(passed > 1 ? `QA passed ${passed}` : 'QA passed');
    const dec = entries.filter((e) => e.kind === 'decided');
    if (dec.length) bits.push(`decided: ${dec.map((d) => d.chosen).join('; ')}`);
    const back = entries.filter((e) => e.kind === 'cos' && e.route === 4).length;
    if (back) bits.push(`sent back ${back > 1 ? `${back}×` : 'once'}`);
    const flagged = entries.filter((e) => e.kind === 'cos' && e.route === 3).length;
    if (flagged) bits.push('flagged to you');
    return bits;
  }

  V({
    id: 13, slot: 'quiet', name: 'Updates in a bundle',
    idea: 'Two or more quiet lines in a row fold into one: "4 updates · merged #689 · QA passed". Open it for the lines.',
    css: `
      .v-13 .bundle { max-width: 72ch; margin: 2px 0; }
      .v-13 .bundle > summary { list-style: none; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; font-size: 13px; color: var(--muted); background: var(--surface-2); border-radius: 999px; padding: 3px 12px; }
      .v-13 .bundle > summary::-webkit-details-marker { display: none; }
      .v-13 .bundle > summary b { color: var(--text); font-weight: 600; }
      .v-13 .bundle > summary .m { color: var(--lcars-green); }
      .v-13 .bundle[open] > summary { margin-bottom: 4px; }
      .v-13 .bundle .lines { border-left: 2px solid var(--line); padding-left: 12px; }
    `,
    quiet(ctx, entries) {
      const { h } = ctx;
      if (entries.length < 2) return entries.map((e) => ctx.quietLine(e));
      const bits = runSummary(entries);
      return h('details', { class: 'bundle' },
        h('summary', null, h('b', null, `${entries.length} updates`), bits.length ? h('span', { class: bits[0].startsWith('merged') ? 'm' : '' }, bits.join(' · ')) : null, '›'),
        h('div', { class: 'lines' }, entries.map((e) => ctx.quietLine(e))));
    },
  });

  const GLYPH = { quiet: '•', decided: '✓', merged: '⇡', cos: '◆', 'sent-back': '↩', flagged: '!' };
  const GLYPH_C = { quiet: 'var(--muted)', decided: 'var(--lcars-sky)', merged: 'var(--lcars-green)', cos: 'var(--lcars-peach)', 'sent-back': 'var(--lcars-lilac)', flagged: 'var(--lcars-red)' };
  V({
    id: 14, slot: 'quiet', name: 'A timeline down the side',
    idea: 'A rail down the left of the thread: each quiet line is a mark on it with its own glyph, the conversation hangs off it.',
    threadClass: 'tl',
    css: `
      .v-14 .st-thread.tl { padding-left: 34px; gap: 4px; background: linear-gradient(var(--line), var(--line)) 12px 0 / 2px 100% no-repeat local; }
      .v-14 .tl .tl-line { position: relative; display: flex; gap: 10px; align-items: baseline; font-size: 13px; color: var(--muted); max-width: 72ch; }
      .v-14 .tl .tl-line .g { position: absolute; left: -32px; top: 1px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: #000; border: 2px solid var(--c); color: var(--c); font: 700 12px/1 var(--read); }
      .v-14 .tl .tl-line .x { flex: 1; color: var(--c); }
      .v-14 .tl .tl-line.quiet .x { color: var(--muted); }
      .v-14 .tl .tl-line small { flex: none; font-size: 12px; }
      .v-14 .tl :is(.st-lead, .st-you, .chat, .rep, .said, .ex)::before { content: ''; position: absolute; left: 7px; width: 12px; height: 12px; border-radius: 50%; background: var(--lcars-orange); margin-top: 14px; }
      .v-14 .tl :is(.st-you, .chat.me, .said)::before { background: #6f8fd0; }
      .v-14 .tl .st-more { margin-left: 0; }
    `,
    quietLine(ctx, e) {
      const { h } = ctx;
      const v = ctx.entryView(e);
      const line = h('div', { class: `tl-line ${v.tone}`, style: `--c:${GLYPH_C[v.tone]}` }, h('i', { class: 'g' }, GLYPH[v.tone]), h('span', { class: 'x' }, v.text), h('small', null, ctx.time(e.at)));
      if (!v.more) return line;
      return h('details', { class: 'st-fold' }, h('summary', null, line), h('div', { class: 'st-more' }, v.more));
    },
  });

  V({
    id: 15, slot: 'quiet', name: 'Notes in the margin',
    idea: 'The conversation keeps the reading column; Ops, QA and the chief of staff speak in the margin beside where they happened.',
    threadClass: 'margins',
    css: `
      .v-15 .st-thread.margins { display: block; padding-right: 250px; }
      .v-15 .margins > :not(.q-margin) { margin-bottom: 8px; }
      .v-15 .margins .ex-body { display: block; }
      .v-15 .margins .ex-body > :not(.q-margin) { margin-bottom: 8px; }
      .v-15 .margins :is(.st-you, .chat.me, .said) { width: fit-content; margin-left: auto; }
      .v-15 .q-margin { float: right; clear: right; width: 230px; margin-right: -250px; border-left: 2px solid var(--line); padding: 2px 0 2px 10px; display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
      .v-15 .q-margin .st-line { font-size: 12px; flex-direction: column; gap: 0; padding: 0; }
      .v-15 .q-margin .st-line.decided { border-left: 0; padding-left: 0; }
      .v-15 .q-margin .st-more { font-size: 12px; }
    `,
    quiet(ctx, entries) {
      return ctx.h('div', { class: 'q-margin' }, entries.map((e) => ctx.quietLine(e)));
    },
  });

  V({
    id: 16, slot: 'quiet', name: 'Only the milestones',
    idea: 'Merges, decisions and what was flagged stay; the rest of the machinery hides behind a small "+n", which shows it all.',
    threadClass: 'only',
    css: `
      .v-16 .only .q-hide { display: none; }
      .v-16 .only.all .q-hide { display: flex; opacity: 0.8; }
      .v-16 .only .plus { align-self: flex-start; background: none; border: 1px dashed var(--line); color: var(--muted); border-radius: 999px; font-size: 12px; padding: 1px 8px; cursor: pointer; }
      .v-16 .only.all .plus { display: none; }
    `,
    quiet(ctx, entries) {
      const { h } = ctx;
      const keep = (e) => e.kind === 'merged' || e.kind === 'decided' || (e.kind === 'cos' && e.route === 3);
      const hidden = entries.filter((e) => !keep(e)).length;
      const lines = entries.map((e) => {
        const el = ctx.quietLine(e);
        if (!keep(e)) el.classList.add('q-hide');
        return el;
      });
      return [...lines, hidden ? h('button', { class: 'plus', title: 'Show everything Ops, QA and the chief of staff said', onclick: (ev) => ev.target.closest('.st-thread').classList.add('all') }, `+${hidden}`) : null];
    },
  });

  // ======================= Needs you =======================

  V({
    id: 17, slot: 'needs', name: 'Pinned above the thread',
    idea: 'What needs you sits pinned at the top of the thread, never scrolled away; the box to talk to the lead is always at the foot.',
    css: `
      .v-17 .pinned { flex: none; display: flex; flex-direction: column; gap: 8px; max-height: 45%; overflow-y: auto; }
      .v-17 .pinned > details > summary { list-style: none; cursor: pointer; display: flex; gap: 10px; align-items: center; background: color-mix(in srgb, var(--lcars-gold) 18%, var(--surface-2)); border-radius: 10px; padding: 8px 12px; font-weight: 600; }
      .v-17 .pinned > details > summary::-webkit-details-marker { display: none; }
      .v-17 .pinned > details > summary b { font: 600 12px/1 var(--ui); letter-spacing: 0.14em; text-transform: uppercase; color: var(--lcars-gold); }
      .v-17 .pinned > details[open] > summary { display: none; }
      .v-17 .pinned .hide { align-self: flex-end; background: none; border: 0; color: var(--muted); font-size: 12px; cursor: pointer; }
    `,
    needs(ctx, g) {
      const { h } = ctx;
      if (!g.needs.length) return { foot: ctx.talk(g) };
      const top = h('div', { class: 'pinned' }, g.needs.map((n, i) => {
        const d = h('details', { open: i === 0 }, h('summary', null, h('b', null, 'Needs you'), n.what, ' ›'));
        d.append(ctx.card(n, g, { bare: true }), h('button', { class: 'hide', onclick: () => { d.open = false; } }, 'Fold it up ⌃'));
        return d;
      }));
      return { top, foot: ctx.talk(g, { rows: 2 }) };
    },
  });

  V({
    id: 18, slot: 'needs', name: 'Asked in the thread, quick replies',
    idea: 'What needs you arrives as the thread\'s last message, from the chief of staff; the box below offers quick replies ("Carry on", "Show me").',
    css: `
      .v-18 .ask { align-self: stretch; max-width: 78ch; margin: 10px 0 4px; }
      .v-18 .ask > small { display: block; color: var(--lcars-gold); font: 600 12px/1 var(--ui); letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 6px; }
      .v-18 .quick { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; flex: none; }
      .v-18 .quick button { background: var(--surface-2); border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; font-size: 13px; cursor: pointer; }
      .v-18 .quick button:hover { border-color: var(--lcars-orange); }
      .v-18 .footq { flex: none; }
    `,
    needs(ctx, g) {
      const { h } = ctx;
      for (const n of g.needs) ctx.thread.append(h('div', { class: 'ask' }, h('small', null, 'The chief of staff · needs you'), ctx.card(n, g, { bare: true })));
      const quick = ['Carry on', 'Show me first', 'Hold off for now', 'Why?'];
      return { foot: h('div', { class: 'footq' }, h('div', { class: 'quick' }, quick.map((q) => h('button', { onclick: () => ctx.send(g, q) }, q))), ctx.talk(g, { rows: 2 })) };
    },
  });

  let trayFor = null;
  window.addEventListener('keydown', (e) => {
    if (!trayFor || e.target.closest('textarea, input, select') || e.metaKey || e.ctrlKey) return;
    const i = e.key.toUpperCase().charCodeAt(0) - 65;
    const { g, ctx } = trayFor;
    const need = g.needs[0];
    if (e.key.length === 1 && need?.options?.[i] && document.querySelector('.v-19')) ctx.answer(g, need, need.options[i]);
  });
  V({
    id: 19, slot: 'needs', name: 'A tray to decide from',
    idea: 'What needs you opens in a tray at the side, its answers lettered A, B, C on the keyboard, with what else is waiting in the project under it.',
    css: `
      .v-19 .tray { display: flex; flex-direction: column; gap: 12px; }
      .v-19 .tray .st-card { border-left-width: 6px; }
      .v-19 .tray .st-card-answers { flex-direction: column; align-items: stretch; }
      .v-19 .tray .st-answer { border-radius: 10px; justify-content: flex-start; padding: 10px 12px; }
      .v-19 .tray .else { display: flex; flex-direction: column; gap: 4px; }
      .v-19 .tray .else button { text-align: left; background: var(--surface-2); border: 0; border-radius: 8px; padding: 8px 10px; cursor: pointer; font-size: 13px; }
      .v-19 .tray .else small { display: block; color: var(--muted); font-size: 12px; }
      .v-19 .tray .clear { color: var(--muted); font-size: 14px; }
    `,
    needs(ctx, g) {
      const { h } = ctx;
      trayFor = { g, ctx };
      const others = ctx.allGoals.filter((x) => x.projectId === g.projectId && x.id !== g.id && x.needs.length);
      const side = h('div', { class: 'tray' }, h('h3', null, 'Needs you here'),
        g.needs.length ? g.needs.map((n, i) => ctx.card(n, g, { bare: true, keys: i === 0 })) : h('div', { class: 'clear' }, 'Nothing on this goal waits on you.'),
        others.length ? h('div', { class: 'else' }, h('h3', null, 'Also waiting'), others.map((o) => h('button', { onclick: () => ctx.select(o.id) }, o.needs[0].what, h('small', null, o.title)))) : null);
      return { side, foot: ctx.talk(g, { rows: 2 }) };
    },
  });

  // ======================= Skin =======================

  V({
    id: 20, slot: 'skin', name: 'Paper',
    idea: 'Light paper and a serif for the reading, the ship\'s colours kept for state. Long reports read like a document.',
    css: `
      .v-20 { --text: #2a2520; --muted: #7a7064; --surface-2: #ece4d6; --line: #d8ccb8; --lcars-sky: #2f6fb0; --lcars-gold: #8f5300; --lcars-green: #4d7f1c; --lcars-peach: #a5591f; --lcars-lilac: #8a4f8a; --lcars-red: #b33b3b; --read: Charter, 'Iowan Old Style', Georgia, serif;
        background: #f7f1e6; color: var(--text); border-radius: 10px; padding: 14px; }
      .v-20 .st-you, .v-20 .chat.me .b { background: #dfe8f3; }
      .v-20 .st-you small { color: #4b6789; }
      .v-20 :is(.st-line.decided, .agreed .chip, .dossier .dec) { color: #2f6fb0; }
      .v-20 .st-goal.sel, .v-20 .gl-row.sel { background: #e2d6c0; }
      .v-20 .st-tab { color: var(--text); }
      .v-20 .st-tab.on { color: var(--text); }
      .v-20 .st-answer { color: #fff; }
      .v-20 .st-answer.ghost { color: var(--text); }
      .v-20 .st-card-context { background: #f7f1e6; }
      .v-20 .st-send { color: #fff; background: #c4572a; }
      .v-20 .fly, .v-20 .tl .tl-line .g { background: #f7f1e6; }
      .v-20 .st-md code, .v-20 .st-card code { background: #0000000f; }
    `,
  });
})();
