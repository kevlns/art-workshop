import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createObject,readObject,updateObject,discardObject,deriveObject,mutateObject,styleView,assertPlanCurrent} from '../lib/workspace.mjs';
import {loadCore} from '../lib/core.mjs';
import {compileGenerate} from '../lib/generate.mjs';
import {EXAMPLE_CONFIG} from '../lib/style-contract.mjs';
import {readJson,hash} from '../lib/shared.mjs';
import {sha256File} from '../lib/bl.mjs';
import sharp from 'sharp';

async function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'art-mutable-'));cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 const settings={paths:{workspace:root,output:join(root,'output'),cache:join(root,'cache')}};
 try{await fn(root,settings);}finally{rmSync(root,{recursive:true,force:true});}
}

test('saving rules immediately creates an executable style without analysis or adoption',()=>fixture(async(root,settings)=>{
 const saved=await createObject(settings,'cellgame','style',{name:'直接保存',config:structuredClone(EXAMPLE_CONFIG)});
 assert.ok(saved.coreHash);assert.equal(saved.report,null);assert.equal(styleView(root,saved).format.canEdit,true);
 assert.deepEqual(loadCore('cellgame',saved.id,root).config.rules,EXAMPLE_CONFIG.rules);
 const changed=await updateObject(settings,'cellgame','style',saved.id,saved.revision,{config:{rules:[]}});
 assert.deepEqual(loadCore('cellgame',saved.id,root).config.rules,[]);assert.notEqual(changed.coreHash,saved.coreHash);
 await assert.rejects(updateObject(settings,'cellgame','style',saved.id,saved.revision,{name:'stale'}),/版本冲突/);
}));

test('editing legacy saved styles retains exact historical core and invalidates pending plans',()=>fixture(async(root,settings)=>{
 const before=readObject(root,'cellgame','style','cellgame'),original=loadCore('cellgame','cellgame',root);
 const plan=compileGenerate({projectId:'cellgame',jobId:'white-cell',root});
 assert.doesNotThrow(()=>assertPlanCurrent(plan,settings));
 const view=styleView(root,before);assert.ok(view.config.rules.length);assert.equal(view.editable,true);
 const rules=structuredClone(view.config.rules);rules[0].instruction='采用水彩插画表现';
 const saved=await updateObject(settings,'cellgame','style',before.id,before.revision,{config:{...view.config,rules}});
 assert.equal(saved.id,before.id);assert.equal(saved.revision,before.revision+1);
 assert.equal(loadCore('cellgame','cellgame',root).config.rules[0].instruction,'采用水彩插画表现');
 const archived=readJson(join(root,'projects/cellgame/styles/cellgame/core-history',original.coreHash+'.json'));
 assert.deepEqual(archived,original);assert.deepEqual(plan.snapshots.core,original);
 assert.throws(()=>assertPlanCurrent(plan,settings),/核心已变化/);
 const next=compileGenerate({projectId:'cellgame',jobId:'white-cell',root});assert.match(next.items[0].prompt,/采用水彩插画表现/);
 assert.notEqual(next.sources.coreHash,plan.sources.coreHash);
}));

test('style save rejects invalid fields before changing persisted core or record',()=>fixture(async(root,settings)=>{
 const before=readObject(root,'cellgame','style','cellgame');
 const corePath=join(root,'projects/cellgame/styles/cellgame/core.json'),bytes=readFileSync(corePath);
 await assert.rejects(updateObject(settings,'cellgame','style','cellgame',before.revision,{config:{rules:[{id:'bad',scope:'subject',strength:'default',instruction:'bad',when:''}]}}),/scope/);
 assert.deepEqual(readFileSync(corePath),bytes);assert.deepEqual(readObject(root,'cellgame','style','cellgame'),before);
}));

test('archiving a saved style preserves its rules and historical snapshots',()=>fixture(async(root,settings)=>{
 const saved=await createObject(settings,'cellgame','style',{name:'归档测试',config:structuredClone(EXAMPLE_CONFIG)});
 const originalTask=readObject(root,'cellgame','task','white-cell'),job=await createObject(settings,'cellgame','task',{name:'归档前预案',config:{...originalTask.config,core:saved.id}});
 const plan=compileGenerate({projectId:'cellgame',jobId:job.id,root});
 const core=loadCore('cellgame',saved.id,root),archived=await discardObject(settings,'cellgame','style',saved.id,saved.revision);
 assert.equal(archived.status,'discarded');assert.deepEqual(archived.config,saved.config);
 assert.deepEqual(readJson(join(root,'projects/cellgame/styles',saved.id,'core-history',core.coreHash+'.json')),core);
 assert.throws(()=>loadCore('cellgame',saved.id,root),/归档/);
 assert.throws(()=>assertPlanCurrent(plan,settings),/归档/,'archiving prevents starting a pre-existing pending plan');
}));

test('copying a saved style keeps current rules, user config and independent approved images without a report',()=>fixture(async(root,settings)=>{
 let saved=await createObject(settings,'cellgame','style',{name:'复制源风格',config:{...structuredClone(EXAMPLE_CONFIG),description:'用户当前说明',constraints:['用户当前倾向']}});
 const sourceDirectory=join(root,'projects/cellgame/styles',saved.id),samplePath='samples/sample-owned.png';mkdirSync(join(sourceDirectory,'samples'),{recursive:true});
 const bytes=await sharp({create:{width:16,height:16,channels:4,background:'#468'}}).png().toBuffer();writeFileSync(join(sourceDirectory,samplePath),bytes);
 saved=await mutateObject(settings,'cellgame','style',saved.id,saved.revision,record=>{record.samples=[{id:'sample-owned',path:samplePath,hash:sha256File(join(sourceDirectory,samplePath)),rulesHash:hash(record.config.rules),note:'认可当前规则'}];return record;});
 const copied=await deriveObject(settings,'cellgame','style',saved.id,saved.revision);
 assert.equal(copied.report,null);assert.deepEqual(copied.config,saved.config);assert.deepEqual(copied.samples,saved.samples);
 const copyDirectory=join(root,'projects/cellgame/styles',copied.id);assert.deepEqual(readFileSync(join(copyDirectory,samplePath)),bytes);
 assert.deepEqual(loadCore('cellgame',copied.id,root).approvedSamples,copied.samples);
 rmSync(join(sourceDirectory,samplePath));
 const originalTask=readObject(root,'cellgame','task','white-cell'),job=await createObject(settings,'cellgame','task',{name:'复制风格生成',config:{...originalTask.config,core:copied.id}});
 const plan=compileGenerate({projectId:'cellgame',jobId:job.id,root});assert.equal(plan.items[0].imageArgs[0],join(copyDirectory,samplePath));
 const config=structuredClone(saved.config);config.rules=[];await updateObject(settings,'cellgame','style',saved.id,saved.revision,{config});
 assert.deepEqual(loadCore('cellgame',copied.id,root).config,copied.config.rules?{rules:copied.config.rules}:{});
}));
