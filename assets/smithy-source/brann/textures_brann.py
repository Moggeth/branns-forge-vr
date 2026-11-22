# Procedural bitmap textures for Brann (numpy, deterministic seeds). Imported by build_brann.py.
# Every map is a real packed image (base color / ORM roughness+metal / tangent normal) so it embeds in the GLB.
import numpy as np, bpy

def pnoise(n, beta, seed, lo=1.0):
    rng = np.random.default_rng(seed); fx = np.fft.fftfreq(n)*n
    f = np.sqrt(fx[:,None]**2 + fx[None,:]**2); f[0,0] = 1
    sp = (rng.normal(size=(n,n)) + 1j*rng.normal(size=(n,n))) / f**beta; sp[f < lo] = 0
    h = np.real(np.fft.ifft2(sp)); return (h-h.min())/(h.max()-h.min())

def normal_from(h, s):
    gy, gx = np.gradient(h); n = np.dstack((-gx*s, -gy*s, np.ones_like(h))); n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n*0.5+0.5

def img(name, rgb, noncolor=False):
    n = rgb.shape[0]; im = bpy.data.images.new(name, n, n, alpha=False, is_data=noncolor)
    if noncolor: im.colorspace_settings.name = 'Non-Color'   # must precede pixel write (regenerates buffer)
    im.file_format = 'PNG'
    a = np.ones((n,n,4), np.float32); a[...,:3] = np.clip(rgb, 0, 1); im.pixels.foreach_set(a.ravel())
    im.update(); im.pack(); return im

def orm(rough, metal=0.0):
    return np.dstack((np.ones_like(rough), rough, np.full_like(rough, metal)))

def grid(n):
    v, u = np.mgrid[0:n, 0:n]/n; return u, v

def skin(n=512):
    mot = pnoise(n, 1.3, 11); red = pnoise(n, 1.8, 12); pore = pnoise(n, 0.5, 13, lo=40)
    soot = np.clip((pnoise(n, 2.0, 14) - 0.58)*3.2, 0, 1)*0.5
    rng = np.random.default_rng(15); fr = np.zeros((n,n)); yy, xx = np.mgrid[-3:4, -3:4]
    for _ in range(900):
        x, y = rng.integers(0, n, 2); r = rng.uniform(0.8, 2.0)
        fr[np.ix_((y+np.arange(-3,4))%n, (x+np.arange(-3,4))%n)] += np.exp(-(xx*xx+yy*yy)/(r*r))*rng.uniform(0.3, 1)
    fr = np.clip(fr, 0, 1)*0.18
    col = np.array((0.74, 0.47, 0.35))[None,None,:]*(0.92+0.14*mot[...,None])
    col = col + (red[...,None]-0.5)*np.array((0.10, -0.02, -0.03))
    col = col*(1-fr[...,None]) + np.array((0.55, 0.30, 0.20))*fr[...,None]
    col = col*(1-soot[...,None]) + np.array((0.22, 0.19, 0.17))*soot[...,None]
    return col, 0.64 + 0.10*pore + 0.12*soot, normal_from(pore*0.6 + mot*0.4, 3.0)

def weave(n, col, threads, seed, twill=False):
    u, v = grid(n); nz = pnoise(n, 1.1, seed)
    if twill:
        h = 0.5+0.5*np.sin(2*np.pi*(u+v)*threads)
    else:
        a = np.abs(np.sin(np.pi*u*threads)); b = np.abs(np.sin(np.pi*v*threads))
        chk = ((np.floor(u*threads)+np.floor(v*threads)) % 2) > 0; h = np.where(chk, a, b)*0.8
    c = np.array(col)[None,None,:]*(0.78+0.28*h[...,None])*(0.88+0.2*nz[...,None])
    return c, 0.78 + 0.12*(1-h), normal_from(h*0.7 + nz*0.3, 2.2)

def leather(n, col, seed, seams=False):
    u, v = grid(n); grain = pnoise(n, 0.7, seed, lo=25); wear = pnoise(n, 1.6, seed+1); crack = pnoise(n, 1.0, seed+2, lo=6)
    glaze = np.clip((wear-0.45)*2.5, 0, 1); scr = (np.abs(np.sin(crack*40)) < 0.05)*0.5
    c = np.array(col)[None,None,:]*(0.75+0.35*wear[...,None])*(0.93+0.12*grain[...,None])
    c = c*(1-0.25*scr[...,None]) + np.array((0.40, 0.26, 0.16))*0.25*scr[...,None]
    h = grain*0.6 - scr*0.5; rough = 0.72 - 0.28*glaze + 0.1*grain
    if seams:
        e = np.minimum(np.minimum(u, 1-u), np.minimum(v, 1-v))
        edge = np.clip(1 - e/0.04, 0, 1); c = c*(1 - 0.35*edge[...,None]); rough = rough + 0.1*edge
        line = (np.abs(e - 0.022) < 0.0035) & (((u+v)*n/9).astype(int) % 2 == 0)
        c[line] = np.array((0.62, 0.48, 0.30)); h = h + line*0.8 - (np.abs(e-0.032) < 0.003)*0.5
    return c, np.clip(rough, 0.3, 0.95), normal_from(h, 3.0)

def hair(n, col, seed):
    u, v = grid(n); nz = pnoise(n, 1.4, seed); fine = pnoise(n, 0.6, seed+1, lo=30)
    h = 0.5+0.5*np.sin(2*np.pi*u*48 + nz*14); g = 0.5+0.5*np.sin(2*np.pi*u*160 + nz*20 + fine*6)   # fine strand grooves
    c = np.array(col)[None,None,:]*(0.66+0.36*h[...,None]+0.14*(g[...,None]-0.5))*(0.85+0.3*fine[...,None])
    return c, 0.46 + 0.12*(1-h) + 0.10*(1-g), normal_from(0.5*h + 0.35*g, 1.25)
