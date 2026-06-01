"""
Chop per-syllable processed WAV exports into individual MIDI clips.

Input files live in 'New/' named <syllable>_samples_new.wav
Each file contains one slot per MIDI note (MIDI_MIN–MIDI_MAX) at 80 BPM,
2 beats per slot (1500 ms each).

Onset-adaptive chopping
-----------------------
For each slot the script detects the perceptual onset in the source file,
then cuts the source PRE_ONSET_MS before that onset. A short fade-in is
applied at the cut point so there is no pop. Pure silence is then prepended
to bring the onset to a consistent position (CHOP_LEAD_MS from clip start)
across all syllables. This avoids both bleed artefacts (we never grab audio
before the onset) and pop artefacts (the fade-in is at the actual cut, not
at a silence/audio boundary).

Usage:
    python3 scripts/chop_vocoder.py
"""

import subprocess
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SAMPLES_DIR = Path(__file__).parent.parent / 'New'
OUTPUT_DIR  = Path(__file__).parent.parent / 'app' / 'assets' / 'audio'
TS_OUT      = Path(__file__).parent.parent / 'app' / 'src' / 'audioAssets.ts'

BPM            = 80
BEATS_PER_SLOT = 2
SLOT_MS        = int(60_000 / BPM * BEATS_PER_SLOT)   # 1500 ms

MIDI_MIN   = 45
MIDI_MAX   = 80
MIDI_RANGE = range(MIDI_MIN, MIDI_MAX + 1)

# Where the onset lands within every output clip (ms from clip start).
# All syllables are normalised to this position via silence prepend.
CHOP_LEAD_MS = 50

# How far before the detected onset we place the actual source cut.
# Gives a short pre-onset buffer for the fade-in and any consonant breath,
# and acts as tolerance against onset detection landing fractionally late.
PRE_ONSET_MS = 20

# Onset detection search window around the slot boundary.
ONSET_SEARCH_PRE_MS  = 150   # ms before slot boundary to start searching
ONSET_SEARCH_POST_MS = 250   # ms after  slot boundary to stop searching
# Onset = first RMS frame exceeding this fraction of the local peak.
ONSET_THRESHOLD = 0.15
# Detections further than this from the slot boundary are discarded as
# false positives (reverb tail from previous slot, near-silence, etc.).
ONSET_MAX_DEVIATION_MS = 200

# Per-syllable onset shift (ms). Added to the raw detected onset so the cut
# lands closer to the vowel for phonemes where energy builds gradually before
# the vowel arrives. Stop consonants (d, t) need little or no adjustment.
# Tune each value if that syllable still sounds ahead or behind the beat.
#
#  Nasals  (m):   detector fires on gradual nasal build-up, vowel is much later
#  Fricatives (f, s): hiss precedes the vowel by a significant gap
#  Liquids (r, l): softer onset, smaller gap than nasals/fricatives
SYLLABLE_ONSET_ADJUST_MS: dict[str, float] = {
    'me':  95,   # nasal
    'mi':  95,   # nasal
    'fa':  75,   # fricative
    'fi':  65,   # fricative
    'se':  35,   # fricative (softer than f)
    'si':  35,   # fricative
    'sol': 73,   # starts with s
    're':  85,   # liquid/approximant
    'ra':  30,   # liquid/approximant
    'ri':  30,   # liquid/approximant
    'le':  25,   # lateral liquid
    'li':  25,   # lateral liquid
    'do':  50,   # stop consonant — vowel attack still needs compensating
    'la':  45,   # also pushes detection past previous slot's reverb tail (artefact fix)
}

# Per-syllable override for how far before the onset anchor the source is cut.
# Fricatives like 'f' have a long consonant ramp before the vowel anchor —
# cutting further back captures that ramp-up. Grow alongside ONSET_ADJUST
# so the cut still lands before the consonant starts.
SYLLABLE_PRE_ONSET_MS: dict[str, float] = {
    'fa':  80,   # reach back to capture 'f' ramp before vowel anchor
    'fi':  70,
    'sol': 60,   # reach back to capture 's' ramp before vowel anchor
    'do':  45,   # reach back to capture 'd' burst; keeps silence≈5ms so timing unchanged
}

# Per-clip peak normalisation.
NORMALIZE_TARGET = 0.78
NORMALIZE_FLOOR  = 0.02

# Fade-in applied at the source cut point (not at a silence boundary).
FADE_IN_MS = 8

# Transient boost: short gain envelope applied at the onset position before
# normalisation. Makes the perceptual attack snappier without sounding
# unnatural. Decays linearly from TRANSIENT_BOOST_DB to 0 dB over TRANSIENT_MS.
TRANSIENT_BOOST_DB = 3.0
TRANSIENT_MS       = 40

# Compression (ffmpeg acompressor).
COMP_THRESHOLD = '-18dB'
COMP_RATIO     = 6
COMP_ATTACK    = 5
COMP_RELEASE   = 150

# Fade-out: starts at FADE_OUT_START_MS into the clip and reaches zero at the
# end. A squared curve drops rapidly at first to cut the breathy tail quickly,
# then eases off toward silence. Tune FADE_OUT_START_MS to taste — earlier
# = shorter sustain, less breathiness.
FADE_OUT_START_MS = 300

# Soft reverb.
REVERB_DECAY_S = 0.35
REVERB_WET     = 0.15
REVERB_SEED    = 42

# Set to a syllable name (e.g. 'mi') to process only that syllable.
TEST_SYLLABLE: str | None = None

SYLLABLES = [
    'do', 're', 'mi', 'fa', 'sol', 'la', 'ti',
    'di', 'ri', 'fi', 'si', 'li',
    'ra', 'me', 'se', 'le', 'te',
]

# ---------------------------------------------------------------------------
# Onset detection (operates on the source file)
# ---------------------------------------------------------------------------

def find_onset_sample(y: np.ndarray, sr: int, slot: int) -> int:
    """
    Detect the perceptual onset sample index in the source file for a slot.

    Searches [slot_boundary - ONSET_SEARCH_PRE_MS, slot_boundary + ONSET_SEARCH_POST_MS]
    using short-time RMS energy. Falls back to the slot boundary itself if
    detection is unreliable or the region is near-silent.
    """
    slot_start  = int(slot * SLOT_MS * sr / 1000)
    search_pre  = int(ONSET_SEARCH_PRE_MS  * sr / 1000)
    search_post = int(ONSET_SEARCH_POST_MS * sr / 1000)
    max_dev     = int(ONSET_MAX_DEVIATION_MS * sr / 1000)
    fallback    = slot_start

    s0 = max(0, slot_start - search_pre)
    s1 = min(len(y), slot_start + search_post)
    region = y[s0:s1]

    frame_len = max(2, int(0.010 * sr))   # 10 ms frames
    hop_len   = max(1, int(0.005 * sr))   # 5 ms hop

    if len(region) < frame_len or np.max(np.abs(region)) < 0.005:
        return fallback

    frames = librosa.util.frame(region, frame_length=frame_len, hop_length=hop_len)
    rms    = np.sqrt(np.mean(frames ** 2, axis=0))
    peak   = np.max(rms)
    if peak < 1e-6:
        return fallback

    above = np.where(rms > peak * ONSET_THRESHOLD)[0]
    if len(above) == 0:
        return fallback

    onset_sample = s0 + int(above[0]) * hop_len

    if abs(onset_sample - slot_start) > max_dev:
        return fallback

    return onset_sample

# ---------------------------------------------------------------------------
# Reverb
# ---------------------------------------------------------------------------

def _build_reverb_ir(sr: int) -> np.ndarray:
    ir_len = int(REVERB_DECAY_S * sr)
    t_ir   = np.arange(ir_len) / sr
    rng    = np.random.default_rng(REVERB_SEED)
    ir     = rng.standard_normal(ir_len) * np.exp(-(6.0 / REVERB_DECAY_S) * t_ir)
    sos_hp = butter(2, 400, btype='highpass', fs=sr, output='sos')
    ir     = sosfilt(sos_hp, ir)
    ir    /= np.max(np.abs(ir)) + 1e-9
    return ir


_ir_cache: dict[int, np.ndarray] = {}

def add_reverb(y: np.ndarray, sr: int) -> np.ndarray:
    if sr not in _ir_cache:
        _ir_cache[sr] = _build_reverb_ir(sr)
    ir  = _ir_cache[sr]
    wet = fftconvolve(y, ir)[:len(y)]
    return (1.0 - REVERB_WET) * y + REVERB_WET * wet

# ---------------------------------------------------------------------------
# Clip processing
# ---------------------------------------------------------------------------

def chop_clip(y: np.ndarray, sr: int, slot: int, syllable: str = '') -> tuple[np.ndarray, float]:
    """
    Build one clip:
      1. Detect onset in source file
      2. Cut source PRE_ONSET_MS before onset (clean cut, no bleed)
      3. Fade-in at cut point (eliminates pops)
      4. Prepend silence so onset lands at CHOP_LEAD_MS (normalises placement)
      5. Normalise, reverb, fade-out tail

    Returns (clip, onset_offset_ms) where onset_offset_ms is the detected
    onset position relative to the slot boundary in the source file.
    """
    slot_samples   = int(SLOT_MS * sr / 1000)
    pre_ms         = SYLLABLE_PRE_ONSET_MS.get(syllable, PRE_ONSET_MS)
    pre_onset_samp = int(pre_ms * sr / 1000)
    silence_samp   = max(0, int(CHOP_LEAD_MS * sr / 1000) - pre_onset_samp)
    audio_samp     = slot_samples - silence_samp

    # 1. Detect onset in source, then apply per-syllable phoneme adjustment.
    onset_sample = find_onset_sample(y, sr, slot)
    slot_start   = int(slot * SLOT_MS * sr / 1000)
    adjust_samp  = int(SYLLABLE_ONSET_ADJUST_MS.get(syllable, 0) * sr / 1000)
    onset_sample = min(onset_sample + adjust_samp,
                       slot_start + int(ONSET_SEARCH_POST_MS * sr / 1000))
    onset_offset_ms = (onset_sample - slot_start) * 1000.0 / sr

    # 2. Cut pre_onset_samp before onset (further back for fricatives).
    cut_start  = max(0, onset_sample - pre_onset_samp)
    actual_pre = onset_sample - cut_start   # may be < pre_onset_samp at file start

    audio = y[cut_start : min(cut_start + audio_samp, len(y))].copy()
    if len(audio) < audio_samp:
        audio = np.pad(audio, (0, audio_samp - len(audio)))

    # 3. Fade-in at the cut point — no pop even if residual energy is present.
    fade_in = min(int(FADE_IN_MS * sr / 1000), actual_pre)
    if fade_in > 0:
        audio[:fade_in] *= np.linspace(0.0, 1.0, fade_in)

    # 4. Prepend silence so onset sits at CHOP_LEAD_MS into the clip.
    silence = np.zeros(silence_samp, dtype=audio.dtype)
    clip    = np.concatenate([silence, audio])

    # Guarantee exact SLOT_MS length.
    clip = clip[:slot_samples]
    if len(clip) < slot_samples:
        clip = np.pad(clip, (0, slot_samples - len(clip)))

    # 5. Transient boost at the onset — sharpens rhythmic snap.
    onset_idx = silence_samp + actual_pre
    t_end     = min(onset_idx + int(TRANSIENT_MS * sr / 1000), len(clip))
    if t_end > onset_idx:
        env = np.linspace(TRANSIENT_BOOST_DB, 0.0, t_end - onset_idx)
        clip[onset_idx:t_end] *= 10.0 ** (env / 20.0)

    # 6. Normalise (after boost so the boosted onset sets the peak).
    peak = np.max(np.abs(clip))
    if peak >= NORMALIZE_FLOOR:
        clip *= NORMALIZE_TARGET / peak

    clip = add_reverb(clip, sr)

    # Rapid fade-out — squared curve drops quickly to remove breathy tail.
    fade_start = min(int(FADE_OUT_START_MS * sr / 1000), len(clip) - 1)
    fade_len   = len(clip) - fade_start
    t          = np.linspace(0.0, 1.0, fade_len)
    clip[fade_start:] *= (1.0 - t) ** 2

    return clip, onset_offset_ms


def encode_mp3(wav_path: Path, mp3_path: Path) -> None:
    comp = (
        f'acompressor=threshold={COMP_THRESHOLD}'
        f':ratio={COMP_RATIO}'
        f':attack={COMP_ATTACK}'
        f':release={COMP_RELEASE}'
    )
    subprocess.run(
        ['ffmpeg', '-y', '-i', str(wav_path), '-af', comp, '-b:a', '64k', str(mp3_path)],
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

    stem_to_syllable: dict[Path, str] = {}
    for f in wav_files:
        stem = f.stem.lower()
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
            if TEST_SYLLABLE and syllable != TEST_SYLLABLE:
                continue

            y, sr = librosa.load(str(path), sr=None, mono=True)

            offsets = []
            for slot, midi in enumerate(MIDI_RANGE):
                clip, offset_ms = chop_clip(y, sr, slot, syllable)
                offsets.append(offset_ms)
                wav = tmp / f"{midi}_{syllable}.wav"
                sf.write(str(wav), clip, sr, subtype='PCM_16')
                encode_mp3(wav, OUTPUT_DIR / f"{midi}_{syllable}.mp3")

            print(f"  '{syllable}'  onset avg {np.mean(offsets):+.0f} ms from beat  "
                  f"(range {min(offsets):+.0f} … {max(offsets):+.0f})")

    write_ts_asset_map()
    print(f"\nDone. {len(MIDI_RANGE) * len(SYLLABLES)} solfège clips ready.")


if __name__ == '__main__':
    main()
