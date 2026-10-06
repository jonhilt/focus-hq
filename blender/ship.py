"""Builds every deck and exports each as a GLB the browser loads (npm run ship, through scripts/ship.ts).

Blender -b --factory-startup --python blender/ship.py -- <glb dir> [<blend dir>]

With a blend dir, each deck is saved as a .blend there too, to open and look round in Blender. Change a deck here,
not in the .blend: the script is the source.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import command_deck  # noqa: E402
import kit  # noqa: E402

DECKS = {'command-deck': command_deck.build}


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not args:
        sys.exit('usage: blender -b --python blender/ship.py -- <glb dir> [<blend dir>]')
    glb_dir, blend_dir = args[0], (args[1] if len(args) > 1 else None)
    for name, build in DECKS.items():
        kit.begin(name)
        build()
        glb = os.path.join(glb_dir, f'{name}.glb')
        kit.export(glb, blend_dir and os.path.join(blend_dir, f'{name}.blend'))
        print(f'deck {name}: {glb} ({os.path.getsize(glb) // 1024} KB)')


main()
