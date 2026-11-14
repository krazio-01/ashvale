from abc import ABC, abstractmethod
import inspect
import math
from pathlib import Path
import re

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise
from scipy.spatial import ConvexHull, cKDTree

from Geometry import (
    canonical_triangles,
    face_edges,
    normalised,
    principal_axes,
    rounded,
    to_blender,
    to_gltf,
    triangle_areas,
    triangle_crosses,
    unique_edges,
)
from ModelConfig import ModelSettings, WorkFiles, read_json, tuning_section, write_json
from Rig import import_model, reset_scene
from ModelBuild import (
    ContactSheet,
    Studio,
    TextureBaker,
    TILE,
    decimate,
    loop_vertex_indices,
    mesh_corners,
    mesh_positions,
    principled_node,
    read_attribute,
    read_image,
    sample_image,
    select_only,
    write_positions,
)

LUMINANCE_WEIGHTS = np.array([0.2126, 0.7152, 0.0722])

TILE_AXIS_EPSILON = 1e-6

WELD_DISTANCE = 1e-6
CRACK_SEAL_SHARE = 0.001
DEGENERATE_EDGE_SHARE = 0.001
NORMAL_UNIT_TOLERANCE = 1e-3
CLOSEUP_VIEWS = ("front", "left", "back", "side")
CLOSEUP_MARGIN = 1.1
MEASUREMENT_DECIMALS = 5
MILLIMETRES_PER_METRE = 1000.0
NOISE_SEED_SPAN = 1000.0
SURFACE_SAMPLES = np.array(
    [[1 / 3, 1 / 3, 1 / 3], [2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3]]
)
FLAT_NORMAL = np.array([0.5, 0.5, 1.0])
CARD_UVS = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])


class BuildStage(ABC):
    reads: tuple[str, ...] = ()

    @abstractmethod
    def run(self, config, work): ...


class ImportStage(BuildStage):
    PATCH_FACING_MIN_COS = 0.5

    def run(self, config, work):
        high = import_high(config, config["objects"])
        positions = normalise_high(high, config)
        weld_high(high)
        self.patch_high(high, config["patches"])
        save_blend(work / WorkFiles.HI_BLEND)
        size = np.ptp(positions, axis=0)
        print(
            f"STAGE import {config['source']} faces={len(high.data.polygons)} "
            f"size=({size[0]:.3f},{size[1]:.3f},{size[2]:.3f})"
        )

    @staticmethod
    def sort_canonically(shaped):
        shaped.verts.index_update()
        positions = np.array([vertex.co[:] for vertex in shaped.verts])
        vertex_rank = np.empty(len(positions), np.int64)
        vertex_rank[np.lexsort(positions.T[::-1])] = np.arange(len(positions))
        shaped.verts.sort(key=lambda vertex: int(vertex_rank[vertex.index]))
        shaped.verts.index_update()
        shaped.faces.index_update()
        keys = [tuple(sorted(vertex.index for vertex in face.verts)) for face in shaped.faces]
        face_rank = {key: rank for rank, key in enumerate(sorted(set(keys)))}
        shaped.faces.sort(key=lambda face: face_rank[keys[face.index]])

    @classmethod
    def patch_high(cls, high, patches):
        if not patches:
            return
        mesh = high.data
        centres = read_attribute(mesh.polygons, "center", 3, np.float64)
        normals = read_attribute(mesh.polygons, "normal", 3, np.float64)
        patched = bmesh.new()
        patched.from_mesh(mesh)
        patched.faces.ensure_lookup_table()
        sources = []
        for patch in patches:
            corners = to_blender([patch["regionMetres"]["min"], patch["regionMetres"]["max"]])
            inside = np.all((centres >= corners.min(axis=0)) & (centres <= corners.max(axis=0)), axis=1)
            facing = normals @ normalised(to_blender(patch["facing"])) >= cls.PATCH_FACING_MIN_COS
            chosen = np.flatnonzero(inside & facing)
            if len(chosen) == 0:
                raise ValueError(f"patch region {patch['regionMetres']} facing {patch['facing']} holds no faces")
            sources.append([patched.faces[index] for index in chosen])
        for patch, faces in zip(patches, sources):
            copied = bmesh.ops.duplicate(patched, geom=faces)["geom"]
            bmesh.ops.translate(
                patched,
                verts=[item for item in copied if isinstance(item, bmesh.types.BMVert)],
                vec=to_blender(patch["offsetMetres"]),
            )
            bmesh.ops.solidify(
                patched,
                geom=[item for item in copied if isinstance(item, bmesh.types.BMFace)],
                thickness=patch["thicknessMetres"],
            )
            print(f"CHECK patch copied {len(faces)} faces, moved by {patch['offsetMetres']} m")
        cls.sort_canonically(patched)
        patched.to_mesh(mesh)
        patched.free()


class AlignStage(BuildStage):
    reads = (WorkFiles.HI_BLEND,)
    END_SLICE = 0.1

    def run(self, config, work):
        bpy.ops.wm.open_mainfile(filepath=str(work / WorkFiles.HI_BLEND))
        high = bpy.data.objects["hi"]
        self.align_to_length_axis(high)
        save_blend(work / WorkFiles.HI_BLEND)
        print(f"STAGE align length={np.ptp(mesh_positions(high.data)[:, 2]):.4f}")

    @classmethod
    def end_slice_area(cls, along, across, at_top):
        span = along.max() - along.min()
        edge = along.max() - span * cls.END_SLICE if at_top else along.min() + span * cls.END_SLICE
        selected = along >= edge if at_top else along <= edge
        return ConvexHull(across[selected]).volume

    @classmethod
    def align_to_length_axis(cls, target):
        positions = mesh_positions(target.data)
        centred = positions - positions.mean(axis=0)
        axes = principal_axes(positions)
        along = centred @ axes[0]
        across = centred @ axes[1:].T
        tip_sign = 1.0 if cls.end_slice_area(along, across, True) < cls.end_slice_area(along, across, False) else -1.0
        rotation = Vector(normalised(axes[0] * tip_sign)).rotation_difference(Vector((0.0, 0.0, 1.0)))
        target.data.transform(rotation.to_matrix().to_4x4())
        aligned = mesh_positions(target.data)
        heights = aligned[:, 2]
        origin_end = aligned[heights <= heights.min() + (heights.max() - heights.min()) * cls.END_SLICE]
        origin = np.array([origin_end[:, 0].mean(), origin_end[:, 1].mean(), heights.min()])
        target.data.transform(Matrix.Translation(Vector(-origin)))


class DecimateStage(BuildStage):
    reads = (WorkFiles.HI_BLEND,)

    def run(self, config, work):
        bpy.ops.wm.open_mainfile(filepath=str(work / WorkFiles.HI_BLEND))
        high = bpy.data.objects["hi"]
        low = copy_low(high)
        decimate(low, config["triangles"])
        fill_missing_triangles(low)
        save_low(low, work, tuning_section(config["tuning"], "bake"))
        save_blend(work / WorkFiles.HI_BLEND)
        save_blend(work / WorkFiles.LO_BLEND)
        print(f"STAGE decimate high={len(high.data.polygons)} low={len(low.data.polygons)}")


class GenerateStage(BuildStage):
    def run(self, config, work):
        reset_scene()
        detail = tuning_section(config["tuning"], "kit")
        materials = [
            MATERIAL_BUILDERS[material["kind"]](name, material, detail) for name, material in config["materials"].items()
        ]
        high, _ = build_kit(config, "hi", materials)
        save_blend(work / WorkFiles.HI_BLEND)
        print(f"STAGE generate modules={len(config['modules'])} faces={len(high.data.polygons)}")

    @staticmethod
    def tinted(nodes, links, albedo, material):
        linear = srgb_to_linear(read_image(material["albedo"])[..., :3])
        mean_luminance = float(np.mean(linear @ LUMINANCE_WEIGHTS))
        tint = srgb_to_linear(hex_colour(material["tint"]))
        luminance = nodes.new("ShaderNodeRGBToBW")
        links.new(albedo, luminance.inputs["Color"])
        relative = nodes.new("ShaderNodeMath")
        relative.operation = "DIVIDE"
        relative.inputs[1].default_value = mean_luminance
        links.new(luminance.outputs["Val"], relative.inputs[0])
        coloured = nodes.new("ShaderNodeMix")
        coloured.data_type = "RGBA"
        coloured.blend_type = "MULTIPLY"
        coloured.inputs["Factor"].default_value = 1.0
        coloured.inputs["A"].default_value = (*tint, 1.0)
        links.new(relative.outputs["Value"], coloured.inputs["B"])
        print(f"CHECK tint {material['texture']} to {material['tint']} around mean luminance {mean_luminance:.3f}")
        return coloured.outputs["Result"]

    @staticmethod
    def tile_metres(material):
        return float(np.mean(read_json(material["info"])["dimensions"])) / MILLIMETRES_PER_METRE * material["tileScale"]

    @staticmethod
    def baked_material(name, material, detail):
        tiling = GenerateStage.tile_metres(material)
        result = bpy.data.materials.new(name)
        result.use_nodes = True
        nodes, links = result.node_tree.nodes, result.node_tree.links
        principled = principled_node(result)
        mapping = nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (1.0 / tiling,) * 3
        links.new(nodes.new("ShaderNodeTexCoord").outputs["Object"], mapping.inputs["Vector"])
        textures = {}
        for role, colour_space in (("albedo", "sRGB"), ("height", "Non-Color")):
            texture = nodes.new("ShaderNodeTexImage")
            texture.image = bpy.data.images.load(material[role])
            texture.image.colorspace_settings.name = colour_space
            texture.projection = "BOX"
            texture.projection_blend = detail.boxProjectionBlend
            links.new(mapping.outputs["Vector"], texture.inputs["Vector"])
            textures[role] = texture
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Distance"].default_value = material["reliefMetres"]
        albedo = textures["albedo"].outputs["Color"]
        if material["tint"] is not None:
            albedo = GenerateStage.tinted(nodes, links, albedo, material)
        if material["macroVariation"] > 0:
            macro = nodes.new("ShaderNodeTexNoise")
            macro.inputs["Scale"].default_value = 1.0 / (tiling * detail.macroVariationTiles)
            links.new(nodes.new("ShaderNodeTexCoord").outputs["Object"], macro.inputs["Vector"])
            shade = nodes.new("ShaderNodeMix")
            shade.data_type = "RGBA"
            shade.blend_type = "MULTIPLY"
            shade.inputs["Factor"].default_value = material["macroVariation"]
            links.new(albedo, shade.inputs["A"])
            links.new(macro.outputs["Fac"], shade.inputs["B"])
            albedo = shade.outputs["Result"]
        links.new(albedo, principled.inputs["Base Color"])
        links.new(textures["height"].outputs["Color"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], principled.inputs["Normal"])
        print(f"CHECK material {name} {material['texture']} tiles every {tiling:.3f} m")
        return result

    @staticmethod
    def tiled_material(name, material, detail):
        result = bpy.data.materials.new(name)
        result.use_nodes = True
        nodes, links = result.node_tree.nodes, result.node_tree.links
        principled = principled_node(result)
        colour = nodes.new("ShaderNodeTexImage")
        colour.image = GenerateStage.packed_image(
            f"{material['imageStem']}_baseColor", GenerateStage.tinted_pixels(material), "sRGB", material["resolution"]
        )
        links.new(colour.outputs["Color"], principled.inputs["Base Color"])
        normal = nodes.new("ShaderNodeTexImage")
        normal_name = f"{material['normalStem']}_normal"
        normal.image = bpy.data.images.get(normal_name) or GenerateStage.packed_image(
            normal_name, read_image(material["normal"]), "Non-Color", material["resolution"]
        )
        normal_map = nodes.new("ShaderNodeNormalMap")
        links.new(normal.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
        print(
            f"CHECK material {name} {material['texture']} tiled every {GenerateStage.tile_metres(material):.3f} m "
            f"at {material['resolution']}px"
        )
        return result

    @staticmethod
    def tinted_pixels(material):
        pixels = read_image(material["albedo"])
        if material["tint"] is None:
            return pixels
        luminance = srgb_to_linear(pixels[..., :3]) @ LUMINANCE_WEIGHTS
        tinted = np.clip((luminance / float(np.mean(luminance)))[..., None] * srgb_to_linear(hex_colour(material["tint"])), 0, 1)
        return np.concatenate([linear_to_srgb(tinted), pixels[..., 3:]], axis=-1).astype(np.float32)

    @staticmethod
    def packed_image(name, pixels, colour_space, resolution):
        height, width = pixels.shape[:2]
        image = bpy.data.images.new(name, width, height, alpha=False)
        image.colorspace_settings.name = colour_space
        image.pixels.foreach_set(np.ascontiguousarray(pixels, dtype=np.float32).ravel())
        image.scale(resolution, resolution)
        image.file_format = "PNG"
        image.pack()
        return image

    @staticmethod
    def cutout_material(name, material, detail):
        result = bpy.data.materials.new(name)
        result.use_nodes = True
        result.use_backface_culling = False
        nodes, links = result.node_tree.nodes, result.node_tree.links
        principled = principled_node(result)
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = bpy.data.images.load(material["image"])
        clip = nodes.new("ShaderNodeMath")
        clip.operation = "GREATER_THAN"
        clip.inputs[1].default_value = material["alphaCutoff"]
        links.new(texture.outputs["Color"], principled.inputs["Base Color"])
        links.new(texture.outputs["Alpha"], clip.inputs[0])
        links.new(clip.outputs[0], principled.inputs["Alpha"])
        print(f"CHECK material {name} cutout {Path(material['image']).name} alpha cutoff {material['alphaCutoff']}")
        return result


class ModulesStage(BuildStage):
    reads = (WorkFiles.HI_BLEND,)

    def run(self, config, work):
        bpy.ops.wm.open_mainfile(filepath=str(work / WorkFiles.HI_BLEND))
        low, modules = build_kit(config, "lo", None if config["bakes"] else own_materials(config))
        if not config["bakes"]:
            tile_uvs(low, config)
        save_low(low, work, tuning_section(config["tuning"], "bake"))
        save_blend(work / WorkFiles.HI_BLEND)
        save_blend(work / WorkFiles.LO_BLEND)
        write_json(work / WorkFiles.MODULES, modules, indent=2)
        print("STAGE modules " + " ".join(f"{module['name']}={module['faceCount']}" for module in modules))


class UnwrapStage(BuildStage):
    reads = (WorkFiles.LO,)

    def run(self, config, work):
        import xatlas

        unwrap = ModelSettings.from_config(config).section("unwrap")

        low = np.load(work / WorkFiles.LO)
        if not config["bakes"]:
            np.savez(
                work / WorkFiles.ATLAS,
                vertex_map=np.arange(len(low["positions"]), dtype=np.uint32),
                indices=low["faces"].astype(np.uint32),
                uvs=low["uvs"],
            )
            print("STAGE unwrap kept the source UVs: the materials keep their own textures")
            return
        atlas = xatlas.Atlas()
        atlas.add_mesh(low["positions"], low["faces"].astype(np.uint32))
        chart_options = xatlas.ChartOptions()
        chart_options.max_iterations = unwrap.iterations
        pack_options = xatlas.PackOptions()
        pack_options.resolution = config["textureSize"]
        pack_options.padding = unwrap.padding
        pack_options.bilinear = True
        pack_options.create_image = False
        atlas.generate(chart_options, pack_options)
        vertex_map, indices, uvs = atlas[0]
        np.savez(work / WorkFiles.ATLAS, vertex_map=vertex_map, indices=indices.reshape(-1, 3), uvs=uvs)
        print(f"STAGE unwrap charts={atlas.chart_count} vertices={len(vertex_map)}")


class BakeStage(BuildStage):
    reads = (WorkFiles.HI_BLEND, WorkFiles.ATLAS, WorkFiles.LO)

    def run(self, config, work):
        settings = ModelSettings.from_config(config)
        bpy.ops.wm.open_mainfile(filepath=str(work / WorkFiles.HI_BLEND))
        high = bpy.data.objects["hi"]
        previous = bpy.data.objects["lo"]
        previous_mesh = previous.data
        bpy.data.objects.remove(previous)
        bpy.data.meshes.remove(previous_mesh)

        source = np.load(work / WorkFiles.LO)
        atlas = np.load(work / WorkFiles.ATLAS)
        vertex_map, faces, uvs = atlas["vertex_map"], atlas["indices"], atlas["uvs"]
        positions = source["positions"].astype(np.float64)[vertex_map]
        normals, repaired = repair_normals(
            positions, source["normals"].astype(np.float64)[vertex_map], settings.section("bake")
        )
        if repaired:
            print(f"CHECK repaired {repaired} zero-length vertex normals from their neighbours")
        low = self.build_split_mesh("lo", positions, normals, faces, uvs)
        if config["bakes"]:
            TextureBaker(high, low, config["textureSize"], settings).bake(work)
        else:
            for material in own_materials(config):
                low.data.materials.append(material)
            low.data.polygons.foreach_set("material_index", source["materials"])
            print("CHECK bake skipped: the materials keep their own textures")
        np.savez(
            work / WorkFiles.LO_SPLIT,
            positions=positions,
            normals=normals,
            uvs=uvs.astype(np.float64),
            faces=faces.astype(np.int64),
            materials=source["materials"] if not config["bakes"] else np.zeros(len(faces), np.int32),
            sourceMaterials=source["materials"],
        )
        save_blend(work / WorkFiles.LO_BLEND)
        print(f"STAGE bake {config['textureSize']}px vertices={len(positions)}")

    @staticmethod
    def build_split_mesh(name, positions, normals, faces, uvs):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(positions.tolist(), [], faces.tolist())
        mesh.update()
        uv_layer = mesh.uv_layers.new(name="UVMap")
        uv_layer.data.foreach_set("uv", uvs[faces.reshape(-1)].astype(np.float32).ravel())
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        mesh.normals_split_custom_set(normals[loop_vertex_indices(mesh)].tolist())
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        return obj


class SharedMaterialStage(BuildStage):
    reads = (WorkFiles.LO_BLEND, WorkFiles.ALBEDO)

    def run(self, config, work):
        bpy.ops.wm.open_mainfile(filepath=str(work / WorkFiles.LO_BLEND))
        texels, weights = surface_texels(bpy.data.objects["lo"], read_image(work / WorkFiles.ALBEDO))
        colour = np.average(srgb_to_linear(texels[:, :3]), axis=0, weights=weights)
        material = bpy.data.materials[TextureBaker.MATERIAL_NAME]
        principled = principled_node(material)
        base = principled.inputs["Base Color"]
        material.node_tree.nodes.remove(base.links[0].from_node)
        base.default_value = (*colour, 1.0)
        material["sharedMaterial"] = config["sharedMaterial"]
        save_blend(work / WorkFiles.LO_BLEND)
        print(f"STAGE shared-material {config['sharedMaterial']} linear base colour={rounded(colour, 4)}")


class ExportStage(BuildStage):
    reads = (WorkFiles.LO_BLEND,)

    def run(self, config, work):
        bpy.ops.wm.open_mainfile(filepath=str(work / WorkFiles.LO_BLEND))
        low = bpy.data.objects["lo"]
        material_tuning = tuning_section(config["tuning"], "material")
        for slot in low.material_slots:
            if slot.material is not None and slot.material.name == TextureBaker.MATERIAL_NAME:
                nodes = slot.material.node_tree.nodes
                principled = principled_node(slot.material)
                principled.inputs["Roughness"].default_value = material_tuning.roughness
                normal_map = next(node for node in nodes if node.type == "NORMAL_MAP")
                normal_map.inputs["Strength"].default_value = material_tuning.normalScale
        exported = self.export_objects(config, work, low)
        built_scale = Matrix.Scale(config["propScale"], 4)
        for obj in exported:
            obj.data.transform(built_scale)
            for key, value in config["extras"].items():
                obj[key] = value
            if "sockets" in config["extras"]:
                obj["sockets"] = scaled_sockets(config["extras"]["sockets"], config["propScale"])
            assert_unit_normals(read_attribute(obj.data.corner_normals, "vector", 3, np.float64))
        select_only(*exported)
        output = work / "out" / f"{config['name']}.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(output),
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_extras=True,
            export_attributes=True,
        )
        print(f"STAGE export {output} nodes={len(exported)}")

    def export_objects(self, config, work, low):
        return [low]


class ModuleExportStage(ExportStage):
    reads = (WorkFiles.LO_BLEND, WorkFiles.LO_SPLIT, WorkFiles.MODULES)

    def export_objects(self, config, work, low):
        split = np.load(work / WorkFiles.LO_SPLIT)
        modules = read_json(work / WorkFiles.MODULES)
        materials = [bpy.data.materials[TextureBaker.MATERIAL_NAME]] if config["bakes"] else own_materials(config)
        if config["sharedMaterial"] is not None:
            for material in materials:
                material["sharedMaterial"] = config["sharedMaterial"]
        slots = list(config["materials"])
        sway = config["sway"]
        swaying = np.isin(split["sourceMaterials"], [slots.index(name) for name in sway["materials"]])
        exported = []
        for module, faces in zip(modules, module_face_ranges(modules, len(split["faces"]))):
            used, remapped = np.unique(split["faces"][faces], return_inverse=True)
            positions = split["positions"][used] - to_blender(module["originMetres"])
            triangles = remapped.reshape(-1, 3)
            obj = BakeStage.build_split_mesh(
                module["name"],
                positions,
                split["normals"][used],
                triangles,
                split["uvs"][used],
            )
            if swaying[faces].any():
                weights = hang_weights(positions, triangles[swaying[faces]])
                obj.data.attributes.new(sway["attribute"], "FLOAT", "POINT").data.foreach_set("value", weights)
            for material in materials:
                obj.data.materials.append(material)
            obj.data.polygons.foreach_set("material_index", split["materials"][faces])
            for key, value in module["extras"].items():
                obj[key] = value
            obj["sockets"] = scaled_sockets(module["extras"]["sockets"], config["propScale"])
            exported.append(obj)
        return exported


class CloseupsStage(BuildStage):
    reads = (WorkFiles.LO_BLEND,)

    def run(self, config, work):
        bpy.ops.wm.open_mainfile(filepath=str(work / WorkFiles.LO_BLEND))
        high, low = bpy.data.objects["hi"], bpy.data.objects["lo"]
        shoot_sheet(Studio(), self.rows(config, work, high, low), work, "closeups")
        measurements = self.measurements(work, low)
        if measurements is not None:
            write_json(work / "validation" / WorkFiles.MEASUREMENTS, measurements, indent=2)
        print("STAGE closeups validation/closeups.png (original then low-poly rows)")

    def rows(self, config, work, high, low):
        shots = self.framed_shots(mesh_positions(low.data))
        return [(high, shots), (low, shots)]

    def measurements(self, work, low):
        measured = self.measure(low)
        baked = bpy.data.materials.get(TextureBaker.MATERIAL_NAME)
        normal_map = work / WorkFiles.NORMAL
        measured["sharedMaterial"] = baked.get("sharedMaterial") if baked is not None else None
        measured["normalDetail"] = self.normal_detail(low, normal_map) if normal_map.exists() else None
        return measured

    @staticmethod
    def normal_detail(low, normal_map):
        texels, weights = surface_texels(low, read_image(normal_map))
        offsets = np.linalg.norm(texels[:, :3] - FLAT_NORMAL, axis=1)
        return round(float(np.sqrt(np.average(offsets**2, weights=weights))), MEASUREMENT_DECIMALS)

    @staticmethod
    def framed_shots(positions):
        centre = tuple((positions.min(axis=0) + positions.max(axis=0)) / 2)
        scale = float(np.ptp(positions, axis=0).max()) * CLOSEUP_MARGIN
        return [(centre, scale, view) for view in CLOSEUP_VIEWS]

    @staticmethod
    def measure(low):
        mesh = low.data
        if mesh.uv_layers.active is None:
            raise ValueError(f"{low.name} has no UV map")
        mesh.calc_loop_triangles()
        material_indices = read_attribute(mesh.loop_triangles, "material_index", 1, np.int32).ravel()
        names = [slot.material.name if slot.material is not None else "" for slot in low.material_slots] or [""]
        gltf = to_gltf(mesh_positions(mesh))
        uvs = read_attribute(mesh.uv_layers.active.data, "uv", 2, np.float64)
        faces = mesh_corners(mesh)
        facing = triangle_crosses(gltf, faces).sum(axis=0)
        welded_positions, welded = np.unique(gltf, axis=0, return_inverse=True)
        edges, uses = unique_edges(face_edges(welded.reshape(-1)[faces]), with_counts=True)
        open_edges = welded_positions[edges[uses == 1]]
        return {
            "triangles": len(mesh.loop_triangles),
            "boundsMetres": {
                "min": rounded(gltf.min(axis=0), MEASUREMENT_DECIMALS),
                "max": rounded(gltf.max(axis=0), MEASUREMENT_DECIMALS),
            },
            "uvRange": {
                "min": rounded(uvs.min(axis=0), MEASUREMENT_DECIMALS),
                "max": rounded(uvs.max(axis=0), MEASUREMENT_DECIMALS),
            },
            "materialTriangles": {
                names[index]: int(count) for index, count in enumerate(np.bincount(material_indices)) if count
            },
            "openEdgeMetres": round(float(np.linalg.norm(open_edges[:, 1] - open_edges[:, 0], axis=1).sum()), MEASUREMENT_DECIMALS),
            "facingDegrees": round(math.degrees(math.atan2(facing[0], facing[2])), MEASUREMENT_DECIMALS),
            "alphaCutoffs": {
                slot.material.name: CloseupsStage.alpha_cutoff(slot.material)
                for slot in low.material_slots
                if slot.material is not None
            },
        }

    @staticmethod
    def alpha_cutoff(material):
        principled = principled_node(material)
        links = principled.inputs["Alpha"].links if principled is not None else []
        clip = links[0].from_node if links else None
        if clip is None or clip.type != "MATH" or clip.operation != "GREATER_THAN":
            return None
        return round(clip.inputs[1].default_value, MEASUREMENT_DECIMALS)


class ModuleCloseupsStage(CloseupsStage):
    reads = (WorkFiles.LO_BLEND, WorkFiles.MODULES)

    def rows(self, config, work, high, low):
        positions, faces = mesh_positions(low.data), mesh_corners(low.data)
        modules = read_json(work / WorkFiles.MODULES)
        rows = []
        for module_faces in module_face_ranges(modules, len(faces)):
            shots = self.framed_shots(positions[np.unique(faces[module_faces])])
            rows += [(high, shots), (low, shots)]
        return rows

    def measurements(self, work, low):
        measured = super().measurements(work, low)
        positions, faces = to_gltf(mesh_positions(low.data)), mesh_corners(low.data)
        modules = read_json(work / WorkFiles.MODULES)
        measured["modules"] = {}
        for module, module_faces in zip(modules, module_face_ranges(modules, len(faces))):
            local = positions - np.asarray(module["originMetres"])
            points = local[np.unique(faces[module_faces])]
            entry = {
                "triangles": len(faces[module_faces]),
                "boundsMetres": {
                    "min": rounded(points.min(axis=0), MEASUREMENT_DECIMALS),
                    "max": rounded(points.max(axis=0), MEASUREMENT_DECIMALS),
                },
                "sockets": module["extras"]["sockets"],
            }
            if module["extras"]["wallRunnable"]:
                crossed = triangle_crosses(local, faces[module_faces])
                doubled = np.linalg.norm(crossed, axis=1)
                kept = doubled > 0
                entry["faces"] = np.round(
                    np.c_[crossed[kept] / doubled[kept, None], doubled[kept] / 2], MEASUREMENT_DECIMALS
                ).tolist()
            measured["modules"][module["name"]] = entry
        return measured


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


def own_materials(config):
    return [bpy.data.materials[name] for name in config["materials"]]


def copy_low(high):
    low = high.copy()
    low.data = high.data.copy()
    low.name = "lo"
    low.data.name = "lo"
    bpy.context.collection.objects.link(low)
    return low


def save_low(low, work, bake_tuning):
    positions = mesh_positions(low.data)
    normals, repaired = repair_normals(
        positions, read_attribute(low.data.vertex_normals, "vector", 3, np.float64), bake_tuning
    )
    if repaired:
        low.data.normals_split_custom_set_from_vertices(normals.tolist())
        print(f"CHECK repaired {repaired} zero-length vertex normals from their neighbours")
    np.savez(
        work / WorkFiles.LO,
        positions=positions.astype(np.float32),
        normals=normals.astype(np.float32),
        faces=mesh_corners(low.data),
        materials=read_attribute(low.data.polygons, "material_index", 1, np.int32).ravel(),
        **({"uvs": vertex_uvs(low.data)} if low.data.uv_layers.active is not None else {}),
    )


def vertex_uvs(mesh):
    uvs = np.zeros((len(mesh.vertices), 2))
    uvs[loop_vertex_indices(mesh)] = read_attribute(mesh.uv_layers.active.data, "uv", 2, np.float64)
    return uvs


def surface_texels(obj, pixels):
    mesh = obj.data
    mesh.calc_loop_triangles()
    areas = triangle_areas(mesh_positions(mesh), read_attribute(mesh.loop_triangles, "vertices", 3, np.int32))
    uvs = read_attribute(mesh.uv_layers.active.data, "uv", 2, np.float64)
    corner_uvs = uvs[read_attribute(mesh.loop_triangles, "loops", 3, np.int32)]
    texels = sample_image(pixels, np.einsum("sk,tkc->tsc", SURFACE_SAMPLES, corner_uvs))
    return texels.reshape(-1, pixels.shape[2]), np.repeat(areas, len(SURFACE_SAMPLES))


def module_face_ranges(modules, face_count):
    covered = sum(module["faceCount"] for module in modules)
    if covered != face_count:
        raise ValueError(
            f"modules.json covers {covered} faces but the low mesh has {face_count}: rerun from the modules stage"
        )
    return [slice(module["firstFace"], module["firstFace"] + module["faceCount"]) for module in modules]


def build_kit(config, name, materials):
    previous = bpy.data.objects.get(name)
    if previous is not None:
        bpy.data.objects.remove(previous)
    high = materials is not None
    detail = tuning_section(config["tuning"], "kit")
    slots = {slot: index for index, slot in enumerate(config["materials"])}
    extents = [np.subtract(module["boundsMetres"]["max"], module["boundsMetres"]["min"]) for module in config["modules"]]
    gap = float(max(extent.max() for extent in extents))
    vertex_blocks, face_blocks, material_blocks, uv_blocks, modules = [], [], [], [], []
    has_cards = False
    vertex_count, face_count, start = 0, 0, 0.0
    for module, extent in zip(config["modules"], extents):
        origin = np.array([start - module["boundsMetres"]["min"][0], 0.0, start - module["boundsMetres"]["min"][2]])
        noise_offset = np.random.default_rng(module["noiseSeed"]).random(3) * NOISE_SEED_SPAN
        first_face = face_count
        for part in module["parts"]:
            local_vertices, local_faces = build_part(part)
            for transform in part["transforms"]:
                matrix = np.array(transform, dtype=np.float64).reshape(4, 4).T
                placed = to_blender(local_vertices @ matrix[:3, :3].T + matrix[:3, 3] + origin)
                vertices, faces = shape_part(placed, local_faces, part, detail, high, noise_offset)
                vertex_blocks.append(vertices)
                face_blocks.append(faces + vertex_count)
                is_card = part["sweep"] == "card"
                has_cards = has_cards or is_card
                uv_blocks.append(CARD_UVS if is_card else np.zeros((len(vertices), 2)))
                material_blocks.append(np.full(len(faces), slots[part["material"]], np.int32))
                vertex_count += len(vertices)
                face_count += len(faces)
        modules.append(
            {
                "name": module["name"],
                "extras": module["extras"],
                "firstFace": first_face,
                "faceCount": face_count - first_face,
                "originMetres": origin.tolist(),
            }
        )
        start += float(extent.max()) + gap
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(np.vstack(vertex_blocks).tolist(), [], np.vstack(face_blocks).tolist())
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    if has_cards:
        uv_layer = mesh.uv_layers.new(name="UVMap")
        uv_layer.data.foreach_set("uv", np.vstack(uv_blocks)[loop_vertex_indices(mesh)].astype(np.float32).ravel())
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.polygons.foreach_set("material_index", np.concatenate(material_blocks))
    if high:
        for material in materials:
            mesh.materials.append(material)
        weighting = obj.modifiers.new("weighted", "WEIGHTED_NORMAL")
        weighting.mode = "FACE_AREA"
        select_only(obj)
        bpy.ops.object.modifier_apply(modifier=weighting.name)
    mesh.update()
    return obj, modules


def build_part(part):
    vertices, faces = SWEEPS[part["sweep"]](part)
    return sag_sweep(vertices, faces, part["sag"]) if part["sag"] is not None else (vertices, faces)


def sag_sweep(vertices, faces, sag):
    shaped = bmesh.new()
    corners = [shaped.verts.new(vertex) for vertex in vertices]
    for face in faces:
        shaped.faces.new([corners[index] for index in face])
    across = [edge for edge in shaped.edges if math.isclose(edge.verts[0].co.x, edge.verts[1].co.x)]
    bmesh.ops.subdivide_edges(shaped, edges=across, cuts=sag["segments"] - 1, use_grid_fill=True)
    low, high = np.min(vertices, axis=0), np.max(vertices, axis=0)
    for vertex in shaped.verts:
        along = (vertex.co.y - low[1]) / (high[1] - low[1])
        across_depth = (vertex.co.z - low[2]) / (high[2] - low[2])
        vertex.co.x += sag["metres"] * 16 * along * (1 - along) * across_depth * (1 - across_depth)
    shaped.verts.index_update()
    positions = np.array([tuple(vertex.co) for vertex in shaped.verts], dtype=np.float64)
    sagged_faces = [[vertex.index for vertex in face.verts] for face in shaped.faces]
    shaped.free()
    return positions, sagged_faces


def shape_part(vertices, faces, part, detail, high, noise_offset):
    shaped = bmesh.new()
    corners = [shaped.verts.new(vertex) for vertex in vertices]
    for face in faces:
        shaped.faces.new([corners[index] for index in face])
    bmesh.ops.recalc_face_normals(shaped, faces=shaped.faces)
    if part["bevelMetres"] > 0:
        limit = math.radians(detail.bevelAngleDegrees)
        bmesh.ops.bevel(
            shaped,
            geom=[edge for edge in shaped.edges if edge.calc_face_angle(0.0) > limit],
            offset=part["bevelMetres"],
            offset_type="OFFSET",
            segments=detail.highBevelSegments if high else 1,
            profile=0.5,
            affect="EDGES",
            clamp_overlap=True,
        )
    if high and part["noise"] is not None:
        displace(shaped, part["noise"], detail, noise_offset)
    bmesh.ops.triangulate(shaped, faces=shaped.faces, ngon_method="EAR_CLIP")
    shaped.verts.index_update()
    positions = np.array([tuple(vertex.co) for vertex in shaped.verts], dtype=np.float64)
    triangles = np.array([[vertex.index for vertex in face.verts] for face in shaped.faces], dtype=np.int64)
    shaped.free()
    return positions, canonical_triangles(triangles)


def displace(shaped, settings, detail, noise_offset):
    bmesh.ops.triangulate(shaped, faces=shaped.faces)
    spacing = settings["featureMetres"] / detail.noiseSamplesPerFeature
    cuts = math.ceil(max(edge.calc_length() for edge in shaped.edges) / spacing) - 1
    if cuts > 0:
        bmesh.ops.subdivide_edges(shaped, edges=shaped.edges[:], cuts=cuts, use_grid_fill=True)
    print(f"CHECK noise subdivided {cuts} cuts per edge, {len(shaped.faces)} faces")
    shaped.normal_update()
    for vertex in shaped.verts:
        sample = Vector(np.asarray(vertex.co) / settings["featureMetres"] + noise_offset)
        vertex.co += vertex.normal * settings["amplitudeMetres"] * noise.noise(sample)


def extrude_sweep(part):
    profile = np.asarray(part["profile"], dtype=np.float64)
    count = len(profile)
    half = part["depth"] / 2
    vertices = np.vstack([np.c_[profile, np.full(count, half)], np.c_[profile, np.full(count, -half)]])
    sides = [(index, (index + 1) % count, count + (index + 1) % count, count + index) for index in range(count)]
    return vertices, [tuple(range(count)), tuple(range(2 * count - 1, count - 1, -1)), *sides]


def card_sweep(part):
    width, height = part["size"]
    vertices = np.array([[-width / 2, 0.0, 0.0], [width / 2, 0.0, 0.0], [width / 2, height, 0.0], [-width / 2, height, 0.0]])
    return vertices, [(0, 1, 2, 3)]


def loft_sweep(part):
    rings = np.asarray(part["rings"], dtype=np.float64)
    count, sides = rings.shape[:2]
    spans = count if part["closed"] else count - 1
    faces = [
        (ring * sides + index, ring * sides + (index + 1) % sides, ((ring + 1) % count) * sides + (index + 1) % sides, ((ring + 1) % count) * sides + index)
        for ring in range(spans)
        for index in range(sides)
    ]
    if not part["closed"]:
        faces += [tuple(range(sides)), tuple(range(count * sides - 1, (count - 1) * sides - 1, -1))]
    return rings.reshape(-1, 3), faces


def hang_weights(positions, cloth_triangles):
    keys = np.unique(np.round(positions * MILLIMETRES_PER_METRE).astype(np.int64), axis=0, return_inverse=True)[1].ravel()
    parents = np.arange(keys.max() + 1)

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for first, second, third in keys[cloth_triangles]:
        top = root(first)
        parents[root(second)] = top
        parents[root(third)] = top
    cloth = np.unique(cloth_triangles)
    pieces = np.array([root(key) for key in keys[cloth]])
    heights = positions[cloth, 2]
    tops = np.full(parents.size, -np.inf)
    bottoms = np.full(parents.size, np.inf)
    np.maximum.at(tops, pieces, heights)
    np.minimum.at(bottoms, pieces, heights)
    spans = tops[pieces] - bottoms[pieces]
    weights = np.zeros(len(positions), np.float32)
    weights[cloth] = np.where(spans > 0, (tops[pieces] - heights) / np.maximum(spans, 1e-9), 0.0)
    return weights


def scaled_sockets(sockets, scale):
    return [{"name": socket["name"], "at": [axis * scale for axis in socket["at"]]} for socket in sockets]


def srgb_to_linear(values):
    return np.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(values):
    return np.where(values <= 0.0031308, values * 12.92, 1.055 * np.power(values, 1 / 2.4) - 0.055)


def hex_colour(text):
    return np.array([int(text[index : index + 2], 16) for index in (1, 3, 5)]) / 255


def tile_uvs(obj, config):
    tiles = [
        GenerateStage.tile_metres(material) if material["kind"] == "tiled" else None
        for material in config["materials"].values()
    ]
    if not any(tiles):
        return
    split_angle = math.radians(tuning_section(config["tuning"], "kit").tileSplitAngleDegrees)
    mesh = obj.data
    split = bmesh.new()
    split.from_mesh(mesh)
    hard = [
        edge
        for edge in split.edges
        if len(edge.link_faces) == 2
        and (
            edge.calc_face_angle() > split_angle
            or edge.link_faces[0].material_index != edge.link_faces[1].material_index
        )
    ]
    bmesh.ops.split_edges(split, edges=hard)
    split.to_mesh(mesh)
    split.free()
    uv_layer = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
    positions = mesh_positions(mesh)
    up = np.array([0.0, 0.0, 1.0])
    for polygon in mesh.polygons:
        tile = tiles[polygon.material_index]
        if tile is None:
            continue
        normal = np.array(polygon.normal)
        along = np.cross(up, normal)
        along = along / np.linalg.norm(along) if np.linalg.norm(along) > TILE_AXIS_EPSILON else np.array([1.0, 0.0, 0.0])
        across = np.cross(normal, along)
        for loop in polygon.loop_indices:
            point = positions[mesh.loops[loop].vertex_index]
            uv_layer.data[loop].uv = (float(point @ along) / tile, float(point @ across) / tile)
    mesh.update()


def lathe_sweep(part):
    sides = part["sides"]
    angles = 2 * np.pi * np.arange(sides) / sides
    vertices, rings = [], []
    for radius, height in part["profile"]:
        if radius == 0:
            rings.append([len(vertices)])
            vertices.append((0.0, height, 0.0))
        else:
            rings.append(list(range(len(vertices), len(vertices) + sides)))
            vertices.extend((radius * math.cos(angle), height, radius * math.sin(angle)) for angle in angles)
    faces = []
    for lower, upper in zip(rings, rings[1:]):
        for index in range(sides):
            following = (index + 1) % sides
            quad = (
                lower[index % len(lower)],
                lower[following % len(lower)],
                upper[following % len(upper)],
                upper[index % len(upper)],
            )
            faces.append(tuple(dict.fromkeys(quad)))
    return np.array(vertices, dtype=np.float64), faces


def import_high(config, objects):
    source = Path(config["source"]).expanduser()
    reset_scene()
    if source.suffix.lower() == ".blend":
        with bpy.data.libraries.load(str(source)) as (library, loaded):
            loaded.objects = list(library.objects)
        for obj in loaded.objects:
            bpy.context.scene.collection.objects.link(obj)
        imported = list(loaded.objects)
    else:
        imported = import_model(source)
    found = [obj for obj in imported if obj.type == "MESH"]
    for mesh in found:
        size = mesh.dimensions
        materials = [slot.material.name for slot in mesh.material_slots if slot.material is not None]
        print(f"CHECK mesh {mesh.name} size=({size.x:.3f},{size.y:.3f},{size.z:.3f}) materials={materials}")
    meshes = [mesh for mesh in found if objects is None or mesh.name in objects]
    missing = [] if objects is None else sorted(set(objects) - {mesh.name for mesh in meshes})
    if not meshes or missing:
        raise ValueError(f"{source}: no meshes {missing or ''} (meshes: {sorted(mesh.name for mesh in found)})")
    for mesh in meshes:
        mesh.animation_data_clear()
        detach_keep_world(mesh)
    for obj in imported:
        if obj not in meshes:
            bpy.data.objects.remove(obj)
    select_only(meshes[0], *meshes[1:])
    if len(meshes) > 1:
        bpy.ops.object.join()
    high = bpy.context.view_layer.objects.active
    high.name = "hi"
    high.rotation_mode = "XYZ"
    high.rotation_euler = (0.0, 0.0, math.radians(config["facingYawDegrees"]))
    select_only(high)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return high


def detach_keep_world(obj):
    world_matrix = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = world_matrix


def normalise_high(high, config):
    positions = mesh_positions(high.data)
    if config["heightMetres"] is not None:
        positions *= config["heightMetres"] / np.ptp(positions[:, 2])
    positions[:, 2] -= positions[:, 2].min()
    for axis in (0, 1):
        positions[:, axis] -= (positions[:, axis].min() + positions[:, axis].max()) / 2
    write_positions(high.data, positions)
    high.data.update()
    return positions


def fill_missing_triangles(low):
    filled = bmesh.new()
    filled.from_mesh(low.data)
    extent = float(np.ptp(np.array([tuple(vertex.co) for vertex in filled.verts]), axis=0).max())
    bmesh.ops.dissolve_degenerate(filled, dist=extent * DEGENERATE_EDGE_SHARE, edges=filled.edges)
    fins = [
        face
        for face in filled.faces
        if any(edge.is_boundary for edge in face.edges)
        and any(len(edge.link_faces) > 2 for edge in face.edges)
    ]
    bmesh.ops.delete(filled, geom=fins, context="FACES")
    bmesh.ops.holes_fill(filled, edges=[edge for edge in filled.edges if edge.is_boundary], sides=3)
    bmesh.ops.triangulate(filled, faces=filled.faces)
    filled.to_mesh(low.data)
    filled.free()


def weld_high(high):
    welded = bmesh.new()
    welded.from_mesh(high.data)
    bmesh.ops.remove_doubles(welded, verts=welded.verts, dist=WELD_DISTANCE)
    extent = float(np.ptp(np.array([tuple(vertex.co) for vertex in welded.verts]), axis=0).max())
    crack_ends = list({vertex for edge in welded.edges if edge.is_boundary for vertex in edge.verts})
    bmesh.ops.remove_doubles(welded, verts=crack_ends, dist=extent * CRACK_SEAL_SHARE)
    welded.to_mesh(high.data)
    welded.free()


def repair_normals(positions, normals, tuning):
    broken = np.linalg.norm(normals, axis=1) < tuning.minNormalLength
    if not broken.any():
        return normals, 0
    healthy = np.nonzero(~broken)[0]
    donors = healthy[cKDTree(positions[healthy]).query(positions[broken], k=tuning.normalDonorCount)[1]]
    repaired = normals.copy()
    repaired[broken] = normals[donors].mean(axis=1)
    repaired[broken] /= np.linalg.norm(repaired[broken], axis=1, keepdims=True)
    return repaired, int(broken.sum())


def assert_unit_normals(normals):
    normal_error = float(np.abs(np.linalg.norm(normals, axis=1) - 1.0).max())
    if not normal_error <= NORMAL_UNIT_TOLERANCE:
        raise ValueError(
            f"vertex normals are not unit length (worst error {normal_error:.3f}): a shader divides by them and "
            f"outputs NaN"
        )


def shoot_tile(studio, sheet, work, name, column, row, centre, scale, view):
    path = work / "validation" / f"{name}_{column}_{row}.png"
    studio.shot(centre, scale, view, path, sheet.tile)
    sheet.place(path, column, row)
    path.unlink()


def shoot_sheet(studio, rows, work, name, tile=TILE):
    sheet = ContactSheet(max(len(shots) for _, shots in rows), len(rows), tile)
    shown = [visible for visible, _ in rows if visible is not None]
    for row, (visible, shots) in enumerate(rows):
        for obj in shown:
            obj.hide_render = obj is not visible
        for column, (centre, scale, view) in enumerate(shots):
            shoot_tile(studio, sheet, work, name, column, row, centre, scale, view)
    sheet.save(work / "validation" / f"{name}.png")


def stage_registry():
    classes, pending = set(), [BuildStage]
    while pending:
        children = [child for child in pending.pop().__subclasses__() if child not in classes]
        classes.update(children)
        pending.extend(children)
    stages = {}
    for stage_class in classes:
        if inspect.isabstract(stage_class):
            continue
        name = re.sub(r"(?<!^)(?=[A-Z])", "-", stage_class.__name__.removesuffix("Stage")).lower()
        if name in stages:
            raise ValueError(f"{stages[name].__name__} and {stage_class.__name__} share the stage name {name}")
        stages[name] = stage_class
    return stages


def run_stages(stage_names, recipe_file, work_root):
    stages = stage_registry()
    unknown = [name for name in stage_names if name not in stages]
    if unknown:
        raise ValueError(f"no stage {', '.join(unknown)} (stages: {', '.join(sorted(stages))})")
    work = Path(work_root)
    for index, stage_name in enumerate(stage_names):
        missing = [file for file in stages[stage_name].reads if not (work / file).exists()]
        if missing:
            raise FileNotFoundError(f"stage {stage_name} needs {', '.join(missing)}: run the earlier stages first")
        if index > 0:
            bpy.ops.wm.read_factory_settings(use_empty=False)
        stages[stage_name]().run(read_json(recipe_file), work)


SWEEPS = {"extrude": extrude_sweep, "lathe": lathe_sweep, "loft": loft_sweep, "card": card_sweep}

MATERIAL_BUILDERS = {
    "baked": GenerateStage.baked_material,
    "cutout": GenerateStage.cutout_material,
    "tiled": GenerateStage.tiled_material,
}
