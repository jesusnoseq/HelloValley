"""Materials: vertex colours multiplied by the style's tiling texture atlas.

The GLB keeps the UVs and the ``COLOR_0`` vertex colours but not the atlas image (one shared
``atlas.*`` file per kit instead of a copy in every GLB). Atlas materials carry the
``hv_atlas`` custom property, which the exporter writes as material extras, so the client can
bind the shared atlas texture at load time (TODO(M10)). In Blender the node tree previews
the same result.
"""

from __future__ import annotations

from typing import Optional

import bpy

COLOR_ATTRIBUTE = "Color"
UV_MAP = "UVMap"


def _set_input(node: "bpy.types.Node", names: tuple, value) -> None:
    """Principled BSDF socket names changed across versions (Specular -> Specular IOR Level)."""
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def load_atlas_image(path: str, name: str = "hv_atlas") -> "bpy.types.Image":
    image = bpy.data.images.load(path, check_existing=True)
    image.name = name
    try:
        image.colorspace_settings.name = "sRGB"
    except TypeError:  # pragma: no cover - unusual OCIO configs
        pass
    return image


def atlas_material(name: str, image: Optional["bpy.types.Image"], roughness: float = 0.9) -> "bpy.types.Material":
    """Base colour = vertex colour x atlas detail. Matte, no metal: no PBR realism (GDD §7.1)."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat["hv_atlas"] = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    # The exporter cannot read the multiply chain below, so it falls back to this socket's
    # default as baseColorFactor: keep it white so COLOR_0 is not darkened. Specular stays at
    # its default; changing it adds KHR_materials_specular (a costlier physical material).
    _set_input(bsdf, ("Base Color",), (1.0, 1.0, 1.0, 1.0))
    _set_input(bsdf, ("Roughness",), roughness)
    _set_input(bsdf, ("Metallic",), 0.0)
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    vcol = nodes.new("ShaderNodeVertexColor")
    vcol.location = (-500, 100)
    vcol.layer_name = COLOR_ATTRIBUTE
    if image is None:
        links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
        return mat

    uv = nodes.new("ShaderNodeUVMap")
    uv.location = (-700, -150)
    uv.uv_map = UV_MAP
    tex = nodes.new("ShaderNodeTexImage")
    tex.location = (-500, -150)
    tex.image = image
    tex.interpolation = "Linear"
    tex.extension = "EXTEND"  # the gutter handles edges; never wrap into a neighbour tile
    links.new(uv.outputs["UV"], tex.inputs["Vector"])
    # Vector Math sockets are stable across versions, unlike the Mix node's indices.
    mul = nodes.new("ShaderNodeVectorMath")
    mul.location = (-200, 0)
    mul.operation = "MULTIPLY"
    links.new(vcol.outputs["Color"], mul.inputs[0])
    links.new(tex.outputs["Color"], mul.inputs[1])
    links.new(mul.outputs[0], bsdf.inputs["Base Color"])
    return mat


def vertex_material(
    name: str,
    roughness: float,
    marker: str,
    emission: Optional[tuple] = None,
    emission_strength: float = 1.0,
) -> "bpy.types.Material":
    """Base colour = vertex colour only (no atlas): window glass and lamp glow. ``marker`` is a
    custom property (``hv_glass``, ``hv_glow``) the client can use to swap in a night or
    reflective variant (TODO(M09)). ``emission`` is a linear RGB tuple for glowing parts;
    strength 1 keeps the exporter on core glTF (no KHR_materials_emissive_strength)."""
    mat = atlas_material(name, None, roughness)
    del mat["hv_atlas"]
    mat[marker] = True
    if emission is not None:
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        _set_input(bsdf, ("Emission Color", "Emission"), (*emission[:3], 1.0))
        _set_input(bsdf, ("Emission Strength",), emission_strength)
    return mat


def flat_material(name: str, rgba, roughness: float = 0.9) -> "bpy.types.Material":
    """A plain colour material (no atlas), for emissive lamps or glass later."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        _set_input(bsdf, ("Base Color",), tuple(rgba))
        _set_input(bsdf, ("Roughness",), roughness)
    mat.diffuse_color = tuple(rgba)
    return mat
