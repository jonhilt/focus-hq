// The stream lab: the stream view (stream.ts) drawn from sample data, split into slots (the frame, the goals list,
// the thread's header, its messages, its quiet lines, what needs the user, the skin), each slot drawn by the baseline
// (as stream.ts draws it today) or by one of the variations in variations.js. Picking one variation per slot combines
// them; the pick is kept in the address, so a combination can be shared. Nothing here talks to Focus: answers and
// messages are played back on the sample data.
(function () {
  const SLOTS = [
    { key: 'frame', label: 'Frame', base: 'Two columns: goals left, thread right' },
    { key: 'goals', label: 'Goals list', base: 'A card per goal, its line under the title' },
    { key: 'head', label: 'Header', base: 'Title, lead, status, done looks like' },
    { key: 'voice', label: 'Voice', base: 'Both: the lead\'s words, the chief of staff\'s line under them' },
    { key: 'messages', label: 'Messages', base: 'The lead in plain text, the user in a bubble' },
    { key: 'quiet', label: 'Quiet lines', base: 'Every Ops, QA and chief of staff line, inline' },
    { key: 'needs', label: 'Needs you', base: 'The card at the foot, else a box to talk' },
    { key: 'talk', label: 'Talk box', base: 'At the foot of the thread' },
    { key: 'skin', label: 'Skin', base: 'The ship: dark, plain sans at 16px' },
  ];
  const variations = [];
  const byId = new Map();

  /** A variation registers itself: `{ id, slot, name, idea, css?, ...slot functions }`. */
  window.labVariation = (v) => {
    v.id = String(v.id);
    variations.push(v);
    byId.set(v.id, v);
  };

  // ---------- small helpers, as plugin-api/client has them ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  /** Enough markdown for the sample: paragraphs, bold, code, bullet and numbered lists. */
  function md(text) {
    return text.split(/\n{2,}/).map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^- /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
      if (lines.every((l) => /^\d+\. /.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }
  const firstPara = (text) => text.split(/\n{2,}/)[0].replace(/\*\*/g, '');
  const time = (at) => new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  function ago(at) {
    const m = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    if (m < 60 * 24) return `${Math.round(m / 60)}h`;
    return `${Math.round(m / 1440)}d`;
  }

  // ---------- the stream's decisions, as streamList.ts makes them ----------
  const DOING = { done: 'between turns', working: 'working', testing: 'testing', waiting: 'waiting on a permission', pushing: 'pushing', 'setting-up': 'setting up', queued: 'about to start', error: 'stopped on an error', stopped: 'stopped' };
  const doing = (status) => DOING[status] ?? status;
  const latestNews = (entries) => entries.findLast((e) => e.kind !== 'you')?.at;
  function goalLine(goal, seenAt) {
    const flagged = goal.needs;
    if (flagged.length) return { tone: 'needs', text: `Needs you · ${flagged[0].what}${flagged.length > 1 ? ` (+${flagged.length - 1})` : ''}` };
    const latest = latestNews(goal.entries);
    if (latest !== undefined && seenAt !== undefined && latest > seenAt) return { tone: 'new', text: 'New since you looked' };
    return { tone: 'quiet', text: doing(goal.status) };
  }
  const newSince = (entries, seenAt) => (seenAt === undefined ? -1 : entries.findIndex((e) => e.at > seenAt && e.kind !== 'you'));
  const newCount = (entries, seenAt) => (seenAt === undefined ? 0 : entries.filter((e) => e.at > seenAt && e.kind !== 'you').length);
  const ROUTE = {
    1: { tone: 'quiet', says: 'The chief of staff would let it carry on' },
    2: { tone: 'cos', says: 'The chief of staff put this to you' },
    3: { tone: 'flagged', says: 'The chief of staff flagged this to you now' },
    4: { tone: 'sent-back', says: 'The chief of staff would send this back to the lead' },
  };
  function entryView(e) {
    switch (e.kind) {
      case 'you': return { as: 'you', text: e.text, via: e.via };
      case 'lead': return { as: 'lead', text: e.text };
      case 'ops': return { as: 'line', tone: 'quiet', text: `${e.from}: ${e.text}`, who: e.from };
      case 'decided': return { as: 'line', tone: 'decided', text: `Decided: ${e.question} → ${e.chosen}` };
      case 'merged': return { as: 'line', tone: 'merged', text: `Merged ${e.repo}#${e.number}` };
      case 'cos': return { as: 'line', tone: ROUTE[e.route].tone, text: `${ROUTE[e.route].says}: ${e.why}`, more: e.message, who: 'Chief of staff' };
    }
  }
  /** A thread as segments: messages one by one, the quiet lines between them as runs, and where what's new begins. */
  function segments(entries, seenAt) {
    const split = newSince(entries, seenAt);
    const out = [];
    entries.forEach((e, i) => {
      if (i === split) out.push({ type: 'new' });
      const v = entryView(e);
      if (v.as === 'line') {
        const last = out.at(-1);
        if (last?.type === 'quiet') last.entries.push(e);
        else out.push({ type: 'quiet', entries: [e] });
      } else out.push({ type: 'msg', entry: e });
    });
    return out;
  }

  /**
   * A thread told by the chief of staff: the lead's turns leave the thread, each reading of one (`says`) stands in
   * for it, carrying the turn it read (`turn`); the user's words and the rest stay as they are.
   */
  function cosSegments(entries, seenAt) {
    const split = newSince(entries.filter((e) => e.kind !== 'lead'), seenAt);
    const out = [];
    let lastTurn;
    let i = 0;
    for (const e of entries) {
      if (e.kind === 'lead') { lastTurn = e; continue; }
      if (i++ === split) out.push({ type: 'new' });
      if (e.kind === 'cos') out.push({ type: 'reading', entry: e, turn: lastTurn && lastTurn.at <= e.at ? lastTurn : undefined });
      else if (e.kind === 'you') out.push({ type: 'msg', entry: e });
      else {
        const last = out.at(-1);
        if (last?.type === 'quiet') last.entries.push(e);
        else out.push({ type: 'quiet', entries: [e] });
      }
    }
    return out;
  }

  // ---------- state ----------
  const fx = window.LAB_FIXTURE;
  const fresh = () => JSON.parse(JSON.stringify(fx));
  let data = fresh();
  const seen = {};
  const resetSeen = () => { for (const g of data.goals) seen[g.id] = g.seenAt; };
  resetSeen();
  let project = data.projects[0].id;
  let goalId = null;
  const pick = Object.fromEntries(SLOTS.map((s) => [s.key, 'base']));
  let width = 1240;

  const goalsIn = (p) => data.goals.filter((g) => g.projectId === p);
  const goal = () => data.goals.find((g) => g.id === goalId);
  function pickGoal() {
    const leads = goalsIn(project);
    if (goalId && leads.some((g) => g.id === goalId)) return;
    goalId = (leads.find((g) => g.needs.length) ?? leads[0])?.id ?? null;
  }
  function select(id) {
    if (goalId && goalId !== id) markSeen(goalId);
    const g = data.goals.find((x) => x.id === id);
    if (g) project = g.projectId;
    goalId = id;
    render();
  }
  function selectProject(id) {
    if (goalId) markSeen(goalId);
    project = id;
    goalId = null;
    render();
  }
  function markSeen(id) {
    const g = data.goals.find((x) => x.id === id);
    if (g) seen[id] = g.entries.at(-1)?.at ?? seen[id];
  }

  // simulated replies: what the lead would say back, after a moment
  const reply = (g, text, delay = 1400) => {
    g.status = 'working';
    render();
    setTimeout(() => {
      const at = Date.now();
      g.entries.push({ kind: 'lead', at, text });
      g.entries.push({ kind: 'cos', at: at + 1, route: 1, why: 'Played back by the lab.', says: `(Played back by the lab.) ${g.lead.replace(/^Lt\. /, '')} has it and is carrying on. Nothing for you.` });
      g.status = 'done';
      render();
    }, delay);
  };
  /** The user just said something: the thread follows to its end, as a chat does. */
  let toEnd = false;
  /**
   * The user writes to the lead directly, as Focus has it today: the lead's next turn answers what that turn put to
   * them, so a turn card and a proposal to close are set aside (a new turn ends the old card; a message cancels a
   * close); a decision raised with the decision tool stays open until they pick (chat never settles one).
   */
  function send(g, words) {
    if (!words.trim()) return;
    toEnd = true;
    const at = Date.now();
    const setAside = g.needs.filter((n) => n.kind === 'turn' || n.kind === 'close');
    g.needs = g.needs.filter((n) => !setAside.includes(n));
    for (const n of g.needs) if (n.kind === 'decision') n.since = at;
    if (setAside.length) {
      const asked = g.entries.findLast((e) => e.kind === 'cos' && (e.route === 2 || e.route === 3));
      if (asked) asked.superseded = true;
    }
    g.entries.push({ kind: 'you', at, text: words.trim() });
    for (const n of setAside) g.entries.push({ kind: 'ops', at: at + 1, from: 'Chief of staff', text: `Set aside "${n.what}": you wrote to ${g.lead} directly, so their next turn answers it.` });
    reply(g, `(Played back by the lab.) Got it: "${words.trim().slice(0, 80)}". I'll carry on with that and report back when there's something to see.`);
  }
  function answer(g, need, option) {
    g.needs = g.needs.filter((n) => n !== need);
    const at = Date.now();
    if (need.kind === 'decision') g.entries.push({ kind: 'decided', at, question: need.what, chosen: option });
    g.entries.push({ kind: 'you', at: at + 1, text: option });
    toEnd = true;
    if (need.kind === 'pr' && option === 'Merge') g.entries.push({ kind: 'merged', at: at + 2, repo: g.prs[0].repo, number: g.prs[0].number });
    reply(g, `(Played back by the lab.) ${option}: on it.`);
  }

  // ---------- the baseline, slot by slot, as stream.ts draws it ----------
  const base = {
    frame(ctx) {
      const n = ctx.needs;
      const right = h('div', { class: 'st-right' }, ctx.head, n.top, ctx.thread, n.below, n.foot);
      return h('div', { class: `st-frame${n.side ? ' has-side' : ''}` },
        h('div', { class: 'st-tabs' }, ctx.tabs),
        h('div', { class: 'st-left' }, h('h3', null, 'Goals'), ctx.goals, ctx.shelf),
        right,
        n.side ? h('div', { class: 'st-side' }, n.side) : null);
    },
    goals(ctx) {
      const list = ctx.goalsHere;
      if (!list.length) return h('p', { class: 'muted' }, 'No goals under way here.');
      return h('div', { class: 'st-goals' }, list.map((g) => {
        const line = goalLine(g, seen[g.id]);
        return h('button', { class: `st-goal ${line.tone}${g.id === goalId ? ' sel' : ''}`, onclick: () => select(g.id) },
          h('span', { class: 'st-goal-title' }, g.title),
          h('small', null, `${g.lead.replace(/^Lt\. /, '')} · ${line.text}`));
      }));
    },
    head(ctx, g) {
      return h('div', { class: 'st-head' },
        h('div', { class: 'st-title' }, g.title),
        h('small', null, `${g.lead} · ${doing(g.status)}${g.done ? ` · Done looks like: ${g.done}` : ''} · `, h('a', { href: '#', onclick: (e) => e.preventDefault() }, 'Open their room')));
    },
    message(ctx, e, g) {
      const v = entryView(e);
      if (v.as === 'you') return h('div', { class: 'st-you' }, h('small', null, `You${v.via ? `, from ${v.via}` : ''} · ${time(e.at)}`), h('div', { class: 'st-text' }, v.text));
      return h('div', { class: 'st-lead' }, h('small', null, `${g.lead} · ${time(e.at)}`), h('div', { class: 'st-md', html: md(v.text) }));
    },
    messages(ctx, segs, g) {
      return segs.map((s) => (s.type === 'new' ? ctx.newLine() : s.type === 'quiet' ? ctx.quietRun(s.entries, g) : ctx.message(s.entry, g)));
    },
    quietLine(ctx, e) {
      const v = entryView(e);
      const line = h('div', { class: `st-line ${v.tone}` }, h('span', null, v.text), h('small', null, time(e.at)));
      if (!v.more) return line;
      return h('details', { class: `st-fold ${v.tone}` }, h('summary', null, line), h('div', { class: 'st-more' }, v.more));
    },
    quiet(ctx, entries) {
      return entries.map((e) => ctx.quietLine(e));
    },
    needs(ctx, g) {
      const need = g.needs[0];
      // with the talk box moved to the workspace (28), the way to it stays under a card too
      return { foot: need ? h('div', null, h('div', { class: 'st-needs' }, 'Needs you'), ctx.card(need, g), ctx.pick.talk === '28' ? ctx.talk(g) : null) : ctx.talk(g) };
    },
  };

  /** What needs the user, as Comms' card shows it: what, the context, and the answers. */
  function card(need, g, opts = {}) {
    const tone = { decision: 'var(--lcars-gold)', close: 'var(--lcars-green)', turn: 'var(--lcars-red)', pr: 'var(--lcars-sky)' }[need.kind];
    return h('div', { class: 'st-card', style: `--tone:${tone}` },
      opts.bare ? null : h('div', { class: 'st-card-goal' }, `${g.title} · ${g.lead}`),
      h('div', { class: 'st-card-what' }, need.what),
      need.since ? h('div', { class: 'st-card-note' }, `You've written to ${g.lead} since this was asked. A decision stays open until you pick one here: chat doesn't settle it.`) : null,
      need.context ? h('div', { class: 'st-card-context', html: md(need.context) }) : null,
      h('div', { class: 'st-card-answers' },
        (need.options ?? []).map((o, i) => h('button', { class: `st-answer${o === need.proposed ? ' proposed' : ''}`, title: o === need.proposed ? 'The lead\'s pick' : null, onclick: () => answer(g, need, o) }, opts.keys ? h('kbd', null, String.fromCharCode(65 + i)) : null, o)),
        opts.noReply ? null : h('button', { class: 'st-answer ghost', onclick: (ev) => { const box = ev.target.closest('.st-card').querySelector('.st-card-reply'); box.hidden = !box.hidden; box.querySelector('textarea').focus(); } }, 'Reply…')),
      opts.noReply ? null : h('div', { class: 'st-card-reply', hidden: true }, talkBox(g, { placeholder: 'Your answer, in words…', after: () => { g.needs = g.needs.filter((n) => n !== need); } })));
  }

  /** Where the box to talk to the lead goes: the foot of the thread, or (28) the lead's workspace when a voice has one. */
  const WORKSPACE_VOICES = ['26', '27'];
  function talk(g, opts = {}) {
    if (pick.talk === '28' && WORKSPACE_VOICES.includes(pick.voice) && !opts.inWorkspace) {
      // with the workspace always open (26) the box is there; as a drawer (27), a way to open it
      return pick.voice === '27' ? h('button', { class: 'st-write', onclick: () => window.labWorkspace?.open('talk') }, `Write to ${g.lead} ›`) : null;
    }
    return talkBox(g, opts);
  }
  function talkBox(g, opts = {}) {
    const box = h('textarea', { rows: opts.rows ?? 3, placeholder: opts.placeholder ?? `Talk to ${g.lead}…` });
    const go = () => { const w = box.value; box.value = ''; opts.after?.(); send(g, w); };
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(); });
    return h('div', { class: 'st-talk' }, box, h('button', { class: 'st-send', onclick: go }, 'Send'));
  }

  // ---------- drawing ----------
  const impl = (slot, fn) => {
    const v = pick[slot] !== 'base' ? byId.get(pick[slot]) : null;
    return v?.[fn] ?? base[fn];
  };

  function ctxFor(g) {
    const ctx = {
      h, md, esc, time, ago, doing, entryView, goalLine, firstPara, segments, newCount, latestNews,
      seen, data, base, card, cosSegments, talk, send, answer, select, selectProject, render,
      get project() { return project; },
      get goalId() { return goalId; },
      pick: { ...pick },
      goalsHere: goalsIn(project),
      allGoals: data.goals,
      projects: data.projects,
      newLine: () => h('div', { class: 'st-new' }, 'New since you last looked'),
      message: (e, gg) => impl('messages', 'message')(ctx, e, gg),
      quietLine: (e, gg) => impl('quiet', 'quietLine')(ctx, e, gg),
      quietRun: (entries, gg) => impl('quiet', 'quiet')(ctx, entries, gg),
      drawMessages: (segs, gg) => impl('messages', 'messages')(ctx, segs, gg),
    };
    ctx.tabs = tabs();
    ctx.shelf = shelf();
    /** The goals list as the goals slot draws it, for any goals (a frame that lists all projects' goals, say). */
    ctx.drawGoals = (list) => impl('goals', 'goals')(Object.assign(Object.create(ctx), { goalsHere: list }));
    ctx.goals = ctx.drawGoals(ctx.goalsHere);
    if (g) {
      ctx.head = impl('head', 'head')(ctx, g);
      const segs = segments(g.entries, seen[g.id]);
      const rows = impl('messages', 'messages')(ctx, segs, g);
      const threadCls = ['st-thread', ...['messages', 'quiet'].map((s) => byId.get(pick[s])?.threadClass).filter(Boolean)].join(' ');
      ctx.thread = h('div', { class: threadCls }, rows.length ? rows : h('p', { class: 'muted' }, 'Nothing said here yet.'));
      // a voice can tell the thread its own way, with a side or a pane under the thread of its own; what needs the
      // user comes after, as it may put itself in the thread (18)
      const voice = byId.get(pick.voice);
      const told = voice?.thread ? voice.thread(ctx, g) : {};
      if (voice?.thread) ctx.thread.replaceChildren(...[told.rows].flat(Infinity).filter(Boolean));
      if (told.cls) ctx.thread.classList.add(told.cls);
      ctx.needs = impl('needs', 'needs')(ctx, g);
      if (told.side) ctx.needs = { ...ctx.needs, side: ctx.needs.side ? [told.side, ctx.needs.side] : told.side };
      if (told.below) ctx.needs = { ...ctx.needs, below: told.below };
    } else {
      ctx.head = h('div');
      ctx.thread = h('div', { class: 'st-thread' }, h('p', { class: 'muted' }, 'Pick a goal.'));
      ctx.needs = {};
    }
    return ctx;
  }

  function tabs() {
    return [
      ...data.projects.map((p) => {
        const n = goalsIn(p.id).reduce((s, g) => s + g.needs.length, 0);
        return h('button', { class: `st-tab${project === p.id ? ' on' : ''}`, style: `--tone:${p.color}`, onclick: () => selectProject(p.id) }, p.name, n ? h('b', null, String(n)) : null);
      }),
      h('button', { class: 'st-tab inbox', title: 'Not in the lab: the stream is what\'s being tried' }, 'Inbox ›'),
    ];
  }

  function shelf() {
    const loose = data.loose.filter((l) => l.projectId === project);
    if (!loose.length) return null;
    return h('div', { class: 'st-shelf' }, h('h3', null, `Ready for you · ${loose.length}`), loose.map((i) => h('div', { class: 'st-shelf-item' }, h('span', null, i.what), h('small', null, i.who))));
  }

  /** How far down `box` (positioned) `el` sits, in its scrolled content. */
  function offsetIn(el, box) {
    let y = 0;
    for (let at = el; at && at !== box; at = at.offsetParent) y += at.offsetTop;
    return y;
  }

  /**
   * The side panels fold to a strip and open again, whatever the frame: the goals on the left (`.st-left`), and at the
   * right whatever sits beside the thread (`.st-side`, the dossier). Folded, a strip keeps a word on what's in it.
   */
  const folded = { left: false, right: false };
  function foldable(panel) {
    const left = panel.querySelector('.st-left');
    const right = panel.querySelector('.st-side') ?? panel.querySelector('.dossier');
    const strip = (el, side) => {
      if (!el) return;
      const g = goal();
      const needs = data.goals.reduce((n, x) => n + x.needs.length, 0);
      const label = side === 'left' ? `Goals${needs ? ` · ${needs} need you` : ''}` : (el.querySelector('.ws-h b, h3')?.textContent ?? (g ? `${g.lead}'s workspace` : 'Side'));
      el.classList.add('foldable');
      el.classList.toggle('folded', folded[side]);
      const btn = h('button', { class: `fold-btn ${side}`, title: folded[side] ? 'Open' : 'Fold away', onclick: () => { folded[side] = !folded[side]; render(); } }, folded[side] ? (side === 'left' ? '›' : '‹') : (side === 'left' ? '‹' : '›'));
      el.prepend(btn);
      if (folded[side]) el.append(h('button', { class: 'fold-strip', onclick: () => { folded[side] = false; render(); } }, h('span', null, label)));
    };
    strip(left, 'left');
    strip(right, 'right');
    panel.style.setProperty('--left-w', folded.left && left ? '40px' : '');
    panel.style.setProperty('--side-w', folded.right && right ? '40px' : '');
    if (!(folded.left && left)) panel.style.removeProperty('--left-w');
    if (!(folded.right && right)) panel.style.removeProperty('--side-w');
  }

  const stage = () => document.getElementById('stage');
  let keepScroll = null;
  function render() {
    pickGoal();
    const g = goal();
    const ctx = ctxFor(g);
    const frame = impl('frame', 'frame')(ctx, g);
    const panel = stage();
    const old = panel.querySelector('.st-thread');
    const sameGoal = keepScroll === goalId && old;
    const top = sameGoal ? old.scrollTop : 0;
    const atEnd = sameGoal && (toEnd || old.scrollTop + old.clientHeight >= old.scrollHeight - 30);
    toEnd = false;
    panel.className = ['st-root', ...Object.values(pick).filter((v) => v !== 'base').map((v) => `v-${v}`)].join(' ');
    panel.replaceChildren(frame);
    foldable(panel);
    const t = panel.querySelector('.st-thread');
    if (t) {
      if (sameGoal) t.scrollTop = atEnd ? t.scrollHeight : top;
      else {
        // to where what's new begins, else the end: scrolled within the thread alone, never the page around it
        const to = t.querySelector('.st-new');
        t.scrollTop = to ? offsetIn(to, t) - 8 : t.scrollHeight;
      }
    }
    keepScroll = goalId;
    drawControls();
  }

  // ---------- the lab's own controls ----------
  function hashState() {
    const parts = SLOTS.filter((s) => pick[s.key] !== 'base').map((s) => `${s.key}=${pick[s.key]}`);
    if (width !== 1240) parts.push(`w=${width}`);
    history.replaceState(null, '', `#${parts.join('&')}`);
  }
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    for (const s of SLOTS) {
      const v = q.get(s.key);
      pick[s.key] = v && byId.get(v)?.slot === s.key ? v : 'base';
    }
    width = Number(q.get('w')) || 1240;
  }
  function setPick(slot, id) {
    pick[slot] = id;
    injectCss();
    hashState();
    render();
  }
  function toggle(v) {
    setPick(v.slot, pick[v.slot] === v.id ? 'base' : v.id);
  }

  function injectCss() {
    // a new combination starts with nothing opened over it (the workspace drawer, say)
    window.dispatchEvent(new Event('lab-reset'));
    let s = document.getElementById('variation-css');
    if (!s) s = document.head.appendChild(h('style', { id: 'variation-css' }));
    s.textContent = variations.map((v) => v.css ?? '').join('\n');
  }

  function drawControls() {
    const bar = document.getElementById('slots');
    bar.replaceChildren(...SLOTS.map((s) => {
      const sel = h('select', { onchange: (e) => setPick(s.key, e.target.value) },
        h('option', { value: 'base' }, `Baseline: ${s.base}`),
        variations.filter((v) => v.slot === s.key).map((v) => h('option', { value: v.id, selected: pick[s.key] === v.id }, `${v.id}. ${v.name}`)));
      return h('label', { class: `slot${pick[s.key] !== 'base' ? ' changed' : ''}` }, h('span', null, s.label), sel);
    }));
    const list = document.getElementById('variations');
    list.replaceChildren(...SLOTS.map((s) => h('div', { class: 'vgroup' },
      h('div', { class: 'vgroup-h' }, s.label),
      variations.filter((v) => v.slot === s.key).map((v) => h('button', { class: `vchip${pick[s.key] === v.id ? ' on' : ''}`, onclick: () => toggle(v), title: v.idea },
        h('b', null, v.id), h('span', null, v.name), h('small', null, v.idea))))));
    for (const b of document.querySelectorAll('#widths button')) b.classList.toggle('on', Number(b.dataset.w) === width);
    stage().style.width = `${width}px`;
    const active = variations.filter((v) => pick[v.slot] === v.id);
    document.getElementById('combo').textContent = active.length ? `Combined: ${active.map((v) => `${v.id} ${v.name}`).join(' + ')}` : 'Baseline: the stream as it is today';
  }

  // the tour: ← and → step through the variations one at a time, each alone on the baseline
  let tour = -1;
  function step(d) {
    tour = (tour + d + variations.length) % variations.length;
    for (const s of SLOTS) pick[s.key] = 'base';
    pick[variations[tour].slot] = variations[tour].id;
    injectCss();
    hashState();
    render();
  }
  function shuffle() {
    for (const s of SLOTS) {
      const opts = ['base', ...variations.filter((v) => v.slot === s.key).map((v) => v.id)];
      pick[s.key] = opts[Math.floor(Math.random() * opts.length)];
    }
    injectCss();
    hashState();
    render();
  }

  window.addEventListener('DOMContentLoaded', () => {
    variations.sort((a, b) => Number(a.id) - Number(b.id));
    readHash();
    injectCss();
    document.getElementById('shuffle').onclick = shuffle;
    // the combination the user picked, 26 October 2026
    document.getElementById('picked').onclick = () => { location.hash = 'frame=3&goals=6&head=8&voice=26&quiet=13&needs=18&talk=28'; };
    document.getElementById('baseline').onclick = () => { for (const s of SLOTS) pick[s.key] = 'base'; injectCss(); hashState(); render(); };
    document.getElementById('reset').onclick = () => { window.dispatchEvent(new Event('lab-reset')); data = fresh(); resetSeen(); project = data.projects[0].id; goalId = null; keepScroll = null; render(); };
    document.getElementById('prev').onclick = () => step(-1);
    document.getElementById('next').onclick = () => step(1);
    for (const b of document.querySelectorAll('#widths button')) b.onclick = () => { width = Number(b.dataset.w); hashState(); render(); };
    window.addEventListener('keydown', (e) => {
      if (e.target.closest('textarea, input, select')) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    });
    window.addEventListener('hashchange', () => { readHash(); injectCss(); render(); });
    render();
  });
})();
