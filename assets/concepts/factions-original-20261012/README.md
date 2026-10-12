# Original faction concepts — Claude implementation handoff

This is the selected ORIGINAL set: six good Forgeling units and six evil skeleton units. The later five-variants-per-role exploration is deliberately not included. Start with these twelve images.

## Image index

| Role | Good faction | Evil faction |
|---|---|---|
| Grunt | [Forgeling](good-forgelings/01-forgeling.png) | [Rattleguard](evil-skeletons/01-rattleguard.png) |
| Heavy | [Anvilback](good-forgelings/02-anvilback.png) | [Graveback](evil-skeletons/02-graveback.png) |
| Ranged | [Glintshot](good-forgelings/03-glintshot.png) | [Splintershot](evil-skeletons/03-splintershot.png) |
| Healer/support | [Mender](good-forgelings/04-mender.png) | [Bonebinder](evil-skeletons/04-bonebinder.png) |
| Sapper | [Fusewick](good-forgelings/05-fusewick.png) | [Wickbone](evil-skeletons/05-wickbone.png) |
| Mobile siege | [Sunlance Cart](good-forgelings/06-sunlance-cart.png) | [Gloamlance Cart](evil-skeletons/06-gloamlance-cart.png) |

Each sheet includes the primary design, rear view, equipment and action references. These are generated 2D concepts, not exported game models. Existing production Forgeling and skeleton renders informed the designs. Each faction subfolder includes its original prompts and review notes. `manifest.json` contains relative image paths and SHA-256 hashes.

## Explicit user requirement: every bone is a physics object

**Every skeleton bone is an individually identifiable physics object.** Treat this as a core engineering and authoring requirement, not optional decoration. Skeleton combat should feel like physically dismantling an articulated creature: impacts progressively knock bones off, and the actual struck pieces separate and move through the world.

- Author separate, addressable bone pieces with stable IDs, local transforms, appropriate collision shapes and physical mass/inertia. Agree the anatomical part inventory explicitly, including ribs, fingers and toes; do not quietly reinterpret “every bone” as six broad limb chunks.
- While attached, pieces belong to a coherent articulated skeleton with explicit attachment/joint relationships. Animation-driven/kinematic bodies, sleeping and physics activation may be used to control cost; every bone need not be an awake unconstrained rigid body every frame.
- On breakage, release the corresponding physical bone from its attachment at its current world pose, carrying appropriate motion and hit impulse. It should collide, tumble, settle and sleep. Avoid whole-mesh disappearance followed by unrelated generic debris.
- Parent/child detachments must remain coherent: explicitly decide whether a severed limb initially stays jointed, which connections then break, and how downstream pieces transfer ownership. Do not duplicate bones or leave an intact duplicate body behind.
- Missing bones must remain missing in rendering, hit detection and authoritative state. Map bone IDs consistently between art, animation, collision, damage and networking. All skeleton classes must support the system underneath their interchangeable kits.
- Multiplayer must agree on damage, severed parts, death and any gameplay-relevant bone interactions. Cosmetic trajectory approximation is acceptable only if it cannot change hits, obstruction, pickups or repair outcomes.
- Phone/Quest optimization should use simple convex colliders, sleeping, bounded active simulation, pooling and relevance management. It must not silently replace individual physical bones with vanishing particles or make gameplay differ across clients. Document any proposed limits or simplifications for approval.

The user expects substantial ENGINEERING as well as 3D work. This is not satisfied by a visual dismemberment animation alone. Audit the existing skeleton damage, animation, physics and network systems before choosing the implementation.

## Design decisions still awaiting answers

The user has not yet answered the earlier clarifying questions. Do not present the following as approved rules: every hit must sever a bone; exact local damage thresholds; skull/core destruction as the kill condition; headless survival; one-legged hopping/crawling; self-reassembly; Bonebinder resurrection; player bone pickup/throw/resource use; debris lifetime; armour thresholds. Prepare explicit recommendations and resolve these before locking mechanics.

## Suggested demonstration and acceptance evidence

1. Show one ordinary skeleton in a repeatable scene. Hit selected body regions and demonstrate impact, progressive damage, physical separation, collision and settling in continuous footage.
2. Display bone IDs/colliders in a debug overlay and prove detached pieces are physics objects, rather than only particle effects. Verify no invisible old collider or duplicate intact mesh remains.
3. Exercise missing-limb animation and kill/repair rules once agreed. Repeat with heavy armour and role equipment; show attachment clearance and no floating kit.
4. Show two peers and a late joiner agreeing on attached/missing bones and gameplay state; test reconnect, duplicate events and cleanup.
5. Profile representative crowds and accumulated debris on desktop and available physical phone/Quest hardware. Report frame pacing, active/sleeping body counts, memory and network cost. Clearly label emulation and untested hardware.

These are proposed acceptance criteria for the future implementation, not claims that the current game passes them. Do not claim all existing animations work automatically: validate sockets, proportions, deformation and break-apart behaviour on each kit.

## Art integration notes

Reuse each faction's real base mesh/rig wherever practical. Kit silhouettes and personality are the intent; generated topology, measurements and mechanics are not authoritative. Skeletons remain actual bones: remove incidental brass ball-joint interpretations on Graveback. Wickbone's hand-carry/back-carry illustrations need one explicit transport convention, and its fuse should reflect actual armed state. Siege mechanisms, stakes and crossbow strings require mechanical review. Opus 5.5 owns production 3D quality under the project's existing account/model rules.

No game runtime or production asset was changed by this handoff.
