# Handoff: FPS swing refine (only `desktop_weapon_pose.gd` changed; profile API, CONTACT=.5 untouched)

Not run in an engine; reasoning/arithmetic only. Please capture natively and run the pose tests.

## Key changes
- **Anticipation depth**: `windup.z = rest_tip.z - pre` (pick .04, axe .06, hammers .05, generic .05 m), not `-reach+.1`. `wind.z` is now unused (xy still offsets from contact). The tool no longer travels ~1.3 m away in the lift, so no scale collapse.
- **Reach spent in the strike**: strike Hermite z-tangents are 0 at windup and `lead*dz/(.5-a)` at contact, giving z/dz = (3-k)u² + (k-2)u³. With k<2 (pick 1.8, axe/generic 1.6, hammers 1.2) the tip is ~30-35% forward at mid-strike, then extends late. xy tangents/magnitudes are computed from the screen-plane chord only, so xy speed matches the old behaviour (otherwise the large z chord would inflate it).
- **Hand-pivot lift**: anticipation gets a 0.03 m bow, 16u²(1-u)², away from a lower-right pivot (.45,-.6). It has zero value and slope at both ends, so tangent joins stay smooth. The strike keeps its up-left bulge.
- **Rotation**: face/cant alignment eases in over `a + .55*(.5-a)` instead of finishing at `a`, so the tool keeps its rest silhouette through the lift and reaches full working-plane cant before contact. No new flips (same slerp from rest, same wrist rows).
- Unchanged: contact tip exactly `(0,0,-reach)` at .5, rest endpoints exact (p=0/1: activity 0, zero velocity, same rest basis), no camera or input-lag code, v_contact shared by both sides of contact (continuous), wrist rows, durations/cooldowns.

## Limits
- Because velocity is continuous through contact, a miss overshoots contact depth: roughly 0.1 m (pick/axe) to 0.14 m (hammers) beyond `-reach` before pulling back. Lower `lead` to reduce it, at the cost of a less late reach.
- The strike is still fast (about 1.3 m in ~40% of the duration); there is no one-frame leap, but a high-speed read at 35-50% is expected.
- `pre` is a depth *offset* from rest; if a rest tip is deeper than `-reach+.3` it is clamped.
- Pivot position and bow size are tuned by reasoning, not by capture; check the 10-20% frames first. If the lift reads left of the hand, flip sign by moving the pivot constant.
