#!/usr/bin/env python3
"""Generate the pre-roll swell: web/assets/preroll.mp3.

Our own take on the cinema "deep note" idea, not anybody's recording - THX's sound logo is
trademarked and its recording copyrighted, so this synthesises the technique from scratch: a
crowd of detuned sawtooth voices wandering around a cluster, then each one glides to its place
in a very wide D major chord while the whole thing swells.

    python3 tools/deep-swell.py            # writes web/assets/preroll.mp3 (needs ffmpeg)
    python3 tools/deep-swell.py --wav      # keep the intermediate WAV as well
"""

import argparse
import array
import math
import random
import subprocess
import sys
import wave
from pathlib import Path

RATE = 44100
SECONDS = 17.0
VOICES = 30
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web' / 'assets' / 'preroll.mp3'

# The chord everything lands on: D across seven octaves, with fifths and thirds in the upper half,
# which is what gives it the huge, bright top end over a sub-bass floor.
TARGETS = [
    36.71, 36.71, 36.71,                      # D1, tripled - the floor you feel
    73.42, 73.42, 73.42,                      # D2
    110.00, 146.83, 146.83,                   # A2, D3
    220.00, 220.00, 293.66, 293.66,           # A3, D4
    369.99, 440.00, 440.00,                   # F#4, A4
    587.33, 587.33, 739.99,                   # D5, F#5
    880.00, 880.00, 1046.50,                  # A5, C6ish shimmer
    1174.66, 1174.66, 1479.98,                # D6, F#6
    1760.00, 2093.00, 2349.32,                # A6, C7, D7
    2793.83, 3520.00,                         # F#7, A7
]

# When each part of the arc happens, in seconds.
WANDER_END = 5.5        # voices drift about in a cluster until here
GLIDE_END = 11.5        # ... then slide into place by here
FADE_START = 14.5       # hold, then let it go


def envelope(t):
    """Quiet and uneasy at the start, enormous by the time the chord arrives."""
    if t < WANDER_END:
        return 0.12 + 0.20 * (t / WANDER_END)
    if t < GLIDE_END:
        x = (t - WANDER_END) / (GLIDE_END - WANDER_END)
        return 0.32 + 0.68 * x * x                      # the crescendo
    if t < FADE_START:
        return 1.0
    x = (t - FADE_START) / (SECONDS - FADE_START)
    return max(0.0, 1.0 - x) ** 1.6


def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def build():
    random.seed(11)
    n = int(RATE * SECONDS)
    left = array.array('d', bytes(8 * n))
    right = array.array('d', bytes(8 * n))

    for v in range(VOICES):
        target = TARGETS[v % len(TARGETS)]
        start = random.uniform(180.0, 420.0)             # everyone begins in the same muddle
        wobble_rate = random.uniform(0.05, 0.22)
        wobble_depth = random.uniform(8.0, 34.0)
        glide_from = WANDER_END + random.uniform(0.0, 1.2)
        glide_to = GLIDE_END + random.uniform(-0.8, 0.9)
        pan = random.uniform(0.12, 0.88)                 # spread them across the room
        # the very low voices sit in the middle and stay loud; the top ones are thinner
        weight = 1.0 if target < 200 else 0.55 if target < 900 else 0.32
        if target < 80:
            pan = 0.5
        phase = random.uniform(0, math.tau)

        for i in range(n):
            t = i / RATE
            if t < glide_from:
                freq = start + math.sin(t * math.tau * wobble_rate + v) * wobble_depth
            elif t < glide_to:
                x = smoothstep((t - glide_from) / (glide_to - glide_from))
                drifting = start + math.sin(t * math.tau * wobble_rate + v) * wobble_depth * (1 - x)
                freq = math.exp(math.log(drifting) * (1 - x) + math.log(target) * x)
            else:
                freq = target
            phase += math.tau * freq / RATE
            if phase > math.tau:
                phase -= math.tau
            # sawtooth: bright enough that the chord has teeth
            saw = (phase / math.pi) - 1.0
            s = saw * weight * envelope(t)
            left[i] += s * (1 - pan)
            right[i] += s * pan

    # normalise with a little soft clipping so the peak does not sound brittle
    peak = max(max(abs(x) for x in left), max(abs(x) for x in right)) or 1.0
    scale = 0.92 / peak
    frames = array.array('h', bytes(4 * n))
    for i in range(n):
        for ch, buf in ((0, left), (1, right)):
            s = math.tanh(buf[i] * scale * 1.15)
            frames[2 * i + ch] = int(max(-1.0, min(1.0, s)) * 32000)
    return frames


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--wav', action='store_true', help='keep the intermediate WAV')
    args = ap.parse_args()

    frames = build()
    wav_path = OUT.with_suffix('.wav')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(wav_path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(frames.tobytes())
    print(f'wrote {wav_path} ({wav_path.stat().st_size / 1e6:.1f} MB)')

    try:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav_path),
                        '-codec:a', 'libmp3lame', '-b:a', '192k', str(OUT)], check=True)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        sys.exit(f'could not encode the mp3 ({e}); the WAV is still there')
    if not args.wav:
        wav_path.unlink()
    print(f'wrote {OUT} ({OUT.stat().st_size / 1e3:.0f} KB)')


if __name__ == '__main__':
    main()
