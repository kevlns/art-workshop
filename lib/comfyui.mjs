import {readFileSync,writeFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildComfyRequest} from './backends.mjs';
import {http,sleep,locked} from './runtime.mjs';
import {workflowError} from './diagnostics.mjs';

export async function cancelPrompt(endpoint,promptId,{all=false}={}) {
  await http(endpoint,'/queue',{method:'POST',body:all?{clear:true}:{delete:[promptId]}});
  const queue=await http(endpoint,'/queue');
  if(all||queue.queue_running?.some(row=>row[1]===promptId)) {
    if(!all&&queue.queue_running.some(row=>row[1]!==promptId))throw new Error('其他任务正在运行，拒绝全局中断');
    // ComfyUI interrupt supports a prompt_id guard, preventing an unrelated next task from being interrupted.
    await http(endpoint,'/interrupt',{method:'POST',body:all?{}:{prompt_id:promptId}});
  }
  const deadline=Date.now()+30000;
  while(true){const q=await http(endpoint,'/queue');const active=[...(q.queue_running??[]),...(q.queue_pending??[])];if(!active.some(row=>all||row[1]===promptId))return;if(Date.now()>deadline)throw new Error('ComfyUI 任务停止超时');await sleep(200);}
}
export async function generateComfy(plan,item,{endpoint,root,outputDir,cancelled=()=>false,onPrompt=()=>{}}) {
  return locked(root,'queue-'+new URL(endpoint).port,async()=>{
    const b=plan.backend,e=item.execution??plan.execution,files=[];
    if(item.imageArgs.length>1)throw new Error('当前编辑适配器只接受一张原图');
    let image;
    if(plan.module==='edit') {
      const path=item.imageArgs[0],form=new FormData();form.append('image',new Blob([readFileSync(path)]),randomUUID()+'-'+basename(path));form.append('type','input');
      const response=await fetch(new URL('/upload/image',endpoint),{method:'POST',body:form,signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error('上传编辑原图失败');const upload=await response.json();image=upload.subfolder?upload.subfolder+'/'+upload.name:upload.name;
    }
    for(let index=0;index<e.perValue;index++) {
      if(cancelled())throw new Error('任务已取消');
      const request=buildComfyRequest(plan,item,{index,image});
      let result;
      try{result=await http(endpoint,'/prompt',{method:'POST',body:{prompt:request.prompt,client_id:randomUUID()}});}
      catch(error){if(error.response)throw workflowError('ComfyUI 拒绝工作流：'+JSON.stringify(error.response.error??error.response),b,{stage:'submission',nodeErrors:error.response.node_errors,cause:error});throw error;}
      if(!result.prompt_id||Object.keys(result.node_errors??{}).length){
        const error=workflowError('ComfyUI 拒绝工作流',b,{stage:'submission',promptId:result.prompt_id,nodeErrors:result.node_errors});
        if(result.prompt_id){onPrompt(result.prompt_id);try{await cancelPrompt(endpoint,result.prompt_id);}catch{error.unsettled=true;}}
        throw error;
      }
      const promptId=result.prompt_id;onPrompt(promptId);
      const deadline=Date.now()+(b.options?.timeoutSeconds??1800)*1000;
      while(true) {
        if(cancelled()){try{await cancelPrompt(endpoint,promptId);}catch(error){error.unsettled=true;throw error;}throw new Error('任务已取消');}
        const history=(await http(endpoint,'/history/'+encodeURIComponent(promptId)))[promptId];
        if(history?.status?.completed) {
          if(history.status.status_str==='error')throw workflowError('ComfyUI 执行失败',b,{promptId,messages:history.status.messages});
          const images=Object.values(history.outputs??{}).flatMap(value=>value.images??[]).filter(x=>x.type==='output');
          if(images.length!==1)throw new Error('每次串行采样应输出恰好一张图片');
          const params=new URLSearchParams(images[0]);const response=await fetch(new URL('/view?'+params,endpoint),{signal:AbortSignal.timeout(30000)});
          if(!response.ok)throw new Error('获取生成图片失败');
          const file=`${item.itemId}--${item.variantId}${index?'--'+(index+1):''}.png`;
          writeFileSync(join(outputDir,file),Buffer.from(await response.arrayBuffer()),{flag:'wx'});files.push(file);break;
        }
        if(history?.status?.status_str==='error')throw workflowError('ComfyUI 执行失败',b,{promptId,messages:history.status.messages});
        if(Date.now()>deadline){try{await cancelPrompt(endpoint,promptId);}catch(error){error.unsettled=true;throw error;}throw new Error('生图超时，已停止任务');}
        await sleep(b.options?.pollMilliseconds??500);
      }
      onPrompt(null);
    }
    return {files};
  });
}
