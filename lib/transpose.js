// Enkel men robust ackord-transponerare.
// Hanterar grundton + eventuellt förtecken (# eller b), svit (m, 7, maj7, sus4, dim, aug, add9 ...)
// samt basnot efter snedstreck, t.ex. "G/B" eller "F#m7/A#".

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Svenska ackordnamn använder ibland 'H' för det vi kallar 'B' i engelsk notation.
// Vi jobbar internt med engelsk notation (B) men kan mappa vid behov senare.

const NOTE_INDEX = {};
SHARPS.forEach((n, i) => { NOTE_INDEX[n] = i; });
FLATS.forEach((n, i) => { NOTE_INDEX[n] = i; });

const ROOT_RE = /^([A-G])(#|b)?/;

function transposeRoot(root, steps, preferFlats) {
  const idx = NOTE_INDEX[root];
  if (idx === undefined) return root; // okänd not, rör inte
  let newIdx = (idx + steps) % 12;
  if (newIdx < 0) newIdx += 12;
  return preferFlats ? FLATS[newIdx] : SHARPS[newIdx];
}

function transposeSingle(part, steps, preferFlats) {
  const m = part.match(ROOT_RE);
  if (!m) return part;
  const root = m[1] + (m[2] || '');
  const rest = part.slice(m[0].length);
  return transposeRoot(root, steps, preferFlats) + rest;
}

// Transponerar ett helt ackord, t.ex. "F#m7/A#" -> beaktar basnot efter '/'
function transposeChord(chord, steps, preferFlats = false) {
  if (!chord) return chord;
  if (steps === 0) return chord;
  const parts = chord.split('/');
  return parts.map(p => transposeSingle(p, steps, preferFlats)).join('/');
}

// Transponerar alla [Ackord]-taggar i en råtextrad/hel text
function transposeText(text, steps, preferFlats = false) {
  if (!steps) return text;
  return text.replace(/\[([^\]]+)\]/g, (match, chord) => {
    return `[${transposeChord(chord, steps, preferFlats)}]`;
  });
}

// Försök gissa om en tonart naturligt hör hemma i b- eller #-värld
function prefersFlats(key) {
  if (!key) return false;
  const flatKeys = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm'];
  return flatKeys.some(k => key.replace(/\s/g, '').toLowerCase().startsWith(k.toLowerCase()));
}

module.exports = { transposeChord, transposeText, transposeRoot, prefersFlats, SHARPS, FLATS };
