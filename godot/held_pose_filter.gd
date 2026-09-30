extends RefCounted
## Filters a calibrated held socket in tracking space. Never write filtered poses
## back to an XR controller: release velocity must still use raw tracking.

const BASE_CUTOFF_HZ := 9.0
const MOTION_CUTOFF_HZ := 85.0
const POSITION_SPEED_FLOOR := 0.12 # m/s; rejects 0.5-1.5 mm hand tremor.
const ANGULAR_SPEED_FLOOR := 0.8 # rad/s.
const POSITION_CUTOFF_GAIN := 110.0 # Hz per m/s above the floor.
const ANGULAR_CUTOFF_GAIN := 32.0 # Hz per rad/s above the floor.
const SPEED_ESTIMATE_HZ := 12.0
const MAX_POSITION_LAG := 0.006 # metres, including sudden sub-teleport moves.
const MAX_ANGULAR_LAG := 0.8 * PI / 180.0
const SNAP_DISTANCE := 0.30
const SNAP_ANGLE := PI / 4.0
const MAX_SAMPLE_DELTA := 0.10

var _ready := false
var _pose := Transform3D.IDENTITY
var _last_target := Transform3D.IDENTITY
var _linear_velocity := Vector3.ZERO
var _angular_speed := 0.0


func reset(pose: Transform3D) -> void:
	_pose = pose
	_last_target = pose
	_linear_velocity = Vector3.ZERO
	_angular_speed = 0.0
	_ready = true


func clear() -> void:
	_ready = false
	_linear_velocity = Vector3.ZERO
	_angular_speed = 0.0


func sample(target: Transform3D, delta: float, mass_kg: float = 1.0, strength: float = 1.0) -> Transform3D:
	if not _ready or not is_finite(delta) or delta <= 0.0 or delta > MAX_SAMPLE_DELTA:
		reset(target)
		return target
	if strength <= 0.0:
		reset(target)
		return target

	var target_rotation := _rotation(target)
	var previous_rotation := _rotation(_last_target)
	var target_shift := target.origin.distance_to(_last_target.origin)
	var target_turn := previous_rotation.angle_to(target_rotation)
	if target_shift >= SNAP_DISTANCE or target_turn >= SNAP_ANGLE:
		reset(target)
		return target

	var estimate_alpha := _alpha(SPEED_ESTIMATE_HZ, delta)
	_linear_velocity = _linear_velocity.lerp((target.origin - _last_target.origin) / delta, estimate_alpha)
	_angular_speed = lerpf(_angular_speed, target_turn / delta, estimate_alpha)
	_last_target = target

	var weight := clampf(strength, 0.0, 1.0)
	var mass_factor := 1.0 / (1.0 + 0.12 * (clampf(mass_kg, 0.1, 20.0) - 1.0))
	var quiet_cutoff := BASE_CUTOFF_HZ * mass_factor / weight
	var position_cutoff := minf(MOTION_CUTOFF_HZ, quiet_cutoff + POSITION_CUTOFF_GAIN * maxf(0.0, _linear_velocity.length() - POSITION_SPEED_FLOOR))
	var rotation_cutoff := minf(MOTION_CUTOFF_HZ, quiet_cutoff + ANGULAR_CUTOFF_GAIN * maxf(0.0, _angular_speed - ANGULAR_SPEED_FLOOR))
	var position := _pose.origin.lerp(target.origin, _alpha(position_cutoff, delta))
	var positional_error := target.origin - position
	var position_limit := MAX_POSITION_LAG * weight
	if positional_error.length() > position_limit:
		position = target.origin - positional_error.normalized() * position_limit

	var orientation := _rotation(_pose).slerp(target_rotation, _alpha(rotation_cutoff, delta))
	var angular_error := orientation.angle_to(target_rotation)
	var angular_limit := MAX_ANGULAR_LAG * weight
	if angular_error > angular_limit:
		orientation = target_rotation.slerp(orientation, angular_limit / angular_error)

	# Reapply this frame's input scale, including nonuniform scale. It is never
	# low-passed or allowed to leak into quaternion interpolation.
	_pose = Transform3D(Basis(orientation).scaled(target.basis.get_scale()), position)
	return _pose


func _rotation(pose: Transform3D) -> Quaternion:
	return pose.basis.orthonormalized().get_rotation_quaternion()


func _alpha(cutoff_hz: float, delta: float) -> float:
	return 1.0 - exp(-TAU * cutoff_hz * delta)
