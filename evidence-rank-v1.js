/* Scanner Evidence Lab — evidence ranking controls. */
(function(){
  if(typeof renderRows!=='function') return;
  let minSample=30,minWin=50,rankMode='quality';
  let latest=[];
  const css=document.createElement('style');css.textContent=`.evidence-rank-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.evidence-rank-tools select{border:1px solid var(--line);background:#0b121a;color:var(--text);border-radius:9px;padding:9px 10px}.evidence-rank-note{font-size:11px;color:var(--muted)}`;document.head.appendChild(css);
  const panel=[...document.querySelectorAll('.panel')].find(p=>p.querySelector('#resultsBody'));
  if(!panel)return;
  const table=panel.querySelector('.table-wrap');const tools=document.createElement('div');tools.className='evidence-rank-tools';tools.innerHTML=`<select id="evidenceRank"><option value="quality">Rank: Evidence quality</option><option value="win10">Rank: +10D success</option><option value="median5">Rank: +5D median</option><option value="sample">Rank: Sample size</option></select><select id="minEvidenceSample"><option value="0">Any sample</option><option value="10">n ≥ 10</option><option value="30" selected>n ≥ 30</option><option value="100">n ≥ 100</option><option value="500">n ≥ 500</option></select><select id="minEvidenceWin"><option value="0">Any success rate</option><option value="50" selected>Success ≥ 50%</option><option value="55">Success ≥ 55%</option><option value="60">Success ≥ 60%</option><option value="65">Success ≥ 65%</option></select><span class="evidence-rank-note" id="evidenceRankNote">Evidence filters apply as historical data finishes loading.</span>`;panel.insertBefore(tools,table);
  function n(v){v=Number(v);return Number.isFinite(v)?v:null}
  function direction(){const q=(document.querySelector('#scanQuery')?.value||'').toLowerCase();return /bearish|crossed below|rsi overbought|rsi above 70/.test(q)?'bear':'bull'}
  function stat(r,i){return r?.evidence_detail?.[i]||null}
  function sample(r){return Math.max(0,...(r?.evidence_detail||[]).map(x=>Number(x?.sample)||0))}
  function success(r,i=2){const w=n(stat(r,i)?.win);if(w===null)return null;return direction()==='bear'?100-w:w}
  function median(r,i){const m=n(stat(r,i)?.median);if(m===null)return null;return direction()==='bear'?-m:m}
  function score(r){const s=sample(r),w=success(r,2),m=median(r,1);if(rankMode==='sample')return s;if(rankMode==='win10')return w??-1e9;if(rankMode==='median5')return m??-1e9;const confidence=Math.min(1,Math.log10(Math.max(1,s))/3);return (w??0)*confidence+(m??0)*5}
  function apply(rows){const loaded=rows.some(r=>r?.evidence_detail);let out=[...rows];if(loaded){out=out.filter(r=>{const s=sample(r),w=success(r,2);return s>=minSample&&(w===null||w>=minWin)});out.sort((a,b)=>score(b)-score(a));document.querySelector('#evidenceRankNote').textContent=`Evidence-ranked view • ${out.length.toLocaleString()} qualifying matches`; }return out}
  const base=renderRows;renderRows=function(rows){latest=[...rows];base(apply(rows));};
  function refresh(){if(latest.length)base(apply(latest));}
  document.querySelector('#evidenceRank')?.addEventListener('change',e=>{rankMode=e.target.value;refresh()});document.querySelector('#minEvidenceSample')?.addEventListener('change',e=>{minSample=Number(e.target.value);refresh()});document.querySelector('#minEvidenceWin')?.addEventListener('change',e=>{minWin=Number(e.target.value);refresh()});
})();