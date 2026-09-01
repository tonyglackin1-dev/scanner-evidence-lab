/* Scanner Evidence Lab — transparent evidence scoring and ranking. */
(function(){
  if(typeof renderRows!=='function') return;

  let minSample=0,minWin=0,rankMode='score';
  let latest=[];

  const css=document.createElement('style');
  css.textContent=`
    .evidence-rank-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}
    .evidence-rank-tools select{border:1px solid var(--line);background:#0b121a;color:var(--text);border-radius:9px;padding:9px 10px}
    .evidence-rank-note{font-size:11px;color:var(--muted)}
    .sel-score{display:inline-flex;align-items:center;gap:6px;margin-right:8px;padding:4px 7px;border:1px solid var(--line);border-radius:999px;font-size:11px;white-space:nowrap}
    .sel-score strong{font-size:12px}.sel-score-strong{border-color:rgba(83,240,189,.45);color:var(--accent2)}
    .sel-score-good{border-color:rgba(103,169,255,.45);color:#8bbcff}.sel-score-mixed{border-color:rgba(255,215,106,.45);color:#ffd76a}
    .sel-score-weak{border-color:rgba(255,125,136,.38);color:var(--danger)}.sel-score-none{color:var(--muted)}
    .sel-score-unproven{border-color:rgba(255,215,106,.45);color:#ffd76a;background:rgba(255,215,106,.05)}
  `;
  document.head.appendChild(css);

  const panel=[...document.querySelectorAll('.panel')].find(p=>p.querySelector('#resultsBody'));
  if(!panel)return;
  const table=panel.querySelector('.table-wrap');
  const tools=document.createElement('div');
  tools.className='evidence-rank-tools';
  tools.innerHTML=`<select id="evidenceRank">
      <option value="score">Rank: Evidence score</option>
      <option value="win10">Rank: +10 success</option>
      <option value="median5">Rank: +5 median</option>
      <option value="sample">Rank: Sample size</option>
      <option value="liquidity">Rank: Liquidity</option>
      <option value="manual">Manual table sort</option>
    </select>
    <select id="minEvidenceSample"><option value="0" selected>Any sample</option><option value="10">n ≥ 10</option><option value="30">n ≥ 30</option><option value="100">n ≥ 100</option><option value="500">n ≥ 500</option></select>
    <select id="minEvidenceWin"><option value="0" selected>Any success rate</option><option value="50">Success ≥ 50%</option><option value="55">Success ≥ 55%</option><option value="60">Success ≥ 60%</option><option value="65">Success ≥ 65%</option></select>
    <span class="evidence-rank-note" id="evidenceRankNote">Evidence Score rewards sample strength, historical success, return magnitude and horizon agreement.</span>`;
  panel.insertBefore(tools,table);

  function n(v){v=Number(v);return Number.isFinite(v)?v:null}
  function clamp(v,a=0,b=1){return Math.max(a,Math.min(b,v))}
  function direction(){
    const q=(document.querySelector('#scanQuery')?.value||'').toLowerCase();
    return /bearish|crossed below|crossing below|macd falling|price below|rsi overbought|rsi above 70/.test(q)?'bear':'bull';
  }
  function stat(r,i){return r?.evidence_detail?.[i]||null}
  function sample(r){return Math.max(0,...(r?.evidence_detail||[]).map(x=>Number(x?.sample)||0))}
  function success(r,i=2){const w=n(stat(r,i)?.win);if(w===null)return null;return direction()==='bear'?100-w:w}
  function medianDir(r,i){const m=n(stat(r,i)?.median);if(m===null)return null;return direction()==='bear'?-m:m}
  function timeframeScale(){const tf=document.querySelector('#timeframe')?.value||'Daily';return tf==='Monthly'?15:tf==='Weekly'?8:3}

  function scoreParts(r){
    const s=sample(r),w=success(r,2),m5=medianDir(r,1);
    if(!r?.evidence_detail||s===0) return {score:null,sample:s,w,m5,agreement:null};
    const samplePts=30*clamp(Math.log10(s+1)/Math.log10(501));
    const winPts=w===null?0:35*clamp((w-45)/25);
    const medianPts=m5===null?0:25*clamp(m5/timeframeScale());
    const meds=[0,1,2,3].map(i=>medianDir(r,i)).filter(v=>v!==null);
    const agreement=meds.length?meds.filter(v=>v>0).length/meds.length:null;
    const agreementPts=agreement===null?0:10*agreement;
    return {score:Math.round(samplePts+winPts+medianPts+agreementPts),sample:s,w,m5,agreement};
  }
  function scoreQuality(v){
    if(v===null)return ['No score','sel-score-none'];
    if(v>=75)return ['Strong','sel-score-strong'];
    if(v>=60)return ['Good','sel-score-good'];
    if(v>=45)return ['Mixed','sel-score-mixed'];
    return ['Weak','sel-score-weak'];
  }
  function confidence(s){
    if(s<10)return ['Unproven','Very low confidence'];
    if(s<30)return ['Low confidence','Low confidence'];
    if(s<100)return ['Moderate confidence','Moderate confidence'];
    return ['High confidence','High confidence'];
  }
  function rowScore(r){return scoreParts(r).score}
  function sortValue(r){
    if(rankMode==='sample')return sample(r);
    if(rankMode==='win10')return success(r,2)??-1e9;
    if(rankMode==='median5')return medianDir(r,1)??-1e9;
    if(rankMode==='liquidity')return n(r.avg_dollar_vol20)??-1e9;
    return rowScore(r)??-1e9;
  }
  function syncSortAuthority(){window.SEL_RESULTS_TOOLS?.setExternalRanking(rankMode!=='manual');}
  function apply(rows){
    let out=[...rows];
    const anyLoaded=out.some(r=>r?.evidence_detail);
    if(anyLoaded){
      out=out.filter(r=>{
        const s=sample(r),w=success(r,2);
        return s>=minSample&&(minWin===0||w===null||w>=minWin);
      });
      if(rankMode!=='manual') out.sort((a,b)=>sortValue(b)-sortValue(a));
    }
    const filtered=minSample>0||minWin>0;
    const note=document.querySelector('#evidenceRankNote');
    if(note){
      if(!anyLoaded) note.textContent='Evidence scores will appear as ticker history loads.';
      else if(filtered) note.textContent=`Evidence filters • ${out.length.toLocaleString()} of ${rows.length.toLocaleString()} matches shown`;
      else if(rankMode==='manual') note.textContent='Manual table sort is active above.';
      else note.textContent=`Showing all ${out.length.toLocaleString()} matches • ranked by ${rankMode==='score'?'Evidence Score':rankMode}`;
    }
    return out;
  }

  function decorate(rows){
    const byTicker=new Map(rows.map(r=>[String(r.ticker),r]));
    document.querySelectorAll('#resultsBody tr[data-index]').forEach(tr=>{
      const ticker=tr.querySelector('.ticker')?.textContent?.trim();
      const r=byTicker.get(ticker);if(!r)return;
      const cell=tr.querySelector('td:last-child');if(!cell)return;
      cell.querySelector('.sel-score')?.remove();
      const p=scoreParts(r);
      let [label,cls]=scoreQuality(p.score);
      const [confidenceLabel,confidenceText]=confidence(p.sample);
      if(p.score!==null&&p.sample<10){label='Unproven';cls='sel-score-unproven';}
      const badge=document.createElement('span');badge.className=`sel-score ${cls}`;
      badge.title=p.score===null?'No exact historical matches yet':`Evidence Score ${p.score}/100 • ${confidenceText} • n=${p.sample} • +10 success ${p.w===null?'n/a':p.w.toFixed(1)+'%'} • +5 directional median ${p.m5===null?'n/a':p.m5.toFixed(2)+'%'}`;
      badge.innerHTML=p.score===null?`<strong>—</strong> ${label}`:`<strong>${p.score}</strong> ${label}${p.sample>=10?` · ${confidenceLabel}`:''}`;
      cell.prepend(badge);
    });
  }

  const base=renderRows;
  syncSortAuthority();
  renderRows=function(rows){
    latest=[...rows];
    const shown=apply(rows);
    base(shown);
    queueMicrotask(()=>decorate(shown));
  };
  function refresh(){
    if(!latest.length)return;
    const shown=apply(latest);base(shown);queueMicrotask(()=>decorate(shown));
  }

  document.querySelector('#evidenceRank')?.addEventListener('change',e=>{rankMode=e.target.value;syncSortAuthority();refresh()});
  document.querySelector('#minEvidenceSample')?.addEventListener('change',e=>{minSample=Number(e.target.value);refresh()});
  document.querySelector('#minEvidenceWin')?.addEventListener('change',e=>{minWin=Number(e.target.value);refresh()});

  window.SEL_EVIDENCE_SCORE={scoreParts,scoreQuality,confidence};
})();
