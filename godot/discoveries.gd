extends Node
## A view over existing destinations. No duplicate activity or progression state.
var game
var fairy
var opened=false
var confirming=false
var ids=[]
var layer:CanvasLayer
var sheet:PanelContainer
var places:ItemList
var detail:Label
var go:Button
var reset_button:Button
var back:Button
var home:Button
var selected=0
var action_index=0
const HINTS={
 "forge_yard":"Brann, common goods and your collection. Rest on a friendly hand; H / D-pad down + A perches on a shoulder.",
 "glowroot_grotto":"Your glow wakes sleeping mushroom caps. Fly close and watch the cave blossom.",
 "starlace_archive":"Find three hidden seals. Stay close and reveal with R / middle mouse / Y to open the archive.",
 "moonwater_causeway":"Illuminate the stepping stones. They remember your light briefly, guiding your friend across.",
 "ember_creek":"Pour oil, light it, quench it, use the bellows, then relight. Carry a flame beyond the gate. Aim at a valve and click / RT.",
 "ember_gallery":"Pour oil, light the lamps and experiment with water. Carry matches and bottles with E / back mouse / X."
}
func setup(g,target,f=null):
 game=g; fairy=f
 layer=CanvasLayer.new(); layer.layer=70; target.add_child(layer)
 var shortcut=Button.new(); layer.add_child(shortcut); shortcut.text="Map · M"; shortcut.position=Vector2(18,200); shortcut.pressed.connect(func():
  if game.get("travel_navigation")!=null: game.travel_navigation.show_for(target,"map",fairy)
  else: show_menu())
 if fairy==null:
  shortcut.anchor_top=1; shortcut.anchor_bottom=1
  shortcut.offset_left=18; shortcut.offset_right=150
  shortcut.offset_top=-54; shortcut.offset_bottom=-20
 sheet=PanelContainer.new(); layer.add_child(sheet); sheet.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT); sheet.offset_left=24; sheet.offset_top=24; sheet.offset_right=-24; sheet.offset_bottom=-24
 var backdrop=StyleBoxFlat.new(); backdrop.bg_color=Color("142a32"); backdrop.border_color=Color("78b8bc"); backdrop.set_border_width_all(2); backdrop.set_corner_radius_all(12); sheet.add_theme_stylebox_override("panel",backdrop)
 var margin=MarginContainer.new(); sheet.add_child(margin)
 for side in ["left","right","top","bottom"]: margin.add_theme_constant_override("margin_"+side,20)
 var column=VBoxContainer.new(); margin.add_child(column); column.add_theme_constant_override("separation",14)
 var title=Label.new(); title.text="DISCOVERIES  ·  Take a little excursion"; title.add_theme_font_size_override("font_size",26); column.add_child(title)
 var help=Label.new(); help.text="Choose a place, then Visit. D-pad ↑↓ selects · ←→ actions · A confirms · B / Esc closes"; help.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART; column.add_child(help)
 var row=HBoxContainer.new(); row.size_flags_vertical=Control.SIZE_EXPAND_FILL; row.add_theme_constant_override("separation",24); column.add_child(row)
 places=ItemList.new(); places.custom_minimum_size=Vector2(270,120); places.size_flags_horizontal=Control.SIZE_EXPAND_FILL; row.add_child(places); places.item_selected.connect(select_place)
 detail=Label.new(); detail.custom_minimum_size=Vector2(220,100); detail.size_flags_vertical=Control.SIZE_EXPAND_FILL; detail.size_flags_horizontal=Control.SIZE_EXPAND_FILL; detail.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART; detail.vertical_alignment=VERTICAL_ALIGNMENT_TOP; detail.add_theme_font_size_override("font_size",20); row.add_child(detail)
 var actions=HBoxContainer.new(); column.add_child(actions)
 go=make_button(actions,"Visit",visit_selected); reset_button=make_button(actions,"Reset activity…",request_reset); home=make_button(actions,"Return to Brann",return_home); back=make_button(actions,"Close",close_menu)
 sheet.hide()
func make_button(parent,text,callback):
 var b=Button.new(); b.text=text; b.size_flags_horizontal=Control.SIZE_EXPAND_FILL; b.custom_minimum_size.y=48; b.pressed.connect(callback); parent.add_child(b); return b
func show_menu():
 ids.clear(); places.clear()
 for id in game.scene.zones:
  ids.append(id); places.add_item(str(game.scene.zones[id].get("name",id.capitalize())))
 opened=true; confirming=false; sheet.show(); action_index=0
 if fairy!=null: fairy._focus_lost(); fairy.focused=true
 Input.mouse_mode=Input.MOUSE_MODE_VISIBLE
 select_place(maxi(0,ids.find(game.adventure.zone)))
func select_place(index):
 selected=index; confirming=false; places.select(index); places.ensure_current_is_visible()
 var id=ids[selected]
 detail.text=str(game.scene.zones[id].get("name",id))+"\n\n"+HINTS.get(id,"Explore, gather and try your inventions. Existing world progress stays intact.")+"\n\nTravel moves both companions. Carried fairy cargo is left safely in the old area; browsing never drops it."
 go.text="Visit"; reset_button.text="Reset activity…"; back.text="Close"
 reset_button.disabled=id!="ember_creek" or game.adventure.zone!=id
 if reset_button.disabled: detail.text+="\n\nReset is available for Ember Creek while visiting it; other places retain their existing reset controls."
func close_menu():
 if confirming: select_place(selected); return
 opened=false; sheet.hide()
 if fairy!=null:
  fairy.keys.clear(); fairy.pad_buttons.clear(); fairy.buttons={"dart":true,"ping":true}; fairy._capture_mouse()
func visit_selected():
 if confirming:
  game.ember_creek.reset(); select_place(selected); return
 var id=ids[selected]
 close_menu()
 if id=="ember_creek": game.ember_creek.visit()
 elif id=="ember_gallery": game.ember_gallery.act("visit")
 else: game.adventure.travel(id)
func return_home():
 confirming=false; close_menu(); game.adventure.travel("forge_yard")
func request_reset():
 if reset_button.disabled: return
 confirming=true; go.text="Confirm reset"; back.text="Cancel reset"; reset_button.disabled=true
 detail.text="Reset Ember Creek only?\n\nClear its spilled fuel and close its puzzle gate. You and your companion return to the creek entrance. Held items, inventory, progression and every other area remain unchanged."
 action_index=3; back.grab_focus()
func input_event(event):
 if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode==(KEY_N if fairy!=null else KEY_J):
  if opened: close_menu()
  else: show_menu()
  return true
 if not opened: return false
 if event is InputEventKey or event is InputEventJoypadButton: layer.get_viewport().set_input_as_handled()
 var code=-1
 if event is InputEventJoypadButton and event.pressed: code=event.button_index
 if event is InputEventKey and event.pressed and not event.echo:
  code={KEY_UP:JOY_BUTTON_DPAD_UP,KEY_DOWN:JOY_BUTTON_DPAD_DOWN,KEY_LEFT:JOY_BUTTON_DPAD_LEFT,KEY_RIGHT:JOY_BUTTON_DPAD_RIGHT,KEY_ENTER:JOY_BUTTON_A,KEY_ESCAPE:JOY_BUTTON_B}.get(event.physical_keycode,-1)
 if code==JOY_BUTTON_B: close_menu()
 elif code in [JOY_BUTTON_DPAD_UP,JOY_BUTTON_DPAD_DOWN] and not confirming: select_place(posmod(selected+(-1 if code==JOY_BUTTON_DPAD_UP else 1),ids.size()))
 elif code in [JOY_BUTTON_DPAD_LEFT,JOY_BUTTON_DPAD_RIGHT]:
  action_index=posmod(action_index+(-1 if code==JOY_BUTTON_DPAD_LEFT else 1),4); [go,reset_button,home,back][action_index].grab_focus()
 elif code==JOY_BUTTON_A:
  var button=[go,reset_button,home,back][action_index]
  if not button.disabled: button.pressed.emit()
 return true
