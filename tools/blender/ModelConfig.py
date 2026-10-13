import json
from pathlib import Path

import numpy as np


def bone_role(key, convert=None):
    return property(lambda self: self._bone(key) if convert is None else convert(self._bone(key)))


def descriptor_section(key, convert=None):
    return property(lambda self: self._section(key) if convert is None else convert(self._section(key)))


class SkeletonDescriptor:
    SIDES = ("left", "right")

    def __init__(self, data):
        self.data = data

    @classmethod
    def from_config(cls, config):
        return cls(config["skeletonDescriptor"])

    def _section(self, key):
        try:
            return self.data[key]
        except KeyError:
            raise KeyError(f"skeleton descriptor has no section {key}") from None

    def _bone(self, key):
        try:
            return self.data["bones"][key]
        except KeyError:
            raise KeyError(f"skeleton descriptor has no bone role {key}") from None

    pelvis = bone_role("pelvis")
    chest = bone_role("chest")
    neck = bone_role("neck")
    head = bone_role("head")
    head_top = bone_role("headTop")
    root = bone_role("root")
    spine = bone_role("spine", tuple)

    chains = descriptor_section("chains", dict)
    core_bones = descriptor_section("rig", lambda rig: tuple(rig["coreBones"]))
    damped_bones = descriptor_section("rig", lambda rig: tuple(rig["dampedBones"]))
    torso_anchors = descriptor_section("rig", lambda rig: tuple(rig["torsoAnchors"]))
    spine_curve = descriptor_section("spineCurve", lambda curve: tuple((bone, region) for bone, region in curve))
    placed_joints = descriptor_section("placedJoints", tuple)
    segment_tails = descriptor_section("segmentTails", dict)
    hidden_bone_parts = descriptor_section("hiddenBoneParts", tuple)
    prop_anchors = descriptor_section("propAnchors", tuple)
    collider_segments = descriptor_section(
        "colliderSegments", lambda segments: tuple(tuple(segment) for segment in segments)
    )
    finger_bones = descriptor_section("fingerBones", tuple)
    leaf_marker = descriptor_section("leafMarker")

    def suffix(self, side):
        return self._section("sides")[side]

    def side_sign(self, side):
        return float(self._section("sideSigns")[side])

    def arm(self, side):
        return tuple(self._bone("arms")[side])

    def leg(self, side):
        return tuple(self._bone("legs")[side])

    def feet(self, side):
        return tuple(self._bone("feet")[side])

    def clavicle(self, side):
        return self._bone("clavicles")[side]

    def hand_tip(self, side):
        return self._bone("handTips")[side]

    @property
    def limbs(self):
        return {
            name: {
                **limb,
                "segments": tuple(tuple(segment) for segment in limb["segments"]),
                "bones": tuple(limb["bones"]),
                "distal": tuple(limb["distal"]),
            }
            for name, limb in self._section("limbs").items()
        }

    @property
    def regions(self):
        return {name: tuple(bones) for name, bones in self._section("regions").items()}

    def preview_clips(self, kind):
        return tuple((name, fraction) for name, fraction in self._section("previewClips")[kind])

    def hand_for_bone(self, name):
        for side in self.SIDES:
            if name.endswith(f"_{self.suffix(side)}"):
                return self.arm(side)[-1]
        raise KeyError(f"skeleton descriptor has no side matching bone {name}")


class HeightScale:
    def __init__(self, height, reference_height):
        self.scale = height / reference_height

    @classmethod
    def from_config(cls, config):
        return cls(config["heightMetres"], config["referenceHeightMetres"])

    def length(self, metres):
        return metres * self.scale

    def lengths(self, values):
        return tuple(value * self.scale for value in values)

    def vector(self, values):
        return np.array(values, dtype=np.float64) * self.scale


class TuningSection:
    def __init__(self, name, values):
        self._name = name
        self._values = values

    def __getattr__(self, key):
        if key.startswith("_"):
            raise AttributeError(key)
        try:
            return self._values[key]
        except KeyError:
            raise AttributeError(f"tuning {self._name}.{key} is missing from the recipe") from None


class Tuning:
    def __init__(self, sections):
        self._sections = sections

    @classmethod
    def from_config(cls, config):
        return cls(config["tuning"])

    def section(self, name):
        try:
            return TuningSection(name, self._sections[name])
        except KeyError:
            raise KeyError(f"tuning has no section {name}") from None


class ModelSettings:
    def __init__(self, descriptor, height_scale, tuning):
        self.descriptor = descriptor
        self.height_scale = height_scale
        self.tuning = tuning

    @classmethod
    def from_config(cls, config):
        return cls(SkeletonDescriptor.from_config(config), HeightScale.from_config(config), Tuning.from_config(config))

    def section(self, name):
        return self.tuning.section(name)

    def length(self, metres):
        return self.height_scale.length(metres)


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, data, **dump_options):
    Path(path).write_text(json.dumps(data, **dump_options))


def read_detection(work):
    return read_json(Path(work) / "detection.json")


def write_detection(work, detection):
    write_json(Path(work) / "detection.json", detection, indent=2)
