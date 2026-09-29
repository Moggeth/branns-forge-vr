"""Render the original, quiet adaptive score. Requires only Python's standard library.

Run from the repository root: python scripts/render_adaptive_music.py
The generated WAV files are source assets; Godot imports them normally.
"""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path


RATE = 22_050
SECONDS = 16
FRAMES = RATE * SECONDS
OUT = Path(__file__).resolve().parents[1] / "godot" / "audio" / "music"

# Modal, slowly moving harmony. Frequencies are MIDI note numbers; the low
# levels leave dialogue, UI, wind and contact sounds in front of the score.
CUES = {
    "exploration": {"root": 50, "chords": ((0, 7, 10), (0, 5, 12)), "notes": (0, 7, 10, 12, 17), "pulse": 0.0, "seed": 13},
    "combat": {"root": 43, "chords": ((0, 7, 13), (0, 6, 10)), "notes": (0, 6, 7, 10, 13), "pulse": 0.8, "seed": 19},
    "settlement": {"root": 48, "chords": ((0, 4, 7), (0, 5, 9)), "notes": (0, 4, 7, 9, 12), "pulse": 0.12, "seed": 23},
    "mysterious": {"root": 45, "chords": ((0, 1, 7), (0, 6, 13)), "notes": (0, 1, 6, 7, 13), "pulse": 0.0, "seed": 29},
    "rts": {"root": 46, "chords": ((0, 5, 9), (0, 7, 10)), "notes": (0, 5, 7, 9, 10), "pulse": 0.38, "seed": 31},
}


def hz(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def add_tone(samples: list[float], note: int, start: float, duration: float, level: float, bell: bool = False) -> None:
    frequency = hz(note)
    length = int(duration * RATE)
    for offset in range(length):
        t = offset / RATE
        if bell:
            envelope = (1.0 - math.exp(-t * 24)) * math.exp(-t * 1.25)
            value = math.sin(2 * math.pi * frequency * t) + 0.28 * math.sin(2 * math.pi * frequency * 2.01 * t)
        else:
            envelope = min(1.0, t / 1.2, (duration - t) / 1.5)
            value = math.sin(2 * math.pi * frequency * t) + 0.18 * math.sin(2 * math.pi * frequency * 2 * t)
        index = (int(start * RATE) + offset) % FRAMES
        samples[index] += level * max(0.0, envelope) * value


def render(name: str, spec: dict) -> Path:
    rng = random.Random(spec["seed"])
    samples = [0.0] * FRAMES
    root = spec["root"]
    for half, chord in enumerate(spec["chords"]):
        for note in chord:
            add_tone(samples, root + note - 12, half * 8, 9.8, 0.024 if name == "combat" else 0.018)
    # Each phrase resolves across the loop boundary, so there is no hard seam.
    spacing = 1.0 if name == "combat" else (1.6 if name == "rts" else 2.7)
    time = 0.25
    while time < SECONDS:
        note = root + rng.choice(spec["notes"]) + (12 if name != "combat" else 0)
        add_tone(samples, note, time, 1.8 if name == "combat" else 3.0, 0.023 if name == "combat" else 0.017, True)
        time += spacing + rng.uniform(-0.22, 0.3)
    if spec["pulse"]:
        # Soft low thuds, with a short noisy front edge instead of a hard beat.
        time = 0.0
        while time < SECONDS:
            start = int(time * RATE)
            for offset in range(int(0.22 * RATE)):
                t = offset / RATE
                index = (start + offset) % FRAMES
                samples[index] += spec["pulse"] * 0.033 * math.exp(-t * 22) * (
                    math.sin(2 * math.pi * (72 - 40 * t) * t) + rng.uniform(-0.12, 0.12)
                )
            time += 0.5 if name == "combat" else 1.5
    # A shared bed is a hint of air rather than a separate music layer.
    air = 0.0
    for index in range(FRAMES):
        air += (rng.uniform(-1, 1) - air) * 0.002
        samples[index] += air * (0.005 if name != "combat" else 0.002)
    peak = max(abs(sample) for sample in samples)
    scale = 0.25 / peak
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.wav"
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, value * scale)) * 32767)) for value in samples))
    return path


if __name__ == "__main__":
    for cue_name, cue_spec in CUES.items():
        print(render(cue_name, cue_spec))
