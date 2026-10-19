import {createHash} from 'node:crypto';
import {createReadStream,realpathSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {deploymentGuide} from './deployment-guide.mjs';
import {inspectInstallation,writeMarker,environmentRoot,MARKER} from './environments.mjs';
import {locked} from './runtime.mjs';

export async function verifyInstallation(directory,endpoint,{cancelled=()=>false,guideId}={}){
 const report=await inspectInstallation(directory,endpoint,guideId);
 const issues=[...report.missing,...(report.conflict?[report.conflict]:[])];
 if(report.markerError)issues.push(report.markerError);
 if(!report.live)issues.push('服务与工作流能力尚未通过');
 for(const model of deploymentGuide(report.guideId).contract.models){
  const file=join(report.root,'ComfyUI/models',model.path);
  if(!existsSync(file))continue;
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(file)){
   if(cancelled())throw new Error('环境验收已取消');
   digest.update(chunk);
  }
  if(digest.digest('hex')!==model.sha256)issues.push('SHA256 不匹配：'+model.path);
 }
 return {...report,ok:issues.length===0,issues,verification:'capabilities',sampleVerified:false,checkedAt:new Date().toISOString()};
}

export async function registerInstallation(directory,endpoint,{guideId}={}){
 const root=realpathSync(directory);
 return locked(environmentRoot(root),'registration',async()=>{
  const report=await verifyInstallation(root,endpoint,{guideId});
  if(!report.ok)throw new Error('环境验收未通过：'+report.issues.join('；'));
  const record=writeMarker(root,{python:report.python,endpoint,recipe:report.guideId,verification:'capabilities'});
  return {ok:true,root,...record,sampleVerified:false};
 });
}

export async function unregisterInstallation(directory){
 const root=realpathSync(directory);
 return locked(environmentRoot(root),'registration',async()=>{
  const file=join(environmentRoot(root),'environment.json');
  if(!existsSync(file))throw new Error('环境未登记');
  const record=JSON.parse(readFileSync(file,'utf8'));
  if(record.root!==root)throw new Error('环境登记身份不匹配');
  // Only registry records are removed; installation and service remain untouched.
  rmSync(file);
  const marker=join(root,MARKER);
  if(existsSync(marker)&&JSON.parse(readFileSync(marker,'utf8')).environmentId===record.environmentId)rmSync(marker);
  return {ok:true,root};
 });
}
