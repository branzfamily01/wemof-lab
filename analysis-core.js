(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WemofCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = {
    bbPeriod: 20,
    sigma: 3,
    atrPeriod: 14,
    purityLookback: 5,
    purityThreshold: 70,
    scoreThreshold: 65,
    targetPips: 3,
    stopPips: 50,
    maxBars: 240,
    eventWindowMinutes: 15,
    breakoutLookback: 20,
    roundStep: 0.5,
    roundDistance: 0.03,
    costPips: 0.2,
    pipSize: 0.01,
  };

  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (v == null) return NaN;
    const s = String(v).trim().replace(/,/g, '');
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function parseTime(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
    let s = String(v).trim();
    if (!s) return NaN;
    if (/^\d{10,13}$/.test(s)) {
      const n = Number(s);
      return s.length === 13 ? n : n * 1000;
    }
    s = s.replace(/\./g, '-').replace(/\//g, '-');
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(' ', 'T');
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  }

  function splitCSVLine(line) {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        out.push(cur); cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map(x => x.trim());
  }

  function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/[\s_\-]/g, '');
  }

  function parseOHLC(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim());
    if (lines.length < 2) throw new Error('OHLC CSVにデータ行がありません。');
    const headers = splitCSVLine(lines[0]);
    const map = {};
    headers.forEach((h, i) => map[normalizeHeader(h)] = i);
    const find = (cands) => {
      for (const c of cands) if (map[c] != null) return map[c];
      return -1;
    };
    const ti = find(['timestamp','datetime','date','time','日時','時刻']);
    const oi = find(['open','始値']);
    const hi = find(['high','高値']);
    const li = find(['low','安値']);
    const ci = find(['close','終値','price']);
    if ([ti, oi, hi, li, ci].some(i => i < 0)) throw new Error('CSVには timestamp/date, open, high, low, close が必要です。');
    const bars = [];
    for (let r = 1; r < lines.length; r++) {
      const cols = splitCSVLine(lines[r]);
      const time = parseTime(cols[ti]);
      const open = num(cols[oi]), high = num(cols[hi]), low = num(cols[li]), close = num(cols[ci]);
      if (![time, open, high, low, close].every(Number.isFinite)) continue;
      if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;
      bars.push({ time, open, high, low, close });
    }
    bars.sort((a,b)=>a.time-b.time);
    const dedup = [];
    for (const b of bars) {
      if (dedup.length && dedup[dedup.length-1].time === b.time) dedup[dedup.length-1] = b;
      else dedup.push(b);
    }
    if (dedup.length < 30) throw new Error('有効なOHLCデータが30本未満です。');
    return dedup;
  }

  function parseEvents(text) {
    if (!String(text || '').trim()) return [];
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim());
    if (lines.length < 2) return [];
    const headers = splitCSVLine(lines[0]);
    const map = {};
    headers.forEach((h,i)=>map[normalizeHeader(h)] = i);
    const find = cands => { for (const c of cands) if (map[c] != null) return map[c]; return -1; };
    const ti = find(['timestamp','datetime','date','time','日時','時刻']);
    const titlei = find(['title','event','name','headline','指標','内容']);
    const impi = find(['importance','impact','level','重要度']);
    if (ti < 0) throw new Error('イベントCSVには timestamp/date 列が必要です。');
    const events = [];
    for (let r=1;r<lines.length;r++) {
      const cols = splitCSVLine(lines[r]);
      const time = parseTime(cols[ti]);
      if (!Number.isFinite(time)) continue;
      events.push({ time, title: titlei >= 0 ? (cols[titlei] || 'イベント') : 'イベント', importance: impi >= 0 ? (cols[impi] || '') : '' });
    }
    return events.sort((a,b)=>a.time-b.time);
  }

  function mean(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : NaN; }
  function std(arr) {
    if (!arr.length) return NaN;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s,x)=>s+(x-m)*(x-m),0)/arr.length);
  }
  function median(arr) {
    if (!arr.length) return NaN;
    const a = [...arr].sort((x,y)=>x-y), m = Math.floor(a.length/2);
    return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
  }
  function clamp(x,a,b){return Math.min(b,Math.max(a,x));}

  function indicators(bars, settings={}) {
    const s = {...DEFAULTS, ...settings};
    const out = bars.map(b=>({...b, sma:NaN, sd:NaN, upper:NaN, lower:NaN, z:NaN, percentB:NaN, atr:NaN}));
    const tr = [];
    for (let i=0;i<bars.length;i++) {
      const b=bars[i], prev=i?bars[i-1]:b;
      tr.push(Math.max(b.high-b.low, Math.abs(b.high-prev.close), Math.abs(b.low-prev.close)));
      if (i >= s.bbPeriod-1) {
        const closes = bars.slice(i-s.bbPeriod+1,i+1).map(x=>x.close);
        const m=mean(closes), sdv=std(closes);
        out[i].sma=m; out[i].sd=sdv; out[i].upper=m+s.sigma*sdv; out[i].lower=m-s.sigma*sdv;
        out[i].z=sdv ? (b.close-m)/sdv : 0;
        const width=2*s.sigma*sdv;
        out[i].percentB=width ? (b.close-out[i].lower)/width : 0.5;
      }
      if (i >= s.atrPeriod-1) out[i].atr=mean(tr.slice(i-s.atrPeriod+1,i+1));
    }
    return out;
  }

  function purityScore(bars, idx, direction, lookback=5) {
    const start=Math.max(0,idx-lookback+1), slice=bars.slice(start,idx+1);
    if (slice.length < 2) return {score:0,directionRate:0,bodyRatio:0,pathEfficiency:0,retraceClean:0};
    let dirCount=0, bodySum=0, rangeSum=0, oppositeBody=0, path=0;
    for (let j=0;j<slice.length;j++) {
      const b=slice[j], body=b.close-b.open, range=Math.max(1e-12,b.high-b.low);
      if (body*direction > 0) dirCount++;
      bodySum += Math.abs(body); rangeSum += range;
      if (body*direction < 0) oppositeBody += Math.abs(body);
      if (j>0) path += Math.abs(slice[j].close-slice[j-1].close);
    }
    const net=(slice[slice.length-1].close-slice[0].open)*direction;
    const directionRate=dirCount/slice.length;
    const bodyRatio=clamp(bodySum/rangeSum,0,1);
    const pathEfficiency=path>0?clamp(Math.max(0,net)/path,0,1):0;
    const retraceClean=bodySum>0?clamp(1-oppositeBody/bodySum,0,1):0;
    const score=100*(0.35*directionRate+0.25*bodyRatio+0.25*pathEfficiency+0.15*retraceClean);
    return {score, directionRate, bodyRatio, pathEfficiency, retraceClean};
  }

  function nearestEvent(events, time, windowMinutes) {
    const w=windowMinutes*60000;
    let best=null, bestD=Infinity;
    for (const e of events) {
      const d=Math.abs(e.time-time);
      if (d<=w && d<bestD) {best=e;bestD=d;}
      if (e.time > time+w) break;
    }
    return best;
  }

  function isBreakout(bars, idx, direction, lookback) {
    const start=Math.max(0,idx-lookback), prior=bars.slice(start,idx);
    if (!prior.length) return false;
    if (direction>0) return bars[idx].high > Math.max(...prior.map(b=>b.high));
    return bars[idx].low < Math.min(...prior.map(b=>b.low));
  }

  function roundFlag(price, step, distance) {
    if (!(step>0) || !(distance>=0)) return false;
    const nearest=Math.round(price/step)*step;
    return Math.abs(price-nearest)<=distance;
  }

  function simulate(bars, idx, side, settings={}) {
    const s={...DEFAULTS,...settings}, entry=bars[idx].close, pip=s.pipSize;
    let mae=0,mfe=0, status='timeout', exitIndex=Math.min(bars.length-1,idx+s.maxBars), barsHeld=exitIndex-idx;
    for (let j=idx+1;j<=Math.min(bars.length-1,idx+s.maxBars);j++) {
      const b=bars[j];
      const fav=side==='long'?(b.high-entry)/pip:(entry-b.low)/pip;
      const adv=side==='long'?(entry-b.low)/pip:(b.high-entry)/pip;
      mfe=Math.max(mfe,fav); mae=Math.max(mae,adv);
      const hitTP=fav>=s.targetPips, hitSL=adv>=s.stopPips;
      if (hitTP && hitSL) {status='ambiguous';exitIndex=j;barsHeld=j-idx;break;}
      if (hitTP) {status='win';exitIndex=j;barsHeld=j-idx;break;}
      if (hitSL) {status='loss';exitIndex=j;barsHeld=j-idx;break;}
    }
    let pnlPips;
    if (status==='win') pnlPips=s.targetPips-s.costPips;
    else if (status==='loss') pnlPips=-s.stopPips-s.costPips;
    else if (status==='ambiguous') pnlPips=-s.stopPips-s.costPips;
    else {
      const final=bars[exitIndex].close;
      pnlPips=(side==='long'?(final-entry):(entry-final))/pip-s.costPips;
    }
    return {entry, status, exitIndex, barsHeld, maePips:mae, mfePips:mfe, pnlPips};
  }

  function analyze(bars, events=[], settings={}) {
    const s={...DEFAULTS,...settings};
    const ibars=indicators(bars,s), candidates=[];
    const warm=Math.max(s.bbPeriod,s.atrPeriod,s.purityLookback,s.breakoutLookback)+1;
    for (let i=warm;i<ibars.length-1;i++) {
      const b=ibars[i];
      if (!Number.isFinite(b.upper)||!Number.isFinite(b.lower)||!Number.isFinite(b.atr)) continue;
      let moveDirection=0, side='';
      if (b.high>=b.upper) {moveDirection=1;side='short';}
      else if (b.low<=b.lower) {moveDirection=-1;side='long';}
      else continue;
      const p=purityScore(ibars,i,moveDirection,s.purityLookback);
      const macro=nearestEvent(events,b.time,s.eventWindowMinutes);
      const breakout=isBreakout(ibars,i,moveDirection,s.breakoutLookback);
      const round=roundFlag(b.close,s.roundStep,s.roundDistance);
      const sigmaAbs=Math.abs((b.close-b.sma)/(b.sd||1e-12));
      const sigmaComponent=clamp(55+(sigmaAbs-s.sigma)*30,0,100);
      const start=Math.max(0,i-s.purityLookback+1);
      const net=Math.abs(b.close-ibars[start].open);
      const speedATR=b.atr?net/b.atr:0;
      const speedComponent=clamp((speedATR/3)*100,0,100);
      const anomaly=0.6*sigmaComponent+0.4*speedComponent;
      let unexplained=100;
      if (macro) unexplained-=45;
      if (breakout) unexplained-=35;
      if (round) unexplained-=20;
      unexplained=clamp(unexplained,0,100);
      const score=0.35*anomaly+0.35*p.score+0.30*unexplained;
      const reasonFlags=[];
      if (macro) reasonFlags.push('イベント');
      if (breakout) reasonFlags.push('ブレイク');
      if (round) reasonFlags.push('節目');
      const eligible=p.score>=s.purityThreshold && score>=s.scoreThreshold && reasonFlags.length===0;
      const sim=simulate(ibars,i,side,s);
      candidates.push({
        id:candidates.length+1,index:i,time:b.time,side,moveDirection,close:b.close,upper:b.upper,lower:b.lower,sma:b.sma,
        z:b.z,percentB:b.percentB,atr:b.atr,purity:p.score,purityParts:p,anomaly,unexplained,score,
        macroEvent:macro,breakout,round,reasonFlags,eligible,...sim
      });
    }
    return {settings:s,bars:ibars,candidates,metrics:buildMetrics(candidates,s)};
  }

  function metricFor(rows, settings) {
    const n=rows.length;
    if (!n) return {count:0,winRate:NaN,lossRate:NaN,avgMae:NaN,avgMfe:NaN,expectancy:NaN,medianBars:NaN,maxMae:NaN};
    const resolved=rows.filter(r=>r.status!=='timeout');
    const wins=rows.filter(r=>r.status==='win').length;
    const losses=rows.filter(r=>r.status==='loss'||r.status==='ambiguous').length;
    return {
      count:n,
      winRate:n?wins/n*100:NaN,
      lossRate:n?losses/n*100:NaN,
      avgMae:mean(rows.map(r=>r.maePips)),
      avgMfe:mean(rows.map(r=>r.mfePips)),
      expectancy:mean(rows.map(r=>r.pnlPips)),
      medianBars:median(rows.filter(r=>r.status==='win').map(r=>r.barsHeld)),
      maxMae:Math.max(...rows.map(r=>r.maePips)),
      resolvedCount:resolved.length
    };
  }

  function buildMetrics(candidates, settings) {
    const simple=candidates;
    const purity=candidates.filter(r=>r.purity>=settings.purityThreshold);
    const wemofLike=candidates.filter(r=>r.eligible);
    return {
      simple:metricFor(simple,settings), purity:metricFor(purity,settings), wemofLike:metricFor(wemofLike,settings),
      qualified:wemofLike.length,
      total:candidates.length,
      overall:metricFor(wemofLike,settings)
    };
  }

  function riskScenarios(result, stops=[20,50,100]) {
    const base=result.candidates.filter(r=>r.eligible), out=[];
    for (const stop of stops) {
      const rows=base.map(r=>({...r,...simulate(result.bars,r.index,r.side,{...result.settings,stopPips:stop})}));
      out.push({stopPips:stop,...metricFor(rows,{...result.settings,stopPips:stop})});
    }
    return out;
  }

  function csvEscape(v) {
    const s=String(v==null?'':v);
    return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
  }

  function exportResultsCSV(rows) {
    const headers=['time','side','close','score','purity','anomaly','unexplained','reasonFlags','eligible','status','maePips','mfePips','barsHeld','pnlPips','z','percentB'];
    const lines=[headers.join(',')];
    for (const r of rows) {
      const vals=[new Date(r.time).toISOString(),r.side,r.close,r.score.toFixed(2),r.purity.toFixed(2),r.anomaly.toFixed(2),r.unexplained.toFixed(2),r.reasonFlags.join('|'),r.eligible,r.status,r.maePips.toFixed(2),r.mfePips.toFixed(2),r.barsHeld,r.pnlPips.toFixed(2),Number(r.z).toFixed(3),Number(r.percentB).toFixed(4)];
      lines.push(vals.map(csvEscape).join(','));
    }
    return lines.join('\n');
  }

  function generateSample(count=720) {
    const bars=[]; let price=157.20; const start=Date.UTC(2026,6,1,0,0,0);
    let seed=123456789;
    const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    const spikeStarts=new Set([120,260,430,590]);
    const macroStarts=new Set([260,590]);
    const events=[];
    for (let i=0;i<count;i++) {
      if (macroStarts.has(i)) events.push({time:start+i*300000,title:i===260?'米重要指標（サンプル）':'要人発言（サンプル）',importance:'high'});
      let drift=(rnd()-0.5)*0.035;
      for (const st of spikeStarts) {
        if (i>=st && i<st+5) drift += (st===120||st===260?1:-1)*0.115;
        if (i>=st+5 && i<st+9) drift += (st===120||st===260?-1:1)*0.045;
      }
      const open=price;
      const close=open+drift;
      const wick=0.006+rnd()*0.018;
      const high=Math.max(open,close)+wick*rnd();
      const low=Math.min(open,close)-wick*rnd();
      price=close;
      bars.push({time:start+i*300000,open:+open.toFixed(3),high:+high.toFixed(3),low:+low.toFixed(3),close:+close.toFixed(3)});
    }
    return {bars,events};
  }

  return {DEFAULTS,parseOHLC,parseEvents,indicators,purityScore,simulate,analyze,riskScenarios,exportResultsCSV,generateSample,mean,median,std};
});
