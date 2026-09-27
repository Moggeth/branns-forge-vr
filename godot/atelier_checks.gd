extends SceneTree
var game
var checks=0
var failures=[]
func check(ok,message):
 checks+=1
 if not ok: failures.append(message); print("ATELIER_ASSERT ",message)
func _initialize(): run.call_deferred()
func run():
 game=load("res://main.tscn").instantiate(); root.add_child(game)
 await physics_frame; await physics_frame; await physics_frame
 game.set_process(false); game.smoke=true; game.adventure.test_mode=true
 var atelier=game.atelier; var hand=game.desktop_hand
 check(atelier.items.size()==2,"Two new specimens registered")
 for id in atelier.items:
  check(game.collection.homes.has(id) and game.collection.homes[id].item==atelier.items[id],id+" has persistent predictable home")
 var axe=game.adventure._tool_model("woodland_axe"); game.add_child(axe)
 check(axe.get_meta("tip")==Vector3(.43,.62,0),"Axe tip preserved")
 check(axe.get_meta("alternate_ability","").contains("Shelter"),"Axe secondary preserved")
 check(axe.find_children("OrchidEdge*","MeshInstance3D",true,false).size()>0,"Refined axe integrated")
 game.workshop_delivery.working_pose(0)
 check(game.scene.brann.get_meta("smith_hammer").to_global(game.workshop_delivery.HAMMER_FACE).distance_to(game.workshop_delivery.CONTACT)<.005,"Brann refined hammer still contacts workpiece")
 var hammer=game.adventure._tool_model("apprentice_hammer"); game.add_child(hammer)
 check(hammer.find_children("CopperpotPromise*","MeshInstance3D",true,false).size()==8,"Refined hammer integrated")
 game.rig.position=Vector3(400,3,400); game.camera.rotation=Vector3.ZERO
 var lantern=atelier.items.glowmoth; game.grips._attach(hand,lantern)
 var glow=atelier.glowmoth
 check(atelier.trigger(hand,game.camera) and is_instance_valid(glow.scout),"Holding controller trigger deploys moth")
 var start=glow.scout.global_position; var socket=glow._socket_position()
 check(start.distance_to(socket)<.05,"Moth emerges from physical lantern socket")
 for i in range(40): glow.tick(.05)
 check(glow.scout.global_position.distance_to(start)>1,"Moth flies away")
 check(atelier.trigger(hand,game.camera),"Second trigger recalls moth")
 for i in range(100): glow.tick(.05)
 check(not is_instance_valid(glow.scout),"Recall reaches lantern and removes scout")
 atelier.trigger(hand,game.camera); game.held.clear(); glow.tick(.05)
 check(not is_instance_valid(glow.scout),"Drop cleans up deployed moth")
 var mace=atelier.items.stormbell; game.grips._attach(hand,mace); var bell=atelier.stormbell
 var dummy=game.scene.dummies[0]
 game.melee.strike(dummy,dummy.global_position,Vector3.UP,2,hand,mace)
 check(int(mace.get_meta("stormbell_charge",0))==1,"Real melee impact charges bell")
 bell.record_impact(mace,2)
 check(int(mace.get_meta("stormbell_charge",0))==1,"Repeated contact is debounced")
 for i in range(5): game.elapsed+=.3; bell.record_impact(mace,2)
 check(int(mace.get_meta("stormbell_charge",0))==3,"Charge is bounded")
 check(atelier.trigger(hand,game.camera),"Holding controller trigger routes bell")
 check(int(mace.get_meta("stormbell_charge",-1))==0,"Empty-space chime releases stored charge")
 check(bell.pulses.size()>0,"Chime produces visible feedback")
 var enemy=game.scene.enemies[0]; enemy.reparent(game); enemy.show(); enemy.set_meta("zone",game.adventure.zone); enemy.set_meta("alive",true); enemy.set_meta("hp",120)
 enemy.global_position=game.camera.global_position-Vector3(0,.65,4)
 await physics_frame; await physics_frame
 game.elapsed+=2; bell.record_impact(mace,2); atelier.trigger(hand,game.camera)
 check(float(enemy.get_meta("hp"))<120,"Aimed chime damages a real enemy")
 var wall=StaticBody3D.new(); game.add_child(wall); wall.collision_layer=1; wall.global_position=game.camera.global_position-Vector3(0,0,2)
 var shape=CollisionShape3D.new(); var box=BoxShape3D.new(); box.size=Vector3(3,3,.2); shape.shape=box; wall.add_child(shape)
 await physics_frame; await physics_frame
 var hp=float(enemy.get_meta("hp")); game.elapsed+=2; bell.record_impact(mace,2); atelier.trigger(hand,game.camera)
 check(float(enemy.get_meta("hp"))==hp,"Wall blocks chime damage")
 for i in range(20): bell.tick(.05)
 check(bell.pulses.is_empty(),"Transient waves expire")
 wall.queue_free()
 game.held.clear(); mace.reparent(game); game.tool_physics.drop(mace,Vector3.ZERO,Vector3.ZERO)
 check(mace.has_meta("drop_body"),"New mace uses existing drop physics")
 check(game.collection.return_item("stormbell"),"Dropped mace returns to named stand")
 if "--atelier-game-capture" in OS.get_cmdline_user_args():
  game.hud.get_parent().hide(); game.adventure.travel("forge_yard"); game.camera.global_position=game.collection.homes.glowmoth.stand.global_position+Vector3(1.4,1.6,1.8); game.camera.look_at(lantern.global_position+Vector3.UP*.3)
 print("ATELIER_RESULT ",JSON.stringify({"checks":checks,"failures":failures}))
 game.queue_free(); await process_frame; quit(0 if failures.is_empty() else 1)
