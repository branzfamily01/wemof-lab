(() => {
  'use strict';
  const C = window.WemofCore;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  let bars = [], events = [], result = null, selectedId = null;

  const inputIds = ['bbPeriod','sigma','purityLookback','purityThreshold','scoreThreshold','targetPips','stopPips','maxBars','eventWindowMinutes','breakoutLookback','roundStep','roundDistance','costPips'];
  function settings() {
    const s = {...C.DEFAULTS};
    inputIds.forEach(id => { const el=$('#'+id); if (el) s[id]=Number(el.value); });
    return s;
  }
  function saveSettings(){ localStorage.setItem('wemof-lab-settings-v1',JSON.stringify(settings())); }
  function loadSettings(){
    let s={...C.DEFAULTS};
    try { Object.assign(s,JSON.parse(localStorage.getItem('wemof-lab-settings-v1')||'{}')); } catch(e){}
    inputIds.forEach(id=>{const el=$('#'+id); if(el && s[id]!=null) el.value=s[id];});
  }
  function fmt(n,d=1){return Number.isFinite(n)?Number(n).toFixed(d):'—';}
  function pct(n){return Number.isFinite(n)?fmt(n,1)+'%':'—';}
  function timeText(t){return new Intl.DateTimeFormat('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));}
  function statusLabel(s){return ({win:'TP先行',loss:'SL先行',ambiguous:'同一足両到達',timeout:'時間切れ'})[s]||s;}
  function scoreClass(n){return n>=80?'good':n>=65?'mid':'bad';}

  function setMessage(text,type='info'){
    const box=$('#message'); box.textContent=text; box.dataset.type=type; box.hidden=!text;
  }

  async function readFile(file){return await file.text();}

  $('#ohlcFile').addEventListener('change',async e=>{
    const f=e.target.files[0]; if(!f)return;
    try { bars=C.parseOHLC(await readFile(f)); setMessage(`OHLCを ${bars.length.toLocaleString()} 本読み込みました。`, 'ok'); $('#dataState').textContent=`${bars.length.toLocaleString()} bars`; }
    catch(err){setMessage(err.message,'error');}
  });
  $('#eventFile').addEventListener('change',async e=>{
    const f=e.target.files[0]; if(!f)return;
    try { events=C.parseEvents(await readFile(f)); setMessage(`イベントを ${events.length.toLocaleString()} 件読み込みました。`, 'ok'); $('#eventState').textContent=`${events.length.toLocaleString()} events`; }
    catch(err){setMessage(err.message,'error');}
  });

  $('#sampleBtn').addEventListener('click',()=>{
    const s=C.generateSample(); bars=s.bars; events=s.events;
    $('#dataState').textContent=`${bars.length.toLocaleString()} sample bars`;
    $('#eventState').textContent=`${events.length} sample events`;
    setMessage('サンプル相場を読み込みました。すぐ「解析する」を押せます。','ok');
  });

  $('#analyzeBtn').addEventListener('click',()=>{
    if (!bars.length) { setMessage('先にOHLC CSVを読み込むか、「サンプルで試す」を押してください。','error'); return; }
    try {
      saveSettings();
      const t0=performance.now(); result=C.analyze(bars,events,settings());
      const ms=performance.now()-t0;
      render();
      setMessage(`${bars.length.toLocaleString()}本を解析。候補 ${result.candidates.length}件、Wemof-like適格 ${result.metrics.qualified}件（${ms.toFixed(0)}ms）。`,'ok');
    } catch(err){console.error(err);setMessage('解析中にエラー: '+err.message,'error');}
  });

  $('#exportBtn').addEventListener('click',()=>{
    if(!result){setMessage('先に解析してください。','error');return;}
    const csv=C.exportResultsCSV(result.candidates);
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='wemof-lab-results.csv';a.click();URL.revokeObjectURL(a.href);
  });

  $$('.preset').forEach(btn=>btn.addEventListener('click',()=>{
    $('#targetPips').value=btn.dataset.tp; $('#stopPips').value=btn.dataset.sl; saveSettings();
  }));

  function render(){
    const q=result.metrics.wemofLike;
    $('#candidateCount').textContent=result.candidates.length;
    $('#qualifiedCount').textContent=q.count;
    $('#winRate').textContent=pct(q.winRate);
    $('#avgMae').textContent=fmt(q.avgMae,1)+' pips';
    $('#expectancy').textContent=fmt(q.expectancy,2)+' pips';
    $('#maxMae').textContent=fmt(q.maxMae,1)+' pips';
    renderModels(); renderRisk(); renderTable();
    const first=result.candidates.find(r=>r.eligible)||result.candidates[0];
    if(first) selectEvent(first.id); else clearDetail();
    $('#resultsSection').hidden=false;
  }

  function renderModels(){
    const labels={simple:'単純 ±σ',purity:'＋ 純度',wemofLike:'＋ 理由除外'};
    $('#modelBody').innerHTML=['simple','purity','wemofLike'].map(k=>{
      const m=result.metrics[k];
      return `<tr><th>${labels[k]}</th><td>${m.count}</td><td>${pct(m.winRate)}</td><td>${fmt(m.avgMae,1)}</td><td>${fmt(m.expectancy,2)}</td></tr>`;
    }).join('');
  }
  function renderRisk(){
    $('#riskBody').innerHTML=C.riskScenarios(result,[20,50,100]).map(m=>`<tr><th>${m.stopPips} pips</th><td>${m.count}</td><td>${pct(m.winRate)}</td><td>${fmt(m.avgMae,1)}</td><td>${fmt(m.maxMae,1)}</td><td>${fmt(m.expectancy,2)}</td></tr>`).join('');
  }
  function renderTable(){
    const rows=[...result.candidates].sort((a,b)=>b.score-a.score);
    $('#eventBody').innerHTML=rows.map(r=>`<tr data-id="${r.id}" class="${r.eligible?'eligible':''}">
      <td>${timeText(r.time)}</td><td>${r.side==='short'?'売り':'買い'}</td><td><span class="score ${scoreClass(r.score)}">${fmt(r.score,0)}</span></td>
      <td>${fmt(r.purity,0)}</td><td>${r.reasonFlags.length?r.reasonFlags.join('・'):'なし'}</td><td>${r.eligible?'適格':'除外'}</td><td>${statusLabel(r.status)}</td><td>${fmt(r.maePips,1)}</td><td>${fmt(r.mfePips,1)}</td>
    </tr>`).join('');
    $$('#eventBody tr').forEach(tr=>tr.addEventListener('click',()=>selectEvent(Number(tr.dataset.id))));
  }
  function selectEvent(id){
    const r=result.candidates.find(x=>x.id===id); if(!r)return; selectedId=id;
    $$('#eventBody tr').forEach(tr=>tr.classList.toggle('selected',Number(tr.dataset.id)===id));
    $('#detailTitle').textContent=`${timeText(r.time)} / ${r.side==='short'?'逆張り売り候補':'逆張り買い候補'}`;
    $('#detailScore').textContent=fmt(r.score,0); $('#detailScore').className='big-score '+scoreClass(r.score);
    $('#detailText').innerHTML=`<strong>${r.eligible?'Wemof-like 適格':'除外候補'}</strong><br>${r.reasonFlags.length?'除外理由: '+r.reasonFlags.join('・'):'公開情報からモデル化した主要な「理由あり」フラグは検出されませんでした。'}<br>結果: ${statusLabel(r.status)} / MAE ${fmt(r.maePips,1)} pips / MFE ${fmt(r.mfePips,1)} pips`;
    $('#scoreBreakdown').innerHTML=`
      <div><span>異常度</span><b>${fmt(r.anomaly,0)}</b><i style="--v:${r.anomaly}%"></i></div>
      <div><span>純度</span><b>${fmt(r.purity,0)}</b><i style="--v:${r.purity}%"></i></div>
      <div><span>理由なし度</span><b>${fmt(r.unexplained,0)}</b><i style="--v:${r.unexplained}%"></i></div>`;
    drawChart(r);
  }
  function clearDetail(){ $('#detailTitle').textContent='候補がありません'; $('#detailText').textContent='設定を調整してください。'; const c=$('#chart');c.getContext('2d').clearRect(0,0,c.width,c.height); }

  function drawChart(r){
    const canvas=$('#chart'), dpr=window.devicePixelRatio||1, rect=canvas.getBoundingClientRect();
    canvas.width=Math.max(640,rect.width*dpr); canvas.height=360*dpr;
    const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); const W=canvas.width/dpr,H=canvas.height/dpr;
    ctx.clearRect(0,0,W,H);
    const start=Math.max(0,r.index-35), end=Math.min(result.bars.length-1,r.index+35), rows=result.bars.slice(start,end+1);
    const vals=[]; rows.forEach(b=>vals.push(b.high,b.low,b.upper,b.lower));
    const min=Math.min(...vals.filter(Number.isFinite)), max=Math.max(...vals.filter(Number.isFinite)), pad=(max-min)*0.08||0.1;
    const y=p=>30+(max+pad-p)/(max-min+2*pad)*(H-60);
    const x=i=>44+i*(W-64)/rows.length;
    ctx.font='11px system-ui'; ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--muted');
    ctx.strokeStyle='rgba(148,163,184,.16)'; ctx.lineWidth=1;
    for(let g=0;g<5;g++){const yy=30+g*(H-60)/4;ctx.beginPath();ctx.moveTo(38,yy);ctx.lineTo(W-12,yy);ctx.stroke();const p=max+pad-g*(max-min+2*pad)/4;ctx.fillText(p.toFixed(3),2,yy+3);}
    const drawLine=(key,alpha)=>{ctx.strokeStyle=`rgba(96,165,250,${alpha})`;ctx.lineWidth=1.2;ctx.beginPath();let begun=false;rows.forEach((b,i)=>{if(!Number.isFinite(b[key]))return;const xx=x(i),yy=y(b[key]);if(!begun){ctx.moveTo(xx,yy);begun=true;}else ctx.lineTo(xx,yy);});ctx.stroke();};
    drawLine('upper',.65); drawLine('lower',.65); drawLine('sma',.32);
    rows.forEach((b,i)=>{
      const xx=x(i), up=b.close>=b.open; ctx.strokeStyle=up?'#34d399':'#fb7185';ctx.fillStyle=up?'#34d399':'#fb7185';
      ctx.beginPath();ctx.moveTo(xx,y(b.high));ctx.lineTo(xx,y(b.low));ctx.stroke();
      const top=y(Math.max(b.open,b.close)),bot=y(Math.min(b.open,b.close));ctx.fillRect(xx-2.3,top,4.6,Math.max(1,bot-top));
    });
    const local=r.index-start, ex=x(local); ctx.strokeStyle='#fbbf24';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(ex,20);ctx.lineTo(ex,H-20);ctx.stroke();
    ctx.fillStyle='#fbbf24';ctx.fillText('ENTRY',Math.min(W-52,ex+4),24);
    const tp=r.side==='long'?r.entry+result.settings.targetPips*result.settings.pipSize:r.entry-result.settings.targetPips*result.settings.pipSize;
    const sl=r.side==='long'?r.entry-result.settings.stopPips*result.settings.pipSize:r.entry+result.settings.stopPips*result.settings.pipSize;
    ctx.setLineDash([5,4]);ctx.strokeStyle='rgba(52,211,153,.8)';ctx.beginPath();ctx.moveTo(38,y(tp));ctx.lineTo(W-12,y(tp));ctx.stroke();ctx.strokeStyle='rgba(251,113,133,.55)';ctx.beginPath();ctx.moveTo(38,y(sl));ctx.lineTo(W-12,y(sl));ctx.stroke();ctx.setLineDash([]);
  }

  window.addEventListener('resize',()=>{if(result&&selectedId)selectEvent(selectedId);});
  loadSettings();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
})();
