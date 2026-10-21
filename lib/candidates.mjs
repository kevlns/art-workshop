import {readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {hash,readJson,writeJson,text} from './shared.mjs';
import {ownedPath,readObject,objectDirectory,mutateObject,listObjects,createObject} from './workspace.mjs';
import {validateImage} from './images.mjs';
import {sha256File} from './bl.mjs';
import {objectFile} from './workspace.mjs';
import {checkRun} from './executor.mjs';
import {tasks,runtimeRoot,locked} from './runtime.mjs';
import {jobTemplate} from './templates.mjs';
import {executionSettled} from './lifecycle.mjs';

export async function editFromCandidate(settings,projectId,taskId,{runId,candidateId}={}){
 return locked(runtimeRoot(settings),'control',async()=>{
  const source=readObject(settings.paths.workspace,projectId,'task',taskId),candidate=candidates(settings,projectId,taskId,runId).find(row=>row.candidateId===candidateId&&row.editable);
  if(!candidate)throw new Error('底图不存在、已删除、已被改动或原批次尚未停止');
  await validateImage(readFileSync(candidate.path));
  const config=jobTemplate(settings.paths.workspace,projectId,{kind:'edit'});config.items[0].source=candidate.path;
  return createObject(settings,projectId,'task',{name:source.name+' · 编辑',config,source:{kind:'candidate',taskId,runId,candidateId,hash:sha256File(candidate.path)}});
 });
}

function runManifest(settings,projectId,taskId,runTaskId){
  const run=tasks(runtimeRoot(settings)).find(t=>t.taskId===runTaskId);
  if(!run||run.plan?.project!==projectId||run.plan?.job!==taskId||!run.manifestPath)throw new Error('执行批次不属于该任务');
  const path=ownedPath(settings.paths.output,run.manifestPath),manifest=readJson(path);
  if(manifest.planHash!==run.plan.planHash)throw new Error('批次计划身份不匹配');
  return {run,manifest,path};
}
export function candidates(settings,projectId,taskId,runTaskId){
  const {run,manifest,path}=runManifest(settings,projectId,taskId,runTaskId);
  const tombstones=readObject(settings.paths.workspace,projectId,'task',taskId).deletedCandidates??[];
  return checkRun(manifest,path).filter(c=>c.file).map(c=>{
    const candidateId=hash({runId:runTaskId,assetId:c.itemId,variantId:c.variantId,file:c.file});
    const deleted=tombstones.some(d=>d.candidateId===candidateId);
    return {...c,runId:runTaskId,candidateId,deleted,editable:c.editable&&!deleted&&executionSettled(run)};
  });
}
export function finalizations(settings,projectId,taskId){return readObject(settings.paths.workspace,projectId,'task',taskId).finalizations??[];}
export async function finalize(settings,projectId,taskId,revision,{runId,candidateId,replace=false,actor}={}){
  text(actor,'操作者');
  // Mutation lock covers integrity checks, current selection and commit together.
  return mutateObject(settings,projectId,'task',taskId,revision,async record=>{
    const candidate=candidates(settings,projectId,taskId,runId).find(c=>c.candidateId===candidateId);
    if(!candidate?.accepted||candidate.deleted)throw new Error('候选未完成、已删除或完整性验证失败');
    const info=await validateImage(readFileSync(candidate.path));
    const {run}=runManifest(settings,projectId,taskId,runId);
    const item=run.plan.items.find(item=>item.itemId===candidate.itemId&&item.variantId===candidate.variantId);
    const expected=(item?.execution??run.plan.execution).size.split('*').map(Number);
    if(info.width!==expected[0]||info.height!==expected[1])throw new Error('候选尺寸与冻结计划不符');
    const previous=(record.finalizations??[]).find(f=>f.assetId===candidate.itemId);
    if(previous?.candidateId===candidateId)return record;
    if(previous&&!replace)throw new Error('该资产已有定版，请明确确认替换');
    record.finalizationHistory??=[];if(previous)record.finalizationHistory.push({...previous,replacedAt:new Date().toISOString()});
    if(run.plan.sources.taskConfigHash!==hash(record.config))throw new Error('候选对应的需求配置已变化，请选择匹配当前配置的批次');
    const selection={taskConfigHash:run.plan.sources.taskConfigHash,assetId:candidate.itemId,runId,candidateId,path:candidate.path,hash:sha256File(candidate.path),actor,createdAt:new Date().toISOString(),revision:record.revision+1};
    record.finalizations=[...(record.finalizations??[]).filter(f=>f.assetId!==candidate.itemId),selection];
    return record;
  });
}
export async function deleteCandidate(settings,projectId,taskId,revision,{runId,candidateId,confirm=false,actor}={}){
  if(!confirm)throw new Error('删除候选需要明确确认影响');text(actor,'操作者');
  return mutateObject(settings,projectId,'task',taskId,revision,record=>{
    const candidate=candidates(settings,projectId,taskId,runId).find(c=>c.candidateId===candidateId);
    if(!candidate)throw new Error('候选不存在');
    let tombstone=record.deletedCandidates?.find(d=>d.candidateId===candidateId);
    if(tombstone?.cleanup==='completed')return record;
    if(!tombstone){
      for(const other of listObjects(settings.paths.workspace,projectId,'task')){
        if(other.status==='discarded')continue;
        if((other.config.items??[]).some(i=>i.source&&resolve(settings.paths.workspace,i.source)===candidate.path))throw new Error('候选被编辑任务底图引用，不能删除');
      }
      for(const run of tasks(runtimeRoot(settings)))if((run.plan?.refs??[]).some(r=>resolve(r.path)===candidate.path))throw new Error('候选被历史计划引用，不能删除');
      const selected=(record.finalizations??[]).find(f=>f.candidateId===candidateId);
      record.finalizationHistory??=[];if(selected)record.finalizationHistory.push({...selected,deletedAt:new Date().toISOString()});
      record.finalizations=(record.finalizations??[]).filter(f=>f.candidateId!==candidateId);
      record.deletedCandidates??=[];
      tombstone={candidateId,runId,path:candidate.path,actor,deletedAt:new Date().toISOString(),cleanup:'pending'};
      record.deletedCandidates.push(tombstone);
    }
    // Write-ahead tombstone and physical cleanup share the mutation guard. A crash
    // leaves a resumable pending record; it cannot expose a deleted selection.
    writeJson(objectFile(settings.paths.workspace,projectId,'task',taskId),{...record,revision:record.revision+1,updatedAt:new Date().toISOString()});
    try{ownedPath(settings.paths.output,tombstone.path);rmSync(tombstone.path,{force:true});tombstone.cleanup='completed';delete tombstone.error;}
    catch(error){tombstone.cleanup='failed';tombstone.error=error.message;}
    return record;
  });
}
