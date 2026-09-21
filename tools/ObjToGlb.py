import sys

import bpy

arguments = sys.argv[sys.argv.index("--") + 1 :]
source_file, output_file = arguments[0], arguments[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=source_file)
bpy.ops.export_scene.gltf(
    filepath=output_file,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
)
