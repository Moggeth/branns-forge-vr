import {SPELLS} from '../shared/spells.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {createWeaponController} from './weapon-controller.js';
import {createContactFeedback} from './contact-feedback.js';
import {createCombatView} from './combat-view.js';
import {createSpellPresentation} from './spell-presentation.js';
import {createImpactPresentation} from './impact-presentation.js';
import {swingPose, SWING_PROFILES, idleOffset} from './weapon-motion.js';
import {createWorldContent} from './world-content-view.js';
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
import {createWoodAudio} from './wood-audio.js';
import {createMaterialAudio} from './material-audio.js';
import {worldTrees} from '../shared/world-content.js';

// Keep in step with the authoritative Godot server surface.
export function terrainHeight(x, z, edits = []) {
  let height = 0.45 * Math.sin(x * 0.09) * Math.cos(z * 0.07);
  for (const edit of edits) {
    const t = THREE.MathUtils.clamp(1 - Math.hypot(x - edit.x, z - edit.z) / Math.max(0.01, edit.radius), 0, 1);
    height += edit.height * t * t * (3 - 2 * t);
  }
  return height;
}

export function createGame({ canvas, onAction = () => {}, onCast = () => {}, onInput = () => {}, onStatus = () => {}, onXRChange = () => {}, onMenu = () => {}, isHost = () => true, onSelection = () => {}, onExpeditionAction = () => {} }) {
  const started = performance.now();
  let disposed = false, active = false, role = 'hero', spell = 'skeleton', playerId = null;
  let snapshot = { players: [], enemies: [], edits: [], groves: [], pendingStarfalls: [] };
  let yaw = 0, pitch = 0, jumpPending = false, verticalSpeed = 0, grounded = true;
  let previous = performance.now(), sentAt = -Infinity, snapshotAt = 0, initialized = false, swingAt = -Infinity;
  let terrainSignature = '', rightDrag = false, orbitYaw = 0.2, orbitRadius = 38, orbitTilt = 0.9;
  let zeroInputTimer = null;
  let castStart=null,quickCast=false,quickKey=null;
  const equipment=['axe','pick','hammer','crossbow','bow','limb','wyrmspout','flask'];
  const spellKeys={Digit1:'skeleton',Digit2:'raise',Digit3:'grove',Digit4:'starfall',Digit5:'sunder',Digit6:'wall',Digit7:'ring',Digit8:'golem',Digit9:'squad',Digit0:'crystal',Minus:'lower',Equal:'heal',Backquote:'lightning',KeyT:'frost'};
  let tool = 'axe', swingContact = false, swingReach = 2.5, swingRest = null, swingTarget = null;
  const weaponModels = new Map(), weaponTip = new THREE.Vector3(0,.5,-.35);
  let axeModel = null, touchEnabled = false, fixedAim = null;
  const touchAxes = {left: {x: 0, y: 0}, right: {x: 0, y: 0}};
  const xrButtons = new Map();
  const aimCamera = new THREE.Matrix4();
  let aimTerrain = null;
  const keys = new Set(), removers = [], actors = new Map(), templates = new Map(), warnings = new Map();
  const mixers = new Set(), localPosition = new THREE.Vector3(0, 0, 8), correction = new THREE.Vector3();
  const pan = new THREE.Vector3(), move = new THREE.Vector3(), forward = new THREE.Vector3();
  const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster(), hitPoint = new THREE.Vector3();
  const posePosition = new THREE.Vector3(), poseQuaternion = new THREE.Quaternion(), poseScale = new THREE.Vector3();
  const scene = new THREE.Scene();
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
  const orchard = createOrchardPresentation({scene, renderer, ground, sun, camera, height: (x, z) => terrainHeight(x, z, snapshot.edits),
    quality: globalThis.matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high', edits: snapshot.edits});
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
  shrine.add(shrineBase);
  const shrineCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.48),
    new THREE.MeshStandardMaterial({ color: 0x69dddb, emissive: 0x2a8c98, emissiveIntensity: 1.2, metalness: 0.35 }));
  shrineCore.position.y = 1.2;
  shrine.add(shrineCore);
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
  const weaponAnchor = new THREE.Group();
  weaponAnchor.position.fromArray(FPS_WEAPON_POSE.position);
  weaponAnchor.rotation.fromArray(['bow','crossbow','wyrmspout','flask'].includes(tool)?[0,0,tool==='bow'?-.08:0]:FPS_WEAPON_POSE.rotation);
  camera.add(weaponAnchor);
  const axePlaceholder = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.05), new THREE.MeshStandardMaterial({ color: 0x67462e }));
  weaponAnchor.add(axePlaceholder);
  const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
  const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
  const controllerSources = new Map();
  // Haptics only for local contacts/releases/damage, on the hand that actually holds the weapon (by handedness).
  let weaponHand = null;
  const feedback = createContactFeedback({sources: () => controllerSources.values(), playerId: () => playerId, tool: () => tool, weaponHand: () => weaponHand, presenting: () => renderer.xr.isPresenting});
  function contactMaterial(id) {
    const enemy = (snapshot.enemies || []).find(e => e.id === id); if (enemy) return enemy.kind === 'golem' ? 'stone' : 'bone';
    if ((snapshot.deposits || []).some(d => d.id === id)) return 'stone';
    if (id === 'shrine') return 'metal';
    return worldTrees(snapshot).some(t => t.id === id) ? 'wood' : 'earth';
  }
  // Hero Expedition panel above the off-hand wrist. Trigger presses aimed at it are consumed before weapons see them.
  const adventurePanel = createVRAdventurePanel({parent: scene, controllers, grips, sources: controllerSources, onAction: action => onExpeditionAction(action)});
  // Each trigger press belongs to whoever took its selectstart (panel, weapon, special, throw or cast); selectend and
  // controller loss return to that owner, so a release can never be dropped or fire with another hand/tool.
  const presses = createPressRouter();
  const holdingLoose = () => [...(snapshot.detachedParts||[]),...(snapshot.looseLogs||[])].some(p=>p.heldBy===playerId);
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
    listen(controllers[i], 'selectstart', () => {
      if (active) unlockAudio();
      if (adventurePanel.handleSelectStart(i)) { presses.begin(i, 'panel'); return; }
      if (!active) return;
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
  const content = createWorldContent({scene,templates,instantiate,height:terrainHeight,camera});
  const enemyGround=(x,z)=>terrainHeight(x,z,snapshot.edits);
  const combat=createCombatView({scene,templates,actors,height:(x,z)=>terrainHeight(x,z,snapshot.edits),worldContact, onContact:hit=>{if(isHost())onAction('projectileHit',hit);}});
  const expedition=createExpeditionPresentation({scene,height:(x,z)=>terrainHeight(x,z,snapshot.edits)});
  const fireVisual=createFirePresentation({scene,height:(x,z)=>terrainHeight(x,z,snapshot.edits)});
  const flaskModel=createEmberdewModel();templates.set('flask',{scene:flaskModel,animations:[]});weaponModels.set('flask',flaskModel);
  const spellVisual=createSpellPresentation({scene,tickSeconds:1/60,height:(x,z)=>terrainHeight(x,z,snapshot.edits)});
  const weapons=createWeaponController({getTool:()=>tool,getAim:projectileAim,getDraw:()=>{if(!renderer.xr.isPresenting)return null;let left,right;for(const [i,source] of controllerSources){if(source.handedness==='left')left=grips[i];if(source.handedness==='right')right=grips[i];}return left&&right?THREE.MathUtils.clamp((left.getWorldPosition(new THREE.Vector3()).distanceTo(right.getWorldPosition(new THREE.Vector3()))-.08)/.65,0,1):null;},fire:details=>{unlockAudio();feedback.release(tool);onAction('fire',details);},emitFlame:details=>{unlockAudio();onAction('flame',details);},pourFuel:details=>{unlockAudio();onAction('pour',details);},canFlame:()=>{const p=snapshot.players.find(p=>p.id===playerId);return !!p&&(p.overheatUntil||0)<=(snapshot.tick||0)&&p.hp>0;},special:()=>{const aim=weaponAim();const point=new THREE.Vector3(...aim.origin).addScaledVector(new THREE.Vector3(...aim.direction),3);point.y=terrainHeight(point.x,point.z,snapshot.edits);onAction('special',{point:point.toArray()});}});
  function attachWeapon() {
    if (!axeModel) return;
    const tracked = [...controllerSources.entries()].filter(([, source]) => source.targetRayMode === 'tracked-pointer');
    const selected = tracked.find(([, source]) => source.handedness === (tool==='bow'?'left':'right')) || tracked[0];
    if (renderer.xr.isPresenting && selected) {
      const [index, source] = selected;
      weaponHand = source.handedness;
      (source.gripSpace ? grips[index] : controllers[index]).add(axeModel);
      setWeaponGrip(axeModel, true, tool);
    } else {
      weaponHand = null;
      weaponAnchor.add(axeModel);
      setWeaponGrip(axeModel, false, tool);
      modelTip(axeModel,tool,weaponTip); weaponAnchor.worldToLocal(weaponTip);
    }
  }
  async function capturePointer() {
    try {
      if (!canvas.requestPointerLock) throw new Error('Mouse capture is unavailable in this browser.');
      await canvas.requestPointerLock();
    } catch (error) {
      report(`Mouse capture failed: ${error.message || 'browser permission denied'}. Click the canvas again; Esc releases it.`);
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
    const signature = JSON.stringify(snapshot.edits);
    if (signature === terrainSignature) return;
    terrainSignature = signature;
    fireVisual.invalidateTerrain();
    const positions = groundGeometry.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setY(i, terrainHeight(positions.getX(i), positions.getZ(i), snapshot.edits));
    positions.needsUpdate = true;
    groundGeometry.computeVertexNormals();
    groundGeometry.computeBoundingSphere();
    groundGeometry.computeBoundingBox();
    orchard.groundChanged({edits: snapshot.edits}); // edit-only rebake of the disturbed-earth channel; slope soil/stone follows the new normals
  }
  // Stone/canopy channels follow the world's tree set (seed + groves) and live deposits. A full mask bake measured
  // 0.3-0.75 s in headless SwiftShader; ecosystem changes now rebuild in bounded frame slices, never per chop.
  function syncOrchardContent() {
    const trees = worldTrees(snapshot), deposits = Array.isArray(snapshot.deposits) ? snapshot.deposits : null;
    const key = snapshot.seed + ':' + (snapshot.groves || []).map(g => g.id).join() + '|' + (deposits || []).map(d => d.id + (d.depleted ? '-' : '')).join();
    if (key === orchardContentKey) return; orchardContentKey = key;
    orchard.groundChanged(deposits ? {trees, deposits} : {trees});
  }
  function basicActor(enemy, god) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: enemy ? 0xd2c4a4 : god ? 0xb4a5dd : 0x579ca6, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.75, 4, 8), material);
    body.position.y = 0.9;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), material);
    head.position.y = 1.62;
    group.add(head);
    const hands = [0, 1].map(i => {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), material);
      hand.position.set(i ? 0.33 : -0.33, 1.05, -0.1);
      group.add(hand);
      return hand;
    });
    group.userData = { head, hands, placeholder: true };
    return group;
  }
  function instantiate(name, height) {
    const template = templates.get(name);
    if (!template) return null;
    const {visual: wrapper, model} = prepareAsset(template, name, height);
    if (template.animations.length && (name === 'skeleton'||name==='golem')) {
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
  function upgradeActor(entry) {
    if (!entry.enemy || !entry.visual.userData.placeholder) return;
    const model = instantiate(entry.data.kind==='golem'?'golem':'skeleton',entry.data.kind==='golem'?2.8:1.7);
    if (!model) return;
    entry.root.remove(entry.visual);
    disposePlaceholder(entry.visual);
    entry.visual = model;
    entry.root.add(model);
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
      upgradeActor(entry);
      if (!enemy) {
        const { head, hands } = entry.visual.userData;
        head.material.color.setHex(data.role === 'god' ? 0xb4a5dd : 0x579ca6);
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
      scene.remove(entry.root);
      if (entry.visual.userData.mixer) {
        const mixer = entry.visual.userData.mixer;
        mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); mixers.delete(mixer);
      }
      entry.visual.traverse(child => child.skeleton?.dispose());
      disposePlaceholder(entry.visual);
      actors.delete(key);
    }
  }
  function syncTrees() { content.sync(snapshot); }
  function syncWorldSignals() {
    const anchor = snapshot.shrine;
    shrine.visible = !!anchor;
    if (anchor) {
      shrine.position.set(anchor.position[0], terrainHeight(anchor.position[0], anchor.position[2], snapshot.edits), anchor.position[2]);
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
          vertices.push(x - pending.x, terrainHeight(x, z, snapshot.edits) + 0.14, z - pending.z);
        }
        warning.ring.geometry.dispose();
        warning.ring.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        warning.fill.geometry.dispose();
        warning.fill.geometry = new THREE.CircleGeometry(pending.radius, 64);
      }
      warning.group.visible=false; // Specialist spell presentation owns meteor warnings.
      warning.group.position.set(pending.x, 0, pending.z);
      warning.fill.position.y = terrainHeight(pending.x, pending.z, snapshot.edits) + 0.10;
      warning.impactTick = pending.impactTick;
    }
    for (const [id, warning] of warnings) if (!present.has(id)) {
      scene.remove(warning.group); disposeResources(warning.group); warnings.delete(id);
    }
  }
  const loader = new GLTFLoader();
  for (const name of ['forge','forge_lod']) loader.load(`/assets/${name}.glb`, gltf => {
    if(disposed){disposeResources(gltf.scene);return;}
    forge.install(gltf,name==='forge_lod');orchard.enableShadowCasting(gltf.scene);
    shrineBase.visible=false;shrineCore.visible=false;
    shrineBarBack.position.y=3.3;shrineBar.position.y=3.3;
    syncWorldSignals();
  },undefined,()=>report('Could not load the forge; reload to retry.'));
  for (const name of ['tree', 'tree_b', 'tree_young', 'tree_lod', 'tree_b_lod', 'tree_young_lod', 'star_gem', 'stone_chunk', 'orchard_apple', 'skeleton', 'axe', 'pick', 'hammer','crossbow','bow','wyrmspout','arrow','wings','golem', 'boulder', 'meteor', 'bank', 'ridge', 'roots', 'log', 'endcap', 'cut1', 'cut2', 'chip', 'bridge', 'grass_tuft','meadow_flowers','fern_delicate','leaf_litter','pebble_scatter','mushroom_cluster','fallen_branch','broadleaf_plant','river_stones','root_tangle']) loader.load(`/assets/${name}.glb`, gltf => {
    if (disposed) { disposeResources(gltf.scene); return; }
    if (name === 'skeleton' || name === 'golem') orchard.enableShadowCasting(gltf.scene); // bounded casters: actors + forge only, never ground props
    templates.set(name, gltf);
    // Meteor materials otherwise compile for the first time during impact.
    // Prepare the loaded asset against the real lighting without adding it to the world.
    if (name === 'meteor') renderer.compileAsync(gltf.scene, camera, scene).catch(error => {
      if (!disposed) report(`Meteor shader preparation: ${error.message}`);
    });
    if (name === 'tree') { syncTrees(); }
    if (name === 'skeleton'||name==='golem') for (const entry of actors.values()) upgradeActor(entry);
    if (['axe','pick','hammer','crossbow','bow','wyrmspout'].includes(name)) {
      const model = instantiate(name, ({axe:.7,pick:.75,hammer:.95,crossbow:.48,bow:1.25,wyrmspout:.4})[name]);weaponModels.set(name,model);
      if (name === tool) equipVisual(tool);
    } else content.reload();
  }, undefined, () => report(`Could not load ${name} model; reconnect or reload to retry.`));

  function pointerHit(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(ground)[0];
    if (hit) hitPoint.copy(hit.point);
    return hit;
  }
  function isLineSpell(){return spell==='sunder'||spell==='wall';}
  function cancelCast() { castStart = null; quickKey = null; }
  function castAt(point,finish=false) {
    if (!active || role !== 'god') return;
    const x = THREE.MathUtils.clamp(point.x, -55, 55), z = THREE.MathUtils.clamp(point.z, -55, 55);
    const at=[x,terrainHeight(x,z,snapshot.edits),z];
    if(isLineSpell()&&!castStart&&!finish){castStart=new THREE.Vector3(...at);report('Choose the end of the line, then release / Cast again.');return;}
    const extra=castStart?{start:castStart.toArray(),end:at}:{};onCast(spell,at,extra);castStart=null;quickKey=null;
  }
  function lookBy(dx, dy) {
    if (!active || renderer.xr.isPresenting) return;
    if (role === 'hero') { yaw -= dx; pitch = THREE.MathUtils.clamp(pitch - dy, -1.48, 1.48); }
    else { orbitYaw -= dx; orbitTilt = THREE.MathUtils.clamp(orbitTilt + dy, 0.35, 1.35); }
  }
  function updateTouchAim() {
    if (fixedAim) { hitPoint.copy(fixedAim); hitPoint.y = terrainHeight(hitPoint.x, hitPoint.z, snapshot.edits); cursor.visible = true; }
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
  const impacts=createImpactPresentation({scene,camera,height:(x,z)=>terrainHeight(x,z,snapshot.edits)});
  let audioContext=null;let lastSound=0;let woodAudio=null;let materialAudio=null;
  // Wood kit shares this one context (bounded 16-voice pool); it is created only inside the existing gesture unlock.
  const ear={position:[0,0,0],forward:[0,0,-1],up:[0,1,0]},earVector=new THREE.Vector3(),earQuaternion=new THREE.Quaternion();
  function listenerPose(){camera.getWorldPosition(earVector);earVector.toArray(ear.position);camera.getWorldDirection(earVector);earVector.toArray(ear.forward);earVector.set(0,1,0).applyQuaternion(camera.getWorldQuaternion(earQuaternion)).toArray(ear.up);return ear;}
  function unlockAudio(){try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')void audioContext.resume();woodAudio??=createWoodAudio({context:audioContext,baseUrl:'/assets/wood-audio/'});woodAudio.unlock();materialAudio??=createMaterialAudio({context:audioContext});materialAudio.unlock();}catch{}}
  // Reuse the native authored flame loop. One quiet source per local weapon,
  // never one source per packet; gain ramps prevent clicks on trigger release.
  let flameBuffer=null,flameLoading=false,flameSource=null,flameGain=null;
  function updateFireAudio(firing){
    if(!audioContext)return;
    if(firing&&!flameBuffer&&!flameLoading){flameLoading=true;fetch('/assets/wyrmspout-flame.wav').then(r=>{if(!r.ok)throw Error('Flame audio unavailable');return r.arrayBuffer();}).then(b=>audioContext.decodeAudioData(b)).then(b=>{if(!disposed)flameBuffer=b;}).catch(()=>{});}
    if(firing&&flameBuffer&&!flameSource){flameSource=audioContext.createBufferSource();flameSource.buffer=flameBuffer;flameSource.loop=true;flameGain=audioContext.createGain();flameGain.gain.value=0;flameSource.connect(flameGain).connect(audioContext.destination);flameSource.start();}
    if(flameGain)flameGain.gain.setTargetAtTime(firing?.16:0,audioContext.currentTime,.045);
  }
  function stopFireAudio(){if(flameSource){flameSource.stop();flameSource.disconnect();flameGain.disconnect();flameSource=null;flameGain=null;}}
  function handleEvent(event){
    feedback.handleEvent(event);
    expedition.handleEvent(event);
    if((event?.kind==='hit'||event?.kind==='headshot')&&event.id!==undefined){const a=actors.get(`e:${event.id}`);if(a)noteEnemyHit(a,event);}
    if(!event?.position||event.fire)return;
    const woodSound=!!woodAudio?.handles(event);if(woodSound)woodAudio.play(event,listenerPose());
    const materialSound=!!materialAudio?.handles(event);if(materialSound)materialAudio.play(event,listenerPose(),snapshot.tick);
    if(event.kind==='spell')spellVisual.play(event);
    const specialEffect={hammer_slam:'raise',pick_burst:'crystal',axe_cleave:'sunder'}[event.kind];if(specialEffect)spellVisual.play({...event,kind:'spell',spell:specialEffect});
    const kind=event.kind;if(!['hit','wood_hit','stone_hit','tree_fell','ore_break','pickup','build','death','headshot','shoot','detach','shockwave','embed','hammer_slam','pick_burst','axe_cleave'].includes(kind))return;
    const material=event.material||(kind==='wood_hit'?'wood':kind==='stone_hit'||kind==='ore_break'?'stone':event.id==='shrine'?'metal':'bone');
    const isImpact=['hit','headshot','wood_hit','stone_hit'].includes(kind)||(kind==='embed'&&event.impact);
    if(isImpact){let seed=event.tick??snapshot.tick??0;for(const char of String(event.id||''))seed=(Math.imul(seed,31)+char.charCodeAt(0))|0;impacts.emit({material,position:event.position,normal:event.normal||[0,1,0],energy:event.energy||1,seed});}
    const now=performance.now();if(audioContext&&!woodSound&&!materialSound&&!(kind==='embed'&&!event.impact)&&now-lastSound>45){lastSound=now;const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type=kind==='stone_hit'?'triangle':'sine';const metallic=material==='stone'||material==='metal';osc.frequency.setValueAtTime(metallic?1500:kind==='hammer_slam'?70:kind==='shoot'?280:kind==='pickup'?660:150,audioContext.currentTime);osc.frequency.exponentialRampToValueAtTime(metallic?650:80,audioContext.currentTime+.13);gain.gain.setValueAtTime(.055,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.18);osc.connect(gain).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+.19);}
  }
  function equipVisual(next) {
    if(next!==tool)feedback.reset();
    if(next==='limb'){axeModel?.removeFromParent();axeModel=null;tool=next;return;}
    const model=weaponModels.get(next);if(!model)return;
    axeModel?.removeFromParent();tool=next;axeModel=model;weaponAnchor.remove(axePlaceholder);attachWeapon();
  }
  function equip(next) {if(!active||role!=='hero'||!equipment.includes(next))return;weapons.cancel();presses.invalidate();swingAt=-Infinity;swingContact=true;onAction('equip',{tool:next});equipVisual(next);}
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
    if(!renderer.xr.isPresenting){const target=new THREE.Vector3(...aim.origin).addScaledVector(new THREE.Vector3(...aim.direction),40);aim.direction=target.sub(origin).normalize().toArray();}
    if(renderer.xr.isPresenting)aim.direction=weaponForward(axeModel,tool,new THREE.Vector3()).toArray();
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
    const targets=[...content.targets(),ground,shrine];for(const target of targets)target.updateWorldMatrix(true,true);
    const hit=ray.intersectObjects(targets,true).find(h=>surfaceVisible(h.object));
    if(!hit)return null;const normal=hitNormal(hit);
    return {targetId:'world',part:'torso',point:hit.point.toArray(),normal:normal.toArray(),localPoint:hit.point.toArray(),localQuaternion:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),delta).toArray(),distance:hit.distance};
  }
  let lastPhysicalTip=null,lastPhysicalHit=-Infinity;
  function tickPhysicalMelee(now,dt){
    if(!renderer.xr.isPresenting||!active||role!=='hero'||!axeModel||!['axe','pick','hammer'].includes(tool)){lastPhysicalTip=null;return;}
    const tip=modelTip(axeModel,tool,new THREE.Vector3());
    if(lastPhysicalTip){const travel=tip.distanceTo(lastPhysicalTip);if(travel>.018&&travel<1&&travel/Math.max(dt,.001)>1.15&&now-lastPhysicalHit>(SWING_PROFILES[tool]?.cooldown||.5)*1000){
      const from=lastPhysicalTip.toArray(),to=tip.toArray(),enemy=combat.segmentContacts(from,to)[0],world=worldContact(from,to);let hit=enemy;
      if(world&&(!enemy||world.distance<enemy.distance)){const ray=new THREE.Raycaster(lastPhysicalTip,tip.clone().sub(lastPhysicalTip).normalize(),0,travel);const h=ray.intersectObjects(content.targets().concat([shrine]),true).find(v=>surfaceVisible(v.object));if(h){const r=resolveHit(h);hit=r?{...world,...r}:null;}else hit=null;}
      if(hit){lastPhysicalHit=now;unlockAudio();feedback.contact({...hit,tool,material:contactMaterial(hit.targetId),speed:travel/Math.max(dt,.001),direction:tip.clone().sub(lastPhysicalTip).toArray()});onAction('strike',{...hit,tool});}
    }}lastPhysicalTip=tip;
  }
  function contactRay(){
    const aim=weaponAim(),from=new THREE.Vector3(...aim.origin),direction=new THREE.Vector3(...aim.direction),to=from.clone().addScaledVector(direction,3.2);
    const enemies=combat.segmentContacts(from.toArray(),to.toArray())||[];
    raycaster.set(from,direction);raycaster.far=3.2;const targets=content.targets().concat([shrine,ground]);for(const t of targets)t.updateMatrixWorld(true);
    const hits=raycaster.intersectObjects(targets,true).filter(h=>surfaceVisible(h.object));raycaster.far=Infinity;
    const enemy=enemies[0],world=hits[0],enemyDistance=enemy?from.distanceTo(new THREE.Vector3(...enemy.point)):Infinity;
    if(enemyDistance<(world?.distance??Infinity))return {...enemy,distance:enemyDistance};
    if(!world)return null;const resolved=resolveHit(world);if(!resolved)return null;
    return{...resolved,part:'torso',distance:world.distance};
  }
  function primaryDown(){if(!active||role!=='hero')return;unlockAudio();if(!weapons.begin()){if(renderer.xr.isPresenting)weapons.special();else strike();}}
  function primaryUp(){if(active&&role==='hero')weapons.end();}
  function grab(pressIndex){if(!active||role!=='hero')return;const aim=weaponAim(pressIndex);const id=content.grabTarget?.(aim.origin,aim.direction,3)||combat.grabTarget?.(aim.origin,aim.direction,3);if(id)onAction('grab',{id});else onAction('interact');}
  function release(throwIt=false,pressIndex){if(active&&role==='hero')onAction('release',{throw:throwIt,direction:weaponAim(pressIndex).direction});}
  function strike() {
    if(['crossbow','bow','wyrmspout','flask'].includes(tool)){primaryDown();return;}
    const profile=SWING_PROFILES[tool]||SWING_PROFILES.axe;
    if (!active || role !== 'hero' || performance.now() - swingAt < profile.cooldown*1000) return;
    swingAt = performance.now();swingContact=false;swingTarget=contactRay();swingReach=THREE.MathUtils.clamp(swingTarget?.distance||2.5,.6,2.8);
    swingRest={position:new THREE.Vector3(...FPS_WEAPON_POSE.position),quaternion:new THREE.Quaternion().setFromEuler(new THREE.Euler(...FPS_WEAPON_POSE.rotation))};
    swingRest.position.x=.33*Math.min(1,camera.aspect/.9);
    unlockAudio();
  }
  function clearInput() {
    weapons.cancel();feedback.reset();updateFireAudio(false);castStart=null;quickKey=null;
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
  // Prime both sound banks on the first game gesture, before the first physical impact.
  listen(window, 'pointerdown', () => { if (active) unlockAudio(); });
  listen(window, 'keydown', event => {
    if (!active || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName) || event.target?.isContentEditable) return;
    unlockAudio();
    if (role === 'god' && event.code === 'Escape') { cancelCast(); return; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.code === 'Space' && !event.repeat && role === 'hero') jumpPending = true;
    if (role === 'hero' && !event.repeat) {const slot=Number(event.code.replace('Digit',''))-1;if(slot>=0&&slot<equipment.length)equip(equipment[slot]);if(event.code==='KeyE')onAction('interact');if(event.code==='KeyB')onAction('buildBridge');if(event.code==='KeyF')grab();if(event.code==='KeyG')release();if(event.code==='KeyX')release(true);if(event.code==='KeyQ')weapons.special();}
    if(role==='god'&&!event.repeat&&spellKeys[event.code]){spell=spellKeys[event.code];onSelection(spell);castStart=null;if(quickCast&&cursor.visible){quickKey=event.code;if(isLineSpell())castStart=hitPoint.clone();else castAt(hitPoint);}}
  });
  listen(window,'keyup',event=>{
    keys.delete(event.code);
    if(event.code===quickKey){
      if(castStart&&active&&role==='god'&&cursor.visible)castAt(hitPoint,true);
      else cancelCast();
    }
  });
  listen(window, 'blur', clearInput);
  listen(document, 'visibilitychange', () => { if (document.hidden) clearInput(); });
  listen(document, 'pointerlockchange', () => { if (document.pointerLockElement !== canvas) clearInput(); });
  listen(document, 'pointerlockerror', () => report('Mouse capture was blocked. Click the canvas again, or check browser permissions. Esc releases capture.'));
  listen(canvas, 'contextmenu', event => event.preventDefault());
  listen(canvas, 'pointerdown', event => {
    if (!active || event.pointerType !== 'mouse') return;
    if (role === 'hero') {
      if (document.pointerLockElement !== canvas) { void capturePointer(); return; }
      if (event.button === 0) primaryDown();if(event.button===2)weapons.special();
    } else {
      if (event.button === 2) { cancelCast(); rightDrag = true; }
      if (event.button === 0 && !quickKey) { const hit = pointerHit(event); if (hit) castAt(hit.point); }
    }
  });
  listen(window,'pointerup',event=>{
    rightDrag=false;
    if(event.button===0){
      if(role==='hero')primaryUp();
      else if(castStart&&!touchEnabled&&!quickKey){
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
          else if (action === 'interact') onAction('interact');
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
    if (!active || document.hidden) move.set(0, 0, 0);
  }
  function localPose(object) {
    object.updateWorldMatrix(true, false);
    object.matrixWorld.decompose(posePosition, poseQuaternion, poseScale);
    posePosition.sub(rig.position);
    return { position: posePosition.toArray(), quaternion: poseQuaternion.toArray() };
  }
  function sendInput(now, zero = false) {
    if ((!active && !zero) || now - sentAt < 50) return;
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
    if (disposed) return;
    const dt = Math.min((now - previous) / 1000, 0.05);
    previous = now;
    if (active && !renderer.xr.isPresenting) {
      lookBy(touchAxes.right.x * dt * 2.1, touchAxes.right.y * dt * 1.6);
    }
    movement();
    if (renderer.xr.isPresenting) adventurePanel.tick(renderer.xr.getCamera(), {suppressed: !active || role !== 'hero'});
    sendInput(now);
    // Stop prediction when snapshots stall; server also expires held input at 300ms.
    if (active && role === 'hero' && initialized && now - snapshotAt < 500) {
      localPosition.addScaledVector(move, dt * 5);
      localPosition.x = THREE.MathUtils.clamp(localPosition.x, -55, 55);
      localPosition.z = THREE.MathUtils.clamp(localPosition.z, -55, 55);
      const forgeY=terrainHeight(0,0,snapshot.edits);
      const groundY = forgeFloor(localPosition.x,localPosition.z,forgeY,simulationHeight(snapshot, localPosition.x, localPosition.z));
      if (!grounded) { verticalSpeed -= 15 * dt; localPosition.y += verticalSpeed * dt; }
      if (!grounded && localPosition.y <= groundY && verticalSpeed < -4) orchard.contact(localPosition.x, localPosition.z, {strength: 1.5}); // landing dust (presentation only)
      if (grounded || localPosition.y <= groundY) { localPosition.y = groundY; verticalSpeed = 0; grounded = true; }
      if (grounded && (stepDistance += move.length() * dt * 5) > .75) { stepDistance = 0; orchard.contact(localPosition.x, localPosition.z, {strength: .6}); }
      const amount = 1 - Math.exp(-dt * 8);
      localPosition.addScaledVector(correction, amount);
      correction.multiplyScalar(1 - amount);
      localPosition.y = Math.max(localPosition.y, groundY);
      localPosition.fromArray(resolveForge(localPosition.toArray(),forgeY));
    }
    if (role === 'god' && !renderer.xr.isPresenting) {
      pan.addScaledVector(move, dt * 18);
      pan.x = THREE.MathUtils.clamp(pan.x, -45, 45); pan.z = THREE.MathUtils.clamp(pan.z, -45, 45);
      rig.position.set(0, 0, 0);
      camera.position.set(pan.x + Math.sin(orbitYaw) * orbitRadius * Math.cos(orbitTilt), terrainHeight(pan.x, pan.z, snapshot.edits) + orbitRadius * Math.sin(orbitTilt) + 3, pan.z + Math.cos(orbitYaw) * orbitRadius * Math.cos(orbitTilt));
      camera.lookAt(pan.x, terrainHeight(pan.x, pan.z, snapshot.edits), pan.z);
    } else {
      rig.position.copy(localPosition);
      if (!renderer.xr.isPresenting) { camera.position.set(0, 1.65, 0); camera.rotation.set(pitch, yaw, 0, 'YXZ'); }
    }
    if (touchEnabled && role === 'god' && active && !renderer.xr.isPresenting) updateTouchAim();
    weaponAnchor.visible = role === 'hero' && !renderer.xr.isPresenting && active;
    if (axeModel) axeModel.visible = role === 'hero' && active;
    const profile=SWING_PROFILES[tool]||SWING_PROFILES.axe,progress=(now-swingAt)/(profile.duration*1000);
    if(progress>=0&&progress<1&&swingRest&&!renderer.xr.isPresenting){const pose=swingPose(tool,progress,swingRest,weaponTip,swingReach);weaponAnchor.position.copy(pose.position);weaponAnchor.quaternion.copy(pose.quaternion);}
    else {weaponAnchor.position.fromArray(tool==='bow'?[-.25,-.32,-.48]:['crossbow','wyrmspout','flask'].includes(tool)?[.24,-.3,-.48]:FPS_WEAPON_POSE.position).add(idleOffset(now/1000,move.length()));weaponAnchor.position.x*=Math.min(1,camera.aspect/.9);weaponAnchor.rotation.fromArray(['bow','crossbow','wyrmspout','flask'].includes(tool)?[0,0,tool==='bow'?-.08:0]:FPS_WEAPON_POSE.rotation);}
    if(!swingContact&&progress>=.5){swingContact=true;const hit=contactRay();onAction('strike',hit?{...hit,tool}:{targetId:'miss',point:localPosition.toArray(),normal:[0,1,0],tool});}
    if(axeModel)updateWeaponPresentation(axeModel,tool,{...weapons.state(),time:now/1000,templates});
    weapons.tick();const weaponState=weapons.state();feedback.draw(weaponState);updateFireAudio(weaponState.firing);
    const wick=axeModel?.getObjectByName('Wick');if(tool==='flask'&&wick?.material){const lit=!!snapshot.players.find(p=>p.id===playerId)?.flaskLit;wick.material.emissive?.setHex(lit?0xff5a04:0);wick.material.emissiveIntensity=lit?2:0;}
    content.tick(now,(snapshot.tick||0)+Math.min(3,Math.max(0,now-snapshotAt)*.06));impacts.update(dt);fireVisual.update(now,dt);expedition.update(now,dt,camera);woodAudio?.tick(listenerPose());materialAudio?.tick(listenerPose());
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
    }
    for (const mixer of mixers) mixer.update(dt);
    // Enemy motion polish (opus-enemy-character): after clips, before contacts, so hits see the final pose.
    updateEnemyMotion(actors,{tick:(snapshot.tick||0)+Math.min(0.3,(now-snapshotAt)/1000)*60,dt,height:enemyGround});
    tickPhysicalMelee(now,dt);
    combat.tick(dt,isHost());
    spellVisual.setTarget(active&&role==='god'&&cursor.visible?{spell,point:hitPoint.toArray(),start:castStart?.toArray(),end:castStart?hitPoint.toArray():undefined,valid:Math.abs(hitPoint.x)<=55&&Math.abs(hitPoint.z)<=55&&(snapshot.players.find(p=>p.id===playerId)?.mana??100)>=(SPELLS.find(s=>s.id===spell)?.cost??0)}:null);
    spellVisual.update(now,dt);
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
    orchard.update(dt, camera);
    renderer.render(scene, camera);
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
      snapshot = { ...next, players: next.players || [], enemies: next.enemies || [], edits: next.edits || [], groves: next.groves || [], pendingStarfalls: next.pendingStarfalls || [] };
      if (id !== playerId) feedback.reset();
      playerId = id; snapshotAt = performance.now(); feedback.sync(snapshot, id);
      const self = snapshot.players.find(player => player.id === playerId);
      if (self) {
        if(self.tool && self.tool!==tool)equipVisual(self.tool);
        const authoritative = new THREE.Vector3().fromArray(self.position);
        if (!initialized || authoritative.distanceTo(localPosition) > 4) {
          localPosition.copy(authoritative); correction.set(0, 0, 0); initialized = true;
          verticalSpeed = 0; grounded = authoritative.y <= forgeFloor(authoritative.x,authoritative.z,terrainHeight(0,0,snapshot.edits),simulationHeight(snapshot,authoritative.x,authoritative.z)) + 0.05;
        }
        else correction.copy(authoritative).sub(localPosition);
        // Grounded height follows the same live terrain function as the server.
        if (grounded) localPosition.y = authoritative.y;
      }
      combat.sync(snapshot);rebuildGround(); syncActors(); combat.sync(snapshot); syncTrees(); syncWorldSignals();spellVisual.sync(snapshot);fireVisual.sync(snapshot);syncOrchardContent();expedition.applySnapshot(snapshot.adventure,snapshot);

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
      fixedAim = hit ? hit.point.clone() : null; aimTerrain = null; updateTouchAim(); return !!hit;
    },
    cancelAim() { fixedAim = null; aimTerrain = null; castStart=null;quickKey=null; if (active && role === 'god') updateTouchAim(); },
    castAim() { if (active && role === 'god' && updateTouchAim()) castAt(hitPoint); },
    centerView() { if (active && role === 'god') { pan.copy(localPosition); fixedAim = null; aimTerrain = null; } },
    jump() { if (active && role === 'hero') jumpPending = true; },
    strike, equip, primaryDown,primaryUp,grab,release,special(){if(active&&role==='hero')weapons.special();},weaponState:()=>({tool,...weapons.state()}),
    interact(){if(active&&role==='hero')onAction('interact');},
    buildBridge(){if(active&&role==='hero')onAction('buildBridge');},
    handleEvent,
    diagnostics(){return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,world:content.stats(),forge:forge.stats(),fire:fireVisual.stats(),effects:spellVisual.stats(),impacts:impacts.stats(),expedition:expedition.stats(),expeditionPanel:(({shown,redraws})=>({shown,redraws}))(adventurePanel.state()),orchard:orchard.stats(),audio:{contextState:audioContext?.state??null,sampleRate:audioContext?.sampleRate??null,wood:woodAudio?.stats()??null,material:materialAudio?.stats()??null}};},
    clearControls: clearInput,
    // Lobby pushes adventureView() while XR is presenting; null hides. Pointer hand: 'right' (default) or 'left'.
    setExpedition(view, next, id) { if (!disposed) adventurePanel.update(view, next, id); },
    setExpeditionPointerHand(hand) { adventurePanel.setPointerHand(hand); },
    controlsSnapshot() {return {yaw,pitch,orbitYaw,orbitTilt,orbitRadius,pan:pan.toArray(),swingAt,weapon:{tool,...weapons.state()},castStart:castStart?.toArray()||null};},
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
      clearInput(); active = !!value;
      if (!active && document.pointerLockElement === canvas) document.exitPointerLock();
    },
    dispose() {
      if (disposed) return;
      clearInput(); active = false; disposed = true;
      clearTimeout(zeroInputTimer);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      renderer.setAnimationLoop(null); resizeObserver.disconnect(); removers.forEach(remove => remove());
      renderer.xr.getSession()?.end().catch(() => {});
      mixers.forEach(mixer => mixer.stopAllAction());
      feedback.dispose();adventurePanel.dispose();expedition.dispose();combat.dispose();spellVisual.dispose();impacts.dispose();fireVisual.dispose();stopFireAudio();woodAudio?.dispose();woodAudio=null;materialAudio?.dispose();materialAudio=null;orchard.dispose();
      disposeResources(scene);
      for (const template of templates.values()) disposeResources(template.scene);
      content.dispose();environment.dispose();audioContext?.close();
      renderer.dispose(); actors.clear(); warnings.clear(); templates.clear(); controllerSources.clear();
    },
  };
  return api;
}
