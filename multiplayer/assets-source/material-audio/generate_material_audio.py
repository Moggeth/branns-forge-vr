"""Deterministic procedural material-impact sound kit (stone / metal / bone / hammer fracture / ore reward).

numpy only: no samples, downloads, APIs or copyrighted sources. Every sound is a layered model
(strike transient + inharmonic modal body + band-limited granular debris), never a plain oscillator
or undifferentiated white noise. Re-running produces byte-identical WAVs.

    python generate_material_audio.py            # assets/*.wav (+ .ogg if ffmpeg/libvorbis), contact sheet, metrics.json
    python generate_material_audio.py --no-ogg
"""
from __future__ import annotations

import io
import json
import shutil
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np

SR = 32000
HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"


# ---------------------------------------------------------------- building blocks
def tvec(dur: float) -> np.ndarray:
    return np.arange(int(round(dur * SR))) / SR


def place(dst: np.ndarray, src: np.ndarray, at: float, gain: float = 1.0) -> None:
    i = int(round(at * SR))
    if i >= len(dst):
        return
    n = min(len(src), len(dst) - i)
    dst[i:i + n] += gain * src[:n]


def band(x: np.ndarray, lo: float, hi: float, soft: float = 0.25) -> np.ndarray:
    """Zero-phase FFT band-pass with raised-cosine skirts (soft = fraction of the edge frequency)."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    m = np.ones_like(f)
    if lo > 0:
        a, b = lo * (1 - soft), lo
        m[f < a] = 0
        k = (f >= a) & (f < b)
        m[k] = 0.5 - 0.5 * np.cos(np.pi * (f[k] - a) / (b - a))
    if hi < SR / 2:
        a, b = hi, hi * (1 + soft)
        m[f > b] = 0
        k = (f > a) & (f <= b)
        m[k] = 0.5 + 0.5 * np.cos(np.pi * (f[k] - a) / (b - a))
    return np.fft.irfft(X * m, n)


def band_noise(rng, dur: float, lo: float, hi: float) -> np.ndarray:
    x = band(rng.standard_normal(int(round(dur * SR))), lo, hi)
    return x / (np.max(np.abs(x)) + 1e-12)


def granular(rng, dur: float, grain_ms: float, depth: float = 1.0) -> np.ndarray:
    """Random per-grain amplitudes (linearly interpolated) -> grit rather than smooth hiss."""
    n = int(round(dur * SR))
    g = max(2, int(grain_ms * SR / 1000))
    pts = rng.random(n // g + 2) ** 2
    env = np.interp(np.arange(n), np.arange(len(pts)) * g, pts)
    return (1 - depth) + depth * env


def modes(dur: float, freqs, taus, amps, rng=None, glide: float = 0.0) -> np.ndarray:
    """Sum of exponentially decaying partials. glide: fractional pitch drop over the first 80 ms."""
    t = tvec(dur)
    out = np.zeros_like(t)
    for i, (f, tau, a) in enumerate(zip(freqs, taus, amps)):
        ph = 0.0 if rng is None else rng.uniform(0, 0.4)
        if glide:
            inst = f * (1 - glide * (1 - np.exp(-t / 0.08)))
            phase = 2 * np.pi * np.cumsum(inst) / SR
        else:
            phase = 2 * np.pi * f * t
        out += a * np.exp(-t / tau) * np.sin(phase + ph)
    return out


def tick(rng, lo: float, hi: float, ms: float = 1.2) -> np.ndarray:
    """A short band-limited impulse: steel tip contact, a pebble, a bone splinter."""
    n = max(8, int(ms * SR / 1000) * 6)
    x = rng.standard_normal(n) * np.exp(-np.arange(n) / (ms * SR / 1000 / 3))
    x = band(x, lo, hi)
    return x / (np.max(np.abs(x)) + 1e-12)


def exp_env(dur: float, tau: float, attack: float = 0.0004) -> np.ndarray:
    t = tvec(dur)
    a = np.clip(t / attack, 0, 1) if attack > 0 else 1
    return a * np.exp(-t / tau)


def debris(rng, dur: float, start: float, end: float, count: int, lo: float, hi: float,
           decay: float, level: float, ms=(0.6, 2.2)) -> np.ndarray:
    """Sparse falling fragments: onset density thins out (exponentially distributed after start)."""
    out = np.zeros(int(round(dur * SR)))
    for _ in range(count):
        at = start + min(end - start, rng.exponential(decay))
        fl, fh = lo * rng.uniform(0.85, 1.3), hi * rng.uniform(0.75, 1.0)
        a = level * rng.uniform(0.25, 1.0) * np.exp(-(at - start) / (decay * 2.5))
        place(out, tick(rng, fl, fh, rng.uniform(*ms)), at, a)
    return out


def finish(x: np.ndarray, peak_db: float) -> np.ndarray:
    x = x - np.mean(x)
    n_in, n_out = 6, int(0.012 * SR)
    x[:n_in] *= np.linspace(0, 1, n_in)
    x[-n_out:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n_out))
    x[0] = 0.0
    x[-1] = 0.0
    return x / (np.max(np.abs(x)) + 1e-12) * 10 ** (peak_db / 20)


# ---------------------------------------------------------------- sound designs
def pick_stone(v: int) -> np.ndarray:
    """Hardened pick tip biting stone: sub-ms steel tick, dense damped stone body, a restrained steel
    'chink', gritty crumble decay and a few rolling crumbs."""
    rng = np.random.default_rng(1100 + v)
    dur = 0.46
    out = np.zeros(int(dur * SR))
    s = [1.0, 0.94, 1.07][v]
    place(out, tick(rng, 2500, 11000, 0.25), 0, 0.9)                                  # steel tip contact
    body = modes(dur, [930 * s, 1460 * s, 2240 * s, 3180 * s, 4150 * s],
                 [0.010, 0.007, 0.0055, 0.004, 0.003], [1.0, 0.8, 0.65, 0.5, 0.35], rng)
    place(out, body, 0.0004, 0.75)                                                     # stone modal 'tock'
    chink = modes(dur, [2870 * s, 4630 * s * 1.003, 6020 * s], [0.045, 0.03, 0.018], [1.0, 0.55, 0.25], rng)
    place(out, chink, 0.0002, 0.14)                                                    # pick's own ring (mature chink)
    grit = band_noise(rng, dur, 1400, 6500) * granular(rng, dur, 1.1) * exp_env(dur, 0.055, 0.0015)
    place(out, grit, 0.001, 0.65)                                                      # crushing grit decay
    crunch = band_noise(rng, dur, 450, 1600) * granular(rng, dur, 2.5) * exp_env(dur, 0.02)
    place(out, crunch, 0.0, 0.45)                                                      # bite weight
    place(out, modes(dur, [128 * s, 196 * s], [0.014, 0.01], [1, 0.5]), 0, 0.14)      # arm/handle thud
    place(out, debris(rng, dur, 0.035, 0.33, 7 + v, 1800, 7000, 0.07, 0.22), 0, 1.0)  # crumbs
    return finish(out, -3.0)


def metal_ricochet(v: int) -> np.ndarray:
    """Steel on plate/armour: bright strike, inharmonic plate modes with beating pairs, a falling
    ricochet partial and a short scrape. Rings far longer than stone, but quieter than the strike."""
    rng = np.random.default_rng(2200 + v)
    dur = 0.95
    out = np.zeros(int(dur * SR))
    f0 = [1180, 1310, 1090][v]
    ratios = [1.0, 1.0042, 1.593, 2.136, 2.141, 2.653, 3.247, 3.92]
    taus = [0.32, 0.30, 0.22, 0.16, 0.155, 0.11, 0.075, 0.05]
    amps = [0.6, 0.55, 0.95, 0.75, 0.6, 0.55, 0.45, 0.3]
    place(out, tick(rng, 2000, 12000, 0.2), 0, 1.0)
    place(out, modes(dur, [f0 * r for r in ratios], taus, amps, rng), 0.0003, 0.55)
    place(out, modes(dur, [f0 * 2.42], [0.12], [1.0], rng, glide=0.22 + 0.05 * v), 0.004, 0.28)  # ricochet zing
    scrape = band_noise(rng, dur, 2200, 7000) * granular(rng, dur, 0.7) * exp_env(dur, 0.03, 0.002)
    place(out, scrape, 0.002, 0.3)
    place(out, band_noise(rng, dur, 300, 1100) * exp_env(dur, 0.012), 0, 0.35)         # dull body knock
    return finish(out, -4.5)


def bone_crack(v: int) -> np.ndarray:
    """Dry, brittle, hollow: 2-4 micro-fractures clustered in 15 ms, short high resonances, a small hollow
    knock and a few splinters. No metallic tail, very little low end."""
    rng = np.random.default_rng(3300 + v)
    dur = 0.38
    out = np.zeros(int(dur * SR))
    s = [1.0, 1.08, 0.93][v]
    cracks = np.sort(np.concatenate([[0.0], rng.uniform(0.002, 0.016, 2 + v % 2)]))
    for i, at in enumerate(cracks):
        place(out, tick(rng, 1100, 7500, rng.uniform(0.3, 0.8)), at, 1.0 - 0.18 * i)
        place(out, modes(0.05, [1450 * s * rng.uniform(.95, 1.05), 2380 * s, 3620 * s],
                         [0.006, 0.0045, 0.003], [1, 0.7, 0.4], rng), at, 0.5 - 0.08 * i)
    place(out, modes(dur, [430 * s, 690 * s, 1010 * s], [0.016, 0.011, 0.008], [1, 0.7, 0.45], rng), 0, 0.42)
    snap = band_noise(rng, dur, 900, 4200) * granular(rng, dur, 0.9) * exp_env(dur, 0.012)
    place(out, snap, 0, 0.5)
    place(out, debris(rng, dur, 0.03, 0.22, 4, 1600, 6000, 0.04, 0.2, ms=(0.4, 1.0)), 0, 1.0)
    return finish(out, -4.0)


def stone_fracture(v: int) -> np.ndarray:
    """Heavy hammer through stone: deep thump, low stone body, broadband crack, a slab breaking off at
    ~0.17 s and a long thinning rubble patter."""
    rng = np.random.default_rng(4400 + v)
    dur = 1.3
    out = np.zeros(int(dur * SR))
    s = [1.0, 0.9][v]
    t = tvec(dur)
    thump = np.sin(2 * np.pi * np.cumsum(70 * s - 24 * (1 - np.exp(-t / 0.05))) / SR) * exp_env(dur, 0.06, 0.002)
    place(out, thump, 0, 0.5)
    place(out, modes(dur, [176 * s, 291 * s, 437 * s, 640 * s, 905 * s], [0.09, 0.06, 0.045, 0.03, 0.02],
                     [1, 0.8, 0.65, 0.5, 0.35], rng), 0.0005, 0.6)
    place(out, tick(rng, 1500, 9000, 0.35), 0, 0.6)                                 # hammer face contact
    crack = band_noise(rng, dur, 350, 5500) * granular(rng, dur, 1.6) * exp_env(dur, 0.045, 0.001)
    place(out, crack, 0.003, 0.95)
    split = band_noise(rng, 0.25, 250, 3200) * granular(rng, 0.25, 2.0) * exp_env(0.25, 0.04)
    place(out, split, 0.15 + 0.03 * v, 0.45)                                         # slab breaks off
    place(out, modes(0.4, [140 * s, 233 * s, 371 * s], [0.06, 0.04, 0.025], [1, .7, .5], rng), 0.16 + 0.03 * v, 0.35)
    rub = band_noise(rng, dur, 700, 4800) * granular(rng, dur, 3.5) * exp_env(dur, 0.32, 0.05)
    place(out, rub, 0.05, 0.14)
    place(out, debris(rng, dur, 0.08, 1.15, 26, 900, 5200, 0.28, 0.32, ms=(0.8, 3.0)), 0, 1.0)
    return finish(out, -1.5)


def ore_break(v: int) -> np.ndarray:
    """Reward: a lighter stone crack, then crystalline shards falling free - each a short inharmonic glassy
    partial set at its own time - and a pebble patter. Bright but under 6 kHz, no sustained tone."""
    rng = np.random.default_rng(5500 + v)
    dur = 1.1
    out = np.zeros(int(dur * SR))
    place(out, 0.7 * stone_fracture(v)[:out.size] / 10 ** (-1.5 / 20), 0, 0.5)
    shard_times = np.sort(rng.uniform(0.06, 0.6, 7 + v))
    for i, at in enumerate(shard_times):
        f = rng.uniform(1900, 3600)
        rr = [1.0, 2.76 + rng.uniform(-.05, .05), 5.40 * rng.uniform(.97, 1.03)]
        rr = [r for r in rr if f * r < 5800]
        shard = modes(0.3, [f * r for r in rr], [0.07, 0.035, 0.02][:len(rr)], [1, 0.45, 0.2][:len(rr)], rng)
        place(shard, tick(rng, 3000, 8000, 0.2)[:shard.size], 0, 0.3)
        place(out, shard, at, rng.uniform(0.15, 0.22))
    place(out, debris(rng, dur, 0.1, 0.95, 16, 1400, 5600, 0.22, 0.25, ms=(0.5, 1.6)), 0, 1.0)
    return finish(out, -3.5)


DESIGNS = {
    "pick_stone": (pick_stone, 3),
    "metal_ricochet": (metal_ricochet, 3),
    "bone_crack": (bone_crack, 3),
    "stone_fracture": (stone_fracture, 2),
    "ore_break": (ore_break, 2),
}


def all_sounds() -> dict[str, np.ndarray]:
    out = {}
    for name, (fn, n) in DESIGNS.items():
        for v in range(n):
            out[f"{name}_{'abc'[v]}"] = fn(v)
    return out


def to_pcm16(x: np.ndarray) -> np.ndarray:
    return np.clip(np.round(x * 32767), -32767, 32767).astype("<i2")


def wav_bytes(pcm: np.ndarray) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return b.getvalue()


# ---------------------------------------------------------------- metrics (shared with tests)
def metrics(x: np.ndarray) -> dict:
    n = len(x)
    X = np.abs(np.fft.rfft(x)) ** 2
    f = np.fft.rfftfreq(n, 1 / SR)
    tot = X.sum() + 1e-20
    pk = int(np.argmax(X))
    near = X[(f > f[pk] - 25) & (f < f[pk] + 25)].sum() / tot
    w = int(0.05 * SR)
    rms50 = np.sqrt(np.convolve(x * x, np.ones(w) / w, "valid"))
    env = np.sqrt(np.convolve(x * x, np.ones(64) / 64, "same"))
    epk = env.max() + 1e-20
    above = np.nonzero(env > epk * 10 ** (-40 / 20))[0]
    return {
        "duration_s": round(n / SR, 4),
        "peak_dbfs": round(20 * np.log10(np.max(np.abs(x)) + 1e-12), 2),
        "rms_dbfs": round(20 * np.log10(np.sqrt(np.mean(x * x)) + 1e-12), 2),
        "max_rms50_dbfs": round(20 * np.log10(rms50.max() + 1e-12), 2),
        "clipped_samples": int(np.sum(np.abs(x) >= 0.999)),
        "dc": round(float(np.mean(x)), 6),
        "edge": round(float(max(abs(x[0]), abs(x[-1]))), 6),
        "attack_ms": round(1000 * int(np.argmax(env)) / SR, 2),
        "t_minus20db_ms": round(1000 * (int(np.argmax(env)) + int(np.argmax(env[np.argmax(env):] < epk * 0.1))) / SR, 1),
        "t_minus40db_ms": round(1000 * int(above[-1]) / SR, 1),
        "centroid_hz": round(float((f * X).sum() / tot), 1),
        "frac_above_6k": round(float(X[f > 6000].sum() / tot), 4),
        "frac_below_200": round(float(X[f < 200].sum() / tot), 4),
        "peak_band_frac": round(float(near), 4),
        "spectral_peak_hz": round(float(f[pk]), 1),
    }


def main(argv: list[str]) -> int:
    t0 = time.perf_counter()
    ASSETS.mkdir(exist_ok=True)
    sounds = all_sounds()
    t_synth = time.perf_counter() - t0
    report = {"sample_rate": SR, "sounds": {}, "timing_s": {}}
    for name, x in sounds.items():
        pcm = to_pcm16(x)
        data = wav_bytes(pcm)
        (ASSETS / f"{name}.wav").write_bytes(data)
        m = metrics(pcm.astype(np.float64) / 32767)
        m["wav_bytes"] = len(data)
        report["sounds"][name] = m
    t_wav = time.perf_counter() - t0

    # Review sequence: every sound with 0.5 s gaps, then a mining + combat scenario.
    gap = np.zeros(int(0.5 * SR))
    parts = []
    for name, x in sounds.items():
        parts += [x, gap]
    scen = np.zeros(int(9.0 * SR))
    plan = [("pick_stone_a", 0.0, 1), ("pick_stone_b", 0.62, 0.95), ("pick_stone_c", 1.25, 1.0), ("ore_break_a", 1.9, 1),
            ("pick_stone_b", 3.2, 0.8), ("stone_fracture_a", 3.25, 0.7),           # pick on golem + armour break
            ("bone_crack_a", 4.6, 1), ("bone_crack_c", 4.95, 0.85), ("bone_crack_b", 5.5, 1.1),
            ("metal_ricochet_a", 6.3, 0.9), ("metal_ricochet_b", 6.9, 0.6), ("stone_fracture_b", 7.6, 1)]
    for name, at, g in plan:
        place(scen, sounds[name], at, g * 0.85)
    sheet = np.concatenate(parts + [gap, scen])
    sheet = sheet / max(1.0, np.max(np.abs(sheet)) / 0.89)
    (HERE / "material_audio_contact_sheet.wav").write_bytes(wav_bytes(to_pcm16(sheet)))
    report["contact_sheet"] = {"duration_s": round(len(sheet) / SR, 2), "scenario_plan": plan}

    ogg_total = 0
    ff = shutil.which("ffmpeg")
    if ff and "--no-ogg" not in argv:
        for name in list(sounds) + ["material_audio_contact_sheet"]:
            src = ASSETS / f"{name}.wav" if name in sounds else HERE / f"{name}.wav"
            dst = src.with_suffix(".ogg")
            subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(src), "-c:a", "libvorbis", "-q:a", "4",
                            "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", str(dst)], check=True)
            if name in sounds:
                report["sounds"][name]["ogg_bytes"] = dst.stat().st_size
                ogg_total += dst.stat().st_size
    report["totals"] = {"wav_bytes": sum(m["wav_bytes"] for m in report["sounds"].values()), "ogg_bytes": ogg_total,
                        "count": len(sounds)}
    report["timing_s"] = {"synthesis": round(t_synth, 3), "synthesis_plus_wav": round(t_wav, 3),
                          "total_including_ogg": round(time.perf_counter() - t0, 3)}
    (HERE / "metrics.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps({"totals": report["totals"], "timing_s": report["timing_s"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
