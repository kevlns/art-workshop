import {spawn,execFileSync} from 'node:child_process';
import {openSync,closeSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {writeJson,hash} from './shared.mjs';
import {http,sleep,locked,stateRead,alive} from './runtime.mjs';
import {inspectEnvironment,workflowError} from './diagnostics.mjs';

export function processIdentity(pid) {
  if(!Number.isSafeInteger(pid)||pid<1)return null;
  try {
    if(process.platform==='win32') {
      const script=`$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if($p){[pscustomobject]@{pid=$p.ProcessId;exe=$p.ExecutablePath;created=$p.CreationDate.ToUniversalTime().ToString('o');command=$p.CommandLine}|ConvertTo-Json -Compress}`;
      const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true}).trim();
      return output?JSON.parse(output):null;
    }
    const created=execFileSync('ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8'}).trim();
    const command=execFileSync('ps',['-p',String(pid),'-o','args='],{encoding:'utf8'}).trim();
    return created?{pid,created,command}:null;
  }catch{return null;}
}
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
function serviceFile(root,endpoint){return join(root,'services',hash(endpoint)+'.json');}
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
  return locked(root,'services',async()=>{
    if(stateRead(join(root,'shutdown.json')))throw new Error('服务正在 shutdown');
    const incompatible=[];
    for(const endpoint of backend.endpoints) {
      let report;try{report=await inspectEnvironment(endpoint,backend);}catch{continue;}
      if(!report.ok){incompatible.push(report);continue;}
      const file=serviceFile(root,endpoint),previous=stateRead(file);
      const identity=previous?.identity&&hash(processIdentity(previous.identity.pid))===hash(previous.identity)?previous.identity:externalIdentity(endpoint,backend.launch);
      writeJson(file,{endpoint,backend:backend.id,identity,owned:previous?.owned??false,observedAt:new Date().toISOString()});
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
    writeJson(file,{endpoint,backend:backend.id,identity,owned:true,logPath});
    const deadline=Date.now()+(backend.launch.startupTimeoutSeconds??120)*1000;
    try {
      while(Date.now()<deadline){if(cancelled())throw new Error('任务已取消');let report;try{report=await inspectEnvironment(endpoint,backend);}catch{};if(report?.ok)return endpoint;if(report){const error=workflowError('启动后的 ComfyUI 环境无法执行工作流，查看 '+logPath,backend,{stage:'environment'});error.diagnostic.environments=[report];throw error;}if(!alive(child.pid))throw new Error('ComfyUI 进程提前退出，查看 '+logPath);await sleep(300);}
      throw new Error('ComfyUI 启动超时，查看 '+logPath);
    }catch(error){await stopIdentity(identity);throw error;}
  });
}
export function rememberedService(root,endpoint){return stateRead(serviceFile(root,endpoint));}
export async function closeService(root,endpoint,backend) {
  const remembered=rememberedService(root,endpoint);
  const previous=remembered?.identity;
  const identity=previous&&hash(processIdentity(previous.pid))===hash(previous)?previous:externalIdentity(endpoint,backend.launch);
  if(!identity){if(await healthy(endpoint,backend))throw new Error('无法验证服务进程身份：'+endpoint);return {endpoint,stopped:false};}
  await stopIdentity(identity);
  if(await healthy(endpoint,backend))throw new Error('关闭进程后服务仍可访问：'+endpoint);
  writeJson(serviceFile(root,endpoint),{endpoint,stopped:true,stoppedAt:new Date().toISOString()});
  return {endpoint,stopped:true};
}
