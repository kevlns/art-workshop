import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createObject,readObject,deriveObject,updateObject,styleView,objectFile} from '../lib/workspace.mjs';
import {resolveStyleIssue,adoptStyle} from '../lib/style-lifecycle.mjs';
import {validateReport,corePrompt,loadCore} from '../lib/core.mjs';
import {EXAMPLE_CONFIG} from '../lib/style-contract.mjs';
import {styleSourceHash,resolvedRecommendation} from '../lib/style-review.mjs';
import {writeJson} from '../lib/shared.mjs';

const rule={id:'shadow',scope:'palette',strength:'default',instruction:'默认冷影，允许同色相压暗',when:''};
const issue=(id='shadow-choice')=>({id,question:'阴影要统一偏冷，还是允许按主体调整？',reopenReason:'',options:[{id:'flexible',label:'按主体调整',remove:[],upsert:[rule]},{id:'strict',label:'统一冷影',remove:[],upsert:[{...rule,strength:'required',instruction:'所有阴影偏冷'}]}]});
async function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'art-review-'));cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 const settings={file:join(root,'config.json'),paths:{workspace:root,output:join(root,'output'),cache:join(root,'cache')}};
 try{const record=await createObject(settings,'cellgame','style',{name:'review',config:{description:'可复用绘制风格'}});
 record.report={runId:'original',sourceHash:styleSourceHash(record),sourceRevision:record.revision,data:{schema:'art-workshop/style-report',schemaVersion:3,project:'cellgame',id:record.id,summary:'风格方案',observations:[],recommendation:structuredClone(EXAMPLE_CONFIG),issues:[issue()],notes:['参考分辨率低，不推测精确色值'],decisions:[]}};
 writeJson(objectFile(root,'cellgame','style',record.id),record);await fn(root,settings,record);
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('explicit decision converges without another model request; adoption retains conditions and evidence',()=>fixture(async(root,settings,record)=>{
 await assert.rejects(adoptStyle(settings,'cellgame',record.id,1),/待决定/);
 const decided=await resolveStyleIssue(settings,'cellgame',record.id,1,{issueId:'shadow-choice',optionId:'flexible',note:'用户选择按主体调整'});
 assert.equal(styleView(root,decided).review.ready,true);assert.equal(decided.report.data.notes.length,1);
 const frozen=await adoptStyle(settings,'cellgame',record.id,decided.revision);assert.equal(frozen.status,'frozen');
 const core=loadCore('cellgame',record.id,root);assert.match(corePrompt(core),/默认冷影，允许同色相压暗/);assert.match(corePrompt(core),/任务指定透明或发光物体时/);
 assert.equal(core.report.decisions[0].note,'用户选择按主体调整');
 const derived=await deriveObject(settings,'cellgame','style',record.id,frozen.revision);assert.match(JSON.stringify(derived.config.rules),/阴影|冷影/);assert.equal(derived.report.data.provenance.method,'inherited-frozen');
 await assert.rejects(resolveStyleIssue(settings,'cellgame',record.id,frozen.revision,{issueId:'shadow-choice',optionId:'strict',note:'change'}),/只读/);
}));
test('changing the draft preserves evidence and decisions but prevents adopting or deciding on stale report',()=>fixture(async(root,settings,record)=>{
 const decided=await resolveStyleIssue(settings,'cellgame',record.id,1,{issueId:'shadow-choice',optionId:'flexible',note:'用户确认'});
 const changed=await updateObject(settings,'cellgame','style',record.id,decided.revision,{config:{description:'修改需求'}});
 assert.deepEqual(changed.report.data,decided.report.data);assert.equal(changed.report.sourceHash,decided.report.sourceHash);assert.equal(styleView(root,changed).review.stale,true);
 await assert.rejects(adoptStyle(settings,'cellgame',record.id,changed.revision),/过期/);
 await assert.rejects(resolveStyleIssue(settings,'cellgame',record.id,changed.revision,{issueId:'shadow-choice',optionId:'strict',note:'用户确认'}),/复核/);
}));
test('old revisions and nonexistent options cannot silently mutate the draft',()=>fixture(async(root,settings,record)=>{
 const bytes=readFileSync(objectFile(root,'cellgame','style',record.id));
 await assert.rejects(resolveStyleIssue(settings,'cellgame',record.id,8,{issueId:'shadow-choice',optionId:'flexible',note:'yes'}),/版本/);
 await assert.rejects(resolveStyleIssue(settings,'cellgame',record.id,1,{issueId:'shadow-choice',optionId:'missing',note:'yes'}),/不存在/);
 assert.deepEqual(readFileSync(objectFile(root,'cellgame','style',record.id)),bytes);
}));
test('overlapping choices reopen superseded decisions instead of silently composing contradictions',()=>fixture(async(root,settings,record)=>{
 record.report.data.issues.push(issue('another-shadow'));writeJson(objectFile(root,'cellgame','style',record.id),record);
 const first=await resolveStyleIssue(settings,'cellgame',record.id,1,{issueId:'shadow-choice',optionId:'flexible',note:'用户确认'});
 const second=await resolveStyleIssue(settings,'cellgame',record.id,first.revision,{issueId:'another-shadow',optionId:'strict',note:'用户改选'});
 assert.deepEqual(styleView(root,second).review.openIssues,['shadow-choice']);assert.equal(second.reviewHistory.length,2);
 assert.equal(resolvedRecommendation(second.report.data).rules.find(r=>r.id==='shadow').strength,'required');
}));
test('report rejects forged decisions and preserves conditional exclusions',()=>fixture(async(root,settings,record)=>{
 const report=record.report.data;report.decisions=[{issueId:'shadow-choice',optionId:'flexible',fingerprint:'fake',note:'fake',decidedAt:'today'}];
 assert.throws(()=>validateReport(report,'cellgame'),/不匹配/);
 const config={rules:[{...rule,strength:'avoid',instruction:'额外发光',when:'不透明物体'}]};
 assert.match(corePrompt({config}),/不透明物体/);
}));
