/* Multi-timeframe dataset switching for Scanner Evidence Lab. */
(function(){
  const paths={Daily:'data/market/latest.json',Weekly:'data/market/weekly/latest.json',Monthly:'data/market/monthly/latest.json'};
  const cache=new Map();
  let currentName='Daily';
  const coreParse=parseRules;
  const coreDescribe=describeRule;
  const coreBuild=buildDisplayRow;
  const coreRun=runEasyMode;

  function tf(){return document.querySelector('#timeframe')?.value||'Daily';}
  function unit(){return tf()==='Weekly'?'Week':tf()==='Monthly'?'Month':'Day';}
  function updateLabels(){
    const u=unit();
    document.querySelectorAll('.after-grid span').forEach((el,i)=>el.textContent=`+${[1,5,10,20][i]} ${u}${[1,5,10,20][i]===1?'':'s'}`);
    const h=document.querySelector('thead th:nth-child(6)'); if(h) h.textContent=`+5${u[0]} Hist.`;
    const m5=document.querySelector('#median5Metric')?.closest('.metric-card')?.querySelector('span'); if(m5) m5.textContent=`Median ticker +5${u[0]}`;
  }

  parseRules=function(text){
    let rules=coreParse(text); const q=String(text||'').toLowerCase(); const u=tf();
    const add=(field,op,value,label)=>{const old=rules.find(r=>r.field===field&&r.op===op);if(old){old.value=value;old.label=label;}else rules.push({field,op,value,label});};
    let m;
    if(u==='Weekly'){
      if(/(?:this|over the last)\s*week\b/.test(q)) rules=rules.filter(r=>r.field!=='chg5');
      if((m=q.match(/(?:up|gained|rose)\s*(\d+(?:\.\d+)?)\s*%\s*(?:this|over the last)\s*week\b/))) add('chg1','>',Number(m[1]),`1-week move > ${m[1]}%`);
      if((m=q.match(/(?:down|fell|dropped)\s*(\d+(?:\.\d+)?)\s*%\s*(?:this|over the last)\s*week\b/))) add('chg1','<',-Number(m[1]),`1-week move < -${m[1]}%`);
      if((m=q.match(/(?:up|gained|rose)\s*(\d+(?:\.\d+)?)\s*%\s*(?:over|in)\s*(?:the\s*)?(?:last\s*)?5\s*weeks/))) add('chg5','>',Number(m[1]),`5-week move > ${m[1]}%`);
      if((m=q.match(/(?:down|fell|dropped)\s*(\d+(?:\.\d+)?)\s*%\s*(?:over|in)\s*(?:the\s*)?(?:last\s*)?5\s*weeks/))) add('chg5','<',-Number(m[1]),`5-week move < -${m[1]}%`);
      if((m=q.match(/(?:above|over)\s*(20|50|200)\s*(?:week|weekly)\s*(?:ma|moving average)/))) add(`sma${m[1]}`,'>',null,`Price > ${m[1]}-week MA`);
      if((m=q.match(/(?:below|under)\s*(20|50|200)\s*(?:week|weekly)\s*(?:ma|moving average)/))) add(`sma${m[1]}`,'<',null,`Price < ${m[1]}-week MA`);
      rules.forEach(r=>{if(r.field==='chg1')r.label=r.label.replace(/1D|1-day/gi,'1-week');if(r.field==='chg5')r.label=r.label.replace(/5D|5-day/gi,'5-week');});
    }
    if(u==='Monthly'){
      if((m=q.match(/(?:up|gained|rose)\s*(\d+(?:\.\d+)?)\s*%\s*(?:this|over the last)\s*month\b/))) add('chg1','>',Number(m[1]),`1-month move > ${m[1]}%`);
      if((m=q.match(/(?:down|fell|dropped)\s*(\d+(?:\.\d+)?)\s*%\s*(?:this|over the last)\s*month\b/))) add('chg1','<',-Number(m[1]),`1-month move < -${m[1]}%`);
      if((m=q.match(/(?:up|gained|rose)\s*(\d+(?:\.\d+)?)\s*%\s*(?:over|in)\s*(?:the\s*)?(?:last\s*)?5\s*months/))) add('chg5','>',Number(m[1]),`5-month move > ${m[1]}%`);
      if((m=q.match(/(?:down|fell|dropped)\s*(\d+(?:\.\d+)?)\s*%\s*(?:over|in)\s*(?:the\s*)?(?:last\s*)?5\s*months/))) add('chg5','<',-Number(m[1]),`5-month move < -${m[1]}%`);
      if((m=q.match(/(?:above|over)\s*(20|50|200)\s*(?:month|monthly)\s*(?:ma|moving average)/))) add(`sma${m[1]}`,'>',null,`Price > ${m[1]}-month MA`);
      if((m=q.match(/(?:below|under)\s*(20|50|200)\s*(?:month|monthly)\s*(?:ma|moving average)/))) add(`sma${m[1]}`,'<',null,`Price < ${m[1]}-month MA`);
      rules.forEach(r=>{if(r.field==='chg1')r.label=r.label.replace(/1D|1-day/gi,'1-month');if(r.field==='chg5')r.label=r.label.replace(/5D|5-day/gi,'5-month');});
    }
    return rules;
  };

  describeRule=function(row,rule){
    let s=coreDescribe(row,rule); const u=unit();
    if(u==='Week') s=s.replace(/1-day/gi,'1-week').replace(/5-day/gi,'5-week').replace(/(20|50|200) DMA/g,'$1-week MA');
    if(u==='Month') s=s.replace(/1-day/gi,'1-month').replace(/5-day/gi,'5-month').replace(/(20|50|200) DMA/g,'$1-month MA');
    return s;
  };

  buildDisplayRow=function(row,rules){
    const out=coreBuild(row,rules); const u=unit();
    if(u==='Week') out.trend=out.trend.replace('200 DMA','200-week MA');
    if(u==='Month') out.trend=out.trend.replace('200 DMA','200-month MA');
    return out;
  };

  loadShard=async function(id){
    if(legacyMode) return new Map();
    const frame=(scannerData?.timeframe||'Daily').toLowerCase();
    const base=scannerData?.history_base||(frame==='daily'?'data/market/history':`data/market/${frame}/history`);
    const key=`${frame}:${scannerData?.history_version||'1'}:${id}`;
    if(shardCache.has(key)) return shardCache.get(key);
    const p=(async()=>{const r=await fetch(`${base}/history_${String(id).padStart(3,'0')}.ndjson?v=${encodeURIComponent(scannerData?.history_version||'1')}`,{cache:'force-cache'});const map=new Map();if(r.status===404)return map;if(!r.ok)throw new Error(`History shard ${id}: HTTP ${r.status}`);for(const line of (await r.text()).split('\n')){if(!line.trim())continue;try{const [t,rows]=JSON.parse(line);map.set(t,rows);}catch(_){}}return map;})();
    shardCache.set(key,p); return p;
  };

  runEasyMode=function(){coreRun();updateLabels();};

  async function switchTo(name){
    const status=document.querySelector('#resultTimestamp'); if(status) status.textContent=`Loading ${name} Yahoo dataset…`;
    try{
      if(scannerData?.latest) cache.set(currentName,scannerData);
      let data=cache.get(name);
      if(!data){const r=await fetch(paths[name],{cache:'no-store'});if(!r.ok)throw new Error(`${name} dataset not ready`);data=await r.json();cache.set(name,data);}
      scannerData=data; legacyMode=false; currentName=name; scanToken++; updateLabels(); runEasyMode();
    }catch(err){if(status)status.textContent=err.message;}
  }
  window.SEL_SET_TIMEFRAME=async function(name){const s=document.querySelector('#timeframe');if(!s)return; s.value=name; await switchTo(name);};

  const sel=document.querySelector('#timeframe');
  sel?.addEventListener('change',()=>switchTo(sel.value));
  ['Weekly','Monthly'].forEach(async name=>{try{const r=await fetch(paths[name],{method:'HEAD',cache:'no-store'});const o=[...sel.options].find(x=>x.value===name);if(r.ok&&o){o.disabled=false;o.textContent=name;}}catch(_){}});

  const status=document.querySelector('#resultTimestamp');
  if(status)new MutationObserver(()=>{const name=tf();if(name!=='Daily'&&status.textContent.includes(`${name} unavailable: Daily EOD only`))status.textContent=status.textContent.replace(` • ${name} unavailable: Daily EOD only`,` • ${name} bars`);}).observe(status,{childList:true,characterData:true,subtree:true});
  updateLabels();
})();
