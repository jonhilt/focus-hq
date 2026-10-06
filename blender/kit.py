"""Building blocks for the ship's decks: materials, meshes, swept walls and the markers the browser reads.

Blender is Z-up, and a deck's +Y is the way the ship flies (towards the bridge's viewscreen). The glTF export turns
that into three.js's Y-up, with Blender (x, y, z) landing at (x, z, -y), so +Y here is -Z in the browser. Distances
are metres.

What the browser reads (client/src/world/deck.ts), all through custom properties, which export as glTF extras:
- An object's `marker` makes it a marker rather than scenery: 'collider' (an empty cube: an axis-aligned box the
  player can't walk into), 'door' (sliding doors at a doorway's centre, sliding along the empty's X: `width`,
  `height`), 'place' (a teleport destination, looking along the empty's +Y: `label`), 'area' (an empty cube: the
  floor `label` names in the HUD), 'number-one' (where Number One's chair stands, turned along the empty's +Y: it
  says the ready room is on this deck) or 'turbolift' (where the turbolift stops: you stand there in its car, facing
  along the empty's +Y, and `label` names the deck).
- An object's `interact` has pressing E on it do something: 'manager' (open the ready room console) or 'turbolift' (its
  controls), with the hint `label`.
- A material's `surface` has the browser draw it: 'space' (a viewport onto the stars), 'keys' (an LCARS touch panel),
  'readout' (LCARS readouts: `seed`, `w`, `h`), 'sign' (an LCARS sign: `text`, `color`, optional `sub` and `code`),
  'screen' (a screen the browser keeps drawing: `screen`, which is 'mission-control'), 'star-chart' (long-range
  sensors), 'carpet' (speckled carpet in the material's colour, tiled every 2 m) or 'unlit' (the material's colour,
  unshaded: lights and ceilings). Everything else is a toon material in its base colour. `outline: 0` leaves a
  surface out of the outline pass.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# client/src/world/starship.ts: HULL and LCARS
HULL = {
    'bulkhead': '#d9d3e2',
    'dado': '#4c4562',
    'stripe': '#ff9966',
    'frame': '#7a7290',
    'door': '#b4adc4',
    'ceiling': '#c8c2d2',
    'carpet': '#34406c',
    'carpetEdge': '#5e6fae',
}
LCARS = {
    'orange': '#ff9966',
    'lilac': '#cc99cc',
    'periwinkle': '#9999ff',
    'peach': '#ffcc99',
    'red': '#cc6666',
    'gold': '#ff9900',
    'sky': '#99ccff',
}

DOOR_H = 2.5
"""How far the outline of a door frame stands into the room: clear of every wall trim, so they end inside it."""
FRAME_PROUD = 0.12


# ---------------------------------------------------------------------------------------------------- materials

def _linear(hex_color):
    def channel(c):
        c = int(c, 16) / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    h = hex_color.lstrip('#')
    return (channel(h[0:2]), channel(h[2:4]), channel(h[4:6]), 1.0)


_materials = {}


def material(base, surface=None, outline=True, **props):
    """A material in an sRGB hex colour, shared by every caller asking for the same one."""
    key = (base, surface, outline, tuple(sorted(props.items())))
    if key in _materials:
        return _materials[key]
    name = f'{surface or "toon"} {base}' + ''.join(f' {k}={v}' for k, v in sorted(props.items()))
    mat = bpy.data.materials.new(name)
    rgba = _linear(base)
    mat.diffuse_color = rgba
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = 1.0
    if surface:
        mat['surface'] = surface
    if not outline:
        mat['outline'] = 0
    for k, v in props.items():
        mat[k] = v
    _materials[key] = mat
    return mat


def toon(color):
    return material(color)


def unlit(color):
    return material(color, surface='unlit', outline=False)


# ---------------------------------------------------------------------------------------------------- objects

_collection = None


def begin(name):
    """Starts a deck: an empty scene with a collection of its own."""
    global _collection
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()
    _collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(_collection)


def link(obj, at=(0, 0, 0), yaw=0.0, frame=None):
    """Places an object at `at`, turned `yaw` about Z, both within `frame` (a Matrix) if given."""
    local = Matrix.Translation(Vector(at)) @ Matrix.Rotation(yaw, 4, 'Z')
    obj.matrix_world = (frame @ local) if frame is not None else local
    _collection.objects.link(obj)
    return obj


def mesh_object(name, bm, mats, smooth=None):
    """Turns a bmesh into an object (not yet linked). `smooth` is the angle (radians) below which edges shade smooth."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth is not None:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=smooth)
    return bpy.data.objects.new(name, me)


def bevel(obj, width, segments=2):
    mod = obj.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(35)
    return obj


def box(name, size, mat, at=(0, 0, 0), yaw=0.0, frame=None, round=0.0):
    """A box `size` (x, y, z) with its bottom centre at `at`."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 0, sz / 2)) @ Matrix.Diagonal((sx, sy, sz, 1)), verts=bm.verts)
    obj = mesh_object(name, bm, [mat])
    if round:
        bevel(obj, round)
    return link(obj, at, yaw, frame)


def cylinder(name, r, h, mat, at=(0, 0, 0), r_top=None, segments=24, frame=None):
    """An upright cylinder (or cone) with its bottom centre at `at`."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r, radius2=r if r_top is None else r_top, depth=h)
    bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
    return link(mesh_object(name, bm, [mat], smooth=math.radians(40)), at, 0.0, frame)


def slab(name, points, z0, z1, mat, round=0.0):
    """A flat-topped solid from z0 up to z1 over 2D points listed counter-clockwise from above."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z0)) for x, y in points]
    top = [bm.verts.new((x, y, z1)) for x, y in points]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bottom)))
    for i in range(len(points)):
        j = (i + 1) % len(points)
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    obj = mesh_object(name, bm, [mat])
    if round:
        bevel(obj, round)
    return link(obj)


def polygon(name, points, z, mat, down=False, uv_scale=None):
    """A flat n-gon at height z through 2D points listed counter-clockwise from above; `down` faces it at the floor.
    `uv_scale` maps metres to UVs (for tiled textures)."""
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, z)) for x, y in points]
    face = bm.faces.new(list(reversed(verts)) if down else verts)
    if uv_scale:
        uv = bm.loops.layers.uv.new()
        for loop in face.loops:
            loop[uv].uv = (loop.vert.co.x * uv_scale, loop.vert.co.y * uv_scale)
    return link(mesh_object(name, bm, [mat]))


def ring_points(cx, cy, r, segments, start=0.0, end=2 * math.pi):
    """Points around a circle (or an arc from `start` to `end`), counter-clockwise."""
    full = abs(end - start - 2 * math.pi) < 1e-9
    n = segments if full else segments + 1
    return [(cx + r * math.cos(start + (end - start) * i / segments), cy + r * math.sin(start + (end - start) * i / segments)) for i in range(n)]


def annulus(name, r0, r1, z, mat, segments=48, at=(0, 0), down=False):
    """A flat ring between radii r0 and r1 at height z, facing up (or down), or a disc if r0 is 0."""
    bm = bmesh.new()
    outer = [bm.verts.new((at[0] + x, at[1] + y, z)) for x, y in ring_points(0, 0, r1, segments)]
    if r0 <= 0:
        bm.faces.new(outer)
    else:
        inner = [bm.verts.new((at[0] + x, at[1] + y, z)) for x, y in ring_points(0, 0, r0, segments)]
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((inner[i], outer[i], outer[j], inner[j]))
    if down:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return link(mesh_object(name, bm, [mat]))


def rounded_rect(w, h, r, segments=4):
    """A w×h rectangle with corners rounded to r, centred on the origin, counter-clockwise."""
    pts = []
    for cx, cy, start in ((w / 2 - r, -h / 2 + r, -math.pi / 2), (w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, math.pi / 2), (-w / 2 + r, -h / 2 + r, math.pi)):
        pts += ring_points(cx, cy, r, segments, start, start + math.pi / 2)
    return pts


def pane(name, outline, mat, at, frame=None):
    """A flat shape facing local +Y through 2D points (x across, z up) around `at`."""
    bm = bmesh.new()
    verts = [bm.verts.new((at[0] - x, at[1], at[2] + z)) for x, z in outline]
    face = bm.faces.new(verts)
    face.normal_update()
    if face.normal.y < 0:
        bmesh.ops.reverse_faces(bm, faces=[face])
    return link(mesh_object(name, bm, [mat]), frame=frame)


def bezel(name, w, h, r, border, depth, mat, at, frame=None):
    """A rounded frame `border` wide around a w×h opening, `depth` deep, standing out from a wall along local +Y."""
    inner = rounded_rect(w, h, r)
    outer = rounded_rect(w + border * 2, h + border * 2, r + border)
    bm = bmesh.new()

    def loop(points, y):
        return [bm.verts.new((at[0] + x, at[1] + y, at[2] + z)) for x, z in points]

    ib, ob, i_f, o_f = loop(inner, 0), loop(outer, 0), loop(inner, depth), loop(outer, depth)
    n = len(inner)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((i_f[i], o_f[i], o_f[j], i_f[j]))
        bm.faces.new((ob[i], ob[j], o_f[j], o_f[i]))
        bm.faces.new((ib[i], i_f[i], i_f[j], ib[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # recalc can't tell which way an open ring faces: the front must face into the room
    front = max(bm.faces, key=lambda f: f.calc_center_median().y)
    if front.normal.y < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return link(mesh_object(name, bm, [mat]), frame=frame)


def panel(name, w, h, mat, at, frame=None, yaw=0.0, tilt=0.0):
    """A w×h quad facing its local +Y, its bottom edge centred on `at`, UV-mapped the right way round for someone
    facing it. `tilt` leans it back about X (radians), for panels set into a slope."""
    bm = bmesh.new()
    # facing +Y, the viewer's left is +X
    corners = [(w / 2, 0, 0), (-w / 2, 0, 0), (-w / 2, 0, h), (w / 2, 0, h)]
    verts = [bm.verts.new(Matrix.Rotation(tilt, 3, 'X') @ Vector(c)) for c in corners]
    face = bm.faces.new(verts)
    uv = bm.loops.layers.uv.new()
    for loop, coords in zip(face.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop[uv].uv = coords
    return link(mesh_object(name, bm, [mat]), at, yaw, frame)


def readout(name, w, h, seed, at, frame=None, yaw=0.0):
    """An LCARS readout in a frame, hung on a wall facing local +Y."""
    x, y, z = at
    box(f'{name} frame', (w + 0.1, 0.03, h + 0.1), toon(HULL['frame']), (x, y + 0.015, z - 0.05), yaw, frame)
    return panel(name, w, h, material('#000000', surface='readout', outline=False, seed=seed, w=w, h=h), (x, y + 0.035, z), frame, yaw)


def sign(name, text, w, color, at, frame=None, yaw=0.0, sub=None, code=None):
    """An LCARS sign w wide (in its texture's 1024×200 proportions) facing local +Y."""
    props = {'text': text, 'color': color}
    if sub:
        props['sub'] = sub
    if code:
        props['code'] = code
    return panel(name, w, w * 200 / 1024, material('#000000', surface='sign', outline=False, **props), at, frame, yaw)


def prism(name, profile, length, mats, at=(0, 0, 0), yaw=0.0, frame=None, round=0.0):
    """A closed side profile [(y, z), ...] (counter-clockwise seen from +X) extruded `length` along X, centred.
    `mats` gives each profile edge's material (the end caps take the first)."""
    bm = bmesh.new()
    left = [bm.verts.new((-length / 2, y, z)) for y, z in profile]
    right = [bm.verts.new((length / 2, y, z)) for y, z in profile]
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((left[i], left[j], right[j], right[i])).material_index = i
    bm.faces.new(right)
    bm.faces.new(list(reversed(left)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = mesh_object(name, bm, mats)
    if round:
        bevel(obj, round)
    return link(obj, at, yaw, frame)


# ---------------------------------------------------------------------------------------------------- walls

def _left(a, b):
    """The unit normal to the left of travelling from a to b."""
    d = (Vector(b) - Vector(a)).normalized()
    return Vector((-d.y, d.x))


def sweep(name, path, profile, mats, closed=False, caps=False):
    """
    Sweeps a cross-section along a path on the floor. Each profile point is (d, z): d metres to the path's left
    (into the room, for a wall's inner face run counter-clockwise), z up. List the profile so the solid is on its
    right as you go (up the back, across the top, down the front) and faces point out of it. `mats` gives each
    profile edge's material. Corners are mitred. `caps` closes the ends of an open path, for a closed profile.
    """
    pts = [Vector(p) for p in path]
    n = len(pts)
    offsets = []
    for i in range(n):
        prev_n = _left(pts[i - 1], pts[i]) if (closed or i > 0) else None
        next_n = _left(pts[i], pts[(i + 1) % n]) if (closed or i < n - 1) else None
        if prev_n is None:
            offsets.append(next_n)
        elif next_n is None:
            offsets.append(prev_n)
        else:
            m = (prev_n + next_n).normalized()
            offsets.append(m / m.dot(prev_n))
    bm = bmesh.new()
    rings = [[bm.verts.new((pts[i].x + offsets[i].x * d, pts[i].y + offsets[i].y * d, z)) for d, z in profile] for i in range(n)]
    for i in range(n if closed else n - 1):
        a, b = rings[i], rings[(i + 1) % n]
        for j in range(len(profile) - 1):
            bm.faces.new((a[j], b[j], b[j + 1], a[j + 1])).material_index = j
    if caps:
        bm.faces.new(rings[0])
        bm.faces.new(list(reversed(rings[-1])))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(mesh_object(name, bm, mats))


def _clip(profile, mats, z_min):
    """The part of an open wall profile at or above z_min, closed underneath (the face across the cut)."""
    pts, kept = [], []
    for i, (d, z) in enumerate(profile):
        if i > 0:
            (d0, z0), mat = profile[i - 1], mats[i - 1]
            if (z0 < z_min) != (z < z_min):
                t = (z_min - z0) / (z - z0)
                if pts:
                    kept.append(mat)
                pts.append((d0 + (d - d0) * t, z_min))
            if z >= z_min and pts:
                kept.append(mat)
        if z >= z_min:
            pts.append((d, z))
    return pts + [(pts[0][0], z_min)], kept + [mats[0]]


def walls(name, outline, doors, profile, mats, lintel_from):
    """
    The walls around a room whose inner faces run through `outline` (corners, counter-clockwise from above), as
    one swept profile with gaps for `doors`: (edge index, offset of the door's centre from the edge's middle, width),
    edge i running from outline[i] to outline[i + 1]. Above each gap, the profile from `lintel_from` up spans it.
    Colliders follow the walls between the gaps, as deep as the profile. Returns each door's frame, in the order of
    `doors`: a Matrix at the gap's centre on the inner face, X along the wall, Y into the room.
    """
    near, far = max(d for d, _ in profile), -min(d for d, _ in profile)
    n = len(outline)
    stations = []
    frames = [None] * len(doors)
    for i in range(n):
        a, b = Vector(outline[i]), Vector(outline[(i + 1) % n])
        stations.append(('corner', a))
        along = (b - a).normalized()
        mid = (a + b) / 2
        for k, (_, offset, width) in sorted(((k, d) for k, d in enumerate(doors) if d[0] == i), key=lambda kd: kd[1][1]):
            centre = mid + along * offset
            stations.append(('gap', centre - along * width / 2))
            stations.append(('end', centre + along * width / 2))
            yaw = math.atan2(along.y, along.x)
            frames[k] = Matrix.Translation((centre.x, centre.y, 0)) @ Matrix.Rotation(yaw, 4, 'Z')
    if not doors:
        sweep(name, outline, profile, mats, closed=True)
        collide_path(outline, near, far, closed=True)
        return frames
    # start just past a door, so every run goes from one door's far jamb round to the next door's near one
    first = next(i for i, s in enumerate(stations) if s[0] == 'end')
    stations = stations[first:] + stations[:first]
    above, above_mats = _clip(profile, mats, lintel_from)
    run, runs = [], 0
    for kind, p in stations + [stations[0]]:
        run.append(p)
        if kind == 'gap':
            sweep(f'{name} {runs}', run, profile, mats)
            runs += 1
            collide_path(run, near, far)
            run = [p]
        elif kind == 'end' and len(run) == 2:
            sweep(f'{name} lintel', run, above, above_mats)
            run = [p]
    return frames


def door(name, frame, width, height=DOOR_H, wall=0.2, back=0.04):
    """
    A rounded door frame standing proud of both faces of a `wall` thick wall, and the marker for its sliding doors. It
    stands FRAME_PROUD into the room and `back` out of the far face: FRAME_PROUD too when that's another room's wall,
    with trims of its own to clear.
    """
    a = width / 2 + 0.16
    top = height + 0.16
    # the frame's outline seen from the room: an upside-down U, its opening exactly the doors' height so its
    # underside seals their tops
    outline = [(-a, 0), (-width / 2, 0), (-width / 2, height), (width / 2, height), (width / 2, 0), (a, 0), (a, top), (-a, top)]
    bm = bmesh.new()
    rear = [bm.verts.new((x, -wall - back, z)) for x, z in outline]
    front = [bm.verts.new((x, FRAME_PROUD, z)) for x, z in outline]
    for i in range(len(outline)):
        j = (i + 1) % len(outline)
        bm.faces.new((rear[i], rear[j], front[j], front[i]))
    bm.faces.new(list(reversed(front)))
    bm.faces.new(rear)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = bevel(mesh_object(f'{name} frame', bm, [toon(HULL['frame'])]), 0.03)
    link(obj, frame=frame)
    marker(name, 'door', (0, -wall / 2, 0), frame=frame, width=width, height=height)
    for s in (-1, 1):
        collide_points([frame @ Vector((s * x, y, 0)) for x in (width / 2, a) for y in (-wall - back, FRAME_PROUD)])
    return obj


# ---------------------------------------------------------------------------------------------------- markers

def interact(kind, label, *objs):
    """Has pressing E on any of `objs` do `kind` (see the module's docstring), with `label` as the hint."""
    for obj in objs:
        obj['interact'] = kind
        obj['label'] = label


def marker(name, kind, at=(0, 0, 0), yaw=0.0, frame=None, scale=(1, 1, 1), **props):
    """An empty the browser reads rather than draws (see the module's docstring)."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'CUBE' if kind in ('collider', 'area') else 'ARROWS'
    e['marker'] = kind
    for k, v in props.items():
        e[k] = v
    link(e, at, yaw, frame)
    e.scale = scale
    return e


def collider(x0, x1, y0, y1):
    """An axis-aligned box the player can't walk into."""
    marker('collider', 'collider', ((x0 + x1) / 2, (y0 + y1) / 2, 1.0), scale=(abs(x1 - x0) / 2, abs(y1 - y0) / 2, 1.0))


def collide_points(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    collider(min(xs), max(xs), min(ys), max(ys))


def collide_object(obj, pad=0.05):
    """A collider around an object's footprint (its axis-aligned bounds, so best for things that aren't long and turned)."""
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    collider(min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad)


def collide_footprint(frame, x0, x1, y0, y1, band=0.2):
    """
    Colliders round a rectangle x0..x1 by y0..y1 in `frame`: for something long standing at an angle, whose
    axis-aligned bounds would block far more floor than it stands on. A thin band inside its outline is enough to
    keep the player out, and on a diagonal its chain of boxes stands only a few centimetres proud of it.
    """
    corners = [frame @ Vector(c) for c in ((x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0))]
    collide_path([tuple(c.xy) for c in corners], band, 0.0, closed=True, step=band / 2)


def collide_path(path, near, far, closed=False, step=0.2):
    """
    Colliders along a wall whose inner face runs through `path`, from `far` behind it to `near` in front (both
    measured to the path's left). The player only collides with axis-aligned boxes, so a wall at an angle becomes a
    chain of small overlapping ones.
    """
    pts = [Vector(p) for p in path]
    for i in range(len(pts) if closed else len(pts) - 1):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        left = _left(a, b)
        quad = [a + left * near, b + left * near, b - left * far, a - left * far]
        d = b - a
        if abs(d.x) < 1e-6 or abs(d.y) < 1e-6:
            collide_points(quad)
            continue
        half = (near + far) / 2
        mid_off = left * (near - far) / 2
        steps = max(1, math.ceil(d.length / step))
        for k in range(steps + 1):
            c = a + d * (k / steps) + mid_off
            collider(c.x - half, c.x + half, c.y - half, c.y + half)


# ---------------------------------------------------------------------------------------------------- export

def export(glb_path, blend_path=None):
    if blend_path:
        bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        export_extras=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
