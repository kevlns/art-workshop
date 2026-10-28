#!/usr/bin/env node
import {prepareRuntime} from './lib/environment-runtime.mjs';
import {readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readJson,writeJson} from './lib/shared.mjs';
const args=process.argv.slice(2),pos=[],options={};
if(args.length===1&&['--version','-V'].includes(args[0])){console.log(readJson(new URL('./package.json',import.meta.url)).version);process.exit(0);}
const help='art-workshop: config path/show/init/validate | doctor [--backend ID] [--start] | workflow list | environment guide/list/prepare/inspect/verify/register/unregister | refs guide | agent index/docs/init | list | style export/import/sources/create/list/read/update/derive/discard/analyze/resolve/adopt/recover/validate/show | generate show/plan/run | edit show/plan/run | task list/status/wait/cancel/recover/resume | shutdown | check RUN | project init/upgrade | job template/from-candidate/create/list/read/update/derive/discard/restore/analyze | reference import/list/update/remove | candidate list/favorites/favorite/finalize/delete/finalizations | compare PLAN PLAN\nrun --background 返回任务 ID；--backend 选择后端。shutdown 停止当前工作区关联任务，核验共享队列和进程身份后关闭本地服务。\n也可用 v-cli art 调用；先 v-cli agent docs art，再 v-cli agent describe art --json 查看完整参数。';
if(!args.length||args.length===1&&['--help','-h','help'].includes(args[0])){console.log(help);process.exit(0);}
const {taskObjectView}=await import('./lib/asset-profile.mjs');
const {loadJob,loadProject}=await import('./lib/project.mjs');
const {referenceRoot,referenceGuide}=await import('./lib/refs.mjs');
const {loadSettings,initSettings,externalPath}=await import('./lib/settings.mjs');
const {validateReport,loadCore}=await import('./lib/core.mjs');
const {compileGenerate}=await import('./lib/generate.mjs');
const {compileEdit}=await import('./lib/edit.mjs');
const {validatePlan,selectItems}=await import('./lib/plan.mjs');
const {executePlan,checkRun}=await import('./lib/executor.mjs');
const {agentIndex,agentDocs,syncSkill,autoSync}=await import('./lib/agent.mjs');
const {backendDefaults,bindBackend,buildComfyRequest}=await import('./lib/backends.mjs');
const {startTask,taskStatus,taskView,recoverTask,resumeTask,waitTask,cancelTask,shutdown}=await import('./lib/tasks.mjs');
const {runtimeRoot,tasks}=await import('./lib/runtime.mjs');
const {validateConfiguration,doctor}=await import('./lib/diagnostics.mjs');
const {createProject,createObject,listObjects,readObject,styleView,updateObject,deriveObject,discardObject,restoreTask,importReference,removeReference,updateReference,taskDisplayState,STYLE_CATEGORIES,TASK_PURPOSES}=await import('./lib/workspace.mjs');
const {startAnalysis,adoptStyle,recoverStyleAdoption,resolveStyleIssue,reviseStyleRules}=await import('./lib/style-lifecycle.mjs');
const {candidates,finalize,deleteCandidate,finalizations,editFromCandidate}=await import('./lib/candidates.mjs');
const {favoriteList,setFavorite}=await import('./lib/favorites.mjs');
const {upgradeProject}=await import('./lib/migration.mjs');
const {workflowList}=await import('./lib/workflows.mjs');
const {jobTemplate}=await import('./lib/templates.mjs');
const {deploymentGuide}=await import('./lib/deployment-guide.mjs');
const {inspectInstallation,discoverInstallations}=await import('./lib/environments.mjs');
const {verifyInstallation,registerInstallation,unregisterInstallation}=await import('./lib/environment-operations.mjs');
const flags=new Set(['dry','explore','background','start','replace','confirm','all-variants']);
const allowed=new Set(['config','workspace','output-dir','refs-dir','cache-dir','directory','endpoint','guide','project','input','out','report','note','core','job','plan','item','variant','offset','limit','file','backend','timeout','kind','id','revision','source','category','purposes','mapping','run','candidate','actor','operation','retry-run','item-id','value','name',...flags]);
for(let i=0;i<args.length;i++){if(args[i].startsWith('--')){const k=args[i].slice(2);if(!allowed.has(k)||k in options) throw new Error('未知或重复参数 '+k);options[k]=flags.has(k)?true:args[++i];if(options[k]===undefined) throw new Error('参数缺少值 '+k);}else pos.push(args[i]);}
const print=x=>console.log(JSON.stringify(x?.schema==='art-workshop/style'?styleView(settings.paths.workspace,x):x,null,2));
if(pos[0]==='workflow'&&pos[1]==='list'){print(workflowList());process.exit(0);}
let settings;
try{settings=loadSettings({file:options.config?resolve(options.config):undefined,workspace:options.workspace,output:options['output-dir'],refs:options['refs-dir'],cache:options['cache-dir']});}
catch(error){print({ok:false,stage:'configuration',issues:[{code:'configuration',message:error.message}]});process.exit(1);}
if(pos[0]==='config'&&pos[1]==='validate'||pos[0]==='doctor'){
  if(pos[0]==='doctor'&&pos[1])throw new Error('doctor 不接受位置参数');
  const report=pos[0]==='doctor'?await doctor(settings,{backend:options.backend,start:options.start}):validateConfiguration(settings,{backend:options.backend});print(report);process.exitCode=report.ok?0:1;
}else{
if(options.start)throw new Error('--start 仅用于 doctor');
const ROOT=settings.paths.workspace;
const path=x=>externalPath(resolve(ROOT,x),'资源文件');
function required(k){const value=options[k]??(k==='project'?settings.defaultProject:undefined);if(!value) throw new Error('需要 --'+k);return value;}
function manifestPath(value){const p=externalPath(resolve(settings.paths.output,value));return p.endsWith('.json')?p:join(p,'manifest.json');}
try {
  const [module,action]=pos;

  const effectiveRefs=referenceRoot({defaultRefsDir:settings.paths.refs});
  if(settings.autoSyncSkills&&!options.dry&&['style','generate','edit'].includes(module)&&['analyze','adopt','run'].includes(action)){try{autoSync();}catch(error){console.error('skill 自动同步失败：'+error.message+'；可用 agent init 重试。');}}
  if(module==='environment'){
    if(action==='guide')print(deploymentGuide(options.guide));
    else if(action==='list')print({environments:discoverInstallations()});
    else if(action==='prepare')print(await prepareRuntime(required('directory'),{guideId:options.guide}));
    else if(action==='inspect')print(await inspectInstallation(required('directory'),required('endpoint'),options.guide));
    else if(action==='verify'){const result=await verifyInstallation(required('directory'),required('endpoint'),{guideId:options.guide});print(result);if(!result.ok)process.exitCode=1;}
    else if(action==='register')print(await registerInstallation(required('directory'),required('endpoint'),{guideId:options.guide}));
    else if(action==='unregister')print(await unregisterInstallation(required('directory')));
    else throw new Error('未知 environment 操作');
  }
  else if(module==='config'){
    if(action==='path') console.log(settings.file);
    else if(action==='show') print(settings);
    else if(action==='init') print(initSettings(settings.file));
    else throw new Error('未知 config 操作');
  }
  else if(module==='project'){
    if(action==='upgrade')print(await upgradeProject(ROOT,required('project'),{dry:options.dry,settings,referenceAssignments:options.mapping?readJson(path(options.mapping)):undefined}));
    else if(action==='init')print(await createProject(settings,required('project'),readJson(path(required('input')))));
    else throw new Error('未知 project 操作');
  }
  else if(module==='reference'){
    const projectId=required('project'),kind=required('kind'),objectId=required('id');
    if(action==='list')print(readObject(ROOT,projectId,kind,objectId).references);
    else if(action==='import')print(await importReference(settings,projectId,kind,objectId,Number(required('revision')),{source:required('source'),category:options.category,purposes:options.purposes?.split(','),itemId:options['item-id'],note:options.note??''}));
    else if(action==='remove')print(await removeReference(settings,projectId,kind,objectId,Number(required('revision')),required('item')));
    else if(action==='update')print(await updateReference(settings,projectId,kind,objectId,Number(required('revision')),required('item'),readJson(path(required('input')))));
    else throw new Error('未知 reference 操作');
  }
  else if(module==='job'||module==='style'&&['create','list','update','derive','discard','read'].includes(action)){
    const projectId=required('project'),kind=module==='job'?'task':'style';
    if(action==='template'&&kind==='task')print(jobTemplate(ROOT,projectId,{kind:options.kind,core:options.core}));
    else if(action==='from-candidate'&&kind==='task')print(await editFromCandidate(settings,projectId,required('id'),{runId:required('run'),candidateId:required('candidate')}));
    else if(action==='list'){const records=listObjects(ROOT,projectId,kind),runs=kind==='task'?tasks(runtimeRoot(settings)).map(t=>taskStatus(runtimeRoot(settings),t.taskId)):[];print(records.map(record=>kind==='task'?{...taskObjectView(ROOT,record),display:taskDisplayState(record,runs,record.finalizations??[])}:styleView(ROOT,record)));}
    else if(action==='create')print(await createObject(settings,projectId,kind,readJson(path(required('input')))));
    else if(action==='read'){const record=readObject(ROOT,projectId,kind,required('id'));print(kind==='style'?styleView(ROOT,record):taskObjectView(ROOT,record));}
    else if(action==='update'){const record=await updateObject(settings,projectId,kind,required('id'),Number(required('revision')),readJson(path(required('input'))));print(kind==='style'?styleView(ROOT,record):taskObjectView(ROOT,record));}
    else if(action==='analyze'&&kind==='task')print(await startAnalysis(settings,projectId,required('id'),Number(required('revision')),{dry:options.dry,kind:'task',operationId:options.operation}));
    else if(action==='derive')print(await deriveObject(settings,projectId,kind,required('id'),Number(required('revision'))));
    else if(action==='restore'&&kind==='task')print(await restoreTask(settings,projectId,required('id'),Number(required('revision'))));
    else if(action==='discard')print(await discardObject(settings,projectId,kind,required('id'),Number(required('revision'))));
    else throw new Error('未知对象操作');
  }
  else if(module==='refs'){
    if(action!=='guide') throw new Error('未知 refs 操作；使用 refs guide');
    console.log(referenceGuide(effectiveRefs));
  }
  else if(module==='agent'){
    if(action==='index') print({...agentIndex(undefined,ROOT),config:settings.file,paths:settings.paths});
    else if(action==='docs') console.log(agentDocs());
    else if(action==='init') print(syncSkill({directory:resolve(options.directory??process.cwd()),dry:options.dry}));
    else throw new Error('未知 agent 操作');
  }
  else if(module==='list'){print((existsSync(join(ROOT,'projects'))?readdirSync(join(ROOT,'projects')):[]).map(id=>readJson(join(ROOT,'projects',id,'project.json'))));}
  else if(module==='style'&&['export','import','sources'].includes(action)){
    const bundle=await import('./lib/style-bundle.mjs');
    if(action==='export')print(bundle.exportStyleBundle(ROOT,required('project'),required('id'),path(required('out'))));
    else if(action==='import')print(await bundle.importStyleBundle(settings,required('project'),path(required('file'))));
    else print(bundle.listStyleSources(readJson(path(required('input')))));
  }
  else if(module==='style'){
    const projectId=required('project');
    if(action==='analyze')print(await startAnalysis(settings,projectId,required('id'),Number(required('revision')),{dry:options.dry,operationId:options.operation}));
    else if(action==='recover')print(await recoverStyleAdoption(settings,projectId,required('id')));
    else if(action==='revise')print(styleView(ROOT,await reviseStyleRules(settings,projectId,required('id'),Number(required('revision')),readJson(path(required('input'))))));
    else if(action==='resolve')print(styleView(ROOT,await resolveStyleIssue(settings,projectId,required('id'),Number(required('revision')),readJson(path(required('input'))))));
    else if(action==='adopt')print(await adoptStyle(settings,projectId,required('id'),Number(required('revision')),{note:options.note}));
    else if(action==='validate') print(validateReport(readJson(path(required('report'))),projectId));
    else if(action==='show') print(loadCore(projectId,required('core'),ROOT));
    else throw new Error('未知 style 操作');
  }else if(['generate','edit'].includes(module)){
    if(action==='show') print(loadJob(required('project'),required('job'),module,ROOT));
    else if(['plan','run'].includes(action)){
      let plan;
      if(options.plan){if(action!=='run'||['project','job','core','explore','backend'].some(k=>options[k]!==undefined)) throw new Error('冻结计划不能同时调整来源；修改任务后重新 plan');plan=readJson(path(options.plan));validatePlan(plan);if(plan.module!==module) throw new Error('计划模块不匹配');}
      else {const job=loadJob(required('project'),required('job'),module,ROOT),backend=options.backend??job.generation?.backend;plan=bindBackend((module==='generate'?compileGenerate:compileEdit)({projectId:required('project'),jobId:required('job'),coreId:options.core,root:ROOT,localExecution:backendDefaults(settings,backend)}),settings,backend);}
      if(action==='plan'){if(options.out) writeJson(path(options.out),plan);print(plan);}
      else {
        if(options['retry-run']&&(options.dry||options.variant||options.item||options.offset||options.limit))throw new Error('失败项重试不能混用预演或手动筛选');
        if(options.variant&&options['all-variants'])throw new Error('不能同时选择单个候选与全部候选');
        const variant=options.variant??(options.explore||options['all-variants']?undefined:'base');const items=selectItems(plan,{item:options.item,variant,offset:options.offset===undefined?0:Number(options.offset),limit:options.limit===undefined?undefined:Number(options.limit)});
        if(options.dry){if(plan.backend?.provider==='comfyui')print({dry:true,remoteCalls:0,planHash:plan.planHash,requests:items.map(item=>({itemId:item.itemId,variantId:item.variantId,requests:Array.from({length:(item.execution??plan.execution).perValue},(_,index)=>buildComfyRequest(plan,item,{index}))}))});else executePlan(plan,items,{outputRoot:settings.paths.output,dry:true});}
        else {const task=await startTask(plan,items,settings,{operationId:options.operation,retryRun:options['retry-run']??null});if(options.background)print(task);else {console.log('task → '+task.taskId);const result=await waitTask(runtimeRoot(settings),task.taskId);print(taskView(result));if(result.status!=='succeeded')process.exitCode=1;}}
      }
    }else throw new Error('未知模块操作');
  }else if(module==='task'){
    const root=runtimeRoot(settings),taskId=pos[2];
    if(action==='list')print(tasks(root).filter(t=>!options.project||(t.plan?.project??t.project)===options.project).map(t=>taskView(taskStatus(root,t.taskId))));
    else if(action==='recover')print(recoverTask(root,required('project'),required('operation')));
    else if(action==='status')print(taskView(taskStatus(root,taskId)));
    else if(action==='resume')print(await resumeTask(root,taskId));
    else if(action==='cancel')print(taskView(await cancelTask(root,taskId)));
    else if(action==='wait'){const timeoutSeconds=options.timeout===undefined?3600:Number(options.timeout);if(!Number.isFinite(timeoutSeconds)||timeoutSeconds<=0)throw new Error('timeout 必须为正秒数');const result=await waitTask(root,taskId,{timeoutSeconds});print(taskView(result));if(result.status!=='succeeded')process.exitCode=1;}
    else throw new Error('未知 task 操作');
  }else if(module==='shutdown'){if(action)throw new Error('shutdown 不接受位置参数');print(await shutdown(settings));}
  else if(module==='candidate'){
    const projectId=required('project');
    if(action==='favorites')print(favoriteList(settings,projectId));
    else if(action==='favorite'){
      if(!['true','false'].includes(options.value))throw new Error('value 必须为 true 或 false');
      print(await setFavorite(settings,projectId,required('job'),{runId:required('run'),candidateId:required('candidate'),value:options.value==='true'}));
    }
    else if(action==='list')print(candidates(settings,projectId,required('job'),required('run')));
    else if(action==='finalize')print(await finalize(settings,projectId,required('job'),Number(required('revision')),{runId:required('run'),candidateId:required('candidate'),replace:options.replace,actor:required('actor'),name:options.name}));
    else if(action==='delete')print(await deleteCandidate(settings,projectId,required('job'),Number(required('revision')),{runId:required('run'),candidateId:required('candidate'),confirm:options.confirm,actor:required('actor')}));
    else if(action==='finalizations')print(finalizations(settings,projectId,required('job')));
    else throw new Error('未知 candidate 操作');
  }else if(module==='check'){print(checkRun(readJson(manifestPath(action??required('file'))),manifestPath(action??required('file'))));
  }else if(module==='compare'){const read=value=>{const data=readJson(path(value));const plan=data.plan??data;validatePlan(plan);return plan;};const a=read(action),b=read(pos[2]);print({sameCore:a.sources.coreHash===b.sources.coreHash,execution:{before:a.execution,after:b.execution},items:b.items.map(x=>({itemId:x.itemId,variantId:x.variantId,changed:a.items.find(y=>y.itemId===x.itemId&&y.variantId===x.variantId)?.inputHash!==x.inputHash}))});}
  else if(!module||module==='help') console.log(help);
  else throw new Error('未知模块或旧入口：'+module);
}catch(e){print({ok:false,error:e.message,...(e.diagnostic?{diagnostic:e.diagnostic}:{})});process.exitCode=1;}
}
