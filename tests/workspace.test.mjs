import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createObject,readObject,importReference,deriveObject,updateObject,discardObject,objectDirectory,taskDisplayState} from '../lib/workspace.mjs';
import {writeJson,readJson} from '../lib/shared.mjs';
import {runtimeRoot,taskFile} from '../lib/runtime.mjs';
import {compileGenerate} from '../lib/generate.mjs';
import {assertPlanCurrent} from '../lib/workspace.mjs';
import {executePlan} from '../lib/executor.mjs';
import {candidates,finalize,deleteCandidate,editFromCandidate} from '../lib/candidates.mjs';
import sharp from 'sharp';
import {updateReference} from '../lib/workspace.mjs';
import {jobTemplate} from '../lib/templates.mjs';
const png=await sharp({create:{width:1,height:1,channels:3,background:'#00ffaa'}}).png().toBuffer();
test('工具权威模板绑定真实核心且不限定主体题材，填写后可编译且未创建对象',()=>fixture(async(root,settings)=>{
 const existing=readObject(root,'cellgame','task','skills'),config=jobTemplate(root,'cellgame',{core:existing.config.core});
 config.items[0].intent='一个圆润的游戏单位';config.items[0].entities[0].appearance='圆润的主体';config.items[0].mustRead=['主体清楚'];
 const created=await createObject(settings,'cellgame','task',{name:'from template',config});
 const plan=compileGenerate({projectId:'cellgame',jobId:created.id,root});assert.equal(plan.items.length,1);
 assert.deepEqual(jobTemplate(root,'cellgame',{kind:'edit'}).items[0].changes,[]);
 assert.throws(()=>jobTemplate(root,'cellgame',{}),/冻结核心/);
}));
test('编辑任务保留私有底图时仍保存工作区相对路径，不复制底图或改写配置',()=>fixture(async(root,settings)=>{
 const original=join(root,'source.png');writeFileSync(original,png);
 const config=jobTemplate(root,'cellgame',{kind:'edit'});config.items[0].source=original;
 const created=await createObject(settings,'cellgame','task',{name:'edit',config});
 const next=structuredClone(created.config);next.items[0].source=join(root,next.items[0].source);
 const updated=await updateObject(settings,'cellgame','task',created.id,created.revision,{config:next});
 assert.equal(updated.config.items[0].source,created.config.items[0].source);assert.equal(updated.revision,created.revision);
}));
test('reference edits preserve original evidence and enforce static and dynamic responsibilities',()=>fixture(async(root,settings)=>{
 const original=join(root,'reference.png');writeFileSync(original,png);
 const style=await createObject(settings,'cellgame','style',{name:'editable',config:{description:'round'}});
 const imported=await importReference(settings,'cellgame','style',style.id,1,{source:original,category:'rendering'});
 const prior=join(objectDirectory(root,'cellgame','style',style.id),imported.references[0].path);
 const changed=await updateReference(settings,'cellgame','style',style.id,imported.revision,imported.references[0].id,{category:'palette',note:'只观察配色',ignore:'忽略主体'});
 assert.equal(changed.references[0].category,'palette');assert.ok(existsSync(prior));assert.deepEqual(readFileSync(original),png);
 await assert.rejects(updateReference(settings,'cellgame','style',style.id,changed.revision,changed.references[0].id,{purposes:['subject']}),/任务用途/);
 const task=readObject(root,'cellgame','task','skills');const added=await importReference(settings,'cellgame','task','skills',task.revision,{source:original,purposes:['subject']});
 const multi=await updateReference(settings,'cellgame','task','skills',added.revision,added.references[0].id,{purposes:['subject','pose','subject']});assert.deepEqual(multi.references[0].purposes,['subject','pose']);
 await assert.rejects(updateReference(settings,'cellgame','task','skills',added.revision,added.references[0].id,{note:'lost'}),/版本冲突/);
 await assert.rejects(updateReference(settings,'cellgame','task','skills',multi.revision,added.references[0].id,{category:'rendering'}),/静态/);
}));
async function fixture(fn){const root=mkdtempSync(join(tmpdir(),'art-objects-'));cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});const settings={file:join(root,'config.json'),paths:{workspace:root,output:join(root,'output')}};try{await fn(root,settings);}finally{rmSync(root,{recursive:true,force:true});}}
test('revision conflict cannot overwrite an edit; stale plans cannot run',()=>fixture(async(root,settings)=>{
 const before=readObject(root,'cellgame','task','skills'),plan=compileGenerate({projectId:'cellgame',jobId:'skills',root});
 await updateObject(settings,'cellgame','task','skills',before.revision,{name:'new name'});
 await assert.rejects(updateObject(settings,'cellgame','task','skills',before.revision,{name:'lost edit'}),/版本冲突/);
 assert.throws(()=>assertPlanCurrent(plan,settings),/重新编译/);
 assert.equal(readObject(root,'cellgame','task','skills').name,'new name');
}));
test('inline asset specifications compile without a shared profile and remain immutable plan sources',()=>fixture(async(root,settings)=>{
 const record=readObject(root,'cellgame','task','skills');
 record.config.asset=readJson(join(root,'projects/cellgame/profiles',record.config.profile+'.json'));
 record.config.asset.id='private-canvas';record.config.asset.design={resolution:{width:512,height:512},outputScale:2};delete record.config.profile;
 writeJson(join(objectDirectory(root,'cellgame','task','skills'),'task.json'),record);
 const plan=compileGenerate({projectId:'cellgame',jobId:'skills',root});assert.equal(plan.snapshots.profile.id,'private-canvas');assert.equal(plan.items[0].execution.size,'1024*1024');
 assertPlanCurrent(plan,settings);
 record.config.profile='skill-icon';writeJson(join(objectDirectory(root,'cellgame','task','skills'),'task.json'),record);
 assert.throws(()=>compileGenerate({projectId:'cellgame',jobId:'skills',root}),/规格/);
 delete record.config.profile;record.config.asset.design.outputScale=1;writeJson(join(objectDirectory(root,'cellgame','task','skills'),'task.json'),record);
 assert.throws(()=>assertPlanCurrent(plan,settings),/来源/);
}));
test('worker loss and remote cancellation block edit, derivation and cleanup',()=>fixture(async(root,settings)=>{
 const task=readObject(root,'cellgame','task','skills');writeJson(taskFile(runtimeRoot(settings),'task-unknown'),{schema:'art-workshop/task',taskId:'task-unknown',status:'cancelled',stopConfirmed:false,remoteCancellation:'unconfirmed',plan:{project:'cellgame',job:'skills'}});
 for(const operation of [()=>updateObject(settings,'cellgame','task','skills',task.revision,{name:'bad'}),()=>deriveObject(settings,'cellgame','task','skills',task.revision),()=>discardObject(settings,'cellgame','task','skills',task.revision)])await assert.rejects(operation(),/停止|执行/);
 assert.equal(readObject(root,'cellgame','task','skills').revision,task.revision);
 assert.equal(taskDisplayState(task,[{status:'cancelled',stopConfirmed:false,remoteCancellation:'unknown',plan:{project:'cellgame',job:'skills'}}]).status,'执行中');
}));
test('style derivation owns image copies; discard preserves source and sibling',()=>fixture(async(root,settings)=>{
 const original=join(root,'original.png');writeFileSync(original,png);
 const style=await createObject(settings,'cellgame','style',{name:'test',config:{description:'round'}});
 const imported=await importReference(settings,'cellgame','style',style.id,1,{source:original,category:'rendering'});
 const derived=await deriveObject(settings,'cellgame','style',style.id,imported.revision);
 await discardObject(settings,'cellgame','style',style.id,imported.revision);
 assert.equal(existsSync(join(objectDirectory(root,'cellgame','style',style.id),'refs')),false);
 assert.deepEqual(readFileSync(original),png);assert.deepEqual(readFileSync(join(objectDirectory(root,'cellgame','style',derived.id),derived.references[0].path)),png);
 assert.equal(derived.report,null);assert.equal(derived.status,'draft');
 await assert.rejects(updateObject(settings,'cellgame','style',style.id,3,{name:'revive'}),/放弃/);
}));
test('finalization is idempotent; replacement requires confirmation; deletion clears selection',()=>fixture(async(root,settings)=>{
 const output=await sharp(png).resize(1024,1024).png().toBuffer();
 const plan=compileGenerate({projectId:'cellgame',jobId:'skills',root});const run=executePlan(plan,[plan.items[0]],{outputRoot:settings.paths.output,log:()=>{},runner:args=>{writeFileSync(join(args[args.indexOf('--out-dir')+1],'image.png'),output);return {};}});
 writeJson(taskFile(runtimeRoot(settings),'task-one'),{schema:'art-workshop/task',taskId:'task-one',status:'succeeded',stopConfirmed:true,plan,manifestPath:run.manifestPath});
 const candidate=candidates(settings,'cellgame','skills','task-one')[0];
 const edit=await editFromCandidate(settings,'cellgame','skills',{runId:'task-one',candidateId:candidate.candidateId});assert.equal(edit.status,'draft');assert.equal(edit.config.kind,'edit');assert.deepEqual(readFileSync(join(root,edit.config.items[0].source)),output);assert.equal(edit.source.candidateId,candidate.candidateId);assert.equal(edit.finalizations,undefined);
 const first=await finalize(settings,'cellgame','skills',1,{runId:'task-one',candidateId:candidate.candidateId,actor:'tester'});
 const repeated=await finalize(settings,'cellgame','skills',first.revision,{runId:'task-one',candidateId:candidate.candidateId,actor:'tester'});assert.equal(repeated.revision,first.revision);
 await assert.rejects(deleteCandidate(settings,'cellgame','skills',first.revision,{runId:'task-one',candidateId:candidate.candidateId,actor:'tester'}),/确认/);
 const deleted=await deleteCandidate(settings,'cellgame','skills',first.revision,{runId:'task-one',candidateId:candidate.candidateId,actor:'tester',confirm:true});assert.equal(deleted.finalizations.length,0);assert.equal(existsSync(candidate.path),false);assert.equal(deleted.finalizationHistory.length,1);assert.equal(deleted.deletedCandidates[0].cleanup,'completed');
 assert.deepEqual(readFileSync(join(root,edit.config.items[0].source)),output);
 const repeatedDelete=await deleteCandidate(settings,'cellgame','skills',deleted.revision,{runId:'task-one',candidateId:candidate.candidateId,actor:'tester',confirm:true});assert.equal(repeatedDelete.revision,deleted.revision);
 await assert.rejects(finalize(settings,'cellgame','skills',deleted.revision,{runId:'task-one',candidateId:candidate.candidateId,actor:'tester'}),/完整性|删除/);
}));
