// The Timberline's flip-up "Wirewidth" sight (2026-11-11), replacing the tall brass range ladder and its number plates.
//
// What the operator sees, sighting from the eye point (Socket_ScopeEye) 0.7 m behind the leaf:
//  - a slim V of brass bars hanging below the sight line. Each bar is a range (25 to 300 m): put the target on the
//    glowing pip in the bar's middle and the pair comes down on it. The pip heights are the same honest holdovers as the
//    old ladder rungs (client/timberline-ladder.js, from the shared flight), so the shot itself is unchanged.
//  - each bar is exactly as wide as the bolts' wire is at that range, so the V narrows with distance. Anything between
//    the bar's tips gets caught by the wire, and a man-sized foe (about a wire wide) that fills a bar is at that range.
//  - each bar's number rides on a small leaf-shaped tab off one tip (alternating sides), blued iron with the figures cut
//    in and filled with blue resonance; the V's two rails end in brass fir-tip finials. Nothing stands beside the aim.
//
// Mechanism: the leaf hinges on a pin between two iron standards. A crank under the knuckle is tied by a push-rod to a
// thumb lever at the operator's end, so the leaf lies folded flat when the machine stands idle and is thrown up when
// someone takes the seat; the lever and rod follow the leaf through the real linkage geometry every frame.
// Everything is parented to the machine's Elevation node, so it pitches with the rails and renders every frame.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {TIMBERLINE_LADDER,ladderMarks} from './timberline-ladder.js';
import {TIMBERLINE_LONG} from '../shared/timberline-flight.js';

// Three.js Elevation frame: x right, y up, z backwards (towards the operator). The kit's Blender frame is y forward.
const EYE_Y=TIMBERLINE_LADDER.eye.z,EYE_Z=-TIMBERLINE_LADDER.eye.y,LEAF_Z=-TIMBERLINE_LADDER.ladderY,THROW=EYE_Z-LEAF_Z;
const HINGE_Y=.17,STANDARD_X=.034;
const LEVER={pivot:new THREE.Vector2(.10,.26),arm:.034,handle:.075}; // (y, z) in the Elevation frame
const CRANK=new THREE.Vector2(-.03,.004);                           // leaf-local (y, z) of the push-rod pin
export const FLIP_SIGHT=Object.freeze({hingeY:HINGE_Y,leafZ:LEAF_Z,raised:0,folded:-Math.PI/2+.06,
 stiffness:150,damping:13,tabW:.018,tabH:.0098,wireHalf:TIMBERLINE_LONG.boltHalf});

// Half-width of a range bar: the pair's wire half-span seen from the eye, projected onto the leaf.
export const barHalfWidth=range=>FLIP_SIGHT.wireHalf/range*THROW;

let marks=null;const sightMarks=()=>marks||(marks=ladderMarks());

// --- geometry helpers ----------------------------------------------------------------------------------------------
const _a=new THREE.Vector3(),_b=new THREE.Vector3(),_q=new THREE.Quaternion(),_up=new THREE.Vector3(0,1,0);
function rod(a,b,r,seg=6){const g=new THREE.CylinderGeometry(r,r,1,seg,1,false);_a.set(...a);_b.set(...b);const len=_a.distanceTo(_b);
 g.scale(1,len,1);_q.setFromUnitVectors(_up,_b.clone().sub(_a).normalize());g.applyQuaternion(_q);g.translate((_a.x+_b.x)/2,(_a.y+_b.y)/2,(_a.z+_b.z)/2);return g;}
function box(w,h,d,x,y,z){const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);return g;}
function barrel(r,len,x,y,z,seg=10){const g=new THREE.CylinderGeometry(r,r,len,seg);g.rotateZ(Math.PI/2);g.translate(x,y,z);return g;}
function knob(r,x,y,z){const g=new THREE.SphereGeometry(r,10,8);g.translate(x,y,z);return g;}
// A pip: a small triangular prism standing on its bar, tip exactly on the aim height.
function pip(y,z){const s=new THREE.Shape();s.moveTo(-.003,-.0032);s.lineTo(.003,-.0032);s.lineTo(0,0);s.closePath();
 const g=new THREE.ExtrudeGeometry(s,{depth:.0024,bevelEnabled:false});g.translate(0,y,z-.0012);return g;}
const merge=list=>{const g=mergeGeometries(list.map(x=>x.index?x.toNonIndexed():x),false);list.forEach(x=>x.dispose());g.computeVertexNormals();return g;};

// Number tabs: a leaf outline (stem end at the bar tip, pointed outer end), flat, in leaf-local metres.
function tabShape(x0,side,yc){const W=FLIP_SIGHT.tabW,H=FLIP_SIGHT.tabH,u=t=>x0+side*t*W,s=new THREE.Shape(),pts=[
  [0,-.28],[.12,-.5],[.72,-.5],[1,0],[.72,.5],[.12,.5],[0,.28]];
 pts.forEach(([t,v],i)=>{const x=u(t),y=yc+v*H;i?s.lineTo(x,y):s.moveTo(x,y);});s.closePath();return s;}
// One atlas for all seven tabs: blued iron with a brass rim, the figures cut in (colour) and glowing (emissive).
function tabAtlas(list){const CW=192,CH=104,col=document.createElement('canvas'),glow=document.createElement('canvas');
 for(const c of [col,glow]){c.width=CW;c.height=CH*list.length;}const x=col.getContext('2d'),gx=glow.getContext('2d');
 gx.fillStyle='#000';gx.fillRect(0,0,CW,CH*list.length);
 list.forEach((m,i)=>{const y=i*CH,g=x.createLinearGradient(0,y,0,y+CH);g.addColorStop(0,'#59606b');g.addColorStop(1,'#2f333a');x.fillStyle=g;x.fillRect(0,y,CW,CH);
  x.strokeStyle='#d6a654';x.lineWidth=7;x.strokeRect(3,y+3,CW-6,CH-6);
  for(const [ctx,fill] of [[x,'#a6e4ff'],[gx,'#5cc4ff']]){ctx.font='700 74px Georgia, serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=fill;ctx.fillText(String(m.range),CW*.46,y+CH/2+4);}});
 const make=c=>{const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;};return {map:make(col),emissiveMap:make(glow)};}

// Shared per-kit pieces, built once.
let kit=null;
function buildKit(materials){
 const L=sightMarks(),brass=materials.TL_Brass,iron=materials.TL_Iron;
 const glow=new THREE.MeshStandardMaterial({name:'TL_SightPip',color:0x0a2a55,emissive:0x5cc4ff,emissiveIntensity:1.4,roughness:.4,metalness:.2,toneMapped:false,fog:true});
 // Fixed: iron standards from the cradle to the hinge, brass knuckles and pin heads.
 const fixedIron=[],fixedBrass=[];
 for(const sx of [-1,1]){fixedIron.push(box(.012,HINGE_Y-.005,.022,sx*STANDARD_X,(HINGE_Y-.005)/2,LEAF_Z),box(.026,.008,.04,sx*STANDARD_X,.004,LEAF_Z));
  fixedBrass.push(barrel(.0105,.012,sx*STANDARD_X,HINGE_Y,LEAF_Z),barrel(.006,.004,sx*(STANDARD_X+.008),HINGE_Y,LEAF_Z));}
 fixedIron.push(barrel(.0034,STANDARD_X*2+.02,0,HINGE_Y,LEAF_Z,8));
 // Lever post at the operator's end.
 fixedIron.push(box(.016,LEVER.pivot.x,.018,0,LEVER.pivot.x/2,LEVER.pivot.y),box(.03,.008,.034,0,.004,LEVER.pivot.y));fixedBrass.push(barrel(.007,.024,0,LEVER.pivot.x,LEVER.pivot.y));
 // Leaf (local to the hinge axis): knuckle, foot plate, V rails, range bars, crank.
 const leafIron=[barrel(.0095,STANDARD_X*2-.016,0,0,0),box(.05,.016,.006,0,.012,0),box(.008,.03,.006,0,-.012,.006),
  rod([0,0,0],[0,CRANK.x,CRANK.y],.004)],leafBrass=[],leafGlow=[];
 const top=L[0],bottom=L[L.length-1],rail=[],y=m=>m.z-HINGE_Y;
 for(const m of L)rail.push([barHalfWidth(m.range)+.0022,y(m)]);
 rail.unshift([rail[0][0]+.0006,y(top)+.007]);rail.push([.004,y(bottom)-.014],[.004,.02]);
 for(const sx of [-1,1])for(let i=0;i<rail.length-1;i++)leafBrass.push(rod([sx*rail[i][0],rail[i][1],0],[sx*rail[i+1][0],rail[i+1][1],0],.0016,5));
 for(const m of L){const w=barHalfWidth(m.range);leafBrass.push(box(2*w+.0044,.0016,.0024,0,y(m)-.004,0));leafGlow.push(pip(y(m),0));}
 // Brass fir-tip finials capping the V's rails just above the nearest bar.
 for(const sx of [-1,1]){const fx=sx*rail[0][0],fy=rail[0][1],t=new THREE.Shape();
  [[0,0],[.0036,.0035],[.0016,.0035],[.0042,.0075],[.0014,.0075],[.0026,.011],[0,.016],[-.0026,.011],[-.0014,.0075],[-.0042,.0075],[-.0016,.0035],[-.0036,.0035]].forEach(([u,v],i)=>i?t.lineTo(fx+u*.8,fy+v*.8):t.moveTo(fx+u*.8,fy+v*.8));t.closePath();
  const g=new THREE.ExtrudeGeometry(t,{depth:.002,bevelEnabled:false});g.translate(0,0,-.001);leafBrass.push(g);}
 // Number tabs off alternate bar tips: 25 m on the right, 50 m on the left, and so on down the V.
 const tex=tabAtlas(L),tabs=L.map((m,i)=>{const side=i%2?-1:1,x0=side*(barHalfWidth(m.range)+.0028),yc=y(m)-.004,g=new THREE.ExtrudeGeometry(tabShape(x0,side,yc),{depth:.0018,bevelEnabled:false});
  g.translate(0,0,-.0009);const pos=g.attributes.position,uv=g.attributes.uv;
  for(let j=0;j<pos.count;j++){const u=(pos.getX(j)-x0)*side/FLIP_SIGHT.tabW,v=(pos.getY(j)-yc)/FLIP_SIGHT.tabH+.5;uv.setXY(j,side>0?u:1-u,1-(i+1-v)/L.length);}
  return g;});
 const tabMat=new THREE.MeshStandardMaterial({name:'TL_SightTabs',map:tex.map,emissiveMap:tex.emissiveMap,emissive:0xffffff,emissiveIntensity:1.1,metalness:.55,roughness:.45,fog:true});
 const ears=[{geometry:merge(tabs),material:tabMat,textures:[tex.map,tex.emissiveMap]}];
 // Moving linkage: push-rod (unit length along +y, scaled each frame) and thumb lever (local to its pivot).
 const pushRod=new THREE.CylinderGeometry(.0028,.0028,1,6);pushRod.translate(0,.5,0);
 const lever=merge([rod([0,0,0],[0,LEVER.handle,0],.0045,6),barrel(.0036,.012,0,LEVER.arm,0,8)]),leverKnob=knob(.009,0,LEVER.handle+.004,0);
 kit={glow,brass,iron,fixedIron:merge(fixedIron),fixedBrass:merge(fixedBrass),leafIron:merge(leafIron),leafBrass:merge(leafBrass),leafGlow:merge(leafGlow),ears,pushRod,lever,leverKnob,
  rodLength:null};
 return kit;}

const mesh=(g,m,name)=>{const o=new THREE.Mesh(g,m);o.name=name;o.userData.ignoreContact=true;o.castShadow=false;o.receiveShadow=true;return o;};

// Linkage: given the leaf angle, where the crank pin is (Elevation frame, (y, z)).
function crankPin(theta,out=new THREE.Vector2()){const c=Math.cos(theta),s=Math.sin(theta);
 return out.set(HINGE_Y+CRANK.x*c-CRANK.y*s,LEAF_Z+CRANK.x*s+CRANK.y*c);}
// The lever pin for lever angle phi (0 = upright, positive tips the handle towards the operator).
const leverPin=(phi,out=new THREE.Vector2())=>out.set(LEVER.pivot.x+LEVER.arm*Math.cos(phi),LEVER.pivot.y+LEVER.arm*Math.sin(phi));
// Solve the four-bar: the lever angle whose pin sits exactly a rod length from the crank pin (bisection, monotonic here).
function solveLever(theta,len){const p=crankPin(theta),q=new THREE.Vector2();let lo=-1.4,hi=1.4;
 const f=phi=>leverPin(phi,q).distanceTo(p)-len;const flo=f(lo);
 for(let i=0;i<24;i++){const m=(lo+hi)/2;if(Math.sign(f(m))===Math.sign(flo))lo=m;else hi=m;}return (lo+hi)/2;}

export const _linkage={crankPin,leverPin,solveLever};

// nodes: the machine's node map (createTimberlineBallista). Hides the kit's ladder and mounts the flip-up sight on
// the Elevation node. Returns {object, update(dt, raised, sighting), raise(instant), angle} or null without the kit nodes.
export function addFlipSight(nodes){
 const elev=nodes.Elevation;if(!elev)return null;
 const materials={};for(const o of Object.values(nodes))if(o?.isMesh)for(const m of [o.material].flat())if(m?.name)materials[m.name]=m;
 if(!materials.TL_Brass||!materials.TL_Iron)return null;
 // Retire the old ladder, eye rest and plates (kept in the kit for history; the sockets stay for the eye point).
 if(nodes.Scope){nodes.Scope.visible=false;nodes.Scope.traverse(o=>{if(o.isMesh){o.visible=false;o.layers.disableAll();}});}
 const k=kit||buildKit(materials);
 const group=new THREE.Group();group.name='TimberlineFlipSight';group.userData.ignoreContact=true;
 group.add(mesh(k.fixedIron,k.iron,'FlipSightStandards'),mesh(k.fixedBrass,k.brass,'FlipSightKnuckles'));
 const leaf=new THREE.Group();leaf.name='FlipSightLeaf';leaf.position.set(0,HINGE_Y,LEAF_Z);group.add(leaf);
 const glow=k.glow.clone();
 leaf.add(mesh(k.leafIron,k.iron,'FlipSightLeafIron'),mesh(k.leafBrass,k.brass,'FlipSightBars'),mesh(k.leafGlow,glow,'FlipSightPips'));
 for(const e of k.ears)leaf.add(mesh(e.geometry,e.material,'FlipSightTabs'));
 const leverG=new THREE.Group();leverG.name='FlipSightLever';leverG.position.set(0,LEVER.pivot.x,LEVER.pivot.y);group.add(leverG);
 leverG.add(mesh(k.lever,k.iron,'FlipSightLeverArm'),mesh(k.leverKnob,k.brass,'FlipSightLeverKnob'));
 const pushRod=mesh(k.pushRod,k.iron,'FlipSightPushRod');group.add(pushRod);
 // The rod is cut to length with the leaf raised and the lever leaning slightly back.
 if(k.rodLength===null)k.rodLength=crankPin(FLIP_SIGHT.raised).distanceTo(leverPin(-.2));
 elev.add(group);
 let angle=FLIP_SIGHT.folded,vel=0,sightGlow=0;const p=new THREE.Vector2(),q=new THREE.Vector2(),dir=new THREE.Vector3(),_y=new THREE.Vector3(0,1,0);
 function pose(){leaf.rotation.x=angle;const phi=solveLever(angle,k.rodLength);leverG.rotation.x=phi;
  crankPin(angle,p);leverPin(phi,q);pushRod.position.set(0,p.x,p.y);dir.set(0,q.x-p.x,q.y-p.y);const len=dir.length();
  pushRod.scale.set(1,len,1);pushRod.quaternion.setFromUnitVectors(_y,dir.normalize());}
 pose();
 return {object:group,leaf,
  get angle(){return angle;},
  // raised: someone is in the seat. sighting: 0..1, the local operator's sighting amount (wakes the pips).
  update(dt,raised,sighting=0){const target=raised?FLIP_SIGHT.raised:FLIP_SIGHT.folded;dt=Math.min(dt,.05);
   if(Math.abs(target-angle)>1e-4||Math.abs(vel)>1e-4){vel+=(FLIP_SIGHT.stiffness*(target-angle)-FLIP_SIGHT.damping*vel)*dt;angle+=vel*dt;
    // The leaf stops hard against its stop when thrown up (a small bounce, not a spring through the stop).
    if(angle>FLIP_SIGHT.raised){angle=FLIP_SIGHT.raised;vel=-vel*.25;}if(angle<FLIP_SIGHT.folded){angle=FLIP_SIGHT.folded;vel=-vel*.2;}pose();}
   sightGlow+=(sighting-sightGlow)*Math.min(1,dt*10);glow.emissiveIntensity=1.1+sightGlow*1.6;},
  raise(up=true){angle=up?FLIP_SIGHT.raised:FLIP_SIGHT.folded;vel=0;pose();},
  dispose(){group.removeFromParent();glow.dispose();}};
}
