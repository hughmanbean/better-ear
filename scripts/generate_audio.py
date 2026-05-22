#!/usr/bin/env python3
"""Generate solfege syllable clips for the Banacos ear training app.

Produces 425 MP3s: 17 syllables × 25 chromatic pitches (MIDI 48–72, C3–C5).
Named {midi}_{syllable}.mp3 — e.g. 60_do.mp3, 57_la.mp3.

Pipeline per syllable:
  1. Piper TTS → raw WAV (cached in temp/)
  2. Praat PSOLA → flat pitch at A3, stretched to CLIP_DURATION → base WAV (cached in temp/)
  3. Rubberband pitch-shift → one MP3 per target MIDI note

Also emits app/src/audioAssets.ts with all 425 require() entries.

Run from the project root with the venv active:
  scripts/venv/bin/python3 scripts/generate_audio.py
"""

import io
import subprocess
import wave
from pathlib import Path

import numpy as np
import parselmouth
import soundfile as sf
from parselmouth.praat import call
from piper.download_voices import download_voice
from piper.voice import PiperVoice

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

VOICE_NAME   = "en_US-lessac-medium"
VOICES_DIR   = Path(__file__).parent / "voices"
TEMP_DIR     = Path(__file__).parent / "temp"
OUTPUT_DIR   = Path(__file__).parent.parent / "app" / "assets" / "audio"
TS_OUT       = Path(__file__).parent.parent / "app" / "src" / "audioAssets.ts"

REFERENCE_MIDI = 57        # A3 (220 Hz) — base pitch for TTS + PSOLA
MIDI_MIN       = 48        # C3
MIDI_MAX       = 72        # C5
CLIP_DURATION  = 1.2       # seconds
MP3_BITRATE    = "64k"

MIDI_RANGE = range(MIDI_MIN, MIDI_MAX + 1)  # 25 notes

# ---------------------------------------------------------------------------
# Syllable definitions
# ---------------------------------------------------------------------------

# Maps filename stem → TTS pronunciation string.
SYLLABLES: dict[str, str] = {
    # Diatonic
    "do":  "doe",
    "re":  "ray",
    "mi":  "mee",
    "fa":  "fah",
    "sol": "soe",
    "la":  "lah",
    "ti":  "tee",
    # Chromatic ascending (sharp names)
    "di":  "dee",
    "ri":  "ree",
    "fi":  "fee",
    "si":  "cee",
    "li":  "lee",
    # Chromatic descending (flat names)
    "ra":  "rah",
    "me":  "may",
    "se":  "sah",
    "le":  "lay",
    "te":  "tay",
}

# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------

def midi_to_hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69.0) / 12.0)


def synth_to_float(voice: PiperVoice, text: str) -> tuple[np.ndarray, int]:
    """Run piper TTS and return (float32 mono audio, sample_rate)."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_out:
        voice.synthesize_wav(text, wav_out)
    buf.seek(0)
    audio, sr = sf.read(buf, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return audio, sr


def flatten_and_sustain(src_wav: Path, out_wav: Path) -> None:
    """Flatten pitch to REFERENCE_MIDI via Praat PSOLA, then time-stretch to CLIP_DURATION.

    Scaling to 0.8 FS before PSOLA prevents resynthesis clipping.
    Points start at 62% of duration to land in the stable vowel nucleus,
    avoiding the C-V transition bump on consonants like m/l/f/d.
    """
    target_hz = midi_to_hz(REFERENCE_MIDI)

    sound = parselmouth.Sound(str(src_wav))
    call(sound, "Scale peak", 0.8)

    manip = call(sound, "To Manipulation", 0.01, 75.0, 600.0)

    pitch_tier = call(manip, "Extract pitch tier")
    call(pitch_tier, "Remove points between", 0.0, sound.duration)
    for t in np.linspace(0.62 * sound.duration, 0.95 * sound.duration, 30):
        call(pitch_tier, "Add point", float(t), target_hz)
    call([manip, pitch_tier], "Replace pitch tier")

    flat = call(manip, "Get resynthesis (overlap-add)")
    call(flat, "Scale peak", 0.95)

    flat_wav = out_wav.with_suffix(".flat.wav")
    flat.save(str(flat_wav), "WAV")

    tempo_ratio = sound.duration / CLIP_DURATION
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(flat_wav),
            "-af", (
                f"rubberband=tempo={tempo_ratio:.6f},"
                f"afade=t=in:st=0:d=0.01,"
                f"afade=t=out:st={CLIP_DURATION - 0.03:.3f}:d=0.03"
            ),
            str(out_wav),
        ],
        check=True,
        capture_output=True,
    )
    flat_wav.unlink()


def pitch_shift_and_encode(base_wav: Path, midi: int, out_path: Path) -> None:
    """Pitch-shift base WAV (at REFERENCE_MIDI) to target midi and encode as MP3."""
    ratio = midi_to_hz(midi) / midi_to_hz(REFERENCE_MIDI)
    if abs(ratio - 1.0) < 1e-6:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(base_wav), "-b:a", MP3_BITRATE, str(out_path)],
            check=True, capture_output=True,
        )
    else:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", str(base_wav),
                "-af", f"rubberband=pitch={ratio:.6f}",
                "-b:a", MP3_BITRATE,
                str(out_path),
            ],
            check=True,
            capture_output=True,
        )


def write_ts_asset_map(syllables: list[str], midi_range: range, out_path: Path) -> None:
    """Emit a TypeScript module with a require() entry for every clip."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "// AUTO-GENERATED by scripts/generate_audio.py — do not edit",
        "",
        "const AUDIO_ASSETS: Record<string, number> = {",
    ]
    for midi in midi_range:
        for syllable in syllables:
            key = f"{midi}_{syllable}"
            lines.append(f"  '{key}': require('../assets/audio/{key}.mp3'),")
    lines += ["};", "", "export default AUDIO_ASSETS;", ""]
    out_path.write_text("\n".join(lines))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    model_path = VOICES_DIR / f"{VOICE_NAME}.onnx"
    if not model_path.exists():
        print(f"Downloading voice model: {VOICE_NAME} …")
        download_voice(VOICE_NAME, VOICES_DIR)

    print("Loading voice model …")
    voice = PiperVoice.load(str(model_path))

    syllable_list = list(SYLLABLES.keys())
    total = len(syllable_list) * len(MIDI_RANGE)
    print(f"\nGenerating {total} clips ({len(syllable_list)} syllables × {len(MIDI_RANGE)} pitches) → {OUTPUT_DIR}\n")

    for syllable, tts_text in SYLLABLES.items():
        # --- 1. Raw TTS (cached) ---
        raw_cache = TEMP_DIR / f"raw_{syllable}.wav"
        if not raw_cache.exists():
            print(f"  [{syllable:4s}]  synthesising {tts_text!r} …")
            audio, sr = synth_to_float(voice, tts_text)
            threshold = 10 ** (-25 / 20)
            mask = np.abs(audio) > threshold
            if mask.any():
                audio = audio[mask.argmax(): len(mask) - mask[::-1].argmax()]
            sf.write(str(raw_cache), audio, sr)

        # --- 2. PSOLA flatten + stretch to CLIP_DURATION at REFERENCE_MIDI (cached) ---
        base_wav = TEMP_DIR / f"base_{syllable}.wav"
        if not base_wav.exists():
            print(f"  [{syllable:4s}]  flattening pitch → {midi_to_hz(REFERENCE_MIDI):.1f} Hz …")
            flatten_and_sustain(raw_cache, base_wav)

        # --- 3. Pitch-shift to every MIDI note in range ---
        print(f"  [{syllable:4s}]  encoding {len(MIDI_RANGE)} pitches …")
        for midi in MIDI_RANGE:
            out_path = OUTPUT_DIR / f"{midi}_{syllable}.mp3"
            pitch_shift_and_encode(base_wav, midi, out_path)

    # Remove old flat-named clips from the previous naming scheme
    for old in OUTPUT_DIR.glob("*.mp3"):
        if "_" not in old.stem:
            old.unlink()

    # --- 4. Emit TypeScript asset map ---
    write_ts_asset_map(syllable_list, MIDI_RANGE, TS_OUT)
    print(f"\nTypeScript asset map → {TS_OUT}")
    print(f"Done. {total} clips written to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
