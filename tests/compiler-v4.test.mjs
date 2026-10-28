import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileGenerate} from '../lib/generate.mjs';
import {compileEdit} from '../lib/edit.mjs';
import {readJson,writeJson,hash} from '../lib/shared.mjs';
import {textSpecs,textSpecLine,validateTaskDraft,taskContract} from '../lib/task-contract.mjs';
import {resolveAssetProfile,taskObjectView} from '../lib/asset-profile.mjs';
import {presentation} from '../lib/presentation.mjs';
import {validatePlan} from '../lib/plan.mjs';
import {bindBackend,buildComfyRequest} from '../lib/backends.mjs';
import {compileRemoteRequest} from '../lib/generation-policy.mjs';
import {readObject,updateObject} from '../lib/workspace.mjs';
const fixture=async fn=>{
 const root=mkdtempSync(join(tmpdir(),'art-compiler-v4-'));
 try{cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});return await fn(root);}
 finally{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
};
const spec={content:'开始游戏',hierarchy:'主标题',zone:'底部居中',fontHint:'粗体无衬线'};
const compile=root=>compileGenerate({root,projectId:'cellgame',jobId:'white-cell'});
const file=root=>join(root,'projects/cellgame/tasks/white-cell/task.json');
function change(root,fn){const record=readJson(file(root));fn(record.config);writeJson(file(root),record);}
const local={generation:{defaultBackend:'local',backends:{local:{provider:'comfyui',model:'local.gguf',endpoints:['http://127.0.0.1:8188']}}}};

test('pre-upgrade golden items retain exact hashes including prompt, negative, checks, brief and inputHash',()=>fixture(root=>{
 const golden=readJson(new URL('./fixtures/compiler-golden.json',import.meta.url));
 for(const [jobId,expected] of Object.entries(golden)){
  const plan=compileGenerate({root,projectId:'cellgame',jobId});
  assert.equal(hash(plan.items),expected,jobId);assert.equal(plan.compilerVersion,4);validatePlan(plan);
 }
 const before=readFileSync(file(root),'utf8');
 const view=taskObjectView(root,readObject(root,'cellgame','task','white-cell'));
 assert.equal(view.resolvedAsset.constraints.text,false);assert.equal(readFileSync(file(root),'utf8'),before);
 assert.doesNotMatch(compile(root).items[0].negativeBlock,/文字扭曲/);
}));

test('text specifications preserve long descriptions, distinguish visual features and deduplicate full tuples only',()=>fixture(async root=>{
 const long='保留全部内容'.repeat(700);
 const entries=[spec,{...spec,zone:'右上角'},spec,{...spec,fontHint:'细体'}];
 assert.equal(textSpecs(entries).length,3);
 change(root,job=>{job.asset=resolveAssetProfile(root,'cellgame',job);delete job.profile;job.asset.constraints.text=true;job.items[0].textSpecs=entries;job.items[0].entities[0].material=long;});
 const record=readObject(root,'cellgame','task','white-cell');
 const saved=await updateObject({paths:{workspace:root}},'cellgame','task','white-cell',record.revision,{config:record.config});
 assert.deepEqual(saved.config.items[0].textSpecs,entries);
 const plan=compile(root),item=plan.items[0];
 assert.ok(item.prompt.includes(long));assert.equal((item.prompt.match(/文字：「开始游戏」/g)??[]).length,3);
 assert.ok(item.prompt.indexOf('必须可读的特征')<item.prompt.indexOf('画面文字规格'));
 assert.match(item.negativeBlock,/文字扭曲, 笔画错乱, 模糊小字$/);
 assert.ok(item.checks.content.every(x=>typeof x==='string'));assert.ok(item.checks.content.includes(textSpecLine(spec)));
 assert.deepEqual(item.brief.textSpecs,entries);
}));

test('incomplete drafts save without coercion while compilation rejects incomplete and forbidden text',()=>fixture(async root=>{
 const record=readObject(root,'cellgame','task','white-cell');
 record.config.items[0].textSpecs=[{content:'',zone:''}];
 const saved=await updateObject({paths:{workspace:root}},'cellgame','task','white-cell',record.revision,{config:record.config});
 assert.deepEqual(saved.config.items[0].textSpecs,[{content:'',zone:''}]);
 assert.throws(()=>compile(root),/items\[0\]\.textSpecs\[0\]\.content/);
 change(root,job=>job.items[0].textSpecs=[spec]);assert.throws(()=>compile(root),/资产规格禁用文字/);
 for(const bad of [null,{},['文字'],[{content:1}],[{invented:'x'}]])assert.throws(()=>validateTaskDraft({kind:'edit',items:[{textSpecs:bad}]}));
 assert.doesNotThrow(()=>validateTaskDraft({kind:'edit',items:[{textSpecs:[{}]}]}));
 assert.throws(()=>validateTaskDraft({kind:'edit',items:[{composition:{}}]}),/不支持字段/);
 assert.ok(taskContract('generate').fields.entity.includes('material'));
 assert.ok(taskContract('edit').fields.item.includes('textSpecs'));
 assert.ok(!taskContract('edit').fields.item.includes('entities'));
}));

test('lighting is a paired profile capability with independent item and variant overrides',()=>fixture(root=>{
 const old=resolveAssetProfile(root,'cellgame',readObject(root,'cellgame','task','white-cell').config);
 assert.throws(()=>presentation(old,{lightDirection:'左上方'}),/未开放/);
 const profile=structuredClone(old);
 profile.allowedOverrides.lightDirection=['左上方','右上方'];profile.allowedOverrides.lightQuality=['柔和','硬朗'];
 profile.defaults.lightDirection='左上方';profile.defaults.lightQuality='柔和';
 assert.match(presentation(profile,{}).prompt,/光照：左上方，柔和/);
 assert.match(presentation(profile,{lightQuality:'硬朗'}).prompt,/光照：左上方，硬朗/);
 assert.throws(()=>presentation(profile,{lightDirection:'顶部'}),/必须/);
 const broken=structuredClone(profile);delete broken.allowedOverrides.lightQuality;assert.throws(()=>presentation(broken),/成对/);
 change(root,job=>{delete job.profile;job.asset=profile;job.items[0].composition.lightDirection='右上方';job.items[0].variants=[{id:'base',composition:{lightQuality:'硬朗'}}];});
 assert.match(compile(root).items[0].prompt,/光照：右上方，硬朗/);
 const record=readObject(root,'cellgame','task','white-cell'),before=hash(record.config);
 assert.equal(taskObjectView(root,record).resolvedAsset.defaults.lightQuality,'柔和');assert.equal(hash(record.config),before);
 change(root,job=>delete job.asset.allowedOverrides.lightQuality);
 assert.match(taskObjectView(root,readObject(root,'cellgame','task','white-cell')).assetError,/成对/);
}));

test('editing accepts text without a core and request adapters retain complete positive and negative requirements',()=>fixture(root=>{
 const editFile=join(root,'projects/cellgame/tasks/edit-white-background/task.json'),record=readJson(editFile);
 writeFileSync(join(root,'source.png'),'fixture');record.config.core=null;record.config.items[0].source='source.png';record.config.items[0].textSpecs=[spec];writeJson(editFile,record);
 const edit=compileEdit({root,projectId:'cellgame',jobId:record.id});
 assert.equal(edit.compilerVersion,4);assert.equal(edit.items[0].negativeBlock,'文字扭曲, 笔画错乱, 模糊小字');
 const native=compileRemoteRequest({...edit,execution:{...edit.execution,model:'qwen-image-3.0-pro'}},edit.items[0]);
 assert.match(native.prompt,/开始游戏/);assert.equal(native.negativePrompt,edit.items[0].negativeBlock);
 const merged=compileRemoteRequest({...edit,execution:{...edit.execution,model:'wan2.7-image'}},edit.items[0]);
 assert.match(merged.prompt,/开始游戏/);assert.match(merged.prompt,/文字扭曲/);assert.equal(merged.negativePrompt,'');
 const bound=bindBackend(edit,local),request=buildComfyRequest(bound,bound.items[0]);
 const binding=bound.backend.bindings.negativePrompt;
 assert.equal(request.prompt[binding.node].inputs[binding.input],edit.items[0].negativeBlock);
 delete record.config.items[0].textSpecs;writeJson(editFile,record);
 assert.equal(compileEdit({root,projectId:'cellgame',jobId:record.id}).items[0].negativeBlock,'');
}));

test('legacy plans and new plans retain version presence and hashes through backend rebinding',()=>{
 const legacy=readJson(new URL('./fixtures/compiler-legacy-plan.json',import.meta.url));validatePlan(legacy);
 const bound=bindBackend(legacy,local);assert.equal(Object.hasOwn(bound,'compilerVersion'),false);validatePlan(bound);
 assert.equal(bindBackend(bound,local).planHash,bound.planHash);
 const next={...legacy,compilerVersion:4};delete next.planHash;next.planHash=hash(next);
 const modern=bindBackend(next,local);assert.equal(modern.compilerVersion,4);assert.equal(bindBackend(modern,local).planHash,modern.planHash);
 modern.compilerVersion=3;assert.throws(()=>validatePlan(modern),/计划已改变/);
});
