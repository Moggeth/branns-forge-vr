extends Node
## A bounded archive viewport over an unbounded history: only six exhibits loaded.
const PAGE_SIZE=6
const TEXT_PAGE=360
const SAVE="user://living_museum_homes.json"
var game
var root:Node3D
var entry_gate:Node3D
var snapshot={}
var entries=[]
var page=0
var selected_key=""
var text_page=0
var demo_page=0
var demos=[]
var labels={}
var stands=[]
var demo_buttons=[]
var next_refresh=0.0
var publishing=false
var visit_id="living-climb-arena"
var home_order=[]

func setup(owner_game):
	game=owner_game
	if not game.diagnostic_offline and FileAccess.file_exists(SAVE):
		var saved=JSON.parse_string(FileAccess.get_file_as_string(SAVE))
		if saved is Array: home_order=saved
	root=Node3D.new(); root.name="HallOfInventions"
	game.adventure.zone_groups.forge_yard.add_child(root)
	# The forge's west collection stands and destination portals already fill the
	# proposed corner. A pocket hall preserves both instead of burying them.
	root.position=Vector3(-120,0,0)
	_build_hall()
	entry_gate=_gate(game.adventure.zone_groups.forge_yard,Vector3(-11,0,1),"enter","HALL OF INVENTIONS","History & experiments · point and trigger")
	entry_gate.rotation.y=PI/2
	_gate(root,Vector3(4.1,0,0.2),"leave","BACK TO BRANN","Current tools: named collection stands")
	print("LIVING_MUSEUM_READY page_size=6 model_loading=on_request audio_recording=false")

func _text(parent,text,pos,size=22,width=650)->Label3D:
	var label=WorkshopScene.label(parent,text,pos,size)
	label.pixel_size=0.0027; label.width=width
	label.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	label.double_sided=false
	return label

func _button(parent,action,pos,text,width=1.0)->Node3D:
	var button=Node3D.new(); parent.add_child(button); button.position=pos
	button.set_meta("kind","button"); button.set_meta("action","museum:"+action)
	WorkshopScene.box(button,Vector3.ZERO,Vector3(width,0.19,0.09),WorldZones.mat("35675e"))
	WorkshopScene.collision(button,Vector3.ZERO,Vector3(width,0.19,0.09))
	_text(button,text,Vector3(0,0,0.051),18,int(width/0.0027)-12)
	return button

func _panel(pos:Vector3)->Node3D:
	var panel=Node3D.new(); root.add_child(panel); panel.position=pos; panel.rotation.y=PI
	WorkshopScene.box(panel,Vector3.ZERO,Vector3(3.6,2.5,0.16),WorldZones.mat("253f40"))
	WorkshopScene.collision(panel,Vector3.ZERO,Vector3(3.6,2.5,0.16))
	for x in [-1.85,1.85]:
		WorldZones.box(panel,Vector3(x,0,0),Vector3(0.12,2.7,0.18),"9e7644")
	return panel

func _gate(parent,pos,action,title,hint)->Node3D:
	var gate=Node3D.new(); parent.add_child(gate); gate.position=pos
	gate.set_meta("kind","button"); gate.set_meta("action","museum:"+action)
	for side in [-1,1]:
		WorldZones.box(gate,Vector3(side*.82,1.25,0),Vector3(.22,2.5,.3),"596f6a")
		WorldZones.box(gate,Vector3(side*.82,2.4,0),Vector3(.34,.14,.4),"c7a76b")
	WorldZones.box(gate,Vector3(0,2.58,0),Vector3(1.9,.22,.3),"596f6a")
	var glass=WorldZones.box(gate,Vector3(0,1.3,0),Vector3(1.45,2.3,.055),"538b84",.25)
	glass.material_override=glass.material_override.duplicate()
	glass.material_override.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA; glass.material_override.albedo_color.a=.35
	WorkshopScene.collision(gate,Vector3(0,1.25,0),Vector3(1.65,2.5,.13))
	_text(gate,title,Vector3(0,2.1,.18),25,700)
	_text(gate,hint,Vector3(0,.85,.18),19,600)
	return gate

func _build_hall():
	WorldZones.box(root,Vector3(0,-0.15,10),Vector3(11,0.3,25),"b0a589")
	WorldZones.body(root,Vector3(0,-0.15,10),Vector3(11,0.3,25),"solid")
	# Clear middle aisle; rear archive remains spacious for future installations.
	for side in [-1,1]:
		WorldZones.box(root,Vector3(side*5.5,0.55,10),Vector3(0.35,1.1,25),"6b7570")
		WorldZones.body(root,Vector3(side*5.5,0.55,10),Vector3(0.35,1.1,25),"solid")
		for z in [0,6,12,18,22]:
			WorldZones.box(root,Vector3(side*5.25,2,z),Vector3(0.32,4,0.32),"665039")
			WorldZones.box(root,Vector3(side*5.25,3.4,z),Vector3(0.55,0.3,0.55),"b18b52")
			WorldZones.rock(root,Vector3(side*5.1,2.7,z),Vector3(0.16,0.28,0.16),"84dfd0")
	for z in [0,12,22]: WorldZones.box(root,Vector3(0,4,z),Vector3(10.8,0.22,0.3),"665039")
	WorldZones.box(root,Vector3(0,0.01,10),Vector3(2.8,0.014,24),"426960")
	var entrance=Node3D.new(); root.add_child(entrance); entrance.rotation.y=PI
	var hall_name=_text(entrance,"THE HALL OF INVENTIONS",Vector3(0,3.4,0),56,2400); hall_name.pixel_size=0.004
	_text(entrance,"Every idea leaves a trace",Vector3(0,3.05,0),32,1400)
	_text(entrance,"Version archive here · current equipment remains on the collection stands beside Brann",Vector3(0,2.76,0),21,2200)
	var archive=_panel(Vector3(-2.45,1.7,3.6))
	labels.title=_text(archive,"THE ARCHIVE",Vector3(0,1.03,0.1),29,1250)
	labels.detail=_text(archive,"Your creations and their history will appear here.",Vector3(0,0.40,0.1),21,1170)
	labels.page=_text(archive,"",Vector3(0,-0.43,0.1),16,1180)
	_button(archive,"remove",Vector3(0,-0.16,0.13),"REMOVE ACTIVE EXPERIMENT",2.4)
	_button(archive,"text_previous",Vector3(-1.2,-0.72,0.13),"PREV",0.65)
	_button(archive,"retrieve",Vector3(0,-0.72,0.13),"RETRIEVE VERSION",1.55)
	_button(archive,"text_next",Vector3(1.2,-0.72,0.13),"NEXT",0.65)
	_button(archive,"previous",Vector3(-0.94,-1.02,0.13),"EARLIER HOMES",1.55)
	_button(archive,"next",Vector3(0.94,-1.02,0.13),"LATER HOMES",1.55)
	var lab=_panel(Vector3(2.45,1.7,3.6))
	_text(lab,"THE POSSIBLE WORKSHOP",Vector3(0,1.04,0.1),27,1200)
	_text(lab,"Working experiments · introduce during play",Vector3(0,0.77,0.1),18,1190)
	for i in range(4): demo_buttons.append(_button(lab,"demo:"+str(i),Vector3(0,0.44-i*0.29,0.13),"Waiting for catalogue",3.05))
	_button(lab,"demo_previous",Vector3(-1.12,-0.82,0.13),"PREV",0.7)
	_button(lab,"visit",Vector3(0,-0.82,0.13),"ENTER EXPERIMENT",1.4)
	_button(lab,"demo_next",Vector3(1.12,-0.82,0.13),"NEXT",0.7)
	labels.status=_text(lab,"",Vector3(0,-1.1,0.1),16,1190)
	var lens=_button(entrance,"lens",Vector3(-4.1,1.35,0.4),"ANCESTRY LENS · ON / OFF",2.0)
	_text(lens,"Point and trigger an invention\nto inspect its causes",Vector3(0,-0.28,0.05),18,800)
	for side in [-1,1]:
		for z in [6,14,21]:
			WorldZones.box(root,Vector3(side*5.05,2.65,z),Vector3(0.025,1.65,0.85),"426f68")
			WorldZones.box(root,Vector3(side*5.02,2.0,z),Vector3(0.03,0.06,0.87),"d3ae6b")
	for i in range(PAGE_SIZE):
		var stand=Node3D.new(); root.add_child(stand)
		stand.position=Vector3(-3.7 if i%2==0 else 3.7,0,7+floori(i/2.0)*4.2)
		stand.rotation.y=PI
		WorldZones.cyl(stand,Vector3(0,0.5,0),0.61,1,"77796c")
		WorldZones.cyl(stand,Vector3(0,1.03,0),0.7,0.12,"b39a68")
		WorldZones.body(stand,Vector3(0,0.5,0),Vector3(1.25,1,1.25),"solid")
		var token=WorldZones.rock(stand,Vector3(0,1.48,0),Vector3(0.40,0.54,0.40),"80bfae")
		var title=_text(stand,"UNWRITTEN",Vector3(0,2.03,0.68),23,650)
		var status=_text(stand,"Room for your next idea",Vector3(0,1.78,0.68),17,650)
		_button(stand,"select:"+str(i),Vector3(-0.39,1.15,0.69),"STORY",0.72)
		_button(stand,"take:"+str(i),Vector3(0.39,1.15,0.69),"RETRIEVE",0.72)
		var excerpt=_text(stand,"",Vector3(0,0.72,0.70),17,650)
		stands.append({"root":stand,"title":title,"status":status,"token":token,"excerpt":excerpt})

func key(entry:Dictionary)->String:
	return str(entry.get("id",""))+"@"+str(entry.get("version",1))

func page_count()->int:
	return maxi(1,ceili(entries.size()/float(PAGE_SIZE)))

func visible_entries()->Array:
	return entries.slice(page*PAGE_SIZE,mini(entries.size(),(page+1)*PAGE_SIZE))

func selected()->Dictionary:
	for entry in entries:
		if key(entry)==selected_key: return entry
	return {}

func sync(state:Dictionary):
	snapshot=state
	# The service history is append-only. Never sort by title or changing timestamps.
	entries=[]
	for value in state.get("history",[]):
		if value is Dictionary:
			var entry=value.get("package",value)
			if entry is Dictionary and not str(entry.get("id","")).is_empty(): entries.append(entry)
	var changed=false
	for entry in entries:
		if not home_order.has(key(entry)): home_order.append(key(entry)); changed=true
	entries.sort_custom(func(a,b): return home_order.find(key(a))<home_order.find(key(b)))
	if changed and game!=null and not game.diagnostic_offline and not game.smoke:
		var file=FileAccess.open(SAVE+".tmp",FileAccess.WRITE)
		if file!=null:
			file.store_string(JSON.stringify(home_order)); file.close()
			if DirAccess.rename_absolute(SAVE+".tmp",SAVE)!=OK: push_error("LIVING_MUSEUM home registry save failed")
	page=clampi(page,0,page_count()-1)
	if selected().is_empty() and not entries.is_empty(): selected_key=key(entries[0])
	var catalog=state.get("catalog",{})
	demos=catalog.get("demoPackages",state.get("demoPackages",[]))
	if demos is not Array: demos=[]
	if demos.is_empty() and FileAccess.file_exists("res://living_demo_packages.json"):
		var local=JSON.parse_string(FileAccess.get_file_as_string("res://living_demo_packages.json"))
		if local is Array: demos=local
	_refresh()

func _description(entry:Dictionary)->String:
	var provenance=entry.get("provenance",{})
	var origin=str(provenance.get("origin","reconstructed"))
	var prompt=str(provenance.get("prompt",entry.get("brief","No original request was recorded.")))
	var interpretation=str(provenance.get("interpretation","No implementation summary recorded."))
	var ancestry=", ".join(PackedStringArray(provenance.get("parentIds",[])))
	var heading="ORIGINAL REQUEST" if origin=="player" else ("EXAMPLE REQUEST" if origin=="demo" else "RECOVERED RECORD · NOT A VERIFIED TRANSCRIPT")
	var actual="Legacy generated model; inspect its recorded brief and creation history."
	if entry.get("entities") is Array:
		var capabilities=[]
		for entity in entry.entities:
			for component in entity.get("components",[]):
				if not capabilities.has(str(component.type)): capabilities.append(str(component.type))
		actual="%d entities · %d connections · %d rules\nCapabilities: %s"%[entry.entities.size(),entry.get("links",[]).size(),entry.get("rules",[]).size(),", ".join(PackedStringArray(capabilities))]
	var evidence=[]
	for transcript in snapshot.get("transcripts",[]):
		if provenance.get("transcriptIds",[]).has(transcript.get("id","")): evidence.append(str(transcript.get("role","speaker"))+": "+str(transcript.get("text","")))
	if not evidence.is_empty(): prompt="\n".join(PackedStringArray(evidence)); heading="CAPTURED CONVERSATION TEXT"
	return heading+"\n"+prompt+"\n\nBRANN'S INTERPRETATION\n"+interpretation+"\n\nRECORDED CHANGES\n"+actual+"\n\nANCESTRY\n"+(ancestry if not ancestry.is_empty() else "First recorded generation")+"\n\nAudio is retained only with an explicit recording choice."

func _refresh():
	if labels.is_empty(): return
	var entry=selected()
	if not entry.is_empty():
		var text=_description(entry)
		var pages=maxi(1,ceili(text.length()/float(TEXT_PAGE)))
		text_page=clampi(text_page,0,pages-1)
		labels.title.text=str(entry.get("name",entry.id))+" · v"+str(entry.get("version",1))
		labels.detail.text=text.substr(text_page*TEXT_PAGE,TEXT_PAGE)
		labels.page.text="Story %d/%d · Archive bay %d/%d · %d versions"%[text_page+1,pages,page+1,page_count(),entries.size()]
	var visible=visible_entries()
	for i in range(stands.size()):
		var stand=stands[i]
		if i>=visible.size():
			stand.title.text="UNWRITTEN"; stand.status.text="Room for your next idea"; stand.token.visible=false; stand.excerpt.text=""
			continue
		var item=visible[i]; var deployment=snapshot.get("deployments",{}).get(str(item.id),{})
		var state=str(deployment.get("status","archived")) if int(deployment.get("version",-1))==int(item.get("version",1)) else "archived"
		stand.title.text="%03d · %s\nv%d"%[page*PAGE_SIZE+i+1,str(item.get("name",item.id)),int(item.get("version",1))]
		stand.status.text=state.to_upper(); stand.token.visible=true
		stand.excerpt.text=str(item.get("provenance",{}).get("prompt","Recovered design record")).left(150) if key(item)==selected_key else ("Retrieve the creation at its collection stand" if item.get("kind","")=="legacy" else "Retrieve activates this version in its world location")
		stand.token.material_override=WorldZones.mat("81cfa5" if state=="applied" else ("e7bd72" if state in ["staged","deferred"] else "a5b0b9"))
	var demo_pages=maxi(1,ceili(demos.size()/4.0)); demo_page=clampi(demo_page,0,demo_pages-1)
	for i in range(demo_buttons.size()):
		var index=demo_page*4+i
		for child in demo_buttons[i].get_children():
			if child is Label3D: child.text=str(demos[index].get("name","Experiment")) if index<demos.size() else "—"
	var statuses=[]
	for id in snapshot.get("deployments",{}):
		var deployment=snapshot.deployments[id]
		if deployment.get("status","") in ["staged","deferred","rejected"]: statuses.append(str(id)+": "+str(deployment.status)+" · "+str(deployment.get("reason","")))
	labels.status.text=str(statuses[-1]).left(120) if not statuses.is_empty() else "Experiments %d/%d · Ready to request"%[demo_page+1,demo_pages]

func trigger(hand,target)->bool:
	if target==null: return false
	var action=str(target.get_meta("action",""))
	if not action.begins_with("museum:"): return false
	if not game.button_feedback.press(target,hand): return true
	act(action.trim_prefix("museum:"))
	return true

func act(action:String):
	if action=="previous": page=maxi(0,page-1)
	elif action=="next": page=mini(page_count()-1,page+1)
	elif action=="text_previous": text_page=maxi(0,text_page-1)
	elif action=="text_next": text_page+=1
	elif action=="demo_previous": demo_page=maxi(0,demo_page-1)
	elif action=="demo_next": demo_page+=1
	elif action.begins_with("select:"):
		var index=page*PAGE_SIZE+int(action.trim_prefix("select:"))
		if index<entries.size():
			selected_key=key(entries[index]); text_page=0
			if entries[index].has("region"): visit_id=str(entries[index].id)
	elif action.begins_with("take:"):
		var index=page*PAGE_SIZE+int(action.trim_prefix("take:"))
		if index<entries.size(): selected_key=key(entries[index]); text_page=0; game.living.request_version(entries[index])
	elif action=="retrieve":
		var entry=selected()
		if not entry.is_empty(): game.living.request_version(entry)
	elif action=="remove":
		var entry=selected()
		if not entry.is_empty() and entry.get("kind","")!="legacy": game.living.rollback(str(entry.id),0)
	elif action=="lens":
		game.living.inspect_enabled=not game.living.inspect_enabled
		game._notice("Ancestry lens "+("on · point and trigger to inspect" if game.living.inspect_enabled else "off"))
	elif action=="visit": visit_experiment()
	elif action=="enter": game.living.safe_travel(Vector3(-120,0,0))
	elif action=="leave": game.living.safe_travel(Vector3(-9,0,2))
	elif action.begins_with("demo:"):
		var index=demo_page*4+int(action.trim_prefix("demo:"))
		if index<demos.size(): _publish_demo(demos[index])
	_refresh()

func _publish_demo(package:Dictionary):
	if publishing: game._notice("The previous experiment is still being submitted."); return
	publishing=true
	if package.has("region"): visit_id=str(package.id)
	# Dependencies publish first; activation remains authoritative in the runtime.
	for dependency in package.get("dependencies",[]):
		for candidate in demos:
			if candidate.id==dependency.id and int(candidate.version)==int(dependency.version): await game.living.publish(candidate)
	for candidate in demos:
		if candidate.id==package.id and int(candidate.version)<int(package.version): await game.living.publish(candidate)
	await game.living.publish(package)
	publishing=false

func tick(_delta):
	if game.elapsed<next_refresh: return
	next_refresh=game.elapsed+0.5
	_refresh()

func checks(failures:Array):
	var original_entries=entries; var original_page=page; var original_selection=selected_key
	entries=[]
	for i in range(137): entries.append({"id":"museum-check-"+str(i),"version":1})
	page=22
	if page_count()!=23 or visible_entries().size()!=5: failures.append("museum bounded pagination beyond 100 versions")
	selected_key=key(entries[130]); var original_key=selected_key
	entries.append({"id":"museum-new","version":1})
	if key(selected())!=original_key: failures.append("museum stable selection changed after append")
	if key({"id":"same","version":1})==key({"id":"same","version":2}): failures.append("museum versions collide")
	var missing=_description({"id":"old","version":1})
	if not missing.contains("NOT A VERIFIED TRANSCRIPT"): failures.append("museum invented transcript provenance")
	entries=original_entries; page=original_page; selected_key=original_selection; _refresh()

func visit_experiment()->bool:
	var id=visit_id
	if not game.living.active.has(id):
		game._notice("Prepare that experiment first, then wait until it is active.",5)
		return false
	var region=game.living.active[id].manifest.get("region",{})
	var spawn=region.get("spawn",region.get("origin",[]))
	if not spawn is Array or spawn.size()!=3:
		game._notice("That experiment has no visitor landing.",5)
		return false
	return game.living.safe_travel(Vector3(float(spawn[0]),float(spawn[1]),float(spawn[2])))
