extends Node
var game
var bodies=[]
func setup(owner_game): game=owner_game

func drop(item,velocity:Vector3,angular:Vector3):
	var body=RigidBody3D.new()
	body.collision_layer=8 # loose tools never block the player's layer-1 capsule
	body.collision_mask=9
	body.mass=clampf(float(item.get_meta("mass",1.3)),0.05,20.0)
	body.continuous_cd=true
	body.contact_monitor=true
	body.max_contacts_reported=4
	body.body_entered.connect(func(other):
		if game.apples!=null: game.apples.on_tool_contact(body,other)
		if game.pumpkins!=null:
			var target=game._owner(other)
			if target!=null and target.get_meta("kind","")=="pumpkin": game.pumpkins.impact(target,item,target.global_position,(target.global_position-body.global_position).normalized(),body.linear_velocity))
	body.physics_material_override=PhysicsMaterial.new()
	body.physics_material_override.friction=0.85
	body.physics_material_override.bounce=0.08
	game.adventure.zone_groups.get(game.adventure.zone,game).add_child(body)
	body.global_transform=item.global_transform
	body.set_meta("pickup_proxy",item)
	item.reparent(body)
	item.set_meta("drop_body",body)
	game._set_collisions(item,false)
	# A stable mesh-bounds envelope supports the entire tool, not just its origin.
	var bounds=game.remains._bounds(item,Transform3D.IDENTITY)
	var shape=CollisionShape3D.new()
	shape.shape=BoxShape3D.new()
	shape.shape.size=bounds.size.max(Vector3.ONE*0.025)
	shape.position=bounds.get_center()
	body.add_child(shape)
	body.linear_velocity=velocity.limit_length(20)
	body.angular_velocity=angular.limit_length(15)
	bodies.append(body)
	print("TOOL_DROP id=",item.get_meta("id","")," velocity=",velocity.length())

func detach(item):
	if not item.has_meta("drop_body"): return
	var body=item.get_meta("drop_body")
	item.remove_meta("drop_body")
	if not is_instance_valid(body): return
	if item.get_parent()==body: item.reparent(game)
	bodies.erase(body)
	body.queue_free()

func _process(_delta):
	for body in bodies.duplicate():
		if not is_instance_valid(body): bodies.erase(body); continue
		body.freeze=not body.is_visible_in_tree()
		if body.global_position.y< -15:
			var item=body.get_meta("pickup_proxy")
			item.reparent(game.adventure.zone_groups.forge_yard)
			item.global_position=game.scene.rack.global_position+Vector3(0,0.12,0)
			detach(item)
			game._set_collisions(item,true)
