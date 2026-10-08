# Your API key when your plan runs out

Agents run on your Claude login. With `FOCUS_USE_API_KEY=fallback` and `ANTHROPIC_API_KEY` set, they carry on with the API key while your plan's usage limit is reached, and go back to your plan when it resets. The key is used through the Agent SDK, so Claude credits that apply to the Agent SDK with an API key cover it.

```sh
FOCUS_USE_API_KEY=fallback ANTHROPIC_API_KEY=sk-ant-… FOCUS_API_BUDGET=20 npm start
```

(`FOCUS_USE_API_KEY=1` runs every agent on the key all the time, and leaving it unset keeps them on your login, waiting for the limit to reset.)

## What happens when the limit is reached

Claude Code says so in the session's stream (a rejected `rate_limit_event`, with when the limit resets; when extra usage carries on past the limit, nothing changes). From then until the reset:

- **New sessions start on the key**: new hires, QA reviews, leads, and the crew (the officer at the New issue stand, Number One, the chief engineer). A 🔑 toast says so, and the agent's terminal says it's on the key.
- **An agent the limit stopped mid-turn** picks their conversation back up on the key straight away, told to carry on where they left off. Claude Code keeps conversations on this machine, so the new sign-in finds it.
- **Unless that would cost more than $1.** A new sign-in has nothing in the prompt cache, so Claude re-reads the whole conversation at full price before doing anything else: a lead 400k tokens into a goal costs about $2 on Opus just to start again. Such an agent is held ⏸ until the limit resets, then carries on by themselves.

Cloud agents keep to your plan (their sessions run in the cloud, on your login there).

## Asking first

While the office is on the key, a message that would pick a held or finished agent's long conversation back up asks you first, with what the re-read costs: **Carry on now** (on the key), or **Wait till** the reset (the message waits with them, and they read it then). That goes for messages from their panel, the comms panel, the tricorder, handing an idea to a goal, and picking an option of a lead's question. News from anyone else aboard (QA's verdict on a lead's PR, say) waits for the reset without asking.

Stopping a held agent keeps them from carrying on at the reset; a message picks them back up.

## The budget

`FOCUS_API_BUDGET` (default `$20`) is the most the key spends each time your plan's limit is reached. The office adds up each request's tokens at API prices as sessions on the key run (the crew's sessions aren't counted). Once it's spent, new sessions start on your plan again and wait for the limit, and agents the limit stops are held. The count starts again at the next limit; it's kept in memory, so a restart starts it afresh too.

## In the code

The decisions are pure, in `server/agents/apiKey.ts` (which sign-in, what a re-read costs, ask, hold or go), with `keyFallback` holding where the office stands. `claudeRunner.ts` signs each session in (`agentEnv`), spots the limit and counts what the key spends; `manager/planLimit.ts` carries agents on or holds them, and `manager/comms.ts` asks before a costly message. The client asks with `messageAgent` in `client/src/ui/resume.ts`.
