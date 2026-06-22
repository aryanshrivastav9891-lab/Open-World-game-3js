# 大和村 · Yamato-mura — and the wider world

A stylized **open-world action game** built with **Three.js (r160)**, **vanilla
JavaScript**, and **Vite** — no game engine, no framework. It starts in a low-poly
Japanese town and opens out into a **four-country world** (Japan · India · China ·
USA) you can explore, **fly** over (Superman-style), and fight across with
**elemental powers**, **enemy AI**, **missions** and **region bosses**.

The Japanese heart of the world is a main street lined with **machiya** townhouses,
a **ramen-ya**, a **tea house** with a koi pond, a **shrine** reached through a
vermilion **torii gate**, a five-tiered **pagoda**, a **wooden bridge** over a
meandering river, drifting sakura, rice paddies, and a day/night toggle — and
several buildings can be **entered**, each hand-furnished. Beyond it lie India’s
temples & havelis, China’s pagodas & Great-Wall segments, and the USA’s skyscrapers
& suburbs, each with its own palette, flora, enemies and boss.

The whole world is **streamed in chunks with level-of-detail** and disposed as you
walk, so memory and draw calls stay bounded no matter how far you roam. Geometry is
**procedural**; real **textures load from a CDN with graceful fallback**, so it also
looks correct fully offline.

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

Build / preview a production bundle:

```bash
npm run build
npm run preview
```

Requires Node 18+ and a WebGL2-capable browser.

---

## Controls

### On foot
| Input | Action |
| --- | --- |
| **W A S D** / **Arrows** | Move (camera-relative) |
| **Mouse** | Look around — **click the screen** to capture the pointer |
| **Shift** | Sprint / super-speed (drains stamina; FOV widens at top speed) |
| **double-tap a move key** | **Dash** in that direction (stamina + cooldown, speed-lines) |
| **Space** | Jump · **double-tap to take off (fly)** · **F** toggle flight |
| **E** | Interact (enter building / read sign) — or, with nothing in range, **cast** |
| **1 – 0** | Switch power/spell (1-6 Fire/Water/Earth/Lightning/Fry/**Atomic** · 7-0 Stupefy/Wingardium/Expelliarmus/Cloak) |
| **V** | Select **Summon Allies** (the 11th power) — then cast (click / E) to call 2–3 fighters |
| **Left Mouse** | **Cast** the active power/spell — or **swing the sword** when it's drawn |
| **Right Mouse** (hold) | **Block / parry** with the sword (drawn) |
| **Q** | Toggle the **energy shield** · **R** draw/sheath **sword** · **T** cycle avatar skin |
| **G** / **H** | Mount the **horse** (ground) / **flying roc** (air) — toggle to dismount |
| **K** | **Skill Tree** (spend skill points: power upgrades + unlock spells) |
| **J** | **Mission Log** · **M** **world map** (click a country / 1–4 to fast-travel) |
| **O** | **Saved Games** (named save/load/delete + JSON export/import; also in the pause menu) |
| **Esc** | Pause / leave a building / close menus · **L** day/night cycle on/off · **`~`** debug |

The bottom **ActionHUD** shows your **Health · Stamina · Shield · Mana** bars, the
power slots, and **Shield (Q) / Dash / Sword (R)** ability chips (with ready /
cooldown / active state). Stamina gates sprint, dash, shield and sword — it
**regenerates when you stop**. Enemies and bosses hurt you (screen flashes red,
knockback); the **shield** soaks hits until it breaks, and **blocking/parrying**
cuts or negates melee. At 0 HP you respawn at the country capital; XP/level (top-
left) raises max HP & mana.

### Flying (Superman)
| Input | Action |
| --- | --- |
| **W / S** | Fly forward / back along where you look (look down to dive) |
| **A / D** | Strafe |
| **Space** | Ascend · **C** descend |
| **Shift** | Boost (and the camera pulls back at speed) |
| **F** / double-tap **Space** / touch the ground | Land |

> **Why cast is Left-Mouse/E, not Space:** Space is jump / take-off, so binding
> cast to it would break movement. **E is contextual** — it interacts when a door
> or sign is in range, otherwise it casts. Hold **Left Mouse** for continuous
> beams (Fry). Gamepad: left stick move, right stick look, A jump, X interact.

The minimap (top-right) shows nearby points of interest; enterable buildings have a
white ring. NPCs show a floating health bar when hurt, and damage numbers pop on hit.

---

## What to do

- Walk **north** through the torii gate and up the lantern-lined approach to the
  **shrine**, then press **E** to step inside the main hall.
- Pop into a **machiya** townhouse (tatami room), the **ramen-ya** (counter + kitchen),
  or the **tea house** (sunken hearth + tokonoma).
- Head **east** down the street and cross the **bridge** over the river.
- Press **L** at dusk to watch the paper lanterns glow against the night.
- Follow the **mission waypoint ★**: clear the hunt (defeat 4 regional enemies), then
  go to the **arena ◆** to fight the country’s **boss**. Defeating it liberates the region.
- Press **M** for the **world atlas** and fast-travel to **India**, **China** or the
  **USA** — each has its own architecture, flora, enemies, boss and missions.

---

## Project structure

```
index.html              Entry; mounts #app (canvas) and #hud (UI overlay)
vite.config.js          Vite config (plain, no plugins)
src/
  main.js               Bootstrap + clamped render loop + FPS meter
  Game.js               State machine: loading → playing → paused → interior
  world/
    Regions.js          Multi-country map: Voronoi region lookup, palettes, flora, architecture,
                          landmarks, per-region boss + enemy defs ("how to add a region" doc)
    WorldConfig.js      Single source of truth: grid, terrain, river, region-aware surface/scatter,
                          procedural per-country buildings + landmarks
    Assets.js           Shared cached geometries + materials; region architecture builders
    Chunk.js            One streamed tile: terrain, water, structures, region buildings, props, colliders
    ChunkManager.js     Streaming: load radius, build queue (time-budgeted), disposal, LOD bands
    NPCManager.js       Pooled villagers (walking + flying) + the shared HP/damage system
    DragonManager.js    Real 3D dragon (DragonAttenuation.glb) drifting across the sky, billboard fallback
    NatureManager.js    Real tree (tree.obj) groves + Flower.glb patches + modeled mountains
    BirdManager.js      Real animated glTF birds (Flamingo/Parrot/Stork) flapping across the sky
    MountSystem.js      Rideable horse + flying roc (mount/dismount, faster travel, riding anim)
    DecorManager.js     One-off example landmarks: animated Littlest Tokyo (GLTF) + OBJ statue
    Interiors.js        Four self-contained furnished interior scenes
    Interactables.js    Nearest in-range trigger (doors, signs, exits)
  ai/
    AI.js               A* pathfinding, line-of-sight, seek/separate steering, boids flocking
  entities/
    EnemyManager.js     Pooled hostile enemies: FSM (idle/patrol/chase/attack/flee), A* + boids,
                          aggro + LOS, HP/damage, attacks the player
    BossManager.js      Per-region boss: phases, screen HP bar, utility-AI ("game theory") decisions,
                          summons, projectiles, reward on defeat
  missions/
    MissionManager.js   Quests (hunt/boss/collect/rescue/defend), waypoints, XP/level, win condition
  progression/
    Progression.js      Skill points → power upgrades (dmg/cd/aoe) + spell unlocks
  save/
    SaveManager.js      Named localStorage save slots, versioned + migration, JSON export/import
  abilities/
    Stamina.js          Stamina meter: drain/spend/regen + ability gating ("how to add an ability")
    Shield.js           Energy-dome shield: absorb → break → recharge, procedural energy texture
    Dash.js             Super-speed dash: stamina-gated burst + cooldown
  combat/
    Sword.js            Modeled blade: draw/sheath, combo swings + hit detection + trail, block/parry
  characters/
    ModelLibrary.js     Loads real glTF characters + birds + horse from CDN, clones instances,
                          height-normalizes + feet-seats, per-model facing ("how to add a model" doc)
    CharacterModel.js   AnimationMixer wrapper: maps idle/walk/run/jump clips, crossfades by state
  powers/               Elements + Spells.js (Stupefy/Wingardium/Expelliarmus/Cloak) + FX pools
  player/
    Player.js           Capsule physics + flight + humanoid + HP/death + owns stamina/shield/dash/sword
    Controls.js         Keyboard + pointer-lock mouse (L+R) + double-tap dash + gamepad
    ThirdPersonCamera.js Spring follow camera with wall/terrain collision
  ui/
    HUD.js              Loading bar, prompts, minimap, debug overlay, pause menu, fades
    ActionHUD.js        Unified bottom HUD: HP/stamina/shield/mana + power/ability/weapon SVG icons
    CombatHUD.js        Pooled floating damage numbers (world→screen projection)
    MissionHUD.js       Level/XP bar, tracked objective, on-screen waypoint marker
    MissionLogHUD.js    Quest log panel (J) · SkillTreeUI.js skill tree (K) · SaveLoadUI.js saves (O)
    Screens.js          Start / win / game-over demo screens
    WorldMap.js         Full-screen atlas: country territories, capitals, arenas, fast-travel
  audio/
    AudioManager.js     Procedural WebAudio ambience (pad, wind, cicadas) + koto melody
  assets/
    Textures.js         Loads real CDN textures with graceful procedural fallback
    Loaders.js          Pre-wired GLTF/DRACO/KTX2 + FBX + MD2 + OBJ loaders (graceful tryLoadXxx)
    README.md           How to drop in real models if you want them
  utils/
    math.js             Deterministic RNG, value/fractal noise, damping helpers
    LODGroup.js         Thin THREE.LOD wrapper with billboard far-levels
    dispose.js          Deep-dispose helper for uniquely-owned nodes
```

---

## How chunk streaming + LOD works

### The grid

The world is a **64 × 64 grid of chunks**, each **30 × 30 world units** (≈ 1.9 km
across). Nothing about the world is stored — every chunk is **derived
deterministically** from its integer coordinates and a fixed seed
([`WorldConfig.js`](src/world/WorldConfig.js)). Terrain height, the river's path,
which surface (grass / path / water / paddy) a point is, where the hand-placed
buildings go, and the procedural scatter (trees, grass, rice) are all pure
functions of position. Reloading gives you the identical town.

### Streaming around the player

[`ChunkManager`](src/world/ChunkManager.js) keeps a **load radius of 3** resident
around the player — a **7 × 7 = 49 chunk** window. Each frame it computes the
player's chunk; when that changes it **reconciles**:

- chunks newly inside the radius are pushed onto a **build queue**,
- chunks that fell outside are **immediately disposed**.

The queue is drained **nearest-first** under a **per-frame time + count budget**
(`≤ 4` chunks and `≤ 5 ms` per frame), so loading is spread across frames and never
freezes the game. A small "streaming…" indicator shows while the queue is non-empty.

### Disposal (no memory growth)

When a chunk leaves the radius, [`Chunk.dispose()`](src/world/Chunk.js):

- disposes its **unique** geometry — the terrain tile and water plane it built,
- disposes **uniquely-owned** nodes (canvas-textured signs: geometry + material + texture),
- calls `.dispose()` on each per-chunk **InstancedMesh** to free instance buffers,
- removes the chunk group from the scene and clears its colliders/triggers.

Crucially it **does not** dispose the **shared** geometries and materials owned by
the [`Assets`](src/world/Assets.js) library (every machiya shares one merged
geometry, every sakura shares one instancing geometry, etc.). Those are reused by
the next chunk, so streaming never re-allocates GPU buffers. You can watch
`geometries` / `textures` in the debug overlay (`~`) stay flat while you walk to the
map edge and back.

### Level of detail

Two complementary LOD mechanisms:

1. **Chunk-level LOD** — chunks within 2 of the player render **full-detail** props;
   farther resident chunks switch their instanced trees to a **cheaper geometry** and
   drop grass/rice entirely. Crossing a band only rebuilds the cheap scatter, not the
   whole chunk.
2. **Per-object LOD** — large landmarks (pagoda, shrine) are wrapped in a
   [`LODGroup`](src/utils/LODGroup.js) (a `THREE.LOD`) with a full mesh up close, a
   camera-facing **billboard** far away, and a hard cull distance.

### Keeping it cheap

- **InstancedMesh** for all repeated scatter (trees, grass, rice) — one draw call per
  prop type per chunk.
- Each building is **merged into a single geometry** (one draw call) with baked
  **vertex colors** read by a shared toon material — no per-face materials.
- **Frustum culling** on terrain/buildings; the load radius bounds everything else.
- Pixel ratio capped at **2**; a single shadow-casting sun whose shadow frustum
  follows the player.
- Fog (`near 35`, `far 135`) hides the streaming edge, so the visible world always
  looks complete.

The net effect: **active triangles and draw calls stay bounded** regardless of how
far you walk, which is what keeps it at 60 FPS on a mid-range laptop.

---

## Entering buildings

Each enterable building has a **door trigger zone**. Step into it and a *"Press E to
enter"* prompt appears. On enter the screen **fades to black**, the **entire streamed
world is freed** (`ChunkManager.clear()`), and a small **self-contained interior
scene** is built on demand — its own scene, lights, fog, geometry and materials,
none shared with the world. You spawn just inside the door; **E** or **Esc** leaves,
fading back and **restoring you to the exact outdoor spot** you entered from while the
world streams back in. There are **four distinct furnished interiors** (machiya, ramen
shop, tea house, shrine hall).

---

## Assets

The game ships with **no model or texture files** — houses, trees, lanterns, the
player, and signage are all built from primitives at runtime. If you'd rather use
real art, `GLTFLoader` + `DRACOLoader` + `KTX2Loader` come pre-configured in
[`src/assets/Loaders.js`](src/assets/Loaders.js); `tryLoadGLB()` returns `null` on a
missing asset so you keep a procedural fallback. See
[`src/assets/README.md`](src/assets/README.md).

---

## Gameplay systems

All systems are modular and pooled (no per-effect allocation; everything disposes).

### 🦸 Superman flight — `src/player/Player.js`
Toggle flight with **F** or a **double-tap of Space**. In the air gravity is off
and you get smooth 6-DOF movement: accelerate where you look (W/S, look down to
dive), strafe (A/D), ascend/descend (Space/C), and **boost** with Shift. The
avatar **banks/tilts into turns** and strikes a Superman pose; the third-person
camera **pulls back as speed rises** (`ThirdPersonCamera.distanceTarget`). Flight
ends on **F**, double-tap Space, or touching the ground — handing momentum back to
the ground simulation for a **smooth landing** (gravity re-enables).

### ⚔️ Combat powers with real game logic — `src/powers/`
Switchable, aimed powers (aim = analytic march for the point + a `THREE.Raycaster`
to pick NPCs). Each has a **cooldown** and drains a shared, regenerating **mana
bar**; the HUD shows slots, active highlight, cooldown shading and mana.

- **🔥 Fire** — fireball that, on impact, **ignites the spot**: a persistent flame
  + orange particles + `PointLight` burns for a few seconds, dealing **burning
  damage-over-time** to NPCs in range, then disposes (pooled zones).
- **🪨 Earth** — raises a rock pillar / boulder; heavy **area damage + knockback**
  (the killer) → NPC dies, ragdolls, despawns at 0 HP.
- **💧 Water** — jet that **pushes** NPCs back and leaves a fading **wet splash decal**.
- **⚡ Lightning** — fires a **real branching, flickering bolt** + blinding flash + **area stun + damage**.
- **☀️ Fry** — held **continuous beam** whose **damage scales with hold time** (18→~80 dps).
- **☢ Atomic Blast** — the ultimate: a blinding detonation with a **rising
  mushroom column + cap + ground shockwave**, **huge wide-area damage + burn +
  stun**. Costs **70 mana** (vs 16–24 for the others) on a long cooldown, so it's
  an occasional finisher (`src/powers/AtomicPower.js`).
- **👥 Summon Allies** (key **V**) — calls **2–3 friendly villager fighters** to
  your side. They spawn around you, **charge the nearest enemy and blast it with
  elemental bolts** (fire/lightning/water/earth) for ~18s, then fade back into
  ordinary villagers. Reuses the pooled NPCs in `NPCManager` (`summonAllies` /
  `_allyMove` / `_allyFire`); 45 mana, 16s cooldown; `src/powers/SummonPower.js`.

**Realistic lightning** — Lightning, the Stupefy spell and the Atomic blast fire a
**branching, flickering bolt** (`src/powers/LightningFX.js`): a pooled
`LineSegments` channel built by recursive midpoint-displacement + random forks,
rebuilt each frame for the flicker, then faded — exposed to any power as
`ctx.lightning(from, to, color, life)`. (three.js's old `LightningStrike` example
geometry was removed before r160, so this is a self-contained equivalent that
always works offline.)

**Distinct VFX texture per power** — `src/powers/ElementTextures.js` builds a
unique procedural sprite per mode (flame / droplet / spark / rock fleck / heat /
**atomic flash** / arcane); `PowerManager` swaps the shared `ParticlePool`
texture to the **active** power's sprite (`Power.texKey`). The bright powers are
then **upgraded to real threejs.org example sprites** when they load —
`sprites/spark1.png` for Lightning/Atomic/Fry and `sprites/circle.png` for Water
(`PowerManager.setElementTexture`, wired from `TextureLibrary.onReady`) — with the
procedural sprite as the offline fallback. SRGB; the procedural set is disposed
with the manager while the real sprites stay owned by the `TextureLibrary`.

**Add a new element in <10 lines** — documented atop
[`PowerManager.js`](src/powers/PowerManager.js): subclass `Power` (implement
`cast(ctx)` for instant or `beamUpdate(dt,ctx,on)` for a beam — see
[`FryPower.js`](src/powers/FryPower.js)), add it to the `powers` array. Powers
deal damage through `ctx.damageArea / applyBurn / stunArea / pushNPCs`.

### ❤️ Health / damage — `src/world/NPCManager.js` + `src/ui/CombatHUD.js`
Every NPC has **HP**, takes **typed damage** (fire/earth/water/lightning/fry/burn),
shows a **floating damage number** (pooled DOM, world→screen projected) and a **3D
health bar** when hurt, **flinches** (hit flash), gets **knocked back**, and on 0
HP **ragdolls → despawns → respawns** (pool). Burn is an accumulating DoT.

### 🚶🕊️ Living NPCs (walking + flying) — `src/world/NPCManager.js`
14 **walking** villagers wander streets/plaza (idle, avoid buildings/water,
ground-snap) and 6 **flying** villagers drift / circle / swoop at varying heights.
The flyers are now **real glTF birds** — Flamingo / Parrot / Stork from the
three.js examples — with their **wing-flap clip** driven by an `AnimationMixer`
and yawed to their flight path (procedural bird kept as the offline fallback).
Both are pooled, integrate with the health/damage system, and are aimable/damageable.

### 🌳🐉 Real nature & a real dragon — `src/world/NatureManager.js` + `DragonManager.js`
- **Real trees + flowers** — `NatureManager` plants groves of the real
  `models/obj/tree.obj` (two-toned: brown trunk + green canopy) and patches of
  `Flower.glb` across the map, each instance sharing the cached geometry/material
  (cheap), seated on the ground, scale/rotation varied, frustum-cullable.
- **A real 3D dragon** — `DragonManager` upgrades its sky dragons from image
  billboards to the real **`DragonAttenuation.glb`** model (forced opaque, since
  its glass material needs an env map): it flies across the sky, yawed to its
  heading with a gentle bank. Until the 6 MB model loads — or if it can't — the
  hand-drawn **billboard** dragon flies instead (fully graceful).
- **More birds** — the ambient `BirdManager` sky-bird count is bumped to 12.
- **Modeled mountains** — `NatureManager._buildMountains` raises 6 big peaks on
  the horizon: displaced cones shaded **rock → white snow caps** by vertex colour.
- **Real houses** — a hamlet of real **`forest_house.glb`** models (`DecorManager`).

### ☀️🌙 Automatic day / night cycle — `src/Game.js`
The world now runs a **continuous day↔night cycle**: a phase advances while the
game is live and drives the time-of-day along a smooth cosine
(`targetTOD = 0.5 − 0.5·cos(phase·2π)`), which the sky / sun / fog / ambient
light, the audio bed and emissive lamps all follow (`_applyDayNight`). A full
loop is ~150 s (≈75 s day + 75 s night). Press **L** to pause/resume the cycle
(it holds at the nearer of day/night); a loaded save **resumes at its saved
time**.
### 🌏 Whole-world map — four countries — `src/world/Regions.js`
The single village became a **multi-country world**: **Japan** (origin), **India**,
**China** and the **USA**, partitioned by a nearest-centre **Voronoi** test
(`regionAt`). Each country drives its own **terrain palette**, **flora**
(sakura/pine · palm/banyan · bamboo · oak/cactus), **architecture**, a guaranteed
**landmark**, a **boss** and an **enemy** type — all from one table in
`Regions.js`. Buildings are placed **procedurally per chunk** by
`buildingsForChunk()` (denser toward each capital, sparser at the frontier),
filling the world with recognizable styles — Indian temples (shikhara) & havelis,
Chinese pagodas, halls & Great-Wall segments, US skyscrapers & suburban houses,
Japanese minka — each one **cached, shared geometry → ~1 draw call**, with an
**axis-aligned box collider** (quarter-turn rotations swap the footprint so the
collider stays aligned). The existing hand-built village near the origin is
protected by `VILLAGE_SUPPRESS_R`. A **world atlas** (`WorldMap.js`, press **M**)
shows the territories, capitals and boss arenas and lets you **fast-travel** /
border-cross; the HUD location label and minimap are region-aware.

### 🤖 Enemy AI — real game algorithms — `src/ai/AI.js` + `src/entities/EnemyManager.js`
Pooled hostile enemies (ground + flying) run a **finite state machine**
(idle/patrol → **chase** → **attack** → **flee**) with **aggro ranges** and
**line-of-sight** checks (`lineOfSight`). Ground enemies **path with A\*** on a
coarse on-demand nav grid around buildings (`astar`, bounded window + node cap),
shortcutting to a direct **seek** when they have LOS, with **separation** so they
don’t stack. Flyers use **boids flocking** (separation/alignment/cohesion) + seek
& swoop. Getting hit **alerts** them; low HP makes them **flee**. They share the
full HP/damage system and **damage the player** on contact.

### 👑 Missions, bosses & progression — `src/missions/` + `src/entities/BossManager.js`
Entering a country activates a **hunt** mission (defeat N regional enemies);
clearing it unlocks the **boss** mission. Reaching the country’s **arena ◆** spawns
its boss — a large, multi-**phase** foe (escalating at 66% / 33% HP) with a
**screen-wide health bar** and **utility-AI / “game-theory” decisions**: each tick
it scores **slam vs ranged volley vs summon reinforcements vs reposition-dodge** by
a risk/reward utility (distance, its HP, your HP, adds alive) and commits to the
best. Defeating it grants a big **XP** reward and **liberates** the region.
Objectives, progress, an on-screen **waypoint marker**, and an **XP / level** bar
live in `MissionHUD.js`; leveling raises your max HP & mana.

### 👹 Monsters & power-wielding enemies — `src/entities/EnemyManager.js`
The hostile pool now has **archetypes** (fixed per slot so each keeps a stable
real model): **Grunt** (fast melee, X-Bot), **Caster** (ranged — hurls elemental
**bolts** after a readable **wind-up tell**, Soldier), **Brute** (big, tanky,
slow, Robot), and **flying enemies** — now a real **dark "corrupt bird"** model
(Parrot forced to a menacing colour) that flaps and yaws to its flight. Stats
scale by archetype **and region
difficulty** (`tier = 1 + region.index·0.18`). All keep the full AI (FSM, A\*,
boids, LOS, aggro) + HP/damage; the Invisibility Cloak drops their aggro.
Friendly **guardian villagers** (`NPCManager.setAllies`) fight alongside you,
plinking nearby enemies with bolts.

### ⚔️ Combat arenas + Super-Saiyan power surge — `src/world/ArenaManager.js`
Three **combat arenas** (stone disc ringed by glowing golden pillars) sit at
fixed, land-snapped spots across the world. **Step inside one and:**
- the arena **fills with a horde of monsters** — the whole 16-strong enemy pool
  is packed into the ring, alerted and charging (`EnemyManager.fillArena`); it
  **re-tops every 2.5 s** while you fight there,
- your **powers are supercharged** — **2× damage, 1.4× AoE, 40 % faster
  cooldowns, 2× mana regen** (`PowerManager.setArenaBuff`), stacking on top of
  your skill-tree upgrades,
- a **golden "Super-Saiyan" aura** ignites around the avatar — an upward flame,
  a pulsing body glow, a flaring ground ring, a warm light and a fountain of
  rising golden sparks (`src/world/AuraFX.js`).

Leaving the ring ends the surge (aura off, multipliers back to normal). Add an
arena by dropping an `{ x, z }` into `ZONES` in `ArenaManager.js`.

### 🪄 Spells, progression & skill tree — `src/powers/Spells.js` + `src/progression/`
Defeating monsters/bosses grants XP → levels → **skill points**. The **Skill Tree**
(`K`, `SkillTreeUI`) spends them on **power upgrades** (+damage / −cooldown / +AoE,
applied to every cast via PowerManager multipliers) and on **unlocking spells**.
The Harry-Potter-style **spells** are ordinary `Power`s (slots **6–9**, locked until
unlocked): **Stupefy** (stun bolt), **Wingardium** (telekinesis throw),
**Expelliarmus** (disarm), **Invisibility Cloak**. (Protego = the energy **Shield**,
Q.) They share the combat ctx, so upgrades scale them too.

### 🐎 Mounts — `src/world/MountSystem.js`
Ride a **horse** (`G`, fast ground travel) or a **flying roc** (`H`, takes you into
the air) — real glTF models parented under the player, animated by their
gallop/flap clip, much faster movement, the camera pulls back, and toggling
dismounts (the roc lands you). Graceful: no model → you still get the speed boost.

### 🎬 Demo flow — start / win / lose — `src/ui/Screens.js`
A **Start screen** (Begin) → play → **Win** when every region boss is defeated;
**3 lives**, and a **Game Over** screen (Restart) when they run out. Varied demo
missions (collect caches, rescue a captive, defend the plaza) plus the per-region
hunt → boss chain, all listed in the **Mission Log** (`J`).

### 🛡️ Abilities — stamina · shield · super-speed/dash — `src/abilities/`
A real **stamina** meter (`Stamina.js`) drains when you sprint, dash, hold the
shield, or swing the sword, and **regenerates when idle** — at 0 it gates all of
them (`spend()`/`drain()` refuse). The **shield** (`Shield.js`, **Q**) raises a
visible energy dome that **absorbs incoming damage** (routed through
`Player.hurt`); its meter drains while held and faster as it soaks hits, then
**breaks** (flash) and **recharges after a delay**. **Super-speed** is sprint
(Shift) plus a **dash** (`Dash.js`, double-tap a direction) — a stamina-gated burst
on a cooldown that widens the camera **FOV** and triggers screen **speed-lines**.

### ⚔️ Sword combat — `src/combat/Sword.js`
A modeled, textured blade you **draw/sheath** (**R**) — strapped to the back when
sheathed, in hand when drawn. **Left-click swings** a **light → light → heavy**
combo (chained within a window); each swing lands **one** hit on an arc in front of
you (`hitSink` → the same `damageArea` fan-out as powers, so it hits NPCs/enemies/
boss) with knockback, hit-flash and a glowing **swing trail** (additive particles
at the blade tip). **Right-click blocks**, and a hit inside the first ~0.2 s of
raising guard is a clean **parry** (negated); both spend stamina. Drawing the sword
flips left-click to melee (powers stay castable on **E**) via `meleeMode`.

### 🎛️ ActionHUD — `src/ui/ActionHUD.js`
One cohesive bottom HUD: **Health / Stamina / Shield / Mana** bars, the power slots
(cooldown shade + active glow), and **Shield / Dash / Sword** chips with crisp
inline-**SVG** icons and ready/cooldown/active state, plus control hints and state
feedback (low-stamina pulse, shield-break flash, dash glow, speed-lines). It’s a
drop-in for the old PowerHUD (`PowerManager.setHUD`), so the power system drives it
unchanged; Game feeds it vitals each frame. Responsive (clamps + a small-screen
fallback).

### 🧍 Real character models + animation — `src/characters/`
The procedural avatar/NPC/boss bodies are now **fallbacks**: when available, real
**rigged, textured glTF characters** load from the official three.js example assets
(CORS CDN) and replace them. `ModelLibrary` measures each model's rendered bounding
box and **size-normalizes** it (a *multiplier* on the model's own root scale, so a
model authored at any native scale ends up ~1.8 units — fixes the "too big" bug) and
**re-seats its feet** at the origin (`groundOffset = -box.min.y·factor`, no
floating/sinking). It hands out independent **`SkeletonUtils.clone`** instances;
`CharacterModel` wraps a **`THREE.AnimationMixer`** and crossfades **idle / walk /
run / jump** clips (matched by name), driven by each entity's movement state.
**Facing** is corrected per-model via `faceFix` so the character faces the way it
moves (the game's forward is −Z; Soldier is authored facing −Z → `faceFix 0`, the
+Z Mixamo-style X-Bot/Robot → `faceFix π`).
- **Avatar** — **selectable skins** (press **T**): Soldier → X-Bot → Robot, each
  real-textured + animated. The procedural body is hidden but the **sword stays
  usable** (still driven by the right-arm transform).
- **NPCs** — walking villagers get **varied** real models (round-robin); flying
  ones stay procedural birds. Pooled, mixers disposed.
- **Boss** — a large, **tinted**, animated model (cloned materials so the menacing
  tint is unique), scaled up to boss size, feet grounded.
- **Birds** (`src/world/BirdManager.js`) — real animated **Flamingo / Parrot /
  Stork** glTF models flap across the sky (`AnimationMixer` on their flap clip),
  yawed to face their flight direction, drifting in/out through the fog. Pooled
  (one instance per slot, reused on respawn). The image-billboard **dragons**
  (`DragonManager`) still cross the sky too (there's no official dragon glTF in the
  three.js examples, so dragons use real transparent dragon images).
Everything is **graceful**: if a model can't be fetched the entity keeps its
procedural mesh / no birds spawn, and the game runs fully offline.

### 🧩 Example-asset mapping + loaders — `src/assets/Loaders.js`
Each game element follows the corresponding official three.js example's loader +
asset, with a procedural fallback. **GLTF + DRACO + KTX2, FBX, MD2 and OBJ**
loaders are all wired (same `tryLoadXxx(url) → asset | null` pattern). Mapping:

| Element | Example | How it's done here |
| --- | --- | --- |
| Hero / avatar | webgpu_animation_retargeting | Soldier/X-Bot/Robot glTF skins; `CharacterModel` name-maps idle/walk/run across them (one clip-set, many models) |
| NPCs | …retargeting_readyplayer | same approach on villagers (drop a Ready-Player-Me `.glb` URL into `MODEL_SPECS`) |
| Small enemy | webgl_loader_fbx | **FBXLoader** → `Samba Dancing.fbx` (grunt) |
| Medium enemy | webgl_loader_md2_control | **MD2Loader** → `ratamahatta.md2` (caster, stand/run/attack clips) |
| Boss | webgl_loader_md2 | **MD2Loader** → `ratamahatta.md2` (scaled + tinted) |
| Horse mount | webgl_instancing_morph | **Horse.glb** morph-target gallop (`MountSystem`) |
| Flyers (birds) | Flamingo/Parrot/Stork glTF | **BirdManager** — flap clips, fly across the sky |
| Homes / buildings | webgl_animation_keyframes | **LittlestTokyo.glb** placed as an **animated landmark** (`DecorManager`) + procedural region architecture |
| Statue / props | webgl_loader_obj | **OBJLoader** → `male02.obj` as a stone statue (`DecorManager`) |
| Trees | webgl_loader_obj | **OBJLoader** → `models/obj/tree.obj`, two-toned, in groves (`NatureManager`) |
| Flowers | models/gltf | **`Flower.glb`** patches (`NatureManager`) |
| Dragon | models/gltf | **`DragonAttenuation.glb`** flying across the sky (`DragonManager`) |
| Mountains / terrain | webgl_geometry_terrain_raycast | deterministic **heightfield** (`heightAt`); props/player seat via `groundHeightAt` (raycast-equivalent) |
| Trees & houses | webgl_loader_gltf_avif | procedural foliage/buildings (AVIF-textured GLTF pluggable via the GLTF loader) |

All loaded models are size-normalized, feet-seated, oriented, and animated by a
`THREE.AnimationMixer`. If any asset fails, that element keeps its procedural mesh.

### 💾 Save system — `src/save/SaveManager.js` + `src/ui/SaveLoadUI.js`
**Named save slots** in `localStorage` (with an in-memory fallback for private
mode), plus JSON **export/import** (download/upload a backup file). Persisted +
**versioned** (with a migration hook so new fields don't break old saves): player
level/XP, unlocked powers & upgrades, position + region, mission/quest progress,
mount, HP/mana/stamina, time of day, avatar mode, lives. **Auto-save** at
checkpoints (mission completion + boss defeat) plus manual save. Open with **O** or
the **pause menu**; the **start screen** has **Continue / Load**. Slots list their
name · level · location · timestamp.

### 🌳 Tree physics — `src/world/Chunk.js` + `src/world/Assets.js`
Trees are fixed three ways: **(1) collision** — each scattered trunk adds a slim
**circle collider** (`Chunk._addTreeColliders`, built once so it survives LOD swaps)
so the player/NPCs can't walk through trunks (and `top` lets you fly over canopies;
tagged `slim` so enemy A\* ignores them for cheap pathing while `_resolve` still
pushes bodies out); **(2) ground placement** — instances sit at `heightAt(x,z)` with
their base at local y=0 (no float/sink); **(3) wind sway** — a dedicated `foliage`
material (a sway-shader clone of `world`, used only by scattered props) bends the
upper verts of each instance in a GPU vertex shader, phase-varied per instance,
advanced by `Assets.tickFoliage(dt)`. Buildings keep the non-swaying `world` material.

### 🖼️ Real textures — `src/assets/Textures.js`
Real, high-resolution textures load from a **CORS-enabled CDN** with **graceful
fallback** to the procedural look if a URL fails. Applied to the **terrain ground**
(tiled, world-scaled UVs + `SRGBColorSpace`) with a **bump** map, **buildings/props
& region architecture** (detail bump, keeping primitive UVs), the **river + koi
ponds** (animated **normal** map + **roughness** map), the **player / NPCs / enemies
/ boss** (fabric/skin/armour bump via `applyDetail`), and **fire/lightning
particles** (spark sprite). Dragons load real transparent PNGs. See the asset list
below. (Per-region *diffuse* maps are intentionally not applied to the merged
building geometry, to preserve the one-draw-call-per-building budget; each country’s
distinct look comes from its vertex-colour palette + bump/normal/roughness maps.)

### Wiring (already applied to `src/Game.js` / `src/player/Controls.js`)
In `init()` after the world subsystems exist:
```js
this.npcs = new NPCManager(this.scene);
this.dragons = new DragonManager(this.scene);
this.powers = new PowerManager(this.scene, this);
this.combatHUD = new CombatHUD();
this.npcs.setEffects({ combatHUD: this.combatHUD, particles: this.powers.particles });

// Wave-4: enemies, boss, missions/XP, mission HUD, world map
this.enemies = new EnemyManager(this.scene);
this.bossMgr = new BossManager(this.scene);
this.missions = new MissionManager();
this.missionHUD = new MissionHUD();
this.worldMap = new WorldMap();
this.enemies.setHooks({ combatHUD: this.combatHUD, particles: this.powers.particles,
  onKill: (rk, xp) => this.missions.onEnemyKilled(rk, xp) });
this.bossMgr.setHooks({ combatHUD: this.combatHUD, particles: this.powers.particles,
  lights: this.powers.lights, enemies: this.enemies,
  onBossKilled: (rk, xp) => this.missions.onBossKilled(rk, xp) });
this.missions.onToast = (t, ms) => this.hud.toast(t, ms);
this.missions.onLevelUp = (lvl) => { this.player.maxHp += 15; this.player.heal(45); this.powers.maxMana += 8; };
this.player.onHurt = () => this.missionHUD.flashDamage();
this.player.onDeath = () => this._onPlayerDeath();
this.worldMap.onFastTravel = (x, z, key) => this._fastTravel(x, z, key);

this.textures = new TextureLibrary().load();
Assets.useTextures(this.textures);
this.textures.onReady('spark', (t) => this.powers.particles.setTexture(t));
this.textures.onReady('detail', (t) => { this.player.applyDetail(t); this.npcs.applyDetail(t);
  this.enemies.applyDetail(t); this.bossMgr.applyDetail(t); });
// after the world preloads:
this.enemies.resetAround(this.player.pos.x, this.player.pos.z);
```
Per-frame in `_updatePlaying(dt)` (after the camera/player update):
```js
this.tpsCamera.distanceTarget = 6.2 + this.player.flightSpeed01 * 5; // flight cam pull-back
const wn = Assets.mat.water.normalMap; if (wn) { wn.offset.x += dt*0.03; wn.offset.y += dt*0.015; }
this._region = regionAt(this.player.pos.x, this.player.pos.z).key;
this.npcs.update(dt, this.player.pos, colliders);
this.enemies.update(dt, this.player, colliders);
this.enemies.respawnDead(this.player.pos.x, this.player.pos.z);
if (this.missions.bossMissionActive(this._region) && !this.bossMgr.active &&
    this.missions.nearArena(this.player.pos, this._region)) {
  if (this.bossMgr.spawn(this._region)) this.missions.onBossSpawned(this._region);
}
this.bossMgr.update(dt, this.player);
this.dragons.update(dt, this.camera, this.player.pos);
this.powers.update(dt, { player: this.player, camera: this.camera, controls: this.controls,
  colliders, targets: [this.npcs, this.enemies, this.bossMgr] }); // powers hit all three
this.combatHUD.update(dt, this.camera);
this.missions.update(dt, this.player.pos, this._region);
this.missionHUD.render(this.missions.hudState(this._region));
this.missionHUD.update(dt, this.camera, this.player.pos);
```
Other Game edits: a **`map`** state (`_openMap`/`_updateMap`/`_closeMap`, **M** key) and a
**`dead`** state (`_onPlayerDeath`/`_updateDead`/`_respawnPlayer`); `_fastTravel(x,z,key)`
re-streams chunks + relocates enemies; `_enterInterior`/`_fastTravel`/`_onPlayerDeath`
call `bossMgr.despawn()`. `Player.js` gains `hp/maxHp/alive/hurt/heal/reviveFull`
and `onHurt`/`onDeath` callbacks.

**Wave-5 wiring** — the player owns its own ability instances; Game wires the HUD,
the sword's damage sink, and input. In `init()`:
```js
this.actionHUD = new ActionHUD(this.powers.powers);
this.powers.setHUD(this.actionHUD);              // ActionHUD replaces PowerHUD
this.player.sword.hitSink = (point, dir, radius, amount, knock, type) => {
  for (const t of [this.npcs, this.enemies, this.bossMgr]) t?.damageArea?.(point, radius, amount, type, dir, knock);
};
this.player.sword.setParticles(this.powers.particles);
this.player.sword.onSwing = (n) => this.audio?.sfx?.(n);
this.player.shield.onBreak = () => { this.actionHUD.flashShieldBreak(); this.audio?.sfx?.('shieldbreak'); };
this.player.dash.onDash = () => this.audio?.sfx?.('dash');
this.player.onParry = () => { this.audio?.sfx?.('parry'); /* spark VFX */ };
```
Per-frame in `_updatePlaying(dt)` (the sword swing must consume the mouse edge
*before* `powers.update`, which is told `meleeMode`):
```js
if (consume('KeyR')) this.player.toggleSword();
if (consume('KeyQ')) this.player.shield.toggle(this.player.stamina);
const dd = this.controls.consumeDash(); if (dd) this.player.tryDash(dd.f, dd.r, this.tpsCamera);
this.player.sword.blocking = this.player.combatMode && this.controls.rmbDown;
if (this.player.combatMode && this.controls.consumeMouse()) this.player.swordSwing();
this.powers.update(dt, { /* …targets… */ meleeMode: this.player.combatMode });
this.camera.fov = damp(this.camera.fov, fovForSpeed, 6, dt); this.camera.updateProjectionMatrix();
this.actionHUD.setSpeed(speedFrac);
this.actionHUD.setVitals({ hpFrac, staminaFrac, shieldFrac, shieldActive, shieldBroken, dashReady, weaponDrawn, blocking });
```
`Controls.js` adds right-mouse (`rmbDown`), `consumeDash()` (double-tap), and a
context-menu guard. `Player.update` ticks `dash/shield/sword/stamina` after movement.

### Texture & asset URLs used
Loaded at runtime from jsDelivr's CORS-enabled mirror of the three.js example
textures (base `https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/`):

| Asset | URL (relative to base) | Used for |
| --- | --- | --- |
| grass | `terrain/grasslight-big.jpg` | terrain ground diffuse (tiled, SRGB) |
| detail | `disturb.jpg` | bump on terrain + buildings + **characters** (player/NPC/enemy/boss) |
| roughness | `roughness_map.jpg` | water roughness (river + koi ponds) |
| water normal | `waternormals.jpg` | animated river / pond ripples |
| brick | `brick_diffuse.jpg` | available for region buildings |
| wood | `hardwood2_diffuse.jpg` | available for props |
| spark | `sprites/spark1.png` | Lightning / Atomic / Fry particles **and the sword swing-trail** |
| circle | `sprites/circle.png` | Water power particles (soft round droplet) |

Flying-dragon billboards try Wikimedia transparent dragon PNGs (see
[`DragonManager.js`](src/world/DragonManager.js)). The **shield dome** uses a
**procedural** hex "energy-field" `CanvasTexture` (built in `Shield.js`, no network
needed), and the **sword** is a modeled toon-metal blade that also takes the shared
`detail` bump via `applyDetail`. **Every** texture has a fallback, so the game looks
correct (procedural) even fully offline. To use your own art, drop files in
`/src/assets` and load them through [`Loaders.js`](src/assets/Loaders.js) /
`TextureLibrary`.

### Character model (glTF) URLs used
Rigged, textured, animated characters from the official three.js example models,
served by the CORS-enabled jsDelivr mirror (base
`https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/`), loaded via
[`Loaders.js`](src/assets/Loaders.js) `tryLoadGLB()` and managed by
[`ModelLibrary.js`](src/characters/ModelLibrary.js):

| Model | URL (relative to base) | Clips | Placement |
| --- | --- | --- | --- |
| `soldier` | `Soldier.glb` | Idle / Walk / Run | default avatar; one of the NPC models |
| `xbot` | `Xbot.glb` | idle / walk / run + more | avatar skin; NPC model |
| `robot` | `RobotExpressive/RobotExpressive.glb` | Idle / Walking / Running / Jump … | avatar skin; NPC model; **boss** (scaled + tinted) |
| `flamingo` | `Flamingo.glb` | flap | sky **bird** (BirdManager) + **flying villager** (NPCManager) |
| `parrot` | `Parrot.glb` | flap | sky **bird** + **flying villager** |
| `stork` | `Stork.glb` | flap | sky **bird** + **flying villager**; **flying roc mount** (scaled) |
| `horse` | `Horse.glb` | gallop (morph) | rideable **ground mount** (like webgl_instancing_morph) |
| `flower` | `Flower/Flower.glb` | — | **flower** patches (NatureManager) |
| `dragon` | `DragonAttenuation.glb` | — | real 3D **dragon** flying across the sky (DragonManager) |
| `enemybird` | `Parrot.glb` (forced dark) | flap | hostile **flying enemy** (EnemyManager) |
| `house` | `AVIFTest/forest_house.glb` | — | real modeled **houses** / hamlet (DecorManager) |

Non-glTF example assets (via the FBX / MD2 loaders), base
`https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/`:

| Model | URL (relative to base) | Loader / example | Placement |
| --- | --- | --- | --- |
| `fbxsmall` | `models/fbx/Samba Dancing.fbx` | FBXLoader · webgl_loader_fbx | **small enemy** (grunt) |
| `md2warrior` | `models/md2/ratamahatta/ratamahatta.md2` (+ skin `…/ratamahatta.png`) | MD2Loader · webgl_loader_md2[_control] | **medium enemy** (caster) + **boss** (scaled) |
| `littlestTokyo` | `models/gltf/LittlestTokyo.glb` | GLTF+DRACO · webgl_animation_keyframes | **animated town landmark** (DecorManager) |
| `statue` | `models/obj/male02/male02.obj` | OBJLoader · webgl_loader_obj | **stone statue** landmark (DecorManager) |
| `tree` | `models/obj/tree.obj` | OBJLoader · webgl_loader_obj | **real trees** in groves, two-toned (NatureManager) |

Each is height-normalized and `SkeletonUtils.clone`d per instance (own skeleton +
mixer). All maps are set to `SRGBColorSpace`. If a model fails to load, the entity
keeps its **procedural mesh** — so the game still runs fully offline.

### Add a new country / region (a few lines)
In [`Regions.js`](src/world/Regions.js) push one entry to `REGIONS`:
```js
{ key:'egypt', name:'Misr', native:'مصر', center:{x:-600,z:600}, accent:'#e0c060',
  ground:{ grass:0xcdb98a, grassAlt:0xd8c79a, path:0xc9a36b },
  trees:[{ type:'palm', density:3 }],            // new tree types → add a case in Assets._buildProp
  buildings:['in_haveli','in_temple'],           // new styles → add a case in Assets.buildRegionStructure
  landmark:'in_temple_grand', arena:{x:-600,z:540},
  boss:{ name:'Sphinx', native:'أبو الهول', hp:1600, color:0xd0a850, scale:2.8, xp:560 },
  enemy:{ name:'Mummy', color:0xb8a070, hp:130, dmg:10, xp:46 } }
```
Region ownership (Voronoi), terrain tint, scatter, procedural buildings, the boss
**and** its “defeat the boss” mission are all derived automatically.

### Add a new mission or boss (a few lines)
A boss + its mission come free from a region’s `boss:{…}`. For a bespoke quest, push
one object in [`MissionManager.js`](src/missions/MissionManager.js) `_buildMissions()`:
```js
{ id:'relics_japan', regionKey:'japan', kind:'custom', title:'Recover 3 relics',
  target:3, progress:0, done:false, active:true, locked:false,
  waypoint:{x:40,z:-60}, xp:200 }
```
then advance it from wherever it’s earned with `missions.progress('relics_japan')`.

### Add a new ability or weapon (a few lines)
Abilities live in [`src/abilities/`](src/abilities/) and are owned by the Player.
Pattern: a small class with state + an `update(dt, …)` and a one-line stamina gate.
```js
// src/abilities/GroundPound.js
export class GroundPound {
  constructor() { this.cd = 0; this.onPound = null; }
  trigger(player) {
    if (this.cd > 0 || !player.stamina.spend(30)) return false;  // ← stamina gate
    this.cd = 2.5;
    if (this.onPound) this.onPound(player.pos);                   // → damage + VFX (Game wires it)
    return true;
  }
  update(dt) { if (this.cd > 0) this.cd -= dt; }
}
```
Then in `Player`: `this.pound = new GroundPound()`, call `this.pound.update(dt)` in
`update()`, and bind a key in Game (`if (consume('KeyG')) this.player.pound.trigger(this.player)`).
Damage reuses the combat fan-out: `t.damageArea(point, r, amount, type, dir, knock)`
over `[npcs, enemies, bossMgr]` (exactly how the sword's `hitSink` works).

For a **new weapon**, copy [`Sword.js`](src/combat/Sword.js): build the mesh, attach
to `armR` on draw / the back on sheath, animate `armR` in `update()`, and call
`this.hitSink(point, dir, radius, amount, knock, type)` at the active frame. Add an
ability chip in `ActionHUD` and you're done.

### Add a new avatar mode / character model (a few lines)
In [`ModelLibrary.js`](src/characters/ModelLibrary.js) add a `MODEL_SPECS` entry:
```js
ninja: { url: 'https://…/Ninja.glb', height: 1.85, faceFix: Math.PI, label: 'Ninja' }
```
(`faceFix` rotates the model so its front faces the player's forward = -Z; most
three.js sample models need `Math.PI`. Height is auto-normalized.) Then add its key
to `Player.avatarModes` (cycle with **T**) — or pass it to `NPCManager.walkerModels`
/ set it as `BossManager.modelName`. Animation clips (idle/walk/run/jump) are matched
by name and the procedural fallback is automatic. **Wiring** (already in
`src/Game.js`): `this.models = new ModelLibrary(this.renderer)` then
`player.setModelLibrary(models)` / `npcs.setModelLibrary(models)` /
`bossMgr.setModelLibrary(models)`; `T` calls `player.cycleAvatar()`; tree wind is
advanced by `Assets.tickFoliage(dt)` per frame.

### Add a new monster archetype (a few lines)
In [`EnemyManager.js`](src/entities/EnemyManager.js) add a `MONSTER_TYPES` entry and
reference it from `GROUND_TYPE_BY_INDEX`:
```js
sniper: { hpMul: 0.7, dmgMul: 1.4, speedMul: 0.8, scale: 1.0, ranged: true, attackR: 30, model: 'soldier', label: 'Sniper' }
```
Stats auto-scale by region difficulty, the model + animation + hit flash + (for
`ranged`) the wind-up + pooled bolt are all handled. A boss is even simpler — add a
`boss:{…}` to a region in `Regions.js` and its mission is generated for free.

### Add a new spell (a few lines)
1. In [`Spells.js`](src/powers/Spells.js): `class FrostPower extends Power {
   constructor(){ super({name:'Frost',color:0x9fe8ff,icon:'❄',cooldown:1.2,manaCost:20});
   this.spellKey='frost'; this.locked=true; } cast(ctx){ ctx.damageArea(ctx.aim.point,4,20,'water',null,6); ctx.stunArea(ctx.aim.point,4,1.5); } }`
2. Add `new FrostPower()` to the PowerManager array and `'frost'` to
   `Progression.spells`. It auto-appears in a HUD slot, the skill tree, and scales
   with the damage/cooldown/AoE upgrades.

### Add a new mission (a few lines)
Push one object in [`MissionManager.js`](src/missions/MissionManager.js)
`_buildMissions()` with a `kind` of `collect` / `rescue` / `defend` (or `custom`):
```js
{ id:'fetch_scrolls', regionKey:'japan', kind:'collect', title:'Recover 3 scrolls',
  target:3, progress:0, done:false, active:true, locked:false, xp:120,
  points:[{x:30,z:10},{x:-10,z:40},{x:50,z:-20}].map(p=>({...p,got:false})), waypoint:{x:30,z:10} }
```
Tracking (visit points / reach a captive / hold an area), the waypoint marker, the
mission log, XP reward, and completion are all automatic.

### Swap a model for another example asset (a few lines)
In [`ModelLibrary.js`](src/characters/ModelLibrary.js) `MODEL_SPECS`, change the
`url` (and `kind`: `'gltf'` | `'fbx'` | `'md2'`, plus a `skin` for MD2). Example —
point the boss at a different MD2:
```js
md2warrior: { url: EXAMPLES+'models/md2/ogro/ogro.md2', skin: EXAMPLES+'models/md2/ogro/skins/ogrobase.png',
              kind:'md2', target:1.9, fit:'max', faceFix: Math.PI }
```
The right loader is chosen by `kind`; sizing/grounding/facing/animation + the
procedural fallback are automatic. (`faceFix` flips it ±π if it faces backward.)

### Add a new save field (a few lines)
1. Write it in [`Game.js`](src/Game.js) `_serialize()` and read it back in
   `_applyState()`.
2. If old saves must keep working, bump `SAVE_VERSION` in
   [`SaveManager.js`](src/save/SaveManager.js) and give the field a default in
   `_migrate()`. Mission/progression sub-state already round-trips via their own
   `serialize()`/`apply()`.

---

## Tech notes

- **Art style:** low-poly, flat-shaded, toon-ramped (`MeshToonMaterial` + a tiny
  gradient map). Geometries are merged non-indexed for a faceted look.
- **Physics:** lightweight custom capsule-vs-AABB / capsule-vs-circle resolution with
  gravity and terrain ground-snapping — no physics engine.
- **Audio:** fully synthesized via the Web Audio API (warm pad drone, looping wind,
  daytime cicadas, and a sparse koto-ish pentatonic melody), started on first click to
  respect autoplay policies.

Enjoy the walk. 🌸
