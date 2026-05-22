"""
Chop per-syllable processed WAV exports into individual MIDI clips.

Input files live in 'New/' named <syllable>_samples_new.wav
e.g. 'do_samples_new.wav'. Each file contains 35 slots (A2–G5, MIDI 45–79)
at 80 BPM, 2 beats per slot (1500 ms each).

Usage:
    python3 scripts/chop_vocoder.py
"""

import subprocess
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SAMPLES_DIR = Path(__file__).parent.parent / 'New'
OUTPUT_DIR  = Path(__file__).parent.parent / 'app' / 'assets' / 'audio'
TS_OUT      = Path(__file__).parent.parent / 'app' / 'src' / 'audioAssets.ts'

BPM            = 80
BEATS_PER_SLOT = 2
SLOT_MS        = int(60_000 / BPM * BEATS_PER_SLOT)   # 1200 ms

MIDI_MIN   = 45
MIDI_MAX   = 79
MIDI_RANGE = range(MIDI_MIN, MIDI_MAX + 1)

FADE_IN_MS  = 80
FADE_OUT_MS = 20

SYLLABLES = [
    'do', 're', 'mi', 'fa', 'sol', 'la', 'ti',
    'di', 'ri', 'fi', 'si', 'li',
    'ra', 'me', 'se', 'le', 'te',
]

# ---------------------------------------------------------------------------

def chop_clip(y: np.ndarray, sr: int, slot: int) -> np.ndarray:
    start   = int(slot * SLOT_MS * sr / 1000)
    end     = int((slot + 1) * SLOT_MS * sr / 1000)
    clip     = y[start:end].copy()
    fade_in  = int(FADE_IN_MS  * sr / 1000)
    fade_out = int(FADE_OUT_MS * sr / 1000)
    clip[:fade_in]   *= np.power(np.linspace(0.0, 1.0, fade_in),  4)
    clip[-fade_out:] *= np.power(np.linspace(1.0, 0.0, fade_out), 4)
    return clip


def encode_mp3(wav_path: Path, mp3_path: Path) -> None:
    subprocess.run(
        ['ffmpeg', '-y', '-i', str(wav_path), '-q:a', '2', str(mp3_path)],
        check=True, capture_output=True,
    )


def write_ts_asset_map() -> None:
    lines = [
        "// AUTO-GENERATED — do not edit",
        "// Rebuild: scripts/chop_vocoder.py  (solfège)  |  generate_piano.py  |  generate_ride.py",
        "",
        "const AUDIO_ASSETS: Record<string, number> = {",
    ]
    for midi in MIDI_RANGE:
        for syllable in SYLLABLES:
            key = f"{midi}_{syllable}"
            lines.append(f"  '{key}': require('../assets/audio/{key}.mp3'),")
    if TS_OUT.exists():
        for line in TS_OUT.read_text().splitlines():
            if any(k in line for k in ('_piano', 'ride_', 'metro_click', 'ui_tick', 'shepard', 'cadence_')):
                lines.append(line)
    lines += ["};", "", "export default AUDIO_ASSETS;", ""]
    TS_OUT.write_text("\n".join(lines))
    print(f"Written {TS_OUT}")

# ---------------------------------------------------------------------------

def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    wav_files = sorted(SAMPLES_DIR.glob('*.wav'))
    if not wav_files:
        raise FileNotFoundError(f"No WAV files found in {SAMPLES_DIR}")

    # Files are named <syllable>_samples_new.wav
    stem_to_syllable = {}
    for f in wav_files:
        stem = f.stem.lower()                          # e.g. 'do_samples_new'
        for s in SYLLABLES:
            if stem.startswith(s + '_') or stem == s:
                stem_to_syllable[f] = s
                break

    missing = [s for s in SYLLABLES if s not in stem_to_syllable.values()]
    if missing:
        raise FileNotFoundError(f"Missing syllable files: {missing}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        for path in wav_files:
            syllable = stem_to_syllable.get(path)
            if syllable not in SYLLABLES:
                print(f"  Skipping unrecognised: {path.name}")
                continue

            print(f"\n{path.name}  →  '{syllable}'")
            y, sr = librosa.load(str(path), sr=None, mono=True)

            for slot, midi in enumerate(MIDI_RANGE):
                clip = chop_clip(y, sr, slot)
                wav  = tmp / f"{midi}_{syllable}.wav"
                sf.write(str(wav), clip, sr, subtype='PCM_16')
                encode_mp3(wav, OUTPUT_DIR / f"{midi}_{syllable}.mp3")

            print(f"  MIDI {MIDI_MIN}–{MIDI_MAX} done")

    write_ts_asset_map()
    print(f"\nDone. {len(MIDI_RANGE) * len(SYLLABLES)} solfège clips ready.")


if __name__ == '__main__':
    main()
