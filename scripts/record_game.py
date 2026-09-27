"""Compatibility launcher: recording is now controlled by the native game + OBS."""
import pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[1]
subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(root/'scripts/Start-OBS.ps1')],check=True)
print('OBS ready. Hold right B for one second in VR, or use Toolbelt > Quick > Start video. Ctrl+Shift+F9 is the desktop fallback.')
