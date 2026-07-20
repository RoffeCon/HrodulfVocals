(function () {
  'use strict';

  const state = {
    songs: [],
    setlists: [],
    currentSongId: null,
    currentSetlistId: null,
    editorReturnView: 'library',
    viewer: {
      songId: null,
      song: null,
      setlistContext: null, // {setlist, index}
      transpose: 0,
      showChords: true,
      fontScale: 1,
      scrolling: false,
      scrollSpeed: 4,
      wakeLock: null,
    },
  };

  // ---------- API helpers ----------

  async function api(path, opts) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) {
      let msg = 'Något gick fel';
      try { const j = await res.json(); msg = j.error || msg; } catch (_) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  const Songs = {
    list: () => api('/api/songs'),
    get: (id) => api('/api/songs/' + id),
    create: (data) => api('/api/songs', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => api('/api/songs/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => api('/api/songs/' + id, { method: 'DELETE' }),
    linkVersion: (id, targetId) => api(`/api/songs/${id}/link-version`, { method: 'POST', body: JSON.stringify({ targetId }) }),
    unlinkVersion: (id) => api(`/api/songs/${id}/unlink-version`, { method: 'POST' }),
  };
  const Setlists = {
    list: () => api('/api/setlists'),
    get: (id) => api('/api/setlists/' + id),
    create: (data) => api('/api/setlists', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => api('/api/setlists/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => api('/api/setlists/' + id, { method: 'DELETE' }),
  };
  const Rhymes = {
    list: () => api('/api/rhymes'),
    create: (data) => api('/api/rhymes', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => api('/api/rhymes/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => api('/api/rhymes/' + id, { method: 'DELETE' }),
  };

  // ---------- Toast ----------

  let toastTimer = null;
  function toast(msg, isError) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // ---------- View routing ----------

  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    if (name !== 'viewer') stopAutoscroll();
    window.scrollTo(0, 0);
  }

  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    showView(btn.dataset.view);
  });

  document.querySelectorAll('.dashboard-tile[data-view]').forEach(tile => {
    tile.addEventListener('click', () => showView(tile.dataset.view));
  });
  document.getElementById('dashboardRhymeTile').addEventListener('click', () => openRhymePanel('edit'));

  (async () => {
    try {
      const info = await api('/api/info');
      if (info.ips && info.ips.length) {
        document.getElementById('dashboardDisplayUrl').textContent = `http://${info.ips[0]}:${info.port}/display.html`;
      }
    } catch (_) {}
  })();

  // ---------- WebSocket live sync ----------

  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    const dot = document.getElementById('connDot');
    ws.onopen = () => dot.classList.remove('offline');
    ws.onclose = () => { dot.classList.add('offline'); setTimeout(connectWS, 2000); };
    ws.onerror = () => dot.classList.add('offline');
    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (_) { return; }
      if (msg.type === 'songs-changed') {
        loadSongs();
        if (state.viewer.songId === msg.id) refreshViewerSong();
      } else if (msg.type === 'setlists-changed') {
        loadSetlists();
      } else if (msg.type === 'rhymes-changed') {
        loadRhymes();
      }
    };
  }

  // ---------- Library ----------

  const libraryExpandedGroups = new Set();

  async function loadSongs() {
    try {
      state.songs = await Songs.list();
      renderLibrary();
    } catch (e) { toast(e.message, true); }
  }

  function songRowHtml(s, { sub = false, expandable = false, expanded = false, versionCount = 0 } = {}) {
    const showNotes = document.getElementById('showNotesToggle').checked;
    const displayField = document.getElementById('listDisplayField').value;
    const primaryInfo = displayField === 'artist' ? s.artist : s.composer;
    const subInfo = [primaryInfo, s.key, s.tempo && s.tempo + ' bpm'].filter(Boolean).map(escapeHtml).join(' · ');
    const badge = sub
      ? `<span class="version-count-badge">${escapeHtml(s.versionLabel || '')}</span>`
      : (versionCount > 1 ? `<span class="version-count-badge">${versionCount} versioner</span>` : '');
    return `
      <li class="song-row${sub ? ' sub-version' : ''}" data-id="${s.id}">
        ${expandable ? `<button class="version-toggle" data-action="toggle-versions" data-group="${s.groupId}" type="button">${expanded ? '▾' : '▸'}</button>` : ''}
        <div class="song-row-main" data-action="view">
          <div class="song-row-title">${escapeHtml(s.title)} ${badge}</div>
          <div class="song-row-sub">${subInfo}</div>
          ${showNotes && s.notes ? `<div class="song-row-notes">${escapeHtml(s.notes)}</div>` : ''}
        </div>
        <div class="row-actions">
          <button class="btn btn-tiny" data-action="rename" type="button">Döp om</button>
          <button class="btn btn-tiny" data-action="edit" type="button">Redigera</button>
          <button class="btn btn-tiny btn-danger" data-action="delete" type="button">🗑</button>
        </div>
      </li>`;
  }

  function populateArtistFilter() {
    const sel = document.getElementById('artistFilter');
    const current = sel.value;
    const artists = Array.from(new Set(state.songs.map(s => (s.artist || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'sv'));
    sel.innerHTML = '<option value="">Alla artister</option>' + artists.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    if (artists.includes(current)) sel.value = current;
  }

  function renderLibrary() {
    const q = document.getElementById('songSearch').value.trim().toLowerCase();
    const artistFilter = document.getElementById('artistFilter').value;
    populateArtistFilter();
    const filtered = state.songs.filter(s => {
      if (artistFilter && (s.artist || '') !== artistFilter) return false;
      if (!q) return true;
      const hay = [s.title, s.composer, s.artist, ...(s.tags || [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
    document.getElementById('libraryEmpty').hidden = state.songs.length > 0;

    const groups = new Map();
    for (const s of filtered) {
      const gid = s.groupId || s.id;
      if (!groups.has(gid)) groups.set(gid, []);
      groups.get(gid).push(s);
    }
    let html = '';
    for (const members of groups.values()) {
      members.sort((a, b) => (a.versionLabel || '').localeCompare(b.versionLabel || '', 'sv', { numeric: true }));
      if (members.length === 1) {
        html += songRowHtml(members[0]);
        continue;
      }
      const gid = members[0].groupId;
      const expanded = libraryExpandedGroups.has(gid);
      const primary = members.find(m => m.versionLabel === 'V1') || members[0];
      html += songRowHtml(primary, { expandable: true, expanded, versionCount: members.length });
      if (expanded) {
        for (const m of members) {
          if (m.id === primary.id) continue;
          html += songRowHtml(m, { sub: true });
        }
      }
    }
    document.getElementById('songList').innerHTML = html;
  }

  document.getElementById('songSearch').addEventListener('input', renderLibrary);
  document.getElementById('showNotesToggle').addEventListener('change', renderLibrary);
  document.getElementById('artistFilter').addEventListener('change', renderLibrary);
  try {
    const savedField = localStorage.getItem('songbook-list-display-field');
    if (savedField) document.getElementById('listDisplayField').value = savedField;
  } catch (_) {}
  document.getElementById('listDisplayField').addEventListener('change', (e) => {
    try { localStorage.setItem('songbook-list-display-field', e.target.value); } catch (_) {}
    renderLibrary();
  });

  function startInlineRename(row, id) {
    const song = state.songs.find(s => s.id === id);
    if (!song) return;
    const titleEl = row.querySelector('.song-row-title');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'row-title-input';
    input.value = song.title;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let saved = false;
    const save = async () => {
      if (saved) return;
      saved = true;
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== song.title) {
        try { await Songs.update(id, { title: newTitle }); toast('Titel ändrad'); } catch (err) { toast(err.message, true); }
      }
      await loadSongs();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); saved = true; renderLibrary(); }
    });
    input.addEventListener('blur', save);
  }

  document.getElementById('songList').addEventListener('click', async (e) => {
    const toggleBtn = e.target.closest('[data-action="toggle-versions"]');
    if (toggleBtn) {
      const gid = toggleBtn.dataset.group;
      if (libraryExpandedGroups.has(gid)) libraryExpandedGroups.delete(gid); else libraryExpandedGroups.add(gid);
      renderLibrary();
      return;
    }
    const row = e.target.closest('.song-row');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('[data-action="edit"]')) {
      openEditor(id, 'library');
    } else if (e.target.closest('[data-action="delete"]')) {
      const song = state.songs.find(s => s.id === id);
      if (!confirm(`Radera "${song ? song.title : 'låten'}" permanent?`)) return;
      try { await Songs.remove(id); toast('Låten raderad'); await loadSongs(); } catch (err) { toast(err.message, true); }
    } else if (e.target.closest('[data-action="rename"]')) {
      startInlineRename(row, id);
    } else {
      openViewer(id, null);
    }
  });

  document.getElementById('newSongBtn').addEventListener('click', () => openEditor(null, 'library'));

  document.getElementById('quickAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('quickAddTitle');
    const title = input.value.trim();
    if (!title) return;
    const dup = state.songs.find(s => s.title.trim().toLowerCase() === title.toLowerCase());
    if (dup && !confirm(`"${title}" finns redan i biblioteket. Lägga till ändå (t.ex. som en ny version)?`)) return;
    try {
      await Songs.create({ title });
      input.value = '';
      toast('Låt tillagd - fyll i resten när du vill');
      await loadSongs();
    } catch (err) { toast(err.message, true); }
  });

  // ---------- Import ----------

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importText').value = '';
    document.getElementById('importPreview').innerHTML = '';
    showView('import');
  });
  document.getElementById('importBack').addEventListener('click', () => showView('library'));

  function parseImportBlocks(raw) {
    const blocks = raw.split(/\n\s*---\s*\n/);
    return blocks.map(b => b.trim()).filter(Boolean).map(block => {
      const lines = block.split('\n');
      const title = lines[0].trim() || 'Namnlös låt';
      const text = lines.slice(1).join('\n').replace(/^\n+/, '');
      return { title, text, lineCount: Math.max(0, lines.length - 1) };
    });
  }

  document.getElementById('importText').addEventListener('input', () => {
    const blocks = parseImportBlocks(document.getElementById('importText').value);
    document.getElementById('importPreview').innerHTML = blocks.length
      ? `<p style="font-size:12.5px;color:var(--text-dim);">${blocks.length} låt(ar) hittade:</p>` +
        blocks.map(b => `<div class="import-preview-item"><div class="title">${escapeHtml(b.title)}</div><div class="lines">${b.lineCount} rader text</div></div>`).join('')
      : '';
  });

  document.getElementById('runImportBtn').addEventListener('click', async () => {
    const blocks = parseImportBlocks(document.getElementById('importText').value);
    if (!blocks.length) { toast('Klistra in text först', true); return; }
    try {
      const result = await api('/api/songs/import', { method: 'POST', body: JSON.stringify({ songs: blocks }) });
      toast(`${result.created} låt(ar) importerade`);
      await loadSongs();
      showView('library');
    } catch (err) { toast(err.message, true); }
  });

  // ---------- Song editor ----------

  function blankSong() {
    return { title: '', composer: '', artist: '', key: '', capo: '', tempo: '', timeSignature: '', tags: [], notes: '', text: '' };
  }

  function siblingsOf(song) {
    const gid = song.groupId || song.id;
    return state.songs.filter(s => (s.groupId || s.id) === gid)
      .sort((a, b) => (a.versionLabel || '').localeCompare(b.versionLabel || '', 'sv', { numeric: true }));
  }

  function renderVersionChips(containerId, song, activeId, onPick) {
    const el = document.getElementById(containerId);
    const sibs = siblingsOf(song);
    if (sibs.length <= 1) { el.innerHTML = ''; return; }
    el.innerHTML = sibs.map(s => `<span class="version-chip ${s.id === activeId ? 'active' : ''}" data-id="${s.id}">${escapeHtml(s.versionLabel || 'V?')}</span>`).join('');
    el.onclick = (e) => {
      const chip = e.target.closest('.version-chip');
      if (chip && chip.dataset.id !== activeId) onPick(chip.dataset.id);
    };
  }

  async function openEditor(id, returnView) {
    state.currentSongId = id;
    state.editorReturnView = returnView;
    let song = blankSong();
    if (id) {
      try { song = await Songs.get(id); } catch (e) { toast(e.message, true); return; }
    }
    document.getElementById('f-title').value = song.title || '';
    document.getElementById('f-composer').value = song.composer || '';
    document.getElementById('f-artist').value = song.artist || '';
    document.getElementById('f-key').value = song.key || '';
    document.getElementById('f-capo').value = song.capo || '';
    document.getElementById('f-tempo').value = song.tempo || '';
    document.getElementById('f-time').value = song.timeSignature || '';
    document.getElementById('f-version').value = song.versionLabel || '';
    document.getElementById('f-tags').value = (song.tags || []).join(', ');
    document.getElementById('f-notes').value = song.notes || '';
    document.getElementById('f-text').value = song.text || '';
    savedSelection = { start: (song.text || '').length, end: (song.text || '').length };
    renderChordChips();
    document.getElementById('deleteSongBtn').hidden = !id;
    document.getElementById('newVersionBtn').hidden = !id;
    document.getElementById('linkVersionBtn').hidden = !id;
    const hasSiblings = id && siblingsOf(song).length > 1;
    document.getElementById('unlinkVersionBtn').hidden = !hasSiblings;
    if (id) renderVersionChips('editorVersionChips', song, id, (pickedId) => openEditor(pickedId, returnView));
    else document.getElementById('editorVersionChips').innerHTML = '';
    showView('editor');
    document.getElementById('f-title').focus();
  }

  document.getElementById('newVersionBtn').addEventListener('click', async () => {
    if (!state.currentSongId) return;
    try {
      const created = await api(`/api/songs/${state.currentSongId}/version`, { method: 'POST', body: JSON.stringify({}) });
      toast('Ny version skapad: ' + created.versionLabel);
      await loadSongs();
      openEditor(created.id, state.editorReturnView);
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('unlinkVersionBtn').addEventListener('click', async () => {
    if (!state.currentSongId) return;
    if (!confirm('Koppla loss den här låten från sina versioner? Låtarna raderas inte, de blir bara fristående igen.')) return;
    try {
      await Songs.unlinkVersion(state.currentSongId);
      toast('Låten är nu fristående');
      await loadSongs();
      openEditor(state.currentSongId, state.editorReturnView);
    } catch (e) { toast(e.message, true); }
  });

  function renderLinkVersionList() {
    const q = document.getElementById('linkVersionSearch').value.trim().toLowerCase();
    const list = document.getElementById('linkVersionList');
    const candidates = state.songs.filter(s => s.id !== state.currentSongId)
      .filter(s => !q || (s.title + ' ' + (s.composer || '')).toLowerCase().includes(q));
    list.innerHTML = candidates.map(s => `
      <li class="song-row compact" data-id="${s.id}">
        <div class="song-row-main" data-action="pick">
          <div class="song-row-title">${escapeHtml(s.title)}</div>
          <div class="song-row-sub">${escapeHtml(s.versionLabel || 'V1')}${s.composer ? ' · ' + escapeHtml(s.composer) : ''}</div>
        </div>
      </li>
    `).join('') || '<p class="empty-state small">Inga andra låtar hittades.</p>';
  }

  document.getElementById('linkVersionBtn').addEventListener('click', () => {
    document.getElementById('linkVersionSearch').value = '';
    renderLinkVersionList();
    document.getElementById('linkVersionModal').hidden = false;
  });
  document.getElementById('closeLinkVersion').addEventListener('click', () => { document.getElementById('linkVersionModal').hidden = true; });
  document.getElementById('linkVersionSearch').addEventListener('input', renderLinkVersionList);
  document.getElementById('linkVersionList').addEventListener('click', async (e) => {
    const row = e.target.closest('.song-row');
    if (!row) return;
    try {
      const updated = await Songs.linkVersion(state.currentSongId, row.dataset.id);
      toast('Länkad som ' + updated.versionLabel);
      document.getElementById('linkVersionModal').hidden = true;
      await loadSongs();
      openEditor(state.currentSongId, state.editorReturnView);
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('editorBack').addEventListener('click', () => showView(state.editorReturnView));

  document.getElementById('saveSongBtn').addEventListener('click', async () => {
    const title = document.getElementById('f-title').value.trim();
    if (!title) { toast('Titel krävs', true); return; }
    if (!state.currentSongId) {
      const dup = state.songs.find(s => s.title.trim().toLowerCase() === title.toLowerCase());
      if (dup && !confirm(`"${title}" finns redan i biblioteket. Skapa ändå?`)) return;
    }
    const data = {
      title,
      composer: document.getElementById('f-composer').value.trim(),
      artist: document.getElementById('f-artist').value.trim(),
      key: document.getElementById('f-key').value.trim(),
      capo: document.getElementById('f-capo').value.trim(),
      tempo: document.getElementById('f-tempo').value.trim(),
      timeSignature: document.getElementById('f-time').value.trim(),
      versionLabel: document.getElementById('f-version').value.trim() || 'V1',
      tags: document.getElementById('f-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      notes: document.getElementById('f-notes').value,
      text: document.getElementById('f-text').value,
    };
    try {
      if (state.currentSongId) {
        await Songs.update(state.currentSongId, data);
        toast('Låten sparad');
      } else {
        const created = await Songs.create(data);
        state.currentSongId = created.id;
        document.getElementById('deleteSongBtn').hidden = false;
        toast('Låten skapad');
      }
      await loadSongs();
      showView(state.editorReturnView);
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('deleteSongBtn').addEventListener('click', async () => {
    if (!state.currentSongId) return;
    if (!confirm('Radera låten permanent?')) return;
    try {
      await Songs.remove(state.currentSongId);
      toast('Låten raderad');
      await loadSongs();
      showView(state.editorReturnView);
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('helpBtn').addEventListener('click', () => { document.getElementById('helpModal').hidden = false; });
  document.getElementById('closeHelp').addEventListener('click', () => { document.getElementById('helpModal').hidden = true; });

  // Mobila webbläsare tappar ofta den markerade texten precis innan ett knappklick
  // hinner läsas av (fokus flyttas till knappen först). Vi sparar därför markeringen
  // kontinuerligt medan den sätts, så vi alltid har rätt ord/rad när knappen trycks.
  const textEditor = document.getElementById('f-text');
  let savedSelection = { start: 0, end: 0 };
  function captureSelection() {
    savedSelection = { start: textEditor.selectionStart, end: textEditor.selectionEnd };
  }
  ['select', 'keyup', 'mouseup', 'touchend', 'input'].forEach(evt => textEditor.addEventListener(evt, captureSelection));

  function applyTextareaInsert(before, placeholder, after) {
    const ta = textEditor;
    const start = savedSelection.start, end = savedSelection.end;
    const value = ta.value;
    const insertText = before + placeholder + after;
    ta.value = value.slice(0, start) + insertText + value.slice(end);
    const selStart = start + before.length;
    const selEnd = selStart + placeholder.length;
    savedSelection = { start: selStart, end: selEnd };

    // {preventScroll:true} stoppar webbläsaren från att hoppa i sidled/höjdled när
    // fältet fokuseras om efter att värdet bytts ut - annars kan hela gränssnittet
    // hoppa iväg på mobil. Vi positionerar textarean själv manuellt istället, så
    // markeringen ändå syns.
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(selStart, selEnd);
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const linesBefore = ta.value.slice(0, selStart).split('\n').length - 1;
    ta.scrollTop = Math.max(0, linesBefore * lineHeight - ta.clientHeight / 2);
    renderChordChips();
  }

  function insertMarkup(kind) {
    const start = savedSelection.start, end = savedSelection.end;
    const value = textEditor.value;
    const selected = value.slice(start, end);
    const atLineStart = start === 0 || value[start - 1] === '\n';
    let before = '', placeholder = selected, after = '';

    if (kind === 'section') {
      before = (atLineStart ? '' : '\n') + '## ';
      placeholder = selected || 'Rubrik';
      after = '\n';
    } else if (kind === 'chord') {
      before = '[';
      placeholder = selected || 'C';
      after = ']';
    } else if (kind === 'comment') {
      before = (atLineStart ? '' : '\n') + '> ';
      placeholder = selected || 'anteckning';
      after = '';
    }
    applyTextareaInsert(before, placeholder, after);
  }

  // Ackord som redan använts i låten visas som snabbvalschips, så du bara behöver
  // skriva ett ackord för hand en gång - resten kan du klicka in.
  function renderChordChips() {
    const seen = [];
    const re = /\[([^\]]+)\]/g;
    let m;
    while ((m = re.exec(textEditor.value))) {
      if (!seen.includes(m[1])) seen.push(m[1]);
    }
    const box = document.getElementById('chordChips');
    box.innerHTML = seen.map(c => `<span class="chord-chip" data-chord="${escapeHtml(c)}">${escapeHtml(c)}</span>`).join('');
  }
  document.getElementById('chordChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chord-chip');
    if (!chip) return;
    applyTextareaInsert('[', chip.dataset.chord, ']');
  });
  textEditor.addEventListener('input', renderChordChips);

  document.querySelectorAll('[data-insert]').forEach(btn => {
    btn.addEventListener('click', () => insertMarkup(btn.dataset.insert));
  });


  // ---------- Export ----------

  function reconstructInlineLine(line) {
    let out = '';
    let last = 0;
    const sorted = line.chords.slice().sort((a, b) => a.pos - b.pos);
    for (const c of sorted) {
      out += line.lyric.slice(last, c.pos) + `[${c.chord}]`;
      last = c.pos;
    }
    out += line.lyric.slice(last);
    return out;
  }

  const SUNO_TAG = { verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', intro: 'Intro', outro: 'Outro' };

  function buildExportText(song, mode) {
    const sections = window.Songbook.parseSections(song.text);
    const out = [song.title];
    if (mode !== 'suno') {
      const meta = [];
      if (song.composer) meta.push('Kompositör: ' + song.composer);
      if (song.key) meta.push('Tonart: ' + song.key);
      if (song.capo) meta.push('Kapo: ' + song.capo);
      if (song.tempo) meta.push(song.tempo + ' bpm');
      if (song.timeSignature) meta.push(song.timeSignature);
      if (meta.length) out.push(meta.join(' · '));
    }
    out.push('');
    for (const sec of sections) {
      if (sec.label) {
        out.push(mode === 'suno' ? `[${SUNO_TAG[sec.type] || sec.label}]` : sec.label.toUpperCase());
      }
      for (const line of sec.lines) {
        if (line.kind === 'blank') out.push('');
        else if (line.kind === 'comment') { if (mode !== 'suno') out.push('(' + line.text + ')'); }
        else out.push(mode === 'withChords' ? reconstructInlineLine(line) : line.lyric);
      }
      out.push('');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function slugFilename(title, suffix) {
    const base = title.normalize('NFKD').replace(/[^\w\- åäöÅÄÖ]/g, '').trim().replace(/\s+/g, '-') || 'latt';
    return `${base}${suffix}.txt`;
  }

  function currentEditorSongSnapshot() {
    return {
      title: document.getElementById('f-title').value.trim() || 'Namnlös låt',
      composer: document.getElementById('f-composer').value.trim(),
      key: document.getElementById('f-key').value.trim(),
      capo: document.getElementById('f-capo').value.trim(),
      tempo: document.getElementById('f-tempo').value.trim(),
      timeSignature: document.getElementById('f-time').value.trim(),
      text: document.getElementById('f-text').value,
    };
  }

  document.getElementById('exportBtn').addEventListener('click', () => { document.getElementById('exportModal').hidden = false; });
  document.getElementById('closeExport').addEventListener('click', () => { document.getElementById('exportModal').hidden = true; });
  document.getElementById('exportPlainBtn').addEventListener('click', () => {
    const song = currentEditorSongSnapshot();
    downloadText(slugFilename(song.title, ''), buildExportText(song, 'withChords'));
    document.getElementById('exportModal').hidden = true;
  });
  document.getElementById('exportLyricsOnlyBtn').addEventListener('click', () => {
    const song = currentEditorSongSnapshot();
    downloadText(slugFilename(song.title, '-text'), buildExportText(song, 'lyricsOnly'));
    document.getElementById('exportModal').hidden = true;
  });
  document.getElementById('exportSunoBtn').addEventListener('click', () => {
    const song = currentEditorSongSnapshot();
    downloadText(slugFilename(song.title, '-suno'), buildExportText(song, 'suno'));
    document.getElementById('exportModal').hidden = true;
  });

  // ---------- Setlists ----------

  async function loadSetlists() {
    try {
      state.setlists = await Setlists.list();
      renderSetlists();
    } catch (e) { toast(e.message, true); }
  }

  function renderSetlists() {
    const q = document.getElementById('setlistSearch').value.trim().toLowerCase();
    const list = document.getElementById('setlistList');
    const filtered = state.setlists.filter(s => !q || s.name.toLowerCase().includes(q) || (s.venue || '').toLowerCase().includes(q));
    document.getElementById('setlistsEmpty').hidden = state.setlists.length > 0;
    list.innerHTML = filtered.map(s => `
      <li class="song-row" data-id="${s.id}">
        <div class="song-row-main" data-action="open">
          <div class="song-row-title">${escapeHtml(s.name)}</div>
          <div class="song-row-sub">${[s.venue, s.date, s.songIds.length + ' låtar'].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        </div>
      </li>
    `).join('');
  }

  document.getElementById('setlistSearch').addEventListener('input', renderSetlists);
  document.getElementById('setlistList').addEventListener('click', (e) => {
    const row = e.target.closest('.song-row');
    if (!row) return;
    openSetlistEditor(row.dataset.id);
  });
  document.getElementById('newSetlistBtn').addEventListener('click', () => openSetlistEditor(null));

  let editingSetlist = null;

  function deriveSongIds(items) {
    return items.filter(i => i.kind === 'song').map(i => i.songId);
  }

  async function openSetlistEditor(id) {
    state.currentSetlistId = id;
    if (id) {
      try { editingSetlist = await Setlists.get(id); } catch (e) { toast(e.message, true); return; }
      if (!Array.isArray(editingSetlist.items)) {
        editingSetlist.items = (editingSetlist.songIds || []).map(sid => ({ kind: 'song', songId: sid }));
      }
    } else {
      editingSetlist = { name: '', venue: '', date: '', notes: '', items: [], songIds: [] };
    }
    document.getElementById('sl-name').value = editingSetlist.name || '';
    document.getElementById('sl-venue').value = editingSetlist.venue || '';
    document.getElementById('sl-date').value = editingSetlist.date || '';
    document.getElementById('sl-notes').value = editingSetlist.notes || '';
    document.getElementById('deleteSetlistBtn').hidden = !id;
    document.getElementById('addSongSearch').value = '';
    renderSetlistBuilder();
    showView('setlist-editor');
  }

  function renderSetlistBuilder() {
    const songsById = Object.fromEntries(state.songs.map(s => [s.id, s]));
    const items = editingSetlist.items;
    editingSetlist.songIds = deriveSongIds(items);
    const list = document.getElementById('setlistSongs');
    document.getElementById('setlistEmptyMsg').hidden = items.length > 0;
    let songNumber = 0;
    list.innerHTML = items.map((item, i) => {
      const upDisabled = i === 0 ? 'disabled' : '';
      const downDisabled = i === items.length - 1 ? 'disabled' : '';
      if (item.kind === 'group') {
        return `
          <li class="reorder-row group-header" data-idx="${i}">
            <span class="drag-handle" data-idx="${i}">⠿</span>
            <span class="reorder-index">§</span>
            <input class="reorder-title group-label-input" data-idx="${i}" type="text" value="${escapeHtml(item.label)}" placeholder="Grupprubrik, t.ex. E-stämning">
            <span class="reorder-btns">
              <button class="btn btn-tiny" data-act="up" data-idx="${i}" ${upDisabled}>▲</button>
              <button class="btn btn-tiny" data-act="down" data-idx="${i}" ${downDisabled}>▼</button>
              <button class="btn btn-tiny btn-danger" data-act="remove" data-idx="${i}">✕</button>
            </span>
          </li>`;
      }
      const s = songsById[item.songId];
      if (!s) return '';
      songNumber++;
      return `
        <li class="reorder-row" data-idx="${i}">
          <span class="drag-handle" data-idx="${i}">⠿</span>
          <span class="reorder-index">${songNumber}</span>
          <span class="reorder-title" data-act="start" data-idx="${i}" data-song-index="${songNumber - 1}" style="cursor:pointer;">${escapeHtml(s.title)}</span>
          <span class="reorder-meta">${escapeHtml(s.key || '')}</span>
          <span class="reorder-btns">
            <button class="btn btn-tiny" data-act="up" data-idx="${i}" ${upDisabled}>▲</button>
            <button class="btn btn-tiny" data-act="down" data-idx="${i}" ${downDisabled}>▼</button>
            <button class="btn btn-tiny btn-danger" data-act="remove" data-idx="${i}">✕</button>
          </span>
        </li>`;
    }).join('');

    const q = document.getElementById('addSongSearch').value.trim().toLowerCase();
    const addList = document.getElementById('addSongList');
    const usedIds = new Set(editingSetlist.songIds);
    const available = state.songs.filter(s => !usedIds.has(s.id))
      .filter(s => !q || (s.title + ' ' + (s.composer || '')).toLowerCase().includes(q));
    addList.innerHTML = available.map(s => `
      <li class="song-row compact" data-id="${s.id}">
        <div class="song-row-main" data-action="add">
          <div class="song-row-title">${escapeHtml(s.title)}</div>
          <div class="song-row-sub">${escapeHtml(s.composer || '')}</div>
        </div>
        <button class="btn btn-tiny btn-accent" data-action="add">+ Lägg till</button>
      </li>
    `).join('');
  }

  document.getElementById('addSongSearch').addEventListener('input', renderSetlistBuilder);

  document.getElementById('addSongList').addEventListener('click', (e) => {
    const row = e.target.closest('.song-row');
    if (!row) return;
    editingSetlist.items.push({ kind: 'song', songId: row.dataset.id });
    renderSetlistBuilder();
  });

  document.getElementById('addGroupHeaderBtn').addEventListener('click', () => {
    editingSetlist.items.push({ kind: 'group', label: 'Ny grupp' });
    renderSetlistBuilder();
    const inputs = document.querySelectorAll('.group-label-input');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });

  document.getElementById('setlistSongs').addEventListener('click', (e) => {
    const idx = parseInt(e.target.dataset.idx, 10);
    if (Number.isNaN(idx)) return;
    const act = e.target.dataset.act;
    const items = editingSetlist.items;
    if (act === 'start') {
      const songIndex = parseInt(e.target.dataset.songIndex, 10);
      const songIds = deriveSongIds(items);
      if (!songIds.length || Number.isNaN(songIndex)) return;
      editingSetlist.songIds = songIds;
      openViewer(songIds[songIndex], { setlist: editingSetlist, index: songIndex });
      return;
    }
    if (act === 'up' && idx > 0) {
      [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
    } else if (act === 'down' && idx < items.length - 1) {
      [items[idx + 1], items[idx]] = [items[idx], items[idx + 1]];
    } else if (act === 'remove') {
      items.splice(idx, 1);
    } else {
      return;
    }
    renderSetlistBuilder();
  });

  document.getElementById('setlistSongs').addEventListener('change', (e) => {
    if (!e.target.classList.contains('group-label-input')) return;
    const idx = parseInt(e.target.dataset.idx, 10);
    if (editingSetlist.items[idx]) editingSetlist.items[idx].label = e.target.value.trim() || 'Grupp';
  });

  // Dra-och-släpp-omordning via pekhändelser (funkar med både mus och touch,
  // till skillnad från native HTML5 drag-and-drop som är opålitligt på mobil).
  let dragState = null;
  const setlistSongsEl = document.getElementById('setlistSongs');

  setlistSongsEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const fromIdx = parseInt(handle.dataset.idx, 10);
    dragState = { fromIdx, overIdx: fromIdx };
    handle.closest('.reorder-row').classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });

  setlistSongsEl.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const rows = [...setlistSongsEl.querySelectorAll('.reorder-row')];
    rows.forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const idx = parseInt(row.dataset.idx, 10);
        const topHalf = e.clientY < rect.top + rect.height / 2;
        row.classList.add(topHalf ? 'drag-over-top' : 'drag-over-bottom');
        dragState.overIdx = topHalf ? idx : idx + 1;
        break;
      }
    }
  });

  function endDrag() {
    if (!dragState) return;
    setlistSongsEl.querySelectorAll('.reorder-row').forEach(r => r.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom'));
    const { fromIdx, overIdx } = dragState;
    dragState = null;
    if (overIdx === fromIdx || overIdx === fromIdx + 1) return;
    const items = editingSetlist.items;
    const [moved] = items.splice(fromIdx, 1);
    const insertAt = overIdx > fromIdx ? overIdx - 1 : overIdx;
    items.splice(insertAt, 0, moved);
    renderSetlistBuilder();
  }
  setlistSongsEl.addEventListener('pointerup', endDrag);
  setlistSongsEl.addEventListener('pointercancel', endDrag);

  document.getElementById('setlistEditorBack').addEventListener('click', () => showView('setlists'));

  document.getElementById('saveSetlistBtn').addEventListener('click', async () => {
    const name = document.getElementById('sl-name').value.trim();
    if (!name) { toast('Namn krävs', true); return; }
    const data = {
      name,
      venue: document.getElementById('sl-venue').value.trim(),
      date: document.getElementById('sl-date').value,
      notes: document.getElementById('sl-notes').value,
      items: editingSetlist.items,
    };
    try {
      if (state.currentSetlistId) {
        await Setlists.update(state.currentSetlistId, data);
        toast('Setlistan sparad');
      } else {
        const created = await Setlists.create(data);
        state.currentSetlistId = created.id;
        document.getElementById('deleteSetlistBtn').hidden = false;
        toast('Setlistan skapad');
      }
      await loadSetlists();
      showView('setlists');
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('deleteSetlistBtn').addEventListener('click', async () => {
    if (!state.currentSetlistId) return;
    if (!confirm('Radera setlistan permanent? Låtarna i biblioteket påverkas inte.')) return;
    try {
      await Setlists.remove(state.currentSetlistId);
      toast('Setlistan raderad');
      await loadSetlists();
      showView('setlists');
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('startPerformance').addEventListener('click', () => {
    const songIds = deriveSongIds(editingSetlist.items);
    if (!songIds.length) { toast('Lägg till minst en låt först', true); return; }
    editingSetlist.songIds = songIds;
    openViewer(songIds[0], { setlist: editingSetlist, index: 0 });
  });

  function openPrintWindow(bodyHtml, title, extraStyle) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
      <style>
        body{font-family:Georgia,'Times New Roman',serif;max-width:720px;margin:40px auto;color:#161207;}
        h1{margin-bottom:2px;} .meta{color:#666;margin-bottom:24px;}
        h2{border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:34px;page-break-after:avoid;}
        .group{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#a06a1f;margin-top:30px;border-top:1px solid #eee;padding-top:10px;}
        pre{white-space:pre-wrap;font-family:'Courier New',monospace;font-size:13.5px;line-height:1.5;}
        .songmeta{color:#666;font-size:13px;margin-bottom:8px;}
        ol{padding-left:22px;} li{padding:4px 0;font-size:15px;}
        ${extraStyle || ''}
      </style></head><body>${bodyHtml}</body></html>`;
    const win = window.open('', '_blank');
    if (!win) { toast('Popup blockerad - tillåt popup-fönster för att skriva ut', true); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  document.getElementById('printSetlistBtn').addEventListener('click', async () => {
    const items = editingSetlist.items;
    const songIds = deriveSongIds(items);
    if (!songIds.length) { toast('Lägg till minst en låt först', true); return; }
    try {
      const fullSongs = {};
      for (const id of songIds) fullSongs[id] = await Songs.get(id);
      let html = `<h1>${escapeHtml(editingSetlist.name || 'Setlista')}</h1>`;
      html += `<div class="meta">${[editingSetlist.venue, editingSetlist.date].filter(Boolean).map(escapeHtml).join(' · ')}</div>`;
      let n = 0;
      for (const item of items) {
        if (item.kind === 'group') {
          html += `<div class="group">${escapeHtml(item.label)}</div>`;
        } else {
          const s = fullSongs[item.songId];
          if (!s) continue;
          n++;
          // Varje låt börjar på ett eget blad, utom den allra första.
          html += `<div style="${n > 1 ? 'page-break-before:always;' : ''}">`;
          html += `<h2>${n}. ${escapeHtml(s.title)}</h2>`;
          const metaBits = [s.key, s.capo && ('Kapo ' + s.capo), s.tempo && (s.tempo + ' bpm')].filter(Boolean);
          if (metaBits.length) html += `<div class="songmeta">${escapeHtml(metaBits.join(' · '))}</div>`;
          html += `<pre>${escapeHtml(s.text || '')}</pre></div>`;
        }
      }
      openPrintWindow(html, editingSetlist.name || 'Setlista');
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('printSetlistTitlesBtn').addEventListener('click', async () => {
    const items = editingSetlist.items;
    const songIds = deriveSongIds(items);
    if (!songIds.length) { toast('Lägg till minst en låt först', true); return; }
    try {
      const fullSongs = {};
      for (const id of songIds) fullSongs[id] = await Songs.get(id);
      let html = `<h1>${escapeHtml(editingSetlist.name || 'Setlista')}</h1>`;
      html += `<div class="meta">${[editingSetlist.venue, editingSetlist.date].filter(Boolean).map(escapeHtml).join(' · ')}</div>`;
      let n = 0;
      let listOpen = false;
      for (const item of items) {
        if (item.kind === 'group') {
          if (listOpen) { html += '</ol>'; listOpen = false; }
          html += `<div class="group">${escapeHtml(item.label)}</div>`;
        } else {
          const s = fullSongs[item.songId];
          if (!s) continue;
          n++;
          if (!listOpen) { html += '<ol>'; listOpen = true; }
          const metaBits = [s.key, s.tempo && (s.tempo + ' bpm')].filter(Boolean);
          html += `<li><strong>${escapeHtml(s.title)}</strong>${metaBits.length ? ' - ' + escapeHtml(metaBits.join(' · ')) : ''}</li>`;
        }
      }
      if (listOpen) html += '</ol>';
      openPrintWindow(html, (editingSetlist.name || 'Setlista') + ' - låtlista');
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('printSongBtn').addEventListener('click', () => {
    const song = currentEditorSongSnapshot();
    const metaBits = [song.composer, song.key, song.capo && ('Kapo ' + song.capo), song.tempo && (song.tempo + ' bpm'), song.timeSignature].filter(Boolean);
    const html = `<h1>${escapeHtml(song.title)}</h1>
      <div class="meta">${escapeHtml(metaBits.join(' · '))}</div>
      <pre>${escapeHtml(song.text || '')}</pre>`;
    openPrintWindow(html, song.title);
  });

  // ---------- Viewer / scenläge ----------

  async function openViewer(songId, setlistContext) {
    state.viewer.songId = songId;
    state.viewer.setlistContext = setlistContext;
    state.viewer.transpose = 0;
    document.getElementById('transVal').textContent = '0';
    try {
      state.viewer.song = await Songs.get(songId);
    } catch (e) { toast(e.message, true); return; }
    renderViewer();
    showView('viewer');
    requestWakeLock();
    if (setlistContext) pushLiveState();
  }

  // Skickar vidare vilken låt som spelas till en ev. ansluten skärm (t.ex. Raspberry
  // Pi i replokalen) via /api/live, som sen når displayen genom websocket-broadcasten.
  function pushLiveState() {
    const ctx = state.viewer.setlistContext;
    const payload = ctx
      ? { setlistId: ctx.setlist.id, songIndex: ctx.index }
      : { setlistId: null, songIndex: null };
    api('/api/live', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {});
  }

  async function refreshViewerSong() {
    if (!state.viewer.songId) return;
    try {
      state.viewer.song = await Songs.get(state.viewer.songId);
      renderViewer();
    } catch (_) {}
  }

  function renderViewer() {
    const song = state.viewer.song;
    if (!song) return;
    document.getElementById('viewerTitle').textContent = song.title;
    const preferFlats = window.Songbook.prefersFlats(song.key);
    const transposedKey = state.viewer.transpose
      ? window.Songbook.transposeChord(song.key, state.viewer.transpose, preferFlats)
      : song.key;
    const metaParts = [];
    if (song.composer) metaParts.push(song.composer);
    if (song.key) metaParts.push('Tonart: ' + transposedKey + (state.viewer.transpose ? ` (orig. ${song.key})` : ''));
    if (song.capo) metaParts.push('Kapo: ' + song.capo);
    if (song.tempo) metaParts.push(song.tempo + ' bpm');
    if (song.timeSignature) metaParts.push(song.timeSignature);
    document.getElementById('viewerMeta').textContent = metaParts.join(' · ');
    renderVersionChips('viewerVersionChips', song, song.id, (pickedId) => openViewer(pickedId, state.viewer.setlistContext));

    document.getElementById('songBody').innerHTML = window.Songbook.renderSong(song.text, {
      transpose: state.viewer.transpose,
      showChords: state.viewer.showChords,
      preferFlats,
    });
    document.getElementById('songBody').style.setProperty('--song-font-scale', state.viewer.fontScale);
    // scrollTop återställs inte automatiskt av webbläsaren bara för att innehållet
    // byts ut - utan detta visas nästa låt "redan nerskrollad" (kvar på gamla positionen).
    document.getElementById('songBody').scrollTop = 0;

    const nav = document.getElementById('setlistNav');
    if (state.viewer.setlistContext) {
      nav.hidden = false;
      const { setlist, index } = state.viewer.setlistContext;
      document.getElementById('setlistPos').textContent = `${index + 1} / ${setlist.songIds.length}`;
      document.getElementById('prevSongBtn').disabled = index === 0;
      document.getElementById('nextSongBtn').disabled = index >= setlist.songIds.length - 1;
    } else {
      nav.hidden = true;
    }
  }

  document.getElementById('viewerBack').addEventListener('click', () => {
    releaseWakeLock();
    stopAutoscroll();
    exitGigMode();
    if (state.viewer.setlistContext) {
      api('/api/live', { method: 'POST', body: JSON.stringify({ setlistId: null, songIndex: null }) }).catch(() => {});
    }
    showView(state.viewer.setlistContext ? 'setlist-editor' : 'library');
  });

  document.getElementById('editFromViewer').addEventListener('click', () => {
    if (state.viewer.songId) openEditor(state.viewer.songId, 'viewer');
  });

  document.getElementById('toggleChords').addEventListener('click', (e) => {
    state.viewer.showChords = !state.viewer.showChords;
    e.target.textContent = state.viewer.showChords ? 'Visa' : 'Dold';
    renderViewer();
  });

  document.getElementById('transUp').addEventListener('click', () => {
    state.viewer.transpose++;
    document.getElementById('transVal').textContent = String(state.viewer.transpose);
    renderViewer();
  });
  document.getElementById('transDown').addEventListener('click', () => {
    state.viewer.transpose--;
    document.getElementById('transVal').textContent = String(state.viewer.transpose);
    renderViewer();
  });

  document.getElementById('fontUp').addEventListener('click', () => {
    state.viewer.fontScale = Math.min(3, state.viewer.fontScale + 0.1);
    document.getElementById('songBody').style.setProperty('--song-font-scale', state.viewer.fontScale);
  });
  document.getElementById('fontDown').addEventListener('click', () => {
    state.viewer.fontScale = Math.max(0.55, state.viewer.fontScale - 0.1);
    document.getElementById('songBody').style.setProperty('--song-font-scale', state.viewer.fontScale);
  });

  document.getElementById('prevSongBtn').addEventListener('click', () => stepSetlist(-1));
  document.getElementById('nextSongBtn').addEventListener('click', () => stepSetlist(1));

  function stepSetlist(dir) {
    const ctx = state.viewer.setlistContext;
    if (!ctx) return;
    const newIndex = ctx.index + dir;
    if (newIndex < 0 || newIndex >= ctx.setlist.songIds.length) return;
    ctx.index = newIndex;
    openViewer(ctx.setlist.songIds[newIndex], ctx);
  }

  // Autoscroll
  let scrollRAF = null;
  let scrollEndTimer = null;
  let scrollEndCountdownInterval = null;

  function loadScrollSettings() {
    try {
      const speed = localStorage.getItem('songbook-scroll-speed');
      if (speed) state.viewer.scrollSpeed = parseInt(speed, 10) || 4;
      document.getElementById('scrollEndBehavior').value = localStorage.getItem('songbook-scroll-end-behavior') || 'stay';
      document.getElementById('scrollEndDelay').value = localStorage.getItem('songbook-scroll-end-delay') || '8';
    } catch (_) {}
    document.getElementById('scrollSpeedVal').textContent = state.viewer.scrollSpeed;
  }

  function stopAutoscroll() {
    state.viewer.scrolling = false;
    document.getElementById('toggleScroll').textContent = 'Pausad';
    document.getElementById('gigToggleScroll').textContent = 'Pausad';
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    scrollRAF = null;
    cancelScrollEndCountdown();
  }

  function startAutoscroll() {
    state.viewer.scrolling = true;
    document.getElementById('toggleScroll').textContent = 'Rullar';
    document.getElementById('gigToggleScroll').textContent = 'Rullar';
    document.getElementById('scrollEndBanner').hidden = true;
    const container = document.getElementById('songBody');
    let last = performance.now();
    let pixelRemainder = 0;
    function tick(now) {
      if (!state.viewer.scrolling) return;
      const dt = now - last;
      last = now;
      const pxPerSec = state.viewer.scrollSpeed * 4;
      // scrollTop rundas till heltal av webbläsaren när den sätts, så små steg vid låg
      // hastighet (t.ex. 0.06px/frame vid hastighet 1) försvinner annars helt och
      // scrollningen ser ut att stå still. Vi samlar därför på oss delpixlar själva
      // och flyttar bara scrollTop när minst en hel pixel har samlats ihop.
      pixelRemainder += pxPerSec * (dt / 1000);
      const whole = Math.floor(pixelRemainder);
      if (whole >= 1) {
        container.scrollTop += whole;
        pixelRemainder -= whole;
      }
      const atBottom = container.scrollTop >= container.scrollHeight - container.clientHeight - 2;
      if (atBottom) {
        stopAutoscroll();
        handleScrollEnd();
        return;
      }
      scrollRAF = requestAnimationFrame(tick);
    }
    scrollRAF = requestAnimationFrame(tick);
    requestWakeLock();
  }

  function cancelScrollEndCountdown() {
    if (scrollEndTimer) clearTimeout(scrollEndTimer);
    if (scrollEndCountdownInterval) clearInterval(scrollEndCountdownInterval);
    scrollEndTimer = null;
    scrollEndCountdownInterval = null;
    document.getElementById('scrollEndBanner').hidden = true;
  }

  function handleScrollEnd() {
    const behavior = document.getElementById('scrollEndBehavior').value;
    if (behavior === 'top') {
      document.getElementById('songBody').scrollTop = 0;
      return;
    }
    if (behavior === 'next' && state.viewer.setlistContext) {
      const ctx = state.viewer.setlistContext;
      if (ctx.index >= ctx.setlist.songIds.length - 1) return; // sista låten, inget att gå vidare till
      let secondsLeft = parseInt(document.getElementById('scrollEndDelay').value, 10) || 8;
      const banner = document.getElementById('scrollEndBanner');
      const text = document.getElementById('scrollEndText');
      banner.hidden = false;
      text.textContent = `Nästa låt om ${secondsLeft}s…`;
      scrollEndCountdownInterval = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) {
          // Bara den visuella nedräkningen ska stanna här - INTE anropa
          // cancelScrollEndCountdown(), för den rensar även scrollEndTimer nedan,
          // vilket avbröt själva bytet till nästa låt precis innan det skulle hända.
          clearInterval(scrollEndCountdownInterval);
          scrollEndCountdownInterval = null;
          text.textContent = 'Byter låt…';
          return;
        }
        text.textContent = `Nästa låt om ${secondsLeft}s…`;
      }, 1000);
      scrollEndTimer = setTimeout(() => {
        scrollEndTimer = null;
        banner.hidden = true;
        stepSetlist(1);
      }, secondsLeft * 1000);
    }
    // 'stay' - gör inget, låten stannar kvar i botten
  }

  document.getElementById('scrollEndCancel').addEventListener('click', cancelScrollEndCountdown);

  document.getElementById('toggleScroll').addEventListener('click', () => {
    if (state.viewer.scrolling) stopAutoscroll(); else startAutoscroll();
  });

  function setScrollSpeed(val) {
    state.viewer.scrollSpeed = Math.max(1, Math.min(20, val));
    document.getElementById('scrollSpeedVal').textContent = state.viewer.scrollSpeed;
    document.getElementById('gigScrollVal').textContent = state.viewer.scrollSpeed;
    try { localStorage.setItem('songbook-scroll-speed', state.viewer.scrollSpeed); } catch (_) {}
  }
  document.getElementById('scrollSpeedUp').addEventListener('click', () => setScrollSpeed(state.viewer.scrollSpeed + 1));
  document.getElementById('scrollSpeedDown').addEventListener('click', () => setScrollSpeed(state.viewer.scrollSpeed - 1));

  document.getElementById('scrollSettingsBtn').addEventListener('click', () => {
    const box = document.getElementById('scrollSettingsBox');
    box.hidden = !box.hidden;
  });
  document.getElementById('scrollEndBehavior').addEventListener('change', (e) => {
    try { localStorage.setItem('songbook-scroll-end-behavior', e.target.value); } catch (_) {}
  });
  document.getElementById('scrollEndDelay').addEventListener('change', (e) => {
    try { localStorage.setItem('songbook-scroll-end-delay', e.target.value); } catch (_) {}
  });

  // ---- Gigläge (helskärm, minimala kontroller) ----

  document.getElementById('gigModeBtn').addEventListener('click', async () => {
    const view = document.getElementById('view-viewer');
    view.classList.add('gig-mode');
    document.getElementById('gigModeControls').hidden = false;
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (_) {}
  });

  async function exitGigMode() {
    document.getElementById('view-viewer').classList.remove('gig-mode');
    document.getElementById('gigModeControls').hidden = true;
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (_) {}
  }
  document.getElementById('gigExitBtn').addEventListener('click', exitGigMode);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      document.getElementById('view-viewer').classList.remove('gig-mode');
      document.getElementById('gigModeControls').hidden = true;
    }
  });

  document.getElementById('gigToggleScroll').addEventListener('click', () => {
    if (state.viewer.scrolling) stopAutoscroll(); else startAutoscroll();
  });
  document.getElementById('gigScrollUp').addEventListener('click', () => setScrollSpeed(state.viewer.scrollSpeed + 1));
  document.getElementById('gigScrollDown').addEventListener('click', () => setScrollSpeed(state.viewer.scrollSpeed - 1));
  document.getElementById('gigSettingsBtn').addEventListener('click', () => {
    const box = document.getElementById('scrollSettingsBox');
    box.hidden = !box.hidden;
  });


  loadScrollSettings();

  // Wake Lock (håll skärmen tänd på scen)
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        state.viewer.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (_) { /* tyst - inte kritiskt */ }
  }
  function releaseWakeLock() {
    if (state.viewer.wakeLock) {
      state.viewer.wakeLock.release().catch(() => {});
      state.viewer.wakeLock = null;
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && document.getElementById('view-viewer').classList.contains('active')) {
      requestWakeLock();
    }
  });

  // ---------- Ljust/mörkt läge ----------

  function applyTheme(theme) {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('songbook-theme', theme); } catch (_) {}
  }
  document.getElementById('themeToggle').addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    applyTheme(isLight ? 'dark' : 'light');
  });

  // ---------- Info / IP / backup ----------

  document.getElementById('infoToggle').addEventListener('click', async () => {
    document.getElementById('infoModal').hidden = false;
    const box = document.getElementById('infoIpBox');
    box.textContent = 'Hämtar IP-adress…';
    try {
      const info = await api('/api/info');
      if (info.ips && info.ips.length) {
        box.innerHTML = info.ips.map(ip => `<div>Från datorn: <strong>http://${ip}:${info.port}</strong></div>`).join('') +
          `<div style="margin-top:4px;">På telefonen: <strong>http://localhost:${info.port}</strong></div>`;
      } else {
        box.textContent = 'Ingen wifi-IP hittades - kontrollera att telefonen är ansluten till nätverket.';
      }
    } catch (e) {
      box.textContent = 'Kunde inte hämta IP just nu.';
    }
  });
  document.getElementById('closeInfo').addEventListener('click', () => { document.getElementById('infoModal').hidden = true; });

  document.getElementById('manualConnectBtn').addEventListener('click', () => {
    let val = document.getElementById('manualConnectInput').value.trim();
    if (!val) { toast('Skriv in en adress', true); return; }
    val = val.replace(/^https?:\/\//, '');
    if (!val.includes(':')) val += ':8420';
    window.location.href = `http://${val}/`;
  });
  document.getElementById('manualConnectInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('manualConnectBtn').click(); }
  });

  document.getElementById('downloadBackupBtn').addEventListener('click', async () => {
    try {
      const backup = await api('/api/backup');
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `lyricsmaster-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Backup nedladdad');
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('restoreBackupBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('restoreFileInput');
    const file = fileInput.files[0];
    if (!file) { toast('Välj en backupfil först', true); return; }
    if (!confirm('Detta ersätter ALL nuvarande data (låtar, setlistor, rim) med innehållet i filen. Fortsätta?')) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await api('/api/restore', { method: 'POST', body: JSON.stringify(data) });
      toast(`Återställt: ${result.songs} låtar, ${result.setlists} setlistor, ${result.rhymeWords} rimord`);
      document.getElementById('infoModal').hidden = true;
      fileInput.value = '';
      await loadSongs();
      await loadSetlists();
      await loadRhymes();
      showView('dashboard');
    } catch (e) { toast('Kunde inte återställa: ' + e.message, true); }
  });

  // ---------- Öva utantill (inlärningsläge) ----------

  const practice = {
    songId: null,
    title: '',
    lines: [],
    index: 0,
    attempted: 0,
    firstTryCorrect: 0,
    returnView: 'viewer',
  };

  function tokenizeDisplay(str) {
    return str.trim().split(/\s+/).filter(Boolean);
  }
  function normWord(w) {
    return w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  }

  // Ordvis diff mellan facit och det användaren skrev, baserad på längsta gemensamma delsekvens.
  function diffLine(correctRaw, userRaw) {
    const correctTokens = tokenizeDisplay(correctRaw);
    const userTokens = tokenizeDisplay(userRaw);
    const cNorm = correctTokens.map(normWord);
    const uNorm = userTokens.map(normWord);
    const n = cNorm.length, m = uNorm.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = (cNorm[i] === uNorm[j] && cNorm[i] !== '') ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (cNorm[i] === uNorm[j] && cNorm[i] !== '') { ops.push({ type: 'match', text: correctTokens[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'missing', text: correctTokens[i] }); i++; }
      else { ops.push({ type: 'extra', text: userTokens[j] }); j++; }
    }
    while (i < n) { ops.push({ type: 'missing', text: correctTokens[i] }); i++; }
    while (j < m) { ops.push({ type: 'extra', text: userTokens[j] }); j++; }
    return { ops, fullyCorrect: ops.every(o => o.type === 'match') && ops.length > 0 };
  }

  function buildPracticeLines(text) {
    const sections = window.Songbook.parseSections(text);
    const lines = [];
    for (const sec of sections) {
      let labelShown = false;
      for (const line of sec.lines) {
        if (line.kind === 'lyric' && line.lyric.trim()) {
          lines.push({ text: line.lyric, sectionLabel: !labelShown ? sec.label : null });
          labelShown = true;
        }
      }
    }
    return lines;
  }

  async function openPractice(songId, returnView) {
    let song;
    try { song = await Songs.get(songId); } catch (e) { toast(e.message, true); return; }
    const lines = buildPracticeLines(song.text);
    if (!lines.length) { toast('Den här låten har ingen text att öva på än', true); return; }
    practice.songId = songId;
    practice.title = song.title;
    practice.lines = lines;
    practice.index = 0;
    practice.attempted = 0;
    practice.firstTryCorrect = 0;
    practice.returnView = returnView;
    document.getElementById('practiceTitle').textContent = song.title;
    document.getElementById('practiceLog').innerHTML = '';
    document.getElementById('practiceSummary').hidden = true;
    document.getElementById('practiceInputArea').hidden = false;
    showView('practice');
    renderPracticeStep();
  }

  function renderPracticeStep() {
    const total = practice.lines.length;
    document.getElementById('practiceProgress').textContent = `Rad ${practice.index + 1} av ${total}`;
    const line = practice.lines[practice.index];
    if (line && line.sectionLabel) {
      const div = document.createElement('div');
      div.className = 'practice-divider';
      div.textContent = line.sectionLabel;
      document.getElementById('practiceLog').appendChild(div);
    }
    const input = document.getElementById('practiceInput');
    input.value = '';
    input.disabled = false;
    document.getElementById('checkLineBtn').hidden = false;
    document.getElementById('revealLineBtn').hidden = false;
    document.getElementById('nextLineBtn').hidden = true;
    input.focus();
  }

  function appendPracticeLog(statusClass, html) {
    const row = document.createElement('div');
    row.className = 'practice-line ' + statusClass;
    row.innerHTML = html;
    const log = document.getElementById('practiceLog');
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function renderDiffHtml(ops) {
    return ops.map(op => {
      if (op.type === 'match') return `<span class="diff-match">${escapeHtml(op.text)}</span>`;
      if (op.type === 'missing') return `<span class="diff-missing">${escapeHtml(op.text)}</span>`;
      return `<span class="diff-extra">${escapeHtml(op.text)}</span>`;
    }).join(' ');
  }

  function finishPracticeLine(statusClass, html) {
    appendPracticeLog(statusClass, html);
    document.getElementById('practiceInput').disabled = true;
    document.getElementById('checkLineBtn').hidden = true;
    document.getElementById('revealLineBtn').hidden = true;
    document.getElementById('nextLineBtn').hidden = false;
    document.getElementById('nextLineBtn').focus();
  }

  function checkCurrentLine() {
    const line = practice.lines[practice.index];
    const userText = document.getElementById('practiceInput').value;
    if (!userText.trim()) { toast('Skriv något, eller tryck Visa rad', true); return; }
    const { ops, fullyCorrect } = diffLine(line.text, userText);
    practice.attempted++;
    if (fullyCorrect) {
      practice.firstTryCorrect++;
      finishPracticeLine('correct', `<span class="diff-match">${escapeHtml(line.text)}</span>`);
    } else {
      finishPracticeLine('partial', renderDiffHtml(ops));
    }
  }

  // Mobila tangentbord skickar sällan en pålitlig "Enter"-keydown (IME-hantering gör
  // den opålitlig), men en formulär-submit triggas tillförlitligt av både knapptryck
  // och tangentbordets Retur/Klar-knapp. submitter är null vid Enter, annars knappen -
  // så vi kan låta av/på-växeln bara styra Enter-vägen, inte det uttryckliga knapptrycket.
  document.getElementById('practiceInputArea').addEventListener('submit', (e) => {
    e.preventDefault();
    const viaEnterKey = !e.submitter;
    if (viaEnterKey && !document.getElementById('enterToggle').checked) return;
    checkCurrentLine();
  });

  try {
    const saved = localStorage.getItem('songbook-practice-enter');
    if (saved !== null) document.getElementById('enterToggle').checked = saved === '1';
  } catch (_) {}
  document.getElementById('enterToggle').addEventListener('change', (e) => {
    try { localStorage.setItem('songbook-practice-enter', e.target.checked ? '1' : '0'); } catch (_) {}
  });

  document.getElementById('revealLineBtn').addEventListener('click', () => {
    const line = practice.lines[practice.index];
    practice.attempted++;
    finishPracticeLine('revealed', `<span class="diff-match">${escapeHtml(line.text)}</span>`);
  });

  document.getElementById('nextLineBtn').addEventListener('click', () => {
    practice.index++;
    if (practice.index >= practice.lines.length) {
      showPracticeSummary();
    } else {
      renderPracticeStep();
    }
  });

  function showPracticeSummary() {
    document.getElementById('practiceInputArea').hidden = true;
    document.getElementById('practiceSummary').hidden = false;
    document.getElementById('practiceScoreText').textContent =
      `${practice.firstTryCorrect} av ${practice.lines.length} rader rätt på första försöket.`;
  }

  document.getElementById('practiceBack').addEventListener('click', () => showView(practice.returnView));
  document.getElementById('practiceSummaryBack').addEventListener('click', () => showView(practice.returnView));
  document.getElementById('practiceAgainBtn').addEventListener('click', () => openPractice(practice.songId, practice.returnView));
  document.getElementById('restartPractice').addEventListener('click', () => {
    if (confirm('Börja om övningen från början?')) openPractice(practice.songId, practice.returnView);
  });

  document.getElementById('practiceFromViewer').addEventListener('click', () => {
    if (state.viewer.songId) openPractice(state.viewer.songId, 'viewer');
  });

  // ---------- Utils ----------

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---------- PWA / Service worker ----------

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }

  // ---------- Rimlexikon (ord + kopplingar) ----------

  state.rhymeWords = [];
  state.rhymeLinks = [];
  let editingWordId = null;
  const rhymeSelected = new Set();

  const RHYME_LANG_LABEL = { sv: 'Svenska', en: 'Engelska', fr: 'Franska', de: 'Tyska', other: 'Annat' };
  const RHYME_TYPE_LABEL = { perfect: 'Perfekt rim', near: 'Närrim', assonance: 'Assonans', consonance: 'Konsonans', alliteration: 'Allitteration', other: 'Annat' };
  const RHYME_TYPES = Object.keys(RHYME_TYPE_LABEL);

  const RhymeWords = {
    list: () => api('/api/rhyme-words'),
    create: (data) => api('/api/rhyme-words', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => api('/api/rhyme-words/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => api('/api/rhyme-words/' + id, { method: 'DELETE' }),
    bulk: (ids, patch) => api('/api/rhyme-words/bulk', { method: 'POST', body: JSON.stringify({ ids, patch }) }),
  };
  const RhymeLinks = {
    list: () => api('/api/rhyme-links'),
    create: (data) => api('/api/rhyme-links', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id) => api('/api/rhyme-links/' + id, { method: 'DELETE' }),
  };

  async function loadRhymes() {
    try {
      const [words, links] = await Promise.all([RhymeWords.list(), RhymeLinks.list()]);
      state.rhymeWords = words;
      state.rhymeLinks = links;
      renderRhymeWordList();
      renderRhymeLinkList();
      renderRhymeLookup();
    } catch (e) { toast(e.message, true); }
  }

  function openRhymePanel(mode) {
    document.getElementById('rhymePanel').hidden = false;
    setRhymeMode(mode || 'search');
    loadRhymes();
  }
  function closeRhymePanel() { document.getElementById('rhymePanel').hidden = true; }
  document.getElementById('rhymeToggle').addEventListener('click', () => openRhymePanel());
  document.getElementById('closeRhymePanel').addEventListener('click', closeRhymePanel);

  function setRhymeMode(mode) {
    document.getElementById('rhymeSearchPane').hidden = mode !== 'search';
    document.getElementById('rhymeEditPane').hidden = mode !== 'edit';
    document.getElementById('rhymeModeSearch').classList.toggle('active', mode === 'search');
    document.getElementById('rhymeModeEdit').classList.toggle('active', mode === 'edit');
  }
  document.getElementById('rhymeModeSearch').addEventListener('click', () => setRhymeMode('search'));
  document.getElementById('rhymeModeEdit').addEventListener('click', () => setRhymeMode('edit'));

  // ---- Sök: "vad rimmar på X?" - grupperat efter stavelseantal ----

  function renderRhymeLookup() {
    const q = document.getElementById('rhymeLookupInput').value.trim().toLowerCase();
    const box = document.getElementById('rhymeLookupResults');
    if (!q) { box.innerHTML = ''; return; }
    const wordsById = Object.fromEntries(state.rhymeWords.map(w => [w.id, w]));
    const matchedWords = state.rhymeWords.filter(w => w.text.toLowerCase() === q);

    if (!matchedWords.length) {
      const partial = state.rhymeWords.filter(w => w.text.toLowerCase().includes(q));
      box.innerHTML = partial.length
        ? '<p class="empty-state small">Inget exakt ord, men liknande: ' + partial.map(w => escapeHtml(w.text)).join(', ') + '</p>'
        : '<p class="empty-state small">Inga ord hittades.</p>';
      return;
    }

    const connections = new Map(); // wordId -> Set(types)
    for (const mw of matchedWords) {
      for (const link of state.rhymeLinks) {
        if (!link.wordIds.includes(mw.id)) continue;
        for (const wid of link.wordIds) {
          if (wid === mw.id) continue;
          if (!connections.has(wid)) connections.set(wid, new Set());
          link.types.forEach(t => connections.get(wid).add(t));
        }
      }
    }
    if (!connections.size) {
      box.innerHTML = `<p class="empty-state small">Inga rimkopplingar hittades för "${escapeHtml(q)}" än.</p>`;
      return;
    }

    const groups = new Map(); // stavelser (nummer eller '?') -> [{word, types}]
    for (const [wid, types] of connections) {
      const w = wordsById[wid];
      if (!w) continue;
      const key = w.syllables || '?';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ word: w, types: [...types] });
    }
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      if (a === '?') return 1;
      if (b === '?') return -1;
      return a - b;
    });
    box.innerHTML = sortedKeys.map(key => {
      const label = key === '?' ? 'Okänt stavelseantal' : (key + (key === 1 ? ' stavelse' : ' stavelser'));
      const items = groups.get(key).map(({ word, types }) => `
        <div class="rhyme-lookup-item">
          <span class="matched-word">${escapeHtml(word.text)}</span>
          ${types.map(t => `<span class="rhyme-type-badge">${RHYME_TYPE_LABEL[t] || t}</span>`).join('')}
        </div>`).join('');
      return `<div class="rhyme-syllable-group-label">${label}</div>${items}`;
    }).join('');
  }
  document.getElementById('rhymeLookupInput').addEventListener('input', renderRhymeLookup);

  // ---- Hantera: ord ----

  function resetRhymeWordForm() {
    editingWordId = null;
    document.getElementById('rhymeFormTitle').textContent = 'Nytt ord';
    document.getElementById('rhymeWordText').value = '';
    document.getElementById('rhymeWordSyllables').value = '';
    document.getElementById('rhymeWordLanguage').value = 'sv';
    document.getElementById('rhymeWordPhrases').value = '';
    document.getElementById('rhymeWordTags').value = '';
    document.getElementById('rhymeWordNotes').value = '';
    document.getElementById('rhymeWordFavorite').checked = false;
    document.getElementById('addRhymeWordBtn').textContent = '+ Lägg till ord';
    document.getElementById('cancelRhymeWordEdit').hidden = true;
  }

  function getFilteredRhymeWords() {
    const q = document.getElementById('rhymeSearch').value.trim().toLowerCase();
    const langFilter = document.getElementById('rhymeFilterLanguage').value;
    const favOnly = document.getElementById('rhymeFavoritesOnly').checked;
    return state.rhymeWords.filter(w => {
      if (langFilter && w.language !== langFilter) return false;
      if (favOnly && !w.favorite) return false;
      if (!q) return true;
      const hay = [w.text, (w.phrases || []).join(' '), (w.tags || []).join(' '), w.notes || ''].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderRhymeBulkBar() {
    const bar = document.getElementById('rhymeBulkBar');
    if (rhymeSelected.size === 0) { bar.hidden = true; return; }
    bar.hidden = false;
    document.getElementById('rhymeBulkCount').textContent = `${rhymeSelected.size} markerade`;
  }

  function renderRhymeWordList() {
    const filtered = getFilteredRhymeWords();
    const songsById = Object.fromEntries(state.songs.map(s => [s.id, s]));
    const canLink = !!state.currentSongId;
    document.getElementById('rhymeWordList').innerHTML = filtered.map(w => {
      const checked = rhymeSelected.has(w.id) ? 'checked' : '';
      const alreadyLinked = (w.songUsage || []).some(u => u.songId === state.currentSongId);
      const usageChips = (w.songUsage || []).map(u => {
        const s = songsById[u.songId];
        const label = s ? s.title : 'Okänd låt';
        return `<span class="rhyme-usage-chip" data-song="${u.songId}" data-word="${w.id}">${escapeHtml(label)}<span class="remove-x" data-action="unlink-song" data-song="${u.songId}" data-word="${w.id}">✕</span></span>`;
      }).join('');
      const tagChips = (w.tags || []).map(t => `<span class="rhyme-tag-chip">${escapeHtml(t)}</span>`).join('');
      const langOptions = Object.keys(RHYME_LANG_LABEL).map(code => `<option value="${code}" ${w.language === code ? 'selected' : ''}>${RHYME_LANG_LABEL[code]}</option>`).join('');
      return `
        <li class="rhyme-item" data-id="${w.id}">
          <div class="rhyme-item-row">
            <input type="checkbox" class="rhyme-select" data-id="${w.id}" ${checked}>
            <button class="rhyme-star ${w.favorite ? 'is-favorite' : ''}" data-action="toggle-fav" type="button" title="Favorit">${w.favorite ? '★' : '☆'}</button>
            <div class="rhyme-item-main">
              <div class="rhyme-item-words">${escapeHtml(w.text)}</div>
              <div class="rhyme-item-meta"><span class="lang-badge lang-${w.language}">${RHYME_LANG_LABEL[w.language] || w.language}</span> · ${w.syllables ? w.syllables + (w.syllables === 1 ? ' stavelse' : ' stavelser') : 'stavelser okänt'}</div>
              ${w.phrases && w.phrases.length ? `<div class="rhyme-item-phrases">${escapeHtml(w.phrases.join(', '))}</div>` : ''}
              ${tagChips ? `<div class="rhyme-item-tags">${tagChips}</div>` : ''}
              ${w.notes ? `<div class="rhyme-item-notes">${escapeHtml(w.notes)}</div>` : ''}
              ${usageChips ? `<div class="rhyme-item-usage">${usageChips}</div>` : ''}
              <div class="rhyme-inline-selects">
                <select class="rhyme-inline-lang" data-id="${w.id}">${langOptions}</select>
                <input type="number" class="rhyme-inline-syllables" data-id="${w.id}" min="1" max="20" value="${w.syllables || ''}" placeholder="stavelser" style="width:80px;">
              </div>
              <div class="rhyme-item-actions">
                <button class="btn btn-tiny" data-action="edit-word" type="button">Redigera</button>
                <button class="btn btn-tiny" data-action="link-song" type="button" ${!canLink || alreadyLinked ? 'disabled' : ''}>${alreadyLinked ? 'Kopplad till låt' : '+ Koppla nuvarande låt'}</button>
                <button class="btn btn-tiny btn-danger" data-action="delete-word" type="button">✕</button>
              </div>
            </div>
          </div>
        </li>`;
    }).join('') || '<p class="empty-state small">Inga ord ännu.</p>';
    renderRhymeBulkBar();
  }

  document.getElementById('rhymeSearch').addEventListener('input', renderRhymeWordList);
  ['rhymeFilterLanguage', 'rhymeFavoritesOnly'].forEach(id => document.getElementById(id).addEventListener('change', renderRhymeWordList));

  document.getElementById('addRhymeWordBtn').addEventListener('click', async () => {
    const text = document.getElementById('rhymeWordText').value.trim();
    if (!text) { toast('Skriv ett ord', true); return; }
    const data = {
      text,
      language: document.getElementById('rhymeWordLanguage').value,
      syllables: document.getElementById('rhymeWordSyllables').value ? parseInt(document.getElementById('rhymeWordSyllables').value, 10) : null,
      phrases: document.getElementById('rhymeWordPhrases').value.split(',').map(p => p.trim()).filter(Boolean),
      tags: document.getElementById('rhymeWordTags').value.split(',').map(t => t.trim()).filter(Boolean),
      notes: document.getElementById('rhymeWordNotes').value.trim(),
      favorite: document.getElementById('rhymeWordFavorite').checked,
    };
    try {
      if (editingWordId) {
        await RhymeWords.update(editingWordId, data);
        toast('Ordet uppdaterat');
      } else {
        await RhymeWords.create(data);
        toast('Ordet tillagt');
      }
      resetRhymeWordForm();
      await loadRhymes();
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById('cancelRhymeWordEdit').addEventListener('click', resetRhymeWordForm);

  document.getElementById('rhymeWordList').addEventListener('click', async (e) => {
    const item = e.target.closest('.rhyme-item');
    if (!item) return;
    const id = item.dataset.id;
    const word = state.rhymeWords.find(w => w.id === id);
    if (!word) return;

    if (e.target.closest('[data-action="edit-word"]')) {
      editingWordId = id;
      document.getElementById('rhymeFormTitle').textContent = 'Redigerar ord';
      document.getElementById('rhymeWordText').value = word.text;
      document.getElementById('rhymeWordSyllables').value = word.syllables || '';
      document.getElementById('rhymeWordLanguage').value = word.language;
      document.getElementById('rhymeWordPhrases').value = (word.phrases || []).join(', ');
      document.getElementById('rhymeWordTags').value = (word.tags || []).join(', ');
      document.getElementById('rhymeWordNotes').value = word.notes || '';
      document.getElementById('rhymeWordFavorite').checked = !!word.favorite;
      document.getElementById('addRhymeWordBtn').textContent = 'Spara ändringar';
      document.getElementById('cancelRhymeWordEdit').hidden = false;
      document.getElementById('rhymePanel').querySelector('.rhyme-panel-body').scrollTop = 0;
    } else if (e.target.closest('[data-action="delete-word"]')) {
      if (!confirm(`Radera "${word.text}" permanent? Rimkopplingar som blir för korta tas bort automatiskt.`)) return;
      try { await RhymeWords.remove(id); toast('Ordet raderat'); rhymeSelected.delete(id); await loadRhymes(); } catch (err) { toast(err.message, true); }
    } else if (e.target.closest('[data-action="toggle-fav"]')) {
      try { await RhymeWords.update(id, { favorite: !word.favorite }); await loadRhymes(); } catch (err) { toast(err.message, true); }
    } else if (e.target.closest('[data-action="link-song"]')) {
      if (!state.currentSongId) return;
      const usage = (word.songUsage || []).concat([{ songId: state.currentSongId }]);
      try { await RhymeWords.update(id, { songUsage: usage }); await loadRhymes(); } catch (err) { toast(err.message, true); }
    } else if (e.target.closest('[data-action="unlink-song"]')) {
      const songId = e.target.closest('[data-action="unlink-song"]').dataset.song;
      const usage = (word.songUsage || []).filter(u => u.songId !== songId);
      try { await RhymeWords.update(id, { songUsage: usage }); await loadRhymes(); } catch (err) { toast(err.message, true); }
    } else if (e.target.closest('.rhyme-usage-chip')) {
      const songId = e.target.closest('.rhyme-usage-chip').dataset.song;
      openEditor(songId, 'library');
    }
  });

  document.getElementById('rhymeWordList').addEventListener('change', async (e) => {
    if (e.target.classList.contains('rhyme-select')) {
      const id = e.target.dataset.id;
      if (e.target.checked) rhymeSelected.add(id); else rhymeSelected.delete(id);
      renderRhymeBulkBar();
      return;
    }
    if (e.target.classList.contains('rhyme-inline-lang')) {
      try { await RhymeWords.update(e.target.dataset.id, { language: e.target.value }); await loadRhymes(); } catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.classList.contains('rhyme-inline-syllables')) {
      const val = e.target.value ? parseInt(e.target.value, 10) : null;
      try { await RhymeWords.update(e.target.dataset.id, { syllables: val }); await loadRhymes(); } catch (err) { toast(err.message, true); }
    }
  });

  document.getElementById('rhymeSelectAll').addEventListener('change', (e) => {
    const filtered = getFilteredRhymeWords();
    if (e.target.checked) filtered.forEach(w => rhymeSelected.add(w.id));
    else filtered.forEach(w => rhymeSelected.delete(w.id));
    renderRhymeWordList();
  });

  document.getElementById('rhymeBulkClear').addEventListener('click', () => {
    rhymeSelected.clear();
    document.getElementById('rhymeSelectAll').checked = false;
    renderRhymeWordList();
  });

  document.getElementById('rhymeBulkDelete').addEventListener('click', async () => {
    if (!rhymeSelected.size) return;
    if (!confirm(`Radera ${rhymeSelected.size} markerade ord permanent?`)) return;
    try {
      await Promise.all([...rhymeSelected].map(id => RhymeWords.remove(id)));
      toast('Markerade ord raderade');
      rhymeSelected.clear();
      await loadRhymes();
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('rhymeBulkSetSyllables').addEventListener('click', async () => {
    const val = document.getElementById('rhymeBulkSyllables').value;
    if (!val || !rhymeSelected.size) return;
    try {
      await RhymeWords.bulk([...rhymeSelected], { syllables: parseInt(val, 10) });
      toast('Stavelser uppdaterade');
      document.getElementById('rhymeBulkSyllables').value = '';
      await loadRhymes();
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('rhymeBulkLanguage').addEventListener('change', async (e) => {
    const lang = e.target.value;
    if (!lang || !rhymeSelected.size) return;
    try {
      await RhymeWords.bulk([...rhymeSelected], { language: lang });
      toast('Språk uppdaterat för markerade ord');
      e.target.value = '';
      await loadRhymes();
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('rhymeBulkAddTag').addEventListener('click', async () => {
    const tag = document.getElementById('rhymeBulkTag').value.trim();
    if (!tag || !rhymeSelected.size) return;
    try {
      await RhymeWords.bulk([...rhymeSelected], { addTag: tag });
      toast('Tagg tillagd på markerade ord');
      document.getElementById('rhymeBulkTag').value = '';
      await loadRhymes();
    } catch (err) { toast(err.message, true); }
  });

  // ---- Skapa rimkoppling mellan markerade ord ----

  document.getElementById('rhymeBulkCreateLink').addEventListener('click', () => {
    if (rhymeSelected.size < 2) { toast('Markera minst två ord', true); return; }
    const checksBox = document.getElementById('rhymeLinkTypeChecks');
    checksBox.innerHTML = RHYME_TYPES.map((t, i) => `
      <label><input type="checkbox" value="${t}" ${i === 0 ? 'checked' : ''}> ${RHYME_TYPE_LABEL[t]}</label>
    `).join('');
    document.getElementById('rhymeLinkNotes').value = '';
    document.getElementById('rhymeLinkTypeModal').hidden = false;
  });
  document.getElementById('cancelRhymeLinkType').addEventListener('click', () => { document.getElementById('rhymeLinkTypeModal').hidden = true; });
  document.getElementById('confirmRhymeLinkType').addEventListener('click', async () => {
    const types = [...document.querySelectorAll('#rhymeLinkTypeChecks input:checked')].map(cb => cb.value);
    if (!types.length) { toast('Välj minst en typ', true); return; }
    try {
      await RhymeLinks.create({
        wordIds: [...rhymeSelected],
        types,
        notes: document.getElementById('rhymeLinkNotes').value.trim(),
      });
      toast('Rimkoppling skapad');
      document.getElementById('rhymeLinkTypeModal').hidden = true;
      rhymeSelected.clear();
      await loadRhymes();
    } catch (e) { toast(e.message, true); }
  });

  // ---- Länkar-lista ----

  function renderRhymeLinkList() {
    const wordsById = Object.fromEntries(state.rhymeWords.map(w => [w.id, w]));
    const box = document.getElementById('rhymeLinkList');
    if (!state.rhymeLinks.length) {
      box.innerHTML = '<p class="empty-state small">Inga kopplingar ännu - markera minst två ord ovan och tryck "Rimmar med varandra".</p>';
      return;
    }
    box.innerHTML = state.rhymeLinks.map(link => {
      const words = link.wordIds.map(id => wordsById[id]).filter(Boolean).map(w => escapeHtml(w.text)).join(' / ');
      const typeBadges = link.types.map(t => `<span class="rhyme-type-badge">${RHYME_TYPE_LABEL[t] || t}</span>`).join('');
      return `
        <li class="rhyme-item" data-id="${link.id}">
          <div class="rhyme-item-words">${words}</div>
          <div class="rhyme-item-meta">${typeBadges}</div>
          ${link.notes ? `<div class="rhyme-item-notes">${escapeHtml(link.notes)}</div>` : ''}
          <div class="rhyme-item-actions">
            <button class="btn btn-tiny btn-danger" data-action="delete-link" type="button">Radera koppling</button>
          </div>
        </li>`;
    }).join('');
  }
  document.getElementById('rhymeLinkList').addEventListener('click', async (e) => {
    const item = e.target.closest('.rhyme-item');
    if (!item) return;
    if (e.target.closest('[data-action="delete-link"]')) {
      if (!confirm('Radera rimkopplingen? Orden i sig raderas inte.')) return;
      try { await RhymeLinks.remove(item.dataset.id); toast('Kopplingen raderad'); await loadRhymes(); } catch (err) { toast(err.message, true); }
    }
  });

  // ---- Import / export ----

  document.getElementById('exportRhymesBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ words: state.rhymeWords, links: state.rhymeLinks }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rimlexikon-backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  document.getElementById('showRhymeImport').addEventListener('click', () => {
    const box = document.getElementById('rhymeImportBox');
    box.hidden = !box.hidden;
  });
  document.getElementById('runRhymeImportBtn').addEventListener('click', async () => {
    const raw = document.getElementById('rhymeImportText').value.trim();
    if (!raw) { toast('Klistra in JSON först', true); return; }
    let words;
    try { words = JSON.parse(raw); } catch (err) { toast('Ogiltig JSON: ' + err.message, true); return; }
    if (!Array.isArray(words)) { toast('JSON:en måste vara en lista', true); return; }
    try {
      const result = await api('/api/rhyme-words/import', {
        method: 'POST',
        body: JSON.stringify({ words, defaultLanguage: document.getElementById('rhymeImportLanguage').value }),
      });
      toast(`${result.created} ord importerade${result.skipped ? `, ${result.skipped} dubbletter hoppades över` : ''}`);
      document.getElementById('rhymeImportText').value = '';
      document.getElementById('rhymeImportBox').hidden = true;
      await loadRhymes();
    } catch (err) { toast(err.message, true); }
  });

  // Sök rim i låtar: två ord, radavstånd
  document.getElementById('proxSearchBtn').addEventListener('click', async () => {
    const w1 = document.getElementById('proxWord1').value.trim();
    const w2 = document.getElementById('proxWord2').value.trim();
    const radius = document.getElementById('proxRadius').value || 4;
    if (!w1 || !w2) { toast('Skriv in båda orden', true); return; }
    try {
      const results = await api(`/api/search/proximity?word1=${encodeURIComponent(w1)}&word2=${encodeURIComponent(w2)}&radius=${encodeURIComponent(radius)}`);
      const box = document.getElementById('proxResults');
      if (!results.length) { box.innerHTML = '<p class="empty-state small">Inga träffar.</p>'; return; }
      box.innerHTML = results.map(r => `
        <div class="prox-result" data-song="${r.songId}">
          <div class="title">${escapeHtml(r.title)} ${r.versionLabel ? `<span class="version-count-badge">${escapeHtml(r.versionLabel)}</span>` : ''}</div>
          ${r.occurrences.map(o => `<div class="line-pair">"${escapeHtml(o.line1Text)}" ↔ "${escapeHtml(o.line2Text)}" (${o.distance} rad${o.distance === 1 ? '' : 'er'})</div>`).join('')}
        </div>`).join('');
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('proxResults').addEventListener('click', (e) => {
    const row = e.target.closest('.prox-result');
    if (row) openEditor(row.dataset.song, 'library');
  });



  // ---------- Init ----------

  loadSongs();
  loadSetlists();
  loadRhymes();
  connectWS();
})();
