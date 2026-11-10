import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname,basename,resolve} from 'node:path';
import {projectPath} from './path.mjs';
const owners=new AsyncLocalStorage(),pending=new Map();
let sqliteModule;
export function assertVideoRuntime(version=process.versions.node){const [major,minor]=version.split('.').map(Number);if(!Number.isFinite(major)||!Number.isFinite(minor)||major<22||major===22&&minor<13)throw Object.assign(new Error('视频通道需要 Node.js 22.13 或更高版本；图片通道仍可使用当前运行时'),{code:'video-runtime-unsupported'});}
async function sqlite(){assertVideoRuntime();try{return await (sqliteModule??=import('node:sqlite'));}catch(error){throw Object.assign(new Error('视频通道需要可用的 Node.js SQLite 运行时'),{code:'video-runtime-unsupported',cause:error});}}
async function identityPath(path){try{return await realpath(path)}catch(error){if(error.code!=='ENOENT')throw error;return join(await identityPath(dirname(path)),basename(path))}}
// Same resource database identity as VantAgent, so both cooperating implementations exclude writes.
export async function withResource(root,resource,action){
 const actual=await identityPath(resolve(root,resource));await projectPath(root,actual);const hash=createHash('sha256').update(process.platform==='win32'?actual.toLowerCase():actual).digest('hex'),file=await projectPath(root,`.vant/state/locks/${hash}.sqlite`),parent=owners.getStore()||new Set();if(parent.has(file))throw new Error('同一视频操作不能重复取得同一资源');const previous=pending.get(file)||Promise.resolve();
 const work=previous.catch(()=>{}).then(async()=>{const {DatabaseSync}=await sqlite();await mkdir(dirname(file),{recursive:true});await projectPath(root,file);const database=new DatabaseSync(file);try{database.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE')}catch(error){database.close();throw Object.assign(new Error(error.errcode===5?'另一个服务正在操作同一视频资源':'视频资源锁不可用'),{code:'video-resource-busy',cause:error})}try{return await owners.run(new Set([...parent,file]),()=>action())}finally{database.close()}});pending.set(file,work);try{return await work}finally{if(pending.get(file)===work)pending.delete(file)}
}
