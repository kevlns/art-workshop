import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {compileGenerate} from '../lib/generate.mjs';
import {compileEdit} from '../lib/edit.mjs';
import {createStyleSampleJob,selectStyleSample,removeStyleSample} from '../lib/style-samples.mjs';
import {readObject,updateObject,createObject,mutateObject,styleView,assertPlanCurrent,ownedPath,objectDirectory} from '../lib/workspace.mjs';
import {executePlan} from '../lib/executor.mjs';
import {writeJson,hash} from '../lib/shared.mjs';
import {taskFile,runtimeRoot} from '../lib/runtime.mjs';
import {candidates} from '../lib/candidates.mjs';
import {bindBackend} from '../lib/backends.mjs';
import {compileRemoteRequest} from '../lib/generation-policy.mjs';
import {exportStyleBundle,importStyleBundle} from '../lib/style-bundle.mjs';

async function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'art-style-samples-'));
 cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 const settings={paths:{workspace:root,output:join(root,'output'),cache:join(root,'cache')}};
 try{await fn(root,settings);}finally{rmSync(root,{recursive:true,force:true});}
}
async function successfulCandidate(root,settings,{run='task-sample-test'}={}){
 const plan=compileGenerate({projectId:'cellgame',jobId:'white-cell',root});
 const png=await sharp({create:{width:512,height:512,channels:4,background:'#468'}}).png().toBuffer();
 const {manifestPath}=executePlan(plan,plan.items,{outputRoot:settings.paths.output,runner:args=>{const dir=args[args.indexOf('--out-dir')+1];writeFileSync(join(dir,'generated.png'),png);return {};},log:()=>{}});
 writeJson(taskFile(runtimeRoot(settings),run),{schema:'art-workshop/task',taskId:run,status:'succeeded',stopConfirmed:true,finishedAt:new Date().toISOString(),plan,manifestPath});
 return {plan,run,candidate:candidates(settings,'cellgame','white-cell',run)[0]};
}

test('sample jobs use only current written rules across several subjects and never start generation',()=>fixture(async(root,settings)=>{
 const style=readObject(root,'cellgame','style','cellgame');
 const job=await createStyleSampleJob(settings,'cellgame','cellgame',style.revision);
 assert.equal(job.source.kind,'style-sample');assert.equal(job.config.styleReferenceMode,'text-only');assert.equal(job.config.items.length,3);
 const plan=compileGenerate({projectId:'cellgame',jobId:job.id,root});
 assert.equal(plan.items.length,3);assert.ok(plan.items.every(item=>item.imageArgs.length===0));
 assert.equal(existsSync(join(runtimeRoot(settings),'tasks')),false);
 await assert.rejects(createStyleSampleJob(settings,'cellgame','cellgame',style.revision+1),/版本冲突/);
}));

test('sample count is bounded and compiled for every subject without submitting generation',()=>fixture(async(root,settings)=>{
 const style=readObject(root,'cellgame','style','cellgame');
 const job=await createStyleSampleJob(settings,'cellgame',style.id,style.revision,{count:4});
 assert.equal(job.source.count,4);assert.equal(job.config.execution.perValue,4);
 const plan=compileGenerate({projectId:'cellgame',jobId:job.id,root});
 assert.equal(plan.execution.perValue,4);assert.equal(plan.items.length,3);assert.ok(plan.items.every(item=>(item.execution??plan.execution).perValue===4));
 for(const count of [0,5,1.5,'2'])await assert.rejects(createStyleSampleJob(settings,'cellgame',style.id,style.revision,{count}),/count/);
 assert.equal(existsSync(join(runtimeRoot(settings),'tasks')),false);
}));

test('runtime references deduplicate image content across runs and preserve revision on repeated selection',()=>fixture(async(root,settings)=>{
 const first=await successfulCandidate(root,settings,{run:'task-original'});
 let style=await selectStyleSample(settings,'cellgame','cellgame',1,{job:'white-cell',run:first.run,candidate:first.candidate.candidateId});
 assert.match(first.candidate.hash,/^[a-f0-9]{64}$/);
 const second=await successfulCandidate(root,settings,{run:'task-same-content'});
 assert.notEqual(first.candidate.candidateId,second.candidate.candidateId);assert.equal(first.candidate.hash,second.candidate.hash);
 const repeated=await selectStyleSample(settings,'cellgame','cellgame',style.revision,{job:'white-cell',run:second.run,candidate:second.candidate.candidateId});
 assert.equal(repeated.revision,style.revision);assert.equal(repeated.samples.length,1);assert.deepEqual(repeated.samples,style.samples);
 const directory=ownedPath(objectDirectory(root,'cellgame','style','cellgame'),'samples');assert.equal(readdirSync(directory).length,1);
 const sample=style.samples[0];style=await removeStyleSample(settings,'cellgame','cellgame',style.revision,sample.id);
 const added=await selectStyleSample(settings,'cellgame','cellgame',style.revision,{job:'white-cell',run:second.run,candidate:second.candidate.candidateId});
 assert.equal(added.samples.length,1);assert.equal(added.samples[0].id,sample.id);assert.equal(added.samples[0].path,sample.path);assert.equal(readdirSync(directory).length,1);
 const noChange=await selectStyleSample(settings,'cellgame','cellgame',added.revision,{job:'white-cell',run:second.run,candidate:second.candidate.candidateId});assert.equal(noChange.revision,added.revision);
 writeFileSync(second.candidate.path,'tampered');const changed=candidates(settings,'cellgame','white-cell',second.run)[0];assert.equal(changed.integrity,false);assert.equal(changed.hash,undefined,'tampered candidates do not expose a validated content hash');
}));

test('a current-rule candidate rebinds a stale identical image without another reference or file',()=>fixture(async(root,settings)=>{
 const first=await successfulCandidate(root,settings,{run:'task-old-rules'});
 let style=await selectStyleSample(settings,'cellgame','cellgame',1,{job:'white-cell',run:first.run,candidate:first.candidate.candidateId});
 const oldSample=style.samples[0],config=styleView(root,style).config;config.rules[0].instruction+='，轮廓明确';
 style=await updateObject(settings,'cellgame','style','cellgame',style.revision,{config});assert.equal(styleView(root,style).samples[0].stale,true);
 const task=readObject(root,'cellgame','task','white-cell');task.config.styleReferenceMode='text-only';await updateObject(settings,'cellgame','task',task.id,task.revision,{config:task.config});
 const second=await successfulCandidate(root,settings,{run:'task-current-rules'});
 style=await selectStyleSample(settings,'cellgame','cellgame',style.revision,{job:task.id,run:second.run,candidate:second.candidate.candidateId});
 assert.equal(style.samples.length,1);assert.equal(style.samples[0].id,oldSample.id);assert.equal(style.samples[0].path,oldSample.path);assert.equal(style.samples[0].hash,oldSample.hash);
 assert.notEqual(style.samples[0].rulesHash,oldSample.rulesHash);assert.equal(style.samples[0].runId,second.run);assert.equal(styleView(root,style).samples[0].stale,false);
 assert.equal(readdirSync(ownedPath(objectDirectory(root,'cellgame','style','cellgame'),'samples')).length,1);
}));

test('cancelling sample finalization removes all legacy references to the same image and retains historical files',()=>fixture(async(root,settings)=>{
 const first=await successfulCandidate(root,settings);
 let style=await selectStyleSample(settings,'cellgame','cellgame',1,{job:'white-cell',run:first.run,candidate:first.candidate.candidateId});
 const sample=style.samples[0];
 style=await mutateObject(settings,'cellgame','style','cellgame',style.revision,record=>{record.samples.push({...sample,id:'sample-old-duplicate'});return record;});
 assert.equal(style.samples.length,2);
 style=await removeStyleSample(settings,'cellgame','cellgame',style.revision,sample.id);
 assert.equal(style.samples.length,0);assert.ok(existsSync(ownedPath(objectDirectory(root,'cellgame','style','cellgame'),sample.path)));
 const plan=compileGenerate({projectId:'cellgame',jobId:'white-cell',root});assert.equal(plan.items[0].imageArgs.length,0);
}));

test('repeated sample finalization refuses a missing or modified runtime copy',()=>fixture(async(root,settings)=>{
 const first=await successfulCandidate(root,settings);
 const style=await selectStyleSample(settings,'cellgame','cellgame',1,{job:'white-cell',run:first.run,candidate:first.candidate.candidateId});
 const sample=style.samples[0],path=ownedPath(objectDirectory(root,'cellgame','style','cellgame'),sample.path),bytes=readFileSync(path);
 rmSync(path);await assert.rejects(selectStyleSample(settings,'cellgame','cellgame',style.revision,{job:'white-cell',run:first.run,candidate:first.candidate.candidateId}),/缺失或已改变/);
 writeFileSync(path,'changed');await assert.rejects(selectStyleSample(settings,'cellgame','cellgame',style.revision,{job:'white-cell',run:first.run,candidate:first.candidate.candidateId}),/缺失或已改变/);
 writeFileSync(path,bytes);const unchanged=await selectStyleSample(settings,'cellgame','cellgame',style.revision,{job:'white-cell',run:first.run,candidate:first.candidate.candidateId});assert.equal(unchanged.revision,style.revision);
}));

test('image CLI exposes sample job creation with CAS and saves normal task data',()=>fixture(async(root)=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../art-workshop.mjs',import.meta.url)),'image','style','sample-job','--workspace',root,'--project','cellgame','--id','cellgame','--revision','1','--count','2'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);
 const job=JSON.parse(result.stdout);assert.equal(job.source.styleId,'cellgame');assert.equal(job.config.styleReferenceMode,'text-only');
 assert.equal(job.config.execution.perValue,2);assert.equal(job.source.count,2);assert.equal(job.config.items.length*job.config.execution.perValue,6);
 assert.equal(readObject(root,'cellgame','task',job.id).config.items.length,3);
}));

test('approval copies successful candidate and freezes reference roles into real remote requests',()=>fixture(async(root,settings)=>{
 const {run,candidate}=await successfulCandidate(root,settings);
 let style=await selectStyleSample(settings,'cellgame','cellgame',1,{job:'white-cell',run,candidate:candidate.candidateId,note:'统一描边与明暗'});
 assert.equal(style.samples.length,1);
 const plan=compileGenerate({projectId:'cellgame',jobId:'white-cell',root}),sample=style.samples[0];
 assert.equal(plan.styleReferences.status,'approved');assert.equal(plan.items[0].imageArgs.length,1);
 assert.match(plan.items[0].prompt,/不要沿用参考图片的具体主体/);
 const path=ownedPath(objectDirectory(root,'cellgame','style','cellgame'),sample.path);
 assert.equal(plan.items[0].imageArgs[0],path);assert.notEqual(path,candidate.path);
 const request=compileRemoteRequest(plan,plan.items[0]);assert.deepEqual(request.images,[path]);
  style=await removeStyleSample(settings,'cellgame','cellgame',style.revision,sample.id);
  style=await selectStyleSample(settings,'cellgame','cellgame',style.revision,{job:'white-cell',run,candidate:candidate.candidateId});
  assert.equal(style.samples[0].id,sample.id,'previously removed immutable bytes can be selected again');
 rmSync(candidate.path);assert.ok(existsSync(path),'source deletion cannot erase approved sample');
 assert.doesNotThrow(()=>compileGenerate({projectId:'cellgame',jobId:'white-cell',root}));
 style=await removeStyleSample(settings,'cellgame','cellgame',style.revision,sample.id);
 assert.equal(style.samples.length,0);assert.ok(existsSync(path),'historical plan bytes retained');
 assert.throws(()=>assertPlanCurrent(plan,settings),/变化|失效/);
}));

test('rule changes mark samples stale, reject implicit reuse and allow explicit text-only generation',()=>fixture(async(root,settings)=>{
 const {run,candidate}=await successfulCandidate(root,settings);
 let style=await selectStyleSample(settings,'cellgame','cellgame',1,{job:'white-cell',run,candidate:candidate.candidateId});
 const config=styleView(root,style).config;config.rules[0].instruction+='，色块明确';
 style=await updateObject(settings,'cellgame','style','cellgame',style.revision,{config});
 assert.equal(styleView(root,style).samples[0].stale,true);
 assert.throws(()=>compileGenerate({projectId:'cellgame',jobId:'white-cell',root}),/待复核/);
 const task=readObject(root,'cellgame','task','white-cell');task.config.styleReferenceMode='text-only';
 await updateObject(settings,'cellgame','task',task.id,task.revision,{config:task.config});
 const plan=compileGenerate({projectId:'cellgame',jobId:task.id,root});assert.equal(plan.items[0].imageArgs.length,0);
 await assert.rejects(selectStyleSample(settings,'cellgame','cellgame',style.revision,{job:task.id,run,candidate:candidate.candidateId}),/规则已变化/);
}));

test('edited images precede style samples, local adapters reject unsupported guidance, hashes remain enforced',()=>fixture(async(root,settings)=>{
 const {run,candidate}=await successfulCandidate(root,settings);
 const style=await selectStyleSample(settings,'cellgame','cellgame',1,{job:'white-cell',run,candidate:candidate.candidateId});
 const job=await createObject(settings,'cellgame','task',{name:'编辑',config:{project:'cellgame',kind:'edit',core:'cellgame',items:[{id:'edit',source:candidate.path,changes:[{target:'color',instruction:'改为蓝色'}],preserve:[],mustRead:['蓝色主体']}]}});
 const plan=compileEdit({projectId:'cellgame',jobId:job.id,root});assert.equal(plan.items[0].imageArgs.length,2);assert.match(plan.items[0].prompt,/输入图1是编辑底图/);
 const generated=compileGenerate({projectId:'cellgame',jobId:'white-cell',root});
 await assert.rejects(async()=>bindBackend(generated,{generation:{defaultBackend:'local',backends:{local:{provider:'comfyui',model:plan.execution.model,endpoints:['http://localhost:8188'],workflow:'vant-builtin-qwen-image-2.1-Q4-8GB'}}}},'local'),/尚未适配风格样张/);
 const path=ownedPath(objectDirectory(root,'cellgame','style','cellgame'),style.samples[0].path);writeFileSync(path,'changed');
 assert.throws(()=>compileGenerate({projectId:'cellgame',jobId:'white-cell',root}),/运行时参考缺失或已改变/);
}));

test('shared style packages preserve approved images and can be edited after import',()=>fixture(async(root,settings)=>{
 const {run,candidate}=await successfulCandidate(root,settings);
 await selectStyleSample(settings,'cellgame','cellgame',1,{job:'white-cell',run,candidate:candidate.candidateId});
 const file=join(root,'sample.style.json');exportStyleBundle(root,'cellgame','cellgame',file);
 const imported=await importStyleBundle(settings,'cellgame',file);assert.equal(imported.samples.length,1);
 const sample=imported.samples[0],path=ownedPath(objectDirectory(root,'cellgame','style',imported.id),sample.path);
 assert.ok(existsSync(path));assert.equal(hash(readFileSync(path)),hash(readFileSync(ownedPath(objectDirectory(root,'cellgame','style','cellgame'),sample.path))));
 const next=await updateObject(settings,'cellgame','style',imported.id,imported.revision,{name:'可编辑的导入风格'});assert.equal(next.name,'可编辑的导入风格');
 writeFileSync(path,'changed');await assert.rejects(importStyleBundle(settings,'cellgame',file),/运行时参考缺失或已改变/);
}));

test('styles saved directly without an analysis report can be shared and remain executable after import',()=>fixture(async(root,settings)=>{
 const style=await createObject(settings,'cellgame','style',{name:'直接保存',config:{rules:[]}});
 const file=join(root,'direct.style.json');exportStyleBundle(root,'cellgame',style.id,file);
 const imported=await importStyleBundle(settings,'cellgame',file);
 assert.equal(imported.report,null);assert.equal(styleView(root,imported).format.status,'current');
 const job=await createStyleSampleJob(settings,'cellgame',imported.id,imported.revision);
 assert.doesNotThrow(()=>compileGenerate({projectId:'cellgame',jobId:job.id,root}));
}));
