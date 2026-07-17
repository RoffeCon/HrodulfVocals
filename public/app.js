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
      setlistContext: null,
      transpose: 0,
      showChords: true,
      fontScale: 1,
      zoomLevel: 1,
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
      }
    };
  }

  // ---------- Library ----------

  async function loadSongs() {
    try {
      state.songs = await Songs.list();
      renderLibrary();
    } catch (e) { toast(e.message, true); }
  }

  function renderLibrary() {
    const q = document.getElementById('songSearch').value.trim().toLowerCase();
    const list = document.getElementById('songList');
    const filtered = state.songs.filter(s => {
      if (!q) return true;
      const hay = [s.title, s.composer, ...(s.tags || [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
    document.getElementById('libraryEmpty').hidden = state.songs.length > 0;
    list.innerHTML = filtered.map(s => {
      const versionCount = s.versions ? Object.keys(s.versions).length : 0;
      const versionBadge = versionCount > 1 ? ` <span class="version-badge">V${versionCount}</span>` : '';
      return `
      <li class="song-row" data-id="${s.id}">
        <div class="song-row-main" data-action="view">
          <div class="song-row-title">${escapeHtml(s.title)}${versionBadge}</div>
          <div class="song-row-sub">${[s.composer, s.key, s.tempo && s.tempo + ' bpm'].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        </div>
        <button class="btn btn-tiny" data-action="edit">Redigera</button>
      </li>
    `}).join('');
  }

  document.getElementById('songSearch').addEventListener('input', renderLibrary);

  document.getElementById('songList').addEventListener('click', (e) => {
    const row = e.target.closest('.song-row');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('[data-action="edit"]')) {
      openEditor(id, 'library');
    } else {
      const song = state.songs.find(s => s.id === id);
      if (song && song.versions && Object.keys(song.versions).length > 1) {
        showVersionModal(id, song);
      } else {
        openViewer(id, null);
      }
    }
  });

  document.getElementById('newSongBtn').addEventListener('click', () => openEditor(null, 'library'));

  // ---------- Song editor ----------

  function blankSong() {
    return { title: '', composer: '', key: '', capo: '', tempo: '', timeSignature: '', tags: [], notes: '', text: '', versions: {} };
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
    document.getElementById('f-tags').value = (song.tags || []).join(', ');
    document.getElementById('f-notes').value = song.notes || '';
    document.getElementById('f-text').value = song.text || '';
    document.getElementById('deleteSongBtn').hidden = !id;
    showView('editor');
    document.getElementById('f-title').focus();
  }

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
      tags: document.getElementById('f-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      notes: document.getElementById('f-notes').value,
      text: document.getElementById('f-text').value,
      versions: {}, // Versions will be handled separately
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

  // ---------- Markup toolbar functions ----------

  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    textarea.value = before + text + after;
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
  }

  document.getElementById('insertHeadingBtn').addEventListener('click', () => {
    const textarea = document.getElementById('f-text');
    insertAtCursor(textarea, '## ');
  });

  document.getElementById('insertChordBtn').addEventListener('click', () => {
    const textarea = document.getElementById('f-text');
    insertAtCursor(textarea, '[]');
    // Move cursor inside the brackets
    const pos = textarea.selectionStart - 1;
    textarea.selectionStart = textarea.selectionEnd = pos;
  });

  document.getElementById('insertCommentBtn').addEventListener('click', () => {
    const textarea = document.getElementById('f-text');
    insertAtCursor(textarea, '> ');
  });

  document.getElementById('insertVerseBtn').addEventListener('click', () => {
    const textarea = document.getElementById('f-text');
    insertAtCursor(textarea, '\n## Vers\n');
  });

  document.getElementById('insertChorusBtn').addEventListener('click', () => {
    const textarea = document.getElementById('f-text');
    insertAtCursor(textarea, '\n## Refräng\n');
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

  async function openSetlistEditor(id) {
    state.currentSetlistId = id;
    if (id) {
      try { editingSetlist = await Setlists.get(id); } catch (e) { toast(e.message, true); return; }
    } else {
      editingSetlist = { name: '', venue: '', date: '', notes: '', songIds: [] };
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
    const list = document.getElementById('setlistSongs');
    document.getElementById('setlistEmptyMsg').hidden = editingSetlist.songIds.length > 0;
    list.innerHTML = editingSetlist.songIds.map((id, i) => {
      const s = songsById[id];
      if (!s) return '';
      return `
        <li class="reorder-row" data-id="${id}">
          <span class="reorder-index">${i + 1}</span>
          <span class="reorder-title">${escapeHtml(s.title)}</span>
          <span class="reorder-meta">${escapeHtml(s.key || '')}</span>
          <span class="reorder-btns">
            <button class="btn btn-tiny" data-act="up" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="btn btn-tiny" data-act="down" ${i === editingSetlist.songIds.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="btn btn-tiny btn-danger" data-act="remove">✕</button>
          </span>
        </li>`;
    }).join('');

    const q = document.getElementById('addSongSearch').value.trim().toLowerCase();
    const addList = document.getElementById('addSongList');
    const available = state.songs.filter(s => !editingSetlist.songIds.includes(s.id))
      .filter(s => !q || (s.title + ' ' + (s.composer||'')).toLowerCase().includes(q));
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
    editingSetlist.songIds.push(row.dataset.id);
    renderSetlistBuilder();
  });

  document.getElementById('setlistSongs').addEventListener('click', (e) => {
    const row = e.target.closest('.reorder-row');
    if (!row) return;
    const id = row.dataset.id;
    const idx = editingSetlist.songIds.indexOf(id);
    const act = e.target.dataset.act;
    if (act === 'up' && idx > 0) {
      [editingSetlist.songIds[idx - 1], editingSetlist.songIds[idx]] = [editingSetlist.songIds[idx], editingSetlist.songIds[idx - 1]];
    } else if (act === 'down' && idx < editingSetlist.songIds.length - 1) {
      [editingSetlist.songIds[idx + 1], editingSetlist.songIds[idx]] = [editingSetlist.songIds[idx], editingSetlist.songIds[idx + 1]];
    } else if (act === 'remove') {
      editingSetlist.songIds.splice(idx, 1);
    } else {
      return;
    }
    renderSetlistBuilder();
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
      songIds: editingSetlist.songIds,
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
    if (!editingSetlist.songIds.length) { toast('Lägg till minst en låt först', true); return; }
    openViewer(editingSetlist.songIds[0], { setlist: editingSetlist, index: 0 });
  });

  // ---------- Viewer / scenläge ----------

  async function openViewer(songId, setlistContext) {
    state.viewer.songId = songId;
    state.viewer.setlistContext = setlistContext;
    state.viewer.transpose = 0;
    state.viewer.zoomLevel = 1;
    document.getElementById('transVal').textContent = '0';
    document.getElementById('zoomVal').textContent = '100%';
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

    document.getElementById('songBody').innerHTML = window.Songbook.renderSong(song.text, {
      transpose: state.viewer.transpose,
      showChords: state.viewer.showChords,
      preferFlats,
    });
    document.getElementById('songBody').style.setProperty('--song-font-scale', state.viewer.fontScale);
    document.getElementById('songBody').style.setProperty('--zoom-level', state.viewer.zoomLevel);

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
    e.target.textContent = state.viewer.showChords ? 'Visa' : 'Dölj';
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
    state.viewer.fontScale = Math.min(2.2, state.viewer.fontScale + 0.1);
    document.getElementById('songBody').style.setProperty('--song-font-scale', state.viewer.fontScale);
  });
  document.getElementById('fontDown').addEventListener('click', () => {
    state.viewer.fontScale = Math.max(0.7, state.viewer.fontScale - 0.1);
    document.getElementById('songBody').style.setProperty('--song-font-scale', state.viewer.fontScale);
  });

  // Zoom functions
  document.getElementById('zoomIn').addEventListener('click', () => {
    state.viewer.zoomLevel = Math.min(2, state.viewer.zoomLevel + 0.1);
    document.getElementById('zoomVal').textContent = `${Math.round(state.viewer.zoomLevel * 100)}%`;
    document.getElementById('songBody').style.setProperty('--zoom-level', state.viewer.zoomLevel);
  });

  document.getElementById('zoomOut').addEventListener('click', () => {
    state.viewer.zoomLevel = Math.max(0.5, state.viewer.zoomLevel - 0.1);
    document.getElementById('zoomVal').textContent = `${Math.round(state.viewer.zoomLevel * 100)}%`;
    document.getElementById('songBody').style.setProperty('--zoom-level', state.viewer.zoomLevel);
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
    const container = document.getElementById('view-viewer');
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

  // Export functions
  document.getElementById('exportBtn').addEventListener('click', () => {
    if (!state.viewer.song) return;
    const song = state.viewer.song;
    const preferFlats = window.Songbook.prefersFlats(song.key);
    const rendered = window.Songbook.renderSong(song.text, {
      transpose: state.viewer.transpose,
      showChords: true,
      preferFlats,
    });
    
    const metaLines = [];
    if (song.title) metaLines.push(`Titel: ${song.title}`);
    if (song.composer) metaLines.push(`Kompositör: ${song.composer}`);
    if (song.key) {
      const transposedKey = state.viewer.transpose
        ? window.Songbook.transposeChord(song.key, state.viewer.transpose, preferFlats)
        : song.key;
      metaLines.push(`Tonart: ${transposedKey}${state.viewer.transpose ? ` (orig. ${song.key})` : ''}`);
    }
    if (song.capo) metaLines.push(`Kapo: ${song.capo}`);
    if (song.tempo) metaLines.push(`Tempo: ${song.tempo} bpm`);
    if (song.timeSignature) metaLines.push(`Taktart: ${song.timeSignature}`);
    if (song.notes) metaLines.push(`Anteckningar: ${song.notes}`);
    
    const exportText = [...metaLines, '', rendered].join('\n');
    document.getElementById('exportText').value = exportText;
    document.getElementById('exportModal').hidden = false;
  });

  document.getElementById('copyExportBtn').addEventListener('click', () => {
    const textarea = document.getElementById('exportText');
    textarea.select();
    try {
      document.execCommand('copy');
      toast('Kopierat till urklipp!');
    } catch (e) {
      navigator.clipboard.writeText(textarea.value).then(() => {
        toast('Kopierat till urklipp!');
      }).catch(() => {
        toast('Kunde inte kopiera', true);
      });
    }
    document.getElementById('exportModal').hidden = true;
  });

  document.getElementById('closeExportBtn').addEventListener('click', () => {
    document.getElementById('exportModal').hidden = true;
  });

  // Version modal functions
  function showVersionModal(songId, song) {
    const modal = document.getElementById('versionModal');
    const list = document.getElementById('versionList');
    
    if (song.versions && Object.keys(song.versions).length > 1) {
      const versions = Object.entries(song.versions).map(([version, data]) => ({
        version,
        date: data.date || 'Okänt datum',
        title: data.title || song.title,
      }));
      
      list.innerHTML = versions.map(v => `
        <div class="version-item" data-version="${v.version}">
          <span class="version-name">${escapeHtml(v.title)} - Version ${escapeHtml(v.version)}</span>
          <span class="version-date">${escapeHtml(v.date)}</span>
          <span class="version-actions">
            <button class="btn btn-tiny btn-accent" data-action="load">Öppna</button>
          </span>
        </div>
      `).join('');
      
      list.addEventListener('click', (e) => {
        const item = e.target.closest('.version-item');
        if (!item) return;
        const version = item.dataset.version;
        if (e.target.dataset.action === 'load') {
          // Load the specific version
          openViewer(songId, null);
          modal.hidden = true;
        }
      });
    } else {
      // No versions, just open the song
      openViewer(songId, null);
      return;
    }
    
    modal.hidden = false;
  }

  document.getElementById('closeVersionBtn').addEventListener('click', () => {
    document.getElementById('versionModal').hidden = true;
  });

  // ---------- Wake Lock (håll skärmen tänd på scen) ----------

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

  // ---------- Init ----------

  loadSongs();
  loadSetlists();
  connectWS();
})();
