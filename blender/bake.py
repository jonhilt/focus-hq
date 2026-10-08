"""Bakes a deck's ambient occlusion: the soft shading where surfaces meet, a hand's width round every corner, that keeps
a console looking like it stands on the floor rather than floats over it.

Every shaded mesh gets a second UV map, 'lightmap', unwrapped across the whole deck into one atlas; Cycles bakes the
occlusion into it; and every shaded material carries the atlas as its glTF occlusion texture, which the browser
multiplies in (client/src/world/deck.ts). Meshes the browser draws unlit (ceilings, lights, screens, signs) aren't
shaded, so they're left out.
"""

import math
import time

import bmesh
import bpy
import numpy as np

# a material's `surface` the browser shades (kit.py's docstring): the rest it draws unlit
SHADED = {None, 'carpet', 'accent'}
# metres: as far as a surface looks for another to be shaded by (client/src/world/frame.ts: AO.radius)
DISTANCE = 0.6
SAMPLES = 128
# metres a texel of the atlas covers, at most: the shading fades over DISTANCE, so a few centimetres is plenty, and
# a bigger atlas than SIZES' last costs a weak GPU more memory than it's worth
TEXEL = 0.045
SIZES = (512, 1024, 2048)
# texels between islands in the atlas (at its smallest), so neither bleeds into the other when it's sampled smoothly
MARGIN = 8
# metres apart the modules are spread while baking: they all stand at the origin, overlapping (kit.py: module)
APART = 1000.0


def _shaded(obj):
    return any(slot.material and slot.material.get('surface') in SHADED for slot in obj.material_slots)


def _use_gpu():
    """Bakes on the GPU if Cycles has one, which is many times quicker; on the CPU otherwise."""
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        devices = [d for d in prefs.devices if d.type == kind]
        if devices:
            for d in prefs.devices:
                d.use = d.type == kind
            return kind
    return None


def _occlusion_output():
    """The node group the glTF exporter reads a material's occlusion from."""
    group = bpy.data.node_groups.get('glTF Material Output')
    if group:
        return group
    group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    return group


def _atlas_size(objs):
    """The smallest atlas whose texels are no bigger than TEXEL, for the lightmap as unwrapped."""
    area, uv_area = 0.0, 0.0
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        uv = bm.loops.layers.uv['lightmap']
        for f in bm.faces:
            area += f.calc_area()
            pts = [loop[uv].uv for loop in f.loops]
            uv_area += abs(sum(a.x * b.y - b.x * a.y for a, b in zip(pts, pts[1:] + pts[:1]))) / 2
        bm.free()
    return next((s for s in SIZES if math.sqrt(area / max(uv_area, 1e-9)) / s <= TEXEL), SIZES[-1])


def _smooth(image):
    """
    Blurs the bake a texel or two, which takes out the grain of its samples: islands sit MARGIN apart and the bake
    extends each into its margin, so the blur only ever reads an island's own shading.
    """
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    ao = px.reshape(h, w, 4)[:, :, 0]
    kernel = np.array([1, 4, 6, 4, 1], dtype=np.float32) / 16
    pad = np.pad(ao, 2, mode='edge')
    ao = sum(k * pad[:, i:i + w] for i, k in enumerate(kernel))
    ao = sum(k * ao[i:i + h, :] for i, k in enumerate(kernel))
    out = np.ones((h, w, 4), dtype=np.float32)
    out[:, :, 0] = out[:, :, 1] = out[:, :, 2] = ao
    image.pixels.foreach_set(out.ravel())


def ambient_occlusion():
    """Bakes the deck's occlusion into an atlas and hands it to every shaded material."""
    t0 = time.time()
    scene = bpy.context.scene
    objs = [o for o in scene.objects if o.type == 'MESH' and _shaded(o)]
    if not objs:
        return

    # the browser applies the modifiers (bevels) as it exports: apply them first, so the lightmap covers what's drawn,
    # and give every mesh its own data, so no two share one patch of the atlas
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(depsgraph), preserve_all_data_layers=True, depsgraph=depsgraph)
        o.modifiers.clear()
        o.data = me
        # the lightmap goes second (TEXCOORD_1), after the UVs a carpet or panel tiles by, whether it has them or not
        if not me.uv_layers:
            me.uv_layers.new(name='UVMap')
        me.uv_layers.active = me.uv_layers.new(name='lightmap')

    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    # boxes round each island rather than their shapes: seconds rather than a minute, for a little more atlas
    bpy.ops.uv.pack_islands(margin_method='FRACTION', margin=MARGIN / SIZES[1], rotate=True, shape_method='AABB')
    bpy.ops.object.mode_set(mode='OBJECT')
    size = _atlas_size(objs)
    t1 = time.time()

    image = bpy.data.images.new(f'{_collection_name()} occlusion', size, size, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    mats = {slot.material for o in objs for slot in o.material_slots if slot.material and slot.material.get('surface') in SHADED}
    bake_nodes = []
    for mat in mats:
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'lightmap'
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.interpolation = 'Linear'
        links.new(uv.outputs['UV'], tex.inputs['Vector'])
        nodes.active = tex
        bake_nodes.append((mat, tex))

    # modules all stand at the origin: spread them out, so each is shaded only by itself
    modules = [o for o in scene.objects if o.type == 'EMPTY' and o.parent is None and o.children]
    for i, m in enumerate(modules):
        m.location.x += i * APART

    scene.render.engine = 'CYCLES'
    device = _use_gpu()
    scene.cycles.device = 'GPU' if device else 'CPU'
    scene.cycles.samples = SAMPLES
    if scene.world is None:
        scene.world = bpy.data.worlds.new('world')
    scene.world.light_settings.distance = DISTANCE
    scene.render.bake.margin = MARGIN
    scene.render.bake.margin_type = 'EXTEND'
    # Cycles bakes selected objects one by one, which for a deck's hundreds takes minutes: bake one joined copy instead
    bpy.context.view_layer.update()
    copies = []
    for o in objs:
        c = o.copy()
        c.data = o.data.copy()
        c.parent = None
        c.matrix_world = o.matrix_world.copy()
        scene.collection.objects.link(c)
        copies.append(c)
    bpy.ops.object.select_all(action='DESELECT')
    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    # and the originals out of its way: rays leaving the copy's surface would hit theirs, lying right on it
    for o in objs:
        o.hide_render = True
    t2 = time.time()
    bpy.ops.object.bake(type='AO', use_clear=True)
    for o in objs:
        o.hide_render = False
    joined_mesh = joined.data
    bpy.data.objects.remove(joined)
    bpy.data.meshes.remove(joined_mesh)

    for i, m in enumerate(modules):
        m.location.x -= i * APART
    _smooth(image)

    group = _occlusion_output()
    for mat, tex in bake_nodes:
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        split = nodes.new('ShaderNodeSeparateColor')
        out = nodes.new('ShaderNodeGroup')
        out.node_tree = group
        links.new(tex.outputs['Color'], split.inputs['Color'])
        links.new(split.outputs['Red'], out.inputs['Occlusion'])
    image.pack()
    print(f'  occlusion: {len(objs)} meshes unwrapped in {t1 - t0:.1f}s, baked {size}px on {device or "CPU"} in {time.time() - t2:.1f}s')


def _collection_name():
    return next((c.name for c in bpy.context.scene.collection.children), 'deck')
