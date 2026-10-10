import {keys,id,integer,hash,text} from './shared.mjs';
import {execution} from './plan.mjs';
import {BUILTIN_WORKFLOW,loadBackend} from './workflows.mjs';
import {templateIssues} from './diagnostics.mjs';

export function generationConfig(value={}) {
  keys(value,['defaultBackend','defaults','backends'],'generation');
  keys(value.defaults??{},['size','perValue','promptExtend','watermark'],'generation.defaults');
  execution({},value.defaults??{});
  for(const [name,b] of Object.entries(value.backends??{})) {
    id(name,'backend'); keys(b,['provider','model','execution','endpoints','workflow','bindings','options','launch'],'backend');
    if(!['bailian','comfyui'].includes(b.provider)) throw new Error('provider 必须为 bailian/comfyui');
    keys(b.execution??{},['size','perValue','promptExtend','watermark'],'backend.execution');
    execution({},b.execution??{});
    text(b.model,'backend.model');
    if(b.provider==='bailian')continue;
    if(!Array.isArray(b.endpoints)||!b.endpoints.length)throw new Error('ComfyUI 需要 endpoints');
    for(const endpoint of b.endpoints) {const u=new URL(endpoint);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('ComfyUI endpoint 必须是本机 HTTP 根地址');}
    const builtin=b.workflow===undefined||b.workflow===BUILTIN_WORKFLOW;
    if(!builtin&&(!b.workflow||!b.bindings))throw new Error('自定义 ComfyUI 需要 API workflow 和 bindings');
    if(b.workflow!==undefined)text(b.workflow,'workflow');
    keys(b.bindings??{},['prompt','negativePrompt','width','height','seed','count','model','image','vae'],'bindings');
    for(const field of ['prompt','width','height','seed'])if(!builtin&&!b.bindings[field])throw new Error('缺少 binding '+field);
    for(const binding of Object.values(b.bindings??{})){keys(binding,['node','input'],'binding');if(!binding.node||!binding.input)throw new Error('binding 需要 node/input');}
    keys(b.options??{},['steps','cfg','sampler','scheduler','timeoutSeconds','pollMilliseconds'],'backend.options');
    integer(b.options?.timeoutSeconds??1800,'timeoutSeconds',1,86400);
    integer(b.options?.pollMilliseconds??500,'pollMilliseconds',50,10000);
    if(b.options?.steps!==undefined)integer(b.options.steps,'steps',1,10000);
    if(b.options?.cfg!==undefined&&(!Number.isFinite(b.options.cfg)||b.options.cfg<0||b.options.cfg>100))throw new Error('cfg 必须为 0～100 的数值');
    if(b.launch) {keys(b.launch,['executable','args','cwd','startupTimeoutSeconds'],'launch');if(!b.launch.executable||!b.launch.cwd||!Array.isArray(b.launch.args)||b.launch.args.some(x=>typeof x!=='string'))throw new Error('launch 需要 executable/cwd/args');integer(b.launch.startupTimeoutSeconds??120,'startupTimeoutSeconds',1,600);}
  }
  if(value.defaultBackend&&!value.backends?.[value.defaultBackend])throw new Error('defaultBackend 未定义');
  return value;
}

export function backendDefaults(settings,selection) {
  const name=selection??settings.generation?.defaultBackend;
  if(!name)return settings.execution;
  const b=settings.generation.backends[name];if(!b)throw new Error('未知 backend '+name);
  const builtin=b.provider==='comfyui'&&(b.workflow===undefined||b.workflow===BUILTIN_WORKFLOW);
  return {...(builtin?{size:'512*512'}:{}),...settings.generation.defaults,...b.execution,...(b.model?{model:b.model}:{}),...settings.execution};
}

export function bindBackend(plan,settings,selection) {
  const name=selection??settings.generation?.defaultBackend;
  if(!name)return plan;
  const backend=loadBackend(settings,name);
  if(backend.provider==='comfyui') {
    const workflow=backend.template;
    const issues=templateIssues(backend);if(issues.length)throw new Error('工作流校验失败：'+JSON.stringify(issues));
    if(workflow.nodes||!Object.keys(workflow).length||Object.values(workflow).some(n=>!n.class_type||!n.inputs))throw new Error('workflow 必须为 ComfyUI API 格式');
    backend.workflowHash=hash(workflow);
    for(const binding of Object.values(backend.bindings))if(!workflow[binding.node]?.inputs||!(binding.input in workflow[binding.node].inputs))throw new Error('binding 指向不存在的节点输入');
    for(const item of plan.items)buildComfyRequest({...plan,backend},item);
  }
  const {planHash,...body}=plan;
  return {...body,backend:{id:name,...backend},planHash:hash({...body,backend:{id:name,...backend}})};
}

export function buildComfyRequest(plan,item,{index=0,image}={}) {
  const b=plan.backend,e=item.execution??plan.execution;
  const [width,height]=e.size.split('*').map(Number);
  if(width%32||height%32)throw new Error('本地宽高必须为 32 的倍数；不自动改变设计尺寸');
  if(e.promptExtend||e.watermark)throw new Error('ComfyUI 后端不支持 promptExtend/watermark');
  if(item.negativeBlock&&!b.bindings.negativePrompt)throw new Error('负向词非空但未配置 negativePrompt binding');
  if(!b.bindings.count&&Object.values(b.template).some(n=>n.inputs.batch_size!==undefined&&n.inputs.batch_size!==1))throw new Error('串行生图必须配置 count binding 或将 batch_size 固定为 1');
  if(!b.bindings.model&&Object.values(b.template).some(n=>n.class_type==='UnetLoaderGGUF'&&n.inputs.unet_name!==e.model))throw new Error('执行模型与 workflow 模型不一致，需要 model binding');
  if(plan.module==='edit'&&(!b.bindings.image||!b.bindings.vae))throw new Error('图编辑需要 image 和 vae bindings');
  const prompt=structuredClone(b.template);
  const values={prompt:item.prompt,negativePrompt:item.negativeBlock??'',width,height,seed:item.seed+index,count:1,model:e.model,...(image?{image}:{})};
  for(const [field,binding] of Object.entries(b.bindings)) {
    if(field==='vae')continue;
    if(field==='image'&&!image)continue;
    if(field in values)prompt[binding.node].inputs[binding.input]=values[field];
  }
  for(const [field,value] of Object.entries(b.options??{})) {
    const sampler=prompt[b.bindings.seed.node];
    const input={steps:'steps',cfg:'cfg',sampler:'sampler_name',scheduler:'scheduler'}[field];
    if(input){if(!(input in sampler.inputs))throw new Error('采样节点缺少参数 '+input);sampler.inputs[input]=value;}
  }
  if(plan.module==='edit') {
    const imageBinding=b.bindings.image,vaeBinding=b.bindings.vae;
    const encoder=prompt[b.bindings.prompt.node];
    delete encoder.inputs.images;
    encoder.inputs['images.image_1']=[imageBinding.node,0];
    encoder.inputs.vae=[vaeBinding.node,0];
  }
  return {provider:'comfyui',backend:b.id,prompt,seed:item.seed+index,size:e.size};
}
