import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {analyzeStyle} from '../lib/analyze.mjs';
import {readJson} from '../lib/shared.mjs';
import {OBSERVATION_SCOPES} from '../lib/style-contract.mjs';

async function fixture(run){const root=mkdtempSync(join(tmpdir(),'art-analysis-progress-'));cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});try{return await run(root);}finally{rmSync(root,{recursive:true,force:true});}}
test('real category scopes validate, progress tracks each image, and one repair does not reread images',()=>fixture(async root=>{
 const report=readJson(join(root,'projects/cellgame/reports/cellgame.json'));
 report.id='new-style';report.observations[0].scope='palette';
 writeFileSync(join(root,'one.png'),'one');writeFileSync(join(root,'two.png'),'two');
 const input={project:'cellgame',id:'new-style',description:'绘制语言',constraints:[],refs:[{path:'one.png',scope:'palette',note:'配色'},{path:'two.png',scope:'rendering',note:'绘制'}]};
 const events=[],calls=[];
 const result=await analyzeStyle({projectId:'cellgame',input,root,refsDir:root,cacheDir:join(root,'cache'),onProgress:p=>events.push(p),runner:args=>{
  calls.push(args);
  if(args[0]==='vision')return {text:'已有图片观察'};
  if(calls.length===3){const bad=structuredClone(report);bad.observations[0].scope='invalid';return {text:JSON.stringify(bad)};}
  return {text:JSON.stringify(report)};
 }});
 assert.equal(result.observations[0].scope,'palette');
 assert.equal(calls.filter(c=>c[0]==='vision').length,2);
 assert.equal(calls.length,4);
 assert.deepEqual(events.map(p=>p.stage),['reference-analysis','reference-analysis','synthesis','report-repair','report-validation']);
 assert.deepEqual(events.slice(0,2).map(p=>[p.index,p.completed,p.total]),[[1,0,2],[2,1,2]]);
 assert.deepEqual(OBSERVATION_SCOPES,['style','palette','rendering','content','asset']);
}));
test('repair is bounded and preview does not emit running progress',()=>fixture(async root=>{
 const input={project:'cellgame',id:'new-style',description:'绘制语言',constraints:[],refs:[]};let calls=0;
 await analyzeStyle({projectId:'cellgame',input,root,dry:true,onProgress:()=>assert.fail('preview cannot report running'),runner:()=>assert.fail('preview cannot call model')});
 await assert.rejects(analyzeStyle({projectId:'cellgame',input,root,cacheDir:join(root,'cache'),runner:()=>{calls++;return {text:'invalid JSON'};}}),/一次文本修正/);
 assert.equal(calls,2);
}));

test('explicit retry after synthesis failure reuses complete observations only for unchanged inputs',()=>fixture(async root=>{
 writeFileSync(join(root,'one.png'),'one');writeFileSync(join(root,'two.png'),'two');
 const input={project:'cellgame',id:'new-style',description:'绘制语言',constraints:[],refs:[{path:'one.png',scope:'palette',note:'配色'},{path:'two.png',scope:'rendering',note:'绘制'}]};
 const options={projectId:'cellgame',input,root,refsDir:root,cacheDir:join(root,'cache')};
 let images=0,textCalls=0;
 const failed=async args=>{if(args[0]==='vision'){images++;return {text:'完整分类观察'};}textCalls++;throw new Error('transport timeout');};
 await assert.rejects(analyzeStyle({...options,runner:failed}),/timeout/);
 assert.equal(images,2);assert.equal(textCalls,1);
 const report=readJson(join(root,'projects/cellgame/reports/cellgame.json'));report.id=input.id;
 // New worker evidence directories change paths without changing the pixels.
 writeFileSync(join(root,'snapshot-one.png'),'one');writeFileSync(join(root,'snapshot-two.png'),'two');
 input.refs[0].path='snapshot-one.png';input.refs[1].path='snapshot-two.png';
 const events=[];
 await analyzeStyle({...options,onProgress:p=>events.push(p),runner:async args=>{assert.equal(args[0],'text');textCalls++;return {text:JSON.stringify(report)};}});
 assert.equal(textCalls,2);assert.equal(events.filter(p=>p.reused).length,2);
 writeFileSync(join(root,'snapshot-one.png'),'changed pixels');
 await assert.rejects(analyzeStyle({...options,runner:failed}),/timeout/);
 assert.equal(images,3,'only the changed image is reobserved');
}));
