"""The holodeck deck: a hallway running aft from the turbolift with a holodeck's door either side every ROW metres, and
the engineering station by the turbolift.

It's built as modules the browser puts together for however many holodecks the ship has (world/holodeckDeck.ts): the
head (the turbolift, engineering, and the way into the hallway), a row (the hallway past a holodeck's door either
side, even and odd, so the consoles along it alternate) and the tail (the end wall, with a window). Only the hallway is
here: each holodeck is a training hall (blender/training_hall.py) standing out in the world, and its door in the
hallway's wall is a doorway to it (the browser's, with its doors, which lock for hidden projects), where
client/src/world/layout.ts puts it. Nothing's behind the hallway's walls: they're seen only from the hallway.

The head sits just north of the browser's z = 0, with the hallway running south from it, so the holodecks stand where
layout.ts puts them: Blender's +Y, aft down the hallway, is the browser's -Z.
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
#: the head: wide and deep enough for engineering beside the way in
HEAD_HALF = 7.0
HEAD = 7.0
LIFT_DOOR = 2.0
#: a wall seen only from the room (or hallway), its inner face on the line
LINING = [(-WALL_T, 0), (-WALL_T, WALL_H), (0, WALL_H), (0, 0.97), (0.025, 0.97), (0.025, 0.9), (0.025, 0)]


def lining_materials():
    dado, stripe, bulkhead = toon(HULL['dado']), toon(HULL['stripe']), toon(HULL['bulkhead'])
    return [bulkhead, bulkhead, bulkhead, stripe, stripe, dado]


def lining(name, a, b, doors=()):
    """
    A run of wall seen only from the room on its left as you go from a to b, its inner face on that line, with gaps
    for `doors` (offset from its middle, width). Returns each door's frame, on the inner face.
    """
    return walls(name, [a, b], [(0, offset, width) for offset, width in doors], LINING, lining_materials(),
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

    polygon('head floor', rect(-HEAD_HALF, -HEAD, HEAD_HALF, 0), 0, material('#4a3f6e', surface='carpet'), uv_scale=0.5)
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

    # the head's aft wall either side of the way into the hallway, run inboard so the head's on its left, its corners
    # buried in the head's side walls and, where the hallway's walls begin, behind the pilasters
    lining('head aft wall starboard', (HEAD_HALF + WALL_T, -WALL_T / 2), (HALL, -WALL_T / 2))
    lining('head aft wall port', (-HALL, -WALL_T / 2), (-HEAD_HALF - WALL_T, -WALL_T / 2))
    frame = toon(HULL['frame'])
    for s in (-1, 1):
        collide_object(box(f'hallway pilaster {s}', (0.36, 0.3, WALL_H), frame, (s * HALL, -0.03, 0), round=0.02))
    sign('sign holodecks', 'Holodecks', 3.6, LCARS['periwinkle'], (0, -0.21, 2.4), yaw=math.pi, sub='One per project', code='Deck 4')

    place = (2.4, -1.2)
    marker('place engineering', 'place', (*place, 0), yaw=facing(place, station), label='🔧 Engineering')
    marker('area engineering', 'area', (0, -HEAD / 2, 1), scale=(HEAD_HALF + 0.1, HEAD / 2 + 0.1, 1), label='Engineering')


def row(name, even):
    """
    The hallway past a holodeck's door either side: its walls and their doorways (their doors are the browser's), and
    LCARS consoles between the doors, on alternate sides of them row by row.
    """
    module(name)
    polygon(f'{name} hallway', rect(-HALL, 0, HALL, ROW), 0, material(HULL['carpet'], surface='carpet'), uv_scale=0.5)
    # lifted well clear of the carpet: from the far end of a long hallway, a few millimetres flicker
    edge = material(HULL['carpetEdge'])
    polygon(f'{name} edge starboard', rect(HALL - 0.45, 0, HALL - 0.3, ROW), 0.01, edge)
    polygon(f'{name} edge port', rect(-HALL + 0.3, 0, -HALL + 0.45, ROW), 0.01, edge)
    polygon(f'{name} ceiling', rect(-HALL, 0, HALL, ROW), WALL_H, unlit(HULL['ceiling']), down=True)
    polygon(f'{name} light', [(x, ROW / 2 + y) for x, y in rounded_rect(0.5, ROW - 1.2, 0.2)], WALL_H - 0.02, unlit('#ffffff'), down=True)

    for side, s in (('starboard', 1), ('port', -1)):
        # its inner face where a bulkhead's hallway face was, half a wall in from the doorways' line, run aft to
        # starboard and forward to port, so the hallway's on its left and each door frame faces into it
        x = s * (HALL - WALL_T / 2)
        a, b = (x, 0), (x, ROW)
        doorway = lining(f'{name} hallway wall {side}', *((a, b) if s > 0 else (b, a)), doors=[(0, DOOR_W)])[0]
        door_frame(f'{name} holodeck door {side}', doorway, DOOR_W, DOOR_H, wall=WALL_T, back=0.04, proud=0.04)
        y = ROW / 2 + (3.6 if (s > 0) == even else -3.6)
        face = Matrix.Translation((s * (HALL - WALL_T / 2), y, 0)) @ Matrix.Rotation(s * math.pi / 2, 4, 'Z')
        readout(f'{name} console {side}', 1.5, 0.95, (50 if even else 52) + (s < 0), (0, 0, 1.475), face)


def tail():
    """The end of the hallway: a wall across it, with a window looking out from the hallway."""
    module('tail')
    # its face where a bulkhead's was, across the hallway's walls' ends, which it buries
    lining('tail wall', (HALL + WALL_T / 2, -WALL_T / 2), (-HALL - WALL_T / 2, -WALL_T / 2))
    # its frame resting on the stripe
    window('tail window', 2.4, 1.6, (0, 1.92), Matrix.Translation((0, -WALL_T / 2, 0)) @ Matrix.Rotation(math.pi, 4, 'Z'))
