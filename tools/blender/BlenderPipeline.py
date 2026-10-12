import argparse
import json
import math
import os
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
if os.environ.get("ASHVALE_BLENDER_PACKAGES"):
    sys.path.insert(0, os.environ["ASHVALE_BLENDER_PACKAGES"])

from scipy.spatial import ConvexHull

from Geometry import normalised, principal_axes
from ModelBuild import add_ortho_camera, decimate, mesh_positions, ortho_pose
from Rig import (
    CHARACTER_TO_ARMATURE,
    DIRECTION_CHILD,
    IDENTITY_RIGS,
    OUTPUT_FPS,
    RIG_MAPS,
    TWIST_REFERENCE,
    UPRIGHT_HIP_FRACTION,
    WORLD_UP,
    ActionWriter,
    ImportedArmature,
    SoleProbe,
    horizontal,
    import_target,
    pose_head,
    pose_world_rotation,
    reset_scene,
    rest_head,
    rest_world,
    set_scene_fps,
)
from PoseAuthoring import AUTHORED_BAKERS, GameFit, PoseLibrary, ReferenceMotion

BODY_BONES = ("pelvis", "neck_01", "thigh_l", "thigh_r", "calf_l", "foot_l")
STRIKE_SPEED_FRACTION = 0.6
BLADE_GRIP_OVERHANG = 0.12
RENDER_SIZE = (288, 384)
SKIN_COLOUR = (0.78, 0.62, 0.42, 1.0)
BLADE_COLOUR = (0.85, 0.1, 0.1, 1.0)
CLOSE_CAMERA = Vector((-3.5, -4.5, 1.6))
CLOSE_CAMERA_FOCUS = Vector((0.0, 0.0, 1.15))
REAR_CAMERA = Vector((1.8, 5.0, 2.6))
REAR_CAMERA_FOCUS = Vector((0.0, 0.0, 1.1))


def body_heads(armature, head_of, bone_of=None):
    return {role: head_of(armature, bone_of[role] if bone_of else role) for role in BODY_BONES}


def facing_backward(heads):
    left = horizontal(heads["thigh_l"] - heads["thigh_r"])
    return WORLD_UP.cross(left).normalized()


def yaw_between(from_direction, to_direction):
    source = horizontal(from_direction)
    target = horizontal(to_direction)
    return Quaternion(WORLD_UP, math.atan2(source.cross(target).z, source.dot(target)))


def leg_length(heads):
    return (heads["thigh_l"] - heads["calf_l"]).length + (heads["calf_l"] - heads["foot_l"]).length


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


class MocapRetargeter:
    def __init__(self, target, probe):
        self.target = target
        self.probe = probe
        self.armature_inverse = target.matrix_world.inverted().to_quaternion()
        self.root_rest_inverse = target.data.bones["root"].matrix_local.to_quaternion().inverted()
        self.pelvis_rest_inverse = target.data.bones["pelvis"].matrix_local.to_quaternion().inverted()
        self.target_hip = rest_head(target, "pelvis")

    def bake(self, job):
        take = ImportedArmature(job["source"])
        source = take.armature
        if job.get("action"):
            source.animation_data_create()
            source.animation_data.action = take.action_named(job["action"], job["output"])
        start, end, take_start = self.frame_range(job, source)
        calibration_frame = int(job.get("calibrationFrame", take_start))
        scene = bpy.context.scene
        scene.frame_set(calibration_frame)

        source_of = {
            target_name: source_name
            for source_name, target_name in RIG_MAPS[job["rig"]].items()
            if source_name in source.data.bones and target_name in self.target.data.bones
        }
        body_names = {name: source_of[name] for name in BODY_BONES}
        is_identity = job["rig"] in IDENTITY_RIGS
        frame_correction = (
            Quaternion()
            if is_identity
            else self.frame_correction(job, source, source_of, body_names, start, end, calibration_frame)
        )
        ordered, offsets = self.offsets(source, source_of, frame_correction)
        if is_identity:
            offsets = {name: Quaternion() for name in ordered}
            hip_scale = 1.0
        else:
            target_leg = leg_length(body_heads(self.target, rest_head))
            hip_scale = target_leg / max(leg_length(body_heads(source, pose_head, body_names)), 1e-6)

        scene.frame_set(int(start))
        start_hip = frame_correction @ pose_head(source, source_of["pelvis"])
        speed = float(job.get("speed", 1.0))
        frame_count = int(round((end - start) / take.fps / speed * OUTPUT_FPS)) + 1
        writer = ActionWriter(self.target, job["output"])

        keyed = [pose_bone for pose_bone in self.target.pose.bones if pose_bone.name in offsets]
        rotations = {pose_bone.name: [] for pose_bone in keyed}
        hip_samples = []
        for index in range(frame_count):
            source_frame = start + (index / OUTPUT_FPS) * take.fps * speed
            whole = int(source_frame)
            scene.frame_set(whole, subframe=source_frame - whole)
            world_rotation = {
                name: (frame_correction @ (source.matrix_world @ source.pose.bones[source_of[name]].matrix).to_quaternion())
                @ offsets[name]
                for name in ordered
            }
            for pose_bone in keyed:
                bone = pose_bone.bone
                parent_rest, parent_pose = parent_pose_rotation(bone, world_rotation, self.armature_inverse)
                desired = self.armature_inverse @ world_rotation[pose_bone.name]
                rotations[pose_bone.name].append(
                    bone.matrix_local.to_quaternion().inverted() @ parent_rest @ parent_pose.inverted() @ desired
                )
            hip_samples.append(frame_correction @ (source.matrix_world @ source.pose.bones[source_of["pelvis"]].head))
        for pose_bone in keyed:
            writer.write(pose_bone.name, "rotation_quaternion", rotations[pose_bone.name])

        hips = HipTrack(self, writer, hip_samples, start_hip, hip_scale, job)
        hips.key(0.0)
        self.ground(job, hips, hip_samples, hip_scale, frame_count)

        take.remove()
        writer.action.name = job["output"]
        set_scene_fps(OUTPUT_FPS)
        return writer.action, frame_count, take.fps

    def frame_range(self, job, source):
        start, end = job["frames"]
        take_start = start
        if source.animation_data and source.animation_data.action:
            take_start, take_end = (int(frame) for frame in source.animation_data.action.frame_range)
            if end <= start:
                start, end = take_start, take_end
        return start, end, take_start

    def frame_correction(self, job, source, source_of, body_names, start, end, calibration_frame):
        target_back = facing_backward(body_heads(self.target, rest_head))
        source_back = facing_backward(body_heads(source, pose_head, body_names))
        if job.get("alignToTravel"):
            bpy.context.scene.frame_set(int(start))
            travel_start = pose_head(source, source_of["pelvis"])
            bpy.context.scene.frame_set(int(end))
            source_back = travel_start - pose_head(source, source_of["pelvis"])
            bpy.context.scene.frame_set(calibration_frame)
        return yaw_between(source_back, target_back)

    def offsets(self, source, source_of, frame_correction):
        target = self.target
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

    def ground(self, job, hips, hip_samples, hip_scale, frame_count):
        if job.get("grounding") == "none":
            print(f"GROUND {job['output']} left as authored")
            return
        if min(hip.z * hip_scale for hip in hip_samples) < UPRIGHT_HIP_FRACTION * self.target_hip.z:
            print(f"GROUND {job['output']} skipped, hips drop below {UPRIGHT_HIP_FRACTION:.0%} of standing height")
            return
        stance, grounded = self.probe.ground_shift(frame_count)
        if stance:
            hips.key(stance)
        SoleProbe.report(job["output"], stance, grounded)


class HipTrack:
    def __init__(self, retargeter, writer, hip_samples, start_hip, hip_scale, job):
        self.retargeter = retargeter
        self.writer = writer
        self.hip_samples = hip_samples
        self.start_hip = start_hip
        self.hip_scale = hip_scale
        self.extract_root = job.get("rootMotion", "inPlace") == "extract"
        self.hold_feet = bool(job.get("holdFeet"))
        self.travel = hip_samples[-1] - hip_samples[0]
        self.last_index = max(len(hip_samples) - 1, 1)

    def key(self, ground_shift):
        retargeter = self.retargeter
        roots, pelvises = [], []
        for index, hip_world in enumerate(self.hip_samples):
            offset = (hip_world - self.start_hip) * self.hip_scale
            offset.z = 0.0
            sway = Vector()
            if not self.extract_root:
                if self.hold_feet:
                    sway = offset - Vector((self.travel.x, self.travel.y, 0.0)) * self.hip_scale * (index / self.last_index)
                offset = Vector()
            vertical = hip_world.z * self.hip_scale - retargeter.target_hip.z - ground_shift
            roots.append(retargeter.root_rest_inverse @ (retargeter.armature_inverse @ offset))
            pelvises.append(retargeter.pelvis_rest_inverse @ (retargeter.armature_inverse @ Vector((sway.x, sway.y, vertical))))
        self.writer.write("root", "location", roots)
        self.writer.write("pelvis", "location", pelvises)


class ClipBaker:
    def __init__(self, target, fit):
        probe = SoleProbe(target)
        self.retargeter = MocapRetargeter(target, probe)
        self.library = PoseLibrary(target)
        references = ReferenceMotion()
        self.authored_bakers = [baker_class(target, self.library, probe, references, fit) for baker_class in AUTHORED_BAKERS]

    def bake(self, job):
        baker = next((baker for baker in self.authored_bakers if baker.job_key in job), self.retargeter)
        action, frame_count, source_fps = baker.bake(job)
        self.library.baked[job["output"]] = action
        print(f"BAKED {job['output']} frames={frame_count}")
        return action, frame_count, source_fps

    @property
    def clip_marks(self):
        return {output: marks for baker in self.authored_bakers for output, marks in baker.clip_marks.items()}

    def close(self):
        self.library.close()


def blade_axis(target, side="r"):
    knuckles = [pose_head(target, f"{finger}_01_{side}") for finger in ("index", "middle", "ring", "pinky")]
    centre = sum(knuckles, Vector()) / len(knuckles)
    return centre, (knuckles[0] - knuckles[3]).normalized()


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


def print_motion_profile(target, frame_count, blade_length):
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
        tip = CHARACTER_TO_ARMATURE @ (centre + direction * blade_length - root)
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
    print(f"STRIKE from={start:.2f} to={end:.2f} peak={peak:.2f} frames={frame_count}", flush=True)


class AuditionRenderer:
    VIEWS = {view: (*ortho_pose(view, (0.0, 0.0, 1.0), 6.0), 3.2) for view in ("front", "side")}

    def __init__(self, target, blade_length):
        self.target = target
        self.blade_length = blade_length
        scene = bpy.context.scene
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.render.resolution_x, scene.render.resolution_y = RENDER_SIZE
        scene.display.shading.color_type = "OBJECT"
        for obj in scene.objects:
            obj.color = SKIN_COLOUR
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        self.blade = bpy.context.active_object
        self.blade.name = "BladeProxy"
        self.blade.scale = (0.03, 0.03, blade_length + BLADE_GRIP_OVERHANG)
        self.blade.color = BLADE_COLOUR
        self.blade.rotation_mode = "QUATERNION"

    def render(self, frame_count, step, frame_label, directory):
        close_rotation = (CLOSE_CAMERA_FOCUS - CLOSE_CAMERA).to_track_quat("-Z", "Y").to_euler()
        rear_rotation = (REAR_CAMERA_FOCUS - REAR_CAMERA).to_track_quat("-Z", "Y").to_euler()
        views = {
            **self.VIEWS,
            "close": (tuple(CLOSE_CAMERA), tuple(close_rotation), 2.3),
            "rear": (tuple(REAR_CAMERA), tuple(rear_rotation), 2.6),
        }
        scene = bpy.context.scene
        for label, (location, rotation, ortho_scale) in views.items():
            camera = add_ortho_camera(f"{label}Camera", ortho_scale)
            camera.location = location
            camera.rotation_euler = rotation
            for frame in range(1, frame_count + 1, step):
                scene.frame_set(frame)
                self.place_blade()
                scene.render.filepath = f"{directory}/{label}_{frame:04d}_{frame_label(frame)}.png"
                bpy.ops.render.render(write_still=True)

    def place_blade(self):
        centre, direction = blade_axis(self.target)
        self.blade.location = centre + direction * ((self.blade_length - BLADE_GRIP_OVERHANG) / 2)
        self.blade.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(direction)


def reset_pose(target):
    target.animation_data.action = None
    for pose_bone in target.pose.bones:
        pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)


def run_bake(jobs_path, output_path, marks_path):
    config = json.loads(Path(jobs_path).read_text())
    reset_scene()
    target = import_target(config["target"])
    baker = ClipBaker(target, GameFit.from_config(config["game"], target))
    produced = [action for job in config["jobs"] for action, _, _ in [baker.bake(job)] if not job.get("poseSource")]
    baker.close()
    Path(marks_path).write_text(json.dumps(baker.clip_marks, indent=2, sort_keys=True))
    for action in list(bpy.data.actions):
        if action not in produced:
            bpy.data.actions.remove(action)
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
    print(f"EXPORTED {len(produced)} clips -> {output_path}")


def run_audition(jobs_path, directory, step):
    config = json.loads(Path(jobs_path).read_text())
    reset_scene()
    target = import_target(config["target"])
    fit = GameFit.from_config(config["game"], target)
    baker = ClipBaker(target, fit)
    *prerequisites, job = config["jobs"]
    for prerequisite in prerequisites:
        baker.bake(prerequisite)
    _, frame_count, source_fps = baker.bake(job)
    baker.close()
    print_motion_profile(target, frame_count, fit.blade_length)
    source_start = job.get("frames", [0, 0])[0]

    def frame_label(frame):
        if "frames" not in job:
            return f"t{(frame - 1) / OUTPUT_FPS:.2f}"
        return f"src{source_start + round((frame - 1) / OUTPUT_FPS * source_fps)}"

    AuditionRenderer(target, fit.blade_length).render(frame_count, step, frame_label, directory)
    print(f"AUDITION {job['output']} frames={frame_count} sourceFps={source_fps}")


JOIN_ALL_MESHES = "*"
WEAPON_END_SLICE = 0.1


def parse_rename(pair):
    if "=" not in pair:
        raise argparse.ArgumentTypeError(f"expected objectName=outputName, got {pair}")
    return tuple(pair.split("=", 1))


TEXTURE_SOCKET_ROLES = {
    "Base Color": "baseColor",
    "Normal": "normal",
    "Metallic": "orm",
    "Roughness": "orm",
    "Occlusion": "orm",
}


def texture_role(image_node):
    pending, seen = [image_node], {image_node}
    while pending:
        node = pending.pop()
        for output in node.outputs:
            for link in output.links:
                if link.to_node.type in ("BSDF_PRINCIPLED", "GROUP"):
                    role = TEXTURE_SOCKET_ROLES.get(link.to_socket.name)
                    if role:
                        return role
                if link.to_node not in seen:
                    seen.add(link.to_node)
                    pending.append(link.to_node)
    return None


def name_textures_by_role(target, output_name):
    named = {}
    for slot in target.material_slots:
        if not slot.material or not slot.material.use_nodes:
            continue
        for node in slot.material.node_tree.nodes:
            role = texture_role(node) if node.type == "TEX_IMAGE" and node.image else None
            if role is None:
                continue
            if named.setdefault(role, node.image) is not node.image:
                raise ValueError(f"{output_name}: more than one {role} texture, cannot name them by role")
            node.image.name = f"{output_name}_{role}"


def export_weapon(target, output_name, output_directory):
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
    print(f"EXPORTED {target.name} -> {output_directory}/{output_name}.gltf")


def import_source(source):
    lower = source.lower()
    if lower.endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=source)
    else:
        reset_scene()
        if lower.endswith((".glb", ".gltf")):
            bpy.ops.import_scene.gltf(filepath=source)
        else:
            bpy.ops.import_scene.fbx(filepath=source)
    return [obj for obj in bpy.data.objects if obj.type == "MESH"]


def joined_meshes(meshes):
    for mesh in meshes:
        world_matrix = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = world_matrix
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return bpy.context.view_layer.objects.active


def end_slice_area(along, across, at_top):
    span = along.max() - along.min()
    edge = along.max() - span * WEAPON_END_SLICE if at_top else along.min() + span * WEAPON_END_SLICE
    selected = along >= edge if at_top else along <= edge
    return ConvexHull(across[selected]).volume


def align_to_length_axis(target):
    positions = mesh_positions(target.data)
    centred = positions - positions.mean(axis=0)
    axes = principal_axes(positions)
    along = centred @ axes[0]
    across = centred @ axes[1:].T
    tip_sign = 1.0 if end_slice_area(along, across, True) < end_slice_area(along, across, False) else -1.0
    rotation = Vector(normalised(axes[0] * tip_sign)).rotation_difference(Vector((0.0, 0.0, 1.0)))
    target.data.transform(rotation.to_matrix().to_4x4())
    aligned = mesh_positions(target.data)
    heights = aligned[:, 2]
    origin_end = aligned[heights <= heights.min() + (heights.max() - heights.min()) * WEAPON_END_SLICE]
    origin = np.array([origin_end[:, 0].mean(), origin_end[:, 1].mean(), heights.min()])
    target.data.transform(Matrix.Translation(Vector(-origin)))


def decimate_to(target, triangles):
    target.data.calc_loop_triangles()
    current = len(target.data.loop_triangles)
    if current > triangles:
        decimate(target, triangles / current)


def run_split_weapons(source, output_directory, renames, triangles):
    meshes = import_source(source)
    requested = dict(renames)
    if not requested:
        for mesh in meshes:
            size = mesh.dimensions
            materials = [slot.material.name for slot in mesh.material_slots if slot.material]
            print(f"MESH {mesh.name} size=({size.x:.3f},{size.y:.3f},{size.z:.3f}) materials={materials}")
        return
    missing = [name for name in requested if name != JOIN_ALL_MESHES and bpy.data.objects.get(name) is None]
    if missing:
        raise ValueError(f"no objects {missing} in the weapon pack, meshes: {sorted(mesh.name for mesh in meshes)}")
    for object_name, output_name in requested.items():
        target = bpy.data.objects[object_name] if object_name != JOIN_ALL_MESHES else None
        if target is None or triangles is not None:
            target = joined_meshes(meshes if target is None else [target])
        if triangles is not None:
            align_to_length_axis(target)
            decimate_to(target, triangles)
            name_textures_by_role(target, output_name)
        export_weapon(target, output_name, output_directory)


def parse_arguments():
    parser = argparse.ArgumentParser(prog="BlenderPipeline.py", description="Run inside Blender after the -- separator")
    modes = parser.add_subparsers(dest="mode", required=True)
    bake_mode = modes.add_parser("bake")
    bake_mode.add_argument("jobs_path")
    bake_mode.add_argument("output_path")
    bake_mode.add_argument("marks_path")
    audition_mode = modes.add_parser("audition")
    audition_mode.add_argument("jobs_path")
    audition_mode.add_argument("directory")
    audition_mode.add_argument("step", type=int)
    weapons_mode = modes.add_parser("split-weapons", help="omit renames to list the pack's meshes")
    weapons_mode.add_argument("source")
    weapons_mode.add_argument("output_directory")
    weapons_mode.add_argument("--triangles", type=int)
    weapons_mode.add_argument("renames", nargs="*", type=parse_rename, metavar="objectName=outputName")
    model_mode = modes.add_parser("model", help="run one stage of a model build")
    model_mode.add_argument("kind")
    model_mode.add_argument("stage")
    model_mode.add_argument("recipe_file")
    model_mode.add_argument("work_root")
    if "--" not in sys.argv:
        parser.error("arguments must follow the -- separator")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:])


arguments = parse_arguments()
if arguments.mode == "bake":
    run_bake(arguments.jobs_path, arguments.output_path, arguments.marks_path)
elif arguments.mode == "audition":
    run_audition(arguments.jobs_path, arguments.directory, arguments.step)
elif arguments.mode == "model":
    from ModelStages import run_stage

    run_stage(arguments.kind, arguments.stage, arguments.recipe_file, arguments.work_root)
else:
    run_split_weapons(arguments.source, arguments.output_directory, arguments.renames, arguments.triangles)
