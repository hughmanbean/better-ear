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
RAW_DIR     = OUTPUT_DIR / 'raw'   # unprocessed clips for manual trim selection
TS_OUT      = Path(__file__).parent.parent / 'app' / 'src' / 'audioAssets.ts'

BPM            = 80
BEATS_PER_SLOT = 2
SLOT_MS        = int(60_000 / BPM * BEATS_PER_SLOT)   # 1500 ms

MIDI_MIN   = 45
MIDI_MAX   = 80
MIDI_RANGE = range(MIDI_MIN, MIDI_MAX + 1)

# How far before the detected onset we place the source cut.
# Large window gives the S-curve room to attenuate bleed from the previous note,
# and gives the `,`/`.` knob in test_syllable_timing.py room for manual trimming.
# Pairs with SYLLABLE_TARGET_LEAD_MS (all values = old_value + PRE_ONSET_MS) and
# SOLFEGE_LEAD_MS in AudioEngine/tester (= old_SOLFEGE_LEAD + PRE_ONSET_MS).
PRE_ONSET_MS = 200

# Silence prepended so the onset lands this far into the clip.
# With the onset detector working correctly and AudioEngine SOLFEGE_LEAD_MS=100ms
# handling the vowel-attack offset, no additional silence is needed here.
# Fine-tune per syllable via SYLLABLE_TARGET_LEAD_MS if anything drifts.
CHOP_LEAD_MS = 0

# Onset detection search window around the slot boundary.
ONSET_SEARCH_PRE_MS  = 250   # ms before slot boundary to start searching
ONSET_SEARCH_POST_MS = 400   # ms after  slot boundary to stop searching
# Onset = first RMS frame exceeding this fraction of the local peak.
ONSET_THRESHOLD = 0.12
# Detections further than this from the slot boundary are discarded as
# false positives (reverb tail from previous slot, near-silence, etc.).
ONSET_MAX_DEVIATION_MS = 300

# Per-syllable onset shift (ms). Added to the raw detected onset so the cut
# lands closer to the vowel for phonemes where energy builds gradually before
# the vowel arrives. Stop consonants (d, t) need little or no adjustment.
# Tune each value if that syllable still sounds ahead or behind the beat.
#
#  Nasals  (m):   detector fires on gradual nasal build-up, vowel is much later
#  Fricatives (f, s): hiss precedes the vowel by a significant gap
#  Liquids (r, l): softer onset, smaller gap than nasals/fricatives
SYLLABLE_ONSET_ADJUST_MS: dict[str, float] = {
    # Add per-syllable overrides here only if the detector consistently fires
    # on the wrong point (e.g. a bleed tail from the previous slot).
    # Use test_syllable_timing.py to identify outliers.
}

# Per-syllable target position of the onset anchor within the output clip (ms from clip start).
# The silence prepend is sized to place the detected (and ONSET_ADJUST-shifted) anchor here.
#
# Timing identity (AudioEngine SOLFEGE_LEAD_MS=300ms):
#   onset sounds at:  beat_time - 300ms + TARGET_LEAD_MS
#
#   TARGET_LEAD_MS = 300 → anchor lands exactly on the beat
#   TARGET_LEAD_MS = 280 → anchor fires 20ms before the beat
#
# All values = (original calibrated value) + 200ms to account for PRE_ONSET_MS=200ms.
# Raise a value → syllable perceived later  (closer to beat)
# Lower a value → syllable perceived earlier (further ahead of beat)
SYLLABLE_TARGET_LEAD_MS: dict[str, float] = {
    # All values = original + 200ms (do calibration) + 200ms (SOLFEGE_LEAD_MS 300→500)
    # DiffSinger perceptual onset lags physical onset by ~200ms universally.
    'do':  480,
    're':  480,
    'mi':  440,
    'fa':  480,
    'sol': 480,
    'la':  400,
    'ti':  420,
    'di':  440,
    'ri':  440,
    'fi':  460,
    'si':  420,
    'li':  440,
    'ra':  440,
    'me':  420,
    'se':  440,
    'le':  460,
    'te':  440,
}

# Per-syllable override for how far before the onset anchor the source is cut.
# Fricatives like 'f' have a long consonant ramp before the vowel anchor —
# cutting further back captures that ramp-up. Grow alongside ONSET_ADJUST
# so the cut still lands before the consonant starts.
SYLLABLE_PRE_ONSET_MS: dict[str, float] = {
    # Per-syllable overrides (ms before onset to cut).  Leave empty to use the
    # global PRE_ONSET_MS = 200ms for all syllables.
}

# Per-note manual trim values (ms) from the raw-pass tester.
# Each value moves the processed cut CLOSER to the onset by that amount:
#   processed cut at  onset - (PRE_ONSET_MS - value)
# Paste the table printed by test_syllable_timing.py --raw here, then re-chop.
_DO_TRIMS: dict[int, float] = {
    45: 120, 46: 210, 47: 140, 48: 180, 49: 20, 50: 20, 51: 140, 52: 190,
    53: 20, 54: 180, 55: 20, 56: 110, 57: 20, 58: 20, 59: 20, 60: 150,
    61: 160, 62: 170, 63: 110, 64: 140, 65: 80, 66: 200, 67: 20, 68: 160,
    69: 120, 70: 20, 71: 120, 72: 100, 73: 20, 74: 120, 75: 110, 76: 120,
    77: 100, 78: 120, 79: 100, 80: 100,
}

SYLLABLE_PER_NOTE_SILENCE_MS: dict[str, dict[int, float]] = {
    # 'do' values are manually calibrated; all others seeded from 'do' as a
    # first-pass estimate (artefact decay is pitch-dependent, not phoneme-dependent).
    s: dict(_DO_TRIMS) for s in [
        'do', 're', 'mi', 'fa', 'sol', 'la', 'ti',
        'di', 'ri', 'fi', 'si', 'li',
        'ra', 'me', 'se', 'le', 'te',
    ]
}

# Per-syllable onset floor: the maximum number of ms BEFORE the slot boundary
# that a detected onset is allowed to sit. Detections earlier than this are
# rejected and fall back to the slot boundary itself.
#
# Use this when the detector consistently fires on the previous slot's reverb
# tail for a syllable. Stop consonants (d, t, b) can't start more than ~50ms
# before the slot boundary, so any detection earlier is almost certainly bleed.
#
# Identified via test_syllable_timing.py: notes flagged both ⟳ and ⚠ on the
# same syllable strongly indicate a reverb-tail false positive.
SYLLABLE_ONSET_FLOOR_MS: dict[str, float] = {
    'do': 80,   # 'd' burst can't precede the slot by more than 80ms
}

# After the main chop, re-check where the onset actually landed in the clip
# and add silence if it sits earlier than SYLLABLE_TARGET_LEAD_MS. This
# corrects per-note DiffSinger inconsistency without ever trimming (which
# risks cutting a consonant). The headroom gives a small safety margin so the
# onset never sits right at the target boundary.
NORMALIZATION_HEADROOM_MS = 20

# Per-clip peak normalisation.
NORMALIZE_TARGET = 0.78
NORMALIZE_FLOOR  = 0.02

# Length of the S-curve ramp immediately before the onset (ms).
# Everything before the ramp is hard-silenced, so artefacts more than
# FADE_IN_MS from the onset are wiped completely regardless of trim values.
# 40ms preserves consonant attacks while eliminating distant bleed.
FADE_IN_MS = 40

# Per-syllable override if a shorter or longer ramp is needed.
SYLLABLE_FADE_IN_MS: dict[str, float] = {}

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

# Fade-out: starts this many ms AFTER the onset_idx and reaches zero at the end.
# 0 = fade begins exactly at the onset. A squared curve drops quickly to cut
# the breathy tail. Keeping this onset-relative prevents the fade from starting
# before the note when target_lead_ms is large (e.g. 'do' at 480ms).
FADE_OUT_AFTER_ONSET_MS = 0

# Soft reverb — subtle room with LP damping to avoid metallic shimmer.
REVERB_DECAY_S    = 0.20
REVERB_WET        = 0.08
REVERB_SEED       = 42
REVERB_HP_HZ      = 200    # remove very low rumble from IR
REVERB_LP_HZ      = 6000   # damp high-freq tail (eliminates metallic ring)
REVERB_PRE_DELAY_MS = 12   # ms of silence before reverb tail starts
# Reverb is only applied from this far before the detected onset onward.
# The pre-onset silence (and any residual bleed) stays completely dry,
# so artefacts before the note are never smeared by the convolution.
REVERB_ONSET_LEAD_MS = 20

# Set to a syllable name (e.g. 'mi') to process only that syllable.
TEST_SYLLABLE: str | None = None

# When True: measure onset corrections across all syllables without writing
# any files. Prints the worst-case correction so you can set
# NORMALIZATION_HEADROOM_MS to cover it. Set NORMALIZATION_HEADROOM_MS = 0
# before running so the measured corrections are unaffected by the headroom.
DRY_RUN: bool = False

# When True: output unprocessed WAV clips to RAW_DIR for manual trim selection.
# No S-curve, no reverb, no compression — raw audio with onset at the same beat
# position as the processed clips so the metronome reference is meaningful.
# After using test_syllable_timing.py --raw to select per-note start points,
# paste the printed SYLLABLE_PER_NOTE_SILENCE_MS table here and re-run with
# RAW_PASS = False to produce the final processed clips.
RAW_PASS: bool = False

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


def find_valley_before_onset(
    y: np.ndarray, sr: int, onset_sample: int,
    search_back_ms: float, min_gap_ms: float = 5.0,
) -> int:
    """
    Find the quietest region in the audio immediately before the onset.

    Scans from (onset - search_back_ms) to (onset - min_gap_ms) using
    short-time RMS and returns the start of the quietest frame. This is the
    natural valley between the previous note's tail and the new note — the
    cleanest possible cut point regardless of reverb characteristics.

    Falls back to (onset - min_gap_ms) if the region is too short.
    """
    back_samp    = int(search_back_ms * sr / 1000)
    gap_samp     = int(min_gap_ms    * sr / 1000)
    search_start = max(0, onset_sample - back_samp)
    search_end   = max(search_start + 1, onset_sample - gap_samp)

    region    = y[search_start:search_end]
    frame_len = max(2, int(0.005 * sr))   # 5 ms frames
    hop_len   = max(1, int(0.002 * sr))   # 2 ms hop

    if len(region) < frame_len:
        return search_start  # not enough data — cut at the farthest-back position

    frames  = librosa.util.frame(region, frame_length=frame_len, hop_length=hop_len)
    rms     = np.sqrt(np.mean(frames ** 2, axis=0))
    min_idx = int(np.argmin(rms))
    return search_start + min_idx * hop_len

# ---------------------------------------------------------------------------
# Reverb
# ---------------------------------------------------------------------------

def _build_reverb_ir(sr: int) -> np.ndarray:
    ir_len = int(REVERB_DECAY_S * sr)
    t_ir   = np.arange(ir_len) / sr
    rng    = np.random.default_rng(REVERB_SEED)
    ir     = rng.standard_normal(ir_len) * np.exp(-(6.0 / REVERB_DECAY_S) * t_ir)
    sos_hp = butter(2, REVERB_HP_HZ, btype='highpass', fs=sr, output='sos')
    ir     = sosfilt(sos_hp, ir)
    sos_lp = butter(2, REVERB_LP_HZ, btype='lowpass',  fs=sr, output='sos')
    ir     = sosfilt(sos_lp, ir)
    ir    /= np.max(np.abs(ir)) + 1e-9
    pre    = np.zeros(int(REVERB_PRE_DELAY_MS * sr / 1000))
    return np.concatenate([pre, ir])


_ir_cache: dict[int, np.ndarray] = {}

def add_reverb(y: np.ndarray, sr: int) -> np.ndarray:
    if sr not in _ir_cache:
        _ir_cache[sr] = _build_reverb_ir(sr)
    ir  = _ir_cache[sr]
    wet = fftconvolve(y, ir)
    wet = wet[:len(y)]   # truncate convolution tail to clip length
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
      4. Prepend silence so onset lands at SYLLABLE_TARGET_LEAD_MS
      5. Per-note normalisation: add silence if onset landed early (never trim)
      6. Transient boost, normalise, reverb, fade-out tail

    Returns (clip, onset_offset_ms) where onset_offset_ms is the detected
    onset position relative to the slot boundary in the source file.
    """
    slot_samples   = int(SLOT_MS * sr / 1000)
    pre_ms         = SYLLABLE_PRE_ONSET_MS.get(syllable, PRE_ONSET_MS)
    target_lead_ms = SYLLABLE_TARGET_LEAD_MS.get(syllable, CHOP_LEAD_MS)

    # 1. Detect onset in source, then apply per-syllable phoneme adjustment.
    onset_sample = find_onset_sample(y, sr, slot)
    slot_start   = int(slot * SLOT_MS * sr / 1000)

    # Reject detections that precede the slot boundary by more than the allowed
    # floor for this syllable. Detections earlier than the floor are almost
    # certainly the previous slot's reverb tail; fall back to slot_start.
    floor_ms = SYLLABLE_ONSET_FLOOR_MS.get(syllable)
    if floor_ms is not None:
        floor_samp = slot_start - int(floor_ms * sr / 1000)
        if onset_sample < floor_samp:
            onset_sample = slot_start

    adjust_samp  = int(SYLLABLE_ONSET_ADJUST_MS.get(syllable, 0) * sr / 1000)
    onset_sample = min(onset_sample + adjust_samp,
                       slot_start + int(ONSET_SEARCH_POST_MS * sr / 1000))
    onset_offset_ms = (onset_sample - slot_start) * 1000.0 / sr

    # 2. Determine cut position.
    #    Per-note trim offset (from raw-pass tester) moves the cut closer to the
    #    onset — a value of 150ms means cut 50ms before onset instead of 200ms.
    #    With target_lead_ms >= pre_ms, the silence_samp formula always compensates
    #    so the onset lands at the same beat position regardless of trim value.
    midi = MIDI_MIN + slot
    trim_ms   = SYLLABLE_PER_NOTE_SILENCE_MS.get(syllable, {}).get(midi, 0.0)
    cut_pre_ms = max(5.0, pre_ms - trim_ms)   # never cut closer than 5ms
    cut_start  = max(0, onset_sample - int(cut_pre_ms * sr / 1000))
    actual_pre = onset_sample - cut_start

    if RAW_PASS:
        # Raw pass: position onset identically to processed pass (same beat timing)
        # but apply zero processing so bleed is clearly audible for trim selection.
        target_norm_samp_raw = int((target_lead_ms + NORMALIZATION_HEADROOM_MS) * sr / 1000)
        silence_samp = max(0, target_norm_samp_raw - actual_pre)
        audio_samp   = slot_samples - silence_samp
        audio = y[cut_start : min(cut_start + audio_samp, len(y))].copy()
        if len(audio) < audio_samp:
            audio = np.pad(audio, (0, audio_samp - len(audio)))
        clip = np.concatenate([np.zeros(silence_samp, dtype=audio.dtype), audio])
        clip = clip[:slot_samples]
        if len(clip) < slot_samples:
            clip = np.pad(clip, (0, slot_samples - len(clip)))
        return clip, onset_offset_ms, 0.0

    silence_samp = max(0, int(target_lead_ms * sr / 1000) - actual_pre)
    audio_samp   = slot_samples - silence_samp

    audio = y[cut_start : min(cut_start + audio_samp, len(y))].copy()
    if len(audio) < audio_samp:
        audio = np.pad(audio, (0, audio_samp - len(audio)))

    # 3. Hard-silence everything before a short S-curve ramp into the onset.
    #    Artefacts (previous-note bleed) further than ramp_ms from the onset
    #    are wiped; only the final ramp_ms fades in naturally.
    ramp_ms   = SYLLABLE_FADE_IN_MS.get(syllable, FADE_IN_MS)
    ramp_samp = min(int(ramp_ms * sr / 1000), actual_pre, len(audio))
    if actual_pre > ramp_samp:
        audio[:actual_pre - ramp_samp] = 0.0
    if ramp_samp > 0:
        t = np.arange(ramp_samp)
        audio[actual_pre - ramp_samp:actual_pre] *= 0.5 * (1.0 - np.cos(np.pi * t / ramp_samp))

    # 4. Prepend silence so onset sits at target_lead_ms into the clip.
    silence = np.zeros(silence_samp, dtype=audio.dtype)
    clip    = np.concatenate([silence, audio])

    # Guarantee exact SLOT_MS length.
    clip = clip[:slot_samples]
    if len(clip) < slot_samples:
        clip = np.pad(clip, (0, slot_samples - len(clip)))

    # 5. Per-note onset normalisation: if this clip's onset landed earlier than
    #    target + headroom (DiffSinger pitch-to-pitch inconsistency), prepend
    #    silence to push it to the target. Never trim — only extend.
    onset_idx        = silence_samp + actual_pre
    target_norm_samp = int((target_lead_ms + NORMALIZATION_HEADROOM_MS) * sr / 1000)
    correction_ms    = 0.0
    if onset_idx < target_norm_samp:
        extra         = target_norm_samp - onset_idx
        correction_ms = extra * 1000.0 / sr
        clip          = np.concatenate([np.zeros(extra, dtype=clip.dtype), clip])
        clip          = clip[:slot_samples]
        if len(clip) < slot_samples:
            clip      = np.pad(clip, (0, slot_samples - len(clip)))
        onset_idx     = target_norm_samp

    # 6. Transient boost at the onset — sharpens rhythmic snap.
    t_end = min(onset_idx + int(TRANSIENT_MS * sr / 1000), len(clip))
    if t_end > onset_idx:
        env = np.linspace(TRANSIENT_BOOST_DB, 0.0, t_end - onset_idx)
        clip[onset_idx:t_end] *= 10.0 ** (env / 20.0)

    # 6. Normalise (after boost so the boosted onset sets the peak).
    peak = np.max(np.abs(clip))
    if peak >= NORMALIZE_FLOOR:
        clip *= NORMALIZE_TARGET / peak

    # Reverb from just before the onset — keeps pre-onset silence/bleed dry.
    reverb_start = max(0, onset_idx - int(REVERB_ONSET_LEAD_MS * sr / 1000))
    reverbed_tail = add_reverb(clip[reverb_start:], sr)
    clip = np.concatenate([clip[:reverb_start], reverbed_tail])

    # Rapid fade-out — squared curve drops quickly to remove breathy tail.
    fade_start = min(onset_idx + int(FADE_OUT_AFTER_ONSET_MS * sr / 1000), len(clip) - 1)
    fade_len   = len(clip) - fade_start
    t          = np.linspace(0.0, 1.0, fade_len)
    clip[fade_start:] *= (1.0 - t) ** 2

    return clip, onset_offset_ms, correction_ms


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
    out_dir = RAW_DIR if RAW_PASS else OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

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

    if DRY_RUN:
        print("DRY RUN — measuring onset corrections only, no files written.")
        print(f"NORMALIZATION_HEADROOM_MS is currently {NORMALIZATION_HEADROOM_MS}ms "
              f"(set to 0 for an unbiased measurement)\n")

    all_corrections: list[float] = []

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

            offsets      = []
            corrections  = []
            for slot, midi in enumerate(MIDI_RANGE):
                clip, offset_ms, corr_ms = chop_clip(y, sr, slot, syllable)
                offsets.append(offset_ms)
                corrections.append(corr_ms)
                if not DRY_RUN:
                    wav = tmp / f"{midi}_{syllable}.wav"
                    sf.write(str(wav), clip, sr, subtype='PCM_16')
                    if RAW_PASS:
                        # Raw pass: keep as WAV (no lossy compression so bleed is audible)
                        import shutil
                        shutil.copy(str(wav), str(out_dir / f"{midi}_{syllable}.wav"))
                    else:
                        encode_mp3(wav, out_dir / f"{midi}_{syllable}.mp3")

            all_corrections.extend(corrections)
            tgt      = SYLLABLE_TARGET_LEAD_MS.get(syllable, CHOP_LEAD_MS)
            corr_max = max(corrections)
            corr_n   = sum(1 for c in corrections if c > 0)
            corr_str = (f"  corrected {corr_n}/{len(corrections)} notes  max={corr_max:.0f}ms"
                        if corr_n else "  no corrections needed")
            print(f"  '{syllable}'  onset avg {np.mean(offsets):+.0f} ms from beat  "
                  f"(range {min(offsets):+.0f} … {max(offsets):+.0f})  "
                  f"target={tgt:.0f}ms{corr_str}")

    if DRY_RUN:
        worst = max(all_corrections) if all_corrections else 0
        print(f"\n{'─'*55}")
        print(f"Worst-case correction across all syllables: {worst:.0f}ms")
        print(f"→  Set NORMALIZATION_HEADROOM_MS = {int(np.ceil(worst / 5) * 5):.0f}  "
              f"(rounded up to nearest 5ms)")
        print(f"   Then set DRY_RUN = False and re-run to encode.")
        return

    write_ts_asset_map()
    print(f"\nDone. {len(MIDI_RANGE) * len(SYLLABLES)} solfège clips ready.")


if __name__ == '__main__':
    main()
