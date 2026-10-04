import {validateInventionPlacement} from '../shared/inventions.js';
import {createSiegebirdSight,SIEGEBIRD_PRESENTATION} from './siegebird-sight.js';
import {createSiegebirdAim} from './siegebird-aim.js';
import {createInventionView} from './invention-view.js';
import {resolveInventions,inventionFloor,MANNED,operatorSeat} from '../shared/inventions.js';
import {createPresentationClock} from './presentation-clock.js';
import {createMountainArena} from './mountain-arena.js';
import {applyMountainGroundTreatment} from './mountain-ground-treatment.js';
import {createPickupHighlight} from './pickup-highlight.js';
import {nearestCollectible} from '../shared/collection-target.js';
import {waistPouchPosition,POUCH_RULES,capsuleDistance,isFelled} from '../shared/trees.js';
import {terrainHeight as sharedTerrainHeight,moveOnTerrain,terrainFrameKey,terrainDirtyEdits,foundationTerrainKey,terrainRenderVertex} from '../shared/terrain.js';
import {createStartingWorld} from './starting-world.js';
import {resolveStartingWorld} from '../shared/starting-world.js';
import {createEnemyShadowBudget} from './enemy-shadow-budget.js';
import {createMeteorCreaturePresentation} from './meteor-creature.js';
import {SPELLS,settleCastPoint} from '../shared/spells.js';
import {createSettlementView} from './settlement-view.js';
import {syncWeaponReadiness} from './weapon-readiness.js';
import {weaponReadiness} from './ability-readiness.js';
import {enhancePickTemplate} from './pick-luminance.js';
import {enhanceAxeTemplate} from './axe-luminance.js';
import {createAxeReadyCue} from './axe-ready-cue.js';
import {createAxeCleaveView,playCleaveSound} from './axe-cleave-view.js';
import {spellUnavailable} from './spell-availability.js';
import {expeditionRunning} from '../shared/adventure.js';
import {swiftFactor} from '../shared/god-boons.js';
import {createFrameMetrics} from './frame-metrics.js';
import {createTerrainSampler} from '../shared/terrain-sampler.js';
import {createTerrainRaycaster} from './terrain-ray.js';
import {createRangedReticle} from './ranged-reticle.js';
import {createTrajectoryGuide,shouldShowTrajectory} from './ranged-trajectory.js';
import {attachEmberdew,setEmberdewTime} from './emberdew-presentation.js';
import './ranged-reticle.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {specialPose, SPECIAL_MOTION} from './weapon-special-motion.js';
import {createWeaponController} from './weapon-controller.js';
import {createContactFeedback, otherHand} from './contact-feedback.js';
import {createCombatView} from './combat-view.js';
import {createEntView} from './ent-view.js';
import {ENT_SPELLS, entTargets} from '../shared/ents.js';
import {createSpellPresentation} from './spell-presentation.js';
import {createWallPreview} from './crystal-wall-preview.js';
import {createCrystalWallAudio} from './crystal-wall-audio.js';
import {createGolemPresentation} from './golem-presentation.js';
import {createImpactPresentation} from './impact-presentation.js';
import {createRewardMoments} from './reward-moments.js';
import {swingPose, SWING_PROFILES, idleOffset} from './weapon-motion.js';
import {createHeldSway} from './held-sway.js';
import {createWorldContent,createResourceArt,HELD_SCALE} from './world-content-view.js';
import {updateEnemyMotion, noteEnemyHit} from './enemy-motion.js';
import {createForgeView} from './forge-view.js';
import {createFirePresentation,createEmberdewModel} from './fire-presentation.js';
import {forgeFloor,resolveForge} from '../shared/forge-collision.js';
import {terrainHeight as simulationHeight} from '../shared/simulation.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createVRAdventurePanel} from './vr-adventure-panel.js';
import {aimIndex, triggerRole, moveIndexes, buttonActions, createPressRouter} from './vr-input-policy.js';
import {createExpeditionPresentation} from './expedition-presentation.js';
import {prepareAsset, setWeaponGrip, FPS_WEAPON_POSE, weaponForward, weaponTip as modelTip, updateWeaponPresentation} from './asset-pose.js';
import {createOrchardPresentation} from './orchard-presentation.js';
import {createMeadowCover} from './meadow-cover.js';
import {createOreGlint} from './ore-glint.js';
import {ORE_RECIPES} from '../shared/material-catalog.js';
import {createAlpineSkyline} from './alpine-skyline.js';
import {createAlpineForest} from './alpine-forest.js';
import {createHeroView} from './hero-view.js';
import {createWoodAudio} from './wood-audio.js';
import {createSpellAudio} from './spell-audio.js';
import {createMaterialAudio} from './material-audio.js';
import {createSiegebirdFlock, SIEGEBIRD_PLUMAGES} from './siegebird-flock.js';
import {createSiegebirdAudio} from './siegebird-audio.js';
import {siegebirdMechanism, siegebirdCues} from './siegebird-reload.js';
import {createSiegebirdWind, SIEGEBIRD_WIND} from './siegebird-wind.js';
import {specialCooldown} from '../shared/special-cooldowns.js';
import {worldTrees} from '../shared/world-content.js';

// Rendering and physics sample exactly the same bounded, deformable surface.
// Presentation helpers pass only edits; the baked ground (old settled earthworks) comes from the latest snapshot.
let currentTerrainBake;
export function terrainHeight(x,z,edits=[],tick=Infinity) {return sharedTerrainHeight({edits,tick,terrainBake:currentTerrainBake},x,z,false);}

export function createGame({ canvas, onAction = () => {}, onCast = () => {}, onInput = () => {}, onStatus = () => {}, onXRChange = () => {}, onMenu = () => {}, isHost = () => true, onSelection = () => {}, onExpeditionAction = () => {}, onAimProbe = null }) {
  const started = performance.now();
  let disposed = false, active = false, role = 'hero', spell = 'skeleton', playerId = null;
  let snapshot = { players: [], enemies: [], edits: [], groves: [], pendingStarfalls: [] };
  const frameMetrics=createFrameMetrics();
  const terrainSampler=createTerrainSampler(snapshot);
  const heightAt=(x,z,edits=snapshot.edits)=>edits===snapshot.edits?terrainSampler.height(x,z):terrainHeight(x,z,edits,snapshot.tick??Infinity);
  const terrainRay=createTerrainRaycaster({height:(x,z)=>heightAt(x,z)});
  const presentationClock=createPresentationClock(); let renderTick=0, pendingCastPreview=null;
  let contactFrame=0,worldMatricesAt=-1,worldTargets=[];
  let terrainPreviousEdits=[],terrainPreviousTick=Infinity;
  let yaw = 0, pitch = 0, jumpPending = false, verticalSpeed = 0, grounded = true;
  let previous = performance.now(), sentAt = -Infinity, snapshotAt = 0, initialized = false, swingAt = -Infinity;
  let terrainSignature = null,terrainFoundationKey = null, rightDrag = false, orbitYaw = 0.2, orbitRadius = 38, orbitTilt = 0.9;
  let zeroInputTimer = null;
  let castStart=null,quickCast=false,quickKey=null,castRevision=0;
  const equipment=['axe','pick','hammer','crossbow','bow','limb','wyrmspout','flask'];
  const spellKeys={Digit1:'skeleton',Digit2:'raise',Digit3:'grove',Digit4:'starfall',Digit5:'sunder',Digit6:'wall',Digit7:'ring',Digit8:'golem',Digit9:'squad',Digit0:'crystal',Minus:'lower',Equal:'heal',Backquote:'lightning',KeyT:'frost',KeyY:'spring',KeyU:'blessing',KeyI:'quake',KeyO:'awaken',KeyP:'wildwake'};
  let tool = 'axe', swingContact = false, swingReach = 2.5, swingRest = null, swingTarget = null;
  const weaponModels = new Map(), weaponTip = new THREE.Vector3(0,.5,-.35);
  let axeModel = null, touchEnabled = false, fixedAim = null;
  let heldReadiness = null, failedReadinessRoot = null;
  const reducedWeaponMotion=!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const touchAxes = {left: {x: 0, y: 0}, right: {x: 0, y: 0}};
  const xrButtons = new Map();
  const aimCamera = new THREE.Matrix4();
  let aimTerrain = null;
  const keys = new Set(), removers = [], actors = new Map(), templates = new Map(), warnings = new Map();
  const heroView = createHeroView({resolveWeapon: remoteWeapon, onWarning: report, siegebird: () => siegebirdFlockReady()}), heroCamera = new THREE.Vector3(); // remote Hero bodies only (opus-player-character)
  const mixers = new Set(), localPosition = new THREE.Vector3(0, 0, 8), correction = new THREE.Vector3(), meadowPushers = [];
  const pan = new THREE.Vector3(), move = new THREE.Vector3(), forward = new THREE.Vector3();
  const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster(), hitPoint = new THREE.Vector3();
  const posePosition = new THREE.Vector3(), poseQuaternion = new THREE.Quaternion(), poseScale = new THREE.Vector3();
  const scene = new THREE.Scene();
  const settlementVisual=createSettlementView({scene,heroView});
  const inventionVisual=createInventionView({scene});
  let inventionPlacement=null,placementPointer=null;
  // Manned Timberline (desktop first person): yaw/pitch become the wanted aim; the machine follows with weight.
  let manned=null,crankAt=0;
  const heldResourceArt=createResourceArt(),heldOreVisual=new THREE.Group();let heldOreKind=null;heldOreVisual.visible=false;scene.add(heldOreVisual);
  scene.background = new THREE.Color(0xabc5c2);
  scene.fog = new THREE.Fog(0xabc5c2, 58, 125);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnvironment = new RoomEnvironment();
  const environment = pmrem.fromScene(roomEnvironment, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .55;
  roomEnvironment.dispose(); pmrem.dispose();
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 180);
  camera.rotation.order = 'YXZ';
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);
  scene.add(new THREE.HemisphereLight(0xc6e0ed, 0x5e5139, 1.2));
  const sun = new THREE.DirectionalLight(0xffe3ad, 2.2);
  sun.position.set(-22, 38, 15);
  scene.add(sun);
  const groundGeometry = new THREE.PlaneGeometry(120, 120, 160, 160);
  groundGeometry.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({ color: 0x667b43, roughness: 1, metalness: 0 }));
  scene.add(ground);
  // World-space orchard ground/sky/lighting. It owns the meadow textures (no separate loader) and reads the same
  // authoritative surface as the ground mesh; it never changes heights, collision or raycast targets.
  const orchard = createOrchardPresentation({scene, renderer, ground, sun, camera, height: (x, z) => heightAt(x, z, snapshot.edits),
    baseHeight: (x,z) => heightAt(x,z,[]), quality: globalThis.matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high', edits: snapshot.edits});
  // Living meadow (grass, wildflowers, pollen) over the same authoritative surface; presentation only.
  const meadow = createMeadowCover({scene, renderer, height: (x, z) => heightAt(x, z, snapshot.edits), quality: globalThis.matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high'});
  // Mountain-foot ore veins glint so they can be spotted from across the Orchard (shared/ore-veins.js).
  const oreGlint = createOreGlint({scene, renderer, height: (x, z) => heightAt(x, z, snapshot.edits)});
  // Layered distant alpine ranges replace the low orchard silhouette backdrop.
  const skyline = createAlpineSkyline({scene, sky: orchard.objects.sky}); orchard.objects.backdrop.visible = false;
  let orchardContentKey = '', stepDistance = 0;
  const cursor = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.18, 48), new THREE.MeshBasicMaterial({ color: 0xf2c779, side: THREE.DoubleSide, depthWrite: false }));
  cursor.rotation.x = -Math.PI / 2;
  cursor.visible = false;cursor.layers.set(31);
  scene.add(cursor);
  // The power anchor is a physical strike target at the authoritative shrine point.
  const forge = createForgeView();
  const shrine = forge.root;
  const shrineBase = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.92, 0.42, 12),
    new THREE.MeshStandardMaterial({ color: 0x554b65, metalness: 0.35, roughness: 0.6 }));
  shrineBase.position.y = 0.21;
  shrineBase.visible=false;shrine.add(shrineBase);
  const shrineCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.48),
    new THREE.MeshStandardMaterial({ color: 0x69dddb, emissive: 0x2a8c98, emissiveIntensity: 1.2, metalness: 0.35 }));
  shrineCore.position.y = 1.2;
  shrineCore.visible=false;shrine.add(shrineCore);
  const shrineBarBack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.11, 0.055),
    new THREE.MeshBasicMaterial({ color: 0x292330, depthTest: false }));
  shrineBarBack.position.set(0, 2.05, 0);
  shrineBarBack.userData.ignoreContact = true;
  shrine.add(shrineBarBack);
  const shrineBar = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.075, 0.065),
    new THREE.MeshBasicMaterial({ color: 0x7bf2cd, depthTest: false }));
  shrineBar.position.set(0, 2.05, 0.005);
  shrineBar.userData.ignoreContact = true;
  shrine.add(shrineBar);
  shrine.userData.targetId='shrine';
  shrine.visible = false;
  scene.add(shrine);
  let resumeCapture=false,deliberateRelease=false,wasCaptured=false,lastCaptureLost=-Infinity;
  let aiming=false,adsAmount=0,siegebirdSight=null,siegebirdAim=null;const siegebirdWind=createSiegebirdWind();
  const weaponAnchor = new THREE.Group(),heldSway=createHeldSway({reducedMotion:reducedWeaponMotion}),swayMove=new THREE.Vector3();
  weaponAnchor.position.fromArray(FPS_WEAPON_POSE.position);
  weaponAnchor.rotation.fromArray(['bow','crossbow','wyrmspout','flask'].includes(tool)?[0,0,tool==='bow'?-.08:0]:FPS_WEAPON_POSE.rotation);
  camera.add(weaponAnchor);
  const axePlaceholder = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.05), new THREE.MeshStandardMaterial({ color: 0x67462e }));
  axePlaceholder.visible=false;weaponAnchor.add(axePlaceholder);
  const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
  const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
  const controllerSources = new Map();
  // Haptics only for local contacts/releases/damage, on the hand that actually holds the weapon (by handedness).
  let weaponHand = null;
  const startingWorld=createStartingWorld({THREE,scene,height:(x,z)=>heightAt(x,z,snapshot.edits)});startingWorld.group.visible=false;let startingEdits='';
  const feedback = createContactFeedback({sources: () => controllerSources.values(), playerId: () => playerId, tool: () => tool, weaponHand: () => weaponHand, presenting: () => renderer.xr.isPresenting});
  // The axe's edge re-arms: a quiet shing and one light tick (controller rumble in VR, a short buzz on touch devices).
  const axeReadyCue = createAxeReadyCue({audio: () => audioContext, haptic: () => { if (renderer.xr.isPresenting) feedback.pattern?.([{at: 0, amplitude: .3, duration: 22}]); else if (touchEnabled) navigator.vibrate?.(14); }});
  function contactMaterial(id) {
    const enemy = [...(snapshot.enemies || []),...(snapshot.detachedParts||[])].find(e => e.id === id); if (enemy) return enemy.kind === 'golem' ? 'stone' : enemy.kind === 'ent' ? 'wood' : 'bone';
    if ((snapshot.deposits || []).some(d => d.id === id)) return 'stone';
    if (id === 'shrine') return 'metal';
    return worldTrees(snapshot).some(t => t.id === id) ? 'wood' : 'earth';
  }
  // Hero Expedition panel above the off-hand wrist. Trigger presses aimed at it are consumed before weapons see them.
  const adventurePanel = createVRAdventurePanel({parent: scene, controllers, grips, sources: controllerSources, onAction: (action,detail) => action==='inventionPlace'?beginInventionPlacement(detail.kind):action==='inventionAim'?beginInventionPlacement('operate:'+detail.structureId):onExpeditionAction(action,detail)});
  // Each trigger press belongs to whoever took its selectstart (panel, weapon, special, throw or cast); selectend and
  // controller loss return to that owner, so a release can never be dropped or fire with another hand/tool.
  const presses = createPressRouter();
  const holdingLoose = () => !!snapshot.players.find(p=>p.id===playerId)?.heldOre || [...(snapshot.detachedParts||[]),...(snapshot.looseLogs||[])].some(p=>p.heldBy===playerId);
  for (let i = 0; i < 2; i++) {
    rig.add(controllers[i], grips[i]);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc2a17b }));
    grips[i].add(hand);
    const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -3)]), new THREE.LineBasicMaterial({ color: 0xefcd83, transparent: true, opacity: 0.45 }));
    controllers[i].add(beam);
    // Buttons already held at (re)connect are latched, so reconnecting while holding B/Y or grip fires nothing.
    listen(controllers[i], 'connected', event => { controllerSources.set(i, event.data); xrButtons.set(i, buttonActions(event.data, {}, {active: false}).state); attachWeapon(); });
    listen(controllers[i], 'disconnected', () => {
      controllerSources.delete(i); xrButtons.delete(i);
      const lost = presses.lose(i);
      // A lost controller never fires a half-drawn bow or keeps a flame going; a panel press clears without activating.
      if (lost?.owner === 'primary') { weapons.cancel(); presses.invalidate(); }
      if (lost?.owner === 'panel') adventurePanel.handleSelectEnd(i);
      attachWeapon();
    });
    listen(controllers[i], 'squeezeend', () => {if(active&&renderer.xr.isPresenting&&controllerSources.get(i)?.handedness==='right'&&snapshot.looseLogs?.some(l=>l.heldBy===playerId)&&pouchReady())release(false,i);});
    listen(controllers[i], 'selectstart', () => {
      if (active) unlockAudio();
      if (adventurePanel.handleSelectStart(i)) { presses.begin(i, 'panel'); return; }
      if (!active) return;
      if(inventionPlacement){controllers[i].getWorldPosition(raycaster.ray.origin);controllers[i].getWorldQuaternion(poseQuaternion);raycaster.ray.direction.set(0,0,-1).applyQuaternion(poseQuaternion);const hit=raycaster.intersectObject(ground)[0];if(hit)placeInvention(hit.point);presses.begin(i,'cast');return;}
      if (role === 'hero') {
        const kind = triggerRole({tool, hand: controllerSources.get(i)?.handedness, sources: controllerSources, holding: holdingLoose()});
        if (presses.begin(i, kind, tool)?.owner === 'primary') weapons.cancel(); // missed selectend: drop, never fire late
        if (kind === 'throw') release(true, i);
        else if (kind === 'special') weapons.special();
        else primaryDown();
      }
      else {
        presses.begin(i, 'cast');
        controllers[i].getWorldPosition(raycaster.ray.origin);
        controllers[i].getWorldQuaternion(poseQuaternion);
        raycaster.ray.direction.set(0, 0, -1).applyQuaternion(poseQuaternion);
        const hit = raycaster.intersectObject(ground)[0];
        if (hit) castAt(hit.point);
      }
    });
    listen(controllers[i],'selectend',()=>{const press=presses.end(i);if(press?.owner==='panel')adventurePanel.handleSelectEnd(i);else if(press?.owner==='primary')primaryUp();});
  }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  }
  function report(message) { if (!disposed) onStatus(message); }
  const content = createWorldContent({scene,templates,instantiate,height:heightAt,camera});
  // Stonewhisper wall: hold Special (Q / right mouse / touch Special / VR trigger) to see the exact footprint, release to raise it.
  const wallPreview=createWallPreview({THREE,scene,height:(x,z)=>heightAt(x,z)});let wallAim=null,wallAudio=null;
  const pickupHighlight=createPickupHighlight({scene});
  applyMountainGroundTreatment(orchard.material);
  const mountainArena=createMountainArena({THREE,scene,height:(x,z)=>heightAt(x,z,snapshot.edits)});
  const alpineForest=createAlpineForest({scene,arena:mountainArena,quality:globalThis.matchMedia?.('(pointer: coarse)').matches?'low':'high'});
  let nearestPickup=null;
  const enemyGround=(x,z)=>heightAt(x,z,snapshot.edits);
  const enemyShadows=createEnemyShadowBudget({range:18});
  const meteorCreatures=createMeteorCreaturePresentation({THREE,quality:matchMedia('(any-pointer:coarse)').matches?'low':'high'});
  const combat=createCombatView({scene,templates,actors,camera,beforeContacts:()=>{for(const e of actors.values())if(e.enemy)meteorCreatures.apply(e,renderTick);},height:(x,z)=>heightAt(x,z,snapshot.edits),worldContact, onContact:hit=>{if(isHost())onAction('projectileHit',hit);}});
  // Ents: awakened trees. Sound goes through the wood kit plus a low root rumble; touch and VR feel big ones nearby.
  const entView=createEntView({scene,templates,height:enemyGround,quality:globalThis.matchMedia?.('(pointer: coarse)').matches?'low':'high',
    onSound:event=>{woodAudio?.play(event,listenerPose());if(event.kind==='ent_slam'||event.kind==='ent_fall')rootRumble(event);},
    onRumble:({position,strength})=>{const at=role==='god'?pan:localPosition,d=Math.hypot(position[0]-at.x,position[2]-at.z);if(d>16)return;const k=strength*(1-d/16);
      if(renderer.xr.isPresenting)feedback.pattern?.([{at:0,amplitude:.35+.5*k,duration:70},{at:120,amplitude:.25+.4*k,duration:110}]);
      else if(touchEnabled&&k>.15)try{navigator.vibrate?.([Math.round(20+50*k),40,Math.round(15+35*k)]);}catch{}}});
  const expedition=createExpeditionPresentation({scene,height:(x,z)=>heightAt(x,z,snapshot.edits)});
  const fireVisual=createFirePresentation({scene,terrainGrid:true,fireSamples:id=>combat.fireSamples(id),height:(x,z)=>heightAt(x,z,snapshot.edits)});
  const flaskModel=createEmberdewModel();templates.set('flask',{scene:createEmberdewModel(),animations:[]});weaponModels.set('flask',flaskModel);
  const bottleFx=attachEmberdew({root:flaskModel}),bottlePosition=new THREE.Vector3(),bottleRotation=new THREE.Quaternion();
  const rangedReticle=createRangedReticle(),trajectoryGuide=createTrajectoryGuide();scene.add(trajectoryGuide.object);let nextGuideAt=0;const guideTiming={lastMs:0,maxMs:0,updates:0};
  const spellVisual=createSpellPresentation({scene,terrainGrid:true,tickSeconds:1/60,getTerrainTick:()=>snapshot.tick??0,height:(x,z)=>heightAt(x,z,snapshot.edits),quality:globalThis.matchMedia?.('(pointer: coarse)').matches?'medium':'high',reducedMotion:!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches});
  const cleaveView=createAxeCleaveView({scene,height:(x,z)=>heightAt(x,z,snapshot.edits),reducedMotion:!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches});
  let specialSwing=null, waistPouch=null;
  function selfPlayer(){return snapshot.players.find(p=>p.id===playerId);}
  // Ground point under the weapon aim (camera, or the VR controller holding the pick); open sky aims at full reach.
  function wallAimPoint(){const aim=weaponAim(),o=aim.origin,d=aim.direction,hit=terrainRay.segment(o,[o[0]+d[0]*14,o[1]+d[1]*14,o[2]+d[2]*14]);
    if(hit)return [...hit.point];const p=selfPlayer()?.position||o,h=Math.hypot(d[0],d[2])||1;return [p[0]+d[0]/h*20,p[1],p[2]+d[2]/h*20];}
  function beginWallAim(){if(!active||role!=='hero'||inventionPlacement||tool!=='pick')return;unlockAudio();wallAim??={since:performance.now()};}
  function cancelWallAim(){wallAim=null;wallPreview.hide();}
  // Release casts toward the aimed point (a tap casts too). The host re-plans from its own state; the preview used the same plan.
  function releaseWallAim(){if(!active||role!=='hero'||tool!=='pick'){cancelWallAim();return;}const point=wallAimPoint();cancelWallAim();onAction('special',{point});}
  function specialPress(down){if(tool==='pick'){if(down)beginWallAim();else releaseWallAim();return;}if(!down)special();}
  function updateWallPreview(){
    if(!wallAim||tool!=='pick'||!active||role!=='hero'){if(wallAim)cancelWallAim();return;}
    const p=selfPlayer();if(!p){wallPreview.hide();return;}
    wallPreview.show({position:p.position,yaw:p.yaw,point:wallAimPoint(),ready:(snapshot.tick||0)-(p.specialTick??-1000)>=240});
  }
  function sendSpecial(){const aim=weaponAim();const point=new THREE.Vector3(...aim.origin).addScaledVector(new THREE.Vector3(...aim.direction),3);point.y=heightAt(point.x,point.z,snapshot.edits);onAction('special',{point:point.toArray()});}
  function requestSpecial(){if(!active||specialSwing)return;if(tool==='pick'){beginWallAim();return;}if(tool==='axe'&&!renderer.xr.isPresenting){const p=snapshot.players.find(p=>p.id===playerId);if((snapshot.tick||0)-(p?.specialTick??-1000)<specialCooldown('axe'))return;specialSwing={at:performance.now(),sent:false,rest:{position:weaponAnchor.position.clone(),quaternion:weaponAnchor.quaternion.clone()}};swingContact=true;swingAt=-Infinity;}else sendSpecial();}
  const weapons=createWeaponController({getTool:()=>tool,getAim:projectileAim,getDraw:()=>{if(!renderer.xr.isPresenting)return null;let left,right;for(const [i,source] of controllerSources){if(source.handedness==='left')left=grips[i];if(source.handedness==='right')right=grips[i];}return left&&right?THREE.MathUtils.clamp((left.getWorldPosition(new THREE.Vector3()).distanceTo(right.getWorldPosition(new THREE.Vector3()))-.08)/.65,0,1):null;},fire:details=>{unlockAudio();const golden=tool==='crossbow'&&!!siegebirdFlock?.loadedGolden(axeModel);feedback.release(tool,{golden});onAction('fire',details);if(tool==='crossbow')siegebirdFired(golden);},emitFlame:details=>{unlockAudio();onAction('flame',details);},pourFuel:details=>{unlockAudio();onAction('pour',details);},reload:{time:()=>siegebirdWind.time(),press:()=>siegebirdWindVerdict(siegebirdWind.press())},canFlame:()=>{const p=snapshot.players.find(p=>p.id===playerId);return !!p&&(p.overheatUntil||0)<=(snapshot.tick||0)&&p.hp>0;},special:requestSpecial});
  function attachWeapon() {
    if (!axeModel) return;
    const tracked = [...controllerSources.entries()].filter(([, source]) => source.targetRayMode === 'tracked-pointer');
    const selected = tracked.find(([, source]) => source.handedness === (tool==='bow'?'left':'right')) || tracked[0];
    if (renderer.xr.isPresenting && selected) {
      const [index, source] = selected;
      weaponHand = source.handedness;
      (source.gripSpace ? grips[index] : controllers[index]).add(axeModel);
      setWeaponGrip(axeModel, true, tool, weaponHand);
    } else {
      weaponHand = null;
      weaponAnchor.add(axeModel);
      setWeaponGrip(axeModel, false, tool, tool==='bow'?'left':'right');
      modelTip(axeModel,tool,weaponTip); weaponAnchor.worldToLocal(weaponTip);
    }
  }
  async function capturePointer(automatic=false) {
    try {
      if (!canvas.requestPointerLock) throw new Error('Mouse capture is unavailable in this browser.');
      await canvas.requestPointerLock();deliberateRelease=false;
    } catch (error) {
      report(automatic?'Browser requires a gesture to restore the mouse. Click once to resume; Escape keeps it free.':`Mouse capture failed: ${error.message || 'browser permission denied'}. Click the canvas again; Esc releases it.`);
    }
  }
  function resize() {
    if (disposed || renderer.xr.isPresenting) return;
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    weaponAnchor.position.x = 0.33 * Math.min(1, camera.aspect / 0.9);
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  function rebuildGround() {
    const foundations=foundationTerrainKey(snapshot),foundationChanged=foundations!==terrainFoundationKey;
    const signature = terrainFrameKey(snapshot.edits,snapshot.tick)+'|'+foundations;
    if (signature === terrainSignature) return;
    const terrainStarted=performance.now();
    const dirty=terrainSignature&&!foundationChanged?terrainDirtyEdits(terrainPreviousEdits,snapshot.edits,terrainPreviousTick,snapshot.tick):null;
    terrainPreviousEdits=snapshot.edits;terrainPreviousTick=snapshot.tick;
    terrainSignature = signature;terrainFoundationKey=foundations;
    fireVisual.invalidateTerrain();terrainRay.invalidateTerrain();worldMatricesAt=-1;mountainArena.sync(snapshot);alpineForest.sync();
    const positions = groundGeometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {const x=positions.getX(i),z=positions.getZ(i);if(!dirty||dirty.some(e=>Math.hypot(x-e.x,z-e.z)<=e.radius+.75))positions.setY(i,terrainRenderVertex(snapshot,x,z,false,heightAt(x,z,snapshot.edits)));}
    positions.needsUpdate = true;
    groundGeometry.computeVertexNormals();
    groundGeometry.computeBoundingSphere();
    groundGeometry.computeBoundingBox();
    frameMetrics.record('terrainCpu',performance.now()-terrainStarted);
    meadow.terrainChanged({edits: snapshot.edits, terrainTick: snapshot.tick, dirty: foundationChanged ? null : dirty});
    orchard.groundChanged({edits: snapshot.edits,terrainTick:snapshot.tick,foundationChanged}); // edit-only rebake of the disturbed-earth channel; slope soil/stone follows the new normals
  }
  // Stone/canopy channels follow the world's tree set (seed + groves) and live deposits. A full mask bake measured
  // 0.3-0.75 s in headless SwiftShader; ecosystem changes now rebuild in bounded frame slices, never per chop.
  function syncOrchardContent() {
    const trees = worldTrees(snapshot), deposits = Array.isArray(snapshot.deposits) ? snapshot.deposits : null;
    const key = snapshot.seed + ':' + (snapshot.groves || []).map(g => g.id).join() + '|' + (snapshot.awakenedTrees || []).join() + '|' + (snapshot.wildTrees || []).map(t => t.id).join() + '|' + (deposits || []).map(d => d.id + (d.depleted ? '-' : '')).join();
    if (key === orchardContentKey) return; orchardContentKey = key;
    orchard.groundChanged(deposits ? {trees, deposits} : {trees});
  }
  // Invisible load-time sockets: authored models replace these as soon as ready.
  function basicActor() {
    const group=new THREE.Group(),head=new THREE.Object3D(),hands=[new THREE.Object3D(),new THREE.Object3D()];
    group.add(head,...hands);group.userData={head,hands,placeholder:true};return group;
  }
  function instantiate(name, height) {
    const template = templates.get(name);
    if (!template) return null;
    const {visual: wrapper, model} = prepareAsset(template, name, height);
    // Golems are posed procedurally (enemy-motion.js: stride-locked gait, slam, recoil); their clips stay in the GLB for tools.
    if (template.animations.length && name === 'skeleton') {
      const mixer = new THREE.AnimationMixer(model);
      const idle = template.animations.find(item => /idle/i.test(item.name)) || template.animations[0];
      const walk = template.animations.find(item => /walk/i.test(item.name)) || idle;
      const actions = { idle: mixer.clipAction(idle), walk: mixer.clipAction(walk) };
      for(const name of ['attack','stagger']){const clip=template.animations.find(a=>a.name.toLowerCase().includes(name));if(clip){actions[name]=mixer.clipAction(clip);actions[name].setLoop(THREE.LoopOnce,1);actions[name].clampWhenFinished=true;}}
      actions.idle.play();
      wrapper.userData.mixer = mixer;
      wrapper.userData.actions = actions;
      wrapper.userData.motion = 'idle';
      mixers.add(mixer);
    }
    return wrapper;
  }
  const WEAPON_HEIGHTS = {axe:.7,pick:.75,hammer:.95,crossbow:.48,bow:1.25,wyrmspout:.4};
  // Remote Hero equipment: a canonical clone of an already-loaded template (shared geometry/materials); hero-view poses it
  // in the WeaponGrip socket with the local XR contract. null while loading; hero-view retries and never disposes templates.
  function remoteWeapon(name) {
    if (!templates.has(name)) return null;
    const visual = instantiate(name, WEAPON_HEIGHTS[name]);
    if (visual && name === 'flask') { const m = visual.children[0].children[0]; m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1); } // template root is the live local flask
    return visual;
  }
  function upgradeActor(entry) {
    if (!entry.enemy || !entry.visual.userData.placeholder) return;
    const model = entry.data.kind==='ent'?entView.build(entry.data):instantiate(entry.data.kind==='golem'?'golem':'skeleton',entry.data.kind==='golem'?2.8:1.7);
    if (!model) return;
    entry.root.remove(entry.visual);
    disposePlaceholder(entry.visual);
    entry.visual = model;
    entry.root.add(model);
  }
  // Remote Heroes swap the placeholder for the shared hero body; Gods and the local player keep their existing visuals.
  function upgradeHero(entry) {
    if (entry.enemy) return;
    const wantHero = heroView.ready(), isHero = !!entry.visual.userData.hero;
    if (wantHero === isHero) return;
    const old = entry.visual, next = wantHero ? heroView.create(entry.data) : basicActor(false, entry.data.role === 'god');
    if (!next) return;
    if (isHero) heroView.release(old); else { entry.root.remove(old); disposePlaceholder(old); }
    entry.visual = next; entry.root.add(next);
  }
  function disposePlaceholder(node) {
    if (!node.userData.placeholder) return;
    const materials = new Set();
    node.traverse(child => { child.geometry?.dispose(); if (child.material) materials.add(child.material); });
    materials.forEach(material => material.dispose());
  }
  function syncActors() {
    const present = new Set();
    for (const data of [...snapshot.players, ...snapshot.enemies]) {
      if (data.id === playerId) continue;
      const enemy = snapshot.enemies.includes(data);
      const key = `${enemy ? 'e' : 'p'}:${data.id}`;
      present.add(key);
      let entry = actors.get(key);
      if (!entry) {
        const root = new THREE.Group(), visual = basicActor(enemy, data.role === 'god');
        root.add(visual);if(enemy)root.userData.targetId=data.id;
        root.position.fromArray(data.position);
        scene.add(root);
        entry = { root, visual, enemy, target: new THREE.Vector3(), data };
        actors.set(key, entry);
      }
      if(enemy&&entry.data.kind!==data.kind){
        const old=entry.visual,mixer=old.userData.mixer;if(mixer){mixer.stopAllAction();mixer.uncacheRoot(mixer.getRoot());mixers.delete(mixer);}
        old.removeFromParent();old.traverse(n=>n.skeleton?.dispose());disposePlaceholder(old);
        entry.visual=basicActor(true,false);entry.root.add(entry.visual);
      }
      entry.target.fromArray(data.position);
      entry.data = data;
      upgradeActor(entry); upgradeHero(entry);
      if (!enemy && !entry.visual.userData.hero) {
        const { head, hands } = entry.visual.userData;

        if (data.head) {
          // Tracked offsets are root-local in position, orientation is tracking-space.
          head.position.fromArray(data.head.position);
          head.quaternion.fromArray(data.head.quaternion);
        } else head.position.set(0, 1.62, 0);
        hands.forEach((hand, i) => {
          if (data.hands?.[i]) { hand.position.fromArray(data.hands[i].position); hand.quaternion.fromArray(data.hands[i].quaternion); }
          else hand.position.set(i ? 0.33 : -0.33, 1.05, -0.1);
        });
      }
    }
    for (const [key, entry] of actors) if (!present.has(key)) {
      if(entry.enemy)entView.release(entry,snapshot); // felled/rooted ents keep a short corpse; the actor frees an empty stand-in
      meteorCreatures.remove(entry);scene.remove(entry.root);
      if (entry.visual.userData.mixer) {
        const mixer = entry.visual.userData.mixer;
        mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); mixers.delete(mixer);
      }
      heroView.release(entry.visual);
      entry.visual.traverse(child => child.skeleton?.dispose());
      disposePlaceholder(entry.visual);
      actors.delete(key);
    }
  }
  function syncTrees() { if(initialized)content.sync(snapshot); } // only a real joined snapshot establishes existing trees
  function syncWorldSignals() {
    const anchor = snapshot.shrine;
    shrine.visible = !!anchor;
    if (anchor) {
      shrine.position.set(anchor.position[0], heightAt(anchor.position[0], anchor.position[2], snapshot.edits), anchor.position[2]);
      const health = THREE.MathUtils.clamp(anchor.hp / Math.max(1, anchor.maxHp), 0, 1);
      shrineBar.scale.x = Math.max(0.001, health);
      shrineBar.position.x = -(1 - health) * 0.51;
      shrineBar.material.color.setHex(health ? 0x7bf2cd : 0xf17b6f);
      shrineCore.material.color.setHex(health ? 0x69dddb : 0x766071);
      shrineCore.material.emissive.setHex(health ? 0x2a8c98 : 0x4b1828);
      shrineCore.scale.setScalar(health ? 1 : 0.68);
      forge.sync(anchor, shrine.position.y);
    }
    const present = new Set();
    for (const pending of snapshot.pendingStarfalls) {
      present.add(pending.id);
      let warning = warnings.get(pending.id);
      if (!warning) {
        const group = new THREE.Group();
        const ring = new THREE.LineLoop(new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: 0xff5d48, transparent: true, opacity: 0.95, depthTest: false }));
        const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 64),
          new THREE.MeshBasicMaterial({ color: 0xe84d40, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
        fill.rotation.x = -Math.PI / 2;
        group.add(fill, ring);
        scene.add(group);
        warning = { group, ring, fill, lastTerrain: '' };
        warnings.set(pending.id, warning);
      }
      const terrain = JSON.stringify(snapshot.edits);
      if (warning.x !== pending.x || warning.z !== pending.z || warning.radius !== pending.radius || warning.lastTerrain !== terrain) {
        warning.x = pending.x; warning.z = pending.z; warning.radius = pending.radius; warning.lastTerrain = terrain;
        const vertices = [];
        for (let i = 0; i < 64; i++) {
          const angle = i * Math.PI * 2 / 64;
          const x = pending.x + Math.cos(angle) * pending.radius, z = pending.z + Math.sin(angle) * pending.radius;
          vertices.push(x - pending.x, heightAt(x, z, snapshot.edits) + 0.14, z - pending.z);
        }
        warning.ring.geometry.dispose();
        warning.ring.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        warning.fill.geometry.dispose();
        warning.fill.geometry = new THREE.CircleGeometry(pending.radius, 64);
      }
      warning.group.visible=false; // Specialist spell presentation owns meteor warnings.
      warning.group.position.set(pending.x, 0, pending.z);
      warning.fill.position.y = heightAt(pending.x, pending.z, snapshot.edits) + 0.10;
      warning.impactTick = pending.impactTick;
    }
    for (const [id, warning] of warnings) if (!present.has(id)) {
      scene.remove(warning.group); disposeResources(warning.group); warnings.delete(id);
    }
  }
  const loader = new GLTFLoader();
  for(const name of ['timberline_ballista','timberline_bolts'])loader.load(`/assets/${name}.glb`,async gltf=>{
    if(disposed){disposeResources(gltf.scene);return;}
    try{await renderer.compileAsync(gltf.scene,camera,scene);}catch(error){report(`Timberline material preparation failed: ${error.message}`);}
    if(disposed){disposeResources(gltf.scene);return;}
    inventionVisual.installTimberline(name,gltf);
  },undefined,()=>report(`Could not load ${name}; reload to restore Timberline visuals.`));

  loader.load('/assets/waist_pouch.glb',gltf=>{if(disposed){disposeResources(gltf.scene);return;}waistPouch=gltf.scene;waistPouch.visible=false;rig.add(waistPouch);},undefined,()=>report('Pouch visual unavailable; collection remains available.'));
  loader.load('/assets/hero.glb', async gltf => {
    if (disposed) { disposeResources(gltf.scene); return; }
    orchard.enableShadowCasting(gltf.scene);
    try { await renderer.compileAsync(gltf.scene, camera, scene); }
    catch (error) { disposeResources(gltf.scene); report(`Hero material preparation failed (${error.message || error}).`); return; }
    if (disposed) { disposeResources(gltf.scene); return; }
    heroView.install(gltf);
    for (const entry of actors.values()) upgradeHero(entry);
  }, undefined, error => report(`Hero model unavailable; reload to restore player visuals (${error.message || error}).`));
  for (const name of ['forge','forge_lod']) loader.load(`/assets/${name}.glb`, gltf => {
    if(disposed){disposeResources(gltf.scene);return;}
    forge.install(gltf,name==='forge_lod');orchard.enableShadowCasting(gltf.scene);
    shrineBase.visible=false;shrineCore.visible=false;
    shrineBarBack.position.y=3.3;shrineBar.position.y=3.3;
    syncWorldSignals();
  },undefined,()=>report('Could not load the forge; reload to retry.'));
  for (const name of ['tree', 'tree_b', 'tree_young', 'tree_lod', 'tree_b_lod', 'tree_young_lod', 'star_gem', 'stone_chunk', 'orchard_apple', 'skeleton', 'axe', 'pick', 'hammer','crossbow','bow','wyrmspout','arrow','wings','siegebird_songbird','golem', 'boulder', 'meteor', 'bank', 'ridge', 'roots', 'log', 'endcap', 'cut1', 'cut2', 'chip', 'bridge', 'grass_tuft','meadow_flowers','fern_delicate','leaf_litter','pebble_scatter','mushroom_cluster','fallen_branch','broadleaf_plant','river_stones','root_tangle']) loader.load(`/assets/${name}.glb`, gltf => {
    if (disposed) { disposeResources(gltf.scene); return; }
    if (name === 'skeleton' || name === 'golem') orchard.enableShadowCasting(gltf.scene); // bounded casters: actors + forge only, never ground props
    if (name === 'golem') gltf.scene.traverse(n => { for (const m of [n.material].flat()) if (m && /^crystal/i.test(m.name)) m.emissive.setRGB(.3, .62, 1); }); // resonance blue; also the assembly binding colour
    if (name === 'pick') enhancePickTemplate(gltf.scene); // shared gem/metal look before any clone renders
    if (name === 'axe') enhanceAxeTemplate(gltf.scene); // shared edge/inlay/metal look before any clone renders
    templates.set(name, gltf);
    if(name==='golem'||name==='meteor')meteorCreatures.setAssets({[name]:gltf});
    // Meteor materials otherwise compile for the first time during impact.
    // Prepare the loaded asset against the real lighting without adding it to the world.
    if (name === 'meteor') renderer.compileAsync(gltf.scene, camera, scene).catch(error => {
      if (!disposed) report(`Meteor shader preparation: ${error.message}`);
    });
    if (name === 'tree') { syncTrees(); }
    if (name === 'skeleton'||name==='golem'||name.startsWith('tree')) for (const entry of actors.values()) upgradeActor(entry);
    if (['axe','pick','hammer','crossbow','bow','wyrmspout'].includes(name)) {
      const model = instantiate(name, WEAPON_HEIGHTS[name]);weaponModels.set(name,model);
      if (name === tool) equipVisual(tool);
    } else if (name !== 'siegebird_songbird') content.reload();
  }, undefined, () => report(`Could not load ${name} model; reconnect or reload to retry.`));

  function pointerHit(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(ground)[0];
    if (hit) hitPoint.copy(hit.point);
    return hit;
  }
  // Ent spells preview the exact trees the authority would wake (same pure selection); Awaken snaps onto its tree.
  let entTreeCache=null,entTreeSnapshot=null;
  function entPreviewTrees(point){if(entTreeSnapshot!==snapshot){entTreeSnapshot=snapshot;entTreeCache=worldTrees(snapshot);}return entTargets(entTreeCache,snapshot.harvestedTrees,spell,point);}
  function isLineSpell(){return spell==='sunder'||spell==='wall';}
  // Casting never refuses a placement. Point spells settle where authority will put them;
  // a drawn line longer than 18 m is shortened and a tiny one becomes the default line.
  function settledPoint(id,x,z){const [sx,,sz]=settleCastPoint(id,[x,0,z],{expedition:expeditionRunning(snapshot.adventure)});return [sx,heightAt(sx,sz,snapshot.edits),sz];}
  function fitLine(start,end){const dx=end[0]-start[0],dz=end[2]-start[2],d=Math.hypot(dx,dz);return d<=18?end:[start[0]+dx/d*17.99,end[1],start[2]+dz/d*17.99];}
  function targetPreview(){
    if(!active||role!=='god'||!cursor.visible)return null;
    const player=snapshot.players.find(p=>p.id===playerId),hit=hitPoint.toArray();
    let point=isLineSpell()?hit:settledPoint(spell,hit[0],hit[2]),start,end,fallback=false,lineCount=3;
    if(isLineSpell()){
      if(castStart&&Math.hypot(castStart.x-hit[0],castStart.z-hit[2])>=.5){start=castStart.toArray();end=point=fitLine(start,hit);lineCount=Math.ceil(Math.hypot(start[0]-end[0],start[2]-end[2])/2.5)+1;}
      else {const dx=point[0]-(player?.position[0]??0),dz=point[2]-(player?.position[2]??0),d=Math.hypot(dx,dz),ux=d>.001?dx/d:-Math.sin(player?.yaw??0),uz=d>.001?dz/d:-Math.cos(player?.yaw??0),clamp=v=>THREE.MathUtils.clamp(v,-55,55);
        start=[clamp(point[0]-uz*3),point[1],clamp(point[2]+ux*3)];end=[clamp(point[0]+uz*3),point[1],clamp(point[2]-ux*3)];fallback=true;}
    }
    let trees;if(ENT_SPELLS.includes(spell)){trees=entPreviewTrees(point);if(spell==='awaken'&&trees[0])point=[trees[0].x,heightAt(trees[0].x,trees[0].z,snapshot.edits),trees[0].z];}
    return {spell,point,start,end,fallback,trees,valid:(fallback||(Math.abs(start?.[0]??0)<=55&&Math.abs(start?.[2]??0)<=55))&&!spellUnavailable(snapshot,player,spell,{point,lineCount,trees})};
  }
  function cancelCast() { castStart = null; quickKey = null; castRevision++; }
  function castAt(point,finish=false) {
    if (!active || role !== 'god' || inventionPlacement) return;
    const x = THREE.MathUtils.clamp(point.x, -55, 55), z = THREE.MathUtils.clamp(point.z, -55, 55);
    let at=isLineSpell()?[x,heightAt(x,z,snapshot.edits),z]:settledPoint(spell,x,z);
    if(isLineSpell()&&!castStart&&!finish){castStart=new THREE.Vector3(...at);report('Choose the end of the line, then release / Cast again.');return;}
    let extra={};
    if(castStart&&Math.hypot(castStart.x-at[0],castStart.z-at[2])>=.5){at=fitLine(castStart.toArray(),at);extra={start:castStart.toArray(),end:at};}
    pendingCastPreview={spell,point:at};onCast(spell,at,extra);castStart=null;quickKey=null;
  }
  function lookBy(dx, dy) {
    if (!active || renderer.xr.isPresenting) return;
    if (role === 'hero') { yaw -= dx; pitch = THREE.MathUtils.clamp(pitch - dy, -1.48, 1.48); }
    else { orbitYaw -= dx; orbitTilt = THREE.MathUtils.clamp(orbitTilt + dy, 0.35, 1.35); }
  }
  function updateTouchAim() {
    if (fixedAim) { hitPoint.copy(fixedAim); hitPoint.y = heightAt(hitPoint.x, hitPoint.z, snapshot.edits); cursor.visible = true; }
    else {
      camera.updateMatrixWorld();
      // Stationary touch targeting must not raycast 51k terrain triangles each frame.
      if (aimTerrain === terrainSignature && aimCamera.equals(camera.matrixWorld)) return cursor.visible;
      aimTerrain = terrainSignature; aimCamera.copy(camera.matrixWorld);
      raycaster.setFromCamera(pointer.set(0, 0), camera);
      const hit = raycaster.intersectObject(ground)[0];
      cursor.visible = !!hit; if (hit) hitPoint.copy(hit.point);
    }
    if (cursor.visible) cursor.position.copy(hitPoint).addScaledVector(THREE.Object3D.DEFAULT_UP, 0.08);
    return cursor.visible;
  }
  const impacts=createImpactPresentation({scene,camera,height:(x,z)=>heightAt(x,z,snapshot.edits)});
  // Geode golems: crystal light, footfall/slam dust and resonance ring, procedural sound; rumble only reaches a nearby Hero.
  const golemFx=createGolemPresentation({scene,height:(x,z)=>heightAt(x,z,snapshot.edits),audio:()=>audioContext,listener:()=>listenerPose(),
    haptic:(amplitude,ms)=>{if(role!=='hero')return;if(renderer.xr.isPresenting)feedback.pattern?.([{at:0,amplitude:Math.min(1,amplitude),duration:ms}]);else if(touchEnabled&&amplitude>.3)try{navigator.vibrate?.(Math.round(ms*amplitude));}catch{}}});
  let audioContext=null;let lastSound=0;let woodAudio=null;let materialAudio=null;let spellAudio=null;
  // Wins (raids, rewards, crafting, building, loot) answer with light, chimes and rumble; presentation only.
  const rewards=createRewardMoments({scene,camera,height:(x,z)=>heightAt(x,z,snapshot.edits),audio:()=>audioContext,sources:()=>controllerSources.values(),presenting:()=>renderer.xr.isPresenting,context:()=>{const p=snapshot.players?.find(p=>p.id===playerId);return {playerId,side:p?.side||'party',position:p?.position};}});
  // Siegebird: one shared songbird flock for every crossbow (local and remote); the local reload's cues drive audio and rumble.
  let siegebirdFlock=null,siegebirdAudio=null;const siegebirdLocal={n:0,prevT:Infinity};
  function siegebirdFlockReady(){if(!siegebirdFlock&&templates.has('crossbow')&&templates.has('siegebird_songbird')){siegebirdFlock=createSiegebirdFlock({birdTemplate:templates.get('siegebird_songbird'),crossbowTemplate:templates.get('crossbow')});siegebirdFlock.attachWorld({scene,perch:siegebirdPerches,standing:siegebirdTreeStanding});}return siegebirdFlock;}
  // Reload birds linger: perches on standing trees near where the bird leaves the crossbow, ahead of its flight first.
  let siegebirdTreeCache=null,siegebirdTreeSnapshot=null;const siegebirdViewer=new THREE.Vector3();
  function siegebirdTrees(){if(siegebirdTreeSnapshot!==snapshot){siegebirdTreeSnapshot=snapshot;const felled=new Set((snapshot.harvestedTrees||[]).filter(isFelled).map(h=>h.id));siegebirdTreeCache=worldTrees(snapshot).filter(t=>!felled.has(t.id));}return siegebirdTreeCache;}
  function siegebirdTreeStanding(id){return siegebirdTrees().some(t=>t.id===id);}
  // The perch is the outer face of the actual crown (or a bough) on the side facing the bird, found by a ray toward the
  // trunk, so it works for any tree species; it falls back to a bough-height point when nothing is hit.
  const siegebirdRay=new THREE.Raycaster(),siegebirdRayFrom=new THREE.Vector3(),siegebirdRayDir=new THREE.Vector3();
  function siegebirdPerches(from,heading){
    const near=[];for(const t of siegebirdTrees()){const dx=t.x-from.x,dz=t.z-from.z,d=Math.hypot(dx,dz);if(d<4||d>26)continue;near.push({t,d,score:d*(1.35-.6*(dx*heading.x+dz*heading.z)/d)});}
    near.sort((a,b)=>a.score-b.score);const targets=content.targets(),out=[];
    for(const {t,d} of near.slice(0,4)){
      const ox=(from.x-t.x)/d,oz=(from.z-t.z)/d,floor=heightAt(t.x,t.z);let position=null;
      for(const k of [.72,.62,.82]){
        siegebirdRayFrom.set(t.x+ox*5,floor+t.height*k,t.z+oz*5);siegebirdRayDir.set(-ox,0,-oz);siegebirdRay.set(siegebirdRayFrom,siegebirdRayDir);siegebirdRay.far=5;
        const h=siegebirdRay.intersectObjects(targets,true).find(h=>surfaceVisible(h.object)&&resolveHit(h)?.targetId===t.id);
        if(h&&Math.hypot(h.point.x-t.x,h.point.z-t.z)>.45){position=[h.point.x+ox*.05,h.point.y,h.point.z+oz*.05];break;}
      }
      position??=[t.x+ox*Math.min(1.5,Math.max(.7,t.height*.16)),floor+t.height*.62,t.z+oz*Math.min(1.5,Math.max(.7,t.height*.16))];
      out.push({id:t.id,position,facing:[ox,oz]});
    }
    siegebirdRay.far=Infinity;return out;
  }
  function siegebirdSound(){if(!audioContext)return null;try{return siegebirdAudio??=createSiegebirdAudio({context:audioContext});}catch{return null;}}
  function siegebirdFired(golden){
    // Predict the reload index from authority (one shot per >=0.9 s, far slower than snapshots); the host's roll arrives with it.
    const me=snapshot.players.find(p=>p.id===playerId),n=(me?.siegebird?.n??0)+1;
    // Perfect wind on the reload that just finished makes this one quick: the host's verdict once it has arrived, else ours.
    const sb=me?.siegebird,quick=sb&&sb.n===siegebirdLocal.n&&sb.wind?sb.wind===1:siegebirdWind.verdict()===1;
    siegebirdLocal.n=n;siegebirdLocal.prevT=0;siegebirdWind.fired({quick});
    const flock=siegebirdFlockReady();if(flock&&axeModel){flock.fired(axeModel,golden);flock.shot(axeModel,{n,golden:null,playerId,time:performance.now()/1000,quick});}
    siegebirdSound()?.fire(golden);
  }
  // Perfect wind verdict (fire pressed on the latch, or a VR hand latched the crank before the bird seats): the host
  // judges it again from its own clock; the chime and resonance glint are immediate.
  function siegebirdWindVerdict(v){
    if(!v)return;onAction('wind',v.hand?{hand:true}:{});
    const a=siegebirdSound();
    if(v.perfect){a?.perfect?.();feedback.siegebird?.('perfect');if(axeModel)siegebirdFlock?.perfect(axeModel);}else if(!v.hand)a?.fumble?.();
  }
  // VR: the free hand squeezes on the crank knob and turns it about the crank axle (siegebird-wind.js).
  const siegebirdGripState={held:false,angle:0},siegebirdHandPos=new THREE.Vector3(),siegebirdCenter=new THREE.Vector3(),siegebirdKnob=new THREE.Vector3(),siegebirdAxisU=new THREE.Vector3(),siegebirdAxisV=new THREE.Vector3();
  function siegebirdGrip(){
    const g=siegebirdGripState;
    const crank=axeModel?.getObjectByName('Crank'),knob=axeModel?.getObjectByName('CrankKnob');
    const index=weaponHand&&[...controllerSources.entries()].find(([,s])=>s.handedness===otherHand(weaponHand))?.[0];
    if(!renderer.xr.isPresenting||tool!=='crossbow'||!crank?.parent||!knob||index===undefined||index===null){g.held=false;return null;}
    const squeeze=!!controllerSources.get(index)?.gamepad?.buttons?.[1]?.pressed;
    grips[index].getWorldPosition(siegebirdHandPos);knob.getWorldPosition(siegebirdKnob);crank.getWorldPosition(siegebirdCenter);
    const m=crank.parent.matrixWorld;siegebirdAxisU.setFromMatrixColumn(m,1).normalize();siegebirdAxisV.setFromMatrixColumn(m,2).normalize();
    const off=siegebirdHandPos.sub(siegebirdCenter),angle=Math.atan2(off.dot(siegebirdAxisV),off.dot(siegebirdAxisU));
    const reach=siegebirdHandPos.add(siegebirdCenter).distanceTo(siegebirdKnob);
    if(!g.held&&squeeze&&siegebirdWind.winding()&&reach<SIEGEBIRD_WIND.grabReach){g.held=true;g.angle=angle;return {held:true,delta:0};}
    if(g.held&&(!squeeze||reach>SIEGEBIRD_WIND.holdReach||!siegebirdWind.winding())){g.held=false;return null;}
    if(!g.held)return null;
    let delta=angle-g.angle;delta-=Math.round(delta/(Math.PI*2))*Math.PI*2;g.angle=angle;
    return {held:true,delta};
  }
  function siegebirdCue(c){
    const a=siegebirdSound();
    if(c.cue==='click'){a?.click(c.index);feedback.siegebird?.('click',c);}
    else if(c.cue==='engage')a?.engage?.();
    else if(c.cue==='latch'){a?.latch();feedback.siegebird?.('latch',c);}
    else if(c.cue==='ready')a?.ready();
    else if(c.cue==='enter'&&c.plumage!==undefined){a?.call(SIEGEBIRD_PLUMAGES[c.plumage]?.id,c.side,c.golden,.12);a?.flutter(c.side,.3,15,.3);}
    else if(c.cue==='seat'&&c.plumage!==undefined){a?.seat(c.golden);feedback.siegebird?.('seat',c);}
  }
  function updateSiegebirdLocal(now,reload){
    const flock=siegebirdFlockReady();if(!flock||!axeModel)return;
    const sb=snapshot.players.find(p=>p.id===playerId)?.siegebird,live=reload<=1.7;
    if(sb&&live&&sb.n===siegebirdLocal.n)flock.inform(axeModel,{n:sb.n,golden:sb.golden});
    else if(sb&&!live&&flock.loadedGolden(axeModel)!==sb.golden)flock.rest(axeModel,sb.golden);
    const result=flock.update(axeModel,now/1000,{reloadTime:reload});
    // A hand on the crank plays its own ratchet clicks and latch (frame loop); the clock plays everything else.
    const hand=siegebirdWind.hand()!==null;
    for(const c of siegebirdCues(siegebirdLocal.prevT,reload))if(!['enter','arrive','seat','leave'].includes(c.cue)&&!(hand&&['click','latch'].includes(c.cue)))siegebirdCue(c);
    for(const c of result?.cues||[])siegebirdCue(c);
    siegebirdLocal.prevT=reload;
  }
  // Wood kit shares this one context (bounded 16-voice pool); it is created only inside the existing gesture unlock.
  const ear={position:[0,0,0],forward:[0,0,-1],up:[0,1,0]},earVector=new THREE.Vector3(),earQuaternion=new THREE.Quaternion();
  function earXZ(){const p=listenerPose().position;return {x:p[0],z:p[2]};}
  function listenerPose(){camera.getWorldPosition(earVector);earVector.toArray(ear.position);camera.getWorldDirection(earVector);earVector.toArray(ear.forward);earVector.set(0,1,0).applyQuaternion(camera.getWorldQuaternion(earQuaternion)).toArray(ear.up);return ear;}
  function unlockAudio(){try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')void audioContext.resume();woodAudio??=createWoodAudio({context:audioContext,baseUrl:'/assets/wood-audio/'});woodAudio.unlock();materialAudio??=createMaterialAudio({context:audioContext});materialAudio.unlock();wallAudio??=createCrystalWallAudio({context:audioContext});spellAudio??=createSpellAudio(audioContext);}catch{}}
  // Reuse the native authored flame loop. One quiet source per local weapon,
  // never one source per packet; gain ramps prevent clicks on trigger release.
  let flameBuffer=null,flameLoading=false,flameSource=null,flameGain=null;
  function updateFireAudio(firing){
    if(!audioContext)return;
    if(firing&&!flameBuffer&&!flameLoading){flameLoading=true;fetch('/assets/wyrmspout-flame.wav').then(r=>{if(!r.ok)throw Error('Flame audio unavailable');return r.arrayBuffer();}).then(b=>audioContext.decodeAudioData(b)).then(b=>{if(!disposed)flameBuffer=b;}).catch(()=>{});}
    if(firing&&flameBuffer&&!flameSource){flameSource=audioContext.createBufferSource();flameSource.buffer=flameBuffer;flameSource.loop=true;flameGain=audioContext.createGain();flameGain.gain.value=0;flameSource.connect(flameGain).connect(audioContext.destination);flameSource.start();}
    if(flameGain)flameGain.gain.setTargetAtTime(firing?.16:0,audioContext.currentTime,.045);
  }
  // A short sub-bass swell under ent wakes, slams and falls: the ground answering. Distance-attenuated, no samples.
  let lastRumble=0;
  function rootRumble(event){
    if(!audioContext||!Array.isArray(event.position))return;const now=audioContext.currentTime;if(now-lastRumble<.12)return;lastRumble=now;
    const ear=listenerPose().position,d=Math.hypot(event.position[0]-ear[0],event.position[2]-ear[2]),elder=event.size!=='sapling',level=(elder?.16:.08)*Math.max(0,1-d/40);if(level<.005)return;
    const long=event.kind==='ent_wake'||event.kind==='ent_root',dur=long?1.4:.55,osc=audioContext.createOscillator(),gain=audioContext.createGain();
    osc.type='sine';osc.frequency.setValueAtTime(elder?52:74,now);osc.frequency.exponentialRampToValueAtTime(elder?31:46,now+dur);
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(level,now+(long?.35:.04));gain.gain.exponentialRampToValueAtTime(.0001,now+dur);
    osc.connect(gain).connect(audioContext.destination);osc.start(now);osc.stop(now+dur+.05);osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  function stopFireAudio(){if(flameSource){flameSource.stop();flameSource.disconnect();flameGain.disconnect();flameSource=null;flameGain=null;}}
  function handleEvent(event){
    if(event.kind==='respawn'&&event.id===playerId){clearInput();localPosition.fromArray(event.position);correction.set(0,0,0);verticalSpeed=0;grounded=true;initialized=true;}
    feedback.handleEvent(event);
    combat.handleEvent(event);
    golemFx.handleEvent(event);
    entView.event(event);
    settlementVisual.event(event);inventionVisual.event(event);
    if(['timberline_fire','launcher_fire','trap_snap','machine_turn','refinery_output','invention_build'].includes(event.kind)){const sound={...event,kind:event.kind==='invention_destroyed'?'ore_break':'hit',material:event.kind==='invention_build'?'wood':'metal',energy:event.kind.endsWith('_fire')?2:1};if(sound.material==='wood')woodAudio?.play(sound,listenerPose());else materialAudio?.play(sound,listenerPose(),snapshot.tick);}

    expedition.handleEvent(event);
    const rewardSound=!!rewards.handle(event);
    if((event?.kind==='hit'||event?.kind==='headshot')&&event.id!==undefined){const a=actors.get(`e:${event.id}`);if(a)noteEnemyHit(a,event);}
    if(event?.by!==undefined&&event.by!==playerId){const a=actors.get(`p:${event.by}`);if(a?.visual.userData.hero)heroView.event(a.visual,event,a.data);} // attributed result -> remote swing/recoil
    if(!event?.position||event.fire)return;
    const woodSound=!!woodAudio?.handles(event);if(woodSound)woodAudio.play(event,listenerPose());if(event.kind==='ent_wake'||event.kind==='ent_root')rootRumble(event);
    const materialSound=!!materialAudio?.handles(event);if(materialSound)materialAudio.play(event,listenerPose(),snapshot.tick);
    if(event.kind==='spell'){spellVisual.play(event);spellAudio?.play(event,earXZ(),role==='god');}
    // God spells feed the Heroes (shared/god-boons.js): a blue resonance marks each gift; boons spark on the Hero.
    if(event.kind==='bloom_level'){const at=event.position||[0,0,0];spellVisual.play({spell:'bloom_level',position:at,id:`bloom:${event.level}:${snapshot.tick}`,tick:snapshot.tick});spellAudio?.gift({...event,gift:'bloom_level',position:at},earXZ(),true);if(touchEnabled)try{navigator.vibrate?.([20,40,20,40,40]);}catch{}}
    if(event.kind==='god_gift'||event.kind==='charged_strike'){const boon=event.kind==='charged_strike'?'charged_strike':['charge','swift'].includes(event.gift)?event.gift:event.gift==='blessing'?'blessed':'gift',mine=event.id===playerId||event.by===playerId;
      spellVisual.play({spell:boon,position:event.position,id:`${event.kind}:${event.id}:${event.gift||''}:${snapshot.tick}`,tick:snapshot.tick});spellAudio?.gift(event,earXZ(),mine);
      if(mine&&renderer.xr.isPresenting)feedback.pattern?.((boon==='charge'||boon==='blessed')?[{at:0,amplitude:.8,duration:60},{at:100,amplitude:.5,duration:30}]:[{at:0,amplitude:boon==='charged_strike'?.7:.3,duration:30}]);
      else if(mine&&touchEnabled)try{navigator.vibrate?.(boon==='charge'||boon==='blessed'?[60,40,30]:boon==='charged_strike'?[35]:boon==='swift'?[20,30,20]:[12]);}catch{}}
    if(event.kind==='pick_burst'){wallAudio?.cast(event,listenerPose());
      // The caster feels the wave roll away from them: pulses fade as the front travels, then one crack as it blooms.
      if(event.id===playerId){const ms=(event.durationTicks||50)/.06,steps=[];for(let t=0;t<ms;t+=110)steps.push({at:t,amplitude:.55-.35*t/ms,duration:38});steps.push({at:ms+60,amplitude:.7,duration:60});feedback.pattern?.(steps);
        if(touchEnabled&&!renderer.xr.isPresenting)try{navigator.vibrate?.([30,60,22,60,16,90,45]);}catch{}}}
    // The persistent crystal wall owns its growth effect. Replaying the older Crystal spell here doubled its geometry.
    const specialEffect={hammer_slam:'raise'}[event.kind];if(specialEffect)spellVisual.play({...event,kind:'spell',spell:specialEffect});
    // The axe cleave releases its edge light as one sweeping crescent; hits and felled trees arrive as their own events.
    if(event.kind==='axe_cleave'){cleaveView.play(event,performance.now());const mine=event.id===playerId,ear=listenerPose().position;
      playCleaveSound(audioContext,mine?1:Math.max(0,1-Math.hypot(event.position[0]-ear[0],event.position[2]-ear[2])/30));
      if(mine&&touchEnabled&&!renderer.xr.isPresenting)try{navigator.vibrate?.([45,25,20]);}catch{}}
    const kind=event.kind;if(!['hit','wood_hit','stone_hit','tree_fell','ore_break','pickup','build','death','headshot','shoot','detach','shockwave','embed','hammer_slam','pick_burst','axe_cleave'].includes(kind))return;
    const material=event.material||(kind==='wood_hit'?'wood':kind==='stone_hit'||kind==='ore_break'?'stone':event.id==='shrine'?'metal':'bone');
    const isImpact=['hit','headshot','wood_hit','stone_hit'].includes(kind)||(kind==='embed'&&event.impact);
    if(isImpact){let seed=event.tick??snapshot.tick??0;for(const char of String(event.id||''))seed=(Math.imul(seed,31)+char.charCodeAt(0))|0;impacts.emit({material,position:event.position,normal:event.normal||[0,1,0],energy:event.energy||1,seed});}
    const now=performance.now();if(audioContext&&!woodSound&&!materialSound&&!rewardSound&&!(kind==='embed'&&!event.impact)&&!(kind==='shoot'&&event.weapon==='crossbow'&&event.by===playerId)&&now-lastSound>45){lastSound=now;const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type=kind==='stone_hit'?'triangle':'sine';const metallic=material==='stone'||material==='metal';osc.frequency.setValueAtTime(metallic?1500:kind==='hammer_slam'?70:kind==='shoot'?280:kind==='pickup'?660:150,audioContext.currentTime);osc.frequency.exponentialRampToValueAtTime(metallic?650:80,audioContext.currentTime+.13);gain.gain.setValueAtTime(.055,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.18);osc.connect(gain).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+.19);}
  }
  function equipVisual(next) {
    if(next!==tool)feedback.reset();
    if(next==='limb'){axeModel?.removeFromParent();axeModel=null;tool=next;return;}
    const model=weaponModels.get(next);if(!model)return;
    aiming=false;adsAmount=0;siegebirdSight?.dispose();siegebirdSight=null;siegebirdAim=null;
    axeModel?.removeFromParent();tool=next;axeModel=model;weaponAnchor.remove(axePlaceholder);attachWeapon();
    if(tool==='crossbow'){siegebirdSight=createSiegebirdSight(THREE,axeModel);siegebirdAim=createSiegebirdAim({anchor:weaponAnchor,weapon:axeModel,camera,sight:siegebirdSight});}
  }
  function equip(next) {if(!active||role!=='hero'||!equipment.includes(next))return;weapons.cancel();cancelWallAim();specialSwing=null;presses.invalidate();swingAt=-Infinity;swingContact=true;onAction('equip',{tool:next});equipVisual(next);}
  // VR aim comes from the controller that actually holds the weapon (or that made this grab/throw press), never an
  // assumed hand or index 0; with no usable controller it falls back to the head.
  function weaponAim(pressIndex){
    camera.updateWorldMatrix(true,false);const origin=new THREE.Vector3(),direction=new THREE.Vector3();
    const index=renderer.xr.isPresenting?aimIndex({purpose:pressIndex===undefined?'weapon':'press',tool,sources:controllerSources,weaponHand,pressIndex}):null;
    if(index!==null&&controllers[index]){controllers[index].getWorldPosition(origin);controllers[index].getWorldDirection(direction).negate();}
    else {camera.getWorldPosition(origin);camera.getWorldDirection(direction);}
    return {origin:origin.toArray(),direction:direction.normalize().toArray()};
  }
  function projectileAim(){
    const aim=weaponAim();if(!axeModel)return aim;
    const origin=modelTip(axeModel,tool,new THREE.Vector3());
    if(!renderer.xr.isPresenting&&tool!=='crossbow'){const target=new THREE.Vector3(...aim.origin).addScaledVector(new THREE.Vector3(...aim.direction),40);aim.direction=target.sub(origin).normalize().toArray();}
    if(renderer.xr.isPresenting||tool==='crossbow')aim.direction=weaponForward(axeModel,tool,new THREE.Vector3()).toArray();
    return {...aim,origin:origin.toArray()};
  }
  function surfaceVisible(object){for(let n=object;n;n=n.parent)if(!n.visible||n.userData.ignoreContact)return false;return true;}
  // Every FPS/VR/projectile/physical-melee ray resolves content hits here: instanced trees have no per-tree node, and their
  // face normals need the instance matrix, so tree ids and world normals come from content.resolveTarget.
  function resolveHit(h){const t=content.resolveTarget?.(h);if(t?.id)return {targetId:t.id,point:t.point,normal:t.normal||[0,1,0]};let n=h.object;while(n&&!n.userData.targetId)n=n.parent;
    return n?{targetId:n.userData.targetId,point:h.point.toArray(),normal:(h.face?.normal.clone().transformDirection(h.object.matrixWorld)||new THREE.Vector3(0,1,0)).toArray()}:null;}
  function hitNormal(h){const t=h.object.userData.treeBatch?content.resolveTarget?.(h):null;return t?.normal?new THREE.Vector3(...t.normal):h.face?.normal.clone().transformDirection(h.object.matrixWorld)||new THREE.Vector3(0,1,0);}
  function worldContact(from,to){
    const origin=new THREE.Vector3(...from),delta=new THREE.Vector3(...to).sub(origin),length=delta.length();if(length<1e-7)return null;
    const ray=new THREE.Raycaster(origin,delta.multiplyScalar(1/length),0,length);
    if(worldMatricesAt!==contactFrame){worldTargets=[...content.targets(),...inventionVisual.targets(),shrine,startingWorld.group];for(const target of worldTargets)target.updateWorldMatrix(true,true);worldMatricesAt=contactFrame;}
    const prop=ray.intersectObjects(worldTargets,true).find(h=>surfaceVisible(h.object)),earth=terrainRay.segment(from,to);
    const useEarth=earth&&(!prop||earth.distance<=prop.distance);
    if(!prop&&!earth)return null;
    const point=useEarth?earth.point:prop.point.toArray(),normal=useEarth?earth.normal:hitNormal(prop).toArray();
    return {targetId:'world',part:'torso',point,normal,localPoint:point,localQuaternion:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),delta).toArray(),distance:useEarth?earth.distance:prop.distance};
  }
  let lastPhysicalTip=null,lastPhysicalHit=-Infinity;
  function tickPhysicalMelee(now,dt){
    if(!renderer.xr.isPresenting||!active||role!=='hero'||!axeModel||!['axe','pick','hammer'].includes(tool)){lastPhysicalTip=null;return;}
    const tip=modelTip(axeModel,tool,new THREE.Vector3());
    if(lastPhysicalTip){const travel=tip.distanceTo(lastPhysicalTip);if(travel>.018&&travel<1&&travel/Math.max(dt,.001)>1.15&&now-lastPhysicalHit>(SWING_PROFILES[tool]?.cooldown||.5)*1000){
      const from=lastPhysicalTip.toArray(),to=tip.toArray(),enemy=combat.segmentContacts(from,to)[0],world=worldContact(from,to);let hit=enemy;
      if(world&&(!enemy||world.distance<enemy.distance)){const ray=new THREE.Raycaster(lastPhysicalTip,tip.clone().sub(lastPhysicalTip).normalize(),0,travel);const h=ray.intersectObjects(content.targets().concat([shrine,startingWorld.group]),true).find(v=>surfaceVisible(v.object));if(h){const r=resolveHit(h);hit=r?{...world,...r}:null;}else hit=null;}
      if(hit){lastPhysicalHit=now;unlockAudio();feedback.contact({...hit,tool,material:contactMaterial(hit.targetId),speed:travel/Math.max(dt,.001),direction:tip.clone().sub(lastPhysicalTip).toArray()});onAction('strike',{...hit,tool});}
    }}lastPhysicalTip=tip;
  }
  function contactRay(){
    const aim=weaponAim(),from=new THREE.Vector3(...aim.origin),direction=new THREE.Vector3(...aim.direction),to=from.clone().addScaledVector(direction,3.2);
    const enemies=combat.segmentContacts(from.toArray(),to.toArray())||[];
    raycaster.set(from,direction);raycaster.far=3.2;const targets=content.targets().concat(inventionVisual.targets(),[shrine,ground,startingWorld.group]);for(const t of targets)t.updateMatrixWorld(true);
    const hits=raycaster.intersectObjects(targets,true).filter(h=>surfaceVisible(h.object));raycaster.far=Infinity;
    const enemy=enemies[0],world=hits[0],enemyDistance=enemy?from.distanceTo(new THREE.Vector3(...enemy.point)):Infinity;
    if(enemyDistance<(world?.distance??Infinity))return {...enemy,distance:enemyDistance};
    if(!world)return null;const resolved=resolveHit(world);if(!resolved)return null;
    return{...resolved,part:'torso',distance:world.distance};
  }
  // Contextual cue probe (interaction-cue-controller.js), ~10 Hz: the same aim, visible-surface filter and target set as
  // contactRay (minus the 51k-triangle ground; the cue model marches analytic terrain instead), extended to 8 m so it
  // can say "move closer". Read-only: never strikes, grabs or mutates the snapshot.
  let cueAt=-Infinity;
  function aimProbe(){
    const aim=weaponAim(),from=new THREE.Vector3(...aim.origin),direction=new THREE.Vector3(...aim.direction),to=from.clone().addScaledVector(direction,8);
    const enemy=(combat.segmentContacts(from.toArray(),to.toArray(),{includePartPoses:false})||[])[0],enemyDistance=enemy?from.distanceTo(new THREE.Vector3(...enemy.point)):Infinity;
    raycaster.set(from,direction);raycaster.far=8;const h=raycaster.intersectObjects(content.targets().concat(inventionVisual.targets(),[shrine,startingWorld.group]),true).find(v=>surfaceVisible(v.object));raycaster.far=Infinity;
    const r=h&&h.distance<enemyDistance?resolveHit(h):null;
    const hit=h&&h.distance<enemyDistance?{targetId:r?.targetId||'world',point:h.point.toArray(),distance:h.distance}:enemy?{targetId:enemy.targetId,point:enemy.point,distance:enemyDistance}:null;
    return {...aim,yaw,hit,collectible:nearestPickup};
  }
  // Explicit finger target: only loose collectibles. Mining and combat still require a tool swing.
  function collectAt(x,y){
    if(!active||role!=='hero'||renderer.xr.isPresenting||weapons.state().drawing||weapons.state().firing)return false;
    const rect=canvas.getBoundingClientRect();camera.updateMatrixWorld();
    pointer.set((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);raycaster.far=4;
    const targets=[...content.collectibleTargets(),...combat.detached.values(),...content.targets(),...inventionVisual.targets(),ground,shrine,startingWorld.group];
    for(const t of targets)t.updateWorldMatrix(true,true);
    const hits=raycaster.intersectObjects(targets,true).filter(h=>surfaceVisible(h.object));raycaster.far=Infinity;
    const first=hits[0];if(!first)return false;
    let id=content.collectibleId(first);if(!id){let n=first.object;while(n&&!n.userData.targetId)n=n.parent;id=n?.userData.targetId;}
    if(snapshot.inventions?.structures.some(b=>b.id===id))return useInvention(id);
    const collectible=(snapshot.pickups||[]).some(p=>p.id===id)||(snapshot.looseLogs||[]).some(p=>p.id===id&&!p.heldBy)||(snapshot.detachedParts||[]).some(p=>p.id===id&&!p.heldBy);
    if(!collectible||(snapshot.detachedParts||[]).some(p=>p.id===id&&p.kind==='golem'))return false;
    const from=raycaster.ray.origin,to=first.point;
    const enemy=combat.segmentContacts(from.toArray(),to.toArray(),{includePartPoses:false})[0];if(enemy)return false;
    onAction('collectTarget',{targetId:id});return true;
  }
  // Direct touch selects a visible surface, then uses the normal animated tool and collision path.
  function tapAt(x,y){
    if(!active||role!=='hero'||renderer.xr.isPresenting||weapons.state().drawing||weapons.state().firing)return false;
    if(collectAt(x,y))return true;
    if(!['axe','pick','hammer','limb'].includes(tool))return false;
    const rect=canvas.getBoundingClientRect();pointer.set((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);camera.updateMatrixWorld();raycaster.setFromCamera(pointer,camera);
    const from=raycaster.ray.origin.clone(),to=from.clone().addScaledVector(raycaster.ray.direction,3.2);
    const enemy=combat.segmentContacts(from.toArray(),to.toArray(),{includePartPoses:false})[0];
    raycaster.far=3.2;const targets=content.targets().concat(inventionVisual.targets(),[ground,shrine,startingWorld.group]);for(const t of targets)t.updateWorldMatrix(true,true);const h=raycaster.intersectObjects(targets,true).find(h=>surfaceVisible(h.object));raycaster.far=Infinity;
    const eDistance=enemy?from.distanceTo(new THREE.Vector3(...enemy.point)):Infinity;
    let point=null;
    if(enemy&&eDistance<(h?.distance??Infinity)){
      const remains=snapshot.detachedParts.find(d=>d.id===enemy.targetId);
      if(remains?.kind==='golem'&&tool!=='pick'){report('Use the pick to mine golem remains.');return false;}
      point=new THREE.Vector3(...enemy.point);
    }else if(h){const hit=resolveHit(h);if(!hit||hit.targetId==='shrine')return false;
      const ore=snapshot.deposits.find(d=>d.id===hit.targetId);
      // Content targets are only ore/tree surfaces. Keep tool requirements explicit.
      if(ore&&tool!=='pick'){report('Use the pick to mine this.');return false;}
      if(!ore&&tool!=='axe'){report('Use the axe to chop this.');return false;}point=h.point;
    }
    if(!point)return false;
    const d=point.clone().sub(from).normalize();yaw=Math.atan2(-d.x,-d.z);pitch=Math.asin(THREE.MathUtils.clamp(d.y,-1,1));camera.rotation.set(pitch,yaw,0,'YXZ');camera.updateMatrixWorld();heldSway.snap();strike();return true;
  }
  function primaryDown(){if(!active||role!=='hero'||inventionPlacement)return;unlockAudio();if(!weapons.begin()){if(renderer.xr.isPresenting)weapons.special();else strike();}}
  function special(){if(!active||role!=='hero'||inventionPlacement)return;if(tool==='crossbow'&&!renderer.xr.isPresenting)aiming=!aiming;else weapons.special();}
  function primaryUp(){if(active&&role==='hero'){weapons.end();if(wallAim&&renderer.xr.isPresenting)releaseWallAim();}}
  function collectibleVisible(from,to,id){const delta=new THREE.Vector3(...to).sub(new THREE.Vector3(...from)),length=delta.length();if(length<.01)return true;
    const ray=new THREE.Raycaster(new THREE.Vector3(...from),delta.multiplyScalar(1/length),0,Math.max(0,length-.06));
    return !ray.intersectObjects(content.targets().concat([shrine,startingWorld.group]),true).some(h=>surfaceVisible(h.object)&&resolveHit(h)?.targetId!==id);
  }
  function findCollectible(){const p=snapshot.players.find(p=>p.id===playerId);return p?nearestCollectible(snapshot,{...p,position:localPosition.toArray()},{height:(x,z)=>heightAt(x,z,snapshot.edits),visible:collectibleVisible}):null;}
  function useInvention(id){const self=snapshot.players.find(p=>p.id===playerId),b=snapshot.inventions?.structures.find(b=>b.id===id);if(!self||!b||b.type==='foundation'||b.hp<=0||(b.side!==(self.side||'party')&&b.type!=='forge')||Math.hypot(b.position[0]-localPosition.x,b.position[2]-localPosition.z)>5)return false;/* inventions.js usable reach */if(b.type==='forge'){onAction('openWorkshop',{structureId:b.id});return true;}if(b.type==='timberline'&&!touchEnabled&&!renderer.xr.isPresenting){if(manned?.id===b.id)dismountMachine();else mountMachine(b);}else if(['timberline','launcher'].includes(b.type))beginInventionPlacement('operate:'+b.id);else onAction('inventionUse',{structureId:b.id});return true;}
  function interact(){if(!active||role!=='hero')return;const c=findCollectible();if(c){onAction('collectTarget',{targetId:c.id});return;}const looked=aimProbe().hit?.targetId;if(looked&&snapshot.inventions?.structures.some(b=>b.id===looked)&&useInvention(looked))return;const b=snapshot.inventions?.structures.filter(b=>b.hp>0&&b.type!=='foundation').sort((a,b)=>Math.hypot(a.position[0]-localPosition.x,a.position[2]-localPosition.z)-Math.hypot(b.position[0]-localPosition.x,b.position[2]-localPosition.z))[0];if(b)useInvention(b.id);}

  function grab(pressIndex){if(!active||role!=='hero')return;const ore=findCollectible();if(ore&&Object.hasOwn(ORE_RECIPES,ore.kind)){sendInput(performance.now(),false,true);onAction('inventionLiftOre',{targetId:ore.id});return;}const aim=weaponAim(pressIndex);let nearLog=null;
    if(renderer.xr.isPresenting){const index=[...controllerSources.entries()].find(([,s])=>s.handedness==='right')?.[0];if(index!==undefined){const hand=grips[index].getWorldPosition(new THREE.Vector3()).toArray();nearLog=(snapshot.looseLogs||[]).filter(l=>!l.heldBy&&capsuleDistance(l,hand)<=POUCH_RULES.grabReach).sort((a,b)=>capsuleDistance(a,hand)-capsuleDistance(b,hand)||a.id.localeCompare(b.id))[0];}}
    const id=nearLog?.id||content.grabTarget?.(aim.origin,aim.direction,3)||combat.grabTarget?.(aim.origin,aim.direction,3);
    if(id){if(renderer.xr.isPresenting){sendInput(performance.now(),false,true);onAction('grab',{id,interaction:'vr-grip',hand:1});}else onAction('grab',{id});}else if(!renderer.xr.isPresenting)interact();
  }
  function pouchReady(){const p=snapshot.players.find(p=>p.id===playerId),i=[...controllerSources.entries()].find(([,s])=>s.handedness==='right')?.[0];if(!p||i===undefined)return false;const hand=localPose(grips[i]).position,pouch=waistPouchPosition({...p,yaw,head:localPose(renderer.xr.getCamera())});return Math.hypot(...hand.map((v,k)=>v-pouch[k]))<=POUCH_RULES.radius;}
  function release(throwIt=false,pressIndex){if(!active||role!=='hero')return;if(snapshot.players.find(p=>p.id===playerId)?.heldOre){sendInput(performance.now(),false,true);onAction('inventionDropOre');return;}const log=snapshot.looseLogs?.find(l=>l.heldBy===playerId);
    if(!throwIt&&log&&renderer.xr.isPresenting&&pouchReady()){sendInput(performance.now(),false,true);onAction('stowLog',{id:log.id});return;}
    onAction('release',{throw:throwIt,direction:weaponAim(pressIndex).direction});
  }
  function strike() {
    if(['crossbow','bow','wyrmspout','flask'].includes(tool)){primaryDown();return;}
    const profile=SWING_PROFILES[tool]||SWING_PROFILES.axe;
    if (!active || role !== 'hero' || specialSwing || performance.now() - swingAt < profile.cooldown*1000) return;
    swingAt = performance.now();swingContact=false;swingTarget=contactRay();swingReach=THREE.MathUtils.clamp(swingTarget?.distance||2.5,.6,2.8);
    swingRest={position:new THREE.Vector3(...FPS_WEAPON_POSE.position),quaternion:new THREE.Quaternion().setFromEuler(new THREE.Euler(...FPS_WEAPON_POSE.rotation))};
    swingRest.position.x=.33*Math.min(1,camera.aspect/.9);
    unlockAudio();
  }
  function clearInput() {
    aiming=false;weapons.cancel();specialSwing=null;cancelWallAim();pickupHighlight.clear();nearestPickup=null;feedback.reset();updateFireAudio(false);cancelCast();
    swingContact=true; swingAt=-Infinity;
    keys.clear(); jumpPending = false; rightDrag = false; move.set(0, 0, 0);
    for (const axis of Object.values(touchAxes)) { axis.x = 0; axis.y = 0; }
    xrButtons.clear(); presses.clear();
    // Repeated cleanup after setActive(false) must retain the queued stop packet.
    if (active) {
      clearTimeout(zeroInputTimer);
      const now = performance.now();
      if (now - sentAt >= 50) sendInput(now, true);
      else zeroInputTimer = setTimeout(() => { if (!disposed) sendInput(performance.now(), true); }, 51 - (now - sentAt));
    }
  }
  function cancelInventionPlacement(){inventionPlacement=null;placementPointer=null;inventionVisual.preview(null);}
  const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));
  function mannedMachine(){return manned?snapshot.inventions?.structures.find(b=>b.id===manned.id&&b.hp>0):null;}
  function mountMachine(b){weapons.cancel();clearInput();cancelCast();cancelInventionPlacement();if(manned)dismountMachine();
    manned={id:b.id,yaw:b.aimYaw||0,pitch:b.aimPitch||0,yawRate:0,sentAt:0,sent:'',sinceTick:snapshot.tick??0};yaw=(b.yaw||0)+manned.yaw;pitch=manned.pitch;
    onAction('inventionMount',{structureId:b.id});report('Manning the Timberline. Mouse swings it, click fires, hold R to wind faster, E or Esc steps off.');}
  function dismountMachine(send=true){if(!manned)return;const id=manned.id;manned=null;inventionVisual.setLocalAim(id,null);pitch=0;heldSway.snap();if(send)onAction('inventionMount',{structureId:id,off:true});}
  function fireManned(){const b=mannedMachine();if(!b)return;unlockAudio();onAction('inventionUse',{structureId:b.id,aim:{yaw:manned.yaw,pitch:manned.pitch}});}
  // Heavy traverse: the wanted aim is the mouse; the carriage accelerates toward it and tops out near 50 degrees/s.
  function updateManned(dt,now){
    const b=mannedMachine();
    if(b?.operator===playerId)manned.confirmed=true;
    // Authority decides: another operator, our seat released after it was confirmed, or a mount the authority never confirmed within two simulated seconds.
    const lost=!b||(b.operator&&b.operator!==playerId)||(manned.confirmed&&!b.operator)||(!manned.confirmed&&(snapshot.tick??0)-manned.sinceTick>120);
    if(lost||!active||role!=='hero'||renderer.xr.isPresenting){dismountMachine(!!b&&active&&!lost);return;}
    pitch=THREE.MathUtils.clamp(pitch,MANNED.pitchMin,MANNED.pitchMax);
    const err=wrapAngle(wrapAngle(yaw-(b.yaw||0))-manned.yaw),want=THREE.MathUtils.clamp(err*3,-.9,.9);
    manned.yawRate+=THREE.MathUtils.clamp(want-manned.yawRate,-2.4*dt,2.4*dt);manned.yaw=wrapAngle(manned.yaw+manned.yawRate*dt);
    manned.pitch+=THREE.MathUtils.clamp(pitch-manned.pitch,-.5*dt,.5*dt);
    inventionVisual.setLocalAim(b.id,{yaw:manned.yaw,pitch:manned.pitch});
    const seat=operatorSeat(b,manned.yaw);localPosition.set(seat[0],heightAt(seat[0],seat[2],snapshot.edits),seat[2]);correction.set(0,0,0);verticalSpeed=0;grounded=true;
    const key=manned.yaw.toFixed(3)+','+manned.pitch.toFixed(3);
    if(key!==manned.sent&&now-manned.sentAt>=100){manned.sent=key;manned.sentAt=now;onAction('inventionSteer',{structureId:b.id,aim:{yaw:manned.yaw,pitch:manned.pitch}});}
  }
  // Hold R to wind: the operator doubles the reload; a second Hero cranking beside it quadruples it.
  function crankNearby(now){
    if(!active||role!=='hero'||!keys.has('KeyR')||now-crankAt<150)return;
    const self=snapshot.players.find(p=>p.id===playerId),b=manned?mannedMachine():snapshot.inventions?.structures.find(b=>b.type==='timberline'&&b.hp>0&&b.side===(self?.side||'party')&&Math.hypot(b.position[0]-localPosition.x,b.position[2]-localPosition.z)<=MANNED.crankReach);
    if(!b||!(snapshot.tick<b.readyTick))return;crankAt=now;onAction('inventionCrank',{structureId:b.id});
  }
  function beginInventionPlacement(type){weapons.cancel();clearInput();cancelCast();inventionPlacement=type;document.exitPointerLock?.();report(type.startsWith('operate:')?'Aim at the target and tap/click to fire. Escape cancels.':'Tap/click clear ground to build. Escape cancels.');}
  function placeInvention(point){if(!inventionPlacement)return;const mode=inventionPlacement,self=snapshot.players.find(p=>p.id===playerId);if(!mode.startsWith('operate:')&&self){const validation=validateInventionPlacement(snapshot,{...self,position:localPosition.toArray()},{kind:mode,position:point.toArray(),yaw},{terrainHeight:sharedTerrainHeight});if(!validation.ok){inventionVisual.preview(point,mode,validation);onAction('placementFeedback',{reason:validation.reason});return;}}cancelInventionPlacement();if(mode.startsWith('operate:'))onAction('inventionUse',{structureId:mode.slice(8),target:point.toArray()});else onAction('inventionBuild',{kind:mode,type:mode,position:point.toArray(),x:point.x,z:point.z,yaw});}
  listen(canvas,'pointerdown',event=>{if(!active||!inventionPlacement)return;event.preventDefault();event.stopImmediatePropagation();placementPointer=event.pointerId;},true);
  listen(canvas,'pointerup',event=>{if(!active||!inventionPlacement||event.pointerId!==placementPointer)return;event.preventDefault();event.stopImmediatePropagation();const hit=pointerHit(event);if(hit)placeInvention(hit.point);},true);
  listen(canvas,'pointercancel',()=>{placementPointer=null;});
  listen(canvas,'pointermove',event=>{if(!active||!inventionPlacement)return;const hit=pointerHit(event);const self=snapshot.players.find(p=>p.id===playerId),validation=hit&&self&&!inventionPlacement.startsWith('operate:')?validateInventionPlacement(snapshot,{...self,position:localPosition.toArray()},{kind:inventionPlacement,position:hit.point.toArray(),yaw},{terrainHeight:sharedTerrainHeight}):null;inventionVisual.preview(hit?.point||null,inventionPlacement,validation);},true);
  listen(window,'keydown',event=>{if(inventionPlacement&&event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancelInventionPlacement();}},true);
  // Prime both sound banks on the first game gesture, before the first physical impact.
  listen(window, 'pointerdown', () => { if (active) unlockAudio(); });
  listen(window, 'keydown', event => {
    if (!active || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName) || event.target?.isContentEditable) return;
    unlockAudio();
    if (role === 'god' && event.code === 'Escape') { cancelCast(); return; }
    if (role === 'hero' && event.code === 'Escape' && wallAim) { cancelWallAim(); return; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.code === 'Space' && !event.repeat && role === 'hero') jumpPending = true;
    if (role === 'hero' && !event.repeat && manned) { if (event.code === 'KeyE' || event.code === 'Escape') dismountMachine(); }
    else if (role === 'hero' && !event.repeat) {const slot=Number(event.code.replace('Digit',''))-1;if(slot>=0&&slot<equipment.length)equip(equipment[slot]);if(event.code==='KeyE')interact();if(event.code==='KeyB'&&event.shiftKey)onAction('buildBridge');if(event.code==='KeyF')grab();if(event.code==='KeyG')release();if(event.code==='KeyX')release(true);if(event.code==='KeyQ')special();}
    if(role==='god'&&!inventionPlacement&&!event.repeat&&spellKeys[event.code]){spell=spellKeys[event.code];onSelection(spell);castStart=null;if(quickCast&&cursor.visible){quickKey=event.code;if(isLineSpell())castStart=hitPoint.clone();else castAt(hitPoint);}}
  });
  listen(window,'keyup',event=>{
    keys.delete(event.code);
    if(event.code==='KeyQ'&&wallAim&&role==='hero')releaseWallAim();
    if(event.code===quickKey){
      if(castStart&&active&&role==='god'&&cursor.visible)castAt(hitPoint,true);
      else cancelCast();
    }
  });
  listen(window,'keydown',event=>{if(event.code==='Escape'){deliberateRelease=true;resumeCapture=false;}},true);
  function rememberCapture(){resumeCapture=resumeCapture||(!deliberateRelease&&(wasCaptured||document.pointerLockElement===canvas||performance.now()-lastCaptureLost<300)&&active&&role==='hero'&&!touchEnabled&&!renderer.xr.isPresenting);}
  function resumePointer(){if(resumeCapture&&!deliberateRelease&&active&&role==='hero'&&!touchEnabled&&!renderer.xr.isPresenting&&!document.hidden&&document.hasFocus()){resumeCapture=false;if(!document.pointerLockElement)void capturePointer(true);}}
  listen(window,'blur',()=>{rememberCapture();clearInput();});
  listen(window,'focus',()=>setTimeout(resumePointer,50));
  listen(document,'visibilitychange',()=>{if(document.hidden){rememberCapture();clearInput();}else setTimeout(resumePointer,50);});
  listen(document,'pointerlockchange',()=>{const captured=document.pointerLockElement===canvas;if(captured){wasCaptured=true;deliberateRelease=false;}else{if(wasCaptured)lastCaptureLost=performance.now();if(!document.hasFocus()&&!deliberateRelease)resumeCapture=wasCaptured;if(document.hasFocus())wasCaptured=false;clearInput();}});
  listen(document, 'pointerlockerror', () => report('Mouse capture was blocked. Click the canvas again, or check browser permissions. Esc releases capture.'));
  listen(canvas, 'contextmenu', event => event.preventDefault());
  listen(canvas, 'pointerdown', event => {
    if (!active || event.pointerType !== 'mouse') return;
    if (role === 'hero') { return;    } else {
      if (event.button === 2) { cancelCast(); rightDrag = true; }
      if (event.button === 0 && !quickKey) { const hit = pointerHit(event); if (hit) castAt(hit.point); }
    }
  });
  // Pointerdown fires only for the first pressed mouse button. Native mouse
  // events keep left fire independent while right aim is already held.
  listen(canvas,'mousedown',event=>{
    if(!active||role!=='hero'||inventionPlacement||event.sourceCapabilities?.firesTouchEvents)return;
    if(document.pointerLockElement!==canvas){void capturePointer();return;}
    if(manned){if(event.button===0)fireManned();return;}
    if(event.button===0)primaryDown();
    if(event.button===2){if(['crossbow','bow'].includes(tool))aiming=true;else weapons.special();}
  });
  listen(window,'mouseup',event=>{if(role!=='hero')return;if(event.button===0)primaryUp();if(event.button===2){aiming=false;if(wallAim)releaseWallAim();}});
  listen(window,'pointerup',event=>{
    if(event.pointerType!=='mouse')return; // touch buttons own their press/release; another finger must not release a held bow
    rightDrag=false;
    if(event.button===0){
      if(role!=='hero'&&castStart&&!touchEnabled&&!quickKey){
        const hit=event.target===canvas?pointerHit(event):null;
        if(hit)castAt(hit.point,true);else cancelCast();
      }
    }
  });
  listen(window, 'pointermove', event => {
    if (!active || event.pointerType !== 'mouse') return;
    if (role === 'hero' && document.pointerLockElement === canvas) {
      yaw -= event.movementX * 0.0022;
      pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.0022, -1.48, 1.48);
    } else if (role === 'god' && !renderer.xr.isPresenting) {
      if (rightDrag) { orbitYaw -= event.movementX * 0.004; orbitTilt = THREE.MathUtils.clamp(orbitTilt + event.movementY * 0.003, 0.35, 1.35); }
      if (event.target === canvas) { const hit = pointerHit(event); cursor.visible = !!hit; if (hit) cursor.position.copy(hit.point).add(new THREE.Vector3(0, 0.08, 0)); }
      else cursor.visible = false;
    }
  });
  listen(canvas, 'wheel', event => {
    if (active && role === 'god') { event.preventDefault(); orbitRadius = THREE.MathUtils.clamp(orbitRadius + event.deltaY * 0.03, 10, 70); }
  }, { passive: false });
  listen(renderer.xr, 'sessionstart', () => { clearInput(); onXRChange(true); camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0); weaponAnchor.visible = false; attachWeapon(); report('VR connected. Stick to walk; trigger to strike.'); });
  listen(renderer.xr, 'sessionend', () => { clearInput(); adventurePanel.endSession(); onXRChange(false); camera.position.set(0, 1.65, 0); attachWeapon(); resize(); report('VR session ended.'); });

  function movement() {
    const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    const z = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
    let axisX = x + touchAxes.left.x, axisZ = z + touchAxes.left.y;
    if (renderer.xr.isPresenting) {
      const xrCamera = renderer.xr.getCamera();
      xrCamera.getWorldDirection(forward);
      yaw = Math.atan2(-forward.x, -forward.z);
      // Edge mapping lives in vr-input-policy.js buttonActions (docs/VR-CONTROLS.md); grab/drop aim from the gripping hand.
      for (const [index, source] of controllerSources) {
        const {state, actions} = buttonActions(source, xrButtons.get(index), {active, hero: role === 'hero'});
        xrButtons.set(index, state);
        for (const action of actions) {
          if (action === 'menu') { weapons.cancel(); presses.invalidate(); void renderer.xr.getSession()?.end().then(onMenu); }
          else if (action === 'jump') jumpPending = true;
          else if (action === 'cycle') { const choices=equipment.filter(t=>t!=='limb'); equip(choices[(choices.indexOf(tool)+1)%choices.length]); }
          else if (action === 'hand') { if (holdingLoose()) release(false, index); else grab(index); }
          else if (action === 'bridge') onAction('buildBridge');
          else if (action === 'interact') interact();
        }
      }
      for (const index of moveIndexes(controllerSources)) {
        const axes = controllerSources.get(index).gamepad.axes;
        const sx = axes.length >= 4 ? axes[2] : axes[0] || 0;
        const sz = axes.length >= 4 ? axes[3] : axes[1] || 0;
        axisX += Math.abs(sx) > 0.14 ? sx : 0;
        axisZ += Math.abs(sz) > 0.14 ? sz : 0;
      }
    }
    const angle = role === 'god' && !renderer.xr.isPresenting ? orbitYaw : yaw;
    move.set(axisX * Math.cos(angle) + axisZ * Math.sin(angle), 0, -axisX * Math.sin(angle) + axisZ * Math.cos(angle));
    if (move.lengthSq() > 1) move.normalize();
    if (!active || document.hidden || manned) move.set(0, 0, 0);
  }
  function localPose(object) {
    object.updateWorldMatrix(true, false);
    object.matrixWorld.decompose(posePosition, poseQuaternion, poseScale);
    posePosition.sub(rig.position);
    return { position: posePosition.toArray(), quaternion: poseQuaternion.toArray() };
  }
  function sendInput(now, zero = false, force = false) {
    if ((!active && !zero) || !force && now - sentAt < 50) return;
    sentAt = now;
    const input = { move: { x: role === 'hero' && !zero ? move.x : 0, z: role === 'hero' && !zero ? move.z : 0 }, yaw, jump: !zero && jumpPending };
    if (renderer.xr.isPresenting) {
      input.head = localPose(renderer.xr.getCamera());
      input.hands = ['left','right'].map(hand=>{const i=[...controllerSources.entries()].find(([,s])=>s.handedness===hand)?.[0];return i===undefined?{position:[0,1,0],quaternion:[0,0,0,1]}:localPose(grips[i]);});
    }
    onInput(input);
    if (jumpPending && !zero && grounded && role === 'hero') { verticalSpeed = 5.5; grounded = false; }
    jumpPending = false;
  }
  function frame(now) {
    contactFrame++;
    if (disposed) return;
    const frameStarted=performance.now();
    frameMetrics.record('frameInterval',now-previous);
    const dt = Math.min((now - previous) / 1000, 0.05);
    previous = now; renderTick=presentationClock.sample(now);
    if (active && !renderer.xr.isPresenting) {
      lookBy(touchAxes.right.x * dt * 2.1, touchAxes.right.y * dt * 1.6);
    }
    const heldOre=snapshot.players.find(p=>p.id===playerId)?.heldOre;if(heldOre!==heldOreKind){heldOreKind=heldOre;heldOreVisual.clear();const asset=heldOre?heldResourceArt.pickup(heldOre):null;if(asset){asset.scale.setScalar(HELD_SCALE);heldOreVisual.add(asset);}}heldOreVisual.visible=!!heldOre;heldResourceArt.update(now/1000);
    if(heldOre){const i=[...controllerSources.entries()].find(([,source])=>source.handedness==='right')?.[0];if(renderer.xr.isPresenting&&i!==undefined){grips[i].getWorldPosition(heldOreVisual.position);grips[i].getWorldQuaternion(heldOreVisual.quaternion);}else{const aim=weaponAim();heldOreVisual.position.fromArray(aim.origin).addScaledVector(new THREE.Vector3(...aim.direction),.4);}}
    movement();
    if (renderer.xr.isPresenting) adventurePanel.tick(renderer.xr.getCamera(), {suppressed: !active});
    sendInput(now);
    // Stop prediction when snapshots stall; server also expires held input at 300ms.
    if (active && role === 'hero' && initialized && now - snapshotAt < 500) {
      const me=snapshot.players.find(p=>p.id===playerId),pace=dt*5*swiftFactor(snapshot,me||{});const predicted=localPosition.toArray();moveOnTerrain(snapshot,predicted,move.x*pace,move.z*pace);localPosition.fromArray(predicted);
      const forgeY=heightAt(0,0,snapshot.edits);
      const groundY = inventionFloor(snapshot,localPosition.x,localPosition.z,forgeFloor(localPosition.x,localPosition.z,forgeY,simulationHeight(snapshot, localPosition.x, localPosition.z)),localPosition.y);
      if (!grounded) { verticalSpeed -= 15 * dt; localPosition.y += verticalSpeed * dt; }
      if (!grounded && localPosition.y <= groundY && verticalSpeed < -4) orchard.contact(localPosition.x, localPosition.z, {strength: 1.5}); // landing dust (presentation only)
      if (grounded || localPosition.y <= groundY) { localPosition.y = groundY; verticalSpeed = 0; grounded = true; }
      if (grounded && (stepDistance += move.length() * dt * 5) > .75) { stepDistance = 0; orchard.contact(localPosition.x, localPosition.z, {strength: .6}); }
      const amount = 1 - Math.exp(-dt * 8);
      localPosition.addScaledVector(correction, amount);
      correction.multiplyScalar(1 - amount);
      localPosition.y = Math.max(localPosition.y, groundY);
      localPosition.fromArray(resolveForge(localPosition.toArray(),forgeY));localPosition.fromArray(resolveInventions(snapshot,localPosition.toArray()));if(snapshot.landmarks)localPosition.fromArray(resolveStartingWorld(localPosition.toArray(),(x,z)=>heightAt(x,z,snapshot.edits)));
    }
    if (manned) updateManned(dt, now);
    crankNearby(now);
    if (role === 'god' && !renderer.xr.isPresenting) {
      pan.addScaledVector(move, dt * 18);
      pan.x = THREE.MathUtils.clamp(pan.x, -45, 45); pan.z = THREE.MathUtils.clamp(pan.z, -45, 45);
      rig.position.set(0, 0, 0);
      camera.position.set(pan.x + Math.sin(orbitYaw) * orbitRadius * Math.cos(orbitTilt), heightAt(pan.x, pan.z, snapshot.edits) + orbitRadius * Math.sin(orbitTilt) + 3, pan.z + Math.cos(orbitYaw) * orbitRadius * Math.cos(orbitTilt));
      camera.lookAt(pan.x, heightAt(pan.x, pan.z, snapshot.edits), pan.z);
    } else {
      rig.position.copy(localPosition);
      const b = manned && mannedMachine();
      if (!renderer.xr.isPresenting) { camera.position.set(0, 1.65, 0); if (b) camera.rotation.set(manned.pitch, (b.yaw || 0) + manned.yaw, 0, 'YXZ'); else camera.rotation.set(pitch, yaw, 0, 'YXZ'); }
    }
    if (touchEnabled && role === 'god' && active && !renderer.xr.isPresenting) updateTouchAim();
    weaponAnchor.visible = role === 'hero' && !renderer.xr.isPresenting && active && !manned;
    if (axeModel) axeModel.visible = role === 'hero' && active;
    const profile=SWING_PROFILES[tool]||SWING_PROFILES.axe,progress=(now-swingAt)/(profile.duration*1000);
    // Look inertia, gait bob and jump/land on the camera-held item (held-sway.js); presentation only, never aim.
    const swinging=(progress>=0&&progress<1&&!!swingRest)||!!specialSwing,swayMe=snapshot.players.find(p=>p.id===playerId);
    const sway=heldSway.update(dt,{yaw,pitch,move:swayMove.copy(move).multiplyScalar(5*swiftFactor(snapshot,swayMe||{})),grounded,verticalSpeed,tool,calm:adsAmount,swinging,visible:weaponAnchor.visible});
    if(progress>=0&&progress<1&&swingRest&&!renderer.xr.isPresenting){const pose=swingPose(tool,progress,swingRest,weaponTip,swingReach);weaponAnchor.position.copy(pose.position);weaponAnchor.quaternion.copy(pose.quaternion);}
    else {weaponAnchor.position.fromArray(tool==='bow'?[-.25,-.32,-.48]:['crossbow','wyrmspout','flask'].includes(tool)?[.24,-.3,-.48]:FPS_WEAPON_POSE.position).add(idleOffset(now/1000));weaponAnchor.position.x*=Math.min(1,camera.aspect/.9);weaponAnchor.rotation.fromArray(['bow','crossbow','wyrmspout','flask'].includes(tool)?[0,0,tool==='bow'?-.08:0]:FPS_WEAPON_POSE.rotation);}
    if(tool==='crossbow'&&siegebirdAim&&!renderer.xr.isPresenting){adsAmount=siegebirdAim.update(dt,active&&role==='hero'&&aiming,idleOffset(now/1000).add(sway.position));
      // Release kick: the stock shoves back and the muzzle climbs, then springs home (the bolt has already left).
      const kick=siegebirdMechanism(weapons.state().reload).kick;if(kick){weaponAnchor.position.z+=.05*kick;weaponAnchor.position.y+=.012*kick;weaponAnchor.rotateX(.075*kick);}}else if(tool==='bow'&&!renderer.xr.isPresenting){adsAmount=THREE.MathUtils.lerp(adsAmount,active&&role==='hero'&&aiming?1:0,1-Math.exp(-14*dt));weaponAnchor.position.lerp(new THREE.Vector3(-.22*Math.min(1,camera.aspect/.9),-.29,-.51),adsAmount);weaponAnchor.rotation.z=THREE.MathUtils.lerp(-.08,-.025,adsAmount);}else adsAmount=0;
    if(!renderer.xr.isPresenting){const fov=70+((tool==='bow'?56:SIEGEBIRD_PRESENTATION.zoomFov)-70)*adsAmount;if(Math.abs(camera.fov-fov)>.001){camera.fov=fov;camera.updateProjectionMatrix();}}
    if(!swingContact&&progress>=.5){swingContact=true;const hit=contactRay();onAction('strike',hit?{...hit,tool}:{targetId:'miss',point:localPosition.toArray(),normal:[0,1,0],tool});}
    if(specialSwing){const progress=(now-specialSwing.at)/(SPECIAL_MOTION.axe.duration*1000);if(!specialSwing.sent&&progress>=SPECIAL_MOTION.axe.release){specialSwing.sent=true;sendSpecial();}const pose=specialPose('axe',progress,specialSwing.rest);weaponAnchor.position.copy(pose.position);weaponAnchor.quaternion.copy(pose.quaternion);if(progress>=1)specialSwing=null;}
    // The crossbow bore is solved onto the reticle, so it takes the positional sway only (above).
    if(tool!=='crossbow'&&weaponAnchor.visible){weaponAnchor.position.add(sway.position);weaponAnchor.quaternion.premultiply(sway.quaternion);}
    if(waistPouch){waistPouch.visible=active&&role==='hero'&&renderer.xr.isPresenting;if(waistPouch.visible){const p=snapshot.players.find(p=>p.id===playerId);waistPouch.position.fromArray(waistPouchPosition({...p,yaw,head:localPose(renderer.xr.getCamera())}));waistPouch.position.y-=.181;waistPouch.rotation.y=yaw;}}
    {const wound=siegebirdWind.update(dt,siegebirdGrip());for(const c of wound.cues)siegebirdCue({...c,crank:true});siegebirdWindVerdict(wound.wind);}
    if(axeModel)updateWeaponPresentation(axeModel,tool,{...weapons.state(),hand:tool==='crossbow'?siegebirdWind.hand():null,time:now/1000,templates});
    if(tool==='crossbow'&&axeModel)updateSiegebirdLocal(now,weapons.state().reload);
    siegebirdFlock?.updateWorld(now/1000,{viewer:camera.getWorldPosition(siegebirdViewer)});
    weapons.tick();const weaponState=weapons.state();feedback.draw(weaponState);updateFireAudio(weaponState.firing);
    setEmberdewTime(now/1000);
    if(tool==='flask'&&axeModel){flaskModel.updateWorldMatrix(true,false);bottleFx.update({dt,time:now/1000,lit:!!snapshot.players.find(p=>p.id===playerId)?.flaskLit,worldPosition:flaskModel.getWorldPosition(bottlePosition),worldQuaternion:flaskModel.getWorldQuaternion(bottleRotation)});}
    const ranged=rangedReticle.set({tool,role,menuOpen:!active||(tool==='crossbow'&&adsAmount>.5),presenting:renderer.xr.isPresenting,...weaponState});
    document.body.classList.toggle('ranged-aim-active',!!ranged||adsAmount>.5);
    if(shouldShowTrajectory({tool,role,menuOpen:!active,...weaponState})){
      if(now>=nextGuideAt){nextGuideAt=now+66;const guideStart=performance.now(),aim=projectileAim();trajectoryGuide.update({origin:aim.origin,aimDirection:aim.direction,curveBase:weaponState.curveBase,draw:weaponState.draw,hit:worldContact,terrainHeight:heightAt,sampleEvery:3});guideTiming.lastMs=performance.now()-guideStart;guideTiming.maxMs=Math.max(guideTiming.maxMs,guideTiming.lastMs);guideTiming.updates++;}
    }else{trajectoryGuide.hide();nextGuideAt=0;}
    content.tick(now,(snapshot.tick||0)+Math.min(3,Math.max(0,now-snapshotAt)*.06));impacts.update(dt);rewards.update(dt);fireVisual.update(now,dt);expedition.update(now,dt,camera);woodAudio?.tick(listenerPose());materialAudio?.tick(listenerPose());
    updateWallPreview();{const wallEvents=content.crystalWall.drainEvents();if(wallAudio&&(wallEvents.burst.length||wallEvents.shatter.length||wallEvents.warn.length))wallAudio.play(wallEvents,listenerPose());}
    if(now-cueAt>=100){cueAt=now;nearestPickup=active&&role==='hero'?findCollectible():null;pickupHighlight.update(nearestPickup,now,(x,z)=>heightAt(x,z,snapshot.edits));const xr=renderer.xr.isPresenting,live=active&&role==='hero'&&!xr&&initialized;onAimProbe?.(live?aimProbe():null,{active,role,xr,mode:touchEnabled?'touch':'desktop',position:localPosition.toArray(),yaw});}
    for (const entry of actors.values()) {
      const animation = entry.visual.userData;
      if (animation.actions) {
        const age=(snapshot.tick||0)-(entry.data.hurtTick??-1000),attackAge=(snapshot.tick||0)-(entry.data.attackTick??-1000);
        const motion=age<22&&animation.actions.stagger?'stagger':attackAge<28&&animation.actions.attack?'attack':entry.root.position.distanceToSquared(entry.target)>.001?'walk':'idle';
        if (motion !== animation.motion) {
          animation.actions[animation.motion].fadeOut(0.18);
          animation.actions[motion].reset().fadeIn(0.18).play();
          animation.motion = motion;
        }
      }
      entry.root.position.lerp(entry.target, 1 - Math.exp(-dt * 12));
      if (entry.enemy || !entry.data.head) entry.root.rotation.y = entry.data.yaw || 0;
      else entry.root.rotation.y = 0;
      if (entry.visual.userData.hero) heroView.update(entry.visual, entry.data, entry.root, dt, (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldPosition(heroCamera));
    }
    inventionVisual.update(dt,renderTick,camera,canvas.clientHeight);
    settlementVisual.update(dt,(renderer.xr.isPresenting?renderer.xr.getCamera():camera).getWorldPosition(heroCamera));
    combat.beginCreatureFrame?.();
    for(const entry of actors.values())if(entry.enemy)meteorCreatures.beforeMotion(entry);
    for (const mixer of mixers) mixer.update(dt);
    // Enemy motion polish (opus-enemy-character): after clips, before contacts, so hits see the final pose.
    updateEnemyMotion(actors,{tick:renderTick,dt,height:enemyGround});
    golemFx.update(actors,renderTick,dt,now/1000);
    entView.update(actors,renderTick,dt);entView.tick(dt);
    combat.tick(dt,isHost(),now/1000,renderTick);
    if(tool==='limb'&&!renderer.xr.isPresenting&&role==='hero')combat.poseLocalHeld?.(playerId,weaponAnchor);
    tickPhysicalMelee(now,dt);
    const heldRoot=tool==='limb'?combat.heldLimbRoot(playerId):axeModel;
    if(!heldRoot||heldRoot!==failedReadinessRoot){try{heldReadiness=syncWeaponReadiness(heldReadiness,{root:heldRoot,tool,reducedMotion:reducedWeaponMotion});}catch(error){failedReadinessRoot=heldRoot;heldReadiness=null;report(`Weapon readiness: ${error.message}`);}}
    const readiness=weaponReadiness(snapshot.players.find(p=>p.id===playerId),tool,snapshot.tick);
    heldReadiness?.update({...readiness,time:now/1000});
    axeReadyCue.update(role==='hero'&&heldReadiness?tool:null,readiness.specialReady);
    enemyShadows.update(actors,role==='god'?pan:localPosition,now,{maxCasters:touchEnabled?4:8});
    spellVisual.setTarget(targetPreview());
    spellVisual.update(now,dt);cleaveView.update(performance.now());
    const estimatedTick = (snapshot.tick || 0) + Math.min(0.3, (now - snapshotAt) / 1000) * 60;
    for (const warning of warnings.values()) {
      const remaining = Math.max(0, warning.impactTick - estimatedTick);
      const urgency = 1 - Math.min(1, remaining / 48);
      warning.ring.material.opacity = 0.65 + 0.35 * Math.sin(now * (0.011 + urgency * 0.018)) ** 2;
      warning.fill.material.opacity = 0.12 + urgency * 0.18;
    }
    if (shrine.visible) {
      shrineBarBack.quaternion.copy(camera.getWorldQuaternion(poseQuaternion));
      shrineBar.quaternion.copy(shrineBarBack.quaternion);
      shrineCore.rotation.y += dt * 0.7;
    }
    meadowPushers.length = 0; if (role === 'hero') meadowPushers.push([localPosition.x, localPosition.y, localPosition.z, .8]);
    for (const p of snapshot.players || []) { if (meadowPushers.length >= 4) break; if (p.id !== playerId && p.role === 'hero' && p.position) meadowPushers.push([p.position[0], p.position[1], p.position[2], .8]); }
    meadow.update(dt, camera, {pushers: meadowPushers}); oreGlint.update(dt, camera);
    orchard.update(dt, camera); skyline.update(camera);
    renderer.render(scene, camera);
    frameMetrics.record('frameCpu',performance.now()-frameStarted);
  }
  function disposeResources(root) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    root.traverse(child => {
      child.skeleton?.dispose();
      if (child.geometry) geometries.add(child.geometry);
      const items = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
      for (const material of items) { materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); }
    });
    geometries.forEach(value => value.dispose()); textures.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
  }
  rebuildGround(); resize(); renderer.setAnimationLoop(frame);
  void spellVisual.prepareShaders(renderer, camera, scene).then(() => expedition.prepare(renderer,camera,scene)).then(() => {
    if (!disposed) return renderer.compileAsync(scene, camera);
  }).catch(error => {
    if (!disposed) report(`Shader preparation: ${error.message}`);
  });
  report(`World renderer ready (${Math.round(performance.now() - started)} ms).`);
  // Read-only presentation evidence for browser QA (no input, state or credentials).
  Object.defineProperty(canvas, 'brannDiagnostics', {configurable: true, value: () => disposed ? null : api.diagnostics()});
  const api = {
    applySnapshot(next, id) {
      if (disposed) return;
      const syncStarted=performance.now();
      worldMatricesAt=-1;
      const previousSelf=snapshot.players.find(p=>p.id===id), previousRoom=snapshot.room;
      snapshot = { ...next, players: next.players || [], enemies: next.enemies || [], edits: next.edits || [], groves: next.groves || [], pendingStarfalls: next.pendingStarfalls || [] };
      currentTerrainBake=snapshot.terrainBake;terrainSampler.setState(snapshot);
      if (id !== playerId) feedback.reset();
      playerId = id; snapshotAt = performance.now(); feedback.sync(snapshot, id);
      presentationClock.observe(snapshot.tick||0,snapshotAt,{reset:previousRoom!==snapshot.room});
      const self = snapshot.players.find(player => player.id === playerId);
      if(previousSelf && self?.castTick>previousSelf.castTick && pendingCastPreview){spellVisual.commitTarget(pendingCastPreview);pendingCastPreview=null;}
      if (self) {
        if(self.tool && self.tool!==tool)equipVisual(self.tool);
        const authoritative = new THREE.Vector3().fromArray(self.position);
        if (!initialized || authoritative.distanceTo(localPosition) > 4) {
          localPosition.copy(authoritative); correction.set(0, 0, 0); initialized = true;
          verticalSpeed = 0; grounded = authoritative.y <= forgeFloor(authoritative.x,authoritative.z,heightAt(0,0,snapshot.edits),simulationHeight(snapshot,authoritative.x,authoritative.z)) + 0.05;
        }
        else correction.copy(authoritative).sub(localPosition);
        // Grounded height follows the same live terrain function as the server.
        if (grounded) localPosition.y = authoritative.y;
      }
      startingWorld.group.visible=!!snapshot.landmarks;const nextStartingEdits=terrainFrameKey(snapshot.edits,snapshot.tick)+'|'+foundationTerrainKey(snapshot);if(startingEdits!==nextStartingEdits){startingEdits=nextStartingEdits;startingWorld.update();}
      combat.prepareActors(snapshot);rebuildGround(); syncActors(); combat.sync(snapshot,{prepared:true}); syncTrees(); syncWorldSignals();spellVisual.sync(snapshot);fireVisual.sync(snapshot);syncOrchardContent();meadow.sync(snapshot);oreGlint.sync(snapshot);expedition.applySnapshot(snapshot.adventure,snapshot);settlementVisual.sync(snapshot);inventionVisual.sync(snapshot);
      frameMetrics.record('snapshotCpu',performance.now()-syncStarted);
    },
    setRole(next) {
      if (next !== 'hero' && next !== 'god') return;
      clearInput(); role = next; fixedAim = null; aimTerrain = null; cursor.visible = false; correction.set(0, 0, 0);
      if (role === 'god') { pan.copy(localPosition); if (document.pointerLockElement === canvas) document.exitPointerLock(); }
      report(role === 'god' ? 'God: WASD pan, right-drag orbit, wheel zoom, click to cast.' : 'Hero: click to look, WASD move, Space jump, click strike.');
    },
    setSpell(next) { spell = next;cancelCast(); },
    setQuickCast(value){quickCast=!!value;cancelCast();},
    setTouchEnabled(value) { if (touchEnabled !== !!value) {clearInput(); touchEnabled = !!value; fixedAim = null; aimTerrain = null; cursor.visible = false;} },
    setTouchAxes(side, x, y) {
      if (!active || !touchEnabled || renderer.xr.isPresenting || !touchAxes[side]) return;
      touchAxes[side].x = THREE.MathUtils.clamp(Number.isFinite(x) ? x : 0, side === 'right' ? -2 : -1, side === 'right' ? 2 : 1);
      touchAxes[side].y = THREE.MathUtils.clamp(Number.isFinite(y) ? y : 0, side === 'right' ? -2 : -1, side === 'right' ? 2 : 1);
    },
    lookByPixels(x, y) { lookBy(x * 0.003, y * 0.003); },
    zoomBy(amount) { if (active && role === 'god') orbitRadius = THREE.MathUtils.clamp(orbitRadius + amount, 10, 70); },
    aimAt(x, y) {
      if (!active || role !== 'god') return false;
      camera.updateMatrixWorld(); const hit = pointerHit({clientX:x, clientY:y});
      fixedAim = hit ? hit.point.clone() : null; aimTerrain = null; if(hit)updateTouchAim();else cursor.visible=false; return !!hit;
    },
    touchCastState() { return {line:isLineSpell(),quick:quickCast,revision:castRevision,start:!!castStart}; },
    beginAimLine() { if(active&&role==='god'&&isLineSpell()&&!castStart&&cursor.visible)castStart=hitPoint.clone(); },
    cancelAim() { fixedAim = null; aimTerrain = null; cancelCast(); if (active && role === 'god') updateTouchAim(); },
    castAim() { if (active && role === 'god' && updateTouchAim()) castAt(hitPoint); },
    centerView() { if (active && role === 'god') { pan.copy(localPosition); fixedAim = null; aimTerrain = null; } },
    jump() { if (active && role === 'hero') jumpPending = true; },
    projectWorld(point){camera.updateMatrixWorld();const p=new THREE.Vector3(...point).project(camera);if(p.z < -1||p.z>1)return null;const r=canvas.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2,viewportWidth:innerWidth,viewportHeight:innerHeight};},
    fireSamples:id=>combat.fireSamples(id),strike, equip, primaryDown,primaryUp,collectAt,tapAt,collectTarget(id){if(active&&role==='hero'&&!useInvention(id))onAction('collectTarget',{targetId:id});},grab,release,special,specialPress,cancelSpecialAim:cancelWallAim,weaponState:()=>({tool,aiming,ads:adsAmount,fov:camera.fov,zeroDistance:tool==='crossbow'?30:null,...weapons.state()}),
    useResource(kind){if(active&&role==='hero')onAction('useResource',{kind});},
    beginInventionPlacement,
    interact,
    buildBridge(){if(active&&role==='hero')onAction('buildBridge');},
    handleEvent,
    setDamageNumbers(enabled){combat.setDamageNumbers(!!enabled);},
    diagnostics(){return {cpuTimings:frameMetrics.stats(),rewards:rewards.stats(),presentationTick:renderTick,creatures:combat.creatureStats(),bottle:bottleFx.stats(),trajectory:trajectoryGuide.object.visible,guideTiming:{...guideTiming},rangedEffects:combat.rangedEffectStats(),terrainRay:terrainRay.stats(),terrainSampler:terrainSampler.stats(),mountains:mountainArena.stats(),alpineForest:alpineForest.stats(),collection:pickupHighlight.stats(),landmarks:startingWorld.stats(),enemyShadows:enemyShadows.stats(),meteorCreatures:meteorCreatures.records.size,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,world:content.stats(),heroes:heroView.stats(),forge:forge.stats(),inventions:inventionVisual.stats(),fire:fireVisual.stats(),effects:spellVisual.stats(),impacts:impacts.stats(),expedition:expedition.stats(),expeditionPanel:(({shown,redraws})=>({shown,redraws}))(adventurePanel.state()),orchard:orchard.stats(),ents:entView.stats(),meadow:meadow.stats(),oreGlint:oreGlint.stats(),skyline:skyline.stats(),audio:{contextState:audioContext?.state??null,sampleRate:audioContext?.sampleRate??null,wood:woodAudio?.stats()??null,material:materialAudio?.stats()??null}};},
    clearControls: clearInput,
    // Lobby pushes adventureView() while XR is presenting; null hides. Pointer hand: 'right' (default) or 'left'.
    setExpedition(view, next, id) { if (!disposed) adventurePanel.update(view, next, id); },
    setExpeditionPointerHand(hand) { adventurePanel.setPointerHand(hand); },
    controlsSnapshot() {return {pointerRecovery:{resumeCapture,deliberateRelease,wasCaptured},inventionPlacement,manned:manned?{...manned}:null,yaw,pitch,orbitYaw,orbitTilt,orbitRadius,pan:pan.toArray(),swingAt,weapon:{tool,aiming,ads:adsAmount,fov:camera.fov,zeroDistance:30,...weapons.state()},castStart:castStart?.toArray()||null,castPoint:cursor.visible?hitPoint.toArray():null};},
    async canVR() { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)); },
    async enterVR() {
      if (disposed) throw new Error('Renderer has been disposed.');
      if (!navigator.xr) throw new Error('WebXR requires a supported headset browser and HTTPS.');
      if (renderer.xr.isPresenting) return;
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
      try { await renderer.xr.setSession(session); } catch (error) { await session.end(); throw error; }
    },
    setActive(value) {
      if (disposed) return;
      if(active===!!value)return;
      clearInput(); active = !!value;if(!active)cancelInventionPlacement();
      if (!active && document.pointerLockElement === canvas) document.exitPointerLock();
    },
    dispose() {
      if (disposed) return;
      clearInput(); active = false; disposed = true;heldReadiness?.dispose();pickupHighlight.dispose();mountainArena.dispose();alpineForest.dispose();
      clearTimeout(zeroInputTimer);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      renderer.setAnimationLoop(null); resizeObserver.disconnect(); removers.forEach(remove => remove());
      renderer.xr.getSession()?.end().catch(() => {});
      mixers.forEach(mixer => mixer.stopAllAction()); settlementVisual.dispose();inventionVisual.dispose();heroView.dispose();
      heldResourceArt.dispose();rewards.dispose();cleaveView.dispose();siegebirdSight?.dispose();bottleFx.dispose();rangedReticle.dispose();trajectoryGuide.dispose();document.body.classList.remove('ranged-aim-active');startingWorld.dispose();meteorCreatures.dispose();enemyShadows.dispose();feedback.dispose();adventurePanel.dispose();expedition.dispose();combat.dispose();entView.dispose();spellVisual.dispose();impacts.dispose();golemFx.dispose();fireVisual.dispose();stopFireAudio();woodAudio?.dispose();woodAudio=null;spellAudio?.dispose();spellAudio=null;materialAudio?.dispose();materialAudio=null;orchard.dispose();meadow.dispose();oreGlint.dispose();skyline.dispose();
      disposeResources(scene);
      for (const template of templates.values()) disposeResources(template.scene);
      content.dispose();environment.dispose();audioContext?.close();
      renderer.dispose(); actors.clear(); warnings.clear(); templates.clear(); controllerSources.clear();
    },
  };
  return api;
}
