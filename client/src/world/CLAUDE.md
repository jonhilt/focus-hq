# 3D gotchas

- Never put faces from different meshes in the same plane: keep them at least 0.002 apart (`pnpm run zfight` finds them).
- A shader that writes display colours must convert back to linear and end in `#include <colorspace_fragment>`, or it looks too bright through a doorway.
- Build holodeck landscapes only with the `Kit` from `scenery.ts` (its materials carry the stencil mask), and keep them out of the hall's footprint (`Kit.clear`).
- Only the region the camera is in is drawn (`regions.ts`): add anything new to its region's group, or it won't show.
- The decks come from `blender/*.py` (`pnpm run ship`): change the script, never the `.blend`.
