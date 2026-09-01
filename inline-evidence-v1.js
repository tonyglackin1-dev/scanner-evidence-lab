/* Scanner Evidence Lab — inline expandable evidence beneath result rows. */
(function(){
  const css=document.createElement('style');
  css.textContent=`
    .inline-evidence-row td{padding:0!important;border-top:0!important}
    .inline-evidence-box{margin:0 8px 10px;padding:14px;border:1px solid var(--line);border-radius:12px;background:#0b121a}
    .inline-evidence-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
    .inline-evidence-head strong{font-size:14px}.inline-evidence-head span{font-size:11px;color:var(--muted)}
    .inline-evidence-grid{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px}
    .inline-evidence-card{border:1px solid var(--line);border-radius:10px;padding:10px;display:grid;gap:4px}
    .inline-evidence-card span{font-size:11px;color:var(--muted)}.inline-evidence-card strong{font-size:17px}
    .inline-evidence-rules{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.inline-evidence-rules span{border:1px solid var(--line);border-radius:999px;padding:5px 7px;font-size:10px;color:var(--muted)}
    .evidence-button[aria-expanded="true"]{border-color:var(--accent2);color:var(--accent2)}
    @media(max-width:700px){.inline-evidence-grid{grid-template-columns:repeat(2,minmax(120px,1fr))}}
  `;
  document.head.appendChild(css);

  function tfSuffix(){const t=document.querySelector('#timeframe')?.value||'Daily';return t==='Weekly'?'W':t==='Monthly'?'M':'D';}
  function closeOpen(except){
    document.querySelectorAll('.inline-evidence-row').forEach(r=>{if(r!==except)r.remove();});
    document.querySelectorAll('.evidence-button[aria-expanded="true"]').forEach(b=>{if(!except||b.closest('tr')!==except.previousElementSibling){b.setAttribute('aria-expanded','false');b.textContent='View';}});
  }
  function card(label,s){
    const med=s?.median; const sample=Number(s?.sample||0); const win=s?.win;
    return `<div class="inline-evidence-card"><span>${label}</span><strong>${fmtEvidence(med)}</strong><span>${sample.toLocaleString()} events${win==null?'':` • ${Number(win).toFixed(1)}% positive`}</span></div>`;
  }
  function render(detail,row,stats){
    const su=tfSuffix();
    detail.querySelector('.inline-evidence-box').innerHTML=`<div class="inline-evidence-head"><strong>${row.ticker} historical aftermath</strong><span>Exact matches to this scan</span></div><div class="inline-evidence-grid">${card(`+1${su}`,stats[0])}${card(`+5${su}`,stats[1])}${card(`+10${su}`,stats[2])}${card(`+20${su}`,stats[3])}</div><div class="inline-evidence-rules">${(row.rules||[]).map(x=>`<span>${x}</span>`).join('')}</div>`;
  }

  document.addEventListener('click',async e=>{
    const btn=e.target.closest('.evidence-button');
    if(!btn) return;
    const tr=btn.closest('tr'); if(!tr) return;
    const idx=Number(btn.dataset.index); const row=currentRows?.[idx]; if(!row) return;
    const existing=tr.nextElementSibling;
    if(existing?.classList.contains('inline-evidence-row')){
      existing.remove(); btn.setAttribute('aria-expanded','false'); btn.textContent='View'; return;
    }
    closeOpen();
    const detail=document.createElement('tr');detail.className='inline-evidence-row';detail.innerHTML='<td colspan="7"><div class="inline-evidence-box">Loading historical evidence…</div></td>';
    tr.insertAdjacentElement('afterend',detail);btn.setAttribute('aria-expanded','true');btn.textContent='Hide';
    try{
      const stats=row.evidence_detail||await tickerEvidence(row.ticker,activeRules);
      row.evidence_detail=stats;row.evidence=stats.map(s=>s.median);row.d5=fmtEvidence(stats[1]?.median);
      if(detail.isConnected) render(detail,row,stats);
    }catch(err){if(detail.isConnected)detail.querySelector('.inline-evidence-box').textContent=`Historical evidence unavailable: ${err.message}`;}
  },true);
})();