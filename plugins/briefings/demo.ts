// The briefings plugin in the demo ship: the explainer its scripted leads put up, as a real lead's explain call would.
import type { ExplainerInput } from './explainer';

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * Demo mode: the explainer a lead walks the captain through first, a save travelling from the shopper through each repo
 * to the database and waiting out an outage. Its script is written for the explain tool, as a lead's would be.
 */
export function demoExplainer(folders: readonly string[], detailed = false): ExplainerInput {
  const boxes = ['shopper', ...folders, 'database'];
  const step = 1050 / boxes.length;
  const html = boxes.map((b, i) =>
    `<div class="panel box" style="left:${Math.round(i * step)}px;top:150px;width:${Math.round(step - 40)}px;--c:var(--${i === 0 ? 'lilac' : i === boxes.length - 1 ? 'sky' : 'peach'})"><div class="hd"><span>${escapeHtml(b)}</span><span>0${i + 1}</span></div><div class="bd"><span class="state"></span></div></div>`,
  ).join('') + '<span class="lbl" style="left:0;top:40px">The journey of one save</span><div class="pill" id="save" style="top:330px;--c:var(--gold)">♥ save</div>';
  const script = `
const boxes = $$('.box'), last = boxes.length - 1;
const colours = boxes.map(b => b.style.getPropertyValue('--c'));
const centre = i => boxes[i].offsetLeft + boxes[i].offsetWidth / 2 - 50;
// where the save is at t: hops along the boxes in beats 1 and 2, waits at the last repo in beat 3 until the database is back
function at(t) {
  if (t < B[1]) return p(t, 1, B[1] - .5);
  if (t < B[2]) return 1 + (last - 2) * p(t, B[1] + .3, B[2] - .5);
  return last - 1 + p(t, B[2] + 3.2, B[2] + 4.2);
}
function render(t) {
  const x = at(t), i = Math.floor(x), k = x - i;
  const pos = i >= last ? centre(last) : centre(i) + (centre(i + 1) - centre(i)) * k;
  $('#save').style.transform = 'translateX(' + pos + 'px)';
  const down = t > B[2] + .3 && t < B[2] + 3.2;
  boxes.forEach((b, n) => {
    const reached = x >= n - .01;
    b.style.setProperty('--c', n === last && down ? 'var(--red)' : colours[n]);
    b.querySelector('.state').innerHTML = n === last ? (down ? tag('offline', 'red') : reached ? tag('saved ✓', 'green') : '') : n === last - 1 && down ? tag('retry queued', 'gold') : reached ? tag('passed on', 'green') : '';
  });
}`;
  return {
    id: 'save-journey',
    title: 'How a save travels',
    beats: [
      { title: 'The shopper saves an item', text: 'Pressing save sends one small request: which item, and who is saving it. Nothing else changes on the page until it is safely stored.', seconds: 4, label: 'Save', narration: 'On the far left is the shopper. When they press save, that gold pill sets off: one small request saying which item, and who is saving it.' },
      { title: 'Each repo passes it on', text: `It travels through ${folders.join(' and ')}, each checking what it owns before handing it to the next, and lands as one row in the database.`, seconds: 5, label: 'Pass it on', narration: 'Watch it hop along the boxes in the middle. Each one is a repo, and each checks the part it owns before handing the save on, until it lands as a row in the database on the right.' },
      detailed
        ? { title: 'If the database is down, it retries', text: 'The last repo keeps the save in a retry queue and tries again three times, a second apart. If the database is still down after the third, the page tells the shopper it couldn’t save, and the item stays in the queue.', seconds: 6, label: 'Outage', narration: 'Here is that part in more detail. The database goes red, and the save waits in the retry queue at the last repo. It tries three times, a second apart. If the database is still down after the third, the shopper is told, and the save stays queued until it is back.' }
        : { title: 'If the database is down, it waits', text: 'The last repo keeps the save in a retry queue rather than dropping it, and sends it again when the database is back, so the shopper never loses an item.', seconds: 6, label: 'Outage', narration: 'Now the database goes red: it is down. Notice the save does not vanish. It waits at the last repo in a retry queue, and the moment the database is back, it goes through.' },
    ],
    stage: { html, css: '.box .bd { min-height:60px; }', script },
  };
}
