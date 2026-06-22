import * as THREE from 'three';
import { Assets } from './world/Assets.js';
import { ChunkManager } from './world/ChunkManager.js';
import { Interiors } from './world/Interiors.js';
import { Interactables } from './world/Interactables.js';
import { Player } from './player/Player.js';
import { Controls } from './player/Controls.js';
import { TouchControls } from './ui/TouchControls.js';
import { ThirdPersonCamera } from './player/ThirdPersonCamera.js';
import { HUD } from './ui/HUD.js';
import { CombatHUD } from './ui/CombatHUD.js';
import { AudioManager } from './audio/AudioManager.js';
import { PowerManager } from './powers/PowerManager.js';
import { NPCManager } from './world/NPCManager.js';
import { DragonManager } from './world/DragonManager.js';
import { BirdManager } from './world/BirdManager.js';
import { MountSystem } from './world/MountSystem.js';
import { DecorManager } from './world/DecorManager.js';
import { ArenaManager } from './world/ArenaManager.js';
import { NatureManager } from './world/NatureManager.js';
import { EnemyManager } from './entities/EnemyManager.js';
import { BossManager } from './entities/BossManager.js';
import { MissionManager } from './missions/MissionManager.js';
import { MissionHUD } from './ui/MissionHUD.js';
import { WorldMap } from './ui/WorldMap.js';
import { ActionHUD } from './ui/ActionHUD.js';
import { Progression } from './progression/Progression.js';
import { SkillTreeUI } from './ui/SkillTreeUI.js';
import { MissionLogHUD } from './ui/MissionLogHUD.js';
import { Screens } from './ui/Screens.js';
import { SaveManager } from './save/SaveManager.js';
import { SaveLoadUI } from './ui/SaveLoadUI.js';
import { TextureLibrary } from './assets/Textures.js';
import { ModelLibrary, MODEL_SPECS } from './characters/ModelLibrary.js';
import { groundHeightAt, PALETTE, STRUCTURES } from './world/WorldConfig.js';
import { regionAt, regionByKey } from './world/Regions.js';
import { lerp, clamp, damp } from './utils/math.js';

// Day & night look-up — the world smoothly lerps between these.
const SUNSET = {
  sky: new THREE.Color(0xf0a778),
  fog: new THREE.Color(0xf3b489),
  sun: new THREE.Color(0xffd9a0),
  sunInt: 2.0,
  hemiSky: new THREE.Color(0xffd9b0),
  hemiGround: new THREE.Color(0x6b5a3a),
  hemiInt: 0.7,
  ambient: 0.35,
  sunPos: new THREE.Vector3(-40, 26, 18),
};
const NIGHT = {
  sky: new THREE.Color(0x0e1430),
  fog: new THREE.Color(0x121a36),
  sun: new THREE.Color(0x8298d8),
  sunInt: 0.35,
  hemiSky: new THREE.Color(0x2a3552),
  hemiGround: new THREE.Color(0x10131a),
  hemiInt: 0.35,
  ambient: 0.18,
  sunPos: new THREE.Vector3(30, 30, -20),
};

const PETAL_COUNT = 480;
const PETAL_R = 42;
const PETAL_H = 30;

export class Game {
  constructor(appEl, hudEl) {
    this.appEl = appEl;
    this.hudEl = hudEl;
    this.state = 'loading';
    this.interiorObj = null;
    this.returnPos = null;
    this.timeOfDay = 0; // 0 day(sunset) → 1 night
    this.targetTOD = 0;
    this.autoCycle = true; // automatic day↔night cycle (toggle with L)
    this.dayPhase = 0; // 0..1 position in the full day→night→day loop
    this.dayLength = 150; // seconds for one full cycle (~75s day + ~75s night)
    this._tmpEuler = new THREE.Euler();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpVec = new THREE.Vector3();
    this._tmpScale = new THREE.Vector3(1, 1, 1);
    this._tmpMat = new THREE.Matrix4();
    this.elapsed = 0;
  }

  async init() {
    // --- renderer ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.appEl.appendChild(this.renderer.domElement);

    // --- camera ---
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

    // --- world scene + lighting ---
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SUNSET.fog.getHex(), 35, 135);
    this._setupLights();
    this._buildPetals();

    // --- subsystems ---
    this.hud = new HUD(this.hudEl);
    this.audio = new AudioManager();
    this.player = new Player();
    this.scene.add(this.player.mesh);
    this.controls = new Controls(this.renderer.domElement);
    // ?touch=1 forces the on-screen controller (preview phone view on desktop)
    const forceTouch = typeof location !== 'undefined' && /[?&]touch=1\b/.test(location.search);
    this.isTouch = forceTouch || Controls.isTouchDevice();
    this.controls.setTouchMode(this.isTouch); // phones: simulate pointer-lock, drive input via the touch overlay
    this.tpsCamera = new ThirdPersonCamera(this.camera);
    this.chunks = new ChunkManager(this.scene);
    this.interact = new Interactables();

    // --- gameplay systems: powers, NPCs, sky dragons, combat feedback ---
    this.npcs = new NPCManager(this.scene);
    this.dragons = new DragonManager(this.scene);
    this.powers = new PowerManager(this.scene, this);
    this.combatHUD = new CombatHUD();
    // NPCs report damage numbers through the CombatHUD and emit burn particles
    // through the powers' shared ParticlePool.
    this.npcs.setEffects({ combatHUD: this.combatHUD, particles: this.powers.particles });

    // --- enemies, boss, missions/XP, mission HUD, world map ---
    this.enemies = new EnemyManager(this.scene);
    this.bossMgr = new BossManager(this.scene);
    this.missions = new MissionManager();
    this.missionHUD = new MissionHUD();
    this.worldMap = new WorldMap();
    this._region = 'japan';

    this.enemies.setHooks({
      combatHUD: this.combatHUD,
      particles: this.powers.particles,
      onKill: (regionKey, xp) => this.missions.onEnemyKilled(regionKey, xp),
    });
    this.npcs.setAllies(2, this.enemies); // two villagers fight alongside you
    this.powers.setAllySource(this.npcs); // Summon Allies (V) calls fighters from the villager pool
    this.arenas = new ArenaManager(this.scene, this); // combat arenas: horde + power surge + golden aura
    this.bossMgr.setHooks({
      combatHUD: this.combatHUD,
      particles: this.powers.particles,
      lights: this.powers.lights,
      enemies: this.enemies,
      onBossKilled: (regionKey, xp) => this.missions.onBossKilled(regionKey, xp),
    });
    this.missions.onToast = (t, ms) => this.hud.toast(t, ms);
    this.missions.onLevelUp = (lvl) => {
      this.player.maxHp += 15;
      this.player.heal(45);
      this.powers.maxMana += 8;
      this.progression.grantPoints(1); // a skill point to spend in the Skill Tree (K)
      this.hud.toast(`Level ${lvl}! +1 skill point — press K`, 2800);
    };
    this.player.onHurt = () => this.missionHUD.flashDamage();
    this.player.onDeath = () => this._onPlayerDeath();
    this.worldMap.onFastTravel = (x, z, key) => this._fastTravel(x, z, key);

    // --- Wave-5: unified ActionHUD (vitals + abilities + weapon) ---
    this.actionHUD = new ActionHUD(this.powers.powers);
    this.powers.setHUD(this.actionHUD); // PowerManager now drives the ActionHUD
    this.actionHUD.onSelect = (i) => this.powers.setActive(i); // tap a power slot (touch) to select it

    // --- Wave-8: progression (skill points) + skill tree + spells ---
    this.progression = new Progression();
    this.powers.setProgression(this.progression); // upgrades + spell unlocks
    this.skillTree = new SkillTreeUI(this.progression);
    this.missionLog = new MissionLogHUD();
    this.screens = new Screens();
    this._lives = 3;
    this._won = false;
    this.screens.onBegin = () => {
      this.audio.start();
      this.screens.hide();
      this.state = 'playing';
      this.hud.toast('Your saga begins — find the mission waypoint ★', 3200);
      this.controls.requestLock();
    };
    this.screens.onContinue = () => { this.screens.hide(); this.state = 'playing'; this.controls.requestLock(); };
    this.screens.onRestart = () => { if (typeof location !== 'undefined') location.reload(); };

    // --- Wave-9: named save slots (localStorage + JSON import/export) ---
    this.saveMgr = new SaveManager();
    this.saveUI = new SaveLoadUI();
    this.saveUI.onSave = (name) => { if (this.saveMgr.save(name, this._serialize())) { this.hud.toast(`Saved "${name}"`, 1800); this.saveUI.refresh(this.saveMgr.list()); } };
    this.saveUI.onLoad = (name) => { const s = this.saveMgr.load(name); if (s) { this._applyState(s); this._closeSaves(true); this.hud.toast(`Loaded "${name}"`, 1800); } };
    this.saveUI.onDelete = (name) => { this.saveMgr.delete(name); this.saveUI.refresh(this.saveMgr.list()); };
    this.saveUI.onExport = (name) => this._exportSave(name);
    this.saveUI.onImport = (json) => { const n = this.saveMgr.importJSON(json); if (n) { this.saveUI.refresh(this.saveMgr.list()); this.hud.toast(`Imported "${n}"`, 1800); } };
    this.hud.onSaves = () => this._openSaves();
    this.screens.onLoad = () => this._openSaves();
    this.missions.onCheckpoint = () => this._autosave();

    // sword damage fans out to every combat system (same interface as powers).
    // Sword calls hitSink(point, dir, radius, amount, knock, type).
    this.player.sword.hitSink = (point, dir, radius, amount, knock, type) => {
      for (const t of [this.npcs, this.enemies, this.bossMgr])
        if (t && t.damageArea) t.damageArea(point, radius, amount, type, dir, knock);
    };
    this.player.sword.setParticles(this.powers.particles);
    this.player.sword.onSwing = (name) => this.audio?.sfx?.(name);
    this.player.sword.onHitFx = () => this.audio?.sfx?.('swordhit');
    this.player.shield.onBreak = () => { this.actionHUD.flashShieldBreak(); this.audio?.sfx?.('shieldbreak'); };
    this.player.dash.onDash = () => this.audio?.sfx?.('dash');
    this.player.onParry = () => {
      this.audio?.sfx?.('parry');
      this.powers.particles.burst({ x: this.player.pos.x, y: this.player.pos.y + 1.2, z: this.player.pos.z }, 14, { speed: 7, spread: 1, life: 0.4, color: 0xffe07a, gravity: 1 });
    };

    // --- real textures (CORS CDN, graceful fallback to procedural) ---
    this.textures = new TextureLibrary().load();
    Assets.useTextures(this.textures); // terrain map+bump, building bump, water normal+roughness
    // upgrade the bright powers to REAL threejs.org sprites (spark1 / circle);
    // graceful — they keep their procedural sprite if the CDN is unavailable
    this.textures.onReady('spark', (t) => {
      this.powers.setElementTexture('lightning', t);
      this.powers.setElementTexture('atomic', t);
      this.powers.setElementTexture('fry', t);
    });
    this.textures.onReady('circle', (t) => this.powers.setElementTexture('water', t));
    // fabric/skin bump on the player + every creature (graceful: skipped if offline)
    this.textures.onReady('detail', (t) => {
      this.player.applyDetail(t);
      this.npcs.applyDetail(t);
      this.enemies.applyDetail(t);
      this.bossMgr.applyDetail(t);
    });

    // --- real glTF character models (avatar skins, NPCs, boss) — graceful
    //     fallback to the procedural meshes if a model can't be fetched ---
    this.models = new ModelLibrary(this.renderer);
    this.player.setModelLibrary(this.models); // loads the default avatar skin
    this.npcs.setModelLibrary(this.models); // varied real models on the villagers
    this.enemies.setModelLibrary(this.models); // real monster models per archetype
    this.bossMgr.setModelLibrary(this.models); // big textured boss model
    this.birds3d = new BirdManager(this.scene, this.models); // real animated birds (Flamingo/Parrot/Stork)
    this.dragons.setModelLibrary(this.models); // real 3D dragon (DragonAttenuation.glb), billboard fallback
    this.decor = new DecorManager(this.scene, this.models); // example landmarks (Littlest Tokyo + OBJ statue)
    this.nature = new NatureManager(this.scene, this.models); // real trees + flowers (graceful)
    this.mountSys = new MountSystem(this.player, this.models); // horse (G) + flying roc (H)
    this.mountSys.onMount = (k) => {
      this.audio?.sfx?.('dash');
      this.hud.toast(k ? `Mounted — ${k === 'roc' ? 'flying roc (H)' : 'horse (G)'}` : 'Dismounted', 1600);
    };

    // spawn just south of the plaza, facing north up the shrine approach
    this.player.setPosition(0, groundHeightAt(0, 6) + 0.1, 6);
    this.player.setFacing(0); // mesh forward = -Z (north)
    this.tpsCamera.setYaw(0); // camera sits behind, also looking -Z

    this._wireInput();
    // On phones / tablets, build the on-screen controller. It feeds the same
    // Controls instance, so the rest of the game is untouched.
    if (this.isTouch) {
      this.touch = new TouchControls(this.controls, this);
      document.body.classList.add('ym-touch');
    }
    this._applyDayNight(0, true);

    await this._preloadWorld();
    this.enemies.resetAround(this.player.pos.x, this.player.pos.z);

    window.addEventListener('resize', () => this._onResize());
    this.hud.finishLoading();
    this.state = 'start'; // demo flow: start screen → play → win
    this.screens.showStart();
    // ?play=1 skips the menu and drops straight into the world (dev / preview)
    if (typeof location !== 'undefined' && /[?&]play=1\b/.test(location.search)) {
      this.audio.start();
      this.screens.hide();
      this.state = 'playing';
      this.controls.requestLock();
    }
  }

  _setupLights() {
    this.hemi = new THREE.HemisphereLight(SUNSET.hemiSky, SUNSET.hemiGround, SUNSET.hemiInt);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, SUNSET.ambient);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(SUNSET.sun, SUNSET.sunInt);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.near = 1;
    c.far = 160;
    c.left = -45;
    c.right = 45;
    c.top = 45;
    c.bottom = -45;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  _buildPetals() {
    const geo = new THREE.PlaneGeometry(0.22, 0.14);
    const mat = new THREE.MeshBasicMaterial({
      color: PALETTE.sakuraPink,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: true,
    });
    this._petalMat = mat;
    this._petalGeo = geo;
    const mesh = new THREE.InstancedMesh(geo, mat, PETAL_COUNT);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.petals = mesh;
    this.scene.add(mesh);

    this._petalData = [];
    for (let i = 0; i < PETAL_COUNT; i++) {
      this._petalData.push({
        x: (Math.random() * 2 - 1) * PETAL_R,
        y: Math.random() * PETAL_H,
        z: (Math.random() * 2 - 1) * PETAL_R,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 2,
        phase: Math.random() * Math.PI * 2,
        fall: 1.2 + Math.random() * 1.4,
        sway: 0.4 + Math.random() * 0.6,
      });
    }
  }

  _wireInput() {
    this.controls.onPointerUnlock = () => {
      if (this.state === 'playing') this._pause();
      else if (this.state === 'interior') this._exitInterior();
    };
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      this.audio.start();
      if (this.state === 'paused') this._resume();
      else if (this.state === 'playing' || this.state === 'interior') this.controls.requestLock();
    });

    this.hud.onResume = () => this._resume();
    this.hud.onToggleDay = () => this._toggleDay();
    this.hud.onToggleMute = () => {
      const muted = this.audio.toggleMute();
      this.hud.toast(muted ? 'Sound off' : 'Sound on', 1200);
    };
  }

  async _preloadWorld() {
    // Build the initial resident chunks before revealing the world.
    let iterations = 0;
    this.chunks.update(this.player.pos.x, this.player.pos.z, 30);
    const total = this.chunks.queue.length + this.chunks.chunks.size;
    while (this.chunks.queue.length > 0 && iterations < 60) {
      this.chunks.update(this.player.pos.x, this.player.pos.z, 30);
      const done = this.chunks.chunks.size;
      this.hud.setProgress(clamp(done / total, 0, 1), `Building the village… ${done}/${total} chunks`);
      iterations++;
      await new Promise((r) => requestAnimationFrame(r));
    }
    // snap player onto the ground now that the world exists
    this.player.pos.y = groundHeightAt(this.player.pos.x, this.player.pos.z);
    this.player.mesh.position.copy(this.player.pos);
    this.hud.setProgress(1, 'Ready');
  }

  // =================================================================
  //  Main per-frame update
  // =================================================================
  update(dt) {
    this.elapsed += dt;
    // automatic day↔night cycle: advance the phase while the world is live and
    // drive the target time-of-day along a smooth cosine (0 day → 1 night → 0)
    if (this.autoCycle && (this.state === 'playing' || this.state === 'interior')) {
      this.dayPhase = (this.dayPhase + dt / this.dayLength) % 1;
      this.targetTOD = 0.5 - 0.5 * Math.cos(this.dayPhase * Math.PI * 2);
    }
    // smooth day/night transition
    if (this.timeOfDay !== this.targetTOD) {
      this.timeOfDay = damp(this.timeOfDay, this.targetTOD, 1.2, dt);
      if (Math.abs(this.timeOfDay - this.targetTOD) < 0.002) this.timeOfDay = this.targetTOD;
      this._applyDayNight(this.timeOfDay);
    }

    if (this.state === 'playing') this._updatePlaying(dt);
    else if (this.state === 'interior') this._updateInterior(dt);
    else if (this.state === 'map') this._updateMap(dt);
    else if (this.state === 'skilltree') this._updateSkillTree(dt);
    else if (this.state === 'saves') this._updateSaves(dt);
    else if (this.state === 'dead') this._updateDead(dt);
    // 'paused' and 'transition' render a frozen frame

    // Touch overlay is live only while actually playing (hidden in menus,
    // map, pause, death, etc. so it never covers those screens).
    if (this.touch) this.touch.setVisible(this.state === 'playing' || this.state === 'interior');

    this._render();
  }

  _updatePlaying(dt) {
    this.controls.pollGamepad();
    const colliders = this.chunks.getColliders();

    this.tpsCamera.update(dt, this.controls, this.player.pos, colliders);
    this.player.update(dt, this.controls, this.tpsCamera, colliders);
    this.chunks.update(this.player.pos.x, this.player.pos.z, 5);
    // pull the camera back as flight speed rises / while mounted
    this.tpsCamera.distanceTarget = 6.2 + this.player.flightSpeed01 * 5 + (this.player.mounted ? 3 : 0);

    // interactions
    const trig = this.interact.update(this.player.pos, this.chunks.getTriggers());
    if (trig) this.hud.showPrompt(trig.label);
    else this.hud.clearPrompt();

    // E is contextual: interact when something's in range, else cast the power
    if (this.controls.consume('KeyE')) {
      if (trig) this._onInteract(trig);
      else this.powers.pulse();
    }
    // flight toggles (F or double-tap Space) only here → never indoors/paused
    if (this.controls.consume('KeyF') || this.controls.consumeFlightToggle()) this.player.toggleFlight();
    // sword draw/sheath, shield toggle, dash, block (Wave-5 abilities)
    if (this.controls.consume('KeyR')) this.player.toggleSword();
    if (this.controls.consume('KeyT')) {
      const name = this.player.cycleAvatar();
      if (name) this.hud.toast('Avatar: ' + (MODEL_SPECS[name] ? MODEL_SPECS[name].label : name), 1600);
    }
    if (this.controls.consume('KeyQ')) {
      const wasUp = this.player.shield.active;
      this.player.shield.toggle(this.player.stamina);
      if (this.player.shield.active && !wasUp) this.audio?.sfx?.('shield');
    }
    const dd = this.controls.consumeDash();
    if (dd) this.player.tryDash(dd.f, dd.r, this.tpsCamera);
    if (this.controls.consume('KeyG')) this.mountSys.toggle('horse'); // ground mount
    if (this.controls.consume('KeyH')) this.mountSys.toggle('roc'); // flying mount
    this.player.sword.setBlocking(this.player.combatMode && this.controls.rmbDown);
    // when the sword is drawn, left-click swings (consumes the mouse edge so the
    // power system — told meleeMode below — won't also cast)
    if (this.player.combatMode && this.controls.consumeMouse()) this.player.swordSwing();
    if (this.controls.consume('Escape')) this._pause();
    if (this.controls.consume('KeyM')) this._openMap();
    if (this.controls.consume('KeyK')) this._openSkillTree();
    if (this.controls.consume('KeyJ')) this.missionLog.toggle();
    if (this.controls.consume('KeyO')) this._openSaves();
    if (this.controls.consume('Backquote')) this.hud.toggleDebug();
    if (this.controls.consume('KeyL')) this._toggleDay();

    this._updatePetals(dt);
    this._updateSun();

    // animate the river's normal map for moving ripples (if loaded)
    const wn = Assets.mat.water.normalMap;
    if (wn) { wn.offset.x += dt * 0.03; wn.offset.y += dt * 0.015; }
    Assets.tickFoliage(dt); // advance the tree/grass wind sway

    // which country are we standing in?
    this._region = regionAt(this.player.pos.x, this.player.pos.z).key;

    // --- gameplay systems ---
    this.npcs.update(dt, this.player.pos, colliders);
    this.enemies.update(dt, this.player, colliders);
    this.enemies.respawnDead(this.player.pos.x, this.player.pos.z);

    // spawn the region boss once the player reaches its arena with the mission up
    if (this.missions.bossMissionActive(this._region) && !this.bossMgr.active &&
        this.missions.nearArena(this.player.pos, this._region)) {
      if (this.bossMgr.spawn(this._region)) this.missions.onBossSpawned(this._region);
    }
    this.bossMgr.update(dt, this.player);

    this.dragons.update(dt, this.camera, this.player.pos);
    this.birds3d.update(dt, this.camera, this.player.pos);
    this.mountSys.update(dt);
    this.decor.update(dt); // animate landmark assets (Littlest Tokyo)
    this.arenas.update(dt); // arena horde + power surge + golden aura (before powers.update so the buff applies this frame)
    this.powers.update(dt, {
      player: this.player,
      camera: this.camera,
      controls: this.controls,
      colliders,
      targets: [this.npcs, this.enemies, this.bossMgr],
      meleeMode: this.player.combatMode, // sword drawn → left-mouse is the swing
    });
    this.combatHUD.update(dt, this.camera);

    // camera FOV widen + screen speed-lines at top speed / dash / flight
    const flat = Math.hypot(this.player.vel.x, this.player.vel.z);
    let fov = 60;
    if (this.player.dash.active) fov = 80;
    else if (flat > 6.5) fov = 68;
    else if (this.player.flightSpeed01 > 0.4) fov = 60 + this.player.flightSpeed01 * 12;
    this.camera.fov = damp(this.camera.fov, fov, 6, dt);
    this.camera.updateProjectionMatrix();
    this.actionHUD.setSpeed(this.player.dash.active ? 1 : Math.max(flat / 9, this.player.flightSpeed01));
    this.actionHUD.setVitals({
      hpFrac: this.player.hp / this.player.maxHp,
      staminaFrac: this.player.stamina.frac,
      shieldFrac: this.player.shield.frac,
      shieldActive: this.player.shield.active,
      shieldBroken: this.player.shield.broken,
      dashReady: this.player.dash.ready,
      weaponDrawn: this.player.combatMode,
      blocking: this.player.sword.blocking,
    });

    // missions + progression HUD + waypoint
    this.missions.update(dt, this.player.pos, this._region);
    this.missionHUD.render(this.missions.hudState(this._region));
    this.missionHUD.update(dt, this.camera, this.player.pos);
    if (this.missionLog.visible) this.missionLog.render(this.missions.getLog());
    if (!this._won && this.missions.allBossesDone()) { this._won = true; this._win(); }

    // HUD
    this.hud.drawMinimap(this.player.pos.x, this.player.pos.z, this.player.facing);
    this.hud.setMapLabel(this._locationName());
    this.hud.setStreaming(this.chunks.stats.pending);
    this._updateDebug();
  }

  _updateInterior(dt) {
    this.controls.pollGamepad();
    const colliders = this.interiorObj.colliders;
    this.tpsCamera.update(dt, this.controls, this.player.pos, colliders);
    this.player.update(dt, this.controls, this.tpsCamera, colliders);

    const trig = this.interact.update(this.player.pos, this.interiorObj.getTriggers());
    if (trig) this.hud.showPrompt(trig.label);
    else this.hud.clearPrompt();

    if (this.controls.consume('KeyE') && trig && trig.kind === 'exit') this._exitInterior();
    if (this.controls.consume('Escape')) this._exitInterior();
    if (this.controls.consume('Backquote')) this.hud.toggleDebug();
    this._updateDebug();
  }

  _onInteract(trig) {
    if (trig.kind === 'door') this._enterInterior(trig);
    else if (trig.kind === 'sign') this.hud.toast(this._signText(trig), 3000);
  }

  _signText(trig) {
    const map = { '大和村': '「大和村」 — Welcome to Yamato Village', '神社 →': '「神社」 — Shrine this way →' };
    return map[trig.text] || trig.text;
  }

  // =================================================================
  //  Enter / exit buildings
  // =================================================================
  async _enterInterior(trig) {
    if (this.state !== 'playing') return;
    this.state = 'transition';
    this.powers.stopActive(); // stop any held beam before the world is suspended
    this.bossMgr.despawn(); // drop any in-progress boss fight (mission stays open)
    this.actionHUD.hideOverlays();
    this.mountSys.dismount();
    this.player.flying = false; // never remain in flight inside an interior
    this.controls.exitLock();
    this.hud.clearPrompt();
    this.returnPos = { x: trig.x, z: trig.z, yaw: trig.yaw };

    await this.hud.fade(true);

    // free the streamed world entirely
    this.chunks.clear();
    this.scene.remove(this.player.mesh);

    // build interior
    const it = Interiors.create(trig.interior);
    this.interiorObj = it;
    it.scene.add(this.player.mesh);
    this.player.groundFn = () => 0;
    this.player.bounded = false;
    this.player.setPosition(it.spawn.x, it.spawn.y, it.spawn.z);
    this.player.setFacing(it.spawn.yaw);
    this.tpsCamera.distance = 3.8;
    this.tpsCamera.setYaw(it.spawn.yaw);
    this.interact.clear();
    this.audio.setIndoor(true);

    this.state = 'interior';
    this.hud.toast(it.title, 2400);
    await this.hud.fade(false);
  }

  async _exitInterior() {
    if (this.state !== 'interior') return;
    this.state = 'transition';
    this.controls.exitLock();
    this.hud.clearPrompt();

    await this.hud.fade(true);

    // tear down interior
    this.interiorObj.scene.remove(this.player.mesh);
    this.interiorObj.dispose();
    this.interiorObj = null;

    // restore player to the outdoor door spot
    this.scene.add(this.player.mesh);
    this.player.groundFn = groundHeightAt;
    this.player.bounded = true;
    this.tpsCamera.distance = 6.2;
    const rx = this.returnPos.x;
    const rz = this.returnPos.z;
    this.player.setPosition(rx, groundHeightAt(rx, rz), rz);
    this.player.setFacing(this.returnPos.yaw);
    this.tpsCamera.setYaw(this.returnPos.yaw);
    this.interact.clear();
    this.audio.setIndoor(false);

    // rebuild the world around the player before revealing it
    this.chunks.update(rx, rz, 30);
    let guard = 0;
    while (this.chunks.queue.length > 0 && guard < 40) {
      this.chunks.update(rx, rz, 30);
      guard++;
    }

    this.state = 'playing';
    await this.hud.fade(false);
  }

  // =================================================================
  _pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.powers.stopActive(); // don't leave a held beam frozen on the paused frame
    this.actionHUD.hideOverlays(); // clear speed-lines / shield-break flash
    this.controls.exitLock();
    this.hud.openPause();
  }
  _resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hud.closePause();
    this.controls.requestLock();
  }

  // =================================================================
  //  Save / load (named slots)
  // =================================================================
  _serialize() {
    const p = this.player;
    return {
      level: this.missions.level,
      region: this._region,
      location: this._locationName(),
      player: { x: p.pos.x, y: p.pos.y, z: p.pos.z, facing: p.facing, hp: p.hp, maxHp: p.maxHp, avatarIndex: p.avatarIndex },
      vitals: { stamina: p.stamina.value, shield: p.shield.energy },
      mana: this.powers.mana, maxMana: this.powers.maxMana, activePower: this.powers.active,
      mount: this.mountSys.kind,
      timeOfDay: this.targetTOD,
      lives: this._lives,
      progression: this.progression.serialize(),
      missions: this.missions.serialize(),
    };
  }

  _applyState(s) {
    if (!s) return;
    this.bossMgr.despawn(); // never carry a stale in-progress boss into a loaded game
    this.powers.stopActive();
    this.missions.apply(s.missions);
    this.progression.apply(s.progression);
    this.powers.syncLocks(); // apply loaded spell unlocks NOW so activePower can be restored
    this._lives = s.lives ?? 3;
    this._won = false;
    this.targetTOD = s.timeOfDay ?? 0;
    this.timeOfDay = this.targetTOD;
    // resume the auto-cycle phase from the loaded time-of-day
    this.dayPhase = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * this.targetTOD))) / (Math.PI * 2);
    this._applyDayNight(this.timeOfDay);
    if (s.maxMana) this.powers.maxMana = s.maxMana;
    if (s.mana !== undefined) this.powers.mana = s.mana;
    if (s.activePower !== undefined && this.powers.powers[s.activePower] && !this.powers.powers[s.activePower].locked) this.powers.setActive(s.activePower);

    const pl = s.player || {};
    this.player.maxHp = pl.maxHp ?? this.player.maxHp;
    const x = pl.x ?? 0, z = pl.z ?? 6;
    this.player.setPosition(x, groundHeightAt(x, z) + 0.1, z);
    this.player.setFacing(pl.facing ?? 0);
    this.tpsCamera.setYaw(pl.facing ?? 0);
    this.tpsCamera.distance = 6.2;
    this.player.alive = true;
    this.player.flying = false;
    this.player.hp = pl.hp ?? this.player.maxHp;
    if (s.vitals) { this.player.stamina.value = s.vitals.stamina ?? this.player.stamina.max; this.player.shield.energy = s.vitals.shield ?? this.player.shield.max; }
    if (pl.avatarIndex !== undefined && this.player.avatarModes[pl.avatarIndex]) { this.player.avatarIndex = pl.avatarIndex; this.player.setAvatar(this.player.avatarModes[pl.avatarIndex]); }

    this._region = s.region || regionAt(x, z).key;
    this._rebuildAround(x, z);
    this.player.pos.y = groundHeightAt(x, z);
    this.player.mesh.position.copy(this.player.pos);
    this.enemies.resetAround(x, z);
    this.mountSys.dismount();
    if (s.mount) this.mountSys.toggle(s.mount); // restore mount
    this.missionHUD.setDeath(null);
  }

  _exportSave(name) {
    const json = this.saveMgr.exportJSON(name);
    if (!json) return;
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${name}.yamato.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { /* ignore */ }
  }

  _autosave() {
    if (this.state !== 'playing') return;
    this.saveMgr.save(this.saveMgr.AUTOSAVE, this._serialize());
    this.hud.toast('Auto-saved ⟳', 1400);
  }

  _openSaves() {
    if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'start') return;
    this._savesReturn = this.state;
    if (this.state === 'paused') this.hud.closePause();
    if (this.state === 'start') this.screens.hide();
    this.state = 'saves';
    this.powers.stopActive();
    this.actionHUD.hideOverlays();
    this.controls.exitLock();
    this.saveUI.open(this.saveMgr.list());
  }
  _updateSaves() {
    if (this.controls.consume('KeyO') || this.controls.consume('Escape')) this._closeSaves(false);
  }
  _closeSaves(loaded) {
    this.saveUI.close();
    if (loaded) { this.state = 'playing'; this.controls.requestLock(); return; }
    const ret = this._savesReturn || 'playing';
    if (ret === 'start') { this.state = 'start'; this.screens.showStart(); }
    else if (ret === 'paused') { this.state = 'paused'; this.hud.openPause(); }
    else { this.state = 'playing'; this.controls.requestLock(); }
  }

  // =================================================================
  //  World map + fast travel
  // =================================================================
  _openMap() {
    if (this.state !== 'playing') return;
    this.state = 'map';
    this.powers.stopActive();
    this.actionHUD.hideOverlays();
    this.controls.exitLock();
    this.worldMap.open();
  }
  _updateMap() {
    this.worldMap.draw(this.player.pos, this.player.facing, this._region, this.missions);
    if (this.controls.consume('KeyM') || this.controls.consume('Escape')) { this._closeMap(); return; }
    for (let i = 0; i < 4; i++) if (this.controls.consume('Digit' + (i + 1))) this.worldMap.fastTravelIndex(i);
  }
  _closeMap() {
    if (this.state !== 'map') return;
    this.worldMap.close();
    this.state = 'playing';
    this.controls.requestLock();
  }

  // =================================================================
  //  Skill tree (spend skill points)
  // =================================================================
  _openSkillTree() {
    if (this.state !== 'playing') return;
    this.state = 'skilltree';
    this.powers.stopActive();
    this.actionHUD.hideOverlays();
    this.controls.exitLock();
    this.skillTree.open();
  }
  _updateSkillTree() {
    if (this.controls.consume('KeyK') || this.controls.consume('Escape')) {
      this.skillTree.close();
      this.state = 'playing';
      this.controls.requestLock();
    }
  }

  _rebuildAround(x, z) {
    this.chunks.update(x, z, 30);
    let guard = 0;
    while (this.chunks.queue.length > 0 && guard < 60) { this.chunks.update(x, z, 30); guard++; }
  }

  _fastTravel(x, z, key) {
    this.worldMap.close();
    this.powers.stopActive();
    this.bossMgr.despawn();
    this.mountSys.dismount();
    this.player.flying = false;
    this.player.setPosition(x, groundHeightAt(x, z) + 0.1, z);
    this.player.setFacing(0);
    this.tpsCamera.setYaw(0);
    this.tpsCamera.distance = 6.2;
    this._rebuildAround(x, z);
    this.player.pos.y = groundHeightAt(x, z);
    this.player.mesh.position.copy(this.player.pos);
    this.enemies.resetAround(x, z);
    this._region = key;
    this.state = 'playing';
    const r = regionByKey(key);
    this.hud.toast(`Fast-travelled to ${r.name} ${r.native}`, 2600);
    this.controls.requestLock();
  }

  // =================================================================
  //  Player death / respawn
  // =================================================================
  _onPlayerDeath() {
    if (this.state !== 'playing') return;
    this.powers.stopActive();
    this.bossMgr.despawn();
    this.mountSys.dismount();
    this.actionHUD.hideOverlays();
    this.controls.exitLock();
    this._lives--;
    if (this._lives <= 0) { this._gameOver(); return; } // out of lives → lose state
    this.state = 'dead';
    this._deathT = 2.8;
    this.missionHUD.setDeath(this._deathT);
    this.hud.toast(`Defeated — ${this._lives} ${this._lives === 1 ? 'life' : 'lives'} left`, 2400);
  }

  _win() {
    this.state = 'win';
    this.powers.stopActive();
    this.controls.exitLock();
    this.screens.showWin();
  }
  _gameOver() {
    this.state = 'gameover';
    this.controls.exitLock();
    this.missionHUD.setDeath(null);
    this.screens.showGameOver();
  }
  _updateDead(dt) {
    this._deathT -= dt;
    this.missionHUD.setDeath(Math.max(0, this._deathT));
    if (this._deathT <= 0) this._respawnPlayer();
  }
  _respawnPlayer() {
    const r = regionByKey(this._region) || regionByKey('japan');
    const sx = r.center.x, sz = r.center.z;
    this.player.reviveFull();
    this.player.setPosition(sx, groundHeightAt(sx, sz) + 0.1, sz);
    this.player.setFacing(0);
    this.tpsCamera.setYaw(0);
    this.tpsCamera.distance = 6.2;
    this._rebuildAround(sx, sz);
    this.player.pos.y = groundHeightAt(sx, sz);
    this.player.mesh.position.copy(this.player.pos);
    this.enemies.resetAround(sx, sz);
    this.missionHUD.setDeath(null);
    this.state = 'playing';
    this.hud.toast(`Defeated — respawned at ${r.name}`, 2600);
    this.controls.requestLock();
  }

  _toggleDay() {
    this.autoCycle = !this.autoCycle;
    if (this.autoCycle) {
      this.hud.toast('Day / night cycle: ON', 1600);
    } else {
      this.targetTOD = this.targetTOD > 0.5 ? 1 : 0; // pause → hold the nearer of day/night
      this.hud.toast(this.targetTOD > 0.5 ? 'Held at night' : 'Held at day', 1600);
    }
  }

  _applyDayNight(t, instant = false) {
    const sky = SUNSET.sky.clone().lerp(NIGHT.sky, t);
    const fog = SUNSET.fog.clone().lerp(NIGHT.fog, t);
    this.scene.background = sky;
    this.scene.fog.color.copy(fog);
    this.sun.color.copy(SUNSET.sun.clone().lerp(NIGHT.sun, t));
    this.sun.intensity = lerp(SUNSET.sunInt, NIGHT.sunInt, t);
    this.hemi.color.copy(SUNSET.hemiSky.clone().lerp(NIGHT.hemiSky, t));
    this.hemi.groundColor.copy(SUNSET.hemiGround.clone().lerp(NIGHT.hemiGround, t));
    this.hemi.intensity = lerp(SUNSET.hemiInt, NIGHT.hemiInt, t);
    this.ambient.intensity = lerp(SUNSET.ambient, NIGHT.ambient, t);
    this._sunOffset = SUNSET.sunPos.clone().lerp(NIGHT.sunPos, t);
    Assets.setNight(t);
    if (this.audio) this.audio.setNight(t);
  }

  _updateSun() {
    // keep the shadow frustum centred on the player
    const p = this.player.pos;
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.target.updateMatrixWorld();
    this.sun.position.set(p.x + this._sunOffset.x, this._sunOffset.y, p.z + this._sunOffset.z);
  }

  _updatePetals(dt) {
    const p = this.player.pos;
    const data = this._petalData;
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      d.y -= d.fall * dt;
      d.x += Math.sin(this.elapsed * d.sway + d.phase) * 0.4 * dt + 0.25 * dt;
      d.rot += d.spin * dt;
      if (d.y < -2) {
        d.y = PETAL_H;
        d.x = (Math.random() * 2 - 1) * PETAL_R;
        d.z = (Math.random() * 2 - 1) * PETAL_R;
      }
      // keep the swarm centred on the player (toroidal wrap)
      if (d.x > PETAL_R) d.x -= PETAL_R * 2;
      else if (d.x < -PETAL_R) d.x += PETAL_R * 2;
      if (d.z > PETAL_R) d.z -= PETAL_R * 2;
      else if (d.z < -PETAL_R) d.z += PETAL_R * 2;

      this._tmpEuler.set(d.rot, d.rot * 0.7, d.rot * 0.4);
      this._tmpQuat.setFromEuler(this._tmpEuler);
      this._tmpVec.set(p.x + d.x, p.y + d.y, p.z + d.z);
      this._tmpMat.compose(this._tmpVec, this._tmpQuat, this._tmpScale);
      this.petals.setMatrixAt(i, this._tmpMat);
    }
    this.petals.instanceMatrix.needsUpdate = true;
  }

  _locationName() {
    const region = regionByKey(this._region) || regionAt(this.player.pos.x, this.player.pos.z);
    let best = null;
    let bestD = 36 * 36;
    for (const s of STRUCTURES) {
      const dx = s.x - this.player.pos.x;
      const dz = s.z - this.player.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD && NAMES[s.type]) {
        bestD = d2;
        best = NAMES[s.type];
      }
    }
    if (best) return `${region.name} · ${best}`;
    return `${region.name} ${region.native}`;
  }

  _updateDebug() {
    if (!this.hud.debugVisible) return;
    const info = this.renderer.info;
    const fps = this._fps ? this._fps.toFixed(0) : '—';
    this.hud.updateDebug(
      `FPS        ${fps}\n` +
        `draw calls ${info.render.calls}\n` +
        `triangles  ${(info.render.triangles / 1000).toFixed(1)}k\n` +
        `geometries ${info.memory.geometries}\n` +
        `textures   ${info.memory.textures}\n` +
        `chunks     ${this.chunks.stats.active} (q:${this.chunks.stats.pending})\n` +
        `built/disp ${this.chunks.stats.built}/${this.chunks.stats.disposed}\n` +
        `pos        ${this.player.pos.x.toFixed(0)}, ${this.player.pos.z.toFixed(0)}\n` +
        `state      ${this.state}`
    );
  }

  setFps(fps) {
    this._fps = fps;
  }

  _render() {
    // Render the interior whenever one exists — it's disposed only after the
    // exit fade is fully black — so the fade always covers the scene swap and
    // we never flash the torn-down outdoor scene.
    const scene = this.interiorObj ? this.interiorObj.scene : this.scene;
    this.renderer.render(scene, this.camera);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }
}

const NAMES = {
  machiya: 'Machiya Row',
  ramen: 'Ramen-ya',
  teahouse: 'Tea House',
  shrine: 'Shrine',
  torii: 'Torii Gate',
  pagoda: 'Pagoda',
  bridge: 'River Bridge',
  koi: 'Koi Pond',
};
