"""Main engineering, on deck 5: a gallery round a well, with the warp core rising through it from the level below.

You step out of the turbolift in the forward wall onto the gallery, an octagon with its corners cut. The well in its
floor is an oval behind a gold railing, and the warp core stands in it on the lower level, four metres down, and rises
past the gallery and on up through the ceiling. The player walks only on the gallery (the browser's player keeps to
one floor height), so the lower level is somewhere to look down into: a ring of consoles round the core's base, and
readouts on its walls. To starboard (on your left as you step out, looking aft at the core), the master systems table
stands in front of the MSD on the wall, where the captain reviews the ledger; to port, the chief engineer's station.

The core's glow is the browser's (its 'warp-core' surfaces pulse), and so is the MSD (a 'screen' it draws).
"""

import math

import bmesh
from mathutils import Matrix, Vector

from kit import (CONSOLE_TOP, DOOR_H, HULL, LCARS, annulus, bezel, box, collide_object, collide_path, cylinder, door,
                 facing, interact, link, marker, material, mesh_object, panel, polygon, readout, rounded_rect, sign,
                 slab, sweep, toon, turbolift_car, unlit, walls)

WALL = 0.2
#: the gallery's ceiling, over its floor at 0
HEIGHT = 4.5
#: the lower level's floor, and the gallery floor's underside
BELOW = -4.0
SLAB = -0.4
LIFT_DOOR = 2.0
#: the gallery's walls' inner faces, counter-clockwise from above: the turbolift in the forward wall (edge 3), the MSD on
#: the starboard wall (edge 1), the aft corners cut back behind the core and the forward ones beside the lift
OUTLINE = [(3.0, -6.0), (7.0, -2.5), (7.0, 3.8), (4.6, 6.0), (-4.6, 6.0), (-7.0, 3.8), (-7.0, -2.5), (-3.0, -6.0)]
FORWARD, PORT, STARBOARD, AFT = 3, 5, 1, 7
#: the well: an oval in the gallery floor round the core
WELL = (0.0, -1.4)
WELL_R = (3.0, 2.4)
CORE_R = 0.85
#: how far out from the well's edge the railing stands
RAIL = 0.12
#: the master systems table, to starboard: its centre and size (across, fore and aft)
TABLE = (4.7, 1.6)
TABLE_SIZE = (1.3, 3.0)
#: where the chief engineer sits, to port, facing the wall
ENGINEER = (-4.7, -0.2)
FLOOR = '#34406c'
WALKWAY = '#4a5a94'
LOWER_FLOOR = '#262a48'
GLOW = '#8fe3ff'
GOLD = '#e8b84a'


def profile(height):
    """A gallery wall's cross-section, up the back, over the top and down the front: a header band, then the LCARS
    stripe over the dado, as on the bridge."""
    return [(-WALL, 0), (-WALL, height), (0, height), (0, height - 0.4), (0.08, height - 0.4), (0.08, height - 0.58),
            (0, height - 0.58), (0, 0.97), (0.07, 0.97), (0.07, 0.9), (0.05, 0.9), (0.05, 0)]


def wall_materials():
    bulkhead, frame = toon(HULL['bulkhead']), toon(HULL['frame'])
    return [bulkhead, bulkhead, bulkhead, frame, frame, frame, bulkhead, toon(HULL['stripe']), toon(HULL['stripe']),
            toon(HULL['dado']), toon(HULL['dado'])]


def lower_profile():
    """The lower level's walls, from its floor up to the gallery floor's underside: darker, with a stripe over a dado."""
    return [(-WALL, BELOW), (-WALL, SLAB), (0, SLAB), (0, BELOW + 0.97), (0.07, BELOW + 0.97), (0.07, BELOW + 0.9),
            (0.05, BELOW + 0.9), (0.05, BELOW)]


def lower_materials():
    wall, stripe, dado = toon('#5a5280'), toon(HULL['stripe']), toon(HULL['dado'])
    return [wall, wall, wall, stripe, stripe, dado, dado]


def edge_frame(i):
    """A Matrix at the middle of edge i's inner face: X along the wall (anticlockwise), Y into the room, Z up."""
    a, b = Vector(OUTLINE[i]), Vector(OUTLINE[(i + 1) % len(OUTLINE)])
    mid, along = (a + b) / 2, (b - a).normalized()
    return Matrix.Translation((mid.x, mid.y, 0)) @ Matrix.Rotation(math.atan2(along.y, along.x), 4, 'Z')


def edge_length(i):
    return (Vector(OUTLINE[(i + 1) % len(OUTLINE)]) - Vector(OUTLINE[i])).length


def oval(grow=0.0, segments=64):
    """The well's edge (or an oval `grow` metres out from it), counter-clockwise."""
    (cx, cy), (rx, ry) = WELL, WELL_R
    return [(cx + (rx + grow) * math.cos(2 * math.pi * i / segments), cy + (ry + grow) * math.sin(2 * math.pi * i / segments))
            for i in range(segments)]


def floor_round_well(name, z, mat, down=False, uv_scale=None):
    """The deck's outline at height z with the well cut out of it, facing up (or down)."""
    bm = bmesh.new()
    for loop in (OUTLINE, oval()):
        verts = [bm.verts.new((x, y, z)) for x, y in loop]
        for i in range(len(verts)):
            bm.edges.new((verts[i], verts[(i + 1) % len(verts)]))
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=bm.edges[:])
    for f in bm.faces:
        f.normal_update()
        if (f.normal.z < 0) != down:
            f.normal_flip()
    if uv_scale:
        uv = bm.loops.layers.uv.new()
        for f in bm.faces:
            for loop in f.loops:
                loop[uv].uv = (loop.vert.co.x * uv_scale, loop.vert.co.y * uv_scale)
    return link(mesh_object(name, bm, [mat]))


def build():
    lift = shell()
    well()
    core()
    lower_level()
    table()
    msd()
    dressing()
    turbolift_car(lift, 'Deck 5 · Engineering', wall=WALL)
    marker('engineer', 'seat', (*ENGINEER, 0), yaw=facing(ENGINEER, (-7.0, ENGINEER[1] - 0.6)), crew='engineer')
    place = (0.0, 4.4)
    marker('place engineering', 'place', (*place, 0), yaw=facing(place, WELL), label='🔧 Engineering')
    marker('area engineering', 'area', (0, 0, 1), scale=(7.1, 6.1, 1), label='Engineering')


def shell():
    """The gallery's walls, floor and ceiling, and the lower level's walls under them; returns the turbolift's doorway."""
    lift, = walls('gallery wall', OUTLINE, [(FORWARD, 0.0, LIFT_DOOR)], profile(HEIGHT), wall_materials(), lintel_from=DOOR_H + 0.1)
    door('door turbolift', lift, LIFT_DOOR)
    sign('sign turbolift', 'Turbolift', 1.4, LCARS['gold'], (0, 0.13, 2.82), lift, code='05-01')
    # swept without colliders: walls() would lay them along the whole outline, across the turbolift's doorway up on
    # the gallery, and no one walks down there
    sweep('lower wall', OUTLINE, lower_profile(), lower_materials(), closed=True)

    floor_round_well('gallery floor', 0, material(FLOOR, surface='carpet'), uv_scale=0.5)
    floor_round_well('gallery underside', SLAB, toon('#3a3456'), down=True)
    # a lighter walkway from the turbolift to the railing, lifted clear of the carpet
    polygon('walkway', [(-1.0, 1.25), (1.0, 1.25), (1.0, 6.0), (-1.0, 6.0)], 0.01, material(WALKWAY, surface='carpet'), uv_scale=0.5)

    polygon('ceiling', OUTLINE, HEIGHT, unlit(HULL['ceiling']), down=True)
    for x in (-5.0, 5.0):
        polygon(f'ceiling light {x:.0f}', [(x + px, 0.6 + py) for px, py in rounded_rect(1.0, 4.4, 0.3)], HEIGHT - 0.02,
                unlit('#ffffff'), down=True)

    # a rib at every corner, from the lower level's floor to the gallery's ceiling, hiding where the trims turn
    frame = toon(HULL['frame'])
    n = len(OUTLINE)
    for i, p in enumerate(OUTLINE):
        a, b, c = Vector(OUTLINE[i - 1]), Vector(p), Vector(OUTLINE[(i + 1) % n])
        # the walls' left, into the room, either side of the corner
        inward = sum((Vector((-d.y, d.x)) for d in ((b - a).normalized(), (c - b).normalized())), Vector((0, 0))).normalized()
        yaw = math.atan2(inward.y, inward.x) - math.pi / 2
        box(f'rib {i}', (0.3, 0.26, HEIGHT - BELOW), frame, (p[0], p[1], BELOW), yaw, round=0.03)
    return lift


def well():
    """The well's edge, the gold railing round it and the colliders that keep you out of it."""
    edge = oval()
    # the gallery floor's edge, facing into the well: a gold lip over a fascia down to its underside
    sweep('well fascia', edge, [(0, 0), (0, -0.06), (0, SLAB)], [toon(GOLD), toon('#4c4562')], closed=True)
    # posts, a top rail and a kick plate, RAIL out from the edge
    frame, gold = toon(HULL['frame']), toon(GOLD)
    d0, d1 = -RAIL - 0.07, -RAIL + 0.0
    sweep('rail top', edge, [(d0, 1.0), (d0, 1.07), (d1, 1.07), (d1, 1.0), (d0, 1.0)], [gold] * 4, closed=True)
    sweep('rail kick', edge, [(d0, -0.01), (d0, 0.12), (d1, 0.12), (d1, -0.01)], [frame] * 3, closed=True)
    for i, (x, y) in enumerate(oval(RAIL + 0.035, segments=14)):
        box(f'rail post {i}', (0.05, 0.05, 1.0), frame, (x, y, 0.0))
    # from just behind the railing to well inside the edge: the well's a chain of boxes round its oval
    collide_path(edge, 0.9, RAIL + 0.25, closed=True)


def core():
    """
    The warp core: a column from a plinth on the lower level up through the gallery's ceiling, the intermix chamber
    about the gallery's eye level, gold bands and the collar where it passes through the ceiling. Its glowing parts are
    'warp-core' surfaces, which the browser pulses.
    """
    cx, cy = WELL
    frame, gold = toon(HULL['frame']), toon(GOLD)
    cylinder('core plinth', 1.4, 0.55, frame, at=(cx, cy, BELOW - 0.01), segments=32)
    cylinder('core plinth step', 1.7, 0.2, toon(HULL['dado']), at=(cx, cy, BELOW - 0.01), segments=32)
    cylinder('core column', CORE_R, HEIGHT + 0.3 - (BELOW + 0.5), material(GLOW, surface='warp-core', part='column'),
             at=(cx, cy, BELOW + 0.5), segments=32)
    cylinder('core chamber', 1.15, 1.3, material(GLOW, surface='warp-core', part='chamber'), at=(cx, cy, 0.95), segments=32)
    for name, z in (('core chamber foot', 0.8), ('core chamber head', 2.2)):
        cylinder(name, 1.3, 0.2, frame, at=(cx, cy, z), segments=32)
    for i, z in enumerate((BELOW + 1.4, BELOW + 2.6, -0.9, 3.0, 3.7)):
        cylinder(f'core band {i}', CORE_R + 0.06, 0.09, gold, at=(cx, cy, z), segments=32)
    cylinder('core collar', 1.35, 0.4, frame, at=(cx, cy, HEIGHT - 0.35), segments=32)
    annulus('core collar light', 1.35, 1.75, HEIGHT - 0.02, unlit('#bfeaff'), at=(cx, cy), down=True)


def lower_level():
    """What you see over the railing: the lower level's floor, a glow round the core's base, consoles round it, and
    readouts on its walls."""
    polygon('lower floor', OUTLINE, BELOW, material(LOWER_FLOOR, surface='carpet'), uv_scale=0.5)
    cx, cy = WELL
    annulus('lower glow', 1.75, 2.05, BELOW + 0.01, unlit(GLOW), at=(cx, cy))
    bulkhead, top = toon(HULL['bulkhead']), toon(CONSOLE_TOP)
    for i, (a0, a1) in enumerate(((0.35, 2.8), (3.5, 5.95))):
        arc = [(cx + 2.9 * math.cos(a0 + (a1 - a0) * k / 12), cy + 2.9 * math.sin(a0 + (a1 - a0) * k / 12)) for k in range(13)]
        sweep(f'lower console {i}', arc, [(-0.3, BELOW - 0.01), (-0.3, BELOW + 1.05), (0.3, BELOW + 0.88), (0.3, BELOW - 0.01)],
              [bulkhead, top, bulkhead], caps=True)
    for i in range(len(OUTLINE)):
        if i == FORWARD:
            continue
        w = min(2.0, edge_length(i) - 1.2)
        readout(f'lower readout {i}', w, 0.8, 70 + i, (0, 0, BELOW + 1.6), edge_frame(i))


def table():
    """The master systems table: a rounded console with an LCARS display across its top, where E reviews the ledger
    (the retro is at the engineer's station)."""
    (tx, ty), (w, d) = TABLE, TABLE_SIZE
    outline = [(tx + x, ty + y) for x, y in rounded_rect(w, d, 0.45)]
    inset = [(tx + x, ty + y) for x, y in rounded_rect(w - 0.25, d - 0.25, 0.35)]
    body = slab('table body', inset, 0, 0.82, toon(HULL['dado']))
    top = slab('table top', outline, 0.82, 0.94, toon(HULL['frame']), round=0.03)
    shown = panel('table display', d - 0.5, w - 0.4, material('#000000', surface='readout', seed=61, w=d - 0.5, h=w - 0.4),
                  (tx - (w - 0.4) / 2, ty, 0.943), yaw=math.pi / 2, tilt=math.pi / 2)
    interact('ledger', 'Review the ledger', body, top, shown)
    collide_object(top)


def msd():
    """The master systems display on the starboard wall: a cutaway of the ship, which the browser draws."""
    f = edge_frame(STARBOARD)
    w, h, z = 5.2, 2.0, 2.35
    bezel('msd frame', w, h, 0.12, 0.12, 0.08, toon(HULL['frame']), (0, 0, z), f)
    panel('msd', w, h, material('#000000', surface='screen', screen='msd'), (0, 0.012, z - h / 2), f)


def dressing():
    """Readouts round the gallery and behind the core, Main Engineering's sign where the core doesn't hide it from the
    turbolift, and readouts over the engineer's station."""
    sign('sign engineering', 'Main Engineering', 2.6, LCARS['gold'], (0, 0.03, 3.3), edge_frame(6), code='05-07')
    for i, seed in ((0, 62), (6, 63)):
        readout(f'readout {i}', 2.2, 1.1, seed, (0, 0, 1.55), edge_frame(i))
    for x, seed in ((-1.9, 68), (1.9, 69)):
        readout(f'aft readout {seed}', 1.4, 0.9, seed, (x, 0, 1.6), edge_frame(AFT))
    for i, seed in ((2, 64), (4, 65)):
        readout(f'readout {i}', 1.4, 0.9, seed, (0, 0, 1.6), edge_frame(i))
    # over the engineer's station, and further forward
    # the port wall runs aft, so its X is aft too
    f = edge_frame(PORT)
    mid = (OUTLINE[PORT][1] + OUTLINE[PORT + 1][1]) / 2
    readout('engineer readout', 1.8, 0.9, 66, (mid - ENGINEER[1], 0, 1.6), f)
    readout('port readout', 1.4, 0.9, 67, (-2.4, 0, 1.6), f)
