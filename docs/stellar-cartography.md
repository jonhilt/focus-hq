# Stellar cartography

Every goal on the ship, as a star in a sphere you walk out into, like the Enterprise-D's stellar cartography.

## Getting there

It has a turbolift stop of its own: <kbd>E</kbd> on any turbolift's panel and pick **Stellar Cartography**, or teleport there (<kbd>T</kbd>). You step out into a short vestibule, and through its doorway onto a gantry that runs out over the void to a round platform in the middle of the sphere, with the cartography console at its far edge.

## What it shows

Every goal on the ship the captain can see, closed and under way, is a star on a spiral arm round you (`goalStars` and `spiral` in `client/src/world/galaxy.ts`): the newest dead ahead, over the console, and older ones further round and further out, back to the oldest at the arm's outer end. Each star is in its project's colour, a little bigger the more slices its goal took; a goal under way is brighter and pulses. A faint line runs through them in time order. The arm sits a little below eye height and tilts up ahead of you and down behind, so it sweeps round just over the railing, and the stars that come round behind pass under the gantry rather than across it. Hidden projects' goals aren't there.

Aim at a star to read its goal: its title, project, how many slices and when it ran. <kbd>E</kbd> opens its [star chart](goals.md), live for a goal under way, or as it closed. Stars can be read and used from across the sphere.

## Flying

<kbd>F</kbd> (or <kbd>E</kbd> on the console) takes flight: fly the way you look with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, rise with <kbd>Space</kbd> and sink with <kbd>Shift</kbd>, through anything, anywhere inside the sphere short of its skin (`Player.flight`). <kbd>F</kbd> again beams you back to the platform, and teleporting or riding the turbolift puts you back on your feet too.

## How it's built

The room is a deck of its own, built in Blender (`blender/cartography_deck.py`): the sphere's skin (dark, facing in), the vestibule with the turbolift, the gantry, the platform and its console, with a collar round the vestibule where it comes through the skin. It stands beyond main engineering (`CARTOGRAPHY_DECK` in `layout.ts`) and is a region of its own (`regions.ts`), drawn only while you're in it. The browser draws what's in the sphere (`client/src/world/cartography.ts`): a sky of distant stars and a grid on the inside of the skin, the arm and a star for each goal, laid out again whenever the goals change (checked once a second).
