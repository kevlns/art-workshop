import {existsSync,mkdirSync,renameSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ownedPath} from './workspace.mjs';
import {hash} from './shared.mjs';
import {deploymentCommandError} from './deployment-process.mjs';

export async function ensureDeploymentSource(path,source,{control,command,check}){
 check();
 if(existsSync(path)){
  const git=args=>{try{return execFileSync('git',['-C',path,...args],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();}catch(error){throw deploymentCommandError('git',error);}};
  const current=git(['rev-parse','HEAD']),remote=git(['remote','get-url','origin']).replace(/\.git$/,''),dirty=git(['status','--porcelain','--untracked-files=no']);
  if(current!==source.commit||remote!==source.repository||dirty)throw new Error('现有源码不是干净的固定部署版本，保留用户环境；请另选空目录');return;
 }
 mkdirSync(dirname(path),{recursive:true});
 const staging=ownedPath(control,'staging','source-'+hash(source).slice(0,16));
 // spawn requires its working directory to exist even when Git is installed.
 mkdirSync(dirname(staging),{recursive:true});
 if(existsSync(staging))rmSync(staging,{recursive:true,force:true});
 const network=['-c','http.lowSpeedLimit=1024','-c','http.lowSpeedTime=60'];
 await command('git',[...network,'clone','--filter=blob:none','--no-checkout',source.repository,staging],dirname(staging));
 await command('git',[...network,'-C',staging,'checkout','--detach',source.commit],dirname(staging));
 check();if(existsSync(path))throw new Error('源码目标被其他操作创建，禁止覆盖');renameSync(staging,path);
}
