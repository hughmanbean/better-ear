#!/usr/bin/env python3
"""Generate a swing ride-cymbal loop for each tempo (slow / medium / fast).

Uses GM drum kit (channel 9, note 51 = Ride Cymbal 1) via FluidSynth.
Pattern: quarter-note downbeats + swing 8th-note "ands" (2/3 beat offset).
Renders 1-bar pre-roll (discarded) then 8 bars of steady-state loop content.

Outputs ride_slow.mp3, ride_medium.mp3, ride_fast.mp3 to assets/audio/,
then rewrites app/src/audioAssets.ts to include all assets.

Run from the project root with the venv active:
  scripts/venv/bin/python3 scripts/generate_ride.py
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
SOUNDFONT  = Path("/usr/share/sounds/sf2/TimGM6mb.sf2")

TEMPOS = {"slow": 60, "medium": 80, "fast": 100}

SWING      = 2 / 3   # swing 8th lands 2/3 of the way through the beat
LOOP_BARS  = 8       # bars of usable loop content (after 1-bar pre-roll)
SR         = 44100
MP3_BITRATE = "64k"

# Ride Cymbal 1 = GM note 51; velocities vary for a human feel
VEL_DOWN   = 68      # downbeat (beats 1 & 3)
VEL_ACCENT = 74      # downbeat (beats 2 & 4 — slightly stronger in jazz)
VEL_AND    = 42      # swing 8th ("and"), kept soft


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def hit_times(bpm: float) -> list[tuple[float, int]]:
    """Return (time_seconds, velocity) for one bar of swing ride."""
    beat_s = 60.0 / bpm
    hits = []
    for beat in range(4):
        t      = beat * beat_s
        vel    = VEL_ACCENT if beat in (1, 3) else VEL_DOWN
        hits.append((t, vel))
        hits.append((t + SWING * beat_s, VEL_AND))
    return hits


def render_ride_loop(bpm: float) -> np.ndarray:
    beat_s    = 60.0 / bpm
    bar_s     = beat_s * 4
    bar_samp  = int(bar_s * SR)

    # Build hit list across (1 pre-roll + LOOP_BARS) bars
    total_bars = 1 + LOOP_BARS
    one_bar    = hit_times(bpm)
    all_hits   = [
        (t + bar_idx * bar_s, v)
        for bar_idx in range(total_bars)
        for t, v in one_bar
    ]
    all_hits.sort()

    fs = fluidsynth.Synth(gain=0.8, samplerate=float(SR))
    fs.setting("synth.reverb.active", 0)
    fs.setting("synth.chorus.active", 0)
    sfid = fs.sfload(str(SOUNDFONT))
    fs.program_select(9, sfid, 128, 0)  # channel 9 = drums, standard kit

    blocks: list[np.ndarray] = []
    cur = 0
    total_samp = bar_samp * total_bars + int(SR * 1.5)  # extra tail

    for hit_s, vel in all_hits:
        hit_samp = int(hit_s * SR)
        if hit_samp > cur:
            blocks.append(fs.get_samples(hit_samp - cur))
            cur = hit_samp
        fs.noteon(9, 51, vel)   # Ride Cymbal 1

    if cur < total_samp:
        blocks.append(fs.get_samples(total_samp - cur))

    fs.delete()

    audio = np.concatenate(blocks).reshape(-1, 2).mean(axis=1).astype(np.float32)
    audio /= 32768.0

    # Discard pre-roll bar, keep LOOP_BARS bars of steady-state content
    loop = audio[bar_samp : bar_samp * (1 + LOOP_BARS)].copy()

    # Normalise
    peak = np.max(np.abs(loop))
    if peak > 1e-6:
        loop *= 0.65 / peak

    # 20 ms fade-out at loop end to soften the splice point
    fade = int(SR * 0.02)
    loop[-fade:] *= np.linspace(1.0, 0.0, fade)

    return loop


def encode_mp3(wav_path: Path, mp3_path: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav_path), "-b:a", MP3_BITRATE, str(mp3_path)],
        check=True, capture_output=True,
    )


# ---------------------------------------------------------------------------
# TypeScript asset map (full directory scan)
# ---------------------------------------------------------------------------

def write_ts_asset_map(audio_dir: Path, ts_path: Path) -> None:
    keys = sorted(p.stem for p in audio_dir.glob("*.mp3"))
    lines = [
        "// AUTO-GENERATED — do not edit",
        "// Rebuild: scripts/generate_audio.py → generate_piano.py → generate_ride.py",
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

    tmp = OUTPUT_DIR / "_ride_tmp.wav"

    for name, bpm in TEMPOS.items():
        print(f"  ride_{name}  ({bpm} BPM, {LOOP_BARS} bars) …")
        audio = render_ride_loop(float(bpm))
        sf.write(str(tmp), audio, SR)
        encode_mp3(tmp, OUTPUT_DIR / f"ride_{name}.mp3")

    tmp.unlink(missing_ok=True)

    print(f"\nRewriting TypeScript asset map → {TS_OUT}")
    write_ts_asset_map(OUTPUT_DIR, TS_OUT)
    print("Done.")


if __name__ == "__main__":
    main()
