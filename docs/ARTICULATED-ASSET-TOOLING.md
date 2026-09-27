# Articulated VR asset tooling assessment — 2026-09-15

Recommendation: Blender Python + Godot validation as the main Siegebird pipeline. Optional build123d/CadQuery for selected parametrically generated hard-surface components. Do not make CADAM or a hosted Adam subscription a prerequisite.

This is a primary-source documentation assessment, not a hands-on comparative benchmark. No contender was installed or tested in this investigation. No evidence supports naming one universal state-of-the-art winner for this combined task.

- CADAM: open-source text/image-to-OpenSCAD app, parametric sliders, STL/SCAD/DXF exports. Useful for adjustable solid components. Requires additional assembly/material/animation/game export work; server setup documents model-provider API keys and Supabase. Free code does not mean free hosted AI inference. https://github.com/Adam-CAD/CADAM
- Blender: modeling, materials, constraints, drivers, Python automation and glTF/GLB pipeline fit the existing stylized game better. https://www.blender.org/features/animation/ and https://www.blender.org/features/pipeline/
- Blender MCP: optional third-party AI control transport; supports scene inspection, object/material editing and Python execution. It is not a mechanical solver or a separate intelligence upgrade. Direct reproducible Python scripts should remain the source of truth. https://github.com/ahujasid/blender-mcp
- build123d/CadQuery: optional parametric solid authoring for components, joints/assemblies; CadQuery supports assembly glTF export. Useful selectively; not a substitute for VR animation, controls or performance verification. https://build123d.readthedocs.io/en/stable/joints.html and https://github.com/CadQuery/cadquery/blob/master/doc/importexport.rst
- FreeCAD: parametric CAD and built-in assembly workbench; better fit if physical CAD documentation becomes the main objective. https://www.freecad.org/features.php
- TRELLIS.2: modern generated visual geometry, but no demonstrated solution here for verified custom mechanical behavior. Official local requirements: Linux tested, NVIDIA GPU >=24GB VRAM. https://github.com/microsoft/TRELLIS.2
- PartCrafter generates multiple parts from an RGB image; Articulate-Anything targets articulated objects. Relevant research to watch, but these capabilities alone do not prove a new crossbow assembly is clearance-correct or ready for VR. https://github.com/wgsxm/PartCrafter and https://github.com/vlongle/articulate-anything

Implementation proposal: stable named parts and pivots; shared data for shape, motion and interaction anchors; a small reusable scripted Blender builder; baked preview motion plus runtime Godot control from the same parameter contract. Model supports, string routing, bolt path and hand space deliberately. Geometry Nodes remain optional for repeated decorative details, not a mandatory hidden mechanism system.

Acceptance: full reload/fire/reset sweep with mesh intersections, containment and minimum-clearance checks, explicit allowed contact pairs; dense/adaptive samples are evidence, not a mathematical continuous guarantee. Blender BVHTree overlap is one building block, not a complete solid-clearance proof. https://docs.blender.org/api/main/mathutils.bvhtree.html

Verify exported result in Godot, including one/two-handed grips, crank grabs, load interruption, optics, duplicate bolts and runtime cost. Blender constraints do not become live game behavior merely by exporting GLB. https://docs.godotengine.org/en/stable/classes/class_editorsceneformatimporterblend.html

Next step should be one pilot rebuilt Siegebird mechanism, keeping its current identity, with a full-cycle turntable and clearance report before generalizing to all inventions.
