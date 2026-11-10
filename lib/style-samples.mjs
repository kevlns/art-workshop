import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {id,keys,text,integer} from './shared.mjs';
import {hasStyleContent,styleContractHash} from './style-contract.mjs';
import {createHash} from 'node:crypto';
import {readObject,objectDirectory,ownedPath,mutateObject,createObject,assertObjectCurrent} from './workspace.mjs';
import {loadCore} from './core.mjs';
import {jobTemplate} from './templates.mjs';
import {candidates} from './candidates.mjs';
import {tasks,runtimeRoot,locked} from './runtime.mjs';
import {validateImage} from './images.mjs';
import {sha256File} from './bl.mjs';

export const styleRulesHash=core=>styleContractHash(core.config);

/** Original analysis references never enter generation. Only independently copied, approved samples do. */
export function styleSampleInputs(root,projectId,core,mode='approved'){
 if(!['approved','text-only'].includes(mode))throw new Error('styleReferenceMode 必须为 approved 或 text-only');
 const all=core?.approvedSamples??[],rulesHash=core?styleRulesHash(core):null;
 const current=all.filter(sample=>sample.rulesHash===rulesHash),staleCount=all.length-current.length;
 const selection={mode,status:mode==='text-only'?'text-only':current.length?'approved':'no-samples',rulesHash,staleCount,samples:[]};
 if(mode==='text-only'||!core)return {selection,refs:[],prompt:''};
 if(all.length&&!current.length)throw new Error('风格规则已更新，运行时参考均待复核；请重新打样并定版，或明确选择 text-only 仅规则生成');
 const directory=objectDirectory(root,projectId,'style',core.id);
 const refs=current.map(sample=>{
  const path=ownedPath(directory,sample.path);
  if(!existsSync(path)||sha256File(path)!==sample.hash)throw new Error('运行时参考缺失或已改变：'+sample.id);
  selection.samples.push({id:sample.id,hash:sample.hash,rulesHash:sample.rulesHash,note:sample.note??''});
  return {path,hash:sample.hash};
 });
 return {selection,refs,prompt:refs.length?'【定版样张：运行时风格参考】\n输入图片仅作为绘制语言的视觉参考。借鉴媒介、描边、明暗组织、笔触、刻画密度与色彩关系；不要沿用参考图片的具体主体、结构、身份色、姿态、构图、背景或画面文字。本次任务定义实际内容，规则中的明确要求与适用条件继续有效。\n'+current.map((s,i)=>`运行时参考 ${i+1}${s.note?'：'+s.note:''}`).join('\n'):''};
}

const STARTER_SUBJECTS=[
 {id:'stone',name:'石块',appearance:'一块中性灰不规则岩石，轮廓完整，具有几个清楚的大切面',intent:'验证体块和切面的描绘'},
 {id:'wood-box',name:'木箱',appearance:'一个暖棕色方形木箱，保留木板接缝与深灰金属包角',intent:'验证木材笔触和金属包角的明暗关系'},
 {id:'metal-pot',name:'金属壶',appearance:'一把带把手和壶嘴的低饱和蓝色金属壶，结构清楚，银色金属边缘',intent:'验证金属质感和高光控制'},
];

function sampleConfig(config, scheme, count) {
 keys(scheme,['subjects','width','height','generation'],'样张方案');
 const {subjects=STARTER_SUBJECTS,width=512,height=512,generation}=scheme;
 integer(width,'样张宽度',64,4096);
 integer(height,'样张高度',64,4096);
 if(!Array.isArray(subjects)||subjects.length<1||subjects.length>8)throw new Error('样张方案须包含 1～8 个主体');
 const seen=new Set();
 const template=config.items[0];
 config.asset.design.resolution={width,height};
 config.styleReferenceMode='text-only';
 config.execution={...config.execution,perValue:count};
 if(generation!==undefined)config.generation=structuredClone(generation);
 config.items=subjects.map((subject,index)=>{
  const label=`样张主体 ${index+1}`;
  keys(subject,['id','name','appearance','intent'],label);
  const subjectId=id(subject.id,`${label}身份`);
  if(seen.has(subjectId))throw new Error(`${label}身份重复`);
  seen.add(subjectId);
  const name=text(subject.name,`${label}名称`);
  const appearance=text(subject.appearance,`${label}外观`);
  const intent=text(subject.intent,`${label}验证目标`);
  const item=structuredClone(template);
  item.id=subjectId;
  item.intent=`主体：${name}。验证目标：${intent}`;
  item.mustRead=[intent];
  item.entities[0]={...item.entities[0],kind:subjectId,appearance};
  return item;
 });
 return {config,subjectNames:Object.fromEntries(subjects.map(({id,name})=>[id,name]))};
}

export async function createStyleSampleJob(settings,projectId,styleId,revision,{name,count=1,scheme={}}={}){
 integer(count,'count',1,4);
 return locked(runtimeRoot(settings),'control',async()=>{
  const root=settings.paths.workspace;
  const style=readObject(root,projectId,'style',styleId);
  assertObjectCurrent(root,style);
  if(style.revision!==revision)throw new Error('对象版本冲突，请重新读取');
  if(['discarded','cleanup-required'].includes(style.status))throw new Error('风格不可用于打样');
  if(style.status!=='frozen'||!style.coreHash)throw new Error('请先确认配置并编译风格契约');
  const core=loadCore(projectId,styleId,root);
  if(!hasStyleContent(core.config))throw new Error('风格契约缺少有效内容，请确认配置后再打样');
  const {config,subjectNames}=sampleConfig(jobTemplate(root,projectId,{core:styleId}),scheme,count);
  return createObject(settings,projectId,'task',{
   name:name?.trim()||style.name+' · 风格打样',
   config,
   source:{kind:'style-sample',styleId,revision:style.revision,count,subjectNames,rulesHash:styleRulesHash(core),coreHash:core.coreHash},
  });
 });
}

export async function selectStyleSample(settings,projectId,styleId,revision,{job,run,candidate,note=''}={}){
 if(typeof note!=='string'||note.length>2000)throw new Error('运行时参考说明须为2000字以内文本');
 let created;
 try{return await mutateObject(settings,projectId,'style',styleId,revision,async record=>{
  const core=loadCore(projectId,styleId,settings.paths.workspace),rulesHash=styleRulesHash(core);
  const execution=tasks(runtimeRoot(settings)).find(t=>t.taskId===run);
  if(execution?.plan?.project!==projectId||execution.plan.job!==job||execution.plan.sources.core!==styleId)throw new Error('候选必须来自使用当前风格的项目任务');
  if(styleRulesHash(execution.plan.snapshots.core)!==rulesHash)throw new Error('候选使用的风格规则已变化，请按当前规则重新打样');
  const chosen=candidates(settings,projectId,job,run).find(c=>c.candidateId===candidate&&c.accepted&&c.editable&&!c.deleted);
  if(!chosen)throw new Error('运行时参考必须是已停止批次中完整、有效的成功候选');
  const bytes=readFileSync(chosen.path),contentHash=createHash('sha256').update(bytes).digest('hex');
  if(contentHash!==chosen.hash)throw new Error('候选图片已改变，不能设为运行时参考');
  const image=await validateImage(bytes);
  record.samples??=[];
  const duplicates=record.samples.filter(sample=>sample.hash===contentHash),existing=duplicates.find(sample=>sample.rulesHash===rulesHash)??duplicates[0];
  if(existing){
    const file=ownedPath(objectDirectory(settings.paths.workspace,projectId,'style',styleId),existing.path);
    if(!existsSync(file)||sha256File(file)!==contentHash)throw new Error('保留的运行时参考缺失或已改变，不能覆盖历史参考');
    if(existing.rulesHash===rulesHash&&duplicates.length===1)return record;
    const updated=existing.rulesHash===rulesHash?existing:{...existing,rulesHash,jobId:job,runId:run,candidateId:candidate,itemId:chosen.itemId,note:note.trim()||existing.note||'',validatedAt:new Date().toISOString(),model:execution.plan.backend?.model??execution.plan.execution.model,backend:execution.plan.backend?.id??null};
    record.samples=record.samples.flatMap(sample=>sample.id===existing.id?[updated]:sample.hash===contentHash?[]:[sample]);
    return record;
  }
  if(record.samples.length>=12)throw new Error('运行时参考最多12张，请先移除不再使用的参考');
  const sampleId='sample-'+contentHash.slice(0,24);
  const path='samples/'+sampleId+'.'+(image.format==='jpeg'?'jpg':image.format),destination=ownedPath(objectDirectory(settings.paths.workspace,projectId,'style',styleId),path);
  mkdirSync(dirname(destination),{recursive:true});
  if(existsSync(destination)){if(sha256File(destination)!==contentHash)throw new Error('保留的运行时参考已改变，不能覆盖历史参考');}
  else {writeFileSync(destination,bytes,{flag:'wx'});created=destination;}
  record.samples.push({id:sampleId,path,hash:contentHash,rulesHash,jobId:job,runId:run,candidateId:candidate,itemId:chosen.itemId,note:note.trim(),createdAt:new Date().toISOString(),model:execution.plan.backend?.model??execution.plan.execution.model,backend:execution.plan.backend?.id??null});
  return record;
 });}catch(error){if(created)rmSync(created,{force:true});throw error;}
}

export async function removeStyleSample(settings,projectId,styleId,revision,sampleId){
 return mutateObject(settings,projectId,'style',styleId,revision,record=>{
  const selected=(record.samples??[]).find(sample=>sample.id===sampleId);
  if(!selected)throw new Error('运行时参考不存在');
  // Keep bytes for historical plans and running batches; removal changes future selection only.
  record.samples=record.samples.filter(sample=>sample.id!==sampleId&&(!selected.hash||sample.hash!==selected.hash));return record;
 });
}
