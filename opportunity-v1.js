/* Scanner Evidence Lab — forward-path opportunity evidence. */
(function(){
  const IDX={mfe:26,mae:27,up2:28,up5:29,up10:30,dn2:31,dn5:32,dn10:33,peak:34,trough:35,fwd3:36};
  const metaCache=new Map(), shardCache=new Map();

  const css=document.createElement('style');
  css.textContent=`
    .opp-panel{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
    .opp-head{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:9px}.opp-head strong{font-size:13px}.opp-head span{font-size:10px;color:var(--muted)}
    .opp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px}.opp-card{border:1px solid var(--line);border-radius:9px;padding:9px;display:grid;gap:4px}
    .opp-card span{font-size:10px;color:var(--muted)}.opp-card strong{font-size:16px}.opp-sub{font-size:10px;color:var(--muted)}.opp-note{margin-top:8px;font-size:10px;color:var(--muted);line-height:1.4}
  `; document.head.appendChild(css);

  function tf(){const t=document.querySelector('#timeframe')?.value||'Daily';return t.toLowerCase()}
  function suffix(){const t=tf();return t==='weekly'?'W':t==='monthly'?'M':'D'}
  function n(v){v=Number(v);return Number.isFinite(v)?v:null}
  function med(xs){const a=xs.map(n).filter(v=>v!==null).sort((a,b)=>a-b);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
  function pct(v){return v===null?'n/a':`${v>=0?'+':''}${v.toFixed(2)}%`}
  function rate(rows,idx){const eligible=rows.filter(r=>n(r[IDX.mfe])!==null&&n(r[IDX.mae])!==null);if(!eligible.length)return null;return eligible.filter(r=>n(r[idx])!==null).length/eligible.length*100}
  function bearish(){const q=(document.querySelector('#scanQuery')?.value||'').toLowerCase();return /bearish|crossed below|crossing below|macd falling|price below|rsi overbought|rsi above 70/.test(q)}
  function card(label,value,sub=''){return `<div class="opp-card"><span>${label}</span><strong>${value}</strong>${sub?`<div class="opp-sub">${sub}</div>`:''}</div>`}

  async function meta(){const k=tf();if(metaCache.has(k))return metaCache.get(k);const p=fetch(`data/market/opportunity/${k}/latest.json`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Opportunity evidence is still building');return r.json()});metaCache.set(k,p);return p}
  async function history(ticker){const m=await meta();const sid=fnv1a(ticker)%(m.history_shards||128);const key=`${tf()}:${m.history_version}:${sid}`;if(!shardCache.has(key)){shardCache.set(key,(async()=>{const r=await fetch(`${m.history_base}/history_${String(sid).padStart(3,'0')}.ndjson?v=${encodeURIComponent(m.history_version||'1')}`,{cache:'force-cache'});const map=new Map();if(r.status===404)return map;if(!r.ok)throw new Error(`Opportunity shard HTTP ${r.status}`);for(const line of (await r.text()).split('\n')){if(!line.trim())continue;try{const [t,rows]=JSON.parse(line);map.set(t,rows)}catch(_){}}return map})())}return (await shardCache.get(key)).get(ticker)||[]}

  async function renderFor(detail,row){
    const box=detail.querySelector('.inline-evidence-box');if(!box)return;
    let panel=box.querySelector('.opp-panel');if(!panel){panel=document.createElement('div');panel.className='opp-panel';panel.innerHTML='Loading opportunity path…';box.appendChild(panel)}
    try{
      const hist=await history(row.ticker);const matches=hist.filter(r=>passesHistory(r,activeRules));const eligible=matches.filter(r=>n(r[IDX.mfe])!==null&&n(r[IDX.mae])!==null);const bear=bearish();
      if(!eligible.length){panel.innerHTML=`<div class="opp-head"><strong>Historical opportunity window</strong><span>No completed 20${suffix()} paths for exact matches</span></div>`;return}
      const fav=med(eligible.map(r=>bear?-n(r[IDX.mae]):n(r[IDX.mfe])));const adv=med(eligible.map(r=>bear?-n(r[IDX.mfe]):n(r[IDX.mae])));
      const fav2=rate(eligible,bear?IDX.dn2:IDX.up2),fav5=rate(eligible,bear?IDX.dn5:IDX.up5),fav10=rate(eligible,bear?IDX.dn10:IDX.up10);
      const bad2=rate(eligible,bear?IDX.up2:IDX.dn2),bad5=rate(eligible,bear?IDX.up5:IDX.dn5),bad10=rate(eligible,bear?IDX.up10:IDX.dn10);
      const hit5=eligible.map(r=>n(r[bear?IDX.dn5:IDX.up5])).filter(v=>v!==null);const peak=eligible.map(r=>n(r[bear?IDX.trough:IDX.peak])).filter(v=>v!==null);const f3=med(eligible.map(r=>{const x=n(r[IDX.fwd3]);return x===null?null:(bear?-x:x)}));
      panel.innerHTML=`<div class="opp-head"><strong>Historical opportunity window</strong><span>${eligible.length.toLocaleString()} completed exact-match paths • next 20${suffix()}</span></div><div class="opp-grid">
        ${card('Median best excursion',pct(fav),'Best price reached inside window')}
        ${card('Median worst excursion',pct(adv),'Worst move against setup')}
        ${card('Reached favourable target',`${fav2?.toFixed(0)??'n/a'}% / ${fav5?.toFixed(0)??'n/a'}% / ${fav10?.toFixed(0)??'n/a'}%`,`+2% / +5% / +10%`)}
        ${card('Hit adverse level',`${bad2?.toFixed(0)??'n/a'}% / ${bad5?.toFixed(0)??'n/a'}% / ${bad10?.toFixed(0)??'n/a'}%`,`-2% / -5% / -10%`)}
        ${card(`Median +3${suffix()} close`,pct(f3),'Directional close-to-close return')}
        ${card('Median time to +5%',hit5.length?`${med(hit5).toFixed(1)} ${suffix()}`:'n/a',`${hit5.length} paths reached target`)}
        ${card('Median time to best price',peak.length?`${med(peak).toFixed(1)} ${suffix()}`:'n/a','Within 20-period window')}
      </div><div class="opp-note">Opportunity statistics use subsequent period High/Low data. If both an upside and downside threshold occur inside the same bar, OHLC data cannot reveal which happened first.</div>`;
    }catch(err){panel.innerHTML=`<div class="opp-head"><strong>Historical opportunity window</strong><span>${err.message}</span></div>`}
  }

  document.addEventListener('click',e=>{
    const btn=e.target.closest('.evidence-button');if(!btn)return;const tr=btn.closest('tr');if(!tr)return;const idx=Number(btn.dataset.index);const row=currentRows?.[idx];if(!row)return;
    setTimeout(()=>{const detail=tr.nextElementSibling;if(detail?.classList.contains('inline-evidence-row'))renderFor(detail,row)},0);
  },false);
})();
