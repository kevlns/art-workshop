import {environmentRoot,writeMarker} from './environments.mjs';
import {existsSync,mkdirSync,createReadStream,renameSync,rmSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawnDeploymentCommand,deploymentCommandError} from './deployment-process.mjs';
import {ensureDeploymentSource} from './deployment-source.mjs';
import {createHash} from 'node:crypto';
import {readJson,writeJson,hash} from './shared.mjs';
import {loadSettings} from './settings.mjs';
import {ownedPath} from './workspace.mjs';
import {locked,sleep,stateRead} from './runtime.mjs';
import {processIdentity,stopIdentity,ensureService} from './service.mjs';
import {LOCAL_RECIPE,validateDeploymentPlan} from './deployment.mjs';
import {loadBackend,BUILTIN_WORKFLOW} from './workflows.mjs';
import {inspectEnvironment} from './diagnostics.mjs';
import {generate} from './providers.mjs';
import {cancelPrompt} from './comfyui.mjs';
import {finishPlan} from './plan.mjs';
import {bindBackend} from './backends.mjs';
import {validateImage} from './images.mjs';

const file=process.argv[2],state=readJson(file),plan=state.plan,settings=loadSettings({file:plan.settingsFile});
const persist=()=>{state.heartbeat=new Date().toISOString();writeJson(file,state);};
const cancelled=()=>existsSync(file+'.cancel');
const check=()=>{if(cancelled())throw new Error('部署已取消');};
const stage=value=>{state.stage=value;persist();check();};
state.workerPid=process.pid;state.status='running';persist();const heartbeat=setInterval(persist,1000);
let childIdentity,unsettled=false;
async function command(executable,args,cwd){
 check();const child=spawnDeploymentCommand(executable,args,cwd);
 const completion=new Promise((resolve,reject)=>{child.once('error',error=>reject(deploymentCommandError(executable,error)));child.once('exit',(code)=>code===0?resolve():reject(new Error('部署命令 '+executable+' 失败，退出码 '+code)));});
 // Attach rejection immediately while awaiting the process identity.
 completion.catch(()=>{});await sleep(100);childIdentity=child.pid?processIdentity(child.pid):null;
 let stopping;
 const timer=setInterval(()=>{if(cancelled()&&childIdentity){clearInterval(timer);stopping=stopIdentity(childIdentity).catch(()=>{unsettled=true;});}},100);
 try{await completion;check();}finally{clearInterval(timer);if(stopping)await stopping;if(childIdentity&&processIdentity(childIdentity.pid)){try{await stopIdentity(childIdentity);}catch{unsettled=true;}}childIdentity=null;}
}
async function sha256(path){const digest=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path)){check();digest.update(chunk);bytes+=chunk.length;state.processedBytes=bytes;}return digest.digest('hex');}
const repository=(path,source)=>ensureDeploymentSource(path,source,{control:environmentRoot(plan.installRoot),command,check});

try{
 validateDeploymentPlan(plan,settings);
 const control=environmentRoot(plan.installRoot),claim=ownedPath(control,'deployment.json');
 await locked(control,'install',async()=>{
  const old=stateRead(claim);if(old&&old.deploymentId!==state.deploymentId&&old.stopConfirmed!==true)throw new Error('该安装目录已有运行或停止未知的部署，禁止重复操作');
  writeJson(claim,{deploymentId:state.deploymentId,workspace:plan.workspace,status:'running',stopConfirmed:false});
  try{
   stage('校验固定源码与节点');await repository(ownedPath(plan.installRoot,'ComfyUI'),LOCAL_RECIPE.comfy);
   await repository(ownedPath(plan.installRoot,'ComfyUI/custom_nodes/ComfyUI-GGUF'),LOCAL_RECIPE.plugin);
   const venvOwner=ownedPath(control,'venv-owned.json'),ownedVenv=stateRead(venvOwner);
   const installPython=!plan.portable&&(!existsSync(plan.python)||ownedVenv?.recipeHash===hash(LOCAL_RECIPE));
   if(installPython){
    if(!existsSync(plan.python)){writeJson(venvOwner,{recipeHash:hash(LOCAL_RECIPE),python:plan.python});stage('创建独立 Python 环境');await command(plan.basePython,['-m','venv',ownedPath(plan.installRoot,'.venv')],plan.installRoot);}
    stage('安装 CUDA 运行依赖');await command(plan.python,['-m','pip','install','torch=='+LOCAL_RECIPE.torch,'torchvision=='+LOCAL_RECIPE.torchvision,'--index-url',LOCAL_RECIPE.torchIndex],plan.installRoot);
    await command(plan.python,['-m','pip','install','-r',ownedPath(plan.installRoot,'ComfyUI/requirements.txt'),'gguf=='+LOCAL_RECIPE.gguf,'sentencepiece','protobuf'],plan.installRoot);
   }
   stage('核验 Python 与 CUDA');await command(plan.python,['-c',`import torch,gguf; import importlib.metadata as m; assert torch.cuda.is_available(), 'NVIDIA CUDA unavailable'; assert torch.__version__.split('+')[0]=='${LOCAL_RECIPE.torch}', 'Torch version differs'; assert m.version('gguf')=='${LOCAL_RECIPE.gguf}', 'GGUF version differs'`],plan.installRoot);
   for(const model of LOCAL_RECIPE.models){
    const destination=ownedPath(plan.installRoot,'ComfyUI/models',model.path);stage('校验模型 '+model.path);state.processedBytes=0;
    if(existsSync(destination)){if(await sha256(destination)!==model.sha256)throw new Error('现有模型哈希不匹配，保留原文件：'+model.path);continue;}
    stage('下载模型 '+model.path);mkdirSync(dirname(destination),{recursive:true});const temporary=ownedPath(control,hash(model.path)+'.part');
    try{await command('curl.exe',['--fail','--location','--retry','2','--connect-timeout','20','--max-time','7200','--output',temporary,model.url],plan.installRoot);if(await sha256(temporary)!==model.sha256)throw new Error('下载模型哈希校验失败');check();if(existsSync(destination))throw new Error('模型目标被其他操作创建，禁止覆盖');renameSync(temporary,destination);}finally{rmSync(temporary,{force:true});}
   }
   const configured={...settings,generation:{defaultBackend:'local-qwen',defaults:{},backends:{'local-qwen':{provider:'comfyui',model:LOCAL_RECIPE.models[0].path.split('/').at(-1),endpoints:[plan.endpoint],launch:{executable:plan.python,cwd:plan.installRoot,args:['-s','ComfyUI/main.py','--disable-dynamic-vram','--lowvram','--disable-auto-launch',...(new URL(plan.endpoint).port?['--port',new URL(plan.endpoint).port]:[])]}}}}};
   stage('检测固定工作流与环境');const backend=loadBackend(configured,'local-qwen'),endpoint=await ensureService(backend,join(control,'runtime'),{cancelled});
   const report=await inspectEnvironment(endpoint,backend);if(!report.ok)throw new Error('部署环境检查未通过');state.environment=report;
   // Readiness is proved by generation and editing, rather than a listening port.
   const {queue_running=[],queue_pending=[]}=await(await fetch(new URL('/queue',endpoint))).json();if(queue_running.length||queue_pending.length)throw new Error('现有服务正在执行其他任务，本次不插入验收采样；任务结束后重试部署验证');
   const output=ownedPath(control,'verification',state.deploymentId);mkdirSync(output,{recursive:true});
   let source;
   for(const mode of ['generate','edit']){
    stage(mode==='generate'?'单图生成验证':'底图编辑验证');
    const base=finishPlan({module:mode,project:'deployment',job:'verification',execution:{model:LOCAL_RECIPE.models[0].path.split('/').at(-1),size:'512*512',perValue:1,promptExtend:false,watermark:false},sources:{recipe:LOCAL_RECIPE.id},snapshots:{},refs:[],items:[{itemId:'verification',variantId:'base',seed:7619,prompt:mode==='generate'?'一个圆润的青绿色科幻能量球，简洁轮廓，柔和高光，纯白背景。':'保持原图轮廓和构图，将主体颜色改成金黄色。',negativeBlock:'文字，水印',imageArgs:mode==='edit'?[source]:[],checks:{content:[],style:[],asset:[]}}]});
    const modeOutput=ownedPath(output,mode);mkdirSync(modeOutput,{recursive:true});
    const bound=bindBackend(base,configured,'local-qwen'),result=await generate(bound,bound.items[0],{endpoint,root:join(control,'runtime'),outputDir:modeOutput,prefix:mode,cancelled,onPrompt:promptId=>{state.promptId=promptId;persist();}});
    state.promptId=null;const path=ownedPath(modeOutput,result.files[0]),info=await validateImage(readFileSync(path));if(info.width!==512||info.height!==512)throw new Error('部署验证图片尺寸不符');source=path;state.verification??=[];state.verification.push({mode,path,hash:await sha256(path),planHash:bound.planHash});persist();
   }
   stage('保存已验证部署配置');for(const evidence of state.verification)if(await sha256(evidence.path)!==evidence.hash)throw new Error('部署采样证据发生变化，不保存完成状态');const raw=readJson(settings.file);raw.generation={...raw.generation,defaultBackend:'local-qwen',backends:{...raw.generation?.backends,'local-qwen':configured.generation.backends['local-qwen']}};writeJson(settings.file,raw);
   writeMarker(plan.installRoot,{python:plan.portable?'python_embeded/python.exe':'.venv/Scripts/python.exe',endpoint:plan.endpoint,recipe:LOCAL_RECIPE.id,verification:'generate-and-edit'});state.status='succeeded';state.stopConfirmed=true;state.workflow=BUILTIN_WORKFLOW;
  }catch(error){
   if(error.unsettled&&!state.promptId)unsettled=true;
   if(state.promptId){try{await cancelPrompt(plan.endpoint,state.promptId);state.promptId=null;}catch{unsettled=true;}}
   state.status=unsettled?'unknown':cancelled()?'cancelled':'failed';state.stopConfirmed=!unsettled;state.error=error.message;
  }finally{writeJson(claim,{deploymentId:state.deploymentId,workspace:plan.workspace,status:state.status,stopConfirmed:state.stopConfirmed});}
 });
}catch(error){if(error.unsettled)unsettled=true;state.status=unsettled?'unknown':cancelled()?'cancelled':'failed';state.stopConfirmed=!unsettled;state.error=error.message;}
finally{clearInterval(heartbeat);state.finishedAt=new Date().toISOString();persist();}
