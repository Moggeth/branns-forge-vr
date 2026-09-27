# Immutable 09:09 package review

Reviewed `outputs/Bellworks-Persistent-Demo-20260921-090940.zip` on
21 September 2026, 09:49–09:54 Sydney. The archive was opened read-only and
extracted into a unique OS-temp folder. No production code, accepted ZIP,
resident process, normal save, headset or network service was changed by this
review.

## Confirmed entry-point defect

The documented `Play Desktop.cmd` and `Play VR.cmd` provide `--playful-demo
--demo-persistent`, but users can also open the bundled `Bellworks.exe` directly.
That executable automatically finds the adjacent `Bellworks.pck`. Without the
launcher arguments, main's diagnostic/offline expression is false. Ordinary
module setup can then read the normal Living/quest/challenge saves and main's
normal startup polls the local service, contradicting the package's promised
offline save isolation.

Source evidence: `main.gd` diagnostic assignment at line 134 and startup poll
at line 306; `living_runtime.gd` normal-save read at line 38;
`quest_runtime.gd` normal outbox read at line 19. The export preset originally
had no custom package identity, and Build-Bellworks only supplied the demo flags
in its command launchers.

Safe immutable-pack proof used the extracted executable, an unrelated working
directory and **no** `--main-pack` or user arguments. An external SceneTree
audit loaded the packed main scene without adding it to the tree, reporting:

```text
PACKAGE_RESOURCE_REVIEW checks=20 failures=[] engine=4.7.2-stable (official)
PACKAGE_ENTRY_BOUNDARY main=res://main.tscn diagnostic_default=false user_args=[] ready_executed=false
```

The unsafe gameplay startup itself was deliberately not executed. No normal
save/service setup was needed to establish the argument and package boundary.

Root accepted the minimal remedy: mark demo exports with `bellworks_demo`, and
guard the first line of main startup when that feature or the bundled executable
name identifies this package but `--playful-demo` is absent. Print
`BELLWORKS_LAUNCHER_REQUIRED`, explain which launcher to use when graphical,
and exit before gameplay setup. Feature identity also covers a renamed EXE.
Root owns the production patch and verification against a new export; the
reviewed 09:09 archive remains preserved.

## Completeness and launcher results

All seven expected ZIP entries exist: executable, PCK, Godot licence notices,
desktop launcher, VR launcher, READ ME, and manifest. All three files covered
by the manifest have matching SHA-256 hashes and sizes. Both launchers use a
quoted package-relative executable/PCK, establish their own working directory,
create a log directory and specify the correct XR mode and offline demo flags.
README accurately names the supported launchers, controls, activities and demo
progress directory. Its unconditional isolation promise exposed the direct-EXE
exception above.

The **bundled executable**, rather than the source workspace's console engine,
successfully loaded 20 essential scenes/scripts/data resources from the extracted
PCK in an unrelated working directory. This checks the shipped engine/PCK
boundary and automatic pack discovery without repeating unchanged gameplay
suites. Resources include all new activities, persistence modules, Living
components/projectiles, featured JSON inventions and tuning schema. The audit
reported no engine or script errors and exited zero.

Disposable audit: `work/package-resource-review.gd`.
Fixture/logs: `%TEMP%/brann-package-review-20260921-095118/`.
Measured steps: `logs/package-090940-review-timing.csv`.

Review-tool lesson: constrain build-script discovery to `scripts/` or its
top-level files. Recursing through bundled `tools/` produced irrelevant Blender
library matches and truncated useful output; the targeted script search was
both clearer and sufficient.
