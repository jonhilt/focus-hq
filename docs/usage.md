# Your plan's usage

Main engineering shows how much of your Claude plan the office has used, and what each agent signs in with.

- **The engineering panel** (<kbd>E</kbd> on the chief engineer's station) opens with **Plan usage**. There's a bar per limit of your plan: the five-hour **session**, the **week** across all models, and any model's own weekly limit. Each bar shows how much is used and when it resets. A bar turns gold from 75% and red from 90%. **Extra usage** shows too, while it's switched on. Under the bars is how the office signs in (your plan, your API key, or your plan with the key behind it and what the key has spent), then everyone aboard with what they sign in with (*plan*, *🔑 key* or *☁ cloud*) and what their session has used at API prices. On your plan that use isn't billed.
- **Show on the MSD** puts the same bars on the master systems display, beside the ship. They stay up and keep current until something else goes up there.
- **An agent's panel** says what their session signs in with: *your plan*, or *🔑 API key* while [your API key stands in](api-key.md).

## Where the numbers come from

Every 3 minutes the office starts a Claude Code session that's sent no prompt, and asks it for the structured data behind `/usage`. The session spends nothing and leaves no transcript. It takes about two seconds, and signs in the same way the agents do. A reading that fails keeps the last one, and the panel says why. With `FOCUS_USE_API_KEY=1` there's no plan to read, so the panel only shows how the office signs in.

The Agent SDK marks this call experimental (`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`), so a Claude Code update may change or remove it. If it does, the readout says it couldn't read your plan, and nothing else in the office depends on it. Limits Claude Code reports only under unannounced codenames are left out.

The demo office makes its numbers up: a session that fills as the hours go by, and a week a quarter gone.

## In the code

`server/usage.ts` reads the plan (`readPlanUsage`) and turns Claude Code's answer into a `PlanUsage` (`planUsage`, pure). `UsageWatch` keeps the latest reading with how the office signs in (`keyFallback`), and sends `{ type: 'usage' }` whenever either changes. The words and colours on the panel and the MSD come from `shared/usage.ts`. An agent's sign-in (`agent.onKey`) is set as each session starts, through the runner's `signIn` hook.
