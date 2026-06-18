# Better Ear — Project Notes for Claude

## What this is
A moveable-do solfège ear-training app for Android. ALYS DiffSinger (Utau France) sings each
syllable; piano notes are synthesised from a Salamander soundfont. The app cycles through all 12
keys continuously, playing cadence → mystery note → sung verification → scalar path-to-tonic.

---

## Building the APK

Requires: Node.js, Java 17, Android SDK.

```bash
cd /mnt/Storage/My_Apps/Solfege/app

# 1. Install JS dependencies (if node_modules was deleted)
npm install

# 2. Bundle JS into Android assets
npx expo export --platform android

# 3. Build the release APK
./android/gradlew -p android assembleRelease

# Output:
# android/app/build/outputs/apk/release/app-release.apk
```

The release keystore lives outside the repo. If the keystore is missing, `assembleRelease` will
fail — check `android/app/build.gradle` for the signing config path.

To install directly to a connected device:
```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

---

## Audio pipeline — regenerating the 612 solfège MP3s

The MP3s are gitignored (too large to track). Regenerate from source WAVs:

```bash
cd /mnt/Storage/My_Apps/Solfege

# 1. Set up Python environment (once)
python3 -m venv scripts/venv
source scripts/venv/bin/activate
pip install -r scripts/requirements.txt

# 2. Process ALYS WAV recordings into timed MP3 clips
python3 scripts/chop_alys.py

# Output: app/assets/audio/{midi}_{syllable}.mp3 (612 files)
```

Source WAVs are in `New/` — they're gitignored (large binaries, irreplaceable).
If lost, they must be re-rendered in OpenUTAU using the ALYS DiffSinger Pâtisserie model pack.

### Key constants in chop_alys.py

| Constant | Value | Why |
|---|---|---|
| `PRE_ONSET_MS` | 550 | Onset of the sung note within the clip; must equal `SOLFEGE_LEAD_MS` in AudioEngine.ts |
| `CLIP_TAIL_MS` | 1200 | Silence/tail after the note ends |
| `NORMALIZE_TARGET` | 0.80 | Peak normalisation target (no compressor — it caused graininess) |
| `TARGET_RMS` | 0.18 | Per-note flat RMS EQ target — loud lower notes are reduced to this level |
| Fade curve | `0.5*(1+cos(πt))` | Cosine half-wave from halfway through CLIP_TAIL_MS; steeper breath cut than 1−t² |

### Source WAV quirk
`Se` syllable → source file is `do_samples_Sa.wav` (mapped in `SOURCE_MAP`).

---

## Key constants in AudioEngine.ts

| Constant | Value | Why |
|---|---|---|
| `SOLFEGE_LEAD_MS` | 550 | **Must equal PRE_ONSET_MS in chop_alys.py.** Fires the clip early so the sung peak lands on the beat. |
| `NOTE_UNLOAD_MS` | 1800 | Unloads ExoPlayer instance 50 ms after the 1750 ms clip ends. Tight to reduce simultaneous instances on Oppo. |
| `CADENCE_UNLOAD_MS` | 3500 | Cadence is ~3000 ms; 3500 ms gives margin and frees the instance sooner. |
| `PLAY_TIMEOUT_MS` | 300 | If playAsync() hangs past this, treat as ExoPlayer silent freeze and fire a fallback sound. |
| `NOTE_VOLUMES` | [0.096, 0.192, 0.32] | Three user volume levels for solfège clips (peak-normalised to 0.80). |
| `PRELOAD_LEAD_BEATS` | 1 | Load each note one beat (750 ms) before it plays — keeps ExoPlayer instances fresh on Oppo. |

---

## Oppo / ColorOS ExoPlayer constraints

Oppo ColorOS aggressively releases ExoPlayer instances. Several fixes are in place:

- **`_playFallback` has NO `isPlaying` check** — intentional. On Oppo, `isPlaying` can return false
  even for a sound that's actually playing, causing a false-positive fallback loop. Only
  `_playPreloaded` checks `isPlaying`.
- **250 ms gap before `preloadForSession`** in SessionScreen.tsx — gives the OS time to release
  instances from the previous round before new ones are created.
- **Short unload timers** — `NOTE_UNLOAD_MS` and `CADENCE_UNLOAD_MS` are intentionally tight to
  reduce the number of live ExoPlayer instances at any moment.
- **VBR MP3 with Xing header** — required by Oppo's ExoPlayer for correct duration detection.
  Use `-q:a 5` (not `-b:a 128k`) in ffmpeg. CBR causes seek/pool issues on ColorOS.

Battery optimisation must be disabled manually on Oppo:
> Settings → Battery → App battery usage → Better Ear → Don't optimise

---

## DIM mode

The DIM button in the exercise screen makes everything black, then periodically fades in/out an EXIT
button. This keeps the screen alive (`useKeepAwake()`) without draining OLED pixels.

- EXIT is always *tappable* even when invisible — the TouchableOpacity is always mounted; only the
  visual Animated.View has `opacity: 0`. The Animated.View has `pointerEvents="none"` so its
  opacity-0 state doesn't block touches below it.
- The dim overlay is **inside `<SafeAreaView>`** — critical on Oppo. The bottom nav inset
  (20-40 px) would shift the absolute-positioned EXIT hitbox if the overlay were outside.
- EXIT button cycles R→G→B each appearance to spread OLED sub-pixel wear.
- Cycle: 1 s fade-in → 4 s hold → 1 s fade-out → 6 s black (12 s total per colour).

---

## ALYS attribution requirements

ALYS DiffSinger is non-commercial only. The About screen must credit:

- Voice: Poucet
- Training: S'pose (imsupposed2)
- QA & logistics: Gyromancy, Hibya, Mim, ALYS team
- ALYS is a registered trademark of Cyrielle Collignon
- Link to utaufrance.com

Do not remove or reduce this attribution.

---

## Scripts reference

| Script | Purpose |
|---|---|
| `scripts/chop_alys.py` | **Primary pipeline** — slices, EQs, and exports the 612 solfège MP3s |
| `scripts/listen.py` | Testing tool — plays back individual clips to check timing and volume |
| `scripts/generate_cadences.js` | Generates the I–IV–V–I cadence audio files |
| `scripts/generate_piano.py` | Generates the piano mystery-note files |
| `scripts/generate_ride.py` | Generates the ride/metronome loop |
| `scripts/generate_ui_tick.py` | Generates the UI tap tick sound |
| `scripts/generate_shaker.py` | Generates the shaker percussion |
| `scripts/chop_vocoder.py` | Legacy vocoder pipeline — superseded by chop_alys.py |
| `scripts/requirements.txt` | Python deps for all audio scripts |

---

## Gitignored large files (not in repo)

- `app/assets/audio/*.mp3` — regenerate with chop_alys.py and the generate_* scripts
- `New/*.wav` — ALYS source recordings, render in OpenUTAU if lost
- `app/node_modules/` — `npm install`
- `app/android/` — `npx expo export` then `gradlew assembleRelease`
- `scripts/venv/` — `python3 -m venv scripts/venv && pip install -r scripts/requirements.txt`
