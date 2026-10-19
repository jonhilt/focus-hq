# Astrometrics

A plugin (`FOCUS_PLUGINS=astrometrics`, [plugins](../../docs/plugins.md)), switched on per project: **State machines** in a project's settings (the manager's **Projects** tab).

The office's work runs as state machines, each journaled ([agents](../../docs/agents.md), [goals](../../docs/goals.md), [QA](../../docs/qa.md)): a crew member's run, what follows a turn, a goal's slices, QA's review of a pull request. This plugin draws them where you can see them, live: a screen in the holodeck of each project it's on for, left of the entrance as you come in, over the pull request rack (opposite stellar cartography's chart).

- **What's drawn** is each machine from its code: the office lends it as data (`host.machines()`, `server/agents/machines.ts`), its states nested as they are and its transitions with their events and named guards, so the drawing is never out of date with the machine. An arrow carries every event that takes it; the transitions taken from any state leave from a box of their own, *any state*.
- **Laid out** once as the office starts, with ELK's layered layout (`layout.ts`, elkjs), left to right, compound states as boxes round their children. A machine's layout is the same for every run of it.
- **Live**: the states the project's runs are in now are lit, each saying who's there (a crew member, a goal, a pull request), and the compound states round them outlined (`draw.ts`). As a journal steps, the office tells the plugin (`machineStepped`) and it reads where every run is again, a moment later, so a turn's end that steps several journals at once draws once.
- **Toggling**: the screen shows one machine at a time. <kbd>E</kbd> on it opens them up close, a tab for each machine (with how many of the project's runs are in it), the one picked drawn large, and a list of where each run is. The screen follows the tab you pick.

The machines are the office's, not the plugin's: switched off, nothing changes how the office runs, only what you see of it.
