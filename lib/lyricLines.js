// Extraherar sångbara textrader ur en låts råtext (samma markup som chordpro.js),
// för användning av rim-närhetssökningen på servern. Ackord, radbrytningsrubriker
// (## ...) och anteckningsrader (> ...) räknas inte som sångrader.
function extractLyricLines(text) {
  const rawLines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const raw of rawLines) {
    if (/^##\s*/.test(raw)) continue;
    if (/^>\s?/.test(raw)) continue;
    if (raw.trim() === '') continue;
    const lyric = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (lyric) lines.push(lyric);
  }
  return lines;
}

module.exports = { extractLyricLines };
