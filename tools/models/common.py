import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
PREVIEWS = ROOT / "previews"


def xyz(x, y, z):
    return (x, -z, y)


def material(name, color, metallic=0, roughness=0.55, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = emission
    return mat


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)


def root(name):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    return obj


def parent_keep(obj, parent):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world
    return obj


def bevel(obj, width):
    if width <= 0:
        return
    mod = obj.modifiers.new("Rounded edges", "BEVEL")
    mod.width = width
    mod.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    normal = obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    bpy.ops.object.modifier_apply(modifier=normal.name)


def box(name, x, y, z, w, h, d, mat, parent=None, edge=0):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.location = xyz(x, y, z)
    obj.data.materials.append(mat)
    bevel(obj, edge)
    if parent:
        parent_keep(obj, parent)
    return obj


def cylinder(name, x, y, z, radius, depth, mat, parent=None, vertices=16, axis="y"):
    rotation = (0, math.pi / 2, 0) if axis == "x" else (0, 0, 0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=xyz(x, y, z), rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    if parent:
        parent_keep(obj, parent)
    return obj


def rod(name, a, b, radius, mat, parent=None, vertices=12):
    av = Vector(xyz(*a))
    bv = Vector(xyz(*b))
    d = bv - av
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=d.length, location=(av + bv) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = Vector((0, 0, 1)).rotation_difference(d).to_euler()
    obj.data.materials.append(mat)
    if parent:
        parent_keep(obj, parent)
    return obj


def screen(name, x, y, z, width, height, mat, parent=None):
    bpy.ops.mesh.primitive_plane_add(size=2, location=xyz(x, y, z), rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (width / 2, height / 2, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if parent:
        parent_keep(obj, parent)
    return obj


def descendants(obj):
    result = []
    pending = [obj]
    while pending:
        item = pending.pop()
        result.append(item)
        pending.extend(item.children)
    return result


def triangles(obj):
    total = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for child in descendants(obj):
        if child.type != "MESH":
            continue
        mesh = child.evaluated_get(depsgraph).to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        child.evaluated_get(depsgraph).to_mesh_clear()
    return total


def export(obj, name):
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for child in descendants(obj):
        child.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = OUT / f"{name}.glb"
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, export_apply=True)
    return path


def studio(floor_top=0):
    floor_mat = material("Studio floor", (0.15, 0.18, 0.23), roughness=0.95)
    box("Studio floor", 0, floor_top - 0.05, 0, 200, 0.1, 200, floor_mat)
    world = bpy.context.scene.world
    world.color = (0.18, 0.18, 0.18)
    for name, loc, energy, size in [
        ("Key light", (4, -5, 8), 800, 5),
        ("Fill light", (-5, 1, 5), 520, 4),
        ("Rim light", (1, 6, 7), 650, 3),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        lamp = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(lamp)
        lamp.location = loc
        direction = Vector((0, 0, 0.8)) - lamp.location
        lamp.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera = bpy.data.cameras.new("Preview camera")
    obj = bpy.data.objects.new("Preview camera", camera)
    bpy.context.collection.objects.link(obj)
    bpy.context.scene.camera = obj
    camera.type = "ORTHO"
    camera.ortho_scale = 5.1
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 20
    scene.render.resolution_x = 800
    scene.render.resolution_y = 600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    return obj


ANGLES = {
    "front": (0, 2.2, -6.5),
    "side": (6.5, 2.2, 0),
    "top": (0, 7.5, 0),
    "three_quarter": (4.8, 3.3, -5.0),
}


def render_angles(name, angles=ANGLES, target=(0, 1.0, 0), floor_top=0, scale=5.1):
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    camera = studio(floor_top)
    camera.data.ortho_scale = scale
    for angle, pos in angles.items():
        camera.location = xyz(*pos)
        direction = Vector(xyz(*target)) - camera.location
        camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.render.filepath = str(PREVIEWS / f"{name}_{angle}.png")
        bpy.ops.render.render(write_still=True)


def render_pov(name):
    camera = bpy.context.scene.camera
    camera.data.type = "PERSP"
    camera.data.angle = 2 * math.atan(math.tan(math.radians(55) / 2) * (800 / 600))
    camera.location = xyz(-0.38, 1.75, -0.1)
    direction = Vector(xyz(-0.38, 1.75, -2)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.render.filepath = str(PREVIEWS / f"{name}_inside_pov.png")
    bpy.ops.render.render(write_still=True)
