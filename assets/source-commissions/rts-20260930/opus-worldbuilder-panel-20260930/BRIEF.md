# Opus 5.5 commission: Orchard spell command panel

You are the primary UI designer for Brann's Forge, a magical Godot 4.7.2 VR/RTS shared-world game. Make an excellent native RTS command panel inspired by classic Warcraft 3 command cards, with your own art direction. The current menu is a cluttered grid of text buttons. The game world must dominate the screen and the panel should feel crafted, crisp, magical and serious. UI remains native full-screen resolution even when the live world is rendered at 65%. This is a PC interface, not a phone website.

FIRST tangible milestone: write an implementation-ready `world_builder_command_panel.gd` before extended exploration. You have 240 seconds. Work only in this isolated directory. Do not edit the actual repository, contact APIs, publish, deploy, alter credentials or inspect secrets. Current view is supplied only as context; preserve camera/renderer/performance interfaces for Codex integration. Do not copy its layout.

Deliver a self-contained Godot 4 Control script plus `HANDOFF.md` with layout/interaction decisions, palette/typography/spacing, narrow 960x620/full-HD/4K behavior and integration notes. Prefer your own native shapes/shader for a Mana orb/bar, restrained animation, parchment/tooltips, brass/wood/teal/violet surfaces, selected card border, cooldown fill and clear costs. The spell cards will get an illustrated icon atlas from Codex (do not draw placeholder SVG illustrations). It must look finished even while atlas is loading: readable titles and useful fallback silhouettes. Godot default font is acceptable; no external dependency.

API contract (you may improve naming but preserve these responsibilities and document exact API):
- signals `spell_selected(id:String)`, `palette_selected(id:String)`, `regen_preset_selected(multiplier:float)`, `cancel_targeting()`.
- `setup(catalogue:Array)` entries dictionary `{id,title,palette,description,gesture,mana,lumber,cooldown,icon}`. Empty/unknown fields have reasonable defaults.
- `update_state(state:Dictionary)` containing `{mana,max_mana,wood,selected,palette,spell_cost,feedback,seed,helpers,availability:{action:reasonString},cooldowns:{action:remainingFraction}}`. A cooldown fraction of 1 means just cast, 0 ready. Selected card remains active for repeated casting.
- `set_icon_atlas(texture:Texture2D,columns:int,rows:int,indices:Dictionary)` maps action IDs to zero-based atlas cell.
- `is_over_panel(position:Vector2)->bool` lets root block world casting when clicking UI.
- `handle_shortcut(event:InputEventKey)->bool` keys1-9 select current-palette cards, F1-F4 switch palettes, Esc cancels. Ignore repeats; root owns right-click cancellation.
- `bottom_extent()->float` and `layout_for_size(size:Vector2)` if fixed layout is used, or responsive native anchors. Root can reserve world-space preview camera accordingly.

Palettes: Land [path,sunder,raise,wall,meteor,fault]; Life [grove,forest,ring,awaken]; Construction [bridge,ramp,stairs,boardwalk,outpost,tower,platform,gate,barricade]; Encounters [patrol,golem]. Use exact IDs. Up to 9 cards per palette. 1-9 shortcuts visible on every card. Tooltips show spell name, mana/lumber cost, concise purpose and casting gesture, plus unavailable reason. Permit selecting an unavailable spell to inspect its reason; casting is validated by backend. A prominent attractive Mana orb/bar should show current20maximum and selected cost, affordability and regen preset toggle (Testing4x / Normal1x). Clearly visible cooldown progress on cards. Minimal clutter; preserve readable scale cues.

Write code, not merely a design endorsement. If you can validate syntax with the existing bundled Godot without copying the live game, do so; otherwise explain what Codex must verify. Keep implementation bounded: no per-card polling nodes or dozens of shader materials. Do not claim screenshots were inspected if none were created.
