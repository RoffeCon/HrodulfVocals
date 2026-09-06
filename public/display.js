(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Serveradress
  // Sidan ska fungera även när servern inte går att nå (nytt nätverk, ny DHCP-adress
  // osv). Därför lever hela gränssnittet lokalt och adressen till servern är något
  // man kan skriva in och ändra när som helst.
  // ---------------------------------------------------------------------------

  const STORE_KEY = 'lm-display-server';
  const RECENT_KEY = 'lm-display-recent';

  function readStore(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (_) { return fallback; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function normalizeBase(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s.replace(/\/+$/, '');
  }

  const params = new URLSearchParams(location.search);
  let base = normalizeBase(params.get('server') || readStore(STORE_KEY, ''));
  if (!base && location.protocol.startsWith('http')) base = location.origin;
  if (params.get('server')) writeStore(STORE_KEY, base);

  function url(path) { return (base || '') + path; }

  function recentList() {
    try { return JSON.parse(readStore(RECENT_KEY, '[]')) || []; } catch (_) { return []; }
  }
  function rememberBase(b) {
    if (!b) return;
    const list = [b, ...recentList().filter(x => x !== b)].slice(0, 5);
    writeStore(RECENT_KEY, JSON.stringify(list));
    renderRecent();
  }

  async function api(path, opts) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    try {
      const res = await fetch(url(path), Object.assign({ signal: ctl.signal, cache: 'no-store' }, opts || {}));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const songCache = new Map();
  async function getSong(id) {
    if (!songCache.has(id)) songCache.set(id, await api('/api/songs/' + id));
    return songCache.get(id);
  }

  // ---------------------------------------------------------------------------
  // Anslutningsstatus
  // ---------------------------------------------------------------------------

  const dot = document.getElementById('connDot');
  const connText = document.getElementById('connText');
  let connected = false;

  function setConnected(ok, text) {
    connected = ok;
    dot.classList.toggle('offline', !ok);
    connText.textContent = text || (ok ? (base || location.host).replace(/^https?:\/\//, '') : 'Ingen kontakt');
  }

  // ---------------------------------------------------------------------------
  // Textstorlek: titeln ska fylla skärmens bredd, porträtt som landskap
  // ---------------------------------------------------------------------------

  function fitText(el, widthRatio, maxHeightRatio) {
    if (!el) return;
    const host = el.parentElement || document.getElementById('stage');
    const avail = host.clientWidth * widthRatio;
    el.style.fontSize = '100px';
    const natural = el.getBoundingClientRect().width || el.scrollWidth || 1;
    let size = (100 * avail) / natural;
    const maxByHeight = window.innerHeight * maxHeightRatio;
    if (size > maxByHeight) size = maxByHeight;
    el.style.fontSize = Math.max(18, Math.floor(size)) + 'px';
  }

  function fitAll() {
    fitText(document.querySelector('.now-title'), 0.98, 0.5);
    fitText(document.querySelector('.next-title'), 0.6, 0.14);
    fitText(document.querySelector('.end-title'), 0.95, 0.4);
  }

  window.addEventListener('resize', fitAll);
  window.addEventListener('orientationchange', () => setTimeout(fitAll, 150));

  // ---------------------------------------------------------------------------
  // Vyer
  // ---------------------------------------------------------------------------

  // Skärmsläckare: när inget set visas ska inte förra setet ligga kvar och brännas
  // fast på skärmen. Innehållet driver sakta runt istället.
  function idleHtml(text) {
    return `
      <div id="saver">
        <div class="saver-inner">
          <img src="${base ? base + '/icons/icon-192.png' : 'icons/icon-192.png'}" alt="LyricsMaster" onerror="this.style.display='none'">
          <div class="saver-clock" id="saverClock"></div>
          <div class="saver-text">${escapeHtml(text || 'Inget set visas just nu')}</div>
        </div>
      </div>`;
  }

  let clockTimer = null;
  function startClock() {
    stopClock();
    const tick = () => {
      const el = document.getElementById('saverClock');
      if (!el) return stopClock();
      const d = new Date();
      el.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    tick();
    clockTimer = setInterval(tick, 15000);
  }
  function stopClock() {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  }

  function offlineHtml() {
    return `
      <div id="idle">
        <div style="font-size:0.8em;color:var(--red);margin-bottom:10px;">Ingen kontakt med servern</div>
        <div>${escapeHtml(base || 'Ingen adress angiven')}</div>
        <div style="font-size:0.6em;margin-top:14px;">Tryck på ⚙ uppe till höger för att ange rätt adress.</div>
      </div>`;
  }

  function fmtDur(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function isShownBreak(item) {
    return item && item.kind === 'break' && item.showOnDisplay !== false;
  }

  // Plockar ut setlistans låtar i ordning, med ev. senaste grupprubrik per låt och
  // en eventuell paus (som ska visas) direkt efter låten.
  function flatten(setlist) {
    const items = setlist.items || [];
    const out = [];
    let group = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'group') { group = item.label; continue; }
      if (item.kind === 'break') continue;
      let breakAfter = null;
      for (let j = i + 1; j < items.length; j++) {
        if (items[j].kind === 'group') continue;
        if (items[j].kind === 'break') { if (isShownBreak(items[j])) breakAfter = items[j]; break; }
        break;
      }
      out.push({ songId: item.songId, group, breakAfter });
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
      let song = null;
      try { song = await getSong(entry.songId); } catch (_) {}
      const isCurrent = live.songIndex === i;
      const isPast = live.songIndex !== null && live.songIndex !== undefined && i < live.songIndex;
      rows.push(`
        <div class="sl-row${isCurrent ? ' current' : ''}${isPast ? ' past' : ''}">
          <span class="sl-num">${i + 1}</span>
          <span class="sl-title">${escapeHtml(song ? song.title : 'Okänd låt')}</span>
        </div>`);
      if (entry.breakAfter) {
        rows.push(`
          <div class="sl-row sl-break${isPast ? ' past' : ''}">
            <span class="sl-num">⏸</span>
            <span class="sl-title">${escapeHtml(entry.breakAfter.label || 'Paus')}</span>
            <span class="sl-time">${escapeHtml(fmtDur(entry.breakAfter.seconds))}</span>
          </div>`);
      }
    }

    const header = [setlist.venue, setlist.date].filter(Boolean).join(' · ');
    stage.innerHTML = `
      <div class="sl-wrap">
        <div class="label">Setlista</div>
        <div class="sl-name">${escapeHtml(setlist.name || 'Setlista')}</div>
        ${header ? `<div class="sl-sub">${escapeHtml(header)}</div>` : ''}
        <div class="sl-list">${rows.join('') || '<div class="sl-sub">Setlistan är tom.</div>'}</div>
      </div>`;
  }

  function endOfSetHtml() {
    return `
      <div class="song-view">
        <div class="fit-wrap"><span class="fit end-title">End of Set</span></div>
      </div>`;
  }

  // Ren scenvy: bara låten som spelas, och nästa låt under.
  async function renderSongView(stage, setlist, live) {
    const songs = flatten(setlist);
    const idx = live.songIndex;
    if (idx === null || idx === undefined || idx >= songs.length) {
      stage.innerHTML = endOfSetHtml();
      fitAll();
      return;
    }

    let current = null;
    try { current = await getSong(songs[idx].songId); } catch (_) {}
    let next = null;
    if (songs[idx + 1]) {
      try { next = await getSong(songs[idx + 1].songId); } catch (_) {}
    }

    const brk = songs[idx].breakAfter;
    const nextTitle = songs[idx + 1]
      ? escapeHtml(next ? next.title : 'Okänd låt')
      : '<span style="color:var(--text-dim)">End of Set</span>';
    const nextHtml = brk
      ? `<div class="next-label">Next</div>
         <div class="fit-wrap"><span class="fit next-title break-next">⏸ ${escapeHtml(brk.label || 'Paus')} · ${escapeHtml(fmtDur(brk.seconds))}</span></div>
         <div class="then-line">Sedan: ${nextTitle}</div>`
      : `<div class="next-label">Next</div><div class="fit-wrap"><span class="fit next-title">${nextTitle}</span></div>`;

    stage.innerHTML = `
      <div class="song-view">
        <div class="fit-wrap"><span class="fit now-title">${escapeHtml(current ? current.title : 'Okänd låt')}</span></div>
        <div class="next-block">${nextHtml}</div>
      </div>`;
    fitAll();
  }

  let renderToken = 0;
  async function render() {
    const token = ++renderToken;
    const stage = document.getElementById('stage');

    let live;
    try {
      live = await api('/api/live');
      setConnected(true);
    } catch (_) {
      setConnected(false);
      stopClock();
      stage.innerHTML = offlineHtml();
      return;
    }
    if (token !== renderToken) return;

    stopClock();
    if (live.mode === 'end') { stage.innerHTML = endOfSetHtml(); fitAll(); return; }
    if (!live.setlistId || live.mode === 'idle') { stage.innerHTML = idleHtml(); startClock(); return; }

    let setlist;
    try { setlist = await api('/api/setlists/' + live.setlistId); } catch (_) { stage.innerHTML = idleHtml(); startClock(); return; }
    if (token !== renderToken) return;

    if (live.mode === 'song') await renderSongView(stage, setlist, live);
    else await renderSetlistOverview(stage, setlist, live);
  }

  // ---------------------------------------------------------------------------
  // Websocket + återanslutning (pollar också, så en tappad server hittas igen)
  // ---------------------------------------------------------------------------

  let ws = null;
  let wsTimer = null;

  function wsUrl() {
    const b = base || location.origin;
    return b.replace(/^http/, 'ws') + '/ws';
  }

  function connectWS() {
    if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
    try { if (ws) ws.close(); } catch (_) {}
    try { ws = new WebSocket(wsUrl()); } catch (_) { wsTimer = setTimeout(connectWS, 3000); return; }

    ws.onopen = () => { setConnected(true); render(); };
    ws.onclose = () => { setConnected(false); wsTimer = setTimeout(connectWS, 3000); };
    ws.onerror = () => setConnected(false);
    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (_) { return; }
      if (msg.type === 'live-changed') render();
      if (msg.type === 'songs-changed' || msg.type === 'setlists-changed') { songCache.clear(); render(); }
    };
  }

  // Reservplan när websocket inte kommer fram: hämta läget med jämna mellanrum.
  setInterval(() => {
    if (!ws || ws.readyState !== 1) render();
  }, 5000);

  // ---------------------------------------------------------------------------
  // Håll skärmen vaken
  // ---------------------------------------------------------------------------

  let wakeLock = null;
  const awakeState = document.getElementById('awakeState');

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) { awakeState.textContent = ''; return; }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      awakeState.textContent = '☀ Skärmen hålls vaken';
      wakeLock.addEventListener('release', () => { awakeState.textContent = ''; });
    } catch (_) { awakeState.textContent = ''; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { requestWakeLock(); render(); }
  });

  // ---------------------------------------------------------------------------
  // Inställningspanel
  // ---------------------------------------------------------------------------

  const sheet = document.getElementById('settings');
  const input = document.getElementById('serverInput');
  const msg = document.getElementById('settingsMsg');

  function renderRecent() {
    const wrap = document.getElementById('recentList');
    const list = recentList();
    wrap.innerHTML = '';
    for (const item of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = item;
      b.addEventListener('click', () => { input.value = item; });
      wrap.appendChild(b);
    }
  }

  function openSettings() {
    input.value = base;
    msg.textContent = '';
    msg.className = 'msg';
    renderRecent();
    sheet.hidden = false;
    input.focus();
  }

  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('closeSettings').addEventListener('click', () => { sheet.hidden = true; });

  async function tryConnect() {
    const candidate = normalizeBase(input.value) || (location.protocol.startsWith('http') ? location.origin : '');
    if (!candidate) {
      msg.textContent = 'Skriv in en adress, t.ex. http://192.168.1.42:3000';
      msg.className = 'msg err';
      return;
    }
    msg.textContent = 'Testar ' + candidate + '…';
    msg.className = 'msg';
    const prev = base;
    base = candidate;
    try {
      await api('/api/live');
      writeStore(STORE_KEY, candidate);
      rememberBase(candidate);
      msg.textContent = 'Ansluten!';
      msg.className = 'msg ok';
      songCache.clear();
      setConnected(true);
      connectWS();
      render();
      setTimeout(() => { sheet.hidden = true; }, 600);
    } catch (e) {
      base = prev;
      msg.textContent = 'Kunde inte nå ' + candidate + '. Kontrollera adress, port och att du är på samma nätverk.';
      msg.className = 'msg err';
    }
  }

  document.getElementById('connectBtn').addEventListener('click', tryConnect);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryConnect(); });

  // ---------------------------------------------------------------------------

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  renderRecent();
  requestWakeLock();
  render().then(() => { if (!connected && !base) openSettings(); });
  connectWS();
})();
