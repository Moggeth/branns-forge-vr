extends SceneTree

const Filter = preload("res://held_pose_filter.gd")
const RATES := [72, 90, 120, 144]
var failures: Array[String] = []
var checks := 0
var metrics := {}


func _initialize() -> void:
	_run.call_deferred()


func _check(condition: bool, label: String) -> void:
	checks += 1
	if not condition:
		failures.append(label)


func _pose(position: Vector3, angle: float = 0.0, scale: Vector3 = Vector3.ONE) -> Transform3D:
	return Transform3D(Basis(Quaternion(Vector3.UP, angle)).scaled(scale), position)


func _run() -> void:
	for rate in RATES:
		var dt := 1.0 / float(rate)
		var filter = Filter.new()
		var still := _pose(Vector3.ZERO)
		_check(filter.sample(still, dt).is_equal_approx(still), "%d Hz first sample exact" % rate)
		var raw_position_energy := 0.0
		var filtered_position_energy := 0.0
		var raw_angle_energy := 0.0
		var filtered_angle_energy := 0.0
		for frame in range(rate * 3):
			var time := float(frame) * dt
			var jitter := 0.0011 * sin(TAU * 37.0 * time) + 0.00035 * sin(TAU * 31.0 * time + 0.7)
			var angle := deg_to_rad(0.12) * sin(TAU * 34.0 * time)
			var input := _pose(Vector3(jitter, 0, 0), angle)
			var output: Transform3D = filter.sample(input, dt)
			if frame >= rate:
				raw_position_energy += jitter * jitter
				filtered_position_energy += output.origin.x * output.origin.x
				raw_angle_energy += angle * angle
				filtered_angle_energy += Quaternion.IDENTITY.angle_to(output.basis.get_rotation_quaternion()) ** 2
		var positional_ratio := sqrt(filtered_position_energy / raw_position_energy)
		var angular_ratio := sqrt(filtered_angle_energy / raw_angle_energy)
		_check(positional_ratio < 0.55, "%d Hz positional jitter RMS" % rate)
		_check(angular_ratio < 0.60, "%d Hz angular jitter RMS" % rate)

		filter.reset(still)
		var ramp_error := 0.0
		var turn_error := 0.0
		for frame in range(rate / 2):
			var time := float(frame + 1) * dt
			var target := _pose(Vector3(time * 1.2, 0, 0), time * 3.0)
			var result: Transform3D = filter.sample(target, dt)
			ramp_error = maxf(ramp_error, result.origin.distance_to(target.origin))
			turn_error = maxf(turn_error, result.basis.get_rotation_quaternion().angle_to(target.basis.get_rotation_quaternion()))
		_check(ramp_error <= 0.00601, "%d Hz swing lag" % rate)
		_check(turn_error <= deg_to_rad(0.801), "%d Hz rotational swing lag" % rate)
		filter.reset(still)
		var step := _pose(Vector3(0.25, 0, 0), deg_to_rad(40.0))
		var step_out: Transform3D = filter.sample(step, dt)
		var step_angle_error := rad_to_deg(step_out.basis.get_rotation_quaternion().angle_to(step.basis.get_rotation_quaternion()))
		_check(step_out.origin.distance_to(step.origin) <= 0.00601, "%d Hz sub-recenter step responds immediately" % rate)
		_check(step_angle_error <= 0.81, "%d Hz sub-recenter turn responds immediately (%.3f deg)" % [rate, step_angle_error])
		filter.reset(_pose(Vector3(0.6, 0, 0), 1.5))
		var sudden := _pose(Vector3(0.7, 0, 0), 1.7)
		var sudden_out: Transform3D = filter.sample(sudden, dt)
		_check(sudden_out.origin.distance_to(sudden.origin) <= 0.00601, "%d Hz sudden move same-frame" % rate)
		_check(sudden_out.basis.get_rotation_quaternion().angle_to(sudden.basis.get_rotation_quaternion()) <= deg_to_rad(0.801), "%d Hz sudden turn same-frame" % rate)
		for frame in range(rate):
			sudden_out = filter.sample(sudden, dt)
		_check(sudden_out.origin.distance_to(sudden.origin) < 0.0001, "%d Hz convergence" % rate)

		var light = Filter.new()
		var heavy = Filter.new()
		light.reset(still)
		heavy.reset(still)
		var light_error := 0.0
		var heavy_error := 0.0
		for frame in range(rate / 2):
			var slow := _pose(Vector3(float(frame + 1) * dt * 0.08, 0, 0))
			light_error = slow.origin.distance_to(light.sample(slow, dt, 1.0).origin)
			heavy_error = slow.origin.distance_to(heavy.sample(slow, dt, 4.0).origin)
		_check(heavy_error > light_error * 1.12 and heavy_error < light_error * 1.6, "%d Hz mass has modest effect" % rate)

		var scaled := _pose(Vector3(0.04, 0.02, 0.01), 0.2, Vector3(1.2, 0.7, 1.5))
		var scaled_out: Transform3D = filter.sample(scaled, dt)
		_check(scaled_out.basis.get_scale().is_equal_approx(scaled.basis.get_scale()), "%d Hz scale preserved" % rate)
		_check(filter.sample(scaled, dt, 1.0, 0.0).is_equal_approx(scaled), "%d Hz zero strength exact" % rate)
		var teleport := _pose(Vector3(2.0, 0, 0), 0.9)
		_check(filter.sample(teleport, dt).is_equal_approx(teleport), "%d Hz teleport snaps" % rate)
		var recenter := _pose(Vector3(2.0, 0, 0), 2.0)
		_check(filter.sample(recenter, dt).is_equal_approx(recenter), "%d Hz recenter snaps" % rate)
		filter.clear()
		_check(filter.sample(still, dt).is_equal_approx(still), "%d Hz clear resets" % rate)
		_check(filter.sample(teleport, 0.0).is_equal_approx(teleport), "%d Hz invalid delta snaps" % rate)
		_check(filter.sample(still, NAN).is_equal_approx(still), "%d Hz nonfinite delta snaps" % rate)
		_check(filter.sample(still, 0.2).is_equal_approx(still), "%d Hz hitch snaps" % rate)

		# Quaternion q and -q represent one orientation. Passing through +/-PI
		# must take the short arc and never trigger a false recenter.
		var near_positive := _pose(Vector3.ZERO, PI - 0.01)
		var near_negative := _pose(Vector3.ZERO, -PI + 0.01)
		filter.reset(near_positive)
		var crossing: Transform3D = filter.sample(near_negative, dt)
		_check(crossing.basis.get_rotation_quaternion().angle_to(near_negative.basis.get_rotation_quaternion()) < deg_to_rad(0.81), "%d Hz quaternion sign crossing" % rate)
		metrics[str(rate)] = {"jitter_rms_ratio": snappedf(positional_ratio, 0.001), "angular_rms_ratio": snappedf(angular_ratio, 0.001), "swing_lag_mm": snappedf(ramp_error * 1000.0, 0.01), "swing_lag_deg": snappedf(rad_to_deg(turn_error), 0.01), "slow_light_mm": snappedf(light_error * 1000.0, 0.01), "slow_heavy_mm": snappedf(heavy_error * 1000.0, 0.01)}

	var benchmark = Filter.new()
	benchmark.reset(_pose(Vector3.ZERO))
	var start := Time.get_ticks_usec()
	for index in range(20000):
		var x := float(index) * 0.00001
		benchmark.sample(_pose(Vector3(x, 0, 0), x), 1.0 / 90.0)
	metrics["benchmark_us_per_sample"] = snappedf(float(Time.get_ticks_usec() - start) / 20000.0, 0.01)
	print("HELD_POSE_FILTER_RESULT ", JSON.stringify({"checks": checks, "failures": failures, "metrics": metrics}))
	quit(0 if failures.is_empty() else 1)
