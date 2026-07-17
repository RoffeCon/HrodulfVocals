// Songbook - tolkning och rendering av låttext med ackord.
// Format:
//   ## Avsnittsnamn        -> ny sektion (vers/refräng/stick/annat, avgörs av nyckelord i namnet)
//   Text med [Ackord]      -> ackord inline, positioneras ovanför texten vid rendering
//   > Anteckning           -> visas kursivt, transponeras inte, räknas ej som sångtext
//
(function (global) {
  'use strict';

  const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLATS  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const NOTE_INDEX = {};
  SHARPS.forEach((n, i) => { NOTE_INDEX[n] = i; });
  FLATS.forEach((n, i) => { NOTE_INDEX[n] = i; });
  const ROOT_RE = /^([A-G])(#|b)?/;

  function transposeRoot(root, steps, preferFlats) {
    const idx = NOTE_INDEX[root];
    if (idx === undefined) return root;
    let n = (idx + steps) % 12;
    if (n < 0) n += 12;
    return preferFlats ? FLATS[n] : SHARPS[n];
  }

  function transposeSingle(part, steps, preferFlats) {
    const m = part.match(ROOT_RE);
    if (!m) return part;
    const root = m[1] + (m[2] || '');
    const rest = part.slice(m[0].length);
    return transposeRoot(root, steps, preferFlats) + rest;
  }

  function transposeChord(chord, steps, preferFlats) {
    if (!chord || !steps) return chord;
    return chord.split('/').map(p => transposeSingle(p, steps, preferFlats)).join('/');
  }

  function prefersFlats(key) {
    if (!key) return false;
    const flatKeys = ['f', 'bb', 'eb', 'ab', 'db', 'gb', 'dm', 'gm', 'cm', 'fm', 'bbm', 'ebm'];
    const norm = key.replace(/\s/g, '').toLowerCase();
    return flatKeys.some(k => norm.startsWith(k));
  }

  function detectType(label) {
    const l = (label || '').toLowerCase();
    if (/refr[äa]ng|chorus/.test(l)) return 'chorus';
    if (/stick|brygga|bridge/.test(l)) return 'bridge';
    if (/vers|verse/.test(l)) return 'verse';
    if (/intro/.test(l)) return 'intro';
    if (/outro|slut/.test(l)) return 'outro';
    return 'other';
  }

  // Delar en rad i text-segment + ackord med positioner (kolumnbaserat, för monospace-rendering)
  function splitChordLine(raw) {
    let lyric = '';
    const chords = []; // {pos, chord}
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === '[') {
        const end = raw.indexOf(']', i);
        if (end !== -1) {
          const chord = raw.slice(i + 1, end);
          chords.push({ pos: lyric.length, chord });
          i = end + 1;
          continue;
        }
      }
      lyric += raw[i];
      i++;
    }
    return { lyric, chords };
  }

  function parseSections(text) {
    const rawLines = (text || '').replace(/\r\n/g, '\n').split('\n');
    const sections = [];
    let current = { label: '', type: 'other', lines: [] };
    let started = false;

    for (const raw of rawLines) {
      if (/^##\s*/.test(raw)) {
        if (started) sections.push(current);
        const label = raw.replace(/^##\s*/, '').trim();
        current = { label, type: detectType(label), lines: [] };
        started = true;
        continue;
      }
      if (!started) started = true;
      if (/^>\s?/.test(raw)) {
        current.lines.push({ kind: 'comment', text: raw.replace(/^>\s?/, '') });
      } else if (raw.trim() === '') {
        current.lines.push({ kind: 'blank' });
      } else {
        const { lyric, chords } = splitChordLine(raw);
        current.lines.push({ kind: 'lyric', lyric, chords });
      }
    }
    sections.push(current);
    return sections.filter(s => s.lines.length > 0 || s.label);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Bygger HTML för en ackord+text-rad, med ackord positionerade ovanför via monospace-kolumner
  function renderLyricLine(line, steps, preferFlats, showChords) {
    const lyric = line.lyric.length ? line.lyric : '\u00A0';
    if (!showChords || line.chords.length === 0) {
      return `<div class="line"><div class="lyric-only">${escapeHtml(lyric)}</div></div>`;
    }
    // Bygg en radbuffert med ackord utplacerade på rätt kolumn, ej överlappande
    let chordRow = '';
    let cursor = 0;
    const sorted = line.chords.slice().sort((a, b) => a.pos - b.pos);
    for (const c of sorted) {
      const chordText = transposeChord(c.chord, steps, preferFlats);
      let pos = Math.max(c.pos, cursor);
      while (chordRow.length < pos) chordRow += ' ';
      chordRow += chordText;
      cursor = chordRow.length + 1; // minst ett mellanslag innan nästa ackord
    }
    return `<div class="line">
      <div class="chord-row">${escapeHtml(chordRow)}</div>
      <div class="lyric-row">${escapeHtml(lyric)}</div>
    </div>`;
  }

  function renderSong(text, opts) {
    const steps = (opts && opts.transpose) || 0;
    const showChords = !opts || opts.showChords !== false;
    const preferFlats = !!(opts && opts.preferFlats);
    const sections = parseSections(text);
    let html = '';
    for (const sec of sections) {
      const cls = 'section section-' + sec.type;
      html += `<div class="${cls}">`;
      if (sec.label) html += `<div class="section-label">${escapeHtml(sec.label)}</div>`;
      for (const line of sec.lines) {
        if (line.kind === 'blank') {
          html += '<div class="line-gap"></div>';
        } else if (line.kind === 'comment') {
          html += `<div class="comment-line">${escapeHtml(line.text)}</div>`;
        } else {
          html += renderLyricLine(line, steps, preferFlats, showChords);
        }
      }
      html += '</div>';
    }
    return html || '<p class="empty-state small">Ingen text ännu.</p>';
  }

  global.Songbook = {
    parseSections,
    renderSong,
    transposeChord,
    prefersFlats,
  };
})(window);
