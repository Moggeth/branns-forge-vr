"""Deterministic offline synthesis of the wood interaction audio kit.

No samples, downloads or APIs: every sound is built from seeded noise, modal
(damped-sinusoid) resonator banks and stick-slip pulse trains. Rerunning with the
same code produces byte-identical WAVs.

    python generate_wood_audio.py            # writes assets/, metrics.json, contact sheet
    python generate_wood_audio.py --no-ogg   # skip the optional ffmpeg/vorbis copies

Layering vocabulary (see HANDOFF.md):
  transient  sub-2 ms edge click, high-passed
  body       modal bank (inharmonic wood modes, short decays: no long high-Q ring)
  crunch     band-limited noise with 1 ms granular amplitude jitter (torn fibre)
  creak      stick-slip impulse train with wandering rate through low wood modes
  rustle     dense leaf micro-grains + swept air band + twig snaps
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
import wave
from pathlib import Path

import numpy as np

SR = 32000                      # mono 16-bit; 16 kHz Nyquist is ample for wood and keeps the kit small
ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent.parent / "public" / "assets" / "wood-audio"  # shipped WAVs (OGG copies are not shipped)


# ---------------------------------------------------------------- primitives
def n_of(seconds: float) -> int:
    return int(round(seconds * SR))


def tvec(n: int) -> np.ndarray:
    return np.arange(n) / SR


def place(dst: np.ndarray, src: np.ndarray, at: float, gain: float = 1.0) -> None:
    i = n_of(at)
    if i >= len(dst):
        return
    m = min(len(src), len(dst) - i)
    dst[i:i + m] += src[:m] * gain


def fft_band(x: np.ndarray, hp: float | None = None, lp: float | None = None, order: int = 2) -> np.ndarray:
    """Zero-phase Butterworth-magnitude filter. Only used on noise BEFORE enveloping (no pre-echo on transients)."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if hp:
        g *= 1 / np.sqrt(1 + (hp / np.maximum(f, 1e-3)) ** (2 * order))
    if lp:
        g *= 1 / np.sqrt(1 + (f / lp) ** (2 * order))
    return np.fft.irfft(spec * g, len(x))


def noise(rng: np.random.Generator, seconds: float, hp=None, lp=None, order=2) -> np.ndarray:
    x = rng.standard_normal(n_of(seconds))
    x = fft_band(x, hp, lp, order)
    return x / (np.max(np.abs(x)) + 1e-9)


def env(n: int, attack: float, decay: float, hold: float = 0.0) -> np.ndarray:
    t = tvec(n)
    a = np.clip(t / max(attack, 1e-5), 0, 1) ** 1.5
    d = np.exp(-np.maximum(t - attack - hold, 0) / decay)
    return a * d


def grain_jitter(rng, n: int, grain_s: float = 0.001, depth: float = 0.6) -> np.ndarray:
    """Piecewise-smooth random amplitude: makes noise read as torn fibre/bark rather than hiss."""
    k = max(2, int(n / (grain_s * SR)) + 2)
    pts = 1 - depth * rng.random(k)
    return np.interp(np.linspace(0, k - 1, n), np.arange(k), pts)


def modal_ir(modes, seconds: float, rng) -> np.ndarray:
    """modes: (freq Hz, decay s, amplitude). Causal damped sinusoids with random phase."""
    t = tvec(n_of(seconds))
    ir = np.zeros_like(t)
    for f, dec, amp in modes:
        if f >= SR * 0.45:
            continue
        ir += amp * np.exp(-t / dec) * np.sin(2 * np.pi * f * t + rng.random() * 0.6)
    return ir


def convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    n = len(x) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:n]
    return y


def strike(width_s: float = 0.0006) -> np.ndarray:
    """Raised-cosine force pulse: wider = softer mallet/heavier contact."""
    m = max(2, n_of(width_s))
    return 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(m) / (m - 1))


def struck(modes, seconds, rng, width_s=0.0006) -> np.ndarray:
    return convolve(strike(width_s), modal_ir(modes, seconds, rng))


def thump(seconds: float, f0: float, f1: float, decay: float, attack: float = 0.002) -> np.ndarray:
    n = n_of(seconds)
    t = tvec(n)
    freq = f1 + (f0 - f1) * np.exp(-t / (decay * 0.6))
    phase = 2 * np.pi * np.cumsum(freq) / SR
    return np.sin(phase) * env(n, attack, decay)


def creak(rng, seconds: float, rate_pts, modes, pulse_jitter=0.25, amp_pts=None) -> np.ndarray:
    """Stick-slip friction: a pulse train whose rate wanders, ringing low wood modes.

    rate_pts / amp_pts: lists of (time_s, value) breakpoints. Low rates (8-30 Hz) read as a
    groaning trunk; nothing above ~60 Hz so it never turns into a squeal."""
    n = n_of(seconds)
    t = tvec(n)
    rp = np.array(rate_pts, float)
    rate = np.interp(t, rp[:, 0], rp[:, 1])
    rate *= 1 + 0.18 * np.interp(t, np.linspace(0, seconds, 23), rng.standard_normal(23))
    amp = np.ones(n) if amp_pts is None else np.interp(t, *np.array(amp_pts, float).T)
    phase = np.cumsum(rate) / SR
    exc = np.zeros(n)
    idx = np.nonzero(np.diff(np.floor(phase)) > 0)[0]
    for i in idx:
        j = i + int(rng.integers(-1, 2) * pulse_jitter * SR / max(rate[i], 1) * 0.1)
        if 0 <= j < n - 8:
            exc[j:j + 8] += amp[i] * (0.6 + 0.4 * rng.random()) * np.array([1, .8, -.5, -.9, -.4, .1, .2, .05])
    body = convolve(exc, modal_ir(modes, 0.12, rng))[:n]
    # Breath of the fibres under load: faint band noise following the same amplitude curve.
    grit = noise(rng, seconds, 400, 2200) * amp * 0.05
    return body + grit


def snaps(rng, seconds, times, bright=1.0, size=1.0) -> np.ndarray:
    """Fibre/twig snaps at given times: click + small bright modal ring + crackle."""
    out = np.zeros(n_of(seconds))
    for tt in times:
        s = 0.5 + rng.random()
        modes = [(f * bright * (0.85 + 0.3 * rng.random()), d, a) for f, d, a in
                 [(900, .010, 1), (1600, .007, .7), (2600, .004, .5), (420 / size, .020, .5)]]
        hit = struck(modes, 0.06, rng, 0.00025)
        crack = noise(rng, 0.03, 1500, 7000) * env(n_of(0.03), 0.0002, 0.004)
        hit = hit / (np.max(np.abs(hit)) + 1e-9)
        hit[:len(crack)] += 0.6 * crack
        place(out, hit * s, tt)
    return out


def leaf_grains(rng, seconds, density_pts, hp=2200, lp=9000) -> np.ndarray:
    """Many 2-6 ms band-limited grains whose density follows (time, grains/s) breakpoints."""
    n = n_of(seconds)
    t = tvec(n)
    dens = np.interp(t, *np.array(density_pts, float).T)
    hits = rng.random(n) < dens / SR
    exc = np.zeros(n)
    exc[hits] = rng.standard_normal(hits.sum())
    g = np.exp(-np.arange(n_of(0.006)) / (0.0018 * SR)) * rng.standard_normal(n_of(0.006))
    y = np.convolve(exc, g)[:n]
    return fft_band(y, hp, lp)


def air_whoosh(rng, seconds, centre_pts, amp_pts) -> np.ndarray:
    """Swept band of noise via crossfaded fixed bands (cheap, click-free time-varying filter)."""
    n = n_of(seconds)
    t = tvec(n)
    centres = [180, 300, 500, 800, 1300, 2100]
    base = rng.standard_normal(n)
    c = np.interp(t, *np.array(centre_pts, float).T)
    out = np.zeros(n)
    for fc in centres:
        band = fft_band(base, fc / 1.5, fc * 1.5, 2)
        w = np.exp(-0.5 * (np.log(c / fc) / 0.45) ** 2)
        out += band * w
    out /= np.max(np.abs(out)) + 1e-9
    return out * np.interp(t, *np.array(amp_pts, float).T)


def finish(x: np.ndarray, peak_db: float) -> np.ndarray:
    """DC removal, gentle tanh glue, click-free edges, trailing-silence trim, exact peak target."""
    x = x - np.mean(x)
    x = fft_band(x, hp=28, order=2)                       # strip sub-audible rumble that only eats headroom
    x = x / (np.max(np.abs(x)) + 1e-12)
    x = np.tanh(1.4 * x) / np.tanh(1.4)
    above = np.nonzero(np.abs(x) > 10 ** (-58 / 20))[0]
    x = x[:above[-1] + 1 + n_of(0.01)] if len(above) else x
    fi, fo = n_of(0.0008), min(n_of(0.012), len(x) // 4)
    x[:fi] *= np.linspace(0, 1, fi)
    x[-fo:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo))
    return x / np.max(np.abs(x)) * 10 ** (peak_db / 20)


# ---------------------------------------------------------------- sound designs
def axe_bite(seed: int, depth: float = 1.0) -> np.ndarray:
    """Clean bite into the cut: steel edge tick, chunky 'chock' body, torn fibre crunch, trunk thud."""
    rng = np.random.default_rng(seed)
    dur = 0.55
    out = np.zeros(n_of(dur))
    edge = noise(rng, 0.004, 2500, 11000) * env(n_of(0.004), 0.0001, 0.0007)
    sc = 1 / depth                                         # deeper cut -> lower, heavier body
    body = struck([(410 * sc, .040, 1.0), (735 * sc, .028, .8), (1170 * sc, .018, .55), (1880, .010, .35),
                   (2750, .006, .2), (150 * sc, .060, .45), (235 * sc, .050, .4)], 0.3, rng, 0.0005)
    body /= np.max(np.abs(body))
    crunch_n = n_of(0.09)
    crunch = noise(rng, 0.09, 700, 3800) * env(crunch_n, 0.0015, 0.022) * grain_jitter(rng, crunch_n, 0.0012, 0.75)
    low = thump(0.25, 105 * sc, 68 * sc, 0.06)
    steel = (np.sin(2 * np.pi * 3150 * tvec(n_of(.08))) + .6 * np.sin(2 * np.pi * 4420 * tvec(n_of(.08)))) * env(n_of(.08), .0005, .018)
    place(out, edge, 0, 0.55)
    place(out, body, 0.0004, 1.0)
    place(out, crunch, 0.001, 0.55)
    place(out, low, 0.0, 0.28 * depth)                     # weight under the chock, not a boom
    place(out, steel, 0.0006, 0.035)                       # felt more than heard: steel in wood, never a ring
    # small bark chips settling after the bite
    place(out, snaps(rng, 0.3, sorted(0.05 + 0.2 * rng.random(3)), bright=1.4, size=0.6), 0, 0.06)
    return out


def axe_bite_deep(seed: int) -> np.ndarray:
    """Second cut: heavier bite, then the trunk answers with a slow low creak as the hinge loads."""
    rng = np.random.default_rng(seed + 100)
    bite = axe_bite(seed, depth=1.25)
    out = np.zeros(n_of(1.35))
    place(out, bite, 0)
    groan = creak(rng, 1.05, [(0, 9), (.25, 16), (.6, 24), (.9, 13), (1.05, 8)],
                  [(185, .05, 1), (290, .045, .8), (445, .03, .6), (690, .02, .35), (1040, .012, .15)],
                  amp_pts=[(0, 0), (.12, .8), (.45, 1), (.8, .55), (1.05, 0)])
    groan /= np.max(np.abs(groan)) + 1e-9
    place(out, groan, 0.16, 0.30)
    place(out, snaps(rng, 1.2, [0.42, 0.71], bright=0.9), 0.1, 0.10)
    return out


def bark_glance(seed: int) -> np.ndarray:
    """Off-angle/limb strike: blade skids across bark. Thin, bright, scraping, little body: reads 'no bite'."""
    rng = np.random.default_rng(seed)
    out = np.zeros(n_of(0.42))
    tick = struck([(1350, .012, 1), (2150, .008, .7), (640, .02, .35)], 0.08, rng, 0.0003)
    tick /= np.max(np.abs(tick))
    scr_n = n_of(0.16)
    scrape = noise(rng, 0.16, 1400, 6000) * env(scr_n, 0.004, 0.045) * grain_jitter(rng, scr_n, 0.0035, 0.9)
    # skid has a slight falling resonance as the edge slows on the bark
    sweep = np.sin(2 * np.pi * np.cumsum(np.linspace(1900, 1250, scr_n)) / SR) * env(scr_n, .003, .04) * grain_jitter(rng, scr_n, .004, .8)
    steel = (np.sin(2 * np.pi * 2620 * tvec(n_of(.2))) + .5 * np.sin(2 * np.pi * 3910 * tvec(n_of(.2)))) * env(n_of(.2), .001, .05)
    place(out, tick, 0, 0.55)
    place(out, scrape, 0.002, 0.65)
    place(out, sweep, 0.004, 0.10)
    place(out, steel, 0.001, 0.05)                         # loose blade hums a touch more than in a clean bite
    place(out, snaps(rng, 0.4, sorted(0.06 + 0.22 * rng.random(4)), bright=1.6, size=0.5), 0, 0.10)
    return fft_band(out, lp=8500, order=2)


def trunk_fracture(seed: int) -> np.ndarray:
    """Final cut lets go: fibre crackle accelerates, a big wet crack, then a long hinge groan."""
    rng = np.random.default_rng(seed)
    dur = 2.1
    out = np.zeros(n_of(dur))
    t_crack = 0.22
    pre = sorted(t_crack * (1 - np.sqrt(rng.random(9))))  # density rises toward the main crack
    place(out, snaps(rng, 0.4, pre, bright=0.8, size=1.2), 0, 0.22)
    crack_n = n_of(0.35)
    crack = noise(rng, 0.35, 250, 6000) * env(crack_n, 0.0004, 0.03) * grain_jitter(rng, crack_n, 0.0008, 0.85)
    crack_body = struck([(120, .09, 1), (205, .07, .8), (330, .05, .6), (560, .03, .4), (910, .018, .3)], 0.5, rng, 0.0015)
    crack_body /= np.max(np.abs(crack_body))
    place(out, crack, t_crack, 0.75)
    place(out, crack_body, t_crack, 0.9)
    place(out, thump(0.5, 80, 46, 0.12), t_crack, 0.6)
    place(out, snaps(rng, 0.8, sorted(0.03 + 0.5 * rng.random(7) ** 1.5), bright=0.7, size=1.4), t_crack, 0.28)
    groan = creak(rng, 1.6, [(0, 7), (.3, 13), (.7, 19), (1.1, 11), (1.6, 6)],
                  [(140, .07, 1), (220, .06, .85), (350, .04, .6), (530, .03, .4), (800, .018, .2)],
                  amp_pts=[(0, 0), (.08, 1), (.5, .9), (1.1, .45), (1.6, 0)])
    groan /= np.max(np.abs(groan)) + 1e-9
    place(out, groan, t_crack + 0.12, 0.45)
    return out


def foliage_rustle(seed: int) -> np.ndarray:
    """Canopy falling: rustle and air swell accelerating toward impact (aligned to buffer end by the adapter)."""
    rng = np.random.default_rng(seed)
    dur = 2.6
    leaves = leaf_grains(rng, dur, [(0, 30), (1.0, 220), (1.9, 900), (2.4, 2600), (2.6, 1200)])
    leaves /= np.max(np.abs(leaves)) + 1e-9
    leaf_amp = np.interp(tvec(len(leaves)), [0, 1.0, 2.0, 2.45, 2.6], [.05, .2, .55, 1, .6])
    air = air_whoosh(rng, dur, [(0, 250), (1.6, 500), (2.4, 1100), (2.6, 800)], [(0, 0), (.9, .12), (1.9, .45), (2.45, 1), (2.6, .5)])
    out = leaves * leaf_amp * 0.75 + air * 0.55
    place(out, snaps(rng, dur, sorted(1.3 + 1.2 * rng.random(6) ** .6), bright=1.5, size=0.5), 0, 0.12)
    return out


def log_land_heavy(seed: int) -> np.ndarray:
    """Trunk hits the ground: sub thump, hollow log body, branch crashes, leaf settle tail."""
    rng = np.random.default_rng(seed)
    dur = 1.7
    out = np.zeros(n_of(dur))
    place(out, thump(0.6, 62, 38, 0.18, 0.004), 0, 1.0)
    body = struck([(88, .22, 1), (141, .18, .85), (214, .14, .7), (330, .09, .5), (515, .05, .35), (780, .03, .2)], 0.9, rng, 0.004)
    body /= np.max(np.abs(body))
    place(out, body, 0.002, 0.85)
    crunch_n = n_of(0.3)
    place(out, noise(rng, 0.3, 120, 1600) * env(crunch_n, 0.003, 0.07) * grain_jitter(rng, crunch_n, .003, .6), 0, 0.6)
    place(out, snaps(rng, 1.0, sorted(0.01 + 0.35 * rng.random(9) ** 1.4), bright=0.75, size=1.3), 0, 0.30)
    tail = leaf_grains(rng, 1.4, [(0, 2400), (.3, 900), (1.0, 120), (1.4, 10)])
    tail /= np.max(np.abs(tail)) + 1e-9
    place(out, tail * np.interp(tvec(len(tail)), [0, .05, 1.4], [0, 1, 0]), 0.02, 0.22)
    # bounce: the trunk lifts and lands once more, softer
    place(out, body * 0.35, 0.26)
    place(out, thump(0.3, 58, 42, 0.09), 0.26, 0.3)
    return out


def log_settle(seed: int) -> np.ndarray:
    """After the (pre-scheduled) impact: logs part company - two soft knocks and leaves settling."""
    rng = np.random.default_rng(seed)
    out = np.zeros(n_of(1.0))
    for at, g in [(0.0, 1.0), (0.17, .6), (0.31, .4)]:
        j = 0.9 + 0.2 * rng.random()                       # each log is a different size: no repeated 'boop'
        k = struck([(170 * j, .045, .8), (300 * j, .04, .8), (520 * j, .03, .6), (860 * j, .018, .35)], 0.3, rng, 0.0012)
        place(out, k / np.max(np.abs(k)), at, g)
        m = n_of(0.07)
        place(out, noise(rng, 0.07, 150, 1800) * env(m, .001, .016) * grain_jitter(rng, m, .002, .7), at, g * 0.45)
    tail = leaf_grains(rng, 0.9, [(0, 500), (.4, 150), (.9, 5)])
    tail /= np.max(np.abs(tail)) + 1e-9
    place(out, tail * np.interp(tvec(len(tail)), [0, .05, .9], [0, 1, 0]), 0.0, 0.25)
    return out


def log_bounce(seed: int) -> np.ndarray:
    """Log knocks the ground: hollow 'tonk' with a dull thud - mid weight."""
    rng = np.random.default_rng(seed)
    out = np.zeros(n_of(0.45))
    k = struck([(176, .06, .8), (392, .055, .85), (645, .04, .65), (1010, .025, .4), (1530, .012, .2)], 0.4, rng, 0.0013)
    place(out, k / np.max(np.abs(k)), 0, 1)
    place(out, thump(0.2, 90, 60, 0.04), 0, 0.3)
    m = n_of(0.08)
    place(out, noise(rng, 0.08, 200, 2400) * env(m, .001, .018) * grain_jitter(rng, m, .002, .7), 0, 0.45)
    return out


def log_grab(seed: int) -> np.ndarray:
    """Hand closes on bark and lifts: short grippy scuff, small light knock."""
    rng = np.random.default_rng(seed)
    out = np.zeros(n_of(0.32))
    m = n_of(0.09)
    place(out, noise(rng, 0.09, 800, 3200, 3) * env(m, 0.006, 0.03) * grain_jitter(rng, m, .003, .85), 0, 1.0)
    k = struck([(310, .025, .7), (560, .02, .8), (720, .02, .6), (1240, .012, .45), (1900, .007, .25)], 0.2, rng, 0.0009)
    place(out, k / np.max(np.abs(k)), 0.012, 0.3)
    return out


def log_stow(seed: int) -> np.ndarray:
    """Log added to the bundle: rewarding wood-on-wood 'tok-tok' over a soft thunk."""
    rng = np.random.default_rng(seed)
    out = np.zeros(n_of(0.5))
    for at, g, sc in [(0.0, 1.0, 1.0), (0.075, 0.55, 1.06)]:
        k = struck([(520 * sc, .055, 1), (890 * sc, .04, .7), (1460 * sc, .022, .45), (240 * sc, .07, .5)], 0.3, rng, 0.0009)
        place(out, k / np.max(np.abs(k)), at, g)
    place(out, thump(0.2, 120, 85, 0.05), 0.0, 0.35)
    m = n_of(0.12)
    place(out, noise(rng, 0.12, 700, 3500) * env(m, 0.01, 0.03) * grain_jitter(rng, m, .004, .8), 0.02, 0.18)
    return out


def log_toss(seed: int) -> np.ndarray:
    """Throw release: short tumbling air swish (the landing is a separate log_bounce event)."""
    rng = np.random.default_rng(seed)
    dur = 0.38
    w = air_whoosh(rng, dur, [(0, 900), (.38, 320)], [(0, 0), (.08, 1), (.38, 0)])
    w *= 0.75 + 0.25 * np.sin(2 * np.pi * 11 * tvec(len(w)))  # end-over-end tumble
    return w


# id -> (builder, seed, peak dBFS). Peaks encode the intended mix; the adapter adds only small variation.
KIT = {
    "axe_bite_a":     (lambda s: axe_bite(s), 11, -3.0),
    "axe_bite_b":     (lambda s: axe_bite(s), 12, -3.0),
    "axe_bite_deep":  (axe_bite_deep, 21, -2.5),
    "bark_glance_a":  (bark_glance, 31, -8.0),
    "bark_glance_b":  (bark_glance, 32, -8.0),
    "trunk_fracture": (trunk_fracture, 41, -2.0),
    "foliage_rustle": (foliage_rustle, 51, -7.0),
    "log_land_heavy": (log_land_heavy, 61, -1.5),
    "log_settle":     (log_settle, 62, -11.0),
    "log_bounce_a":   (log_bounce, 71, -8.0),
    "log_bounce_b":   (log_bounce, 72, -8.0),
    "log_grab":       (log_grab, 81, -13.0),
    "log_stow":       (log_stow, 91, -9.0),
    "log_toss":       (log_toss, 95, -15.0),
}


# ---------------------------------------------------------------- io + metrics
def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def db(v: float) -> float:
    return round(20 * np.log10(max(v, 1e-9)), 2)


def metrics(x: np.ndarray) -> dict:
    spec = np.abs(np.fft.rfft(x)) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    win = n_of(0.05)
    short_rms = max(np.sqrt(np.mean(x[i:i + win] ** 2)) for i in range(0, max(1, len(x) - win), win // 2))
    return {
        "duration_s": round(len(x) / SR, 3),
        "peak_dbfs": db(np.max(np.abs(x))),
        "rms_dbfs": db(np.sqrt(np.mean(x ** 2))),
        "max_50ms_rms_dbfs": db(short_rms),
        "clipped_samples": int(np.sum(np.abs(x) >= 0.999)),
        "dc_offset": round(float(np.mean(x)), 6),
        "edge_abs": [round(float(abs(x[0])), 5), round(float(abs(x[-1])), 5)],
        "centroid_hz": round(float(np.sum(f * spec) / np.sum(spec)), 1),
        "energy_above_6k_pct": round(float(100 * np.sum(spec[f > 6000]) / np.sum(spec)), 3),
    }


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float) / 32767


def contact_sheet(sounds: dict[str, np.ndarray]) -> np.ndarray:
    """Labelled-by-order listening sequence: catalogue first, then a full fell scenario as the adapter schedules it."""
    order = ["bark_glance_a", "bark_glance_b", "axe_bite_a", "axe_bite_b", "axe_bite_deep", "trunk_fracture",
             "foliage_rustle", "log_land_heavy", "log_settle", "log_grab", "log_toss", "log_bounce_a", "log_bounce_b", "log_stow"]
    parts, gap = [], np.zeros(n_of(0.55))
    for k in order:
        parts += [sounds[k], gap]
    # Scenario: glance, bite, deep bite, final bite + fracture, rustle ending at impact (2.5 s), settle 0.6 s later,
    # then grab, toss, bounce, grab, stow.
    sc = np.zeros(n_of(10.5))
    place(sc, sounds["bark_glance_a"], 0.0)
    place(sc, sounds["axe_bite_a"], 0.9)
    place(sc, sounds["axe_bite_deep"], 1.8)
    t_fell = 3.5
    land = 2.5
    place(sc, sounds["axe_bite_b"], t_fell, 0.9)
    place(sc, sounds["trunk_fracture"], t_fell)
    r = sounds["foliage_rustle"]
    place(sc, r, t_fell + land - len(r) / SR)
    place(sc, sounds["log_land_heavy"], t_fell + land)
    place(sc, sounds["log_settle"], t_fell + land + 0.6)
    place(sc, sounds["log_grab"], 7.6)
    place(sc, sounds["log_toss"], 8.1)
    place(sc, sounds["log_bounce_a"], 8.55)
    place(sc, sounds["log_bounce_b"], 8.8, 0.4)
    place(sc, sounds["log_grab"], 9.3)
    place(sc, sounds["log_stow"], 9.75)
    parts.append(sc * 0.85)
    seq = np.concatenate(parts)
    return seq / max(1.0, np.max(np.abs(seq)) / 0.89)  # never above -1 dBFS even where layers overlap


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-ogg", action="store_true")
    args = ap.parse_args()
    t0 = time.perf_counter()
    OUT.mkdir(exist_ok=True)
    sounds, report, timings = {}, {}, {}
    for name, (fn, seed, peak) in KIT.items():
        s = time.perf_counter()
        x = finish(fn(seed), peak)
        timings[name] = round(time.perf_counter() - s, 4)
        write_wav(OUT / f"{name}.wav", x)
        sounds[name] = read_wav(OUT / f"{name}.wav")       # metrics on the quantised file actually shipped
        report[name] = metrics(sounds[name]) | {"wav_bytes": (OUT / f"{name}.wav").stat().st_size, "seed": seed}
    t_synth = time.perf_counter() - t0

    sheet = contact_sheet(sounds)
    write_wav(ROOT / "wood_audio_contact_sheet.wav", sheet)

    ogg_ok = False
    t_ogg = time.perf_counter()
    if not args.no_ogg and shutil.which("ffmpeg"):
        ogg_ok = True
        for name in KIT:
            r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(OUT / f"{name}.wav"), "-c:a", "libvorbis",
                                "-q:a", "4", str(OUT / f"{name}.ogg")], capture_output=True)
            if r.returncode:
                ogg_ok = False
                print("ogg failed:", r.stderr.decode(errors="replace")[:300])
                break
            report[name]["ogg_bytes"] = (OUT / f"{name}.ogg").stat().st_size
    t_ogg = time.perf_counter() - t_ogg

    total_wav = sum(v["wav_bytes"] for v in report.values())
    total_ogg = sum(v.get("ogg_bytes", 0) for v in report.values())
    summary = {
        "sample_rate": SR, "format": "mono PCM16 WAV (+ optional Vorbis q4)", "sounds": report,
        "totals": {"wav_bytes": total_wav, "ogg_bytes": total_ogg if ogg_ok else None,
                   "contact_sheet_bytes": (ROOT / "wood_audio_contact_sheet.wav").stat().st_size,
                   "contact_sheet_s": round(len(sheet) / SR, 2), "contact_sheet_peak_dbfs": db(np.max(np.abs(sheet)))},
        "timings_perf_counter_s": {"synthesis_and_write": round(t_synth, 3), "ogg_encode": round(t_ogg, 3),
                                   "total": round(time.perf_counter() - t0, 3), "per_sound": timings},
    }
    (ROOT / "metrics.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(f"{'sound':16} {'dur':>6} {'peak':>7} {'rms':>7} {'50ms':>7} {'>6k%':>6} {'wav':>7} {'ogg':>6}")
    for k, v in report.items():
        print(f"{k:16} {v['duration_s']:6.2f} {v['peak_dbfs']:7.2f} {v['rms_dbfs']:7.2f} {v['max_50ms_rms_dbfs']:7.2f} "
              f"{v['energy_above_6k_pct']:6.2f} {v['wav_bytes']:7d} {v.get('ogg_bytes', 0):6d}")
    print("totals", summary["totals"])
    print("timings", {k: v for k, v in summary["timings_perf_counter_s"].items() if k != "per_sound"})


if __name__ == "__main__":
    main()
