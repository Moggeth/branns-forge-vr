extends Node
## Physical armory. Saved IDs keep their insertion order across deliveries and sessions.
## Folios share one walkable footprint. Held, belted and dropped equipment lives outside the racks.
const Layout = preload("res://smithy_layout.gd")
const SAVE="user://collection_homes.json"
var game
var root:Node3D
var order=[]
var homes={}
var taking={}
var next_status=0.0
var current_folio := 0
var folios := {}
var bays := {}
var ledger: Label3D
var page_buttons: Array[Node3D] = []

func setup(owner_game):
	game=owner_game
	root=Node3D.new(); root.name="YourCollection"
	game.adventure.zone_groups.forge_yard.add_child(root)
	for id in game.adventure.ORDER: order.append(id)
	order.append("starter_hammer")
	if not game.diagnostic_offline and not game.smoke and FileAccess.file_exists(SAVE):
		var saved=JSON.parse_string(FileAccess.get_file_as_string(SAVE))
		if saved is Array:
			for id in saved:
				if id is String and not order.has(id): order.append(id)
	build_directory()
	ensure_bay(0)
	update_directory()

func build_directory() -> void:
	var directory := Node3D.new()
	root.add_child(directory)
	directory.name = "ArmoryDirectory"
	directory.position = Layout.ARMORY_ENTRY + Vector3(-1.9, 0, 1.95)
	directory.rotation.y = -PI / 2
	var backing := WorkshopScene.box(directory, Vector3(0, 1.52, 0), Vector3(1.82, 0.94, 0.16), WorkshopScene.material("3b4744"))
	backing.name = "LedgerBoard"
	WorkshopScene.collision(directory, backing.position, Vector3(1.82, 0.94, 0.16), "wood")
	var title := WorkshopScene.label(directory, "THE ARMORY", Vector3(0,1.80,0.10), 35)
	title.pixel_size = 0.0039
	ledger = WorkshopScene.label(directory, "", Vector3(0,1.52,0.10), 22)
	ledger.pixel_size = 0.0029
	for direction in [-1, 1]:
		var button := Node3D.new()
		directory.add_child(button)
		button.position = Vector3(direction * 0.43, 1.24, 0.12)
		button.set_meta("kind", "button")
		button.set_meta("action", "armory:previous" if direction < 0 else "armory:next")
		WorkshopScene.box(button, Vector3.ZERO, Vector3(0.76,0.20,0.075), WorkshopScene.material("6b5041"))
		var caption := WorkshopScene.label(button, "‹ PREVIOUS" if direction < 0 else "NEXT ›", Vector3(0,0,0.05), 18)
		caption.pixel_size = 0.0026
		WorkshopScene.collision(button, Vector3.ZERO, Vector3(0.76,0.20,0.08))
		page_buttons.append(button)
	WorkshopScene.label(game.scene.rack, "ARMORY  →", Vector3(0,0.35,0.43),19).pixel_size = 0.0032

func ensure_bay(index: int) -> void:
	if bays.has(index): return
	var bay := Node3D.new()
	bay.name = "Bay%02d" % (index + 1)
	root.add_child(bay)
	bay.position = Layout.bay_center(index)
	bays[index] = bay

func folio_group(page: int) -> Node3D:
	if folios.has(page): return folios[page]
	var group := Node3D.new()
	group.name = "ArmoryFolio%d" % (page + 1)
	root.add_child(group)
	group.visible = page == current_folio
	group.process_mode = Node.PROCESS_MODE_INHERIT if group.visible else Node.PROCESS_MODE_DISABLED
	folios[page] = group
	return group

func update_directory() -> void:
	var count := maxi(1, ceili(float(order.size() - 1) / Layout.SLOTS_PER_FOLIO))
	ledger.text = "Folio %d of %d · stands %02d–%02d" % [current_folio + 1, count, current_folio * Layout.SLOTS_PER_FOLIO + 1, (current_folio + 1) * Layout.SLOTS_PER_FOLIO]
	for i in page_buttons.size():
		var enabled := current_folio > 0 if i == 0 else current_folio + 1 < count
		page_buttons[i].visible = enabled
		game._set_collisions(page_buttons[i], enabled)

func turn_folio(direction: int) -> void:
	var last := maxi(0, ceili(float(order.size() - 1) / Layout.SLOTS_PER_FOLIO) - 1)
	var next := clampi(current_folio + direction, 0, last)
	if next == current_folio: return
	var old := folio_group(current_folio)
	old.hide()
	old.process_mode = Node.PROCESS_MODE_DISABLED
	current_folio = next
	var group := folio_group(current_folio)
	group.process_mode = Node.PROCESS_MODE_INHERIT
	group.show()
	update_directory()

func location(home: Dictionary) -> String:
	if home.page < 0: return "Brann’s handoff bench"
	return "armory · folio %d, stand %02d" % [home.page + 1, home.slot + 1]

func save_order():
	if game.diagnostic_offline or game.smoke: return
	var file=FileAccess.open(SAVE+".tmp",FileAccess.WRITE)
	if file==null: push_error("COLLECTION cannot save home registry"); return
	file.store_string(JSON.stringify(order)); file.close()
	var result=DirAccess.rename_absolute(SAVE+".tmp",SAVE)
	if result!=OK: push_error("COLLECTION home registry replacement failed: "+str(result))

func slot_position(index: int) -> Vector3:
	return Layout.stand_position(index)

func ensure_home(id:String,title:String)->Dictionary:
	if homes.has(id): return homes[id]
	# Keep existing IDs and their order, including older registries with duplicates.
	if not order.has(id):
		order.append(id)
		save_order()
	var index := int(order.find(id))
	var starter := id == "starter_hammer"
	if index > order.find("starter_hammer"): index -= 1
	var page := -1 if starter else floori(float(index) / Layout.SLOTS_PER_FOLIO)
	var stand := Node3D.new()
	stand.name = "Handoff" if starter else "Stand%02d" % (index + 1)
	if starter:
		root.add_child(stand)
		stand.global_position = game.scene.rack.global_position - Vector3.UP
	else:
		folio_group(page).add_child(stand)
		stand.position = slot_position(index)
		stand.rotation.y = Layout.stand_yaw(index)
		ensure_bay(floori(float(posmod(index, Layout.SLOTS_PER_FOLIO)) / Layout.SLOTS_PER_BAY))
	var wood=WorkshopScene.material("76553b")
	var slate=WorkshopScene.material("334c48")
	if not starter:
		WorkshopScene.cylinder(stand,Vector3(0,0.39,0),0.30,0.78,wood,0.38)
		preload("res://workshop_details.gd").clipped_box(stand,Vector3(0,0.82,0),Vector3(1.35,0.10,0.85),slate)
		WorkshopScene.collision(stand,Vector3(0,0.42,0),Vector3(1.35,0.84,0.85),"wood")
		for x in [-0.22,0.22]:
			WorkshopScene.box(stand,Vector3(x,0.92,0),Vector3(0.06,0.10,0.3),WorkshopScene.material("b08c52",0.5))
	WorkshopScene.box(stand,Vector3(0,0.72,0.46),Vector3(1.30,0.25,0.035),slate)
	var label=WorkshopScene.label(stand,title if starter else "%02d · %s" % [index+1,title],Vector3(0,0.77,0.485),20)
	label.pixel_size=0.002; label.width=610; label.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	var status=WorkshopScene.label(stand,"Loading…",Vector3(0,0.66,0.488),15); status.pixel_size=0.002
	var button=Node3D.new(); stand.add_child(button); button.position=Vector3(0,0.46,0.50)
	button.set_meta("kind","button"); button.set_meta("action","collection:"+id)
	WorkshopScene.box(button,Vector3.ZERO,Vector3(0.80,0.16,0.08),WorkshopScene.material("496f62"))
	var caption=WorkshopScene.label(button,"RETURN TO STAND",Vector3(0,0,0.046),16); caption.pixel_size=0.002
	WorkshopScene.collision(button,Vector3.ZERO,Vector3(0.82,0.18,0.09))
	var instructions=str(preload("res://item_interactions.gd").CONTROLS.get(id,"Grip: take · Trigger: activate invention"))
	var hint=WorkshopScene.label(stand,instructions,Vector3(0,0.23,0.56),14)
	hint.pixel_size=0.002; hint.width=620; hint.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	var home={"stand":stand,"item":null,"status":status,"id":id,"page":page,"slot":index,"hint":hint}
	homes[id]=home
	Layout.set_label_ranges(stand)
	update_directory()
	return home

func pending_builtin(id:String)->bool:
	for delivery in game.state.get("deliveries",[]):
		if str(delivery.get("toolId",""))==id: return true
	return false

func sync():
	var catalog=game.state.get("recipes",[])
	if catalog.is_empty(): catalog=game.state.get("tools",[])
	for spec in catalog:
		if not spec.get("available",true) and not spec.get("owned",false): continue
		var id=str(spec.id)
		if not game.adventure.TOOL_NAMES.has(id): continue
		var home=ensure_home(id,game.adventure.TOOL_NAMES[id])
		if is_instance_valid(home.item): continue
		if pending_builtin(id): home.status.text="Brann is finishing it"; continue
		var item=null
		for candidate in game.get_tree().get_nodes_in_group("pickup"):
			if candidate.get_meta("id","")==id and not candidate.get_meta("dev_spawn",false): item=candidate; break
		if item==null:
			item=glove_display() if id=="bomb_glove" else game.adventure._tool_model(id)
			game.add_child(item)
			item.set_meta("haptics",spec.get("haptics",{}))
		register(item)
	if not homes.has("starter_hammer") or not is_instance_valid(homes.starter_hammer.item): register(game.scene.hammer)
	for spec in game.state.get("items",[]):
		var version_label = " v%d" % int(spec.version) if int(spec.get("version",1)) > 1 else ""
		ensure_home(str(spec.id),str(spec.name) + version_label)
		if game.imported.has(spec.id) and game.imported[spec.id].get_meta("delivery_ready",true): register(game.imported[spec.id])

func glove_display()->Node3D:
	var item=Node3D.new()
	item.set_meta("id","bomb_glove"); item.set_meta("kind","weapon")
	item.set_meta("display_name","Pocket Thunder"); item.add_to_group("pickup")
	var leather=WorkshopScene.material("537a73")
	var copper=WorkshopScene.material("c59a5a",0.6)
	for side in [-1,1]:
		WorkshopScene.box(item,Vector3(side*0.14,0.16,0),Vector3(0.13,0.18,0.055),leather)
		WorkshopScene.box(item,Vector3(side*0.14,0.055,0),Vector3(0.15,0.05,0.07),copper)
		for i in range(4): WorkshopScene.ball(item,Vector3(side*0.14+(i-1.5)*0.032,0.27,0),Vector3(0.029,0.09,0.046),leather)
		WorkshopScene.ball(item,Vector3(side*0.23,0.16,0),Vector3(0.065,0.10,0.05),leather)
		WorkshopScene.ball(item,Vector3(side*0.14,0.16,-0.035),Vector3.ONE*0.055,copper)
	WorkshopScene.collision(item,Vector3(0,0.17,0),Vector3(0.53,0.35,0.12))
	return item

func register(item:Node3D):
	var id=str(item.get_meta("id",""))
	var home=ensure_home(id,str(item.get_meta("display_name",id)))
	if home.item==item: return
	if is_instance_valid(home.item):
		# A fresh delivery may replace a display, but never steal a held old copy.
		if home.item not in game.held.values() and not game.grips.is_stowed(home.item):
			game.tool_physics.detach(home.item); home.item.queue_free()
	home.item=item
	item.set_meta("collection_id",id)
	if item.has_meta("use_instructions"): home.hint.text = str(item.get_meta("use_instructions"))
	if item not in game.held.values() and not game.grips.is_stowed(item): return_item(id)

func display_position(home:Dictionary)->Vector3:
	var item=home.item
	return home.stand.global_position+Vector3.UP*float(item.get_meta("display_height",0.98))

func return_item(id:String)->bool:
	if not homes.has(id): return false
	var home=homes[id]; var item=home.item
	if not is_instance_valid(item): game._notice("That creation is still loading or being finished."); return false
	if item in game.held.values() or game.grips.is_stowed(item):
		game._notice("That item is in your hands or on your belt. Put it down before returning it."); return false
	if not item.get_meta("delivery_ready",true): return false
	game.tool_physics.detach(item)
	if item.get_parent() != home.stand: item.reparent(home.stand)
	item.global_position=display_position(home)
	item.rotation=Vector3(0,float(item.get_meta("display_yaw",0.0)),0); item.visible=true
	game._set_collisions(item,true)
	game.previous_tips.clear()
	home.status.text="Grip to take"
	print("COLLECTION returned id=",id," home=",order.find(id)+1)
	return true

func is_docked(item: Node3D) -> bool:
	var home: Dictionary = homes.get(str(item.get_meta("collection_id", "")), {})
	return not home.is_empty() and item.get_parent() == home.stand

func owns(id:String)->bool:
	for spec in game.state.get("tools",[]):
		if str(spec.id)==id: return true
	return false

func take(item:Node3D,hand:Node3D):
	var id=str(item.get_meta("id",""))
	if taking.has(id): return
	taking[id]=true
	if game.adventure.TOOL_NAMES.has(id) and not owns(id):
		await game._send_context()
		var result=await game._request("/api/vr/collection-take",{"id":id})
		if result.has("error"):
			taking.erase(id); game._notice(str(result.error)); return
		game.state.tools=result.tools
		# Do not snap to a hand that was released while waiting for the service.
		if hand is XRController3D and not game.last_inputs.get(str(hand.get_instance_id())+"g",false):
			taking.erase(id); return
	if game.held.has(str(hand.get_instance_id())) or not item.is_visible_in_tree():
		taking.erase(id); return
	if id=="bomb_glove":
		game.adventure.selected=id
		game._notice("Pocket Thunder is already worn: grip an empty hand, then hold trigger to form a bomb.",8)
	else:
		game.grips._attach(hand,item)
		game._notice("Taken from your collection: "+str(item.get_meta("display_name",id)))
	taking.erase(id)

func tick():
	if game.elapsed<next_status: return
	next_status=game.elapsed+0.4
	for home in homes.values():
		if home.page >= 0 and home.page != current_folio: continue
		var item=home.item
		if not is_instance_valid(item): continue
		if item in game.held.values(): home.status.text="In your hands"
		elif game.grips.is_stowed(item): home.status.text="On your belt"
		elif item.global_position.distance_to(display_position(home))<0.15: home.status.text="Already worn · grip for controls" if home.id=="bomb_glove" else "Grip to take"
		else: home.status.text="Away · return it here"

func checks(failures:Array):
	var before=homes.size(); sync(); sync()
	if homes.size()!=before: failures.append("collection repeated sync changed home count")
	var id="collection-regression"
	var sample=Node3D.new(); game.add_child(sample)
	sample.set_meta("id",id); sample.set_meta("kind","weapon")
	WorkshopScene.box(sample,Vector3.ZERO,Vector3.ONE*0.12,WorkshopScene.material("b9a172"))
	register(sample)
	var home=homes[id]; var address=order.find(id); var position=home.stand.global_position+Vector3.UP*0.98
	var hand=Node3D.new(); game.add_child(hand)
	game.grips._attach(hand,sample)
	if return_item(id): failures.append("collection recall stole a held item")
	game.held.erase(str(hand.get_instance_id())); game.grips.grips.erase(str(hand.get_instance_id()))
	game.tool_physics.drop(sample,Vector3.ZERO,Vector3.ZERO)
	sample.global_position=Vector3(80,-4,80)
	if not return_item(id) or sample.global_position.distance_to(position)>0.01: failures.append("collection failed lost tool recovery")
	if sample.has_meta("drop_body"): failures.append("collection left physics wrapper attached")
	if order.find(id)!=address: failures.append("collection recovery changed home address")
	var positions=[]
	for i in Layout.SLOTS_PER_FOLIO:
		var point=slot_position(i)
		if point in positions: failures.append("collection slot overlap")
		positions.append(point)
	homes.erase(id); order.erase(id); home.stand.queue_free(); sample.queue_free(); hand.queue_free()
	print("COLLECTION_CHECK homes=",homes.size()," failures=",JSON.stringify(failures))
