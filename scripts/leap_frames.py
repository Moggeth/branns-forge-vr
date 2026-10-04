"""Local-only LeapC reader for the opt-in God prototype. No images or recording.

Writes latest compact hand frames as JSON lines. --seconds bounds a diagnostic run.
ABI mirrors the installed Ultraleap 6.2 LeapC.h (#pragma pack(1)).
"""
import argparse
import ctypes as C
import json
import sys
import time
from pathlib import Path


class Packed(C.Structure):
    _pack_ = 1


class Vec(Packed):
    _fields_ = [(n, C.c_float) for n in ('x', 'y', 'z')]


class Quat(Packed):
    _fields_ = [(n, C.c_float) for n in ('x', 'y', 'z', 'w')]


class Bone(Packed):
    _fields_ = [('prev', Vec), ('next', Vec), ('width', C.c_float), ('rotation', Quat)]


class Digit(Packed):
    _fields_ = [('id', C.c_int32), ('bones', Bone * 4), ('extended', C.c_uint32)]


class Palm(Packed):
    _fields_ = [(n, Vec) for n in ('position', 'stabilized', 'velocity', 'normal')] + [
        ('width', C.c_float), ('direction', Vec), ('orientation', Quat)]


class Hand(Packed):
    _fields_ = [('id', C.c_uint32), ('flags', C.c_uint32), ('type', C.c_int32),
                ('confidence', C.c_float), ('visible', C.c_uint64),
                ('pinch_distance', C.c_float), ('grab_angle', C.c_float),
                ('pinch', C.c_float), ('grab', C.c_float), ('palm', Palm),
                ('digits', Digit * 5), ('arm', Bone)]


class Header(Packed):
    _fields_ = [('reserved', C.c_void_p), ('id', C.c_int64), ('timestamp', C.c_int64)]


class Tracking(Packed):
    _fields_ = [('info', Header), ('id', C.c_int64), ('count', C.c_uint32),
                ('hands', C.POINTER(Hand)), ('fps', C.c_float)]


class Message(Packed):
    _fields_ = [('size', C.c_uint32), ('type', C.c_int32),
                ('event', C.c_void_p), ('device', C.c_uint32)]


def vector(v):
    return [round(v.x, 2), round(v.y, 2), round(v.z, 2)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seconds', type=float, default=0)
    args = parser.parse_args()
    dll_path = Path('C:/Program Files/Ultraleap/LeapSDK/lib/x64/LeapC.dll')
    dll = C.CDLL(str(dll_path))
    for name, types in {
        'LeapCreateConnection': [C.c_void_p, C.POINTER(C.c_void_p)],
        'LeapOpenConnection': [C.c_void_p],
        'LeapSetPolicyFlags': [C.c_void_p, C.c_uint64, C.c_uint64],
        'LeapPollConnection': [C.c_void_p, C.c_uint32, C.POINTER(Message)],
        'LeapCloseConnection': [C.c_void_p], 'LeapDestroyConnection': [C.c_void_p],
    }.items():
        getattr(dll, name).argtypes = types
        getattr(dll, name).restype = C.c_uint32
    handle = C.c_void_p()
    def check(result):
        if result:
            raise RuntimeError(f'LeapC failed: 0x{result:08x}; check Ultraleap Tracking Service')
    check(dll.LeapCreateConnection(None, C.byref(handle)))
    started = time.monotonic()
    last_sent = 0
    frames = 0
    max_hands = 0
    try:
        check(dll.LeapOpenConnection(handle))
        while not args.seconds or time.monotonic() - started < args.seconds:
            msg = Message()
            msg.size = C.sizeof(Message)
            result = dll.LeapPollConnection(handle, 100, C.byref(msg))
            if result == 0xe2010004:  # eLeapRS_Timeout
                continue
            check(result)
            if msg.type == 1:  # connected; reader is intentionally a background child
                check(dll.LeapSetPolicyFlags(handle, 1, 0))
                print(json.dumps({'status': 'connected'}), flush=True)
            elif msg.type == 2:
                print(json.dumps({'status': 'disconnected', 'hands': []}), flush=True)
            elif msg.type == 0x100 and msg.event:
                frame = C.cast(msg.event, C.POINTER(Tracking)).contents
                if frame.count > 16:
                    raise RuntimeError('Unexpected LeapC hand count; check SDK ABI')
                frames += 1
                max_hands = max(max_hands, frame.count)
                now = time.monotonic()
                if now - last_sent < 1 / 60:
                    continue
                last_sent = now
                hands = [{'id': h.id, 'side': 'left' if h.type == 0 else 'right',
                          'pinch': round(h.pinch, 3), 'palm': vector(h.palm.position)}
                         for h in frame.hands[:frame.count]]
                print(json.dumps({'status': 'tracking', 'id': frame.id,
                                  'fps': round(frame.fps, 1), 'hands': hands}), flush=True)
    finally:
        dll.LeapCloseConnection(handle)
        dll.LeapDestroyConnection(handle)
        print(json.dumps({'elapsedSeconds': round(time.monotonic()-started, 3),
                          'frames': frames, 'maxHands': max_hands}), file=sys.stderr)


if __name__ == '__main__':
    try:
        main()
    except (BrokenPipeError, KeyboardInterrupt):
        pass
    except Exception as error:
        print(f'Leap reader: {error}', file=sys.stderr)
        sys.exit(1)
