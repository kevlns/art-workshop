import {readFile,stat} from 'node:fs/promises';
import sharp from 'sharp';
import {RemoteError,requestJson} from '../transport/http.mjs';

function fields(request) {
  const body = {model:request.model,prompt:request.prompt,size:request.size.replace('*','x'),n:request.count,output_format:'png'};
  if (request.parameters.quality) body.quality=request.parameters.quality;
  return body;
}
const endpointPath = request => request.images.length ? '/images/edits' : '/images/generations';
export const openaiImagesAdapter = {
  id:'openai-images',label:'OpenAI Images',version:1,cancellation:'unsupported',
  preview:request=>({...fields(request), ...(request.images.length ? {image:request.images} : {})}),
  commandPreview:request=>['POST','/v1'+endpointPath(request)],
  async prepare(request,context) {
    const config=JSON.parse(process.env.ART_IMAGE_CONNECTION || '{}'), key=process.env.ART_IMAGE_KEY;
    if (config.api !== 'openai-images' || !key) throw Error('OpenAI Images 连接或凭据未配置');
    const base=new URL(config.baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw Error('图片接口地址无效');
    const endpoint=base.href.replace(/\/$/,'');
    if(context.baseUrl && context.baseUrl.replace(/\/$/,'')!==endpoint) throw Error('图片连接地址与冻结请求不同');
    const url=endpoint+(/\/v1$/.test(endpoint)?'':'/v1')+endpointPath(request);
    const headers={Authorization:'Bearer '+key};
    let body=fields(request);
    if(request.images.length) {
      const form=new FormData();
      for(const [field,value] of Object.entries(body)) form.set(field,String(value));
      for(const [index,file] of request.images.entries()) {
        if ((await stat(file)).size > request.inputPolicy.maxBytes) throw Error('参考图片过大');
        const bytes=await readFile(file), {format}=await sharp(bytes).metadata();
        if(!request.inputPolicy.formats.includes(format)) throw Error('参考图片格式不受支持');
        form.append(request.images.length === 1 ? 'image' : 'image[]',new Blob([bytes],{type:'image/'+format}),`reference-${index+1}.${format}`);
      }
      body=form;
    } else headers['Content-Type']='application/json';
    return {endpoint,url,headers,body};
  },
  async submit(request,context) {
    const {url,headers,body}=context.prepared;
    const result=await requestJson(url,{...context,method:'POST',headers,body,timeout:request.transport.timeoutMilliseconds,maxResponseBytes:128*1024*1024});
    if (!Array.isArray(result.data) || result.data.length !== request.count) throw new RemoteError('图片结果数量无效',{unsettled:true});
    if (result.data.every(item=>typeof item?.b64_json==='string' && item.b64_json.length>0))
      return {state:'completed',inline:result.data.map(item=>Buffer.from(item.b64_json,'base64'))};
    if (result.data.every(item=>{try {const u=new URL(item.url);return u.protocol==='https:'&&!u.username&&!u.password;} catch{return false;}}))
      return {state:'completed',urls:result.data.map(item=>item.url)};
    throw new RemoteError('图片响应缺少有效产物',{unsettled:true});
  },
  async query(){throw Error('同步图片请求没有远端任务 ID');}
};
