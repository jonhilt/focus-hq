# Number One

A plugin (`FOCUS_PLUGINS=number-one`, [plugins](../../docs/plugins.md)) that needs no other: Cmdr. Adair, the ship's first officer, in the ready room. Number One is there to just talk: ask how something works in any project, what's going on aboard, or think an idea through, without it turning into an issue. There's one for the whole ship, sitting across the captain's desk in the ready room: press <kbd>E</kbd> on them, or <kbd>1</kbd> anywhere aboard. Their bubble shows what they're reading while they think, and 🖖 *Your turn* once they've answered.

- **The ship's state**: their `ship_status` tool (the office's own: `host.shipStatus`) sums up the board per project: agents and what they're on (with their worktree paths), open PRs with QA's verdict and checks, and what needs you (raised hands, conflicts, stuck PRs, PRs ready to merge, drafts at the stand).
- **Any project's code**: `open_project` checks a project's repos out at their default branch into `~/.focus/planning/<project>/` (the same folders the stand uses) the first time they need it, so opening a chat checks nothing out. If the fetch fails, they tell you which project and carry on.
- **Agents' worktrees**: readable, to answer "what has Lt. X done so far?", never to explain how the code works.
- **Read-only**: Read, Glob, Grep, web search and fetch, and those two tools. They never file, push, edit, start agents, draft issues or talk to the lead. When a chat turns into work, the reply carries a suggestion (`suggest: { projectId, idea }`) for you to send to the stand or start as a goal.

- **Your personal log**: each message Number One hears comes with what's open in your [personal log](../../docs/personal-log.md) (the newest 15), so they can bring an idea back up when it bears on what you're talking about. Ask them to remember, note or log something and they jot it down there for you (`log` in their reply), *via Cmdr. Adair*; the reply says what they jotted down.
- **From chat to work**: under a reply that suggests some, **Draft at Ops** has the project's officer write it up at its Ops station (asking first if a draft is already waiting there), and **To a goal** starts it as a new goal (or hands it to one under way, picked beside the button), with the idea as your words to its lead.

The chat runs one turn at a time. It's saved in the plugin's slot of `~/.focus/state.json` (`plugins.number-one`, from the first message) with Number One's session, which every message resumes, so it survives a restart (a turn under way when Focus stops ends as interrupted as the plugin starts again). What they're reading while they think isn't saved, nor is the call: they go to every browser beside the chat. **New conversation** clears the log and starts a fresh session. A chat saved before Number One was a plugin moves into the slot as the office starts, if anything was said in it (`server/plugins/migrate.ts`).

When a reply lands, or Number One loses the thread, while their panel isn't open, a toast says so, with **Read it** to open the chat.

## Calls

**📞 Call** at the top of the panel talks to Number One hands-free, through OpenAI's realtime voice model: ask how things stand, have them start the next queued goal, or talk a goal or a project through and turn it into a new goal or a word for its lead; anything that does something waits for your spoken yes. See [Calls to Number One](calls.md).

## Voice mode

Switch **Voice** on above the message box to talk with Number One instead of reading. It's off by default, and each browser remembers the setting.

- **Number One speaks.** Each new reply is read aloud as a sentence or two without file paths or code (they write it in the same turn as the reply). The full text still goes in the log, straight away. Anything already in the log when you open the panel isn't spoken.
- **Their voice.** Number One brings their own (`NUMBER_ONE_VOICE`: Kokoro's `bm_george`, at a pitch of their own), which the office's voice kit speaks in. [Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) (82M) runs on this machine, in a process of its own that the office starts and stops. On Apple Silicon with [uv](https://docs.astral.sh/uv/) installed (`brew install uv`) it runs on the GPU, through [mlx-audio](https://github.com/Blaizzy/mlx-audio) in Python (`server/speechMlx.py`), where agents and test runs keeping the CPU busy don't slow it: a line in a quarter to one second with the CPU saturated, against several seconds on the CPU. uv installs its pinned packages once, and its model (about 350 MB) downloads into `~/.focus/models/kokoro-mlx`. Each voice says a line nobody hears as it loads, so the first you hear is quick. Anywhere else, or if it can't load there, it runs on the CPU through `kokoro-js` (`server/speechWorker.ts`; the order is `speechHelpers` in `server/speechHelpers.ts`, and `FOCUS_KOKORO_GPU=0` keeps it on the CPU): onnxruntime aborts a process that exits normally on macOS, so the office ends Kokoro's process with SIGKILL as it closes and never loads onnxruntime itself; that model (about 90 MB) downloads into `~/.focus/models/kokoro`. Either way it downloads the first time voice mode is switched on, or from **Settings → Voice input → Crew voices**, which says whether it's running on the Apple GPU or the CPU. Once downloaded, it loads as the office starts. Lines wait for it while it loads; only if it fails does the browser's built-in voice stand in, the best one the system has (`client/src/ui/crewVoice.ts`).
- **You answer by talking.** Press **Mic** (or <kbd>Ctrl</kbd>+<kbd>M</kbd> in the message box) and talk, then press again, or hold it and let go. Your message is sent as soon as whisper.cpp has transcribed it (see [Voice input](../../docs/voice-input.md)). Starting to record stops Number One speaking and drops their queued lines. If nothing was heard, nothing is sent. You can still type and press **Send**.
- **Keep the mic open** opens the microphone once for the whole session rather than for each answer. Use it with speakers, where opening the mic each time makes the audio glitch. Leave it off with Bluetooth earphones, which drop to call quality while the mic is open. Turning voice mode off or closing the panel lets go of the mic.

## Without it

The ready room keeps the captain's desk, console and mission control, but no one sits across the desk: no visitor's chair, no <kbd>1</kbd> key or legend, no toasts, and no calls. Goals and the Ops station work as before. A chat saved while it was on waits in `state.json`, and the office warns as it starts that it's there.

## Where it lives

- `server.ts`: the plugin: the chat (scripted in the demo) and calls, and its routes under `/api/plugins/number-one` (`POST /say {text}`, `/new`, `/call {sdp}`, `/hang-up {id}`). It reads the ship through `host.shipStatus` and `host.snapshot`, and acts on a call's yes through `host.goals`.
- `chat.ts`: `NumberOne`, a turn at a time in the plugin's state, and the prompts, reply schema and reply (pure).
- `officer.ts`, `demo.ts`: the live Number One (in the session with the run of the ship the office lends its crew, `host.shipSession`: read-only, with the ship tools as `mcp__number-one__…`) and the demo's scripted one.
- `call/`: calls ([Calls to Number One](calls.md)).
- `shared.ts`: who Number One is (`numberOne()`, from `fixedCrew`, and their voice), the chat and call types, and the plugin's state: the saved `chat`, and beside it, unsaved, `activity` and `call` (`chatNow` puts them together).
- `client.ts`: the browser's part: the <kbd>1</kbd> key and its legend, the toasts and the call's mic (`start`), and the figure (`ship`).
- `figure.ts`, `view.ts`: Number One in the ready room's visitor chair (the deck's `ready-room-guest` seat), with a PADD, and their bubble. `view.ts` also decides what the chat panel and the call strip say (`chatPanel`, `callStrip`, pure).
- `panel.ts`, `callView.ts`, `number-one.css`: the chat panel, with voice mode (the core's `VoiceSession`, `withMic`) and the call strip.
