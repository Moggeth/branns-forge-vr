extends Node
## Sunfall Sledge's local, physical impact. Generated tile effects remain separate.
const ITEM_ID="74a031c1-7001-4518-8ae8-ace3dce4d027"
const IMPACT_COOLDOWN=0.18
const SHOCKWAVE_SECONDS=0.58
var game
var last_hit:Dictionary={}
var waves:Array=[]
var sounds:Array[AudioStreamWAV]=[]
var voices:Array[AudioStreamPlayer3D]=[]
var sound_index=0
var dark:Material
var hot:Material

func setup(owner_game):
	game=owner_game
	dark=WorkshopScene.material("4b332d",0.05,0.76)
	hot=WorkshopScene.material("ff7130",0.0,0.48,2.2)
	for i in 8: sounds.append(_make_bonk(i))
	for i in 4:
		var player=AudioStreamPlayer3D.new(); game.add_child(player)
		player.max_distance=22; player.volume_db=-6
		voices.append(player)
	print("SUNFALL ready impact_samples=",sounds.size()," ground_shockwave=true")

func attach(item:Node3D,model:Node3D):
	if str(item.get_meta("id",""))!=ITEM_ID: return
	var bounds=game._bounds(model,Transform3D.IDENTITY)
	item.set_meta("tip",Vector3(0,maxf(0.58,bounds.end.y*0.87),0))
	item.set_meta("impact_class","blunt")
	item.set_meta("use_instructions","Swing: explosive bonk on contact · ground: fiery earth ripple · Trigger: Sunburst")

func is_sunfall(item:Node)->bool:
	return is_instance_valid(item) and str(item.get_meta("id",""))==ITEM_ID

func impact(item:Node3D,target:Node3D,point:Vector3,normal:Vector3,speed:float,hand,velocity:Vector3)->bool:
	if not is_sunfall(item) or speed<1.0: return false
	var key=item.get_instance_id()
	if game.elapsed<float(last_hit.get(key,-10.0))+IMPACT_COOLDOWN: return true
	last_hit[key]=game.elapsed
	_bonk(point,speed)
	if game.heat_contacts!=null: game.heat_contacts.touch(point,.55,270,game.adventure.zone,"sunfall",item,.1)
	game.adventure.haptic(hand,"impact")
	game._effect(point,Color("ff8f3b"),0.35,0.42)
	var direction=(velocity+Vector3.UP*2.0).normalized()
	var kind=str(target.get_meta("kind","")) if target!=null else ""
	if kind=="enemy":
		var skeleton=str(target.get_meta("enemy_type",""))=="skeleton"
		if skeleton and game.guardians!=null: game.guardians.yank(target,hand)
		game.adventure.hurt_enemy(target,9999 if skeleton else 58,hand,direction*(9.0 if skeleton else 3.0)+Vector3.UP*(4.0 if skeleton else 1.0),"fire")
	elif kind=="rat": game._kill_rat(target)
	elif kind=="dummy": game._dummy_hit(target)
	elif kind=="pumpkin" and game.pumpkins!=null: game.pumpkins.impact(target,item,point,normal,velocity)
	elif target is RigidBody3D: target.apply_central_impulse(direction*minf(7.0,speed*1.2))
	if normal.y>0.62 and kind in ["floor","solid",""]:
		_shockwave(point)
	return true

func _bonk(point:Vector3,speed:float):
	var voice=voices[sound_index%voices.size()]
	voice.stream=sounds[sound_index%sounds.size()]
	voice.global_position=point
	voice.pitch_scale=clampf(0.88+speed*0.03,0.9,1.17)
	voice.play()
	sound_index+=1

func _make_bonk(variation:int)->AudioStreamWAV:
	var sample_rate=22050; var length=int(sample_rate*0.47)
	var data=PackedByteArray(); data.resize(length*2)
	var random=RandomNumberGenerator.new(); random.seed=91203+variation*7381
	for i in length:
		var t=float(i)/sample_rate
		var low=sin(TAU*(76+variation*3)*t)*exp(-t*11)*0.62
		var body=sin(TAU*(139+variation*7)*t)*exp(-t*19)*0.24
		var crack=random.randf_range(-1,1)*exp(-t*48)*0.44
		var ring=sin(TAU*(430+variation*21)*t)*exp(-t*15)*0.09
		data.encode_s16(i*2,int(clampf(low+body+crack+ring,-1,1)*24500))
	var sound=AudioStreamWAV.new(); sound.format=AudioStreamWAV.FORMAT_16_BITS; sound.mix_rate=sample_rate; sound.data=data
	return sound

func _shockwave(point:Vector3):
	if game.heat_contacts!=null: game.heat_contacts.touch(point,1.8,300,game.adventure.zone,"sunfall_wave",null,.1)
	var root=Node3D.new(); game.adventure.zone_groups.get(game.adventure.zone,game).add_child(root)
	root.global_position=point+Vector3.UP*0.02
	var spikes:Array=[]
	for i in 12:
		var p=Node3D.new(); root.add_child(p)
		var rock=MeshInstance3D.new(); p.add_child(rock)
		var stone=CylinderMesh.new(); stone.top_radius=0.008; stone.bottom_radius=0.085; stone.height=0.38; stone.radial_segments=5
		rock.mesh=stone; rock.material_override=dark
		var ember=MeshInstance3D.new(); p.add_child(ember)
		var tongue=CylinderMesh.new(); tongue.top_radius=0.001; tongue.bottom_radius=0.032; tongue.height=0.22; tongue.radial_segments=5
		ember.mesh=tongue; ember.material_override=hot; ember.position.y=0.15
		spikes.append(p)
	waves.append({"root":root,"spikes":spikes,"born":game.elapsed})
	for enemy in game.scene.get("enemies",[]):
		if is_instance_valid(enemy) and enemy.get_meta("alive",false) and enemy.global_position.distance_to(point)<1.8:
			game.adventure.hurt_enemy(enemy,24,null,(enemy.global_position-point+Vector3.UP).normalized()*2.0,"fire")

func tick(_delta:float):
	for wave in waves.duplicate():
		if not is_instance_valid(wave.root): waves.erase(wave); continue
		var age=(game.elapsed-float(wave.born))/SHOCKWAVE_SECONDS
		if age>=1:
			wave.root.queue_free(); waves.erase(wave); continue
		for i in wave.spikes.size():
			var angle=float(i)*TAU/wave.spikes.size()
			var phase=clampf((age-float(i%3)*0.045)*2.4,0,1)
			var radius=0.12+phase*1.55
			var node:Node3D=wave.spikes[i]
			node.position=Vector3(cos(angle)*radius,0,sin(angle)*radius)
			node.scale=Vector3.ONE*maxf(0.001,sin(phase*PI)*0.95)
