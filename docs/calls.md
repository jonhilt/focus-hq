# Calls to Number One

Press **📞 Call** in Number One's panel (<kbd>1</kbd>) and talk to the ship hands-free: no push-to-talk, no reading. So far a call can do two things:

- **How things stand.** "What's the crew doing?", "How's the Sock Shop?" The goals under way and who's on them, who's at work on issues, what's waiting on you (the same rule as [Comms](comms.md)), and the next queued goal. It's read straight off the board, so it's exact.
- **Start the next queued goal.** "Start the next queued goal." The ship asks first, naming the goal, the project and the station: *Start "Sock of the month subscription" in Sock Shop, at station 4?* Only a clear yes ("yes", "go ahead", "make it so") starts it. Anything else, or no answer within a minute, leaves it queued. When every station has a goal, or nothing's queued, the ship says so and asks nothing.

![A call waiting for the captain's yes: the strip says what it's waiting for, over the call's captions](call.jpg)

While the call's on, the strip at the top of the panel says what the ship is doing (listening, working it out, waiting for your yes, starting it), what's waiting for your yes, and the captions: what you said, what the ship said, and, muted, what the office told it to say. The call carries on with the panel closed, so you can walk round the ship. **Hang up** ends it from any screen. A new call hangs up the one before: there's one at a time.

## How it works

It's the stack Alex Hillman's JFDI voice mode ended up with: a realtime voice model for the conversation, a fast "System One" model for quick decisions, and a state machine that keeps each task on rails.

- **[gpt-live-1](https://developers.openai.com/api/docs/models/gpt-live-1)** (OpenAI) holds the conversation: it listens and speaks at once, and decides when to hand the captain's words over to its backend. The office is that backend (*client delegation*). Your browser carries the audio straight to OpenAI over WebRTC. The office creates the session with the browser's offer, and lets the browser's own events channel do nothing but hang up. It then attaches a sideband of its own to the session, which hears the transcript and each hand-over, and sends back what the ship should say.
- **[Jev](https://docs.typesafe.ai/api)** (TypeSafe) decides what the captain asked for. Given the call so far and what they just said, it answers typed questions in one pass, each with a calibrated probability: which action (status, start the next goal, or something else), which project, and, when a start is waiting, whether that was a clear yes. A pick under 0.6 confidence counts as unclear. A yes counts at 0.9 or more, judged on the captain's own transcribed words, not on what the voice model made of them.
- **The call's machine** ([XState](https://stately.ai/docs/xstate) v5) is the rails: *listening* → *routing* (Jev) → *confirming* → *acting*, and back to *listening*. A goal starts only from *confirming*, only the one it asked about, and only when routing found a clear yes. The office checks again, as it starts it, that the goal is still in line and a station is still free. A hand-over that comes in while the machine is busy is routed once it's free.

Each call costs gpt-live-1's $0.05 a minute, plus Jev's fraction of a cent per hand-over. What you say goes to OpenAI and TypeSafe.

## Setting it up

Set both keys where the office starts, then restart it:

```sh
OPENAI_API_KEY=sk-… TYPESAFE_API_KEY=… pnpm start
```

Until both are there, the Call button is greyed out, and its tooltip says which is missing. The browser asks for the microphone the first time you call. On the [Tricorder](tricorder.md), over Tailscale's HTTPS, the same works from your phone once it has a Call button of its own.

`FOCUS_LIVE_VOICE` picks gpt-live-1's voice (`cedar` by default; it has 22, among them `marin`, `sage` and `verse`). `FOCUS_LIVE_MODEL`, `FOCUS_LIVE_URL`, `FOCUS_JEV_MODEL` (`jev-latest`) and `FOCUS_JEV_URL` point somewhere else.

In demo mode a call needs no keys and has no audio: the captain's side is scripted ("What's the crew doing?", "Start the next queued goal.", "Make it so."), Jev's answers come from keywords, and the machine runs for real against the demo office.

## In the code

`server/call/`: `live.ts` (the session and its sideband, and the voice model's instructions), `jev.ts` (Jev's API), `route.ts` (the questions Jev is asked and what its answers mean, pure), `status.ts` (the spoken status, pure), `machine.ts` (the rails), `calls.ts` (a call: the session's events into the machine, its replies back out), `demo.ts`. In the browser, `client/src/ui/call.ts`.
