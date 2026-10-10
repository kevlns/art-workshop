import {spawn} from 'node:child_process';
import {mkdirSync,openSync,closeSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {writeJson,hash} from './shared.mjs';
import {runtimeRoot,taskFile,tasks,stateRead,terminal,sleep,locked,alive,http} from './runtime.mjs';
import {closeService,healthy} from './service.mjs';
import {cancelPrompt} from './comfyui.mjs';
import {validatePlan} from './plan.mjs';

export function taskView(task) {
  const {schema,taskId,status,createdAt,heartbeat,finishedAt,workerPid,endpoint,promptId,manifestPath,error,diagnostic,remoteCancellation,unsettled,currentItem,logPath}=task;
  return {schema,taskId,status,createdAt,heartbeat,finishedAt,workerPid,endpoint,promptId,manifestPath,error,diagnostic,remoteCancellation,unsettled,currentItem,logPath,backend:task.plan?.backend?.id??'bailian'};
}

export function taskStatus(root,taskId) {
  const file=taskFile(root,taskId),task=stateRead(file);if(!task)throw new Error('任务不存在 '+taskId);
  if(!terminal(task.status)&&Date.now()-Date.parse(task.heartbeat??task.createdAt)>10000&&!alive(task.workerPid)) {
    task.status='lost';task.error='工作进程退出；后端任务可能仍在运行，请 task cancel 或 shutdown 清理';writeJson(file,task);
  }
  return task;
}
export async function startTask(plan,items,settings) {
  validatePlan(plan);if(!items.length)throw new Error('没有选中任务');
  for(const item of items)if(!plan.items.some(x=>hash(x)===hash(item)))throw new Error('执行项不属于计划');
  const root=runtimeRoot(settings);
  return locked(root,'control',async()=>{
    const gate=stateRead(join(root,'shutdown.json'));
    if(gate&&alive(gate.pid))throw new Error('shutdown 正在执行，不能启动任务');
    if(gate)rmSync(join(root,'shutdown.json'),{force:true});
    const taskId='task-'+randomUUID(),file=taskFile(root,taskId);
    const logPath=join(root,'tasks',taskId+'.log');
    const task={schema:'art-workshop/task',taskId,status:'queued',createdAt:new Date().toISOString(),plan,items,outputRoot:settings.paths.output,root,config:settings.file,logPath};
    writeJson(file,task);
    const fd=openSync(logPath,'a');
    const child=spawn(process.execPath,[fileURLToPath(new URL('./task-worker.mjs',import.meta.url)),file],{detached:true,windowsHide:true,stdio:['ignore',fd,fd]});closeSync(fd);
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();
    return {taskId,status:'queued',logPath};
  });
}
export async function waitTask(root,taskId,{timeoutSeconds=3600}={}) {
  const deadline=Date.now()+timeoutSeconds*1000;
  while(true){const state=taskStatus(root,taskId);if(terminal(state.status))return state;if(Date.now()>deadline)throw new Error('等待超时；任务仍在后台运行');await sleep(250);}
}
export async function cancelTask(root,taskId,{wait=true}={}) {
  const task=taskStatus(root,taskId);
  if(terminal(task.status)) {
    if(task.endpoint&&task.promptId){await cancelPrompt(task.endpoint,task.promptId);task.promptId=null;task.unsettled=false;if(task.status!=='succeeded')task.status='cancelled';writeJson(taskFile(root,taskId),task);}
    return taskStatus(root,taskId);
  }
  writeJson(taskFile(root,taskId)+'.cancel',{requestedAt:new Date().toISOString()});
  return wait?waitTask(root,taskId,{timeoutSeconds:60}):{taskId,status:'cancelling'};
}
export async function shutdown(settings) {
  const root=runtimeRoot(settings);
  return locked(root,'control',async()=>{
    const gate=join(root,'shutdown.json');writeJson(gate,{pid:process.pid,startedAt:new Date().toISOString()});
    const failures=[],stopped=[];
    try {
      const active=tasks(root).filter(t=>!terminal(taskStatus(root,t.taskId).status));
      for(const task of active)await cancelTask(root,task.taskId,{wait:false});
      const backends=Object.entries(settings.generation?.backends??{}).filter(([,b])=>b.provider==='comfyui').map(([id,b])=>({id,...b}));
      // Frozen tasks may refer to backends removed from the current configuration.
      for(const task of tasks(root))if(task.plan?.backend?.provider==='comfyui')backends.push(task.plan.backend);
      const endpoints=new Map();for(const b of backends)for(const endpoint of b.endpoints)endpoints.set(endpoint,b);
      for(const [endpoint,backend] of endpoints) {
        try {if(await healthy(endpoint,backend))await cancelPrompt(endpoint,null,{all:true});}
        catch(e){failures.push(endpoint+': '+e.message);}
      }
      for(const task of active)try{await waitTask(root,task.taskId,{timeoutSeconds:60});}catch(e){failures.push(task.taskId+': '+e.message);}
      // Never close the service while a live art worker is still using it.
      if(tasks(root).some(t=>!terminal(taskStatus(root,t.taskId).status)))throw new Error('任务尚未停止，保留服务：'+failures.join('; '));
      if(failures.length)throw new Error('任务停止尚未确认，保留服务：'+failures.join('; '));
      for(const [endpoint,backend] of endpoints)try{stopped.push(await closeService(root,endpoint,backend));}catch(e){failures.push(endpoint+': '+e.message);}
      if(failures.length)throw new Error('shutdown 未完整完成：'+failures.join('; '));
      return {ok:true,cancelledTasks:active.map(t=>t.taskId),remoteCancellationUnconfirmed:active.filter(t=>taskStatus(root,t.taskId).remoteCancellation).map(t=>t.taskId),services:stopped};
    }finally{rmSync(gate,{force:true});}
  });
}
