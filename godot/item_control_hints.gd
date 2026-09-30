extends RefCounted
## Explicit bindings for the 20 native review-catalogue items. A generated
## invention keeps its authored instructions; we do not rewrite VR trigger
## prose into desktop buttons because its installed route may differ.
const SIEGEBIRD="20dc22c5-7bcc-43df-b07f-e81eab521b0f"
const DESKTOP={
	"starter_hammer":"LMB strike · RMB Forge Pulse (3s)",
	"apprentice_hammer":"LMB strike · RMB Forge Pulse (3s)",
	"woodland_axe":"LMB swing/chop · hold RMB through LMB contact for Power Cleave",
	"quarry_pick":"LMB mine · RMB charge resonance (8s), then strike ore",
	"grappling_hook":"LMB attach, hold to reel, release to pause · RMB detach",
	"spore_lantern":"Carry for light · RMB plant a slowing spore garden (6s)",
	"crystal_resonator":"LMB strike · RMB resonance fan/open seals (3s)",
	"ember_gauntlet":"LMB strike · RMB firebolt and brief ward (3s)",
	"glowmoth":"LMB swing · RMB release/recall the light moth",
	"stormbell":"LMB strike to charge · aim + RMB to release concussive chime",
	"forge_lantern_sol":"LMB toggle the brass shutter and light",
	"forge_lantern_opus":"LMB toggle the brass shutter and light",
	"wyrmspout_v2":"Hold LMB for dragon fire · release to cool · RMB vent heat",
	"emberwing":"Hold LMB to draw, release to fire · hold RMB and turn for phoenix arc",
	"sunskipper":"LMB change power / recall in flight · Q/R bank",
	"copper_kite":"LMB pull/drop a marked block · X toss held block",
	"guardian_shield_mossward":"LMB bash · RMB Rootbeat guard",
	"guardian_shield_prismwatch":"LMB bash · RMB Prism Chime",
	"guardian_shield_cinderkeep":"LMB bash · RMB Bellows Bash",
}
const VR={
	"starter_hammer":"Swing to strike · trigger: Forge Pulse (3s)",
	"apprentice_hammer":"Swing to strike · trigger: Forge Pulse (3s)",
	"woodland_axe":"Swing to chop · hold trigger during contact: Power Cleave",
	"quarry_pick":"Swing to mine · trigger charges resonance for 8s; strike ore",
	"grappling_hook":"Aim + trigger to attach · hold trigger to reel · release to pause · let go to detach",
	"spore_lantern":"Carry for light · trigger plants a slowing spore garden (6s)",
	"crystal_resonator":"Swing to strike · trigger: resonance fan/open seals (3s)",
	"ember_gauntlet":"Swing to strike · trigger: firebolt and brief ward (3s)",
	"glowmoth":"Trigger releases or recalls the light moth",
	"stormbell":"Swing to charge · aim + trigger to release concussive chime",
	"forge_lantern_sol":"Trigger toggles light · free hand can grip and pull the brass shutter",
	"forge_lantern_opus":"Trigger toggles light · free hand can grip and pull the brass shutter",
	"wyrmspout_v2":"Hold trigger for dragon fire · release to cool · right B vents heat",
	"emberwing":"Grip bow and string · draw and release to fire · bend for phoenix arc",
	"sunskipper":"Trigger changes power / recalls in flight · release grip to throw · wrist banks",
	"copper_kite":"Trigger pulls/drops a marked block · A tosses held block",
	"guardian_shield_mossward":"Face the shield to block · swing to bash · trigger: Rootbeat guard",
	"guardian_shield_prismwatch":"Face the shield to block · swing to bash · trigger: Prism Chime",
	"guardian_shield_cinderkeep":"Face the shield to block · swing to bash · trigger: Bellows Bash",
}

static func has(id: String) -> bool:
	return id==SIEGEBIRD or id=="siegebird" or DESKTOP.has(id) or VR.has(id)

static func desktop_movement() -> String:
	return "WASD move · Space jump"

static func desktop_release(item: Node3D) -> String:
	if not is_instance_valid(item): return "E take"
	var id:=str(item.get_meta("id",""))
	if id=="sunskipper": return "E throw"
	if id=="copper_kite": return "E drop" # Its X action tosses captured cargo.
	return "E drop · X throw"

static func _desktop_tail(item: Node3D) -> String:
	return " · "+desktop_release(item)+" · Space jump · F1 controls"

static func desktop(game, item: Node3D, hand: Node3D) -> String:
	if not is_instance_valid(item): return desktop_movement()+" · LMB use · "+desktop_release(item)+" · F1 controls"
	var id:=str(item.get_meta("id",""))
	if id==SIEGEBIRD or id=="siegebird" or item.get_meta("crossbow",false):
		var w=game.siegebird.desktop_weapon(hand) if game.siegebird!=null else null
		var state:="reloading" if w!=null and w.get("desktop_reloading",false) else ("cycling" if w!=null and float(w.get("release",0.0))>0.0 else ("ready" if w!=null and w.loaded else ("cocked · R seat bolt" if w!=null and float(w.get("draw",0.0))>=0.999 else "empty · R reload")))
		var reel:="C at rack: fit reel"
		if w!=null and w.reel_installed:
			reel="tethered · LMB release line · hold R reel · C at rack return reel" if game.siegebird.extras.tethered(w) else ("%s bolts · RMB switch mode · C at rack return reel"%("grapple" if w.grapple_mode else "standard"))
		return "Siegebird %s · LMB fire · unlimited bolts · %s%s"%[state,reel,_desktop_tail(item)]
	if id=="woodland_axe":
		return ("POWER CLEAVE READY · " if item.get_meta("axe_power_ready",false) else "")+DESKTOP[id]+_desktop_tail(item)
	if DESKTOP.has(id): return DESKTOP[id]+_desktop_tail(item)
	if item.has_meta("use_instructions"):
		return "LMB use · RMB alternate where supported"+_desktop_tail(item)
	return "LMB use"+_desktop_tail(item)

static func vr(_game, item: Node3D) -> String:
	if not is_instance_valid(item): return "Grip an item to use it"
	var id:=str(item.get_meta("id",""))
	if id==SIEGEBIRD or id=="siegebird" or item.get_meta("crossbow",false):
		return "Trigger fires/releases tether · free hand cranks and seats unlimited belt bolts · fit reel and flip brass selector for grapple bolts"
	if VR.has(id): return VR[id]
	return str(item.get_meta("use_instructions","Grip to carry · trigger uses the item's installed action"))
