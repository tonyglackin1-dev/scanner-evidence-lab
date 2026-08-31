/* Easy Mode language compatibility layer.
   Extends the core parser with common trader phrasing while preserving the
   original rules and historical-evidence engine in app.js. */
(function () {
  if (typeof parseRules !== 'function') return;

  const coreParseRules = parseRules;
  const INCLUSIVE_EPS = 1e-9;

  function addIfMissing(rules, field, op, value, label) {
    const same = rules.some(r => r.field === field && r.op === op);
    if (!same) rules.push({ field, op, value, label });
  }

  function enhancedParseRules(text) {
    const rules = coreParseRules(text);
    const q = String(text || '')
      .toLowerCase()
      .replace(/≤/g, '<=')
      .replace(/≥/g, '>=')
      .replace(/[–—]/g, '-')
      .replace(/52\s*week/g, '52-week');

    let m;

    if (/rsi(?:\s*\(14\))?\s*(?:is\s*)?oversold/.test(q)) {
      addIfMissing(rules, 'rsi', '<', 30, 'RSI < 30 (oversold)');
    }
    if (/rsi(?:\s*\(14\))?\s*(?:is\s*)?overbought/.test(q)) {
      addIfMissing(rules, 'rsi', '>', 70, 'RSI > 70 (overbought)');
    }
    if ((m = q.match(/rsi(?:\s*\(14\))?\s*(?:<=|at most|max(?:imum)?\s*|no more than\s*|)(\d+(?:\.\d+)?)\s*(?:or lower|or less)?\b/)) &&
        (q.includes('<=') || /at most|max(?:imum)?|no more than|or lower|or less/.test(q))) {
      addIfMissing(rules, 'rsi', '<', Number(m[1]) + INCLUSIVE_EPS, `RSI ≤ ${m[1]}`);
    }
    if ((m = q.match(/rsi(?:\s*\(14\))?\s*(?:>=|at least|min(?:imum)?\s*|no less than\s*|)(\d+(?:\.\d+)?)\s*(?:or higher|or more)?\b/)) &&
        (q.includes('>=') || /at least|min(?:imum)?|no less than|or higher|or more/.test(q))) {
      addIfMissing(rules, 'rsi', '>', Number(m[1]) - INCLUSIVE_EPS, `RSI ≥ ${m[1]}`);
    }

    const maRules = [
      { re: /(?:price|close)?\s*(?:is\s*|holding\s*)?(?:above|over|>)\s*(?:the\s*)?(20|50|200)\s*(?:-?\s*day\s*)?(?:sma|dma|ma|moving average)/, op: '>' },
      { re: /(?:price|close)?\s*(?:is\s*|holding\s*)?(?:below|under|<)\s*(?:the\s*)?(20|50|200)\s*(?:-?\s*day\s*)?(?:sma|dma|ma|moving average)/, op: '<' }
    ];
    for (const p of maRules) {
      const mm = q.match(p.re);
      if (mm) {
        const n = Number(mm[1]);
        addIfMissing(rules, `sma${n}`, p.op, null, `Price ${p.op} ${n} DMA`);
      }
    }

    if (/macd\s*(?:has\s*)?(?:bullish\s*)?(?:cross(?:ed|ing|over)?|crossover)\s*(?:above\s*)?(?:the\s*)?signal/.test(q) ||
        /bullish\s+macd\s+(?:cross|crossover)/.test(q)) {
      addIfMissing(rules, 'macd_cross', '=', 1, 'MACD bullish signal cross');
    }
    if (/macd\s*(?:has\s*)?(?:bearish\s*)?(?:cross(?:ed|ing|over)?|crossover)\s*(?:below\s*)?(?:the\s*)?signal/.test(q) ||
        /bearish\s+macd\s+(?:cross|crossover)/.test(q)) {
      addIfMissing(rules, 'macd_cross', '=', -1, 'MACD bearish signal cross');
    }

    if ((m = q.match(/(?:relative\s*)?volume\s*(?:is\s*)?(?:below|under|less than|<=|<)\s*(\d+(?:\.\d+)?)\s*(?:x|times)\s*(?:average|normal)?/))) {
      addIfMissing(rules, 'relvol', '<', Number(m[1]), `Rel Vol < ${m[1]}x`);
    } else if ((m = q.match(/(?:relative\s*)?volume\s*(?:is\s*)?(?:above|over|at least|>=|>)?\s*(\d+(?:\.\d+)?)\s*(?:x|times)\s*(?:average|normal)?/))) {
      addIfMissing(rules, 'relvol', '>', Number(m[1]), `Rel Vol > ${m[1]}x`);
    }
    if ((m = q.match(/volume\s*(?:below|under|less than|<=|<)\s*(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?(?:average|normal)/))) {
      const x = Number(m[1]) / 100;
      addIfMissing(rules, 'relvol', '<', x, `Rel Vol < ${x}x`);
    } else if ((m = q.match(/volume\s*(?:above|over|at least|>=|>)?\s*(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?(?:average|normal)/))) {
      const x = Number(m[1]) / 100;
      addIfMissing(rules, 'relvol', '>', x, `Rel Vol > ${x}x`);
    }

    let hasExplicitMultiDayMove = false;
    if ((m = q.match(/(?:up|gained|rose|higher)\s*(?:by\s*|more than\s*|over\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:over|in|during)\s*(?:the\s*)?(?:last\s*)?(?:5\s*days|five\s*days|week)/))) {
      addIfMissing(rules, 'chg5', '>', Number(m[1]), `5D move > ${m[1]}%`);
      hasExplicitMultiDayMove = true;
    }
    if ((m = q.match(/(?:down|dropped|fell|lower)\s*(?:by\s*|more than\s*|over\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:over|in|during)\s*(?:the\s*)?(?:last\s*)?(?:5\s*days|five\s*days|week)/))) {
      addIfMissing(rules, 'chg5', '<', -Number(m[1]), `5D move < -${m[1]}%`);
      hasExplicitMultiDayMove = true;
    }

    if (!hasExplicitMultiDayMove || /today|in one day|in 1 day/.test(q)) {
      if ((m = q.match(/(?:down|fell|fallen|dropped|lower)\s*(?:by\s*|more than\s*|over\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:today|in one day|in 1 day)?/))) {
        addIfMissing(rules, 'chg1', '<', -Number(m[1]), `1D move < -${m[1]}%`);
      }
      if ((m = q.match(/(?:up|rose|risen|gained|higher)\s*(?:by\s*|more than\s*|over\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:today|in one day|in 1 day)?/))) {
        addIfMissing(rules, 'chg1', '>', Number(m[1]), `1D move > ${m[1]}%`);
      }
    }

    if ((m = q.match(/(?:within|less than|no more than)\s*(\d+(?:\.\d+)?)\s*%\s*(?:of|from)\s*(?:the\s*)?52-week\s*low/))) {
      addIfMissing(rules, 'from_low52', '<', Number(m[1]), `Within ${m[1]}% of 52-week low`);
    }
    if ((m = q.match(/(\d+(?:\.\d+)?)\s*%\s*below\s*(?:the\s*)?52-week\s*high/))) {
      addIfMissing(rules, 'from_high52', '>', -Number(m[1]), `Within ${m[1]}% of 52-week high`);
    }
    if ((m = q.match(/(\d+(?:\.\d+)?)\s*%\s*above\s*(?:the\s*)?52-week\s*low/))) {
      addIfMissing(rules, 'from_low52', '>', Number(m[1]), `${m[1]}%+ above 52-week low`);
    }
    if (/(?:at|making|made|new)\s+(?:a\s+)?52-week\s+high/.test(q)) {
      addIfMissing(rules, 'from_high52', '>', -0.1, 'At 52-week high');
    }
    if (/(?:at|making|made|new)\s+(?:a\s+)?52-week\s+low/.test(q)) {
      addIfMissing(rules, 'from_low52', '<', 0.1, 'At 52-week low');
    }

    return rules;
  }

  parseRules = enhancedParseRules;

  window.SEL_EASY_MODE_QA = function () {
    const cases = [
      ['RSI is oversold and price above 200 SMA', ['rsi','sma200']],
      ['RSI 40 or lower', ['rsi']],
      ['down 5% over the last week', ['chg5']],
      ['down 5% today', ['chg1']],
      ['volume below 0.8x average', ['relvol']],
      ['bullish MACD crossover above signal', ['macd_cross']],
      ['within 3% of the 52-week low', ['from_low52']],
      ['new 52-week high', ['from_high52']]
    ];
    return cases.map(([query, expected]) => {
      const fields = enhancedParseRules(query).map(r => r.field);
      return { query, fields, pass: expected.every(x => fields.includes(x)) && !(query.includes('last week') && fields.includes('chg1')) };
    });
  };
})();

/* Exact all-match evidence layer.
   Headline evidence now covers every currently matched ticker. To stay scalable,
   +5D is the exact median of each ticker's own historical median (equal ticker
   weighting), while +10D win rate and sample size use every qualifying event. */
(function () {
  if (typeof runEasyMode !== 'function' || typeof loadShard !== 'function') return;

  function setMetricLabels() {
    const m5 = document.querySelector('#median5Metric')?.closest('.metric-card');
    if (m5) {
      const label = m5.querySelector('span');
      const note = m5.querySelector('small');
      if (label) label.textContent = 'Median ticker +5D';
      if (note) note.textContent = 'Equal-weighted across all matches';
    }
    const win = document.querySelector('#winMetric')?.closest('.metric-card');
    if (win) {
      const note = win.querySelector('small');
      if (note) note.textContent = 'All qualifying historical events';
    }
    const sample = document.querySelector('#sampleMetric')?.closest('.metric-card');
    if (sample) {
      const note = sample.querySelector('small');
      if (note) note.textContent = 'Exact +5D historical events';
    }
  }

  function tickerStats(events) {
    return statsFromEvents(events);
  }

  async function exactAllMatchEvidence(displayRows, matchedRows, rules, token) {
    if (token !== scanToken) return;
    const displayByTicker = new Map(displayRows.map(r => [r.ticker, r]));
    const tickerMedians5 = [];
    let positive10 = 0;
    let sample10 = 0;
    let sample5 = 0;
    let tickersWithEvidence = 0;

    const groups = new Map();
    for (const row of matchedRows) {
      const id = legacyMode ? -1 : shardFor(row.ticker);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(row.ticker);
    }
    const jobs = [...groups.entries()];
    let next = 0;
    let completed = 0;

    const status = document.querySelector('#resultTimestamp');
    const sampleMetric = document.querySelector('#sampleMetric');

    async function processTicker(ticker, hist) {
      if (token !== scanToken) return;
      const events = (hist || []).filter(r => passesHistory(r, rules));
      if (!events.length) return;
      const stats = tickerStats(events);
      tickersWithEvidence++;
      if (stats[1].median !== null) tickerMedians5.push(stats[1].median);
      sample5 += stats[1].sample;
      sample10 += stats[2].sample;
      positive10 += (stats[2].values || []).reduce((n, v) => n + (v > 0 ? 1 : 0), 0);

      const displayRow = displayByTicker.get(ticker);
      if (displayRow) {
        displayRow.evidence_detail = stats;
        displayRow.evidence = stats.map(s => s.median);
        displayRow.d5 = fmtEvidence(stats[1].median);
      }
    }

    async function worker() {
      while (true) {
        const jobIndex = next++;
        if (jobIndex >= jobs.length || token !== scanToken) return;
        const [shardId, tickers] = jobs[jobIndex];
        if (legacyMode) {
          for (const ticker of tickers) {
            await processTicker(ticker, scannerData.history?.[ticker] || []);
          }
        } else {
          const map = await loadShard(shardId);
          if (token !== scanToken) return;
          for (const ticker of tickers) await processTicker(ticker, map.get(ticker) || []);
        }
        completed++;
        if (token === scanToken) {
          if (sampleMetric) sampleMetric.textContent = `${completed}/${jobs.length}`;
          if (status) status.dataset.evidenceProgress = `Exact evidence ${completed}/${jobs.length} shards`;
        }
      }
    }

    const concurrency = Math.min(6, Math.max(1, jobs.length));
    await Promise.all(Array.from({length: concurrency}, () => worker()));
    if (token !== scanToken) return;

    renderRows(displayRows);
    document.querySelector('#median5Metric').textContent = fmtEvidence(median(tickerMedians5));
    document.querySelector('#winMetric').textContent = sample10 ? `${(positive10 / sample10 * 100).toFixed(1)}%` : 'n/a';
    document.querySelector('#sampleMetric').textContent = sample5.toLocaleString();

    const coverage = `${tickersWithEvidence.toLocaleString()}/${matchedRows.length.toLocaleString()} matched tickers with history`;
    if (status) status.textContent += ` • exact evidence: ${coverage}`;
    if (displayRows.length) showEvidence(displayRows[0], rules);
  }

  runEasyMode = function () {
    if (!scannerData?.latest) return;
    setMetricLabels();
    const token = ++scanToken;
    const timeframe = document.querySelector('#timeframe')?.value || 'Daily';
    const query = document.querySelector('#scanQuery').value;
    const rules = parseRules(query);
    activeRules = rules;
    renderRuleChips(rules);

    if (!rules.length) {
      body.innerHTML = '<tr><td colspan="7" class="negative">I could not interpret a supported condition. Try RSI, MACD, 20/50/200 DMA, relative volume, price moves, or 52-week high/low.</td></tr>';
      ['matchesMetric','median5Metric','winMetric','sampleMetric'].forEach(id => document.querySelector(`#${id}`).textContent = '—');
      return;
    }

    const matched = scannerData.latest.filter(row => universeFilter(row) && passesLatest(row, rules));
    matched.sort((a,b) => (Number(b.avg_dollar_vol20)||0) - (Number(a.avg_dollar_vol20)||0));
    const display = matched.slice(0, 200).map(row => buildDisplayRow(row, rules));
    renderRows(display);

    document.querySelector('#matchesMetric').textContent = matched.length.toLocaleString();
    document.querySelector('#median5Metric').textContent = '…';
    document.querySelector('#winMetric').textContent = '…';
    document.querySelector('#sampleMetric').textContent = '…';

    const when = scannerData.generated_at ? new Date(scannerData.generated_at) : null;
    const whenText = when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : 'unknown time';
    const scope = legacyMode ? `${scannerData.processed_symbols || scannerData.latest.length} symbol prototype` : `${(scannerData.processed_symbols || scannerData.latest.length).toLocaleString()} full-market symbols`;
    const shown = matched.length > display.length ? ` • showing top ${display.length} by liquidity` : '';
    const tf = timeframe === 'Daily' ? '' : ` • ${timeframe} unavailable: Daily EOD only`;
    document.querySelector('#resultTimestamp').textContent = `Yahoo EOD • ${scope} • ${matched.length.toLocaleString()} matches${shown}${tf} • refreshed ${whenText}`;

    if (matched.length) {
      exactAllMatchEvidence(display, matched, rules, token).catch(err => {
        if (token === scanToken) document.querySelector('#resultTimestamp').textContent += ` • exact evidence error: ${err.message}`;
      });
    } else {
      document.querySelector('#median5Metric').textContent = 'n/a';
      document.querySelector('#winMetric').textContent = 'n/a';
      document.querySelector('#sampleMetric').textContent = '0';
    }
  };

  setMetricLabels();
})();
