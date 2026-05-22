#!/usr/bin/env python3
"""Generate a truly seamless Shepard tone loop — staggered Hanning construction.

Each partial uses a Hanning amplitude envelope (zero at both ends) and starts
its sweep CYCLE/N seconds after the previous one.  This guarantees:

  1. The total signal at t=CYCLE equals the signal at t=0 (proven below).
  2. Each partial's waveform value AND first derivative are zero at its seam.
  3. The total amplitude is constant at N/2 for all t — no bumps anywhere.

Proof of seamlessness:
  Partial i has sweep-phase tau_i(t) = ((t − i·CYCLE/N) / CYCLE) mod 1.
  At t=0,    partial i has tau_i = (1 − i/N) mod 1.
  At t=CYCLE, partial i has tau_i = (1 − i/N) mod 1.  ← identical state.
  Therefore S(0) = S(CYCLE) exactly.

Outputs shepard_rise.wav to app/assets/audio/.
Required directly in SetupScreen — does not rewrite audioAssets.ts.

Run from the project root:
  scripts/venv/bin/python3 scripts/generate_shepard.py
"""

import math
from pathlib import Path

import numpy as np
import soundfile as sf

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OUTPUT_DIR  = Path(__file__).parent.parent / "app" / "assets" / "audio"

SR          = 44100
TARGET_SECS = 8.0      # desired loop length
N_PARTIALS  = 8
F_BASE      = 110.0    # A2 — lowest partial start frequency
PEAK_AMP    = 0.38

# Phase-continuous duration: CYCLE = _N * ln(2) / F_BASE
# Every partial's sine phase at t=CYCLE is an exact integer multiple of 2π,
# so sin(phase) = 0 at the seam — no waveform click.
_N        = round(TARGET_SECS * F_BASE / math.log(2))
CYCLE     = _N * math.log(2) / F_BASE   # ≈ 8.00 s


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def generate(cycle: float = CYCLE, sr: int = SR) -> np.ndarray:
    n     = int(cycle * sr)
    t     = np.arange(n) / sr
    audio = np.zeros(n, dtype=np.float64)

    for i in range(N_PARTIALS):
        t_i = i * cycle / N_PARTIALS  # stagger offset for this partial

        # Fractional sweep phase in [0, 1), wrapping periodically
        tau = ((t - t_i) / cycle) % 1.0

        # Hanning amplitude — zero at tau=0 and tau=1, peak at tau=0.5
        # H(0) = H(1) = 0 ensures zero amplitude at seam; H'(0) = H'(1) = 0
        # ensures the amplitude change rate is also zero there.
        amp = 0.5 * (1.0 - np.cos(2.0 * np.pi * tau))

        # Analytical sine phase: integral of 2π · F_BASE·2^(i+tau) dt
        # = 2π · F_BASE·2^i · CYCLE/ln2 · (2^tau − 1)
        # At tau=1: phase = 2π · _N · 2^i  (integer × 2π → sin = 0 at seam)
        phase = (2.0 * np.pi
                 * F_BASE * (2.0 ** i) * cycle / math.log(2)
                 * (2.0 ** tau - 1.0))

        audio += amp * np.sin(phase)

    peak = np.max(np.abs(audio))
    if peak > 1e-6:
        audio *= PEAK_AMP / peak

    # Cyclic FFT reverb — loop-safe because the reverb tail wraps back to
    # frame 0 rather than spilling past the file end.
    rng      = np.random.default_rng(seed=42)
    decay_s  = 3.0
    ir_len   = int(decay_s * sr)
    t_ir     = np.arange(ir_len) / sr
    ir       = rng.standard_normal(ir_len) * np.exp(-t_ir * 6.0 / decay_s)
    ir[0]    = 1.0
    ir      /= np.max(np.abs(ir))

    n        = len(audio)
    ir_pad   = np.zeros(n)
    ir_pad[:ir_len] = ir
    A        = np.fft.rfft(audio.astype(np.float64), n=n)
    IR       = np.fft.rfft(ir_pad, n=n)
    wet_sig  = np.fft.irfft(A * IR, n=n)

    wet      = 0.55
    mixed    = (1.0 - wet) * audio.astype(np.float64) + wet * wet_sig
    peak     = np.max(np.abs(mixed))
    if peak > 1e-6:
        mixed *= PEAK_AMP / peak
    audio    = mixed.astype(np.float32)

    # Find a slow zero crossing: minimise |audio[i]| + |audio[i-1]| so both
    # the start sample and the sample before it are near zero.  This keeps the
    # seam clean with no baked fade-in (the app volume-ramps on first load).
    score = np.abs(audio) + np.abs(np.roll(audio, 1))
    p     = int(np.argmin(score))
    audio = np.roll(audio, -p)

    # 5 ms fade-out at the tail only.  Brings audio[-1] cleanly to zero so
    # the loop crossfade is silent → silent with no audible dip in the body.
    fade_n = int(0.005 * sr)   # 220 samples @ 44100 Hz
    ramp   = np.linspace(1.0, 0.0, fade_n)
    audio[-fade_n:] *= ramp

    return audio


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Generating staggered-Hanning Shepard tone ({CYCLE:.3f}s, {N_PARTIALS} partials) …")

    audio   = generate()
    out_wav = OUTPUT_DIR / "shepard_rise.wav"
    sf.write(str(out_wav), audio, SR, subtype='FLOAT')

    kb = out_wav.stat().st_size / 1024
    print(f"  → {out_wav}  ({kb:.0f} KB, {len(audio)/SR:.3f}s)")
    print("  Total amplitude is constant = N/2 = 4.0 — no bumps by construction.")
    print(f"  Reverb: wet=0.55, room=3.0 s")
    print("Done.")


if __name__ == "__main__":
    main()
