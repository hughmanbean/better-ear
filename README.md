# Better Ear

A hands-free solfège ear training app for Android based on the Banacos method (moveable-do). Play a mystery note, identify it by syllable — the app sings the answer back to you in context.

Free to use for anyone who can benefit from it.

---

## Install

Download the latest APK and install it on your Android phone. Enable **"Install from unknown sources"** when prompted.

---

## Build from source

### Prerequisites
- Node.js 18+
- Python 3.10+
- Android SDK command-line tools (for building APK)

### App
```
cd app
npm install
node_modules/.bin/expo prebuild --platform android
node_modules/.bin/expo run:android --variant release
```

### Regenerate audio assets

**Piano samples** (requires FluidSynth and SalC5Light2.sf2):
```
cd scripts
python3 -m venv venv && venv/bin/pip install -r requirements.txt
venv/bin/python generate_piano.py
```

**Cadences:**
```
node scripts/generate_cadences.js
```

**Solfège samples** — place per-syllable WAV files in `New/` named `<syllable>_samples_new.wav`
at 80 BPM, 2 beats per slot, MIDI 45–79 (35 notes), then:
```
cd scripts && venv/bin/python chop_vocoder.py
```

**Metronome click / UI sounds:**
```
cd scripts
venv/bin/python generate_ui_tick.py   # metro_click.wav
```

---

## Credits

Voice samples rendered from the **Raine Reizo** DiffSinger voicebank by **suyu (UtauReizo)**,
used for non-commercial purposes in accordance with the terms of use.
- Voice bank: https://rainerr.weebly.com/

Piano samples use the **Salamander Grand Piano** SoundFont (SalC5Light2.sf2)
by Alexander Holm, licensed under CC BY 3.0.

---

## Licence

MIT — free to use, modify, and distribute.
Note: the Raine Reizo voice bank is non-commercial. This app may not be sold.
