"""Stellar cartography: a dark sphere you walk out into along a gantry, where every goal is drawn round you as a star.

You step out of the turbolift into a short vestibule, and through its mouth onto a gantry that runs out over the void
to a round platform in the middle of the sphere, with the cartography console at its far edge. The sphere is the
screen: the browser draws the stars, the spiral of goals and the grid on its inside (world/cartography.ts), and from
the console (or F anywhere in here) you take flight through it. The player walks only on the gantry and the platform
(they keep to one floor height), so railings and colliders keep them out of the void until they fly.
"""

import math

import bmesh
from mathutils import Matrix

from kit import (DOOR_H, HULL, LCARS, annulus, box, bridge_console, collide_path, door_frame, facing, interact, link, marker,
                 material, mesh_object, polygon, ring_points, sign, slab, sweep, toon, turbolift_car, unlit, walls)

WALL = 0.2
#: the sphere: its centre at eye height over the platform, so standing in the middle you're in the middle of it
CENTRE = (0.0, 0.0, 1.6)
RADIUS = 12.0
#: the vestibule between the turbolift and the gantry: across, from the turbolift's wall to its mouth, and its height
VESTIBULE = (1.8, -15.0, -11.0)
HEIGHT = 3.2
GANTRY = 1.0
PLATFORM = 3.0
#: how far the gantry's deck runs under the platform's, a little lower so they never share a plane
UNDER = 0.005
FLOOR = '#3a4070'
WALKWAY = '#4a5a94'
GLOW = '#7ad0ff'
GOLD = '#e8b84a'
VOID = '#04060f'


def build():
    lift = vestibule()
    sphere()
    gantry()
    platform()
    turbolift_car(lift, 'Stellar Cartography', wall=WALL)
    place = (0.0, -1.5)
    marker('place cartography', 'place', (*place, 0), yaw=facing(place, (0.0, 6.0)), label='🌌 Stellar Cartography')
    # the whole sphere, and the vestibule
    marker('area cartography', 'area', (0, (VESTIBULE[1] + RADIUS) / 2, 1), scale=(RADIUS, (RADIUS - VESTIBULE[1]) / 2, 1),
           label='Stellar Cartography')


def profile(height):
    """The vestibule's walls, as main engineering's: a header band, then the LCARS stripe over the dado."""
    return [(-WALL, 0), (-WALL, height), (0, height), (0, height - 0.4), (0.08, height - 0.4), (0.08, height - 0.58),
            (0, height - 0.58), (0, 0.97), (0.07, 0.97), (0.07, 0.9), (0.05, 0.9), (0.05, 0)]


def wall_materials():
    bulkhead, frame, stripe, dado = toon(HULL['bulkhead']), toon(HULL['frame']), toon(HULL['stripe']), toon(HULL['dado'])
    return [bulkhead, bulkhead, bulkhead, frame, frame, frame, bulkhead, stripe, stripe, dado, dado]


def vestibule():
    """The vestibule's walls, floor and ceiling, a doorway onto the gantry and the collar that seals it into the
    sphere; returns the turbolift's doorway."""
    w, y0, y1 = VESTIBULE
    outline = [(-w, y0), (w, y0), (w, y1), (-w, y1)]
    lift, mouth = walls('vestibule wall', outline, [(0, 0.0, 2.0), (2, 0.0, 2.4)], profile(HEIGHT), wall_materials(),
                        lintel_from=DOOR_H + 0.1)
    door_frame('door turbolift', lift, 2.0)
    marker('door turbolift', 'door', (0, -WALL / 2, 0), frame=lift, width=2.0, height=DOOR_H)
    # out onto the gantry: an open doorway, its frame standing out of the far face too, into the sphere
    door_frame('mouth', mouth, 2.4, back=0.12)
    sign('sign cartography', 'Stellar Cartography', 2.6, LCARS['gold'], (0, 0.13, 2.82), mouth, code='13-01')
    polygon('vestibule floor', outline, 0, material(FLOOR, surface='carpet'), uv_scale=0.5)
    polygon('vestibule ceiling', outline, HEIGHT, unlit(HULL['ceiling']), down=True)
    # its roof, seen from out in the sphere
    roof = [(-w - WALL, y0 - WALL), (w + WALL, y0 - WALL), (w + WALL, y1 + WALL), (-w - WALL, y1 + WALL)]
    polygon('vestibule roof', roof, HEIGHT + 0.004, toon(HULL['frame']))
    # a collar round the vestibule where it passes through the sphere, buried in the sphere's skin, which hides the
    # ragged edge of the hole cut for it
    frame = toon(HULL['frame'])
    depth, front = 1.4, y1 + WALL + 0.02
    ring = 0.9
    for name, size, at in (('collar top', (2 * (w + WALL + ring), depth, ring), (0, front - depth / 2, HEIGHT + 0.004)),
                           ('collar bottom', (2 * (w + WALL + ring), depth, ring), (0, front - depth / 2, -ring - 0.4)),
                           ('collar port', (ring, depth, HEIGHT + 0.4), (-(w + WALL + ring / 2), front - depth / 2, -0.4)),
                           ('collar starboard', (ring, depth, HEIGHT + 0.4), (w + WALL + ring / 2, front - depth / 2, -0.4))):
        box(name, size, frame, at, round=0.04)
    return lift


def sphere():
    """The sphere's skin, facing in, with a hole where the vestibule comes through (its collar hides the edge). The
    browser draws on it: its void colour is what shows between the stars."""
    cx, cy, cz = CENTRE
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=RADIUS)
    bmesh.ops.translate(bm, vec=(cx, cy, cz), verts=bm.verts)
    w, _, y1 = VESTIBULE
    hole = [f for f in bm.faces if abs(f.calc_center_median().x) < w + WALL + 0.5
            and -0.6 < f.calc_center_median().z < HEIGHT + 0.6 and f.calc_center_median().y < y1]
    bmesh.ops.delete(bm, geom=hole, context='FACES')
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    link(mesh_object('sphere', bm, [unlit(VOID)]))


def rail(name, path):
    """A railing along `path`, standing on the walkway's edge, with posts, a gold top rail and a glowing kick strip."""
    frame, gold = toon(HULL['frame']), toon(GOLD)
    d0, d1 = -0.07, 0.0
    sweep(f'{name} top', path, [(d0, 1.0), (d0, 1.07), (d1, 1.07), (d1, 1.0), (d0, 1.0)], [gold] * 4, caps=True)
    # its foot buried in the walkway, which on the gantry sits a little lower than the platform
    sweep(f'{name} kick', path, [(d0, -0.03), (d0, 0.12), (d1, 0.12), (d1, -0.03)], [frame, unlit(GLOW), frame], caps=True)
    step = 1.2
    for i in range(len(path) - 1):
        (ax, ay), (bx, by) = path[i], path[i + 1]
        n = max(1, round(math.hypot(bx - ax, by - ay) / step))
        for k in range(n + (1 if i == len(path) - 2 else 0)):
            t = k / n
            box(f'{name} post {i}.{k}', (0.05, 0.05, 1.0), frame, (ax + (bx - ax) * t, ay + (by - ay) * t, 0.0))


def gantry():
    """The gantry from the vestibule's mouth to the platform, over the void, with a railing either side and a glow
    along its underside."""
    _, _, y1 = VESTIBULE
    end = -PLATFORM + 1.0
    slab('gantry', [(-GANTRY, y1), (GANTRY, y1), (GANTRY, end), (-GANTRY, end)], -0.3, -UNDER, material(WALKWAY, surface='carpet'))
    # short of the deck's ends, so their faces don't meet
    slab('gantry keel', [(-0.5, y1 + 0.05), (0.5, y1 + 0.05), (0.5, end - 0.05), (-0.5, end - 0.05)], -0.75, -0.25, toon(HULL['dado']))
    for s in (-1, 1):
        box(f'gantry glow {s}', (0.05, end - y1, 0.04), unlit(GLOW), (s * (GANTRY - 0.06), (y1 + end) / 2, -0.34))
    # each railing from the mouth to where the platform's begins, just inside the walkway's edge
    meet = -math.sqrt(PLATFORM ** 2 - GANTRY ** 2)
    rail('gantry rail port', [(-GANTRY + 0.02, y1 + 0.2), (-GANTRY + 0.02, meet)])
    rail('gantry rail starboard', [(GANTRY - 0.02, meet), (GANTRY - 0.02, y1 + 0.2)])
    collide_path([(-GANTRY, y1), (-GANTRY, meet)], 0.15, 0.6)
    collide_path([(GANTRY, meet), (GANTRY, y1)], 0.15, 0.6)


def platform():
    """The round platform in the middle of the sphere, railed round but where the gantry meets it, and the cartography
    console at its far edge, facing back along the gantry."""
    slab('platform', ring_points(0, 0, PLATFORM, 64), -0.3, 0.0, material(FLOOR, surface='carpet'))
    slab('platform keel', ring_points(0, 0, PLATFORM - 0.6, 48), -1.2, -0.25, toon(HULL['dado']))
    annulus('platform ring', 0.9, 1.0, 0.004, unlit(GLOW))
    # railed from just past the gantry's port side, round the far side, to just past its starboard side
    gap = math.asin(GANTRY / PLATFORM)
    arc = ring_points(0, 0, PLATFORM, 40, -math.pi / 2 + gap, 3 * math.pi / 2 - gap)
    rail('platform rail', arc)
    collide_path(arc, 0.15, 0.6)
    console = Matrix.Translation((0, PLATFORM - 0.75, 0)) @ Matrix.Rotation(math.pi, 4, 'Z')
    body = bridge_console('cartography', 1.8, 81, console, display=(1.0, 0.36), accent=toon(LCARS['sky']))
    interact('cartography', 'Take flight', body)
