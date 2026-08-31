/* Scanner Evidence Lab — richer directional evidence layer. */
(function(){
  if(typeof showEvidence!=='function') return;

  const css=document.createElement('style');
  css.textContent=`
    .deep-evidence{margin-top:18px}.deep-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
    .deep-badges{display:flex;gap:8px;flex-wrap:wrap}.deep-badge{border:1px solid var(--line);border-radius:999px;padding:6px 9px;font-size:11px;color:var(--muted)}
    .deep-grid{display:grid;grid-template-columns:repeat(4,minmax(145px,1fr));gap:10px;margin-top:14px}
    .deep-card{border:1px solid var(--line);border-radius:12px;background:#0b121a;padding:12px;display:grid;gap:7px}
    .deep-card h4{margin:0;font-size:13px}.deep-card strong{font-size:20px}.deep-card small{color:var(--muted)}
    .deep-row{display:flex;justify-content:space-between;gap:12px;font-size:12px}.deep-row span:first-child{color:var(--muted)}
    .deep-positive{color:var(--accent2)}.deep-negative{color:var(--danger)}
    .quality-high{border-color:rgba(83,240,189,.45);color:var(--accent2)}.quality-medium{border-color:rgba(255,215,106,.45);color:#ffd76a}.quality-low{border-color:rgba(255,125,136,.45);color:var(--danger)}
    @media(max-width:900px){.deep-grid{grid-template-columns:repeat(2,minmax(145px,1fr))}}@media(max-width:520px){.deep-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(css);

  const grid=document.querySelector('.evidence-grid');
  if(!grid) return;
  const panel=document.createElement('section');
  panel.className='panel deep-evidence';
  panel.innerHTML=`<div class="deep-head"><div><span class="eyebrow">Evidence Quality</span><h3 id="deepEvidenceTitle">Select a scanner result</h3></div><div class="deep-badges"><span id="deepDirection" class="deep-badge">Direction —</span><span id="deepQuality" class="deep-badge">Sample —</span></div></div><div id="deepEvidenceGrid" class="deep-grid"></div>`;
  grid.insertAdjacentElement('afterend',panel);

  function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
  function pct(v){const x=n(v);return x===null?'n/a':`${x>=0?'+':''}${x.toFixed(2)}%`}
  function rate(v){const x=n(v);return x===null?'n/a':`${x.toFixed(1)}%`}
  function median(xs){const a=xs.map(n).filter(x=>x!==null).sort((a,b)=>a-b);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
  function quantile(xs,q){const a=xs.map(n).filter(x=>x!==null).sort((a,b)=>a-b);if(!a.length)return null;const p=(a.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(p-lo)}
  function mean(xs){const a=xs.map(n).filter(x=>x!==null);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null}

  function directionFor(rules){
    let bull=0,bear=0;
    for(const r of rules||[]){
      const f=String(r.field||''),label=String(r.label||'').toLowerCase();
      if((f.includes('cross')&&r.value===-1)||/bearish|crossed below/.test(label)) bear+=3;
      if((f.includes('cross')&&r.value===1)||/bullish|crossed above/.test(label)) bull+=3;
      if(/^ema_pair_/.test(f)){r.op==='<'?bear++:bull++}
      if(/^sma/.test(f)){r.op==='<'?bear++:bull++}
      if(f==='macd'){r.op==='<'?bear++:bull++}
      if(f==='rsi'&&r.op==='>'&&Number(r.value)>=70) bear++;
      if(f==='rsi'&&r.op==='<'&&Number(r.value)<=30) bull++;
    }
    if(bear>bull)return 'Bearish';if(bull>bear)return 'Bullish';return 'Neutral';
  }
  function quality(sample){if(sample>=100)return ['High','quality-high'];if(sample>=30)return ['Medium','quality-medium'];return ['Low','quality-low']}
  function directionalWin(rawWin,direction){const x=n(rawWin);if(x===null)return null;return direction==='Bearish'?100-x:x}
  function directionalReturn(raw,direction){const x=n(raw);if(x===null)return null;return direction==='Bearish'?-x:x}

  function render(row,rules){
    const stats=row?.evidence_detail;
    const root=document.querySelector('#deepEvidenceGrid');
    if(!stats||!root){return;}
    const direction=directionFor(rules);
    const sample=Math.max(...stats.map(s=>Number(s?.sample)||0));
    const [qName,qClass]=quality(sample);
    document.querySelector('#deepEvidenceTitle').textContent=`Historical profile for ${row.ticker}`;
    document.querySelector('#deepDirection').textContent=`${direction} setup`;
    const qb=document.querySelector('#deepQuality');qb.className=`deep-badge ${qClass}`;qb.textContent=`${qName} evidence • n=${sample.toLocaleString()}`;
    const labels=['+1 Day','+5 Days','+10 Days','+20 Days'];
    root.innerHTML=stats.map((s,i)=>{
      const values=(s?.values||[]).map(n).filter(x=>x!==null);
      const med=n(s?.median),rawWin=n(s?.win),dirWin=directionalWin(rawWin,direction),dirMed=directionalReturn(med,direction);
      const avg=mean(values),q25=quantile(values,.25),q75=quantile(values,.75),worst=values.length?Math.min(...values):null,best=values.length?Math.max(...values):null;
      const cls=dirMed===null?'':dirMed>=0?'deep-positive':'deep-negative';
      const successLabel=direction==='Bearish'?'Directional success':'Positive close rate';
      return `<article class="deep-card"><h4>${labels[i]}</h4><strong class="${cls}">${pct(med)}</strong><small>Median raw return</small><div class="deep-row"><span>${successLabel}</span><b>${rate(dirWin)}</b></div><div class="deep-row"><span>Average</span><b>${pct(avg)}</b></div><div class="deep-row"><span>25th / 75th pct.</span><b>${pct(q25)} / ${pct(q75)}</b></div><div class="deep-row"><span>Worst / Best</span><b>${pct(worst)} / ${pct(best)}</b></div><div class="deep-row"><span>Events</span><b>${Number(s?.sample||0).toLocaleString()}</b></div></article>`;
    }).join('');
  }

  const baseShow=showEvidence;
  showEvidence=async function(row,rules){
    await baseShow(row,rules);
    render(row,rules);
  };

  window.SEL_DEEP_EVIDENCE={render,directionFor};
})();
