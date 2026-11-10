import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GUIDE_FILES} from '../lib/agent.mjs';
const npm=process.env.npm_execpath;
if(!npm)throw new Error('通过 npm run test:package 执行');
const tmp=mkdtempSync(join(tmpdir(),'art-workshop-install-'));
try{
  const runNpm=args=>execFileSync(process.execPath,[npm,...args],{encoding:'utf8'});
  const info=JSON.parse(runNpm(['pack','--json','--pack-destination',tmp]))[0];
  const prefix=join(tmp,'prefix');
  runNpm(['install','--global','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund',join(tmp,info.filename)]);
  const root=process.platform==='win32'?join(prefix,'node_modules','@kevlns','art-workshop'):join(prefix,'lib','node_modules','@kevlns','art-workshop');
  const run=args=>process.platform==='win32'?execFileSync('cmd.exe',['/d','/c',join(prefix,'art-workshop.cmd'),...args],{encoding:'utf8'}):execFileSync(join(prefix,'bin','art-workshop'),args,{encoding:'utf8'});
  if(run(['--version']).trim()!==info.version)throw new Error('安装版本不符');
  if(!run(['--help']).includes('v-cli art'))throw new Error('帮助缺少 v-cli 发现入口');
  const manifest=JSON.parse(readFileSync(join(root,'v-cli.plugin.json'),'utf8'));
  if(manifest.package!==info.name||manifest.command!=='art'||manifest.bin!=='art-workshop')throw new Error('随包插件身份不符');
  if(!existsSync(join(root,'AGENTS.md')))throw new Error('v-cli 随包规范缺失');
  const docs=run(['agent','docs']);
  const expectedDocs=readFileSync(join(root,'skills/art-workshop/SKILL.md'),'utf8');
  if(docs.trimEnd()!==expectedDocs.trimEnd())throw new Error('安装版 agent docs 未完整输出全部随包指南');
  if(!existsSync(join(root,'skills','art-workshop','SKILL.md')))throw new Error('随包 skill 缺失');
  const builtin=JSON.parse(run(['workflow','list']))[0];if(!builtin.default||!existsSync(builtin.api)||!existsSync(builtin.ui))throw new Error('内置工作流缺失');
  if(JSON.stringify(JSON.parse(run(['image','workflow','list'])))!==JSON.stringify(JSON.parse(run(['workflow','list']))))throw new Error('图片通道改变旧工作流结果');
  if(!manifest.agent.commands.some(command=>command.path[0]==='image')||!manifest.agent.commands.some(command=>command.path[0]==='video'))throw new Error('安装清单缺少图片或视频二级通道');
  const sdk=execFileSync(process.execPath,['--input-type=module','-e',"import {createVideoChannel} from '@kevlns/art-workshop/video';console.log(typeof createVideoChannel)"],{cwd:process.platform==='win32'?prefix:join(prefix,'lib'),encoding:'utf8'}).trim();
  if(sdk!=='function')throw new Error('安装包未导出视频SDK');
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major>22||major===22&&minor>=13){
    const project=join(tmp,'project'),input=join(project,'input.json');mkdirSync(project);writeFileSync(input,JSON.stringify({name:'Installed video channel'}));
    const args=['video','task','create','--workspace',project,'--input',input,'--operation','package-install-once'];
    const first=JSON.parse(run(args)),again=JSON.parse(run(args)),tasks=JSON.parse(run(['video','task','list','--workspace',project]));
    if(first.id!==again.id||tasks.length!==1||tasks[0].id!==first.id||first.cliExecution.operationId!==again.cliExecution.operationId)throw new Error('安装版视频通道未保留原任务与幂等回执');
  }
  const config=JSON.parse(run(['config','show']));
  if(config.paths.workspace.startsWith(root))throw new Error('工作目录落入安装目录');
  if(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).private)throw new Error('安装包仍为 private');
  console.log(`test:package OK — ${info.name}@${info.version}, bin/docs/skill/external-config/image/video-SDK/receipt`);
}finally{rmSync(tmp,{recursive:true,force:true});}
