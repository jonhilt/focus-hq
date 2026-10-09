# Number One

Number One, the ship's first officer, is there to just talk: ask how something works in any project, what's going on aboard, or think an idea through, without it turning into an issue. There's one for the whole ship, sitting across the captain's desk in the ready room: press <kbd>E</kbd> on them, or <kbd>1</kbd> anywhere aboard. Their bubble shows what they're reading while they think, and 🖖 *Your turn* once they've answered.

- **The ship's state**: their `ship_status` tool sums up the board per project: agents and what they're on (with their worktree paths), open PRs with QA's verdict and checks, and what needs you (raised hands, conflicts, stuck PRs, PRs ready to merge, drafts at the stand).
- **Any project's code**: `open_project` checks a project's repos out at their default branch into `~/.focus/planning/<project>/` (the same folders the stand uses) the first time they need it, so opening a chat checks nothing out. If the fetch fails, they tell you which project and carry on.
- **Agents' worktrees**: readable, to answer "what has Lt. X done so far?", never to explain how the code works.
- **Read-only**: Read, Glob, Grep, web search and fetch, and those two tools. They never file, push, edit, start agents, draft issues or talk to the lead. When a chat turns into work, the reply carries a suggestion (`suggest: { projectId, idea }`) for you to send to the stand or start as a goal.

- **From chat to work**: under a reply that suggests some, **Draft at Ops** has the project's officer write it up at its Ops station (asking first if a draft is already waiting there), and **To a goal** starts it as a new goal (or hands it to one under way, picked beside the button), with the idea as your words to its lead.

The chat runs one turn at a time. It's saved in `~/.focus/state.json` with Number One's session, which every message resumes, so it survives a restart. **New conversation** clears the log and starts a fresh session.

## Voice mode

Switch **Voice** on above the message box to talk with Number One instead of reading. It's off by default, and each browser remembers the setting.

- **Number One speaks.** Each new reply is read aloud as a sentence or two without file paths or code (they write it in the same turn as the reply). The full text still goes in the log, straight away. Anything already in the log when you open the panel isn't spoken.
- **Their voice.** [Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) (82M, through `kokoro-js`) runs in the office's server on this machine. The model (about 90 MB) downloads into `~/.focus/models/kokoro` the first time voice mode is switched on, or from **Settings → Voice input → Crew voices**. Until it's ready, or if it fails to load, the browser's built-in voice stands in.
- **You answer by talking.** Press **Mic** (or <kbd>Ctrl</kbd>+<kbd>M</kbd> in the message box) and talk, then press again, or hold it and let go. Your message is sent as soon as whisper.cpp has transcribed it (see [Voice input](voice-input.md)). Starting to record stops Number One speaking and drops their queued lines. If nothing was heard, nothing is sent. You can still type and press **Send**.
- **Keep the mic open** opens the microphone once for the whole session rather than for each answer. Use it with speakers, where opening the mic each time makes the audio glitch. Leave it off with Bluetooth earphones, which drop to call quality while the mic is open. Turning voice mode off or closing the panel lets go of the mic.
