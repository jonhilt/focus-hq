# The chief engineer's retro

At the engineering station (on the command deck), <kbd>E</kbd> opens Lt. Brennan's panel: the [ledger](ledger.md)'s report card, and **Start a retro**, which looks back over the last 14 days (or however many you choose, up to 60).

The retro doesn't read transcripts. Each agent session is digested into the ledger as it ends, with its frictions picked out and quoted (see [Session digests](ledger.md#session-digests)), so a retro reads those:

1. **Code groups the frictions** (`frictionGroups` in `shared/ledger.ts`): by kind and signature, counting each session once, leaving out any group you've already decided on. A group that came up in **three or more sessions** is a pattern worth an issue; one seen in two goes under **To watch**. With nothing at three, the retro says so and stops there: no model is asked.
2. **The engineer drafts issues.** The office writes the groups (with their quoted moments), the ledger's report card and your earlier decisions, and the closed goals into `~/.focus/retros/<time>/`. The engineer, a read-only Claude Code session like [Number One](number-one.md), reads only that folder and drafts an issue for each group worth fixing (or one for a few that are plainly the same trouble), in the form of #159: what keeps happening and what it costs, **What to build** (the cheapest fix that would do: a check the office runs before a rule in a prompt) and **Done when**, with its kind of fix and the number to watch. It may leave out a group whose moments aren't the office's doing. Code checks each draft rests on real groups, one draft per group, and adds the **Evidence** section itself from the quoted moments (`parseDrafts` in `server/agents/retro.ts`), so what's cited is what was found.
3. **You decide.** Each draft shows on the panel with the issue as it would be filed. **Accept and file** files it in the repository picked beside it (the last one you picked is remembered); **Reject** doesn't. Either way the decision goes in the ledger (`retro-decision`) with the frictions' signatures, so later retros leave them be, and the report card can tell whether an accepted fix stopped them recurring (see [Did the retro's fixes work?](ledger.md#did-the-retros-fixes-work)).

The engineer changes nothing and files nothing itself. The latest retro is kept in `state.json` (one under way when Focus stops ends as interrupted), and each one's folder keeps its evidence and `retro.json`.

## Older sessions

Sessions from before digests began can be digested from the same panel: it counts the agents' transcripts on this machine that have no digest yet and offers **Digest them** (see [the ledger](ledger.md#session-digests)). A session still in the office isn't counted (it's digested as it ends), nor is a transcript a backfill found nothing in.
