import {existsSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readJson,writeJson,hash} from './shared.mjs';
import {sha256File} from './bl.mjs';
import {validatePlan} from './plan.mjs';
import {externalPath} from './settings.mjs';
import {ensureService} from './service.mjs';
import {generate,generationRequest} from './providers.mjs';
import {cancelPrompt} from './comfyui.mjs';

const file=process.argv[2],task=readJson(file);
const cancelled=()=>existsSync(file+'.cancel')||existsSync(join(task.root,'shutdown.json'));
const persist=()=>{task.heartbeat=new Date().toISOString();writeJson(file,task);};
task.workerPid=process.pid;task.status='running';persist();
const heartbeat=setInterval(persist,1000);
let manifest,manifestPath;
function saveManifest(){if(!manifest)return;manifest.summary={expected:task.items.length,completed:manifest.items.filter(x=>x.status!=='running').length,ok:manifest.items.filter(x=>x.ok).length,failed:manifest.items.filter(x=>x.status==='failed').length,cancelled:manifest.items.filter(x=>x.status==='cancelled').length};writeJson(manifestPath,manifest);}
try {
  validatePlan(task.plan);externalPath(task.outputRoot,'输出目录');
  for(const ref of task.plan.refs)if(sha256File(externalPath(ref.path))!==ref.hash)throw new Error('原图/参考图已变化：'+ref.path);
  const runDir=join(task.outputRoot,task.plan.job+'-'+task.taskId);
  manifestPath=join(runDir,'manifest.json');
  task.manifestPath=manifestPath;
  manifest={schema:'art-workshop/run',runId:task.taskId,taskId:task.taskId,plan:task.plan,planHash:task.plan.planHash,provider:task.plan.backend?.provider??'bailian',startedAt:new Date().toISOString(),items:[],review:[],selections:{}};saveManifest();persist();
  const backend=task.plan.backend;
  if(backend?.provider==='comfyui')task.endpoint=await ensureService(backend,task.root,{cancelled});
  for(const item of task.items) {
    if(cancelled())break;
    task.currentItem={itemId:item.itemId,variantId:item.variantId};persist();
    const record={...structuredClone(item),ok:false,status:'running',files:[],urls:[],outputHashes:{}};
    manifest.items.push(record);saveManifest();
    try {
      const before=new Set(readdirSync(runDir));
      const request=generationRequest(task.plan,item);
      record.request=request;saveManifest();
      const result=await generate(task.plan,item,{endpoint:task.endpoint,root:task.root,outputDir:runDir,prefix:`${item.itemId}--${item.variantId}`,cancelled,onPrompt:promptId=>{task.promptId=promptId;persist();},onRemoteCancel:()=>{task.remoteCancellation='client-stopped; upstream execution cannot be confirmed';}});
      if(result.files)record.files=result.files;
      else {
        record.urls=result.urls??[];
        const fresh=readdirSync(runDir).filter(f=>!before.has(f)&&/\.(png|jpe?g|webp)$/i.test(f)).sort();
        for(const [index,source] of fresh.entries()){const target=`${item.itemId}--${item.variantId}${index?'--'+(index+1):''}${source.slice(source.lastIndexOf('.'))}`;if(source!==target){if(existsSync(join(runDir,target)))throw new Error('产物已存在');renameSync(join(runDir,source),join(runDir,target));}record.files.push(target);}
      }
      if(record.files.length!==(item.execution??task.plan.execution).perValue)throw new Error('生成数量与计划不符');
      for(const image of record.files)record.outputHashes[image]=sha256File(join(runDir,image));
      record.ok=true;record.status='generated';
    }catch(error){
      if(backend?.provider==='comfyui'&&task.promptId)try{await cancelPrompt(task.endpoint,task.promptId);task.promptId=null;}catch(stopError){error.unsettled=true;error.message+='；无法确认后端停止：'+stopError.message;}
      if(error.unsettled)task.unsettled=true;
      record.status=cancelled()&&!error.unsettled?'cancelled':'failed';record.error=error.message;
      if(record.status==='failed'){task.error=error.message;if(error.diagnostic){record.diagnostic=error.diagnostic;task.diagnostic=error.diagnostic;}}
    }
    saveManifest();
  }
  if(cancelled())for(const item of task.items)if(!manifest.items.some(x=>x.inputHash===item.inputHash))manifest.items.push({...structuredClone(item),ok:false,status:'cancelled',files:[],urls:[],outputHashes:{},error:'任务已取消，未执行'});
  manifest.finishedAt=new Date().toISOString();saveManifest();
  task.status=task.unsettled?'failed':cancelled()?'cancelled':manifest.summary.failed?'failed':'succeeded';
}catch(error){task.status=cancelled()?'cancelled':'failed';task.error=error.message;if(error.diagnostic)task.diagnostic=error.diagnostic;if(manifest){manifest.error=error.message;manifest.diagnostic=error.diagnostic;manifest.finishedAt=new Date().toISOString();saveManifest();}}
finally{clearInterval(heartbeat);task.finishedAt=new Date().toISOString();persist();}
