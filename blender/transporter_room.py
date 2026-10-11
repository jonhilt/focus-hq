"""A transporter room, as on the Enterprise-D: where a goal's lead runs a workflow. The agents at work right now stand on
its pads (beaming in as they start and out as they finish), those still queued are patterns held in its pattern buffer,
and a tactical display on the wall follows the whole operation phase by phase. Each team station has three, so a lead
can run several workflows at once; the goal's briefing room shows their feeds, and the captain can beam into one to
watch, and back to the briefing room from its console.

One module, `transporter_room`, which the browser stands out in the world three times per team station
(client/src/world/layout.ts: transporterRoomAt) and dresses (world/transporterRoom.ts). Nobody walks in: you beam in
and out, so its door is sealed, for show. Its origin is the middle of its floor; the platform runs along its back wall
(+Y), three tiers of six pads stepping up from the front, with the transporter console in front of it facing it, the
pattern buffer's columns in niches either side of it, the tactical display turned out from the starboard wall (+X) and the door on
the port wall. Only the room is here: who stands on the pads, the rings' colours, the buffer's glow and what the screens
show are the browser's.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from command_deck import profile, wall_materials
from kit import (CONSOLE_TOP, DOOR_H, HULL, LCARS, annulus, bezel, box, collide_footprint, collide_object, collider, cylinder, door_frame,
                 facing, interact, link, marker, material, mesh_object, module, panel, part, polygon, prism, sign, toon,
                 unlit, walls)

#: the room's inner faces: 9.2 m across and 8 m from the front wall to the back, behind the platform
HALF_W = 4.6
HALF_D = 4.0
HEIGHT = 4.4
WALL = 0.2
#: the pattern buffer's niches in the back wall, either side of the platform: from and to these distances out from the
#: middle, and how deep
NICHE = (3.15, 4.15)
NICHE_DEEP = 0.7
#: the platform's tiers, from the front: each one's height, how far out either side of the middle it runs, and how deep
#: it is (each runs on back to the wall, under the ones behind it), its front corners cut off
TIERS = [(0.2, 2.8), (0.4, 2.7), (0.6, 2.6)]
TIER_D = 0.9
CHAMFER = 0.35
#: a pad on each tier every PAD_STEP, slot 0 at the door's end (port); each PAD_R across and PAD_H thick, with its lit
#: ring between RING radii
PADS = 6
PAD_STEP = 0.8
PAD_R = 0.36
PAD_H = 0.05
RING = (0.255, 0.33)
PAD_LIGHT = '#8aedff'
#: the canopy over the platform, the pads' emitters in its underside
CANOPY_BOTTOM = HEIGHT - 0.3
#: the transporter console: in front of the platform's middle, facing it, whoever stands at it on its front side
CONSOLE_Y = -0.55
CONSOLE_L = 1.7
#: where you arrive: behind the console, far enough back to take in the whole platform and the tactical display at
#: once, turned a little to starboard between them, the console in front of you
ARRIVE_Y = CONSOLE_Y - 2.55
ARRIVE_LOOK = (1.6, 2.0)
#: the tactical display on the starboard wall, hinged out from it at its front end (nearest the door's wall) and turned
#: TACTICAL_TURN towards the room, so it faces where you arrive rather than across the room
TACTICAL_W = 3.6
TACTICAL_H = 2.0
TACTICAL_HINGE = -0.5
TACTICAL_TURN = math.radians(25)
TACTICAL_BOTTOM = 1.25
#: the pattern buffer's readout, on the port wall beside its niche
BUFFER_W = 1.0
BUFFER_H = 0.62
BUFFER_Y = 2.75
BUFFER_BOTTOM = 1.35
#: the sealed door, towards the front of the port wall
DOOR_Y = -1.9
DOOR_W = 1.8
#: the feed's camera, up in the front corner over the door, looking at the platform's middle
CAMERA = (-3.95, -3.35, 3.5)
CAMERA_LOOK = (0.3, 2.6, 1.3)
CAMERA_FOV = 52


def build():
    transporter_room()


def tier_front(tier):
    return HALF_D - TIER_D * (len(TIERS) - tier)


def pad_at(tier, slot):
    """The middle of a pad, on the floor plan: a little forward of the middle of its tier, clear of the backdrop."""
    return ((slot - (PADS - 1) / 2) * PAD_STEP, tier_front(tier) + TIER_D / 2 - 0.05)


def chamfered(front, half, back):
    """A tier's (or the canopy's) outline, counter-clockwise from above: from `front` back to `back`, its front corners
    cut off."""
    return [(-half + CHAMFER, front), (half - CHAMFER, front), (half, front + CHAMFER), (half, back), (-half, back),
            (-half, front + CHAMFER)]


def block(name, outline, z0, z1, top_mat, side_mat):
    """A solid through an outline (counter-clockwise from above) from z0 up to z1: its top in `top_mat`, the rest in
    `side_mat`."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z0)) for x, y in outline]
    top = [bm.verts.new((x, y, z1)) for x, y in outline]
    bm.faces.new(top).material_index = 0
    bm.faces.new(list(reversed(bottom))).material_index = 1
    for i in range(len(outline)):
        j = (i + 1) % len(outline)
        bm.faces.new((bottom[i], bottom[j], top[j], top[i])).material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(mesh_object(name, bm, [top_mat, side_mat]))


def platform():
    """
    The transporter platform along the back wall: three tiers stepping up from the floor, a strip in the station's
    colour along each riser, and on each tier six round pads with a lit ring, each with an emitter over it in the
    canopy's underside, as in the Enterprise-D's transporter room. The player keeps to one floor height, so it's all
    one collider.
    """
    top, riser = toon('#6c6584'), toon(HULL['dado'])
    accent = material(HULL['dado'], surface='accent')
    pad_mat, emitter = toon('#38334a'), toon(HULL['frame'])
    for tier, (h, half) in enumerate(TIERS):
        front = tier_front(tier)
        # each tier from just inside the one below up to its top, back into the wall; their bottoms and backs a little
        # apart, so no two share a plane
        z0 = TIERS[tier - 1][0] - 0.02 if tier else -0.01
        block(f'transporter tier {tier}', chamfered(front, half, HALF_D + 0.03 + 0.01 * tier), z0, h, top, riser)
        rise = h - (TIERS[tier - 1][0] if tier else 0)
        # along the riser between its cut corners, standing a hair proud of it
        box(f'transporter tier {tier} strip', (2 * (half - CHAMFER) - 0.1, 0.012, 0.05), accent,
            (0, front - 0.002, h - rise / 2 - 0.025))
        for slot in range(PADS):
            x, y = pad_at(tier, slot)
            name = f'transporter pad {tier}-{slot}'
            cylinder(name, PAD_R, PAD_H, pad_mat, (x, y, h - 0.015), segments=40)
            # its own material, which the browser lights in the colour of whoever's on it
            ring = annulus(f'{name} ring', RING[0], RING[1], h + PAD_H - 0.011, unlit(PAD_LIGHT), segments=40, at=(x, y))
            part('pad-ring', ring, tier=tier, slot=slot)
            # where whoever beams in stands: on the pad, facing out into the room
            marker(f'pad {tier}-{slot}', 'pad', (x, y, h + PAD_H - 0.015), yaw=math.pi, tier=tier, slot=slot)
            # the emitter over it, in the canopy's underside
            cylinder(f'{name} emitter', PAD_R, 0.045, emitter, (x, y, CANOPY_BOTTOM - 0.04), segments=40)
            glow = annulus(f'{name} emitter glow', 0, RING[1] - 0.04, CANOPY_BOTTOM - 0.044, unlit('#dff8ff'), segments=40,
                           at=(x, y), down=True)
            part('pad-emitter', glow, tier=tier, slot=slot)
    h0, half0 = TIERS[0]
    collider(-half0, half0, tier_front(0), HALF_D)

    # the backdrop behind the back tier, from it up into the canopy, over the wall's stripe and trims: pilasters between
    # the pads, and a tall panel of light behind each, which shows up whoever stands in front of it
    backdrop, h2 = HALF_D - 0.095, TIERS[-1][0]
    box('transporter backdrop', (5.1, 0.105, CANOPY_BOTTOM + 0.02 - (h2 - 0.02)), toon(HULL['dado']),
        (0, HALF_D - 0.0425, h2 - 0.02))
    for k in range(PADS + 1):
        x = (k - PADS / 2) * PAD_STEP
        box(f'transporter backdrop pilaster {k}', (0.16, 0.08, CANOPY_BOTTOM + 0.01 - (h2 - 0.01)), toon(HULL['frame']),
            (x, backdrop - 0.03, h2 - 0.01))
    for slot in range(PADS):
        x, _ = pad_at(0, slot)
        f = Matrix.Translation((x, backdrop - 0.004, 0)) @ Matrix.Rotation(math.pi, 4, 'Z')
        panel(f'transporter backdrop light {slot}', PAD_STEP - 0.26, CANOPY_BOTTOM - 0.2 - (h2 + 0.12), unlit('#cfd6f4'),
              (0, 0, h2 + 0.12), f)

    # the canopy over it all, as deep as the platform, a strip of light along its front
    block('transporter canopy', chamfered(tier_front(0), half0, HALF_D + 0.05), CANOPY_BOTTOM, HEIGHT + 0.02,
          toon(HULL['ceiling']), toon(HULL['frame']))
    box('transporter canopy light', (2 * (half0 - CHAMFER) - 0.2, 0.012, 0.06), unlit('#c9f4ff'),
        (0, tier_front(0) - 0.002, CANOPY_BOTTOM + 0.12))


def pattern_buffer():
    """
    The pattern buffer: a glowing column in a niche either side of the platform, between a base and a cap, held by
    struts, where the patterns of those waiting to beam in are held. Both columns are one part, so the browser lights
    them together; its readout is on the port wall beside them.
    """
    frame, accent = toon(HULL['frame']), material(HULL['dado'], surface='accent')
    glow = unlit('#a8ecff')
    y = HALF_D + NICHE_DEEP / 2
    tubes = []
    for s in (-1, 1):
        x = s * (NICHE[0] + NICHE[1]) / 2
        name = f'pattern buffer {"port" if s < 0 else "starboard"}'
        base = cylinder(f'{name} base', 0.33, 0.42, frame, (x, y, 0), segments=32)
        cylinder(f'{name} band', 0.335, 0.05, accent, (x, y, 0.3), segments=32)
        tubes.append(cylinder(f'{name} column', 0.2, 3.02, glow, (x, y, 0.4), segments=32))
        cylinder(f'{name} cap', 0.33, 0.35, frame, (x, y, 3.4), segments=32)
        cylinder(f'{name} cap band', 0.335, 0.05, accent, (x, y, 3.5), segments=32)
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            box(f'{name} strut {k}', (0.05, 0.05, 3.04), frame, (x + 0.26 * math.cos(a), y + 0.26 * math.sin(a), 0.39))
        collide_object(base, pad=0.1)
    part('buffer-glow', *tubes)

    port = Matrix.Translation((-HALF_W, BUFFER_Y, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z')
    framed_screen('pattern buffer readout', BUFFER_W, BUFFER_H, BUFFER_BOTTOM, 'transporter-buffer', port)


def framed_screen(name, w, h, bottom, screen, f):
    """A screen `w`×`h` on a wall (`f`: on its inner face, Y into the room), its bottom `bottom` up, in a frame a little
    buried in the wall."""
    box(f'{name} frame', (w + 0.1, 0.05, h + 0.1), toon(HULL['frame']), (0, 0.015, bottom - 0.05), frame=f, round=0.012)
    return panel(name, w, h, material('#000000', surface='screen', screen=screen), (0, 0.044, bottom), f)


def transporter_console():
    """
    The transporter chief's console: a wide LCARS top sloping up towards the platform, on a pedestal, standing in front of
    the platform's middle with its operator's side towards the room. Pressing E on any of it energises: it beams you
    back to the briefing room.
    """
    f = Matrix.Translation((0, CONSOLE_Y, 0)) @ Matrix.Rotation(math.pi, 4, 'Z')
    bulkhead, trim, dado = toon(HULL['bulkhead']), toon(HULL['frame']), toon(HULL['dado'])
    accent = material(HULL['dado'], surface='accent')
    parts = [
        box('transporter console plinth', (1.4, 0.6, 0.05), dado, (0, -0.03, -0.01), frame=f, round=0.01),
        box('transporter console pedestal', (1.1, 0.34, 0.79), trim, (0, -0.03, 0.02), frame=f, round=0.02),
    ]
    # its top's side profile, whoever stands at it on its +Y side: up the front under its lip, the lip, the keys sloping
    # up away from them, over the back and down under it
    front, back = (0.38, 0.93), (-0.32, 1.09)
    shape = [(0.2, 0.76), (0.38, 0.88), front, back, (-0.36, 1.03), (-0.25, 0.76)]
    top = prism('transporter console', shape, CONSOLE_L, [bulkhead, accent, toon(CONSOLE_TOP), trim, bulkhead, dado],
                frame=f, round=0.015)
    parts.append(top)
    # the LCARS keys on its slope, a hair over it
    up = Vector((0, back[0] - front[0], back[1] - front[1]))
    length = up.length
    up.normalize()
    tilt = math.atan2(-up.y, up.z)
    normal = Vector((0, math.cos(tilt), math.sin(tilt)))
    start = Vector((0, front[0], front[1])) + up * 0.04 + normal * 0.005
    w, h = round(CONSOLE_L - 0.12, 3), round(length - 0.08, 3)
    parts.append(panel('transporter console keys', w, h,
                       material('#000000', surface='console', seed=71, w=w, h=h, stations=1), tuple(start), f, tilt=tilt))
    collide_object(top, pad=0.08)

    # all of it under one empty, which says what pressing E on it does
    console = bpy.data.objects.new('transporter console controls', None)
    console.empty_display_type = 'PLAIN_AXES'
    link(console, frame=f)
    inverse = f.inverted()
    for p in parts:
        p.parent = console
        p.matrix_parent_inverse = inverse
    interact('energise', 'Energise: beam back to the briefing room', console)


def sealed_door(f):
    """A door on the wall at `f` (its centre on the wall's inner face, Y into the room) that never opens: nobody walks in
    or out of a transporter room. Its leaves look like the ship's sliding doors (world/starship.ts: SlidingDoors)."""
    door_frame('transporter room door', f, DOOR_W, DOOR_H)
    # from just inside the wall out over its dado and stripe, buried in the frame's jambs and head
    box('transporter room door leaves', (DOOR_W + 0.06, 0.1, DOOR_H + 0.03), toon(HULL['door']), (0, 0.04, -0.01), frame=f)
    # the band across them and the seam between them standing out of them, each from a different depth inside them
    box('transporter room door band', (DOOR_W + 0.04, 0.115, 0.14), toon(HULL['dado']), (0, 0.0525, DOOR_H * 0.42), frame=f)
    box('transporter room door seam', (0.05, 0.132, DOOR_H + 0.04), toon(HULL['frame']), (0, 0.051, -0.015), frame=f)
    # its sign over it, on a plate a little buried in the wall
    box('transporter room sign plate', (1.58, 0.03, 0.37), toon(HULL['dado']), (0, 0.005, 2.81), frame=f)
    sign('transporter room sign', 'Transporter room', 1.5, LCARS['orange'], (0, 0.024, 2.85), f)


def transporter_room():
    module('transporter_room')
    # counter-clockwise from the front port corner, round the niches in the back wall
    (n0, n1), back = NICHE, HALF_D + NICHE_DEEP
    outline = [(-HALF_W, -HALF_D), (HALF_W, -HALF_D), (HALF_W, HALF_D), (n1, HALF_D), (n1, back), (n0, back),
               (n0, HALF_D), (-n0, HALF_D), (-n0, back), (-n1, back), (-n1, HALF_D), (-HALF_W, HALF_D)]
    walls('transporter room wall', outline, [], profile(HEIGHT), wall_materials(), lintel_from=HEIGHT)
    polygon('transporter room floor', outline, 0, material('#353a5a', surface='carpet'), uv_scale=0.5)
    polygon('transporter room ceiling', outline, HEIGHT, unlit(HULL['ceiling']), down=True)
    annulus('transporter room light', 0, 0.9, HEIGHT - 0.02, unlit('#ffffff'), at=(0, -1.6), down=True)

    platform()
    pattern_buffer()
    transporter_console()

    port = Matrix.Rotation(-math.pi / 2, 4, 'Z')
    starboard = Matrix.Rotation(math.pi / 2, 4, 'Z')
    sealed_door(Matrix.Translation((-HALF_W, DOOR_Y, 0)) @ port)

    # the tactical display, in a bezel hinged out from the starboard wall at its front end, turned to face where you arrive
    along = Vector((-math.sin(TACTICAL_TURN), math.cos(TACTICAL_TURN)))
    middle = Vector((HALF_W - 0.05, TACTICAL_HINGE)) + along * (TACTICAL_W / 2)
    out = Vector((-math.cos(TACTICAL_TURN), -math.sin(TACTICAL_TURN)))
    wall = Matrix.Translation((middle.x, middle.y, 0)) @ Matrix.Rotation(facing(middle, middle + out), 4, 'Z')
    bezel('tactical display frame', TACTICAL_W, TACTICAL_H, 0.1, 0.12, 0.14, toon(HULL['frame']),
          (0, 0, TACTICAL_BOTTOM + TACTICAL_H / 2), wall)
    panel('tactical display', TACTICAL_W, TACTICAL_H,
          material('#000000', surface='screen', screen='transporter-tactical'), (0, 0.07, TACTICAL_BOTTOM), wall)
    # it hangs at head height, so keep the player out from under it (and out of the gap behind it)
    collide_footprint(wall, -TACTICAL_W / 2 - 0.12, TACTICAL_W / 2 + 0.12, -0.1, 0.2)

    # LCARS readouts either side on the front wall, behind whoever's at the console
    for i, x in enumerate((-2.3, 2.3)):
        f = Matrix.Translation((x, -HALF_D, 0))
        box(f'front readout {i} frame', (1.3, 0.05, 0.8), toon(HULL['frame']), (0, 0.015, 1.3), frame=f, round=0.012)
        panel(f'front readout {i}', 1.2, 0.7, material('#000000', surface='readout', seed=81 + i, w=1.2, h=0.7),
              (0, 0.044, 1.35), f)

    marker('place transporter room', 'place', (0, ARRIVE_Y, 0), yaw=facing((0, ARRIVE_Y), ARRIVE_LOOK), label='Transporter room')
    marker('area transporter room', 'area', (0, NICHE_DEEP / 2, 1),
           scale=(HALF_W + 0.1, HALF_D + NICHE_DEEP / 2 + 0.1, 1), label='Transporter room')
    # the feed's camera, looking along its +Y at the platform: turned towards it, then tilted down to it
    at, look = Vector(CAMERA), Vector(CAMERA_LOOK)
    d = look - at
    pitch = math.atan2(d.z, d.xy.length)
    f = Matrix.Translation(at) @ Matrix.Rotation(facing(at.xy, look.xy), 4, 'Z') @ Matrix.Rotation(pitch, 4, 'X')
    marker('feed camera', 'camera', frame=f, fov=CAMERA_FOV)
