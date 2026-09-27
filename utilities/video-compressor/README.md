# Pocket Video

Double-click **Pocket Video** on the desktop, or **Video Compressor.cmd** in the
project. Drop one or more finished recordings into the window, choose a target,
then **Compress queue**. You can also click the drop area to browse, or drop files
onto the desktop shortcut. Everything runs locally; nothing is uploaded.

- **9 MB / 24 MB / 49 MB**, plus custom 1–500 MB budgets (decimal MB).
- 720p default or 1080p maximum; preserves aspect ratio without upscaling, 30 fps.
- **Keep audio** by default. Uncheck for silent output.
- Two-pass H.264 / AAC MP4 with fast-start metadata for broad player compatibility.
- Originals never change. Copies go into `Shared/` beside each source.
- Repeated runs get numbered filenames; existing copies aren't overwritten.
- Compatible MP4s already below the limit are reused without a lossy re-encode.
- Changing settings requeues completed rows, so you can make a smaller version.
- Cancel stops the current encoder and clears its temporary files. Completed copies
  stay available. Closing the app while busy cancels the remaining queue.
- A size check and duration check must pass before a finished copy is published.
  Oversized output gets one bitrate correction; otherwise it reports an error.
- Very long clips with tiny budgets are rejected instead of claiming good quality.
  Target sizes aren't promises about any social platform's current attachment limit.

## Setup and run

Python 3.13 + Tk, `tkinterdnd2==0.4.3`, FFmpeg and ffprobe are installed on this PC.
`python -m pip install -r utilities/video-compressor/requirements.txt`
FFmpeg and ffprobe must be on PATH. The desktop shortcut and .cmd use this machine's
Python313/pythonw.exe; update that path after a Python move. No game/OBS dependency.

CLI for repeatable non-GUI use:
```
python utilities/video-compressor/app.py --headless --target-mb 24 "path/to/video.mp4"
```
Optional `--height 1080` and `--mute`. Without --headless it opens the GUI.
The encoder is restricted to two CPU threads to leave room for other applications.
No AI requests or per-frame Python image processing are used.

## Diagnose / test

Logs: `logs/compressor/YYYYMMDD-HHMMSS-PID.log`, including FFmpeg stderr and exceptions.
Successful encodes append `logs/compressor/history.jsonl`. Work timings also go into
`logs/work-timing.csv`. Open the latest log after an error. Finished recordings only:
a file that grows or changes during compression is rejected with the original safe.
An interrupted run can leave a hidden `.compress-*` temp folder under Shared; remove
only that folder after confirming no compressor/FFmpeg job is still using it.

`python utilities/video-compressor/test_compressor.py` makes a one-second local
fixture and checks audio preservation/removal, paths with spaces and ampersands,
non-overwrite, source integrity, no upscaling, skip-small, invalid inputs and live
cancellation cleanup. It does not modify any existing recordings.

## Validated lessons

Inspired by the sibling video_compresser's two-pass budgeting idea, without changing
or importing that project. The old script ignored FFmpeg nonzero exits and didn't
budget audio. This implementation checks return codes, uses ffprobe JSON, reserves
container/audio space, validates output size, and uses isolated pass logs per job.

First short MKV/audio fixture exposed `Incomplete MB-tree stats file`: the null
muxer and MP4 muxer default sync policies produced different frame counts between
passes. Explicit `fps=30` plus `-vsync 0` makes both passes use identical frames.
Bitrate is capped against original size as well as the budget; don't inflate a tiny
input toward a large target (x264 otherwise warned the curve couldn't converge).
Retest passed in 1.395 seconds. Native UI was expanded to keep the footer visible.

First real test: 75,695,289 bytes -> 22,550,678 bytes, 55.967 seconds, H.264/yuv420p,
1108x720, complete decoded frame inspected. Encoding took 21.569 seconds on this PC.
