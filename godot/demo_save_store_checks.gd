extends SceneTree
const Store=preload("res://demo_save_store.gd")
var failures=[]
var checks=0
var fixture=""
class PartialWriteStore:
	extends "res://demo_save_store.gd"
	func _write(path:String,text:String)->bool:
		if path.ends_with("progress.json.tmp"):
			var file=FileAccess.open(path,FileAccess.WRITE);file.store_string("{interrupted write");file.close()
			return _fail("io_error","Injected partial temporary write.",true)
		return super._write(path,text)
func _initialize():call_deferred("run")
func valid(data)->bool:
	return data is Dictionary and data.get("won") is bool and (data.get("score") is int or data.get("score") is float) and is_finite(float(data.score)) and data.score>=0 and floorf(float(data.score))==float(data.score)
func check(ok,message):
	checks+=1
	if not ok:failures.append(message)
func write(path,text):
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file=FileAccess.open(path,FileAccess.WRITE);file.store_string(text);file.close()
func wrapper(rev,score=0,schema=1)->String:
	return JSON.stringify({"schema":schema,"kind":"bellworks-demo","revision":rev,"progress":{"won":score>0,"score":score}})
func make_store(name):
	var store=Store.new();check(store.configure(fixture.path_join(name),valid),"Configure isolated "+name);return store
func all_files(path)->Array:
	var files=[];var dir=DirAccess.open(path)
	if dir==null:return files
	for file in dir.get_files():files.append(path.path_join(file))
	for sub in dir.get_directories():files.append_array(all_files(path.path_join(sub)))
	return files
func clean(path):
	# This harness can only remove its own just-created unique temp directory.
	if path!=fixture and not path.begins_with(fixture+"/"):push_error("Unsafe fixture cleanup");return
	var dir=DirAccess.open(path)
	if dir==null:return
	for file in dir.get_files():DirAccess.remove_absolute(path.path_join(file))
	for sub in dir.get_directories():clean(path.path_join(sub))
	DirAccess.remove_absolute(path)
func run():
	var started=Time.get_ticks_usec();var temp=OS.get_environment("TEMP")
	if temp.is_empty():temp=OS.get_environment("TMPDIR")
	if temp.is_empty():push_error("Explicit OS temp directory required for fixture checks");quit(2);return
	fixture=temp.replace("\\","/").path_join("brann-demo-store-"+str(OS.get_process_id())+"-"+str(Time.get_ticks_usec()))
	DirAccess.make_dir_recursive_absolute(fixture)
	var store=Store.new()
	check(not store.configure("",valid),"Empty directory rejected")
	check(not store.configure("relative/save",valid),"Relative directory rejected")
	check(not store.configure("C:/",valid),"Filesystem root rejected")
	check(not store.configure(fixture.path_join("invalid-validator"),Callable()),"Invalid validator rejected")
	store=make_store("fresh");var data=store.load_progress()
	check(data.status=="missing" and data.revision==0 and data.writable and data.data.is_empty(),"Fresh directory is writable without files")
	check(store.save_progress({"won":false,"score":0}),"First atomic save succeeds")
	check(store.revision==1 and store.status=="ready","Store owns initial revision")
	check(store.save_progress({"won":true,"score":3}),"Second atomic save succeeds")
	check(store.revision==2 and FileAccess.file_exists(store.directory.path_join("progress.json.bak")),"Revision increments and last-good backup survives")
	data=store.load_progress();check(data.status=="ready" and data.data.score==3,"Primary round trip")
	var primary=store.directory.path_join("progress.json")
	write(primary+".tmp",wrapper(7,7));write(primary+".bak",wrapper(6,6))
	data=store.load_progress();check(data.status=="recovered" and data.revision==7 and data.data.score==7 and data.source.ends_with(".tmp"),"Highest compatible temporary revision wins")
	check(store.save_progress({"won":true,"score":8}) and store.revision==8,"Save advances recovered revision")
	var backup=JSON.parse_string(FileAccess.get_file_as_string(primary+".bak"))
	check(backup.revision==7 and backup.progress.score==7,"Recovered latest snapshot backed up before temporary overwrite")
	write(primary,"{broken primary");write(primary+".tmp","{broken temp")
	data=store.load_progress();check(data.status=="recovered" and data.revision==7,"Corrupt primary and temp recover backup")
	check(store.save_progress({"won":true,"score":9}),"Recovered state can be committed")
	var archived=all_files(store.directory.path_join("archives"));var preserved=[]
	for path in archived:preserved.append(FileAccess.get_file_as_string(path))
	check("{broken primary" in preserved and "{broken temp" in preserved,"Corrupt bytes preserved before overwrite")
	# Newer incompatible primary blocks older backups and any automatic overwrite.
	var future=wrapper(99,99,2);write(primary,future);write(primary+".tmp",wrapper(100,100));write(primary+".bak",wrapper(98,98))
	data=store.load_progress();check(data.status=="incompatible" and not data.writable and data.data.is_empty(),"Unsupported primary schema blocks silent downgrade")
	check(not store.save_progress({"won":false,"score":0}) and FileAccess.get_file_as_string(primary)==future,"Unsupported primary remains byte-for-byte untouched")
	check(store.reset_progress({"won":false,"score":0}),"Explicit reset may replace unsupported schema")
	data=store.load_progress();check(data.status=="ready" and data.revision==1 and data.data.score==0,"Reset begins clean revision timeline")
	var reset_backup=JSON.parse_string(FileAccess.get_file_as_string(primary+".bak"))
	check(not FileAccess.file_exists(primary+".tmp") and reset_backup.revision==1 and reset_backup.progress.score==0,"Reset retires old candidates and installs fresh reset-era backup")
	archived=all_files(store.directory.path_join("archives"));var found_future=false;var found100=false;var found98=false
	for path in archived:
		var content=FileAccess.get_file_as_string(path)
		found_future=found_future or content==future
		found100=found100 or content==wrapper(100,100)
		found98=found98 or content==wrapper(98,98)
	check(found_future and found100 and found98,"Timestamped pre-reset archive preserves all original candidates")
	var fresh_reader=Store.new();fresh_reader.configure(store.directory,valid);data=fresh_reader.load_progress()
	check(data.data.score==0 and data.revision==1,"Fresh process cannot resurrect archived achievements")
	write(primary,"{corrupt reset-era primary")
	data=fresh_reader.load_progress()
	check(data.status=="recovered" and data.writable and data.revision==1 and data.data.score==0 and data.source.ends_with(".bak"),"Immediately corrupt reset primary recovers writable fresh progress")
	check(fresh_reader.save_progress({"won":false,"score":0}),"Recovered reset-era progress remains saveable without resurrecting rewards")
	# Durable reset intent blocks recovery even with a high-scoring old candidate.
	write(primary+".bak",wrapper(200,200));write(store.directory.path_join("progress.reset.pending"),"interrupted")
	data=store.load_progress();check(data.status=="reset_pending" and not data.writable and data.data.is_empty(),"Interrupted reset forbids recovery of old achievements")
	check(not store.save_progress({"won":true,"score":201}),"Autosave cannot bypass reset marker")
	check(store.reset_progress({"won":false,"score":0}) and store.load_progress().data.score==0,"Explicit reset completes interrupted reset safely")
	# Corruption without fallback requires explicit reset, rather than losing progress.
	var broken=make_store("all-broken");write(broken.directory.path_join("progress.json"),"[]")
	check(broken.load_progress().status=="corrupt" and not broken.writable,"All-corrupt state is observable and protected")
	check(broken.reset_progress({"won":false,"score":0}),"All-corrupt save can be explicitly reset")
	for rev in [-1,1.5,"2",9007199254740992.0]:
		var invalid=make_store("revision-"+str(checks));write(invalid.directory.path_join("progress.json"),wrapper(rev,1))
		check(invalid.load_progress().status=="corrupt","Invalid revision rejected: "+str(rev))
	var bytes=make_store("large-file");write(bytes.directory.path_join("progress.json")," ".repeat(Store.MAX_BYTES+1))
	check(bytes.load_progress().status=="corrupt","Read byte budget enforced")
	var snapshot=FileAccess.get_file_as_string(primary)
	check(not store.save_progress({"won":true,"score":NAN}) and store.status=="invalid_data","Nonfinite payload rejected before serialization")
	check(not store.save_progress({"won":true,"score":2,"runtime":RefCounted.new()}) and store.status=="invalid_data","Runtime objects cannot enter progress")
	check(not store.save_progress({"won":true,"score":2,"text":"é".repeat(70000)}) and store.status=="too_large","UTF-8 bytes enforce write budget")
	check(FileAccess.get_file_as_string(primary)==snapshot,"Rejected payload never overwrites prior progress")
	var obstruction=make_store("obstruction");DirAccess.make_dir_recursive_absolute(obstruction.directory.path_join("progress.json.tmp"))
	check(obstruction.load_progress().status=="io_error" and not obstruction.save_progress({"won":false,"score":0}),"Filesystem obstruction is observable and not destroyed")
	var tie=make_store("tie");write(tie.directory.path_join("progress.json"),wrapper(3,1));write(tie.directory.path_join("progress.json.tmp"),wrapper(3,2))
	check(tie.load_progress().data.score==1,"Primary wins equal-revision ties")
	# Save reloads disk: a second store cannot silently regress a newer revision.
	var second=Store.new();second.configure(tie.directory,valid);second.load_progress();tie.save_progress({"won":true,"score":4})
	check(second.save_progress({"won":true,"score":5}) and second.revision==5,"Sequential writers refresh disk revision")
	var interrupted=PartialWriteStore.new();interrupted.configure(fixture.path_join("interrupted-write"),valid)
	var interrupted_primary=interrupted.directory.path_join("progress.json")
	write(interrupted_primary,wrapper(2,2));write(interrupted_primary+".tmp",wrapper(7,7))
	check(not interrupted.save_progress({"won":true,"score":8}) and interrupted.status=="io_error","Partial temp-write failure is observable")
	var recovery=Store.new();recovery.configure(interrupted.directory,valid);data=recovery.load_progress()
	check(data.status=="recovered" and data.revision==7 and data.data.score==7,"Interrupted overwrite of recovered tmp retains newest backup")
	check(recovery.save_progress({"won":true,"score":8}),"Preserved newest state can commit after failed transaction")
	var reset_fail=make_store("reset-intent-failure");reset_fail.save_progress({"won":true,"score":12})
	var old_bytes=FileAccess.get_file_as_string(reset_fail.directory.path_join("progress.json"))
	DirAccess.make_dir_recursive_absolute(reset_fail.directory.path_join("progress.reset.pending"))
	check(not reset_fail.reset_progress({"won":false,"score":0}),"Reset intent failure refuses partial reset")
	check(FileAccess.get_file_as_string(reset_fail.directory.path_join("progress.json"))==old_bytes,"Failed reset intent leaves original achievement bytes intact")
	var backup_fail=make_store("reset-backup-failure");backup_fail.save_progress({"won":true,"score":12})
	DirAccess.make_dir_recursive_absolute(backup_fail.directory.path_join("progress.json.bak.next"))
	check(not backup_fail.reset_progress({"won":false,"score":0}) and backup_fail.status=="reset_pending" and FileAccess.file_exists(backup_fail.directory.path_join("progress.reset.pending")),"Reset backup failure retains durable reset marker")
	data=backup_fail.load_progress();check(data.status=="reset_pending" and not data.writable,"Backup failure cannot expose unprotected reset primary as ready")
	DirAccess.remove_absolute(backup_fail.directory.path_join("progress.json.bak.next"))
	check(backup_fail.reset_progress({"won":false,"score":0}) and backup_fail.load_progress().data.score==0,"Explicit retry completes fresh primary and backup after backup-stage failure")
	print("DEMO_SAVE_STORE_RESULT ",JSON.stringify({"checks":checks,"failures":failures,"elapsed_seconds":float(Time.get_ticks_usec()-started)/1000000.0,"fixture":fixture}))
	clean(fixture);quit(0 if failures.is_empty() else 1)
