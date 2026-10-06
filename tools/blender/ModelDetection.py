from abc import ABC, abstractmethod
import hashlib
import json
from pathlib import Path

import numpy as np

BODY_FIELDS = ("kind", "attachBone", "columns", "rows", "feel", "segmentedParts", "clothSeed")


def segment_distance(points, start, end):
    span = end - start
    along = np.clip(((points - start) @ span) / max(float(span @ span), 1e-12), 0.0, 1.0)
    return np.linalg.norm(points - (start + along[:, None] * span), axis=1)


def triangle_areas(positions, corners):
    first, second, third = positions[corners[:, 0]], positions[corners[:, 1]], positions[corners[:, 2]]
    return 0.5 * np.linalg.norm(np.cross(second - first, third - first), axis=1)


def side_label(offset, dead_zone):
    if np.hypot(offset[0], offset[1]) < dead_zone:
        return "centre"
    if abs(offset[1]) >= abs(offset[0]):
        return "front" if offset[1] < 0 else "back"
    return "left" if offset[0] > 0 else "right"


class BodyNamer:
    def __init__(self, axis, dead_zone, taken=None):
        self.axis = np.array(axis, np.float64)
        self.dead_zone = dead_zone
        self.taken = set() if taken is None else taken

    def name(self, role, point):
        base = f"{role}_{side_label(point[:2] - self.axis, self.dead_zone)}"
        name, number = base, 0
        while name in self.taken:
            number += 1
            name = f"{base}_{number}"
        self.taken.add(name)
        return name


class AnchorResolver:
    def __init__(self, descriptor, joints):
        chains, tails = descriptor.chains, descriptor.segment_tails
        self.anchors = [bone for bone in descriptor.prop_anchors if bone in joints and (chains.get(bone) or tails.get(bone)) in joints]
        if not self.anchors:
            raise ValueError(f"none of the prop anchor bones {list(descriptor.prop_anchors)} has fitted joints")
        self.segments = {bone: (np.asarray(joints[bone], np.float64), np.asarray(joints[chains.get(bone) or tails.get(bone)], np.float64)) for bone in self.anchors}

    def nearest_to_cloud(self, points):
        distances = [float(segment_distance(points, *self.segments[bone]).mean()) for bone in self.anchors]
        return self.anchors[int(np.argmin(distances))]

    def nearest_to_point(self, point):
        distances = [float(np.linalg.norm(self.segments[bone][0] - point)) for bone in self.anchors]
        return self.anchors[int(np.argmin(distances))]


class PartDetector(ABC):
    kind = ""

    def __init__(self, settings, namer):
        self.settings = settings
        self.namer = namer

    @abstractmethod
    def detect(self, *arguments): ...


class PropDetector(PartDetector):
    kind = "prop"

    def detect(self, prop_configs, part_points, part_ids):
        named = [prop["name"] for prop in prop_configs if prop.get("name")]
        if len(set(named)) != len(named):
            raise ValueError(f"recipe props repeat a name: {named}")
        self.namer.taken.update(named)
        found = []
        for prop in prop_configs:
            parts = sorted(prop["segmentedParts"])
            points = part_points[np.isin(part_ids, parts)]
            if len(points) == 0:
                raise ValueError(f"prop with segmentedParts {parts}: the segmented reference model has no such part")
            found.append((points.mean(axis=0), parts, prop.get("name"), prop.get("bone")))
        found.sort(key=lambda entry: -float(entry[0][2]))
        return [
            {"name": name or self.namer.name("prop", centroid), "bone": bone, "anchored": "recipe" if bone else None, "segmentedParts": parts}
            for centroid, parts, name, bone in found
        ]


class ClothDetector(PartDetector):
    kind = "cloth"

    def detect(self, centres, areas, thin_face, piece, claimed):
        settings, tuning = self.settings, self.settings.section("detection")
        minimum_area = tuning.minClothArea * settings.proportions.factor ** 2
        cell = settings.length(tuning.clothCellSize)
        candidates, accepted = [], []
        for label in np.unique(piece[thin_face & ~claimed]):
            members = np.flatnonzero(thin_face & ~claimed & (piece == label))
            if len(members) < tuning.minClothFaces:
                continue
            points = centres[members]
            area = float(areas[members].sum())
            entry = {"faces": int(len(members)), "area": round(area, 4), "centroid": [round(float(v), 3) for v in points.mean(axis=0)]}
            if area < minimum_area:
                entry["decision"] = "rigid: below minClothArea"
            else:
                accepted.append((area, points, entry))
            candidates.append(entry)
        accepted.sort(key=lambda item: -item[0])
        for _, _, entry in accepted[tuning.maxPhysicsBodies:]:
            entry["decision"] = "rigid: over maxPhysicsBodies"
        kept = sorted(accepted[: tuning.maxPhysicsBodies], key=lambda item: -float(item[1].mean(axis=0)[2]))
        bodies = []
        for _, points, entry in kept:
            centroid = points.mean(axis=0)
            flat = points[:, :2] - centroid[:2]
            across = np.array([*np.linalg.eigh(np.cov(flat.T))[1][:, -1], 0.0])
            width = float(np.ptp((points - centroid) @ across))
            height = float(np.ptp(points[:, 2]))
            top = points[points[:, 2] >= np.percentile(points[:, 2], 95)].mean(axis=0)
            entry["decision"] = "cloth body"
            bodies.append(
                {
                    "name": self.namer.name("cloth", centroid),
                    "kind": "sheet",
                    "attachBone": None,
                    "anchored": None,
                    "anchorPoint": [round(float(value), 4) for value in top],
                    "clothSeed": [round(float(value), 4) for value in points[int(np.argmin(np.linalg.norm(points - centroid, axis=1)))]],
                    "columns": max(2, int(round(width / cell))),
                    "rows": max(2, int(round(height / cell)) + 1),
                }
            )
        return bodies, candidates


def resolve_anchors(descriptor, joints, detection, part_points, part_ids):
    if not detection["props"] and not detection["physics"]:
        return detection
    resolver = AnchorResolver(descriptor, joints)
    for prop in detection["props"]:
        if prop.get("anchored") is None:
            prop["bone"] = resolver.nearest_to_cloud(part_points[np.isin(part_ids, prop["segmentedParts"])])
    for body in detection["physics"]:
        if body.get("anchored") is None:
            body["attachBone"] = resolver.nearest_to_point(np.array(body["anchorPoint"]))
    return detection


def detection_stamp(config):
    payload = {
        "props": config["props"],
        "overrides": config["overrides"],
        "tuning": {section: config["tuning"][section] for section in ("prepare", "detection")},
        "anchors": config["skeletonDescriptor"]["propAnchors"],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def assert_detection_current(config, work):
    detection = json.loads((Path(work) / "detection.json").read_text())
    if detection["stamp"] != detection_stamp(config):
        raise ValueError("props, overrides or the detection and prepare tuning changed since the prepare stage: rerun from prepare")
    return detection


def is_manual_body(override):
    return bool(override.get("segmentedParts")) != bool(override.get("clothSeed"))


def apply_overrides(overrides, props, physics, dropped, final):
    props, physics = list(props), list(physics)
    for name, override in overrides.items():
        if any(entry["name"] == name for entry in dropped):
            continue
        prop = next((entry for entry in props if entry["name"] == name), None)
        body = next((entry for entry in physics if entry["name"] == name), None)
        if prop is None and body is None:
            if not is_manual_body(override):
                if final:
                    names = [entry["name"] for entry in props + physics]
                    raise ValueError(f"override {name} matches no detected body (detected: {names}); a body the detector missed needs segmentedParts or clothSeed plus attachBone, columns and rows")
                continue
            if override.get("exclude") or bool(override.get("segmentedParts")) == final:
                continue
            missing = [field for field in ("attachBone", "columns", "rows") if field not in override]
            if missing:
                raise ValueError(f"override {name}: a manual body also needs {missing}")
            physics.append({"name": name, "kind": override.get("kind", "sheet"), "anchored": "override", **{field: override[field] for field in BODY_FIELDS if field in override and field != "kind"}})
            continue
        if override.get("exclude"):
            (props if prop is not None else physics).remove(prop if prop is not None else body)
            dropped.append({"name": name, "reason": "override"})
        elif prop is not None:
            unsupported = [field for field in override if field != "attachBone"]
            if unsupported:
                raise ValueError(f"override {name} targets a prop: only attachBone and exclude apply, not {unsupported}")
            if "attachBone" in override:
                prop["bone"] = override["attachBone"]
                prop["anchored"] = "override"
        else:
            if override.get("segmentedParts") and sorted(override["segmentedParts"]) != sorted(body.get("segmentedParts", [])):
                raise ValueError(f"override {name}: segmentedParts can only create a new body, it cannot retarget the detected body {name}")
            for field in BODY_FIELDS:
                if field in override:
                    body[field] = override[field]
            if "attachBone" in override:
                body["anchored"] = "override"
            if "clothSeed" in override:
                body.pop("segmentedParts", None)
    return props, physics
