extends RefCounted
## Explicit-directory, JSON-only storage. No game objects or player-save paths.
const MAX_BYTES=128*1024
const MAX_REVISION=9007199254740991
const KIND="bellworks-demo"
var directory=""
var status="unconfigured"
var revision=0
var writable=false
var last_error=""
var validator:Callable
var _configured=false
var _data={}
var _source=""

func configure(path:String,check:Callable)->bool:
	_configured=false;writable=false;revision=0;_data={};_source="";directory="";last_error=""
	var candidate=path.strip_edges().replace("\\","/")
	if candidate.is_empty() or candidate in ["/","user://","res://"]:
		return _fail("invalid_directory","An explicit save subdirectory is required.",false)
	if not candidate.is_absolute_path():return _fail("invalid_directory","Save directory must be absolute.",false)
	candidate=ProjectSettings.globalize_path(candidate).simplify_path().trim_suffix("/")
	if candidate.is_empty() or candidate.ends_with(":") or FileAccess.file_exists(candidate):
		return _fail("invalid_directory","Save directory cannot be a filesystem root or a file.",false)
	if not check.is_valid():return _fail("invalid_validator","A payload validator is required.",false)
	directory=candidate;validator=check;_configured=true;status="configured";writable=true
	return true

func _path(suffix="")->String:return directory.path_join("progress.json"+suffix)
func _marker()->String:return directory.path_join("progress.reset.pending")
func _exists(path)->bool:return FileAccess.file_exists(path) or DirAccess.dir_exists_absolute(path)

func _fail(code:String,message:String,allow_write:bool)->bool:
	status=code;last_error=message;writable=allow_write
	print("DEMO_SAVE ",code," ",message)
	return false

func _result()->Dictionary:
	return {"status":status,"data":_data.duplicate(true),"revision":revision,"source":_source,"writable":writable}

func _json_value(value,depth=0)->bool:
	if depth>32:return false
	match typeof(value):
		TYPE_NIL,TYPE_BOOL,TYPE_INT,TYPE_STRING:return true
		TYPE_FLOAT:return is_finite(value)
		TYPE_ARRAY:
			for item in value:
				if not _json_value(item,depth+1):return false
			return true
		TYPE_DICTIONARY:
			for key in value:
				if not key is String or not _json_value(value[key],depth+1):return false
			return true
	return false

func _payload(data)->bool:
	if not data is Dictionary or not _json_value(data):return false
	var accepted=validator.call(data.duplicate(true))
	return accepted is bool and accepted

func _read(path)->Dictionary:
	if not _exists(path):return {"state":"missing"}
	if DirAccess.dir_exists_absolute(path):return {"state":"io_error","reason":"A recovery filename is a directory."}
	var file=FileAccess.open(path,FileAccess.READ)
	if file==null:return {"state":"io_error","reason":"Cannot read save candidate."}
	if file.get_length()>MAX_BYTES:file.close();return {"state":"corrupt","reason":"Candidate exceeds 128 KiB."}
	var text=file.get_as_text();file.close()
	var parser=JSON.new()
	if parser.parse(text)!=OK:return {"state":"corrupt","reason":"Malformed JSON."}
	var wrapper=parser.data
	if not wrapper is Dictionary:return {"state":"corrupt","reason":"Wrapper is not an object."}
	var schema=wrapper.get("schema")
	if not (schema is int or schema is float) or not is_finite(float(schema)) or floorf(float(schema))!=float(schema):return {"state":"corrupt","reason":"Save schema must be a finite integer."}
	if schema!=1:return {"state":"incompatible","reason":"Unsupported save schema."}
	var kind=wrapper.get("kind")
	if not kind is String:return {"state":"corrupt","reason":"Save kind must be a string."}
	if kind!=KIND:return {"state":"incompatible","reason":"Save belongs to another application."}
	if wrapper.size()!=4:return {"state":"corrupt","reason":"Invalid save wrapper."}
	var value=wrapper.get("revision")
	if not (value is int or value is float) or not is_finite(float(value)) or value<0 or value>MAX_REVISION or floorf(float(value))!=float(value):return {"state":"corrupt","reason":"Revision is not a bounded finite integer."}
	if not _payload(wrapper.get("progress")):return {"state":"corrupt","reason":"Payload validation failed."}
	return {"state":"valid","revision":int(value),"data":wrapper.progress,"path":path}

func load_progress()->Dictionary:
	if not _configured:return _result()
	_data={};revision=0;_source="";last_error=""
	if _exists(_marker()):
		_fail("reset_pending","An interrupted explicit reset must be completed before loading.",false);return _result()
	var candidates=[]
	for suffix in ["",".tmp",".bak"]:candidates.append(_read(_path(suffix)))
	if candidates[0].state=="incompatible":
		_fail("incompatible",candidates[0].reason+" Explicit reset is required.",false);return _result()
	var selected={};var found=false;var io_error=false
	for candidate in candidates:
		if candidate.state!="missing":found=true
		if candidate.state=="io_error":io_error=true
		if candidate.state=="valid" and (selected.is_empty() or candidate.revision>selected.revision):selected=candidate
	if not selected.is_empty():
		_data=selected.data.duplicate(true);revision=selected.revision;_source=selected.path;writable=true
		status="ready" if _source==_path() else "recovered"
	elif not found:status="missing";writable=true
	else:_fail("io_error" if io_error else "corrupt","No readable compatible recovery candidate. Explicit reset is required.",false)
	return _result()

func _write(path:String,text:String)->bool:
	var file=FileAccess.open(path,FileAccess.WRITE)
	if file==null:return _fail("io_error","Cannot open transaction file: "+path,writable)
	file.store_string(text);file.flush();var error=file.get_error();file.close()
	if error!=OK:return _fail("io_error","Cannot flush transaction file: "+str(error),writable)
	return true

func _archive_directory(prefix:String)->String:
	var name=prefix+"-"+Time.get_datetime_string_from_system(true).replace(":","-")+"-"+str(Time.get_ticks_usec())+"-"+str(OS.get_process_id())
	var target=directory.path_join("archives").path_join(name)
	if DirAccess.make_dir_recursive_absolute(target)!=OK:_fail("io_error","Cannot create preservation directory.",writable);return ""
	return target

func _preserve_invalid(path:String)->bool:
	var candidate=_read(path)
	if candidate.state in ["missing","valid"]:return true
	if candidate.state=="io_error":return _fail("io_error","Cannot safely preserve unreadable candidate: "+path,true)
	var archive=_archive_directory("corrupt")
	if archive.is_empty():return false
	var error=DirAccess.rename_absolute(path,archive.path_join(path.get_file()))
	if error!=OK:return _fail("io_error","Cannot preserve invalid candidate: "+str(error),true)
	return true

func _encode(data:Dictionary,next_revision:int)->String:
	if not _payload(data):_fail("invalid_data","Progress is not a valid JSON payload.",writable);return ""
	var text=JSON.stringify({"schema":1,"kind":KIND,"revision":next_revision,"progress":data})
	if text.to_utf8_buffer().size()>MAX_BYTES:_fail("too_large","Save exceeds 128 KiB.",writable);return ""
	return text

func save_progress(data:Dictionary)->bool:
	if not _configured:return _fail("unconfigured","Configure an explicit save directory first.",false)
	# Refresh revisions and incompatibility protection before every transaction.
	load_progress()
	if not writable:return false
	if revision>=MAX_REVISION:return _fail("revision_exhausted","Revision range exhausted; explicit reset required.",false)
	var next_revision=revision+1;var text=_encode(data,next_revision)
	if text.is_empty():return false
	if DirAccess.make_dir_recursive_absolute(directory)!=OK:return _fail("io_error","Cannot create save directory.",true)
	# Preserve the highest accepted candidate before overwriting a recovered .tmp.
	if not _source.is_empty() and _source!=_path(".bak"):
		if not _preserve_invalid(_path(".bak")):return false
		var staging=_path(".bak.next")
		if DirAccess.copy_absolute(_source,staging)!=OK:return _fail("io_error","Cannot prepare last-good backup.",true)
		if DirAccess.rename_absolute(staging,_path(".bak"))!=OK:return _fail("io_error","Cannot install last-good backup.",true)
	for suffix in ["",".tmp",".bak"]:
		if not _preserve_invalid(_path(suffix)):return false
	if not _write(_path(".tmp"),text):return false
	if DirAccess.rename_absolute(_path(".tmp"),_path())!=OK:return _fail("io_error","Final rename failed; recoverable temporary save retained.",true)
	revision=next_revision;_data=data.duplicate(true);_source=_path();status="ready";last_error="";writable=true
	return true

func reset_progress(data:Dictionary)->bool:
	if not _configured:return _fail("unconfigured","Configure an explicit save directory first.",false)
	var text=_encode(data,1)
	if text.is_empty():return false
	if DirAccess.make_dir_recursive_absolute(directory)!=OK:return _fail("io_error","Cannot create reset directory.",false)
	var staging=directory.path_join("progress.reset.new")
	if not _write(staging,text):return false
	var archive=_archive_directory("pre-reset")
	if archive.is_empty():return false
	# A durable marker blocks old-candidate recovery if reset is interrupted.
	var marker_temp=directory.path_join("progress.reset.intent")
	if not _write(marker_temp,JSON.stringify({"archive":archive,"schema":1})):return false
	if DirAccess.rename_absolute(marker_temp,_marker())!=OK:return _fail("io_error","Cannot commit reset intent.",false)
	writable=false
	for suffix in ["",".tmp",".bak"]:
		var path=_path(suffix)
		if not _exists(path):continue
		if DirAccess.rename_absolute(path,archive.path_join(path.get_file()))!=OK:return _fail("reset_pending","Reset interrupted while preserving old candidates.",false)
	if DirAccess.rename_absolute(staging,_path())!=OK:return _fail("reset_pending","Reset data is staged but not installed.",false)
	# Recovery must remain writable even if the very first reset-era primary corrupts.
	var backup_staging=_path(".bak.next")
	if DirAccess.dir_exists_absolute(backup_staging):return _fail("reset_pending","Reset-era backup staging path is obstructed.",false)
	if DirAccess.copy_absolute(_path(),backup_staging)!=OK:return _fail("reset_pending","Reset primary installed but reset-era backup could not be staged.",false)
	var reset_backup=_read(backup_staging)
	if reset_backup.state!="valid" or reset_backup.revision!=1:return _fail("reset_pending","Reset-era backup validation failed.",false)
	if DirAccess.rename_absolute(backup_staging,_path(".bak"))!=OK:return _fail("reset_pending","Reset-era backup could not be installed.",false)
	if DirAccess.remove_absolute(_marker())!=OK:return _fail("reset_pending","Reset committed but intent cleanup failed.",false)
	revision=1;_data=data.duplicate(true);_source=_path();status="ready";last_error="";writable=true
	return true
