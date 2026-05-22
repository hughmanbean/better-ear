"""
Synthetic ride cymbal — noise-dominant, brief FM ping.

Real ride cymbal anatomy:
  0–30 ms   : bright transient (stick impact, broad noise burst)
  0–150 ms  : short inharmonic ring ('ping') — quickly fades
  0–400 ms  : sustained noise wash ('shhhh') — main character after attack

Previous version sustained the FM ring too long → 'metallic pipe'.
Fix: FM envelope decays in ~120 ms; noise wash is the dominant tail.
FM beta also lowered (fewer sidebands = less clangy).
"""

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import soundfile as sf
import os

SR   = 44100
DUR  = 0.40
PEAK = 0.12

n   = int(DUR * SR)
t   = np.arange(n) / SR
rng = np.random.default_rng(31)

# ---------------------------------------------------------------------------
# FM pairs — irrational ratios, but SHORT envelope and LOW beta
# The ping dies out in ~120–200 ms; it flavours the attack, not the tail.
# ---------------------------------------------------------------------------
def fm(fc, ratio, beta0, amp, env_decay, beta_decay):
    env  = amp   * np.exp(-env_decay  * t)
    beta = beta0 * np.exp(-beta_decay * t)
    return env * np.sin(2*np.pi*fc*t + beta * np.sin(2*np.pi*fc*ratio*t))

#         fc    ratio              beta0  amp   env_τ  β_τ
PAIRS = [
    ( 440, np.sqrt(2),            2.5,  0.40,  30.0,  16.0 ),
    ( 440, 2**(1/3),              2.2,  0.30,  38.0,  18.0 ),
    ( 440, np.sqrt(3),            2.0,  0.20,  46.0,  20.0 ),
    ( 880, np.sqrt(2),            1.8,  0.12,  55.0,  22.0 ),
]
bell = sum(fm(*p) for p in PAIRS)

# ---------------------------------------------------------------------------
# Noise wash — dominant sustained component, three overlapping bands
# ---------------------------------------------------------------------------
def band_noise(lo, hi, amp, decay):
    x   = rng.standard_normal(n)
    sos = butter(3, [lo, hi], btype='bandpass', fs=SR, output='sos')
    return sosfilt(sos, x) * np.exp(-decay * t) * amp

# ting — very bright short burst, the top-end 'ping' character
ting       = band_noise(7000, min(16000, SR//2-1), 0.65, 28.0)
# mid shimmer — reduced, fast decay so wash doesn't linger
shimmer_lo = band_noise(2000,  6000, 0.18, 14.0)
# high shimmer — present but not dominant
shimmer_hi = band_noise(5500, 11000, 0.22, 16.0)

# ---------------------------------------------------------------------------
# Attack transient — very short broadband burst
# ---------------------------------------------------------------------------
atk_noise  = rng.standard_normal(n)
sos_atk    = butter(3, [4000, min(16000, SR//2 - 1)], btype='bandpass', fs=SR, output='sos')
attack     = sosfilt(sos_atk, atk_noise) * np.exp(-80.0 * t) * 0.35

# ---------------------------------------------------------------------------
# Dry mix — ting carries the top end, shimmer is supporting, bell gives ping
# ---------------------------------------------------------------------------
dry = bell + ting + shimmer_lo + shimmer_hi + attack
dry[:int(0.002 * SR)] *= np.linspace(0.0, 1.0, int(0.002 * SR))

# ---------------------------------------------------------------------------
# Bright plate reverb
# ---------------------------------------------------------------------------
ir_len = int(1.0 * SR)
t_ir   = np.arange(ir_len) / SR
ir     = rng.standard_normal(ir_len) * np.exp(-5.0 * t_ir)
sos_hp = butter(2, 1000, btype='highpass', fs=SR, output='sos')
ir     = sosfilt(sos_hp, ir)
ir    /= np.max(np.abs(ir))

wet   = fftconvolve(dry, ir)[:n]
audio = 0.60 * dry + 0.40 * wet

# ---------------------------------------------------------------------------
# Normalise
# ---------------------------------------------------------------------------
audio = (audio / np.max(np.abs(audio)) * PEAK).astype(np.float32)

out = os.path.join(os.path.dirname(__file__), '../app/assets/audio/ride_tick.wav')
sf.write(out, audio, SR, subtype='FLOAT')
print(f"Written {out}  peak={np.max(np.abs(audio)):.4f}  dur={DUR*1000:.0f}ms")
