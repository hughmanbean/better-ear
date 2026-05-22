#!/usr/bin/env node
'use strict';

/**
 * Generates pre-mixed I–IV–V–I cadence MP3s for each (tonic, mode) pair.
 * Fixed tempo: 80 BPM (750 ms/beat).
 * Output: app/assets/audio/cadence_<midi>_<mode>.mp3
 *
 * Run with: node scripts/generate_cadences.js
 * Pass --force to regenerate files that already exist.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const AUDIO_DIR   = path.join(__dirname, '../app/assets/audio');
const ASSETS_FILE = path.join(__dirname, '../app/src/audioAssets.ts');
const FORCE       = process.argv.includes('--force');
const BPM         = 80;
const BEAT_MS     = Math.round(60_000 / BPM); // 750 ms

// ---------------------------------------------------------------------------
// Chord math — ported from musicTheory.ts
// ---------------------------------------------------------------------------

const MODE_INTERVALS = {
  // Major family
  ionian:       [0, 2, 4, 5, 7, 9, 11],
  dorian:       [0, 2, 3, 5, 7, 9, 10],
  phrygian:     [0, 1, 3, 5, 7, 8, 10],
  lydian:       [0, 2, 4, 6, 7, 9, 11],
  mixolydian:   [0, 2, 4, 5, 7, 9, 10],
  aeolian:      [0, 2, 3, 5, 7, 8, 10],
  locrian:      [0, 1, 3, 5, 6, 8, 10],
  // Harmonic minor family
  harmMinor:    [0, 2, 3, 5, 7, 8, 11],
  locrianN6:    [0, 1, 3, 5, 6, 9, 10],
  ionianAug:    [0, 2, 4, 5, 8, 9, 11],
  dorianS4:     [0, 2, 3, 6, 7, 9, 10],
  phrygDom:     [0, 1, 4, 5, 7, 8, 10],
  lydianS2:     [0, 3, 4, 6, 7, 9, 11],
  altDim:       [0, 1, 3, 4, 6, 8, 9],
  // Melodic minor family
  melMinor:     [0, 2, 3, 5, 7, 9, 11],
  dorianB2:     [0, 1, 3, 5, 7, 9, 10],
  lydianAugMel: [0, 2, 4, 6, 8, 9, 11],
  lydianDom:    [0, 2, 4, 6, 7, 9, 10],
  mixoB6:       [0, 2, 4, 5, 7, 8, 10],
  locrianN2:    [0, 2, 3, 5, 6, 8, 10],
  altered:      [0, 1, 3, 4, 6, 8, 10],
};

// All modes use [0, 3, 4] for I–IV–V vamp degrees
const VAMP_DEGREES = [0, 3, 4];

// Open spread triad: root (bass register) — fifth — third (raised octave).
// Root is lowered one octave from its natural position so the raised third
// stays within the 48–72 sample range. For the handful of augmented modes at
// the three lowest tonics (57–59) the raised third is capped at 72.
function diatonicTriadOpen(degIdx, tonicMidi, mode) {
  const iv = MODE_INTERVALS[mode];
  const rootPC  = iv[degIdx];
  const thirdPC = iv[(degIdx + 2) % 7];
  const fifthPC = iv[(degIdx + 4) % 7];
  let third = thirdPC - rootPC; if (third <= 0) third += 12;
  let fifth = fifthPC - rootPC; if (fifth <= 0) fifth += 12;
  if (fifth <= third) fifth += 12;

  let root = tonicMidi + rootPC;
  if (degIdx !== 0) {
    while (root > tonicMidi + 2) root -= 12;
    while (root < tonicMidi - 11) root += 12;
  }
  root -= 12;
  while (root < 48) root += 12;

  // If the raised third exceeds the sample ceiling, fall back to close voicing
  // rather than capping at 72 (which produces the wrong pitch class).
  if (root + third + 12 > 72) {
    return [root, root + third, root + fifth];
  }
  return [root, root + fifth, root + third + 12];
}

function getVamp(tonicMidi, mode) {
  const [d0, d1, d2] = VAMP_DEGREES;
  return {
    I:  diatonicTriadOpen(d0, tonicMidi, mode),
    IV: diatonicTriadOpen(d1, tonicMidi, mode),
    V:  diatonicTriadOpen(d2, tonicMidi, mode),
  };
}

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------

function mixChord(notes, outWav) {
  const inputs = notes.map(n => `-i "${path.join(AUDIO_DIR, `${n}_piano.mp3`)}"`).join(' ');
  const filter = notes.length > 1
    ? `-filter_complex "amix=inputs=${notes.length}:normalize=1:dropout_transition=0"`
    : '';
  execSync(`ffmpeg -y ${inputs} ${filter} "${outWav}"`, { stdio: 'pipe' });
}

function sequenceChords(chordWavs, outMp3) {
  const inputs = chordWavs.map(f => `-i "${f}"`).join(' ');
  const filter = [
    `[1]adelay=${BEAT_MS}|${BEAT_MS}[d1]`,
    `[2]adelay=${BEAT_MS * 2}|${BEAT_MS * 2}[d2]`,
    `[3]adelay=${BEAT_MS * 3}|${BEAT_MS * 3}[d3]`,
    `[0][d1][d2][d3]amix=inputs=4:normalize=0:dropout_transition=0:duration=longest`,
  ].join(';');
  execSync(
    `ffmpeg -y ${inputs} -filter_complex "${filter}" -q:a 2 "${outMp3}"`,
    { stdio: 'pipe' },
  );
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const ALL_MODES = Object.keys(MODE_INTERVALS);
const TONICS    = Array.from({ length: 12 }, (_, i) => 57 + i); // A3–Ab4

let ok = 0, skipped = 0, failed = 0;

for (const mode of ALL_MODES) {
  for (const tonic of TONICS) {
    const label   = `cadence_${tonic}_${mode}`;
    const outFile = path.join(AUDIO_DIR, `${label}.mp3`);

    if (!FORCE && fs.existsSync(outFile)) {
      process.stdout.write(`  ${label} ... SKIP\n`);
      skipped++;
      continue;
    }

    const { I, IV, V } = getVamp(tonic, mode);
    const bassNote = I[0] - 12; // octave below I root — lands in 36–47 range
    const I_final  = [bassNote, ...I];
    const chordNotes = [I, IV, V, I_final];
    const tmpDir  = os.tmpdir();
    const tmpWavs = chordNotes.map((_, i) =>
      path.join(tmpDir, `_cad_${tonic}_${mode}_${i}.wav`),
    );

    process.stdout.write(`  ${label} ... `);
    try {
      for (let ci = 0; ci < 4; ci++) {
        mixChord(chordNotes[ci], tmpWavs[ci]);
      }
      sequenceChords(tmpWavs, outFile);
      console.log(`OK  [I:${I} IV:${IV} V:${V}]`);
      ok++;
    } catch (e) {
      console.error(`FAILED — ${e.message?.split('\n')[0] ?? e}`);
      failed++;
    } finally {
      for (const f of tmpWavs) try { fs.unlinkSync(f); } catch {}
    }
  }
}

console.log(`\nDone: ${ok} generated, ${skipped} skipped, ${failed} failed`);

// ---------------------------------------------------------------------------
// Rewrite cadence section in audioAssets.ts
// ---------------------------------------------------------------------------

const cadenceLines = ALL_MODES.flatMap(mode =>
  TONICS.map(tonic => {
    const key = `cadence_${tonic}_${mode}`;
    return `  '${key}': require('../assets/audio/${key}.mp3'),`;
  }),
);

const newSection =
  `  // Cadence clips — I–IV–V–I, ${BPM} BPM, generated by scripts/generate_cadences.js\n` +
  cadenceLines.join('\n') + '\n';

let assets = fs.readFileSync(ASSETS_FILE, 'utf8');
assets = assets.replace(
  /  'cadence_[\s\S]*?(?=  'ride_fast')/,
  newSection,
);
fs.writeFileSync(ASSETS_FILE, assets);
console.log('audioAssets.ts updated');
