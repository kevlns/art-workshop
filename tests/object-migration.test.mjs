import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readJson,writeJson,hash} from '../lib/shared.mjs';
import {readObject,listObjects,objectFile,objectFormat,deriveObject,updateObject,migrationSource,finishMigration,confirmMigration} from '../lib/workspace.mjs';
import {compileGenerate} from '../lib/generate.mjs';
import {startAnalysis} from '../lib/style-lifecycle.mjs';

async function fixture(fn){const root=mkdtempSync(join(tmpdir(),'art-migration-'));cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});try{return await fn(root,{paths:{workspace:root,cache:join(root,'cache')}});}finally{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}}
function retire(root){const file=join(root,'projects/cellgame/styles/cellgame/core.json');const core=readJson(file);delete core.schemaVersion;delete core.coreHash;core.coreHash=hash(core);writeJson(file,core);return readFileSync(file,'utf8');}

test('retired core labels dependent tasks and blocks editing and compiling; normal incomplete drafts remain current',()=>fixture(async(root,settings)=>{
 const original=retire(root),style=readObject(root,'cellgame','style','cellgame'),task=readObject(root,'cellgame','task','white-cell');
 assert.equal(objectFormat(root,style).status,'deprecated');assert.equal(objectFormat(root,task).status,'deprecated');
 await assert.rejects(updateObject(settings,'cellgame','task',task.id,task.revision,{name:'cannot edit'}),/格式弃用/);
 assert.throws(()=>compileGenerate({root,projectId:'cellgame',jobId:task.id}),/格式弃用/);
 assert.equal(readFileSync(join(root,'projects/cellgame/styles/cellgame/core.json'),'utf8'),original);
 const migrated=await deriveObject(settings,'cellgame','task',task.id,task.revision);
 assert.equal(objectFormat(root,migrated).status,'current');assert.equal(migrated.config.core,null);assert.equal(migrated.report,null);
 assert.equal(migrated.config.items[0].intent,'');assert.equal(migrationSource(root,migrated).object.config.items[0].intent,task.config.items[0].intent);
 assert.equal((await deriveObject(settings,'cellgame','task',task.id,task.revision)).id,migrated.id);
 await assert.rejects(finishMigration(settings,'cellgame','task',migrated.id,migrated.revision,{note:'done'}),/主体|需求|风格/);
}));
test('retired style migrates into a clean, version-checked draft; analysis requires verified completion',()=>fixture(async(root,settings)=>{
 const original=retire(root),source=readObject(root,'cellgame','style','cellgame');
 const target=await deriveObject(settings,'cellgame','style',source.id,source.revision);
 assert.notEqual(target.id,source.id);assert.deepEqual(target.config,{description:'',constraints:[]});assert.equal(target.report,null);
 const snapshot=migrationSource(root,target);assert.equal(snapshot.core.id,source.id);assert.equal(snapshot.object.revision,source.revision);
 await assert.rejects(startAnalysis(settings,'cellgame',target.id,target.revision,{dry:true}),/迁移尚未完成/);
 let saved=await updateObject(settings,'cellgame','style',target.id,target.revision,{config:{description:'硬边数字卡通绘制语言',constraints:[]}});
 await assert.rejects(finishMigration(settings,'cellgame','style',target.id,target.revision,{note:'done'}),/版本冲突/);
 saved=await finishMigration(settings,'cellgame','style',target.id,saved.revision,{note:'仅迁移绘制语言，原配置保留为来源'});
 assert.equal(saved.migration.status,'ready');assert.equal((await startAnalysis(settings,'cellgame',target.id,saved.revision,{dry:true})).remoteCalls,0);
 saved=await confirmMigration(settings,'cellgame','style',target.id,saved.revision);assert.ok(saved.migration.confirmedAt);
 assert.equal(readFileSync(join(root,'projects/cellgame/styles/cellgame/core.json'),'utf8'),original);
}));
test('source pack tampering cannot complete migration or read resources',()=>fixture(async(root,settings)=>{
 retire(root);const source=readObject(root,'cellgame','style','cellgame');let target=await deriveObject(settings,'cellgame','style',source.id,source.revision);
 const pack=join(root,'projects/cellgame/styles',target.id,'migration/source.json');const data=readJson(pack);data.object.config.description='changed';writeJson(pack,data);
 assert.throws(()=>migrationSource(root,target),/快照已变化/);
 target=await updateObject(settings,'cellgame','style',target.id,target.revision,{config:{description:'已填内容'}});
 await assert.rejects(finishMigration(settings,'cellgame','style',target.id,target.revision,{note:'done'}),/快照已变化/);
}));

test('interrupted migration preparation resumes the same staged draft',()=>fixture(async(root,settings)=>{
 retire(root);const source=readObject(root,'cellgame','style','cellgame');
 const first=await deriveObject(settings,'cellgame','style',source.id,source.revision);
 delete first.migration;first.status='cleanup-required';first.error='interrupted';writeJson(objectFile(root,'cellgame','style',first.id),first);
 assert.equal(objectFormat(root,first).status,'unreadable');
 const resumed=await deriveObject(settings,'cellgame','style',source.id,source.revision);
 assert.equal(resumed.id,first.id);assert.equal(resumed.status,'draft');assert.equal(resumed.migration.status,'pending');
 assert.equal(resumed.error,undefined);assert.equal(migrationSource(root,resumed).object.id,source.id);
 assert.equal(listObjects(root,'cellgame','style').filter(r=>r.source?.id===source.id).length,1);
}));

test('one unreadable object does not hide the remaining project objects',()=>fixture(async(root)=>{
 const source=readObject(root,'cellgame','style','cellgame');source.revision='invalid';writeJson(objectFile(root,'cellgame','style',source.id),source);
 const listed=listObjects(root,'cellgame','style');const unreadable=listed.find(r=>r.id===source.id);
 assert.ok(unreadable.readError);assert.equal(objectFormat(root,unreadable).status,'unreadable');
 assert.ok(listObjects(root,'cellgame','task').length>0);
}));
