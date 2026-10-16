# Night

From 8pm to 7am by your own clock the ship goes dark: its lights dim and turn blue, and so do the ceilings, light panels and the holodecks' skies, ground and sea. Screens, LCARS, consoles and the holodeck grid keep glowing, so the work stands out. It fades over a couple of seconds as it changes over.

<kbd>B</kbd> says otherwise: lights up on a late night, or dark on an afternoon. It holds until the clock next changes over (7am or 8pm), then the clock's back in charge. The browser remembers it across reloads.

`?night=1` or `?night=0` holds it one way, for screenshots and recordings (<kbd>B</kbd> still works).

## How it works

`client/src/world/night.ts` decides (`clockNight`, `nightWanted`, `toggle`, `fade`, tested in `night.test.ts`) and keeps a list of colours to dim: `dimsAtNight(color)` registers one, from its daytime value. The scene's lights register in `main.ts` and dim further (`NIGHT_LIGHT`) than unlit surfaces (`NIGHT`), since by day the lights add up to more than a toon surface can show. What's drawn unlit and stands for something lit registers itself: the decks' `unlit` surfaces (`deck.ts`), and a landscape's sky and `Kit.basic` materials (`scenery.ts`), apart from additive glows. Anything not registered (screens, signs, glows) stays as bright as by day.
