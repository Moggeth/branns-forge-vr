extends Node3D
## Local, bounded weather sandbox. No gameplay state, progression or network access.
const N=64
const CELL=0.375
const MAX_POTION_EQUIVALENTS=40
const FUEL_PER_POTION=8.0
const MAX_FLYING_POTIONS=40
var spill_burn_seconds=8.0
var unlit_evaporation_rate=.002/(1.5*1.5)
var burn_age=PackedFloat32Array()
var spill_notice=""
var spill_notice_until=0.0
var ORIGIN=Vector2(-12,-10)
var native_mode=false
var projectiles=[]
var aiming=false
var aim_lit=true
var marker:MeshInstance3D
var aimed=Vector3.INF
var demo
var hour=16.0
var cycle=false
var cycle_seconds=240.0
var weather="clear"
var automatic=false
var automatic_at=25.0
var elapsed=0.0
var accumulator=0.0
var sound_at=0.0
var muted=false
var heights=PackedFloat32Array()
var snow=PackedFloat32Array()
var wet=PackedFloat32Array()
var fuel=PackedFloat32Array()
var burning=PackedByteArray()
var kinds=[]
var field_image:Image
var field_texture:ImageTexture
var overlay:ShaderMaterial
var overlay_targets=[]
var overlay_attached=true
var rain:MultiMeshInstance3D
var flakes:MultiMeshInstance3D
var stars:MultiMeshInstance3D
var liquid:MultiMeshInstance3D
var flames:MultiMeshInstance3D
var splash:MultiMeshInstance3D
var drops=[]
var rings:MultiMeshInstance3D
var impacts=[]
var rng=RandomNumberGenerator.new()
var sounds={}
var voices=[]
var ambience:AudioStreamPlayer
var fire_light:OmniLight3D
var fire_lights:Array[OmniLight3D]=[]
var light_targets=[]
var light_observer=Vector3.ZERO
var light_clock=0.0
var status:Label
var hour_slider:HSlider
var clock_label:Label
var burned=0.0
var poured=0.0
var evaporated=0.0
var current_snapshot=""
var weather_buttons=[]

func setup(owner_demo,for_game=false,fuel_only=false):
	native_mode=for_game
	demo=owner_demo; rng.seed=1807
	heights.resize(N*N); snow.resize(N*N); wet.resize(N*N); fuel.resize(N*N); burning.resize(N*N); burn_age.resize(N*N)
	heights.fill(.04); snow.fill(0); wet.fill(0); fuel.fill(0); burning.fill(0); kinds.resize(N*N); kinds.fill("stone")
	if not native_mode: make_test_surfaces()
	var start=Time.get_ticks_msec()
	if not native_mode: capture_surfaces()
	print("WEATHER_SURFACES cells=",N*N," scan_ms=",Time.get_ticks_msec()-start)
	field_image=Image.create(N,N,false,Image.FORMAT_RGBAF)
	update_field(); field_texture=ImageTexture.create_from_image(field_image)
	if fuel_only:
		make_fluid_particles()
		return
	make_overlay()
	make_particles()
	make_audio()
	if not native_mode: make_ui()
	set_weather("clear")
	print("WEATHER_READY local_grid=24m cells=4096 particles=bounded fluid=conservative_heightfield")

func make_test_surfaces():
	var w=preload("res://workshop_scene.gd")
	var timber=w.material("795338")
	var steel=w.material("769097",.8,.24)
	var tray=w.box(demo.art,Vector3(-2.9,.85,3.2),Vector3(1.5,.1,1),steel); tray.set_meta("weather_material","metal")
	for x in [-3.5,-2.3]: w.box(demo.art,Vector3(x,.42,3.2),Vector3(.12,.84,.7),timber)
	var roof=w.box(demo.art,Vector3(-5.4,2,3),Vector3(2.0,.13,1.5),timber); roof.rotation.z=.12; roof.set_meta("weather_material","wood")
	for x in [-6.2,-4.6]: w.box(demo.art,Vector3(x,1,3),Vector3(.1,2,.1),timber)

func cell_index(pos:Vector3)->int:
	var x=int(floor((pos.x-ORIGIN.x)/CELL)); var z=int(floor((pos.z-ORIGIN.y)/CELL))
	return z*N+x if x>=0 and z>=0 and x<N and z<N else -1

func point(i:int)->Vector3:
	return Vector3(ORIGIN.x+(i%N+.5)*CELL,heights[i],ORIGIN.y+(floorf(i/float(N))+.5)*CELL)

func capture_surfaces(cooperative=false):
	var budget_start=Time.get_ticks_msec()
	for node in demo.stage.find_children("*","GeometryInstance3D",true,false):
		if cooperative and Time.get_ticks_msec()-budget_start>2:
			await get_tree().process_frame
			budget_start=Time.get_ticks_msec()
		# Menus and zone geometry can be replaced while a cooperative scan yields.
		if not is_instance_valid(node) or not node.is_inside_tree() or not node.is_visible_in_tree(): continue
		if node is MeshInstance3D and node.mesh!=null:
			var m=node.material_override
			if m==null and node.mesh.get_surface_count()>0: m=node.mesh.surface_get_material(0)
			if m is ShaderMaterial or (m is StandardMaterial3D and m.transparency!=BaseMaterial3D.TRANSPARENCY_DISABLED): continue
			raster(node.mesh,node.global_transform,m,str(node.get_meta("weather_material","")))
		elif node is MultiMeshInstance3D and node.multimesh!=null:
			var mesh=node.multimesh.mesh
			if mesh==null: continue
			var mat=node.material_override if node.material_override!=null else mesh.surface_get_material(0)
			if mat is ShaderMaterial: continue
			for i in range(node.multimesh.instance_count): raster(mesh,node.global_transform*node.multimesh.get_instance_transform(i),mat,"")

func raster(mesh:Mesh,transform:Transform3D,mat,forced:String):
	var bounds=transform*mesh.get_aabb()
	if bounds.end.x<ORIGIN.x or bounds.position.x>ORIGIN.x+N*CELL or bounds.end.z<ORIGIN.y or bounds.position.z>ORIGIN.y+N*CELL or bounds.position.y>12: return
	var kind=forced
	if kind.is_empty():
		kind="stone"
		if mat is StandardMaterial3D:
			if mat.metallic>.4: kind="metal"
			elif mat.albedo_color.r>mat.albedo_color.b*1.4: kind="wood"
	var faces=mesh.get_faces()
	for f in range(0,faces.size(),3):
		var a=transform*faces[f]; var b=transform*faces[f+1]; var c=transform*faces[f+2]
		var den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z)
		if absf(den)<.0001: continue
		var x0=clampi(int(floor((minf(a.x,minf(b.x,c.x))-ORIGIN.x)/CELL)),0,N-1)
		var x1=clampi(int(floor((maxf(a.x,maxf(b.x,c.x))-ORIGIN.x)/CELL)),0,N-1)
		var z0=clampi(int(floor((minf(a.z,minf(b.z,c.z))-ORIGIN.y)/CELL)),0,N-1)
		var z1=clampi(int(floor((maxf(a.z,maxf(b.z,c.z))-ORIGIN.y)/CELL)),0,N-1)
		for z in range(z0,z1+1):
			for x in range(x0,x1+1):
				var px=ORIGIN.x+(x+.5)*CELL; var pz=ORIGIN.y+(z+.5)*CELL
				var u=((b.z-c.z)*(px-c.x)+(c.x-b.x)*(pz-c.z))/den
				var v=((c.z-a.z)*(px-c.x)+(a.x-c.x)*(pz-c.z))/den
				if u<0 or v<0 or u+v>1: continue
				var y=u*a.y+v*b.y+(1-u-v)*c.y; var id=z*N+x
				if y>heights[id]: heights[id]=y; kinds[id]=kind

func make_overlay():
	var shader=Shader.new()
	shader.code="""shader_type spatial;
render_mode blend_mix, depth_prepass_alpha;
uniform sampler2D state_map : filter_linear, repeat_disable;
uniform float weather_visible=1.0;
uniform vec2 grid_origin=vec2(-12.,-10.);
varying vec3 world; varying vec3 normal_world;
void vertex(){world=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;normal_world=normalize(MODEL_NORMAL_MATRIX*NORMAL);VERTEX+=NORMAL*.003;}
void fragment(){if(weather_visible<.5)discard;vec2 uv=(world.xz-grid_origin)/24.;if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))discard;vec4 s=texture(state_map,uv);float exposed=1.-smoothstep(.12,.32,abs(world.y-s.r));float up=smoothstep(.35,.85,normal_world.y);float snow=s.g*up*exposed;float wet=s.b*exposed;ALBEDO=mix(vec3(.09,.16,.19),vec3(.89,.94,1.),snow);ROUGHNESS=mix(.16,.84,snow);ALPHA=clamp(snow+wet*.18,0.,.96);if(ALPHA<.025)discard;}
"""
	overlay=ShaderMaterial.new(); overlay.shader=shader; overlay.set_shader_parameter("state_map",field_texture)
	for node in demo.stage.find_children("*","GeometryInstance3D",true,false):
		if node is MeshInstance3D or node is MultiMeshInstance3D:
			if node.material_overlay==null: node.material_overlay=overlay; overlay_targets.append(node)

func instances(mesh:Mesh,count:int,custom=false)->MultiMeshInstance3D:
	var m=MultiMesh.new(); m.transform_format=MultiMesh.TRANSFORM_3D; m.use_custom_data=custom; m.mesh=mesh; m.instance_count=count
	for i in range(count): m.set_instance_transform(i,Transform3D(Basis.IDENTITY.scaled(Vector3.ZERO),Vector3.ZERO))
	var node=MultiMeshInstance3D.new(); node.multimesh=m; node.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; add_child(node); return node

func material(color:String,emission=0.0)->StandardMaterial3D:
	var m=StandardMaterial3D.new(); m.albedo_color=Color(color); m.roughness=.4
	if emission>0: m.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED; m.emission_enabled=true; m.emission=Color(color); m.emission_energy_multiplier=emission
	return m

func make_particles():
	var streak=BoxMesh.new(); streak.size=Vector3(.012,.22,.012); streak.material=material("a9c5d7",.15); rain=instances(streak,480)
	var flake=SphereMesh.new(); flake.radius=.027; flake.height=.04; flake.radial_segments=5; flake.rings=2; flake.material=material("edf5fa",.2); flakes=instances(flake,640)
	var star=SphereMesh.new(); star.radius=.035; star.height=.07; star.radial_segments=5; star.rings=2; star.material=material("d6e3ff",1); stars=instances(star,500)
	for i in range(500):
		var angle=rng.randf()*TAU; var y=rng.randf_range(.1,1); var p=Vector3(cos(angle)*sqrt(1-y*y),y,sin(angle)*sqrt(1-y*y))*70
		stars.multimesh.set_instance_transform(i,Transform3D(Basis.IDENTITY.scaled(Vector3.ONE*rng.randf_range(.45,1.7)),p))
	make_fluid_particles()
	var ring_mesh=TorusMesh.new(); ring_mesh.inner_radius=.075; ring_mesh.outer_radius=.085; ring_mesh.rings=10; ring_mesh.ring_segments=4; ring_mesh.material=material("b0d2df",.1); rings=instances(ring_mesh,48)
	var drop=SphereMesh.new(); drop.radius=.025; drop.height=.05; drop.radial_segments=5; drop.rings=2; drop.material=material("dbac65",.4); splash=instances(drop,96)

func make_fluid_particles():
	# One square tile per occupied cell. Neighbour flags remove inner borders so
	# an oil trail reads as one connected surface, with a broken outer meniscus.
	var puddle=PlaneMesh.new(); puddle.size=Vector2(CELL+.012,CELL+.012)
	var oil_shader=Shader.new()
	oil_shader.code="""shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx, cull_disabled;
varying vec3 world;
varying vec4 joins;
varying vec2 tile_uv;
void vertex(){world=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz; joins=INSTANCE_CUSTOM; tile_uv=UV;}
void fragment(){
 float wave=sin(world.x*8.0+world.z*5.0-TIME*1.35)*.5+sin(world.z*11.0-world.x*3.0+TIME*.8)*.5;
 float curl=sin(world.x*22.0+world.z*17.0+TIME*.45)*sin(world.z*19.0-world.x*13.0-TIME*.35);
 // The border retreats unevenly into each exposed tile. Joined sides remain
 // seamless, while corner cuts keep a connected spill from reading as a grid.
 float margin=.19+.075*curl+.045*wave;
 float edge=1.0;
 edge=min(edge,mix(smoothstep(0.0,margin,tile_uv.x),1.0,joins.r));
 edge=min(edge,mix(smoothstep(0.0,margin,1.0-tile_uv.x),1.0,joins.g));
 edge=min(edge,mix(smoothstep(0.0,margin,tile_uv.y),1.0,joins.b));
 edge=min(edge,mix(smoothstep(0.0,margin,1.0-tile_uv.y),1.0,joins.a));
 edge=min(edge,mix(smoothstep(margin,margin+.23,tile_uv.x+tile_uv.y),1.0,max(joins.r,joins.b)));
 edge=min(edge,mix(smoothstep(margin,margin+.23,1.0-tile_uv.x+tile_uv.y),1.0,max(joins.g,joins.b)));
 edge=min(edge,mix(smoothstep(margin,margin+.23,tile_uv.x+1.0-tile_uv.y),1.0,max(joins.r,joins.a)));
 edge=min(edge,mix(smoothstep(margin,margin+.23,2.0-tile_uv.x-tile_uv.y),1.0,max(joins.g,joins.a)));
 ALPHA=edge; ALPHA_SCISSOR_THRESHOLD=.48;
 vec3 n=normalize(NORMAL);
 NORMAL=normalize(n+mat3(VIEW_MATRIX)*vec3(cos(world.x*8.0+world.z*5.0-TIME*1.35),0.0,sin(world.z*11.0-world.x*3.0+TIME*.8))*.045);
 float grazing=pow(1.0-max(dot(normalize(NORMAL),normalize(VIEW)),0.0),2.5);
 vec3 pearl=mix(vec3(.13,.36,.32),vec3(.40,.23,.35),.5+.5*sin(world.x*2.2+world.z*1.7+TIME*.27));
 float rim=1.0-edge;
 ALBEDO=mix(vec3(.073,.060,.048),pearl,.10+.35*grazing+.08*rim)+wave*.008;
 EMISSION=pearl*(.008+.035*grazing);
 METALLIC=.15; ROUGHNESS=.12+wave*.024; SPECULAR=.82;
}"""
	var oil_material=ShaderMaterial.new(); oil_material.shader=oil_shader; puddle.material=oil_material
	liquid=instances(puddle,N*N,true)
	var flame_shape=SurfaceTool.new(); flame_shape.begin(Mesh.PRIMITIVE_TRIANGLES)
	var radii=[.08,.18,.12,.075,0.0]
	for ring in range(4):
		for segment in range(8):
			var a=segment*TAU/8; var b=(segment+1)*TAU/8
			var v=[Vector3(cos(a)*radii[ring],ring*.17-.325,sin(a)*radii[ring]),Vector3(cos(b)*radii[ring],ring*.17-.325,sin(b)*radii[ring]),Vector3(cos(b)*radii[ring+1],(ring+1)*.17-.325,sin(b)*radii[ring+1]),Vector3(cos(a)*radii[ring+1],(ring+1)*.17-.325,sin(a)*radii[ring+1])]
			for j in [0,1,2,0,2,3]: flame_shape.set_uv(Vector2(.5,(v[j].y+.325)/.68)); flame_shape.add_vertex(v[j])
	flame_shape.generate_normals()
	var flame_shader=Shader.new()
	flame_shader.code="""shader_type spatial;
render_mode unshaded,cull_disabled;
varying float h;
varying float seed;
void vertex(){
 h=UV.y;
 vec2 anchor=MODEL_MATRIX[3].xz;
 seed=fract(sin(dot(anchor,vec2(12.9898,78.233)))*43758.5453);
 float phase=seed*6.283185;
 float flutter=mix(1.0,3.4,step(.66,seed));
 float growth=.65+seed*.65+sin(TIME*(2.2+seed)*flutter+phase)*.10;
 VERTEX.y=(VERTEX.y+.325)*growth-.325;
 VERTEX.xz*=.76+fract(seed*7.17)*.42;
 VERTEX.x+=sin(TIME*(3.1+seed)*flutter+phase+h*2.0)*h*h*.105;
 VERTEX.z+=cos(TIME*2.7*flutter+phase*1.3+h)*h*h*.075;
}
void fragment(){
 float crown=smoothstep(.40,.98,h);
 vec3 ember=mix(vec3(.95,.24,.025),vec3(.64,.035,.004),crown);
 float centre=pow(abs(dot(normalize(NORMAL),normalize(VIEW))),2.0);
 float core=centre*smoothstep(.02,.23,h)*(1.0-smoothstep(.36,.77,h));
 vec3 flame=mix(ember,vec3(1.0,.66,.12),core*.88);
 ALBEDO=flame; EMISSION=flame*.26;
}"""
	var flame_material=ShaderMaterial.new(); flame_material.shader=flame_shader; flame_shape.set_material(flame_material); flames=instances(flame_shape.commit(),N*N)
	flames.extra_cull_margin=.4
	for i in range(3):
		var lamp=OmniLight3D.new(); add_child(lamp)
		lamp.omni_range=5.5; lamp.omni_attenuation=1.35; lamp.light_color=Color("ff9b42")
		lamp.light_energy=0; lamp.shadow_enabled=false
		fire_lights.append(lamp)
	fire_light=fire_lights[0] # Kept for existing field diagnostics.

func make_audio():
	for kind in ["metal","wood","stone","hiss","rain"]:
		var bank=[]
		for variant in range(7 if kind!="rain" else 1):
			var duration=rng.randf_range(.13,.27) if kind!="rain" else 2.0
			var bytes=PackedByteArray(); var count=int(duration*22050); bytes.resize(count*2); var smooth=0.0; var muffled=0.0; var tone=rng.randf_range(850,1900)
			for i in range(count):
				var t=float(i)/22050; var noise=rng.randf_range(-1,1); smooth=lerpf(smooth,noise,.12); muffled=lerpf(muffled,smooth,.075)
				var sample_value=smooth*.7
				if kind=="metal": sample_value=(muffled*.5+sin(t*TAU*tone)*.009*exp(-t*70))*exp(-t*22)
				elif kind=="wood": sample_value=muffled*.6*exp(-t*24)
				elif kind=="stone": sample_value=smooth*.12*exp(-t*38)
				elif kind=="hiss": sample_value=smooth*.22*exp(-t*10)
				if kind!="rain": sample_value*=minf(1,t*180)*minf(1,(duration-t)*80)
				bytes.encode_s16(i*2,int(clampf(sample_value,-1,1)*25000))
			var wav=AudioStreamWAV.new(); wav.format=AudioStreamWAV.FORMAT_16_BITS; wav.mix_rate=22050; wav.data=bytes
			if kind=="rain": wav.loop_mode=AudioStreamWAV.LOOP_FORWARD; wav.loop_end=count
			bank.append(wav)
		sounds[kind]=bank
	for i in range(8):
		var voice=AudioStreamPlayer3D.new(); add_child(voice); voice.max_distance=35; voice.volume_db=-15; voices.append(voice)
	ambience=AudioStreamPlayer.new(); add_child(ambience); ambience.stream=sounds.rain[0]; ambience.volume_db=-25; ambience.play()

func sound(kind:String,pos:Vector3):
	if muted: return
	for voice in voices:
		if voice.playing: continue
		voice.position=pos; voice.stream=sounds[kind][rng.randi_range(0,sounds[kind].size()-1)]; voice.pitch_scale=rng.randf_range(.72,1.13); voice.volume_db=rng.randf_range(-20,-14); voice.play(); return

func set_weather(value:String):
	weather=value; rain.visible=value=="rain"; flakes.visible=value=="snow"
	for b in weather_buttons: b.modulate=Color("e9c88b") if b.text.to_lower()==value else Color.WHITE
	print("WEATHER_MODE ",value)

func spill(pos=Vector3(0,.05,3),lit=true)->float:
	if total_fuel()+FUEL_PER_POTION>MAX_POTION_EQUIVALENTS*FUEL_PER_POTION+.0001:
		spill_notice="40-potion fuel capacity reached; let some burn away."; spill_notice_until=elapsed+4; return 0.0
	var accepted=pour(pos,FUEL_PER_POTION,lit)
	if accepted<=0: return 0.0
	var id=cell_index(pos)
	for i in range(28):
		if drops.size()>=96: break
		var a=rng.randf()*TAU
		drops.append({"p":point(id)+Vector3.UP*.1,"v":Vector3(cos(a),rng.randf_range(1.4,3.2),sin(a))*rng.randf_range(.5,1.8),"life":1.8})
	print("WEATHER_SPILL lit=",lit," total_fuel=",poured)
	return accepted

## Measured units, not bottle count. Rejected/unsupported fuel remains with caller.
func pour(pos:Vector3,amount:float,lit=false)->float:
	if not pos.is_finite() or not is_finite(amount) or amount<=0: return 0.0
	var id=cell_index(pos)
	if id<0: return 0.0
	var accepted=minf(amount,maxf(0,MAX_POTION_EQUIVALENTS*FUEL_PER_POTION-total_fuel()))
	if accepted<=0: return 0.0
	# Throwing below a roof cannot deposit fuel onto the roof above it.
	if heights[id]>pos.y+.7: return 0.0
	var recipients=[]
	for offset in [0,1,-1,N,-N]:
		var j=id+offset
		if j<0 or j>=N*N or (abs(offset)==1 and abs(j%N-id%N)>1) or absf(heights[j]-heights[id])>.4: continue
		recipients.append(j)
	for j in recipients:
		var portion=accepted/recipients.size()
		fuel[j]+=portion; poured+=portion
		if lit and wet[j]<.85:
			if burning[j]==0: burn_age[j]=0
			burning[j]=1
	return accepted

func ignite_near(pos:Vector3,radius:float)->int:
	return touch_near(pos,radius,false)

func extinguish_near(pos:Vector3,radius:float)->int:
	return touch_near(pos,radius,true)

func touch_near(pos:Vector3,radius:float,water:bool)->int:
	if not pos.is_finite() or not is_finite(radius) or radius<=0: return 0
	var center=cell_index(pos)
	if center<0: return 0
	var reach=ceili(minf(radius,24)/CELL); var count=0
	for z in range(maxi(0,int(center/N)-reach),mini(N,int(center/N)+reach+1)):
		for x in range(maxi(0,center%N-reach),mini(N,center%N+reach+1)):
			var i=z*N+x
			if point(i).distance_squared_to(pos)>radius*radius: continue
			if water:
				if burning[i]>0: count+=1
				burning[i]=0; wet[i]=1.0
			elif fuel[i]>.000001 and wet[i]<.85:
				if burning[i]==0: count+=1; burn_age[i]=0
				burning[i]=1
	return count

func simulation(dt):
	var daytime=maxf(0,sin((hour-6)/24.0*TAU))
	# Heat spreads by contact, independent of flow direction or pressure difference.
	var ignition=burning.duplicate()
	for i in range(N*N):
		if burning[i]==0 or fuel[i]<=0 or wet[i]>=.85: continue
		for offset in [-N,-1,1,N]:
			var j=i+offset
			if j<0 or j>=N*N or (abs(offset)==1 and abs(j%N-i%N)>1): continue
			if fuel[j]>.000001 and wet[j]<.85 and absf(heights[i]-heights[j])<=.3:
				if ignition[j]==0: burn_age[j]=burn_age[i]
				ignition[j]=1
	burning=ignition
	for i in range(N*N):
		if weather=="snow": snow[i]=minf(1,snow[i]+dt*.055)
		else: snow[i]=maxf(0,snow[i]-dt*(.045*daytime+(.025 if weather=="rain" else 0)))
		wet[i]=clampf(wet[i]+dt*(.12 if weather=="rain" else -.012-.04*daytime),0,1)
		if fuel[i]<=0: fuel[i]=0; burning[i]=0
		# Conservative local exchange: volume changes only by burning/evaporation.
		for delta in [1,N]:
			var j=i+delta
			if j>=N*N or (delta==1 and i%N==N-1): continue
			if fuel[i]<=0 and fuel[j]<=0: continue
			var difference=(heights[i]+fuel[i]*.06)-(heights[j]+fuel[j]*.06)
			var src=i if difference>0 else j; var dst=j if difference>0 else i
			var mobile=fuel[src]
			var transfer=minf(mobile,minf(fuel[src]*.18,absf(difference)*dt*8))
			fuel[src]-=transfer; fuel[dst]+=transfer
			if burning[src]>0 and transfer>.003 and wet[dst]<.85:
				if burning[dst]==0: burn_age[dst]=burn_age[src]
				burning[dst]=1
		if burning[i]>0:
			if wet[i]>.85: burning[i]=0
			else:
				var used=fuel[i]*minf(1,dt/maxf(.001,spill_burn_seconds-burn_age[i])); burn_age[i]+=dt; fuel[i]-=used; burned+=used; snow[i]=maxf(0,snow[i]-dt*.9)
		else:
			burn_age[i]=0
			var lost=minf(fuel[i],dt*unlit_evaporation_rate); fuel[i]-=lost; evaporated+=lost
	update_field(); field_texture.update(field_image)
	update_fluid_visuals()

func update_field():
	for i in range(N*N): field_image.set_pixel(i%N,int(i/N),Color(heights[i],snow[i],wet[i],float(burning[i])))

func tick(delta):
	elapsed+=delta
	if demo!=null: light_observer=demo.camera.global_position
	tick_fire_lights(delta)
	set_overlay_active(snow[0]+wet[0]>.03)
	if not native_mode: tick_throwing(delta)
	if hour_slider!=null: hour_slider.set_value_no_signal(hour)
	if cycle: hour=fposmod(hour+delta*24/cycle_seconds,24)
	if automatic and elapsed>=automatic_at:
		automatic_at=elapsed+(rng.randf_range(180,360) if native_mode else 35); set_weather(["clear","rain","snow"][rng.randi_range(0,2)])
	accumulator+=delta
	if accumulator>=.1: simulation(minf(accumulator,.2)); accumulator=0
	var daylight=clampf(sin((hour-6)/24.0*TAU)*2.0,0,1)
	var sky=demo.env.sky.sky_material
	sky.sky_top_color=Color("071024").lerp(Color("699abd"),daylight)
	sky.sky_horizon_color=Color("182946").lerp(Color("cfb9a1"),daylight)
	sky.ground_horizon_color=sky.sky_horizon_color
	demo.sun.light_energy=lerpf(.07,1.3,daylight)*(1 if weather=="clear" else .45)
	demo.sun.light_color=Color("9ab7ed").lerp(Color("ffe0ae"),daylight)
	demo.sun.rotation_degrees=Vector3(-maxf(12,daylight*55),-35+(hour-12)*5,0)
	demo.env.ambient_light_color=Color("7191bc").lerp(Color("b6c9d2"),daylight); demo.env.ambient_light_energy=lerpf(.18,.4,daylight)
	demo.env.fog_light_color=sky.sky_horizon_color; demo.env.fog_density=.004 if weather=="clear" else .014
	stars.position=demo.camera.position; stars.visible=daylight<.15 and weather=="clear"
	ambience.volume_db=-80 if weather!="rain" or muted else -25
	var particles=rain if weather=="rain" else flakes
	if weather!="clear":
		for i in range(particles.multimesh.instance_count):
			var x=ORIGIN.x+12+sin(i*83.71)*11.7; var z=ORIGIN.y+12+cos(i*37.51)*11.7
			var id=cell_index(Vector3(x,0,z)); var ground=heights[id] if id>=0 else .04
			var height=ground+.06+fposmod(i*.319-elapsed*(9 if weather=="rain" else .75),maxf(2,12-ground))
			if weather=="snow": x+=sin(elapsed*.7+i)*.08
			particles.multimesh.set_instance_transform(i,Transform3D(Basis.IDENTITY,Vector3(x,height,z)))
	if weather=="rain" and elapsed>sound_at:
		sound_at=elapsed+rng.randf_range(.09,.38)
		var id=rng.randi_range(0,N*N-1)
		if not native_mode and rng.randf()<.25: id=cell_index(Vector3(-2.9,0,3.2)) if rng.randf()<.5 else cell_index(Vector3(-5.4,0,3))
		if rng.randf()<.3:
			for j in range(N*N):
				if burning[j]>0: id=j; break
		sound("hiss" if burning[id]>0 else kinds[id],point(id))
		impacts.append({"p":point(id)+Vector3.UP*.025,"life":.35})
		if impacts.size()>48: impacts.pop_front()
	for d in drops:
		d.v.y-=delta*9.8; d.p+=d.v*delta; d.life-=delta
		var id=cell_index(d.p)
		if id<0 or d.p.y<=heights[id]: d.life=0
	drops=drops.filter(func(d):return d.life>0)
	for i in range(drops.size()): splash.multimesh.set_instance_transform(i,Transform3D(Basis.IDENTITY,drops[i].p))
	splash.multimesh.visible_instance_count=drops.size()
	for impact in impacts: impact.life-=delta
	impacts=impacts.filter(func(hit):return hit.life>0)
	for i in range(impacts.size()):
		var size=1+(1-impacts[i].life/.35)*2
		rings.multimesh.set_instance_transform(i,Transform3D(Basis.IDENTITY.scaled(Vector3(size,.4,size)),impacts[i].p))
	rings.multimesh.visible_instance_count=impacts.size()
	if clock_label!=null: clock_label.text="%02d:%02d · %s"%[int(hour),int(fposmod(hour,1)*60),weather.capitalize()]
	if status!=null: status.text="Snow %d%% · Wetness %d%%
Burning patches %d · Spill patches %d
Fuel %.1f / 40 potions · click to throw"%[int(snow[0]*100),int(wet[0]*100),flames.multimesh.visible_instance_count,liquid.multimesh.visible_instance_count,total_fuel()/FUEL_PER_POTION]

	if status!=null and elapsed<spill_notice_until: status.text+="\n"+spill_notice

func make_ui():
	var layer=CanvasLayer.new(); add_child(layer)
	var panel=PanelContainer.new(); panel.position=Vector2(1030,24); layer.add_child(panel)
	var style=StyleBoxFlat.new(); style.bg_color=Color(.04,.065,.09,.94); style.content_margin_left=16; style.content_margin_right=16; style.content_margin_top=16; style.content_margin_bottom=16; panel.add_theme_stylebox_override("panel",style)
	var col=VBoxContainer.new(); col.add_theme_constant_override("separation",10); panel.add_child(col)
	var title=Label.new(); title.text="WEATHER & WILDFIRE"; title.add_theme_font_size_override("font_size",22); col.add_child(title)
	clock_label=Label.new(); col.add_child(clock_label)
	hour_slider=HSlider.new(); hour_slider.custom_minimum_size.x=325; hour_slider.min_value=0; hour_slider.max_value=23.99; hour_slider.step=.05; hour_slider.value=hour; hour_slider.value_changed.connect(func(v):hour=v); col.add_child(hour_slider)
	var run=CheckButton.new(); run.text="Run day / night (4 minutes)"; run.toggled.connect(func(v):cycle=v); col.add_child(run)
	var row=HBoxContainer.new(); col.add_child(row)
	for mode in ["Clear","Rain","Snow"]:
		var b=Button.new(); b.text=mode; b.pressed.connect(func():set_weather(mode.to_lower())); row.add_child(b); weather_buttons.append(b)
	var auto=CheckButton.new(); auto.text="Weather changes on its own"; auto.toggled.connect(func(v):automatic=v); col.add_child(auto)
	var melt=Button.new(); melt.text="Sunrise & melt"; melt.pressed.connect(func():hour=10; hour_slider.value=10; set_weather("clear")); col.add_child(melt)
	var spill_button=Button.new(); spill_button.text="Aim a lit potion"; spill_button.pressed.connect(func():aiming=true; aim_lit=true); col.add_child(spill_button)
	var oil=Button.new(); oil.text="Aim an unlit potion"; oil.pressed.connect(func():aiming=true; aim_lit=false); col.add_child(oil)
	var focus=Button.new(); focus.text="Look at spill / rain surfaces"; focus.pressed.connect(func():demo.target=Vector3(-1,1,3); demo.distance=7; demo.yaw=.35; demo.pitch=.65); col.add_child(focus)
	var sky_view=Button.new(); sky_view.text="Look at the night sky"; sky_view.pressed.connect(func():hour=0; hour_slider.value=0; set_weather("clear"); demo.target=Vector3(0,7,-4); demo.distance=18; demo.yaw=.2; demo.pitch=-.12); col.add_child(sky_view)
	var samples=HBoxContainer.new(); col.add_child(samples)
	for kind in ["metal","wood","hiss"]:
		var b=Button.new(); b.text="Hear "+kind; b.pressed.connect(func():sound(kind,demo.camera.position-demo.camera.global_basis.z*2)); samples.add_child(b)
	var mute=CheckButton.new(); mute.text="Mute weather sounds"; mute.toggled.connect(func(v):muted=v); col.add_child(mute)
	status=Label.new(); status.add_theme_font_size_override("font_size",13); col.add_child(status)
	var hint=Label.new(); hint.text="Choose a potion, then click a surface to throw.
Right-click cancels aiming.
Snow settles on exposed upper surfaces.
Sun melts it; sustained rain damps fire.
Metal table plinks; timber canopy patters.
Sheltered forge stays dry. Stars after dusk."; hint.add_theme_font_size_override("font_size",13); col.add_child(hint)

func total_fuel()->float:
	var value=0.0
	for volume in fuel: value+=volume
	return value

func checks()->Array:
	var failures=[]
	var metal=cell_index(Vector3(-2.9,0,3.2)); var wood=cell_index(Vector3(-5.4,0,3))
	if kinds[metal]!="metal": failures.append("metal surface classification")
	if kinds[wood]!="wood": failures.append("wood surface classification")
	var roof=cell_index(Vector3(0,0,-4))
	if heights[roof]<4: failures.append("roof exposure sampling")
	set_weather("snow")
	for i in range(30): simulation(.1)
	if snow[roof]<=0: failures.append("snow accumulation")
	var before=snow[roof]; hour=12; set_weather("clear")
	for i in range(30): simulation(.1)
	if snow[roof]>=before: failures.append("sun melt")
	spill(Vector3(0,.05,-4),true)
	if poured>0: failures.append("spill must not jump onto overhead roof")
	# The showroom layout moved a roof across the old (0,3) test point.
	# Choose an actual sampled floor surface, as the thrown-potion check does.
	var spread_target=point(cell_index(Vector3(1.5,0,6)))+Vector3.UP*.025
	spill(spread_target,true)
	for i in range(30): simulation(.1)
	if absf(total_fuel()+burned+evaporated-poured)>.01: failures.append("fuel conservation")
	var patches=0
	for volume in fuel:
		if volume>.01: patches+=1
	if patches<=5:
		print("WEATHER_SPREAD_DIAGNOSTIC patches=",patches," fuel=",total_fuel()," burned=",burned," evaporated=",evaporated," origin_height=",heights[cell_index(Vector3(0,0,3))])
		failures.append("liquid spread")
	set_weather("rain")
	for i in range(80): simulation(.1)
	var lit=0
	for flame in burning: lit+=flame
	if lit>0: failures.append("sustained rain extinguishes exposed fire")
	if voices.size()!=8 or rain.multimesh.instance_count!=480: failures.append("bounded effects")
	fuel.fill(0); burning.fill(0); snow.fill(0); wet.fill(0); poured=0; burned=0; evaporated=0
	set_weather("clear"); update_field(); field_texture.update(field_image)
	var target=point(cell_index(Vector3(1.5,0,6)))+Vector3.UP*.025
	throw_at(target,false)
	for frame in range(240): tick_throwing(1.0/120.0)
	if poured<=0 or not projectiles.is_empty(): failures.append("aimed projectile must land and spill")
	for fire in burning:
		if fire>0: failures.append("unlit projectile remains unlit"); break
	fuel.fill(0); burning.fill(0); poured=0; burned=0; evaporated=0
	throw_at(target,true)
	for frame in range(240): tick_throwing(1.0/120.0)
	var has_fire=false
	for fire in burning:
		if fire>0: has_fire=true; break
	if not has_fire: failures.append("lit projectile ignites at landing")
	fuel.fill(0); burning.fill(0); poured=0; burned=0; evaporated=0
	failures.append_array(preload("res://fuel_checks.gd").new().run(self))
	return failures

func set_origin(origin:Vector2):
	ORIGIN=origin
	overlay.set_shader_parameter("grid_origin",ORIGIN)

func ray_surface(from:Vector3,direction:Vector3,max_distance=60.0)->Vector3:
	# Intersect the cached exposed surface, including sloped roofs and raised tables.
	for step in range(int(max_distance/.06)):
		var p=from+direction*(step*.06); var id=cell_index(p)
		if id>=0 and p.y<=heights[id] and p.y>=heights[id]-.09 and direction.y<0: return Vector3(p.x,heights[id]+.025,p.z)
	return Vector3.INF

func throw_at(pos:Vector3,lit:bool):
	if projectiles.size()>=MAX_FLYING_POTIONS or pos==Vector3.INF: return
	var from=demo.camera.position-demo.camera.global_basis.z*.5
	var flight=clampf(from.distance_to(pos)/12.0,.4,1.8)
	var velocity=(pos-from)/flight+Vector3.UP*4.9*flight
	var bottle=MeshInstance3D.new(); var mesh=CylinderMesh.new(); mesh.top_radius=.035; mesh.bottom_radius=.06; mesh.height=.19; mesh.radial_segments=8; mesh.material=material("ef983f" if lit else "719c9b",.3 if lit else 0); bottle.mesh=mesh; add_child(bottle); bottle.position=from
	projectiles.append({"node":bottle,"p":from,"v":velocity,"lit":lit,"life":5.0})

func tick_throwing(delta):
	if marker==null:
		marker=MeshInstance3D.new(); var mesh=TorusMesh.new(); mesh.inner_radius=.12; mesh.outer_radius=.15; mesh.rings=16; mesh.ring_segments=5; mesh.material=material("f8cf81",.5); marker.mesh=mesh; add_child(marker)
	var mouse=demo.root.get_mouse_position()
	aimed=ray_surface(demo.camera.project_ray_origin(mouse),demo.camera.project_ray_normal(mouse)) if aiming else Vector3.INF
	marker.visible=aiming and aimed!=Vector3.INF
	if marker.visible: marker.position=aimed
	for shot in projectiles:
		var old=shot.p; shot.v.y-=9.8*delta; var next=old+shot.v*delta
		var hit=ray_surface(old,(next-old).normalized(),old.distance_to(next)+.06)
		shot.life-=delta
		if hit!=Vector3.INF:
			spill(hit,shot.lit); shot.life=0
		shot.p=next; shot.node.position=next; shot.node.rotate_x(delta*4)
	for shot in projectiles:
		if shot.life<=0: shot.node.queue_free()
	projectiles=projectiles.filter(func(shot):return shot.life>0)

func pointer(event):
	if not event is InputEventMouseButton or not event.pressed: return
	if event.button_index==MOUSE_BUTTON_RIGHT: aiming=false; return
	if event.button_index==MOUSE_BUTTON_LEFT and aiming:
		if demo.root.gui_get_hovered_control()!=null: return
		var position=ray_surface(demo.camera.project_ray_origin(event.position),demo.camera.project_ray_normal(event.position))
		throw_at(position,aim_lit)

func set_overlay_active(active:bool,force=false):
	if overlay_attached==active and not force: return
	overlay_attached=active
	for node in overlay_targets:
		if not is_instance_valid(node): continue
		if active and node.material_overlay==null: node.material_overlay=overlay
		elif not active and node.material_overlay==overlay: node.material_overlay=null

func update_fluid_visuals():
	var seen=0; var lit=0
	var regions={}
	for i in range(N*N):
		if fuel[i]<.01: continue
		if seen<N*N:
			var left=i-1; var right=i+1; var back=i-N; var front=i+N
			var x=i%N
			var joins=Color(
				1.0 if x>0 and fuel[left]>.01 and absf(heights[left]-heights[i])<.2 else 0.0,
				1.0 if x<N-1 and fuel[right]>.01 and absf(heights[right]-heights[i])<.2 else 0.0,
				1.0 if back>=0 and fuel[back]>.01 and absf(heights[back]-heights[i])<.2 else 0.0,
				1.0 if front<N*N and fuel[front]>.01 and absf(heights[front]-heights[i])<.2 else 0.0)
			liquid.multimesh.set_instance_transform(seen,Transform3D(Basis.IDENTITY,point(i)+Vector3.UP*.024))
			liquid.multimesh.set_instance_custom_data(seen,joins)
			seen+=1
		if burning[i]>0 and lit<N*N:
			var scale=Vector3(.8,.4+minf(fuel[i],1),.8)
			flames.multimesh.set_instance_transform(lit,Transform3D(Basis.IDENTITY.scaled(scale),point(i)+Vector3.UP*.65*scale.y*.5)); lit+=1
			var key=Vector2i(int((i%N)/8),int(int(i/N)/8))
			if not regions.has(key): regions[key]={"weight":0.0,"center":Vector3.ZERO}
			var strength=minf(fuel[i],1.0)
			regions[key].weight+=strength; regions[key].center+=point(i)*strength
	liquid.multimesh.visible_instance_count=seen; flames.multimesh.visible_instance_count=lit
	var candidates=[]
	for region in regions.values():
		region.center/=maxf(.0001,region.weight)
		region.score=region.weight/(4.0+region.center.distance_squared_to(light_observer)*.08)
		candidates.append(region)
	candidates.sort_custom(func(a,b):return a.score>b.score)
	light_targets.clear()
	for candidate in candidates:
		var close=false
		for previous in light_targets:
			if previous.center.distance_squared_to(candidate.center)<4: close=true; break
		if not close: light_targets.append(candidate)
		if light_targets.size()>=3: break

## Three real lights; gradual energy changes, never per-cell lights or shadow maps.
func tick_fire_lights(delta:float):
	light_clock+=delta
	var blend=1.0-exp(-maxf(0,delta)*5.0)
	for i in range(fire_lights.size()):
		var lamp=fire_lights[i]; var energy=0.0
		if i<light_targets.size():
			var target=light_targets[i]
			var destination=target.center+Vector3.UP*.65
			lamp.position=destination if lamp.light_energy<.02 else lamp.position.lerp(destination,blend)
			var breath=1.0+sin(light_clock*2.1+i*1.7)*.035+sin(light_clock*3.7+i*.9)*.02
			energy=minf(2.1,.55+target.weight*.075)*breath
		lamp.light_energy=lerpf(lamp.light_energy,energy,blend)
