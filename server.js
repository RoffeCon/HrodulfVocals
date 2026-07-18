const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { JsonStore, makeId } = require('./lib/store');
const { extractLyricLines } = require('./lib/lyricLines');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8420;
const DATA_DIR = path.join(__dirname, 'data');

const songs = new JsonStore('songs.json', DATA_DIR);
const setlists = new JsonStore('setlists.json', DATA_DIR);
const rhymes = new JsonStore('rhymes.json', DATA_DIR);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(payload);
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello' }));
});

// ---------- Songs ----------

app.get('/api/songs', (req, res) => {
  const list = songs.all()
    .map(({ id, title, composer, key, tempo, capo, tags, notes, updatedAt, groupId, versionLabel }) =>
      ({ id, title, composer, key, tempo, capo, tags, notes, updatedAt, groupId: groupId || id, versionLabel: versionLabel || 'V1' }))
    .sort((a, b) => a.title.localeCompare(b.title, 'sv'));
  res.json(list);
});

app.get('/api/songs/:id', (req, res) => {
  const song = songs.get(req.params.id);
  if (!song) return res.status(404).json({ error: 'Låten hittades inte' });
  res.json({ ...song, groupId: song.groupId || song.id, versionLabel: song.versionLabel || 'V1' });
});

app.post('/api/songs', async (req, res) => {
  const now = new Date().toISOString();
  const body = req.body || {};
  if (!body.title || !body.title.trim()) {
    return res.status(400).json({ error: 'Titel krävs' });
  }
  const id = makeId();
  const song = {
    id,
    title: body.title.trim(),
    composer: body.composer || '',
    key: body.key || '',
    capo: body.capo || '',
    tempo: body.tempo || '',
    timeSignature: body.timeSignature || '',
    tags: Array.isArray(body.tags) ? body.tags : [],
    notes: body.notes || '',
    text: body.text || '',
    groupId: body.groupId || id,
    versionLabel: body.versionLabel || 'V1',
    createdAt: now,
    updatedAt: now,
  };
  await songs.insert(song);
  broadcast({ type: 'songs-changed', reason: 'created', id: song.id });
  res.status(201).json(song);
});

// Massimport: skapar flera låtar på en gång från text som klistrats in och delats
// upp i klienten. Varje objekt behöver minst en titel.
app.post('/api/songs/import', async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.songs) ? body.songs : [];
  if (!items.length) return res.status(400).json({ error: 'Inga låtar att importera' });
  const now = new Date().toISOString();
  const created = [];
  for (const raw of items) {
    const title = (raw.title || '').trim();
    if (!title) continue;
    const id = makeId();
    const song = {
      id,
      title,
      composer: raw.composer || '',
      key: raw.key || '',
      capo: raw.capo || '',
      tempo: raw.tempo || '',
      timeSignature: raw.timeSignature || '',
      tags: [],
      notes: raw.notes || '',
      text: raw.text || '',
      groupId: id,
      versionLabel: 'V1',
      createdAt: now,
      updatedAt: now,
    };
    await songs.insert(song);
    created.push(song);
  }
  if (created.length) broadcast({ type: 'songs-changed', reason: 'imported' });
  res.status(201).json({ created: created.length, songs: created });
});

app.put('/api/songs/:id', async (req, res) => {
  const existing = songs.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Låten hittades inte' });
  const body = req.body || {};
  if (body.title !== undefined && !body.title.trim()) {
    return res.status(400).json({ error: 'Titel kan inte vara tom' });
  }
  const patch = {
    ...('title' in body ? { title: body.title.trim() } : {}),
    ...('composer' in body ? { composer: body.composer } : {}),
    ...('key' in body ? { key: body.key } : {}),
    ...('capo' in body ? { capo: body.capo } : {}),
    ...('tempo' in body ? { tempo: body.tempo } : {}),
    ...('timeSignature' in body ? { timeSignature: body.timeSignature } : {}),
    ...('tags' in body ? { tags: Array.isArray(body.tags) ? body.tags : [] } : {}),
    ...('notes' in body ? { notes: body.notes } : {}),
    ...('text' in body ? { text: body.text } : {}),
    ...('versionLabel' in body ? { versionLabel: body.versionLabel || 'V1' } : {}),
    updatedAt: new Date().toISOString(),
  };
  const updated = await songs.update(req.params.id, patch);
  broadcast({ type: 'songs-changed', reason: 'updated', id: updated.id });
  res.json(updated);
});

// Skapar en ny version av en befintlig låt: samma groupId, kopierad text/metadata som startpunkt.
app.post('/api/songs/:id/version', async (req, res) => {
  const src = songs.get(req.params.id);
  if (!src) return res.status(404).json({ error: 'Låten hittades inte' });
  const groupId = src.groupId || src.id;
  if (!src.groupId) await songs.update(src.id, { groupId });
  const siblingCount = songs.all().filter(s => (s.groupId || s.id) === groupId).length;
  const now = new Date().toISOString();
  const copy = {
    id: makeId(),
    title: src.title,
    composer: src.composer,
    key: src.key,
    capo: src.capo,
    tempo: src.tempo,
    timeSignature: src.timeSignature,
    tags: src.tags,
    notes: src.notes,
    text: src.text,
    groupId,
    versionLabel: (req.body && req.body.versionLabel) || `V${siblingCount + 1}`,
    createdAt: now,
    updatedAt: now,
  };
  await songs.insert(copy);
  broadcast({ type: 'songs-changed', reason: 'created', id: copy.id });
  res.status(201).json(copy);
});

app.delete('/api/songs/:id', async (req, res) => {
  const ok = await songs.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Låten hittades inte' });
  // Städa bort låten ur ev. setlistor också
  for (const sl of setlists.all()) {
    const items = normalizeItems(sl);
    if (items.some(i => i.kind === 'song' && i.songId === req.params.id)) {
      const newItems = items.filter(i => !(i.kind === 'song' && i.songId === req.params.id));
      await setlists.update(sl.id, { items: newItems, songIds: songIdsFromItems(newItems) });
    }
  }
  broadcast({ type: 'songs-changed', reason: 'deleted', id: req.params.id });
  broadcast({ type: 'setlists-changed', reason: 'song-removed' });
  res.status(204).end();
});

// ---------- Setlists ----------
//
// En setlista är en sekvens av "items": antingen en låt ({kind:'song', songId})
// eller en grupprubrik ({kind:'group', label}) - t.ex. för att dela upp kvällens
// låtar efter gitarrstämning. Äldre setlistor sparade bara en platt songIds-lista;
// normalizeItems() gör om dem till samma form vid inläsning så inget går sönder.

function normalizeItems(sl) {
  if (Array.isArray(sl.items)) return sl.items;
  return (sl.songIds || []).map(id => ({ kind: 'song', songId: id }));
}
function songIdsFromItems(items) {
  return items.filter(i => i.kind === 'song').map(i => i.songId);
}
function sanitizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map(it => {
    if (it && it.kind === 'group') return { kind: 'group', label: String(it.label || '').trim() };
    if (it && it.kind === 'song' && it.songId) return { kind: 'song', songId: it.songId };
    return null;
  }).filter(Boolean);
}
function withNormalizedItems(sl) {
  const items = normalizeItems(sl);
  return { ...sl, items, songIds: songIdsFromItems(items) };
}

app.get('/api/setlists', (req, res) => {
  const list = setlists.all().slice()
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map(withNormalizedItems);
  res.json(list);
});

app.get('/api/setlists/:id', (req, res) => {
  const sl = setlists.get(req.params.id);
  if (!sl) return res.status(404).json({ error: 'Setlistan hittades inte' });
  res.json(withNormalizedItems(sl));
});

app.post('/api/setlists', async (req, res) => {
  const now = new Date().toISOString();
  const body = req.body || {};
  if (!body.name || !body.name.trim()) {
    return res.status(400).json({ error: 'Namn krävs' });
  }
  const items = sanitizeItems(body.items) || [];
  const sl = {
    id: makeId(),
    name: body.name.trim(),
    venue: body.venue || '',
    date: body.date || '',
    notes: body.notes || '',
    items,
    songIds: songIdsFromItems(items),
    createdAt: now,
    updatedAt: now,
  };
  await setlists.insert(sl);
  broadcast({ type: 'setlists-changed', reason: 'created', id: sl.id });
  res.status(201).json(sl);
});

app.put('/api/setlists/:id', async (req, res) => {
  const existing = setlists.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Setlistan hittades inte' });
  const body = req.body || {};
  const itemsPatch = 'items' in body ? { items: sanitizeItems(body.items), songIds: songIdsFromItems(sanitizeItems(body.items)) } : {};
  const patch = {
    ...('name' in body && body.name.trim() ? { name: body.name.trim() } : {}),
    ...('venue' in body ? { venue: body.venue } : {}),
    ...('date' in body ? { date: body.date } : {}),
    ...('notes' in body ? { notes: body.notes } : {}),
    ...itemsPatch,
    updatedAt: new Date().toISOString(),
  };
  const updated = await setlists.update(req.params.id, patch);
  broadcast({ type: 'setlists-changed', reason: 'updated', id: updated.id });
  res.json(withNormalizedItems(updated));
});

app.delete('/api/setlists/:id', async (req, res) => {
  const ok = await setlists.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Setlistan hittades inte' });
  broadcast({ type: 'setlists-changed', reason: 'deleted', id: req.params.id });
  res.status(204).end();
});

// ---------- Health / info ----------

// ---------- Rimlexikon ----------

app.get('/api/rhymes', (req, res) => {
  const list = rhymes.all().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  res.json(list);
});

app.post('/api/rhymes', async (req, res) => {
  const body = req.body || {};
  const words = Array.isArray(body.words) ? body.words.map(w => String(w).trim()).filter(Boolean) : [];
  if (words.length < 2) return res.status(400).json({ error: 'Minst två ord eller fraser krävs' });
  const now = new Date().toISOString();
  const entry = {
    id: makeId(),
    language: body.language || 'sv',
    type: body.type || 'simple',
    words,
    phrases: Array.isArray(body.phrases) ? body.phrases.map(p => String(p).trim()).filter(Boolean) : [],
    tags: Array.isArray(body.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : [],
    favorite: !!body.favorite,
    notes: body.notes || '',
    songUsage: Array.isArray(body.songUsage) ? body.songUsage : [],
    createdAt: now,
    updatedAt: now,
  };
  await rhymes.insert(entry);
  broadcast({ type: 'rhymes-changed', reason: 'created', id: entry.id });
  res.status(201).json(entry);
});

// Massimport: respekterar språk per post om det finns i JSON:en, annars faller den
// tillbaka på det språk som valdes i importformuläret.
app.post('/api/rhymes/import', async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.entries) ? body.entries : [];
  const defaultLanguage = body.defaultLanguage || 'sv';
  if (!items.length) return res.status(400).json({ error: 'Inga rim att importera' });
  const now = new Date().toISOString();
  let createdCount = 0;
  for (const raw of items) {
    const words = Array.isArray(raw.words) ? raw.words.map(w => String(w).trim()).filter(Boolean) : [];
    if (words.length < 2) continue;
    const entry = {
      id: makeId(),
      language: raw.language || defaultLanguage,
      type: raw.type || 'simple',
      words,
      phrases: Array.isArray(raw.phrases) ? raw.phrases.map(p => String(p).trim()).filter(Boolean) : [],
      tags: Array.isArray(raw.tags) ? raw.tags.map(t => String(t).trim()).filter(Boolean) : [],
      favorite: !!raw.favorite,
      notes: raw.notes || '',
      songUsage: [],
      createdAt: now,
      updatedAt: now,
    };
    await rhymes.insert(entry);
    createdCount++;
  }
  if (createdCount) broadcast({ type: 'rhymes-changed', reason: 'imported' });
  res.status(201).json({ created: createdCount });
});

app.put('/api/rhymes/:id', async (req, res) => {
  const existing = rhymes.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rimmet hittades inte' });
  const body = req.body || {};
  const patch = {
    ...('language' in body ? { language: body.language } : {}),
    ...('type' in body ? { type: body.type } : {}),
    ...('words' in body ? { words: Array.isArray(body.words) ? body.words.map(w => String(w).trim()).filter(Boolean) : existing.words } : {}),
    ...('phrases' in body ? { phrases: Array.isArray(body.phrases) ? body.phrases.map(p => String(p).trim()).filter(Boolean) : [] } : {}),
    ...('tags' in body ? { tags: Array.isArray(body.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : [] } : {}),
    ...('favorite' in body ? { favorite: !!body.favorite } : {}),
    ...('notes' in body ? { notes: body.notes } : {}),
    ...('songUsage' in body ? { songUsage: Array.isArray(body.songUsage) ? body.songUsage : [] } : {}),
    updatedAt: new Date().toISOString(),
  };
  const updated = await rhymes.update(req.params.id, patch);
  broadcast({ type: 'rhymes-changed', reason: 'updated', id: updated.id });
  res.json(updated);
});

app.delete('/api/rhymes/:id', async (req, res) => {
  const ok = await rhymes.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Rimmet hittades inte' });
  broadcast({ type: 'rhymes-changed', reason: 'deleted', id: req.params.id });
  res.status(204).end();
});

function normWord(w) {
  return String(w || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// Sök efter två ord som förekommer inom ett givet radavstånd i samma låt - täcker
// både rim inom en vers och rim mellan t.ex. sista raden i vers 1 och vers 2.
app.get('/api/search/proximity', (req, res) => {
  const w1 = normWord(req.query.word1);
  const w2 = normWord(req.query.word2);
  const radius = Math.max(1, Math.min(20, parseInt(req.query.radius, 10) || 4));
  if (!w1 || !w2) return res.status(400).json({ error: 'Ange två ord att söka efter' });

  const results = [];
  for (const song of songs.all()) {
    const lines = extractLyricLines(song.text);
    const idx1 = [], idx2 = [];
    lines.forEach((line, i) => {
      const words = line.split(/\s+/).map(normWord);
      if (words.includes(w1)) idx1.push(i);
      if (words.includes(w2)) idx2.push(i);
    });
    if (!idx1.length || !idx2.length) continue;
    const seen = new Set();
    const occurrences = [];
    for (const i of idx1) {
      for (const j of idx2) {
        if (i === j && w1 === w2) continue;
        if (Math.abs(i - j) > radius) continue;
        const key = [Math.min(i, j), Math.max(i, j)].join('-');
        if (seen.has(key)) continue;
        seen.add(key);
        occurrences.push({ line1: Math.min(i, j), line1Text: lines[Math.min(i, j)], line2: Math.max(i, j), line2Text: lines[Math.max(i, j)], distance: Math.abs(i - j) });
      }
    }
    if (occurrences.length) {
      results.push({ songId: song.id, title: song.title, versionLabel: song.versionLabel || 'V1', occurrences });
    }
  }
  res.json(results);
});

app.get('/api/info', (req, res) => {
  res.json({ name: 'LyricsMaster', version: '1.0.0', time: new Date().toISOString() });
});

function localIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ♪ LyricsMaster körs nu ♪');
  console.log('  ---------------------------------');
  console.log(`  På telefonen:      http://localhost:${PORT}`);
  const ips = localIPs();
  if (ips.length) {
    ips.forEach(ip => console.log(`  Från datorn (wifi): http://${ip}:${PORT}`));
  } else {
    console.log('  Ingen wifi-adress hittades - kontrollera att telefonen är ansluten till nätverket.');
  }
  console.log('  ---------------------------------');
  console.log('  Avsluta med Ctrl+C');
  console.log('');
});
