import {warmRender} from './warm-render.js';
import {batchRigidWeapon} from './rigid-weapon-batch.js';
import {createRenderBudget,renderSize} from './render-budget.js';
import {yieldToBrowser,afterPaint,createAssetQueue,prepareAssetTextures} from './startup-work.js';
import {createAssetDelivery} from './asset-delivery.js';
import {PACKED_ASSETS} from './asset-delivery-manifest.js';
import {SECONDARY_ASSETS,STREAMED_WEAPONS,DECORATION_ASSETS,WORLD_TEMPLATE_ASSETS} from './asset-catalog.js';
import {compileWorld} from './compile-world.js';
import './atmosphere-materials.js'; // installs the shared mist/wet/snow material layer before anything compiles
import {mergeCreatureSkins} from './merge-creature-skins.js';
import {dressForgeling,dressForgelingModel,prepareForgelingTemplate} from './forgeling-look.js';
import {createAbilityWarmup} from './ability-warmup.js';
import {createTerrainGeometryUpdater} from './terrain-geometry.js';
import {validateInventionPlacement,STRUCTURES as INVENTION_TYPES} from '../shared/inventions.js';
import {createBlueprintHud} from './build-blueprint-hud.js';
import {createSiegebirdSight,SIEGEBIRD_PRESENTATION} from './siegebird-sight.js';
import {createSiegebirdAim} from './siegebird-aim.js';
import {createInventionView} from './invention-view.js';
import {createInventionModel} from './invention-art.js';
import {resolveInventions,inventionFloor,MANNED,operatorSeat,timberlineAmmo,STRUCTURES,structureMaterial} from '../shared/inventions.js';
import {HOME_MANNED,homeBallistaSeat,homeBallistaYaw,isHomeBallistaId,keepStyle} from '../shared/home-ballista.js';
import {createKeepBallistaAudio} from './keep-ballista-audio.js';
import {HOME as HOME_RULES,HOME_LAYOUT,bellPostAt,homePoint} from '../shared/home-bases.js';
import {SHOP,counterAt} from '../shared/home-shop.js';
import {MILL,millAt} from '../shared/home-mill.js';
import {STORES,backTownSpot} from '../shared/home-workshop.js';
import {TAVERN,taverns,tavernBar} from '../shared/taverns.js';
import {itemBonus} from '../shared/hero-items.js';
import {createPresentationClock} from './presentation-clock.js';
import {createMountainArena} from './mountain-arena.js';
import {applyMountainGroundTreatment} from './mountain-ground-treatment.js';
import {createPickupHighlight} from './pickup-highlight.js';
import {nearestCollectible} from '../shared/collection-target.js';
import {waistPouchPosition,POUCH_RULES,capsuleDistance,isFelled,cutLocalHeight} from '../shared/trees.js';
import {terrainHeight as sharedTerrainHeight,moveOnTerrain,terrainFrameKey,terrainDirtyEdits,foundationTerrainKey,terrainRenderVertex,hasActiveTerrain} from '../shared/terrain.js';
import {createStartingWorld} from './starting-world.js';
import {installHeartstoneKit} from './heartstone-art.js';
import {createWaygateView} from './waygate-view.js';
import {createGeodeView} from './geode-view.js';
import {createBeaconView} from './beacon-view.js';
import {resolveStartingWorld} from '../shared/starting-world.js';
import {resolveDeposits} from '../shared/colliders.js';
import {createEnemyShadowBudget} from './enemy-shadow-budget.js';
import {createMeteorCreaturePresentation} from './meteor-creature.js';
import {SPELLS,settleCastPoint} from '../shared/spells.js';
import {createSettlementView} from './settlement-view.js';
import {createWeaponReadinessCache} from './weapon-readiness.js';
import {weaponReadiness} from './ability-readiness.js';
import {enhanceWyrmspoutTemplate} from './wyrmspout-look.js';
import {enhancePickTemplate} from './pick-luminance.js';
import {enhanceKingsfellTemplate} from './kingsfell-luminance.js';
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
import {createTimberlineSight} from './timberline-sight.js';
import {createColliderDebug} from './collider-debug.js';
import {createTimberlineAmmoHud,TIMBERLINE_SCOPE} from './timberline-scope.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {specialPose, SPECIAL_MOTION} from './weapon-special-motion.js';
import {createPickWallMotion} from './pick-wall-motion.js';
import {createEmberwingMotion} from './emberwing-motion.js';
import {createWeaponController} from './weapon-controller.js';
import {createContactFeedback, otherHand} from './contact-feedback.js';
import {createCombatView,partAnchor} from './combat-view.js';
import {createWyrmspoutStream} from './wyrmspout-stream.js';
import {createWeaponInspect,measureWeapon,INSPECT_BASE} from './weapon-inspect.js';
import {createWyrmspoutFeel} from './wyrmspout-feel.js';
import {WYRMSPOUT,sprayTuning,tankFill} from '../shared/wyrmspout.js';
import {createEntView} from './ent-view.js';
import {createStumplingView} from './stumpling-view.js';
import {ENT_SPELLS, entTargets} from '../shared/ents.js';
import {GROWTH, growthPlan, waveLine} from '../shared/grove-growth.js';
const GROWTH_SPELLS=['grove','ring','wave'];
import {createSpellPresentation} from './spell-presentation.js';
import {createSkeletonFx} from './skeleton-fx.js';
import {createWallPreview} from './crystal-wall-preview.js';
import {earthLineEdits} from '../shared/earth-spells.js';
import {acousticPosition} from './voice-audio.js';
import {createVoiceIndicators} from './voice-indicators.js';
import {setVoiceZoneResolver} from './voice-zones.js';
// Tavern rules arrive with the keep-buildings work; an empty glob keeps this build working before then.
const tavernRules = Object.values(import.meta.glob('../shared/taverns.js', {eager: true}))[0] || {};
import {createCrystalWallAudio} from './crystal-wall-audio.js';
import {createGolemPresentation} from './golem-presentation.js';
import {createImpactPresentation} from './impact-presentation.js';
import {createRewardMoments} from './reward-moments.js';
import {swingPose, SWING_PROFILES, idleOffset} from './weapon-motion.js';
import {createStrikeClock,createViewPunch,createImpactLedger,createSwingTrail,strikeMaterial,strikeReaction,STRIKE_REACTIONS,STRIKE_ENERGY,STEEL_TOOLS,SHOT_PUNCH,TRAIL} from './strike-feel.js';
import {createHeldSway} from './held-sway.js';
import {createWeaponSwap} from './weapon-swap.js';
import {createAppleSnack} from './apple-snack.js';
import {createDragonRide} from './dragon-ride.js';
import {createWorldContent,createResourceArt,HELD_SCALE} from './world-content-view.js';
import {updateEnemyMotion, noteEnemyHit} from './enemy-motion.js';
import {noteEnemySnapshot, presentEnemyRoot} from './enemy-interp.js';
import {dressSkeleton} from './skeleton-look.js';
import {createForgeView} from './forge-view.js';
import {createFirePresentation,createEmberdewModel} from './fire-presentation.js';
import {forgeFloor,resolveForge} from '../shared/forge-collision.js';
import {terrainHeight as simulationHeight,createSimulation} from '../shared/simulation.js';
import {createRoomEnvironment} from './room-environment.js';
import {createVRAdventurePanel} from './vr-adventure-panel.js';
import {aimIndex, triggerRole, moveIndexes, buttonActions, createPressRouter} from './vr-input-policy.js';
import {createExpeditionPresentation} from './expedition-presentation.js';
import {prepareAsset, setWeaponGrip, FPS_WEAPON_POSE, weaponForward, weaponTip as modelTip, updateWeaponPresentation} from './asset-pose.js';
import {createOrchardPresentation} from './orchard-presentation.js';
import {createLarimarCoveView} from './larimar-cove-view.js';
import {createDayNightWeather} from './day-night-weather.js';
import {SUNNY, gradeScene} from './palette-preview.js';
import {createMeadowCover} from './meadow-cover.js';
import {createOreGlint} from './ore-glint.js';
import {ORE_RECIPES} from '../shared/material-catalog.js';
import {createAlpineSkyline} from './alpine-skyline.js';
import {createAlpineForest} from './alpine-forest.js';
import {createKeepCornerGround} from './keep-corner-ground.js';
import {createHeroView} from './hero-view.js';
import {createWoodAudio} from './wood-audio.js';
import {createSpellAudio} from './spell-audio.js';
import {createMaterialAudio} from './material-audio.js';
import {createLandmarkAudio} from './landmark-audio.js';
import {createSiegebirdFlock, SIEGEBIRD_PLUMAGES} from './siegebird-flock.js';
import {createSiegebirdAudio} from './siegebird-audio.js';
import {siegebirdMechanism, siegebirdCues, SIEGEBIRD_RELOAD} from './siegebird-reload.js';
import {createSiegebirdWind, SIEGEBIRD_WIND} from './siegebird-wind.js';
import {specialCooldown} from '../shared/special-cooldowns.js';
import {createTalentFx,playTalentSound} from './talent-fx.js';
import {createEmberdewFx,playEmberdewSound} from './emberdew-fx.js';
import {createEmberdewHand} from './emberdew-hand.js';
import {flaskLaunch,forecastFlask,forecastCinder,createLandingMarkers} from './emberdew-aim.js';
import {worldTrees} from '../shared/world-content.js';
import {createLightningFx} from './lightning-fx.js';
import {createAudioMix} from './audio-mix.js';
import {createStormDarken} from './storm-darken.js';
import {createAmbienceAudio} from './ambience-audio.js';
import {createSoundKit} from './sound-kit.js';
import {cueFor,pickupCue} from './event-sounds.js';
import {onKeepGround} from '../shared/keep-sites.js';
import {createStormreelView} from './stormreel-view.js';
import {createHurtFeedback} from './hurt-feedback.js';
import {heroMaxHp} from '../shared/hero-progress.js';
import {createRadiantStaff, enhanceStaffTemplate} from './radiant-staff.js';
import {createStormreelWeapon} from './stormreel-weapon.js';
import {leash as stormLeash,wornTower,STORMREEL} from '../shared/stormreel.js';

// Rendering and physics sample exactly the same bounded, deformable surface.
// Presentation helpers pass only edits; the baked ground (old settled earthworks) comes from the latest snapshot.
let currentTerrainBake;
export function terrainHeight(x,z,edits=[],tick=Infinity) {return sharedTerrainHeight({edits,tick,terrainBake:currentTerrainBake},x,z,false);}

function* buildGame({ canvas, onAction = () => {}, onCast = () => {}, onInput = () => {}, onStatus = () => {}, onXRChange = () => {}, onMenu = () => {}, isHost = () => true, onSelection = () => {}, onExpeditionAction = () => {}, onAimProbe = null, onVoicePose = null, voiceActivity = null, onNotice = () => {}, construction = [] }) {
  const started = performance.now();
  let disposed = false, active = false, role = 'hero', spell = 'grove', playerId = null;
  let requestedActive=false;
  const startup={construction,ready:false,phase:'assets',readyMs:null,textureCount:0,warmDrawMs:0,error:null,jobs:{}};
  async function prepareStartup(name,run){const at=performance.now();try{return await run();}finally{startup.jobs[name]=performance.now()-at;}}
  // Non-authoritative lobby preview only: never stepped, published or saved.
  // Real room/save snapshots replace it through applySnapshot below.
  let snapshot = createSimulation({room:'PREVIEW',seed:41}).snapshot();
  yield;
  const mobileBudget=!!globalThis.matchMedia?.('(pointer: coarse)').matches;
  let graphicsMode='auto';try{graphicsMode=localStorage.getItem('branns-forge.graphics')||'auto';}catch{}
  const renderBudget=createRenderBudget({mobile:mobileBudget,dpr:globalThis.devicePixelRatio||1,mode:graphicsMode});
  const frameMetrics=createFrameMetrics();
  const terrainSampler=createTerrainSampler(snapshot);
  const heightAt=(x,z,edits=snapshot.edits)=>edits===snapshot.edits?terrainSampler.height(x,z):terrainHeight(x,z,edits,snapshot.tick??Infinity);
  const terrainRay=createTerrainRaycaster({height:(x,z)=>heightAt(x,z)});
  const presentationClock=createPresentationClock(); let renderTick=0, pendingCastPreview=null;
  // Terrain/earth-spell display tick (see liveTerrain).
  // Clamped (never switched) to the snapshot window so a late or early clock can never make the ground jump back.
  const terrainShownTick=()=>{const t=snapshot.tick;if(!Number.isFinite(t))return Infinity;return Math.min(t+18,Math.max(t-12,renderTick));};
  let contactFrame=0,worldMatricesAt=-1,worldTargets=[];
  let terrainPreviousEdits=[],terrainPreviousTick=Infinity;
  let yaw = 0, pitch = 0, jumpPending = false, verticalSpeed = 0, grounded = true;
  let previous = performance.now(), sentAt = -Infinity, snapshotAt = 0, initialized = false, swingAt = -Infinity;
  let terrainSignature = null,terrainFoundationKey = null, rightDrag = false, orbitYaw = 0.2, orbitRadius = 38, orbitTilt = 0.9;
  let zeroInputTimer = null;
  let castStart=null,quickCast=false,quickKey=null,castRevision=0;
  const equipment=['axe','pick','hammer','crossbow','bow','limb','wyrmspout','flask','staff'];
  // Number keys pick from the hotbar; a held bone (limb) comes only from grabbing one (F), so it has no slot.
  const hotbarSlots=equipment.filter(t=>t!=='limb');
  const spellKeys={Digit1:'grove',Digit2:'ring',Digit3:'wave',Digit4:'heal',Digit5:'spring',Digit6:'blessing',KeyQ:'raise',KeyE:'lower',KeyR:'wall',KeyT:'sunder',KeyY:'crystal',KeyU:'quake',Digit7:'skeleton',Digit8:'squad',Digit9:'golem',Digit0:'awaken',Minus:'wildwake',KeyZ:'lightning',KeyX:'frost',KeyC:'starfall',KeyV:'rainfall'}; // one keyboard row per school (Grow, Shape, Summon, Sky)
  let tool = 'axe', swingContact = false, swingReach = 2.5, swingRest = null, swingTarget = null;
  const remoteBatches=new Map();
  const weaponModels = new Map(), weaponTip = new THREE.Vector3(0,.5,-.35);
  let axeModel = null, touchEnabled = false, fixedAim = null;
  const readinessCache=createWeaponReadinessCache();
  let heldReadiness = null, failedReadinessRoot = null;
  const reducedWeaponMotion=!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const touchAxes = {left: {x: 0, y: 0}, right: {x: 0, y: 0}};
  const xrButtons = new Map();
  const aimCamera = new THREE.Matrix4();
  let aimTerrain = null;
  const keys = new Set(), removers = [], actors = new Map(), templates = new Map(), warnings = new Map();
  const heroView = createHeroView({resolveWeapon: remoteWeapon, onWarning: report, siegebird: () => siegebirdFlockReady()}), heroCamera = new THREE.Vector3(); // remote Hero bodies only (opus-player-character)
  const enemyThreats = [], threatPoint = [0, 0, 0]; // Hero positions: skeletons raise their shields when one is close in front
  const mixers = new Set(), localPosition = new THREE.Vector3(0, 0, 8), correction = new THREE.Vector3(), meadowPushers = [];
  const pan = new THREE.Vector3(), move = new THREE.Vector3(), forward = new THREE.Vector3();
  const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster(), hitPoint = new THREE.Vector3();
  const posePosition = new THREE.Vector3(), poseQuaternion = new THREE.Quaternion(), poseScale = new THREE.Vector3();
  const scene = new THREE.Scene();
  const settlementVisual=createSettlementView({scene,heroView});
  // Pooled lightning (Stormspire arcs, Stormreel shots); additive ribbons and sparks, no extra lights.
  const lightning=createLightningFx({scene,quality:globalThis.matchMedia?.('(pointer: coarse)').matches?'low':'high'});
  const inventionVisual=createInventionView({scene,lightning});
  let inventionPlacement=null,placementPointer=null,placementTurn=0,placementPin=null,placementCursor=null,placementHand=null,placementCheck={key:'',result:null},placementRepeat=false;
  // Manned Timberline (desktop first person): yaw/pitch become the wanted aim; the machine follows with weight.
  let manned=null,crankAt=0,crankHeld=false;
  const heldResourceArt=createResourceArt(),heldOreVisual=new THREE.Group();let heldOreKind=null;heldOreVisual.visible=false;scene.add(heldOreVisual);
  scene.background = new THREE.Color(0xabc5c2);
  scene.fog = new THREE.Fog(0xabc5c2, 58, 125);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  // Keep CSS/UI resolution independent from the adaptive 3D drawing buffer.
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true;
  yield;
  startup.environment={};
  const environment=createRoomEnvironment({renderer,scene,size:mobileBudget?128:256,stats:startup.environment,cancelled:()=>disposed});
  scene.environmentIntensity = .55;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 180);
  camera.rotation.order = 'YXZ';
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);
  // Manned Timberline aids: forecast arcs in the world (while sighting along the ladder) and the ammo plate.
  const colliderMode=new URLSearchParams(location.search).get('colliders');
  const colliderDebug=colliderMode!==null?createColliderDebug({scene,terrainHeight:(st,x,z)=>terrainHeight(x,z,st.edits,st.tick??Infinity),legacy:colliderMode==='legacy',structureRadius:type=>STRUCTURES[type]?.radius||1.5}):null;
  const timberlineSight=createTimberlineSight({scene}),timberlineAmmoHud=createTimberlineAmmoHud();
  let scoping=false,scopeAmount=0;const scopeEye=new THREE.Vector3(),sightEye=new THREE.Vector3();
  scene.add(new THREE.HemisphereLight(0xc6e0ed, 0x5e5139, 1.2));
  const sun = new THREE.DirectionalLight(0xffe3ad, 2.2);
  sun.position.set(-22, 38, 15);
  scene.add(sun);
  yield;
  const groundGeometry = new THREE.PlaneGeometry(120, 120, 160, 160);
  groundGeometry.rotateX(-Math.PI / 2);
  const terrainGeometry=createTerrainGeometryUpdater(groundGeometry);
  const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({ color: 0x667b43, roughness: 1, metalness: 0 }));
  scene.add(ground);
  // World-space orchard ground/sky/lighting. It owns the meadow textures (no separate loader) and reads the same
  // authoritative surface as the ground mesh; it never changes heights, collision or raycast targets.
  const orchard = createOrchardPresentation({scene, renderer, ground, sun, camera, height: (x, z) => heightAt(x, z, snapshot.edits),
    baseHeight: (x,z) => heightAt(x,z,[]), quality: globalThis.matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high', edits: snapshot.edits});
  // Living meadow (grass, wildflowers, pollen) over the same authoritative surface; presentation only.
  yield;
  const meadow = createMeadowCover({scene, renderer, height: (x, z) => heightAt(x, z, snapshot.edits), quality: globalThis.matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high'});
  // Mountain-foot ore veins glint so they can be spotted from across the Orchard (shared/ore-veins.js).
  const oreGlint = createOreGlint({scene, renderer, height: (x, z) => heightAt(x, z, snapshot.edits)});
  // Layered distant alpine ranges replace the low orchard silhouette backdrop.
  const skyline = createAlpineSkyline({scene, sky: orchard.objects.sky}); orchard.objects.backdrop.visible = false;
  yield;
  const skyCycle = createDayNightWeather({scene, orchard, renderer, height: (x, z) => heightAt(x, z, snapshot.edits), quality: globalThis.matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high'});
  // Larimar Cove: a little lake beside each back town, home to Shellbright the larimar turtle (presentation only).
  const coveHeroes=[], coveSky=new THREE.Color(), coveSun=new THREE.Vector3();
  const larimarCove = createLarimarCoveView({scene, height: (x, z) => heightAt(x, z, []), sound: (name, position, opts) => soundKit?.play(name, position, listenerPose(), opts)});
  let orchardContentKey = '', stepDistance = 0, stepSound = false;
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
  const weaponAnchor = new THREE.Group(),inspect=createWeaponInspect({reducedMotion:reducedWeaponMotion}),heldSway=createHeldSway({reducedMotion:reducedWeaponMotion}),weaponSwap=createWeaponSwap({reducedMotion:reducedWeaponMotion}),swayMove=new THREE.Vector3();
  weaponAnchor.position.fromArray(FPS_WEAPON_POSE.position);
  weaponAnchor.rotation.fromArray(['bow','crossbow','wyrmspout','flask','stormreel'].includes(tool)?[0,0,tool==='bow'?-.08:0]:FPS_WEAPON_POSE.rotation);
  camera.add(weaponAnchor);
  // Weapon feel (strike-feel.js): contact reactions, the view kick on hits and shots, and the swing's air smear.
  const strikeClock=createStrikeClock({reducedMotion:reducedWeaponMotion}),viewPunch=createViewPunch({reducedMotion:reducedWeaponMotion}),impactLedger=createImpactLedger(),swingTrail=createSwingTrail();camera.add(swingTrail.mesh);
  const axePlaceholder = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.05), new THREE.MeshStandardMaterial({ color: 0x67462e }));
  axePlaceholder.visible=false;weaponAnchor.add(axePlaceholder);
  const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
  const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
  const controllerSources = new Map();
  // Haptics only for local contacts/releases/damage, on the hand that actually holds the weapon (by handedness).
  let weaponHand = null;
  yield;
  const startingWorld=createStartingWorld({THREE,scene,height:(x,z)=>heightAt(x,z,snapshot.edits)});startingWorld.group.visible=false;let startingEdits='';
  const homeSound=createLandmarkAudio({audio:()=>audioContext,listener:()=>listenerPose()});
  const waygateView=createWaygateView({scene,startingWorld,height:(x,z)=>heightAt(x,z,snapshot.edits),audio:()=>audioContext,listener:()=>listenerPose(),report:message=>{if(!disposed)onNotice(message);}});
  const geodeView=createGeodeView({startingWorld,audio:()=>audioContext,listener:()=>listenerPose()});
  const beaconView=createBeaconView({scene,startingWorld,height:(x,z)=>heightAt(x,z,snapshot.edits),night:()=>skyCycle.night(),audio:()=>audioContext,listener:()=>listenerPose(),report:message=>{if(!disposed)onNotice(message);}});
  const feedback = createContactFeedback({sources: () => controllerSources.values(), playerId: () => playerId, tool: () => tool, weaponHand: () => weaponHand, presenting: () => renderer.xr.isPresenting});
  // The axe's edge re-arms: a quiet shing and one light tick (controller rumble in VR, a short buzz on touch devices).
  const axeReadyCue = createAxeReadyCue({audio: () => audioContext, haptic: () => { if (renderer.xr.isPresenting) feedback.pattern?.([{at: 0, amplitude: .3, duration: 22}]); else if (touchEnabled) navigator.vibrate?.(14); }});
  function contactMaterial(id) {
    const enemy = [...(snapshot.enemies || []),...(snapshot.detachedParts||[])].find(e => e.id === id); if (enemy) return enemy.kind === 'golem' ? 'stone' : enemy.kind === 'ent' || enemy.kind === 'stumpling' ? 'wood' : 'bone';
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
    // In build mode the blueprint follows whichever hand last moved its trigger; either grip backs out.
    listen(controllers[i], 'squeezestart', () => {if(active&&inventionPlacement)cancelInventionPlacement();});
    listen(controllers[i], 'squeezeend', () => {if(active&&renderer.xr.isPresenting&&controllerSources.get(i)?.handedness==='right'&&snapshot.looseLogs?.some(l=>l.heldBy===playerId)&&pouchReady())release(false,i);});
    listen(controllers[i], 'selectstart', () => {
      if (active) unlockAudio();
      if (adventurePanel.handleSelectStart(i)) { presses.begin(i, 'panel'); return; }
      if (!active) return;
      if(inventionPlacement){placementHand=i;placeInvention();presses.begin(i,'cast');return;}
      if (role === 'hero') {
        const kind = triggerRole({tool, hand: controllerSources.get(i)?.handedness, sources: controllerSources, holding: holdingLoose()});
        if (presses.begin(i, kind, tool)?.owner === 'primary') weapons.cancel(); // missed selectend: drop, never fire late
        if (kind === 'throw') release(true, i);
        else if (kind === 'special') { if (tool === 'bow') bowSpecial(); else weapons.special(); }
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
  // Footfall surface for the sound kit: cobbles on keep ground, snow or puddles when the weather has settled in, grass otherwise.
  let surfaceAt=0,surface='grass';
  function footSurface(){const now=performance.now();if(now-surfaceAt<600)return surface;surfaceAt=now;const w=skyCycle.stats().weights||{};surface=onKeepGround(localPosition.x,localPosition.z)?'stone':(w.snow||0)>.5?'snow':((w.rain||0)+(w.storm||0))>.5?'wet':'grass';return surface;}
  // Every in-game button gets a soft click (the HUD, talents, build menu, panels). Pointer clicks are user gestures, so
  // this is also a safe place to wake audio.
  listen(globalThis.document||{addEventListener(){},removeEventListener(){}},'click',e=>{const b=e.target?.closest?.('button,[role="button"],.hotbar-slot,summary');if(!b||b.disabled)return;unlockAudio();soundKit?.play(b.matches?.('[aria-expanded="true"],summary')?'open':'click',null,null,{gap:.04});},{capture:true});
  function report(message) { if (!disposed) onStatus(message); }
  yield;
  const content = createWorldContent({scene,templates,instantiate,height:heightAt,camera});
  // Stonewhisper wall: hold Special (Q / right mouse / touch Special / VR trigger) to see the exact footprint, release to raise it.
  const wallPreview=createWallPreview({THREE,scene,height:(x,z)=>heightAt(x,z)});let wallAim=null,wallAudio=null;
  const pickWallMotion=createPickWallMotion({reducedMotion:reducedWeaponMotion});
  const emberwingMotion=createEmberwingMotion({reducedMotion:reducedWeaponMotion});let bowLayer=null,bowLayerShown=false;
  const pickupHighlight=createPickupHighlight({scene});
  applyMountainGroundTreatment(orchard.material);
  yield;
  const mountainArena=createMountainArena({THREE,scene,height:(x,z)=>heightAt(x,z,snapshot.edits)});
  const alpineForest=createAlpineForest({scene,arena:mountainArena,quality:globalThis.matchMedia?.('(pointer: coarse)').matches?'low':'high'});
  const cornerGround=createKeepCornerGround({scene,ground,height:(x,z)=>heightAt(x,z,snapshot.edits)}); // the keeps' back towns past the old map edge
  let nearestPickup=null;
  const enemyGround=(x,z)=>heightAt(x,z,snapshot.edits);
  const enemyShadows=createEnemyShadowBudget({range:18});
  const meteorCreatures=createMeteorCreaturePresentation({THREE,quality:matchMedia('(any-pointer:coarse)').matches?'low':'high'});
  const combat=createCombatView({scene,templates,actors,camera,beforeContacts:()=>{for(const e of actors.values())if(e.enemy)meteorCreatures.apply(e,renderTick);},height:(x,z)=>heightAt(x,z,snapshot.edits),worldContact,playerPosition:id=>id===playerId&&initialized?localPosition.toArray():null,localSide:()=>snapshot.players?.find(p=>p.id===playerId)?.side||'party', night:()=>skyCycle.night?.()??0, quality:globalThis.matchMedia?.('(pointer: coarse)').matches?'low':'high', onBoneLand:landing=>soundKit?.play('bone_clack',landing.position,listenerPose(),{weight:landing.weight,key:`clack:${landing.id}`,gap:.12}), onContact:hit=>{if(isHost())onAction('projectileHit',hit);}});
  // Apple on a stick (client/apple-snack.js, shared/fruit.js): shot apples fall on their shaft; take one, then bite.
  const appleSnack=createAppleSnack({scene,camera,templates,height:(x,z)=>heightAt(x,z,snapshot.edits),audio:()=>audioContext,listener:()=>listenerPose(),reducedMotion:reducedWeaponMotion,send:(action,detail)=>onAction(action,detail),
    haptic:kind=>{if(renderer.xr.isPresenting)feedback.pattern?.(kind==='bite'?[{at:0,amplitude:.55,duration:28},{at:55,amplitude:.3,duration:18}]:[{at:0,amplitude:.25,duration:20}]);else if(touchEnabled)try{navigator.vibrate?.(kind==='bite'?[16,34,10]:[10]);}catch{}}});
  appleSnack.attachTrees(content.trees);
  // Dragon kill streak: every dragon in the sky, its fire, and the rider's seat, aim and attack buttons.
  const dragonRide=createDragonRide({scene,ray:terrainRay,height:(x,z)=>heightAt(x,z),send:detail=>{unlockAudio();onAction('dragon',detail);},report,audio:()=>audioContext,listener:()=>listenerPose(),touch:()=>touchEnabled,xr:()=>renderer.xr.isPresenting});
  let dragonBlend=null,dragonLastEye=null,dragonFrame={seat:null,yawDrift:0,enter:false,shake:0}; // smooth camera hand-over between the body and the saddle (presentation only)
  const dragonEyeAt=new THREE.Vector3(),dragonBodyEye=new THREE.Vector3();
  // Places the camera while on the dragon, and for the glide up to the saddle and back down to the body. False otherwise.
  function dragonEye(dt){
    if(renderer.xr.isPresenting||role!=='hero'){dragonBlend=null;dragonLastEye=null;return false;}
    const seat=dragonFrame.seat,body=dragonBodyEye.set(localPosition.x,localPosition.y+1.65,localPosition.z);
    if(!!seat!==(dragonBlend?.to==='seat')||seat&&dragonLastEye&&dragonBlend.mode!==dragonFrame.mode){if(!seat&&!dragonLastEye){dragonBlend=null;return false;}dragonBlend={to:seat?'seat':'body',mode:dragonFrame.mode,t:0,from:(dragonLastEye||body).clone()};} // also glides between the chase camera and the saddle
    if(!dragonBlend)return false;
    dragonBlend.t=Math.min(1,dragonBlend.t+dt/(seat?.9:.7));
    dragonEyeAt.copy(dragonBlend.from).lerp(seat||body,THREE.MathUtils.smootherstep(dragonBlend.t,0,1));
    if(!seat&&dragonBlend.t>=1){dragonBlend=null;dragonLastEye=null;return false;}
    rig.position.copy(dragonEyeAt);camera.position.set(0,0,0);
    const k=dragonFrame.shake,t=performance.now();camera.rotation.set(pitch+k*.035*Math.sin(t*.061),yaw+k*.025*Math.sin(t*.047),0,'YXZ');
    (dragonLastEye??=new THREE.Vector3()).copy(dragonEyeAt);
    return true;
  }
  const rightGrip=()=>{const i=[...controllerSources.entries()].find(([,s])=>s.handedness==='right')?.[0];return i===undefined?null:grips[i];};
  // Ents: awakened trees. Sound goes through the wood kit plus a low root rumble; touch and VR feel big ones nearby.
  const entView=createEntView({scene,templates,height:enemyGround,quality:globalThis.matchMedia?.('(pointer: coarse)').matches?'low':'high',
    onSound:event=>{woodAudio?.play(event,listenerPose());if(event.kind==='ent_slam'||event.kind==='ent_fall')rootRumble(event);},
    onRumble:({position,strength})=>{const at=role==='god'?pan:localPosition,d=Math.hypot(position[0]-at.x,position[2]-at.z);if(d>16)return;const k=strength*(1-d/16);
      if(renderer.xr.isPresenting)feedback.pattern?.([{at:0,amplitude:.35+.5*k,duration:70},{at:120,amplitude:.25+.4*k,duration:110}]);
      else if(touchEnabled&&k>.15)try{navigator.vibrate?.([Math.round(20+50*k),40,Math.round(15+35*k)]);}catch{}}});
  // Stumplings: stumps that got up on their roots. The wood kit voices them; a tiny synth gives them a squeak.
  const stumplingView=createStumplingView({scene,templates,height:enemyGround,quality:globalThis.matchMedia?.('(pointer: coarse)').matches?'low':'high',
    onSound:event=>{if(event.kind==='stump_chirp'||event.kind==='stump_squeak')stumpChirp(event);else woodAudio?.play(event,listenerPose());},
    stumpOf:treeId=>{const cut=(snapshot.harvestedTrees||[]).find(h=>h.id===treeId),tree=cut&&worldTrees(snapshot).find(t=>t.id===treeId);return tree?{height:cutLocalHeight(tree,cut,heightAt(tree.x,tree.z,snapshot.edits))}:null;}});
  yield;
  const expedition=createExpeditionPresentation({scene,height:(x,z)=>heightAt(x,z,snapshot.edits)});
  const wyrmStream=createWyrmspoutStream({scene,height:(x,z)=>heightAt(x,z,snapshot.edits)});
  // Wyrmspout rumble: controller pulses in VR, short buzzes on phones (phone may be null for a pulse phones skip).
  const wyrmFeel=createWyrmspoutFeel({audio:()=>audioContext,haptic:(steps,phone)=>{if(role!=='hero')return;if(renderer.xr.isPresenting)feedback.pattern?.(steps);else if(touchEnabled&&phone)try{navigator.vibrate?.(phone);}catch{}}});
  const fireVisual=createFirePresentation({scene,terrainGrid:true,drawPackets:false,fireSamples:id=>combat.fireSamples(id),height:(x,z)=>heightAt(x,z,snapshot.edits)});
  const flaskModel=createEmberdewModel();templates.set('flask',{scene:createEmberdewModel(),animations:[]});weaponModels.set('flask',flaskModel);
  const bottleFx=attachEmberdew({root:flaskModel}),bottlePosition=new THREE.Vector3(),bottleRotation=new THREE.Quaternion();
  // Emberdew: right click held lights the rag and draws a thin landing arc; Q (hold) previews Cinder Cluster's
  // arc and where each of its little bottles will land; release lobs the jug.
  const emberdewHand=createEmberdewHand({reducedMotion:!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches});
  const emberdewFx=createEmberdewFx({scene,height:(x,z)=>heightAt(x,z,snapshot.edits),reducedMotion:!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches});
  const flaskGuide=createTrajectoryGuide({maxPoints:128,width:8,coreWidth:2.2,color:0xffe9c4,tail:0xffb35a,halo:0xff6a1e,haloTail:0xb8341a,markerRadius:.42,sparkPx:16});scene.add(flaskGuide.object);
  const cinderMarkers=createLandingMarkers({radius:1});scene.add(cinderMarkers.object);
  const flaskForecast={count:0,landed:0,ticks:0};let cinderAim=false,wickSentAt=-Infinity,lastFlaskThrow=-Infinity,nextFlaskScan=0,flaskHitTick=null;const flaskVelocity=[0,0,0],flaskInherited=[0,0,0],cinderLandings=new Float32Array(18);
  // Stormreel: the authority resolves every shot; these draw the cable, the pack, the bolts and the charge locally.
  const stormKick=new THREE.Vector3(),stormMuzzle=new THREE.Vector3(),stormCam=new THREE.Vector3();
  // Probes and the foes on a live arc follow the drawn body: look each part's node up once per visual, not every frame.
  function stormPartNode(a,part){if(!a?.visual)return null;if(a.stormParts?.visual!==a.visual)a.stormParts={visual:a.visual,nodes:{}};return a.stormParts.nodes[part]||(a.stormParts.nodes[part]=partAnchor(a.visual,part));}
  const keepAudio=createKeepBallistaAudio({audio:()=>audioContext,listener:()=>listenerPose()});
  const stormView=createStormreelView({scene,lightning,height:(x,z)=>heightAt(x,z,snapshot.edits),localId:()=>playerId,
    actorPose:id=>{const e=actors.get(`p:${id}`);return e?{position:e.root.position,yaw:e.data.yaw||0}:null;},
    localPose:()=>({position:localPosition,yaw}),
    probeAnchor:(id,part,out)=>{const n=stormPartNode(actors.get(`e:${id}`),part||'torso');return n?n.getWorldPosition(out):null;},
    localMuzzle:out=>{if(tool!=='stormreel'||!axeModel?.visible)return null;const m=axeModel.getObjectByName('Muzzle');return m?m.getWorldPosition(out):null;},
    remoteCrossbow:id=>actors.get(`p:${id}`)?.root.getObjectByName('RemoteWeapon:stormreel')||null,
    remoteMuzzle:(id,out)=>{const m=actors.get(`p:${id}`)?.root.getObjectByName('RemoteWeapon:stormreel')?.getObjectByName('Muzzle');return m?m.getWorldPosition(out):null;},
    bodyPoints:(id,out)=>{const a=actors.get(`e:${id}`);if(!a?.visual)return 0;let n=0;for(const part of ['torso','head','leftArm','rightArm','leftLeg','rightLeg']){const node=stormPartNode(a,part);if(node&&n<out.length)node.getWorldPosition(out[n++]);}return n;},
    listener:()=>listenerPose(),spireEntry:id=>inventionVisual.spireEntry(id),spireArt:inventionVisual.spires,audio:()=>audioContext,
    enemyVisual:id=>actors.get(`e:${id}`)?.visual||null,
    shake:(k,at)=>{const d=at?Math.hypot(at.x-localPosition.x,at.z-localPosition.z):0;stormJolt.shake=Math.max(stormJolt.shake,k*Math.max(0,1-d/28));},
    flash:(k,at)=>{const d=at?Math.hypot(at.x-localPosition.x,at.z-localPosition.z):0;stormJolt.flash=Math.max(stormJolt.flash,k*Math.max(0,1-d/90)*(reducedWeaponMotion?.4:1));},
    // A closed circuit is so bright the world around it goes dark (Mitch, 2026-10-10): the exposure dips while the lightning, drawn untonemapped, stays white-hot.
    darken:(k,at)=>stormDarken.hit(k,at,localPosition)});
  const stormDarken=createStormDarken({camera,renderer,reduced:reducedWeaponMotion});
  // Camera jolt for a surge nearby and the tug when the cable runs out (presentation only, decays every frame).
  const stormJolt={shake:0,flash:0,tug:0,nextTug:0,el:null};
  // Getting hurt (client/hurt-feedback.js): edge bloom toward the blow, HP chip, view nudge, buzz, thump; low-health heartbeat.
  const hurtEye=new THREE.Vector3(),hurtLook=new THREE.Vector3();
  const hurtView={position:new THREE.Vector3(),yaw:0},hurtDir=new THREE.Vector3();
  const hurtFeel=createHurtFeedback({camera,view:()=>{camera.getWorldPosition(hurtView.position);camera.getWorldDirection(hurtDir);hurtView.yaw=Math.atan2(-hurtDir.x,-hurtDir.z);return hurtView;},presenting:()=>renderer.xr.isPresenting,touch:()=>touchEnabled,reducedMotion:reducedWeaponMotion,audio:()=>audioContext,
    haptic:(steps,hand)=>feedback.pattern?.(steps,hand),self:()=>role==='hero'?snapshot.players?.find(p=>p.id===playerId)||null:null,maxHp:p=>p?.maxHp||heroMaxHp(p||{})});
  function stormTug(){const t=performance.now()/1000;if(t<stormJolt.nextTug)return;stormJolt.nextTug=t+.65;stormJolt.tug=1;stormView.tug(playerId);stormWeapon.tug?.();
    if(renderer.xr.isPresenting)feedback.pattern?.([{at:0,amplitude:.8,duration:60}]);else if(touchEnabled)try{navigator.vibrate?.([35]);}catch{}
    report(`The cable is at full stretch. Spike the crossbow (${touchEnabled?'Spike':'G'}) or walk back toward the tower.`);}
  function stormJoltStep(dt){const j=stormJolt,t=performance.now();
    if(!renderer.xr.isPresenting&&(j.shake>.001||j.tug>.001)){camera.rotation.x+=j.shake*.03*Math.sin(t*.083)-j.tug*j.tug*.05;camera.rotation.y+=j.shake*.022*Math.sin(t*.067+1)+j.tug*.012*Math.sin(t*.05);}
    j.shake=Math.max(0,j.shake-dt*2.6);j.tug=Math.max(0,j.tug-dt*3.2);j.flash=Math.max(0,j.flash-dt*3.5);
    if(j.flash>.001&&!j.el&&globalThis.document){j.el=document.createElement('div');j.el.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:5;background:radial-gradient(circle,rgba(220,235,255,.9),rgba(140,180,255,.35));opacity:0';document.body.appendChild(j.el);}
    if(j.el)j.el.style.opacity=String(Math.min(.85,j.flash));
    stormDarken.update(dt);}
  // Sunthread, the Radiant staff (radiant-staff.js): one shared warm light that is always in the scene (off unless the
  // staff is out), terrain-following light pools, the sun-thread beam that latches onto foes near your aim, and the nova.
  const STAFF_POSE={position:[.44,-.52,-.7],rotation:[-.2,.1,.24]};let staffBeamK=0;
  const staffFx=createRadiantStaff({scene,realLight:!mobileBudget,height:(x,z)=>heightAt(x,z),night:()=>skyCycle.stats().night||0,audio:()=>audioContext,reducedMotion:reducedWeaponMotion,
    ground:(o,d,max)=>{const hit=terrainRay.segment(o.toArray(),o.clone().addScaledVector(d,max).toArray());return hit?.point?new THREE.Vector3().fromArray(hit.point):null;},
    *targets(){for(const entry of actors.values()){if(!entry.enemy||entry.data?.side==='party'||!(entry.data?.hp>0)||!entry.root.visible)continue;yield {id:entry.data.id,position:entry.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,entry.data.kind==='golem'?1.6:1.05,0))};}}});

  const stormWeapon=createStormreelWeapon({scene,lightning,send:(action,payload)=>{unlockAudio();if(action==='storm'&&!renderer.xr.isPresenting)viewPunch.kick(SHOT_PUNCH.stormreel,.6+.4*(payload?.charge??1));onAction(action,payload);},aim:()=>weaponAim(),snapshot:()=>snapshot,playerId:()=>playerId,
    height:(x,z)=>heightAt(x,z,snapshot.edits),localPosition:()=>localPosition,audio:()=>audioContext,now:()=>performance.now()/1000,hud:globalThis.document?.body,severKey:()=>touchEnabled?'Special':'Q',sfx:stormView.sfx});
  // R beside the tower while wearing its pack drops in another Crystal (taking or hanging the pack does this too).
  function feedStormspire(){const me=selfPlayer(),b=wornTower(snapshot,me);if(!b)return;if(Math.hypot(b.position[0]-localPosition.x,b.position[2]-localPosition.z)>STORMREEL.takeReach+1.45){report('Walk back to the Stormspire to feed it Crystal.');return;}unlockAudio();onAction('inventionUse',{structureId:b.id,feed:true});}
  // Q / Special: reel your bolt back in along its tether (shared/stormreel.js stormReel); it also breaks a live circuit.
  function reelStorm(){const b=wornTower(snapshot,selfPlayer());if(!b?.probes){report('No bolt out to reel in. Hold and release to fire one.');return;}unlockAudio();onAction('stormReel',{});}
  function stormFeel(event){
    if(event.kind==='storm_pack_take'&&event.by===playerId)report(`${event.pack==='blue'?'Blue (−)':'Red (+)'} Stormreel. ${touchEnabled?'Hold Zap':'Hold click'} to charge. A red and a blue bolt in one foe strikes it down. ${touchEnabled?'Spike':'G'} plants it, ${touchEnabled?'Reel':'Q'} winds a bolt back.`);
    if(event.kind==='storm_plant'&&event.by===playerId)report(`Crossbow spiked into the ground. Its bolt stays live. ${touchEnabled?'Use':'E'} beside it to pick it back up.`);
    if(event.kind==='storm_pickup'&&event.by===playerId)report(`${event.pack==='blue'?'Blue (−)':'Red (+)'} crossbow back in hand.`);
    if(event.kind==='storm_arc'&&event.by===playerId)report(event.killed===false?'Circuit closed, but something shielded your target.':'Circuit closed! The arc burned your target down.');
    if(event.kind==='storm_arc')audioMix?.duck(.3,1.8);
    if(event.kind==='storm_reel'&&event.by===playerId){if(renderer.xr.isPresenting)feedback.pattern?.([{at:0,amplitude:.35,duration:30},{at:70,amplitude:.7,duration:50}]);else if(touchEnabled)try{navigator.vibrate?.([14,24,30]);}catch{}}
    if(event.kind==='storm_reel'&&event.by===playerId&&event.refund)report(`Bolt reeled in${event.refund?`, ${event.refund} charge returned to the tower`:''}.`);
    if(event.kind==='storm_arc'&&event.by===playerId&&touchEnabled&&!renderer.xr.isPresenting)try{navigator.vibrate?.([30,20,30,20,60]);}catch{}
    if(event.kind==='storm_bolt'&&event.by===playerId){const strong=!!(event.probe||event.fell);
      if(renderer.xr.isPresenting)feedback.pattern?.(strong?[{at:0,amplitude:1,duration:70},{at:90,amplitude:.5,duration:120}]:[{at:0,amplitude:.5,duration:40}]);
      else if(touchEnabled)try{navigator.vibrate?.(strong?[40,30,70]:[20]);}catch{}}
  }
  const rangedReticle=createRangedReticle(),trajectoryGuide=createTrajectoryGuide();scene.add(trajectoryGuide.object);let nextGuideAt=0,guideHitTick=null;const GUIDE_NO_HIT=[-1,-1],guideTiming={lastMs:0,maxMs:0,updates:0};
  const skeletonFx=createSkeletonFx({scene,height:(x,z)=>heightAt(x,z,snapshot.edits),audio:()=>audioContext});const goldenFlight=[];
  yield;
  const spellVisual=createSpellPresentation({scene,terrainGrid:true,tickSeconds:1/60,getTerrainTick:()=>{const t=terrainShownTick();return Number.isFinite(t)?t:snapshot.tick??0;},height:(x,z)=>heightAt(x,z,snapshot.edits),quality:globalThis.matchMedia?.('(pointer: coarse)').matches?'medium':'high',reducedMotion:!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches});
  const cleaveView=createAxeCleaveView({scene,height:(x,z)=>heightAt(x,z,snapshot.edits),reducedMotion:!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches});
  // Level-ups and weapon-talent effects (client/talent-fx.js): the column rides the hero's presented position.
  const talentFx=createTalentFx({scene,height:(x,z)=>heightAt(x,z,snapshot.edits),reducedMotion:!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    heroPosition:id=>id===playerId?(initialized&&role==='hero'?localPosition:null):actors.get(`p:${id}`)?.visual?.position||null,viewerInside:id=>id===playerId&&role==='hero'});
  let specialSwing=null, waistPouch=null;
  function selfPlayer(){return snapshot.players.find(p=>p.id===playerId);}
  // Ground point under the weapon aim (camera, or the VR controller holding the pick); open sky aims at full reach.
  function wallAimPoint(){const aim=weaponAim(),o=aim.origin,d=aim.direction,hit=terrainRay.segment(o,[o[0]+d[0]*14,o[1]+d[1]*14,o[2]+d[2]*14]);
    if(hit)return [...hit.point];const p=selfPlayer()?.position||o,h=Math.hypot(d[0],d[2])||1;return [p[0]+d[0]/h*20,p[1],p[2]+d[2]/h*20];}
  function beginWallAim(){if(!active||role!=='hero'||inventionPlacement||tool!=='pick')return;unlockAudio();wallAim??={since:performance.now()};pickWallMotion.hold(performance.now()/1000);}
  function cancelWallAim(){if(wallAim)pickWallMotion.cancel(performance.now()/1000);wallAim=null;wallPreview.hide();}
  // Release casts toward the aimed point (a tap casts too). The host re-plans from its own state; the preview used the same plan.
  function releaseWallAim(){if(!active||role!=='hero'||tool!=='pick'){cancelWallAim();return;}const point=wallAimPoint(),ok=updateWallPreview()?.ready!==false&&wallPreview.state?.inside!==false;
    // The pick slams as the cast goes out; a cast that cannot happen (recharging / outside the valley) just lowers it.
    if(ok&&pickWallMotion.release(performance.now()/1000)){wallAim=null;wallPreview.hide();}else cancelWallAim();onAction('special',{point});}
  function specialPress(down){if(manned){if(!down)special();return;}if(tool==='pick'){if(down)beginWallAim();else releaseWallAim();return;}if(!down)special();}
  function updateWallPreview(){
    if(!wallAim||tool!=='pick'||!active||role!=='hero'){if(wallAim)cancelWallAim();return;}
    const p=selfPlayer();if(!p){wallPreview.hide();return;}
    // Anchor on the locally predicted body and facing (moved every frame) rather than the last snapshot, so strafing
    // slides the footprint smoothly instead of stepping at the network rate; the aim point already follows the camera.
    const at=initialized?localPosition.toArray():p.position;
    return wallPreview.show({position:at,yaw:initialized?yaw:p.yaw,point:wallAimPoint(),ready:(snapshot.tick||0)-(p.specialTick??-1000)>=240});
  }
  // Gout (Wyrmspout Q): lobbed from the mouth along the aim; the ball is drawn at once and the host's burst replaces it.
  let goutSeq=0;
  function sendGout(){const p=snapshot.players.find(p=>p.id===playerId);if(!p||(p.overheatUntil||0)>(snapshot.tick||0)||(snapshot.tick||0)-(p.specialTick??-1000)<specialCooldown('wyrmspout',p))return;
    const aim=projectileAim();unlockAudio();wyrmStream.launchLocalGout(`local-gout:${++goutSeq}`,aim.origin,aim.direction);wyrmFeel.gout();if(!renderer.xr.isPresenting)viewPunch.kick(SHOT_PUNCH.gout);onAction('special',{origin:aim.origin,direction:aim.direction});}
  // Cinder Cluster (Emberdew Q): a big jug lobbed high along the aim; the host pops it at the top and rains little bottles.
  function sendCinder(){const p=selfPlayer();if(!p)return;if((snapshot.tick||0)-(p.specialTick??-1000)<specialCooldown('flask',p)){onAction('special',{});return;} // the host explains the recharge
    const aim=projectileAim();unlockAudio();emberdewHand.thrown(performance.now()/1000,'cinder');playEmberdewSound(audioContext,{kind:'cinder_throw'},.8);onAction('special',{origin:aim.origin,direction:aim.direction});}
  // Touch and VR have no right click to aim, so their bottle is always lit, always hurled, and shows its arc while held.
  function flaskAimed(){return aiming||touchEnabled||renderer.xr.isPresenting;}
  // The landing arc re-integrates the host's flight from the live bottle and aim every frame; the prop/creature query
  // over the whole flight runs at ~15 Hz and frames in between only re-query around the last contact (like Emberwing's).
  function updateFlaskGuide(now){
    const show=tool==='flask'&&active&&role==='hero'&&initialized&&!!axeModel&&flaskModel.visible&&(aiming||cinderAim||touchEnabled||renderer.xr.isPresenting);
    if(!show){flaskGuide.hide();cinderMarkers.hide();nextFlaskScan=0;flaskHitTick=null;return;}
    const aim=projectileAim(),me=selfPlayer(),pace=5*swiftFactor(snapshot,me||{});
    flaskInherited[0]=move.x*pace;flaskInherited[1]=grounded?0:verticalSpeed;flaskInherited[2]=move.z*pace;
    const full=now>=nextFlaskScan;if(full)nextFlaskScan=now+66;
    flaskLaunch(cinderAim?'cinder':flaskAimed()?'hurl':'toss',aim.direction,flaskInherited,flaskVelocity);
    const query={origin:aim.origin,velocity:flaskVelocity,out:flaskGuide.buffer,hit:worldContact,hitWindow:full?null:flaskHitTick===null?GUIDE_NO_HIT:[Math.max(0,flaskHitTick-12),flaskHitTick+12],terrainHeight:(x,z)=>heightAt(x,z,snapshot.edits)};
    const r=cinderAim?forecastCinder({...query,landings:cinderLandings}):forecastFlask(query);
    if(full||r.hitTick!==null)flaskHitTick=r.hitTick;
    flaskGuide.setPoints(flaskGuide.buffer,r.count,r.apex?{point:r.apex,normal:[0,1,0]}:r.contact); // Cinder: the ring marks where the jug pops
    flaskForecast.count=r.count;flaskForecast.landed=r.landed??0;flaskForecast.ticks=r.ticks;if(cinderAim)cinderMarkers.set(cinderLandings,r.landed,now/1000);else cinderMarkers.hide();
  }
  function releaseCinderAim(send=true){if(!cinderAim)return;cinderAim=false;if(send&&active&&role==='hero'&&tool==='flask')sendCinder();}
  function sendSpecial(){if(tool==='wyrmspout'){sendGout();return;}if(tool==='flask'){sendCinder();return;}const aim=weaponAim();const point=new THREE.Vector3(...aim.origin).addScaledVector(new THREE.Vector3(...aim.direction),3);point.y=heightAt(point.x,point.z,snapshot.edits);onAction('special',{point:point.toArray()});}
  function requestSpecial(){if(!active||specialSwing||weaponSwap.busy)return;if(tool==='pick'){beginWallAim();return;}if(tool==='axe'&&!renderer.xr.isPresenting){const p=snapshot.players.find(p=>p.id===playerId);if((snapshot.tick||0)-(p?.specialTick??-1000)<specialCooldown('axe',p))return;specialSwing={at:performance.now(),sent:false,rest:{position:weaponAnchor.position.clone(),quaternion:weaponAnchor.quaternion.clone()}};swingContact=true;swingAt=-Infinity;strikeClock.cancel();}else sendSpecial();}
  const weapons=createWeaponController({getTool:()=>tool,getAim:projectileAim,getDraw:()=>{if(!renderer.xr.isPresenting)return null;let left,right;for(const [i,source] of controllerSources){if(source.handedness==='left')left=grips[i];if(source.handedness==='right')right=grips[i];}return left&&right?THREE.MathUtils.clamp((left.getWorldPosition(new THREE.Vector3()).distanceTo(right.getWorldPosition(new THREE.Vector3()))-.08)/.65,0,1):null;},fire:details=>{unlockAudio();if(!renderer.xr.isPresenting)viewPunch.kick(SHOT_PUNCH[tool],tool==='bow'?.5+.5*(details.draw??1):1);const golden=tool==='crossbow'&&!!siegebirdFlock?.loadedGolden(axeModel);feedback.release(tool,{golden});onAction('fire',details);if(tool==='crossbow')siegebirdFired(golden);},emitFlame:details=>{unlockAudio();wyrmFeel.spent(sprayTuning(snapshot.players.find(p=>p.id===playerId)).cost);onAction('flame',details);},pourFuel:details=>{if(performance.now()-lastFlaskThrow<1000)return;lastFlaskThrow=performance.now();if(!renderer.xr.isPresenting)viewPunch.kick(SHOT_PUNCH.flask);unlockAudio();const aimed=flaskAimed();onAction('pour',{...details,aimed});emberdewHand.thrown(performance.now()/1000,aimed?'hurl':'toss');playEmberdewSound(audioContext,{kind:'cinder_throw'},aimed?.6:.35);},reload:{time:()=>siegebirdWind.time(),press:()=>siegebirdWindVerdict(siegebirdWind.press())},canFlame:()=>{const p=snapshot.players.find(p=>p.id===playerId);return !!p&&(p.overheatUntil||0)<=(snapshot.tick||0)&&p.hp>0&&wyrmFeel.fill()>.001;},flameInterval:()=>sprayTuning(snapshot.players.find(p=>p.id===playerId)).intervalMs,special:requestSpecial});
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
  let canvasWidth=1,canvasHeight=1;
  function resizeBuffer() {
    const size=renderSize(canvasWidth,canvasHeight,renderBudget.ratio());
    if(canvas.width!==size.width||canvas.height!==size.height){renderer.setSize(size.width,size.height,false);startup.resizes=(startup.resizes||0)+1;}
  }
  function resize() {
    if (disposed || renderer.xr.isPresenting) return;
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    canvasWidth=width;canvasHeight=height;resizeBuffer();
    if(camera.aspect===width/height)return;
    renderBudget.reset();
    camera.aspect = width / height;
    weaponAnchor.position.x = 0.33 * Math.min(1, camera.aspect / 0.9);
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  // Terrain is drawn at the presentation clock, not the snapshot tick: rising walls, tearing chasms and sinking
  // segments move every frame (snapshots arrive at 10-20 Hz). The clock stays within a snapshot interval of the
  // authority, so collision still matches what is seen.
  let terrainLive=false;const meadowPending=new Map();
  // Grass refills are whole-buffer uploads, so live frames batch their dirty kernels and the meadow catches up on
  // each snapshot (grass on moving earth is cleared by the disturbance mask anyway).
  function flushMeadow(){if(!meadowPending.size)return;meadow.terrainChanged({edits:snapshot.edits,terrainTick:terrainPreviousTick,dirty:[...meadowPending.values()]});meadowPending.clear();}
  function liveTerrain() {
    const tick=terrainShownTick(),active=hasActiveTerrain(snapshot.edits,tick);
    if(!active&&!terrainLive)return;terrainLive=active;
    terrainSampler.setState({...snapshot,tick});rebuildGround(tick,true);
  }
  function rebuildGround(tick=terrainShownTick(),live=false) {
    const foundations=live?terrainFoundationKey:foundationTerrainKey(snapshot),foundationChanged=foundations!==terrainFoundationKey;
    const signature = terrainFrameKey(snapshot.edits,tick)+'|'+foundations;
    if (signature === terrainSignature) {if(!live)flushMeadow();return;}
    const terrainStarted=performance.now();
    const dirty=terrainSignature&&!foundationChanged?terrainDirtyEdits(terrainPreviousEdits,snapshot.edits,terrainPreviousTick,tick):null;
    terrainPreviousEdits=snapshot.edits;terrainPreviousTick=tick;
    terrainSignature = signature;terrainFoundationKey=foundations;
    fireVisual.invalidateTerrain();terrainRay.invalidateTerrain();worldMatricesAt=-1;
    terrainGeometry.update((x,z)=>terrainRenderVertex(snapshot,x,z,false,heightAt(x,z,snapshot.edits)),dirty);
    frameMetrics.record('terrainCpu',performance.now()-terrainStarted);
    if(live){orchard.terrainTick?.(tick);content.terrainMoved(dirty);for(const e of dirty||[])meadowPending.set(e.id,e);return;}
    const meadowDirty=dirty&&dirty.concat([...meadowPending.values()]);meadowPending.clear();mountainArena.sync(snapshot);alpineForest.sync();cornerGround.sync();
    meadow.terrainChanged({edits: snapshot.edits, terrainTick: tick, dirty: foundationChanged ? null : meadowDirty});
    orchard.groundChanged({edits: snapshot.edits,terrainTick:tick,foundationChanged}); // edit-only rebake of the disturbed-earth channel; slope soil/stone follows the new normals
  }
  // Stone/canopy channels follow the world's tree set (seed + groves) and live deposits. A full mask bake measured
  // 0.3-0.75 s in headless SwiftShader; ecosystem changes now rebuild in bounded frame slices, never per chop.
  function syncOrchardContent() {
    const trees = worldTrees(snapshot), deposits = Array.isArray(snapshot.deposits) ? snapshot.deposits : null;
    const key = snapshot.seed + ':' + (snapshot.groves || []).map(g => g.trees ? `${g.id}:${g.trees.filter(t => (t[4] ?? 0) <= snapshot.tick).length}` : g.id).join() + '|' + (snapshot.awakenedTrees || []).join() + '|' + (snapshot.wildTrees || []).map(t => t.id).join() + '|' + JSON.stringify(snapshot.treeRoots || []) + '|' + (deposits || []).map(d => d.id + (d.depleted ? '-' : '')).join();
    if (key === orchardContentKey) return; orchardContentKey = key;
    orchard.groundChanged(deposits ? {trees, deposits} : {trees});
  }
  // Invisible load-time sockets: authored models replace these as soon as ready.
  function basicActor() {
    const group=new THREE.Group(),head=new THREE.Object3D(),hands=[new THREE.Object3D(),new THREE.Object3D()];
    group.add(head,...hands);group.userData={head,hands,placeholder:true};return group;
  }
  function instantiate(name, height, skeletonId) {
    const template = templates.get(name);
    if (!template) return null;
    const {visual: wrapper, model} = prepareAsset(template, name, height);
    // Skeletons and golems are posed procedurally (enemy-motion.js, skeleton-motion.js): no AnimationMixer.
    if (name === 'skeleton') dressSkeleton(wrapper, skeletonId ?? 0); // archetype gear, colours and size from the enemy id
    return wrapper;
  }
  const WEAPON_HEIGHTS = {axe:.7,pick:.75,hammer:.95,crossbow:.48,bow:1.25,wyrmspout:.4,stormreel:.5,staff:1.6};
  // Remote Hero equipment: a canonical clone of an already-loaded template (shared geometry/materials); hero-view poses it
  // in the WeaponGrip socket with the local XR contract. null while loading; hero-view retries and never disposes templates.
  function remoteWeapon(name) {
    if (!templates.has(name)||STREAMED_WEAPONS.has(name)&&!weaponModels.has(name)){if(STREAMED_WEAPONS.has(name))assetQueue.prioritize(name);return null;}
    let visual;
    if(['axe','pick','hammer'].includes(name)){
      let batch=remoteBatches.get(name);if(!batch){batch=batchRigidWeapon(templates.get(name));remoteBatches.set(name,batch);}
      visual=prepareAsset(batch.gltf,name,WEAPON_HEIGHTS[name]).visual;
    }else visual=instantiate(name, WEAPON_HEIGHTS[name]);
    if (visual && name === 'flask') { const m = visual.children[0].children[0]; m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1); } // template root is the live local flask
    return visual;
  }
  function upgradeActor(entry) {
    if (!entry.enemy || !entry.visual.userData.placeholder) return;
    const forgeling = entry.data.side === 'party' && entry.data.battleRun !== undefined && entry.data.kind === 'skeleton' && templates.has('forgeling'); // Dawnhold's own troops
    const model = entry.data.kind==='ent'?entView.build(entry.data):entry.data.kind==='stumpling'?stumplingView.build(entry.data):forgeling?instantiate('forgeling',1.81,entry.data.id):instantiate(entry.data.kind==='golem'?'golem':'skeleton',entry.data.kind==='golem'?2.8:1.7,entry.data.id);
    if (!model) return;
    entry.root.remove(entry.visual);
    disposePlaceholder(entry.visual);
    entry.visual = model;
    entry.root.add(model);
    if (forgeling) dressForgelingModel(model, entry.data.id);
    else if (entry.data.side === 'party' && entry.data.battleRun !== undefined && ['skeleton', 'golem'].includes(entry.data.kind)) dressForgeling(model, entry.data.kind);
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
  // Taverns are voice rooms: insideTavern(state, position) returns the tavern ({id, label}) or null.
  const voiceBadges = createVoiceIndicators({scene});
  setVoiceZoneResolver('home-taverns', position => tavernRules.insideTavern?.(snapshot, position) || null);
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
      if (enemy) noteEnemySnapshot(entry, data, snapshot.tick); // interpolated per frame (enemy-interp.js), never stepped per packet
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
      if(entry.enemy){entView.release(entry,snapshot);stumplingView.release(entry,snapshot);} // felled/rooted ents and stumplings keep a short corpse; the actor frees an empty stand-in
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
  const loader = new GLTFLoader(),assetInstalls=[],secondaryInstalls=[],assetPromises=new Map();
  let equipRequest=0;
  async function prepareStreamed(root){
    await compileWorld(renderer,root,camera,{}, {batchSize:16,yieldTask:afterPaint,compile:(stage,eye)=>skyCycle.compileAsset(stage,eye,scene)});
    await prepareAssetTextures(root,{renderer,yieldTask:afterPaint,cancelled:()=>disposed});
  }
  const assetQueue=createAssetQueue({concurrency:mobileBudget?2:4});
  // Decorative ground cover, the optional launcher and VR pouch
  // must not hold the playable world hostage to their download/decoding time.
  const loadAsset=createAssetDelivery(loader,{packed:PACKED_ASSETS,onFallback:()=>{startup.deliveryFallbacks=(startup.deliveryFallbacks||0)+1;}});
  // Include async installation, not only downloads: clones add material variants.
  loader.load=(url,install,progress,failed)=>{
    const name=url.split('/').pop().replace('.glb',''),essential=!SECONDARY_ASSETS.has(name);
    const pending=assetQueue.add(()=>disposed?Promise.resolve():new Promise(resolve=>loadAsset(url,async gltf=>{
      try{
        if(disposed){disposeResources(gltf.scene);return;}
        const held=['axe','pick','hammer','crossbow','bow','wyrmspout','stormreel','staff'].includes(name);
        startup.textureCount+=await prepareAssetTextures(gltf.scene,{renderer,maxSize:mobileBudget?(held?2048:1024):Infinity,upload:false,stats:startup,cancelled:()=>disposed});
        if(disposed){disposeResources(gltf.scene);return;}
        await install(gltf);
      }catch(error){startup.error=String(error.message||error);report(`Asset preparation: ${startup.error}`);}finally{resolve();}
    },progress,error=>{startup.error=`Asset unavailable: ${url}`;try{failed?.(error);}finally{resolve();}})),essential,name);
    assetPromises.set(name,pending);(essential?assetInstalls:secondaryInstalls).push(pending);return pending;
  };
  for(const name of ['timberline_ballista','timberline_bolts'])loader.load(`/assets/${name}.glb`,async gltf=>{
    if(disposed){disposeResources(gltf.scene);return;}
    try{if(startup.ready)await renderer.compileAsync(gltf.scene,camera,scene);}catch(error){report(`Timberline material preparation failed: ${error.message}`);}
    if(disposed){disposeResources(gltf.scene);return;}
    inventionVisual.installTimberline(name,gltf);
  },undefined,()=>report(`Could not load ${name}; reload to restore Timberline visuals.`));

  loader.load('/assets/heavy_launcher.glb',async gltf=>{ // Blender-built spring catapult; the code-built launcher stands in until then
    if(disposed){disposeResources(gltf.scene);return;}
    try{await renderer.compileAsync(gltf.scene,camera,scene);}catch(error){report(`Heavy Launcher material preparation failed: ${error.message}`);}
    if(disposed){disposeResources(gltf.scene);return;}
    inventionVisual.installLauncher(gltf);
  },undefined,()=>report('Could not load the Heavy Launcher model; the simple stand-in stays.'));
  // Stormspire tower and its cable-reel pack (assets-source/stormreel); the code-built tower stands in until then.
  loader.load('/assets/stormspire.glb',gltf=>{if(disposed){disposeResources(gltf.scene);return;}inventionVisual.installStormspire(gltf);},undefined,()=>report('Could not load the Stormspire model; the simple stand-in stays.'));
  loader.load('/assets/reel_pack.glb',gltf=>{if(disposed){disposeResources(gltf.scene);return;}inventionVisual.installReelPack(gltf);stormView.installPack(gltf);},undefined,()=>report('Could not load the Stormreel pack model.'));
  loader.load('/assets/bases_kit.glb',gltf=>{ // Blender-built Dawnhold and Grumblekeep; the code-built bases stand in until then
    if(disposed){disposeResources(gltf.scene);return;}
    if(!inventionVisual.installHomeKit(gltf)){disposeResources(gltf.scene);report('Home base models are incomplete; the simpler bases stay in place.');}
  },undefined,()=>report('Home base models unavailable; the simpler bases stay in place.'));
  loader.load('/assets/town_kit.glb',gltf=>{ // Blender-built taverns, Quartermaster stalls and Gold mills; code-built stand-ins until then
    if(disposed){disposeResources(gltf.scene);return;}
    if(!inventionVisual.installTownKit(gltf)){disposeResources(gltf.scene);report('Town models are incomplete; the simpler taverns, stalls and mills stay.');}
  },undefined,()=>report('Town models unavailable; the simpler taverns, stalls and mills stay.'));
  loader.load('/assets/backtown_kit.glb',gltf=>{ // Blender-built back towns behind the keeps (assets/backtown-20261008)
    if(disposed){disposeResources(gltf.scene);return;}
    if(!inventionVisual.installBackTownKit(gltf)){disposeResources(gltf.scene);report('Back town models are incomplete; the simpler buildings stay.');}
  },undefined,()=>report('Back town models unavailable; the simpler buildings stay.'));
  loader.load('/assets/keep_ballistas.glb',gltf=>{ // the Sunlance and Gnashjaw gate ballistas (assets-source/keep-ballistas)
    if(disposed){disposeResources(gltf.scene);return;}
    if(!inventionVisual.installKeepKit(gltf)){disposeResources(gltf.scene);report('Gate ballista models are incomplete; the older ballistas stay in place.');}
  },undefined,()=>report('Gate ballista models unavailable; the older ballistas stay in place.'));
  loader.load('/assets/landmarks_kit.glb',gltf=>{ // Blender-built landmarks and Heartstone shells; the code-built ones stand in until then
    if(disposed){disposeResources(gltf.scene);return;}
    if(!startingWorld.installKit(gltf)){disposeResources(gltf.scene);report('Landmark models are incomplete; the simpler versions stay in place.');return;}
    installHeartstoneKit(gltf);
    gltf.scene.traverse(o=>o.geometry?.dispose()); // the world keeps copies of the geometry and the materials themselves
  },undefined,()=>report('Landmark models unavailable; the simpler versions stay in place.'));
  loader.load('/assets/waist_pouch.glb',gltf=>{if(disposed){disposeResources(gltf.scene);return;}waistPouch=gltf.scene;waistPouch.visible=false;rig.add(waistPouch);},undefined,()=>report('Pouch visual unavailable; collection remains available.'));
  loader.load('/assets/hero.glb', async gltf => {
    if (disposed) { disposeResources(gltf.scene); return; }
    orchard.enableShadowCasting(gltf.scene);
    try { if(startup.ready)await renderer.compileAsync(gltf.scene, camera, scene); }
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
  for (const name of WORLD_TEMPLATE_ASSETS) loader.load(`/assets/${name}.glb`, async gltf => {
    if (disposed) { disposeResources(gltf.scene); return; }
    if (name === 'forgeling') prepareForgelingTemplate(gltf.scene);
    if (name === 'skeleton' || name === 'forgeling') mergeCreatureSkins(gltf);
    if (name === 'skeleton' || name === 'golem' || name === 'forgeling') orchard.enableShadowCasting(gltf.scene); // bounded casters: actors + forge only, never ground props
    if (name === 'golem') gltf.scene.traverse(n => { for (const m of [n.material].flat()) if (m && /^crystal/i.test(m.name)) m.emissive.setRGB(.3, .62, 1); }); // resonance blue; also the assembly binding colour
    if (name === 'pick') enhancePickTemplate(gltf.scene); // shared gem/metal look before any clone renders
    if (name === 'axe') enhanceKingsfellTemplate(gltf.scene); // shared heart/vein/edge light before any clone renders
    if (name === 'wyrmspout') enhanceWyrmspoutTemplate(gltf.scene); // scales, hammered brass, glass and the sloshing liquid
    if (name === 'staff') enhanceStaffTemplate(gltf.scene); // breathing glows and the pearl enamel, shared by every copy
    templates.set(name, gltf);
    if(name==='golem'||name==='meteor')meteorCreatures.setAssets({[name]:gltf});
    // Meteor materials otherwise compile for the first time during impact.
    // Prepare the loaded asset against the real lighting without adding it to the world.
    if (name === 'meteor') renderer.compileAsync(gltf.scene, camera, scene).catch(error => {
      if (!disposed) report(`Meteor shader preparation: ${error.message}`);
    });
    if (name === 'tree'&&startup.ready) { syncTrees(); }
    if (name === 'skeleton'||name==='golem'||name==='forgeling'||name.startsWith('tree')) for (const entry of actors.values()) upgradeActor(entry);
    if(name==='stormreel')stormView.installCrossbow(gltf);
    if (['axe','pick','hammer','crossbow','bow','wyrmspout','stormreel','staff'].includes(name)) {
      const model = instantiate(name, WEAPON_HEIGHTS[name]);
      const readinessAt=performance.now();readinessCache.prepare({root:model,tool:name,reducedMotion:reducedWeaponMotion});
      (startup.weaponPreparation??={})[name]={readinessMs:performance.now()-readinessAt};
      if(startup.ready||startup.phase!=='assets'){updateWeaponPresentation(model,name,{draw:0,recoil:0,time:0,templates});await prepareStreamed(model);if(disposed)return;}
      weaponModels.set(name,model);
      if (name === tool) equipVisual(tool);
    } else if (DECORATION_ASSETS.includes(name)&&startup.ready) await content.installDecoration(name,prepareStreamed);
    else if (name !== 'siegebird_songbird'&&startup.ready) content.reload();
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
  function isLineSpell(){return spell==='sunder'||spell==='wall'||spell==='wave';}
  // Growth spells preview the exact sites the authority will plant (same pure plan on the same world).
  let growthCache={key:'',snapshot:null,trees:[]};
  function growthPreview(point,start,end){const key=`${spell}|${point}|${start}|${end}`;if(growthCache.key!==key||growthCache.snapshot!==snapshot)growthCache={key,snapshot,trees:growthPlan(snapshot,spell,point,{start,end})};return growthCache.trees;}
  // Casting never refuses a placement. Point spells settle where authority will put them;
  // a drawn line longer than 18 m is shortened and a tiny one becomes the default line.
  function settledPoint(id,x,z){const [sx,,sz]=settleCastPoint(id,[x,0,z],{expedition:expeditionRunning(snapshot.adventure)});return [sx,heightAt(sx,sz,snapshot.edits),sz];}
  // A Growth Wave tap grows a full band across the view, sent as an explicit line so the authority plants the same band.
  function waveTap(point){const player=snapshot.players.find(p=>p.id===playerId),dx=point[0]-(player?.position[0]??0),dz=point[2]-(player?.position[2]??0),d=Math.hypot(dx,dz),ux=d>.001?dx/d:-Math.sin(player?.yaw??0),uz=d>.001?dz/d:-Math.cos(player?.yaw??0),h=GROWTH.wave.tapLength/2,c=v=>THREE.MathUtils.clamp(v,-55,55);return [[c(point[0]-uz*h),point[1],c(point[2]+ux*h)],[c(point[0]+uz*h),point[1],c(point[2]-ux*h)]];}
  function fitLine(start,end){const dx=end[0]-start[0],dz=end[2]-start[2],d=Math.hypot(dx,dz);return d<=18?end:[start[0]+dx/d*17.99,end[1],start[2]+dz/d*17.99];}
  function targetPreview(){
    if(!active||role!=='god'||!cursor.visible)return null;
    const player=snapshot.players.find(p=>p.id===playerId),hit=hitPoint.toArray();
    let point=isLineSpell()?hit:settledPoint(spell,hit[0],hit[2]),start,end,fallback=false,lineCount=earthLineEdits();
    if(isLineSpell()){
      if(castStart&&Math.hypot(castStart.x-hit[0],castStart.z-hit[2])>=.5){start=castStart.toArray();end=point=fitLine(start,hit);lineCount=earthLineEdits(start,end);}
      else {const dx=point[0]-(player?.position[0]??0),dz=point[2]-(player?.position[2]??0),d=Math.hypot(dx,dz),ux=d>.001?dx/d:-Math.sin(player?.yaw??0),uz=d>.001?dz/d:-Math.cos(player?.yaw??0),clamp=v=>THREE.MathUtils.clamp(v,-55,55);
        start=[clamp(point[0]-uz*3),point[1],clamp(point[2]+ux*3)];end=[clamp(point[0]+uz*3),point[1],clamp(point[2]-ux*3)];fallback=true;}
    }
    let trees;if(ENT_SPELLS.includes(spell)){trees=entPreviewTrees(point);if(spell==='awaken'&&trees[0])point=[trees[0].x,heightAt(trees[0].x,trees[0].z,snapshot.edits),trees[0].z];}
    if(GROWTH_SPELLS.includes(spell)){const drawn=spell==='wave'?(fallback||Math.hypot(end[0]-start[0],end[2]-start[2])<GROWTH.wave.minLength?waveTap(point):[start,end]):[];if(spell==='wave'){[start,end]=waveLine(point,drawn[0],drawn[1]);fallback=false;}trees=growthPreview(point,drawn[0],drawn[1]);}
    return {spell,point,start,end,fallback,trees,valid:(fallback||(Math.abs(start?.[0]??0)<=55&&Math.abs(start?.[2]??0)<=55))&&!spellUnavailable(snapshot,player,spell,{point,lineCount,trees})};
  }
  function cancelCast() { castStart = null; quickKey = null; castRevision++; }
  function castAt(point,finish=false) {
    if (!active || role !== 'god' || inventionPlacement) return;
    const x = THREE.MathUtils.clamp(point.x, -55, 55), z = THREE.MathUtils.clamp(point.z, -55, 55);
    let at=isLineSpell()?[x,heightAt(x,z,snapshot.edits),z]:settledPoint(spell,x,z);
    if(isLineSpell()&&!castStart&&!finish){castStart=new THREE.Vector3(...at);report('Choose the end of the line, then release / Cast again.');return;}
    let extra={};
    if(spell==='wave'){const drag=castStart&&Math.hypot(castStart.x-at[0],castStart.z-at[2])>=GROWTH.wave.minLength;if(drag)at=fitLine(castStart.toArray(),at);const [a,b]=drag?[castStart.toArray(),at]:waveTap(at);extra={start:a,end:b};}
    else if(castStart&&Math.hypot(castStart.x-at[0],castStart.z-at[2])>=.5){at=fitLine(castStart.toArray(),at);extra={start:castStart.toArray(),end:at};}
    pendingCastPreview={spell,point:at};onCast(spell,at,extra);castStart=null;quickKey=null;
  }
  function lookBy(dx, dy) {
    if (!active || renderer.xr.isPresenting) return;
    if (role === 'hero' && touchEnabled && inspect.mode() && inspect.spin(dx * 2.2, dy * 2.2, {touch: true})) return;   // while inspecting, a drag turns the weapon
    if (role === 'hero') { const k = manned ? THREE.MathUtils.lerp(1, TIMBERLINE_SCOPE.sensitivity, scopeAmount) : 1; yaw -= dx * k; pitch = THREE.MathUtils.clamp(pitch - dy * k, -1.48, 1.48); }
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
  let audioContext=null,audioMix=null,ambience=null,soundKit=null;let lastSound=0;let woodAudio=null;let materialAudio=null;let spellAudio=null;
  // Wins (raids, rewards, crafting, building, loot) answer with light, chimes and rumble; presentation only.
  const rewards=createRewardMoments({scene,camera,height:(x,z)=>heightAt(x,z,snapshot.edits),audio:()=>audioContext,sources:()=>controllerSources.values(),presenting:()=>renderer.xr.isPresenting,context:()=>{const p=snapshot.players?.find(p=>p.id===playerId);return {playerId,side:p?.side||'party',position:p?.position};}});
  // Siegebird: one shared songbird flock for every crossbow (local and remote); the local reload's cues drive audio and rumble.
  let siegebirdFlock=null,siegebirdAudio=null;const siegebirdLocal={n:0,prevT:Infinity,relief:{n:0,k:0}};
  function siegebirdFlockReady(){if(!siegebirdFlock&&templates.has('crossbow')&&templates.has('siegebird_songbird')){siegebirdFlock=createSiegebirdFlock({birdTemplate:templates.get('siegebird_songbird'),crossbowTemplate:templates.get('crossbow')});siegebirdFlock.attachWorld({scene,perch:siegebirdPerches,standing:siegebirdTreeStanding,ground:(x,z)=>heightAt(x,z,snapshot.edits)});}return siegebirdFlock;}
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
  // Swapping away mid-reload: the bird turns off with the bolt and drops it (siegebird-flock.js stow). Coming back
  // replays the delivery from the bird's entry, and the shot waits for the bolt to seat. Unchanged without a swap.
  // A bird already in view when you swapped is relieved by a differently coloured one (siegebirdReliefPlumage).
  function stowSiegebird(){
    const reload=siegebirdWind.time(),r=siegebirdLocal.relief;if(reload<SIEGEBIRD_RELOAD.seat)siegebirdLocal.stowed={t:Math.max(0,reload),n:siegebirdLocal.n,relief:(r.n===siegebirdLocal.n?r.k:0)+(reload>=SIEGEBIRD_RELOAD.enter?1:0)};
    siegebirdFlock?.stow(axeModel);
  }
  function resumeSiegebird(){
    const s=siegebirdLocal.stowed;siegebirdLocal.stowed=null;if(!s)return;
    const t0=Math.min(s.t,SIEGEBIRD_RELOAD.enter),sb=snapshot.players.find(p=>p.id===playerId)?.siegebird;
    siegebirdWind.resume(t0);siegebirdLocal.prevT=t0;siegebirdLocal.relief={n:s.n,k:s.relief};
    const flock=siegebirdFlockReady();if(flock&&axeModel)flock.shot(axeModel,{n:s.n,golden:sb&&sb.n===s.n?!!sb.golden:null,playerId,time:performance.now()/1000-t0,relief:s.relief});
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
  // Raise Wall and Sunder: one rolling groan along the line while the front travels (everyone nearby hears it), and the
  // casting God feels it roll away: pulses that swell for the rampart, rough and stuttering for the tearing chasm.
  function earthLineFeel(event){
    const r=event.rupture,ms=r.durationTicks/.06,mid=[(r.start[0]+r.end[0])/2,event.position?.[1]??0,(r.start[1]+r.end[1])/2];
    wallAudio?.line?.({kind:event.spell,position:mid,seconds:r.durationTicks/60},listenerPose());
    if(event.by!==playerId)return;
    const wall=event.spell==='wall',steps=[];
    for(let t=0;t<ms;t+=wall?120:70)steps.push({at:t,amplitude:wall?.3+.4*t/ms:.65-.3*t/ms,duration:wall?50:28});
    steps.push({at:ms+40,amplitude:.8,duration:wall?80:50});
    if(renderer.xr.isPresenting)feedback.pattern?.(steps);
    else if(touchEnabled)try{const v=[];let last=0;for(const s of steps){v.push(Math.max(0,Math.round(s.at-last)),s.duration);last=s.at+s.duration;}v[0]=0;navigator.vibrate?.(v.slice(1));}catch{}
  }
  function unlockAudio(){try{if(!audioContext){const phone=touchEnabled||!!globalThis.matchMedia?.('(pointer: coarse)').matches;audioMix=createAudioMix(new (window.AudioContext||window.webkitAudioContext)(),{phone});audioContext=audioMix.contextFor('sfx');ambience=createAmbienceAudio({context:audioMix.contextFor('ambience'),level:audioMix.level,claim:audioMix.claim,phone});soundKit=createSoundKit({context:audioContext,ui:audioMix.contextFor('ui'),level:audioMix.level,claim:audioMix.claim,duck:audioMix.duck});}if(audioContext.state==='suspended')void audioContext.resume();woodAudio??=createWoodAudio({context:audioContext,baseUrl:'/assets/wood-audio/'});woodAudio.unlock();materialAudio??=createMaterialAudio({context:audioContext});materialAudio.unlock();skyCycle.attachAudio(audioMix.contextFor('ambience'));wallAudio??=createCrystalWallAudio({context:audioContext});spellAudio??=createSpellAudio(audioContext);}catch{}}
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
  // A stumpling's voice: a short rising chirp when it wakes, a squeak when it is hit. Distance-attenuated, no samples.
  let lastChirp=0;
  function stumpChirp(event){
    if(!audioContext||!Array.isArray(event.position))return;const now=audioContext.currentTime;if(now-lastChirp<.08)return;lastChirp=now;
    const ear=listenerPose().position,d=Math.hypot(event.position[0]-ear[0],event.position[2]-ear[2]),level=.05*Math.max(0,1-d/30);if(level<.003)return;
    const wake=event.kind==='stump_chirp',h=[...String(event.id)].reduce((a,c)=>a*31+c.charCodeAt(0)|0,7)>>>0,base=(wake?620:820)*(1+(h%17)/60),dur=wake?.32:event.last?.34:.16;
    const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type='triangle';
    if(wake){osc.frequency.setValueAtTime(base,now);osc.frequency.exponentialRampToValueAtTime(base*1.9,now+.12);osc.frequency.exponentialRampToValueAtTime(base*1.3,now+dur);}
    else{osc.frequency.setValueAtTime(base*1.5,now);osc.frequency.exponentialRampToValueAtTime(base*(event.last?.55:.9),now+dur);}
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(level,now+.02);gain.gain.exponentialRampToValueAtTime(.0001,now+dur);
    osc.connect(gain).connect(audioContext.destination);osc.start(now);osc.stop(now+dur+.05);osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  // Level-up and talent effects: a synthesized cue (full for your own, fading with distance for others) and a buzz on your device.
  function talentFeel(event){
    const mine=event.id===playerId||event.by===playerId,ear=listenerPose().position,near=Math.max(0,1-Math.hypot(event.position[0]-ear[0],event.position[2]-ear[2])/35);
    if(['talent_learned','talent_reset'].includes(event.kind)&&!mine)return;
    playTalentSound(audioContext,event,mine?1:near*.8);
    if(!mine)return;
    const level=event.kind==='level_up';
    if(renderer.xr.isPresenting)feedback.pattern?.(level?[{at:0,amplitude:.6,duration:60},{at:120,amplitude:.8,duration:80},{at:260,amplitude:1,duration:140}]:[{at:0,amplitude:.5,duration:40}]);
    else if(touchEnabled)try{navigator.vibrate?.(level?[40,60,40,60,120]:event.kind==='firebomb'?[50]:[15]);}catch{}
  }
  function stopFireAudio(){if(flameSource){flameSource.stop();flameSource.disconnect();flameGain.disconnect();flameSource=null;flameGain=null;}}
  function handleEvent(event){
    const predictedImpact=event?.by===playerId&&impactLedger.consume(event,performance.now()/1000); // this client already showed and heard it (strikeContact)
    if(event.kind==='hit'&&event.hero&&event.id===playerId&&role==='hero'){camera.getWorldPosition(hurtEye);camera.getWorldDirection(hurtLook);hurtFeel.hurt(event,{position:hurtEye,yaw:Math.atan2(-hurtLook.x,-hurtLook.z)});}
    if(event.kind==='respawn'&&event.id===playerId){clearInput();if(snapshot.battle?.v===2){yaw=Math.atan2(event.position[0],event.position[2]);pitch=0;}localPosition.fromArray(event.position);correction.set(0,0,0);verticalSpeed=0;grounded=true;initialized=true;}
    if(event.kind==='waygate_travel'&&event.id===playerId&&!manned){localPosition.fromArray(event.position);correction.set(0,0,0);verticalSpeed=0;grounded=true;yaw=event.yaw;pitch=0;heldSway.snap();}
    waygateView.handleEvent(event,playerId);geodeView.handleEvent(event);beaconView.handleEvent(event,playerId);dragonRide.event(event,playerId);
    feedback.handleEvent(event);
    if(appleSnack.event(event,playerId))return;
    combat.handleEvent(event.hero&&event.id===playerId?{...event,damage:0}:event); // no number floating in your own face
    wyrmStream.handleEvent(event,{localId:playerId,resolveTarget:(id,part)=>{const a=actors.get(`e:${id}`);return a?.visual?partAnchor(a.visual,part):null;}});wyrmFeel.event(event,playerId,listenerPose());
    golemFx.handleEvent(event);
    entView.event(event);stumplingView.event(event);
    settlementVisual.event(event);inventionVisual.event(event);stormView.event(event);stormFeel(event);
    // Home base hands-on pieces: a deep bell, a bright drink chord, a hammer's chime as a part knits back together.
    if(event.kind==='home_bell'){homeSound.chord(event.position,[-12,-5,0],.16,180,4.5);if(event.id===playerId)report(`The bell rings out: ${event.count} troops march from the barracks.`);}
    if(event.kind==='home_drink'){homeSound.chord(event.position,[7,12,16],.08,60,1.6);if(event.id===playerId)report('A long cool drink. Health restored.');}
    // Keep towns: coins clink, the mill creaks, the bar pours, a draught glugs.
    if(event.kind==='gold_earned'&&event.id===playerId)homeSound.chord(event.position,[19,24],.05,50,.6);
    if(event.kind==='mill_coin'&&event.id===playerId)homeSound.bell(event.position,event.owed>0?19:24,.035,.35);
    if(event.kind==='mill_feed'){homeSound.chord(event.position,[-5,-1,2],.06,90,.9);if(event.id===playerId)report(`Into the hopper it goes: ${event.gold} Gold to grind. Lean on the capstan (hold R) to grind faster.`);}
    if(event.kind==='mill_crank')homeSound.chord(event.position,[-10,-8],.05,120,.8);
    if(event.kind==='shop_buy'){homeSound.chord(event.position,[12,16,19,24],.07,55,1.2);}
    if(event.kind==='shop_sell')homeSound.chord(event.position,[19,16],.05,60,.8);
    if(event.kind==='tavern_ale'){homeSound.chord(event.position,[0,4,7,12],.06,80,1.4);if(event.id===playerId)report('A Hearty Ale! Fully mended, and blows land 20% softer for three minutes.');}
    if(event.kind==='draught_drunk'){homeSound.chord(event.position,[7,11,14],.06,50,1);if(event.id===playerId)report(`Glug. Healing Draught down; ${event.draughts} left. Refill at your keep's well.`);}
    if(event.kind==='home_part_repaired'){homeSound.bell(event.position,event.mended?12:7,.08,1.2);if(event.mended&&event.by===playerId)report(`The ${event.part} is mended.`);}
    if(event.kind.startsWith('keep_ballista_')){keepAudio.event(event,event.by===playerId);keepNotice(event);}
    if(['timberline_fire','launcher_fire','trap_snap','machine_turn','refinery_output','invention_build'].includes(event.kind)){const sound={...event,kind:event.kind==='invention_destroyed'?'ore_break':'hit',material:event.kind==='invention_build'?'wood':'metal',energy:event.kind.endsWith('_fire')?2:1};if(sound.material==='wood')woodAudio?.play(sound,listenerPose());else materialAudio?.play(sound,listenerPose(),snapshot.tick);}

    // A Timberline bolt burying itself: a deep thunk in earth or stone, a thud in a body.
    if(event.kind==='timberline_embed')materialAudio?.play({...event,kind:'embed',material:event.host==='enemy'?'flesh':'stone',energy:1.6},listenerPose(),snapshot.tick);
    expedition.handleEvent(event);
    const rewardSound=!!rewards.handle(event);
    if((event?.kind==='hit'||event?.kind==='headshot')&&event.id!==undefined){const a=actors.get(`e:${event.id}`);if(a)noteEnemyHit(a,event);}
    skeletonFx.handle(event);
    if(event?.by!==undefined&&event.by!==playerId){const a=actors.get(`p:${event.by}`);if(a?.visual.userData.hero)heroView.event(a.visual,event,a.data);} // attributed result -> remote swing/recoil
    let kitSound=false;{const cue=soundKit&&cueFor(event,{me:playerId});if(cue?.name)kitSound=soundKit.play(cue.name,cue.at===undefined?event.position:cue.at,listenerPose(),cue.opts||{})||kitSound;if(event.kind==='spell'&&['quake','starfall'].includes(event.spell)&&(event.spell==='quake'||event.phase==='impact'))audioMix?.duck(.4,1.4);}
    if(!event?.position||event.fire)return;
    const woodSound=!!woodAudio?.handles(event);if(woodSound&&!predictedImpact)woodAudio.play(event,listenerPose());if(event.kind==='ent_wake'||event.kind==='ent_root')rootRumble(event);
    const materialSound=!!materialAudio?.handles(event);if(materialSound&&!predictedImpact)materialAudio.play(event,listenerPose(),snapshot.tick);
    if(event.kind==='spell'){spellVisual.play(event);spellAudio?.play(event,earXZ(),role==='god');if((event.spell==='wall'||event.spell==='sunder')&&event.rupture)earthLineFeel(event);}
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
    if(talentFx.handle(event))talentFeel(event);
    // Emberdew: smashing glass and splashing dew, a whump when lit, a cork pop when Cinder Cluster's jug bursts.
    if(emberdewFx.handle(event)){const ear=listenerPose().position,mine=event.by===playerId;playEmberdewSound(audioContext,event,mine?1:Math.max(0,1-Math.hypot(event.position[0]-ear[0],event.position[2]-ear[2])/30));
      if(mine&&event.kind==='cinder_pop'){if(renderer.xr.isPresenting)feedback.pattern?.([{at:0,amplitude:.45,duration:25}]);else if(touchEnabled)try{navigator.vibrate?.([14]);}catch{}}}
    if(event.kind==='axe_cleave'){cleaveView.play(event,performance.now());const mine=event.id===playerId,ear=listenerPose().position;
      playCleaveSound(audioContext,mine?1:Math.max(0,1-Math.hypot(event.position[0]-ear[0],event.position[2]-ear[2])/30));
      if(mine&&touchEnabled&&!renderer.xr.isPresenting)try{navigator.vibrate?.([45,25,20]);}catch{}}
    const kind=event.kind;if(!['hit','wood_hit','stone_hit','tree_fell','ore_break','pickup','build','death','headshot','shoot','detach','shockwave','embed','hammer_slam','pick_burst','axe_cleave'].includes(kind))return;
    const material=event.material||(kind==='wood_hit'?'wood':kind==='stone_hit'||kind==='ore_break'?'stone':event.id==='shrine'?'metal':'bone');
    const isImpact=['hit','headshot','wood_hit','stone_hit'].includes(kind)||(kind==='embed'&&event.impact);
    if(isImpact&&!predictedImpact){let seed=event.tick??snapshot.tick??0;for(const char of String(event.id||''))seed=(Math.imul(seed,31)+char.charCodeAt(0))|0;impacts.emit({material,position:event.position,normal:event.normal||[0,1,0],energy:event.energy||1,seed});}
    if(kind==='pickup'&&soundKit&&!woodSound&&!rewardSound){const c=pickupCue(event);kitSound=soundKit.play(c.name,event.position,listenerPose(),c.opts);}
    const now=performance.now();if(audioContext&&!kitSound&&!['death','detach','shoot','build','pickup','shockwave'].includes(kind)&&!woodSound&&!materialSound&&!rewardSound&&!(kind==='embed'&&!event.impact)&&!(kind==='shoot'&&event.weapon==='crossbow'&&event.by===playerId)&&now-lastSound>45){lastSound=now;const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type=kind==='stone_hit'?'triangle':'sine';const metallic=material==='stone'||material==='metal';osc.frequency.setValueAtTime(metallic?1500:kind==='hammer_slam'?70:kind==='shoot'?280:kind==='pickup'?660:150,audioContext.currentTime);osc.frequency.exponentialRampToValueAtTime(metallic?650:80,audioContext.currentTime+.13);gain.gain.setValueAtTime(.055,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.18);osc.connect(gain).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+.19);}
  }
  function equipVisual(next) {
    if(next!==tool&&initialized)soundKit?.play('swap',null,null,{metal:['axe','pick','hammer','crossbow','stormreel'].includes(next),gap:.15});
    if(next!==tool)feedback.reset();
    if(tool==='crossbow'&&next!=='crossbow'&&axeModel)stowSiegebird();
    if(next==='limb'){axeModel?.removeFromParent();axeModel=null;tool=next;return;}
    const model=weaponModels.get(next);if(!model)return;
    aiming=false;adsAmount=0;siegebirdSight?.dispose();siegebirdSight=null;siegebirdAim=null;
    axeModel?.removeFromParent();tool=next;axeModel=model;weaponAnchor.remove(axePlaceholder);attachWeapon();
    stormWeapon.setModel(tool==='stormreel'?axeModel:null);
    if(tool==='crossbow'){siegebirdSight=createSiegebirdSight(THREE,axeModel);siegebirdAim=createSiegebirdAim({anchor:weaponAnchor,weapon:axeModel,camera,sight:siegebirdSight});resumeSiegebird();}
  }
  async function equip(next) {if(!active||role!=='hero'||!equipment.includes(next))return;
    const request=++equipRequest;
    if(STREAMED_WEAPONS.has(next)&&!weaponModels.has(next)){
      startup.pendingTool=next;assetQueue.prioritize(next);report(`Preparing ${next}... You can keep moving.`);
      await assetPromises.get(next);
      if(disposed||request!==equipRequest)return;startup.pendingTool=null;
      if(!weaponModels.has(next)){report(`Could not prepare ${next}. Check your connection and reload to retry.`);return;}
      if(!active||role!=='hero')return;
    }else startup.pendingTool=null;
    inspect.cancel();weapons.cancel();cinderAim=false;cancelWallAim();specialSwing=null;presses.invalidate();swingAt=-Infinity;strikeClock.cancel();swingContact=true;onAction('equip',{tool:next});aiming=false;
    // First person: stash the old item, then draw the new one (weapon-swap.js). VR hands and held limbs swap at once.
    if(renderer.xr.isPresenting||!weaponAnchor.visible||next==='limb'||tool==='limb'){const pending=weaponSwap.cancel();if(pending&&pending!==next)equipVisual(pending);equipVisual(next);}else weaponSwap.request(next,tool);}
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
  function resolveHit(h){const t=content.resolveTarget?.(h);if(t?.id)return {targetId:t.id,point:t.point,normal:t.normal||[0,1,0]};const faceTarget=h.object.userData.faceTarget?.(h.faceIndex);if(faceTarget)return {targetId:faceTarget,point:h.point.toArray(),normal:(h.face?.normal.clone().transformDirection(h.object.matrixWorld)||new THREE.Vector3(0,1,0)).toArray()};let n=h.object;while(n&&!n.userData.targetId)n=n.parent;
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
    const resolved=useEarth?null:resolveHit(prop);
    const base=snapshot.battle?.bases?.find(b=>b.hp>0&&b.id===resolved?.targetId)||snapshot.battle?.bases?.flatMap(b=>b.parts||[]).find(q=>q.hp>0&&q.id===resolved?.targetId),targetId=base?base.id:'world';
    // Battle bases have a local contact envelope like creatures; world-space
    // coordinates at the ±40 m bases fail that envelope even for a direct hit.
    const localPoint=base?point.map((v,i)=>v-base.position[i]):point;
    return {targetId,part:'torso',point,normal,localPoint,localQuaternion:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),delta).toArray(),distance:useEarth?earth.distance:prop.distance,...(useEarth?{earth:true}:{})};
  }
  let lastPhysicalTip=null,lastPhysicalHit=-Infinity;
  function tickPhysicalMelee(now,dt){
    if(!renderer.xr.isPresenting||!active||role!=='hero'||!axeModel||!['axe','pick','hammer'].includes(tool)){lastPhysicalTip=null;return;}
    const tip=modelTip(axeModel,tool,new THREE.Vector3());
    if(lastPhysicalTip){const travel=tip.distanceTo(lastPhysicalTip);if(travel>.018&&travel<1&&travel/Math.max(dt,.001)>1.15&&now-lastPhysicalHit>(SWING_PROFILES[tool]?.cooldown||.5)*1000){
      const from=lastPhysicalTip.toArray(),to=tip.toArray(),enemy=combat.segmentContacts(from,to)[0],world=worldContact(from,to);let hit=enemy;
      if(world&&(!enemy||world.distance<enemy.distance)){const ray=new THREE.Raycaster(lastPhysicalTip,tip.clone().sub(lastPhysicalTip).normalize(),0,travel);const h=ray.intersectObjects(content.targets().concat(inventionVisual.targets(),[shrine,startingWorld.group]),true).find(v=>surfaceVisible(v.object));if(h){const r=resolveHit(h);hit=r?{...world,...r}:null;}else hit=null;}
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
    const targets=[...content.collectibleTargets(),...Array.from(combat.embeds.values()).filter(n=>n.visible&&n.userData.collectibleId),...combat.detached.values(),...content.targets(),...inventionVisual.targets(),ground,shrine,startingWorld.group];
    for(const t of targets)t.updateWorldMatrix(true,true);
    const hits=raycaster.intersectObjects(targets,true).filter(h=>surfaceVisible(h.object));raycaster.far=Infinity;
    const first=hits[0];if(!first)return false;
    let id=content.collectibleId(first);if(!id){let n=first.object;while(n&&!n.userData.targetId&&!n.userData.collectibleId)n=n.parent;id=n?.userData.collectibleId||n?.userData.targetId;}
    if(snapshot.inventions?.structures.some(b=>b.id===id))return useInvention(id);
    const collectible=(snapshot.embeds||[]).some(e=>e.id===id&&e.golden&&e.kind==='bolt')||(snapshot.pickups||[]).some(p=>p.id===id)||(snapshot.looseLogs||[]).some(p=>p.id===id&&!p.heldBy)||(snapshot.detachedParts||[]).some(p=>p.id===id&&!p.heldBy);
    if(!collectible||(snapshot.detachedParts||[]).some(p=>p.id===id&&p.kind==='golem'))return false;
    const from=raycaster.ray.origin,to=first.point;
    const enemy=combat.segmentContacts(from.toArray(),to.toArray(),{includePartPoses:false})[0];if(enemy)return false;
    onAction('collectTarget',{targetId:id});return true;
  }
  // Direct touch selects a visible surface, then uses the normal animated tool and collision path.
  function tapAt(x,y){
    if(active&&inventionPlacement&&!renderer.xr.isPresenting){pinPlacement(x,y);return true;}
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
  // Right click zooms Emberwing and engages the phoenix: drawing while zoomed (or zooming while drawn) latches the curve.
  // Weapon Inspect (I, or Inspect in the phone's Actions menu): first person only; VR already puts it in your hand.
  // ?inspectPin=<seconds> freezes every inspect at that moment of the turn (screenshots and art review).
  const inspectPinAt=(()=>{try{const v=new URLSearchParams(location.search).get('inspectPin');return v===null?null:Number(v);}catch{return null;}})();
  let inspectFit=null,inspectFitModel=null,inspectBlocked=null;
  function wyrmIndicators(){const r=weaponReadiness(snapshot.players.find(p=>p.id===playerId),'wyrmspout',snapshot.tick||0);return {charge:r.specialReady,locked:r.overheated};}
  function startInspect(){const st=weapons.state();inspectBlocked=!active?'inactive':role!=='hero'?'role':renderer.xr.isPresenting?'xr':manned?'manned':tool==='limb'?'limb':!weaponAnchor.visible?'hidden':!axeModel?'loading':weaponSwap.busy?'swapping':st.firing?'firing':st.drawing?'drawing':null;if(inspectBlocked)return;unlockAudio();inspect.press();if(Number.isFinite(inspectPinAt))inspect.pin(inspectPinAt);}
  function primaryDown(){if(startup.restoringTool)return;if(active&&role==='hero'&&dragonRide.riding()){dragonRide.press('breath',true);return;}if(!active||role!=='hero'||inventionPlacement||weaponSwap.busy)return;inspect.cancel();unlockAudio();if(manned){mannedPress();return;}if(appleSnack.holding()){appleSnack.bite();return;}if(tool==='stormreel'){stormWeapon.begin();return;}if(tool==='staff'){staffFx.press();return;}if(!weapons.begin()){if(renderer.xr.isPresenting)weapons.special();else strike();}else if(tool==='bow'&&aiming&&!renderer.xr.isPresenting)weapons.special();}
  function special(){if(startup.restoringTool)return;if(active&&role==='hero'&&dragonRide.riding()){dragonRide.press('fireball',true);return;}if(!active||role!=='hero'||inventionPlacement||weaponSwap.busy)return;inspect.cancel();if(manned){scoping=!scoping;return;}if(tool==='stormreel'){reelStorm();return;}if(tool==='staff'){staffFx.nova(performance.now()/1000);return;}if(tool==='flask'&&!touchEnabled&&!renderer.xr.isPresenting){cinderAim=true;return;}if(tool==='crossbow'&&!renderer.xr.isPresenting)aiming=!aiming;else if(tool==='bow')bowSpecial();else weapons.special();}
  // Emberwing's Special: on desktop Q is always Phoenix Flare (right click owns the phoenix aim). Touch and VR have no
  // right click, so their Special latches the phoenix while drawn and looses a flare otherwise.
  function bowSpecial(){if(!touchEnabled&&!renderer.xr.isPresenting||!weapons.state().drawing)phoenixFlare();else weapons.special();}
  function phoenixFlare(){
    const p=selfPlayer();if(!p)return;if((snapshot.tick||0)-(p.specialTick??-1000)<specialCooldown('bow',p)){onAction('special',{});return;} // the host explains the recharge
    const aim=projectileAim();weapons.cancel();emberwingMotion.loose(performance.now()/1000);onAction('special',{origin:aim.origin,direction:aim.direction});
  }
  function primaryUp(){if(active&&role==='hero'&&dragonRide.riding()){dragonRide.press('breath',false);return;}if(active&&role==='hero'&&manned){mannedRelease();return;}if(active&&role==='hero'){if(tool==='stormreel')stormWeapon.end();staffFx.release();weapons.end();if(wallAim&&renderer.xr.isPresenting)releaseWallAim();}}
  function collectibleVisible(from,to,id){const delta=new THREE.Vector3(...to).sub(new THREE.Vector3(...from)),length=delta.length();if(length<.01)return true;
    const ray=new THREE.Raycaster(new THREE.Vector3(...from),delta.multiplyScalar(1/length),0,Math.max(0,length-.06));
    return !ray.intersectObjects(content.targets().concat([shrine,startingWorld.group]),true).some(h=>surfaceVisible(h.object)&&resolveHit(h)?.targetId!==id);
  }
  function findCollectible(){const p=snapshot.players.find(p=>p.id===playerId);return p?nearestCollectible(snapshot,{...p,position:localPosition.toArray()},{height:(x,z)=>heightAt(x,z,snapshot.edits),visible:collectibleVisible}):null;}
  // The gate ballistas of your own home base: walk up and press Use to man one, like a Timberline.
  function homeBallista(id){if(!isHomeBallistaId(id))return null;for(const base of snapshot.battle?.v===2&&snapshot.battle.status==='running'?snapshot.battle.bases:[]){const p=base.parts.find(p=>p.id===id);if(p)return base.fallenUntil>(snapshot.tick??0)?null:{id:p.id,type:'homeBallista',side:p.side,position:p.position,yaw:homeBallistaYaw(p.side),aimYaw:p.aimYaw||0,aimPitch:p.aimPitch||0,operator:p.operator||null,readyTick:p.readyTick,fireTick:p.fireTick,hp:p.hp,hook:p.hook||null,drawTick:p.drawTick??null,style:keepStyle(p.side)};}return null;}
  function nearHomeBallista(){const self=snapshot.players.find(p=>p.id===playerId);let best=null,d=HOME_MANNED.reach;for(const base of snapshot.battle?.v===2?snapshot.battle.bases:[])if(base.side===(self?.side||'party'))for(const p of base.parts){if(p.kind!=='ballista'||p.hp<=0)continue;const k=Math.hypot(p.position[0]-localPosition.x,p.position[2]-localPosition.z);if(k<=d){d=k;best=p.id;}}return best&&homeBallista(best);}
  function useHomeBallista(id){const self=snapshot.players.find(p=>p.id===playerId),b=homeBallista(id);if(!self||!b||b.hp<=0||b.side!==(self.side||'party')||renderer.xr.isPresenting)return false;if(manned?.id===b.id){dismountMachine();return true;}if(Math.hypot(b.position[0]-localPosition.x,b.position[2]-localPosition.z)>HOME_MANNED.reach){report('Step up to the ballista to man it.');return true;}mountMachine(b);return true;}
  // Healing well (drink), barracks bell (send a squad now), Quartermaster (shop), Gold mill (feed / crank) and any
  // tavern's bar (Hearty Ale); the host decides reach and cooldowns.
  function useHomePiece(){const self=snapshot.players.find(p=>p.id===playerId),near=([x,z],r)=>Math.hypot(x-localPosition.x,z-localPosition.z)<=r;if(!self)return false;
    const bar=taverns(snapshot).find(t=>near(tavernBar(t),TAVERN.barReach));if(bar){unlockAudio();onAction('tavernAle',{});return true;}
    const base=snapshot.battle?.v===2&&snapshot.battle.status==='running'?snapshot.battle.bases.find(b=>b.side===(self?.side||'party')):null;if(!base||base.fallenUntil>(snapshot.tick??0))return false;
    if(near(counterAt(base.side),SHOP.reach)){unlockAudio();onAction('openShop',{});return true;}
    if(near(millAt(base.side,MILL.crank),MILL.crankReach)){unlockAudio();onAction('millCrank',{});return true;}
    if(near(millAt(base.side,MILL.hopper),MILL.reach)){unlockAudio();onAction('millFeed',{});return true;}
    if(near(backTownSpot(base.side,'stores',STORES.door),STORES.reach)){unlockAudio();onAction('inventionDeposit',{});return true;}
    if(near(homePoint(base.side,HOME_LAYOUT.fountain),HOME_RULES.drink.reach)){unlockAudio();onAction('homeDrink',{});return true;}
    if(near(bellPostAt(base.side),HOME_RULES.bell.reach)){unlockAudio();onAction('homeBell',{});return true;}return false;}
  function useInvention(id){if(isHomeBallistaId(id))return useHomeBallista(id);const self=snapshot.players.find(p=>p.id===playerId),b=snapshot.inventions?.structures.find(b=>b.id===id);if(!self||!b||b.type==='foundation'||b.hp<=0||(b.side!==(self.side||'party')&&b.type!=='forge')||Math.hypot(b.position[0]-localPosition.x,b.position[2]-localPosition.z)>5)return false;/* inventions.js usable reach */if(b.type==='forge'){onAction('openWorkshop',{structureId:b.id});return true;}if(b.type==='timberline'&&!renderer.xr.isPresenting){if(manned?.id===b.id)dismountMachine();else mountMachine(b);}else if(['timberline','launcher'].includes(b.type))beginInventionPlacement('operate:'+b.id);else onAction('inventionUse',{structureId:b.id});return true;}
  function interact(){if(!active||role!=='hero')return;if(appleSnack.holding()){unlockAudio();appleSnack.bite();return;}if(nearPlantedPack()){unlockAudio();onAction('stormPickup');return;}const c=findCollectible();if(c){onAction('collectTarget',{targetId:c.id});return;}const looked=aimProbe().hit?.targetId;if(looked&&isHomeBallistaId(looked)&&useHomeBallista(looked))return;if(looked&&snapshot.inventions?.structures.some(b=>b.id===looked)&&useInvention(looked))return;const hb=nearHomeBallista();if(hb&&useHomeBallista(hb.id))return;if(useHomePiece())return;const b=snapshot.inventions?.structures.filter(b=>b.hp>0&&b.type!=='foundation').sort((a,b)=>Math.hypot(a.position[0]-localPosition.x,a.position[2]-localPosition.z)-Math.hypot(b.position[0]-localPosition.x,b.position[2]-localPosition.z))[0];if(b)useInvention(b.id);}

  function grab(pressIndex){if(!active||role!=='hero')return;const ore=findCollectible();if(ore&&Object.hasOwn(ORE_RECIPES,ore.kind)){sendInput(performance.now(),false,true);onAction('inventionLiftOre',{targetId:ore.id});return;}const aim=weaponAim(pressIndex);let nearLog=null;
    if(renderer.xr.isPresenting){const index=[...controllerSources.entries()].find(([,s])=>s.handedness==='right')?.[0];if(index!==undefined){const hand=grips[index].getWorldPosition(new THREE.Vector3()).toArray();nearLog=(snapshot.looseLogs||[]).filter(l=>!l.heldBy&&capsuleDistance(l,hand)<=POUCH_RULES.grabReach).sort((a,b)=>capsuleDistance(a,hand)-capsuleDistance(b,hand)||a.id.localeCompare(b.id))[0];}}
    const id=nearLog?.id||content.grabTarget?.(aim.origin,aim.direction,3)||combat.grabTarget?.(aim.origin,aim.direction,3);
    if(id){if(renderer.xr.isPresenting){sendInput(performance.now(),false,true);onAction('grab',{id,interaction:'vr-grip',hand:1});}else onAction('grab',{id});}else if(!renderer.xr.isPresenting)interact();
  }
  function pouchReady(){const p=snapshot.players.find(p=>p.id===playerId),i=[...controllerSources.entries()].find(([,s])=>s.handedness==='right')?.[0];if(!p||i===undefined)return false;const hand=localPose(grips[i]).position,pouch=waistPouchPosition({...p,yaw,head:localPose(renderer.xr.getCamera())});return Math.hypot(...hand.map((v,k)=>v-pouch[k]))<=POUCH_RULES.radius;}
  // A Stormreel crossbow spiked into the ground within reach (shared/stormreel.js stormPickup uses the same reach).
  function nearPlantedPack(){let best=null,bd=STORMREEL.plantReach+.4;for(const b of snapshot.inventions?.structures||[])for(const pack of ['red','blue']){const at=b.planted?.[pack]?.at;if(!at)continue;const d=Math.hypot(at[0]-localPosition.x,at[2]-localPosition.z);if(d<bd){bd=d;best={b,pack};}}return best;}
  function release(throwIt=false,pressIndex){if(!active||role!=='hero')return;if(appleSnack.holding()){onAction('snack',{op:'drop',toss:throwIt});return;}if(tool==='stormreel'&&wornTower(snapshot,selfPlayer())){unlockAudio();onAction('stormPlant');return;}if(snapshot.players.find(p=>p.id===playerId)?.heldOre){sendInput(performance.now(),false,true);onAction('inventionDropOre');return;}const log=snapshot.looseLogs?.find(l=>l.heldBy===playerId);
    if(!throwIt&&log&&renderer.xr.isPresenting&&pouchReady()){sendInput(performance.now(),false,true);onAction('stowLog',{id:log.id});return;}
    onAction('release',{throw:throwIt,direction:weaponAim(pressIndex).direction});
  }
  function strike() {
    if(['crossbow','bow','wyrmspout','flask','stormreel'].includes(tool)){primaryDown();return;}
    const profile=SWING_PROFILES[tool]||SWING_PROFILES.axe;
    if (!active || role !== 'hero' || specialSwing || weaponSwap.busy || performance.now() - swingAt < profile.cooldown*1000) return;
    swingAt = performance.now();strikeClock.begin(swingAt/1000,profile.duration);swingContact=false;soundKit?.play('swing',null,null,{tool,gap:.05});swingTarget=contactRay();{const aim=weaponAim(),earth=swingTarget?null:terrainRay.segment(aim.origin,aim.origin.map((v,i)=>v+aim.direction[i]*1.95));swingReach=THREE.MathUtils.clamp(swingTarget?.distance??earth?.distance??1.5,.6,2.8);} // a blow into the dirt or open air stays at arm's length
    swingRest={position:new THREE.Vector3(...FPS_WEAPON_POSE.position),quaternion:new THREE.Quaternion().setFromEuler(new THREE.Euler(...FPS_WEAPON_POSE.rotation))};
    swingRest.position.x=.33*Math.min(1,camera.aspect/.9);
    unlockAudio();
  }
  // The frame the strike packet leaves: what did the head meet? The reaction, sparks/chips and the thunk play now, ahead
  // of the authority (the matching authoritative event is then skipped, see impactLedger), so a cloud room feels as
  // immediate as a hosted one. A swing into open air plays its full follow-through.
  const strikeDirection=new THREE.Vector3(),strikeRight=new THREE.Vector3();
  function strikeContact(hit,now){
    let material=hit?strikeMaterial(hit.targetId,snapshot,{trees:worldTrees(snapshot),structureMaterial}):null,point=hit?.point,normal=hit?.normal;
    if(hit&&!material)material='stone';           // an unbreakable prop: the blow glances off it
    if(!hit){const aim=weaponAim(),to=aim.origin.map((v,i)=>v+aim.direction[i]*1.95),earth=terrainRay.segment(aim.origin,to);if(earth){material='earth';point=earth.point;normal=earth.normal;}}
    const kind=strikeReaction(tool,material)||'miss';strikeClock.contact(now/1000,kind);
    if(kind==='miss'||!point)return;
    const reaction=STRIKE_REACTIONS[kind],weight=tool==='hammer'?1.45:tool==='limb'?.8:1;
    viewPunch.kick(reaction.punch,weight);
    // The blade travels right to left across the view and down: chips leave the cut that way.
    camera.getWorldDirection(strikeDirection);strikeRight.set(-strikeDirection.z,0,strikeDirection.x).normalize();
    const travel=strikeRight.clone().multiplyScalar(-1).addScaledVector(strikeDirection,.35).normalize().toArray();
    const steel=STEEL_TOOLS.includes(tool),visual=material==='flesh'?'bone':material;
    let seed=Math.round(now)|0;for(const c of String(hit?.targetId||'earth'))seed=(Math.imul(seed,31)+c.charCodeAt(0))|0;
    impacts.emit({material:visual,position:point,normal,energy:STRIKE_ENERGY[tool]??1,seed,direction:travel,steel,kind});
    impactLedger.record(point,material,now/1000);
    const ear=listenerPose(),id=hit?.targetId;
    if(material==='wood')woodAudio?.play({kind:'wood_hit',position:point,id,material:'wood',normal},ear);
    else if(material==='earth')soundKit?.play('strike_earth',point,ear,{weight});
    else if(hit&&snapshot.deposits?.some(d=>d.id===id))materialAudio?.play({kind:'stone_hit',position:point,id,material:'stone',normal},ear,snapshot.tick);
    else materialAudio?.play({kind:'hit',position:point,id,material:material==='crystal'?'stone':material,normal,energy:STRIKE_ENERGY[tool]??1,sourceMaterial:steel?'weapon':'bone'},ear,snapshot.tick);
    if(kind==='rebound'&&steel)soundKit?.play('strike_ring',null,null,{tool});
    if(kind==='bite'&&material==='wood')soundKit?.play('strike_wrench',null,null,{delay:reaction.hold});
    if(touchEnabled)try{navigator.vibrate?.(kind==='bite'?[22]:kind==='rebound'?[12,24,8]:kind==='thud'?[28]:[14]);}catch{}
  }
  function clearInput() {
    dragonRide.clearInput();
    aiming=false;cinderAim=false;scoping=false;crankHeld=false;weapons.cancel();specialSwing=null;cancelWallAim();pickupHighlight.clear();nearestPickup=null;feedback.reset();updateFireAudio(false);cancelCast();
    swingContact=true; swingAt=-Infinity; strikeClock.cancel(); viewPunch.reset();
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
  function cancelInventionPlacement(){inventionPlacement=null;placementPointer=null;placementPin=null;placementHand=null;placementCheck={key:'',result:null};inventionVisual.preview(null);blueprintHud.set(null);}
  const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));
  function mannedMachine(){if(!manned)return null;if(isHomeBallistaId(manned.id)){const b=homeBallista(manned.id);return b?.hp>0?b:null;}return snapshot.inventions?.structures.find(b=>b.id===manned.id&&b.hp>0);}
  function mountMachine(b){weapons.cancel();clearInput();cancelCast();cancelInventionPlacement();if(manned)dismountMachine();
    manned={id:b.id,yaw:b.aimYaw||0,pitch:b.aimPitch||0,yawRate:0,sentAt:0,sent:'',sinceTick:snapshot.tick??0};yaw=(b.yaw||0)+manned.yaw;pitch=manned.pitch;
    onAction('inventionMount',{structureId:b.id});if(b.type==='homeBallista'){report(keepStyle(b.side)==='sunlance'?(touchEnabled?'Manning the Sunlance. Drag to swing it, hold Attack to draw and let go to loose (let go on the golden flash for a Dawnbreak), Sight shows the arc, hold Wind to crank, Collect steps off.':'Manning the Sunlance. Mouse swings it, hold click to draw and let go to loose (let go on the golden flash for a Dawnbreak), hold right-click to see the arc, hold R to wind faster, E or Esc steps off.'):(touchEnabled?'Manning the Gnashjaw. Drag to swing it, Attack spits the harpoon, hold Wind to reel a catch in (Attack again yanks), Sight shows the arc, Collect steps off.':'Manning the Gnashjaw. Mouse swings it, click spits the harpoon, hold R to reel a catch in (click again to yank), hold right-click to see the arc, E or Esc steps off.'));return;}report(touchEnabled?'Manning the Timberline. Drag to swing it, Attack fires, hold Wind to crank, Sight aims along the range ladder, Collect steps off.':'Manning the Timberline. Mouse swings it, click fires, hold right-click (or Q) to sight along the range ladder, hold R to wind faster, E or Esc steps off.');}
  function dismountMachine(send=true){scoping=false;crankHeld=false;if(!manned)return;const id=manned.id;manned=null;inventionVisual.setLocalAim(id,null);keepKeep()?.setLocalDraw(id,null);keepSight(null);pitch=0;heldSway.snap();if(send)onAction('inventionMount',{structureId:id,off:true});}
  function fireManned(){const b=mannedMachine();if(!b)return;unlockAudio();onAction('inventionUse',{structureId:b.id,aim:{yaw:manned.yaw,pitch:manned.pitch}});}
  // The Sunlance draws while the button is held and looses on release; everything else fires on the press.
  const keepKeep=()=>inventionVisual.homeKeep?.();
  function mannedPress(){const b=mannedMachine();if(!b)return;if(b.type==='homeBallista'&&b.style==='sunlance'){unlockAudio();if((snapshot.tick??0)<b.readyTick){report('The Sunlance is still winding.');return;}keepKeep()?.setLocalDraw(b.id,performance.now());manned.perfectRang=false;keepAudio.drawStart({local:true});onAction('inventionDraw',{structureId:b.id});return;}fireManned();}
  // The touch attack button's word while seated: what a press does on this machine right now.
  function mannedVerb(){if(!manned)return null;const b=mannedMachine();if(b?.type!=='homeBallista')return 'Fire';return b.style==='sunlance'?'Draw':b.hook?'Yank':'Spit';}
  function mannedRelease(){const b=mannedMachine(),keep=keepKeep();if(!b||!keep?.localDraw(b.id))return;keep.setLocalDraw(b.id,null);fireManned();}
  function keepSight(b,draw){const keep=keepKeep();if(!keep)return null;return keep.sight(b,manned?{yaw:manned.yaw,pitch:manned.pitch}:{yaw:0,pitch:0},{charge:draw?.charge||0,perfect:!!draw?.perfect,visible:!!b&&scopeAmount>.05});}
  function keepNotice(ev){
    if(ev.kind==='keep_ballista_burst'&&ev.by===playerId)return;
    const mine=manned&&ev.part===manned.id;if(!mine)return;
    if(ev.kind==='keep_ballista_fire'&&ev.perfect)report('Dawnbreak!');
    if(ev.kind==='keep_ballista_hook')report(touchEnabled?'Hooked! Hold Wind to reel it in, Attack yanks.':'Hooked! Hold R to reel it in, click to yank.');
    if(ev.kind==='keep_ballista_chomp')report('Chomp!');
    if(ev.kind==='keep_ballista_release'&&ev.reason==='snap')report('The chain snapped loose.');
  }
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
    const seat=b.type==='homeBallista'?homeBallistaSeat(b,manned.yaw):operatorSeat(b,manned.yaw);localPosition.set(seat[0],heightAt(seat[0],seat[2],snapshot.edits),seat[2]);correction.set(0,0,0);verticalSpeed=0;grounded=true;
    const key=manned.yaw.toFixed(3)+','+manned.pitch.toFixed(3);
    if(key!==manned.sent&&now-manned.sentAt>=100){manned.sent=key;manned.sentAt=now;onAction('inventionSteer',{structureId:b.id,aim:{yaw:manned.yaw,pitch:manned.pitch}});}
  }
  // Sighting: hold right mouse (or Q) while manning. The eye glides from the seat to the peep ring as the view narrows a little.
  function updateTimberlineScope(dt,b){
    scopeAmount=THREE.MathUtils.clamp(scopeAmount+(scoping?dt/.16:-dt/.12),0,1);
    if(scopeAmount>0&&inventionVisual.scopeEye(b.id,scopeEye)){const k=THREE.MathUtils.smoothstep(scopeAmount,0,1);camera.position.lerp(scopeEye.sub(rig.position),k);}
    inventionVisual.setScoped(b.id,scopeAmount);
  }
  function timberlineReadiness(b){const tick=snapshot.tick??0;if(tick>=b.readyTick)return {reload:1,ready:true,state:'Ready'};const left=b.readyTick-tick;return {reload:THREE.MathUtils.clamp(1-left/(b.type==='homeBallista'?HOME_MANNED.reloadTicks:MANNED.reloadTicks),0,1),ready:false,state:`Winding · ${(left/60).toFixed(1)} s`};}
  function updateTimberlineAids(now){
    const b=manned&&!renderer.xr.isPresenting&&role==='hero'&&active?mannedMachine():null;
    document.body.classList.toggle('timberline-manned',!!b);
    if(!b){timberlineSight.hide();timberlineAmmoHud.set(null);if(scopeAmount||scoping){scopeAmount=0;scoping=false;}inventionVisual.setScoped(null);return;}
    if(b.type==='homeBallista'){ // free bolts; the sighting arc stands in for the range ladder
      timberlineSight.hide();const keep=keepKeep(),draw=b.style==='sunlance'?keep?.localDraw(b.id):null,sight=keepSight(b,draw);
      if(draw?.perfect&&!manned.perfectRang){manned.perfectRang=true;keepAudio.perfectBeat();}
      if(b.hook&&(keys.has('KeyR')||crankHeld))keepAudio.ratchet({local:true,rate:1,reel:true});else if((snapshot.tick??0)<b.readyTick&&(keys.has('KeyR')||crankHeld))keepAudio.ratchet({local:true,rate:1});
      const state=b.hook?(touchEnabled?'Hooked · hold Wind to reel':'Hooked · hold R to reel, click to yank'):draw?(draw.perfect?'Dawnbreak! Let go!':`Drawing · ${Math.round(draw.charge*100)}%`):timberlineReadiness(b).state;
      timberlineAmmoHud.set({label:b.style==='sunlance'?'Sunlance':'Gnashjaw',bolts:1,state:sight?.visible&&sight.distance?`${state} · ${Math.round(sight.distance)} m`:state,scoped:scopeAmount>.5});return;}
    const self=snapshot.players.find(p=>p.id===playerId),ammo=timberlineAmmo(snapshot,self),ready=timberlineReadiness(b);
    camera.getWorldPosition(sightEye);
    // The forecast arcs only show while sighting along the ladder, and fade in with it.
    if(scopeAmount>0)timberlineSight.update({b,aim:manned,height:(x,z)=>terrainHeight(x,z,snapshot.edits,snapshot.tick??Infinity),eye:sightEye,camera,time:now/1000,editsKey:startingEdits,amount:scopeAmount});else timberlineSight.hide();
    timberlineAmmoHud.set({...ammo,state:ammo.total?ready.state:'',scoped:scopeAmount>.5});
  }
  // Hold R to wind: the operator doubles the reload; a second Hero cranking beside it quadruples it.
  function crankNearby(now){
    if(!active||role!=='hero'||!(keys.has('KeyR')||crankHeld)||now-crankAt<150)return;
    const self=snapshot.players.find(p=>p.id===playerId),b=manned?mannedMachine():snapshot.inventions?.structures.find(b=>b.type==='timberline'&&b.hp>0&&b.side===(self?.side||'party')&&Math.hypot(b.position[0]-localPosition.x,b.position[2]-localPosition.z)<=MANNED.crankReach)||nearHomeBallista();
    if(!b&&!manned){const base=snapshot.battle?.v===2?snapshot.battle.bases.find(q=>q.side===(self?.side||'party')):null;if(base?.mill?.queue?.length){const [x,z]=millAt(base.side,MILL.crank);if(Math.hypot(x-localPosition.x,z-localPosition.z)<=MILL.crankReach){crankAt=now;onAction('millCrank',{});}}return;}
    if(!b||!(snapshot.tick<b.readyTick||b.hook))return;crankAt=now;onAction('inventionCrank',{structureId:b.id});
  }
  // Blueprint placement: the see-through model follows the aim every frame (crosshair while the mouse is captured,
  // the cursor while it is free, the controller ray in VR, the screen centre or a tapped spot on touch).
  // Left-click / trigger / Place confirms; right-click, Esc, grip or Cancel backs out. The authority re-validates.
  const blueprintHud=createBlueprintHud({parent:canvas.parentElement||document.body,onPlace:()=>placeInvention(),onRotate:()=>turnPlacement(Math.PI/4),onCancel:()=>cancelInventionPlacement()});
  const PLACE_REACH=7.6;// just inside the 8 m build reach, so the blueprint never strays out of range
  function beginInventionPlacement(type){weapons.cancel();clearInput();cancelCast();if(manned)dismountMachine();inventionPlacement=type;placementPin=null;placementPointer=null;placementCheck={key:'',result:null};
    // Keep (or regain) the crosshair on desktop: the menu click that chose the building is the gesture pointer lock needs.
    if(role==='hero'&&!touchEnabled&&!renderer.xr.isPresenting&&document.pointerLockElement!==canvas){try{canvas.requestPointerLock?.()?.catch?.(()=>{});}catch{}}
    report(type.startsWith('operate:')?'Aim at the target and click or tap to fire. Right-click or Esc cancels.':'Aim where it should stand. Click or tap Place to build; right-click or Esc cancels.');}
  function turnPlacement(by){if(!inventionPlacement||inventionPlacement.startsWith('operate:')||inventionPlacement==='foundation')return;placementTurn=wrapAngle(placementTurn+by);}
  // Touch: a tap on the ground moves the blueprint there; it stays put while the player looks around.
  function pinPlacement(x,y){const point=screenGround(x,y);if(point)placementPin=point;}
  function placementYaw(){return (role==='hero'?yaw:0)+placementTurn;}
  function screenGround(x,y){const rect=canvas.getBoundingClientRect();pointer.set((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);camera.updateMatrixWorld();raycaster.setFromCamera(pointer,camera);
    const o=raycaster.ray.origin.toArray(),d=raycaster.ray.direction,far=role==='god'?160:24;return terrainRay.segment(o,[o[0]+d.x*far,o[1]+d.y*far,o[2]+d.z*far])?.point||null;}
  function placementAim(){
    let point=null;
    if(renderer.xr.isPresenting){const i=placementHand??[...controllerSources.entries()].find(([,s])=>s.handedness==='right')?.[0]??0,c=controllers[i];if(!c)return null;
      const o=c.getWorldPosition(new THREE.Vector3()),d=c.getWorldDirection(new THREE.Vector3()).negate();point=terrainRay.segment(o.toArray(),o.clone().addScaledVector(d,16).toArray())?.point||null;}
    else if(placementPin)point=[...placementPin];
    else if(touchEnabled||document.pointerLockElement===canvas||!placementCursor){const rect=canvas.getBoundingClientRect();point=screenGround(rect.left+rect.width/2,rect.top+rect.height/2);
      // Looking up at the sky still offers a spot straight ahead at full reach.
      if(!point&&role==='hero'){const d=camera.getWorldDirection(new THREE.Vector3()),h=Math.hypot(d.x,d.z)||1;point=[localPosition.x+d.x/h*PLACE_REACH,0,localPosition.z+d.z/h*PLACE_REACH];}}
    else point=screenGround(placementCursor.x,placementCursor.y);
    if(!point)return null;
    if(role==='hero'&&!inventionPlacement.startsWith('operate:')){const dx=point[0]-localPosition.x,dz=point[2]-localPosition.z,r=Math.hypot(dx,dz);if(r>PLACE_REACH){point[0]=localPosition.x+dx/r*PLACE_REACH;point[2]=localPosition.z+dz/r*PLACE_REACH;}}
    point[1]=heightAt(point[0],point[2],snapshot.edits);
    return new THREE.Vector3(...point);
  }
  // The shared validator is pure but walks every tree and structure, so it reruns only when the spot, turn or world changes.
  function placementValidation(point){const self=snapshot.players.find(p=>p.id===playerId),mode=inventionPlacement;if(!self||!point||mode.startsWith('operate:'))return null;
    const key=`${mode}|${Math.round(point.x*20)}|${Math.round(point.z*20)}|${Math.round(placementYaw()*100)}|${Math.round(localPosition.x*4)}|${Math.round(localPosition.z*4)}`;
    if(placementCheck.key===key&&placementCheck.snapshot===snapshot)return placementCheck.result;
    const result=validateInventionPlacement(snapshot,{...self,position:localPosition.toArray()},{kind:mode,position:point.toArray(),yaw:placementYaw()},{terrainHeight:sharedTerrainHeight});
    placementCheck={key,snapshot,result};return result;}
  function updatePlacementPreview(dt){
    if(!inventionPlacement){blueprintHud.set(null);return;}
    if(!active){cancelInventionPlacement();return;}
    const mode=inventionPlacement,point=placementAim(),validation=placementValidation(point),operate=mode.startsWith('operate:');
    inventionVisual.preview(point,mode,validation,{yaw:placementYaw(),dt,time:renderTick/60,label:renderer.xr.isPresenting});
    const type=operate?snapshot.inventions?.structures.find(b=>b.id===mode.slice(8))?.type:mode;
    blueprintHud.set(renderer.xr.isPresenting?null:{name:INVENTION_TYPES[type]?.name||'Building',mode:touchEnabled?'touch':'desktop',valid:!!point&&validation?.ok!==false,reason:point?validation?.reason||'':'Aim at open ground.',operate,cursor:!touchEnabled&&document.pointerLockElement!==canvas});
  }
  function placeInvention(){if(!inventionPlacement)return;const mode=inventionPlacement,point=placementAim();if(!point){onAction('placementFeedback',{reason:'Aim at open ground.'});return;}
    if(!mode.startsWith('operate:')){const validation=placementValidation(point);if(validation&&!validation.ok){onAction('placementFeedback',{reason:validation.reason});return;}}
    const turn=placementYaw();if(placementRepeat&&!mode.startsWith('operate:'))placementPin=null;else cancelInventionPlacement();
    if(mode.startsWith('operate:'))onAction('inventionUse',{structureId:mode.slice(8),target:point.toArray()});else onAction('inventionBuild',{kind:mode,type:mode,position:point.toArray(),x:point.x,z:point.z,yaw:turn});}
  // Mouse: left places, right cancels. Touch is left to the world-touch layer (drag looks, a tap moves the blueprint).
  listen(canvas,'pointerdown',event=>{if(!active||!inventionPlacement||event.pointerType!=='mouse')return;event.preventDefault();event.stopImmediatePropagation();placementCursor={x:event.clientX,y:event.clientY};
    placementPointer=event.button===0?event.pointerId:event.button===2?'cancel':null;},true);
  // Both act on release, so the matching mousedown still sees build mode and never swings, sights or casts.
  listen(canvas,'pointerup',event=>{if(!active||!inventionPlacement||event.pointerType!=='mouse'||placementPointer===null)return;event.preventDefault();event.stopImmediatePropagation();
    const press=placementPointer;placementPointer=null;if(press==='cancel'){if(event.button===2)cancelInventionPlacement();return;}if(event.button!==0)return;
    placementRepeat=event.shiftKey;placementCursor={x:event.clientX,y:event.clientY};placeInvention();placementRepeat=false;},true);
  listen(canvas,'pointercancel',()=>{placementPointer=null;});
  listen(canvas,'pointermove',event=>{if(event.pointerType==='mouse')placementCursor=event.target===canvas?{x:event.clientX,y:event.clientY}:null;},true);
  listen(canvas,'wheel',event=>{if(!active||!inventionPlacement)return;event.preventDefault();event.stopImmediatePropagation();turnPlacement(Math.sign(event.deltaY||event.deltaX)*Math.PI/12);},{passive:false,capture:true});
  listen(window,'keydown',event=>{if(!inventionPlacement)return;
    if(event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancelInventionPlacement();}
    else if(event.code==='KeyR'&&active&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)turnPlacement((event.shiftKey?-1:1)*Math.PI/4);}},true);
  // Esc while the mouse is captured is swallowed by the browser to release it; treat that release as the cancel.
  listen(document,'pointerlockchange',()=>{if(document.pointerLockElement!==canvas&&inventionPlacement&&wasCaptured&&document.hasFocus()&&!document.hidden)cancelInventionPlacement();});
  // Prime both sound banks on the first game gesture, before the first physical impact.
  listen(window, 'pointerdown', () => { if (active) unlockAudio(); });
  listen(window, 'keydown', event => {
    if (!active || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName) || event.target?.isContentEditable) return;
    unlockAudio();
    if (role === 'god' && event.code === 'Escape') { cancelCast(); return; }
    if (role === 'hero' && event.code === 'Escape' && wallAim) { cancelWallAim(); return; }
    if (role === 'hero' && event.code === 'Escape' && cinderAim) { releaseCinderAim(false); return; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.code === 'Space' && !event.repeat && role === 'hero') jumpPending = true;
    if (role === 'hero' && dragonRide.riding()) { if (!event.repeat) dragonRide.key(event.code, true); jumpPending = false; return; }
    if (role === 'hero' && !event.repeat && event.code === 'KeyH' && dragonRide.ready()) { dragonRide.call(); return; }
    if (role === 'hero' && !event.repeat && manned) { if (event.code === 'KeyE' || event.code === 'Escape') dismountMachine(); else if (event.code === 'KeyQ') special(); }
    else if (role === 'hero' && !event.repeat) {const slot=/^Digit[1-9]$/.test(event.code)?Number(event.code.slice(5))-1:-1;if(slot>=0&&slot<hotbarSlots.length)equip(hotbarSlots[slot]);if(event.code==='KeyI')startInspect();if(event.code==='KeyE')interact();if(event.code==='KeyB'&&event.shiftKey)onAction('buildBridge');if(event.code==='KeyF')grab();if(event.code==='KeyG')release();if(event.code==='KeyX')release(true);if(event.code==='KeyQ')special();if(event.code==='KeyR'&&tool==='stormreel')feedStormspire();if(event.code==='KeyV'){unlockAudio();onAction('drinkDraught',{});}}
    if(role==='god'&&!inventionPlacement&&!event.repeat&&spellKeys[event.code]){spell=spellKeys[event.code];onSelection(spell);castStart=null;if(quickCast&&cursor.visible){quickKey=event.code;if(isLineSpell())castStart=hitPoint.clone();else castAt(hitPoint);}}
  });
  listen(window,'keyup',event=>{
    keys.delete(event.code);
    if(event.code==='KeyI')inspect.release();
    if(role==='hero')dragonRide.key(event.code,false);
    if(event.code==='KeyQ'&&wallAim&&role==='hero')releaseWallAim();
    if(event.code==='KeyQ'&&role==='hero')releaseCinderAim();
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
    if(dragonRide.riding()){if(event.button===0)dragonRide.press('breath',true);if(event.button===2)dragonRide.press('fireball',true);return;}
    if(manned){if(event.button===0)mannedPress();if(event.button===2)scoping=true;return;}
    if(event.button===0)primaryDown();
    if(event.button===2){if(tool==='staff')special();else if(['crossbow','bow','flask'].includes(tool))aiming=true;else weapons.special();if(tool==='bow')weapons.special();}
  });
  listen(window,'mouseup',event=>{if(role!=='hero')return;if(event.button===0)primaryUp();if(event.button===2){aiming=false;scoping=false;if(wallAim)releaseWallAim();}});
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
      if (inspect.owningLook() && inspect.spin(event.movementX * .0065, event.movementY * .0065)) return;   // held Inspect: the mouse turns the weapon
      const look = 0.0022 * (manned ? THREE.MathUtils.lerp(1, TIMBERLINE_SCOPE.sensitivity, scopeAmount) : 1);
      yaw -= event.movementX * look;
      pitch = THREE.MathUtils.clamp(pitch - event.movementY * look, -1.48, 1.48);
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
          else if (action === 'cycle') { const choices=hotbarSlots; equip(choices[(choices.indexOf(tool)+1)%choices.length]); }
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
    if (!active || document.hidden || manned || dragonRide.riding()) move.set(0, 0, 0);
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
    if (jumpPending && !zero && grounded && role === 'hero') { verticalSpeed = 5.5; grounded = false; soundKit?.play('jump'); }
    jumpPending = false;
  }
  let frameCountSunny = 0;
  function frame(now) {
    contactFrame++;
    if (disposed) return;
    // Loading owns explicit representative poses and warm-up renders. Running
    // the entire gameplay/terrain/IK pipeline while shaders are still compiling
    // competes with downloads and the welcome screen without drawing a frame.
    if (!startup.ready) { previous=now; return; }
    const frameStarted=performance.now();
    const intervalMs=now-previous;
    if(startup.ready)frameMetrics.record('frameInterval',intervalMs);
    // A queued RAF timestamp can precede the warm-up completion timestamp.
    // Negative dt makes exponential easing explode (notably ballista bolt scale).
    const dt = Math.max(0, Math.min((now - previous) / 1000, 0.05));
    previous = now; renderTick=presentationClock.sample(now);liveTerrain();
    if(startingWorld.group.visible){waygateView.update(snapshot,dt);geodeView.update(snapshot,dt);beaconView.update(snapshot,dt);}
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
      const me=snapshot.players.find(p=>p.id===playerId),pace=dt*5*swiftFactor(snapshot,me||{})*(1+itemBonus(me,'speed'));const predicted=localPosition.toArray();moveOnTerrain(snapshot,predicted,move.x*pace,move.z*pace);if(stormLeash(snapshot,me,predicted)&&(move.x||move.z))stormTug();localPosition.fromArray(predicted);
      const forgeY=heightAt(0,0,snapshot.edits);
      // Standing on rising or sinking earth follows the drawn ground every frame, not the 20 Hz snapshot.
      const groundY = inventionFloor(snapshot,localPosition.x,localPosition.z,forgeFloor(localPosition.x,localPosition.z,forgeY,simulationHeight(terrainLive?{...snapshot,tick:terrainShownTick()}:snapshot, localPosition.x, localPosition.z)),localPosition.y);
      if (!grounded) { verticalSpeed -= 15 * dt; localPosition.y += verticalSpeed * dt; }
      if (!grounded && localPosition.y <= groundY && verticalSpeed < -4) { orchard.contact(localPosition.x, localPosition.z, {strength: 1.5}); soundKit?.play('land', null, null, {weight: Math.min(1.4, -verticalSpeed / 7)}); } // landing dust (presentation only)
      if (grounded || localPosition.y <= groundY) { localPosition.y = groundY; verticalSpeed = 0; grounded = true; }
      if (grounded && (stepDistance += move.length() * dt * 5) > .75) { stepDistance = 0; orchard.contact(localPosition.x, localPosition.z, {strength: .6}); if (soundKit && (stepSound = !stepSound)) soundKit.play('step', null, null, {surface: footSurface(), weight: .8 + Math.random() * .3, gap: .1}); }
      const amount = 1 - Math.exp(-dt * 8);
      localPosition.addScaledVector(correction, amount);
      correction.multiplyScalar(1 - amount);
      localPosition.y = Math.max(localPosition.y, groundY);
      localPosition.fromArray(resolveForge(localPosition.toArray(),forgeY));localPosition.fromArray(resolveInventions(snapshot,localPosition.toArray()));if(snapshot.landmarks)localPosition.fromArray(resolveStartingWorld(localPosition.toArray(),(x,z)=>heightAt(x,z,snapshot.edits)));localPosition.fromArray(resolveDeposits(snapshot,localPosition.toArray(),.28,(x,z)=>heightAt(x,z,snapshot.edits)));
      {const held=localPosition.toArray();if(stormLeash(snapshot,me,held))localPosition.fromArray(held);} // the cable holds against corrections too
    }
    if (manned) updateManned(dt, now);
    crankNearby(now);
    dragonFrame=dragonRide.update(dt,{snapshot,tick:renderTick,localId:playerId,now,view:{yaw,pitch}});
    if(dragonFrame.seat&&active&&role==='hero'){if(dragonFrame.enter){yaw=dragonFrame.startYaw;pitch=dragonFrame.startPitch;}pitch=THREE.MathUtils.clamp(pitch,-1.45,.25);}
    if (role === 'god' && !renderer.xr.isPresenting) {
      pan.addScaledVector(move, dt * 18);
      pan.x = THREE.MathUtils.clamp(pan.x, -45, 45); pan.z = THREE.MathUtils.clamp(pan.z, -45, 45);
      rig.position.set(0, 0, 0);
      camera.position.set(pan.x + Math.sin(orbitYaw) * orbitRadius * Math.cos(orbitTilt), heightAt(pan.x, pan.z, snapshot.edits) + orbitRadius * Math.sin(orbitTilt) + 3, pan.z + Math.cos(orbitYaw) * orbitRadius * Math.cos(orbitTilt));
      camera.lookAt(pan.x, heightAt(pan.x, pan.z, snapshot.edits), pan.z);
    } else if (!dragonEye(dt)) {
      rig.position.copy(localPosition);
      const b = manned && mannedMachine();
      if (!renderer.xr.isPresenting) { camera.position.set(0, b?.type === 'homeBallista' ? (b.style === 'gnashjaw' ? 2.75 : 1.9) : 1.65, 0); if (b) { /* the gate ballistas stand on a plinth: the operator sights over the stock */ camera.rotation.set(manned.pitch, (b.yaw || 0) + manned.yaw, 0, 'YXZ'); updateTimberlineScope(dt, b); } else camera.rotation.set(pitch, yaw, 0, 'YXZ'); const lean=!b&&appleSnack.view();if(lean){camera.rotation.x+=lean.pitch;camera.position.y+=lean.y;} }
    }
    stormJoltStep(dt);
    viewPunch.update(dt);
    hurtFeel.update(dt);
    dragonRide.setPointScale(renderer.domElement.height,camera.fov);dragonRide.aim(camera,now);
    if (touchEnabled && role === 'god' && active && !renderer.xr.isPresenting) updateTouchAim();
    weaponAnchor.visible = role === 'hero' && !renderer.xr.isPresenting && active && !manned && !dragonBlend;
    if (axeModel) axeModel.visible = role === 'hero' && active;
    const profile=SWING_PROFILES[tool]||SWING_PROFILES.axe,progress=(now-swingAt)/(profile.duration*1000),strikeFrame=strikeClock.frame(now/1000),swingLive=!strikeFrame.done&&strikeFrame.progress>=0&&!!swingRest;
    // Look inertia, gait bob and jump/land on the camera-held item (held-sway.js); presentation only, never aim.
    const swinging=swingLive||!!specialSwing||(tool==='pick'&&pickWallMotion.slamming),swayMe=snapshot.players.find(p=>p.id===playerId);
    const sway=heldSway.update(dt,{yaw,pitch,move:swayMove.copy(move).multiplyScalar(5*swiftFactor(snapshot,swayMe||{})*(1+itemBonus(swayMe,'speed'))),grounded,verticalSpeed,tool,calm:adsAmount,swinging,visible:weaponAnchor.visible});
    {weaponAnchor.position.fromArray(tool==='bow'?[-.25,-.32,-.48]:tool==='wyrmspout'?[.22,-.25,-.46]:tool==='stormreel'?[.2,-.19,-.5]:tool==='flask'?[.25,-.17,-.45]:tool==='crossbow'?[.24,-.3,-.48]:tool==='staff'?STAFF_POSE.position:FPS_WEAPON_POSE.position).add(idleOffset(now/1000));weaponAnchor.position.x*=Math.min(1,camera.aspect/.9);weaponAnchor.rotation.fromArray(tool==='staff'?STAFF_POSE.rotation:['bow','crossbow','wyrmspout','flask','stormreel'].includes(tool)?[0,0,tool==='bow'?-.08:0]:FPS_WEAPON_POSE.rotation);}
    // Melee swing on the authored path, through the contact reaction (bite, rebound, cleave, thud), then home to rest.
    if(swingLive&&!renderer.xr.isPresenting){const pose=swingPose(tool,strikeFrame.progress,swingRest,weaponTip,swingReach);
      if(strikeFrame.home>0){pose.position.lerp(weaponAnchor.position,strikeFrame.home);pose.quaternion.slerp(weaponAnchor.quaternion,strikeFrame.home);}
      weaponAnchor.position.copy(pose.position).add(strikeFrame.offset);weaponAnchor.quaternion.copy(pose.quaternion).premultiply(strikeFrame.quaternion);}
    {const live=swingLive&&!renderer.xr.isPresenting&&weaponAnchor.visible&&tool!=='limb'&&strikeFrame.trail>0;let shown=false;
      if(live){const a=profile.a,free=strikeFrame.phase==='swing'||strikeFrame.kind==='miss',head=free?Math.min(strikeFrame.progress,profile.f):strikeFrame.contact,span=TRAIL.span*(free?1:strikeFrame.trail);
        shown=swingTrail.update({sample:q=>swingPose(tool,q,swingRest,weaponTip,swingReach),head,tail:Math.max(a*.8,head-span),strength:strikeFrame.trail*THREE.MathUtils.smoothstep(head,a,a+.1),tipLocal:weaponTip,tool});}
      if(!shown)swingTrail.hide();}
    if(tool==='crossbow'&&siegebirdAim&&!renderer.xr.isPresenting){adsAmount=siegebirdAim.update(dt,active&&role==='hero'&&aiming,idleOffset(now/1000).add(sway.position));
      // Release kick: the stock shoves back and the muzzle climbs, then springs home (the bolt has already left).
      const kick=siegebirdMechanism(weapons.state().reload).kick;if(kick){weaponAnchor.position.z+=.05*kick;weaponAnchor.position.y+=.012*kick;weaponAnchor.rotateX(.075*kick);}}else if(tool==='bow'&&!renderer.xr.isPresenting){adsAmount=THREE.MathUtils.lerp(adsAmount,active&&role==='hero'&&aiming?1:0,1-Math.exp(-14*dt));weaponAnchor.position.lerp(new THREE.Vector3(-.22*Math.min(1,camera.aspect/.9),-.29,-.51),adsAmount);weaponAnchor.rotation.z=THREE.MathUtils.lerp(-.08,-.025,adsAmount);}else adsAmount=0;
    if(!renderer.xr.isPresenting){const fov=manned?70+(TIMBERLINE_SCOPE.fov-70)*scopeAmount:70+((tool==='bow'?56:tool==='flask'?60:SIEGEBIRD_PRESENTATION.zoomFov)-70)*adsAmount;if(Math.abs(camera.fov-fov)>.001){camera.fov=fov;camera.updateProjectionMatrix();}}
    if(!swingContact&&progress>=.5){swingContact=true;const hit=contactRay();onAction('strike',hit?{...hit,tool}:{targetId:'miss',point:localPosition.toArray(),normal:[0,1,0],tool});if(!renderer.xr.isPresenting)strikeContact(hit,now);}
    if(specialSwing){const progress=(now-specialSwing.at)/(SPECIAL_MOTION.axe.duration*1000);if(!specialSwing.sent&&progress>=SPECIAL_MOTION.axe.release){specialSwing.sent=true;sendSpecial();}const pose=specialPose('axe',progress,specialSwing.rest);weaponAnchor.position.copy(pose.position);weaponAnchor.quaternion.copy(pose.quaternion);if(progress>=1)specialSwing=null;}
    // Crystal wall wind-up / hold / slam rides on the pick's base pose; the sway layer below then applies on top.
    if(tool==='pick'&&!renderer.xr.isPresenting){const layer=pickWallMotion.pose(performance.now()/1000);if(layer){weaponAnchor.position.add(layer.offset);weaponAnchor.quaternion.premultiply(layer.quaternion);}}else pickWallMotion.reset();
    // Emberwing equip / draw / phoenix flare / release kick ride on the bow's base pose; the sway layer then applies on top.
    {const shown=tool==='bow'&&weaponAnchor.visible;if(shown&&!bowLayerShown)emberwingMotion.equip(now/1000);else if(!shown&&bowLayerShown)emberwingMotion.reset();bowLayerShown=shown;
      bowLayer=shown?emberwingMotion.update(now/1000,dt,weapons.state(),adsAmount):null;if(bowLayer&&!renderer.xr.isPresenting){weaponAnchor.position.add(bowLayer.offset);weaponAnchor.quaternion.premultiply(bowLayer.quaternion);}}
    // Sunthread: the staff reaches toward its beam and lifts on a nova, then the crown, beam, light and pools update.
    {const shown=tool==='staff'&&active&&role==='hero'&&!!axeModel&&weaponAnchor.visible&&axeModel.visible;staffFx.attach(shown?axeModel:null);
      // lean first, so the beam leaves the crown where it is drawn this frame
      if(shown&&!renderer.xr.isPresenting){const k=staffBeamK+=((staffFx.holding()?1:0)-staffBeamK)*Math.min(1,dt*10),n=1-staffFx.novaReady(now/1000);weaponAnchor.position.z-=.07*k;weaponAnchor.position.x-=.05*k;weaponAnchor.position.y+=.03*k+.04*Math.max(0,n*4-3);weaponAnchor.rotateX(-.22*k);weaponAnchor.rotateZ(.1*k);}
      staffFx.update({time:now/1000,dt,shown,aim:weaponAim(),camera});}
    // Wyrmspout: the jet shoves and shivers the gun while it sprays; a Gout bucks it up and back.
    if(tool==='wyrmspout'&&weaponAnchor.visible&&!renderer.xr.isPresenting){const sp=wyrmFeel.spray(),k=wyrmFeel.goutKick(),t=now/1000;
      weaponAnchor.position.z+=.014*sp+.06*k*k;weaponAnchor.position.x+=.0025*sp*Math.sin(t*53);weaponAnchor.position.y+=.003*sp*Math.sin(t*41)+.012*k*k;weaponAnchor.rotateX(.025*sp+.008*sp*Math.sin(t*37)+.16*k*k);}
    // Emberdew: cocked at the shoulder while aiming; the throw snaps forward and a fresh bottle bobs up (emberdew-hand.js).
    {const layer=emberdewHand.update(now/1000,dt,{aiming:tool==='flask'&&active&&role==='hero'&&(aiming||cinderAim)&&!renderer.xr.isPresenting});
      flaskModel.visible=layer.visible;
      if(tool==='flask'&&weaponAnchor.visible&&!renderer.xr.isPresenting){adsAmount=layer.ads;weaponAnchor.position.add(layer.offset);weaponAnchor.quaternion.multiply(layer.quaternion);}
      if(layer.kick&&tool==='flask'){const [side,backward]=layer.kick,c=Math.cos(yaw),n=Math.sin(yaw);bottleFx.kick(side*c+backward*n,-side*n+backward*c);}}
    // The crossbow bore is solved onto the reticle, so it takes the positional sway only (above).
    if(inspect.active()){if(inspectFitModel!==axeModel){inspectFitModel=axeModel;inspectFit=measureWeapon(axeModel,weaponAnchor);if(inspectFit)inspectFit.base=INSPECT_BASE[tool]||null;}
      const ip=inspect.update(dt,{visible:weaponAnchor.visible&&role==='hero'&&!renderer.xr.isPresenting&&!manned,fit:inspectFit});
      if(ip.amount>0){weaponAnchor.position.lerp(ip.position,ip.amount);weaponAnchor.quaternion.slerp(ip.quaternion,ip.amount);}}
    if(tool!=='crossbow'&&weaponAnchor.visible){weaponAnchor.position.add(sway.position);weaponAnchor.quaternion.premultiply(sway.quaternion);}
    swingTrail.mesh.position.copy(sway.position);
    // Weapon swap: drop the old item out of frame, change models at the bottom, raise the new one.
    if(weaponSwap.busy&&(!weaponAnchor.visible||renderer.xr.isPresenting)){const pending=weaponSwap.cancel();if(pending)equipVisual(pending);}
    {const swap=weaponSwap.update(dt);if(swap.commit)equipVisual(swap.commit);if(swap.amount&&weaponAnchor.visible){weaponAnchor.position.add(swap.position);weaponAnchor.quaternion.premultiply(swap.quaternion);}}
    // The snack takes the hand: the weapon dips out of view while it is held, and comes back after the core is flicked.
    {const xr=renderer.xr.isPresenting,snackBlend=appleSnack.update(dt,{now:now/1000,renderTick,xrHand:xr&&role==='hero'?rightGrip():null,xrHead:xr?renderer.xr.getCamera():null,sway:weaponAnchor.visible?sway:null});
      if(snackBlend>0){weaponAnchor.position.y-=.6*snackBlend;weaponAnchor.rotateX(-.5*snackBlend);if(axeModel&&(snackBlend>.97||xr))axeModel.visible=false;}}
    if(waistPouch){waistPouch.visible=active&&role==='hero'&&renderer.xr.isPresenting;if(waistPouch.visible){const p=snapshot.players.find(p=>p.id===playerId);waistPouch.position.fromArray(waistPouchPosition({...p,yaw,head:localPose(renderer.xr.getCamera())}));waistPouch.position.y-=.181;waistPouch.rotation.y=yaw;}}
    {const wound=siegebirdWind.update(dt,siegebirdGrip());for(const c of wound.cues)siegebirdCue({...c,crank:true});siegebirdWindVerdict(wound.wind);}
    if(axeModel)updateWeaponPresentation(axeModel,tool,{...weapons.state(),hand:tool==='crossbow'?siegebirdWind.hand():null,time:now/1000,templates,ember:bowLayer?.ember??0,stringSnap:bowLayer?.string??0,stringGlow:bowLayer?.stringGlow??0,spray:wyrmFeel.spray(),fill:wyrmFeel.shown(),gout:wyrmFeel.goutKick(),...(tool==='wyrmspout'?wyrmIndicators():null)});
    if(tool==='crossbow'&&axeModel)updateSiegebirdLocal(now,weapons.state().reload);
    siegebirdFlock?.updateWorld(now/1000,{viewer:camera.getWorldPosition(siegebirdViewer)});
    weapons.tick();const weaponState=weapons.state();feedback.draw(weaponState);
    {const me=snapshot.players.find(p=>p.id===playerId),spraying=tool==='wyrmspout'&&weaponState.firing&&!!axeModel&&role==='hero'&&active;
      wyrmFeel.update(dt,{spraying,player:me,tick:snapshot.tick||0,tool});
      if(spraying){const aim=projectileAim();wyrmStream.emitLocal(`p:${playerId}`,new THREE.Vector3().fromArray(aim.origin),aim.direction,sprayTuning(me),dt);}else wyrmStream.stopLocal(`p:${playerId}`);
      updateFireAudio(spraying);}
    setEmberdewTime(now/1000);
    // The rag is lit while aiming (always while held on touch and VR). The held bottle shows it at once; the host hears it
    // so everyone sees the flame, and a thrown bottle carries it. Re-sent until the host agrees (a swap can race it).
    {const me=selfPlayer(),wick=tool==='flask'&&active&&role==='hero'&&(flaskAimed()||cinderAim);
      if(me?.tool==='flask'&&!!me.flaskLit!==wick&&now-wickSentAt>300){wickSentAt=now;onAction('wick',{lit:wick});}
      if(tool==='flask'&&axeModel){flaskModel.updateWorldMatrix(true,false);bottleFx.update({dt,time:now/1000,lit:wick,worldPosition:flaskModel.getWorldPosition(bottlePosition),worldQuaternion:flaskModel.getWorldQuaternion(bottleRotation)});}}
    updateTimberlineAids(now);
    colliderDebug?.update(snapshot,now);
    const ranged=rangedReticle.set({tool,role,menuOpen:!active||(tool==='crossbow'&&adsAmount>.5),presenting:renderer.xr.isPresenting,...weaponState});
    document.body.classList.toggle('ranged-aim-active',!!ranged||adsAmount>.5);
    if(shouldShowTrajectory({tool,role,menuOpen:!active,...weaponState})){
      // The path is re-integrated from the live bow tip and aim every frame (smooth while moving/turning); the full
      // world query over the whole flight runs at ~15 Hz, and frames in between only re-query around the last contact.
      const full=now>=nextGuideAt,guideStart=performance.now(),aim=projectileAim();if(full)nextGuideAt=now+66;
      const hitWin=full?null:guideHitTick===null?GUIDE_NO_HIT:[Math.max(0,guideHitTick-14),guideHitTick+14];
      const r=trajectoryGuide.update({origin:aim.origin,aimDirection:aim.direction,curveBase:weaponState.curveBase,draw:weaponState.draw,hit:worldContact,hitWindow:hitWin,terrainHeight:heightAt,sampleEvery:3});
      if(full||r.hit)guideHitTick=r.hit?r.ticks-1:null;
      guideTiming.lastMs=performance.now()-guideStart;guideTiming.maxMs=Math.max(guideTiming.maxMs,guideTiming.lastMs);guideTiming.updates++;
    }else{trajectoryGuide.hide();nextGuideAt=0;guideHitTick=null;}
    updateFlaskGuide(now);
    {const t=terrainShownTick();content.tick(now,Number.isFinite(t)?t:snapshot.tick||0);}impacts.update(dt);rewards.update(dt);fireVisual.update(now,dt);wyrmStream.update(dt,camera);expedition.update(now,dt,camera);woodAudio?.tick(listenerPose());materialAudio?.tick(listenerPose());ambience?.update({dt,ear:listenerPose,sky:()=>skyCycle.stats(),state:()=>snapshot,altitude:()=>{const p=listenerPose().position;return p[1]-heightAt(p[0],p[2],snapshot.edits);}});
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
      if (entry.enemy) presentEnemyRoot(entry, renderTick, dt);
      else {
        entry.root.position.lerp(entry.target, 1 - Math.exp(-dt * 12));
        entry.root.rotation.y = entry.data.head ? 0 : entry.data.yaw || 0;
      }
      if (entry.visual.userData.hero) heroView.update(entry.visual, entry.data, entry.root, dt, (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldPosition(heroCamera));
      if (!entry.enemy && entry.data?.role) entry.root.visible = !entry.data.dragon; // a Hero on their dragon is up in the saddle
    }
    inventionVisual.setViewer(playerId);inventionVisual.update(dt,renderTick,camera,canvas.clientHeight);updatePlacementPreview(dt);
    stormWeapon.update(dt);stormView.update(dt,now/1000,camera.getWorldPosition(stormCam));lightning.update(dt,camera);
    if(tool==='stormreel'&&weaponAnchor.visible&&!renderer.xr.isPresenting)weaponAnchor.position.add(stormWeapon.poseOffset(stormKick));
    settlementVisual.update(dt,(renderer.xr.isPresenting?renderer.xr.getCamera():camera).getWorldPosition(heroCamera));
    combat.beginCreatureFrame?.();
    for(const entry of actors.values())if(entry.enemy)meteorCreatures.beforeMotion(entry);
    for (const mixer of mixers) mixer.update(dt);
    // Enemy motion polish (opus-enemy-character): after clips, before contacts, so hits see the final pose.
    enemyThreats.length=0;for(const p of snapshot.players||[])if(p.role==='hero'&&p.position)enemyThreats.push(p.id===playerId?localPosition.toArray(threatPoint):p.position);
    updateEnemyMotion(actors,{tick:renderTick,dt,height:enemyGround,threats:enemyThreats});
    golemFx.update(actors,renderTick,dt,now/1000);
    entView.update(actors,renderTick,dt,enemyThreats);entView.tick(dt);stumplingView.update(actors,renderTick,dt);stumplingView.tick(dt);
    combat.tick(dt,isHost(),now/1000,renderTick);
    goldenFlight.length=0;for(const q of snapshot.projectiles||[])if(q.golden){const node=combat.projectiles.get(q.id);if(node?.visible!==false)goldenFlight.push({id:q.id,position:node?node.position:new THREE.Vector3().fromArray(q.position)});}
    skeletonFx.update(dt,{camera,golden:goldenFlight,viewportHeight:renderer.domElement.height||800});
    if(tool==='limb'&&!renderer.xr.isPresenting&&role==='hero')combat.poseLocalHeld?.(playerId,weaponAnchor);
    tickPhysicalMelee(now,dt);
    const heldRoot=tool==='limb'?combat.heldLimbRoot(playerId):axeModel;
    if(!heldRoot||heldRoot!==failedReadinessRoot){try{heldReadiness=readinessCache.select({root:heldRoot,tool,reducedMotion:reducedWeaponMotion});}catch(error){failedReadinessRoot=heldRoot;heldReadiness=null;report(`Weapon readiness: ${error.message}`);}}
    const readiness=weaponReadiness(snapshot.players.find(p=>p.id===playerId),tool,snapshot.tick);
    heldReadiness?.update({...readiness,time:now/1000,focus:tool==='pick'?pickWallMotion.pose(performance.now()/1000)?.focus||0:0});
    axeReadyCue.update(role==='hero'&&heldReadiness?tool:null,readiness.specialReady);
    enemyShadows.update(actors,role==='god'?pan:localPosition,now,{maxCasters:touchEnabled?4:8});
    spellVisual.setTarget(targetPreview());
    spellVisual.update(now,dt);cleaveView.update(performance.now());talentFx.update(dt);emberdewFx.update(dt);
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
    const viewCamera=renderer.xr.isPresenting?renderer.xr.getCamera():camera;viewCamera.getWorldPosition(heroCamera);
    skyCycle.setTrees(siegebirdTrees());skyCycle.update({tick:estimatedTick,seed:snapshot.seed??41,override:snapshot.weather||null,time:now/1000,dt,camera:viewCamera,groundY:heightAt(heroCamera.x,heroCamera.z,snapshot.edits),rts:role==='god'&&!renderer.xr.isPresenting});inventionVisual.setNight(skyCycle.night());
    orchard.update(dt, camera); skyline.update(camera);
    coveHeroes.length=0;if(role==='hero'&&initialized)coveHeroes.push({id:playerId,x:localPosition.x,y:localPosition.y,z:localPosition.z});
    for(const p of snapshot.players||[]){if(p.id===playerId||p.role!=='hero')continue;const at=actors.get('p:'+p.id)?.root.position;if(at)coveHeroes.push({id:p.id,x:at.x,y:at.y,z:at.z});}
    if(scene.fog?.color)coveSky.copy(scene.fog.color);coveSun.copy(sun.position).sub(sun.target.position);
    larimarCove.update(dt,{tick:renderTick,camera:viewCamera,heroes:coveHeroes,night:skyCycle.night?.()??0,sky:coveSky,sunDir:coveSun,detail:touchEnabled?.6:1});
    voiceBadges.update(dt, now / 1000, voiceActivity?.()?.peers, id => actors.get('p:' + id)?.root.position || null, canvas.clientHeight);
    // Update poses during loading, but don't compile new variants in a play frame.
    if(!startup.ready)return;
    if(!renderer.xr.isPresenting){renderBudget.ratio(dt);resizeBuffer();}
    if (SUNNY && (frameCountSunny++ % 30 === 0)) gradeScene(scene);
    // The view kick rides the render only: aim, contact rays and the network pose never see it.
    const punched=role==='hero'&&!renderer.xr.isPresenting&&!manned&&viewPunch.active();let punch=null;
    if(punched){punch=viewPunch.value;camera.rotation.x+=punch[0];camera.rotation.y+=punch[1];camera.rotation.z+=punch[2];camera.updateMatrixWorld();}
    skyCycle.render(scene, camera);
    if(punched){camera.rotation.x-=punch[0];camera.rotation.y-=punch[1];camera.rotation.z-=punch[2];camera.updateMatrixWorld();}
    if (onVoicePose && playerId) {
      // After render, WebXR's viewer camera includes this frame's head pose.
      const earCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
      earCamera.getWorldPosition(earVector);
      const position = acousticPosition({role, xr:renderer.xr.isPresenting, position:earVector.toArray(), focus:[pan.x,heightAt(pan.x,pan.z,snapshot.edits),pan.z]});
      earCamera.getWorldDirection(earVector); const forward = earVector.toArray();
      earVector.set(0,1,0).applyQuaternion(earCamera.getWorldQuaternion(earQuaternion));
      onVoicePose({position, forward, up:earVector.toArray()});
    }
    const frameCpu=performance.now()-frameStarted;
    frameMetrics.record('frameCpu',frameCpu);
    renderBudget.sample(now,intervalMs,frameCpu,active&&!document.hidden&&!renderer.xr.isPresenting);
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
  report('Preparing world assets and materials…');
  void (async()=>{
    const representatives=new THREE.Group(),warmHeroes=[];let treeWarmup,miningWarmup,abilityWarmup,wallWarmup;
    try{
      assetQueue.start();
      await prepareStartup('assets',()=>Promise.all([...assetInstalls,environment.ready]));if(disposed)return;
      await yieldToBrowser();
      // Build the default render-only world before compiling, even in the empty
      // lobby. Do not initialize a player or step/publish this preview state.
      // All initial templates are now installed. Rebuild content once instead
      // of rebuilding trees/deposits after each of dozens of arriving models.
      content.reload();content.sync(snapshot);syncWorldSignals();syncOrchardContent();meadow.sync(snapshot);oreGlint.sync(snapshot);settlementVisual.sync(snapshot);inventionVisual.sync(snapshot);
      // Lobby startup has no roster. Prepare the actual clone/rig variants now,
      // so the first remote players and bot wave don't move compilation to join.
      for(const [i,name] of ['axe','flask'].entries()){
        const data={id:`warm-hero-${i}`,role:'hero',tool:name,hp:100},visual=heroView.create(data,{variant:i%2?'mosswarden':'emberwright'});
        if(visual){const root=new THREE.Group();root.position.set(i*2-6,0,0);root.add(visual);representatives.add(root);heroView.update(visual,data,root,1/60,camera.position);warmHeroes.push(visual);}
        await yieldToBrowser();if(disposed)return;
      }
      for(let i=0;i<6;i++){const visual=instantiate('skeleton',1.7,i);if(visual){visual.position.set(i*2-5,0,-3);representatives.add(visual);}}
      // Allied waves use a distinct stone/brass rig, not the skeleton material set.
      // Compile that exact template before the first populated snapshot reaches the renderer.
      for(let i=0;i<3;i++){const visual=instantiate('forgeling',1.81,i);if(visual){dressForgelingModel(visual,i);visual.position.set(i*2,0,-5);representatives.add(visual);}}
      const sanctuary=createInventionModel('sanctuary');sanctuary.position.set(0,0,-6);representatives.add(sanctuary);
      await yieldToBrowser();if(disposed)return;
      treeWarmup=content.trees.prepareWarmup();representatives.add(treeWarmup.group);startup.treeHarvestWarmup=treeWarmup.stats;
      await yieldToBrowser();if(disposed)return;
      miningWarmup=await content.prepareMiningWarmupAsync(()=>disposed);if(disposed)return;representatives.add(miningWarmup.group);startup.miningWarmup=miningWarmup.stats;
      await yieldToBrowser();if(disposed)return;
      abilityWarmup=createAbilityWarmup(THREE,scene);representatives.add(abilityWarmup.group);startup.abilityWarmup=abilityWarmup.stats;
      wallWarmup=content.crystalWall.prepareWarmup();representatives.add(wallWarmup.group);
      scene.add(representatives);scene.updateMatrixWorld(true);
      skyCycle.prepare(scene);
      startup.phase='shaders';report('Preparing world shaders and textures…');
      // Prepare and draw only the variants the actual play target needs. Desktop
      // uses HDR; compiling/drawing the default framebuffer first doubled world work.
      await prepareStartup('atmosphere',()=>skyCycle.prepareRenderer(scene,camera,async()=>{
      await prepareStartup('spells',()=>spellVisual.prepareShaders(renderer,camera,scene));if(disposed)return;
      await prepareStartup('fire',()=>fireVisual.prepareShaders(renderer,camera,scene));if(disposed)return;
      await prepareStartup('expedition',()=>expedition.prepare(renderer,camera,scene));if(disposed)return;
      startup.shaderVariants={};
      await prepareStartup('worldShaders',()=>compileWorld(renderer,scene,camera,startup.shaderVariants));if(disposed)return;
      const textures=new Set();scene.traverse(object=>{for(const material of [object.material,object.customDepthMaterial,object.customDistanceMaterial].flat())if(material)for(const value of Object.values(material))if(value?.isTexture&&!value.isRenderTargetTexture)textures.add(value);});
      // Small upload batches let the loading interface update between them.
      await prepareStartup('textures',async()=>{for(const texture of textures){if(disposed)return;renderer.initTexture(texture);startup.textureCount++;await yieldToBrowser();}});
      if(disposed)return;
      startup.phase='shadows';
      // compileAsync omits the shadow render pass. Warm both camera families once.
      const warmCamera=camera.clone();warmCamera.position.set(0,48,38);warmCamera.lookAt(0,0,0);
      const warmStarted=performance.now();startup.warmBatches=await warmRender({renderer,scene,camera:warmCamera,cancelled:()=>disposed});if(disposed)return;await yieldToBrowser();startup.warmDrawMs=performance.now()-warmStarted;
      await prepareStartup('finalShaders',()=>renderer.compileAsync(scene,camera));if(disposed)return;
      }));
      // The post pass must output to the restored framebuffer, never read and
      // write its own HDR scene texture during the preparation callback.
      if(disposed)return;
      await prepareStartup('firstWorldFrame',()=>skyCycle.render(scene,camera));
    }catch(error){startup.error=String(error.message||error);report(`Shader preparation incomplete: ${startup.error}. Reload if visuals are missing.`);}
    finally{abilityWarmup?.dispose();wallWarmup?.dispose();treeWarmup?.dispose();miningWarmup?.finish();for(const visual of warmHeroes)heroView.release(visual);representatives.traverse(n=>n.skeleton?.dispose());representatives.removeFromParent();}
    if(disposed)return;startup.initialModels=assetInstalls.length;startup.streamedModels=secondaryInstalls.length;startup.ready=true;startup.phase='ready';startup.readyMs=performance.now()-started;previous=performance.now();api.setActive(requestedActive);
    report(`World renderer ready (${Math.round(startup.readyMs)} ms).`);
    assetQueue.background();
    void Promise.all(secondaryInstalls).then(()=>{startup.secondaryReady=true;startup.completeMs=performance.now()-started;});
  })();
  // Read-only presentation evidence for browser QA (no input, state or credentials).
  Object.defineProperty(canvas, 'brannDiagnostics', {configurable: true, value: () => disposed ? null : api.diagnostics()});
  const api = {
    applySnapshot(next, id) {
      if (disposed) return;
      const syncStarted=performance.now();
      worldMatricesAt=-1;
      const previousSelf=snapshot.players.find(p=>p.id===id), previousRoom=snapshot.room;
      snapshot = { ...next, players: next.players || [], enemies: next.enemies || [], edits: next.edits || [], groves: next.groves || [], pendingStarfalls: next.pendingStarfalls || [] };
      currentTerrainBake=snapshot.terrainBake;terrainSampler.setState({...snapshot,tick:terrainShownTick()});
      if (id !== playerId) feedback.reset();
      playerId = id; snapshotAt = performance.now(); feedback.sync(snapshot, id);
      presentationClock.observe(snapshot.tick||0,snapshotAt,{reset:previousRoom!==snapshot.room});
      const self = snapshot.players.find(player => player.id === playerId);
      if(previousSelf && self?.castTick>previousSelf.castTick && pendingCastPreview){spellVisual.commitTarget(pendingCastPreview);pendingCastPreview=null;}
      if (self) {
        if(!STREAMED_WEAPONS.has(self.tool)||weaponModels.has(self.tool))startup.restoringTool=null;
        if(self.tool && self.tool!==tool&&!weaponSwap.busy){
          if(STREAMED_WEAPONS.has(self.tool)&&!weaponModels.has(self.tool)){
            if(startup.restoringTool!==self.tool){const wanted=self.tool;startup.restoringTool=wanted;assetQueue.prioritize(wanted);
              void assetPromises.get(wanted)?.then(()=>{if(disposed||snapshot.players.find(p=>p.id===playerId)?.tool!==wanted)return;startup.restoringTool=null;if(weaponModels.has(wanted))equipVisual(wanted);});}
          }else {startup.restoringTool=null;equipVisual(self.tool);}
        }
        const authoritative = new THREE.Vector3().fromArray(self.position);
        if (!initialized || authoritative.distanceTo(localPosition) > 4) {
          if(!initialized&&snapshot.battle?.v===2){yaw=Math.atan2(self.position[0],self.position[2]);pitch=0;}
          localPosition.copy(authoritative); correction.set(0, 0, 0); initialized = true;
          verticalSpeed = 0; grounded = authoritative.y <= forgeFloor(authoritative.x,authoritative.z,heightAt(0,0,snapshot.edits),simulationHeight(snapshot,authoritative.x,authoritative.z)) + 0.05;
        }
        else correction.copy(authoritative).sub(localPosition);
        // Grounded height follows the same live terrain function as the server.
        if (grounded) localPosition.y = authoritative.y;
      }
      startingWorld.group.visible=!!snapshot.landmarks;const nextStartingEdits=terrainFrameKey(snapshot.edits,snapshot.tick)+'|'+foundationTerrainKey(snapshot);if(startingEdits!==nextStartingEdits){startingEdits=nextStartingEdits;startingWorld.update();}
      combat.prepareActors(snapshot);rebuildGround(); syncActors(); combat.sync(snapshot,{prepared:true}); syncTrees(); syncWorldSignals();appleSnack.sync(snapshot,playerId);spellVisual.sync(snapshot);fireVisual.sync(snapshot);wyrmStream.sync(snapshot,{localId:playerId,renderTick});syncOrchardContent();meadow.sync(snapshot);oreGlint.sync(snapshot);expedition.applySnapshot(snapshot.adventure,snapshot);settlementVisual.sync(snapshot);inventionVisual.sync(snapshot);stormView.sync(snapshot);
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
    setLook(nextYaw,nextPitch=pitch){if(Number.isFinite(nextYaw))yaw=nextYaw;if(Number.isFinite(nextPitch))pitch=nextPitch;}, // review labs: face a direction
    setTouchEnabled(value) { if (touchEnabled !== !!value) {clearInput(); touchEnabled = !!value; fixedAim = null; aimTerrain = null; cursor.visible = false;} },
    setTouchAxes(side, x, y) {
      if (!active || !touchEnabled || renderer.xr.isPresenting || !touchAxes[side]) return;
      touchAxes[side].x = THREE.MathUtils.clamp(Number.isFinite(x) ? x : 0, side === 'right' ? -2 : -1, side === 'right' ? 2 : 1);
      touchAxes[side].y = THREE.MathUtils.clamp(Number.isFinite(y) ? y : 0, side === 'right' ? -2 : -1, side === 'right' ? 2 : 1);
    },
    lookByPixels(x, y) { lookBy(x * 0.003, y * 0.003); },
    dragonPress(kind, down) { if (active && role === 'hero') dragonRide.press(kind, down); },
    zoomBy(amount) { if (active && role === 'god') orbitRadius = THREE.MathUtils.clamp(orbitRadius + amount, 10, 70); },
    aimAt(x, y) {
      if (active && inventionPlacement) { pinPlacement(x, y); return false; }
      if (!active || role !== 'god') return false;
      camera.updateMatrixWorld(); const hit = pointerHit({clientX:x, clientY:y});
      fixedAim = hit ? hit.point.clone() : null; aimTerrain = null; if(hit)updateTouchAim();else cursor.visible=false; return !!hit;
    },
    touchCastState() { return {line:isLineSpell(),quick:quickCast,revision:castRevision,start:!!castStart}; },
    beginAimLine() { if(active&&role==='god'&&isLineSpell()&&!castStart&&cursor.visible)castStart=hitPoint.clone(); },
    cancelAim() { fixedAim = null; aimTerrain = null; cancelCast(); if (active && role === 'god') updateTouchAim(); },
    castAim() { if (active && role === 'god' && updateTouchAim()) castAt(hitPoint); },
    centerView() { if (active && role === 'god') { pan.copy(localPosition); fixedAim = null; aimTerrain = null; } },
    jump() { if (active && role === 'hero' && !manned) jumpPending = true; },
    // Phones wind the manned Timberline by holding the Wind button (the Jump slot while seated).
    setCrank(down) { crankHeld = !!down && active && role === 'hero'; },
    projectWorld(point){camera.updateMatrixWorld();const p=new THREE.Vector3(...point).project(camera);if(p.z < -1||p.z>1)return null;const r=canvas.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2,viewportWidth:innerWidth,viewportHeight:innerHeight};},
    fireSamples:id=>combat.fireSamples(id),strike, equip, primaryDown,primaryUp,collectAt,tapAt,collectTarget(id){if(active&&role==='hero'&&appleSnack.holding()){unlockAudio();appleSnack.bite();return;}if(active&&role==='hero'&&/:(red|blue)$/.test(id||'')&&nearPlantedPack()){unlockAudio();onAction('stormPickup');return;}if(active&&role==='hero'&&!useInvention(id))onAction('collectTarget',{targetId:id});},grab,release,special,specialPress,cancelSpecialAim:cancelWallAim,weaponState:()=>({tool,aiming,manned:!!manned,mannedVerb:mannedVerb(),scoping,ads:adsAmount,fov:camera.fov,zeroDistance:tool==='crossbow'?30:null,...weapons.state()}),
    useResource(kind){if(active&&role==='hero')onAction('useResource',{kind});},
    beginInventionPlacement,
    interact,
    buildBridge(){if(active&&role==='hero')onAction('buildBridge');},
    inspectWeapon({at}={}){if(Number.isFinite(at)){startInspect();inspect.release();inspect.pin(at);return;}if(inspect.mode()){inspect.cancel();return;}startInspect();inspect.release();},   // phone: toggle (release keeps the turn playing; drags take over)
    inspectState(){return {mode:inspect.mode(),active:inspect.active()};},
    handleEvent,
    setDamageNumbers(enabled){combat.setDamageNumbers(!!enabled);},
    setGraphicsMode(value){const ok=renderBudget.mode(value);if(ok)try{localStorage.setItem('branns-forge.graphics',value);}catch{}return ok;},
    diagnostics(){return {remoteBatches:[...remoteBatches].map(([name,b])=>({name,savedDraws:b.savedDraws})),graphics:{...renderBudget.stats(),bufferWidth:canvas.width,bufferHeight:canvas.height},assetQueue:assetQueue.stats(),readiness:readinessCache.stats(),programs:renderer.info.programs.length,startup:{...startup},stormreel:{...stormView.stats(),...stormWeapon.stats(),lightning:lightning.stats(),spires:inventionVisual.spires.stats()},dragon:dragonRide.stats(),inspect:{mode:inspect.mode(),active:inspect.active(),blocked:inspectBlocked},wyrmspout:wyrmStream.stats(),staff:{...staffFx.stats(),holding:staffFx.holding()},cpuTimings:frameMetrics.stats(),rewards:rewards.stats(),presentationTick:renderTick,creatures:combat.creatureStats(),bottle:bottleFx.stats(),emberdew:{guide:flaskGuide.object.visible,contact:flaskGuide.object.children[1].visible,landings:cinderMarkers.object.visible?cinderMarkers.object.count:0,cinderAim,aiming,forecast:{...flaskForecast},hand:emberdewHand.state(),fx:emberdewFx.stats()},trajectory:trajectoryGuide.object.visible,guideTiming:{...guideTiming},rangedEffects:combat.rangedEffectStats(),terrainGeometry:terrainGeometry.stats(),terrainRay:terrainRay.stats(),terrainSampler:terrainSampler.stats(),mountains:mountainArena.stats(),cornerGround:cornerGround.stats(),backTown:inventionVisual.backTownStats(),townLife:inventionVisual.townLifeStats(),mapExtras:inventionVisual.mapExtrasStats(),alpineForest:alpineForest.stats(),collection:pickupHighlight.stats(),landmarks:startingWorld.stats(),enemyShadows:enemyShadows.stats(),meteorCreatures:meteorCreatures.records.size,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,world:content.stats(),heroes:heroView.stats(),forge:forge.stats(),inventions:inventionVisual.stats(),fire:fireVisual.stats(),effects:spellVisual.stats(),impacts:impacts.stats(),strike:{kind:strikeClock.kind,trail:swingTrail.stats(),punch:[...viewPunch.value],predicted:impactLedger.size},expedition:expedition.stats(),expeditionPanel:(({shown,redraws})=>({shown,redraws}))(adventurePanel.state()),orchard:orchard.stats(),sky:skyCycle.stats(),ents:entView.stats(),stumplings:stumplingView.stats(),meadow:meadow.stats(),oreGlint:oreGlint.stats(),skyline:skyline.stats(),larimarCove:larimarCove.stats(),audio:{contextState:audioContext?.state??null,sampleRate:audioContext?.sampleRate??null,wood:woodAudio?.stats()??null,material:materialAudio?.stats()??null,mix:audioMix?.stats()??null,kit:soundKit?.stats()??null,ambience:ambience?.stats()??null}};},
    clearControls: clearInput,
    // Lobby pushes adventureView() while XR is presenting; null hides. Pointer hand: 'right' (default) or 'left'.
    setExpedition(view, next, id) { if (!disposed) adventurePanel.update(view, next, id); },
    setExpeditionPointerHand(hand) { adventurePanel.setPointerHand(hand); },
    controlsSnapshot() {return {godPan:[pan.x,pan.z],orbit:[orbitYaw,orbitRadius,orbitTilt],pointerRecovery:{resumeCapture,deliberateRelease,wasCaptured},inventionPlacement,manned:manned?{...manned}:null,timberlineAim:manned?{scoping,scope:scopeAmount,fov:camera.fov,forecast:timberlineSight.forecast?{distance:timberlineSight.forecast.distance,time:timberlineSight.forecast.impact?.t??null,points:timberlineSight.forecast.left.length/3}:null,sight:timberlineSight.object.visible,ammoHud:timberlineAmmoHud.element.hidden?null:timberlineAmmoHud.element.textContent}:null,yaw,pitch,orbitYaw,orbitTilt,orbitRadius,pan:pan.toArray(),swingAt,weapon:{tool,aiming,ads:adsAmount,fov:camera.fov,zeroDistance:30,...weapons.state()},castStart:castStart?.toArray()||null,castPoint:cursor.visible?hitPoint.toArray():null};},
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
      requestedActive=!!value;if(!startup.ready)return;
      if(active===!!value)return;
      clearInput(); active = !!value;if(!active)cancelInventionPlacement();
      if (!active && document.pointerLockElement === canvas) document.exitPointerLock();
    },
    dispose() {
      voiceBadges.dispose(); setVoiceZoneResolver('home-taverns', null);
      if (disposed) return;
      clearInput(); active = false; disposed = true;dragonRide.dispose();readinessCache.dispose();pickupHighlight.dispose();mountainArena.dispose();alpineForest.dispose();cornerGround.dispose();
      clearTimeout(zeroInputTimer);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      renderer.setAnimationLoop(null); resizeObserver.disconnect(); removers.forEach(remove => remove());
      renderer.xr.getSession()?.end().catch(() => {});
      mixers.forEach(mixer => mixer.stopAllAction()); settlementVisual.dispose();inventionVisual.dispose();stormWeapon.dispose();stormView.dispose();stormJolt.el?.remove();lightning.dispose();heroView.dispose();
      heldResourceArt.dispose();timberlineSight.dispose();colliderDebug?.dispose();timberlineAmmoHud.dispose();document.body.classList.remove('timberline-manned');rewards.dispose();swingTrail.dispose();skeletonFx.dispose();cleaveView.dispose();talentFx.dispose();emberdewFx.dispose();flaskGuide.dispose();cinderMarkers.dispose();appleSnack.dispose();siegebirdSight?.dispose();bottleFx.dispose();rangedReticle.dispose();blueprintHud.dispose();trajectoryGuide.dispose();document.body.classList.remove('ranged-aim-active');startingWorld.dispose();meteorCreatures.dispose();enemyShadows.dispose();feedback.dispose();adventurePanel.dispose();expedition.dispose();combat.dispose();entView.dispose();stumplingView.dispose();spellVisual.dispose();impacts.dispose();golemFx.dispose();fireVisual.dispose();stopFireAudio();woodAudio?.dispose();woodAudio=null;spellAudio?.dispose();spellAudio=null;materialAudio?.dispose();materialAudio=null;skyCycle.dispose();larimarCove.dispose();orchard.dispose();meadow.dispose();oreGlint.dispose();skyline.dispose();
      waygateView.dispose();beaconView.dispose();
      disposeResources(scene);
      for (const template of templates.values()) disposeResources(template.scene);
      content.dispose();environment.dispose();ambience?.dispose();audioContext?.close();
      for(const batch of remoteBatches.values())batch.dispose();remoteBatches.clear();
      renderer.dispose(); actors.clear(); warnings.clear(); templates.clear(); controllerSources.clear();
    },
  };
  return api;
}

// Synchronous construction is retained for isolated renderer fixtures. The actual
// page uses the cooperative path so input can run between construction stages.
export function createGame(options) {
  const builder=buildGame(options);let step;
  do {step=builder.next();} while(!step.done);
  return step.value;
}
export async function createGameAsync(options) {
  const construction=[],builder=buildGame({...options,construction});let step;
  do {const t=performance.now();step=builder.next();construction.push(performance.now()-t);if(!step.done)await yieldToBrowser();} while(!step.done);
  return step.value;
}
