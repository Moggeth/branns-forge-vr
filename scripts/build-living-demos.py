"""Deterministic offline demo content. Source and native copy always match."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
PACKAGES=[]
def c(component_type,**config): return {"type":component_type,"version":1,"config":config}
def e(identifier,name,pos,size=(.35,.35,.35),color="#c6a66b",material="wood",shape="box",static=True,components=()):
    return dict(id=identifier,name=name,shape=shape,position=list(pos),size=list(size),color=color,material=material,static=static,components=list(components))
def p(identifier,name,brief,kind="device",version=1,parents=(),arena=True):
    result=dict(schema=1,id=identifier,version=version,name=name,kind=kind,scope={"kind":"region","targetId":identifier},
        provenance={"prompt":brief,"interpretation":brief,"origin":"demo","parentIds":list(parents)},
        dependencies=[{"id":"living-climb-arena","version":1}] if arena else [],
        entities=[],links=[],rules=[],region={"origin":[120,0,0],"spawn":[120,0,0],"size":[64,18,64]})
    PACKAGES.append(result)
    return result
def a(op,target,**values): return dict(op=op,target=target,**values)
def rule(pack,event,target,*actions): pack["rules"].append(dict(event=event,target=target,actions=list(actions)))
def link(pack,identifier,source,target,kind,**config): pack["links"].append(dict(id=identifier,**{"from":source},to=target,type=kind,config=config))

q=p("living-climb-arena","The Open-Hand Test Garden","A reversible 64 metre garden with climbable stepped towers, grappling anchors, broad landings and a return gate. Grip the bronze reel, trigger a tower to attach, then hold trigger to reel. Grip jade walls with empty hands to climb.",kind="region",arena=False)
q["entities"].append(e("garden-floor","The test garden",(0,-.2,0),(64,.4,64),"#8c9d7b","stone"))
for i,(x,z,sx,sz) in enumerate([(0,-32,64,.4),(0,32,64,.4),(-32,0,.4,64),(32,0,.4,64)]):
    q["entities"].append(e("boundary-"+str(i),"Garden boundary",(x,.5,z),(sx,1,sz),"#899584","stone"))
q["entities"] += [
    e("return-gate","RETURN TO BRANN · point and trigger",(-3,1.2,-2),(1.8,2.4,.25),"#62c5b5","crystal",components=[c("portal",destination=[-9,0,2],radius=1.3)]),
    e("grapple-table","Climbing equipment",(3,.5,-2),(2,1,1),"#735b3e"),
    e("garden-reel","BRONZE REEL · grip, aim, trigger; hold to reel",(3,1.3,-2),(.3,.24,.45),"#c19146","iron",static=False,components=[c("grabbable",mass=.5),c("grapple",range=40,reelSpeed=2.4)])]
for side in [-1,1]:
    q["entities"].append(e("return-pillar-"+str(side+1),"Return gate pillar",(-3+side*1.02,1.3,-2),(.25,2.6,.4),"#7c8a7e","stone"))
q["entities"].append(e("return-lintel","Return gate lintel",(-3,2.68,-2),(2.35,.25,.4),"#c1ae7a","stone"))
for i in range(4):
    h=2+i*2
    q["entities"].append(e("tower-"+str(i),"Climb or grapple · landing "+str(i+1),(10+i*4,h/2,10),(3.4,h,5),"#8c9991","stone",components=[c("climbable")]))
    q["entities"].append(e("anchor-"+str(i),"Grapple anchor "+str(i+1),(10+i*4,h+.6,10),(.45,1.2,.45),"#d6b567","iron",shape="cylinder",components=[c("climbable")]))
for i in range(12):
    q["entities"].append(e("step-"+str(i),"Broad practice step",(4+i*.33,(i+1)*.08,10),(1.1,(i+1)*.16,5),"#a4ae99","stone"))
q["entities"] += [
    e("summit-beacon","THE LONG REACH · trigger at the summit",(22,8.6,11),(.35,.8,.35),"#81d9c7","crystal",components=[c("trigger",event="arrived")]),
    e("summit-objective","Reach the summit · trigger the beacon",(1,1,-2),(.25,1,.25),"#c3ae78","stone",components=[c("objective",event="arrived",count=1,target="summit-beacon")])]
rule(q,"arrived","summit-beacon",a("set_color","summit-beacon",color="#ffd06d"))

q=p("living-material-garden","Fire, Water and New Growth","Warm the wood with the ember stone, cool it using the water cistern, cut it with the pruner and repair or grow it with a wand. These transformations affect garden objects only.")
q["entities"] += [
    e("timber","Practice timber · burns, cuts, repairs and grows",(-16,1,8),(.9,2,.9),"#987449",components=[c("material",ignition=35,conductivity=.1,absorption=.8,hardness=1)]),
    e("ember-stone","TRIGGER · warm the timber",(-19,1,7),(.5,.6,.5),"#dc6b35","stone",components=[c("trigger",event="triggered")]),
    e("water-cistern","TRIGGER · send water to the timber",(-19,1,10),(.8,1,.8),"#5aafb2","iron",shape="cylinder",components=[c("reservoir",capacity=10,amount=10),c("trigger",event="triggered")]),
    e("pruning-tool","PRUNER · grip; point and trigger to cut",(-16,1,5),(.15,.65,.1),"#c6b17f","iron",static=False,components=[c("grabbable",mass=.3),c("transformer",operation="cut",amount=.35)]),
    e("repair-wand","MENDER · grip; point and trigger to repair",(-15,1,5),(.12,.6,.12),"#70d8b4","crystal",static=False,components=[c("grabbable",mass=.2),c("transformer",operation="repair",amount=.35)]),
    e("growth-wand","GREEN FINGER · grip; point and trigger to grow",(-14,1,5),(.12,.6,.12),"#99c957","wood",static=False,components=[c("grabbable",mass=.2),c("transformer",operation="grow",amount=.2)]),
    e("material-table","Tools for the living wood",(-15,.45,5),(4,.9,1),"#685439"),
    e("growth-leaf","A sprout with a useful future",(-13,.35,8),(.5,.7,.5),"#7cab56",components=[c("material",ignition=45,absorption=.7,hardness=1)])]
rule(q,"triggered","ember-stone",a("heat","timber",value=80))
rule(q,"triggered","water-cistern",a("wet","timber",value=40))
link(q,"irrigation","water-cistern","growth-leaf","fluid",rate=.3)

q=p("living-flow-engine","The Copper Heart Engine","Trigger the copper heart to power a lamp and lift a gate through visible connections. A reservoir feeds a receiving bowl. Trigger the motor to turn its wheel.")
q["entities"] += [
    e("heart","TRIGGER · power the copper heart",(-15,1,-12),(.6,.8,.6),"#c9854a","iron",components=[c("trigger",event="triggered"),c("receiver",kind="light",color="#ffa344",power=0)]),
    e("lamp","Connected lamp",(-12,1.3,-12),(.35,.6,.35),"#8da693","crystal",components=[c("receiver",kind="light",color="#e0b763",power=0)]),
    e("gate","Power opens this gate",(-9,1,-12),(1.4,2,.2),"#697c75","iron",components=[c("receiver",kind="door",power=0)]),
    e("motor","TRIGGER · start the wheel",(-15,1,-16),(.8,.8,.3),"#bfa675","iron",shape="cylinder",components=[c("trigger",event="triggered"),c("receiver",kind="motor",power=0)]),
    e("cistern","Water source",(-12,1.3,-16),(.8,1,.8),"#66b4b3","iron",shape="cylinder",components=[c("reservoir",capacity=10,amount=10)]),
    e("bowl","Receiving bowl · fills from the source",(-9,.6,-16),(1,.6,1),"#ad8555","iron",shape="cylinder",components=[c("reservoir",capacity=10,amount=0)]),
    e("engine-objective","Power the connected lamp",(-17,1,-12),(.3,.8,.3),"#d7c58e","stone",components=[c("objective",event="powered",target="lamp",count=1)])]
rule(q,"triggered","heart",a("power","heart",value=10))
rule(q,"triggered","motor",a("power","motor",value=8))
link(q,"heart-lamp","heart","lamp","energy",conductance=.8)
link(q,"lamp-gate","lamp","gate","energy",conductance=.8)
link(q,"water-pipe","cistern","bowl","fluid",rate=.8)

q=p("living-signal-companions","The Lantern and the Listener","Trigger the bell and watch the brass listener investigate. A motion-sensing lantern notices visitors. The jade companion follows you; the violet companion keeps its distance.")
q["entities"] += [
    e("bell","TRIGGER · ring for the listener",(13,1,-14),(.5,.7,.5),"#d3ac55","iron",shape="cylinder",components=[c("trigger",event="triggered"),c("emitter",kind="sound",signal="sound",interval=60,strength=30)]),
    e("listener","The brass listener · investigates nearby sounds",(17,.4,-14),(.65,.8,.65),"#cbaa65","iron",shape="sphere",components=[c("creature",mode="investigate",speed=.8,radius=12),c("sensor",kind="sound",radius=12,threshold=.05,signal="heard")]),
    e("follower","The jade follower · likes your company",(20,.4,-14),(.65,.8,.65),"#7ebf99","crystal",shape="sphere",components=[c("creature",mode="follow",speed=.7,radius=12)]),
    e("shy-one","The shy violet companion · give it space",(24,.4,-14),(.65,.8,.65),"#ae91be","crystal",shape="sphere",components=[c("creature",mode="flee",speed=.65,radius=5)]),
    e("sensor","Motion-sensing lantern",(17,1,-19),(.4,1,.4),"#d3b48a","crystal",components=[c("sensor",kind="motion",radius=5,threshold=.1,signal="visitor"),c("receiver",kind="light",color="#ffd47a",power=0)]),
    e("listener-objective","Ring the bell three times",(13,1,-16),(.3,.8,.3),"#9d9276","stone",components=[c("objective",event="triggered",target="bell",count=3)])]
rule(q,"triggered","bell",a("emit","bell",signal="sound",value=10))
rule(q,"sensed","sensor",a("power","sensor",value=8))
link(q,"bell-lantern","bell","sensor","signal",conductance=1)

q=p("living-local-fields","A Pocket of Moonlight","A low-gravity field changes loose objects inside its radius. Lift and drop the little moons. The veil dims only this experiment's objects, never the player's whole view.")
q["entities"] += [
    e("moon-well","Low-gravity well · drop the moons nearby",(0,.15,18),(1.3,.3,1.3),"#a696d2","crystal",shape="cylinder",components=[c("field",kind="gravity",radius=6,strength=.2)]),
    e("veil","TRIGGER · toggle the local veil",(-4,1,18),(.3,1,.3),"#b9b0dd","crystal",components=[c("trigger",event="triggered"),c("field",kind="visibility",radius=5,strength=.35)])]
for i in range(3): q["entities"].append(e("moon-"+str(i),"A little moon · grip and release",(-1+i,2,18),(.4,.4,.4),"#d2cfe7","stone",shape="sphere",static=False,components=[c("grabbable",mass=.3)]))
rule(q,"triggered","veil",a("toggle","veil"))

q=p("living-maker-tools","Tools That Make Tools","Grip the amber recorder: trigger once, move through a gesture, then trigger again to replay it. The joiner links two selected objects. The paintbrush makes the selected practice wall climbable.")
q["entities"] += [
    e("maker-table","Tools that make tools",(0,.45,-18),(5,.9,1.2),"#70563d"),
    e("recorder","GESTURE SEED · grip; trigger, move, trigger to replay",(-1.5,1.2,-18),(.22,.3,.22),"#e3b45c","crystal",static=False,components=[c("grabbable",mass=.2),c("maker",mode="record")]),
    e("joiner","JOINER · grip; trigger two separate targets",(0,1.2,-18),(.15,.5,.15),"#d39665","iron",static=False,components=[c("grabbable",mass=.3),c("maker",mode="join")]),
    e("paintbrush","CLIMB BRUSH · grip; point and trigger",(1.5,1.2,-18),(.15,.5,.15),"#75c4b2",static=False,components=[c("grabbable",mass=.2),c("maker",mode="paint")]),
    e("join-block-a","First joining block",(-2,.5,-22),(.7,.7,.7),"#a98054",static=False,components=[c("grabbable",mass=.5)]),
    e("join-block-b","Second joining block",(0,.5,-22),(.7,.7,.7),"#cca877",static=False,components=[c("grabbable",mass=.5)]),
    e("paint-wall","Paint this wall to climb it",(3,1.5,-22),(3,3,.5),"#8c9c91","stone"),
    e("maker-objective","Give the wall a new purpose",(3,1,-19),(.3,.8,.3),"#b8ab7b","stone",components=[c("objective",event="painted",target="paint-wall",count=1)])]

q=p("living-weakspot-yard","The Glass-Eye Practice Yard","A golden weak spot rewards precision. Grip the practice lance and trigger while pointing at the head or body. The head multiplies damage; the green switch repairs the target.")
q["entities"] += [
    e("target-body","Practice construct · ordinary damage",(-19,1,21),(.8,1.6,.5),"#71857e","iron",components=[c("material",hardness=1)]),
    e("target-head","Golden eye · precision weak spot",(-19,2.1,21),(.5,.5,.5),"#eec775","crystal",shape="sphere",components=[c("weakpoint",multiplier=3),c("material",hardness=1)]),
    e("practice-lance","GLASS EYE · grip, aim, trigger",(-16,1,20),(.12,.6,.12),"#bfcfe0","crystal",static=False,components=[c("grabbable",mass=.3),c("transformer",operation="cut",amount=.2)]),
    e("repair-target","TRIGGER · repair the target",(-16,1,22),(.3,.5,.3),"#7abb9a","crystal",components=[c("trigger",event="triggered")])]
rule(q,"triggered","repair-target",a("repair","target-body",value=100),a("repair","target-head",value=100))

q=p("living-moon-gloves","Moonweaver Gloves","Try a reversible turquoise hand appearance, slightly larger visual gloves and softer finger curl. This changes presentation and movement settings through a supported profile; tracked controller input stays intact.")
q["scope"]={"kind":"world","targetId":"player"}
q["entities"].append(e("glove-totem","Moonweaver glove profile · remove through the archive",(4,1,0),(.4,.6,.4),"#78c8cb","crystal",components=[c("embodiment",handColor="#78c8cb",handScale=1.05,fingerCurl=.9,moveSpeed=2.0)]))

q=p("living-lantern-seed","Lantern Seed · First Spark","A small grabbable crystal lamp. Trigger it to kindle a glow. This first version remains in history when its next version becomes a companion.",kind="item")
q["entities"].append(e("seed","LANTERN SEED · grip; trigger to light",(1,1.1,4),(.3,.45,.3),"#a5c7b0","crystal",static=False,components=[c("grabbable",mass=.3),c("receiver",kind="light",color="#ffce83",power=0),c("trigger",event="triggered")]))
rule(q,"triggered","seed",a("power","seed",value=8))
q=p("living-lantern-seed","Lantern Seed · Little Companion","Keep the first lantern's crystal identity and give its next version a friendly following behaviour. Trigger still lights it. The archive preserves the earlier version, and held copies defer replacement.",kind="item",version=2,parents=["living-lantern-seed@1"])
q["entities"].append(e("seed","LITTLE COMPANION · grip or let it follow",(1,1.1,4),(.4,.55,.4),"#a5c7b0","crystal",static=False,components=[c("grabbable",mass=.3),c("receiver",kind="light",color="#ffce83",power=0),c("trigger",event="triggered"),c("creature",mode="follow",speed=.7,radius=10)]))
rule(q,"triggered","seed",a("power","seed",value=8))

# Standalone examples remain source-controlled inputs to the common catalog.
for filename in ["living_unfinished_lullaby.json", "living_returning_demo.json"]:
    PACKAGES.append(json.loads((ROOT/"godot"/filename).read_text(encoding="utf-8")))

encoded=json.dumps(PACKAGES,indent=2,ensure_ascii=False)+"\n"
for path in [ROOT/"service/living-demo-packages.json",ROOT/"godot/living_demo_packages.json"]:
    path.write_text(encoded,encoding="utf-8",newline="\n")
print(json.dumps({"packages":len(PACKAGES),"entities":sum(len(q["entities"]) for q in PACKAGES),"bytes":len(encoded.encode("utf-8"))}))
