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

  async function render() {
    const stage = document.getElementById('stage');
    let live;
    try { live = await api('/api/live'); } catch (e) { return; }

    if (!live.setlistId || live.songIndex === null) {
      stage.innerHTML = `
        <div id="idle">
          <img src="icons/icon-192.png" alt="LyricsMaster">
          <div>Väntar på att ett set ska starta…</div>
        </div>`;
      return;
    }

    let setlist;
    try { setlist = await api('/api/setlists/' + live.setlistId); } catch (e) { return; }

    const items = setlist.items || [];
    const songItemIndices = items.map((it, i) => (it.kind === 'song' ? i : -1)).filter(i => i !== -1);
    const currentItemIdx = songItemIndices[live.songIndex];
    if (currentItemIdx === undefined) return;

    const currentSongId = items[currentItemIdx].songId;
    let currentSong;
    try { currentSong = await api('/api/songs/' + currentSongId); } catch (e) { return; }

    // Leta upp senast passerade grupprubrik (t.ex. tuning) för aktuell låt
    let groupLabel = '';
    for (let i = currentItemIdx; i >= 0; i--) {
      if (items[i].kind === 'group') { groupLabel = items[i].label; break; }
      if (items[i].kind === 'song' && i !== currentItemIdx) break;
    }

    // Nästa låt (hoppar ev. grupprubriker i visningen men de dyker upp som group-tag)
    const nextSongIndex = live.songIndex + 1;
    const nextItemIdx = songItemIndices[nextSongIndex];
    let nextHtml = '<div class="next-label">Nästa</div><div class="next-title">Sista låten i setet</div>';
    if (nextItemIdx !== undefined) {
      let nextGroupLabel = '';
      for (let i = currentItemIdx + 1; i <= nextItemIdx; i++) {
        if (items[i].kind === 'group') { nextGroupLabel = items[i].label; break; }
      }
      let nextSong;
      try { nextSong = await api('/api/songs/' + items[nextItemIdx].songId); } catch (e) { nextSong = null; }
      if (nextSong) {
        nextHtml = `<div class="next-label">Nästa</div><div class="next-title">${escapeHtml(nextSong.title)}</div>` +
          (nextGroupLabel ? `<div class="group-tag">${escapeHtml(nextGroupLabel)}</div>` : '');
      }
    }

    const metaBits = [currentSong.key, currentSong.capo && ('Kapo ' + currentSong.capo), currentSong.tempo && (currentSong.tempo + ' bpm')].filter(Boolean);

    stage.innerHTML = `
      <div class="label">Nu spelas</div>
      <div class="now-title">${escapeHtml(currentSong.title)}</div>
      <div class="now-meta">${escapeHtml(metaBits.join(' · '))}</div>
      ${groupLabel ? `<div class="group-tag">${escapeHtml(groupLabel)}</div>` : ''}
      <div style="margin-top:50px;">${nextHtml}</div>
    `;
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
    };
  }

  render();
  connectWS();
})();
