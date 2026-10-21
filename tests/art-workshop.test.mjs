import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadProject} from '../lib/project.mjs';
import {TOOL_ROOT} from '../lib/settings.mjs';
const ROOT=mkdtempSync(join(tmpdir(),'art-workshop-data-'));
cpSync(join(TOOL_ROOT,'tests/fixtures/projects'),join(ROOT,'projects'),{recursive:true});
cpSync(join(TOOL_ROOT,'rules'),join(ROOT,'rules'),{recursive:true});
after(()=>rmSync(ROOT,{recursive:true,force:true}));
import {readJson,writeJson,hash} from '../lib/shared.mjs';
import {validateCoreConfig,validateReport,freezeCore,loadCore,selectCore} from '../lib/core.mjs';
import {compileGenerate} from '../lib/generate.mjs';
import {compileEdit} from '../lib/edit.mjs';
import {analyzeStyle} from '../lib/analyze.mjs';
import {selectItems,validatePlan} from '../lib/plan.mjs';
import {executePlan,checkRun} from '../lib/executor.mjs';
async function fixture(fn){const root=mkdtempSync(join(tmpdir(),'art-workshop-test-'));try{cpSync(join(ROOT,'projects'),join(root,'projects'),{recursive:true});cpSync(join(ROOT,'rules'),join(root,'rules'),{recursive:true});return await fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
const jobPath=root=>join(root,'projects/cellgame/tasks/skills/task.json');
const readConfig=path=>readJson(path).config;
const writeConfig=(path,config)=>writeJson(path,{...readJson(path),config});
const report=()=>readJson(join(ROOT,'projects/cellgame/reports/cellgame.json'));
const generate=root=>compileGenerate({projectId:'cellgame',jobId:'skills',root});
test('全部技能与单位编译、纯白背景、模型3.0与1K、seed保留',()=>{const p=generate(ROOT);validatePlan(p);assert.equal(selectItems(p,{variant:'base'}).length,15);assert.equal(p.items[0].seed,1000);assert.equal(p.execution.model,'qwen-image-3.0-pro');assert.equal(p.execution.size,'1024*1024');assert.match(p.items[0].prompt,/纯色背景 #FFFFFF/);assert.equal(compileGenerate({projectId:'cellgame',jobId:'units',root:ROOT}).items.length,4);});
test('预演无远程请求，输入prompt含空格保持单个参数',()=>{const p=generate(ROOT);let called=false;const result=executePlan(p,selectItems(p,{item:'skill-01',variant:'base'}),{root:ROOT,dry:true,runner:()=>called=true,log:()=>{}});assert.equal(called,false);assert.equal(result.requests.length,1);assert.match(result.requests[0].args[result.requests[0].args.indexOf('--prompt')+1],/【动态需求：主体、细节与关系】/);});
test('核心选择优先级与多核心歧义',()=>fixture(root=>{const r=report();r.id='alternate';freezeCore({projectId:'cellgame',report:r,root});const p=loadProject('cellgame',root);assert.equal(selectCore(p,{core:'alternate'},undefined,root).core.id,'alternate');assert.throws(()=>selectCore(p,{core:'cellgame'},'alternate',root),/冲突/);p.defaultCore=null;assert.throws(()=>selectCore(p,{},undefined,root),/未选定/);assert.equal(selectCore(p,{},'alternate',root).core.id,'alternate');}));
test('跨工程核心不能误选',()=>fixture(root=>{const p=loadProject('cellgame',root);p.id='other';p.defaultCore=null;p.cores=[];writeJson(join(root,'projects/other/project.json'),p);assert.throws(()=>selectCore(p,{},'cellgame',root),/不属于/);}));
test('冻结允许证据提醒并禁止覆写',()=>fixture(root=>{const r=report();assert.throws(()=>freezeCore({projectId:'cellgame',report:r,root}),/不能覆写/);r.id='new';r.notes=['低分辨率只能判断倾向'];assert.equal(freezeCore({projectId:'cellgame',report:r,root}).schemaVersion,3);}));
test('结构化核心拒绝职责越界和占位符',()=>{let r=report();r.recommendation.rules[0].strength='invalid';assert.throws(()=>validateCoreConfig(r.recommendation),/必须|非法/);r=report();r.recommendation.shape={contour:'rounded'};assert.throws(()=>validateCoreConfig(r.recommendation),/字段/);r=report();r.recommendation.model='x';assert.throws(()=>validateCoreConfig(r.recommendation),/字段/);r=report();r.summary='TODO';assert.throws(()=>validateReport(r,'cellgame'),/占位符/);});
test('冻结核心篡改会被拒绝',()=>fixture(root=>{const path=join(root,'projects/cellgame/styles/cellgame/core.json');const c=readJson(path);c.config.rules[0].instruction='篡改规则';writeJson(path,c);assert.throws(()=>loadCore('cellgame','cellgame',root),/哈希/);}));
test('候选只能调整表现，实体不能偷偷改写',()=>fixture(root=>{const j=readConfig(jobPath(root));j.items[0].variants[0].entities=[];writeConfig(jobPath(root),j);assert.throws(()=>generate(root),/字段/);}));
test('内容目标、实体数量与重复ID受校验',()=>fixture(root=>{const j=readConfig(jobPath(root));j.items[0].effects[0].target='missing';writeConfig(jobPath(root),j);assert.throws(()=>generate(root),/目标/);j.items[0].effects[0].target='cell';j.items[0].entities[0].count=0;writeConfig(jobPath(root),j);assert.throws(()=>generate(root),/整数/);}));
test('纯黑及显式渐变可选，场景被资产约束阻止',()=>fixture(root=>{const j=readConfig(jobPath(root));j.items[0].composition.background={type:'solid',color:'#000000'};writeConfig(jobPath(root),j);assert.match(generate(root).items[0].prompt,/#000000/);j.items[0].composition.background={type:'gradient',from:'#FFFFFF',to:'#000000'};writeConfig(jobPath(root),j);assert.match(generate(root).items[0].prompt,/渐变背景/);j.items[0].composition.background={type:'scene',description:'室内场景'};writeConfig(jobPath(root),j);assert.throws(()=>generate(root),/不允许/);}));
test('分析预演、模拟报告、缓存与明确冻结解耦',()=>fixture(async root=>{const input=readJson(join(root,'projects/cellgame/briefs/style.json'));let calls=0;const runner=()=>{calls++;const r=report();r.id=input.id;return {content:JSON.stringify(r)};};const dry=await analyzeStyle({projectId:'cellgame',input,root,dry:true,runner});assert.equal(dry.remoteCalls,0);assert.equal(calls,0);const r=await analyzeStyle({projectId:'cellgame',input,root,runner});await analyzeStyle({projectId:'cellgame',input,root,runner});assert.equal(calls,1);assert.equal(loadProject('cellgame',root).cores.length,1);freezeCore({projectId:'cellgame',report:r,root});assert.equal(loadProject('cellgame',root).cores.length,2);}));
test('多参考图各自分析再合并，参考范围进入缓存依据',()=>fixture(async root=>{writeFileSync(join(root,'source.png'),'image');const input={project:'cellgame',id:'new-style',description:'简洁插画',constraints:[],refs:[{path:'source.png',scope:'style',note:'观察媒介'},{path:'source.png',scope:'rendering',note:'观察渲染'}]};let calls=0;const r=report();r.id=input.id;const result=await analyzeStyle({projectId:'cellgame',input,root,refsDir:root,runner:args=>{calls++;return {content:args[0]==='text'?JSON.stringify(r):'硬边明暗'};}});assert.equal(calls,3);assert.equal(result.provenance.refs.length,2);}));
function editFixture(root){writeFileSync(join(root,'source.png'),'original image');const job={project:'cellgame',kind:'edit',core:null,items:[{id:'edit-one',source:'source.png',changes:[{target:'background',value:{type:'solid',color:'#FFFFFF'}}],preserve:[{target:'content',instruction:'保留主体'}],mustRead:['纯白背景'],seed:42}]};const path=join(root,'projects/cellgame/tasks/edit-test/task.json');writeJson(path,{schema:'art-workshop/task',schemaVersion:2,project:'cellgame',id:'edit-test',name:'edit-test',revision:1,status:'draft',config:job,references:[]});return {job,path};}
test('图编辑单独编译，不读取工程默认核心，原图内容锁定',()=>fixture(root=>{editFixture(root);const p=compileEdit({projectId:'cellgame',jobId:'edit-test',root});assert.equal(p.sources.core,null);assert.equal(p.items[0].imageArgs.length,1);assert.match(p.items[0].prompt,/未声明修改的部分保持原样/);writeFileSync(join(root,'source.png'),'changed');assert.throws(()=>executePlan(p,p.items,{root,runner:()=>{},log:()=>{}}),/参考图已变化/);}));
test('编辑允许同范围局部修改与保留，核心风格仍唯一负责',()=>fixture(root=>{const {job,path}=editFixture(root);job.items[0].preserve.push({target:'background',instruction:'保留背景'});writeConfig(path,job);assert.doesNotThrow(()=>compileEdit({projectId:'cellgame',jobId:'edit-test',root}));job.items[0].preserve.pop();job.core='cellgame';job.items[0].preserve.push({target:'style',instruction:'保留原图风格'});writeConfig(path,job);assert.throws(()=>compileEdit({projectId:'cellgame',jobId:'edit-test',root}),/风格由核心/);}));
test('模拟执行与产物完整性，不要求人工评分',()=>fixture(root=>{const p=generate(root);const result=executePlan(p,selectItems(p,{item:'skill-01',variant:'base'}),{outputRoot:join(root,'output'),log:()=>{},runner:args=>{writeFileSync(join(args[args.indexOf('--out-dir')+1],'image.png'),'mock');return {};}});let rows=checkRun(result.manifest,result.manifestPath);assert.equal(rows[0].accepted,true);writeFileSync(rows[0].path,'tampered');assert.equal(checkRun(result.manifest,result.manifestPath)[0].accepted,false);}));
test('旧计划与手工改变计划拒绝执行',()=>{assert.throws(()=>validatePlan({schemaVersion:2,items:[{}]}),/当前计划/);const p=generate(ROOT);p.items[0].prompt+='change';assert.throws(()=>validatePlan(p),/计划已改变/);});

function uiDesignFixture(root) {
  const profilePath=join(root,'projects/cellgame/profiles/skill-icon.json');
  const profile=readJson(profilePath);
  profile.design={resolution:{width:1920,height:1080},outputScale:2};
  writeJson(profilePath,profile);
  const job=readConfig(jobPath(root));
  job.items=job.items.slice(0,3);
  job.items[0].design={width:240,height:80,outputScale:4};
  job.items[1].design={width:480,height:64,outputScale:4};
  job.items[2].design={width:640,height:480};
  job.items.forEach(item=>item.variants=[{id:'base'}]);
  writeConfig(jobPath(root),job);
  return {profile,profilePath,job};
}

test('UI 三控件从设计基准换算独立尺寸，dry 请求使用每项尺寸',()=>fixture(root=>{
  uiDesignFixture(root);
  const plan=generate(root);
  validatePlan(plan);
  assert.deepEqual(plan.items.map(item=>item.execution.size),['960*320','1920*256','1280*960']);
  assert.deepEqual(plan.items[2].design.resolution,{width:1920,height:1080});
  assert.match(plan.items[0].prompt,/设计尺寸 240×80/);
  assert.doesNotMatch(plan.items[0].prompt,/整体占画幅约/);
  const dry=executePlan(plan,plan.items,{dry:true,log:()=>{},runner:()=>assert.fail('dry 调用模型')});
  assert.deepEqual(dry.requests.map(row=>row.args[row.args.indexOf('--size')+1]),['960*320','1920*256','1280*960']);
  const changed=structuredClone(plan.items[0]);
  changed.execution.size='1024*1024';
  assert.notEqual(hash({...changed,execution:changed.execution}),plan.items[0].inputHash);
  assert.throws(()=>executePlan(plan,[changed],{dry:true,log:()=>{}}),/内容已改变/);
}));

test('UI 全画布继承设计分辨率，设计尺寸排斥任务像素覆盖',()=>fixture(root=>{
  const {job}=uiDesignFixture(root);
  delete job.items[0].design;
  writeConfig(jobPath(root),job);
  assert.equal(generate(root).items[0].execution.size,'3840*2160');
  job.execution={size:'1024*1024'};
  writeConfig(jobPath(root),job);
  assert.throws(()=>generate(root),/不能同时指定/);
}));

test('UI 拒绝缺少设计基准、不完整尺寸、越界尺寸及非法倍率',()=>fixture(root=>{
  const {job,profile,profilePath}=uiDesignFixture(root);
  const original=structuredClone(job.items[0].design);
  for(const invalid of [{width:240},{width:1921,height:80},{width:240,height:80,outputScale:0},{width:240,height:80,outputScale:5}]) {
    job.items[0].design=invalid;
    writeConfig(jobPath(root),job);
    assert.throws(()=>generate(root));
  }
  job.items[0].design=original;
  writeConfig(jobPath(root),job);
  delete profile.design;
  writeJson(profilePath,profile);
  assert.throws(()=>generate(root),/需要资产规格/);
}));

test('UI 执行记录的尺寸篡改不能通过产物验收',()=>fixture(root=>{
  uiDesignFixture(root);
  const plan=generate(root);
  const run=executePlan(plan,[plan.items[0]],{outputRoot:join(root,'output'),log:()=>{},runner:args=>{
    assert.equal(args[args.indexOf('--size')+1],'960*320');
    writeFileSync(join(args[args.indexOf('--out-dir')+1],'image.png'),'mock');
    return {};
  }});
  run.manifest.items[0].execution.size='1024*1024';
  assert.throws(()=>checkRun(run.manifest,run.manifestPath),/执行记录已改变/);
}));

test('透明生成和透明编辑冻结输出契约并参与计划哈希',()=>fixture(root=>{const j=readConfig(jobPath(root));j.items[0].composition.background={type:'transparent'};writeConfig(jobPath(root),j);const p=generate(root);assert.equal(p.items[0].output.background,'transparent');assert.match(p.items[0].prompt,/#FF00FF/);const {job,path}=editFixture(root);job.items[0].changes=[{target:'background',value:{type:'transparent'}},{target:'outline',instruction:'加粗描边'}];writeConfig(path,job);const e=structuredClone(compileEdit({projectId:'cellgame',jobId:'edit-test',root}));assert.equal(e.items[0].output.format,'png');e.items[0].output.processor='other';assert.throws(()=>validatePlan(e),/计划/);}));
