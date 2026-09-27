import argparse
import sys

import bpy


def object_rename(pair):
    if "=" not in pair:
        raise argparse.ArgumentTypeError(f"expected objectName=outputName, got {pair}")
    return tuple(pair.split("=", 1))


parser = argparse.ArgumentParser(
    prog="WeaponPackSplit.py", description="Run inside Blender after the -- separator; omit renames to list meshes"
)
parser.add_argument("source")
parser.add_argument("output_directory")
parser.add_argument("renames", nargs="*", type=object_rename, metavar="objectName=outputName")
if "--" not in sys.argv:
    parser.error("arguments must follow the -- separator")
arguments = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
source, output_directory = arguments.source, arguments.output_directory
requested = dict(arguments.renames)

if source.lower().endswith(".blend"):
    bpy.ops.wm.open_mainfile(filepath=source)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=source)

meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]

if not requested:
    for mesh in meshes:
        size = mesh.dimensions
        materials = [slot.material.name for slot in mesh.material_slots if slot.material]
        print(f"MESH {mesh.name} size=({size.x:.3f},{size.y:.3f},{size.z:.3f}) materials={materials}")
    raise SystemExit(0)

for object_name, output_name in requested.items():
    target = bpy.data.objects.get(object_name)
    if target is None:
        available = sorted(obj.name for obj in bpy.data.objects if obj.type == "MESH")
        raise KeyError(f"no object {object_name} in the weapon pack, meshes: {available}")
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    target.animation_data_clear()
    world_matrix = target.matrix_world.copy()
    target.parent = None
    target.matrix_world = world_matrix
    target.location = (0.0, 0.0, 0.0)
    bpy.ops.export_scene.gltf(
        filepath=f"{output_directory}/{output_name}.gltf",
        export_format="GLTF_SEPARATE",
        export_texture_dir=output_name,
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    print(f"EXPORTED {output_name}")
