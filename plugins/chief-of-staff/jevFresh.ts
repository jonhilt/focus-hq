import type { LedgerEvent } from '../../plugin-api/server';
import { isOneOf, isRecord } from '../../plugin-api/shared';
import { answersOf, type JevAnswer } from './jevRoute';
import { type CosRoute, ROUTES, SENDER } from './shared';

// The Jev backtest's fresh check (README.md#backtesting-jev): lead turns the captain replied to since the backtest's
// own turns, a sample of them for the captain to label, and the live judge's route for each, to score Jev against on
// turns nothing was tuned on. The script (`scripts/jevFresh.ts`) reads the ledger and writes the files.

/** A lead's ended turn the captain replied to, keyed as `replies.jsonl` keys them, with the live judge's route if it read it. */
export interface FreshTurn {
  id: string;
  goal?: string;
  agent: string;
  at: string;
  lead: string;
  captain: string;
  live?: { route: CosRoute; version: string };
}

/**
 * Whether a reply is the captain's to an ended turn: not the chief of staff's own words sent for them, and not the
 * captain stopping a turn part-way (no ended turn for the judge to read, and nothing on the card to label by).
 */
export const captainsAnswer = (captain: string): boolean => !captain.startsWith(`[${SENDER}]`) && !captain.startsWith('[Request interrupted');

/**
 * The turns the captain answered (`captainsAnswer`) at or after `since` (an ISO time), each with the live judge's
 * latest verdict on it, matched by the turn (the second half of the replies' key). `skip` leaves out a goal's turns.
 */
export function freshTurns(events: readonly LedgerEvent[], since: string, skip: (goal: string | undefined) => boolean = () => false): FreshTurn[] {
  const live = new Map<string, FreshTurn['live']>();
  for (const e of events) if (e.kind === 'cos-verdict') live.set(`${e.sessionId}:${e.turnUuid}`, { route: e.route, version: e.version });
  return events.flatMap((e) => {
    if (e.kind !== 'captain-replies' || skip(e.goal)) return [];
    return e.replies.flatMap((r, n) => {
      if (!r.at || r.at < since || !captainsAnswer(r.captain)) return [];
      const verdict = live.get(e.key);
      return [{ id: `${e.key}#${n}`, ...(e.goal && { goal: e.goal }), agent: e.agent, at: r.at, lead: r.lead, captain: r.captain, ...(verdict && { live: verdict }) }];
    });
  });
}

/**
 * `count` turns, at most `perGoal` from any one goal so a busy goal doesn't fill the sample, taken in `rank` order (a
 * stable hash of the id, so the same ledger gives the same sample) and then put back in time order.
 */
export function pickSample(turns: readonly FreshTurn[], count: number, perGoal: number, rank: (id: string) => string): FreshTurn[] {
  const taken = new Map<string, number>();
  const picked: FreshTurn[] = [];
  for (const t of [...turns].sort((a, b) => rank(a.id).localeCompare(rank(b.id)))) {
    if (picked.length >= count) break;
    const goal = t.goal ?? '';
    if ((taken.get(goal) ?? 0) >= perGoal) continue;
    taken.set(goal, (taken.get(goal) ?? 0) + 1);
    picked.push(t);
  }
  return picked.sort((a, b) => a.at.localeCompare(b.at));
}

const CUT = /^\[−\d+\]…\s*/;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Text as a card shows it: escaped, with markdown's bold and code kept. */
export const cardText = (s: string): string =>
  escape(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>');

/**
 * The labelling page: a card a turn (the end of what the lead said, and the captain's reply), labelled 1, 2 or 3 as
 * the blind sample was, kept in the browser as they go, and at the end the labels as one line ("1:3 2:1 …") for
 * `fresh/captain.txt`.
 */
export function labelCards(sample: readonly FreshTurn[]): string {
  const cards = sample.map((t, i) => ({ n: i + 1, who: `${t.goal ?? '(untitled)'} · ${t.agent}`, cut: CUT.test(t.lead), lead: cardText(t.lead.replace(CUT, '')), cap: cardText(t.captain) }));
  const data = JSON.stringify(cards).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset=utf-8><title>Fresh labels</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b0b10;color:#ece7da;font:19px/1.5 system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:18px;padding:14px 28px;border-bottom:1px solid #2a2a36}h1{font:600 24px system-ui;color:#f2a33a;margin:0}
.prog{flex:1;height:8px;background:#22222c;border-radius:4px;overflow:hidden}.prog i{display:block;height:100%;background:#f2a33a}
main{flex:1;display:grid;grid-template-columns:1.35fr 1fr;gap:22px;padding:18px 28px;min-height:0}.col{display:flex;flex-direction:column;min-height:0}
.lbl{font:600 14px system-ui;letter-spacing:1.5px;text-transform:uppercase;color:#8fb8ff;margin-bottom:6px}.who{color:#9a96a8;font-size:15px;margin-bottom:8px}
.box{flex:1;overflow:auto;background:#15151d;border-radius:10px;padding:16px 20px;white-space:pre-wrap;word-wrap:break-word}
#cap{border-left:5px solid #f2a33a;background:#1e1810;color:#ffdca8}#lead{border-left:5px solid #8fb8ff}.cut{color:#77738a;font-style:italic;font-size:15px}
code{font:16px monospace;background:#262633;padding:1px 5px;border-radius:4px}
footer{display:flex;gap:14px;padding:14px 28px 20px;border-top:1px solid #2a2a36}
button{flex:1;border:0;border-radius:10px;padding:12px;font:600 18px system-ui;background:#22222c;color:#ece7da;cursor:pointer;text-align:left}
button small{display:block;font:400 14px system-ui;color:#a9a4b6;margin-top:4px}button.nav{flex:0 0 60px;text-align:center}button.on{outline:3px solid #f2a33a}
#done{display:none;padding:40px}textarea{width:100%;height:90px;font:16px monospace;background:#15151d;color:#ece7da;border:0;border-radius:8px;padding:12px}
</style>
<header><h1>Fresh labels</h1><div class=prog><i id=bar></i></div><div id=count></div></header>
<main id=card><div class=col><div class=lbl>The lead said</div><div class=who id=who></div><div class=box id=lead></div></div>
<div class=col><div class=lbl>You replied</div><div class=who>&nbsp;</div><div class=box id=cap></div></div></main>
<div id=done><p>Done. Paste this line into <code>~/.focus/chief-of-staff/fresh/captain.txt</code> (or just send it to your lead):</p><textarea id=out readonly></textarea></div>
<footer><button class=nav onclick=go(-1)>←</button>
<button class=b1 onclick=pick(1)>1 · Carry on<small>Nothing. It could have just kept going.</small></button>
<button class=b2 onclick=pick(2)>2 · Easy pick<small>A choice it could have offered with an obvious recommendation.</small></button>
<button class=b3 onclick=pick(3)>3 · My call<small>My judgement: a design call, new direction, a correction or facts only I have.</small></button>
<button class=nav onclick=go(1)>→</button></footer>
<script>
const C=${data};let i=0;const A=JSON.parse(localStorage.getItem('cos-fresh')||'{}');const $=id=>document.getElementById(id);
function show(){const done=i>=C.length;$('card').style.display=done?'none':'grid';$('done').style.display=done?'block':'none';
$('bar').style.width=(Object.keys(A).length/C.length*100)+'%';$('count').textContent=done?'Done':(i+1)+' of '+C.length;
document.querySelectorAll('footer button').forEach(b=>b.classList.remove('on'));
if(done){$('out').value=C.map(c=>c.n+':'+(A[c.n]||'?')).join(' ');return}
const c=C[i];$('who').textContent=c.who;$('lead').innerHTML=(c.cut?'<span class=cut>…the start is cut</span>\\n':'')+c.lead;$('cap').innerHTML=c.cap;
$('lead').scrollTop=$('lead').scrollHeight;$('cap').scrollTop=0;if(A[c.n])document.querySelector('.b'+A[c.n]).classList.add('on')}
function pick(v){if(i>=C.length)return;A[C[i].n]=v;localStorage.setItem('cos-fresh',JSON.stringify(A));i++;show()}
function go(d){i=Math.max(0,Math.min(C.length,i+d));show()}
addEventListener('keydown',e=>{if('123'.includes(e.key)&&e.key)pick(+e.key);else if(e.key=='ArrowLeft')go(-1);else if(e.key=='ArrowRight')go(1)});show();
</script>
`;
}

/** The live judge's route on each turn of `turns.jsonl`'s lines, where it read one. */
export function liveRoutes(lines: readonly unknown[]): Map<string, CosRoute> {
  const routes = new Map<string, CosRoute>();
  for (const t of lines) {
    const route = isRecord(t) && isRecord(t.live) ? t.live.route : undefined;
    if (isRecord(t) && typeof t.id === 'string' && isOneOf(ROUTES, route)) routes.set(t.id, route);
  }
  return routes;
}

/** Jev's answers on each turn, from the lines of a `-raw.jsonl` file. */
export function answersById(lines: readonly unknown[]): Map<string, Record<string, JevAnswer>> {
  const answers = new Map<string, Record<string, JevAnswer>>();
  for (const r of lines) if (isRecord(r) && typeof r.id === 'string') answers.set(r.id, answersOf(r.answers));
  return answers;
}
