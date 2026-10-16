import {processIdentity} from './process-identity.mjs';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {readJson,writeJson,hash} from './shared.mjs';
import {readObject,objectFile,objectDirectory} from './workspace.mjs';
import {callBailian} from './transport/cli.mjs';
import {callVision} from './vision.mjs';
import {analyzeStyle} from './analyze.mjs';
import {analyzeTaskReferences} from './task-references.mjs';
import {extractText} from './bl.mjs';
const file=process.argv[2],task=readJson(file);
const persist=()=>{task.heartbeat=new Date().toISOString();writeJson(file,task);};
const cancelled=()=>existsSync(file+'.cancel')||existsSync(join(task.root,'shutdown.json'));
task.workerPid=process.pid;task.workerIdentity=processIdentity(process.pid);task.status='running';persist();const heartbeat=setInterval(persist,1000);
let responseIndex=0;
try{
 const analyzer=task.objectKind==='task'?analyzeTaskReferences:analyzeStyle;
 const report=await analyzer({projectId:task.project,input:task.input,root:task.workspace,refsDir:task.workspace,analysisModel:task.model,cacheDir:join(task.cache,'analysis'),onProgress:progress=>{if(cancelled())throw new Error('分析已取消');task.currentItem={...progress,startedAt:new Date().toISOString()};persist();},runner:async args=>{if(cancelled())throw new Error('分析已取消');const call=process.env.ART_VISION_CONFIG?callVision:callBailian;const response=await call([...args,'--output','json'],{cancelled,onRemoteCancel:()=>{task.remoteCancellation='client-stopped; upstream execution cannot be confirmed';task.unsettled=true;persist();}});const evidence=join(objectDirectory(task.workspace,task.project,task.objectKind,task.objectId),'reports',task.taskId,'responses',String(++responseIndex)+'.json');writeJson(evidence,{stage:task.currentItem,text:extractText(response).join('\n')});return response;}});
 if(cancelled())throw new Error('分析已取消');
 {
  // This run owns the object until its final heartbeat; mutation entrypoints refuse active runs.
  const record=readObject(task.workspace,task.project,task.objectKind,task.objectId);
  if(record.revision!==task.sourceRevision||record.status!=='draft'||hash({config:record.config,references:record.references})!==task.sourceHash)throw new Error('分析来源已变化，不回填旧结果');
  const reportPath=join(objectDirectory(task.workspace,task.project,task.objectKind,task.objectId),'reports',task.taskId,'report.json');writeJson(reportPath,report);
  record.report={data:report,runId:task.taskId,sourceHash:task.sourceHash,sourceRevision:task.sourceRevision,path:reportPath};record.revision++;record.updatedAt=new Date().toISOString();writeJson(objectFile(task.workspace,task.project,task.objectKind,task.objectId),record);task.reportPath=reportPath;
 }task.status='succeeded';
}catch(error){task.status=cancelled()?'cancelled':'failed';task.error=error.message;}
finally{clearInterval(heartbeat);task.stopConfirmed=!task.unsettled&&!task.remoteCancellation;task.finishedAt=new Date().toISOString();persist();}
