extends Node3D
## The chimney draws a fixed set of softly animated billboards in one batch.
const PUFFS := 16
const LIFETIME := 7.0
var clock := 0.0
var plume := MultiMesh.new()
var motes: Array[MeshInstance3D] = []

func _ready() -> void:
	var quad := QuadMesh.new()
	quad.size = Vector2.ONE
	plume.transform_format = MultiMesh.TRANSFORM_3D
	plume.use_custom_data = true
	plume.mesh = quad
	plume.instance_count = PUFFS
	var surface := ShaderMaterial.new()
	surface.shader = preload("res://assets/smithy/grounds/chimney_smoke.gdshader")
	var smoke := MultiMeshInstance3D.new()
	smoke.multimesh = plume
	smoke.material_override = surface
	smoke.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	smoke.custom_aabb = AABB(Vector3(-1,-1,-1.5),Vector3(5,6,3))
	add_child(smoke)
	var ember := WorkshopScene.material("f5bf66",0,0.8,1.5)
	for i in 6:
		var mote := WorkshopScene.ball(self,Vector3.ZERO,Vector3.ONE*0.018,ember)
		mote.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		motes.append(mote)
	_process(0.0)

func _process(delta: float) -> void:
	if not is_visible_in_tree(): return
	clock += delta
	for i in PUFFS:
		var age := fposmod(clock/LIFETIME + float(i)/PUFFS, 1.0)
		var pos := Vector3(age*1.3+sin(age*6+i)*0.12, age*3.6, cos(age*5+i)*0.13)
		var size := lerpf(0.43,1.55,age)
		plume.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ONE*size),pos))
		plume.set_instance_custom_data(i, Color(float(i)/PUFFS,age,0,1))
	for i in motes.size():
		var age := fposmod(clock/2.8+float(i)/motes.size(),1.0)
		motes[i].position = Vector3(sin(i*2.4+age*3)*0.20, -6.85+age*0.65, 0.48+cos(i)*0.12)
		motes[i].scale = Vector3.ONE*0.018*sin(PI*age)
