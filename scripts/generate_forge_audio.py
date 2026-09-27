"""Reproducible, original forge audio; no downloads or external dependencies."""
import math, random, struct, wave
from pathlib import Path
RATE = 22050
OUT = Path(__file__).resolve().parents[1] / 'godot' / 'audio'
def save(name, samples):
    peak=max(abs(x) for x in samples) or 1
    with wave.open(str(OUT/name),'wb') as f:
        f.setparams((1,2,RATE,len(samples),'NONE','not compressed'))
        f.writeframes(b''.join(struct.pack('<h',int(x/peak*20000)) for x in samples))
def strike(index):
    rng=random.Random(410+index)
    base=295+index*19
    result=[]
    for i in range(int(RATE*.62)):
        t=i/RATE
        attack=min(1,t/.0015)
        modes=sum(math.sin(2*math.pi*base*r*t)*a*math.exp(-t*d) for r,a,d in [(1,.42,14),(2.73,.25,6+index*.25),(5.17,.13,12),(7.91,.055,22)])
        tap=(rng.random()*2-1)*.65*math.exp(-t*210)
        body=math.sin(2*math.pi*(105+index*3)*t)*.21*math.exp(-t*32)
        result.append((modes+tap+body)*attack*min(1,(.62-t)/.025))
    save(f'forge-impact-{index+1}.wav',result)
def reveal():
    result=[]
    for i in range(int(RATE*1.25)):
        t=i/RATE
        value=0
        for start,freq in [(0,523.25),(.13,659.25),(.26,783.99),(.30,1046.5)]:
            age=t-start
            if age>=0:
                env=min(1,age/.015)*math.exp(-age*4.8)*min(1,(1.25-t)/.08)
                value+=env*(math.sin(2*math.pi*freq*age)+.13*math.sin(4*math.pi*freq*age))*.18
        result.append(value)
    save('forge-reveal.wav',result)
OUT.mkdir(parents=True,exist_ok=True)
for index in range(8): strike(index)
reveal()
print('Generated eight distinct impacts and one reveal cue.')
