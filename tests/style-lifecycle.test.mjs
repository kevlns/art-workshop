import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,writeFileSync,existsSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createObject,readObject,discardObject} from '../lib/workspace.mjs';
import {startAnalysis,adoptStyle,recoverStyleAdoption} from '../lib/style-lifecycle.mjs';
import {waitTask,cancelTask,taskStatus} from '../lib/tasks.mjs';
import {runtimeRoot,sleep,alive} from '../lib/runtime.mjs';
import {writeJson,readJson,hash,renameWithRetry} from '../lib/shared.mjs';
import {upgradeProject} from '../lib/migration.mjs';
import {compileGenerate} from '../lib/generate.mjs';
import {candidates,finalizations} from '../lib/candidates.mjs';
import {sha256File} from '../lib/bl.mjs';
import sharp from 'sharp';
async function fixture(fn){const root=mkdtempSync(join(tmpdir(),'art-style-lifecycle-'));cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});const settings={file:join(root,'config.json'),paths:{workspace:root,output:join(root,'output'),cache:join(root,'cache')}};try{await fn(root,settings);}finally{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}}
test('analysis preview is read-only; real worker binds a report then adoption freezes once',()=>fixture(async(root,settings)=>{
 const record=await createObject(settings,'cellgame','style',{name:'style',config:{description:'rounded style'}});
 const mock=join(root,'mock-bl.mjs');writeFileSync(mock,`import fs from 'node:fs';const args=process.argv.slice(2).join(' ');const id=args.match(/"id":"(style-[a-z0-9-]+)"/)[1];const report=JSON.parse(fs.readFileSync(process.env.ART_REPORT,'utf8'));report.id=id;console.log(JSON.stringify({content:JSON.stringify(report)}));`);
 const previous=process.env.BL_BIN;process.env.BL_BIN=mock;process.env.ART_REPORT=join(root,'projects/cellgame/reports/cellgame.json');
 try{
  const dry=await startAnalysis(settings,'cellgame',record.id,1,{dry:true});assert.equal(dry.remoteCalls,0);
  assert.equal(existsSync(join(root,'cache')),false);
  const run=await startAnalysis(settings,'cellgame',record.id,1,{operationId:'art-original-analysis'});const done=await waitTask(runtimeRoot(settings),run.taskId,{timeoutSeconds:20});assert.equal(done.status,'succeeded',done.error);assert.equal(done.stopConfirmed,true);const duplicate=await startAnalysis(settings,'cellgame',record.id,1,{operationId:'art-original-analysis'});assert.equal(duplicate.taskId,run.taskId);
  assert.equal(done.currentItem.stage,'report-validation');
  const evidence=readJson(join(root,'projects/cellgame/styles',record.id,'reports',run.taskId,'responses/1.json'));assert.match(evidence.text,/style-report/);
  const current=readObject(root,'cellgame','style',record.id);assert.equal(current.report.sourceRevision,1);assert.equal(current.revision,2);
  const adopted=await adoptStyle(settings,'cellgame',record.id,2);assert.equal(adopted.status,'frozen');assert.equal((await recoverStyleAdoption(settings,'cellgame',record.id)).revision,adopted.revision);
  await assert.rejects(adoptStyle(settings,'cellgame',record.id,2),/版本|状态/);
 }finally{if(previous===undefined)delete process.env.BL_BIN;else process.env.BL_BIN=previous;delete process.env.ART_REPORT;}
}));
test('cancelled read-only analysis releases its draft after its worker exits, retaining upstream uncertainty',()=>fixture(async(root,settings)=>{
 const record=await createObject(settings,'cellgame','style',{name:'style',config:{description:'rounded style'}});const mock=join(root,'mock-slow-bl.mjs');const ready=join(root,'analysis-call-started');writeFileSync(mock,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(ready)},'ready');await new Promise(r=>setTimeout(r,10000));console.log('{}');`);
 const previous=process.env.BL_BIN;process.env.BL_BIN=mock;
 try{const run=await startAnalysis(settings,'cellgame',record.id,1);for(let i=0;i<100&&!existsSync(ready);i++)await sleep(50);assert.ok(existsSync(ready));const done=await cancelTask(runtimeRoot(settings),run.taskId);assert.ok(done.remoteCancellation);for(let i=0;i<100&&alive(done.workerPid);i++)await sleep(50);assert.equal(taskStatus(runtimeRoot(settings),run.taskId).stopConfirmed,true);assert.equal(readObject(root,'cellgame','style',record.id).report,null);await discardObject(settings,'cellgame','style',record.id,1);}finally{if(previous===undefined)delete process.env.BL_BIN;else process.env.BL_BIN=previous;}
}));

test('invalid report repairs once, retains both responses and leaves the editable draft intact',()=>fixture(async(root,settings)=>{
 const record=await createObject(settings,'cellgame','style',{name:'invalid',config:{description:'绘制风格'}});
 const mock=join(root,'invalid-report.mjs');writeFileSync(mock,"console.log(JSON.stringify({text:'not a report'}));");
 const previous=process.env.BL_BIN;process.env.BL_BIN=mock;
 try {
  const run=await startAnalysis(settings,'cellgame',record.id,1);
  const done=await waitTask(runtimeRoot(settings),run.taskId,{timeoutSeconds:20});
  assert.equal(done.status,'failed');assert.equal(done.stopConfirmed,true);assert.match(done.error,/一次文本修正/);
  assert.match(readJson(join(root,'projects/cellgame/styles',record.id,'reports',run.taskId,'responses/2.json')).text,/not a report/);
  const current=readObject(root,'cellgame','style',record.id);assert.equal(current.revision,1);assert.equal(current.report,null);
 } finally {if(previous===undefined)delete process.env.BL_BIN;else process.env.BL_BIN=previous;}
}));
test('explicit upgrade preserves original bytes in backup and rejects uncertain running project',()=>fixture(async(root,settings)=>{
 const directory=join(root,'projects/cellgame');const project=readJson(join(directory,'project.json'));delete project.schemaVersion;delete project.revision;writeJson(join(directory,'project.json'),project);
 const config=readJson(join(directory,'tasks/skills/task.json')).config;writeJson(join(directory,'jobs/skills.json'),config);rmSync(join(directory,'tasks'),{recursive:true});
 const dry=await upgradeProject(root,'cellgame',{dry:true,settings});assert.ok(dry.changes.some(c=>c.includes('skills')));
 const result=await upgradeProject(root,'cellgame',{dry:false,settings});assert.equal(readJson(join(directory,'project.json')).schemaVersion,2);assert.deepEqual(readJson(join(directory,'tasks/skills/task.json')).config,config);assert.deepEqual(readJson(join(result.backup,'jobs/skills.json')),config);
}));

test('upgrade preserves historical candidates and old adopted selections without retaining a review gate',()=>fixture(async(root,settings)=>{
 const directory=join(root,'projects/cellgame'),config=readJson(join(directory,'tasks/white-cell/task.json')).config;
 const plan=compileGenerate({root,projectId:'cellgame',jobId:'white-cell'}),item=plan.items[0];
 const output=join(settings.paths.output,'legacy-run'),image=join(output,'cell.png');
 writeJson(join(output,'placeholder.json'),{});await sharp({create:{width:1024,height:1024,channels:4,background:'#80c8c0'}}).png().toFile(image);
 const manifest={schema:'art-workshop/run',runId:'old-batch',plan,planHash:plan.planHash,startedAt:'2026-01-01T00:00:00Z',finishedAt:'2026-01-01T00:00:01Z',summary:{failed:0},items:[{...item,ok:true,status:'generated',files:['cell.png'],outputHashes:{'cell.png':sha256File(image)}}],review:[{itemId:item.itemId,variantId:item.variantId,file:'cell.png',content:'pass',style:'pass',asset:'pass'}]};
 const manifestPath=join(output,'manifest.json');writeJson(manifestPath,manifest);const original=readFileSync(manifestPath,'utf8');
 const project=readJson(join(directory,'project.json'));delete project.schemaVersion;delete project.revision;writeJson(join(directory,'project.json'),project);
 writeJson(join(directory,'jobs/white-cell.json'),config);rmSync(join(directory,'tasks'),{recursive:true});
 const preview=await upgradeProject(root,'cellgame',{dry:true,settings});assert.equal(preview.runs.length,1);assert.equal(existsSync(runtimeRoot(settings)),false);
 const result=await upgradeProject(root,'cellgame',{dry:false,settings});const runId=result.runs[0].id;
 assert.equal(candidates(settings,'cellgame','white-cell',runId)[0].accepted,true);assert.equal(finalizations(settings,'cellgame','white-cell')[0].runId,runId);
 assert.equal(readFileSync(manifestPath,'utf8'),original);assert.equal(readJson(join(result.backup,'jobs/white-cell.json')).kind,'generate');
 assert.equal((await upgradeProject(root,'cellgame',{dry:false,settings})).current,true);
}));

test('legacy unknown execution prevents upgrade before any directory replacement',()=>fixture(async(root,settings)=>{
 const directory=join(root,'projects/cellgame'),projectFile=join(directory,'project.json'),project=readJson(projectFile);delete project.schemaVersion;writeJson(projectFile,project);const bytes=readFileSync(projectFile,'utf8');
 const old=join(root,'.runtime',hash(settings.file).slice(0,12),'tasks','task-unknown.json');writeJson(old,{schema:'art-workshop/task',taskId:'task-unknown',project:'cellgame',status:'lost',workerPid:2147483647});
 await assert.rejects(upgradeProject(root,'cellgame',{dry:false,settings}),/停止未知/);assert.equal(readFileSync(projectFile,'utf8'),bytes);assert.equal(existsSync(join(root,'backups')),false);
}));

test('upgrade imports editing sources and recovers a crash between directory replacement and run registration',()=>fixture(async(root,settings)=>{
 const directory=join(root,'projects/cellgame'),source=join(root,'original.png');await sharp({create:{width:64,height:64,channels:4,background:'#fff'}}).png().toFile(source);
 const config=readJson(join(directory,'tasks/edit-white-background/task.json')).config;config.items[0].source='original.png';
 const project=readJson(join(directory,'project.json'));delete project.schemaVersion;writeJson(join(directory,'project.json'),project);writeJson(join(directory,'jobs/edit-job.json'),config);rmSync(join(directory,'tasks'),{recursive:true});
 const backup=join(root,'backups/interrupted');mkdirSync(join(root,'backups'),{recursive:true});renameWithRetry(directory,backup);cpSync(backup,directory,{recursive:true});writeJson(join(directory,'project.json'),{...project,schemaVersion:2});
 writeJson(join(runtimeRoot(settings),'upgrades/cellgame.json'),{schema:'art-workshop/upgrade',project:'cellgame',backup:'interrupted',staging:'unused-staging',createdRuns:[]});
 await assert.rejects(upgradeProject(root,'cellgame',{dry:true,settings}),/事务未完成/);
 const upgraded=await upgradeProject(root,'cellgame',{dry:false,settings}),record=readObject(root,'cellgame','task','edit-job');
 assert.ok(record.config.items[0].source.includes('tasks/edit-job/sources/'));assert.deepEqual(readFileSync(join(root,record.config.items[0].source)),readFileSync(source));assert.equal(readJson(join(upgraded.backup,'jobs/edit-job.json')).items[0].source,'original.png');assert.equal(existsSync(join(runtimeRoot(settings),'upgrades/cellgame.json')),false);
}));
