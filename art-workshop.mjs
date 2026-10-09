#!/usr/bin/env node
import {readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readJson,writeJson} from './lib/shared.mjs';
const args=process.argv.slice(2),pos=[],options={};
if(args.length===1&&['--version','-V'].includes(args[0])){console.log(readJson(new URL('./package.json',import.meta.url)).version);process.exit(0);}
const help='art-workshop: config path/show/init | refs guide | agent index/docs/init | list | style analyze/validate/freeze/show | generate show/plan/run | edit show/plan/run | check/select RUN | compare PLAN PLAN\n也可用 v-cli art 调用；先 v-cli agent docs art，再 v-cli agent describe art --json 查看完整参数。';
if(!args.length||args.length===1&&['--help','-h','help'].includes(args[0])){console.log(help);process.exit(0);}
const {loadJob,loadProject}=await import('./lib/project.mjs');
const {referenceRoot,ensureReferenceDirectories,referenceGuide}=await import('./lib/refs.mjs');
const {loadSettings,initSettings,externalPath}=await import('./lib/settings.mjs');
const {analyzeStyle}=await import('./lib/analyze.mjs');
const {validateReport,freezeCore,loadCore}=await import('./lib/core.mjs');
const {compileGenerate}=await import('./lib/generate.mjs');
const {compileEdit}=await import('./lib/edit.mjs');
const {validatePlan,selectItems}=await import('./lib/plan.mjs');
const {executePlan,checkRun}=await import('./lib/executor.mjs');
const {agentIndex,agentDocs,syncSkill,autoSync}=await import('./lib/agent.mjs');
const flags=new Set(['dry','explore']);
const allowed=new Set(['config','workspace','output-dir','refs-dir','cache-dir','directory','project','input','out','report','note','core','job','plan','item','variant','offset','limit','review','file',...flags]);
for(let i=0;i<args.length;i++){if(args[i].startsWith('--')){const k=args[i].slice(2);if(!allowed.has(k)||k in options) throw new Error('未知或重复参数 '+k);options[k]=flags.has(k)?true:args[++i];if(options[k]===undefined) throw new Error('参数缺少值 '+k);}else pos.push(args[i]);}
const print=x=>console.log(JSON.stringify(x,null,2));
const settings=loadSettings({file:options.config?resolve(options.config):undefined,workspace:options.workspace,output:options['output-dir'],refs:options['refs-dir'],cache:options['cache-dir']});
const ROOT=settings.paths.workspace;
const path=x=>externalPath(resolve(ROOT,x),'资源文件');
function required(k){const value=options[k]??(k==='project'?settings.defaultProject:undefined);if(!value) throw new Error('需要 --'+k);return value;}
function manifestPath(value){const p=externalPath(resolve(settings.paths.output,value));return p.endsWith('.json')?p:join(p,'manifest.json');}
try {
  const [module,action]=pos;
  ensureReferenceDirectories(settings.paths.refs);
  const selectedProject=options.project??(['refs','style','generate','edit'].includes(module)?settings.defaultProject:undefined);
  const effectiveRefs=selectedProject?referenceRoot({workspace:ROOT,defaultRefsDir:settings.paths.refs,refsDir:options['refs-dir']?settings.paths.refs:undefined,project:loadProject(selectedProject,ROOT)}):settings.paths.refs;
  ensureReferenceDirectories(effectiveRefs);
  if(settings.autoSyncSkills&&!options.dry&&['style','generate','edit'].includes(module)&&['analyze','freeze','run'].includes(action)){try{autoSync();}catch(error){console.error('skill 自动同步失败：'+error.message+'；可用 agent init 重试。');}}
  if(module==='config'){
    if(action==='path') console.log(settings.file);
    else if(action==='show') print(settings);
    else if(action==='init') print(initSettings(settings.file));
    else throw new Error('未知 config 操作');
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
  else if(module==='style'){
    const projectId=required('project');
    if(action==='analyze'){const result=analyzeStyle({projectId,input:readJson(path(required('input'))),out:options.out?path(options.out):undefined,root:ROOT,refsDir:options['refs-dir']?settings.paths.refs:undefined,defaultRefsDir:settings.paths.refs,cacheDir:join(settings.paths.cache,'analysis'),analysisModel:settings.analysisModel,dry:options.dry});print(result);}
    else if(action==='validate') print(validateReport(readJson(path(required('report'))),projectId));
    else if(action==='freeze') print(freezeCore({projectId,report:readJson(path(required('report'))),note:options.note,root:ROOT}));
    else if(action==='show') print(loadCore(projectId,required('core'),ROOT));
    else throw new Error('未知 style 操作');
  }else if(['generate','edit'].includes(module)){
    if(action==='show') print(loadJob(required('project'),required('job'),module,ROOT));
    else if(['plan','run'].includes(action)){
      let plan;
      if(options.plan){if(action!=='run'||['project','job','core','explore'].some(k=>options[k]!==undefined)) throw new Error('冻结计划不能同时调整来源；修改任务后重新 plan');plan=readJson(path(options.plan));validatePlan(plan);if(plan.module!==module) throw new Error('计划模块不匹配');}
      else plan=(module==='generate'?compileGenerate:compileEdit)({projectId:required('project'),jobId:required('job'),coreId:options.core,root:ROOT,localExecution:settings.execution});
      if(action==='plan'){if(options.out) writeJson(path(options.out),plan);print(plan);}
      else {const variant=options.variant??(options.explore?undefined:'base');const items=selectItems(plan,{item:options.item,variant,offset:options.offset===undefined?0:Number(options.offset),limit:options.limit===undefined?undefined:Number(options.limit)});const result=executePlan(plan,items,{outputRoot:settings.paths.output,dry:options.dry});if(result.manifest?.summary.failed) process.exitCode=1;}
    }else throw new Error('未知模块操作');
  }else if(['check','select'].includes(module)){
    const file=manifestPath(action??required('file')),manifest=readJson(file);
    const review=options.review?readJson(path(options.review)):manifest.review;
    const rows=checkRun(manifest,file,review);
    if(module==='check'){if(options.out) writeJson(path(options.out),rows);print(rows);}
    else {const matched=rows.filter(x=>x.itemId===required('item')&&x.variantId===required('variant')&&(!options.file||x.file===options.file));if(matched.length!==1||!matched[0].accepted) throw new Error('只能选择唯一且全部验收通过的产物');manifest.review=rows;manifest.selections[options.item]=matched[0];writeJson(file,manifest);print(matched[0]);}
  }else if(module==='compare'){const read=value=>{const data=readJson(path(value));const plan=data.plan??data;validatePlan(plan);return plan;};const a=read(action),b=read(pos[2]);print({sameCore:a.sources.coreHash===b.sources.coreHash,execution:{before:a.execution,after:b.execution},items:b.items.map(x=>({itemId:x.itemId,variantId:x.variantId,changed:a.items.find(y=>y.itemId===x.itemId&&y.variantId===x.variantId)?.inputHash!==x.inputHash}))});}
  else if(!module||module==='help') console.log(help);
  else throw new Error('未知模块或旧入口：'+module);
}catch(e){console.error(e.message);process.exitCode=1;}
