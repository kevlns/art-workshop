import {processIdentity} from './process-identity.mjs';
export {processIdentity} from './process-identity.mjs';
import {homedir} from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {openSync,closeSync,existsSync,readdirSync} from 'node:fs';
import {createServer} from 'node:net';
import {join,resolve} from 'node:path';
import {writeJson,hash} from './shared.mjs';
import {http,sleep,locked,stateRead,alive} from './runtime.mjs';
import {inspectEnvironment,workflowError} from './diagnostics.mjs';

export async function stopIdentity(identity,{timeout=10000}={}) {
  const current=processIdentity(identity.pid);
  if(!current)return;
  if(hash(current)!==hash(identity))throw new Error('服务进程身份已变化，拒绝终止复用的 PID');
  if(process.platform==='win32')execFileSync('taskkill.exe',['/PID',String(identity.pid),'/T','/F'],{windowsHide:true});
  else process.kill(identity.pid,'SIGTERM');
  const deadline=Date.now()+timeout;
  while(alive(identity.pid)){if(Date.now()>deadline)throw new Error('服务进程未停止');await sleep(100);}
}
export async function healthy(endpoint,backend) {
  try {
    const stats=await http(endpoint,'/system_stats',{timeout:2000});if(!stats.system?.comfyui_version)return false;
    const [major,minor]=stats.system.comfyui_version.split('.').map(Number);
    if(major===0&&minor<39)return false;
    if(backend.template){const nodes=await http(endpoint,'/object_info',{timeout:4000});for(const n of Object.values(backend.template))if(!nodes[n.class_type])return false;}
    return stats;
  }catch{return false;}
}
export const serviceRoot=()=>join(process.env.VANT_HOME??join(homedir(),'.vant'),'state','art-services');
function serviceFile(root,endpoint){return join(serviceRoot(),'services',hash(endpoint)+'.json');}
export function externalIdentity(endpoint,launch) {
  if(process.platform!=='win32'||!launch)return null;
  const port=Number(new URL(endpoint).port||80);
  const script=`Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ConvertTo-Json -Compress`;
  let pids;try{pids=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true}).trim()||'null');}catch{return null;}
  for(const pid of [].concat(pids??[])) {
    const p=processIdentity(pid);
    if(!p?.exe||resolve(p.exe).toLowerCase()!==resolve(launch.executable).toLowerCase())continue;
    // Require the configured entrypoint, not just a Python interpreter or an occupied port.
    const entry=launch.args.find(x=>/main\.py$|\.mjs$|\.js$/.test(x));
    if(!entry||!p.command.toLowerCase().includes(entry.toLowerCase()))continue;
    return p;
  }
  return null;
}
export async function ensureService(backend,root,{cancelled=()=>false}={}) {
  root=serviceRoot();
  return locked(root,'services',async()=>{
    if(stateRead(join(root,'shutdown.json')))throw new Error('服务正在 shutdown');
    const incompatible=[];
    for(const endpoint of backend.endpoints) {
      let report;try{report=await inspectEnvironment(endpoint,backend);}catch{continue;}
      if(!report.ok){incompatible.push(report);continue;}
      const file=serviceFile(root,endpoint),previous=stateRead(file);
      const identity=previous?.identity&&hash(processIdentity(previous.identity.pid))===hash(previous.identity)?previous.identity:externalIdentity(endpoint,backend.launch);
      const sameOwner=!!(identity&&previous?.owned&&hash(previous.identity)===hash(identity));
      writeJson(file,{endpoint,backend:backend.id,identity,owned:sameOwner,...(sameOwner&&previous.owner?{owner:previous.owner}:{}),observedAt:new Date().toISOString()});
      return endpoint;
    }
    if(incompatible.length){const error=workflowError('现有 ComfyUI 环境无法执行工作流',backend,{stage:'environment'});error.diagnostic.environments=incompatible;throw error;}
    if(!backend.launch)throw new Error('没有可用 ComfyUI，也未配置 launch');
    if(cancelled())throw new Error('任务已取消');
    const endpoint=backend.endpoints[0],file=serviceFile(root,endpoint),previous=stateRead(file);
    if(previous?.identity&&hash(processIdentity(previous.identity.pid))===hash(previous.identity))throw new Error('现有服务不健康，请先 shutdown；不重复启动');
    const logPath=join(root,'comfyui-'+hash(endpoint).slice(0,8)+'.log'),fd=openSync(logPath,'a');
    const child=spawn(backend.launch.executable,backend.launch.args,{cwd:backend.launch.cwd,detached:true,windowsHide:true,stdio:['ignore',fd,fd]});closeSync(fd);
    let spawnError;child.once('error',error=>{spawnError=error;});child.unref();
    await sleep(100);
    if(spawnError||!child.pid)throw spawnError??new Error('服务启动失败');
    const identity=processIdentity(child.pid);if(!identity)throw new Error('无法记录服务进程身份');
    writeJson(file,{endpoint,backend:backend.id,identity,owned:true,...(process.env.VANT_SERVICE_INSTANCE?{owner:{application:'vant',instanceId:process.env.VANT_SERVICE_INSTANCE}}:{}),logPath});
    const deadline=Date.now()+(backend.launch.startupTimeoutSeconds??120)*1000;
    try {
      while(Date.now()<deadline){if(cancelled())throw new Error('任务已取消');let report;try{report=await inspectEnvironment(endpoint,backend);}catch{};if(report?.ok)return endpoint;if(report){const error=workflowError('启动后的 ComfyUI 环境无法执行工作流，查看 '+logPath,backend,{stage:'environment'});error.diagnostic.environments=[report];throw error;}if(!alive(child.pid))throw new Error('ComfyUI 进程提前退出，查看 '+logPath);await sleep(300);}
      throw new Error('ComfyUI 启动超时，查看 '+logPath);
    }catch(error){await stopIdentity(identity);throw error;}
  });
}
export function rememberedService(root,endpoint){return stateRead(serviceFile(root,endpoint));}
// Application exit never adopts an external process as a termination target.
export async function shutdownOwnedServices() {
  return locked(serviceRoot(),'control',async()=>{
    const folder=join(serviceRoot(),'services'),results=[],failures=[];
    for(const name of existsSync(folder)?readdirSync(folder):[]) {
      if(!name.endsWith('.json'))continue;
      const file=join(folder,name),record=stateRead(file);
      if(record?.owned!==true||record.owner?.application!=='vant'||record.stopped)continue;
      try {
        if(!record.identity)throw new Error('缺少服务进程身份，不能确认停止');
        const url=new URL(record.endpoint);
        if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('服务地址不是本机回环地址');
        if(name!==hash(record.endpoint)+'.json')throw new Error('服务记录身份不匹配');
        await stopIdentity(record.identity);
        const deadline=Date.now()+15000;
        while(true){
          try {
            await new Promise((resolve,reject)=>{
              const probe=createServer();probe.once('error',reject);
              probe.listen({host:'127.0.0.1',port:Number(url.port||80),exclusive:true},()=>probe.close(error=>error?reject(error):resolve()));
            });
            break;
          }catch(error){if(error.code!=='EADDRINUSE'||Date.now()>deadline)throw error;await sleep(200);}
        }
        writeJson(file,{...record,owned:false,stopped:true,stoppedAt:new Date().toISOString()});
        results.push({endpoint:record.endpoint,stopped:true,portReleased:true});
      }catch(error){failures.push(record.endpoint+': '+error.message);}
    }
    if(failures.length)throw new Error('本机服务清理未确认：'+failures.join('; '));
    return results;
  });
}
export async function closeService(root,endpoint,backend) {
 return locked(serviceRoot(),'queue-'+new URL(endpoint).port,()=>closeSharedService(serviceRoot(),endpoint,backend));
}
async function closeSharedService(root,endpoint,backend) {
 if(await healthy(endpoint,backend)){const queue=await http(endpoint,'/queue');if((queue.queue_running??[]).length||(queue.queue_pending??[]).length)throw new Error('共享服务仍有其他任务，保留服务');}
  const remembered=rememberedService(root,endpoint);
  const previous=remembered?.identity;
  const identity=previous&&hash(processIdentity(previous.pid))===hash(previous)?previous:externalIdentity(endpoint,backend.launch);
  if(!identity){if(await healthy(endpoint,backend))throw new Error('无法验证服务进程身份：'+endpoint);return {endpoint,stopped:false};}
  await stopIdentity(identity);
  if(await healthy(endpoint,backend))throw new Error('关闭进程后服务仍可访问：'+endpoint);
  writeJson(serviceFile(root,endpoint),{endpoint,stopped:true,stoppedAt:new Date().toISOString()});
  return {endpoint,stopped:true};
}
