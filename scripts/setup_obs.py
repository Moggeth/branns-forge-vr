import pathlib,os,json,secrets,shutil,time,subprocess
if subprocess.run(["powershell.exe","-NoProfile","-Command","if(Get-Process obs64 -ErrorAction SilentlyContinue){exit 1}"],creationflags=subprocess.CREATE_NO_WINDOW).returncode:
 raise SystemExit("Close OBS before running setup; no files were changed.")
root=pathlib.Path(__file__).resolve().parents[1]
obs=pathlib.Path(os.environ['APPDATA'])/'obs-studio'
backup=root/'work'/('obs-backup-'+time.strftime('%Y%m%d-%H%M%S'));backup.mkdir(parents=True,exist_ok=True)
f=obs/'plugin_config/obs-websocket/config.json';shutil.copy2(f,backup/'websocket.json')
c=json.loads(f.read_text('utf-8-sig'));c.update(server_enabled=True,auth_required=True)
if not c.get('server_password'): c['server_password']=secrets.token_urlsafe(32)
f.write_text(json.dumps(c,indent=2))
profile=obs/'basic/profiles/BrannsForge';profile.mkdir(exist_ok=True)
if (profile/'basic.ini').exists():shutil.copy2(profile/'basic.ini',backup/'basic.ini')
output=root/'recordings';output.mkdir(exist_ok=True)
(profile/'basic.ini').write_text(f'''[General]
Name=Branns Forge Silent

[Video]
BaseCX=1280
BaseCY=800
OutputCX=1280
OutputCY=800
FPSType=0
FPSCommon=30

[Output]
Mode=Simple
FilenameFormatting=Branns-Forge-%CCYY-%MM-%DD-%hh-%mm-%ss

[SimpleOutput]
RecEncoder=nvenc
RecQuality=Small
RecFormat2=hybrid_mp4
FilePath={output.as_posix()}
RecRB=false

[Audio]
SampleRate=48000
ChannelSetup=Stereo

[Hotkeys]
OBSBasic.StartRecording={{"bindings":[{{"control":true,"shift":true,"key":"OBS_KEY_F9"}}]}}
OBSBasic.StopRecording={{"bindings":[{{"control":true,"shift":true,"key":"OBS_KEY_F9"}}]}}
''')
scene=obs/'basic/scenes/BrannsForge.json'
if not scene.exists():
 scene.write_text(json.dumps({'name':'Branns Forge','current_scene':'Branns Forge','current_program_scene':'Branns Forge','scene_order':[{'name':'Branns Forge'}],'sources':[{'name':'Branns Forge','id':'scene','settings':{'items':[]}}],'groups':[],'transitions':[],'current_transition':'Cut','transition_duration':0,'modules':{}},indent=2))
print('Dedicated OBS profile prepared; original profile and scenes preserved. Backup: '+str(backup))
