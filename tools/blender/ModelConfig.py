import json
from pathlib import Path

import numpy as np


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

    @property
    def pelvis(self):
        return self._bone("pelvis")

    @property
    def chest(self):
        return self._bone("chest")

    @property
    def neck(self):
        return self._bone("neck")

    @property
    def head(self):
        return self._bone("head")

    @property
    def head_top(self):
        return self._bone("headTop")

    @property
    def root(self):
        return self._bone("root")

    @property
    def spine(self):
        return tuple(self._bone("spine"))

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
    def chains(self):
        return dict(self._section("chains"))

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

    @property
    def core_bones(self):
        return tuple(self._section("rig")["coreBones"])

    @property
    def damped_bones(self):
        return tuple(self._section("rig")["dampedBones"])

    @property
    def torso_anchors(self):
        return tuple(self._section("rig")["torsoAnchors"])

    @property
    def spine_curve(self):
        return tuple((bone, region) for bone, region in self._section("spineCurve"))

    @property
    def placed_joints(self):
        return tuple(self._section("placedJoints"))

    @property
    def segment_tails(self):
        return dict(self._section("segmentTails"))

    @property
    def hidden_bone_parts(self):
        return tuple(self._section("hiddenBoneParts"))

    @property
    def prop_anchors(self):
        return tuple(self._section("propAnchors"))

    @property
    def collider_segments(self):
        return tuple(tuple(segment) for segment in self._section("colliderSegments"))

    @property
    def finger_bones(self):
        return tuple(self._section("fingerBones"))

    def preview_clips(self, kind):
        return tuple((name, fraction) for name, fraction in self._section("previewClips")[kind])

    @property
    def leaf_marker(self):
        return self._section("leafMarker")

    def hand_for_bone(self, name):
        for side in self.SIDES:
            if name.endswith(f"_{self.suffix(side)}"):
                return self.arm(side)[-1]
        raise KeyError(f"skeleton descriptor has no side matching bone {name}")


class Proportions:
    def __init__(self, height, reference_height):
        self.factor = height / reference_height

    @classmethod
    def from_config(cls, config):
        return cls(config["heightMetres"], config["referenceHeightMetres"])

    def length(self, metres):
        return metres * self.factor

    def lengths(self, values):
        return tuple(value * self.factor for value in values)

    def vector(self, values):
        return np.array(values, dtype=np.float64) * self.factor


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
    def __init__(self, descriptor, proportions, tuning):
        self.descriptor = descriptor
        self.proportions = proportions
        self.tuning = tuning

    @classmethod
    def from_config(cls, config):
        return cls(SkeletonDescriptor.from_config(config), Proportions.from_config(config), Tuning.from_config(config))

    def section(self, name):
        return self.tuning.section(name)

    def length(self, metres):
        return self.proportions.length(metres)


def detected_bodies(work):
    return json.loads((Path(work) / "detection.json").read_text())


def write_detection(work, detection):
    (Path(work) / "detection.json").write_text(json.dumps(detection, indent=2))
