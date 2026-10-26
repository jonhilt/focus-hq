// Sample ship for the stream lab: two projects, their goals, each goal's thread as /thread/:id serves it (thread.ts's
// ThreadEntry), what needs the user on each, and what waits outside any goal. Fictional, shaped like real threads:
// long reports from the lead, many quiet lines from Ops, QA and the chief of staff between them.
(function () {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const now = Date.now();
  const ago = (m) => now - m * MIN;

  const projects = [
    { id: 'p-focus', name: 'Focus', color: '#ff9966' },
    { id: 'p-socks', name: 'Sock Shop', color: '#99ccff' },
    { id: 'p-dodger', name: 'Space Dodger', color: '#cc99cc' },
  ];

  const g1 = {
    id: 'g-stream', projectId: 'p-focus', lead: 'Lt. Varga', status: 'done',
    title: 'Rethink the chief of staff as one stream, from the evidence',
    done: 'Comms opens as a stream per project, a thread per goal, and the user answers what needs them without leaving it.',
    seenAt: ago(95),
    prs: [
      { repo: 'jonhilt/focus', number: 682, title: 'A goal\'s thread, served by the chief of staff', state: 'merged' },
      { repo: 'jonhilt/focus', number: 684, title: 'Comms opens as the stream', state: 'merged' },
      { repo: 'jonhilt/focus', number: 688, title: 'The stream reads in the sessions\' mono', state: 'merged' },
      { repo: 'jonhilt/focus', number: 689, title: 'The stream reads in plain sans again', state: 'merged' },
      { repo: 'jonhilt/focus', number: 691, title: 'Unread counts per goal on the project tabs', state: 'qa' },
    ],
    decisions: [
      { q: 'Which layout for the stream?', chosen: 'B: a thread per goal' },
      { q: 'Reading face for the stream', chosen: 'Plain sans at 16px' },
    ],
    needs: [
      {
        id: 'n1', kind: 'decision', what: 'Should unread counts show on the project tabs, or only on each goal?',
        context: 'Counting per tab tells you **where** to look before you pick a project; per goal keeps the tabs quiet. The backtest says you switch project 9 times a day on average.',
        options: ['Counts on the tabs and goals', 'Counts on goals only', 'A dot on the tab, counts on goals'],
        proposed: 'A dot on the tab, counts on goals',
      },
    ],
    entries: [
      { kind: 'you', at: ago(26 * 60), text: 'Rethink the CoS as one stream. Start from what the evidence says I actually do with the inbox.' },
      { kind: 'lead', at: ago(25 * 60 + 20), text: "I read the last fortnight of the ledger: 759 lead turns, and what you did with each.\n\n**What stood out**\n- You answered 36% of the turns put in front of you, and most of the rest sat in the inbox until the lead moved on.\n- Of the ones you answered, 71% you answered in the goal's room, not the inbox: you wanted the conversation around it.\n- Three projects carry 90% of the turns.\n\nSo the shape I'd propose is **one stream per project, a thread per goal**: what needs you stays pinned, the rest reads as a conversation. I've put three mockups on the screen: A keeps the inbox, B is the thread per goal, C is a single interleaved feed." },
      { kind: 'cos', at: ago(25 * 60 + 19), route: 2, why: 'The lead brings three mockups and asks for a pick: a product call that is the user\'s.' , says: "Varga read a fortnight of your inbox: you answer about a third of what's put to you, and mostly from the goal's room. They propose a stream per project, a thread per goal, and want you to pick from three mockups." },
      { kind: 'decided', at: ago(24 * 60), question: 'Which layout for the stream?', chosen: 'B: a thread per goal' },
      { kind: 'you', at: ago(24 * 60), text: 'B. Go.' },
      { kind: 'lead', at: ago(22 * 60), text: "B it is. I've opened #682: a goal's thread, served by the chief of staff at `/thread/:id`. It's built from what Focus keeps already (the lead's log, its transcript and the ledger), so nothing new is stored.\n\nNext I'll put the stream itself in Comms behind the same key, with the old inbox a press away while this proves itself." },
      { kind: 'cos', at: ago(22 * 60 - 1), route: 1, why: 'Building what was picked.', says: "Agreed direction: #682 serves a goal's thread, built from what Focus already keeps. Nothing for you." },
      { kind: 'ops', at: ago(21 * 60), from: 'QA officer Lt. Nakamura', text: 'QA passed jonhilt/focus#682: the thread is built in order from the three sources, the tests cover each kind, typecheck and lint pass.' },
      { kind: 'merged', at: ago(20 * 60 + 50), repo: 'jonhilt/focus', number: 682 },
      { kind: 'ops', at: ago(20 * 60 + 50), from: 'Ops', text: 'Slice 1 has landed: jonhilt/focus#682 merged. Start what\'s next on a fresh branch from the base.' },
      { kind: 'lead', at: ago(18 * 60), text: "#684 is up: Comms opens as the stream. Along the top the projects, on the left the project's goals, on the right the goal picked as its thread.\n\n- A line marks where what's new since you last looked begins.\n- At the foot is the card Comms always showed for what needs you, answered the same way.\n- **Inbox ›** gets you the single list.\n\nScreenshot on the screen." },
      { kind: 'cos', at: ago(18 * 60 - 1), route: 1, why: 'A report on work in the agreed direction, with QA still to come: nothing for the user yet.' , says: "Comms now opens as the stream (#684), the old inbox a press away. It's with QA; nothing for you." },
      { kind: 'ops', at: ago(17 * 60), from: 'QA officer Lt. Nakamura', text: 'QA passed jonhilt/focus#684: opened the stream on a demo ship, picked goals, answered a card from the foot.' },
      { kind: 'merged', at: ago(16 * 60 + 40), repo: 'jonhilt/focus', number: 684 },
      { kind: 'ops', at: ago(16 * 60 + 40), from: 'Ops', text: 'Slice 2 has landed: jonhilt/focus#684 merged.' },
      { kind: 'you', at: ago(6 * 60), via: 'phone', text: 'try the mono for the stream, the sans feels off next to the rest of the ship' },
      { kind: 'lead', at: ago(5 * 60 + 30), text: "Done in #688: the stream's words are set in the sessions' mono now, title and buttons included. It's denser: about 15% fewer words fit a line at the same size." },
      { kind: 'cos', at: ago(5 * 60 + 29), route: 1, why: 'Did as asked.', says: "The stream is in the mono now (#688), as you asked. It fits about 15% fewer words a line." },
      { kind: 'merged', at: ago(5 * 60), repo: 'jonhilt/focus', number: 688 },
      { kind: 'you', at: ago(3 * 60), text: 'no, go back to the sans. the mono is hard going for long reports' },
      { kind: 'decided', at: ago(3 * 60), question: 'Reading face for the stream', chosen: 'Plain sans at 16px' },
      { kind: 'lead', at: ago(2 * 60 + 40), text: "#689 reverts it: the stream is back in the plain sans. QA confirmed the styles match the version before #688 exactly." },
      { kind: 'cos', at: ago(2 * 60 + 39), route: 4, why: 'Says #689 is merged and the stream is back in sans, but shows no check. The user would rely on that.', message: 'Before this goes to the user: you say the stream is back in the sans, but give no evidence. Check the merged build and show a fresh screenshot.' , says: "Varga says the sans is back (#689) but showed no check, so I've sent it back for a screenshot of the merged build. Nothing for you yet." },
      { kind: 'ops', at: ago(2 * 60 + 10), from: 'QA officer Lt. Nakamura', text: 'QA passed jonhilt/focus#689: the CSS matches the file as it stood before #688, with no diff. Lint passes.' },
      { kind: 'merged', at: ago(2 * 60), repo: 'jonhilt/focus', number: 689 },
      { kind: 'ops', at: ago(2 * 60), from: 'Ops', text: 'Slice 6 has landed: jonhilt/focus#689 merged.' },
      { kind: 'you', at: ago(100), text: 'the tabs need to tell me where to look. some kind of unread count?' },
      { kind: 'lead', at: ago(80), text: "Two ways to do it, and they pull against each other:\n\n1. **Counts on the tabs**: you see where to look before picking a project, but the tabs get busy, and a count of 14 says nothing about what's in it.\n2. **Counts on goals only**: the tabs stay quiet, but you have to open each project to know.\n\nThere's a middle way: a **dot** on a tab when anything in it is new or needs you, with the counts on the goals. I've built the dot version in #691 so you can see it; it's in QA now.\n\nWhich do you want?" },
      { kind: 'cos', at: ago(79), route: 2, why: 'A trade-off with no agreed answer: the user\'s pick.' , says: 'Varga needs a call on unread counts: on the tabs, on goals only, or a dot on the tab with counts on goals. They lean to the dot and have built it in #691 for you to see.' },
      { kind: 'ops', at: ago(60), from: 'Ops', text: 'Ops is following jonhilt/focus#691 for this goal. QA has it.' },
      { kind: 'ops', at: ago(40), from: 'QA officer Lt. Nakamura', text: 'QA is reviewing jonhilt/focus#691: opened a demo ship, counting new lines per goal.' },
    ],
  };

  const g2 = {
    id: 'g-phone', projectId: 'p-focus', lead: 'Lt. Adeyemi', status: 'working',
    title: 'Flagged turns reach the user\'s phone within a minute',
    done: 'A turn the chief of staff flags arrives on the phone within 60 seconds, with a reply that goes straight back to the lead.',
    seenAt: ago(300),
    prs: [
      { repo: 'jonhilt/focus', number: 676, title: 'Bot hook for flagged turns', state: 'merged' },
      { repo: 'jonhilt/focus', number: 692, title: 'Reply from the phone to the lead', state: 'open' },
    ],
    decisions: [{ q: 'Which channel?', chosen: 'Telegram first' }],
    needs: [],
    entries: [
      { kind: 'you', at: ago(9 * 60), text: 'When the CoS flags something I want it on my phone, fast. Telegram is fine.' },
      { kind: 'decided', at: ago(9 * 60), question: 'Which channel?', chosen: 'Telegram first' },
      { kind: 'lead', at: ago(8 * 60), text: "The bot hook already sees every verdict, so a flagged turn can go out the moment it's judged. I've opened #676 to send it, with the goal's title and the lead's first paragraph." },
      { kind: 'cos', at: ago(8 * 60 - 1), route: 1, why: 'In the agreed direction.', says: "Flagged turns will go to Telegram as they're judged (#676). Nothing for you." },
      { kind: 'merged', at: ago(6 * 60), repo: 'jonhilt/focus', number: 676 },
      { kind: 'ops', at: ago(6 * 60), from: 'Ops', text: 'Slice 1 has landed: jonhilt/focus#676 merged.' },
      { kind: 'lead', at: ago(130), text: "Flagged turns now reach the phone: I measured 8 to 22 seconds from the verdict across 12 test turns.\n\nNext is the other half, **replies from the phone** going straight back to the lead. I'm on it in #692." },
      { kind: 'cos', at: ago(129), route: 1, why: 'Progress in the agreed direction, with the measurement done looks like asks for.' , says: 'Flagged turns reach your phone in 8 to 22 seconds, inside the minute. Adeyemi is on replies from the phone next (#692).' },
      { kind: 'ops', at: ago(30), from: 'Scheduler', text: 'Check the phone round-trip with a real flagged turn (as asked, every afternoon).' },
    ],
  };

  const g3 = {
    id: 'g-boot', projectId: 'p-focus', lead: 'Lt. Okafor', status: 'done',
    title: 'Demo ship boots in under 5 seconds',
    done: 'pnpm run demo:start prints its URL within 5 s on a warm checkout.',
    seenAt: ago(40),
    prs: [{ repo: 'jonhilt/focus', number: 670, title: 'Lazy-load the holodeck models', state: 'merged' }],
    decisions: [],
    needs: [{ id: 'n3', kind: 'close', what: 'Lt. Okafor thinks the goal is done', context: 'Demo boots in 3.8 s warm (median of 10), 11.2 s cold. Done looks like is met.', options: ['Close the goal', 'Carry on'] }],
    entries: [
      { kind: 'lead', at: ago(4 * 60), text: "The demo was spending 9 s loading holodeck models nobody looks at during boot. #670 loads them when a room is first entered.\n\nWarm boot is **3.8 s** (median of 10), cold 11.2 s." },
      { kind: 'cos', at: ago(4 * 60 - 1), route: 1, why: 'Progress with a measurement.', says: "Okafor found 9 s of boot spent on holodeck models; #670 loads them later. Warm boot is now 3.8 s." },
      { kind: 'merged', at: ago(3 * 60), repo: 'jonhilt/focus', number: 670 },
      { kind: 'lead', at: ago(50), text: 'Done looks like is met: 3.8 s warm. I\'ve proposed closing the goal.' },
      { kind: 'cos', at: ago(49), route: 2, why: 'A proposal to close the goal: the user\'s to accept.' , says: 'Okafor says the demo boots in 3.8 s warm, under the 5 s asked for, and proposes closing the goal.' },
    ],
  };

  const g4 = {
    id: 'g-ledger', projectId: 'p-focus', lead: 'Lt. Haddad', status: 'error',
    title: 'The ledger survives a crash mid-write',
    done: 'Killing Focus during a ledger write never leaves a line half-written.',
    seenAt: undefined,
    prs: [],
    decisions: [],
    needs: [{ id: 'n4', kind: 'turn', what: 'Stopped on an error: a test needs a real fsync and the sandbox refuses it', context: 'The crash test kills the process mid-write and checks the file. In the sandbox `fsync` returns EPERM, so the test can\'t prove anything there. I can run it outside the sandbox if you allow it, or mock the write and prove less.', options: ['Allow running it outside the sandbox', 'Mock the write'] }],
    entries: [
      { kind: 'you', at: ago(70), text: 'Make the ledger crash-safe. Prove it with a test that actually kills the process.' },
      { kind: 'lead', at: ago(20), text: 'I\'ve written the crash test, but the sandbox refuses `fsync`, so it can\'t prove anything here. I\'ve stopped to ask how you want it run.' },
      { kind: 'cos', at: ago(19), route: 3, why: 'The lead is stopped and can do nothing until the user answers.' , says: 'Haddad is stuck: the crash test needs a real fsync and the sandbox refuses it. Run it outside the sandbox, or mock the write and prove less?' },
    ],
  };

  const g5 = {
    id: 'g-stock', projectId: 'p-socks', lead: 'Lt. Lindqvist', status: 'working',
    title: 'Show how many of each sock are left on the product page',
    done: 'The product page shows "Only 3 left" under 5, and "In stock" above.',
    seenAt: ago(200),
    prs: [{ repo: 'demo/webshop-api', number: 7, title: 'Stock count on the product API', state: 'merged' }, { repo: 'demo/webshop-web', number: 12, title: 'Low-stock line on the product page', state: 'open' }],
    decisions: [],
    needs: [],
    entries: [
      { kind: 'you', at: ago(5 * 60), text: 'Show stock on the product page. Only say the number when it\'s low.' },
      { kind: 'lead', at: ago(4 * 60), text: 'The API had no stock field; #7 adds it. Next the page.' },
      { kind: 'cos', at: ago(4 * 60 - 1), route: 1, why: 'Progress.', says: "Stock count added to the product API (#7). The page is next." },
      { kind: 'merged', at: ago(3 * 60), repo: 'demo/webshop-api', number: 7 },
      { kind: 'lead', at: ago(25), text: 'The product page says **Only 3 left** under 5 and **In stock** above, in #12. Screenshot on the screen.' },
      { kind: 'cos', at: ago(24), route: 1, why: 'Progress, QA to come.', says: "The product page shows \"Only 3 left\" under 5 and \"In stock\" above (#12). QA has it." },
      { kind: 'ops', at: ago(10), from: 'QA officer Lt. Nakamura', text: 'QA is reviewing demo/webshop-web#12.' },
    ],
  };

  const g6 = {
    id: 'g-save', projectId: 'p-socks', lead: 'Lt. Petrakis', status: 'done',
    title: 'Shoppers can save items for later and find them again on their next visit',
    done: 'A saved item is still there after signing out and back in.',
    seenAt: ago(500),
    prs: [{ repo: 'demo/webshop-api', number: 5, title: 'Saved items', state: 'open' }],
    decisions: [],
    needs: [{ id: 'n6', kind: 'pr', what: 'demo/webshop-api#5 is ready to merge', context: 'QA passed it: saved items survive sign-out, 14 tests added.', options: ['Merge', 'Hold'] }],
    entries: [
      { kind: 'you', at: ago(26 * 60), text: 'Save for later. Keep it simple.' },
      { kind: 'lead', at: ago(20 * 60), text: 'Saved items are kept per shopper in #5, and the page lists them under the basket.' },
      { kind: 'cos', at: ago(20 * 60 - 1), route: 1, why: 'Progress.', says: "Saved items are kept per shopper (#5) and listed under the basket. QA next." },
      { kind: 'ops', at: ago(10 * 60), from: 'QA officer Lt. Nakamura', text: 'QA passed demo/webshop-api#5: saved items survive sign-out, 14 tests added.' },
      { kind: 'cos', at: ago(10 * 60 - 1), route: 2, why: 'Ready to merge, in the ask lane.' , says: 'Saved items (#5) passed QA and wait on your merge.' },
    ],
  };

  const loose = [
    { projectId: 'p-socks', what: 'Resolve conflicts with its base branch', who: 'demo/webshop-api#5' },
    { projectId: 'p-focus', what: 'Dependabot: bump vite to 8.1', who: 'jonhilt/focus#693' },
  ];

  window.LAB_FIXTURE = { now, HOUR, projects, goals: [g1, g2, g3, g4, g5, g6], loose };
})();
