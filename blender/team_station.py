"""A team station: where a goal's lead works with the captain. In the holodeck it's a holo-pod with a door, standing
against a side wall with the station's sign over it; through it is the goal's briefing room, far bigger than the holodeck
could hold. It's a mini bridge: a few steps straight in from the door, the captain stands on the command carpet facing
the lead's session on a big screen across the far wall, with the lead and the goal's reviewer either side and their
helpers at consoles round behind, and nothing between the door and the screen.

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

from kit import (COMMAND_RED, CONSOLE_TOP, CUSHION, FRAME_PROUD, HULL, annulus, bezel, box, bridge_seat, collide_path,
                 collide_points, command_chair, door_frame, facing, link, marker, material, mesh_object,
                 module, panel, polygon, ring_points, rounded_rect, sweep, toon, unlit, walls, window)
from command_deck import CARPET, profile, wall_materials

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

#: the briefing room is round, like the bridge: a circle of wall this far round its middle, cut flat across the aft for the
#: doorway, and flat behind each screen and window, so each sits square on its wall (a flat screen on a curved wall would
#: stand off it at its ends). It has to fit its slot in the world (layout.ts: BRIEFING), alcove and all.
ROOM_R = 5.5
ROOM_CY = 5.3
HEIGHT = 4.4
#: the flat stretches of wall, as (from, to) degrees counter-clockwise round the middle from dead starboard (+X): the
#: three screens across the front (the star chart to starboard, the viewscreen dead ahead, the goal board to port, each
#: facing the middle) and a window down either side
CHART_FACET = (15, 55)
SCREEN_FACET = (55, 125)
BOARD_FACET = (125, 165)
WINDOW_FACETS = [(-50, -22)]
#: the stretch of port wall past the goal board that carries the bank of transporter feeds
FEEDS_FACET = (170, 232)
#: the rest of the wall curves round in steps no wider than this (degrees)
CURVE_STEP = 11
#: a mini bridge, but with no captain's chair (the captain stands): the middle of the command carpet, where the screen
#: fills the view, with the lead (at the captain's right hand) and the reviewer either side of it, turned a little to
#: the screen, as the first officer and counsellor are on the bridge, and the floor between them open up to the screen
COMMAND = 5.6
FLANK = [('station-lead', 1.85, 5.55), ('station-reviewer', -1.85, 5.55)]
#: the helpers' consoles: two curved ones on an arc round behind, centred on the screen side of where the captain
#: stands, from and to these angles (degrees), open in the middle for the walk from the door, as the bridge's rail is.
#: Two helpers sit at each, on the arc's outside, facing in.
ARC = (0.0, 7.1)
ARC_CONSOLE = 3.25
#: far enough back that a seated Character's boots (0.59 forward of the seat) clear the console's front (0.25 out)
ARC_SEAT = ARC_CONSOLE + 0.9
WINGS = [(200, 251), (289, 340)]
HELPERS = [('station-helper-1', 302), ('station-helper-2', 238), ('station-helper-3', 327), ('station-helper-4', 213)]
#: a console's cross-section, as the bridge's conn and ops have (kit.bridge_console), whoever sits at it on its +Y side:
#: (y, z) up its front, the lip, the keys' slope, over its back and down
CONSOLE = [(0.25, 0), (0.25, 0.55), (0.42, 0.74), (-0.12, 0.92), (-0.2, 0.86), (-0.2, 0)]
#: the viewscreen, nearly across its stretch of wall: StationScreen's BIG_SCREEN proportions (2400×1000), its bezel clear
#: of the wall's stripe. It stands proud of the wall's header band, which runs on behind it: its bezel is deeper than the
#: band stands out, and the screen sits in it in front of the band.
SCREEN_W = 6.0
SCREEN_H = SCREEN_W * 1000 / 2400
SCREEN_BOTTOM = 1.15
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
#: the goal board to port of the viewscreen, and the star chart to starboard, each GoalBoard's proportions (1440×804),
#: their bezels between the wall's stripe and its header, clear of the heads of the crew in front of them seen from
#: where the captain stands
BOARD_W = 3.4
BOARD_H = BOARD_W * 804 / 1440
BOARD_BOTTOM = 1.35
#: the bank of feeds from the station's transporter rooms across the port wall, a monitor per room from the door's end,
#: in view of the command carpet over the helpers' heads: each a 16:9 picture (the feed's 512×288) with its caption
#: (1024×100) under it in one bezel, and a strip over the three that says how many workflows wait for a room
FEED_W = 1.6
FEED_H = FEED_W * 9 / 16
CAPTION_H = FEED_W * 100 / 1024
FEED_GAP = 0.03
FEED_BOTTOM = 1.5
#: where each monitor stands along the feeds' stretch of wall (+X is toward the door's end)
FEED_XS = (1.9, 0.0, -1.9)
FEEDS_STRIP_W = 5.0
FEEDS_STRIP_H = FEEDS_STRIP_W * 100 / 2400
FEEDS_STRIP_BOTTOM = FEED_BOTTOM + CAPTION_H + FEED_GAP + FEED_H + 0.26


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


def on_arc(a, r):
    """The frame at angle `a` (degrees) round ARC, `r` out, its +Y pointing out, away from the middle."""
    out = Vector((math.cos(math.radians(a)), math.sin(math.radians(a))))
    at = Vector(ARC) + out * r
    return Matrix.Translation((at.x, at.y, 0)) @ Matrix.Rotation(facing(at, ARC) + math.pi, 4, 'Z')


def touch_strip(name, start, end, seed):
    """
    The LCARS touch surface along a curved console's slope from angle `start` to `end` (degrees), a little in from its
    edges and a hair over it: one strip following the curve, its UVs running along it to the sitter's right, its top
    (the canvas's) at the slope's back, so the browser draws it as one console top with a station for each sitter.
    """
    front, back = Vector(CONSOLE[2]), Vector(CONSOLE[3])
    up = (back - front).normalized()
    # out of the slope: up, and towards whoever sits at it
    normal = Vector((up.y, -up.x))
    if normal.y < 0:
        normal = -normal
    near = front + up * 0.04 + normal * 0.005
    far = back - up * 0.04 + normal * 0.005
    a0, a1 = start + 1.5, end - 1.5
    steps = 24
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    rows = []
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        out = Vector((math.cos(a), math.sin(a)))
        rows.append([bm.verts.new((*(Vector(ARC) + out * (ARC_CONSOLE + p.x)), p.y)) for p in (near, far)])
    for i in range(steps):
        (n0, f0), (n1, f1) = rows[i], rows[i + 1]
        face = bm.faces.new((n0, n1, f1, f0))
        for loop, coords in zip(face.loops, [(i / steps, 0), ((i + 1) / steps, 0), ((i + 1) / steps, 1), (i / steps, 1)]):
            loop[uv].uv = coords
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.faces[0].normal.z < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    length = math.radians(a1 - a0) * (ARC_CONSOLE + (near.x + far.x) / 2)
    mat = material('#000000', surface='console', seed=seed, w=round(length, 3), h=round((far - near).length, 3),
                   stations=2)
    return link(mesh_object(name, bm, [mat]))


def helper_consoles():
    """
    The helpers' two curved consoles, swept round the arc with the bridge consoles' cross-section, the lip under their
    keys in the station's colour: LCARS keys all along their slope, and a readout standing at the back in front of each
    helper's seat.
    """
    bulkhead = toon(HULL['bulkhead'])
    accent = material(HULL['dado'], surface='accent')
    # to the path's left is in towards the middle, away from whoever sits at it
    profile = [(-y, z) for y, z in CONSOLE]
    for side, (start, end) in enumerate(WINGS):
        path = ring_points(*ARC, ARC_CONSOLE, 12, math.radians(start), math.radians(end))
        sweep(f'helper console {side}', path, profile, [bulkhead, accent, toon(CONSOLE_TOP), bulkhead, bulkhead],
              caps=True)
        collide_path(path, -CONSOLE[-1][0], CONSOLE[2][0])
        touch_strip(f'helper console {side} keys', start, end, 51 + side)
    for i, (crew, a) in enumerate(HELPERS):
        console = on_arc(a, ARC_CONSOLE)
        box(f'helper {i + 1} display', (0.8, 0.06, 0.42), accent, (0, -0.16, 0.88), frame=console, round=0.015)
        panel(f'helper {i + 1} display screen', 0.72, 0.34,
              material('#000000', surface='readout', seed=41 + i, w=0.72, h=0.34), (0, -0.125, 0.92), console)
        # facing in, its back to the arc's outside
        seat = on_arc(a, ARC_SEAT) @ Matrix.Rotation(math.pi, 4, 'Z')
        bridge_seat(f'helper {i + 1}', seat)
        at = seat.to_translation()
        marker(f'seat {crew}', 'seat', (at.x, at.y, 0), yaw=facing(at.xy, ARC), crew=crew)


def feed_bank(wall):
    """
    The feeds from the station's three transporter rooms, on the flat stretch of wall at frame `wall`: a monitor each, its live picture over its caption in one bezel, and over them a strip saying how many
    of the lead's workflows are waiting for a room.
    """
    trim = toon(HULL['frame'])
    h = CAPTION_H + FEED_GAP + FEED_H
    for i, x in enumerate(FEED_XS):
        f = wall @ Matrix.Translation((x, 0, 0))
        bezel(f'transporter feed {i} frame', FEED_W, h, 0.06, 0.08, 0.08, trim, (0, 0, FEED_BOTTOM + h / 2), f)
        # a backing between the caption and the picture, buried in the bezel, so the wall doesn't show through the gap
        box(f'transporter feed {i} back', (FEED_W + 0.02, 0.02, h + 0.02), toon('#15131c'), (0, 0.004, FEED_BOTTOM - 0.01), frame=f)
        panel(f'transporter feed {i} caption', FEED_W, CAPTION_H,
              material('#000000', surface='screen', screen='team-station-feed-caption', feed=i), (0, 0.03, FEED_BOTTOM), f)
        panel(f'transporter feed {i}', FEED_W, FEED_H, material('#000000', surface='screen', screen='team-station-feed', feed=i),
              (0, 0.03, FEED_BOTTOM + CAPTION_H + FEED_GAP), f)
    f = wall
    box('transporter feeds strip frame', (FEEDS_STRIP_W + 0.08, 0.04, FEEDS_STRIP_H + 0.08), trim,
        (0, 0.02, FEEDS_STRIP_BOTTOM - 0.04), frame=f, round=0.015)
    panel('transporter feeds strip', FEEDS_STRIP_W, FEEDS_STRIP_H, material('#000000', surface='screen', screen='team-station-feeds'),
          (0, 0.044, FEEDS_STRIP_BOTTOM), f)


def briefing_room():
    """
    The goal's briefing room, a mini bridge: the doorway in the middle of its aft wall, the command carpet a few steps
    in, the lead and reviewer either side of it and the helpers at consoles on an arc round behind, open in the middle
    for the walk in from the door and on up to the screen, all facing the lead's session on a viewscreen across the far wall, with the station's sign on
    the dado under it to port and the switches for its panes to starboard. The feeds from its transporter rooms across the port side,
    and the goal board and star chart either side of the screen.
    """
    module('briefing_room')
    outline = room_outline()
    door = walls('briefing room wall', outline, [(0, 0.0, DOOR_W)], profile(HEIGHT), wall_materials(),
                 lintel_from=DOOR_H + 0.1)[0]
    doorway('briefing room door', door @ Matrix.Translation((0, -WALL / 2, 0)))
    polygon('briefing room floor', outline, 0, material('#363b5e', surface='carpet'), uv_scale=0.5)
    polygon('briefing room ceiling', outline, HEIGHT, unlit(HULL['ceiling']), down=True)
    annulus('briefing room light', 0, 1.0, HEIGHT - 0.02, unlit('#ffffff'), at=(0, COMMAND), down=True)
    # the command carpet round the chairs, as on the bridge, with the walkway in to it from the door
    annulus('command carpet', 0, 2.1, 0.008, material(CARPET), segments=64, at=(0, COMMAND))
    annulus('command ring', 2.1, 2.25, 0.008, material(HULL['carpetEdge']), segments=64, at=(0, COMMAND))
    polygon('walkway', [(-0.8, WALL / 2), (0.8, WALL / 2), (0.8, COMMAND - 2.2), (-0.8, COMMAND - 2.2)], 0.004,
            material(HULL['carpetEdge']))

    far = facet(SCREEN_FACET)
    screen_middle = tuple(far.to_translation().xy)
    for crew, x, y in FLANK:
        yaw = facing((x, y), screen_middle)
        command_chair(crew, (x, y), yaw, CUSHION, 0.8)
        marker(f'seat {crew}', 'seat', (x, y, 0), yaw=yaw, crew=crew)
    helper_consoles()

    bezel('screen frame', SCREEN_W, SCREEN_H, 0.1, 0.12, SCREEN_DEPTH, toon(HULL['frame']),
          (0, 0, SCREEN_BOTTOM + SCREEN_H / 2), far)
    panel('screen', SCREEN_W, SCREEN_H, material('#000000', surface='screen', screen='team-station'),
          (0, SCREEN_OUT, SCREEN_BOTTOM), far)
    # on the dado under it: the sign to port, as you face it (the facet's +X is to your left), and the switches for
    # which panes the screen shows to starboard; each in a frame a little buried in the dado
    def dado_panel(name, x, h, screen):
        out = DADO_OUT - 0.005
        box(f'{name} frame', (DADO_PANEL_W + 0.08, 0.04, h + 0.08), toon(HULL['frame']),
            (x, out + 0.02, DADO_PANEL_BOTTOM - 0.04), frame=far, round=0.015)
        panel(name, DADO_PANEL_W, h, material('#000000', surface='screen', screen=screen), (x, out + 0.044, DADO_PANEL_BOTTOM), far)

    dado_panel('sign', DADO_PANEL_X, DADO_PANEL_W / SIGN_ASPECT, 'team-station-sign')
    dado_panel('panes', -DADO_PANEL_X, PANES_H, 'team-station-panes')

    for i, f in enumerate(WINDOW_FACETS):
        window(f'briefing room window {i}', 1.8, 1.3, (0, 1.85), facet(f))
    # the goal board to port, the star chart to starboard, either side of the viewscreen
    for name, f, screen in (('goal board', BOARD_FACET, 'team-station-note'), ('star chart', CHART_FACET, 'team-station-chart')):
        at = facet(f)
        bezel(f'{name} frame', BOARD_W, BOARD_H, 0.1, 0.1, 0.08, toon(HULL['frame']), (0, 0, BOARD_BOTTOM + BOARD_H / 2), at)
        panel(name, BOARD_W, BOARD_H, material('#000000', surface='screen', screen=screen), (0, 0.012, BOARD_BOTTOM), at)
    feed_bank(facet(FEEDS_FACET))

    # where the captain stands: the middle of the command carpet, a little back from the crew's chairs
    view = (0, COMMAND - 0.6)
    marker('place briefing room', 'place', (*view, 0), yaw=facing(view, screen_middle), label='Briefing room')
    far_y = ROOM_CY + ROOM_R
    marker('area briefing room', 'area', (0, (WALL / 2 + far_y) / 2, 1),
           scale=(ROOM_R + 0.1, (far_y - WALL / 2) / 2 + 0.1, 1), label='Briefing room')


def round_point(a):
    """The point on the briefing room's circle of wall at angle `a` (degrees, counter-clockwise from +X)."""
    return (ROOM_R * math.cos(math.radians(a)), ROOM_CY + ROOM_R * math.sin(math.radians(a)))


def room_outline():
    """
    The briefing room's inner faces, counter-clockwise from above, starting with the aft wall (its doorway in the
    middle): straight across the circle's foot where it meets the doorway's wall, then round the circle, flat between
    the ends of each screen's and window's stretch of wall, and in steps no wider than CURVE_STEP everywhere else.
    """
    aft = math.degrees(math.asin((WALL / 2 - ROOM_CY) / ROOM_R))
    corners = sorted({a for f in (CHART_FACET, SCREEN_FACET, BOARD_FACET, FEEDS_FACET, *WINDOW_FACETS) for a in f} | {aft, 180 - aft},
                     key=lambda a: (a - aft) % 360)
    flats = {(f[0] % 360, f[1] % 360) for f in (CHART_FACET, SCREEN_FACET, BOARD_FACET, FEEDS_FACET, *WINDOW_FACETS)}
    angles = []
    for a, b in zip(corners, corners[1:]):
        span = (b - a) % 360
        steps = 1 if (a % 360, b % 360) in flats else max(1, math.ceil(span / CURVE_STEP))
        angles += [a + span * i / steps for i in range(steps)]
    angles.append(corners[-1])
    # the circle from the aft wall's starboard end round to its port end, then the aft wall back across
    points = [round_point(a) for a in angles]
    return [points[-1], *points[:-1]]


def facet(f):
    """The frame at the middle of a flat stretch of wall from angle f[0] to f[1]: X along it, Y out into the room."""
    a, b = Vector(round_point(f[0])), Vector(round_point(f[1]))
    mid = (a + b) / 2
    inward = (Vector((0, ROOM_CY)) - mid).normalized()
    return Matrix.Translation((mid.x, mid.y, 0)) @ Matrix.Rotation(math.atan2(-inward.x, inward.y), 4, 'Z')
