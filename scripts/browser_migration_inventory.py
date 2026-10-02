"""Deterministic, conservative port triage. No content is copied or deleted.

The register is a scope decision, NOT a claim that every asset was rendered or
every native mechanic playtested. Unselected content is explicitly deferred.
"""
import csv
import json
import pathlib
import re
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/browser-migration'

CORE = ('landscape_', 'skeleton_', 'guardian_', 'mining_', 'tree_', 'physical_',
        'projectile_', 'enemy_projectile', 'melee_', 'hard_surface_', 'held_pose_',
        'grip_runtime', 'desktop_', 'terrain_safety', 'respawn_', 'world_reset',
        'hero_axe', 'phoenix_', 'apple_', 'skull_basket', 'world_builder_target',
        'ground_', 'orchard_ground', 'orchard_dressing', 'orchard_foliage')
CANDIDATE_ART = ('godot/assets/ground-surface-kit/', 'godot/assets/tree_cutting/',
                 'godot/assets/landscape/', 'godot/assets/atmosphere/sonnet_bank/',
                 'godot/assets/orchard/', 'godot/weapons/emberwing/')
EXACT_ART = {'godot/weapons/stonewhisper.glb', 'godot/weapons/orchards_edge.glb',
             'godot/guardians/rigged/mossward_rig.glb', 'godot/assets/golem/golem.glb'}
SPELL_KEEP = {'path','sunder','raise','wall','meteor','grove','forest','ring','bridge','ramp','duelist'}
SPELL_REBUILD = {'harvest','hire','awaken','calm','fault','stairs','boardwalk','patrol','shield_patrol','golem'}
WEAPON_KEEP = {'woodland_axe','quarry_pick','emberwing','guardian_shield_mossward'}

def classify(path):
    p = pathlib.PurePosixPath(path)
    if p.suffix in ('.uid', '.import'):
        return 'EXCLUDE', 'Engine-generated identity/import metadata; browser assets have their own manifest.'
    if any(part in ('native','launcher') for part in p.parts):
        return 'EXCLUDE', 'Desktop/abandoned engine infrastructure; keep archived, not in web client.'
    if p.suffix != '.glb' and any(word in p.stem.split('_') for word in ('check','checks','capture','review','showcase','fixture','stress','inspection','lab','demo')):
        return 'TOOLING', 'Keep as offline reference/acceptance evidence; never ship diagnostic content by default.'
    if p.suffix == '.glb':
        if path in EXACT_ART or path.startswith(CANDIDATE_ART):
            return 'CANDIDATE', 'Selected family for the core loop; inspect each asset, deduplicate LODs and pass web budgets before copying.'
        return 'DEFER', 'Not selected for the first shared Orchard; retain source for later review, no automatic bulk import.'
    if p.suffix == '.gdshader':
        return 'REBUILD', 'Godot shader cannot run in Three.js; recreate only effects used by selected gameplay with mobile/VR budgets.'
    if p.suffix == '.gd':
        if p.stem.startswith(CORE):
            return 'REBUILD', 'Preserve selected rules/acceptance ideas; implement once in shared browser authority and renderer adapters.'
        if p.stem in ('main','setup_actions','tool_physics','player_avatar','hand_animation','anchored_hand'):
            return 'REBUILD', 'Use browser-native input/physics/embodiment boundaries; do not transliterate the native orchestration.'
        return 'DEFER', 'Native feature is outside the first port; see human feature decisions before reactivating.'
    return 'DEPENDENCY-ONLY', 'Not an independent port approval: ship only if referenced by a selected validated browser asset or feature.'

def main():
    started=time.perf_counter()
    tracked=subprocess.check_output(['git','ls-files','-z','godot','native','launcher'],cwd=ROOT).decode().split('\0')
    rows=[]
    for path in sorted(p for p in tracked if p):
        decision,reason=classify(path)
        rows.append({'kind':'source','id':path,'decision':decision,'reason':reason})
    weapons=json.loads((ROOT/'godot/weapon_inspection_catalog.json').read_text())['subjects']
    for w in weapons:
        decision='CANDIDATE' if w['id'] in WEAPON_KEEP else 'DEFER'
        reason='Core interaction, with a dedicated browser gameplay and orientation acceptance gate.' if decision=='CANDIDATE' else 'Not in initial loadout; avoid overlapping tools and separate minigame complexity. See curation report.'
        rows.append({'kind':'weapon','id':w['id']+' / '+w['name'],'decision':decision,'reason':reason})
    spells=(ROOT/'godot/world_builder_spells.gd').read_text(encoding='utf-8')
    for line in spells.splitlines():
        match=re.search(r'"id":"([^"]+)".*?"title":"([^"]+)"',line)
        if not match: continue
        key,title=match.groups()
        decision='CANDIDATE' if key in SPELL_KEEP else 'REBUILD' if key in SPELL_REBUILD else 'DEFER'
        reason='Core shared-world verb; reimplement in authoritative browser simulation, not a direct code copy.'
        if '"implemented":false' in line:
            decision='EXCLUDE';reason='Explicitly marked unimplemented in native catalogue. Do not expose a dead action.'
        elif decision=='DEFER': reason='Additional economy/enemy/growth complexity; not part of first port.'
        elif decision=='REBUILD': reason='Keep concept later; redesign around clear purpose, ownership, navigation and bounded networking.'
        rows.append({'kind':'spell','id':key+' / '+title,'decision':decision,'reason':reason})
    quests=json.loads((ROOT/'service/quests-config.json').read_text())['quests']
    for q in quests:
        keep=q['id']=='skull_basket'
        rows.append({'kind':'quest','id':q['id']+' / '+q['name'],'decision':'REBUILD' if keep else 'EXCLUDE',
                     'reason':'Physical shared objective; recreate room-owned unique skull delivery.' if keep else 'Generic count-and-return chore; replace with cooperative situational objectives.'})
    for d in json.loads((ROOT/'godot/living_demo_packages.json').read_text()):
        rows.append({'kind':'demo','id':d['id']+' / '+d['name'],'decision':'TOOLING','reason':'Keep experimental capability examples offline; not launch game content.'})
    OUT.mkdir(exist_ok=True)
    with (OUT/'inventory.csv').open('w',newline='',encoding='utf-8-sig') as f:
        writer=csv.DictWriter(f,fieldnames=['kind','id','decision','reason']);writer.writeheader();writer.writerows(rows)
    summary={'source_files':len(tracked)-1,'glb_files':sum(r['kind']=='source' and r['id'].endswith('.glb') for r in rows),
             'catalogued_weapons':len(weapons),'records':len(rows),
             'decisions':{d:sum(r['decision']==d for r in rows) for d in sorted(set(r['decision'] for r in rows))}}
    (OUT/'coverage.json').write_text(json.dumps(summary,indent=2)+'\n')
    elapsed=time.perf_counter()-started
    with (ROOT/'logs/work-timing.csv').open('a',newline='') as f:csv.writer(f).writerow(['browser-migration-inventory','passed',elapsed])
    print(json.dumps(summary));print(f'elapsed_seconds={elapsed:.6f}')

if __name__=='__main__':main()
