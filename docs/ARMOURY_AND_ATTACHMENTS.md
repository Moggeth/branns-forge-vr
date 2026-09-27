# The collection now; the hall next

## Implemented: a predictable home for today's collection
The Forge Yard collection porch displays each tier-unlocked standard tool, every successfully published invention, and the original apprentice hammer. The current Tier 3 save has nine exhibits: Copperpot's Promise, Orchard's Edge, Stonewhisper, Pocket Thunder, Swallowline, Mooncap Lantern, Hollow's Song, the original apprentice hammer and Siegebird. The Last Hearth remains locked. Temporary dev spawns are not mistaken for permanent unlocks.

Names and numbered stands remain when tools are carried away. Grip the actual tool to take it; the stand reports carried, holstered or away. RETURN TO STAND retrieves an abandoned item without stealing anything from either hand or belt. Pocket Thunder displays the gloves and explains their existing worn controls. Newly available standard tools become persistently owned when taken, subject to the existing workshop tier. New creations retain the forge reveal, then travel to their own stand.

## Proposed next: the Hall of Inventions — not implemented
A roughly 24 by 40 metre timber-and-stone hall adjoining the forge, with a six-metre central aisle and broad cross aisles. Start with twelve display bays containing four ordinary exhibits each: forty-eight homes, mostly empty at first. Provide wall racks for long weapons, waist-high plinths for gadgets, and larger bays for oversized inventions. Open sightlines, gentle crystal accents and warm timber should carry the space; avoid excessive visual detail or many shadow-casting lights in VR.

Each creation gets a permanent address, name, creation date, short player brief and lineage. Additions fill unused homes rather than shuffling the collection. Empty mounts retain a faint silhouette and clear whereabouts. A small directory at the entrance highlights the selected stand; favourite equipment also gets a convenient loadout rack by the exit. Museum organisation is independent of functional item IDs, so moving from the porch preserves ownership and history. Add wings only as needed rather than building a procedural castle now.

The existing player state and ready-item ledger should supply a single collection catalogue shared with Bran. Move the local home registry to that authoritative catalogue when the hall is built. Persist references, exhibit addresses and active configuration, not entire scene trees. Failed commissions stay in the journal, not on successful-invention pedestals. Retain old versions in a lineage drawer beside the original home.

## Proposed first modification: Siegebird's grappling bolt — not implemented
Bran should consult that catalogue before proposing a new tool. For a grapple request: offer a compatible grappling-bolt/spool modification, a separate hook, or a new crossbow variant. The player's choice determines the result. Compatibility is a useful suggestion, never a restriction on inventing something else. Do not claim anything has been attached before the game confirms installation.

Start with one explicitly supported socket and one module. Grip a spool module, align it with the mounting point and secure its latch. Then physically load a grappling bolt using Siegebird's existing crank/loading sequence. Its projectile attaches to a valid world anchor and the spool provides the existing controlled traversal behaviour. Detaching restores ordinary bolts. Keep the rear/support grip and optic unchanged.

Give modules semantic interfaces: mounting transform, compatible host capabilities, projectile/trigger behaviour, state, sound and haptics. A versioned item manifest should identify its native mechanism independently of the generated asset ID: Siegebird currently uses a single hardcoded ID, so blindly refining its model would lose the reload adapter. Solve that boundary before letting the generator advertise arbitrary attachments. A mounted module should add capabilities through the existing item action dispatcher, not replace an entire weapon script.

Keep the original usable while a modification is being built. Snapshot the previous configuration before installation and preserve a rollback path. Price the new capability with the existing four-tier workshop rules and small resource offerings. Validate save/reload, removal, handover, holstering, dry fire, ordinary bolts and grapple bolts before allowing further module types.

Suggested order: playtest the porch; agree the hall layout; establish the shared catalogue/lineage and mechanism metadata; build one tactile grapple module; expand only after that interaction is satisfying.
