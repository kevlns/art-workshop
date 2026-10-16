import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {readObject,importReference,updateObject,discardObject,updateReference} from '../lib/workspace.mjs';
import {startAnalysis} from '../lib/style-lifecycle.mjs';
import {compileGenerate} from '../lib/generate.mjs';
import {waitTask} from '../lib/tasks.mjs';
import {runtimeRoot} from '../lib/runtime.mjs';
import {analyzeTaskReferences,referenceInput,taskReferencePrompt} from '../lib/task-references.mjs';
test('dynamic references are analyzed in a tracked run; stale observations cannot enter a plan',async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-task-refs-')),old=process.env.BL_BIN;
 cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 const settings={file:join(root,'config.json'),paths:{workspace:root,output:join(root,'output'),cache:join(root,'cache')}};
 try{
  const image=join(root,'ref.png');writeFileSync(image,await sharp({create:{width:8,height:8,channels:3,background:'#ff8800'}}).png().toBuffer());
  let record=await importReference(settings,'cellgame','task','skills',1,{source:image,purposes:['subject']});
  assert.throws(()=>compileGenerate({projectId:'cellgame',jobId:'skills',root}),/尚未分析/);
  await assert.rejects(analyzeTaskReferences({projectId:'cellgame',root,input:referenceInput(root,record),cacheDir:join(root,'cache'),runner:()=>({content:JSON.stringify({observations:[{purpose:'palette',description:'orange palette'}],conflicts:[],uncertainties:[]})})}),/越出/);
  const mock=join(root,'bl.mjs');writeFileSync(mock,`console.log(JSON.stringify({content:JSON.stringify({observations:[{purpose:'subject',description:'two linked spheres'}],conflicts:[],uncertainties:[]})}));`);process.env.BL_BIN=mock;
  const run=await startAnalysis(settings,'cellgame','skills',record.revision,{kind:'task'});
  await assert.rejects(updateObject(settings,'cellgame','task','skills',record.revision,{name:'race'}),/执行|停止/);
  const done=await waitTask(runtimeRoot(settings),run.taskId,{timeoutSeconds:20});assert.equal(done.status,'succeeded',done.error);assert.equal(done.stopConfirmed,true);
  const plan=compileGenerate({projectId:'cellgame',jobId:'skills',root});assert.match(plan.items[0].prompt,/two linked spheres/);assert.equal(plan.items[0].imageArgs.length,0);assert.equal(plan.refs.length,1);
  record=readObject(root,'cellgame','task','skills');const renamed=await updateObject(settings,'cellgame','task','skills',record.revision,{name:'new',config:record.config});assert.ok(renamed.report,'renaming or saving identical inputs keeps the verified report');
  const changed=structuredClone(renamed.config);changed.items[0].intent+=' new content';await updateObject(settings,'cellgame','task','skills',renamed.revision,{config:changed});
  assert.throws(()=>compileGenerate({projectId:'cellgame',jobId:'skills',root}),/尚未分析/);
 }finally{if(old===undefined)delete process.env.BL_BIN;else process.env.BL_BIN=old;rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});


test('object references only contribute observations to their bound output object',async()=>{
 const {hash}=await import('../lib/shared.mjs');
 const record={id:'task',config:{},references:[{id:'shared'},{id:'a',itemId:'first'},{id:'b',itemId:'second'}]};
 record.report={sourceHash:hash({config:record.config,references:record.references}),data:{schema:'art-workshop/task-reference-report',id:'task',conflicts:[],uncertainties:[],observations:[{referenceId:'shared',purpose:'subject',description:'common'},{referenceId:'a',purpose:'subject',description:'first-only'},{referenceId:'b',purpose:'subject',description:'second-only'}]}};
 assert.match(taskReferencePrompt(record,'first'),/common/);
 assert.match(taskReferencePrompt(record,'first'),/first-only/);
 assert.doesNotMatch(taskReferencePrompt(record,'first'),/second-only/);
 assert.doesNotMatch(taskReferencePrompt(record,'second'),/first-only/);
});


test('reference bindings validate identity and can become shared',async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-object-ref-'));
 cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 const settings={paths:{workspace:root,output:join(root,'output'),cache:join(root,'cache')}};
 try {
  const image=join(root,'ref.png');writeFileSync(image,await sharp({create:{width:8,height:8,channels:3,background:'#ff8800'}}).png().toBuffer());
  let record=readObject(root,'cellgame','task','skills');const objectId=record.config.items[0].id;
  await assert.rejects(importReference(settings,'cellgame','task','skills',record.revision,{source:image,purposes:['subject'],itemId:'missing'}),/不存在/);
  record=await importReference(settings,'cellgame','task','skills',record.revision,{source:image,purposes:['subject'],itemId:objectId});
  assert.equal(record.references[0].itemId,objectId);
  record=await updateReference(settings,'cellgame','task','skills',record.revision,record.references[0].id,{itemId:null});
  assert.equal(record.references[0].itemId,undefined);
 }finally{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});

test('CLI imports a reference for the named output object', async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-cli-ref-'));
 cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 try {
  const image=join(root,'ref.png');writeFileSync(image,await sharp({create:{width:8,height:8,channels:3,background:'#ff8800'}}).png().toBuffer());
  const record=readObject(root,'cellgame','task','skills'),itemId=record.config.items[0].id;
  const call=spawnSync(process.execPath,[fileURLToPath(new URL('../art-workshop.mjs',import.meta.url)),'reference','import','--workspace',root,'--config',join(root,'settings.json'),'--project','cellgame','--kind','task','--id','skills','--revision',String(record.revision),'--source',image,'--purposes','subject','--item-id',itemId],{encoding:'utf8'});
  assert.equal(call.status,0,call.stderr||call.stdout);
  assert.equal(JSON.parse(call.stdout).references.at(-1).itemId,itemId);
 } finally {rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});
