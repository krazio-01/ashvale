import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

OUTPUT_FPS = 30
DEFAULT_IMPORT_FPS = 24
TARGET_ARMATURE = "CombatTarget"
WORLD_UP = Vector((0.0, 0.0, 1.0))
STRIKE_SPEED_FRACTION = 0.6
BLADE_LENGTH = 1.0
BLADE_GRIP_OVERHANG = 0.12
FOOT_BONES = ("foot_l", "foot_r", "ball_l", "ball_r")
FOOT_VERTEX_WEIGHT = 0.5
UPRIGHT_HIP_FRACTION = 0.55
STANCE_PERCENTILE = 0.1
MAX_GROUND_CORRECTION = 0.18
GROUND_TOLERANCE = 0.005
CHARACTER_TO_ARMATURE = Matrix.Rotation(math.pi, 3, "Z")
POLE_DISTANCE = 1.0
POLE_ANGLE_STEPS = 24
ROLL_STEPS = 48
CLIP_IDLE_ACTION = "Idle_Loop"
POLE_LIMIT_DEGREES = 150
POLE_STEP_DEGREES = 10
POLE_WINDOW_BASE_DEGREES = 20
POLE_WINDOW_PER_FRAME_DEGREES = 12
POLE_CONTINUITY = 0.3
ELBOW_RAISE_PENALTY = 100000.0
ELBOW_INWARD_PENALTY = 60000.0
POLE_REST_PULL = 0.0
NEUTRAL_WRIST_DEGREES = 40.0
ROLL_CONTINUITY = 0.25
REACH_FRACTION = 0.97
ELBOW_PREFERRED = (0.6, -0.6, -0.5)
SMOOTHED_ARM_BONES = tuple(f"{name}_{side}" for name in ("clavicle", "upperarm", "lowerarm", "hand") for side in ("l", "r"))
SMOOTHING_KERNEL = (1.0, 4.0, 6.0, 4.0, 1.0)
SHOULDER_FOLLOW = 0.2

FINGERS = ["index", "middle", "ring", "pinky", "thumb"]


def finger_map(prefix_left, prefix_right, name_for):
    mapping = {}
    for finger in FINGERS:
        for joint in (1, 2, 3):
            mapping[name_for(prefix_left, finger, joint)] = f"{finger}_0{joint}_l"
            mapping[name_for(prefix_right, finger, joint)] = f"{finger}_0{joint}_r"
    return mapping


UE_BODY = {
    "pelvis": "pelvis", "spine_01": "spine_01", "spine_02": "spine_02", "spine_03": "spine_03",
    "neck_01": "neck_01", "head": "Head", "Head": "Head",
    "clavicle_l": "clavicle_l", "upperarm_l": "upperarm_l", "lowerarm_l": "lowerarm_l", "hand_l": "hand_l",
    "clavicle_r": "clavicle_r", "upperarm_r": "upperarm_r", "lowerarm_r": "lowerarm_r", "hand_r": "hand_r",
    "thigh_l": "thigh_l", "calf_l": "calf_l", "foot_l": "foot_l", "ball_l": "ball_l",
    "thigh_r": "thigh_r", "calf_r": "calf_r", "foot_r": "foot_r", "ball_r": "ball_r",
}
UE_FINGERS = finger_map("l", "r", lambda side, finger, joint: f"{finger}_0{joint}_{side}")

MANNY_BODY = dict(UE_BODY)
MANNY_BODY.update({"spine_02": None, "spine_03": "spine_02", "spine_05": "spine_03"})

HUMANIK_BODY = {
    "Hips": "pelvis", "Spine": "spine_01", "Spine1": "spine_02", "Spine2": "spine_03", "Neck": "neck_01", "Head": "Head",
    "LeftShoulder": "clavicle_l", "LeftArm": "upperarm_l", "LeftForeArm": "lowerarm_l", "LeftHand": "hand_l",
    "RightShoulder": "clavicle_r", "RightArm": "upperarm_r", "RightForeArm": "lowerarm_r", "RightHand": "hand_r",
    "LeftUpLeg": "thigh_l", "LeftLeg": "calf_l", "LeftFoot": "foot_l", "LeftToeBase": "ball_l",
    "RightUpLeg": "thigh_r", "RightLeg": "calf_r", "RightFoot": "foot_r", "RightToeBase": "ball_r",
}
HUMANIK_FINGERS = finger_map(
    "Left", "Right", lambda side, finger, joint: f"{side}Hand{finger.capitalize()}{joint}"
)

ATLAS_BODY = {**HUMANIK_BODY, "Spine3": "spine_03"}
del ATLAS_BODY["Spine2"]

KEVIN_BODY = {
    "B-hips": "pelvis", "B-spine": "spine_01", "B-chest": "spine_03", "B-neck": "neck_01", "B-head": "Head",
    "B-shoulder.L": "clavicle_l", "B-upperArm.L": "upperarm_l", "B-forearm.L": "lowerarm_l", "B-hand.L": "hand_l",
    "B-shoulder.R": "clavicle_r", "B-upperArm.R": "upperarm_r", "B-forearm.R": "lowerarm_r", "B-hand.R": "hand_r",
    "B-thigh.L": "thigh_l", "B-shin.L": "calf_l", "B-foot.L": "foot_l", "B-toe.L": "ball_l",
    "B-thigh.R": "thigh_r", "B-shin.R": "calf_r", "B-foot.R": "foot_r", "B-toe.R": "ball_r",
}
KEVIN_FINGER_NAMES = {"index": "indexFinger", "middle": "middleFinger", "ring": "ringFinger", "pinky": "pinky", "thumb": "thumb"}
KEVIN_FINGERS = finger_map(
    "L", "R", lambda side, finger, joint: f"B-{KEVIN_FINGER_NAMES[finger]}0{joint}.{side}"
)


def with_prefix(mapping, prefix):
    return {f"{prefix}{source}": target for source, target in mapping.items()}


RIG_MAPS = {
    "ue": {**UE_BODY, **UE_FINGERS},
    "manny": {**{source_name: target_name for source_name, target_name in MANNY_BODY.items() if target_name}, **UE_FINGERS},
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
}
for side in ("l", "r"):
    for finger in FINGERS:
        DIRECTION_CHILD[f"{finger}_01_{side}"] = f"{finger}_02_{side}"
        DIRECTION_CHILD[f"{finger}_02_{side}"] = f"{finger}_03_{side}"

TWIST_REFERENCE = {"pelvis": ("thigh_r", "thigh_l"), "spine_03": ("upperarm_r", "upperarm_l")}


def armature_among(objects, source_path):
    armature = next((obj for obj in objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise ValueError(f"no armature in {source_path}")
    return armature


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


def facing_backward(head_of, names):
    left = horizontal(head_of(names["thigh_l"]) - head_of(names["thigh_r"]))
    return WORLD_UP.cross(left).normalized()


def yaw_between(from_direction, to_direction):
    source = horizontal(from_direction)
    target = horizontal(to_direction)
    return Quaternion(WORLD_UP, math.atan2(source.cross(target).z, source.dot(target)))


def leg_length(head_of, names):
    return (head_of(names["thigh_l"]) - head_of(names["calf_l"])).length + (
        head_of(names["calf_l"]) - head_of(names["foot_l"])
    ).length


def aligning_rotation(from_primary, to_primary, from_secondary=None, to_secondary=None):
    swing = from_primary.rotation_difference(to_primary)
    if from_secondary is None:
        return swing
    rotated = swing @ from_secondary
    projected_from = rotated - rotated.project(to_primary)
    projected_to = to_secondary - to_secondary.project(to_primary)
    if projected_from.length < 1e-4 or projected_to.length < 1e-4:
        return swing
    projected_from.normalize()
    projected_to.normalize()
    angle = math.atan2(projected_from.cross(projected_to).dot(to_primary), projected_from.dot(projected_to))
    return Quaternion(to_primary, angle) @ swing


def mapped_descendant(name, source_of):
    child = DIRECTION_CHILD.get(name)
    while child is not None and child not in source_of:
        child = DIRECTION_CHILD.get(child)
    return child


def import_target(path):
    bpy.ops.import_scene.gltf(filepath=path)
    target = armature_among(bpy.data.objects, path)
    target.name = TARGET_ARMATURE
    for pose_bone in target.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
    return target


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


def import_source(path):
    bpy.context.scene.render.fps = DEFAULT_IMPORT_FPS
    bpy.context.scene.render.fps_base = 1
    before = set(bpy.data.objects)
    actions_before = set(bpy.data.actions)
    if path.lower().endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    objects = [obj for obj in bpy.data.objects if obj not in before]
    actions = [action for action in bpy.data.actions if action not in actions_before]
    return armature_among(objects, path), objects, actions, fps


def build_offsets(target, source, source_of, frame_correction):
    ordered = sorted(
        (bone.name for bone in target.data.bones if bone.name in source_of),
        key=lambda name: len(target.data.bones[name].parent_recursive),
    )
    matched = {}
    for name in ordered:
        rest = rest_world(target, name).to_quaternion()
        child = mapped_descendant(name, source_of)
        if child is None:
            ancestor = target.data.bones[name].parent
            while ancestor is not None and ancestor.name not in matched:
                ancestor = ancestor.parent
            delta = Quaternion()
            if ancestor is not None:
                delta = matched[ancestor.name] @ rest_world(target, ancestor.name).to_quaternion().inverted()
            matched[name] = delta @ rest
            continue
        target_direction = (rest_head(target, child) - rest_head(target, name)).normalized()
        source_direction = frame_correction @ (
            pose_head(source, source_of[child]) - pose_head(source, source_of[name])
        ).normalized()
        twist = TWIST_REFERENCE.get(name)
        if twist and all(bone_name in source_of for bone_name in twist):
            target_side = (rest_head(target, twist[1]) - rest_head(target, twist[0])).normalized()
            source_side = frame_correction @ (
                pose_head(source, source_of[twist[1]]) - pose_head(source, source_of[twist[0]])
            ).normalized()
            alignment = aligning_rotation(target_direction, source_direction, target_side, source_side)
        else:
            alignment = aligning_rotation(target_direction, source_direction)
        matched[name] = alignment @ rest
    offsets = {
        name: (frame_correction @ pose_world_rotation(source, source_of[name])).inverted() @ matched[name]
        for name in ordered
    }
    return ordered, offsets


def parent_pose_rotation(bone, world_rotation, armature_inverse):
    parent = bone.parent
    if parent is None:
        return Quaternion(), Quaternion()
    parent_rest = parent.matrix_local.to_quaternion()
    ancestor = parent
    while ancestor is not None and ancestor.name not in world_rotation:
        ancestor = ancestor.parent
    if ancestor is None:
        return parent_rest, parent_rest
    ancestor_pose = armature_inverse @ world_rotation[ancestor.name]
    if ancestor is parent:
        return parent_rest, ancestor_pose
    delta = ancestor_pose @ ancestor.matrix_local.to_quaternion().inverted()
    return parent_rest, delta @ parent_rest


def bake(job, target, probe):
    source, source_objects, source_actions, source_fps = import_source(job["source"])
    if job.get("action"):
        chosen = next(
            (action for action in source_actions if action.name.split(".")[0] == job["action"]), None
        )
        if chosen is None:
            available = sorted(action.name for action in source_actions)
            raise ValueError(f"{job['output']}: no action {job['action']} in {job['source']}, found {available}")
        source.animation_data_create()
        source.animation_data.action = chosen
    start, end = job["frames"]
    take_start = start
    if source.animation_data and source.animation_data.action:
        take_start, take_end = (int(frame) for frame in source.animation_data.action.frame_range)
        if end <= start:
            start, end = take_start, take_end
    bpy.context.scene.frame_set(int(job.get("calibrationFrame", take_start)))
    source_of = {
        target_name: source_name
        for source_name, target_name in RIG_MAPS[job["rig"]].items()
        if source_name in source.data.bones and target_name in target.data.bones
    }
    body_names = {name: source_of[name] for name in ("pelvis", "neck_01", "thigh_l", "thigh_r", "calf_l", "foot_l")}
    target_hip = rest_head(target, "pelvis")
    is_identity_rig = job["rig"] in IDENTITY_RIGS
    if is_identity_rig:
        frame_correction = Quaternion()
    else:
        target_back = facing_backward(lambda name: rest_head(target, name), {name: name for name in body_names})
        source_back = facing_backward(lambda name: pose_head(source, name), body_names)
        if job.get("alignToTravel"):
            bpy.context.scene.frame_set(int(start))
            travel_start = pose_head(source, source_of["pelvis"])
            bpy.context.scene.frame_set(int(end))
            source_back = travel_start - pose_head(source, source_of["pelvis"])
            bpy.context.scene.frame_set(int(job.get("calibrationFrame", take_start)))
        frame_correction = yaw_between(source_back, target_back)
    ordered, offsets = build_offsets(target, source, source_of, frame_correction)
    if is_identity_rig:
        offsets = {name: Quaternion() for name in ordered}
        hip_scale = 1.0
    else:
        target_leg = leg_length(lambda name: rest_head(target, name), {name: name for name in body_names})
        source_leg = leg_length(lambda name: pose_head(source, name), body_names)
        hip_scale = target_leg / max(source_leg, 1e-6)
    bpy.context.scene.frame_set(int(start))
    start_hip = frame_correction @ pose_head(source, source_of["pelvis"])
    root_rest_inverse = target.data.bones["root"].matrix_local.to_quaternion().inverted()
    pelvis_rest_inverse = target.data.bones["pelvis"].matrix_local.to_quaternion().inverted()
    armature_inverse = target.matrix_world.inverted().to_quaternion()
    extract_root = job.get("rootMotion", "inPlace") == "extract"
    hold_feet = bool(job.get("holdFeet"))

    speed = float(job.get("speed", 1.0))
    duration = (end - start) / source_fps / speed
    frame_count = int(round(duration * OUTPUT_FPS)) + 1
    action = bpy.data.actions.new(job["output"])
    action.use_fake_user = True
    target.animation_data_create()
    target.animation_data.action = action

    hip_samples = []
    for index in range(frame_count):
        source_frame = start + (index / OUTPUT_FPS) * source_fps * speed
        whole = int(source_frame)
        bpy.context.scene.frame_set(whole, subframe=source_frame - whole)
        world_rotation = {
            name: (frame_correction @ (source.matrix_world @ source.pose.bones[source_of[name]].matrix).to_quaternion())
            @ offsets[name]
            for name in ordered
        }
        for pose_bone in target.pose.bones:
            if pose_bone.name not in world_rotation:
                continue
            bone = pose_bone.bone
            parent_rest, parent_pose = parent_pose_rotation(bone, world_rotation, armature_inverse)
            desired = armature_inverse @ world_rotation[pose_bone.name]
            pose_bone.rotation_quaternion = (
                bone.matrix_local.to_quaternion().inverted() @ parent_rest @ parent_pose.inverted() @ desired
            )
            pose_bone.keyframe_insert("rotation_quaternion", frame=index + 1)

        hip_samples.append(frame_correction @ (source.matrix_world @ source.pose.bones[source_of["pelvis"]].head))

    root = target.pose.bones["root"]
    pelvis = target.pose.bones["pelvis"]
    travel = hip_samples[-1] - hip_samples[0]
    last_index = max(len(hip_samples) - 1, 1)

    def key_hips(ground_shift):
        for index, hip_world in enumerate(hip_samples):
            offset = (hip_world - start_hip) * hip_scale
            offset.z = 0.0
            sway = Vector()
            if not extract_root:
                if hold_feet:
                    sway = offset - Vector((travel.x, travel.y, 0.0)) * hip_scale * (index / last_index)
                offset = Vector()
            vertical = hip_world.z * hip_scale - target_hip.z - ground_shift
            root.location = root_rest_inverse @ (armature_inverse @ offset)
            pelvis.location = pelvis_rest_inverse @ (armature_inverse @ Vector((sway.x, sway.y, vertical)))
            root.keyframe_insert("location", frame=index + 1)
            pelvis.keyframe_insert("location", frame=index + 1)

    key_hips(0.0)
    if job.get("grounding") == "none":
        print(f"GROUND {job['output']} left as authored")
    elif min(hip.z * hip_scale for hip in hip_samples) >= UPRIGHT_HIP_FRACTION * target_hip.z:
        heights = []
        for index in range(frame_count):
            bpy.context.scene.frame_set(index + 1)
            heights.append(probe.height_above_rest())
        stance = sorted(heights)[int(len(heights) * STANCE_PERCENTILE)]
        stance = max(-MAX_GROUND_CORRECTION, min(MAX_GROUND_CORRECTION, stance))
        if abs(stance) > GROUND_TOLERANCE:
            key_hips(stance)
        else:
            stance = 0.0
        grounded = [height - stance for height in heights]
        print(
            f"GROUND {job['output']} shift={stance * 100:.1f}cm sole mean={sum(grounded) / len(grounded) * 100:.1f}"
            f" lowest={min(grounded) * 100:.1f} highest={max(grounded) * 100:.1f}cm"
        )
    else:
        print(f"GROUND {job['output']} skipped, hips drop below {UPRIGHT_HIP_FRACTION:.0%} of standing height")

    for obj in source_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for leftover in source_actions:
        bpy.data.actions.remove(leftover)
    action.name = job["output"]
    bpy.context.scene.render.fps = OUTPUT_FPS
    bpy.context.scene.render.fps_base = 1
    return action, frame_count, source_fps


def character_rotation(degrees):
    local = Euler([math.radians(angle) for angle in degrees], "XYZ").to_matrix()
    return CHARACTER_TO_ARMATURE @ local @ CHARACTER_TO_ARMATURE.inverted()


def capture_pose(target, action_name, frame):
    target.animation_data_create()
    target.animation_data.action = bpy.data.actions[action_name]
    bpy.context.scene.frame_set(frame)
    return {
        pose_bone.name: (pose_bone.rotation_quaternion.copy(), pose_bone.location.copy())
        for pose_bone in target.pose.bones
    }


def restore_pose(target, pose):
    for pose_bone in target.pose.bones:
        pose_bone.rotation_quaternion, pose_bone.location = (value.copy() for value in pose[pose_bone.name])
    bpy.context.view_layer.update()


def bone_depth(pose_bone):
    depth = 0
    bone = pose_bone.bone
    while bone.parent:
        depth += 1
        bone = bone.parent
    return depth


def new_marker(name, matrix):
    marker = bpy.data.objects.new(name, None)
    marker.rotation_mode = "QUATERNION"
    bpy.context.scene.collection.objects.link(marker)
    marker.matrix_world = matrix
    return marker


def fit_pole_angle(target, solver, joint_name, reference_position):
    best_error, best_angle = math.inf, 0.0
    for step in range(POLE_ANGLE_STEPS):
        angle = -math.pi + step * 2.0 * math.pi / POLE_ANGLE_STEPS
        solver.pole_angle = angle
        bpy.context.view_layer.update()
        error = (pose_head(target, joint_name) - reference_position).length
        if error < best_error:
            best_error, best_angle = error, angle
    solver.pole_angle = best_angle


def add_limb_solver(target, tip_bone, joint_bone, tip_marker, pole_marker):
    tip = target.pose.bones[tip_bone]
    joint = target.pose.bones[joint_bone]
    reference = joint.head.copy()
    solver = joint.constraints.new("IK")
    solver.target = tip_marker
    solver.pole_target = pole_marker
    solver.chain_count = 2
    fit_pole_angle(target, solver, joint_bone, reference)
    keep_orientation = tip.constraints.new("COPY_ROTATION")
    keep_orientation.target = tip_marker
    keep_orientation.target_space = "WORLD"
    keep_orientation.owner_space = "WORLD"
    return solver, keep_orientation


def rig_limbs(target):
    forward = CHARACTER_TO_ARMATURE @ Vector((0.0, 1.0, 0.0))
    markers = {}
    for side in ("l", "r"):
        ankle = new_marker(f"Ankle_{side}", target.pose.bones[f"foot_{side}"].matrix.copy())
        knee_head = target.pose.bones[f"calf_{side}"].head
        knee = new_marker(f"Knee_{side}", Matrix.Translation(knee_head + forward * POLE_DISTANCE))
        markers[f"ankle_{side}"], markers[f"knee_{side}"] = ankle, knee
        markers[f"wrist_{side}"] = new_marker(f"Wrist_{side}", target.pose.bones[f"hand_{side}"].matrix.copy())
        outward = CHARACTER_TO_ARMATURE @ Vector((1.0 if side == "r" else -1.0, 0.0, 0.0))
        elbow_head = target.pose.bones[f"lowerarm_{side}"].head
        elbow = new_marker(f"Elbow_{side}", Matrix.Translation(elbow_head + outward * POLE_DISTANCE))
        markers[f"elbow_{side}"] = elbow
    bpy.context.view_layer.update()
    bpy.context.view_layer.update()
    arm_solvers = {}
    for side in ("l", "r"):
        add_limb_solver(target, f"foot_{side}", f"calf_{side}", markers[f"ankle_{side}"], markers[f"knee_{side}"])
        shoulder = target.pose.bones[f"clavicle_{side}"].constraints.new("DAMPED_TRACK")
        shoulder.target = markers[f"wrist_{side}"]
        shoulder.track_axis = "TRACK_Y"
        shoulder.influence = SHOULDER_FOLLOW
        solver, orientation = add_limb_solver(
            target, f"hand_{side}", f"lowerarm_{side}", markers[f"wrist_{side}"], markers[f"elbow_{side}"]
        )
        arm_solvers[side] = (solver, orientation, shoulder)
    return markers, arm_solvers


def action_fcurves(action):
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    return [
        curve
        for layer in action.layers
        for strip in layer.strips
        for channelbag in strip.channelbags
        for curve in channelbag.fcurves
    ]


def shape_arrivals(action, arrivals):
    for curve in action_fcurves(action):
        points = curve.keyframe_points
        for index in range(len(points) - 1):
            arrival = arrivals.get(int(round(points[index + 1].co.x)))
            if arrival is None:
                continue
            points[index].interpolation = "CUBIC"
            points[index].easing = "EASE_IN" if arrival == "snap" else "EASE_OUT"


def bake_constraints(target, frame_count):
    bpy.context.view_layer.objects.active = target
    target.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.nla.bake(
        frame_start=1,
        frame_end=frame_count,
        only_selected=False,
        visual_keying=True,
        clear_constraints=True,
        use_current_action=True,
        bake_types={"POSE"},
    )
    bpy.ops.object.mode_set(mode="OBJECT")


def continuous_rotation(rotation, previous):
    if previous is not None and rotation.dot(previous) < 0.0:
        rotation.negate()
    return rotation.copy()


def key_marker(marker, frame, previous_rotations):
    marker.rotation_quaternion = continuous_rotation(
        marker.rotation_quaternion, previous_rotations.get(marker.name)
    )
    previous_rotations[marker.name] = marker.rotation_quaternion.copy()
    marker.keyframe_insert("location", frame=frame)
    marker.keyframe_insert("rotation_quaternion", frame=frame)


def smooth_arm_rotations(action, frame_count):
    curves = {(curve.data_path, curve.array_index): curve for curve in action_fcurves(action)}
    radius = len(SMOOTHING_KERNEL) // 2
    for bone in SMOOTHED_ARM_BONES:
        path = f'pose.bones["{bone}"].rotation_quaternion'
        components = [curves.get((path, index)) for index in range(4)]
        if any(curve is None for curve in components):
            continue
        samples = []
        for frame in range(1, frame_count + 1):
            rotation = Quaternion([curve.evaluate(frame) for curve in components])
            if samples and rotation.dot(samples[-1]) < 0.0:
                rotation.negate()
            samples.append(rotation)
        for index in range(frame_count):
            blended = Quaternion((0.0, 0.0, 0.0, 0.0))
            for offset, weight in enumerate(SMOOTHING_KERNEL):
                neighbour = samples[min(max(index + offset - radius, 0), frame_count - 1)]
                blended = blended + neighbour * weight
            blended.normalize()
            for component_index, curve in enumerate(components):
                curve.keyframe_points[index].co.y = blended[component_index]


def bake_posed(job, target, probe):
    base = job["basePose"]
    base_pose = capture_pose(target, base["clip"], base["frame"])
    restore_pose(target, base_pose)
    base_hands = {side: target.pose.bones[f"hand_{side}"].matrix.copy() for side in ("l", "r")}
    base_feet = {side: target.pose.bones[f"foot_{side}"].matrix.copy() for side in ("l", "r")}
    base_blades = {side: blade_axis(target, side)[1] for side in ("l", "r")}
    hand_axes = {
        side: base_hands[side].to_3x3().inverted()
        @ (pose_head(target, f"middle_01_{side}") - pose_head(target, f"hand_{side}")).normalized()
        for side in ("l", "r")
    }
    arm_reach = {
        side: (pose_head(target, f"lowerarm_{side}") - pose_head(target, f"upperarm_{side}")).length
        + (pose_head(target, f"hand_{side}") - pose_head(target, f"lowerarm_{side}")).length
        for side in ("l", "r")
    }
    base_elbows = {side: pose_head(target, f"lowerarm_{side}").copy() for side in ("l", "r")}
    markers, arm_solvers = rig_limbs(target)
    ordered = sorted(target.pose.bones, key=bone_depth)
    previous_rolls = {"l": 0.0, "r": 0.0}

    pole_directions = {}

    def aim_pole(side, wrist_position):
        shoulder = pose_head(target, f"upperarm_{side}")
        axis = (wrist_position - shoulder).normalized()
        if side not in pole_directions:
            outward = 1.0 if side == "r" else -1.0
            pole_directions[side] = CHARACTER_TO_ARMATURE @ Vector(
                (outward * ELBOW_PREFERRED[0], ELBOW_PREFERRED[1], ELBOW_PREFERRED[2])
            )
        carried = pole_directions[side] - axis * pole_directions[side].dot(axis)
        if carried.length < 1e-4:
            carried = axis.cross(Vector((0.0, 0.0, 1.0)))
        pole_directions[side] = carried.normalized()
        markers[f"elbow_{side}"].location = shoulder + pole_directions[side] * POLE_DISTANCE

    pole_bases = {}
    for side in ("l", "r"):
        aim_pole(side, base_hands[side].translation)
        bpy.context.view_layer.update()
        fit_pole_angle(target, arm_solvers[side][0], f"lowerarm_{side}", base_elbows[side])
        pole_bases[side] = arm_solvers[side][0].pole_angle
    previous_poles = {"l": 0.0, "r": 0.0}
    previous_pole_frames = {"l": 1, "r": 1}

    def place_hand(side, spec, frame):
        marker = markers[f"wrist_{side}"]
        solver = arm_solvers[side][0]
        position = CHARACTER_TO_ARMATURE @ Vector(spec["position"])
        shoulder = pose_head(target, f"upperarm_{side}")
        offset = position - shoulder
        limit = arm_reach[side] * REACH_FRACTION
        if offset.length > limit:
            position = shoulder + offset.normalized() * limit
        marker.location = position
        aim_pole(side, position)
        aim = None if spec.get("aim") is None else (CHARACTER_TO_ARMATURE @ Vector(spec["aim"])).normalized()
        swing = None if aim is None else base_blades[side].rotation_difference(aim).to_matrix() @ base_hands[side].to_3x3()
        previous_roll = previous_rolls.get(side)
        best = (math.inf, 0.0, 0.0)
        window = min(
            POLE_LIMIT_DEGREES,
            POLE_WINDOW_BASE_DEGREES + POLE_WINDOW_PER_FRAME_DEGREES * (frame - previous_pole_frames[side]),
        )
        window -= window % POLE_STEP_DEGREES
        for delta in range(-window, window + 1, POLE_STEP_DEGREES):
            pole_offset = max(-POLE_LIMIT_DEGREES, min(POLE_LIMIT_DEGREES, previous_poles[side] + delta))
            solver.pole_angle = pole_bases[side] + math.radians(pole_offset)
            bpy.context.view_layer.update()
            shoulder_head = pose_head(target, f"upperarm_{side}")
            elbow = pose_head(target, f"lowerarm_{side}")
            wrist = pose_head(target, f"hand_{side}")
            middle = (shoulder_head + wrist) / 2.0
            raised = max(0.0, elbow.z - middle.z)
            outward = 1.0 if side == "r" else -1.0
            inward = max(0.0, outward * (elbow.x - middle.x))
            cost = (
                ELBOW_RAISE_PENALTY * raised**2
                + ELBOW_INWARD_PENALTY * inward**2
                + POLE_CONTINUITY * (pole_offset - previous_poles[side]) ** 2
                + POLE_REST_PULL * pole_offset**2
            )
            roll_choice = 0.0
            if aim is not None:
                forearm = (wrist - elbow).normalized()
                roll_cost = math.inf
                for step in range(ROLL_STEPS):
                    roll = -180.0 + step * 360.0 / ROLL_STEPS
                    hand_axis = Matrix.Rotation(math.radians(roll), 3, aim) @ swing @ hand_axes[side]
                    deflection = math.degrees(forearm.angle(hand_axis))
                    turn = abs((roll - previous_roll + 180.0) % 360.0 - 180.0)
                    candidate = (deflection - NEUTRAL_WRIST_DEGREES) ** 2 + ROLL_CONTINUITY * turn**2
                    if candidate < roll_cost:
                        roll_cost, roll_choice = candidate, roll
                cost += roll_cost
            if cost < best[0]:
                best = (cost, pole_offset, roll_choice)
        _, best_offset, best_roll = best
        solver.pole_angle = pole_bases[side] + math.radians(best_offset)
        previous_poles[side] = best_offset
        previous_pole_frames[side] = frame
        if aim is None:
            marker.rotation_quaternion = base_hands[side].to_quaternion()
            return False
        previous_rolls[side] = best_roll
        final_roll = best_roll + spec.get("roll", 0.0)
        marker.rotation_quaternion = (Matrix.Rotation(math.radians(final_roll), 3, aim) @ swing).to_quaternion()
        return True

    action = bpy.data.actions.new(job["output"])
    action.use_fake_user = True
    target.animation_data.action = action
    frame_count = int(round(job["duration"] * OUTPUT_FPS)) + 1
    arrivals = {}
    previous_rotations = {}

    for key in job["poseKeys"]:
        restore_pose(target, base_pose)
        for pose_bone in ordered:
            rotation = key.get("rotations", {}).get(pose_bone.name)
            shift = key.get("pelvisShift") if pose_bone.name == "pelvis" else None
            if rotation is None and shift is None:
                continue
            matrix = pose_bone.matrix.copy()
            head = matrix.translation.copy()
            posed = character_rotation(rotation or (0.0, 0.0, 0.0)) @ matrix.to_3x3()
            matrix = posed.to_4x4()
            matrix.translation = head + (CHARACTER_TO_ARMATURE @ Vector(shift or (0.0, 0.0, 0.0)))
            pose_bone.matrix = matrix
            bpy.context.view_layer.update()
        frame = int(round(key["time"] * OUTPUT_FPS)) + 1
        if key.get("arrival"):
            arrivals[frame] = key["arrival"]
        for pose_bone in target.pose.bones:
            pose_bone.rotation_quaternion = continuous_rotation(
                pose_bone.rotation_quaternion, previous_rotations.get(pose_bone.name)
            )
            previous_rotations[pose_bone.name] = pose_bone.rotation_quaternion.copy()
            pose_bone.keyframe_insert("rotation_quaternion", frame=frame)
            pose_bone.keyframe_insert("location", frame=frame)

        for side, hand_key in (("r", key.get("hand")), ("l", key.get("offHand"))):
            marker = markers[f"wrist_{side}"]
            oriented = False
            if hand_key:
                oriented = place_hand(side, hand_key, frame)
            else:
                marker.location = base_hands[side].translation
                marker.rotation_quaternion = base_hands[side].to_quaternion()
            key_marker(marker, frame, previous_rotations)
            arm_solvers[side][0].keyframe_insert("pole_angle", frame=frame)
            markers[f"elbow_{side}"].keyframe_insert("location", frame=frame)
            if side == "l":
                solver, orientation, shoulder = arm_solvers["l"]
                driven = 1.0 if hand_key else 0.0
                solver.influence = driven
                orientation.influence = 1.0 if oriented else 0.0
                shoulder.influence = SHOULDER_FOLLOW * driven
                for constraint in (solver, orientation, shoulder):
                    constraint.keyframe_insert("influence", frame=frame)

    foot_keys = list(job.get("footKeys", []))
    if not any(key["time"] == 0 for key in foot_keys):
        foot_keys.insert(0, {"time": 0})
    if not any(key["time"] == job["duration"] for key in foot_keys):
        foot_keys.append({"time": job["duration"]})
    foot_arrivals = {}
    for key in foot_keys:
        frame = int(round(key["time"] * OUTPUT_FPS)) + 1
        if key.get("arrival"):
            foot_arrivals[frame] = key["arrival"]
        for side, name in (("l", "left"), ("r", "right")):
            marker = markers[f"ankle_{side}"]
            placement = key.get(name, {})
            yaw = Matrix.Rotation(math.radians(placement.get("yaw", 0.0)), 3, "Z")
            marker.location = base_feet[side].translation + CHARACTER_TO_ARMATURE @ Vector(
                placement.get("shift", (0.0, 0.0, 0.0))
            )
            marker.rotation_quaternion = (yaw @ base_feet[side].to_3x3()).to_quaternion()
            key_marker(marker, frame, previous_rotations)

    shape_arrivals(action, arrivals)
    for name, marker in markers.items():
        if marker.animation_data and marker.animation_data.action:
            shape_arrivals(marker.animation_data.action, foot_arrivals if name.startswith("ankle") else arrivals)
    target.animation_data.action = action
    bake_constraints(target, frame_count)
    smooth_arm_rotations(action, frame_count)
    report_joints(target, job["output"], frame_count)
    for marker in markers.values():
        if marker.animation_data and marker.animation_data.action:
            bpy.data.actions.remove(marker.animation_data.action)
        bpy.data.objects.remove(marker, do_unlink=True)
    action.name = job["output"]
    bpy.context.scene.render.fps = OUTPUT_FPS
    bpy.context.scene.render.fps_base = 1
    print(f"GROUND {job['output']} feet planted by IK")
    return action, frame_count, OUTPUT_FPS


def twist_degrees(rotation):
    along = Vector((rotation.x, rotation.y, rotation.z)).dot(Vector((0.0, 1.0, 0.0)))
    twist = Quaternion((rotation.w, 0.0, along, 0.0))
    if twist.magnitude < 1e-9:
        return 0.0
    twist.normalize()
    angle = 2.0 * math.acos(max(-1.0, min(1.0, twist.w)))
    return abs(math.degrees(angle if angle <= math.pi else angle - 2.0 * math.pi))


def report_joints(target, name, frame_count):
    ranges = {}
    previous_hand = {}
    for frame in range(1, frame_count + 1):
        bpy.context.scene.frame_set(frame)
        for side in ("r", "l"):
            shoulder, elbow, wrist, knuckle = (
                pose_head(target, bone)
                for bone in (f"upperarm_{side}", f"lowerarm_{side}", f"hand_{side}", f"middle_01_{side}")
            )
            hand_rotation = pose_world_rotation(target, f"hand_{side}")
            step = 0.0
            if side in previous_hand:
                step = math.degrees(previous_hand[side].rotation_difference(hand_rotation).angle)
                step = min(step, 360.0 - step)
            previous_hand[side] = hand_rotation
            samples = {
                "elbow": math.degrees((shoulder - elbow).angle(wrist - elbow)),
                "wrist": math.degrees((wrist - elbow).angle(knuckle - wrist)),
                "lift": math.degrees((elbow - shoulder).angle(Vector((0.0, 0.0, -1.0)))),
                "upperTwist": twist_degrees(target.pose.bones[f"upperarm_{side}"].rotation_quaternion),
                "handStep": step,
            }
            for key, value in samples.items():
                low, high, peak_frame = ranges.get((side, key), (math.inf, -math.inf, 0))
                ranges[(side, key)] = (min(low, value), max(high, value), frame if value > high else peak_frame)
    for side in ("r", "l"):
        print(
            f"JOINTS {name} {side} "
            + " ".join(
                f"{key}={ranges[(side, key)][0]:.0f}..{ranges[(side, key)][1]:.0f}@{ranges[(side, key)][2]}"
                for key in ("elbow", "wrist", "lift", "upperTwist", "handStep")
            )
        )


def bake_job(job, target, probe):
    return bake_posed(job, target, probe) if "poseKeys" in job else bake(job, target, probe)


def import_kept_library_clips(path, keep):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    for obj in [obj for obj in bpy.data.objects if obj not in before]:
        bpy.data.objects.remove(obj, do_unlink=True)
    return [action for action in bpy.data.actions if action.name in keep]


def reset_pose(target):
    target.animation_data.action = None
    for pose_bone in target.pose.bones:
        pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)


def run_bake(jobs_path, output_path):
    config = json.loads(Path(jobs_path).read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    target = import_target(config["target"])
    probe = SoleProbe(target)
    keep = set(config.get("keepLibraryClips", []))
    kept = [action for action in bpy.data.actions if action.name in keep]
    for library in config.get("libraries", []):
        kept.extend(import_kept_library_clips(library, keep))
    produced = []
    for job in config["jobs"]:
        action, frames, _ = bake_job(job, target, probe)
        produced.append(action)
        print(f"BAKED {job['output']} frames={frames}")
    retained = set(kept) | set(produced)
    for action in list(bpy.data.actions):
        if action not in retained:
            bpy.data.actions.remove(action)
    for action in retained:
        action.use_fake_user = True
    for obj in [obj for obj in bpy.data.objects if obj != target]:
        bpy.data.objects.remove(obj, do_unlink=True)
    reset_pose(target)
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_skins=False,
        export_yup=True,
        export_def_bones=False,
    )
    missing = sorted(keep - {action.name for action in kept})
    print(f"EXPORTED {len(retained)} clips -> {output_path}")
    if missing:
        print(f"MISSING_LIBRARY_CLIPS {missing}")


def strike_window(speeds):
    peak_index = max(range(len(speeds)), key=lambda index: speeds[index])
    threshold = speeds[peak_index] * STRIKE_SPEED_FRACTION
    start = peak_index
    while start > 0 and speeds[start - 1] >= threshold:
        start -= 1
    end = peak_index
    while end < len(speeds) - 1 and speeds[end + 1] >= threshold:
        end += 1
    last = max(len(speeds) - 1, 1)
    return start / last, end / last, peak_index / last


def print_motion_profile(target, frame_count):
    previous = None
    speeds = []
    for frame in range(1, frame_count + 1):
        bpy.context.scene.frame_set(frame)
        hand = pose_head(target, "hand_r")
        pelvis = pose_head(target, "pelvis")
        root = pose_head(target, "root")
        speed = 0.0 if previous is None else (hand - previous).length * OUTPUT_FPS
        speeds.append(speed)
        previous = hand.copy()
        centre, direction = blade_axis(target)
        tip = CHARACTER_TO_ARMATURE @ (centre + direction * BLADE_LENGTH - root)
        aim = CHARACTER_TO_ARMATURE @ direction
        grip = CHARACTER_TO_ARMATURE @ (hand - root)
        feet = [CHARACTER_TO_ARMATURE @ (pose_head(target, name) - root) for name in ("foot_l", "foot_r")]
        print(
            f"PROFILE frame={frame} handSpeed={speed:.2f} pelvisZ={pelvis.z:.3f} rootX={root.x:.3f} rootY={root.y:.3f}"
            f" tip(right,forward,up)=({tip.x:.2f},{tip.y:.2f},{tip.z:.2f}) aim=({aim.x:.2f},{aim.y:.2f},{aim.z:.2f})"
            f" hand=({grip.x:.2f},{grip.y:.2f},{grip.z:.2f})"
            f" footL=({feet[0].x:.3f},{feet[0].y:.3f},{feet[0].z:.3f}) footR=({feet[1].x:.3f},{feet[1].y:.3f},{feet[1].z:.3f})"
        )
    start, end, peak = strike_window(speeds)
    print(f"STRIKE from={start:.2f} to={end:.2f} peak={peak:.2f} frames={frame_count}")


def blade_proxy():
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    blade = bpy.context.active_object
    blade.name = "BladeProxy"
    blade.scale = (0.03, 0.03, BLADE_LENGTH + BLADE_GRIP_OVERHANG)
    blade.color = (0.85, 0.1, 0.1, 1.0)
    return blade


def blade_axis(target, side="r"):
    knuckles = [pose_head(target, f"{finger}_01_{side}") for finger in ("index", "middle", "ring", "pinky")]
    centre = sum(knuckles, Vector()) / len(knuckles)
    return centre, (knuckles[0] - knuckles[3]).normalized()


def place_blade(blade, target):
    centre, direction = blade_axis(target)
    blade.location = centre + direction * ((BLADE_LENGTH - BLADE_GRIP_OVERHANG) / 2)
    blade.rotation_mode = "QUATERNION"
    blade.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(direction)


def render_views(target, frame_count, step, source_start, source_fps, directory):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 288
    scene.render.resolution_y = 384
    scene.display.shading.color_type = "OBJECT"
    for obj in scene.objects:
        obj.color = (0.78, 0.62, 0.42, 1.0)
    blade = blade_proxy()
    close_location = Vector((-3.5, -4.5, 1.6))
    close_rotation = (Vector((0.0, 0.0, 1.15)) - close_location).to_track_quat("-Z", "Y").to_euler()
    views = {
        "front": ((0.0, -6.0, 1.0), (math.pi / 2, 0.0, 0.0), 3.2),
        "side": ((6.0, 0.0, 1.0), (math.pi / 2, 0.0, math.pi / 2), 3.2),
        "close": (tuple(close_location), tuple(close_rotation), 2.3),
    }
    for label, (location, rotation, ortho_scale) in views.items():
        camera_data = bpy.data.cameras.new(f"{label}Camera")
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = ortho_scale
        camera = bpy.data.objects.new(f"{label}Camera", camera_data)
        scene.collection.objects.link(camera)
        camera.location = location
        camera.rotation_euler = rotation
        scene.camera = camera
        for frame in range(1, frame_count + 1, step):
            scene.frame_set(frame)
            place_blade(blade, target)
            source_frame = source_start + round((frame - 1) / OUTPUT_FPS * source_fps)
            scene.render.filepath = f"{directory}/{label}_{frame:04d}_src{source_frame}.png"
            bpy.ops.render.render(write_still=True)


def run_audition(job_path, directory, step):
    job = json.loads(Path(job_path).read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    target = import_target(job["target"])
    probe = SoleProbe(target)
    for action in list(bpy.data.actions):
        if action.name != CLIP_IDLE_ACTION:
            bpy.data.actions.remove(action)
    for prerequisite in job.get("prerequisites", []):
        bake_job(prerequisite, target, probe)
    _, frames, source_fps = bake_job(job, target, probe)
    print_motion_profile(target, frames)
    render_views(target, frames, step, job.get("frames", [0, 0])[0], source_fps, directory)
    print(f"AUDITION {job['output']} frames={frames} sourceFps={source_fps}")


def parse_arguments():
    parser = argparse.ArgumentParser(prog="RetargetClips.py", description="Run inside Blender after the -- separator")
    modes = parser.add_subparsers(dest="mode", required=True)
    bake_mode = modes.add_parser("bake")
    bake_mode.add_argument("jobs_path")
    bake_mode.add_argument("output_path")
    audition_mode = modes.add_parser("audition")
    audition_mode.add_argument("job_path")
    audition_mode.add_argument("directory")
    audition_mode.add_argument("step", type=int)
    if "--" not in sys.argv:
        parser.error("arguments must follow the -- separator")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:])


arguments = parse_arguments()
if arguments.mode == "bake":
    run_bake(arguments.jobs_path, arguments.output_path)
else:
    run_audition(arguments.job_path, arguments.directory, arguments.step)
