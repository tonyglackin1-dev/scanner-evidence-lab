/* Scanner result utility layer: search, sorting and CSV export. */
(function(){
  let query='';
  let sortKey='liquidity';
  let sortDir=-1;
  let baseRows=[];

  const css=document.createElement('style');
  css.textContent=`
    .results-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}
    .results-tools input,.results-tools select{border:1px solid var(--line);background:#0b121a;color:var(--text);border-radius:9px;padding:9px 10px}
    .results-tools input{min-width:210px}.results-tools .tool-button{border:1px solid var(--line);background:#101a24;color:var(--text);border-radius:9px;padding:9px 11px;cursor:pointer}
    .results-tools .tool-button:hover{border-color:var(--accent2)}
    @media(max-width:640px){.results-tools input,.results-tools select,.results-tools .tool-button{width:100%}}
  `;
  document.head.appendChild(css);

  const panel=[...document.querySelectorAll('.panel')].find(p=>p.querySelector('#resultsBody'));
  if(panel){
    const wrap=panel.querySelector('.table-wrap');
    const tools=document.createElement('div');
    tools.className='results-tools';
    tools.innerHTML=`<input id="resultSearch" placeholder="Search ticker or company" />
      <select id="resultSort"><option value="liquidity">Liquidity</option><option value="ticker">Ticker</option><option value="price">Price</option><option value="rsi">RSI</option><option value="relvol">Relative volume</option><option value="hist5">Historical +5</option></select>
      <button id="resultSortDir" class="tool-button" title="Change sort direction">↓</button>
      <button id="exportResultsCsv" class="tool-button">EXPORT CSV</button>`;
    panel.insertBefore(tools,wrap);
  }

  function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
  function histNum(r){const v=r?.evidence_detail?.[1]?.median ?? r?.evidence?.[1];return num(v)}
  function comparator(a,b){
    let av,bv;
    switch(sortKey){
      case 'ticker': av=a.ticker||'';bv=b.ticker||'';return sortDir*String(av).localeCompare(String(bv));
      case 'price': av=num(a.close);bv=num(b.close);break;
      case 'rsi': av=num(a.rsi);bv=num(b.rsi);break;
      case 'relvol': av=num(a.relvol);bv=num(b.relvol);break;
      case 'hist5': av=histNum(a);bv=histNum(b);break;
      default: av=num(a.avg_dollar_vol20);bv=num(b.avg_dollar_vol20);break;
    }
    av=av??-Infinity;bv=bv??-Infinity;return sortDir*(av-bv);
  }
  function viewRows(){
    let rows=[...baseRows];
    if(query){const q=query.toLowerCase();rows=rows.filter(r=>String(r.ticker||'').toLowerCase().includes(q)||String(r.name||'').toLowerCase().includes(q));}
    rows.sort(comparator);return rows;
  }
  function refresh(){
    if(!baseRows.length)return;
    const rows=viewRows();
    coreRender(rows);
    const stamp=document.querySelector('#resultTimestamp');
    if(stamp&&query&&!stamp.textContent.includes('filtered view')) stamp.textContent+=` • filtered view ${rows.length}`;
  }

  if(typeof renderRows!=='function')return;
  const coreRender=renderRows;
  renderRows=function(rows){
    baseRows=[...rows];
    const shown=viewRows();
    coreRender(shown);
  };

  document.querySelector('#resultSearch')?.addEventListener('input',e=>{query=e.target.value.trim();refresh();});
  document.querySelector('#resultSort')?.addEventListener('change',e=>{sortKey=e.target.value;refresh();});
  document.querySelector('#resultSortDir')?.addEventListener('click',e=>{sortDir*=-1;e.target.textContent=sortDir<0?'↓':'↑';refresh();});

  function csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
  document.querySelector('#exportResultsCsv')?.addEventListener('click',()=>{
    const rows=viewRows();
    const u=document.querySelector('#timeframe')?.value||'Daily';
    const header=['Ticker','Name','Timeframe','Price','RSI','Relative Volume','Trend','Historical +5','Exchange','ETF'];
    const lines=[header.map(csvCell).join(',')];
    rows.forEach(r=>lines.push([
      r.ticker,r.name,u,r.close,r.rsi,r.relvol,r.trend||'',histNum(r),r.exchange,r.is_etf?'Yes':'No'
    ].map(csvCell).join(',')));
    const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`scanner-evidence-${u.toLowerCase()}-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);
  });
})();
