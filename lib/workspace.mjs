import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,lstatSync,rmSync,cpSync} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {id,hash,readJson,writeJson,integer,keys,text,texts} from './shared.mjs';
import {externalPath} from './settings.mjs';
import {locked,tasks,runtimeRoot} from './runtime.mjs';
import {assertIdle,executionSettled} from './lifecycle.mjs';
import {validateProject} from './project.mjs';
import {validateImage} from './images.mjs';
import {taskStatus} from './tasks.mjs';

import {STYLE_CATEGORIES,STYLE_SCHEMA_VERSION} from './style-contract.mjs';
export {STYLE_CATEGORIES} from './style-contract.mjs';
export const TASK_PURPOSES=['subject','composition','pose','identity-color','surface','scene-light','text'];
const now=()=>new Date().toISOString();
function styleConfig(config){
  keys(config,['description','constraints','analysis'],'style config');
  if(config.description!==undefined&&(typeof config.description!=='string'||config.description.length>2000))throw new Error('风格描述必须是2000字以内文本');
  if(config.constraints!==undefined)texts(config.constraints,'constraints',{empty:true});
  if(config.analysis!==undefined){keys(config.analysis,['provider','model'],'analysis');text(config.analysis.provider,'analysis.provider');text(config.analysis.model,'analysis.model');}
  return structuredClone(config);
}
/** Resolve every existing ancestor: no user-controlled link may escape the project. */
export function ownedPath(root,...segments){
  const base=externalPath(resolve(root)),path=resolve(base,...segments),rel=relative(base,path);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\'))throw new Error('项目资源路径越界');
  let current=base;
  if(existsSync(base)&&lstatSync(base).isSymbolicLink())throw new Error('项目根不能为链接');
  for(const segment of rel.split(/[\\/]/).filter(Boolean)){
    current=join(current,segment);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('受管资源路径不能为链接');
  }
  return path;
}
export function objectDirectory(root,projectId,kind,objectId){
  id(projectId,'project');id(objectId,kind);if(!['style','task'].includes(kind))throw new Error('对象类型非法');
  return ownedPath(root,'projects',projectId,kind==='style'?'styles':'tasks',objectId);
}
export function objectFile(root,projectId,kind,objectId){return ownedPath(objectDirectory(root,projectId,kind,objectId),kind+'.json');}
export function readObject(root,projectId,kind,objectId){
  if(existsSync(ownedPath(root,'.runtime/upgrades',id(projectId)+'.json')))throw new Error('工程升级事务未完成，请显式 project upgrade 恢复');
  if(kind==='style'&&existsSync(ownedPath(objectDirectory(root,projectId,kind,objectId),'adoption.json')))throw new Error('风格采用事务未完成，请 style recover 后再操作');
  const record=readJson(objectFile(root,projectId,kind,objectId));
  if(record.schema!=='art-workshop/'+kind||record.schemaVersion!==2||record.project!==projectId||record.id!==objectId)throw new Error('对象身份或版本不匹配，请显式升级工程');
  integer(record.revision,'revision',1);return record;
}
export function listObjects(root,projectId,kind){
  const folder=ownedPath(root,'projects',id(projectId),kind==='style'?'styles':'tasks');
  return existsSync(folder)?readdirSync(folder).filter(x=>existsSync(ownedPath(folder,x,kind+'.json'))).map(x=>readObject(root,projectId,kind,x)):[];
}
/** Read projection only: never rewrite old frozen evidence or reinterpret old references. */
export function styleView(root,record){
  const pendingReferences=record.references.filter(ref=>!STYLE_CATEGORIES.includes(ref.category)).map(ref=>ref.id);
  const reasons=[];
  if(record.report&&record.report.data?.schemaVersion!==STYLE_SCHEMA_VERSION)reasons.push('旧分析报告职责版本已变化，请重新分析后采用。');
  if(pendingReferences.length)reasons.push('旧参考分类已取消，请逐图指定当前风格分类；具体造型参考应导入任务。');
  if(record.status==='frozen'){
    const core=readJson(ownedPath(objectDirectory(root,record.project,'style',record.id),'core.json'));
    if(core.schemaVersion!==STYLE_SCHEMA_VERSION)reasons.push('旧核心包含已取消的风格职能，请派生草稿、核对参考并重新分析采用；原核心与历史产物保留。');
  }
  return {...record,compatibility:{usable:reasons.length===0,pendingReferences,reasons}};
}
function objectRuns(settings,record){return tasks(runtimeRoot(settings)).map(t=>taskStatus(runtimeRoot(settings),t.taskId)).filter(t=>(t.plan?.project??t.project)===record.project&&(record.schema==='art-workshop/task'?(t.plan?.job===record.id||t.objectId===record.id&&t.objectKind==='task'):t.styleId===record.id&&t.project===record.project));}
export async function mutateObject(settings,projectId,kind,objectId,revision,change,{allowFrozen=false}={}){
  const file=objectFile(settings.paths.workspace,projectId,kind,objectId);
  return locked(runtimeRoot(settings),'control',async()=>{
    const before=readObject(settings.paths.workspace,projectId,kind,objectId);
    if(['discarded','cleanup-required'].includes(before.status)&&!allowFrozen)throw new Error('对象已放弃或需要清理，不能继续编辑');
    if(before.revision!==revision)throw new Error('对象版本冲突，请重新读取');
    assertIdle(objectRuns(settings,before),kind==='style'?'风格':'任务');
    if(kind==='style'&&before.status==='frozen'&&!allowFrozen)throw new Error('冻结风格只读，请派生新风格');
    const after=await change(structuredClone(before));
    if(after.id!==before.id||after.project!==before.project||after.schema!==before.schema||after.schemaVersion!==2)throw new Error('禁止修改对象身份');
    if(hash(after)===hash(before))return before;
    after.revision=before.revision+1;after.updatedAt=now();writeJson(file,after);return after;
  });
}
export async function createObject(settings,projectId,kind,{name,config={},source=null}={}){
  if(existsSync(ownedPath(settings.paths.workspace,'.runtime/upgrades',id(projectId)+'.json')))throw new Error('工程升级事务未完成，请显式 project upgrade 恢复');
  const project=readJson(ownedPath(settings.paths.workspace,'projects',id(projectId),'project.json'));
  if(project.schemaVersion!==2)throw new Error('工程需先显式升级');
  if(typeof name!=='string'||!name.trim())throw new Error('对象名称不能为空');
  const objectId=kind+'-'+randomUUID(),record={schema:'art-workshop/'+kind,schemaVersion:2,project:projectId,id:objectId,name:name.trim(),revision:1,status:'draft',createdAt:now(),updatedAt:now(),source,config:kind==='style'?styleConfig(config):structuredClone(config),references:[],report:null};
  if(kind==='task'){if(!['generate','edit'].includes(config.kind))throw new Error('任务必须声明生成或编辑类型');record.config.project=projectId;}
  const directory=objectDirectory(settings.paths.workspace,projectId,kind,objectId);
  try{if(kind==='task')record.config=await importSources(settings,record,record.config);writeJson(objectFile(settings.paths.workspace,projectId,kind,objectId),record);return record;}
  catch(error){if(existsSync(directory))rmSync(ownedPath(settings.paths.workspace,directory),{recursive:true,force:true});throw error;}
}
export function verifyReferences(root,record){
  const directory=objectDirectory(root,record.project,record.schema.slice('art-workshop/'.length),record.id);
  return record.references.map(ref=>{const path=ownedPath(directory,ref.path);if(!existsSync(path)||createHash('sha256').update(readFileSync(path)).digest('hex')!==ref.hash)throw new Error('参考资源已变化：'+ref.id);return {...ref,path};});
}
function imageExtension(buffer){
  if(buffer.length>=24&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return '.png';
  if(buffer.length>=12&&buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP')return '.webp';
  if(buffer.length>=4&&buffer[0]===255&&buffer[1]===216&&buffer.at(-2)===255&&buffer.at(-1)===217)return '.jpg';
  throw new Error('只允许有效 PNG/JPEG/WebP 图片');
}
export async function importReference(settings,projectId,kind,objectId,revision,{source,category,purposes=[],usage='understand',note='',ignore=''}={}){
  if(kind==='style'&&!STYLE_CATEGORIES.includes(category))throw new Error('风格参考分类非法');
  if(kind==='task'&&(!purposes.length||purposes.some(p=>!TASK_PURPOSES.includes(p))))throw new Error('任务参考用途非法');
  if(usage!=='understand')throw new Error('后端直接参考尚未完成用途约束适配');
  const buffer=readFileSync(externalPath(source,'参考图片'));if(buffer.length>20*1024*1024)throw new Error('单图最大 20MB');
  await validateImage(buffer);
  const extension=imageExtension(buffer),referenceId='ref-'+randomUUID();
  let created;
  try{return await mutateObject(settings,projectId,kind,objectId,revision,record=>{
    const directory=objectDirectory(settings.paths.workspace,projectId,kind,objectId),path=['refs',...(kind==='style'?[category]:[]),referenceId+extension].join('/');
    const target=ownedPath(directory,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,buffer,{flag:'wx'});created=target;
    record.references.push({id:referenceId,path,hash:createHash('sha256').update(buffer).digest('hex'),source:resolve(source),category:kind==='style'?category:null,purposes:kind==='task'?[...new Set(purposes)]:[],usage,note,ignore});record.report=null;
    return record;
  });}catch(error){if(created)rmSync(created,{force:true});throw error;}
}
export async function updateObject(settings,projectId,kind,objectId,revision,{name,config}={}){
  return mutateObject(settings,projectId,kind,objectId,revision,async record=>{const before=hash(record.config);if(name!==undefined){if(!name.trim())throw new Error('名称不能为空');record.name=name;}if(config!==undefined){if(kind==='task'&&(config.kind!==record.config.kind||config.project&&config.project!==projectId))throw new Error('任务类型/工程不可修改');record.config=kind==='task'?await importSources(settings,record,config):styleConfig(config);if(kind==='task')record.config.project=projectId;}if(hash(record.config)!==before)record.report=null;return record;});
}
export async function removeReference(settings,projectId,kind,objectId,revision,referenceId){
  // Keep immutable snapshot resources. A later explicit object cleanup owns deletion.
  return mutateObject(settings,projectId,kind,objectId,revision,record=>{if(!record.references.some(r=>r.id===referenceId))throw new Error('参考不存在');record.references=record.references.filter(r=>r.id!==referenceId);record.report=null;return record;});
}
export async function updateReference(settings,projectId,kind,objectId,revision,referenceId,input){
  keys(input,['category','purposes','note','ignore'],'参考配置');
  let created;
  try{return await mutateObject(settings,projectId,kind,objectId,revision,record=>{
    verifyReferences(settings.paths.workspace,record);
    const ref=record.references.find(ref=>ref.id===referenceId);if(!ref)throw new Error('参考不存在');
    const before=hash(ref);
    for(const key of ['note','ignore'])if(input[key]!==undefined){if(typeof input[key]!=='string'||input[key].length>8000)throw new Error('参考说明非法');ref[key]=input[key];}
    if(kind==='style'){
      if(input.purposes!==undefined)throw new Error('风格参考不能配置任务用途');
      if(input.category!==undefined){if(!STYLE_CATEGORIES.includes(input.category))throw new Error('风格参考分类非法');
        if(ref.category!==input.category){const directory=objectDirectory(settings.paths.workspace,projectId,kind,objectId),old=ownedPath(directory,ref.path);ref.path=['refs',input.category,ref.id+imageExtension(readFileSync(old))].join('/');const target=ownedPath(directory,ref.path);mkdirSync(dirname(target),{recursive:true});if(!existsSync(target)){cpSync(old,target,{force:false,errorOnExist:true});created=target;}else if(createHash('sha256').update(readFileSync(target)).digest('hex')!==ref.hash)throw new Error('目标参考内容冲突');ref.category=input.category;}
      }
    }else{
      if(input.category!==undefined)throw new Error('任务参考不能配置静态风格分类');
      if(input.purposes!==undefined){if(!Array.isArray(input.purposes)||!input.purposes.length||input.purposes.some(p=>!TASK_PURPOSES.includes(p)))throw new Error('任务参考用途非法');ref.purposes=[...new Set(input.purposes)];}
    }
    if(hash(ref)!==before)record.report=null;
    return record;
  });}catch(error){if(created)rmSync(created,{force:true});throw error;}
}
export async function deriveObject(settings,projectId,kind,objectId,revision){
  return locked(runtimeRoot(settings),'control',async()=>{
  const source=readObject(settings.paths.workspace,projectId,kind,objectId);
  if(['discarded','cleanup-required'].includes(source.status))throw new Error('对象不可派生');
  assertIdle(objectRuns(settings,source));
  if(source.revision!==revision)throw new Error('对象版本冲突');
  verifyReferences(settings.paths.workspace,source);
  const config=kind==='style'?{description:source.config.description??source.report?.data?.summary??'',constraints:source.config.constraints??[],...(source.config.analysis?{analysis:source.config.analysis}:{})}:source.config;
  const derived=await createObject(settings,projectId,kind,{name:source.name+' · 派生',config,source:{id:source.id,revision:source.revision}});
  try{
    const directory=objectDirectory(settings.paths.workspace,projectId,kind,derived.id);
    for(const ref of source.references){const old=ownedPath(objectDirectory(settings.paths.workspace,projectId,kind,source.id),ref.path),target=ownedPath(directory,ref.path);mkdirSync(dirname(target),{recursive:true});cpSync(old,target,{errorOnExist:true,force:false});derived.references.push({...ref});}
    writeJson(objectFile(settings.paths.workspace,projectId,kind,derived.id),derived);return derived;
  }catch(error){derived.status='cleanup-required';derived.error=error.message;writeJson(objectFile(settings.paths.workspace,projectId,kind,derived.id),derived);throw error;}
  });
}
export async function discardObject(settings,projectId,kind,objectId,revision){
  const directory=objectDirectory(settings.paths.workspace,projectId,kind,objectId);
  return mutateObject(settings,projectId,kind,objectId,revision,record=>{
    if(record.status==='frozen')throw new Error('正式风格不能作为草稿放弃');
    // Executed artifacts are immutable evidence and are not draft trash.
    if(kind==='task'&&objectRuns(settings,record).some(run=>run.plan))throw new Error('对象已有执行记录，不能作为草稿放弃');
    if(record.status==='discarded'&&record.cleanup?.status==='completed')return record;
    record.status='discarded';record.report=null;record.references=[];record.cleanup={status:'pending'};
    // Mark and advance the revision before cleanup. Failed or interrupted deletion
    // stays explicit and can be retried without reviving the draft.
    writeJson(objectFile(settings.paths.workspace,projectId,kind,objectId),{...record,revision:record.revision+1,updatedAt:now()});
    try{for(const folder of ['refs','sources']){const path=ownedPath(directory,folder);rmSync(path,{recursive:true,force:true});}record.cleanup={status:'completed'};}
    catch(error){record.status='cleanup-required';record.cleanup={status:'failed',error:error.message};}
    return record;
  },{allowFrozen:true});
}
export function assertPlanCurrent(plan,settings){
  const current=readObject(settings.paths.workspace,plan.project,'task',plan.job);
  if(current.status==='discarded'||current.revision!==plan.sources.taskRevision||hash(current.config)!==plan.sources.taskConfigHash)throw new Error('计划来源已变化，请重新编译');
  verifyReferences(settings.paths.workspace,current);
  const project=readJson(ownedPath(settings.paths.workspace,'projects',plan.project,'project.json'));
  if(hash(project)!==hash(plan.snapshots.project))throw new Error('工程默认配置已变化，请重新编译');
  if(plan.snapshots.profile){const profile=current.config.asset??readJson(ownedPath(settings.paths.workspace,'projects',plan.project,'profiles',current.config.profile+'.json'));if(hash(profile)!==hash(plan.snapshots.profile))throw new Error('资产规格已变化，请重新编译');}
  if(plan.sources.core){const core=readJson(ownedPath(settings.paths.workspace,'projects',plan.project,'styles',plan.sources.core,'core.json'));if(core.schemaVersion!==STYLE_SCHEMA_VERSION)throw new Error('旧风格核心需派生并重新分析采用，不能执行旧计划');if(core.coreHash!==plan.sources.coreHash||hash(core)!==hash(plan.snapshots.core))throw new Error('核心已变化，请重新编译');}
  for(const ref of plan.refs){if(!existsSync(ref.path)||createHash('sha256').update(readFileSync(ref.path)).digest('hex')!==ref.hash)throw new Error('底图已变化，请重新编译');}
}
export function taskDisplayState(record,runs,finalizations=[]){
  const own=runs.filter(r=>(r.plan?.project??r.project)===record.project&&(r.plan?.job===record.id||r.objectKind==='task'&&r.objectId===record.id));
  if(own.some(run=>!executionSettled(run)))return {status:'执行中',issue:own.some(r=>r.status==='unknown'||r.unsettled)?'停止未确认':null};
  const items=record.config.items??[],selected=new Set(finalizations.filter(f=>f.taskConfigHash===hash(record.config)).map(f=>f.assetId));
  if(items.length&&items.every(i=>selected.has(i.id)))return {status:'已定版',issue:null};
  const deleted=new Set((record.deletedCandidates??[]).map(c=>c.candidateId));
  const available=own.some(run=>{if(!run.manifestPath||!existsSync(run.manifestPath))return false;const manifest=readJson(run.manifestPath);return manifest.items?.some(item=>item.ok&&item.files?.some(file=>existsSync(resolve(dirname(run.manifestPath),file))&&!deleted.has(hash({runId:run.taskId,assetId:item.itemId,variantId:item.variantId,file}))))});
  if(available)return {status:'待定版',issue:own.some(r=>r.status==='failed')?'部分执行失败':null};
  return {status:'草稿',issue:own.some(r=>r.status==='failed')?'执行失败':null};
}

export async function createProject(settings,projectId,input){
  id(projectId,'project');const file=ownedPath(settings.paths.workspace,'projects',projectId,'project.json');
  const project=validateProject({...input,id:projectId,schemaVersion:2,revision:1,cores:[],defaultCore:null},projectId);
  return locked(runtimeRoot(settings),'control',async()=>{if(existsSync(file))throw new Error('工程已存在，不能覆写');writeJson(file,project);return project;});
}

async function importSources(settings,record,config){
  const result=structuredClone(config);if(result.kind!=='edit')return result;
  const directory=objectDirectory(settings.paths.workspace,record.project,'task',record.id);
  const created=[];
  try{for(const item of result.items??[]){
    if(!item.source)continue;
    const original=externalPath(resolve(settings.paths.workspace,item.source),'编辑底图'),rel=relative(directory,original);
    if(!isAbsolute(rel)&&rel.split(/[\\/]/)[0]==='sources'){ownedPath(directory,rel);await validateImage(readFileSync(original));item.source=relative(settings.paths.workspace,original).replaceAll('\\','/');continue;}
    const buffer=readFileSync(original);await validateImage(buffer);const filename='sources/'+randomUUID()+imageExtension(buffer),target=ownedPath(directory,filename);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,buffer,{flag:'wx'});created.push(target);item.source=relative(settings.paths.workspace,target).replaceAll('\\','/');
  }
  return result;}catch(error){for(const file of created)rmSync(ownedPath(directory,file),{force:true});throw error;}
}
