extends Node
## Small persistent quest journal; service owns rewards and progression.
const OUTBOX="user://quest_outbox.json"
var game
var data={}
var index=0
var outbox=[]
var sending=false
var action_pending=false
var retry_at=0.0
var session=str(Time.get_unix_time_from_system())+"-"+str(OS.get_process_id())
var sequence=0
var revision=-1
var celebration_until=0.0
var test_events=false

func setup(g):
	game=g
	if not game.diagnostic_offline and not game.smoke and FileAccess.file_exists(OUTBOX):
		var bytes=FileAccess.get_file_as_bytes(OUTBOX)
		if bytes.size()<512*1024:
			var saved=JSON.parse_string(bytes.get_string_from_utf8())
			if saved is Array:
				for event in saved.slice(0,2048):
					if event is Dictionary and event.get("eventId") is String and event.get("kind")=="enemy" and event.get("target") in ["rat","skeleton","golem","ghost","minotaur","ember_warden"]: outbox.append(event)
	print("QUEST_READY pending_events=",outbox.size())

func _save():
	if game.diagnostic_offline or game.smoke: return
	var file=FileAccess.open(OUTBOX+".tmp",FileAccess.WRITE)
	if file==null: push_warning("QUEST_OUTBOX cannot save"); return
	file.store_string(JSON.stringify(outbox)); file.close()
	if DirAccess.rename_absolute(OUTBOX+".tmp",OUTBOX)!=OK: push_warning("QUEST_OUTBOX cannot replace save")

func enemy_defeated(enemy,kind:String):
	if (game.diagnostic_offline or game.smoke) and not test_events: return
	if kind=="boss": kind="ember_warden"
	if kind not in ["rat","skeleton","golem","ghost","minotaur","ember_warden"]: return
	if enemy.get_meta("quest_death_recorded",false): return
	if outbox.size()>=2048: game._notice("Quest journal is full while offline. Reconnect to save more hunt progress.",6); return
	enemy.set_meta("quest_death_recorded",true)
	sequence+=1
	outbox.append({"eventId":"hunt-"+session+"-"+str(sequence),"kind":"enemy","target":kind})
	_save()

func tick(_delta):
	if not sending and not outbox.is_empty() and game.elapsed>=retry_at and not game.diagnostic_offline: _flush.call_deferred()

func _flush():
	if sending or outbox.is_empty(): return
	sending=true
	var event=outbox[0]
	var response=await game._request("/api/vr/quests/event",event)
	if response.has("error"):
		retry_at=game.elapsed+4
		if not response.get("transportError",false):
			print("QUEST_EVENT_REJECTED id=",event.eventId," reason=",response.error)
			retry_at=game.elapsed+30
			game._notice("Hunt progress is queued. The forge could not save it yet.",5)
	else:
		ingest(response.get("rpg",{}),true)
		if int(response.get("xpAwarded",0))>0 and game.elapsed>=celebration_until: game._notice("+%d XP · %s"%[response.xpAwarded,level_line()],3)
		outbox.pop_front(); _save()
	sending=false

func ingest(value:Dictionary,_announce=false):
	if value.is_empty() or int(value.get("revision",0))<revision: return
	var previous=data; var first=previous.is_empty()
	var changed=int(value.get("revision",0))!=revision
	data=value.duplicate(true); revision=int(value.get("revision",0))
	if not first:
		if int(data.get("level",1))>int(previous.get("level",1)):
			celebration_until=game.elapsed+6
			game._notice("Level %d · %s!"%[data.level,data.get("title","Adventurer")],6)
			game.adventure.haptic(game.qol.dominant_hand(),"ready")
			game._effect(game.camera.global_position-game.camera.global_basis.z,Color("ead085"),0.4,0.25)
		for quest in data.get("quests",[]):
			if quest.get("status")=="ready" and not previous.get("quests",[]).any(func(q):return q.id==quest.id and q.get("status")=="ready"):
				celebration_until=game.elapsed+6
				game._notice(str(quest.name)+" complete · return to Brann for your XP.",6)
	if changed and game.qol.page=="journal" and game.qol.opened: game.qol._build()

func level_line()->String:
	return "Level %d · %d / %d XP"%[data.get("level",1),data.get("levelXp",0),data.get("nextLevelXp",100)]

func selected()->Dictionary:
	var quests=data.get("quests",[])
	if quests.is_empty(): return {}
	index=posmod(index,quests.size()); return quests[index]

func rows()->Array:
	var quest=selected(); var status=quest.get("status","available")
	var label="Accept job" if status=="available" else ("Collect XP" if status=="ready" else "In progress")
	return [["Previous job","quest:previous"],["Next job","quest:next"],[label,"quest:primary"],["Abandon job","quest:abandon"]]

func journal()->String:
	var hollow_line = "\n\n" + game.adventure.hollow.journal_line() if game != null and game.adventure != null and game.adventure.hollow != null else ""
	if data.is_empty(): return "FIELD JOURNAL\nConnect to the forge to load jobs and experience." + hollow_line
	var quest=selected()
	if quest.is_empty(): return level_line()+"\nNo jobs available." + hollow_line
	var location={"skeleton":"Pinewood Ruins","rat":"Enchanted Kitchen","lumber":"Pinewood Ruins","stone":"Sandstone Quarry"}.get(str(quest.get("target","")),"Explore the world")
	var status=str(quest.get("status","available"))
	var hint="Accept near Brann before setting out." if status=="available" else ("Return to Brann to collect your reward." if status=="ready" else "Progress stays saved between visits.")
	return "%s · %s\n\n%s  [%d/%d]\n%s\n%d / %d · %s · Reward %d XP\n%s%s"%[level_line(),data.get("title","Adventurer"),quest.get("name","Job"),index+1,data.quests.size(),location+" · "+("Defeat " if quest.get("kind")=="enemy" else "Gather ")+str(quest.get("target","")).replace("_"," "),quest.get("progress",0),quest.get("goal",3),status.capitalize(),quest.get("xpReward",0),hint,hollow_line]

func act(action:String):
	if action=="previous": index-=1; game.qol._build(); return
	if action=="next": index+=1; game.qol._build(); return
	if action_pending: return
	var quest=selected()
	if quest.is_empty(): game._notice("Connect to the forge to load your journal."); return
	var status=str(quest.get("status","available"))
	if action=="primary" and status=="active": game._notice("%s · %d / %d"%[quest.name,quest.progress,quest.goal]); return
	if action=="abandon" and status=="available": game._notice("This job has not been accepted."); return
	var verb="abandon" if action=="abandon" else ("claim" if status=="ready" else "accept")
	if verb!="abandon" and (game.adventure.zone!="forge_yard" or game.camera.global_position.distance_to(game.scene.brann.global_position+Vector3.UP*1.3)>3.5):
		game._notice("Come back to Brann to "+("collect your XP." if verb=="claim" else "accept a job."),5); return
	action_pending=true
	await game._send_context()
	sequence+=1
	var payload={"action":verb,"id":quest.id,"requestId":"quest-"+session+"-"+str(sequence)}
	if verb!="accept": payload["instanceId"]=quest.get("instanceId","")
	var response=await game._request("/api/vr/quests/action",payload)
	if response.has("error"): game._notice(str(response.error),5)
	else:
		ingest(response.get("rpg",{}),true)
		if game.elapsed>=celebration_until: game._notice(("Job accepted · " if verb=="accept" else ("Job completed · " if verb=="claim" else "Job abandoned · "))+str(quest.name)+( " · +"+str(response.get("xpAwarded",quest.get("xpReward",0)))+" XP" if verb=="claim" else ""),5)
		await game._poll()
	action_pending=false
