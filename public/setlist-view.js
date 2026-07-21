(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error('Kunde inte hämta ' + path);
    return res.json();
  }

  async function main() {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const list = document.getElementById('slList');
    if (!id) { list.innerHTML = '<p class="empty-state">Ingen setlista angiven.</p>'; return; }

    let setlist;
    try { setlist = await api('/api/setlists/' + id); } catch (e) {
      list.innerHTML = '<p class="empty-state">Kunde inte hitta setlistan.</p>';
      return;
    }
    document.getElementById('slName').textContent = setlist.name || 'Setlista';
    document.getElementById('slMeta').textContent = [setlist.venue, setlist.date].filter(Boolean).join(' · ');

    const songCache = {};
    let html = '';
    for (const item of setlist.items || []) {
      if (item.kind === 'group') {
        html += `<div class="sl-group">${escapeHtml(item.label)}</div>`;
      } else {
        html += `<div class="sl-song" data-song="${item.songId}">
          <div class="sl-song-title">…</div>
          <div class="sl-song-body"></div>
        </div>`;
      }
    }
    list.innerHTML = html || '<p class="empty-state">Setlistan är tom.</p>';

    // Hämta låtdetaljer och fyll i titlarna direkt
    const rows = [...list.querySelectorAll('.sl-song')];
    for (const row of rows) {
      const songId = row.dataset.song;
      try {
        const song = songCache[songId] || (songCache[songId] = await api('/api/songs/' + songId));
        const metaBits = [song.key, song.tempo && song.tempo + ' bpm'].filter(Boolean);
        row.querySelector('.sl-song-title').textContent = song.title;
        const meta = document.createElement('div');
        meta.className = 'sl-song-meta';
        meta.textContent = metaBits.join(' · ');
        row.querySelector('.sl-song-title').after(meta);
      } catch (e) {
        row.querySelector('.sl-song-title').textContent = 'Okänd låt';
      }
    }

    list.addEventListener('click', async (e) => {
      const row = e.target.closest('.sl-song');
      if (!row) return;
      const body = row.querySelector('.sl-song-body');
      const isOpen = row.classList.contains('open');
      if (isOpen) { row.classList.remove('open'); return; }
      if (!body.dataset.loaded) {
        const song = songCache[row.dataset.song];
        body.innerHTML = window.Songbook.renderSong(song.text, { showChords: true });
        body.dataset.loaded = '1';
      }
      row.classList.add('open');
    });
  }

  main();
})();
