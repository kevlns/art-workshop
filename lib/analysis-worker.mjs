import {errorDetail} from './errors.mjs';
import {assertReportIdentity} from './style-report.mjs';
import {startHeartbeat} from './heartbeat.mjs';
import {processIdentity} from './process-identity.mjs';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {readJson,writeJson,hash} from './shared.mjs';
import {readObject,objectFile,objectDirectory} from './workspace.mjs';
import {syncStyleCore} from './core.mjs';
import {locked} from './runtime.mjs';
import {callBailian} from './transport/cli.mjs';
import {callVision} from './vision.mjs';
import {analyzeStyle} from './analyze.mjs';
import {analyzeTaskReferences} from './task-references.mjs';
import {extractText} from './bl.mjs';
const file=process.argv[2],task=readJson(file);
const persist=()=>{task.heartbeat=new Date().toISOString();writeJson(file,task);};
const cancelled=()=>existsSync(file+'.cancel')||existsSync(join(task.root,'shutdown.json'));
task.workerPid=process.pid;task.workerIdentity=processIdentity(process.pid);task.status='running';persist();const heartbeat=startHeartbeat(persist);
let responseIndex=0;
try{
 const analyzer=task.objectKind==='task'?analyzeTaskReferences:analyzeStyle;
 const report=await analyzer({projectId:task.project,input:task.input,root:task.workspace,refsDir:task.workspace,analysisModel:task.model,cacheDir:join(task.cache,'analysis'),onProgress:progress=>{if(cancelled())throw new Error('分析已取消');task.currentItem={...progress,startedAt:new Date().toISOString()};persist();},runner:async args=>{if(cancelled())throw new Error('分析已取消');const call=process.env.ART_VISION_CONFIG?callVision:callBailian;let captured=false;const capture=data=>{writeJson(join(objectDirectory(task.workspace,task.project,task.objectKind,task.objectId),'reports',task.taskId,'responses',String(++responseIndex)+'.json'),{stage:task.currentItem,...data});captured=true;};const response=await call([...args,'--output','json'],{cancelled,onEvidence:capture,onRemoteCancel:()=>{task.remoteCancellation='client-stopped; upstream execution cannot be confirmed';task.unsettled=true;persist();}});if(!captured)capture({text:extractText(response).join('\n')});return response;}});
 if(cancelled())throw new Error('分析已取消');
 await locked(task.root,'control',async()=>{
  // A style may be edited during analysis. Commit only if its source revision still matches.
  const record=readObject(task.workspace,task.project,task.objectKind,task.objectId);
  if(record.revision!==task.sourceRevision||!['draft',...(task.objectKind==='style'?['frozen']:[])].includes(record.status)||hash({config:record.config,references:record.references})!==task.sourceHash)throw new Error('分析来源已变化，不回填旧结果');
  assertReportIdentity(report,{project:task.project,id:task.objectId});
  const reportPath=join(objectDirectory(task.workspace,task.project,task.objectKind,task.objectId),'reports',task.taskId,'report.json');writeJson(reportPath,report);
  record.report={data:report,runId:task.taskId,sourceHash:task.sourceHash,sourceRevision:task.sourceRevision,path:reportPath};record.revision++;record.updatedAt=new Date().toISOString();
  const rollback=task.objectKind==='style'?syncStyleCore(task.workspace,record):()=>{};
  try{writeJson(objectFile(task.workspace,task.project,task.objectKind,task.objectId),record);}catch(error){rollback();throw error;}task.reportPath=reportPath;
 });task.status='succeeded';
}catch(error){task.status=cancelled()?'cancelled':'failed';task.error=error.message;task.errorDetail=errorDetail(error,task.currentItem?.stage??'preflight');}
finally{clearInterval(heartbeat);task.stopConfirmed=!task.unsettled&&!task.remoteCancellation;task.finishedAt=new Date().toISOString();persist();}
