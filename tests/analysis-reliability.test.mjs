import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {analyzeStyle} from '../lib/analyze.mjs';
import {deriveObject,createObject,readObject,objectFile,updateObject} from '../lib/workspace.mjs';
import {analysisInput} from '../lib/style-lifecycle.mjs';
import {readJson,writeJson,hash} from '../lib/shared.mjs';
import {styleReviewState} from '../lib/style-review.mjs';

async function fixture(fn){const root=mkdtempSync(join(tmpdir(),'art-reliability-'));cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});try{return await fn(root,{paths:{workspace:root,cache:join(root,'cache')}});}finally{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}}
const report=root=>readJson(join(root,'projects/cellgame/reports/cellgame.json'));
const analyze=(root,settings,record,extra={})=>analyzeStyle({projectId:'cellgame',root,refsDir:root,cacheDir:settings.paths.cache,input:analysisInput(settings,record),runner:()=>({text:JSON.stringify({...report(root),id:record.id})}),...extra});

test('frozen derivation and user rule revision can be reanalyzed without a spurious repair',()=>fixture(async(root,settings)=>{
 let record=await deriveObject(settings,'cellgame','style','cellgame',1),calls=0;
 const runner=()=>{calls++;return {text:JSON.stringify({...report(root),id:record.id})};};
 const result=await analyze(root,settings,record,{runner});assert.equal(calls,1);assert.equal(result.id,record.id);
 record.report={data:result,sourceRevision:record.revision,sourceHash:hash({config:record.config,references:record.references})};writeJson(objectFile(root,'cellgame','style',record.id),record);
 record=await updateObject(settings,'cellgame','style',record.id,record.revision,{config:{...record.config,rules:result.recommendation.rules}});
 await analyze(root,settings,record,{runner});assert.equal(calls,2);
}));
test('rules-only and reference-only inputs analyze, long reference notes survive intact',()=>fixture(async(root,settings)=>{
 const record=await createObject(settings,'cellgame','style',{name:'rules only',config:{rules:report(root).recommendation.rules}});
 assert.equal((await analyze(root,settings,record)).id,record.id);
 writeFileSync(join(root,'image.png'),'pixels');
 const note='观察绘制语言'.repeat(1000);
 const preview=await analyzeStyle({projectId:'cellgame',root,refsDir:root,input:{project:'cellgame',id:'only-reference',refs:[{path:'image.png',scope:'style',note}]},dry:true});
 assert.equal(preview.remoteCalls,0);assert.ok(preview.requests[0].at(-1).includes(note));
}));
test('content-only response gets host identity; explicit wrong identity fails without a repair',()=>fixture(async(root,settings)=>{
 const record=await createObject(settings,'cellgame','style',{name:'identity',config:{description:'绘制语言'}});
 const {schema,schemaVersion,project,id,provenance,decisions,...body}=report(root);
 assert.equal((await analyze(root,settings,record,{runner:()=>({text:JSON.stringify(body)})})).id,record.id);
 let calls=0;await assert.rejects(analyze(root,settings,record,{cacheDir:join(root,'wrong-cache'),runner:()=>{calls++;return {text:JSON.stringify(report(root))};}}),/身份/);assert.equal(calls,1);
 record.report={data:report(root),sourceHash:hash({config:record.config,references:record.references})};assert.equal(styleReviewState(record).ready,false);
}));
test('malformed content repairs once, while program errors never trigger another model call',()=>fixture(async(root,settings)=>{
 const record=await createObject(settings,'cellgame','style',{name:'failure',config:{description:'绘制语言'}});let calls=0;
 await assert.rejects(analyze(root,settings,record,{runner:()=>{calls++;return {text:'bad JSON'};}}),/一次文本修正/);assert.equal(calls,2);
 record.report={data:{...report(root),id:record.id,provenance:null}};calls=0;
 await analyze(root,settings,record,{runner:()=>{calls++;return {text:JSON.stringify({...report(root),id:record.id})};}});assert.equal(calls,1);
}));
