import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {existsSync,openSync,closeSync,rmSync,cpSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readObject,verifyReferences,ownedPath,objectFile,objectDirectory} from './workspace.mjs';
import {runtimeRoot,tasks,locked,taskFile,alive,stateRead} from './runtime.mjs';
import {taskStatus,taskView} from './tasks.mjs';
import {assertIdle} from './lifecycle.mjs';
import {writeJson,readJson,hash} from './shared.mjs';
import {analyzeStyle} from './analyze.mjs';
import {referenceInput,analyzeTaskReferences} from './task-references.mjs';
import {freezeCore,validateReport} from './core.mjs';
import {styleReviewState,issueFingerprint,validateIssues,resolvedRecommendation} from './style-review.mjs';
import {mutateObject} from './workspace.mjs';
import {REFERENCE_CATEGORIES} from './style-contract.mjs';

export function analysisInput(settings,record){
 const scopes=Object.fromEntries(REFERENCE_CATEGORIES.map(c=>[c.directory,c.scope]));
 return {project:record.project,id:record.id,description:record.config.description, constraints:record.config.constraints??[],previous:record.report?.data??null,refs:verifyReferences(settings.paths.workspace,record).map(ref=>{if(!scopes[ref.category])throw new Error('参考分类已取消，请先明确重新分类：'+ref.id);return {path:ref.path,scope:scopes[ref.category],note:ref.note||ref.category,ignore:ref.ignore??''};})};
}
export async function startAnalysis(settings,projectId,styleId,revision,{dry=false,kind='style',operationId=null}={}){
 const root=runtimeRoot(settings);
 const prepare=async()=>{
  if(operationId&&!dry){if(!/^[a-z0-9-]{1,128}$/.test(operationId))throw new Error('操作身份非法');const existing=tasks(root).filter(t=>t.operationId===operationId);if(existing.length){if(existing.length!==1||existing[0].project!==projectId||existing[0].objectKind!==kind||existing[0].objectId!==styleId||existing[0].sourceRevision!==revision)throw new Error('操作身份已用于其他分析请求');return taskView(taskStatus(root,existing[0].taskId));}}
  const record=readObject(settings.paths.workspace,projectId,kind,styleId);
  if(record.revision!==revision)throw new Error('风格版本冲突');if(record.status!=='draft')throw new Error('只有可编辑对象可分析');
  const input=kind==='style'?analysisInput(settings,record):referenceInput(settings.paths.workspace,record),analyzer=kind==='style'?analyzeStyle:analyzeTaskReferences,preview=await analyzer({projectId,input,root:settings.paths.workspace,refsDir:settings.paths.workspace,analysisModel:record.config.model??settings.analysisModel,dry:true});
  if(dry)return preview;
  assertIdle(tasks(root).filter(t=>(kind==='style'?t.styleId===styleId&&t.project===projectId:t.plan?.job===styleId&&t.plan?.project===projectId||t.objectId===styleId&&t.project===projectId)).map(t=>taskStatus(root,t.taskId)),'风格');
  const gate=stateRead(join(root,'shutdown.json'));if(gate&&alive(gate.pid))throw new Error('服务正在关闭，不能启动分析');
  const taskId='task-'+randomUUID(),file=taskFile(root,taskId),logPath=join(root,'tasks',taskId+'.log');
  const evidence=ownedPath(objectDirectory(settings.paths.workspace,projectId,kind,styleId),'reports',taskId,'refs');
  for(const [index,ref] of (input.refs??input.references).entries()){mkdirSync(evidence,{recursive:true});const destination=ownedPath(evidence,index+'-'+ref.path.split(/[\\/]/).at(-1));cpSync(ref.path,destination,{errorOnExist:true,force:false});ref.path=destination;}
  const task={schema:'art-workshop/task',operationId,kind:kind==='style'?'style-analysis':'task-reference-analysis',objectKind:kind,objectId:styleId,taskId,project:projectId,...(kind==='style'?{styleId}:{}),status:'queued',stopConfirmed:false,createdAt:new Date().toISOString(),sourceRevision:revision,sourceHash:hash({config:record.config,references:record.references}),input,model:preview.provenance.model,analysisProvider:preview.provenance.provider,workspace:settings.paths.workspace,cache:settings.paths.cache,root,logPath};writeJson(file,task);
  const fd=openSync(logPath,'a'),child=spawn(process.execPath,[fileURLToPath(new URL('./analysis-worker.mjs',import.meta.url)),file],{detached:true,windowsHide:true,stdio:['ignore',fd,fd]});closeSync(fd);
  try{await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}catch(error){task.status='failed';task.stopConfirmed=true;task.error=error.message;writeJson(file,task);throw error;}
  child.unref();return {taskId,status:'queued',styleId,sourceRevision:revision};
 };
 return dry?prepare():locked(root,'control',prepare);
}
export async function adoptStyle(settings,projectId,styleId,revision,{note}={}){
 return locked(runtimeRoot(settings),'control',async()=>{
  const record=readObject(settings.paths.workspace,projectId,'style',styleId);
  if(record.status!=='draft'||record.revision!==revision)throw new Error('风格状态或版本已变化');
  assertIdle(tasks(runtimeRoot(settings)).filter(t=>t.styleId===styleId&&t.project===projectId).map(t=>taskStatus(runtimeRoot(settings),t.taskId)),'风格');
  verifyReferences(settings.paths.workspace,record);
  if(!record.report||record.report.sourceHash!==hash({config:record.config,references:record.references}))throw new Error('分析报告缺失或已过期');
  const report=record.report.data;validateReport(report,projectId);if(report.id!==styleId||!styleReviewState(record).ready)throw new Error('报告身份、版本或待决定问题尚未解决');
  const journal=ownedPath(objectDirectory(settings.paths.workspace,projectId,'style',styleId),'adoption.json');
  writeJson(journal,{project:projectId,styleId,revision,report,note,record,createdAt:new Date().toISOString()});
  const core=freezeCore({projectId,report,root:settings.paths.workspace,note,history:record.reviewHistory??[]});
  record.status='frozen';record.coreHash=core.coreHash;record.revision++;record.updatedAt=new Date().toISOString();
  try{writeJson(objectFile(settings.paths.workspace,projectId,'style',styleId),record);}catch(error){throw new Error('核心已冻结，但风格状态提交失败，需要恢复：'+error.message);}
  rmSync(journal,{force:true});return record;
 });
}


/** Complete an already authorized adoption after a crash; never create a second core. */
export async function recoverStyleAdoption(settings,projectId,styleId){
 return locked(runtimeRoot(settings),'control',async()=>{
  const directory=objectDirectory(settings.paths.workspace,projectId,'style',styleId),journal=ownedPath(directory,'adoption.json');
  if(!existsSync(journal))return readObject(settings.paths.workspace,projectId,'style',styleId);
  const intent=readJson(journal);if(intent.project!==projectId||intent.styleId!==styleId)throw new Error('恢复事务身份不匹配');
  const file=objectFile(settings.paths.workspace,projectId,'style',styleId),record=readJson(file);
  if(record.revision!==intent.revision&&!(record.revision===intent.revision+1&&record.status==='frozen'))throw new Error('风格版本与恢复事务冲突');
  const corePath=ownedPath(directory,'core.json');
  let core;if(existsSync(corePath)){core=readJson(corePath);const {coreHash,...body}=core;if(hash(body)!==coreHash||core.id!==styleId||hash(core.report)!==hash(intent.report))throw new Error('已有核心与恢复事务不匹配');}
  else core=freezeCore({projectId,report:intent.report,root:settings.paths.workspace,note:intent.note,history:intent.record.reviewHistory??[]});
  const projectFile=ownedPath(settings.paths.workspace,'projects',projectId,'project.json'),project=readJson(projectFile);
  if(!project.cores.includes(styleId)){project.cores.push(styleId);project.defaultCore??=styleId;project.revision++;writeJson(projectFile,project);}
  record.status='frozen';record.coreHash=core.coreHash;record.revision=intent.revision+1;record.updatedAt=core.approvedAt;writeJson(file,record);rmSync(journal,{force:true});return record;
 });
}

/** Explicit decisions update the review, never rewrite reference evidence or raw model output. */
export async function resolveStyleIssue(settings,projectId,styleId,revision,{issueId,optionId,note}={}){
  return mutateObject(settings,projectId,'style',styleId,revision,record=>{
    const state=styleReviewState(record);
    if(state.stale||!record.report)throw new Error(state.reason);
    validateReport(record.report.data,projectId);
    const report=record.report.data,issue=report.issues.find(i=>i.id===issueId);
    const option=issue?.options.find(o=>o.id===optionId);
    if(!issue||!option)throw new Error('问题或选项不存在，请重新读取');
    if(typeof note!=='string'||!note.trim()||note.length>2000)throw new Error('必须记录用户取舍依据');
    const touched=new Set([...option.remove,...option.upsert.map(r=>r.id)]);
    report.decisions=report.decisions.filter(d=>{
      if(d.issueId===issueId)return false;
      const old=report.issues.find(i=>i.id===d.issueId)?.options.find(o=>o.id===d.optionId);
      return old&&![...old.remove,...old.upsert.map(r=>r.id)].some(id=>touched.has(id));
    });
    report.decisions.push({issueId,fingerprint:issueFingerprint(issue),optionId,note:note.trim(),decidedAt:new Date().toISOString()});
    validateIssues(report);resolvedRecommendation(report);
    record.reviewHistory??=[];record.reviewHistory.push({revision:record.revision+1,runId:record.report.runId,decision:report.decisions.at(-1)});
    return record;
  });
}
