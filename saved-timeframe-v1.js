/* Ensure saved scans restore the correct dataset before running. */
(function(){
  const KEY='sel.savedScans.v1';
  function scans(){try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch(_){return []}}
  document.addEventListener('click',async e=>{
    const btn=e.target.closest('.run-scan'); if(!btn) return;
    const card=btn.closest('.saved-card'); if(!card) return;
    const scan=scans().find(s=>s.id===Number(card.dataset.id));
    if(!scan||!scan.timeframe||scan.timeframe===(document.querySelector('#timeframe')?.value||'Daily')||typeof window.SEL_SET_TIMEFRAME!=='function') return;
    e.preventDefault(); e.stopImmediatePropagation();
    document.querySelector('#scanQuery').value=scan.query||'';
    if(scan.universe&&[...document.querySelector('#universe').options].some(o=>o.value===scan.universe)) document.querySelector('#universe').value=scan.universe;
    document.querySelector('#benchmark').value=scan.benchmark||'SPY';
    document.querySelector('.nav-item[data-view="build"]')?.click();
    await window.SEL_SET_TIMEFRAME(scan.timeframe);
  },true);
})();
