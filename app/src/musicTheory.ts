// Music theory primitives for the Banacos ear training app.
// All functions are pure and key-agnostic — pass tonicMidi explicitly.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TONIC_MIDI = 60;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export type Direction   = 'ascending' | 'descending';
export type MysteryMode = 'chordal' | 'diatonic' | 'chromatic';

// ---------------------------------------------------------------------------
// Scale hierarchy
// ---------------------------------------------------------------------------

export type ParentScale = 'major' | 'harmonicMinor' | 'melodicMinor';

export const PARENT_SCALES: ParentScale[] = ['major', 'harmonicMinor', 'melodicMinor'];

export const PARENT_SCALE_LABEL: Record<ParentScale, string> = {
  major:         'major',
  harmonicMinor: 'harmonic minor',
  melodicMinor:  'melodic minor',
};

export type Mode =
  // Major modes (modes of the major / diatonic scale)
  | 'ionian' | 'dorian' | 'phrygian' | 'lydian'
  | 'mixolydian' | 'aeolian' | 'locrian'
  // Harmonic minor modes
  | 'harmMinor' | 'locrianN6' | 'ionianAug' | 'dorianS4'
  | 'phrygDom' | 'lydianS2' | 'altDim'
  // Melodic minor modes (jazz ascending melodic minor)
  | 'melMinor' | 'dorianB2' | 'lydianAugMel' | 'lydianDom'
  | 'mixoB6' | 'locrianN2' | 'altered';

export const PARENT_SCALE_MODES: Record<ParentScale, Mode[]> = {
  // Modes I–VII of the major scale
  major: ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'],
  // Modes I–VII of harmonic minor
  harmonicMinor: ['harmMinor', 'locrianN6', 'ionianAug', 'dorianS4', 'phrygDom', 'lydianS2', 'altDim'],
  // Modes I–VII of jazz ascending melodic minor
  melodicMinor: ['melMinor', 'dorianB2', 'lydianAugMel', 'lydianDom', 'mixoB6', 'locrianN2', 'altered'],
};

export const MODE_LABEL: Record<Mode, string> = {
  // Major family
  ionian:      'ionian',
  dorian:      'dorian',
  phrygian:    'phrygian',
  lydian:      'lydian',
  mixolydian:  'mixolydian',
  aeolian:     'aeolian',
  locrian:     'locrian',
  // Harmonic minor family
  harmMinor:   'harmonic minor',
  locrianN6:   'locrian ♮6',
  ionianAug:   'ionian augmented',
  dorianS4:    'dorian #4',
  phrygDom:    'phrygian dominant',
  lydianS2:    'lydian #2',
  altDim:      'altered diminished',
  // Melodic minor family
  melMinor:    'melodic minor',
  dorianB2:    'dorian ♭2',
  lydianAugMel:'lydian augmented',
  lydianDom:   'lydian dominant',
  mixoB6:      'mixolydian ♭6',
  locrianN2:   'locrian ♮2',
  altered:     'altered',
};

// Semitone offsets from tonic for each mode (degree indices 0–6)
export const MODE_INTERVALS: Record<Mode, readonly number[]> = {
  // ── Major-scale family ──────────────────────────────────────────────────
  ionian:      [0, 2, 4, 5, 7, 9, 11],
  dorian:      [0, 2, 3, 5, 7, 9, 10],
  phrygian:    [0, 1, 3, 5, 7, 8, 10],
  lydian:      [0, 2, 4, 6, 7, 9, 11],
  mixolydian:  [0, 2, 4, 5, 7, 9, 10],
  aeolian:     [0, 2, 3, 5, 7, 8, 10],
  locrian:     [0, 1, 3, 5, 6, 8, 10],
  // ── Harmonic-minor family ───────────────────────────────────────────────
  harmMinor:   [0, 2, 3, 5, 7, 8, 11], // do re me fa sol le ti
  locrianN6:   [0, 1, 3, 5, 6, 9, 10], // do ra me fa se la te
  ionianAug:   [0, 2, 4, 5, 8, 9, 11], // do re mi fa si la ti
  dorianS4:    [0, 2, 3, 6, 7, 9, 10], // do re me fi sol la te
  phrygDom:    [0, 1, 4, 5, 7, 8, 10], // do ra mi fa sol le te
  lydianS2:    [0, 3, 4, 6, 7, 9, 11], // do ri mi fi sol la ti
  altDim:      [0, 1, 3, 4, 6, 8, 9],  // do ra me mi se le la
  // ── Melodic-minor family ────────────────────────────────────────────────
  melMinor:    [0, 2, 3, 5, 7, 9, 11], // do re me fa sol la ti
  dorianB2:    [0, 1, 3, 5, 7, 9, 10], // do ra me fa sol la te
  lydianAugMel:[0, 2, 4, 6, 8, 9, 11], // do re mi fi si la ti
  lydianDom:   [0, 2, 4, 6, 7, 9, 10], // do re mi fi sol la te
  mixoB6:      [0, 2, 4, 5, 7, 8, 10], // do re mi fa sol le te
  locrianN2:   [0, 2, 3, 5, 6, 8, 10], // do re me fa se le te
  altered:     [0, 1, 3, 4, 6, 8, 10], // do ra me mi se le te
};

export const DIATONIC_SYLLABLES = ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'] as const;

export type SolfegeSyllable =
  | 'do' | 're' | 'mi' | 'fa' | 'sol' | 'la' | 'ti'
  | 'di' | 'ri' | 'fi' | 'si' | 'li'
  | 'ra' | 'me' | 'se' | 'le' | 'te';

// Chromatic syllable lookup by semitone offset from tonic (0–11).
// Ascending uses raised (sharp) names; descending uses lowered (flat) names.
export const SYLLABLES_ASCENDING: readonly SolfegeSyllable[] =
  ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti'];
export const SYLLABLES_DESCENDING: readonly SolfegeSyllable[] =
  ['do', 'ra', 're', 'me', 'mi', 'fa', 'se', 'sol', 'le', 'la', 'te', 'ti'];

// Diatonic solfège syllable for each degree (0–6) per mode
const MODE_SCALE_SYLLABLES: Record<Mode, readonly SolfegeSyllable[]> = {
  // Major family
  ionian:      ['do', 're', 'mi', 'fa',  'sol', 'la',  'ti'],
  dorian:      ['do', 're', 'me', 'fa',  'sol', 'la',  'te'],
  phrygian:    ['do', 'ra', 'me', 'fa',  'sol', 'le',  'te'],
  lydian:      ['do', 're', 'mi', 'fi',  'sol', 'la',  'ti'],
  mixolydian:  ['do', 're', 'mi', 'fa',  'sol', 'la',  'te'],
  aeolian:     ['do', 're', 'me', 'fa',  'sol', 'le',  'te'],
  locrian:     ['do', 'ra', 'me', 'fa',  'se',  'le',  'te'],
  // Harmonic minor family
  harmMinor:   ['do', 're', 'me', 'fa',  'sol', 'le',  'ti'],
  locrianN6:   ['do', 'ra', 'me', 'fa',  'se',  'la',  'te'],
  ionianAug:   ['do', 're', 'mi', 'fa',  'si',  'la',  'ti'],
  dorianS4:    ['do', 're', 'me', 'fi',  'sol', 'la',  'te'],
  phrygDom:    ['do', 'ra', 'mi', 'fa',  'sol', 'le',  'te'],
  lydianS2:    ['do', 'ri', 'mi', 'fi',  'sol', 'la',  'ti'],
  altDim:      ['do', 'ra', 'me', 'mi',  'se',  'le',  'la'],
  // Melodic minor family
  melMinor:    ['do', 're', 'me', 'fa',  'sol', 'la',  'ti'],
  dorianB2:    ['do', 'ra', 'me', 'fa',  'sol', 'la',  'te'],
  lydianAugMel:['do', 're', 'mi', 'fi',  'si',  'la',  'ti'],
  lydianDom:   ['do', 're', 'mi', 'fi',  'sol', 'la',  'te'],
  mixoB6:      ['do', 're', 'mi', 'fa',  'sol', 'le',  'te'],
  locrianN2:   ['do', 're', 'me', 'fa',  'se',  'le',  'te'],
  altered:     ['do', 'ra', 'me', 'mi',  'se',  'le',  'te'],
};

// ---------------------------------------------------------------------------
// Note utilities
// ---------------------------------------------------------------------------

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

// ---------------------------------------------------------------------------
// Scale utilities
// ---------------------------------------------------------------------------

/** Semitone offset from tonic, collapsed to 0–11. */
function pitchClass(midi: number, tonicMidi: number): number {
  return ((midi - tonicMidi) % 12 + 12) % 12;
}

/** Degree index 0–6 if diatonic to the given mode, -1 otherwise. */
function degreeIndex(midi: number, tonicMidi: number, mode: Mode = 'ionian'): number {
  return MODE_INTERVALS[mode].indexOf(pitchClass(midi, tonicMidi));
}

export function isDiatonic(midi: number, tonicMidi: number, mode: Mode = 'ionian'): boolean {
  return degreeIndex(midi, tonicMidi, mode) !== -1;
}

/**
 * Returns the solfège syllable for any note — diatonic or chromatic.
 * Diatonic notes use the mode's own syllable (e.g. 'me' in Dorian).
 * Chromatic notes use the direction-based raised/lowered name.
 */
export function getSyllable(
  midi: number,
  tonicMidi: number,
  direction: Direction = 'ascending',
  mode: Mode = 'ionian',
): SolfegeSyllable {
  const idx = degreeIndex(midi, tonicMidi, mode);
  if (idx !== -1) return MODE_SCALE_SYLLABLES[mode][idx];
  const pc = pitchClass(midi, tonicMidi);
  return direction === 'ascending' ? SYLLABLES_ASCENDING[pc] : SYLLABLES_DESCENDING[pc];
}

/**
 * Returns the mode's solfège syllable for a diatonic note, or null if chromatic.
 */
export function getDiatonicSyllable(
  midi: number,
  tonicMidi: number,
  mode: Mode = 'ionian',
): SolfegeSyllable | null {
  const idx = degreeIndex(midi, tonicMidi, mode);
  return idx === -1 ? null : MODE_SCALE_SYLLABLES[mode][idx];
}

/** All diatonic MIDI notes for this tonic/mode within [min, max]. */
export function getDiatonicMidis(
  tonicMidi: number,
  min: number,
  max: number,
  mode: Mode = 'ionian',
): number[] {
  const notes: number[] = [];
  for (let m = min; m <= max; m++) {
    if (isDiatonic(m, tonicMidi, mode)) notes.push(m);
  }
  return notes;
}

/**
 * Draws `count` mystery notes from the eligible pool with no repeats.
 * direction: 'ascending' → notes below tonic; 'descending' → notes above.
 * mysteryMode: 'diatonic' = scale only; 'chromatic' = all 12 notes.
 */
export function randomMysteryNotes(
  count: number,
  tonicMidi: number = TONIC_MIDI,
  direction: Direction = 'ascending',
  mysteryMode: MysteryMode = 'diatonic',
  mode: Mode = 'ionian',
): number[] {
  const min = direction === 'ascending' ? tonicMidi - 12 : tonicMidi + 1;
  const max = direction === 'ascending' ? tonicMidi - 1  : tonicMidi + 12;
  const chordPCs = new Set([
    MODE_INTERVALS[mode][0],
    MODE_INTERVALS[mode][2],
    MODE_INTERVALS[mode][4],
    MODE_INTERVALS[mode][6],
  ]);

  const pool: number[] = [];
  for (let m = min; m <= max; m++) {
    if (mysteryMode === 'chordal'  && !chordPCs.has(pitchClass(m, tonicMidi))) continue;
    if (mysteryMode === 'diatonic' && !isDiatonic(m, tonicMidi, mode))          continue;
    pool.push(m);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}


// ---------------------------------------------------------------------------
// Chord utilities
// ---------------------------------------------------------------------------

// Three diatonic degree indices that form the characteristic vamp for each mode.
// Chosen so their union covers all 7 scale tones and the progression implies the mode.
// I–IV–V–I using diatonic triads (stacked thirds within the mode).
// Chord quality (maj/min/dim/aug) falls out of the mode's own intervals.
const VAMP_DEGREES: Record<Mode, [number, number, number]> = {
  ionian:       [0, 3, 4],
  dorian:       [0, 3, 4],
  phrygian:     [0, 3, 4],
  lydian:       [0, 3, 4],
  mixolydian:   [0, 3, 4],
  aeolian:      [0, 3, 4],
  locrian:      [0, 3, 4],
  harmMinor:    [0, 3, 4],
  locrianN6:    [0, 3, 4],
  ionianAug:    [0, 3, 4],
  dorianS4:     [0, 3, 4],
  phrygDom:     [0, 3, 4],
  lydianS2:     [0, 3, 4],
  altDim:       [0, 3, 4],
  melMinor:     [0, 3, 4],
  dorianB2:     [0, 3, 4],
  lydianAugMel: [0, 3, 4],
  lydianDom:    [0, 3, 4],
  mixoB6:       [0, 3, 4],
  locrianN2:    [0, 3, 4],
  altered:      [0, 3, 4],
};

/** Close-voiced diatonic triad from degree `degIdx`, centred near the tonic register. */
function diatonicTriadVoiced(degIdx: number, tonicMidi: number, mode: Mode): number[] {
  const intervals = MODE_INTERVALS[mode];
  const rootPC  = intervals[degIdx];
  const thirdPC = intervals[(degIdx + 2) % 7];
  const fifthPC = intervals[(degIdx + 4) % 7];

  let third = thirdPC - rootPC;
  if (third <= 0) third += 12;
  let fifth = fifthPC - rootPC;
  if (fifth <= 0) fifth += 12;
  if (fifth <= third) fifth += 12;

  let root = tonicMidi + rootPC;
  if (degIdx !== 0) {
    while (root > tonicMidi + 2) root -= 12;
    while (root < tonicMidi - 11) root += 12;
  }
  return [root, root + third, root + fifth];
}

/** Close-voiced diatonic 7th chord on degree `degIdx` — adds the diatonic 7th above the triad. */
function diatonicTetradVoiced(degIdx: number, tonicMidi: number, mode: Mode): number[] {
  const intervals = MODE_INTERVALS[mode];
  const rootPC  = intervals[degIdx];
  const thirdPC = intervals[(degIdx + 2) % 7];
  const fifthPC = intervals[(degIdx + 4) % 7];
  const sevPC   = intervals[(degIdx + 6) % 7];

  let third = thirdPC - rootPC; if (third <= 0) third += 12;
  let fifth = fifthPC - rootPC; if (fifth <= 0) fifth += 12;
  if (fifth <= third) fifth += 12;
  let sev = sevPC - rootPC; if (sev <= 0) sev += 12;
  if (sev <= fifth) sev += 12;

  let root = tonicMidi + rootPC;
  if (degIdx !== 0) {
    while (root > tonicMidi + 2) root -= 12;
    while (root < tonicMidi - 11) root += 12;
  }
  return [root, root + third, root + fifth, root + sev];
}

/**
 * Mode-aware three-chord vamp in close voicing, voice-led near the tonic register.
 * Returns the same shape as the old getOneFourFiveOne so AudioEngine needs no restructuring.
 */
export function getVamp(tonicMidi = TONIC_MIDI, mode: Mode = 'ionian'): {
  I: number[];
  IV: number[];
  V: number[];
  names: { I: string; IV: string; V: string };
} {
  const [d0, d1, d2] = VAMP_DEGREES[mode];
  const intervals = MODE_INTERVALS[mode];
  return {
    I:     diatonicTetradVoiced(d0, tonicMidi, mode),
    IV:    diatonicTriadVoiced(d1, tonicMidi, mode),
    V:     diatonicTriadVoiced(d2, tonicMidi, mode),
    names: {
      I:  NOTE_NAMES[(tonicMidi + intervals[d0]) % 12],
      IV: NOTE_NAMES[(tonicMidi + intervals[d1]) % 12],
      V:  NOTE_NAMES[(tonicMidi + intervals[d2]) % 12],
    },
  };
}

// ---------------------------------------------------------------------------
// Verification path
// ---------------------------------------------------------------------------

/** Step to the next diatonic note in the given direction. */
function diatonicNeighbor(
  midi: number,
  tonicMidi: number,
  direction: 1 | -1,
  mode: Mode = 'ionian',
): number {
  const intervals = MODE_INTERVALS[mode];
  const idx = degreeIndex(midi, tonicMidi, mode);
  if (direction === 1) {
    const step = idx < 6 ? intervals[idx + 1] - intervals[idx] : 12 - intervals[6];
    return midi + step;
  } else {
    const step = idx > 0 ? intervals[idx] - intervals[idx - 1] : 12 - intervals[6];
    return midi - step;
  }
}

export interface PathStep {
  midi: number;
  direction: Direction;
  syllable: SolfegeSyllable;
}

/**
 * Banacos verification path: stepwise from mysteryMidi toward tonicMidi,
 * using the diatonic scale of the given mode.
 */
export function getVerificationPath(
  mysteryMidi: number,
  tonicMidi: number = TONIC_MIDI,
  direction: Direction = 'ascending',
  mode: Mode = 'ionian',
): PathStep[] {
  const path: PathStep[] = [];
  const covered = new Set<number>();

  const addNote = (midi: number, dir: Direction) => {
    path.push({ midi, direction: dir, syllable: getSyllable(midi, tonicMidi, dir, mode) });
    const idx = degreeIndex(midi, tonicMidi, mode);
    if (idx !== -1) covered.add(idx);
  };

  const toward: 1 | -1 = direction === 'ascending' ? 1 : -1;
  const towardDir = direction;

  addNote(mysteryMidi, direction);
  let current = mysteryMidi;

  if (!isDiatonic(mysteryMidi, tonicMidi, mode)) {
    current += toward;
    while (!isDiatonic(current, tonicMidi, mode)) current += toward;
    addNote(current, towardDir);
  }

  while (current !== tonicMidi) {
    current = diatonicNeighbor(current, tonicMidi, toward, mode);
    addNote(current, towardDir);
  }

  while (covered.size < 7) {
    current = diatonicNeighbor(current, tonicMidi, toward, mode);
    addNote(current, towardDir);
  }

  if (current !== tonicMidi) {
    const back: 1 | -1 = toward === 1 ? -1 : 1;
    const backDir: Direction = back === 1 ? 'ascending' : 'descending';
    while (current !== tonicMidi) {
      current = diatonicNeighbor(current, tonicMidi, back, mode);
      addNote(current, backDir);
    }
  }

  return path;
}
