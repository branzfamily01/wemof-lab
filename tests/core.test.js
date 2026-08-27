const assert=require('assert');
const C=require('../analysis-core.js');

const sample=C.generateSample(720);
assert.strictEqual(sample.bars.length,720);
assert.ok(sample.events.length>=2);
const result=C.analyze(sample.bars,sample.events,C.DEFAULTS);
assert.ok(result.candidates.length>0,'sample should produce candidates');
assert.ok(result.candidates.every(r=>Number.isFinite(r.score)));
assert.ok(result.candidates.every(r=>r.maePips>=0 && r.mfePips>=0));
assert.ok(result.metrics.simple.count===result.candidates.length);
const risk=C.riskScenarios(result,[20,50,100]);
assert.strictEqual(risk.length,3);
assert.deepStrictEqual(risk.map(x=>x.stopPips),[20,50,100]);

const csv='timestamp,open,high,low,close\n2026-01-01 00:00,150,150.1,149.9,150.05\n';
let threw=false;try{C.parseOHLC(csv);}catch(e){threw=true;}assert.ok(threw,'short csv rejected');

const longRows=[];for(let i=0;i<40;i++){longRows.push(`2026-01-01 00:${String(i).padStart(2,'0')},${150+i*.01},${150.05+i*.01},${149.95+i*.01},${150.02+i*.01}`)}
const parsed=C.parseOHLC('timestamp,open,high,low,close\n'+longRows.join('\n'));
assert.strictEqual(parsed.length,40);

const out=C.exportResultsCSV(result.candidates.slice(0,2));
assert.ok(out.startsWith('time,side,close'));
console.log(`PASS: ${result.candidates.length} candidates, ${result.metrics.qualified} qualified`);
