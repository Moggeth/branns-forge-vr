"""Additional deterministic contact pairs and Phoenix call. No external samples/API.
Run from any directory: python multiplayer/assets-source/material-audio/generate_contact_audio.py
"""
from pathlib import Path
import json,time,wave
import numpy as np
from generate_material_audio import band
SR=32000
OUT=Path(__file__).resolve().parents[2]/'public/assets/material-audio'
def render(kind, seed):
    rng=np.random.default_rng(seed); duration=.62 if kind=='phoenix_call' else .34
    t=np.arange(round(duration*SR))/SR
    noise=rng.normal(0,1,len(t)); p=rng.uniform(.94,1.06)
    if kind=='phoenix_call':
        freq=(1550+1600*np.exp(-((t-.12)/.13)**2)-700*t)*p
        phase=np.cumsum(freq)/SR*2*np.pi
        envelope=np.sin(np.pi*t/duration)**1.4*np.exp(-t*1.2)
        voice=np.sin(phase+1.7*np.sin(phase*.49))+.3*np.sin(phase*2.013)
        out=envelope*(voice*.22+band(noise,1800,6200)*.1)*(1+.18*np.sin(t*2*np.pi*37))
    else:
        profiles={'stone_blunt':(105,420,.04,.08), 'timber_knock':(140,780,.065,.06), 'shield_thunk':(125,1300,.085,.035), 'flesh_thud':(65,310,.035,.045)}
        low,hi,tail,grit=profiles[kind]
        impact=band(noise,low,hi)*np.exp(-t/tail)
        transient=band(noise,900,6000)*np.exp(-t/.009)*grit
        modes=sum(np.sin(2*np.pi*f*p*t+rng.uniform(0,2*np.pi))*np.exp(-t/(tail/(1+i*.35)))/(2+i) for i,f in enumerate([low,low*1.83,low*2.91]))
        out=.65*impact+.28*modes+transient
        if kind=='stone_blunt':out+=band(noise,1100,4900)*np.exp(-t/.095)*.07
    out*=np.minimum(t/.001,1)*np.minimum((duration-t)/.015,1)
    out*=.58/(np.max(np.abs(out))+1e-12)
    return out
if __name__=='__main__':
    start=time.perf_counter();OUT.mkdir(parents=True,exist_ok=True);stats=[]
    for k,kind in enumerate(['stone_blunt','timber_knock','shield_thunk','flesh_thud','phoenix_call']):
        for j,suffix in enumerate('abc'):
            x=render(kind,641+k*31+j);name=f'{kind}_{suffix}.wav'
            with wave.open(str(OUT/name),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(SR);w.writeframes((x*32767).astype('<i2').tobytes())
            stats.append({'file':name,'seconds':len(x)/SR,'peak':float(np.max(np.abs(x))),'rms':float(np.sqrt(np.mean(x*x)))})
    Path(__file__).with_name('contact-audio-metrics.json').write_text(json.dumps({'elapsedSeconds':time.perf_counter()-start,'assets':stats},indent=2),encoding='utf-8')
    print(f'Generated {len(stats)} mono contact/call variants in {time.perf_counter()-start:.3f}s')
