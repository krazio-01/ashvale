from dataclasses import dataclass

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

BLENDER_TO_GLTF = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]])
BLENDER_TO_GLTF_4 = np.eye(4)
BLENDER_TO_GLTF_4[:3, :3] = BLENDER_TO_GLTF


def normalised(vector):
    return vector / max(float(np.linalg.norm(vector)), 1e-12)


def principal_axes(points):
    return np.linalg.svd(points - points.mean(axis=0), full_matrices=False)[2]


def to_blender(points):
    return np.asarray(points) @ BLENDER_TO_GLTF


def to_gltf(points):
    return np.asarray(points) @ BLENDER_TO_GLTF.T


def matrices_to_blender(matrices):
    return BLENDER_TO_GLTF_4.T @ matrices @ BLENDER_TO_GLTF_4


def quaternion_matrix(quaternion):
    x, y, z, w = quaternion / np.linalg.norm(quaternion)
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def compose(translation, rotation, scale):
    matrix = np.eye(4)
    matrix[:3, :3] = quaternion_matrix(rotation) * scale
    matrix[:3, 3] = translation
    return matrix


def closest_on_segment(points, start, end):
    span = end - start
    along = np.clip(((points - start) @ span) / max(float(span @ span), 1e-12), 0.0, 1.0)
    return start + along[:, None] * span


def segment_distance(points, start, end):
    return np.linalg.norm(points - closest_on_segment(points, start, end), axis=1)


def triangle_areas(positions, corners):
    first, second, third = positions[corners[:, 0]], positions[corners[:, 1]], positions[corners[:, 2]]
    return 0.5 * np.linalg.norm(np.cross(second - first, third - first), axis=1)


def smooth_unit(values):
    return values * values * (3.0 - 2.0 * values)


def smoothstep(edge0, edge1, values):
    return smooth_unit(np.clip((values - edge0) / (edge1 - edge0), 0.0, 1.0))


def face_edges(corners, pairs=((0, 1), (1, 2), (2, 0))):
    return np.concatenate([corners[:, list(pair)] for pair in pairs])


def rounded(values, decimals):
    return [round(float(value), decimals) for value in values]


def multi_source_distance(edges, lengths, count, sources):
    if not len(sources):
        return np.full(count, np.inf), np.full(count, -9999)
    graph = coo_matrix((lengths, (edges[:, 0], edges[:, 1])), shape=(count, count)).tocsr()
    distance, _, nearest = dijkstra(
        graph, directed=False, indices=sources, min_only=True, return_predecessors=True
    )
    return distance, nearest


@dataclass(frozen=True)
class SkinInfluences:
    used: np.ndarray
    columns: np.ndarray
    shares: np.ndarray

    @property
    def bone_of(self):
        return self.used[self.columns]

    def dense(self, bone_count):
        bone_of = self.bone_of
        dense = np.zeros((len(bone_of), bone_count))
        np.add.at(dense, (np.arange(len(bone_of))[:, None], bone_of), self.shares)
        return dense

    def deform(self, positions, pose_skin):
        skinning = matrices_to_blender(pose_skin[self.used])
        blended = np.einsum("nk,nkij->nij", self.shares, skinning[self.columns])
        return np.einsum("nij,nj->ni", blended, np.c_[positions, np.ones(len(positions))])[:, :3]
