from pathlib import Path
ROOT = Path(__file__).resolve().parent
from PIL import Image, ImageFilter, ImageStat
import numpy as np
src = Image.open(ROOT / 'loam_original.png').convert('RGB')
a = np.asarray(src).astype(np.float32)/255
lum = (a*[0.299,0.587,0.114]).sum(2)
lo, hi = np.percentile(lum,2), np.percentile(lum,98)
t = np.clip((lum-lo)/(hi-lo),0,1)
# soften the busiest grain: blend towards a wrapped blur of the luma (tileable via padding)
im = Image.fromarray((t*255).astype(np.uint8))
pad = np.pad(np.asarray(im),((64,64),(64,64)),mode='wrap')
bl = np.asarray(Image.fromarray(pad).filter(ImageFilter.GaussianBlur(5)))[64:-64,64:-64]/255
t = 0.45*t + 0.55*bl
t = np.clip((t-0.5)*1.25+0.5,0,1)       # re-stretch so patches stay readable
# warm woodland palette: dark leaf-mould -> mid soil -> sunlit duff / dry needles (sRGB)
dark = np.array([84,60,36])/255.; mid = np.array([128,92,52])/255.; lite = np.array([172,134,78])/255.
t3 = t[...,None]
col = np.where(t3<0.5, dark+(mid-dark)*(t3*2), mid+(lite-mid)*((t3-0.5)*2))
# keep a little of the original hue variation (moss/ochre flecks)
orig_n = a/np.maximum(a.mean((0,1)),1e-3)
col = col*(0.80+0.20*np.clip(orig_n,0.3,2.0))
out = Image.fromarray((np.clip(col,0,1)*255).astype(np.uint8))
out.save(ROOT / 'loam_rebuilt.png', optimize=True)
s=ImageStat.Stat(out); print('new loam mean',[round(x) for x in s.mean],'std',[round(x) for x in s.stddev])
