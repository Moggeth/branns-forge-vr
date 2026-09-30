"""Deterministic original short material impacts: transient + body, no downloads."""
import math
from pathlib import Path
import random
import struct
import time
import wave

RATE = 32000
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "godot/audio/impacts"
MODES = {
    "stone": (2100, [(1, .36, 28), (1.71, .18, 34), (.23, .14, 26)]),
    "metal": (1220, [(1, .28, 22), (2.76, .13, 30), (.34, .12, 26)]),
    "wood": (310, [(1, .32, 55), (2.34, .17, 70), (.45, .15, 34)]),
    "bone": (590, [(1, .31, 60), (2.22, .11, 85), (.37, .16, 38)]),
    "glass": (2680, [(1, .25, 22), (1.53, .16, 26), (2.14, .10, 42)]),
    "flesh": (125, [(1, .29, 62), (1.5, .12, 90), (.65, .10, 50)]),
}

def build():
    started = time.perf_counter()
    OUT.mkdir(parents=True, exist_ok=True)
    count = 0
    for material, (base, modes) in MODES.items():
        for variant in range(3):
            rng = random.Random(38213 + list(MODES).index(material) * 93 + variant)
            samples = []
            low_noise = 0.0
            for i in range(round(RATE * .34)):
                t = i / RATE
                low_noise = .65 * low_noise + .35 * rng.uniform(-1, 1)
                transient = (rng.uniform(-1, 1) if material in ("stone", "metal", "glass") else low_noise) * .38 * math.exp(-t * (210 if material == "flesh" else 150))
                frequency = base * (1 + (variant - 1) * .027)
                body = sum(math.sin(2 * math.pi * frequency * ratio * t) * weight * math.exp(-t * decay) for ratio, weight, decay in modes)
                grit = low_noise * .06 * math.exp(-t * 22) if material in ("stone", "bone", "wood") else 0
                samples.append((body + transient + grit) * min(1, t / .0007) * min(1, (.34 - t) / .018))
            peak = max(abs(s) for s in samples) or 1
            pcm = b"".join(struct.pack("<h", round(s / peak * 18000)) for s in samples)
            with wave.open(str(OUT / f"{material}-{variant}.wav"), "wb") as file:
                file.setparams((1, 2, RATE, len(samples), "NONE", "not compressed"))
                file.writeframes(pcm)
            count += 1
    elapsed = time.perf_counter() - started
    with (ROOT / "logs/work-timing.csv").open("a", encoding="utf-8") as log:
        log.write(f"material-impact-audio,passed,{elapsed:.3f}\n")
    print(f"IMPACT_AUDIO_RESULT count={count} seconds={elapsed:.3f}")

if __name__ == "__main__":
    build()
