const demoRows=[
 {ticker:'NVDA',price:'$128.44',rsi:42,rv:'1.8x',trend:'Above 200 DMA',d5:'+3.4%',evidence:[0.9,3.4,5.8,8.1],rules:['RSI below 45','MACD slope positive','Price above 200-day MA','Relative volume above 1.5x']},
 {ticker:'AMD',price:'$164.11',rsi:44,rv:'1.7x',trend:'Above 200 DMA',d5:'+2.6%',evidence:[0.5,2.6,4.1,6.7],rules:['RSI below 45','MACD rising for 3 sessions','Price above 200-day MA','Relative volume above 1.5x']},
 {ticker:'AVGO',price:'$315.80',rsi:41,rv:'1.9x',trend:'Above 200 DMA',d5:'+3.1%',evidence:[0.8,3.1,4.9,7.2],rules:['RSI below 45','MACD histogram improving','Price above 200-day MA','Relative volume above 1.5x']},
 {ticker:'PLTR',price:'$187.22',rsi:39,rv:'2.2x',trend:'Above 200 DMA',d5:'+4.0%',evidence:[1.1,4.0,6.3,9.4],rules:['RSI below 45','MACD rising','Price above 200-day MA','Relative volume above 2.0x']},
 {ticker:'META',price:'$778.35',rsi:43,rv:'1.6x',trend:'Above 200 DMA',d5:'+2.3%',evidence:[0.4,2.3,3.7,5.5],rules:['RSI below 45','MACD rising','Price above 200-day MA','Relative volume above 1.5x']},
 {ticker:'QQQ',price:'$601.17',rsi:44,rv:'1.6x',trend:'Above 200 DMA',d5:'+1.9%',evidence:[0.3,1.9,3.0,4.8],rules:['RSI below 45','MACD rising','Price above 200-day MA','Relative volume above 1.5x']}
];

const body=document.querySelector('#resultsBody');
const evidenceTitle=document.querySelector('#evidenceTitle');
const evidenceList=document.querySelector('#evidenceList');
const distribution=document.querySelector('#distribution');
const evIds=['ev1','ev5','ev10','ev20'];

function renderRows(rows){
 body.innerHTML=rows.map((r,i)=>`<tr data-index="${i}"><td class="ticker">${r.ticker}</td><td>${r.price}</td><td>${r.rsi}</td><td>${r.rv}</td><td>${r.trend}</td><td class="positive">${r.d5}</td><td><button class="evidence-button" data-index="${i}">View</button></td></tr>`).join('');
 document.querySelectorAll('tbody tr,.evidence-button').forEach(el=>el.addEventListener('click',e=>{
   e.stopPropagation();
   showEvidence(rows[Number(el.dataset.index)]);
 }));
}

function showEvidence(row){
 evidenceTitle.textContent=`Evidence for ${row.ticker}`;
 row.evidence.forEach((v,i)=>document.querySelector(`#${evIds[i]}`).textContent=`+${v.toFixed(1)}%`);
 evidenceList.innerHTML=row.rules.map(rule=>`<li><span>${rule}</span><b>Pass</b></li>`).join('');
 distribution.innerHTML='';
 const bars=[22,31,27,40,51,45,63,58,72,68,82,76,91,84,78,88,70,61,56,49,44,38,32,27];
 bars.forEach(h=>{const b=document.createElement('span');b.style.height=`${h}%`;distribution.appendChild(b)});
}

renderRows(demoRows);
showEvidence(demoRows[0]);

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
 document.querySelector('#matchesMetric').textContent='…';
 setTimeout(()=>{
   renderRows(demoRows);
   document.querySelector('#matchesMetric').textContent='18';
   document.querySelector('#median5Metric').textContent='+2.8%';
   document.querySelector('#winMetric').textContent='64%';
   document.querySelector('#sampleMetric').textContent='426';
   document.querySelector('#resultTimestamp').textContent=`Preview scan • ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
   button.disabled=false;
   button.textContent='SCAN MARKET';
 },700);
});
