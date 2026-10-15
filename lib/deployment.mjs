import {existsSync,openSync,closeSync,statfsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {hash,readJson,writeJson,keys,id} from './shared.mjs';
import {externalPath} from './settings.mjs';
import {ownedPath} from './workspace.mjs';
import {runtimeRoot,locked,alive} from './runtime.mjs';
import {checkDeploymentCommand} from './deployment-process.mjs';

// This recipe is the tested local installation, not a user-editable workflow.
export const LOCAL_RECIPE={
 id:'qwen-image-2.1-Q4-cpu-text-v1',
 comfy:{repository:'https://github.com/Comfy-Org/ComfyUI',commit:'b0b743566f65daafc423b4fea8a2fbda94b3384a'},
 plugin:{repository:'https://github.com/leejet/ComfyUI-GGUF',commit:'373048b8403a7820620065210a691263d4da0a61'},
 models:[
  {path:'diffusion_models/qwen-image-2.1-UC-Q4_K_M.gguf',bytes:4_604_558_112,url:'https://huggingface.co/abenzerps/Qwen-Image-2.1-Uncensored-GGUF/resolve/main/qwen-image-2.1-UC-Q4_K_M.gguf',sha256:'e79c8a009f2ecbdb6c70fd663d9aea9ee304a0d91f347e4169a756b8ad141b41'},
  {path:'text_encoders/qwen3vl_8b_int8_convrot.safetensors',bytes:9_350_798_360,url:'https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors',sha256:'8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f'},
  {path:'vae/qwen_image_2.1_vae_bf16.safetensors',bytes:675_509_688,url:'https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors',sha256:'bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9'},
 ],
 torch:'2.14.0',torchvision:'0.29.0',torchIndex:'https://download.pytorch.org/whl/cu130',gguf:'0.19.0',
};
export function deploymentPlan(settings,{directory,endpoint='http://127.0.0.1:8188/'}={}){
 if(process.platform!=='win32')throw new Error('固定自动部署方案目前仅适配 Windows NVIDIA 环境');
 const target=ownedPath(externalPath(directory,'部署目录')),url=new URL(endpoint);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('部署服务地址必须为本机 HTTP 根地址');
 checkDeploymentCommand('git');
 let gpu;
 try{gpu=execFileSync('nvidia-smi',['--query-gpu=name,memory.total,driver_version','--format=csv,noheader,nounits'],{encoding:'utf8',windowsHide:true,timeout:10000}).trim().split('\n').filter(Boolean).map(line=>{const [name,memoryMiB,driver]=line.split(',').map(value=>value.trim());return {name,memoryMiB:Number(memoryMiB),driver};});if(!gpu.length||gpu.some(device=>!device.name||!Number.isFinite(device.memoryMiB)))throw new Error('GPU 信息无效');}
 catch{throw new Error('固定自动部署需要可检测的 NVIDIA GPU 与驱动，请先安装驱动');}
 const portable=existsSync(ownedPath(target,'python_embeded/python.exe')),venv=ownedPath(target,'.venv/Scripts/python.exe');
 let python=portable?ownedPath(target,'python_embeded/python.exe'):existsSync(venv)?venv:null,basePython=null;
 if(!python){try{basePython=execFileSync('python',['-c','import sys; assert sys.version_info >= (3,12); print(sys.executable)'],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();}catch{throw new Error('自动部署需要已安装的 Python 3.12 或以上；现有便携版可直接复用');}python=venv;}
 const present=LOCAL_RECIPE.models.map(model=>({...model,present:existsSync(ownedPath(target,'ComfyUI/models',model.path))}));
 if(present.some(model=>!model.present))checkDeploymentCommand('curl.exe');
 let ancestor=target;while(!existsSync(ancestor)){const parent=resolve(ancestor,'..');if(parent===ancestor)break;ancestor=parent;}
 const storage=statfsSync(ancestor),available=Number(storage.bavail)*Number(storage.bsize),required=present.filter(model=>!model.present).reduce((sum,model)=>sum+model.bytes,0)+(!portable&&!existsSync(venv)?8_000_000_000:1_000_000_000);
 if(available<required)throw new Error('部署磁盘空间不足，需要至少 '+Math.ceil(required/1e9)+' GB');
 const plan={schema:'art-workshop/deployment-plan',recipe:LOCAL_RECIPE,gpu,installRoot:target,endpoint:url.href,python,basePython,portable,models:present,requiredBytes:required,availableBytes:available,settingsFile:settings.file,workspace:settings.paths.workspace};
 return {...plan,planHash:hash(plan)};
}
export function validateDeploymentPlan(plan,settings){
 keys(plan,['schema','recipe','gpu','installRoot','endpoint','python','basePython','portable','models','requiredBytes','availableBytes','settingsFile','workspace','planHash'],'部署预案');
 const {planHash,...body}=plan;if(plan.schema!=='art-workshop/deployment-plan'||hash(body)!==planHash||hash(plan.recipe)!==hash(LOCAL_RECIPE))throw new Error('部署预案或固定方案已变化');
 if(plan.settingsFile!==settings.file||resolve(plan.workspace)!==resolve(settings.paths.workspace))throw new Error('部署预案不属于当前配置与工程');
 const expected=deploymentPlan(settings,{directory:plan.installRoot,endpoint:plan.endpoint});
 for(const key of ['gpu','python','basePython','portable','models'])if(hash(expected[key])!==hash(plan[key]))throw new Error('部署环境已变化，请重新预演');
 return plan;
}
export function deploymentStatus(settings,deploymentId){
 const state=readJson(ownedPath(runtimeRoot(settings),'deployments',id(deploymentId)+'.json'));
 if(state.schema!=='art-workshop/deployment'||state.deploymentId!==deploymentId)throw new Error('部署身份不匹配');
 if(!['succeeded','failed','cancelled','unknown'].includes(state.status)&&Date.now()-Date.parse(state.heartbeat??state.createdAt)>10000&&!alive(state.workerPid)){state.status='unknown';state.stopConfirmed=false;state.error='部署工作进程退出；禁止重复启动或清理，先核验原操作';writeJson(ownedPath(runtimeRoot(settings),'deployments',deploymentId+'.json'),state);}
 return state;
}
export async function startDeployment(settings,plan,{operationId}={}){
 if(typeof operationId!=='string'||!/^[a-z0-9-]{1,128}$/.test(operationId))throw new Error('部署需要稳定操作身份');
 return locked(runtimeRoot(settings),'deployment',async()=>{
  const {readdirSync}=await import('node:fs'),directory=ownedPath(runtimeRoot(settings),'deployments');
  const previous=existsSync(directory)?readdirSync(directory).filter(file=>file.endsWith('.json')).map(file=>deploymentStatus(settings,file.slice(0,-5))):[];
  const same=previous.find(state=>state.operationId===operationId);if(same){if(same.plan.planHash!==plan.planHash)throw new Error('部署操作身份已用于其他预案');return same;}
  const deploymentId='deploy-'+randomUUID(),file=ownedPath(directory,deploymentId+'.json'),logPath=ownedPath(directory,deploymentId+'.log');
  const state={schema:'art-workshop/deployment',deploymentId,operationId,status:'queued',stopConfirmed:false,createdAt:new Date().toISOString(),plan,logPath};writeJson(file,state);
  // Record rejected requests too: a caller losing an error receipt can recover
  // proof that this operation never started, without repeating the deployment.
  try{validateDeploymentPlan(plan,settings);if(previous.some(state=>state.stopConfirmed!==true))throw new Error('已有部署运行或停止未知，先处理原操作');}
  catch(error){state.status='failed';state.stopConfirmed=true;state.finishedAt=new Date().toISOString();state.error=error.message;writeJson(file,state);throw error;}
  const fd=openSync(logPath,'a'),child=spawn(process.execPath,[fileURLToPath(new URL('./deployment-worker.mjs',import.meta.url)),file],{detached:true,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,ART_VISION_KEY:'',DASHSCOPE_API_KEY:''}});closeSync(fd);
  try{await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}catch(error){state.status='failed';state.stopConfirmed=true;state.error='部署进程启动失败';writeJson(file,state);throw error;}
  child.unref();return {deploymentId,status:'queued',stopConfirmed:false};
 });
}
export function cancelDeployment(settings,deploymentId){const state=deploymentStatus(settings,deploymentId);if(state.stopConfirmed===true)return state;writeJson(ownedPath(runtimeRoot(settings),'deployments',deploymentId+'.json.cancel'),{requestedAt:new Date().toISOString()});return {deploymentId,status:'cancelling',stopConfirmed:false};}
export async function recoverDeployment(settings,operationId){const {readdirSync}=await import('node:fs');const directory=ownedPath(runtimeRoot(settings),'deployments');const records=existsSync(directory)?readdirSync(directory).filter(file=>file.endsWith('.json')).map(file=>deploymentStatus(settings,file.slice(0,-5))).filter(state=>state.operationId===operationId):[];if(records.length!==1)throw new Error('没有唯一原部署记录，停止状态未知；禁止重新提交');return records[0];}
