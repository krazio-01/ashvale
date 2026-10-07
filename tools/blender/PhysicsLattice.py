import numpy as np

LATTICE_PREFIX = "phys_"


def lattice_bone_name(body, column, row):
    return f"{LATTICE_PREFIX}{body}_c{column}_r{row}"


def build_sheet(points, columns, rows, settings):
    physics = settings.section("physics")
    minimum_cell = settings.length(physics.minCell)
    centre = points.mean(axis=0)
    flat = points[:, :2] - centre[:2]
    _, eigenvectors = np.linalg.eigh(np.cov(flat.T))
    across = np.array([*eigenvectors[:, -1], 0.0])
    if across[0] < 0:
        across = -across
    u = (points - centre) @ across
    v = points[:, 2].max() - points[:, 2]
    u_min, u_max, v_max = float(u.min()), float(u.max()), float(v.max())
    cell_u = max((u_max - u_min) / (columns - 1), minimum_cell)
    cell_v = max(v_max / (rows - 1), minimum_cell)
    nodes = np.zeros((rows * columns, 3))
    for row in range(rows):
        for column in range(columns):
            node_u = u_min + column * (u_max - u_min) / (columns - 1)
            node_v = row * v_max / (rows - 1)
            distance = ((u - node_u) / (cell_u * physics.nodeSigmaCells)) ** 2 + ((v - node_v) / (cell_v * physics.nodeSigmaCells)) ** 2
            kernel = np.exp(-0.5 * distance)
            if kernel.sum() < 1e-9:
                nodes[row * columns + column] = points[int(np.argmin(distance))]
            else:
                nodes[row * columns + column] = (kernel[:, None] * points).sum(0) / kernel.sum()
    return {"nodes": nodes, "u": u, "v": v, "u_min": u_min, "u_max": u_max, "v_max": v_max, "centre": centre, "across": across, "top": float(points[:, 2].max())}


def project_onto_sheet(grid, points):
    return {**grid, "u": (points - grid["centre"]) @ grid["across"], "v": grid["top"] - points[:, 2]}


def sheet_weights(grid, points, columns, rows, settings):
    span_u = max(grid["u_max"] - grid["u_min"], 1e-9)
    span_v = max(grid["v_max"], 1e-9)
    column_position = np.clip((grid["u"] - grid["u_min"]) / span_u * (columns - 1), 0.0, columns - 1 - 1e-9)
    row_position = np.clip(grid["v"] / span_v * (rows - 1), 0.0, rows - 1 - 1e-9)
    column0 = column_position.astype(int)
    row0 = row_position.astype(int)
    across = column_position - column0
    down = row_position - row0
    top_left = row0 * columns + column0
    upper = across + down <= 1.0
    nodes = np.where(
        upper[:, None],
        np.stack([top_left, top_left + 1, top_left + columns], axis=1),
        np.stack([top_left + columns + 1, top_left + columns, top_left + 1], axis=1),
    )
    weights = np.where(
        upper[:, None],
        np.stack([1 - across - down, across, down], axis=1),
        np.stack([across + down - 1, 1 - across, 1 - down], axis=1),
    )
    fade = np.clip(row_position / settings.section("physics").fadeRows, 0.0, 1.0)
    return nodes, weights, fade * fade * (3.0 - 2.0 * fade)


def measure_capsule_radius(points, start, end, reach, settings):
    physics = settings.section("physics")
    minimum_radius = settings.length(physics.colliderMinRadius)
    span = end - start
    length = float(np.linalg.norm(span))
    if length < 1e-9:
        return minimum_radius
    axis = span / length
    relative = points - start
    along = relative @ axis / length
    perpendicular = relative - np.outer(relative @ axis, axis)
    distance = np.linalg.norm(perpendicular, axis=1)
    near = (along > physics.colliderAlong[0]) & (along < physics.colliderAlong[1]) & (distance < reach)
    if near.sum() < physics.minPointsForCapsule:
        return minimum_radius
    helper = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    first = np.cross(axis, helper)
    first /= np.linalg.norm(first)
    second = np.cross(axis, first)
    offsets = perpendicular[near]
    angle = np.arctan2(offsets @ second, offsets @ first)
    sector = ((angle + np.pi) / (2 * np.pi) * physics.colliderSectors).astype(int) % physics.colliderSectors
    radii = [distance[near][sector == index].max() for index in range(physics.colliderSectors) if (sector == index).any()]
    return max(float(np.median(radii)) * physics.colliderShrink, minimum_radius)


def merge_lattice_weights(lattice_bones, vertex_cloth, lattice_nodes, lattice_weights, lattice_blend, seam_source, used, columns, shares):
    new_used = np.unique(np.concatenate([used, lattice_bones]))
    position = {int(bone): index for index, bone in enumerate(new_used)}
    remapped = np.array([position[int(bone)] for bone in used])[columns]
    merged_columns = remapped.copy()
    merged_shares = shares.copy()
    width = columns.shape[1]
    for node in np.flatnonzero(vertex_cloth):
        blend = lattice_blend[node]
        source = seam_source[node]
        influences = {}
        donor = source if source >= 0 else node
        rigid = zip(remapped[donor], shares[donor])
        for column, share in rigid:
            influences[int(column)] = influences.get(int(column), 0.0) + (1.0 - blend) * share
        for index, weight in zip(lattice_nodes[node], lattice_weights[node]):
            column = position[int(lattice_bones[index])]
            influences[column] = influences.get(column, 0.0) + blend * weight
        strongest = sorted(influences.items(), key=lambda item: -item[1])[:width]
        strongest += [(strongest[0][0], 0.0)] * (width - len(strongest))
        total = sum(share for _, share in strongest)
        merged_columns[node] = [column for column, _ in strongest]
        merged_shares[node] = [share / total for _, share in strongest]
    return new_used, merged_columns, merged_shares
