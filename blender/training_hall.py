"""The training hall: a project's holodeck, bigger on the inside, after the hall of training pods the Cerritos crew drill
in (Lower Decks, "I, Excretus"). The browser dresses a copy per holodeck (client/src/world/hall.ts), a vacant one too.

A round hall `RADIUS` across its inner faces, `HEIGHT` tall, its entrance in a flat wall across the round one, where the
round wall would pass behind the hall's middle. The holodeck's door on the deck is a portal to the entrance's doorway,
so the hall stands wherever the browser puts it (layout.ts: hallAt), a copy per holodeck. Only the architecture is
here: the floor's colour (its `accent`s, the project's, lighter in the control ring), the board, desks and pods are the
browser's, against the sizes in client/src/world/layout.ts (HALL) and hallLayout.ts. Keep everything on the walls
within SKIN of their inner faces, behind the skin a landscape shows through (world/scenery.ts), and under the ceiling's
skin. Only the door frame stands proud of it.

The hall's middle is the origin, and its entrance towards -X: the browser's room frame, which runs from the door
towards +X. Blender's +Y is the browser's -Z.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from command_deck import profile, wall_materials
from kit import (DOOR_H, FRAME_PROUD, HULL, LCARS, annulus, box, collide_points, door_frame, link, marker, material,
                 mesh_object, module, polygon, readout, ring_points, toon, unlit, walls)

# client/src/world/layout.ts: HALL, DOOR_W
RADIUS = 11.0
HEIGHT = 6.4
ALCOVE = 0.9
DOOR_W = 2.4
WALL = 0.2
#: how far the holodeck skin stands in front of the walls' inner faces and under the ceiling (scenery.ts)
SKIN = 0.1
#: half the angle the entrance's flat wall takes out of the round one, either side of straight back
GAP = math.asin(2.4 / RADIUS)
#: the entrance wall's inner face (hallLayout.ts: ENTRANCE_X)
ENTRANCE_X = -RADIUS * math.cos(GAP)
#: the control ring in the middle of the floor, round the desks (room.ts: HALL_PLAN)
CONTROL_RING = 5.2
#: where the ribs stand up the round wall, in degrees round from straight ahead: between the pods and the readouts
RIBS = (-150, -120, -67.5, -33, 33, 67.5, 120, 150)
READOUTS = (-135, 135)
#: segments round the control ring and its band, the same for the floor's hole round them, so their edges meet
RING = 96


def build():
    training_hall()


def on_wall(angle, r=RADIUS):
    """A Matrix on the round wall's inner face `angle` round from straight ahead: X along it, Y in to the middle."""
    return Matrix.Translation((r * math.cos(angle), r * math.sin(angle), 0)) @ Matrix.Rotation(angle + math.pi / 2, 4, 'Z')


def floor_around(name, outline, r, mat):
    """The floor inside `outline`, round a hole `r` across in the middle whose edge is the control band's."""
    bm = bmesh.new()
    loops = [[bm.verts.new((x, y, 0)) for x, y in points] for points in (outline, ring_points(0, 0, r, RING))]
    edges = [bm.edges.new((loop[i], loop[(i + 1) % len(loop)])) for loop in loops for i in range(len(loop))]
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    # scanfill fills the hole too: take out every face within it
    for face in [f for f in bm.faces if f.calc_center_median().xy.length < r]:
        bm.faces.remove(face)
    for face in bm.faces:
        face.normal_update()
        if face.normal.z < 0:
            face.normal_flip()
    return link(mesh_object(name, bm, [mat]))


def doorway(name, f):
    """
    The entrance's doorway at `f` (its centre on the floor, in the middle of the wall, +Y into the hall): the ship's door
    frame round it, the marker the browser hangs the doors and the portal on, as big as the holodeck's door on the deck,
    and colliders round the alcove behind, so you can step far enough in to go through but no further.
    """
    door_frame(name, f @ Matrix.Translation((0, WALL / 2, 0)), DOOR_W, DOOR_H, wall=WALL, back=FRAME_PROUD)
    marker(f'{name} portal', 'portal', frame=f, width=DOOR_W, height=DOOR_H, depth=ALCOVE)
    out = DOOR_W / 2 + 0.3
    for s in (-1, 1):
        collide_points([f @ Vector((s * x, y, 0)) for x in (DOOR_W / 2, out) for y in (0, -ALCOVE - 0.15)])
    collide_points([f @ Vector((x, y, 0)) for x in (-out, out) for y in (-ALCOVE, -ALCOVE - 0.15)])


def training_hall():
    module('training_hall')
    # round from just past the entrance anticlockwise to just before it, then straight across the flat wall back
    # to the start: the doorway in the middle of that last edge
    outline = ring_points(0, 0, RADIUS, 96, -math.pi + GAP, math.pi - GAP)
    door = walls('hall wall', outline, [(len(outline) - 1, 0.0, DOOR_W)], profile(HEIGHT), wall_materials(),
                 lintel_from=DOOR_H + 0.1)[0]
    # round, not faceted: smooth across the round wall's segments, sharp across its trims' folds
    for obj in bpy.data.objects:
        if obj.name.startswith('hall wall') and obj.type == 'MESH':
            obj.data.shade_smooth()
            obj.data.set_sharp_from_angle(angle=math.radians(30))
    doorway('hall entrance', door @ Matrix.Translation((0, -WALL / 2, 0)))

    # the floor in the project's colour (the browser's), the control ring lighter, with an LCARS band round it, all in
    # one plane, edge to edge: laid one over another, their edges would be steps the outlines catch from far off
    band = CONTROL_RING + 0.3
    floor_around('hall floor', outline, band, material(HULL['carpet'], surface='accent', shade=0.6))
    annulus('hall control band', CONTROL_RING, band, 0, toon(LCARS['orange']), segments=RING)
    annulus('hall control ring', 0, CONTROL_RING, 0, material(HULL['carpet'], surface='accent', shade=0.4), segments=RING)

    # the ceiling, and the ring of light round its middle, above where the skin would be
    polygon('hall ceiling', outline, HEIGHT, unlit(HULL['ceiling']), down=True)
    glow = unlit('#fff6e0')
    annulus('hall ceiling light', 3.4, 4.0, HEIGHT - 0.015, glow, segments=96, down=True)
    annulus('hall ceiling light middle', 0, 1.0, HEIGHT - 0.015, glow, segments=48, down=True)

    # ribs up the round wall, buried in the floor and ceiling, and LCARS readouts round by the entrance
    for d in RIBS:
        box(f'hall rib {d}', (0.32, 0.12, HEIGHT + 0.07), toon(HULL['frame']), (0, 0.03, -0.02), frame=on_wall(math.radians(d)))
    for i, d in enumerate(READOUTS):
        # flat on a curved wall: out far enough that its ends clear the wall behind them
        readout(f'hall readout {d}', 1.6, 1.0, 11 + i, (0, 0.035, 1.5), frame=on_wall(math.radians(d)))
