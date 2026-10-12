import json
import math

import bpy
import numpy as np
from mathutils import Vector
from scipy.spatial import cKDTree

import PhysicsLattice as lattice
from Geometry import compose, matrices_to_blender, normalised, quaternion_matrix, to_blender
from ModelConfig import Proportions, SkeletonDescriptor

WELD_DECIMALS = 5
TILE = 360


def select_only(active, *others):
    for obj in bpy.data.objects:
        obj.select_set(False)
    for obj in (active, *others):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active


def read_attribute(items, name, columns, dtype):
    values = np.zeros(len(items) * columns, dtype)
    items.foreach_get(name, values)
    return values.reshape(-1, columns)


def mesh_positions(mesh):
    return read_attribute(mesh.vertices, "co", 3, np.float32).astype(np.float64)


def decimate(obj, ratio):
    modifier = obj.modifiers.new("decimate", "DECIMATE")
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    select_only(obj)
    bpy.ops.object.modifier_apply(modifier="decimate")


def mesh_corners(mesh):
    return read_attribute(mesh.polygons, "vertices", 3, np.int32)


def loop_vertex_indices(mesh):
    return read_attribute(mesh.loops, "vertex_index", 1, np.int32).ravel()


def write_positions(mesh, positions):
    mesh.vertices.foreach_set("co", positions.astype(np.float32).ravel())


class PhysicsWork:
    DEFINITION_FILE = "physics.json"
    WEIGHTS_FILE = "physics_weights.npz"

    def __init__(self, work):
        self.definition = json.loads((work / self.DEFINITION_FILE).read_text())
        self.weights = dict(np.load(work / self.WEIGHTS_FILE))

    @classmethod
    def optional(cls, work):
        return cls(work) if (work / cls.DEFINITION_FILE).exists() else None

    @classmethod
    def save(cls, work, bodies, colliders, skinning, geometry):
        lattice_bones = [name for body in bodies for name in body["nodeBones"]]
        (work / cls.DEFINITION_FILE).write_text(
            json.dumps({"latticeBones": lattice_bones, "bodies": bodies, "colliders": colliders}, indent=2)
        )
        np.savez(
            work / cls.WEIGHTS_FILE,
            nodes=skinning["nodes"],
            weights=skinning["weights"],
            blend=skinning["blend"],
            labels=skinning["labels"],
            garment=geometry["garment"],
            mantle=geometry["mantle"],
            rim=geometry["rim"],
            sheet_distance=geometry["sheet_distance"],
            detached=geometry["detached"],
        )


def weld_labels(work):
    props = np.load(work / "props.npy").astype(np.int64)
    physics = PhysicsWork.optional(work)
    return props * 16 + physics.weights["labels"].astype(np.int64) if physics else props


def weld_ids(positions, objects):
    keys = np.c_[np.round(positions, WELD_DECIMALS), objects]
    _, first, welded = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    return welded.ravel(), first


class Skeleton:
    UNIT_SCALE_TOLERANCE = 1e-4

    def __init__(self, data, descriptor):
        self.descriptor = descriptor
        nodes = data["nodes"]
        self.names = [node["name"] for node in nodes]
        self.index = {name: index for index, name in enumerate(self.names)}
        self.parents = [node["parent"] for node in nodes]
        self.rest_translations = np.array([node["translation"] for node in nodes], np.float64)
        self.rest_rotations = np.array([node["rotation"] for node in nodes], np.float64)
        self.rest_scales = np.array([node["scale"] for node in nodes], np.float64)
        self.skin = data["skin"]
        self.height = data["height"]
        self.clips = data["clips"]
        if np.abs(self.rest_scales - 1.0).max() > self.UNIT_SCALE_TOLERANCE:
            raise ValueError("the skeleton has scaled joints; the fit assumes unit scale")

    @classmethod
    def load(cls, work, descriptor):
        data = json.loads((work / "skeleton.json").read_text())
        physics = PhysicsWork.optional(work)
        if physics:
            data = Skeleton.with_lattice_bones(data, physics.definition)
        return cls(data, descriptor)

    def world(self, translations, rotations, scales=None):
        scales = self.rest_scales if scales is None else scales
        matrices = np.zeros((len(self.names), 4, 4))
        for index, parent in enumerate(self.parents):
            local = compose(translations[index], rotations[index], scales[index])
            matrices[index] = local if parent < 0 else matrices[parent] @ local
        return matrices

    def rest_world(self):
        return self.world(self.rest_translations, self.rest_rotations)

    def children(self, name):
        index = self.index[name]
        return [self.names[child] for child, parent in enumerate(self.parents) if parent == index]

    def descendants(self, name):
        found = []
        for child in self.children(name):
            found += [child, *self.descendants(child)]
        return found

    def final_bone(self, name):
        while True:
            if name == self.descriptor.root:
                name = self.descriptor.pelvis
            elif self.descriptor.leaf_marker in name:
                name = self.names[self.parents[self.index[name]]]
            elif name.split("_")[0] in self.descriptor.finger_bones:
                name = self.descriptor.hand_for_bone(name)
            else:
                return name

    @staticmethod
    def with_lattice_bones(data, physics):
        nodes = list(data["nodes"])
        index = {node["name"]: row for row, node in enumerate(nodes)}
        skin = list(data["skin"])
        for body in physics["bodies"]:
            for name in body["nodeBones"]:
                nodes.append({"name": name, "parent": index[body["attachBone"]], "translation": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0, 1.0], "scale": [1.0, 1.0, 1.0]})
                index[name] = len(nodes) - 1
                skin.append(name)
        return {**data, "nodes": nodes, "skin": skin}


class SkeletonFit:
    def __init__(self, skeleton, targets, placed=()):
        descriptor = skeleton.descriptor
        chains = descriptor.chains
        placed_joints = descriptor.placed_joints
        hand_bones = tuple(descriptor.arm(side)[-1] for side in descriptor.SIDES)
        self.segment_tails = descriptor.segment_tails
        self.chains = chains
        names, index = skeleton.names, skeleton.index
        rest_world = skeleton.rest_world()
        rest_positions = {name: rest_world[row][:3, 3] for row, name in enumerate(names)}
        self.leg_ratio = float(np.mean([self.leg_length(descriptor, targets, side) / self.leg_length(descriptor, rest_positions, side) for side in descriptor.SIDES]))
        rest_translations = skeleton.rest_translations.copy()
        rest_translations[index[descriptor.pelvis]] *= self.leg_ratio
        bind_translations = rest_translations.copy()
        bind_rotations = skeleton.rest_rotations.copy()
        world = np.zeros((len(names), 4, 4))

        for row, name in enumerate(names):
            parent = skeleton.parents[row]
            parent_world = np.eye(4) if parent < 0 else world[parent]
            if name in placed_joints or name in placed:
                bind_translations[row] = (np.linalg.inv(parent_world) @ np.r_[targets[name], 1.0])[:3]
                if name != descriptor.pelvis:
                    rest_translations[row] = bind_translations[row]
            else:
                bind_translations[row] = rest_translations[row]
            world[row] = parent_world @ compose(bind_translations[row], bind_rotations[row], skeleton.rest_scales[row])

            child = chains.get(name)
            if child is not None:
                column = index[child]
                ratio = np.linalg.norm(targets[child] - world[row][:3, 3]) / np.linalg.norm(rest_translations[column])
                for scaled in skeleton.descendants(name) if name in hand_bones else [child]:
                    rest_translations[index[scaled]] *= ratio
                local_direction = rest_translations[column]
                target = targets[child]
            elif name == descriptor.head:
                local_direction = rest_world[row][:3, :3].T @ np.array([0.0, 1.0, 0.0])
                target = targets[descriptor.head_top]
            else:
                continue
            current = normalised(world[row][:3, :3] @ local_direction)
            desired = normalised(target - world[row][:3, 3])
            world_rotation = quaternion_matrix(self.quaternion_between(current, desired)) @ world[row][:3, :3]
            bind_rotations[row] = self.matrix_quaternion(parent_world[:3, :3].T @ world_rotation)
            world[row] = parent_world @ compose(bind_translations[row], bind_rotations[row], skeleton.rest_scales[row])

        self.skeleton = skeleton
        self.rest_translations = rest_translations
        self.bind_world = world
        self.targets = targets
        self.miss = {
            name: float(np.linalg.norm(world[index[name]][:3, 3] - target))
            for name, target in targets.items() if name in index
        }

    def segments(self):
        skeleton = self.skeleton
        heads = {name: to_blender(self.bind_world[row][:3, 3]) for row, name in enumerate(skeleton.names)}
        tails = {}
        for name in skeleton.names:
            tail = self.chains.get(name) or self.segment_tails.get(name) or next((child for child in skeleton.children(name) if not child.startswith(lattice.LATTICE_PREFIX)), None)
            if tail in heads:
                tails[name] = heads[tail]
            elif tail is not None:
                tails[name] = to_blender(self.targets[tail])
        return heads, tails

    @staticmethod
    def matrix_quaternion(matrix):
        trace = np.trace(matrix)
        if trace > 0:
            s = math.sqrt(trace + 1.0) * 2
            quaternion = [(matrix[2, 1] - matrix[1, 2]) / s, (matrix[0, 2] - matrix[2, 0]) / s, (matrix[1, 0] - matrix[0, 1]) / s, 0.25 * s]
        elif matrix[0, 0] > matrix[1, 1] and matrix[0, 0] > matrix[2, 2]:
            s = math.sqrt(1.0 + matrix[0, 0] - matrix[1, 1] - matrix[2, 2]) * 2
            quaternion = [0.25 * s, (matrix[0, 1] + matrix[1, 0]) / s, (matrix[0, 2] + matrix[2, 0]) / s, (matrix[2, 1] - matrix[1, 2]) / s]
        elif matrix[1, 1] > matrix[2, 2]:
            s = math.sqrt(1.0 + matrix[1, 1] - matrix[0, 0] - matrix[2, 2]) * 2
            quaternion = [(matrix[0, 1] + matrix[1, 0]) / s, 0.25 * s, (matrix[1, 2] + matrix[2, 1]) / s, (matrix[0, 2] - matrix[2, 0]) / s]
        else:
            s = math.sqrt(1.0 + matrix[2, 2] - matrix[0, 0] - matrix[1, 1]) * 2
            quaternion = [(matrix[0, 2] + matrix[2, 0]) / s, (matrix[1, 2] + matrix[2, 1]) / s, 0.25 * s, (matrix[1, 0] - matrix[0, 1]) / s]
        return normalised(np.array(quaternion))

    @staticmethod
    def quaternion_between(start, end):
        cosine = float(start @ end)
        if cosine < -1.0 + 1e-9:
            axis = np.cross(start, [1.0, 0.0, 0.0])
            if np.linalg.norm(axis) < 1e-6:
                axis = np.cross(start, [0.0, 1.0, 0.0])
            return np.array([*normalised(axis), 0.0])
        return normalised(np.array([*np.cross(start, end), 1.0 + cosine]))

    @staticmethod
    def leg_length(descriptor, positions, side):
        hip, knee, ankle = (positions[bone] for bone in descriptor.leg(side))
        return float(np.linalg.norm(knee - hip) + np.linalg.norm(ankle - knee) + ankle[1])


class ClipPoses:
    POSE_SAMPLES_PER_CLIP = 10
    TRACK_VARIANCE_EPSILON = 1e-4

    def __init__(self, skeleton, rest_translations):
        self.skeleton = skeleton
        self.rest_translations = rest_translations
        pelvis_length = float(np.linalg.norm(rest_translations[skeleton.index[skeleton.descriptor.pelvis]]))
        self.clips = {}
        for name, clip in skeleton.clips.items():
            ratio = pelvis_length / float(np.linalg.norm(clip["pelvisRest"])) if clip["pelvisRest"] else 1.0
            channels = []
            for channel in clip["channels"]:
                if channel["node"] not in skeleton.index:
                    continue
                if channel["interpolation"] not in ("LINEAR", "STEP"):
                    raise ValueError(f"{name}: {channel['interpolation']} interpolation is not supported by the QA sampler")
                times = np.array(channel["times"])
                values = np.array(channel["values"]).reshape(len(times), -1)
                if channel["path"] == "translation":
                    if channel["node"] == skeleton.descriptor.root or np.abs(values - values[0]).max() <= self.TRACK_VARIANCE_EPSILON:
                        continue
                    values = values * ratio
                channels.append((skeleton.index[channel["node"]], channel["path"], channel["interpolation"] == "STEP", times, values))
            duration = max((times[-1] for _, _, _, times, _ in channels), default=0.0)
            self.clips[name] = (duration, channels)

    def duration(self, clip):
        return self.clips[clip][0]

    def sample(self, clip, time):
        translations = self.rest_translations.copy()
        rotations = self.skeleton.rest_rotations.copy()
        scales = self.skeleton.rest_scales.copy()
        for row, kind, stepped, times, values in self.clips[clip][1]:
            target = {"translation": translations, "rotation": rotations, "scale": scales}[kind]
            if len(times) == 1:
                target[row] = values[0]
                continue
            after = int(np.clip(np.searchsorted(times, time, side="right"), 1, len(times) - 1))
            span = times[after] - times[after - 1]
            amount = float(np.clip((time - times[after - 1]) / span, 0.0, 1.0)) if span > 0 else 0.0
            if stepped:
                value = values[after] if amount >= 1.0 else values[after - 1]
            elif kind == "rotation":
                value = self.slerp(normalised(values[after - 1]), normalised(values[after]), amount)
            else:
                value = values[after - 1] + (values[after] - values[after - 1]) * amount
            target[row] = value
        return self.skeleton.world(translations, rotations, scales)

    def all(self):
        for clip, (duration, _) in self.clips.items():
            for time in np.linspace(0.0, duration, self.POSE_SAMPLES_PER_CLIP + 1):
                yield f"{clip}:{time:.2f}", self.sample(clip, time)

    @staticmethod
    def slerp(start, end, amount):
        cosine = float(start @ end)
        if cosine < 0.0:
            end, cosine = -end, -cosine
        if cosine > 0.9995:
            return normalised(start + (end - start) * amount)
        angle = math.acos(cosine)
        return (math.sin((1 - amount) * angle) * start + math.sin(amount * angle) * end) / math.sin(angle)


class ReferenceFrame:
    REFERENCE_ICP_ITERATIONS = 30
    REFERENCE_ICP_TRIM = 0.8
    REFERENCE_ICP_SAMPLES = 150_000

    def __init__(self, points, target, facing_yaw_degrees, height):
        yaw = math.radians(facing_yaw_degrees)
        self.rotation = np.array([[math.cos(yaw), -math.sin(yaw), 0.0], [math.sin(yaw), math.cos(yaw), 0.0], [0.0, 0.0, 1.0]])
        turned = points @ self.rotation.T
        self.scale = height / np.ptp(turned[:, 2])
        turned *= self.scale
        self.shift = np.zeros(3)
        self.shift[2] = -turned[:, 2].min()
        for axis in (0, 1):
            self.shift[axis] = (target[:, axis].min() + target[:, axis].max()) / 2 - (turned[:, axis].min() + turned[:, axis].max()) / 2
        tree = cKDTree(target)
        sample = np.random.default_rng(0).choice(len(points), min(len(points), self.REFERENCE_ICP_SAMPLES), replace=False)
        for _ in range(self.REFERENCE_ICP_ITERATIONS):
            moved = self.apply(points[sample])
            distance, nearest = tree.query(moved)
            kept = distance <= np.quantile(distance, self.REFERENCE_ICP_TRIM)
            source_centre, target_centre = moved[kept].mean(0), target[nearest[kept]].mean(0)
            gain = ((moved[kept] - source_centre) * (target[nearest[kept]] - target_centre)).sum() / ((moved[kept] - source_centre) ** 2).sum()
            self.scale *= gain
            self.shift = gain * self.shift + target_centre - gain * source_centre
        distance = tree.query(self.apply(points[sample]))[0]
        self.residual = (float(distance.mean()), float(np.quantile(distance, 0.99)))

    def apply(self, points):
        return (np.asarray(points) @ self.rotation.T) * self.scale + self.shift


class TextureBaker:
    def __init__(self, high, low, size, settings):
        self.settings = settings
        self.tuning = settings.section("bake")
        self.high = high
        self.low = low
        self.size = size
        self.target = None

    def bake(self, work):
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = self.tuning.samples
        scene.cycles.use_denoising = False
        material = bpy.data.materials.new("baked")
        material.use_nodes = True
        self.low.data.materials.append(material)
        self.target = material.node_tree.nodes.new("ShaderNodeTexImage")
        material.node_tree.nodes.active = self.target
        sources = self.base_colour_emissions()
        self.route(sources, to_emission=True)
        albedo = self.bake_pass("EMIT", "albedo", "sRGB", work)
        self.route(sources, to_emission=False)
        normal = self.bake_pass("NORMAL", "normal", "Non-Color", work, normal_space="TANGENT")
        self.wire_baked_material(material, albedo, normal)

    def base_colour_emissions(self):
        sources = []
        for slot in self.high.material_slots:
            if slot.material is None or not slot.material.use_nodes:
                continue
            tree = slot.material.node_tree
            bsdf = next((node for node in tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
            output = next((node for node in tree.nodes if node.type == "OUTPUT_MATERIAL"), None)
            if bsdf is None or output is None:
                continue
            emission = tree.nodes.new("ShaderNodeEmission")
            base = bsdf.inputs["Base Color"]
            if base.links:
                tree.links.new(base.links[0].from_socket, emission.inputs["Color"])
            else:
                emission.inputs["Color"].default_value = base.default_value
            sources.append((tree, bsdf, output, emission))
        if not sources:
            raise ValueError("the source model has no Principled BSDF material to bake from")
        return sources

    @staticmethod
    def route(sources, to_emission):
        for tree, bsdf, output, emission in sources:
            tree.links.new((emission if to_emission else bsdf).outputs[0], output.inputs["Surface"])

    def bake_pass(self, kind, name, colour_space, work, **options):
        image = bpy.data.images.new(name, self.size, self.size, alpha=False)
        image.colorspace_settings.name = colour_space
        self.target.image = image
        select_only(self.low, self.high)
        bpy.ops.object.bake(
            type=kind,
            use_selected_to_active=True,
            cage_extrusion=self.settings.length(self.tuning.cageExtrusion),
            max_ray_distance=self.settings.length(self.tuning.rayDistance),
            margin=self.tuning.marginPixels,
            margin_type="EXTEND",
            use_clear=True,
            **options,
        )
        image.filepath_raw = str(work / f"{name}.png")
        image.file_format = "PNG"
        image.save()
        return image

    def wire_baked_material(self, material, albedo, normal):
        tree = material.node_tree
        for node in list(tree.nodes):
            if node.type != "OUTPUT_MATERIAL":
                tree.nodes.remove(node)
        output = next(node for node in tree.nodes if node.type == "OUTPUT_MATERIAL")
        bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Roughness"].default_value = self.tuning.roughness
        albedo_node = tree.nodes.new("ShaderNodeTexImage")
        albedo_node.image = albedo
        normal_node = tree.nodes.new("ShaderNodeTexImage")
        normal_node.image = normal
        normal_map = tree.nodes.new("ShaderNodeNormalMap")
        tree.links.new(albedo_node.outputs["Color"], bsdf.inputs["Base Color"])
        tree.links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
        tree.links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
        tree.links.new(bsdf.outputs[0], output.inputs["Surface"])


ORTHO_VIEWS = {
    "front": ((0.0, -1.0, 0.0), (math.pi / 2, 0.0, 0.0)),
    "back": ((0.0, 1.0, 0.0), (math.pi / 2, 0.0, math.pi)),
    "side": ((1.0, 0.0, 0.0), (math.pi / 2, 0.0, math.pi / 2)),
}


def ortho_pose(view, centre, distance):
    direction, rotation = ORTHO_VIEWS[view]
    return tuple(centre[axis] + distance * direction[axis] for axis in range(3)), rotation


def add_ortho_camera(name, scale=None):
    data = bpy.data.cameras.new(name)
    data.type = "ORTHO"
    if scale is not None:
        data.ortho_scale = scale
    camera = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    return camera


class Studio:
    CAMERA_DISTANCE = 5.0


    def __init__(self, samples=12, engine="CYCLES"):
        scene = bpy.context.scene
        scene.render.engine = engine
        if engine == "CYCLES":
            scene.cycles.device = "CPU"
            scene.cycles.samples = samples
            scene.cycles.use_denoising = False
        scene.world = bpy.data.worlds.new("qa_world")
        scene.world.color = (0.55, 0.55, 0.6)
        for name, energy, tilt, turn in (("qa_key", 3.2, 50, -35), ("qa_fill", 1.5, 60, 140)):
            light = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
            light.data.energy = energy
            light.rotation_euler = (math.radians(tilt), 0.0, math.radians(turn))
            scene.collection.objects.link(light)
        self.camera = add_ortho_camera("qa_camera")

    def shot(self, centre, scale, view, path, size=TILE):
        scene = bpy.context.scene
        scene.render.resolution_x = size
        scene.render.resolution_y = size
        self.camera.data.ortho_scale = scale
        self.camera.location, self.camera.rotation_euler = ortho_pose(view, centre, self.CAMERA_DISTANCE)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)


class ContactSheet:
    def __init__(self, columns, rows, tile=TILE):
        self.columns = columns
        self.rows = rows
        self.tile = tile
        self.pixels = np.zeros((rows * tile, columns * tile, 4), np.float32)
        self.pixels[..., 3] = 1.0

    def place(self, path, column, row):
        image = bpy.data.images.load(str(path))
        width, height = image.size
        data = np.empty(width * height * 4, np.float32)
        image.pixels.foreach_get(data)
        data = data.reshape(height, width, 4)
        bottom = (self.rows - 1 - row) * self.tile
        rows, columns = min(height, self.tile), min(width, self.tile)
        self.pixels[bottom:bottom + rows, column * self.tile:column * self.tile + columns] = data[:rows, :columns]
        bpy.data.images.remove(image)

    def save(self, path):
        image = bpy.data.images.new("contact_sheet", self.columns * self.tile, self.rows * self.tile, alpha=True)
        image.pixels.foreach_set(self.pixels.ravel())
        image.filepath_raw = str(path)
        image.file_format = "PNG"
        image.save()
        bpy.data.images.remove(image)


class SkinnedPreview:
    def __init__(self, work, config):
        self.descriptor = SkeletonDescriptor.from_config(config)
        self.proportions = Proportions.from_config(config)
        bpy.ops.wm.open_mainfile(filepath=str(work / "lo.blend"))
        bpy.data.objects.remove(bpy.data.objects["hi"])
        self.mesh = bpy.data.objects["lo"].data
        final = np.load(work / "final.npz")
        rig = np.load(work / "rig.npz")
        self.skeleton = Skeleton.load(work, self.descriptor)
        self.poses = ClipPoses(self.skeleton, rig["rest_translations"])
        self.bind_inverse = np.linalg.inv(rig["bind_world"])
        self.joints = final["joints"]
        self.weights = final["weights"]
        self.rest = mesh_positions(self.mesh)
        self.rest_normals = np.load(work / "lo_split.npz")["normals"]
        self.loop_vertices = loop_vertex_indices(self.mesh)
        self.world = rig["bind_world"]
        welded, first = weld_ids(self.rest, weld_labels(work))
        partner = first[welded]
        duplicates = np.nonzero(partner != np.arange(len(partner)))[0]
        self.seam_pairs = (duplicates, partner[duplicates])

    def joint(self, name):
        return Vector(to_blender(self.world[self.skeleton.index[name]][:3, 3]))

    def pose(self, clip, fraction):
        self.world = self.poses.sample(clip, fraction * self.poses.duration(clip))
        skinning = matrices_to_blender(self.world @ self.bind_inverse)
        blended = np.einsum("nk,nkij->nij", self.weights, skinning[self.joints])
        positions = np.einsum("nij,nj->ni", blended, np.c_[self.rest, np.ones(len(self.rest))])[:, :3]
        normals = np.einsum("nij,nj->ni", blended[:, :3, :3], self.rest_normals)
        normals /= np.linalg.norm(normals, axis=1, keepdims=True)
        self.apply(positions, normals)
        duplicates, partners = self.seam_pairs
        return float(np.linalg.norm(positions[duplicates] - positions[partners], axis=1).max()) if len(duplicates) else 0.0

    def apply(self, positions, normals):
        write_positions(self.mesh, positions)
        self.mesh.normals_split_custom_set(normals[self.loop_vertices].tolist())
        self.mesh.update()

    def region_centres(self):
        descriptor, length = self.descriptor, self.proportions.length
        left_hand, right_hand = (descriptor.arm(side)[-1] for side in descriptor.SIDES)
        return {
            "face": (self.joint(descriptor.head) + Vector((0.0, 0.0, length(0.08))), length(0.36), "front"),
            "hand_l": (self.joint(left_hand) + Vector((0.0, 0.0, length(-0.08))), length(0.34), "front"),
            "hand_r": (self.joint(right_hand) + Vector((0.0, 0.0, length(-0.08))), length(0.34), "front"),
            "back": (self.joint(descriptor.chest) + Vector((0.0, 0.0, length(0.05))), length(1.0), "back"),
            "chest": (self.joint(descriptor.chest) + Vector((0.0, 0.0, length(0.02))), length(0.62), "front"),
            "legs": (self.joint(descriptor.pelvis) * 0.3 + Vector((0.0, 0.0, length(0.22))), length(0.95), "front"),
        }
