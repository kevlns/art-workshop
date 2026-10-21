import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateTaskDraft,taskContract} from '../lib/task-contract.mjs';
test('sampling parameters validate numbers, reject unknown fields and cannot leak into remote jobs',()=>{
 const config=options=>({kind:'edit',generation:{backend:'local-qwen',options},items:[]});
 assert.doesNotThrow(()=>validateTaskDraft(config({cfg:0,steps:25,sampler:'euler',scheduler:'simple'})));
 for(const options of [{cfg:-1},{cfg:101},{cfg:'3'},{steps:1.5},{steps:0},{sampler:''},{scheduler:''},{unsupported:1}])assert.throws(()=>validateTaskDraft(config(options)));
 assert.throws(()=>validateTaskDraft({kind:'edit',generation:{backend:'bailian',options:{cfg:3}}}),/远程后端/);
 assert.ok(taskContract('edit').models.generation.includes('options'));
});
import {createObject,updateObject,objectFile} from '../lib/workspace.mjs';

test('draft and compiler share effect fields, incomplete drafts remain editable',async()=>{
 const root=mkdtempSync(join(tmpdir(),'art-task-contract-'));
 cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 const settings={paths:{workspace:root}};
 try{
  const config={kind:'generate',items:[{id:'gem',intent:'',entities:[],effects:[]}]};
  const record=await createObject(settings,'cellgame','task',{name:'draft',config});
  const file=objectFile(root,'cellgame','task',record.id),original=readFileSync(file,'utf8');
  const bad={...record.config,items:[{...config.items[0],effects:[{description:'光束',target:'subject'}]}]};
  await assert.rejects(updateObject(settings,'cellgame','task',record.id,1,{config:bad}),/effects\[0\].*description/);
  assert.equal(readFileSync(file,'utf8'),original,'bad chat update must not replace user draft');
  const effect=taskContract('generate').effectExample;
  assert.doesNotThrow(()=>validateTaskDraft({...config,items:[{...config.items[0],effects:[effect]}]}));
  assert.throws(()=>validateTaskDraft({...config,items:[{...config.items[0],entities:[{invented:true}]}]}),/invented/);
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('long dynamic requirements survive save and generation compilation without truncation',async()=>{
 const {compileGenerate}=await import('../lib/generate.mjs');
 const {readObject}=await import('../lib/workspace.mjs');
 const {description,descriptions}=await import('../lib/shared.mjs');
 const {background}=await import('../lib/presentation.mjs');
 const root=mkdtempSync(join(tmpdir(),'art-long-requirement-'));
 cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
 try {
  const long='保留完整的轮廓转折与各处分面关系。'.repeat(200);
  const record=readObject(root,'cellgame','task','skills');
  const item=record.config.items[0];
  item.intent=long;item.mustRead=[long];
  for(const key of ['appearance','color','action'])item.entities[0][key]=long;
  for(const key of ['kind','color','relation'])item.effects[0][key]=long;
  const saved=await updateObject({paths:{workspace:root}},'cellgame','task','skills',record.revision,{config:record.config});
  assert.equal(saved.config.items[0].entities[0].appearance,long);
  const plan=compileGenerate({projectId:'cellgame',jobId:'skills',root});
  assert.ok(plan.items[0].prompt.includes(long));assert.equal(plan.items[0].brief.entities[0].appearance,long);
  assert.equal(description(long,'instruction'),long);descriptions([long],'mustRead');
  assert.ok(background({type:'scene',description:long},true).includes(long));
  assert.throws(()=>description('   ','appearance'),/非空文本/);
  assert.throws(()=>description(123,'appearance'),/非空文本/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
