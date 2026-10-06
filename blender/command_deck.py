"""The command deck: the bridge, with a turbolift behind it.

The bridge is a sixteen-sided room with its three forward sides flattened into one wall for the viewscreen. The
captain's chair sits in the middle of a ring of lighter carpet, flanked by two more; conn and ops face the viewscreen
ahead of it, and a low rail curves round behind it, open where the walkway comes in from the turbolift aft.
"""

import math

from mathutils import Matrix, Vector

from kit import (DOOR_H, HULL, LCARS, annulus, bezel, box, collide_footprint, collide_object, collide_path, cylinder, door,
                 marker, material, pane, panel, polygon, prism, readout, ring_points, rounded_rect, sign, sweep, toon,
                 unlit, walls)

APOTHEM = 7.5
HEIGHT = 4.0
WALL = 0.2
#: the sides kept, numbered anticlockwise from starboard in sixteenths of a turn; 3 and 5 make way for the viewscreen
SIDES = [0, 1, 2, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
#: a wall's cross-section, up the back, over the top and down the front: a header band, then the LCARS stripe over
#: the dado, as on the corridors (see Builder.wall)
PROFILE = [(-WALL, 0), (-WALL, HEIGHT), (0, HEIGHT), (0, 3.6), (0.08, 3.6), (0.08, 3.42), (0, 3.42), (0, 0.97),
           (0.07, 0.97), (0.07, 0.9), (0.05, 0.9), (0.05, 0)]
CARPET = '#3d4a82'
CUSHION = '#5c5470'
COMMAND_RED = '#a8434c'
CONSOLE_TOP = '#2b2735'


def angle(side):
    return side * math.pi / 8


def corner(a, b):
    """Where the inner faces of sides a and b meet."""
    ta, tb = angle(a), angle(b)
    det = math.cos(ta) * math.sin(tb) - math.sin(ta) * math.cos(tb)
    return (APOTHEM * (math.sin(tb) - math.sin(ta)) / det, APOTHEM * (math.cos(ta) - math.cos(tb)) / det)


#: corner i starts side SIDES[i], so edge i (corner i to i + 1) is that side
OUTLINE = [corner(SIDES[i - 1], SIDES[i]) for i in range(len(SIDES))]


def side_frame(side):
    """A Matrix at the middle of a side's inner face: X along the wall (anticlockwise), Y into the room, Z up."""
    i = SIDES.index(side)
    a, b = Vector(OUTLINE[i]), Vector(OUTLINE[(i + 1) % len(OUTLINE)])
    mid = (a + b) / 2
    return Matrix.Translation((mid.x, mid.y, 0)) @ Matrix.Rotation(angle(side) + math.pi / 2, 4, 'Z')


def side_length(side):
    i = SIDES.index(side)
    return (Vector(OUTLINE[(i + 1) % len(OUTLINE)]) - Vector(OUTLINE[i])).length


def build():
    shell()
    viewscreen()
    wall_dressing()
    command_well()
    forward_stations()
    rail()
    turbolift()
    marker('place bridge', 'place', (0, -5.8, 0), label='🌌 Bridge')
    marker('area bridge', 'area', (0, 0, 1), scale=(APOTHEM + 0.3, APOTHEM + 0.1, 1), label='Bridge')


def shell():
    bulkhead, frame = toon(HULL['bulkhead']), toon(HULL['frame'])
    mats = [bulkhead, bulkhead, bulkhead, frame, frame, frame, bulkhead, toon(HULL['stripe']), toon(HULL['stripe']),
            toon(HULL['dado']), toon(HULL['dado'])]
    aft = walls('bridge wall', OUTLINE, [(SIDES.index(12), 0.0, 2.0)], PROFILE, mats, lintel_from=DOOR_H + 0.1)[0]
    door('door turbolift', aft, 2.0)
    sign('sign turbolift', 'Turbolift', 1.4, LCARS['gold'], (0, 0.13, 2.82), aft, code='01-12')

    polygon('bridge floor', OUTLINE, 0, material(HULL['carpet'], surface='carpet', outline=False), uv_scale=0.5)
    polygon('bridge ceiling', OUTLINE, HEIGHT, unlit(HULL['ceiling']), down=True)
    annulus('ceiling light', 2.3, 2.6, HEIGHT - 0.02, unlit('#ffffff'), down=True)
    annulus('ceiling dome', 0, 2.3, HEIGHT - 0.02, unlit('#e9e4f0'), down=True)

    # a pilaster at every corner, hiding where the trims turn it
    for i, p in enumerate(OUTLINE):
        a, b = SIDES[i - 1], SIDES[i]
        inward = -(Vector((math.cos(angle(a)), math.sin(angle(a)))) + Vector((math.cos(angle(b)), math.sin(angle(b))))).normalized()
        box(f'pilaster {i}', (0.26, 0.24, HEIGHT), frame, (p[0], p[1], 0), math.atan2(inward.y, inward.x) - math.pi / 2, round=0.03)


def viewscreen():
    f = side_frame(4)
    bezel('viewscreen frame', 5.4, 2.0, 0.3, 0.15, 0.1, toon(HULL['frame']), (0, 0, 2.25), f)
    pane('viewscreen', [(x, z) for x, z in rounded_rect(5.4, 2.0, 0.3)], material('#000000', surface='space', outline=False), (0, 0.012, 2.25), f)


def wall_console(name, side, length, seed):
    """A standing console against a wall, its keys sloping up towards it, with readouts above."""
    f = side_frame(side)
    profile = [(0.6, 0), (0.6, 0.8), (0.14, 0.98), (0.02, 0.98), (0.02, 0)]
    bulkhead = toon(HULL['bulkhead'])
    prism(name, profile, length, [bulkhead, toon(CONSOLE_TOP), bulkhead, bulkhead, toon(HULL['dado'])], frame=f)
    collide_footprint(f, -length / 2, length / 2, 0.02, 0.62)
    keys_on_slope(f'{name} keys', length - 0.12, (0.6, 0.8), (0.14, 0.98), f)
    readout(f'{name} readout', length - 0.4, 0.9, seed, (0, 0, 1.5), f)


def keys_on_slope(name, width, front, back, frame):
    """An LCARS touch panel on a console's slope, from its front edge (y, z) up to its back edge."""
    up = Vector((0, back[0] - front[0], back[1] - front[1]))
    length = up.length
    up.normalize()
    tilt = math.atan2(-up.y, up.z)
    normal = Vector((0, math.cos(tilt), math.sin(tilt)))
    start = Vector((0, front[0], front[1])) + up * 0.04 + normal * 0.005
    return panel(name, width, length - 0.08, material('#000000', surface='keys', outline=False), tuple(start), frame, tilt=tilt)


def wall_dressing():
    for side, w, h, z, seed in [(0, 1.2, 1.6, 1.15, 11), (1, 1.8, 1.0, 1.5, 12), (7, 1.8, 1.0, 1.5, 13), (9, 1.8, 1.0, 1.5, 14),
                                (11, 1.0, 1.6, 1.15, 15), (13, 1.0, 1.6, 1.15, 16), (15, 1.8, 1.0, 1.5, 17)]:
        readout(f'readout {side}', w, h, seed, (0, 0, z), side_frame(side))
    sign('dedication plaque', 'U.S.S. Focus', 2.2, LCARS['gold'], (0, 0.025, 1.7), side_frame(8), sub='Crewed by Claude Code agents', code='NCC-4477')
    box('dedication plaque back', (2.3, 0.02, 0.53), toon(HULL['dado']), (0, 0.01, 1.65), frame=side_frame(8))
    wall_console('ops console', 2, 2.8, 21)
    wall_console('engineering console', 6, 2.8, 22)
    wall_console('tactical console', 10, 2.2, 23)
    wall_console('science console', 14, 2.2, 24)


def command_well():
    annulus('command ring', 2.9, 3.1, 0.008, material(HULL['carpetEdge'], outline=False), segments=64)
    annulus('command carpet', 0, 2.9, 0.008, material(CARPET, outline=False), segments=64)
    polygon('walkway', [(-0.8, -APOTHEM), (0.8, -APOTHEM), (0.8, -2.95), (-0.8, -2.95)], 0.003, material(HULL['carpetEdge'], outline=False))
    command_chair('captain', (0, -0.4), 0, COMMAND_RED, 1.0)
    command_chair('first officer', (1.4, -0.75), 0.15, CUSHION, 0.85)
    command_chair('counsellor', (-1.4, -0.75), -0.15, CUSHION, 0.85)


def command_chair(name, at, yaw, cushion, scale):
    """A big chair on a pedestal facing +Y, with LCARS keys set into its arms."""
    f = Matrix.Translation((at[0], at[1], 0)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Diagonal((scale, scale, scale, 1))
    frame, soft = toon(HULL['frame']), toon(cushion)
    cylinder(f'{name} chair base', 0.4, 0.06, toon(HULL['dado']), frame=f)
    cylinder(f'{name} chair column', 0.12, 0.32, frame, (0, 0, 0.06), frame=f)
    shell = box(f'{name} chair seat', (0.84, 0.8, 0.12), frame, (0, 0, 0.38), frame=f, round=0.04)
    box(f'{name} chair cushion', (0.7, 0.66, 0.1), soft, (0, 0.03, 0.5), frame=f, round=0.04)
    box(f'{name} chair back', (0.84, 0.16, 1.0), frame, (0, -0.36, 0.42), frame=f, round=0.05)
    box(f'{name} chair back cushion', (0.68, 0.06, 0.78), soft, (0, -0.26, 0.6), frame=f, round=0.03)
    for s in (-1, 1):
        box(f'{name} chair arm {s}', (0.14, 0.62, 0.1), frame, (s * 0.44, 0.02, 0.7), frame=f, round=0.03)
        box(f'{name} chair arm post {s}', (0.1, 0.12, 0.2), frame, (s * 0.44, 0.22, 0.5), frame=f)
        panel(f'{name} chair keys {s}', 0.09, 0.4, material('#000000', surface='keys', outline=False), (s * 0.44, 0.3, 0.804), f, tilt=math.pi / 2)
    collide_object(shell, pad=0.12 * scale)


def forward_stations():
    """Conn and ops: low consoles facing the viewscreen, each with a seat behind it."""
    profile = [(0.25, 0), (0.25, 0.55), (0.42, 0.74), (-0.12, 0.92), (-0.2, 0.86), (-0.2, 0)]
    dado, bulkhead, frame = toon(HULL['dado']), toon(HULL['bulkhead']), toon(HULL['frame'])
    for name, x, seed in (('conn', -1.5, 31), ('ops', 1.5, 32)):
        # built with whoever sits at it on its +Y side, then turned to face the viewscreen
        f = Matrix.Translation((x, 3.3, 0)) @ Matrix.Rotation(math.pi, 4, 'Z')
        body = prism(f'{name} console', profile, 1.2, [bulkhead, dado, toon(CONSOLE_TOP), bulkhead, bulkhead, dado], frame=f, round=0.02)
        collide_object(body)
        keys_on_slope(f'{name} keys', 1.08, (0.42, 0.74), (-0.12, 0.92), f)
        box(f'{name} display', (0.8, 0.06, 0.42), frame, (0, -0.16, 0.88), frame=f, round=0.015)
        panel(f'{name} display screen', 0.72, 0.34, material('#000000', surface='readout', outline=False, seed=seed, w=0.72, h=0.34), (0, -0.125, 0.92), f)
        seat = Matrix.Translation((x, 2.55, 0))
        cylinder(f'{name} seat base', 0.24, 0.05, dado, frame=seat)
        cylinder(f'{name} seat column', 0.07, 0.36, frame, (0, 0, 0.05), frame=seat)
        cushion = cylinder(f'{name} seat', 0.28, 0.08, toon(CUSHION), (0, 0, 0.41), frame=seat)
        box(f'{name} seat back', (0.5, 0.07, 0.45), frame, (0, -0.25, 0.5), frame=seat, round=0.03)
        collide_object(cushion)


def rail():
    """A low rail round the back of the command well, open in the middle for the walkway from the turbolift."""
    frame, top = toon(HULL['frame']), toon('#6b6385')
    profile = [(-0.07, 0), (-0.07, 0.9), (-0.1, 0.9), (-0.1, 1.0), (0.1, 1.0), (0.1, 0.9), (0.07, 0.9), (0.07, 0)]
    for name, start, end in (('port', 195, 252), ('starboard', 288, 345)):
        path = ring_points(0, 0, 3.5, 8, math.radians(start), math.radians(end))
        sweep(f'rail {name}', path, profile, [frame, top, top, top, top, top, frame], caps=True)
        collide_path(path, 0.12, 0.12)


def turbolift():
    """A round car behind the aft door: a light band near the top, a grab rail round the back, the deck panel."""
    cy, r, h = -APOTHEM - WALL - 1.2, 1.2, 3.0
    arc = ring_points(0, cy, r, 7, math.pi, 2 * math.pi)
    path = [(-r, -APOTHEM - WALL)] + arc + [(r, -APOTHEM - WALL)]
    wall, frame = toon('#a39bb8'), toon(HULL['frame'])
    profile = [(-0.1, 0), (-0.1, h), (0, h), (0, 2.62), (0.03, 2.62), (0.03, 2.48), (0, 2.48), (0, 0)]
    sweep('turbolift wall', path, profile, [wall, wall, wall, frame, unlit('#fff4e0'), frame, wall])
    collide_path(path, 0.12, 0.12)
    floor = [(-r, -APOTHEM)] + arc + [(r, -APOTHEM)]
    polygon('turbolift floor', floor, 0, material('#3a3450', outline=False))
    polygon('turbolift ceiling', floor, h, unlit(HULL['ceiling']), down=True)
    annulus('turbolift light', 0, 0.6, h - 0.015, unlit('#ffffff'), at=(0, cy), down=True)
    sweep('turbolift rail', arc, [(0.06, 0.95), (0.06, 1.0), (0.1, 1.0), (0.1, 0.95)], [frame, frame, frame], caps=True)
    back = Matrix.Translation((0, cy - r * math.cos(math.pi / 14), 0))
    readout('turbolift panel', 0.5, 0.7, 41, (0, 0, 1.3), back)
    marker('area turbolift', 'area', (0, cy, 1), scale=(r + 0.1, r + 0.1, 1), label='Turbolift')
