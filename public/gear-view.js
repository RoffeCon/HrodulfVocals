(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function api(path, opts) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (!res.ok) throw new Error('Fel: ' + path);
    if (res.status === 204) return null;
    return res.json();
  }

  async function render() {
    const list = document.getElementById('gvList');
    let items;
    try { items = await api('/api/gear'); } catch (e) { list.innerHTML = '<p class="empty-state">Kunde inte hämta utrustningslistan.</p>'; return; }
    if (!items.length) { list.innerHTML = '<p class="empty-state">Inga prylar tillagda än.</p>'; return; }

    const groups = new Map();
    for (const item of items) {
      const owner = item.owner || 'Gemensamt';
      if (!groups.has(owner)) groups.set(owner, []);
      groups.get(owner).push(item);
    }
    let html = '';
    for (const [owner, groupItems] of groups) {
      html += `<div class="gv-owner-group"><div class="gv-owner-label">${escapeHtml(owner)}</div>`;
      html += groupItems.map(item => `
        <label class="gv-item ${item.packed ? 'packed' : ''}" data-id="${item.id}">
          <input type="checkbox" ${item.packed ? 'checked' : ''}>
          <div>
            <div class="gv-item-name">${escapeHtml(item.name)}</div>
            ${item.notes ? `<div class="gv-item-notes">${escapeHtml(item.notes)}</div>` : ''}
          </div>
        </label>`).join('');
      html += '</div>';
    }
    list.innerHTML = html;

    list.querySelectorAll('.gv-item input').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        const row = e.target.closest('.gv-item');
        try {
          await api('/api/gear/' + row.dataset.id, { method: 'PUT', body: JSON.stringify({ packed: e.target.checked }) });
          row.classList.toggle('packed', e.target.checked);
        } catch (err) { e.target.checked = !e.target.checked; }
      });
    });
  }

  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (_) { return; }
      if (msg.type === 'gear-changed') render();
    };
    ws.onclose = () => setTimeout(connectWS, 2000);
  }

  render();
  connectWS();
})();
