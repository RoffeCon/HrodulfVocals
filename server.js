const express = require('express');
const QRCode = require('qrcode');
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
const rhymes = new JsonStore('rhymes.json', DATA_DIR); // gammal modell, kvar bara för engångsmigrering
const rhymeWords = new JsonStore('rhymeWords.json', DATA_DIR);
const rhymeLinks = new JsonStore('rhymeLinks.json', DATA_DIR);

// Engångsmigrering: gamla rim (ordgrupper) -> enskilda ord + länkar. Körs bara om det
// finns gammal data och den nya databasen fortfarande är tom.
async function migrateOldRhymes() {
  const old = rhymes.all();
  if (!old.length || rhymeWords.all().length || rhymeLinks.all().length) return;
  const now = new Date().toISOString();
  for (const entry of old) {
    const wordIds = [];
    for (const text of entry.words || []) {
      let word = rhymeWords.all().find(w => w.text.toLowerCase() === text.toLowerCase() && w.language === (entry.language || 'sv'));
      if (!word) {
        word = {
          id: makeId(), text, language: entry.language || 'sv', syllables: entry.syllables || null,
          tags: entry.tags || [], phrases: entry.phrases || [], favorite: !!entry.favorite,
          notes: '', songUsage: entry.songUsage || [], createdAt: now, updatedAt: now,
        };
        await rhymeWords.insert(word);
      }
      wordIds.push(word.id);
    }
    if (wordIds.length >= 2) {
      const legacyTypeMap = { simple: 'perfect', multisyllable: 'perfect', phrase: 'other', assonance: 'assonance', alliteration: 'alliteration' };
      const mappedType = legacyTypeMap[entry.type] || 'perfect';
      await rhymeLinks.insert({
        id: makeId(), wordIds, types: [mappedType], notes: entry.notes || '',
        createdAt: now, updatedAt: now,
      });
    }
  }
  console.log(`  Migrerade ${old.length} gamla rim till det nya ord/länk-formatet.`);
}

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
    .map(({ id, title, composer, artist, key, tempo, capo, tags, notes, updatedAt, groupId, versionLabel }) =>
      ({ id, title, composer, artist, key, tempo, capo, tags, notes, updatedAt, groupId: groupId || id, versionLabel: versionLabel || 'V1' }))
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
    artist: body.artist || '',
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
      artist: raw.artist || '',
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
    ...('artist' in body ? { artist: body.artist } : {}),
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
// Länkar en befintlig låt som en version av en annan - för när två låtar skapats
// oberoende av varandra (t.ex. via "+ Ny låt" två gånger) istället för via
// "+ Ny version", och därför saknar gemensamt groupId.
app.post('/api/songs/:id/link-version', async (req, res) => {
  const src = songs.get(req.params.id);
  const targetId = req.body && req.body.targetId;
  if (!src) return res.status(404).json({ error: 'Låten hittades inte' });
  const target = targetId && songs.get(targetId);
  if (!target) return res.status(400).json({ error: 'Måltåten hittades inte' });
  if (target.id === src.id) return res.status(400).json({ error: 'Kan inte länka en låt till sig själv' });

  const groupId = target.groupId || target.id;
  if (!target.groupId) await songs.update(target.id, { groupId });
  const siblingCount = songs.all().filter(s => (s.groupId || s.id) === groupId && s.id !== src.id).length;
  const versionLabel = (src.versionLabel && src.versionLabel !== 'V1') ? src.versionLabel : `V${siblingCount + 1}`;
  const updated = await songs.update(src.id, { groupId, versionLabel, updatedAt: new Date().toISOString() });
  broadcast({ type: 'songs-changed', reason: 'linked', id: updated.id });
  res.json(updated);
});

// Kopplar loss en låt från sin versionsgrupp igen (om man länkat fel).
app.post('/api/songs/:id/unlink-version', async (req, res) => {
  const src = songs.get(req.params.id);
  if (!src) return res.status(404).json({ error: 'Låten hittades inte' });
  const updated = await songs.update(src.id, { groupId: src.id, versionLabel: 'V1', updatedAt: new Date().toISOString() });
  broadcast({ type: 'songs-changed', reason: 'unlinked', id: updated.id });
  res.json(updated);
});

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
    artist: src.artist,
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

// QR-kod som länkar till en skrivskyddad vy av setlistan - för bandmedlemmar att
// skanna med sina egna telefoner.
app.get('/api/setlists/:id/qr', async (req, res) => {
  const sl = setlists.get(req.params.id);
  if (!sl) return res.status(404).json({ error: 'Setlistan hittades inte' });
  const ips = localIPs();
  const host = ips.length ? ips[0] : req.hostname;
  const url = `http://${host}:${PORT}/setlist-view.html?id=${req.params.id}`;
  try {
    const png = await QRCode.toBuffer(url, { width: 320, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (e) {
    res.status(500).json({ error: 'Kunde inte generera QR-kod' });
  }
});

// ---------- Health / info ----------

// ---------- Rimlexikon (ord + kopplingar) ----------
//
// Varje ord är en egen post (med sitt eget stavelseantal, taggar, favorit osv), och
// rim mellan ord uttrycks som separata "länkar" - en länk kopplar två eller fler ord
// och kan ha flera typer samtidigt (t.ex. både perfekt rim OCH allitteration). Det gör
// att "hat" kan vara perfekt rim med "cat/fat/sat" i en länk, och samtidigt assonans
// med "rap" i en helt annan länk, utan att stavelseantalet för "hat" behöver upprepas
// eller riskera hamna i otakt mellan de två.

const RHYME_TYPES = ['perfect', 'near', 'assonance', 'consonance', 'alliteration', 'other'];

function sanitizeRhymeTypes(arr) {
  const list = Array.isArray(arr) ? arr : [];
  const filtered = list.filter(t => RHYME_TYPES.includes(t));
  return filtered.length ? filtered : ['perfect'];
}

// -- Ord --

app.get('/api/rhyme-words', (req, res) => {
  res.json(rhymeWords.all().slice().sort((a, b) => a.text.localeCompare(b.text, 'sv')));
});

app.post('/api/rhyme-words', async (req, res) => {
  const body = req.body || {};
  const text = String(body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Ordet får inte vara tomt' });
  const language = body.language || 'sv';
  const dup = rhymeWords.all().find(w => w.text.toLowerCase() === text.toLowerCase() && w.language === language);
  if (dup) return res.status(409).json({ error: `"${text}" finns redan (${language})`, duplicateId: dup.id });
  const now = new Date().toISOString();
  const word = {
    id: makeId(),
    text,
    language,
    syllables: body.syllables ? parseInt(body.syllables, 10) || null : null,
    tags: Array.isArray(body.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : [],
    phrases: Array.isArray(body.phrases) ? body.phrases.map(p => String(p).trim()).filter(Boolean) : [],
    favorite: !!body.favorite,
    notes: body.notes || '',
    songUsage: Array.isArray(body.songUsage) ? body.songUsage : [],
    createdAt: now,
    updatedAt: now,
  };
  await rhymeWords.insert(word);
  broadcast({ type: 'rhyme-words-changed', reason: 'created', id: word.id });
  res.status(201).json(word);
});

app.post('/api/rhyme-words/import', async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.words) ? body.words : [];
  const defaultLanguage = body.defaultLanguage || 'sv';
  if (!items.length) return res.status(400).json({ error: 'Inga ord att importera' });
  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;
  for (const raw of items) {
    // Stödjer både enkla textsträngar och objekt med fler fält
    const obj = typeof raw === 'string' ? { text: raw } : (raw || {});
    const text = String(obj.text || '').trim();
    if (!text) continue;
    const language = obj.language || defaultLanguage;
    const dup = rhymeWords.all().find(w => w.text.toLowerCase() === text.toLowerCase() && w.language === language);
    if (dup) { skipped++; continue; }
    const word = {
      id: makeId(),
      text,
      language,
      syllables: obj.syllables ? parseInt(obj.syllables, 10) || null : null,
      tags: Array.isArray(obj.tags) ? obj.tags.map(t => String(t).trim()).filter(Boolean) : [],
      phrases: Array.isArray(obj.phrases) ? obj.phrases.map(p => String(p).trim()).filter(Boolean) : [],
      favorite: !!obj.favorite,
      notes: obj.notes || '',
      songUsage: [],
      createdAt: now,
      updatedAt: now,
    };
    await rhymeWords.insert(word);
    created++;
  }
  if (created) broadcast({ type: 'rhyme-words-changed', reason: 'imported' });
  res.status(201).json({ created, skipped });
});

// Massuppdatering - t.ex. sätt samma stavelseantal eller lägg till en tagg på flera
// markerade ord på en gång.
app.post('/api/rhyme-words/bulk', async (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const patch = body.patch || {};
  if (!ids.length) return res.status(400).json({ error: 'Inga ord markerade' });
  let count = 0;
  for (const id of ids) {
    const existing = rhymeWords.get(id);
    if (!existing) continue;
    const upd = { updatedAt: new Date().toISOString() };
    if ('syllables' in patch) upd.syllables = patch.syllables ? parseInt(patch.syllables, 10) || null : null;
    if ('language' in patch) upd.language = patch.language;
    if ('favorite' in patch) upd.favorite = !!patch.favorite;
    if (patch.addTag) upd.tags = Array.from(new Set([...(existing.tags || []), String(patch.addTag).trim()]));
    await rhymeWords.update(id, upd);
    count++;
  }
  if (count) broadcast({ type: 'rhyme-words-changed', reason: 'bulk-updated' });
  res.json({ updated: count });
});

app.put('/api/rhyme-words/:id', async (req, res) => {
  const existing = rhymeWords.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ordet hittades inte' });
  const body = req.body || {};
  const patch = {
    ...('text' in body && body.text.trim() ? { text: body.text.trim() } : {}),
    ...('language' in body ? { language: body.language } : {}),
    ...('syllables' in body ? { syllables: body.syllables ? parseInt(body.syllables, 10) || null : null } : {}),
    ...('tags' in body ? { tags: Array.isArray(body.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : [] } : {}),
    ...('phrases' in body ? { phrases: Array.isArray(body.phrases) ? body.phrases.map(p => String(p).trim()).filter(Boolean) : [] } : {}),
    ...('favorite' in body ? { favorite: !!body.favorite } : {}),
    ...('notes' in body ? { notes: body.notes } : {}),
    ...('songUsage' in body ? { songUsage: Array.isArray(body.songUsage) ? body.songUsage : [] } : {}),
    updatedAt: new Date().toISOString(),
  };
  const updated = await rhymeWords.update(req.params.id, patch);
  broadcast({ type: 'rhyme-words-changed', reason: 'updated', id: updated.id });
  res.json(updated);
});

app.delete('/api/rhyme-words/:id', async (req, res) => {
  const ok = await rhymeWords.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Ordet hittades inte' });
  // Städa bort ordet ur ev. länkar - och ta bort länkar som blir ensamma kvar (<2 ord).
  for (const link of rhymeLinks.all()) {
    if (!link.wordIds.includes(req.params.id)) continue;
    const newWordIds = link.wordIds.filter(id => id !== req.params.id);
    if (newWordIds.length < 2) await rhymeLinks.remove(link.id);
    else await rhymeLinks.update(link.id, { wordIds: newWordIds, updatedAt: new Date().toISOString() });
  }
  broadcast({ type: 'rhyme-words-changed', reason: 'deleted', id: req.params.id });
  broadcast({ type: 'rhyme-links-changed', reason: 'word-removed' });
  res.status(204).end();
});

// -- Länkar (rimkopplingar mellan ord) --

app.get('/api/rhyme-links', (req, res) => {
  res.json(rhymeLinks.all().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
});

app.post('/api/rhyme-links', async (req, res) => {
  const body = req.body || {};
  const wordIds = Array.isArray(body.wordIds) ? [...new Set(body.wordIds)] : [];
  if (wordIds.length < 2) return res.status(400).json({ error: 'Minst två ord krävs för en rimkoppling' });
  const now = new Date().toISOString();
  const link = {
    id: makeId(),
    wordIds,
    types: sanitizeRhymeTypes(body.types),
    notes: body.notes || '',
    createdAt: now,
    updatedAt: now,
  };
  await rhymeLinks.insert(link);
  broadcast({ type: 'rhyme-links-changed', reason: 'created', id: link.id });
  res.status(201).json(link);
});

app.put('/api/rhyme-links/:id', async (req, res) => {
  const existing = rhymeLinks.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Kopplingen hittades inte' });
  const body = req.body || {};
  const patch = {
    ...('wordIds' in body && Array.isArray(body.wordIds) && body.wordIds.length >= 2 ? { wordIds: [...new Set(body.wordIds)] } : {}),
    ...('types' in body ? { types: sanitizeRhymeTypes(body.types) } : {}),
    ...('notes' in body ? { notes: body.notes } : {}),
    updatedAt: new Date().toISOString(),
  };
  const updated = await rhymeLinks.update(req.params.id, patch);
  broadcast({ type: 'rhyme-links-changed', reason: 'updated', id: updated.id });
  res.json(updated);
});

app.delete('/api/rhyme-links/:id', async (req, res) => {
  const ok = await rhymeLinks.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Kopplingen hittades inte' });
  broadcast({ type: 'rhyme-links-changed', reason: 'deleted', id: req.params.id });
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

// ---------- Live-läge (för en andra skärm, t.ex. Raspberry Pi i replokalen) ----------
// Ligger bara i minnet - helt flyktigt, ingen anledning att spara till disk.

let liveState = { setlistId: null, songIndex: null, updatedAt: null };

app.get('/api/live', (req, res) => {
  res.json(liveState);
});

app.post('/api/live', (req, res) => {
  const body = req.body || {};
  liveState = {
    setlistId: body.setlistId || null,
    songIndex: (typeof body.songIndex === 'number') ? body.songIndex : null,
    updatedAt: new Date().toISOString(),
  };
  broadcast({ type: 'live-changed', ...liveState });
  res.json(liveState);
});

app.get('/api/info', (req, res) => {
  res.json({ name: 'LyricsMaster', version: '1.0.0', time: new Date().toISOString(), port: PORT, ips: localIPs() });
});

// Fullständig backup av all data - för nedladdning i klienten.
app.get('/api/backup', (req, res) => {
  res.json({
    exportedAt: new Date().toISOString(),
    app: 'LyricsMaster',
    version: 2,
    songs: songs.all(),
    setlists: setlists.all(),
    rhymeWords: rhymeWords.all(),
    rhymeLinks: rhymeLinks.all(),
  });
});

// Återställer från en tidigare nedladdad backup. Ersätter ALL nuvarande data - klienten
// ber om bekräftelse innan den anropar det här.
app.post('/api/restore', async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.songs) || !Array.isArray(body.setlists)) {
    return res.status(400).json({ error: 'Filen ser inte ut som en giltig LyricsMaster-backup' });
  }
  await songs.replaceAll(body.songs);
  await setlists.replaceAll(body.setlists);
  if (Array.isArray(body.rhymeWords)) await rhymeWords.replaceAll(body.rhymeWords);
  if (Array.isArray(body.rhymeLinks)) await rhymeLinks.replaceAll(body.rhymeLinks);
  broadcast({ type: 'songs-changed', reason: 'restored' });
  broadcast({ type: 'setlists-changed', reason: 'restored' });
  broadcast({ type: 'rhyme-words-changed', reason: 'restored' });
  broadcast({ type: 'rhyme-links-changed', reason: 'restored' });
  res.json({
    songs: body.songs.length,
    setlists: body.setlists.length,
    rhymeWords: (body.rhymeWords || []).length,
    rhymeLinks: (body.rhymeLinks || []).length,
  });
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

migrateOldRhymes().then(() => {
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
});
