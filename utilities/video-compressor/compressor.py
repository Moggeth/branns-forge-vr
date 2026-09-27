"""Local, size-budgeted H.264 compression; shared by GUI and CLI."""
from __future__ import annotations
import json, logging, math, os, pathlib, shutil, subprocess, tempfile, threading, time

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOGS = ROOT / 'logs' / 'compressor'
LOGS.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOGS / (time.strftime('%Y%m%d-%H%M%S') + '-' + str(os.getpid()) + '.log')
logging.basicConfig(filename=LOG_FILE, level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
EXTENSIONS = {'.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.wmv'}

class Cancelled(Exception): pass

class Compressor:
    def __init__(self):
        self.cancelled = threading.Event()
        self.process = None
        self.lock = threading.Lock()
        self.ffmpeg = shutil.which('ffmpeg')
        self.ffprobe = shutil.which('ffprobe')
        if not self.ffmpeg or not self.ffprobe:
            raise RuntimeError('FFmpeg and ffprobe are required. See the compressor README.')

    def cancel(self):
        self.cancelled.set()
        with self.lock:
            if self.process and self.process.poll() is None:
                self.process.terminate()

    def probe(self, source):
        with self.lock:
            if self.cancelled.is_set(): raise Cancelled()
            self.process = subprocess.Popen([self.ffprobe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(source)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=FLAGS)
            process = self.process
        try:
            stdout, stderr = process.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill(); process.communicate()
            raise RuntimeError('Reading the video timed out. Check that it has finished recording.')
        finally:
            with self.lock: self.process = None
        if self.cancelled.is_set(): raise Cancelled()
        if process.returncode:
            logging.error('ffprobe: %s', stderr.decode(errors='replace'))
            raise ValueError('Could not read this video. It may still be recording or be damaged.')
        info = json.loads(stdout)
        streams = info.get('streams', [])
        video = next((s for s in streams if s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic')), None)
        if video is None: raise ValueError('This file has no video track.')
        duration = float(info.get('format', {}).get('duration') or video.get('duration') or 0)
        if not math.isfinite(duration) or duration <= 0: raise ValueError('Video duration is unavailable. Stop recording before compressing.')
        return {'duration': duration, 'video': video, 'audio': any(s.get('codec_type') == 'audio' for s in streams)}

    def encode_pass(self, command, duration, report, base, span, label):
        logging.info('FFmpeg %s', subprocess.list2cmdline(command))
        with LOG_FILE.open('a', encoding='utf8') as log:
            with self.lock:
                if self.cancelled.is_set(): raise Cancelled()
                self.process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=log, text=True, encoding='utf8', errors='replace', creationflags=FLAGS)
                process = self.process
            try:
                for line in process.stdout:
                    if line.startswith('out_time_us='):
                        try:
                            progress = min(1, max(0, int(line.split('=', 1)[1]) / 1_000_000 / duration))
                            report(base + span * progress, label)
                        except ValueError: pass
                code = process.wait()
            finally:
                process.stdout.close()
                with self.lock: self.process = None
        if self.cancelled.is_set(): raise Cancelled()
        if code: raise RuntimeError('Video encoding failed. Open logs for the details; your original is safe.')

    def compress(self, source, target_mb=24, height=720, keep_audio=True, report=lambda p, s: None):
        started = time.monotonic()
        source = pathlib.Path(source).resolve(strict=True)
        if not source.is_file() or source.suffix.lower() not in EXTENSIONS: raise ValueError('Drop an MP4, MKV, MOV, AVI, WebM, M4V or WMV video.')
        if not math.isfinite(target_mb) or not 1 <= target_mb <= 500: raise ValueError('Choose a target between 1 and 500 MB.')
        if height not in (720, 1080): raise ValueError('Choose 720p or 1080p.')
        original_stat = source.stat()
        original_size = original_stat.st_size
        report(0, 'Reading video…')
        info = self.probe(source)
        budget = int(target_mb * 1_000_000)
        # Existing shareable MP4s need no lossy re-encoding when below the limit.
        if original_size <= budget and source.suffix.lower() == '.mp4' and info['video'].get('codec_name') == 'h264' and info['video'].get('pix_fmt') == 'yuv420p' and (keep_audio or not info['audio']):
            report(1, 'Already small enough — use the original')
            return {'source': str(source), 'output': str(source), 'before': original_size, 'after': original_size, 'skipped': True, 'seconds': time.monotonic()-started}
        audio_rate = 96000 if keep_audio and info['audio'] else 0
        bitrate = int(min(budget * .94, original_size * .90) * 8 / info['duration'] - audio_rate)
        if bitrate < 100000: raise ValueError('This video is too long for that size. Choose a larger target or trim it first.')
        cap = min(height, 480 if bitrate < 500000 else height)
        # Preserve portrait/landscape aspect ratio, avoid upscaling and round to even dimensions.
        scale = f"scale=w='min(iw,{int(cap*16/9)//2*2})':h='min(ih,{cap})':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,fps=30"
        output_dir = source.parent / 'Shared'
        output_dir.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.compress-', dir=output_dir) as folder:
            tmp = pathlib.Path(folder)
            video = tmp / 'output.mp4'
            for attempt in range(2):
                common = [self.ffmpeg, '-hide_banner', '-nostdin', '-y', '-i', str(source), '-map', f"0:{info['video']['index']}", '-vf', scale, '-c:v', 'libx264', '-preset', 'fast', '-threads', '2', '-b:v', str(bitrate), '-pix_fmt', 'yuv420p', '-vsync', '0', '-passlogfile', str(tmp/'analysis'), '-map_metadata', '-1', '-map_chapters', '-1', '-progress', 'pipe:1', '-nostats']
                prefix = 'Fine-tuning size · ' if attempt else ''
                self.encode_pass(common + ['-pass', '1', '-an', '-f', 'null', os.devnull], info['duration'], report, 0, .45, prefix+'Pass 1 of 2 · analysing motion')
                audio = ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', str(audio_rate), '-ac', '2'] if audio_rate else ['-an']
                self.encode_pass(common + ['-pass', '2'] + audio + ['-movflags', '+faststart', str(video)], info['duration'], report, .45, .5, prefix+'Pass 2 of 2 · making shareable MP4')
                if video.stat().st_size <= budget: break
                logging.warning('Output overshot size budget; retrying once with lower bitrate')
                bitrate = int(bitrate * budget / video.stat().st_size * .90)
            if video.stat().st_size > budget: raise RuntimeError('Could not meet that size. Choose a larger target; no oversized copy was kept.')
            report(.97, 'Checking the finished video…')
            result = self.probe(video)
            if abs(result['duration']-info['duration']) > max(1.0, info['duration']*.01): raise RuntimeError('The finished video has the wrong duration. No partial copy was kept.')
            if result['video'].get('codec_name') != 'h264': raise RuntimeError('Unexpected output codec.')
            if self.cancelled.is_set(): raise Cancelled()
            current_stat = source.stat()
            if current_stat.st_size != original_size or current_stat.st_mtime_ns != original_stat.st_mtime_ns: raise RuntimeError('The source changed during compression. Stop recording and try again.')
            name = f'{source.stem}-share-{target_mb:g}MB'
            output = output_dir / (name + '.mp4')
            count = 2
            while True:
                if output.exists():
                    output = output_dir / (name + f'-{count}.mp4'); count += 1; continue
                try:
                    # Windows rename refuses to replace an existing destination.
                    os.rename(video, output); break
                except FileExistsError:
                    output = output_dir / (name + f'-{count}.mp4'); count += 1
        result = {'source': str(source), 'output': str(output), 'before': original_size, 'after': output.stat().st_size, 'skipped': False, 'seconds': time.monotonic()-started}
        logging.info('COMPLETE %s', json.dumps(result))
        with (LOGS/'history.jsonl').open('a', encoding='utf8') as file: file.write(json.dumps(result)+'\n')
        with (ROOT/'logs/work-timing.csv').open('a') as file: file.write(f"video-compress,completed,{result['seconds']:.6f}\n")
        report(1, 'Ready to share')
        return result
