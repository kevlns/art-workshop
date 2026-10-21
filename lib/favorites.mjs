import {existsSync,readFileSync} from 'node:fs';
import {id,readJson,writeJson} from './shared.mjs';
import {ownedPath,readObject,listObjects} from './workspace.mjs';
import {candidates} from './candidates.mjs';
import {locked,runtimeRoot,tasks} from './runtime.mjs';
import {validateImage} from './images.mjs';
import {loadProject} from './project.mjs';

function store(settings,projectId){
 id(projectId,'project');loadProject(projectId,settings.paths.workspace);
 const file=ownedPath(settings.paths.workspace,'projects',projectId,'favorites.json');
 const value=existsSync(file)?readJson(file):{schemaVersion:1,items:[]};
 if(value.schemaVersion!==1||!Array.isArray(value.items))throw new Error('收藏记录格式无效');
 return {file,value};
}

export function favoriteList(settings,projectId){
 const {value}=store(settings,projectId);
 const objects=new Map(listObjects(settings.paths.workspace,projectId,'task').filter(t=>t.status!=='discarded').map(t=>[t.id,t]));
 const runs=new Set(tasks(runtimeRoot(settings)).filter(t=>t.plan?.project===projectId&&t.manifestPath).map(t=>t.taskId));
 const cache=new Map(),result=[];
 for(const saved of value.items){
  const task=objects.get(saved.taskId);
  if(!task||!runs.has(saved.runId))continue;
  const key=JSON.stringify([saved.taskId,saved.runId]);
  if(!cache.has(key))cache.set(key,candidates(settings,projectId,saved.taskId,saved.runId));
  const candidate=cache.get(key).find(c=>c.candidateId===saved.candidateId&&!c.deleted&&existsSync(c.path));
  if(candidate)result.push({...candidate,taskId:task.id,taskName:task.name,favoritedAt:saved.createdAt});
 }
 return result.sort((a,b)=>b.favoritedAt.localeCompare(a.favoritedAt));
}

export async function setFavorite(settings,projectId,taskId,{runId,candidateId,value}={}){
 if(typeof value!=='boolean')throw new Error('收藏状态必须为布尔值');
 return locked(runtimeRoot(settings),'favorites-'+id(projectId),async()=>{
  const current=store(settings,projectId);
  const matches=row=>row.taskId===taskId&&row.runId===runId&&row.candidateId===candidateId;
  if(value){
   const task=readObject(settings.paths.workspace,projectId,'task',taskId);
   if(task.status==='discarded')throw new Error('任务已归档，不能收藏');
   const candidate=candidates(settings,projectId,taskId,runId).find(c=>c.candidateId===candidateId&&!c.deleted);
   if(!candidate||!existsSync(candidate.path))throw new Error('图片不存在或已删除');
   await validateImage(readFileSync(candidate.path));
   if(!current.value.items.some(matches))current.value.items.push({taskId,runId,candidateId,createdAt:new Date().toISOString()});
  }else current.value.items=current.value.items.filter(row=>!matches(row));
  writeJson(current.file,current.value);
  return favoriteList(settings,projectId);
 });
}
