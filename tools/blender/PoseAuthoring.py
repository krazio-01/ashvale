import bisect
import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, replace
from typing import NamedTuple

import bpy
from mathutils import Matrix, Quaternion, Vector

from Geometry import BLENDER_TO_GLTF
from Rig import (
    FINGERS,
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

VECTOR_EPSILON = 1e-6
FLOAT_EPSILON = 1e-9
HOLD_EPSILON = 1e-4
KEY_SPACING_TOLERANCE = 1e-6
FK_TOLERANCE = 1e-4

SWORD_HAND = "hand_r"
SWORD_CLAVICLE = "clavicle_r"
OFF_HAND = "hand_l"
SWORD_ARM = ("upperarm_r", "lowerarm_r", SWORD_HAND)
OFF_HAND_ARM = ("upperarm_l", "lowerarm_l", OFF_HAND)
SWORD_ELBOW = (0.5, -0.25, -0.83)
OFF_HAND_ELBOW = (-0.65, -0.2, -0.7)
RELEASE_ANCHOR = "spine_03"
LEG_CHAINS = {"left": ("thigh_l", "calf_l", "foot_l"), "right": ("thigh_r", "calf_r", "foot_r")}
FEET = {"left": ("foot_l", "ball_l"), "right": ("foot_r", "ball_r")}
SPINE_SHARES = (("spine_01", 0.3), ("spine_02", 0.35), ("spine_03", 0.35))
NECK_SHARES = (("neck_01", 0.4), ("Head", 0.6))
AUTHORED_BONES = frozenset(RIG_MAPS["ual"].values())
WATCHED_BONES = (SWORD_HAND, OFF_HAND, "Head", "pelvis")
HINGES = ("lowerarm_l", "lowerarm_r", "calf_l", "calf_r")
TWIST_LIMITS = {"upperarm_l": 80.0, "upperarm_r": 80.0, "lowerarm_l": 100.0, "lowerarm_r": 100.0, "hand_l": 45.0, "hand_r": 45.0}
FLIP_BONES = ("upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "thigh_l", "thigh_r", "calf_l", "calf_r", "spine_03", "Head")
BODY_MATCH_BONES = (
    "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head",
    "upperarm_l", "lowerarm_l", "hand_l", "upperarm_r", "lowerarm_r", "hand_r",
    "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r",
)
SEGMENTS = (
    ("pelvis", "spine_01", 0.142), ("spine_01", "spine_03", 0.215), ("spine_03", "neck_01", 0.14), ("neck_01", "Head", 0.081),
    ("upperarm_l", "lowerarm_l", 0.028), ("lowerarm_l", "hand_l", 0.016), ("hand_l", "middle_01_l", 0.006),
    ("upperarm_r", "lowerarm_r", 0.028), ("lowerarm_r", "hand_r", 0.016), ("hand_r", "middle_01_r", 0.006),
    ("thigh_l", "calf_l", 0.1), ("calf_l", "foot_l", 0.0465), ("foot_l", "ball_l", 0.0145),
    ("thigh_r", "calf_r", 0.1), ("calf_r", "foot_r", 0.0465), ("foot_r", "ball_r", 0.0145),
)

MAX_REACH_FRACTION = 0.999
GRIP_HAND_GAP = 1.1
GRIP_WINDOW_WEIGHT = 0.5
OFF_HAND_GRIP_ROLL_DEGREES = -80.0
OFF_HAND_GRIP_ROLL_RANGE_DEGREES = (-150.0, -10.0)
GRIP_ROLL_RESOLVE_DEGREES = 1.0
WRIST_TWIST_SHARE_TO_FOREARM = 0.85
TWIST_LIMIT_FRACTION = 0.95
MIN_TWIST_CORRECTION_DEGREES = 0.5
FOREARM_EDGE_PULL = 0.35
EDGE_PULL_MIN_ACROSS = 0.3
HINGE_SIDEWAYS_BLEND_FROM_DEGREES = 15.0
HINGE_SIDEWAYS_BLEND_TO_DEGREES = 35.0
HINGE_BEND_BLEND_FROM_DEGREES = 10.0
HINGE_BEND_BLEND_TO_DEGREES = 30.0

LEG_IK_FULL_METRES = 0.05
STEP_LIFT_PER_METRE = 0.25
STEP_LIFT_MAX = 0.1
STEP_MIN_DISTANCE = 0.02
BALANCE_ITERATIONS = 3
BALANCE_MARGIN = 0.03
GROUNDED_TOLERANCE = 0.03
FOOT_HALF_WIDTH = 0.04

RELEASE_SECONDS = 0.1
DEFAULT_ARC = 0.25
FOLLOWER_RELEASE_FRAMES = 3
MOVING_HOLD_PELVIS_DRIFT_METRES = (0.0, 0.0, -0.006)
MOVING_HOLD_CHEST_DRIFT_DEGREES = (-1.5, 0.0, 0.0)
BACK = 1.2

RANGE_MARGIN = math.radians(8.0)
POP_DEGREES_PER_FRAME = 40.0
LONG_ARC_DEGREES = 150.0
PLANT_SLIDE_TOLERANCE = 0.005
GRIP_DRIFT_TOLERANCE = 0.01
FULL_GRIP_WEIGHT = 0.999
WRIST_BEND_LIMIT_DEGREES = 25.0
FIRST_FRAME_SETTLE_PASSES = 8
ELBOW_BEND_MIN_DEGREES = 25.0
ARM_ABDUCTION_MIN_DEGREES = 25.0
ELBOW_CLEARANCE_MIN_METRES = 0.25
CHECKED_AUTHORED_WEIGHT = 0.5
BLADE_JERK_LIMIT = 2500.0
SNAP_MIN_TIP_SPEED = 4.0
DEAD_FRAMES = 6
DEAD_DEGREES = 0.05
MATCH_DEGREES = 8.0
HINGE_WRONG_WAY_DEGREES = 10.0
HINGE_SIDEWAYS_DEGREES = 25.0
FLIP_DEGREES_PER_FRAME = 75.0


class Follower(NamedTuple):
    frequency: float
    damping: float
    lag_frames: int


FOLLOWERS = {
    "pelvis": Follower(3.4, 0.75, 0),
    "chest": Follower(2.6, 0.55, 1),
    "head": Follower(2.2, 0.5, 2),
    "blade": Follower(3.2, 0.6, 1),
}


def smooth_unit(amount):
    return amount * amount * (3.0 - 2.0 * amount)


def smoothstep(edge0, edge1, value):
    return smooth_unit(min(1.0, max(0.0, (value - edge0) / (edge1 - edge0))))


EASES = {
    "linear": lambda amount: amount,
    "in": lambda amount: amount * amount,
    "out": lambda amount: 1.0 - (1.0 - amount) ** 2,
    "inOut": smooth_unit,
}
FEELS = {
    "ease": smooth_unit,
    "hold": smooth_unit,
    "movingHold": smooth_unit,
    "snap": lambda amount: 1.0 - (1.0 - amount) ** 4,
    "overshoot": lambda amount: 1.0 + (BACK + 1.0) * (amount - 1.0) ** 3 + BACK * (amount - 1.0) ** 2,
    "anticipate": lambda amount: (BACK + 1.0) * amount**3 - BACK * amount**2,
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


def blend_rotation(start, end, amount):
    return start.slerp(-end if start.dot(end) < 0.0 else end, amount)


def turn_toward(start, end, amount):
    return rotation_exp(rotation_log(start.rotation_difference(end)) * amount) @ start


def turn_degrees(before, after):
    return math.degrees(before.rotation_difference(after).angle)


def shortest_turn_degrees(before, after):
    degrees = turn_degrees(before, after)
    return min(degrees, 360.0 - degrees)


def basis(first, second):
    return Matrix((first, second, first.cross(second))).transposed()


def edge_across_blade(edge, blade, fallback):
    perpendicular = edge - edge.project(blade)
    return perpendicular.normalized() if perpendicular.length > VECTOR_EPSILON else fallback


def is_carried(hand):
    return hand is not None and "pull" in hand


def twist_about(rotation, axis):
    rotation = -rotation if rotation.w < 0.0 else rotation
    return 2.0 * math.atan2(Vector((rotation.x, rotation.y, rotation.z)).dot(axis), rotation.w)


def twist_degrees(rotation):
    rotation = -rotation if rotation.w < 0.0 else rotation
    angle = math.degrees(2.0 * math.atan2(rotation.y, rotation.w))
    return (angle + 180.0) % 360.0 - 180.0


def swing_vector(rotation):
    twist = Quaternion((0.0, 1.0, 0.0), math.radians(twist_degrees(rotation)))
    vector = rotation_log(rotation @ twist.inverted())
    vector.y = 0.0
    return vector


def convex_hull(points):
    ordered = sorted(set(points))
    if len(ordered) < 3:
        return ordered

    def turn(origin, first, second):
        return (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0])

    lower, upper = [], []
    for point in ordered:
        while len(lower) >= 2 and turn(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    for point in reversed(ordered):
        while len(upper) >= 2 and turn(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def inside_distance(polygon, point):
    if len(polygon) < 3:
        return -math.inf
    distance = math.inf
    for start, end in zip(polygon, polygon[1:] + polygon[:1]):
        edge = (end[0] - start[0], end[1] - start[1])
        length = math.hypot(*edge)
        if length < FLOAT_EPSILON:
            continue
        distance = min(distance, (edge[0] * (point[1] - start[1]) - edge[1] * (point[0] - start[0])) / length)
    return distance


def follow(values, follower, blend, difference, advance):
    omega = 2.0 * math.pi * follower.frequency
    step = 1.0 / OUTPUT_FPS
    current = values[0]
    velocity = difference(values[0], values[0])
    result = []
    for index in range(len(values)):
        error = difference(values[max(0, index - follower.lag_frames)], current)
        velocity = velocity + (error * (omega * omega) - velocity * (2.0 * follower.damping * omega)) * step
        current = advance(current, velocity * step)
        result.append(blend(values[index], current, index))
    return result


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


class ReferenceMotion:
    def __init__(self):
        self.actions = list(bpy.data.actions)
        self.ranges = None
        self.flexion = None

    def rotations(self, bones=None, frame_step=1):
        for action in self.actions:
            curves = {}
            for curve in action_fcurves(action):
                if curve.data_path.endswith(".rotation_quaternion"):
                    name = curve.data_path.split('"')[1]
                    if bones is None or name in bones:
                        curves.setdefault(name, [None] * 4)[curve.array_index] = curve
            start, end = (int(frame) for frame in action.frame_range)
            for bone, components in curves.items():
                if None in components:
                    continue
                for frame in range(start, end + 1, frame_step):
                    yield bone, Quaternion([curve.evaluate(frame) for curve in components]).normalized()

    def natural_ranges(self):
        if self.ranges is None:
            lows, highs = {}, {}
            for bone, rotation in self.rotations():
                vector = rotation_log(rotation)
                low = lows.setdefault(bone, vector.copy())
                high = highs.setdefault(bone, vector.copy())
                for axis in range(3):
                    low[axis] = min(low[axis], vector[axis])
                    high[axis] = max(high[axis], vector[axis])
            self.ranges = {bone: (lows[bone], highs[bone]) for bone in lows}
        return self.ranges

    def flexion_axes(self):
        if self.flexion is None:
            totals = {bone: Vector() for bone in HINGES}
            for bone, rotation in self.rotations(HINGES, frame_step=2):
                totals[bone] += swing_vector(rotation)
            self.flexion = {bone: total.normalized() for bone, total in totals.items() if total.length > VECTOR_EPSILON}
        return self.flexion


def character_height(target):
    heights = [
        (obj.matrix_world @ Vector(corner)).z
        for obj in bpy.data.objects
        if obj.type == "MESH" and any(modifier.type == "ARMATURE" and modifier.object == target for modifier in obj.modifiers)
        for corner in obj.bound_box
    ]
    return max(heights) - min(heights)


@dataclass(frozen=True)
class CarryAnchor:
    bone: str
    hilt: Vector
    blade: Vector

    @classmethod
    def from_config(cls, carry, target, height):
        to_armature = target.matrix_world.to_3x3().inverted() @ Matrix(BLENDER_TO_GLTF.T.tolist())
        bone = target.data.bones[carry["bone"]]
        return cls(
            bone.name,
            bone.head_local + to_armature @ Vector(carry["hilt"]) * height,
            (to_armature @ Vector(carry["blade"])).normalized(),
        )


@dataclass(frozen=True)
class GameFit:
    knuckle_reach: float
    palm_depth: float
    blade_length: float
    carry: CarryAnchor | None
    tuning: dict

    @classmethod
    def from_config(cls, game, target):
        height = character_height(target)
        return cls(
            knuckle_reach=game["grip"]["knuckleReach"],
            palm_depth=game["grip"]["palmDepth"],
            blade_length=game["bladeToCharacterHeight"] * height,
            carry=CarryAnchor.from_config(game["carry"], target, height) if "carry" in game else None,
            tuning=game["tuning"],
        )


class AuthoredClipBaker(ABC):
    job_key = None

    def __init__(self, target, library, probe, references, fit):
        self.target = target
        self.fit = fit
        self.clip_marks = {}
        self.library = library
        self.probe = probe
        self.references = references
        self.skeleton = Skeleton(target)
        self.rest_hip = target.data.bones["pelvis"].head_local.copy()
        self.root_rest_inverse = target.data.bones["root"].matrix_local.to_quaternion().inverted()
        self.skeleton_verified = False

    @abstractmethod
    def bake(self, job):
        pass

    def checks(self, job, frames, frame_matrices, check_context):
        return []

    def finish(self, job, frames, pelvis_targets, warnings, finger_weights=None, check_context=None):
        frame_count = len(frames)
        if "fingers" in job:
            gripping = self.library.capture(job["fingers"]).rotations
            finger_bones = [bone for bone in gripping if bone.split("_")[0] in FINGERS]
            weights = list(finger_weights) if finger_weights is not None else [0.0] * frame_count
            for grip in job.get("grips", []):
                first, last = self.contact_range(job, grip, frame_count)
                for index, weight in self.contact_weights(first, last, frame_count):
                    weights[index] = max(weights[index], weight)
            for pose, weight in zip(frames, weights):
                for bone in finger_bones:
                    pose.rotations[bone] = pose.rotations[bone].slerp(gripping[bone], weight)

        for plant in job.get("plants", []):
            chain = LEG_CHAINS[plant["foot"]]
            first, last = self.contact_range(job, plant, frame_count)
            anchor = self.library.capture(plant["pose"]) if "pose" in plant else frames[first]
            locked = self.skeleton.matrices(anchor)[chain[2]].copy()
            self.hold_contact(frames, chain, first, last, lambda matrices: locked)
        for grip in job.get("grips", []):
            first, last = self.contact_range(job, grip, frame_count)
            reference = self.skeleton.matrices(self.library.capture(grip["pose"]) if "pose" in grip else frames[first])
            hilt_offset = reference[SWORD_HAND].inverted() @ reference[OFF_HAND]
            self.hold_contact(frames, OFF_HAND_ARM, first, last, lambda matrices: matrices[SWORD_HAND] @ hilt_offset)

        frame_matrices = [self.skeleton.matrices(pose) for pose in frames]
        self.report(job, frames, frame_matrices, warnings + self.checks(job, frames, frame_matrices, check_context))
        writer = self.write(job["output"], frames)
        self.ground(job, writer, frames, pelvis_targets)
        writer.action.name = job["output"]
        set_scene_fps(OUTPUT_FPS)
        return writer.action, frame_count, OUTPUT_FPS

    def verify_skeleton(self):
        if self.skeleton_verified:
            return
        action = self.references.actions[0]
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

    def contact_range(self, job, contact, frame_count):
        first, last = (int(round(contact[edge] * OUTPUT_FPS)) for edge in ("from", "to"))
        if not 0 <= first < last < frame_count:
            raise ValueError(f"{job['output']}: contact {contact} must satisfy 0 <= from < to <= clip length")
        return first, last

    def contact_weights(self, first, last, frame_count):
        release = round(RELEASE_SECONDS * OUTPUT_FPS)
        engage = release if first > 0 else 0
        for index in range(max(first - engage, 0), min(last + release, frame_count - 1) + 1):
            if index < first:
                yield index, 1.0 - (first - index) / engage
            else:
                yield index, 1.0 if index <= last else 1.0 - (index - last) / (release + 1)

    def hold_contact(self, frames, chain, first, last, target_for):
        for index, weight in self.contact_weights(first, last, len(frames)):
            matrices = self.skeleton.matrices(frames[index])
            free = matrices[chain[2]]
            held = target_for(matrices)
            position = free.translation.lerp(held.translation, weight)
            rotation = blend_rotation(free.to_quaternion(), held.to_quaternion(), weight)
            self.skeleton.solve_two_bone(frames[index], chain, position, rotation)

    def report(self, job, frames, frame_matrices, warnings):
        output = job["output"]
        worst_range = {}
        worst_pop = (0.0, "", 0.0)
        previous = None
        for index, (pose, matrices) in enumerate(zip(frames, frame_matrices)):
            time = index / OUTPUT_FPS
            for bone, (low, high) in self.references.natural_ranges().items():
                if bone.split("_")[0] in FINGERS:
                    continue
                rotation = pose.rotations.get(bone)
                if rotation is None:
                    continue
                vector = rotation_log(rotation)
                excess = max(max(low[axis] - vector[axis], vector[axis] - high[axis]) for axis in range(3)) - RANGE_MARGIN
                if excess > worst_range.get(bone, (0.0, 0.0))[0]:
                    worst_range[bone] = (excess, time)
            watched = {bone: matrices[bone].to_quaternion() for bone in WATCHED_BONES}
            if previous is not None:
                for bone, rotation in watched.items():
                    step = shortest_turn_degrees(previous[bone], rotation)
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
            anchor = frame_matrices[first][foot].translation
            slide = max((frame_matrices[index][foot].translation - anchor).length for index in range(first, last + 1))
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


class KeyedClipBaker(AuthoredClipBaker):
    job_key = "keys"

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
        arc_warnings = [
            f"long arc {bone} {arc:.0f}° between keys at {times[index]:.2f}s and {times[index + 1]:.2f}s,"
            " add a key between them"
            for bone, spline in rotations.items()
            for index, arc in enumerate(spline.arcs)
            if arc > LONG_ARC_DEGREES
        ]
        return self.finish(job, [pose for pose, _ in sampled], [target for _, target in sampled], arc_warnings)

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


@dataclass
class ResolvedStance:
    base: Pose
    pelvis: Vector
    pelvis_turn: Vector
    chest: Vector
    head: Vector
    shoulder: Vector
    feet: dict
    foot_rotations: dict
    hand: Vector
    edge: Vector
    hand_ik: float
    off_hand: Vector
    off_hand_ik: float
    blade: Vector
    auto_edge: float
    elbow: Vector
    grip: float
    authored: float
    carry_weight: float
    carry_pull: float
    pinned_feet: float
    off_hand_elbow: Vector

    def drifted(self):
        return replace(
            self,
            pelvis=self.pelvis + character_vector(MOVING_HOLD_PELVIS_DRIFT_METRES),
            chest=self.chest + Vector(MOVING_HOLD_CHEST_DRIFT_DEGREES),
        )


@dataclass
class WarmStart:
    arm_rotations: dict
    grip: float
    release: Quaternion | None
    sword_edge: Vector


class BeatSpan(NamedTuple):
    start: float
    end: float
    origin: ResolvedStance
    target: ResolvedStance
    travel_from: Vector
    travel_to: Vector
    beat: dict


@dataclass
class BeatTimeline:
    spans: list
    grip_weights: list
    authored_weights: list


def in_hold(spans, now):
    return any(span.start <= now <= span.end and span.beat["feel"] == "hold" for span in spans)


class HandFrame(NamedTuple):
    blade: Vector
    finger: Vector
    basis_inverse: Matrix
    handle_offset: Vector
    knuckle_span: float

    @classmethod
    def from_rest(cls, bones, side, fit):
        wrist = bones[f"hand_{side}"]
        rest_inverse = wrist.matrix_local.to_quaternion().inverted()

        def from_wrist(name):
            return rest_inverse @ (bones[f"{name}_{side}"].head_local - wrist.head_local)

        index, middle, ring, pinky, thumb = (from_wrist(f"{name}_01") for name in ("index", "middle", "ring", "pinky", "thumb"))
        blade = (index - pinky).normalized()
        finger = (middle - middle.project(blade)).normalized()
        palm_side = middle.normalized().cross((index - pinky) - (index - pinky).project(middle.normalized())).normalized()
        thumb_depth = thumb.dot(palm_side)
        palm_side = -palm_side if thumb_depth < 0.0 else palm_side
        knuckle_centre = (index + middle + ring + pinky) / 4.0
        handle_offset = knuckle_centre * fit.knuckle_reach + palm_side * abs(thumb_depth) * fit.palm_depth
        return cls(blade, finger, basis(blade, finger).inverted(), handle_offset, (index - pinky).length)


class BeatClipBaker(AuthoredClipBaker):
    job_key = "beats"

    def __init__(self, target, library, probe, references, fit):
        super().__init__(target, library, probe, references, fit)
        self.sword_hand_frame, self.off_hand_frame = (HandFrame.from_rest(target.data.bones, side, fit) for side in ("r", "l"))
        self.grip_spacing = self.sword_hand_frame.knuckle_span * GRIP_HAND_GAP
        self.height = self.rest_hip.z
        self.hand_twists = {}

    def scaled(self, values):
        return character_vector([value * self.height for value in values])

    def blade_rotation(self, blade, edge, basis_inverse=None):
        blade = blade.normalized()
        edge = (edge - edge.project(blade)).normalized()
        if basis_inverse is None:
            basis_inverse = self.sword_hand_frame.basis_inverse
        return (basis(blade, edge) @ basis_inverse).to_quaternion()

    def blade_axis(self, matrices):
        rotation = matrices[SWORD_HAND].to_quaternion()
        blade = rotation @ self.sword_hand_frame.blade
        handle = matrices[SWORD_HAND].translation + rotation @ self.sword_hand_frame.handle_offset
        finger = rotation @ self.sword_hand_frame.finger
        return handle, blade, (finger - finger.project(blade)).normalized()

    def off_hand_grip(self, handle, blade, sword_finger, roll):
        edge = Quaternion(blade, roll) @ sword_finger
        held_rotation = self.blade_rotation(blade, edge, self.off_hand_frame.basis_inverse)
        wrist_target = handle - blade * self.grip_spacing - held_rotation @ self.off_hand_frame.handle_offset
        return held_rotation, wrist_target

    def elbow_offset(self, matrices, arm):
        offset = matrices[arm[1]].translation - matrices[arm[0]].translation
        side = -1.0 if arm[2].endswith("r") else 1.0
        return side * offset.x, offset.y, -offset.z

    def elbow_offset_from_pelvis(self, matrices, arm):
        offset = matrices[arm[1]].translation - matrices["pelvis"].translation
        side = -1.0 if arm[2].endswith("r") else 1.0
        return side * offset.x, offset.y, offset.z

    def elbow_clearance(self, matrices, arm):
        pelvis = matrices["pelvis"].translation
        spine = matrices["spine_03"].translation - pelvis
        offset = matrices[arm[1]].translation - pelvis
        return (offset - offset.project(spine)).length

    def arm_posture_degrees(self, matrices, arm):
        shoulder, elbow, wrist = (matrices[name].translation for name in arm)
        upper_arm = elbow - shoulder
        torso_down = matrices["pelvis"].translation - matrices["spine_03"].translation
        return math.degrees(upper_arm.angle(wrist - elbow)), math.degrees(upper_arm.angle(torso_down))

    def wrist_bend_degrees(self, matrices, arm):
        forearm = matrices[arm[2]].translation - matrices[arm[1]].translation
        fingers = matrices[f"middle_01_{arm[2][-1]}"].translation - matrices[arm[2]].translation
        return math.degrees(forearm.angle(fingers))

    def off_hand_grip_drift(self, matrices):
        handle, blade, _ = self.blade_axis(matrices)
        rotation = matrices[OFF_HAND].to_quaternion()
        target = handle - blade * self.grip_spacing - rotation @ self.off_hand_frame.handle_offset
        return (target - matrices[OFF_HAND].translation).length

    def forearm_pulled_edge(self, matrices, chain, blade, carried_from, fallback):
        forearm = (matrices[chain[2]].translation - matrices[chain[1]].translation).normalized()
        across = forearm - forearm.project(blade)
        carried = edge_across_blade(carried_from if carried_from is not None else across, blade, fallback)
        if across.length > EDGE_PULL_MIN_ACROSS and across.dot(carried) > 0.0:
            carried = turn_toward(carried, across.normalized(), FOREARM_EDGE_PULL)
        return carried

    def resolve(self, stance):
        base, _ = self.key_pose({"pose": stance["base"]})
        matrices = self.skeleton.matrices(base)
        placements = stance.get("feet", {})
        foot_source = self.reference_matrices(stance["feetFrom"]) if "feetFrom" in stance else matrices
        feet = {}
        for side in FEET:
            resting = foot_source[FEET[side][0]].translation.copy()
            if side in placements:
                x, y, lift = placements[side]
                placed = self.scaled((x, y, 0.0))
                resting = Vector((placed.x, placed.y, resting.z + lift * self.height))
            feet[side] = resting
        intent = stance.get("hand")
        carried = is_carried(intent)
        hand = None if carried else intent
        base_hand_rotation = matrices[SWORD_HAND].to_quaternion()
        has_explicit_edge = intent is not None and "edge" in intent
        resolved = ResolvedStance(
            base=base,
            pelvis=matrices["pelvis"].translation + self.scaled(stance.get("pelvis", (0.0, 0.0, 0.0))),
            pelvis_turn=Vector(stance.get("pelvisTurn", (0.0, 0.0, 0.0))),
            chest=Vector(stance.get("chest", (0.0, 0.0, 0.0))),
            head=Vector(stance.get("head", (0.0, 0.0, 0.0))),
            shoulder=Vector(stance.get("shoulder", (0.0, 0.0, 0.0))),
            feet=feet,
            foot_rotations={side: matrices[FEET[side][0]].to_quaternion() for side in FEET},
            hand=self.scaled(hand["position"]) if hand else matrices[SWORD_HAND].translation.copy(),
            edge=character_vector(intent["edge"]).normalized() if has_explicit_edge else base_hand_rotation @ self.sword_hand_frame.finger,
            hand_ik=1.0 if hand or carried else 0.0,
            off_hand=self.off_hand_target(stance.get("offHand"), matrices),
            off_hand_ik=1.0 if "offHand" in stance else 0.0,
            blade=character_vector(hand["blade"]).normalized() if hand else base_hand_rotation @ self.sword_hand_frame.blade,
            auto_edge=1.0 if (carried or hand) and not has_explicit_edge else 0.0,
            elbow=character_vector(stance.get("elbow", SWORD_ELBOW)).normalized(),
            grip=stance.get("gripHold", 1.0) if stance.get("offHand") == "grip" else 0.0,
            authored=1.0 if set(stance) - {"base"} else 0.0,
            carry_weight=1.0 if carried else 0.0,
            carry_pull=intent["pull"] if carried else 0.0,
            pinned_feet=1.0 if "feetFrom" in stance else 0.0,
            off_hand_elbow=character_vector(stance.get("offHandElbow", OFF_HAND_ELBOW)).normalized(),
        )
        if not carried:
            return resolved
        chest = self.skeleton.matrices(self.pose_torso(resolved, Vector(), Vector()))
        hand, blade = self.carried_grip(chest, resolved.carry_pull, resolved.edge)
        return replace(resolved, hand=hand, blade=blade)

    def reference_matrices(self, reference):
        return self.skeleton.matrices(self.key_pose({"pose": reference})[0])

    def off_hand_target(self, intent, matrices):
        if isinstance(intent, list):
            return self.scaled(intent)
        if isinstance(intent, dict):
            return self.reference_matrices(intent)[OFF_HAND].translation.copy()
        return matrices[OFF_HAND].translation.copy()

    def carry_frame(self, matrices):
        carry = self.fit.carry
        if carry is None:
            raise ValueError("a carried hand needs game.carry in the job config")
        return matrices[carry.bone] @ self.target.data.bones[carry.bone].matrix_local.inverted()

    def carried_hilt(self, matrices):
        return self.carry_frame(matrices) @ self.fit.carry.hilt

    def head_centre(self, matrices):
        bone = self.target.data.bones["Head"]
        tail = matrices["Head"] @ (bone.matrix_local.inverted() @ bone.tail_local)
        return (matrices["Head"].translation + tail) / 2.0

    def blade_head_clearance(self, matrices):
        handle, blade, _ = self.blade_axis(matrices)
        along = blade * self.fit.blade_length
        centre = self.head_centre(matrices)
        reach = min(1.0, max(0.0, (centre - handle).dot(along) / along.length_squared))
        return (centre - (handle + along * reach)).length - self.fit.tuning["headRadiusHips"] * self.height

    def carried_grip(self, matrices, pull, edge):
        carry = self.fit.carry
        moved = self.carry_frame(matrices)
        blade = moved.to_3x3() @ carry.blade
        hilt = moved @ (carry.hilt - carry.blade * pull * self.height)
        return hilt - self.blade_rotation(blade, edge) @ self.sword_hand_frame.handle_offset, blade

    def interpolate(self, start, end, amount, arc):
        clamped = min(1.0, max(0.0, amount))

        def mix(first, second):
            return first + (second - first) * amount

        def mix_clamped(first, second):
            return first + (second - first) * clamped

        def turn(first, second):
            return first @ rotation_exp(rotation_log(first.inverted() @ second) * amount)

        chord = end.hand - start.hand
        outward = (start.hand + end.hand) / 2.0 - (start.pelvis + end.pelvis) / 2.0
        outward.z = 0.0
        bulge = (
            outward.normalized() * (chord.length * (DEFAULT_ARC if arc is None else arc))
            if outward.length > VECTOR_EPSILON
            else Vector()
        )
        control = (start.hand + end.hand) / 2.0 + bulge
        on_curve = start.hand * (1.0 - clamped) ** 2 + control * (2.0 * clamped * (1.0 - clamped)) + end.hand * clamped**2
        base = start.base.copy()
        for bone in base.rotations:
            base.rotations[bone] = blend_rotation(start.base.rotations[bone], end.base.rotations[bone], clamped)
        return ResolvedStance(
            base=base,
            pelvis=mix(start.pelvis, end.pelvis),
            pelvis_turn=mix(start.pelvis_turn, end.pelvis_turn),
            chest=mix(start.chest, end.chest),
            head=mix(start.head, end.head),
            shoulder=mix(start.shoulder, end.shoulder),
            feet={side: self.stepped(start.feet[side], end.feet[side], amount) for side in FEET},
            foot_rotations={side: turn(start.foot_rotations[side], end.foot_rotations[side]) for side in FEET},
            hand=on_curve + chord * (amount - clamped),
            edge=turn_toward(start.edge, end.edge, clamped),
            hand_ik=mix_clamped(start.hand_ik, end.hand_ik),
            off_hand=mix(start.off_hand, end.off_hand),
            off_hand_ik=mix_clamped(start.off_hand_ik, end.off_hand_ik),
            blade=turn_toward(start.blade, end.blade, amount),
            auto_edge=mix_clamped(start.auto_edge, end.auto_edge),
            elbow=turn_toward(start.elbow, end.elbow, clamped),
            grip=mix_clamped(start.grip, end.grip),
            authored=mix_clamped(start.authored, end.authored),
            carry_weight=mix_clamped(start.carry_weight, end.carry_weight),
            carry_pull=mix_clamped(start.carry_pull, end.carry_pull),
            pinned_feet=mix_clamped(start.pinned_feet, end.pinned_feet),
            off_hand_elbow=turn_toward(start.off_hand_elbow, end.off_hand_elbow, clamped),
        )

    def stepped(self, start, end, amount):
        clamped = min(1.0, max(0.0, amount))
        position = start.lerp(end, clamped)
        distance = (Vector((end.x - start.x, end.y - start.y, 0.0))).length
        if distance > STEP_MIN_DISTANCE:
            position.z += min(STEP_LIFT_MAX, STEP_LIFT_PER_METRE * distance) * 4.0 * clamped * (1.0 - clamped)
        return position

    def place_with_pole(self, pose, chain, target, pole):
        upper, lower, end = chain
        matrices = self.skeleton.matrices(pose)
        root, joint, tip = (matrices[name].translation.copy() for name in chain)
        upper_length = (joint - root).length
        lower_length = (tip - joint).length
        reach = target - root
        distance = max(VECTOR_EPSILON, min(reach.length, (upper_length + lower_length) * MAX_REACH_FRACTION))
        direction = reach.normalized()
        side = pole - pole.project(direction)
        if side.length < VECTOR_EPSILON:
            side = (joint - root) - (joint - root).project(direction)
        side.normalize()
        cosine = max(-1.0, min(1.0, (upper_length**2 + distance**2 - lower_length**2) / (2.0 * upper_length * distance)))
        elbow = root + direction * (upper_length * cosine) + side * (upper_length * math.sqrt(1.0 - cosine * cosine))
        swing = (joint - root).rotation_difference(elbow - root)
        pose.rotations[upper] = self.skeleton.local_rotation(upper, swing @ matrices[upper].to_quaternion(), matrices)
        matrices = self.skeleton.matrices(pose)
        joint, tip = matrices[lower].translation, matrices[end].translation
        swing = (tip - joint).rotation_difference(root + direction * distance - joint)
        pose.rotations[lower] = self.skeleton.local_rotation(lower, swing @ matrices[lower].to_quaternion(), matrices)

    def solve_hinged(self, pose, chain, target, rotation, pole=None):
        upper, lower, end = chain
        twist = twist_degrees(pose.rotations[lower])
        if pole is None:
            self.skeleton.solve_two_bone(pose, chain, target, rotation)
        else:
            self.place_with_pole(pose, chain, target, pole)
            matrices = self.skeleton.matrices(pose)
            pose.rotations[end] = self.skeleton.local_rotation(end, rotation, matrices)
        axis = self.references.flexion_axes().get(lower)
        if axis is None:
            return
        plain_swing = swing_vector(pose.rotations[lower])
        sideways = math.degrees((plain_swing - axis * plain_swing.dot(axis)).length)
        bend = math.degrees(plain_swing.length)
        weight = smoothstep(HINGE_SIDEWAYS_BLEND_FROM_DEGREES, HINGE_SIDEWAYS_BLEND_TO_DEGREES, sideways) * smoothstep(
            HINGE_BEND_BLEND_FROM_DEGREES, HINGE_BEND_BLEND_TO_DEGREES, bend
        )
        if weight <= 0.0:
            return
        matrices = self.skeleton.matrices(pose)
        root, joint, tip = (matrices[name].translation.copy() for name in chain)
        normal = (joint - root).cross(tip - joint)
        if normal.length < VECTOR_EPSILON:
            return
        bone_axis = (joint - root).normalized()
        rest_lower = self.skeleton.rest_relative[lower].to_quaternion()
        hinge = matrices[upper].to_quaternion() @ (rest_lower @ axis)
        flat_hinge = hinge - hinge.project(bone_axis)
        flat_normal = (normal - normal.project(bone_axis)).normalized()
        if flat_hinge.length < VECTOR_EPSILON:
            return
        desired = (tip - joint).normalized()
        best = None
        for wanted in (flat_normal, -flat_normal):
            roll = flat_hinge.angle(wanted)
            if flat_hinge.cross(wanted).dot(bone_axis) < 0.0:
                roll = -roll
            trial = pose.copy()
            trial.rotations[upper] = trial.rotations[upper] @ Quaternion((0.0, 1.0, 0.0), roll)
            frame = self.skeleton.matrices(trial)[upper].to_quaternion() @ rest_lower
            straight = frame @ Vector((0.0, 1.0, 0.0))
            pivot = frame @ axis
            flex = math.atan2(desired.dot(pivot.cross(straight)), desired.dot(straight))
            if best is None or flex > best[0]:
                best = (flex, trial)
        flex, hinged = best
        hinged.rotations[lower] = Quaternion(axis, flex) @ Quaternion((0.0, 1.0, 0.0), math.radians(twist))
        hinged_matrices = self.skeleton.matrices(hinged)
        plain_upper = matrices[upper].to_quaternion()
        plain_lower = matrices[lower].to_quaternion()
        pose.rotations[upper] = self.skeleton.local_rotation(
            upper, blend_rotation(plain_upper, hinged_matrices[upper].to_quaternion(), weight), matrices
        )
        matrices = self.skeleton.matrices(pose)
        pose.rotations[lower] = self.skeleton.local_rotation(
            lower, blend_rotation(plain_lower, hinged_matrices[lower].to_quaternion(), weight), matrices
        )
        matrices = self.skeleton.matrices(pose)
        pose.rotations[end] = self.skeleton.local_rotation(end, rotation, matrices)

    def turn_bones(self, pose, shares, degrees):
        for bone, share in shares:
            matrices = self.skeleton.matrices(pose)
            turned = character_rotation(degrees * share) @ matrices[bone].to_quaternion()
            pose.rotations[bone] = self.skeleton.local_rotation(bone, turned, matrices)

    def distribute_twist(self, pose, lower, end):
        current = twist_degrees(pose.rotations[lower])
        limit = TWIST_LIMITS[lower] * TWIST_LIMIT_FRACTION
        demanded = twist_degrees(pose.rotations[end])
        previous = self.hand_twists.get(end)
        if previous is not None:
            demanded += 360.0 * round((previous - demanded) / 360.0)
        self.hand_twists[end] = demanded
        moved = demanded * WRIST_TWIST_SHARE_TO_FOREARM
        twist = max(-limit, min(limit, current + moved)) - current
        if abs(twist) < MIN_TWIST_CORRECTION_DEGREES:
            return
        matrices = self.skeleton.matrices(pose)
        held = matrices[end].to_quaternion()
        pose.rotations[lower] = pose.rotations[lower] @ Quaternion((0.0, 1.0, 0.0), math.radians(twist))
        matrices = self.skeleton.matrices(pose)
        pose.rotations[end] = self.skeleton.local_rotation(end, held, matrices)

    def pose_torso(self, stance, travel, shift):
        pose = stance.base.copy()
        pose.locations["root"] = self.root_rest_inverse @ travel
        pose.locations["pelvis"] = Vector()
        matrices = self.skeleton.matrices(pose)
        pose.locations["pelvis"] = self.skeleton.local_location("pelvis", stance.pelvis + travel + shift, matrices)
        matrices = self.skeleton.matrices(pose)
        turned = character_rotation(stance.pelvis_turn) @ matrices["pelvis"].to_quaternion()
        pose.rotations["pelvis"] = self.skeleton.local_rotation("pelvis", turned, matrices)
        self.turn_bones(pose, SPINE_SHARES, stance.chest)
        self.turn_bones(pose, NECK_SHARES, stance.head)
        if stance.shoulder.length > 0.0:
            self.turn_bones(pose, ((SWORD_CLAVICLE, 1.0),), stance.shoulder)
        return pose

    def build(self, stance, travel, shift, warm):
        pose = self.pose_torso(stance, travel, shift)
        for side, chain in LEG_CHAINS.items():
            target = stance.feet[side] + travel
            resting = self.skeleton.matrices(pose)[chain[2]].translation
            weight = max(stance.pinned_feet, min(1.0, (target - resting).length / LEG_IK_FULL_METRES))
            if weight <= 0.0:
                continue
            free_leg = {bone: pose.rotations[bone].copy() for bone in chain}
            self.solve_hinged(pose, chain, target, stance.foot_rotations[side])
            if weight < 1.0:
                for bone in chain:
                    pose.rotations[bone] = blend_rotation(free_leg[bone], pose.rotations[bone], weight)
        matrices = self.skeleton.matrices(pose)
        free_hand = matrices[SWORD_HAND]
        if stance.hand_ik <= 0.0:
            return self.finish_off_hand(pose, stance, travel, warm)
        shoulder, elbow, wrist = (matrices[name].translation.copy() for name in SWORD_ARM)
        base_pole = (elbow - shoulder) - (elbow - shoulder).project(wrist - shoulder)
        free_arm = {bone: pose.rotations[bone].copy() for bone in SWORD_ARM}
        if warm is not None:
            for bone in SWORD_ARM[:2]:
                pose.rotations[bone] = warm.arm_rotations[bone].copy()
        pole = turn_toward(base_pole.normalized(), stance.elbow, stance.hand_ik) if base_pole.length > VECTOR_EPSILON else stance.elbow
        if stance.carry_weight > 0.0:
            held_edge = turn_toward(warm.sword_edge, stance.edge, 1.0 - stance.auto_edge) if warm is not None else stance.edge
            hand, blade = self.carried_grip(matrices, stance.carry_pull, held_edge)
            stance = replace(stance, hand=stance.hand.lerp(hand, stance.carry_weight), blade=turn_toward(stance.blade, blade, stance.carry_weight))
        hand_target = free_hand.translation.lerp(stance.hand + travel + shift * (1.0 - stance.hand_ik), stance.hand_ik)
        self.solve_hinged(pose, SWORD_ARM, hand_target, free_hand.to_quaternion(), pole)
        matrices = self.skeleton.matrices(pose)
        authored = edge_across_blade(stance.edge, stance.blade, stance.blade.orthogonal().normalized())
        carried = self.forearm_pulled_edge(
            matrices, SWORD_ARM, stance.blade, warm.sword_edge if warm is not None else authored, authored
        )
        if stance.auto_edge < 1.0:
            carried = turn_toward(carried, authored, 1.0 - stance.auto_edge)
        pose.rotations[SWORD_HAND] = self.skeleton.local_rotation(
            SWORD_HAND, self.blade_rotation(stance.blade, carried), matrices
        )
        self.distribute_twist(pose, SWORD_ARM[1], SWORD_HAND)
        if stance.hand_ik < 1.0:
            for bone in SWORD_ARM:
                pose.rotations[bone] = blend_rotation(free_arm[bone], pose.rotations[bone], stance.hand_ik)
        return self.finish_off_hand(pose, stance, travel, warm)

    def finish_off_hand(self, pose, stance, travel, warm):
        if stance.off_hand_ik <= 0.0:
            return pose, None
        matrices = self.skeleton.matrices(pose)
        free_off_hand = matrices[OFF_HAND].copy()
        free_arm = {bone: pose.rotations[bone].copy() for bone in OFF_HAND_ARM}
        grip = stance.grip
        reach = 1.0 if grip > 0.0 else stance.off_hand_ik
        free_target = stance.off_hand + travel
        target = free_target
        roll = math.radians(OFF_HAND_GRIP_ROLL_DEGREES)
        if grip > 0.0:
            handle, blade, sword_finger = self.blade_axis(matrices)
            held_rotation, hilt = self.off_hand_grip(handle, blade, sword_finger, roll)
            target = free_target.lerp(hilt, grip) if grip < 1.0 else hilt
        shoulder, elbow, wrist = (matrices[name].translation.copy() for name in OFF_HAND_ARM)
        if warm is not None:
            for bone in OFF_HAND_ARM[:2]:
                pose.rotations[bone] = warm.arm_rotations[bone].copy()
        base_pole = (elbow - shoulder) - (elbow - shoulder).project(wrist - shoulder)
        default = stance.off_hand_elbow
        pole = turn_toward(base_pole.normalized(), default, stance.off_hand_ik) if base_pole.length > VECTOR_EPSILON else default
        self.solve_hinged(pose, OFF_HAND_ARM, target, free_off_hand.to_quaternion(), pole)
        lower = OFF_HAND_ARM[1]
        matrices = self.skeleton.matrices(pose)
        relaxed = matrices[lower].to_quaternion() @ self.skeleton.rest_relative[OFF_HAND].to_quaternion()
        if grip > 0.0:
            comfortable = roll + twist_about(relaxed @ held_rotation.inverted(), blade)
            low, high = (math.radians(degrees) for degrees in OFF_HAND_GRIP_ROLL_RANGE_DEGREES)
            comfortable = min(max(comfortable, low), high)
            if abs(comfortable - roll) > math.radians(GRIP_ROLL_RESOLVE_DEGREES):
                held_rotation, hilt = self.off_hand_grip(handle, blade, sword_finger, comfortable)
                target = free_target.lerp(hilt, grip) if grip < 1.0 else hilt
                self.solve_hinged(pose, OFF_HAND_ARM, target, free_off_hand.to_quaternion(), pole)
                matrices = self.skeleton.matrices(pose)
                relaxed = matrices[lower].to_quaternion() @ self.skeleton.rest_relative[OFF_HAND].to_quaternion()
        release = None
        if grip > 0.0:
            chest = matrices[RELEASE_ANCHOR].to_quaternion()
            if warm is not None and grip < warm.grip:
                release = warm.release if warm.release is not None else chest.inverted() @ held_rotation
                held_rotation = chest @ release
            pose.rotations[OFF_HAND] = self.skeleton.local_rotation(
                OFF_HAND, blend_rotation(relaxed, held_rotation, grip), matrices
            )
        self.distribute_twist(pose, lower, OFF_HAND)
        weight = stance.off_hand_ik * reach
        if weight < 1.0:
            for bone in OFF_HAND_ARM:
                pose.rotations[bone] = blend_rotation(free_arm[bone], pose.rotations[bone], weight)
        return pose, release

    def support(self, matrices):
        lowest = min(matrices[foot].translation.z for foot, _ in FEET.values())
        points = []
        for foot, ball in FEET.values():
            if matrices[foot].translation.z > lowest + GROUNDED_TOLERANCE:
                continue
            heel, toe = matrices[foot].translation, matrices[ball].translation
            along = Vector((toe.x - heel.x, toe.y - heel.y, 0.0))
            across = Vector((-along.y, along.x, 0.0)).normalized() * FOOT_HALF_WIDTH if along.length > VECTOR_EPSILON else Vector()
            for point in (heel, toe):
                points += [(point.x + across.x, point.y + across.y), (point.x - across.x, point.y - across.y)]
        return convex_hull(points)

    def centre_of_mass(self, matrices):
        total = Vector()
        for start, end, mass in SEGMENTS:
            total += (matrices[start].translation + matrices[end].translation) * (mass / 2.0)
        return total

    def balanced(self, stance, travel, warm):
        pose, release = self.build(stance, travel, Vector(), warm)
        if stance.authored <= 0.0:
            return pose, release
        shift = Vector()
        for _ in range(BALANCE_ITERATIONS):
            matrices = self.skeleton.matrices(pose)
            polygon = self.support(matrices)
            if len(polygon) < 3:
                return pose, release
            centre = self.centre_of_mass(matrices)
            margin = inside_distance(polygon, (centre.x, centre.y))
            if margin >= BALANCE_MARGIN:
                return pose, release
            middle = Vector((sum(point[0] for point in polygon) / len(polygon), sum(point[1] for point in polygon) / len(polygon), 0.0))
            toward = Vector((middle.x - centre.x, middle.y - centre.y, 0.0))
            if toward.length < VECTOR_EPSILON:
                return pose, release
            shift += toward.normalized() * ((BALANCE_MARGIN - margin) * stance.authored)
            pose, release = self.build(stance, travel, shift, warm)
        return pose, release

    def bake(self, job):
        self.verify_skeleton()
        self.references.flexion_axes()
        self.hand_twists = {}
        output = job["output"]
        if not job["beats"]:
            raise ValueError(f"{output}: needs at least one beat")
        used = {job["start"], *(beat["pose"] for beat in job["beats"])}
        unknown = sorted(used - set(job["stances"]))
        if unknown:
            raise ValueError(f"{output}: unknown stances {unknown}")
        stances = {name: self.resolve(job["stances"][name]) for name in used}
        bad_feels = sorted({beat["feel"] for beat in job["beats"]} - set(FEELS))
        if bad_feels:
            raise ValueError(f"{output}: unknown feel {bad_feels}, expected one of {sorted(FEELS)}")

        previous = stances[job["start"]]
        previous_travel = Vector()
        time = 0.0
        spans = []
        for beat in job["beats"]:
            if beat["seconds"] < 1.0 / OUTPUT_FPS - KEY_SPACING_TOLERANCE:
                raise ValueError(f"{output}: beat {beat['pose']} is shorter than one frame")
            target = stances[beat["pose"]]
            if beat["feel"] == "movingHold":
                target = target.drifted()
            travel = self.scaled(beat["travel"]) if "travel" in beat else previous_travel
            spans.append(BeatSpan(time, time + beat["seconds"], previous, target, previous_travel, travel, beat))
            if beat.get("contact"):
                print(f"CONTACT {output} {time:.3f}")
            previous, previous_travel = target, travel
            time += beat["seconds"]

        frame_count = int(round(time * OUTPUT_FPS)) + 1
        raw, travels = [], []
        for index in range(frame_count):
            now = min(index / OUTPUT_FPS, time)
            span = next(span for span in spans if span.start <= now <= span.end + FLOAT_EPSILON)
            amount = FEELS[span.beat["feel"]]((now - span.start) / (span.end - span.start))
            raw.append(self.interpolate(span.origin, span.target, amount, span.beat.get("arc")))
            travels.append(span.travel_from.lerp(span.travel_to, min(1.0, max(0.0, amount))))

        holding = [in_hold(spans, index / OUTPUT_FPS) for index in range(frame_count)]
        release = [0.0] * frame_count
        for index in range(1, frame_count):
            release[index] = min(1.0, release[index - 1] + 1.0 / FOLLOWER_RELEASE_FRAMES) if holding[index] else 0.0

        def follow_vectors(name, values):
            return follow(
                values,
                FOLLOWERS[name],
                lambda value, followed, index: followed.lerp(value, release[index]),
                lambda target, current: target - current,
                lambda current, delta: current + delta,
            )

        pelvis = follow_vectors("pelvis", [stance.pelvis for stance in raw])
        chest = follow_vectors("chest", [stance.chest for stance in raw])
        head = follow_vectors("head", [stance.head for stance in raw])
        blades = follow(
            [stance.blade for stance in raw],
            FOLLOWERS["blade"],
            lambda value, followed, index: turn_toward(followed, value, release[index]),
            lambda target, current: rotation_log(current.rotation_difference(target)),
            lambda current, delta: (rotation_exp(delta) @ current).normalized(),
        )
        for stance, pelvis_value, chest_value, head_value, blade_value in zip(raw, pelvis, chest, head, blades):
            stance.pelvis, stance.chest, stance.head = pelvis_value, chest_value, head_value
            stance.blade = blade_value.normalized()

        frames = []
        warm = None
        for index, (stance, travel) in enumerate(zip(raw, travels)):
            pose, captured_release = self.balanced(stance, travel, warm)
            if index == 0:
                for _ in range(FIRST_FRAME_SETTLE_PASSES):
                    pose, captured_release = self.balanced(stance, travel, self.warm_start(pose, stance, captured_release))
            frames.append(pose)
            warm = self.warm_start(pose, stance, captured_release)
        pelvis_targets = [self.skeleton.matrices(pose)["pelvis"].translation.copy() for pose in frames]
        grip_weights = [stance.grip * stance.off_hand_ik for stance in raw]
        authored_weights = [stance.authored for stance in raw]
        if job.get("reversed"):
            for series in (frames, pelvis_targets, grip_weights, authored_weights):
                series.reverse()
            spans = [span._replace(start=time - span.end, end=time - span.start) for span in reversed(spans)]
        timeline = BeatTimeline(spans=spans, grip_weights=grip_weights, authored_weights=authored_weights)
        self.clip_marks[output] = self.derive_marks(output, spans, timeline.grip_weights, job.get("reversed", False))
        return self.finish(job, frames, pelvis_targets, [], timeline.grip_weights, timeline)

    def derive_marks(self, output, spans, grip_weights, reversed_spans):
        names = [span.beat["mark"] for span in spans if "mark" in span.beat]
        if len(names) != len(set(names)):
            raise ValueError(f"{output}: duplicate beat marks {sorted(names)}")
        marks = {
            span.beat["mark"]: round((span.end if reversed_spans else span.start) * OUTPUT_FPS) / OUTPUT_FPS
            for span in spans
            if "mark" in span.beat
        }
        gripped = [index for index, weight in enumerate(grip_weights) if weight >= GRIP_WINDOW_WEIGHT]
        grip = {"from": gripped[0] / OUTPUT_FPS, "to": gripped[-1] / OUTPUT_FPS} if gripped else None
        return {"seconds": (len(grip_weights) - 1) / OUTPUT_FPS, "marks": marks, "grip": grip}

    def warm_start(self, pose, stance, release):
        return WarmStart(
            arm_rotations={bone: pose.rotations[bone].copy() for bone in (*SWORD_ARM[:2], *OFF_HAND_ARM[:2])},
            grip=stance.grip * stance.off_hand_ik,
            release=release,
            sword_edge=self.skeleton.matrices(pose)[SWORD_HAND].to_quaternion() @ self.sword_hand_frame.finger,
        )

    def pose_difference(self, pose, reference):
        actual = self.skeleton.matrices(pose)
        expected = self.skeleton.matrices(self.key_pose({"pose": reference})[0])
        return max(
            (shortest_turn_degrees(actual[bone].to_quaternion(), expected[bone].to_quaternion()), bone)
            for bone in BODY_MATCH_BONES
        )

    def checks(self, job, frames, frame_matrices, timeline):
        warnings = []
        step = 1.0 / OUTPUT_FPS

        worst_balance = (0.0, 0.0)
        for index, matrices in enumerate(frame_matrices):
            polygon = self.support(matrices)
            if len(polygon) >= 3 and timeline.authored_weights[index] >= CHECKED_AUTHORED_WEIGHT:
                centre = self.centre_of_mass(matrices)
                margin = inside_distance(polygon, (centre.x, centre.y))
                if margin < worst_balance[0]:
                    worst_balance = (margin, index * step)
        if worst_balance[0] < 0.0:
            warnings.append(f"balance centre of mass {-worst_balance[0] * 100:.1f}cm outside the feet at {worst_balance[1]:.2f}s")

        gripped = [index for index, weight in enumerate(timeline.grip_weights) if weight >= FULL_GRIP_WEIGHT]
        if gripped:
            drift, at = max(
                (self.off_hand_grip_drift(frame_matrices[index]), index * step)
                for index in gripped
            )
            if drift > GRIP_DRIFT_TOLERANCE:
                warnings.append(f"grip drift {drift * 100:.1f}cm at {at:.2f}s")
            for label, arm in (("sword hand", SWORD_ARM), ("off hand", OFF_HAND_ARM)):
                bends = [(self.wrist_bend_degrees(frame_matrices[index], arm), index * step) for index in gripped]
                bend, at = max(bends)
                typical = sorted(value for value, _ in bends)[len(bends) // 2]
                print(f"CHECK {job['output']} info wrist bend {label} {bend:.0f}° at {at:.2f}s typical {typical:.0f}°")
                if bend > WRIST_BEND_LIMIT_DEGREES:
                    warnings.append(f"wrist bend {label} {bend:.0f}° at {at:.2f}s")
                elbow, abduction = (
                    min(self.arm_posture_degrees(frame_matrices[index], arm)[axis] for index in gripped) for axis in (0, 1)
                )
                print(f"CHECK {job['output']} info arm {label} elbow bend min {elbow:.0f}° abduction min {abduction:.0f}°")
                if elbow < ELBOW_BEND_MIN_DEGREES:
                    warnings.append(f"arm {label} nearly straight, elbow bend {elbow:.0f}°")
                clearance = min(self.elbow_clearance(frame_matrices[index], arm) for index in gripped)
                print(f"CHECK {job['output']} info elbow clearance {label} min {clearance * 100:.0f}cm")
                out, back, down = (
                    sum(self.elbow_offset(frame_matrices[index], arm)[axis] for index in gripped) / len(gripped) * 100 for axis in range(3)
                )
                print(f"CHECK {job['output']} info elbow offset {label} out {out:.0f}cm back {back:.0f}cm down {down:.0f}cm")
                from_pelvis = [
                    sum(self.elbow_offset_from_pelvis(frame_matrices[index], arm)[axis] for index in gripped) / len(gripped) * 100
                    for axis in range(3)
                ]
                print(f"CHECK {job['output']} info elbow from pelvis {label} out {from_pelvis[0]:.0f}cm back {from_pelvis[1]:.0f}cm up {from_pelvis[2]:.0f}cm")
                if clearance < ELBOW_CLEARANCE_MIN_METRES:
                    warnings.append(f"elbow {label} {clearance * 100:.0f}cm from the spine, inside the ribs")
                if abduction < ARM_ABDUCTION_MIN_DEGREES:
                    warnings.append(f"arm {label} pressed against the torso, {abduction:.0f}° out")
        if self.fit.carry is not None and any(is_carried(job["stances"][name].get("hand")) for name in (job["start"], *(beat["pose"] for beat in job["beats"]))):
            gaps = [(self.blade_axis(matrices)[0] - self.carried_hilt(matrices)).length for matrices in frame_matrices]
            clearances = [self.blade_head_clearance(matrices) for matrices in frame_matrices]
            gripped = [index for index, gap in enumerate(gaps) if gap <= self.fit.tuning["gripGapMetres"]]
            mount = self.clip_marks[job["output"]]["marks"].get("mount")
            if not gripped:
                warnings.append(f"the hand never comes within {self.fit.tuning['gripGapMetres'] * 100:.0f}cm of the carried hilt")
            elif mount is None:
                warnings.append("a carrying clip needs a beat with mark mount")
            else:
                mount_frame = round(mount * OUTPUT_FPS)
                if not gripped[0] <= mount_frame <= gripped[-1]:
                    warnings.append(f"mount at {mount:.2f}s is outside the grip window {gripped[0] * step:.2f}-{gripped[-1] * step:.2f}s")
                in_hand = range(gripped[0]) if job.get("reversed") else range(gripped[-1] + 1, len(frames))
                worst, at = min((clearances[index], index * step) for index in in_hand) if len(in_hand) else (math.inf, 0.0)
                print(f"CHECK {job['output']} info carry mount gap {gaps[min(mount_frame, len(gaps) - 1)] * 100:.1f}cm head clearance min {worst * 100:.1f}cm at {at:.2f}s")
                if worst < self.fit.tuning["headClearanceMetres"]:
                    warnings.append(f"head clearance {worst * 100:.1f}cm below {self.fit.tuning['headClearanceMetres'] * 100:.0f}cm at {at:.2f}s")
        flexion = self.references.flexion_axes()
        worst_hinge = {}
        worst_twist = {}
        for index, pose in enumerate(frames):
            if timeline.authored_weights[index] < CHECKED_AUTHORED_WEIGHT:
                continue
            for bone, axis in flexion.items():
                vector = swing_vector(pose.rotations[bone])
                bend = math.degrees(vector.dot(axis))
                sideways = vector - axis * vector.dot(axis)
                if -bend > worst_hinge.get((bone, "wrong way"), (0.0, 0.0))[0]:
                    worst_hinge[(bone, "wrong way")] = (-bend, index * step)
                if math.degrees(sideways.length) > worst_hinge.get((bone, "sideways"), (0.0, 0.0))[0]:
                    worst_hinge[(bone, "sideways")] = (math.degrees(sideways.length), index * step)
            for bone, limit in TWIST_LIMITS.items():
                twist = abs(twist_degrees(pose.rotations[bone]))
                if twist - limit > worst_twist.get(bone, (0.0, 0.0))[0]:
                    worst_twist[bone] = (twist - limit, index * step)
        for (bone, kind), (degrees, time) in sorted(worst_hinge.items()):
            limit = HINGE_WRONG_WAY_DEGREES if kind == "wrong way" else HINGE_SIDEWAYS_DEGREES
            if degrees > limit:
                warnings.append(f"hinge {bone} bends {kind} {degrees:.0f}° at {time:.2f}s")
        for bone, (excess, time) in sorted(worst_twist.items()):
            warnings.append(f"twist {bone} {excess:.0f}° past its {TWIST_LIMITS[bone]:.0f}° limit at {time:.2f}s")

        worst_flip = (0.0, "", 0.0)
        for index in range(1, len(frames)):
            for bone in FLIP_BONES:
                change = shortest_turn_degrees(
                    frame_matrices[index - 1][bone].to_quaternion(), frame_matrices[index][bone].to_quaternion()
                )
                if change > worst_flip[0]:
                    worst_flip = (change, bone, index * step)
        if worst_flip[0] > FLIP_DEGREES_PER_FRAME:
            warnings.append(f"flip {worst_flip[1]} {worst_flip[0]:.0f}°/frame at {worst_flip[2]:.2f}s")

        tips = [matrices[SWORD_HAND] @ (self.sword_hand_frame.blade * self.fit.blade_length) for matrices in frame_matrices]
        smooth = set()
        for span in timeline.spans:
            if span.beat["feel"] in ("ease", "hold"):
                smooth.update(range(int(round(span.start / step)) + 2, int(round(span.end / step)) - 1))
        jerk, jerk_at = max(
            (
                ((tips[index + 1] - tips[index] * 3.0 + tips[index - 1] * 3.0 - tips[index - 2]).length / step**3, index * step)
                for index in range(2, len(tips) - 1)
                if index in smooth
            ),
            default=(0.0, 0.0),
        )
        print(f"CHECK {job['output']} info blade jerk peak {jerk:.0f} at {jerk_at:.2f}s")
        if jerk > BLADE_JERK_LIMIT:
            warnings.append(f"blade jerk {jerk:.0f} above {BLADE_JERK_LIMIT:.0f}")

        for span in timeline.spans:
            if span.beat["feel"] != "snap":
                continue
            first, last = int(round(span.start / step)), int(round(span.end / step))
            speed = max(((tips[index + 1] - tips[index]).length / step for index in range(first, min(last, len(tips) - 1))), default=0.0)
            if speed < SNAP_MIN_TIP_SPEED:
                warnings.append(f"snap slow {span.beat['pose']} tip {speed:.1f}m/s below {SNAP_MIN_TIP_SPEED:.1f}")

        still = 0
        for index in range(1, len(frames)):
            moved = max(
                turn_degrees(frame_matrices[index - 1][bone].to_quaternion(), frame_matrices[index][bone].to_quaternion())
                for bone in WATCHED_BONES
            )
            still = still + 1 if moved < DEAD_DEGREES and not in_hold(timeline.spans, index * step) else 0
            if still == DEAD_FRAMES:
                warnings.append(f"dead {DEAD_FRAMES} still frames ending at {index * step:.2f}s")

        for edge, frame in (("start", frames[0]), ("end", frames[-1])):
            reference = job.get(f"{edge}Matches")
            if reference is None:
                continue
            difference, bone = self.pose_difference(frame, reference)
            if difference > MATCH_DEGREES:
                warnings.append(f"{edge} off {difference:.0f}° at {bone} from {reference['clip']}")
        return warnings


AUTHORED_BAKERS = (BeatClipBaker, KeyedClipBaker)
