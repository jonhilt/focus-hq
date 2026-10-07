"""A team station: where a goal's lead works with the captain. In the holodeck it's only a door, standing against a
side wall with the station's sign over it; through it is the goal's briefing room, far bigger than the holodeck
could hold. The lead, their helpers and the goal's reviewer sit round a long table there, the captain's chair at its
head, facing the lead's session on a big screen on the far wall.

The briefing room stands somewhere else in the world entirely: the browser (world/teamStation.ts, world/portal.ts)
draws it through the open door, and moves you there as you step over the threshold, so the two doorways have to
match exactly. Each is built by `doorway`, from the middle of its wall, and its frame stands as far out of either
face, so seen from either side it's the same.

Two modules, each in its own frame with its doorway at the origin, facing out into its room along +Y: `station_door`,
which the browser stands in a holodeck once per station, and `briefing_room`, which it builds once per station
somewhere out of the way. Only the furniture is here: who sits where, and what the screens show, is the browser's.
"""

import math

from mathutils import Matrix, Vector

from kit import (COMMAND_RED, DOOR_H, FRAME_PROUD, HULL, bezel, box, collide_object, collide_points,
                 command_chair, door_frame, facing, lounge_chair, marker, material, module, panel, polygon, readout,
                 rounded_rect, slab, toon, unlit, walls, window)
from command_deck import profile, wall_materials

DOOR_W = 2.0
WALL = 0.2
#: behind a doorway, where you are for a moment once you've stepped through: the browser's portal fills it
ALCOVE = 0.75

#: the door's housing: as wide, deep and tall as it stands in the holodeck, in front of its side wall
HOUSING_HALF = DOOR_W / 2 + 0.55
HOUSING_BACK = -(ALCOVE + 0.15)
HOUSING_TOP = 3.0

#: the briefing room's inner faces, from the doorway's wall to the screen's
ROOM_HALF = 3.5
ROOM_FAR = WALL / 2 + 10.0
HEIGHT = 4.0
#: the table, along the room, and the chairs either side of it, from the captain's end in the order the crew take them
TABLE = (0.0, 5.7)
TABLE_SIZE = (1.6, 4.2)
SIDE_X = 1.35
SEATS = [('station-lead', 1, 4.7), ('station-reviewer', -1, 4.7), ('station-helper-1', 1, 5.7),
         ('station-helper-2', -1, 5.7), ('station-helper-3', 1, 6.7), ('station-helper-4', -1, 6.7)]
CAPTAIN = 3.0
#: the screen: StationScreen's BIG_SCREEN proportions (1600×1024), its bezel between the wall's stripe and its header
SCREEN_W = 3.4
SCREEN_H = SCREEN_W * 1024 / 1600
SCREEN_BOTTOM = 1.1
#: the sign beside it: lcarsSign's 1024×287
SIGN_W = 1.2
SIGN_H = SIGN_W * 287 / 1024


def build():
    station_door()
    briefing_room()


def doorway(name, f):
    """
    A doorway to the other end at `f` (its centre on the floor, in the middle of its wall, +Y out into its room): a
    frame standing FRAME_PROUD out of both faces of a WALL thick wall, the marker the browser hangs the doors and the
    portal on, and colliders round the alcove behind, so you can step far enough in to go through but no further.
    """
    door_frame(name, f @ Matrix.Translation((0, WALL / 2, 0)), DOOR_W, wall=WALL, back=FRAME_PROUD)
    marker(f'{name} portal', 'portal', frame=f, width=DOOR_W, height=DOOR_H, depth=ALCOVE)
    out = DOOR_W / 2 + 0.3
    for s in (-1, 1):
        collide_points([f @ Vector((s * x, y, 0)) for x in (DOOR_W / 2, out) for y in (0, -ALCOVE - 0.15)])
    collide_points([f @ Vector((x, y, 0)) for x in (-out, out) for y in (-ALCOVE, -ALCOVE - 0.15)])


def station_door():
    """
    The door in the holodeck: a housing round the alcove, in the bulkhead's colours with its LCARS stripe, an accent of
    the station's colour either side of the frame and along its top, and the station's sign over the doorway.
    """
    module('station_door')
    doorway('station door', Matrix())
    front = WALL / 2
    # the alcove's sides stand just behind the frame's jambs, and its ceiling just above the doors' tops
    inner = DOOR_W / 2 + 0.01

    def housing(out, back, front_y, notch, deep=ALCOVE):
        """The housing's footprint, `out` either side and from `back` to `front_y`, round the alcove `notch` either side
        and `deep`."""
        return [(-out, back), (out, back), (out, front_y), (notch, front_y), (notch, -deep), (-notch, -deep),
                (-notch, front_y), (-out, front_y)]

    bulkhead = toon(HULL['bulkhead'])
    slab('station door housing', housing(HOUSING_HALF, HOUSING_BACK, front, inner), 0, DOOR_H + 0.01, bulkhead)
    for s in (-1, 1):
        collide_points([(s * inner, HOUSING_BACK), (s * HOUSING_HALF, front)])
    collide_points([(-HOUSING_HALF, HOUSING_BACK), (HOUSING_HALF, -ALCOVE)])
    box('station door lintel', (HOUSING_HALF * 2, front - HOUSING_BACK, HOUSING_TOP - DOOR_H - 0.01), bulkhead,
        (0, (front + HOUSING_BACK) / 2, DOOR_H + 0.01))
    # the dado and the stripe over it, as along the walls, a little proud of the housing (and behind the alcove's sides)
    slab('station door dado', housing(HOUSING_HALF + 0.02, HOUSING_BACK - 0.02, front + 0.02, inner + 0.01, ALCOVE + 0.01),
         0, 0.9, toon(HULL['dado']))
    slab('station door stripe', housing(HOUSING_HALF + 0.035, HOUSING_BACK - 0.035, front + 0.035, inner + 0.01,
                                        ALCOVE + 0.01), 0.9, 0.97, toon(HULL['stripe']))
    accent = material(HULL['dado'], surface='accent')
    box('station door cap', (HOUSING_HALF * 2 + 0.06, front - HOUSING_BACK + 0.06, 0.06), accent,
        (0, (front + HOUSING_BACK) / 2, HOUSING_TOP))
    edge = DOOR_W / 2 + 0.16
    for s in (-1, 1):
        box(f'station door accent {s}', (0.12, 0.03, DOOR_H + 0.16 - 0.97), accent,
            (s * (edge + HOUSING_HALF) / 2, front + 0.015, 0.97))
    panel('station door sign', SIGN_W * 0.85, SIGN_H * 0.85,
          material('#000000', surface='screen', outline=False, screen='team-station-sign'),
          (0, front + 0.012, DOOR_H + 0.16 + 0.04))


def briefing_room():
    """
    The goal's briefing room: the doorway in the middle of its aft wall, the captain's chair at the near end of a long
    table, the crew either side of it, and the lead's session on the far wall, with the station's sign beside it.
    Viewports onto space down the port side, readouts down the starboard.
    """
    module('briefing_room')
    outline = [(-ROOM_HALF, WALL / 2), (ROOM_HALF, WALL / 2), (ROOM_HALF, ROOM_FAR), (-ROOM_HALF, ROOM_FAR)]
    door = walls('briefing room wall', outline, [(0, 0.0, DOOR_W)], profile(HEIGHT), wall_materials(),
                 lintel_from=DOOR_H + 0.1)[0]
    doorway('briefing room door', door @ Matrix.Translation((0, -WALL / 2, 0)))
    polygon('briefing room floor', outline, 0, material('#363b5e', surface='carpet', outline=False), uv_scale=0.5)
    polygon('briefing room ceiling', outline, HEIGHT, unlit(HULL['ceiling']), down=True)
    polygon('briefing room light', [(TABLE[0] + x, TABLE[1] + y) for x, y in rounded_rect(0.9, 3.6, 0.3)], HEIGHT - 0.02,
            unlit('#ffffff'), down=True)
    polygon('briefing room rug', [(TABLE[0] + x, TABLE[1] + y) for x, y in rounded_rect(4.0, 6.0, 0.6)], 0.008,
            material('#4a4e74', outline=False))

    w, length = TABLE_SIZE
    top = slab('briefing table', [(TABLE[0] + x, TABLE[1] + y) for x, y in rounded_rect(w, length, w / 2 - 0.02, segments=8)],
               0.72, 0.79, toon('#2b2d42'))
    collide_object(top)
    for s in (-1, 1):
        box(f'briefing table pedestal {s}', (0.5, 0.5, 0.72), toon('#495057'), (TABLE[0], TABLE[1] + s * 1.3, 0))
    polygon('briefing table strip', [(TABLE[0] + x, TABLE[1] + y) for x, y in rounded_rect(0.12, length - 1.2, 0.05)],
            0.795, material(HULL['dado'], surface='accent', outline=False))

    command_chair('captain', (0, CAPTAIN), 0, COMMAND_RED, 0.85)
    for crew, side, y in SEATS:
        at = (side * SIDE_X, y)
        yaw = facing(at, (0, y))
        collide_object(lounge_chair(f'chair {crew}', at, yaw), pad=0.1)
        marker(f'seat {crew}', 'seat', (*at, 0), yaw=yaw, crew=crew)

    far = Matrix.Translation((0, ROOM_FAR, 0)) @ Matrix.Rotation(math.pi, 4, 'Z')
    bezel('screen frame', SCREEN_W, SCREEN_H, 0.1, 0.12, 0.08, toon(HULL['frame']), (0, 0, SCREEN_BOTTOM + SCREEN_H / 2), far)
    panel('screen', SCREEN_W, SCREEN_H, material('#000000', surface='screen', outline=False, screen='team-station'),
          (0, 0.012, SCREEN_BOTTOM), far)
    # to port of the screen, as you face it: the far wall's +X is the room's -X
    sign_x = (SCREEN_W / 2 + 0.12 + ROOM_HALF) / 2
    box('sign frame', (SIGN_W + 0.08, 0.04, SIGN_H + 0.08), toon(HULL['dado']), (sign_x, 0.02, 1.6 - 0.04), frame=far, round=0.015)
    panel('sign', SIGN_W, SIGN_H, material('#000000', surface='screen', outline=False, screen='team-station-sign'),
          (sign_x, 0.044, 1.6), far)

    port = Matrix.Rotation(-math.pi / 2, 4, 'Z')
    starboard = Matrix.Rotation(math.pi / 2, 4, 'Z')
    for i, y in enumerate((3.9, 7.5)):
        window(f'briefing room window {i}', 2.2, 1.3, (0, 1.85), Matrix.Translation((-ROOM_HALF, y, 0)) @ port)
        readout(f'briefing room readout {i}', 1.6, 0.9, 81 + i, (0, 0, 1.45), Matrix.Translation((ROOM_HALF, y, 0)) @ starboard)

    view = (0, CAPTAIN - 0.95)
    marker('place briefing room', 'place', (*view, 0), yaw=facing(view, (0, ROOM_FAR)), label='Briefing room')
    marker('area briefing room', 'area', (0, (WALL / 2 + ROOM_FAR) / 2, 1),
           scale=(ROOM_HALF + 0.1, (ROOM_FAR - WALL / 2) / 2 + 0.1, 1), label='Briefing room')
