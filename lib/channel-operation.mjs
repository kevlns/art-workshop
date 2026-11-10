import {createHash} from 'node:crypto';
import {mkdir,open,readFile,rm,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {projectPath} from './video/path.mjs';
import {withResource} from './video/resource.mjs';
import {atomicJson} from './video/atomic.mjs';
const base='.vant/state/video';
const fail=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const validExecution=id=>typeof id==='string'&&/^video-[a-f0-9-]{36}$/.test(id);
export function videoExecutionId(value){
 if(validExecution(value))return value;
 if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)||value.endsWith('.')||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))throw fail('video-cli-operation-invalid','视频写入需要稳定的 --operation（1–128位字母数字、点、下划线或连字符）。');
 const hash=digest('art-workshop/video/cli/'+value);
 return `video-${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
async function readRecord(root,path){
 const file=await projectPath(root,path);
 try{const info=await stat(file);if(!info.isFile()||info.size>64*1024*1024)throw new Error('视频操作记录不是有效文件');return JSON.parse(await readFile(file,'utf8'));}
 catch(error){if(error.code==='ENOENT')return null;throw fail('video-cli-record-unknown','视频原操作记录不可读取，请保留并核对，不得重投。',{unknown:true,cause:error});}
}
async function syncFile(file){const handle=await open(file,'r+');try{await handle.sync();}finally{await handle.close();}}
async function durableCreate(root,path,value,{raw=false}={}){
 let file=await projectPath(root,path);await mkdir(dirname(file),{recursive:true});file=await projectPath(root,path);
 const handle=await open(file,'wx',0o600);try{await handle.writeFile(raw?value:JSON.stringify(value));await handle.sync();}finally{await handle.close();}
}
async function durableReceipt(file,value){await atomicJson(file,value);await syncFile(file);}
const terminal=receipt=>receipt&&['succeeded','failed','cancelled','submitted'].includes(receipt.status)&&!receipt.unknown;
function receiptResult(receipt){
 if(!terminal(receipt))throw fail('video-execution-unknown','原操作结果未知；请查询原身份，不得再次执行。',{unknown:true,operationId:receipt.operationId});
 if(!Object.hasOwn(receipt,'result'))throw fail(receipt.error?.code||'video-failed',receipt.error?.message||'原操作已失败，保留原回执。',{operationId:receipt.operationId});
 const metadata={operationId:receipt.operationId,originOperationId:receipt.originOperationId||null,status:receipt.status},value=receipt.result;
 return value&&typeof value==='object'&&!Array.isArray(value)?{...value,cliExecution:metadata}:{result:value,cliExecution:metadata};
}
export async function readChannelOperation({root,operationId}){
 const id=videoExecutionId(operationId),value=await readRecord(root,`${base}/operations/${id}.json`);
 if(!value)return {operationId:id,originOperationId:operationId,status:'not-found'};
 if(value.version!==1||value.operationId!==id)throw fail('video-cli-record-unknown','原操作意图格式损坏，请人工核对。',{unknown:true,operationId:id});
 return {...value,status:value.status==='executing'?'unknown':value.status,unknown:value.unknown===true||['executing','unknown'].includes(value.status)};
}
async function claimSharedIntent(root,operationId,request){
 const semanticDigest=digest(canonical(request)),path=`${base}/unresolved/${semanticDigest}.json`,file=await projectPath(root,path),prior=await readRecord(root,path);
 if(prior){
  if(prior.version!==1||prior.semanticDigest!==semanticDigest||!validExecution(prior.operationId))throw fail('business-intent-corrupt','未决操作索引损坏，不得重投。',{unknown:true,operationId:prior.operationId||operationId});
  const receipt=await readChannelOperation({root,operationId:prior.operationId});
  if(!terminal(receipt))throw fail('business-intent-unresolved','相同业务请求已有未决原操作；不能换入口或身份再次执行。',{unknown:true,operationId:prior.operationId});
  await rm(file);
 }
 const value={version:1,operationId,semanticDigest,action:request.action,origin:'cli',createdAt:new Date().toISOString()},raw=JSON.stringify(value);
 await durableCreate(root,path,raw,{raw:true});
 return {semanticDigest,async release(){if(await readFile(file,'utf8').catch(()=>null)===raw)await rm(file,{force:true});}};
}
/** CLI admission shares DSH's unresolved claims and receipt format, not a second video state machine. */
export async function executeChannelOperation({root,workspaceId,operationId:originOperationId,action,input,execute,writeReceipt=durableReceipt}){
 const operationId=videoExecutionId(originOperationId),request={action,input},raw=JSON.stringify(request),requestDigest=digest(raw);
 return withResource(root,`${base}/cli-journal`,async()=>{
  const requestPath=`${base}/requests/${operationId}.json`,receiptPath=`${base}/operations/${operationId}.json`;
  const priorRequest=await readRecord(root,requestPath);
  if(priorRequest&&canonical(priorRequest)!==canonical(request))throw fail('video-operation-conflict','原视频执行身份已用于不同请求；保留原意图。',{operationId});
  const prior=await readChannelOperation({root,operationId});
  if(prior.status!=='not-found'){
   if(prior.workspaceId!==workspaceId||prior.semanticDigest&&prior.semanticDigest!==digest(canonical(request))||!priorRequest)throw fail('video-operation-conflict','原视频回执与当前请求不匹配。',{operationId});
   return receiptResult(prior);
  }
  if(!priorRequest)await durableCreate(root,requestPath,raw,{raw:true});
  const claim=await claimSharedIntent(root,operationId,request);
  const ledger={version:1,operationId,originOperationId,requestDigest,semanticDigest:claim.semanticDigest,workspaceId,action,origin:'cli',sessionId:null,status:'executing',createdAt:new Date().toISOString()};
  await durableCreate(root,receiptPath,ledger);
  let result;
  try{result=JSON.parse(JSON.stringify(await execute()));}
  catch(error){
   ledger.status='unknown';ledger.unknown=true;ledger.error={code:error.code||'video-cli-operation-unknown',message:error.message||'视频写入结果未知'};ledger.settledAt=new Date().toISOString();
   try{await writeReceipt(await projectPath(root,receiptPath),ledger);}catch{}
   throw fail(ledger.error.code,ledger.error.message,{unknown:true,operationId,cause:error});
  }
  const run=result?.operations?.find(operation=>operation.id===input.operationId)?.runs?.at(-1);
  ledger.result=result;ledger.status=run?.status==='unknown'?'unknown':run&&['running','dispatching'].includes(run.status)?'submitted':'succeeded';ledger.unknown=ledger.status==='unknown';ledger.settledAt=new Date().toISOString();
  try{await writeReceipt(await projectPath(root,receiptPath),ledger);}
  catch(error){throw fail('video-receipt-unknown','视频业务已返回但回执未完整落盘；请核对原操作，不得重投。',{unknown:true,operationId,cause:error});}
  if(ledger.status!=='unknown')await claim.release().catch(()=>{});
  return receiptResult(ledger);
 });
}
