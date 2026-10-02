import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {swingPose, SWING_PROFILES, idleOffset} from './weapon-motion.js';
import {createWorldContent} from './world-content-view.js';
import {terrainHeight as simulationHeight} from '../shared/simulation.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {prepareAsset, setWeaponGrip, FPS_WEAPON_POSE} from './asset-pose.js';

// Keep in step with the authoritative Godot server surface.
export function terrainHeight(x, z, edits = []) {
  let height = 0.45 * Math.sin(x * 0.09) * Math.cos(z * 0.07);
  for (const edit of edits) {
    const t = THREE.MathUtils.clamp(1 - Math.hypot(x - edit.x, z - edit.z) / Math.max(0.01, edit.radius), 0, 1);
    height += edit.height * t * t * (3 - 2 * t);
  }
  return height;
}

export function createGame({ canvas, onAction = () => {}, onCast = () => {}, onInput = () => {}, onStatus = () => {}, onXRChange = () => {}, onMenu = () => {} }) {
  const started = performance.now();
  let disposed = false, active = false, role = 'hero', spell = 'skeleton', playerId = null;
  let snapshot = { players: [], enemies: [], edits: [], groves: [], pendingStarfalls: [] };
  let yaw = 0, pitch = 0, jumpPending = false, verticalSpeed = 0, grounded = true;
  let previous = performance.now(), sentAt = -Infinity, snapshotAt = 0, initialized = false, swingAt = -Infinity;
  let terrainSignature = '', rightDrag = false, orbitYaw = 0.2, orbitRadius = 38, orbitTilt = 0.9;
  let zeroInputTimer = null;
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
  const textureLoader = new THREE.TextureLoader();
  for (const [file,slot] of [['meadow_albedo','map'],['meadow_normal','normalMap'],['meadow_orm','roughnessMap']]) textureLoader.load(`/assets/${file}.png`, texture => {if(disposed){texture.dispose();return;}texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(40,40);texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());if(slot==='map')texture.colorSpace=THREE.SRGBColorSpace;ground.material[slot]=texture;ground.material.color.setHex(0xffffff);ground.material.normalScale.set(.55,.55);ground.material.needsUpdate=true;});
  const cursor = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.18, 48), new THREE.MeshBasicMaterial({ color: 0xf2c779, side: THREE.DoubleSide, depthWrite: false }));
  cursor.rotation.x = -Math.PI / 2;
  cursor.visible = false;
  scene.add(cursor);
  // The power anchor is a physical strike target at the authoritative shrine point.
  const shrine = new THREE.Group();
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
  weaponAnchor.rotation.fromArray(FPS_WEAPON_POSE.rotation);
  camera.add(weaponAnchor);
  const axePlaceholder = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.05), new THREE.MeshStandardMaterial({ color: 0x67462e }));
  weaponAnchor.add(axePlaceholder);
  const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
  const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
  const controllerSources = new Map();
  for (let i = 0; i < 2; i++) {
    rig.add(controllers[i], grips[i]);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc2a17b }));
    grips[i].add(hand);
    const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -3)]), new THREE.LineBasicMaterial({ color: 0xefcd83, transparent: true, opacity: 0.45 }));
    controllers[i].add(beam);
    listen(controllers[i], 'connected', event => { controllerSources.set(i, event.data); attachWeapon(); });
    listen(controllers[i], 'disconnected', () => { controllerSources.delete(i); attachWeapon(); });
    listen(controllers[i], 'selectstart', () => {
      if (!active) return;
      if (role === 'hero') strike();
      else {
        controllers[i].getWorldPosition(raycaster.ray.origin);
        controllers[i].getWorldQuaternion(poseQuaternion);
        raycaster.ray.direction.set(0, 0, -1).applyQuaternion(poseQuaternion);
        const hit = raycaster.intersectObject(ground)[0];
        if (hit) castAt(hit.point);
      }
    });
  }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  }
  function report(message) { if (!disposed) onStatus(message); }
  const content = createWorldContent({scene,templates,instantiate,height:terrainHeight});
  function attachWeapon() {
    if (!axeModel) return;
    const tracked = [...controllerSources.entries()].filter(([, source]) => source.targetRayMode === 'tracked-pointer');
    const selected = tracked.find(([, source]) => source.handedness === 'right') || tracked[0];
    if (renderer.xr.isPresenting && selected) {
      const [index, source] = selected;
      (source.gripSpace ? grips[index] : controllers[index]).add(axeModel);
      setWeaponGrip(axeModel, true, tool);
    } else {
      weaponAnchor.add(axeModel);
      setWeaponGrip(axeModel, false, tool);
      const socket = axeModel.getObjectByName(tool === 'axe' ? 'CuttingEdge_Mid' : 'PickTipRight');
      if (socket) { axeModel.updateWorldMatrix(true, true); socket.getWorldPosition(weaponTip); weaponAnchor.worldToLocal(weaponTip); }
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
    const positions = groundGeometry.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setY(i, terrainHeight(positions.getX(i), positions.getZ(i), snapshot.edits));
    positions.needsUpdate = true;
    groundGeometry.computeVertexNormals();
    groundGeometry.computeBoundingSphere();
    groundGeometry.computeBoundingBox();
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
    if (template.animations.length && name === 'skeleton') {
      const mixer = new THREE.AnimationMixer(model);
      const idle = template.animations.find(item => /idle/i.test(item.name)) || template.animations[0];
      const walk = template.animations.find(item => /walk/i.test(item.name)) || idle;
      const actions = { idle: mixer.clipAction(idle), walk: mixer.clipAction(walk) };
      for(const name of ['attack','stagger']){const clip=template.animations.find(a=>a.name===name);if(clip){actions[name]=mixer.clipAction(clip);actions[name].setLoop(THREE.LoopOnce,1);actions[name].clampWhenFinished=true;}}
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
    const model = instantiate('skeleton', 1.7);
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
      warning.group.position.set(pending.x, 0, pending.z);
      warning.fill.position.y = terrainHeight(pending.x, pending.z, snapshot.edits) + 0.10;
      warning.impactTick = pending.impactTick;
    }
    for (const [id, warning] of warnings) if (!present.has(id)) {
      scene.remove(warning.group); disposeResources(warning.group); warnings.delete(id);
    }
  }
  const loader = new GLTFLoader();
  for (const name of ['tree', 'tree_b', 'tree_young', 'skeleton', 'axe', 'pick', 'boulder', 'meteor', 'bank', 'ridge', 'roots', 'log', 'endcap', 'cut1', 'cut2', 'chip', 'bridge', 'grass_tuft','meadow_flowers','fern_delicate','leaf_litter','pebble_scatter','mushroom_cluster','fallen_branch','broadleaf_plant','river_stones','root_tangle']) loader.load(`/assets/${name}.glb`, gltf => {
    if (disposed) { disposeResources(gltf.scene); return; }
    templates.set(name, gltf);
    if (name === 'tree') { syncTrees(); }
    if (name === 'skeleton') for (const entry of actors.values()) upgradeActor(entry);
    if (name === 'axe' || name === 'pick') {
      const model = instantiate(name, name === 'axe' ? .7 : .75);weaponModels.set(name,model);
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
  function castAt(point) {
    if (!active || role !== 'god') return;
    const x = THREE.MathUtils.clamp(point.x, -55, 55), z = THREE.MathUtils.clamp(point.z, -55, 55);
    onCast(spell, [x, terrainHeight(x, z, snapshot.edits), z]);
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
  let audioContext=null, effects=null;const fragments=[];let lastSound=0;
  function unlockAudio(){try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')void audioContext.resume();}catch{}}
  function handleEvent(event){
    if(!event?.position)return;
    const kind=event.kind;if(!['hit','wood_hit','stone_hit','tree_fell','ore_break','pickup','build','death'].includes(kind))return;
    if(kind!=='pickup'&&kind!=='build'&&templates.has('chip')){
      if(!effects){let source;templates.get('chip').scene.traverse(c=>{if(c.isMesh&&!source)source=c;});if(source){const geometry=source.geometry.clone();geometry.computeBoundingBox();const size=geometry.boundingBox.getSize(new THREE.Vector3());geometry.center();geometry.scale(.09/Math.max(size.x,size.y,size.z),.09/Math.max(size.x,size.y,size.z),.09/Math.max(size.x,size.y,size.z));effects=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial({roughness:.85}),96);effects.count=0;effects.frustumCulled=false;scene.add(effects);}}
      for(let i=0;i<12&&fragments.length<96;i++){const a=i*2.39996;fragments.push({p:new THREE.Vector3(...event.position),v:new THREE.Vector3(Math.sin(a)*1.3,1+(i%3)*.4,Math.cos(a)*1.3),life:.5+(i%4)*.12,color:new THREE.Color(kind.startsWith('wood')||kind==='tree_fell'?0xbe9360:kind==='hit'||kind==='death'?0xe3ddc4:0xadb4a9)});}
    }
    const now=performance.now();if(audioContext&&now-lastSound>45){lastSound=now;const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type=kind==='stone_hit'?'triangle':'sine';const metallic=kind==='stone_hit'||kind==='ore_break';osc.frequency.setValueAtTime(metallic?1500:kind==='pickup'?660:150,audioContext.currentTime);osc.frequency.exponentialRampToValueAtTime(metallic?650:80,audioContext.currentTime+.13);gain.gain.setValueAtTime(.055,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.18);osc.connect(gain).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+.19);}
    for(const source of controllerSources.values())source.gamepad?.hapticActuators?.[0]?.pulse(.25,35).catch(()=>{});
  }
  function tickEffects(now,dt){if(!effects)return;const temp=new THREE.Object3D();for(let i=fragments.length-1;i>=0;i--){const f=fragments[i];f.life-=dt;if(f.life<=0){fragments.splice(i,1);continue;}f.v.y-=7*dt;f.p.addScaledVector(f.v,dt);temp.position.copy(f.p);temp.rotation.set(now*.002+i,now*.003,0);temp.scale.setScalar(Math.min(1,f.life*5));temp.updateMatrix();effects.setMatrixAt(i,temp.matrix);effects.setColorAt(i,f.color);}effects.count=fragments.length;effects.instanceMatrix.needsUpdate=true;if(effects.instanceColor)effects.instanceColor.needsUpdate=true;}
  function equipVisual(next) {
    const model=weaponModels.get(next);if(!model)return;
    axeModel?.removeFromParent();tool=next;axeModel=model;weaponAnchor.remove(axePlaceholder);attachWeapon();
  }
  function equip(next) {if(!active||role!=='hero'||!['axe','pick'].includes(next))return;swingAt=-Infinity;swingContact=true;onAction('equip',{tool:next});equipVisual(next);}
  function contactRay() {
    camera.updateMatrixWorld(true);
    if(renderer.xr.isPresenting){const idx=[...controllerSources.entries()].find(([,source])=>source.handedness==='right')?.[0]??0;controllers[idx].getWorldPosition(raycaster.ray.origin);controllers[idx].getWorldQuaternion(poseQuaternion);raycaster.ray.direction.set(0,0,-1).applyQuaternion(poseQuaternion);}
    else raycaster.setFromCamera(new THREE.Vector2(0,0),camera);
    raycaster.far=3.2;
    const targets=content.targets().concat([...actors.values()].filter(e=>e.enemy).map(e=>e.root),[shrine,ground]);
    for(const target of targets)target.updateMatrixWorld(true);
    const hit=raycaster.intersectObjects(targets,true).find(h=>!h.object.userData.ignoreContact);raycaster.far=Infinity;
    if(!hit)return null;
    let n=hit.object;while(n&&!n.userData.targetId)n=n.parent;
    if(!n)return null;
    return {targetId:n.userData.targetId,point:hit.point.toArray(),normal:(hit.face?.normal.clone().transformDirection(hit.object.matrixWorld)||new THREE.Vector3(0,1,0)).toArray(),part:hit.object.name,distance:hit.distance};
  }
  function strike() {
    const profile=SWING_PROFILES[tool];
    if (!active || role !== 'hero' || performance.now() - swingAt < profile.cooldown*1000) return;
    swingAt = performance.now();swingContact=false;swingTarget=contactRay();swingReach=THREE.MathUtils.clamp(swingTarget?.distance||2.5,.6,2.8);
    swingRest={position:new THREE.Vector3(...FPS_WEAPON_POSE.position),quaternion:new THREE.Quaternion().setFromEuler(new THREE.Euler(...FPS_WEAPON_POSE.rotation))};
    swingRest.position.x=.33*Math.min(1,camera.aspect/.9);
    unlockAudio();
  }
  function clearInput() {
    swingContact=true; swingAt=-Infinity;
    keys.clear(); jumpPending = false; rightDrag = false; move.set(0, 0, 0);
    for (const axis of Object.values(touchAxes)) { axis.x = 0; axis.y = 0; }
    xrButtons.clear();
    // Repeated cleanup after setActive(false) must retain the queued stop packet.
    if (active) {
      clearTimeout(zeroInputTimer);
      const now = performance.now();
      if (now - sentAt >= 50) sendInput(now, true);
      else zeroInputTimer = setTimeout(() => { if (!disposed) sendInput(performance.now(), true); }, 51 - (now - sentAt));
    }
  }
  listen(window, 'keydown', event => {
    if (!active || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName) || event.target?.isContentEditable) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.code === 'Space' && !event.repeat && role === 'hero') jumpPending = true;
    if (role === 'hero' && !event.repeat) {if(event.code==='Digit1')equip('axe');if(event.code==='Digit2')equip('pick');if(event.code==='KeyE')onAction('interact');if(event.code==='KeyB')onAction('buildBridge');}
    if (role === 'god' && !event.repeat) {
      const quickSpell = {Digit1: 'skeleton', Digit2: 'raise', Digit3: 'grove', Digit4: 'starfall', Digit5:'sunder', Digit6:'wall', Digit7:'ring'}[event.code];
      if (quickSpell) { spell = quickSpell; report(`God spell: ${quickSpell}. Click the ground to cast.`); }
    }
  });
  listen(window, 'keyup', event => keys.delete(event.code));
  listen(window, 'blur', clearInput);
  listen(document, 'visibilitychange', () => { if (document.hidden) clearInput(); });
  listen(document, 'pointerlockchange', () => { if (document.pointerLockElement !== canvas) clearInput(); });
  listen(document, 'pointerlockerror', () => report('Mouse capture was blocked. Click the canvas again, or check browser permissions. Esc releases capture.'));
  listen(canvas, 'contextmenu', event => event.preventDefault());
  listen(canvas, 'pointerdown', event => {
    if (!active || event.pointerType !== 'mouse') return;
    if (role === 'hero') {
      if (document.pointerLockElement !== canvas) { void capturePointer(); return; }
      if (event.button === 0) strike();
    } else {
      if (event.button === 2) rightDrag = true;
      if (event.button === 0) { const hit = pointerHit(event); if (hit) castAt(hit.point); }
    }
  });
  listen(window, 'pointerup', () => { rightDrag = false; });
  listen(window, 'pointermove', event => {
    if (!active || event.pointerType !== 'mouse') return;
    if (role === 'hero' && document.pointerLockElement === canvas) {
      yaw -= event.movementX * 0.0022;
      pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.0022, -1.48, 1.48);
    } else if (role === 'god' && !renderer.xr.isPresenting) {
      if (rightDrag) { orbitYaw -= event.movementX * 0.004; orbitTilt = THREE.MathUtils.clamp(orbitTilt + event.movementY * 0.003, 0.35, 1.35); }
      if (event.target === canvas) { const hit = pointerHit(event); cursor.visible = !!hit; if (hit) cursor.position.copy(hit.point).add(new THREE.Vector3(0, 0.08, 0)); }
    }
  });
  listen(canvas, 'wheel', event => {
    if (active && role === 'god') { event.preventDefault(); orbitRadius = THREE.MathUtils.clamp(orbitRadius + event.deltaY * 0.03, 10, 70); }
  }, { passive: false });
  listen(renderer.xr, 'sessionstart', () => { clearInput(); onXRChange(true); camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0); weaponAnchor.visible = false; attachWeapon(); report('VR connected. Stick to walk; trigger to strike.'); });
  listen(renderer.xr, 'sessionend', () => { clearInput(); onXRChange(false); camera.position.set(0, 1.65, 0); attachWeapon(); resize(); report('VR session ended.'); });

  function movement() {
    const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    const z = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
    let axisX = x + touchAxes.left.x, axisZ = z + touchAxes.left.y;
    if (renderer.xr.isPresenting) {
      const xrCamera = renderer.xr.getCamera();
      xrCamera.getWorldDirection(forward);
      yaw = Math.atan2(-forward.x, -forward.z);
      for (const [index, source] of controllerSources) {
        const pressed = source.gamepad?.buttons[4]?.pressed || false;
        const menu = source.gamepad?.buttons[5]?.pressed || false;
        const previous = xrButtons.get(index) || {};
        if (active && pressed && !previous.jump && role === 'hero') jumpPending = true;
        if (active && menu && !previous.menu) { void renderer.xr.getSession()?.end().then(onMenu); }
        const squeeze=source.gamepad?.buttons[1]?.pressed||false,stick=source.gamepad?.buttons[3]?.pressed||false;
        if(active&&squeeze&&!previous.squeeze&&role==='hero'){if(source.handedness==='left')equip(tool==='axe'?'pick':'axe');else onAction('interact');}
        if(active&&stick&&!previous.stick&&source.handedness==='right'&&role==='hero')onAction('buildBridge');
        xrButtons.set(index, {jump: pressed, menu, squeeze, stick});
      }
      for (const source of controllerSources.values()) if (source.gamepad && source.handedness !== 'right') {
        const axes = source.gamepad.axes;
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
      input.hands = grips.filter((_, i) => controllerSources.has(i)).map(localPose);
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
    sendInput(now);
    // Stop prediction when snapshots stall; server also expires held input at 300ms.
    if (active && role === 'hero' && initialized && now - snapshotAt < 500) {
      localPosition.addScaledVector(move, dt * 5);
      localPosition.x = THREE.MathUtils.clamp(localPosition.x, -55, 55);
      localPosition.z = THREE.MathUtils.clamp(localPosition.z, -55, 55);
      const groundY = simulationHeight(snapshot, localPosition.x, localPosition.z);
      if (!grounded) { verticalSpeed -= 15 * dt; localPosition.y += verticalSpeed * dt; }
      if (grounded || localPosition.y <= groundY) { localPosition.y = groundY; verticalSpeed = 0; grounded = true; }
      const amount = 1 - Math.exp(-dt * 8);
      localPosition.addScaledVector(correction, amount);
      correction.multiplyScalar(1 - amount);
      localPosition.y = Math.max(localPosition.y, groundY);
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
    const profile=SWING_PROFILES[tool],progress=(now-swingAt)/(profile.duration*1000);
    if(progress>=0&&progress<1&&swingRest&&!renderer.xr.isPresenting){const pose=swingPose(tool,progress,swingRest,weaponTip,swingReach);weaponAnchor.position.copy(pose.position);weaponAnchor.quaternion.copy(pose.quaternion);}
    else {weaponAnchor.position.fromArray(FPS_WEAPON_POSE.position).add(idleOffset(now/1000,move.length()));weaponAnchor.position.x*=Math.min(1,camera.aspect/.9);weaponAnchor.rotation.fromArray(FPS_WEAPON_POSE.rotation);}
    if(!swingContact&&progress>=.5){swingContact=true;const hit=contactRay();onAction('strike',hit?{...hit,tool}:{targetId:'miss',point:localPosition.toArray(),normal:[0,1,0],tool});}
    content.tick(now);tickEffects(now,dt);
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
  report(`World renderer ready (${Math.round(performance.now() - started)} ms).`);
  return {
    applySnapshot(next, id) {
      if (disposed) return;
      snapshot = { ...next, players: next.players || [], enemies: next.enemies || [], edits: next.edits || [], groves: next.groves || [], pendingStarfalls: next.pendingStarfalls || [] };
      playerId = id; snapshotAt = performance.now();
      const self = snapshot.players.find(player => player.id === playerId);
      if (self) {
        if(self.tool && self.tool!==tool)equipVisual(self.tool);
        const authoritative = new THREE.Vector3().fromArray(self.position);
        if (!initialized || authoritative.distanceTo(localPosition) > 4) {
          localPosition.copy(authoritative); correction.set(0, 0, 0); initialized = true;
          verticalSpeed = 0; grounded = authoritative.y <= simulationHeight(snapshot, authoritative.x, authoritative.z) + 0.05;
        }
        else correction.copy(authoritative).sub(localPosition);
        // Grounded height follows the same live terrain function as the server.
        if (grounded) localPosition.y = authoritative.y;
      }
      rebuildGround(); syncActors(); syncTrees(); syncWorldSignals();

    },
    setRole(next) {
      if (next !== 'hero' && next !== 'god') return;
      clearInput(); role = next; fixedAim = null; aimTerrain = null; cursor.visible = false; correction.set(0, 0, 0);
      if (role === 'god') { pan.copy(localPosition); if (document.pointerLockElement === canvas) document.exitPointerLock(); }
      report(role === 'god' ? 'God: WASD pan, right-drag orbit, wheel zoom, click to cast.' : 'Hero: click to look, WASD move, Space jump, click strike.');
    },
    setSpell(next) { spell = next; },
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
    cancelAim() { fixedAim = null; aimTerrain = null; if (active && role === 'god') updateTouchAim(); },
    castAim() { if (active && role === 'god' && updateTouchAim()) castAt(hitPoint); },
    centerView() { if (active && role === 'god') { pan.copy(localPosition); fixedAim = null; aimTerrain = null; } },
    jump() { if (active && role === 'hero') jumpPending = true; },
    strike, equip,
    interact(){if(active&&role==='hero')onAction('interact');},
    buildBridge(){if(active&&role==='hero')onAction('buildBridge');},
    handleEvent,
    clearControls: clearInput,
    controlsSnapshot() {return {yaw,pitch,orbitYaw,orbitTilt,orbitRadius,pan:pan.toArray(),swingAt};},
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
      disposeResources(scene);
      for (const template of templates.values()) disposeResources(template.scene);
      content.dispose();environment.dispose();audioContext?.close();
      renderer.dispose(); actors.clear(); warnings.clear(); templates.clear(); controllerSources.clear();
    },
  };
}
