/* Scanner Evidence Lab — keep Sample Size semantically honest.
   The exact evidence engine loads historical data shard-by-shard. Older UI code
   temporarily wrote shard progress (for example 18/128) into the Sample Size
   metric. That looked like a changing event count. This presentation guard keeps
   the card on Loading… until the engine writes the final historical-event total. */
(function(){
  const metric=document.querySelector('#sampleMetric');
  if(!metric) return;

  const card=metric.closest('.metric-card');
  const note=card?.querySelector('small');

  function timeframeSuffix(){
    const tf=document.querySelector('#timeframe')?.value||'Daily';
    return tf==='Weekly'?'W':tf==='Monthly'?'M':'D';
  }

  function finalNote(){
    return `Exact +5${timeframeSuffix()} historical events`;
  }

  function normalise(){
    const text=String(metric.textContent||'').trim();
    if(/^\d[\d,]*\s*\/\s*\d[\d,]*$/.test(text)){
      metric.textContent='Loading…';
      if(note) note.textContent='Loading exact historical evidence';
      return;
    }
    if(text==='…'){
      metric.textContent='Loading…';
      if(note) note.textContent='Loading exact historical evidence';
      return;
    }
    if(text==='Loading…') return;
    if(note) note.textContent=finalNote();
  }

  const observer=new MutationObserver(normalise);
  observer.observe(metric,{childList:true,characterData:true,subtree:true});
  document.querySelector('#timeframe')?.addEventListener('change',normalise);
  normalise();
})();
