import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {deriveObject,updateObject,readObject,objectFile} from '../lib/workspace.mjs';
import {reviseStyleRules,adoptStyle,analysisInput} from '../lib/style-lifecycle.mjs';
import {corePrompt,loadCore} from '../lib/core.mjs';
import {writeJson,hash} from '../lib/shared.mjs';

async function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'art-structure-'));
 cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 const settings={paths:{workspace:root,output:join(root,'output'),cache:join(root,'cache')}};
 try{await fn(root,settings);}finally{rmSync(root,{recursive:true,force:true});}
}
test('compiler groups topics and preserves conditional exclusions once without changing frozen bytes',()=>fixture(root=>{
 const file=join(root,'projects/cellgame/styles/cellgame/core.json'),bytes=readFileSync(file);
 const core=loadCore('cellgame','cellgame',root);
 core.config.rules.push({id:'no-lines',scope:'outline',strength:'avoid',instruction:'内部黑色分隔线',when:'切面物体'});
 core.config.rules.push({...core.config.rules.at(-1),id:'duplicate'});
 const prompt=corePrompt(core);
 assert.equal(prompt.split('内部黑色分隔线').length-1,1);
 assert.match(prompt,/【描边】/);assert.match(prompt,/必须避免（切面物体）/);
 assert.deepEqual(readFileSync(file),bytes);
}));
test('derive and user rule revision retain evidence and adopted origin, with no model calls',()=>fixture(async(root,settings)=>{
 const file=join(root,'projects/cellgame/styles/cellgame/core.json'),bytes=readFileSync(file);
 const source=readObject(root,'cellgame','style','cellgame');
 const draft=await deriveObject(settings,'cellgame','style','cellgame',source.revision);
 assert.ok(draft.config.rules.length);assert.equal(draft.report.data.provenance.method,'inherited-frozen');
 assert.equal(analysisInput(settings,draft).rules.length,draft.config.rules.length);
 const rules=structuredClone(draft.config.rules);rules.push({id:'gentle-texture',scope:'brushwork',strength:'default',instruction:'默认减少绘画噪点，保留任务要求的纹理',when:''});
 const saved=await updateObject(settings,'cellgame','style',draft.id,draft.revision,{config:{...draft.config,description:'自由补充'.repeat(200),constraints:['保留用户补充'],rules}});
 const revised=await reviseStyleRules(settings,'cellgame',draft.id,saved.revision,{rules,summary:'切面绘制语言',note:'用户要求整理规则，保留已有意图'});
 assert.equal(revised.report.data.provenance.method,'user-rules');assert.equal(revised.reviewHistory.length,1);
 assert.equal(revised.config.description,saved.config.description);assert.deepEqual(revised.config.constraints,saved.config.constraints);
 assert.equal(revised.report.sourceHash,hash({config:revised.config,references:revised.references}));
 const repeated=await reviseStyleRules(settings,'cellgame',draft.id,revised.revision,{rules,summary:'切面绘制语言',note:'用户再次点击'});
 assert.equal(repeated.revision,revised.revision);
 const frozen=await adoptStyle(settings,'cellgame',draft.id,revised.revision);
 assert.equal(frozen.status,'frozen');assert.match(corePrompt(loadCore('cellgame',frozen.id,root)),/默认减少绘画噪点/);
 assert.deepEqual(readFileSync(file),bytes);
 await assert.rejects(reviseStyleRules(settings,'cellgame',frozen.id,frozen.revision,{rules,summary:'x',note:'x'}),/只读/);
}));
test('manual revision rejects changed evidence, unresolved decisions and stale revisions',()=>fixture(async(root,settings)=>{
 const source=readObject(root,'cellgame','style','cellgame');
 const draft=await deriveObject(settings,'cellgame','style','cellgame',source.revision);
 const input={rules:draft.config.rules,summary:'风格概述',note:'用户要求'};
 await assert.rejects(reviseStyleRules(settings,'cellgame',draft.id,999,input),/版本/);
 const options=[{id:'keep',label:'保持',remove:[],upsert:[]},{id:'change',label:'修改',remove:[],upsert:[]}];
 draft.report.data.issues=[{id:'pending',question:'两种绘制方式需要选择',reopenReason:'',options}];
 writeJson(objectFile(root,'cellgame','style',draft.id),draft);
 await assert.rejects(reviseStyleRules(settings,'cellgame',draft.id,draft.revision,input),/未确认/);
 draft.report.data.issues=[];
 draft.config.analysis={provider:'new-provider',model:'changed-model'};
 writeJson(objectFile(root,'cellgame','style',draft.id),draft);
 await assert.rejects(reviseStyleRules(settings,'cellgame',draft.id,draft.revision,input),/证据已变化/);
}));
test('real CLI revises rules without starting an analysis worker',()=>fixture(async(root,settings)=>{
 const source=readObject(root,'cellgame','style','cellgame');
 const draft=await deriveObject(settings,'cellgame','style','cellgame',source.revision);
 const file=join(root,'rules.json');writeJson(file,{rules:draft.config.rules,summary:'直接规则修订',note:'用户明确授权'});
 const result=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('../art-workshop.mjs',import.meta.url)),'style','revise','--workspace',root,'--output-dir',settings.paths.output,'--cache-dir',settings.paths.cache,'--project','cellgame','--id',draft.id,'--revision',String(draft.revision),'--input',file],{encoding:'utf8'}));
 assert.equal(result.review.ready,true);assert.equal(result.report.data.provenance.method,'user-rules');assert.equal(result.report.runId,null);
}));
