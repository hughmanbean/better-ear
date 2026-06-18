"""
Quick clip browser — loops each processed MP3 against a metronome click.
No rating, no reports. Just listen and navigate.

Usage:
    scripts/venv/bin/python3 scripts/listen.py [--bpm 80] [--reps 4]
    scripts/venv/bin/python3 scripts/listen.py --auto          # plays every clip in sequence
    scripts/venv/bin/python3 scripts/listen.py --auto --reps 1 # faster pass

Controls:
    ] / [    next / prev note
    } / {    next / prev syllable
    m        toggle metronome
    + / -    shift timing 10ms later / earlier  (prints value to paste when done)
    space    pause / resume auto-advance
    q        quit
"""

import argparse
import sys
import termios
import tty
import threading
import time
from pathlib import Path

import numpy as np
import sounddevice as sd

try:
    import librosa
except ImportError:
    sys.exit("Missing deps: scripts/venv/bin/pip install librosa sounddevice numpy")

AUDIO_DIR = Path(__file__).parent.parent / 'app' / 'assets' / 'audio'

SYLLABLES = [
    'do', 're', 'mi', 'fa', 'sol', 'la', 'ti',
    'di', 'ri', 'fi', 'si', 'li',
    'ra', 'me', 'se', 'le', 'te',
]

MIDI_MIN   = 45
MIDI_MAX   = 80
MIDI_RANGE = list(range(MIDI_MIN, MIDI_MAX + 1))

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def midi_name(m: int) -> str:
    return f"{NOTE_NAMES[m % 12]}{(m // 12) - 1}"

SOLFEGE_LEAD_MS = 550  # starting value — nudge with +/- until on beat
TIMING_STEP_MS  = 10


def make_click(sr: int, accent: bool = False) -> np.ndarray:
    freq = 1200 if accent else 900
    dur  = 0.012
    t    = np.linspace(0, dur, int(sr * dur), endpoint=False)
    c    = np.sin(2 * np.pi * freq * t) * np.exp(-t * 300)
    return (c * (0.6 if accent else 0.4)).astype(np.float32)


def build_buffer(syllable: str, midi: int, bpm: int, reps: int, sr: int,
                 metro: bool, lead_ms: float) -> np.ndarray | None:
    path = AUDIO_DIR / f"{midi}_{syllable}.mp3"
    if not path.exists():
        return None
    try:
        audio, _ = librosa.load(str(path), sr=sr, mono=True)
    except Exception:
        return None
    audio = audio.astype(np.float32)

    beat_samp  = int(sr * 60 / bpm)
    lead_samp  = int(sr * lead_ms / 1000)
    bar_beats  = 4                  # 4/4 time — metro accent period
    cycle      = 2                  # play clip every 2 beats
    total      = reps * cycle
    buf        = np.zeros(total * beat_samp, dtype=np.float32)

    if metro:
        click_hi = make_click(sr, accent=True)
        click_lo = make_click(sr, accent=False)
        for b in range(total):
            pos = b * beat_samp
            cl  = click_hi if b % bar_beats == 0 else click_lo
            end = min(pos + len(cl), len(buf))
            buf[pos:end] += cl[:end - pos]

    for b in range(0, total, cycle):
        clip_start = b * beat_samp - lead_samp
        if clip_start < 0:
            trim       = -clip_start
            chunk      = audio[trim:] if trim < len(audio) else np.array([], dtype=np.float32)
            clip_start = 0
        else:
            chunk = audio
        end = min(clip_start + len(chunk), len(buf))
        buf[clip_start:end] += chunk[:end - clip_start] * 0.8

    np.clip(buf, -1.0, 1.0, out=buf)
    return buf


class LoopPlayer:
    def __init__(self, sr: int = 44100) -> None:
        self.sr     = sr
        self._lock  = threading.Lock()
        self._state = {'buf': None, 'pos': 0}
        self._stream = sd.OutputStream(
            samplerate=sr, channels=1, dtype='float32',
            blocksize=1024, callback=self._cb,
        )
        self._stream.start()

    def _cb(self, outdata: np.ndarray, frames: int, _t, _s) -> None:
        with self._lock:
            buf = self._state['buf']
        if buf is None:
            outdata.fill(0)
            return
        pos = self._state['pos']
        out = outdata[:, 0]
        n   = 0
        while n < frames:
            chunk = min(frames - n, len(buf) - pos)
            out[n:n + chunk] = buf[pos:pos + chunk]
            n  += chunk
            pos = (pos + chunk) % len(buf)
        self._state['pos'] = pos

    def load(self, buf: np.ndarray | None) -> None:
        with self._lock:
            self._state['buf'] = buf
            self._state['pos'] = 0

    def close(self) -> None:
        self._stream.stop()
        self._stream.close()


def getch() -> str:
    fd  = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        return sys.stdin.read(1)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--bpm',   type=int,  default=80)
    ap.add_argument('--reps',  type=int,  default=4)
    ap.add_argument('--auto',  action='store_true', help='auto-advance through every clip')
    args = ap.parse_args()

    sr      = 44100
    player  = LoopPlayer(sr)
    syl_i   = 0
    note_i  = 0
    metro   = True
    lead_ms = float(SOLFEGE_LEAD_MS)
    paused  = False

    clip_ms = args.reps * 4 * int(60_000 / args.bpm)  # total buffer duration in ms (1-bar cycle)

    def reload() -> None:
        syl  = SYLLABLES[syl_i]
        midi = MIDI_RANGE[note_i]
        buf  = build_buffer(syl, midi, args.bpm, args.reps, sr, metro, lead_ms)
        player.load(buf)
        metro_s  = 'M' if metro else 'm'
        shift    = lead_ms - SOLFEGE_LEAD_MS
        shift_s  = f"  lead={lead_ms:.0f}({shift:+.0f})" if shift != 0 else ''
        total    = len(SYLLABLES) * len(MIDI_RANGE)
        current  = syl_i * len(MIDI_RANGE) + note_i + 1
        auto_s   = '  [PAUSED]' if paused else ('  [AUTO]' if args.auto else '')
        print(
            f"\033[2K\r  {syl:<4}  {midi_name(midi)}({midi})"
            f"  {current}/{total}{shift_s}  [{metro_s}]{auto_s}"
            f"  [[]prev []]next  [{{}}]syl  [+/-]timing  [m]metro"
            + ('  [space]pause  ' if args.auto else '  ')
            + '[q]quit',
            end='', flush=True,
        )

    def advance() -> bool:
        """Move to next clip. Returns False when all clips exhausted."""
        nonlocal syl_i, note_i
        if note_i < len(MIDI_RANGE) - 1:
            note_i += 1
        elif syl_i < len(SYLLABLES) - 1:
            syl_i  += 1
            note_i  = 0
        else:
            return False
        return True

    print("Better Ear — quick listen")
    print(f"  {args.bpm} BPM  ·  {args.reps} reps/loop  ·  {len(SYLLABLES)*len(MIDI_RANGE)} clips total")
    if args.auto:
        secs = len(SYLLABLES) * len(MIDI_RANGE) * clip_ms / 1000
        print(f"  Auto mode — {secs/60:.0f} min total at current reps  (--reps 1 for a faster pass)")
    print()
    reload()

    stop_event = threading.Event()

    def auto_thread() -> None:
        nonlocal paused
        while not stop_event.is_set():
            time.sleep(clip_ms / 1000)
            if stop_event.is_set():
                break
            if paused:
                continue
            if not advance():
                stop_event.set()
                break
            reload()

    if args.auto:
        t = threading.Thread(target=auto_thread, daemon=True)
        t.start()

    try:
        while not stop_event.is_set():
            ch = getch()
            if ch in ('q', '\x03', '\x1b'):
                break
            elif ch == ' ' and args.auto:
                paused = not paused
                reload()
            elif ch == ']':
                note_i = min(note_i + 1, len(MIDI_RANGE) - 1)
                reload()
            elif ch == '[':
                note_i = max(note_i - 1, 0)
                reload()
            elif ch == '}':
                syl_i  = min(syl_i + 1, len(SYLLABLES) - 1)
                note_i = 0
                reload()
            elif ch == '{':
                syl_i  = max(syl_i - 1, 0)
                note_i = 0
                reload()
            elif ch == 'm':
                metro = not metro
                reload()
            elif ch in ('+', '='):
                lead_ms += TIMING_STEP_MS
                reload()
            elif ch == '-':
                lead_ms -= TIMING_STEP_MS
                reload()
    finally:
        stop_event.set()
        player.close()
        shift = lead_ms - SOLFEGE_LEAD_MS
        if shift != 0:
            print(f"\n\nSOLFEGE_LEAD_MS adjusted by {shift:+.0f}ms → new value: {lead_ms:.0f}ms")
            print(f"Paste into:")
            print(f"  scripts/listen.py       line: SOLFEGE_LEAD_MS = {lead_ms:.0f}")
            print(f"  app/src/AudioEngine.ts  line: const SOLFEGE_LEAD_MS = {lead_ms:.0f};")
            print(f"  -- OR rechop with: ONSET_OFFSET_MS += {shift:+.0f}  (keeps AudioEngine.ts at 500ms)")
        print()


if __name__ == '__main__':
    main()
