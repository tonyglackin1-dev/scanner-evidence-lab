/* Scanner Evidence Lab — cleaner first-run trader example. */
(function(){
  const q=document.querySelector('#scanQuery');
  if(!q)return;
  const old='RSI below 45, MACD rising, price above the 200-day moving average and relative volume above 1.5x';
  const next='within 3% of the 52-week high and relative volume above 1.5x';
  if(q.value.trim()!==old)return;
  q.value=next;
  if(typeof runEasyMode==='function') runEasyMode();
})();