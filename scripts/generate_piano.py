#!/usr/bin/env python3
"""Generate 25 chromatic piano tone samples for MIDI 48-72 (C3-C5).

Uses FluidSynth with the system's TimGM6mb soundfont.

NOTE: TimGM6mb.sf2 is GPL-licensed. These outputs are DEVELOPMENT
PLACEHOLDERS — replace with CC0/CC-BY recordings before shipping.
The Salamander Grand Piano (CC-BY 3.0) is a suitable replacement.

Produces {midi}_piano.mp3 in app/assets/audio/, then rewrites
app/src/audioAssets.ts to include all solfege + piano require()s.

Run from the project root with the venv active:
  scripts/venv/bin/python3 scripts/generate_piano.py
"""

import subprocess
from pathlib import Path

import fluidsynth
import numpy as np
import soundfile as sf

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OUTPUT_DIR = Path(__file__).parent.parent / "app" / "assets" / "audio"
TS_OUT     = Path(__file__).parent.parent / "app" / "src" / "audioAssets.ts"
SOUNDFONT  = Path(__file__).parent / "SalC5Light2.sf2"

MIDI_MIN    = 36     # C2
MIDI_MAX    = 72     # C5
SR          = 44100
NOTE_DUR    = 2.0    # seconds key is held
RELEASE_DUR = 0.5    # tail after noteoff
VELOCITY    = 100    # 0–127
MP3_BITRATE = "64k"

MIDI_RANGE  = range(MIDI_MIN, MIDI_MAX + 1)

# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def render_note(midi: int) -> np.ndarray:
    """Render a single piano note to a mono float32 array via FluidSynth."""
    fs = fluidsynth.Synth(gain=1.0, samplerate=float(SR))
    fs.setting("synth.reverb.active", 0)
    fs.setting("synth.chorus.active", 0)
    sfid = fs.sfload(str(SOUNDFONT))
    fs.program_select(0, sfid, 0, 0)  # bank 0, preset 0 = Acoustic Grand Piano

    blocks: list[np.ndarray] = []

    def collect(seconds: float) -> None:
        chunk = 1024
        needed = int(SR * seconds)
        done = 0
        while done < needed:
            n = min(chunk, needed - done)
            blocks.append(fs.get_samples(n))
            done += n

    fs.noteon(0, midi, VELOCITY)
    collect(NOTE_DUR)
    fs.noteoff(0, midi)
    collect(RELEASE_DUR)
    fs.delete()

    # get_samples returns interleaved stereo int16
    audio = np.concatenate(blocks).reshape(-1, 2).mean(axis=1).astype(np.float32)
    audio /= 32768.0

    # Normalise to 0.9 FS
    peak = np.max(np.abs(audio))
    if peak > 1e-6:
        audio *= 0.5 / peak

    # 10 ms fade-in, 50 ms fade-out
    fade_in  = int(SR * 0.01)
    fade_out = int(SR * 0.05)
    audio[:fade_in]  *= np.linspace(0.0, 1.0, fade_in)
    audio[-fade_out:] *= np.linspace(1.0, 0.0, fade_out)

    return audio


def encode_mp3(wav_path: Path, mp3_path: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav_path), "-b:a", MP3_BITRATE, str(mp3_path)],
        check=True, capture_output=True,
    )


# ---------------------------------------------------------------------------
# TypeScript asset map (scans the full audio directory)
# ---------------------------------------------------------------------------

def write_ts_asset_map(audio_dir: Path, ts_path: Path) -> None:
    """Write a require()-per-file TS module covering everything in audio_dir."""
    keys = sorted(p.stem for p in audio_dir.glob("*.mp3"))
    lines = [
        "// AUTO-GENERATED — do not edit",
        "// Run scripts/generate_audio.py then scripts/generate_piano.py to rebuild.",
        "",
        "const AUDIO_ASSETS: Record<string, number> = {",
    ]
    for key in keys:
        lines.append(f"  '{key}': require('../assets/audio/{key}.mp3'),")
    lines += ["};", "", "export default AUDIO_ASSETS;", ""]
    ts_path.write_text("\n".join(lines))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if not SOUNDFONT.exists():
        raise FileNotFoundError(
            f"Soundfont not found: {SOUNDFONT}\n"
            "Install with: sudo apt install fluid-soundfont-gm"
        )

    print(f"Generating {len(MIDI_RANGE)} piano tones → {OUTPUT_DIR}\n")

    tmp_wav = OUTPUT_DIR / "_piano_tmp.wav"

    for midi in MIDI_RANGE:
        out_mp3 = OUTPUT_DIR / f"{midi}_piano.mp3"
        note_name = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][midi % 12]
        octave    = midi // 12 - 1
        if out_mp3.exists():
            print(f"  [{midi}]  {note_name}{octave} … SKIP")
            continue
        print(f"  [{midi}]  {note_name}{octave} …")

        audio = render_note(midi)
        sf.write(str(tmp_wav), audio, SR)
        encode_mp3(tmp_wav, out_mp3)

    tmp_wav.unlink(missing_ok=True)

    print(f"\nRewriting TypeScript asset map → {TS_OUT}")
    write_ts_asset_map(OUTPUT_DIR, TS_OUT)

    print(f"Done. {len(MIDI_RANGE)} piano tones written.")


if __name__ == "__main__":
    main()
