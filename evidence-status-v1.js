/* Scanner Evidence Lab — clarify history availability vs exact historical rule matches. */
(function(){
  const status=document.querySelector('#resultTimestamp');
  const sample=document.querySelector('#sampleMetric');
  if(!status||!sample) return;

  let updating=false;

  function exactMatchesText(){
    const raw=String(sample.textContent||'').trim();
    if(!raw||raw==='…'||/^Loading/i.test(raw)) return 'loading';
    const n=Number(raw.replace(/,/g,''));
    return Number.isFinite(n)?n.toLocaleString():'loading';
  }

  function rewrite(){
    if(updating) return;
    const text=String(status.textContent||'');
    const m=text.match(/(?:exact evidence|history loaded):\s*([\d,]+)\s*\/\s*([\d,]+)\s*(?:matched tickers with history|tickers)(?:\s*•\s*Exact historical matches:\s*(?:[\d,]+|loading))?/i);
    if(!m) return;

    const exact=exactMatchesText();
    const replacement=`History loaded: ${m[1]}/${m[2]} tickers • Exact historical matches: ${exact}`;
    const next=text.replace(m[0],replacement);
    if(next===text) return;

    updating=true;
    status.textContent=next;
    updating=false;
  }

  new MutationObserver(rewrite).observe(status,{childList:true,characterData:true,subtree:true});
  new MutationObserver(rewrite).observe(sample,{childList:true,characterData:true,subtree:true});
  rewrite();
})();
