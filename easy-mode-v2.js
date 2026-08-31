/* Easy Mode language compatibility layer.
   Extends the core parser with common trader phrasing while preserving the
   original rules and historical-evidence engine in app.js. */
(function () {
  if (typeof parseRules !== 'function') return;

  const coreParseRules = parseRules;

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

    // RSI: <=, >=, "or lower", "or higher" and shorthand.
    if ((m = q.match(/rsi(?:\s*\(14\))?\s*(?:<=|at most|max(?:imum)?\s*|no more than\s*|)(\d+(?:\.\d+)?)\s*(?:or lower|or less)?\b/)) &&
        (q.includes('<=') || /at most|max(?:imum)?|no more than|or lower|or less/.test(q))) {
      addIfMissing(rules, 'rsi', '<', Number(m[1]) + Number.EPSILON, `RSI ≤ ${m[1]}`);
    }
    if ((m = q.match(/rsi(?:\s*\(14\))?\s*(?:>=|at least|min(?:imum)?\s*|no less than\s*|)(\d+(?:\.\d+)?)\s*(?:or higher|or more)?\b/)) &&
        (q.includes('>=') || /at least|min(?:imum)?|no less than|or higher|or more/.test(q))) {
      addIfMissing(rules, 'rsi', '>', Number(m[1]) - Number.EPSILON, `RSI ≥ ${m[1]}`);
    }

    // Moving-average shorthand used by traders: SMA/DMA/"day moving average".
    const maRules = [
      { re: /(?:price|close)?\s*(?:above|over|>)\s*(?:the\s*)?(20|50|200)\s*(?:-?\s*day\s*)?(?:sma|dma|ma|moving average)/, op: '>' },
      { re: /(?:price|close)?\s*(?:below|under|<)\s*(?:the\s*)?(20|50|200)\s*(?:-?\s*day\s*)?(?:sma|dma|ma|moving average)/, op: '<' }
    ];
    for (const p of maRules) {
      const mm = q.match(p.re);
      if (mm) {
        const n = Number(mm[1]);
        addIfMissing(rules, `sma${n}`, p.op, null, `Price ${p.op} ${n} DMA`);
      }
    }

    // Relative-volume wording: "volume 2x average", "2 times normal", "150% of average".
    if ((m = q.match(/(?:relative\s*)?volume\s*(?:is\s*)?(?:above|over|at least|>=|>)?\s*(\d+(?:\.\d+)?)\s*(?:x|times)\s*(?:average|normal)?/))) {
      addIfMissing(rules, 'relvol', '>', Number(m[1]), `Rel Vol > ${m[1]}x`);
    }
    if ((m = q.match(/volume\s*(?:above|over|at least|>=|>)?\s*(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?(?:average|normal)/))) {
      const x = Number(m[1]) / 100;
      addIfMissing(rules, 'relvol', '>', x, `Rel Vol > ${x}x`);
    }

    // 1-day moves in conversational order.
    if ((m = q.match(/(?:down|fell|fallen|dropped|lower)\s*(?:by\s*|more than\s*|over\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:today|in one day|in 1 day)?/))) {
      addIfMissing(rules, 'chg1', '<', -Number(m[1]), `1D move < -${m[1]}%`);
    }
    if ((m = q.match(/(?:up|rose|risen|gained|higher)\s*(?:by\s*|more than\s*|over\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:today|in one day|in 1 day)?/))) {
      addIfMissing(rules, 'chg1', '>', Number(m[1]), `1D move > ${m[1]}%`);
    }

    // 5-day / one-week price-move phrasing.
    if ((m = q.match(/(?:up|gained|rose|higher)\s*(?:by\s*|more than\s*|over\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:over|in|during)\s*(?:the\s*)?(?:last\s*)?(?:5\s*days|five\s*days|week)/))) {
      addIfMissing(rules, 'chg5', '>', Number(m[1]), `5D move > ${m[1]}%`);
    }
    if ((m = q.match(/(?:down|dropped|fell|lower)\s*(?:by\s*|more than\s*|over\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:over|in|during)\s*(?:the\s*)?(?:last\s*)?(?:5\s*days|five\s*days|week)/))) {
      addIfMissing(rules, 'chg5', '<', -Number(m[1]), `5D move < -${m[1]}%`);
    }

    // 52-week high/low proximity language.
    if ((m = q.match(/(?:within|less than|no more than)\s*(\d+(?:\.\d+)?)\s*%\s*(?:of|from)\s*(?:the\s*)?52-week\s*low/))) {
      addIfMissing(rules, 'from_low52', '<', Number(m[1]), `Within ${m[1]}% of 52-week low`);
    }
    if ((m = q.match(/(\d+(?:\.\d+)?)\s*%\s*below\s*(?:the\s*)?52-week\s*high/))) {
      addIfMissing(rules, 'from_high52', '>', -Number(m[1]), `Within ${m[1]}% of 52-week high`);
    }
    if ((m = q.match(/(\d+(?:\.\d+)?)\s*%\s*above\s*(?:the\s*)?52-week\s*low/))) {
      addIfMissing(rules, 'from_low52', '>', Number(m[1]), `${m[1]}%+ above 52-week low`);
    }

    return rules;
  }

  parseRules = enhancedParseRules;
})();
