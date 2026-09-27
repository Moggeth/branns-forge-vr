extends SceneTree
var game
var fairy
var menu
var checks=0
var failures=[]
func check(ok,message):
 checks+=1
 if not ok: failures.append(message)
func key(code):
 var e=InputEventKey.new(); e.physical_keycode=code; e.pressed=true; fairy.input_event(e)
func pad(code):
 var e=InputEventJoypadButton.new(); e.button_index=code; e.pressed=true; fairy.input_event(e)
func _initialize(): run.call_deferred()
func run():
 game=load("res://main.tscn").instantiate(); root.add_child(game)
 await physics_frame; await physics_frame; await physics_frame
 game.set_process(false); game.smoke=true; game.adventure.test_mode=true; game._start_fairy(); fairy=game.fairy; fairy.test_mode=true; menu=fairy.discoveries
 key(KEY_M)
 check(menu.opened and menu.ids.has("forge_yard") and menu.ids.has("ember_creek") and menu.ids.has("moonwater_causeway"),"Chooser includes original and new registered places")
 var zone=game.adventure.zone; pad(JOY_BUTTON_DPAD_DOWN)
 check(game.adventure.zone==zone,"Browsing never travels")
 check(fairy.controls(.02).brake,"Open chooser suppresses flight and triggers")
 var orientation=fairy.orientation; var motion=InputEventMouseMotion.new(); motion.screen_relative=Vector2(100,100); fairy.input_event(motion)
 check(fairy.orientation==orientation,"Menu pointer does not aim fairy")
 pad(JOY_BUTTON_B); check(not menu.opened and game.adventure.zone==zone,"B closes without travel")
 pad(JOY_BUTTON_START); pad(JOY_BUTTON_DPAD_UP); check(menu.opened,"Start and up opens chooser")
 menu.select_place(menu.ids.find("glowroot_grotto")); menu.action_index=0; pad(JOY_BUTTON_A)
 check(game.adventure.zone=="glowroot_grotto" and not menu.opened,"Controller actually visits night room")
 menu.show_menu(); menu.return_home(); check(game.adventure.zone=="forge_yard","Return uses shared home travel")
 menu.show_menu(); menu.select_place(menu.ids.find("sandstone_quarry")); menu.visit_selected()
 check(game.adventure.zone=="sandstone_quarry","Old destination remains selectable")
 menu.show_menu(); menu.select_place(menu.ids.find("ember_creek")); menu.visit_selected(); fairy.tick(.02,{"stick":Vector3.ZERO,"boost":false,"brake":true})
 game.ember_creek.act("match"); var held=fairy.carry
 menu.show_menu(); check(fairy.carry==held,"Opening preserves held match")
 menu.request_reset(); check(menu.confirming and game.ember_creek.stage==0,"Reset requires separate confirmation")
 pad(JOY_BUTTON_B); check(menu.opened and not menu.confirming and fairy.carry==held,"Cancel reset keeps menu and cargo")
 game.ember_creek.stage=3; menu.request_reset(); menu.action_index=0; pad(JOY_BUTTON_A)
 check(game.ember_creek.stage==0 and fairy.carry==held,"Confirmed local reset preserves cargo")
 check(game.adventure.zone=="ember_creek","Reset does not travel to another activity")
 menu.close_menu(); fairy.offer_practice_hand(); fairy.avatar.global_position=fairy.practice_hand.global_position; fairy.perch_or_leave(); var perch=fairy.perch
 menu.show_menu(); check(fairy.perch==perch,"Opening preserves perch")
 if "--discoveries-capture" in OS.get_cmdline_user_args():
  fairy.window.show(); fairy.window.size=Vector2i(1280,800)
  for i in range(5): await process_frame
  await RenderingServer.frame_post_draw
  var output="user://reviews/discoveries.png"
  for arg in OS.get_cmdline_user_args():
   if arg.begins_with("--capture-output="): output=arg.trim_prefix("--capture-output=")
  DirAccess.make_dir_recursive_absolute(output.get_base_dir()); fairy.window.get_texture().get_image().save_png(output)
 print("DISCOVERIES_RESULT ",JSON.stringify({"checks":checks,"failures":failures}))
 game.queue_free(); await process_frame; quit(0 if failures.is_empty() else 1)
