(function () {
  'use strict';

  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error('Request failed: ' + path);
    return res.json();
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const songCache = new Map();
  async function getSong(id) {
    if (!songCache.has(id)) songCache.set(id, await api('/api/songs/' + id));
    return songCache.get(id);
  }

  function idleHtml(text) {
    return `
      <div id="idle">
        <img src="icons/icon-192.png" alt="LyricsMaster">
        <div>${escapeHtml(text || 'Väntar på att ett set ska starta…')}</div>
      </div>`;
  }

  // Plockar ut setlistans låtar i ordning, med ev. senaste grupprubrik per låt.
  function flatten(setlist) {
    const out = [];
    let group = '';
    for (const item of setlist.items || []) {
      if (item.kind === 'group') { group = item.label; continue; }
      out.push({ songId: item.songId, group, groupStart: group && !out.some(o => o.group === group) });
    }
    return out;
  }

  async function renderSetlistOverview(stage, setlist, live) {
    const songs = flatten(setlist);
    const rows = [];
    let lastGroup = null;
    for (let i = 0; i < songs.length; i++) {
      const entry = songs[i];
      if (entry.group && entry.group !== lastGroup) {
        rows.push(`<div class="sl-group">${escapeHtml(entry.group)}</div>`);
        lastGroup = entry.group;
      }
      let song;
      try { song = await getSong(entry.songId); } catch (_) { song = null; }
      const isCurrent = live.songIndex === i;
      const isPast = live.songIndex !== null && i < live.songIndex;
      const meta = song ? [song.key, song.tempo && song.tempo + ' bpm'].filter(Boolean).join(' · ') : '';
      rows.push(`
        <div class="sl-row${isCurrent ? ' current' : ''}${isPast ? ' past' : ''}">
          <span class="sl-num">${i + 1}</span>
          <span class="sl-title">${escapeHtml(song ? song.title : 'Okänd låt')}</span>
          <span class="sl-meta">${escapeHtml(meta)}</span>
        </div>`);
    }

    const header = [setlist.venue, setlist.date].filter(Boolean).join(' · ');
    stage.innerHTML = `
      <div class="sl-wrap">
        <div class="label">Setlista</div>
        <div class="sl-name">${escapeHtml(setlist.name || 'Setlista')}</div>
        ${header ? `<div class="now-meta small">${escapeHtml(header)}</div>` : ''}
        <div class="sl-list">${rows.join('') || '<div class="now-meta">Setlistan är tom.</div>'}</div>
      </div>`;
  }

  async function renderSongView(stage, setlist, live) {
    const songs = flatten(setlist);
    const entry = songs[live.songIndex];
    if (!entry) { stage.innerHTML = idleHtml(); return; }

    let currentSong;
    try { currentSong = await getSong(entry.songId); } catch (_) { return; }

    const nextEntry = songs[live.songIndex + 1];
    let nextHtml = '<div class="next-label">Nästa</div><div class="next-title">Sista låten i setet</div>';
    if (nextEntry) {
      let nextSong = null;
      try { nextSong = await getSong(nextEntry.songId); } catch (_) {}
      if (nextSong) {
        nextHtml = `<div class="next-label">Nästa</div><div class="next-title">${escapeHtml(nextSong.title)}</div>` +
          (nextEntry.group && nextEntry.group !== entry.group ? `<div class="group-tag">${escapeHtml(nextEntry.group)}</div>` : '');
      }
    }

    const metaBits = [currentSong.key, currentSong.capo && ('Kapo ' + currentSong.capo), currentSong.tempo && (currentSong.tempo + ' bpm')].filter(Boolean);

    stage.innerHTML = `
      <div class="label">Nu spelas <span class="pos">${live.songIndex + 1} / ${songs.length}</span></div>
      <div class="now-title">${escapeHtml(currentSong.title)}</div>
      <div class="now-meta">${escapeHtml(metaBits.join(' · '))}</div>
      ${entry.group ? `<div class="group-tag">${escapeHtml(entry.group)}</div>` : ''}
      <div style="margin-top:50px;">${nextHtml}</div>
    `;
  }

  let renderToken = 0;
  async function render() {
    const token = ++renderToken;
    const stage = document.getElementById('stage');
    let live;
    try { live = await api('/api/live'); } catch (_) { return; }

    if (!live.setlistId || live.mode === 'idle') { stage.innerHTML = idleHtml(); return; }

    let setlist;
    try { setlist = await api('/api/setlists/' + live.setlistId); } catch (_) { stage.innerHTML = idleHtml(); return; }
    if (token !== renderToken) return;

    if (live.mode === 'song' && live.songIndex !== null) await renderSongView(stage, setlist, live);
    else await renderSetlistOverview(stage, setlist, live);
  }

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
      if (msg.type === 'live-changed') render();
      if (msg.type === 'songs-changed' || msg.type === 'setlists-changed') { songCache.clear(); render(); }
    };
  }

  render();
  connectWS();
})();
