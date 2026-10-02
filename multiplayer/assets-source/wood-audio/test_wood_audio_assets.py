"""python test_wood_audio_assets.py — objective properties of the shipped audio (not a listening test)."""
import json
import time
import wave
from pathlib import Path

import numpy as np

import generate_wood_audio as gen

ROOT = Path(__file__).resolve().parent
t0 = time.perf_counter()
m = json.loads((ROOT / "metrics.json").read_text(encoding="utf-8"))
budgets = {  # max duration s; bounds keep one-shots short and the rustle/fracture within the fall window
    "axe_bite": .7, "axe_bite_deep": 1.5, "bark_glance": .5, "trunk_fracture": 2.3, "foliage_rustle": 2.8,
    "log_land_heavy": 1.9, "log_settle": 1.2, "log_bounce": .5, "log_grab": .4, "log_stow": .6, "log_toss": .45}
rows = []
for name in gen.KIT:
    path = gen.OUT / f"{name}.wav"
    with wave.open(str(path), "rb") as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, gen.SR), name
        x = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float) / 32767
    peak = 20 * np.log10(np.max(np.abs(x)))
    assert peak <= -1.0, f"{name} peak {peak:.2f} dBFS"              # headroom: layering + panner gain never clips at master .7
    assert np.sum(np.abs(x) >= .999) == 0, name
    assert abs(x[0]) < 2e-3 and abs(x[-1]) < 2e-3, f"{name} edge click"
    assert abs(np.mean(x)) < 2e-3, f"{name} DC"
    base = next(b for b in budgets if name.startswith(b) and (name == b or name[len(b):] in ("_a", "_b")))
    assert len(x) / gen.SR <= budgets[base], f"{name} too long"
    # Anti-beep: a pure tone puts ~all energy within +-25 Hz of its peak. Wood layers must stay broadband.
    spec = np.abs(np.fft.rfft(x)) ** 2
    f = np.fft.rfftfreq(len(x), 1 / gen.SR)
    pk = f[np.argmax(spec)]
    tonal = float(np.sum(spec[np.abs(f - pk) < 25]) / np.sum(spec))
    assert tonal < .5, f"{name} tonal {tonal:.2f}"
    # Anti-squeal: strong energy above 6 kHz only where leaves are the subject.
    hi = float(np.sum(spec[f > 6000]) / np.sum(spec))
    assert hi < (.3 if name == "foliage_rustle" else .08), f"{name} bright {hi:.3f}"
    rows.append((name, round(peak, 2), round(tonal, 3), round(hi * 100, 2)))
    assert m["sounds"][name]["wav_bytes"] == path.stat().st_size, "metrics.json stale: rerun the generator"

# Character checks that would fail for generic noise: bite has a sharp attack and decays fast;
# the deep cut carries a creak tail; glance is brighter and lighter than a bite; the landing is the bassiest.
def load(n):
    with wave.open(str(gen.OUT / f"{n}.wav"), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float) / 32767
def centroid(x):
    s = np.abs(np.fft.rfft(x)) ** 2; f = np.fft.rfftfreq(len(x), 1 / gen.SR); return float(np.sum(f * s) / np.sum(s))
def rms(x): return float(np.sqrt(np.mean(x ** 2)) + 1e-12)
bite, deep, glance, land = load("axe_bite_a"), load("axe_bite_deep"), load("bark_glance_a"), load("log_land_heavy")
assert np.argmax(np.abs(bite)) < gen.n_of(.012), "bite peak within 12 ms"
assert rms(bite[gen.n_of(.3):]) < rms(bite[:gen.n_of(.05)]) * .1, "bite decays >20 dB by 300 ms"
assert rms(deep[gen.n_of(.45):gen.n_of(.95)]) > rms(bite[gen.n_of(.3):]) * 3, "deep cut has a creak tail"
assert centroid(glance) > centroid(bite) * 1.3, "glance brighter than bite"
assert rms(glance) < rms(bite), "glance lighter than bite"
assert centroid(land) < centroid(bite) and centroid(land) < 900, "landing is the low anchor"

# Determinism: synthesis is seeded and pure.
a = gen.finish(gen.axe_bite(11), -3.0); b = gen.finish(gen.axe_bite(11), -3.0)
assert np.array_equal(a, b)
total = sum(v["wav_bytes"] for v in m["sounds"].values())
assert total < 1_000_000, total
for r in rows:
    print(f"{r[0]:16} peak {r[1]:7.2f} dBFS  tonal {r[2]:.3f}  >6k {r[3]:5.2f}%")
print(json.dumps({"ok": True, "wav_total_bytes": total, "ogg_total_bytes": m["totals"]["ogg_bytes"],
                  "elapsed_s": round(time.perf_counter() - t0, 3)}))
