const body=document.querySelector('#resultsBody');
const evidenceTitle=document.querySelector('#evidenceTitle');
const evidenceList=document.querySelector('#evidenceList');
const distribution=document.querySelector('#distribution');
const ruleChips=document.querySelector('.rule-chips');
const evIds=['ev1','ev5','ev10','ev20'];
let scannerData=null;
let currentRows=[];

const HIST={
  rsi:0,macd:1,macd_prev:2,macd_signal:3,macd_signal_prev:4,close:5,
  sma20:6,sma50:7,sma200:8,relvol:9,chg1:10,chg5:11,from_high52:12,from_low52:13,
  fwd1:14,fwd5:15,fwd10:16,fwd20:17
};

function fmtEvidence(v){
  if(v===null || v===undefined || Number.isNaN(Number(v))) return 'n/a';
  const n=Number(v);
  return `${n>=0?'+':''}${n.toFixed(2)}%`;
}

function median(values){
  const xs=values.filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))).map(Number).sort((a,b)=>a-b);
  if(!xs.length) return null;
  const m=Math.floor(xs.length/2);
  return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2;
}

function parseRules(text){
  const q=text.toLowerCase().replace(/≤/g,'<=').replace(/≥/g,'>=').replace(/–/g,'-').replace(/52 week/g,'52-week');
  const rules=[];
  const add=(field,op,value,label)=>{
    if(!rules.some(r=>r.field===field&&r.op===op&&r.value===value)) rules.push({field,op,value,label});
  };

  let m;
  if((m=q.match(/rsi(?:\s*\(14\))?\s*(?:below|under|less than|<)\s*(\d+(?:\.\d+)?)/))) add('rsi','<',Number(m[1]),`RSI < ${m[1]}`);
  if((m=q.match(/rsi(?:\s*\(14\))?\s*(?:above|over|greater than|>)\s*(\d+(?:\.\d+)?)/))) add('rsi','>',Number(m[1]),`RSI > ${m[1]}`);
  if(/oversold/.test(q)&&!/rsi/.test(q)) add('rsi','<',30,'RSI < 30 (oversold)');
  if(/overbought/.test(q)&&!/rsi/.test(q)) add('rsi','>',70,'RSI > 70 (overbought)');

  if(/macd\s+(?:rising|increasing|improving|turning up)/.test(q)) add('macd_rising','=',true,'MACD rising');
  if(/macd\s+(?:falling|decreasing|weakening|turning down)/.test(q)) add('macd_rising','=',false,'MACD falling');
  if(/macd\s+(?:above|over|greater than)\s*(?:zero|0)|macd\s+positive/.test(q)) add('macd','>',0,'MACD > 0');
  if(/macd\s+(?:below|under|less than)\s*(?:zero|0)|macd\s+negative/.test(q)) add('macd','<',0,'MACD < 0');
  if(/macd.*(?:bullish cross|crossed? above|crossing above).*(?:signal)?|bullish macd cross/.test(q)) add('macd_cross','=',1,'MACD bullish signal cross');
  if(/macd.*(?:bearish cross|crossed? below|crossing below).*(?:signal)?|bearish macd cross/.test(q)) add('macd_cross','=',-1,'MACD bearish signal cross');

  const maPatterns=[
    {re:/(?:price|close)\s+(?:above|over)\s+(?:the\s+)?(20|50|200)(?:\s*-?\s*day)?\s+(?:moving average|ma|dma)/,op:'>'},
    {re:/(?:price|close)\s+(?:below|under)\s+(?:the\s+)?(20|50|200)(?:\s*-?\s*day)?\s+(?:moving average|ma|dma)/,op:'<'},
    {re:/(?:above|over)\s+(?:the\s+)?(20|50|200)\s*(?:dma|ma)/,op:'>'},
    {re:/(?:below|under)\s+(?:the\s+)?(20|50|200)\s*(?:dma|ma)/,op:'<'}
  ];
  for(const p of maPatterns){
    m=q.match(p.re);
    if(m){const n=Number(m[1]); add(`sma${n}`,p.op,null,`Price ${p.op} ${n} DMA`);}
  }

  if((m=q.match(/(?:relative volume|rel(?:ative)?\s*vol(?:ume)?|rvol)\s*(?:above|over|greater than|>)\s*(\d+(?:\.\d+)?)\s*x?/))) add('relvol','>',Number(m[1]),`Rel Vol > ${m[1]}x`);
  if((m=q.match(/(?:relative volume|rel(?:ative)?\s*vol(?:ume)?|rvol)\s*(?:below|under|less than|<)\s*(\d+(?:\.\d+)?)\s*x?/))) add('relvol','<',Number(m[1]),`Rel Vol < ${m[1]}x`);
  if((m=q.match(/volume\s+(?:at least|above|over)\s*(\d+(?:\.\d+)?)\s*x\s*(?:normal|average)?/))) add('relvol','>',Number(m[1]),`Rel Vol > ${m[1]}x`);

  const movePatterns=[
    {re:/(?:today|1\s*-?\s*day|one\s+day).*?(?:up|gain(?:ed)?|rise|rose|higher).*?(\d+(?:\.\d+)?)\s*%/,field:'chg1',op:'>'},
    {re:/(?:up|gain(?:ed)?|rise|rose|higher).*?(\d+(?:\.\d+)?)\s*%.*?(?:today|1\s*-?\s*day|one\s+day)/,field:'chg1',op:'>'},
    {re:/(?:today|1\s*-?\s*day|one\s+day).*?(?:down|drop(?:ped)?|fall|fell|lower).*?(\d+(?:\.\d+)?)\s*%/,field:'chg1',op:'<'},
    {re:/(?:down|drop(?:ped)?|fall|fell|lower).*?(\d+(?:\.\d+)?)\s*%.*?(?:today|1\s*-?\s*day|one\s+day)/,field:'chg1',op:'<'},
    {re:/(?:5\s*-?\s*day|five\s+day).*?(?:up|gain|rise|higher).*?(\d+(?:\.\d+)?)\s*%/,field:'chg5',op:'>'},
    {re:/(?:5\s*-?\s*day|five\s+day).*?(?:down|drop|fall|lower).*?(\d+(?:\.\d+)?)\s*%/,field:'chg5',op:'<'}
  ];
  for(const p of movePatterns){
    m=q.match(p.re);
    if(m){
      const raw=Number(m[1]);
      const val=p.op==='<'?-raw:raw;
      add(p.field,p.op,val,`${p.field==='chg1'?'1D':'5D'} move ${p.op} ${val}%`);
    }
  }
  if((m=q.match(/(?:1\s*-?\s*day|daily|today)\s*(?:change|move)?\s*(?:above|over|>)\s*([+-]?\d+(?:\.\d+)?)\s*%/))) add('chg1','>',Number(m[1]),`1D move > ${m[1]}%`);
  if((m=q.match(/(?:1\s*-?\s*day|daily|today)\s*(?:change|move)?\s*(?:below|under|<)\s*([+-]?\d+(?:\.\d+)?)\s*%/))) add('chg1','<',Number(m[1]),`1D move < ${m[1]}%`);
  if((m=q.match(/(?:5\s*-?\s*day|five\s+day)\s*(?:change|move)?\s*(?:above|over|>)\s*([+-]?\d+(?:\.\d+)?)\s*%/))) add('chg5','>',Number(m[1]),`5D move > ${m[1]}%`);
  if((m=q.match(/(?:5\s*-?\s*day|five\s+day)\s*(?:change|move)?\s*(?:below|under|<)\s*([+-]?\d+(?:\.\d+)?)\s*%/))) add('chg5','<',Number(m[1]),`5D move < ${m[1]}%`);

  if((m=q.match(/(?:within|less than)\s*(\d+(?:\.\d+)?)\s*%\s*(?:of|from)\s*(?:the\s+)?52-week\s+high/))) add('from_high52','>',-Number(m[1]),`Within ${m[1]}% of 52-week high`);
  if((m=q.match(/(?:at least|more than|over|above)\s*(\d+(?:\.\d+)?)\s*%\s*(?:above|from)\s*(?:the\s+)?52-week\s+low/))) add('from_low52','>',Number(m[1]),`${m[1]}%+ above 52-week low`);
  if(/near\s+(?:the\s+)?52-week\s+high/.test(q)) add('from_high52','>',-5,'Within 5% of 52-week high');
  if(/near\s+(?:the\s+)?52-week\s+low/.test(q)) add('from_low52','<',5,'Within 5% of 52-week low');

  return rules;
}

function historyValue(row,field){
  if(field==='macd_rising') return row[HIST.macd]>row[HIST.macd_prev];
  if(field==='macd_cross'){
    const now=row[HIST.macd]-row[HIST.macd_signal];
    const prev=row[HIST.macd_prev]-row[HIST.macd_signal_prev];
    return prev<=0&&now>0?1:(prev>=0&&now<0?-1:0);
  }
  if(field==='sma20'||field==='sma50'||field==='sma200') return {close:row[HIST.close],ma:row[HIST[field]]};
  return row[HIST[field]];
}

function latestValue(row,field){
  if(field==='macd_rising') return row.macd>row.macd_prev;
  if(field==='macd_cross'){
    const now=row.macd-row.macd_signal;
    const prev=row.macd_prev-row.macd_signal_prev;
    return prev<=0&&now>0?1:(prev>=0&&now<0?-1:0);
  }
  if(field==='sma20'||field==='sma50'||field==='sma200') return {close:row.close,ma:row[field]};
  return row[field];
}

function passRule(value,rule){
  if(value===null||value===undefined) return false;
  if(rule.field==='sma20'||rule.field==='sma50'||rule.field==='sma200'){
    if(value.close===null||value.ma===null) return false;
    return rule.op==='>'?value.close>value.ma:value.close<value.ma;
  }
  if(rule.op==='=') return value===rule.value;
  const n=Number(value);
  return rule.op==='>'?n>rule.value:n<rule.value;
}

function passesLatest(row,rules){return rules.every(rule=>passRule(latestValue(row,rule.field),rule));}
function passesHistory(row,rules){return rules.every(rule=>passRule(historyValue(row,rule.field),rule));}

function statsFromEvents(events){
  const horizons=[HIST.fwd1,HIST.fwd5,HIST.fwd10,HIST.fwd20];
  return horizons.map(idx=>{
    const values=events.map(r=>r[idx]).filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))).map(Number);
    return {median:median(values),win:values.length?values.filter(v=>v>0).length/values.length*100:null,sample:values.length,values};
  });
}

function tickerEvidence(ticker,rules){
  const events=(scannerData.history?.[ticker]||[]).filter(r=>passesHistory(r,rules));
  return statsFromEvents(events);
}

function globalEvidence(rules){
  const events=[];
  Object.values(scannerData.history||{}).forEach(rows=>rows.forEach(r=>{if(passesHistory(r,rules)) events.push(r);}));
  return statsFromEvents(events);
}

function describeRule(row,rule){
  switch(rule.field){
    case 'rsi': return `RSI ${Number(row.rsi).toFixed(1)} ${rule.op} ${rule.value}`;
    case 'macd_rising': return `MACD ${row.macd>row.macd_prev?'rising':'falling'} vs prior session`;
    case 'macd': return `MACD ${Number(row.macd).toFixed(3)} ${rule.op} 0`;
    case 'macd_cross': return rule.value===1?'MACD bullish signal-line crossover':'MACD bearish signal-line crossover';
    case 'sma20': return `Close $${Number(row.close).toFixed(2)} ${rule.op} 20 DMA $${Number(row.sma20).toFixed(2)}`;
    case 'sma50': return `Close $${Number(row.close).toFixed(2)} ${rule.op} 50 DMA $${Number(row.sma50).toFixed(2)}`;
    case 'sma200': return `Close $${Number(row.close).toFixed(2)} ${rule.op} 200 DMA $${Number(row.sma200).toFixed(2)}`;
    case 'relvol': return `Relative volume ${Number(row.relvol).toFixed(2)}x ${rule.op} ${rule.value}x`;
    case 'chg1': return `1-day move ${Number(row.chg1).toFixed(2)}% ${rule.op} ${rule.value}%`;
    case 'chg5': return `5-day move ${Number(row.chg5).toFixed(2)}% ${rule.op} ${rule.value}%`;
    case 'from_high52': return `${Math.abs(Number(row.from_high52)).toFixed(1)}% below 52-week high`;
    case 'from_low52': return `${Number(row.from_low52).toFixed(1)}% above 52-week low`;
    default:return rule.label;
  }
}

function buildDisplayRow(row,rules){
  const stats=tickerEvidence(row.ticker,rules);
  const evidence=stats.map(s=>s.median);
  return {
    ...row,
    price:`$${Number(row.close).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`,
    rv:`${Number(row.relvol).toFixed(2)}x`,
    trend:row.close>row.sma200?'Above 200 DMA':'Below 200 DMA',
    d5:fmtEvidence(stats[1].median),
    evidence,
    evidence_detail:stats,
    rules:rules.map(rule=>describeRule(row,rule))
  };
}

function renderRuleChips(rules){
  ruleChips.innerHTML='';
  if(!rules.length){
    const span=document.createElement('span'); span.textContent='No supported rules detected'; ruleChips.appendChild(span); return;
  }
  rules.forEach(rule=>{const span=document.createElement('span');span.textContent=rule.label;ruleChips.appendChild(span);});
}

function renderRows(rows){
  currentRows=rows;
  if(!rows.length){
    body.innerHTML='<tr><td colspan="7" class="muted">No symbols currently match the interpreted rules.</td></tr>';
    evidenceTitle.textContent='No current match selected';
    evidenceList.innerHTML='<li><span>The scan ran successfully.</span><b>0 matches</b></li>';
    distribution.innerHTML='';
    evIds.forEach(id=>document.querySelector(`#${id}`).textContent='n/a');
    return;
  }
  body.innerHTML=rows.map((r,i)=>`<tr data-index="${i}"><td class="ticker">${r.ticker}</td><td>${r.price}</td><td>${r.rsi}</td><td>${r.rv}</td><td>${r.trend}</td><td class="${String(r.d5||'').startsWith('-')?'negative':'positive'}">${r.d5}</td><td><button class="evidence-button" data-index="${i}">View</button></td></tr>`).join('');
  document.querySelectorAll('tbody tr,.evidence-button').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const row=rows[Number(el.dataset.index)];
    if(row) showEvidence(row);
  }));
}

function showEvidence(row){
  evidenceTitle.textContent=`Evidence for ${row.ticker}`;
  row.evidence.forEach((v,i)=>document.querySelector(`#${evIds[i]}`).textContent=fmtEvidence(v));
  const d5=row.evidence_detail?.[1];
  const d10=row.evidence_detail?.[2];
  evidenceList.innerHTML=row.rules.map(rule=>`<li><span>${rule}</span><b>Pass</b></li>`).join('')+
    `<li><span>Historical +5D sample</span><b>${d5?.sample??0}</b></li>`+
    `<li><span>Historical +10D win rate</span><b>${d10?.win==null?'n/a':d10.win.toFixed(1)+'%'}</b></li>`;
  distribution.innerHTML='';
  const values=d5?.values||[];
  if(values.length){
    const buckets=24, sorted=[...values].sort((a,b)=>a-b), min=sorted[0], max=sorted[sorted.length-1], range=Math.max(.01,max-min);
    const counts=Array(buckets).fill(0);
    sorted.forEach(v=>counts[Math.min(buckets-1,Math.floor((v-min)/range*buckets))]++);
    const peak=Math.max(1,...counts);
    counts.forEach(c=>{const b=document.createElement('span');b.style.height=`${Math.max(8,c/peak*96)}%`;distribution.appendChild(b)});
  }
}

function setMetrics(rules,rows){
  const stats=globalEvidence(rules);
  document.querySelector('#matchesMetric').textContent=rows.length;
  document.querySelector('#median5Metric').textContent=fmtEvidence(stats[1].median);
  document.querySelector('#winMetric').textContent=stats[2].win===null?'n/a':`${stats[2].win.toFixed(1)}%`;
  document.querySelector('#sampleMetric').textContent=stats[1].sample.toLocaleString();
  const when=scannerData.generated_at?new Date(scannerData.generated_at):null;
  const whenText=when&&!Number.isNaN(when.getTime())?when.toLocaleString():'unknown time';
  document.querySelector('#resultTimestamp').textContent=`Yahoo EOD • ${stats[1].sample.toLocaleString()} historical events • refreshed ${whenText}`;
}

function runEasyMode(){
  if(!scannerData?.latest||!scannerData?.history) return;
  const query=document.querySelector('#scanQuery').value;
  const rules=parseRules(query);
  renderRuleChips(rules);
  if(!rules.length){
    body.innerHTML='<tr><td colspan="7" class="negative">I could not interpret a supported condition. Try RSI, MACD, moving averages, relative volume, price moves, or 52-week high/low distance.</td></tr>';
    document.querySelector('#matchesMetric').textContent='—';
    document.querySelector('#median5Metric').textContent='—';
    document.querySelector('#winMetric').textContent='—';
    document.querySelector('#sampleMetric').textContent='—';
    return;
  }
  const matched=scannerData.latest.filter(row=>passesLatest(row,rules)).map(row=>buildDisplayRow(row,rules));
  matched.sort((a,b)=>Number(b.relvol)-Number(a.relvol));
  renderRows(matched);
  setMetrics(rules,matched);
  if(matched.length) showEvidence(matched[0]);
}

async function loadScannerData(){
  document.querySelector('#resultTimestamp').textContent='Loading Yahoo EOD feature history…';
  try{
    const response=await fetch(`data/scan_data.json?v=${Date.now()}`,{cache:'no-store'});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    scannerData=await response.json();
    if(!scannerData.latest||!scannerData.history) throw new Error('Easy Mode dataset is still being generated');
    if(scannerData.default_query) document.querySelector('#scanQuery').value=scannerData.default_query;
    runEasyMode();
  }catch(err){
    scannerData=null;
    body.innerHTML='<tr><td colspan="7" class="negative">The Easy Mode historical dataset is not available yet. The GitHub refresh may still be running.</td></tr>';
    document.querySelector('#resultTimestamp').textContent=`Data load: ${err.message}`;
    ['matchesMetric','median5Metric','winMetric','sampleMetric'].forEach(id=>document.querySelector(`#${id}`).textContent='—');
  }
}

const navItems=document.querySelectorAll('.nav-item');
navItems.forEach(btn=>btn.addEventListener('click',()=>{
  navItems.forEach(x=>x.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));
  document.querySelector(`#${btn.dataset.view}`).classList.add('active-view');
}));

document.querySelector('#scanButton').addEventListener('click',()=>{
  const button=document.querySelector('#scanButton');
  button.disabled=true;
  button.textContent='SCANNING…';
  setTimeout(()=>{runEasyMode();button.disabled=false;button.textContent='SCAN MARKET';},50);
});

document.querySelector('#scanQuery').addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter') runEasyMode();
});

loadScannerData();
