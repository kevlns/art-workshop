import { rename, rm, open, readFile, mkdir, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { projectPath } from './path.mjs';
export async function replaceFile(source,destination){for(let attempt=0;;attempt++){try{await rename(source,destination);return}catch(error){if(attempt>=8||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)))}}}
export async function atomicWrite(file,data){const temp=`${file}.${randomUUID()}.tmp`;let owner;
 try{const handle=await open(temp,'wx',0o600);try{owner=await handle.stat();await handle.writeFile(data);}finally{await handle.close();}await replaceFile(temp,file);}
 finally{if(owner){const current=await lstat(temp).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(current?.isFile()&&current.dev===owner.dev&&current.ino===owner.ino)await rm(temp,{force:true,maxRetries:5,retryDelay:25});}}
}
const pending=new Map();
const fail=(code,message)=>Object.assign(new Error(message),{code,status:409});
export async function withVideoLock(workspace,fn){
 const root=await projectPath(workspace.root,'.'),prior=pending.get(root)||Promise.resolve();
 const work=prior.catch(()=>{}).then(async()=>{
  const path=await projectPath(root,'.vant/video/write.lock');await mkdir(dirname(path),{recursive:true});
  let handle;try{handle=await open(path,'wx',0o600)}catch(error){
   if(error.code!=='EEXIST')throw error;
   const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw fail('occupied','视频制作写锁格式无效，请人工核对。');
   const raw=await readFile(path,'utf8');let owner;try{owner=JSON.parse(raw)}catch{owner=Number(raw)}
   const pid=typeof owner==='number'?owner:owner?.pid;if(!Number.isSafeInteger(pid)||pid<=0)throw fail('occupied','视频制作写锁身份无效，请人工核对。');
   let alive=true;try{process.kill(pid,0)}catch(error){if(error.code==='ESRCH')alive=false}
   if(alive)throw fail('occupied','视频制作正被其他进程写入。');
   if(await readFile(path,'utf8')!==raw)throw fail('occupied','视频制作写锁已变化，请重试。');
   await rm(path);handle=await open(path,'wx',0o600);
  }
  const raw=JSON.stringify({pid:process.pid,token:randomUUID(),createdAt:new Date().toISOString()});
  try{await handle.writeFile(raw);const result=await fn();if(await readFile(path,'utf8')!==raw)throw Object.assign(fail('video-lock-lost','视频制作写锁已变化，结果需要核对。'),{unknown:true});return result}
  finally{await handle.close();for(let attempt=0;;attempt++){if(await readFile(path,'utf8').catch(()=>null)!==raw)break;try{await rm(path,{force:true});break}catch(error){if(attempt>=8||!['EPERM','EACCES','EBUSY'].includes(error.code))throw Object.assign(error,{code:'video-lock-release-unknown',unknown:true});await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)))}}}
 });pending.set(root,work);try{return await work}finally{if(pending.get(root)===work)pending.delete(root)}
}

export const atomicJson=(file,value)=>atomicWrite(file,JSON.stringify(value,null,2)+'\n');
