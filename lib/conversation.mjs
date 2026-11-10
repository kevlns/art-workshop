import {existsSync,readFileSync} from 'node:fs';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {keys,id,description,integer,hash,readJson,writeJson} from './shared.mjs';
import {execution,finishPlan} from './plan.mjs';
import {backendDefaults,bindBackend} from './backends.mjs';
import {startTask,taskStatus,taskView,recoverTask,cancelTask,resumeTask,shutdown} from './tasks.mjs';
import {runtimeRoot,locked,tasks} from './runtime.mjs';
import {sha256File} from './bl.mjs';
import {externalPath} from './settings.mjs';
import {validateImage} from './images.mjs';

export function conversationFile(settings,session,request){id(session,'session');id(request,'request');return join(settings.paths.workspace,'conversations',session,request+'.json');}
export async function compileConversation(request,settings){
 keys(request,['sessionId','requestId','mode','prompt','negative','images','preserve','style','size','count','seed','backend'],'conversation');
 id(request.sessionId,'sessionId');id(request.requestId,'requestId');
 if(!['generate','edit'].includes(request.mode))throw new Error('会话模式必须为 generate 或 edit');
 description(request.prompt,'prompt');
 const images=request.images??[];if(!Array.isArray(images))throw new Error('images 必须为数组');
 if(request.mode==='edit'&&!images.length)throw new Error('编辑必须明确底图');
 const refs=await Promise.all(images.map(async(image,index)=>{keys(image,['path','purpose'],'image');description(image.purpose,'purpose');const path=externalPath(resolve(image.path));await validateImage(readFileSync(path));return {path,hash:sha256File(path),purpose:image.purpose,index:index+1};}));
 const selected=request.backend??settings.generation?.defaultBackend;
 const config=execution({}, {...(request.size?{size:request.size}:{}),...(request.count!==undefined?{perValue:request.count}: {})},backendDefaults(settings,selected));
 const seed=request.seed??parseInt(hash([request.sessionId,request.requestId]).slice(0,7),16);integer(seed,'seed');
 const prompt=[request.prompt,request.style?'绘制语言：'+description(request.style,'style'):'',request.preserve?'必须保留：'+description(request.preserve,'preserve'):'',...refs.map(r=>'输入图'+r.index+'仅用于：'+r.purpose)].filter(Boolean).join('\n');
 const plan=finishPlan({compilerVersion:4,module:refs.length?'edit':request.mode,scope:{kind:'conversation',sessionId:request.sessionId,requestId:request.requestId},project:'conversation-'+hash(request.sessionId).slice(0,32),job:request.requestId,execution:config,sources:{requestHash:hash(request)},snapshots:{request},refs:refs.map(({path,hash})=>({path,hash})),items:[{itemId:'image',variantId:'base',seed,prompt,negativeBlock:request.negative??'',imageArgs:refs.map(r=>r.path),checks:{content:[],style:[],asset:[]}}]});
 return bindBackend(plan,settings,selected);
}

export async function startConversation(request,settings){
 const file=conversationFile(settings,request.sessionId,request.requestId);
 return locked(runtimeRoot(settings),'conversation',async()=>{
  if(existsSync(file)){
   const existing=readJson(file);if(hash(existing.request)!==hash(request))throw new Error('同一会话请求已提交，不能修改请求后重投');
   return readConversationStatus(settings,request.sessionId,request.requestId);
  }
  const plan=await compileConversation(request,settings),operationId='conversation-'+hash([request.sessionId,request.requestId]).slice(0,48);
  const record={schema:'art-workshop/conversation',request,plan,operationId,status:'dispatching',createdAt:new Date().toISOString()};
  writeJson(file,record);
  try{const started=await startTask(plan,plan.items,settings,{operationId});record.runId=started.taskId;record.status='queued';writeJson(file,record);}
  catch(error){record.status='unknown';record.error=error.message;writeJson(file,record);}
  return readConversationStatus(settings,request.sessionId,request.requestId);
 },{timeout:10000});
}
export async function conversationStatus(settings,session,request){
 return locked(runtimeRoot(settings),'conversation',()=>readConversationStatus(settings,session,request),{timeout:10000});
}
function readConversationStatus(settings,session,request){
 const file=conversationFile(settings,session,request);
 if(!existsSync(file))return {requestId:request,status:'failed',stopConfirmed:true,preSubmission:true,stopPolling:true,error:'未登记请求，未提交上游',artifacts:[]};
 const record=readJson(file);
 if(!record.runId){
  try{const recovered=recoverTask(runtimeRoot(settings),record.plan.project,record.operationId);record.runId=recovered.taskId;writeJson(file,record);}catch{}
 }
 if(!record.runId){
  // startTask 在拉起工作进程前持久登记；持有会话锁且无任务才可证明未提交。
  const matches=tasks(runtimeRoot(settings)).filter(t=>t.operationId===record.operationId);
  if(matches.length)throw new Error('原运行证据冲突，不能重投');
  record.status='failed';writeJson(file,record);
  return {requestId:request,status:'failed',stopConfirmed:true,preSubmission:true,stopPolling:true,error:record.error??'上游提交前已停止',artifacts:[]};
 }
 const task=taskStatus(runtimeRoot(settings),record.runId),view=taskView(task),artifacts=[];
 if(task.manifestPath&&existsSync(task.manifestPath)){
  const manifest=readJson(task.manifestPath);if(manifest.taskId!==task.taskId||manifest.planHash!==record.plan.planHash)throw new Error('会话产物身份不一致');
  for(const row of manifest.items??[])if(row.ok)for(const name of row.files??[]){const path=resolve(dirname(task.manifestPath),name),delta=relative(dirname(task.manifestPath),path);if(isAbsolute(delta)||delta.startsWith('..'))throw new Error('会话图片路径越界');if(!row.outputHashes?.[name]||sha256File(path)!==row.outputHashes[name])throw new Error('会话图片已变化');artifacts.push({path,sha256:row.outputHashes[name]});}
 }
 return {requestId:request,runId:task.taskId,status:view.status,stopConfirmed:view.stopConfirmed,canResume:view.canResume,stopPolling:['succeeded','failed','cancelled','unknown'].includes(view.status),error:view.error,artifacts};
}
export async function controlConversation(settings,session,request,action){
 return locked(runtimeRoot(settings),'conversation',async()=>{
 if(action==='close')return shutdown(settings,{closeServices:false});
 const current=readConversationStatus(settings,session,request);if(!current.runId)return current;
 if(action==='cancel')await cancelTask(runtimeRoot(settings),current.runId,{wait:false});
 else if(action==='resume')await resumeTask(runtimeRoot(settings),current.runId);
 else throw new Error('未知会话控制动作');
 return readConversationStatus(settings,session,request);
 },{timeout:10000});
}
