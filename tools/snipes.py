#!/usr/bin/env python3
"""Two original sounds for the room, synthesised from scratch like the pre-roll swell.

    python3 tools/snipes.py            # writes both mp3s (needs ffmpeg)
    python3 tools/snipes.py lobby      # just one

  web/assets/intermission.mp3   a corny little snack-bar march for Intermission. Our own tune -
                                the 1957 "Let's All Go to the Lobby" jingle is somebody's
                                composition; this is a march in the same spirit.
  web/assets/preroll-spooky.mp3 the creature feature sting: a low pedal, a theremin wail and two
                                organ stabs, for when the Halloween accent is up.
"""

import array
import math
import subprocess
import sys
import wave
from pathlib import Path

RATE = 44100
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web' / 'assets'

def note(name):
    """'C4' -> Hz."""
    steps = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    n, rest = name[0], name[1:]
    semi = steps[n]
    if rest[0] in '#b':
        semi += 1 if rest[0] == '#' else -1
        rest = rest[1:]
    return 440.0 * 2 ** ((semi - 9 + (int(rest) - 4) * 12) / 12)

class Track:
    def __init__(self, seconds):
        self.n = int(RATE * seconds)
        self.buf = array.array('d', bytes(8 * self.n))

    def add(self, t0, dur, freq, gain=0.3, wave_kind='square', attack=0.01, release=0.08, vibrato=0.0):
        start = int(t0 * RATE)
        length = int(dur * RATE)
        for i in range(length):
            if start + i >= self.n:
                break
            t = i / RATE
            env = min(1.0, t / attack) * min(1.0, max(0.0, (dur - t) / release))
            f = freq * (1 + vibrato * math.sin(t * math.tau * 5.5))
            ph = (t * f) % 1.0
            if wave_kind == 'square':
                s = 1.0 if ph < 0.5 else -1.0
                s *= 0.6
            elif wave_kind == 'saw':
                s = 2 * ph - 1
            elif wave_kind == 'tri':
                s = 4 * abs(ph - 0.5) - 1
            else:
                s = math.sin(ph * math.tau)
            self.buf[start + i] += s * gain * env

    def noise(self, t0, dur, gain=0.2):
        start = int(t0 * RATE)
        seed = 12345
        for i in range(int(dur * RATE)):
            if start + i >= self.n:
                break
            seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
            env = max(0.0, 1 - i / (dur * RATE)) ** 2
            self.buf[start + i] += ((seed / 0x3FFFFFFF) - 1) * gain * env

    def write(self, path):
        peak = max(abs(x) for x in self.buf) or 1.0
        scale = 0.9 / peak
        frames = array.array('h', bytes(4 * self.n))
        for i in range(self.n):
            v = int(max(-1.0, min(1.0, math.tanh(self.buf[i] * scale * 1.1))) * 32000)
            frames[2 * i] = frames[2 * i + 1] = v
        wav = path.with_suffix('.wav')
        with wave.open(str(wav), 'wb') as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(RATE)
            w.writeframes(frames.tobytes())
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav),
                        '-codec:a', 'libmp3lame', '-b:a', '160k', str(path)], check=True)
        wav.unlink()
        print(f'wrote {path} ({path.stat().st_size / 1e3:.0f} KB)')


def lobby():
    """A snack-bar march: oompah bass, a bright tune on top, a snare on the backbeat."""
    bpm = 126
    beat = 60 / bpm
    bars = 9
    t = Track(bars * 4 * beat + 1.0)

    # tune: two eight-bar phrases that end where they started, like every jingle ever
    melody = [
        ('C5', 1), ('E5', 1), ('G5', 1), ('E5', 1),
        ('C5', 1), ('E5', 2), ('D5', 1),
        ('D5', 1), ('F5', 1), ('A5', 1), ('F5', 1),
        ('D5', 2), ('G4', 2),
        ('C5', 1), ('E5', 1), ('G5', 1), ('C6', 1),
        ('B5', 1), ('A5', 1), ('G5', 2),
        ('F5', 1), ('E5', 1), ('D5', 1), ('B4', 1),
        ('C5', 4),
    ]
    chords = ['C', 'C', 'F', 'G', 'C', 'G', 'G', 'C']
    bass = {'C': ('C3', 'G3'), 'F': ('F3', 'C4'), 'G': ('G3', 'D4')}

    at = 0.5
    for name, beats in melody:
        t.add(at, beats * beat * 0.92, note(name), gain=0.30, wave_kind='square', vibrato=0.004)
        t.add(at, beats * beat * 0.92, note(name) * 2, gain=0.07, wave_kind='tri')   # a little shine
        at += beats * beat

    for bar in range(8):
        low, high = bass[chords[bar]]
        for b in range(4):
            when = 0.5 + (bar * 4 + b) * beat
            t.add(when, beat * 0.45, note(low if b % 2 == 0 else high), gain=0.26, wave_kind='tri')
            if b % 2 == 1:
                t.noise(when, 0.09, gain=0.12)                                        # backbeat
    # a last chord to land on
    end = 0.5 + 8 * 4 * beat
    for n in ('C4', 'E4', 'G4', 'C5'):
        t.add(end, 1.2, note(n), gain=0.18, wave_kind='tri', release=0.9)
    t.noise(end, 0.3, gain=0.18)
    t.write(OUT / 'intermission.mp3')


def creature():
    """The creature feature sting: a pedal note, a wail that climbs and falls, two organ stabs."""
    t = Track(9.0)
    # low pedal, with its minor second grinding against it
    t.add(0.0, 8.6, note('D2'), gain=0.34, wave_kind='saw', attack=1.2, release=2.5)
    t.add(1.6, 7.0, note('Eb2'), gain=0.16, wave_kind='saw', attack=2.0, release=2.5)
    # theremin: a slow climb and fall, heavy vibrato
    steps = 220
    for i in range(steps):
        x = i / steps
        when = 1.4 + x * 5.6
        f = note('A4') * 2 ** (((math.sin(x * math.pi) * 9) - 1) / 12)
        t.add(when, 5.6 / steps * 1.6, f, gain=0.16, wave_kind='sine', attack=0.004, release=0.02, vibrato=0.02)
    # organ stabs
    for when in (5.0, 6.0):
        for n in ('D3', 'F3', 'Ab3', 'B3'):
            t.add(when, 0.85, note(n), gain=0.15, wave_kind='square', attack=0.005, release=0.5)
    for n in ('D2', 'D3', 'Ab3'):
        t.add(7.0, 2.0, note(n), gain=0.17, wave_kind='saw', attack=0.02, release=1.6)
    t.write(OUT / 'preroll-spooky.mp3')


if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'both'
    OUT.mkdir(parents=True, exist_ok=True)
    if which in ('both', 'lobby'): lobby()
    if which in ('both', 'creature'): creature()
