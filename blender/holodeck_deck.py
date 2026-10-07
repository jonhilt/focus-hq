"""The holodeck deck: a hallway running aft from the turbolift with a holodeck either side every ROW metres, and the
engineering station by the turbolift.

It's built as modules the browser puts together for however many holodecks the ship has (world/holodeckDeck.ts): the
head (the turbolift, engineering, and the way into the hallway), a row (the hallway past a holodeck either side, even
and odd, so the consoles along it alternate) and the tail (the end wall, with a window). Only the architecture is here:
the holodecks' doors (which lock for hidden projects), floors, contents and landscapes are built in code, against
walls of the sizes in client/src/world/layout.ts. Keep to them, and keep everything on a holodeck's side of its walls
within 0.125 of their centre lines, behind the skin its landscape shows through (world/scenery.ts).

The head sits where the old hallway met the concourse, so the holodecks stand where they always have: Blender's +Y,
aft down the hallway, is the browser's -Z.
"""

import math

from mathutils import Matrix

from kit import (DOOR_H, HULL, LCARS, box, collide_object, door, door_frame, facing, marker, material, module, polygon,
                 readout, rounded_rect, sign, toon, turbolift_car, unlit, walls, window)

# client/src/world/layout.ts
WALL_H = 3.2
WALL_T = 0.2
DOOR_W = 2.4
HALL = 2.0
ROW = 12.0
OUTER = HALL + 16.0
#: the head: as wide as the old concourse, and deep enough for engineering beside the way in
HEAD_HALF = 7.0
HEAD = 7.0
LIFT_DOOR = 2.0
#: a bulkhead seen from both sides, about its centre line: a dado with the LCARS stripe along its top, as Builder.wall
#: builds them, never more than 0.125 proud of the line
BULKHEAD = [(-0.125, 0), (-0.125, 0.9), (-0.125, 0.97), (-0.1, 0.97), (-0.1, WALL_H), (0.1, WALL_H), (0.1, 0.97),
            (0.125, 0.97), (0.125, 0.9), (0.125, 0)]
#: a wall seen only from the room, its inner face on the line
LINING = [(-WALL_T, 0), (-WALL_T, WALL_H), (0, WALL_H), (0, 0.97), (0.025, 0.97), (0.025, 0.9), (0.025, 0)]


def bulkhead_materials():
    dado, stripe, bulkhead = toon(HULL['dado']), toon(HULL['stripe']), toon(HULL['bulkhead'])
    return [dado, stripe, stripe, bulkhead, bulkhead, bulkhead, stripe, stripe, dado]


def lining_materials():
    dado, stripe, bulkhead = toon(HULL['dado']), toon(HULL['stripe']), toon(HULL['bulkhead'])
    return [bulkhead, bulkhead, bulkhead, stripe, stripe, dado]


def bulkhead(name, a, b, doors=()):
    """A run of bulkhead along its centre line from a to b, with gaps for `doors` (offset from its middle, width)."""
    return walls(name, [a, b], [(0, offset, width) for offset, width in doors], BULKHEAD, bulkhead_materials(),
                 lintel_from=DOOR_H + 0.1, closed=False)


def rect(x0, y0, x1, y1):
    """A rectangle's corners, counter-clockwise from above."""
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def build():
    head()
    row('row_even', even=True)
    row('row_odd', even=False)
    tail()


def head():
    """
    The top of the hallway: the turbolift in the forward wall, engineering against the starboard one facing its board,
    viewports to port, and the Holodecks sign over the way into the hallway, between two pilasters that hide where its
    walls begin.
    """
    module('head')
    lift = walls('head wall', [(-HEAD_HALF, 0), (-HEAD_HALF, -HEAD), (HEAD_HALF, -HEAD), (HEAD_HALF, 0)],
                 [(1, 0.0, LIFT_DOOR)], LINING, lining_materials(), lintel_from=DOOR_H + 0.1, closed=False)[0]
    door('door turbolift', lift, LIFT_DOOR)
    turbolift_car(lift, 'Deck 4 · Holodecks', wall=WALL_T)
    sign('sign turbolift', 'Turbolift', 1.4, LCARS['gold'], (0, 0.13, 2.82), lift, code='04-01')
    for x, seed in ((-3.6, 44), (3.6, 45)):
        readout(f'head readout {seed}', 1.4, 1.0, seed, (0, 0, 1.4), Matrix.Translation((x, -HEAD, 0)))

    polygon('head floor', rect(-HEAD_HALF, -HEAD, HEAD_HALF, 0), 0, material('#4a3f6e', surface='carpet', outline=False), uv_scale=0.5)
    polygon('head ceiling', rect(-HEAD_HALF, -HEAD, HEAD_HALF, 0), WALL_H, unlit(HULL['ceiling']), down=True)
    for x in (-3.5, 3.5):
        polygon(f'head light {x:.0f}', [(x + px, -HEAD / 2 + py) for px, py in rounded_rect(1.4, 1.4, 0.4)], WALL_H - 0.02,
                unlit('#ffffff'), down=True)

    starboard = Matrix.Translation((HEAD_HALF, -HEAD / 2, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z')
    readout('engineering board', 1.8, 0.8, 43, (0, 0, 1.6), starboard)
    sign('sign engineering', 'Engineering', 2.0, LCARS['gold'], (0, 0.03, 2.62), starboard, code='04-07')
    station = (HEAD_HALF - 1.35, -HEAD / 2)
    marker('engineer', 'seat', (*station, 0), yaw=facing(station, (HEAD_HALF, -HEAD / 2)), crew='engineer')
    for y in (-1.9, -5.1):
        window(f'head window {y:.0f}', 2.0, 1.4, (0, 1.9), Matrix.Translation((-HEAD_HALF, y, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z'))

    # standing out towards the head, so the first holodecks' skins (0.132 aft of the bulkhead's line) cover them
    frame = toon(HULL['frame'])
    for s in (-1, 1):
        collide_object(box(f'hallway pilaster {s}', (0.36, 0.3, WALL_H), frame, (s * HALL, -0.03, 0), round=0.02))
    sign('sign holodecks', 'Holodecks', 3.6, LCARS['periwinkle'], (0, -0.21, 2.4), yaw=math.pi, sub='One per project', code='Deck 4')

    place = (2.4, -1.2)
    marker('place engineering', 'place', (*place, 0), yaw=facing(place, station), label='🔧 Engineering')
    marker('area engineering', 'area', (0, -HEAD / 2, 1), scale=(HEAD_HALF + 0.1, HEAD / 2 + 0.1, 1), label='Engineering')


def row(name, even):
    """
    The hallway past a holodeck either side: their walls and doorways (their doors are the browser's), the bulkhead
    between them and the row before, and LCARS consoles between the doors, on alternate sides of them row by row.
    """
    module(name)
    polygon(f'{name} hallway', rect(-HALL, 0, HALL, ROW), 0, material(HULL['carpet'], surface='carpet', outline=False), uv_scale=0.5)
    # lifted well clear of the carpet: from the far end of a long hallway, a few millimetres flicker
    edge = material(HULL['carpetEdge'], outline=False)
    polygon(f'{name} edge starboard', rect(HALL - 0.45, 0, HALL - 0.3, ROW), 0.01, edge)
    polygon(f'{name} edge port', rect(-HALL + 0.3, 0, -HALL + 0.45, ROW), 0.01, edge)
    polygon(f'{name} ceiling', rect(-OUTER, 0, OUTER, ROW), WALL_H, unlit(HULL['ceiling']), down=True)
    polygon(f'{name} light', [(x, ROW / 2 + y) for x, y in rounded_rect(0.5, ROW - 1.2, 0.2)], WALL_H - 0.02, unlit('#ffffff'), down=True)

    for side, s in (('starboard', 1), ('port', -1)):
        # run aft to starboard and forward to port, so each wall's door frame faces into the hallway
        a, b = (s * HALL, 0), (s * HALL, ROW)
        doorway = bulkhead(f'{name} hallway wall {side}', *((a, b) if s > 0 else (b, a)), doors=[(0, DOOR_W)])[0]
        door_frame(f'{name} holodeck door {side}', doorway @ Matrix.Translation((0, WALL_T / 2, 0)), DOOR_W, DOOR_H,
                   wall=WALL_T, back=0.04, proud=0.04)
        bulkhead(f'{name} outer wall {side}', (s * OUTER, 0), (s * OUTER, ROW))
        bulkhead(f'{name} bulkhead {side}', *(((HALL, 0), (OUTER, 0)) if s > 0 else ((-OUTER, 0), (-HALL, 0))))
        y = ROW / 2 + (3.6 if (s > 0) == even else -3.6)
        face = Matrix.Translation((s * (HALL - WALL_T / 2), y, 0)) @ Matrix.Rotation(s * math.pi / 2, 4, 'Z')
        readout(f'{name} console {side}', 1.5, 0.95, (50 if even else 52) + (s < 0), (0, 0, 1.475), face)


def tail():
    """The end of the hallway: a bulkhead across the deck, with a window looking out from the hallway."""
    module('tail')
    bulkhead('tail wall', (-OUTER, 0), (OUTER, 0))
    window('tail window', 2.4, 1.6, (0, 1.95), Matrix.Translation((0, -WALL_T / 2, 0)) @ Matrix.Rotation(math.pi, 4, 'Z'))
