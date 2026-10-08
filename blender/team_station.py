"""A team station: where a goal's lead works with the captain. In the holodeck it's a holo-pod with a door, standing
against a side wall with the station's sign over it; through it is the goal's briefing room, far bigger than the holodeck
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

import bmesh
import bpy
from mathutils import Matrix, Vector

from kit import (COMMAND_RED, FRAME_PROUD, HULL, bezel, box, collide_object, collide_points, command_chair, door_frame,
                 facing, link, lounge_chair, marker, material, mesh_object, module, panel, polygon, rounded_rect, slab,
                 toon, unlit, walls, window)
from command_deck import profile, wall_materials

DOOR_W = 2.0
#: lower than the ship's other doors, to leave room for the station's sign over it in the holodeck
DOOR_H = 2.3
WALL = 0.2
#: behind a doorway, where you are for a moment once you've stepped through: the browser's portal fills it
ALCOVE = 0.75

#: the holo-pod round the door: as wide, deep and tall as it stands in the holodeck, in front of its side wall, and
#: under the station's sign, which floats over and in front of it (world/teamStation.ts: GoalSign)
POD_HALF = DOOR_W / 2 + 0.65
POD_BACK = -(ALCOVE + 0.25)
POD_FRONT = 0.45
POD_TOP = 2.72
POD_CREAM = '#e4dccb'
#: the bezel round its doorway
BEZEL_HALF = DOOR_W / 2 + 0.34
BEZEL_TOP = 2.62
BEZEL_DEPTH = 0.22
#: the station's sign on the dado under the briefing room's screen: GoalSign's proportions (1800×256)
SIGN_ASPECT = 1800 / 256

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
#: the viewscreen, nearly wall to wall: StationScreen's BIG_SCREEN proportions (2400×1000), its bezel clear of the
#: wall's stripe. It stands proud of the wall's header band, which runs on behind it: its bezel is deeper than the
#: band stands out, and the screen sits in it in front of the band.
SCREEN_W = 6.0
SCREEN_H = SCREEN_W * 1000 / 2400
SCREEN_BOTTOM = 1.17
SCREEN_DEPTH = 0.18
SCREEN_OUT = 0.1
#: how far the wall's dado stands out (command_deck.profile)
DADO_OUT = 0.05
#: on the dado under the screen, clear of the stripe's lip: the station's sign to port, and the strip of pane switches
#: (PaneSwitches' proportions, 1600×200) to starboard, mirroring it
DADO_PANEL_W = 2.4
DADO_PANEL_X = 1.7
DADO_PANEL_BOTTOM = 0.42
PANES_H = DADO_PANEL_W * 200 / 1600
#: the goal board on the starboard wall, beside the table: GoalBoard's proportions (1440×804), its bezel between the
#: wall's stripe and its header, clear of the heads of the crew in front of it seen from the head of the table
BOARD_W = 3.4
BOARD_H = BOARD_W * 804 / 1440
BOARD_BOTTOM = 1.35


def build():
    station_door()
    briefing_room()


def doorway(name, f):
    """
    A doorway to the other end at `f` (its centre on the floor, in the middle of its wall, +Y out into its room): a
    frame standing FRAME_PROUD out of both faces of a WALL thick wall, the marker the browser hangs the doors and the
    portal on, and colliders round the alcove behind, so you can step far enough in to go through but no further.
    """
    door_frame(name, f @ Matrix.Translation((0, WALL / 2, 0)), DOOR_W, DOOR_H, wall=WALL, back=FRAME_PROUD)
    marker(f'{name} portal', 'portal', frame=f, width=DOOR_W, height=DOOR_H, depth=ALCOVE)
    out = DOOR_W / 2 + 0.3
    for s in (-1, 1):
        collide_points([f @ Vector((s * x, y, 0)) for x in (DOOR_W / 2, out) for y in (0, -ALCOVE - 0.15)])
    collide_points([f @ Vector((x, y, 0)) for x in (-out, out) for y in (-ALCOVE, -ALCOVE - 0.15)])


def station_door():
    """
    The door in the holodeck: a holo-pod, as the Lower Decks crew train in. A cream shell, wide at its foot and rounding
    over at its top under a ribbed ring in the station's colour, with the doorway through a thick grey bezel at its
    front. Lamps down either side of the bezel show whether its goal room is in session, a row of lights sits over the
    door, and a red step lies in front of it. The station's sign floats over it all, drawn by the browser.
    """
    module('station_door')
    doorway('station door', Matrix())
    # the doorway through the pod: just behind the frame's jambs and over the doors' tops, from the alcove's back out
    # through the bezel; the frame stays buried in the shell, all but its inner lip
    inner = DOOR_W / 2 + 0.01
    def cutter(widen):
        return box('station door cut', ((inner + widen) * 2, ALCOVE + POD_FRONT + 0.4, DOOR_H + 0.02 + widen),
                   toon('#ff00ff'), (0, (POD_FRONT + 0.3 - ALCOVE) / 2, -0.01))

    # the shell: a rounded footprint, drawn in at its back and sides as it rises, its front upright as far as the
    # bezel's top, then rounding over
    shell = loft('station pod shell', [
        (0.0, POD_HALF, POD_FRONT, POD_BACK, 0.45),
        (DOOR_H, POD_HALF - 0.12, POD_FRONT - 0.02, POD_BACK + 0.06, 0.45),
        (POD_TOP - 0.18, POD_HALF - 0.3, POD_FRONT - 0.12, POD_BACK + 0.14, 0.42),
        (POD_TOP - 0.06, POD_HALF - 0.6, POD_FRONT - 0.32, POD_BACK + 0.26, 0.3),
        (POD_TOP, POD_HALF - 0.85, POD_FRONT - 0.5, POD_BACK + 0.36, 0.2),
    ], toon(POD_CREAM))
    cut(shell, cutter(0))
    for s in (-1, 1):
        collide_points([(s * inner, POD_BACK), (s * POD_HALF, POD_FRONT + BEZEL_DEPTH)])
    collide_points([(-POD_HALF, POD_BACK), (POD_HALF, -ALCOVE)])

    # the bezel round the doorway, its top corners cut off, standing out of the shell's front
    outline = [(-BEZEL_HALF, 0), (BEZEL_HALF, 0), (BEZEL_HALF, BEZEL_TOP - 0.42), (BEZEL_HALF - 0.42, BEZEL_TOP),
               (-BEZEL_HALF + 0.42, BEZEL_TOP), (-BEZEL_HALF, BEZEL_TOP - 0.42)]
    bezel_ = extrude('station pod bezel', outline, POD_FRONT - 0.3, POD_FRONT + BEZEL_DEPTH, toon(HULL['frame']))
    # a hair wider than the shell's, so their faces round the doorway don't share a plane
    cut(bezel_, cutter(0.01))

    face = POD_FRONT + BEZEL_DEPTH
    lamp = material(HULL['dado'], surface='lamp')
    lamp_x = (inner + BEZEL_HALF) / 2
    for s in (-1, 1):
        box(f'station door lamp {s}', (0.12, 0.03, BEZEL_TOP - 0.72 - 0.3), lamp, (s * lamp_x, face, 0.3))
    for i in range(4):
        box(f'station pod light {i}', (0.08, 0.025, 0.08), unlit('#e8fbff'), ((i - 1.5) * 0.24, face, DOOR_H + 0.08))
    box('station pod step', (DOOR_W + 0.2, 0.3, 0.05), toon(COMMAND_RED), (0, face + 0.15, 0))

    # the ribbed ring round the top, in the station's colour
    top = POD_TOP
    hw, front, back = POD_HALF - 0.85, POD_FRONT - 0.5, POD_BACK + 0.36
    accent = material(HULL['dado'], surface='accent')
    loft('station pod ring', [(top - 0.02, hw + 0.06, front + 0.06, back - 0.06, 0.26),
                              (top + 0.1, hw + 0.06, front + 0.06, back - 0.06, 0.26)], accent)
    cy, hd = (front + back) / 2, (front - back) / 2 + 0.06
    for i, (x, y) in enumerate(rounded_rect(2 * (hw + 0.06), 2 * hd, 0.26, segments=2)):
        box(f'station pod rib {i}', (0.05, 0.05, 0.15), toon(HULL['dado']), (x * 1.02, cy + y * 1.02, top - 0.035))


def loft(name, sections, mat):
    """A solid through rounded rectangles one over another: (z, half width, front y, back y, corner radius) each."""
    bm = bmesh.new()
    rings = []
    for z, hw, front, back, r in sections:
        cy, hd = (front + back) / 2, (front - back) / 2
        rings.append([bm.verts.new((x, cy + y, z)) for x, y in rounded_rect(2 * hw, 2 * hd, r)])
    for a, b in zip(rings, rings[1:]):
        for i in range(len(a)):
            j = (i + 1) % len(a)
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(mesh_object(name, bm, [mat], smooth=math.radians(50)))


def extrude(name, outline, y0, y1, mat):
    """A solid through an outline of (x, z) points, counter-clockwise seen from the front, from y0 back to y1 forward."""
    bm = bmesh.new()
    back = [bm.verts.new((x, y0, z)) for x, z in outline]
    front = [bm.verts.new((x, y1, z)) for x, z in outline]
    for i in range(len(outline)):
        j = (i + 1) % len(outline)
        bm.faces.new((back[i], back[j], front[j], front[i]))
    bm.faces.new(back)
    bm.faces.new(list(reversed(front)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(mesh_object(name, bm, [mat]))


def cut(obj, cutter):
    """Takes `cutter`'s solid out of `obj`, for good, and throws the cutter away."""
    mod = obj.modifiers.new('cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter)


def briefing_room():
    """
    The goal's briefing room: the doorway in the middle of its aft wall, the captain's chair at the near end of a long
    table, the crew either side of it, and the lead's session on a viewscreen across the far wall, with the station's
    sign on the dado under it to port and the switches for its panes to starboard.
    Viewports onto space down the port side, and the goal board, with the lead's note on the goal, to starboard.
    """
    module('briefing_room')
    outline = [(-ROOM_HALF, WALL / 2), (ROOM_HALF, WALL / 2), (ROOM_HALF, ROOM_FAR), (-ROOM_HALF, ROOM_FAR)]
    door = walls('briefing room wall', outline, [(0, 0.0, DOOR_W)], profile(HEIGHT), wall_materials(),
                 lintel_from=DOOR_H + 0.1)[0]
    doorway('briefing room door', door @ Matrix.Translation((0, -WALL / 2, 0)))
    polygon('briefing room floor', outline, 0, material('#363b5e', surface='carpet'), uv_scale=0.5)
    polygon('briefing room ceiling', outline, HEIGHT, unlit(HULL['ceiling']), down=True)
    polygon('briefing room light', [(TABLE[0] + x, TABLE[1] + y) for x, y in rounded_rect(0.9, 3.6, 0.3)], HEIGHT - 0.02,
            unlit('#ffffff'), down=True)
    polygon('briefing room rug', [(TABLE[0] + x, TABLE[1] + y) for x, y in rounded_rect(4.0, 6.0, 0.6)], 0.008,
            material('#4a4e74'))

    w, length = TABLE_SIZE
    top = slab('briefing table', [(TABLE[0] + x, TABLE[1] + y) for x, y in rounded_rect(w, length, w / 2 - 0.02, segments=8)],
               0.72, 0.79, toon('#2b2d42'))
    collide_object(top)
    for s in (-1, 1):
        box(f'briefing table pedestal {s}', (0.5, 0.5, 0.72), toon('#495057'), (TABLE[0], TABLE[1] + s * 1.3, 0))
    polygon('briefing table strip', [(TABLE[0] + x, TABLE[1] + y) for x, y in rounded_rect(0.12, length - 1.2, 0.05)],
            0.795, material(HULL['dado'], surface='accent'))

    command_chair('captain', (0, CAPTAIN), 0, COMMAND_RED, 0.85)
    for crew, side, y in SEATS:
        at = (side * SIDE_X, y)
        yaw = facing(at, (0, y))
        collide_object(lounge_chair(f'chair {crew}', at, yaw), pad=0.1)
        marker(f'seat {crew}', 'seat', (*at, 0), yaw=yaw, crew=crew)

    far = Matrix.Translation((0, ROOM_FAR, 0)) @ Matrix.Rotation(math.pi, 4, 'Z')
    bezel('screen frame', SCREEN_W, SCREEN_H, 0.1, 0.12, SCREEN_DEPTH, toon(HULL['frame']),
          (0, 0, SCREEN_BOTTOM + SCREEN_H / 2), far)
    panel('screen', SCREEN_W, SCREEN_H, material('#000000', surface='screen', screen='team-station'),
          (0, SCREEN_OUT, SCREEN_BOTTOM), far)
    # on the dado under it: the sign to port, as you face it (the far wall's +X is the room's -X), and the switches for
    # which panes the screen shows to starboard; each in a frame a little buried in the dado
    def dado_panel(name, x, h, screen):
        out = DADO_OUT - 0.005
        box(f'{name} frame', (DADO_PANEL_W + 0.08, 0.04, h + 0.08), toon(HULL['frame']),
            (x, out + 0.02, DADO_PANEL_BOTTOM - 0.04), frame=far, round=0.015)
        panel(name, DADO_PANEL_W, h, material('#000000', surface='screen', screen=screen), (x, out + 0.044, DADO_PANEL_BOTTOM), far)

    dado_panel('sign', DADO_PANEL_X, DADO_PANEL_W / SIGN_ASPECT, 'team-station-sign')
    dado_panel('panes', -DADO_PANEL_X, PANES_H, 'team-station-panes')

    port = Matrix.Rotation(-math.pi / 2, 4, 'Z')
    starboard = Matrix.Rotation(math.pi / 2, 4, 'Z')
    for i, y in enumerate((3.9, 7.5)):
        window(f'briefing room window {i}', 2.2, 1.3, (0, 1.85), Matrix.Translation((-ROOM_HALF, y, 0)) @ port)
    board = Matrix.Translation((ROOM_HALF, TABLE[1], 0)) @ starboard
    bezel('goal board frame', BOARD_W, BOARD_H, 0.1, 0.1, 0.08, toon(HULL['frame']), (0, 0, BOARD_BOTTOM + BOARD_H / 2), board)
    panel('goal board', BOARD_W, BOARD_H, material('#000000', surface='screen', screen='team-station-note'),
          (0, 0.012, BOARD_BOTTOM), board)

    view = (0, CAPTAIN - 0.95)
    marker('place briefing room', 'place', (*view, 0), yaw=facing(view, (0, ROOM_FAR)), label='Briefing room')
    marker('area briefing room', 'area', (0, (WALL / 2 + ROOM_FAR) / 2, 1),
           scale=(ROOM_HALF + 0.1, (ROOM_FAR - WALL / 2) / 2 + 0.1, 1), label='Briefing room')
