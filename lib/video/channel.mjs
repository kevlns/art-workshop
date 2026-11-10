import {readFile,stat,open} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {projectPath,canonicalVideoRoot} from './path.mjs';
import {withResource,assertVideoRuntime} from './resource.mjs';
import {VideoModels,videoSettingsSchema,validateVideoSettings} from './models.mjs';
import {VideoService,videoActions} from './service.mjs';
import {LocalVideoRuntime} from './local-runtime.mjs';
import {h3Preset} from './h3.mjs';

export const stateFile='.vant/video/project.json';
export const VIDEO_SETTINGS_SNAPSHOT_VERSION=1;
export const readActions=new Set(['describe','snapshot','task.list','task.read','script.read','script.plan','operation.validate','material.list','image','settings.get','settings.presets.h3','runtime.status']);
export const actions=new Set([...videoActions,'snapshot','material.upload','settings.get','settings.save','settings.presets.h3','runtime.status','runtime.start','runtime.stop']);
const jsonValue=value=>JSON.parse(JSON.stringify(value));
export async function settingsRevision(root,settingsSnapshot){if(settingsSnapshot)return settingsSnapshot.revision;return readFile(await projectPath(root,'.vant/config/video.json')).then(value=>createHash('sha256').update(value).digest('hex'),error=>{if(error.code==='ENOENT')return 'missing';throw error;});}
const unavailableCoverage=()=>({available:false,partial:false,state:'unavailable',errors:[],message:'未接入图片工坊素材来源。'});
export function isVideoUploadBase64(value){
 const maxBytes=20*1024*1024;
 if(typeof value!=='string'||!value.length||value.length%4!==0||value.length>Math.ceil(maxBytes/3)*4)return false;
 const padding=value.endsWith('==')?2:value.endsWith('=')?1:0;
 if(value.length/4*3-padding>maxBytes)return false;
 return !/[^A-Za-z0-9+/]/.test(padding?value.slice(0,-padding):value);
}

/** Video business channel. Host admission, credentials, session attachments and outer receipts stay outside. */
export function createVideoChannel({root,workspaceId='project',instanceId=randomUUID(),sdkRoot,fetcher=globalThis.fetch,sources,runtime:providedRuntime,sourceCoverage,settingsSnapshot}={}){
 assertVideoRuntime();
 if(typeof root!=='string'||!isAbsolute(root)||typeof workspaceId!=='string'||!workspaceId)throw new TypeError('视频通道需要工程绝对根目录与项目身份');
 root=canonicalVideoRoot(root);
 if(typeof fetcher!=='function')throw new TypeError('视频通道需要 HTTP fetch 实现');
 if(settingsSnapshot&&(settingsSnapshot.scope!=='global'||typeof settingsSnapshot.revision!=='string'||!settingsSnapshot.revision||settingsSnapshot.revision.length>200))throw Object.assign(new Error('全局视频设置快照身份无效'),{code:'video-settings-snapshot-invalid'});
 const frozenSettings=settingsSnapshot?{scope:'global',revision:settingsSnapshot.revision,settings:validateVideoSettings(settingsSnapshot.settings)}:null;
 const runtime=providedRuntime||new LocalVideoRuntime({root,instanceId,sdkRoot,fetcher}),models=new VideoModels(join(root,'.vant/config'),fetcher,runtime,{settingsSnapshot:frozenSettings});
 const service=new VideoService(models,sources),workspace={root,id:workspaceId};
 let closed=false;
 const coverage=async()=>jsonValue(await sourceCoverage?.()??await sources?.coverage?.()??unavailableCoverage());
 const assertOpen=()=>{if(closed)throw Object.assign(new Error('视频通道已关闭'),{code:'video-closed'});};
 const checkPaths=async()=>{if(!frozenSettings)await projectPath(root,'.vant/config/video.json');await projectPath(root,stateFile);};
 const currentSettingsRevision=()=>settingsRevision(root,frozenSettings);
 const api={service,models,runtime,workspace,
  settingsRevision:currentSettingsRevision,
  async snapshot(){assertOpen();await checkPaths();const settings=await models.get(),state=await service.snapshot(workspace),workshopCoverage=await coverage();return jsonValue({...state,models:await models.catalog(settings),settings,settingsRevision:await currentSettingsRevision(),settingsScope:frozenSettings?'global':'project',runtime:await runtime.status(settings),sourceCapabilities:{workshop:workshopCoverage.available,conversation:false},workshopCoverage,mediaStatus:{available:null,reason:'使用 media.status 检查 FFmpeg / ffprobe'}});},
  async execute(action,input={}){
   assertOpen();if(!actions.has(action))throw Object.assign(new Error('视频通道不支持此操作'),{code:'video-action-invalid'});await checkPaths();
   if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('视频操作输入必须为对象');
   if(action==='snapshot')return api.snapshot();
   if(action==='material.list'){const value=await service.materials(workspace),workshopCoverage=await coverage();return {...value,workshopCoverage,sourceCapabilities:{workshop:workshopCoverage.available}};}
   if(action==='settings.get')return {settings:await models.get(),revision:await currentSettingsRevision(),scope:frozenSettings?'global':'project',runtime:await runtime.status(await models.get())};
   if(action==='settings.presets.h3')return h3Preset();
   if(action==='settings.save'){if(frozenSettings)throw Object.assign(new Error('全局视频配置只能从所有者的美术环境设置更新'),{code:'video-global-settings-required'});return withResource(root,'.vant/config/video.json',async()=>{await checkPaths();if(Object.keys(input).some(key=>!['settings','expectedRevision'].includes(key))||input.expectedRevision!==await settingsRevision(root))throw Object.assign(new Error('视频设置已变化，请重新读取后保存'),{code:'video-settings-conflict',status:409});await models.save(input.settings);return api.execute('settings.get');});}
   if(action==='runtime.status')return runtime.status(await models.get());
   if(action==='runtime.start'){await runtime.ensure(await models.get(),service.shutdown.signal);return runtime.status(await models.get());}
   if(action==='runtime.stop')return runtime.stop(await models.get());
   if(action==='material.upload'){if(!isVideoUploadBase64(input.data)||Object.keys(input).some(key=>!['name','data','source'].includes(key))||input.source!==undefined&&!['import','capture'].includes(input.source))throw new Error('图片上传格式无效或超过20MiB');return service.putAsset(workspace,input.name,Buffer.from(input.data,'base64'),input.source||'import');}
   if(action==='image'){const value=await service.asset(workspace,input.assetId);return {data:value.bytes.toString('base64'),type:value.type};}
   if(action==='describe'){const value=await service.execute(workspace,action,input);return {...value,actions:[...actions],runtimePolicy:{readNeverStartsService:true,startRequiresExplicitAction:true,resumeUsesFrozenUpstreamId:true,runningCancel:'无安全的按任务 interrupt，拒绝全局中断'},settingsSchema:videoSettingsSchema.toJSONSchema(),channelInputs:{'settings.save':'{settings,expectedRevision}','material.upload':'{name,data:strictBase64,source?:import|capture}','operation.cancel':'{taskId,operationId,revision,runId}: 只取消原排队身份，不会中断共享运行'}};}
   return service.execute(workspace,action,input);
  },
  async media(input){
   assertOpen();await checkPaths();let value;
   if(input.kind==='asset'){const image=await service.asset(workspace,input.assetId),asset=(await service.snapshot(workspace)).assets.find(value=>value.id===input.assetId);return {path:await projectPath(root,`.vant/video/${input.assetId}.image`),type:image.type,name:asset.name,size:image.bytes.length};}
   if(input.kind==='film')value=await service.workflow.filmMedia(workspace,input.taskId,input.filmId);else if(input.kind==='run')value=await service.media(workspace,input.taskId,input.operationId,input.runId);else throw new Error('媒体身份无效');
   const file=await projectPath(root,value.path),info=await stat(file);if(!info.isFile()||info.size>512*1024*1024||info.size<12)throw new Error('视频产物无效或超过512MiB');const handle=await open(file,'r');const bytes=Buffer.alloc(12);try{await handle.read(bytes,0,12,0);}finally{await handle.close();}
   const type=bytes.toString('ascii',4,8)==='ftyp'?'video/mp4':bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))?'video/webm':null;if(!type)throw new Error('视频产物容器签名无效');return {path:file,type,name:value.name,size:info.size};
  },
  async dispose(){if(closed)return;closed=true;await service.close();},
 };
 return api;
}
