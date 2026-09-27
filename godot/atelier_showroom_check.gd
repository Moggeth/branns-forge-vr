extends SceneTree
func _initialize(): run.call_deferred()
func run():
 var game=load("res://main.tscn").instantiate(); root.add_child(game)
 for i in range(20): await process_frame
 assert(game.rig.global_position.x>490,"Showroom spawn failed")
 for id in ["woodland_axe","apprentice_hammer","glowmoth","stormbell"]:
  assert(game.collection.homes[id].stand.global_position.x>490,"Missing showcase stand")
 await RenderingServer.frame_post_draw
 root.get_texture().get_image().save_png("res://../outputs/atelier-review/showroom.png")
 print("ATELIER_SHOWROOM_PASS")
 quit()
