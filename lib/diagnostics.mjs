import {existsSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadBackend} from './workflows.mjs';
import {http,runtimeRoot} from './runtime.mjs';
const issue=(code,message,extra={})=>({code,message,...extra});
export function templateIssues(backend) {
  const graph=backend.template,issues=[];
  if(!graph||graph.nodes||!Object.keys(graph).length||Object.values(graph).some(n=>!n?.class_type||!n.inputs||typeof n.inputs!=='object'))return [issue('workflow_format','需要非空 ComfyUI API 格式，而非 UI 导出的 nodes/links 格式')];
  for(const [nodeId,node] of Object.entries(graph))for(const [input,value] of Object.entries(node.inputs))if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1])) {
    if(!graph[value[0]])issues.push(issue('workflow_link','连接指向不存在的节点',{nodeId,nodeType:node.class_type,input,sourceNode:value[0]}));
    if(value[1]<0)issues.push(issue('workflow_link','输出索引不能为负数',{nodeId,input}));
  }
  for(const [field,b] of Object.entries(backend.bindings??{}))if(!(b.input in (graph[b.node]?.inputs??{})))issues.push(issue('workflow_binding','参数绑定指向不存在的节点输入',{field,nodeId:b.node,input:b.input}));
  return issues;
}
export function environmentIssues(backend,info) {
  const issues=[];
  for(const [nodeId,node] of Object.entries(backend.template)) {
    const schema=info[node.class_type];
    if(!schema){issues.push(issue('missing_node','ComfyUI 未注册此节点，请安装或修复对应自定义节点',{nodeId,nodeType:node.class_type}));continue;}
    const inputs={...schema.input?.required,...schema.input?.optional};
    for(const [input,templateValue] of Object.entries(node.inputs)) {
      const value=backend.bindings?.model?.node===nodeId&&backend.bindings.model.input===input?backend.model:templateValue;
      const spec=inputs[input];
      const uploadedImage=backend.bindings?.image?.node===nodeId&&backend.bindings.image.input===input;
      if(!uploadedImage&&Array.isArray(spec?.[0])&&!Array.isArray(value)&&!spec[0].includes(value))issues.push(issue(input.endsWith('_name')?'missing_model':'invalid_node_value','节点输入值不在当前环境可选范围内',{nodeId,nodeType:node.class_type,input,value,available:spec[0]}));
      if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1])) {
        const source=info[backend.template[value[0]]?.class_type];
        if(source?.output&&value[1]>=source.output.length)issues.push(issue('workflow_link','连接输出索引超出节点输出范围',{nodeId,input,sourceNode:value[0],output:value[1]}));
      }
    }
  }
  return issues;
}
export async function inspectEnvironment(endpoint,backend) {
  const stats=await http(endpoint,'/system_stats',{timeout:2000});
  const version=stats.system?.comfyui_version,parts=version?.split('.').map(Number),issues=[];
  if(!version||!Number.isFinite(parts[0])||!Number.isFinite(parts[1])||(parts[0]===0&&parts[1]<39))issues.push(issue('comfyui_version','需要 ComfyUI 0.39.0 或更新版本，以支持按任务中断',{version}));
  const nodes=await http(endpoint,'/object_info',{timeout:10000});
  issues.push(...environmentIssues(backend,nodes));
  return {endpoint,reachable:true,ok:!issues.length,version,devices:stats.devices??[],issues};
}
export function validateConfiguration(settings,{backend:selection}={}) {
  const names=selection?[selection]:Object.keys(settings.generation.backends??{}),backends=[];
  for(const name of names) {
    try {
      const b=loadBackend(settings,name),issues=b.provider==='comfyui'?templateIssues(b):[];
      if(b.provider==='comfyui') {
        const execution={...settings.generation.defaults,...b.execution,...settings.execution};
        if(execution.promptExtend||execution.watermark)issues.push(issue('unsupported_option','本地后端不支持 promptExtend/watermark'));
        if(execution.size&&execution.size.split('*').some(x=>Number(x)%32))issues.push(issue('local_dimensions','本地宽高必须为 32 的倍数',{size:execution.size}));
      }
      backends.push({backend:name,provider:b.provider,workflow:b.workflow,issues});
    }
    catch(error){backends.push({backend:name,issues:[issue('configuration',error.message)]});}
  }
  return {ok:backends.every(b=>!b.issues.length),config:settings.file,defaultBackend:settings.generation.defaultBackend??'bailian',backends};
}
export async function doctor(settings,{backend:selection,start=false}={}) {
  const validation=validateConfiguration(settings,{backend:selection});if(!validation.ok)return {...validation,stage:'configuration'};
  const reports=[];
  for(const row of validation.backends) {
    if(row.provider!=='comfyui'){reports.push({...row,ok:true,scope:'configuration-only',notes:'远程凭证与配置请核对 bl auth status 和 bl config show；本命令不验证云端连通性，也不发起付费调用'});continue;}
    const b=loadBackend(settings,row.backend),issues=[];b.model=settings.execution.model??b.model;
    if(b.launch) {
      for(const [label,path,type] of [['launch.executable',b.launch.executable,'file'],['launch.cwd',b.launch.cwd,'directory']])if(!existsSync(path)||(type==='file'?!statSync(path).isFile():!statSync(path).isDirectory()))issues.push(issue('launch_path',label+' 不存在或类型不符',{path}));
      const entry=b.launch.args.find(x=>/\.py$|\.mjs$|\.js$/.test(x));if(entry&&!existsSync(resolve(b.launch.cwd,entry)))issues.push(issue('launch_entry','启动入口文件不存在',{path:resolve(b.launch.cwd,entry)}));
    }
    if(start&&!issues.length)try{await (await import('./service.mjs')).ensureService(b,runtimeRoot(settings));}catch(error){issues.push(issue('startup',error.message,{diagnostic:error.diagnostic}));}
    const endpoints=[];
    for(const endpoint of b.endpoints)try{endpoints.push(await inspectEnvironment(endpoint,b));}catch(error){endpoints.push({endpoint,reachable:false,ok:false,issues:[issue('unreachable','无法读取 ComfyUI 环境：'+error.message)]});}
    const available=endpoints.some(e=>e.ok);
    reports.push({...row,ok:available&&!issues.length,issues,endpoints,notes:available?'未执行采样，显存容量和图像效果仍需实际任务验证':start||endpoints.some(e=>e.reachable)?'查看 issues：服务可达但环境不兼容，或启动配置有误':'服务未启动时不能确认插件和模型；使用 doctor --start 启动并检查'});
  }
  return {ok:reports.every(r=>r.ok),config:settings.file,startedOnDemand:start,backends:reports};
}
export function workflowError(message,backend,{stage='execution',promptId,nodeErrors={},messages=[],cause}={}) {
  const nodes=Object.entries(nodeErrors).map(([nodeId,data])=>({nodeId,nodeType:data.class_type??backend.template[nodeId]?.class_type,title:backend.template[nodeId]?._meta?.title,errors:data.errors??[data]}));
  for(const entry of messages)if(Array.isArray(entry)&&entry[0]==='execution_error') {const data=entry[1];nodes.push({nodeId:String(data.node_id),nodeType:data.node_type,exceptionType:data.exception_type,message:data.exception_message,traceback:data.traceback});}
  const details=JSON.stringify({nodes,message});
  const hint=/out of memory|OutOfMemory|allocation/i.test(details)?'显存或内存不足：降低出图尺寸，确认 lowvram 和文本编码器 CPU 配置':/not in list|not found|missing/i.test(details)?'运行 art doctor 检查模型文件、插件节点与输入选项':'检查指定节点的输入与连接；运行 art config validate 和 art doctor';
  const error=new Error(message,{cause});error.diagnostic={kind:'workflow',stage,backend:backend.id,workflow:backend.workflow,promptId,nodes,messages,hint};return error;
}
