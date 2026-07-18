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
    const subInfo = [s.composer, s.key, s.tempo && s.tempo + ' bpm'].filter(Boolean).map(escapeHtml).join(' · ');
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

  function renderLibrary() {
    const q = document.getElementById('songSearch').value.trim().toLowerCase();
    const filtered = state.songs.filter(s => {
      if (!q) return true;
      const hay = [s.title, s.composer, ...(s.tags || [])].join(' ').toLowerCase();
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
    return { title: '', composer: '', key: '', capo: '', tempo: '', timeSignature: '', tags: [], notes: '', text: '' };
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
    document.getElementById('f-key').value = song.key || '';
    document.getElementById('f-capo').value = song.capo || '';
    document.getElementById('f-tempo').value = song.tempo || '';
    document.getElementById('f-time').value = song.timeSignature || '';
    document.getElementById('f-version').value = song.versionLabel || '';
    document.getElementById('f-tags').value = (song.tags || []).join(', ');
    document.getElementById('f-notes').value = song.notes || '';
    document.getElementById('f-text').value = song.text || '';
    savedSelection = { start: (song.text || '').length, end: (song.text || '').length };
    document.getElementById('deleteSongBtn').hidden = !id;
    document.getElementById('newVersionBtn').hidden = !id;
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

  document.getElementById('editorBack').addEventListener('click', () => showView(state.editorReturnView));

  document.getElementById('saveSongBtn').addEventListener('click', async () => {
    const title = document.getElementById('f-title').value.trim();
    if (!title) { toast('Titel krävs', true); return; }
    const data = {
      title,
      composer: document.getElementById('f-composer').value.trim(),
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

  function insertMarkup(kind) {
    const ta = textEditor;
    const start = savedSelection.start, end = savedSelection.end;
    const value = ta.value;
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
  }

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
          <span class="reorder-index">${songNumber}</span>
          <span class="reorder-title">${escapeHtml(s.title)}</span>
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
  function stopAutoscroll() {
    state.viewer.scrolling = false;
    document.getElementById('toggleScroll').textContent = 'Av';
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    scrollRAF = null;
  }
  function startAutoscroll() {
    state.viewer.scrolling = true;
    document.getElementById('toggleScroll').textContent = 'På';
    const container = document.getElementById('songBody');
    let last = performance.now();
    function tick(now) {
      if (!state.viewer.scrolling) return;
      const dt = now - last;
      last = now;
      const pxPerSec = state.viewer.scrollSpeed * 8;
      container.scrollTop += pxPerSec * (dt / 1000);
      scrollRAF = requestAnimationFrame(tick);
    }
    scrollRAF = requestAnimationFrame(tick);
    requestWakeLock();
  }
  document.getElementById('toggleScroll').addEventListener('click', () => {
    if (state.viewer.scrolling) stopAutoscroll(); else startAutoscroll();
  });
  document.getElementById('scrollSpeed').addEventListener('input', (e) => {
    state.viewer.scrollSpeed = parseInt(e.target.value, 10);
  });

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

  // ---------- Rimlexikon ----------

  state.rhymes = [];
  let editingRhymeId = null;
  const rhymeSelected = new Set();

  const RHYME_LANG_LABEL = { sv: 'Svenska', en: 'Engelska', fr: 'Franska', de: 'Tyska', other: 'Annat' };
  const RHYME_TYPE_LABEL = { simple: 'Enkelt rim', multisyllable: 'Flerstavigt', phrase: 'Frasrim', assonance: 'Assonans', alliteration: 'Allitteration' };

  async function loadRhymes() {
    try { state.rhymes = await Rhymes.list(); renderRhymeList(); } catch (e) { toast(e.message, true); }
  }

  function openRhymePanel() { document.getElementById('rhymePanel').hidden = false; loadRhymes(); }
  function closeRhymePanel() { document.getElementById('rhymePanel').hidden = true; }
  document.getElementById('rhymeToggle').addEventListener('click', openRhymePanel);
  document.getElementById('closeRhymePanel').addEventListener('click', closeRhymePanel);

  function resetRhymeForm() {
    editingRhymeId = null;
    document.getElementById('rhymeFormTitle').textContent = 'Nytt rim';
    document.getElementById('rhymeWords').value = '';
    document.getElementById('rhymeLanguage').value = 'sv';
    document.getElementById('rhymeType').value = 'simple';
    document.getElementById('rhymePhrases').value = '';
    document.getElementById('rhymeTags').value = '';
    document.getElementById('rhymeNotes').value = '';
    document.getElementById('rhymeFavorite').checked = false;
    document.getElementById('addRhymeBtn').textContent = '+ Lägg till rim';
    document.getElementById('cancelRhymeEdit').hidden = true;
  }

  function getFilteredRhymes() {
    const q = document.getElementById('rhymeSearch').value.trim().toLowerCase();
    const typeFilter = document.getElementById('rhymeFilterType').value;
    const langFilter = document.getElementById('rhymeFilterLanguage').value;
    const favOnly = document.getElementById('rhymeFavoritesOnly').checked;
    return state.rhymes.filter(r => {
      if (typeFilter && r.type !== typeFilter) return false;
      if (langFilter && r.language !== langFilter) return false;
      if (favOnly && !r.favorite) return false;
      if (!q) return true;
      const hay = [r.words.join(' '), (r.phrases || []).join(' '), (r.tags || []).join(' '), r.notes || ''].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderRhymeBulkBar() {
    const bar = document.getElementById('rhymeBulkBar');
    if (rhymeSelected.size === 0) { bar.hidden = true; return; }
    bar.hidden = false;
    document.getElementById('rhymeBulkCount').textContent = `${rhymeSelected.size} markerade`;
  }

  function renderRhymeList() {
    const songsById = Object.fromEntries(state.songs.map(s => [s.id, s]));
    const filtered = getFilteredRhymes();
    const canLink = !!state.currentSongId;
    document.getElementById('rhymeList').innerHTML = filtered.map(r => {
      const alreadyLinked = (r.songUsage || []).some(u => u.songId === state.currentSongId);
      const usageChips = (r.songUsage || []).map(u => {
        const s = songsById[u.songId];
        const label = s ? s.title : 'Okänd låt';
        return `<span class="rhyme-usage-chip" data-song="${u.songId}" data-rhyme="${r.id}">${escapeHtml(label)}<span class="remove-x" data-action="unlink" data-song="${u.songId}" data-rhyme="${r.id}">✕</span></span>`;
      }).join('');
      const tagChips = (r.tags || []).map(t => `<span class="rhyme-tag-chip">${escapeHtml(t)}</span>`).join('');
      const checked = rhymeSelected.has(r.id) ? 'checked' : '';
      const langOptions = Object.keys(RHYME_LANG_LABEL).map(code => `<option value="${code}" ${r.language === code ? 'selected' : ''}>${RHYME_LANG_LABEL[code]}</option>`).join('');
      const typeOptions = Object.keys(RHYME_TYPE_LABEL).map(code => `<option value="${code}" ${r.type === code ? 'selected' : ''}>${RHYME_TYPE_LABEL[code]}</option>`).join('');
      return `
        <li class="rhyme-item" data-id="${r.id}">
          <div class="rhyme-item-row">
            <input type="checkbox" class="rhyme-select" data-id="${r.id}" ${checked}>
            <button class="rhyme-star ${r.favorite ? 'is-favorite' : ''}" data-action="toggle-fav" type="button" title="Favorit">${r.favorite ? '★' : '☆'}</button>
            <div class="rhyme-item-main">
              <div class="rhyme-item-words">${escapeHtml(r.words.join(' / '))}</div>
              <div class="rhyme-item-meta"><span class="lang-badge lang-${r.language}">${RHYME_LANG_LABEL[r.language] || r.language}</span> · ${RHYME_TYPE_LABEL[r.type] || r.type}</div>
              ${r.phrases && r.phrases.length ? `<div class="rhyme-item-phrases">${escapeHtml(r.phrases.join(', '))}</div>` : ''}
              ${tagChips ? `<div class="rhyme-item-tags">${tagChips}</div>` : ''}
              ${r.notes ? `<div class="rhyme-item-notes">${escapeHtml(r.notes)}</div>` : ''}
              ${usageChips ? `<div class="rhyme-item-usage">${usageChips}</div>` : ''}
              <div class="rhyme-inline-selects">
                <select class="rhyme-inline-lang" data-id="${r.id}">${langOptions}</select>
                <select class="rhyme-inline-type" data-id="${r.id}">${typeOptions}</select>
              </div>
              <div class="rhyme-item-actions">
                <button class="btn btn-tiny" data-action="edit-rhyme" type="button">Redigera</button>
                <button class="btn btn-tiny" data-action="link-song" type="button" ${!canLink || alreadyLinked ? 'disabled' : ''}>${alreadyLinked ? 'Kopplad' : '+ Koppla nuvarande låt'}</button>
                <button class="btn btn-tiny btn-danger" data-action="delete-rhyme" type="button">✕</button>
              </div>
            </div>
          </div>
        </li>`;
    }).join('') || '<p class="empty-state small">Inga rim ännu.</p>';
    renderRhymeBulkBar();
  }

  ['rhymeSearch'].forEach(id => document.getElementById(id).addEventListener('input', renderRhymeList));
  ['rhymeFilterType', 'rhymeFilterLanguage', 'rhymeFavoritesOnly'].forEach(id => document.getElementById(id).addEventListener('change', renderRhymeList));

  document.getElementById('addRhymeBtn').addEventListener('click', async () => {
    const words = document.getElementById('rhymeWords').value.split(',').map(w => w.trim()).filter(Boolean);
    if (words.length < 2) { toast('Ange minst två ord eller fraser, kommaseparerat', true); return; }
    const data = {
      words,
      language: document.getElementById('rhymeLanguage').value,
      type: document.getElementById('rhymeType').value,
      phrases: document.getElementById('rhymePhrases').value.split(',').map(p => p.trim()).filter(Boolean),
      tags: document.getElementById('rhymeTags').value.split(',').map(t => t.trim()).filter(Boolean),
      notes: document.getElementById('rhymeNotes').value.trim(),
      favorite: document.getElementById('rhymeFavorite').checked,
    };
    try {
      if (editingRhymeId) {
        await Rhymes.update(editingRhymeId, data);
        toast('Rimmet uppdaterat');
      } else {
        await Rhymes.create(data);
        toast('Rimmet tillagt');
      }
      resetRhymeForm();
      await loadRhymes();
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('cancelRhymeEdit').addEventListener('click', resetRhymeForm);

  document.getElementById('rhymeList').addEventListener('click', async (e) => {
    const item = e.target.closest('.rhyme-item');
    if (!item) return;
    const id = item.dataset.id;
    const rhyme = state.rhymes.find(r => r.id === id);
    if (!rhyme) return;

    if (e.target.closest('[data-action="edit-rhyme"]')) {
      editingRhymeId = id;
      document.getElementById('rhymeFormTitle').textContent = 'Redigerar rim';
      document.getElementById('rhymeWords').value = rhyme.words.join(', ');
      document.getElementById('rhymeLanguage').value = rhyme.language;
      document.getElementById('rhymeType').value = rhyme.type;
      document.getElementById('rhymePhrases').value = (rhyme.phrases || []).join(', ');
      document.getElementById('rhymeTags').value = (rhyme.tags || []).join(', ');
      document.getElementById('rhymeNotes').value = rhyme.notes || '';
      document.getElementById('rhymeFavorite').checked = !!rhyme.favorite;
      document.getElementById('addRhymeBtn').textContent = 'Spara ändringar';
      document.getElementById('cancelRhymeEdit').hidden = false;
      document.getElementById('rhymePanel').querySelector('.rhyme-panel-body').scrollTop = 0;
    } else if (e.target.closest('[data-action="delete-rhyme"]')) {
      if (!confirm('Radera rimmet permanent?')) return;
      try { await Rhymes.remove(id); toast('Rimmet raderat'); await loadRhymes(); } catch (err) { toast(err.message, true); }
    } else if (e.target.closest('[data-action="toggle-fav"]')) {
      try { await Rhymes.update(id, { favorite: !rhyme.favorite }); await loadRhymes(); } catch (err) { toast(err.message, true); }
    } else if (e.target.closest('[data-action="link-song"]')) {
      if (!state.currentSongId) return;
      const usage = (rhyme.songUsage || []).concat([{ songId: state.currentSongId }]);
      try { await Rhymes.update(id, { songUsage: usage }); await loadRhymes(); } catch (err) { toast(err.message, true); }
    } else if (e.target.closest('[data-action="unlink"]')) {
      const songId = e.target.closest('[data-action="unlink"]').dataset.song;
      const usage = (rhyme.songUsage || []).filter(u => u.songId !== songId);
      try { await Rhymes.update(id, { songUsage: usage }); await loadRhymes(); } catch (err) { toast(err.message, true); }
    } else if (e.target.closest('.rhyme-usage-chip')) {
      const songId = e.target.closest('.rhyme-usage-chip').dataset.song;
      openEditor(songId, 'library');
    }
  });

  document.getElementById('rhymeList').addEventListener('change', async (e) => {
    if (e.target.classList.contains('rhyme-select')) {
      const id = e.target.dataset.id;
      if (e.target.checked) rhymeSelected.add(id); else rhymeSelected.delete(id);
      renderRhymeBulkBar();
      return;
    }
    if (e.target.classList.contains('rhyme-inline-lang')) {
      try { await Rhymes.update(e.target.dataset.id, { language: e.target.value }); await loadRhymes(); } catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.classList.contains('rhyme-inline-type')) {
      try { await Rhymes.update(e.target.dataset.id, { type: e.target.value }); await loadRhymes(); } catch (err) { toast(err.message, true); }
    }
  });

  document.getElementById('rhymeSelectAll').addEventListener('change', (e) => {
    const filtered = getFilteredRhymes();
    if (e.target.checked) filtered.forEach(r => rhymeSelected.add(r.id));
    else filtered.forEach(r => rhymeSelected.delete(r.id));
    renderRhymeList();
  });

  document.getElementById('rhymeBulkClear').addEventListener('click', () => {
    rhymeSelected.clear();
    document.getElementById('rhymeSelectAll').checked = false;
    renderRhymeList();
  });

  document.getElementById('rhymeBulkDelete').addEventListener('click', async () => {
    if (!rhymeSelected.size) return;
    if (!confirm(`Radera ${rhymeSelected.size} markerade rim permanent?`)) return;
    try {
      await Promise.all([...rhymeSelected].map(id => Rhymes.remove(id)));
      toast('Markerade rim raderade');
      rhymeSelected.clear();
      await loadRhymes();
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('rhymeBulkLanguage').addEventListener('change', async (e) => {
    const lang = e.target.value;
    if (!lang || !rhymeSelected.size) return;
    try {
      await Promise.all([...rhymeSelected].map(id => Rhymes.update(id, { language: lang })));
      toast('Språk uppdaterat för markerade rim');
      e.target.value = '';
      await loadRhymes();
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('rhymeBulkAddTag').addEventListener('click', async () => {
    const tag = document.getElementById('rhymeBulkTag').value.trim();
    if (!tag || !rhymeSelected.size) return;
    try {
      await Promise.all([...rhymeSelected].map(id => {
        const r = state.rhymes.find(x => x.id === id);
        const tags = Array.from(new Set([...(r?.tags || []), tag]));
        return Rhymes.update(id, { tags });
      }));
      toast('Tagg tillagd på markerade rim');
      document.getElementById('rhymeBulkTag').value = '';
      await loadRhymes();
    } catch (err) { toast(err.message, true); }
  });

  // Import av rim från JSON - respekterar språk per post om det finns, annars
  // faller det tillbaka på standardspråket som väljs i formuläret.
  document.getElementById('showRhymeImport').addEventListener('click', () => {
    const box = document.getElementById('rhymeImportBox');
    box.hidden = !box.hidden;
  });
  document.getElementById('runRhymeImportBtn').addEventListener('click', async () => {
    const raw = document.getElementById('rhymeImportText').value.trim();
    if (!raw) { toast('Klistra in JSON först', true); return; }
    let entries;
    try { entries = JSON.parse(raw); } catch (err) { toast('Ogiltig JSON: ' + err.message, true); return; }
    if (!Array.isArray(entries)) { toast('JSON:en måste vara en lista av objekt', true); return; }
    try {
      const result = await api('/api/rhymes/import', {
        method: 'POST',
        body: JSON.stringify({ entries, defaultLanguage: document.getElementById('rhymeImportLanguage').value }),
      });
      toast(`${result.created} rim importerade`);
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
