extends Node3D
## Little Wing: small original butterfly fairy; no imported character/IP or overlay pings.
## Faces -Z (the avatar's forward). All geometry is unlit/emissive, shadowless, on BODY_LAYER.
var wings=[]
var limbs=[]
var dust:MultiMeshInstance3D
var motes=[]
var slot=0
var clock=0.0
var core:MeshInstance3D
var orbit_motes=[]
var lower_wings=[]
var head:Node3D
var antennae=[]
var body:Node3D
var _mats={}
var _bead_mesh:SphereMesh
const BODY_LAYER=1<<19
const COLORS=[Color("80eee5"),Color("ff987a"),Color("ffc75c"),Color("c9a0ff")]
const WING_TEXTURE="res://assets/fairy/fairy-wings.png"
const DUST_COUNT=96
# Texture is the left wing pair: 512x1024, wing root at uv (0.99,0.585).
const WING_ROOT_V=.585
const WING_SPAN=.20
const WING_HEIGHT=.40

const WING_SHADER="shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_mix;
uniform sampler2D wing_tex:source_color, filter_linear_mipmap, repeat_disable;
uniform bool has_tex=true;
uniform float lower=0.0;
void fragment(){
	vec4 c;
	if(has_tex){ c=texture(wing_tex,UV); }
	else {
		// Fallback teardrop if the texture is missing.
		vec2 p=vec2(1.0-UV.x,abs(UV.y-0.585)/(lower>0.5?0.415:0.585));
		float d=length((p-vec2(0.5,0.5))*vec2(1.0,1.15));
		c=vec4(mix(vec3(0.35,0.62,1.0),vec3(0.82,0.95,1.0),smoothstep(0.3,0.5,d)),smoothstep(0.52,0.46,d));
	}
	float fres=pow(1.0-abs(dot(NORMAL,VIEW)),2.0);
	float sweep=0.5+0.5*sin(UV.y*14.0+UV.x*6.0-TIME*2.2);
	vec3 col=c.rgb*(1.05+0.25*sweep)+vec3(0.35,0.28,0.55)*fres*0.6;
	ALBEDO=col;
	ALPHA=c.a*(0.78+0.18*fres);
}"

const PEARL_SHADER="shader_type spatial; render_mode unshaded;
uniform vec3 deep=vec3(0.10,0.48,0.98); uniform vec3 rim_col=vec3(0.80,0.97,1.0);
void fragment(){ float rim=pow(1.0-max(dot(NORMAL,VIEW),0.0),2.0); ALBEDO=mix(deep,rim_col,rim)*(1.1+0.35*sin(TIME*2.1)); }"

# Translucent mantle/gown: rim-lit silk that fades to mist toward the hem (UV.y=1).
const GOWN_SHADER="shader_type spatial; render_mode unshaded, cull_disabled, depth_draw_never, blend_mix, shadows_disabled;
uniform vec3 top_col=vec3(0.55,0.80,1.0); uniform vec3 hem_col=vec3(0.30,0.45,1.0); uniform float opacity=0.8;
void fragment(){ float rim=pow(1.0-abs(dot(NORMAL,VIEW)),1.6); float ripple=0.5+0.5*sin(UV.x*18.85+UV.y*7.0-TIME*1.6);
vec3 c=mix(top_col,hem_col,UV.y)*(1.0+0.25*ripple)+vec3(0.55,0.75,1.0)*rim*0.8;
ALBEDO=c; ALPHA=clamp(opacity*(1.0-smoothstep(0.35,1.0,UV.y)*0.85)*(0.55+0.45*rim),0.0,1.0); }"

# Per-eye camera-facing quad; keeps node scale so MultiMesh instance scale still works.
const BILLBOARD_VERTEX="void vertex(){ float s=length(MODEL_MATRIX[0].xyz); MODELVIEW_MATRIX=VIEW_MATRIX*mat4(INV_VIEW_MATRIX[0]*s,INV_VIEW_MATRIX[1]*s,INV_VIEW_MATRIX[2]*s,MODEL_MATRIX[3]); }"

const HALO_SHADER="shader_type spatial; render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;
%s
void fragment(){ float r=length(UV-vec2(0.5))*2.0; float a=pow(max(0.0,1.0-r),2.6); float pulse=0.85+0.15*sin(TIME*2.1);
ALBEDO=mix(vec3(0.12,0.46,1.0),vec3(0.55,0.85,1.0),pow(max(0.0,1.0-r),6.0)); ALPHA=a*0.7*pulse; }"

const DUST_SHADER="shader_type spatial; render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;
%s
void fragment(){ vec2 p=abs(UV-vec2(0.5))*2.0; float core=pow(max(0.0,1.0-length(p)),2.2);
float star=max(0.0,1.0-p.x*9.0)*max(0.0,1.0-p.y)+max(0.0,1.0-p.y*9.0)*max(0.0,1.0-p.x);
ALBEDO=COLOR.rgb*1.6+vec3(0.25)*core; ALPHA=clamp(core*1.2+star*0.55,0.0,1.0)*COLOR.a; }"

func material(color:Color,glow=0.0)->StandardMaterial3D:
	var key=str(color.to_html(),glow)
	if _mats.has(key): return _mats[key]
	var m=StandardMaterial3D.new(); m.albedo_color=color; m.roughness=.4
	if glow>0: m.emission_enabled=true; m.emission=color; m.emission_energy_multiplier=glow
	_mats[key]=m
	return m

func bead(parent,pos:Vector3,size:Vector3,color:Color,glow=0.0)->MeshInstance3D:
	if _bead_mesh==null: _bead_mesh=SphereMesh.new(); _bead_mesh.radial_segments=12; _bead_mesh.rings=6; _bead_mesh.radius=.5; _bead_mesh.height=1
	var n=MeshInstance3D.new(); n.mesh=_bead_mesh
	n.material_override=material(color,glow); parent.add_child(n); n.position=pos; n.scale=size; n.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return n

func line(parent,a:Vector3,b:Vector3,radius:float,color:Color,glow=0.0):
	var n=MeshInstance3D.new(); var mesh=CylinderMesh.new(); mesh.top_radius=radius; mesh.bottom_radius=radius; mesh.height=a.distance_to(b); mesh.radial_segments=6
	n.mesh=mesh; n.material_override=material(color,glow); parent.add_child(n); n.position=(a+b)*.5
	var up=(b-a).normalized(); var right=up.cross(Vector3.FORWARD).normalized()
	if right.length()<.01: right=Vector3.RIGHT
	n.basis=Basis(right,up,right.cross(up)); n.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return n

func _unlit(color:Color)->StandardMaterial3D:
	var key="u"+color.to_html()
	if _mats.has(key): return _mats[key]
	var m=StandardMaterial3D.new(); m.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED; m.albedo_color=color
	_mats[key]=m
	return m

func _dot(parent,pos:Vector3,size:Vector3,color:Color)->MeshInstance3D:
	var n=bead(parent,pos,size,color); n.material_override=_unlit(color); return n

# Surface of revolution around +Y. profile: [Vector2(radius,y)...] top to bottom.
# petals>0 scallops the lower edge into soft petal tips.
func _lathe(profile:Array,segs:int,petals:=0,petal_depth:=0.0)->ArrayMesh:
	var st=SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rows=profile.size()
	for r in range(rows):
		var t=float(r)/(rows-1)
		for c in range(segs+1):
			var a=TAU*c/segs
			var p:Vector2=profile[r]; var rad=p.x; var y=p.y
			if petals>0:
				var lobe=pow(absf(cos(a*petals*.5)),1.5)
				rad*=1.0+lobe*petal_depth*t*t
				y-=lobe*petal_depth*.35*t*t*t
			var dir=Vector3(sin(a),0,cos(a))
			st.set_uv(Vector2(float(c)/segs,t)); st.set_normal(dir)
			st.add_vertex(dir*rad+Vector3(0,y,0))
	for r in range(rows-1):
		for c in range(segs):
			var i=r*(segs+1)+c
			for k in [i,i+1,i+segs+1,i+1,i+segs+2,i+segs+1]: st.add_index(k)
	return st.commit()

# Tapered limb segment from a (radius ra) to b (radius rb).
func _taper(parent,a:Vector3,b:Vector3,ra:float,rb:float,color:Color,glow=0.0)->MeshInstance3D:
	var n=line(parent,a,b,ra,color,glow)
	var mesh:CylinderMesh=n.mesh; mesh.bottom_radius=ra; mesh.top_radius=rb; mesh.rings=1
	return n

# Gently cambered, textured membrane: u=1 is the root, v spans the source region.
func _wing_mesh(side:int,v0:float,v1:float)->ArrayMesh:
	var st=SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var cols=7; var rows=7
	for r in range(rows+1):
		for c in range(cols+1):
			var u=float(c)/cols; var v=lerpf(v0,v1,float(r)/rows)
			var x=(1.0-u)*WING_SPAN; var y=(WING_ROOT_V-v)*WING_HEIGHT
			var reach=sqrt(x*x+y*y)
			st.set_uv(Vector2(u,v)); st.set_normal(Vector3(0,0,-1))
			# Cup backwards and curl the outer edge like a real membrane.
			st.add_vertex(Vector3(-side*x,y,reach*reach*1.4+x*.08))
	for r in range(rows):
		for c in range(cols):
			var i=r*(cols+1)+c
			for k in [i,i+cols+1,i+1,i+1,i+cols+1,i+cols+2]: st.add_index(k)
	return st.commit()

func setup():
	var tex=load(WING_TEXTURE) if ResourceLoader.exists(WING_TEXTURE) else null
	body=Node3D.new(); add_child(body)
	# Slender sculpted pearl torso (neck->bodice->waist->hips); still the brightest read at distance.
	core=MeshInstance3D.new()
	core.mesh=_lathe([Vector2(.004,.058),Vector2(.006,.052),Vector2(.013,.046),Vector2(.018,.036),Vector2(.016,.024),Vector2(.0105,.008),Vector2(.0095,-.004),Vector2(.014,-.018),Vector2(.013,-.03),Vector2(.004,-.036)],14)
	core.scale=Vector3(1,1,.8); core.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var pearl=ShaderMaterial.new(); pearl.shader=Shader.new(); pearl.shader.code=PEARL_SHADER; core.material_override=pearl; body.add_child(core)
	# Layered petal gown: an inner silk bell and a sheer outer mantle, both misting out at the hem.
	var gown_shader=Shader.new(); gown_shader.code=GOWN_SHADER
	var layers=[[[Vector2(.011,.004),Vector2(.016,-.02),Vector2(.024,-.05),Vector2(.034,-.08),Vector2(.044,-.11)],5,.45,Vector3(.62,.86,1.0),Vector3(.22,.42,1.0),.85,0.0],
		[[Vector2(.015,.044),Vector2(.02,.02),Vector2(.026,-.015),Vector2(.036,-.05),Vector2(.05,-.085)],4,.55,Vector3(.75,.92,1.0),Vector3(.45,.35,1.0),.38,.4]]
	for L in layers:
		var g=MeshInstance3D.new(); g.mesh=_lathe(L[0],24,L[1],L[2]); g.rotation.y=L[6]; g.scale=Vector3(1,1,.85)
		var gm=ShaderMaterial.new(); gm.shader=gown_shader
		gm.set_shader_parameter("top_col",L[3]); gm.set_shader_parameter("hem_col",L[4]); gm.set_shader_parameter("opacity",L[5])
		g.material_override=gm; g.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; body.add_child(g)
	_taper(body,Vector3(0,.05,0),Vector3(0,.068,-.002),.0048,.004,Color("e8f2ff"),.9)  # neck
	# Head: small, oval, fine-featured; hair swept back into a trailing luminous wisp.
	head=Node3D.new(); head.position=Vector3(0,.08,-.002); body.add_child(head)
	bead(head,Vector3.ZERO,Vector3(.036,.045,.038),Color("f3ecff"),.9)
	bead(head,Vector3(0,.009,.006),Vector3(.04,.042,.042),Color("9ccaff"),1.0)  # hair cap
	bead(head,Vector3(0,.012,.024),Vector3(.026,.03,.036),Color("b9dcff"),1.1)  # swept-back knot
	_taper(head,Vector3(0,.01,.034),Vector3(0,-.03,.05),.007,.0025,Color("a8d4ff"),1.6)  # trailing wisp
	_taper(head,Vector3(0,-.03,.05),Vector3(0,-.07,.052),.0025,.0006,Color("d0ecff"),2.0)
	for s in [-1,1]:
		_dot(head,Vector3(s*.0085,-.001,-.0175),Vector3(.0075,.0055,.003),Color("16204a"))  # almond eyes
		_dot(head,Vector3(s*.0075,.0005,-.019),Vector3(.0025,.0025,.0015),Color("ffffff"))  # sparkle
	_dot(head,Vector3(0,-.013,-.0175),Vector3(.004,.0015,.0015),Color("c87a98"))  # faint smile
	# Fine antennae sweeping up and back, with small glowing tips.
	for s in [-1,1]:
		var ant=Node3D.new(); ant.position=Vector3(s*.006,.018,-.006); head.add_child(ant); antennae.append(ant)
		_taper(ant,Vector3.ZERO,Vector3(s*.012,.03,.008),.0012,.0006,Color("cfe9ff"),1.0)
		_taper(ant,Vector3(s*.012,.03,.008),Vector3(s*.02,.046,.02),.0006,.0004,Color("cfe9ff"),1.2)
		bead(ant,Vector3(s*.02,.046,.02),Vector3.ONE*.0055,Color("fff2b0"),2.6)
	# Fine luminous limbs (animate with strain): tapered, no bead hands/feet.
	for s in [-1,1]:
		var arm=Node3D.new(); arm.position=Vector3(s*.017,.04,0); body.add_child(arm); limbs.append(arm)
		_taper(arm,Vector3.ZERO,Vector3(s*.012,-.026,-.004),.0034,.0024,Color("e6f0ff"),1.0)
		_taper(arm,Vector3(s*.012,-.026,-.004),Vector3(s*.016,-.05,-.014),.0024,.0008,Color("e6f0ff"),1.2)
		bead(arm,Vector3(s*.016,-.051,-.015),Vector3.ONE*.004,Color("fff6d0"),2.4)  # fingertip spark
		var leg=Node3D.new(); leg.position=Vector3(s*.006,-.03,0); body.add_child(leg); limbs.append(leg)
		_taper(leg,Vector3.ZERO,Vector3(s*.003,-.07,.004),.0045,.0025,Color("dcebff"),.9)
		_taper(leg,Vector3(s*.003,-.07,.004),Vector3(s*.002,-.1,.012),.0025,.0007,Color("dcebff"),1.1)  # pointed toe
	for i in range(3): orbit_motes.append(bead(self,Vector3.ZERO,Vector3.ONE*.006,Color("e0f4ff"),2.4))
	# Soft blue halo, billboarded per eye.
	var halo=MeshInstance3D.new(); var quad=QuadMesh.new(); quad.size=Vector2(.5,.5); halo.mesh=quad
	var glow=ShaderMaterial.new(); glow.shader=Shader.new(); glow.shader.code=HALO_SHADER%BILLBOARD_VERTEX
	halo.material_override=glow; add_child(halo); halo.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# Wings: textured translucent membranes, upper and lower hinge separately.
	var wing_shader=Shader.new(); wing_shader.code=WING_SHADER
	for side in [-1,1]:
		var wing=Node3D.new(); wing.position=Vector3(side*.012,.02,.03); add_child(wing); wings.append(wing)
		for lower in [false,true]:
			var hinge=Node3D.new(); wing.add_child(hinge)
			if lower: lower_wings.append(hinge)
			var membrane=MeshInstance3D.new(); membrane.mesh=_wing_mesh(side,.585 if lower else .0,1.0 if lower else .6)
			var silk=ShaderMaterial.new(); silk.shader=wing_shader
			silk.set_shader_parameter("has_tex",tex!=null); silk.set_shader_parameter("lower",1.0 if lower else 0.0)
			if tex: silk.set_shader_parameter("wing_tex",tex)
			silk.render_priority=-1 if lower else 0
			membrane.material_override=silk; membrane.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			hinge.add_child(membrane)
	for n in find_children("*","MeshInstance3D",true,false): n.layers=BODY_LAYER

func setup_dust(parent):
	dust=MultiMeshInstance3D.new(); parent.add_child(dust); dust.multimesh=MultiMesh.new(); dust.multimesh.transform_format=MultiMesh.TRANSFORM_3D; dust.multimesh.use_colors=true
	var mesh=QuadMesh.new(); mesh.size=Vector2(2.2,2.2)
	dust.multimesh.mesh=mesh; dust.multimesh.instance_count=DUST_COUNT
	var m=ShaderMaterial.new(); m.shader=Shader.new(); m.shader.code=DUST_SHADER%BILLBOARD_VERTEX
	dust.material_override=m; dust.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# Dust lives in world space; keep culling from dropping it when the origin is off-screen.
	dust.custom_aabb=AABB(Vector3(-5000,-5000,-5000),Vector3(10000,10000,10000))
	for i in range(DUST_COUNT): motes.append({"life":0.0,"pos":Vector3.ZERO,"velocity":Vector3.ZERO,"max":1.0}); dust.multimesh.set_instance_transform(i,Transform3D(Basis.IDENTITY.scaled(Vector3.ONE*.0001),Vector3.ZERO))

func sprinkle(pos:Vector3,velocity=Vector3.ZERO,color=Color("ffe7b3"),life=1.0):
	var m=motes[slot]; m.life=life; m.pos=pos; m.velocity=velocity; m.max=maxf(life,.01)
	dust.multimesh.set_instance_color(slot,color); slot=(slot+1)%DUST_COUNT

func burst(pos:Vector3,color:Color):
	for i in range(26): sprinkle(pos,Vector3(sin(i*2.4),cos(i*1.6)+.35,cos(i*2.4))*1.3,color,1.3)

func animate(dt:float,strain:float,perched:bool):
	clock+=dt
	var rate=9.0 if perched else 35.0+strain*20.0
	var flap=sin(clock*rate)
	var lag=sin(clock*rate-.7)
	var amp=.14 if perched else .62
	# Joyful bob & sway; head counter-tilts so the face stays readable.
	if is_instance_valid(body):
		body.position.y=.006*sin(clock*2.2) if perched else .01*sin(clock*rate)
		body.rotation.z=.12*sin(clock*1.7)
		head.rotation.z=-.16*sin(clock*1.7+.4)
		head.rotation.x=.08*sin(clock*2.3)
	if is_instance_valid(core): core.scale=Vector3(1,1,.8)*(1+.03*sin(clock*2.1))
	for i in range(orbit_motes.size()):
		var a=clock*1.3+i*TAU/3
		orbit_motes[i].position=Vector3(cos(a)*.085,sin(a*1.4)*.05+.01,sin(a)*.085)
	for i in range(wings.size()):
		var s=1 if i==0 else -1
		wings[i].rotation.y=s*(.3+flap*amp)
		wings[i].rotation.z=s*(.08*flap)
		if i<lower_wings.size(): lower_wings[i].rotation.y=s*(lag-flap)*amp*.35
	for i in range(antennae.size()): antennae[i].rotation.z=(.18 if i==0 else -.18)*sin(clock*4.0+i)+flap*.05
	for i in range(limbs.size()): limbs[i].rotation.x=strain*1.3+.12*sin(clock*2.6+i)
	for i in range(motes.size()):
		var m=motes[i]
		if m.life<=0.0: continue
		m.life=maxf(0,m.life-dt); m.pos+=m.velocity*dt; m.velocity.y-=dt*.22; m.velocity*=1.0-dt*.6
		var t=m.life/m.max
		var s=maxf(.0001,minf(1,m.life*1.5)*.012*(.8+.35*sin(clock*18.0+i)))
		if t<=0.0: s=.0001
		dust.multimesh.set_instance_transform(i,Transform3D(Basis.IDENTITY.scaled(Vector3.ONE*s),m.pos))

func marker(parent,pos:Vector3,normal:Vector3,kind:int)->Node3D:
	var root=Node3D.new(); parent.add_child(root); root.global_position=pos+normal*.012
	var y=normal.normalized(); var x=y.cross(Vector3.FORWARD).normalized()
	if x.length()<.01: x=Vector3.RIGHT
	root.global_basis=Basis(x,y,x.cross(y))
	var color=COLORS[kind%4]
	bead(root,Vector3.ZERO,Vector3(.22,.018,.22),color,.8)
	line(root,Vector3.ZERO,Vector3.UP*.38,.004,color,1.5)
	for i in range(kind+2):
		var angle=TAU*i/float(kind+2)
		bead(root,Vector3(cos(angle)*.075,.09+kind*.025,sin(angle)*.075),Vector3(.024,.012,.04),color,1)
	preload("res://workshop_art.gd").bake(root)
	return root
