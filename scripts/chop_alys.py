"""
Chop evenly-spaced Alys DiffSinger recordings into per-note MP3s.

Source: /mnt/Storage/My_Apps/Solfege/New/do_samples_{Name}.wav
  – 2 beats of dead air before note 0 (= 1 BAR_MS of silence)
  – notes at BAR_MS intervals thereafter, MIDI 45–80

Output: app/assets/audio/{midi}_{syllable}.mp3

Two-pass pipeline per syllable:
  Pass 1 – chop → normalise → measure RMS per note
  Pass 2 – apply linear EQ gains (note 0 → note 35) → write MP3
"""

import sys
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import librosa
import soundfile as sf

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

NEW_DIR   = Path('/mnt/Storage/My_Apps/Solfege/New')
AUDIO_DIR = Path(__file__).parent.parent / 'app' / 'assets' / 'audio'

# 'se' is stored as Sa (recording naming quirk)
SOURCE_MAP: dict[str, Path] = {
    s: NEW_DIR / f'do_samples_{("Sa" if s == "se" else s.capitalize())}.wav'
    for s in ['do','re','mi','fa','sol','la','ti','di','ri','fi','si','li','ra','me','se','le','te']
}

SYLLABLES  = ['do','re','mi','fa','sol','la','ti','di','ri','fi','si','li','ra','me','se','le','te']
MIDI_START = 45
MIDI_END   = 80
N_NOTES    = MIDI_END - MIDI_START + 1   # 36

# ---------------------------------------------------------------------------
# Timing
# ---------------------------------------------------------------------------

BAR_MS       = 1500   # 2 beats at 80 BPM
PRE_ONSET_MS = 550    # silence before onset in each clip (= SOLFEGE_LEAD_MS)
CLIP_TAIL_MS = 1200   # sustain + tail after onset
SR           = 44100

CLIP_LEN = int((PRE_ONSET_MS + CLIP_TAIL_MS) * SR / 1000)
PRE_SAMP = int(PRE_ONSET_MS * SR / 1000)

# ---------------------------------------------------------------------------
# Onset / inertia detection
# ---------------------------------------------------------------------------

RMS_FRAME_MS  = 5     # short-term RMS window for fine detection
SEARCH_MS     = 250   # scan this far before each grid estimate for inertia point
NOISE_FLOOR   = 0.003 # amplitude below which we consider audio silent

def _rms(y: np.ndarray) -> float:
    return float(np.sqrt(np.mean(y ** 2)))

def detect_all_onsets(y: np.ndarray) -> list[int]:
    """
    Return per-note inertia onset samples for all N_NOTES.

    Strategy:
      1. Coarse pass: find rough first-note onset with 50ms windows.
      2. Per-note: estimate grid position, then scan backward in 5ms steps
         to find where energy first rises out of silence — the inertia point.
    """
    win_coarse = int(0.05 * SR)
    rough_first = 0
    # Search only within the first 2 bars (before first note could appear)
    limit = int(2 * BAR_MS * SR / 1000)
    for i in range(limit // win_coarse + 1):
        start = i * win_coarse
        end   = min(start + win_coarse, len(y))
        if _rms(y[start:end]) > NOISE_FLOOR:
            rough_first = start
            break

    win_fine   = int(RMS_FRAME_MS * SR / 1000)   # 220 samples ≈ 5ms
    search_back = int(SEARCH_MS * SR / 1000)

    onsets = []
    for i in range(N_NOTES):
        estimated = rough_first + int(i * BAR_MS * SR / 1000)

        # Scan backward from estimated in 5ms steps until we hit silence
        inertia = estimated
        pos = estimated
        while pos > max(0, estimated - search_back):
            pos -= win_fine
            if pos < 0:
                break
            if _rms(y[pos : pos + win_fine]) < NOISE_FLOOR:
                inertia = pos + win_fine   # first frame above silence
                break

        onsets.append(max(0, inertia))

    return onsets

# ---------------------------------------------------------------------------
# Clip shaping
# ---------------------------------------------------------------------------

RAMP_SAMP     = int(0.005 * SR)          # 5ms cosine ramp to kill click
HEADROOM_SAMP = int(SR * 60 / 80 / 4)   # 1 sixteenth note of natural pre-onset silence

def chop_clip(y: np.ndarray, onset_samp: int) -> np.ndarray:
    start = onset_samp - PRE_SAMP
    clip  = np.zeros(CLIP_LEN, dtype=np.float32)
    src_s = max(start, 0)
    dst_s = max(-start, 0)
    n     = min(CLIP_LEN - dst_s, len(y) - src_s)
    if n > 0:
        clip[dst_s : dst_s + n] = y[src_s : src_s + n]

    # Hard silence up to headroom; leave headroom as natural recording silence;
    # 5ms cosine ramp into onset to prevent DC click.
    clip[: PRE_SAMP - RAMP_SAMP - HEADROOM_SAMP] = 0.0
    t_in = np.arange(RAMP_SAMP)
    clip[PRE_SAMP - RAMP_SAMP : PRE_SAMP] *= 0.5 * (1.0 - np.cos(np.pi * t_in / RAMP_SAMP))

    # Cosine fade-out from halfway through tail — steeper than 1−t², cuts breath faster
    fade_start = PRE_SAMP + int(CLIP_TAIL_MS * SR / 1000) // 2
    fade_len   = CLIP_LEN - fade_start
    if fade_len > 0:
        t_out = np.linspace(0.0, 1.0, fade_len)
        clip[fade_start:] *= 0.5 * (1.0 + np.cos(np.pi * t_out))

    return clip

# ---------------------------------------------------------------------------
# Normalisation (no compressor — compression introduced audible grain)
# ---------------------------------------------------------------------------

NORMALIZE_TARGET = 0.80

def process(clip: np.ndarray) -> np.ndarray:
    peak = np.max(np.abs(clip))
    if peak > 0:
        clip = clip * (NORMALIZE_TARGET / peak)
    return clip.astype(np.float32)

# ---------------------------------------------------------------------------
# Per-syllable RMS equalization
# ---------------------------------------------------------------------------

MEASURE_MS = 300   # measure RMS over this window after the onset

def measure_rms(clip: np.ndarray) -> float:
    end = min(PRE_SAMP + int(MEASURE_MS * SR / 1000), len(clip))
    seg = clip[PRE_SAMP:end]
    return _rms(seg) if len(seg) > 0 else 0.0

TARGET_RMS = 0.18  # per-note RMS target; notes louder than this get reduced, quieter stay unchanged

def eq_gains(rms_values: list[float]) -> list[float]:
    """
    Per-note flat-RMS equalisation: bring every note down to TARGET_RMS.
    Gains are ≤ 1.0 — loud notes (including loud low notes) get reduced,
    quiet notes stay unchanged. No note is boosted above its normalised level.
    """
    return [min(1.0, TARGET_RMS / r) if r > 1e-6 else 1.0 for r in rms_values]

# ---------------------------------------------------------------------------
# MP3 encoding
# ---------------------------------------------------------------------------

def to_mp3(clip: np.ndarray, out_path: Path) -> bool:
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp = Path(f.name)
    sf.write(str(tmp), clip, SR)
    result = subprocess.run(
        ['ffmpeg', '-y', '-i', str(tmp),
         '-codec:a', 'libmp3lame', '-q:a', '5', str(out_path)],
        capture_output=True,
    )
    tmp.unlink(missing_ok=True)
    return result.returncode == 0

# ---------------------------------------------------------------------------
# Per-syllable pipeline
# ---------------------------------------------------------------------------

def process_syllable(syllable: str) -> None:
    src = SOURCE_MAP[syllable]
    if not src.exists():
        print(f'  MISSING {src}')
        return

    y, _ = librosa.load(str(src), sr=SR, mono=True)
    y = y.astype(np.float32)

    # Detect per-note inertia onsets
    onsets = detect_all_onsets(y)

    # Pass 1: chop + normalise → measure RMS per note
    clips      = []
    rms_values = []
    for onset_samp in onsets:
        raw  = chop_clip(y, onset_samp)
        proc = process(raw)
        clips.append(proc)
        rms_values.append(measure_rms(proc))

    # Compute linear EQ gains from first→last note RMS
    gains = eq_gains(rms_values)

    # Pass 2: apply EQ, write MP3
    ok = err = 0
    for i, (clip, gain) in enumerate(zip(clips, gains)):
        midi = MIDI_START + i
        final = np.clip(clip * gain, -1.0, 1.0).astype(np.float32)
        out   = AUDIO_DIR / f'{midi}_{syllable}.mp3'
        if to_mp3(final, out):
            ok += 1
        else:
            print(f'    ERROR {out.name}')
            err += 1

    onset_ms = [o * 1000 // SR for o in onsets[:4]]
    print(
        f'  {syllable:<4}  {ok}/36 ok'
        f'  onsets={onset_ms}…'
        f'  eq {gains[0]:.2f}→{gains[-1]:.2f}'
        f'  rms {rms_values[0]:.4f}→{rms_values[-1]:.4f}'
    )

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    targets = sys.argv[1:] if len(sys.argv) > 1 else SYLLABLES
    invalid = [s for s in targets if s not in SOURCE_MAP]
    if invalid:
        print(f'Unknown syllables: {invalid}')
        sys.exit(1)

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    print(f'Chopping {len(targets)} syllable(s) → {AUDIO_DIR}')
    for s in targets:
        process_syllable(s)
    print('Done.')


if __name__ == '__main__':
    main()
