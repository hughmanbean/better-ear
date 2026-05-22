"""
Soft synthetic wood block for UI tap feedback.

Anatomy:
  0–3 ms    : fast attack ramp
  0–120 ms  : inharmonic tonal resonances (wood body)
  0–60 ms   : band-filtered noise knock (the 'thock' transient)

Tuned around 580 Hz — warm, mid-range, not sharp or harsh.
"""

import numpy as np
from scipy.signal import butter, sosfilt
import soundfile as sf
import os

SR   = 44100
DUR  = 0.14   # 140 ms — short enough to not feel laggy
PEAK = 0.22

n   = int(DUR * SR)
t   = np.arange(n) / SR
rng = np.random.default_rng(7)

# Short linear attack to avoid a hard click
atk = int(0.003 * SR)
env_shape = np.ones(n)
env_shape[:atk] = np.linspace(0.0, 1.0, atk)

# ---------------------------------------------------------------------------
# Tonal body — slightly inharmonic partials for wood character
# ---------------------------------------------------------------------------
f0 = 580  # Hz  (warm mid-range wood block pitch)
PARTIALS = [
    #  freq          amp   decay (1/s)
    (f0,             1.00, 20.0),   # fundamental
    (f0 * 1.53,      0.32, 28.0),   # inharmonic 2nd
    (f0 * 2.38,      0.12, 42.0),   # inharmonic 3rd
]
tonal = sum(
    amp * np.exp(-decay * t) * np.sin(2 * np.pi * freq * t)
    for freq, amp, decay in PARTIALS
)

# ---------------------------------------------------------------------------
# Knock transient — short band-noise burst, the percussive 'thock'
# ---------------------------------------------------------------------------
noise     = rng.standard_normal(n)
sos_knock = butter(3, [220, 2200], btype='bandpass', fs=SR, output='sos')
knock     = sosfilt(sos_knock, noise) * np.exp(-70.0 * t) * 0.45

# ---------------------------------------------------------------------------
# Mix, shape, normalise
# ---------------------------------------------------------------------------
audio = (tonal + knock) * env_shape
audio = (audio / np.max(np.abs(audio)) * PEAK).astype(np.float32)

out = os.path.join(os.path.dirname(__file__), '../app/assets/audio/metro_click.wav')
sf.write(out, audio, SR, subtype='FLOAT')
print(f"Written {out}  peak={np.max(np.abs(audio)):.4f}  dur={DUR*1000:.0f} ms")
