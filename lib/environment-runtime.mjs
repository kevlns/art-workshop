import {createHash,randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, renameSync, realpathSync, lstatSync, writeFileSync, readFileSync, readdirSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';
import {spawnSync, spawn} from 'node:child_process';
import {deploymentGuide} from './deployment-guide.mjs';
import {locked} from './runtime.mjs';
import {environmentRoot} from './environments.mjs';
export function pythonVersion(executable, prefix=[], probe=spawnSync) {
 const result=probe(executable,[...prefix,'-c','import sys,json;print(json.dumps(list(sys.version_info[:3])))'],{encoding:'utf8',timeout:10000,windowsHide:true});
 if(result.status!==0)return null;
 try {const value=JSON.parse(result.stdout.trim());return Array.isArray(value)&&value.length===3&&value.every(Number.isInteger)?value:null;}catch{return null;}
}
export function compatiblePython(version, contract) {
 if(!version)return false;
 const bounds=contract.python;if(!bounds)return true;
 const key=v=>v[0]*100+v[1];return key(version)>=key(bounds.min)&&key(version)<key(bounds.maxExclusive);
}
export function inspectPython(root, contract, probe=pythonVersion) {
 const candidates=contract.pythonCandidates.filter(path=>existsSync(join(root,path))).map(path=>({path,version:probe(join(root,path))}));
 const selected=candidates.find(item=>compatiblePython(item.version,contract));
 return {python:selected?.path??candidates[0]?.path??contract.pythonCandidates[0],version:selected?.version??candidates[0]?.version??null,compatible:!!selected,required:contract.python??null};
}
export async function prepareRuntime(directory,{guideId,signal}={}) {
 signal?.throwIfAborted();
 mkdirSync(directory,{recursive:true});const root=realpathSync(directory),contract=deploymentGuide(guideId).contract;
 return locked(environmentRoot(root),'runtime',async()=>{
  const current=inspectPython(root,contract);
  if(current.compatible) { await ensurePip(root,join(root,current.python),contract,signal); return {root,...current,reused:true}; }
  const preferred=contract.python?.preferred??'3.12';
  const choices=process.platform==='win32'?[['py',['-'+preferred]],['py',['-3.11']],['python',[]]]:[['python'+preferred,[]],['python3.11',[]],['python3',[]]];
  const selected=choices.find(([exe,args])=>compatiblePython(pythonVersion(exe,args),contract));
  if(!selected && process.platform==='win32' && contract.python?.windowsPortable) return preparePortable(root,contract,signal);
  if(!selected)throw new Error('未发现兼容 Python（需要 '+JSON.stringify(contract.python)+'）；请安装兼容运行时后重试，现有环境未改动');
  const target=resolve(root,'.venv');if(!target.startsWith(root+sep))throw new Error('运行时目录越界');
  let backup;
  if(existsSync(target)) {
   if(lstatSync(target).isSymbolicLink()||!realpathSync(target).startsWith(root+sep))throw new Error('虚拟环境是外部链接，不能替换');
   backup=target+'.previous-'+Date.now();renameSync(target,backup);
  }
  signal?.throwIfAborted();
  await new Promise((resolvePromise,reject)=>{
   const child=spawn(selected[0],[...selected[1],'-m','venv',target],{windowsHide:true,signal,stdio:['ignore','pipe','pipe']});let log='';
   child.stdout.on('data',chunk=>{log=(log+chunk).slice(-8000);});child.stderr.on('data',chunk=>{log=(log+chunk).slice(-8000);});
   child.once('error',reject);child.once('close',code=>code===0?resolvePromise():reject(new Error('创建 Python 环境失败：'+log)));
  });
  const result=inspectPython(root,contract);if(!result.compatible)throw new Error('新环境未通过 Python 版本校验');
  await ensurePip(root,join(root,result.python),contract,signal);
  return {root,...result,reused:false,backup};
 });
}

async function run(executable,args,signal,env=process.env) {
 signal?.throwIfAborted();
 await new Promise((done,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,signal,env,stdio:['ignore','pipe','pipe']});let log='';
  child.stdout.on('data',chunk=>{log=(log+chunk).slice(-8000);});child.stderr.on('data',chunk=>{log=(log+chunk).slice(-8000);});
  child.once('error',reject);child.once('close',code=>code===0?done():reject(new Error('运行时准备失败：'+log)));
 });
}
export async function downloadChecked(url,sha256,file,signal) {
 const bytes=existsSync(file)?readFileSync(file):null;
 if(bytes&&createHash('sha256').update(bytes).digest('hex')===sha256)return;
 const response=await fetch(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(300000)]):AbortSignal.timeout(300000)});
 if(!response.ok)throw new Error('下载运行时失败：HTTP '+response.status);
 const data=Buffer.from(await response.arrayBuffer());
 if(createHash('sha256').update(data).digest('hex')!==sha256)throw new Error('运行时下载 SHA256 不匹配：'+url);
 writeFileSync(file+'.part',data);renameSync(file+'.part',file);
}
async function preparePortable(root,contract,signal) {
 const spec=contract.python.windowsPortable;
 const cache=join(root,'.runtime-downloads');mkdirSync(cache,{recursive:true});
 if(lstatSync(cache).isSymbolicLink()||!realpathSync(cache).startsWith(root+sep))throw new Error('下载目录不能指向目标外部');
 const zip=join(cache,'python-'+spec.sha256+'.zip'),pip=join(cache,'get-pip-'+spec.pipSha256+'.py');
 await downloadChecked(spec.url,spec.sha256,zip,signal);await downloadChecked(spec.pipUrl,spec.pipSha256,pip,signal);
 const stage=join(root,'.python-preparing-'+randomUUID());mkdirSync(stage);
 await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Expand-Archive -LiteralPath $env:ART_RUNTIME_ZIP -DestinationPath $env:ART_RUNTIME_STAGE"],signal,{...process.env,ART_RUNTIME_ZIP:zip,ART_RUNTIME_STAGE:stage});
 const pth=readdirSync(stage).find(name=>/^python[0-9]+\._pth$/.test(name));if(!pth)throw new Error('Python 便携包缺少路径配置');
 const pathFile=join(stage,pth);writeFileSync(pathFile,readFileSync(pathFile,'utf8').replace('#import site','import site'));
 const executable=join(stage,'python.exe');
 if(!compatiblePython(pythonVersion(executable),contract))throw new Error('下载运行时版本不符合契约');
 await run(executable,[pip,'pip=='+spec.pipVersion],signal);
 await run(executable,['-m','pip','--version'],signal);
 const target=join(root,'python_embeded');let backup;
 if(existsSync(target)) {if(lstatSync(target).isSymbolicLink())throw new Error('已有 Python 是外部链接，不能替换');backup=target+'.previous-'+Date.now();renameSync(target,backup);}
 signal?.throwIfAborted();renameSync(stage,target);
 return {root,...inspectPython(root,contract),reused:false,downloaded:true,backup};
}

async function ensurePip(root,executable,contract,signal) {
 if(spawnSync(executable,['-m','pip','--version'],{windowsHide:true,timeout:15000,stdio:'ignore'}).status===0)return;
 try { await run(executable,['-m','ensurepip'],signal); }
 catch(error) {
  signal?.throwIfAborted();const spec=contract.python?.windowsPortable;if(!spec)throw error;
  const cache=join(root,'.runtime-downloads');mkdirSync(cache,{recursive:true});
  if(lstatSync(cache).isSymbolicLink()||!realpathSync(cache).startsWith(root+sep))throw new Error('下载目录越界');
  const pip=join(cache,'get-pip-'+spec.pipSha256+'.py');await downloadChecked(spec.pipUrl,spec.pipSha256,pip,signal);await run(executable,[pip,'pip=='+spec.pipVersion],signal);
 }
 await run(executable,['-m','pip','--version'],signal);
}
