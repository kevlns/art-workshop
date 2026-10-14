import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,realpathSync,statSync,createReadStream} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {hash,writeJson} from './shared.mjs';
import {loadBackend,BUILTIN_WORKFLOW} from './workflows.mjs';
import {inspectEnvironment} from './diagnostics.mjs';
import {LOCAL_RECIPE} from './deployment.mjs';
import {ensureService,externalIdentity} from './service.mjs';
export const MARKER='vant.art.config.json';
export const globalHome=()=>resolve(process.env.VANT_HOME??join(homedir(),'.vant'));
export const defaultInstallRoot=()=>join(globalHome(),'art-env');
export function environmentRoot(root){const canonical=existsSync(root)?realpathSync(root):resolve(root);return join(globalHome(),'state','art-environments',hash(process.platform==='win32'?canonical.toLowerCase():canonical));}
export function readMarker(root){
 const file=join(root,MARKER);if(!existsSync(file))return null;
 const value=JSON.parse(readFileSync(file,'utf8'));
 let endpoint;try{endpoint=new URL(value.endpoint);}catch{throw new Error('环境标记缺少合法服务地址');}
 if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost'].includes(endpoint.hostname)||endpoint.pathname!=='/'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password)throw new Error('环境标记只允许本机 HTTP 根地址');
 if(value.schema!=='vant/art-environment-v1'||value.comfy!=='ComfyUI'||!['python_embeded/python.exe','.venv/Scripts/python.exe'].includes(value.python))throw new Error('美术环境标记无效：'+file);
 return value;
}
export function writeMarker(root,{python,endpoint,recipe,verification='capabilities'}){
 const value={schema:'vant/art-environment-v1',environmentId:hash(realpathSync(root).toLowerCase()),comfy:'ComfyUI',python,endpoint,workflow:BUILTIN_WORKFLOW,recipe,verification,verifiedAt:new Date().toISOString()};
 writeJson(join(root,MARKER),value);
 writeJson(join(environmentRoot(root),'environment.json'),{root:realpathSync(root),...value});return value;
}
export function backendFor(root,endpoint){
 const python=existsSync(join(root,'python_embeded/python.exe'))?'python_embeded/python.exe':'.venv/Scripts/python.exe';
 return {python,backend:loadBackend({file:join(root,'vant.art.config.json'),generation:{backends:{local:{provider:'comfyui',model:'qwen-image-2.1-UC-Q4_K_M.gguf',endpoints:[endpoint],launch:{executable:join(root,python),cwd:root,args:['-s','ComfyUI/main.py','--disable-dynamic-vram','--lowvram','--disable-auto-launch','--port',new URL(endpoint).port||'80']}}}}},'local')};
}
export async function inspectInstallation(root,endpoint){
 root=resolve(root);let marker=null,markerError;try{marker=readMarker(root);}catch(e){markerError=e.message;}
 const {python,backend}=backendFor(root,endpoint),missing=[];
 if(!existsSync(join(root,python)))missing.push('Python 环境');
 if(!existsSync(join(root,'ComfyUI/main.py')))missing.push('ComfyUI');
 if(!existsSync(join(root,'ComfyUI/custom_nodes/ComfyUI-GGUF')))missing.push('ComfyUI-GGUF 节点');
 for(const model of LOCAL_RECIPE.models){const file=join(root,'ComfyUI/models',model.path);if(!existsSync(file)||statSync(file).size!==model.bytes)missing.push(model.path+'（缺失或大小不符）');}
 let service;try{service=await inspectEnvironment(endpoint,backend);if(service.ok){const edited=loadBackend({file:join(root,MARKER),generation:{backends:{local:{provider:'comfyui',model:backend.model,endpoints:[endpoint]}}}},'local','edit');const editReport=await inspectEnvironment(endpoint,edited);if(!editReport.ok)service=editReport;}}catch{}
 let conflict;
 if(service?.ok===true&&process.platform==='win32'&&!externalIdentity(endpoint,backend.launch))conflict='指定端口属于另一套环境';
 if(marker?.endpoint&&marker.endpoint!==endpoint){try{const previous=await inspectEnvironment(marker.endpoint,backend);if(previous.ok)conflict='此环境已在 '+marker.endpoint+' 运行，请使用原端口或先关闭原服务';}catch{}}
 const models=LOCAL_RECIPE.models.map(model=>({path:model.path,bytes:model.bytes,present:existsSync(join(root,'ComfyUI/models',model.path))&&statSync(join(root,'ComfyUI/models',model.path)).size===model.bytes}));
 return {models,conflict,root,endpoint,managed:!!marker,markerError,python,missing,service,reusable:!markerError&&!missing.length,live:service?.ok===true};
}
export function discoverInstallations(){
 const found=new Set(),index=join(globalHome(),'state','art-environments');
 if(existsSync(index))for(const entry of readdirSync(index,{withFileTypes:true})){const file=join(index,entry.name,'environment.json');if(entry.isDirectory()&&existsSync(file)){try{const record=JSON.parse(readFileSync(file,'utf8'));if(typeof record.root==='string'&&existsSync(record.root))found.add(realpathSync(record.root));}catch{}}}
 let budget=1500;
 const scan=(root,depth)=>{if(--budget<0||!existsSync(root))return;try{if(existsSync(join(root,MARKER))||existsSync(join(root,'ComfyUI/main.py'))) {found.add(realpathSync(root));return;}if(depth===0)return;for(const entry of readdirSync(root,{withFileTypes:true})){if(entry.isDirectory()&&!entry.isSymbolicLink()&&!['node_modules','.git','AppData','Windows','models','python_embeded'].includes(entry.name))scan(join(root,entry.name),depth-1);}}catch{}};
 for(const root of [join(globalHome(),'art-env'),join(homedir(),'AI'),...(process.platform==='win32'?['C:/AI','D:/AI','E:/AI']:[])])scan(root,3);
 return [...found];
}
export async function adoptInstallation(root,endpoint,{cancelled=()=>false,onStage=()=>{}}={}){
 const report=await inspectInstallation(root,endpoint);if(!report.reusable)throw new Error('现有环境需要补齐：'+report.missing.join('、'));
 for(const model of LOCAL_RECIPE.models){
  onStage('校验已有模型 '+model.path);const digest=createHash('sha256');
  for await(const chunk of createReadStream(join(report.root,'ComfyUI/models',model.path))){if(cancelled())throw new Error('接入已取消');digest.update(chunk);}
  if(digest.digest('hex')!==model.sha256)throw new Error('模型校验失败，保留原文件：'+model.path);
 }
 onStage('核验服务与工作流能力');
 const {backend,python}=backendFor(report.root,endpoint);
 if(report.live&&process.platform==='win32'&&!externalIdentity(endpoint,backend.launch))throw new Error('端口由其他环境占用，不能将其登记到指定目录');
 await ensureService(backend,join(environmentRoot(report.root),'runtime'),{cancelled});
 const current=await inspectInstallation(report.root,endpoint);if(!current.live)throw new Error('现有环境工作流能力检测未通过');
 if(cancelled())throw new Error('接入已取消');
 writeMarker(report.root,{python,endpoint,verification:'capabilities'});return current;
}
