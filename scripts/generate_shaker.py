"""
Generates a short shaker tick sound for UI selection feedback.
Burst of high-frequency filtered noise with fast attack and quick decay.
"""
import numpy as np
from scipy.signal import butter, sosfilt
import soundfile as sf
import os

SR      = 44100
DUR_S   = 0.07        # 70ms total
PEAK    = 0.18        # low volume — this is a UI tick
ATK_S   = 0.003       # 3ms attack
DEC_S   = 0.055       # 55ms decay
LO_HZ   = 3500        # bandpass low cutoff
HI_HZ   = 10000       # bandpass high cutoff

n = int(DUR_S * SR)

# White noise burst
rng = np.random.default_rng(7)
noise = rng.standard_normal(n)

# Bandpass: 3.5kHz – 10kHz (shaker register)
sos = butter(4, [LO_HZ, HI_HZ], btype='bandpass', fs=SR, output='sos')
filtered = sosfilt(sos, noise)

# Envelope: linear attack then exponential decay
atk_n = int(ATK_S * SR)
dec_n = n - atk_n
env = np.concatenate([
    np.linspace(0.0, 1.0, atk_n),
    np.exp(-np.linspace(0.0, 6.0, dec_n)),  # e^-6 ≈ 0.0025 at tail
])
audio = (filtered * env).astype(np.float32)

# Normalise then scale to PEAK
mx = np.max(np.abs(audio))
if mx > 0:
    audio = audio / mx * PEAK

out_path = os.path.join(os.path.dirname(__file__), '../app/assets/audio/ui_tick.wav')
sf.write(out_path, audio, SR, subtype='FLOAT')
print(f"Written: {out_path}  ({n} samples, peak={np.max(np.abs(audio)):.4f})")
