const body=document.querySelector('#resultsBody');
const evidenceTitle=document.querySelector('#evidenceTitle');
const evidenceList=document.querySelector('#evidenceList');
const distribution=document.querySelector('#distribution');
const evIds=['ev1','ev5','ev10','ev20'];
let scannerData=null;

function fmtEvidence(v){
  if(v===null || v===undefined || Number.isNaN(Number(v))) return 'n/a';
  const n=Number(v);
  return `${n>=0?'+':''}${n.toFixed(2)}%`;
}

function renderRows(rows){
  if(!rows.length){
    body.innerHTML='<tr><td colspan="7" class="muted">No symbols currently match all four rules.</td></tr>';
    evidenceTitle.textContent='No current match selected';
    evidenceList.innerHTML='<li><span>The live scan completed successfully.</span><b>0 matches</b></li>';
    distribution.innerHTML='';
    evIds.forEach(id=>document.querySelector(`#${id}`).textContent='n/a');
    return;
  }
  body.innerHTML=rows.map((r,i)=>`<tr data-index="${i}"><td class="ticker">${r.ticker}</td><td>${r.price}</td><td>${r.rsi}</td><td>${r.rv}</td><td>${r.trend}</td><td class="${String(r.d5||'').startsWith('-')?'negative':'positive'}">${r.d5??'n/a'}</td><td><button class="evidence-button" data-index="${i}">View</button></td></tr>`).join('');
  document.querySelectorAll('tbody tr,.evidence-button').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const row=rows[Number(el.dataset.index)];
    if(row) showEvidence(row);
  }));
}

function showEvidence(row){
  evidenceTitle.textContent=`Evidence for ${row.ticker}`;
  row.evidence.forEach((v,i)=>document.querySelector(`#${evIds[i]}`).textContent=fmtEvidence(v));
  evidenceList.innerHTML=row.rules.map(rule=>`<li><span>${rule}</span><b>Pass</b></li>`).join('');
  distribution.innerHTML='';
  const medians=row.evidence.map(v=>v===null?0:Number(v));
  const max=Math.max(1,...medians.map(v=>Math.abs(v)));
  const bars=[];
  for(let i=0;i<24;i++){
    const wave=Math.sin(i/3.2)*0.18+0.78;
    const anchor=Math.abs(medians[i%medians.length]||0)/max;
    bars.push(Math.max(18,Math.min(96,(wave*62)+(anchor*28))));
  }
  bars.forEach(h=>{const b=document.createElement('span');b.style.height=`${h}%`;distribution.appendChild(b)});
}

function setMetrics(data){
  const m=data.metrics||{};
  document.querySelector('#matchesMetric').textContent=m.matches??0;
  document.querySelector('#median5Metric').textContent=m.median_5d===null||m.median_5d===undefined?'n/a':fmtEvidence(m.median_5d);
  document.querySelector('#winMetric').textContent=m.win_rate_10d===null||m.win_rate_10d===undefined?'n/a':`${Number(m.win_rate_10d).toFixed(1)}%`;
  document.querySelector('#sampleMetric').textContent=(m.sample_size??0).toLocaleString();
  const when=data.generated_at?new Date(data.generated_at):null;
  const whenText=when&&!Number.isNaN(when.getTime())?when.toLocaleString():'unknown time';
  document.querySelector('#resultTimestamp').textContent=`Yahoo EOD • refreshed ${whenText}`;
}

async function loadScannerData(){
  document.querySelector('#resultTimestamp').textContent='Loading Yahoo EOD data…';
  try{
    const response=await fetch(`data/scan_data.json?v=${Date.now()}`,{cache:'no-store'});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    scannerData=await response.json();
    renderRows(scannerData.matches||[]);
    setMetrics(scannerData);
    if(scannerData.matches?.length) showEvidence(scannerData.matches[0]);
  }catch(err){
    scannerData=null;
    body.innerHTML='<tr><td colspan="7" class="negative">Live dataset is not available yet. The GitHub data refresh may still be running.</td></tr>';
    document.querySelector('#resultTimestamp').textContent=`Data load error: ${err.message}`;
    document.querySelector('#matchesMetric').textContent='—';
    document.querySelector('#median5Metric').textContent='—';
    document.querySelector('#winMetric').textContent='—';
    document.querySelector('#sampleMetric').textContent='—';
  }
}

const navItems=document.querySelectorAll('.nav-item');
navItems.forEach(btn=>btn.addEventListener('click',()=>{
  navItems.forEach(x=>x.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));
  document.querySelector(`#${btn.dataset.view}`).classList.add('active-view');
}));

document.querySelector('#scanButton').addEventListener('click',async()=>{
  const button=document.querySelector('#scanButton');
  button.disabled=true;
  button.textContent='REFRESHING…';
  await loadScannerData();
  button.disabled=false;
  button.textContent='SCAN MARKET';
});

loadScannerData();
