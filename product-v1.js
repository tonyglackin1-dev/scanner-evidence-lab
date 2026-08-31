/* Lightweight product persistence for the MVP.
   Saved scans and watchlists use browser localStorage so the public GitHub Pages
   build gains real persistence without requiring a paid backend. */
(function () {
  const SAVED_KEY = 'sel.savedScans.v1';
  const WATCH_KEY = 'sel.watchlist.v1';
  const LAST_KEY = 'sel.lastScan.v1';

  const css = document.createElement('style');
  css.textContent = `
    .secondary{border:1px solid var(--line);border-radius:10px;padding:11px 15px;background:#0c141d;color:var(--text);font-weight:700;cursor:pointer;white-space:nowrap}
    .secondary:hover{border-color:var(--accent2)}
    .builder-button-group{display:flex;gap:9px;align-items:center}
    .product-panel{display:grid;gap:14px}
    .product-toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .product-toolbar input{min-width:220px;border:1px solid var(--line);background:#0b121a;color:var(--text);border-radius:10px;padding:10px 11px}
    .saved-grid{display:grid;gap:10px}
    .saved-card{border:1px solid var(--line);background:#0b121a;border-radius:12px;padding:14px;display:grid;gap:9px}
    .saved-card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .saved-card h4{margin:0;font-size:15px}.saved-card p{margin:0;color:var(--muted);line-height:1.45}
    .saved-meta{font-size:11px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap}
    .saved-actions{display:flex;gap:8px;flex-wrap:wrap}
    .mini-button{border:1px solid var(--line);background:#101a24;color:var(--text);border-radius:8px;padding:7px 10px;cursor:pointer}
    .mini-button:hover{border-color:var(--accent2)}.mini-button.danger{color:var(--danger)}
    .watch-star{border:0;background:transparent;color:#7d8c99;cursor:pointer;padding:0 7px 0 0;font-size:16px;vertical-align:-1px}.watch-star.active{color:#ffd76a}
    .watch-table{width:100%;min-width:680px}.watch-empty{color:var(--muted);padding:18px 0}
    .storage-note{font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px}
    @media(max-width:640px){.builder-button-group{width:100%}.builder-button-group button{flex:1}.product-toolbar input{width:100%;min-width:0}}
  `;
  document.head.appendChild(css);

  function read(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
    catch (_) { return fallback; }
  }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function savedScans() { return read(SAVED_KEY, []); }
  function watchlist() { return read(WATCH_KEY, []); }

  function currentScanState() {
    return {
      query: document.querySelector('#scanQuery')?.value || '',
      universe: document.querySelector('#universe')?.value || 'US Stocks + ETFs',
      benchmark: document.querySelector('#benchmark')?.value || 'SPY',
      timeframe: document.querySelector('#timeframe')?.value || 'Daily'
    };
  }

  function saveLastState() { write(LAST_KEY, currentScanState()); }
  function restoreLastState() {
    const state = read(LAST_KEY, null);
    if (!state) return;
    if (state.query) document.querySelector('#scanQuery').value = state.query;
    if (state.universe && [...document.querySelector('#universe').options].some(o => o.value === state.universe)) document.querySelector('#universe').value = state.universe;
    if (state.benchmark) document.querySelector('#benchmark').value = state.benchmark;
  }

  function addSaveButton() {
    const scanButton = document.querySelector('#scanButton');
    if (!scanButton || document.querySelector('#saveScanButton')) return;
    const group = document.createElement('div');
    group.className = 'builder-button-group';
    const save = document.createElement('button');
    save.id = 'saveScanButton';
    save.className = 'secondary';
    save.textContent = 'SAVE SCAN';
    scanButton.parentNode.insertBefore(group, scanButton);
    group.appendChild(save);
    group.appendChild(scanButton);
    save.addEventListener('click', () => {
      const state = currentScanState();
      if (!state.query.trim()) return;
      const suggested = state.query.length > 42 ? state.query.slice(0, 42) + '…' : state.query;
      const name = window.prompt('Name this scan', suggested);
      if (!name) return;
      const scans = savedScans();
      scans.unshift({ id: Date.now(), name: name.trim(), ...state, createdAt: new Date().toISOString() });
      write(SAVED_KEY, scans.slice(0, 100));
      renderSaved();
      save.textContent = 'SAVED ✓';
      setTimeout(() => save.textContent = 'SAVE SCAN', 1000);
    });
  }

  function goBuildAndRun(scan) {
    document.querySelector('#scanQuery').value = scan.query;
    if ([...document.querySelector('#universe').options].some(o => o.value === scan.universe)) document.querySelector('#universe').value = scan.universe;
    document.querySelector('#benchmark').value = scan.benchmark || 'SPY';
    saveLastState();
    document.querySelector('.nav-item[data-view="build"]')?.click();
    runEasyMode();
  }

  function renderSaved() {
    const root = document.querySelector('#saved');
    if (!root) return;
    const scans = savedScans();
    root.innerHTML = `<div class="panel product-panel">
      <div class="panel-head"><div><span class="eyebrow">Persistence</span><h3>Saved Scans</h3></div><span class="badge">${scans.length} saved</span></div>
      <div class="saved-grid">${scans.length ? scans.map(s => `
        <article class="saved-card" data-id="${s.id}">
          <div class="saved-card-head"><h4>${escapeHtml(s.name)}</h4><span class="badge">${escapeHtml(s.universe || 'US Stocks + ETFs')}</span></div>
          <p>${escapeHtml(s.query)}</p>
          <div class="saved-meta"><span>${escapeHtml(s.timeframe || 'Daily')}</span><span>Benchmark ${escapeHtml(s.benchmark || 'SPY')}</span><span>${new Date(s.createdAt).toLocaleString()}</span></div>
          <div class="saved-actions"><button class="mini-button run-scan">Run scan</button><button class="mini-button danger delete-scan">Delete</button></div>
        </article>`).join('') : '<div class="watch-empty">No saved scans yet. Build a scan and press SAVE SCAN.</div>'}</div>
      <div class="storage-note">Saved locally on this device for the MVP. Cloud accounts and cross-device sync come later.</div>
    </div>`;

    root.querySelectorAll('.saved-card').forEach(card => {
      const id = Number(card.dataset.id);
      card.querySelector('.run-scan')?.addEventListener('click', () => {
        const scan = savedScans().find(s => s.id === id); if (scan) goBuildAndRun(scan);
      });
      card.querySelector('.delete-scan')?.addEventListener('click', () => {
        write(SAVED_KEY, savedScans().filter(s => s.id !== id)); renderSaved();
      });
    });
  }

  function addWatchTicker(ticker) {
    ticker = String(ticker || '').trim().toUpperCase();
    if (!ticker) return false;
    const known = scannerData?.latest?.some(r => r.ticker === ticker);
    if (!known) return false;
    const list = watchlist();
    if (!list.includes(ticker)) { list.unshift(ticker); write(WATCH_KEY, list.slice(0, 250)); }
    renderWatchlist(); decorateResultStars();
    return true;
  }
  function removeWatchTicker(ticker) {
    write(WATCH_KEY, watchlist().filter(t => t !== ticker));
    renderWatchlist(); decorateResultStars();
  }
  function toggleWatchTicker(ticker) {
    const list = watchlist();
    if (list.includes(ticker)) removeWatchTicker(ticker); else addWatchTicker(ticker);
  }

  function decorateResultStars() {
    const list = new Set(watchlist());
    document.querySelectorAll('#resultsBody tr').forEach(tr => {
      const i = Number(tr.dataset.index);
      const row = currentRows?.[i];
      const td = tr.querySelector('td.ticker');
      if (!row || !td) return;
      let star = td.querySelector('.watch-star');
      if (!star) {
        star = document.createElement('button');
        star.className = 'watch-star';
        star.title = 'Add/remove watchlist';
        td.prepend(star);
        star.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggleWatchTicker(row.ticker); });
      }
      star.textContent = list.has(row.ticker) ? '★' : '☆';
      star.classList.toggle('active', list.has(row.ticker));
    });
  }

  function renderWatchlist() {
    const root = document.querySelector('#watchlists');
    if (!root) return;
    const list = watchlist();
    const byTicker = new Map((scannerData?.latest || []).map(r => [r.ticker, r]));
    root.innerHTML = `<div class="panel product-panel">
      <div class="panel-head"><div><span class="eyebrow">Tracking</span><h3>Watchlist</h3></div><span class="badge">${list.length} tickers</span></div>
      <div class="product-toolbar"><div><input id="watchTickerInput" placeholder="Add ticker, e.g. NVDA" maxlength="12" /> <button id="watchAddButton" class="secondary">ADD</button></div><span id="watchMessage" class="muted"></span></div>
      ${list.length ? `<div class="table-wrap"><table class="watch-table"><thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>RSI</th><th>Rel Vol</th><th>Trend</th><th></th></tr></thead><tbody>${list.map(t => { const r = byTicker.get(t); return `<tr><td class="ticker">${escapeHtml(t)}</td><td>${escapeHtml(r?.name || '—')}</td><td>${r?.close != null ? '$'+Number(r.close).toFixed(2) : '—'}</td><td>${r?.rsi != null ? Number(r.rsi).toFixed(1) : '—'}</td><td>${r?.relvol != null ? Number(r.relvol).toFixed(2)+'x' : '—'}</td><td>${r?.sma200 == null ? '—' : (r.close > r.sma200 ? 'Above 200 DMA' : 'Below 200 DMA')}</td><td><button class="mini-button danger remove-watch" data-ticker="${escapeHtml(t)}">Remove</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="watch-empty">Your watchlist is empty. Add tickers manually or use the ☆ beside any scanner result.</div>'}
      <div class="storage-note">Watchlist is stored locally on this device for the MVP.</div>
    </div>`;
    const input = root.querySelector('#watchTickerInput');
    const add = () => {
      const ok = addWatchTicker(input.value);
      const msg = document.querySelector('#watchMessage');
      if (!ok && msg) msg.textContent = 'Ticker not found in the current US universe.';
    };
    root.querySelector('#watchAddButton')?.addEventListener('click', add);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    root.querySelectorAll('.remove-watch').forEach(b => b.addEventListener('click', () => removeWatchTicker(b.dataset.ticker)));
  }

  function enhanceRenderRows() {
    if (typeof renderRows !== 'function' || renderRows.__productWrapped) return;
    const core = renderRows;
    const wrapped = function(rows) { core(rows); decorateResultStars(); };
    wrapped.__productWrapped = true;
    renderRows = wrapped;
  }

  function enhanceAccount() {
    const root = document.querySelector('#account');
    if (!root) return;
    root.innerHTML = `<div class="panel product-panel"><div class="panel-head"><div><span class="eyebrow">MVP Account</span><h3>Local profile</h3></div><span class="badge">No sign-in required</span></div><p class="muted">This preview stores saved scans and watchlists in this browser only. Authentication, cloud sync and plan controls will be added when the product moves beyond the zero-cost MVP infrastructure.</p><div class="saved-meta"><span>Market data: Yahoo EOD</span><span>Hosting: GitHub Pages</span><span>Storage: local browser</span></div></div>`;
  }

  restoreLastState();
  addSaveButton();
  enhanceRenderRows();
  renderSaved();
  renderWatchlist();
  enhanceAccount();

  document.querySelector('#scanQuery')?.addEventListener('input', saveLastState);
  document.querySelector('#universe')?.addEventListener('change', saveLastState);
  document.querySelector('#benchmark')?.addEventListener('change', saveLastState);
  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.view === 'saved') renderSaved();
    if (btn.dataset.view === 'watchlists') renderWatchlist();
  }));
})();
