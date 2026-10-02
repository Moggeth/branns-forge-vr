"""Objective property tests for the shipped material-audio WAVs. Plain asserts; run: python test_material_audio_assets.py
These are proxies (levels, envelope, spectrum, determinism, size), not a substitute for listening."""
import sys
import time
import wave
from pathlib import Path

import numpy as np

import generate_material_audio as gen

HERE = Path(__file__).resolve().parent
A = HERE.parent.parent / "public/assets/material-audio"
DUR = {"pick_stone": (0.3, 0.6), "metal_ricochet": (0.7, 1.1), "bone_crack": (0.25, 0.5),
       "stone_fracture": (1.0, 1.5), "ore_break": (0.8, 1.3)}


def load(name):
    with wave.open(str(A / f"{name}.wav"), "rb") as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, 32000), name
        return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float64) / 32767


def env_db(x, at, width=0.02):
    i, w = int(at * gen.SR), int(width * gen.SR)
    seg = x[i:i + w]
    return 20 * np.log10(np.sqrt(np.mean(seg * seg)) + 1e-12)


def band_energy(x, lo, hi, t0=0.0, t1=None):
    seg = x[int(t0 * gen.SR):None if t1 is None else int(t1 * gen.SR)]
    X = np.abs(np.fft.rfft(seg)) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / gen.SR)
    return X[(f >= lo) & (f < hi)].sum()


def main():
    t0 = time.perf_counter()
    fresh = gen.all_sounds()
    names = sorted(fresh)
    assert len(names) == 13, names
    x = {n: load(n) for n in names}
    m = {n: gen.metrics(x[n]) for n in names}
    fam = lambda n: n.rsplit("_", 1)[0]
    checks = 0

    # Shared hygiene budgets.
    for n in names:
        mm = m[n]
        assert mm["peak_dbfs"] <= -1.0 and mm["clipped_samples"] == 0, (n, mm)
        assert mm["edge"] < 0.002 and abs(mm["dc"]) < 0.002, (n, mm)
        lo, hi = DUR[fam(n)]
        assert lo <= mm["duration_s"] <= hi, (n, mm["duration_s"])
        assert mm["peak_band_frac"] < 0.45, ("tonal/beep-like", n, mm["peak_band_frac"])   # sine ~= 1.0
        assert mm["frac_above_6k"] < 0.06, ("squeal/hiss", n, mm["frac_above_6k"])
        assert mm["attack_ms"] < 20, ("soft attack", n, mm["attack_ms"])
        assert mm["max_rms50_dbfs"] < -9.0, ("loud", n, mm["max_rms50_dbfs"])             # chink and weight, not noise
        # Determinism: on-disk PCM equals a fresh in-memory synthesis.
        assert np.array_equal(gen.to_pcm16(fresh[n]), np.frombuffer(gen.wav_bytes(gen.to_pcm16(fresh[n]))[44:], "<i2"))
        assert np.array_equal(gen.to_pcm16(fresh[n]).astype(np.float64) / 32767, x[n]), ("not deterministic", n)
        checks += 9

    # Variants: same family character, but not copies.
    for f in DUR:
        vs = [n for n in names if fam(n) == f]
        assert 2 <= len(vs) <= 3, vs
        cs = [m[n]["centroid_hz"] for n in vs]
        assert max(cs) / min(cs) < 1.3, (f, cs)
        for i in range(len(vs)):
            for j in range(i + 1, len(vs)):
                a, b = x[vs[i]], x[vs[j]]
                k = min(len(a), len(b))
                r = abs(np.corrcoef(a[:k], b[:k])[0, 1])
                assert r < 0.8, ("variants too similar", vs[i], vs[j], r)
                checks += 1

    avg = lambda f, key: np.mean([m[n][key] for n in names if fam(n) == f])
    for n in names:
        f = fam(n)
        if f == "pick_stone":    # sharp bite, then a gritty (not tonal) decay
            assert m[n]["t_minus20db_ms"] < 60, (n, m[n])
            assert env_db(x[n], 0.3) < env_db(x[n], 0.0, 0.01) - 30, n
            grit = band_energy(x[n], 1400, 6500, 0.02, 0.2) / (band_energy(x[n], 0, 16000, 0.02, 0.2) + 1e-20)
            assert grit > 0.35, ("decay is not gritty", n, grit)
        if f == "bone_crack":    # brittle: short, little low end
            assert m[n]["t_minus40db_ms"] < 220 and m[n]["frac_below_200"] < 0.05, (n, m[n])
        if f == "metal_ricochet":  # rings: tail level well above stone/bone at 300 ms
            assert env_db(x[n], 0.3) > env_db(x["pick_stone_a"], 0.3) + 20, n
            assert m[n]["frac_below_200"] < 0.01, n
        if f == "stone_fracture":  # heavy: lowest centroid, longest debris tail
            assert m[n]["t_minus40db_ms"] > 500, (n, m[n])
        if f == "ore_break":     # reward: shards keep arriving after the crack (2-6 kHz energy after 150 ms)
            late = band_energy(x[n], 1800, 6000, 0.15, 0.8) / (band_energy(x[n], 1800, 6000) + 1e-20)
            assert late > 0.4, ("no shard cascade", n, late)
        checks += 1
    assert avg("stone_fracture", "centroid_hz") < 600 < avg("pick_stone", "centroid_hz")
    assert avg("bone_crack", "frac_below_200") < avg("pick_stone", "frac_below_200")
    assert avg("stone_fracture", "max_rms50_dbfs") > avg("pick_stone", "max_rms50_dbfs") + 5
    assert avg("ore_break", "centroid_hz") > avg("pick_stone", "centroid_hz")
    checks += 4

    wav_total = sum((A / f"{n}.wav").stat().st_size for n in names)
    ogg = [A / f"{n}.ogg" for n in names if (A / f"{n}.ogg").exists()]
    ogg_total = sum(p.stat().st_size for p in ogg)
    assert wav_total <= 1_000_000, wav_total
    assert wav_total + ogg_total <= 1_000_000, ("WAV+OGG over 1 MB", wav_total, ogg_total)
    checks += 2
    print(f"ok {checks} checks, {len(names)} sounds, wav {wav_total} B, ogg {ogg_total} B ({len(ogg)} files), "
          f"{time.perf_counter() - t0:.3f} s")


if __name__ == "__main__":
    sys.exit(main())
