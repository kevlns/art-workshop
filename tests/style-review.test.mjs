import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createObject,readObject,deriveObject,updateObject,styleView,objectFile} from '../lib/workspace.mjs';
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
test('historical unresolved reports never block direct saved rules or overwrite evidence',()=>fixture(async(root,settings,record)=>{
 const saved=await updateObject(settings,'cellgame','style',record.id,record.revision,{config:{...record.config,...EXAMPLE_CONFIG}});
 assert.deepEqual(saved.report.data,record.report.data);assert.equal(saved.report.sourceHash,record.report.sourceHash);
 assert.deepEqual(loadCore('cellgame',saved.id,root).config.rules,EXAMPLE_CONFIG.rules);
 await assert.rejects(updateObject(settings,'cellgame','style',saved.id,record.revision,{name:'stale'}),/版本/);
 const report=structuredClone(record.report.data);report.decisions=[{issueId:'shadow-choice',optionId:'flexible',fingerprint:'fake',note:'fake',decidedAt:'today'}];
 assert.throws(()=>validateReport(report,'cellgame'),/不匹配/);
}));
