from abc import ABC, abstractmethod
import json
import math
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree
from scipy.sparse import coo_matrix, diags
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

import PhysicsLattice as lattice
from Geometry import (
    SkinInfluences,
    face_edges,
    multi_source_distance,
    normalised,
    principal_axes,
    rounded,
    segment_distance,
    smooth_unit,
    smoothstep,
    to_blender,
    to_gltf,
    triangle_areas,
)
from ModelConfig import ModelSettings, detected_bodies, write_detection
from ModelDetection import (
    BodyNamer,
    ClothDetector,
    PropDetector,
    apply_overrides,
    assert_detection_current,
    detection_stamp,
    resolve_anchors,
)
from ModelBuild import (
    ClipPoses,
    ContactSheet,
    ReferenceFrame,
    Skeleton,
    SkeletonFit,
    SkinnedPreview,
    PhysicsWork,
    Studio,
    TextureBaker,
    WELD_DECIMALS,
    decimate,
    loop_vertex_indices,
    mesh_corners,
    mesh_positions,
    read_attribute,
    select_only,
    weld_ids,
    weld_labels,
    write_positions,
)

MASK_COLOURS = ((1.0, 0.1, 0.1, 1.0), (0.1, 0.9, 0.2, 1.0), (0.2, 0.4, 1.0, 1.0), (0.9, 0.8, 0.1, 1.0))
BAND_STRETCH_PERCENTILE = 99.0
MANTLE_COLOUR = (0.6, 0.2, 0.9, 1.0)
SKIN_COLOUR = (1.0, 0.55, 0.15, 1.0)
PLAIN_COLOUR = (0.62, 0.62, 0.65, 1.0)


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


def components(first, second, count):
    graph = coo_matrix((np.ones(len(first)), (first, second)), shape=(count, count))
    return connected_components(graph, directed=False)[1]


def nearest_values(points, queries, values):
    return values[cKDTree(points).query(queries)[1]]


def segmented_prop_mask(prop, positions, edges, work, reach, settings):
    reference = np.load(work / "reference.npz")
    distance, nearest = cKDTree(reference["part_points"]).query(positions)
    mask = np.isin(reference["part_ids"][nearest], prop["segmentedParts"]) & (distance < reach)
    count = len(positions)
    both = np.concatenate([edges, edges[:, ::-1]])
    degree = np.bincount(both[:, 0], minlength=count)
    prepare = settings.section("prepare")
    for _ in range(prepare.propSmoothIterations):
        share = np.bincount(both[:, 0], weights=mask[both[:, 1]].astype(float), minlength=count) / np.maximum(degree, 1)
        mask = share >= 0.5
    inside = mask[edges[:, 0]] & mask[edges[:, 1]]
    islands = components(edges[inside, 0], edges[inside, 1], count)
    mask &= (np.bincount(islands) >= prepare.propMinPiece)[islands]
    if not mask.any():
        raise ValueError(f"prop {prop['name']}: no sculpt vertex lies inside segmented parts {prop['segmentedParts']}")
    return mask


def body_namer(settings, taken=None):
    axis = (0.0, settings.length(settings.section("prepare").spineDepth))
    return BodyNamer(axis, settings.length(settings.section("detection").sideDeadZone), taken)


def high_pieces(work):
    high = np.load(work / "hi.npz")
    positions = high["positions"].astype(np.float64)
    edges = high["edges"]
    count = len(positions)
    return positions, components(edges[:, 0], edges[:, 1], count)


def high_prop_labels(settings, work):
    reach = settings.length(settings.section("prepare").propPartReach)
    positions, pieces = high_pieces(work)
    edges = np.load(work / "hi.npz")["edges"]
    labels = np.zeros(len(positions), np.int8)
    for index, prop in enumerate(detected_bodies(work)["props"], start=1):
        chosen = segmented_prop_mask(prop, positions, edges, work, reach, settings)
        labels[(labels == 0) & chosen] = index
        print(f"CHECK prop {prop['name']} vertices={int(chosen.sum())}")
    piece_sizes = np.bincount(pieces)
    majority = settings.section("prepare").propPieceMajority
    for index in range(1, int(labels.max()) + 1):
        share = np.bincount(pieces[labels == index], minlength=len(piece_sizes)) / piece_sizes
        completed = (labels == 0) & (share[pieces] > majority)
        labels[completed] = index
        print(f"CHECK prop {index} completed {int(completed.sum())} vertices of source pieces it mostly covers")
    for index in range(1, int(labels.max()) + 1):
        grown = grow_prop_along_axis(positions, pieces, labels, index, settings)
        print(f"CHECK prop {index} grew {grown} vertices of touching pieces inside its axis cylinder")
    return positions, pieces, labels


def axis_distance(points, centre, axis):
    offset = points - centre
    return np.linalg.norm(offset - np.outer(offset @ axis, axis), axis=1)


def grow_prop_along_axis(positions, pieces, labels, index, settings):
    prepare = settings.section("prepare")
    touch = settings.length(prepare.propTouchDistance)
    members = positions[labels == index]
    centre = members.mean(axis=0)
    axis = principal_axes(members)[0]
    along = (members - centre) @ axis
    reach = (along.max() - along.min()) * prepare.propAxisExtension
    lowest, highest = along.min(), along.max()
    start, end = lowest - reach, highest + reach
    radius = float(np.percentile(axis_distance(members, centre, axis), 95)) * prepare.propAxisMargin
    original = len(members)
    grown = 0
    while True:
        free = np.flatnonzero(labels == 0)
        touching = free[
            cKDTree(positions[labels == index]).query(positions[free], distance_upper_bound=touch)[0] <= touch
        ]
        added = 0
        for piece in np.unique(pieces[touching]):
            piece_vertices = np.flatnonzero((pieces == piece) & (labels == 0))
            points = positions[piece_vertices]
            position_along = (points - centre) @ axis
            inside = (
                (axis_distance(points, centre, axis) <= radius) & (position_along >= start) & (position_along <= end)
            )
            beyond_end = not lowest <= position_along.mean() <= highest
            if len(piece_vertices) >= original or not beyond_end or inside.mean() < prepare.propGrowShare:
                continue
            labels[piece_vertices] = index
            added += len(piece_vertices)
        grown += added
        if added == 0:
            return grown


def absorb_small_garment_islands(node_side, links, smallest):
    count = len(node_side)
    same = node_side[links[:, 0]] == node_side[links[:, 1]]
    component = components(links[same, 0], links[same, 1], count)
    sizes = np.bincount(component)
    component_side = np.zeros(len(sizes), np.int64)
    component_side[component] = node_side
    across = links[~same]
    owner = np.concatenate([component[across[:, 0]], component[across[:, 1]]])
    neighbour = np.concatenate([component[across[:, 1]], component[across[:, 0]]])
    small = sizes < smallest
    candidate = small[owner] & (component_side[owner] >= 0) & ~small[neighbour] & (component_side[neighbour] >= 0)
    order = np.argsort(sizes[neighbour[candidate]], kind="stable")
    target = np.full(len(sizes), -1)
    target[owner[candidate][order]] = neighbour[candidate][order]
    adopt = (target >= 0) & (component_side[target] != component_side)
    node_side = np.where(adopt[component], component_side[target[component]], node_side)
    touches_garment = np.zeros(len(sizes), bool)
    touches_garment[owner[component_side[neighbour] > 0]] = True
    stranded = small & ~adopt & ((component_side > 0) | ((component_side == 0) & touches_garment))
    return node_side, int(sizes[adopt].sum()), sizes[stranded]


def garment_labels(settings, work, positions, pieces, prop_labels):
    prepare = settings.section("prepare")
    garments = [body for body in detected_bodies(work)["physics"] if body.get("segmentedParts")]
    labels = np.zeros(len(positions), np.int64)
    if garments:
        reference = np.load(work / "reference.npz")
        part = nearest_values(reference["part_points"], positions, reference["part_ids"])
        piece_sizes = np.bincount(pieces)
        for index, body in enumerate(garments, start=1):
            share = (
                np.bincount(
                    pieces, weights=np.isin(part, body["segmentedParts"]).astype(float), minlength=len(piece_sizes)
                )
                / piece_sizes
            )
            labels[(labels == 0) & (prop_labels == 0) & (share[pieces] > prepare.garmentPieceMajority)] = index
        edges = np.load(work / "hi.npz")["edges"]
        welded = np.unique(np.round(positions, WELD_DECIMALS), axis=0, return_inverse=True)[1].ravel()
        links = np.unique(np.sort(welded[edges], axis=1), axis=0)
        links = links[links[:, 0] != links[:, 1]]
        node_side = np.zeros(int(welded.max()) + 1, np.int64)
        node_side[welded] = np.where(prop_labels > 0, -1, labels)
        moved = -1
        while moved:
            node_side, moved, stranded = absorb_small_garment_islands(node_side, links, prepare.garmentMinIsland)
            print(f"CHECK garment absorbed {moved} vertices of small islands")
        if len(stranded):
            raise ValueError(
                f"garment islands of {sorted(stranded.tolist())} vertices have no neighbour of at least "
                f"{prepare.garmentMinIsland} vertices to join"
            )
        labels = np.maximum(node_side[welded], 0)
        for index, body in enumerate(garments, start=1):
            print(f"CHECK garment {body['name']} vertices={int((labels == index).sum())}")
    np.savez(work / "garment.npz", labels=labels.astype(np.int8), names=np.array([body["name"] for body in garments]))
    return labels


def surface_thickness(high, positions, normals, settings):
    prepare = settings.section("prepare")
    limit = settings.length(prepare.thicknessLimit)
    ray_start = settings.length(prepare.thicknessRayStart)
    tree = BVHTree.FromObject(high, bpy.context.evaluated_depsgraph_get())
    thickness = np.full(len(positions), limit)
    for index, (position, normal) in enumerate(zip(positions, normals)):
        hit = tree.ray_cast(Vector(position - normal * ray_start), Vector(-normal), limit)
        if hit[0] is not None:
            thickness[index] = hit[3]
    return thickness


def face_neighbours(corners, vertex_count):
    edges = face_edges(corners)
    edges.sort(axis=1)
    keys = edges[:, 0].astype(np.int64) * vertex_count + edges[:, 1]
    order = np.argsort(keys, kind="stable")
    sorted_keys, sorted_faces = keys[order], np.tile(np.arange(len(corners)), 3)[order]
    shared = sorted_keys[1:] == sorted_keys[:-1]
    return sorted_faces[:-1][shared], sorted_faces[1:][shared]


def face_pieces(corners, vertex_count, allowed=None):
    face_count = len(corners)
    first, second = face_neighbours(corners, vertex_count)
    if allowed is not None:
        both = allowed[first] & allowed[second]
        first, second = first[both], second[both]
    return components(first, second, face_count)


def claimed_faces(centres, settings, work):
    positions, _, labels = high_prop_labels(settings, work)
    claimed = (labels > 0) | (np.load(work / "garment.npz")["labels"] > 0)
    return nearest_values(positions, centres, claimed)


def lo_islands(work, faces):
    low_ids = np.load(work / "atlas.npz")["vertex_map"]
    corners = low_ids[faces]
    count = int(low_ids.max()) + 1
    links = face_edges(corners)
    return components(links[:, 0], links[:, 1], count)[low_ids]


def final_joints(config, work):
    stored = json.loads((work / "joints.json").read_text())
    expected = config["joints"]["positions"] if config["joints"] else stored["measured"]
    if stored["final"] != expected:
        raise ValueError("joints.json differs from the manifest's confirmed joints: re-run from the joints stage")
    return {name: np.array(position, np.float64) for name, position in expected.items()}


def open_label_masks(work, labels):
    bpy.ops.wm.open_mainfile(filepath=str(work / "lo.blend"))
    bpy.data.objects["hi"].hide_render = True
    colours = np.tile(np.array(PLAIN_COLOUR, np.float32), (len(labels), 1))
    colours[np.load(work / "skin.npy")] = SKIN_COLOUR
    for index in range(1, int(labels.max()) + 1):
        colours[labels == index] = MASK_COLOURS[(index - 1) % len(MASK_COLOURS)]
    return bpy.data.objects["lo"], colours


def add_segment_tubes(name, segments, settings, colour):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = settings.length(settings.section("preview").boneTubeRadius)
    for start, end in segments:
        spline = curve.splines.new("POLY")
        spline.points.add(1)
        spline.points[0].co = (*start, 1.0)
        spline.points[1].co = (*end, 1.0)
    tubes = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(tubes)
    tubes.color = colour
    tubes.show_in_front = True


def shoot_tile(studio, sheet, work, name, column, row, centre, scale, view):
    path = work / "validation" / f"{name}_{column}_{row}.png"
    studio.shot(centre, scale, view, path, sheet.tile)
    sheet.place(path, column, row)
    path.unlink()


def shoot_sheet(studio, shots, columns, rows, tile, work, name):
    sheet = ContactSheet(columns, rows, tile)
    for column, row, centre, scale, view in shots:
        shoot_tile(studio, sheet, work, name, column, row, centre, scale, view)
    sheet.save(work / "validation" / f"{name}.png")


def colour_vertices(mesh, colours):
    attribute = mesh.color_attributes.new("qa_mask", "FLOAT_COLOR", "POINT")
    attribute.data.foreach_set("color", np.asarray(colours, np.float32).ravel())
    mesh.color_attributes.active_color = attribute


def workbench_studio(colour_type):
    studio = Studio(engine="BLENDER_WORKBENCH")
    shading = bpy.context.scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = colour_type
    return studio


def limb_reach(positions, segments, settings):
    return {
        limb: np.min(
            [
                segment_distance(positions, *segments[bone]) / settings.length(radius)
                for bone, radius in spec["segments"]
            ],
            axis=0,
        )
        for limb, spec in settings.descriptor.limbs.items()
    }


def overview_shots(settings, views, scale):
    centre = tuple(settings.proportions.vector([0.0, 0.0, 0.9]))
    return [(column, 0, centre, settings.length(scale), view) for column, view in enumerate(views)]


class BuildStage(ABC):
    name: str

    @abstractmethod
    def run(self, config, work): ...


class JointEstimator:
    def __init__(self, positions, body, skin, skeleton, height, settings):
        self.positions = positions
        self.body = positions[body]
        self.skin = skin
        self.descriptor = skeleton.descriptor
        self.tuning = settings.section("joints")
        self.length = settings.length
        self.torso_half_width = settings.section("prepare").torsoHalfWidth
        self.scale = height / skeleton.height
        rest_world = skeleton.rest_world()
        self.prior = {name: to_blender(rest_world[row][:3, 3]) * self.scale for row, name in enumerate(skeleton.names)}
        rest = skeleton.rest_translations
        _, lower_arm, hand = self.descriptor.arm("left")
        self.upper_arm_share = float(
            np.linalg.norm(rest[skeleton.index[lower_arm]])
            / (np.linalg.norm(rest[skeleton.index[lower_arm]]) + np.linalg.norm(rest[skeleton.index[hand]]))
        )

    def slice(self, points, height, centre, radius):
        band = points[np.abs(points[:, 2] - height) < self.length(self.tuning.sliceHalf)]
        return band[np.linalg.norm(band[:, :2] - centre[:2], axis=1) < radius]

    def track(self, points, start, top, radius):
        centre = start.copy()
        path = [centre]
        for height in np.arange(start[2] + self.length(self.tuning.sliceStep), top, self.length(self.tuning.sliceStep)):
            band = self.slice(points, height, centre, radius)
            if len(band) < self.tuning.minSlicePoints:
                break
            centre = np.array([*np.median(band[:, :2], axis=0), height])
            path.append(centre)
        return np.array(path)

    def foot(self, cluster, other, side):
        scale, tuning = self.scale, self.tuning
        centre = np.median(cluster[:, :2], axis=0)
        other_centre = np.median(other[:, :2], axis=0)
        distance = np.linalg.norm(self.body[:, :2] - centre, axis=1)
        near = self.body[
            (self.body[:, 2] < tuning.footGrowTop * scale)
            & (distance < tuning.footGrowRadius * scale)
            & (distance < np.linalg.norm(self.body[:, :2] - other_centre, axis=1))
        ]
        sole = near[near[:, 2] < tuning.heelSearchTop * scale]
        flat = sole[:, :2] - centre
        axis = principal_axes(flat)[0]
        axis = -axis if axis[1] > 0 else axis
        along = flat @ axis
        heel = along.min()
        toe = (cluster[:, :2] - centre) @ axis
        toe = toe.max()
        heel_height = sole[along < heel + self.length(tuning.heelBand), 2].min()
        ankle = np.array(
            [
                *(centre + axis * (heel + tuning.ankleAlongFoot * (toe - heel))),
                heel_height + tuning.ankleAboveHeel * scale,
            ]
        )
        band = self.slice(near, ankle[2], ankle, self.length(tuning.ankleSliceRadius))
        if len(band) >= tuning.minSlicePoints:
            ankle[:2] = np.median(band[:, :2], axis=0)
        ball = np.array(
            [*(centre + axis * (toe - tuning.toeToBall * scale)), self.prior[self.descriptor.feet(side)[1]][2]]
        )
        return ankle, ball

    def hip(self, ankle, side, torso_x):
        prior = self.prior
        thigh, _, foot = self.descriptor.leg(side)
        height = ankle[2] + prior[thigh][2] - prior[foot][2]
        return np.array([torso_x + prior[thigh][0], 0.0, height])

    def knees(self, joints):
        prior, descriptor = self.prior, self.descriptor
        reaches = {side: joints[descriptor.leg(side)[2]] - joints[descriptor.leg(side)[0]] for side in descriptor.SIDES}
        total = max(float(np.linalg.norm(reach)) for reach in reaches.values()) * (1.0 + self.tuning.legSlack)
        for side, reach in reaches.items():
            thigh_bone, calf_bone, foot_bone = descriptor.leg(side)
            thigh = float(np.linalg.norm(prior[thigh_bone] - prior[calf_bone]))
            shin = float(np.linalg.norm(prior[calf_bone] - prior[foot_bone]))
            upper = total * thigh / (thigh + shin)
            lower = total - upper
            toes = joints[descriptor.feet(side)[1]] - joints[foot_bone]
            toes[2] = 0.0
            joints[calf_bone] = self.two_bone_joint(joints[thigh_bone], joints[foot_bone], upper, lower, toes)

    def mirror_centre(self, height, centre_x, half_width):
        tuning = self.tuning
        band = self.body[np.abs(self.body[:, 2] - height) < tuning.mirrorSlice * self.scale]
        best_score, best_centre = np.inf, centre_x
        for candidate in np.arange(
            centre_x - self.length(tuning.mirrorSearch),
            centre_x + self.length(tuning.mirrorSearch),
            self.length(tuning.mirrorStep),
        ):
            inside = band[np.abs(band[:, 0] - candidate) < half_width * self.scale, :2]
            if len(inside) < tuning.minSlicePoints:
                continue
            mirrored = inside * [-1.0, 1.0] + [2.0 * candidate, 0.0]
            score = np.minimum(cKDTree(inside).query(mirrored)[0], self.length(tuning.mirrorDistanceCap)).mean()
            if score < best_score:
                best_score, best_centre = score, float(candidate)
        return best_centre

    def torso_point(self, height, centre_x, half_width):
        band = self.body[np.abs(self.body[:, 2] - height) < 2 * self.length(self.tuning.sliceHalf)]
        for _ in range(self.tuning.centringIterations):
            inside = band[np.abs(band[:, 0] - centre_x) < half_width]
            centre_x = float(np.percentile(inside[:, 0], self.tuning.widthPercentiles).mean())
        return np.array(
            [centre_x, float(np.percentile(inside[:, 1], self.tuning.bodyExtentPercentiles).mean()), height]
        )

    def arm(self, side, sign, shoulder_height, fallback, midline):
        scale, tuning = self.scale, self.tuning
        candidates = self.positions[
            self.skin
            & (self.positions[:, 2] > tuning.handBand[0] * scale)
            & (self.positions[:, 2] < tuning.handBand[1] * scale)
            & (sign * self.positions[:, 0] > tuning.handMinOffset * scale)
        ]
        if len(candidates) < tuning.minHandVertices:
            raise ValueError(
                f"{self.descriptor.arm(side)[2]}: only {len(candidates)} skin-coloured vertices in the hand band; "
                "check albedo.png, facingYawDegrees and heightMetres in the manifest"
            )
        centre = np.median(candidates, axis=0)
        for _ in range(tuning.handCentringIterations):
            nearby = candidates[np.linalg.norm(candidates - centre, axis=1) < self.length(tuning.handRadius)]
            if len(nearby) > 0:
                centre = np.median(nearby, axis=0)
        hand = candidates[np.linalg.norm(candidates - centre, axis=1) < self.length(tuning.handRadius)]
        arm_points = self.body[sign * self.body[:, 0] > tuning.armTorsoClearance * scale]
        top = hand[:, 2].max()
        path = self.track(
            arm_points,
            np.array([*np.median(hand[hand[:, 2] > top - self.length(tuning.sliceStep), :2], axis=0), top]),
            shoulder_height - self.length(tuning.shoulderTrackMargin),
            self.length(tuning.armTrackRadius),
        )
        outside = sign * (self.body[:, 0] - midline)
        under = self.body[
            (
                np.abs(self.body[:, 2] - (shoulder_height - tuning.upperArmBelowShoulder * scale))
                < 2 * self.length(tuning.sliceHalf)
            )
            & (outside > tuning.upperArmOutsideTorso[0] * scale)
            & (outside < tuning.upperArmOutsideTorso[1] * scale)
        ]
        shoulder = (
            fallback
            if len(under) < tuning.minSlicePoints
            else np.array([*np.median(under[:, :2], axis=0), shoulder_height])
        )
        axis = normalised(centre - path[min(len(path) - 1, tuning.armAxisPathIndex)])
        along = (hand - centre) @ axis
        wrist = hand[along <= np.quantile(along, tuning.wristEdgeShare)].mean(axis=0)
        far = hand[along >= np.quantile(along, 1.0 - tuning.handEndShare)].mean(axis=0)
        knuckle = wrist + tuning.knuckleAlongHand * (far - wrist)
        polyline = np.vstack([shoulder, path[::-1], wrist])
        measured = self.polyline_point(polyline, self.upper_arm_share)
        total = np.linalg.norm(measured - shoulder) + np.linalg.norm(wrist - measured)
        elbow = self.two_bone_joint(
            shoulder,
            wrist,
            total * self.upper_arm_share,
            total * (1.0 - self.upper_arm_share),
            measured - shoulder,
        )
        return shoulder, elbow, wrist, knuckle, len(hand)

    def estimate(self, given):
        torso_half_width = self.torso_half_width * self.scale
        torso_x = self.torso_centre(torso_half_width)
        joints = self.place_legs(torso_x)
        lift = self.place_trunk(joints, torso_x, torso_half_width)
        self.curve_spine(joints, torso_x)
        self.knees(joints)
        self.place_head_top(joints)
        hand_counts = self.place_arms(joints, given, lift, torso_x, torso_half_width)
        return joints, hand_counts

    def torso_centre(self, torso_half_width):
        descriptor = self.descriptor
        torso_band = self.body[
            (
                np.abs(self.body[:, 2] - self.prior[descriptor.spine[1]][2])
                < self.length(self.tuning.torsoBandHalfHeight)
            )
            & (np.abs(self.body[:, 0]) < torso_half_width)
        ]
        return float(np.median(torso_band[:, 0]))

    def place_legs(self, torso_x):
        descriptor = self.descriptor
        joints = {}
        clusters = self.foot_clusters(self.body)
        for side, cluster, other in zip(descriptor.SIDES, clusters, clusters[::-1]):
            ankle, ball = self.foot(cluster, other, side)
            thigh_bone, _, foot_bone = descriptor.leg(side)
            joints.update(
                {thigh_bone: self.hip(ankle, side, torso_x), foot_bone: ankle, descriptor.feet(side)[1]: ball}
            )
        thigh_bones = [descriptor.leg(side)[0] for side in descriptor.SIDES]
        hip_height = ((joints[thigh_bones[0]] + joints[thigh_bones[1]]) / 2)[2]
        for thigh_bone in thigh_bones:
            joints[thigh_bone][2] = hip_height
        return joints

    def place_trunk(self, joints, torso_x, torso_half_width):
        descriptor, prior = self.descriptor, self.prior
        thigh_bones = [descriptor.leg(side)[0] for side in descriptor.SIDES]
        hips = (joints[thigh_bones[0]] + joints[thigh_bones[1]]) / 2
        pelvis_height = (
            hips[2] + prior[descriptor.pelvis][2] - (prior[thigh_bones[0]][2] + prior[thigh_bones[1]][2]) / 2
        )
        pelvis = np.array([hips[0], self.torso_point(pelvis_height, torso_x, torso_half_width)[1], pelvis_height])
        joints[descriptor.pelvis] = pelvis
        lift = pelvis[2] - prior[descriptor.pelvis][2]
        for name in descriptor.spine:
            joints[name] = self.torso_point(prior[name][2] + lift, torso_x, torso_half_width)
        for name in (descriptor.neck, descriptor.head):
            joints[name] = self.torso_point(prior[name][2] + lift, torso_x, self.tuning.headHalfWidth * self.scale)
        return lift

    def curve_spine(self, joints, torso_x):
        descriptor, tuning, prior = self.descriptor, self.tuning, self.prior
        curve_bones = [bone for bone, _ in descriptor.spine_curve]
        heights = np.array([joints[name][2] for name in curve_bones])
        curve = np.polyfit(heights, [joints[name][1] for name in curve_bones], tuning.spineCurveDegree)
        for name in curve_bones:
            joints[name][1] = np.polyval(curve, joints[name][2])
        mirrored = [
            self.mirror_centre(joints[name][2], torso_x, tuning.mirrorHalfWidth[region])
            for name, region in descriptor.spine_curve
        ]
        curve = np.polyfit(heights, mirrored, tuning.spineCurveDegree)
        for name in curve_bones:
            joints[name][0] = np.polyval(curve, joints[name][2])
        pelvis_bone = descriptor.pelvis
        for side in descriptor.SIDES:
            thigh_bone = descriptor.leg(side)[0]
            joints[thigh_bone][0] = joints[pelvis_bone][0] + prior[thigh_bone][0] - prior[pelvis_bone][0]
        for side in descriptor.SIDES:
            joints[descriptor.leg(side)[0]][1] = joints[pelvis_bone][1]

    def place_head_top(self, joints):
        descriptor, tuning = self.descriptor, self.tuning
        head = joints[descriptor.head]
        crown = self.body[
            (self.body[:, 2] > head[2])
            & (np.linalg.norm(self.body[:, :2] - head[:2], axis=1) < tuning.headRadius * self.scale)
        ]
        top_height = float(np.quantile(crown[:, 2], 1.0 - tuning.headTopShare))
        joints[descriptor.head_top] = self.torso_point(
            top_height - tuning.headTopSlice * self.scale, head[0], tuning.headRadius * self.scale
        )
        joints[descriptor.head_top][2] = top_height

    def place_arms(self, joints, given, lift, torso_x, torso_half_width):
        descriptor, prior = self.descriptor, self.prior
        hand_counts = {}
        for side in descriptor.SIDES:
            upper_arm, lower_arm, hand = descriptor.arm(side)
            arm_bones = (upper_arm, lower_arm, hand, descriptor.hand_tip(side))
            if all(bone in given for bone in arm_bones):
                joints.update({bone: np.array(given[bone], np.float64) for bone in arm_bones})
                hand_counts[descriptor.suffix(side)] = "rig"
                continue
            shoulder_height = prior[upper_arm][2] + lift
            chest = self.torso_point(shoulder_height, torso_x, torso_half_width)
            midline = np.interp(
                shoulder_height,
                [joints[descriptor.chest][2], joints[descriptor.neck][2]],
                [joints[descriptor.chest][0], joints[descriptor.neck][0]],
            )
            fallback = np.array([midline + prior[upper_arm][0], chest[1], shoulder_height])
            shoulder, elbow, wrist, knuckle, hand_counts[descriptor.suffix(side)] = self.arm(
                side, descriptor.side_sign(side), shoulder_height, fallback, midline
            )
            joints.update({upper_arm: shoulder, lower_arm: elbow, hand: wrist, descriptor.hand_tip(side): knuckle})
        return hand_counts

    def foot_clusters(self, positions):
        tuning = self.tuning
        low = positions[positions[:, 2] < self.length(tuning.footBandTop)]
        flat = low[:, :2] - np.median(low[:, :2], axis=0)
        projection = flat @ np.linalg.svd(flat, full_matrices=False)[2][0]
        threshold = 0.0
        for _ in range(tuning.footSplitIterations):
            upper, lower = projection[projection >= threshold], projection[projection < threshold]
            if len(upper) == 0 or len(lower) == 0:
                break
            updated = (upper.mean() + lower.mean()) / 2
            if abs(updated - threshold) < 1e-6:
                break
            threshold = updated
        side = projection >= threshold
        clusters = sorted([low[side], low[~side]], key=lambda cluster: -cluster[:, 0].mean())
        for cluster in clusters:
            if len(cluster) < tuning.minFootVertices:
                raise ValueError(
                    f"feet: a foot cluster below {self.length(tuning.footBandTop)} m has only {len(cluster)} vertices; "
                    "check heightMetres and that the model stands on its feet"
                )
        return clusters

    @staticmethod
    def two_bone_joint(start, end, upper, lower, bend_hint):
        reach = end - start
        span = float(np.linalg.norm(reach))
        axis = reach / span
        along = (upper * upper - lower * lower + span * span) / (2.0 * span)
        bend = normalised(bend_hint - axis * (bend_hint @ axis))
        return start + axis * along + bend * math.sqrt(max(upper * upper - along * along, 0.0))

    @staticmethod
    def polyline_point(points, fraction):
        lengths = np.linalg.norm(np.diff(points, axis=0), axis=1)
        reach = fraction * lengths.sum()
        for index, length in enumerate(lengths):
            if reach <= length:
                return points[index] + (points[index + 1] - points[index]) * (reach / max(length, 1e-12))
            reach -= length
        return points[-1]


class PrepareStage(BuildStage):
    name = "prepare"
    WELD_DISTANCE = 1e-6

    def run(self, config, work):
        settings = ModelSettings.from_config(config)
        high = self.import_high(config)
        positions, shift_x, shift_y = self.normalise_high(high, config, settings)
        np.savez(
            work / "hi.npz",
            positions=positions.astype(np.float32),
            edges=read_attribute(high.data.edges, "vertices", 2, np.int32),
        )
        self.weld_high(high)
        low = high.copy()
        low.data = high.data.copy()
        low.name = "lo"
        low.data.name = "lo"
        bpy.context.collection.objects.link(low)
        low.data.materials.clear()
        self.build_references(config, work, positions)
        self.detect_props(config, work)
        detached = self.detach_prop_faces(low.data, settings, work)
        debris = self.decimate_without_debris(low, config["triangles"], settings, work)
        clothed = self.detach_cloth_bodies(low, high, config, work)

        np.savez(
            work / "lo.npz",
            positions=mesh_positions(low.data).astype(np.float32),
            normals=read_attribute(low.data.vertex_normals, "vector", 3, np.float32),
            faces=mesh_corners(low.data),
        )
        save_blend(work / "hi.blend")
        print(
            f"STAGE prepare high={len(high.data.polygons)} low={len(low.data.polygons)} "
            f"height={positions[:, 2].max():.3f} torsoShift=({shift_x:.3f},{shift_y:.3f}) "
            f"detachedPropFaces={detached} detachedClothFaces={clothed} debrisFaces={int(debris.sum())}"
        )

    def import_high(self, config):
        self.reset_scene()
        meshes = [obj for obj in self.import_gltf(Path(config["source"]).expanduser()) if obj.type == "MESH"]
        if not meshes:
            raise ValueError(f"{config['source']} contains no meshes")
        select_only(meshes[0], *meshes[1:])
        if len(meshes) > 1:
            bpy.ops.object.join()
        high = bpy.context.view_layer.objects.active
        high.name = "hi"
        high.rotation_mode = "XYZ"
        high.rotation_euler = (0.0, 0.0, math.radians(config["facingYawDegrees"]))
        select_only(high)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        return high

    @staticmethod
    def normalise_high(high, config, settings):
        prepare = settings.section("prepare")
        positions = mesh_positions(high.data)
        positions *= config["heightMetres"] / np.ptp(positions[:, 2])
        positions[:, 2] -= positions[:, 2].min()
        for axis in (0, 1):
            positions[:, axis] -= (positions[:, axis].min() + positions[:, axis].max()) / 2
        band_bottom, band_top = settings.proportions.lengths(prepare.torsoBand)
        torso = positions[
            (positions[:, 2] > band_bottom)
            & (positions[:, 2] < band_top)
            & (np.abs(positions[:, 0]) < settings.length(prepare.torsoHalfWidth))
        ]
        shift_x = -np.median(torso[:, 0])
        shift_y = settings.length(prepare.spineDepth) - np.median(torso[:, 1])
        positions[:, 0] += shift_x
        positions[:, 1] += shift_y
        write_positions(high.data, positions)
        high.data.update()
        return positions, shift_x, shift_y

    @classmethod
    def weld_high(cls, high):
        welded = bmesh.new()
        welded.from_mesh(high.data)
        bmesh.ops.remove_doubles(welded, verts=welded.verts, dist=cls.WELD_DISTANCE)
        welded.to_mesh(high.data)
        welded.free()

    def decimate_without_debris(self, low, triangles, settings, work):
        source_faces = len(low.data.polygons)
        ratio = triangles / source_faces
        pristine = low.data.copy()
        decimate(low, ratio)
        debris = self.debris_faces(low.data, settings, work)
        if debris.any():
            low.data = pristine
            decimate(low, ratio + int(debris.sum()) / source_faces)
            debris = self.debris_faces(low.data, settings, work)
            self.remove_faces(low.data, debris)
        else:
            bpy.data.meshes.remove(pristine)
        return debris

    @staticmethod
    def debris_faces(mesh, settings, work):
        prepare = settings.section("prepare")
        corners = mesh_corners(mesh)
        face_count = len(corners)
        piece = face_pieces(corners, len(mesh.vertices))
        piece_faces = np.bincount(piece)

        centres = mesh_positions(mesh)[corners].mean(axis=1)
        prop_share = (
            np.bincount(piece, weights=claimed_faces(centres, settings, work), minlength=len(piece_faces)) / piece_faces
        )

        small = piece_faces[piece] < prepare.debrisFaceFraction * face_count
        return (small & (prop_share[piece] < prepare.debrisPropShare)) | (piece_faces[piece] < prepare.debrisTinyFaces)

    @staticmethod
    def detect_props(config, work):
        settings = ModelSettings.from_config(config)
        reference = np.load(work / "reference.npz")
        props = PropDetector(settings, body_namer(settings)).detect(
            config["props"], reference["part_points"].astype(np.float64), reference["part_ids"]
        )
        dropped = []
        props, physics = apply_overrides(config["overrides"], props, [], dropped, final=False)
        write_detection(
            work,
            {"stamp": detection_stamp(config), "props": props, "physics": physics, "candidates": [], "dropped": dropped},
        )
        for prop in props:
            print(f"CHECK detected prop {prop['name']} parts={prop['segmentedParts']}")

    @staticmethod
    def detach_cloth_bodies(low, high, config, work):
        settings = ModelSettings.from_config(config)
        prepare = settings.section("prepare")
        thin_to = settings.length(prepare.thinTo)
        mesh = low.data
        corners = mesh_corners(mesh)
        positions = mesh_positions(mesh)
        normals = read_attribute(mesh.vertex_normals, "vector", 3, np.float32).astype(np.float64)
        centres = positions[corners].mean(axis=1)
        claimed = claimed_faces(centres, settings, work)
        thin_face = (surface_thickness(high, positions, normals, settings) < thin_to)[corners].all(
            axis=1
        ) & ~claimed
        piece = face_pieces(corners, len(positions), thin_face)
        detected = detected_bodies(work)
        cloth, candidates = ClothDetector(
            settings, body_namer(settings, {entry["name"] for entry in detected["props"] + detected["physics"]})
        ).detect(centres, triangle_areas(positions, corners), thin_face, piece, claimed)
        props, physics = apply_overrides(
            config["overrides"], detected["props"], detected["physics"] + cloth, detected["dropped"], final=True
        )
        write_detection(
            work,
            {
                "stamp": detected["stamp"],
                "props": props,
                "physics": physics,
                "candidates": candidates,
                "dropped": detected["dropped"],
            },
        )
        for entry in candidates:
            print(
                f"CHECK cloth candidate faces={entry['faces']} area={entry['area']} centroid={entry['centroid']} -> "
                f"{entry['decision']}"
            )
        for entry in physics:
            size = f"{entry['columns']}x{entry['rows']}" if "columns" in entry else "sized by nodeSpacing"
            print(f"CHECK body {entry['name']} kind={entry['kind']} lattice={size}")
        seeded = [body for body in physics if body.get("clothSeed")]
        if not seeded:
            return 0
        face_label = PrepareStage.label_seeded_cloth(seeded, centres, thin_face, piece, positions, corners, settings)
        return PrepareStage.split_faces_by_label(mesh, lambda _: face_label)

    @staticmethod
    def label_seeded_cloth(seeded, centres, thin_face, piece, positions, corners, settings):
        seed_reach = settings.length(settings.section("prepare").clothSeedReach)
        face_label = np.zeros(len(corners), np.int64)
        chosen = {}
        for label, config_body in enumerate(seeded, start=1):
            distance = np.linalg.norm(centres - np.array(config_body["clothSeed"]), axis=1)
            distance[~thin_face] = np.inf
            nearest = int(np.argmin(distance))
            if distance[nearest] > seed_reach:
                raise ValueError(
                    f"physics body {config_body['name']}: no unclaimed thin cloth lies within {seed_reach} m of "
                    f"clothSeed {config_body['clothSeed']}"
                )
            if piece[nearest] in chosen:
                raise ValueError(
                    f"physics bodies {chosen[piece[nearest]]} and {config_body['name']} select the same cloth piece"
                )
            chosen[piece[nearest]] = config_body["name"]
            members = np.flatnonzero(thin_face & (piece == piece[nearest]))
            face_label[members] = label
            extent = np.ptp(positions[corners[members]].reshape(-1, 3), axis=0)
            print(
                f"CHECK cloth body {config_body['name']} faces={len(members)} "
                f"extent=({extent[0]:.2f},{extent[1]:.2f},{extent[2]:.2f}) m"
            )
        absorbed = PrepareStage.absorb_enclosed_fragments(
            corners, len(positions), face_label, settings.section("detection").minClothFaces
        )
        print(f"CHECK absorbed {absorbed} faces of fragments enclosed by cloth")
        return face_label

    @staticmethod
    def split_faces_by_label(mesh, label_faces):
        body = bmesh.new()
        body.from_mesh(mesh)
        body.faces.ensure_lookup_table()
        face_labels = label_faces(body)
        group = body.faces.layers.int.new("group")
        for index in np.flatnonzero(face_labels):
            body.faces[index][group] = int(face_labels[index])
        for label in range(1, int(face_labels.max()) + 1):
            bmesh.ops.split(body, geom=[face for face in body.faces if face[group] == label])
        detached = sum(1 for face in body.faces if face[group] > 0)
        body.to_mesh(mesh)
        body.free()
        return detached

    @staticmethod
    def absorb_enclosed_fragments(corners, vertex_count, face_label, largest_fragment):
        free = face_label == 0
        fragment = face_pieces(corners, vertex_count, free)
        first, second = face_neighbours(corners, vertex_count)
        boundary = free[first] != free[second]
        inner = np.where(free[first], first, second)[boundary]
        outer = np.where(free[first], second, first)[boundary]
        sizes = np.bincount(fragment[free], minlength=fragment.max() + 1)
        absorbed = 0
        for component in np.unique(fragment[inner]):
            if sizes[component] >= largest_fragment:
                continue
            touching = face_label[outer[fragment[inner] == component]]
            face_label[free & (fragment == component)] = np.bincount(touching).argmax()
            absorbed += int(sizes[component])
        return absorbed

    @staticmethod
    def remove_faces(mesh, mask):
        if not mask.any():
            return
        body = bmesh.new()
        body.from_mesh(mesh)
        body.faces.ensure_lookup_table()
        bmesh.ops.delete(body, geom=[body.faces[index] for index in np.flatnonzero(mask)], context="FACES")
        bmesh.ops.delete(body, geom=[vertex for vertex in body.verts if not vertex.link_faces], context="VERTS")
        body.to_mesh(mesh)
        body.free()
        print(f"CHECK dropped {int(mask.sum())} faces of detached debris")

    @staticmethod
    def reset_scene():
        bpy.ops.wm.read_factory_settings(use_empty=True)

    @staticmethod
    def import_gltf(path):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(path))
        return [obj for obj in bpy.data.objects if obj not in before]

    @staticmethod
    def import_reference(path):
        objects = PrepareStage.import_gltf(path)
        clouds = []
        for obj in objects:
            if obj.type != "MESH" or obj.name.startswith("Icosphere"):
                continue
            matrix = np.array(obj.matrix_world)
            clouds.append((obj.name, mesh_positions(obj.data) @ matrix[:3, :3].T + matrix[:3, 3]))
        bones = {}
        for obj in objects:
            if obj.type == "ARMATURE":
                matrix = np.array(obj.matrix_world)
                bones = {
                    bone.name: matrix[:3, :3] @ np.array(bone.head_local) + matrix[:3, 3] for bone in obj.data.bones
                }
        for obj in objects:
            bpy.data.objects.remove(obj)
        for datablocks in (bpy.data.meshes, bpy.data.armatures, bpy.data.images, bpy.data.materials):
            for block in [block for block in datablocks if block.users == 0]:
                datablocks.remove(block)
        return clouds, bones

    @staticmethod
    def build_references(config, work, target):
        references = config["references"]
        rig_clouds, rig_bones = PrepareStage.import_reference(Path(references["riggedModel"]).expanduser())
        rig_points = np.concatenate([cloud for _, cloud in rig_clouds])
        rig_frame = ReferenceFrame(rig_points, target, config["facingYawDegrees"], config["heightMetres"])
        joints = {name: rig_frame.apply(rig_bones[name]) for name in references["jointsFromRiggedModel"]}

        part_clouds, _ = PrepareStage.import_reference(Path(references["segmentedModel"]).expanduser())
        part_points = np.concatenate([cloud for _, cloud in part_clouds])
        part_ids = np.concatenate(
            [np.full(len(cloud), int(name.rsplit("_", 1)[1].split(".")[0]), np.int16) for name, cloud in part_clouds]
        )
        part_frame = ReferenceFrame(part_points, target, config["facingYawDegrees"], config["heightMetres"])
        np.savez(
            work / "reference.npz", part_points=part_frame.apply(part_points).astype(np.float32), part_ids=part_ids
        )
        (work / "reference.json").write_text(
            json.dumps({name: rounded(position, 4) for name, position in joints.items()}, indent=2)
        )
        print(
            f"CHECK reference rig scale={rig_frame.scale:.4f} residual mean {rig_frame.residual[0] * 1000:.1f} mm p99 "
            f"{rig_frame.residual[1] * 1000:.1f} mm; "
            f"parts scale={part_frame.scale:.4f} residual mean {part_frame.residual[0] * 1000:.1f} mm p99 "
            f"{part_frame.residual[1] * 1000:.1f} mm"
        )

    @staticmethod
    def detach_prop_faces(mesh, settings, work):
        positions, pieces, labels = high_prop_labels(settings, work)
        garment_labels(settings, work, positions, pieces, labels)
        if not detected_bodies(work)["props"]:
            return 0
        return PrepareStage.split_faces_by_label(
            mesh,
            lambda body: nearest_values(positions, np.array([face.calc_center_median() for face in body.faces]), labels),
        )


class UnwrapStage(BuildStage):
    name = "unwrap"

    def run(self, config, work):
        import xatlas

        unwrap = ModelSettings.from_config(config).section("unwrap")

        low = np.load(work / "lo.npz")
        atlas = xatlas.Atlas()
        atlas.add_mesh(low["positions"], low["faces"].astype(np.uint32))
        chart_options = xatlas.ChartOptions()
        chart_options.max_iterations = unwrap.iterations
        pack_options = xatlas.PackOptions()
        pack_options.resolution = config["textureSize"]
        pack_options.padding = unwrap.padding
        pack_options.bilinear = True
        pack_options.create_image = False
        atlas.generate(chart_options, pack_options)
        vertex_map, indices, uvs = atlas[0]
        np.savez(work / "atlas.npz", vertex_map=vertex_map, indices=indices.reshape(-1, 3), uvs=uvs)
        print(f"STAGE unwrap charts={atlas.chart_count} vertices={len(vertex_map)}")


class BakeStage(BuildStage):
    name = "bake"

    def run(self, config, work):
        settings = ModelSettings.from_config(config)
        bpy.ops.wm.open_mainfile(filepath=str(work / "hi.blend"))
        high = bpy.data.objects["hi"]
        previous = bpy.data.objects["lo"]
        previous_mesh = previous.data
        bpy.data.objects.remove(previous)
        bpy.data.meshes.remove(previous_mesh)

        source = np.load(work / "lo.npz")
        atlas = np.load(work / "atlas.npz")
        vertex_map, faces, uvs = atlas["vertex_map"], atlas["indices"], atlas["uvs"]
        positions = source["positions"].astype(np.float64)[vertex_map]
        normals, repaired = self.repair_normals(
            positions, source["normals"].astype(np.float64)[vertex_map], settings.section("bake")
        )
        if repaired:
            print(f"CHECK repaired {repaired} zero-length vertex normals from their neighbours")
        low = self.build_split_mesh("lo", positions, normals, faces, uvs)
        TextureBaker(high, low, config["textureSize"], settings).bake(work)

        thickness = surface_thickness(high, positions, normals, settings)
        np.save(work / "thick.npy", thickness)
        np.savez(
            work / "lo_split.npz",
            positions=positions,
            normals=normals,
            uvs=uvs.astype(np.float64),
            faces=faces.astype(np.int64),
        )
        save_blend(work / "lo.blend")
        print(
            f"STAGE bake {config['textureSize']}px vertices={len(positions)} "
            f"thin(<2cm)={float((thickness < 0.02).mean()):.3f}"
        )

    @staticmethod
    def build_split_mesh(name, positions, normals, faces, uvs):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(positions.tolist(), [], faces.tolist())
        mesh.update()
        uv_layer = mesh.uv_layers.new(name="UVMap")
        uv_layer.data.foreach_set("uv", uvs[faces.reshape(-1)].astype(np.float32).ravel())
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        mesh.normals_split_custom_set(normals[loop_vertex_indices(mesh)].tolist())
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        return obj

    @staticmethod
    def repair_normals(positions, normals, tuning):
        broken = np.linalg.norm(normals, axis=1) < tuning.minNormalLength
        if not broken.any():
            return normals, 0
        healthy = np.nonzero(~broken)[0]
        donors = healthy[cKDTree(positions[healthy]).query(positions[broken], k=tuning.normalDonorCount)[1]]
        repaired = normals.copy()
        repaired[broken] = normals[donors].mean(axis=1)
        repaired[broken] /= np.linalg.norm(repaired[broken], axis=1, keepdims=True)
        return repaired, int(broken.sum())


class JointsStage(BuildStage):
    name = "joints"

    def run(self, config, work):
        assert_detection_current(config, work)
        settings = ModelSettings.from_config(config)
        split = np.load(work / "lo_split.npz")
        positions = split["positions"]
        skin = self.skin_mask(split["uvs"], work / "albedo.png", settings.section("joints"))
        props, pieces = self.prop_labels(settings, work, positions, split["faces"])
        body = (np.load(work / "thick.npy") >= settings.length(settings.section("joints").bodyMinThickness)) & (
            props == 0
        )
        estimator = JointEstimator(
            positions, body, skin, Skeleton.load(work, settings.descriptor), config["heightMetres"], settings
        )
        rigged = json.loads((work / "reference.json").read_text())
        measured, hand_counts = estimator.estimate(
            {name: rigged[name] for name in config["references"]["jointsFromRiggedModel"]}
        )
        for name in config["references"]["jointsFromRiggedModel"]:
            print(
                f"CHECK joint {name} from the rigged model, {np.linalg.norm(rigged[name] - measured[name]) * 100:.1f} "
                f"cm from the estimate"
            )
            measured[name] = np.array(rigged[name])
        if sorted(measured) != sorted(config["jointNames"]):
            raise ValueError(
                f"measured joints {sorted(measured)} differ from the manifest's joint list "
                f"{sorted(config['jointNames'])}"
            )
        measured = {name: rounded(measured[name], 4) for name in config["jointNames"]}
        confirmed = config["joints"] and config["joints"]["positions"]
        (work / "joints.json").write_text(
            json.dumps({"measured": measured, "confirmed": confirmed, "final": confirmed or measured}, indent=2)
        )
        np.save(work / "props.npy", props)
        np.save(work / "pieces.npy", pieces)
        np.save(work / "skin.npy", skin)
        reference = np.load(work / "reference.npz")
        resolved = resolve_anchors(
            settings.descriptor,
            {name: np.array(position) for name, position in (confirmed or measured).items()},
            detected_bodies(work),
            reference["part_points"].astype(np.float64),
            reference["part_ids"],
        )
        write_detection(work, resolved)
        for prop in resolved["props"]:
            print(f"CHECK prop {prop['name']} attaches to {prop['bone']}")
        for body in resolved["physics"]:
            print(f"CHECK body {body['name']} attaches to {body['attachBone']}")

        if confirmed:
            drift = max(
                float(np.linalg.norm(np.array(confirmed[name]) - np.array(measured[name]))) for name in measured
            )
            print(f"STAGE joints confirmed in the manifest (largest change from the measurement {drift * 100:.1f} cm)")
        else:
            print(
                f"STAGE joints measured {len(measured)} joints, hands={hand_counts}; check them against the character "
                f"and add them to tools/assets/AssetManifest.ts"
            )

    @staticmethod
    def skin_mask(uvs, albedo_path, tuning):
        image = bpy.data.images.load(str(albedo_path))
        width, height = image.size
        pixels = np.empty(width * height * 4, np.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape(height, width, 4)
        bpy.data.images.remove(image)
        rows = np.clip((uvs[:, 1] * height).astype(int), 0, height - 1)
        columns = np.clip((uvs[:, 0] * width).astype(int), 0, width - 1)
        red, green, blue = pixels[rows, columns, :3].T
        saturation = (red - blue) / np.maximum(red, 1e-3)
        return (red > green) & (green > blue) & (saturation > tuning.skinMinSaturation) & (red > tuning.skinMinRed)

    @staticmethod
    def prop_labels(settings, work, positions, faces):
        props = detected_bodies(work)["props"]
        high_positions, pieces, high_labels = high_prop_labels(settings, work)
        nearest = cKDTree(high_positions).query(positions)[1]
        nearest_labels = high_labels[nearest]
        island = lo_islands(work, faces)
        labels = np.zeros(len(positions), np.int8)
        for index in np.unique(island):
            members = island == index
            votes = np.bincount(nearest_labels[members], minlength=len(props) + 1)
            if len(votes) > 1 and votes[1:].max() * 2 >= members.sum():
                labels[members] = votes[1:].argmax() + 1
        disagreement = int((labels != nearest_labels).sum())
        for index, prop in enumerate(props, start=1):
            print(f"CHECK prop {prop['name']} vertices={int((labels == index).sum())}")
        print(f"CHECK prop islands disagree with the sculpt labels on {disagreement} of {len(labels)} vertices")
        return labels, pieces[nearest]


class CloseupsStage(BuildStage):
    name = "closeups"

    def run(self, config, work):
        bpy.ops.wm.open_mainfile(filepath=str(work / "lo.blend"))
        high, low = bpy.data.objects["hi"], bpy.data.objects["lo"]
        settings = ModelSettings.from_config(config)
        descriptor, length, vector = settings.descriptor, settings.length, settings.proportions.vector
        joints = final_joints(config, work)
        head = joints[descriptor.head] + vector([0.0, 0.0, 0.06])
        ankles = (joints[descriptor.feet("left")[0]] + joints[descriptor.feet("right")[0]]) / 2 + vector(
            [0.0, 0.0, 0.02]
        )
        left_hand, right_hand = (descriptor.arm(side)[2] for side in descriptor.SIDES)
        regions = [
            (head, length(0.36), "front"),
            (head, length(0.36), "side"),
            (joints[left_hand] - vector([0.0, 0.0, 0.06]), length(0.34), "front"),
            (joints[right_hand] - vector([0.0, 0.0, 0.06]), length(0.34), "front"),
            (vector([0.0, 0.10, 1.30]), length(0.95), "back"),
            (vector([0.0, -0.05, 1.30]), length(0.55), "front"),
            (ankles, length(0.9), "front"),
        ]
        studio = Studio()
        sheet = ContactSheet(len(regions), 2)
        for row, visible in enumerate((high, low)):
            high.hide_render = visible is not high
            low.hide_render = visible is not low
            for column, (centre, scale, view) in enumerate(regions):
                shoot_tile(studio, sheet, work, "closeup", column, row, centre, scale, view)
        sheet.save(work / "validation" / "closeups.png")
        print("STAGE closeups validation/closeups.png (top row original, bottom row low-poly)")


class MasksStage(BuildStage):
    name = "masks"

    def run(self, config, work):
        low, colours = open_label_masks(work, np.load(work / "props.npy"))
        colour_vertices(low.data, colours)
        studio = workbench_studio("VERTEX")
        views = ("front", "back", "side")
        shots = overview_shots(ModelSettings.from_config(config), views, 2.0)
        shoot_sheet(studio, shots, len(views), 1, 640, work, "masks")
        print(
            "STAGE masks validation/masks.png (orange skin, red/green/blue/yellow props in detection order (highest "
            "first))"
        )


class PhysicsStage(BuildStage):
    name = "physics"

    def run(self, config, work):
        assert_detection_current(config, work)
        settings = ModelSettings.from_config(config)
        mesh = self.load_mesh(config, work, settings)
        geometry = self.garment_geometry(work, mesh)
        count = len(mesh["positions"])
        skinning = {
            "labels": np.zeros(count, np.int8),
            "nodes": np.zeros((count, 3), np.int32),
            "weights": np.zeros((count, 3)),
            "blend": np.zeros(count),
        }
        bodies = []
        for index, body in enumerate(detected_bodies(work)["physics"], start=1):
            mask = self.body_mask(body, mesh, skinning["labels"], settings)
            skinning["labels"][mask] = index
            build = self.sheet_lattice if body.get("clothSeed") else self.garment_lattice
            record, nodes, weights, blend = build(body, mesh, geometry, mask, settings)
            skinning["nodes"][mask] = nodes + sum(len(done["nodeBones"]) for done in bodies)
            skinning["weights"][mask], skinning["blend"][mask] = weights, blend
            bodies.append(record)
            print(
                f"CHECK physics body {record['name']} kind={record['kind']} vertices={int(mask.sum())} "
                f"lattice={record['columns']}x{record['rows']} spacing={record['nodeSpacing'] * 1000:.0f}mm "
                f"uncovered={record['uncovered']} pinned={sum(record['pinned'])} "
                f"longest={max(record['geodesicDistance']):.3f}m"
            )
        colliders = self.measure_colliders(mesh, skinning["labels"], settings)
        self.clear_lattices(bodies, colliders, settings.length(settings.section("physics").colliderClearance))
        PhysicsWork.save(work, bodies, colliders, skinning, geometry)
        self.render_physics_masks(settings, work, skinning["labels"], bodies, geometry["mantle"])
        radii = [collider["radius"] for collider in colliders]
        lattice_count = sum(len(body["nodeBones"]) for body in bodies)
        print(
            f"STAGE physics bodies={len(bodies)} latticeBones={lattice_count} colliders={len(colliders)} "
            f"radius={min(radii):.3f}-{max(radii):.3f}m validation/physics_masks.png"
        )

    @staticmethod
    def load_mesh(config, work, settings):
        descriptor, physics = settings.descriptor, settings.section("physics")
        split = np.load(work / "lo_split.npz")
        positions = split["positions"]
        joints = final_joints(config, work)
        garment = np.load(work / "garment.npz")
        garment_low = nearest_values(high_pieces(work)[0], positions, garment["labels"])
        props = np.load(work / "props.npy")
        chest, neck = joints[descriptor.chest], joints[descriptor.neck]
        return {
            "positions": positions,
            "normals": split["normals"],
            "faces": split["faces"],
            "props": props,
            "thickness": np.load(work / "thick.npy"),
            "joints": joints,
            "island": lo_islands(work, split["faces"]),
            "garment_low": garment_low,
            "garment_names": [str(name) for name in garment["names"]],
            "garment": (garment_low > 0) & (props == 0),
            "top": chest[2] + physics.latticeTop * (neck[2] - chest[2]),
            "centre": (np.asarray(joints[descriptor.pelvis][:2]) + np.asarray(chest[:2])) / 2,
        }

    @staticmethod
    def body_mask(body, mesh, labels, settings):
        prepare, physics = settings.section("prepare"), settings.section("physics")
        claimed = (mesh["props"] > 0) | (labels > 0)
        if body.get("clothSeed"):
            seed_reach = settings.length(prepare.clothSeedReach)
            distance = np.linalg.norm(mesh["positions"] - np.array(body["clothSeed"]), axis=1)
            distance[(mesh["thickness"] >= settings.length(prepare.thinTo)) | claimed] = np.inf
            seeded = int(np.argmin(distance))
            if distance[seeded] > seed_reach:
                raise ValueError(
                    f"physics body {body['name']}: no thin cloth lies within {seed_reach} m of clothSeed "
                    f"{body['clothSeed']}"
                )
            mask = (mesh["island"] == mesh["island"][seeded]) & ~claimed
        else:
            mask = (mesh["garment_low"] == mesh["garment_names"].index(body["name"]) + 1) & ~claimed
        if mask.sum() < physics.minBodyVertices:
            raise ValueError(f"physics body {body['name']}: only {int(mask.sum())} vertices were selected")
        return mask

    @classmethod
    def sheet_lattice(cls, body, mesh, geometry, mask, settings):
        columns, rows = body["columns"], body["rows"]
        points = mesh["positions"][mask]
        grid = lattice.build_sheet(points, mesh["normals"][mask], columns, rows, mesh["centre"], settings)
        nodes, weights, blend = lattice.sheet_weights(grid, columns, rows, settings)
        return cls.lattice_record(body, columns, rows, grid, 0, False), nodes, weights, blend

    @classmethod
    def garment_lattice(cls, body, mesh, geometry, mask, settings):
        physics = settings.section("physics")
        positions = mesh["positions"]
        fade = settings.length(physics.garmentFadeDistance)
        along = np.clip(geometry["sheet_distance"][mask] / fade, 0.0, 1.0)
        drop = np.clip((mesh["top"] - positions[mask, 2]) / fade, 0.0, 1.0)
        blend = along * along * (3.0 - 2.0 * along) * drop * drop * (3.0 - 2.0 * drop)
        driven = np.zeros(len(positions), bool)
        driven[mask] = smooth_unit(along) >= physics.latticeMinBlend
        below = driven & (positions[:, 2] < mesh["top"])
        if below.sum() < physics.minBodyVertices:
            raise ValueError(
                f"physics body {body['name']}: only {int(below.sum())} garment vertices lie below the lattice top "
                f"{mesh['top']:.3f} m"
            )
        grid = lattice.build_wrapped_sheet(
            positions[below], mesh["normals"][below], mesh["centre"], mesh["top"], settings
        )
        nodes, weights, column_position = lattice.wrapped_sheet_weights(grid, positions[mask])
        outside = (column_position < -0.5) | (column_position > grid["columns"] - 0.5)
        uncovered = int((outside & (blend >= physics.uncoveredBlend)).sum())
        record = cls.lattice_record(body, grid["columns"], grid["rows"], grid, uncovered, True)
        return record, nodes, weights, blend

    @classmethod
    def lattice_record(cls, body, columns, rows, grid, uncovered, wrapped):
        record = {
            "name": body["name"],
            "kind": "sheet",
            "wrapped": wrapped,
            "attachBone": body["attachBone"],
            "columns": columns,
            "rows": rows,
            "nodeBones": [
                lattice.lattice_bone_name(body["name"], column, row) for row in range(rows) for column in range(columns)
            ],
            "nodeNormals": [rounded(row, lattice.NODE_DECIMALS) for row in grid["normals"]],
            "uncovered": uncovered,
            "feel": body.get("feel") or {},
        }
        record.update(cls.node_values(body["name"], grid["nodes"], columns, rows))
        return record

    @staticmethod
    def node_values(name, nodes, columns, rows):
        try:
            derived = lattice.derived_node_values(nodes, columns, rows)
        except ValueError as error:
            raise ValueError(f"physics body {name}: {error}") from error
        return {"nodePositions": [rounded(row, lattice.NODE_DECIMALS) for row in nodes], **derived}

    @classmethod
    def clear_lattices(cls, bodies, colliders, clearance):
        shells = [
            {"start": np.asarray(c["start"]), "end": np.asarray(c["end"]), "radius": c["radius"]} for c in colliders
        ]
        for record in bodies:
            nodes = np.asarray(record["nodePositions"])
            moved, count, largest = lattice.clear_of_colliders(
                nodes, np.asarray(record["nodeNormals"]), np.asarray(record["pinned"]), shells, clearance
            )
            record.update(cls.node_values(record["name"], moved, record["columns"], record["rows"]))
            lattice.assert_clear_of_colliders(
                record["name"], np.asarray(record["nodePositions"]), np.asarray(record["pinned"]), shells, clearance
            )
            print(
                f"CHECK physics body {record['name']} cleared of colliders moved={count} "
                f"largest={largest * 1000:.1f}mm clearance={clearance * 1000:.1f}mm "
                f"spacing={record['nodeSpacing'] * 1000:.0f}mm longest={max(record['geodesicDistance']):.3f}m"
            )

    @staticmethod
    def measure_colliders(mesh, labels, settings):
        descriptor, physics = settings.descriptor, settings.section("physics")
        joints = mesh["joints"]
        body_points = mesh["positions"][(mesh["props"] == 0) & (labels == 0)]
        colliders = []
        for bone, start, end, group in descriptor.collider_segments:
            reach = settings.length(physics.colliderMaxRadius[group])
            percentile = physics.colliderSectorPercentile[group]
            radius = lattice.measure_capsule_radius(
                body_points, joints[start], joints[end], reach, percentile, settings
            )
            colliders.append(
                {
                    "bone": bone,
                    "start": [float(v) for v in joints[start]],
                    "end": [float(v) for v in joints[end]],
                    "radius": round(radius, 4),
                }
            )
        return colliders

    @classmethod
    def garment_geometry(cls, work, mesh):
        topology = cls.garment_topology(work, mesh)
        node_garment, node_positions = topology["node_garment"], topology["node_positions"]
        keys, rim, touching = cls.rim_nodes(topology)
        body_nodes = np.unique(topology["corners"][topology["body_face"]].ravel())
        body_nodes = body_nodes[~node_garment[body_nodes]]
        nearest = nearest_values(node_positions[body_nodes], node_positions, body_nodes)
        mantle = node_garment & rim[nearest]
        distance = cls.sheet_distance(topology, keys, mantle | (node_garment & touching))
        detached = cls.detached_nodes(topology)
        print(
            f"CHECK garment rim nodes={int(rim.sum())} mantle nodes={int(mantle.sum())} drape "
            f"nodes={int((node_garment & ~mantle).sum())} detached nodes={detached}"
        )
        low_ids = topology["low_ids"]
        return {
            "garment": mesh["garment"],
            "mantle": mantle[low_ids],
            "rim": rim[low_ids],
            "sheet_distance": distance[low_ids],
            "detached": detached,
        }

    @staticmethod
    def garment_topology(work, mesh):
        low_ids = np.load(work / "atlas.npz")["vertex_map"]
        count = int(low_ids.max()) + 1
        corners = low_ids[mesh["faces"]]
        node_positions = np.zeros((count, 3))
        node_positions[low_ids] = mesh["positions"]
        node_garment = np.zeros(count, bool)
        node_garment[low_ids[mesh["garment"]]] = True
        node_prop = np.zeros(count, bool)
        node_prop[low_ids[mesh["props"] > 0]] = True
        garment_face = node_garment[corners].sum(1) >= 2
        return {
            "low_ids": low_ids,
            "count": count,
            "corners": corners,
            "node_positions": node_positions,
            "node_garment": node_garment,
            "garment_face": garment_face,
            "body_face": ~garment_face & (node_prop[corners].sum(1) < 2),
        }

    @staticmethod
    def rim_nodes(topology):
        corners, count = topology["corners"], topology["count"]
        edges = np.sort(face_edges(corners), axis=1)
        face_of = np.tile(np.arange(len(corners)), 3)
        keys, inverse = np.unique(edges, axis=0, return_inverse=True)
        inverse = inverse.ravel()
        body_count = np.bincount(inverse, weights=topology["body_face"][face_of].astype(float), minlength=len(keys))
        garment_count = np.bincount(
            inverse, weights=topology["garment_face"][face_of].astype(float), minlength=len(keys)
        )
        rim = np.zeros(count, bool)
        rim[keys[(body_count == 1) & (garment_count >= 1)].ravel()] = True
        touching = np.zeros(count, bool)
        touching[keys[(body_count >= 1) & (garment_count >= 1)].ravel()] = True
        return keys, rim, touching

    @staticmethod
    def sheet_distance(topology, keys, source_mask):
        count, node_garment = topology["count"], topology["node_garment"]
        inside = node_garment[keys[:, 0]] & node_garment[keys[:, 1]]
        lengths = np.linalg.norm(
            topology["node_positions"][keys[inside, 0]] - topology["node_positions"][keys[inside, 1]], axis=1
        )
        distance = multi_source_distance(keys[inside], lengths, count, np.flatnonzero(source_mask))[0]
        distance[~node_garment] = 0.0
        return distance

    @staticmethod
    def detached_nodes(topology):
        corners = topology["corners"]
        garment_nodes = np.unique(corners[topology["garment_face"]].ravel())
        body_nodes = np.unique(corners[topology["body_face"]].ravel())
        garment_only = np.setdiff1d(garment_nodes, body_nodes)
        body_only = np.setdiff1d(body_nodes, garment_nodes)
        body_keys = {tuple(key) for key in np.round(topology["node_positions"][body_only], WELD_DECIMALS)}
        return sum(tuple(key) in body_keys for key in np.round(topology["node_positions"][garment_only], WELD_DECIMALS))

    @staticmethod
    def render_physics_masks(settings, work, labels, bodies, mantle):
        low, colours = open_label_masks(work, labels)
        colours[mantle] = MANTLE_COLOUR
        colour_vertices(low.data, colours)
        segments = []
        for body in bodies:
            edges = lattice.lattice_edges(body["columns"], body["rows"], diagonals=False)
            nodes = body["nodePositions"]
            segments += [(nodes[start], nodes[end]) for start, end in edges[np.argsort(edges[:, 0], kind="stable")]]
        add_segment_tubes("qa_lattice", segments, settings, (0.0, 0.0, 0.0, 1.0))
        studio = workbench_studio("VERTEX")
        shots = overview_shots(settings, ("front", "back", "side"), 2.0)
        shoot_sheet(studio, shots, 3, 1, 640, work, "physics_masks")


class RigStage(BuildStage):
    name = "rig"

    def run(self, config, work):
        assert_detection_current(config, work)
        settings = ModelSettings.from_config(config)
        descriptor = settings.descriptor
        skeleton = Skeleton.load(work, descriptor)
        joints = final_joints(config, work)
        targets = {name: to_gltf(position) for name, position in joints.items()}
        lattice_targets = self.lattice_node_targets(work)
        fit = SkeletonFit(skeleton, {**targets, **lattice_targets}, placed=tuple(lattice_targets))
        heads, tails = fit.segments()
        bones = skeleton.names
        owners = [name for name in bones if skeleton.final_bone(name) == name and name in tails]
        segments = {name: (heads[name], tails[name]) for name in owners}

        bpy.ops.wm.open_mainfile(filepath=str(work / "lo.blend"))
        bpy.data.objects.remove(bpy.data.objects["hi"])
        low = bpy.data.objects["lo"]
        armature = self.heat_armature(
            heads,
            tails,
            [
                name
                for name in bones
                if name in tails and descriptor.leaf_marker not in name and name != descriptor.root
            ],
        )
        positions = mesh_positions(low.data)
        weights = self.heat_weights(low, armature, bones, positions, settings)
        weights = self.merge_helper_bones(weights, skeleton, bones)
        weights = self.assign_unweighted(weights, positions, segments, bones, owners)
        props = np.load(work / "props.npy")
        thickness = np.load(work / "thick.npy")
        weights, protect, zones, limb_of = self.blend_cloth_and_zones(
            weights,
            positions,
            thickness,
            heads,
            segments,
            bones,
            props,
            np.load(work / "pieces.npy"),
            detected_bodies(work)["props"],
            settings,
        )
        weights /= np.maximum(weights.sum(1, keepdims=True), 1e-9)
        drape = np.zeros(len(positions))
        physics = PhysicsWork.optional(work)
        if physics:
            garment = physics.weights
            drape = np.where(
                garment["mantle"] | ~garment["garment"],
                0.0,
                smoothstep(
                    0.0, settings.length(settings.section("rig").drapeBlendDistance), garment["sheet_distance"]
                ),
            )
            weights = self.drape_garment(weights, drape, bones, settings)
        np.savez(
            work / "rig.npz",
            bind_world=fit.bind_world,
            rest_translations=fit.rest_translations,
            miss=np.array(list(fit.miss.values())),
            leg_ratio=fit.leg_ratio,
        )
        np.savez(
            work / "raw.npz",
            weights=weights,
            protect=protect,
            **{f"{name}_zone": zone for name, zone in zones.items()},
            props=props,
            limb_of=limb_of,
            drape=drape,
            bones=np.array(bones),
        )
        print(
            f"STAGE rig bones={len(bones)} vertices={len(positions)} legRatio={fit.leg_ratio:.3f} "
            f"jointMiss={max(fit.miss.values()) * 1000:.3f}mm"
        )

    @staticmethod
    def heat_armature(heads, tails, names):
        data = bpy.data.armatures.new("fit")
        armature = bpy.data.objects.new("fit", data)
        bpy.context.collection.objects.link(armature)
        select_only(armature)
        bpy.ops.object.mode_set(mode="EDIT")
        for name in names:
            bone = data.edit_bones.new(name)
            bone.head = Vector(heads[name])
            bone.tail = Vector(tails[name])
        bpy.ops.object.mode_set(mode="OBJECT")
        return armature

    @staticmethod
    def read_group_weights(obj, bones):
        column_of = {name: column for column, name in enumerate(bones)}
        group_names = {group.index: group.name for group in obj.vertex_groups}
        weights = np.zeros((len(obj.data.vertices), len(bones)))
        for vertex in obj.data.vertices:
            for element in vertex.groups:
                column = column_of.get(group_names[element.group])
                if column is not None:
                    weights[vertex.index, column] = element.weight
        return weights

    @staticmethod
    def keep_largest_piece(obj):
        mesh = obj.data
        edges = read_attribute(mesh.edges, "vertices", 2, np.int32)
        count = len(mesh.vertices)
        pieces = components(edges[:, 0], edges[:, 1], count)
        largest = np.argmax(np.bincount(pieces))
        detached = set(np.nonzero(pieces != largest)[0].tolist())
        if not detached:
            return
        body = bmesh.new()
        body.from_mesh(mesh)
        body.verts.ensure_lookup_table()
        bmesh.ops.delete(body, geom=[body.verts[index] for index in detached], context="VERTS")
        body.to_mesh(mesh)
        body.free()
        print(f"CHECK heat proxy kept its main piece, dropped {len(detached)} vertices in detached pieces")

    @staticmethod
    def heat_weights(low, armature, bones, positions, settings):
        rig = settings.section("rig")
        proxy = low.copy()
        proxy.data = low.data.copy()
        proxy.name = "heat_proxy"
        bpy.context.collection.objects.link(proxy)
        proxy.vertex_groups.clear()
        remesh = proxy.modifiers.new("remesh", "REMESH")
        remesh.mode = "VOXEL"
        remesh.voxel_size = settings.length(rig.heatProxyVoxel)
        remesh.adaptivity = 0.0
        select_only(proxy)
        bpy.ops.object.modifier_apply(modifier="remesh")
        RigStage.keep_largest_piece(proxy)
        select_only(armature, proxy)
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        proxy_weights = RigStage.read_group_weights(proxy, bones)
        print(f"CHECK heat proxy vertices={len(proxy_weights)} unweighted={int((proxy_weights.sum(1) < 1e-6).sum())}")
        proxy_positions = mesh_positions(proxy.data)
        tree = kdtree.KDTree(len(proxy_positions))
        for index, position in enumerate(proxy_positions):
            tree.insert(Vector(position), index)
        tree.balance()
        weights = np.zeros((len(positions), len(bones)))
        for row, position in enumerate(positions):
            found = tree.find_n(Vector(position), rig.heatTransferNeighbours)
            shares = np.array([1.0 / (distance + 1e-4) for _, _, distance in found])
            shares /= shares.sum()
            for (_, column, _), share in zip(found, shares):
                weights[row] += proxy_weights[column] * share
        proxy_mesh = proxy.data
        bpy.data.objects.remove(proxy)
        bpy.data.meshes.remove(proxy_mesh)
        return weights

    @staticmethod
    def merge_helper_bones(weights, skeleton, bones):
        merged = weights.copy()
        for column, name in enumerate(bones):
            target = skeleton.final_bone(name)
            if target != name:
                merged[:, bones.index(target)] += merged[:, column]
                merged[:, column] = 0.0
        return merged

    @staticmethod
    def assign_unweighted(weights, positions, segments, bones, owners):
        missing = np.nonzero(weights.sum(1) < 1e-6)[0]
        if len(missing) == 0:
            return weights
        distances = np.array([segment_distance(positions[missing], *segments[name]) for name in owners])
        for row, nearest in zip(missing, np.argmin(distances, axis=0)):
            weights[row, bones.index(owners[nearest])] = 1.0
        print(f"CHECK unweighted vertices bound to their nearest bone: {len(missing)}")
        return weights

    @staticmethod
    def torso_hang_weights(positions, bones, heads, settings):
        descriptor, rig = settings.descriptor, settings.section("rig")
        anchors = [(name, heads[name][2]) for name in descriptor.torso_anchors]
        heights = positions[:, 2]
        target = np.zeros((len(positions), len(bones)))
        target[heights >= anchors[0][1], bones.index(anchors[0][0])] = 1.0
        for (upper, upper_z), (lower, lower_z) in zip(anchors, anchors[1:]):
            inside = (heights < upper_z) & (heights >= lower_z)
            blend = (heights[inside] - lower_z) / (upper_z - lower_z)
            target[inside, bones.index(upper)] += blend
            target[inside, bones.index(lower)] += 1.0 - blend
        pelvis_z = anchors[-1][1]
        below = heights < pelvis_z
        thigh = np.clip((pelvis_z - heights[below]) / settings.length(rig.thighRamp), 0.0, 1.0) * rig.thighShare
        side_blend = settings.length(rig.thighSideBlend)
        left = smoothstep(-side_blend, side_blend, positions[below, 0])
        target[below, bones.index(descriptor.pelvis)] = 1.0 - thigh
        target[below, bones.index(descriptor.leg("left")[0])] = thigh * left
        target[below, bones.index(descriptor.leg("right")[0])] = thigh * (1.0 - left)
        return target

    @staticmethod
    def head_zone(positions, heads, settings):
        rig = settings.section("rig")
        head = heads[settings.descriptor.head]
        below = settings.proportions.lengths(rig.headZoneBelow)
        radius = settings.proportions.lengths(rig.headZoneRadius)
        radial = np.linalg.norm(positions[:, :2] - head[:2], axis=1)
        rising = smoothstep(head[2] - below[0], head[2] - below[1], positions[:, 2])
        return rising * (1.0 - smoothstep(radius[0], radius[1], radial))

    @staticmethod
    def hand_zone(positions, heads, side, settings):
        descriptor, rig = settings.descriptor, settings.section("rig")
        _, elbow_bone, wrist_bone = descriptor.arm(side)
        wrist = heads[wrist_bone]
        elbow = heads[elbow_bone]
        axis = normalised(wrist - elbow)
        along = (positions - wrist) @ axis
        radial = np.linalg.norm(positions - wrist - np.outer(along, axis), axis=1)
        finger_length = float((heads[descriptor.hand_tip(side)] - wrist) @ axis) + settings.length(
            rig.fingersPastKnuckles
        )
        return (
            smoothstep(*settings.proportions.lengths(rig.handZoneAlong), along)
            * (1.0 - smoothstep(*settings.proportions.lengths(rig.handZoneRadius), radial))
            * (along < finger_length)
        )

    @staticmethod
    def drape_garment(weights, drape, bones, settings):
        descriptor, cap = settings.descriptor, settings.section("rig").garmentArmShare
        capped = weights.copy()
        for side in descriptor.SIDES:
            arm = [bones.index(name) for name in descriptor.arm(side) if name in bones]
            share = capped[:, arm].sum(1)
            scale = np.where(share > cap, cap / np.maximum(share, 1e-9), 1.0)
            capped[:, bones.index(descriptor.clavicle(side))] += share * (1.0 - scale)
            capped[:, arm] *= scale[:, None]
        return weights * (1.0 - drape[:, None]) + capped * drape[:, None]

    @staticmethod
    def force(weights, mask, bones, bone):
        target = np.zeros(len(bones))
        target[bones.index(bone)] = 1.0
        return weights * (1.0 - mask[:, None]) + target * mask[:, None]

    @staticmethod
    def limb_membership(weights, positions, thickness, segments, bones, settings):
        rig = settings.section("rig")
        thin_to = settings.length(settings.section("prepare").thinTo)
        reach = limb_reach(positions, segments, settings)
        limb_of = np.zeros(len(positions), np.int8)
        for number, (limb, spec) in enumerate(settings.descriptor.limbs.items(), start=1):
            share = weights[:, [bones.index(bone) for bone in spec["bones"]]].sum(1)
            inside = (
                (reach[limb] < 1.0)
                & (share > rig.limbHeatDominance)
                & ((thickness >= thin_to) | (reach[limb] < rig.limbCoreShare))
            )
            limb_of[inside & (limb_of == 0)] = number
        return limb_of

    @staticmethod
    def keep_limb_bones(weights, limb_of, positions, segments, bones, settings):
        kept = weights.copy()
        for number, spec in enumerate(settings.descriptor.limbs.values(), start=1):
            rows = limb_of == number
            allowed = np.zeros(len(bones), bool)
            allowed[[bones.index(bone) for bone in spec["bones"]]] = True
            kept[np.ix_(rows, ~allowed)] = 0.0
            empty = rows & (kept.sum(1) < 1e-6)
            if empty.any():
                owners = [bone for bone, _ in spec["segments"]]
                nearest = np.argmin([segment_distance(positions[empty], *segments[bone]) for bone in owners], axis=0)
                kept[np.nonzero(empty)[0], [bones.index(owners[choice]) for choice in nearest]] = 1.0
        return kept

    @staticmethod
    def blend_cloth_and_zones(
        weights, positions, thickness, heads, segments, bones, props, pieces, prop_configs, settings
    ):
        descriptor, rig = settings.descriptor, settings.section("rig")
        thin_to = settings.length(settings.section("prepare").thinTo)
        limbs = descriptor.limbs
        hand_bones = [descriptor.arm(side)[2] for side in descriptor.SIDES]
        sheet = thickness < settings.length(rig.clothSheetThickness)
        zones = {"head": RigStage.head_zone(positions, heads, settings)}
        for side, hand in zip(descriptor.SIDES, hand_bones):
            zones[hand] = RigStage.hand_zone(positions, heads, side, settings) * ~sheet
        zones = {name: np.where(zone > rig.rigidZoneSnap, 1.0, zone) for name, zone in zones.items()}
        protect = np.maximum.reduce([zones["head"], *[zones[hand] for hand in hand_bones], (props > 0).astype(float)])
        limb_of = RigStage.limb_membership(weights, positions, thickness, segments, bones, settings)
        weights = RigStage.keep_limb_bones(weights, limb_of, positions, segments, bones, settings)
        loose = limb_of == 0
        for number, spec in enumerate(limbs.values(), start=1):
            owned = limb_of == number
            if "zone" in spec:
                owned |= zones[spec["zone"]] > 0.0
            detached = loose & ~np.isin(pieces, np.unique(pieces[owned]))
            weights[np.ix_(detached, [bones.index(name) for name in spec["distal"]])] = 0.0
        orphaned = loose & (weights.sum(1) < 1e-6)
        weights[orphaned] = RigStage.torso_hang_weights(positions[orphaned], bones, heads, settings)
        core = np.min([segment_distance(positions, *segments[name]) for name in descriptor.core_bones], axis=0)
        cloth_core_from, cloth_core_to = settings.proportions.lengths(rig.clothCore)
        cloth = (
            (1.0 - smoothstep(settings.length(rig.thinFrom), thin_to, thickness))
            * smoothstep(cloth_core_from, cloth_core_to, core)
            * (1.0 - protect)
            * (limb_of == 0)
        )
        damped = weights.copy()
        for name in descriptor.damped_bones:
            damped[:, bones.index(name)] *= rig.dampedLimbFactor
        damped /= np.maximum(damped.sum(1, keepdims=True), 1e-9)
        cloth_target = rig.clothBodyShare * damped + (1.0 - rig.clothBodyShare) * RigStage.torso_hang_weights(
            positions, bones, heads, settings
        )
        weights = weights * (1.0 - cloth[:, None]) + cloth_target * cloth[:, None]
        weights = RigStage.force(weights, zones["head"], bones, descriptor.head)
        for hand in hand_bones:
            weights = RigStage.force(weights, zones[hand], bones, hand)
        for index, prop in enumerate(prop_configs, start=1):
            weights = RigStage.force(weights, (props == index).astype(float), bones, prop["bone"])
        print(
            f"CHECK limb vertices={[int((limb_of == number).sum()) for number in range(1, len(limbs) + 1)]} "
            f"cloth={int((cloth > 0.5).sum())} head={int((zones['head'] > 0.99).sum())} "
            f"hands={'/'.join(str(int((zones[hand] > 0.99).sum())) for hand in hand_bones)} "
            f"props={[int((props == index).sum()) for index in range(1, len(prop_configs) + 1)]}"
        )
        return weights, protect, zones, limb_of

    @staticmethod
    def lattice_node_targets(work):
        physics = PhysicsWork.optional(work)
        if not physics:
            return {}
        return {
            name: to_gltf(np.array(position))
            for body in physics.definition["bodies"]
            for name, position in zip(body["nodeBones"], body["nodePositions"])
        }


class BonesStage(BuildStage):
    name = "bones"

    def run(self, config, work):
        settings = ModelSettings.from_config(config)
        descriptor = settings.descriptor
        skeleton = Skeleton.load(work, descriptor)
        rig = np.load(work / "rig.npz")
        heads = {name: to_blender(rig["bind_world"][row][:3, 3]) for row, name in enumerate(skeleton.names)}
        joints = final_joints(config, work)
        bpy.ops.wm.open_mainfile(filepath=str(work / "lo.blend"))
        bpy.data.objects["hi"].hide_render = True
        low = bpy.data.objects["lo"]
        pairs = [
            (heads[skeleton.names[parent]], heads[name])
            for name, parent in zip(skeleton.names, skeleton.parents)
            if parent >= 0
            and skeleton.names[parent] != descriptor.root
            and not any(part in name for part in descriptor.hidden_bone_parts)
        ]
        pairs.append((heads[descriptor.head], joints[descriptor.head_top]))
        add_segment_tubes("qa_bones", pairs, settings, (1.0, 0.1, 0.1, 1.0))
        low.color = PLAIN_COLOUR
        studio = workbench_studio("OBJECT")
        bpy.context.scene.display.shading.show_xray = True
        bpy.context.scene.display.shading.xray_alpha = 0.6
        shots = overview_shots(settings, ("front", "side"), 2.1)
        shoot_sheet(studio, shots, 2, 1, 700, work, "bones")
        print("STAGE bones validation/bones.png (fitted skeleton in red)")


class PoseAccumulator:
    def __init__(self, inputs, settings, regions, groups, garment, pose_count):
        tuning = settings.section("weights")
        positions, rest_edges = inputs["node_positions"], inputs["edges"]
        lengths = np.linalg.norm(positions[rest_edges[:, 0]] - positions[rest_edges[:, 1]], axis=1)
        self.boundary = int((inputs["node_props"][rest_edges[:, 0]] != inputs["node_props"][rest_edges[:, 1]]).sum())
        measured = lengths > settings.length(tuning.minEdgeLength)
        self.edges, self.rest_lengths = rest_edges[measured], lengths[measured]
        self.node_positions, self.node_count = positions, inputs["count"]
        self.percentile = tuning.stretchPercentile
        self.regions, self.groups, self.garment = regions, groups, garment
        self.poses = pose_count
        self.worst_edge = np.ones(len(self.edges))
        self.region_worst = {name: [] for name in regions}
        self.group_worst = {name: (0.0, 0.0) for name in groups}
        self.lift, self.band_lattice, self.band_rigid = [], [], []
        self.lift_limit = settings.length(tuning.garmentLiftLimit)
        self.node_lift = np.full(len(garment["resting"]), -np.inf) if garment else None

    def add_garment(self, moved, rigid_moved):
        transition = self.garment["transition"]
        band = transition[self.edges[:, 0]] | transition[self.edges[:, 1]]
        for series, positions in ((self.band_lattice, moved), (self.band_rigid, rigid_moved)):
            band_stretch = np.linalg.norm(positions[self.edges[band, 0]] - positions[self.edges[band, 1]], axis=1)
            series.append(float(np.percentile(band_stretch / self.rest_lengths[band], BAND_STRETCH_PERCENTILE)))
        self.lift.append(self.garment_lift(moved))

    def add_stretch(self, moved):
        edges = self.edges
        stretch = np.linalg.norm(moved[edges[:, 0]] - moved[edges[:, 1]], axis=1) / self.rest_lengths
        np.maximum(self.worst_edge, stretch, out=self.worst_edge)
        per_node = np.ones(self.node_count)
        np.maximum.at(per_node, edges[:, 0], stretch)
        np.maximum.at(per_node, edges[:, 1], stretch)
        for name, mask in self.regions.items():
            if mask.any():
                self.region_worst[name].append(float(np.percentile(per_node[mask], self.percentile)))
        for name, mask in self.groups.items():
            maximum, rms = self.rigid_residual(self.node_positions[mask], moved[mask])
            worst = self.group_worst[name]
            self.group_worst[name] = (max(worst[0], maximum), max(worst[1], rms))

    def garment_lift(self, moved):
        garment = self.garment
        if not len(garment["resting"]):
            return 0.0
        distance = cKDTree(moved[garment["body"]]).query(moved[garment["resting"]])[0]
        lift = distance - garment["rest"]
        self.node_lift = np.maximum(self.node_lift, lift)
        return float(np.percentile(lift, 95))

    @staticmethod
    def rigid_residual(rest_points, moved_points):
        rest_centre, moved_centre = rest_points.mean(0), moved_points.mean(0)
        u, _, vt = np.linalg.svd((rest_points - rest_centre).T @ (moved_points - moved_centre))
        rotation = vt.T @ u.T
        if np.linalg.det(rotation) < 0:
            vt[-1] *= -1
            rotation = vt.T @ u.T
        errors = np.linalg.norm((rest_points - rest_centre) @ rotation.T - (moved_points - moved_centre), axis=1)
        return float(errors.max()), float(np.sqrt((errors**2).mean()))


class WeightsStage(BuildStage):
    name = "weights"

    def run(self, config, work):
        assert_detection_current(config, work)
        settings = ModelSettings.from_config(config)
        inputs = self.load_inputs(work, settings)
        physics = PhysicsWork(work) if detected_bodies(work)["physics"] else None
        garment = self.garment_nodes(physics, inputs, settings) if physics else None
        rigid = self.rigid_weights(work, inputs, garment, settings)
        final = self.physics_weights(work, physics, inputs, rigid, settings)
        welded = inputs["welded"]
        np.savez(
            work / "final.npz",
            joints=final["influences"].bone_of[welded],
            weights=final["influences"].shares[welded],
            bones=np.array(inputs["bones"]),
        )
        evaluation = self.evaluate_poses(work, inputs, rigid, final, garment, settings)
        measurements = self.build_measurements(inputs, rigid, final, evaluation, physics, garment)
        (work / "validation" / "measurements.json").write_text(json.dumps(measurements, indent=2))
        print(
            f"STAGE weights nodes={inputs['count']} influences={settings.section('weights').maxInfluences} "
            f"poses={measurements['poses']} limbs={rigid['ownership']} edges>3x={measurements['edges']['over3']} "
            f"edges>5x={measurements['edges']['over5']}"
        )

    @staticmethod
    def load_inputs(work, settings):
        descriptor, tuning = settings.descriptor, settings.section("weights")
        skeleton = Skeleton.load(work, descriptor)
        raw, rig, split = np.load(work / "raw.npz"), np.load(work / "rig.npz"), np.load(work / "lo_split.npz")
        bones = skeleton.names
        if [str(name) for name in raw["bones"]] != bones:
            raise ValueError("bone order in raw.npz differs from skeleton.json: rerun from the rig stage")
        welded, first = weld_ids(split["positions"], weld_labels(work))
        count = len(first)
        node_positions = split["positions"][first]
        bind_heads = {name: to_blender(rig["bind_world"][row][:3, 3]) for row, name in enumerate(bones)}
        left_thigh, right_thigh = (descriptor.leg(side)[0] for side in descriptor.SIDES)
        hip_height = (bind_heads[left_thigh][2] + bind_heads[right_thigh][2]) / 2
        crotch = (
            (np.abs(node_positions[:, 0] - bind_heads[descriptor.pelvis][0]) < settings.length(tuning.crotchHalfWidth))
            & (node_positions[:, 2] > hip_height - settings.length(tuning.crotchBelowHip))
            & (node_positions[:, 2] < hip_height + settings.length(tuning.crotchAboveHip))
        )
        return {
            "descriptor": descriptor,
            "skeleton": skeleton,
            "raw": raw,
            "rig": rig,
            "split": split,
            "bones": bones,
            "welded": welded,
            "first": first,
            "count": count,
            "node_positions": node_positions,
            "node_props": raw["props"][first],
            "bind_heads": bind_heads,
            "crotch": crotch,
            "protect": np.bincount(welded, weights=raw["protect"], minlength=count)
            / np.bincount(welded, minlength=count),
            "limb_node": np.bincount(welded, weights=(raw["limb_of"] > 0).astype(float), minlength=count) > 0,
            "edges": WeightsStage.unique_edges(welded[split["faces"]]),
        }

    def rigid_weights(self, work, inputs, garment, settings):
        tuning, descriptor, bones = settings.section("weights"), inputs["descriptor"], inputs["bones"]
        node_weights = inputs["raw"]["weights"][inputs["first"]]
        used = np.nonzero((node_weights > 1e-6).any(0))[0]
        node_weights = node_weights[:, used]
        node_weights /= np.maximum(node_weights.sum(1, keepdims=True), 1e-9)
        movable = (inputs["protect"] < 0.5) & (~inputs["limb_node"] | inputs["crotch"])
        if garment:
            movable &= garment["drape"] <= 0.0
        smoothed = self.smooth_weights(
            node_weights, inputs["edges"], movable, inputs["count"], tuning.smoothingIterations
        )
        if garment:
            follow = garment["follow"][:, None]
            smoothed = follow * smoothed[garment["support"]] + (1.0 - follow) * smoothed
        columns, shares = self.top_influences(smoothed, tuning.maxInfluences)
        heads = inputs["bind_heads"]
        segments = {
            name: (heads[name], heads[descriptor.chains[name]])
            for limb in descriptor.limbs.values()
            for name, _ in limb["segments"]
        }
        final_smoothed = np.zeros_like(smoothed)
        np.put_along_axis(final_smoothed, columns, shares, axis=1)
        ownership = self.limb_ownership(
            inputs["node_positions"],
            np.load(work / "thick.npy")[inputs["first"]],
            inputs["protect"],
            segments,
            final_smoothed,
            used,
            bones,
            settings,
        )
        return {"influences": SkinInfluences(used, columns, shares), "smoothed": smoothed, "ownership": ownership}

    def physics_weights(self, work, physics, inputs, rigid, settings):
        if physics is None:
            return {**rigid, "audit": {}, "skin": None, "lattice_rows": None}
        influences, seam_source, seam_twin = self.merge_physics_weights(
            work, physics, inputs, rigid["influences"], settings
        )
        audit = self.audit_physics_weights(physics, inputs, influences, seam_source, seam_twin)
        skin_bones, skin_weights = self.lattice_node_skin(physics, inputs, rigid["influences"], settings)
        np.savez(work / "lattice_skin.npz", bones=skin_bones, weights=skin_weights)
        return {
            "influences": influences,
            "audit": audit,
            "skin": (skin_bones, skin_weights),
            "lattice_rows": np.array([inputs["bones"].index(name) for name in physics.definition["latticeBones"]]),
        }

    def evaluate_poses(self, work, inputs, rigid, final, garment, settings):
        regions = self.stretch_regions(inputs, rigid, settings)
        groups = self.rigid_groups(inputs["raw"], detected_bodies(work)["props"], inputs["first"], settings)
        poses = list(ClipPoses(inputs["skeleton"], inputs["rig"]["rest_translations"]).all())
        accumulator = PoseAccumulator(inputs, settings, regions, groups, garment, len(poses))
        bind_inverse = np.linalg.inv(inputs["rig"]["bind_world"])
        for _, world in poses:
            pose_skin = world @ bind_inverse
            if final["skin"]:
                pose_skin = self.lattice_pose_skin(pose_skin, final["lattice_rows"], *final["skin"])
            moved = final["influences"].deform(inputs["node_positions"], pose_skin)
            if garment:
                accumulator.add_garment(moved, rigid["influences"].deform(inputs["node_positions"], pose_skin))
            accumulator.add_stretch(moved)
        return accumulator

    @staticmethod
    def stretch_regions(inputs, rigid, settings):
        bones = inputs["bones"]
        used_column = {int(bone_index): column for column, bone_index in enumerate(rigid["influences"].used)}
        regions = {}
        for name, region_bones in inputs["descriptor"].regions.items():
            region_columns = [
                used_column[bones.index(bone)] for bone in region_bones if bones.index(bone) in used_column
            ]
            regions[name] = rigid["smoothed"][:, region_columns].sum(1) > settings.section("weights").regionDominance
        return regions

    def build_measurements(self, inputs, rigid, final, evaluation, physics, garment):
        worst_edge = evaluation.worst_edge
        measurements = {
            "triangles": int(len(inputs["split"]["faces"])),
            "poses": evaluation.poses,
            "jointMissMm": round(float(inputs["rig"]["miss"].max()) * 1000, 3),
            "limbOwnership": rigid["ownership"],
            "rigidity": {
                name: {"maxMm": round(value[0] * 1000, 3), "rmsMm": round(value[1] * 1000, 3)}
                for name, value in evaluation.group_worst.items()
            },
            "seamGapMm": 0.0,
            "stretch": {
                name: {"worst": round(max(values), 2), "mean": round(float(np.mean(values)), 2)}
                for name, values in evaluation.region_worst.items()
                if values
            },
            "edges": {
                "total": len(evaluation.edges),
                "over3": int((worst_edge > 3).sum()),
                "over5": int((worst_edge > 5).sum()),
                "propBoundary": evaluation.boundary,
            },
        }
        if physics:
            radii = [collider["radius"] for collider in physics.definition["colliders"]]
            measurements["physics"] = {
                "bodies": len(physics.definition["bodies"]),
                "latticeBones": len(physics.definition["latticeBones"]),
                "bodyNodes": {body["name"]: len(body["nodeBones"]) for body in physics.definition["bodies"]},
                "colliders": len(radii),
                "colliderRadiusMin": min(radii),
                "colliderRadiusMax": max(radii),
                **final["audit"],
            }
            if garment and garment["garment"].any():
                measurements["physics"]["garment"] = self.garment_measurements(
                    inputs, final, evaluation, physics, garment
                )
        return measurements

    def garment_measurements(self, inputs, final, evaluation, physics, garment):
        records = [body for body in physics.definition["bodies"] if body["wrapped"]]
        arm_share = self.drape_arm_share(garment, final["influences"], inputs["bones"], inputs["descriptor"])
        limit = evaluation.lift_limit
        outliers = evaluation.node_lift[evaluation.node_lift > limit]
        print(
            f"CHECK garment lift outliers: {len(outliers)} of {len(evaluation.node_lift)} resting nodes exceed "
            f"{limit * 1000:.1f} mm in some pose, worst {', '.join(f'{value * 1000:.0f}' for value in np.sort(outliers)[::-1][:6])} mm"
        )
        return {
            "rimVertices": int(garment["rim"].sum()),
            "mantleVertices": int(garment["mantle"].sum()),
            "drapeVertices": int((garment["garment"] & ~garment["mantle"]).sum()),
            "detachedNodes": garment["detached"],
            "maxDrapeArmShare": round(arm_share, 4),
            "liftMm": round(max(evaluation.lift) * 1000, 2),
            "liftSamples": len(garment["resting"]),
            "latticeNodes": sum(body["columns"] * body["rows"] for body in records),
            "nodeSpacingMm": round(max(body["nodeSpacing"] for body in records) * 1000, 1),
            "uncoveredVertices": sum(body["uncovered"] for body in records),
            "bandStretch": round(max(evaluation.band_lattice), 2),
            "bandStretchRigid": round(max(evaluation.band_rigid), 2),
        }

    @staticmethod
    def unique_edges(faces):
        edges = np.sort(face_edges(faces), axis=1)
        edges = np.unique(edges, axis=0)
        return edges[edges[:, 0] != edges[:, 1]]

    @staticmethod
    def smooth_weights(start, edges, movable, count, iterations):
        rows = np.concatenate([edges[:, 0], edges[:, 1]])
        columns = np.concatenate([edges[:, 1], edges[:, 0]])
        adjacency = coo_matrix((np.ones(len(rows)), (rows, columns)), shape=(count, count)).tocsr()
        degree = np.asarray(adjacency.sum(1)).ravel()
        walk = diags(1.0 / np.maximum(degree, 1.0)) @ adjacency
        movable = movable & (degree > 0)
        weights = start.copy()
        for _ in range(iterations):
            averaged = 0.5 * weights + 0.5 * (walk @ weights)
            weights[movable] = averaged[movable]
        return weights

    @staticmethod
    def top_influences(weights, maximum):
        order = np.argsort(-weights, axis=1)[:, :maximum]
        shares = np.take_along_axis(weights, order, axis=1)
        shares /= np.maximum(shares.sum(1, keepdims=True), 1e-9)
        return order, shares

    @staticmethod
    def rigid_groups(raw, props, first, settings):
        descriptor, snap = settings.descriptor, settings.section("rig").rigidZoneSnap
        body = raw["props"] == 0
        groups = {"head": (raw["head_zone"] > snap) & body}
        for side in descriptor.SIDES:
            hand = descriptor.arm(side)[2]
            groups[hand] = (raw[f"{hand}_zone"] > snap) & body
        for index, prop in enumerate(props, start=1):
            groups[f"prop:{prop['name']}"] = raw["props"] == index
        empty = [name for name, mask in groups.items() if mask[first].sum() < 3]
        if empty:
            raise ValueError(
                f"rigid groups {empty} have fewer than 3 vertices: the rigidity check would silently skip them"
            )
        return {name: mask[first] for name, mask in groups.items()}

    @staticmethod
    def limb_ownership(node_positions, thickness, protect, segments, smoothed, used, bones, settings):
        thin_to = settings.length(settings.section("prepare").thinTo)
        core_share = settings.section("rig").limbCoreShare
        reach = limb_reach(node_positions, segments, settings)
        nearest = np.argmin(np.array(list(reach.values())), axis=0)
        ownership = {}
        for number, (limb, spec) in enumerate(settings.descriptor.limbs.items()):
            core = (nearest == number) & (reach[limb] < core_share) & (thickness >= thin_to) & (protect < 0.5)
            if not core.any():
                raise ValueError(
                    f"limb {limb} has no core vertices: the ownership check would pass without measuring anything"
                )
            allowed = [column for column, bone in enumerate(used) if bones[bone] in spec["bones"]]
            ownership[limb] = round(float(smoothed[core][:, allowed].sum(1).mean()), 4)
        return ownership

    @staticmethod
    def garment_nodes(physics, inputs, settings):
        first, node_positions, node_props = inputs["first"], inputs["node_positions"], inputs["node_props"]
        data = physics.weights
        garment, mantle, rim = (data[key][first] for key in ("garment", "mantle", "rim"))
        drape = inputs["raw"]["drape"][first]
        prop_points = node_positions[node_props > 0]
        touch = settings.length(settings.section("weights").liftSupportExclusion)
        touching_prop = (
            cKDTree(prop_points).query(node_positions, distance_upper_bound=touch)[0] <= touch
            if len(prop_points)
            else np.zeros(len(node_positions), bool)
        )
        unexcluded = ~garment & (node_props == 0) & (data["labels"][first] == 0)
        body = np.flatnonzero(unexcluded & ~touching_prop)
        rest, nearest = cKDTree(node_positions[body]).query(node_positions)
        reach = settings.length(settings.section("weights").garmentLiftReach)
        near_body = garment & ~mantle & (rest < reach)
        resting = np.flatnonzero(near_body & (drape > 0.0))
        drape_factor = 1.0 - drape
        distance_factor = 1.0 - smoothstep(reach, 2.0 * reach, rest)
        follow = np.where(garment & ~mantle, drape_factor * distance_factor, 0.0)
        if garment.any():
            minimum = settings.section("weights").minLiftSamples
            print(
                f"CHECK garment lift support excludes {int((touching_prop & (node_props == 0)).sum())} nodes touching a prop; "
                f"{int(near_body.sum())} resting nodes with it, "
                f"{int((garment & ~mantle & (cKDTree(node_positions[unexcluded]).query(node_positions)[0] < reach)).sum())} "
                f"without it; {len(resting)} with drape above 0 gate the lift"
            )
            if len(resting) < minimum:
                raise ValueError(
                    f"only {len(resting)} resting garment nodes have drape above 0 (minimum {minimum}), so the lift "
                    "check would pass without measuring anything: widen weights.garmentLiftReach, check that the "
                    "garment drape mask reaches the body, or lower weights.minLiftSamples"
                )
        garment_bodies = [
            index for index, record in enumerate(physics.definition["bodies"], start=1) if record["wrapped"]
        ]
        margin = settings.section("weights").drivenBlend
        blend = data["blend"][first]
        transition = np.isin(data["labels"][first], garment_bodies) & (blend > margin) & (blend < 1.0 - margin)
        return {
            "garment": garment,
            "mantle": mantle,
            "rim": rim,
            "drape": drape,
            "detached": int(data["detached"]),
            "body": body,
            "resting": resting,
            "support": body[nearest],
            "follow": follow,
            "rest": rest[resting],
            "transition": transition,
        }

    @staticmethod
    def drape_arm_share(garment, influences, bones, descriptor):
        full = garment["drape"] >= 0.99
        if not full.any():
            return 0.0
        bone_of = influences.bone_of[full]
        return max(
            float(
                (influences.shares[full] * np.isin(bone_of, [bones.index(name) for name in descriptor.arm(side) if name in bones]))
                .sum(1)
                .max()
            )
            for side in descriptor.SIDES
        )

    @staticmethod
    def lattice_node_skin(physics, inputs, influences, settings):
        bones, first, node_positions = inputs["bones"], inputs["first"], inputs["node_positions"]
        descriptor, minimum_blend = settings.descriptor, settings.section("weights").drivenBlend
        blend_depth = settings.section("physics").homeBlendDepth
        data = physics.weights
        vertex_nodes, vertex_weights = data["nodes"][first], data["weights"][first]
        dense = influences.dense(len(bones))
        splat = np.zeros((len(physics.definition["latticeBones"]), len(bones)))
        driven = np.flatnonzero((data["labels"][first] > 0) & (data["blend"][first] > minimum_blend))
        contribution = vertex_weights[driven][:, :, None] * dense[driven][:, None, :]
        np.add.at(splat, vertex_nodes[driven].ravel(), contribution.reshape(-1, len(bones)))
        empty = np.flatnonzero(splat.sum(1) < 1e-9)
        if len(empty):
            lattice_positions = np.concatenate(
                [np.asarray(body["nodePositions"]) for body in physics.definition["bodies"]]
            )
            nearest = nearest_values(node_positions[driven], lattice_positions[empty], driven)
            splat[empty] = dense[nearest]
        torso = {bone for bone, region in descriptor.spine_curve if region == "torso"}
        torso |= {descriptor.clavicle(side) for side in descriptor.SIDES}
        keep = np.array([name in torso for name in bones])
        splat[:, ~keep] = 0.0
        offset = 0
        for body in physics.definition["bodies"]:
            count = len(body["nodeBones"])
            rows = slice(offset, offset + count)
            attach = bones.index(body["attachBone"])
            splat[offset + np.flatnonzero(splat[rows].sum(1) < 1e-9), attach] = 1.0
            splat[rows] /= splat[rows].sum(1, keepdims=True)
            geodesic = np.asarray(body["geodesicDistance"])
            share = np.clip(geodesic / (geodesic.max() * blend_depth), 0.0, 1.0)
            splat[rows] *= share[:, None]
            splat[rows, attach] += 1.0 - share
            offset += count
        skin_bones = np.argsort(-splat, axis=1)[:, :4]
        skin_weights = np.take_along_axis(splat, skin_bones, 1)
        stray = sorted({bones[index] for index, weight in zip(skin_bones.ravel(), skin_weights.ravel()) if weight > 0} - torso)
        if stray:
            raise ValueError(f"lattice home skin uses non-torso bones {stray}")
        print(f"CHECK lattice homes skinned to {sorted({bones[index] for index in np.unique(skin_bones[skin_weights > 0])})}")
        return skin_bones, skin_weights / skin_weights.sum(1, keepdims=True)

    @staticmethod
    def lattice_pose_skin(pose_skin, lattice_rows, skin_bones, skin_weights):
        pose_skin[lattice_rows] = np.einsum("nk,nkij->nij", skin_weights, pose_skin[skin_bones])
        return pose_skin

    @staticmethod
    def merge_physics_weights(work, physics, inputs, influences, settings):
        bones, first, node_positions = inputs["bones"], inputs["first"], inputs["node_positions"]
        weights = physics.weights
        lattice_bones = np.array([bones.index(name) for name in physics.definition["latticeBones"]])
        labels = weights["labels"][first]
        seeded = [
            index for index, body in enumerate(detected_bodies(work)["physics"], start=1) if body.get("clothSeed")
        ]
        cloth = labels > 0
        seam_cloth = np.isin(labels, seeded)
        body = ~cloth & (np.load(work / "props.npy")[first] == 0)
        cloth_keys = {tuple(key) for key in np.round(node_positions[seam_cloth], WELD_DECIMALS)}
        seam = np.flatnonzero(body)[[tuple(key) in cloth_keys for key in np.round(node_positions[body], WELD_DECIMALS)]]
        seam_source = np.full(len(labels), -1)
        seam_twin = np.zeros(len(labels), bool)
        seam_fade = np.ones(len(labels))
        if len(seam):
            distance, nearest = cKDTree(node_positions[seam]).query(node_positions[seam_cloth])
            seam_twin[seam_cloth] = distance < 10.0**-WELD_DECIMALS
            fade = np.clip(distance / settings.length(settings.section("physics").seamFadeDistance), 0.0, 1.0)
            seam_fade[seam_cloth] = smooth_unit(fade)
            seam_source[seam_cloth] = np.where(fade < 1.0, seam[nearest], -1)
        print(
            f"CHECK physics seam nodes={len(seam)} cloth nodes blended toward the body={int((seam_source >= 0).sum())}"
        )
        merged = lattice.merge_lattice_weights(
            lattice_bones,
            cloth,
            weights["nodes"][first],
            weights["weights"][first],
            weights["blend"][first] * seam_fade,
            seam_source,
            influences,
        )
        return merged, seam_source, seam_twin

    @staticmethod
    def audit_physics_weights(physics, inputs, influences, seam_source, seam_twin):
        bones = inputs["bones"]
        labels = physics.weights["labels"][inputs["first"]]
        lattice_bones = {bones.index(name) for name in physics.definition["latticeBones"]}
        influenced = influences.shares > 1e-6
        bone_of = influences.bone_of
        is_lattice = np.isin(bone_of, list(lattice_bones)) & influenced
        cloth = labels > 0
        dense = influences.dense(len(bones))
        twins = np.flatnonzero(seam_twin)
        return {
            "clothVertices": int(cloth.sum()),
            "strayLatticeInfluences": int((is_lattice.any(1) & ~cloth).sum()),
            "seamNodes": int(len(twins)),
            "seamWeightMismatches": int((np.abs(dense[twins] - dense[seam_source[twins]]).max(1) > 1e-4).sum())
            if len(twins)
            else 0,
        }


class ExportStage(BuildStage):
    name = "export"
    NORMAL_UNIT_TOLERANCE = 1e-3
    WEIGHT_SUM_TOLERANCE = 1e-3

    @staticmethod
    def write_graded_albedo(grade, source_path, target_path):
        image = bpy.data.images.load(str(source_path))
        image.colorspace_settings.name = "Non-Color"
        pixels = np.empty(image.size[0] * image.size[1] * 4, np.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape(-1, 4)
        colour = pixels[:, :3]
        brightest = colour.max(axis=1, keepdims=True)
        colour = brightest - (brightest - colour) * grade["saturationScale"]
        pixels[:, :3] = np.clip(colour, 0.0, 1.0) ** grade["valueExponent"]
        image.pixels.foreach_set(pixels.ravel())
        image.filepath_raw = str(target_path)
        image.file_format = "PNG"
        image.save()
        bpy.data.images.remove(image)

    def run(self, config, work):
        assert_detection_current(config, work)
        skeleton = Skeleton.load(work, ModelSettings.from_config(config).descriptor)
        final, rig, split = (np.load(work / name) for name in ("final.npz", "rig.npz", "lo_split.npz"))
        self.validate_skin(skeleton, final, split)
        arrays = work / "arrays"
        meta = self.write_arrays(arrays, skeleton, final, rig, split)
        self.write_graded_albedo(config["albedoGrade"], work / "albedo.png", work / "baseColor.png")
        if detected_bodies(work)["physics"]:
            self.write_physics(work, arrays, skeleton, rig)
        print(
            f"STAGE export vertices={meta['vertices']} triangles={meta['triangles']} joints={len(skeleton.skin)} "
            f"legRatio={float(rig['leg_ratio']):.3f}"
        )

    def validate_skin(self, skeleton, final, split):
        bones = skeleton.names
        missing = sorted(set(skeleton.skin) - set(bones))
        if missing:
            raise ValueError(f"skin joints {missing} are not in skeleton.json")
        normal_error = float(np.abs(np.linalg.norm(split["normals"], axis=1) - 1.0).max())
        if normal_error > self.NORMAL_UNIT_TOLERANCE:
            raise ValueError(
                f"vertex normals are not unit length (worst error {normal_error:.3f}): a shader divides by them and "
                f"outputs NaN"
            )
        weighted_bones = {bones[column] for column in np.unique(final["joints"][final["weights"] > 0])}
        unmapped = sorted(weighted_bones - set(skeleton.skin))
        if unmapped:
            raise ValueError(f"vertices are weighted to bones outside the skeleton's skin: {unmapped}")
        weight_sum_error = float(np.abs(final["weights"].astype(np.float32).sum(1) - 1.0).max())
        if weight_sum_error > self.WEIGHT_SUM_TOLERANCE:
            raise ValueError(
                f"vertex weights do not sum to 1 (worst error {weight_sum_error:.3f}): such a vertex collapses to the "
                f"origin"
            )

    @staticmethod
    def write_arrays(arrays, skeleton, final, rig, split):
        skin_column = np.array([skeleton.skin.index(name) if name in skeleton.skin else 0 for name in skeleton.names])
        inverse_binds = np.linalg.inv(rig["bind_world"][[skeleton.index[name] for name in skeleton.skin]])
        weights = final["weights"].astype(np.float32)
        weights /= weights.sum(1, keepdims=True)
        uvs = split["uvs"].copy()
        uvs[:, 1] = 1.0 - uvs[:, 1]
        to_gltf(split["positions"]).astype(np.float32).tofile(arrays / "positions.f32")
        to_gltf(split["normals"]).astype(np.float32).tofile(arrays / "normals.f32")
        uvs.astype(np.float32).tofile(arrays / "uvs.f32")
        skin_column[final["joints"]].astype(np.uint16).tofile(arrays / "joints.u16")
        weights.tofile(arrays / "weights.f32")
        split["faces"].astype(np.uint32).tofile(arrays / "indices.u32")
        np.array([matrix.T for matrix in inverse_binds], dtype=np.float32).tofile(arrays / "ibm.f32")
        rest = {
            name: [float(value) for value in rig["rest_translations"][skeleton.index[name]]] for name in skeleton.skin
        }
        (arrays / "rest.json").write_text(json.dumps(rest))
        meta = {
            "vertices": int(len(split["positions"])),
            "triangles": int(len(split["faces"])),
            "jointNames": skeleton.skin,
        }
        (arrays / "meta.json").write_text(json.dumps(meta))
        return meta

    @staticmethod
    def write_physics(work, arrays, skeleton, rig):
        physics = PhysicsWork(work)
        skin = np.load(work / "lattice_skin.npz")
        flat = lambda values: [float(value) for value in np.asarray(values).ravel()]
        bodies, first = [], 0
        for body in physics.definition["bodies"]:
            last = first + len(body["nodeBones"])
            entry = {
                "name": body["name"],
                "kind": body["kind"],
                "attachBone": body["attachBone"],
                "columns": body["columns"],
                "rows": body["rows"],
                "nodeBones": body["nodeBones"],
                "restPositions": flat(to_gltf(np.array(body["nodePositions"]))),
                "restNormals": flat(to_gltf(np.array(body["nodeNormals"]))),
                "pinned": body["pinned"],
                "nearestPin": body["nearestPin"],
                "geodesicDistance": body["geodesicDistance"],
                "skinBones": [skeleton.names[index] for index in skin["bones"][first:last].ravel()],
                "skinWeights": flat(skin["weights"][first:last]),
            }
            if body["feel"]:
                entry["feel"] = body["feel"]
            bodies.append(entry)
            first = last
        colliders = []
        for collider in physics.definition["colliders"]:
            inverse = np.linalg.inv(rig["bind_world"][skeleton.index[collider["bone"]]])
            local = lambda point: [float(value) for value in (inverse @ np.r_[to_gltf(np.array(point)), 1.0])[:3]]
            colliders.append(
                {
                    "bone": collider["bone"],
                    "start": local(collider["start"]),
                    "end": local(collider["end"]),
                    "radius": collider["radius"],
                }
            )
        (arrays / "physics.json").write_text(
            json.dumps({"version": 3, "referenceBone": skeleton.descriptor.pelvis, "bodies": bodies, "colliders": colliders})
        )


class AnimStage(BuildStage):
    name = "anim"

    def run(self, config, work):
        settings = ModelSettings.from_config(config)
        descriptor = settings.descriptor
        preview = SkinnedPreview(work, config)
        studio = Studio()
        seam_gap = 0.0
        standard_shots = descriptor.preview_clips("standard")
        extreme_shots = descriptor.preview_clips("extreme")
        regions = tuple(preview.region_centres())

        preview.apply(preview.rest, preview.rest_normals)
        shots = overview_shots(settings, ("front", "back", "side"), 2.0)
        shoot_sheet(studio, shots, 3, 1, 480, work, "rest")

        grid = ContactSheet(len(standard_shots), len(regions))
        for column, (clip, fraction) in enumerate(standard_shots):
            seam_gap = max(seam_gap, preview.pose(clip, fraction))
            centres = preview.region_centres()
            for row, region in enumerate(regions):
                centre, scale, view = centres[region]
                shoot_tile(studio, grid, work, "anim", column, row, centre, scale, view)
        grid.save(work / "validation" / "anim.png")

        extremes = ContactSheet(len(extreme_shots), 2)
        for column, (clip, fraction) in enumerate(extreme_shots):
            seam_gap = max(seam_gap, preview.pose(clip, fraction))
            pelvis = preview.joint(descriptor.pelvis)
            for row, view in enumerate(("front", "side")):
                centre = (pelvis.x, pelvis.y, settings.length(0.9))
                shoot_tile(studio, extremes, work, "extreme", column, row, centre, settings.length(2.4), view)
        extremes.save(work / "validation" / "extremes.png")

        measurements_path = work / "validation" / "measurements.json"
        measurements = json.loads(measurements_path.read_text())
        measurements["seamGapMm"] = round(seam_gap * 1000, 4)
        measurements_path.write_text(json.dumps(measurements, indent=2))
        print(
            f"STAGE anim validation/rest.png validation/anim.png validation/extremes.png "
            f"seamGap={seam_gap * 1000:.4f}mm"
        )


STAGES_BY_KIND = {
    "character": [
        PrepareStage(),
        UnwrapStage(),
        BakeStage(),
        JointsStage(),
        CloseupsStage(),
        MasksStage(),
        PhysicsStage(),
        RigStage(),
        BonesStage(),
        WeightsStage(),
        ExportStage(),
        AnimStage(),
    ],
}


def run_stage(kind, stage_name, recipe_file, work_root):
    if kind not in STAGES_BY_KIND:
        raise ValueError(f"no model kind {kind} (kinds: {', '.join(STAGES_BY_KIND)})")
    stages = {stage.name: stage for stage in STAGES_BY_KIND[kind]}
    if stage_name not in stages:
        raise ValueError(f"no {kind} stage {stage_name} (stages: {', '.join(stages)})")
    stages[stage_name].run(json.loads(Path(recipe_file).read_text()), Path(work_root))
