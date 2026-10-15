import {statSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';

export function deploymentCommandError(executable,error){
 const missing=error.code==='ENOENT';
 const detail=missing
  ? `找不到部署命令 ${executable}。${executable==='git'?'请安装 Git for Windows 并加入 PATH，然后完全退出并重新启动 Vant。':'请确认该命令已安装并在 Vant 的 PATH 中可用。'}`
  : `部署命令 ${executable} 无法执行（${error.code??error.status??'未知错误'}），请查看部署日志。`;
 return new Error(detail,{cause:error});
}
export function checkDeploymentCommand(executable){
 try{execFileSync(executable,['--version'],{windowsHide:true,timeout:10000,stdio:'pipe'});}
 catch(error){throw deploymentCommandError(executable,error);}
}
export function spawnDeploymentCommand(executable,args,cwd){
 try{if(!statSync(cwd).isDirectory())throw new Error('不是目录');}
 catch(error){throw new Error(`部署工作目录不可用：${cwd}。请重新检测安装目录。`,{cause:error});}
 return spawn(executable,args,{cwd,windowsHide:true,stdio:['ignore','inherit','inherit']});
}
