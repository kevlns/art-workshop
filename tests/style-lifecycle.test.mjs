import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,writeFileSync,existsSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createObject,readObject,discardObject,updateObject} from '../lib/workspace.mjs';
import {loadCore} from '../lib/core.mjs';
import {EXAMPLE_CONFIG} from '../lib/style-contract.mjs';
import {startAnalysis,recoverStyleAdoption} from '../lib/style-lifecycle.mjs';
import {waitTask,cancelTask,taskStatus} from '../lib/tasks.mjs';
import {runtimeRoot,sleep,alive} from '../lib/runtime.mjs';
import {writeJson,readJson,hash,renameWithRetry} from '../lib/shared.mjs';
import {upgradeProject} from '../lib/migration.mjs';
import {compileGenerate} from '../lib/generate.mjs';
import {candidates,finalizations} from '../lib/candidates.mjs';
import {sha256File} from '../lib/bl.mjs';
import sharp from 'sharp';
async function fixture(fn){const root=mkdtempSync(join(tmpdir(),'art-style-lifecycle-'));cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});const settings={file:join(root,'config.json'),paths:{workspace:root,output:join(root,'output'),cache:join(root,'cache')}};try{await fn(root,settings);}finally{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}}
test('style analysis cannot start and existing adoption recovery stays idempotent',()=>fixture(async(root,settings)=>{
 const record=await createObject(settings,'cellgame','style',{name:'style',config:structuredClone(EXAMPLE_CONFIG)});
 await assert.rejects(startAnalysis(settings,'cellgame',record.id,1,{kind:'style'}),/独立风格分析已移除/);
 assert.deepEqual(await recoverStyleAdoption(settings,'cellgame',record.id),record);
 assert.equal(existsSync(join(runtimeRoot(settings),'tasks')),false);
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
