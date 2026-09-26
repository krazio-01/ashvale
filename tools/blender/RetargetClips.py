import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

OUTPUT_FPS = 30
DEFAULT_IMPORT_FPS = 24
TARGET_ARMATURE = "CombatTarget"
WORLD_UP = Vector((0.0, 0.0, 1.0))
STRIKE_SPEED_FRACTION = 0.6
BLADE_LENGTH = 1.0
BLADE_GRIP_OVERHANG = 0.12

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


def bake(job, target):
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

    speed = float(job.get("speed", 1.0))
    duration = (end - start) / source_fps / speed
    frame_count = int(round(duration * OUTPUT_FPS)) + 1
    action = bpy.data.actions.new(job["output"])
    action.use_fake_user = True
    target.animation_data_create()
    target.animation_data.action = action

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

        hip_world = frame_correction @ (source.matrix_world @ source.pose.bones[source_of["pelvis"]].head)
        horizontal = (hip_world - start_hip) * hip_scale
        vertical = hip_world.z * hip_scale - target_hip.z
        horizontal.z = 0.0
        root = target.pose.bones["root"]
        pelvis = target.pose.bones["pelvis"]
        root.location = root_rest_inverse @ (armature_inverse @ horizontal) if extract_root else Vector()
        pelvis.location = pelvis_rest_inverse @ (armature_inverse @ Vector((0.0, 0.0, vertical)))
        root.keyframe_insert("location", frame=index + 1)
        pelvis.keyframe_insert("location", frame=index + 1)

    for obj in source_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for leftover in source_actions:
        bpy.data.actions.remove(leftover)
    action.name = job["output"]
    bpy.context.scene.render.fps = OUTPUT_FPS
    bpy.context.scene.render.fps_base = 1
    return action, frame_count, source_fps


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
    keep = set(config.get("keepLibraryClips", []))
    kept = [action for action in bpy.data.actions if action.name in keep]
    for library in config.get("libraries", []):
        kept.extend(import_kept_library_clips(library, keep))
    produced = []
    for job in config["jobs"]:
        action, frames, _ = bake(job, target)
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
        print(f"PROFILE frame={frame} handSpeed={speed:.2f} pelvisZ={pelvis.z:.3f} rootX={root.x:.3f} rootY={root.y:.3f}")
    start, end, peak = strike_window(speeds)
    print(f"STRIKE from={start:.2f} to={end:.2f} peak={peak:.2f} frames={frame_count}")


def blade_proxy():
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    blade = bpy.context.active_object
    blade.name = "BladeProxy"
    blade.scale = (0.03, 0.03, BLADE_LENGTH + BLADE_GRIP_OVERHANG)
    blade.color = (0.85, 0.1, 0.1, 1.0)
    return blade


def place_blade(blade, target):
    knuckles = [pose_head(target, f"{finger}_01_r") for finger in ("index", "middle", "ring", "pinky")]
    centre = sum(knuckles, Vector()) / len(knuckles)
    direction = (knuckles[0] - knuckles[3]).normalized()
    blade.location = centre + direction * ((BLADE_LENGTH - BLADE_GRIP_OVERHANG) / 2)
    blade.rotation_mode = "QUATERNION"
    blade.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(direction)


def render_views(target, frame_count, step, source_start, source_fps, directory):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 192
    scene.render.resolution_y = 288
    scene.display.shading.color_type = "OBJECT"
    for obj in scene.objects:
        obj.color = (0.78, 0.62, 0.42, 1.0)
    blade = blade_proxy()
    views = {
        "front": ((0.0, -6.0, 1.0), (math.pi / 2, 0.0, 0.0)),
        "side": ((6.0, 0.0, 1.0), (math.pi / 2, 0.0, math.pi / 2)),
    }
    for label, (location, rotation) in views.items():
        camera_data = bpy.data.cameras.new(f"{label}Camera")
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = 3.2
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
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    _, frames, source_fps = bake(job, target)
    print_motion_profile(target, frames)
    render_views(target, frames, step, job["frames"][0], source_fps, directory)
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
