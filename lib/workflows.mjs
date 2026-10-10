import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const BUILTIN_WORKFLOW='vant-builtin-qwen-image-2.1-Q4-8GB';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
export const builtinBindings={model:{node:'1',input:'unet_name'},prompt:{node:'4',input:'prompt'},negativePrompt:{node:'4',input:'negative_prompt'},width:{node:'5',input:'width'},height:{node:'5',input:'height'},count:{node:'5',input:'batch_size'},seed:{node:'6',input:'seed'}};
export function loadBackend(settings,name) {
  const backend=structuredClone(settings.generation.backends[name]);if(!backend)throw new Error('未知 backend '+name);
  backend.id=name;
  if(backend.provider!=='comfyui')return backend;
  const builtin=backend.workflow===undefined||backend.workflow===BUILTIN_WORKFLOW;
  backend.workflow=builtin?BUILTIN_WORKFLOW:resolve(dirname(settings.file),backend.workflow);
  const path=builtin?resolve(root,'workflows',BUILTIN_WORKFLOW+'.api.json'):backend.workflow;
  backend.template=JSON.parse(readFileSync(path,'utf8'));
  backend.bindings=builtin?{...structuredClone(builtinBindings),...backend.bindings}:backend.bindings;
  if(backend.launch){backend.launch.executable=resolve(dirname(settings.file),backend.launch.executable);backend.launch.cwd=resolve(dirname(settings.file),backend.launch.cwd);}
  return backend;
}
export function workflowList(){return [{id:BUILTIN_WORKFLOW,default:true,mode:'generate',api:resolve(root,'workflows',BUILTIN_WORKFLOW+'.api.json'),ui:resolve(root,'workflows',BUILTIN_WORKFLOW+'.json'),models:['qwen-image-2.1-UC-Q4_K_M.gguf','qwen3vl_8b_int8_convrot.safetensors','qwen_image_2.1_vae_bf16.safetensors'],notes:'8GB 配置：文本编码器使用 CPU，512×512 默认画布；分辨率增大可能超出显存。'}];}
