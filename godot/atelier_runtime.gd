extends Node
## Four-item art trial: reuse held ownership, physics and collection homes.
var game
var glowmoth
var stormbell
var items={}
const NAMES={"glowmoth":"Glowmoth Lantern","stormbell":"Stormbell"}
const HELP={"glowmoth":"Grip: carry · Trigger: release / recall light moth", "stormbell":"Swing: charge the bell · Aim + trigger: concussive chime"}
func setup(g):
 game=g
 glowmoth=load("res://glowmoth.gd").new(); add_child(glowmoth); glowmoth.setup(game)
 stormbell=load("res://stormbell.gd").new(); stormbell.setup(game)
 for id in NAMES:
  var item=Node3D.new(); game.add_child(item); item.name=NAMES[id]
  item.set_meta("kind","weapon"); item.set_meta("id",id); item.set_meta("display_name",NAMES[id]); item.set_meta("grip_min",0.02); item.set_meta("grip_max",0.23); item.set_meta("mass",.65 if id=="glowmoth" else 1.5); item.set_meta("use_instructions",HELP[id]); item.add_to_group("pickup")
  if id=="glowmoth": glowmoth.build(item)
  else: stormbell.build(item)
  game._collider(item,Vector3(.65,.84,.45) if id=="glowmoth" else Vector3(.45,.76,.45),Vector3(0,.33,0))
  game.collection.register(item); items[id]=item
  var stand=game.collection.homes[id].stand
  for node in stand.get_children():
   if node is Label3D and node.text.begins_with("Grip:"): node.text=HELP[id]
 if "--atelier-demo" in OS.get_cmdline_user_args(): showroom.call_deferred()
 print("ATELIER_READY items=glowmoth,stormbell art=orchid,copperpot")
func trigger(hand,source):
 var item=game.held.get(str(hand.get_instance_id()))
 if not is_instance_valid(item): return false
 match str(item.get_meta("id","")):
  "glowmoth": return glowmoth.trigger(item,hand,source)
  "stormbell": return stormbell.trigger(item,hand,source)
 return false
func impact(item,speed):
 if item.get_meta("id","")=="stormbell": stormbell.record_impact(item,speed)
func tick(delta):
 glowmoth.tick(delta); stormbell.tick(delta)

func showroom():
 await game.get_tree().process_frame
 await game.get_tree().process_frame
 game.adventure.overlay.hide()
 var center=Vector3(500,0,0)
 var stage=Node3D.new(); game.adventure.zone_groups.forge_yard.add_child(stage); stage.position=center
 WorldZones.box(stage,Vector3(0,-.15,0),Vector3(16,.3,14),"586b68"); WorldZones.body(stage,Vector3(0,-.15,0),Vector3(16,.3,14))
 for id in ["woodland_axe","apprentice_hammer"]:
  var item=game.adventure._tool_model(id); game.add_child(item); game.collection.register(item)
 var order=["woodland_axe","apprentice_hammer","glowmoth","stormbell"]
 for i in range(order.size()):
  var home=game.collection.homes[order[i]]; home.stand.global_position=center+Vector3((i-1.5)*2.4,0,0); home.stand.rotation.y=0; game.collection.return_item(order[i])
 var label=WorldZones.label(stage,"BRANN'S ATELIER\nFour creations · grip / E to take · trigger / click to use\nWASD: walk · hold right mouse: look · return buttons restore dropped items",Vector3(0,2.8,-1.2),25,"fff0d2"); label.pixel_size=.0025
 var dummy=game.scene.dummies[0]; dummy.global_position=center+Vector3(5,0,-2)
 game.adventure.travel("forge_yard"); game.rig.global_position=center+Vector3(0,0,4); game.rig.rotation=Vector3.ZERO; game.camera.rotation=Vector3.ZERO
 game._notice("Atelier trial · four creations, no progression cost. Stormbell charges on the training dummy.",10)
