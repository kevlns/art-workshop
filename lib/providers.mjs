import {spawn} from 'node:child_process';
import {resolveBlEntry} from './bl.mjs';
import {generateComfy} from './comfyui.mjs';

export function generationRequest(plan,item) {
  const execution=item.execution??plan.execution;
  return {module:plan.module,prompt:item.prompt,negativePrompt:item.negativeBlock??'',model:execution.model,size:execution.size,seed:item.seed,count:execution.perValue,images:item.imageArgs,promptExtend:execution.promptExtend,watermark:execution.watermark};
}
function generateBailian(request,{outputDir,prefix,cancelled,onRemoteCancel=()=>{}}) {
  const args=['image',request.module==='edit'?'edit':'generate'];
  for(const image of request.images)args.push('--image',image);
  args.push('--prompt',request.prompt,'--model',request.model,'--size',request.size,'--n',String(request.count),'--seed',String(request.seed),'--prompt-extend',String(request.promptExtend),'--watermark',String(request.watermark),'--out-dir',outputDir,'--out-prefix',prefix,'--output','json');
  if(request.negativePrompt)args.push('--negative-prompt',request.negativePrompt);
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[resolveBlEntry(),...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let out='',err='',overflow=false;
    child.stdout.on('data',chunk=>{out+=chunk;if(out.length>64*1024*1024){overflow=true;child.kill();}});child.stderr.on('data',chunk=>{err=(err+chunk).slice(-4000);});
    const timer=setInterval(()=>{if(cancelled()){onRemoteCancel();child.kill();}},100);
    child.once('error',e=>{clearInterval(timer);reject(e);});
    child.once('exit',code=>{clearInterval(timer);if(cancelled())return reject(new Error('任务已取消'));if(overflow)return reject(new Error('远程响应过大'));if(code!==0)return reject(new Error(err||'bl 调用失败'));try{resolve(JSON.parse(out));}catch{resolve({});}});
  });
}
export function generate(plan,item,context) {
  return plan.backend?.provider==='comfyui'?generateComfy(plan,item,context):generateBailian(generationRequest(plan,item),context);
}
