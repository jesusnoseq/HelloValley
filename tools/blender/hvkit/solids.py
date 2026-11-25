"""Pure-Python solid generators (no bpy): vertex and face lists that ``MeshBuilder.solid``
turns into bmesh geometry. Keeping the maths here makes it unit-testable without Blender.

All coordinates are Blender space (Z up, the module front at y = 0 looking towards -Y).
Faces are lists of vertex indices wound counter-clockwise when seen from outside, so the
normals point outwards.
"""

from __future__ import annotations

import math
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

Vec3 = Tuple[float, float, float]
Solid = Tuple[List[Vec3], List[List[int]]]

AXES = {"x": 0, "y": 1, "z": 2}


def signed_area(profile: Sequence[Tuple[float, float]]) -> float:
    """Shoelace area of a 2D polygon; positive when counter-clockwise."""
    area = 0.0
    n = len(profile)
    for i in range(n):
        x0, y0 = profile[i]
        x1, y1 = profile[(i + 1) % n]
        area += x0 * y1 - x1 * y0
    return area / 2.0


def _lift(axis: int, along: float, u: float, v: float) -> Vec3:
    """Place a profile point (u, v) at ``along`` on ``axis``. The (u, v) plane is (y, z) for X,
    (x, z) for Y and (x, y) for Z, so (u, v, axis) is right-handed for X and Z and left-handed
    for Y (handled by the winding fix in :func:`prism`)."""
    if axis == 0:
        return (along, u, v)
    if axis == 1:
        return (u, along, v)
    return (u, v, along)


def prism(profile: Sequence[Tuple[float, float]], axis: str, start: float, end: float, slices: int = 1) -> Solid:
    """Extrude a simple polygon ``profile`` (2D, any winding) along ``axis`` from ``start`` to
    ``end``. Gable triangles, roof slabs, diagonal beams and steps are all prisms. ``slices``
    splits the sides into rings, which gives vertex colours and noise more points to work on."""
    if len(profile) < 3:
        raise ValueError("a prism profile needs at least 3 points")
    if end <= start:
        raise ValueError("prism end must be greater than start")
    ax = AXES[axis]
    area = signed_area(profile)
    if abs(area) < 1e-12:
        raise ValueError("prism profile has no area")
    pts = list(profile)
    # Make the profile counter-clockwise in a right-handed (u, v, axis) frame, so the cap at
    # ``end`` faces +axis when wound in profile order.
    right_handed = ax != 1
    if (area > 0) != right_handed:
        pts.reverse()
    if slices < 1:
        raise ValueError("a prism needs at least one slice")
    n = len(pts)
    verts: List[Vec3] = []
    for k in range(slices + 1):
        along = start + (end - start) * k / slices
        verts.extend(_lift(ax, along, u, v) for u, v in pts)
    top = slices * n
    faces: List[List[int]] = [list(range(top, top + n)), list(reversed(range(n)))]
    for k in range(slices):
        base = k * n
        for i in range(n):
            j = (i + 1) % n
            faces.append([base + i, base + j, base + n + j, base + n + i])
    return verts, faces


def seam_planes(seams: Iterable[object], bounds: Tuple[Sequence[float], Sequence[float]]) -> List[Tuple[int, float]]:
    """Resolve seam names (``"x"``, ``"x+"``, ``"x-"``, ``"y"``..., or an axis index) to
    ``(axis, coordinate)`` planes of the footprint box ``bounds``."""
    lo, hi = bounds
    planes: List[Tuple[int, float]] = []
    for seam in seams:
        if isinstance(seam, int):
            axis, sides = seam, "+-"
        else:
            name = str(seam)
            if not name or name[0] not in AXES or name[1:] not in ("", "+", "-"):
                raise ValueError(f"invalid seam {seam!r}; use x, x+, x-, y, y+, y-, z, z+ or z-")
            axis, sides = AXES[name[0]], name[1:] or "+-"
        if not 0 <= axis <= 2:
            raise ValueError(f"invalid seam axis {axis}")
        if "-" in sides:
            planes.append((axis, float(lo[axis])))
        if "+" in sides:
            planes.append((axis, float(hi[axis])))
    return planes


def translate(solid: Solid, offset: Sequence[float]) -> Solid:
    verts, faces = solid
    return [(x + offset[0], y + offset[1], z + offset[2]) for x, y, z in verts], faces


def rotate_z(solid: Solid, angle: float, origin: Sequence[float] = (0.0, 0.0, 0.0)) -> Solid:
    """Rotate counter-clockwise (seen from above) by ``angle`` radians around a vertical axis."""
    verts, faces = solid
    c, s = math.cos(angle), math.sin(angle)
    ox, oy = origin[0], origin[1]
    out = []
    for x, y, z in verts:
        dx, dy = x - ox, y - oy
        out.append((ox + dx * c - dy * s, oy + dx * s + dy * c, z))
    return out, faces


def box(lo: Sequence[float], hi: Sequence[float]) -> Solid:
    return prism([(lo[0], lo[2]), (hi[0], lo[2]), (hi[0], hi[2]), (lo[0], hi[2])], "y", lo[1], hi[1])


def beam_profile(p0: Tuple[float, float], p1: Tuple[float, float], width: float) -> List[Tuple[float, float]]:
    """The 4-point 2D outline of a straight bar ``width`` across from ``p0`` to ``p1``."""
    du, dv = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(du, dv)
    if length <= 0:
        raise ValueError("a beam needs two distinct points")
    nu, nv = -dv / length * width / 2, du / length * width / 2
    return [(p0[0] + nu, p0[1] + nv), (p0[0] - nu, p0[1] - nv), (p1[0] - nu, p1[1] - nv), (p1[0] + nu, p1[1] + nv)]


def beam(p0: Tuple[float, float], p1: Tuple[float, float], width: float, y0: float, y1: float) -> Solid:
    """A straight beam in the XZ plane (half-timbering braces), ``width`` across, from y0 to
    y1 in depth."""
    return prism(beam_profile(p0, p1, width), "y", y0, y1)


def swap_yz(solid: Solid) -> Solid:
    """Mirror Y and Z (keeps outward normals by reversing the winding): turns an XZ panel
    from :func:`grid_panel` into a subdivided XY ground slab."""
    verts, faces = solid
    return [(x, z, y) for x, y, z in verts], [list(reversed(f)) for f in faces]


def clip_beam_profile(
    p0: Tuple[float, float], p1: Tuple[float, float], width: float, lo: Tuple[float, float], hi: Tuple[float, float]
) -> List[Tuple[float, float]]:
    """The beam's 4-point XZ outline clipped to the rectangle ``lo``..``hi`` (Sutherland-Hodgman),
    so diagonal braces end flush inside a timber frame."""
    poly = beam_profile(p0, p1, width)
    for axis, bound, keep_greater in ((0, lo[0], True), (0, hi[0], False), (1, lo[1], True), (1, hi[1], False)):
        out: List[Tuple[float, float]] = []
        if not poly:
            break
        for i, cur in enumerate(poly):
            prev = poly[i - 1]
            cur_in = cur[axis] >= bound if keep_greater else cur[axis] <= bound
            prev_in = prev[axis] >= bound if keep_greater else prev[axis] <= bound
            if cur_in != prev_in:
                t = (bound - prev[axis]) / (cur[axis] - prev[axis])
                out.append((prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t))
            if cur_in:
                out.append(cur)
        poly = out
    # Drop near-duplicate points left by clipping at a corner.
    cleaned: List[Tuple[float, float]] = []
    for p in poly:
        if not cleaned or math.dist(p, cleaned[-1]) > 1e-6:
            cleaned.append(p)
    if len(cleaned) > 1 and math.dist(cleaned[0], cleaned[-1]) <= 1e-6:
        cleaned.pop()
    return cleaned


def grid_panel(
    xs: Sequence[float], zs: Sequence[float], holes: Iterable[Tuple[int, int]], y0: float, y1: float
) -> Solid:
    """A slab in the XZ plane, ``y0``..``y1`` thick, cut on the grid lines ``xs`` x ``zs`` with
    the cells in ``holes`` (column i, row j) left open: walls with window, door and shopfront
    openings in one watertight mesh. Faces on the same plane share edges, so the mesh stays
    manifold and bevels can round only the real (sharp) edges."""
    if len(xs) < 2 or len(zs) < 2:
        raise ValueError("grid_panel needs at least two lines per axis")
    if any(b <= a for a, b in zip(xs, xs[1:])) or any(b <= a for a, b in zip(zs, zs[1:])):
        raise ValueError("grid lines must be strictly increasing")
    if y1 <= y0:
        raise ValueError("panel thickness must be positive")
    nx, nz = len(xs) - 1, len(zs) - 1
    open_cells: Set[Tuple[int, int]] = set(holes)
    for i, j in open_cells:
        if not (0 <= i < nx and 0 <= j < nz):
            raise ValueError(f"hole {(i, j)} is outside the {nx}x{nz} grid")

    def filled(i: int, j: int) -> bool:
        return 0 <= i < nx and 0 <= j < nz and (i, j) not in open_cells

    verts: List[Vec3] = []
    index: Dict[Tuple[int, int, int], int] = {}

    def v(i: int, j: int, side: int) -> int:
        key = (i, j, side)
        if key not in index:
            index[key] = len(verts)
            verts.append((xs[i], y0 if side == 0 else y1, zs[j]))
        return index[key]

    faces: List[List[int]] = []
    for i in range(nx):
        for j in range(nz):
            if not filled(i, j):
                continue
            # Front (y0, normal -Y) and back (y1, normal +Y).
            faces.append([v(i, j, 0), v(i + 1, j, 0), v(i + 1, j + 1, 0), v(i, j + 1, 0)])
            faces.append([v(i, j, 1), v(i, j + 1, 1), v(i + 1, j + 1, 1), v(i + 1, j, 1)])
            # Side faces where the neighbour is empty or outside.
            if not filled(i - 1, j):  # normal -X
                faces.append([v(i, j, 0), v(i, j + 1, 0), v(i, j + 1, 1), v(i, j, 1)])
            if not filled(i + 1, j):  # normal +X
                faces.append([v(i + 1, j, 0), v(i + 1, j, 1), v(i + 1, j + 1, 1), v(i + 1, j + 1, 0)])
            if not filled(i, j - 1):  # normal -Z
                faces.append([v(i, j, 0), v(i, j, 1), v(i + 1, j, 1), v(i + 1, j, 0)])
            if not filled(i, j + 1):  # normal +Z
                faces.append([v(i, j + 1, 0), v(i + 1, j + 1, 0), v(i + 1, j + 1, 1), v(i, j + 1, 1)])
    if not faces:
        raise ValueError("grid_panel has no filled cells")
    return verts, faces


def face_normal(verts: Sequence[Vec3], face: Sequence[int]) -> Vec3:
    """Newell's method; unit length (or zero for a degenerate face)."""
    nx = ny = nz = 0.0
    for a, b in zip(face, list(face[1:]) + [face[0]]):
        x0, y0, z0 = verts[a]
        x1, y1, z1 = verts[b]
        nx += (y0 - y1) * (z0 + z1)
        ny += (z0 - z1) * (x0 + x1)
        nz += (x0 - x1) * (y0 + y1)
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    return (0.0, 0.0, 0.0) if length == 0 else (nx / length, ny / length, nz / length)


def centroid(verts: Sequence[Vec3]) -> Vec3:
    n = float(len(verts))
    return (sum(p[0] for p in verts) / n, sum(p[1] for p in verts) / n, sum(p[2] for p in verts) / n)


def tri_count(faces: Iterable[Sequence[int]]) -> int:
    return sum(max(0, len(f) - 2) for f in faces)


def gable_profile(x0: float, x1: float, z_eave: float, z_ridge: float) -> List[Tuple[float, float]]:
    """A symmetric triangle (u = x or y, v = z) for gable ends."""
    return [(x0, z_eave), (x1, z_eave), ((x0 + x1) / 2, z_ridge)]


def stepped_gable_steps(
    u0: float, u1: float, z_base: float, z_ridge: float, steps: int
) -> List[Tuple[float, float, float, float]]:
    """A crow-stepped gable as stacked blocks: ``(u_lo, u_hi, z_lo, z_hi)`` per block, from
    the full-width base up to the narrow top block, each block inset by one step per side."""
    if steps < 1:
        raise ValueError("a stepped gable needs at least one step")
    if u1 <= u0 or z_ridge <= z_base:
        raise ValueError("stepped gable needs a positive span and height")
    span = u1 - u0
    top_w = span / (2 * steps + 1)
    run = (span - top_w) / 2 / steps
    rise = (z_ridge - z_base) / (steps + 1)
    blocks = []
    for k in range(steps + 1):
        blocks.append((u0 + k * run, u1 - k * run, z_base + k * rise, z_base + (k + 1) * rise))
    return blocks


def hip_roof(
    x0: float, x1: float, y0: float, y1: float, z0: float, z1: float, top_scale: float = 0.0, ridge: Optional[float] = None
) -> Solid:
    """A solid hip roof over the rectangle ``x0..x1`` x ``y0..y1`` from ``z0`` up to ``z1``.
    All four slopes share one pitch, so the ridge runs along the longer side (a square gives
    a pyramid). ``top_scale`` > 0 truncates it into a frustum whose top is that fraction of the
    base (a layered or bell-cast roof is a stack of these). ``ridge`` forces a ridge of that
    length along X (a pavilion roof on a square base; the end slopes get steeper)."""
    if x1 <= x0 or y1 <= y0 or z1 <= z0:
        raise ValueError("hip_roof needs a positive base and height")
    if not 0.0 <= top_scale < 1.0:
        raise ValueError("top_scale must be in [0, 1)")
    w, d = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    inset = min(w, d) / 2 * (1.0 - top_scale)
    if ridge is not None:
        if not 0.0 <= ridge < w:
            raise ValueError("ridge must be shorter than the roof")
        tx0, tx1, ty0, ty1 = cx - ridge / 2, cx + ridge / 2, cy, cy
    elif top_scale > 0.0:
        tx0, tx1, ty0, ty1 = x0 + inset, x1 - inset, y0 + inset, y1 - inset
    elif w >= d:
        tx0, tx1, ty0, ty1 = x0 + inset, x1 - inset, cy, cy
    else:
        tx0, tx1, ty0, ty1 = cx, cx, y0 + inset, y1 - inset
    base = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)]
    top = [(tx0, ty0, z1), (tx1, ty0, z1), (tx1, ty1, z1), (tx0, ty1, z1)]
    verts: List[Vec3] = base + top
    faces: List[List[int]] = [[3, 2, 1, 0]]
    for i in range(4):
        j = (i + 1) % 4
        faces.append([i, j, 4 + j, 4 + i])
    faces.append([4, 5, 6, 7])
    return _weld(verts, faces)


def _weld(verts: Sequence[Vec3], faces: Sequence[Sequence[int]], eps: float = 1e-9) -> Solid:
    """Merge coincident vertices and drop the degenerate faces and repeated corners that
    leaves (a pyramid's apex, a ridge with no length)."""
    remap: List[int] = []
    out: List[Vec3] = []
    for p in verts:
        for k, q in enumerate(out):
            if all(abs(p[i] - q[i]) <= eps for i in range(3)):
                remap.append(k)
                break
        else:
            remap.append(len(out))
            out.append(p)
    new_faces: List[List[int]] = []
    for f in faces:
        g: List[int] = []
        for i in f:
            r = remap[i]
            if not g or g[-1] != r:
                g.append(r)
        if len(g) > 1 and g[0] == g[-1]:
            g.pop()
        if len(g) >= 3:
            new_faces.append(g)
    return out, new_faces


# --- organic shapes (M06: vegetation, props, terrain) ---------------------------------------


def _sub(a: Sequence[float], b: Sequence[float]) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Sequence[float], b: Sequence[float]) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a: Sequence[float]) -> Vec3:
    n = math.sqrt(sum(c * c for c in a))
    if n == 0:
        raise ValueError("zero-length vector")
    return (a[0] / n, a[1] / n, a[2] / n)


def frame(direction: Sequence[float]) -> Tuple[Vec3, Vec3, Vec3]:
    """An orthonormal (u, v, w) frame with w along ``direction``: u stays horizontal when it
    can, so tubes and leaves keep a stable roll."""
    w = _norm(direction)
    up = (0.0, 0.0, 1.0) if abs(w[2]) < 0.95 else (1.0, 0.0, 0.0)
    u = _norm(_cross(up, w))
    v = _cross(w, u)
    return u, v, w


def tube(
    points: Sequence[Sequence[float]], radii: Sequence[float], sides: int = 6, caps: bool = True
) -> Solid:
    """A closed tube through 3D ``points`` with one radius per point (branches, curved palm
    trunks, stems, reeds, handles). Each ring is perpendicular to the local direction."""
    if len(points) < 2 or len(points) != len(radii):
        raise ValueError("a tube needs at least two points and one radius per point")
    if sides < 3:
        raise ValueError("a tube needs at least three sides")
    n = len(points)
    verts: List[Vec3] = []
    for i, p in enumerate(points):
        a = points[max(0, i - 1)]
        b = points[min(n - 1, i + 1)]
        u, v, _ = frame(_sub(b, a))
        r = radii[i]
        for k in range(sides):
            t = 2.0 * math.pi * k / sides
            c, s = math.cos(t) * r, math.sin(t) * r
            verts.append((p[0] + u[0] * c + v[0] * s, p[1] + u[1] * c + v[1] * s, p[2] + u[2] * c + v[2] * s))
    faces: List[List[int]] = []
    for i in range(n - 1):
        a, b = i * sides, (i + 1) * sides
        for k in range(sides):
            j = (k + 1) % sides
            faces.append([a + k, a + j, b + j, b + k])
    if caps:
        faces.append(list(reversed(range(sides))))
        faces.append([(n - 1) * sides + k for k in range(sides)])
    return verts, faces


def leaf(
    points: Sequence[Sequence[float]], widths: Sequence[float], thickness: float = 0.02, side: Sequence[float] = (0.0, 0.0, 1.0)
) -> Solid:
    """A thin closed ribbon along a 3D spine (palm fronds, grass blades, flower leaves). The
    width is measured across the spine, perpendicular to it and to ``side`` (the ribbon's
    normal hint, usually up). Use ``MeshBuilder.solid(..., recalc_normals=True)``."""
    if len(points) < 2 or len(points) != len(widths):
        raise ValueError("a leaf needs at least two points and one width per point")
    n = len(points)
    verts: List[Vec3] = []
    for i, p in enumerate(points):
        a = points[max(0, i - 1)]
        b = points[min(n - 1, i + 1)]
        d = _sub(b, a)
        across = _norm(_cross(d, side))
        normal = _norm(_cross(across, d))
        hw = widths[i] / 2
        ht = thickness / 2
        for sx, sz in ((-1, 1), (1, 1), (1, -1), (-1, -1)):
            verts.append(tuple(p[k] + across[k] * hw * sx + normal[k] * ht * sz for k in range(3)))  # type: ignore[misc]
    faces: List[List[int]] = []
    for i in range(n - 1):
        a, b = i * 4, (i + 1) * 4
        for k in range(4):
            j = (k + 1) % 4
            faces.append([a + k, a + j, b + j, b + k])
    faces.append([3, 2, 1, 0])
    faces.append([(n - 1) * 4 + k for k in range(4)])
    return verts, faces


def heightfield(
    xs: Sequence[float], ys: Sequence[float], height, keep=None
) -> Tuple[List[Vec3], List[List[int]], List[Tuple[int, int]]]:
    """A ground surface on the grid ``xs`` x ``ys`` with ``z = height(x, y)`` (river banks).
    ``keep(i, j)`` filters cells. Returns (verts, faces, grid index of every vertex). Quads
    are split along the diagonal that follows the slope best (shorter in 3D)."""
    if len(xs) < 2 or len(ys) < 2:
        raise ValueError("heightfield needs at least two lines per axis")
    index: Dict[Tuple[int, int], int] = {}
    verts: List[Vec3] = []
    cells: List[Tuple[int, int]] = []

    def v(i: int, j: int) -> int:
        if (i, j) not in index:
            index[(i, j)] = len(verts)
            verts.append((xs[i], ys[j], float(height(xs[i], ys[j]))))
            cells.append((i, j))
        return index[(i, j)]

    faces: List[List[int]] = []
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            if keep is not None and not keep(i, j):
                continue
            a, b, c, d = v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)
            if abs(verts[a][2] - verts[c][2]) <= abs(verts[b][2] - verts[d][2]):
                faces += [[a, b, c], [a, c, d]]
            else:
                faces += [[a, b, d], [b, c, d]]
    return verts, faces, cells
