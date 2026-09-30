# Emberwing physical and visual refinement

The designer review identified a real ergonomic fault: the arrow travelled
through the middle of the gripping fingers. Revision 3 replaces that bore with
a solid oval grip and a raised, open sight window. The string's braced nock is
at `(0, .115, .10)` and the physical guide at `(0, .115, -.012)` in bow metres.
The sculpted phoenix and cambered feather roots sit outside that corridor.

Upper and lower limbs now have their own authored root pivots. The string-tip
markers are children of those limbs; runtime string endpoints use their full
world transforms, so they follow draw movement while staying seated in their
fittings. Physical draw aims through the guide. Small shared material copies
give draw and curve mode an emissive response without adding lights.

The structural commission used the verified personal Claude.ai subscription,
actual `claude-sonnet-5-5` session metadata and an isolated folder. It took
464.731 seconds. Source, report and its candid handoff are retained here.
Khronos and disposable Godot inspection passed in 2.246 seconds; the focused
actual-game regression passed 37 assertions in 7.465 seconds. This includes
five rays against the actual imported triangles at brace and draw, both grip
orientations, guide height, moving string sockets, release and curved flight.

The repeatable hand review uses the actual articulated game gloves and imported
model in synthetic controller poses. It captures both hands, braced and drawn,
from side and three-quarter views in one offline run:

```powershell
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot -- --desktop-hero-preview=bow --preview-bow-mechanics "--preview-output=$PWD/outputs/emberwing-refinement/mechanics.png"
```

It never starts voice/service requests or a headset session. Images and
`mechanics.json` land beside the specified PNG path. Engine captures establish
the authored pose and geometry; comfortable reach and tracked fingers still
need a live headset playtest. A normal game relaunch loads the revision.

Material review remains a separate pass: the structural screenshots deliberately
retain the previous materials. In particular, an inconsistent material-slot
order currently makes most of the leather grip metallic. The next art revision
must resolve that in the source mesh rather than hide it with a game override.
