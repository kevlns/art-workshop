import { readJson, keys, id, text, texts, integer, hash } from './shared.mjs';
import { ROOT,loadProject,loadJob,projectPath } from './project.mjs';
import {selectCore,corePrompt,coreNegative} from './core.mjs';
import {execution,finishPlan} from './plan.mjs';
import {presentation,assetPrompt} from './presentation.mjs';
export function compileGenerate({projectId,jobId,coreId,root=ROOT,localExecution={}}) {
  const project=loadProject(projectId,root),job=loadJob(projectId,jobId,'generate',root);
  keys(job,['project','kind','core','profile','execution','items'],'job');
  const selected=selectCore(project,job,coreId,root),core=selected.core;
  const profile=readJson(projectPath(root,projectId,'profiles',job.profile));
  keys(profile,['project','id','name','constraints','defaults','allowedOverrides','presets','checks'],'profile');
  if(profile.project!==projectId||profile.id!==job.profile) throw new Error('资产配置工程身份不匹配');
  keys(profile.constraints,['text','frame','scene','crop','shadow'],'constraints');
  for(const v of Object.values(profile.constraints)) if(typeof v!=='boolean') throw new Error('资产约束必须为布尔值');
  texts(profile.checks,'profile.checks');
  const items=[],ids=new Set();
  if(!Array.isArray(job.items)||!job.items.length) throw new Error('任务 items 必须非空');
  for(const source of job.items) {
    keys(source,['id','seed','intent','entities','effects','relations','composition','mustRead','variants'],'item');
    id(source.id); if(ids.has(source.id)) throw new Error('item ID 重复'); ids.add(source.id);
    text(source.intent,'intent'); texts(source.mustRead,'mustRead');
    if(!Array.isArray(source.entities)||!source.entities.length) throw new Error('entities 必须非空');
    const objectIds=new Set(), lines=[];
    for(const e of source.entities) {
      keys(e,['id','kind','appearance','color','role','count','action'],'entity'); id(e.id); id(e.kind);
      if(objectIds.has(e.id)) throw new Error('实体 ID 重复'); objectIds.add(e.id);
      if(!core.config.domains[e.kind]) throw new Error(`核心缺少题材规则 ${e.kind}`);
      if(!['primary','support'].includes(e.role)) throw new Error('实体角色不合法');
      integer(e.count,'count',1,100); text(e.appearance,'appearance');text(e.color,'color'); if(e.action) text(e.action,'action');
      lines.push(`${e.id}：${e.count} 个${e.appearance}，${e.color}，${e.role==='primary'?'主要':'辅助'}实体${e.action?'，'+e.action:''}。`);
    }
    for(const e of source.effects??[]) {
      keys(e,['id','kind','target','color','relation','count'],'effect');id(e.id);
      if(objectIds.has(e.id)||!source.entities.some(x=>x.id===e.target)) throw new Error('效果 ID 重复或目标不存在'); objectIds.add(e.id);
      for(const k of ['kind','color','relation']) text(e[k],k); integer(e.count,'count',1,100);
      lines.push(`${e.id}：${e.count} 个${e.color}${e.kind}，作用于 ${e.target}；${e.relation}。`);
    }
    for(const r of source.relations??[]) {keys(r,['from','to','action'],'relation'); if(!objectIds.has(r.from)||!objectIds.has(r.to)) throw new Error('关系目标不存在');lines.push(`${r.from} → ${r.to}：${text(r.action,'action')}。`);}
    const variants=source.variants?.length?source.variants:[{id:'base'}],variantIds=new Set();
    for(const variant of variants) {
      keys(variant,['id','composition','seed'],'variant');id(variant.id); if(variantIds.has(variant.id)) throw new Error('variant ID 重复');variantIds.add(variant.id);
      const p=presentation(profile,{...source.composition,...variant.composition});
      if(!objectIds.has(p.value.focalTarget)) throw new Error('视觉焦点不存在');
      const seed=variant.seed??source.seed??parseInt(hash([projectId,jobId,source.id]).slice(0,7),16); integer(seed,'seed');
      items.push({itemId:source.id,variantId:variant.id,seed,brief:{...source,composition:p.value},prompt:`【风格核心】\n${corePrompt(core,source.entities.map(e=>e.kind))}\n【真实需求】\n${source.intent}。\n${lines.join('\n')}\n视觉焦点：${p.value.focalTarget}。\n【构图与资产】\n${p.prompt}\n${assetPrompt(profile)}`,negativeBlock:[coreNegative(core),profile.constraints.text?'':'文字, 字母, 水印',profile.constraints.frame?'':'装饰外框'].filter(Boolean).join(', '),imageArgs:[],checks:{content:source.mustRead,style:[corePrompt(core,source.entities.map(e=>e.kind))],asset:[...profile.checks,p.background]}});
    }
  }
  return finishPlan({module:'generate',project:projectId,job:jobId,execution:execution(project,job.execution,localExecution),sources:{core:core.id,coreHash:core.coreHash,selection:selected.source},snapshots:{project,core,profile,job},refs:[],items});
}
