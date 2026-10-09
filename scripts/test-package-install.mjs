import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
  if(!run(['agent','docs']).includes('核心冻结指导规则'))throw new Error('随包文档缺失');
  if(!existsSync(join(root,'skills','art-workshop','SKILL.md')))throw new Error('随包 skill 缺失');
  const config=JSON.parse(run(['config','show']));
  if(config.paths.workspace.startsWith(root))throw new Error('工作目录落入安装目录');
  if(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).private)throw new Error('安装包仍为 private');
  console.log(`test:package OK — ${info.name}@${info.version}, bin/docs/skill/external-config`);
}finally{rmSync(tmp,{recursive:true,force:true});}
