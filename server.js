const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { JsonStore, makeId } = require('./lib/store');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8420;
const DATA_DIR = path.join(__dirname, 'data');

const songs = new JsonStore('songs.json', DATA_DIR);
const setlists = new JsonStore('setlists.json', DATA_DIR);

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
    .map(({ id, title, composer, key, tempo, capo, tags, updatedAt, groupId, versionLabel }) =>
      ({ id, title, composer, key, tempo, capo, tags, updatedAt, groupId: groupId || id, versionLabel: versionLabel || 'V1' }))
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
    if (sl.songIds.includes(req.params.id)) {
      await setlists.update(sl.id, { songIds: sl.songIds.filter(x => x !== req.params.id) });
    }
  }
  broadcast({ type: 'songs-changed', reason: 'deleted', id: req.params.id });
  broadcast({ type: 'setlists-changed', reason: 'song-removed' });
  res.status(204).end();
});

// ---------- Setlists ----------

app.get('/api/setlists', (req, res) => {
  const list = setlists.all().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  res.json(list);
});

app.get('/api/setlists/:id', (req, res) => {
  const sl = setlists.get(req.params.id);
  if (!sl) return res.status(404).json({ error: 'Setlistan hittades inte' });
  res.json(sl);
});

app.post('/api/setlists', async (req, res) => {
  const now = new Date().toISOString();
  const body = req.body || {};
  if (!body.name || !body.name.trim()) {
    return res.status(400).json({ error: 'Namn krävs' });
  }
  const sl = {
    id: makeId(),
    name: body.name.trim(),
    venue: body.venue || '',
    date: body.date || '',
    notes: body.notes || '',
    songIds: Array.isArray(body.songIds) ? body.songIds : [],
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
  const patch = {
    ...('name' in body && body.name.trim() ? { name: body.name.trim() } : {}),
    ...('venue' in body ? { venue: body.venue } : {}),
    ...('date' in body ? { date: body.date } : {}),
    ...('notes' in body ? { notes: body.notes } : {}),
    ...('songIds' in body ? { songIds: Array.isArray(body.songIds) ? body.songIds : [] } : {}),
    updatedAt: new Date().toISOString(),
  };
  const updated = await setlists.update(req.params.id, patch);
  broadcast({ type: 'setlists-changed', reason: 'updated', id: updated.id });
  res.json(updated);
});

app.delete('/api/setlists/:id', async (req, res) => {
  const ok = await setlists.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Setlistan hittades inte' });
  broadcast({ type: 'setlists-changed', reason: 'deleted', id: req.params.id });
  res.status(204).end();
});

// ---------- Health / info ----------

app.get('/api/info', (req, res) => {
  res.json({ name: 'Hrodulfus Songbook', version: '1.0.0', time: new Date().toISOString() });
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
  console.log('  ♪ Hrodulfus Songbook körs nu ♪');
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
