"""The command deck: the bridge, with a turbolift behind it, the ready room off its starboard side and the observation
lounge off its port side.

The bridge is a sixteen-sided room with its three forward sides flattened into one wall for the viewscreen. The
captain's chair sits in the middle of a ring of lighter carpet, flanked by two more; conn and ops face the viewscreen
ahead of it, and a low rail curves round behind it, open where the walkway comes in from the turbolift aft.

The ready room and the lounge are rectangles whose walls stand back to back with the bridge's, so one doorway passes
through both and its doors are the bridge's.
"""

import math

from mathutils import Matrix, Vector

from kit import (DOOR_H, FRAME_PROUD, HULL, LCARS, annulus, bezel, box, collide_footprint, collide_object, collide_path,
                 cylinder, door, facing, interact, marker, material, pane, panel, polygon, prism, readout, ring_points,
                 rounded_rect, sign, slab, sweep, toon, turbolift_car, unlit, walls, window)

APOTHEM = 7.5
HEIGHT = 4.0
WALL = 0.2
DOORWAY = 2.0
#: the sides kept, numbered anticlockwise from starboard in sixteenths of a turn; 3 and 5 make way for the viewscreen
SIDES = [0, 1, 2, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
CARPET = '#3d4a82'
CUSHION = '#5c5470'
COMMAND_RED = '#a8434c'
CONSOLE_TOP = '#2b2735'
UPHOLSTERY = '#7b2d43'
#: the ready room and the lounge: their ceilings, how far they reach fore and aft of the beam, and where their walls
#: stand, back to back with the bridge's
ROOM_HEIGHT = 3.4
ROOM_HALF = 3.5
ROOM_NEAR = APOTHEM + 2 * WALL


def profile(height):
    """A wall's cross-section, up the back, over the top and down the front: a header band, then the LCARS stripe over
    the dado, as on the corridors (see Builder.wall)."""
    return [(-WALL, 0), (-WALL, height), (0, height), (0, height - 0.4), (0.08, height - 0.4), (0.08, height - 0.58),
            (0, height - 0.58), (0, 0.97), (0.07, 0.97), (0.07, 0.9), (0.05, 0.9), (0.05, 0)]


def wall_materials():
    """A material for each edge of a wall's profile."""
    bulkhead, frame = toon(HULL['bulkhead']), toon(HULL['frame'])
    return [bulkhead, bulkhead, bulkhead, frame, frame, frame, bulkhead, toon(HULL['stripe']), toon(HULL['stripe']),
            toon(HULL['dado']), toon(HULL['dado'])]


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
    aft = shell()
    viewscreen()
    wall_dressing()
    command_well()
    forward_stations()
    rail()
    turbolift_car(aft, 'Deck 1 · Bridge', wall=WALL)
    ready_room()
    lounge()
    marker('place bridge', 'place', (0, -5.8, 0), label='🌌 Bridge')
    marker('area bridge', 'area', (0, 0, 1), scale=(APOTHEM + 0.3, APOTHEM + 0.1, 1), label='Bridge')


def shell():
    """The bridge's walls, floor and ceiling, its doors and their signs; returns the turbolift's doorway, aft."""
    frame = toon(HULL['frame'])
    starboard, port, aft = walls('bridge wall', OUTLINE, [(SIDES.index(side), 0.0, DOORWAY) for side in (0, 8, 12)],
                                 profile(HEIGHT), wall_materials(), lintel_from=DOOR_H + 0.1)
    door('door turbolift', aft, DOORWAY)
    sign('sign turbolift', 'Turbolift', 1.4, LCARS['gold'], (0, 0.13, 2.82), aft, code='01-12')
    for name, f, text, color, code in (('ready room', starboard, 'Ready room', LCARS['red'], '01-00'),
                                       ('lounge', port, 'Observation lounge', LCARS['lilac'], '01-08')):
        door(f'door {name}', f, DOORWAY, wall=2 * WALL, back=FRAME_PROUD)
        sign(f'sign {name}', text, 1.6, color, (0, 0.13, 2.82), f, code=code)

    polygon('bridge floor', OUTLINE, 0, material(HULL['carpet'], surface='carpet', outline=False), uv_scale=0.5)
    polygon('bridge ceiling', OUTLINE, HEIGHT, unlit(HULL['ceiling']), down=True)
    annulus('ceiling light', 2.3, 2.6, HEIGHT - 0.02, unlit('#ffffff'), down=True)
    annulus('ceiling dome', 0, 2.3, HEIGHT - 0.02, unlit('#e9e4f0'), down=True)

    # a pilaster at every corner, hiding where the trims turn it
    for i, p in enumerate(OUTLINE):
        a, b = SIDES[i - 1], SIDES[i]
        inward = -(Vector((math.cos(angle(a)), math.sin(angle(a)))) + Vector((math.cos(angle(b)), math.sin(angle(b))))).normalized()
        box(f'pilaster {i}', (0.26, 0.24, HEIGHT), frame, (p[0], p[1], 0), math.atan2(inward.y, inward.x) - math.pi / 2, round=0.03)
    return aft


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
    for side, w, h, z, seed in [(1, 1.8, 1.0, 1.5, 12), (7, 1.8, 1.0, 1.5, 13), (11, 1.0, 1.6, 1.15, 15), (13, 1.0, 1.6, 1.15, 16),
                                (15, 1.8, 1.0, 1.5, 17)]:
        readout(f'readout {side}', w, h, seed, (0, 0, z), side_frame(side))
    sign('dedication plaque', 'U.S.S. Focus', 2.2, LCARS['gold'], (0, 0.025, 1.7), side_frame(9), sub='Crewed by Claude Code agents', code='NCC-4477')
    box('dedication plaque back', (2.3, 0.02, 0.53), toon(HULL['dado']), (0, 0.01, 1.65), frame=side_frame(9))
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


def side_room(name, near, far, carpet):
    """
    A room off the bridge's starboard or port side, from its wall at x = `near`, back to back with the bridge's, out to
    `far`: walls with a gap for the bridge's doorway, carpet reaching through it to the bridge's own, and a ceiling.
    """
    lo, hi = sorted((near, far))
    outline = [(lo, -ROOM_HALF), (hi, -ROOM_HALF), (hi, ROOM_HALF), (lo, ROOM_HALF)]
    walls(f'{name} wall', outline, [(3 if near == lo else 1, 0.0, DOORWAY)], profile(ROOM_HEIGHT), wall_materials(),
          lintel_from=DOOR_H + 0.1)
    a, b = sorted((math.copysign(APOTHEM, near), far))
    polygon(f'{name} floor', [(a, -ROOM_HALF), (b, -ROOM_HALF), (b, ROOM_HALF), (a, ROOM_HALF)], 0,
            material(carpet, surface='carpet', outline=False), uv_scale=0.5)
    polygon(f'{name} ceiling', outline, ROOM_HEIGHT, unlit(HULL['ceiling']), down=True)


def ceiling_light(name, w, h, at):
    polygon(name, [(at[0] + x, at[1] + y) for x, y in rounded_rect(w, h, min(w, h) * 0.3)], ROOM_HEIGHT - 0.02,
            unlit('#ffffff'), down=True)


def wall_frame(x, y, yaw):
    """A Matrix on a side room's wall at (x, y), turned `yaw` so its +Y faces into the room."""
    return Matrix.Translation((x, y, 0)) @ Matrix.Rotation(yaw, 4, 'Z')


def screen(name, w, h, kind, at, frame):
    """A w×h screen in a rounded bezel on a wall, centred `at` (across, height) on `frame`, showing `kind`: a surface
    the browser draws."""
    bezel(f'{name} frame', w, h, 0.1, 0.1, 0.08, toon(HULL['frame']), (at[0], 0, at[1]), frame)
    return panel(name, w, h, material('#000000', outline=False, **kind), (at[0], 0.012, at[1] - h / 2), frame)


def ready_room():
    """
    The captain's: a desk at the far end facing the door, under a window onto space, with the captain's console on it
    and Number One's chair at its corner; mission control on the forward wall and a couch along the aft one.
    """
    near, far = ROOM_NEAR, ROOM_NEAR + 8
    mid = (near + far) / 2
    side_room('ready room', near, far, '#6e3043')
    window('ready room window', 3.0, 1.2, (0, 1.8), wall_frame(far, 0, math.pi / 2))

    desk_x, chair_at = far - 2.0, (far - 0.9, 0)
    top = slab('ready room desk', [(desk_x + x, y) for x, y in rounded_rect(1.1, 2.8, 0.15)], 0.7, 0.76, toon(CONSOLE_TOP), round=0.01)
    box('ready room desk base', (0.6, 2.3, 0.7), toon(HULL['dado']), (desk_x - 0.15, 0, 0), round=0.02)
    collide_object(top)
    command_chair('ready room', chair_at, math.pi / 2, COMMAND_RED, 0.85)
    captains_console(Matrix.Translation((desk_x - 0.25, 0, 0.76)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z'))
    seat = (desk_x - 1.4, 1.9)
    marker('number one', 'seat', (seat[0], seat[1], 0.005), yaw=facing(seat, chair_at), crew='number-one')

    mission = screen('mission control', 2.6, 2.6 * 9 / 16, {'surface': 'screen', 'screen': 'mission-control'}, (0, 1.9),
                     wall_frame(mid - 0.8, ROOM_HALF, math.pi))
    interact('manager', 'Open mission control', mission)
    couch('ready room couch', (mid - 1.2, -ROOM_HALF + 0.5), 0, 2.4)
    for y, seed in ((2.4, 51), (-2.4, 52)):
        readout(f'ready room readout {seed}', 0.8, 1.1, seed, (0, 0, 1.3), wall_frame(near, y, -math.pi / 2))
    for x in (mid - 2, mid + 2):
        ceiling_light(f'ready room light {x:.0f}', 2.0, 1.0, (x, 0))
    place = (near + 1.2, -0.8)
    marker('place ready room', 'place', (*place, 0), yaw=facing(place, (desk_x, 0.6)), label='🎖️ Ready room')
    marker('area ready room', 'area', (mid, 0, 1), scale=((far - near) / 2 + 0.1, ROOM_HALF + 0.1, 1), label='Ready room')


def captains_console(f):
    """A monitor on the desk, built facing +Y (the captain) with its back to whoever comes in, showing mission control."""
    frame = toon(HULL['frame'])
    cylinder('captain console foot', 0.16, 0.02, frame, frame=f)
    cylinder('captain console stand', 0.04, 0.2, frame, (0, 0, 0.02), frame=f)
    body = box('captain console', (1.0, 0.06, 0.62), frame, (0, 0, 0.18), frame=f, round=0.015)
    front = panel('captain console screen', 0.92, 0.92 * 9 / 16, material('#000000', surface='screen', outline=False, screen='mission-control'),
                  (0, 0.035, 0.23), f)
    back = sign('captain console back', 'Captain’s console', 0.92, LCARS['gold'], (0, -0.035, 0.4), f, yaw=math.pi,
                sub='Walk round and press E')
    interact('manager', 'Use the ready room console', body, front, back)


def couch(name, at, yaw, length):
    """A couch facing +Y with its back to a wall."""
    f = wall_frame(at[0], at[1], yaw)
    soft, frame = toon('#6b5b8a'), toon(HULL['frame'])
    base = box(f'{name} base', (length, 0.8, 0.3), toon(HULL['dado']), frame=f, round=0.03)
    box(f'{name} cushion', (length - 0.36, 0.62, 0.14), soft, (0, 0.06, 0.3), frame=f, round=0.05)
    box(f'{name} back', (length, 0.2, 0.6), frame, (0, -0.3, 0.3), frame=f, round=0.04)
    box(f'{name} back cushion', (length - 0.36, 0.1, 0.42), soft, (0, -0.16, 0.44), frame=f, round=0.04)
    for s in (-1, 1):
        box(f'{name} arm {s}', (0.18, 0.6, 0.3), frame, (s * (length / 2 - 0.09), 0.1, 0.3), frame=f, round=0.04)
    collide_object(base)


def lounge():
    """The observation lounge: a long table running from the door to a star chart on the far wall, beside a row of
    viewports along the aft wall."""
    near, far = -ROOM_NEAR, -(ROOM_NEAR + 10)
    mid = (near + far) / 2
    side_room('lounge', near, far, '#3b3f5c')
    polygon('lounge rug', [(mid + x, y) for x, y in rounded_rect(7.6, 4.1, 0.6)], 0.008, material('#4a4e74', outline=False))

    length, width = 5.2, 1.5
    top = slab('lounge table', [(mid + x, y) for x, y in rounded_rect(length, width, width / 2 - 0.02, segments=8)], 0.72, 0.79, toon('#2b2d42'))
    for s in (-1, 1):
        box(f'lounge table pedestal {s}', (0.5, 0.5, 0.72), toon('#495057'), (mid + s * 1.23, 0, 0))
    polygon('lounge table strip', [(mid + x, y) for x, y in rounded_rect(2.96, 0.12, 0.05)], 0.795, unlit(LCARS['lilac']))
    collide_object(top)
    for i, dx in enumerate((-1.9, 0, 1.9)):
        lounge_chair(f'lounge chair fore {i}', (mid + dx, width / 2 + 0.45), math.pi)
        lounge_chair(f'lounge chair aft {i}', (mid + dx, -width / 2 - 0.45), 0)
    lounge_chair('lounge chair port', (mid - length / 2 - 0.5, 0), -math.pi / 2)
    lounge_chair('lounge chair starboard', (mid + length / 2 + 0.5, 0), math.pi / 2)

    screen('star chart', 2.6, 1.56, {'surface': 'star-chart'}, (0, 1.92), wall_frame(far, 0, -math.pi / 2))
    for i, dx in enumerate((-2.9, 0, 2.9)):
        window(f'lounge window {i}', 2.4, 1.4, (0, 1.85), wall_frame(mid + dx, -ROOM_HALF, 0))
    for i, dx in enumerate((-2.4, 2.4)):
        readout(f'lounge readout {i}', 1.8, 1.0, 61 + i, (0, 0, 1.5), wall_frame(mid + dx, ROOM_HALF, math.pi))
    ceiling_light('lounge light', 5.0, 1.0, (mid, 0))
    place = (near - 1.0, -1.3)
    marker('place lounge', 'place', (*place, 0), yaw=facing(place, (mid - 1.0, 0.3)), label='🖖 Observation lounge')
    marker('area lounge', 'area', (mid, 0, 1), scale=((near - far) / 2 + 0.1, ROOM_HALF + 0.1, 1), label='Observation lounge')


def lounge_chair(name, at, yaw):
    """A high-backed chair on a pedestal facing +Y."""
    f = wall_frame(at[0], at[1], yaw)
    soft = toon(UPHOLSTERY)
    cylinder(f'{name} base', 0.24, 0.04, toon(HULL['dado']), frame=f)
    cylinder(f'{name} column', 0.05, 0.36, toon(HULL['frame']), (0, 0, 0.04), frame=f)
    box(f'{name} seat', (0.5, 0.5, 0.1), soft, (0, 0, 0.4), frame=f, round=0.03)
    box(f'{name} back', (0.46, 0.08, 0.72), soft, (0, -0.24, 0.48), frame=f, round=0.03)
