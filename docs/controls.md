# Controls

| Key | Action |
| --- | --- |
| <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / mouse | walk / look |
| <kbd>Shift</kbd> | run |
| <kbd>E</kbd> or click | use whatever is under the crosshair (agent, station, board, PADD rack, Ops station, console) |
| <kbd>E</kbd> on one of your chairs | sit down: the captain's chair on the bridge, your desk in the ready room, the head of the observation lounge's table ([your chairs](#your-chairs)) |
| <kbd>C</kbd> | [Comms](comms.md): who's waiting on you across the ship, every goal under way, and each project's goals |
| <kbd>I</kbd> | [Personal log](personal-log.md): jot an idea down to come back to, wherever you are |
| <kbd>T</kbd> | teleport to any holodeck, straight to an agent's station, or into [one of your chairs](#your-chairs) |
| <kbd>M</kbd> | ready room |
| <kbd>N</kbd> | new issue for the holodeck you're in |
| <kbd>L</kbd> | the goals of the holodeck you're in: talk to their leads, or start another (anywhere else, Comms) |
| <kbd>H</kbd> | recording: hide the HUD and every toast but errors, so a video shows only the office; <kbd>H</kbd> again brings them back (`?record=1` starts hidden) |
| In a demo office: <kbd>-</kbd> / <kbd>=</kbd> | slow the pretend agents down or speed them up ([demo pace](configuration.md#demo-pace)) |
| <kbd>B</kbd> | [night](night.md): dim the ship's lights, or bring them up, until the clock next changes over |
| <kbd>1</kbd> | talk to [Number One](../plugins/number-one/README.md), with the `number-one` plugin on |
| <kbd>J</kbd> | [the captain's log](../plugins/captains-log/README.md): what happened across the ship on one timeline, and while you were away, with the `captains-log` plugin on |
| <kbd>Alt</kbd>+<kbd>1</kbd>… | pick a view from a panel's sidebar by its number (an agent's browser, goal, tasks or crew; the ready room's sections) |
| <kbd>Esc</kbd> | pause / close a panel |
| In [stellar cartography](stellar-cartography.md): <kbd>F</kbd> | take flight (<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> where you look, <kbd>Space</kbd> / <kbd>Shift</kbd> up and down), and <kbd>F</kbd> again to land |

## Your chairs

Three chairs aboard are the captain's: the captain's chair on the bridge, the one at your desk in the ready room, and the one at the head of the observation lounge's table, facing its screen. Press <kbd>E</kbd> on one to sit down. Sat there, <kbd>E</kbd> opens what the room puts to hand, unless the crosshair is on something else to use (the ready room's console, say):

- **Bridge**: [Comms](comms.md): the inbox of what needs you.
- **Ready room**: the ready room console.
- **Observation lounge**: your [personal log](personal-log.md), the ideas you've jotted down to talk through.

Or beam straight into one: the teleport panel (<kbd>T</kbd>) lists them under **Your chairs**.

Look round freely; any movement key (or <kbd>Space</kbd>) stands you up where you were before you sat (beamed into a chair, at the spot you'd have beamed into its room). Teleporting gets you up too. Which chair does what is `CHAIR_USE` in `client/src/world/chairs.ts`; the chairs are `chair` markers on the command deck (`blender/command_deck.py`).

