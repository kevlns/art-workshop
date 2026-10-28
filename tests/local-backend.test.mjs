import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generationConfig,bindBackend,buildComfyRequest,backendDefaults} from '../lib/backends.mjs';
import {writeJson,hash} from '../lib/shared.mjs';
import {loadSettings} from '../lib/settings.mjs';
import {compileGenerate} from '../lib/generate.mjs';
import {compileEdit} from '../lib/edit.mjs';
import {validatePlan} from '../lib/plan.mjs';
import {ensureService,rememberedService,stopIdentity,shutdownOwnedServices} from '../lib/service.mjs';
import {runtimeRoot,http,sleep} from '../lib/runtime.mjs';
import {startTask,waitTask,cancelTask,taskStatus,shutdown,failedItems,resumeTask,taskView} from '../lib/tasks.mjs';
import {checkRun} from '../lib/executor.mjs';
import {BUILTIN_WORKFLOW,loadBackend} from '../lib/workflows.mjs';
import {validateConfiguration,doctor,environmentIssues} from '../lib/diagnostics.mjs';
import sharp from 'sharp';
import {LOCAL_SAMPLING_DEFAULTS} from '../lib/task-contract.mjs';
import {candidates,finalize} from '../lib/candidates.mjs';
import {readObject,updateObject} from '../lib/workspace.mjs';

test('stored unversioned plan starts, completes and finalizes without rewriting task or plan',()=>fixture(async({root,settings,runtime})=>{
 const stored=JSON.parse(readFileSync(new URL('./fixtures/compiler-legacy-plan.json',import.meta.url),'utf8'));
 settings.generation.backends.local.bindings.model={node:'1',input:'unet_name'};
 const plan=bindBackend(stored,settings),before=hash(readObject(root,'cellgame','task','white-cell').config);
 assert.equal(Object.hasOwn(plan,'compilerVersion'),false);
 const started=await startTask(plan,[plan.items[0]],settings);
 const done=await waitTask(runtime,started.taskId,{timeoutSeconds:20});
 assert.equal(done.status,'succeeded',done.error);
 assert.equal(Object.hasOwn(done.plan,'compilerVersion'),false);
 const candidate=candidates(settings,'cellgame','white-cell',started.taskId)[0];
 assert.equal(candidate.accepted,true);
 const finalized=await finalize(settings,'cellgame','white-cell',1,{runId:started.taskId,candidateId:candidate.candidateId,actor:'compiler-test'});
 assert.equal(hash(finalized.config),before);assert.equal(finalized.finalizations[0].candidateId,candidate.candidateId);
 assert.equal(done.plan.planHash,plan.planHash);
}));

test('builtin API and editor workflows use the recommended negative-enabled sampling defaults',()=>{
 const api=JSON.parse(readFileSync(new URL('../workflows/vant-builtin-qwen-image-2.1-Q4-8GB.api.json',import.meta.url)));
 const ui=JSON.parse(readFileSync(new URL('../workflows/vant-builtin-qwen-image-2.1-Q4-8GB.json',import.meta.url)));
 const sampler=ui.nodes.find(n=>n.id===6);
 assert.equal(api['6'].inputs.cfg,LOCAL_SAMPLING_DEFAULTS.cfg);
 assert.equal(sampler.widgets_values_named.cfg,LOCAL_SAMPLING_DEFAULTS.cfg);
 assert.equal(sampler.widgets_values[3],LOCAL_SAMPLING_DEFAULTS.cfg);
 assert.ok(api['6'].inputs.cfg>1);
 assert.deepEqual(api['6'].inputs.negative,['4',1]);
});

test('task sampling overrides are frozen into actual requests without changing shared backend or defaults',()=>fixture(async({root,settings})=>{
 const original=JSON.stringify(settings);
 const source=compileGenerate({projectId:'cellgame',jobId:'skills',root,localExecution:backendDefaults(settings)});
 source.snapshots.job.generation={backend:'local',options:{cfg:3,steps:31,sampler:'euler',scheduler:'simple'}};
 const plan=bindBackend(source,settings);
 validatePlan(plan);
 const inputs=buildComfyRequest(plan,plan.items[0]).prompt['6'].inputs;
 assert.equal(inputs.cfg,3);assert.equal(inputs.steps,31);
 assert.equal(inputs.sampler_name,'euler');assert.equal(inputs.scheduler,'simple');
 assert.equal(plan.backend.options.timeoutSeconds,5);
 assert.equal(JSON.stringify(settings),original);
 source.snapshots.job.generation.options.cfg=0;
 const zero=bindBackend(source,settings);assert.equal(buildComfyRequest(zero,zero.items[0]).prompt['6'].inputs.cfg,0);
 assert.notEqual(zero.planHash,plan.planHash);
 delete source.snapshots.job.generation.options;
 const fallback=bindBackend(source,settings);assert.equal(buildComfyRequest(fallback,fallback.items[0]).prompt['6'].inputs.cfg,1);
}));

async function fixture(fn,delay=50){
  const root=mkdtempSync(join(tmpdir(),'art-local-'));
  const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const endpoint='http://127.0.0.1:'+port;
  const template={
    '1':{class_type:'UnetLoaderGGUF',inputs:{unet_name:'local.gguf'}},
    '2':{class_type:'CLIPLoader',inputs:{clip_name:'clip.safetensors',type:'qwen_image',device:'cpu'}},
    '4':{class_type:'TextEncodeQwenImage21',inputs:{prompt:'',negative_prompt:'',clip:['2',0],images:{},resolution:1024}},
    '5':{class_type:'EmptyLatentImage',inputs:{width:512,height:512,batch_size:1}},
    '6':{class_type:'KSampler',inputs:{seed:1,steps:25,cfg:1,sampler_name:'euler',scheduler:'simple'}},
    '7':{class_type:'VAEDecode',inputs:{}},
    '8':{class_type:'SaveImage',inputs:{images:['7',0],filename_prefix:'test'}}
  };
  writeJson(join(root,'workflow.json'),template);
  cpSync(new URL('./fixtures/projects/',import.meta.url),join(root,'projects'),{recursive:true});
  const b={provider:'comfyui',model:'local.gguf',endpoints:[endpoint],workflow:'workflow.json',execution:{size:'512*512',perValue:1},bindings:{prompt:{node:'4',input:'prompt'},negativePrompt:{node:'4',input:'negative_prompt'},width:{node:'5',input:'width'},height:{node:'5',input:'height'},seed:{node:'6',input:'seed'},count:{node:'5',input:'batch_size'}},options:{pollMilliseconds:50,timeoutSeconds:5},launch:{executable:process.execPath,cwd:root,args:[fileURLToPath(new URL('./fixtures/mock-comfy.mjs',import.meta.url)),String(port),String(delay)],startupTimeoutSeconds:10}};
  const file=join(root,'config.json');writeJson(file,{paths:{workspace:root,output:join(root,'output'),refs:join(root,'refs'),cache:join(root,'cache')},generation:{defaultBackend:'local',backends:{local:b}},autoSyncSkills:false});
  const settings=loadSettings({file}),plan=bindBackend(compileGenerate({projectId:'cellgame',jobId:'skills',root,localExecution:backendDefaults(settings)}),settings);
  try{await fn({root,endpoint,settings,plan,b,template,runtime:runtimeRoot(settings)});}
  finally{const service=rememberedService(runtimeRoot(settings),endpoint);if(service?.identity)try{await stopIdentity(service.identity);}catch{};rmSync(root,{recursive:true,force:true});}
}
test('失败项重试保持原预案且排除已成功项，停止未知不能重试',async()=>fixture(async({plan,runtime})=>{
  const runId='task-failed',manifestPath=join(runtime,'failed-manifest.json');
  const rows=plan.items.map((item,index)=>({...item,ok:index!==0,status:index===0?'failed':'generated'}));
  writeJson(manifestPath,{taskId:runId,planHash:plan.planHash,items:rows});
  const file=join(runtime,'tasks',runId+'.json');
  writeJson(file,{taskId:runId,status:'failed',stopConfirmed:true,plan,manifestPath});
  assert.deepEqual(failedItems(runtime,runId,plan),[plan.items[0]]);
  const retryManifest=join(runtime,'retry-manifest.json');writeJson(retryManifest,{taskId:'task-retry',planHash:plan.planHash,items:[{...plan.items[0],ok:true,status:'generated'}]});
  const retryFile=join(runtime,'tasks/task-retry.json');writeJson(retryFile,{schema:'art-workshop/task',taskId:'task-retry',retryOf:runId,status:'succeeded',stopConfirmed:true,plan,manifestPath:retryManifest});
  assert.throws(()=>failedItems(runtime,runId,plan),/可重试/);rmSync(retryFile);
  assert.throws(()=>failedItems(runtime,runId,{...plan,planHash:'changed'}),/原批次预案/);
  writeJson(file,{taskId:runId,status:'unknown',stopConfirmed:false,plan,manifestPath});
  assert.throws(()=>failedItems(runtime,runId,plan),/停止尚未确认/);
}));

test('shutdown 保留共享服务中的外部任务，不清队列或全局中断',async()=>fixture(async({plan,runtime,settings,endpoint})=>{
  await ensureService(plan.backend,runtime);
  const foreign=await http(endpoint,'/prompt',{method:'POST',body:{prompt:{}}});
  await assert.rejects(shutdown(settings),/其他任务/);
  const queue=await http(endpoint,'/queue');
  assert.ok(queue.queue_running.some(row=>row[1]===foreign.prompt_id));
},10000));

test('统一配置、动态尺寸、模板快照和不支持能力校验',async()=>fixture(async({plan,template,root})=>{
  validatePlan(plan);assert.equal(plan.execution.model,'local.gguf');
  const item={...plan.items[0],execution:{...plan.execution,size:'960*320'}};
  const request=buildComfyRequest(plan,item,{index:1});assert.equal(request.prompt['5'].inputs.width,960);assert.equal(request.prompt['5'].inputs.height,320);assert.equal(request.prompt['6'].inputs.seed,item.seed+1);
  assert.equal(template['5'].inputs.width,512);assert.equal(JSON.parse(readFileSync(join(root,'workflow.json')))['5'].inputs.width,512);
  assert.throws(()=>buildComfyRequest(plan,{...item,execution:{...item.execution,size:'960*321'}}),/32/);
  assert.throws(()=>generationConfig({defaultBackend:'missing'}),/未定义/);
  assert.throws(()=>generationConfig({backends:{bad:{provider:'comfyui',model:'x',endpoints:['http://example.com'],workflow:'a',bindings:{}}}}),/本机/);
  const changed=structuredClone(plan);changed.backend.options.steps=1;assert.throws(()=>validatePlan(changed),/改变/);
}));

test('默认内置工作流、只读配置校验与环境检测',async()=>fixture(async({settings,root,runtime,plan,endpoint})=>{
  const b=settings.generation.backends.local;delete b.workflow;delete b.bindings;delete b.execution;
  const invalid=join(root,'invalid.json');writeFileSync(invalid,'{"generation":{"defaultBackend":"missing"}}');const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../art-workshop.mjs',import.meta.url)),'config','validate','--config',invalid],{encoding:'utf8'});assert.equal(cli.status,1);assert.equal(JSON.parse(cli.stdout).issues[0].code,'configuration');
  const builtin=loadBackend(settings,'local');assert.equal(builtin.workflow,BUILTIN_WORKFLOW);assert.equal(builtin.template['2'].inputs.device,'cpu');assert.equal(backendDefaults(settings).size,'512*512');
  const builtinEdit=loadBackend(settings,'local','edit');
  const editRequest=buildComfyRequest({module:'edit',backend:builtinEdit,execution:{...plan.execution,model:b.model}}, {...plan.items[0],imageArgs:['input.png'],execution:undefined},{image:'uploaded.png'});
  assert.deepEqual(editRequest.prompt['6'].inputs.latent_image,['4',2]);
  assert.deepEqual(editRequest.prompt['4'].inputs['images.image_1'],['5',0]);
  assert.equal(editRequest.prompt['5'].class_type,'ImageScale');
  assert.equal(editRequest.prompt['4'].inputs.resolution,0);
  assert.equal(validateConfiguration(settings).ok,true);assert.equal(existsSync(runtime),false);
  settings.execution.size='960*321';assert.equal(validateConfiguration(settings).backends[0].issues[0].code,'local_dimensions');delete settings.execution.size;
  const absent=await doctor(settings,{backend:'local'});assert.equal(absent.ok,false);assert.equal(existsSync(runtime),false);
  const info=Object.fromEntries(Object.values(builtin.template).map(n=>[n.class_type,{input:{required:{}}}]));info.UnetLoaderGGUF.input.required.unet_name=[['other.gguf']];
  const modelIssue=environmentIssues(builtin,info);assert.equal(modelIssue[0].code,'missing_model');assert.equal(modelIssue[0].nodeId,'1');
  delete info.TextEncodeQwenImage21;assert.ok(environmentIssues(builtin,info).some(x=>x.code==='missing_node'));
  builtin.template['8'].inputs.images=['missing',0];writeJson(join(root,'broken.json'),builtin.template);const broken=validateConfiguration({...settings,generation:{backends:{custom:{...b,workflow:join(root,'broken.json'),bindings:builtin.bindings}}}});assert.equal(broken.ok,false);assert.equal(broken.backends[0].issues[0].code,'workflow_link');
  await ensureService(plan.backend,runtime);assert.equal((await doctor(settings,{backend:'local'})).ok,true);await shutdown(settings);
}));

test('工作流提交与采样错误保留节点诊断，task status 和 manifest 可见',async()=>fixture(async({settings,root,runtime})=>{
  for(const [steps,stage,node] of [[666,'submission','1'],[667,'execution','6'],[668,'submission','1']]){
    settings.generation.backends.local.options.steps=steps;
    const plan=bindBackend(compileGenerate({projectId:'cellgame',jobId:'skills',root,localExecution:backendDefaults(settings)}),settings);
    const task=await startTask(plan,[plan.items[0]],settings),done=await waitTask(runtime,task.taskId,{timeoutSeconds:20});
    assert.equal(done.status,'failed');assert.equal(done.diagnostic.stage,stage);assert.equal(done.diagnostic.nodes[0].nodeId,node);
    const manifest=JSON.parse(readFileSync(done.manifestPath));assert.deepEqual(manifest.items[0].diagnostic,done.diagnostic);
    if(stage==='execution')assert.match(done.diagnostic.hint,/显存/);
    if(steps===668){assert.equal(done.promptId,null);assert.equal((await http(done.endpoint,'/queue')).queue_running.length,0);}
  }
  await shutdown(settings);
}));
test('懒启动并发去重，复用同一实例，shutdown 关闭进程',async()=>fixture(async({plan,runtime,settings,endpoint})=>{
  assert.equal(existsSync(join(runtime,'services')),false);
  const [a,b]=await Promise.all([ensureService(plan.backend,runtime),ensureService(plan.backend,runtime)]);assert.equal(a,endpoint);assert.equal(b,endpoint);
  const before=rememberedService(runtime,endpoint).identity;await ensureService(plan.backend,runtime);assert.equal(rememberedService(runtime,endpoint).identity.pid,before.pid);
  await assert.rejects(stopIdentity({...before,created:'wrong'}),/身份/);assert.ok(await http(endpoint,'/system_stats'));
  const result=await shutdown(settings);assert.equal(result.services[0].stopped,true);
  await assert.rejects(http(endpoint,'/system_stats'));
}));
test('应用启动的服务保存归属，退出只关闭受管实例并确认端口释放',async()=>fixture(async({plan,runtime,endpoint})=>{
  const previous=process.env.VANT_SERVICE_INSTANCE;
  process.env.VANT_SERVICE_INSTANCE='test-vant-exit';
  try {
    await ensureService(plan.backend,runtime);
    assert.deepEqual(rememberedService(runtime,endpoint).owner,{application:'vant',instanceId:'test-vant-exit'});
    await ensureService(plan.backend,runtime);
    assert.equal(rememberedService(runtime,endpoint).owner.instanceId,'test-vant-exit');
    const stopped=await shutdownOwnedServices();
    assert.ok(stopped.some(s=>s.endpoint===endpoint&&s.stopped&&s.portReleased));
    await assert.rejects(http(endpoint,'/system_stats'));
  } finally {if(previous===undefined)delete process.env.VANT_SERVICE_INSTANCE;else process.env.VANT_SERVICE_INSTANCE=previous;}
}));
test('后台任务输出 manifest、哈希与验收，按数量串行采样',async()=>fixture(async({plan,settings,root,runtime,endpoint})=>{
  settings.execution.perValue=2;
  plan=bindBackend(compileGenerate({projectId:'cellgame',jobId:'skills',root,localExecution:backendDefaults(settings)}),settings);
  const task=await startTask(plan,[plan.items[0]],settings,{operationId:'art-one-generation'});const done=await waitTask(runtime,task.taskId,{timeoutSeconds:20});assert.equal(done.status,'succeeded',done.error);const duplicate=await startTask(plan,[plan.items[0]],settings,{operationId:'art-one-generation'});assert.equal(duplicate.taskId,task.taskId);await assert.rejects(startTask(plan,[plan.items[1]],settings,{operationId:'art-one-generation'}),/操作身份/);
  const manifest=JSON.parse(readFileSync(done.manifestPath));assert.equal(manifest.items[0].files.length,2);assert.equal(checkRun(manifest,done.manifestPath)[0].integrity,true);
  const history=await http(endpoint,'/history/prompt-1');assert.equal(history['prompt-1'].prompt['4'].inputs.prompt,plan.items[0].prompt);
  const second=await http(endpoint,'/history/prompt-2');assert.equal(second['prompt-2'].prompt['6'].inputs.seed,plan.items[0].seed+1);
  await shutdown(settings);
}));
test('单任务取消不停止服务，shutdown 同时取消多个任务并关闭服务',async()=>fixture(async({plan,settings,runtime,endpoint})=>{
  const first=await startTask(plan,[plan.items[0]],settings);
  for(let n=0;n<100&&!taskStatus(runtime,first.taskId).promptId;n++)await sleep(100);
  const cancelled=await cancelTask(runtime,first.taskId);assert.equal(cancelled.status,'cancelled');assert.ok(await http(endpoint,'/system_stats'));
  const a=await startTask(plan,[plan.items[1]],settings);
  await assert.rejects(startTask(plan,[plan.items[2]],settings),/任务/);
  await sleep(200);
  const result=await shutdown(settings);assert.ok(result.cancelledTasks.includes(a.taskId));
  assert.equal(taskStatus(runtime,a.taskId).status,'cancelled');await assert.rejects(http(endpoint,'/system_stats'));
},10000));

test('本地图编辑上传原图并连接编码器，保留动态输出尺寸',async()=>fixture(async({root,settings,runtime,endpoint,template})=>{
  const source=join(root,'source.png');writeFileSync(source,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP3sAAAAASUVORK5CYII=','base64'));
  const jobPath=join(root,'projects/cellgame/tasks/edit-white-background/task.json');const record=JSON.parse(readFileSync(jobPath));record.config.items[0].source=source;writeJson(jobPath,record);
  template['3']={class_type:'VAELoader',inputs:{vae_name:'vae.safetensors'}};
  template['10']={class_type:'LoadImage',inputs:{image:''}};writeJson(join(root,'workflow.json'),template);
  const b=settings.generation.backends.local;b.bindings.image={node:'10',input:'image'};b.bindings.vae={node:'3',input:'vae_name'};b.execution.size='768*512';
  const plan=bindBackend(compileEdit({projectId:'cellgame',jobId:'edit-white-background',root,localExecution:backendDefaults(settings)}),settings);
  const task=await startTask(plan,plan.items,settings);const done=await waitTask(runtime,task.taskId,{timeoutSeconds:20});assert.equal(done.status,'succeeded',done.error);
  const prompt=(await http(endpoint,'/history/prompt-1'))['prompt-1'].prompt;
  assert.equal(prompt['10'].inputs.image,'art/uploaded.png');assert.deepEqual(prompt['4'].inputs['images.image_1'],['10',0]);assert.deepEqual(prompt['4'].inputs.vae,['3',0]);assert.equal('images' in prompt['4'].inputs,false);assert.equal(prompt['5'].inputs.width,768);
  const info=Object.fromEntries(Object.values(plan.backend.template).map(n=>[n.class_type,{}]));info.LoadImage={input:{required:{image:[['existing.png']]}}};assert.deepEqual(environmentIssues(plan.backend,info),[]);
  await shutdown(settings);
}));


test('lost local worker resumes recorded prompt without new submission',async()=>fixture(async({plan,settings,runtime,endpoint})=>{
 const started=await startTask(plan,[plan.items[0]],settings);
 let original;
 for(let n=0;n<100;n++){original=taskStatus(runtime,started.taskId);if(original.promptId)break;await sleep(50);}
 assert.ok(original.promptId);
 process.kill(original.workerPid);
 await sleep(300);
 const file=join(runtime,'tasks',started.taskId+'.json');
 original=JSON.parse(readFileSync(file));original.heartbeat='2000-01-01T00:00:00Z';writeJson(file,original);
 const lost=taskStatus(runtime,started.taskId);assert.equal(lost.status,'unknown');assert.equal(taskView(lost).canResume,true);
 await resumeTask(runtime,started.taskId);
 const done=await waitTask(runtime,started.taskId,{timeoutSeconds:20});
 assert.equal(done.status,'succeeded',done.error);assert.equal(done.stopConfirmed,true);
 const manifest=JSON.parse(readFileSync(done.manifestPath));assert.equal(manifest.items[0].ok,true);
 assert.equal(checkRun(manifest,done.manifestPath)[0].integrity,true);
 assert.deepEqual(await http(endpoint,'/history/prompt-2'),{});
 await shutdown(settings);
},1500));


test('serial local recovery preserves first download and never resubmits either sample',async()=>fixture(async({settings,root,runtime,endpoint})=>{
 settings.execution.perValue=2;
 const plan=bindBackend(compileGenerate({projectId:'cellgame',jobId:'skills',root,localExecution:backendDefaults(settings)}),settings);
 const started=await startTask(plan,[plan.items[0]],settings);
 let original;
 for(let n=0;n<160;n++){original=taskStatus(runtime,started.taskId);if(original.promptId==='prompt-2')break;await sleep(50);}
 assert.equal(original.promptId,'prompt-2');
 process.kill(original.workerPid);await sleep(300);
 const file=join(runtime,'tasks',started.taskId+'.json');original=JSON.parse(readFileSync(file));original.heartbeat='2000-01-01T00:00:00Z';writeJson(file,original);
 await resumeTask(runtime,started.taskId);
 const done=await waitTask(runtime,started.taskId,{timeoutSeconds:20});
 assert.equal(done.status,'succeeded',done.error);assert.equal(done.stopConfirmed,true);
 const manifest=JSON.parse(readFileSync(done.manifestPath));assert.equal(manifest.items[0].files.length,2);
 assert.deepEqual(await http(endpoint,'/history/prompt-3'),{});
 await resumeTask(runtime,started.taskId);
 assert.deepEqual(await http(endpoint,'/history/prompt-3'),{});
 await shutdown(settings);
},1500));
