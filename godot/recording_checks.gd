extends SceneTree
var recorder
var host
var failures=[]
class Host extends Node:
	var smoke=false
	var diagnostic_offline=false
	var vr=false
	var hands=[]
	var camera=Camera3D.new()
	func _ready(): add_child(camera)
func _initialize():
	call_deferred("run")
func _process(delta):
	if recorder!=null: recorder.tick(delta)
	return false
func check(condition:bool,label:String):
	if not condition: failures.append(label)
func run():
	host=Host.new();root.add_child(host)
	recorder=load("res://recording_runtime.gd").new();host.add_child(recorder)
	check(not recorder.accepts_hotkey("left_hand"),"left B excluded")
	check(recorder.accepts_hotkey("right_hand"),"right B accepted")
	check(not recorder.hold_input(true,1.0),"startup held button ignored")
	recorder.hold_input(false,0.01)
	for i in range(8): check(not recorder.hold_input(true,0.1),"short press ignored")
	recorder.hold_input(false,0.01)
	var count=0
	for i in range(40):
		if recorder.hold_input(true,0.1): count+=1
	check(count==1,"one toggle per hold")
	recorder.hold_input(false,0.01)
	for i in range(12):
		if recorder.hold_input(true,0.1): count+=1
	check(count==2,"release rearms")
	if not OS.get_cmdline_user_args().has("--live-obs-check"):
		print("RECORDING_CHECK ",JSON.stringify(failures))
		quit(0 if failures.is_empty() else 1)
		return
	recorder.setup(host)
	await create_timer(2.0).timeout
	check(recorder.identified,"OBS authenticated")
	var initial=await recorder._rpc("GetRecordStatus")
	if initial.get("outputActive",false): failures.append("Refused to interrupt existing recording")
	elif recorder.identified:
		await recorder.toggle_recording()
		check(recorder.active,"OBS started")
		await create_timer(3.0).timeout
		check(recorder.duration>0,"confirmed timer advances")
		await recorder.toggle_recording()
		check(not recorder.active,"OBS stopped")
		check(not recorder.last_path.is_empty() and FileAccess.file_exists(recorder.last_path),"output exists")
		var f=FileAccess.open("res://../logs/obs-test-output.txt",FileAccess.WRITE)
		f.store_string(recorder.last_path)
	print("RECORDING_CHECK ",JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)

