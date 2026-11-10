import { spawn, execFile } from 'node:child_process';
const unknown=(message)=>Object.assign(new Error(message),{code:'video-process-unknown',unknown:true});
export async function execute(file,args,{cwd,signal,allowFailure=false,maxOutputChars=32*1024*1024,timeoutMs=15*60*1000}={}){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{cwd,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let stdout='',stderr='',cancelled=false,settled=false,timer,stopTimer,outputError;
  const stop=()=>{if(cancelled||child.exitCode!==null)return;cancelled=true;if(child.pid){if(process.platform==='win32')execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});else try{process.kill(-child.pid,'SIGKILL')}catch{}}stopTimer=setTimeout(()=>finish(unknown('视频子进程停止尚未确认，请核对原操作。')),15000);stopTimer.unref?.()};
  const cleanup=()=>{clearTimeout(timer);clearTimeout(stopTimer);signal?.removeEventListener('abort',stop)};
  const finish=(error,result)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve(result)};
  const collect=key=>chunk=>{if((key==='out'?stdout.length:stderr.length)+chunk.length>maxOutputChars){outputError=unknown('视频子进程输出超过上限，请核对原回执。');stop();return}if(key==='out')stdout+=chunk;else stderr+=chunk};
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',collect('out'));child.stderr.on('data',collect('err'));
  child.once('error',error=>finish(error));child.once('close',(code,processSignal)=>{if(outputError)return finish(outputError);if(cancelled||processSignal)return finish(unknown('UI 执行已停止，原操作结果需要核对。'));if(code!==0&&!allowFailure)return finish(Object.assign(new Error(stderr||`视频子进程退出 ${code}`),{code:'video-process-failed',exitCode:code,stdout,stderr}));finish(null,{code,stdout,stderr})});
  signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();timer=setTimeout(stop,timeoutMs);timer.unref?.();
 });
}
