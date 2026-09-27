extends Node3D
## Bounded, reusable smoke puffs: no accumulating particles or gameplay collisions.
const PUFFS=16
const LIFETIME=7.0
var clock=0.0
var puffs=[]
var motes=[]
var ember:StandardMaterial3D

func _ready():
	var mesh=SphereMesh.new()
	mesh.radial_segments=10
	mesh.rings=5
	mesh.radius=0.5
	mesh.height=1.0
	for i in range(PUFFS):
		var puff=MeshInstance3D.new()
		puff.mesh=mesh
		puff.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var material=StandardMaterial3D.new()
		material.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
		material.albedo_color=Color(0.33,0.37,0.38,0)
		material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
		puff.material_override=material
		add_child(puff)
		puffs.append(puff)

	for i in range(6):
		var mote=WorkshopScene.ball(self,Vector3.ZERO,Vector3.ONE*0.018,WorkshopScene.material("f5bf66",0,0.8,1.5))
		mote.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		motes.append(mote)

func _process(delta):
	if not is_visible_in_tree(): return
	clock+=delta
	for i in range(puffs.size()):
		var t=fposmod(clock/LIFETIME+float(i)/PUFFS,1.0)
		var puff=puffs[i]
		puff.position=Vector3(t*0.85+sin(t*6+i)*0.09,t*3.5,cos(t*5+i)*0.10)
		puff.scale=Vector3.ONE*lerpf(0.30,1.1,t)
		puff.material_override.albedo_color.a=sin(PI*t)*0.42*(1.0-t)
	for i in range(motes.size()):
		var t=fposmod(clock/2.8+float(i)/6.0,1.0)
		motes[i].position=Vector3(sin(i*2.4+t*3)*0.20,-5.7+t*0.65,0.48+cos(i)*0.12)
		motes[i].scale=Vector3.ONE*sin(PI*t)
	if ember!=null:
		ember.emission_energy_multiplier=2.0+0.12*sin(clock*5.3)+0.07*sin(clock*11.1)
