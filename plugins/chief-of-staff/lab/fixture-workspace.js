// Sample of what a lead works with besides their words, for the stream lab's workspace voices (workspace.js): what
// they put on their station's screen (`artifacts`), the page their browser preview shows (`preview`), and what
// they've been doing lately (`activity`). Loaded after fixture.js and before lab.js, which copies the sample.
(function () {
  const { now } = window.LAB_FIXTURE;
  const ago = (m) => now - m * 60_000;
  const byId = Object.fromEntries(window.LAB_FIXTURE.goals.map((g) => [g.id, g]));

  const page = (body) => `<!doctype html><html><body style="margin:0;font:14px/1.4 system-ui,sans-serif;background:#0b0912;color:#f1eaff;padding:16px">${body}</body></html>`;
  const box = (label, inner, tone = '#ff9966') => `<div style="flex:1;border:2px solid ${tone};border-radius:10px;padding:10px;min-height:150px"><b style="color:${tone}">${label}</b>${inner}</div>`;
  const bar = (w, c = '#3a3352') => `<div style="height:10px;width:${w}%;background:${c};border-radius:4px;margin:6px 0"></div>`;
  const tabs = (dots) => `<div style="display:flex;gap:8px">${['Focus', 'Sock Shop', 'Space Dodger'].map((n, i) => `<span style="background:#1b1630;border-radius:999px;padding:5px 12px;${i === 0 ? 'border:2px solid #ff9966;color:#ff9966' : ''}">${n}${dots[i] ? ` <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dots[i]};vertical-align:middle"></span>` : ''}</span>`).join('')}</div>`;

  byId['g-stream'].artifacts = [
    { at: ago(25 * 60 + 21), kind: 'Mockups', title: 'Three layouts for the stream', html: page(`<div style="display:flex;gap:10px">${box('A · the inbox, kept', bar(90) + bar(70) + bar(80) + bar(60))}${box('B · a thread per goal', `<div style="display:flex;gap:6px"><div style="width:35%">${bar(100, '#ff9900') + bar(100) + bar(100)}</div><div style="flex:1">${bar(80) + bar(95) + bar(40, '#24304d') + bar(90)}</div></div>`, '#99cc66')}${box('C · one feed', bar(70) + bar(40, '#24304d') + bar(85) + bar(60) + bar(30, '#24304d'))}</div><p style="color:#a49db4">B picked, 25 Oct.</p>`) },
    { at: ago(18 * 60 + 2), kind: 'Screenshot', title: 'Comms opens as the stream (#684)', html: page(`${tabs([])}<div style="display:flex;gap:12px;margin-top:12px"><div style="width:32%">${bar(100, '#1b1630') + bar(100, '#1b1630') + bar(100, '#1b1630')}</div><div style="flex:1"><b>Rethink the chief of staff…</b>${bar(90) + bar(60) + bar(40, '#24304d') + bar(80)}<div style="border-left:8px solid #ff9900;background:#1b1630;padding:8px;border-radius:0 8px 8px 0">Needs you · …</div></div></div>`) },
    { at: ago(81), kind: 'Mockups', title: 'Unread on the tabs: three ways', html: page(`<p><b>1 · Counts on the tabs</b></p>${tabs(['', '', ''])}<p style="color:#a49db4;margin:4px 0 12px">Focus 14 · Sock Shop 3 · Space Dodger 0</p><p><b>2 · Counts on goals only</b></p>${tabs(['', '', ''])}<p><b>3 · A dot on the tab</b> <span style="color:#99cc66">(built in #691)</span></p>${tabs(['#ff9900', '#99ccff', ''])}`) },
  ];
  byId['g-stream'].preview = { url: 'http://127.0.0.1:59626/ · demo ship on #691', html: page(`<div style="border:10px solid #ff9966;border-radius:18px;padding:12px;background:#000"><div style="text-align:right;color:#ff9966;font-weight:700;letter-spacing:.1em">COMMS</div>${tabs(['#ff9900', '#99ccff', ''])}<div style="display:flex;gap:10px;margin-top:12px"><div style="width:35%">${bar(100, '#1b1630') + bar(100, '#1b1630')}</div><div style="flex:1">${bar(80) + bar(50) + bar(90)}</div></div></div>`) };
  byId['g-stream'].activity = [
    { at: ago(78), text: 'Read plugins/chief-of-staff/stream.ts' },
    { at: ago(74), text: 'Edited stream.ts: a dot on a project tab when anything in it is new or needs you' },
    { at: ago(70), text: 'pnpm vitest streamList — 44 passed' },
    { at: ago(66), text: 'Opened the demo ship, screenshot of the tabs' },
    { at: ago(61), text: 'gh pr create → jonhilt/focus#691' },
    { at: ago(40), text: 'QA is reviewing #691', quiet: true },
  ];

  byId['g-phone'].artifacts = [
    { at: ago(131), kind: 'Table', title: 'Flagged turn → phone, 12 test turns', html: page(`<table style="border-collapse:collapse;width:100%">${['8.1', '9.4', '11.0', '12.2', '13.8', '14.1', '15.5', '16.0', '18.7', '19.9', '21.3', '22.0'].map((s, i) => `<tr><td style="padding:3px 8px;color:#a49db4">turn ${i + 1}</td><td style="padding:3px 8px">${s} s</td><td style="width:60%"><div style="height:8px;width:${(Number(s) / 60) * 100}%;background:#99cc66;border-radius:3px"></div></td></tr>`).join('')}</table><p style="color:#a49db4">All inside the 60 s done looks like asks for.</p>`) },
  ];
  byId['g-phone'].activity = [
    { at: ago(40), text: 'Read plugins/chief-of-staff/botHook.ts' },
    { at: ago(22), text: 'Edited phone.ts: a reply from Telegram goes to the lead as the user\'s' },
    { at: ago(9), text: 'pnpm vitest phone — running…', live: true },
  ];

  byId['g-ledger'].activity = [
    { at: ago(45), text: 'Wrote server/ledgerCrash.test.ts: kill -9 mid-write, then read the file back' },
    { at: ago(30), text: 'pnpm vitest ledgerCrash — fsync: EPERM (operation not permitted)', bad: true },
    { at: ago(24), text: 'Retried with the sandbox\'s tmp dir — EPERM again', bad: true },
    { at: ago(20), text: 'Stopped to ask', quiet: true },
  ];

  const product = (stock) => page(`<div style="background:#fff;color:#222;border-radius:10px;padding:16px;display:flex;gap:16px"><div style="width:140px;height:140px;background:repeating-linear-gradient(45deg,#f6c,#f6c 10px,#fde 10px,#fde 20px);border-radius:8px"></div><div><h2 style="margin:0 0 6px">Stripy Socks</h2><div style="font-size:18px">£8.00</div><div style="color:${stock ? '#b00' : '#080'};font-weight:600;margin:10px 0">${stock ? `Only ${stock} left` : 'In stock'}</div><button style="background:#222;color:#fff;border:0;border-radius:6px;padding:8px 14px">Add to basket</button></div></div>`);
  byId['g-stock'].artifacts = [
    { at: ago(26), kind: 'Screenshot', title: 'Product page, low stock', html: product(3) },
    { at: ago(26), kind: 'Screenshot', title: 'Product page, plenty', html: product(0) },
  ];
  byId['g-stock'].preview = { url: 'http://localhost:5173/socks/stripy · webshop-web on #12', html: product(3) };
  byId['g-stock'].activity = [
    { at: ago(35), text: 'Edited ProductPage.tsx: a stock line under the price' },
    { at: ago(28), text: 'Opened localhost:5173/socks/stripy' },
    { at: ago(25), text: 'gh pr create → demo/webshop-web#12' },
  ];
  byId['g-save'].preview = { url: 'http://localhost:5173/basket · webshop-web', html: page('<div style="background:#fff;color:#222;border-radius:10px;padding:16px"><h3 style="margin:0 0 8px">Your basket</h3><p>Stripy Socks × 2</p><h4 style="margin:14px 0 6px;color:#666">Saved for later</h4><p>Wool Hiking Socks · <a href="#">Move to basket</a></p></div>') };
})();
