param(
    [string]$Variant = '*',
    [string]$OutputDirectory = 'work/opus-skeleton-rig-20260926/output'
)

$ErrorActionPreference = 'Stop'
$started = [Diagnostics.Stopwatch]::StartNew()
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
$source = if ([IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory } else { Join-Path $root $OutputDirectory }
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $logDir "guardian-rigs-$stamp.log"
$scratch = Join-Path ([IO.Path]::GetTempPath()) "brann-guardian-rigs-$stamp-$PID"
$result = 'failed'

try {
    if (!(Test-Path -LiteralPath $engine -PathType Leaf)) { throw "Bundled Godot missing: $engine" }
    if (!(Test-Path -LiteralPath $source -PathType Container)) { throw "Output directory missing: $source" }
    $rigs = @(Get-ChildItem -LiteralPath $source -Filter '*_rig.glb' -File |
        Where-Object { $_.BaseName -like "${Variant}_rig" } | Sort-Object Name)
    if ($rigs.Count -eq 0) { throw "No published *_rig.glb files match variant '$Variant' in $source" }
    New-Item -ItemType Directory -Force -Path $scratch | Out-Null
    Set-Content -LiteralPath (Join-Path $scratch 'project.godot') -Encoding UTF8 -Value "config_version=5`n[application]`nconfig/name=`"Guardian Rig Validation`"`n"
    foreach ($rig in $rigs) { Copy-Item -LiteralPath $rig.FullName -Destination (Join-Path $scratch $rig.Name) }
    $gdscript = @'
extends SceneTree

const REQUIRED_BONES := ["Root", "Torso", "Head", "LeftArm", "RightArm", "LeftLeg", "RightLeg"]
const REQUIRED_CLIPS := ["idle", "walk", "attack"]

func _initialize() -> void:
	var failed := false
	for arg in OS.get_cmdline_user_args():
		var row := check_rig(arg)
		print("GUARDIAN_RIG_RESULT ", JSON.stringify(row))
		if not row["failures"].is_empty():
			failed = true
	quit(1 if failed else 0)

func bone_matches(name: String, expected: String) -> bool:
	return name == expected or name.begins_with(expected + "_")

func pose_snapshot(skeleton: Skeleton3D) -> Array:
	var result := []
	for i in range(skeleton.get_bone_count()):
		var pose := skeleton.get_bone_pose(i)
		result.append([pose.origin.x, pose.origin.y, pose.origin.z,
			pose.basis.x.x, pose.basis.x.y, pose.basis.x.z,
			pose.basis.y.x, pose.basis.y.y, pose.basis.y.z,
			pose.basis.z.x, pose.basis.z.y, pose.basis.z.z])
	return result

func pose_distance(a: Array, b: Array) -> float:
	var maximum := 0.0
	for i in range(mini(a.size(), b.size())):
		for j in range(a[i].size()):
			maximum = maxf(maximum, absf(a[i][j] - b[i][j]))
	return maximum

func check_rig(filename: String) -> Dictionary:
	var row := {"file": filename, "failures": [], "bones": [], "clips": {}, "meshes": 0,
		"skinned_meshes": 0, "triangles": 0, "material_slots": 0, "height_m": 0.0,
		"pose_deltas": {}}
	var packed: PackedScene = load("res://" + filename)
	if packed == null:
		row["failures"].append("GLB failed to import")
		return row
	var root: Node = packed.instantiate()
	get_root().add_child(root)
	var skeletons := root.find_children("*", "Skeleton3D", true, false)
	var players := root.find_children("*", "AnimationPlayer", true, false)
	var meshes := root.find_children("*", "MeshInstance3D", true, false)
	if skeletons.size() != 1:
		row["failures"].append("expected exactly one Skeleton3D; found %d" % skeletons.size())
	if players.is_empty():
		row["failures"].append("missing AnimationPlayer")
	if skeletons.size() == 1:
		var skeleton: Skeleton3D = skeletons[0]
		for i in range(skeleton.get_bone_count()):
			row["bones"].append(skeleton.get_bone_name(i))
		for expected in REQUIRED_BONES:
			var found := false
			for name in row["bones"]:
				if bone_matches(name, expected): found = true
			if not found: row["failures"].append("missing bone " + expected)
	var bounds := AABB()
	var has_bounds := false
	for mesh_node in meshes:
		var mi: MeshInstance3D = mesh_node
		if mi.mesh == null: continue
		row["meshes"] += 1
		if mi.skin != null and not mi.skeleton.is_empty(): row["skinned_meshes"] += 1
		var box: AABB = mi.global_transform * mi.mesh.get_aabb()
		if not has_bounds:
			bounds = box
			has_bounds = true
		else:
			bounds = bounds.merge(box)
		for surface in range(mi.mesh.get_surface_count()):
			var arrays := mi.mesh.surface_get_arrays(surface)
			var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
			var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			row["triangles"] += int(indices.size() / 3) if not indices.is_empty() else int(vertices.size() / 3)
			if mi.mesh.surface_get_material(surface) != null or mi.get_surface_override_material(surface) != null:
				row["material_slots"] += 1
	row["height_m"] = snappedf(bounds.size.y, 0.001) if has_bounds else 0.0
	if row["meshes"] < 7: row["failures"].append("expected at least seven separate meshes")
	if row["skinned_meshes"] < 7: row["failures"].append("expected at least seven skinned meshes")
	if row["triangles"] <= 0: row["failures"].append("mesh has no triangles")
	if row["material_slots"] <= 0: row["failures"].append("mesh has no materials")
	if row["height_m"] < 1.0 or row["height_m"] > 2.5:
		row["failures"].append("mesh height outside 1.0-2.5 m")
	var clip_owner: Dictionary = {}
	for player_node in players:
		var player: AnimationPlayer = player_node
		for clip in player.get_animation_list():
			for expected in REQUIRED_CLIPS:
				if clip == expected or clip.ends_with("/" + expected):
					clip_owner[expected] = [player, clip]
					row["clips"][expected] = snappedf(player.get_animation(clip).length, 0.001)
	for expected in REQUIRED_CLIPS:
		if not clip_owner.has(expected): row["failures"].append("missing clip " + expected)
	if skeletons.size() == 1 and clip_owner.size() == REQUIRED_CLIPS.size():
		var poses := {}
		for clip in REQUIRED_CLIPS:
			var entry: Array = clip_owner[clip]
			var player: AnimationPlayer = entry[0]
			var anim: Animation = player.get_animation(entry[1])
			if anim.length <= 0.0:
				row["failures"].append("zero-length clip " + clip)
				continue
			var samples := []
			for fraction in [0.25, 0.50, 0.75]:
				player.play(entry[1])
				player.seek(anim.length * fraction, true)
				player.advance(0.0)
				samples.append(pose_snapshot(skeletons[0]))
			player.stop()
			poses[clip] = samples
			var motion := maxf(pose_distance(samples[0], samples[1]), pose_distance(samples[1], samples[2]))
			row["pose_deltas"][clip + "_within"] = snappedf(motion, 0.0001)
			if motion < 0.001: row["failures"].append("static skeleton pose in " + clip)
		if poses.size() == REQUIRED_CLIPS.size():
			for clip in ["walk", "attack"]:
				var difference := 0.0
				for i in range(3): difference = maxf(difference, pose_distance(poses["idle"][i], poses[clip][i]))
				row["pose_deltas"][clip + "_vs_idle"] = snappedf(difference, 0.0001)
				if difference < 0.01: row["failures"].append(clip + " pose indistinguishable from idle")
	root.queue_free()
	return row
'@
    Set-Content -LiteralPath (Join-Path $scratch 'check.gd') -Encoding UTF8 -Value $gdscript
    "$(Get-Date -Format o) files=$($rigs.Name -join ',') scratch=$scratch" | Set-Content -LiteralPath $log -Encoding UTF8
    $importWatch = [Diagnostics.Stopwatch]::StartNew()
    & $engine --headless --xr-mode off --audio-driver Dummy --path $scratch --editor --import *>> $log
    $importWatch.Stop()
    if ($LASTEXITCODE -ne 0) { throw "Godot import failed with exit $LASTEXITCODE; see $log" }
    $checkWatch = [Diagnostics.Stopwatch]::StartNew()
    & $engine --headless --xr-mode off --audio-driver Dummy --path $scratch --script 'res://check.gd' -- @($rigs.Name) *>> $log
    $checkWatch.Stop()
    $checkExit = $LASTEXITCODE
    Get-Content -LiteralPath $log | Where-Object { $_ -like 'GUARDIAN_RIG_RESULT *' } | ForEach-Object { Write-Host $_ }
    if ($checkExit -ne 0) { throw "Rig validation failed with exit $checkExit; see $log" }
    $result = 'passed'
    Write-Host "Guardian rigs passed: $($rigs.Name -join ', ')"
    Write-Host "Import $([math]::Round($importWatch.Elapsed.TotalSeconds, 3)) s; check $([math]::Round($checkWatch.Elapsed.TotalSeconds, 3)) s; log $log"
}
catch {
    Write-Error $_
}
finally {
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $scratchFull = [IO.Path]::GetFullPath($scratch)
    if ($scratchFull.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($scratchFull).StartsWith('brann-guardian-rigs-', [StringComparison]::Ordinal) -and
        (Test-Path -LiteralPath $scratchFull)) {
        Remove-Item -LiteralPath $scratchFull -Recurse -Force
    }
    $started.Stop()
    if (Test-Path -LiteralPath $log) {
        $importSeconds = if ($null -ne $importWatch) { [math]::Round($importWatch.Elapsed.TotalSeconds, 3) } else { 'not-started' }
        $checkSeconds = if ($null -ne $checkWatch) { [math]::Round($checkWatch.Elapsed.TotalSeconds, 3) } else { 'not-started' }
        "SUMMARY result=$result import_seconds=$importSeconds check_seconds=$checkSeconds total_seconds=$([math]::Round($started.Elapsed.TotalSeconds, 3))" | Add-Content -LiteralPath $log
    }
    "guardian-rig-validation,$result,$([math]::Round($started.Elapsed.TotalSeconds, 3))" | Add-Content -LiteralPath (Join-Path $logDir 'work-timing.csv')
}
if ($result -ne 'passed') { exit 1 }
