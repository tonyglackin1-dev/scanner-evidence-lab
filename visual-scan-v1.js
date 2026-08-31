/* Scanner Evidence Lab — Visual Scan Library + EMA crossover rules */
(function(){
  if(typeof parseRules!=='function') return;

  // EMA evidence rows append these fields after the original 18-column schema.
  Object.assign(HIST,{ema20:18,ema20_prev:19,ema50:20,ema50_prev:21,ema100:22,ema100_prev:23,ema200:24,ema200_prev:25});

  const baseParse=parseRules;
  const baseHistoryValue=historyValue;
  const baseLatestValue=latestValue;
  const baseDescribeRule=describeRule;
  const baseLoadShard=loadShard;
  const emaSnapshotCache=new Map();
  const emaShardCache=new Map();

  const supportedEma=new Set([20,50,100,200]);
  const tfName=()=>document.querySelector('#timeframe')?.value||'Daily';
  const tfKey=()=>tfName().toLowerCase();
  const hasEmaRules=(rules=activeRules)=>rules.some(r=>String(r.field||'').startsWith('ema_'));

  function addRule(rules,field,op,value,label){
    const i=rules.findIndex(r=>r.field===field);
    const next={field,op,value,label};
    if(i>=0) rules[i]=next; else rules.push(next);
  }

  parseRules=function(text){
    const rules=baseParse(text);
    const q=String(text||'').toLowerCase().replace(/[–—]/g,'-');
    let m;
    const ema='(20|50|100|200)\\s*(?:-?\\s*(?:day|week|month))?\\s*ema';
    const crossRe=new RegExp(ema+'\\s*(?:has\\s*)?(?:cross(?:ed|es|ing)?|crossover)\\s*(above|over|below|under)\\s*(?:the\\s*)?'+ema);
    const pairRe=new RegExp(ema+'\\s*(?:is\\s*)?(above|over|below|under|greater than|less than)\\s*(?:the\\s*)?'+ema);
    if((m=q.match(crossRe))){
      const a=Number(m[1]), dir=m[2], b=Number(m[3]);
      if(supportedEma.has(a)&&supportedEma.has(b)&&a!==b){
        const up=/above|over/.test(dir);
        addRule(rules,`ema_cross_${a}_${b}`,'=',up?1:-1,`${a} EMA crossed ${up?'above':'below'} ${b} EMA`);
      }
    } else if((m=q.match(pairRe))){
      const a=Number(m[1]), dir=m[2], b=Number(m[3]);
      if(supportedEma.has(a)&&supportedEma.has(b)&&a!==b){
        const up=/above|over|greater/.test(dir);
        addRule(rules,`ema_pair_${a}_${b}`,up?'>':'<',0,`${a} EMA ${up?'>':'<'} ${b} EMA`);
      }
    }
    return rules;
  };

  function emaParts(field){
    let m=String(field).match(/^ema_(pair|cross)_(20|50|100|200)_(20|50|100|200)$/);
    return m?{kind:m[1],a:Number(m[2]),b:Number(m[3])}:null;
  }
  function histEma(row,n,prev=false){return row[HIST[`ema${n}${prev?'_prev':''}`]];}

  historyValue=function(row,field){
    const p=emaParts(field);
    if(!p) return baseHistoryValue(row,field);
    const now=Number(histEma(row,p.a))-Number(histEma(row,p.b));
    if(!Number.isFinite(now)) return null;
    if(p.kind==='pair') return now;
    const prev=Number(histEma(row,p.a,true))-Number(histEma(row,p.b,true));
    if(!Number.isFinite(prev)) return null;
    return prev<=0&&now>0?1:(prev>=0&&now<0?-1:0);
  };

  latestValue=function(row,field){
    const p=emaParts(field);
    if(!p) return baseLatestValue(row,field);
    const now=Number(row[`ema${p.a}`])-Number(row[`ema${p.b}`]);
    if(!Number.isFinite(now)) return null;
    if(p.kind==='pair') return now;
    const prev=Number(row[`ema${p.a}_prev`])-Number(row[`ema${p.b}_prev`]);
    if(!Number.isFinite(prev)) return null;
    return prev<=0&&now>0?1:(prev>=0&&now<0?-1:0);
  };

  describeRule=function(row,rule){
    const p=emaParts(rule.field);
    if(!p) return baseDescribeRule(row,rule);
    const a=fmtNum(row[`ema${p.a}`],2), b=fmtNum(row[`ema${p.b}`],2);
    if(p.kind==='cross') return `${p.a} EMA ${rule.value===1?'bullish':'bearish'} crossover vs ${p.b} EMA (${a} / ${b})`;
    return `${p.a} EMA ${a} ${rule.op} ${p.b} EMA ${b}`;
  };

  async function ensureEmaMerged(name=tfName()){
    const key=String(name).toLowerCase();
    let data=emaSnapshotCache.get(key);
    if(!data){
      const r=await fetch(`data/market/ema/${key}/latest.json`,{cache:'no-store'});
      if(!r.ok) throw new Error('EMA evidence dataset is still building');
      data=await r.json(); emaSnapshotCache.set(key,data);
    }
    if(scannerData?.latest){
      const byTicker=new Map(data.latest.map(x=>[x.ticker,x]));
      scannerData.latest.forEach(row=>Object.assign(row,byTicker.get(row.ticker)||{}));
    }
    updateEmaStatus(true,data.processed_symbols||0);
    return data;
  }

  loadShard=async function(id){
    if(!hasEmaRules()) return baseLoadShard(id);
    const key=tfKey();
    const snap=await ensureEmaMerged(tfName());
    const cacheKey=`${key}:${snap.history_version}:${id}`;
    if(emaShardCache.has(cacheKey)) return emaShardCache.get(cacheKey);
    const promise=(async()=>{
      const base=snap.history_base||`data/market/ema/${key}/history`;
      const r=await fetch(`${base}/history_${String(id).padStart(3,'0')}.ndjson?v=${encodeURIComponent(snap.history_version||'1')}`,{cache:'force-cache'});
      const map=new Map(); if(r.status===404) return map; if(!r.ok) throw new Error(`EMA history shard ${id}: HTTP ${r.status}`);
      for(const line of (await r.text()).split('\n')){if(!line.trim())continue;try{const [t,rows]=JSON.parse(line);map.set(t,rows);}catch(_){}}
      return map;
    })();
    emaShardCache.set(cacheKey,promise); return promise;
  };

  const style=document.createElement('style');
  style.textContent=`
    .setup-library{margin:18px 0}.setup-library summary{cursor:pointer;list-style:none}.setup-library summary::-webkit-details-marker{display:none}
    .setup-library-head{display:flex;justify-content:space-between;align-items:center;gap:16px}.setup-library-head h3{margin:4px 0 0}.setup-library-note{font-size:12px;opacity:.72}
    .setup-filters{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 12px}.setup-filter{border:1px solid rgba(255,255,255,.12);background:transparent;color:inherit;border-radius:999px;padding:7px 11px;cursor:pointer}.setup-filter.active{background:rgba(78,255,196,.12);border-color:rgba(78,255,196,.45)}
    .setup-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:12px}.setup-card{border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px;background:rgba(255,255,255,.025);cursor:pointer;transition:.15s transform,.15s border-color}.setup-card:hover{transform:translateY(-2px);border-color:rgba(78,255,196,.42)}
    .setup-visual{height:88px;border-radius:10px;background:rgba(0,0,0,.16);display:flex;align-items:center;justify-content:center;overflow:hidden}.setup-visual svg{width:100%;height:100%}.setup-card h4{margin:10px 0 4px;font-size:14px}.setup-card p{margin:0 0 10px;font-size:12px;opacity:.7;min-height:30px}.setup-card-foot{display:flex;justify-content:space-between;align-items:center;gap:8px}.setup-tag{font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.65}.setup-run{border:0;border-radius:8px;padding:7px 10px;font-weight:700;cursor:pointer;background:#53f0bd;color:#082219}.setup-run[disabled]{opacity:.4;cursor:wait}.ema-status{font-size:11px;opacity:.75}
  `; document.head.appendChild(style);

  function svg(kind,bull=true){
    const a=bull?'#53f0bd':'#ff7d88', b='#78a7ff', faint='rgba(255,255,255,.18)';
    if(kind==='ema') return `<svg viewBox="0 0 200 88" aria-hidden="true"><path d="M8 67 C38 64 52 58 76 48 S116 29 190 18" fill="none" stroke="${a}" stroke-width="4"/><path d="M8 25 C48 29 67 37 88 44 S132 55 190 60" fill="none" stroke="${b}" stroke-width="3"/><circle cx="88" cy="44" r="5" fill="${a}"/><text x="106" y="24" fill="${a}" font-size="10">EMA</text><text x="142" y="70" fill="${b}" font-size="10">EMA</text></svg>`;
    if(kind==='rsi') return `<svg viewBox="0 0 200 88"><line x1="8" y1="65" x2="192" y2="65" stroke="${faint}" stroke-dasharray="5 4"/><path d="M7 30 L28 43 L48 62 L65 70 L82 57 L101 50 L121 35 L144 40 L166 26 L193 18" fill="none" stroke="${a}" stroke-width="4"/><text x="10" y="79" fill="${faint}" font-size="10">30</text></svg>`;
    if(kind==='macd') return `<svg viewBox="0 0 200 88"><line x1="8" y1="45" x2="192" y2="45" stroke="${faint}"/><path d="M8 62 C42 61 58 54 82 46 S126 31 192 24" fill="none" stroke="${a}" stroke-width="4"/><path d="M8 30 C45 33 62 39 83 46 S132 55 192 59" fill="none" stroke="${b}" stroke-width="3"/></svg>`;
    if(kind==='volume') return `<svg viewBox="0 0 200 88">${[18,31,25,39,28,47,34,72,43].map((h,i)=>`<rect x="${10+i*21}" y="${82-h}" width="13" height="${h}" rx="2" fill="${i===7?a:b}" opacity="${i===7?1:.5}"/>`).join('')}</svg>`;
    if(kind==='high') return `<svg viewBox="0 0 200 88"><line x1="8" y1="18" x2="192" y2="18" stroke="${a}" stroke-dasharray="6 4"/><path d="M8 70 L28 58 L45 62 L65 48 L82 54 L103 38 L120 43 L140 29 L160 34 L190 19" fill="none" stroke="${b}" stroke-width="4"/></svg>`;
    return `<svg viewBox="0 0 200 88"><path d="M8 70 L42 55 L72 60 L102 39 L132 43 L190 18" fill="none" stroke="${a}" stroke-width="4"/></svg>`;
  }

  const setups=[
    {cat:'Moving averages',title:'20 / 50 EMA Bullish Cross',desc:'20 EMA crosses above the 50 EMA this period.',query:'20 EMA crossed above 50 EMA',visual:'ema',bull:true,ema:true},
    {cat:'Moving averages',title:'50 / 200 EMA Bullish Cross',desc:'Classic golden-cross style scan.',query:'50 EMA crossed above 200 EMA',visual:'ema',bull:true,ema:true},
    {cat:'Moving averages',title:'100 / 200 EMA Bullish Cross',desc:'Your 100/200 EMA holy-grail example.',query:'100 EMA crossed above 200 EMA',visual:'ema',bull:true,ema:true},
    {cat:'Moving averages',title:'100 / 200 EMA Bearish Cross',desc:'100 EMA crosses below the 200 EMA.',query:'100 EMA crossed below 200 EMA',visual:'ema',bull:false,ema:true},
    {cat:'Momentum',title:'RSI Oversold',desc:'Find securities with RSI below 30.',query:'RSI is oversold',visual:'rsi',bull:true},
    {cat:'Momentum',title:'RSI Overbought',desc:'Find securities with RSI above 70.',query:'RSI is overbought',visual:'rsi',bull:false},
    {cat:'Momentum',title:'MACD Bullish Cross',desc:'MACD crosses above its signal line.',query:'bullish MACD crossover above signal',visual:'macd',bull:true},
    {cat:'Momentum',title:'MACD Bearish Cross',desc:'MACD crosses below its signal line.',query:'bearish MACD crossover below signal',visual:'macd',bull:false},
    {cat:'Volume',title:'Relative Volume Spike',desc:'Volume running at more than 2× average.',query:'relative volume above 2x',visual:'volume',bull:true},
    {cat:'Breakouts',title:'Near 52-Week High',desc:'Price within 3% of its 52-week high.',query:'within 3% of the 52-week high',visual:'high',bull:true},
    {cat:'Trend',title:'Above 200 Moving Average',desc:'Price holding above the long-term 200 MA.',query:'price above the 200 day moving average',visual:'trend',bull:true}
  ];

  function card(s,i){return `<article class="setup-card" data-cat="${s.cat}" data-setup="${i}"><div class="setup-visual">${svg(s.visual,s.bull)}</div><h4>${s.title}</h4><p>${s.desc}</p><div class="setup-card-foot"><span class="setup-tag">${s.cat}</span><button class="setup-run" type="button">Run scan</button></div></article>`;}

  const panel=document.createElement('details'); panel.className='panel setup-library'; panel.open=true;
  panel.innerHTML=`<summary><div class="setup-library-head"><div><span class="eyebrow">Visual Scan Library</span><h3>See a setup. Click it. Scan the market.</h3></div><span id="emaDataStatus" class="ema-status">Checking EMA evidence…</span></div></summary><div class="setup-library-note">Beginner-friendly one-click setups. The selected timeframe controls whether the pattern is Daily, Weekly or Monthly.</div><div class="setup-filters"><button class="setup-filter active" data-filter="All">All</button>${[...new Set(setups.map(x=>x.cat))].map(x=>`<button class="setup-filter" data-filter="${x}">${x}</button>`).join('')}</div><div class="setup-grid">${setups.map(card).join('')}</div>`;
  const controls=document.querySelector('.controls-grid'); controls?.insertAdjacentElement('afterend',panel);

  function updateEmaStatus(ok,count=0){
    const el=document.querySelector('#emaDataStatus'); if(!el)return;
    el.textContent=ok?`EMA evidence ready • ${Number(count).toLocaleString()} symbols`:'EMA crossover evidence building…';
  }
  window.updateEmaStatus=updateEmaStatus;

  async function runSetup(s,btn){
    btn.disabled=true; const old=btn.textContent; btn.textContent=s.ema?'Loading EMA…':'Loading…';
    try{
      if(s.ema) await ensureEmaMerged(tfName());
      document.querySelector('#scanQuery').value=s.query;
      runEasyMode();
      document.querySelector('.scan-builder')?.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(err){
      const status=document.querySelector('#resultTimestamp'); if(status)status.textContent=err.message;
      updateEmaStatus(false);
    }finally{btn.disabled=false;btn.textContent=old;}
  }

  panel.querySelectorAll('.setup-card').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('.setup-run')||e.target===el||e.target.closest('.setup-visual')||e.target.closest('h4')||e.target.closest('p')){const s=setups[Number(el.dataset.setup)];runSetup(s,el.querySelector('.setup-run'));}}));
  panel.querySelectorAll('.setup-filter').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();panel.querySelectorAll('.setup-filter').forEach(x=>x.classList.toggle('active',x===b));panel.querySelectorAll('.setup-card').forEach(c=>c.style.display=b.dataset.filter==='All'||c.dataset.cat===b.dataset.filter?'':'none');}));

  // Make typed EMA scans wait for their real dataset rather than silently returning zero matches.
  const scanBtn=document.querySelector('#scanButton');
  scanBtn?.addEventListener('click',async e=>{
    const q=document.querySelector('#scanQuery')?.value||'';
    if(!/\b(?:20|50|100|200)\s*(?:-?\s*(?:day|week|month))?\s*ema\b/i.test(q))return;
    e.preventDefault();e.stopImmediatePropagation();
    try{await ensureEmaMerged(tfName());runEasyMode();}catch(err){document.querySelector('#resultTimestamp').textContent=err.message;updateEmaStatus(false);}
  },true);

  document.querySelector('#scanQuery')?.addEventListener('keydown',async e=>{
    if(!(e.key==='Enter'&&(e.ctrlKey||e.metaKey)))return;
    const q=e.currentTarget.value||''; if(!/\b(?:20|50|100|200)\s*ema\b/i.test(q))return;
    e.preventDefault();e.stopImmediatePropagation();
    try{await ensureEmaMerged(tfName());runEasyMode();}catch(err){document.querySelector('#resultTimestamp').textContent=err.message;updateEmaStatus(false);}
  },true);

  async function probe(){try{const r=await fetch(`data/market/ema/${tfKey()}/latest.json`,{method:'HEAD',cache:'no-store'});if(r.ok){const d=await ensureEmaMerged(tfName());updateEmaStatus(true,d.processed_symbols||0);}else updateEmaStatus(false);}catch(_){updateEmaStatus(false);}}
  document.querySelector('#timeframe')?.addEventListener('change',()=>setTimeout(probe,300));
  probe();

  window.SEL_VISUAL_SCAN_LIBRARY={setups,ensureEmaMerged};
})();
