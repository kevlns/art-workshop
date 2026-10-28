import {description,descriptions} from './shared.mjs';
import {generationPrompt,COMPILER_VERSION} from './prompt-structure.mjs';
import {TRANSPARENT_OUTPUT} from './transparent-output.mjs';
import {GENERATION_FIELDS,textSpecs,textSpecLine,textFidelityNegative} from './task-contract.mjs';
import {taskReferencePrompt} from './task-references.mjs';
import {readObject,verifyReferences} from './workspace.mjs';
import { keys, id, integer, hash } from './shared.mjs';
import { ROOT,loadProject,loadJob } from './project.mjs';
import {selectCore,corePrompt,coreNegative} from './core.mjs';
import {execution,finishPlan} from './plan.mjs';
import {presentation,assetPrompt} from './presentation.mjs';
import {resolveAssetProfile} from './asset-profile.mjs';
import {design,designPrompt} from './design.mjs';
export function compileGenerate({projectId,jobId,coreId,root=ROOT,localExecution={}}) {
  const taskRecord=readObject(root,projectId,'task',jobId);const dynamicRefs=verifyReferences(root,taskRecord);
  const project=loadProject(projectId,root),job=loadJob(projectId,jobId,'generate',root);
  keys(job,['project','kind','core','profile','asset','execution','analysis','generation','items'],'job');
  if(job.generation&&localExecution.model)job.execution={...job.execution,model:localExecution.model};
  const selected=selectCore(project,job,coreId,root),core=selected.core;
  const profile=resolveAssetProfile(root,projectId,job);
  const items=[],ids=new Set();
  if(!Array.isArray(job.items)||!job.items.length) throw new Error('任务 items 必须非空');
  for(const [sourceIndex,source] of job.items.entries()) {
    keys(source,GENERATION_FIELDS.item,'item');
    const readable=textSpecs(source.textSpecs,`items[${sourceIndex}].textSpecs`);
    if(readable.length&&profile.constraints.text!==true)throw new Error(`items[${sourceIndex}].textSpecs：资产规格禁用文字`);
    const d=design(profile,source.design,job.execution);
    id(source.id); if(ids.has(source.id)) throw new Error('item ID 重复'); ids.add(source.id);
    description(source.intent,'intent'); descriptions(source.mustRead,'mustRead');
    if(!Array.isArray(source.entities)||!source.entities.length) throw new Error('entities 必须非空');
    const objectIds=new Set(), lines=[];
    for(const [entityIndex,e] of source.entities.entries()) {
      keys(e,GENERATION_FIELDS.entity,'entity'); id(e.id); id(e.kind);
      if(objectIds.has(e.id)) throw new Error('实体 ID 重复'); objectIds.add(e.id);
      if(!['primary','support'].includes(e.role)) throw new Error('实体角色不合法');
      integer(e.count,'count',1,100); description(e.appearance,'appearance');description(e.color,'color'); if(e.action) description(e.action,'action');
      if(e.material!==undefined)description(e.material,`items[${sourceIndex}].entities[${entityIndex}].material`);
      lines.push(`${e.id}：${e.count} 个${e.appearance}${e.material!==undefined?'，材质 '+e.material:''}，${e.color}，${e.role==='primary'?'主要':'辅助'}实体${e.action?'，'+e.action:''}。`);
    }
    for(const e of source.effects??[]) {
      keys(e,GENERATION_FIELDS.effect,'effect');id(e.id);
      if(objectIds.has(e.id)||!source.entities.some(x=>x.id===e.target)) throw new Error('效果 ID 重复或目标不存在'); objectIds.add(e.id);
      for(const k of ['kind','color','relation']) description(e[k],k); integer(e.count,'count',1,100);
      lines.push(`${e.id}：${e.count} 个${e.color}${e.kind}，作用于 ${e.target}；${e.relation}。`);
    }
    for(const r of source.relations??[]) {keys(r,GENERATION_FIELDS.relation,'relation'); if(!objectIds.has(r.from)||!objectIds.has(r.to)) throw new Error('关系目标不存在');lines.push(`${r.from} → ${r.to}：${description(r.action,'action')}。`);}
    const variants=source.variants?.length?source.variants:[{id:'base'}],variantIds=new Set();
    for(const variant of variants) {
      keys(variant,GENERATION_FIELDS.variant,'variant');id(variant.id); if(variantIds.has(variant.id)) throw new Error('variant ID 重复');variantIds.add(variant.id);
      const p=presentation(profile,{...source.composition,...variant.composition},d);
      if(!objectIds.has(p.value.focalTarget)) throw new Error('视觉焦点不存在');
      const seed=variant.seed??source.seed??parseInt(hash([projectId,jobId,source.id]).slice(0,7),16); integer(seed,'seed');
      items.push({...(p.value.background.type==='transparent'?{output:TRANSPARENT_OUTPUT}:{}),...(d?{design:d,execution:execution(project,{...job.execution,size:`${d.outputSize.width}*${d.outputSize.height}`},localExecution)}:{}),itemId:source.id,variantId:variant.id,seed,brief:{...source,composition:p.value},prompt:generationPrompt({intent:source.intent,frozen:corePrompt(core),details:lines,composition:`视觉焦点：${p.value.focalTarget}。\n${p.prompt}`,delivery:d?designPrompt(d):'',asset:assetPrompt(profile),references:taskReferencePrompt(taskRecord,source.id),mustRead:source.mustRead,textSpecs:readable}),negativeBlock:textFidelityNegative([coreNegative(core),profile.constraints.text?'':'文字, 字母, 水印',profile.constraints.frame?'':'装饰外框'].filter(Boolean).join(', '),readable),imageArgs:[],checks:{content:readable.length?[...source.mustRead,...readable.map(textSpecLine)]:source.mustRead,style:[corePrompt(core)],asset:[...profile.checks,p.background]}});
    }
  }
  return finishPlan({compilerVersion:COMPILER_VERSION,module:'generate',project:projectId,job:jobId,execution:execution(project,job.execution,localExecution),sources:{taskRevision:taskRecord.revision,taskConfigHash:hash(taskRecord.config),core:core.id,coreHash:core.coreHash,selection:selected.source},snapshots:{project,core,profile,job},refs:dynamicRefs.map(r=>({path:r.path,hash:r.hash})),items});
}
