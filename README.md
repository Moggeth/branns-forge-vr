**Physical arrow attachment (2026-10-01):** Emberwing arrows and Siegebird bolts keep the struck bone's local impact pose, direction and penetration. Existing embeds now transfer without snapping when that part detaches or becomes physical death remains, including spring knees/ankles. Recovered bolts release the constraint. [Implementation, checks and limits](docs/PROJECTILE-ATTACHMENT-20261001.md). Relaunch normally; the running game and saves remain intact.

**Enemy hit accuracy (2026-10-01):** Emberwing and Siegebird now share visible animated surface contact across enemy families. Arrows pass through bone gaps, ordinary skeleton skull hits kill, body hits stay nonlethal individually, and embedded arrows follow the actual struck surface. Melee, fairy darts and returning weapons share the query. [Checks, performance and limits](docs/ENEMY-SURFACE-CONTACT-20261001.md). Relaunch normally to load; live games and saves were preserved.

**Mining Update (2026-10-01):** Stonewhisper now works local seams through cracking, exposure and extraction. Meteors and ordinary ore release physical chunks; aim and press E in FPS, or collect with a free-hand grip in VR. Rewards persist and enter the existing workshop/spell economy once collected. Golem plates share staged local damage. Sonnet 5.5 supplied crystals, shell fragments and fracture materials. [Controls, verification, performance bounds and remaining extensions](docs/MINING-UPDATE-20261001.md). Relaunch normally; live sessions and saves were preserved.

**Tree chopping coverage (2026-10-01):** Full-size scenery trees and imported trees now use the axe cutting/falling/log-collection loop. Imported trees remain batched until struck and rejoin the batch on regrowth. Orchard first hits use the correct scaled cut height, and fruit drops when its host tree falls. Relaunch normally to load; current games and saves remain untouched.

**FPS swing and material impact refinement (2026-10-01):** Sonnet 5.5 authored distinct pick, axe and hammer swings with fast contact and slower recovery, plus sharper stone chips/glints and softer dust. Codex integrated timing, directional debris and a fix for golem armour feedback suppressing the actual weapon contact. [Research, timing, source, checks and native review](docs/FPS-SWING-IMPACTS-20261001.md). Relaunch normally to load; current games, SteamVR and saves remain intact.

**Orchard hero trees and habitat (2026-10-01):** Sonnet 5.5 rebuilt the apple trees with branching trunks, flared roots, layered leaf sprigs and dappled shadows, then refined root litter, worn paths and riverbanks. Grove LODs retain the same seed, scale and orientation when converted to choppable trees; apples, stumps and log collection remain interactive. [Native views, checks, source and measured rendering costs](docs/ORCHARD-HERO-UPLIFT-20261001.md). Relaunch normally to load; resident games and saves were left intact.

**Ground and understory refinement (2026-10-01):** Sonnet 5.5 supplied three visual iterations: textured garden drifts replace primitive flowers, woodland soil has a warmer readable finish, ground transitions and fine detail are refined, clutter clusters around roots/rocks/banks, and near canopies cast leaf-filtered shadows. Batching, terrain edits, paths and weather remain integrated. [Visual review, source, measured costs and checks](docs/GROUND-REFINEMENT-20261001.md). Relaunch normally to load; resident games and saves were left intact.

**Skeleton motion and physical continuity (2026-10-01):** All three guardians have Sonnet 5.5-authored bent-knee rigs, planted feet, turning steps, smooth transitions, local hit recoil and clearer windup/strike/recovery. Ordinary living impacts keep their roots planted; missing legs hop and missing shield arms change the stance. Attacks follow the visible weapon sweep at each rig's own reach. Detached parts preserve the current mesh, pose, material and motion; loose legs retain spring knees/ankles and full foot contact. [Source, review, measured costs and checks](docs/SKELETON-ANIMATION-20261001.md). Relaunch normally to load; current games, SteamVR and saves were left intact.

**RTS quick-cast (2026-10-01):** Defaults on. **1–9** casts point spells under the current cursor (**Land / 5 = Starfall**); hold a line spell’s number at its start, move, then release at the end. **Q** in RTS or **Quick: On/Off** toggles back to selection-and-click; the preference is saved. Ground previews were audited across all 23 spatial actions, with corrected Sunder width, invalid Starfall colour and live construction dimensions. [Controls and checks](docs/WORLD-BUILDER.md). Relaunch normally to load; resident games and saves remain intact.

**Native dual views and golem rebuild (2026-10-01):** Both live cameras now render at their pane's full pixel resolution. Choose **Split** for side-by-side FPS/RTS, **Flip** to exchange sides, drag the divider or choose **40% / 50% / 60%**, and **Inset** for picture-in-picture. **Tab** switches control focus without changing layout; **Escape** frees the mouse so you can edit the views; click the FPS pane to recapture. **Shift+F9** changes layout and **F11** toggles fullscreen. FPS Q/R no longer snap-turn; R retains crossbow reload/reeling. **Encounters / F4 / 1-6** now summons skeleton patrols, duelists, shield pairs, rats, ghosts and golems on other maps as well as the Orchard. Sonnet 5.5 High supplied the textured golem; it now has breakable stone armour, an exposed core and a telegraphed slam. [Controls, sources, measured checks and limits](docs/DUAL-VIEW-AND-GOLEM-20261001.md). Relaunch normally to load; running games and saves were left intact.

Open **Brann's Forge Launcher** from the desktop or run `Brann's Forge Launcher.cmd` in this project. Choose Adventure, local Director, Fairy, or **World Builder**; choose VR or desktop; then press **Start Game**. Hover or select an option for a plain-language explanation. The launcher stays open, shows session status and errors, and includes Labs & Demos, Stop, and logs. The 22 older `.cmd` entry points remain in `launcher/legacy/` for compatibility, and the two old lab desktop shortcuts are backed up in `launcher/legacy-shortcuts/`. The game start/stop PowerShell backends remain at the project root for troubleshooting. See [launcher guide](launcher/README.md).

**Reset World:** Open **M → Reset World…** on desktop, or **B → Travel → Reset World…** in VR. Confirm **Yes, Reset World** to restore the Orchard's original seeded landscape, clear settlement changes and resources, and return to a clear spot at Brann's Forge. Character progress and crafted items stay; the old world is backed up first. Cancel changes nothing. Relaunch once to load this feature. [Backup recovery, checks and limitations](docs/WORLD-RESET.md).

**Travel and living Orchard (2026-10-01):** **M** opens a direct destination Map, **F** visibly selects a destination, **G** travels, and **I** opens Supplies; VR has a physical **B → Supplies** guide. Resource owners, item controls, costs, equipment and unavailable states are explicit. Spawn/travel and more forgiving walking use current deformed terrain and clear capsule checks. Ents and skeletons occasionally wander between long rests. Starfall and Crystal Faults now have Sonnet 5.5-authored faceted crystals, shared nearby lighting, a moving entry light, pooled debris/dust and spatial sound; the crater commits on contact and the rock settles into its actual bed. The ten-meteor cap is replaced by near/far batching and a 256-record safety budget; 128 records were checked through save/reload. [Controls, authored source, measured checks and remaining headset limits](docs/ORCHARD-TRAVEL-STARFALL-20261001.md). Relaunch through the launcher to load this pass.

**Starfall, physical contact and world presentation (2026-10-01):** Meteors have a closed solid shell and matching surface collision. The pick's working points sweep between poses, stop at rock, briefly bite and release through withdrawal or levering; mining leaves saved scars. Material-specific chips, splinters, dust, sparks and sounds replace the generic physical-impact sphere. Sonnet 5.5 supplied the impact/target art, animated Mana refinement and an 18-prop/six-material ground kit used across the twelve regions. World Builder defaults to 120 fps with both live cameras visible: drag/resize the inset, use **Swap views** or **F9**, and **F11** for fullscreen. All implemented spatial actions have terrain-conforming previews; the card grid and category/cost icons are readable, with fading red errors. Respawn checks a supported clear capsule and relocates overlapping equipment before returning control. [Controls, sources, measured checks and limitations](docs/STARFALL-PHYSICAL-RTS-20261001.md). Relaunch through the normal launcher to load this source update; live games and saves were not restarted.

**Shared-world RTS update (2026-09-30):** The illustrated Mana panel provides F1–F4 palettes, 1–9 shortcuts, costs, cooldowns, repeated casting and ground previews, with a selectable 4× regeneration preset. Manually place bridges, ramps, stairs and boardwalks that the Hero and lumberjacks can use. Awaken actual trees into Ents, calm Apple guardians for edible healing fruit, quench burning trees, and recover seeds to plant persistent trees. Patrol objectives pay bounded new-sector rewards. [Controls, persistence and limits](docs/WORLD-BUILDER.md); [source and measured verification](docs/RTS-SHARED-WORLD-20260930.md); [outposts, component golems, weather objectives and creature candidates](docs/RTS-SHARED-WORLD-DIRECTION.md). Relaunch normally to load this source update; existing sessions and saves were left untouched.

**VR held-object steadiness (2026-09-30):** Small controller tremors are damped with subtle adaptive positional/rotational inertia; deliberate swings respond faster and heavier objects receive a little more weight. Glove and object share the same filtered grip, while HMD tracking, throws and climbing remain raw. In the hand menu's Tuning page, **Held-object steadiness** defaults to **0.65**; **0** restores exact tracking. Relaunch normally to load it. [Integration, checks, performance measurements and limits](docs/VR-HELD-STEADINESS.md).

**FPS/VR playtest update (2026-09-30):** Snow stays anchored to the world and retains its completed surface coverage while the next scan runs. FPS tools have a diagonal working-plane swing and tiny idle motion; **Space** jumps, **E** takes/gently drops, and **X** throws. Hold **RMB** through an axe swing for Power Cleave. With Siegebird held, **C** near its forge supply rack fits or returns the physical reel, **RMB** switches bolt/grapple mode, and **hold R** reels a tether. Bolts hit animated bones and pass through their gaps; an ordinary skeleton skull shot kills, while torso shots require several hits. Three axe strikes at the same height now show progressive Sonnet-authored cuts and leave a stump at the cut height, with a physical log collected by intentional E/grip pickup while standing. Brann's first available job asks for **three physical Skeleton Skulls** in the portable basket on the forge approach. While carrying it in FPS, aim at a loose skull and press **F** to store it; in VR release skulls into the opening. Stored skulls persist and count even if deposited before accepting the job near Brann. Walking through a portal works with FPS movement, VR locomotion and room-scale walking. [Controls, verification, saves and limits](docs/PLAYTEST-20260930.md). Relaunch normally to load these changes; the current game has been left running.

**Emberwing phoenix bow (2026-09-30):** Sonnet 5.5's swept feather limbs, textured grip and brass phoenix frame conventional arrows. Take it from its collection stand or the hand menu's Dev Tools; desktop **0** equips it. In VR, use the free-hand trigger at the back quiver, bring the arrow to the rest, draw and release that trigger to shoot. Hold the bow-hand trigger and move, turn or roll the bow to shape a curved shot; the arrow's ethereal wings bank through the turn. Desktop: hold left click to draw, release to fire, and hold right click while turning to bend. [Actual-game screenshots, controls, source, checks and limitations](docs/EMBERWING-20260930.md). Relaunch to load this new native interaction.

The [Emberwing designer review](assets/emberwing-sonnet/REVIEW.md) provides twelve labelled standard views, a public orbit showroom and a full-resolution review ZIP with GLBs and editable source. The image set can be rebuilt deterministically in about five seconds without a model commission.

Emberwing's [craftsmanship refinement](assets/emberwing-sonnet/REFINEMENT.md) adds a solid leather grip, raised arrow window, connected string fittings, sculpted bronze/gold phoenix and varied cambered feathers. Walnut, stitched leather, engraved brass, ember inlays and sapphire eyes have distinct material treatment. Both articulated gloves and dark draw/curve poses were reviewed in Godot; 38 archery assertions pass. The 15,732-triangle bow uses 13 surfaces and no added lights. Relaunch to load the new mesh.

**Enchanted Kitchen visual rebuild (2026-09-30):** Sonnet 5.5's timber hall, hearth, counters, shelves, magical teacups and textured supper table replace the primitive interior while preserving rats, routes and collision. The static room is compiled into 20 material batches so the actual-game review uses fewer ground-eye draw calls than the old room. [Matched screenshots, source and rebuild/check commands](docs/KITCHEN-ART-20260930.md). Relaunch the game to load it.

**Mushroom Glade visual rebuild (2026-09-30):** A Sonnet 5.5-authored pond, mossy ruin, waterfall, roots and varied violet fungi replace the old disc and generic mushrooms. Spore pickups, wisp, portal approaches and wading floor remain intact; large stems and boulders have physical collision. [Actual-game screenshots, source, rebuild and route checks](docs/GLADE-ART-20260930.md). Relaunch the game to load it.

**Pinewood Ruins visual rebuild (2026-09-30):** Sonnet 5.5's ruined mossy gate, stone walls, conifers, fallen timber and textured woodland path now frame the original harvest trees and Mossward encounter. The prior flat floor remains collision-only; 38 authored solid proxies leave the protected route clear. [Actual-game eye-level and RTS captures, source, rebuild and checks](docs/PINEWOOD-ART-20260930.md). Relaunch to see it.

**Crystal Hollow visual pass (2026-09-30):** Sonnet 5.5's mineral strata, ore seams, rooted crystal clusters and chasm rims now add detail within the earlier vaulted cave. The interactive Prism Vault, bridge, ore and enemies are preserved. [Actual-game comparisons, editable source, rebuild and protected-route checks](docs/CRYSTAL-ART-20260930.md). Relaunch to load the kit.

**Stonewhisper visual rebuild (2026-09-30):** The mining pick now uses Sonnet 5.5's authored twin-crescent steel head, textured ash haft and leather grip, brass socket, and resonance crystal. The full head collides; right-click/trigger charges the crystal for eight seconds, and an ore strike consumes the charge for a richer seam. The charge adds one small shadowless light in dark areas. Editable Blender source, deterministic builder, preview renders and asset handoff are in `assets/stonewhisper-sonnet/`; the installed GLB and Godot-extracted textures are in `godot/weapons/`. See [integration, tests and capture](docs/STONEWHISPER-20260930.md). Relaunch the game to see it; an existing session does not hot-load the GLB.

**Pocket Thunder visual rebuild (2026-09-30):** Bombs retain their fragmented formation and thrown arc, now using thirteen irregular forged shell plates around a glowing heart. The explosion has a brief warm light pulse, directional physical-looking chips, sparks, a broken ground wave and settling embers/smoke. Eight burst rigs and two shadowless lights are the fixed budget; throw physics, damage and fuse timing remain in gameplay code. Sonnet 5.5's editable source, revised renders and in-engine frame sheet are in [the asset handoff](assets/pocket-thunder-sonnet/HANDOFF.md). Godot's installed GLB/shaders are under `godot/pocket_thunder/`. Relaunch the game to load the new art.

**Destination portal rebuild (2026-09-30):** The 22 gates now share a Sonnet 5.5 authored visual kit with seven destination variants, animated energy, local motes and distance-based detail. Portals have nonblocking interaction surfaces, so their centres can be walked through while the travel action remains ray targetable. The seven Forge Yard gateways have been reviewed in actual ground-level and elevated game captures. [Editable source and renders](assets/portal-kit-sonnet/HANDOFF.md), [collision and art contract](docs/PORTAL-ART-CONTRACT.md). Relaunch the game to load the new art.

**Orchard bank art (2026-09-30):** Four Sonnet-authored, textured boulder/slab/log/fern variants now dress the procedural Orchard through the existing instancing, weather, path-clearing and terrain-reprojection systems. [Source, close game captures, timings and verification](docs/ORCHARD-BANK-ART-20260930.md). Relaunch to load the new GLBs.

**Forge Yard exterior art (2026-09-30):** Sonnet 5.5's layered ridges, planted gardens, path edges and supply racks replace the crude backdrop-rock ring while leaving the existing forge building and all seven portal approaches clear. [Before/after game captures, source and verification](docs/FORGE-YARD-ART-20260930.md). Relaunch to see it.

**Mooncap Lantern visual refinement (2026-09-30):** Sonnet 5.5's veined mushroom cap, softer luminous gills, aged brass and wrapped grip replace the plain procedural lantern. The carried light and six-second slowing-spore garden still work. [First-pass and refined actual-game captures, editable source and verification](docs/MOONCAP-LANTERN-20260930.md). Relaunch to load it.

**Swallow Line visual rebuild (2026-09-30):** Sonnet 5.5's curved talons, textured grip and rope-wound reel replace the oversized procedural spool. The reel is connected to the existing reeling motion, and the live tether begins at the authored hook. [Before/after game captures, editable source and mechanical check](docs/SWALLOW-LINE-ART-20260930.md). Relaunch to load it.

**Latest playable pass (2026-09-29):** On desktop, **F9** now opens the World Builder as a full-window view of the same running world; F9 or Escape returns to the Hero and F11 toggles a resizable window. **9** equips an already-owned Siegebird directly, and F1 explains the 1–9 loadout. Orchard's Edge faces forward in FPS and its click swing follows the camera and visible contact. Living skeletons jolt locally when struck without sliding away; a starter hammer's fiery Forge Pulse gives every new player a fire-only way to fight ghosts. Travelling lumberjacks visibly walk. Five quiet original music cues crossfade for settlement, exploration, mystery, combat and RTS while leaving intervals for ambience. A fog reset that hid most other zones has been fixed; [the 12-zone art audit](docs/environment-art-audit.md) provides matched eye-level and RTS captures for the next visual pass. Changes to a running game still require a normal relaunch.

**Living Orchard landscape (2026-09-29):** The flat Orchard floor is replaced by one seeded, chunked heightfield with rolling ground, a carved stream/banks and terrain-aware vegetation. The World Builder can **Sunder**, **Raise Earth**, **Grow Forest**, **raise an Earthen Wall**, **grow a Tree Ring**, **call Starfall**, and **raise a Crystal Fault** in the same live world as the Hero. Starfall damages nearby characters, leaves a real crater, and creates a persistent meteorite that Stonewhisper can mine for spell materials. Terrain commands, grove placements and resources persist; collision, drainage, enemy/lumberjack routing and nearby dressing respond locally. [See actual game screenshots and controls](docs/TERRAFORMING-SPELLS.md), [architecture and checks](docs/LIVING-LANDSCAPE.md), and the [Opus visual rebuild handoff](docs/ORCHARD-VISUAL-REBUILD.md). Relaunch the game to load this source update.

**Orchard atmosphere (2026-09-29):** The playable Orchard now shares a day/night lighting palette, bounded sunshafts and mist, layered worn/wet terrain, water ripples, wind-driven foliage and rain, plus nine Opus 5.5-authored woodland assets scattered in ecological clusters. Player-carved paths immediately clear foliage and change the same ground mask. The default is balanced; `--atmosphere-quality=low|high` scales shadows, particles and foliage. [System, asset rebuild, verification, desktop performance and VR limits](docs/ATMOSPHERE.md). Relaunch the game to load the new art and shaders.

**Live Orchard world-builder (2026-09-28):** A second player can survey the actual 320 × 320 m Orchard Highlands while the Hero plays in VR. Carve persistent paths, assign up to five Opus-animated lumberjacks to individual trees, grow groves, build an Opus stone-and-timber bridge from delivered lumber, and raise bounded Mossward skeleton patrols for encounters. The Hero can walk the same paths and bridge immediately; chopping an orchard tree with Orchard's Edge changes the strategic timber ledger. Choose World Builder in the launcher to start together in the orchard, or press **F9** in an already-running game's desktop mirror. This is same-PC simultaneous play, with a saved common world; networked play is still future work. [Controls, state, art, checks and limits](docs/WORLD-BUILDER.md).

Source control: this child project is versioned independently from the parent personal-project workspace. A fresh Windows checkout can run `Setup Tools.ps1` to download Godot and install the Node/Electron dependencies, then use the launcher above. Git includes game/service source, playable assets and curated editable commission sources in `assets/source-commissions/`. Large exported builds, recordings, logs, tools, browser state, local saves and working folders stay on this PC and are ignored; rebuild previews from source when needed.

**Orchard 2D ↔ 3D R&D (2026-09-28):** Five isolated, walkable 80 m scene variants compare direct Opus 3D, generated-map extraction, 2D-reference-led Opus 3D, procedural generation and a hybrid. A saved 160 m variant tests scale. The [experiment handoff](experiments/visual-2d3d-20260928/README.md), [results](experiments/visual-2d3d-20260928/reports/RESULTS.md) and [evidence gallery](experiments/visual-2d3d-20260928/gallery/index.html) include launch commands, source imagery/models, matched captures and limitations. This prototype is separate from the live orchard.

**Apple Orchard expansion (2026-09-27):** The orchard is now a 320 × 320 m, 11.1×-area landscape with six explorable plots, a long trail loop, 399 seeded scenery trees, playable apple trees, lumber, skeletons and grapple anchors. Opus 5.5's 23-piece modular environment library adds apple trees, hedges, shrubs, mossy rocks, paths, ruined walls, rubble and distant mountains; the ground and atmospheric colours have also been retuned. The [orchard handoff](docs/ORCHARD-EXPANSION-20260927.md) covers source files, procedural placement, rebuilds, captures, checks and performance limits. Relaunch the game to see the change; the Pinewood Ruins route still leads there.

**Forge Yard and Crystal Hollow update (2026-09-27):** The Forge Yard has an Opus 5.5-authored timber/stone workshop shell, roof, chimney, banners and a clearer three-station layout. Fire and crossbow supplies now sit in porch bays, leaving the collection approach open. Crystal Hollow has a new modular cave, arch and Prism Vault around its original traversable bridge. Its two persistent seals are a playable invention challenge: crack one with Stonewhisper or Pocket Thunder; wake the other with Hollow's Song or three hammer blows; then touch the opened vault for a permanent 20% incoming-damage reduction. The journal and Brann's live conversation context report the real challenge state. Relaunch the game to load these changes. Editable Blender source, deterministic builders, in-game integration, validation commands and headset limits are in [the Forge Yard / Crystal Hollow handoff](docs/FORGE-HOLLOW-20260927.md).
The desktop shortcut now reuses a single launcher window without leaving a command console open. A VR session still has one Godot game window, a SteamVR mirror, SteamVR/Vive processes, and hidden voice/service helpers.

Previous playtest slice: Opus-authored Pocket Thunder glove hands replace the old procedural meshes, with articulated fingers and a calibrated avatar forearm-to-cuff link. Bombs have a bound metal shell, brighter fracture seams and a fuller burst while keeping the familiar thrown arc. The material pouch can be lifted from the belt to open its menu in front of the player and returns on release; bolts sit closer to the body, and belt rotation follows yaw more tightly. Skeleton limb strikes sever more readily and detached legs have shaped shafts, joints and toes. Wyrmspout's stream has five bounded shadowless lights and stronger per-packet emission. The workshop and Emberdew boards now use shorter text. Pumpkin cuts use the actual strike position and have closed flesh faces. Art handoffs and focused checks are described in [verification notes](docs/VERIFICATION.md). Relaunch the game to see these changes; final reach, wrist continuity and frame-time tuning require a headset playtest.

VR playtest update: the launcher now starts SteamVR itself when needed and waits for a stable compositor before opening the game; `scripts/Ensure-SteamVR.ps1 -ProbeOnly` checks the installed path without opening the headset, and `logs/steamvr-startup.log` records startup failures. The tracked body sits 9.5 cm behind the headset yaw, the axe's cutting edge faces away from both Knuckles hands, and leather/brass holsters have tool-specific resting poses. Wyrmspout uses a bounded pool of shadowless lights traveling with its flame packets and separate floor-hit ignition cadence. Living skeleton hits move individual parts without translating the root; Mossward's authored stride matches its walk, support feet sample the ground, living heads and limbs can detach, and loose legs have springy knees/ankles with a collision volume at the foot. These changes require a normal game relaunch; headset comfort, foot contact on varied terrain, and SteamVR's actual Vive Pro 2 display readiness still need a live VR playtest.

**Skeleton combat slice:** Orchard's Edge is an Opus-built, self-contained GLB with a readable cutting edge, an applewood haft and a crushing poll. In the playable Knuckles grip the blade points forward along the index finger; the contact tip, collider and blade-versus-poll logic follow that orientation. Normal blade contact uses swing speed, weapon mass and edge orientation: the axe can bite into bone and stop. Hold the holding controller's trigger while swinging (RMB + LMB on desktop) for a stronger cleave. Skeleton limbs and heads can crack, detach and become grabbable clubs; losing legs slows movement and losing arms weakens attacks. Pull a stuck axe back to free it; a hard yank can bring a bone with it, which the other hand can grip off the blade. Ordinary hits stagger living skeleton parts without pushing the whole actor; dead bone physics still scatter. Mossward has a knee-rigged limp and attack, while the other guardians retain the earlier rig. Offline regression: run Godot with `--headless --xr-mode off --path godot -- --skeleton-combat-check`, or `--script res://grip_pose_checks.gd -- --grip-pose-check` for both simulated VR hand poses. See [combat slice notes](docs/SKELETON-COMBAT-SLICE.md).

**Orchard apples are physical targets.** Tap one lightly to make it wobble on its stem; strike or shoot it harder to knock it loose. Fallen apples collide and can be picked up. In VR, hold one by your mouth for three crunchy bites to recover 40 health; on desktop, pick it up and left-click three times. Tree fruit regrows after about a minute. The visible fruit in playable trees is capped at six per tree so each apple can be hit individually without turning the orchard into hundreds of active rigid bodies. See [apple interaction notes](docs/APPLE-INTERACTIONS.md) for tuning and the focused regression check. Relaunch the game to load these changes.

Desktop Hero controls use captured first-person mouse look: click once to capture, aim freely, and press Escape to free the cursor. Left-click fires Siegebird or visibly swings a melee tool; right-click uses its alternate action. Siegebird automatically cocks and seats a bolt when first taken; after firing, R animates cocking and seats another bolt from the unlimited quiver. Hold R to reel an attached grapple line, and use right-click to switch standard/grapple bolts when the reel is fitted. The bomb glove still forms on press and throws on release. Walking gives held gear a subtle bob. F11 toggles actual fullscreen and restores the previous window mode. A small status card replaces the overlapping shortcut text; F1 expands the full control list. Focus loss and opening a menu release mouse capture. On death, the desktop Hero now returns to clear ground on the forge approach instead of the crowded workshop centre; the chosen location is logged as `DESKTOP_RESPAWN`. Run `scripts/check-desktop-hero.ps1` and `node scripts/check-siege-ledger.cjs`; see [desktop input diagnostics](docs/DESKTOP-HERO-CHECKS.md). Source changes require a normal game relaunch.

For art commissions, `scripts/Run-Sonnet-Commission.ps1 -CommissionDir work/<isolated-folder>` checks the personal Claude.ai Pro account in a child environment with API overrides removed, pins `claude-sonnet-5-5`, verifies the session's reported model, and writes an ignored timing row. Each folder needs a `BRIEF.md` and owns its own output; the live checkout is changed only after Codex reviews, imports and tests the result. `python scripts/asset_lab.py inspect assets/asset-lab/stonewhisper.json <candidate.glb>` checks the mining pick's size, budgets and required anchors before installation. A subscription limit or failed identity/model check is a stop condition, never an API-billing fallback.

The static zone-kit adapter in `godot/authored_zone_kit.gd` accepts an authored `placement.json` with local GLB filenames and zone-local metre positions. It batches repeated meshes into 64 m chunks; only placements marked `collision: "asset_default"` use the optional `asset_meta.<id>.collision` box/cylinder proxies, while gameplay and harvest bodies remain intact. Place a kit at `godot/assets/zone_art/<zone-id>/placement.json` with its GLBs alongside it; `WorldZones.build()` installs it after batching legacy dressing, so additional environment commissions do not need a new gameplay hook. Verify its import, transforms and actual GPU rendering with `tools/godot/Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://authored_zone_kit_checks.gd -- --kit-capture=<absolute PNG path>`; the same script also passes headless without the capture flag. The checked-in `godot/assets/orchard_kit/zone_kit_fixture.json` documents the manifest schema.

After installing a new environment family, run `scripts/Verify-ZoneArt.ps1 -Zones <zone-id>` (add `-Render` for all 24 ground/RTS captures). It validates local GLBs, catches black textures and inverted face winding, imports into Godot, and checks authored collisions against protected walking/gathering sites in Quarry, Foundry, Kitchen, Glade, Pinewood and Crystal. Logs and a machine-readable validation report are kept under ignored `logs/`. The [art audit](docs/environment-art-audit.md) records the before baseline and limits of its render statistics.

Sandstone Quarry now uses a Sonnet 5.5 authored kit of layered strata, work scaffolds, cut slabs, lanterns and a mine entrance. Its ore, golem and bomb breach remain gameplay-owned. The kit's 58 simple collision proxies leave the protected route clear. [Before/after game views, performance numbers and rebuild instructions](docs/QUARRY-ART-20260930.md).

Ember Foundry now has a Sonnet 5.5 basalt-and-iron gate, slag, railwork, rim and floor inlays. Its boss, skeleton, iron, lava and entry portal remain in place. [Actual-game views and rebuild/verification notes](docs/FOUNDRY-ART-20260930.md).

Gloamfen now uses the first installed Sonnet 5.5 environment kit: a connected boardwalk, fen-tree canopy, layered banks, lanterns, ruin stones and a tall arch-tree landmark. Source and actual-game previews are in `assets/gloamfen-sonnet/`. Run the focused navigation check with `tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://gloamfen_art_checks.gd --quit-after 2400`. If the manifest is absent, the prior procedural wetland dressing remains as a fallback.

Sky Garden and Cloudbreak Keep now use a second Sonnet 5.5 environment family: cliff-sided floating islands, flowering/stone paths, shelters, wind-shaped trees and art-directed grapple posts. The old standing floors and gameplay anchors remain authoritative; 98 selective solid proxies let players touch major new structures without blocking grapple routes. The windmill's authored rotor still turns and responds to its control. [Before/after game captures, budgets, rebuild and verification](docs/SKYLANDS-ART-20260930.md). Run `godot/skylands_art_checks.gd` headlessly after changing island art or placement; both zones fall back to their prior dressing when their manifests are absent.

Starfall Ridge now uses a third authored art family: a crystal-lined mining valley, scarred meteor fragments and a ruined observatory. Its ore, bomb breach and grapple route remain playable; major rock and ruin pieces have selective collision. [Actual-game before/after views, rebuild and known terrain limits](docs/STARFALL-ART-20260930.md). Run `godot/starfall_art_checks.gd` after changing its art or placements.

The current [weapon feel baseline](docs/WEAPON-BALANCE-20260929.md) records each tool's primary and alternate role, the 66-HP living-skeleton target, frontal shield behaviour, and the remaining live-playtest decision about unlimited Siegebird bolts.

The three shield guardians use Opus-authored, skinned skeletons with distinct idle, walk, and attack animation. Mossward now has a separate-knee rig, visible fractures and a looser limp; Prismwatch and Cinderkeep retain their original rigs and share the new secondary gait and hit reactions. Existing shield stealing, collision, combat and physical bone debris remain under the original gameplay systems. The published GLBs live in `godot/guardians/rigged/`; the new Mossward source and builder are in `work/opus-mossward-knees-20260927/output/`, while the other original sources are in `work/opus-skeleton-rig-20260926/output/`. Actual Godot captures include `outputs/mossward-knee-combat.png`, `outputs/guardian-prismwatch-rig.png`, and `outputs/guardian-cinderkeep-rig.png`. Run `scripts/check-guardian-rigs.ps1` for isolated import/pose validation, then Godot `--guardian-check` for in-world logic and `--script res://guardian_authored_animation_checks.gd` for the animation adapter. [Validation and rerun guide](docs/GUARDIAN-RIG-VALIDATION.md). A normal game relaunch is required to load these art and input changes.

Engineering references: [continual development limits and offline capability audit](docs/CONTINUAL-DEVELOPMENT-ARCHITECTURE.md), [proposed remote session architecture](docs/MULTIPLAYER-SESSION-ARCHITECTURE.md). The versioned session contract in `service/session-contract.cjs` has replay/role tests but is not network-enabled. Multiplayer remains a design proposal; the local Director is still same-PC play.

Opt-in asymmetric playtest: **The Director** lets a second player command threats against a VR/desktop adventurer in Pinewood Ruins; Little Wing can join as an ally. In the launcher, select **Director**, **VR headset**, and **Native window** for local VR plus projector, or **Monitor / projector** for a no-headset rehearsal. The second native Godot window has a strategic camera on the same live world, direct hotkey summons, and 30/60/uncapped view options; hover an approach and press 1–4 to cast. The older browser mode is still offered as a slower fallback. See [rules and tests](docs/ASYMMETRIC-DIRECTOR.md). This is same-PC play, with no remote invitation link yet.

Latest environment source update: twelve low-cost distant landscapes, shaped apple/pine/fen trees with reachable orchard fruit and intact chopping, plus new quarry/crystal/foundry landmarks and Cloudbreak island undersides. Restart the normal game to see it. See [the environment sprint handoff](docs/ENVIRONMENT-SPRINT-20260925.md) for captures, measured cost, verification, recovery and headset limits.

Latest combined fluid/light snapshot: `outputs/ember-creek-build/Play Flight Practice.cmd` or `Play VR + Fairy.cmd`. K visits Ember Creek. Pour/light/quench/dry/relight, then carry flame through its gate. Reset/return/brightness signs included. Existing AFTER DARK, controller guide and fuel timings preserved. Verification: `node scripts/check-ember-creek.cjs [--pack <pck>]`.

Latest combined snapshot: `outputs/fairy-controller-build/Play Flight Practice.cmd` (or `Play VR + Fairy.cmd`), preserving AFTER DARK spaces and adding controller-only practice. Hold Start + Y guide / X retry / A hand / B fling / LB clear / RB home. Full actual-action guide check: `node scripts/check-fairy-guide.cjs [--pack <pck>]`.

Latest fairy expansion: `outputs/fairy-night-build/Play Flight Practice.cmd` or `Play VR + Fairy.cmd`. Three AFTER DARK spaces, shoulder perch, borrowed light and duet healing. J visits night walks; H shoulder; Middle/R/Y pulse. See `docs/FAIRY-PLAY.txt`. Staged separately; no existing game restarted.

# Brann's Forge VR

**Weapon inspection:** `python scripts/weapon_review.py` produces standard
actual-engine model, VR grip, FPS and holster diagrams in one cached offline
batch. `--weapons woodland_axe,siegebird` narrows the selection; `--check-only`
runs the pose audit without screenshots. [Workflow and coverage](docs/WEAPON-INSPECTION.md).
`--verify-repeat` compares two runs and includes the evidence in the review ZIP.
The 20-item suite takes about 26 seconds, checks 100 pose conditions and makes
308 captures; an unchanged cached run took 0.117 seconds. Confirmed FPS tool,
VR shield/lantern and shield-holster poses are corrected, and saved adjustments
are now scoped to the authored pose so stale calibrations cannot restore an
older orientation. Relaunch normally to load the runtime fixes.

**Asset authoring:** `scripts/asset_lab.py` now offers a repeatable Blender → GLB →
Khronos validation → disposable Godot import path for new models. Run
`scripts/Setup-AssetLab.ps1 -SmokeTest` once, then build the small Forge Yard
lantern with `python scripts/asset_lab.py build assets/asset-lab/pilot/asset.json`.
The [lantern comparison](assets/asset-lab/lantern-comparison/README.md) puts
independent GPT-6 Sol and Claude Opus 5.5 versions on adjacent Forge Yard
collection stands. Both have the same grip, physical shutter, trigger toggle,
lighting and drop/return behavior. This is a playable asset-pipeline trial,
with editable sources and a 53-assertion in-game regression.
Inspect an existing complex weapon with
`python scripts/asset_lab.py inspect assets/asset-lab/siegebird.json godot/assets/siegebird/siegebird.glb`.
Outputs and logs go to `outputs/asset-lab/`; builds never replace live assets.
The [Asset Lab R&D and handoff](docs/ASSET-LAB-RD.md) covers tool choices, model
requirements, asset contracts, limits and the next integration steps.

Three existing creations now use generated concept art as **selective, in-game
surface detail**: Mossward's painted shield, Siegebird's feather enamel, and
Hollow's Song's crystal inclusions. Their silhouettes and interactions remain
the same. See [the texture trial](docs/GENERATED-TEXTURE-TRIAL.md) for actual
Godot captures, rebuild paths, and what the experiment did and did not prove.

Siegebird now uses Opus 5.5's original **Kingfisher** model: feathered teal/ivory limbs, textured walnut, brass bird details and articulated mechanisms. The normal game launchers load it on the next launch while retaining the existing item ID, collection and controls. See [the asset handoff and rebuild instructions](docs/SIEGEBIRD-OPUS.md). Historical exported demo packs remain snapshots; they do not automatically acquire source updates.

A native single-player OpenXR invention adventure for Vive Pro 2 and Valve Index
controllers. Explore twelve handcrafted core fantasy zones, gather small offerings, and
permanently expand Brann Copperpot's workshop. Physical tools open new possibilities;
bespoke commissions create original GLB models and bounded JavaScript abilities
that arrive in the running game. Godot 4.7.2 renders the world; a local Node service
owns progression, voice and commissions. The original BomberWLAN remains untouched.

## Living Workshop — build through play

The native game now accepts versioned **Living Workshop packages** while running.
Brann can inspect the supported capabilities, publish creations or related batches,
check the game's actual acknowledgement, and restore an earlier version. A held
creation keeps its exact old version until released. An occupied region retains
its floor until you leave. Invalid changes preserve the working world.

The turquoise **Hall of Inventions** gate west of Brann opens a spacious history
hall. Browse six version records per page, read their prompts and ancestry,
retrieve historical items, restore/remove experiments, or enable the ancestry
lens. Existing full-size weapons remain at their named collection stands. The
archive displays record medallions and retrieves full models on demand.

Try the hall's experiment console: a 64m climbing/grappling garden, reactive
materials, a linked copper engine, sensing companions, local fields, maker tools,
weak-point practice, reversible gloves, and two versions of a living lantern.
Controls appear near the relevant object. Grip holds/climbs; trigger activates
or attaches; holding trigger reels the garden grapple. The return gate leads home.

Capabilities combine bounded rules, rigid-body links, heat/wetness/conductivity,
conserved reservoir flow, transformations, sensory memories, objectives, gesture
recording, hinges, portals and player appearance/movement profiles. These are
working stylised mechanisms, not unrestricted native code execution. Packages
own their objects; they cannot silently rewrite arbitrary existing scenery or
engine internals. A genuinely new engine primitive still requires a code update
and restart. **Start the game normally once to load this foundation; supported
subsequent packages arrive without another restart.**

New captured conversation text can accompany creations; old design briefs are
labelled reconstructed. Missing historical speech is not invented. Raw audio is
not automatically retained. Service history lives in `service/data/living-workshop.json`;
native transforms and mechanism states live in `user://living_world.json`, with
stable archive addresses in `user://living_museum_homes.json`. Ordinary shutdown
saves before scene teardown; periodic snapshots limit crash recovery loss to
roughly eight seconds. Historical state snapshots retain up to 64 revisions.

See [Living Workshop guide](docs/LIVING-WORKSHOP.md),
[experiments and archive](docs/LIVING-WORKSHOP-DEMOS.md),
[capabilities](docs/LIVING-COMPONENTS.md) and [service API](docs/LIVING-SERVICE.md).

## Start and stop

1. Open **Brann's Forge Launcher** on the desktop, or double-click `Brann's Forge Launcher.cmd` here. Select Adventure and Monitor / projector for mouse and keyboard.
2. For VR, ready the Vive Pro 2, VIVE Console, SteamVR, base stations and both
   Knuckles controllers, then select VR headset in the launcher. SteamVR must be the
   current OpenXR runtime. Close an existing game before changing modes.
3. The launcher starts a managed hidden audio helper automatically. Approach
   Brann and point at him with your controller, then press trigger to talk/retry.
   No browser tab or Talk button is required. The helper uses Windows default
   microphone and output; SteamVR can route the output to your headset.

The launcher's **Stop managed session** button closes this project's recorded audio helper/game/service, ends voice and
cancels its active commission with any applicable refund. It checks process identity
and start time, leaving BomberWLAN, unrelated Node processes and SteamVR alone.
Closing only the game leaves the service and commissions running. Voice stops when
the visitor heartbeat expires. If OpenXR cannot start, dismiss the engine notice;
stop the fallback desktop game, ready SteamVR and relaunch VR.

The hidden audio host is audio-host/ with its own isolated profile under
audio-host/state and metadata logs under audio-host/logs. It reloads automatically
after a service restart. Existing browser tabs cannot compete for voice while
the managed helper is connected. Connection feedback appears in the game.
Temporary server cooldowns retry automatically; deliberate End conversation
remains respected until the next in-game retry. See docs/AUDIO-HOST.md.

## The adventure

| Zone | What to look for |
|---|---|
| Forge Yard | Brann, anvil, tool board, upgrade button, targets and travel gates |
| Sandstone Quarry | Ore, mining and destructible sandstone |
| Enchanted Kitchen | Warm hearth, floating crockery and the returning rat hunt |
| Pinewood Ruins | Timber, calming apple trees, stone arches and skeletons |
| Mushroom Glade | Giant mushrooms, spores, water and magical gathering |
| Crystal Hollow | Glowing crystals, mining and anchor traversal |
| Sky Garden | Floating islands, windmill and grapple anchors |
| Ember Foundry | Lava-lit ruins and the Cinder Warden's permanent forge reward |
| Orchard Highlands | A broad apple orchard with lumber, a chop gate and Mossward skeletons; branch from Pinewood Ruins |
| Gloamfen | A dim spore marsh where the fairy's light helps reveal the path; branch from Mushroom Glade |
| Starfall Ridge | A wide crystal and iron field with a golem, bomb wall and grapple anchors; branch from Crystal Hollow |
| Cloudbreak Keep | Floating islands and guardian encounters linked by grapple anchors; branch from Sky Garden |

Zones are separate destinations in one native scene. Travel gates let you explore;
tool requirements gate interactions within them. This is an initial handcrafted
world, not an endless procedural survival game. Reference sheets are in docs/concepts.
The four new outer-zone gates return to their parent zones, keeping the Forge Yard
legible. Existing saves and resources work without a migration. The older side
destinations supplied by other scene modules remain available.

Rats now have individually readable ears, muzzle, paws, whiskers, tail and fur,
with quicker scurrying, sniffing and attack motion. Both tracked hands have a
more shaped glove, knuckle and nail treatment without changing grip positions.
Little Wing has an original Opus 5.5 body and textured wings; see
`work/fairy-opus/HANDOFF.md` for the original asset source and rebuild path.
The 2026-09-26 ethereal body pass replaces her round doll silhouette with a
slender luminous figure and layered petal gown while preserving the wings.
Run `outputs/fairy-ethereal-build/Play Flight Practice.cmd` to try the updated
fairy in the offline practice build, or use the normal source launchers.
See `docs/FAIRY-ART-20260926.md` for three-angle captures and checks.

For a desktop look at the update, see `outputs/night-expansion/`. To validate
the installed source, run Godot with `--headless --path godot --editor --quit`,
then `--headless --path godot --xr-mode off -- --expedition-check` and
`--headless --path godot --xr-mode off --script res://fairy_checks.gd`.
Headset comfort and
frame rate still require an in-headset playtest.

| Tier | One-time offering | Permanent capability |
|---|---|---|
| 1 | Free | Hammer, axe, pick and replenishing Pocket Thunder bomb glove |
| 2 | 3 rat tails **or** 3 lumber + 3 stone | Stocked workshop, grapple, spore lantern and bespoke tools |
| 3 | 3 iron + 3 haunted bones | Enchanted anvil and crystal resonator |
| 4 | 1 foundry boss ember core | Everburning forge and ember gauntlet |

Bring offerings to Brann and use **Upgrade workshop**. Each upgrade implies an
ongoing material supply: unlocked built-in tools can be issued again free and
custom commissions within that tier require no repeated material grind. Legacy
five-tail favours remain compatible with old saves but are no longer the main loop.
Death drops carried expedition materials in a recoverable satchel while preserving
tools and workshop milestones. Repeated deaths merge unrecovered materials into
the latest satchel. Returning to it restores the materials once.

## Controls

| Action | Knuckles / VR | Desktop |
|---|---|---|
| Form and throw a bomb | Squeeze an empty hand for 0.6 seconds, release to throw | Hold and release left mouse with bomb glove selected |
| Grab / release an item | Grip nearby item; release grip to let go or throw | E near or aiming at item |
| Use tool / select a board button | Trigger; physical swings also strike | Aim and left click |
| Choose a built-in tool | Point at the forge tool board and trigger | 1–8 |
| Upgrade workshop | Forge upgrade button | U while visiting Brann |
| Change zone | Point at a travel gate and trigger | F selects destination, G travels |
| Teleport / turn | Left stick click at floor / right stick sideways | T at floor / Q and R |
| Move / look | Roomscale tracking | WASD / hold right mouse |
| Retry voice | Talk/retry button | V or companion Talk |

Basic bombs replenish, use tracked throw velocity and can hurt you. Formation,
readiness, release and impact have distinct haptic events. Grapple travel currently
uses an anchor teleport. Generated equipment can specify bounded haptic patterns;
the service gives Brann controller and current interaction context.
See docs/INTERACTIONS.md for exact mechanics and the verification boundary.

## Inventing with Brann

Speak naturally or type a complete brief in the companion. Brann should preserve
your requested function and add a coherent useful flourish. The smithing worker
uses the locally authenticated **GPT-6 Astra / medium** Codex CLI, writes original
Blender source, exports a GLB and supplies sandboxed JavaScript. Validated items
appear on the rack without restarting the game. Each item's visual and mechanical
quality still requires a playtest; an arbitrary idea is not guaranteed to compile
into a supported effect. Current capabilities and limits are explicit in
service/docs/FORGE-CONTRACT.md and docs/PROGRESSION.md.

Voice defaults to **GPT Live 1 / Vesper**, with Responses tool delegation and a
three-minute session cap. The browser companion supplies headset audio; Godot does
not embed microphone capture. Voice uses the explicitly authorized OPENAI_API_KEY
from the launch environment, the project's ignored .env.local, or the source
BomberWLAN .env.local if present, in memory. No key is copied or logged. API keys
are omitted from Codex worker environments. Development fixtures make no paid calls.

## Setup and diagnostics

This machine uses RTX 3080 Ti, portable Godot in tools/godot, Node at
C:/Program Files/nodejs/node.exe and Blender 2.93. **Setup Tools.ps1** restores
Godot and pinned Node dependencies. BLENDER_PATH can override Blender's location.
The preserved native/ Unity draft is unbuilt because Unity licensing failed;
godot/ is the playable implementation. Do not retry Unity without fixing licensing.

~~~powershell
& '.\Diagnose Brann.ps1'
& '.\Verify Brann.ps1'
& '.\Verify Brann.ps1' -Capture
.\start.ps1 -ServiceOnly
.\stop.ps1
~~~

Diagnostics are read-only and record engine/runtime/process/service readiness in
logs/diagnostics-latest.json. Verification runs service tests, Godot parsing and
isolated connected native tests on port 8788 with temporary OS-temp integration-* state.
Optional captures render all eight zones with service mutations disabled. Normal
play uses loopback port 8787. See docs/VERIFICATION.md for results and known failures.

- logs/game-*.log: native startup, imports and runtime errors.
- logs/service-*.log and *-errors.log: managed service output.
- service/logs/server-*.log and forge-*.jsonl: lifecycle and worker diagnostics.
- logs/runtime.json: owned process IDs, executable paths and start times.
- logs/verify-*.log and integration.log: repeatable verification output.
- logs/work-timing.csv and docs/*TIMINGS.csv: measured implementation/test steps.
- service/data/player.json: durable resources, tiers, tools and recovery satchel.
- service/data/forge-items.json and forge-assets/: durable custom items.
- service/output/forge-work/: original generated source and handoffs.
- work/: ignored fixtures and temporary renders.

Inspect the latest error log and /health if startup fails. Launchers refuse to kill
an unrelated app occupying port 8787. Preserve malformed registries for diagnosis;
do not delete state as a repair. Interrupted commissions refund applicable
reservations and do not automatically retry expensive generation. Close and reopen
the companion after changing browser permissions or audio routing.

## Verification boundary and provenance

Automated checks exercise the real desktop engine and isolated service. They cannot
prove stereo rendering, controller comfort, real haptic feel, headset microphone
quality or a paid voice-to-original-asset commission. Those need a headset playtest.
The previous OpenXR probe returned instance error -6 while the runtime was not ready.
Do not infer working VR merely from a successful desktop capture.

This is a local single-player prototype. The native client is trusted to report
pickups and combat; multiplayer would require authoritative simulation. There is
no freeform construction system or limitless continuous flight yet.

Forge modules were adapted from BomberWLAN master/6459255; its license is retained
in service/LICENSE. No source history, runtime jobs or credentials were copied.
New scene art is procedural geometry informed by the supplied concept sheets.
This folder has no Git repository: initialization approval is pending. Nothing has
been pushed or published.

## Day-one quality of life

Press **B on either Knuckle** for the wrist toolbelt, or **Tab** on desktop.
Use its Tools, Travel, Comfort, Inventions and Tuning tabs. **Recall tools + return**
retrieves dropped weapons and brings you home without healing or recovering
material satchels for free. Comfort includes handedness, snap/smooth turn,
seated calibration, height adjustment, distance reach and the optional throw arc.

Bombs now show forming/ready/armed cues, targets explain needed tools, and gathering
shows what you received. Finished inventions are presented within reach with their
function and documented extra. Refine preserves previous playable versions.
Settings persist in user://comfort.cfg. See docs/QOL.md for implementation,
controls, reset instructions and tests. Verify Brann.ps1 now covers25offline tests
plus the original, adventure and QoL connected engine fixtures.

## Bomb feel and live adjustments

Pocket Thunder assembles metal panels around a luminous heart in0.45seconds.
Throws retain the strongest motion from the last120ms, multiply it by1.45 and add
0.65m/s lift. Stationary release remains a drop. The fuse is3seconds after release,
shortened to0.85seconds after impact. Explosions have rings, sparks, smoke and
spatial sound; their gameplay radius and self damage remain consequential.

**B → Tuning** exposes37native sliders over eight pages. Point with the dominant
hand and hold the trigger to drag; release applies and saves. Desktop uses Tab
and left mouse. Undo last restores the previous applied settings. The optional
localhost8787/tuning developer bench also provides presets and batched edits.

Codex can run **Tune Brann.ps1** to inspect the schema/current settings, or
**Tune Brann.ps1 -Key throw.gain -Value 1.7**.
Use -Undo, -Reset, or -Preset gentle/punchy/default. Changes apply through native
polling without a restart. In-flight fuse, physics and damage stay fixed.
Settings persist in service/data/tuning.json; logs record tuning revisions and
raw versus assisted release speeds. See docs/TUNING.md and docs/BOMB-VISUALS.md.

This is a typed parameter registry with small consumers, not a universal gameplay
scripting system. Add a schema entry and an appropriate runtime consumer when a
new system needs tuning. Structural changes still deserve ordinary code changes.

## Controller comfort iteration

The left stick now walks relative to your horizontal view; the right stick turns.
Movement uses the existing floor and capsule collision checks, so it cannot cross
empty gaps or walls. Teleport remains available on stick click.

Hands and held tools now use a calibrated grip socket (default pitch−90degrees).
Pointing rays use the separately tracked OpenXR aim pose. Grip starts above0.60
and releases below0.50, instead of0.25. All thrown tools use the assisted release
estimator. These thresholds measure the controller's normalized squeeze value;
they are not force measurements in newtons. Release is capped at grab minus0.05
to preserve hysteresis. Higher release values release earlier as fingers open.

Raise your empty left controller toward your face for0.45seconds to open Quick.
Use the right controller to point and drag. Lowering the wrist closes an
automatically opened panel; B → Quick remains a manual alternative. Quick has
grab/release, throw gain, movement speed and target eye height; Next exposes
pitch/yaw/roll. Calibration controls are also in Comfort.

Stand or sit naturally and press Calibrate height once. It targets1.70m by default
and saves the offset in comfort.cfg in both standing and seated mode. Changing
target height takes effect when you calibrate again. No automatic startup height
guess is made. The footer shows raw/current/target height for diagnosis.

See docs/QUICK-WRIST.md and docs/VERIFICATION.md. Normal logs now include
GRIP_RELEASE values and HEIGHT calibration results.

## Talking to Brann and receiving tools

Approach within2.6m of Brann to enter conversation range; walking beyond3.2m
leaves it. Point at his body and press trigger to start/retry explicitly. The
managed audio helper handles microphone capture and voice playback; the in-game
interaction enables voice without needing a browser button. A manually stopped
conversation can be restarted with the same in-game interaction.

The palms now have mirrored90degree roll corrections around the finger axis;
the existing hand-roll slider remains an additional adjustment.

Brann's remote playback drives small beard and head movements through a10Hz
amplitude envelope. Your microphone never drives this animation. Silence,
stopped playback and stale/disconnected updates return it to rest.

Starter ownership includes bomb_glove, axe, pick and hammer. Voice issue_tool
queues a persistent native delivery; the client equips it, then acknowledges
receipt. Repeated polling does not duplicate delivery. A generated crossbow is
a bespoke commission subject to the actual workshop tier, with real queued,
building, ready or failed status. Speech instructions distinguish those states
and owned versus equipped inventory. See docs/BRANN-GROUNDING.md.


## Adjustable grips and hip holsters

Squeeze near the handle of a held weapon with your free hand to support it. Both
hands steer the handle; release either hand to continue holding with the other.
While squeezing, hold A to loosen your grip, slide or rotate your hand, then
release A to lock it. Solo adjustment temporarily holds the tool in place.

Release a weapon slowly beside an empty hip slot to stow it. Squeeze at an
occupied slot to draw it. Fast releases remain throws. The two slots move with
you through travel and recall. B > Tuning includes secondary grip reach, holster
reach and holster height among 30 live values. Slot locations and adjusted tool
grips last for this running session; owned tools remain saved across restarts.
See docs/GRIPS.md for the implementation and verification boundary.

## Brann presence and explosion flair

Brann follows nearby players with eased, bounded head turns and small eye
movements, occasionally glancing away. His apron clasp pulses amber while the
managed helper opens/connects, turns mint when listening, and pulses with his
actual outgoing voice. A small nod acknowledges readiness. Quiet/disconnected
states return to rest; the contract retains diagnostic text. His smith hammer
has an additional 90-degree rotation around its handle axis.

Conversation enters at 2.6 m. Moving beyond 3.2 m starts a six-second departure
grace period; coming within 2.9 m cancels it. Beyond 6 m or another zone closes
immediately. The live smith receives bounded distance/presence facts and may
make one brief friendly departure quip, limited to once per 30 seconds per
session. This is model-driven, so a quip is not guaranteed. No new session is
started just to say goodbye.

Pocket Thunder now scatters brass and mint fragments, alternating spark colors,
and a delayed mint ripple. Throwing, fuse and damage are unchanged. Existing
native effect intensity/duration controls apply. See docs/BRANN-PRESENCE.md.

## Safe pickup and bomb controls

Grip alone only picks up. To make Pocket Thunder: grip an empty hand first,
then freshly press and hold trigger; release grip to throw. A pre-held trigger
or simultaneous grip/trigger does not arm it. Release trigger and press it again
if needed. The 0.12-second arming guard rejects short taps; once formation starts,
you can release trigger and keep holding the bomb. Successful pickups block bombs
for that entire squeeze, including harvested resources. Menus and held weapons
also block formation. Desktop mouse bomb controls are unchanged.

Skeletons, wisps and golems are authored facing +Z; chase rotation now uses that
axis. Camera/aim forward is still -Z. See godot/bomb_input.gd for the isolated
input guard and its arm_seconds knob. Normal startup instructions and Brann's
control context describe the new chord.

## Next-work scope and deferred ideas

See docs/CHARACTER-ANIMATION-SCOPE.md for the proposed skeleton-first animation
pilot, reusable enemy/rig boundary and acceptance checks. This is a plan, not
implemented functionality. docs/DEFERRED-IDEAS.md parks multiplayer, general
visual uplift and asset-authoring tools; do not treat it as an active build queue.

## Character animation and physical remains — implemented September 13

Existing skeletons, rats, golems/bosses and wisps now use articulated rigid-part
rigs with AnimationPlayer pose clips. Gait follows travelled distance; skeletons
have loose strides, rats scurry with head/tail life, and golems shift more slowly.
Enemy attacks use one wind-up/strike/recovery clock for poses and one damage event.
Directional recoil is cosmetic. Rats retain their existing nip behavior with a
new bite pose. Player hand orientation and bomb input/throwing are unchanged.

On death the actual visible pieces retain their current world poses and become
RigidBody3D props with collision, gravity and quiet clattering. A skull keeps its
face together. Grip picks up a piece; release throws it; swing or throw it as an
improvised club. Blast deaths inherit an outward impulse. Loot remains a separate
fixed reward, so bones are props, not repeatable crafting currency. Respawn uses
fresh meshes and does not take existing bones from the floor.

Loose remains last 90 seconds and are capped at 120 bodies. Held/holstered pieces
are protected. Their lifetime restarts when thrown again. Inactive-zone pieces
freeze; lost pieces below the world are removed. Remains are session-only and are
not automatically recalled with permanent tools. The cap can remove older loose
pieces sooner. Held props use the existing kinematic grip system with colliders
disabled while held; released props have physical collisions.

B > Tuning now contains 37 live settings (eight pages), including seven enemy
controls: stride, body bob, turn response, wind-up, recovery, recoil and scatter.
Wind-up/recovery changes apply to the next attack to avoid mid-strike retiming.

Select **Animation Lab** under **Labs & Demos** for an offline desktop preview stage,
or **Animation Lab - VR** for headset scale. Finish any active voice/build first;
the lab safely stops this project's managed runtime. Point/click or trigger its controls:
next character, idle/walk/attack, pause, slow motion, turntable, joint markers,
crumple, explode, reset and hit reaction. B/Tab > Tuning works locally in the lab;
changes there are temporary. Use the launcher's **Stop managed session** button to
close it, then select Adventure to return. Lab logs: logs/animation-lab-*.log. No microphone,
commission or resource persistence is used in the lab.

See docs/CHARACTER-ANIMATION.md for architecture, limits and verification.

## Bone, shield and crystal art uplift

Skeleton limb bones now have tapered seven-sided shafts and paired knobbly ends.
Shield rims, rivets and boss stay attached to the shield during death; the rig's
joint positions and poses are unchanged. Compound bounds include the extra detail.
There are now 17 corpse pieces (the shield emblem is part of the shield).

Hollow's Song (crystal_resonator, existing tier 3 tool) is now a purple crystal
hammer in a brass cradle. Its gameplay, crafting cost and grip remain unchanged.
It has a translucent faceted shell, bright core, procedural veins, one short-range
light and a faint projected pattern. Crystal Hollow's decorative clusters share
the new shell/core treatment without adding per-crystal lights. This uses no AI
texture or external image dependency. The reference silhouette is inspired by
WoW's Hammer of the Naaru, with original geometry.

Art knobs live at the top of godot/crystal_art.gd: opacity, glow, vein scale,
light energy/range and pattern energy. Shader uniforms are editable independently.
The projection is a local emissive decal, not simulated refraction/caustics; it can
reach through thin surfaces within its small volume. Normal fade avoids stretched
patterns on perpendicular surfaces. No global renderer change was needed.

The offline Animation Lab includes a grabbable Hollow's Song on the right pedestal
for inspection without unlocking progression. Normal adventure access remains tier 3.
Preview images are in the user outputs folder: Bone and Crystal Uplift.png,
Knobbly Bone Death.png, and Crystal Hollow Uplift.png. Restart the game to load art
changes; normal start/stop scripts and logs are unchanged.

## Wrist developer spawner

B opens the hand menu (Tab on desktop). Dev tools equips any built-in tool,
including Hollow's Song, without tier checks, crafting requests or resource costs.
Inventions still presents/equips finished custom weapons. The Possibilities board
and desktop number shortcuts retain normal progression and crafting checks.
Developer equipment is session-only and marked dev_spawn; it does not grant saved
ownership or upgrade the workshop. Repeated selection recalls the same developer
copy. Normal board selection never recalls that copy. These are functional test
weapons: damage, harvesting and their resulting rewards still work normally.
Pocket Thunder selects the already-available bomb glove; grip then trigger forms
a bomb. Spawning cancels an unfinished bomb before replacing the held tool.
Logs include DEV_SPAWN with tool ID and current tier. Restart loads this change.

## Hollow's Song showcase asset

Hollow's Song now uses godot/hero_hammer.gd and hero_crystal.gdshader instead of
the primitive prototype. It has a continuous turned handle/socket, a leather
sleeve with winding seams, silver claws with fine gold inlay, and a bevel-cut
purple crystal with internal inclusions. Six material surfaces / 16,880 triangles.
Only this tool uses the showcase mesh; world crystals retain their lighter art.
Tool identity, tier, behavior, collider and grip coordinates are unchanged.

The reproducible native preview uses the same asset builder and Mobile renderer:
tools/godot/Godot_v4.7.2-stable_win64_console.exe --xr-mode off --path godot --script
res://hero_preview.gd -- --output=C:/absolute/preview.png --angle=140
(Run as one command; quote output paths containing spaces.) It makes no service
or microphone requests. Captures and logs include triangle/draw-call counts.
The studio view uses its own lighting, so also inspect the Animation Lab capture
under normal forge lighting. Files in the user output directory include Hollows
Song Hero v1.png, v2.png, Hero Final.png, Reverse.png and In Game.png.
Spawn it with B > Dev tools > Hollow's Song after restarting the game.

## Palm alignment and workshop delivery

Default XR tool attachments map authored handle +Y across the palm toward the
thumb (mirrored per hand), with a grip point 13 cm up the handle. Calibrated hand
tracking and desktop orientation are unchanged. Hold A to adjust a particular
item as before; saved session grip preferences override the default. Brann's
hammer is also centered farther along its handle inside his fist.

Brann-issued tools and imported custom inventions now go through
godot/workshop_delivery.gd: a serialized finishing sequence on the anvil, three
warm sparks, then a visible floating transfer onto the Retrieval Bench. Grip to
collect. Delivery never takes over an occupied hand. Equipment is non-grabbable
during finishing, including through the Inventions menu. Backend delivery ACK
means bench-ready, not equipped; Brann's instructions reflect this distinction.
An amber workpiece is visible while real jobs are queued/building/validating.
This is a finishing ritual, not a real-time model-generation viewport or material
simulation. Historical custom models also use the presentation queue on reload.
Dev spawning remains immediate. Board tool selection remains progression-gated.

Logs: WORKSHOP_DELIVERY finishing / bench_ready, followed by DELIVERY_NATIVE for
issued tools. Pending issued deliveries retry after restart until acknowledged.
Normal scripts start/stop the game and its audio/service. Offline captures use
--xr-mode off --path godot -- --capture-grips [--grip-back] --capture=ABSOLUTE.png
or --capture-delivery for the anvil transfer. User previews: Palm Grip Closeup.png,
Back of Hand Grip.png, Workshop Delivery.png.

## Palm menu and session height calibration

Press LEFT B to open or close the hand menu. Rotating the left hand never opens or
closes it. The menu stays attached under the left palm/wrist and follows its
rotation without billboarding or positional smoothing; use the RIGHT controller
to select. Desktop Tab and the menu's Close control remain available.

Height offsets are now session-only. A saved +1.066 m correction was found during
inspection; replaying such offsets against a different runtime floor is unreliable.
Startup uses the runtime floor without that correction. Stand/sit naturally and
use Calibrate height, or SteamVR Recenter (OpenXR pose_recentered), to set the chosen
eye height (default 1.70 m). The recenter handler waits two frames for the new pose.
Calibration replaces rather than accumulates the offset; normal crouching is not
automatically corrected. Calibrating while crouched will therefore give a wrong
standing height: recalibrate upright. Other comfort preferences remain saved.
Raw/effective/target heights remain visible in Quick/Comfort; HEIGHT logs record
discarded offsets and calibration. This does not repair SteamVR floor setup for
other applications. Offline preview flag: --capture-palm-menu with --capture=...

## Contact, chopping and Orchard's Edge

Orchard's Edge uses `godot/weapons/orchards_edge.glb`, rebuilt as a physical axe.
Use physical swings for chopping. Holding trigger amplifies the next swing while
it remains pressed; the former healing effect has been removed. Custom invention
instructions still require clear use instructions and a distinctive interaction.
Other built-in tools retain their existing trigger functions.

godot/melee_contact.gd separates contact from tracked-hand poses. A swept tool tip
stops against collision surfaces; qualifying impacts require 1 m/s. An unfinished
hit bites 4.5 cm and stays constrained until withdrawn 10 cm. Skeleton impacts
at 2.2 m/s or above kill and release the actual bones; weaker hits and tougher
enemies stop the tool. The training dummy remains a reusable target with marks.
This is a first contact model: point sweeps against game colliders, not a complete
blade-volume solver, articulated physical hands or arbitrary mesh dismemberment.
Your real tracked hand remains free to move while the virtual tool is stopped.
Loose bones retain their existing impact behavior rather than held constraints.

Harvestable apple trees in Pinewood Ruins require three hits within an 18 cm
height band. Different heights accumulate separately; the actual trunk mesh is
notched and exposed wood is tinted. The third matching hit plays a falling tree
visual and uses the existing authoritative lumber reward/35-second regrowth path.
The fallen visual lasts five seconds and is not a persistent harvestable log.
Background decorative trees are solid scenery, not additional harvest nodes.
Knobs: MIN_STRIKE_SPEED, CUT_HEIGHT_TOLERANCE, CUTS_TO_FELL, BITE_DEPTH and
WITHDRAW_DISTANCE at the top of melee_contact.gd. Logs: AXE_CUT height/hits.

Released tools now use tool_physics.gd rigid bodies with gravity, angular motion,
continuous collision detection and stable mesh-bounds box envelopes. They settle
on the retrieval bench and anvil. Loose tools/bones use layer 8, excluded from
the player's movement capsule, but collide with world solids and each other.
Pickup removes the temporary physics wrapper; recall does the same. Lost tools
below the world return to the rack. TOOL_DROP logs show item and launch speed.
This does not simulate held-tool torque or use mesh-perfect concave tool shapes.

The retrieval bench now has a tabletop collider. Before visual batching, major
zone decoration (at least 28 cm wide/deep and 10 cm high, above the ground) gains
convex collision. Small grass/flowers remain non-solid. Upward-facing solid
surfaces can be stepped onto up to 35 cm; tables and taller walls block movement.
Collision is not claimed for every tiny prop or every procedural invention part.

Use the normal start/stop scripts. Preview flags: --capture-chop in main, or
hero_preview.gd --axe. User outputs: Orchards Edge Hero.png and Tree Cut Contact.png.

### Workshop clarity and character detail (2026-09-13)
- Left palm toolbelt is rotated in its plane: face your palm toward you with left fingers pointing right. Gesture thresholds and tracked hand orientations are unchanged.
- The right board is now The Workshop Path: live authoritative costs, owned resource counts, gathering regions, and the four permanent tiers. Materials are paid for workshop upgrades; unlocked standard tools have an ongoing free supply. The left Possibilities cards show tier and availability. Hover descriptions occupy a reserved space beneath that board.
- Visible five-tail favour controls were retired. UPGRADE and desktop H use the permanent workshop upgrade route. INVENT AN ITEM starts native conversation rather than opening the browser. Legacy service hand-in remains for compatibility.
- Dummies have sack stitching, cloth patches, straw, rope and target rims. Skull cranium, jaw, teeth, cheekbones and sockets are one compound head assembly; existing skeleton rigs and 17-piece death physics remain.
- Display logic lives in godot/progression_ui.gd; costs and tool availability are read from the service, not independently priced by the UI. Extend PATH/PLACES when introducing new tiers or gathering locations.
- Offline captures: --capture-workshop-path, --capture-possibilities, --capture-dummy-detail, --animation-lab --capture-skull-detail, --capture-palm-menu. Add --progression-preview=<absolute JSON path> to an offline capture for populated ledger states. This never writes player progression. Always use --xr-mode off before the -- separator.

### Knuckles, toolbelt and forge polish (2026-09-13)
- Hand animation now reads /user/hand_tracker/left and /right XRHandTracker joint positions independently for all five fingers. The OpenXR hand-tracking extension is enabled. Joint angles are bounded and exponentially smoothed; missing/invalid joints fall back to trigger/grip animation. This is game-friendly flex retargeting, not full finger spread, physical finger collision, or a change to grip/throw input. Knuckles joint data is inferred by SteamVR from its controller sensors. References: https://docs.godotengine.org/en/stable/tutorials/xr/openxr_hand_tracking.html and https://docs.godotengine.org/en/stable/classes/class_xrhandtracker.html .
- HAND_TRACKING log entries report joints:0-5/5 or controller fallback. Inspect the latest logs/game-*.log after startup to diagnose runtime/controller support. Response speed and bend limits are constants in godot/hand_animation.gd. Fixed bone lengths preserve the stylized hand proportions; thumbs now have two articulated joints, fingers rounded segments and small nail details, and cuffs have brass fittings.
- Only LEFT B toggles the palm menu in VR; the old palm-facing gesture has been retired because it opened accidentally. The menu's local left-middle edge is attached to the palm so the panel extends right. Tabs use two rows; tuning navigation, footer actions, and descriptions have separate regions. Invention descriptions have their own bounded area. Main workshop board shows just the next tier, costs, gathering regions and next unlock.
- button_feedback.gd adds hover color/lift, press depression, an acknowledgement flash and a short controller haptic. Rapid duplicate presses are suppressed. Amber means a locked tool/unaffordable upgrade; green acknowledges an available selection, not completion of a background build. Actual results/errors continue to come from the existing service notices and delivery flow.
- Forge smoke is a bounded set of 16 animated fading puffs (forge_atmosphere.gd); ember emission flickers gently. Apples are positioned relative to individual foliage lobes so their edges intersect the canopy. workshop_details.gd supplies low-polygon beveled anvil/hammer pieces, barrel staves/bands and small Brann apron/hat/face details. Existing tool coordinates, abilities and rig hierarchy are retained.
- Native-only code reload: run ./restart-game.ps1. It checks the recorded game process identity, refuses during a voice conversation, then restarts only Godot through start.ps1. It leaves the service, audio helper and active forge builds running. The launcher's full **Stop managed session** action shuts down everything and cancels jobs; do not use it merely to reload visual changes during a commission.
- Additional offline capture flags: --capture-hand-detail, --capture-forge-detail, --capture-smoke; --capture-grips --apprentice-grip chooses the apprentice hammer. Continue to pass --xr-mode off before -- for diagnostics.

### Crafting ritual, estimates and destination portals (2026-09-13)
- workshop_delivery.gd owns a single 0.90-second strike cycle. The hammer's striking-face contact point is solved against the workpiece top; at the contact phase the exact pose is applied, sparks spawn and an impact sound plays in the same frame. Brann adopts a slightly closer working stance and returns to his idle stance afterward. Background hammering runs only for building/validating jobs or finishing a verified item, never for merely queued work.
- Eight original, deterministic synthesized metallic impact WAVs are pooled with a coprime sequence to avoid adjacent repeats. Three spatial players are reused; work cues are -18 dB with 16 m maximum distance and cease outside the Forge Yard. The short rising reveal chime plays at -14 dB. Generate the assets with python scripts/generate_forge_audio.py. No downloaded recordings or paid generation are involved. Diagnostics suppress audio playback.
- Historical timing already exists in service/data/forge-items.json (startedAt, readyAt, elapsedSeconds) and per-job logs through forge-worker.js. One successful historical build was found: 384.47 seconds. service/craft-progress.js uses the median of the last 20 successful bounded durations. With fewer than three samples, use a broad 60%-150% range and mark it an early estimate. It narrows to 80%-130% with more history. Failed/cancelled jobs are excluded. Queued jobs have no countdown; missing history displays a learning message. Overruns explicitly say still working. The estimated meter never reaches completion until a real ready result; validation is a separate stage.
- The anvil slate shows build stage and approximate remaining minutes. A glowing billet and assembling fragments give a lightweight magical approximation of progress. They are not intermediate versions of the actual generated item: the worker currently exposes only the final validated GLB. Unknown-time builds use a pulsing meter while their decorative workpiece gradually forms.
- Finished models stay hidden during three synchronized finishing strikes, then appear with a small scale/levitation reveal, mint sparks and the chime. They travel to the existing retrieval bench and only become pickable after settling. Existing delivery idempotency and native acknowledgement are retained. Restored historical imports still use the existing delivery ritual on startup; this sequence is not proof that a new backend build ran.
- Forge Yard portals face (0,0,-4), toward Brann, including their readable front labels; return portals face their local zone centre. Destination-specific stone colours and low-poly ornaments distinguish all eight zone themes. Hub waystone signage also faces inward.
- Debug captures: --capture-forge-working, --capture-delivery, --capture-portals, with --xr-mode off before --. FORGE_STRIKE logs contact error and pool size; WORKSHOP_DELIVERY logs finishing and bench-ready transitions. Timing knobs: STRIKE_PERIOD, CONTACT_PHASE, CONTACT and HAMMER_FACE in workshop_delivery.gd; ETA policy in craft-progress.js. For native-only updates use restart-game.ps1. Changes to craft-progress/server require a full service restart only when both activeJob=false and activeSessions=0.


### Siegebird physical reload and mesh repairs (2026-09-13)
- Siegebird starts cocked with one bolt. Pull the holding controller trigger to fire; its native action takes priority over world interactions, while an open toolbelt retains UI priority. Shots sweep from the visible bolt tip to prevent tunnelling, stop at solid surfaces and damage enemies/rats/training targets. Dry triggers never create a second projectile.
- Other-hand grip near the wooden crank knob reserves that hand for cranking, preventing accidental bomb formation or support-grip pickup. Turn around the axle in the winding direction; the ratchet ignores reverse turns. Two full turns cock the string. The on-stock plate shows draw percentage, PLACE A BOLT and LOADED. Release the crank to free that hand.
- While holding Siegebird, a small bottomless practice bolt pouch appears at the front centre of the belt. Grip a bolt, lay it along the cocked rail, then release when the plate reads RELEASE TO SEAT. The rail catch allows 19 cm and about 49 degrees of angular tolerance, including reversing the bolt for accessibility; seating aligns it correctly. Loading an uncocked bow is blocked. Dropped bolts are physical, can be regripped and expire after 45 seconds; at most 12 loose bolts remain. Fired/handheld bolts reuse the actual authored quarrel mesh. These are free practice bolts, not a new resource economy.
- The original published GLB is unchanged. siegebird_runtime.gd attaches this native mechanism to item 20dc22c5-7bcc-43df-b07f-e81eab521b0f, reusing its logical mesh groups. Native firing/reloading supersedes the original static-crank/grid-spell trigger behaviour for this item; other generated items retain their existing service abilities. Native description explains the new controls; historical generated item.json remains an immutable account of the original asset build.
- The 10-tooth coaxial pinion drives a 20-tooth take-up gear in the opposite direction. One drum revolution winds 0.255 m through a guide to the sled. String/sled/draw percentage share this parameter; firing rapidly unwinds the mechanism over 0.10 seconds. This is a kinematic mechanism with a symbolic ratchet, not a constraint-based simulation of rope tension or individual gear tooth collision.
- The calibrated visible hand's straight index axis (-Z) now drives the pointer, avoiding runtime-specific aim-pose offsets. Existing hand rotations are preserved. One-handed Siegebird's +Y rail follows that ray. Both grips share one local handle axis; the existing two-hand solver lets hand positions determine aim without rear wrist rotation steering it. Generic melee constraints do not intercept the crossbow.
- Open crystal cage end frames and translucent amethyst make a sight channel. Centre the mint front pip in the brass rear aperture. It is a real geometric sight parallel to the straight bolt trajectory, roughly 5 cm above it; it is not a ballistic scope, magnifier or screen overlay.
- Crossbow speed, damage, crank reach and bolt seating reach are live sliders in toolbelt tuning and available through /api/vr/tuning. Service validation, persistence and undo apply. TURNS and the 2:1 drivetrain ratio are in siegebird_runtime.gd. Fire/ratchet/seat sounds are deterministic synthesized samples with four spatial audio players; no paid generation. Logs include SIEGEBIRD attachment/fire/seating events.
- Reversed side triangle winding in workshop_details.clipped_box caused missing hammer/anvil faces. Corrected winding keeps proper backface culling and outward normals. Brann now has tapered sleeves/forearms, rolled cuffs, knuckles, shaped trouser knees, buckled boots and faceted wraparound apron panels. Shoulder/hammer pivots and the proven anvil contact pose are preserved.
- Fast focused check: Godot --headless --xr-mode off --path godot -- --siegebird-check. It uses the already published local GLB without contacting the service; when the historical asset is absent it reports the integration check as unavailable. Full Verify Brann.ps1 includes these checks too. Capture --capture-siegebird, optionally --uncocked or --capture-sight; always --xr-mode off before --. Normal start/stop/log recovery instructions above apply. Tuning schema changes require an idle service restart.


### Collection porch and future armoury (2026-09-13)
The current collection is displayed in the Forge Yard, right of the central path between forge and waystones. Named/numbered waist-high stands contain all tier-available standard tools, every ready generated invention, and the original starter hammer. At the inspected Tier 3 save this is nine exhibits, including Hollow's Song and Siegebird. Dev-only previews do not unlock permanent exhibits; The Last Hearth remains locked until Tier 4. The bomb-glove exhibit explains the gloves already worn instead of equipping a misleading staff.

Grip a displayed tool to retrieve it. Newly available standard tools are recorded as owned through POST /api/vr/collection-take, which checks fresh Forge Yard context and the authoritative tier; no proximity conversation or additional cost is required. That ownership is visible in Bran's existing inventory snapshot. Each stand retains its name and indicates in hands, on belt, or away. RETURN TO STAND recalls a dropped tool without stealing held/holstered items. The existing Recall tools + return menu action also uses these individual homes. Abandoned tools retain real drop collisions until retrieved. Forge completion still reveals each item and visibly transfers it, now to its named stand rather than piling items on the bench. Bran's delivery wording reflects this destination.

Implementation: godot/collection_runtime.gd separates the stable home registry, display, pickup and recall from item behaviour. Fixed base-tool slots preserve their addresses as tiers unlock; generated IDs append in user://collection_homes.json. This is Godot's user data directory printed by STATE_PATH, not service/data or a source artifact. Preserve this file to retain custom exhibit ordering. Atomic writes report errors; smoke/capture runs never write this registry or real progression. Canonical ownership remains service/data/player.json and successful invention history remains service/data/forge-items.json. Twenty initial porch addresses flank the central aisle; simple outdoor overflow positions remain distinct, but the planned hall should replace overflow before the collection outgrows this prototype.

Verify Brann.ps1 covers repeated-sync stability, held-item protection, dropped-body cleanup/recall, distinct addresses, tier checks and persistent ownership. --capture-collection uses an explicit offline Tier 3 preview and the already-published local Siegebird GLB; it does not unlock anything in the live save. Pass --xr-mode off before --. No paid forge or voice calls are needed. Normal start/stop/log instructions apply; this update includes a service route/prompt change and requires an idle full restart.

See [Armoury and attachments proposal](docs/ARMOURY_AND_ATTACHMENTS.md) for the unimplemented 48-home hall, persistent catalogue/lineage, optional tactile modules and a proposed Siegebird grappling-bolt first slice. Arbitrary attachments and the full hall have not been implemented.


## Item interactions and persistence — 13 September 2026

Siegebird is the craftsmanship reference. Four simpler models now have wrapped
handles, fitted metalwork and functional visual parts: Stonewhisper, Swallow Line,
Mooncap Lantern and The Last Hearth. Existing detailed hero axe, Hollow's Song and
apprentice hammer remain intact. Six reusable ember motes add a restrained forge sparkle.
Brann's existing tracking, glance and greeting-nod implementation is preserved.
The original spare hammer now rests at its own cradle beside the forge (-1.8,0,-1.7),
independent of the workbench and named collection homes.

Holding-controller trigger actions:
- Hammers: Forge Pulse (nearby damage and slow, 3 second cooldown).
- Orchard's Edge: hold trigger while swinging for a powered physical cleave.
- Stonewhisper: trigger charges a resonant pick strike for eight seconds (eight-second cooldown). Strike an ore seam for one bonus material and fracture up to two other nearby mineable seams; normal swings still mine.

- Mooncap Lantern: slowing spore garden (6 seconds), with rune interaction retained.
- Hollow's Song: three resonance projectiles, including brittle-seal interaction.
- The Last Hearth: firebolt plus a two-second protective ward (3 second cooldown).
- Siegebird: fire; free hand winds the crank twice and seats a belt bolt for reload.
- Pocket Thunder retains grip-then-trigger formation and release-to-throw.

The Forge Yard now uses four restrained image-generated material maps on grass,
timber, stone and forged iron, including Brann's anvil and workbench. The maps
stay local to this area and do not alter collisions. Sources, tuning and native
review images are in [the Forge materials handoff](docs/FORGE-MATERIALS.md).

Swallow Line is a motorised grappling reel, not a climbing pick: aim at a solid
surface or brass anchor, press trigger to latch, hold trigger to reel, release trigger
to hang, release grip to detach. A visible crossed-ribbon rope connects the spool to
the hit point. A capsule sweep limits pull movement against scenery. Brass anchors
provide landing destinations; generic wall attachments stop near the wall and stay
attached until dropped. Detaching lowers the player to a solid surface. Continuous
pull is not comfort teleportation; reel speed can be lowered in tuning. Ordinary
stick movement remains available. The old direct adventure anchor interaction is a
legacy compatibility path; held Swallow Line routes through item_interactions.gd.

Control hints appear at the stands and for eight seconds after grabbing a tool.
Generated items show their useInstructions on pickup. Native action definitions live
in item_interactions.gd, separately from model construction in tool_details.gd.

Bolts now follow a swept ballistic tip with 2.4 m/s² downward acceleration. Impacts
embed 4.5 cm into the surface. Embedded bolts track moving surfaces, remain at their
last position if the target disappears, and expire after 120 seconds, capped at 20
(oldest first). Persistence is within a running session, not saved across restart.
Airborne shots are cleared on zone changes; embedded bolts remain in their zone.
No accumulating rigid-body simulation is used for embedded bolts. Existing loose
reload bolts retain their separate 45-second / 12-bolt limits.

Tuning keys (service, offline schema and native defaults agree): crossbow.gravity,
crossbow.bolt_lifetime, crossbow.bolt_cap and grapple.reel_speed. Existing bolt speed,
crank reach and loading reach remain adjustable. One-hand roll is mirrored by tracker:
right -90°, left +90° around the calibrated forward axis; two-hand solver unchanged.

New forge builds require explicit useInstructions and an actually evaluated non-spark
trigger action. The job receives service/docs/siegebird-reference.png alongside its
contract. Unsupported physical mechanisms still require native adapters; generated
JavaScript cannot silently add engine hooks. Original published assets are not rewritten.

Diagnostics: --siegebird-check now covers native item actions, a real grapple latch /
reel / pause / detach sequence, vertical capsule collision, both wrist rolls, bolt
gravity, moving/deleted target persistence, cap and expiry. Use --capture-item-actions
with --capture=<path> for the tool preview, or --profile-bolts with --capture=<path>
for the 0/20 bolt comparison. Always pass --xr-mode off before -- for desktop captures.
Logs include GRAPPLE, BOLT_EMBED, ITEM_ACTION_CHECK and BOLT_PROFILE. Standard start,
stop and recovery launchers above are unchanged.

## Original art direction: inhabited places (13 September 2026)

Reference sheets are preserved in assets/art-direction/zone-concepts-01..03.png.
This pass extends the eight existing zones. The extra locations on the sheets
remain references rather than new areas.

- Forge Yard: hanging smith sign and cloth banner. Collection sign backfaces no
  longer display mirrored lettering over the forge.
- Quarry / Crystal Hollow: ore carts on rails; point and trigger to send one
  along its short track or return it. Wheels rotate with travel.
- Kitchen: hanging herbs and three wandering teacups near the front of the room.
  Grip to catch; holding trigger sips for 5 health with a 30-second refill.
  Caught cups stop hovering and use ordinary drop/collision/holster handling.
  Cups weigh 0.12 kg; ordinary tools retain their existing 1.3 kg default.
- Pinewood: orchard fencing and ivy climbing the ruined arch.
- Mushroom Glade: lily pads, bluebells, animated waterfall streaks and a
  touchable springy mushroom drum. Touch the cap, or point and trigger.
- Crystal Hollow: three touchable crystals play a little major triad. Touch,
  withdraw and touch again, or point and trigger. Brief visual pulse and haptics.
- Sky Garden: rotating open lattice windmill sails, a mounted banner, and a
  nearby control wheel. Point and trigger to stop/start the mill.
- Ember Foundry: hanging iron chains on brackets and ten small rising embers.

Implementation: godot/zone_details.gd owns the scene additions, touch entry/cooldown
state, synthesized notes and bounded animation lists. Static new details are batched
inside their own ArtDirectionDetails root, avoiding repeat collision generation on
existing architecture. No new ongoing service, API call or generated-asset worker
is required. Props and machinery state last for the current session, not save/load.
Dropped props remain until restart; the three cups never replenish as extra copies.
The new scenery does not bypass workshop tiers or create forge resources.

Verification remains Verify Brann.ps1. With -Capture -CaptureDirectory <directory>,
relative directories now resolve to absolute paths before passing them to Godot.
Eight zone screenshots are in work/art-direction; --capture-teacups provides a close
view using the existing --capture=<path> option. ZONE_DETAILS, ZONE_DISCOVERY and
ZONE_DETAIL_CHECK log the loaded scene features and interactions. Existing start,
stop, native-only restart and recovery instructions remain unchanged.

## The Living Workshop suite (13 September 2026)

The right-side text board is replaced by a miniature workshop development table.
Four permanent stages retain existing save tiers: Basic Tools, Stocked Workshop,
Enchanted Anvil, Everburning Forge. Existing tools, commissions, resources and
collection stands are preserved; this is an additive player-state migration.

**In-game controls**

- Left hip: point at the POUCH clasp and press trigger. Arrows browse all ten
  resources; grip the actual ingredient preview to pull out one piece. A count
  and purpose appear above it. Release near the pouch to put it back.
- Living Workshop table, right of Bran: release pieces into the bucket labelled
  for that material. Accepted pieces stay put and persist between visits/restarts.
  Grip a deposited piece to retrieve it. Tier 2 can use three tails OR three
  lumber plus three stone; change offering only while the buckets are empty.
- Grip the lever handle and physically pull it toward you. A complete offering
  starts a five-second bucket transfer, smoke/hammering sequence and reveal sound.
  Merely holding/releasing the lever cannot spend resources. Restarting during a
  reveal restores the committed tier without consuming the offering again.
- Tier 2 adds the Tinker's Bench in the right-hand extension. Trigger a labelled
  MAKE control to craft a module from its displayed inventory cost. Rest a
  single-held weapon in the cradle, grip a module and place it at its brass socket.
  Modules also fit a weapon held in the other hand. To remove a module, rest the
  weapon in the cradle first and grip the installed crystal/gear. This restriction
  keeps secondary handle grips safe. Replacing a module returns the old one to
  the bench rack. One removable module per item identity; spare copies share it.

| Stage | New workshop space and function |
| --- | --- |
| Basic Tools | Existing forge; physical pouch and donation table |
| Stocked Workshop | Timber wing, stocked shelves, Tinker's Bench and Quickwind |
| Enchanted Anvil | Stone alcove, luminous crystals, enchanting anvil; Truesight and Verdant |
| Everburning Forge | Rear foundry, open connecting doorway, permanent flame and Hearth |

| Module | Cost | Function |
| --- | --- | --- |
| Quickwind, Tier 2 | 2 iron + 1 tail | Siegebird cocks in one crank turn; larger take-up drum preserves the reduction relationship |
| Truesight, Tier 3 | 2 crystal + 1 haunted bone | Looking through Siegebird's aligned crystal optic highlights visible skeleton heads orange; an aimed headshot does twice normal damage |
| Verdant, Tier 3 | 2 apples + 1 spore | Trigger adds 10 healing, ten-second cooldown, alongside the weapon action |
| Hearth, Tier 4 | 1 ember core + 2 sky blooms | Trigger adds a three-second ward, eight-second cooldown |

Bran receives deposited materials, catalog costs, socket state and ingredient uses.
He can suggest an attachment or a separate invention. He guides donations rather
than purchasing an upgrade by conversation, and does not claim to install modules.
Optional module costs are separate from the ongoing supply unlocked for inventions.
There are no new rare-drop odds or backpack systems in this version.

**Source and persistence**

- `godot/workshop_suite.gd`: pouch, physical tokens, table, lever, construction,
  serialized requests and revision-aware state merging.
- `godot/workshop_art.gd`: ingredient/module silhouettes, miniatures and extensions.
  Static opaque parts are merged by material inside their independently movable
  roots. Smoke is limited to twenty reusable puffs; no per-frame save calls.
- `godot/enchantment_runtime.gd`: bench, sockets, module effects and sight alignment.
  `godot/siegebird_runtime.gd` retains the existing two-hand solver and physical reload.
- `service/workshop-ledger.js`: authoritative tokens, bucket contents, modules and
  sockets in `service/data/player.json`, alongside existing progression. Atomic save,
  rollback on failure, fresh player context and bounded idempotent request receipts.
  Taking an ingredient debits inventory once; returning credits once. Donations
  consume only on a successful commit. Loose pieces save location on release and
  after settling. Already donated/loose pieces are distinct from the death satchel.
- POST `/api/vr/workshop/:action`: material-take, material-return, material-place,
  donate, withdraw, option, commit, module-craft, module-install, module-remove.
  Every mutation requires requestId. Forge actions require Forge Yard context;
  loose materials can be handled in other zones. Live `/api/vr/upgrade` now requires
  the same physical commit. Legacy direct World.upgrade exists only for old unit fixtures.
- Startup/operations: WORKSHOP_READY, WORKSHOP, WORKSHOP_CHECK in the usual logs.
  Use the existing start/stop/restart launchers; service changes need a full restart
  when crafting and voice are idle. Preserve player.json on any migration error.

**Verification and previews**

Run `& '.\Verify Brann.ps1'`. This includes actual native pouch take/return,
cradle placement, socket replacement, effect cooldowns, Quickwind and optic geometry,
in addition to all previous regression checks. Service tests cover all tiers,
partial donations across reload, withdrawal, repeat requests, save failures, death,
resource conservation and socket compatibility.

Offline examples (engine options go before `--`):
`--capture=../work/workshop-tier2.png --capture-workshop-tier=2`,
`--capture=../work/workshop-tinker.png --capture-tinker`,
`--capture=../work/workshop-pouch.png --capture-workshop-tier=1 --capture-pouch`.
Add `--workshop-overview` for the full building. `godot/workshop_fixture.json` is an
explicit preview fixture, never copied into live state. Preview calls cannot spend
resources or contact voice. Desktop captures are not headset frame-time measurements;
controller comfort, reading distance and hand reach still need real playtesting.

Module tray arrows browse four physical modules per page, preserving each module's
home index when another is installed or replaced. The cradle accepts one weapon at
a time. Fast offline native checks: engine --headless --xr-mode off --path godot --
--workshop-check. The full verifier remains required for service/input changes.

## Siegebird articulated asset workflow
Siegebird now uses the retained original shell with a Blender-authored mechanism, non-stretching animated string/limbs, separated clutch and crank, forward-only manual bolt seating, and existing two-hand/enchanted-module support. See [the controls, rebuild command, verification limits and lessons](docs/SIEGEBIRD.md). Rebuild and test using `scripts/Build-Siegebird.ps1`; artifacts are in `outputs/Siegebird-Rebuilt/`. Existing item identity and saves are retained.

## Record a VR video
Hold **right B for one second** to start/stop silent OBS video, or use **Toolbelt > Quick > Start video**. OBS starts with the game; a red timer confirms recording. Videos save to recordings/. Desktop fallback: **Ctrl+Shift+F9**. See [recording setup, controls and recovery](docs/RECORDING.md).


## Compress videos for sharing
Open **Pocket Video** from the desktop or `launcher/legacy/Video Compressor.cmd`, drop recordings, choose 9/24/49 MB, and press Compress queue. Original files stay intact; shareable MP4s go into Shared/ beside them. See [compressor setup and recovery](utilities/video-compressor/README.md).


## Ghosts and tactile fire supplies

Visit the **Emberdew** table beside the forge for free matches and glass fire vials. Slide the matchbox open, pluck and strike a match, gently light a vial wick, then throw. Both burn for ten seconds. The box stows at the left hip. Ghosts in Pinewood Ruins and Crystal Hollow can **only** be killed by actual fire. See [controls, tuning, tests and limits](docs/GHOSTS-AND-EMBERDEW.md).

## Siegebird field suite

Siegebird has an attached crank-hand pose, standard weak-point optics, unlimited belt bolts, and a physical grapple-reel attachment. Crank and seat each bolt by hand in VR; desktop R reloads. Fired bolts remain recoverable. The old Field Supplies purchase no longer costs iron. After a grapple hit, crank to reel in; trigger releases the line. Brann can publish bounded live adjustments without a game reload. See [controls, reusable components, verification and limits](docs/SIEGEBIRD-FIELD-SUITE.md).

Siegebird III adds the sculpted grip/analog trigger, tangential grooved cable routing, faster drag-aware bolts, bolt stabbing/throwing and a steady hip pouch. Controls, tuning, validation and capture commands: [field suite](docs/SIEGEBIRD-FIELD-SUITE.md#siegebird-iii--tactile-refinement-17-september-2026). Restart the game to load the rebuilt bundled model; live tuning is already saved.

19 September polish: Siegebird grip finishing, readiness jewel, current-frame trigger-finger contact, reduced rope shimmer and smoother inventory follow. See the field-suite handoff above; native changes load on the next game launch.


## Quests and experience

Open your left-palm toolbelt and choose **Journal**. Near Brann, accept up to three jobs: defeat three skeletons, defeat three rats, gather three lumber, or gather three stone. Accept before setting out; return to Brann and press **Collect XP** when ready. Jobs repeat, and gathering lets you keep the materials. Skeletons are in Pinewood Ruins and respawn after 45 seconds; rats are in the Enchanted Kitchen.

Kills and fresh gathering also award XP. Levels and occasional titles persist through death and restart; they do not add talent points or change workshop requirements. The first level takes 100 XP. The journal shows the current level, progress, destination and reward; ready jobs and new levels give short notices.

Balance lives in `service/quests-config.json` (restart the service after changes). Player progress lives in `service/data/player.json` under `rpg`; native pending hunt events persist in Godot's `user://quest_outbox.json`. If disconnected, reconnect to the local service and queued hunts retry automatically. Save failures retain queued events; check `QUEST_EVENT_REJECTED` in native logs and the service log before clearing anything. Existing events must not be discarded or assigned new IDs during recovery.

Run `node scripts/check-quests.cjs` for isolated native/HTTP verification, or add `--capture` to render `outputs/quest-journal.png`. The normal `Verify Brann.ps1` includes it. Tests use temporary service data and make no paid calls. See `docs/QUESTS-SERVICE.md` for API and persistence details. This native addition is available on the next game launch; already running native scripts require restarting the game.


## Desktop visual laboratory

Select **Visual Lab** under **Labs & Demos** in the launcher. This starts a standalone Godot Mobile-renderer scene with the actual workshop and hero assets, without XR, the main game, service, microphone, inventory or player saves. It does not change the main game's art.

Use **0** for the original palette, **1** for Golden hour, **2** for Hearth at dusk and **3** for Enchanted workshop. Right-drag orbits, wheel zooms, **V** cycles yard/Brann/hero-item views, **Space** toggles orbit and **P** pauses scene animation. Buttons provide the same options plus a treatment-strength slider. Close the window or press **Escape** to stop. The on-screen desktop FPS is not a headset-performance measurement.

The source is `godot/visual_demo.gd`; `outputs/visual-lab/index.html` is the screenshot comparison gallery. The launcher records its own process identity in `logs/visual-lab-session.json` and a timestamped Godot log in `logs/visual-lab-*.log`. If it fails to open, inspect that log, then relaunch the shortcut. Do not stop unrelated Godot or SteamVR processes.

Capture all presets with the console Godot executable, `--xr-mode off --audio-driver Dummy --path godot --script visual_demo.gd -- --capture-demos=<absolute output directory>`. Expect four PNGs, `VISUAL_DEMO_CONTROLS_PASS` and `VISUAL_DEMO_CAPTURE_COMPLETE`, with no script errors. The gallery is a local static page.


## Weather and wildfire desktop playground

Select **Weather Lab** under **Labs & Demos** in the launcher. This is a separate desktop-only experiment; it does not alter the playable game, run Brann's service or touch saves. Close its window or press Escape to stop. Unlike the original visual lab, this launcher enables ordinary desktop audio.

The right panel provides a time slider, a four-minute day/night cycle, optional automatic weather changes, Clear/Rain/Snow, Sunrise & melt, lit/unlit potion spills, a view of the rain-test surfaces, a night-sky view, sound previews and mute. Snow reaches full coverage in roughly 18 seconds; strong daylight melts it in roughly 22 seconds. Sustained rain extinguishes exposed fire after around seven seconds. Wet surfaces dry gradually. Metal and timber test surfaces stand outside the forge; the sheltered forge stays dry. The rest of the camera controls are unchanged.

The prototype uses a **24m square, 64×64 top-surface grid** captured once from actual mesh triangles, including instanced architecture. Snow is a coverage shader, not physical snow depth. Rain and flakes respect sampled overhead shelter; classification is based on material properties with explicit overrides for the test surfaces. Eight positional sound voices play short generated variations, with a quiet rain bed. These are placeholder procedural sounds, not recorded Foley.

Liquid conserves transferred fuel across neighbouring cells, follows height differences, ignites adjacent fuel, consumes fuel while burning and dims under sustained rain. Splashes are visual droplets; this is shallow surface flow, not a full 3D liquid solver. It does not simulate water entering buildings, moving objects, overhang layers, arbitrary vertical walls, smoke transport or whole-world seasons. Grid exposure must be rebuilt if static scenery moves. Snow/rain/fire interactions are not yet connected to gameplay damage or Molotov inventory. The surface grid cannot represent a floor beneath a roof simultaneously, so spill attempts below the sampled roof reject rather than jumping upward. Caps keep rain, snow, stars, spill drawings, flames, splashes and audio bounded; captured desktop FPS does not establish headset performance.

Source: `godot/weather_lab.gd`, loaded by `visual_demo.gd` only with `--weather-lab`. Logs: `logs/weather-lab-*.log`; owned-process identity: `logs/weather-lab-session.json`. Run `scripts/check-weather.ps1` for simulation assertions or add `-Capture` for four visual snapshots in `outputs/visual-lab/weather-*.png`. Checks cover material identification, shelter heights, accumulation/melt, spill placement, conservative fuel transfer, spread, rain extinguishing and bounded effects. No external/paid APIs are used.


## Weather in the playable game

The shared weather system now runs in Forge Yard, Sandstone Quarry, Pinewood Ruins, Mushroom Glade and Sky Garden. Enchanted Kitchen, Crystal Hollow and Ember Foundry retain their authored atmosphere. Outdoors have a twenty-minute day/night cycle, stars, occasional weather changes, settling/melting snow, rain and subtle surface sounds. Open **palm menu → Weather** for clear/rain/snow, sunrise, night, automatic changes, cycle, mute and a weather-off fallback. Explicitly choosing weather turns off automatic changes until you enable them again. Relaunch the game to load this native addition.

The effects follow a 24m area around the player. Surface scans yield between chunks during travel/movement; workshop upgrades also trigger a refresh. Snow/wetness use the existing static exposure model and their average is retained per zone. Settings, time and zone coverage save every thirty seconds and immediately on menu actions in `user://weather_state.json`. The runtime adapter is `godot/weather_runtime.gd`. Clear/dry weather detaches the snow/wet material overlay to avoid unnecessary rendering passes. VR performance and subjective rain-audio balance still need headset testing; the Weather page provides disable/mute controls.

Rain impacts now use seven much softer, filtered variations per material, quieter playback, randomised spacing and a greatly reduced metal resonance. The continuous rain bed is retained. Existing outdoor bottled-fire pools can hiss when exposed to rain; their combat damage and duration are unchanged in this integration. Dynamic fluid gameplay remains in the playground pending a separate combat integration.

In **Weather Lab**, select **Aim a lit potion** or **Aim an unlit potion**, then click an exposed surface. A target ring shows the destination and the bottle travels along a gravity arc before splashing there. Repeat clicks throw more; right-click cancels aiming. Roof tops and raised surfaces are supported; the single-layer surface model cannot target a floor hidden beneath an overhead roof or arbitrary vertical walls. Forty flying bottles and a budget of forty full potions of remaining fuel bound the experiment. The sound preview buttons use the same subdued sound bank as the game.


### Larger fuel experiments and chain ignition

The desktop Weather Lab now holds **40 full potions' worth of remaining fuel** (320 simulation units), with up to 40 airborne bottles. Puddles merge into a shared fuel field rather than counting as separate fire objects. Once capacity is reached, a visible notice appears; existing fuel is never deleted to make room. As fuel burns away, capacity returns.

Contact heat ignites neighbouring spilled fuel even when neither puddle is flowing. Pouring unlit fuel onto burning fuel feeds the fire. Rain-soaked fuel resists ignition, gaps and large height discontinuities block contact ignition, and a narrow ledge retains the full bottle volume. A connected trail burns until its fuel is consumed; unburned fuel still evaporates slowly.

The liquid MultiMesh has room for all 4096 simulation cells. The flame MultiMesh retains that capacity but displays at most 640 sampled flames when a blaze is dense; every cell still burns, spreads and contributes to the bounded light regions. A connected, softly irregular, mostly opaque meniscus replaces the old separate fuel discs. The 10 Hz simulation, splashes, sound voices and three pooled shadowless lights remain bounded. Limits live at the top of `godot/weather_lab.gd`; `godot/fuel_checks.gd` is part of the normal Weather Lab check. Ordinary playable sessions use shared surface fuel; some offline diagnostic modes still use the legacy four-pool path.

To capture a real 40-spill scene, add `--fuel-stress` alongside `--weather-lab --weather-check --capture-demos=<directory>` when running `visual_demo.gd`. The result is `weather-stress.png`; `--fuel-stress-count=1|10|40` selects smaller comparison scenes and prints five FPS/update-time samples. These foundations support larger experiments, but recursive grenade/potion spawning is not implemented.

Weather surface refreshes preserve zone coverage while scanning. Disabling weather or travelling during a scan discards stale results; rebuilding the palm menu during a scan is safe.

## Spreading fuel combat
Ordinary VR and desktop sessions use the shared surface-fuel simulation. Unlit vials leave fuel, lit vials ignite trails, and fire damages ghosts and the player. Puddles persist between zone visits during the session. Lit player/fairy matches, the hearth torch, Wyrmspout stream/patches, Sunfall, Ember Gauntlet and generated heat emitters now use one bounded contact path to light fuel or other materials. It works while a new fuel patch is still scanning. Fire can heat a loaded Siegebird bolt; that bolt briefly carries fire to its impact. Local flame melts snow. Water quenches and wets gallery material samples as well as fuel. In the Ember Gallery, use the three real dry-timber, damp-timber and oilcloth targets beside the copper basin to try combinations. The launcher still shows an experimental spreading-fire option, but the flag is no longer necessary for normal play. See [fuel bounds and diagnostics](docs/FUEL_COMBAT.md) and [fire implementation notes](docs/FIRE-UNIFICATION-AUDIT.md). Run `scripts/check-fuel-combat.ps1` for focused verification.


## Bellworks and playful experiments

Select **Bellworks** under **Labs & Demos** for an offline desktop session, or use the
normal game's east Bellworks gate / palm Travel menu. Sunskipper is a returning
ring with three bell trials; Copper Kite is a physical cargo wand and flower
puzzle across the bridge. Six playful sliders use the existing tuning system.
The archive also offers The Unfinished Lullaby, a light/warmth/sound garden,
and Cinderloop, a reusable live-authored returning projectile.

See [play controls, saves, verification and standalone packaging](docs/PLAYFUL-SPRINT.md).
Actual desktop captures are in `outputs/bellworks/`. The optional standalone build
is in `outputs/bellworks-build`, with Play Desktop / Play VR launchers.

The forty-bottle fuel capacity is part of the ordinary game path. The desktop weather lab uses the same capacity and contact-ignition foundation. See [bounds and controls](docs/FUEL_COMBAT.md).


### Persistent standalone demo

For an offline demo that remembers progress, select **Bellworks - Persistent**
under **Labs & Demos**, or extract the latest `Bellworks-Persistent-Demo-*.zip` and open
**Play Desktop.cmd**. **Tab > Demo** contains short toy instructions, save status,
manual save and a two-step reset. Trials, earned cosmetics, supported tuning and
the two featured experiment outcomes survive relaunch. Throws, held objects and
cargo poses remain transient.

Only `user://BellworksDemo/progress.json` and its own backups/archives are used.
The normal adventure saves are neither loaded nor changed. The earlier
reset-on-exit ZIP and `outputs/bellworks/index.html` remain a verified fallback.
The persistent demo's menu view is in `outputs/bellworks-persistent/index.html`.
Build with `scripts/Build-Bellworks.ps1 -Persistent`; verify with
`scripts/check-demo.ps1`. See [adapter](docs/DEMO-SESSION.md),
[save recovery](docs/DEMO-SAVE-STORE.md), and [help/tuning](docs/DEMO-HELP-TUNING.md).


### Bankshot Bell

Toolbelt **Travel > Bankshot Bell** adds a replayable three-shot ricochet court.
Take Sunskipper from its stand and bounce off the teal panel into the bell.
Courtyard power is a useful start. Earn a medal, then replay to improve your
best throw count. The persistent demo restores this progress, including saves
made before the challenge existed. See `docs/BANKSHOT-BELL.md` for controls,
separate save locations, diagnostics and reproducible default-power shots.


### Festival Relay

Choose **Toolbelt > Travel > Festival Relay** (or Demo > Festival Relay in the
standalone). Start Practice for no visible clock, or Personal Best for an optional
stopwatch without a time limit. Ring any visible Bellworks bell three times,
make a fresh Copper Kite cargo delivery, then hold the glow pebble beside SUN
and trigger the held handbell beside SONG in Lullaby. NEXT prepares/visits each
leg; a newly prepared garden asks for NEXT again once ready. The cargo and garden
posts also offer return/abandon. Put down tools before travelling.

Restart/abandon retain earned medals and bests. Existing bell, cargo and garden
achievements remain intact. A run itself is session-only; medals and personal
bests persist in the normal game or separate demo namespace. Earlier demo saves
load with a fresh relay. See `docs/FESTIVAL-RELAY.md` for the precise save boundary.
Run `node scripts/check-festival.cjs` for a real-input, fresh-process walkthrough;
`--pack outputs/bellworks-persistent-build/Bellworks.pck` checks the exported build.


### Echo Bells and Lantern Parade

**Toolbelt > Travel > More places** opens the second page of destinations.
Echo Bells is an untimed visual/audio memory game: repeat phrases of two to
five notes. Desktop players aim and click a bell. In VR, grip its clapper,
pull gently, then release. Replay/Retry helps without erasing earned medals;
New Round starts a fresh phrase. Best unassisted length is recorded separately.
Lantern Parade calls six moving targets by name, shape and colour. Take its
Sunskipper and use Courtyard power. Wrong hits recall safely; repeat to improve
your fewest-throws result. Start/Retry/Abandon are available on the arrival board.

Both save achievements, never unfinished rounds or held objects. Normal-game
files are `user://echo_bells.json` and `user://lantern_gallery.json`; the persistent
demo stores optional fields only inside its separate BellworksDemo snapshot.
Old snapshots without these activities remain valid. See `docs/ECHO-BELLS.md`,
`docs/LANTERN-GALLERY.md` and `docs/ARCADE-DEMO-PERSISTENCE.md`.
`node scripts/check-arcade.cjs` exercises actual desktop clicking, clapper grips,
six moving-target flights, saving and fresh-process restoration. Add
`--pack outputs/bellworks-persistent-build/Bellworks.pck` to check the export.


Final interaction review: desktop clicks aimed at nearby activity buttons work
while holding/recalling Sunskipper or holding Copper Kite; pointing elsewhere
retains tool actions. Festival Start/Restart retires a pre-existing ring flight.
Pocket travel now reveals the zone owning its safely validated landing, so
visiting from another adventure region no longer leaves the court invisible.
Malformed save schema types are rejected cleanly, and successful optional-module
progress is retained if that module is temporarily absent during later saves.
Run `node scripts/check-activity-review.cjs` (optionally `--pack <PCK path>`) for
focused interrupted-input, real-flight, malformed-save and actual-scene checks.


Persistent demo safety: open the supplied Play Desktop/VR CMD launcher. The
exported demo refuses bare executable startup before loading gameplay or saves.
Keep only **one persistent demo window open at a time**: simultaneous instances
share a save namespace and a stale session can overwrite progress or undo a reset.
Exclusive-writer locking is not implemented; close other demos before resetting.

### Sunskipper chakram and phone showcase

Sunskipper now has embossed metallic ornament, banked throws, reflected scenery
ricochets and momentum-preserving trigger recall. VR: grip/throw, tilt to curve,
trigger in flight to return. Desktop: E take/throw, Q/R bank, click recall.
Find it at Bellworks/Bankshot stands via Toolbelt > Travel.
`Share Sunskipper.cmd` starts the public phone showcase and prints its temporary
link; `Stop Sunskipper Showcase.cmd` safely stops those helpers. This PC must stay
awake for the shared link. Full controls, tuning, rebuild, logs and limitations:
[Sunskipper guide](docs/SUNSKIPPER-CHAKRAM.md).

### Ember Gallery: fluid play and useful firelight

Open **Play Ember Gallery Desktop.cmd** or **Play Ember Gallery VR.cmd**, or travel
to Ember Gallery in the main game. Pour oil, ignite it with Hearthlight, quench it
with a physical water can, and explore the shadowed alcove. Lit/unlit bottles are
available at the gallery board. Existing toys remain available through Travel.

The standalone build saves separately in `EmberGalleryDemo`; normal game and older
demo saves are preserved. Spills persist between visits, while discovery seals
persist across launches. See [controls, build, logs and limits](docs/EMBER-GALLERY.md)
and [packaged-game visual walkthrough](outputs/ember-gallery-export/index.html).

### Little Wing: VR + desktop local co-op

**Start Fairy Co-op.cmd** opens the normal game with a second native desktop
window for a butterfly fairy. One player uses VR; the other flies with a gamepad
or mouse/keyboard. The host's right B calls the fairy back. Fly close to a hand
and press F / gamepad A to perch; a brisk hand movement launches the fairy.
Carry real bones or matches, leave glowing surface marks, reveal weak points,
and fire precision darts. Fragile fairies respawn in their friend's pocket.

F8 or **Toolbelt > Comfort > Fairy co-op window** opens/focuses the companion.
Closing that window leaves the host game running. A previously running old game
needs one relaunch to load this code. No resident VR session is restarted by setup.
The optional `outputs/fairy-coop-build` snapshot has **Play VR + Fairy.cmd** and
**Play Flight Practice.cmd** (offline, resets progress). In solo practice, F3
offers a hand and F4 tosses it. F1 in the fairy window lists all controls.
See [controls, Steam Input setup, tuning and limits](docs/FAIRY-COOP.md).

Run `node scripts/check-fairy.cjs` for 46 focused actual-scene checks; use
`--pack outputs/fairy-coop-build/LittleWing.pck` to check the export. Build using
`scripts/Build-FairyCoop.ps1`. Screenshots and scoped desktop GPU measurements
are in `outputs/fairy-coop/`; headset/controller acceptance is still unverified.

Little Wing blue-light update: the latest local practice package is in outputs/fairy-blue-build (Play Flight Practice.cmd). Solo starts by the Forge Yard matchbox and bottles. Mouse looks freely; right-click pings; back mouse picks up/drops; middle click reveals. See docs/FAIRY-PLAY.txt for opening the box and striking matches. Verified 54 source/package interaction checks; desktop render samples varied 0.50–1.49 ms with view and concurrent load, not a VR frame-time guarantee.

Ember Gallery lamplighting expansion: `outputs/ember-lamplighting-build/Play Desktop.cmd` / `Play VR.cmd`. Three oil lamps, water quenching with damp-wick delay, and finite moonwater channels illuminating the existing dark alcove. Runs separately from Little Wing practice. Stop by closing its window; inspect `logs/game.log` beside the executable. Reservoir state is session-only; existing achievement/save schemas are unchanged. Run `node scripts/check-lamplighting.cjs` (optional `--pack ...` / `--capture`) for actual-scene checks. Build with `scripts/Build-EmberGallery.ps1 -OutputName ember-lamplighting-build`.

Match-bat fairy update: latest package in outputs/fairy-match-build; nearby pickup hints, held-item primary actions, constrained physical striker sweep, blue-violet silk wings, tighter acceleration/stopping. Source and exported fairy check target is now 62 checks. See docs/FAIRY-PLAY.txt. Earlier running packages do not hot-load source changes.

Latest desktop-control package: outputs/fairy-desktop-build. Starts maximized; F11 fullscreen, F10 maximize/windowed, F6/F7 half-screen, [ / ] sensitivity. Immediate unscaled mouse aiming. 68 interaction/input checks plus five native window transitions verified; monitor-to-photon latency is not measured.

Crisp-text practice build: outputs/fairy-text-build. Shared WorldZones labels now use a cached MSDF fallback font, preserving authored world sizes with lighter outlines. Fairy rendering defaults to native resolution (render_scale=1.0); source tuning can reduce it on slower GPUs. Torch labels fit their own small plaque.

Latest matchbox/fuel practice: outputs/fairy-fuel-build. Shift + pickup deliberately lifts an open box; ordinary pickup draws matches. The source game now uses one fixed hull for an open or closed dropped matchbox, avoiding the competing tabletop contacts of the old overlapping drawer collider. Visible long-lived oil/fire remains; see docs/FAIRY-PLAY.txt. The actual-physics/lifetime fixture in godot/matchbox_checks.gd now includes an open-drawer tabletop drop.


Latest staged fairy playtest: `outputs/fairy-playtest-build/Play Flight Practice.cmd` (offline; no progress save). Open it after closing the older practice session. Includes stable matchbox drops, match-first pickup, eight-second spilled fire, modestly longer unlit puddles, swept match ignition, visible F3/F practice hand, F4 fling, and eight-second pings/Delete clear. See `docs/FAIRY-PLAY.txt`; packaged logs are beside executable under `logs/`. Existing running game is intentionally untouched.


Sprint practice milestone: `outputs/fairy-guided-build/Play Flight Practice.cmd`. F2 starts the optional in-world Flight & Flame guide; Shift+F2 retries. Existing flight, match and marker interactions are used; no progression rewards or world-save changes. Personal sensitivity/view/help preferences live in `user://fairy_preferences.cfg` independently of saves. Narrow integration checks: `node scripts/check-fairy-practice.cjs`, `node scripts/check-fairy-heat.cjs`, `node scripts/check-fuel-overlap.cjs`; all accept `--pack path/to/LittleWing.pck`. Native exported visual/performance check: engine `--main-pack outputs/fairy-guided-build/LittleWing.pck --script res://fairy_practice_capture.gd -- --playful-demo --capture-output=<absolute-output-folder>`; run only with no user playtest running. Logs in `logs/`, screenshot/performance in `outputs/fairy-practice-review/`.


Latest fairy adventure package: `outputs/fairy-discoveries-final/Play Flight Practice.cmd` or `Play VR + Fairy.cmd`. Includes shoulder perch/shared light, three after-dark rooms, Ember Creek fluid puzzle, and **Discoveries** (M; fairy controller: hold Start + D-pad up). Choose a destination then Visit; B/Esc closes, Return to Brann returns home. Browsing preserves cargo/perch; travel uses existing policy of leaving fairy cargo safely in the old zone. Only Ember Creek exposes a confirmed local reset in this chooser. Older activities retain their own reset controls. Close the game window to stop; logs beside the packaged executable. Existing games do not hot-load this update. Verification: `node scripts/check-discoveries.cjs --pack outputs/fairy-discoveries-final/LittleWing.pck`. No headset ergonomics claim.

### Four-item atelier trial (2026-09-24)
Two refined existing tools plus Glowmoth Lantern and Stormbell. Offline desktop/VR launchers: `outputs/atelier-trial-20260924/Play Atelier.cmd` and `Play Atelier VR.cmd`. Controls, rebuild, validation and Luna evaluation: [docs/ATELIER-TRIAL.md](docs/ATELIER-TRIAL.md). Native three-angle renders: `outputs/atelier-review/`.

### Remote 3D atelier showroom
Run `launcher/legacy/Share Atelier.cmd` to export the four assets and publish an orbit gallery. The reusable installed skill is `C:/Users/mog/.codex/skills/asset-showroom/SKILL.md`; its CLI accepts GLB, trusted Godot build(parent) scripts or scenes. Public URL and helper state are in `C:/Users/mog/.codex/asset-showroom/last-publish.json` and `processes.json`; logs are under that runtime directory. Current hosting is a temporary public Cloudflare tunnel: PC must remain awake, link changes on restart. No game services or player state are exposed. CLI `--status` inspects and `--stop` stops identity-matched helpers. `--build-only` never changes the running public gallery.

Siegebird reload/reel update (2026-09-24): release a forward-pointing bolt near the cocked sled/rail; a brief catch window accepts gentle drops. Works with the reel fitted. For grappling, fire at solid scenery, grip the brass crank with the free hand and turn it to pull yourself in. The holding-hand trigger releases the line. These controls remain on the weapon while tethered. High-anchor landings approach above the ledge, then descend. Restart the game to load these script changes; existing live sessions are left intact.

Skeleton Guardians (2026-09-25): Claude's Mossward, Prismwatch and Cinderkeep art and shield logic are integrated into Pinewood Ruins, Crystal Hollow and Ember Foundry. Grip a raised shield's rim and pull to steal it, or claim its physical shield after defeating the skeleton. Swing its face to bash; trigger uses Rootbeat (slow foes and briefly guard), Prism Chime (stagger and expose weak spots), or Bellows Bash (a short fire cone that harms ghosts). The shield can be thrown and picked up; one exists per guardian lineage. Authored Blender sources, build script, manifests and renders are in `work/opus-skeletons/`; installed GLBs and logic are in `godot/guardians/`. Three in-game close-ups are in `outputs/skeleton-guardians/`. Run `--guardian-check` for live-scene logic verification. Restart the game to load this update; headset feel remains to be tested.

Wyrmspout v2 (2026-09-26): the original remains on its own collection stand. The new version has an Opus 5.5 textured dragon-head model with a compact 35 mm grip, aligned -Z firing axis, player-following eyes, heat-reactive teeth, native held-trigger fire, attached surface flames and a three-second overheat lockout. Hold trigger to breathe fire; release to cool; right B on Knuckles (even when held left) or desktop right mouse vents heat. Left B is reserved for the hand menu. The fire actually damages ghosts and ignites fuel. See `docs/WYRMSPOUT.md` for the asset sources, tuning constants, install/update script, logs, checks and known VR playtest limits. Run `--wyrmspout-check` to verify native import, orientation, fire damage and heat logic.

Forge Yard practice / held-item pass (2026-09-27): four pumpkins can be nudged, cut into orientation-dependent physical halves, smashed into colliding chunks, or carved into glowing jack-o-lanterns with three stabs. Sunfall Sledge now bonks ordinary surfaces with varied 3D sounds, sends fiery spikes across the ground, and explosively one-shots skeletons with stronger bone scatter. Wyrmspout v1 and v2 have explicit, regression-tested left/right hand poses; player calibration using A while gripping persists per item version and hand in `user://grip-poses-v1.json`. Wyrmspout v2 now shoots a progressive, gravity-drooping faceted stream, with fire damage along that actual trajectory and ground impacts feeding Emberdew's liquid-fire field. See `docs/PUMPKINS-SUNFALL.md`, `docs/GRIP-POSES.md`, and `docs/WYRMSPOUT.md`. Run `godot --headless --xr-mode off --path godot --script res://pumpkin_sunfall_checks.gd -- --smoke`, the same command with `res://grip_pose_checks.gd -- --grip-pose-check`, and `godot --headless --xr-mode off --path godot -- --wyrmspout-check`. Restart the game to load source changes; a live game instance does not hot-load these scripts.

Fairy throw, adventurer, and quiver pass (2026-09-26): the fairy now launches from a smaller deliberate hand flick, keeps the current flick velocity instead of a lagging smoothed sample, and coasts for 1.6 seconds before normal flight braking returns. Her F / gamepad A perch control accepts the adventurer's right shoulder as well as an offered hand. The authored player model follows the Hero's headset, drives its sleeves toward tracked hands, plays idle/walk animations, and hides only its head from the Hero's first-person camera; Little Wing sees the complete figure and lands on the model's physical shoulder marker. Siegebird's belt quiver uses the new Opus leather/brass GLB. Source assets and renders are in work/opus-player-20260926 and work/opus-quiver-20260926; game assets are godot/assets/player/player.glb and godot/assets/siegebird/quiver.glb. A forge worker starts below normal Windows process priority to preserve headset time, and frame hitches over 90 ms are logged with forge phase. The live crafting hitch still needs a headset replay to confirm the improvement. Verify with Godot --headless --xr-mode off --path godot --script res://fairy_checks.gd (78 checks) and --headless --xr-mode off --path godot -- --siegebird-check. After source edits, restart the managed game/service from the launcher when no commission or conversation is active; a running Godot process does not hot-load the new GDScript/GLBs.
