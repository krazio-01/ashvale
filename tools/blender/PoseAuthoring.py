import bisect
import math

import bpy
from mathutils import Quaternion, Vector

from Rig import (
    OUTPUT_FPS,
    RIG_MAPS,
    TRANSLATED_BONES,
    UPRIGHT_HIP_FRACTION,
    ActionWriter,
    ImportedArmature,
    Pose,
    Skeleton,
    SoleProbe,
    action_fcurves,
    character_rotation,
    character_vector,
    rotation_exp,
    rotation_log,
    set_scene_fps,
)

RELEASE_SECONDS = 0.1
KEY_SPACING_TOLERANCE = 1e-6
HOLD_EPSILON = 1e-4
RANGE_MARGIN = math.radians(8.0)
POP_DEGREES_PER_FRAME = 40.0
LONG_ARC_DEGREES = 150.0
PLANT_SLIDE_TOLERANCE = 0.005
FK_TOLERANCE = 1e-4
WATCHED_BONES = ("hand_r", "hand_l", "Head", "pelvis")
LEG_CHAINS = {"left": ("thigh_l", "calf_l", "foot_l"), "right": ("thigh_r", "calf_r", "foot_r")}
OFF_HAND_CHAIN = ("upperarm_l", "lowerarm_l", "hand_l")
SWORD_HAND = "hand_r"
AUTHORED_BONES = frozenset(RIG_MAPS["ual"].values())
EASES = {
    "linear": lambda amount: amount,
    "in": lambda amount: amount * amount,
    "out": lambda amount: 1.0 - (1.0 - amount) ** 2,
    "inOut": lambda amount: amount * amount * (3.0 - 2.0 * amount),
}


def hermite_weights(amount):
    squared = amount * amount
    cubed = squared * amount
    return cubed - 2.0 * squared + amount, 3.0 * squared - 2.0 * cubed, cubed - squared


def key_velocities(rates):
    velocities = [rates[0] * 0.0]
    for before, after in zip(rates, rates[1:]):
        is_turn = before.length < HOLD_EPSILON or after.length < HOLD_EPSILON or before.dot(after) <= 0.0
        velocities.append(before * 0.0 if is_turn else (before + after) / 2.0)
    velocities.append(rates[-1] * 0.0)
    return velocities


class VectorSpline:
    def __init__(self, times, values):
        self.times = times
        self.values = values
        self.deltas = [after - before for before, after in zip(values, values[1:])]
        spans = [after - before for before, after in zip(times, times[1:])]
        self.velocities = key_velocities([delta / span for delta, span in zip(self.deltas, spans)])

    def at(self, segment, amount):
        span = self.times[segment + 1] - self.times[segment]
        tangent_in, end, tangent_out = hermite_weights(amount)
        return (
            self.values[segment]
            + self.velocities[segment] * (tangent_in * span)
            + self.deltas[segment] * end
            + self.velocities[segment + 1] * (tangent_out * span)
        )


class RotationSpline:
    def __init__(self, times, rotations):
        self.times = times
        self.starts = rotations[:-1]
        self.deltas = [rotation_log(before.inverted() @ after) for before, after in zip(rotations, rotations[1:])]
        spans = [after - before for before, after in zip(times, times[1:])]
        self.velocities = key_velocities([delta / span for delta, span in zip(self.deltas, spans)])
        self.arcs = [math.degrees(delta.length) for delta in self.deltas]

    def at(self, segment, amount):
        span = self.times[segment + 1] - self.times[segment]
        tangent_in, end, tangent_out = hermite_weights(amount)
        delta = self.deltas[segment]
        velocity = self.velocities[segment + 1]
        angle = delta.length
        end_velocity = velocity + 0.5 * delta.cross(velocity)
        if angle > HOLD_EPSILON:
            curvature = 1.0 / angle**2 - (1.0 + math.cos(angle)) / (2.0 * angle * math.sin(angle))
            end_velocity += curvature * delta.cross(delta.cross(velocity))
        offset = self.velocities[segment] * (tangent_in * span) + delta * end + end_velocity * (tangent_out * span)
        return self.starts[segment] @ rotation_exp(offset)


class PoseLibrary:
    def __init__(self, target):
        self.target = target
        self.imports = {}
        self.baked = {}

    def capture(self, reference):
        armature, action = self.source_of(reference)
        start, end = action.frame_range
        frame = reference["frame"]
        if not start <= frame <= end:
            raise ValueError(f"pose {reference['clip']} frame {frame} is outside its range {start:.0f}..{end:.0f}")
        armature.animation_data_create()
        armature.animation_data.action = action
        whole = int(frame)
        bpy.context.scene.frame_set(whole, subframe=frame - whole)
        pose = Pose.capture(armature)
        for rotation in pose.rotations.values():
            rotation.normalize()
        return pose

    def source_of(self, reference):
        library = reference.get("library")
        if library is None:
            action = self.baked.get(reference["clip"])
            if action is None:
                raise ValueError(f"pose clip {reference['clip']} is not baked yet; its job must come earlier")
            return self.target, action
        if library not in self.imports:
            imported = ImportedArmature(library)
            for pose_bone in imported.armature.pose.bones:
                pose_bone.rotation_mode = "QUATERNION"
            self.imports[library] = imported
        imported = self.imports[library]
        return imported.armature, imported.action_named(reference["clip"], "pose")

    def close(self):
        for imported in self.imports.values():
            imported.remove()
        self.imports.clear()


class AuthoredClipBaker:
    def __init__(self, target, library, probe):
        self.target = target
        self.library = library
        self.probe = probe
        self.skeleton = Skeleton(target)
        self.rest_hip = target.data.bones["pelvis"].head_local.copy()
        self.root_rest_inverse = target.data.bones["root"].matrix_local.to_quaternion().inverted()
        self.reference_actions = list(bpy.data.actions)
        self.ranges = None
        self.skeleton_verified = False

    def bake(self, job):
        self.verify_skeleton()
        keys = self.validated_keys(job)
        times = [key["time"] for key in keys]
        eases = [key.get("ease", "linear") for key in keys]
        key_poses, pelvis_positions = zip(*(self.key_pose(key) for key in keys))
        rotations = {
            bone: RotationSpline(times, [pose.rotations[bone] for pose in key_poses])
            for bone in self.skeleton.order
            if bone in AUTHORED_BONES
        }
        pelvis = self.pelvis_splines(job, keys, pelvis_positions, times)
        frame_count = int(round(times[-1] * OUTPUT_FPS)) + 1
        sampled = [self.frame_pose(index / OUTPUT_FPS, times, eases, rotations, pelvis) for index in range(frame_count)]
        frames = [pose for pose, _ in sampled]
        pelvis_targets = [target for _, target in sampled]

        for plant in job.get("plants", []):
            chain = LEG_CHAINS[plant["foot"]]
            first, last = self.contact_range(job, plant, frame_count)
            locked = self.skeleton.matrices(frames[first])[chain[2]].copy()
            self.hold_contact(frames, chain, first, last, lambda matrices: locked)
        for grip in job.get("grips", []):
            first, last = self.contact_range(job, grip, frame_count)
            start = self.skeleton.matrices(frames[first])
            hilt_offset = start[SWORD_HAND].inverted() @ start[OFF_HAND_CHAIN[2]]
            self.hold_contact(frames, OFF_HAND_CHAIN, first, last, lambda matrices: matrices[SWORD_HAND] @ hilt_offset)

        self.report(job, times, rotations, frames)
        writer = self.write(job["output"], frames)
        self.ground(job, writer, frames, pelvis_targets)
        writer.action.name = job["output"]
        set_scene_fps(OUTPUT_FPS)
        return writer.action, frame_count, OUTPUT_FPS

    def verify_skeleton(self):
        if self.skeleton_verified:
            return
        action = self.reference_actions[0]
        self.target.animation_data_create()
        self.target.animation_data.action = action
        start, end = action.frame_range
        bpy.context.scene.frame_set(int((start + end) / 2))
        expected = {pose_bone.name: pose_bone.matrix.translation.copy() for pose_bone in self.target.pose.bones}
        actual = self.skeleton.matrices(Pose.capture(self.target))
        drift = max((actual[name].translation - position).length for name, position in expected.items())
        if drift > FK_TOLERANCE:
            raise RuntimeError(f"Skeleton FK disagrees with Blender by {drift * 100:.3f} cm on {action.name}")
        self.skeleton_verified = True

    def validated_keys(self, job):
        output = job["output"]
        keys = sorted(job["keys"], key=lambda key: key["time"])
        if len(keys) < 2 or keys[0]["time"] != 0:
            raise ValueError(f"{output}: needs at least two keys and the first must be at time 0")
        for before, after in zip(keys, keys[1:]):
            if after["time"] - before["time"] < 1.0 / OUTPUT_FPS - KEY_SPACING_TOLERANCE:
                raise ValueError(f"{output}: keys at {before['time']}s and {after['time']}s are closer than one frame")
        with_travel = sum("travel" in key for key in keys)
        if with_travel not in (0, len(keys)):
            raise ValueError(f"{output}: give travel on every key or on none")
        if with_travel and job["rootMotion"] != "extract":
            raise ValueError(f"{output}: travel needs rootMotion extract")
        unknown = sorted({key.get("ease", "linear") for key in keys} - set(EASES))
        if unknown:
            raise ValueError(f"{output}: unknown ease {unknown}, expected one of {sorted(EASES)}")
        return keys

    def key_pose(self, key):
        pose = self.library.capture(key["pose"])
        pelvis_position = self.skeleton.matrices(pose)["pelvis"].translation.copy()
        pose.rotations = {
            bone: pose.rotations.get(bone, Quaternion()) if bone in AUTHORED_BONES else Quaternion()
            for bone in self.skeleton.order
        }
        pose.locations["root"] = Vector()
        adjust = key.get("adjust", {})
        for bone in self.skeleton.parent_first(adjust):
            matrices = self.skeleton.matrices(pose)
            turned = character_rotation(adjust[bone]) @ matrices[bone].to_quaternion()
            pose.rotations[bone] = self.skeleton.local_rotation(bone, turned, matrices)
        return pose, pelvis_position

    def pelvis_splines(self, job, keys, pelvis_positions, times):
        first = pelvis_positions[0]
        travel, offset, height = [], [], []
        for key, position in zip(keys, pelvis_positions):
            shift = character_vector(key.get("pelvis", (0.0, 0.0, 0.0)))
            if "travel" in key:
                moved = character_vector(key["travel"])
            elif job["rootMotion"] == "extract":
                moved = position - first
            else:
                moved = Vector()
            travel.append(Vector((moved.x, moved.y, 0.0)))
            offset.append(Vector((shift.x, shift.y, 0.0)))
            height.append(Vector((0.0, 0.0, position.z + shift.z)))
        return {
            "travel": VectorSpline(times, travel),
            "offset": VectorSpline(times, offset),
            "height": VectorSpline(times, height),
        }

    def frame_pose(self, time, times, eases, rotations, pelvis):
        segment = max(0, min(len(times) - 2, bisect.bisect_right(times, time) - 1))
        amount = min(1.0, max(0.0, (time - times[segment]) / (times[segment + 1] - times[segment])))
        amount = EASES[eases[segment + 1]](amount)
        pose = Pose({bone: Quaternion() for bone in self.skeleton.order}, {})
        pose.rotations.update({bone: spline.at(segment, amount) for bone, spline in rotations.items()})
        travel = pelvis["travel"].at(segment, amount)
        offset = pelvis["offset"].at(segment, amount)
        height = pelvis["height"].at(segment, amount)
        pose.locations["root"] = self.root_rest_inverse @ travel
        pose.locations["pelvis"] = Vector()
        target = Vector((self.rest_hip.x + travel.x + offset.x, self.rest_hip.y + travel.y + offset.y, height.z))
        pose.locations["pelvis"] = self.skeleton.local_location("pelvis", target, self.skeleton.matrices(pose))
        return pose, target

    def contact_range(self, job, contact, frame_count):
        first, last = (int(round(contact[edge] * OUTPUT_FPS)) for edge in ("from", "to"))
        if not 0 <= first < last < frame_count:
            raise ValueError(f"{job['output']}: contact {contact} must satisfy 0 <= from < to <= clip length")
        return first, last

    def hold_contact(self, frames, chain, first, last, target_for):
        release = round(RELEASE_SECONDS * OUTPUT_FPS)
        for index in range(first, min(last + release, len(frames) - 1) + 1):
            matrices = self.skeleton.matrices(frames[index])
            free = matrices[chain[2]]
            held = target_for(matrices)
            weight = 1.0 if index <= last else 1.0 - (index - last) / (release + 1)
            position = free.translation.lerp(held.translation, weight)
            rotation = free.to_quaternion().slerp(held.to_quaternion(), weight)
            self.skeleton.solve_two_bone(frames[index], chain, position, rotation)

    def natural_ranges(self):
        if self.ranges is not None:
            return self.ranges
        lows, highs = {}, {}
        for action in self.reference_actions:
            curves = {}
            for curve in action_fcurves(action):
                if curve.data_path.endswith(".rotation_quaternion"):
                    curves.setdefault(curve.data_path.split('"')[1], [None] * 4)[curve.array_index] = curve
            start, end = (int(frame) for frame in action.frame_range)
            for bone, components in curves.items():
                if None in components:
                    continue
                for frame in range(start, end + 1):
                    vector = rotation_log(Quaternion([curve.evaluate(frame) for curve in components]).normalized())
                    low = lows.setdefault(bone, vector.copy())
                    high = highs.setdefault(bone, vector.copy())
                    for axis in range(3):
                        low[axis] = min(low[axis], vector[axis])
                        high[axis] = max(high[axis], vector[axis])
        self.ranges = {bone: (lows[bone], highs[bone]) for bone in lows}
        return self.ranges

    def report(self, job, times, rotations, frames):
        output = job["output"]
        warnings = []
        for bone, spline in rotations.items():
            for index, arc in enumerate(spline.arcs):
                if arc > LONG_ARC_DEGREES:
                    warnings.append(
                        f"long arc {bone} {arc:.0f}° between keys at {times[index]:.2f}s and {times[index + 1]:.2f}s,"
                        " add a key between them"
                    )
        worst_range = {}
        worst_pop = (0.0, "", 0.0)
        previous = None
        for index, pose in enumerate(frames):
            time = index / OUTPUT_FPS
            for bone, (low, high) in self.natural_ranges().items():
                rotation = pose.rotations.get(bone)
                if rotation is None:
                    continue
                vector = rotation_log(rotation)
                excess = max(max(low[axis] - vector[axis], vector[axis] - high[axis]) for axis in range(3)) - RANGE_MARGIN
                if excess > worst_range.get(bone, (0.0, 0.0))[0]:
                    worst_range[bone] = (excess, time)
            matrices = self.skeleton.matrices(pose)
            watched = {bone: matrices[bone].to_quaternion() for bone in WATCHED_BONES}
            if previous is not None:
                for bone, rotation in watched.items():
                    step = math.degrees(previous[bone].rotation_difference(rotation).angle)
                    step = min(step, 360.0 - step)
                    if step > worst_pop[0]:
                        worst_pop = (step, bone, time)
            previous = watched
        for bone, (excess, time) in sorted(worst_range.items()):
            warnings.append(f"range {bone} {math.degrees(excess):.0f}° beyond the natural range at {time:.2f}s")
        if worst_pop[0] > POP_DEGREES_PER_FRAME:
            warnings.append(f"pop {worst_pop[1]} {worst_pop[0]:.0f}°/frame at {worst_pop[2]:.2f}s")
        for plant in job.get("plants", []):
            foot = LEG_CHAINS[plant["foot"]][2]
            first, last = (int(round(plant[edge] * OUTPUT_FPS)) for edge in ("from", "to"))
            anchor = self.skeleton.matrices(frames[first])[foot].translation
            slide = max(
                (self.skeleton.matrices(frames[index])[foot].translation - anchor).length
                for index in range(first, last + 1)
            )
            if slide > PLANT_SLIDE_TOLERANCE:
                warnings.append(f"plant {plant['foot']} slides {slide * 100:.1f}cm")
        for warning in warnings:
            print(f"CHECK {output} {warning}")
        if not warnings:
            print(f"CHECK {output} ok")

    def write(self, output, frames):
        writer = ActionWriter(self.target, output)
        for pose_bone in (bone for bone in self.target.pose.bones if bone.name in AUTHORED_BONES):
            samples = []
            for pose in frames:
                rotation = pose.rotations[pose_bone.name]
                samples.append(-rotation if samples and samples[-1].dot(rotation) < 0.0 else rotation)
            writer.write(pose_bone.name, "rotation_quaternion", samples)
        for name in TRANSLATED_BONES:
            writer.write(name, "location", [pose.locations[name] for pose in frames])
        return writer

    def ground(self, job, writer, frames, pelvis_targets):
        output = job["output"]
        if job.get("grounding") == "none":
            print(f"GROUND {output} left as authored")
            return
        if min(target.z for target in pelvis_targets) < UPRIGHT_HIP_FRACTION * self.rest_hip.z:
            print(f"GROUND {output} skipped, hips drop below {UPRIGHT_HIP_FRACTION:.0%} of standing height")
            return
        stance, grounded = self.probe.ground_shift(len(frames))
        if stance:
            lowered = Vector((0.0, 0.0, stance))
            writer.write(
                "pelvis",
                "location",
                [
                    self.skeleton.local_location("pelvis", target - lowered, self.skeleton.matrices(pose))
                    for pose, target in zip(frames, pelvis_targets)
                ],
            )
        SoleProbe.report(output, stance, grounded)
