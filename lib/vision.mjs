import {readFileSync} from 'node:fs';

/** The harness supplies one selected credential in process memory, never in argv or run evidence. */
export async function callVision(args,{cancelled=()=>false,onRemoteCancel,transport=fetch}={}) {
 const config=JSON.parse(process.env.ART_VISION_CONFIG??'null'),key=process.env.ART_VISION_KEY;
 if(!config||!key)throw new Error('视觉模型实例未配置');
 const value=name=>args[args.indexOf(name)+1],model=value('--model');
 const image=args.includes('--image')?value('--image'):null,text=args.includes('--prompt')?value('--prompt'):value('--message');
 if(!model||!text)throw new Error('视觉调用缺少模型或提示');
 if(config.model&&model!==config.model)throw new Error('视觉模型与授权实例不匹配');
 const configuredTokens=config.maxTokens??16384;if(!Number.isSafeInteger(configuredTokens)||configuredTokens<1024)throw new Error('视觉模型输出额度非法');
 const maxTokens=Math.min(configuredTokens,32768);
 const base=new URL(config.baseUrl);if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw new Error('视觉模型地址非法');
 let mime='image/png',data;if(image){const bytes=readFileSync(image);mime=bytes[0]===255?'image/jpeg':bytes.subarray(0,4).toString()==='RIFF'?'image/webp':'image/png';data=bytes.toString('base64');}
 let endpoint,headers,body;
 if(config.api==='openai-completions'){
  endpoint='/chat/completions';headers={Authorization:'Bearer '+key};body={model,messages:[{role:'user',content:[{type:'text',text},...(data?[{type:'image_url',image_url:{url:`data:${mime};base64,${data}`}}]:[])]}],max_tokens:maxTokens};
 }else if(config.api==='openai-responses'){
  endpoint='/responses';headers={Authorization:'Bearer '+key};body={model,input:[{role:'user',content:[{type:'input_text',text},...(data?[{type:'input_image',image_url:`data:${mime};base64,${data}`}]:[])]}],max_output_tokens:maxTokens};
 }else if(config.api==='anthropic-messages'){
  endpoint='/messages';headers={'x-api-key':key,'anthropic-version':'2023-06-01'};body={model,max_tokens:maxTokens,messages:[{role:'user',content:[...(data?[{type:'image',source:{type:'base64',media_type:mime,data}}]:[]),{type:'text',text}]}]};
 }else if(config.api==='google-generative-ai'){
  endpoint='/models/'+encodeURIComponent(model)+':generateContent';headers={'x-goog-api-key':key};body={contents:[{role:'user',parts:[{text},...(data?[{inlineData:{mimeType:mime,data}}]:[])]}],generationConfig:{maxOutputTokens:maxTokens}};
 }else throw new Error('视觉模型协议尚未适配');
 if(cancelled())throw new Error('分析已取消');
 const controller=new AbortController();let sent=false;
 const timer=setInterval(()=>{if(cancelled())controller.abort();},100),timeout=setTimeout(()=>controller.abort(),300000);
 try{
  sent=true;
  const response=await transport(base.href.replace(/\/$/,'')+endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:controller.signal});
  if(!response.ok)throw new Error('视觉模型请求失败（HTTP '+response.status+'）');
  const reader=response.body?.getReader();if(!reader)throw new Error('视觉模型未返回报告');
  const chunks=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>8_000_000){await reader.cancel();throw new Error('视觉响应过大');}chunks.push(next.value);}
  const raw=Buffer.concat(chunks).toString('utf8');
  const result=JSON.parse(raw);
  if(result.choices?.[0]?.finish_reason==='length'||result.status==='incomplete'||result.stop_reason==='max_tokens'||result.candidates?.some(c=>c.finishReason==='MAX_TOKENS'))throw new Error('视觉报告超出模型输出额度，请调整输出额度后重新分析；未回填截断结果');
  // Return only assistant text, rather than recursively interpreting arbitrary response metadata as a report.
  const texts=config.api==='openai-completions'?[result.choices?.[0]?.message?.content]:config.api==='openai-responses'?(result.output??[]).flatMap(item=>(item.content??[]).filter(c=>c.type==='output_text').map(c=>c.text)):config.api==='anthropic-messages'?(result.content??[]).filter(c=>c.type==='text').map(c=>c.text):(result.candidates??[]).flatMap(item=>(item.content?.parts??[]).map(c=>c.text));
  if(!texts.length||texts.some(t=>typeof t!=='string'))throw new Error('视觉模型未返回文字报告');
  return {text:texts.join('\n')};
 }catch(error){
  if(sent&&(controller.signal.aborted||error instanceof TypeError)){onRemoteCancel?.();throw new Error('视觉请求未确认停止，请查询原运行；不要重新提交');}
  throw new Error(/^视觉/.test(error.message)?error.message:'视觉模型响应解析失败');
 }finally{clearInterval(timer);clearTimeout(timeout);}
}
