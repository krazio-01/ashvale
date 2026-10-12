import numpy as np

from Geometry import SkinInfluences, closest_on_segment, multi_source_distance, rounded, segment_distance, smooth_unit

LATTICE_PREFIX = "phys_"
SPACING_PERCENTILE = 95.0
CLEARANCE_PASSES = 32
CLEARANCE_TOLERANCE = 1e-9
CLEARANCE_GATE_SHARE = 0.999
NODE_DECIMALS = 5


def lattice_bone_name(body, column, row):
    return f"{LATTICE_PREFIX}{body}_c{column}_r{row}"


def kernel_average(values, samples, node_coordinates, sigma):
    distance = (((node_coordinates[:, None, :] - samples[None, :, :]) / sigma) ** 2).sum(-1)
    kernel = np.exp(-0.5 * distance)
    total = kernel.sum(1)
    averaged = kernel @ values / np.maximum(total, 1e-300)[:, None]
    return np.where((total < 1e-9)[:, None], values[np.argmin(distance, axis=1)], averaged)


def outward_normals(normals, nodes, centre):
    radial = np.column_stack([nodes[:, :2] - centre, np.zeros(len(nodes))])
    oriented = normals * np.where((normals * radial).sum(1) < 0, -1.0, 1.0)[:, None]
    return oriented / np.maximum(np.linalg.norm(oriented, axis=1, keepdims=True), 1e-9)


def node_grid(columns, rows):
    return np.stack(np.meshgrid(np.arange(columns), np.arange(rows)), axis=-1).reshape(-1, 2).astype(float)


def grid_triangle_weights(column_position, row_position, columns, rows):
    column_position = np.clip(column_position, 0.0, columns - 1 - 1e-9)
    row_position = np.clip(row_position, 0.0, rows - 1 - 1e-9)
    column0, row0 = column_position.astype(int), row_position.astype(int)
    across, down = column_position - column0, row_position - row0
    top_left = row0 * columns + column0
    upper = (across + down <= 1.0)[:, None]
    nodes = np.where(
        upper,
        np.stack([top_left, top_left + 1, top_left + columns], axis=1),
        np.stack([top_left + columns + 1, top_left + columns, top_left + 1], axis=1),
    )
    weights = np.where(
        upper,
        np.stack([1 - across - down, across, down], axis=1),
        np.stack([across + down - 1, 1 - across, 1 - down], axis=1),
    )
    return nodes, weights


def build_sheet(points, normals, columns, rows, centre, settings):
    physics = settings.section("physics")
    middle = points.mean(axis=0)
    _, eigenvectors = np.linalg.eigh(np.cov((points[:, :2] - middle[:2]).T))
    across = np.array([*eigenvectors[:, -1], 0.0])
    across = -across if across[0] < 0 else across
    u = (points - middle) @ across
    v = points[:, 2].max() - points[:, 2]
    u_min, u_max, v_max = float(u.min()), float(u.max()), float(v.max())
    cell_u = max((u_max - u_min) / (columns - 1), settings.length(physics.minCell))
    cell_v = max(v_max / (rows - 1), settings.length(physics.minCell))
    samples = np.column_stack([(u - u_min) / cell_u, v / cell_v])
    corners = node_grid(columns, rows) * [(u_max - u_min) / (columns - 1) / cell_u, v_max / (rows - 1) / cell_v]
    nodes = kernel_average(points, samples, corners, physics.nodeSigmaCells)
    node_normals = outward_normals(kernel_average(normals, samples, corners, physics.nodeSigmaCells), nodes, centre)
    return {"nodes": nodes, "normals": node_normals, "u": u, "v": v, "u_min": u_min, "u_max": u_max, "v_max": v_max}


def sheet_weights(grid, columns, rows, settings):
    span_u = max(grid["u_max"] - grid["u_min"], 1e-9)
    column_position = (grid["u"] - grid["u_min"]) / span_u * (columns - 1)
    row_position = grid["v"] / max(grid["v_max"], 1e-9) * (rows - 1)
    nodes, weights = grid_triangle_weights(column_position, row_position, columns, rows)
    fade = np.clip(np.clip(row_position, 0.0, rows - 1) / settings.section("physics").fadeRows, 0.0, 1.0)
    return nodes, weights, smooth_unit(fade)


def wrapped_columns(grid, points):
    radial = points[:, :2] - grid["centre"]
    angle = np.arctan2(radial @ grid["side"], radial @ grid["facing"])
    drop = grid["top"] - points[:, 2]
    low = np.interp(drop, grid["row_drop"], grid["low"])
    high = np.interp(drop, grid["row_drop"], grid["high"])
    return (angle - low) / np.maximum(high - low, 1e-9) * (grid["columns"] - 1), drop


def wrapped_coordinates(grid, points):
    column_position, drop = wrapped_columns(grid, points)
    hem = np.interp(column_position, np.arange(grid["columns"]), grid["hem"])
    row_position = np.clip(drop / np.maximum(hem, 1e-9) * (grid["rows"] - 1), 0.0, grid["rows"] - 1)
    return column_position, row_position


def hem_profile(column_position, drop, columns, minimum_vertices):
    nearest = np.clip(np.rint(column_position).astype(int), 0, columns - 1)
    hem = np.full(columns, np.nan)
    for column in range(columns):
        members = drop[nearest == column]
        if len(members) >= minimum_vertices:
            hem[column] = np.percentile(members, 99.0)
    known = ~np.isnan(hem)
    return np.interp(np.arange(columns), np.flatnonzero(known), hem[known])


def wrapped_spans(angle, drop, rows, minimum_vertices):
    drop_max = float(drop.max())
    row_drop = np.linspace(0.0, drop_max, rows)
    half_band = drop_max / (rows - 1) / 2
    low, high = np.empty(rows), np.empty(rows)
    for row, centre_drop in enumerate(row_drop):
        band = np.abs(drop - centre_drop) <= half_band
        if band.sum() < minimum_vertices:
            raise ValueError(
                f"wrapped lattice row {row} holds {int(band.sum())} vertices, fewer than {minimum_vertices}"
            )
        low[row], high[row] = np.percentile(angle[band], [1.0, 99.0])
    return row_drop, low, high


def build_wrapped_sheet(points, normals, centre, top, settings):
    physics = settings.section("physics")
    spacing = settings.length(physics.nodeSpacing)
    radial = points[:, :2] - centre
    mean_radial = radial.mean(axis=0)
    if np.linalg.norm(mean_radial) < physics.minWrapFacing * float(np.median(np.linalg.norm(radial, axis=1))):
        raise ValueError("the garment wraps almost all the way around the body, so it has no back to hang from")
    facing = mean_radial / np.linalg.norm(mean_radial)
    side = np.array([-facing[1], facing[0]])
    angle = np.arctan2(radial @ side, radial @ facing)
    drop = top - points[:, 2]
    rows = int(np.ceil(float(drop.max()) / spacing)) + 1
    row_drop, low, high = wrapped_spans(angle, drop, rows, physics.minRowVertices)
    arc = (high - low).max() * float(np.median(np.linalg.norm(radial, axis=1)))
    grid = {
        "centre": centre,
        "facing": facing,
        "side": side,
        "top": top,
        "row_drop": row_drop,
        "low": low,
        "high": high,
        "columns": int(np.ceil(arc / spacing)) + 1,
        "rows": rows,
    }
    column_position, _ = wrapped_columns(grid, points)
    grid["hem"] = hem_profile(column_position, drop, grid["columns"], physics.minRowVertices)
    samples = np.column_stack(wrapped_coordinates(grid, points))
    corners = node_grid(grid["columns"], rows)
    grid["nodes"] = kernel_average(points, samples, corners, physics.nodeSigmaCells)
    normal_average = kernel_average(normals, samples, corners, physics.nodeSigmaCells)
    grid["normals"] = outward_normals(normal_average, grid["nodes"], centre)
    return grid


def wrapped_sheet_weights(grid, points):
    column_position, row_position = wrapped_coordinates(grid, points)
    nodes, weights = grid_triangle_weights(column_position, row_position, grid["columns"], grid["rows"])
    return nodes, weights, column_position


def top_row_pins(columns, rows):
    pinned = np.zeros(columns * rows, bool)
    pinned[:columns] = True
    return pinned


def lattice_edges(columns, rows, diagonals=True):
    index = np.arange(columns * rows).reshape(rows, columns)
    pairs = (
        (index[:, :-1], index[:, 1:]),
        (index[:-1, :], index[1:, :]),
        (index[:-1, :-1], index[1:, 1:]),
        (index[:-1, 1:], index[1:, :-1]),
    )[: 4 if diagonals else 2]
    return np.concatenate([np.column_stack([first.ravel(), second.ravel()]) for first, second in pairs])


def geodesic_to_pins(nodes, columns, rows, pinned):
    edges = lattice_edges(columns, rows)
    lengths = np.maximum(np.linalg.norm(nodes[edges[:, 0]] - nodes[edges[:, 1]], axis=1), 1e-9)
    return multi_source_distance(edges, lengths, len(nodes), np.flatnonzero(pinned))


def link_length_percentile(nodes, columns, rows, percentile):
    grid = nodes.reshape(rows, columns, 3)
    lengths = np.concatenate(
        [np.linalg.norm(np.diff(grid, axis=0), axis=2).ravel(), np.linalg.norm(np.diff(grid, axis=1), axis=2).ravel()]
    )
    return float(np.percentile(lengths, percentile))


def clear_of_colliders(nodes, normals, pinned, colliders, clearance):
    moved = nodes.copy()
    free = ~pinned
    for _ in range(CLEARANCE_PASSES):
        settled = True
        for collider in colliders:
            reach = collider["radius"] + clearance
            closest = closest_on_segment(moved, collider["start"], collider["end"])
            offset = moved - closest
            distance = np.linalg.norm(offset, axis=1)
            inside = free & (distance < reach * (1.0 - CLEARANCE_TOLERANCE))
            if not inside.any():
                continue
            settled = False
            direction = np.where(
                (distance > 1e-9)[:, None], offset / np.maximum(distance, 1e-9)[:, None], normals
            )
            moved[inside] = (closest + direction * reach)[inside]
        if settled:
            displacement = np.linalg.norm(moved - nodes, axis=1)
            return moved, int((displacement > 0).sum()), float(displacement.max())
    raise ValueError(f"lattice nodes still lie inside a collider shell after {CLEARANCE_PASSES} push-out passes")


def assert_clear_of_colliders(name, nodes, pinned, colliders, clearance):
    for collider in colliders:
        distance = segment_distance(nodes, collider["start"], collider["end"])
        reach = (collider["radius"] + clearance) * CLEARANCE_GATE_SHARE
        close = np.flatnonzero(~pinned & (distance < reach))
        if len(close):
            raise ValueError(
                f"physics body {name}: {len(close)} free nodes lie closer than {reach * 1000:.1f} mm to a collider "
                f"axis (node {int(close[0])} at {distance[close[0]] * 1000:.1f} mm, radius {collider['radius'] * 1000:.1f} mm "
                f"+ clearance {clearance * 1000:.1f} mm)"
            )


def derived_node_values(nodes, columns, rows):
    pinned = top_row_pins(columns, rows)
    distance, nearest = geodesic_to_pins(nodes, columns, rows, pinned)
    if not np.isfinite(distance).all():
        raise ValueError(f"{int((~np.isfinite(distance)).sum())} lattice nodes have no path to a pinned node")
    return {
        "pinned": [bool(value) for value in pinned],
        "nearestPin": [int(value) for value in nearest],
        "geodesicDistance": rounded(distance, NODE_DECIMALS),
        "nodeSpacing": link_length_percentile(nodes, columns, rows, SPACING_PERCENTILE),
    }


def measure_capsule_radius(points, start, end, reach, percentile, settings):
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
    radii = [
        distance[near][sector == index].max() for index in range(physics.colliderSectors) if (sector == index).any()
    ]
    return max(float(np.percentile(radii, percentile)) * physics.colliderShrink, minimum_radius)


def merge_lattice_weights(
    lattice_bones, vertex_cloth, lattice_nodes, lattice_weights, lattice_blend, seam_source, influences
):
    used, columns, shares = influences.used, influences.columns, influences.shares
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
    return SkinInfluences(new_used, merged_columns, merged_shares)
