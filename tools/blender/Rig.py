import math

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

OUTPUT_FPS = 30
IMPORT_FPS = 24
TARGET_ARMATURE = "CombatTarget"
WORLD_UP = Vector((0.0, 0.0, 1.0))
CHARACTER_TO_ARMATURE = Matrix.Rotation(math.pi, 3, "Z")
TRANSLATED_BONES = ("root", "pelvis")
FINGERS = ("index", "middle", "ring", "pinky", "thumb")


def finger_map(prefix_left, prefix_right, name_for):
    mapping = {}
    for finger in FINGERS:
        for joint in (1, 2, 3):
            mapping[name_for(prefix_left, finger, joint)] = f"{finger}_0{joint}_l"
            mapping[name_for(prefix_right, finger, joint)] = f"{finger}_0{joint}_r"
    return mapping


def with_prefix(mapping, prefix):
    return {f"{prefix}{source}": target for source, target in mapping.items()}


UE_BODY = {
    "pelvis": "pelvis", "spine_01": "spine_01", "spine_02": "spine_02", "spine_03": "spine_03",
    "neck_01": "neck_01", "head": "Head", "Head": "Head",
    "clavicle_l": "clavicle_l", "upperarm_l": "upperarm_l", "lowerarm_l": "lowerarm_l", "hand_l": "hand_l",
    "clavicle_r": "clavicle_r", "upperarm_r": "upperarm_r", "lowerarm_r": "lowerarm_r", "hand_r": "hand_r",
    "thigh_l": "thigh_l", "calf_l": "calf_l", "foot_l": "foot_l", "ball_l": "ball_l",
    "thigh_r": "thigh_r", "calf_r": "calf_r", "foot_r": "foot_r", "ball_r": "ball_r",
}
UE_FINGERS = finger_map("l", "r", lambda side, finger, joint: f"{finger}_0{joint}_{side}")

MANNY_BODY = {**UE_BODY, "spine_02": None, "spine_03": "spine_02", "spine_05": "spine_03"}

HUMANIK_BODY = {
    "Hips": "pelvis", "Spine": "spine_01", "Spine1": "spine_02", "Spine2": "spine_03", "Neck": "neck_01", "Head": "Head",
    "LeftShoulder": "clavicle_l", "LeftArm": "upperarm_l", "LeftForeArm": "lowerarm_l", "LeftHand": "hand_l",
    "RightShoulder": "clavicle_r", "RightArm": "upperarm_r", "RightForeArm": "lowerarm_r", "RightHand": "hand_r",
    "LeftUpLeg": "thigh_l", "LeftLeg": "calf_l", "LeftFoot": "foot_l", "LeftToeBase": "ball_l",
    "RightUpLeg": "thigh_r", "RightLeg": "calf_r", "RightFoot": "foot_r", "RightToeBase": "ball_r",
}
HUMANIK_FINGERS = finger_map("Left", "Right", lambda side, finger, joint: f"{side}Hand{finger.capitalize()}{joint}")

ATLAS_BODY = {name: target for name, target in {**HUMANIK_BODY, "Spine3": "spine_03"}.items() if name != "Spine2"}

KEVIN_BODY = {
    "B-hips": "pelvis", "B-spine": "spine_01", "B-chest": "spine_03", "B-neck": "neck_01", "B-head": "Head",
    "B-shoulder.L": "clavicle_l", "B-upperArm.L": "upperarm_l", "B-forearm.L": "lowerarm_l", "B-hand.L": "hand_l",
    "B-shoulder.R": "clavicle_r", "B-upperArm.R": "upperarm_r", "B-forearm.R": "lowerarm_r", "B-hand.R": "hand_r",
    "B-thigh.L": "thigh_l", "B-shin.L": "calf_l", "B-foot.L": "foot_l", "B-toe.L": "ball_l",
    "B-thigh.R": "thigh_r", "B-shin.R": "calf_r", "B-foot.R": "foot_r", "B-toe.R": "ball_r",
}
KEVIN_FINGER_NAMES = {"index": "indexFinger", "middle": "middleFinger", "ring": "ringFinger", "pinky": "pinky", "thumb": "thumb"}
KEVIN_FINGERS = finger_map("L", "R", lambda side, finger, joint: f"B-{KEVIN_FINGER_NAMES[finger]}0{joint}.{side}")

RIG_MAPS = {
    "ue": {**UE_BODY, **UE_FINGERS},
    "manny": {**{source: target for source, target in MANNY_BODY.items() if target}, **UE_FINGERS},
    "motus": {**HUMANIK_BODY, **HUMANIK_FINGERS},
    "mixamo": with_prefix({**HUMANIK_BODY, **HUMANIK_FINGERS}, "mixamorig:"),
    "humanikCharacter": with_prefix({**HUMANIK_BODY, **HUMANIK_FINGERS}, "Character1_"),
    "kevin": {**KEVIN_BODY, **KEVIN_FINGERS},
    "atlas": with_prefix({**ATLAS_BODY, **HUMANIK_FINGERS}, "Offir:"),
    "ual": {**{name: name for name in UE_BODY.values()}, **{name: name for name in UE_FINGERS.values()}},
}
IDENTITY_RIGS = {"ual"}

DIRECTION_CHILD = {
    "pelvis": "spine_01", "spine_01": "spine_02", "spine_02": "spine_03", "spine_03": "neck_01", "neck_01": "Head",
    "clavicle_l": "upperarm_l", "upperarm_l": "lowerarm_l", "lowerarm_l": "hand_l", "hand_l": "middle_01_l",
    "clavicle_r": "upperarm_r", "upperarm_r": "lowerarm_r", "lowerarm_r": "hand_r", "hand_r": "middle_01_r",
    "thigh_l": "calf_l", "calf_l": "foot_l", "foot_l": "ball_l",
    "thigh_r": "calf_r", "calf_r": "foot_r", "foot_r": "ball_r",
    **{f"{finger}_0{joint}_{side}": f"{finger}_0{joint + 1}_{side}"
       for side in ("l", "r") for finger in FINGERS for joint in (1, 2)},
}

TWIST_REFERENCE = {"pelvis": ("thigh_r", "thigh_l"), "spine_03": ("upperarm_r", "upperarm_l")}


def set_scene_fps(fps):
    bpy.context.scene.render.fps = fps
    bpy.context.scene.render.fps_base = 1


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def armature_among(objects, source_path):
    armature = next((obj for obj in objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise ValueError(f"no armature in {source_path}")
    return armature


def import_target(path):
    bpy.ops.import_scene.gltf(filepath=path)
    target = armature_among(bpy.data.objects, path)
    target.name = TARGET_ARMATURE
    for pose_bone in target.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
    return target


class ImportedArmature:
    def __init__(self, path):
        set_scene_fps(IMPORT_FPS)
        objects_before = set(bpy.data.objects)
        actions_before = set(bpy.data.actions)
        if path.lower().endswith((".glb", ".gltf")):
            bpy.ops.import_scene.gltf(filepath=path)
        else:
            bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
        self.fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
        self.path = path
        self.objects = [obj for obj in bpy.data.objects if obj not in objects_before]
        self.actions = [action for action in bpy.data.actions if action not in actions_before]
        self.armature = armature_among(self.objects, path)

    def action_named(self, name, label):
        action = next((action for action in self.actions if action.name.split(".")[0] == name), None)
        if action is None:
            available = sorted(action.name for action in self.actions)
            raise ValueError(f"{label}: no action {name} in {self.path}, found {available}")
        return action

    def remove(self):
        for obj in self.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        for action in self.actions:
            bpy.data.actions.remove(action)


def rest_world(armature, name):
    return armature.matrix_world @ armature.data.bones[name].matrix_local


def rest_head(armature, name):
    return armature.matrix_world @ armature.data.bones[name].head_local


def pose_head(armature, name):
    return armature.matrix_world @ armature.pose.bones[name].head


def pose_world_rotation(armature, name):
    return (armature.matrix_world @ armature.pose.bones[name].matrix).to_quaternion()


def horizontal(vector):
    flat = Vector((vector.x, vector.y, 0.0))
    return flat.normalized() if flat.length > 1e-6 else flat


def action_fcurves(action):
    return [
        curve
        for layer in action.layers
        for strip in layer.strips
        for channelbag in strip.channelbags
        for curve in channelbag.fcurves
    ]


class ActionWriter:
    def __init__(self, target, name):
        self.target = target
        self.action = bpy.data.actions.new(name)
        self.action.use_fake_user = True
        target.animation_data_create()
        target.animation_data.action = self.action

    def write(self, bone_name, data_path, samples):
        pose_bone = self.target.pose.bones[bone_name]
        setattr(pose_bone, data_path, samples[0])
        pose_bone.keyframe_insert(data_path, frame=1)
        full_path = f'pose.bones["{bone_name}"].{data_path}'
        curves = [curve for curve in action_fcurves(self.action) if curve.data_path == full_path]
        coordinates = [0.0] * (2 * len(samples))
        coordinates[0::2] = [float(frame) for frame in range(1, len(samples) + 1)]
        for curve in curves:
            points = curve.keyframe_points
            if len(points) < len(samples):
                points.add(len(samples) - len(points))
            coordinates[1::2] = [sample[curve.array_index] for sample in samples]
            points.foreach_set("co", coordinates)
            curve.update()


FOOT_BONES = ("foot_l", "foot_r", "ball_l", "ball_r")
FOOT_VERTEX_WEIGHT = 0.5
UPRIGHT_HIP_FRACTION = 0.55
STANCE_PERCENTILE = 0.1
MAX_GROUND_CORRECTION = 0.18
GROUND_TOLERANCE = 0.005


class SoleProbe:
    def __init__(self, target):
        self.meshes = []
        for obj in bpy.data.objects:
            if obj.type != "MESH" or not any(m.type == "ARMATURE" and m.object == target for m in obj.modifiers):
                continue
            groups = {obj.vertex_groups[name].index for name in FOOT_BONES if name in obj.vertex_groups}
            indices = [
                vertex.index
                for vertex in obj.data.vertices
                if any(entry.group in groups and entry.weight >= FOOT_VERTEX_WEIGHT for entry in vertex.groups)
            ]
            if indices:
                self.meshes.append((obj, indices))
        if not self.meshes:
            raise ValueError("no skinned foot vertices found on the target")
        self.rest_z = min(
            (obj.matrix_world @ obj.data.vertices[index].co).z for obj, indices in self.meshes for index in indices
        )

    def height_above_rest(self):
        depsgraph = bpy.context.evaluated_depsgraph_get()
        lowest = math.inf
        for obj, indices in self.meshes:
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            lowest = min(lowest, min((evaluated.matrix_world @ mesh.vertices[index].co).z for index in indices))
            evaluated.to_mesh_clear()
        return lowest - self.rest_z

    def ground_shift(self, frame_count):
        heights = []
        for index in range(frame_count):
            bpy.context.scene.frame_set(index + 1)
            heights.append(self.height_above_rest())
        stance = sorted(heights)[int(len(heights) * STANCE_PERCENTILE)]
        stance = max(-MAX_GROUND_CORRECTION, min(MAX_GROUND_CORRECTION, stance))
        if abs(stance) <= GROUND_TOLERANCE:
            stance = 0.0
        return stance, [height - stance for height in heights]

    @staticmethod
    def report(output, stance, grounded):
        print(
            f"GROUND {output} shift={stance * 100:.1f}cm sole mean={sum(grounded) / len(grounded) * 100:.1f}"
            f" lowest={min(grounded) * 100:.1f} highest={max(grounded) * 100:.1f}cm"
        )


IK_REACH_LIMIT = 0.9999


def rotation_log(rotation):
    return (-rotation if rotation.w < 0.0 else rotation).to_exponential_map()


def rotation_exp(vector):
    angle = vector.length
    return Quaternion() if angle < 1e-9 else Quaternion(vector / angle, angle)


def character_rotation(degrees):
    local = Euler([math.radians(angle) for angle in degrees], "XYZ").to_matrix()
    return (CHARACTER_TO_ARMATURE @ local @ CHARACTER_TO_ARMATURE.inverted()).to_quaternion()


def character_vector(values):
    return CHARACTER_TO_ARMATURE @ Vector(values)


class Pose:
    def __init__(self, rotations, locations):
        self.rotations = rotations
        self.locations = locations

    @classmethod
    def capture(cls, armature):
        bones = armature.pose.bones
        return cls(
            {bone.name: bone.rotation_quaternion.copy() for bone in bones},
            {name: bones[name].location.copy() for name in TRANSLATED_BONES},
        )

    def copy(self):
        return Pose(
            {name: rotation.copy() for name, rotation in self.rotations.items()},
            {name: location.copy() for name, location in self.locations.items()},
        )


class Skeleton:
    def __init__(self, armature):
        bones = armature.data.bones
        self.order = [bone.name for bone in sorted(bones, key=lambda bone: len(bone.parent_recursive))]
        self.depth = {name: index for index, name in enumerate(self.order)}
        self.parent = {bone.name: bone.parent.name if bone.parent else None for bone in bones}
        self.rest_relative = {
            bone.name: bone.parent.matrix_local.inverted() @ bone.matrix_local if bone.parent else bone.matrix_local.copy()
            for bone in bones
        }

    def parent_first(self, names):
        unknown = sorted(set(names) - set(self.depth))
        if unknown:
            raise ValueError(f"unknown bones {unknown}")
        return sorted(names, key=lambda name: self.depth[name])

    def matrices(self, pose):
        result = {}
        for name in self.order:
            basis = Matrix.Translation(pose.locations.get(name, Vector())) @ (
                pose.rotations.get(name, Quaternion()).to_matrix().to_4x4()
            )
            result[name] = self.parent_frame(name, result) @ basis
        return result

    def parent_frame(self, name, matrices):
        parent = self.parent[name]
        return self.rest_relative[name] if parent is None else matrices[parent] @ self.rest_relative[name]

    def local_rotation(self, name, armature_rotation, matrices):
        return self.parent_frame(name, matrices).to_quaternion().inverted() @ armature_rotation

    def local_location(self, name, armature_position, matrices):
        return self.parent_frame(name, matrices).inverted() @ armature_position

    def solve_two_bone(self, pose, chain, target_position, target_rotation):
        upper, lower, end = chain
        matrices = self.matrices(pose)
        root, joint, tip = (matrices[name].translation.copy() for name in chain)
        upper_length = (joint - root).length
        lower_length = (tip - joint).length
        reach = target_position - root
        distance = max(1e-6, min(reach.length, (upper_length + lower_length) * IK_REACH_LIMIT))
        direction = reach.normalized()
        bend_axis = (tip - root).cross(joint - root)
        bend_axis -= bend_axis.project(direction)
        if bend_axis.length < 1e-6:
            bend_axis = direction.orthogonal()
        bend_axis.normalize()
        cosine = (upper_length**2 + distance**2 - lower_length**2) / (2.0 * upper_length * distance)
        bent = Quaternion(bend_axis, math.acos(max(-1.0, min(1.0, cosine)))) @ (direction * upper_length)

        swing = (joint - root).rotation_difference(bent)
        pose.rotations[upper] = self.local_rotation(upper, swing @ matrices[upper].to_quaternion(), matrices)
        matrices = self.matrices(pose)
        joint, tip = matrices[lower].translation, matrices[end].translation
        swing = (tip - joint).rotation_difference(root + direction * distance - joint)
        pose.rotations[lower] = self.local_rotation(lower, swing @ matrices[lower].to_quaternion(), matrices)
        matrices = self.matrices(pose)
        pose.rotations[end] = self.local_rotation(end, target_rotation, matrices)
