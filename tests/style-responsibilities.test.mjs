import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {EXAMPLE_CONFIG,STYLE_CATEGORIES} from '../lib/style-contract.mjs';
import {validateCoreConfig,validateReport,loadCore} from '../lib/core.mjs';
import {readJson,writeJson,hash} from '../lib/shared.mjs';
import {compileGenerate} from '../lib/generate.mjs';
import {executePlan} from '../lib/executor.mjs';
import {validatePlan} from '../lib/plan.mjs';
import {analysisInput} from '../lib/style-lifecycle.mjs';
import {analyzeStyle} from '../lib/analyze.mjs';
import {readObject,styleView,deriveObject,importReference,updateReference,assertPlanCurrent} from '../lib/workspace.mjs';

async function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'art-style-boundary-'));
 cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 const settings={file:join(root,'config.json'),paths:{workspace:root,output:join(root,'output'),cache:join(root,'cache')}};
 try{return await run(root,settings);}finally{rmSync(root,{recursive:true,force:true});}
}
test('style rejects concrete shapes, light positions, subject lists and physical materials',()=>{
 for(const [key,value] of Object.entries({shape:{contour:'rounded'},lighting:{direction:'left'},domains:{robot:{signature:'giant head'}}}))
  assert.throws(()=>validateCoreConfig({...structuredClone(EXAMPLE_CONFIG),[key]:value}),/字段/);
 for(const [key,value] of Object.entries({finish:'glossy',texture:'none'})){
  const config=structuredClone(EXAMPLE_CONFIG);config.rules[0][key]=value;assert.throws(()=>validateCoreConfig(config),/字段/);
 }
 assert.deepEqual(STYLE_CATEGORIES,['style','palette','rendering']);
});
test('real CLI style read and update return current compatibility without changing frozen evidence',()=>fixture(root=>{
 const entry=fileURLToPath(new URL('../art-workshop.mjs',import.meta.url));
 const call=args=>spawnSync(process.execPath,[entry,...args,'--workspace',root,'--project','cellgame'],{encoding:'utf8'});
 const read=call(['style','read','--id','cellgame']);assert.equal(read.status,0,read.stdout+read.stderr);assert.equal(JSON.parse(read.stdout).compatibility.usable,true);
 const payload=join(root,'draft.json');writeJson(payload,{name:'新的绘制风格',config:{description:'仅观察绘制表现',constraints:[]}});
 const created=call(['style','create','--input',payload]);assert.equal(created.status,0,created.stdout+created.stderr);
 const draft=JSON.parse(created.stdout);writeJson(payload,{name:'修改后的名称'});
 const updated=call(['style','update','--id',draft.id,'--revision',String(draft.revision),'--input',payload]);assert.equal(updated.status,0,updated.stdout+updated.stderr);assert.equal(JSON.parse(updated.stdout).name,'修改后的名称');
}));
test('one style permits new subjects with different silhouettes, materials and light directions',()=>fixture(root=>{
 const file=join(root,'projects/cellgame/tasks/white-cell/task.json'),record=readJson(file);
 const source=record.config.items[0];
 source.entities=[{id:'new-object',kind:'unregistered-robot',appearance:'三角头、六条腿，透明玻璃外壳，左侧光源',color:'红色身份色',role:'primary',count:1}];
 source.effects=[];source.relations=[];source.composition.focalTarget='new-object';
 writeJson(file,record);
 let plan=compileGenerate({projectId:'cellgame',jobId:'white-cell',root});
 assert.match(plan.items[0].prompt,/三角头、六条腿，透明玻璃外壳，左侧光源/);
 source.entities[0].appearance='圆形头、两条腿，粗糙岩石表面，右侧光源';writeJson(file,record);
 const next=compileGenerate({projectId:'cellgame',jobId:'white-cell',root});
 assert.match(next.items[0].prompt,/圆形头、两条腿，粗糙岩石表面，右侧光源/);
 assert.equal(plan.sources.coreHash,next.sources.coreHash);
 assert.doesNotMatch(next.items[0].negativeBlock,/表面纹理|繁复细节|写实反射/);
}));
test('old frozen contracts remain inspectable but cannot be adopted or executed',()=>fixture((root,settings)=>{
 const directory=join(root,'projects/cellgame/styles/cellgame'),file=join(directory,'core.json');
 const current=compileGenerate({projectId:'cellgame',jobId:'white-cell',root});
 const core=readJson(file);delete core.schemaVersion;delete core.coreHash;core.coreHash=hash(core);writeJson(file,core);
 const original=readFileSync(file,'utf8');
 const view=styleView(root,readObject(root,'cellgame','style','cellgame'));
 assert.equal(view.compatibility.usable,false);
 assert.match(view.compatibility.reasons.join(''),/派生/);
 assert.throws(()=>loadCore('cellgame','cellgame',root),/重新分析/);
 const old=readJson(join(root,'projects/cellgame/reports/cellgame.json'));delete old.schemaVersion;
 assert.throws(()=>validateReport(old,'cellgame'),/重新分析/);
 const historical=structuredClone(current);delete historical.snapshots.core.schemaVersion;delete historical.planHash;historical.planHash=hash(historical);
 assert.doesNotThrow(()=>validatePlan(historical),'history still verifies its original hash');
 assert.throws(()=>executePlan(historical,historical.items,{dry:true}),/旧风格计划/);
 assert.throws(()=>assertPlanCurrent(current,settings),/旧风格核心/);
 assert.equal(readFileSync(file,'utf8'),original);
}));
test('removed shape references stay visible and require explicit mapping on an independent draft',()=>fixture(async(root,settings)=>{
 const source=join(root,'source.png');await sharp({create:{width:8,height:8,channels:4,background:'#c80'}}).png().toFile(source);
 const derived=await deriveObject(settings,'cellgame','style','cellgame',1);
 let draft=await importReference(settings,'cellgame','style',derived.id,1,{source,category:'rendering'});
 const file=join(root,'projects/cellgame/styles',draft.id,'style.json');draft.references[0].category='shape-language';writeJson(file,draft);
 const original=readFileSync(join(root,'projects/cellgame/styles/cellgame/core.json'),'utf8');
 assert.deepEqual(styleView(root,draft).compatibility.pendingReferences,[draft.references[0].id]);
 assert.throws(()=>analysisInput(settings,draft),/明确重新分类|先明确重新分类/);
 const mapped=await updateReference(settings,'cellgame','style',draft.id,draft.revision,draft.references[0].id,{category:'rendering',note:'只看绘画笔触，不继承轮廓'});
 assert.equal(styleView(root,mapped).compatibility.usable,true);
 const preview=await analyzeStyle({projectId:'cellgame',input:analysisInput(settings,mapped),root,refsDir:root,dry:true});
 assert.match(JSON.stringify(preview.requests),/具体主体|轮廓/);
 assert.equal(readFileSync(join(root,'projects/cellgame/styles/cellgame/core.json'),'utf8'),original);
 assert.deepEqual(readFileSync(source),readFileSync(join(root,'projects/cellgame/styles',mapped.id,mapped.references[0].path)));
}));
