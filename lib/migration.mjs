import {existsSync,mkdirSync,readdirSync,cpSync,renameSync,rmSync} from 'node:fs';
import {join,dirname,relative,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {id,readJson,writeJson,hash} from './shared.mjs';
import {createHash} from 'node:crypto';
import {externalPath} from './settings.mjs';
import {readFileSync} from 'node:fs';
import {locked,tasks,runtimeRoot,alive,taskFile} from './runtime.mjs';
import {taskStatus} from './tasks.mjs';
import {assertIdle} from './lifecycle.mjs';
import {ownedPath,STYLE_CATEGORIES,TASK_PURPOSES} from './workspace.mjs';
import {validateImage} from './images.mjs';
import {checkRun} from './executor.mjs';

/** Preflight old executions and synchronous manifests without modifying evidence. */
async function legacyRuns(settings,projectId){
 const result=new Map(),oldRoot=join(dirname(settings.file),'.runtime',hash(settings.file).slice(0,12));
 for(const run of tasks(oldRoot).filter(run=>(run.plan?.project??run.project)===projectId)){
  if(alive(run.workerPid)||!['succeeded','failed','cancelled'].includes(run.status)||run.promptId||run.unsettled||run.remoteCancellation)throw new Error('旧工程存在运行或停止未知的执行，必须先核验原运行');
  if(!run.finishedAt)throw new Error('旧执行缺少停止证据，不能推断完成');
  result.set(run.taskId,{...run,stopConfirmed:true,root:runtimeRoot(settings),migration:{source:taskFile(oldRoot,run.taskId)}});
 }
 const manifests=[];
 const scan=directory=>{if(!existsSync(directory))return;for(const entry of readdirSync(directory,{withFileTypes:true})){const path=ownedPath(settings.paths.output,directory,entry.name);if(entry.isDirectory())scan(path);else if(entry.name==='manifest.json')manifests.push(path);}};
 scan(settings.paths.output);
 for(const path of manifests){const manifest=readJson(path);if(manifest.schema!=='art-workshop/run'||manifest.plan?.project!==projectId)continue;
  if(!manifest.finishedAt)throw new Error('历史批次缺少完成证据：'+manifest.runId);
  const rows=checkRun(manifest,path);for(const row of rows.filter(row=>row.generated)){if(!row.integrity)throw new Error('历史候选完整性失败：'+row.file);await validateImage(readFileSync(row.path));}
  const runId=manifest.taskId??('task-legacy-'+hash({path,runId:manifest.runId}).slice(0,24));id(runId);
  const existing=result.get(runId);if(existing&&existing.plan?.planHash!==manifest.planHash)throw new Error('旧批次运行身份冲突');
  result.set(runId,{...(existing??{}),schema:'art-workshop/task',taskId:runId,status:manifest.summary?.failed?'failed':'succeeded',stopConfirmed:true,createdAt:manifest.startedAt,finishedAt:manifest.finishedAt,plan:manifest.plan,items:manifest.plan.items,manifestPath:path,root:runtimeRoot(settings),outputRoot:settings.paths.output,migration:{...existing?.migration,manifestRunId:manifest.runId,review:manifest.review??[]}});
 }
 return [...result.values()];
}

/** Explicit one-time upgrade. Readers never fall back to legacy documents. */
export async function upgradeProject(root,projectId,{dry=true,referenceAssignments={},settings}={}){
  if(!dry&&!settings)throw new Error('升级必须提供执行配置以检查运行占用');
  const upgrade=async()=>{
  id(projectId);
  const journal=ownedPath(root,'.runtime/upgrades',projectId+'.json');
  if(existsSync(journal)){
    if(dry)throw new Error('升级事务未完成，请先显式执行 project upgrade 恢复原工程');
    const transaction=readJson(journal),source=ownedPath(root,'projects',projectId);
    if(transaction.schema!=='art-workshop/upgrade'||transaction.project!==projectId)throw new Error('升级事务身份不匹配');
    const backup=ownedPath(root,'backups',transaction.backup),staging=ownedPath(root,'projects',transaction.staging);
    if(existsSync(backup)){
      for(const run of transaction.createdRuns){const file=taskFile(runtimeRoot(settings),run.taskId);if(existsSync(file)){if(hash(readJson(file))!==run.hash)throw new Error('升级后的执行记录被修改，不能自动回滚');rmSync(file,{force:true});}}
      if(existsSync(source)){if(readJson(join(source,'project.json')).schemaVersion!==2)throw new Error('升级目标被修改，不能自动回滚');rmSync(source,{recursive:true,force:true});}
      renameSync(backup,source);
    }
    if(existsSync(staging))rmSync(staging,{recursive:true,force:true});
    rmSync(journal,{force:true});
  }
  if(settings)assertIdle(tasks(runtimeRoot(settings)).filter(t=>t.plan?.project===projectId||t.project===projectId).map(t=>taskStatus(runtimeRoot(settings),t.taskId)),'工程');
  id(projectId);const source=ownedPath(root,'projects',projectId),project=readJson(ownedPath(source,'project.json'));
  if(project.schemaVersion===2)return {project:projectId,current:true,changes:[]};
  const runs=settings?await legacyRuns(settings,projectId):[];
  const jobs=existsSync(ownedPath(source,'jobs'))?readdirSync(ownedPath(source,'jobs')).filter(f=>f.endsWith('.json')):[];
  const cores=existsSync(ownedPath(source,'cores'))?readdirSync(ownedPath(source,'cores')).filter(f=>f.endsWith('.json')):[];
  for(const file of jobs){const config=readJson(ownedPath(source,'jobs',file));if(config.kind==='edit')for(const item of config.items??[]){if(!item.source)throw new Error('旧编辑任务缺少底图：'+file);await validateImage(readFileSync(externalPath(resolve(root,item.source),'旧编辑底图')));}}
  const approvedByRun=new Map(),groups=new Map(),selected=new Set();
  for(const run of runs){
    const manifest=run.manifestPath?readJson(run.manifestPath):null;
    const approved=manifest?checkRun(manifest,run.manifestPath).filter(row=>row.integrity&&row.generated&&(run.migration.review??[]).some(review=>review.itemId===row.itemId&&review.variantId===row.variantId&&review.file===row.file&&['content','style','asset'].every(key=>review[key]==='pass'))):[];
    approvedByRun.set(run.taskId,approved);
    for(const row of approved){const key=run.plan.job+'/'+row.itemId,entry={runId:run.taskId,row};groups.set(key,[...(groups.get(key)??[]),entry]);}
  }
  for(const [key,entries] of groups){
    const mapping=referenceAssignments.selections?.find(selection=>selection.task+'/'+selection.assetId===key);
    const choice=mapping?entries.find(entry=>entry.runId===mapping.runId&&entry.row.file===mapping.file&&entry.row.variantId===mapping.variantId):entries.length===1?entries[0]:null;
    if(!choice)throw new Error('同一资产存在多份旧采用记录，需在 selections 映射中明确 runId/file/variantId：'+key);
    selected.add(hash({runId:choice.runId,assetId:choice.row.itemId,variantId:choice.row.variantId,file:choice.row.file}));
  }
  const refs=project.refsDir;
  if(refs&&!referenceAssignments.confirmed)throw new Error('旧项目共享 refs 必须先明确归属映射，禁止猜测升级');
  const result={project:projectId,current:false,runs:runs.map(run=>({id:run.taskId,job:run.plan?.job,status:run.status})),changes:[...jobs.map(f=>'jobs/'+f+' → tasks/'+f.slice(0,-5)+'/task.json'),...cores.map(f=>'cores/'+f+' → styles/'+f.slice(0,-5)+'/core.json')],dry};
  if(refs){
    const assignments=referenceAssignments.references;if(!Array.isArray(assignments))throw new Error('参考映射必须包含 references 列表');
    const importRoot=externalPath(join(root,refs),'旧参考目录'),images=[];
    const scan=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const file=ownedPath(importRoot,dir,entry.name);if(entry.isDirectory())scan(file);else if(/\.(png|jpe?g|webp)$/i.test(entry.name))images.push(file);}};
    if(existsSync(importRoot))scan(importRoot);
    for(const file of images)if(!assignments.some(a=>ownedPath(importRoot,a.path)===file))throw new Error('参考未明确映射：'+file);
    for(const assignment of assignments){
      if(!['style','task'].includes(assignment.kind))throw new Error('映射对象类型非法');id(assignment.id);
      if(assignment.kind==='style'&&!STYLE_CATEGORIES.includes(assignment.category))throw new Error('风格映射分类非法');
      if(assignment.kind==='task'&&(!assignment.purposes?.length||assignment.purposes.some(p=>!TASK_PURPOSES.includes(p))))throw new Error('任务映射用途非法');
      const existing=ownedPath(source,assignment.kind==='style'?'styles':'tasks',assignment.id,assignment.kind+'.json');
      const legacy=ownedPath(source,assignment.kind==='style'?'cores':'jobs',assignment.id+'.json');
      if(!existsSync(existing)&&!existsSync(legacy))throw new Error('映射目标不存在：'+assignment.id);
      await validateImage(readFileSync(ownedPath(importRoot,assignment.path)));
    }
  }
  if(dry)return result;
  // No symlink is allowed in a managed conversion tree.
  const check=directory=>{for(const name of readdirSync(directory,{withFileTypes:true})){const path=ownedPath(directory,name.name);if(name.isDirectory())check(path);}};check(source);
  const staging=ownedPath(root,'projects',projectId+'-upgrade-'+randomUUID()),backup=ownedPath(root,'backups',projectId+'-'+randomUUID());
  cpSync(source,staging,{recursive:true,errorOnExist:true,force:false});
  try{
    for(const file of jobs){
      const objectId=file.slice(0,-5);id(objectId);const config=readJson(join(staging,'jobs',file));
      if(config.kind==='edit')for(const item of config.items??[]){
        if(!item.source)throw new Error('旧编辑任务缺少底图，不能丢弃配置：'+objectId);
        const input=externalPath(resolve(root,item.source),'旧编辑底图'),buffer=readFileSync(input);await validateImage(buffer);
        const extension=input.slice(input.lastIndexOf('.')).toLowerCase();if(!['.png','.jpg','.jpeg','.webp'].includes(extension))throw new Error('旧编辑底图格式非法');
        const name=randomUUID()+extension,target=ownedPath(staging,'tasks',objectId,'sources',name);mkdirSync(dirname(target),{recursive:true});cpSync(input,target,{errorOnExist:true,force:false});
        item.source=relative(root,ownedPath(source,'tasks',objectId,'sources',name)).replaceAll('\\','/');
      }
      writeJson(join(staging,'tasks',objectId,'task.json'),{schema:'art-workshop/task',schemaVersion:2,project:projectId,id:objectId,name:objectId,revision:1,status:'draft',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),source:null,config,references:[],report:null});
    }
    for(const file of cores){const objectId=file.slice(0,-5);id(objectId);const core=readJson(join(staging,'cores',file));const {coreHash,...body}=core;if(hash(body)!==coreHash||core.project!==projectId||core.id!==objectId)throw new Error('旧冻结核心完整性失败');writeJson(join(staging,'styles',objectId,'core.json'),core);writeJson(join(staging,'styles',objectId,'style.json'),{schema:'art-workshop/style',schemaVersion:2,project:projectId,id:objectId,name:objectId,revision:1,status:'frozen',coreHash,createdAt:core.approvedAt,updatedAt:core.approvedAt,source:null,config:core.config,references:[],report:{data:core.report,sourceRevision:1,path:null,runId:null,sourceHash:null}});}
    for(const run of runs){
      const file=ownedPath(staging,'tasks',run.plan?.job,'task.json');if(!existsSync(file))throw new Error('历史运行没有对应任务，不能丢弃：'+run.taskId);
      const record=readJson(file),approved=approvedByRun.get(run.taskId);
      for(const row of approved){const candidateId=hash({runId:run.taskId,assetId:row.itemId,variantId:row.variantId,file:row.file}),selection={assetId:row.itemId,runId:run.taskId,candidateId,path:row.path,hash:createHash('sha256').update(readFileSync(row.path)).digest('hex'),taskConfigHash:hash(record.config),actor:'legacy-upgrade',createdAt:run.finishedAt,revision:1};
        if(selected.has(candidateId)){record.finalizations??=[];record.finalizations.push(selection);}else{record.finalizationHistory??=[];record.finalizationHistory.push({...selection,supersededByMigration:true});}
      }
      writeJson(file,record);
      const destination=taskFile(runtimeRoot(settings),run.taskId);if(existsSync(destination)&&hash(readJson(destination))!==hash(run))throw new Error('目标执行记录冲突，保留原工程');
    }
    delete project.refsDir;project.schemaVersion=2;project.revision=1;writeJson(join(staging,'project.json'),project);
    // Reject unresolved external refs rather than silently drop their associations.
    if(refs){
      const assignments=referenceAssignments.references;
      if(!Array.isArray(assignments))throw new Error('参考映射必须包含 references 列表');
      const importRoot=externalPath(join(root,refs),'旧参考目录');
      const images=[];const scan=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const path=ownedPath(importRoot,dir,entry.name);if(entry.isDirectory())scan(path);else if(/\.(png|jpe?g|webp)$/i.test(entry.name))images.push(path);}};if(existsSync(importRoot))scan(importRoot);
      for(const path of images)if(!assignments.some(a=>ownedPath(importRoot,a.path)===path))throw new Error('参考未明确映射：'+path);
      for(const assignment of assignments){
        if(!['style','task'].includes(assignment.kind))throw new Error('映射对象类型非法');id(assignment.id);
        if(assignment.kind==='style'&&!STYLE_CATEGORIES.includes(assignment.category))throw new Error('风格映射分类非法');
        if(assignment.kind==='task'&&(!assignment.purposes?.length||assignment.purposes.some(p=>!TASK_PURPOSES.includes(p))))throw new Error('任务映射用途非法');
        const objectDir=ownedPath(staging,assignment.kind==='style'?'styles':'tasks',assignment.id),file=ownedPath(objectDir,assignment.kind+'.json');
        const record=readJson(file),input=ownedPath(importRoot,assignment.path),buffer=readFileSync(input),refId='ref-'+randomUUID();
        const extension=input.slice(input.lastIndexOf('.')).toLowerCase();if(!['.png','.jpg','.jpeg','.webp'].includes(extension))throw new Error('参考格式非法');
        const target=['refs',...(assignment.kind==='style'?[assignment.category]:[]),refId+extension].join('/');
        const destination=ownedPath(objectDir,target);mkdirSync(join(destination,'..'),{recursive:true});
        cpSync(input,destination,{recursive:false,force:false});
        record.references.push({id:refId,path:target,hash:createHash('sha256').update(buffer).digest('hex'),source:input,category:assignment.category??null,purposes:assignment.purposes??[],usage:'understand',note:assignment.note??'',ignore:assignment.ignore??''});writeJson(file,record);
      }
    }
    for(const dir of ['jobs','cores'])rmSync(ownedPath(staging,dir),{recursive:true,force:true});
    const createdRuns=runs.filter(run=>!existsSync(taskFile(runtimeRoot(settings),run.taskId))).map(run=>({taskId:run.taskId,hash:hash(run)}));
    writeJson(journal,{schema:'art-workshop/upgrade',project:projectId,backup:relative(join(root,'backups'),backup),staging:relative(join(root,'projects'),staging),createdRuns});
    mkdirSync(join(root,'backups'),{recursive:true});renameSync(source,backup);
    const created=[];
    try{renameSync(staging,source);for(const run of runs){const file=taskFile(runtimeRoot(settings),run.taskId);if(!existsSync(file)){created.push(file);writeJson(file,run);}}}
    catch(error){for(const file of created)rmSync(file,{force:true});if(existsSync(source))rmSync(ownedPath(root,source),{recursive:true,force:true});renameSync(backup,source);rmSync(journal,{force:true});throw error;}
    rmSync(journal,{force:true});
    return {...result,backup};
  }finally{if(existsSync(staging))rmSync(ownedPath(root,'projects',staging),{recursive:true,force:true});}
  };
  return dry?upgrade():locked(runtimeRoot(settings),'control',upgrade);
}
