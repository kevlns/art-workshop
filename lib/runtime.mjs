import {existsSync,mkdirSync,rmSync,readdirSync,lstatSync} from 'node:fs';
import {join,dirname,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readJson,writeJson,hash,id} from './shared.mjs';
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const terminal=s=>['succeeded','failed','cancelled','lost'].includes(s);
export const runtimeRoot=settings=>join(dirname(settings.file),'.runtime',hash(settings.file).slice(0,12));
export function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
export function stateRead(path){return existsSync(path)?readJson(path):null;}
export async function locked(root,name,fn,{timeout=150000}={}) {
  if(!/^[a-z0-9-]+$/.test(name))throw new Error('非法锁名称');
  mkdirSync(root,{recursive:true});const path=join(root,name+'.lock'),token=randomUUID(),deadline=Date.now()+timeout;
  const rel=relative(resolve(root),resolve(path));if(isAbsolute(rel)||rel.startsWith('..'))throw new Error('锁路径越界');
  while(true){try{mkdirSync(path);writeJson(join(path,'owner.json'),{pid:process.pid,token});break;}catch(e){if(e.code!=='EEXIST')throw e;if(lstatSync(path).isSymbolicLink())throw new Error('锁目录不能是链接');const owner=stateRead(join(path,'owner.json'));if(owner&&!alive(owner.pid)){rmSync(path,{recursive:true});continue;}if(Date.now()>deadline)throw new Error('等待锁超时 '+name);await sleep(100);}}
  try{return await fn();}finally{if(stateRead(join(path,'owner.json'))?.token===token)rmSync(path,{recursive:true});}
}
export function taskFile(root,taskId){id(taskId,'task');return join(root,'tasks',taskId+'.json');}
export function tasks(root){const dir=join(root,'tasks');return existsSync(dir)?readdirSync(dir).filter(x=>x.endsWith('.json')).map(x=>stateRead(join(dir,x))).filter(x=>x?.schema==='art-workshop/task'):[];}
export async function http(endpoint,path,{method='GET',body,timeout=10000}={}) {
  const response=await fetch(new URL(path,endpoint),{method,signal:AbortSignal.timeout(timeout),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  if(!response.ok){const content=await response.text(),error=new Error(`ComfyUI HTTP ${response.status}: ${content.slice(0,1000)}`);error.httpStatus=response.status;try{error.response=JSON.parse(content);}catch{};throw error;}
  const content=await response.text();return content?JSON.parse(content):{};
}
